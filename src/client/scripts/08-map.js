const KIND_COLOR = { ...CAT_COLOR, node:'#525252' };
const KIND_LABEL = { demo:'Demo', fire:'Kebakaran', flood:'Banjir', disaster:'Bencana', insiden:'Insiden', node:'Node tetap' };
const TT_CAT_LABEL = { 0:'Insiden', 1:'Kecelakaan', 2:'Kabut', 3:'Kondisi Berbahaya', 4:'Hujan', 5:'Es', 6:'Kemacetan', 7:'Jalur Ditutup', 8:'Jalan Ditutup', 9:'Perbaikan Jalan', 10:'Angin Kencang', 11:'Banjir', 14:'Kendaraan Mogok' };

const ttCatCol = c => [1, 7, 8].includes(c) ? '#da1e28' : [6, 10, 11, 14].includes(c) ? '#f1c21b' : '#8d8d8d';

const ttSevCol = inc => [7, 8].includes(inc.iconCategory) ? '#da1e28'
  : inc.magnitude == null ? ttCatCol(inc.iconCategory)
  : inc.magnitude >= 5 ? '#da1e28' : inc.magnitude >= 3 ? '#f1c21b' : '#8d8d8d';
const TT_ICON = { 1:'i-tt-crash', 2:'i-tt-fog', 3:'i-tt-alert', 4:'i-tt-rain', 5:'i-tt-ice',
  6:'i-tt-jam', 7:'i-tt-closed', 8:'i-tt-closed', 9:'i-tt-cone', 10:'i-tt-wind', 11:'i-tt-flood', 14:'i-tt-broken' };
const ttGlyph = (c, px) => `<svg class="ic"${px ? ` style="width:${px}px;height:${px}px"` : ''}><use href="#${TT_ICON[c] || 'i-tt-alert'}"/></svg>`;
const ttIcon = (inc, sz = 20) => L.divIcon({ className: 'mk-tt-ic', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  html: `<div class="mk-tt" style="--tc:${ttSevCol(inc)}">${ttGlyph(inc.iconCategory)}</div>` });

const ttPtSize = () => { const s = Math.pow(1.3, (map ? map.getZoom() : 10) - 10); return Math.max(22, Math.min(48, Math.round(26 * s))); };
const ttLnSize = () => { const s = Math.pow(1.3, (map ? map.getZoom() : 10) - 10); return Math.max(17, Math.min(36, Math.round(20 * s))); };
let map = null, heat = null, pinLayer = null, regLabelLayer = null, camLayer = null, mapReady = false, mapOpen = false, mapBusy = false, mapData = [], esriRefLayer = null, esriDarkBaseLayer = null, esriSatBaseLayer = null;
let ttFlowLayer = null, ttIncTileLayer = null, ttIncDataLayer = null, routeLayer = null, measureLayer = null;
let flightLayer = null, shipLayer = null, transitLayer = null;
let gempaLayer = null, gunungLayer = null, tmaLayer = null, wxLayer = null, radarLayer = null, radarBmkgLayer = null, peringatanLayer = null, warnRenderer = null;
let warnAlerts = [], warnPopup = null, warnHandlersBound = false, lastPopAt = 0;
let satIrLayer = null, satNcLayer = null, satWvLayer = null, satRainLayer = null, sentinel2Layer = null, airLayer = null;
let radarFrames = [], radarIndex = 0, radarPlaying = false, radarTimer = null, radarGenerated = 0, radarHost = 'https://tilecache.rainviewer.com';
let radarLayerCache = {}, radarPendingLayer = null, radarSwapTimer = null, radarWasPlaying = false;
let ttOk = false, ttIncBusy = false, ttIncInterval = 0, s2Ok = false, s2StatusText = '', s2FlashUntil = 0;
let routeMode = false, routeA = null, routeB = null, flowMode = false, flowProbe = null, flowBusy = false;
const layerOn = { heat:true, pins:true, cams:true, tma:true, ttflow:false, ttinc:false, ttdata:false, rute:false, lalin:false, flight:false, ship:false, transit:false, gempa:true, gunung:true, cuaca:false, wind:true, radar:false, radarbmkg:false, peringatan:true, 'sat-ir':false, 'sat-nc':false, 'sat-wv':false, 'sat-rain':false, fires:true, air:true, 'basemap-sat':true, sentinel2:false };

