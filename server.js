import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { createPool } from 'generic-pool';
import ExcelJS from 'exceljs';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Supabase client (server-side, uses the service_role/secret key so it
//    bypasses Row Level Security — this backend IS the trusted server) ───────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY environment variables. See .env.example.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Uploads now go to Supabase Storage instead of local disk — multer just
// needs to hand us the raw buffer.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const MEDIA_BUCKET = 'media';

async function ensureMediaBucket() {
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) { console.error('[storage] could not list buckets:', error.message); return; }
    const exists = (buckets || []).some(b => b.name === MEDIA_BUCKET);
    if (!exists) {
      const { error: createErr } = await supabase.storage.createBucket(MEDIA_BUCKET, { public: true });
      if (createErr) console.error('[storage] could not create media bucket:', createErr.message);
      else console.log(`[storage] created public bucket "${MEDIA_BUCKET}"`);
    }
  } catch (e) {
    console.error('[storage] ensureMediaBucket failed:', e.message);
  }
}

// Upload a Buffer (from multer memoryStorage, or a decoded base64 string) to
// the media bucket and return its public URL. Object paths are namespaced by
// folder (e.g. "headshots/169..."), mirroring the old uploads/ subfolders.
async function uploadBufferToStorage(buffer, folder, originalName, mimetype) {
  const safeName = (originalName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(objectPath, buffer, {
    contentType: mimetype || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
  return { path: objectPath, publicUrl: data.publicUrl };
}

// Given a full Supabase Storage public URL, recover the object path inside
// the media bucket so it can be removed (used to delete a replaced headshot).
function storagePathFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function deleteFromStorageByUrl(url) {
  const p = storagePathFromPublicUrl(url);
  if (!p) return;
  try { await supabase.storage.from(MEDIA_BUCKET).remove([p]); } catch { /* best-effort */ }
}

// Resolve a value stored in a *_path / photoN / mood_board_images column into
// something an <img src="..."> (or a Puppeteer page) can load directly.
// Post-migration these are full https:// Supabase Storage URLs; data: URIs
// (e.g. freshly pasted images not yet uploaded) are also passed through as-is.
// Legacy local "/uploads/..." paths from the old SQLite-backed server cannot
// be resolved anymore (the files never made it into Storage) — this returns
// null for those so callers render "no image" instead of crashing.
function resolveImageUrl(value) {
  if (!value) return null;
  if (value.startsWith('data:')) return value;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return null;
}

// Fetches an image URL server-side (Node) and returns it as a data: URI, so
// Chromium never has to make its own network request for it at all. This is
// the real fix for large rosters being slow, not just a bigger timeout:
// Chromium enforces a per-host connection concurrency cap (~6 simultaneous
// requests), so a page with ~195 <img> tags queues most of them behind each
// other one by one. Node's fetch has no such cap, so we can pull many images
// down in parallel here in one batch — in practice this turns "195 images,
// mostly serialized" into "195 images, ~16 at a time," which is the actual
// speedup (not just a longer grace period before giving up).
//
// Also downsizes every photo via sharp before embedding it. This matters even
// more than the fetch speedup: Chromium has to decode each embedded image to
// its FULL pixel dimensions to paint it, even though a roster card only
// displays it as a small thumbnail. A single modern phone photo can be
// 3000x4000px — a ~48MB raw bitmap once decoded — and rendering ~195 of
// those at once is enough to exhaust a hosted container's memory and crash
// the whole Node process (this is what happened on shootday 20's ~195-artist
// roster: the process restarted mid-request rather than the request just
// timing out). Resizing to roster-thumbnail resolution first keeps both the
// embedded HTML size and Chromium's decoded memory footprint small,
// regardless of how large the original uploaded photo was.
async function fetchAsDataUri(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let buf = Buffer.from(await res.arrayBuffer());
    let type = res.headers.get('content-type') || 'image/jpeg';
    if (type.startsWith('image/') && type !== 'image/svg+xml') {
      try {
        // 480px wide is generously larger than these ever render at in the
        // PDF grid (4 columns on an A4 page), even accounting for print DPI.
        // .rotate() with no args auto-applies the image's EXIF orientation
        // (common on phone photos) before resizing/re-encoding strips it.
        buf = await sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
        type = 'image/jpeg';
      } catch {
        // Not every file sharp can decode (corrupt upload, unusual format,
        // etc.) — fall back to embedding the original bytes rather than
        // dropping the photo entirely.
      }
    }
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// Inlines a batch of image URLs as data: URIs with bounded concurrency.
// Returns a Map from original URL -> data URI. If a particular image fails to
// fetch, its map entry falls back to the original URL so one bad photo can't
// break the rest of the document (it'll just render as a broken image, same
// as before this optimization existed). Concurrency is deliberately modest
// (not e.g. 32+): each in-flight worker briefly holds a full-resolution image
// buffer in memory before sharp shrinks it, so a very high number here would
// reintroduce the same kind of memory spike this function exists to avoid.
//
// onProgress(done, total) is optional — called after each image finishes (success
// or fallback) so a caller tracking a PDF generation job can report real
// percent-complete for this phase instead of a bare spinner.
async function inlineImages(urls, concurrency = 8, onProgress) {
  const unique = [...new Set(urls.filter(Boolean))];
  const map = new Map();
  let i = 0, done = 0;
  async function worker() {
    while (i < unique.length) {
      const url = unique[i++];
      if (url.startsWith('data:')) { map.set(url, url); } else {
        const dataUri = await fetchAsDataUri(url);
        map.set(url, dataUri || url);
      }
      done++;
      onProgress?.(done, unique.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, worker));
  return map;
}

// ── Puppeteer browser pool ────────────────────────────────────────────────────
// One warm browser stays alive between PDF requests — no cold-start Chromium per export.
// --disable-dev-shm-usage is the standard fix for Chromium crashing in
// containerized hosts (Render, Docker, CI): /dev/shm is often tiny there
// (frequently 64MB) and Chrome uses it heavily for rendering, so a
// heavier page (more/larger images — e.g. a full roster PDF vs. a single
// call sheet) can crash the whole browser (and take the Node process down
// with it) rather than just rendering slowly. --disable-gpu is the other
// standard companion flag for headless rendering in these environments.
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files', '--disable-dev-shm-usage', '--disable-gpu'];
const browserPool = createPool({
  create:    () => puppeteer.launch({ headless: true, args: BROWSER_ARGS }),
  destroy:   (b) => b.close().catch(() => {}),
  validate:  (b) => Promise.resolve(b.connected),
}, { min: 1, max: 2, idleTimeoutMillis: 60000, acquireTimeoutMillis: 30000, testOnBorrow: true });

// Helper: acquire a browser from the pool, open a page, run fn(page), then clean up.
// If anything goes wrong the browser is destroyed (not returned) so the pool creates a fresh one.
//
// Wrapped in a hard deadline: previously a stuck page.setContent/pdf() call
// (e.g. Puppeteer's networkidle0 wait never settling because a remote image
// fetch stalls instead of cleanly failing) could hang the request forever —
// no error, no timeout, the client's fetch() just waits indefinitely. This
// guarantees SOME response within timeoutMs no matter what's stuck inside.
async function withPage(fn, timeoutMs = 45000) {
  let browser, page;
  const work = (async () => {
    browser = await browserPool.acquire();
    page = await browser.newPage();
    // Puppeteer's own default protocol timeout (30s) is separate from — and
    // was firing well before — our own outer deadline below. Without this,
    // page.pdf() (and any other page operation) errors out at 30s no matter
    // how generous timeoutMs is set to.
    page.setDefaultTimeout(timeoutMs);
    return await fn(page);
  })();
  const deadline = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`PDF generation timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const result = await Promise.race([work, deadline]);
    await page.close().catch(() => {});
    await browserPool.release(browser);
    return result;
  } catch (err) {
    // If `browser` never got assigned, acquire() itself is what's stuck/failed
    // — nothing to close or destroy here, the pool manages that timeout itself.
    if (page) await page.close().catch(() => {});
    if (browser) await browserPool.destroy(browser).catch(() => {});
    throw err;
  }
}

// Waits for every <img> on the page to either finish loading or fail, each
// capped at its own short timeout — used instead of `waitUntil: 'networkidle0'`
// for PDF rendering. networkidle0 requires ALL network activity to go quiet,
// so a single image that stalls (rather than cleanly erroring) — plausible
// now that headshots load from Supabase Storage over the real internet
// instead of instantly from local disk — blocks page.setContent() forever.
// Per-image timeouts mean one bad image just renders broken, not a hung PDF.
// Default raised from 8000ms: with ~195 images on a large roster, the browser's
// per-host connection concurrency limit (~6 simultaneous requests) queues most
// images behind each other. An 8s per-image timer meant most images never got a
// connection slot before giving up, making waitForImages() consistently finish
// in ~8-9s (i.e. nearly every image "gave up" rather than genuinely loaded). A
// longer per-image budget gives queued images realistic time to actually load.
async function waitForImages(page, perImageTimeoutMs = 20000) {
  await page.evaluate((timeoutMs) => {
    const imgs = Array.from(document.images);
    return Promise.all(imgs.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, timeoutMs);
      });
    }));
  }, perImageTimeoutMs);
}

// ── PDF generation jobs ────────────────────────────────────────────────────────
// PDF generation (especially a large roster) can take anywhere from a couple
// seconds to over a minute, and there was previously no way for the frontend
// to show real progress — a click just did nothing visible until the
// download appeared or an error alert popped up. Instead of returning the
// finished PDF directly from the route handler, these routes now: (1) do the
// minimal upfront DB fetch needed to name the file, (2) create a job entry
// and respond immediately with its id, then (3) keep generating in the
// background, updating the job's stage/percent as it goes. The frontend polls
// GET /api/jobs/:id/status for {stage, percent} and, once status is 'done',
// fetches GET /api/jobs/:id/download for the actual file.
//
// This is an in-memory Map, not a persistent queue — fine for a single Render
// instance (no horizontal scaling here) and jobs are short-lived (seconds to
// low minutes). The sweep below guards against a client that starts a job and
// never polls/downloads it (closed tab, network drop) leaking memory forever.
const pdfJobs = new Map(); // jobId -> { status, stage, percent, buffer, filename, error, createdAt }
function createPdfJob(filename) {
  const id = randomUUID();
  pdfJobs.set(id, { status: 'running', stage: 'Starting…', percent: 0, buffer: null, filename, error: null, createdAt: Date.now() });
  return id;
}
function updatePdfJob(id, patch) {
  const job = pdfJobs.get(id);
  if (job) Object.assign(job, patch);
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes is generous for even a slow roster + a distracted user
  for (const [id, job] of pdfJobs) if (job.createdAt < cutoff) pdfJobs.delete(id);
}, 5 * 60 * 1000);

// ── Request helpers ───────────────────────────────────────────────────────────
// supabase-js never throws on query errors — it resolves { data, error } — so
// every call site must check `error` explicitly. `ah()` also catches any
// exceptions thrown inside an async route (e.g. from enrichSheet) so they
// come back as a clean 500 instead of an unhandled rejection.
function ah(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal error' });
    });
  };
}
function checkErr(res, error) {
  if (error) {
    console.error(error);
    res.status(500).json({ error: error.message || String(error) });
    return true;
  }
  return false;
}

// PostgREST (Supabase's REST layer) silently caps any query at 1000 rows
// unless you page through it with .range() — a plain .select() on a table
// with >1000 rows quietly returns only the first 1000, which is exactly the
// kind of bug that a small local SQLite dataset never surfaces but real
// production data (1,367 artists, 1,730 call-sheet assignments, etc.) does.
// `build` must be a function returning a *fresh* query builder each call
// (Supabase builders are single-use once awaited), so this can re-invoke it
// per page with .range() appended.
const PAGE_SIZE = 1000;
async function selectAll(build) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
}

// ── Settings ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  app_director: 'JP van der Merwe',
  app_assistant: 'Mbali Msimanga',
  app_production: 'THE ROAD HOME',
  app_logo_path: '',
};

let _settingsCache = null;
async function getSettings() {
  if (_settingsCache) return _settingsCache;
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw error;
  const s = { ...DEFAULT_SETTINGS };
  (data || []).forEach(r => { s[r.key] = r.value; });
  _settingsCache = s;
  return s;
}
function invalidateSettingsCache() { _settingsCache = null; }

// ── Auth middleware ───────────────────────────────────────────────────────────
// Applied to every /api/* route below. Requires a valid, current Supabase
// user session: the frontend sends the signed-in user's access token as
// `Authorization: Bearer <token>` (see src/api.js), and we verify it against
// Supabase Auth itself (not just decode the JWT) via auth.getUser(token) —
// this also rejects tokens for users that have since been deleted/disabled
// in the Supabase dashboard. There is no public sign-up: only the 3 accounts
// the app owner creates directly in the Supabase dashboard can ever obtain a
// valid token in the first place, so a valid session here is sufficient
// authorization to use the app.
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.user = data.user;
    next();
  } catch (e) {
    console.error('[auth] getUser failed:', e.message);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
app.use('/api', requireAuth);

// Polled by the frontend while a PDF generation job (see "PDF generation
// jobs" above) is in flight, to drive a real progress bar.
app.get('/api/jobs/:id/status', ah(async (req, res) => {
  const job = pdfJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status, stage: job.stage, percent: job.percent, error: job.error });
}));

// Fetched once a job's status is 'done'. 425 ("Too Early") if the caller
// races ahead of the job finishing — the frontend only calls this after
// seeing status:'done', but a stale/duplicate poll shouldn't 404 confusingly.
app.get('/api/jobs/:id/download', ah(async (req, res) => {
  const job = pdfJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'error') return res.status(500).json({ error: job.error || 'PDF generation failed' });
  if (job.status !== 'done') return res.status(425).json({ error: 'Not ready yet' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  res.send(job.buffer);
  pdfJobs.delete(req.params.id); // delivered — free the buffer rather than waiting for the sweep
}));

app.get('/api/settings', ah(async (_req, res) => res.json(await getSettings())));

app.put('/api/settings', ah(async (req, res) => {
  const rows = Object.entries(req.body).map(([key, value]) => ({ key, value: String(value ?? '') }));
  if (rows.length) {
    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (checkErr(res, error)) return;
  }
  invalidateSettingsCache();
  res.json(await getSettings());
}));

app.post('/api/settings/logo', upload.single('logo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const { publicUrl } = await uploadBufferToStorage(req.file.buffer, 'logos', req.file.originalname, req.file.mimetype);
  const { error } = await supabase.from('settings').upsert([{ key: 'app_logo_path', value: publicUrl }], { onConflict: 'key' });
  if (checkErr(res, error)) return;
  invalidateSettingsCache();
  res.json({ path: publicUrl });
}));

// ── Productions ───────────────────────────────────────────────────────────────
app.get('/api/productions', ah(async (_req, res) => {
  const { data, error } = await supabase.from('productions').select('*').order('name');
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.post('/api/productions', ah(async (req, res) => {
  const { name, bg_director, assistant_name, contact_number, email, day_rate } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase.from('productions').insert({
    name: name.trim(), bg_director: bg_director || null, assistant_name: assistant_name || null,
    contact_number: contact_number || null, email: email || null, day_rate: day_rate || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/productions/:id', ah(async (req, res) => {
  const { name, bg_director, assistant_name, contact_number, email, day_rate } = req.body;
  const { data, error } = await supabase.from('productions').update({
    name: name || null, bg_director: bg_director || null, assistant_name: assistant_name || null,
    contact_number: contact_number || null, email: email || null, day_rate: day_rate || null,
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

// ── Agents ────────────────────────────────────────────────────────────────────
app.get('/api/agents', ah(async (_req, res) => {
  const { data, error } = await supabase.from('agents').select('*').order('name');
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.get('/api/roles', ah(async (_req, res) => {
  const { data, error } = await selectAll(() => supabase.from('artists').select('role').order('id')
    .not('role', 'is', null).neq('role', ''));
  if (checkErr(res, error)) return;
  const roles = [...new Set((data || []).map(r => r.role))].sort((a, b) => a.localeCompare(b));
  res.json(roles);
}));

app.post('/api/agents', ah(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const trimmed = name.trim();
  const { data: inserted, error } = await supabase.from('agents').insert({ name: trimmed }).select().single();
  if (!error) return res.status(201).json(inserted);
  const { data: existing, error: err2 } = await supabase.from('agents').select('*').eq('name', trimmed).maybeSingle();
  if (checkErr(res, err2)) return;
  res.json(existing);
}));

// ── Artists ───────────────────────────────────────────────────────────────────
// Duplicate check: original SQL matched
//   LOWER(TRIM(first_name||' '||COALESCE(last_name,''))) = LOWER(?)
// Since first/last are always stored already-trimmed, this is equivalent to a
// case-insensitive exact match on first_name AND last_name independently.
// `.ilike()` with no wildcard characters is a case-insensitive exact match in
// Postgres, so we narrow with that then confirm the last name in JS.
async function findDuplicateArtist(firstName, lastName) {
  const fn = firstName.trim();
  const ln = (lastName || '').trim();
  const { data, error } = await supabase.from('artists').select('id, last_name').ilike('first_name', fn);
  if (error) throw error;
  const match = (data || []).find(r => (r.last_name || '').trim().toLowerCase() === ln.toLowerCase());
  return match || null;
}

async function upsertAgentId(agentName) {
  const trimmed = agentName?.trim();
  if (!trimmed) return null;
  await supabase.from('agents').upsert({ name: trimmed }, { onConflict: 'name', ignoreDuplicates: true });
  const { data } = await supabase.from('agents').select('id').eq('name', trimmed).maybeSingle();
  return data?.id || null;
}

const ARTIST_WRITABLE_FIELDS = [
  'first_name','last_name','agent_name','role','day_rate','fitting_rate','fitting_date','shoot_date',
  'headshot_path','category','phone','email','gender','suburb','notes',
  'chest','waist','hips','inseam','shoe_size','dress_size','jacket_size','shirt_size','trouser_size','hat_size',
];

// GET /api/artists?category=&role=&q=
// `q` is a free-text search across "first last", role, and agent_name — this
// mirrors the original LIKE '%q%' across a concatenated name column, which
// PostgREST's query builder can't express directly (no computed-column
// filters), so we fetch the (optionally category/role-filtered) rows and do
// the substring match in JS. Fine at small/medium roster sizes; if the roster
// ever grows into the tens of thousands this should become a Postgres
// full-text search (or an .rpc() function) instead.
app.get('/api/artists', ah(async (req, res) => {
  const { category, q, role } = req.query;
  const { data, error } = await selectAll(() => {
    let query = supabase.from('artists').select('*').order('id');
    if (category) query = query.eq('category', category);
    if (role) query = query.eq('role', role);
    return query;
  });
  if (checkErr(res, error)) return;
  let rows = data || [];
  if (!role && q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(a => {
      const full = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
      return full.includes(needle) || (a.role || '').toLowerCase().includes(needle) || (a.agent_name || '').toLowerCase().includes(needle);
    });
  }
  rows.sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '') || (a.last_name || '').localeCompare(b.last_name || ''));
  res.json(rows);
}));

app.get('/api/artists/counts', ah(async (_req, res) => {
  const { data, error } = await selectAll(() => supabase.from('artists').select('category').order('id'));
  if (checkErr(res, error)) return;
  const counts = {};
  (data || []).forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });
  counts.total = (data || []).length;
  res.json(counts);
}));

// Returns artists grouped by additional_dates entries of a given type (pencil/fitting/shoot)
app.get('/api/artists/dates-by-type/:type', ah(async (req, res) => {
  const type = req.params.type;
  const { data, error } = await selectAll(() => supabase.from('artists').select('*')
    .not('additional_dates', 'is', null).neq('additional_dates', '[]').neq('additional_dates', '').order('id'));
  if (checkErr(res, error)) return;
  const groups = {};
  (data || []).forEach(artist => {
    let dates = [];
    try { dates = JSON.parse(artist.additional_dates || '[]'); } catch {}
    if (!Array.isArray(dates)) return;
    dates.filter(d => d.type === type).forEach(d => {
      const key = d.date;
      if (!groups[key]) groups[key] = { date: d.date, label: d.label || '', artists: [] };
      if (!groups[key].artists.find(a => a.id === artist.id)) {
        groups[key].artists.push({ ...artist, _date_label: d.label || '' });
      }
    });
  });
  const result = Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  res.json(result);
}));

app.get('/api/artists/export-all', ah(async (req, res) => {
  const { data: rows, error } = await selectAll(() => supabase.from('artists').select('*')
    .order('category').order('first_name').order('last_name').order('id'));
  if (checkErr(res, error)) return;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('All Artists');
  ws.columns = [
    { header: 'Category',     key: 'category',     width: 16 },
    { header: 'First Name',   key: 'first_name',   width: 18 },
    { header: 'Last Name',    key: 'last_name',     width: 18 },
    { header: 'Agent',        key: 'agent_name',   width: 24 },
    { header: 'Role',         key: 'role',         width: 22 },
    { header: 'Gender',       key: 'gender',       width: 10 },
    { header: 'Phone',        key: 'phone',        width: 16 },
    { header: 'Email',        key: 'email',        width: 28 },
    { header: 'Suburb',       key: 'suburb',       width: 18 },
    { header: 'Day Rate',     key: 'day_rate',     width: 12 },
    { header: 'Shoot Date',   key: 'shoot_date',   width: 14 },
    { header: 'Fitting Date', key: 'fitting_date', width: 14 },
    { header: 'Height',       key: 'height',       width: 10 },
    { header: 'Chest',        key: 'chest',        width: 10 },
    { header: 'Waist',        key: 'waist',        width: 10 },
    { header: 'Hips',         key: 'hips',         width: 10 },
    { header: 'Inseam',       key: 'inseam',       width: 10 },
    { header: 'Shoe Size',    key: 'shoe_size',    width: 10 },
    { header: 'Dress Size',   key: 'dress_size',   width: 10 },
    { header: 'Jacket Size',  key: 'jacket_size',  width: 12 },
    { header: 'Hat Size',     key: 'hat_size',     width: 10 },
    { header: 'Notes',        key: 'notes',        width: 30 },
  ];
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FF000000' } };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9A84C' } };
  hdr.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 20;
  const CAT_COLORS = { new:'FFDCE6F1', pencil:'FFFFF2CC', fitting:'FFE2EFDA', shoot:'FFFCE4D6', not_available:'FFFDF2F2' };
  (rows || []).forEach(a => {
    const row = ws.addRow(a);
    const fill = CAT_COLORS[a.category];
    if (fill) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  });
  ws.autoFilter = { from: 'A1', to: 'A1' };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="all-artists.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

app.get('/api/artists/:id', ah(async (req, res) => {
  const { data: artist, error } = await supabase.from('artists').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!artist) return res.status(404).json({ error: 'Not found' });
  res.json(artist);
}));

// Bulk field update — updates any allowed field for a list of artist ids
const BULK_ALLOWED_FIELDS = ['role', 'agent_name', 'day_rate', 'fitting_rate', 'shoot_date', 'fitting_date'];
app.post('/api/artists/bulk-field-update', ah(async (req, res) => {
  const { ids, field, value } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  if (!BULK_ALLOWED_FIELDS.includes(field)) return res.status(400).json({ error: 'field not allowed' });
  const { error } = await supabase.from('artists').update({ [field]: value || null }).in('id', ids);
  if (checkErr(res, error)) return;
  res.json({ ok: true, updated: ids.length });
}));

app.post('/api/artists/bulk-remove-dates', ah(async (req, res) => {
  const { ids, type } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  if (!type) return res.status(400).json({ error: 'type required' });
  let totalRemoved = 0;
  for (const id of ids) {
    const { data: row } = await supabase.from('artists').select('id, additional_dates').eq('id', id).maybeSingle();
    if (!row) continue;
    let existing = [];
    try { existing = JSON.parse(row.additional_dates || '[]'); if (!Array.isArray(existing)) existing = []; } catch {}
    const filtered = existing.filter(d => d.type !== type);
    totalRemoved += existing.length - filtered.length;
    await supabase.from('artists').update({ additional_dates: JSON.stringify(filtered) }).eq('id', id);
  }
  res.json({ ok: true, removed: totalRemoved });
}));

app.post('/api/artists/bulk-add-date', ah(async (req, res) => {
  const { ids, date_entry } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  if (!date_entry?.date) return res.status(400).json({ error: 'date_entry.date required' });
  for (const id of ids) {
    const { data: row } = await supabase.from('artists').select('id, additional_dates').eq('id', id).maybeSingle();
    if (!row) continue;
    let existing = [];
    try { existing = JSON.parse(row.additional_dates || '[]'); if (!Array.isArray(existing)) existing = []; } catch {}
    existing.push(date_entry);
    await supabase.from('artists').update({ additional_dates: JSON.stringify(existing) }).eq('id', id);
  }
  res.json({ ok: true, updated: ids.length });
}));

// Bulk rename role — kept for backwards compat
app.post('/api/artists/bulk-rename-role', ah(async (req, res) => {
  const { ids, role } = req.body;
  if (!Array.isArray(ids) || !role?.trim()) return res.status(400).json({ error: 'ids and role required' });
  const { error } = await supabase.from('artists').update({ role: role.trim() }).in('id', ids);
  if (checkErr(res, error)) return;
  res.json({ ok: true, updated: ids.length });
}));

app.post('/api/artists', ah(async (req, res) => {
  const {
    first_name, last_name, agent_name, role, day_rate, fitting_rate, fitting_date, shoot_date,
    headshot_path, category, phone, email, gender, suburb, notes,
    chest, waist, hips, inseam, shoe_size, dress_size,
    jacket_size, shirt_size, trouser_size, hat_size,
  } = req.body;
  if (!first_name?.trim()) return res.status(400).json({ error: 'first_name required' });

  const existing = await findDuplicateArtist(first_name, last_name);
  if (existing && !req.query.force) {
    return res.status(409).json({ error: 'duplicate', existingId: existing.id });
  }

  const agent_id = await upsertAgentId(agent_name);

  const { data, error } = await supabase.from('artists').insert({
    first_name: first_name.trim(), last_name: last_name?.trim() || null, agent_id, agent_name: agent_name?.trim() || null,
    role: role || null, day_rate: day_rate || null, fitting_rate: fitting_rate || null,
    fitting_date: fitting_date || null, shoot_date: shoot_date || null,
    headshot_path: headshot_path || null, category: category || 'new', phone: phone || null, email: email || null,
    gender: gender || null, suburb: suburb || null, notes: notes || null,
    chest: chest || null, waist: waist || null, hips: hips || null, inseam: inseam || null, shoe_size: shoe_size || null,
    dress_size: dress_size || null, jacket_size: jacket_size || null, shirt_size: shirt_size || null,
    trouser_size: trouser_size || null, hat_size: hat_size || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/artists/:id', ah(async (req, res) => {
  const {
    first_name, last_name, agent_name, role, day_rate, fitting_rate, fitting_date, shoot_date,
    headshot_path, category, phone, email, gender, suburb, notes,
    chest, waist, hips, inseam, shoe_size, dress_size,
    jacket_size, shirt_size, trouser_size, hat_size, additional_dates,
  } = req.body;
  if (!first_name?.trim()) return res.status(400).json({ error: 'first_name required' });

  const agent_id = await upsertAgentId(agent_name);

  const { data, error } = await supabase.from('artists').update({
    first_name: first_name.trim(), last_name: last_name?.trim() || null, agent_id, agent_name: agent_name?.trim() || null,
    role: role || null, day_rate: day_rate || null, fitting_rate: fitting_rate || null,
    fitting_date: fitting_date || null, shoot_date: shoot_date || null,
    headshot_path: headshot_path || null, category: category || 'new', phone: phone || null, email: email || null,
    gender: gender || null, suburb: suburb || null, notes: notes || null,
    // NB: matches original behavior exactly — if additional_dates is omitted
    // from the request body it is reset to null rather than left untouched.
    additional_dates: additional_dates !== undefined ? additional_dates : null,
    chest: chest || null, waist: waist || null, hips: hips || null, inseam: inseam || null, shoe_size: shoe_size || null,
    dress_size: dress_size || null, jacket_size: jacket_size || null, shirt_size: shirt_size || null,
    trouser_size: trouser_size || null, hat_size: hat_size || null,
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/artists/:id', ah(async (req, res) => {
  const { error } = await supabase.from('artists').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.post('/api/artists/:id/headshot', upload.single('headshot'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const { data: artist } = await supabase.from('artists').select('headshot_path').eq('id', req.params.id).maybeSingle();
  const { publicUrl } = await uploadBufferToStorage(req.file.buffer, 'headshots', req.file.originalname, req.file.mimetype);
  const { error } = await supabase.from('artists').update({ headshot_path: publicUrl }).eq('id', req.params.id);
  if (checkErr(res, error)) return;
  if (artist?.headshot_path) await deleteFromStorageByUrl(artist.headshot_path);
  res.json({ headshot_path: publicUrl });
}));

app.post('/api/artists/:id/duplicate', ah(async (req, res) => {
  const { data: src, error: srcErr } = await supabase.from('artists').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, srcErr)) return;
  if (!src) return res.status(404).json({ error: 'Not found' });
  const newRole = req.body.role !== undefined ? req.body.role : src.role;
  const { data, error } = await supabase.from('artists').insert({
    first_name: src.first_name, last_name: src.last_name, agent_id: src.agent_id, agent_name: src.agent_name,
    role: newRole || null, day_rate: src.day_rate, fitting_date: src.fitting_date, shoot_date: src.shoot_date,
    headshot_path: src.headshot_path, category: src.category || 'new', phone: src.phone, email: src.email,
    gender: src.gender, suburb: src.suburb, notes: src.notes,
    chest: src.chest, waist: src.waist, hips: src.hips, inseam: src.inseam, shoe_size: src.shoe_size,
    dress_size: src.dress_size, jacket_size: src.jacket_size, shirt_size: src.shirt_size,
    trouser_size: src.trouser_size, hat_size: src.hat_size,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

// Bulk category update
app.post('/api/artists/bulk-category', ah(async (req, res) => {
  const { ids, category } = req.body;
  if (!ids?.length || !category) return res.status(400).json({ error: 'ids and category required' });
  const { error } = await supabase.from('artists').update({ category }).in('id', ids);
  if (checkErr(res, error)) return;
  if (category === 'shoot') {
    const { data: fittingSheets } = await supabase.from('call_sheets').select('id').eq('type', 'fitting');
    const fittingIds = (fittingSheets || []).map(s => s.id);
    if (fittingIds.length) {
      await supabase.from('call_sheet_artists').delete().in('artist_id', ids).in('call_sheet_id', fittingIds);
    }
  }
  res.json({ ok: true, count: ids.length });
}));

// Bulk field update
app.post('/api/artists/bulk-update', ah(async (req, res) => {
  const { ids, fields } = req.body;
  if (!ids?.length || !fields) return res.status(400).json({ error: 'ids and fields required' });
  const allowed = ['role','agent_name','day_rate','fitting_date','shoot_date','category'];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return res.status(400).json({ error: 'No valid fields' });
  const obj = {};
  keys.forEach(k => { obj[k] = fields[k] || null; });
  const { error } = await supabase.from('artists').update(obj).in('id', ids);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// Excel template download
app.get('/api/artists/template', ah(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Artists');
  ws.columns = [
    { header: 'First Name', key: 'first_name', width: 18 },
    { header: 'Last Name', key: 'last_name', width: 18 },
    { header: 'Agent', key: 'agent_name', width: 24 },
    { header: 'Role', key: 'role', width: 22 },
    { header: 'Shoot Date', key: 'shoot_date', width: 14 },
    { header: 'Day Rate', key: 'day_rate', width: 12 },
    { header: 'Fitting Date', key: 'fitting_date', width: 14 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Gender', key: 'gender', width: 10 },
    { header: 'Suburb', key: 'suburb', width: 18 },
  ];
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } };
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="artists-import-template.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

// Excel import
app.post('/api/artists/import-excel', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const headers = [];
  ws.getRow(1).eachCell(cell => headers.push(String(cell.value||'').toLowerCase().replace(/\s+/g,'_')));

  // Materialize rows first (can't await inside ExcelJS's synchronous eachRow callback)
  const dataRows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const data = {};
    row.eachCell((cell, ci) => { data[headers[ci-1]] = cell.value != null ? String(cell.value) : null; });
    dataRows.push(data);
  });

  const created = [];
  const duplicates = [];
  for (const data of dataRows) {
    if (!data.first_name?.trim()) continue;
    const existing = await findDuplicateArtist(data.first_name, data.last_name || '');
    if (existing) { duplicates.push({ ...data, existingId: existing.id }); continue; }
    const agent_id = await upsertAgentId(data.agent_name);
    const { data: inserted, error } = await supabase.from('artists').insert({
      first_name: data.first_name.trim(), last_name: data.last_name?.trim() || null, agent_id,
      agent_name: data.agent_name?.trim() || null, role: data.role || null, day_rate: data.day_rate || null,
      fitting_date: data.fitting_date || null, shoot_date: data.shoot_date || null,
      phone: data.phone || null, email: data.email || null, gender: data.gender || null,
      suburb: data.suburb || null, category: 'new',
    }).select().single();
    if (error) { console.error(error); continue; }
    created.push(inserted);
  }
  res.json({ created, duplicates });
}));

// Per-category Excel export
app.get('/api/artists/export/:category', ah(async (req, res) => {
  const cat = req.params.category;
  const { data: rows, error } = await supabase.from('artists').select('*').eq('category', cat)
    .order('first_name').order('last_name');
  if (checkErr(res, error)) return;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(cat);
  ws.columns = [
    { header: 'First Name', key: 'first_name', width: 18 },
    { header: 'Last Name', key: 'last_name', width: 18 },
    { header: 'Agent', key: 'agent_name', width: 24 },
    { header: 'Role', key: 'role', width: 22 },
    { header: 'Shoot Date', key: 'shoot_date', width: 14 },
    { header: 'Day Rate', key: 'day_rate', width: 12 },
    { header: 'Fitting Date', key: 'fitting_date', width: 14 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Gender', key: 'gender', width: 10 },
  ];
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } };
  (rows || []).forEach(a => ws.addRow(a));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="${cat}-artists.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

// ── Pencil Dates ──────────────────────────────────────────────────────────────
app.get('/api/pencil-dates', ah(async (_req, res) => {
  const { data: pds, error: pErr } = await supabase.from('pencil_dates').select('*').order('date').order('name');
  if (checkErr(res, pErr)) return;
  const { data: assignmentsRaw, error: aErr } = await supabase.from('pencil_date_artists')
    .select('pencil_date_id, artist_id, artists(*)');
  if (checkErr(res, aErr)) return;
  const assignments = (assignmentsRaw || []).map(row => ({
    pencil_date_id: row.pencil_date_id, artist_id: row.artist_id, ...(row.artists || {}),
  }));
  const byDate = new Map();
  assignments.forEach(a => {
    if (!byDate.has(a.pencil_date_id)) byDate.set(a.pencil_date_id, []);
    byDate.get(a.pencil_date_id).push(a);
  });
  res.json((pds || []).map(pd => ({ ...pd, artists: byDate.get(pd.id) || [] })));
}));

app.post('/api/pencil-dates', ah(async (req, res) => {
  const { name, date, production_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase.from('pencil_dates')
    .insert({ name: name.trim(), date: date || null, production_id: production_id || null }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json({ ...data, artists: [] });
}));

app.put('/api/pencil-dates/:id', ah(async (req, res) => {
  const { name, date } = req.body;
  const { data, error } = await supabase.from('pencil_dates')
    .update({ name: name || null, date: date || null }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/pencil-dates/:id', ah(async (req, res) => {
  const { error } = await supabase.from('pencil_dates').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.post('/api/pencil-dates/:id/artists', ah(async (req, res) => {
  const { artist_ids } = req.body;
  if (!artist_ids?.length) return res.status(400).json({ error: 'artist_ids required' });
  const rows = artist_ids.map(aid => ({ pencil_date_id: Number(req.params.id), artist_id: aid }));
  const { error } = await supabase.from('pencil_date_artists')
    .upsert(rows, { onConflict: 'pencil_date_id,artist_id', ignoreDuplicates: true });
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.delete('/api/pencil-dates/:id/artists/:artist_id', ah(async (req, res) => {
  const { error } = await supabase.from('pencil_date_artists')
    .delete().eq('pencil_date_id', req.params.id).eq('artist_id', req.params.artist_id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// ── Call Sheets ───────────────────────────────────────────────────────────────
const CSA_ARTIST_FIELDS = 'first_name,last_name,agent_name,role,day_rate,fitting_rate,shoot_date,fitting_date,headshot_path,phone,email,gender,category,additional_dates';

function flattenCsaRow(row) {
  const { artists, ...rest } = row;
  return { ...rest, ...(artists || {}) };
}

app.get('/api/call-sheets', ah(async (req, res) => {
  const { type } = req.query;
  let query = supabase.from('call_sheets').select('*');
  if (type) query = query.eq('type', type);
  query = query.order('created_at', { ascending: false });
  const { data: sheets, error } = await query;
  if (checkErr(res, error)) return;
  if (!sheets.length) return res.json([]);

  const ids = sheets.map(s => s.id);
  const [{ data: allBanners, error: bErr }, { data: allArtistsRaw, error: aErr }] = await Promise.all([
    selectAll(() => supabase.from('banners').select('*').in('call_sheet_id', ids).order('sort_order').order('id')),
    selectAll(() => supabase.from('call_sheet_artists').select(`*, artists(${CSA_ARTIST_FIELDS})`).in('call_sheet_id', ids).order('id')),
  ]);
  if (checkErr(res, bErr) || checkErr(res, aErr)) return;

  const allArtists = allArtistsRaw.map(flattenCsaRow);
  allArtists.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.first_name || '').localeCompare(b.first_name || ''));

  const bannersBySheet = {};
  const artistsBySheet = {};
  allBanners.forEach(b => { (bannersBySheet[b.call_sheet_id] ||= []).push(b); });
  allArtists.forEach(a => { (artistsBySheet[a.call_sheet_id] ||= []).push(a); });

  res.json(sheets.map(s => {
    let col_vis = {};
    try { col_vis = JSON.parse(s.column_visibility || '{}'); } catch {}
    return { ...s, column_visibility: col_vis, banners: bannersBySheet[s.id] || [], artists: artistsBySheet[s.id] || [] };
  }));
}));

app.get('/api/call-sheets/footer-notes', ah(async (_req, res) => {
  const { data, error } = await supabase.from('call_sheets').select('footer_note')
    .not('footer_note', 'is', null).neq('footer_note', '');
  if (checkErr(res, error)) return;
  const notes = [...new Set((data || []).map(r => r.footer_note))].sort((a, b) => a.localeCompare(b));
  res.json(notes);
}));

app.get('/api/call-sheets/:id', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  res.json(await enrichSheet(sheet));
}));

async function enrichSheet(sheet) {
  const [{ data: banners, error: bErr }, { data: artistsRaw, error: aErr }] = await Promise.all([
    supabase.from('banners').select('*').eq('call_sheet_id', sheet.id).order('sort_order').order('id'),
    supabase.from('call_sheet_artists').select(`*, artists(${CSA_ARTIST_FIELDS})`).eq('call_sheet_id', sheet.id),
  ]);
  if (bErr) throw bErr;
  if (aErr) throw aErr;
  const artists = artistsRaw.map(flattenCsaRow)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.first_name || '').localeCompare(b.first_name || ''));
  let col_vis = {};
  try { col_vis = JSON.parse(sheet.column_visibility || '{}'); } catch {}
  return { ...sheet, column_visibility: col_vis, banners: banners || [], artists };
}

app.post('/api/call-sheets', ah(async (req, res) => {
  const { type, title, date, location, director_name, assistant_name, logo_path, footer_note, production_id } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  const S = await getSettings();
  const { data, error } = await supabase.from('call_sheets').insert({
    type, title: title || null, date: date || null, location: location || null,
    director_name: director_name || S.app_director || null,
    assistant_name: assistant_name || S.app_assistant || null,
    logo_path: logo_path || S.app_logo_path || null,
    footer_note: footer_note || null, production_id: production_id || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(await enrichSheet(data));
}));

app.put('/api/call-sheets/:id', ah(async (req, res) => {
  const { title, date, location, director_name, assistant_name, logo_path, footer_note, column_visibility } = req.body;
  const { data, error } = await supabase.from('call_sheets').update({
    title: title || null, date: date || null, location: location || null,
    director_name: director_name || null, assistant_name: assistant_name || null,
    logo_path: logo_path || null, footer_note: footer_note || null,
    column_visibility: JSON.stringify(column_visibility || {}),
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(await enrichSheet(data));
}));

// Promote fitting call sheet → shoot (changes type + moves all artists to shoot category)
app.post('/api/call-sheets/:id/promote-to-shoot', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  const { data: csaRows, error: csaErr } = await supabase.from('call_sheet_artists').select('artist_id').eq('call_sheet_id', sheet.id);
  if (checkErr(res, csaErr)) return;
  const artistIds = (csaRows || []).map(r => r.artist_id);
  const { error: updErr } = await supabase.from('call_sheets').update({ type: 'shoot' }).eq('id', sheet.id);
  if (checkErr(res, updErr)) return;
  if (artistIds.length) {
    const { error: catErr } = await supabase.from('artists').update({ category: 'shoot' }).in('id', artistIds);
    if (checkErr(res, catErr)) return;
  }
  const { data: updatedSheet, error: reErr } = await supabase.from('call_sheets').select('*').eq('id', sheet.id).single();
  if (checkErr(res, reErr)) return;
  res.json(await enrichSheet(updatedSheet));
}));

// Promote pencil call sheet → fitting (changes type + moves all artists to fitting category)
app.post('/api/call-sheets/:id/promote-to-fitting', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  const { data: csaRows, error: csaErr } = await supabase.from('call_sheet_artists').select('artist_id').eq('call_sheet_id', sheet.id);
  if (checkErr(res, csaErr)) return;
  const artistIds = (csaRows || []).map(r => r.artist_id);
  const { error: updErr } = await supabase.from('call_sheets').update({ type: 'fitting' }).eq('id', sheet.id);
  if (checkErr(res, updErr)) return;
  if (artistIds.length) {
    const { error: catErr } = await supabase.from('artists').update({ category: 'fitting' }).in('id', artistIds);
    if (checkErr(res, catErr)) return;
  }
  const { data: updatedSheet, error: reErr } = await supabase.from('call_sheets').select('*').eq('id', sheet.id).single();
  if (checkErr(res, reErr)) return;
  res.json(await enrichSheet(updatedSheet));
}));

app.delete('/api/call-sheets/:id', ah(async (req, res) => {
  const { error } = await supabase.from('call_sheets').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// ── Banners ───────────────────────────────────────────────────────────────────
app.post('/api/call-sheets/:id/banners', ah(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase.from('banners')
    .insert({ call_sheet_id: req.params.id, name: name.trim().toUpperCase(), sort_order: sort_order || 0 })
    .select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/banners/:id', ah(async (req, res) => {
  const { name, sort_order } = req.body;
  const { data, error } = await supabase.from('banners')
    .update({ name: name?.trim().toUpperCase() || null, sort_order: sort_order ?? 0 })
    .eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/banners/:id', ah(async (req, res) => {
  const { error } = await supabase.from('banners').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// ── Call Sheet Artists ─────────────────────────────────────────────────────────
app.post('/api/call-sheets/:id/artists', ah(async (req, res) => {
  const { artist_ids, banner_id } = req.body;
  if (!artist_ids?.length) return res.status(400).json({ error: 'artist_ids required' });
  const { data: sheet, error: sErr } = await supabase.from('call_sheets').select('type').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, sErr)) return;

  const rows = artist_ids.map(aid => ({ call_sheet_id: Number(req.params.id), artist_id: aid, banner_id: banner_id || null }));
  const { error: insErr } = await supabase.from('call_sheet_artists')
    .upsert(rows, { onConflict: 'call_sheet_id,artist_id', ignoreDuplicates: true });
  if (checkErr(res, insErr)) return;

  if (sheet?.type) {
    const { error: catErr } = await supabase.from('artists').update({ category: sheet.type }).in('id', artist_ids);
    if (checkErr(res, catErr)) return;
  }
  if (sheet?.type === 'shoot') {
    const { data: fittingSheets } = await supabase.from('call_sheets').select('id').eq('type', 'fitting');
    const fittingIds = (fittingSheets || []).map(s => s.id);
    if (fittingIds.length) {
      await supabase.from('call_sheet_artists').delete().in('artist_id', artist_ids).in('call_sheet_id', fittingIds);
    }
  }
  res.json({ ok: true });
}));

app.put('/api/call-sheets/:id/artists/:artist_id', ah(async (req, res) => {
  const { call_time, report_to, pickup_time, pickup_point, notes, banner_id } = req.body;
  const { error } = await supabase.from('call_sheet_artists').update({
    call_time: call_time || null, report_to: report_to || null, pickup_time: pickup_time || null,
    pickup_point: pickup_point || null, notes: notes || null, banner_id: banner_id || null,
  }).eq('call_sheet_id', req.params.id).eq('artist_id', req.params.artist_id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.delete('/api/call-sheets/:id/artists/:artist_id', ah(async (req, res) => {
  const { error } = await supabase.from('call_sheet_artists')
    .delete().eq('call_sheet_id', req.params.id).eq('artist_id', req.params.artist_id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// Bulk update call sheet artists (copy-to-all)
app.post('/api/call-sheets/:id/artists/bulk-update', ah(async (req, res) => {
  const { artist_ids, fields } = req.body;
  const allowed = ['call_time','report_to','pickup_time','pickup_point','notes','banner_id'];
  const keys = Object.keys(fields || {}).filter(k => allowed.includes(k));
  if (!keys.length) return res.status(400).json({ error: 'No valid fields' });
  const obj = {};
  keys.forEach(k => { obj[k] = fields[k] || null; });
  let query = supabase.from('call_sheet_artists').update(obj).eq('call_sheet_id', req.params.id);
  if (artist_ids?.length) query = query.in('artist_id', artist_ids);
  const { error } = await query;
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// Move artists from source sheet to target sheet, preserving banner by name
// NOTE: this is an inherently sequential, multi-step operation per artist
// (look up source banner → find/create matching banner on target → upsert →
// delete from source → possibly clean up fitting sheets). The original ran
// all of this inside one SQLite transaction so a failure partway rolled
// everything back; Postgres/Supabase-js has no equivalent multi-statement
// client-side transaction here, so a failure partway through a large
// `artist_ids` batch could leave some artists moved and others not. Flagging
// this for review — fine for typical batch sizes (a handful of artists) but
// worth knowing about.
app.post('/api/call-sheets/:targetId/move-from/:sourceId', ah(async (req, res) => {
  const { targetId, sourceId } = req.params;
  const { artist_ids } = req.body;
  if (!artist_ids?.length) return res.status(400).json({ error: 'artist_ids required' });
  const { data: targetSheet, error: tErr } = await supabase.from('call_sheets').select('type').eq('id', targetId).maybeSingle();
  if (checkErr(res, tErr)) return;

  const targetBannerCache = {};
  async function getOrCreateBanner(name) {
    if (!name) return null;
    if (targetBannerCache[name] !== undefined) return targetBannerCache[name];
    const { data: existing } = await supabase.from('banners').select('id').eq('call_sheet_id', targetId).eq('name', name).maybeSingle();
    if (existing) { targetBannerCache[name] = existing.id; return existing.id; }
    const { data: created, error } = await supabase.from('banners')
      .insert({ call_sheet_id: targetId, name, sort_order: 999 }).select().single();
    if (error) throw error;
    targetBannerCache[name] = created.id;
    return created.id;
  }

  let fittingIds = null; // lazily fetched only if needed

  for (const aid of artist_ids) {
    const { data: src } = await supabase.from('call_sheet_artists').select('banner_id').eq('call_sheet_id', sourceId).eq('artist_id', aid).maybeSingle();
    let targetBannerId = null;
    if (src?.banner_id) {
      const { data: srcBanner } = await supabase.from('banners').select('name').eq('id', src.banner_id).maybeSingle();
      if (srcBanner?.name) targetBannerId = await getOrCreateBanner(srcBanner.name);
    }
    // Upsert (insert if missing, update banner_id if it already exists on target)
    await supabase.from('call_sheet_artists')
      .upsert({ call_sheet_id: targetId, artist_id: aid, banner_id: targetBannerId }, { onConflict: 'call_sheet_id,artist_id' });
    await supabase.from('call_sheet_artists').delete().eq('call_sheet_id', sourceId).eq('artist_id', aid);
    if (targetSheet?.type) {
      await supabase.from('artists').update({ category: targetSheet.type }).eq('id', aid);
    }
    if (targetSheet?.type === 'shoot') {
      if (fittingIds === null) {
        const { data: fittingSheets } = await supabase.from('call_sheets').select('id').eq('type', 'fitting');
        fittingIds = (fittingSheets || []).map(s => s.id);
      }
      if (fittingIds.length) {
        await supabase.from('call_sheet_artists').delete().eq('artist_id', aid).in('call_sheet_id', fittingIds);
      }
    }
  }

  res.json({ ok: true });
}));

// ── Fitting Dates ─────────────────────────────────────────────────────────────
app.get('/api/fitting-dates', ah(async (_req, res) => {
  const { data, error } = await supabase.from('fitting_dates').select('*').order('date').order('day_number');
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.post('/api/fitting-dates', ah(async (req, res) => {
  const { day_number, date, name, production_id } = req.body;
  const { data, error } = await supabase.from('fitting_dates').insert({
    day_number: day_number || null, date: date || null, name: name || null, production_id: production_id || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/fitting-dates/:id', ah(async (req, res) => {
  const { day_number, date, name, call_sheet_id } = req.body;
  const { data, error } = await supabase.from('fitting_dates').update({
    day_number: day_number || null, date: date || null, name: name || null, call_sheet_id: call_sheet_id || null,
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/fitting-dates/:id', ah(async (req, res) => {
  const { error } = await supabase.from('fitting_dates').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// ── Shoot Days ────────────────────────────────────────────────────────────────
app.get('/api/shoot-days', ah(async (_req, res) => {
  const { data, error } = await supabase.from('shoot_days').select('*').order('date').order('day_number');
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.post('/api/shoot-days', ah(async (req, res) => {
  const { day_number, date, name, production_id } = req.body;
  const { data, error } = await supabase.from('shoot_days').insert({
    day_number: day_number || null, date: date || null, name: name || null, production_id: production_id || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/shoot-days/:id', ah(async (req, res) => {
  const { day_number, date, name, call_sheet_id } = req.body;
  const { data, error } = await supabase.from('shoot_days').update({
    day_number: day_number || null, date: date || null, name: name || null, call_sheet_id: call_sheet_id || null,
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/shoot-days/:id', ah(async (req, res) => {
  const { error } = await supabase.from('shoot_days').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// ── Briefs ────────────────────────────────────────────────────────────────────
app.get('/api/briefs', ah(async (_req, res) => {
  // List view only needs a few small fields to render — select('*') was
  // pulling every column including mood_board_images/scene_description/
  // costume_requirements/hair_makeup/restrictions for every row, which is
  // what made this feel slow even with only a handful of briefs. The full
  // record is fetched separately (below) when a brief is actually opened.
  const { data, error } = await supabase.from('briefs').select('id, role_name, created_at, scene_description').order('created_at', { ascending: false });
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.get('/api/briefs/:id', ah(async (req, res) => {
  const { data: brief, error } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!brief) return res.status(404).json({ error: 'Not found' });
  try { brief.mood_board_images = JSON.parse(brief.mood_board_images || '[]'); } catch { brief.mood_board_images = []; }
  try { brief.restrictions = JSON.parse(brief.restrictions || '{}'); } catch { brief.restrictions = {}; }
  res.json(brief);
}));

app.post('/api/briefs', ah(async (req, res) => {
  const { production_id, role_name, age_from, age_to, gender, race,
    height_requirements, costume_requirements, hair_makeup, restrictions,
    scene_description, fitting_dates, shoot_dates, role_rate, fitting_rate, mood_board_images } = req.body;
  const { data, error } = await supabase.from('briefs').insert({
    production_id: production_id || null, role_name: role_name || null, age_from: age_from || null, age_to: age_to || null,
    gender: gender || null, race: race || null, height_requirements: height_requirements || null,
    costume_requirements: costume_requirements || null, hair_makeup: hair_makeup || null,
    restrictions: JSON.stringify(restrictions || {}), scene_description: scene_description || null,
    fitting_dates: fitting_dates || null, shoot_dates: shoot_dates || null,
    role_rate: role_rate || null, fitting_rate: fitting_rate || null,
    mood_board_images: JSON.stringify(mood_board_images || []),
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/briefs/:id', ah(async (req, res) => {
  const { production_id, role_name, age_from, age_to, gender, race,
    height_requirements, costume_requirements, hair_makeup, restrictions,
    scene_description, fitting_dates, shoot_dates, role_rate, fitting_rate, mood_board_images } = req.body;
  const { data, error } = await supabase.from('briefs').update({
    production_id: production_id || null, role_name: role_name || null, age_from: age_from || null, age_to: age_to || null,
    gender: gender || null, race: race || null, height_requirements: height_requirements || null,
    costume_requirements: costume_requirements || null, hair_makeup: hair_makeup || null,
    restrictions: JSON.stringify(restrictions || {}), scene_description: scene_description || null,
    fitting_dates: fitting_dates || null, shoot_dates: shoot_dates || null,
    role_rate: role_rate || null, fitting_rate: fitting_rate || null,
    mood_board_images: JSON.stringify(mood_board_images || []),
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/briefs/:id', ah(async (req, res) => {
  const { error } = await supabase.from('briefs').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.post('/api/briefs/:id/moodboard', upload.array('images', 20), ah(async (req, res) => {
  const { data: brief, error } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!brief) return res.status(404).json({ error: 'Not found' });
  let existing = [];
  try { existing = JSON.parse(brief.mood_board_images || '[]'); } catch {}
  const uploaded = await Promise.all((req.files || []).map(f => uploadBufferToStorage(f.buffer, 'moodboards', f.originalname, f.mimetype)));
  const merged = [...existing, ...uploaded.map(u => u.publicUrl)];
  const { error: updErr } = await supabase.from('briefs').update({ mood_board_images: JSON.stringify(merged) }).eq('id', req.params.id);
  if (checkErr(res, updErr)) return;
  res.json({ mood_board_images: merged });
}));

// ── Roles To Fit ──────────────────────────────────────────────────────────────
// The original endpoint was a single SQL query joining roles_to_fit → artists
// (matched by case-insensitive/trimmed role name) → call_sheet_artists →
// call_sheets, with three COUNT(DISTINCT CASE WHEN ...) aggregates. That kind
// of cross-table conditional aggregate isn't expressible through the
// supabase-js query builder, and rather than reach for a bespoke .rpc()
// function, this fetches the four small tables involved and reproduces the
// exact join/aggregation logic in JS below. This is the most complex piece of
// translated logic in the file — worth a human double-checking against real
// data (in particular the "unassigned_shoot" definition: a matched artist
// whose category is 'shoot' AND who has zero call_sheet_artists rows at all).
app.get('/api/roles-to-fit', ah(async (_req, res) => {
  const [{ data: rtfRows, error: e1 }, { data: artistRows, error: e2 }, { data: csaRows, error: e3 }, { data: csRows, error: e4 }] = await Promise.all([
    selectAll(() => supabase.from('roles_to_fit').select('*').order('id')),
    selectAll(() => supabase.from('artists').select('id, role, category').order('id')),
    selectAll(() => supabase.from('call_sheet_artists').select('artist_id, call_sheet_id').order('id')),
    selectAll(() => supabase.from('call_sheets').select('id, type').order('id')),
  ]);
  if (checkErr(res, e1) || checkErr(res, e2) || checkErr(res, e3) || checkErr(res, e4)) return;

  const csTypeById = new Map((csRows || []).map(cs => [cs.id, cs.type]));
  const typesByArtist = new Map(); // artist_id -> Set<call_sheet type>
  const hasAnyCsa = new Set();
  (csaRows || []).forEach(csa => {
    hasAnyCsa.add(csa.artist_id);
    const type = csTypeById.get(csa.call_sheet_id);
    if (!type) return;
    if (!typesByArtist.has(csa.artist_id)) typesByArtist.set(csa.artist_id, new Set());
    typesByArtist.get(csa.artist_id).add(type);
  });

  const norm = s => (s || '').trim().toLowerCase();
  const artistsByRole = new Map();
  (artistRows || []).forEach(a => {
    const key = norm(a.role);
    if (!artistsByRole.has(key)) artistsByRole.set(key, []);
    artistsByRole.get(key).push(a);
  });

  const rows = (rtfRows || []).map(rtf => {
    const matched = artistsByRole.get(norm(rtf.role_name)) || [];
    let in_fittings = 0, in_shoots = 0, unassigned_shoot = 0;
    matched.forEach(a => {
      const types = typesByArtist.get(a.id);
      if (types?.has('fitting')) in_fittings++;
      if (types?.has('shoot')) in_shoots++;
      if (a.category === 'shoot' && !hasAnyCsa.has(a.id)) unassigned_shoot++;
    });
    return { ...rtf, in_fittings, in_shoots, unassigned_shoot };
  });

  rows.sort((a, b) => (a.shoot_date || '').localeCompare(b.shoot_date || '') || (a.role_name || '').localeCompare(b.role_name || ''));
  res.json(rows);
}));

app.post('/api/roles-to-fit', ah(async (req, res) => {
  const { role_name, quantity_needed, shoot_date, notes } = req.body;
  if (!role_name?.trim()) return res.status(400).json({ error: 'role_name required' });
  const { data, error } = await supabase.from('roles_to_fit').insert({
    role_name: role_name.trim().toUpperCase(), quantity_needed: parseInt(quantity_needed) || 1,
    shoot_date: shoot_date || null, notes: notes || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/roles-to-fit/:id', ah(async (req, res) => {
  const { role_name, quantity_needed, shoot_date, notes } = req.body;
  const { data, error } = await supabase.from('roles_to_fit').update({
    role_name: (role_name || '').trim().toUpperCase(), quantity_needed: parseInt(quantity_needed) || 1,
    shoot_date: shoot_date || null, notes: notes || null,
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/roles-to-fit/:id', ah(async (req, res) => {
  const { error } = await supabase.from('roles_to_fit').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// ── Calendar ──────────────────────────────────────────────────────────────────
app.get('/api/calendar', ah(async (_req, res) => {
  const { data: allSheets, error } = await supabase.from('call_sheets').select('*').not('date', 'is', null).order('date');
  if (checkErr(res, error)) return;
  if (!allSheets.length) return res.json([]);

  const ids = allSheets.map(s => s.id);
  const CAL_ARTIST_FIELDS = 'id,first_name,last_name,agent_name,role,phone,email,headshot_path,day_rate,fitting_rate,category';
  const [{ data: allBanners, error: bErr }, { data: allArtistsRaw, error: aErr }] = await Promise.all([
    selectAll(() => supabase.from('banners').select('*').in('call_sheet_id', ids).order('sort_order').order('id')),
    selectAll(() => supabase.from('call_sheet_artists')
      .select(`call_sheet_id,banner_id,call_time,report_to,pickup_point,pickup_time,notes,artists(${CAL_ARTIST_FIELDS})`)
      .in('call_sheet_id', ids).order('call_sheet_id').order('artist_id')),
  ]);
  if (checkErr(res, bErr) || checkErr(res, aErr)) return;

  const allArtists = allArtistsRaw.map(row => {
    const { artists, ...rest } = row;
    return { ...rest, ...(artists || {}) };
  });
  // Original ordered by "a.role NULLS LAST, a.first_name" — approximated here by
  // pushing blank/null roles to the end explicitly rather than relying on
  // locale-compare ordering of empty strings.
  allArtists.sort((a, b) => {
    const ra = a.role || '', rb = b.role || '';
    if (!ra && rb) return 1;
    if (ra && !rb) return -1;
    return ra.localeCompare(rb) || (a.first_name || '').localeCompare(b.first_name || '');
  });

  const bannersBySheet = {};
  const artistsBySheet = {};
  allBanners.forEach(b => { (bannersBySheet[b.call_sheet_id] ||= []).push(b); });
  allArtists.forEach(a => { (artistsBySheet[a.call_sheet_id] ||= []).push(a); });

  const events = allSheets.map(cs => {
    const banners = bannersBySheet[cs.id] || [];
    const artists = artistsBySheet[cs.id] || [];
    const bannerGroups = banners.map(b => ({
      id: b.id,
      name: b.name,
      artists: artists.filter(a => a.banner_id === b.id),
    })).filter(g => g.artists.length > 0);
    const banneredIds = new Set(artists.filter(a => a.banner_id).map(a => a.id));
    const ungrouped = artists.filter(a => !banneredIds.has(a.id));
    return {
      id: `cs-${cs.id}`,
      type: cs.type,
      date: cs.date,
      name: cs.title || `${cs.type} Call Sheet #${cs.id}`,
      call_sheet_id: cs.id,
      bannerGroups,
      ungrouped,
    };
  });
  res.json(events);
}));

