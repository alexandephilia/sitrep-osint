function renderBrandCase(st){
  const g = {
    demo: st.demo || 0,
    insiden: (st.insiden || 0) + (st.fire || 0),
    bencana: (st.disaster || 0) + (st.flood || 0),
  };
  const total = g.demo + g.insiden + g.bencana;
  document.querySelectorAll('.bc-stat b[data-bc]').forEach(b => { b.textContent = g[b.dataset.bc]; });
  const mix = $('#bc-mix');
  if (mix) {
    mix.toggleAttribute('data-empty', !total);
    [g.demo, g.insiden, g.bencana].forEach((n, i) => { mix.children[i].style.flexGrow = total ? n : 1; });
  }
  const sum = $('#bc-sum');
  if (sum) sum.textContent = total + ' titik · 24j';
}
function renderSituation(){
  if (!SIT) return;
  const st = { ...(SIT.stats || {}) };
  st.gempa = (DIS_PULSE || []).filter(p => p.sub === 'gempa').length
    + (PULSE || []).filter(p => p.sub === 'gempa' && typeof p.la === 'number').length;
  st.gunung = (DIS_PULSE || []).filter(p => p.sub === 'volcano').length;
  st.flood = (st.flood || 0) + (DIS_PULSE || []).filter(p => p.kind === 'flood').length;
  const sitTotal = SIT.total || 0;
  const sitLocated = (typeof SIT.located === 'number' && isFinite(SIT.located)) ? SIT.located : 0;
  $('#sit-total').textContent = sitLocated > 0 ? sitLocated : sitTotal;
  const sitLbl = $('#sit-total-lbl');
  if (sitLbl) sitLbl.textContent = sitLocated > 0 ? `${sitTotal} berita · 24 jam` : '24 jam';
  renderMapLegend(st);
  renderBrandCase(st);
  $('#dmeta').textContent = (SIT.total || 0) + ' insiden';
  const syncBox = document.querySelector('.sit-kpi-sync');
  syncBox.dataset.state = SIT_STALE ? 'stale' : 'live';
  $('#sit-sync-state').textContent = SIT_STALE ? 'stale' : 'live';
  $('#sit-sync-time').textContent = (SIT.at ? wibTime(SIT.at) : '') + ' WIB';
  const groups = SIT ? buildClusters() : [];
  renderClusters(groups);
  updateDistress();
  renderAlerts();
  const rmax = Math.max(1, ...(SIT.regions || []).map(r => r.n));
  $('#sit-regions').innerHTML = (SIT.regions || []).map((r, i) => {
    const lit = Math.max(1, Math.min(10, Math.round((r.n / rmax) * 10)));
    const bars = Array.from({ length: 10 }, (_, k) => `<i${k < lit ? ' class="on"' : ''}></i>`).join('');
    return `<div class="sr"><span class="sr-i">${String(i + 1).padStart(2, '0')}</span><span class="sr-n">${esc(r.name)}</span>
      <span class="sr-t" aria-hidden="true">${bars}</span><b>${r.n}</b></div>`;
  }).join('') ||
    '<div class="empty">Belum ada wilayah terdeteksi.</div>';
  $('#src-health').innerHTML = (SIT.sources || []).map(s =>
    `<div class="sh ${s.ok ? 'ok' : 'bad'}"><i></i><span class="sh-id">${esc(s.id)}</span>
      <span class="sh-n">${s.ok ? s.n + ' item' : 'gagal'}</span><span class="sh-e">${esc(s.err || '')}</span></div>`).join('');
}
async function pullSituation(fresh){
  if (API == null) {
    SIT_STALE = true;
    renderSituation();
    if (!SIT) $('#cl-list').innerHTML = '<div class="empty">Butuh server untuk data live.</div>';
    return;
  }
  try {
    const d = await getJson(API + '/api/situation' + (fresh && SITREP_CAN_FRESH ? '?fresh=1' : ''), 30000);
    if (d && d.ok) {
      SIT = d; SIT_STALE = false;

      if (d.classifierVersion && SitrepSignals.adoptClassifierVersion) SitrepSignals.adoptClassifierVersion(d.classifierVersion);
      renderSituation();
    }
  } catch (e) {
    if (SIT) {
      SIT_STALE = true;
      renderSituation();
    } else {
      $('#cl-list').innerHTML = '<div class="empty">Agregat situasi gagal dimuat.</div>';
    }
  }
}
schedulePoll(() => pullSituation(), 60000, { dedupGlobalMs: 18000 });

