'use strict';

const OFFICIAL_HANDLES = new Set([
  'infobmkg', 'bnpb_indonesia', 'basarnas', 'damkardki', 'tmcpoldametro',
  'halo_polisi', 'divhumas_polri', 'puspentni', 'kemkesri', 'bssn_ri',
  'pvmbg_', 'pvmbg', 'bpbd_dki', 'bpbdjabar', 'bpbdjatim', 'bpbdjateng',
  'pln_123', 'infobps', 'kemenhub151', 'komdigi_id', 'kemenkominfo',
]);

const OFFICIAL_HANDLE_RE = /^(?:info)?(?:bmkg|bnpb|bpbd|basarnas|pvmbg|bssn|damkar|polres|polda|polsek|tmcpolda|divhumas|puspen|kemkes|kemenkes|kemenhub|komdigi|pemprov|pemkot|pemkab)(?:[._-]|$)/i;

const NEWS_OUTLET_HANDLES = new Set([
  'detikcom', 'kompascom', 'kompastv', 'cnnindonesia', 'cnbcindonesia',
  'antaranews', 'liputan6', 'tempodotco', 'tribunnews', 'tribunjogja',
  'republikaonline', 'merdekadotcom', 'sindonews', 'okezonecom', 'jawapos',
  'inewsdotid', 'tvonenews', 'metrotv', 'elshinta', 'elshinta90fm',
  'suarasurabayamedia', 'kumparancom', 'vivanews', 'bisniscom', 'kontannews',
  'rri_co_id', 'beritasatu', 'idntimes', 'tirtoid', 'vice_id',
]);

const NEWS_HANDLE_RE = /(?:detik|kompas|cnnind|cnbcind|antara|liputan6|tempo|tribun|republika|merdeka|sindo|okezone|jawapos|inews|tvone|metrotv|elshinta|suarasurabaya|kumparan|beritasatu|rri)(?:com|tv|id|news|dotco|fm|media)?$/i;

const PROVENANCE_WEIGHTS = Object.freeze({
  official_agency: 1.0,
  news_outlet: 0.85,
  eyewitness: 0.72,
  anonymous: 0.35,
});

const STOP_WORDS = new Set((
  'yang dan di ke dari untuk pada dengan adalah ini itu ada tidak akan juga telah sudah bisa lebih sangat ' +
  'para dia kami kita mereka sebuah seorang suatu saat ketika setelah sebelum hingga oleh karena maka jika ' +
  'hari minggu senin selasa rabu kamis jumat sabtu kini tadi barusan sekarang baru saja info update berita ' +
  'kabar terkini viral breaking news via oleh rt'
).split(' '));

function cleanHandle(post) {
  return String((post && (post.handle || post.username || post.user || post.author)) || '')
    .toLowerCase()
    .replace(/^@/, '')
    .trim();
}

function classifySourceProvenance(post, assessment) {
  const handle = cleanHandle(post);
  const a = assessment || (post && post.assessment) || null;
  const text = String((post && post.text) || '');

  let sourceType = 'anonymous';
  let reason = 'unverified_social_account';

  if (handle && (OFFICIAL_HANDLES.has(handle) || OFFICIAL_HANDLE_RE.test(handle))) {
    sourceType = 'official_agency';
    reason = 'verified_official_handle';
  } else if (handle && (NEWS_OUTLET_HANDLES.has(handle) || NEWS_HANDLE_RE.test(handle))) {
    sourceType = 'news_outlet';
    reason = 'recognized_news_handle';
  } else if (a && a.intent === 'eyewitness_report' && !/^\s*RT\s+@/i.test(text)) {
    sourceType = 'eyewitness';
    reason = 'firsthand_eyewitness_markers';
  } else if (a && a.event && a.event.sourceType === 'eyewitness' && !/^\s*RT\s+@/i.test(text)) {
    sourceType = 'eyewitness';
    reason = 'eyewitness_event_framing';
  }

  return {
    sourceType,
    authorityWeight: PROVENANCE_WEIGHTS[sourceType] || 0.35,
    handle: handle ? '@' + handle : '',
    reason,
    engagementExcludedFromCredibility: true,
  };
}

function stripBoilerplateForSimilarity(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*(?:rt|repost)\s+@[\w.]+:?\s*/i, '')
    .replace(/\b(?:via|sumber|source|credit|cc)\s*[:@]?\s*@?[\w.]+\b/gi, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/@[\w.]+/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityTokens(text) {
  const clean = stripBoilerplateForSimilarity(text);
  return [...new Set(clean.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w)))];
}

