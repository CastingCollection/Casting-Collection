import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Render.com (and most Node hosts) build and run the app in SEPARATE
// filesystems: `npm install` — which downloads Chromium as part of
// puppeteer's postinstall step — runs at build time, but that download
// normally lands in `$HOME/.cache/puppeteer`, a directory that does NOT
// carry over to the runtime container. The app's own project directory
// (node_modules, dist, etc.) DOES carry over, so pointing the cache inside
// it means the browser puppeteer downloaded at build time is still there
// when the server calls puppeteer.launch() at runtime.
//
// Without this, puppeteer.launch() can't find any Chromium binary at
// runtime — depending on exact failure mode this can surface as an
// immediate error OR as generic-pool's browser-acquire request hanging
// until its own timeout, which is what showed up here as PDF downloads
// simply never completing.
export default {
  cacheDirectory: path.join(__dirname, '.cache', 'puppeteer'),
};