const fmtIDR = (n, d = 0) => isFinite(n) ? n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
function drawSpark(cv, closes, up){
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const pts = Array.isArray(closes) ? closes.map(Number).filter(Number.isFinite) : [];
  if (pts.length < 2) return;
  const min = Math.min(...pts), max = Math.max(...pts), rg = max - min;
  const col = up ? '#42be65' : '#da1e28';
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = i / (pts.length - 1) * w;
    const y = rg > 0 ? (h - 2 - (v - min) / rg * (h - 6)) : (h / 2);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = col; ctx.lineWidth = 1.25; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (up) {
    grad.addColorStop(0, 'rgba(66,190,101,.02)');
    grad.addColorStop(1, 'rgba(66,190,101,.22)');
  } else {
    grad.addColorStop(0, 'rgba(218,30,40,.02)');
    grad.addColorStop(1, 'rgba(218,30,40,.22)');
  }
  ctx.fillStyle = grad; ctx.fill();
}
let STK = null, FX = null, IHSG = null, WORLD = [], MKT_AT = 0;
const STK_VIEW = [], FX_VIEW = [], CLOSES = {}, CLOSES_TRY_AT = {}, HERO_SYMS = ['IDX:COMPOSITE', 'FX_IDC:USDIDR'];
let closesInFlight = null, closesQueued = false;
function chipHtml(x){
  const up = x.pct >= 0;
  return `<div class="stk-chip">
    <div class="stk-top">
      <span class="n">${esc(x.name)}</span>
      <span class="p">${fmtIDR(x.price, x.price % 1 ? 2 : 0)}</span>
    </div>
    <div class="stk-sub">
      <span class="c ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(x.pct).toFixed(2)}%</span>
    </div>
    <canvas class="stk-spark-sm" width="134" height="26" data-sym="${esc(x.sym)}"></canvas>
  </div>`;
}
function paintSparks(el, items){
  if (!el) return;
  el.querySelectorAll('.stk-spark-sm').forEach(cv => {
    const it = items.find(x => x.sym === cv.dataset.sym);
    const cl = (it && Array.isArray(it.closes) && it.closes.length >= 2) ? it.closes : CLOSES[cv.dataset.sym];
    if (cl && cl.length >= 2) drawSpark(cv, cl, (it ? it.pct : 0) >= 0);
  });
}
function paintHeroes(){
  const cv1 = $('#stk-spark');
  if (cv1 && IHSG) {
    const rw = cv1.clientWidth || cv1.width || 180;
    if (rw && cv1.width !== rw) cv1.width = rw;
    const cl1 = (Array.isArray(IHSG.closes) && IHSG.closes.length >= 2) ? IHSG.closes : CLOSES['IDX:COMPOSITE'];
    drawSpark(cv1, cl1, IHSG.pct >= 0);
  }
  const cv2 = $('#fx-spark');
  const idr = FX && (FX.items || []).find(x => x.ticker === 'USDIDR');
  if (cv2 && idr) {
    const rw = cv2.clientWidth || cv2.width || 180;
    if (rw && cv2.width !== rw) cv2.width = rw;
    const cl2 = (Array.isArray(idr.closes) && idr.closes.length >= 2) ? idr.closes : CLOSES['FX_IDC:USDIDR'];
    drawSpark(cv2, cl2, idr.pct >= 0);
  }
}
function hasValidCloses(s){ return Array.isArray(CLOSES[s]) && CLOSES[s].length >= 2; }
async function loadCloses(){
  if (closesInFlight) { closesQueued = true; return closesInFlight; }
  closesInFlight = (async () => {
    const items = [...STK_VIEW, ...FX_VIEW];
    for (const it of items) {
      if ((!it.closes || it.closes.length < 2) && hasValidCloses(it.sym)) it.closes = CLOSES[it.sym];
    }
    const now = Date.now();
    const missing = [...new Set([...HERO_SYMS, ...items.filter(x => x.sym && (!x.closes || x.closes.length < 2)).map(x => x.sym)])]
      .filter(s => !hasValidCloses(s) && now - (CLOSES_TRY_AT[s] || 0) >= 30000)
      .slice(0, 60);
    if (missing.length && API != null) {
      for (const s of missing) CLOSES_TRY_AT[s] = now;
      try {
        const d = await getJson(API + '/api/closes?list=' + encodeURIComponent(missing.join(',')), 30000);
        if (d && d.closes) {
          for (const k in d.closes) {
            const arr = d.closes[k];
            if (Array.isArray(arr) && arr.length >= 2) {
              CLOSES[k] = arr;
              const it = items.find(x => x.sym === k);
              if (it) it.closes = arr;
            }
          }
        }
      } catch (e) {  }
    }
    paintSparks(document.getElementById('stk-chips'), STK_VIEW);
    paintSparks(document.getElementById('fx-chips'), FX_VIEW);
    paintHeroes();
  })().finally(() => {
    closesInFlight = null;
    if (closesQueued) { closesQueued = false; loadCloses(); }
  });
  return closesInFlight;
}
function drawChips(el, items, view){
  view.length = 0; view.push(...items);
  el.innerHTML = items.map(chipHtml).join('') || '<div class="empty">Data market belum tersedia.</div>';
  paintSparks(el, items);
}

