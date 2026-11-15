const $ = (s) => document.querySelector(s);
const state = { favs: [], prefs: { quality: 'ask' }, current: null };
const FRESH_MS = 10 * 60 * 1000; // cached Home/channel lists newer than this are not re-fetched automatically

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
}

// Inline SVG icons: no dependency on the host's symbol/emoji fonts.
const ICONS = {
  home: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  sync: 'M12 4V1L8 5l4 4V6a6 6 0 016 6c0 1-.25 1.97-.7 2.8l1.46 1.46A8 8 0 0012 4zm0 14a6 6 0 01-6-6c0-1 .25-1.97.7-2.8L5.24 7.74A8 8 0 0012 20v3l4-4-4-4z',
  copy: 'M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z',
  external: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zM5 5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-6h-2v6H5V7h6V5z',
  play: 'M8 5v14l11-7z',
  download: 'M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z',
  close: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
};
function icon(name, { sm = false, outline = false } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic' + (sm ? ' sm' : '') + (outline ? ' stroke' : ''));
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}
const withIcon = (name, text, opts) => [icon(name, opts), text ? ' ' + text : null].filter(Boolean);

const fmtDur = (s) => {
  if (!s) return '';
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(Math.floor(s % 60)).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
const fmtViews = (n) => n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M views' : n >= 1e3 ? Math.round(n / 1e3) + 'K views' : n + ' views';
function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  for (const [name, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]])
    if (s >= sec) { const n = Math.floor(s / sec); return `${n} ${name}${n > 1 ? 's' : ''} ago`; }
  return 'just now';
}

function avatar(name, url) {
  const a = h('div', { class: 'avatar' });
  if (url) a.append(h('img', { src: url })); else a.textContent = (name || '?')[0].toUpperCase();
  return a;
}

// ---------- favorites ----------
const favKey = (u) => (u || '').toLowerCase().replace(/\/$/, '');
const findFav = (url) => state.favs.find((f) => favKey(f.url) === favKey(url));
const isFav = (url) => !!url && !!findFav(url);
async function saveFavs() { await api.setFavorites(state.favs); renderFavs(); refreshStars(); }
async function toggleFav(ch) {
  if (!ch?.url) return;
  const have = findFav(ch.url);
  if (have) state.favs = state.favs.filter((f) => f !== have);
  else state.favs.push({ name: ch.name || ch.url.split('/').pop(), url: ch.url, avatar: ch.avatar || null });
  await saveFavs();
  if (state.current && favKey(state.current.url) === favKey(ch.url)) renderChanHead(state.current);
  if (!have && !ch.avatar) fillAvatar(ch.url);
}
// Favorited from a card: fetch the channel's name and picture in the background.
async function fillAvatar(url) {
  try {
    const r = await api.channel(url);
    const fav = findFav(url);
    if (!fav) return;
    Object.assign(fav, { name: r.channel.name || fav.name, avatar: r.channel.avatar || fav.avatar });
    await saveFavs();
  } catch {}
}
function refreshStars() {
  for (const b of document.querySelectorAll('.favstar')) {
    const on = isFav(b.dataset.url);
    b.classList.toggle('on', on);
    b.title = on ? 'Remove channel from favorites' : 'Add channel to favorites';
    b.replaceChildren(icon('star', { sm: true, outline: !on }));
  }
}
function favStar(name, url) {
  if (!url) return null;
  return h('button', { class: 'favstar', 'data-url': url, onclick: (e) => { e.stopPropagation(); toggleFav({ name, url }); } });
}
function renderFavs() {
  const ul = $('#favs');
  ul.replaceChildren(...state.favs.map((f) => h('li', { class: state.current && favKey(state.current.url) === favKey(f.url) ? 'active' : '', onclick: () => navigate({ type: 'channel', url: f.url }) },
    avatar(f.name, f.avatar),
    h('span', { class: 'name', title: f.name }, f.name),
    h('button', { class: 'rm', title: 'Remove', onclick: (e) => { e.stopPropagation(); toggleFav(f); } }, icon('close', { sm: true })))));
  $('#nofavs').hidden = state.favs.length > 0;
  $('#sidehome').classList.toggle('active', view.type === 'home');
}
function renderChanHead(ch) {
  const head = $('#chanhead');
  head.hidden = !ch;
  if (!ch) return;
  const on = isFav(ch.url);
  head.replaceChildren(avatar(ch.name, ch.avatar), h('h2', {}, ch.name),
    h('button', { class: 'btn' + (on ? ' on' : ''), onclick: () => toggleFav(ch) }, withIcon('star', on ? 'Favorited' : 'Favorite', { outline: !on })));
}

