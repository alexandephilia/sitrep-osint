const TV_CH = [

  { n:'Metro TV',           grp:'Nasional (ID)',       badge:'ID', s:'https://op-flashcon-digdayahd-1.dens.tv/h/h12/index.m3u8', src:'dens.tv',
    pg:'https://www.metrotvnews.com/live' },
  { n:'CNN Indonesia',      grp:'Nasional (ID)',       badge:'ID', s:'https://video.detik.com/livecnn/smil:cnntv.smil/playlist.m3u8', src:'detik',
    pg:'https://www.cnnindonesia.com/tv' },
  { n:'CNBC Indonesia',     grp:'Nasional (ID)',       badge:'ID', s:'https://video.detik.com/livecnbc/smil:cnbctv.smil/playlist.m3u8', src:'detik',
    pg:'https://www.cnbcindonesia.com/tv' },
  { n:'TVRI Nasional',      grp:'Nasional (ID)',       badge:'ID', s:'https://ott-balancer.tvri.go.id/live/eds/Nasional/hls/Nasional.m3u8', src:'tvri',
    pg:'https://tvri.go.id/live' },
  { n:'TVRI Jakarta',       grp:'Nasional (ID)',       badge:'DKI',s:'https://ott-balancer.tvri.go.id/live/eds/DKI/hls/DKI.m3u8', src:'tvri',
    pg:'https://tvri.go.id/live' },
  { n:'BTV',                grp:'Nasional (ID)',       badge:'ID', s:'https://lnd0t3b922.tenbytecdn.com/ta-sg1/90369cf5-6ac2-411d-b3d0-15fae10a2e2c/master.m3u8', src:'tenbyte',
    pg:'https://www.beritasatu.com/beritasatu-live-streaming' },
  { n:'Magna Channel',      grp:'Nasional (ID)',       badge:'ID', s:'https://edge.medcom.id/live-edge/smil:magna.smil/playlist.m3u8', src:'medcom',
    pg:'https://www.magnagrup.com/' },
  { n:'Nusantara TV',       grp:'Nasional (ID)',       badge:'ID', s:'https://nusantaratv.siar.us/nusantaratv/live/playlist.m3u8', src:'siar.us',
    pg:'https://nusantaratv.com/live' },

  { n:'Al Jazeera English', grp:'Internasional (Global)', badge:'QA', s:'https://live-hls-web-aje-fa.thehlive.com/AJE/index.m3u8', src:'thehlive',
    pg:'https://www.aljazeera.com/live' },
  { n:'DW English',         grp:'Internasional (Global)', badge:'DE', s:'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/master.m3u8', src:'dw',
    pg:'https://www.dw.com/en/live-tv/s-100830' },
  { n:'Bloomberg TV',       grp:'Internasional (Global)', badge:'US', s:'https://www.bloomberg.com/media-manifest/streams/us.m3u8', src:'bloomberg',
    pg:'https://www.bloomberg.com/live/us' },
  { n:'France 24 English',  grp:'Internasional (Global)', badge:'FR', s:'https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_2300.m3u8', src:'france24',
    pg:'https://www.france24.com/en/live' },
  { n:'CNA (Channel NewsAsia)',grp:'Internasional (Global)',badge:'SG',s:'https://d2e1asnsl7br7b.cloudfront.net/7782e205e72f43aeb4a48ec97f66ebbe/index.m3u8', src:'cna',
    pg:'https://www.channelnewsasia.com/watch-live' },
  { n:'NHK World-Japan',    grp:'Internasional (Global)', badge:'JP', s:'https://masterpl.hls.nhkworld.jp/hls/w/live/smarttv.m3u8', src:'nhk',
    pg:'https://www3.nhk.or.jp/nhkworld/en/live/' },
  { n:'TRT World',          grp:'Internasional (Global)', badge:'TR', s:'https://tv-trtworld.medya.trt.com.tr/master.m3u8', src:'trt',
    pg:'https://www.trtworld.com/live' }
];
let tvOn = false, tvIx = 0, tvHls = null, tvDrag = null, tvRz = null, tvIdleT = null, tvPx = false, tvTry = 0, tvRetryT = null, tvLoadAt = 0, tvLoadT = null;

