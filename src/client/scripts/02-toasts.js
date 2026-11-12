function buildClusters(){
  const items = [...(SIT && SIT.items || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const groups = [];
  const usedIds = new Set();
  for (const it of items) {
    if (!it.ts) continue;
    const place = it.place || '';
    const cat = it.cat || 'insiden';
    const events = it.assessment?.version === SitrepSignals.VERSION ? (it.assessment.events || []).filter(e => e.category === cat) : [];
    if (!events.length) continue;
    let target = null, targetEvent = null;
    for (const g of groups) {
      if (g.place !== place || g.cat !== cat) continue;
      if (g.latest && g.latest - it.ts > 12 * 3600e3) continue;
      const compatible = events.find(e => g.events.every(member => SitrepSignals.matches(member, e)));
      if (compatible) { target = g; targetEvent = compatible; break; }
    }
    if (!target) {
      if (groups.length >= 24) continue;

      let id = cat + '|' + place + '|' + (events[0].location?.name || events[0].target || '') + '|' + (events[0].type || '');
      let n = 1;
      while (usedIds.has(id)) id = cat + '|' + place + '|' + (events[0].location?.name || events[0].target || '') + '|' + (events[0].type || '') + '#' + (n++);
      usedIds.add(id);
      target = { id, place, cat, items: [], events: [], latest: 0, earliest: 0, sources: new Set() };
      groups.push(target);
    }
    target.items.push(it);
    target.events.push(targetEvent || events[0]);
    if (it.ts > target.latest) target.latest = it.ts;
    if (!target.earliest || it.ts < target.earliest) target.earliest = it.ts;
    if (it.src) target.sources.add(it.src);
  }
  return groups.sort((a, b) => {
    const w = g => Math.max(...g.items.map(x => x.weight || 0));
    return (b.sources.size - a.sources.size) || (w(b) - w(a)) || (b.latest - a.latest);
  });
}
function clusterHtml(g, i){
  const lead = g.items[0];
  const open = openCluster === g.id;
  const wMax = Math.max(...g.items.map(x => x.weight || 0));
  const pips = wMax >= 0.6 ? 3 : wMax >= 0.35 ? 2 : 1;
  const lines = g.items.slice(0, 6).map(x =>
    `<div class="cl-line"><time>${esc(x.ts ? wibTime(x.ts) : '')}</time>
      <span><a href="${escUrl(x.url)}" target="_blank" rel="noopener">${esc(cleanTitle(deEmoji(x.title || ''), x.pub || x.src))}</a><span class="cl-s">${esc(cleanSrc(x.src, x.pub))}</span></span></div>`).join('');
  return `<div class="cl" data-cat="${esc(g.cat)}" data-id="${esc(g.id)}">
    <div class="cl-main">
      <div class="cl-hd"><i class="cl-dot" aria-hidden="true"></i>
        <span class="cl-cat">${esc(lead.label || CAT_LABEL[g.cat])}</span>
        <span class="cl-place">${esc(g.place || 'Wilayah belum pasti')}</span>
        <span class="cl-pips" title="Tingkat keparahan">${'<i class="on"></i>'.repeat(pips)}${'<i></i>'.repeat(3 - pips)}</span>
        <span class="cl-srcs">${g.sources.size} sumber</span></div>
      <div class="cl-t">${esc(cleanTitle(deEmoji(lead.title || ''), lead.pub || lead.src))}</div>
      <div class="cl-f"><span>${g.items.length} kabar</span>
        ${g.earliest && g.latest && g.latest > g.earliest ? `<span>·</span><span>${esc(wibTime(g.earliest))} - ${esc(wibTime(g.latest))}</span>` : ``}
        <button class="cl-more" type="button" data-toggle="${esc(g.id)}" aria-expanded="${open ? 'true' : 'false'}">${open ? 'tutup' : 'timeline'}</button></div>
      <div class="cl-body" ${open ? '' : 'hidden'}>${lines}</div>
    </div>
  </div>`;
}

function renderClusters(groups){
  groups = groups || (SIT ? buildClusters() : []);
  const shown = groups.map((g, i) => clusterHtml(g, i)).join('');
  $('#cl-list').innerHTML = shown ||
    '<div class="empty">Belum ada klaster aktif.</div>';
}
$('#cl-list').addEventListener('click', e => {
  const b = e.target.closest('[data-toggle]');
  if (!b) return;
  const id = b.dataset.toggle;
  openCluster = openCluster === id ? '' : id;
  renderClusters();
});

const CL_TTL = 6000;
const CL_DIGEST_AT = 3;
const CL_KEY_GAP = 6 * 3600e3;
const WIRE_SEEN_TTL = 12 * 3600e3;
let wireSeen = new Map();
let wireKeys = new Map();
let wireSeeded = false;

function rebuildWireKeys(){
  wireKeys = new Map();
  for (const [k, t] of wireSeen){
    const i = k.indexOf('|'); if (i < 0) continue;
    const j = k.indexOf('|', i + 1); if (j < 0) continue;
    const gk = k.slice(0, j);
    if (t > (wireKeys.get(gk) || 0)) wireKeys.set(gk, t);
  }
}
function loadWireSeen(){
  try {
    const raw = JSON.parse(sessionStorage.getItem('sit:wire') || '[]');
    const cut = Date.now() - WIRE_SEEN_TTL;
    wireSeen = new Map(raw.filter(r => Array.isArray(r) && r[1] >= cut));
  } catch (e) { wireSeen = new Map(); }
  rebuildWireKeys();

  wireSeeded = wireSeen.size > 0;
}
function saveWireSeen(){
  const cut = Date.now() - WIRE_SEEN_TTL;
  for (const [k, t] of wireSeen) if (t < cut) wireSeen.delete(k);
  while (wireSeen.size > 3000) wireSeen.delete(wireSeen.keys().next().value);
  try { sessionStorage.setItem('sit:wire', JSON.stringify([...wireSeen])); } catch (e) {}
}
const wireKeyOf = it => it.cat + '|' + (it.place || (it.foreign ? 'global' : ''));

const wireIdOf = it => {
  const t = String(cleanTitle(it.title || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
  return wireKeyOf(it) + '|' + (t || it.url);
};

const clusterCapable = it => Array.isArray(it.assessment && it.assessment.events) &&
  it.assessment.events.some(e => e.category === it.cat);

function noteWire(d){
  if (!d || !d.sources) return;
  const now = Date.now(), batch = new Map();
  for (const s of d.sources){
    if (!s.ok) continue;
    for (const it of s.items || []){
      if (!it.cat || !it.url || !it.ts) continue;
      if (it.foreign) continue;
      if (it.ts > now + 5 * 60e3) continue;
      if (now - it.ts > 90 * 60e3) continue;
      const k = wireIdOf(it);
      if (wireSeen.has(k)) continue;
      wireSeen.set(k, now);
      const gk = wireKeyOf(it);
      if (!batch.has(gk)) batch.set(gk, []);
      batch.get(gk).push(it);
    }
  }
  if (!wireSeeded){
    wireSeeded = true;
    rebuildWireKeys();
    saveWireSeen();
    return;
  }
  if (!batch.size){ saveWireSeen(); return; }
  saveWireSeen();

  const groups = [...batch.entries()]
    .map(([gk, items]) => ({ gk, items: items.sort((a, b) => b.ts - a.ts) }))
    .sort((a, b) => b.items[0].ts - a.items[0].ts);

  const all = groups.map(g => ({
    ...g,
    isNew: (!wireKeys.has(g.gk) || now - wireKeys.get(g.gk) > CL_KEY_GAP) && g.items.some(clusterCapable)
  }));
  const cards = all.slice(0, 4);
  all.forEach(c => wireKeys.set(c.gk, now));
  const nNew = all.filter(c => c.isNew).length;

  if (cards.length >= CL_DIGEST_AT || groups.length > cards.length) clToastDigest(cards, groups.length, nNew, [...new Set(all.map(c => c.items[0].place).filter(Boolean))]);
  else [...cards].reverse().forEach(clToastCard);
}

function clToastCard(c){
  const box = $('#cl-toasts'); if (!box) return;
  if (clToastOrder.length >= 6) { clToastSyncMore(); return; }
  const lead = c.items[0], n = c.items.length;
  const el = document.createElement('div');
  el.className = 'cl-toast';
  el.title = 'Klik untuk dismiss alert';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-label', 'Alert klaster baru: klik untuk menutup');
  el.dataset.url = lead.url || '';
  if (typeof lead.la === 'number' && typeof lead.lo === 'number') {
    el.dataset.la = String(lead.la);
    el.dataset.lo = String(lead.lo);
  } else if (lead.place) {
    const pMatch = (PULSE || []).find(p => p.name && p.name.toLowerCase() === lead.place.toLowerCase());
    if (pMatch && typeof pMatch.la === 'number' && typeof pMatch.lo === 'number') {
      el.dataset.la = String(pMatch.la);
      el.dataset.lo = String(pMatch.lo);
    }
  }
  el.style.setProperty('--tc', CAT_COLOR[lead.cat] || '#8d8d8d');
  el.innerHTML =
    `<i class="cl-c ptl"></i><i class="cl-c ptr"></i><i class="cl-c pbl"></i><i class="cl-c pbr"></i>` +
    `<div class="cl-tk"><i></i><span>${c.isNew ? 'Klaster baru' : 'Kabar baru'} · ${esc(wibTime(lead.ts))}</span><span class="cl-x" aria-hidden="true" title="Tutup">Tutup</span></div>` +
    `<div class="cl-th">${esc(cleanTitle(deEmoji(lead.title || ''), lead.pub || lead.src))}</div>` +

    `<div class="cl-tf"><span>${esc(lead.place || (lead.foreign ? 'Global' : 'Wilayah belum pasti'))}` +
    ` · ${esc(CAT_LABEL[lead.cat] || 'Insiden')}${n > 1 && lead.place ? ' · ' + n + ' kabar' : ''}</span></div>` +
    `<i class="cl-cd"></i>`;
  clToastMount(box, el);
}

const sensorToastSeen = new Set();
function clToastSensorAlert(p){
  const box = $('#cl-toasts');
  if (!box || !p) return;
  const id = itemIdOf(p);
  if (!id || sensorToastSeen.has(id)) return;
  sensorToastSeen.add(id);
  if (sensorToastSeen.size > 500) {
    const first = sensorToastSeen.values().next().value;
    sensorToastSeen.delete(first);
  }
  if (clToastOrder.length >= 6) { clToastSyncMore(); return; }
  const cat = p.kind || 'flood';
  const col = CAT_COLOR[cat] || '#4589ff';
  const el = document.createElement('div');
  el.className = 'cl-toast';
  el.title = 'Klik untuk dismiss alert';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-label', 'Alert sensor banjir: klik untuk menutup');
  el.dataset.url = p.url || '';
  if (typeof p.la === 'number' && typeof p.lo === 'number') {
    el.dataset.la = String(p.la);
    el.dataset.lo = String(p.lo);
  }
  el.style.setProperty('--tc', col);
  el.innerHTML =
    `<i class="cl-c ptl"></i><i class="cl-c ptr"></i><i class="cl-c pbl"></i><i class="cl-c pbr"></i>` +
    `<div class="cl-tk"><i></i><span>${esc(p.label || 'SIAGA BANJIR')} · ${esc(wibTime(p.ts || Date.now()))}</span><span class="cl-x" aria-hidden="true" title="Tutup">Tutup</span></div>` +
    `<div class="cl-th">${esc(p.title || 'Peringatan Banjir')}</div>` +
    `<div class="cl-tf"><span>${esc(p.name || 'Lokasi')} · ${esc(p.src || CAT_LABEL[cat] || 'Banjir')}</span></div>` +
    `<i class="cl-cd"></i>`;
  clToastMount(box, el);
}

function clToastDigest(cards, total, nNew, placesAll){
  const box = $('#cl-toasts'); if (!box || !cards.length) return;
  if (clToastOrder.length >= 6) { clToastSyncMore(); return; }
  const lead = cards[0].items[0];

  const places = placesAll || [...new Set(cards.map(c => c.items[0].place).filter(Boolean))];

  if (typeof nNew !== 'number') nNew = cards.filter(c => c.isNew).length;
  const head = !nNew ? `${total} kabar baru`
    : nNew === total ? `${total} klaster baru`
    : `${total} kabar baru · ${nNew} klaster`;
  const placeTxt = places.length > 2
    ? `${places.slice(0, 2).join(' · ')} · +${places.length - 2} wilayah`
    : (places.join(' · ') || 'beberapa wilayah');
  const el = document.createElement('div');
  el.className = 'cl-toast cl-digest';
  el.title = 'Klik untuk dismiss alert';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-label', 'Alert kabar baru: klik untuk menutup');
  el.dataset.url = lead.url || '';
  if (typeof lead.la === 'number' && typeof lead.lo === 'number') {
    el.dataset.la = String(lead.la);
    el.dataset.lo = String(lead.lo);
  } else if (lead.place) {
    const pMatch = (PULSE || []).find(p => p.name && p.name.toLowerCase() === lead.place.toLowerCase());
    if (pMatch && typeof pMatch.la === 'number' && typeof pMatch.lo === 'number') {
      el.dataset.la = String(pMatch.la);
      el.dataset.lo = String(pMatch.lo);
    }
  }
  el.style.setProperty('--tc', CAT_COLOR[lead.cat] || '#8d8d8d');
  el.innerHTML =
    `<i class="cl-c ptl"></i><i class="cl-c ptr"></i><i class="cl-c pbl"></i><i class="cl-c pbr"></i>` +
    `<div class="cl-tk"><i></i><span>${head} · ${esc(wibTime(lead.ts))}</span><span class="cl-x" aria-hidden="true" title="Tutup">Tutup</span></div>` +
    `<div class="cl-th">${esc(cleanTitle(deEmoji(lead.title || ''), lead.pub || lead.src))}</div>` +
    `<div class="cl-tf"><span>${esc(placeTxt)}</span></div>` +
    `<i class="cl-cd"></i>`;
  clToastMount(box, el);
}

function buildClRailSvg(rawH){
  const H = Math.max(48, Math.round(rawH || 68));
  const W = 24, pad = 2.6, R = 9.4, T = 3.5, lead = 2.2, slant = 3.1, gap = 1.7, segs = 6;
  const arcLen = Math.PI * 0.5 * R;
  const straightLen = Math.max(8, (H * 0.5 - 1.2) - (pad + R));
  const totalLen = lead + arcLen + straightLen;
  const step = (totalLen + gap) / segs;

  function sampleWing(s, isBottom){
    const cl = Math.max(0, Math.min(totalLen, s));
    let ox, oy, nx, ny;
    if (cl <= lead){
      ox = (W - pad - R - lead) + cl;
      oy = pad;
      nx = 0; ny = 1;
    } else if (cl <= lead + arcLen){
      const a = -Math.PI * 0.5 + ((cl - lead) / arcLen) * (Math.PI * 0.5);
      const cx = W - pad - R, cy = pad + R;
      ox = cx + R * Math.cos(a);
      oy = cy + R * Math.sin(a);
      nx = -Math.cos(a);
      ny = -Math.sin(a);
    } else {
      ox = W - pad;
      oy = pad + R + (cl - lead - arcLen);
      nx = -1; ny = 0;
    }
    const ix = ox + nx * T, iy = oy + ny * T;

    const mox = W - ox, mix = W - ix;
    return isBottom ? { ox: mox, oy: H - oy, ix: mix, iy: H - iy } : { ox: mox, oy, ix: mix, iy };
  }

  function makeWingPaths(isBottom){
    const out = [];
    for (let i = 0; i < segs; i++){
      const s0 = i * step;
      const s1 = Math.min(totalLen, s0 + step - gap);
      if (s1 <= s0 + 0.4) continue;
      const isCurved = s0 < (lead + arcLen);
      const nSub = isCurved ? 5 : 2;
      const outerPts = [], innerPts = [];
      for (let k = 0; k <= nSub; k++){
        const t = k / nSub;
        const pOut = sampleWing(s0 + (s1 - s0) * t, isBottom);
        const sIn0 = Math.max(0, s0 + slant * 0.45);
        const sIn1 = Math.min(totalLen, s1 + slant * 0.45);
        const pIn = sampleWing(sIn0 + (sIn1 - sIn0) * t, isBottom);
        outerPts.push(`${pOut.ox.toFixed(2)},${pOut.oy.toFixed(2)}`);
        innerPts.push(`${pIn.ix.toFixed(2)},${pIn.iy.toFixed(2)}`);
      }
      const pts = outerPts.concat(innerPts.reverse());
      out.push(`M${pts.join('L')}Z`);
    }
    return out;
  }

  const topPaths = makeWingPaths(false);
  const botPaths = makeWingPaths(true);
  const maxN = Math.max(topPaths.length, botPaths.length);
  let pathsHtml = '';
  let ord = 0;
  for (let i = 0; i < maxN; i++){
    if (topPaths[i]) pathsHtml += `<path d="${topPaths[i]}" data-ord="${ord++}"/>`;
    if (botPaths[i]) pathsHtml += `<path d="${botPaths[i]}" data-ord="${ord++}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${pathsHtml}</svg>`;
}

function clToastPaintSegs(el, pctRem){
  const segs = el.querySelectorAll('.cl-cd path');
  if (!segs.length) return;
  const total = segs.length;
  const used = Math.max(0, Math.min(100, 100 - pctRem));
  for (let i = 0; i < total; i++){
    const thresh = ((i + 1) / total) * 96;
    segs[i].classList.toggle('done', used >= thresh);
  }
}

function clToastSyncZ(){
  const box = $('#cl-toasts'); if (!box) return;
  const cards = Array.from(box.querySelectorAll('.cl-toast:not(.k-out)'));
  const total = cards.length;
  const frontCard = total ? cards[total - 1] : null;
  const frontH = frontCard ? (parseFloat(frontCard.style.getPropertyValue('--ch')) || frontCard.offsetHeight || 68) : 68;
  box.style.setProperty('--front-h', frontH + 'px');
  box.style.setProperty('--stack-pad', (Math.min(Math.max(0, total - 1), 3) * 10) + 'px');
  cards.forEach((c, idx) => {
    const depth = total - 1 - idx;
    c.style.setProperty('--depth', String(depth));
    c.style.zIndex = String(100 - depth);
    c.dataset.front = depth === 0 ? 'true' : 'false';
    if (depth >= 4) c.dataset.depthHidden = 'true';
    else delete c.dataset.depthHidden;
  });
}
function clToastMount(box, el){
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  const tk = el.querySelector('.cl-tk')?.textContent || '';
  const tf = el.querySelector('.cl-tf')?.textContent || '';
  el.setAttribute('aria-label', [tk, tf].filter(Boolean).join('. ') || 'Kabar baru');
  const chip = box.querySelector('.cl-tmore');
  if (chip) box.insertBefore(el, chip);
  else box.appendChild(el);
  const h = el.offsetHeight || 68;
  el.style.setProperty('--ch', h + 'px');
  const cd = el.querySelector('.cl-cd');
  if (cd) cd.innerHTML = buildClRailSvg(h);
  clToastOrder.push(el);
  clToastQ.set(el, { t: 0, iv: 0, left: CL_TTL, t0: 0, active: false, paused: false, barPct: 100 });
  clToastSyncZ();
  clToastPromote(el);
  clToastSyncMore();
}

function clToastPromote(el){
  const cur = clToastActiveEl;
  if (cur && cur !== el){
    const st = clToastQ.get(cur);
    if (st){
      clearTimeout(st.t); clearInterval(st.iv);
      st.t = 0; st.iv = 0;
      st.active = false; st.paused = false;
      st.left = CL_TTL; st.t0 = 0; st.barPct = 100;
      clToastPaintSegs(cur, 100);
    }
    clToastActiveEl = null;
  }
  clToastActivate();
}

function clToastActivate(){
  const el = [...clToastOrder].reverse().find(x => x.isConnected && !x.classList.contains('k-out'));
  for (const [k, s] of clToastQ){
    if (k !== el){
      clearTimeout(s.t); clearInterval(s.iv);
      s.t = 0; s.iv = 0; s.active = false; s.paused = false;
      s.left = CL_TTL; s.t0 = 0; s.barPct = 100;
      clToastPaintSegs(k, 100);
    }
  }
  if (!el){ clToastActiveEl = null; return; }
  if (clToastActiveEl === el){
    const curSt = clToastQ.get(el);
    if (curSt && curSt.active) return;
  }
  clToastActiveEl = el;
  const st = clToastQ.get(el); if (!st) return;
  st.left = CL_TTL; st.active = true; st.paused = false; st.t0 = Date.now(); st.barPct = 100;
  clToastBar(el, st.left, 100);
  st.t = setTimeout(() => clToastOut(el), st.left);
  const isFine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const shouldPause = (isFine && clToastsEl && clToastsEl.classList.contains('hov')) || (clToastsEl && clToastsEl.classList.contains('open'));
  if (shouldPause) clToastPause(el);
}
function clToastBar(el, ms, pct){
  const st = clToastQ.get(el);
  const startPct = pct == null ? 100 : pct;
  const dur = Math.max(ms, 50);
  clToastPaintSegs(el, startPct);
  if (!st) return;
  clearInterval(st.iv);
  const tStart = Date.now();
  st.barPct = startPct;
  st.iv = setInterval(() => {
    if (!el.isConnected){ clearInterval(st.iv); return; }
    const elapsed = Date.now() - tStart;
    const rem = Math.max(0, startPct * (1 - elapsed / dur));
    st.barPct = rem;
    clToastPaintSegs(el, rem);
    if (rem <= 0) clearInterval(st.iv);
  }, 70);
}
function clToastPause(el){
  const st = clToastQ.get(el); if (!st || !st.active || st.paused) return;
  clearTimeout(st.t); clearInterval(st.iv); st.paused = true;
  const elapsed = Date.now() - st.t0;
  const prevLeft = Math.max(50, st.left);
  st.barPct = Math.max(4, st.barPct * (1 - elapsed / prevLeft));
  st.left = Math.max(400, st.left - elapsed);
  clToastPaintSegs(el, st.barPct);
}
function clToastResume(el){
  const st = clToastQ.get(el); if (!st || !st.paused) return;
  st.paused = false; st.t0 = Date.now();
  clToastBar(el, st.left, st.barPct);
  st.t = setTimeout(() => clToastOut(el), st.left);
}
function clToastOut(el){
  const st = clToastQ.get(el);
  if (st){ clearTimeout(st.t); clearInterval(st.iv); }
  clToastQ.delete(el);
  const i = clToastOrder.indexOf(el); if (i >= 0) clToastOrder.splice(i, 1);
  if (clToastActiveEl === el) clToastActiveEl = null;
  if (el.isConnected) el.classList.add('k-out');
  clToastSyncZ();
  clToastSyncMore();
  clToastActivate();
  if (!el.isConnected) return;
  setTimeout(() => { el.remove(); clToastSyncMore(); clToastSyncZ(); }, 260);
}
function clToastSyncMore(){
  const box = $('#cl-toasts'); if (!box) return;
  const chip = box.querySelector('.cl-tmore');
  const n = box.querySelectorAll('.cl-toast:not(.k-out)').length;
  const mobile = matchMedia('(hover:none)').matches;
  const lim = mobile ? 1 : 6;
  if (n <= lim){ if (chip) chip.remove(); box.classList.remove('open'); return; }
  const c = chip || document.createElement('button');
  if (!chip){
    c.type = 'button'; c.className = 'cl-tmore';
    c.setAttribute('aria-live', 'off');
    box.appendChild(c);
  }
  c.setAttribute('aria-expanded', box.classList.contains('open') ? 'true' : 'false');
  c.textContent = box.classList.contains('open') ? 'tutup' : (mobile ? 'buka' : `+${n - 6}`);
}
const clToastsEl = $('#cl-toasts');
loadWireSeen();
if (clToastsEl){
  const isFine = () => matchMedia('(hover:hover) and (pointer:fine)').matches;
  clToastsEl.addEventListener('click', e => {
    if (e.target.closest('.cl-tmore')){
      clToastsEl.classList.toggle('open');
      const isOpen = clToastsEl.classList.contains('open');
      if (isOpen) {
        if (clToastActiveEl) clToastPause(clToastActiveEl);
      } else {
        if (clToastActiveEl) clToastResume(clToastActiveEl);
      }
      clToastSyncMore();
      return;
    }
    const isOpen = clToastsEl.classList.contains('open');
    if (isOpen) {
      const card = e.target.closest('.cl-toast');
      if (card) { card.blur(); clToastDismiss(card); }
    } else {
      const closeBtn = e.target.closest('.cl-x');
      if (closeBtn) {
        const c = closeBtn.closest('.cl-toast');
        if (c) { c.blur(); clToastDismiss(c); return; }
      }

      const frontCard = (clToastActiveEl && clToastActiveEl.isConnected && !clToastActiveEl.classList.contains('k-out'))
        ? clToastActiveEl
        : [...clToastOrder].reverse().find(x => x.isConnected && !x.classList.contains('k-out'))
        || e.target.closest('.cl-toast');
      if (frontCard) {
        if (!closeBtn && frontCard.dataset.la && frontCard.dataset.lo) {
          const cLa = parseFloat(frontCard.dataset.la), cLo = parseFloat(frontCard.dataset.lo);
          if (isFinite(cLa) && isFinite(cLo)) flyTo(cLa, cLo, 12, 'focus');
        }
        frontCard.blur();
        clToastDismiss(frontCard);
      }
    }
  });

  clToastsEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('.cl-tmore')) return;
    e.preventDefault();
    const frontCard = (clToastActiveEl && clToastActiveEl.isConnected && !clToastActiveEl.classList.contains('k-out'))
      ? clToastActiveEl
      : [...clToastOrder].reverse().find(x => x.isConnected && !x.classList.contains('k-out'))
      || e.target.closest('.cl-toast');
    if (frontCard) {
      if (frontCard.dataset.la && frontCard.dataset.lo) {
        const cLa = parseFloat(frontCard.dataset.la), cLo = parseFloat(frontCard.dataset.lo);
        if (isFinite(cLa) && isFinite(cLo)) flyTo(cLa, cLo, 12, 'focus');
      }
      frontCard.blur();
      clToastDismiss(frontCard);
    }
  });

  let clHovT = 0;
  const clHold = () => {
    if (!isFine()) return;
    clearTimeout(clHovT);
    clToastsEl.classList.add('hov');
    if (clToastActiveEl) clToastPause(clToastActiveEl);
  };
  const clRelease = () => {
    if (!isFine()) return;
    clHovT = setTimeout(() => {
      if (clToastsEl.matches(':hover') || clToastsEl.contains(document.activeElement)) return;
      clToastsEl.classList.remove('hov');
      clToastActivate();
      if (clToastActiveEl && !clToastsEl.classList.contains('open')) clToastResume(clToastActiveEl);
    }, 220);
  };
  clToastsEl.addEventListener('mouseenter', clHold);
  clToastsEl.addEventListener('mouseleave', clRelease);
  clToastsEl.addEventListener('focusin', () => { if (isFine()) clHold(); });
  clToastsEl.addEventListener('focusout', e => {
    if (isFine() && !clToastsEl.contains(e.relatedTarget)) clRelease();
  });

  clToastsEl.addEventListener('touchstart', e => {
    if (e.target.closest('.cl-tmore')) return;
    if (clToastActiveEl) clToastPause(clToastActiveEl);
  }, { passive: true });
  const clTouchEnd = () => {
    if (clToastActiveEl && !clToastsEl.classList.contains('open')) {
      clToastResume(clToastActiveEl);
    }
  };
  clToastsEl.addEventListener('touchend', clTouchEnd, { passive: true });
  clToastsEl.addEventListener('touchcancel', clTouchEnd, { passive: true });
}

function clToastDismiss(card){
  if (!card) return;
  clToastOut(card);
  clToastSyncMore();
  clToastSyncZ();
}
addEventListener('pagehide', () => {
  clToastQ.forEach(s => clearTimeout(s.t)); clToastQ.clear(); clToastOrder.length = 0; clToastActiveEl = null;
  const box = $('#cl-toasts'); if (box) box.innerHTML = '';
});