// ---------- grid ----------
const cardEl = (v) => h('div', { class: 'card', 'data-pub': v.published || 0, onclick: () => openVideoDialog(v.url, v) },
  h('div', { class: 'th' }, v.thumb ? h('img', { src: v.thumb, loading: 'lazy' }) : null,
    v.short ? h('span', { class: 'dur short' }, 'Short') : (v.duration ? h('span', { class: 'dur' }, fmtDur(v.duration)) : null)),
  h('div', { class: 'ti' }, v.title),
  h('div', { class: 'meta' },
    v.channel ? h('a', { onclick: (e) => { e.stopPropagation(); if (v.channelUrl) navigate({ type: 'channel', url: v.channelUrl }); } }, v.channel) : null,
    favStar(v.channel, v.channelUrl),
    h('span', {}, [v.views != null ? fmtViews(v.views) : '', v.published ? ago(v.published) : ''].filter(Boolean).join(' · '))));
function renderGrid(videos) {
  $('#grid').replaceChildren(...videos.map((v) => cardEl(v)));
  refreshStars();
}

// Infinite scroll: when the bottom marker scrolls into view, fetch() returns {videos, done} and the cards are added.
const more = { obs: null, fetch: null, busy: false, token: 0 };
function setupMore(fetch, done) {
  more.obs?.disconnect();
  more.fetch = fetch; more.busy = false; more.token++;
  const el = $('#more');
  el.hidden = done;
  el.textContent = done ? '' : 'Loading more…';
  if (done) return;
  more.obs = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) loadMore(); }, { root: $('main'), rootMargin: '400px' });
  more.obs.observe(el);
}
async function loadMore() {
  if (more.busy) return;
  more.busy = true;
  const tok = more.token, el = $('#more');
  try {
    const r = await more.fetch();
    if (tok !== more.token) return;
    if (r.sorted) { // Home: slot each card into date order rather than appending
      const grid = $('#grid');
      for (const v of r.videos) {
        const card = cardEl(v), pub = v.published || 0;
        const next = [...grid.children].find((c) => Number(c.dataset.pub) < pub);
        grid.insertBefore(card, next || null);
      }
    } else $('#grid').append(...r.videos.map((v) => cardEl(v)));
    refreshStars();
    if (r.done) { more.obs?.disconnect(); el.hidden = true; return; }
    more.obs.unobserve(el); more.obs.observe(el); // the marker may still be on screen (tall window): request the next page right away
  } catch (e) {
    if (tok !== more.token) return;
    more.obs?.disconnect();
    el.replaceChildren('Could not load more: ' + e.message + ' ', h('button', { class: 'btn small', onclick: () => { el.textContent = 'Loading more…'; more.obs.observe(el); } }, 'Retry'));
  } finally { if (tok === more.token) more.busy = false; }
}

function setStatus(t) { $('#status').textContent = t || ''; }
function showFailure(msg, retry) {
  $('#grid').replaceChildren();
  $('#status').replaceChildren(`Error: ${msg} `, h('button', { class: 'btn small', onclick: retry }, 'Retry'));
}

// ---------- navigation ----------
// Every navigation gets a token; slow responses from an earlier view are dropped instead of overwriting the current one.
let navId = 0;
let view = { type: 'home' };
const hist = [];
const sameView = (a, b) => a.type === b.type && a.url === b.url && a.q === b.q;
function updateNav() {
  $('#back').disabled = hist.length === 0;
  $('#sidehome').classList.toggle('active', view.type === 'home');
}
function navigate(v) {
  if (!sameView(view, v)) { hist.push(view); if (hist.length > 50) hist.shift(); }
  view = v;
  load(false);
}
function goBack() { if (!hist.length) return; view = hist.pop(); load(false); }
const goHome = () => navigate({ type: 'home' });