function renderTvMenu(){
  const menu = $('#tv-menu');
  if (!menu) return;
  let curGrp = '', h = '';
  TV_CH.forEach((c, idx) => {
    if (c.grp !== curGrp) {
      curGrp = c.grp;
      h += `<div class="tv-menu-sec"><span>${esc(curGrp)}</span></div>`;
    }
    const act = idx === tvIx ? ' active' : '';
    h += `<button class="tv-opt${act}" type="button" data-idx="${idx}">
      <span class="tv-opt-dot"></span>
      <span class="tv-opt-name">${esc(c.n)}</span>
      <span class="tv-opt-badge">${esc(c.badge || 'LIVE')}</span>
    </button>`;
  });
  menu.innerHTML = h;
}

function tvToggleMenu(force){
  const menu = $('#tv-menu'), btn = $('#tv-ch-btn');
  if (!menu || !btn) return;
  const open = typeof force === 'boolean' ? force : menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    tvWake();
    const act = menu.querySelector('.tv-opt.active');
    if (act) menu.scrollTop = Math.max(0, act.offsetTop - 24);
  }
}

function tvPaint(){
  const c = TV_CH[tvIx];
  $('#tv-name').textContent = c.n;
  $('#tv-src').textContent = c.src;
  $('#tv-link').href = c.pg;
  $('#tv-msg-s').textContent = c.n;
  $$('.tv-opt').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === tvIx);
  });
}
renderTvMenu();
function tvFail(msg){
  $('#tv-body').dataset.state = 'fail';
  $('#tv-msg-t').textContent = 'CHANNEL OFFLINE';
  $('#tv-msg-s').textContent = (msg ? msg + ' · ' : '') + 'auto-retry 90s';
}
function tvStop(){
  clearTimeout(tvLoadT); tvLoadT = null;
  const v = $('#tv-video');
  if (tvHls) { try { tvHls.destroy(); } catch (e) {} tvHls = null; }
  try { v.pause(); } catch (e) {}
  v.removeAttribute('src');
  try { v.load(); } catch (e) {}
}
function tvPlay(){
  const c = TV_CH[tvIx], v = $('#tv-video'), body = $('#tv-body');
  const src = (tvPx && API != null) ? tokQ(API + '/hls?u=' + encodeURIComponent(c.s)) : c.s;
  tvPaint();
  tvWake();
  tvStop();
  clearTimeout(tvRetryT); tvRetryT = null;
  body.dataset.state = 'load'; tvLoadAt = Date.now();
  $('#tv-msg-t').textContent = 'Menghubungkan…';
  v.muted = $('#tv-mute').getAttribute('aria-pressed') === 'true';
  const retryPx = () => {
    if (tvPx || API == null || tvTry >= 3) return false;
    tvPx = true; tvTry++;
    if (tvHls === h) { try { h.destroy(); } catch (e) {} tvHls = null; }
    setTimeout(() => { if (tvOn) tvPlay(); }, 700);
    return true;
  };
  clearTimeout(tvLoadT);
  tvLoadT = setTimeout(() => {
    if (tvOn && body.dataset.state === 'load') {
      if (retryPx()) return;
      tvFail('koneksi lambat / timeout');
    }
  }, 9000);
  const markOk = () => {
    clearTimeout(tvLoadT); tvLoadT = null;
    clearTimeout(tvRetryT); tvRetryT = null;
    body.dataset.state = 'ok';
  };
  v.addEventListener('playing', markOk, { once: true });
  let h = null;
  if (needHlsLib(v)) {
    ensureHls().then(() => { if (tvOn) tvPlay(); })
      .catch(() => { if (tvOn && v.canPlayType('application/vnd.apple.mpegurl')) tvPlay(); else tvFail('HLS gagal dimuat'); });
    return;
  }
  if (window.Hls && Hls.isSupported()) {
    h = new Hls(hlsJak({ liveSyncDurationCount: 2, maxBufferLength: 6, capLevelToPlayerSize: true }));
    tvHls = h;
    h.on(Hls.Events.MANIFEST_PARSED, () => {
      markOk();
      v.play().catch(() => {});
    });
    h.on(Hls.Events.ERROR, (ev, d) => {
      if (!d || !d.fatal) return;
      clearTimeout(tvLoadT); tvLoadT = null;
      if (retryPx()) return;
      tvPx = false; tvTry = 0;
      tvFail(d.details);
      if (tvHls === h) { try { h.destroy(); } catch (e) {} tvHls = null; }
      tvRetryT = setTimeout(() => { tvRetryT = null; if (tvOn) tvPlay(); }, 90000);
    });
    h.loadSource(src);
    h.attachMedia(v);
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.addEventListener('loadedmetadata', () => {
      markOk();
      v.play().catch(() => {});
    }, { once: true });
    v.addEventListener('error', () => {
      clearTimeout(tvLoadT); tvLoadT = null;
      if (retryPx()) return;
      tvPx = false; tvTry = 0; tvFail('stream mati');
      tvRetryT = setTimeout(() => { tvRetryT = null; if (tvOn) tvPlay(); }, 90000);
    }, { once: true });
    v.src = src;
  } else {
    clearTimeout(tvLoadT); tvLoadT = null;
    tvFail('HLS tidak didukung browser ini');
  }
}
function tvMute(on){
  const v = $('#tv-video'), b = $('#tv-mute');
  v.muted = on;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', on ? 'Nyalakan suara' : 'Bisukan');
  b.querySelector('use').setAttribute('href', on ? '#i-volx' : '#i-vol');
  if (!on) v.play().catch(() => {});
}
function tvStep(d){
  tvIx = (tvIx + d + TV_CH.length) % TV_CH.length;
  tvPx = false; tvTry = 0;
  if (tvOn) tvPlay(); else tvPaint();
}
function tvPlace(x, y){
  const w = $('#tvwrap'), r = w.getBoundingClientRect();
  const ww = r.width || 344, hh = r.height || 250;
  const mob = innerWidth <= 820;
  const minX = mob ? 8 : 64 - ww, maxX = mob ? innerWidth - ww - 8 : innerWidth - 64;
  const footEl = document.querySelector('.foot');
  const footH = (footEl && footEl.offsetHeight) || 36;
  const minY = mob ? 8 : 6, maxY = Math.max(minY, innerHeight - hh - (mob ? 8 : footH + 12));
  w.style.left = Math.round(Math.max(minX, Math.min(maxX, x))) + 'px';
  w.style.top = Math.round(Math.max(minY, Math.min(maxY, y))) + 'px';
  w.style.right = 'auto';
  w.style.bottom = 'auto';
}
function tvSave(){
  const r = $('#tvwrap').getBoundingClientRect();
  try { localStorage.setItem('sitrep.tv4', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) {}
}
function tvSnap(){
  const w = $('#tvwrap'), r = w.getBoundingClientRect();
  let x = r.left;
  if (r.left < 28) x = 0;
  else if (r.left + r.width > innerWidth - 28) x = innerWidth - r.width;
  tvPlace(x, r.top);
  tvSave();
}
function tvOpen(forceBottomLeft = false){
  if (tvOn) return;
  const w = $('#tvwrap');
  tvOn = true;
  renderTvMenu();
  w.classList.add('on');
  w.setAttribute('aria-hidden', 'false');
  $('#btn-tv').setAttribute('aria-expanded', 'true');
  let saved = null;
  if (!forceBottomLeft) {
    try { saved = JSON.parse(localStorage.getItem('sitrep.tv4') || 'null'); } catch (e) {}
  }
  const r = w.getBoundingClientRect();
  const ww = r.width || 344, hh = r.height || 250;
  const mob = innerWidth <= 820;
  const footEl = document.querySelector('.foot');
  const footH = (footEl && footEl.offsetHeight) || 36;
  const defY = Math.max(6, innerHeight - hh - (mob ? 96 : footH + 104));
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) tvPlace(saved.x, saved.y);
  else tvPlace(mob ? 8 : 18, defY);
  tvPlay();
}
function tvClose(){
  if (!tvOn) return;
  tvOn = false;
  tvToggleMenu(false);
  clearTimeout(tvIdleT);
  clearTimeout(tvRetryT); tvRetryT = null;
  tvStop();
  const w = $('#tvwrap');
  w.classList.remove('on', 'idle');
  w.setAttribute('aria-hidden', 'true');
  $('#btn-tv').setAttribute('aria-expanded', 'false');
  $('#btn-tv').focus();
}
$('#btn-tv').addEventListener('click', () => {
  if (tvOn) tvClose();
  else tvOpen();
});
$('#tv-close').addEventListener('click', tvClose);
$('#tv-ch-btn').addEventListener('click', e => {
  e.stopPropagation();
  tvToggleMenu();
});
$('#tv-menu').addEventListener('click', e => {
  const opt = e.target.closest('.tv-opt');
  if (!opt) return;
  e.stopPropagation();
  const idx = parseInt(opt.dataset.idx, 10);
  if (Number.isFinite(idx) && idx >= 0 && idx < TV_CH.length) {
    tvIx = idx;
    tvPx = false; tvTry = 0;
    tvToggleMenu(false);
    if (tvOn) tvPlay(); else tvPaint();
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('#tvwrap')) {
    tvToggleMenu(false);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = $('#tv-menu');

    if (m && !m.hidden) { tvToggleMenu(false); e.stopPropagation(); }
  }
});
$('#tv-mute').addEventListener('click', () => tvMute($('#tv-mute').getAttribute('aria-pressed') !== 'true'));