const ttTileUrl = kind => tokQ((API != null ? API : '') + '/tomtom/tile/' + kind + '/{z}/{x}/{y}.png');
const s2TileUrl = () => tokQ((API != null ? API : '') + '/api/copernicus/tile/{z}/{x}/{y}.png');
const havKm = (a, b) => {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fmtKm = km => km < 10 ? km.toFixed(2) + ' km' : km.toFixed(1) + ' km';
const fmtDur = sec => { if (sec == null) return '—'; const m = Math.round(sec / 60); return m < 60 ? m + ' mnt' : Math.floor(m / 60) + ' jam ' + (m % 60) + ' mnt'; };

function mapPopup(it){
  const kc = CAT_COLOR[it.kind] || KIND_COLOR[it.kind] || '';
  const dsc = cleanDesc(it.desc);
  return `<div class="mp-k"${kc ? ` style="color:${kc}"` : ''}>${esc(it.label || KIND_LABEL[it.kind] || 'Insiden')} · ${esc(it.name)}</div>
    <div class="mp-t">${esc(cleanTitle(deEmoji(it.title || ''), it.pub || it.src))}</div>
    ${dsc ? `<div class="mp-desc">${esc(deEmoji(dsc))}</div>` : ''}
    <div class="mp-m">${esc(cleanSrc(it.src, it.pub))} · ${esc(wibFull(it.ts))} WIB${precTxt(it) ? '<br>' + esc(precTxt(it)) : ''}</div>
    ${it.url ? `<button type="button" class="mp-src mp-read" data-read="${esc(it.url)}">Baca${ic('out')}</button>` : ''}`;
}
function camPopup(c){
  const isWater = /^pantau\s+banjir/i.test(c.c) || /Kali|Pintu Air|Bendungan|Drain/i.test(c.n);
  const tag = isWater ? '<span style="color:#00e5ff;font-weight:700">PANTAU BANJIR & KALI</span> · ' : '';
  return `<div class="mp-k"${isWater ? ' style="color:#00e5ff"' : ''}>${tag}CCTV · ${esc(c.c || 'Kota Jakarta')}</div>
    <div class="mp-t">${esc(deEmoji(c.n))}</div>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button type="button" class="mp-src" style="cursor:pointer" data-cam-open="${esc(c.s)}">Tonton CCTV${ic('out')}</button>
      ${c.e ? `<a class="mp-src" href="${escUrl(c.e)}" target="_blank" rel="noopener">Player Luar${ic('out')}</a>` : ''}
    </div>`;
}
function ttIncPopup(inc){
  const col = ttSevCol(inc);
  const isClosed = [7, 8].includes(inc.iconCategory) || /ditutup|terputus|tertutup|blokade/i.test(String(inc.desc || ''));
  const catLabel = TT_CAT_LABEL[inc.iconCategory] || 'Insiden';
  const tagTxt = isClosed ? 'TUTUP TOTAL' : (inc.magnitude >= 4 ? 'PADAT MERAYAP' : (inc.magnitude >= 2 ? 'WASPADAI ARUS' : 'LANCAR'));
  const tagStyle = isClosed ? 'background:rgba(255,59,48,.15);border:1px solid rgba(255,59,48,.45);color:#ff3b30' : 'background:rgba(241,194,27,.12);border:1px solid rgba(241,194,27,.35);color:#f1c21b';

  const ch1Lbl = isClosed ? 'STATUS AKSES' : 'DELAY ESTIMASI';
  const ch1Val = isClosed ? 'BLOCKED' : (inc.delay != null ? '+' + Math.round(inc.delay / 60) + ' <span>MNT</span>' : 'LANCAR');
  const ch1Sub = isClosed ? 'TUTUP DUA ARAH' : (inc.magnitude != null ? 'TINGKAT ' + inc.magnitude + ' / 6' : 'ARUS LAMBAT');
  const ch1Col = isClosed ? '#ff3b30' : col || '#f1c21b';

  const lenKm = inc.length ? (inc.length / 1000).toFixed(1) + ' <span>KM</span>' : (isClosed ? 'TERPUTUS' : 'LOKAL');
  const ch2Lbl = isClosed ? 'JARAK BLOKADE' : 'PANJANG ANTREAN';
  const ch2Sub = isClosed ? 'AKSES DITUTUP' : (inc.length ? 'KORIDOR PADAT' : 'TITIK INSIDEN');
  const ch2Col = isClosed ? '#ff9f0a' : '#00e5ff';

  const repCount = inc.reports ? num(inc.reports) + ' LAPORAN' : 'LAPORAN SISTEM';
  const repTime = inc.lastReport ? 'TERAKHIR ' + wibTime(inc.lastReport) + ' WIB' : 'TERVERIFIKASI AKTIF';

  const hasRuas = inc.from || inc.to;
  const fromNode = inc.from || 'Titik Awal';
  const toNode = inc.to || 'Titik Tujuan';
  const corridorHtml = hasRuas ? `
    <div class="tt-corridor">
      <div class="tt-corridor-head">
        <span>${isClosed ? 'RUAS DITUTUP' : 'VEKTOR RUAS JALAN'}</span>
        <span>${isClosed ? 'AKSES TERPUTUS' : (inc.length ? (inc.length / 1000).toFixed(1) + ' KM' : 'JALUR')}</span>
      </div>
      <div class="tt-vector${isClosed ? ' tt-vector-closed' : ''}">
        <span class="tt-node">${esc(fromNode)}</span>
        <span class="tt-arrow">${isClosed ? '━ [DITUTUP TOTAL] ━▶' : `━━━ (${inc.length ? (inc.length / 1000).toFixed(1) + ' km' : 'arah'}) ━━▶`}</span>
        <span class="tt-node">${esc(toNode)}</span>
      </div>
    </div>` : '';

  const descHtml = inc.desc ? `<div class="tt-desc-box">${esc(deEmoji(inc.desc))}</div>` : '';

  const berlaku = inc.endTime ? 'BERLAKU S.D. ' + wibTime(inc.endTime) + ' WIB' : (inc.startTime ? 'SEJAK ' + wibTime(inc.startTime) + ' WIB' : 'STATUS AKTIF');
  const probTxt = inc.probability ? esc(inc.probability.toUpperCase()) : 'CERTAIN';

  return `<div class="tt-corr-card">
    <div class="tt-head">
      <span class="tt-brand" style="color:${ch1Col}">
        <span class="mp-pulse-dot" style="color:${ch1Col}"></span>
        ${ttGlyph(inc.iconCategory, 11)} ${esc(catLabel)} · TOMTOM
      </span>
      <span class="tt-tag" style="${tagStyle}">${tagTxt}</span>
    </div>
    <div class="tt-runway">
      <div class="tt-chamber" style="--ch-c:${ch1Col}">
        <span class="tt-ch-lbl">${ch1Lbl}</span>
        <div class="tt-ch-val">${ch1Val}</div>
        <span class="tt-ch-sub">${ch1Sub}</span>
      </div>
      <div class="tt-chamber" style="--ch-c:${ch2Col}">
        <span class="tt-ch-lbl">${ch2Lbl}</span>
        <div class="tt-ch-val">${lenKm}</div>
        <span class="tt-ch-sub">${ch2Sub}</span>
      </div>
    </div>
    <div class="tt-report-strip">
      <div class="tt-rep-meta">
        <span class="mp-pulse-dot" style="color:${isClosed ? '#ff3b30' : '#4cd964'}"></span>
        <span>DILAPORKAN: <b>${esc(repCount)}</b></span>
      </div>
      <span class="tt-rep-time">${esc(repTime)}</span>
    </div>
    ${corridorHtml}
    ${descHtml}
    <div class="tt-foot">
      <span>${esc(berlaku)}</span>
      <span style="color:${isClosed ? '#ff3b30' : '#4cd964'}"><b>${probTxt}</b></span>
    </div>
  </div>`;
}
function syncLayers(){
  if (!map) return;
  if (esriDarkBaseLayer && esriSatBaseLayer) {
    const wantSatBase = !!layerOn['basemap-sat'];
    if (wantSatBase) {
      if (map.hasLayer(esriDarkBaseLayer)) map.removeLayer(esriDarkBaseLayer);
      if (!map.hasLayer(esriSatBaseLayer)) map.addLayer(esriSatBaseLayer);
      esriSatBaseLayer.bringToBack();
    } else {
      if (map.hasLayer(esriSatBaseLayer)) map.removeLayer(esriSatBaseLayer);
      if (!map.hasLayer(esriDarkBaseLayer)) map.addLayer(esriDarkBaseLayer);
      esriDarkBaseLayer.bringToBack();
    }
  }
  const pairs = [[heat, 'heat'], [pinLayer, 'pins'], [camLayer, 'cams'], [tmaLayer, 'tma'], [ttFlowLayer, 'ttflow'], [ttIncTileLayer, 'ttinc'], [ttIncDataLayer, 'ttdata'], [flightLayer, 'flight'], [shipLayer, 'ship'], [transitLayer, 'transit'], [gempaLayer, 'gempa'], [gunungLayer, 'gunung'], [wxLayer, 'cuaca'], [windVelocityLayer, 'wind'], [radarLayer, 'radar'], [radarBmkgLayer, 'radarbmkg'], [peringatanLayer, 'peringatan'], [satIrLayer, 'sat-ir'], [satNcLayer, 'sat-nc'], [satWvLayer, 'sat-wv'], [satRainLayer, 'sat-rain'], [airLayer, 'air']];
  const legGate = { tma: 'flood', gempa: 'gempa', gunung: 'gunung' };
  for (const [l, k] of pairs) {
    if (!l) continue;
    const on = !!layerOn[k] && (!legGate[k] || legendOn[legGate[k]] !== false);
    if (on && !map.hasLayer(l)) map.addLayer(l);
    if (!on && map.hasLayer(l)) map.removeLayer(l);
  }
  if (sentinel2Layer) {
    const wantS2 = !!(layerOn.sentinel2 && s2Ok);
    if (wantS2 && !map.hasLayer(sentinel2Layer)) map.addLayer(sentinel2Layer);
    if (!wantS2 && map.hasLayer(sentinel2Layer)) map.removeLayer(sentinel2Layer);
  }
  const cred = document.querySelector('.map-f .cred');
  if (cred) cred.textContent = '© Esri · TomTom · BMKG · PVMBG' + (layerOn.sentinel2 && s2Ok ? ' · Contains modified Copernicus Sentinel data' : '');

  if (esriRefLayer) {
    if (layerOn.ttflow && map.hasLayer(esriRefLayer)) map.removeLayer(esriRefLayer);
    if (!layerOn.ttflow && !map.hasLayer(esriRefLayer)) map.addLayer(esriRefLayer);
  }
  if (regLabelLayer) {
    const showReg = !!(layerOn.pins || layerOn.heat);
    if (showReg && !map.hasLayer(regLabelLayer)) {
      map.addLayer(regLabelLayer);
      paintMapRegLabels();
    } else if (!showReg && map.hasLayer(regLabelLayer)) {
      map.removeLayer(regLabelLayer);
    }
  }
}

const SAT_IDS = ['sat-ir','sat-nc','sat-wv','sat-rain'];
function setSatExclusive(onId){
  for (const id of SAT_IDS) {
    const turnOn = id === onId;
    const b = document.querySelector(`[data-layer="${id}"]`);
    if (b) b.setAttribute('aria-pressed', turnOn ? 'true' : 'false');
    layerOn[id] = turnOn;
  }
  syncLayers();
  setSatSourceLabel();
}
function setSatSourceLabel(){ paintMapSrc(); }

const SAT_TILES = {
  'sat-ir': { param: 'EH', name: 'IR Enhanced', attribution: 'BMKG Himawari-9' },
  'sat-nc': { param: 'NC', name: 'Natural Color (siang)', attribution: 'BMKG Himawari-9' },
  'sat-wv': { param: 'WV', name: 'Water Vapor Enhanced', attribution: 'BMKG Himawari-9' },
  'sat-rain': { param: 'RP', name: 'Rainfall Potential', attribution: 'BMKG Himawari-9 · produk turunan' }
};
let satBasalRun = null, satModelRunAt = 0, satRunTs = 0, satRunLabel = '', wireSrcText = 'sumber —', satBusy = false, satSeq = 0;
function paintMapSrc(){
  const el = $('#map-src'); if (!el) return;
  if ((layerOn.sentinel2 || Date.now() < s2FlashUntil) && s2StatusText) {
    const zm = (map && typeof map.getZoom === 'function') ? map.getZoom() : 0;
    const zNote = (layerOn.sentinel2 && map && zm < 6)
      ? ` · zoom in ke z≥6 untuk citra 10m (saat ini z${zm})`
      : (map && zm > 12 ? ' · zoom 12 (skala visual)' : ' · 10m L2A NRT');
    el.textContent = s2StatusText + zNote;
    return;
  }
  const at = SAT_IDS.find(id => layerOn[id]);
  if (at && satRunTs) {
    const wibHour = (new Date().getUTCHours() + 7) % 24;
    const night = at === 'sat-nc' && (wibHour < 6 || wibHour >= 18);
    const rem = satRunTs + 600e3 - Date.now();
    const cd = rem > 0
      ? 'frame baru ~' + String(Math.floor(rem / 60000)).padStart(2, '0') + ':' + String(Math.floor(rem % 60000 / 1000)).padStart(2, '0')
      : 'menunggu frame baru…';
    el.textContent = 'sat ' + SAT_TILES[at].name + ' · obs ' + satRunLabel + ' · ' + cd + (night ? ' · malam: citra gelap' : '');
    return;
  }
  el.textContent = wireSrcText;
}
async function initSatelliteLayers(){
  if (satBusy) return;
  if (!mapOpen || !map) return;

  if (Date.now() - satModelRunAt < 300000) return;
  satBusy = true;
  const seq = ++satSeq;
  const firstLoad = !satRunTs;
  if (firstLoad) { const el = $('#map-src'); if (el) el.textContent = 'sat memuat model…'; }
  try {

    const fetchRun = u => getJson(u, 8000).then(r => (r && Array.isArray(r.himawari9) && r.himawari9.length) ? r : null).catch(() => null);
    const [r1, r2] = await Promise.all([
      fetchRun('https://satellite.bmkg.go.id/api22/modelrun'),
      API != null ? fetchRun(API + '/api/bmkg-modelrun') : Promise.resolve(null)
    ]);
    if (seq !== satSeq) return;
    if (!mapOpen || !map) { paintMapSrc(); return; }
    const d = r1 || r2;
    if (!d) { if (firstLoad) paintMapSrc(); return; }
    satModelRunAt = Date.now();
    const basalRun = d.himawari9[0];
    if (basalRun === satBasalRun && satIrLayer) return;
    satBasalRun = basalRun;
    const ts = new Date(basalRun);
    const timeLabel = isNaN(ts) ? basalRun : ts.toLocaleString('id-ID', {timeZone:'Asia/Jakarta'}) + ' WIB';
    satRunTs = isNaN(ts) ? 0 : ts.getTime();
    satRunLabel = isNaN(ts) ? basalRun : ts.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB';
    paintMapSrc();
    const mk = (id) => {
      const spec = SAT_TILES[id];

      const SatTile = L.TileLayer.extend({
        createTile(coords, done){
          const img = L.TileLayer.prototype.createTile.call(this, coords, done);
          const self = this;
          let tries = 0;
          img.addEventListener('error', function h(){
            if (self._satGone) return;
            if (++tries > 4) { img.removeEventListener('error', h); return; }
            img._satTimer = setTimeout(() => {
              img._satTimer = 0;
              if (self._satGone) return;
              try { img.src = img.src; } catch (e) {}
            }, 1200 * tries);
          });
          return img;
        },
        onAdd(map){ this._satGone = false; L.TileLayer.prototype.onAdd.call(this, map); },
        onRemove(map){

          this._satGone = true;
          L.TileLayer.prototype.onRemove.call(this, map);
        }
      });
      return new SatTile(`https://satellite.bmkg.go.id/api22/tile/{z}/{x}/{y}.png?tiletype=himawari9&modelname=himawari9&param=${spec.param}&baserun=${encodeURIComponent(basalRun)}`, {
        opacity: .55, zIndex: 200, maxNativeZoom: 7, minZoom: 3, tms: true,
        bounds: L.latLngBounds([-22, 78], [22, 158]),
        attribution: `${spec.attribution} · obs ${timeLabel} · update ±10 mnt`
      });
    };

    const news = [mk('sat-ir'), mk('sat-nc'), mk('sat-wv'), mk('sat-rain')];
    const olds = [satIrLayer, satNcLayer, satWvLayer, satRainLayer];
    for (let i = 0; i < SAT_IDS.length; i++) {
      if (!mapOpen || !map) return;
      const id = SAT_IDS[i], old = olds[i];
      if (layerOn[id]) {
        if (!map.hasLayer(news[i])) map.addLayer(news[i]);
        if (old && map.hasLayer(old)) map.removeLayer(old);
      } else if (old && map.hasLayer(old)) map.removeLayer(old);
    }
    if (!mapOpen || !map) return;

    satIrLayer = news[0]; satNcLayer = news[1]; satWvLayer = news[2]; satRainLayer = news[3];
    syncLayers();
  } catch (e) {
    if (firstLoad) paintMapSrc();
  } finally { satBusy = false; }
}

const SIP_COLOR = { high:'#ff3b30', medium:'#ff9f0a', low:'#ffe066' };
let fireData = [], fireCvLayer = null, fireInitDone = false;
const FIRE_SPR = {};
const FIRE_TINT = { high:[255,80,30], medium:[255,140,50], low:[255,195,95] };
function fireSprite(conf){
  if (FIRE_SPR[conf]) return FIRE_SPR[conf];
  const sz = 64, c = document.createElement('canvas'); c.width = c.height = sz;
  const x = c.getContext('2d'), m = sz / 2, [r, g, b] = FIRE_TINT[conf] || FIRE_TINT.medium;
  const gr = x.createRadialGradient(m, m, 0, m, m, m);
  gr.addColorStop(0,   `rgba(${r},${g},${b},.8)`);
  gr.addColorStop(.3,  `rgba(${r},${g},${b},.38)`);
  gr.addColorStop(.62, `rgba(${r},${g},${b},.1)`);
  gr.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, sz, sz);
  return FIRE_SPR[conf] = c;
}
function firePaint(t){
  const ctx = t.canvas.getContext('2d'), size = t.size;
  ctx.clearRect(0, 0, size.x, size.y);
  if (!layerOn.fires || !fireData.length) return;
  const b = map.getBounds(), pad = .08;
  const s = b.getSouth() - pad, n = b.getNorth() + pad, w = b.getWest() - pad, e = b.getEast() + pad;
  for (const p of fireData) {
    if (p.lat < s || p.lat > n || p.lon < w || p.lon > e) continue;
    const pt = map.latLngToContainerPoint([p.lat, p.lon]);
    const sz = p.conf === 'high' ? 26 : p.conf === 'medium' ? 19 : 13;
    ctx.drawImage(fireSprite(p.conf), pt.x - sz/2, pt.y - sz/2, sz, sz);
  }
}
function fireHitTest(cp){
  if (!layerOn.fires || !fireData.length || !map) return null;
  const b = map.getBounds(), pad = .05;
  const s = b.getSouth() - pad, n = b.getNorth() + pad, w = b.getWest() - pad, e = b.getEast() + pad;
  let best = null, bd = 20 * 20;
  for (const p of fireData) {
    if (p.lat < s || p.lat > n || p.lon < w || p.lon > e) continue;
    const q = map.latLngToContainerPoint([p.lat, p.lon]);
    const dx = q.x - cp.x, dy = q.y - cp.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function fireInit(){
  if (fireInitDone || !map) return;
  fireInitDone = true;
  fireCvLayer = L.canvasLayer({ pane: map.getPane('overlayPane') }).delegate({ onDrawLayer: firePaint }).addTo(map);
  fireCvLayer._canvas.style.pointerEvents = 'none';
  map.on('click', e => {
    if (!layerOn.fires || !fireData.length) return;
    const best = fireHitTest(e.containerPoint);
    if (best) L.popup({ closeButton: false, maxWidth: 340 }).setLatLng([best.lat, best.lon]).setContent(best.html).openOn(map);
  });
}
function fireRefresh(){ if (fireCvLayer) fireCvLayer.needRedraw(); }
let sipongiInflight = null;
async function pullSipongiJson(){
  if (sipongiInflight) return sipongiInflight;
  sipongiInflight = getJson(API + '/api/sipongi', 45000).finally(() => { sipongiInflight = null; });
  return sipongiInflight;
}
async function pullFires(){
  if (!mapOpen || !map || API == null) return;
  try {
    fireData = [];
    const sip = await pullSipongiJson().catch(() => null);
    const spots = sip && Array.isArray(sip.hotspots) ? sip.hotspots : [];
    if (spots.length) {
      for (const p of spots) {
        const conf = SIP_COLOR[p.confidence] ? p.confidence : 'low';
        const col = SIP_COLOR[conf] || '#ff9f0a';
        const age = p.time ? Math.max(0, Math.round((Date.now() - p.time) / 3600e3)) + ' jam lalu' : '—';
        const mainLoc = [p.desa, p.kecamatan].filter(Boolean).join(', ') || p.kabkota || p.provinsi || 'Titik Hotspot';
        const subLoc = [p.kabkota, p.provinsi].filter(Boolean).join(' · ') || (p.desa ? p.desa : 'Indonesia');
        const timeStr = p.time ? new Date(p.time).toLocaleString('id-ID', { timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit' }) + ' WIB' : '—';
        const confText = conf === 'high' ? 'HIGH' : conf === 'medium' ? 'MED' : 'LOW';
        const frpText = p.frp != null ? Number(p.frp).toFixed(1) + ' MW' : 'CONF';
        fireData.push({ lat: p.lat, lon: p.lon, conf, html:
          `<div class="mp-kpi-card" style="--kpi-c:${col}">
            <div class="mp-kpi-head">
              <span class="mp-k" style="color:${col}">HOTSPOT · SIPONGI KEMENHUT</span>
              <span class="mp-kpi-tag">${esc(p.sumber || 'VIIRS')}</span>
            </div>
            <div class="mp-kpi-body">
              <div class="mp-kpi-hero">
                <span class="mp-kpi-val">${confText}</span>
                <span class="mp-kpi-sub">${esc(frpText)}</span>
              </div>
              <div class="mp-kpi-info">
                <div class="mp-kpi-title">${esc(mainLoc)}</div>
                <div class="mp-kpi-subt">${esc(subLoc)}</div>
                <div class="mp-kpi-tele"><span>${esc(timeStr)}</span> · <b>${esc(age)}</b></div>
              </div>
            </div>
            <div class="mp-kpi-foot">
              <span>LOC <b>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</b></span>
              <span class="mp-kpi-note">*Anomali suhu satelit</span>
            </div>
          </div>` });
      }
    } else {

      const d = await getJson(API + '/api/fires', 30000);
      if (!d || !Array.isArray(d.items)) { fireRefresh(); return; }
      const confLevel = v => {
        const s = String(v || '').toLowerCase();
        if (s === 'h' || s === 'high' || Number(v) >= 70) return 'high';
        if (s === 'n' || s === 'nominal' || s === 'medium' || (Number(v) >= 30 && Number(v) < 70)) return 'nominal';
        return 'low';
      };
      const color = c => c === 'high' ? '#ff3b30' : c === 'nominal' ? '#ff9f0a' : '#ffe066';
      const confMap = { high:'high', nominal:'medium', low:'low' };
      for (const p of d.items) {
        const conf = confLevel(p.confidence);
        const col = color(conf);
        const age = p.time ? Math.max(0, Math.round((Date.now() - p.time) / 3600e3)) + ' jam lalu' : '—';
        const timeStr = p.time ? new Date(p.time).toLocaleString('id-ID', { timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit' }) + ' WIB' : '—';
        const confText = conf === 'high' ? 'HIGH' : conf === 'nominal' ? 'MED' : 'LOW';
        const frpText = p.frp != null ? Number(p.frp).toFixed(1) + ' MW' : 'CONF';
        const subLoc = p.daynight === 'D' ? 'Deteksi Siang Hari' : p.daynight === 'N' ? 'Deteksi Malam Hari' : 'Deteksi Satelit';
        fireData.push({ lat: p.lat, lon: p.lon, conf: confMap[conf], html:
          `<div class="mp-kpi-card" style="--kpi-c:${col}">
            <div class="mp-kpi-head">
              <span class="mp-k" style="color:${col}">HOTSPOT · NASA FIRMS</span>
              <span class="mp-kpi-tag">${esc(p.sensor || p.source || 'VIIRS')}</span>
            </div>
            <div class="mp-kpi-body">
              <div class="mp-kpi-hero">
                <span class="mp-kpi-val">${confText}</span>
                <span class="mp-kpi-sub">${esc(frpText)}</span>
              </div>
              <div class="mp-kpi-info">
                <div class="mp-kpi-title">Titik Api Karhutla</div>
                <div class="mp-kpi-subt">${esc(subLoc)}</div>
                <div class="mp-kpi-tele"><span>${esc(timeStr)}</span> · <b>${esc(age)}</b></div>
              </div>
            </div>
            <div class="mp-kpi-foot">
              <span>LOC <b>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</b></span>
              <span class="mp-kpi-note">*Anomali suhu satelit</span>
            </div>
          </div>` });
      }
    }
    fireInit();
    fireRefresh();
  } catch (e) {}
}

const AIR_COLOR = cat => {
  const s = String(cat || '').toUpperCase();
  if (s.includes('SANGAT TIDAK SEHAT')) return '#c4007a';
  if (s.includes('TIDAK SEHAT')) return '#ff3b30';
  if (s.includes('SEDANG')) return '#f1c21b';
  return '#3ddc97';
};
async function pullAir(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await pullSipongiJson();
    if (!d || !Array.isArray(d.air)) return;
    if (!airLayer) airLayer = L.layerGroup().addTo(map);
    airLayer.clearLayers();
    for (const p of d.air) {
      const col = AIR_COLOR(p.cat);
      const isUnhealthy = /TIDAK SEHAT/i.test(String(p.cat || ''));
      const txt = /SANGAT TIDAK SEHAT/.test(String(p.cat || '').toUpperCase()) || /TIDAK SEHAT/.test(String(p.cat || '').toUpperCase()) ? '#fff' : '#101010';
      const m = L.marker([p.lat, p.lon], { keyboard: false, icon: L.divIcon({ className: 'mk-aqi-ic',
        iconSize: [30, 16], iconAnchor: [15, 8],
        html: `<div class="mk-aqi" style="background:${col};color:${txt}">${esc(p.nilai || '·')}</div>` }) });
      const mainLoc = p.alamat || p.kota || 'Stasiun AQMS';
      const subLoc = p.kota ? p.kota + (p.provinsi ? ' · ' + p.provinsi : '') : (p.provinsi || 'Indonesia');
      const noteTxt = isUnhealthy ? '*Disarankan pakai masker' : '*Sensor stasiun darat';
      m.bindPopup(
        `<div class="mp-kpi-card" style="--kpi-c:${col}">
          <div class="mp-kpi-head">
            <span class="mp-k" style="color:${col}">KUALITAS UDARA · AQMS KLHK</span>
            <span class="mp-kpi-tag" style="color:${col};border-color:${col}55">${esc(p.cat || 'ISPU')}</span>
          </div>
          <div class="mp-kpi-body">
            <div class="mp-kpi-hero" style="--kpi-tc:${col}">
              <span class="mp-kpi-val">${esc(p.nilai || '—')}</span>
              <span class="mp-kpi-sub">ISPU</span>
            </div>
            <div class="mp-kpi-info">
              <div class="mp-kpi-title">${esc(mainLoc)}</div>
              <div class="mp-kpi-subt">${esc(subLoc)}</div>
              <div class="mp-kpi-tele"><b>${esc(p.cat || '—')}</b> · <span>${esc(p.waktu || 'Pengukuran')}</span></div>
            </div>
          </div>
          <div class="mp-kpi-foot">
            <span>LOC <b>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</b></span>
            <span class="mp-kpi-note">${noteTxt}</span>
          </div>
        </div>`);
      airLayer.addLayer(m);
    }
    syncLayers();
  } catch (e) {}
}

const joff = it => {
  const s = String(it.url || '') + '|' + (it.title || '') + '|' + (it.src || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const a = (h % 6283) / 1000, r = 0.006 + ((h >>> 9) % 34) / 1000;
  return [Math.cos(a) * r, Math.sin(a) * r];
};
function paintMap(){
  if (!mapReady) return;
  const visData = mapData.filter(i => i.fixed || legendOn[legendKeyOf(i)] !== false);
  if (heat) heat.setLatLngs(visData.filter(i => i.kind !== 'node').map(i => {
    const [dx, dy] = joff(i); return [i.la + dy, i.lo + dx, Math.max(0.18, Math.min(1, i.weight || 0.3))];
  }));
  pinLayer.clearLayers();
  for (const it of visData) {
    if (it.fixed) continue;
    const c = it.sub === 'gempa' ? '#ff5a4e' : (KIND_COLOR[it.kind] || '#8d8d8d');
    const [dx, dy] = joff(it);
    const fresh = it.ts && (Date.now() - it.ts) < 3 * 3600e3;
    let m;
    if (fresh) {
      const sz = 18 + Math.round(Math.min(1, it.weight || 0.3) * 8);
      m = L.marker([it.la + dy, it.lo + dx], {
        icon: L.divIcon({ className: '', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
          html: `<div class="pin-fresh" style="--pc:${c};width:${sz}px;height:${sz}px"><i></i></div>` }),
        keyboard: false
      });
    } else {
      m = L.circleMarker([it.la + dy, it.lo + dx], {
        radius: 4 + Math.round(Math.min(1, it.weight || 0.3) * 3),
        color: '#101010', weight: 1, opacity: .85, fillColor: c,
        fillOpacity: .9
      });
    }
    m.bindPopup(mapPopup(it), { maxWidth: 290, keepInView: true });
    m.bindTooltip(deEmoji(it.name), { direction: 'top', offset: [0, -5], opacity: .85 });
    pinLayer.addLayer(m);
  }
  camLayer.clearLayers();
  for (const c of CAMS) {
    if (!c.la || !c.lo) continue;
    const isWater = /^pantau\s+banjir/i.test(c.c) || /Kali|Pintu Air|Bendungan|Drain/i.test(c.n);
    const m = L.circleMarker([c.la, c.lo], {
      radius: isWater ? 5 : 2,
      color: isWater ? '#00e5ff' : '#8d8d8d',
      weight: isWater ? 2 : 1,
      opacity: isWater ? .95 : .4,
      fillColor: isWater ? '#00b4d8' : '#8d8d8d',
      fillOpacity: isWater ? .8 : .14
    });
    m.bindPopup(camPopup(c), { maxWidth: 260, keepInView: true });
    camLayer.addLayer(m);
  }
  if (!map._framed && mapData.length) {
    map.fitBounds(L.latLngBounds(mapData.map(i => [i.la, i.lo])), { padding: [36, 36], maxZoom: 6 });
    map._framed = true;
  }
  syncLayers();
  paintMapRegLabels();
}
let _regMeasureCtx = null;
function regTextWidth(txt){
  if (!_regMeasureCtx) {
    const cv = document.createElement('canvas');
    _regMeasureCtx = cv.getContext('2d');
    if (_regMeasureCtx) _regMeasureCtx.font = '600 8px "IBM Plex Mono", ui-monospace, monospace';
  }
  return _regMeasureCtx ? _regMeasureCtx.measureText(txt).width : txt.length * 5.2;
}
function paintMapRegLabels(){
  if (!mapReady || !map || !regLabelLayer) return;
  if (!mapOpen || !(layerOn.pins || layerOn.heat)) { regLabelLayer.clearLayers(); return; }
  const sz = map.getSize();
  if (!sz || sz.x < 40 || sz.y < 40) return;
  const groups = new Map();
  for (const it of mapData) {
    if (it.fixed || typeof it.la !== 'number' || typeof it.lo !== 'number') continue;
    const raw = (deEmoji(it.name) || '').trim();
    if (!raw) continue;
    const key = raw.toUpperCase();
    let g = groups.get(key);
    if (!g) { g = { name: key, la: 0, lo: 0, c: 0 }; groups.set(key, g); }
    g.la += it.la; g.lo += it.lo; g.c++;
  }
  const labels = [...groups.values()]
    .map(g => ({ name: g.name, la: g.la / g.c, lo: g.lo / g.c, c: g.c }))
    .sort((a, b) => b.c - a.c || (a.name < b.name ? -1 : 1));
  const z = map.getZoom();
  const maxLab = z <= 4 ? 6 : z <= 5 ? 14 : z <= 6 ? 28 : z <= 7 ? 45 : z <= 8 ? 65 : z <= 9 ? 80 : Math.max(10, Math.round(80 / (1 << Math.min(4, z - 9))));
  const placed = [];
  regLabelLayer.clearLayers();
  for (const lab of labels) {
    if (placed.length >= maxLab) break;
    const pt = map.latLngToContainerPoint([lab.la, lab.lo]);
    if (!isFinite(pt.x) || !isFinite(pt.y)) continue;
    const text = lab.name + ' ' + lab.c;
    const bw = Math.ceil(regTextWidth(text)) + 10, bh = 13;
    let bx = pt.x + 10, flipLeft = false;
    if (bx + bw > sz.x - 6 && pt.x - 10 - bw >= 6) { bx = pt.x - 10 - bw; flipLeft = true; }
    const by = pt.y - 6;
    if (bx < 4 || bx + bw > sz.x - 4 || by < 4 || by + bh > sz.y - 4) continue;
    const clash = placed.some(p => p.x < bx + bw + 2 && p.x + p.w + 2 > bx && p.y < by + bh + 2 && p.y + p.h + 2 > by);
    if (clash) continue;
    placed.push({ x: bx, y: by, w: bw, h: bh });
    const ic = L.divIcon({
      className: 'reg-lbl-ic',
      iconSize: [bw, bh],
      iconAnchor: [flipLeft ? bw + 10 : -10, 6],
      html: `<div class="reg-lbl">${esc(text)}</div>`
    });
    regLabelLayer.addLayer(L.marker([lab.la, lab.lo], { pane: 'regLabels', interactive: false, keyboard: false, icon: ic }));
  }
}
function ttFlowPopup(lat, lon){
  if (API == null) return '<div class="mp-m">TomTom butuh API server.</div>';
  return `<div class="mp-k" style="color:#00e676">TomTom flow · memuat…</div><div class="mp-t">Cek kecepatan jalan terdekat…</div>`;
}
let flowLine = null;
async function showTomTomFlow(lat, lon, parentMarker){
  const z = map ? Math.max(8, Math.min(19, map.getZoom())) : 10;
  const box = `<div class="mp-k" style="color:#00e676">TomTom flow · ${z}</div><div class="mp-t">Memuat…</div>`;
  if (parentMarker) parentMarker.setPopupContent(box).openPopup();
  try {
    const d = await getJson(API + '/api/tomtom/flow?lat=' + lat + '&lon=' + lon + '&zoom=' + z, 12000);
    if (!d.ok) throw new Error(d.err || 'gagal');
    const html = `<div class="mp-k" style="color:#00e676">TomTom flow</div>
      <div class="mp-t">${esc(d.frc ? 'Segment ' + d.frc : 'Jalan terdekat')}</div>
      <div class="mp-m">kecepatan <b style="color:#f4f4f4">${d.currentSpeed ?? '—'} / ${d.freeFlowSpeed ?? '—'} km/j</b><br>
      waktu tempuh ${fmtDur(d.currentTravelTime)} (bebas ${fmtDur(d.freeFlowTravelTime)})<br>
      confidence ${d.confidence ?? '—'} · closure ${d.roadClosure ? 'YA' : 'tidak'}<br>
      titik ${d.point.lat.toFixed(5)}, ${d.point.lon.toFixed(5)}</div>
      ${d.coordinates.length ? '<div class="mp-m" style="text-transform:none">garis segmen digambar di peta</div>' : ''}`;
    if (parentMarker) parentMarker.setPopupContent(html);
    if (flowLine && map) { try { map.removeLayer(flowLine); } catch (e) {} flowLine = null; }
    if (d.coordinates.length && map) {
      const ll = d.coordinates.map(p => [p.latitude, p.longitude]).filter(p => isFinite(p[0]) && isFinite(p[1]));
      if (ll.length > 1) flowLine = L.polyline(ll, { color: '#f1c21b', weight: 5, opacity: 0.85, dashArray: '6 6' }).addTo(map).bindPopup('Segment TomTom · ' + (d.currentSpeed ?? '—') + ' km/j');
    }
  } catch (e) {
    if (parentMarker) parentMarker.setPopupContent(`<div class="mp-k" style="color:#f1c21b">TomTom flow</div><div class="mp-t">Tidak ada data flow di titik ini.</div><div class="mp-m">${esc(e.message || 'gagal')}</div>`);
  }
}
async function checkTomTom(){
  if (API == null) { ttOk = false; return; }
  try {
    const d = await getJson(API + '/api/tomtom/status', 8000);
    ttOk = !!d.keyConfigured;
    if (!ttOk) { wireSrcText = 'TomTom: API key belum ada'; paintMapSrc(); }
  } catch (e) {}
}
async function checkCopernicus(){
  if (API == null) {
    s2Ok = false;
    s2StatusText = 'Copernicus S2: butuh backend aktif';
    return false;
  }
  try {
    const d = await getJson(API + '/api/copernicus/status', 8000);
    s2Ok = Boolean(d && d.configured);
    if (!s2Ok) {
      s2StatusText = 'Copernicus S2: set CDSE_CLIENT_ID & CDSE_CLIENT_SECRET di .env';
    } else if (d.dailyCap > 0 && (d.dailyUsed || 0) >= d.dailyCap) {
      s2StatusText = `Copernicus S2: kuota harian (${d.dailyUsed}/${d.dailyCap}) penuh · reset besok`;
    } else {
      s2StatusText = `Copernicus S2 (${d.dailyUsed || 0}/${d.dailyCap || 1200} hr ini · ${d.cacheEntries || 0} cache)`;
    }
    paintMapSrc();
    return s2Ok;
  } catch (e) {
    s2Ok = false;
    s2StatusText = 'Copernicus S2: status gagal dimuat';
    return false;
  }
}
async function pullTomTomIncidents(){
  if (!mapOpen || !map || !ttOk || ttIncBusy || API == null || !layerOn.ttdata) return;
  ttIncBusy = true;
  try {
    const b = map.getBounds();
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
    let bbox = w + ',' + s + ',' + e + ',' + n;
    const wide = Math.abs(e - w) > 1.2 || Math.abs(n - s) > 0.8;
    if (wide) {
      const c = b.getCenter();
      const ddLon = 0.5, ddLat = 0.3;
      bbox = (c.lng - ddLon) + ',' + (c.lat - ddLat) + ',' + (c.lng + ddLon) + ',' + (c.lat + ddLat);
    }
    const d = await getJson(API + '/api/tomtom/incidents?bbox=' + encodeURIComponent(bbox) + '&lang=id-ID', 30000);
    if (!d.ok) throw new Error(d.err || 'insiden gagal');
    if (!ttIncDataLayer) ttIncDataLayer = L.layerGroup();
    ttIncDataLayer.clearLayers();
    for (const inc of d.incidents || []) {
      if (inc.geometry?.type === 'LineString' && inc.geometry.coordinates?.length > 1) {
        const ll = inc.geometry.coordinates.map(p => [p[1], p[0]]).filter(p => isFinite(p[0]) && isFinite(p[1]));
        if (ll.length) {
          const col = ttSevCol(inc);
          const pop = ttIncPopup(inc);

          L.polyline(ll, { color: 'transparent', weight: 18, opacity: 0, interactive: true })
            .addTo(ttIncDataLayer).bindPopup(pop, { className: 'tt-pop', maxWidth: 340, keepInView: true });
          L.polyline(ll, { color: col, weight: 5, opacity: 0.9, interactive: false })
            .addTo(ttIncDataLayer).bindPopup(pop, { className: 'tt-pop', maxWidth: 340, keepInView: true });

          const badge = L.marker(ll[Math.floor(ll.length / 2)], { icon: ttIcon(inc, ttLnSize()), interactive: false, keyboard: false });
          badge._tt = { inc, line: true };
          badge.addTo(ttIncDataLayer);
        }
      } else if (inc.lat != null && inc.lon != null) {
        const m = L.marker([inc.lat, inc.lon], { icon: ttIcon(inc, ttPtSize()), keyboard: false });
        m._tt = { inc };
        m.bindPopup(ttIncPopup(inc), { className: 'tt-pop', maxWidth: 340, keepInView: true });
        ttIncDataLayer.addLayer(m);
      }
    }
    const note = 'TomTom insiden ' + (d.incidents?.length || 0) + (wide ? ' · area dipersempit, zoom masuk utk detail' : '');
    $('#map-meta').textContent = note;
    syncLayers();
  } catch (e) {
    $('#map-meta').textContent = 'TomTom insiden: ' + (e.message || e).slice(0, 80);
  } finally { ttIncBusy = false; }
}
function rpMarker(pt, key, color, label){
  const ic = L.divIcon({ className:'rp-ic', iconSize:[30,30], iconAnchor:[15,15],
    html:`<div class="rp-dot" style="border-color:${color};color:${color}">${label}</div>` });
  const m = L.marker([pt.lat, pt.lon], { icon: ic, draggable: true, keyboard: false }).addTo(routeLayer);
  m.bindPopup(`<div class="mp-k" style="color:${color}">Titik ${label}</div>
    <div class="mp-m">${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}<br>seret marker untuk memindahkan titik</div>`);
  m.on('dragend', () => {
    const p = m.getLatLng(), o = { lat: p.lat, lon: p.lng };
    if (key === 'A') { routeA = o; $('#rp-from').value = o.lat + ',' + o.lon; }
    else { routeB = o; $('#rp-to').value = o.lat + ',' + o.lon; }
    if (routeA && routeB) calcRoute(); else paintRoute();
  });
  return m;
}
function paintRoute(){
  if (!map || !routeLayer) return;
  routeLayer.clearLayers();
  if (routeA) rpMarker(routeA, 'A', '#00e676', 'A');
  if (routeB) rpMarker(routeB, 'B', '#da1e28', 'B');
  if (routeA && routeB) L.polyline([[routeA.lat, routeA.lon], [routeB.lat, routeB.lon]], { color: '#ffffff', weight: 2, dashArray: '6 6', opacity: 0.7 }).addTo(routeLayer);
}
function rpOut(html){ $('#rp-out').innerHTML = html; }
function parseLL(s){
  const p = String(s || '').trim().replace(/\s/g, '').split(',');
  const lat = parseFloat(p[0]), lon = parseFloat(p[1]);
  return isFinite(lat) && isFinite(lon) ? { lat, lon } : null;
}
async function calcRoute(){
  const a = parseLL($('#rp-from').value) || routeA;
  const b = parseLL($('#rp-to').value) || routeB;
  if (!a || !b) { rpOut('<span class="warn">Isi titik A dan B dulu (klik peta atau ketik lat,lon).</span>'); return; }
  routeA = a; routeB = b;
  $('#rp-from').value = a.lat + ',' + a.lon;
  $('#rp-to').value = b.lat + ',' + b.lon;
  paintRoute();
  const straight = havKm(a, b);
  rpOut('Menghitung rute TomTom… <span style="color:var(--text3)">garis lurus ' + fmtKm(straight) + '</span>');
  try {
    const d = await getJson(API + '/api/tomtom/route?from=' + a.lat + ',' + a.lon + '&to=' + b.lat + ',' + b.lon + '&mode=driving', 30000);
    if (!d.ok) throw new Error(d.err || 'rute gagal');
    let rtLine = null;
    if (routeLayer && d.polyline?.length) {
      rtLine = L.polyline(d.polyline.map(p => [p.lat, p.lon]), { color: '#00e676', weight: 5, opacity: .95 }).addTo(routeLayer);
      const mid = rtLine.getBounds().getCenter();
      const delay = d.trafficDelaySec ? '+' + fmtDur(d.trafficDelaySec) : 'lancar';
      L.marker(mid, { icon: L.divIcon({ className:'rp-ic', iconSize:[1,1], iconAnchor:[0,0], html:'' }), interactive: false })
        .addTo(routeLayer)
        .bindTooltip(`<div class="mp-k" style="color:#00e676">RUTE · ${esc(d.mode || 'driving')}</div>
          <div class="mp-m">jalan <b>${fmtKm(d.distanceKm)}</b> · garis lurus ${fmtKm(d.straightKm)}<br>
          ETA <b>${fmtDur(d.trafficTimeSec)}</b> · bebas ${fmtDur(d.travelTimeSec)} · delay <b style="color:${d.trafficDelaySec ? '#f1c21b' : '#4dd0a0'}">${delay}</b><br>
          macet: <b>${esc(d.congestion || '—')}</b>${d.arrivalTime ? ' · tiba ' + esc(d.arrivalTime) : ''}</div>`,
          { permanent: true, direction: 'top', className: 'rp-tip', offset: [0, -6] });
    }
    const gauge = d.congestion ? '<span>kemacetan: <b>' + esc(d.congestion) + '</b></span>' : '';
    rpOut('<span>garis lurus <b>' + fmtKm(d.straightKm) + '</b></span><span>rute jalan <b>' + (d.distanceKm != null ? fmtKm(d.distanceKm) : '—') + '</b></span><span>estimasi <b>' + fmtDur(d.trafficTimeSec) + '</b></span><span>bebas <b>' + fmtDur(d.travelTimeSec) + '</b></span>' + gauge + (d.arrivalTime ? '<span> tiba <b>' + esc(d.arrivalTime) + '</b></span>' : ''));
  } catch (e) {
    rpOut('<span class="warn">' + esc(e.message || 'rute gagal') + '</span><span>garis lurus <b>' + fmtKm(straight) + '</b></span>');
  }
}
function ensureMap(){
  if (map) return;
  if (typeof L === 'undefined') {
    $('#map').innerHTML = '<div class="empty">Leaflet gagal dimuat. Cek koneksi ke CDN.</div>';
    return;
  }
  map = L.map('map', { zoomControl:false, attributionControl:false, preferCanvas:true, minZoom:4, maxZoom:18 })
    .setView([-2.5, 118], 5);
  esriDarkBaseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 18, zIndex: 10
  });
  esriSatBaseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 17, maxZoom: 18, zIndex: 10, className: 'sat-base-pane'
  });
  (layerOn['basemap-sat'] ? esriSatBaseLayer : esriDarkBaseLayer).addTo(map);
  esriRefLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 18, opacity: .9, zIndex: 180
  }).addTo(map);
  sentinel2Layer = L.tileLayer(s2TileUrl(), {
    tileSize: 256, minZoom: 6, maxZoom: 18, minNativeZoom: 6, maxNativeZoom: 12,
    zIndex: 150, opacity: .95, bounds: L.latLngBounds([-11.5, 94.5], [6.5, 141.5])
  });
  ttFlowLayer = L.tileLayer(ttTileUrl('flow'), { opacity: .5, className: 'tt-flow-pane', maxNativeZoom: 19, maxZoom: 19 });
  ttIncTileLayer = L.tileLayer(ttTileUrl('incidents'), { opacity: .9, maxNativeZoom: 19, maxZoom: 19 });
  L.control.zoom({ position:'bottomright' }).addTo(map);
  if (typeof L.heatLayer === 'function') {
    heat = L.heatLayer([], { radius: 38, blur: 24, maxZoom: 13, max: 1, minOpacity: .2,
      gradient: { 0.15:'#3d0d0f', 0.35:'#6e1418', 0.55:'#9c181e', 0.75:'#c11c24', 0.9:'#e02830', 1:'#ff4d54' } });
  }
  const regPane = map.createPane('regLabels');
  regPane.style.zIndex = 620;
  regPane.style.pointerEvents = 'none';
  pinLayer = L.layerGroup();
  regLabelLayer = L.layerGroup();
  camLayer = L.layerGroup();
  tmaLayer = L.layerGroup();
  ttIncDataLayer = L.layerGroup();
  routeLayer = L.layerGroup();
  mapReady = true;
  map.on('moveend', debounce(pullTomTomIncidents, 500));
  map.on('moveend resize', paintMapRegLabels);
  map.on('zoomend', () => {
    for (const [k, m] of flMarkers) if (m._hdg != null) m.setIcon(dirIc('plane', m._hdg, '#7cc7ff'));
    for (const [k, m] of shMarkers) if (m._hdg != null) m.setIcon(dirIc('ship', m._hdg, '#4dd0e1'));
    if (wxLayer) wxLayer.eachLayer(m => { if (m._wx) m.setIcon(wxIcon(m._wx.code, m._wx.col)); });
    if (ttIncDataLayer) ttIncDataLayer.eachLayer(m => { if (m._tt) m.setIcon(ttIcon(m._tt.inc, m._tt.line ? ttLnSize() : ttPtSize())); });
    if (layerOn.transit && transitLayer) pullTransit();
    if (layerOn.sentinel2) paintMapSrc();
  });
  map.on('click', e => {
    if (routeMode) {
      const ll = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (!routeA) { routeA = ll; $('#rp-from').value = ll.lat + ',' + ll.lon; rpOut('Titik A terpasang. Klik titik B…'); }
      else if (!routeB) { routeB = ll; $('#rp-to').value = ll.lat + ',' + ll.lon; calcRoute(); }
      else { routeA = ll; routeB = null; $('#rp-from').value = ll.lat + ',' + ll.lon; $('#rp-to').value = ''; rpOut('Titik A baru terpasang. Klik titik B…'); }
      paintRoute();
      return;
    }
    if (flowMode && ttOk) {
      if (flowBusy) return;
      flowBusy = true;
      setTimeout(() => flowBusy = false, 1500);
      if (!flowProbe) {
        flowProbe = L.marker(e.latlng, { icon: L.divIcon({ className:'', iconSize:[18,18], iconAnchor:[9,9], html:'<div class="flow-dot"></div>' }), keyboard:false }).addTo(map);
        flowProbe.bindPopup(ttFlowPopup(e.latlng.lat, e.latlng.lng), { maxWidth: 300, keepInView: true });
      } else { flowProbe.setLatLng(e.latlng); flowProbe.setPopupContent(ttFlowPopup(e.latlng.lat, e.latlng.lng)); }
      showTomTomFlow(e.latlng.lat, e.latlng.lng, flowProbe);
      return;
    }
  });
  map.on('popupopen', ev => {
    const btn = ev.popup.getElement()?.querySelector('[data-tt-flow]');
    if (btn) btn.addEventListener('click', () => {
      const [lat, lon] = btn.dataset.ttFlow.split(',').map(Number);
      showTomTomFlow(lat, lon, ev.popup);
    }, { once: true });
    const rb = ev.popup.getElement()?.querySelector('[data-read]');
    if (rb) rb.addEventListener('click', () => {
      const u = rb.dataset.read;
      if (map) map.closePopup();
      rdOpen(u, rb);
    }, { once: true });
    const cb = ev.popup.getElement()?.querySelector('[data-cam-open]');
    if (cb) cb.addEventListener('click', () => {
      const s = cb.dataset.camOpen;
      const c = CAMS.find(x => x.s === s);
      if (c) openLightbox(camStream(c), c.n, c.c, c.e, camSteps(c), cb);
    }, { once: true });
  });
  let mapHoverT = 0;
  map.on('mousemove', e => {
    if (flowMode) { map.getContainer().style.cursor = 'crosshair'; return; }
    if (map.dragging && map.dragging.moving()) return;
    const now = Date.now();
    if (now - mapHoverT < 35) return;
    mapHoverT = now;
    const isHotspot = !!(layerOn.fires && fireData.length && typeof fireHitTest === 'function' && fireHitTest(e.containerPoint));
    const isWarn = !!(layerOn.peringatan && warnAlerts.length && typeof warnHitTest === 'function' && warnHitTest(e.latlng));
    map.getContainer().style.cursor = (isHotspot || isWarn) ? 'pointer' : '';
  });
  map.getContainer().addEventListener('mouseleave', () => {
    if (map && !flowMode) map.getContainer().style.cursor = '';
  });
  checkTomTom();
  paintMap();
}
let GEO_NODES_CACHE = null, geoIncLoaded = false, geoDisLoaded = false;
const GEO_SHINGLE_ORDER = ['demo','fire','flood','disaster','insiden','kriminal','kesehatan','politik','ekonomi','siber'];
function renderGeoTelemetry(){
  const specEl = $('#geo-spec');
  const idxEl = $('#geo-idx');
  const sensorEl = $('#geo-sensor');
  const shinglesEl = $('#geo-shingles');
  const countEl = $('#geo-count');
  if (!sensorEl || !shinglesEl) return;
  if (API == null) {
    if (specEl) { specEl.innerHTML = ''; specEl.style.width = '0px'; }
    sensorEl.innerHTML = '';
    if (idxEl) idxEl.classList.remove('has-cats');
    shinglesEl.innerHTML = `<span class="geo-item is-muted"><span class="geo-l">Offline · ${CAMS.length} kamera</span></span>`;
    if (countEl) countEl.textContent = CAMS.length + ' kamera';
    return;
  }
  if (!geoIncLoaded || !geoDisLoaded) {
    if (specEl) { specEl.innerHTML = ''; specEl.style.width = '0px'; }
    sensorEl.innerHTML = '';
    if (idxEl) idxEl.classList.remove('has-cats');
    shinglesEl.innerHTML = '<span class="geo-item is-muted"><span class="geo-l">Sinkronisasi globe…</span></span>';
    if (countEl) countEl.textContent = '— titik';
    return;
  }
  const pts = (PULSE || []).concat(DIS_PULSE || [])
    .filter(p => p && !p.fixed && typeof p.la === 'number' && typeof p.lo === 'number');
  const counts = Object.create(null);
  for (const p of pts) {
    const k = legendKeyOf(p);
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  if (specEl) {
    const specKeys = ['gempa', 'gunung'].concat(GEO_SHINGLE_ORDER).filter(k => (counts[k] || 0) > 0);
    specEl.innerHTML = pts.length && specKeys.length
      ? specKeys.map(k => `<span class="geo-seg" style="flex:${counts[k]} 1 0%;background:${CAT_COLOR[k] || '#8d8d8d'}"></span>`).join('')
      : '';
    if (!specEl.innerHTML) specEl.style.width = '0px';
  }
  const compactSensors = idxEl && idxEl.clientWidth > 0 && idxEl.clientWidth < 300;
  const nGempa = counts.gempa || 0;
  const nGunung = counts.gunung || 0;
  const nBanjir = (DIS_PULSE || []).filter(p => p && (p.sub === 'tma' || p.sub === 'flood')).length;
  sensorEl.innerHTML =
    `<span class="geo-item is-sensor${nGempa ? '' : ' is-zero'}" style="--cat:${CAT_COLOR.gempa}"><i class="geo-pip" aria-hidden="true"></i><b class="geo-n">${nGempa}</b><span class="geo-l">${compactSensors ? 'GMP' : 'Gempa'}</span></span>` +
    `<span class="geo-item is-sensor${nGunung ? '' : ' is-zero'}" style="--cat:${CAT_COLOR.gunung}"><i class="geo-pip" aria-hidden="true"></i><b class="geo-n">${nGunung}</b><span class="geo-l">${compactSensors ? 'API' : 'Gn.Api'}</span></span>` +
    `<span class="geo-item is-sensor${nBanjir ? '' : ' is-zero'}" style="--cat:${CAT_COLOR.flood}"><i class="geo-pip" aria-hidden="true"></i><b class="geo-n">${nBanjir}</b><span class="geo-l">${compactSensors ? 'BNJ' : 'Banjir'}</span></span>`;
  const active = GEO_SHINGLE_ORDER
    .filter(k => (counts[k] || 0) > 0)
    .map(k => ({ k, label: CAT_LABEL[k] || k, n: counts[k], color: CAT_COLOR[k] || '#8d8d8d' }));
  const buildIndexItems = (items, extraCats) => {
    const base = items.map(it =>
      `<span class="geo-item" style="--cat:${it.color}"><i class="geo-pip" aria-hidden="true"></i><b class="geo-n">${it.n}</b><span class="geo-l">${esc(it.label)}</span></span>`
    ).join('');
    const more = extraCats > 0
      ? (compactSensors
          ? `<span class="geo-item is-more"><b class="geo-n">+${extraCats}</b></span>`
          : `<span class="geo-item is-more"><b class="geo-n">+${extraCats}</b><span class="geo-l">Lain</span></span>`)
      : '';
    return base + more;
  };
  if (!active.length) {
    shinglesEl.innerHTML = '<span class="geo-item is-muted"><span class="geo-l">Menunggu data globe…</span></span>';
    if (idxEl) idxEl.classList.add('has-cats');
  } else {
    let shown = active.slice();
    let hiddenCats = 0;
    shinglesEl.innerHTML = buildIndexItems(shown, 0);
    if (idxEl && idxEl.clientWidth > 0) {
      while (idxEl.scrollWidth > idxEl.clientWidth + 1 && shown.length > 0) {
        shown.pop();
        hiddenCats += 1;
        shinglesEl.innerHTML = buildIndexItems(shown, hiddenCats);
      }
      if (idxEl.scrollWidth > idxEl.clientWidth + 1 && hiddenCats > 0) {
        shinglesEl.innerHTML = '';
      }
    }
    if (idxEl) idxEl.classList.toggle('has-cats', shinglesEl.innerHTML !== '');
  }
  if (specEl && specEl.innerHTML && idxEl) {
    const telEl = $('#geo-telemetry');
    const items = idxEl.querySelectorAll('.geo-item');
    const lastIt = items.length ? items[items.length - 1] : null;
    if (telEl && lastIt) {
      const tRect = telEl.getBoundingClientRect();
      const lRect = lastIt.getBoundingClientRect();
      specEl.style.width = Math.max(0, Math.round(lRect.right - tRect.left)) + 'px';
    }
  }
  if (countEl) countEl.textContent = pts.length + ' titik';
}
if (typeof ResizeObserver === 'function') {
  const _geoTelObsEl = document.getElementById('geo-telemetry');
  if (_geoTelObsEl) {
    let _geoResizeT = 0;
    new ResizeObserver(() => {
      if (_geoResizeT) return;
      _geoResizeT = requestAnimationFrame(() => { _geoResizeT = 0; renderGeoTelemetry(); });
    }).observe(_geoTelObsEl);
  }
}
async function pullIncidents(fresh){
  if (mapBusy) return;
  if (API == null) {
    PULSE = [];
    drawGlobe(performance.now());
    renderGeoTelemetry();
    $('#map-meta').textContent = 'butuh server';
    $('#map-src').textContent = 'tanpa API';
    if (mapOpen && typeof L !== 'undefined') { ensureMap(); paintMap(); }
    return;
  }
  mapBusy = true;
  try {
    if (!GEO_NODES_CACHE) {
      try {
        const nr = await getJson(API + '/api/nodes', 15000);
        if (nr && nr.ok && Array.isArray(nr.items)) GEO_NODES_CACHE = nr.items;
      } catch (e) {}
    }
    const qs = (GEO_NODES_CACHE ? 'nodes=0' : 'nodes=1') + (fresh && SITREP_CAN_FRESH ? '&fresh=1' : '');
    const d = await getJson(API + '/api/incidents?' + qs, 30000);
    if (d && d.ok) {
      mapData = d.items || [];
      if (d.nodesOmitted && GEO_NODES_CACHE) mapData = mapData.concat(GEO_NODES_CACHE);
      const GEMPA_SKIP = /aman gempa|tahan gempa|resisten gempa|anti[- ]?gempa|gempa resistant/i;
      const GEMPA_AID = /bantuan|relief|kemanusiaan|donasi|salurkan|penyintas|pemulihan|posko|logistik|pengungsian|rehabilitasi|rekonstruksi|bansos/i;
      const GEMPA_SIG = /\b(?:m|mag)\.?\s*[:=]?\s*\d+[.,]\d|magnitudo|richter|gempa tektonik|gempa susulan|aftershock|diguncang|guncang|berpusat|episenter|tsunami/i;
      for (const it of mapData) {
        it.title = cleanTitle(it.title || '', it.pub || it.src);
        const t = it.title || '';
        if (it.kind === 'disaster' && /\bgempa\b|gempabumi/i.test(t) && !GEMPA_SKIP.test(t) && !GEMPA_AID.test(t) && GEMPA_SIG.test(t)) it.sub = 'gempa';
      }
      PULSE = mapData;
      geoIncLoaded = true;
      maybeFocusFresh();
      const nReal = mapData.filter(i => !i.fixed).length;
      renderGeoTelemetry();
      $('#map-meta').textContent = nReal + ' titik · ' + (mapData.length - nReal) + ' node · sync ' + wibTime(d.at) + (d.stale ? ' · DATA LAMA' : '');
      wireSrcText = 'wire ' + (d.total || nReal) + (d.raw && d.raw > d.total ? ' · ' + d.raw + ' artikel' : '') + ' · kamera ' + CAMS.length;
      paintMapSrc();
      drawGlobe(performance.now());
      if (mapOpen && typeof L !== 'undefined') { ensureMap(); paintMap(); }
      if (layerOn.peringatan && mapOpen) pullAlerts();
    } else if (!geoIncLoaded) {
      geoIncLoaded = true;
      renderGeoTelemetry();
    }
  } catch (e) {
    geoIncLoaded = true;
    renderGeoTelemetry();
    $('#map-meta').textContent = 'peta gagal';
  } finally { mapBusy = false; }
}
function sizeMap(){
  const w = innerWidth, wrap = $('#mapwrap');
  if (w > 1180) {
    const p3 = document.querySelectorAll('.pane')[2];
    const left = p3 ? Math.round(p3.getBoundingClientRect().left) : Math.round(w / 2);
    wrap.style.width = (w - left) + 'px';
  } else {
    wrap.style.width = '';
  }
}
function hydrateMapLayers(){
  ensureMap();
  if (!map) return;
  map.invalidateSize();
  paintMap();
  pullIncidents();
  pullTomTomIncidents();
  clearInterval(ttIncInterval);
  ttIncInterval = setInterval(pullTomTomIncidents, 60000);
  checkTomTom();

  if (layerOn.peringatan) pullAlerts();
  if (SAT_IDS.some(id => layerOn[id])) initSatelliteLayers();
  if (layerOn.cuaca) pullWeather();
  if (layerOn.wind) { pullWind(); if (windData && !windVelocityLayer) startWindAnim(); }
  if (layerOn.radar) pullRadar();
  if (layerOn.radarbmkg) pullRadarBmkg();
  if (layerOn.fires) pullFires();
  if (layerOn.air) pullAir();
  if (layerOn.flight) pullFlights();
  if (layerOn.ship) pullShips();
  if (layerOn.transit) pullTransit();
  pullDisaster();
}
function openMap(){
  sizeMap();
  const wrap = $('#mapwrap');
  wrap.classList.add('on');
  wrap.inert = false;
  wrap.setAttribute('aria-hidden', 'false');
  $('#btn-map').setAttribute('aria-expanded', 'true');
  mapOpen = true;
  lastGestEnd = performance.now();
  ensureLeaflet().then(() => {
    if (!mapOpen) return;
    hydrateMapLayers();
    setTimeout(() => { if (map && mapOpen) map.invalidateSize(); }, 380);
  }).catch(() => {
    const mEl = $('#map');
    if (mEl && !map) mEl.innerHTML = '<div class="empty">Leaflet gagal dimuat. Cek koneksi ke CDN.</div>';
  });
  setTimeout(() => $('#map-close').focus(), 60);
}
addEventListener('resize', () => { if (mapOpen) { sizeMap(); if (map) map.invalidateSize(); } });
function closeMap(){
  const wrap = $('#mapwrap');
  wrap.classList.remove('on');
  wrap.inert = true;
  wrap.setAttribute('aria-hidden', 'true');
  $('#btn-map').setAttribute('aria-expanded', 'false');
  mapOpen = false;
  clearInterval(ttIncInterval);
  stopRadarInterval();

  if (radarSwapTimer) { clearTimeout(radarSwapTimer); radarSwapTimer = null; }
  radarPendingLayer = null;
  stopWindAnim();
  try { drawGlobe(); } catch (e) {}
  $('#btn-map').focus();
}
$('#btn-map').addEventListener('click', () => { if (mapOpen) closeMap(); else openMap(); });
$('#map-close').addEventListener('click', closeMap);
$$('.mly').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.layer;
  if (k === 'rute') {
    routeMode = !routeMode;
    layerOn.rute = routeMode;
    if (routeLayer) { if (routeMode && !map.hasLayer(routeLayer)) map.addLayer(routeLayer); if (!routeMode && map.hasLayer(routeLayer)) map.removeLayer(routeLayer); }
    $('#map-route').hidden = !routeMode;
    if (routeMode) rpOut('Mode rute: klik peta untuk titik A, lalu titik B.');
    b.setAttribute('aria-pressed', routeMode ? 'true' : 'false');
    return;
  }
  if (k === 'lalin') {
    flowMode = !flowMode;
    layerOn.lalin = flowMode;
    b.setAttribute('aria-pressed', flowMode ? 'true' : 'false');
    const fh = $('#flow-hint');
    if (fh) fh.hidden = !flowMode;
    if (map) map.getContainer().style.cursor = flowMode ? 'crosshair' : '';
    if (flowMode && !ttOk) checkTomTom();
    if (!flowMode && map) {
      if (flowProbe) { map.removeLayer(flowProbe); flowProbe = null; }
      if (flowLine) { try { map.removeLayer(flowLine); } catch (e) {} flowLine = null; }
    }
    return;
  }
  layerOn[k] = !layerOn[k];
  b.setAttribute('aria-pressed', layerOn[k] ? 'true' : 'false');
  if ((k === 'ttflow' || k === 'ttinc') && layerOn[k]) checkTomTom();
  if (k === 'ttinc') {
    layerOn.ttdata = layerOn.ttinc;
    const db = document.querySelector('[data-layer="ttdata"]');
    if (db) db.setAttribute('aria-pressed', layerOn.ttdata ? 'true' : 'false');
    if (layerOn.ttdata) pullTomTomIncidents();
  }
  if (k === 'ttdata' && layerOn[k]) pullTomTomIncidents();
  if (k === 'flight' && layerOn[k]) pullFlights();
  if (k === 'ship' && layerOn[k]) pullShips();
  if (k === 'transit' && layerOn[k]) pullTransit();
  if ((k === 'gempa' || k === 'gunung' || k === 'tma') && layerOn[k]) { pullDisaster().then(() => { try { drawGlobe(performance.now()); } catch (e) {} }); }
  if (k === 'cuaca' && layerOn[k]) pullWeather();
  if (k === 'wind') { if (layerOn[k]) { pullWind().then(() => startWindAnim()); } else { stopWindAnim(); } }
  if (k === 'radar') { if (layerOn[k]) { pullRadar(); } else { stopRadarInterval(); clearRadarCache(); radarLayer = null; const ctrl=$('#radar-ctrl'); if(ctrl) ctrl.hidden=true; } }
  if (k === 'fires') { if (layerOn[k]) pullFires(); fireRefresh(); }
  if (k === 'air' && layerOn[k]) pullAir();
  if (SAT_IDS.includes(k)) {
    setSatExclusive(layerOn[k] ? k : null);
    if (layerOn[k] && !satIrLayer) initSatelliteLayers();
    return;
  }
  if (k === 'radarbmkg' && layerOn[k]) pullRadarBmkg();
  if (k === 'basemap-sat' || k === 'sentinel2') {
    const turnOn = layerOn[k];
    const other = k === 'basemap-sat' ? 'sentinel2' : 'basemap-sat';
    if (turnOn) {
      layerOn[other] = false;
      const ob = document.querySelector(`[data-layer="${other}"]`);
      if (ob) ob.setAttribute('aria-pressed', 'false');
    }
    if (k === 'basemap-sat') {
      paintMapSrc();
      syncLayers();
      return;
    }
    if (layerOn.sentinel2) {
      if (!s2StatusText) s2StatusText = 'Copernicus S2: memuat status…';
      paintMapSrc();
      syncLayers();
      checkCopernicus().then(ok => {
        if (!ok) {
          layerOn.sentinel2 = false;
          b.setAttribute('aria-pressed', 'false');
          s2FlashUntil = Date.now() + 6000;
          paintMapSrc();
        } else {
          s2FlashUntil = 0;
          if (sentinel2Layer) sentinel2Layer.setUrl(s2TileUrl());
          paintMapSrc();
        }
        syncLayers();
      });
    } else {
      paintMapSrc();
      syncLayers();
    }
    return;
  }
  if (k === 'peringatan') { if (layerOn[k]) pullAlerts(); else if (peringatanLayer && map && map.hasLayer(peringatanLayer)) map.removeLayer(peringatanLayer); }  syncLayers();
  syncLayers();
}));
const PLANE_SVG = '<svg viewBox="0 0 240 240" width="100%" height="100%">' +
'<g fill="currentColor" stroke="#06222b" stroke-width="4" stroke-linejoin="round">' +
'<path d="M114 191 73 214v7l43-8z"/><path d="M126 191l53 23v7l-43-8z"/>' +
'<path d="M109 78 21 138l-6 13 6 2 9-9 46-11 33-6z"/><path d="M131 78l88 60 6 13-6 2-9-9-46-11-33-6z"/>' +
'<path d="M72 74c0-4 16-4 16 0v22c0 3-14 3-15 0z"/><path d="M152 74c0-4 16-4 16 0v22c0 3-14 3-15 0z"/>' +
'<path d="M120 13c8 0 11 19 11 41v104c0 26-7 54-11 67-4-13-11-41-11-67V54c0-22 3-41 11-41z"/>' +
'</g>' +
'<path d="M112.5 31c2.5-4.5 12.5-4.5 15 0l-1.5 4c-2.5-3-9.5-3-12 0z" fill="#06222b"/>' +
'</svg>';
const SHIP_SVG = '<svg viewBox="0 0 64 64" width="100%" height="100%"><circle cx="32" cy="32" r="30.5" fill="none" stroke="#0b1526" stroke-width="1" stroke-dasharray="3 2" opacity=".5"/>' +
'<path d="M32 5C37.8 8 44 13.8 44 20.5v34c0 3.7-3 6-6.8 6H26.8c-3.8 0-6.8-2.3-6.8-6v-34C20 13.8 26.2 8 32 5z" fill="currentColor" stroke="#06222b" stroke-width="2" stroke-linejoin="round"/>' +
'<rect x="18.6" y="21" width="1.6" height="27" rx=".7" fill="#06222b"/><rect x="43.8" y="21" width="1.6" height="27" rx=".7" fill="#06222b"/>' +
'<g fill="#dfe7ef" stroke="#06222b" stroke-width=".8">' +
'<rect x="24" y="16.5" width="6.2" height="5" rx=".8"/><rect x="33.8" y="16.5" width="6.2" height="5" rx=".8"/>' +
'<rect x="24" y="24" width="6.2" height="5" rx=".8"/><rect x="33.8" y="24" width="6.2" height="5" rx=".8"/>' +
'<rect x="24" y="34.5" width="6.2" height="5" rx=".8"/><rect x="33.8" y="34.5" width="6.2" height="5" rx=".8"/>' +
'<rect x="24" y="42" width="6.2" height="5" rx=".8"/><rect x="33.8" y="42" width="6.2" height="5" rx=".8"/></g>' +
'<rect x="31.1" y="12" width="1.8" height="38" fill="#dfe7ef" stroke="#06222b" stroke-width=".6"/>' +
'<circle cx="32" cy="31.8" r="2.2" fill="#dfe7ef" stroke="#06222b" stroke-width=".9"/>' +
'<line x1="32" y1="31.8" x2="41.5" y2="27.5" stroke="#06222b" stroke-width="1.8" stroke-linecap="round"/>' +
'<rect x="22.5" y="50" width="19" height="7.2" rx="1.4" fill="#dfe7ef" stroke="#06222b" stroke-width="1"/>' +
'<rect x="29.5" y="54" width="5" height="2.4" rx=".5" fill="#06222b"/></svg>';
const BUS_SVG = '<svg viewBox="0 0 64 64" width="100%" height="100%">' +
'<path d="M22 13.5 18.8 12.2v2.2L22 15z" fill="#06222b"/><path d="M42 13.5 45.2 12.2v2.2L42 15z" fill="#06222b"/>' +
'<rect x="22" y="7" width="20" height="50" rx="3.6" fill="currentColor" stroke="#06222b" stroke-width="2.5"/>' +
'<path d="M24 12.8C24 9.8 26.8 8.6 32 8.6s8 1.2 8 4.2l-1.2 1.7c-2.6-.9-11-.9-13.6 0z" fill="#06222b" stroke="#dfe7ef" stroke-width=".7"/>' +
'<rect x="25.5" y="53.6" width="13" height="2" rx=".8" fill="#06222b" opacity=".85"/>' +
'<g fill="#dfe7ef" stroke="#06222b" stroke-width=".8">' +
'<rect x="25.2" y="19" width="13.6" height="8.5" rx="1.4"/><rect x="25.2" y="37.5" width="13.6" height="8.5" rx="1.4"/></g>' +
'<line x1="27.5" y1="21.8" x2="36.5" y2="21.8" stroke="#06222b" stroke-width=".7"/><line x1="27.5" y1="24.6" x2="36.5" y2="24.6" stroke="#06222b" stroke-width=".7"/>' +
'<circle cx="29.2" cy="41.7" r="2.1" fill="none" stroke="#06222b" stroke-width=".7"/><circle cx="34.8" cy="41.7" r="2.1" fill="none" stroke="#06222b" stroke-width=".7"/>' +
'<line x1="41.6" y1="15.5" x2="41.6" y2="19.5" stroke="#dfe7ef" stroke-width="1.3"/><line x1="41.6" y1="31.5" x2="41.6" y2="35.5" stroke="#dfe7ef" stroke-width="1.3"/>' +
'</svg>';
const mkSize = () => { const s = Math.pow(1.32, (map ? map.getZoom() : 10) - 10); return Math.max(12, Math.min(46, Math.round(22 * s))); };
const busSize = () => { const s = Math.pow(1.2, (map ? map.getZoom() : 11) - 11); return Math.max(11, Math.min(26, Math.round(14 * s))); };
const dirIc = (kind, hdg, color) => { const sz = kind === 'bus' ? busSize() : mkSize(); return L.divIcon({ className: 'mk-ic', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  html: `<div class="mk-rot mk-${kind}" style="transform:rotate(${hdg || 0}deg);color:${color || ''}">${{plane: PLANE_SVG, ship: SHIP_SVG, bus: BUS_SVG}[kind]}</div>` }); };