function idxSession(){
  const w = new Date(Date.now() + (420 + new Date().getTimezoneOffset()) * 60000);
  const t = w.getHours() * 60 + w.getMinutes(), d = w.getDay();
  if (d === 0 || d === 6) return { k: 'closed', l: 'Libur Akhir Pekan', short: 'Libur Akhir Pekan', sub: '' };
  if (t < 525) return { k: 'pre', l: 'Pra-pasar · Buka 09:00 WIB', short: 'Pra-pasar', sub: ' · Buka 09:00 WIB' };
  if (t >= 525 && t < 540) return { k: 'pre', l: 'Pra-bursa (08:45–09:00)', short: 'Pra-bursa', sub: ' (08:45–09:00)' };
  if (t >= 540 && t < 720) return { k: 'open', l: 'Sesi I Live', short: 'Sesi I Live', sub: '' };
  if (t >= 720 && t < 810) return { k: 'break', l: 'Istirahat (Sesi II 13:30)', short: 'Istirahat', sub: ' (Sesi II 13:30)' };
  if (t >= 810 && t < 945) return { k: 'open', l: 'Sesi II Live', short: 'Sesi II Live', sub: '' };
  if (t >= 945 && t < 960) return { k: 'post', l: 'Pasca-bursa', short: 'Pasca-bursa', sub: '' };
  return { k: 'closed', l: 'Pasar Tutup · Buka Besok 09:00', short: 'Pasar Tutup', sub: ' · Buka Besok 09:00' };
}
function renderChips(){
  if (!STK) return;
  const all = (STK.items || []).slice().sort((a, b) => (b.vol || 0) - (a.vol || 0));
  const list = all.slice(0, 12);
  drawChips(document.getElementById('stk-chips'), list, STK_VIEW);

  const ses = idxSession();
  const mktAgeS = MKT_AT ? Math.max(0, Math.floor((Date.now() - MKT_AT) / 1000)) : -1;
  const syncTxt = document.hidden ? 'Sync: Paused'
    : mktAgeS < 0 ? 'Sync: Connecting'
    : mktAgeS < 60 ? (ses.k === 'closed' ? 'Sync: Settled' : 'Sync: Live')
    : mktAgeS < 300 ? `Sync: ${Math.floor(mktAgeS / 60)}m`
    : 'Sync: Paused';
  const subHtml = ses.sub ? `<span class="mkt-pill-sub">${ses.sub}</span>` : '';
  $('#stk-meta').innerHTML = `<span class="mkt-pill ${ses.k}"><i></i><span class="mkt-pill-t">${ses.short}</span>${subHtml}</span>` +
    `<span class="stk-meta-x">${all.length} emiten · ${syncTxt}</span>`;
}
function renderFx(){
  if (!FX) return;
  const items = FX.items || [];
  const idr = items.find(x => x.ticker === 'USDIDR') || items[0];
  $('#fx-idr').textContent = idr ? fmtIDR(idr.price, idr.price % 1 ? 2 : 0) : '—';
  const dEl = $('#fx-idr-d');
  if (idr) {
    const up = idr.pct >= 0;
    dEl.textContent = (up ? '▲ +' : '▼ ') + fmtIDR(Math.abs(idr.chg), 2) + ' · ' + Math.abs(idr.pct).toFixed(2) + '%';
    dEl.className = 'stk-d ' + (up ? 'up' : 'dn');
  } else { dEl.textContent = '—'; dEl.className = 'stk-d'; }
  drawChips(document.getElementById('fx-chips'), items.filter(x => x !== idr), FX_VIEW);
}
function renderStocks(d){
  STK = d.stocks || null;
  FX = d.forex || null;
  WORLD = d.world || [];
  IHSG = d.ihsg || null;
  MKT_AT = d.at || Date.now();
  if (IHSG && Array.isArray(IHSG.closes) && IHSG.closes.length >= 2) {
    CLOSES['IDX:COMPOSITE'] = IHSG.closes;
  }
  for (const it of [...((STK && STK.items) || []), ...((FX && FX.items) || [])]) {
    if (it && it.sym && Array.isArray(it.closes) && it.closes.length >= 2) CLOSES[it.sym] = it.closes;
  }
  if (IHSG) {
    $('#stk-ihsg').textContent = fmtIDR(IHSG.price);
    const dEl = $('#stk-ihsg-d');
    const up = IHSG.pct >= 0;
    dEl.textContent = (up ? '▲ +' : '▼ ') + fmtIDR(Math.abs(IHSG.chg)) + ' · ' + Math.abs(IHSG.pct).toFixed(2) + '%';
    dEl.className = 'stk-d ' + (up ? 'up' : 'dn');
  } else { $('#stk-ihsg').textContent = '—'; $('#stk-ihsg-d').textContent = '—'; }
  renderChips();
  renderFx();
  paintHeroes();
  loadCloses();
  initTvTape();
}
window.addEventListener('resize', () => { if (IHSG || FX) requestAnimationFrame(paintHeroes); });
async function initTvTape(){
  const all = [...WORLD];
  if (!all.length) return;
  try {
    const d = await getJson(API + '/api/closes?list=' + encodeURIComponent(all.map(x => x.sym).join(',')), 30000);
    if (d && d.closes) all.forEach(x => { if (!x.closes || x.closes.length < 2) x.closes = d.closes[x.sym]; });
  } catch (e) {}
  const item = x => {
    const up = x.pct >= 0;
    return `<span class="ti"><span class="n">${esc(x.ticker || x.name)}</span>` +
      `<span class="ti-hd"><span class="p">${fmtIDR(x.price, x.price % 1 ? 2 : 0)}</span>` +
      `<span class="c ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(x.pct).toFixed(2)}%</span></span>` +
      `<canvas width="80" height="46"></canvas></span>`;
  };
  const html = all.map(item).join('');
  const track = document.getElementById('tapetrack');
  track.innerHTML = html + html;
  track.querySelectorAll('canvas').forEach((cv, i) => {
    const it = all[i % all.length];
    if (it && it.closes && it.closes.length > 1) drawSpark(cv, it.closes, it.pct >= 0);
  });
  const tape = document.getElementById('tape');
  requestAnimationFrame(() => tape.style.setProperty('--td', Math.max(40, track.scrollWidth / 2 / 60) + 's'));
  tape.hidden = false;
}
async function pullStocks(){
  if (API == null) { $('#stk-meta').textContent = 'butuh server'; return; }
  try {
    const d = await getJson(API + '/api/market', 30000);
    if (d && (d.stocks || d.items)) renderStocks(d.stocks ? d : { stocks: d });
  } catch (e) { $('#stk-meta').textContent = 'market feed error'; }
}

