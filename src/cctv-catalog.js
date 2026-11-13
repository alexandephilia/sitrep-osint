'use strict';

const CCTVCORE = require('../public/cctv-core');
const { makeLane } = require('./cctv-gateway');

function createCctvCatalog({
  fs,
  path,
  HIST_DIR,
  persistHist = false,
  UA,
  CFG,
  GW,
  cache,
  bodyCache,
  memo,
  mediaGet,
  mediaGetRaw,
  mediaText,
  mediaBody,
  rdAssertPublic,
  cctvFirecrawl,
  camList,
  cctvKnown,
  catalogHostAdd,
  isDraining,
}) {
  const ID_CITIES = [
    ['Jakarta',-6.21,106.85],['Tangerang',-6.18,106.63],['Bekasi',-6.24,106.99],['Depok',-6.4,106.82],
    ['Bogor',-6.6,106.8],['Bandung',-6.92,107.61],['Cilegon',-5.98,106.0],['Serang',-6.11,106.15],
    ['Yogyakarta',-7.8,110.36],['Surakarta',-7.57,110.82],['Semarang',-6.97,110.42],['Magelang',-7.48,110.4],
    ['Surabaya',-7.25,112.75],['Malang',-7.98,112.63],['Batu',-7.86,112.52],['Kediri',-7.8,112.02],
    ['Madiun',-7.63,111.52],['Jember',-8.18,113.71],['Banyuwangi',-8.22,114.37],
    ['Medan',3.6,98.67],['Binjai',3.6,98.49],['Padang',-0.95,100.42],['Padang Sidempuan',1.28,99.06],
    ['Pekanbaru',0.51,101.45],['Jambi',-1.61,103.61],['Palembang',-2.99,104.76],['Bengkulu',-3.79,102.26],
    ['Bandar Lampung',-5.45,105.27],['Prabumulih',-3.3,103.2],['Tanjung Balai',-3.02,99.85],
    ['Batam',1.16,104.05],['Tanjung Pinang',0.93,104.45],['Palangkaraya',-2.2,113.92],['Banjarmasin',-3.32,114.59],
    ['Samarinda',-0.5,117.15],['Balikpapan',-1.24,116.83],['Bontang',1.04,116.85],['Tarakan',3.3,117.59],
    ['Pontianak',-0.03,109.32],['Singkawang',0.92,108.98],['Sambas',1.35,109.27],
    ['Denpasar',-8.65,115.21],['Mataram',-8.58,116.12],['Kupang',-10.16,123.6],['Ende',-8.84,121.66],
    ['Makassar',-5.15,119.42],['Parepare',-4.02,119.87],['Palopo',-3.0,120.19],['Manado',1.47,124.85],
    ['Kendari',-3.98,122.51],['Palangga',-5.98,122.75],['Mamuju',-2.68,118.9],['Ternate',0.79,127.38],
    ['Ambon',-3.7,128.18],['Jayapura',-2.53,140.72],['Merauke',-8.57,140.4],['Sorong',-0.88,131.25],
    ['Lhokseumawe',5.17,97.15],['Sibolga',1.75,98.79],['Tegal',-6.87,109.14],['Purwokerto',-7.42,109.24],
    ['Cilacap',-7.73,109.05],['Pekalongan',-6.89,109.68],['Salatiga',-7.31,110.5],
    ['Pati',-6.75,111.04],['Rembang',-6.7,111.34],['Pacitan',-8.2,111.18],['Ngawi',-7.6,111.47],
    ['Lumajang',-8.14,113.23],['Probolinggo',-7.75,113.21],['Pasuruan',-7.65,112.91],['Sidoarjo',-7.45,112.72],
    ['Gresik',-7.16,112.65],['Mojokerto',-7.47,112.43],['Blitar',-8.1,112.17],['Tulungagung',-8.07,111.9],
    ['Nganjuk',-7.6,111.47],['Magetan',-7.63,111.28],['Ponorogo',-8.05,111.45],['Trenggalek',-8.0,111.43]
  ];
  const ID_PROV = [
    ['Banten', -5.6,-7.3, 105.1,106.7], ['DKI Jakarta', -6.05,-6.4, 106.7,107.1],
    ['Jawa Barat', -6.3,-7.8, 106.5,109.0], ['DI Yogyakarta', -7.6,-8.25, 110.1,110.9],
    ['Jawa Tengah', -6.7,-8.3, 108.9,111.7], ['Jawa Timur', -6.8,-8.8, 111.4,114.5],
    ['Bali', -8.05,-8.85, 114.35,115.95], ['Nusa Tenggara', -8.3,-10.9, 115.9,125.2],
    ['Sumatera Utara', 5.9,0.5, 97.5,100.5], ['Sumatera Barat', -0.3,-3.4, 99.4,102.6],
    ['Riau', 0.5,-2.0, 100.8,104.6], ['Jambi', -1.2,-3.0, 101.6,104.7],
    ['Sumatera Selatan', -2.4,-4.5, 102.5,106.2], ['Bengkulu', -3.0,-4.5, 100.9,103.0],
    ['Lampung', -4.4,-6.0, 103.5,106.1], ['Kepulauan Bangka Belitung', -2.0,-3.2, 104.0,107.0],
    ['Kalimantan Barat', 0.9,-3.4, 108.7,111.4], ['Kalimantan Tengah', -1.5,-3.5, 110.5,114.5],
    ['Kalimantan Selatan', -2.9,-4.2, 114.3,117.4], ['Kalimantan Timur', -0.5,2.5, 114.5,119.5],
    ['Kalimantan Utara', 2.0,4.5, 116.5,120.0], ['Sulawesi Utara', 0.5,2.0, 123.5,127.0],
    ['Sulawesi Tengah', -0.5,1.2, 119.3,122.0], ['Sulawesi Selatan', -2.5,-6.2, 118.5,121.8],
    ['Sulawesi Tenggara', -3.3,-5.6, 121.5,124.5], ['Sulawesi Barat', -0.5,-3.5, 118.8,120.6],
    ['Maluku', -2.5,-4.5, 126.5,131.0], ['Maluku Utara', -0.5,3.0, 127.0,129.5],
    ['Papua', -0.5,-9.0, 130.9,141.0], ['Papua Barat', -0.2,-3.5, 129.0,133.0]
  ];
  function idRegion(la, lo) {
    let best = null, bd = 60;
    for (const [n, clat, clo] of ID_CITIES) {
      const d = Math.hypot((la - clat) * 111, (lo - clo) * 111 * Math.cos(la * Math.PI / 180));
      if (d < bd) { bd = d; best = n; }
    }
    if (best) return 'Kota ' + best;
    for (const [n, a, b, c2, d2] of ID_PROV)
      if (la >= Math.min(a, b) && la <= Math.max(a, b) && lo >= Math.min(c2, d2) && lo <= Math.max(c2, d2)) return n;
    return 'Lainnya';
  }
  async function cctvFetch(url, ms, headers) {
    await rdAssertPublic(url);
    const customProxy = process.env.CUSTOM_PROXY_URL || process.env.PROXY_URL || CFG.custom_proxy;
    const attempts = [url,
      ...(customProxy ? [(customProxy.endsWith('/') ? customProxy : customProxy + '/') + encodeURIComponent(url)] : []),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)];
    let lastErr = '';
    for (const u of attempts) {
      try {
        const { r } = await mediaGet(u, ms, u === url && headers ? headers : {});
        if (r.ok) return await mediaText(r, 3 << 20);
        lastErr = 'HTTP ' + r.status;
      } catch (e) { lastErr = String(e.message || e); }
    }
    throw new Error(lastErr || 'fetch gagal');
  }
  const CCTV_HIST_FILE = (fs && path && HIST_DIR) ? path.join(HIST_DIR, 'cctv-history.json') : '';
  let lastGoodCams = [];
  let cctvHistDirty = false, cctvHistSaveAt = 0, cctvHistInflight = false;
  const srcCams = { bpjt: [], bekasi: [], jogja: [], molecool: [], tangkab: [], bali: [] };
  const srcDone = { bpjt: false, bekasi: false, jogja: false, molecool: false, tangkab: false, bali: false };
  const srcInflight = { bpjt: null, bekasi: null, jogja: null, molecool: null, tangkab: null, bali: null };
  const cctvProbe = { alive: new Set(), done: new Set(), running: false, last: 0 };
  const hostCors = new Map();

  function registerCamAllowlist(c) {
    if (!c || !c.s) return;
    try { catalogHostAdd(new URL(c.s).hostname); cctvKnown.add(c.s); } catch (e) {}
    if (c.snap) { try { catalogHostAdd(new URL(c.snap).hostname); cctvKnown.add(c.snap); } catch (e) {} }
    const fbs = Array.isArray(c.fb) ? c.fb : (c.fb ? [c.fb] : []);
    for (const f of fbs) { try { catalogHostAdd(new URL(f).hostname); cctvKnown.add(f); } catch (e) {} }
  }

  function invalidateCctvRespCache() {
    cache.delete('cctvcat');
    if (bodyCache) bodyCache.delete('cctv');
  }

  function loadCctvHist() {
    if (!CCTV_HIST_FILE || !fs) return;
    try {
      const j = JSON.parse(fs.readFileSync(CCTV_HIST_FILE, 'utf8'));
      const age = Date.now() - (Number(j && j.at) || 0);
      if (!j || !Array.isArray(j.cams) || age < 0 || age > 7 * 86400e3) return;
      const loaded = [];
      for (const c of j.cams) {
        if (!c || typeof c.s !== 'string' || typeof c.n !== 'string' || !/^https?:\/\//i.test(c.s)) continue;
        registerCamAllowlist(c);
        loaded.push(c);
      }
      if (loaded.length) lastGoodCams = CCTVCORE.dedupe(loaded);
      if (age <= 24 * 3600e3 && Array.isArray(j.alive)) {
        for (const u of j.alive) if (typeof u === 'string' && u) cctvProbe.alive.add(u);
      }
      if (age <= 24 * 3600e3 && Array.isArray(j.done)) {
        for (const u of j.done) if (typeof u === 'string' && u) cctvProbe.done.add(u);
      }
    } catch (e) {}
  }

  function saveCctvHist(force) {
    if (!persistHist || !CCTV_HIST_FILE || !fs || !lastGoodCams.length) return;
    if (!cctvHistDirty && !force) return;
    const now = Date.now();
    if (!force && (now - cctvHistSaveAt < 30000 || cctvHistInflight)) return;
    cctvHistSaveAt = now;
    cctvHistDirty = false;
    const payload = JSON.stringify({
      at: now,
      cams: lastGoodCams,
      alive: [...cctvProbe.alive],
      done: [...cctvProbe.done],
    });
    if (force) {
      try {
        fs.mkdirSync(HIST_DIR, { recursive: true });
        const tmp = CCTV_HIST_FILE + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, payload);
        fs.renameSync(tmp, CCTV_HIST_FILE);
      } catch (e) {}
      return;
    }
    cctvHistInflight = true;
    const tmp = CCTV_HIST_FILE + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 7) + '.tmp';
    fs.promises.mkdir(HIST_DIR, { recursive: true })
      .then(() => fs.promises.writeFile(tmp, payload))
      .then(() => fs.promises.rename(tmp, CCTV_HIST_FILE))
      .catch(() => { cctvHistDirty = true; try { fs.unlinkSync(tmp); } catch {} })
      .finally(() => { cctvHistInflight = false; });
  }

  loadCctvHist();

  function refreshSource(key, memoFn) {
    if (srcInflight[key]) return srcInflight[key];
    const p = Promise.resolve().then(memoFn).then(list => {
      srcDone[key] = true;
      const clean = Array.isArray(list) ? list : [];
      if (clean.length > 0 || !srcCams[key].length) {
        const changed = clean.length !== srcCams[key].length;
        srcCams[key] = clean;
        for (const c of clean) registerCamAllowlist(c);
        if (changed) invalidateCctvRespCache();
      }
      return srcCams[key];
    }, () => {
      srcDone[key] = true;
      return srcCams[key];
    }).finally(() => {
      srcInflight[key] = null;
    });
    srcInflight[key] = p;
    return p;
  }

  async function cctvBpjtFetch() {
    let h = '';
    try { h = await cctvFetch('https://bpjt.pu.go.id/cctv/', 12000); } catch (e) {}
    if (!h || !h.includes('allStreams')) h = await cctvFirecrawl('https://bpjt.pu.go.id/cctv/');
    if (!h || !h.includes('allStreams')) return [];
    const m = h.match(/const allStreams = (\{[\s\S]*?\});\s*\n/);
    if (!m) return [];
    const groups = JSON.parse(m[1]), seen = new Set(), out = [];
    for (const g of Object.values(groups)) for (const c of g) {
      const s = String(c.streamhls || '');
      if (!/m3u8/i.test(s) || seen.has(s)) continue;
      if (!['online', '1'].includes(String(c.status))) continue;
      const la = +c.lat, lo = +c.lon;
      if (!isFinite(la) || !isFinite(lo) || la < -11 || la > 6 || lo < 95 || lo > 141) continue;
      seen.add(s);
      out.push({ n: String(c.nama_km || c.nama_segment || 'CCTV') + ' · ' + String(c.nama_ruas || '').replace(/-/g, ' '),
        s, e: '', la, lo, c: idRegion(la, lo), src: 'bpjt' });
    }
    return out;
  }
  const cctvBpjt = () => refreshSource('bpjt', () => memo('cctv:bpjt', 1800000, cctvBpjtFetch, v => v.length > 0));
  async function cctvBekasiFetch() {
    let d = null;
    try { d = JSON.parse(await cctvFetch('https://eofficev2.bekasikota.go.id/backupcctv/m3/list.json', 10000)); } catch (e) {}
    if (!Array.isArray(d)) return [];
    return d.filter(x => x && x.path).map(x => ({
      n: String(x.name || x.path).replace(/_/g, ' '),
      s: 'https://eofficev2.bekasikota.go.id/backupcctv/m3/' + x.path,
      e: '', la: null, lo: null, c: 'Kota Bekasi', src: 'pemda'
    }));
  }
  const cctvBekasi = () => refreshSource('bekasi', () => memo('cctv:bekasi', 1800000, cctvBekasiFetch, v => Array.isArray(v) && v.length > 0));
  async function cctvJogjaFetch() {
    let d = null;
    try { d = JSON.parse(await cctvFetch('https://cctv.jogjakota.go.id/home/getdata', 10000,
      { referer: 'https://cctv.jogjakota.go.id/', 'x-requested-with': 'XMLHttpRequest' })); } catch (e) {}
    if (!Array.isArray(d)) return [];
    return d.filter(x => x && x.cctv_link && /\.m3u8(\?|$)/i.test(x.cctv_link)).map(x => ({
      n: 'CCTV ' + String(x.cctv_title || 'Jogja').replace(/_/g, ' '),
      s: x.cctv_link,
      e: '',
      la: parseFloat(x.cctv_latitude) || null,
      lo: parseFloat(x.cctv_longitude) || null,
      c: 'Kota Yogyakarta', src: 'jogja'
    }));
  }
  const cctvJogja = () => refreshSource('jogja', () => memo('cctv:jogja', 1800000, cctvJogjaFetch, v => Array.isArray(v) && v.length > 0));
  async function cctvTangerangKabFetch() {
    let html = '';
    try { html = await cctvFetch('https://cctv-dishub.tangerangkab.go.id/cctv', 8000, { referer: 'https://cctv-dishub.tangerangkab.go.id/' }); } catch (e) {}
    if (!html) return [];
    const seen = new Set(), candidates = [];
    const re = /storage\/video\/([0-9a-z]+)\/\1\.m3u8/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const ctx = html.slice(Math.max(0, m.index - 600), m.index + 600);
      const tm = ctx.match(/fi-ta-text-item-label[^>]*>\s*([^<]{3,80}?)\s*</i) || ctx.match(/data-title="([^"]{3,80})"/i);
      const name = tm ? tm[1].replace(/\s+/g, ' ').trim() : ('Kab. Tangerang ' + id.slice(-6));
      candidates.push({
        n: name,
        s: `https://cctv-dishub.tangerangkab.go.id/storage/video/${id}/${id}.m3u8`,
        snap: `https://cctv-dishub.tangerangkab.go.id/storage/video/${id}/thumbnail.jpg`,
        e: 'https://cctv-dishub.tangerangkab.go.id/cctv',
        la: -6.26, lo: 106.49, c: 'Tangerang', sub: 'Kab. Tangerang', d: 0, src: 'pemda',
      });
    }
    const live = [];
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < candidates.length && !isDraining()) {
        const cam = candidates[i++];
        try {
          const { r } = await mediaGetRaw(cam.s, 4000, { 'user-agent': UA, referer: 'https://cctv-dishub.tangerangkab.go.id/' }, null);
          if (r.ok && (await mediaText(r, 1 << 20)).includes('#EXTM3U')) {
            registerCamAllowlist(cam);
            live.push(cam);
          }
        } catch (e) {}
      }
    }));
    return live;
  }
  const cctvTangerangKab = () => refreshSource('tangkab', () => memo('cctv:tangkab', 1800000, cctvTangerangKabFetch, v => Array.isArray(v) && v.length > 0));
  async function cctvBaliFetch() {
    let d = null;
    try { d = JSON.parse(await cctvFetch('https://balisatudata.baliprov.go.id/api/v1/report-cctv', 10000, { referer: 'https://balisatudata.baliprov.go.id/' })); } catch (e) {}
    const rows = d && d.data ? Object.values(d.data) : [];
    if (!rows.length) return [];
    const candidates = [];
    const seen = new Set();
    for (const x of rows) {
      if (!x) continue;
      let ch = x.ch_id ? String(x.ch_id).trim() : '';
      if (!ch && x.streaming_url) {
        const qm = String(x.streaming_url).match(/[?&]id=([^&]+)/);
        if (qm) ch = decodeURIComponent(qm[1]).trim();
      }
      if (!ch || seen.has(ch)) continue;
      seen.add(ch);
      const la = parseFloat(x.lat), lo = parseFloat(x.lng);
      candidates.push({
        n: String(x.ch_name || ch).replace(/\s+/g, ' ').trim(),
        s: `https://transcode.baliprov.go.id/cctv/${encodeURIComponent(ch)}/index.m3u8`,
        e: 'https://balisatudata.baliprov.go.id/',
        la: Number.isFinite(la) ? la : -8.6705,
        lo: Number.isFinite(lo) ? lo : 115.2126,
        c: 'Bali', sub: 'Bali', d: 0, src: 'pemda',
      });
    }
    const live = [];
    let i = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (i < candidates.length && !isDraining()) {
        const cam = candidates[i++];
        try {
          const { r } = await mediaGetRaw(cam.s, 4000, { 'user-agent': UA, referer: 'https://balisatudata.baliprov.go.id/' }, null);
          if (r.ok && (await mediaText(r, 1 << 20)).includes('#EXTM3U')) {
            registerCamAllowlist(cam);
            live.push(cam);
          }
        } catch (e) {}
      }
    }));
    return live;
  }
  const cctvBali = () => refreshSource('bali', () => memo('cctv:bali', 1800000, cctvBaliFetch, v => Array.isArray(v) && v.length > 0));
  const MOLE_UA = { 'user-agent': UA, referer: 'https://molecool.id/' };
  const MOLE_SEEDS = ['3DIoRg7','4bsalqw','6Ty5BM3','6oxwbjQ','8JD739Y','AIpWgQ6','CDOd8lH','Ds39keN','FscOWio','GOQqdkB','Gj9Db3K','Jc0KvBZ','Og41dpx','PwQ1zRN','amhRiVY','fKJ9W4y','g7iu58b','lIXKVas','lKOitqX','lqAw39p','mtPwzYo','ucKlag3','wLeQ437'];
  const moleReg = new Map();
  const moleTok = new Map();
  const moleExp = t => { const m = /-(\d{10})-(\d{10})$/.exec(t || ''); return m ? Math.max(+m[1], +m[2]) * 1000 : 0; };
  const molePage = async pagePath => { try { return await cctvFetch('https://molecool.id' + pagePath, 8000, MOLE_UA); } catch (e) { return ''; } };
  const moleScan = html => {
    const out = [];
    for (const m of String(html).matchAll(/cctv\.molecool\.id\/([A-Za-z0-9._-]+)\/preview\.jpg\?token=([A-Za-z0-9._-]+)/g))
      out.push({ slug: m[1], token: m[2] });
    return out;
  };
  const moleInflight = new Map();
  async function moleFresh(slug) {
    const ent = moleReg.get(slug); if (!ent) return null;
    const tk = moleTok.get(slug);
    if (tk && tk.exp - Date.now() > 5 * 60000) return tk.token;
    if (moleInflight.has(slug)) return moleInflight.get(slug);
    const p = (async () => {
      const html = await molePage(ent.path);
      let found = null;
      for (const s of moleScan(html)) {
        moleTok.set(s.slug, { token: s.token, exp: moleExp(s.token) });
        if (s.slug === slug) found = s.token;
      }
      return found || (moleTok.get(slug) || {}).token || null;
    })().finally(() => moleInflight.delete(slug));
    moleInflight.set(slug, p);
    return p;
  }
  const cctvMolecool = () => refreshSource('molecool', () => memo('molecool', 2400000, async () => {
    const out = [], seen = new Set();
    const cityCase = s => String(s || '').trim().toLowerCase()
      .replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()) || 'Jakarta';
    const push = (name, city, slug, token, pagePath) => {
      if (!slug || !token || seen.has(slug)) return;
      seen.add(slug);
      moleReg.set(slug, { path: pagePath });
      moleTok.set(slug, { token, exp: moleExp(token) });
      const cam = { n: name || slug, s: `https://cctv.molecool.id/${slug}/index.m3u8?token=${token}`,
        e: 'https://molecool.id' + pagePath, la: null, lo: null, c: cityCase(city), src: 'molecool' };
      registerCamAllowlist(cam);
      out.push(cam);
    };
    const idx = await molePage('/live-cctv');
    for (const blk of String(idx).split('wire:key="cctv-').slice(1)) {
      const id = blk.slice(0, blk.indexOf('"'));
      const pv = /cctv\.molecool\.id\/([A-Za-z0-9._-]+)\/preview\.jpg\?token=([A-Za-z0-9._-]+)/.exec(blk);
      const nm = /cctv__name">\s*([^<]+?)\s*<\/a>/.exec(blk);
      const ct = /text-card-city-name[\s\S]*?<\/i>\s*([^<]+?)\s*<\/p>/.exec(blk);
      if (pv && /^\d+$/.test(id)) push(nm && nm[1], ct && ct[1], pv[1], pv[2], '/live-cctv/' + id);
    }
    if (out.length) {
      srcCams.molecool = out.slice();
      invalidateCctvRespCache();
    }
    await Promise.all(MOLE_SEEDS.map(async code => {
      const h = await molePage('/cctv/' + code); if (!h) return;
      const im = /cctv\.molecool\.id\/([A-Za-z0-9._-]+)\/preview\.jpg\?token=([A-Za-z0-9._-]+)/.exec(h);
      const nm = /og:title" content="([^"]*)/.exec(h);
      const ds = /og:description" content="([^"]*)/.exec(h);
      const city = ds ? (/((?:jakarta|kota bekasi)[a-z ]*)$/i.exec(ds[1]) || [null, ''])[1] : '';
      if (im) push(nm && nm[1], city, im[1], im[2], '/cctv/' + code);
    }));
    return out;
  }, v => Array.isArray(v) && v.length > 0));
  const probeLane = makeLane(8, 2);
  const probeGet = (url, ms, h) => probeLane.run(new URL(url).host, () => mediaGetRaw(url, ms, h, null));
  const HLS_UA = { 'user-agent': UA, referer: 'https://bpjt.pu.go.id/', origin: 'https://probe.invalid' };
  function hlsLines(t) { return t.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')); }
  async function probeHls(url, depth) {
    if (depth > 3) return false;
    try {
      const { r, url: furl } = await probeGet(url, 7000, HLS_UA);
      if (!r.ok) return false;
      if (depth === 0) { try { hostCors.set(new URL(url).host, !!r.headers.get('access-control-allow-origin')); } catch (e) {} }
      const t = await mediaText(r, 1 << 20);
      if (!t.includes('#EXTM3U')) return false;
      const lines = hlsLines(t);
      if (!lines.length) return false;
      const first = lines[0];
      if (/\.ts(\?|$)/i.test(first) || first.startsWith('http') && /\.(ts|m4s)(\?|$)/i.test(first)) {
        try {
          const seg = new URL(first, furl).href;
          const { r: sr } = await probeGet(seg, 8000, { ...HLS_UA, range: 'bytes=0-4096' });
          if (!sr.ok && sr.status !== 206) return false;
          const buf = await mediaBody(sr, 1 << 20);
          return buf.byteLength > 500;
        } catch (e) { return false; }
      }
      return await probeHls(new URL(first, furl).href, depth + 1);
    } catch (e) { return false; }
  }
  async function warmCctv() {
    if (isDraining() || cctvProbe.running || (cctvProbe.last && Date.now() - cctvProbe.last < 1500000)) return;
    cctvProbe.running = true; cctvProbe.last = Date.now();
    const next = { alive: new Set(), done: new Set() };
    try {
      let cams = await cctvBpjt().catch(() => []);
      if (!cams.length) { await new Promise(s => setTimeout(s, 15000)); cams = await cctvBpjt().catch(() => []); }
      if (!cams.length) { console.log('[cctv] bpjt fetch kosong, skip sweep'); cctvProbe.running = false; return; }
      const jogja = await refreshSource('jogja', cctvJogja).catch(() => []);
      const byHost = new Map();
      for (const c of cams.concat(jogja)) {
        let h = '_';
        try { h = new URL(c.s).hostname || '_'; } catch (e) {}
        if (!byHost.has(h)) byHost.set(h, []);
        byHost.get(h).push(c);
      }
      const buckets = [...byHost.values()], interleaved = [];
      let pushed = true;
      while (pushed) {
        pushed = false;
        for (const b of buckets) { if (b.length) { interleaved.push(b.shift()); pushed = true; } }
      }
      cams = interleaved;
      let i = 0, completed = 0;
      await Promise.all(Array.from({ length: 12 }, async () => { while (i < cams.length && !isDraining()) { const c = cams[i++];
        const ok = await probeHls(c.s, 0);
        next.done.add(c.s);
        cctvProbe.done.add(c.s);
        if (ok) { next.alive.add(c.s); cctvProbe.alive.add(c.s); }
        if (++completed % 30 === 0) invalidateCctvRespCache();
      } }));
      cctvProbe.alive = next.alive; cctvProbe.done = next.done;
      invalidateCctvRespCache();
      cctvHistDirty = true;
      saveCctvHist(true);
      console.log('[cctv] probe selesai:', next.alive.size, '/', cams.length, 'cam playable');
    } catch (e) {} finally { cctvProbe.running = false; }
  }
  const cctvReportedDead = s => GW.reportedDead(s);
  const cctvCatalog = () => memo('cctvcat', 300000, async () => {
    const allBefore = srcDone.bpjt && srcDone.bekasi && srcDone.jogja && srcDone.molecool && srcDone.tangkab && srcDone.bali;
    const pAll = Promise.allSettled([
      cctvBpjt(),
      cctvBekasi(),
      cctvJogja(),
      cctvMolecool(),
      cctvTangerangKab(),
      cctvBali(),
    ]);
    if (!cctvProbe.done.size && !cctvProbe.running) warmCctv().catch(() => {});
    const hasSeed = lastGoodCams.length > 0 || srcCams.bpjt.length > 0 || srcCams.bekasi.length > 0 || srcCams.jogja.length > 0 || srcCams.molecool.length > 0 || srcCams.tangkab.length > 0 || srcCams.bali.length > 0;
    if (!(allBefore && hasSeed)) {
      await Promise.race([pAll, new Promise(r => setTimeout(r, hasSeed ? 3500 : 7500))]);
    }
    const bpjt = srcCams.bpjt;
    const jogja = srcCams.jogja;
    const other = [...srcCams.tangkab, ...srcCams.bali, ...srcCams.bekasi, ...srcCams.molecool];
    const probeable = [...jogja, ...bpjt].filter(c =>
      cctvProbe.done.has(c.s) ? cctvProbe.alive.has(c.s) : (cctvProbe.alive.size < 24)
    );
    const verified = probeable.filter(c => !cctvReportedDead(c.s));
    const verifiedNonToll = verified.filter(c => c.src !== 'bpjt');
    const verifiedToll = verified.filter(c => c.src === 'bpjt');
    for (const c of [...bpjt, ...jogja, ...other]) registerCamAllowlist(c);
    for (const c of camList()) registerCamAllowlist(c);
    let cams = CCTVCORE.dedupe([...other.filter(c => !cctvReportedDead(c.s)), ...verifiedNonToll, ...verifiedToll]).map(c => {
      try { if (hostCors.get(new URL(c.s).host) === false) return { ...c, d: 0 }; } catch (e) {}
      return c;
    });
    if (!cams.length && lastGoodCams.length) {
      cams = lastGoodCams.filter(c => !cctvReportedDead(c.s));
    } else if (cams.length) {
      if (cams.length !== lastGoodCams.length) cctvHistDirty = true;
      lastGoodCams = CCTVCORE.dedupe(cams);
      saveCctvHist(false);
    }
    const allSourcesDone = srcDone.bpjt && srcDone.bekasi && srcDone.jogja && srcDone.molecool && srcDone.tangkab && srcDone.bali;
    const warming = !allSourcesDone || (cctvProbe.running && cctvProbe.alive.size < 24);
    return {
      ok: true,
      cams,
      bpjt_alive: cctvProbe.alive.size,
      bpjt_total: bpjt.length,
      probing: cctvProbe.running,
      warming,
      snap: await GW.detectFfmpeg(),
      at: Date.now(),
    };
  }, v => Boolean(v && Array.isArray(v.cams) && v.cams.length >= 20 && !v.warming));

  return {
    moleFresh,
    cctvCatalog,
    warmCctv,
    hostCors,
    saveCctvHist,
  };
}

module.exports = { createCctvCatalog };