function moverTick(){
  if (!mapOpen || document.hidden) return;
  const now = Date.now();
  for (const store of [moverFl, moverSh]) {
    for (const v of store.values()) {
      if (!v.m || v.done) continue;
      let k = (now - v.t0) / v.dur; if (k > 1) k = 1;
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      v.m.setLatLng([v.fl + (v.tl - v.fl) * e, v.fo + (v.to - v.fo) * e]);
      if (k >= 1) { v.fl = v.tl; v.fo = v.to; v.done = true; }
    }
  }
}
setInterval(moverTick, 400);
function moverSet(store, key, m, lat, lon){
  let v = store.get(key);
  if (!v) { store.set(key, { m, fl: lat, fo: lon, tl: lat, to: lon, t0: Date.now(), dur: 1, done: true }); return; }
  if (v.m !== m) { v.m = m; v.fl = lat; v.fo = lon; v.tl = lat; v.to = lon; v.done = true; return; }
  if (v.tl === lat && v.to === lon) return;
  v.fl = v.done ? v.tl : v.fl + (v.tl - v.fl) * Math.min(1, (Date.now() - v.t0) / v.dur);
  v.fo = v.done ? v.to : v.fo + (v.to - v.fo) * Math.min(1, (Date.now() - v.t0) / v.dur);
  v.tl = lat; v.to = lon; v.t0 = Date.now(); v.dur = 25000; v.done = false;
}
const flMarkers = new Map(), shMarkers = new Map();
const moverFl = new Map(), moverSh = new Map();
const flPop = f => `<div class="mp-k" style="color:#7cc7ff">Penerbangan · ADS-B</div>
  <div class="mp-t">${esc(f.cs)}</div>
  <div class="mp-m">alt ${f.alt != null ? f.alt + ' m' : '—'} · ${f.gs != null ? f.gs + ' km/j' : '—'} · hdg ${f.hdg != null ? f.hdg + '°' : '—'}${f.type ? ' · ' + esc(f.type) : ''}</div>`;