const tvH = $('#tv-drag');
tvH.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  const r = $('#tvwrap').getBoundingClientRect();
  tvDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  $('#tvwrap').classList.add('drag');
  try { tvH.setPointerCapture(e.pointerId); } catch (err) {}
});
tvH.addEventListener('pointermove', e => {
  if (!tvDrag) return;
  tvPlace(e.clientX - tvDrag.dx, e.clientY - tvDrag.dy);
});
function tvDrop(e){
  if (!tvDrag) return;
  tvDrag = null;
  $('#tvwrap').classList.remove('drag');
  try { tvH.releasePointerCapture(e.pointerId); } catch (err) {}
  tvSnap();
}
tvH.addEventListener('pointerup', tvDrop);
tvH.addEventListener('pointercancel', tvDrop);

const tvGrip = $('#tv-grip'), tvWrap = $('#tvwrap');
let tvW = 344;

function tvMaxW(){
  const r = tvWrap.getBoundingClientRect();
  return Math.min(720, innerWidth - r.left - 12, (innerHeight - r.top - 12) * 16 / 9);
}
function tvSetW(px){
  tvW = Math.round(Math.max(200, Math.min(tvMaxW(), px)));
  tvWrap.style.setProperty('--tvw', tvW + 'px');
}
tvGrip.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  tvRz = { x: e.clientX, w: tvW };
  tvWrap.classList.add('rz');
  try { tvGrip.setPointerCapture(e.pointerId); } catch (err) {}
});
tvGrip.addEventListener('pointermove', e => {
  if (!tvRz) return;
  tvSetW(tvRz.w + e.clientX - tvRz.x);
});
function tvRzEnd(e){
  if (!tvRz) return;
  tvRz = null;
  tvWrap.classList.remove('rz');
  try { tvGrip.releasePointerCapture(e.pointerId); } catch (err) {}
}
tvGrip.addEventListener('pointerup', tvRzEnd);
tvGrip.addEventListener('pointercancel', tvRzEnd);
tvGrip.addEventListener('dblclick', () => tvSetW(344));
tvGrip.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    tvSetW(tvW + (e.key === 'ArrowRight' ? 16 : -16));
  }
});

