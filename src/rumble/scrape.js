// Page extractor, run inside the hidden Rumble page (see fetcher.js). Returns the video cards on the page as plain data.
// Three layers, most stable first, so a layout change degrades instead of breaking:
//   1. <rum-video-thumbnail> (channel pages): everything is in attributes, no class names involved
//   2. article.video-item / li.video-listing-entry (search results): small, named classes
//   3. generic: any link to a video page, with the card found by walking up until another video's link is reached
exports.EXTRACT = `(() => {
  const VID = /^https?:\\/\\/(www\\.)?rumble\\.com\\/(v[a-z0-9]+-[^?#]*\\.html|shorts\\/v[a-z0-9]+)/i;
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return ''; } };
  const clean = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; } };
  const txt = (e) => ((e && e.textContent) || '').replace(/\\s+/g, ' ').trim();
  const secs = (t) => { const p = String(t || '').trim().split(':').map(Number); return p.length && !p.some(isNaN) ? p.reduce((a, b) => a * 60 + b, 0) : null; };
  const when = (t) => { const v = Date.parse(t); return isNaN(v) ? 0 : v; };
  const count = (t) => { const m = String(t || '').replace(/,/g, '').match(/([\\d.]+)\\s*([KMB])?/i); return m ? Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1)) : null; };
  const real = (s) => (s && /^https?:/.test(s) ? s : '');
  const out = [], seen = new Set();
  const push = (v) => { const url = clean(abs(v.url)); if (!VID.test(url) || seen.has(url)) return; seen.add(url); out.push({ ...v, url }); };

  for (const el of document.querySelectorAll('rum-video-thumbnail')) {
    const views = el.getAttribute('views');
    push({ url: el.getAttribute('url'), title: el.getAttribute('video-title'), thumb: real(el.getAttribute('src')), duration: Number(el.getAttribute('duration')) || null,
      views: views ? Number(views) : null, published: when(el.getAttribute('time')), channel: el.getAttribute('name') || '',
      channelUrl: clean(abs(el.getAttribute('creator-url') || '')), avatar: real(el.getAttribute('avatar')) });
  }
  for (const card of document.querySelectorAll('article.video-item, li.video-listing-entry')) {
    const a = card.querySelector('a.video-item--a') || card.querySelector('a[href]');
    if (!a) continue;
    const by = card.querySelector('a.video-item--by-a, address a[href]');
    const byName = by ? txt(by.querySelector('.ellipsis-1') || by).replace(/\\s*Verified$/i, '') : '';
    push({ url: a.getAttribute('href'), title: txt(card.querySelector('.video-item--title')) || (card.querySelector('img') || {}).alt || '',
      thumb: real((card.querySelector('img') || {}).src), duration: secs((card.querySelector('.video-item--duration') || {}).dataset?.value),
      views: count((txt(card).match(/([\\d.,]+[KMB]?)\\s+views/i) || [])[1]), published: when(((card.querySelector('time[datetime]')) || {}).getAttribute?.('datetime')),
      channel: byName, channelUrl: by ? clean(abs(by.getAttribute('href'))) : '', avatar: '' });
  }
  // generic fallback for anything the two layers did not cover
  const links = [...document.querySelectorAll('a[href]')].map((a) => ({ a, url: clean(abs(a.getAttribute('href'))) }))
    .filter((l) => VID.test(l.url) && !seen.has(l.url) && !l.a.closest('[data-js="main_menu_channel_container"]'));
  const byUrl = new Map();
  for (const l of links) { if (!byUrl.has(l.url)) byUrl.set(l.url, []); byUrl.get(l.url).push(l.a); }
  const hasOther = (el, url) => [...byUrl.keys()].some((u) => u !== url && el.querySelector('a[href*="' + new URL(u).pathname.slice(0, 40).replace(/"/g, '') + '"]'));
  for (const [url, as] of byUrl) {
    let card = as[0];
    while (card.parentElement && card.parentElement !== document.body && !hasOther(card.parentElement, url)) card = card.parentElement;
    const img = card.querySelector('img');
    const dur = [...card.querySelectorAll('*')].map((e) => (e.dataset && e.dataset.value) || (e.children.length ? '' : txt(e))).find((t) => /^(\\d+:)?\\d{1,2}:\\d{2}$/.test(t));
    const time = card.querySelector('time[datetime]');
    push({ url, title: (img && img.alt && img.alt.trim()) || txt(as.sort((x, y) => txt(y).length - txt(x).length)[0]), thumb: real(img && img.src),
      duration: secs(dur), views: count((txt(card).match(/([\\d.,]+[KMB]?)\\s+views/i) || [])[1]), published: time ? when(time.getAttribute('datetime')) : 0, channel: '', channelUrl: '', avatar: '' });
  }
  const next = [...document.querySelectorAll('a[href*="page="]')].some((a) => /^next$/i.test(txt(a)) || a.rel === 'next');
  const meta = (p) => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? m.content : ''; };
  return { items: out, next, h1: txt(document.querySelector('h1')), og: meta('og:image'), title: document.title, href: location.href, ready: document.readyState,
    challenge: /just a moment|attention required/i.test(document.title) };
})()`;