schedulePoll(() => pullStocks(), 20000, { dedupGlobalMs: 8000 });

let sigCache = null;
function updateDistress(){
  const bucket = Math.floor(Date.now() / 60000);
  const v = SitrepSignals.VERSION;
  if (sigCache && sigCache.xp === xPosts && sigCache.tp === tPosts &&
      sigCache.xc === xSignalCurrent && sigCache.tc === tSignalCurrent &&
      sigCache.v === v && sigCache.bucket === bucket) {
    SIG_GROUPS = sigCache.groups;
  } else {
    SIG_GROUPS = SitrepSignals.buildGroups(socialPool(), Date.now()).slice(0, 8);
    sigCache = { xp: xPosts, tp: tPosts, xc: xSignalCurrent, tc: tSignalCurrent, v, bucket, groups: SIG_GROUPS };
  }
  renderAlerts();
}

const SEV_RANK = { kritis: 0, waspada: 1, info: 2 };
const SEV_LABEL = { kritis: 'Kritis', waspada: 'Waspada', info: 'Info' };
const unent = v => { const t = document.createElement('textarea'); t.innerHTML = String(v == null ? '' : v); return t.value; };
const SEV_ICON = { kritis: '▲', waspada: '●', info: '○' };
function socLine(p){
  const who = p.from + (p.handle ? ' · ' + p.handle : '');
  const tx = esc(deEmoji(String(p.text || '').replace(/^@\w+\s*/, ''))).slice(0, 150);
  const inner = p.url ? `<a href="${escUrl(p.url)}" target="_blank" rel="noopener">${tx}</a>` : tx;
  return `<div class="cl-line"><time>${esc(p.ts ? wibTime(p.ts) : '')}</time><span>${inner}<span class="cl-s">${ic(p.from === 'X' ? 'x' : 'threads')} ${esc(who)}</span></span></div>`;
}
function newsLine(x){
  return `<div class="cl-line"><time>${esc(x.ts ? wibTime(x.ts) : '')}</time>
    <span><a href="${escUrl(x.url)}" target="_blank" rel="noopener">${esc(deEmoji(x.title))}</a><span class="cl-s">${ic('news')} ${esc(cleanSrc(x.src, x.pub))}</span></span></div>`;
}

