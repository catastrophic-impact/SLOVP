// A hidden, text-only browser used to read Rumble pages. Plain HTTP clients (curl, yt-dlp, node fetch) get 403/429 from
// Cloudflare; a real Chromium passes its check. So pages are loaded here with everything the scraper does not need
// switched off (images, video, fonts, stylesheets, ad/analytics hosts), the cards are read from the DOM, and the
// window stays hidden. Requests are queued one at a time with a pause between them to stay clear of rate limits.
const { BrowserWindow, session } = require('electron');
const { EXTRACT } = require('./scrape');

const MIN_GAP_MS = 1200;      // pause between page loads
const ATTEMPT_MS = [14000, 25000]; // a cold start can leave Cloudflare's first challenge stuck; a second navigation clears it
const IDLE_CLOSE_MS = 90000;  // close the hidden window when unused
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCKED_HOST = /(^|\.)(rmbl\.ws|doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com)$/i;

// The page we got must be the one we asked for (not the previous page still on screen).
function sameTarget(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const key = (u) => [u.pathname.toLowerCase().replace(/\/$/, ''), u.searchParams.get('q') || '', u.searchParams.get('page') || '1'].join('|');
    return key(x) === key(y);
  } catch { return false; }
}

function createFetcher() {
  let win = null, tail = Promise.resolve(), last = 0, idle = null, wired = false, gen = 0, suspended = false;

  function ensure() {
    const ses = session.fromPartition('persist:rumble-fetch');
    if (!wired) {
      wired = true;
      ses.webRequest.onBeforeRequest((d, cb) => {
        let host = '';
        try { host = new URL(d.url).hostname; } catch {}
        cb({ cancel: ['media', 'font', 'stylesheet'].includes(d.resourceType) || BLOCKED_HOST.test(host) });
      });
    }
    if (win && !win.isDestroyed()) return win;
    // images:false keeps each <img>'s own src (blocking the request instead makes Rumble swap in a blank placeholder)
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, images: false, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return win;
  }

  async function run(url, myGen, opts = {}) {
    const stale = () => myGen !== gen;
    const gap = MIN_GAP_MS - (Date.now() - last);
    if (gap > 0) await sleep(gap);
    if (stale()) throw new Error('Paused: another tab is active');
    clearTimeout(idle);
    if (stale()) throw new Error('Paused: another tab is active');
    const wc = ensure().webContents;
    let res = null;
    for (const budget of ATTEMPT_MS) {
      wc.loadURL(url).catch(() => {}); // aborts are normal while Cloudflare reloads the page; the polling below decides
      const t0 = Date.now();
      let firstSeen = 0, emptyChecks = 0;
      while (Date.now() - t0 < budget) {
        await sleep(350);
        if (stale()) throw new Error('Paused: another tab is active');
        let r;
        try { r = await wc.executeJavaScript(EXTRACT); } catch { continue; }
        if (r.challenge || !sameTarget(r.href, url)) continue;
        if (r.items.length) {
          if (!firstSeen) firstSeen = Date.now();
          res = r;
          if (Date.now() - firstSeen > 500) break; // let the rest of a lazily-rendered list arrive
        } else if (r.ready === 'complete' && ++emptyChecks >= 6) { res = r; break; } // loaded, still nothing: really empty
      }
      if (res) break;
    }
    // Pages like Rumble's homepage load more cards as you scroll: scroll down until no new ones appear.
    if (opts.scroll && res && res.items.length) {
      let still = 0;
      for (let i = 0; i < 8 && still < 2; i++) {
        try { await wc.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)'); } catch {}
        await sleep(1200);
        if (stale()) throw new Error('Paused: another tab is active');
        let r; try { r = await wc.executeJavaScript(EXTRACT); } catch { continue; }
        if (r.items.length > res.items.length) { res = r; still = 0; } else still++;
      }
    }
    last = Date.now();
    idle = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); win = null; }, IDLE_CLOSE_MS);
    if (!res) throw new Error('Rumble did not respond in time.');
    return res;
  }

  // One page at a time, in order.
  const get = (url, opts) => { if (suspended) return Promise.reject(new Error('Paused: another tab is active')); const g = gen; const p = tail.then(() => run(url, g, opts)); tail = p.catch(() => {}); return p; };
  // Drop everything queued or loading and close the hidden window (the other tab is showing).
  const suspend = () => { suspended = true; gen++; clearTimeout(idle); if (win && !win.isDestroyed()) win.destroy(); win = null; };
  const close = () => { clearTimeout(idle); if (win && !win.isDestroyed()) win.destroy(); win = null; };
  const resume = () => { suspended = false; };
  return { get, suspend, resume, close };
}

module.exports = { createFetcher };