// ── Call Sheet PDF Export ──────────────────────────────────────────────────────
function buildCallSheetHTML(sheet, type, S) {
  const logoUrl = resolveImageUrl(sheet.logo_path || S.app_logo_path);
  const banners = sheet.banners || [];
  const allArtists = sheet.artists || [];

  const dayOfWeek = sheet.date
    ? ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date(sheet.date + 'T00:00:00').getDay()]
    : '';

  const isShoot   = type === 'shoot';
  const isFitting = type === 'fitting';

  const hasPickup   = a => isShoot && ((a.pickup_point||'').trim() || (a.pickup_time||'').trim());
  const hasReportTo = a => isShoot && (a.report_to||'').trim() && !hasPickup(a);
  const pickupArtists   = allArtists.filter(hasPickup);
  const reportToArtists = allArtists.filter(hasReportTo);
  const regularArtists  = allArtists.filter(a => !hasPickup(a) && !hasReportTo(a));

  const sortTime = t => {
    if (!t) return 9999;
    const cleaned = t.replace(':','').trim();
    return /^\d+$/.test(cleaned) ? parseInt(cleaned, 10) : 9999;
  };

  const buildSubGroupsFor = (artistList) => {
    if (!artistList.length) return [];
    const bannerIds = [...new Set(artistList.map(a => a.banner_id))];
    const groups = bannerIds.map(bid => ({
      banner: banners.find(b => b.id === bid) || null,
      artists: artistList.filter(a => a.banner_id === bid)
        .sort((a, b) => `${a.first_name} ${a.last_name||''}`.localeCompare(`${b.first_name} ${b.last_name||''}`)),
    }));
    return [
      ...banners.filter(b => groups.find(g => g.banner?.id === b.id)).map(b => groups.find(g => g.banner?.id === b.id)),
      ...groups.filter(g => !g.banner),
    ];
  };

  const pickupTimeGroups = (() => {
    if (!pickupArtists.length) return [];
    const times = [...new Set(pickupArtists.map(a => a.pickup_time||''))].sort((a,b) => sortTime(a) - sortTime(b));
    return times.map(time => {
      const inTime = pickupArtists.filter(a => (a.pickup_time||'') === time);
      const bannerIds = [...new Set(inTime.map(a => a.banner_id))];
      const subGroups = bannerIds.map(bid => ({
        banner: banners.find(b => b.id === bid) || null,
        artists: inTime.filter(a => a.banner_id === bid).sort((a, b) => {
          const aS = (a.pickup_point ? 2 : 0) + (a.pickup_time ? 1 : 0);
          const bS = (b.pickup_point ? 2 : 0) + (b.pickup_time ? 1 : 0);
          return bS - aS || `${a.first_name} ${a.last_name||''}`.localeCompare(`${b.first_name} ${b.last_name||''}`);
        }),
      }));
      return {
        time,
        subGroups: [
          ...banners.filter(b => subGroups.find(g => g.banner?.id === b.id)).map(b => subGroups.find(g => g.banner?.id === b.id)),
          ...subGroups.filter(g => !g.banner),
        ],
        total: inTime.length,
      };
    });
  })();

  const reportToGroups = (() => {
    if (!reportToArtists.length) return [];
    const seen = new Set();
    const combos = [];
    reportToArtists.forEach(a => {
      const key = `${a.report_to||''}|||${a.call_time||''}`;
      if (!seen.has(key)) { seen.add(key); combos.push({ rt: a.report_to||'', ct: a.call_time||'' }); }
    });
    combos.sort((a, b) => sortTime(a.ct) - sortTime(b.ct) || a.rt.localeCompare(b.rt));
    return combos.map(({ rt, ct }) => {
      const inGroup = reportToArtists.filter(a => (a.report_to||'') === rt && (a.call_time||'') === ct);
      return { reportTo: rt, callTime: ct, subGroups: buildSubGroupsFor(inGroup), total: inGroup.length };
    });
  })();

  const uniqueTimes = [...new Set(regularArtists.map(a => a.call_time||''))].sort((a,b) => sortTime(a) - sortTime(b));
  const timeGroups = uniqueTimes.map(time => {
    const inTime = regularArtists.filter(a => (a.call_time||'') === time);
    const bannerIds = [...new Set(inTime.map(a => a.banner_id))];
    const subGroups = bannerIds.map(bid => ({
      banner: banners.find(b => b.id === bid) || null,
      artists: inTime.filter(a => a.banner_id === bid),
    }));
    return { time, subGroups };
  });

  let cols, rowCellsFn;
  if (isShoot) {
    const shootColDefs = [
      { label: 'Name & Surname', key: null },
      { label: 'Agent',          key: 'agent_name' },
      { label: 'Role',           key: 'role' },
      { label: 'Pick Up Point',  key: 'pickup_point' },
      { label: 'Pick Up Time',   key: 'pickup_time' },
      { label: 'Report To',      key: 'report_to' },
      { label: 'Call Time',      key: 'call_time' },
      { label: 'Notes',          key: 'notes' },
    ];
    const visibleCols = shootColDefs.filter(c =>
      c.key === null || allArtists.some(a => a[c.key] && String(a[c.key]).trim())
    );
    cols = visibleCols.map(c => c.label);
    const cellVal = (a, key) => { const v = String(a[key]||'').trim(); return v ? esc(v) : 'N/A'; };
    rowCellsFn = (a) => visibleCols.map(c =>
      c.key === null
        ? `${esc(a.first_name)} ${esc(a.last_name||'')}`.trim()
        : cellVal(a, c.key)
    );
  } else {
    cols = isFitting
      ? ['Name & Surname','Agent','Role','Call Time','Report To','Shoot Date','Day Rate','Fitting Fee','Notes','Additional Dates']
      : ['Name & Surname','Agent','Role','Call Time','Shoot Date','Fitting Date','Day Rate','Fitting Fee','Notes','Additional Dates'];
    rowCellsFn = null;
  }

  function fmtAdditionalDates(a) {
    let dates = [];
    try { dates = JSON.parse(a.additional_dates || '[]'); if (!Array.isArray(dates)) dates = []; } catch {}
    if (!dates.length) return 'N/A';
    const TYPE_LABELS = { pencil: 'Pencil', fitting: 'Fitting', shoot: 'Shoot', other: 'Other' };
    const fmtD = (iso) => {
      if (!iso) return '';
      const d = new Date(iso + 'T00:00:00');
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    return dates.map(d => {
      const typeLabel = TYPE_LABELS[d.type] || d.type || '';
      const dateStr = fmtD(d.date);
      const line = d.label ? `${typeLabel} — ${dateStr} (${d.label})` : `${typeLabel} — ${dateStr}`;
      return esc(line);
    }).join('<br>');
  }

  function rowCells(a) {
    if (isShoot) return rowCellsFn(a);
    const na = v => v || 'N/A';
    if (isFitting) {
      return [
        `${esc(a.first_name)} ${esc(a.last_name||'')}`.trim(),
        na(esc(a.agent_name||'')),
        na(esc(a.role||'')),
        na(esc(a.call_time||'')),
        na(esc(a.report_to||'')),
        na(esc(fmtDate(a.shoot_date)||'')),
        na(esc(a.day_rate||'')),
        na(esc(a.fitting_rate||'')),
        na(esc(a.notes||'')),
        fmtAdditionalDates(a),
      ];
    }
    return [
      `${esc(a.first_name)} ${esc(a.last_name||'')}`.trim(),
      na(esc(a.agent_name||'')),
      na(esc(a.role||'')),
      na(esc(a.call_time||'')),
      na(esc(fmtDate(a.shoot_date)||'')),
      na(esc(fmtDate(a.fitting_date)||'')),
      na(esc(a.day_rate||'')),
      na(esc(a.fitting_rate||'')),
      na(esc(a.notes||'')),
      fmtAdditionalDates(a),
    ];
  }

  const sheetName = sheet.title ? sheet.title.toUpperCase() : (isShoot ? 'SHOOT DAY' : type === 'pencil' ? 'PENCIL DATE' : 'FITTING DAY');
  const subtitle = 'CALL SHEET';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff;padding:14px}