let xSignalCurrent = false, tSignalCurrent = false;
function assessmentLabel(p){
  const a = p.assessment;
  if (!a || a.version !== SitrepSignals.VERSION) return 'Klasifikasi lama';
  if (!a.signalEligible && a.findings && a.findings.length && a.findings.every(f => f.feedOnly)) {
    const topics = [...new Set(a.findings.map(f => f.topic))]
      .map(t => t.replace(/(^|\s)(\S)/g, (m, x, y) => x + y.toUpperCase())).join(', ');
    const scopeTxt = a.scope === 'Indonesia' ? ' · Indonesia' : a.scope === 'foreign' ? ' · Luar Indonesia' : '';
    return topics + scopeTxt;
  }
  const lane = a.classification && a.classification.feedLane || a.feedLane;
  const intent = a.classification && a.classification.intent || a.intent;
  const locName = a.geographicContext && a.geographicContext.role === 'event_location' && a.geographicContext.name;
  const scopeTxt = locName ? ' · ' + locName : (a.scope === 'Indonesia' ? ' · Indonesia' : a.scope === 'foreign' ? ' · Luar Indonesia' : '');
  if (lane === 'incident_signals') {
    const sigKind = { official_warning:'Peringatan Resmi', eyewitness_report:'Laporan Saksi', official_update:'Pembaruan Resmi', incident_report:'Sinyal Insiden' };
    return (sigKind[intent] || 'Sinyal Insiden') + scopeTxt;
  }
  if (lane === 'situational_context') {
    const ctxKind = { question:'Pertanyaan Situasi', rumor:'Rumor / Belum Terverifikasi', satire:'Komentar / Satir', personal_experience:'Konteks Warga', discussion:'Diskusi Lokal', eyewitness_report:'Kondisi Lokal' };
    return (ctxKind[intent] || 'Konteks Situasi') + scopeTxt;
  }
  const kind = { reported:'Laporan belum terverifikasi', warning:'Peringatan belum terverifikasi', denied:'Penyangkalan', educational:'Edukasi', response:'Respons/pemulihan', historical:'Historis', commentary:'Komentar', unverified_question:'Pertanyaan/rumor', irrelevant:'Tidak relevan' };
  return (kind[a.reportType] || 'Kandidat topik') + scopeTxt;
}
function socialPool(){
  const posts = [];
  if (xSignalCurrent) for (const p of xPosts) posts.push({ ...p, from:'X', handle:p.handle || '' });
  if (tSignalCurrent) for (const p of tPosts) posts.push({ ...p, from:'Threads', handle:p.username ? '@' + p.username : '' });
  return posts;
}
function acceptSocialSnapshot(kind, payload){
  const map = kind === 'x' ? xAll : tAll, prev = new Set(map.keys());
  const r = SitrepSignals.reconcile(map, payload, { now:Date.now(), max:kind === 'x' ? 1600 : 900,
    keyOf:p => kind === 'x' ? p.url || p.text : p.code || p.url || p.text });
  if (!r.accepted && payload?.snapshotAt < map._snapshotAt) return false;
  if (kind === 'x') {
    xSignalCurrent = r.accepted;
    if (r.accepted) { xPosts = r.posts; xFresh = new Set([...map.keys()].filter(k => !prev.has(k))); }
  } else {
    tSignalCurrent = r.accepted;
    if (r.accepted) { tPosts = r.posts; tAt = payload.at || Date.now(); }
  }
  updateDistress();
  return r.accepted;
}
function relatedSocial(group, n){
  const all = SitrepSignals.related(group, socialPool(), Date.now(), 300);
  return { items:all.slice(0, n), total:all.length };
}
const alertTabState = new Map();
function lanesHtml(socRes, newsItems, newsTotal, cardId){
  const hasSoc = !!(socRes && socRes.items && socRes.items.length);
  const hasNews = !!(newsItems && newsItems.length);
  if (!hasSoc && !hasNews) return '';
  const both = hasSoc && hasNews;
  const savedTab = cardId && alertTabState.get(cardId);
  const activeTab = both ? (savedTab === 'news' ? 'news' : 'soc') : (hasSoc ? 'soc' : 'news');
  const nTotal = newsTotal || (newsItems ? newsItems.length : 0);
  const tabsHtml = both
    ? `<div class="tr-tabs" role="tablist">
        <button type="button" class="tr-tab soc${activeTab === 'soc' ? ' active' : ''}" data-lane="soc" data-card="${esc(cardId || '')}" role="tab" aria-selected="${activeTab === 'soc'}">
          <span>${ic('radar')} Sosial · X / Threads</span><b>${socRes.total}</b>
        </button>
        <button type="button" class="tr-tab news${activeTab === 'news' ? ' active' : ''}" data-lane="news" data-card="${esc(cardId || '')}" role="tab" aria-selected="${activeTab === 'news'}">
          <span>${ic('news')} Berita · Media</span><b>${nTotal}</b>
        </button>
      </div>`
    : `<div class="tr-tabs solo">
        <div class="tr-tab ${hasSoc ? 'soc' : 'news'} active">
          <span>${ic(hasSoc ? 'radar' : 'news')} ${hasSoc ? 'Sosial · X / Threads' : 'Berita · Media'}</span><b>${hasSoc ? socRes.total : nTotal}</b>
        </div>
      </div>`;
  const socPanel = hasSoc
    ? `<div class="tr-lane soc" data-lane-panel="soc"${activeTab === 'soc' ? '' : ' hidden'}>${socRes.items.map(socLine).join('')}</div>` : '';
  const newsPanel = hasNews
    ? `<div class="tr-lane news" data-lane-panel="news"${activeTab === 'news' ? '' : ' hidden'}>${newsItems.map(newsLine).join('')}</div>` : '';
  return `<div class="tr-body">${tabsHtml}<div class="tr-lanes">${socPanel}${newsPanel}</div></div>`;
}
function relatedNews(group, n){
  return SitrepSignals.related(group, (SIT?.items || []), Date.now(), n);
}

