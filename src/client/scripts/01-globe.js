const HOT_MS = 90 * 60e3;
function focusCandidates(){
  const now = Date.now();
  const winOf = (p, fallback12h) => {
    if (p.sub === 'gempa') { const m = magOf(p); return (m != null && m >= 6.5) ? 8 * 3600e3 : (fallback12h ? 12 * 3600e3 : 3 * 3600e3); }
    return fallback12h ? 12 * 3600e3 : 2 * 3600e3;
  };
  const pick = (fallback12h) => (PULSE || []).concat(DIS_PULSE || []).filter(p => {
    if (p.fixed || typeof p.la !== 'number' || typeof p.lo !== 'number') return false;
    if (!inSitWindow(p, now)) return false;
    if (legendOn[legendKeyOf(p)] === false) return false;
    if (!(p.la > -12 && p.la < 8 && p.lo > 92 && p.lo < 145)) return false;
    if (!p.ts || now - p.ts > winOf(p, fallback12h) || p.ts > now + 5 * 60e3) return false;
    if (p.sub === 'gempa') {
      const isBmkg = p.src === 'BMKG' || (p.eid || '').startsWith('bmkg:');
      if (!isBmkg) { const m = magOf(p); if (m != null && m < MAG_MIN_FOCUS) return false; }
    }
    return true;
  });
  const hot = pick(false);
  return hot.length || sitWindow === 'live' ? hot : pick(true);
}

const isCriticalFlood = p => !!(p && p.kind === 'flood' && ((p.siaga && p.siaga <= 2) || (p.state && p.state >= 3)));
const focusRank = p => ((p.sub === 'volcano' || (p.sub === 'gempa' && (magOf(p) || 0) >= 5) || isCriticalFlood(p)) && Date.now() - (p.ts || 0) < HOT_MS) ? 1 : 0;
const focusSort = (a, b) => (focusRank(b) - focusRank(a)) || (b.ts || 0) - (a.ts || 0);

function doFocus(t){
  lastAutoFocus = Date.now();
  focusedHome = false;

  ptrs.clear();
  gesture = null;
  globeVel = null;
  const c = $('#sit-globe');
  if (c) c.style.cursor = 'grab';

  flyTo(t.la, t.lo, 13, 'focus');
  setLinkItem(t); showSitAlert(t);
}
function maybeFocusFresh(){
  const now = Date.now();
  const items = focusCandidates();
  const liveIds = new Set();
  for (const p of items) {
    const id = itemIdOf(p);
    if (!id) continue;
    liveIds.add(id);
    if (!seenIds.has(id)) {

      if (!(bootUntil && Date.now() < bootUntil && now - p.ts > 600e3)) {
        if (!focusQueue.some(q => itemIdOf(q) === id)) focusQueue.push(p);
        if (isCriticalFlood(p) && typeof clToastSensorAlert === 'function') clToastSensorAlert(p);
      }
      seenIds.add(id);
    }
  }
  for (let i = focusQueue.length - 1; i >= 0; i--) {
    const qid = itemIdOf(focusQueue[i]);
    if (!liveIds.has(qid)) { focusQueue.splice(i, 1); }
  }
  if (seenIds.size > 3000) { const keep = [...seenIds].slice(-3000); seenIds.clear(); keep.forEach(x => seenIds.add(x)); }
  saveSeen();
  if (document.hidden) return;
  if (mapOpen) return;
  if (now < focusHoldUntil) return;

  const sa = $('#sit-alert');
  const alertActive = sa && !sa.hidden && !saHiding;

  if (!alertActive && focusQueue.length) {
    focusQueue.sort(focusSort);
    const q = focusQueue.shift();
    rotSeen.set(itemIdOf(q), now);
    doFocus(q);
    return;
  }

  if (performance.now() - lastGestEnd < 25000) return;
  if (now - lastAutoFocus < FOCUS_COOLDOWN) return;

  if (now - lastRotFocus >= ROTATE_MS) {
    const eligible = items
      .filter(p => { const id = itemIdOf(p); return id && now - (rotSeen.get(id) || 0) >= ROT_SEEN_MS; })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (eligible.length) {
      const pick = eligible[0];
      rotSeen.set(itemIdOf(pick), now);
      if (rotSeen.size > 500) { for (const [k, v] of rotSeen) if (now - v > ROT_SEEN_MS) rotSeen.delete(k); }
      lastRotFocus = now;
      doFocus(pick);
      return;
    }

  }
  goHome();
}
function goHome(){
  if (focusedHome || !globeReady) return;
  if (performance.now() - lastGestEnd < 60000) return;
  focusedHome = false;
  flyTo(HOME_VIEW.lat, HOME_VIEW.lon, HOME_VIEW.zoom, 'home');
}
setInterval(() => {
  if (document.hidden || !globeReady) return;
  maybeFocusFresh();
}, 15000);

let globeSyncT = 0;
function syncGlobeSoon(){
  clearTimeout(globeSyncT);
  globeSyncT = setTimeout(() => { try { pullIncidents(); pullSituation(); } catch (e) {} }, 2000);
}
let linkItem = null;
function setLinkItem(p){ linkItem = p; }
let sitAlertTimer2 = 0, sitAlertUrl = '';
let saCdIv = 0, saCdAcc = 0, saCdT0 = 0, saCdPaused = false, saHiding = false;
let saShowT0 = 0, saHideT0 = 0;

function hideSitAlert(){
  const el = $('#sit-alert');
  if (!el || saHiding || el.hidden) return;
  saHiding = true;
  saHideT0 = Date.now();
  clearInterval(saCdIv);
  clearTimeout(sitAlertTimer2);
  el.classList.add('hide');
  sitAlertTimer2 = setTimeout(() => {
    el.hidden = true;
    el.classList.remove('hide', 'show');
    setLinkItem(null);
    saHiding = false;
    saHideT0 = 0;

    if (focusQueue.length > 0) {
      maybeFocusFresh();
    } else if (globeReady && !mapOpen && ptrs.size === 0 && !gesture) {
      flyTo(HOME_VIEW.lat, HOME_VIEW.lon, HOME_VIEW.zoom, 'home');
    }
  }, 320);
}

