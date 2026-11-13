const camStream = c => c.s;

const camProxy = u => tokQ(API + '/hls?u=' + encodeURIComponent(u));
const camSteps = c => CctvCore.playSteps(c, API != null ? camProxy : null).map(x => x.url);

let _JakLoader = null;
function getJakLoader(){
  if (_JakLoader) return _JakLoader;
  if (!(window.Hls && Hls.DefaultLoader)) return null;
  _JakLoader = class extends Hls.DefaultLoader {
    load(ctx, cfg, cb){
      try {
        const uObj = new URL(ctx.url, location.href);
        if (uObj.pathname === '/hls' && uObj.searchParams.has('u')) {
          const inner = uObj.searchParams.get('u');
          if (/jakcctv\.jakarta\.go\.id/i.test(inner) && !/[?&]proto=/.test(inner)) {
            uObj.searchParams.set('u', inner + (inner.includes('?') ? '&' : '?') + 'proto=hls');
            ctx.url = uObj.pathname + uObj.search;
          }
        } else if (/jakcctv\.jakarta\.go\.id/i.test(ctx.url) && !/[?&]proto=/.test(ctx.url)) {
          ctx.url += (ctx.url.includes('?') ? '&' : '?') + 'proto=hls';
        }
      } catch (e) {}
      return super.load(ctx, cfg, cb);
    }
  };
  return _JakLoader;
}
const hlsJak = cfg => { const jl = getJakLoader(); return jl ? Object.assign({loader:jl}, cfg) : cfg; };
let aliveMap = null, district = 'Semua', camList = [], showOfflineCams = false;

const MAXL = 8, PERHOST = 4, LIVE_CAP = 12, SOFT_MS = 12000, OFF_FREE_MS = 20000, ORDER_COOLDOWN_MS = 4000;
let camSnapOK = false, lastOrderAt = 0, orderTimer = 0, orderDeferred = false;

const HEDGE_MS = 2500, hostMode = new Map(), hostWin = new Map();
hostMode.set('dki-jkt.balitower.co.id:7028', 'proxy');
hostMode.set('cctv.molecool.id', 'proxy');
hostMode.set('proxycctv.dsdajakarta.id', 'proxy');
hostMode.set('pantaucctv.com', 'proxy');
hostMode.set('cctv-dishub.tangerangkab.go.id', 'proxy');
hostMode.set('transcode.baliprov.go.id', 'proxy');
hostMode.set('pelindung.bandung.go.id:3443', 'proxy');
hostMode.set('atcs-dishub.bandung.go.id:1990', 'proxy');
hostMode.set('livepantau.semarangkota.go.id', 'proxy');
const proxyIdx = steps => steps.findIndex(u => API != null && u.indexOf(API + '/hls?') === 0);
const rumQ = [];
function rumPush(e){ if (rumQ.length < 200) rumQ.push(e); }
function rumFlush(){
  if (!rumQ.length || API == null) return;
  const url = API + '/api/cctv/rum';
  const body = JSON.stringify(rumQ.splice(0, 100));
  fetch(url, { method:'POST', keepalive:true, credentials:'same-origin', headers:{ 'content-type':'application/json', ...apiHeaders(url) }, body }).catch(() => {});
}
setInterval(() => { if (!document.hidden) rumFlush(); }, 60000);
addEventListener('pagehide', rumFlush);
const P = new Map();
const camGrid = $('#camgrid');
const vid = c => c.querySelector('video');
const mkVid = c => { let v = vid(c); if (!v) { v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'none'; c.querySelector('.frame').appendChild(v); } return v; };
const isDirectSnapFeed = (url, c) => {
  const s = String(url || (c && c.s) || '');
  return /(^|\.)dsdajakarta\.id/i.test(s) || /SourceEndpoint\.video/i.test(s);
};
function snapUrl(cam, viaProxy){
  if (cam && cam.snap) {
    if (/(^|\.)dsdajakarta\.id/i.test(cam.snap) || /SourceEndpoint\.video/i.test(cam.snap)) return cam.snap;
    const t = Math.floor(Date.now() / 15000);
    if (viaProxy && API != null) return tokQ(API + '/api/cctv/snap?u=' + encodeURIComponent(cam.snap) + '&t=' + t);
    return cam.snap + (cam.snap.includes('?') ? '&' : '?') + 't=' + t;
  }
  const step = isDirectSnapFeed(cam && cam.s, cam) ? 15000 : 60000;
  return tokQ(API + '/api/cctv/snap?u=' + encodeURIComponent(cam.s) + '&v=' + Math.floor(Date.now() / step));
}
const snapCooldown = p => p.snapFail ? Math.min(60000, 10000 * (p.snapFailN || 1)) : 0;
function clearSnapTimer(p){
  if (p && p.snapTimer) { clearTimeout(p.snapTimer); p.snapTimer = null; }
}
function showSnap(cell, p){
  const c = camList[+cell.dataset.i];
  if (!c) return false;
  if ((!camSnapOK && !c.snap) || (API == null && !c.snap) || (p.snapFail && Date.now() - p.snapFail < snapCooldown(p))) return false;
  const fr = cell.querySelector('.frame'); let im = fr.querySelector('img.snap');
  if (!im) {
    im = document.createElement('img'); im.className = 'snap'; im.alt = ''; im.decoding = 'async'; im.loading = 'lazy';
    im.onload = () => {
      clearSnapTimer(p);
      if (im.naturalWidth <= 0) { im.onerror(); return; }
      p.snapOk = true; p.snapFail = 0; p.snapFailN = 0;
      if (p.snapMode) { p.loaded = true; badge(cell, 'live', 'Live'); orderCams(); upd(); }
    };
    im.onerror = () => {
      clearSnapTimer(p);
      if (c.snap && !p.snapProxy && API != null) {
        p.snapProxy = true; p.snapAt = Date.now();
        p.snapTimer = setTimeout(() => { if (im.onerror) im.onerror(); }, 10000);
        im.src = snapUrl(c, true);
        return;
      }
      p.snapOk = false; p.snapFail = Date.now(); p.snapFailN = (p.snapFailN || 0) + 1; im.remove();
      if (p.snapMode) { p.snapMode = false; p.loaded = false; kill(cell); }
      else if (!p.h) badge(cell, 'wait', 'Antre');
    };
    fr.insertBefore(im, fr.firstChild);
  }
  const isMjpeg = /(^|\.)dsdajakarta\.id/i.test(c.snap || c.s || '');
  if (!im.src || (!isMjpeg && (!p.snapAt || Date.now() - p.snapAt > ((c.snap || p.snapMode) ? 15000 : 60000)))) {
    p.snapAt = Date.now();
    clearSnapTimer(p);
    p.snapTimer = setTimeout(() => { if (im.onerror) im.onerror(); }, 10000);
    im.src = snapUrl(c, p.snapProxy);
  }
  badge(cell, (p.snapMode && p.snapOk) ? 'live' : 'wait', (p.snapMode && p.snapOk) ? 'Live' : (p.loading ? 'Memuat' : 'Snapshot'));
  return true;
}
function dropSnap(cell){ const p = P.get(cell); if (p) { clearSnapTimer(p); p.snapAt = 0; p.snapMode = false; } }