function jaccardSimilarity(tokensA, tokensB) {
  const setA = tokensA instanceof Set ? tokensA : new Set(tokensA);
  const setB = tokensB instanceof Set ? tokensB : new Set(tokensB);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}

function isNearDuplicate(textA, textB, threshold = 0.78) {
  const normA = stripBoilerplateForSimilarity(textA);
  const normB = stripBoilerplateForSimilarity(textB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const tokA = similarityTokens(normA);
  const tokB = similarityTokens(normB);
  if (tokA.length < 3 || tokB.length < 3) return false;
  return jaccardSimilarity(tokA, tokB) >= threshold;
}

function canonicalUrlKey(post) {
  const u = String((post && post.url) || '').trim().toLowerCase().replace(/\?.*$/, '').replace(/\/+$/, '');
  return u || String((post && post.code) || '').trim();
}

function representativePriority(post) {
  if (!post) return 0;
  const prov = (post.assessment && post.assessment.provenance) || classifySourceProvenance(post, post.assessment);
  const auth = Number(prov && prov.authorityWeight) || 0.35;
  const sig = post.assessment && post.assessment.signalEligible === true ? 1 : 0;
  const media = (Array.isArray(post.media) && post.media.length > 0) || (Array.isArray(post.images) && post.images.length > 0) || !!post.has_media ? 0.1 : 0;
  return auth * 10 + sig * 2 + media;
}

const MICRO_QUAKE_RE = /\b(?:info\s+gempa(?:\s+[^.\n]{0,80}\bmag(?:nitudo)?)?|gempa\s+mag(?:nitudo)?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i;
const QUAKE_MAG_RE = /(?:gempa[^.\n]{0,60}\b(?:mag(?:nitudo)?|sr|\bm)\s*[:=]?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:sr|mag|magnitudo)\b)/i;
const QUAKE_IMPACT_RE = /\b(?:dirasakan|terasa|kerasa|\bmmi\b|tsunami|rusak|roboh|retak|korban|evakuasi|panik|susulan|mengguncang|guncang|bergetar|bergoyang|berhamburan|luka|tewas|meninggal|ambruk|hancur)\b/i;

function extractQuakeSignature(post) {
  const txt = String((post && post.text) || '');
  const m = MICRO_QUAKE_RE.exec(txt) || QUAKE_MAG_RE.exec(txt);
  const impact = QUAKE_IMPACT_RE.test(txt);
  if (!m && !impact) return null;
  const rawMag = m ? (m[1] || m[2]) : '';
  const mag = rawMag ? parseFloat(String(rawMag).replace(',', '.')) : NaN;
  const ts = Number(post && post.ts) || Date.parse((post && post.created_at) || '') || 0;
  return { mag: Number.isFinite(mag) ? mag : null, impact, ts };
}

function canFoldQuakePair(qA, qB) {
  if (!qA && !qB) return true;
  if (!qA || !qB) return false;
  if (qA.impact !== qB.impact) return false;
  if (qA.mag !== null && qB.mag !== null) {
    if ((qA.mag >= 4.0 || qB.mag >= 4.0 || qA.impact) && Math.abs(qA.mag - qB.mag) > 0.2) return false;
  }
  if ((qA.mag >= 4.0 || qB.mag >= 4.0 || qA.impact) && qA.ts && qB.ts && Math.abs(qA.ts - qB.ts) > 10 * 60e3) {
    return false;
  }
  return true;
}

function microQuakeBucketKey(post) {
  const txt = String((post && post.text) || '');
  const m = MICRO_QUAKE_RE.exec(txt);
  if (!m) return '';
  const mag = parseFloat(String(m[1]).replace(',', '.'));
  if (!Number.isFinite(mag) || mag >= 4.0 || QUAKE_IMPACT_RE.test(txt)) return '';
  const ts = Number(post.ts) || Date.parse(post.created_at || '') || 0;
  return 'microquake:' + Math.floor(ts / (2 * 3600e3));
}

function deduplicatePosts(posts, opts = {}) {
  const threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 0.72;
  const windowSize = Number(opts.windowSize) > 0 ? Number(opts.windowSize) : 320;
  const foldMicroQuakes = !!opts.foldMicroQuakes;
  const sorted = (posts || []).slice().sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  const unique = [];
  const seenUrls = new Set();
  const seenExact = new Map();
  const seenMicroQuakes = new Map();

  const foldInto = (parent, candidate, plat, candNorm) => {
    parent.duplicateCount++;
    parent.repostVariants.push({ platform: plat, handle: cleanHandle(candidate), url: candidate.url || '' });
    if (candNorm) parent._norms.add(candNorm);
    const cu = canonicalUrlKey(candidate);
    if (cu) parent._urls.add(cu);
    if (representativePriority(candidate) > representativePriority(parent.post)) {
      parent.post = candidate;
    }
  };

  for (const p of sorted) {
    if (!p || !p.text) continue;
    const uKey = canonicalUrlKey(p);
    const plat = String(p.from || p.platform || (p.code ? 'threads' : 'x')).toLowerCase();
    if (uKey && seenUrls.has(plat + '|' + uKey)) continue;
    if (uKey) seenUrls.add(plat + '|' + uKey);

    const norm = stripBoilerplateForSimilarity(p.text);
    if (foldMicroQuakes) {
      const mqKey = microQuakeBucketKey(p);
      if (mqKey) {
        if (seenMicroQuakes.has(mqKey)) {
          foldInto(seenMicroQuakes.get(mqKey), p, plat, norm);
          continue;
        }
      }
    }

    if (!norm) continue;

    if (seenExact.has(norm)) {
      foldInto(seenExact.get(norm), p, plat, norm);
      continue;
    }

    const pToks = new Set(similarityTokens(norm));
    const pQuake = extractQuakeSignature(p);
    let matched = null;
    const startIdx = Math.max(0, unique.length - windowSize);
    for (let i = startIdx; i < unique.length; i++) {
      const cand = unique[i];
      if (!canFoldQuakePair(pQuake, cand._quake)) continue;
      if (pToks.size >= 4 && cand._toks.size >= 4 && jaccardSimilarity(pToks, cand._toks) >= threshold) {
        matched = cand;
        break;
      }
    }
    if (matched) {
      foldInto(matched, p, plat, norm);
      continue;
    }

    const entry = {
      post: p,
      norm,
      _toks: pToks,
      _quake: pQuake,
      _norms: new Set([norm]),
      _urls: new Set(uKey ? [uKey] : []),
      duplicateCount: 1,
      repostVariants: [{ platform: plat, handle: cleanHandle(p), url: p.url || '' }],
    };
    seenExact.set(norm, entry);
    if (foldMicroQuakes) {
      const mqKey = microQuakeBucketKey(p);
      if (mqKey && !seenMicroQuakes.has(mqKey)) seenMicroQuakes.set(mqKey, entry);
    }
    unique.push(entry);
  }

  return unique.map(({ _toks, _quake, _norms, _urls, ...rest }) => ({
    ...rest,
    memberKeys: [..._urls, ..._norms],
  }));
}

const GENERIC_EVENT_TOKENS = new Set([
  'banjir', 'gempa', 'kebakaran', 'kecelakaan', 'longsor', 'demo', 'unjuk', 'rasa',
  'warga', 'rumah', 'jalan', 'kota', 'kabupaten', 'provinsi', 'indonesia', 'jakarta',
  'bandung', 'surabaya', 'bekasi', 'depok', 'bogor', 'tangerang', 'semarang',
  'terjadi', 'melanda', 'merendam', 'terbakar', 'ambruk', 'korban', 'evakuasi',
  'luka', 'tewas', 'meninggal', 'polisi', 'bpbd', 'bmkg', 'damkar', 'bnpb',
]);

function eventSpecificTokens(evText, placeName) {
  const placeSet = new Set(String(placeName || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return new Set(
    similarityTokens(evText).filter(t => t.length >= 4 && !GENERIC_EVENT_TOKENS.has(t) && !placeSet.has(t))
  );
}

const RARE_TYPES = new Set(['earthquake', 'tsunami', 'eruption', 'ransomware', 'data_breach', 'ddos', 'maritime_accident', 'wildfire']);

function canClusterEvents(evA, evB, timeWindowMs) {
  if (!evA || !evB) return false;
  if (Math.abs((evA.ts || 0) - (evB.ts || 0)) > timeWindowMs) return false;
  if (evA.category !== evB.category || evA.eventType !== evB.eventType) return false;

  const locA = String(evA.locationName || '').toLowerCase().trim();
  const locB = String(evB.locationName || '').toLowerCase().trim();
  if (locA && locB && locA !== locB) return false;
  if (!locA || !locB) {

    const tA = String(evA.target || '').toLowerCase().trim();
    const tB = String(evB.target || '').toLowerCase().trim();
    if (!tA || !tB || tA !== tB) return false;
  }

  const provA = String(evA.prov || '').toLowerCase().trim();
  const provB = String(evB.prov || '').toLowerCase().trim();
  if (provA && provB && provA !== provB) return false;

  let shared = 0;
  for (const t of evA.specTokens) if (evB.specTokens.has(t)) shared++;
  const union = evA.specTokens.size + evB.specTokens.size - shared;
  const jac = union ? shared / union : 0;

  if (RARE_TYPES.has(evA.eventType)) {
    return shared >= 1 && jac >= 0.12;
  }
  return shared >= 2 && jac >= 0.18;
}

function clusterIncidents(posts, opts = {}) {
  const timeWindowMs = opts.timeWindowMs || 90 * 60 * 1000;
  const eligible = (posts || []).filter(p => p && p.assessment && p.assessment.signalEligible === true && Array.isArray(p.assessment.events) && p.assessment.events.length > 0);
  const deduped = deduplicatePosts(eligible);

  const clusters = [];
  for (const item of deduped) {
    const p = item.post;
    const prov = p.assessment.provenance || classifySourceProvenance(p, p.assessment);
    const ev = p.assessment.events[0];
    const locName = (ev.location && ev.location.name) || '';
    const record = {
      post: p,
      duplicateCount: item.duplicateCount,
      repostVariants: item.repostVariants,
      memberKeys: item.memberKeys || [],
      provenance: prov,
      ts: Number(p.ts) || Date.parse(p.created_at || '') || 0,
      category: ev.category,
      eventType: ev.type,
      locationName: locName,
      prov: (ev.location && ev.location.prov) || '',
      target: ev.target || '',
      specTokens: eventSpecificTokens(ev.evidence || p.text, locName),
    };

    const match = clusters.find(cl => cl.records.every(r => canClusterEvents(r, record, timeWindowMs)));
    if (match) {
      match.records.push(record);
    } else {
      clusters.push({ records: [record] });
    }
  }

  return clusters.map(cl => {
    const independentAccounts = new Set();
    const platforms = new Set();
    const sourceTypes = new Set();
    const memberKeys = new Set();
    let totalCopies = 0;
    let maxAuth = 0;
    let latestTs = 0;

    for (const r of cl.records) {
      totalCopies += r.duplicateCount;
      for (const mk of r.memberKeys || []) memberKeys.add(mk);
      for (const v of r.repostVariants) platforms.add(v.platform);
      if (r.provenance.handle) independentAccounts.add(r.provenance.sourceType + ':' + r.provenance.handle);
      sourceTypes.add(r.provenance.sourceType);
      if (r.provenance.authorityWeight > maxAuth) maxAuth = r.provenance.authorityWeight;
      if (r.ts > latestTs) latestTs = r.ts;
    }

    const hasOfficial = sourceTypes.has('official_agency');
    const hasNews = sourceTypes.has('news_outlet');
    const hasEyewitness = sourceTypes.has('eyewitness');
    const independentClaims = cl.records.length;

    const corroborationLevel = hasOfficial
      ? 'official_confirmed'
      : (independentClaims >= 2 && (hasNews || hasEyewitness || independentAccounts.size >= 2))
        ? 'multi_source_corroborated'
        : hasEyewitness
          ? 'single_source_eyewitness'
          : 'uncorroborated';

    const sortedRecs = cl.records.slice().sort((a, b) => (b.provenance.authorityWeight - a.provenance.authorityWeight) || (b.ts - a.ts));
    const rep = sortedRecs[0];

    return {
      category: rep.category,
      eventType: rep.eventType,
      location: rep.locationName || rep.target || 'unknown',
      latestTs,
      independentClaims,
      independentAccounts: independentAccounts.size,
      totalCopiesWithDuplicates: totalCopies,
      platforms: [...platforms],
      corroborationLevel,
      hasOfficialSource: hasOfficial,
      hasNewsOutlet: hasNews,
      hasEyewitness,
      authorityScore: +maxAuth.toFixed(2),
      representative: rep.post,
      posts: sortedRecs.map(r => r.post),
      memberKeys: [...memberKeys],
    };
  }).sort((a, b) => (b.authorityScore - a.authorityScore) || (b.latestTs - a.latestTs));
}

function postSpecificTokens(post, locName) {
  const a = post && post.assessment;
  const evText = (a && a.events && a.events[0] && a.events[0].evidence) || (post && post.text) || '';
  return eventSpecificTokens(evText, locName || '');
}

function matchPostToNews(post, newsEvents, now) {
  if (!Array.isArray(newsEvents) || !newsEvents.length || !post) return null;
  const a = post.assessment || {};
  const ts = Number(post.ts) || Date.parse(post.created_at || '') || now;
  const ev = Array.isArray(a.events) && a.events[0];
  const loc = String((ev && ev.location && ev.location.name) || (a.geographicContext && a.geographicContext.name) || '').toLowerCase().trim();
  const kabCode = String((ev && ev.location && ev.location.kabCode) || (a.geographicContext && a.geographicContext.kabCode) || '').trim();
  const cat = String((ev && ev.category) || '').toLowerCase().trim();
  const tps = new Set((post.topics || a.topics || []).map(x => String(x).toLowerCase()));
  const pToks = postSpecificTokens(post, loc);
  let best = null;
  let bestScore = 0;

  for (const ne of newsEvents) {
    if (!ne) continue;
    const neTs = Number(ne.ts) || 0;
    if (neTs && Math.abs(ts - neTs) > 12 * 3600e3) continue;
    const neLoc = String(ne.loc || '').toLowerCase().trim();
    const neKab = String(ne.kabCode || '').trim();
    const neCat = String(ne.cat || '').toLowerCase().trim();
    const sameCat = (cat && neCat && cat === neCat) || (neCat && tps.has(neCat)) || (ne.topic && tps.has(ne.topic));
    const sameLoc = !!(kabCode && neKab && kabCode === neKab) || !!(loc && neLoc && (loc === neLoc || loc.includes(neLoc) || neLoc.includes(loc)));
    if (loc && neLoc && !sameLoc) continue;
    if (cat && neCat && !sameCat) continue;

    let shared = 0;
    if (ne.tokens && pToks.size) {
      for (const tok of ne.tokens) if (pToks.has(tok)) shared++;
    }
    let s = 0;
    if (sameLoc && sameCat) s = 3 + shared + Math.min(2, Number(ne.count) || 1) * 0.4;
    else if (sameLoc && shared >= 1) s = 2.5 + shared;
    else if (sameCat && shared >= 2) s = 2 + shared * 0.8;
    else if (shared >= 3) s = shared;
    if (s > bestScore) {
      bestScore = s;
      best = ne;
    }
  }
  if (!best) return null;
  return {
    status: 'confirmed',
    count: Math.max(1, Number(best.count) || 1),
    title: best.title || '',
    url: best.url || '',
  };
}

function collapseSocialFeed(posts, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const allCombined = Array.isArray(opts.corroborationPool) && opts.corroborationPool.length ? opts.corroborationPool : posts;
  const clusters = clusterIncidents(allCombined, { timeWindowMs: opts.timeWindowMs || 90 * 60 * 1000 });
  const postToCluster = new Map();
  for (const cl of clusters) {
    for (const k of cl.memberKeys || []) {
      if (k && !postToCluster.has(k)) postToCluster.set(k, cl);
    }
    for (const member of cl.posts || []) {
      const u = canonicalUrlKey(member);
      const n = stripBoilerplateForSimilarity(member.text);
      if (u && !postToCluster.has(u)) postToCluster.set(u, cl);
      if (n && !postToCluster.has(n)) postToCluster.set(n, cl);
    }
  }

  const deduped = deduplicatePosts(posts, {
    threshold: Number(opts.threshold) || 0.72,
    windowSize: Number(opts.windowSize) || 320,
    foldMicroQuakes: opts.foldMicroQuakes !== false,
  });

  deduped.sort((a, b) => {
    const aSig = a.post && a.post.assessment && a.post.assessment.signalEligible === true ? 1 : 0;
    const bSig = b.post && b.post.assessment && b.post.assessment.signalEligible === true ? 1 : 0;
    if (bSig !== aSig) return bSig - aSig;
    const aPri = representativePriority(a.post);
    const bPri = representativePriority(b.post);
    if (bPri !== aPri) return bPri - aPri;
    return (Number(b.post && b.post.ts) || 0) - (Number(a.post && a.post.ts) || 0);
  });

  const newsEvents = Array.isArray(opts.newsEvents) ? opts.newsEvents : [];
  const authorHourly = Object.create(null);
  const authorTotal = Object.create(null);
  const out = [];

  for (const item of deduped) {
    const p = item.post;
    if (!p) continue;
    const u = cleanHandle(p);
    const isSig = !!(p.assessment && p.assessment.signalEligible === true);
    const isAgency = !!(u && (OFFICIAL_HANDLES.has(u) || OFFICIAL_HANDLE_RE.test(u)));
    const ts = Number(p.ts) || Date.parse(p.created_at || '') || now;
    if (u && !(isSig && isAgency)) {
      const hourBucket = Math.floor(ts / 3600e3);
      const hKey = `${u}|${hourBucket}`;
      const maxPerHour = isAgency ? 4 : isSig ? 3 : 2;
      const maxTotal = isAgency ? 10 : isSig ? 6 : 4;
      if ((authorHourly[hKey] || 0) >= maxPerHour || (authorTotal[u] || 0) >= maxTotal) continue;
      authorHourly[hKey] = (authorHourly[hKey] || 0) + 1;
      authorTotal[u] = (authorTotal[u] || 0) + 1;
    }

    const prov = (p.assessment && p.assessment.provenance) || classifySourceProvenance(p, p.assessment);
    const uKey = canonicalUrlKey(p);
    const nKey = stripBoilerplateForSimilarity(p.text);
    const cl = (uKey && postToCluster.get(uKey)) || (nKey && postToCluster.get(nKey)) || null;
    const corroboration = cl ? cl.corroborationLevel : (prov.sourceType === 'official_agency' ? 'official_confirmed' : prov.sourceType === 'eyewitness' ? 'single_source_eyewitness' : 'uncorroborated');
    const independentClaims = cl ? cl.independentClaims : 1;
    const crossPlatforms = [...new Set([
      ...(item.repostVariants || []).map(v => v.platform),
      ...(cl ? cl.platforms : []),
    ].filter(Boolean))];
    const foldedHandles = [...new Set((item.repostVariants || []).map(v => v.handle).filter(h => h && h !== u))].slice(0, 6);

    let newsMatch = matchPostToNews(p, newsEvents, now);
    if (!newsMatch && isSig && (corroboration === 'multi_source_corroborated' || prov.sourceType === 'official_agency' || prov.sourceType === 'eyewitness')) {
      newsMatch = { status: 'early_warning', count: 0 };
    }

    const ageH = Math.max(0, (now - ts) / 3600e3);
    const hasMedia = (Array.isArray(p.media) && p.media.length > 0) || (Array.isArray(p.images) && p.images.length > 0) || !!p.has_media;
    const hasEventLoc = !!(p.assessment && p.assessment.geographicContext && p.assessment.geographicContext.role === 'event_location');
    const baseScore =
      (Number(prov.authorityWeight) || 0.35) +
      (isSig ? 0.55 : 0) +
      (corroboration === 'official_confirmed' ? 0.35 : corroboration === 'multi_source_corroborated' ? 0.28 : corroboration === 'single_source_eyewitness' ? 0.14 : 0) +
      (newsMatch && newsMatch.status === 'confirmed' ? 0.35 : newsMatch && newsMatch.status === 'early_warning' ? 0.22 : 0) +
      (hasMedia ? 0.08 : 0) +
      (hasEventLoc ? 0.12 : 0);
    const score = +(baseScore / (1 + ageH * 0.42)).toFixed(3);

    out.push({
      ...p,
      intel: {
        dupCount: item.duplicateCount,
        foldedHandles,
        crossPlatforms,
        sourceType: prov.sourceType,
        corroboration,
        independentClaims,
        ...(newsMatch ? { newsMatch } : {}),
        score,
      },
    });
  }

  out.sort((a, b) => ((b.intel && b.intel.score) || 0) - ((a.intel && a.intel.score) || 0) || (Number(b.ts) || 0) - (Number(a.ts) || 0));
  return out;
}

module.exports = {
  OFFICIAL_HANDLES,
  NEWS_OUTLET_HANDLES,
  PROVENANCE_WEIGHTS,
  classifySourceProvenance,
  stripBoilerplateForSimilarity,
  similarityTokens,
  jaccardSimilarity,
  isNearDuplicate,
  deduplicatePosts,
  clusterIncidents,
  matchPostToNews,
  eventSpecificTokens,
  collapseSocialFeed,
};
