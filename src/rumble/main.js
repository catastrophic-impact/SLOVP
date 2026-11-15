const { app, ipcMain, shell, dialog, clipboard } = require('electron');
const { spawn, execFile } = require('child_process');
const { createFetcher } = require('./fetcher');
const fs = require('fs');
const path = require('path');

// SLRVP (Rumble) backend, as a module of SLOVP. Self-contained: its own data folder (<config>/rumble), its own IPC channels
// (prefixed 'rv:'), and suspend()/resume() so it does no work while the other tab is showing.
module.exports = function register(ctx) {
  const { readJson, writeJson, deps } = ctx;
  const dataDir = path.join(ctx.dataDir, 'rumble');
  const handle = (ch, fn) => ipcMain.handle('rv:' + ch, fn);
  const sendUi = ctx.send;
  const bundledFfmpeg = path.join(process.resourcesPath || '', 'bin', 'ffmpeg');
  const devFfmpeg = path.join(__dirname, '..', '..', 'build', 'ffmpeg');
  const ffmpegArgs = () => {
    const p = [deps.ffmpegLocation(), bundledFfmpeg, devFfmpeg].find((f) => f && fs.existsSync(f));
    return p ? ['--ffmpeg-location', p] : [];
  };
  const favFile = () => path.join(dataDir, 'favorites.json');
  const prefFile = () => path.join(dataDir, 'prefs.json');
  // While another tab is active this one is "paused": no new yt-dlp runs start and running ones are stopped.
  let paused = false;
  const active = new Set();
  const trackedExec = (...a) => { const c = execFile(...a); active.add(c); c.on('close', () => active.delete(c)); return c; };
const YTDLP = () => deps.ytdlp();

// ---- Rumble pages, read by a hidden text-only browser (see fetcher.js / scrape.js) --------------------------
const fetcher = createFetcher();

// Session-only cache (config/cache.json, deleted at launch): lists show instantly and refresh in the background.
const cacheFile = () => path.join(dataDir, 'cache.json');
let cacheData = null;
const loadCache = () => cacheData || (cacheData = readJson(cacheFile(), {}));
function cacheSet(key, value) {
  const c = loadCache();
  c[key] = { at: Date.now(), value };
  const keys = Object.keys(c);
  if (keys.length > 60) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 60).forEach((k) => delete c[k]);
  try { writeJson(cacheFile(), c); } catch {}
}
const cacheGet = (key) => loadCache()[key] || null;

const idOf = (u) => (String(u).match(/rumble\.com\/(?:shorts\/)?(v[a-z0-9]+)/i) || [])[1] || u;
// scraped card -> the video shape the UI uses
const toVideo = (it, fb) => ({
  id: idOf(it.url), url: it.url, title: it.title || '', duration: it.duration || null, views: it.views ?? null,
  channel: it.channel || fb?.name || '', channelUrl: it.channelUrl || fb?.url || '', thumb: it.thumb || '', published: it.published || 0,
  short: /\/shorts\//.test(it.url),
});

// https://rumble.com/c/Name  or  /user/Name  (optionally with /videos, ?page=...). Returns the base URL or null.
function channelBase(input) {
  let s = String(input || '').trim();
  if (/^(c|user)\/[^/\s]+$/i.test(s)) s = 'https://rumble.com/' + s;
  if (/^(www\.)?rumble\.com\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    const m = /(^|\.)rumble\.com$/i.test(u.hostname) && u.pathname.match(/^\/(c|user)\/([^/]+)/i);
    return m ? `https://rumble.com/${m[1].toLowerCase()}/${m[2]}` : null;
  } catch { return null; }
}
const chanKey = (input) => 'ch:' + (channelBase(input) || input).toLowerCase();