function cleanVid(v){
  if (!v) return;
  v.onerror = v.onloadeddata = v.onplaying = v.onwaiting = null;
  try { v.pause(); } catch (e) {}
  v.removeAttribute('src');
  try { v.load(); } catch (e) {}
}
function releaseCell(cell){
  const p = P.get(cell); if (!p || p.dead) return;
  if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; }
  clearSnapTimer(p);
  cell.classList.remove('is-playing');
  if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
  const v = vid(cell); if (v) { cleanVid(v); v.remove(); }
  p.h = null; p.loading = p.loaded = p.playing = p.stopped = false; p.visAt = 0; p.waitT = 0;
  badge(cell, (p.snapMode && p.snapOk) ? 'live' : 'wait', (p.snapMode && p.snapOk) ? 'Live' : 'Antre'); upd();
}
function cols(){ return Math.max(1, Math.min(4, Math.round(camGrid.clientWidth / 165))); }
function badge(cell, cls, txt){ const b = cell.querySelector('.badge'); if (b) { b.className = 'badge ' + cls; b.textContent = txt; } }
function upd(){
  const now = Date.now();
  let ok = 0, live = 0, buf = 0, off = 0;
  P.forEach(p => {
    const tier = CctvCore.camTier(p, now);
    const snapLive = p.snapMode && p.snapOk;
    if (p.loaded || snapLive) ok++;
    if (p.playing || (snapLive && p.vis)) live++;
    if (tier === 3) buf++;
    if (tier === 4) off++;
  });
  const activeTotal = Math.max(0, P.size - off);
  const totalOff = (wantList.srvOff || 0) + off;
  $('#ccount').textContent = ok + '/' + activeTotal + ' · ' + live + ' live' + (buf ? ' · ' + buf + ' buf' : '');
  $('#f-cams').textContent = live + '/' + activeTotal;
  const tog = $('#cam-off-tog');
  if (tog) {
    tog.hidden = totalOff === 0 && !showOfflineCams;
    tog.setAttribute('aria-pressed', String(showOfflineCams));
    const sp = tog.querySelector('span');
    if (sp) sp.textContent = String(totalOff);
  }
}
function syncLiveEdge(cell, p, v){
  if (!v) v = vid(cell);
  if (!v) return;
  let target = -1;
  if (p && p.h && p.h !== 'native') {
    if (typeof p.h.liveSyncPosition === 'number' && Number.isFinite(p.h.liveSyncPosition) && p.h.liveSyncPosition > 0) {
      target = p.h.liveSyncPosition;
    }
  }
  if (target < 0 && v.seekable && v.seekable.length > 0) {
    try {
      const sEnd = v.seekable.end(v.seekable.length - 1);
      if (Number.isFinite(sEnd) && sEnd > 0) target = Math.max(0, sEnd - 2.5);
    } catch (e) {}
  }
  if (target > 0) {
    const drift = Math.abs(v.currentTime - target);
    const beforeStart = v.seekable && v.seekable.length > 0 && v.currentTime < v.seekable.start(0);
    if (drift > 6 || beforeStart) {
      try { v.currentTime = target; } catch (e) {}
    }
  }
}
function enterSnapFallback(cell, p){
  if (!p) return false;
  const c = camOfCell(cell);
  if (!c || (!c.snap && !camSnapOK)) return false;
  if (p.snapFail && Date.now() - p.snapFail < snapCooldown(p)) return false;
  const oldV = vid(cell);
  if (oldV) { cleanVid(oldV); oldV.remove(); }
  if (p.mp4Timer) { clearTimeout(p.mp4Timer); p.mp4Timer = null; }
  p.h = null; p.loading = false; p.playing = false;
  const im = cell.querySelector('.frame img.snap');
  const snapReady = Boolean(p.snapOk && im && im.complete && im.naturalWidth > 0);
  p.snapMode = true; p.bad = false;
  if (snapReady) {
    p.loaded = true;
    showSnap(cell, p);
    badge(cell, 'live', 'Live');
    upd(); pumpSoon();
    return true;
  }
  p.loaded = false; p.snapOk = false;
  if (!showSnap(cell, p)) {
    p.snapMode = false;
    return false;
  }
  upd(); pumpSoon();
  return true;
}
function startCell(cell){
  const p = P.get(cell); if (!p || p.dead) return;
  const c = camList[+cell.dataset.i];
  if (c && isDirectSnapFeed(c.s, c)) {
    p.stopped = false;
    if (!enterSnapFallback(cell, p)) kill(cell);
    return;
  }
  if (p.snapMode && !p.h) {
    p.stopped = false; p.loading = false;
    const snapReady = Boolean(p.snapOk);
    p.loaded = snapReady;
    if (!showSnap(cell, p) && !snapReady) { p.snapMode = false; kill(cell); return; }
    badge(cell, snapReady ? 'live' : 'wait', snapReady ? 'Live' : 'Snapshot'); upd();
    return;
  }
  const v = mkVid(cell);
  cell.classList.remove('is-playing');
  if (p.h) {
    if (p.h !== 'native') { try { p.h.startLoad(); } catch (e) {} }
    p.stopped = false; p.loading = !p.loaded; p.nerr = p.merr = 0;
    syncLiveEdge(cell, p, v);
    if (!p.loaded) { p.t0 = Date.now(); badge(cell, (p.snapMode && p.snapOk) ? 'live' : 'wait', (p.snapMode && p.snapOk) ? 'Live' : 'Memuat'); }
    else { dropSnap(cell); if (p.vis) badge(cell, 'live', 'Live'); }
    v.play().catch(() => {}); return;
  }
  const keepSnapLive = Boolean(c && (c.snap || camSnapOK) && p.snapOk && p.snapMode);
  if (!keepSnapLive) p.snapMode = false;
  p.loading = true; p.t0 = Date.now();
  if (c && c.snap && !p.loaded) showSnap(cell, p);
  badge(cell, keepSnapLive ? 'live' : 'wait', keepSnapLive ? 'Live' : 'Memuat');
  const steps = p.steps || (p.steps = camSteps(c));
  if (!p.step && hostMode.get(p.host) === 'proxy') { const pi = proxyIdx(steps); if (pi > 0) p.step = pi; }
  const url = steps[Math.min(p.step || 0, steps.length - 1)];
  clearTimeout(p.mp4Timer);
  if (/\.mp4($|\?)/i.test(url)) {
    p.h = 'native'; v.src = url;
    p.mp4Timer = setTimeout(() => {
      if (p.loading && !p.loaded) {
        cleanVid(v); p.h = null;
        if (enterSnapFallback(cell, p)) return;
        if ((p.step = (p.step || 0) + 1) < steps.length) startCell(cell);
        else kill(cell);
      }
    }, 8000);
    v.onerror = () => {
      clearTimeout(p.mp4Timer);
      v.onerror = null;
      if (!p.loaded && enterSnapFallback(cell, p)) return;
      if ((p.step = (p.step || 0) + 1) < steps.length) { p.h = null; startCell(cell); }
      else kill(cell);
    };
    v.play().catch(() => {});
  } else if (needHlsLib(v)) {
    ensureHls().then(() => { const st = P.get(cell); if (st && !st.dead && !st.h) startCell(cell); })
      .catch(() => { const st = P.get(cell); if (st && !st.dead && !st.h && v.canPlayType('application/vnd.apple.mpegurl')) startCell(cell); else kill(cell); });
    return;
  } else if (window.Hls && Hls.isSupported()) {
    const h = new Hls(hlsJak({ startLevel:0, capLevelToPlayerSize:true, maxBufferLength:8, maxMaxBufferLength:16,
      backBufferLength:6, liveBackBufferLength:6,
      liveSyncDurationCount:2, liveMaxLatencyDurationCount:5, liveDurationInfinity:true, maxLiveSyncPlaybackRate:1.15,
      manifestLoadingTimeOut:25000, levelLoadingTimeOut:25000, fragLoadingTimeOut:25000,
      manifestLoadingMaxRetry:2, levelLoadingMaxRetry:2, fragLoadingMaxRetry:3 }));
    p.h = h; h.loadSource(url); h.attachMedia(v);
    h.on(Hls.Events.FRAG_LOADED, () => { p.t0 = Date.now(); });
    h.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    h.on(Hls.Events.ERROR, (ev, d) => {
      if (!d) return;
      if (d.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR || d.details === 'bufferStalledError') {
        p.stalls = (p.stalls || 0) + 1;
        if (p.stalls > 2) {
          p.nerr = p.merr = p.stalls = 0; try { h.destroy(); } catch (e) {} p.h = null;
          if (enterSnapFallback(cell, p)) return;
          if ((p.step = (p.step || 0) + 1) < steps.length) startCell(cell);
          else kill(cell);
          return;
        }
        syncLiveEdge(cell, p, v);
        try { h.startLoad(); } catch (e) {}
        v.play().catch(() => {});
        return;
      }
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && (p.nerr = (p.nerr || 0) + 1) < 3) {
        syncLiveEdge(cell, p, v);
        h.startLoad();
      } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && (p.merr = (p.merr || 0) + 1) < 3) {
        h.recoverMediaError();
        syncLiveEdge(cell, p, v);
      } else {
        p.nerr = p.merr = 0; try { h.destroy(); } catch (e) {} p.h = null;
        if (enterSnapFallback(cell, p)) return;
        if ((p.step = (p.step || 0) + 1) < steps.length) startCell(cell);
        else kill(cell);
      }
    });
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    p.h = 'native'; v.src = url;
    v.onerror = () => {
      v.onerror = null;
      if ((p.step = (p.step || 0) + 1) < steps.length) { const old = p.h; p.h = null; try { old && old !== 'native' && old.destroy(); } catch (e) {} startCell(cell); }
      else kill(cell);
    };
    v.play().catch(() => {});
  } else { kill(cell); return; }
  v.onloadeddata = () => {
    clearTimeout(p.mp4Timer);
    if (p.loaded) return;
    cell.classList.add('is-playing');
    rumPush({ h: p.host, t: Date.now() - (p.visAt || p.t0), s: p.stl || 0 }); p.stl = 0; p.visAt = 0;
    if (p.hedged) { p.hedged = false; const st = p.steps && p.steps[p.step || 0]; if (st && proxyIdx([st]) === 0) { const n = (hostWin.get(p.host) || 0) + 1; hostWin.set(p.host, n); if (n >= 2) hostMode.set(p.host, 'proxy'); } }
    p.loaded = true; p.loading = false; p.snapMode = false; p.dem = 0; p.nerr = p.merr = p.tries = p.step = p.rest = 0;
    const rc = camList[p.idx]; if (rc) { const cc = CAMS[rc._i]; if (cc) { cc.fails = 0; camReport(cc.s, true); camBad.delete(camKey(cc.s)); } }
    if (p.bad) { p.bad = false; orderCams(); }
    p.vis = isCellVisible(cell);
    if (p.vis) badge(cell, 'live', 'Live'); else stopCell(cell);
    pump(); upd();
  };
  v.onplaying = () => {
    clearTimeout(p.mp4Timer);
    if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; }
    if (p.stopped || !p.vis) { try { v.pause(); } catch (e) {} p.playing = false; return; }
    p.playing = true; p.waitT = 0; p.stall = 0; p.rest = 0; p.bad = false;
    cell.classList.add('is-playing'); dropSnap(cell); badge(cell, 'live', 'Live'); orderCams(); upd();
  };
  v.onwaiting = () => {
    p.playing = false; p.waitT = p.waitT || Date.now(); p.stl = (p.stl || 0) + 1;
    if (p.waitTimer) clearTimeout(p.waitTimer);
    p.waitTimer = setTimeout(() => {
      if (!p.playing && p.vis) {
        badge(cell, 'buf', 'Buffering');
        orderCams();
        pumpSoon();
        upd();
      }
    }, 800);
  };
}
function stopCell(cell){
  const p = P.get(cell); if (!p || (!p.h && !p.snapMode) || p.stopped) return;
  if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; }
  if (p.h && p.h !== 'native') { try { p.h.stopLoad(); } catch (e) {} }
  if (p.h) { try { vid(cell).pause(); } catch (e) {} }
  p.stopped = true; p.playing = false; p.loading = false; p.waitT = 0; badge(cell, (p.snapMode && p.snapOk) ? 'live' : 'wait', (p.snapMode && p.snapOk) ? 'Live' : 'Jeda'); upd();
}