function correlateCards(socGroups, newsGroups){
  const now = Date.now(), cand = [], usedS = new Set(), usedN = new Set();
  for (const g of socGroups) for (const c of newsGroups) {
    if (!g.latest || !c.latest || Math.abs(g.latest - c.latest) > 3 * 3600e3) continue;
    let best = null;
    for (const ge of (g.events || [])) for (const ne of (c.events || [])) {
      const r = SitrepSignals.relation(ge, ne);
      if (r === 'strong') { best = 'strong'; break; }
      if (r === 'weak' && best !== 'strong') best = 'weak';
    }
    if (best) cand.push({ g, c, rel: best });
  }
  cand.sort((a, b) => (a.rel === b.rel ? 0 : a.rel === 'strong' ? -1 : 1));
  const pairs = [];
  for (const p of cand) {
    if (usedS.has(p.g) || usedN.has(p.c)) continue;
    usedS.add(p.g); usedN.add(p.c); pairs.push(p);
  }
  return { pairs, socLeft: socGroups.filter(g => !usedS.has(g)), newsLeft: newsGroups.filter(c => !usedN.has(c)) };
}

let alertCache = null;
function alertCards(){
  const bucket = Math.floor(Date.now() / 60000);
  const v = SitrepSignals.VERSION;
  if (alertCache && alertCache.xp === xPosts && alertCache.tp === tPosts &&
      alertCache.xc === xSignalCurrent && alertCache.tc === tSignalCurrent &&
      alertCache.v === v && alertCache.bucket === bucket &&
      alertCache.sit === SIT && alertCache.sg === SIG_GROUPS) {
    return alertCache.cards;
  }
  const cards = [];
  const socGroups = SIG_GROUPS;
  const newsGroups = SIT ? buildClusters().filter(g => g.latest && g.latest <= Date.now() && Date.now() - g.latest <= 90 * 60e3).slice(0, 6) : [];
  const { pairs, socLeft, newsLeft } = correlateCards(socGroups, newsGroups);
  for (const p of pairs) {
    const g = p.g, c = p.c, k = c.items.length, s = c.sources.size;
    const sev = (g.severity === 'critical' || c.events.some(e => e.severity === 'critical')) ? 'kritis'
      : (g.severity === 'warning' || c.events.some(e => e.severity === 'warning')) ? 'waspada' : 'info';
    const socRes = { items: g.posts.slice(0, 6), total: g.posts.length };
    const id = 'x' + c.id;
    cards.push({ id, sev, cat: c.cat, place: c.place || g.place || 'Wilayah belum pasti', n: g.n + k,
      score: g.accounts * 2 + s * 2 + k, latest: Math.max(g.latest || 0, c.latest || 0),
      title: deEmoji(c.items[0].title),
      meta: g.n + ' post · ' + g.accounts + ' akun · ' + s + ' media · ' + g.from,
      socMeta: g.n + ' post · ' + g.accounts + ' akun',
      newsMeta: k + ' kabar · ' + s + ' media',
      socRes, newsItems: c.items.slice(0, 6), newsTotal: k,
      rel: p.rel === 'strong' ? 'dikonfirmasi' : 'kemungkinan terkait',
      note: p.rel === 'strong' ? 'Event yang sama dikonfirmasi media dan sosial' : 'Kecocokan parsial — evidence belum cukup untuk konfirmasi',
      body: lanesHtml(socRes, c.items.slice(0, 6), k, id) });
  }
  for (const g of socLeft) {
    const sev = g.severity === 'critical' ? 'kritis' : g.severity === 'warning' ? 'waspada' : 'info';
    const sample = String(g.sample || '').replace(/^@\w+\s*/, '');
    const socRes = { items: g.posts.slice(0, 6), total: g.posts.length };
    const rel = relatedNews(g, 6);
    const id = 'd:' + g.cat + ':' + g.id;
    cards.push({ id, sev, cat: g.cat, place: g.place || 'Scope belum pasti', n: g.n,
      score: g.accounts, latest: g.latest, title: sample,
      meta: g.n + ' post · ' + g.accounts + ' akun · ' + g.from,
      socMeta: g.n + ' post · ' + g.accounts + ' akun',
      newsMeta: rel.length ? rel.length + ' kabar' : '',
      socRes, newsItems: rel, newsTotal: rel.length,
      note: 'Laporan belum terverifikasi · dampak belum diketahui',
      body: lanesHtml(socRes, rel, rel.length, id) });
  }
  if (SIT) {
    for (const g of newsLeft) {
      const k = g.items.length, s = g.sources.size;
      const score = s * 2 + k;
      const sev = g.events.some(e => e.severity === 'critical') ? 'kritis'
        : g.events.some(e => e.severity === 'warning') ? 'waspada' : 'info';
      const lead = g.items[0];
      const socRes = relatedSocial(g, 6);
      const id = 'c' + g.id;
      cards.push({ id, sev, cat: g.cat, place: g.place || 'Wilayah belum pasti', n: k,
        score, latest: g.latest || 0, title: lead.title, meta: k + ' kabar · ' + s + ' feed',
        socMeta: socRes.total ? socRes.total + ' post' : '',
        newsMeta: k + ' kabar · ' + s + ' feed',
        socRes, newsItems: g.items.slice(0, 6), newsTotal: g.items.length,
        body: lanesHtml(socRes, g.items.slice(0, 6), g.items.length, id) });
    }
    const failedSrc = (SIT.sources || []).filter(s => !s.ok);
    if (failedSrc.length) {
      const names = failedSrc.map(s => s.id).join(', ');
      const errs = failedSrc.map(s => s.err).filter(Boolean).slice(0, 3).join(' · ');
      const latestFail = Math.max(0, ...failedSrc.map(s => s.at || 0));
      cards.push({ id: 'srcfail', sev: 'waspada', cat: 'insiden', place: 'Sumber', n: 0,
        score: 1, latest: latestFail || (SIT.at || 0), title: failedSrc.length + ' sumber gagal diambil', meta: 'feed error · retry otomatis',
        body: `<div class="tr-body"><div class="tr-sample">${esc(names)}${errs ? '<br>' + esc(errs) : ''}</div>
          <button class="tr-more" type="button" data-retry="sit" style="margin:0 10px 8px">Coba lagi</button></div>` });
    }
  }
  cards.sort((a, b) => (SEV_RANK[a.sev] - SEV_RANK[b.sev]) || (b.score - a.score) || (b.latest - a.latest));
  const out = cards.slice(0, 8);
  alertCache = { xp: xPosts, tp: tPosts, xc: xSignalCurrent, tc: tSignalCurrent, v, bucket, sit: SIT, sg: SIG_GROUPS, cards: out };
  return out;
}
function alertHtml(c){
  const open = openAlert === c.id;
  const time = c.latest ? wibTime(c.latest) : '';
  const bodyHtml = (c.socRes || c.newsItems) ? lanesHtml(c.socRes, c.newsItems, c.newsTotal, c.id) : (c.body || '');
  const expandable = !!bodyHtml;
  const title = deEmoji(unent(c.title)).replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').replace(/(?:\s*>+)+\s*$/, '…').trim();
  const pillsHtml = (c.socMeta || c.newsMeta)
    ? `<div class="tr-pills">${c.socMeta ? `<span class="tr-pill soc"${c.note ? ` title="${esc(c.note)}"` : ''}>SOSIAL: ${esc(c.socMeta)}</span>` : ''}${c.newsMeta ? `<span class="tr-pill news"${c.note ? ` title="${esc(c.note)}"` : ''}>BERITA: ${esc(c.newsMeta)}</span>` : ''}</div>`
    : `<div class="tr-pills"><span class="tr-pill">${esc(c.meta)}</span></div>`;
  return `<div class="tr${open ? ' is-open' : ''}" data-sev="${c.sev}">
    <div class="tr-m">
      <div class="tr-hd">
        <svg class="ic tr-ic ${esc(c.cat)}" aria-hidden="true"><use href="${TK_SIG[c.cat] || '#i-pin'}"></use></svg>
        <span class="tr-sev-cat ${esc(c.cat)}">${SEV_LABEL[c.sev]} · ${esc(CAT_LABEL[c.cat] || c.cat)}</span>
        <span class="tr-loc-tag">${esc(c.place)}</span>
        ${c.rel ? `<span class="tr-rel ${c.rel === 'dikonfirmasi' ? 'ok' : 'maybe'}" title="${esc(c.note || '')}">${esc(c.rel)}</span>` : ''}
        ${time ? `<time class="tr-time">${esc(time)}</time>` : ''}
      </div>
      <div class="tr-t">${esc(title)}</div>
      <div class="tr-f">
        ${pillsHtml}
        ${expandable ? `<button class="tr-more" type="button" data-toggle="${esc(c.id)}" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Tutup' : 'Detail'}</button>` : ''}
      </div>
      ${open && expandable ? bodyHtml : ''}
    </div>
  </div>`;
}
function renderAlerts(){
  const el = $('#triage'); if (!el) return;
  const cards = alertCards();
  el.innerHTML = cards.length ? cards.map(alertHtml).join('') :
    `<div class="tr" data-sev="info"><div class="tr-m">
      <div class="tr-hd"><svg class="ic tr-ic insiden" aria-hidden="true"><use href="#i-pin"></use></svg><span class="tr-sev-cat">Normal · Situasi</span><span class="tr-loc-tag">Nasional</span></div>
      <div class="tr-f"><span class="tr-pill">Tidak ada alert aktif</span></div></div></div>`;
}
$('#triage').addEventListener('click', e => {
  const r = e.target.closest('[data-retry]');
  if (r) { if (r.dataset.retry === 'sit') pullSituation(); return; }
  const tab = e.target.closest('[data-lane]');
  if (tab) {
    const cardId = tab.dataset.card;
    const lane = tab.dataset.lane;
    if (cardId && lane) {
      alertTabState.set(cardId, lane);
      renderAlerts();
    }
    return;
  }
  const b = e.target.closest('[data-toggle]'); if (!b) return;
  const id = b.dataset.toggle;
  openAlert = openAlert === id ? '' : id;
  renderAlerts();
});

{
  const segH = $('#seg-h'), segW = $('#segwrap');
  const setSeg = open => { segW.classList.toggle('closed', !open); segH.setAttribute('aria-expanded', String(open)); };
  segH.addEventListener('click', () => setSeg(segW.classList.contains('closed')));
  segH.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSeg(segW.classList.contains('closed')); }
  });
}
$('#dseg').addEventListener('click', e => {
  const b = e.target.closest('.seg-b'); if (!b) return;
  $$('#dseg .seg-b').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
  $('#view-claims').hidden = b.dataset.view !== 'claims';
  $('#view-krono').hidden  = b.dataset.view !== 'krono';
  $('#view-net').hidden    = b.dataset.view !== 'net';
});