.hdr{width:100%;border-collapse:collapse;border:2px solid #000;margin-bottom:12px}
.hdr td{border:none;vertical-align:middle;padding:0}
.hl{width:22%;border-right:2px solid #000;padding:10px 8px;font-size:10px;line-height:1.8;font-weight:700}
.hc{text-align:center;padding:8px 16px}
.hr{width:18%;border-left:2px solid #000;padding:10px 8px;text-align:center;font-size:11px;line-height:1.8;font-weight:700}
.logo{max-height:260px;max-width:560px;display:block;margin:0 auto 6px}
.title{font-size:18px;font-weight:900;letter-spacing:10px;display:block;margin-top:4px}
.subtitle{font-size:11px;letter-spacing:2px;display:block}
.calltime{font-weight:900;font-size:12px;text-transform:uppercase;text-align:left;background:#1a1a2e;color:#fff;border:1px solid #000;padding:7px 10px;margin-top:12px;break-after:avoid;page-break-after:avoid}
.banner{font-weight:900;font-size:11px;text-transform:uppercase;text-align:left;background:#d4a843;border:1px solid #000;border-top:none;padding:5px 10px;break-after:avoid;page-break-after:avoid}
.grp{}
table.rows{width:100%;border-collapse:collapse;font-size:9px}
table.rows th{border:1px solid #000;padding:4px 6px;font-size:8px;font-weight:900;text-transform:uppercase;background:#f5f5f5;text-align:center}
table.rows td{border:1px solid #000;padding:4px 6px;font-weight:600;vertical-align:middle;text-align:center}
table.rows td:last-child{text-align:left;font-size:8px;line-height:1.5}
table.rows{table-layout:fixed;width:100%}
tr:nth-child(even) td{background:#fafafa}
.agent{font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:.5px;background:#efefef;border:1px solid #ccc;border-top:none;padding:3px 8px;color:#333}
.footer{text-align:center;font-size:9px;border-top:1px solid #000;margin-top:14px;padding-top:6px;color:#444}
</style></head><body>
<table class="hdr"><tr>
<td class="hl" style="text-align:center">${(sheet.director_name||S.app_director) ? `<span style="font-size:7.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#666;display:block">Background Casting Director</span><span style="display:block;font-size:10px;font-weight:700">${esc(sheet.director_name||S.app_director||'')}</span>` : ''}${sheet.assistant_name ? `<br><span style="font-size:7.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#666;display:block">Assistant</span><span style="display:block;font-size:10px;font-weight:700">${esc(sheet.assistant_name)}</span>` : ''}<br><span style="font-size:9px;font-weight:700">${allArtists.length} artists</span></td>
<td class="hc">
  ${logoUrl ? `<img src="${logoUrl}" class="logo">` : `<span style="font-size:22px;font-weight:900;letter-spacing:4px">${esc(S.app_production||'')}</span>`}
  <span class="title">${sheetName.split(' ').join('&nbsp;&nbsp;')}</span>
  <span class="subtitle">${subtitle}</span>
</td>
<td class="hr">${dayOfWeek ? `${dayOfWeek}<br>` : ''}${fmtDate(sheet.date)||''}<br>${esc(sheet.location||'')}</td>
</tr></table>
${(() => {
  const span = cols.length;
  const buildSubGroupRows = (subGroups, showCallTime = false) => subGroups.map(sg => {
    const agentNames = [...new Set(sg.artists.map(a => a.agent_name||''))].sort((a,b) => a.localeCompare(b));
    const byAgent = agentNames.map(agentName => ({
      agentName,
      artists: sg.artists.filter(a => (a.agent_name||'') === agentName)
        .sort((a,b) => `${a.first_name} ${a.last_name||''}`.localeCompare(`${b.first_name} ${b.last_name||''}`)),
    }));
    const multipleAgents = agentNames.length > 1;
    const bannerCallTimes = showCallTime && sg.banner
      ? [...new Set(sg.artists.map(a => a.call_time||'').filter(Boolean))].sort().join(', ')
      : '';
    return [
      sg.banner ? `<tr style="break-after:avoid;page-break-after:avoid"><td colspan="${span}" style="background:#d4a843;font-weight:900;font-size:10px;text-transform:uppercase;padding:5px 8px;text-align:left;border:1px solid #000">${esc(sg.banner.name)}${bannerCallTimes ? ` &nbsp;— ${esc(bannerCallTimes)}` : ''} &nbsp;(${sg.artists.length})</td></tr>` : '',
      ...byAgent.map(ag => [
        multipleAgents ? `<tr><td colspan="${span}" style="background:#efefef;font-weight:700;font-size:9px;text-transform:uppercase;padding:3px 8px;text-align:left;border:1px solid #ccc;color:#333">${esc(ag.agentName||'No Agent')} &nbsp;(${ag.artists.length})</td></tr>` : '',
        ...ag.artists.map(a => `<tr>${rowCells(a).map(v=>`<td>${v}</td>`).join('')}</tr>`),
      ].join('')),
    ].join('');
  }).join('');

  const mergedHTML = [
    ...pickupTimeGroups.map(g => ({ kind: 'pickup', sortKey: sortTime(g.time), ...g })),
    ...reportToGroups.map(g => ({ kind: 'reportto', sortKey: sortTime(g.callTime), ...g })),
  ].sort((a, b) => a.sortKey - b.sortKey || (a.kind === 'pickup' ? -1 : 1)).map(entry => {
    if (entry.kind === 'pickup') {
      const { time, subGroups, total } = entry;
      return `<div class="grp">
<div class="calltime" style="background:#0d4f0d">🚗 PICK UP${time ? ` &nbsp;— ${esc(time)}` : ''} &nbsp;(${total} artist${total!==1?'s':''})</div>
<table class="rows"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>
${buildSubGroupRows(subGroups)}
</tbody></table></div>`;
    } else {
      const { reportTo, callTime, subGroups, total } = entry;
      return `<div class="grp">
<div class="calltime" style="background:#4a3000">⛺ REPORT TO${reportTo ? ` &nbsp;— ${esc(reportTo)}` : ''}${callTime ? ` &nbsp;— ${esc(callTime)}` : ''} &nbsp;(${total} artist${total!==1?'s':''})</div>
<table class="rows"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>
${buildSubGroupRows(subGroups, false)}
</tbody></table></div>`;
    }
  }).join('');

  const timeHTML = timeGroups.map(({ time, subGroups }) => {
    const totalInTime = subGroups.reduce((n, g) => n + g.artists.length, 0);
    return `<div class="grp">
<div class="calltime">⏰ ${esc(time||'No Call Time')} &nbsp;(${totalInTime} artist${totalInTime!==1?'s':''})</div>
<table class="rows"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>
${buildSubGroupRows(subGroups)}
</tbody></table></div>`;
  }).join('');

  return mergedHTML + timeHTML;
})()}
${sheet.footer_note ? `<div class="footer">${esc(sheet.footer_note)}</div>` : ''}
</body></html>`;
}

app.get('/api/call-sheets/:id/preview', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  const enriched = await enrichSheet(sheet);
  const S = await getSettings();
  res.setHeader('Content-Type', 'text/html');
  res.send(buildCallSheetHTML(enriched, sheet.type, S));
}));

// Roster PDF for a full shoot date — all banners + artists in one document.
// This is the slowest export (100s of photos), so it's the main motivation
// for the job/progress-polling pattern (see "PDF generation jobs" above): the
// initial GET only does enough DB work to name the file and know the total
// artist count, then responds with a jobId immediately, and the rest — photo
// fetching, HTML build, Chromium render — runs in the background afterward.
app.get('/api/call-sheets/:id/roster/pdf', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });

  const ROSTER_FIELDS = 'first_name,last_name,agent_name,role,headshot_path,day_rate,additional_dates';
  const [{ data: banners, error: bErr }, { data: artistsRaw, error: aErr }] = await Promise.all([
    supabase.from('banners').select('*').eq('call_sheet_id', sheet.id).order('sort_order').order('id'),
    supabase.from('call_sheet_artists').select(`banner_id, artists(${ROSTER_FIELDS})`).eq('call_sheet_id', sheet.id),
  ]);
  if (checkErr(res, bErr) || checkErr(res, aErr)) return;
  const allArtists = artistsRaw
    .map(row => ({ banner_id: row.banner_id, ...(row.artists || {}) }))
    .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));

  const filename = `roster-${(sheet.title||'sheet').replace(/[^a-z0-9]/gi,'-')}.pdf`.toLowerCase();
  const jobId = createPdfJob(filename);
  res.json({ jobId });

  (async () => {
  const S = await getSettings();
  const logoUrl = resolveImageUrl(sheet.logo_path || S.app_logo_path);

  // Prefetch every artist photo (+ logo) server-side and embed as data: URIs
  // instead of leaving Chromium to fetch ~195 <img src> URLs itself over the
  // network — see fetchAsDataUri/inlineImages above for why this is the real
  // fix for roster slowness, not just a bigger timeout. This phase is mapped
  // to 5-70% of the job's overall progress since it's normally by far the
  // slowest part of a big roster.
  const t0 = Date.now();
  updatePdfJob(jobId, { stage: `Fetching ${allArtists.length} photos…`, percent: 5 });
  const imageMap = await inlineImages(
    [logoUrl, ...allArtists.map(a => resolveImageUrl(a.headshot_path))],
    8,
    (done, total) => updatePdfJob(jobId, { stage: `Fetching photos… (${done}/${total})`, percent: 5 + Math.round((done / total) * 65) }),
  );
  console.log(`[roster pdf] inlineImages: ${Date.now() - t0}ms (${imageMap.size} unique images)`);
  const inlinedLogoUrl = logoUrl ? (imageMap.get(logoUrl) || logoUrl) : null;

  const TYPE_LABELS = { pencil: 'Pencil', fitting: 'Fitting', shoot: 'Shoot', other: 'Other' };
  const fmtD = iso => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtDates = (additional_dates) => {
    let dates = [];
    try { dates = JSON.parse(additional_dates || '[]'); if (!Array.isArray(dates)) dates = []; } catch {}
    return dates.map(d => `${TYPE_LABELS[d.type] || d.type} — ${fmtD(d.date)}${d.label ? ` (${d.label})` : ''}`).join('<br>');
  };

  const makeCard = a => {
    const rawPhotoUrl = resolveImageUrl(a.headshot_path);
    const photoUrl = rawPhotoUrl ? (imageMap.get(rawPhotoUrl) || rawPhotoUrl) : null;
    const name = `${a.first_name} ${a.last_name || ''}`.trim();
    const dates = fmtDates(a.additional_dates);
    return `<div class="artist-card">
      <div class="photo-wrap">${photoUrl ? `<img src="${photoUrl}" class="photo">` : `<div class="photo-placeholder">${esc(a.first_name[0]||'?')}</div>`}</div>
      <div class="artist-info">
        <div class="artist-name">${esc(name)}</div>
        ${a.agent_name ? `<div class="artist-detail">${esc(a.agent_name)}</div>` : ''}
        ${a.role ? `<div class="artist-role">${esc(a.role)}</div>` : ''}
        ${a.day_rate ? `<div class="artist-detail">${esc(a.day_rate)}</div>` : ''}
        ${dates ? `<div class="artist-dates">${dates}</div>` : ''}
      </div>
    </div>`;
  };

  const bannerMap = {};
  allArtists.forEach(a => {
    const key = a.banner_id ?? '__none__';
    if (!bannerMap[key]) bannerMap[key] = [];
    bannerMap[key].push(a);
  });
  const groups = [
    ...(banners||[]).filter(b => bannerMap[b.id]).map(b => ({ name: b.name, artists: bannerMap[b.id] })),
    ...(bannerMap['__none__'] ? [{ name: null, artists: bannerMap['__none__'] }] : []),
  ];

  const sectionsHTML = groups.map(g => `
    <div class="banner-section">
      <div class="banner-hdr">${g.name ? esc(g.name) : 'UNASSIGNED'} <span class="banner-count">${g.artists.length}</span></div>
      <div class="grid">${g.artists.map(makeCard).join('')}</div>
    </div>`).join('');

  // Scale the grid to the size of the WHOLE roster (not per-banner), so a
  // massive shoot day (100s of artists) gets more, smaller columns per page,
  // while a small call sheet gets fewer, larger ones. Column counts were
  // calibrated by actually measuring rendered column width at landscape A4
  // size (see test_measure2.mjs) rather than guessed, since landscape gives
  // ~40% more usable width than the original portrait 4-column layout —
  // reusing the same column counts as portrait would make every tier bigger
  // than before, not smaller. Font sizes scale down slightly alongside more
  // columns so text doesn't look oversized relative to a shrunken card.
  const totalArtists = allArtists.length;
  const cols = totalArtists > 150 ? 7 : totalArtists > 60 ? 6 : totalArtists > 20 ? 5 : 4;
  const scale = cols <= 4 ? 1.15 : cols === 5 ? 1.05 : cols === 6 ? 1 : 0.9;
  const fs = n => Math.round(n * scale * 10) / 10;
  const px = n => Math.max(2, Math.round(n * scale));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10px;background:#fff;padding:6px 14px 14px;color:#000}
.hdr{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:10px;gap:12px}
.hdr-logo img{max-height:60px;max-width:160px}
.hdr-center{text-align:center;flex:1}
.cs-title{font-size:15px;font-weight:900;letter-spacing:5px;text-transform:uppercase}
.cs-sub{font-size:9px;letter-spacing:2px;margin-top:2px;color:#555;text-transform:uppercase}
.hdr-meta{font-size:9px;font-weight:700;text-align:right;line-height:1.8}
.banner-section{margin-bottom:14px}
/* break-after:avoid (+ legacy page-break-after) keeps this header attached
   to the grid that follows it: if the header + at least the first row of
   artists don't fit in the remaining space on the current page, Chromium
   pushes the WHOLE pair to the next page together, instead of stranding the
   header alone at the bottom of one page with all its artists on the next. */
.banner-hdr{background:#1a1a2e;color:#fff;font-size:${fs(11)}px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:${px(5)}px ${px(10)}px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;break-after:avoid;page-break-after:avoid;break-inside:avoid;page-break-inside:avoid}
.banner-count{background:#d4a843;color:#000;font-size:${fs(9)}px;font-weight:900;padding:1px 7px;border-radius:20px}
.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:${px(6)}px}
.artist-card{border:1px solid #ccc;border-radius:4px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
/* padding-bottom:133% (not a fixed height) is deliberate: it ties photo box
   height to the ACTUAL rendered column width, so the box always keeps a
   portrait headshot's proportions no matter how wide a column ends up being.
   A previous attempt used a fixed mm height here to fix a landscape-mode row
   count issue, but that decoupled height from width entirely — at 6
   columns the box came out wider than tall, so object-fit:cover zoomed in
   and cropped photos strangely. Row-count-per-page is instead controlled by
   picking columns wide enough that height stays reasonable (see cols above). */
.photo-wrap{width:100%;position:relative;padding-bottom:133%;overflow:hidden;background:#f0f0f0}
.photo{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.photo-placeholder{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#aaa;background:#e8e8e8}
.artist-info{padding:${px(5)}px ${px(6)}px}
.artist-name{font-size:${fs(9)}px;font-weight:900;text-transform:uppercase;letter-spacing:.5px}
.artist-role{font-size:${fs(8)}px;font-weight:700;color:#8B1A1A;text-transform:uppercase;margin-top:2px}
.artist-detail{font-size:${fs(8)}px;color:#555;margin-top:1px}
.artist-dates{font-size:${fs(7.5)}px;color:#2E6DA4;margin-top:2px;line-height:1.4}
.footer{text-align:center;font-size:8px;border-top:1px solid #ccc;margin-top:14px;padding-top:6px;color:#666}
</style></head><body>
<div class="hdr">
  <div class="hdr-logo">${inlinedLogoUrl ? `<img src="${inlinedLogoUrl}">` : `<span style="font-size:14px;font-weight:900">${esc(S.app_production||'')}</span>`}</div>
  <div class="hdr-center">
    <div class="cs-title">${esc(sheet.title || '')}</div>
    <div class="cs-sub">Artist Roster</div>
  </div>
  <div class="hdr-meta">
    ${sheet.date ? `${fmtD(sheet.date)}<br>` : ''}
    ${sheet.location ? `${esc(sheet.location)}<br>` : ''}
    ${allArtists.length} artists total
  </div>
</div>
${sectionsHTML}
<div class="footer">${esc(S.app_production||'')} · ${esc(sheet.title||'')} · ${allArtists.length} artists</div>
</body></html>`;

  console.log(`[roster pdf] sheet=${sheet.id} artists=${allArtists.length} html_bytes=${html.length}`);
  updatePdfJob(jobId, { stage: 'Rendering PDF…', percent: 72 });
  const pdf = await withPage(async page => {
    let t = Date.now();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    console.log(`[roster pdf] setContent: ${Date.now() - t}ms`); t = Date.now();
    updatePdfJob(jobId, { percent: 82 });
    // Photos are already embedded as data: URIs at this point (see
    // inlineImages() above), so this just waits for Chromium to decode/paint
    // them locally — no network involved, so it should resolve in well under
    // a second per image rather than needing a long per-image budget.
    await waitForImages(page, 5000);
    console.log(`[roster pdf] waitForImages: ${Date.now() - t}ms`); t = Date.now();
    updatePdfJob(jobId, { percent: 88 });
    const buf = await page.pdf({ format: 'A4', landscape: true, printBackground: true, margin: { top:'10mm', bottom:'10mm', left:'10mm', right:'10mm' } });
    console.log(`[roster pdf] page.pdf: ${Date.now() - t}ms`);
    return buf;
  }, 120000); // larger rosters (100s of artist photos) can genuinely take longer to rasterize than a single call sheet
  updatePdfJob(jobId, { status: 'done', percent: 100, stage: 'Done', buffer: Buffer.from(pdf) });
  })().catch(err => {
    console.error('[roster pdf job]', err);
    updatePdfJob(jobId, { status: 'error', error: err.message });
  });
}));

app.get('/api/call-sheets/:id/pdf', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  const filename = `call-sheet-${(sheet.title||sheet.id).replace(/[^a-z0-9]/gi,'-').toLowerCase()}.pdf`;
  const jobId = createPdfJob(filename);
  res.json({ jobId });

  (async () => {
    const enriched = await enrichSheet(sheet);
    const notesSort = req.query.notesSort;
    if (notesSort === 'asc' || notesSort === 'desc') {
      enriched.artists.sort((a, b) => {
        const na = (a.notes||'').toLowerCase(), nb = (b.notes||'').toLowerCase();
        return notesSort === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
      });
    }
    const S = await getSettings();
    updatePdfJob(jobId, { stage: 'Rendering PDF…', percent: 30 });
    const pdf = await withPage(async page => {
      await page.setContent(buildCallSheetHTML(enriched, sheet.type, S), { waitUntil: 'domcontentloaded' });
      updatePdfJob(jobId, { percent: 60 });
      await waitForImages(page);
      updatePdfJob(jobId, { percent: 85 });
      return page.pdf({ format: 'A4', landscape: true, printBackground: true,
        margin: { top:'8mm', bottom:'8mm', left:'8mm', right:'8mm' } });
    });
    updatePdfJob(jobId, { status: 'done', percent: 100, stage: 'Done', buffer: Buffer.from(pdf) });
  })().catch(err => {
    console.error('[call sheet pdf job]', err);
    updatePdfJob(jobId, { status: 'error', error: err.message });
  });
}));

app.get('/api/call-sheets/:id/excel', ah(async (req, res) => {
  const { data: sheet, error } = await supabase.from('call_sheets').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!sheet) return res.status(404).json({ error: 'Not found' });
  const enriched = await enrichSheet(sheet);
  const isShoot = sheet.type === 'shoot';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Call Sheet');
  const headers = isShoot
    ? ['Name & Surname','Agent','Role','Pick Up Point','Pick Up Time','Report To','Call Time','Notes']
    : ['Name & Surname','Agent','Role','Call Time','Shoot Date','Day Rate','Notes'];
  ws.columns = headers.map((h,i) => ({ header: h, key: `c${i}`, width: i===0?28:16 }));
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  hdr.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD4A843' } };
  enriched.artists.forEach(a => {
    const vals = isShoot
      ? [`${a.first_name} ${a.last_name||''}`.trim(), a.agent_name||'', a.role||'', a.report_to||'', a.pickup_time||'', a.call_time||'', a.notes||'']
      : [`${a.first_name} ${a.last_name||''}`.trim(), a.agent_name||'', a.role||'', a.call_time||'', fmtDate(a.shoot_date)||'', a.day_rate||'', a.notes||''];
    ws.addRow(vals);
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="call-sheet-${sheet.id}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

// ── Brief PDF ──────────────────────────────────────────────────────────────────
app.get('/api/briefs/:id/pdf', ah(async (req, res) => {
  const { data: brief, error } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!brief) return res.status(404).json({ error: 'Not found' });
  const jobId = createPdfJob(`casting-brief-${brief.id}.pdf`);
  res.json({ jobId });

  (async () => {
  let moodImages = [];
  try { moodImages = JSON.parse(brief.mood_board_images || '[]'); } catch {}
  let restrictions = {};
  try { restrictions = JSON.parse(brief.restrictions || '{}'); } catch {}
  const S = await getSettings();
  const prod = brief.production_id
    ? (await supabase.from('productions').select('*').eq('id', brief.production_id).maybeSingle()).data
    : null;
  const logoUrl = resolveImageUrl(S.app_logo_path);
  const moodUrls = moodImages.map(p => resolveImageUrl(p));

  // Prefetch the logo + mood board images server-side and embed as data: URIs
  // instead of leaving Chromium to fetch them live over the network — same
  // fix as the roster PDF (see fetchAsDataUri/inlineImages above): a live
  // Chromium fetch of a Supabase Storage URL is what was causing the logo to
  // silently fail to render in the downloaded brief PDF.
  updatePdfJob(jobId, { stage: 'Fetching images…', percent: 15 });
  const imageMap = await inlineImages([logoUrl, ...moodUrls], 8);
  const inlinedLogoUrl = logoUrl ? (imageMap.get(logoUrl) || logoUrl) : null;

  const formatDate = (iso) => {
    if (!iso) return '';
    const clean = String(iso).trim();
    if (!clean) return '';
    const d = new Date(clean.includes('T') ? clean : clean + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).replace(',','');
  };

  const moodHtml = moodUrls.map(url => {
    const inlined = url ? (imageMap.get(url) || url) : null;
    return inlined ? `<div style="break-inside:avoid;display:inline-block;vertical-align:top;margin:6px"><img src="${inlined}" style="max-height:260px;max-width:280px;width:auto;height:auto;object-fit:contain;border-radius:4px;background:#f3f4f6;display:block;"></div>` : '';
  }).join('');

  const detailCards = [
    brief.age_from||brief.age_to ? { label:'Age Range',    value:`${brief.age_from||'?'} – ${brief.age_to||'?'} yrs` } : null,
    brief.gender              ? { label:'Gender',         value: brief.gender } : null,
    brief.race                ? { label:'Race',           value: brief.race } : null,
    brief.fitting_dates       ? { label:'Fitting Date',   value: formatDate(brief.fitting_dates) } : null,
    ...(() => {
      let dates = [];
      if (brief.shoot_dates) {
        try { const p = JSON.parse(brief.shoot_dates); dates = Array.isArray(p) ? p : [brief.shoot_dates]; } catch { dates = [brief.shoot_dates]; }
      }
      return dates.map((d, i) => ({ label: dates.length > 1 ? `Shoot Date ${i+1}` : 'Shoot Date', value: formatDate(d) })).filter(c => c.value);
    })(),
    brief.role_rate           ? { label:'Shootday Rate',  value: brief.role_rate } : null,
    brief.fitting_rate        ? { label:'Fitting Rate',   value: brief.fitting_rate } : null,
    brief.height_requirements ? { label:'Height',         value: brief.height_requirements } : null,
  ].filter(Boolean);

  const detailCardsHtml = detailCards.map(c =>
    `<div style="background:#f9fafb;border-radius:8px;padding:10px 12px;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:3px">${esc(c.label)}</div>
      <div style="font-size:12px;font-weight:600;color:#111">${esc(c.value)}</div>
    </div>`
  ).join('');

  const restrictionRows = Object.entries(restrictions).filter(([,v])=>v).map(([k,v]) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;background:#f9fafb;border-radius:4px;padding:7px 12px;">
      <span style="font-size:11px">${esc(k)}</span>
      <span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:999px;background:${v==='Allowed'?'#dcfce7':'#fee2e2'};color:${v==='Allowed'?'#15803d':'#b91c1c'}">${esc(v)}</span>
    </div>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:32px 36px}
.section{margin-bottom:24px}
.section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding-bottom:5px;margin-bottom:10px}
</style></head><body>

<div style="text-align:center;border-bottom:1px solid #e5e7eb;padding-bottom:20px;margin-bottom:24px">
  ${inlinedLogoUrl ? `<img src="${inlinedLogoUrl}" style="max-height:100px;max-width:280px;width:auto;height:auto;margin:0 auto 10px;display:block">` : ''}
  ${prod?.name ? `<p style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.15em;color:#9ca3af;margin-bottom:5px">Casting Brief</p>` : ''}
  <h1 style="font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#111">${esc(prod?.name || S.app_production || 'Casting Brief')}</h1>
  ${[prod?.bg_director, prod?.contact_number, prod?.email].filter(Boolean).length
    ? `<p style="font-size:10px;color:#6b7280;margin-top:5px">${[prod?.bg_director, prod?.contact_number, prod?.email].filter(Boolean).map(v=>esc(v)).join('  ·  ')}</p>`
    : ''}
</div>

<div style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:24px">
  <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#9ca3af;margin-bottom:4px">Role</p>
  <p style="font-size:16px;font-weight:700">${esc(brief.role_name||'—')}</p>
</div>

${detailCardsHtml ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px">${detailCardsHtml}</div>` : ''}

${brief.scene_description ? `<div class="section">
  <div class="section-title">Scene Description</div>
  <p style="white-space:pre-wrap;line-height:1.7;font-size:12px">${esc(brief.scene_description)}</p>
</div>` : ''}

${brief.costume_requirements ? `<div class="section">
  <div class="section-title">Costume Requirements</div>
  <p style="white-space:pre-wrap;line-height:1.7;font-size:12px">${esc(brief.costume_requirements)}</p>
</div>` : ''}

${brief.hair_makeup ? `<div class="section">
  <div class="section-title">Hair &amp; Make-Up</div>
  <p style="white-space:pre-wrap;line-height:1.7;font-size:12px">${esc(brief.hair_makeup)}</p>
</div>` : ''}

${restrictionRows ? `<div class="section">
  <div class="section-title">Restrictions</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${restrictionRows}</div>
</div>` : ''}

${moodHtml ? (() => {
  const hasPage1Content = !!(detailCardsHtml || brief.scene_description || brief.costume_requirements || brief.hair_makeup || restrictionRows);
  return `<div class="section" style="${hasPage1Content ? 'page-break-before:always' : ''}">
  <div class="section-title">Mood Board</div>
  <div style="line-height:0;font-size:0;margin-top:10px">${moodHtml}</div>
</div>`;
})() : ''}

</body></html>`;

  updatePdfJob(jobId, { stage: 'Rendering PDF…', percent: 60 });
  const pdf = await withPage(async page => {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    updatePdfJob(jobId, { percent: 75 });
    await waitForImages(page);
    updatePdfJob(jobId, { percent: 90 });
    return page.pdf({ format: 'A4', printBackground: true,
      margin: { top:'15mm', bottom:'15mm', left:'15mm', right:'15mm' } });
  });
  updatePdfJob(jobId, { status: 'done', percent: 100, stage: 'Done', buffer: Buffer.from(pdf) });
  })().catch(err => {
    console.error('[brief pdf job]', err);
    updatePdfJob(jobId, { status: 'error', error: err.message });
  });
}));

// ── Z-Cards ───────────────────────────────────────────────────────────────────
const ZCARD_ARTIST_FIELDS = 'first_name,last_name,agent_name,headshot_path,chest,waist,shoe_size,hat_size,jacket_size';

function flattenZcard(row) {
  const { artists, ...rest } = row;
  return { ...rest, ...(artists || {}) };
}

app.get('/api/zcards', ah(async (_req, res) => {
  const { data, error } = await supabase.from('zcards')
    .select(`*, artists(${ZCARD_ARTIST_FIELDS})`)
    .order('created_at', { ascending: false });
  if (checkErr(res, error)) return;
  res.json((data || []).map(flattenZcard));
}));

app.get('/api/zcards/:id', ah(async (req, res) => {
  const { data, error } = await supabase.from('zcards')
    .select(`*, artists(${ZCARD_ARTIST_FIELDS})`)
    .eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(flattenZcard(data));
}));

app.post('/api/zcards', ah(async (req, res) => {
  const { artist_id, accent_color, display_name, age, eye_color, hair_color, height, chest, waist, bust_size, dress_size, shoe_size, neck_hat, suit } = req.body;
  const artist = artist_id ? (await supabase.from('artists').select('*').eq('id', artist_id).maybeSingle()).data : null;
  const name = display_name || (artist ? [artist.first_name, artist.last_name].filter(Boolean).join(' ') : null);
  const { data, error } = await supabase.from('zcards').insert({
    artist_id: artist_id || null, accent_color: accent_color || '#f97316', display_name: name || null,
    photo1: artist?.headshot_path || null, age: age || null, eye_color: eye_color || null, hair_color: hair_color || null,
    height: height || null, chest: chest || artist?.chest || null, waist: waist || artist?.waist || null,
    bust_size: bust_size || null, dress_size: dress_size || null,
    shoe_size: shoe_size || artist?.shoe_size || null, neck_hat: neck_hat || null, suit: suit || artist?.jacket_size || null,
  }).select().single();
  if (checkErr(res, error)) return;
  res.status(201).json(data);
}));

app.put('/api/zcards/:id', ah(async (req, res) => {
  const { artist_id, accent_color, display_name, age, eye_color, hair_color, height, chest, waist, bust_size, dress_size, shoe_size, neck_hat, suit } = req.body;
  const artist = artist_id ? (await supabase.from('artists').select('*').eq('id', artist_id).maybeSingle()).data : null;
  const name = display_name || (artist ? [artist.first_name, artist.last_name].filter(Boolean).join(' ') : null);
  const { data, error } = await supabase.from('zcards').update({
    artist_id: artist_id || null, accent_color: accent_color || '#f97316', display_name: name || null,
    age: age || null, eye_color: eye_color || null, hair_color: hair_color || null, height: height || null,
    chest: chest || null, waist: waist || null, bust_size: bust_size || null, dress_size: dress_size || null,
    shoe_size: shoe_size || null, neck_hat: neck_hat || null, suit: suit || null,
  }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.delete('/api/zcards/:id', ah(async (req, res) => {
  const { error } = await supabase.from('zcards').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.post('/api/zcards/:id/photo/:slot', upload.single('photo'), ah(async (req, res) => {
  const slot = parseInt(req.params.slot);
  if (slot < 1 || slot > 4 || !req.file) return res.status(400).json({ error: 'Invalid' });
  const { publicUrl } = await uploadBufferToStorage(req.file.buffer, 'zcards', req.file.originalname, req.file.mimetype);
  const col = `photo${slot}`;
  const { data, error } = await supabase.from('zcards').update({ [col]: publicUrl }).eq('id', req.params.id).select().single();
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.get('/api/zcards/:id/pdf', ah(async (req, res) => {
  const { data: z, error } = await supabase.from('zcards')
    .select('*, artists(first_name,last_name,headshot_path)')
    .eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!z) return res.status(404).json({ error: 'Not found' });
  const flat = flattenZcard(z);
  const jobId = createPdfJob(`zcard-${flat.id}.pdf`);
  res.json({ jobId });

  (async () => {
    const S = await getSettings();
    const logoUrl = resolveImageUrl(S.app_logo_path);

    const p1 = resolveImageUrl(flat.photo1 || flat.headshot_path);
    const p2 = resolveImageUrl(flat.photo2);

    const name = flat.display_name || [flat.first_name, flat.last_name].filter(Boolean).join(' ') || '';
    const accent = flat.accent_color || '#f97316';

    const imgBox = (src) => src
      ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:100%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px">No photo</div>`;

    const measurePill = (label, val) => val
      ? `<div style="display:inline-flex;align-items:baseline;gap:4px;margin:0 8px 0 0;white-space:nowrap">
           <span style="font-size:9px;font-weight:800;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:.06em;font-family:Arial,sans-serif">${esc(label)}</span>
           <span style="font-size:14px;font-weight:700;color:#fff;font-family:Arial,sans-serif">${esc(val)}</span>
         </div>`
      : '';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#0d0d0d;width:297mm;height:210mm;overflow:hidden}
</style></head><body>
<div style="width:297mm;height:210mm;display:flex;flex-direction:column;overflow:hidden;border:2.5px solid ${esc(accent)}">

  <div style="flex:1;display:flex;overflow:hidden;min-height:0">

    <div style="width:50%;height:100%;position:relative;overflow:hidden;border-right:2.5px solid ${esc(accent)}">
      <div style="position:absolute;top:0;left:0;right:0;height:5px;background:${esc(accent)};z-index:2"></div>
      ${imgBox(p1)}
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.88));padding:40px 14px 12px;z-index:2">
        <div style="font-size:22px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.08em;text-shadow:0 2px 8px rgba(0,0,0,0.9);line-height:1.1;font-family:'Arial Black',Arial,sans-serif">${esc(name)}</div>
        ${flat.agent_name ? `<div style="font-size:10px;color:rgba(255,255,255,0.7);margin-top:3px;font-weight:600;letter-spacing:.04em;font-family:Arial,sans-serif">${esc(flat.agent_name)}</div>` : ''}
      </div>
    </div>

    <div style="width:50%;height:100%;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:5px;background:${esc(accent)};z-index:2"></div>
      ${imgBox(p2)}
    </div>

  </div>

  <div style="background:${esc(accent)};padding:10px 16px;display:flex;align-items:center;gap:14px;flex-shrink:0;min-height:58px">
    <div style="flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:2px 0">
      ${measurePill('Age', flat.age)}
      ${measurePill('Eyes', flat.eye_color)}
      ${measurePill('Hair', flat.hair_color)}
      ${measurePill('Height', flat.height)}
      ${measurePill('Chest', flat.chest)}
      ${measurePill('Bust', flat.bust_size)}
      ${measurePill('Waist', flat.waist)}
      ${measurePill('Dress', flat.dress_size)}
      ${measurePill('Shoe', flat.shoe_size)}
      ${measurePill('Neck/Hat', flat.neck_hat)}
      ${measurePill('Suit', flat.suit)}
    </div>
    ${logoUrl ? `<div style="flex-shrink:0;background:rgba(255,255,255,0.1);border-radius:8px;padding:6px 10px;border:1px solid rgba(255,255,255,0.2)"><img src="${logoUrl}" style="height:70px;max-width:160px;object-fit:contain;display:block"></div>` : ''}
  </div>

</div>
</body></html>`;

    updatePdfJob(jobId, { stage: 'Rendering PDF…', percent: 40 });
    const pdf = await withPage(async page => {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      updatePdfJob(jobId, { percent: 60 });
      await waitForImages(page);
      updatePdfJob(jobId, { percent: 85 });
      return page.pdf({ format: 'A4', landscape: true, printBackground: true, margin: { top:0, bottom:0, left:0, right:0 } });
    });
    updatePdfJob(jobId, { status: 'done', percent: 100, stage: 'Done', buffer: Buffer.from(pdf) });
  })().catch(e => {
    console.error('[zcard pdf job]', e);
    updatePdfJob(jobId, { status: 'error', error: e.message });
  });
}));

// ── Casting Presentation CRUD ─────────────────────────────────────────────────
app.get('/api/presentations', ah(async (_req, res) => {
  const { data, error } = await supabase.from('presentations').select('id, name, updated_at, created_at').order('updated_at', { ascending: false });
  if (checkErr(res, error)) return;
  res.json(data);
}));

app.get('/api/presentations/:id', ah(async (req, res) => {
  const { data: row, error } = await supabase.from('presentations').select('*').eq('id', req.params.id).maybeSingle();
  if (checkErr(res, error)) return;
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, data: JSON.parse(row.data) });
}));

app.post('/api/presentations', ah(async (req, res) => {
  const { name, data } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { data: inserted, error } = await supabase.from('presentations')
    .insert({ name: name.trim(), data: JSON.stringify(data) }).select().single();
  if (checkErr(res, error)) return;
  res.json({ id: inserted.id, name: inserted.name });
}));

app.put('/api/presentations/:id', ah(async (req, res) => {
  const { name, data } = req.body;
  const { error } = await supabase.from('presentations')
    .update({ name, data: JSON.stringify(data), updated_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

app.delete('/api/presentations/:id', ah(async (req, res) => {
  const { error } = await supabase.from('presentations').delete().eq('id', req.params.id);
  if (checkErr(res, error)) return;
  res.json({ ok: true });
}));

// Save a single base64 image to Supabase Storage, return its public URL
app.post('/api/presentations/upload-image', ah(async (req, res) => {
  const { dataUrl } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'invalid dataUrl' });
  const ext = matches[1].includes('png') ? 'png' : 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  const { publicUrl } = await uploadBufferToStorage(buffer, 'presentations', `pres.${ext}`, matches[1]);
  res.json({ path: publicUrl });
}));

// ── Casting Presentation PDF ──────────────────────────────────────────────────
// The original wrote a temp HTML file to local disk (with any base64 images
// decoded to local temp files first) so Puppeteer could load everything via
// file:// URLs without hitting any request-size limits. Now that uploaded
// images live in Supabase Storage as normal https:// URLs (and are typically
// much smaller strings than an inline base64 blob), that workaround is no
// longer needed — `page.setContent()` handles it directly, and Puppeteer
// fetches remote image URLs itself. Freshly-pasted, not-yet-uploaded images
// (raw data: URIs) are still supported by embedding them directly.
app.post('/api/presentation/pdf', ah(async (req, res) => {
  const { coverSrc, sets = [] } = req.body;
  const jobId = createPdfJob('casting-presentation.pdf');
  res.json({ jobId });

  (async () => {
  const escP = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const toImgSrc = (src) => {
    if (!src) return null;
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
    return null; // legacy local "/uploads/..." path from before the migration — unresolvable
  };

  const PAGE_W = 1587;
  const PAGE_H = 1122;

  const fullPage = (src) => {
    const url = toImgSrc(src);
    if (!url) return '';
    return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;page-break-after:always;page-break-inside:avoid">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block"/>
    </div>`;
  };

  const groupHtml = (g) => {
    const count = g.images.length;
    const numCols = Math.min(count, 4);
    const colPct = Math.round(100 / numCols);
    const MAX_IMG_H = PAGE_H - 80;
    const cards = g.images.map(img => {
      const url = toImgSrc(img.src);
      if (!url) return '';
      return `<div style="break-inside:avoid;page-break-inside:avoid;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #eee;width:${colPct - 2}%;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <img src="${url}" style="width:100%;max-height:${MAX_IMG_H}px;height:auto;object-fit:contain;display:block"/>
      </div>`;
    }).join('');
    return `<div style="page-break-inside:avoid;break-inside:avoid;page-break-before:auto;margin-bottom:24px">
      <div style="background:#1a1a1a;color:#C9A84C;font-size:18px;font-weight:700;letter-spacing:.12em;padding:12px 20px;border-radius:5px 5px 0 0;margin-bottom:10px;text-align:center;text-transform:uppercase">${escP(g.name)} (${count})</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">${cards}</div>
    </div>`;
  };

  let bodyHtml = '';
  if (coverSrc) bodyHtml += fullPage(coverSrc);

  for (const set of sets) {
    if (set.headerSrc) bodyHtml += fullPage(set.headerSrc);
    const validGroups = (set.groups || []).filter(g => g.images?.length);
    if (validGroups.length) {
      bodyHtml += `<div style="padding:20px 24px">${validGroups.map(groupHtml).join('')}</div>`;
    }
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#fff;width:${PAGE_W}px}
</style>
</head><body>${bodyHtml}</body></html>`;

  updatePdfJob(jobId, { stage: 'Rendering PDF…', percent: 40 });
  const pdf = await withPage(async page => {
    await page.setViewport({ width: PAGE_W, height: PAGE_H });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    updatePdfJob(jobId, { percent: 60 });
    await waitForImages(page);
    updatePdfJob(jobId, { percent: 85 });
    return page.pdf({ format: 'A3', landscape: true, printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  });
  updatePdfJob(jobId, { status: 'done', percent: 100, stage: 'Done', buffer: Buffer.from(pdf) });
  })().catch(err => {
    console.error('[presentation pdf job]', err);
    updatePdfJob(jobId, { status: 'error', error: err.message });
  });
}));

// ── SPA fallback (serve dist in prod) ────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

async function main() {
  await ensureMediaBucket();
  app.listen(PORT, () => console.log(`Casting Collection server running on http://localhost:${PORT}`));
}
main();