const camOfCell = cell => { const p = P.get(cell); if (!p) return null;
  const rc = camList[p.idx]; return rc ? CAMS[rc._i] : null; };
const camKey = u => CctvCore.streamKey(u);
const camBad = new Map();
const repLast = new Map();
function camReport(u, ok){
  if (!u || API == null || document.hidden || (SITREP_PUBLIC && !SIT_TOKEN)) return;
  const now = Date.now(), last = repLast.get(u) || 0;
  if (now - last < (ok ? 600000 : 60000)) return;
  repLast.set(u, now);
  const url = API + '/api/cctv/report';
  fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...apiHeaders(url) },
    body: JSON.stringify({ u, ok }) }).catch(() => {});
}
function camCooling(cam){ const cb = cam && camBad.get(camKey(cam.s)); return cb && cb.until > Date.now() ? cb.until : 0; }

function applyOrder(force){
  orderTimer = 0;
  orderDeferred = false;
  const lb = $('#lightbox');
  if (!force && ((camGrid && camGrid.matches(':hover')) || (lb && !lb.hidden))) {
    orderDeferred = true;
    return;
  }
  const now = Date.now();
  lastOrderAt = now;
  let changed = false;
  P.forEach((p, c) => {
    const nextOrd = String(CctvCore.camOrderValue(p, p.idx || 0, now));
    if (c.style.order !== nextOrd) {
      c.style.order = nextOrd;
      changed = true;
    }
  });
  if (changed) {
    layout();
    if (!force) pumpSoon();
  }
}
function orderCams(force){
  if (force) {
    clearTimeout(orderTimer);
    applyOrder(true);
    return;
  }
  const elapsed = Date.now() - lastOrderAt;
  if (elapsed >= ORDER_COOLDOWN_MS) {
    clearTimeout(orderTimer);
    applyOrder(false);
  } else if (!orderTimer) {
    orderTimer = setTimeout(() => applyOrder(false), ORDER_COOLDOWN_MS - elapsed);
  }
}
function syncOfflineCell(cell, p){
  const snapLive = Boolean(p && p.snapMode && p.snapOk);
  const isOff = Boolean(p && p.dead && !snapLive);
  cell.classList.toggle('is-offline', isOff);
  cell.hidden = isOff && !showOfflineCams;
}
function probeOfflineCell(cell){
  const p = P.get(cell), c = camOfCell(cell);
  if (!p || !c || !p.dead || p._probing || !cell.isConnected) return;
  const revive = () => {
    p._probing = false;
    if (!P.has(cell) || !cell.isConnected) return;
    p.dead = false; p.bad = false; p.tries = 0; p.snapFail = 0; p.snapFailN = 0; p.stl = 0; p.rest = 0;
    syncOfflineCell(cell, p);
    badge(cell, 'wait', 'Antre');
    orderCams(true);
    layout(); upd(); pumpSoon();
  };
  const giveUp = () => { p._probing = false; };
  p._probing = true;
  if (API != null) {
    const probeSrc = c.snap || c.s;
    const u = tokQ(API + '/api/cctv/snap?u=' + encodeURIComponent(probeSrc) + '&t=' + Math.floor(Date.now() / 15000));
    fetch(u, { credentials: 'same-origin' }).then(r => {
      const ct = (r.headers && r.headers.get('content-type')) || '';
      if (r.ok && /^image\//i.test(ct)) revive();
      else giveUp();
    }).catch(giveUp);
    return;
  }
  if (c.snap) {
    const im = new Image();
    const tm = setTimeout(() => { im.onload = im.onerror = null; giveUp(); }, 8000);
    im.onload = () => { clearTimeout(tm); if (im.naturalWidth > 0) revive(); else giveUp(); };
    im.onerror = () => { clearTimeout(tm); giveUp(); };
    im.src = snapUrl(c, false);
    return;
  }
  giveUp();
}
function kill(cell){
  const p = P.get(cell); if (!p) return;
  if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; }
  if (p.mp4Timer) { clearTimeout(p.mp4Timer); p.mp4Timer = null; }
  clearSnapTimer(p);
  if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
  const v = vid(cell); if (v) { cleanVid(v); v.remove(); }
  cell.classList.remove('is-playing');
  p.h = null; p.loading = p.loaded = p.playing = p.stopped = false;
  rumPush({ h: p.host, f: 1 }); p.hedged = false;
  p.dead = true; p.tries = (p.tries || 0) + 1; p.step = 0; p.rest = 0;
  const rc = camList[p.idx];
  if (rc) { const cc = CAMS[rc._i]; if (cc) cc.fails = (cc.fails || 0) + 1; }
  const cam = camOfCell(cell);
  const hasSnap = !!(cam && (cam.snap || (camSnapOK && API != null)) && (!p.snapFail || Date.now() - p.snapFail >= snapCooldown(p)));
  p.snapMode = false;
  if (hasSnap) {
    p.bad = false;
    const im = cell.querySelector('.frame img.snap');
    const snapReady = Boolean(p.snapOk && im && im.complete && im.naturalWidth > 0);
    p.snapMode = true;
    p.loaded = snapReady;
    if (showSnap(cell, p)) {
      if (snapReady) badge(cell, 'live', 'Live');
    } else {
      p.snapMode = false;
      p.loaded = false;
    }
  }
  if (!p.snapMode) {
    p.snapMode = false; p.bad = true;
    if (cam) {
      camReport(cam.s, false);
      const k = camKey(cam.s);
      if (k) { const cb = camBad.get(k) || { n: 0, until: 0 }; cb.n++;
        cb.until = Date.now() + Math.min(30000, 3000 * cb.n); camBad.set(k, cb); }
    }
    badge(cell, 'off', 'Offline');
    syncOfflineCell(cell, p);
    orderCams(true);
    layout();
  }
  clearTimeout(p.retry);
  const backoff = p.snapMode ? 15000 : Math.min(300000, 10000 * Math.pow(2, Math.min(p.tries - 1, 5)));
  p.retry = setTimeout(() => {
    if (!P.has(cell) || !cell.isConnected) return;
    if (!p.snapMode) {
      probeOfflineCell(cell);
      return;
    }
    p.dead = false;
    syncOfflineCell(cell, p);
    pump();
  }, backoff * (0.8 + Math.random() * 0.4));
  pump(); upd();
}
function hideCell(cell){
  const p = P.get(cell); if (!p) return;
  clearTimeout(p.retry); clearTimeout(p.t); clearTimeout(p.rel); if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; } clearSnapTimer(p);
  p.t = 0; p.rel = 0; p.waitT = 0;
  if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
  const v = vid(cell); if (v) cleanVid(v);
  try { vio && vio.unobserve(cell); } catch (e) {}
  P.delete(cell); cell.remove();
  layout(); upd();
}
let cctvLastScrollTop = 0;
let cctvScrollDir = 'down';
let camScrollEndT = 0;
function camVisRect(){
  const pb = camGrid && camGrid.parentElement;
  const pbStyle = pb ? getComputedStyle(pb) : null;
  const pbOverflowY = pbStyle ? pbStyle.overflowY : '';
  const pbRect = pb ? pb.getBoundingClientRect() : null;
  let stickyTop = 0;
  const hdr = $('.hdr');
  if (hdr) {
    const hs = getComputedStyle(hdr);
    if (hs.position === 'sticky' || hs.position === 'fixed') {
      const hr = hdr.getBoundingClientRect();
      if (hr.height > 0 && hr.top < hr.height) stickyTop = Math.max(0, Math.min(innerHeight * 0.5, hr.bottom));
    }
  }
  const b = CctvCore.effectiveVisBounds({ pbRect, pbOverflowY, innerHeight, stickyTop });
  const se = b.usePb ? pb : (document.scrollingElement || document.documentElement);
  const scrollTop = se ? se.scrollTop : 0;
  const scrollRem = se ? (se.scrollHeight - se.scrollTop - se.clientHeight) : 9999;
  let lastRowInView = false;
  if (camGrid && camGrid.children.length > 0 && scrollTop > 8) {
    const gr = camGrid.getBoundingClientRect();
    if (gr.bottom <= b.bot + 180) lastRowInView = true;
  }

  const atBottom = scrollTop > 8 && (scrollRem <= 180 || lastRowInView);
  return { top: b.top, bot: b.bot, pb: b.usePb ? pb : null, atBottom, scrollDir: cctvScrollDir };
}
function isCellVisible(cell, vr){
  vr = vr || camVisRect();
  const fr = cell.querySelector('.frame');
  return CctvCore.measureCell(cell.getBoundingClientRect(), fr ? fr.getBoundingClientRect() : null, vr).inView;
}
function dropLoadingCell(cell){
  const p = P.get(cell); if (!p || !p.loading || p.loaded) return;
  if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; }
  if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
  const v = vid(cell); if (v) cleanVid(v);
  p.h = null; p.loading = false; p.visAt = 0; p.waitT = 0;
  badge(cell, (p.snapMode && p.snapOk) ? 'live' : 'wait', (p.snapMode && p.snapOk) ? 'Live' : 'Antre'); upd();
}
let inPump = false;
function pump(){
  if (inPump) { pumpSoon(); return; }
  inPump = true;
  try {
    const vr = camVisRect();
    const liveCands = [];
    P.forEach((p, c) => {
      if (c.hidden || c.style.display === 'none' || c.classList.contains('is-offline')) {
        p.vis = false;
        return;
      }
      const rect = c.getBoundingClientRect();
      const fr = c.querySelector('.frame');
      const frameRect = fr ? fr.getBoundingClientRect() : null;
      const m = CctvCore.measureCell(rect, frameRect, vr);
      p.vis = m.inView;
      p.visTop = m.inView ? rect.top : 1e9;
      p.visFrac = m.visFrac;
      if (m.inView) {
        clearTimeout(p.t); clearTimeout(p.rel); p.t = 0; p.rel = 0;
        const nowTs = Date.now();
        const tierNow = CctvCore.camTier(p, nowTs);
        if (!p.dead) liveCands.push({ key: c, rect, frameRect, m, bad: !!(p.bad || tierNow >= 3), health: tierNow >= 3 ? 2 : (p.waitT ? 1 : 0), idx: p.idx });
      } else if (!p.dead && (p.h || p.loading || p.loaded) && !p.rel) {
        p.rel = setTimeout(() => { p.rel = 0; if (!isCellVisible(c)) releaseCell(c); }, OFF_FREE_MS);
      }
    });
    const all = [...P.entries()].filter(([, p]) => !p.dead);

    const visRanked = CctvCore.pickLiveKeys(liveCands, vr);
    const wantLive = new Set(visRanked.slice(0, LIVE_CAP));
    const wantLoadSlot = new Set();
    {
      const hostNeed = {};
      let totalNeed = 0;
      for (const c of wantLive) {
        const p = P.get(c);
        if (!p || p.dead || p.loaded) continue;
        if (!p.loading && camCooling(camOfCell(c))) continue;
        const h = p.host || '';
        if (totalNeed < MAXL && (hostNeed[h] || 0) < PERHOST) {
          wantLoadSlot.add(c);
          hostNeed[h] = (hostNeed[h] || 0) + 1;
          totalNeed++;
        }
      }
    }
    for (const [c, p] of all) {
      if (wantLive.has(c)) {
        if (!p.visAt && !p.loaded) p.visAt = Date.now();
        if (p.loading && !p.loaded && !wantLoadSlot.has(c)) dropLoadingCell(c);
      } else if (p.loading && !p.loaded) {
        dropLoadingCell(c);
      } else if ((p.h || p.snapMode) && p.loaded && !p.stopped) {
        stopCell(c);
      }
    }
    const loadingByHost = {}; let loading = 0, playing = 0;
    all.forEach(([, p]) => {
      if (p.loading) { loading++; loadingByHost[p.host] = (loadingByHost[p.host] || 0) + 1; }
      if ((p.h || p.snapMode) && p.loaded && !p.stopped) playing++;
    });

    const wantOrder = new Map([...wantLive].map((c, idx) => [c, idx]));
    all.sort((a, b) =>
      ((wantOrder.has(a[0]) ? wantOrder.get(a[0]) : 1e6) - (wantOrder.has(b[0]) ? wantOrder.get(b[0]) : 1e6)) ||
      (b[1].vis - a[1].vis) ||
      ((a[1].visTop || 1e9) - (b[1].visTop || 1e9)) ||
      ((a[1].dem || 0) - (b[1].dem || 0)) ||
      (a[1].idx - b[1].idx)
    );
    let wake = 0; const cands = [], wait = [];
    for (const [c, p] of all) {
      if (p.loading) continue;
      if ((p.h || p.snapMode) && p.stopped && p.vis && p.loaded) {
        if (wantLive.has(c) && playing < LIVE_CAP) { startCell(c); playing++; }
        else wait.push(c);
        continue;
      }
      if (!p.vis || ((p.h || p.snapMode) && !(p.stopped && !p.loaded))) continue;
      if (!wantLive.has(c)) { wait.push(c); continue; }
      const until = camCooling(camOfCell(c));
      if (until) { wake = wake ? Math.min(wake, until) : until; continue; }
      cands.push({ key: c, host: p.host });
    }
    const picked = new Set(CctvCore.pickStarts(cands, { maxLoad: Math.min(MAXL, LIVE_CAP - playing), perHost: PERHOST, loadingTotal: loading, loadingByHost }));
    picked.forEach(c => startCell(c));

    cands.forEach(x => { if (!picked.has(x.key)) { const p = P.get(x.key); if (p) showSnap(x.key, p); } });
    wait.forEach(c => { const p = P.get(c); if (p) showSnap(c, p); });
    if (wake) setTimeout(pump, Math.max(500, wake - Date.now() + 300));
    upd();
  } finally {
    inPump = false;
  }
}
let pumpT = 0, pumpMaxT = 0, pumpAt = 0;
function runPump(){
  clearTimeout(pumpT); clearTimeout(pumpMaxT);
  pumpT = 0; pumpMaxT = 0; pumpAt = Date.now();
  pump();
}
const pumpSoon = () => {
  clearTimeout(pumpT);
  pumpT = setTimeout(runPump, 100);
  if (!pumpMaxT) {
    const wait = Math.max(24, 180 - (Date.now() - pumpAt));
    pumpMaxT = setTimeout(runPump, wait);
  }
};
let camScrollRaf = 0;
function refreshCamVis(){
  if (document.hidden || !P.size) return;
  if (!camScrollRaf) {
    camScrollRaf = requestAnimationFrame(() => {
      camScrollRaf = 0;
      runPump();
    });
  }
}

