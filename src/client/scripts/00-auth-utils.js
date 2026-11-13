"use strict";

const SITREP_USER = (() => {
  try { return document.querySelector('meta[name="sitrep-user"]')?.content || null; } catch (e) { return null; }
})();
const SITREP_PUBLIC = (() => {
  try { return document.querySelector('meta[name="sitrep-public"]')?.content === '1'; } catch (e) { return false; }
})();
const SITREP_TOKEN = (() => {
  if (SITREP_USER || SITREP_PUBLIC) return '';
  let t = '';
  try {
    t = document.querySelector('meta[name="sitrep-token"]')?.content || '';
    const qp = new URLSearchParams(location.search).get('token');
    if (qp) {
      t = qp;
      try { localStorage.setItem('sitrep-token', qp); } catch (e) {}
    } else if (!t) {
      try { t = localStorage.getItem('sitrep-token') || ''; } catch (e) {}
    }
  } catch (e) {}
  return t;
})();
const SIT_TOKEN = SITREP_TOKEN;
const SITREP_CAN_FRESH = !SITREP_PUBLIC || Boolean(SIT_TOKEN);
let API = null;
const isOurUrl = url => {
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin || (API != null && API !== '' && String(url).startsWith(API + '/'));
  } catch (e) { return false; }
};
const apiHeaders = url => {
  if (!SIT_TOKEN) return {};
  try {
    const u = new URL(url, location.href);
    return (isOurUrl(url) && u.pathname.startsWith('/api/')) ? { 'x-sitrep-token': SIT_TOKEN } : {};
  } catch (e) { return {}; }
};
const tokQ = u => SIT_TOKEN ? u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(SIT_TOKEN) : u;
if (!SITREP_USER && !SITREP_PUBLIC && !SITREP_TOKEN) console.warn('[SITREP] No API token available; gated /api/* and media proxies will return 403.');
(function initUserLogoutBtn(){
  if (!SITREP_USER) return;
  const dock = document.querySelector('.hdr-dock');
  if (!dock) return;
  const uname = SITREP_USER.split(':')[0] || 'user';
  const sep = document.createElement('span');
  sep.className = 'hdr-dock-sep';
  sep.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hstat';
  btn.id = 'btn-logout';
  btn.style.cssText = 'cursor:pointer;border:0;background:none;color:inherit;font:inherit';
  btn.title = 'Keluar sesi (' + SITREP_USER + ')';
  btn.textContent = uname + ' · Keluar';
  btn.addEventListener('click', () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(() => {})
      .finally(() => location.reload());
  });
  dock.append(sep, btn);
})();

const cityLabel = s => {
  let t = String(s == null ? '' : s).trim();
  if (!t) return 'Lainnya';
  if (/^pantau\s+banjir/i.test(t)) return 'Pantau Banjir';
  if (/^(?:kota\s+)?jakarta/i.test(t)) return 'Kota Jakarta';
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
  return t.replace(/^Kota\s+/i, '');
};
const camSubLabel = c => (c && (c.sub || c.region || c.rawC || c.c)) || 'Lainnya';
const camIsFlood = c => Boolean(c && (c.flood === true || /^pantau\s+banjir/i.test(c.rawC || c.c || '')));
const camPrimaryCity = c => cityLabel((c && (c.region || c.rawC || c.c)) || '');
const camInDistrict = (c, dist) => {
  if (!c) return false;
  if (dist === 'Semua') return true;
  if (dist === 'Pantau Banjir') return camIsFlood(c);
  if (camPrimaryCity(c) === dist || cityLabel(c.c) === dist) return true;
  if (dist === 'Kota Jakarta' && /^(?:kota\s+)?jakarta/i.test(c.region || c.sub || c.rawC || c.c || '')) return true;
  return false;
};
const initCamTags = c => {
  if (!c) return c;
  if (!c.rawC) c.rawC = c.c || '';
  if (!c.sub && /^jakarta\s+/i.test(c.rawC)) c.sub = c.rawC;
  if (camIsFlood(c)) c.flood = true;
  c.c = cityLabel(c.c);
  return c;
};
const CAMS = JSON.parse(document.getElementById('cam-data').textContent);
CAMS.forEach(initCamTags);
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const safeUrl = u => {
  try {
    const t = String(u == null ? '' : u).trim();
    if (!t) return '#';
    const p = new URL(t, location.href).protocol;
    return (p === 'https:' || p === 'http:') ? t : '#';
  } catch (e) { return '#'; }
};
const escUrl = u => esc(safeUrl(u));

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{203C}\u{2049}\u{2190}-\u{21FF}\u{2934}\u{2935}]/gu;
const deEmoji = s => String(s == null ? '' : s).replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const once = fn => {
  let busy = false, tail = null, inflight = null;
  const go = (...a) => {
    busy = true;
    const p = Promise.resolve().then(() => fn(...a));
    inflight = p;
    const fin = () => {
      if (tail) { const t = tail; tail = null; go(...t); }
      else { busy = false; inflight = null; }
    };
    p.then(fin, fin);
    return p;
  };
  return (...a) => {
    if (busy) { tail = a; return inflight || Promise.resolve(); }
    return go(...a);
  };
};