function renderToolbar(title, at, onSync, syncing) {
  const bar = $('#toolbar');
  bar.hidden = false;
  bar.replaceChildren(...[h('h2', {}, title),
    at ? h('span', { class: 'muted' }, `Updated ${ago(at)}`) : null,
    h('button', { class: 'btn small' + (syncing ? ' spin' : ''), title: 'Refresh from Rumble', onclick: syncing ? null : onSync }, withIcon('sync', syncing ? 'Syncing…' : 'Sync', { sm: true }))].filter(Boolean));
}
const failNote = (v) => (v?.failed?.length ? `Could not load ${v.failed.join(', ')}. Press Sync to retry.` : '');

// Show cached data instantly, then refresh in the background when stale (or when forced by the Sync button).
async function cachedLoad(my, { title, getCached, fetchFresh, apply, force }) {
  const cached = force ? null : await getCached();
  if (my !== navId) return;
  const resync = () => load(true);
  if (cached) { apply(cached.value, cached.at); renderToolbar(title, cached.at, resync, false); setStatus(''); }
  else { $('#grid').replaceChildren(); renderToolbar(title, 0, resync, true); setStatus('Loading…'); }
  if (cached && Date.now() - cached.at <= FRESH_MS) return;
  if (cached) renderToolbar(title, cached.at, resync, true);
  try {
    const value = await fetchFresh();
    if (my !== navId) return;
    apply(value, Date.now()); renderToolbar(title, Date.now(), resync, false); setStatus(failNote(value));
  } catch (e) {
    if (my !== navId) return;
    if (cached) { renderToolbar(title, cached.at, resync, false); setStatus('Could not refresh (showing saved results): ' + e.message); }
    else { $('#toolbar').hidden = true; showFailure(e.message, resync); }
  }
}

async function load(force) {
  const my = ++navId;
  const v = view;
  $('#modal').hidden = true;
  updateNav();
  $('#toolbar').hidden = true;
  setStatus('');
  more.obs?.disconnect(); more.token++; $('#more').hidden = true;
  if (v.type === 'home') {
    state.current = null; renderFavs(); renderChanHead(null);
    if (!state.favs.length) { $('#grid').replaceChildren(); setStatus('Add favorite channels to see their latest videos here. Search for a channel, open it and press the star.'); return; }
    return cachedLoad(my, {
      title: 'Latest from your favorites', force,
      getCached: async () => { const c = await api.feedCached(state.favs); return c && { at: c.at, value: c }; },
      fetchFresh: async () => api.feed(state.favs),
      apply: (r) => { renderGrid(r.videos); setupMore(() => api.feedMore(state.favs), !!r.done); },
    });
  }
  if (v.type === 'channel') {
    state.current = findFav(v.url) || { url: v.url, name: '' };
    renderFavs(); renderChanHead(state.current.name ? state.current : null);
    return cachedLoad(my, {
      title: 'Latest uploads', force,
      getCached: async () => api.channelCached(v.url),
      fetchFresh: () => api.channel(v.url),
      apply: (r) => {
        state.current = r.channel;
        const fav = findFav(r.channel.url);
        if (fav && (fav.avatar !== r.channel.avatar || fav.name !== r.channel.name)) { Object.assign(fav, { avatar: r.channel.avatar || fav.avatar, name: r.channel.name || fav.name }); saveFavs(); }
        renderFavs(); renderChanHead(r.channel); renderGrid(r.videos);
        let page = r.pages || 1;
        setupMore(async () => { const m = await api.channelMore(v.url, page + 1); page++; return m; }, !!r.done);
      },
    });
  }
  if (v.type === 'search') {
    state.current = null; renderFavs(); renderChanHead(null);
    $('#grid').replaceChildren(); setStatus('Searching…');
    try {
      const r = await api.search(v.q, 1);
      if (my !== navId) return;
      setStatus(r.videos.length ? '' : 'No results.'); renderGrid(r.videos);
      let page = 1;
      const seen = new Set(r.videos.map((x) => x.id)); // later pages can repeat a result
      setupMore(async () => { const m = await api.search(v.q, page + 1); page++; return { ...m, videos: m.videos.filter((x) => !seen.has(x.id) && seen.add(x.id)) }; }, !!r.done);
    } catch (e) { if (my === navId) showFailure(e.message, () => load(true)); }
  }
}

