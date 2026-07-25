import { supabase } from './supabaseClient.js';

const BASE = '/api';

// Reads the current Supabase session's access token. Normally instant (reads
// from memory/localStorage), but if this fires immediately after a prior
// request — e.g. uploading a headshot right after creating the artist that
// owns it — supabase-js can occasionally still be settling its session state
// (seen in practice on Safari) and briefly return no session at all. One
// short retry closes that gap instead of silently sending an unauthenticated
// request that the backend then rejects with "Missing Authorization header".
async function getAccessToken() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return token;
    if (attempt === 0) await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

async function req(method, url, body) {
  const token = await getAccessToken();

  const headers = body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(BASE + url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || 'Request failed');
    e.status = res.status;
    e.data = err;
    throw e;
  }
  const ct = res.headers.get('content-type');
  if (ct?.includes('application/json')) return res.json();
  return res;
}

// Downloads a file from an /api/* route that requires the Authorization
// header (plain <a href>/window.open can't attach custom headers, so a
// normal link click to these URLs would 401 now that the backend requires
// auth on every /api/* route). This fetches the file WITH the bearer token,
// then triggers a client-side download via a temporary object URL.
//
// Most callers fire this from onClick={() => api.someExportUrl(id)} without
// awaiting or catching — that's normal for a "download on click" button, but
// it means an unhandled rejection here previously just vanished (the button
// looked like it did nothing). So this always surfaces failures with an
// alert before rethrowing, so the handful of callers that DO await + catch
// (e.g. CastingBriefs' save-and-download flow) still get the real error too.
async function downloadFile(url, filename) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const e = new Error(err.error || 'Download failed');
      e.status = res.status;
      throw e;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch (err) {
    console.error('[download failed]', url, err);
    alert(`Download failed: ${err.message || err}`);
    throw err;
  }
}

// Fetches a URL that requires the Authorization header and returns a
// temporary object URL for the response body. Used for embedding authed
// content (e.g. an <iframe src>) since iframes can't attach custom headers
// on their own the way fetch() can. Callers own the returned URL and MUST
// call URL.revokeObjectURL() on it once it's no longer displayed (e.g. in a
// useEffect cleanup) to avoid leaking memory.
async function fetchBlobUrl(url) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || 'Request failed');
    e.status = res.status;
    throw e;
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── PDF generation job polling ────────────────────────────────────────────────
// PDF generation can take anywhere from a couple seconds (a small brief) to
// over a minute (a roster with 100s of photos), and there was previously no
// way to show real progress — clicking the button did nothing visible until
// the download appeared or an error alert popped up. The relevant /api/*/pdf
// routes now respond with { jobId } immediately instead of the PDF itself
// (see server.js's "PDF generation jobs"), so the frontend polls for status
// and can drive an actual progress bar instead of a bare spinner.

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Polls a PDF job's status every 700ms, calling onProgress(job) with the
// latest {status, stage, percent} after every poll. Resolves once the job is
// done; throws (with the server's error message) if it failed.
export async function pollPdfJob(jobId, onProgress) {
  const headers = await authHeaders();
  while (true) {
    await new Promise(r => setTimeout(r, 700));
    const res = await fetch(`/api/jobs/${jobId}/status`, { headers });
    if (!res.ok) throw new Error('Lost track of the PDF job — please try again');
    const job = await res.json();
    onProgress?.(job);
    if (job.status === 'error') throw new Error(job.error || 'PDF generation failed');
    if (job.status === 'done') return;
  }
}