for (const n of ['pullSituation','pullStocks','pullIncidents','pullFlights','pullShips','pullTransit',
  'pullDisaster','pullWeather','pullWind','pullAlerts','pullTomTomIncidents','pullAlive','pullCctv','pullBreaking',
  'pullRadar','pullRadarBmkg','pullFires','pullAir'])
  window[n] = once(window[n]);
let lastGlobalSyncAt = 0;
function schedulePoll(fn, ms, opt = {}) {
  const jitter = () => Math.max(1000, Math.round(ms * (0.88 + Math.random() * 0.24)));
  const tick = () => {
    setTimeout(() => {
      try {
        const dedupBlocked = opt.dedupGlobalMs && (Date.now() - lastGlobalSyncAt < opt.dedupGlobalMs);
        if (!document.hidden && (!opt.mapOnly || mapOpen) && (!opt.layer || layerOn[opt.layer]) && !dedupBlocked) {
          fn();
        }
      } finally {
        tick();
      }
    }, jitter());
  };
  tick();
}
const num = n => { n = +n || 0;
  return n >= 1e6 ? (n/1e6).toFixed(1).replace('.0','') + 'M'
       : n >= 1e3 ? (n/1e3).toFixed(1).replace('.0','') + 'K' : String(n); };
const wibTime = t => new Date(t).toLocaleTimeString('id-ID',
  { timeZone:'Asia/Jakarta', hour12:false, hour:'2-digit', minute:'2-digit' }).replace(/\./g, ':');
const wibDayStart = (now = Date.now()) => { const j = new Date(now + 7 * 3600e3); j.setUTCHours(0, 0, 0, 0); return j.getTime() - 7 * 3600e3; };
let sitWindow = '24h';
const inSitWindow = (p, now = Date.now(), win = sitWindow) => {
  if (!p || p.fixed) return true;
  const ts = Number(p.ts) || 0;
  if (win === '24h') return !ts || (ts <= now + 5 * 60e3 && now - ts <= 24 * 3600e3);
  if (win === 'today') {
    if (!ts) return p.sub === 'volcano' || p.sub === 'tma';
    return ts >= wibDayStart(now) && ts <= now + 5 * 60e3;
  }
  if (win === 'live') {
    if (!ts) return p.sub === 'volcano';
    return ts <= now + 5 * 60e3 && now - ts <= 2 * 3600e3;
  }
  return true;
};
const sitWindowLabel = (win = sitWindow) => win === 'today' ? 'Hari Ini' : win === 'live' ? '<2J' : '24J';
const wibFull = t => new Date(t).toLocaleString('id-ID',
  { timeZone:'Asia/Jakarta', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false }).replace(/\./g, ':');
function rel(ts){
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'baru';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'j';
  if (s < 604800) return Math.floor(s/86400) + 'h';
  return wibFull(ts).split(' ')[0];
}
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

const CYCLE = 120;
let remain = CYCLE;
function tickClock(){
  $('#clock').textContent = new Date().toLocaleTimeString('id-ID',
    { timeZone:'Asia/Jakarta', hour12:false }).replace(/\./g, ':') + ' WIB';
}
setInterval(tickClock, 1000); tickClock();
function paintCountdown(){
  $('#countdown').textContent = String(Math.floor(remain/60)).padStart(2,'0') + ':' + String(remain%60).padStart(2,'0');
  const btn = $('#btn-refresh');
  if (btn) btn.style.setProperty('--sync-p', Math.max(0, Math.min(100, Math.round((remain / CYCLE) * 100))) + '%');
}
setInterval(() => {
  if (document.hidden) return;
  if (lastRefreshDone) {
    const elapsed = Math.floor((Date.now() - lastRefreshDone) / 1000);
    remain = Math.max(0, CYCLE - elapsed);
  } else {
    remain = Math.max(0, remain - 1);
  }
  paintCountdown();
  if (remain === 0 && !busy) refreshAll(false);
}, 1000);
paintCountdown();