const shPop = s => `<div class="mp-k" style="color:#4dd0e1">Kapal · AIS</div>
  <div class="mp-t">${esc(s.name || s.mmsi)}</div>
  <div class="mp-m">${esc(s.dest || 'tujuan ?')} · ${s.sog != null ? s.sog + ' kn' : '—'}${s.type ? ' · ' + esc(s.type) : ''}</div>`;
async function pullFlights(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await getJson(API + '/api/flights', 25000);
    if (!d.ok) return;
    if (!flightLayer) flightLayer = L.layerGroup().addTo(map);
    const seen = new Set();
    for (const f of (d.items || [])) {
      const key = f.cs || (f.lat + ',' + f.lon);
      seen.add(key);
      let m = flMarkers.get(key);
      if (!m) {
        m = L.marker([f.lat, f.lon], { icon: dirIc('plane', f.hdg, '#7cc7ff'), keyboard: false });
        m._hdg = f.hdg;
        m.bindPopup(flPop(f), { maxWidth: 260 });
        flightLayer.addLayer(m); flMarkers.set(key, m);
        moverSet(moverFl, key, m, f.lat, f.lon);
      } else {
        m._hdg = f.hdg; m.setIcon(dirIc('plane', f.hdg, '#7cc7ff'));
        m.setPopupContent(flPop(f));
        moverSet(moverFl, key, m, f.lat, f.lon);
      }
    }
    for (const [k, m] of flMarkers) if (!seen.has(k)) { flightLayer.removeLayer(m); flMarkers.delete(k); moverFl.delete(k); }
  } catch (e) {}
}
async function pullShips(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await getJson(API + '/api/ships', 25000);
    if (!d.ok || !d.items) return;
    if (!shipLayer) shipLayer = L.layerGroup().addTo(map);
    const seen = new Set();
    for (const s of d.items) {
      const key = s.mmsi || (s.lat + ',' + s.lon);
      seen.add(key);
      let m = shMarkers.get(key);
      if (!m) {
        m = L.marker([s.lat, s.lon], { icon: dirIc('ship', s.hdg, '#4dd0e1'), keyboard: false });
        m._hdg = s.hdg;
        m.bindPopup(shPop(s), { maxWidth: 260 });
        shipLayer.addLayer(m); shMarkers.set(key, m);
        moverSet(moverSh, key, m, s.lat, s.lon);
      } else {
        m._hdg = s.hdg; m.setIcon(dirIc('ship', s.hdg, '#4dd0e1'));
        m.setPopupContent(shPop(s));
        moverSet(moverSh, key, m, s.lat, s.lon);
      }
    }
    for (const [k, m] of shMarkers) if (!seen.has(k)) { shipLayer.removeLayer(m); shMarkers.delete(k); moverSh.delete(k); }
  } catch (e) {}
}
async function pullTransit(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await getJson(API + '/api/transit', 30000);
    if (!d.ok || !d.items) return;
    if (!transitLayer) transitLayer = L.layerGroup().addTo(map);
    transitLayer.clearLayers();
    const PAL = ['#f1c21b', '#45a3ff', '#4dd0a0', '#ff7a59', '#c792ea', '#6ee7d8', '#ff8fb1', '#a3e635'];
    const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
    const zz = map.getZoom();
    const bb = map.getBounds().pad(0.06);
    const inView = t => t.lat <= bb.getNorth() && t.lat >= bb.getSouth() && t.lon <= bb.getEast() && t.lon >= bb.getWest();
    const hi = zz >= 12;
    let items = d.items;
    if (hi) {
      const ctr = map.getCenter();
      items = items.filter(inView)
        .sort((a, b) => (Math.abs(a.lat - ctr.lat) + Math.abs(a.lon - ctr.lng)) - (Math.abs(b.lat - ctr.lat) + Math.abs(b.lon - ctr.lng)))
        .slice(0, 900);
    }
    for (const t of items) {
      const col = PAL[hash(t.route || t.name || '?') % PAL.length];
      const pop = `<div class="mp-k" style="color:${col}">Transit · ${esc(t.op || 'TransJakarta')}</div>
        <div class="mp-t">${esc(t.route || '?')} ${esc(t.name || '')}</div>
        <div class="mp-m">${esc(t.dest || '')}${t.speed != null ? ' · ' + t.speed + ' km/j' : ''}${t.bearing != null ? ' · hdg ' + Math.round(t.bearing) + '°' : ''}</div>`;
      if (hi) {
        const m = L.marker([t.lat, t.lon], { icon: dirIc('bus', t.bearing || 0, col), keyboard: false });
        m.bindPopup(pop, { maxWidth: 240 });
        transitLayer.addLayer(m);
      } else {
        const rad = Math.max(3, Math.min(9, Math.round((zz - 4) * 0.55)));
        const m = L.circleMarker([t.lat, t.lon], { radius: rad, color: '#101010', weight: 1,
          fillColor: col, fillOpacity: .95 });
        m.bindPopup(pop, { maxWidth: 240 });
        transitLayer.addLayer(m);
      }
    }
  } catch (e) {}
}