const kickCams = () => setTimeout(() => {
  if (document.hidden) return;
  if (camsRenderQueued) renderCams();
  const vr = camVisRect();
  P.forEach((p, c) => {
    p.vis = isCellVisible(c, vr);
    try { vio.unobserve(c); vio.observe(c); } catch (e) {}
    if (!p.vis) return;
    if (p.stopped) return;
    const v = vid(c);
    if (!p.loaded && !p.kickDone) { p.t0 = Date.now(); p.kickDone = true; }
    if (p.loading && Date.now() - p.t0 > 45000) { kill(c); return; }
    if (p.h && p.h !== 'native') {
      try { p.h.startLoad(); } catch (e) {}
    }
    if (p.h === 'native' && v) {
      if (!p.loaded) { try { v.load(); } catch (e) {} }
      else { syncLiveEdge(c, p, v); }
    }
    syncLiveEdge(c, p, v);
    if (p.loaded && v && v.paused && !v._lbPaused) v.play().catch(() => {});
    if (p.waitT) {
      p.waitT = 0;
      if (p.h && p.h !== 'native') { try { p.h.stopLoad(); p.h.startLoad(); } catch (e) {} }
      syncLiveEdge(c, p, v);
      if (v && !v._lbPaused) v.play().catch(() => {});
    }
  });

  if (tvOn) {
    const tvv = $('#tv-video');
    if (tvHls) {
      try { tvHls.startLoad(); } catch (e) {}
      if (tvv && typeof tvHls.liveSyncPosition === 'number' && tvHls.liveSyncPosition > 0) {
        try { tvv.currentTime = tvHls.liveSyncPosition; } catch (e) {}
      }
    }
    const tvSt = $('#tv-body').dataset.state;
    if ((tvSt === 'load' && (!tvLoadT || Date.now() - tvLoadAt > 12000)) || (tvSt === 'fail' && !tvRetryT)) tvPlay();
    else if (tvv && tvv.paused) tvv.play().catch(() => {});
  }
  pump();
}, 400);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    P.forEach((p, c) => {
      p.kickDone = false;
      clearSnapTimer(p);
      if (p.loaded || p.playing) stopCell(c);
      else if (p.loading) dropLoadingCell(c);
    });
    if (tvOn) {
      clearTimeout(tvLoadT); tvLoadT = null;
      if (tvHls) { try { tvHls.stopLoad(); } catch (e) {} }
      const tvv = $('#tv-video');
      if (tvv && !tvv.paused) { tvv._visPaused = true; try { tvv.pause(); } catch (e) {} }
    }
  } else {
    kickCams();
    wakeGlobe();
  }
});
window.addEventListener('pageshow', kickCams);
window.addEventListener('focus', kickCams);
function getCctvScrollRoot(){
  const pb = camGrid && camGrid.parentElement;
  if (!pb) return null;
  const s = getComputedStyle(pb);
  return (s.overflowY === 'auto' || s.overflowY === 'scroll') ? pb : null;
}
let vioRoot = undefined;
let vio = null;
function initVio(){
  const targetRoot = getCctvScrollRoot();
  if (vio && vioRoot === targetRoot) return;
  if (vio) { try { vio.disconnect(); } catch (e) {} }
  vioRoot = targetRoot;
  vio = new IntersectionObserver(es => es.forEach(e => {
    const c = e.target, p = P.get(c); if (!p) return;
    const vr = camVisRect();
    const fr = c.querySelector('.frame');
    const m = CctvCore.measureCell(c.getBoundingClientRect(), fr ? fr.getBoundingClientRect() : null, vr);
    p.vis = m.inView;
    clearTimeout(p.t); clearTimeout(p.rel); p.t = 0; p.rel = 0;
    const isOffTop = m.topClip > 8;
    const isCompletelyOff = m.visH === 0;

    if (p.vis && m.topClip <= 8) {
      if (!p.visAt && !p.loaded) p.visAt = Date.now();
      refreshCamVis();
    } else if (isOffTop || isCompletelyOff) {

      if (p.loaded || p.playing) stopCell(c);
      else if (p.loading) dropLoadingCell(c);
      p.rel = setTimeout(() => { p.rel = 0; if (!isCellVisible(c)) releaseCell(c); }, OFF_FREE_MS);
      refreshCamVis();
    } else {

      refreshCamVis();
    }
  }), { root: targetRoot, rootMargin: '60px 0px 80px 0px', threshold: [0, 0.15, 0.35, 0.6, 0.85, 0.98] });
  P.forEach((_, c) => { try { vio.observe(c); } catch (e) {} });
}
function onCctvScroll(e){
  const t = e && e.target;
  const st = (t && typeof t.scrollTop === 'number') ? t.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
  cctvScrollDir = st >= cctvLastScrollTop ? 'down' : 'up';
  cctvLastScrollTop = st;
  refreshCamVis();
  clearTimeout(camScrollEndT);
  camScrollEndT = setTimeout(runPump, 120);
}
if (camGrid && camGrid.parentElement) camGrid.parentElement.addEventListener('scroll', onCctvScroll, { passive: true });
window.addEventListener('scroll', onCctvScroll, { passive: true });
window.addEventListener('resize', () => { initVio(); refreshCamVis(); }, { passive: true });
initVio();
setInterval(() => {
  if (document.hidden) return;
  const waitingOthers = [...P.values()].some(q => !q.dead && q.vis && !q.h && !q.loading);
  P.forEach((p, c) => {
    if (CctvCore.shouldDemote(p, Date.now(), waitingOthers, SOFT_MS)) {
      if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
      const dv = vid(c); if (dv) cleanVid(dv);
      p.h = null; p.loading = false; p.dem = (p.dem || 0) + 1;
      if (p.dem >= 2 && p.steps && (p.step || 0) < p.steps.length - 1) p.step = (p.step || 0) + 1;
      badge(c, (p.snapMode && p.snapOk) ? 'live' : 'wait', (p.snapMode && p.snapOk) ? 'Live' : 'Antre'); orderCams(); pumpSoon(); return;
    }
    if (p.loading && !p.loaded && !p.hedged && p.steps && API != null && Date.now() - p.t0 > HEDGE_MS && proxyIdx([p.steps[p.step || 0]]) !== 0) {
      const pi = proxyIdx(p.steps);
      if (pi > (p.step || 0)) {
        p.hedged = true; p.step = pi;
        if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
        p.h = null; p.loading = false; startCell(c); return;
      }
    }
    if (p.vis && !p.h && (!p.dead || p.snapMode) && !p.loading) { const cc = camOfCell(c); if (camSnapOK || (cc && cc.snap) || p.snapMode) { const im = c.querySelector('img.snap'); if (!im || (p.snapAt && Date.now() - p.snapAt > ((cc && cc.snap) || p.snapMode ? 15000 : 60000))) showSnap(c, p); } }
    if (p.loading && Date.now() - p.t0 > 45000) return kill(c);
    const v = vid(c); if (!p.h || !p.loaded || p.stopped || !p.vis || !v || v._lbPaused) return;
    if (p.waitT && Date.now() - p.waitT > 10000) {
      p.waitT = 0; syncLiveEdge(c, p, v);
      if (p.h !== 'native') { try { p.h.stopLoad(); p.h.startLoad(); } catch (e) {} }
      v.play().catch(() => {});
      orderCams();
    }
    const stuck = v.paused || v.currentTime === p.ct;
    if (stuck) {
      if (++p.stall >= 2) {
        p.stall = 0;
        if ((p.rest = (p.rest || 0) + 1) >= 3) {
          p.rest = 0;
          if (enterSnapFallback(c, p)) { orderCams(); return; }
          if (p.steps && (p.step = (p.step || 0) + 1) < p.steps.length) {
            if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
            p.h = null; p.loaded = false; p.loading = false; startCell(c);
            return;
          }
          kill(c);
          return;
        }
        syncLiveEdge(c, p, v);
        if (p.h !== 'native') { try { p.h.stopLoad(); p.h.startLoad(); } catch (e) {} }
        v.play().catch(() => {});
        if (p.vis) { badge(c, 'buf', 'Buffering'); orderCams(); pumpSoon(); upd(); }
      }
    } else {
      p.stall = 0; p.rest = 0; p.waitT = 0;
      if (p.stl > 0) p.stl--;
      if (p.bad) { p.bad = false; orderCams(); }
    }
    p.ct = v.currentTime;
  });
}, 5000);