const CAT_ORDER = ['demo','fire','flood','disaster','insiden','siber','kriminal','kesehatan','ekonomi','politik'];
const CAT_COLOR = { demo:'#f1c21b', fire:'#da1e28', flood:'#4589ff', disaster:'#be95ff', insiden:'#8d8d8d', siber:'#c8f04b', kriminal:'#ff9f43', kesehatan:'#ff6b9d', ekonomi:'#3ddc97', politik:'#6ea8fe', gempa:'#ff5a4e', gunung:'#ff9f0a' };
const CAT_LABEL = { demo:'Demo', fire:'Kebakaran', flood:'Banjir', disaster:'Bencana', insiden:'Insiden', siber:'Siber', kriminal:'Kriminal', kesehatan:'Kesehatan', ekonomi:'Ekonomi', politik:'Politik', gempa:'Gempa', gunung:'Gunung Api' };
const CAT_GEO = { demo:1, fire:1, flood:1, disaster:1, insiden:1, siber:1, kriminal:1, kesehatan:1, ekonomi:1, politik:1 };
const LEGEND_SUB = ['gempa','gunung'];
const CAT_RE = {
  demo:/(\bdemo\b(?!\s*(aplikasi|game|produk|sistem|fitur|cara|tutorial|masak|memasak|kuliner|spesial|special))(?<!cooking demo|cooking\s+demo)|unjuk rasa|aksi massa|protes|mogok|kerusuhan|bentrok|pemogokan|long march|women'?s\s+march|international\s+women'?s\s+day|hari\s+buruh|buruh\s+sedunia|labour\s+day|labor\s+day)/i,
  fire:/(?:\b(?:kebakaran|karhutla|kebakaran hutan|kebakaran lahan|terbakar|kobaran api|asap tebal)\b)(?!\s+(?:jenggot|harga|promo|diskon|api amarah|api cemburu|api asmara|semangat))/i,
  flood:/(?:\bbanjir\b(?!\s*(?:serangan|siber|cyber|orderan|hadiah|promo|diskon|bonus|cuan|kritik|hujatan|komentar|aduan|laporan|pujian|ucapan|impor|produk|pemudik|turis|wisatawan|penonton|pelamar|pendaftar|peserta|air mata|gol))\b|banjir bandang|banjir rob|banjir lahar|banjir lumpur|banjir kiriman|terendam banjir|merendam pemukiman|genangan air|air meluap|tanggul jebol|tanah longsor|\blongsor\b(?!\s*(?:saham|suara|harga|ihsg|rupiah|kurs))\b|cuaca ekstrem|hujan deras|\brob\b|\bkebanjiran\b(?!\s*(?:orderan|hadiah|promo|diskon|bonus|cuan|kritik|hujatan|komentar|aduan|laporan|pujian|ucapan|impor|produk|pesan|chat|dm|keluhan|tamu|serangan|siber))\b)/i,
  disaster:/(?:\b(?:gempa|tsunami|erupsi|letusan|gunung meletus|gunung api|awan panas|hujan abu|lahar dingin|lahar hujan|badai|siklon|puting beliung|angin kencang|angin ribut|badai petir|gelombang tinggi|gelombang pasang|bibit siklon|bencana|evakuasi|korban jiwa|ambruk|tenggelam|hanyut|likuefaksi)\b)(?!\s+(?:politik|jagat|dunia|maya|netizen|pasar|bursa|phk|impor|suara|protes|regulasi|vonis|kasus))/i,
  insiden:/(?:\b(?:kecelakaan|ledakan|pohon tumbang|runtuh|tabrakan|tabrak lari|kapal karam|pesawat jatuh|tergelincir|terjun)\b)(?!\s+(?:penduduk|kasus|inflasi|harga|daya beli|ihsg|rupiah|saham|kurs|suara))/i,
  siber:/(peretasan|peretas|hacker|ransomware|phishing|malware|ddos|botnet|zero[- ]day|n[- ]?day|\bcve[- ]?\d{4}|exploit|dieksploitasi|kerentanan|vulnerabilit|backdoor|spyware|skimming|carding|cryptojack|deepfake|deface|defacement|vishing|smishing|sextortion|kebocoran data|bocor data|data breach|pencurian data|akun dibajak|akun palsu|scam|penipuan online|pinjol ilegal|investasi bodong|bssn|badan siber|serangan siber|serangan cyber|insiden keamanan|gangguan (layanan|sistem|jaringan|aplikasi|infrastruktur)|layanan lumpuh|situs lumpuh|maintenance keamanan|uu pdp|\bpdp\b|dompet kripto|infrastruktur kritis|apt\d{1,2}\b|command and control|leak site|akun (media sosial|instagram|facebook|whatsapp|telegram|x|tiktok) (dibajak|diretas|dibobol))/i,
  kriminal:/(penembakan|pembunuhan|pengeroyokan|begal|curat|pencurian|perampokan|penangkapan|ditangkap|tersangka|kabur dari lapas|napi kabur|terorisme|radikalisasi|suap|gratifikasi|penipuan|narkoba|psikotropika|penculikan|perkosaan|rudapaksa)/i,
  kesehatan:/(?:wabah|\bklb\b|kejadian luar biasa|dbd|\bdhf\b|demam berdarah|covid|korona|influenza|\bflu\b|mpox|cacar monyet|campak|morbili|cacar air|tangan kaki mulut|hfmd|leptospirosis|tifus|thypoid|typhoid|kolera|rabies|gila anjing|anjing gila|anthrax|difteri|polio|meningitis|meningokokus|ensefalitis|chikungunya|cikungunya|zika|filariasis|kaki gajah|hepatitis|\bhiv\b|\baids\b|kusta|lepra|\bispa\b|pneumonia|bronkopneumonia|bronkitis|hmpv|human metapneumovirus|\brsv\b|\bmers\b|ebola|marburg|lassa|west nile|h5n1|avian influenza|\btbc\b|tuberkulosis|\btb\b|diare|disentri|scabies|kudis|keracunan|intoksikasi|rotavirus|flu burung|h1n1|malaria|gagal ginjal|serangan jantung|gagal jantung|henti jantung|stroke|gizi buruk|busung lapar|malnutrisi|donor darah|bank darah|transfusi darah|stok darah|obat palsu|talasemia|hemofilia|stunting|obesitas|vaksin|vaksinasi|imunisasi|kemenkes|bpom|faskes|puskesmas|kanker|miras oplosan|alkohol oplosan|oplosan maut|keracunan mbg|korban mbg|sppg|badan gizi nasional|makanan basi|bakteri pangan|salmonella|e\.?\s*coli|mual|muntah|dilarikan ke (?:rs|puskesmas|rumah sakit)|gejala keracunan|etilen glikol|dietilen glikol|cemaran obat|sirup beracun|obat sirup)/i,
  ekonomi:/(phk|rupiah|kurs dollar|inflasi|defisit|apbn|apbd|ihsg|bursa efek|saham|emiten|dividen|stock split|buyback|right issue|utang negara|subsidi|\bbbmm?\b|pertamax|solar(?!\s*panel)|listrik padam|padam listrik|pemadaman listrik|pertamina|\bpln\b|ojk|bank indonesia|umk\b|ump\b|thr\b|belanja negara|bea cukai|ekspor|impor|suku bunga|bappebti|kripto|bitcoin|pinjol|fintech|paylater|harga (cabai|beras|daging|minyak|emas))/i,
  politik:/(pilpres|pilkada|pilgub|pilbup|pilgici|pemilu|\bkpu\b|kpud|bawaslu|capres|cawapres|partai politik|caleg|capil|\bdpr\b|\bdprd\b|parlemen|fraksi|koalisi|oposisi|pelantikan|menteri|wakil presiden|\bistana\b|senayan|bansos|rapat paripurna|mahkamah konstitusi|impeachment|majelis kehormatan|reshuffle|menko|kadin|\bperang\b|\bkonflik\b|\binvasi\b|aneksasi|pendudukan|gencatan senjata|ultimatum|kudeta|pemberontakan|separatis|genosida|blokade|embargo|sandera|pertempuran|peluru kendali|\brudal\b|\bdron\b|serangan udara|perjanjian damai|perundingan damai|program mbg|makan bergizi)/i
};
const CAT_SKIP = /(pascabencana|pascagempa|pascabanjir|mitigasi|kesiapsiagaan(?!\s*(?:pengamanan|aparat|pasukan|personel|polri|tni|demo|unjuk rasa|aksi))|potensi bencana|rawan bencana|risiko bencana|kajian risiko|simulasi|edukasi|sosialisasi|pelatihan|antisipasi(?!\s*(?:demo|unjuk rasa|aksi|massa|kerusuhan|bentrok|keamanan|pengamanan))|siaga bencana|hadapi bencana|menghadapi bencana|asuransi|operasi patuh|ranperda|perda|godok|dana bencana|modus|ruu|boikot dirinya|perang harga|perang dagang|joget|cooking demo|demo (masak|memasak|kuliner|spesial)|liga|top skor|voli|sepak bola|piala|kualifikasi|gaun|mahalini|fashion|film|sinema|bioskop|trailer|teaser|poster|nonton|netflix|zombie|mayat hidup|hantu|sekuel|layar lebar|sinetron|sinetrik|penghargaan|jasa raharja|warisan|turun-temurun|sepanjang 20\d\d|berdampak ke ekonomi)/i;