const seenGunung = new Map();
const seenTma = new Map();
const LVL_COLOR = { 'LEVEL IV': '#ff3b30', 'LEVEL III': '#ff9f0a', 'LEVEL II': '#ffd60a', 'LEVEL I': '#8d8d8d' };
const LVL_RANK = { 'LEVEL IV': 4, 'LEVEL III': 3, 'LEVEL II': 2, 'LEVEL I': 1 };
const WMO = c => c == null ? '—' : c <= 1 ? 'Cerah' : c <= 3 ? 'Berawan' : c <= 48 ? 'Kabut' : c <= 57 ? 'Hujan gerimis' : c <= 67 ? 'Hujan' : c <= 77 ? 'Salju' : c <= 82 ? 'Hujan lokal' : c <= 86 ? 'Hujan lebat' : 'Badai';
const WD = d => ['U','TL','T','TR','U','BL','B','BR','U'][Math.round(((d || 0) + 22.5) / 45) % 8];

function wxGlyph(c){
  const k = c == null ? 'cloudy' : c <= 1 ? 'clear-day' : c <= 3 ? 'partly-cloudy-day' : c <= 48 ? 'fog'
    : c <= 57 ? 'drizzle' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'overcast-rain'
    : c <= 86 ? 'thunder-rain' : 'thunderstorms';
  return WX_ICON[k] || WX_ICON.cloudy;
}
const wxSize = () => { const s = Math.pow(1.3, (map ? map.getZoom() : 10) - 10); return Math.max(36, Math.min(90, Math.round(40 * s))); };
const wxIcon = (code, col) => { const sz = wxSize(); return L.divIcon({ className: 'mk-cuaca-ic',
  iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  html: `<div class="mk-cuaca" style="--wc:${col}">${wxGlyph(code)}</div>` }); };