function tvArmIdle(){
  clearTimeout(tvIdleT);
  tvIdleT = setTimeout(function tick(){
    if (!tvOn) return;
    const m = $('#tv-menu');
    if (m && !m.hidden) {
      tvIdleT = setTimeout(tick, 1000);
      return;
    }
    if (tvWrap.matches(':hover') || tvWrap.contains(document.activeElement)) {
      tvIdleT = setTimeout(tick, 800);
      return;
    }
    const st = $('#tv-body').dataset.state;
    if (st === 'ok') tvWrap.classList.add('idle');
    else tvIdleT = setTimeout(tick, 1200);
  }, 2600);
}
function tvWake(){
  tvWrap.classList.remove('idle');
  tvArmIdle();
}
tvWrap.addEventListener('pointermove', () => { if (tvWrap.classList.contains('idle')) tvWake(); });
tvWrap.addEventListener('pointerdown', tvWake);
tvWrap.addEventListener('focusin', tvWake);

addEventListener('resize', () => {
  if (!tvOn) return;
  const r = tvWrap.getBoundingClientRect();
  tvPlace(r.left, r.top);
  tvSetW(tvW);
});

const ETAG_CACHE = new Map();
async function getJson(url, ms, retries = 1){
  const ours = isOurUrl(url);
  for (let i = 0; i <= retries; i++) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 12000);
    try {
      const hdrs = { ...apiHeaders(url) };
      const hit = ours ? ETAG_CACHE.get(url) : null;
      if (hit && hit.etag) hdrs['If-None-Match'] = hit.etag;
      const r = await fetch(url, { cache: ours ? 'no-cache' : 'no-store', credentials: ours ? 'same-origin' : 'omit', signal: c.signal, headers: hdrs });
      if (r.status === 304 && hit) {
        return typeof structuredClone === 'function' ? structuredClone(hit.data) : hit.data;
      }
      if (r.status === 401 && ours && SITREP_USER) { location.reload(); throw new Error('HTTP 401'); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const etag = ours && r.headers ? r.headers.get('etag') : '';
      if (etag) {
        ETAG_CACHE.set(url, { etag, data });
        while (ETAG_CACHE.size > 60) ETAG_CACHE.delete(ETAG_CACHE.keys().next().value);
      }
      return data;
    } catch (e) {
      const noRetry = /HTTP 4/.test(e.message || '');
      if (i >= retries || noRetry) throw e;
      await new Promise(r => setTimeout(r, 700 * (i + 1) + Math.floor(Math.random() * 450)));
    } finally { clearTimeout(t); }
  }
}
async function detectApi(){
  const rawQp = new URLSearchParams(location.search).get('api');
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  let qp = null;
  if (rawQp != null) {
    try {
      const resolved = new URL(rawQp, location.origin);
      if (local || resolved.origin === location.origin) qp = rawQp;
    } catch (e) {}
  }
  const c = [qp, '', local ? 'http://localhost:8787' : null].filter(x => x != null);
  try {
    API = await Promise.any(c.map(async b => { const d = await getJson(b + '/api/ping', 4000); if (d && d.ok) return b; throw 0; }));
  } catch (e) {}
}

