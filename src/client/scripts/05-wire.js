const RSS_SOURCES = [
  { id:'ANTARA', mode:'direct', url:'https://www.antaranews.com/rss/terkini.xml' },
  { id:'CNN INDONESIA', mode:'direct', url:'https://www.cnnindonesia.com/rss' },
  { id:'DETIK', mode:'proxy', url:'https://news.detik.com/rss' },
  { id:'GNEWS · DEMO', mode:'proxy', url:'https://news.google.com/rss/search?q=demo%20OR%20%22unjuk%20rasa%22%20OR%20%22aksi%20massa%22&hl=id&gl=ID&ceid=ID:id' },
  { id:'GNEWS · BENCANA', mode:'proxy', url:'https://news.google.com/rss/search?q=kebakaran%20OR%20banjir%20OR%20gempa%20OR%20karhutla&hl=id&gl=ID&ceid=ID:id' }
];
const PROXIES = [
  u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)
];
let SRC_IDS = null, onlyTopic = true, catFilter = 'semua', seenNews = new Set(), freshNews = new Set(), firstPull = true, mediaLoaded = false;
const lastGood = new Map();
const srcState = new Map();

const newsCatOf = h => {
  const cur = h && h.assessment && h.assessment.version === SitrepSignals.VERSION;

  return cur ? (h.cat || '') : ((h.cat || catOfTitle(h.title)) || '');
};
const newsCat = h => newsCatOf(h);
const topicOK = h => !!newsCatOf(h);
function renderCatbar(){
  const ids = ['semua', ...CAT_ORDER];
  $('#catbar').innerHTML = ids.map(c =>
    `<button class="cchip" type="button" data-cat="${esc(c)}" aria-pressed="${c === catFilter ? 'true' : 'false'}">${c === 'semua' ? 'Semua' : CAT_LABEL[c]}</button>`).join('');
}
$('#catbar').addEventListener('click', e => {
  const b = e.target.closest('.cchip'); if (!b) return;
  catFilter = b.dataset.cat;
  $$('#catbar .cchip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  if (descAbort) { try { descAbort.abort(); } catch (_) {} descAbort = null; }
  descBusy = false;
  clearTimeout(descTimer);
  descQueue.length = 0;
  descQueued.clear();
  renderNews();
});

const NEWS_BANNED = /infopublik|kompasiana|mozaik\.inilah\.com|mediacenter\.palangkaraya\.go\.id|viva\.co\.id\/foto|nokenlive|polreskedirikota|korankaltim/i;
function parseRss(xmlText, srcId){
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const out = [];
  doc.querySelectorAll('item').forEach(it => {
    const title = (it.querySelector('title') || {}).textContent || '';
    const link  = (it.querySelector('link') || {}).textContent || '';
    const date  = (it.querySelector('pubDate') || {}).textContent || '';
    const src   = (it.querySelector('source') || {}).textContent || '';
    const desc  = (it.querySelector('description') || {}).textContent || '';
    if (title && link && !NEWS_BANNED.test(title + ' ' + link + ' ' + src))
      out.push({ src:srcId, pub:src.trim() || undefined, title:title.trim(), url:link.trim(), desc:cleanDesc(desc), ts: date ? Date.parse(date) : 0 });
  });
  return out;
}
async function fetchText(url, ms){
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 12000);
  const ours = isOurUrl(url);
  try {
    const r = await fetch(url, { cache:'no-store', credentials: ours ? 'same-origin' : 'omit', signal:ctl.signal, headers: apiHeaders(url) });
    if (r.status === 401 && ours && SITREP_USER) { location.reload(); throw new Error('HTTP 401'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function fetchSource(s){
  if (s.mode === 'direct') return { items:parseRss(await fetchText(s.url), s.id), via:'langsung' };
  try { return { items:parseRss(await fetchText(s.url), s.id), via:'langsung' }; }
  catch (e) {  }
  let lastErr = null;
  for (const mk of PROXIES) {
    try { return { items:parseRss(await fetchText(mk(s.url)), s.id), via:'proxy' }; }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('semua proxy gagal');
}
let _mmCache = null, _mmSig = '';
function mergedMedia(){
  if (typeof WireCore === 'undefined') return [];

  let sig = '';
  lastGood.forEach(v => { sig += v.items.length + ':' + v.at + ';'; });
  if (_mmCache && sig === _mmSig) return _mmCache;
  const all = [], now = Date.now();
  lastGood.forEach(v => { if (now - v.at <= 25 * 60e3) all.push(...v.items); });

  _mmCache = WireCore.prepare(all, now);
  _mmSig = sig;
  return _mmCache;
}
function fallbackImgOK(u){
  if (!u || /news\.google\.com|lh3\.googleusercontent\.com/i.test(u)) return false;
  let p = u.split('?')[0];
  try { p = new URL(u, location.origin).pathname; } catch (e) {}
  if (/\.(svg|ico|cur|gif)$/i.test(p)) return false;
  if (/\/(image[-_]?404|404[-_]?image|no[-_]?image|not[-_]?found|logo|favicon|icon|avatar|sprite|badge|placeholder|default[-_])[^/]*$/i.test(p)) return false;
  if (/(?:^|\/)(?:logo|favicon|icons?|avatar|sprite|badge)(?:\/|[-_.])/i.test(p)) return false;
  const m = u.match(/[?&](?:w|width)=(\d{2,4})/i) || u.match(/\/(\d{2,4})x(\d{2,4})\//);
  return !(m && parseInt(m[1], 10) < 400);
}
function mediaVidHtml(v){
  if (!v) return '';
  if (v.kind === 'video') {
    const src = API != null ? tokQ(API + '/vhs?u=' + encodeURIComponent(v.url)) : v.url;
    const hlsFlag = /\.m3u8(\?|#|$)/i.test(v.url) ? ' data-hls="1"' : '';
    return `<video class="rd-vid" controls playsinline preload="metadata" src="${escUrl(src)}"${hlsFlag}${v.poster ? ` poster="${escUrl(v.poster)}"` : ''}></video>`;
  }
  if (v.kind !== 'iframe') return '';
  const yid = (String(v.url).match(/embed\/([\w-]{6,15})/i) || [])[1];
  if (!yid) return `<div class="rd-vid"><iframe src="${escUrl(v.url)}" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  return `<button class="rd-vid rd-facade" type="button" data-src="${escUrl(v.url)}">
    <img src="https://i.ytimg.com/vi/${yid}/hqdefault.jpg" alt="Video YouTube" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">
    <span class="rd-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  </button>`;
}
function leadVidWrapHtml(v, articleUrl){
  if (!v) return '';
  const isShort = /\/(?:shorts?|reels?)\b|youtube\.com\/shorts/i.test(String(articleUrl || ''));
  const inner = mediaVidHtml(v);
  if (!inner) return '';
  return `<div class="lead-vid nw-reveal" data-vurl="${esc(v.url)}"><span class="lead-vid-badge">${isShort ? 'SHORTS' : 'VIDEO'}</span>${inner}</div>`;
}
function stopLeadMedia(){
  const box = $('#lead');
  if (!box) return;
  box.querySelectorAll('.lead-vid video').forEach(v => {
    try { if (v._hls) { v._hls.destroy(); v._hls = null; } v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
  });
}
function mountLeadVideos(box){
  if (!box) return;
  box.querySelectorAll('.lead-vid video.rd-vid').forEach(v => { if (typeof rdMountVideo === 'function') rdMountVideo(v); });
}
function leadHtml(h, imageUrl = '', isLatest = true, video = null){
  const cat = newsCat(h);
  const rawDesc = descForItem(h) || h.desc || '';
  const desc = rawDesc && rawDesc.length > 200 ? rawDesc.slice(0, 200).replace(/\s+\S*$/, '') + '…' : rawDesc;
  const mediaHtml = imageUrl
    ? `<div class="lead-img"><img src="${escUrl(imageUrl)}" data-orig="${esc(imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="rdLeadImgFb(this)"></div>`
    : (video ? leadVidWrapHtml(video, h && h.url) : '');
  return `<a class="lead" data-cat="${esc(cat)}" href="${escUrl(h.url)}" target="_blank" rel="noopener">
    ${mediaHtml}
    <div class="lead-t">${cat ? `<span class="lead-cat">${CAT_LABEL[cat]}</span>` : ''}${h.foreign ? '<span class="lead-cat glob">Global</span>' : ''}<span class="lead-live">${isLatest ? 'Terbaru' : 'Sorotan'}</span><span class="lead-meta-r"><span class="lead-by">${esc(cleanSrc(h.src, h.pub))}</span><time>${esc(h.ts ? wibTime(h.ts) : '')} WIB</time></span></div>
    <h3>${esc(deEmoji(h.title))}</h3>
    ${desc && desc.length > 25 ? `<p class="lead-ex">${esc(deEmoji(desc))}</p>` : descPending(h) ? `<p class="lead-ex-sk nw-ex-sk" aria-hidden="true"><span class="nw-sk-line"></span><span class="nw-sk-line"></span><span class="nw-sk-line"></span></p>` : ''}
  </a>`;
}
const leadSkeletonHtml = () => `<div class="lead lead-skeleton" aria-hidden="true">
  <div class="nw-sk-line lead-sk-image"></div><div class="nw-sk-line lead-sk-meta"></div>
  <div class="nw-sk-line lead-sk-title"></div><div class="nw-sk-line lead-sk-title short"></div>
  <div class="nw-sk-line lead-sk-desc"></div><div class="nw-sk-line lead-sk-desc"></div><div class="nw-sk-line lead-sk-desc mid"></div>
</div>`;
let leadRenderURL = '', leadRenderId = 0;
const leadThumbs = new Map();
const leadVideos = new Map();
const leadImgRejected = new Set();
const leadImgFailAt = new Map();
const leadImgInFlight = new Set();
const isVideoLikeUrl = u => /\/(?:shorts?|video|videos|20detik|watch|reel)\b|(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(String(u || ''));
const pickPlayableVideo = vids => Array.isArray(vids) ? vids.find(v => v && (v.kind === 'iframe' || v.kind === 'video') && v.url) || null : null;
const rememberLeadVideos = (urls, vids) => {
  const clean = Array.isArray(vids) ? vids.filter(v => v && (v.kind === 'iframe' || v.kind === 'video') && v.url) : [];
  if (!clean.length) return;
  for (const u of urls) {
    if (!u) continue;
    leadVideos.set(u, clean);
    if (leadVideos.size > 160) leadVideos.delete(leadVideos.keys().next().value);
  }
};

function preloadLeadImage(src, ms = 8000){
  const dimOK = img => {
    const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
    if (w < 200 || h < 120) return false;
    const ar = w / h;
    return ar >= 0.45 && ar <= 3.2;
  };
  const loadOne = u => new Promise(resolve => {
    if (!u) return resolve('');
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    let settled = false;
    const done = ok => { if (settled) return; settled = true; clearTimeout(t); resolve(ok ? u : ''); };
    const t = setTimeout(() => done(false), ms);
    img.onload = () => done(dimOK(img));
    img.onerror = () => done(false);
    img.src = u;
    if (img.complete && img.naturalWidth > 0) done(dimOK(img));
  });
  return loadOne(src).then(ok => {
    if (ok || !/^http:\/\//i.test(src)) return ok;
    return loadOne(src.replace(/^http:\/\//i, 'https://'));
  });
}
function attachLeadImage(url, imageUrl){
  if (!imageUrl || leadRenderURL !== url) return;
  const el = $('#lead .lead');
  if (!el || el.getAttribute('href') !== url || el.querySelector('.lead-img')) return;
  const staleVid = el.querySelector('.lead-vid');
  if (staleVid) staleVid.remove();
  el.insertAdjacentHTML('afterbegin',
    `<div class="lead-img nw-reveal"><img src="${escUrl(imageUrl)}" data-orig="${esc(imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="rdLeadImgFb(this)"></div>`);
}
function attachLeadVideo(url, video){
  if (!video || !video.url || leadRenderURL !== url) return;
  const el = $('#lead .lead');
  if (!el || el.getAttribute('href') !== url || el.querySelector('.lead-img') || el.querySelector('.lead-vid')) return;
  const html = leadVidWrapHtml(video, url);
  if (!html) return;
  el.insertAdjacentHTML('afterbegin', html);
  mountLeadVideos(el);
}

const thumbPending = new Map();
function rdProxyImgUrl(u){
  if (!u || typeof API === 'undefined' || API == null || /^data:|\/img\?/i.test(u)) return u;
  return tokQ(API + '/img?u=' + encodeURIComponent(u));
}
function rdMediaImgSrc(u, needProxy){
  return (needProxy && typeof API !== 'undefined' && API != null) ? rdProxyImgUrl(u) : u;
}
function pickVerifiedMediaImg(d){
  if (!d) return '';
  if (d.img && d.imgVerified !== false) return rdMediaImgSrc(d.img, d.imgProxy);
  if (d.imgStatus !== 'rejected' && d.media && Array.isArray(d.media.bodyImages)) {
    const b = d.media.bodyImages.find(x => x && x.verified && x.url && x.width >= 360);
    if (b) return rdMediaImgSrc(b.url, b.proxy);
  }
  return '';
}
function fetchThumbInfo(url, h){
  if (h && Array.isArray(h.videos) && h.videos.length) rememberLeadVideos([url, h.canonicalUrl], h.videos);
  const hit = leadThumbs.get(url);
  if (Array.isArray(hit)) return Promise.resolve(hit);
  const rdHit = rdCache.get(url);
  if (rdHit && rdHit.ok) {
    const rdPick = pickVerifiedMediaImg(rdHit);
    if (rdPick) {
      leadThumbs.set(url, [rdPick]);
      return Promise.resolve([rdPick]);
    }
  }
  const needVideoProbe = !leadVideos.has(url) && isVideoLikeUrl(url);
  if (leadImgRejected.has(url) && !needVideoProbe) return Promise.resolve([]);
  let p = thumbPending.get(url);
  if (!p) {
    p = (async () => {
      const imgs = [];
      if (API != null) {
        if (h && h.imgVerified && h.img) {
          imgs.push(rdMediaImgSrc(h.img, h.imgProxy));
        } else if (h && h.imgRejected && !needVideoProbe) {
          leadImgRejected.add(url);
          if (leadImgRejected.size > 300) leadImgRejected.delete(leadImgRejected.keys().next().value);
          return imgs;
        } else {
          try {
            const d = await getJson(API + '/api/thumb?u=' + encodeURIComponent(url), 14000, 0);
            if (d && d.ok) {
              if (Array.isArray(d.videos) && d.videos.length) rememberLeadVideos([url, d.canonicalUrl, d.src], d.videos);
              if (d.img && d.verified !== false) {
                imgs.push(rdMediaImgSrc(d.img, d.proxy));
                leadImgRejected.delete(url);
              } else if (!d.transient && d.status === 'rejected') {
                leadImgRejected.add(url);
                if (leadImgRejected.size > 300) leadImgRejected.delete(leadImgRejected.keys().next().value);
              }
            }
          } catch (e) {}
        }
      } else if (h && h.img && fallbackImgOK(h.img)) {
        imgs.push(h.img);
      }
      if (imgs.length) {
        leadThumbs.set(url, imgs);
        if (leadThumbs.size > 120) leadThumbs.delete(leadThumbs.keys().next().value);
      }
      return imgs;
    })().finally(() => thumbPending.delete(url));
    thumbPending.set(url, p);
  }
  return p;
}
async function resolveLeadImage(h, isStale){
  if (!h || !h.url) return '';
  leadImgInFlight.add(h.url);
  try {
    const tried = new Set();
    const tryLoad = async src => {
      if (!src || tried.has(src) || isStale()) return '';
      tried.add(src);
      return await preloadLeadImage(src, 8000);
    };
    const candidates = await fetchThumbInfo(h.url, h);
    if (isStale()) return '';

    if (leadImgRejected.has(h.url)) return '';
    let imageUrl = '';
    for (const src of candidates) {
      imageUrl = await tryLoad(src);
      if (imageUrl) return imageUrl;
      if (API != null && src && !/\/img\?/i.test(src)) {
        imageUrl = await tryLoad(rdProxyImgUrl(src));
        if (imageUrl) return imageUrl;
      }
    }

    if (!imageUrl && API != null && !isStale() && !leadImgRejected.has(h.url)) {
      try {
        let article = rdCache.get(h.url) || null;
        if (!article) {
          article = await getJson(API + '/api/read?u=' + encodeURIComponent(h.url) + '&bg=1', 18000, 0);
          if (article && article.ok && !article.wireFallback && !article.upstreamBlocked && !article.isFallback) {
            rdCache.set(h.url, article);
            if (rdCache.size > 80) rdCache.delete(rdCache.keys().next().value);
          }
        }
        if (article && article.ok) {
          rdSyncWireDesc(article, h.url);
          const avs = Array.isArray(article.videos) && article.videos.length
            ? article.videos
            : (Array.isArray(article.blocks) ? article.blocks.filter(b => b && b.k === 'v' && b.v).map(b => b.v) : []);
          if (avs.length) rememberLeadVideos([h.url, article.url, article.final, article.canonicalUrl], avs);
          const verifiedCandidate = !leadImgRejected.has(h.url) ? pickVerifiedMediaImg(article) : '';
          if (verifiedCandidate) {
            imageUrl = await tryLoad(verifiedCandidate);
          } else if (article.imgStatus === 'rejected') {
            leadImgRejected.add(h.url);
          }
        }
      } catch (e) {}
    }
    return imageUrl;
  } finally {
    leadImgInFlight.delete(h.url);
  }
}
async function resolveLeadVideo(h, isStale){
  if (!h || !h.url || isStale()) return null;
  let vid = pickPlayableVideo(leadVideos.get(h.url) || h.videos);
  if (vid) return vid;
  const rdHit = rdCache.get(h.url);
  if (rdHit && rdHit.ok) {
    const avs = Array.isArray(rdHit.videos) && rdHit.videos.length
      ? rdHit.videos
      : (Array.isArray(rdHit.blocks) ? rdHit.blocks.filter(b => b && b.k === 'v' && b.v).map(b => b.v) : []);
    rememberLeadVideos([h.url, rdHit.canonicalUrl], avs);
    vid = pickPlayableVideo(avs);
    if (vid) return vid;
  }
  if (API != null && !isStale() && !leadVideos.has(h.url)) {
    try {
      const t = await getJson(API + '/api/thumb?u=' + encodeURIComponent(h.url), 14000, 0);
      if (t && t.ok && Array.isArray(t.videos) && t.videos.length) {
        rememberLeadVideos([h.url, t.canonicalUrl, t.src], t.videos);
        vid = pickPlayableVideo(t.videos);
        if (vid) return vid;
      }
    } catch (e) {}
    if (isStale()) return null;
    try {
      const article = await getJson(API + '/api/read?u=' + encodeURIComponent(h.url) + '&bg=1', 18000, 0);
      if (article && article.ok && !isStale()) {
        rdSyncWireDesc(article, h.url);
        const avs = Array.isArray(article.videos) && article.videos.length
          ? article.videos
          : (Array.isArray(article.blocks) ? article.blocks.filter(b => b && b.k === 'v' && b.v).map(b => b.v) : []);
        rememberLeadVideos([h.url, article.url, article.final, article.canonicalUrl], avs);
        vid = pickPlayableVideo(avs);
        if (vid) return vid;
      }
    } catch (e) {}
  }
  return null;
}
async function renderLead(h, isLatest = true){
  const id = ++leadRenderId;
  leadRenderURL = h && h.url || '';
  stopLeadMedia();
  const box = $('#lead');
  if (!h) { box.setAttribute('aria-busy', 'false'); box.innerHTML = ''; return; }
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = leadSkeletonHtml();

  let revealed = false;
  const isStale = () => id !== leadRenderId || leadRenderURL !== h.url;
  const reveal = (imageUrl, video) => {
    if (isStale()) return;
    revealed = true;
    box.innerHTML = leadHtml(h, imageUrl || '', isLatest, video || null);
    mountLeadVideos(box);
    box.setAttribute('aria-busy', 'false');
    bindDescObserver();
  };

  const grace = setTimeout(() => { if (!revealed && !isStale()) reveal('', null); }, 1800);

  const imageUrl = await resolveLeadImage(h, isStale);
  if (isStale()) { clearTimeout(grace); return; }
  if (imageUrl) {
    clearTimeout(grace);
    leadImgFailAt.delete(h.url);
    const saved = Array.isArray(leadThumbs.get(h.url)) ? leadThumbs.get(h.url) : [];
    if (!saved.includes(imageUrl)) saved.push(imageUrl);
    leadThumbs.set(h.url, saved);
    if (!revealed) reveal(imageUrl, null);
    else attachLeadImage(h.url, imageUrl);
    return;
  }

  const video = await resolveLeadVideo(h, isStale);
  clearTimeout(grace);
  if (isStale()) return;
  if (video) {
    if (!revealed) reveal('', video);
    else attachLeadVideo(h.url, video);
  } else {
    leadThumbs.delete(h.url);
    leadImgFailAt.set(h.url, Date.now());
    if (!revealed) reveal('', null);
  }
}
function newsHtml(h, full){
  const isNew = freshNews.has(h.title);
  const cat = newsCat(h);
  const ext = descForItem(h) || (h.desc && h.desc.length > 25 ? h.desc : '');

  return `<a class="nw${full ? ' nw-full' : ''}" data-cat="${esc(cat)}" href="${escUrl(h.url)}" target="_blank" rel="noopener">
    <div class="nw-top">${cat ? `<span class="nw-cat">${CAT_LABEL[cat]}</span>` : ''}${h.foreign ? '<span class="nw-cat glob">Global</span>' : ''}<time>${esc(h.ts ? wibTime(h.ts) : '')}</time></div>
    <div class="nw-src">${esc(cleanSrc(h.src, h.pub))}${isNew ? '<span class="new">Baru</span>' : ''}${h.n > 1 ? `<span class="dup-n" title="${esc([...h.srcs].map(s => cleanSrc(s)).filter(Boolean).join(', '))}">×${h.n} artikel</span>` : ''}</div>
    <h3>${esc(deEmoji(h.title))}</h3>
    ${ext ? `<p class="nw-ex">${esc(deEmoji(ext))}</p>` : descPending(h) ? `<p class="nw-ex-sk" aria-hidden="true"><span class="nw-sk-line"></span><span class="nw-sk-line short"></span></p>` : ''}
  </a>`;
}
const dayKey = ts => ts ? new Date(ts).toLocaleDateString('id-ID',
  { timeZone:'Asia/Jakarta', day:'2-digit', month:'short', year:'numeric' }) : '';

const stripPubTail = (title, pub) => {
  if (!pub) return title;
  const pk = pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let q;
  do { q = title; title = title.replace(new RegExp('\\s*[-–—]\\s*' + pk + '\\s*$', 'i'), '').trim(); } while (title !== q);
  return title;
};

const NEWS_SRC_RE = /(kompas|detik\w*|tempo|liputan6|republika|tribun\w*|cnbc\w*|antara\w*|voi\.?id|sindonews|okezone|jawapos|merdeka\.com|bisnis\.com|kontan|inews|suara\.com|merahputih|katadata|markeyeers|metrotv\w*|tvonenews|grid\.id|wowkeren|hotliputan6|wolipop|cewekbanget|female daily|poskota|bali ?post|balipost|\bjabar\b|\bjogja\b|espos|malang post|suara merdeka|pikiran-rakyat|bola\.com|jalantikus|kumparan|beritasatu|rmol|hops\.id|mediaindonesia|media indonesia|\brri\b|tagar|cnn indonesia|cnnindonesia|viva|\bmoney\.kompas\b|finance detik)/i;
const DESC_DOMAIN_RE = /\S*\.(com|co\.id|co\.uk|or\.id|go\.id|ac\.id|sch\.id|net|org|tv|info|media|news|id)\b/i;
const BOT_CHALLENGE_RE = /captcha|recaptcha|lsrecaptcha|cf-chl|challenge-platform|just a moment|attention required|access denied|verify you are|are you a robot|enable javascript and cookies|bot verification|ddos-guard|pardon our interruption|security check|situs ini mungkin memblokir|requiring captcha/i;
function cleanDesc(d){
  let t = String(d || '');
  if (!t || BOT_CHALLENGE_RE.test(t)) return '';
  t = t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ').trim();
  if (!t) return '';

  const cut = t.search(/\b(baca selengkapnya|selengkapnya di|baca juga|kunjungi (?:kami|situs|website)|klik di sini|baca:)\b/i);
  if (cut > 0) t = t.slice(0, cut).replace(/\s+$/, '');

  t = t.replace(/\s+sumber\s*(?:[:：]|[-–—]{1,2})\s*[^.,;!)\]\-–—]{0,60}/gi, ' ');

  for (let i = 0; i < 4; i++) {
    const q = t;
    t = t.replace(/(?:\s*(?:\.{3}|…))+\s*$/, '');
    const mm = t.match(/\s*(?:[-–—|•·]|\bsumber\s*[:：\-–—]?)\s*(\S{1,80})\s*$/i);
    const cand = mm || t.match(/\s*(\S{1,80})\s*$/);

    if (cand && (DESC_DOMAIN_RE.test(cand[1]) || (mm && NEWS_SRC_RE.test(cand[1])))) {
      t = t.slice(0, t.length - cand[0].length).trim();
      continue;
    }
    break;
  }

  t = t.replace(/^[A-Z][A-Z0-9 .&']{2,50}\s*[-–—]+\s*/, '');
  return t.replace(/[\s\-–—|•·]+$/, '').replace(/\s+/g, ' ').trim();
}

let _nwDedup = null;
function dedupWire(mapped){
  if (_nwDedup && _nwDedup.src === _mmCache) return _nwDedup.list;
  const items = mapped.slice();

  {
    const toks = t => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
    const jac = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n || 1); };
    const sigs = [], collapsed = [];
    for (const h of items) {
      const sig = toks(h.title);
      const hit = sigs.find(s => jac(s.set, sig) > 0.72);
      if (hit) {
        hit.rec.n++; hit.rec.srcs.add(h.pub || h.src || ''); hit.rec.ts = Math.max(hit.rec.ts || 0, h.ts || 0);

        (hit.rec.alt = hit.rec.alt || new Set()).add(h.url);

        if ((h.desc || '').length > (hit.rec.desc || '').length) {
          hit.rec.desc = h.desc;
          if (h.imgVerified && h.img) {
            hit.rec.url = h.url; hit.rec.pub = h.pub; hit.rec.src = h.src;
            hit.rec.img = h.img; hit.rec.imgVerified = true; hit.rec.imgRejected = false;
            hit.rec.canonicalUrl = h.canonicalUrl || h.url;
          } else {
            hit.rec.pub = h.pub; hit.rec.src = h.src;
          }
        }
        continue;
      }
      const rec = { ...h, n: 1, srcs: new Set([h.pub || h.src || '']), alt: new Set() };
      sigs.push({ set: sig, rec }); collapsed.push(rec);
    }
    items.length = 0; items.push(...collapsed);
  }

  {
    const WIRE_STOP = new Set(['dalam','untuk','karena','akibat','terjadi','warga','sekitar','wilayah','daerah','kawasan','lokasi','diduga','hebat','besar','parah','malam','siang','subuh','kemarin','barusan','selatan','utara','timur','barat','tengah','pusat','provinsi','kabupaten','kecamatan','kelurahan','jakarta','bandung','surabaya','medan','semarang','makassar','palembang','depok','bekasi','tangerang','bogor']);
    const toks = t => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
    const jac = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n || 1); };
    const df = new Map();
    items.forEach(h => toks(h.title).forEach(w => df.set(w, (df.get(w) || 0) + 1)));
    const rareOf = h => {
      const pToks = h.place ? toks(h.place) : null;
      return new Set([...toks(h.title)].filter(w => w.length > 4 && !WIRE_STOP.has(w) && !(pToks && pToks.has(w)) && (df.get(w) || 0) <= 20));
    };
    const byCat = new Map(), rest = [];
    items.forEach(h => {
      if (!h.cat) { rest.push(h); return; }
      if (!byCat.has(h.cat)) byCat.set(h.cat, []);
      byCat.get(h.cat).push(h);
    });
    const out = [...rest];
    for (const list2 of byCat.values()) {
      if (list2.length > 400) { out.push(...list2); continue; }
      const sig = list2.map(h => ({ set: toks(h.title), rare: rareOf(h), place: (h.place || '').toLowerCase() }));
      const par = list2.map((_, i) => i);
      const find = i => par[i] === i ? i : (par[i] = find(par[i]));
      const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; };
      for (let i = 0; i < list2.length; i++) for (let k = i + 1; k < list2.length; k++) {
        if (sig[i].place && sig[k].place && sig[i].place !== sig[k].place) continue;
        if (jac(sig[i].set, sig[k].set) > 0.5) { uni(i, k); continue; }
        let shared = 0;
        for (const w of sig[i].rare) if (sig[k].rare.has(w) && ++shared >= 2) { uni(i, k); break; }
      }
      const groups = new Map();
      list2.forEach((h, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(h); });
      for (const g of groups.values()) {
        if (g.length === 1) { out.push(g[0]); continue; }
        g.sort((a, b) => (b.ts || 0) - (a.ts || 0));

        const base = g.reduce((a, b) => ((b.desc || '').length > (a.desc || '').length ? b : a), g[0]);

        const alt = new Set(base.alt || []);
        for (const x of g) { alt.add(x.url); if (x.alt instanceof Set) for (const u of x.alt) alt.add(u); }
        alt.delete(base.url);
        out.push({ ...base, img: (base.imgVerified || API == null) ? (base.img || '') : '',
          n: g.reduce((s, x) => s + (x.n || 1), 0),
          srcs: new Set(g.flatMap(x => [...(x.srcs || [x.pub || x.src || ''])])),
          ts: Math.max(...g.map(x => x.ts || 0)), alt });
      }
    }
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    items.length = 0; items.push(...out);
  }
  _nwDedup = { src: _mmCache, list: items };
  return items;
}
function renderNews(){
  const mapped = mergedMedia().map(h => {
    const title = stripPubTail(cleanTitle(h.title, h.pub), tkPub(h.pub));
    const m = { ...h, title, desc: cleanDesc(h.desc) || descForItem(h) };
    m.cat = newsCatOf(m);
    return m;
  });
  const items = dedupWire(mapped);
  const q = ($('#fq').value || '').toLowerCase();
  const list = items.filter(h => (!onlyTopic || topicOK(h)) && (catFilter === 'semua' || h.cat === catFilter) &&
    (!q || (h.title + ' ' + h.src + ' ' + (h.pub || '')).toLowerCase().includes(q)));

  const wireSortGroup = x => x.foreign ? 2 : (x.place || (x.assessment && x.assessment.scope === 'Indonesia') ? 0 : 1);
  list.sort((a, b) => wireSortGroup(a) - wireSortGroup(b) || (b.ts || 0) - (a.ts || 0));
  const scope = catFilter + '|' + onlyTopic + '|' + q;
  newsList = list;
  if (!list.length && !mediaLoaded) return;
  $('#nmeta').textContent = list.length + ' / ' + items.length + ' item';
  $('#lead').setAttribute('aria-busy', 'false');
  $('#nlist').setAttribute('aria-busy', 'false');
  if (!list.length) {
    curLead = null;
    curLeadScope = scope;
    leadRenderId++;
    leadRenderURL = '';
    $('#lead').innerHTML = '';
    $('#nlist').innerHTML = items.length
      ? '<div class="empty">Tidak ada berita yang lolos saring.</div>'
      : lastGood.size
        ? '<div class="empty">Belum ada berita yang dapat ditampilkan dari sumber saat ini.</div>'
        : '<div class="empty">Feed berita belum berhasil dimuat. Coba refresh.</div>';
  } else {

    const previousLead = curLead;
    curLead = WireCore.chooseLead(list, previousLead, curLeadScope, scope);
    curLeadScope = scope;
    const isLatest = !!curLead && curLead.url === list[0].url;
    const leadNode = $('#lead .lead');
    const sameLead = previousLead && previousLead.url === curLead.url &&
      (leadRenderURL === curLead.url || (leadNode && leadNode.getAttribute('href') === curLead.url));
    if (!sameLead) renderLead(curLead, isLatest);
    else if (leadNode) {
      const lab = leadNode.querySelector('.lead-live');
      if (lab) lab.textContent = isLatest ? 'Terbaru' : 'Sorotan';

      if (!leadNode.querySelector('.lead-img') && !leadNode.querySelector('.lead-vid') && !leadImgInFlight.has(curLead.url)) {
        const failAt = leadImgFailAt.get(curLead.url) || 0;
        if (leadThumbs.has(curLead.url) || leadVideos.has(curLead.url) || rdCache.has(curLead.url) || Date.now() - failAt > 25000) {
          const rid = leadRenderId, rurl = curLead.url;
          const staleCheck = () => rid !== leadRenderId || leadRenderURL !== rurl;
          resolveLeadImage(curLead, staleCheck).then(async img => {
            if (staleCheck()) return;
            if (img) {
              leadImgFailAt.delete(rurl);
              const saved = Array.isArray(leadThumbs.get(rurl)) ? leadThumbs.get(rurl) : [];
              if (!saved.includes(img)) saved.push(img);
              leadThumbs.set(rurl, saved);
              attachLeadImage(rurl, img);
            } else {
              const vid = await resolveLeadVideo(curLead, staleCheck);
              if (staleCheck()) return;
              if (vid) attachLeadVideo(rurl, vid);
              else leadImgFailAt.set(rurl, Date.now());
            }
          });
        }
      }
    }
    renderNlist();
  }
  $('#f-news').textContent = items.length;
  updateFoot();
  queueDescEnrich();
}
let newsList = [], curLead = null, curLeadScope = '';

let nwState = null;
const NW_BATCH = 80;
let nwSentIO = null;
function renderNlist(){
  const list = newsList, leadPick = curLead;
  if (!list || !list.length || !leadPick) return;
  if (nwState && nwState.list === list && nwState.leadUrl === leadPick.url) return;
  const all = list.filter(h => h.url !== leadPick.url);
  const rows = []; let lastDay = dayKey(list[0] && list[0].ts), seg = 0;
  for (const h of all) {
    const d = dayKey(h.ts);
    const head = d && d !== lastDay;
    if (head) { seg++; lastDay = d; }
    else lastDay = d || lastDay;
    rows.push({ h, d, head, seg });
  }
  const segTotal = {};
  for (const r of rows) segTotal[r.seg] = (segTotal[r.seg] || 0) + 1;
  nwState = { list, leadUrl: leadPick.url, rows, segTotal, segSeen: {}, shown: 0 };

  const sc = $('#nlist').closest('.pb') || document.scrollingElement;
  const st = sc ? sc.scrollTop : 0;
  $('#nlist').innerHTML = '';
  nwAppend();
  if (sc) sc.scrollTop = st;
}
function nwAppend(){
  const st = nwState, box = $('#nlist');
  if (!st || !box) return;
  const end = Math.min(st.rows.length, st.shown + NW_BATCH);
  let html = '';
  for (let i = st.shown; i < end; i++) {
    const r = st.rows[i];
    st.segSeen[r.seg] = (st.segSeen[r.seg] || 0) + 1;
    const full = st.segSeen[r.seg] === st.segTotal[r.seg] && st.segTotal[r.seg] % 2 === 1;
    html += (r.head ? `<div class="nw-day">${esc(r.d)}</div>` : '') + newsHtml(r.h, full);
  }
  st.shown = end;
  const old = box.querySelector('#nw-sentinel'); if (old) old.remove();
  box.insertAdjacentHTML('beforeend', html);
  if (st.shown < st.rows.length) {
    box.insertAdjacentHTML('beforeend', '<div id="nw-sentinel" style="height:1px"></div>');
    const s = box.querySelector('#nw-sentinel');
    if (s && 'IntersectionObserver' in window) {
      if (!nwSentIO) nwSentIO = new IntersectionObserver(es => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          const t = e.target;
          nwSentIO.unobserve(t);
          if (t.isConnected) nwAppend();
        }
      }, { rootMargin: '800px' });
      nwSentIO.disconnect();
      nwSentIO.observe(s);
    } else { st.shown = st.rows.length; nwAppend(); }
  }
  queueDescEnrich();
}

const nwCardFor = it => {
  const box = $('#nlist');
  if (!box || !it) return null;
  const urls = new Set([it.url, ...(it.alt instanceof Set ? it.alt : (it.alt || []))].filter(Boolean));
  for (const a of box.querySelectorAll('a.nw')) {
    if (urls.has(a.getAttribute('href'))) return a;
  }
  return null;
};

const descTried = new Set();
const descGot = new Map();
const descDead = new Map();
const descFails = new Map();
const descSoftFails = new Map();
const DESC_DEAD_TTL = 12 * 60000;
const descDeadExpire = () => {
  const now = Date.now();
  let woke = false;
  for (const [u, at] of descDead) {
    if (now - at > DESC_DEAD_TTL) { descDead.delete(u); descTried.delete(u); descFails.delete(u); woke = true; }
  }
  if (woke) bindDescObserver();
};

const descUrlsOf = h => {
  if (!h) return [];
  const alt = h.alt instanceof Set ? [...h.alt] : (h.alt || []);
  const all = [...new Set([h.url, ...alt])].filter(u => typeof u === 'string' && DESC_URL_RE.test(u));

  return all.sort((a, b) => (/(^|\.)news\.google\.com\//i.test(a) ? 1 : 0) - (/(^|\.)news\.google\.com\//i.test(b) ? 1 : 0));
};
const descFetchUrl = h => descUrlsOf(h).find(u => descEligible(u)) || null;

const descPending = h => {
  if (!h || descTried.size >= DESC_MAX) return false;
  if (descDead.has(h.url)) return false;
  return descUrlsOf(h).some(u => !descGot.has(u) && !descDead.has(u));
};
const DESC_MAX = 1200, DESC_TOP = 8, DESC_BATCH = 4;

const DESC_URL_RE = /^https?:\/\//i;
let descBusy = false, descTimer = 0;
const descQueue = [], descQueued = new Set(), descWatched = new Set();
let descIO = null;

const descForItem = h => {
  for (const u of descUrlsOf(h)) { const d = descGot.get(u); if (d) return d; }
  return '';
};

function nwSyncDesc(it){
  const a = nwCardFor(it); if (!a) return;
  const c = descForItem(it) || (it.desc && it.desc.length > 25 ? it.desc : '');
  const sk = a.querySelector('.nw-ex-sk');
  if (c) {
    const html = `<p class="nw-ex nw-reveal">${esc(deEmoji(c))}</p>`;
    if (sk) sk.outerHTML = html;
    else if (!a.querySelector('.nw-ex')) {
      const h3 = a.querySelector('h3');
      if (h3) h3.insertAdjacentHTML('afterend', html);
    }
  } else if (sk) {
    sk.style.transition = 'opacity .25s ease, height .25s ease, margin .25s ease';
    sk.style.opacity = '0';
    sk.style.height = '0';
    sk.style.margin = '0';
    setTimeout(() => { if (sk && sk.parentNode) sk.remove(); }, 260);
  }
}

function rdSyncWireDesc(d, fallbackUrl) {
  if (!d || !d.ok) return;
  const urls = [fallbackUrl, d.url, d.final, d.canonicalUrl].filter(u => typeof u === 'string' && DESC_URL_RE.test(u));
  if (!urls.length) return;

  const rdImg = (d.img && d.imgVerified !== false) ? d.img : '';
  const rdSrc = rdImg ? rdMediaImgSrc(rdImg, d.imgProxy) : pickVerifiedMediaImg(d);
  const rdRejected = !rdSrc && d.imgStatus === 'rejected';
  const rdVids = Array.isArray(d.videos) && d.videos.length
    ? d.videos
    : (Array.isArray(d.blocks) ? d.blocks.filter(b => b && b.k === 'v' && b.v).map(b => b.v) : []);
  rememberLeadVideos(urls, rdVids);
  if (curLead && (rdSrc || rdRejected || rdVids.length)) {
    const leadEl = $('#lead .lead');
    const leadHref = leadEl && leadEl.getAttribute('href');
    const leadAlts = curLead.alt instanceof Set ? [...curLead.alt] : (curLead.alt || []);
    const matchesLead = urls.includes(curLead.url) || urls.includes(leadHref) || leadAlts.some(au => urls.includes(au));
    if (matchesLead && leadEl) {
      const targetUrl = curLead.url;
      if (rdRejected) {
        leadImgRejected.add(targetUrl);
        leadThumbs.delete(targetUrl);
        const staleBox = leadEl.querySelector('.lead-img');
        if (staleBox) staleBox.remove();
        const vid = pickPlayableVideo(rdVids);
        if (vid && !leadEl.querySelector('.lead-vid')) attachLeadVideo(targetUrl, vid);
      } else if (rdSrc && !leadEl.querySelector('.lead-img')) {
        leadImgRejected.delete(targetUrl);
        preloadLeadImage(rdSrc, 8000).then(ok => {
          if (ok || typeof API === 'undefined' || API == null || /\/img\?/i.test(rdSrc)) return ok;
          return preloadLeadImage(rdProxyImgUrl(rdSrc), 8000);
        }).then(ok => {
          if (!ok) return;
          leadImgFailAt.delete(targetUrl);
          leadThumbs.set(targetUrl, [ok]);
          attachLeadImage(targetUrl, ok);
        });
      } else if (!rdSrc && !leadEl.querySelector('.lead-img') && !leadEl.querySelector('.lead-vid')) {
        const vid = pickPlayableVideo(rdVids);
        if (vid) attachLeadVideo(targetUrl, vid);
      }
    }
  }

  const firstBlock = (d.blocks || []).find(b => b && b.k === 'p' && b.t && b.t.length > 25);
  const raw = d.desc || (d.paras && d.paras[0]) || (firstBlock && firstBlock.t) || '';
  const c = cleanDesc(raw);
  if (!c || c.length <= 25) return;

  urls.forEach(u => {
    descGot.set(u, c);
    descDead.delete(u);
    descTried.add(u);
  });

  let it = null;
  for (const u of urls) {
    it = findWireItem(u);
    if (it) break;
  }

  if (it) {
    for (const u of descUrlsOf(it)) descGot.set(u, c);
    if (!(it.desc && it.desc.length > 25)) it.desc = c;
    nwSyncDesc(it);
  }

  const leadEl = $('#lead .lead');
  const leadSk = leadEl && leadEl.querySelector('.lead-ex-sk');
  if (leadSk) {
    const leadHref = leadEl.getAttribute('href');
    if (urls.includes(leadHref) || (curLead && (urls.includes(curLead.url) || it === curLead))) {
      if (curLead && !(curLead.desc && curLead.desc.length > 25)) curLead.desc = c;
      leadSk.outerHTML = `<p class="lead-ex nw-reveal">${esc(deEmoji(c))}</p>`;
    }
  }
}

const findWireItem = u => (_nwDedup && _nwDedup.list || []).find(x => x.url === u ||
  (x.alt instanceof Set ? x.alt.has(u) : (x.alt || []).includes(u)));

const descResolve = u => {
  const it = findWireItem(u);
  return it ? (descFetchUrl(it) || u) : u;
};
const descEligible = u => typeof u === 'string' && DESC_URL_RE.test(u)
  && !descGot.has(u) && !descTried.has(u) && !descDead.has(u);
let descAbort = null;
async function postJson(url, body, ms, signal){
  const c = new AbortController();
  const onAbort = () => c.abort();
  if (signal) {
    if (signal.aborted) throw new Error('aborted');
    signal.addEventListener('abort', onAbort);
  }
  const t = setTimeout(() => c.abort(), ms || 12000);
  try {
    const ours = isOurUrl(url);
    const r = await fetch(url, { method:'POST', cache:'no-store', credentials: ours ? 'same-origin' : 'omit', signal:c.signal,
      headers: { 'content-type':'application/json', ...apiHeaders(url) }, body: JSON.stringify(body) });
    if (r.status === 401 && ours && SITREP_USER) { location.reload(); throw new Error('HTTP 401'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function bindDescObserver(){
  const box = $('#nlist');
  if (!box || !('IntersectionObserver' in window)) return;
  if (!descIO) descIO = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const a = e.target;
      descIO.unobserve(a); descWatched.delete(a);

      const u = a.getAttribute && a.getAttribute('href');
      if (!descEligible(u) || descQueued.has(u) || a.querySelector('.nw-ex, .lead-ex')) continue;
      descQueued.add(u); descQueue.push(u);
      queueDescEnrich();
    }
  }, { threshold: 0.1, rootMargin: '160px 0px' });
  for (const el of descWatched) descIO.unobserve(el);
  descWatched.clear();
  for (const a of box.querySelectorAll('a.nw')) {
    const u = a.getAttribute('href');
    if (!descEligible(u) || descQueued.has(u) || a.querySelector('.nw-ex')) continue;
    descIO.observe(a); descWatched.add(a);
  }

  const lead = $('#lead .lead'), lu = lead && lead.getAttribute('href');
  if (lead && descEligible(lu) && !descQueued.has(lu) && !lead.querySelector('.lead-ex')) {
    descIO.observe(lead); descWatched.add(lead);
  }
}
function queueDescEnrich(){
  bindDescObserver();
  clearTimeout(descTimer);
  descTimer = setTimeout(runDescEnrich, 600);
}
function runDescEnrich(){
  descTimer = 0;
  descDeadExpire();
  if (API == null || document.hidden || descBusy) return;

  const nlBox = $('#nlist');
  if (nlBox && !nlBox.offsetParent) { descTimer = setTimeout(runDescEnrich, 5000); return; }
  if (descTried.size >= DESC_MAX) { descQueue.length = 0; descQueued.clear(); return; }

  const urls = [], seen = new Set();
  const push = u0 => {
    const u = descResolve(u0);
    if (urls.length >= DESC_TOP || descTried.size + urls.length >= DESC_MAX) return;
    if (!u || seen.has(u) || !descEligible(u)) return;
    seen.add(u); urls.push(u);
  };
  while (descQueue.length && urls.length < DESC_TOP) push(descQueue.shift());
  if (!urls.length) {
    for (const h of newsList || []) {
      if (urls.length >= 4 || descTried.size + urls.length >= DESC_MAX) break;
      if (h && h.desc && h.desc.length > 25) continue;
      push(h && h.url);
    }
  }
  if (!urls.length) return;
  urls.forEach(u => descTried.add(u));
  descBusy = true;
  if (descAbort) { try { descAbort.abort(); } catch (_) {} }
  descAbort = new AbortController();
  const sig = descAbort.signal;
  const batches = [];
  for (let i = 0; i < urls.length; i += DESC_BATCH) batches.push(urls.slice(i, i + DESC_BATCH));
  Promise.all(batches.map(b => postJson(API + '/api/desc', { urls: b }, 22000, sig)
      .then(d => ({ b, d })).catch(() => ({ b, d: null }))))
    .then(rs => {
      const touched = new Set();
      const items = (_nwDedup && _nwDedup.list) || [];
      let scheduleRetryMs = 0;
      for (const { b, d } of rs) {
        if (!d) {
          b.forEach(u => {
            const count = (descFails.get(u) || 0) + 1;
            descFails.set(u, count);
            descQueued.delete(u);
            if (count >= 2) {
              descDead.set(u, Date.now());
              descTried.add(u);
              const it = items.find(x => x.url === u || (x.alt instanceof Set ? x.alt.has(u) : (x.alt || []).includes(u)));
              if (it) {
                for (const altU of descUrlsOf(it)) {
                  descDead.set(altU, Date.now());
                  descTried.add(altU);
                  descQueued.delete(altU);
                }
                touched.add(it);
              }
            } else {

              descTried.delete(u);
              if (!descQueued.has(u)) { descQueued.add(u); descQueue.push(u); }
            }
          });
          continue;
        }
        const map = d.ok && d.descs;
        const retryMap = (d.ok && d.retryable) || {};
        if (!map) continue;
        for (const u of Object.keys(map)) {
          descFails.delete(u);
          const c = cleanDesc(map[u]);
          const it = items.find(x => x.url === u ||
            (x.alt instanceof Set ? x.alt.has(u) : (x.alt || []).includes(u)));
          if (!c) {
            const softN = retryMap[u] ? (descSoftFails.get(u) || 0) + 1 : 99;
            if (retryMap[u] && softN <= 2) {
              descSoftFails.set(u, softN);

              const deadAt = Date.now() - DESC_DEAD_TTL + 45000;
              descDead.set(u, deadAt);
              descTried.add(u);
              if (it) {
                for (const altU of descUrlsOf(it)) {
                  descDead.set(altU, deadAt);
                  descTried.add(altU);
                  descQueued.delete(altU);
                }
                touched.add(it);
              }
              if (!scheduleRetryMs) scheduleRetryMs = 46000;
            } else {
              descDead.set(u, Date.now());
              descTried.add(u);
              if (it) {
                for (const altU of descUrlsOf(it)) {
                  descDead.set(altU, Date.now());
                  descTried.add(altU);
                  descQueued.delete(altU);
                }
                touched.add(it);
              }
            }
            continue;
          }
          descSoftFails.delete(u);
          descGot.set(u, c);

          if (it) {
            touched.add(it);
            if (!(it.desc && it.desc.length > 25)) it.desc = c;
            for (const altU of descUrlsOf(it)) descGot.set(altU, c);
          }
        }
      }

      if (touched.size) {
        for (const it of touched) nwSyncDesc(it);

        const ln = $('#lead .lead'), sk = ln && ln.querySelector('.lead-ex-sk');
        if (sk && curLead) {
          const c = descForItem(curLead) || (curLead.desc && curLead.desc.length > 25 ? curLead.desc : '');
          if (c) sk.outerHTML = `<p class="lead-ex">${esc(deEmoji(c))}</p>`;
        }
      }
      if (scheduleRetryMs) setTimeout(queueDescEnrich, scheduleRetryMs);
    })
    .finally(() => {
      descBusy = false;
      if (descQueue.length) queueDescEnrich();
    });
}

const descHasWork = () => {
  if (descTried.size >= DESC_MAX) return false;
  for (const h of newsList || []) if (descFetchUrl(h)) return true;
  return false;
};
function fltPaint(){
  const w = $('#fltwrap'), open = w.classList.contains('open');
  w.classList.toggle('on', !!$('#fq').value.trim());
  $('#fltpill').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('#fq').tabIndex = open ? 0 : -1;
}
function fltSet(open, focus){
  $('#fltwrap').classList.toggle('open', open);
  fltPaint();
  if (open && focus) $('#fq').focus({ preventScroll: true });
}
$('#fq').addEventListener('input', debounce(() => { fltPaint(); renderNews(); }, 140));
$('#fq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fltPaint(); renderNews(); } });
$('#fltpill').addEventListener('click', () => fltSet(!$('#fltwrap').classList.contains('open'), true));
$('#fltwrap').addEventListener('keydown', e => { if (e.key === 'Escape') { fltSet(false); $('#fltpill').focus(); } });
$('#fltwrap').addEventListener('focusout', e => {
  if (e.relatedTarget && $('#fltwrap').contains(e.relatedTarget)) return;
  setTimeout(() => { const w = $('#fltwrap'); if (!w.contains(document.activeElement) && !w.classList.contains('on')) fltSet(false); }, 150);
});