function cellHtml(c, i){
  return `<div class="cam" data-i="${i}" data-s="${esc(c.s)}" role="button" tabindex="0" aria-label="${esc(c.n)}">
    <div class="frame"><span class="badge wait">Antre</span></div>
    <div class="cap">${esc(c.n)}</div>
  </div>`;
}
function layout(){
  const n = cols(); camGrid.style.setProperty('--cols', n);
  const cells = [...camGrid.children]
    .filter(c => !c.hidden && c.style.display !== 'none' && (showOfflineCams || !c.classList.contains('is-offline')))
    .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
  const total = cells.length, r = total % n;
  cells.forEach(c => c.style.gridColumn = '');
  if (!r || total <= n) { if (total && total < n) cells.forEach(c => c.style.gridColumn = 'span ' + Math.floor(n / total)); return; }
  const base = Math.floor(n / r), extra = n % r;
  cells.slice(total - r).forEach((c, k) => c.style.gridColumn = 'span ' + (base + (k < extra ? 1 : 0)));
}
function wantList(){
  const q = ($('#cq').value || '').toLowerCase().replace(/[·|]+/g, ' ').trim();
  const toks = q ? q.split(/\s+/).filter(Boolean) : [];
  const list = [];
  let srvOff = 0;
  for (let i = 0; i < CAMS.length; i++) {
    const c = CAMS[i];
    if (c._hide === true) continue;
    if (!camInDistrict(c, district)) continue;
    if (toks.length) {
      const hay = ((c.n || '') + ' ' + (c.sub || '') + ' ' + (c.region || '') + ' ' + (c.rawC || '') + ' ' + (c.c || '')).toLowerCase();
      if (!toks.every(t => hay.includes(t))) continue;
    }
    const isSrvOff = Boolean(aliveMap && aliveMap[i] === false);
    if (isSrvOff && !showOfflineCams) { srvOff++; continue; }
    list.push({ ...c, _i: i, _srvOff: isSrvOff });
  }
  wantList.srvOff = srvOff;
  const isToll = x => Boolean(x && (x.src === 'bpjt' || x.road === 'toll'));
  list.sort((a, b) => ((a._srvOff ? 1 : 0) - (b._srvOff ? 1 : 0)) || ((isToll(a) ? 1 : 0) - (isToll(b) ? 1 : 0)) || (a._i - b._i));
  return list;
}
let camsRenderQueued = false;
function renderCams(){

  if (document.hidden) { camsRenderQueued = true; return; }
  camsRenderQueued = false;
  const nextList = wantList();
  if (!P.size) {
    camList = nextList;
    camGrid.innerHTML = camList.map(cellHtml).join('');
    camGrid.querySelectorAll('.cam').forEach((el, i) => {
      const c = camList[i];
      const p = { vis: false, idx: i, host: CctvCore.hostOf(c.s) };
      if (c._srvOff) { p.dead = true; p.bad = true; p.tries = 1; badge(el, 'off', 'Offline'); el.classList.add('is-offline'); }
      el.style.order = String(CctvCore.camOrderValue(p, i));
      P.set(el, p);
      vio.observe(el);
    });
    layout(); upd(); pump();
    return;
  }
  const byUrl = new Map();
  P.forEach((p, el) => { if (el.dataset.s) byUrl.set(el.dataset.s, { el, p }); });
  const keepUrls = new Set(nextList.map(c => c.s));
  for (const [url, { el, p }] of byUrl) {
    if (keepUrls.has(url)) continue;
    clearTimeout(p.t); clearTimeout(p.retry); clearTimeout(p.rel); if (p.waitTimer) { clearTimeout(p.waitTimer); p.waitTimer = null; } clearSnapTimer(p);
    p.waitT = 0;
    if (p.h && p.h !== 'native') { try { p.h.destroy(); } catch (e) {} }
    const v = vid(el); if (v) cleanVid(v);
    try { vio.unobserve(el); } catch (e) {}
    P.delete(el);
    el.remove();
  }
  camList = nextList;
  const frag = document.createDocumentFragment(), tpl = document.createElement('div');
  for (let i = 0; i < camList.length; i++) {
    const c = camList[i], ex = byUrl.get(c.s);
    if (ex) {
      ex.p.idx = i;
      ex.el.dataset.i = String(i);
      syncOfflineCell(ex.el, ex.p);
      ex.el.style.order = String(CctvCore.camOrderValue(ex.p, i));
    } else {
      tpl.innerHTML = cellHtml(c, i);
      const el = tpl.firstElementChild;
      const p = { vis: false, idx: i, host: CctvCore.hostOf(c.s) };
      if (c._srvOff) { p.dead = true; p.bad = true; p.tries = 1; badge(el, 'off', 'Offline'); el.classList.add('is-offline'); }
      el.style.order = String(CctvCore.camOrderValue(p, i));
      P.set(el, p);
      vio.observe(el);
      frag.appendChild(el);
    }
  }
  if (frag.childNodes.length) camGrid.appendChild(frag);
  orderCams(true);
  layout(); upd(); pump();
}
function drawCityBar(){
  const cnt = {};
  CAMS.forEach(c => {
    if (c._hide === true) return;
    if (camIsFlood(c)) cnt['Pantau Banjir'] = (cnt['Pantau Banjir'] || 0) + 1;
    const pk = camPrimaryCity(c);
    if (pk !== 'Pantau Banjir') cnt[pk] = (cnt[pk] || 0) + 1;
  });
  const otherCities = Object.keys(cnt)
    .filter(k => k !== 'Pantau Banjir' && k !== 'Kota Jakarta')
    .sort((a, b) => cnt[b] - cnt[a]);
  const ds = ['Semua'];
  if (cnt['Pantau Banjir']) ds.push('Pantau Banjir');
  if (cnt['Kota Jakarta']) ds.push('Kota Jakarta');
  ds.push(...otherCities);
  $('#citybar').innerHTML = ds.map((d, idx) => {
    const n = CAMS.filter(c => c._hide !== true && camInDistrict(c, d)).length;
    const num = String(idx).padStart(2, '0');
    return `<button class="cb" type="button" data-city="${esc(d)}" role="tab" aria-selected="${d === district}">` +
      `<span class="cb-idx">${num}</span>` +
      `<span class="cb-name">${esc(d)}</span>` +
      `<span class="cb-n">${n}</span>` +
    `</button>`;
  }).join('');
}
$('#citybar').addEventListener('click', e => {
  const b = e.target.closest('.cb'); if (!b) return;
  district = b.dataset.city; drawCityBar(); renderCams();
});
$('#cq').addEventListener('input', debounce(renderCams, 200));
if ($('#cam-off-tog')) {
  $('#cam-off-tog').addEventListener('click', () => {
    showOfflineCams = !showOfflineCams;
    camGrid.classList.toggle('show-offline', showOfflineCams);
    P.forEach((p, c) => syncOfflineCell(c, p));
    renderCams();
  });
}
camGrid.addEventListener('mouseleave', () => { if (orderDeferred) orderCams(); });
new ResizeObserver(debounce(() => { layout(); refreshCamVis(); }, 120)).observe(camGrid);
camGrid.addEventListener('click', e => {
  const cell = e.target.closest('.cam'); if (!cell) return;
  const c = camList[+cell.dataset.i]; openLightbox(camStream(c), c.n, camSubLabel(c), c.e, camSteps(c), cell);
});
camGrid.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const cell = e.target.closest('.cam'); if (!cell) return;
  e.preventDefault();
  const c = camList[+cell.dataset.i]; openLightbox(camStream(c), c.n, camSubLabel(c), c.e, camSteps(c), cell);
});
let glbHls = null, glbSteps = [], glbStep = 0, glbErr = 0, glbEmbed = '', glbSnapUrl = '', glbSnapProxy = false, glbSnapTimer = 0, glbSnapLoadTimer = 0, glbSnapState = 'idle', glbMp4Timer = 0, lbTrigger = null, glbUrl = '';
function glbSetOffline(on, msg){
  const errBox = $('#glb-err'), errMsg = $('#glb-err-msg');
  if (errMsg && msg) errMsg.textContent = msg;
  if (errBox) errBox.style.display = on ? 'flex' : 'none';
}
function glbSetSnapSrc(){
  const sim = $('#glb-snap');
  if (!sim || !glbSnapUrl) return;
  if (glbSnapLoadTimer) { clearTimeout(glbSnapLoadTimer); glbSnapLoadTimer = 0; }
  glbSnapLoadTimer = setTimeout(() => {
    glbSnapLoadTimer = 0;
    if (sim.onerror) sim.onerror();
  }, 8000);
  if (/(^|\.)dsdajakarta\.id/i.test(glbSnapUrl) || /SourceEndpoint\.video/i.test(glbSnapUrl)) {
    sim.src = glbSnapUrl;
    return;
  }
  const t = Math.floor(Date.now() / 15000);
  sim.src = (glbSnapProxy && API != null)
    ? tokQ(API + '/api/cctv/snap?u=' + encodeURIComponent(glbSnapUrl) + '&t=' + t)
    : glbSnapUrl + (glbSnapUrl.includes('?') ? '&' : '?') + 't=' + t;
}
function glbFallbackEmbed(){
  const v = $('#glb-video'), ifr = $('#glb-frame'), sim = $('#glb-snap');
  const isKotang = /dpuprkotang\.info/i.test(glbEmbed || glbUrl);
  if (isKotang && glbSnapState === 'fail') {
    if (v) v.style.display = 'none';
    if (sim) { sim.style.display = 'none'; sim.removeAttribute('src'); }
    if (ifr) { ifr.removeAttribute('src'); ifr.style.display = 'none'; }
    glbSetOffline(true, 'Kamera tidak mengirim sinyal video atau snapshot — kemungkinan offline di sumber.');
    if (lbTrigger) {
      const p = P.get(lbTrigger);
      if (p) { p.dead = true; p.bad = true; p.snapMode = false; badge(lbTrigger, 'off', 'Offline'); syncOfflineCell(lbTrigger, p); orderCams(true); upd(); }
    }
    return false;
  }
  if (glbEmbed && ifr && !isDirectSnapFeed(glbUrl)) {
    glbSetOffline(false);
    if (v) v.style.display = 'none';
    if (sim && !isKotang) { sim.style.display = 'none'; sim.removeAttribute('src'); }
    else if (sim) { sim.style.display = 'none'; }
    if (glbSnapTimer && !isKotang) { clearInterval(glbSnapTimer); glbSnapTimer = 0; }
    ifr.src = glbEmbed; ifr.style.display = 'block';
    if (glbUrl && (!isKotang || glbSnapState === 'ok')) {
      camBad.delete(camKey(glbUrl));
      camReport(glbUrl, true);
    }
    if (lbTrigger && (!isKotang || glbSnapState === 'ok')) {
      const p = P.get(lbTrigger);
      if (p) {
        if (p.retry) { clearTimeout(p.retry); p.retry = null; }
        p.dead = false; p.bad = false;
        badge(lbTrigger, 'live', 'Live');
        orderCams();
        upd();
      }
    }
    return true;
  }
  if (glbSnapUrl && sim) {
    glbSetOffline(false);
    if (v) v.style.display = 'none';
    if (ifr) { ifr.removeAttribute('src'); ifr.style.display = 'none'; }
    sim.style.display = 'block';
    if (!sim.src || glbSnapState === 'idle') glbSetSnapSrc();
    if (!glbSnapTimer && !isDirectSnapFeed(glbSnapUrl)) {
      glbSnapTimer = setInterval(glbSetSnapSrc, 15000);
    }
    if (glbSnapState === 'ok') {
      if (glbUrl) {
        camBad.delete(camKey(glbUrl));
        camReport(glbUrl, true);
      }
      if (lbTrigger) {
        const p = P.get(lbTrigger);
        if (p) {
          if (p.retry) { clearTimeout(p.retry); p.retry = null; }
          p.dead = false; p.bad = false; p.snapMode = true; p.snapOk = true;
          badge(lbTrigger, 'live', 'Live');
          orderCams();
          upd();
        }
      }
    }
    return true;
  }
  if (v) v.style.display = 'none';
  if (sim) { sim.style.display = 'none'; sim.removeAttribute('src'); }
  if (ifr) { ifr.removeAttribute('src'); ifr.style.display = 'none'; }
  glbSetOffline(true, 'Kamera tidak mengirim sinyal video atau snapshot — kemungkinan offline di sumber.');
  if (lbTrigger) {
    const p = P.get(lbTrigger);
    if (p) { p.bad = true; p.snapMode = false; badge(lbTrigger, 'off', 'Offline'); upd(); }
  }
  return false;
}
function glbPlay(){
  const v = $('#glb-video'), ifr = $('#glb-frame'), sim = $('#glb-snap');
  glbSetOffline(false);
  if (glbMp4Timer) { clearTimeout(glbMp4Timer); glbMp4Timer = 0; }
  if (glbHls) { try { glbHls.destroy(); } catch (e) {} glbHls = null; }
  try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
  if (ifr) { ifr.removeAttribute('src'); ifr.style.display = 'none'; }
  if (v) {
    v.style.display = 'block';
    v.onplaying = () => {
      if (glbMp4Timer) { clearTimeout(glbMp4Timer); glbMp4Timer = 0; }
      if (sim) sim.style.display = 'none';
      if (glbSnapTimer) { clearInterval(glbSnapTimer); glbSnapTimer = 0; }
      if (glbUrl) {
        camBad.delete(camKey(glbUrl));
        camReport(glbUrl, true);
      }
      if (lbTrigger) {
        const p = P.get(lbTrigger);
        if (p) {
          if (p.retry) { clearTimeout(p.retry); p.retry = null; }
          p.dead = false; p.bad = false; p.tries = 0; p.loaded = true; p.playing = true; p.waitT = 0;
          syncOfflineCell(lbTrigger, p);
          badge(lbTrigger, 'live', 'Live');
          orderCams();
          upd();
        }
      }
    };
  }
  const url = glbSteps[glbStep];
  if (!url || isDirectSnapFeed(url)) { glbFallbackEmbed(); return; }
  if (/\.mp4($|\?)/i.test(url)) {
    v.src = url;
    const failMp4 = () => {
      if (glbMp4Timer) { clearTimeout(glbMp4Timer); glbMp4Timer = 0; }
      v.onerror = v.onloadeddata = null;
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
      if (++glbStep < glbSteps.length) glbPlay();
      else glbFallbackEmbed();
    };
    v.onloadeddata = () => {
      if (glbMp4Timer) { clearTimeout(glbMp4Timer); glbMp4Timer = 0; }
    };
    v.onerror = failMp4;
    glbMp4Timer = setTimeout(failMp4, 8000);
    v.play().catch(() => {});
    return;
  }
  if (needHlsLib(v)) {
    ensureHls().then(() => { const lb = $('#lightbox'); if (lb && !lb.hidden) glbPlay(); })
      .catch(() => { const lb = $('#lightbox'); if (lb && !lb.hidden && v.canPlayType('application/vnd.apple.mpegurl')) glbPlay(); else glbFallbackEmbed(); });
    return;
  }
  if (window.Hls && Hls.isSupported()) {
    glbHls = new Hls(hlsJak({ liveSyncDurationCount:1, maxLiveSyncPlaybackRate:1.15, capLevelToPlayerSize:true, maxBufferLength:8,
      manifestLoadingTimeOut:25000, levelLoadingTimeOut:20000, fragLoadingTimeOut:15000,
      manifestLoadingMaxRetry:3, levelLoadingMaxRetry:2, fragLoadingMaxRetry:3 }));
    glbHls.loadSource(url); glbHls.attachMedia(v);
    glbHls.on(Hls.Events.MANIFEST_PARSED, () => { glbErr = 0; v.play().catch(() => {}); });
    glbHls.on(Hls.Events.ERROR, (ev, d) => {
      if (!d || !d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && glbErr++ < 2) { try { glbHls.startLoad(); } catch (e) {} return; }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && glbErr++ < 2) { try { glbHls.recoverMediaError(); } catch (e) {} return; }
      if (++glbStep < glbSteps.length) glbPlay();
      else glbFallbackEmbed();
    });
  } else {
    v.src = url;
    v.onerror = () => {
      v.onerror = null;
      if (++glbStep < glbSteps.length) glbPlay();
      else glbFallbackEmbed();
    };
    v.play().catch(() => {});
  }
}
function openLightbox(url, nama, kota, embed, steps, trigger){
  const lb = $('#lightbox'), sim = $('#glb-snap');
  lb.hidden = false; document.body.style.overflow = 'hidden';
  lbTrigger = trigger || null;
  glbUrl = url || '';
  glbSetOffline(false);
  if (glbSnapTimer) { clearInterval(glbSnapTimer); glbSnapTimer = 0; }
  if (glbSnapLoadTimer) { clearTimeout(glbSnapLoadTimer); glbSnapLoadTimer = 0; }
  glbSnapState = 'idle';
  const camObj = CAMS.find(x => x.s === url || (steps && steps.includes(x.s)));
  const trigP = trigger ? P.get(trigger) : null;
  glbSnapUrl = (camObj && camObj.snap) || '';
  if (!glbSnapUrl && isDirectSnapFeed(url, camObj)) glbSnapUrl = url || '';
  glbSnapProxy = Boolean(trigP && trigP.snapProxy);
  glbEmbed = (embed && /^(https?:)?\/\//i.test(embed) && /(?:embed|stream\.html)/i.test(embed) && !/balitower/i.test(embed)) ? safeUrl(embed) : '';
  camGrid.querySelectorAll('video').forEach(cv => { if (!cv.paused && !cv._lbPaused) { cv._lbPaused = true; try { cv.pause(); } catch (e) {} } });
  $('#glb-cap').innerHTML = `${esc(nama)} · ${esc(kota)}`;
  if (sim) {
    sim.style.display = 'none';
    if (glbSnapUrl) {
      glbSnapState = 'pending';
      sim.onload = () => {
        if (glbSnapLoadTimer) { clearTimeout(glbSnapLoadTimer); glbSnapLoadTimer = 0; }
        if (sim.naturalWidth <= 0) { if (sim.onerror) sim.onerror(); return; }
        glbSnapState = 'ok';
        if (trigP) { trigP.snapOk = true; trigP.snapFail = 0; trigP.snapFailN = 0; }
        const ifr = $('#glb-frame');
        if (ifr && ifr.style.display !== 'none') {
          if (glbSnapTimer) { clearInterval(glbSnapTimer); glbSnapTimer = 0; }
          if (glbUrl) { camBad.delete(camKey(glbUrl)); camReport(glbUrl, true); }
          if (lbTrigger && trigP) { trigP.dead = false; trigP.bad = false; syncOfflineCell(lbTrigger, trigP); badge(lbTrigger, 'live', 'Live'); orderCams(); upd(); }
        } else if (sim.style.display !== 'none') {
          if (glbUrl) { camBad.delete(camKey(glbUrl)); camReport(glbUrl, true); }
          if (lbTrigger && trigP) { trigP.dead = false; trigP.bad = false; trigP.snapMode = true; trigP.snapOk = true; syncOfflineCell(lbTrigger, trigP); badge(lbTrigger, 'live', 'Live'); orderCams(); upd(); }
        }
      };
      sim.onerror = () => {
        if (glbSnapLoadTimer) { clearTimeout(glbSnapLoadTimer); glbSnapLoadTimer = 0; }
        if (!glbSnapProxy && API != null && glbSnapUrl) {
          glbSnapProxy = true;
          if (trigP) trigP.snapProxy = true;
          glbSetSnapSrc();
        } else {
          glbSnapState = 'fail';
          if (glbSnapTimer) { clearInterval(glbSnapTimer); glbSnapTimer = 0; }
          glbSnapUrl = '';
          sim.style.display = 'none';
          const v = $('#glb-video'), ifr = $('#glb-frame');
          const vidHidden = !v || v.style.display === 'none';
          const isKotangEmbed = Boolean(ifr && ifr.style.display !== 'none' && /dpuprkotang\.info/i.test(glbEmbed || glbUrl));
          if (vidHidden && (!ifr || ifr.style.display === 'none' || isKotangEmbed)) glbFallbackEmbed();
        }
      };
      glbSetSnapSrc();
      if (!isDirectSnapFeed(glbSnapUrl)) glbSnapTimer = setInterval(glbSetSnapSrc, 15000);
    } else {
      sim.onload = null; sim.onerror = null; sim.removeAttribute('src');
    }
  }
  if (isDirectSnapFeed(url, camObj)) {
    glbFallbackEmbed();
    return;
  }
  glbSteps = (steps && steps.length ? steps : [url]); glbStep = 0; glbErr = 0;
  if (trigP && trigP.snapMode && trigP.snapOk && !/\.m3u8|\.mp4/i.test(url)) {
    glbFallbackEmbed();
    return;
  }
  glbPlay();
}
function closeLightbox(){
  $('#lightbox').hidden = true; document.body.style.overflow = '';
  glbEmbed = ''; glbSnapUrl = ''; glbSnapProxy = false; glbSnapState = 'idle';
  glbSetOffline(false);
  if (glbSnapTimer) { clearInterval(glbSnapTimer); glbSnapTimer = 0; }
  if (glbSnapLoadTimer) { clearTimeout(glbSnapLoadTimer); glbSnapLoadTimer = 0; }
  if (glbMp4Timer) { clearTimeout(glbMp4Timer); glbMp4Timer = 0; }
  const sim = $('#glb-snap'); if (sim) { sim.onload = null; sim.onerror = null; sim.removeAttribute('src'); sim.style.display = 'none'; }
  const ifr = $('#glb-frame'); if (ifr) { ifr.removeAttribute('src'); ifr.style.display = 'none'; }
  if (glbHls) { try { glbHls.destroy(); } catch (e) {} glbHls = null; }
  const v = $('#glb-video'); if (v) { v.onplaying = null; v.onloadeddata = null; v.onerror = null; v.style.display = 'block'; try { v.pause(); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e) {} }

  camGrid.querySelectorAll('video').forEach(cv => {
    if (cv._lbPaused) {
      cv._lbPaused = false;
      const cell = cv.closest('.cam');
      const p = cell ? P.get(cell) : null;
      if (p) syncLiveEdge(cell, p, cv);
      try { cv.play().catch(() => {}); } catch (e) {}
    }
  });
  const t = lbTrigger; lbTrigger = null;
  if (t && t.focus) { try { t.focus({ preventScroll: true, focusVisible: false }); } catch (e) { try { t.focus({ preventScroll: true }); } catch (err) {} } }
  if (orderDeferred) orderCams();
  pump();
}
$('#glb-close').addEventListener('click', closeLightbox);
$('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#lightbox').hidden) { closeLightbox(); return; }
    if (rdOn) { rdClose(); return; }
    if ($('#mapwrap').classList.contains('on')) { closeMap(); return; }
    if (tvOn) { tvClose(); return; }
  }
  if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); fltSet(true, true); }
  if ((e.key === 'r' || e.key === 'R') && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) refreshAll(true);
});
async function pullAlive(){
  if (API == null) return;
  try {
    const a = await getJson(API + '/api/cams', 60000);
    if (!a || !Array.isArray(a.alive)) return;
    const s = JSON.stringify(a.alive);
    if (s !== pullAlive.last) { pullAlive.last = s; aliveMap = a.alive; renderCams(); }
    else aliveMap = a.alive;
  } catch (e) {}
}
async function pullCctv(){
  if (API == null) return;
  clearTimeout(pullCctv.retryT);
  pullCctv.retryT = 0;
  try {
    const d = await getJson(API + '/api/cctv', 30000);
    if (d && typeof d.snap === 'boolean') camSnapOK = d.snap;
    const list = (d && Array.isArray(d.cams)) ? d.cams : [];
    const stillWarm = Boolean(d && (d.warming || !list.length || (d.probing && list.length < 24)));
    pullCctv.warming = stillWarm;
    if (list.length) {
      pullCctv.have = pullCctv.have || new Set(CAMS.map(c => c.s));
      pullCctv.keys = pullCctv.keys || new Set(CAMS.map(c => CctvCore.streamKey(c.s)));
      pullCctv.byS = pullCctv.byS || new Map(CAMS.map(c => [c.s, c]));
      let revived = false;
      for (const c of list) {
        const ex = pullCctv.byS.get(c.s);
        if (ex && ex._hide) { ex._hide = false; ex.fails = 0; revived = true; }
      }
      const add = list.filter(c => c && c.s && c.n && !pullCctv.have.has(c.s) && !pullCctv.keys.has(CctvCore.streamKey(c.s))).map(CctvCore.sanitizeFb);
      if (add.length || revived) {
        add.forEach(c => { initCamTags(c); pullCctv.have.add(c.s); pullCctv.keys.add(CctvCore.streamKey(c.s)); pullCctv.byS.set(c.s, c); });
        if (add.length) CAMS.push(...add);
        drawCityBar(); renderCams();
      }
      if (!stillWarm) {
        pullCctv.hydrated = true;
        pullCctv.tries = 0;
      }
    }
    if (stillWarm && (pullCctv.tries = (pullCctv.tries || 0) + 1) <= 15) {
      pullCctv.retryT = setTimeout(() => { pullCctv.retryT = 0; if (!document.hidden) pullCctv(); }, 4500);
    }
  } catch (e) {
    pullCctv.warming = true;
    if (!pullCctv.hydrated && (pullCctv.tries = (pullCctv.tries || 0) + 1) <= 15) {
      pullCctv.retryT = setTimeout(() => { pullCctv.retryT = 0; if (!document.hidden) pullCctv(); }, 4500);
    }
  }
}
schedulePoll(() => pullCctv(), 90000);
schedulePoll(() => pullAlive(), 120000);
let offProbeCursor = 0;
setInterval(() => {
  if (document.hidden) return;
  const offCells = [...camGrid.querySelectorAll('.cam.is-offline')];
  if (!offCells.length) return;
  for (let k = 0; k < Math.min(3, offCells.length); k++) {
    const cell = offCells[(offProbeCursor++) % offCells.length];
    probeOfflineCell(cell);
  }
}, 60000);