// ---------- dialogs ----------
function modalShell(...body) {
  const modal = $('#modal');
  const close = () => { modal.hidden = true; };
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.replaceChildren(h('div', { class: 'dialog wide' }, ...body));
  modal.hidden = false;
  return close;
}
const note = (msg) => {
  const bar = $('#dl');
  bar.replaceChildren(h('div', {}, msg), h('button', { class: 'btn', onclick: () => { bar.hidden = true; } }, 'OK'));
  bar.hidden = false;
};
function linkButtons(url) {
  const copy = h('button', { class: 'btn', onclick: async () => {
    await api.copyText(url);
    copy.replaceChildren(...withIcon('copy', 'Copied!'));
    setTimeout(() => copy.replaceChildren(...withIcon('copy', 'Copy link')), 1500);
  } }, withIcon('copy', 'Copy link'));
  return [copy, h('button', { class: 'btn', onclick: () => api.openExternal(url) }, withIcon('external', 'Open in browser'))];
}
const channelFavButton = (info) => {
  if (!info.channelUrl) return h('span');
  const ch = { name: info.channel, url: info.channelUrl.replace(/^http:/, 'https:') };
  const label = () => withIcon('star', isFav(ch.url) ? 'Channel favorited' : `Favorite ${info.channel || 'channel'}`, { outline: !isFav(ch.url) });
  const b = h('button', { class: 'btn', onclick: async () => { await toggleFav(ch); b.replaceChildren(...label()); } }, label());
  return b;
};

async function openVideoDialog(url, seed = {}) {
  let close = modalShell(seed.thumb ? h('img', { src: seed.thumb }) : null, h('h2', {}, seed.title || 'Loading…'), h('div', { class: 'muted' }, 'Fetching available qualities…'));
  let info;
  try { info = await api.videoInfo(url); }
  catch (e) {
    close = modalShell(seed.thumb ? h('img', { src: seed.thumb }) : null, h('h2', {}, seed.title || 'Could not load this video'), h('p', { class: 'muted' }, e.message),
      h('div', { class: 'row' }, h('span', { class: 'actions' }, linkButtons(url)), h('button', { class: 'btn', onclick: () => close() }, 'Close')));
    return;
  }
  // the page scrape knows the channel even when yt-dlp does not
  renderVideoDialog({ ...info, thumb: info.thumb || seed.thumb, channel: info.channel || seed.channel, channelUrl: info.channelUrl || seed.channelUrl });
}

function renderVideoDialog(info) {
  const qs = info.qualities;
  const pref = Number(state.prefs.quality);
  // preselect the preferred height, or the closest lower one
  const first = pref ? (qs.find((q) => q.height <= pref) || qs[qs.length - 1]) : null;
  let selected = first ? first.height : 0; // 0 = best
  const msg = first && first.height !== pref ? `${pref}p isn't available for this video, so ${first.label} is preselected.` : '';
  const chips = [];
  const playBtn = h('button', { class: 'btn primary' });
  const refresh = () => {
    chips.forEach(([height, el]) => el.classList.toggle('sel', height === selected));
    playBtn.replaceChildren(...withIcon('play', `Play ${selected ? selected + 'p' : 'Best'}`));
  };
  const addChip = (height, text) => { const el = h('button', { class: 'btn', onclick: () => { selected = height; refresh(); } }, text); chips.push([height, el]); return el; };
  const qChips = qs.map((q) => addChip(q.height, q.label));
  const opts = (list) => list.map(([v, t]) => h('option', { value: v }, t));
  const vsel = h('select', {}, qs.map((q) => h('option', { value: q.height }, q.label)));
  if (selected) vsel.value = String(selected);
  const asel = h('select', {}, opts([['best', 'Original (no conversion)'], ['mp3', 'MP3'], ['vorbis', 'OGG (Vorbis)'], ['opus', 'Opus'], ['m4a', 'M4A (AAC)'], ['flac', 'FLAC'], ['wav', 'WAV']]));
  const vfsel = h('select', {}, opts([['mp4', 'MP4 (most compatible)'], ['mkv', 'MKV'], ['webm', 'WebM']]));
  const audioBtn = h('button', { class: 'btn', title: 'Streams only the audio and shows the thumbnail in MPV' }, withIcon('play', 'Play audio only'));
  const close = modalShell(
    info.thumb ? h('img', { src: info.thumb }) : null,
    h('h2', {}, info.title),
    h('div', { class: 'muted' }, [info.channel, fmtDur(info.duration), info.uploaded ? `Uploaded ${ago(info.uploaded)}` : '', fmtViews(info.views)].filter(Boolean).join(' · ')),
    h('div', { class: 'sect' }, 'Play'),
    h('div', { class: 'qgrid' }, addChip(0, 'Best'), qChips),
    msg ? h('div', { class: 'note' }, msg) : null,
    h('div', { class: 'note' }, 'If a resolution fails to play, the next lower one is tried automatically.'),
    h('div', { class: 'actions' }, playBtn, info.hasAudio ? audioBtn : null),
    h('div', { class: 'sect' }, 'Download'),
    h('div', { class: 'dlrow' }, h('span', { class: 'lbl' }, 'Audio'), asel,
      h('button', { class: 'btn', onclick: () => { close(); startDownload(info, 'audio', 0, asel.value); } }, withIcon('download', 'Audio'))),
    h('div', { class: 'dlrow' }, h('span', { class: 'lbl' }, 'Video'), vsel, vfsel,
      h('button', { class: 'btn', onclick: () => { close(); startDownload(info, 'video', Number(vsel.value), vfsel.value); } }, withIcon('download', 'Video'))),
    h('div', { class: 'sect' }, 'Link'),
    h('div', { class: 'actions' }, linkButtons(info.url)),
    h('div', { class: 'row' }, channelFavButton(info), h('button', { class: 'btn', onclick: () => close() }, 'Close')));
  playBtn.addEventListener('click', () => { close(); openInMpv(info, selected, false); });
  audioBtn.addEventListener('click', () => { close(); openInMpv(info, 0, true); });
  refresh();
}