async function channelPage(base, n) {
  const r = await fetcher.get(`${base}/videos${n > 1 ? '?page=' + n : ''}`);
  return r;
}
function saveChannel(input, result) {
  cacheSet(chanKey(input), result);
  if (result.channel.url) cacheSet(chanKey(result.channel.url), result);
}
handle('channel-cached', (_e, input) => cacheGet(chanKey(input)));
// First page of a channel. Older pages already loaded by scrolling stay in the cache after a refresh.
handle('channel', async (_e, input) => {
  const base = channelBase(input);
  if (!base) throw new Error('That is not a Rumble channel address.');
  const r = await channelPage(base, 1);
  const channel = {
    name: r.h1 || r.items.find((i) => i.channel)?.channel || base.split('/').pop(),
    url: base, avatar: r.items.find((i) => i.avatar)?.avatar || r.og || null,
  };
  const videos = r.items.map((i) => toVideo(i, channel));
  const old = cacheGet(chanKey(input))?.value;
  const ids = new Set(videos.map((v) => v.id));
  const extra = (old?.videos || []).filter((v) => !ids.has(v.id));
  const result = old ? { channel, videos: [...videos, ...extra], done: old.done, pages: old.pages || 1 } : { channel, videos, done: !r.next, pages: 1 };
  saveChannel(input, result);
  return result;
});
// Page n of older videos, appended to the cached list so scrolling back later is instant.
handle('channel-more', async (_e, input, page) => {
  const base = channelBase(input);
  const r = await channelPage(base, page);
  const old = cacheGet(chanKey(input))?.value;
  const channel = old?.channel || { name: r.h1 || '', url: base };
  const ids = new Set((old?.videos || []).map((v) => v.id));
  const fresh = r.items.map((i) => toVideo(i, channel)).filter((v) => !ids.has(v.id));
  const done = !r.next || r.items.length === 0;
  if (old) saveChannel(input, { ...old, videos: [...old.videos, ...fresh], done, pages: Math.max(old.pages || 1, page) });
  return { videos: fresh, done };
});

// ---- Home: newest videos across all favorites ----
const feedSig = (favs) => favs.map((f) => f.url.toLowerCase()).sort().join('|');
handle('feed-cached', (_e, favs) => {
  const c = cacheGet('home');
  return c && c.value.sig === feedSig(favs) ? { at: c.at, videos: c.value.videos, done: !!c.value.done } : null;
});
const oldestOf = (vs) => vs.reduce((m, v) => (v.published && v.published < m ? v.published : m), Infinity);
handle('feed', async (_e, favs) => {
  const results = await Promise.all(favs.map(async (f) => { try { return { f, r: await channelPage(f.url, 1) }; } catch { return { f, r: null }; } }));
  const failed = results.filter((x) => !x.r);
  if (results.length && failed.length === results.length) throw new Error('Could not reach Rumble.');
  const old = cacheGet('home')?.value;
  const same = old && old.sig === feedSig(favs);
  const cursors = same ? { ...(old.cursors || {}) } : {};
  const fresh = [];
  for (const { f, r } of results) {
    if (!r) continue;
    const vs = r.items.map((i) => toVideo(i, f)).map((v) => ({ ...v, channel: f.name || v.channel, channelUrl: f.url }));
    fresh.push(...vs);
    if (!cursors[f.url]) cursors[f.url] = { page: 1, done: !r.next, oldest: oldestOf(vs) };
  }
  const ids = new Set(fresh.map((v) => v.id));
  const all = (same ? [...fresh, ...old.videos.filter((v) => !ids.has(v.id))] : fresh).sort((a, b) => b.published - a.published);
  const value = { sig: feedSig(favs), videos: all, cursors, done: favs.every((f) => cursors[f.url]?.done) };
  // A feed with failed channels is shown but never cached as fresh, so the next visit retries instead of keeping a partial list.
  if (!failed.length) cacheSet('home', value);
  return { at: Date.now(), videos: all, done: value.done, failed: failed.map((x) => x.f.name) };
});
// Home infinite scroll: fetch the next page of the few channels whose loaded videos stop at the newest date (they limit
// how far down the merged list is complete), so the list stays in date order without loading every channel every time.
let feedMoreBusy = null;
handle('feed-more', (_e, favs) => {
  if (feedMoreBusy) return feedMoreBusy;
  feedMoreBusy = (async () => {
    const c = cacheGet('home');
    if (!c || c.value.sig !== feedSig(favs)) return { videos: [], done: true };
    const cursors = c.value.cursors || {};
    const todo = favs.filter((f) => cursors[f.url] && !cursors[f.url].done).sort((a, b) => cursors[b.url].oldest - cursors[a.url].oldest).slice(0, 3);
    if (!todo.length) { cacheSet('home', { ...c.value, done: true }); return { videos: [], done: true }; }
    let failed = 0;
    const got = await Promise.all(todo.map(async (f) => {
      const page = cursors[f.url].page + 1;
      try {
        const r = await channelPage(f.url, page);
        const vs = r.items.map((i) => ({ ...toVideo(i, f), channel: f.name || i.channel, channelUrl: f.url }));
        cursors[f.url] = { page, done: !r.next || !vs.length, oldest: Math.min(cursors[f.url].oldest, oldestOf(vs)) };
        return vs;
      } catch { failed++; return []; }
    }));
    if (failed === todo.length) throw new Error('Could not reach Rumble.');
    const cur = cacheGet('home')?.value || c.value; // re-read: a Sync may have finished while these pages loaded
    const ids = new Set(cur.videos.map((v) => v.id));
    const fresh = got.flat().filter((v) => v.id && !ids.has(v.id)).sort((a, b) => b.published - a.published);
    const done = favs.every((f) => cursors[f.url]?.done);
    cacheSet('home', { ...cur, videos: [...cur.videos, ...fresh].sort((a, b) => b.published - a.published), cursors: { ...(cur.cursors || {}), ...cursors }, done });
    return { videos: fresh, done, sorted: true };
  })().finally(() => { feedMoreBusy = null; });
  return feedMoreBusy;
});

