const I = {
  reply: ic('reply'),
  rt: ic('rt'),
  like: ic('like'),
  views: ic('views'),
  share: ic('share'),
  x: ic('x')
};
const VF = `<svg class="ic solid vf" aria-label="Terverifikasi" role="img"><use href="#i-verified"></use></svg>`;

let xLastErr = '';
let xPosts = [], xQuery = '', xQueries = [], xTrending = [], xSeen = new Set(), xFresh = new Set(), xReveal = new Set(), xSkTimer = 0;
const xAll = new Map(); let xShown = 30;

let xCold = false, xEmptyStreak = 0, xErrStreak = 0;

function linkify(t){
  return esc(deEmoji(t))
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/(https?:\/\/[^\s<]+)/g, (m, u) => {
      const label = u.replace(/^https?:\/\//,'').replace(/\/$/,'');
      return `<a href="${u}" target="_blank" rel="noopener noreferrer">${label.length > 42 ? label.slice(0,42) + '…' : label}</a>`;
    })
    .replace(/(^|\s)@([A-Za-z0-9_]{2,15})/g, (m, pre, h) =>
      `${pre}<a href="https://x.com/${h}" target="_blank" rel="noopener noreferrer">@${h}</a>`)
    .replace(/(^|\s)#([^\s<#]+)/g, (m, pre, tag) =>
      `${pre}<a href="https://x.com/hashtag/${encodeURIComponent(tag)}" target="_blank" rel="noopener noreferrer">#${tag}</a>`);
}
function avatar(p){
  const name = deEmoji(String(p.name || p.handle || '?')).replace(/^@/,'');
  const ini = esc(name.slice(0,1).toUpperCase() || '?');
  const img = p.avatar
    ? `<img src="${escUrl(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  return `<span class="av" style="--h:${hue(p.handle || name)}">${ini}${img}</span>`;
}
function skCard(){
  return `<article class="tw tw-sk" aria-hidden="true">
    <span class="av-sk"></span>
    <div class="tw-b">
      <div class="sk-row" style="display:flex;gap:8px;align-items:center">
        <span class="nw-sk-line" style="width:36%;height:10px"></span>
        <span class="nw-sk-line" style="width:16%;height:8px"></span>
        <span class="nw-sk-line" style="width:11%;height:8px"></span>
      </div>
      <span class="nw-sk-line" style="display:block;width:34%;height:8px;margin:8px 0 9px"></span>
      <span class="nw-sk-line" style="display:block;height:9px;margin:0 0 6px"></span>
      <span class="nw-sk-line" style="display:block;width:76%;height:9px;margin:0 0 13px"></span>
      <span class="nw-sk-line" style="display:block;width:20%;height:8px"></span>
    </div>
  </article>`;
}
function tweetCard(p){
  const key = p.url || p.text || '';
  if (xFresh.has(key)) return skCard();
  const t = p.ts ? rel(p.ts) : (p.time || '');
  const title = p.ts ? wibFull(p.ts) + ' WIB' : '';
  return `<article class="tw${xReveal.has(key) ? ' tw-in' : ''}" data-url="${esc(p.url || '')}">
    ${avatar(p)}
    <div class="tw-b">
      <div class="tw-h">
        <span class="tw-n">${esc(deEmoji(p.name || p.handle || ''))}</span>${p.verified ? VF : ''}
        <span class="tw-u">${esc(p.handle || '')}</span>
        <span class="tw-t" title="${esc(title)}">· ${esc(t)}</span>
        ${p.url ? `<a class="tw-o" href="${escUrl(p.url)}" target="_blank" rel="noopener noreferrer" title="Buka di X">${ic('out')}</a>` : ''}
      </div>
      <div class="tw-t tw-assess">${esc(assessmentLabel(p))}</div>
      <div class="tw-txt">${linkify(p.text || '') || '<span style="color:#555">tautan</span>'}</div>
      ${(p.urls || []).slice(0, 2).map(u => {
        let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) {}
        return `<a class="th-link" href="${escUrl(u)}" target="_blank" rel="noopener noreferrer">${ic('out')}${esc(host || 'tautan')}</a>`;
      }).join('')}
      <div class="tw-a">
        <span class="tw-reply">${I.reply}${p.replies ? num(p.replies) : ''}</span>
        <span class="tw-rt">${I.rt}${p.reposts ? num(p.reposts) : ''}</span>
        <span class="tw-like">${I.like}${p.likes ? num(p.likes) : ''}</span>
        <span class="tw-views">${I.views}${p.views ? num(p.views) : ''}</span>
        <span class="tw-share" role="button" title="Bagikan">${I.share}</span>
        <span class="tw-mark" title="X">${I.x}</span>
      </div>
    </div>
  </article>`;
}
const X_STOP = new Set(('dan di ke yang untuk dari dengan ini itu pada sebagai atau the and for with in on at to of a an is are indonesia'.split(' ')));
function termHit(text, q){
  const words = String(q).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !X_STOP.has(w));
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  if (!words.length) return t.includes(' ' + String(q).toLowerCase() + ' ');
  return words.every(w => t.includes(' ' + w + ' '));
}
function xMatchQ(p, q){
  return (p.assessment?.version === SitrepSignals.VERSION ? p.assessment.topics : []).includes(q);
}
const xqTried = new Set();
async function xLazy(q){
  if (!q || xqTried.has(q) || API == null) return;
  xqTried.add(q);
  if (xPosts.filter(p => xMatchQ(p, q)).length >= 5) return;
  try {
    const d = await getJson(API + '/api/xq?q=' + encodeURIComponent(q), 30000);
    if (!d || !d.ok || !d.posts) return;
    acceptSocialSnapshot('x', d);
    socApply(d);
    renderAllQchips();
    renderX();
  } catch (e) {}
}
let socStats = {}, socBoth = [], socTrends = new Map();
const TOPIC_LABEL = { phk:'PHK', ihsg:'IHSG', bssn:'BSSN', bbm:'BBM', mbg:'MBG', ransomware:'Ransomware' };
const topicLabel = q => TOPIC_LABEL[q] || String(q).replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const TOPIC_COLOR_MAP = {
  demo:'#f1c21b', politik:'#6ea8fe', pemilu:'#6ea8fe', prabowo:'#6ea8fe', gibran:'#6ea8fe',
  banjir:'#4589ff', karhutla:'#ff4d4f', kebakaran:'#ff4d4f', gempa:'#ff5a4e', tsunami:'#4589ff',
  longsor:'#be95ff', erupsi:'#ff9f0a', gunung:'#ff9f0a', cuaca:'#38bdf8', kecelakaan:'#ff9f43',
  kriminal:'#ff9f43', pencurian:'#ff9f43', penangkapan:'#ff9f43', penembakan:'#ff4d4f',
  terorisme:'#da1e28', konflik:'#ff4d4f', kesehatan:'#ff6b9d', wabah:'#ff6b9d', keracunan:'#ff6b9d',
  mbg:'#ff6b9d', pendidikan:'#20c997', ekonomi:'#3ddc97', ihsg:'#3ddc97', phk:'#ff9f43',
  'listrik padam':'#ff9f43', bbm:'#3ddc97', rupiah:'#3ddc97', pangan:'#3ddc97', bansos:'#3ddc97',
  'serangan siber':'#c8f04b', 'akun dibajak':'#c8f04b', siber:'#c8f04b', hukum:'#a78bfa', korupsi:'#a78bfa', insiden:'#8d8d8d'
};
const topicColor = q => TOPIC_COLOR_MAP[String(q).toLowerCase()] || '#38bdf8';
function hexToRgba(hex, a){
  let c = String(hex || '').replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c || '38bdf8', 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${a})`;
}
function socCountFor(q, kind){
  const list = kind === 'x' ? xPosts : tPosts;
  if (list.length) {
    let n = 0;
    for (const p of list) {
      const tps = p && p.assessment && p.assessment.version === SitrepSignals.VERSION ? p.assessment.topics : [];
      if (tps && tps.includes(q)) n++;
    }
    return n;
  }
  return (socStats[q] && socStats[q][kind === 'x' ? 'x' : 'th']) || 0;
}
function qchipsHtml(queries, trending, active, me, other){
  const tr = trending || [];
  const all = [...new Set(queries || [])];
  const vis = all.filter(q => socCountFor(q, me) > 0);
  const hot = vis.filter(q => tr.includes(q)).sort((a, b) => tr.indexOf(a) - tr.indexOf(b));
  const restActive = vis.filter(q => !tr.includes(q)).sort((a, b) => socCountFor(b, me) - socCountFor(a, me));

  const panel = (q, idx, isHot) => {
    const nx = socCountFor(q, 'x'), nt = socCountFor(q, 'th');
    const trData = socTrends.get(q);
    const isWire = !!(trData && trData.src && trData.src.includes('news'));
    const isSocial = !!(trData && trData.src && (trData.src.includes('social') || trData.src.includes('x')));
    const hotCls = isHot ? ((isWire && isSocial) ? ' hot hot-both' : isWire ? ' hot hot-wire' : ' hot') : ' qc-rest';
    const srcTag = isHot ? (isWire && isSocial ? 'WIRE + SOS' : isWire ? 'WIRE' : 'SOS') : 'SOS';
    const rankNum = isHot && trData && trData.rank ? trData.rank : (idx + 1);
    const rankStr = '#' + String(rankNum).padStart(2, '0');
    const z = Math.max(1, 50 - idx);
    const col = topicColor(q);
    const bgSubdued = hexToRgba(col, 0.16);
    const bdrSubdued = hexToRgba(col, 0.22);
    const glow = hexToRgba(col, 0.45);

    return `<button class="qc qc-panel${hotCls}" type="button" data-q="${esc(q)}" aria-pressed="${q === active}" style="z-index:${z};--cat-c:${col};--cat-bg:${bgSubdued};--cat-bdr:${bdrSubdued};--cat-glow:${glow};" title="Rank ${rankStr} · ${srcTag} · X: ${nx} · Threads: ${nt}">` +
      `<div class="qc-panel-inner">` +
        `<div class="qp-head">` +
          `<span class="qp-idx">${rankStr}</span>` +
          `<span class="qp-meta"><span class="qp-src">${srcTag}</span></span>` +
        `</div>` +
        `<div class="qp-mid"><span class="qp-title">${esc(topicLabel(q))}</span></div>` +
        `<div class="qp-foot">` +
          `<div class="qp-stats">` +
            `<span class="qp-stat${me === 'x' ? ' on' : ''}${nx ? '' : ' zr'}" title="${nx} post di X">${ic('x')}${nx}</span>` +
            `<span class="qp-sep">·</span>` +
            `<span class="qp-stat${me === 'th' ? ' on' : ''}${nt ? '' : ' zr'}" title="${nt} post di Threads">${ic('threads')}${nt}</span>` +
          `</div>` +
          `<span class="qp-tot">${nx + nt} ${nx + nt === 1 ? 'POST' : 'POSTS'}</span>` +
        `</div>` +
      `</div>` +
    `</button>`;
  };

  const allTot = xPosts.length + tPosts.length;
  const totLabel = allTot > 0 ? `${allTot}` : '<span class="qc-sk-pill" style="width:24px;height:7px;display:inline-block"></span>';
  const semuaBtn = `<button class="qc qc-panel qc-all" type="button" data-q="" aria-pressed="${active === ''}" title="Semua Feed · ${allTot} Posts">` +
    `<div class="qc-panel-inner">` +
      `<div class="qp-head">` +
        `<span class="qp-idx qall-idx">ALL</span>` +
        `<span class="qp-meta"><span class="qp-src">STREAM</span></span>` +
      `</div>` +
      `<div class="qp-mid"><span class="qp-title">SEMUA</span></div>` +
      `<div class="qp-foot">` +
        `<div class="qp-stats">` +
          `<span class="qp-stat${me === 'x' ? ' on' : ''}" title="${xPosts.length} post di X">${ic('x')}${xPosts.length}</span>` +
          `<span class="qp-sep">·</span>` +
          `<span class="qp-stat${me === 'th' ? ' on' : ''}" title="${tPosts.length} post di Threads">${ic('threads')}${tPosts.length}</span>` +
        `</div>` +
        `<span class="qp-tot">${totLabel}</span>` +
      `</div>` +
    `</div>` +
  `</button>`;

  if (!all.length) {
    const skPanel = (w) => `<div class="qc qc-panel qc-panel-sk">` +
      `<div class="qc-panel-inner">` +
        `<div class="qp-head">` +
          `<span class="qc-sk-pill qc-sk-idx"></span>` +
          `<span class="qp-meta"><span class="qc-sk-pill qc-sk-tag"></span></span>` +
        `</div>` +
        `<div class="qp-mid"><span class="qc-sk-pill qc-sk-title" style="width:${w}%;"></span></div>` +
        `<div class="qp-foot"><span class="qc-sk-pill qc-sk-foot"></span></div>` +
      `</div>` +
    `</div>`;

    return semuaBtn +
      '<i class="qc-sep" aria-hidden="true"></i>' +
      '<div class="qc-shingles">' + [60, 75, 55, 68, 62].map(skPanel).join('') + '</div>';
  }

  return semuaBtn +
    (hot.length ? '<i class="qc-sep" aria-hidden="true"></i><div class="qc-shingles">' + hot.map((q, i) => panel(q, i, true)).join('') + '</div>' : '') +
    (restActive.length ? '<i class="qc-sep" aria-hidden="true"></i><div class="qc-shingles">' + restActive.map((q, i) => panel(q, hot.length + i, false)).join('') + '</div>' : '');
}
function socApply(d){
  if (!d) return;
  if (d.stats) { socStats = d.stats; socBoth = d.both || []; }
  if (Array.isArray(d.trends)) { socTrends = new Map(d.trends.map(t => [t.id, t])); }
  if (Array.isArray(d.queries)) {
    xQueries = tQueries = d.queries;
    xTrending = tTrending = d.trending || [];
  }
}
function renderQchips(){
  $('#qchips').innerHTML = qchipsHtml(xQueries, xTrending, xQuery, 'x', 'th');
}
function renderAllQchips(){
  if (xQuery && socCountFor(xQuery, 'x') === 0) xQuery = '';
  if (tQuery && socCountFor(tQuery, 'th') === 0) tQuery = '';
  renderQchips();
  renderQChipsTh();
}
function renderX(){
  const q = ($('#xq').value || '').toLowerCase();
  const list = xPosts.filter(p =>
    (!xQuery || xMatchQ(p, xQuery)) &&
    (!q || ((p.text || '') + ' ' + (p.handle || '') + ' ' + (p.name || '')).toLowerCase().includes(q)));
  if ($('#xmeta')) $('#xmeta').textContent = list.length + ' post';
  const page = list.slice(0, xShown);
  const xWait = API != null && !xPosts.length && (xCold || (xErrStreak < 3 && xEmptyStreak < 3));
  const xMsg = xPosts.length ? 'Tidak ada post yang cocok dengan saringan ini.'
    : API == null ? 'Feed X butuh server.'
    : xCold || (xErrStreak < 3 && xEmptyStreak < 3)
      ? (xErrStreak ? 'Menghubungkan ulang ke X…' : 'Menarik data X… kolektor sedang berjalan.')
      : xErrStreak >= 3 ? 'X error' + (xLastErr ? ': ' + esc(xLastErr.slice(0, 220)) : '.')
      : 'Belum ada post X' + (xLastErr ? ': ' + esc(xLastErr.slice(0, 220)) : '. Server belum selesai menarik, atau X mengembalikan hasil kosong.');
  $('#xlist').innerHTML = (page.length ? page.map(tweetCard).join('')
    : `<div class="empty${xWait ? ' wait' : ''}">${xMsg}</div>`) +
    (list.length > xShown ? `<button class="xmore" type="button">Muat ${Math.min(30, list.length - xShown)} lagi · ${list.length - xShown} tersisa</button>` : '');
  $('#f-x').textContent = xPosts.length;
  xReveal.clear();
  if (xFresh.size && !xSkTimer) {
    xSkTimer = setTimeout(() => {
      xSkTimer = 0;
      xReveal = new Set(xFresh); xFresh.clear();
      renderX();
    }, 850);
  }
  updateDistress();
}
$('#xlist').addEventListener('click', e => {
  if (e.target.closest('.xmore')) { xShown += 30; renderX(); }
});
$('#qchips').addEventListener('click', e => {
  const b = e.target.closest('.qc'); if (!b) return;
  xQuery = b.dataset.q; xShown = 30;
  $$('#qchips .qc').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  renderX();
  xLazy(xQuery);
});
$('#xq').addEventListener('input', debounce(() => { xShown = 30; renderX(); }, 140));