// ---------- playing ----------
let opening = false;
async function openInMpv(info, height, audio) {
  if (opening) return;
  opening = true;
  $('#opening').hidden = false;
  try {
    const r = await api.play({ url: info.url, height, audio, thumb: info.thumb });
    if (!r.ok) showError(r);
    else if (!audio && r.height && r.requested && r.height !== r.requested) note(`${r.requested}p would not play, so SLOVP is playing ${r.height}p instead.`);
  } catch (e) { showError({ code: 'LAUNCH_FAILED', message: e.message }); }
  finally { $('#opening').hidden = true; opening = false; }
}
function showError(r) {
  const body = r.code === 'MPV_MISSING'
    ? [h('h2', {}, 'MPV was not detected'),
       h('p', {}, 'SLOVP plays videos with MPV, but neither the MPV Flatpak nor a native mpv install was found:'),
       h('p', { class: 'muted' }, 'Flatpak:  flatpak install flathub io.mpv.Mpv'),
       h('p', { class: 'muted' }, 'Native:  sudo apt install mpv  ·  sudo pacman -S mpv  ·  sudo dnf install mpv')]
    : [h('h2', {}, 'Could not play the video'),
       r.tried?.length ? h('p', { class: 'muted' }, `Tried ${r.tried.map((x) => x + 'p').join(', ')}.`) : null,
       h('pre', { class: 'muted err' }, r.message || 'Unknown error')];
  const close = modalShell(...body, h('div', { class: 'row' }, h('span'), h('button', { class: 'btn', onclick: () => close() }, 'Close')));
}

// ---------- yt-dlp status / ffmpeg install ----------
function renderDepStatus(st) {
  const b = $('#depstatus');
  b.className = 'depstatus ' + st.state;
  b.replaceChildren(h('span', { class: 'dot' }), h('span', {}, `yt-dlp${st.version ? ' ' + st.version : ''} · ${st.message}`));
  b.title = st.message + ' — click to check for an update now';
}
$('#depstatus').addEventListener('click', () => { if (!/checking|updating/.test($('#depstatus').className)) api.ytdlpCheck(); });
api.onYtdlpStatus(renderDepStatus);
api.ytdlpStatus().then(renderDepStatus);