const DOMAIN_CATS = ['siber', 'kesehatan', 'ekonomi', 'politik', 'kriminal'];
const PHYSICAL_ACT = {
  flood: /(?:terendam|merendam|menggenang|menggenangi|tergenang|ketinggian\s+\d+|air\s+meluap|tanggul\s+jebol|banjir\s+bandang|banjir\s+rob|hujan\s+deras|luapan\s+air)/i,
  insiden: /(?:kecelakaan|tabrakan|tertabrak|menabrak|terguling|anjlok|pesawat\s+jatuh|kapal\s+(?:karam|tenggelam)|pohon\s+tumbang|jembatan\s+(?:ambruk|putus)|gedung\s+ambruk|atap\s+roboh|meledak\s+di|ledakan\s+tabung|ledakan\s+bom)/i,
  disaster: /(?:gempa\b|magnitudo\b|m\s*[\d,.]+|kedalaman\s+\d+|skala\s+richter|erupsi|gunung\s+meletus|awan\s+panas|lahar|siklon|puting\s+beliung|angin\s+kencang|gelombang\s+tinggi)/i,
  fire: /(?:kebakaran|karhutla|terbakar|kobaran\s+api|ludes\s+dilalap|asap\s+tebal|damkar)/i
};
const METAPHOR_DISASTER = {
  flood: /(?:dibanjiri|membanjiri)|(?:banjir|kebanjiran)\s+(?:serangan|siber|cyber|orderan|hadiah|promo|diskon|bonus|cuan|kritik|hujatan|komentar|aduan|laporan|pujian|ucapan|impor|produk|pemudik|turis|wisatawan|penonton|pelamar|pendaftar|peserta|air mata|gol|darah)/i,
  disaster: /tsunami\s+(?:politik|protes|suara|pemilu|dukungan|saham|cuan|phk|vonis|anggaran|impor)|badai\s+(?:phk|ekonomi|krisis|politik|pemilu|kritik|inflasi|suara|cuan|rezeki|impor|kehidupan|hidup|rumah\s+tangga|ujian|cobaan)/i,
  insiden: /ledakan\s+(?:kasus|pasien|penderita|penduduk|order|penjualan|harga|promo|suara)|tabrakan\s+(?:kepentingan|argumen|opini|jadwal)|(?:ihsg|saham|rupiah|kurs|harga|suara|koalisi|rezim|pemerintah)\s+(?:ambruk|runtuh)/i,
  fire: /kebakaran\s+(?:jenggot|harga|promo|diskon)/i
};
const DOMAIN_ACTIVE_ACT = {
  siber: /(?:peretasan|peretas|diretas|dibajak|dibobol|hacker|ransomware|ddos|data\s+breach|kebocoran\s+data|bocor\s+data|serangan\s+siber|serangan\s+cyber|exploit|dieksploitasi|phishing|malware|vulnerabilit)/i,
  ekonomi: /(?:phk|rupiah\s+(?:melemah|anjlok)|ihsg\s+(?:anjlok|turun|terkoreksi)|inflasi|suku\s+bunga|kebijakan\s+tarif)/i,
  kesehatan: /(?:terjangkit|terinfeksi|tertular|positif|pasien|korban\s+keracunan|gejala|dilarikan\s+ke\s+rs)/i,
  politik: /(?:pilpres|pilkada|pelantikan|pemilu|sidang|reshuffle|perang|invasi|gencatan\s+senjata)/i,
  kriminal: /(?:ditembak|dibunuh|ditangkap|membunuh|merampok|tersangka|terorisme)/i
};
const CAT_PRECEDENCE = ['demo', 'fire', 'flood', 'disaster', 'siber', 'kesehatan', 'kriminal', 'ekonomi', 'politik', 'insiden'];