// Downloads a finished PDF job's file and triggers a client-side save, the
// same way the old direct-download flow did.
export async function downloadPdfJobResult(jobId, filename) {
  const headers = await authHeaders();
  const res = await fetch(`/api/jobs/${jobId}/download`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Download failed');
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

// Starts a job-backed PDF export (GET by default, or POST with a JSON body
// for routes like /api/presentation/pdf), polls it to completion while
// reporting progress via onProgress, then downloads the finished file.
async function downloadFileWithProgress(startUrl, filename, onProgress, opts = {}) {
  try {
    const headers = { ...(await authHeaders()), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
    const startRes = await fetch(startUrl, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({ error: startRes.statusText }));
      throw new Error(err.error || 'Failed to start PDF generation');
    }
    const { jobId } = await startRes.json();
    await pollPdfJob(jobId, onProgress);
    await downloadPdfJobResult(jobId, filename);
  } catch (err) {
    console.error('[download failed]', startUrl, err);
    alert(`Download failed: ${err.message || err}`);
    throw err;
  }
}

export const api = {
  // Settings
  getSettings: () => req('GET', '/settings'),
  saveSettings: (data) => req('PUT', '/settings', data),
  uploadLogo: (fd) => req('POST', '/settings/logo', fd),

  // Productions
  getProductions: () => req('GET', '/productions'),
  createProduction: (d) => req('POST', '/productions', d),
  updateProduction: (id, d) => req('PUT', `/productions/${id}`, d),

  // Agents
  getAgents: () => req('GET', '/agents'),
  getRoles: () => req('GET', '/roles'),
  bulkRenameRole: (ids, role) => req('POST', '/artists/bulk-rename-role', { ids, role }),
  bulkFieldUpdate: (ids, field, value) => req('POST', '/artists/bulk-field-update', { ids, field, value }),
  bulkAddDate: (ids, date_entry) => req('POST', '/artists/bulk-add-date', { ids, date_entry }),
  bulkRemoveDates: (ids, type) => req('POST', '/artists/bulk-remove-dates', { ids, type }),

  // Presentations
  getPresentations: () => req('GET', '/presentations'),
  getPresentation: (id) => req('GET', `/presentations/${id}`),
  createPresentation: (name, data) => req('POST', '/presentations', { name, data }),
  updatePresentation: (id, name, data) => req('PUT', `/presentations/${id}`, { name, data }),
  deletePresentation: (id) => req('DELETE', `/presentations/${id}`),
  uploadPresentationImage: (dataUrl) => req('POST', '/presentations/upload-image', { dataUrl }),
  createAgent: (d) => req('POST', '/agents', d),

  // Artists
  getArtists: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/artists${qs ? '?' + qs : ''}`);
  },
  getArtistCounts: () => req('GET', '/artists/counts'),
  getArtist: (id) => req('GET', `/artists/${id}`),
  createArtist: (d, force = false) => req('POST', `/artists${force ? '?force=1' : ''}`, d),
  updateArtist: (id, d) => req('PUT', `/artists/${id}`, d),
  deleteArtist: (id) => req('DELETE', `/artists/${id}`),
  uploadHeadshot: (id, fd) => req('POST', `/artists/${id}/headshot`, fd),
  duplicateArtist: (id, d) => req('POST', `/artists/${id}/duplicate`, d),
  bulkCategory: (ids, category) => req('POST', '/artists/bulk-category', { ids, category }),
  bulkUpdate: (ids, fields) => req('POST', '/artists/bulk-update', { ids, fields }),
  importExcel: (fd) => req('POST', '/artists/import-excel', fd),
  exportArtists: (category) => downloadFile(`/api/artists/export/${category}`, `${category}-artists.xlsx`),
  exportAllArtists: () => downloadFile('/api/artists/export-all', 'all-artists.xlsx'),
  getArtistsByDateType: (type) => req('GET', `/artists/dates-by-type/${type}`),
  templateUrl: () => downloadFile('/api/artists/template', 'artist-import-template.xlsx'),

  // Pencil Dates
  getPencilDates: () => req('GET', '/pencil-dates'),
  createPencilDate: (d) => req('POST', '/pencil-dates', d),
  updatePencilDate: (id, d) => req('PUT', `/pencil-dates/${id}`, d),
  deletePencilDate: (id) => req('DELETE', `/pencil-dates/${id}`),
  addToPencilDate: (id, artist_ids) => req('POST', `/pencil-dates/${id}/artists`, { artist_ids }),
  removeFromPencilDate: (id, aid) => req('DELETE', `/pencil-dates/${id}/artists/${aid}`),

  // Call Sheets
  getCallSheets: (type) => req('GET', `/call-sheets${type ? '?type=' + type : ''}`),
  getFooterNotes: () => req('GET', '/call-sheets/footer-notes'),
  getCallSheet: (id) => req('GET', `/call-sheets/${id}`),
  createCallSheet: (d) => req('POST', '/call-sheets', d),
  updateCallSheet: (id, d) => req('PUT', `/call-sheets/${id}`, d),
  deleteCallSheet: (id) => req('DELETE', `/call-sheets/${id}`),
  promoteToFitting: (id) => req('POST', `/call-sheets/${id}/promote-to-fitting`),
  promoteToShoot: (id) => req('POST', `/call-sheets/${id}/promote-to-shoot`),
  callSheetPdfUrl: (id, notesSort, onProgress) => downloadFileWithProgress(`/api/call-sheets/${id}/pdf${notesSort ? `?notesSort=${notesSort}` : ''}`, `call-sheet-${id}.pdf`, onProgress),
  callSheetRosterPdfUrl: (id, onProgress) => downloadFileWithProgress(`/api/call-sheets/${id}/roster/pdf`, `call-sheet-${id}-roster.pdf`, onProgress),
  callSheetExcelUrl: (id) => downloadFile(`/api/call-sheets/${id}/excel`, `call-sheet-${id}.xlsx`),
  // Returns an object URL for the call sheet preview HTML so it can be set
  // as an <iframe src> — the iframe itself can't send the Authorization
  // header, so we fetch it authed and hand the iframe a blob: URL instead.
  callSheetPreviewBlobUrl: (id) => fetchBlobUrl(`/api/call-sheets/${id}/preview`),

  // Banners
  createBanner: (csId, d) => req('POST', `/call-sheets/${csId}/banners`, d),
  updateBanner: (id, d) => req('PUT', `/banners/${id}`, d),
  deleteBanner: (id) => req('DELETE', `/banners/${id}`),

  // Call Sheet Artists
  addToCallSheet: (csId, artist_ids, banner_id) => req('POST', `/call-sheets/${csId}/artists`, { artist_ids, banner_id }),
  updateCallSheetArtist: (csId, aid, d) => req('PUT', `/call-sheets/${csId}/artists/${aid}`, d),
  removeFromCallSheet: (csId, aid) => req('DELETE', `/call-sheets/${csId}/artists/${aid}`),
  moveToCallSheet: (targetId, sourceId, artist_ids) => req('POST', `/call-sheets/${targetId}/move-from/${sourceId}`, { artist_ids }),
  bulkUpdateCallSheetArtists: (csId, artist_ids, fields) => req('POST', `/call-sheets/${csId}/artists/bulk-update`, { artist_ids, fields }),

  // Fitting Dates
  getFittingDates: () => req('GET', '/fitting-dates'),
  createFittingDate: (d) => req('POST', '/fitting-dates', d),
  updateFittingDate: (id, d) => req('PUT', `/fitting-dates/${id}`, d),
  deleteFittingDate: (id) => req('DELETE', `/fitting-dates/${id}`),

  // Shoot Days
  getShootDays: () => req('GET', '/shoot-days'),
  createShootDay: (d) => req('POST', '/shoot-days', d),
  updateShootDay: (id, d) => req('PUT', `/shoot-days/${id}`, d),
  deleteShootDay: (id) => req('DELETE', `/shoot-days/${id}`),

  // Briefs
  getBriefs: () => req('GET', '/briefs'),
  getBrief: (id) => req('GET', `/briefs/${id}`),
  createBrief: (d) => req('POST', '/briefs', d),
  updateBrief: (id, d) => req('PUT', `/briefs/${id}`, d),
  deleteBrief: (id) => req('DELETE', `/briefs/${id}`),
  uploadMoodboard: (id, fd) => req('POST', `/briefs/${id}/moodboard`, fd),
  briefPdfUrl: (id, onProgress) => downloadFileWithProgress(`/api/briefs/${id}/pdf`, `casting-brief-${id}.pdf`, onProgress),

  // Roles to Fit
  getRolesToFit: () => req('GET', '/roles-to-fit'),
  createRoleToFit: (d) => req('POST', '/roles-to-fit', d),
  updateRoleToFit: (id, d) => req('PUT', `/roles-to-fit/${id}`, d),
  deleteRoleToFit: (id) => req('DELETE', `/roles-to-fit/${id}`),

  // Calendar
  getCalendar: () => req('GET', '/calendar'),

  // Z-Cards
  getZCards: () => req('GET', '/zcards'),
  getZCard: (id) => req('GET', `/zcards/${id}`),
  createZCard: (d) => req('POST', '/zcards', d),
  updateZCard: (id, d) => req('PUT', `/zcards/${id}`, d),
  deleteZCard: (id) => req('DELETE', `/zcards/${id}`),
  uploadZCardPhoto: (id, slot, fd) => req('POST', `/zcards/${id}/photo/${slot}`, fd),
  zCardPdfUrl: (id, onProgress) => downloadFileWithProgress(`/api/zcards/${id}/pdf`, `zcard-${id}.pdf`, onProgress),
};