let ffmpegProgress = () => {};
api.onFfmpegProgress((p) => ffmpegProgress(p));
function offerFfmpegInstall(retry) {
  const status = h('div', { class: 'muted' });
  const go = h('button', { class: 'btn primary', onclick: async () => {
    go.disabled = true; cancel.hidden = true;
    ffmpegProgress = (p) => { status.textContent = p < 0 ? 'Unpacking…' : `Downloading… ${Math.round(p * 100)}%`; };
    status.textContent = 'Downloading…';
    const r = await api.installFfmpeg();
    ffmpegProgress = () => {};
    if (r.ok) { $('#modal').hidden = true; retry(); }
    else { status.textContent = `Could not install ffmpeg: ${r.message}`; go.disabled = false; cancel.hidden = false; }
  } }, withIcon('download', 'Download ffmpeg'));
  const cancel = h('button', { class: 'btn', onclick: () => close() }, 'Cancel');
  const close = modalShell(h('h2', {}, 'ffmpeg is needed'),
    h('p', {}, 'Saving video and converting audio need ffmpeg, which is not installed. SLOVP can download a static copy (about 42 MB, 160 MB on disk) into its config folder. It is not used for playback.'),
    status, h('div', { class: 'row' }, go, cancel));
}

// ---------- downloads ----------
let progressTarget = () => {};
api.onDownloadProgress((p) => progressTarget(p));
async function startDownload(info, kind, height, format) {
  const bar = $('#dl');
  const label = kind === 'audio' ? 'audio' : `${height}p video`;
  const show = (...kids) => { bar.replaceChildren(...kids.filter(Boolean)); bar.hidden = false; };
  progressTarget = (p) => { if (!bar.hidden && bar.dataset.busy) show(h('div', {}, `Downloading ${label}… ${p}`)); };
  bar.dataset.busy = '1';
  show(h('div', {}, `Choose where to save the ${label}…`));
  const r = await api.download({ url: info.url, title: info.title, kind, height, format });
  delete bar.dataset.busy;
  if (r.canceled) { bar.hidden = true; return; }
  if (r.code === 'FFMPEG_MISSING') { bar.hidden = true; offerFfmpegInstall(() => startDownload(info, kind, height, format)); return; }
  const dismiss = h('button', { class: 'btn', onclick: () => { bar.hidden = true; } }, 'Dismiss');
  if (r.ok) show(h('div', {}, `Saved ${label}`), r.file ? h('button', { class: 'btn', onclick: () => api.showFile(r.file) }, 'Show in folder') : null, dismiss);
  else show(h('div', { class: 'err' }, `Download failed: ${r.message}`), dismiss);
}

// ---------- input ----------
const RUMBLE_VIDEO = /rumble\.com\/(v[a-z0-9]+-[^?#\s]*\.html|shorts\/v[a-z0-9]+)/i;
const RUMBLE_CHANNEL = /^(https?:\/\/)?(www\.)?rumble\.com\/(c|user)\/[^/\s?#]+|^(c|user)\/[^/\s]+$/i;
function parseInput(s) {
  s = s.trim();
  if (RUMBLE_VIDEO.test(s)) return { type: 'video', value: s.startsWith('http') ? s : 'https://' + s };
  if (RUMBLE_CHANNEL.test(s)) return { type: 'channel', value: s };
  return { type: 'search', value: s };
}
$('#go').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#q').value;
  if (!v.trim()) return;
  const p = parseInput(v);
  if (p.type === 'video') openVideoDialog(p.value);
  else if (p.type === 'channel') navigate({ type: 'channel', url: p.value });
  else navigate({ type: 'search', q: p.value });
});
$('#pref').addEventListener('change', async (e) => { state.prefs.quality = e.target.value; await api.setPrefs(state.prefs); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#modal').hidden = true;
  if (e.key === 'BrowserBack' || (e.altKey && e.key === 'ArrowLeft')) goBack();
});
$('#back').append(icon('back'));
$('#homebtn').append(icon('home'));
$('#sidehome').append(icon('home'), 'Home');
$('#back').addEventListener('click', goBack);
$('#homebtn').addEventListener('click', goHome);
$('#sidehome').addEventListener('click', goHome);

(async function init() {
  state.favs = await api.getFavorites();
  state.prefs = await api.getPrefs();
  $('#pref').value = state.prefs.quality;
  load(false);
})();

// ---- SLOVP tab switching: this view is hidden while the other tab is active ----
let savedScroll = 0;
api.onSuspend(() => { savedScroll = $('main').scrollTop; navId++; more.obs?.disconnect(); more.token++; });
api.onResume(async () => { await load(false); setTimeout(() => { $('main').scrollTop = savedScroll; }, 300); });