function updateFoot(){
  $('#f-src').textContent = (SRC_IDS || []).filter(id => (srcState.get(id) || {}).ok).length + '/' +
    ((SRC_IDS || []).length || '—');
}
let lastNewsRev = null;
async function pullMedia(fresh){
  if (mediaLoaded) $('#nmeta').textContent = (newsList.length || 0) + ' item · memperbarui…';
  if (API != null) {
    try {
      const q = (fresh && SITREP_CAN_FRESH)
        ? '?fresh=1'
        : (mediaLoaded && lastNewsRev != null ? ('?rev=' + encodeURIComponent(lastNewsRev)) : '');
      const d = await getJson(API + '/api/news' + q, 55000);
      if (d.classifierVersion && SitrepSignals.adoptClassifierVersion) SitrepSignals.adoptClassifierVersion(d.classifierVersion);
      if (d.rev != null) lastNewsRev = d.rev;
      if (d.delta && mediaLoaded) {
        if (Array.isArray(d.sourceOrder) && d.sourceOrder.length) SRC_IDS = d.sourceOrder;
        if (Array.isArray(d.changedSources)) {
          d.changedSources.forEach(x => {
            if (x.ok) { lastGood.set(x.id, { items:x.items, via:'langsung', at:Date.now() }); srcState.set(x.id, { ok:true, via:'langsung', stale:!!x.stale }); }
            else srcState.set(x.id, { ok:false });
          });
        }
        if (d.unchanged && !(d.changedSources && d.changedSources.length)) {
          renderNews();
          return;
        }
        markFresh();
        renderNews();
        noteWire({ sources: d.changedSources || [] });
        return;
      }
      if (Array.isArray(d.sources)) {
        SRC_IDS = d.sources.map(x => x.id);
        d.sources.forEach(x => {
          if (x.ok) { lastGood.set(x.id, { items:x.items, via:'langsung', at:Date.now() }); srcState.set(x.id, { ok:true, via:'langsung', stale:!!x.stale }); }
          else srcState.set(x.id, { ok:false });
        });
        mediaLoaded = true;
        markFresh();
        renderNews();
        noteWire(d);
        return;
      }
    } catch (e) {  }
  }

  const rs = new Array(RSS_SOURCES.length);
  let idx = 0;
  const worker = async () => {
    while (idx < RSS_SOURCES.length) {
      const i = idx++, s = RSS_SOURCES[i];
      try { rs[i] = { ok:true, r:await fetchSource(s) }; }
      catch (e) { rs[i] = { ok:false }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, RSS_SOURCES.length) }, worker));
  RSS_SOURCES.forEach((s, i) => {
    const x = rs[i];
    if (x && x.ok) {
      lastGood.set(s.id, { items:x.r.items, via:x.r.via, at:Date.now() });
      srcState.set(s.id, { ok:true, via:x.r.via });
    } else srcState.set(s.id, { ok:false });
  });
  mediaLoaded = true;
  markFresh();
  renderNews();
}
function markFresh(){

  const titles = new Set(mergedMedia().map(h => stripPubTail(cleanTitle(h.title), tkPub(h.pub))));
  freshNews = new Set();
  if (!firstPull) titles.forEach(t => { if (!seenNews.has(t)) freshNews.add(t); });
  seenNews = titles;
  firstPull = false;
  if (freshNews.size) syncGlobeSoon();
}