const resolveCategory = (ids, title) => {
  const candidates = new Set(ids);
  for (const c of candidates) {
    if (METAPHOR_DISASTER[c] && METAPHOR_DISASTER[c].test(title)) candidates.delete(c);
  }
  const hasDomain = DOMAIN_CATS.some(d => candidates.has(d));
  if (hasDomain) {
    for (const d of ['flood', 'disaster', 'insiden']) {
      if (candidates.has(d)) {
        const hasPhys = PHYSICAL_ACT[d] && PHYSICAL_ACT[d].test(title);
        if (!hasPhys) candidates.delete(d);
      }
    }
  }
  const physWinners = ['fire', 'flood', 'disaster'].filter(c => candidates.has(c) && PHYSICAL_ACT[c] && PHYSICAL_ACT[c].test(title));
  if (physWinners.length > 0) {
    for (const d of DOMAIN_CATS) {
      if (candidates.has(d)) {
        const hasActiveDomain = DOMAIN_ACTIVE_ACT[d] && DOMAIN_ACTIVE_ACT[d].test(title);
        if (!hasActiveDomain) candidates.delete(d);
      }
    }
  }
  for (const p of CAT_PRECEDENCE) {
    if (candidates.has(p)) return p;
  }
  return candidates.values().next().value || '';
};