const isReadUrl = u => /^https?:\/\//i.test(String(u || '').trim());
function showSitAlert(p){
  const el = $('#sit-alert'); if (!el) return;
  const cat = legendKeyOf(p) || p.kind || 'insiden';
  const color = CAT_COLOR[cat] || '#8d8d8d';
  const canRead = isReadUrl(p.url);
  const ageMin = p.ts ? Math.max(0, Math.floor((Date.now() - p.ts) / 60000)) : -1;
  const ago = ageMin < 0 ? '' : ageMin < 1 ? 'baru saja' : ageMin < 60 ? ageMin + ' mnt lalu' : ageMin < 1440 ? Math.floor(ageMin / 60) + ' jam lalu' : Math.floor(ageMin / 1440) + ' hari lalu';
  el.innerHTML = `<div class="sa-box" style="--sa-c:${color}">
    <div class="sa-tm"><b>${p.ts ? esc(wibTime(p.ts)) : '--:--'}</b><div class="sa-low">${ago ? `<span class="sa-ago">${esc(ago)}</span>` : ''}<span class="sa-cd" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i style="--n:${i}"></i>`).join('')}</span></div></div>
    <div>
      <span class="sa-k2" style="color:${color}">${esc(p.label || CAT_LABEL[cat])}${p.name ? ' · ' + esc(p.name) : ''}</span>
      <div class="sa-t">${esc(cleanTitle(deEmoji(p.title || ''), p.pub || p.src))}</div>
      <div class="sa-ft">
        <span class="sa-m">${esc(cleanSrc(p.src, p.pub))}${p.n > 1 ? ` · ${p.n} artikel` : ''}</span>
        <div class="sa-acts">
          ${canRead ? '<button class="sa-go" type="button" aria-label="Buka di reader" title="Buka di reader">Buka reader ↗</button>' : ''}
          <button class="sa-close-btn" type="button" aria-label="Tutup alert" title="Tutup alert">Tutup</button>
        </div>
      </div>
    </div>
  </div>`;
  el.title = canRead ? 'Buka di reader' : '';
  el.setAttribute('role', 'button');
  sitAlertUrl = canRead ? p.url : '';
  el.hidden = false;
  el.classList.remove('hide');
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(sitAlertTimer2); clearInterval(saCdIv);
  const cdSegs = [...el.querySelectorAll('.sa-cd i')];
  saShowT0 = Date.now();
  saHideT0 = 0;
  saCdAcc = 0; saCdT0 = Date.now(); saCdPaused = false; saHiding = false;
  const saPaint = () => {
    const elp = saCdAcc + (saCdPaused ? 0 : Date.now() - saCdT0);
    for (let i = 0; i < cdSegs.length; i++) if (elp >= (cdSegs.length - 1 - i) / (cdSegs.length - 1) * 9700) cdSegs[i].classList.add('done');
    if (elp >= 10000 && !saHiding) {
      hideSitAlert();
    }
  };
  saCdIv = setInterval(saPaint, 120); saPaint();
}
(function(){
  const el = $('#sit-alert');
  if (!el) return;
  const openAlert = (ev) => {
    if (ev) ev.stopPropagation();
    if (!sitAlertUrl) return;
    rdOpen(sitAlertUrl, null, true, '').catch(() => window.open(sitAlertUrl, '_blank', 'noopener'));
  };
  el.addEventListener('click', (ev) => {
    const closeBtn = ev.target.closest('.sa-close-btn');
    if (closeBtn) {
      ev.stopPropagation();
      hideSitAlert();
      return;
    }
    openAlert(ev);
  });

  const pauseSa = () => {
    if (saCdPaused) return;
    saCdPaused = true; saCdAcc += Date.now() - saCdT0;
  };
  const resumeSa = () => {
    if (!saCdPaused) return;
    saCdPaused = false; saCdT0 = Date.now();
  };
  el.addEventListener('mouseenter', pauseSa);
  el.addEventListener('mouseleave', resumeSa);
  el.addEventListener('touchstart', pauseSa, { passive: true });
  el.addEventListener('touchend', resumeSa, { passive: true });
  el.addEventListener('touchcancel', resumeSa, { passive: true });
})();

let landIdx = null;
function landIndex(){
  if (landIdx || !globeIdn) return landIdx;
  landIdx = [];
  for (const f of globeIdn.features) {
    const g = f.geometry; if (!g) continue;
    for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)) {
      let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
      for (const q of poly[0]) { if (q[0] < a) a = q[0]; if (q[0] > c) c = q[0]; if (q[1] < b) b = q[1]; if (q[1] > d) d = q[1]; }
      landIdx.push({ poly, bb: [a, b, c, d] });
    }
  }
  return landIdx;
}
function inRingPt(r, x, y){ let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function onLandPt(lo, la){
  const ix = landIndex(); if (!ix) return true;
  for (const { poly, bb } of ix) {
    if (lo < bb[0] || lo > bb[2] || la < bb[1] || la > bb[3]) continue;
    if (inRingPt(poly[0], lo, la) && !poly.slice(1).some(h => inRingPt(h, lo, la))) return true;
  }
  return false;
}
const JIT = new Map();
function jitterGeo(name, la, lo, slot, prec){
  if (prec === 'desa' || prec === 'kelurahan' || slot === 0 || !landIndex()) return [la, lo];
  const key = name + '|' + slot + '|' + la.toFixed(3) + ',' + lo.toFixed(3);
  const hit = JIT.get(key); if (hit) return hit;
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const wide = prec === 'prov' || prec === 'region';
  const maxKm = wide ? 140 : 24, baseKm = wide ? 18 : 3;
  const km0 = Math.min(baseKm + Math.sqrt(slot) * (wide ? 22 : 4.2), maxKm), ang0 = slot * 2.399963 + (h % 628) / 100;
  const cl = Math.cos(la * Math.PI / 180) || 1e-6;
  let out = [la, lo];
  outer: for (let shrink = 1; shrink >= 0.2; shrink -= 0.2) {
    for (let t = 0; t < 12; t++) {
      const ang = ang0 + t * 0.5236, km = km0 * shrink * (t % 2 ? 0.75 : 1);
      const la2 = la + Math.sin(ang) * km / 110.57, lo2 = lo + Math.cos(ang) * km / (111.32 * cl);
      if (onLandPt(lo2, la2)) { out = [la2, lo2]; break outer; }
    }
  }
  JIT.set(key, out); return out;
}
let globeBaseCanvas = null, globeBaseCtx = null, globeBaseKey = '', globeAnimOn = false;
function wakeGlobe(){ if (globeReady && !globeRaf && !mapOpen && !document.hidden) globeRaf = requestAnimationFrame(globeLoop); }
function drawGlobe(now){
  if (!globeLoadDone) syncGlobeLoadState();
  now = now || performance.now();
  const c = $('#sit-globe');
  if (!c || typeof d3 === 'undefined') return;
  tickFly(now);
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }

  let shakeX = 0, shakeY = 0;
  const isQuakeAlert = !!(linkItem && (linkItem.sub === 'gempa' || linkItem.kind === 'gempa') && !$('#sit-alert')?.hidden);
  const activeQuake = isQuakeAlert ? linkItem : activeGlobeQuake;
  const shaking = !REDUCED && activeQuake && view.zoom > 3.0;
  if (shaking) {
    const zoomFactor = Math.min(1, (view.zoom - 3.0) / 2.0);
    const m = magOf(activeQuake) || 5;
    const baseAmp = Math.min(3.2, Math.max(1.0, (m - 2.5) * 0.6));
    const amp = baseAmp * zoomFactor;
    shakeX = Math.sin(now / 37) * amp;
    shakeY = Math.cos(now / 53) * amp * 0.7;
  }
  ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
  globeShakeX = shakeX; globeShakeY = shakeY;
  ctx.clearRect(-8, -8, w + 16, h + 16);
  const proj = globeProject();
  globeProj = proj;
  globeCenter = [view.lon, view.lat];

  const baseKey = [cw, ch, view.lon.toFixed(4), view.lat.toFixed(4), view.zoom.toFixed(5),
    globeCtx ? 1 : 0, globeIdn ? 1 : 0, (globeProv && !gesture) ? 1 : 0].join('|');
  if (!globeBaseCanvas) {
    globeBaseCanvas = document.createElement('canvas');
    globeBaseCtx = globeBaseCanvas.getContext('2d');
  }
  if (globeBaseKey !== baseKey) {
    if (globeBaseCanvas.width !== cw || globeBaseCanvas.height !== ch) { globeBaseCanvas.width = cw; globeBaseCanvas.height = ch; }
    const bctx = globeBaseCtx;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    const bpath = d3.geoPath(proj, bctx);
    const baseR = Math.min(w, h) / 2 - 8;

    const grad = bctx.createRadialGradient(w * 0.38, h * 0.34, baseR * view.zoom * 0.12, w / 2, h / 2, baseR * view.zoom + 2);
    grad.addColorStop(0, '#161616');
    grad.addColorStop(0.72, '#101010');
    grad.addColorStop(1, '#0b0b0b');
    bctx.beginPath(); bpath({ type: 'Sphere' });
    bctx.fillStyle = grad; bctx.fill();
    bctx.lineWidth = 1; bctx.strokeStyle = '#2e2e2e'; bctx.stroke();

    bctx.beginPath(); bpath(d3.geoGraticule10());
    bctx.lineWidth = .45; bctx.strokeStyle = 'rgba(255,255,255,.06)'; bctx.stroke();

    if (globeCtx) {
      for (const f of globeCtx.features) {
        bctx.beginPath(); bpath(f);
        bctx.fillStyle = '#141414'; bctx.fill();
        bctx.lineWidth = .55; bctx.strokeStyle = '#222222'; bctx.stroke();
      }
    }

    if (globeIdn) {
      for (const f of globeIdn.features) {
        bctx.beginPath(); bpath(f);
        bctx.fillStyle = '#202020'; bctx.fill();
        bctx.lineWidth = .9; bctx.strokeStyle = '#4e4e4e'; bctx.stroke();
      }
    }
    if (globeProv && !gesture) {
      bctx.save();
      if (globeIdn) { bctx.beginPath(); for (const f of globeIdn.features) bpath(f); bctx.clip(); }
      bctx.beginPath(); bpath(globeProv);
      bctx.lineWidth = .7; bctx.strokeStyle = 'rgba(200,200,200,.28)'; bctx.stroke();
      bctx.restore();
    }

    bctx.beginPath(); bpath({ type: 'Sphere' });
    bctx.lineWidth = 2.2; bctx.strokeStyle = 'rgba(96,96,96,.32)'; bctx.stroke();
    globeBaseKey = baseKey;
  }
  ctx.drawImage(globeBaseCanvas, 0, 0, w, h);
  globeAnimOn = shaking;

  const tsNow = Date.now();

  const zoomTaper = view.zoom > 8 ? Math.max(0.45, 8 / view.zoom) : 1;
  const zoomBoost = Math.min(4.5, (view.zoom - 1) * 0.55) * zoomTaper;
  const slotCount = {};
  const pts = [];

  const nodePts = [];
  {
    const hot = new Set();
    for (const p of (PULSE || [])) if (!p.fixed && p.name) hot.add(p.name);

    const nr = Math.max(1.0, (0.55 + Math.min(0.75, Math.max(0, view.zoom - 1) * 0.22)) * zoomTaper);
    ctx.save();
    ctx.fillStyle = 'rgba(160,160,160,.30)';
    ctx.beginPath();
    for (const p of (PULSE || [])) {
      if (!p.fixed || hot.has(p.name) || typeof p.la !== 'number') continue;
      if (d3.geoDistance([p.lo, p.la], globeCenter) >= Math.PI / 2 - 0.03) continue;
      const q = proj([p.lo, p.la]);
      if (!q) continue;
      ctx.moveTo(q[0] + nr, q[1]); ctx.arc(q[0], q[1], nr, 0, Math.PI * 2);
      nodePts.push({ x: q[0], y: q[1], r: nr, node: p });
    }
    ctx.fill();
    ctx.restore();
  }
  for (const p of (PULSE || []).concat(DIS_PULSE || [])) {
    if (p.fixed || typeof p.la !== 'number' || typeof p.lo !== 'number') continue;
    if (!inSitWindow(p, tsNow)) continue;
    if (legendOn[legendKeyOf(p)] === false) continue;
    if (d3.geoDistance([p.lo, p.la], globeCenter) >= Math.PI / 2 - 0.03) continue;
    const xy = proj([p.lo, p.la]);
    if (!xy) continue;
    const ageMs = p.ts ? Math.max(0, tsNow - p.ts) : 3 * 3600e3;
    const fresh = ageMs < 45 * 60e3;
    const alpha = ageMs < 2 * 3600e3 ? 0.96 : (ageMs < 12 * 3600e3 ? 0.78 : 0.46);
    const name = p.name || '';
    const real = !!p.sub;
    const slot = real ? 0 : (slotCount[name] || 0);
    if (!real) slotCount[name] = slot + 1;
    const jl = jitterGeo(name, p.la, p.lo, slot, p.prec);
    const xy2 = jl[0] === p.la && jl[1] === p.lo ? xy : proj([jl[1], jl[0]]);
    if (!xy2) continue;
    const baseR = 1.35 + (p.weight || .3) * 2.5 + zoomBoost;
    const r = ageMs >= 12 * 3600e3 ? baseR * 0.84 : baseR;
    pts.push({ x: xy2[0], y: xy2[1],
      r, cat: p.kind, color: p.sub === 'gempa' ? '#ff5a4e' : p.sub === 'volcano' ? (LVL_COLOR[p.lvl] || '#8d8d8d') : p.sub === 'tma' ? (p.siaga === 1 ? '#ff3b30' : p.siaga === 2 ? '#ff9500' : '#4589ff') : p.sub === 'flood' ? (p.state >= 4 ? '#ff3b30' : p.state === 3 ? '#ff9500' : '#4589ff') : (CAT_COLOR[p.kind] || '#8d8d8d'), fresh, alpha, ageMs, p });
  }
  pts.sort((a, b) => a.r - b.r);
  const focusId = linkItem ? itemIdOf(linkItem) : '';
  for (const d of pts) {
    const isFocus = !!(focusId && d.p && itemIdOf(d.p) === focusId);
    const dim = !!(focusId && !isFocus);
    const sub = d.p && d.p.sub;
    if (sub === 'gempa') {
      if (!REDUCED) globeAnimOn = true;

      const mag = d.p.mag || 3;
      const baseR = d.r + 2 + mag * 0.9;
      for (let k = 0; k < 3; k++) {
        const prog = REDUCED ? 0.5 : (((((now / 1000) * (0.55 - k * 0.08) + d.p.la * 5.1 + k * 0.37 + Math.abs(d.p.lo) * 0.013) % 1) + 1) % 1);
        const ringR = baseR + prog * (16 + mag * 5);
        ctx.beginPath(); ctx.arc(d.x, d.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(d.color, (dim ? 0.1 : (1 - prog) * (0.75 - k * 0.18)));
        ctx.lineWidth = k === 0 ? 1.6 : 1;
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(d.color, dim ? 0.25 : 0.9);
      ctx.lineWidth = 1;
      ctx.stroke();
      continue;
    }
    if (sub === 'volcano') {

      const s = d.r * 2.4;
      const alert = d.p.lvl === 'LEVEL IV' || d.p.lvl === 'LEVEL III';
      if (alert && !dim) {
        if (!REDUCED) globeAnimOn = true;
        const prog = REDUCED ? 0.5 : (((((now / 1000) * 0.8 + d.p.la * 3.7) % 1) + 1) % 1);
        ctx.beginPath(); ctx.arc(d.x, d.y, s * 0.9 + prog * 14, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(d.color, (1 - prog) * 0.55);
        ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - s); ctx.lineTo(d.x + s * 0.92, d.y + s * 0.62); ctx.lineTo(d.x - s * 0.92, d.y + s * 0.62);
      ctx.closePath();
      ctx.save();
      ctx.shadowColor = d.color; ctx.shadowBlur = dim ? 0 : (alert ? 12 : 5);
      ctx.fillStyle = hexA(d.color, (alert ? 0.95 : 0.72) * (dim ? 0.3 : 1));
      ctx.fill(); ctx.restore();
      ctx.lineWidth = .9; ctx.strokeStyle = '#0d0d0d'; ctx.stroke();
      continue;
    }
    if (sub === 'tma' || sub === 'flood') {
      const alert = isCriticalFlood(d.p);
      const s = d.r * (alert ? 2.1 : 1.7);
      if (alert && !dim) {
        if (!REDUCED) globeAnimOn = true;
        for (let k = 0; k < 2; k++) {
          const prog = REDUCED ? 0.5 : (((((now / 1000) * (0.68 - k * 0.14) + d.p.la * 4.3 + k * 0.45) % 1) + 1) % 1);
          ctx.beginPath(); ctx.arc(d.x, d.y, s * 1.1 + prog * 15, 0, Math.PI * 2);
          ctx.strokeStyle = hexA(d.color, (1 - prog) * (0.72 - k * 0.22));
          ctx.lineWidth = k === 0 ? 1.4 : 0.95; ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - s);
      ctx.lineTo(d.x + s * 0.88, d.y);
      ctx.lineTo(d.x, d.y + s);
      ctx.lineTo(d.x - s * 0.88, d.y);
      ctx.closePath();
      ctx.save();
      ctx.shadowColor = d.color; ctx.shadowBlur = dim ? 0 : (alert ? 12 : 6);
      ctx.fillStyle = hexA(d.color, (alert ? 0.95 : 0.78) * (dim ? 0.3 : 1));
      ctx.fill(); ctx.restore();
      ctx.lineWidth = .9; ctx.strokeStyle = '#0d0d0d'; ctx.stroke();
      continue;
    }

    if (d.fresh && !dim) {
      if (!REDUCED) globeAnimOn = true;
      const pulseA = REDUCED ? 0.45 : 0.25 + (Math.sin(now / 480 + d.p.la * 3 + Math.abs(d.p.lo)) * 0.5 + 0.5) * 0.35;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(d.color, pulseA);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.save();
    ctx.shadowColor = d.color;
    ctx.shadowBlur = dim ? 0 : (d.ageMs < 2 * 3600e3 ? 7 : (d.ageMs < 12 * 3600e3 ? 4 : 0));
    ctx.fillStyle = hexA(d.color, (d.alpha || 0.65) * (dim ? 0.3 : 1));
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = .7; ctx.strokeStyle = '#0d0d0d'; ctx.stroke();
    if (d.p && (d.p.prec === 'prov' || d.p.prec === 'region') && !dim) {
      ctx.save(); ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 3.2, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(d.color, .7); ctx.lineWidth = .9; ctx.stroke(); ctx.restore();
    }
  }

  if (globeActInc) {
    const d = pts.find(q => q.p && itemIdOf(q.p) === globeActInc);
    if (d) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 3, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  if (globeActNode) {
    const d = nodePts.find(q => q.node && 'n:' + (q.node.name || '') === globeActNode);
    if (d) { ctx.beginPath(); ctx.arc(d.x, d.y, 6.5, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.3; ctx.stroke(); }
  }

  if (view.zoom >= 1.0 && !gesture) {
    const groups = new Map();
    for (const d of pts) {
      const n = (d.p && d.p.name) || '';
      if (!n) continue;
      if (!groups.has(n)) groups.set(n, { name: n.toUpperCase(), x: 0, y: 0, c: 0 });
      const g = groups.get(n); g.x += d.x; g.y += d.y; g.c++;
    }
    const labels = [...groups.values()]
      .map(g => ({ name: g.name, x: g.x / g.c, y: g.y / g.c, c: g.c }))
      .sort((a, b) => b.c - a.c || (a.name < b.name ? -1 : 1));
    const maxLab = view.zoom < 1.42 ? 5 : view.zoom < 2.2 ? 20 : view.zoom < 8 ? 80 : Math.max(10, Math.round(80 * 8 / view.zoom));
    ctx.font = '600 8px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const L of labels) {
      const text = L.name + ' ' + L.c;
      const tw = ctx.measureText(text).width;
      const bw = tw + 6, bh = 13;
      let bx = L.x + 11;
      if (bx + bw > w - 4 && L.x - 11 - bw >= 4) bx = L.x - 11 - bw;
      const box = { x: bx, y: L.y - 6, w: bw, h: bh };
      if (box.x < 2 || box.x + box.w > w - 2 || box.y < 2 || box.y + box.h > h - 2) continue;
      if (placed.length >= maxLab) break;
      const clash = placed.some(p => p.x < box.x + box.w && p.x + p.w > box.x && p.y < box.y + box.h && p.y + p.h > box.y);
      if (clash) continue;
      ctx.fillStyle = 'rgba(10,10,10,.72)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = 'rgba(255,255,255,.09)';
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = '#d4d4d4';
      ctx.fillText(text, box.x + 3, box.y + box.h / 2 + 0.5);
      placed.push(box);
    }
  }

  const alertEl = $('#sit-alert');
  const fp = linkItem && alertEl && !alertEl.hidden && (alertEl.classList.contains('show') || saHiding)
    ? pts.find(d => d.p && itemIdOf(d.p) === itemIdOf(linkItem)) : null;
  if (fp) {
    const wrapR = c.getBoundingClientRect(), ar = alertEl.getBoundingClientRect();
    const ex = ar.left - wrapR.left, ey = ar.top - wrapR.top;
    let ax = clampN(fp.x, ex, ex + ar.width), ay = clampN(fp.y, ey, ey + ar.height);
    const onH = ay <= ey + 0.5 || ay >= ey + ar.height - 0.5;
    const onV = ax <= ex + 0.5 || ax >= ex + ar.width - 0.5;
    if (Math.abs(ax - fp.x) < 6 && onH) ax = clampN(ax + (ax + 26 <= ex + ar.width ? 26 : -26), ex + 6, ex + ar.width - 6);
    else if (Math.abs(ay - fp.y) < 6 && onV) ay = clampN(ay + (ay + 26 <= ey + ar.height ? 26 : -26), ey + 6, ey + ar.height - 6);
    const col = fp.color || '#8d8d8d';

    let connAlpha = 0.8;
    if (saHiding && saHideT0) {
      const hideProg = Math.min(1, Math.max(0, (Date.now() - saHideT0) / 300));
      connAlpha = 0.8 * (1 - hideProg);
    } else if (saShowT0) {
      const showProg = Math.min(1, Math.max(0, (Date.now() - saShowT0) / 280));
      connAlpha = 0.8 * showProg;
    }

    if (connAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = connAlpha; ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.setLineDash([5, 7]);
      const dx = ax - fp.x, dy = ay - fp.y;
      ctx.beginPath();
      if (Math.abs(dx) < 1 || Math.abs(dy) < 1) {
        ctx.moveTo(fp.x, fp.y); ctx.lineTo(ax, ay);
      } else {
        const r = Math.min(10, Math.abs(dx) / 2, Math.abs(dy) / 2);
        const sx = Math.sign(dx), sy2 = Math.sign(dy);
        ctx.moveTo(fp.x, fp.y);
        ctx.lineTo(ax - sx * r, fp.y);
        ctx.quadraticCurveTo(ax, fp.y, ax, fp.y + sy2 * r);
        ctx.lineTo(ax, ay);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(fp.x, fp.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ax, ay, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  globePoints = pts;
  globeNodePoints = nodePts;
  if (globeAnimOn || ptrs.size > 0 || flyAnim || globeVel || saHiding || (saShowT0 && Date.now() - saShowT0 < 300)) wakeGlobe();
}
let globeVel = null;
function globeLoop(now){
  globeRaf = 0;
  if (!globeReady) { globeRaf = requestAnimationFrame(globeLoop); return; }
  if (mapOpen || document.hidden) return;

  if (globeVel && !gesture && !flyAnim) {
    const dt = Math.min(50, Math.max(4, now - (globeLast || now - 16)));
    view.lon += globeVel.vx * dt;
    view.lon = ((view.lon + 540) % 360) - 180;
    view.lat = clampN(view.lat + globeVel.vy * dt, -64, 64);
    const dec = Math.exp(-dt / 260);
    globeVel.vx *= dec; globeVel.vy *= dec;
    if (Math.hypot(globeVel.vx, globeVel.vy) < 0.004) globeVel = null;
  }
  const busy = ptrs.size > 0 || !!flyAnim || !!globeVel || now - lastGestEnd < 250 || saHiding || (saShowT0 && Date.now() - saShowT0 < 300);
  if (now - globeLast > (busy ? 4 : 45)) {
    globeLast = now;
    const gc = $('#sit-globe');
    if (gc && (!gc.clientWidth || !gc.clientHeight)) { try { tickFly(now); } catch (e) {} }
    else drawGlobe(now);
  }
  if (busy || globeAnimOn) globeRaf = requestAnimationFrame(globeLoop);
}

function collectHits(list, x, y, r, hitR){
  const out = [];
  for (const d of list) {
    const hit = hitR(d, r);
    const dist = Math.hypot(d.x + globeShakeX - x, d.y + globeShakeY - y);
    if (dist < hit) out.push({ d, dist });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

const hitT = () => Math.min(1, Math.max(0.45, 6 / view.zoom));
const incHitR = (d, r) => Math.max(r * hitT(), r > 15 ? 10 : 6, (d.r || 2) + 4);
const nodeHitR = (d, r) => Math.max(r * hitT(), r > 15 ? 10 : 8, Math.min(10, (d.r || 1) + 6));

const cyc = { inc: { sig: '', i: 0, t: 0 }, node: { sig: '', i: 0, t: 0 } };
const cycId = h => h.d.p ? itemIdOf(h.d.p) : 'n:' + (h.d.node.name || '');
function cycPick(bucket, hits, advance){
  const sig = hits.map(cycId).join('|');
  const now = performance.now();
  if (sig !== bucket.sig) { bucket.sig = sig; bucket.i = 0; bucket.t = now; }
  else if (advance && now - bucket.t > 450) { bucket.i = (bucket.i + 1) % hits.length; bucket.t = now; }
  return hits[Math.min(bucket.i, hits.length - 1)];
}

function pickGlobe(x, y, r = 9, advance = true){
  const inc = collectHits(globePoints, x, y, r, incHitR);
  if (inc.length) { const h = cycPick(cyc.inc, inc, advance); globeActInc = cycId(h); globeActNode = ''; return { d: h.d, node: false }; }
  const nd = collectHits(globeNodePoints, x, y, r, nodeHitR);
  if (nd.length) { const h = cycPick(cyc.node, nd, advance); globeActNode = cycId(h); globeActInc = ''; return { d: h.d, node: true }; }
  cyc.inc.sig = cyc.node.sig = '';
  globeActInc = globeActNode = '';
  return null;
}
const precTxt = p => p.prec === 'desa' ? 'lokasi: centroid administrasi BIG (desa, perkiraan)' : p.prec === 'kelurahan' ? 'lokasi: centroid administrasi BIG (kelurahan, perkiraan)' : p.prec === 'kec' ? 'lokasi: kecamatan dikenali, titik memakai pusat kab/kota' : p.prec === 'prov' ? 'lokasi: perkiraan tingkat provinsi' : p.prec === 'region' ? 'lokasi: perkiraan wilayah' : p.prec === 'kab' ? 'lokasi: pusat kab/kota' : '';
function placeSitTip(e, touch){
  const tip = $('#sit-tip');
  const wrap = $('.sit-mapwrap').getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = e.clientX - wrap.left + 12, top = e.clientY - wrap.top + 12;
  if (touch) { left = e.clientX - wrap.left - tw / 2; top = e.clientY - wrap.top - th - 22; if (top < 4) top = e.clientY - wrap.top + 22; }
  if (left + tw > wrap.width - 6) left = touch ? wrap.width - tw - 8 : e.clientX - wrap.left - tw - 10;
  if (top + th > wrap.height - 6) top = e.clientY - wrap.top - th - 10;
  tip.style.left = Math.max(4, left) + 'px';
  tip.style.top = Math.max(4, top) + 'px';
}
function showGlobeTip(e, d, touch){
  const tip = $('#sit-tip');
  const p = d.p || {};
  const canRead = isReadUrl(p.url);
  activeGlobeQuake = (d.cat === 'gempa' || p.sub === 'gempa' || p.kind === 'gempa') ? p : null;
  tip.dataset.url = canRead ? p.url : '';
  tip.innerHTML = `<div class="tip-k" style="color:${d.color}">${esc(p.label || CAT_LABEL[d.cat])}${p.name ? ' · ' + esc(p.name) : ''}</div>
    <div class="tip-t">${esc(cleanTitle(deEmoji(p.title || ''), p.pub || p.src))}</div>
    <div class="tip-m">${esc(cleanSrc(p.src, p.pub))} · <span class="tip-time">${esc(p.ts ? wibTime(p.ts) + ' WIB' : '')}</span>${precTxt(p) ? ' · ' + esc(precTxt(p)) : ''}</div>${touch && canRead ? '<div class="tip-h">Buka reader ↗</div>' : ''}`;
  tip.hidden = false;
  placeSitTip(e, touch);
}
function showNodeTip(e, d, touch){
  activeGlobeQuake = null;
  const tip = $('#sit-tip');
  const n = d.node;
  tip.dataset.url = '';
  tip.dataset.nodeLa = (n && n.la != null) ? String(n.la) : '';
  tip.dataset.nodeLo = (n && n.lo != null) ? String(n.lo) : '';
  tip.innerHTML = `<div class="tip-k" style="color:#8d8d8d">NODE PEMANTAUAN</div>
    <div class="tip-t">${esc(n.name || '')}</div>
    <div class="tip-m">${esc(n.prov || '')} · ${touch ? 'ketuk lagi untuk fokus' : 'klik untuk fokus wilayah'}</div>`;
  tip.hidden = false;
  placeSitTip(e, touch);
}

let sitPopUrl = '';
function showGlobePop(e, d){
  const pop = $('#sit-pop'); if (!pop) return;
  const p = d.p || {};
  const canRead = isReadUrl(p.url);
  activeGlobeQuake = (d.cat === 'gempa' || p.sub === 'gempa' || p.kind === 'gempa') ? p : null;
  sitPopUrl = canRead ? p.url : '';
  pop.dataset.url = sitPopUrl;
  pop.innerHTML = `<div class="tip-k" style="color:${d.color}">${esc(p.label || CAT_LABEL[d.cat])}${p.name ? ' · ' + esc(p.name) : ''}</div>
    <div class="tip-t">${esc(cleanTitle(deEmoji(p.title || ''), p.pub || p.src))}</div>
    <div class="tip-m">${esc(cleanSrc(p.src, p.pub))} · <span class="tip-time">${esc(p.ts ? wibTime(p.ts) + ' WIB' : '')}</span>${precTxt(p) ? ' · ' + esc(precTxt(p)) : ''}</div>${canRead ? '<div class="pop-ft"><span class="pop-go">Buka reader ↗</span></div>' : ''}`;
  pop.hidden = false;
  const wrap = $('.sit-mapwrap').getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = e.clientX - wrap.left - pw / 2, top = e.clientY - wrap.top - ph - 22;
  if (top < 4) top = e.clientY - wrap.top + 22;
  if (left + pw > wrap.width - 6) left = wrap.width - pw - 8;
  if (left < 4) left = 4;
  if (top + ph > wrap.height - 6) top = e.clientY - wrap.top - ph - 10;
  pop.style.left = Math.max(4, left) + 'px';
  pop.style.top = Math.max(4, top) + 'px';
}
const hideGlobeTip = () => {
  activeGlobeQuake = null;
  globeActNodeKey = '';
  const tip = $('#sit-tip'); if (tip) { tip.hidden = true; tip.dataset.url = ''; tip.dataset.nodeLa = ''; tip.dataset.nodeLo = ''; }
  const pop = $('#sit-pop'); if (pop) { pop.hidden = true; sitPopUrl = ''; }
};
function ptrEnd(e){
  ptrs.delete(e.pointerId);
  const c = $('#sit-globe');
  if (ptrs.size === 0) {
    const wasDrag = gesture && gesture.moved > 8;
    if (wasDrag) {
      globeSuppressClick = performance.now();

      if (gesture.mode === 'rotate' && gesture.vx !== undefined && Math.hypot(gesture.vx, gesture.vy) > 0.08)
        globeVel = { vx: -gesture.vx * 0.22, vy: gesture.vy * 0.20 };
      lastGestEnd = performance.now();
      hideGlobeTip();
    } else if (gesture) {

      const touch = globePtrType === 'touch' || globePtrType === 'pen' || e.pointerType === 'touch';
      if (touch) {
        globeSuppressClick = performance.now();
        const rect = c.getBoundingClientRect();
        const hit = pickGlobe(e.clientX - rect.left, e.clientY - rect.top, 24, false);
        if (hit && hit.node) {
          const n = hit.d.node;
          const nodeKey = 'node:' + (n.name || '') + '|' + (n.prov || '');
          if (globeActNodeKey === nodeKey && performance.now() - globeActNodeAt < 5000) {
            globeActNodeKey = '';
            hideGlobeTip();
            lastGestEnd = performance.now();
            focusedHome = false;
            flyTo(n.la, n.lo, Math.max(view.zoom, 11), 'node');
          } else {
            globeActNodeKey = nodeKey;
            globeActNodeAt = performance.now();
            hideGlobeTip();
            showNodeTip(e, hit.d, true);
          }
        } else if (hit && hit.d && hit.d.p) {
          globeActNodeKey = '';
          hideGlobeTip();
          showGlobePop(e, hit.d);
        } else {
          globeActNodeKey = '';
          hideGlobeTip();
        }
      }
    }
    gesture = null;
    if (c) c.style.cursor = 'grab';
  } else if (ptrs.size === 1) {
    const it = ptrs.values().next().value;
    gesture = { mode: 'rotate', startLon: view.lon, startLat: view.lat, x: it.x, y: it.y, moved: 0 };
  }
}
function bindGlobeEvents(){
  const c = $('#sit-globe');
  c.addEventListener('pointerdown', e => {
    e.preventDefault();
    globePtrType = e.pointerType || 'mouse';
    try { c.setPointerCapture(e.pointerId); } catch (err) {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flyAnim = null; globeVel = null;
    if (ptrs.size === 1) {
      gesture = { mode: 'rotate', startLon: view.lon, startLat: view.lat, x: e.clientX, y: e.clientY, moved: 0 };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom, moved: 0 };
    }
    c.style.cursor = 'grabbing';
    hideGlobeTip();
    globeActInc = globeActNode = '';
    wakeGlobe();
  });
  c.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) && e.pointerType !== 'touch') {
      const rect = c.getBoundingClientRect();
      const hit = pickGlobe(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) { c.style.cursor = 'pointer'; hit.node ? showNodeTip(e, hit.d) : showGlobeTip(e, hit.d); }
      else { c.style.cursor = 'grab'; hideGlobeTip(); }
      return;
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.mode === 'rotate' && ptrs.size === 1) {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      gesture.moved += Math.abs(dx) + Math.abs(dy);
      view.lon = gesture.startLon - dx * 0.20;
      view.lon = ((view.lon + 540) % 360) - 180;
      view.lat = clampN(gesture.startLat + dy * 0.18, -64, 64);

      const nowM = performance.now(), dtm = nowM - (gesture.pt || nowM);
      if (dtm > 0 && dtm < 120) {
        const ivx = (e.clientX - (gesture.px ?? e.clientX)) / dtm, ivy = (e.clientY - (gesture.py ?? e.clientY)) / dtm;
        gesture.vx = gesture.vx === undefined ? ivx : gesture.vx * 0.7 + ivx * 0.3;
        gesture.vy = gesture.vy === undefined ? ivy : gesture.vy * 0.7 + ivy * 0.3;
      }
      gesture.px = e.clientX; gesture.py = e.clientY; gesture.pt = nowM;
    } else if (gesture.mode === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.dist > 0) {
        const want = clampN(gesture.zoom * dist / gesture.dist, 0.9, ZOOM_MAX);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, want / view.zoom);
      }
      gesture.moved += 1;
    }
    lastGestEnd = performance.now();
  });
  c.addEventListener('pointerup', ptrEnd);
  c.addEventListener('pointercancel', ptrEnd);
  c.addEventListener('lostpointercapture', e => { if (ptrs.has(e.pointerId)) ptrEnd(e); });

  const ptrEndAny = e => { if (ptrs.has(e.pointerId)) ptrEnd(e); };
  window.addEventListener('pointerup', ptrEndAny);
  window.addEventListener('pointercancel', ptrEndAny);
  window.addEventListener('blur', () => { ptrs.clear(); gesture = null; const g = $('#sit-globe'); if (g) g.style.cursor = 'grab'; hideGlobeTip(); });
  let wheelAcc = 0, wheelT = 0;
  c.addEventListener('wheel', e => {
    e.preventDefault();
    flyAnim = null; globeVel = null;
    wheelAcc += e.deltaY;
    const now = performance.now();
    if (now - wheelT < 90) { lastGestEnd = now; return; }
    wheelT = now;
    const f = wheelAcc < 0 ? 1.4 : 1 / 1.4; wheelAcc = 0;
    zoomAt(e.clientX, e.clientY, f);
    lastGestEnd = now;
    wakeGlobe();
  }, { passive: false });
  c.addEventListener('mouseleave', () => {
    if (globePtrType === 'touch' || globePtrType === 'pen') return;
    if (!ptrs.size) { hideGlobeTip(); globeActInc = globeActNode = ''; }
  });

  const pop = $('#sit-pop');
  const tip = $('#sit-tip');
  const stopGlobeBleed = ev => {
    if (ev) ev.stopPropagation();
  };
  ['pointerdown', 'touchstart', 'touchend', 'pointerup'].forEach(evt => {
    if (pop) pop.addEventListener(evt, stopGlobeBleed, { passive: true });
    if (tip) tip.addEventListener(evt, stopGlobeBleed, { passive: true });
  });
  if (pop) pop.addEventListener('click', ev => {
    if (ev) ev.stopPropagation();
    const u = pop.dataset.url || sitPopUrl; sitPopUrl = ''; pop.dataset.url = '';
    hideGlobeTip();
    if (u) rdOpen(u, null, true, '').catch(() => window.open(u, '_blank', 'noopener'));
  });
  if (tip) tip.addEventListener('click', ev => {
    if (ev) ev.stopPropagation();
    const u = tip.dataset.url;
    if (u) {
      hideGlobeTip();
      rdOpen(u, null, true, '').catch(() => window.open(u, '_blank', 'noopener'));
    } else if (tip.dataset.nodeLa && tip.dataset.nodeLo) {
      const la = parseFloat(tip.dataset.nodeLa), lo = parseFloat(tip.dataset.nodeLo);
      hideGlobeTip();
      lastGestEnd = performance.now();
      focusedHome = false;
      flyTo(la, lo, Math.max(view.zoom, 11), 'node');
    }
  });
  c.addEventListener('click', e => {
    if (performance.now() - globeSuppressClick < 350) return;
    const touch = globePtrType === 'touch' || globePtrType === 'pen';
    if (touch) return;
    const rect = c.getBoundingClientRect();
    const hit = pickGlobe(e.clientX - rect.left, e.clientY - rect.top, 9, false);
    if (hit && hit.node) {
      const n = hit.d.node;
      hideGlobeTip();
      lastGestEnd = performance.now();
      focusedHome = false;
      flyTo(n.la, n.lo, Math.max(view.zoom, 11), 'node');
      return;
    }
    if (!hit && e.detail === 2) {
      lastGestEnd = performance.now();
      focusedHome = false;
      flyTo(HOME_VIEW.lat, HOME_VIEW.lon, HOME_VIEW.zoom, 'home');
      return;
    }
    const inc = hit ? hit.d : null;
    if (inc && inc.p && isReadUrl(inc.p.url)) rdOpen(inc.p.url, null, true, '').catch(() => window.open(inc.p.url, '_blank', 'noopener'));
  });
}
function renderMapLegend(st){
  const cats = [...CAT_ORDER.filter(c => CAT_GEO[c]), ...LEGEND_SUB];
  const on = Object.keys(legendOn).filter(k => legendOn[k]).length;
  const total = Object.keys(legendOn).length;

  const menuEl = smlgBox.querySelector('.smlg-menu');
  const wasOpen = !!(menuEl && menuEl.classList.contains('open'));
  $('#sit-map-legend').innerHTML =
    `<button class="smlg-btn" type="button" aria-expanded="${wasOpen ? 'true' : 'false'}">Filter <span class="cm">${on}/${total}</span><i class="cr"></i></button>` +
    `<div class="smlg-menu${wasOpen ? ' open' : ''}">` + cats.map(c =>
      `<button class="smlg-it" type="button" data-cat="${esc(c)}" aria-pressed="${legendOn[c] ? 'true' : 'false'}"><i style="background:${CAT_COLOR[c]}"></i>${CAT_LABEL[c]}<b>${st[c] || 0}</b></button>`).join('') +
    `</div>`;
  const mLeg = $('#map-leg-items');
  if (mLeg) {
    mLeg.innerHTML = cats.map(c => `<span class="lg"><i style="background:${CAT_COLOR[c]}"></i>${CAT_LABEL[c]}</span>`).join('');
  }
}
let globeTopoDone = false, globeLoadDone = false, globeLoadForced = false;
let globeNoiseTimer = 0, globeLoadWatchTimer = 0, globeLoadFailTimer = 0;
let globeNoiseImg = null, globeNoiseSeed = (Date.now() ^ 0x9e3779b9) >>> 0;

function drawGlobeNoiseFrame(){
  const cv = $('#sgl-noise');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width, h = cv.height;
  if (!globeNoiseImg || globeNoiseImg.width !== w || globeNoiseImg.height !== h) {
    globeNoiseImg = ctx.createImageData(w, h);
  }
  const d = globeNoiseImg.data;
  let s = globeNoiseSeed || 0x13579bdf;
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
  const bandY = Math.abs(s) % h;
  const hasBand = (s & 7) === 0;
  for (let y = 0; y < h; y++) {
    const bandBoost = (hasBand && Math.abs(y - bandY) <= 1) ? 46 : 0;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const u = s >>> 24;
      const i = (rowOff + x) * 4;
      const v = Math.min(255, ((u * u) >> 9) + bandBoost);
      d[i] = v;
      d[i + 1] = Math.min(255, v + (bandBoost ? 14 : 6));
      d[i + 2] = Math.min(255, v + (bandBoost ? 18 : 10));
      d[i + 3] = u > 180 ? 150 : 64;
    }
  }
  globeNoiseSeed = s;
  ctx.putImageData(globeNoiseImg, 0, 0);
}

function stopGlobeNoise(){
  if (globeNoiseTimer) { clearInterval(globeNoiseTimer); globeNoiseTimer = 0; }
  if (globeLoadWatchTimer) { clearInterval(globeLoadWatchTimer); globeLoadWatchTimer = 0; }
  if (globeLoadFailTimer) { clearTimeout(globeLoadFailTimer); globeLoadFailTimer = 0; }
  globeNoiseImg = null;
}

function startGlobeNoise(){
  if (globeLoadDone || document.hidden) return;
  drawGlobeNoiseFrame();
  if (!REDUCED && !globeNoiseTimer) {
    globeNoiseTimer = setInterval(() => {
      if (globeLoadDone || document.hidden) {
        if (globeNoiseTimer) { clearInterval(globeNoiseTimer); globeNoiseTimer = 0; }
        return;
      }
      drawGlobeNoiseFrame();
      syncGlobeLoadState();
    }, 75);
  } else if (!globeLoadWatchTimer) {
    globeLoadWatchTimer = setInterval(() => {
      if (globeLoadDone) {
        if (globeLoadWatchTimer) { clearInterval(globeLoadWatchTimer); globeLoadWatchTimer = 0; }
        return;
      }
      syncGlobeLoadState();
    }, 150);
  }
}

function syncGlobeLoadState(){
  const wrap = $('.sit-mapwrap');
  const box = $('#sit-globe-load');
  const msg = $('#sgl-msg');
  if (!wrap || !box) return;
  if (globeLoadDone) return;
  const incDone = typeof geoIncLoaded !== 'undefined' && geoIncLoaded;
  const offlineReady = apiProbed && API == null;
  if (msg) {
    if (globeTopoDone && !globeReady) msg.textContent = 'Peta gagal dimuat…';
    else if (!apiProbed && !globeTopoDone) msg.textContent = 'Mencari koneksi…';
    else if (!globeTopoDone) msg.textContent = 'Memuat topologi peta…';
    else if (offlineReady) msg.textContent = 'Mode offline · peta siaga';
    else if (!incDone) msg.textContent = 'Memuat insiden & sensor…';
    else msg.textContent = 'Tersinkron';
  }
  if ((globeTopoDone && (incDone || offlineReady)) || globeLoadForced) {
    globeLoadDone = true;
    wrap.classList.remove('is-loading');
    box.setAttribute('aria-hidden', 'true');
    stopGlobeNoise();
  }
}

function sitInitMap(){
  bindGlobeEvents();
  startGlobeNoise();
  syncGlobeLoadState();
  if (!globeLoadFailTimer) {
    globeLoadFailTimer = setTimeout(() => { globeLoadForced = true; syncGlobeLoadState(); }, 18000);
  }
  fetchGlobe().then(ok => {
    globeReady = ok;
    globeTopoDone = true;
    if (!ok) $('.sit-globe-tag').textContent = 'PETA GAGAL DIMUAT';
    syncGlobeLoadState();
    drawGlobe(performance.now());
    if (!globeRaf) globeRaf = requestAnimationFrame(globeLoop);
  });
}
document.addEventListener('visibilitychange', () => {
  if (globeLoadDone) return;
  if (document.hidden) {
    if (globeNoiseTimer) { clearInterval(globeNoiseTimer); globeNoiseTimer = 0; }
  } else {
    startGlobeNoise();
    syncGlobeLoadState();
  }
});
const smlgBox = $('#sit-map-legend');
smlgBox.addEventListener('click', e => {
  const it = e.target.closest('.smlg-it');
  if (it) {
    const c = it.dataset.cat;
    legendOn[c] = !legendOn[c];
    it.setAttribute('aria-pressed', legendOn[c] ? 'true' : 'false');
    const on = Object.keys(legendOn).filter(k => legendOn[k]).length;
    const cm = smlgBox.querySelector('.cm'); if (cm) cm.textContent = on + '/' + Object.keys(legendOn).length;
    drawGlobe(performance.now());
    if (typeof mapOpen !== 'undefined' && mapOpen) {
      if (typeof paintMap === 'function') paintMap();
      if (typeof syncLayers === 'function') syncLayers();
    }
    return;
  }
  if (e.target.closest('.smlg-btn')) {
    const open = smlgBox.querySelector('.smlg-menu').classList.toggle('open');
    smlgBox.querySelector('.smlg-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
});
document.addEventListener('click', e => {
  const m = smlgBox.querySelector('.smlg-menu');
  if (m && m.classList.contains('open') && !smlgBox.contains(e.target)) {
    m.classList.remove('open');
    const b = smlgBox.querySelector('.smlg-btn'); if (b) b.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = smlgBox.querySelector('.smlg-menu');
    if (m) m.classList.remove('open');
    const b = smlgBox.querySelector('.smlg-btn'); if (b) b.setAttribute('aria-expanded', 'false');
  }
});
addEventListener('resize', () => drawGlobe(performance.now()));