const wibDayStart = () => { const j = new Date(Date.now() + 7 * 3600e3); j.setUTCHours(0, 0, 0, 0); return j.getTime() - 7 * 3600e3; };
async function pullDisaster(){
  if (API == null) return;
  try {
    const d = await getJson(API + '/api/disaster', 30000);
    if (!d.ok) { if (!geoDisLoaded) { geoDisLoaded = true; renderGeoTelemetry(); } return; }
    const today = wibDayStart();
    const dp = [];
    const gempaMarkers = [], gunungMarkers = [];
    for (const g of (d.gempa || [])) {
      const gts = Date.parse(g.time) || 0;
      if (!gts || Date.now() - gts > 24 * 3600e3) continue;
      const key = (g.time || gts || '') + '|' + g.lat.toFixed(2) + ',' + g.lon.toFixed(2);
      const mag = typeof g.mag === 'number' ? g.mag : parseFloat(g.mag) || 0;
      let magCol = '#e5a000', magClass = 'MINOR / RINGAN';
      if (mag >= 6.0) { magCol = '#ff3b30'; magClass = 'KUAT / MAJOR'; }
      else if (mag >= 5.0) { magCol = '#ff6b5e'; magClass = 'SEDANG / MODERAT'; }
      else if (mag >= 4.0) { magCol = '#ff9f0a'; magClass = 'RINGAN'; }

      const dNum = parseFloat(String(g.depth || '').replace(/[^\d.]/g, '')) || 10;
      let depCol = '#00e5ff', depClass = 'KERAK DANGKAL';
      if (dNum > 300) { depCol = '#94a3b8'; depClass = 'SANGAT DALAM'; }
      else if (dNum > 60) { depCol = '#a78bfa'; depClass = 'MENENGAH'; }
      else if (dNum <= 15) { depCol = '#00e5ff'; depClass = 'SANGAT DANGKAL'; }

      const potStr = String(g.potensi || '');
      const isTsunamiWarn = /berpotensi tsunami/i.test(potStr) && !/tidak berpotensi/i.test(potStr);
      const isNoTsunami = /tidak berpotensi tsunami/i.test(potStr);

      let bannerHtml = '';
      if (isTsunamiWarn) {
        bannerHtml = `<div class="mp-hud-banner banner-danger"><span>⚠ POTENSI TSUNAMI</span><span style="font-size:7px;font-weight:700">WASPADA TINGGI</span></div>`;
      } else if (isNoTsunami) {
        bannerHtml = `<div class="mp-hud-banner banner-safe"><span>✓ TIDAK BERPOTENSI TSUNAMI</span><span style="font-size:7px;opacity:.8">TEWS CLEAR</span></div>`;
      } else {
        bannerHtml = `<div class="mp-hud-banner banner-info"><span>INFORMASI SEISMIK BMKG</span><span style="font-size:7px;opacity:.8">TEWS INFO</span></div>`;
      }

      const timeStr = gts ? new Date(gts).toLocaleTimeString('id-ID', { timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit' }) + ' WIB' : '—';
      const mntDiff = gts ? Math.max(0, Math.round((Date.now() - gts) / 60e3)) : 0;
      const age = gts ? (mntDiff < 60 ? mntDiff + ' mnt lalu' : Math.round(mntDiff / 60) + ' jam lalu') : '—';

      const locMain = g.wilayah || 'Episenter Gempa';
      const locSub = `${g.lat.toFixed(2)}°, ${g.lon.toFixed(2)}° · Kedalaman ${esc(g.depth || dNum + ' km')}`;
      const mmiHtml = g.mmi ? `<span style="color:${magCol}"><b>${esc(g.mmi)}</b></span>` : `<span>MMI: —</span>`;
      const tagTxt = g.mmi ? 'DIRASAKAN' : (isTsunamiWarn ? 'PERINGATAN' : 'AUTOGEMPA');
      const tagStyle = g.mmi ? `color:${magCol};border-color:${magCol}55` : (isTsunamiWarn ? `color:#ff3b30;border-color:#ff3b3055` : '');

      const gs = 1 + Math.min(1.6, (g.mag || 3) * 0.28);
      if (mapOpen) {
        const m = L.marker([g.lat, g.lon], { keyboard: false, icon: L.divIcon({ className: 'mk-gempa-ic',
          iconSize: [64, 64], iconAnchor: [32, 32],
          html: `<div class="mk-gempa" style="--mc:${magCol};--gs:${gs.toFixed(2)}"><i class="mk-rip"></i><i class="mk-rip r2"></i><i class="mk-rip r3"></i><b class="mk-gempa-dot"></b></div>` }) });
        m.bindPopup(
          `<div class="mp-hud-card">
            <div class="mp-hud-head">
              <span class="mp-k" style="color:${magCol}"><span class="mp-pulse-dot" style="color:${magCol}"></span>GEMPA BUMI · BMKG</span>
              <span class="mp-hud-tag"${tagStyle ? ` style="${tagStyle}"` : ''}>${tagTxt}</span>
            </div>
            <div class="mp-hud-grid">
              <div class="mp-hud-box" style="--box-c:${magCol}">
                <span class="mp-hud-lbl">MAGNITUDE</span>
                <div class="mp-hud-hero-val">${mag.toFixed(1)} <span>SR</span></div>
                <span class="mp-hud-class">${magClass}</span>
              </div>
              <div class="mp-hud-box" style="--box-c:${depCol}">
                <span class="mp-hud-lbl">KEDALAMAN</span>
                <div class="mp-hud-hero-val">${dNum} <span>KM</span></div>
                <span class="mp-hud-class">${depClass}</span>
              </div>
            </div>
            ${bannerHtml}
            <div class="mp-hud-loc">
              <div class="mp-hud-loc-main">${esc(locMain)}</div>
              <div class="mp-hud-loc-sub">${locSub}</div>
            </div>
            <div class="mp-hud-foot">
              <span>${timeStr} · ${age}</span>
              ${mmiHtml}
            </div>
          </div>`);
        m.bindTooltip(`M${g.mag}`, { direction: 'top', offset: [0, -18], opacity: .9 });
        gempaMarkers.push(m);
      }
      dp.push({ kind: 'gempa', sub: 'gempa', la: g.lat, lo: g.lon, ts: gts,
        eid: 'bmkg:gempa:' + key,
        title: `M${g.mag} · ${g.wilayah || ''}`, name: g.wilayah || 'Gempa', label: 'GEMPA BMKG',
        src: 'BMKG', url: 'bmkg://gempa/' + key, weight: Math.min(1, (g.mag || 3) / 6), mag: g.mag || 3 });
    }
    for (const p of (PULSE || [])) {
      if (p.sub !== 'gempa' || p.fixed || typeof p.la !== 'number' || typeof p.lo !== 'number') continue;
      if (mapOpen) {
        const m = L.marker([p.la, p.lo], { keyboard: false, icon: L.divIcon({ className: 'mk-gempa-ic',
          iconSize: [56, 56], iconAnchor: [28, 28],
          html: `<div class="mk-gempa" style="--mc:#ff3b30;--gs:1.4"><i class="mk-rip"></i><i class="mk-rip r2"></i><i class="mk-rip r3"></i><b class="mk-gempa-dot"></b></div>` }) });
        const wireTime = p.ts ? wibTime(p.ts) : '—';
        m.bindPopup(
          `<div class="mp-hud-card">
            <div class="mp-hud-head">
              <span class="mp-k" style="color:#ff6b5e"><span class="mp-pulse-dot" style="color:#ff6b5e"></span>GEMPA · WIRE NEWS</span>
              <span class="mp-hud-tag">UNVERIFIED</span>
            </div>
            <div class="mp-hud-banner banner-info">
              <span>LAPORAN DINI MEDIA MASSA</span>
              <span style="font-size:7px;opacity:.8">WIRE</span>
            </div>
            <div class="mp-hud-loc">
              <div class="mp-hud-loc-main">${esc(cleanTitle(deEmoji(p.title || p.name || 'Gempa'), p.pub || p.src))}</div>
              <div class="mp-hud-loc-sub">${p.la.toFixed(2)}°, ${p.lo.toFixed(2)}° · ${esc(cleanSrc(p.src, p.pub))}</div>
            </div>
            <div class="mp-hud-foot">
              <span>${esc(wireTime)}</span>
              <span>${esc(cleanSrc(p.src, p.pub))}</span>
            </div>
          </div>`);
        m.bindTooltip('Gempa (berita)', { direction: 'top', offset: [0, -16], opacity: .9 });
        gempaMarkers.push(m);
      }
    }
    for (const v of (d.gunung || [])) {
      if (v.lat == null) continue;
      if ((LVL_RANK[v.level] || 0) < 3) continue;
      const col = LVL_COLOR[v.level] || '#8d8d8d';
      const prev = seenGunung.get(v.name);
      const worse = prev != null && (LVL_RANK[v.level] || 0) > (LVL_RANK[prev] || 0);
      const escalate = worse || prev == null;
      seenGunung.set(v.name, v.level);
      const sz = v.level === 'LEVEL IV' ? 26 : v.level === 'LEVEL III' ? 23 : 20;
      if (mapOpen) {
        const m = L.marker([v.lat, v.lon], { keyboard: false, icon: L.divIcon({ className: 'mk-gunung-ic',
          iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
          html: `<div class="mk-gunung" style="--gc:${col};--gs:${(sz / 22).toFixed(2)}"><svg viewBox="0 0 16 16"><path d="M8 1.4 14.6 13.2H1.4Z" fill="var(--gc)" stroke="#101010" stroke-width="1.5" stroke-linejoin="round"/></svg></div>` }) });
        m.bindPopup(`<div class="mp-k" style="color:${col}">GUNUNG API · MAGMA/PVMBG</div>
          <div class="mp-t">${esc(v.name)} — ${esc(v.loc || '')}</div>
          <div class="mp-m">${esc(v.level)} (${esc(v.status)})</div>`);
        m.bindTooltip(`${esc(v.name)} · ${v.level}`, { direction: 'top', offset: [0, -sz / 2 - 3], opacity: .85 });
        gunungMarkers.push(m);
      }
      dp.push({ kind: 'gunung', sub: 'volcano', lvl: v.level, la: v.lat, lo: v.lon,
        ts: escalate ? Date.now() : today,
        title: `${v.name} — ${v.level} (${v.status})`, name: v.name, label: 'GUNUNG API ' + v.level,
        src: 'MAGMA/PVMBG', url: 'magma://' + v.name + '/' + v.level, weight: .55 });
    }
    const pb = d.floods || {};
    const pbAreas = Array.isArray(pb.areas) ? pb.areas : [];
    const pbReports = Array.isArray(pb.reports) ? pb.reports : [];
    if (!(d.gempa || []).length && !(d.gunung || []).length && !(d.tma || []).length && !pbAreas.length && !pbReports.length && (DIS_PULSE || []).length) return;
    const tmaMarkers = [];
    for (const g of (d.tma || [])) {
      if (typeof g.lat !== 'number' || typeof g.lon !== 'number') continue;
      const siaga = Number(g.siaga || 4);
      const col = siaga === 1 ? '#ff3b30' : siaga === 2 ? '#ff9500' : siaga === 3 ? '#ffd60a' : '#00e5ff';
      const isDanger = siaga <= 2;
      const sz = isDanger ? 28 : 22;
      if (siaga <= 3) {
        const tmaKey = String(g.id || g.name || '');
        const prevSiaga = seenTma.get(tmaKey);
        const escalate = prevSiaga == null ? isDanger : siaga < prevSiaga;
        seenTma.set(tmaKey, siaga);
        dp.push({
          kind: 'flood',
          sub: 'tma',
          siaga,
          ketinggian: g.ketinggian,
          la: g.lat,
          lo: g.lon,
          ts: escalate ? Date.now() : today,
          eid: 'tma:' + tmaKey + ':s' + siaga,
          title: `${g.name} — ${g.siaga_label || ('Siaga ' + siaga)} (${g.ketinggian} cm)`,
          name: g.name,
          label: 'PINTU AIR · ' + (g.siaga_label || ('SIAGA ' + siaga)).toUpperCase(),
          src: 'DSDA DKI',
          url: 'https://pantaubanjir.jakarta.go.id/',
          weight: siaga === 1 ? 0.95 : siaga === 2 ? 0.8 : 0.55
        });
      }
      if (mapOpen) {
        const ic = L.divIcon({
          className: 'mk-tma-ic',
          iconSize: [sz, sz],
          iconAnchor: [sz / 2, sz / 2],
          html: `<div class="mk-tma" style="--tc:${col};width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;background:#10141a;border:2px solid ${col};border-radius:50%;color:${col};font:700 9px var(--mono);box-shadow:0 0 8px ${col}66"><span>${g.ketinggian}</span></div>`
        });
        const m = L.marker([g.lat, g.lon], { keyboard: false, icon: ic });
        m.bindPopup(
          `<div class="mp-hud-card">
            <div class="mp-hud-head">
              <span class="mp-k" style="color:${col}"><span class="mp-pulse-dot" style="color:${col}"></span>PINTU AIR · DSDA DKI</span>
              <span class="mp-hud-tag" style="color:${col};border-color:${col}55">${esc(g.siaga_label || 'Siaga ' + siaga)}</span>
            </div>
            <div class="mp-hud-grid">
              <div class="mp-hud-box" style="--box-c:${col}">
                <span class="mp-hud-lbl">KETINGGIAN AIR</span>
                <div class="mp-hud-hero-val">${g.ketinggian} <span>CM</span></div>
                <span class="mp-hud-class">${esc(g.sistem || 'Aliran')}</span>
              </div>
              <div class="mp-hud-box" style="--box-c:#9adcff">
                <span class="mp-hud-lbl">KONDISI CUACA</span>
                <div class="mp-hud-hero-val" style="font-size:14px">${esc(g.cuaca || 'Terang')}</div>
                <span class="mp-hud-class">${esc(g.jam || '')} WIB</span>
              </div>
            </div>
            <div class="mp-hud-foot">
              <span><b>${esc(g.name)}</b></span>
              <span>${esc(g.tanggal || '')}</span>
            </div>
          </div>`, { maxWidth: 280, keepInView: true });
        m.bindTooltip(`${esc(g.name)}: ${g.ketinggian}cm (${esc(g.siaga_label)})`, { direction: 'top', offset: [0, -sz / 2 - 2], opacity: .9 });
        tmaMarkers.push(m);
      }
    }
    for (const a of pbAreas) {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      const st = Number(a.state || 1);
      const col = st >= 4 ? '#ff3b30' : st === 3 ? '#ff9500' : st === 2 ? '#ffd60a' : '#4589ff';
      dp.push({
        kind: 'flood',
        sub: 'flood',
        state: st,
        la: a.lat,
        lo: a.lon,
        ts: a.ts || Date.now(),
        eid: 'pb-area:' + (a.id || a.name) + ':s' + st,
        title: `Genangan Banjir ${a.name}${a.city ? ' (' + a.city + ')' : ''} — Level ${st}`,
        name: a.name,
        label: 'BANJIR · PETABENCANA',
        src: 'PetaBencana.id',
        url: 'https://petabencana.id/',
        weight: st >= 4 ? 0.92 : st === 3 ? 0.78 : 0.55
      });
      if (mapOpen && a.geometry) {
        const poly = L.geoJSON(a.geometry, {
          style: { color: col, weight: 1.5, fillColor: col, fillOpacity: 0.24 }
        });
        poly.bindPopup(`<div class="mp-k" style="color:${col}">GENANGAN BANJIR · PETABENCANA.ID</div>
          <div class="mp-t">${esc(a.name)}${a.city ? ' — ' + esc(a.city) : ''}</div>
          <div class="mp-m">${esc(a.parent || '')} · Siaga Level ${st}</div>`);
        tmaMarkers.push(poly);
      }
    }
    for (const r of pbReports) {
      if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
      const st = Number(r.state || 1);
      dp.push({
        kind: 'flood',
        sub: 'flood',
        state: st,
        depth: r.depth || 0,
        la: r.lat,
        lo: r.lon,
        ts: r.ts || Date.now(),
        eid: 'pb-rep:' + (r.id || (r.lat + ',' + r.lon + ',' + r.ts)),
        title: r.depth ? `${r.title} (${r.depth} cm)` : r.title,
        name: r.src || 'PetaBencana',
        label: 'LAPORAN BANJIR',
        src: 'PetaBencana.id',
        url: r.url || 'https://petabencana.id/',
        weight: st >= 3 ? 0.78 : 0.52
      });
      if (mapOpen) {
        const cm = L.circleMarker([r.lat, r.lon], {
          radius: st >= 3 ? 7 : 5,
          color: '#0d0d0d',
          weight: 1.2,
          fillColor: '#4589ff',
          fillOpacity: 0.88
        });
        cm.bindPopup(`<div class="mp-k" style="color:#4589ff">LAPORAN BANJIR · PETABENCANA.ID</div>
          <div class="mp-t">${esc(r.title)}${r.depth ? ' (' + r.depth + ' cm)' : ''}</div>
          <div class="mp-m">${esc(r.text || '')}</div>`);
        cm.bindTooltip(`${esc(r.title)}${r.depth ? ' · ' + r.depth + ' cm' : ''}`, { direction: 'top', offset: [0, -6], opacity: .9 });
        tmaMarkers.push(cm);
      }
    }
    DIS_PULSE = dp;
    geoDisLoaded = true;
    renderGeoTelemetry();
    if (SIT) renderMapLegend({ ...(SIT.stats || {}),
      flood: ((SIT.stats && SIT.stats.flood) || 0) + dp.filter(p => p.kind === 'flood').length,
      gempa: dp.filter(p => p.sub === 'gempa').length,
      gunung: dp.filter(p => p.sub === 'volcano').length });
    try { drawGlobe(performance.now()); } catch (e) {}
    maybeFocusFresh();

    if (map && mapOpen) {
      if (layerOn.gempa) {
        if (!gempaLayer) gempaLayer = L.layerGroup().addTo(map);
        gempaLayer.clearLayers();
        for (const m of gempaMarkers) gempaLayer.addLayer(m);
      } else if (gempaLayer) { gempaLayer.clearLayers(); }
      if (layerOn.gunung) {
        if (!gunungLayer) gunungLayer = L.layerGroup().addTo(map);
        gunungLayer.clearLayers();
        for (const m of gunungMarkers) gunungLayer.addLayer(m);
      } else if (gunungLayer) { gunungLayer.clearLayers(); }
      if (layerOn.tma) {
        if (!tmaLayer) tmaLayer = L.layerGroup().addTo(map);
        tmaLayer.clearLayers();
        for (const m of tmaMarkers) tmaLayer.addLayer(m);
      } else if (tmaLayer) { tmaLayer.clearLayers(); }
      syncLayers();
    }
  } catch (e) {
    geoDisLoaded = true;
    renderGeoTelemetry();
  }
}
async function pullWeather(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await getJson(API + '/api/weather', 30000);
    if (!d.ok) return;
    if (!wxLayer) wxLayer = L.layerGroup().addTo(map);
    wxLayer.clearLayers();
    for (const w of (d.items || [])) {
      const wind = w.wind != null ? Math.round(w.wind) + ' km/j ' + WD(w.wdir) : '—';
      const sevCol = (w.wind >= 40 || (w.precip||0) >= 10) ? '#ff5722'
        : (w.code != null && w.code <= 1) ? '#ffb020'
        : (w.wind >= 25 ? '#ff9800' : '#38bdf8');
      const m = L.marker([w.lat, w.lon], { keyboard: false, icon: wxIcon(w.code, sevCol) });
      m._wx = { code: w.code, col: sevCol };
      m.bindPopup(`<div class="mp-k" style="color:#9adcff">CUACA · Open-Meteo</div>
        <div class="mp-t">${WMO(w.code)} · ${w.temp != null ? Math.round(w.temp) + '°C' : '—'}</div>
        <div class="mp-m">angin ${wind} · gust ${w.gust != null ? Math.round(w.gust)+' km/j' : '—'}<br>
          awan ${w.cloud != null ? Math.round(w.cloud)+'%' : '—'} · hujan ${w.precip != null ? w.precip+' mm' : '—'} (prob ${w.precipProb != null ? Math.round(w.precipProb)+'%' : '—'})<br>
          tekanan ${w.pressure != null ? Math.round(w.pressure)+' hPa' : '—'} · RH ${w.humidity != null ? Math.round(w.humidity)+'%' : '—'} · vis ${w.visibility != null ? (w.visibility/1000).toFixed(1)+' km' : '—'}</div>`);
      m.bindTooltip(`${w.temp != null ? Math.round(w.temp) + '°' : ''} ${wind}`, { direction: 'top', opacity: .8 });
      wxLayer.addLayer(m);
    }
  } catch (e) {}
}

function initLeafletWms(){
  if (typeof L === 'undefined' || L.TileLayer.WMS) return;
  L.TileLayer.WMS = L.TileLayer.extend({
    defaultUrl: '',
    initialize: function (url, options) {
      options = L.setOptions(this, options);
      this._url = url;
      this._params = L.Util.extend({
        SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
        LAYERS: options.layers || '', STYLES: options.styles || '',
        FORMAT: options.format || 'image/png', TRANSPARENT: options.transparent === false ? 'false' : 'true',
        CRS: 'EPSG:3857'
      }, options.params || {});
      L.TileLayer.prototype.initialize.call(this, url, options);
    },
    getTileUrl: function (coords) {

      const z = this._zoom != null ? this._zoom : (this._map ? this._map.getZoom() : 5);
      const n = Math.pow(2, z), W = 2 * Math.PI * 6378137;
      const ts = this.getTileSize ? this.getTileSize().x : 256;
      const mx0 = -W / 2 + (coords.x / n) * W, mx1 = -W / 2 + ((coords.x + 1) / n) * W;
      const my0 = W / 2 - ((coords.y + 1) / n) * W, my1 = W / 2 - (coords.y / n) * W;
      const bbox = [mx0, my0, mx1, my1].join(',');
      return this._url + L.Util.getParamString(L.Util.extend({ BBOX: bbox, WIDTH: ts, HEIGHT: ts }, this._params));
    }
  });
}
async function pullRadar(){
  if (!mapOpen || !map || API == null) return;
  stopRadarInterval();
  const ctrl = $('#radar-ctrl');
  try {
    const d = await getJson(API + '/api/radar', 30000);
    if (!d || !d.ok || !Array.isArray(d.frames) || !d.frames.length) {
      if (ctrl) ctrl.hidden = true;
      return;
    }
    radarFrames = d.frames;
    radarGenerated = Number(d.generated) || 0;
    radarHost = String(d.host || radarHost);
    clearRadarCache();
    radarLayer = null;
    radarIndex = radarFrames.length - 1;
    if (ctrl) ctrl.hidden = false;
    bindRadarControls();
    renderRadarFrame(radarIndex);
    updateRadarControls();
  } catch(e) {
    if (ctrl) ctrl.hidden = true;
  }
}
function stopRadarInterval(){
  if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
  radarPlaying = false;
  const b = $('#radar-play'); if (b) { b.textContent = '▶'; b.setAttribute('aria-pressed', 'false'); }
}
function bindRadarControls(){
  const c = $('#radar-ctrl');
  if (!c || c.__bound) return;
  c.__bound = true;
  $('#radar-play').addEventListener('click', toggleRadarPlayback);
  $('#radar-step-back').addEventListener('click', () => stepRadar(-1));
  $('#radar-step-forward').addEventListener('click', () => stepRadar(1));
  $('#radar-range').addEventListener('input', e => { radarIndex = Number(e.target.value); renderRadarFrame(radarIndex); updateRadarControls(); });
  $('#radar-latest').addEventListener('click', () => { radarIndex = radarFrames.length - 1; renderRadarFrame(radarIndex); updateRadarControls(); });

  if (map && !map.__radarMoveBound) {
    map.__radarMoveBound = true;
    map.on('movestart', () => { if (radarPlaying) { radarWasPlaying = true; setRadarPlaying(false); } });
    map.on('moveend', () => { if (radarWasPlaying) { radarWasPlaying = false; setTimeout(() => setRadarPlaying(true), 400); } });
  }
}
function stepRadar(delta){
  if (!radarFrames.length) return;
  radarIndex = Math.max(0, Math.min(radarFrames.length - 1, radarIndex + delta));
  renderRadarFrame(radarIndex);
  updateRadarControls();
}
function setRadarPlaying(on){
  if (!radarFrames.length) return;
  radarPlaying = !!on;
  const b = $('#radar-play');
  if (b) { b.textContent = radarPlaying ? '❚❚' : '▶'; b.setAttribute('aria-pressed', String(radarPlaying)); }
  if (!radarPlaying) { if (radarTimer) { clearInterval(radarTimer); radarTimer = null; } return; }
  if (radarTimer) clearInterval(radarTimer);
  radarTimer = setInterval(() => {
    radarIndex = (radarIndex + 1) % radarFrames.length;
    renderRadarFrame(radarIndex);
  }, 1200);
}
function toggleRadarPlayback(){
  setRadarPlaying(!radarPlaying);
}
function radarLayerFor(i){
  if (!radarLayerCache[i]) {
    const f = radarFrames[i];
    if (!f) return null;
    radarLayerCache[i] = L.tileLayer(radarHost + f.path + '/256/{z}/{x}/{y}/2/1_1.png', {
      opacity: .55, zIndex: 6, maxZoom: 7, maxNativeZoom: 7, attribution: 'RainViewer'
    });
  }
  return radarLayerCache[i];
}
function clearRadarCache(){
  for (const k in radarLayerCache) { const l = radarLayerCache[k]; if (map && map.hasLayer(l)) map.removeLayer(l); }
  radarLayerCache = {};
  if (radarPendingLayer && map && map.hasLayer(radarPendingLayer)) map.removeLayer(radarPendingLayer);
  radarPendingLayer = null;
  if (radarSwapTimer) { clearTimeout(radarSwapTimer); radarSwapTimer = null; }
}
function renderRadarFrame(i){
  if (!map) return;
  radarIndex = Math.max(0, Math.min(radarFrames.length - 1, i));
  const next = radarLayerFor(radarIndex);
  if (!next) { updateRadarControls(); return; }
  if (radarLayer === next) { updateRadarControls(); return; }
  if (!layerOn.radar) { radarLayer = next; updateRadarControls(); return; }

  if (radarPendingLayer && radarPendingLayer !== next) {
    if (map.hasLayer(radarPendingLayer)) map.removeLayer(radarPendingLayer);
    radarPendingLayer = null;
    if (radarSwapTimer) { clearTimeout(radarSwapTimer); radarSwapTimer = null; }
  }
  const prev = radarLayer;
  radarPendingLayer = next;
  const done = () => {
    if (radarPendingLayer !== next) return;
    radarPendingLayer = null;
    if (radarSwapTimer) { clearTimeout(radarSwapTimer); radarSwapTimer = null; }
    if (prev && map.hasLayer(prev)) map.removeLayer(prev);
    if (!map.hasLayer(next)) map.addLayer(next);
    radarLayer = next;
    radarLayerFor((radarIndex + 1) % Math.max(1, radarFrames.length));
  };
  next.once('load', done);
  radarSwapTimer = setTimeout(done, 1500);
  if (!map.hasLayer(next)) map.addLayer(next);
  updateRadarControls();
}
function updateRadarControls(){
  const range = $('#radar-range'), time = $('#radar-time');
  if (range) { range.max = String(Math.max(0, radarFrames.length - 1)); range.value = String(radarIndex); }
  const f = radarFrames[radarIndex];
  if (time && f) {
    const frameDate = new Date(Number(f.time) * 1000);
    const generated = radarGenerated ? new Date(radarGenerated * 1000) : null;
    const gen = radarGenerated ? new Date(radarGenerated * 1000).toLocaleTimeString('id-ID', {timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit'}) + ' WIB' : '—';
    time.textContent = frameDate.toLocaleString('id-ID', {timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric'}) + ' WIB · frame ' + (radarIndex + 1) + '/' + radarFrames.length + ' · data ' + gen;
  }
}

let windVelocityLayer = null, windData = null;
let velocityRestartPending = false;
let origVelocityClearRestart = null;
function stopVelocityForInteraction(){
  if (!windVelocityLayer) return;
  try { if (windVelocityLayer._windy) windVelocityLayer._windy.stop(); } catch (e) {}
  try { if (windVelocityLayer._context) windVelocityLayer._context.clearRect(0, 0, 3000, 3000); } catch (e) {}
}
function guardedVelocityRestart(){
  const self = this;
  if (velocityRestartPending) return;
  velocityRestartPending = true;
  setTimeout(() => {
    velocityRestartPending = false;
    if (!layerOn.wind || !self) return;
    try { if (origVelocityClearRestart) origVelocityClearRestart.apply(self, []); } catch (e) {}
  }, 0);
}
function patchVelocityPrototype(){
  if (window.__velocityPrototypePatched || typeof L === 'undefined' || !L.VelocityLayer || !L.VelocityLayer.prototype) return;
  if (typeof L.VelocityLayer.prototype._clearAndRestart !== 'function') return;
  origVelocityClearRestart = L.VelocityLayer.prototype._clearAndRestart;
  L.VelocityLayer.prototype._clearAndRestart = guardedVelocityRestart;
  window.__velocityPrototypePatched = true;
}
function bindVelocityInteractionEvents(){
  if (!map || map.__velocityBound) return;
  map.__velocityBound = true;
  patchVelocityPrototype();

  map.on('movestart zoomstart', stopVelocityForInteraction);

  map.on('moveend zoomend dragend', () => {
    if (windVelocityLayer) windVelocityLayer._clearAndRestart();
  });
}
async function pullWind(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await getJson(API + '/api/wind', 30000);
    if (!d.ok || !d.data) return;
    windData = d.data;
    if (layerOn.wind) startWindAnim();
  } catch(e) {}
}
function startWindAnim(){
  if (!map || !windData) return;
  bindVelocityInteractionEvents();
  if (windVelocityLayer && map.hasLayer(windVelocityLayer)) {
    try { windVelocityLayer.setData(windData); } catch(e){}
    return;
  }
  try {
    windVelocityLayer = L.velocityLayer({
      displayValues: true,
      displayOptions: {
        velocityType: 'Angin',
        position: 'bottomleft',
        emptyString: 'Arahkan kursor ke peta',
        angleConvention: 'meteoCCW',
        showCardinal: true,
        speedUnit: 'k/h',
        directionString: 'Arah',
        speedString: 'Kecepatan'
      },
      data: windData,
      minVelocity: 0,
      maxVelocity: 25,
      velocityScale: 0.02,
      particleMultiplier: 1/250,
      opacity: 0.95
    });
    windVelocityLayer.addTo(map);
  } catch(e) {}
}
function stopWindAnim(){
  if (windVelocityLayer && map) {
    try { map.removeLayer(windVelocityLayer); } catch(e){}
  }
  windVelocityLayer = null;
}

async function pullRadarBmkg(){
  if (!mapOpen || !map) return;
  try {
    initLeafletWms();
    if (radarBmkgLayer) { if (map.hasLayer(radarBmkgLayer)) map.removeLayer(radarBmkgLayer); radarBmkgLayer = null; }
    radarBmkgLayer = new L.TileLayer.WMS('https://gis.bmkg.go.id/arcgis/services/Peta_Curah_Hujan_dan_Hari_Hujan_/MapServer/WMSServer', {
      layers: '2', format: 'image/png', transparent: true, version: '1.3.0',
      opacity: .55, zIndex: 4, maxZoom: 18, minZoom: 3,
      attribution: 'BMKG · Curah Hujan'
    });
    if (layerOn.radarbmkg) { map.addLayer(radarBmkgLayer); }
  } catch(e) {}
}

async function pullAlerts(){
  if (!mapOpen || !map || API == null) return;
  try {
    const d = await getJson(API + '/api/alerts', 30000);
    if (!d.ok) return;
    if (!peringatanLayer) peringatanLayer = L.layerGroup().addTo(map);
    peringatanLayer.clearLayers();
    warnAlerts = [];
    const sevColor = { Extreme:'#ff1744', Severe:'#ff5722', Moderate:'#ff9800', Minor:'#ffeb3b', Unknown:'#9e9e9e' };
    const meta = (k, v) => v ? `<div><span>${k}</span><b>${esc(v)}</b></div>` : '';
    const capDate = v => { const t = Date.parse(v || ''); if (isNaN(t)) return v || '';
      const j = new Date(t + 7 * 3600e3), mo = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][j.getUTCMonth()];
      const p = n => String(n).padStart(2, '0');
      return p(j.getUTCDate()) + ' ' + mo + ' · ' + p(j.getUTCHours()) + ':' + p(j.getUTCMinutes()) + ' WIB'; };
    const alertHtml = a => {
      const col = sevColor[a.severity] || '#ff9800';
      return `<div class="mp-k" style="color:${col}">PERINGATAN DINI · BMKG</div>
        <div class="mp-t">${esc(a.headline || a.event || '')}</div>
        <div class="mp-meta">
          ${meta('Severity:', a.severity)}${meta('Urgency:', a.urgency)}${meta('Certainty:', a.certainty)}
          ${meta('Effective:', capDate(a.effective))}${meta('Expires:', capDate(a.expires))}${meta('Area:', a.areaDesc || a.area)}
        </div>
        ${a.description ? `<div class="mp-m" style="text-transform:none;letter-spacing:.01em">${esc(a.description).slice(0,400)}</div>` : ''}
        ${a.web ? `<div class="mp-m"><a href="${escUrl(a.web)}" target="_blank" rel="noopener">info BMKG</a></div>` : ''}`;
    };
    if (!warnRenderer) {

      if (!map.getPane('warnPane')) { const p = map.createPane('warnPane'); p.style.zIndex = 300; }
      warnRenderer = L.svg({ className:'warn-svg', padding:.5, pane:'warnPane' }).addTo(map);
    }
    const svg = warnRenderer._container;
    if (svg && !svg.querySelector('#warnDefs')) {
      const NS = 'http://www.w3.org/2000/svg', defs = document.createElementNS(NS, 'defs');
      defs.id = 'warnDefs';
      for (const [sev, c] of Object.entries(sevColor)) {
        const p = document.createElementNS(NS, 'pattern');
        p.id = 'wh-' + sev; p.setAttribute('patternUnits', 'userSpaceOnUse');
        p.setAttribute('width', '9'); p.setAttribute('height', '9'); p.setAttribute('patternTransform', 'rotate(45)');
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('width', '9'); r.setAttribute('height', '9'); r.setAttribute('fill', c); r.setAttribute('fill-opacity', '.1');
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', '0'); l.setAttribute('y1', '0'); l.setAttribute('x2', '0'); l.setAttribute('y2', '9');
        l.setAttribute('stroke', c); l.setAttribute('stroke-width', '1.4'); l.setAttribute('stroke-opacity', '.55');
        p.append(r, l); defs.appendChild(p);
      }
      svg.appendChild(defs);
    }
    for (const a of (d.items || [])) {
      if (!a.polygon || a.polygon.length < 3) continue;

      const latlngs = a.polygon.map(p => L.latLng(p[0], p[1]));
      const col = sevColor[a.severity] || '#ff9800';
      const sev = a.severity || 'Unknown';
      const poly = L.polygon(latlngs, {
        renderer: warnRenderer, color: col, weight: 2, fillOpacity: 1,
        fillColor: 'url(#wh-' + sev + ')'
      });

      warnAlerts.push({ ring: a.polygon, html: alertHtml(a) });
      peringatanLayer.addLayer(poly);
    }
    if (layerOn.peringatan) {
      if (!map.hasLayer(peringatanLayer)) map.addLayer(peringatanLayer);
    } else {
      if (map.hasLayer(peringatanLayer)) map.removeLayer(peringatanLayer);
    }
    bindWarnPick();
  } catch(e) {}
}

function warnHitTest(latlng){
  const lat = latlng.lat, lng = latlng.lng;
  for (const w of warnAlerts) {
    const r = w.ring;
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const yi = r[i][0], xi = r[i][1], yj = r[j][0], xj = r[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    if (inside) return w;
  }
  return null;
}
function bindWarnPick(){
  if (warnHandlersBound || !map) return;
  warnHandlersBound = true;

  map.on('popupopen', () => { lastPopAt = Date.now(); });
  map.on('click', e => {
    if (!layerOn.peringatan || !warnAlerts.length) return;
    if (Date.now() - lastPopAt < 80) return;
    const w = warnHitTest(e.latlng);
    if (!w) return;
    if (!warnPopup) warnPopup = L.popup({ className:'warn-pop', maxWidth:340, keepInView:true });
    warnPopup.setLatLng(e.latlng).setContent(w.html).openOn(map);
  });
}

$('#map-refresh').addEventListener('click', async () => {
  pullIncidents(true);
  satModelRunAt = 0; initSatelliteLayers();
  await checkTomTom();
  if (ttOk) pullTomTomIncidents();
});
$('#rp-go').addEventListener('click', calcRoute);
setInterval(() => { if (mapOpen && !document.hidden && SAT_IDS.some(id => layerOn[id])) paintMapSrc(); }, 1000);
schedulePoll(() => pullIncidents(), 60000, { dedupGlobalMs: 18000 });
schedulePoll(() => { if (SAT_IDS.some(id => layerOn[id])) initSatelliteLayers(); }, 60000, { mapOnly: true });
schedulePoll(() => pullFlights(), 30000, { mapOnly: true, layer: 'flight' });
schedulePoll(() => pullShips(), 30000, { mapOnly: true, layer: 'ship' });
schedulePoll(() => pullTransit(), 45000, { mapOnly: true, layer: 'transit' });
setTimeout(() => pullDisaster(), 2000);
schedulePoll(() => pullDisaster(), 120000);
schedulePoll(() => pullWind(), 900000, { mapOnly: true, layer: 'wind' });
schedulePoll(() => pullAlerts(), 300000, { mapOnly: true, layer: 'peringatan' });
schedulePoll(() => pullWeather(), 600000, { mapOnly: true, layer: 'cuaca' });