const catOfTitle = t => {
  const isDemo = CAT_RE.demo && CAT_RE.demo.test(t);
  if (CAT_SKIP.test(t) && !isDemo) return '';
  const hits = new Set();
  for (const c of CAT_ORDER) if (CAT_RE[c] && CAT_RE[c].test(t)) hits.add(c);
  if (!hits.size) return '';
  return resolveCategory(hits, t);
};
const SRC_TAIL = /(kompas|antara|detik|cnn|tempo|liputan6|republika|tribun|cnbc|jpnn|okezone|jawapos|viva|kumparan|suara|radar|inilah|merdeka|indosport|youtube|news|bsinews|kabar|berita|radio|bmkg|bnpb|bpbd|kemendagri|kapolri|tni|voice|akurat|acehinfo|polda|polres|polsek|polresta|tribrata|tribatanews|tribratanews|times|update|harian|pos|post|media|koran|portal|suarakalbar|suarasurabaya|conversation|\btv\b)/i;
const DOMAIN_TAIL = /\.(?:com|id|net|org|co|asia|info|tv|xyz|online|site|biz|tech|me|app|pro|co\.[a-z]{2}|go\.[a-z]{2}|or\.[a-z]{2}|ac\.[a-z]{2}|sch\.[a-z]{2}|my\.id|web\.id|biz\.id)(?:\:[0-9]+)?$/i;
const cleanTitle = (t, pub) => {
  let s0 = String(t || '').trim();
  const pp = s0.indexOf(' | ');
  if (pp > 15) s0 = s0.slice(0, pp).trim();
  const pcm = s0.match(/\s*::\s*\S/);
  if (pcm && pcm.index > 15) s0 = s0.slice(0, pcm.index).trim();

  s0 = s0.replace(/^(?:(?:breaking\s+news|berita\s+video|video|foto|live|eksklusif|update|terkini)\s*[-–—:]\s*)+/i, '').trim();

  if (pub) {
    const pk = String(pub).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (pk.length >= 3) {
      s0 = s0.replace(new RegExp('(?:\\s+[-–—]+\\s*|\\s*[-–—|•·]+\\s*)' + pk + '\\s*$', 'i'), '').trim();
    }
  }

  let s = s0.replace(/\s+[-–—]+\s*(?:https?:\/\/|www\.)\S+$/i, '').trim();
  for (let i = 0; i < 4; i++) {

    const m = s.match(/^(.{8,}?)(?:\s+[-–—]+\s*|\s*[|•·]\s*)([A-Za-z0-9][A-Za-z0-9.&'®™()_\-\s]{1,70})$/);
    if (!m) break;
    const tail = m[2].trim();
    const words = tail.split(/\s+/).map(w => w.replace(/[®™]/g, '')).filter(Boolean);
    if (words.length > 6) break;

    const isDomain = DOMAIN_TAIL.test(tail) || /\.[a-z]{2,8}$/i.test(tail);
    const isKnown = SRC_TAIL.test(tail);
    const isTitleCase = words.length <= 5 && words.every(w => /^[A-Z0-9]/.test(w));
    const isGovPub = /^(?:pemerintah|pemkab|pemkot|polresta|polres|polsek|polda|diskominfo|humas)\b/i.test(tail);
    const isShortSlug = words.length <= 3 && tail.length <= 30 && !/[,;?!]/.test(tail);

    const isPub = isDomain || isKnown || isTitleCase || isGovPub || (isShortSlug && words.every(w => /^[a-z0-9]/.test(w)));
    if (!isPub) break;
    s = m[1].trim();
  }
  return s;
};
const tkPub = v => {
  v = String(v || '').trim();
  if (/^(https?:)?\/\//i.test(v) || /^www\./i.test(v)) {
    try { return new URL(/^www\./i.test(v) ? 'https://' + v : v).hostname.replace(/^www\./i, ''); } catch (e) { return ''; }
  }
  return v;
};
const cleanSrc = (src, pub) => {
  const p = tkPub(pub);
  if (p) {
    const wc = (typeof window !== 'undefined' && window.WireCore) || (typeof WireCore !== 'undefined' ? WireCore : null);
    const branded = (wc && wc.cleanSiteName) ? wc.cleanSiteName(p, '') : p;
    return branded.replace(/\s*[·•|–—-]\s*(?:kesehatan|keracunan|bencana|banjir|kebakaran|demo|kriminal|ekonomi|politik|siber|lingkungan|insiden|metro|nasional|internasional|hukum|daerah|regional|situasi|feed|news|update|terkini|breaking).*$/i, '').trim() || branded;
  }
  let s = String(src || '').trim();
  if (/^GNEWS\s*[·•|–—-]/i.test(s)) return 'GNEWS';
  return s.replace(/\s*[·•|–—-]\s*(?:kesehatan|keracunan|bencana|banjir|kebakaran|demo|kriminal|ekonomi|politik|siber|lingkungan|insiden|metro|nasional|internasional|hukum|daerah|regional|situasi|feed|news|update|terkini|breaking).*$/i, '').trim() || s;
};
let SIT = null, SIT_STALE = false;
let openCluster = '', openAlert = '', SIG_GROUPS = [];
const clToastQ = new Map(), clToastOrder = []; let clToastActiveEl = null;
let PULSE = [], DIS_PULSE = [], globeReady = false, globeCtx = null, globeIdn = null, globeProv = null, globeRaf = 0, globeLast = 0, globePoints = [], globeNodePoints = [], globeProj = null, globeCenter = [118, 0];
let globeActInc = '', globeActNode = '';
let globeShakeX = 0, globeShakeY = 0;
let activeGlobeQuake = null;
const legendOn = { ...Object.fromEntries(Object.keys(CAT_GEO).map(c => [c, true])), gempa: true, gunung: true };
const legendKeyOf = p => p.sub === 'gempa' ? 'gempa' : p.sub === 'volcano' ? 'gunung' : p.kind;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const view = { lon: 118, lat: -2.5, zoom: 2.2 };
const ZOOM_MAX = 48;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
let flyAnim = null, lastGestEnd = -1e9, globeSuppressClick = 0, gesture = null;
let globePtrType = 'mouse';
let globeActNodeKey = '', globeActNodeAt = 0;
const ptrs = new Map();

const hexA = (hex, a) => {
  const n = hex.replace('#', '');
  const v = n.length === 3 ? n.split('').map(c => c + c).join('') : n.padEnd(6, '0');
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};
function fetchGlobe(){
  if (globeReady) return Promise.resolve(true);
  const grab = (url) => fetch(url, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  });
  return Promise.allSettled([
    grab('/world110.geo.json'),
    grab('/idn.geo.json'),
    grab('/idn-prov.geo.json')
  ]).then(results => {
    const [ctx, idn, prov] = results.map(r => r.status === 'fulfilled' ? r.value : null);
    globeCtx = ctx;
    globeIdn = idn;
    globeProv = prov;
    globeReady = !!(globeIdn || globeCtx || globeProv);
    if (!globeIdn && !globeCtx) console.error('GeoJSON dunia/Indonesia gagal dimuat');
    return globeReady;
  });
}
function globeProject(){
  const c = $('#sit-globe');
  const w = c.clientWidth, h = c.clientHeight;
  const r = (Math.min(w, h) / 2 - 8) * view.zoom;
  return d3.geoOrthographic()
    .rotate([-view.lon, -view.lat])
    .translate([w / 2, h / 2 + 2])
    .scale(r)
    .clipAngle(90);
}
const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function zoomAt(cx, cy, factor){
  const c = $('#sit-globe'); if (!c || !globeProj) { view.zoom = clampN(view.zoom * factor, 0.9, ZOOM_MAX); return; }
  flyAnim = null; globeVel = null;
  const proj = globeProject();
  const rect = c.getBoundingClientRect();
  const z2 = clampN(view.zoom * factor, 0.9, ZOOM_MAX);
  const k = z2 / view.zoom;
  view.zoom = z2;
  if (k === 1 || !proj.invert) return;
  const inv = proj.invert([cx - rect.left, cy - rect.top]);
  if (!inv || !isFinite(inv[0]) || !isFinite(inv[1])) return;
  const loP = inv[0], laP = inv[1];
  if (Math.abs(laP) > Math.PI / 2 || Math.abs(loP) > Math.PI) return;
  const laC = view.lat * Math.PI / 180, loC = view.lon * Math.PI / 180;
  const clamp1 = v => Math.min(1, Math.max(-1, v));
  const cosT = Math.sin(laC) * Math.sin(laP) + Math.cos(laC) * Math.cos(laP) * Math.cos(loP - loC);
  const theta = Math.acos(clamp1(cosT));
  const sinT = Math.sin(theta);
  if (sinT < 1e-6) return;
  const theta2 = Math.asin(clamp1(sinT / k));
  const d = theta - theta2;
  if (Math.abs(d) < 1e-9) return;
  const A = [Math.cos(laC) * Math.cos(loC), Math.cos(laC) * Math.sin(loC), Math.sin(laC)];
  const B = [Math.cos(laP) * Math.cos(loP), Math.cos(laP) * Math.sin(loP), Math.sin(laP)];
  const om = theta, so = Math.sin(om), t = d / om;
  const sA = Math.sin((1 - t) * om) / so, sB = Math.sin(t * om) / so;
  view.lat = clampN(Math.asin(clamp1(A[2] * sA + B[2] * sB)) * 180 / Math.PI, -80, 80);
  view.lon = Math.atan2(A[1] * sA + B[1] * sB, A[0] * sA + B[0] * sB) * 180 / Math.PI;
  view.lon = ((view.lon + 540) % 360) - 180;
}
function flyTo(lat, lon, zoom, kind){
  globeVel = null;

  let dLon = lon - view.lon;
  while (dLon > 180) dLon -= 360;
  while (dLon < -180) dLon += 360;

  flyAnim = { from: { lon: view.lon, lat: view.lat, zoom: view.zoom },
    to: { lon: view.lon + dLon, lat, zoom: clampN(zoom || view.zoom, 0.9, ZOOM_MAX) },
    start: performance.now(), dur: 1150, kind: kind || null };
  wakeGlobe();
}
function tickFly(now){
  if (!flyAnim) return;
  const t = clampN((now - flyAnim.start) / flyAnim.dur, 0, 1);
  const e = easeInOutCubic(t);
  view.lon = flyAnim.from.lon + (flyAnim.to.lon - flyAnim.from.lon) * e;
  view.lon = ((view.lon + 540) % 360) - 180;
  view.lat = flyAnim.from.lat + (flyAnim.to.lat - flyAnim.from.lat) * e;
  view.zoom = flyAnim.from.zoom + (flyAnim.to.zoom - flyAnim.from.zoom) * e;

  if (t >= 1) {
    if (flyAnim.kind === 'home') focusedHome = true;
    flyAnim = null;
  }
}
const SEEN_KEY = 'sitrep.seenIds.ev2';
const seenIds = new Set((() => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } })());
const seenWasEmpty = seenIds.size === 0;
const bootUntil = seenWasEmpty ? Date.now() + 150e3 : 0;
const focusHoldUntil = Date.now() + 20000;
const saveSeen = () => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenIds].slice(-3000))); } catch (e) {} };
const itemIdOf = p => p.eid || p.url || ((p.title || '') + '|' + (p.src || ''));
const focusQueue = [];
let lastAutoFocus = 0, lastRotFocus = 0, focusedHome = true;
const rotSeen = new Map();
const FOCUS_COOLDOWN = 90000;
const ROTATE_MS = 4 * 60e3;
const ROT_SEEN_MS = 60 * 60e3;
const HOME_VIEW = { lat: -2.5, lon: 118, zoom: 2.2 };
const MAG_MIN_FOCUS = 4.5;
const magOf = p => {
  if (typeof p.mag === 'number') return p.mag;
  const m = String(p.title || '').match(/\b(?:m|mag)\.?\s*[:=]?\s*(\d+[.,]\d)/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