let tPosts = [], tAt = 0, tBusy = false, socTab = 'x';
let tQuery = '', tQueries = [], tTrending = [], tErrs = [], tNewestTs = 0;
const tAll = new Map(); let tShown = 30;
let tCold = false, tEmptyStreak = 0, tErrStreak = 0, tLastErr = '';

function linkifyThreads(t){
  return esc(deEmoji(t))
    .replace(/(https?:\/\/[^\s<]+)/g, (m, u) => {
      const label = u.replace(/^https?:\/\//,'').replace(/\/$/,'');
      return `<a href="${u}" target="_blank" rel="noopener noreferrer">${label.length > 40 ? label.slice(0,40) + '…' : label}</a>`;
    })
    .replace(/(^|\s)@([A-Za-z0-9._]{2,30})/g, (m, pre, h) =>
      `${pre}<a href="https://www.threads.com/@${h}" target="_blank" rel="noopener noreferrer">@${h}</a>`)
    .replace(/(^|\s)#([^\s<#]+)/g, (m, pre, tag) =>
      `${pre}<a href="https://www.threads.com/search?q=${encodeURIComponent('#' + tag)}" target="_blank" rel="noopener noreferrer">#${tag}</a>`);
}
function threadCard(p){
  const user = deEmoji(p.username || '');
  const name = deEmoji(p.full_name || p.username || '');
  const ini = esc(name.slice(0,1).toUpperCase() || '?');
  const av = p.avatar ? (API != null ? tokQ(API + '/img?u=' + encodeURIComponent(p.avatar)) : p.avatar)
    : (user ? (API != null ? tokQ(API + '/img?u=' + encodeURIComponent(`https://unavatar.io/threads/${user}`)) : `https://unavatar.io/threads/${encodeURIComponent(user)}`) : '');
  const img = av
    ? `<img src="${escUrl(av)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  const ts = p.created_at ? Date.parse(p.created_at) : 0;
  const link = (p.links || [])[0];
  let host = '';
  try { host = link ? new URL(link).hostname.replace(/^www\./,'') : ''; } catch (e) {}
  return `<article class="th${p.is_reply ? ' reply' : ''}" data-url="${esc(p.url || '')}">
    <div class="th-av" style="--h:${hue(user)}">${ini}${img}</div>
    <div class="th-b">
      <div class="th-head">
        <span class="th-n">${esc(name)}</span>
        ${p.is_verified ? `<span class="th-vf">${ic('thcheck')}</span>` : ''}
        <span class="th-u">@${esc(user)}</span>
        <span class="th-t">· ${esc(ts ? rel(ts) : '')}</span>
        <a class="th-o" href="${escUrl(p.url || '#')}" target="_blank" rel="noopener noreferrer" title="Buka di Threads">${ic('out')}</a>
      </div>
      ${p.is_reply && p.reply_to_username ? `<div class="th-rp">${ic('reply')}balasan untuk @${esc(deEmoji(p.reply_to_username))}</div>` : ''}
      <div class="tw-t tw-assess">${esc(assessmentLabel(p))}</div>
      <div class="th-txt">${linkifyThreads(p.text || '')}</div>
      ${link ? `<a class="th-link" href="${escUrl(link)}" target="_blank" rel="noopener noreferrer">${ic('out')}${esc(host || 'tautan')}</a>` : ''}
      <div class="th-a">
        <span class="th-like">${ic('heart')}${num(p.like_count)}</span>
        <span>${ic('comment')}${num(p.reply_count)}</span>
        <span>${ic('rt')}${num(p.repost_count)}</span>
        <span class="th-share" role="button" title="Bagikan">${ic('share')}</span>
        <span class="th-mark">${ic('threads')}</span>
      </div>
    </div>
  </article>`;
}
function tMatchQ(p, q){
  return (p.assessment?.version === SitrepSignals.VERSION ? p.assessment.topics : []).includes(q);
}
function renderThreads(){
  const q = ($('#tq').value || '').toLowerCase();
  const list = tPosts.filter(p =>
    (!tQuery || tMatchQ(p, tQuery)) &&
    (!q || ((p.text || '') + ' ' + (p.username || '') + ' ' + (p.full_name || '')).toLowerCase().includes(q)));

  const tNew = tNewestTs > 0 ? tNewestTs
    : Math.max(0, ...tPosts.map(p => p.ts || Date.parse(p.created_at || '') || 0));
  const tAgeM = tNew ? (Date.now() - tNew) / 60000 : Infinity;
  const tStale = tAgeM > 45 ? ' · terbaru ' + (tAgeM < 60 ? Math.floor(tAgeM) + 'm' : Math.floor(tAgeM / 60) + 'j') + ' lalu' : '';
  if ($('#tmeta')) $('#tmeta').textContent = list.length + ' post';
  $('#f-th').textContent = tPosts.length;
  const page = list.slice(0, tShown);
  const tWait = API != null && !tPosts.length && (tCold || (tErrStreak < 3 && tEmptyStreak < 3));
  const tMsg = tPosts.length ? 'Tidak ada post yang cocok.'
    : API == null ? 'Threads butuh server (scraper Python).'
    : tCold || (tErrStreak < 3 && tEmptyStreak < 3)
      ? (tErrStreak ? 'Menghubungkan ulang ke Threads…' : 'Menarik data Threads… scraper sedang berjalan.')
      : tErrStreak >= 3 ? 'Threads error' + (tLastErr ? ': ' + esc(tLastErr.slice(0, 160)) : '.')
      : 'Belum ada post Threads untuk query ini.';
  $('#tlist').innerHTML = (page.length ? page.map(threadCard).join('')
    : `<div class="empty${tWait ? ' wait' : ''}">${tMsg}</div>`) +
    (list.length > tShown ? `<button class="xmore" type="button">Muat ${Math.min(30, list.length - tShown)} lagi · ${list.length - tShown} tersisa</button>` : '');
  updateDistress();
}
$('#tlist').addEventListener('click', e => {
  if (e.target.closest('.xmore')) { tShown += 30; renderThreads(); }
});
function renderQChipsTh(){
  $('#qchips-th').innerHTML = qchipsHtml(tQueries, tTrending, tQuery, 'th', 'x');
}
$('#qchips-th').addEventListener('click', e => {
  const b = e.target.closest('.qc'); if (!b) return;
  tQuery = b.dataset.q; tShown = 30;
  $$('#qchips-th .qc').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  renderThreads();
  thLazy(tQuery);
});
const thqTried = new Set();
async function thLazy(q){
  if (!q || thqTried.has(q) || API == null) return;
  thqTried.add(q);
  if (tPosts.filter(p => tMatchQ(p, q)).length >= 5) return;
  try {
    const d = await getJson(API + '/api/thq?q=' + encodeURIComponent(q), 100000);
    if (!d || !d.ok || !d.posts) return;
    acceptSocialSnapshot('th', d);
    socApply(d);
    renderAllQchips();
    renderThreads();
  } catch (e) { thqTried.delete(q); }
}
async function pullThreads(){
  if (tBusy) return;
  if (API == null) { renderThreads(); return; }
  tBusy = true;
  $('#tmeta').textContent = 'menarik…';
  try {
    const d = await getJson(API + '/api/threads', 160000);
    tErrStreak = 0;
    tErrs = Array.isArray(d.errs) ? d.errs : [];
    tNewestTs = d && Number.isFinite(d.newestTs) ? d.newestTs : 0;
    const acc = acceptSocialSnapshot('th', d);
    tCold = !tPosts.length && !!d.warming;
    if (tPosts.length) tEmptyStreak = 0; else if (!tCold) tEmptyStreak++;
    if (acc || d.queries) socApply(d);
    renderAllQchips();
    renderThreads();
  } catch (e) {
    tSignalCurrent = false; updateDistress();
    tErrStreak++; tCold = false;
    tLastErr = String(e && e.message || e || 'tidak ada respons').slice(0, 160);
    if (!tPosts.length) {
      renderThreads();
      $('#tmeta').textContent = tErrStreak >= 3 ? 'gagal' : 'mencoba lagi…';
    }
  } finally { tBusy = false; }
}
function setSocTab(t){
  socTab = t;
  $$('.soc-tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  $('#pane-x').hidden = t !== 'x';
  $('#pane-th').hidden = t !== 'threads';
  $('#xmeta').hidden = t !== 'x';
  $('#tmeta').hidden = t !== 'threads';
  if (t === 'threads' && !tPosts.length) pullThreads();
}
$$('.soc-tab').forEach(b => {
  b.addEventListener('click', () => {

    const pane = b.closest('.pane');
    if (pane && !pane.classList.contains('open')) pane.classList.add('open');
    setSocTab(b.dataset.tab);
  });
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSocTab(b.dataset.tab === 'x' ? 'threads' : 'x');
    $('.soc-tab[aria-selected="true"]').focus();
  });
});
$('#tq').addEventListener('input', debounce(() => { tShown = 30; renderThreads(); }, 140));