// ---- Search (page n) ----
handle('search', async (_e, q, page = 1) => {
  const r = await fetcher.get(`https://rumble.com/search/video?q=${encodeURIComponent(q)}${page > 1 ? '&page=' + page : ''}`);
  return { videos: r.items.map((i) => toVideo(i)), done: !r.next || !r.items.length };
});

// ---- yt-dlp ------------------------------------------------------------------------------------------------
// Rumble answers plain yt-dlp (its default connection fingerprint) with HTTP 403 on its embed API, but accepts a request that
// looks like Chrome. yt-dlp's own `--impersonate chrome` does that; if a build lacks it, fall back to a plain call.
const IMPERSONATE = ['--impersonate', 'chrome'];
function ytdlpRun(args, impersonate) {
  if (paused) return Promise.reject(new Error('Paused: another tab is active'));
  return new Promise((resolve, reject) => {
    trackedExec(YTDLP(), ['-J', '--no-warnings', '--socket-timeout', '20', ...(impersonate ? IMPERSONATE : []), ...args], { maxBuffer: 256 * 1024 * 1024, timeout: 90000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}
async function ytdlpOnce(args) {
  if (paused) return Promise.reject(new Error('Paused: another tab is active'));
  try { return await ytdlpRun(args, true); }
  catch (e) { if (/impersonat|curl_cffi/i.test(e.message)) return ytdlpRun(args, false); throw e; }
}
// Rumble rate-limits (HTTP 429): one retry after a pause, never more.
async function ytdlp(args) {
  try { return await ytdlpOnce(args); }
  catch (e) { if (!/429|timed out|timeout/i.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 2500)); return ytdlpOnce(args); }
}

const infoMemo = new Map();
async function getInfo(url) {
  const hit = infoMemo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  if (/\/shorts\//.test(url)) throw new Error('Rumble Shorts cannot be played yet: yt-dlp has no support for them.');
  const d = await ytdlp(['--no-playlist', url]);
  const seen = new Map();
  const streams = {}; // height -> stream URL (direct mp4 first, else HLS; highest bitrate), so MPV needs no yt-dlp
  let audioUrl = '';
  for (const f of d.formats || []) {
    // Rumble lists a storyboard ("timeline-180p") and the audio stream with heights too; neither is a playable video quality.
    if (!f.height || f.vcodec === 'none' || /^(timeline|audio)/.test(f.format_id || '') || f.ext === 'mhtml') continue;
    if (!seen.has(f.height)) seen.set(f.height, { height: f.height, label: f.height + 'p' });
    // direct HTTPS mp4 is preferred; HLS (m3u8) is the alternative some videos only have. MPV plays both natively.
    const rank = f.protocol === 'https' ? 2 : /m3u8/.test(f.protocol || '') ? 1 : 0;
    const cur = streams[f.height];
    if (f.url && rank && (!cur || rank > cur.rank || (rank === cur.rank && (f.tbr || 0) > cur.tbr))) streams[f.height] = { url: f.url, tbr: f.tbr || 0, rank };
  }
  audioUrl = ((d.formats || []).find((f) => /^audio/.test(f.format_id || '')) || {}).url || '';
  const qualities = [...seen.values()].sort((a, b) => b.height - a.height);
  const hasAudio = (d.formats || []).some((f) => /^audio/.test(f.format_id || ''));
  const data = {
    id: d.id, url: d.webpage_url || url, title: d.title, duration: d.duration, thumb: d.thumbnail || '',
    channel: d.channel || d.uploader || '', channelUrl: d.channel_url || '',
    views: d.view_count ?? null, likes: d.like_count ?? null,
    uploaded: d.timestamp ? d.timestamp * 1000 : null, isLive: !!d.is_live,
    description: (d.description || '').slice(0, 5000), qualities, hasAudio,
    streams: Object.fromEntries(Object.entries(streams).map(([h, v]) => [h, v.url])), audioUrl,
  };
  infoMemo.set(url, { at: Date.now(), data });
  return data;
}
handle('video-info', (_e, url) => getInfo(url));

// ---- MPV ---------------------------------------------------------------------------------------------------
function hostPrefix() {
  if (fs.existsSync('/run/.containerenv') || fs.existsSync('/.dockerenv')) return ['distrobox-host-exec'];
  if (fs.existsSync('/.flatpak-info')) return ['flatpak-spawn', '--host'];
  return [];
}
const runOk = (argv) => new Promise((resolve) => execFile(argv[0], argv.slice(1), { timeout: 15000 }, (err) => resolve(!err)));
async function detectMpv() {
  const pre = hostPrefix();
  if (await runOk([...pre, 'flatpak', 'info', 'io.mpv.Mpv'])) return [...pre, 'flatpak', 'run', 'io.mpv.Mpv'];
  if (await runOk([...pre, 'mpv', '--version'])) return [...pre, 'mpv'];
  return null;
}

const MPV_TUNING = ['--hwdec=auto-safe', '--cache-secs=120', '--demuxer-max-bytes=400MiB', '--demuxer-max-back-bytes=64MiB',
  '--cache-pause-initial=yes', '--cache-pause-wait=4', '--term-status-msg=SLSTAT ${=time-pos}'];
const PLAYED_OK = 3; // seconds of real playback after which an attempt counts as working

// One MPV attempt. Resolves ok once it has played PLAYED_OK seconds (or exits cleanly, or 45s pass), and fails
// if MPV exits with an error before that: this is what triggers the next-lower-resolution retry.
function runMpv(mpv, args) {
  return new Promise((resolve) => {
    let done = false, tail = '', played = 0;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const child = spawn(mpv[0], args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d) => {
      const text = d.toString();
      tail = (tail + text).slice(-1500);
      for (const m of text.matchAll(/SLSTAT ([\d.]+)/g)) played = Math.max(played, parseFloat(m[1]) || 0);
      if (played >= PLAYED_OK) finish({ ok: true });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => finish({ ok: false, code: 'LAUNCH_FAILED', message: err.message }));
    child.on('exit', (code) => finish(code === 0 ? { ok: true } : { ok: false, code: 'MPV_ERROR', message: tail.trim().split('\n').filter((l) => !l.startsWith('SLSTAT')).slice(-3).join('\n') || `MPV exited with code ${code}` }));
    const timer = setTimeout(() => finish({ ok: true }), 45000);
  });
}

// Heights to try, best first, never above the request (0 = best). A failing height falls through to the next lower one.
function heightChain(info, want) {
  const hs = (info?.qualities || []).map((q) => q.height).sort((a, b) => b - a);
  if (!hs.length) return [null]; // unknown formats (live etc.): one loose attempt
  if (!want) return hs;
  const lower = hs.filter((x) => x <= want);
  return lower.length ? lower : [hs[hs.length - 1]];
}
const fmtFor = (h) => (h ? `b[height=${h}]/bv*[height=${h}]+ba/b[height<=${h}]` : 'b/bv*+ba');

handle('play', async (_e, { url, height, audio, thumb }) => {
  const mpv = await detectMpv();
  if (!mpv) return { ok: false, code: 'MPV_MISSING' };
  // Our yt-dlp (with Chrome impersonation, see IMPERSONATE) finds Rumble's direct stream URLs; MPV plays those as plain
  // HTTPS with its own yt-dlp switched off, since the MPV flatpak's bundled yt-dlp is the plain, blocked kind.
  let info;
  try { info = await getInfo(url); } catch (e) { return { ok: false, code: 'INFO_FAILED', message: e.message }; }
  if (audio) {
    if (!info.audioUrl) return { ok: false, code: 'NO_AUDIO', message: 'This video has no separate audio stream.' };
    return runMpv(mpv, [...mpv.slice(1), '--ytdl=no', '--vid=1', '--force-window=yes', '--image-display-duration=inf', '--cache-pause-initial=yes',
      '--term-status-msg=SLSTAT ${=time-pos}', ...(thumb || info.thumb ? [`--external-file=${thumb || info.thumb}`] : []), info.audioUrl]);
  }
  const chain = heightChain(info, height).filter((h) => h && info.streams[h]);
  if (!chain.length) return { ok: false, code: 'NO_STREAM', message: 'No playable stream was found for this video.' };
  let last = null;
  for (const h of chain) {
    last = await runMpv(mpv, [...mpv.slice(1), '--ytdl=no', ...MPV_TUNING, info.streams[h]]);
    if (last.ok || last.code === 'LAUNCH_FAILED') return { ...last, height: h, requested: height || chain[0] };
  }
  return { ...last, tried: chain };
});

// ---- Downloads ---------------------------------------------------------------------------------------------
const safeName = (t) => (t || 'video').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 150) || 'video';
let downloading = false;
handle('download', async (e, { url, title, kind, height, audioExt, format }) => {
  if (downloading) return { ok: false, message: 'A download is already running.' };
  const AUDIO = { mp3: 'mp3', vorbis: 'ogg', opus: 'opus', m4a: 'm4a', flac: 'flac', wav: 'wav' };
  const VIDEO = ['mp4', 'mkv', 'webm'];
  const reencode = kind === 'audio' && AUDIO[format] ? format : null;
  const vfmt = VIDEO.includes(format) ? format : 'mp4';
  const ext = kind === 'audio' ? (reencode ? AUDIO[reencode] : (audioExt || 'aac')) : vfmt;
  const haveFfmpeg = ffmpegArgs().length > 0 || await runOk(['ffmpeg', '-version']);
  if ((kind === 'video' || reencode) && !haveFfmpeg) return { ok: false, code: 'FFMPEG_MISSING' };
  const r = await dialog.showSaveDialog(ctx.win(), {
    title: kind === 'audio' ? 'Save audio' : 'Save video',
    defaultPath: path.join(app.getPath('downloads'), `${safeName(title)}.${ext}`),
    filters: [{ name: kind === 'audio' ? 'Audio' : 'Video', extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const base = r.filePath.replace(/\.(mp4|mkv|webm|m4a|opus|ogg|mp3|aac|flac|wav)$/i, '');
  const fmt = kind === 'audio' ? 'ba/b' : fmtFor(height);
  const kindArgs = kind === 'audio' ? (reencode ? ['-x', '--audio-format', reencode, '--audio-quality', '0'] : []) : ['--merge-output-format', vfmt];
  const args = ['--no-playlist', '--no-warnings', '--newline', ...IMPERSONATE, '-f', fmt, ...kindArgs, ...ffmpegArgs(),
    '--progress-template', 'download:SLP %(progress._percent_str)s', '--print', 'after_move:SLPFILE %(filepath)s', '-o', `${base}.%(ext)s`, url];
  downloading = true;
  return new Promise((resolve) => {
    let file = '', tail = '';
    const child = spawn(YTDLP(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.startsWith('SLPFILE ')) file = line.slice(8).trim();
        else if (line.startsWith('SLP ')) sendUi('download-progress', line.slice(4).trim());
        else if (line.trim()) tail = (tail + '\n' + line).slice(-800);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => { downloading = false; resolve({ ok: false, message: err.message }); });
    child.on('exit', (code) => {
      downloading = false;
      resolve(code === 0 ? { ok: true, file } : { ok: false, message: tail.trim().split('\n').slice(-3).join('\n') || `yt-dlp exited with code ${code}` });
    });
  });
});


handle('ytdlp:status', () => deps.getStatus());
handle('ytdlp:check', () => deps.updateYtdlp({ force: true }));
handle('ffmpeg:install', () => deps.installFfmpeg());
handle('show-file', (_e, f) => { shell.showItemInFolder(f); return true; });
handle('favorites:get', () => readJson(favFile(), []));
handle('favorites:set', (_e, list) => { writeJson(favFile(), list); return true; });
handle('prefs:get', () => readJson(prefFile(), { quality: 'ask' }));
handle('prefs:set', (_e, p) => { writeJson(prefFile(), p); return true; });
handle('open-external', (_e, url) => (/^https?:\/\/[^\s]+$/i.test(url) ? shell.openExternal(url) : false));
handle('copy-text', (_e, t) => { clipboard.writeText(String(t)); return true; });


  try { fs.unlinkSync(cacheFile()); } catch {}
  cacheData = {};
  return {
    suspend() { paused = true; fetcher.suspend(); for (const c of active) { try { c.kill(); } catch {} } },
    resume() { paused = false; fetcher.resume(); },
    close() { fetcher.close(); },
  };
};
