let xBusy = false, xRetryT = 0, xColdTries = 0;
async function pullX(){
  if (xBusy) return;
  clearTimeout(xRetryT);
  xRetryT = 0;
  if (API == null) {
    $('#xlist').innerHTML = '<div class="empty">Butuh server untuk feed X.</div>';
    $('#xmeta').textContent = 'offline';
    return;
  }
  xBusy = true;
  try {
    const d = await getJson(API + '/api/x', 110000);
    xLastErr = d.err || '';
    if (d.ok) {
      xErrStreak = 0;

      const acc = acceptSocialSnapshot('x', d);

      xCold = !xPosts.length && !!d.warming;
      if (xPosts.length) { xEmptyStreak = 0; xColdTries = 0; }
      else if (!xCold) xEmptyStreak++;
      if (acc) {
        socApply(d);
        if (xShown > xPosts.length) xShown = Math.max(30, xPosts.length);
        renderAllQchips();
        renderX();
        $('#xmeta').textContent = xPosts.length + ' post' + (d.err ? ' · sebagian gagal' : '');
      } else renderX();
      if ((xCold || (!xPosts.length && d.warming)) && !xRetryT && ++xColdTries <= 12) {
        xRetryT = setTimeout(() => { xRetryT = 0; if (!document.hidden) pullX(); }, 4500);
      }
    } else if (xPosts.length) {
      xColdTries = 0;
      if (d.warming) { xCold = false; xErrStreak = 0; }
      else xErrStreak++;
      if (d.queries) { socApply(d); renderAllQchips(); }
      xSignalCurrent = false; updateDistress();
      $('#xmeta').textContent = xPosts.length + ' post · data terakhir';
    } else {
      if (d.warming) { xCold = true; xErrStreak = 0; }
      else { xErrStreak++; xCold = false; }
      if (d.queries) { socApply(d); renderAllQchips(); }
      renderX();
      $('#xmeta').textContent = xCold ? 'kolektor berjalan…' : (xErrStreak >= 3 ? 'gagal' : 'mencoba lagi…');
      if ((xCold || xErrStreak < 4) && !xRetryT && ++xColdTries <= 12) {
        xRetryT = setTimeout(() => { xRetryT = 0; if (!document.hidden) pullX(); }, 4500);
      }
    }
  } catch (e) {
    xSignalCurrent = false; updateDistress();
    xErrStreak++; xCold = false;
    xLastErr = String(e && e.message || e || 'tidak ada respons').slice(0, 160);
    if (!xPosts.length) {
      renderX();
      $('#xmeta').textContent = xErrStreak >= 3 ? 'gagal' : 'mencoba lagi…';
      if (xErrStreak < 4 && !xRetryT && ++xColdTries <= 12) {
        xRetryT = setTimeout(() => { xRetryT = 0; if (!document.hidden) pullX(); }, 4500);
      }
    }
  } finally { xBusy = false; }
}
schedulePoll(() => pullX(), 75000, { dedupGlobalMs: 20000 });

let busy = false, bgPending = 0, lastSyncAt = 0, lastRefreshDone = 0, coldTimer = 0, coldTries = 0;
const paintSync = () => {
  const el = $('#lastsync');
  if (el) el.textContent = 'sync ' + (lastSyncAt ? wibTime(lastSyncAt) : '—') + ' WIB' + (bgPending ? ' · ' + bgPending + ' latar' : '');
};
const trackBg = p => { bgPending++; const d = () => { bgPending--; paintSync(); }; Promise.resolve(p).then(d, d); };
function needsColdRecovery(){
  return API == null || !mediaLoaded || !newsList.length || !SIT || !SIT.total || !geoIncOk || !STK || !pullCctv.hydrated || pullCctv.warming || xCold || (!xPosts.length && xErrStreak < 4) || tCold || (!tPosts.length && tErrStreak < 4);
}
function scheduleColdRecovery(){
  if (!needsColdRecovery()) {
    coldTries = 0;
    clearTimeout(coldTimer);
    coldTimer = 0;
    return;
  }
  if (coldTimer || coldTries >= 12 || document.hidden) return;
  coldTries++;
  coldTimer = setTimeout(async () => {
    coldTimer = 0;
    if (document.hidden) return;
    if (API == null) await detectApi();
    if (API == null) { scheduleColdRecovery(); return; }
    const jobs = [];
    if (!mediaLoaded || !newsList.length) jobs.push(pullMedia(false));
    if (!SIT || !SIT.total) jobs.push(pullSituation(false));
    if (!STK) jobs.push(pullStocks());
    if (!geoIncOk) jobs.push(pullIncidents(false));
    if ((!pullCctv.hydrated || pullCctv.warming) && !pullCctv.retryT) jobs.push(pullCctv());
    if ((xCold || (!xPosts.length && xErrStreak < 4)) && !xRetryT && !xBusy) jobs.push(pullX());
    if ((tCold || (!tPosts.length && tErrStreak < 4)) && !tRetryT && !tBusy) jobs.push(pullThreads());
    if (jobs.length) await Promise.allSettled(jobs);
    scheduleColdRecovery();
  }, 4500);
}
async function refreshAll(manual){
  if (busy) return;
  busy = true;
  lastGlobalSyncAt = Date.now();
  const syncBtn = $('#btn-refresh');
  if (syncBtn) syncBtn.dataset.state = 'sync';
  $('#countdown').textContent = 'Tarik…';
  try {
    if (API == null) await detectApi();
    trackBg(pullIncidents(manual));
    if (manual || !(DIS_PULSE && DIS_PULSE.length)) trackBg(pullDisaster());
    trackBg(pullAlive());
    trackBg(pullCctv());
    trackBg(pullX());
    trackBg(pullThreads());
    if (manual || !breakAt) trackBg(pullBreaking());
    if (manual) {
      P.forEach((p, c) => { if (p.dead) { p.dead = false; p.tries = 0; clearTimeout(p.retry); badge(c, 'wait', 'Antre'); } });
      pump();
    }
    await Promise.all([pullMedia(manual), pullSituation(manual), pullStocks()]);
    lastSyncAt = Date.now(); paintSync();
  } finally {
    busy = false;
    if (syncBtn) syncBtn.dataset.state = 'idle';
    remain = CYCLE; paintCountdown();
    lastRefreshDone = Date.now();
    rdPrefetchVisible();
    scheduleColdRecovery();
  }
  if (manual) {
    $('#countdown').textContent = 'OK';
    setTimeout(paintCountdown, 1200);
  }
}
$('#btn-refresh').addEventListener('click', () => refreshAll(true));

let visRefreshTimer = 0;
async function onTabWake(fromOnline){
  if (document.hidden) return;
  clearTimeout(visRefreshTimer);
  visRefreshTimer = 0;
  const now = Date.now();
  try { wakeGlobe(); drawGlobe(performance.now()); } catch (e) {}
  if (typeof globeReady !== 'undefined' && !globeReady && typeof fetchGlobe === 'function') {
    try { fetchGlobe().catch(() => {}); } catch (e) {}
  }
  if (STK) {
    try { renderChips(); paintHeroes(); } catch (e) {}
  }
  if (typeof descHasWork === 'function' && descHasWork()) {
    try { queueDescEnrich(); } catch (e) {}
  }
  if (lastRefreshDone) {
    const elapsed = Math.floor((now - lastRefreshDone) / 1000);
    remain = Math.max(0, CYCLE - elapsed);
    paintCountdown();
  }
  if (breakAt && now - breakAt > BREAK_CYCLE * 1000 && !breakBusy) {
    setTimeout(() => { if (!document.hidden && !breakBusy) pullBreaking(); }, 500);
  } else if (breakAt) {
    const bElapsed = Math.floor((now - breakAt) / 1000);
    breakRemain = Math.max(0, BREAK_CYCLE - bElapsed);
    paintBreak();
  }
  const stale = !lastRefreshDone || (lastRefreshDone && now - lastRefreshDone > 30000);
  if (API == null || needsColdRecovery() || fromOnline || stale) {
    if (API == null) await detectApi();
    if (fromOnline || stale) {
      coldTries = 0;
      xColdTries = 0;
      tColdTries = 0;
      pullCctv.tries = 0;
    }
    visRefreshTimer = setTimeout(() => {
      visRefreshTimer = 0;
      if (!document.hidden && !busy) {
        if (stale || fromOnline || !lastRefreshDone) refreshAll(false);
        else scheduleColdRecovery();
      }
    }, fromOnline ? 250 : 650);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(visRefreshTimer);
    visRefreshTimer = 0;
    clearTimeout(coldTimer);
    coldTimer = 0;
    clearTimeout(xRetryT);
    xRetryT = 0;
    clearTimeout(tRetryT);
    tRetryT = 0;
    clearTimeout(pullCctv.retryT);
    pullCctv.retryT = 0;
    return;
  }
  coldTries = 0;
  xColdTries = 0;
  tColdTries = 0;
  pullCctv.tries = 0;
  onTabWake(false);
});
window.addEventListener('focus', () => onTabWake(false));
window.addEventListener('pageshow', e => { coldTries = 0; xColdTries = 0; tColdTries = 0; pullCctv.tries = 0; onTabWake(!!(e && e.persisted)); });
window.addEventListener('online', () => { coldTries = 0; xColdTries = 0; tColdTries = 0; pullCctv.tries = 0; onTabWake(true); });

let rdOn = false, rdCurrent = '', rdTrigger = null, rdDrag = null, rdStack = [], rdCurrentView = null, rdHero = '';
const rdCache = new Map();
const rdAutoRetried = new Set();

const rdHostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return '—'; } };

function rdPushView() {
  if (!rdCurrentView) return;
  rdStack.push(rdCurrentView);
  if (rdStack.length > 12) rdStack.shift();
}

function rdSetOpen(on) {
  rdOn = on;
  $('#reader').classList.toggle('on', on);
  $('#reader').setAttribute('aria-hidden', on ? 'false' : 'true');
}
function rdSyncBack() {
  $('#rd-back').hidden = rdStack.length === 0;
}
function rdPlace(x, y) {
  const w = $('#reader'), r = w.getBoundingClientRect();
  const m = innerWidth <= 820 ? 8 : 12;
  const maxX = Math.max(m, innerWidth - r.width - m);
  const maxY = Math.max(m, innerHeight - r.height - m);
  w.style.left = Math.round(Math.max(m, Math.min(maxX, x))) + 'px';
  w.style.top = Math.round(Math.max(m, Math.min(maxY, y))) + 'px';
  w.style.right = 'auto';
  w.style.bottom = 'auto';
}
function rdFitView() {
  const w = $('#reader');
  if (!w || !rdOn) return;
  const r = w.getBoundingClientRect();
  const m = innerWidth <= 820 ? 8 : 12;
  if (r.bottom > innerHeight - m) {
    const newTop = Math.max(m, innerHeight - r.height - m);
    w.style.top = Math.round(newTop) + 'px';
  }
}
function rdDefaultPlace() {
  const w = $('#reader');
  w.removeAttribute('style');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('sitrep.reader') || 'null'); } catch (e) {}
  const r = w.getBoundingClientRect();
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { rdPlace(saved.x, saved.y); return; }
  const pad = innerWidth <= 820 ? 8 : 26;
  rdPlace(innerWidth - r.width - pad, r.top);
}
function rdLink(t) {
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (m, u) => {
    const label = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `<a href="${u}" target="_blank" rel="noopener noreferrer">${label.length > 50 ? label.slice(0, 50) + '…' : label}</a>`;
  });
}

function rdStopMedia(){
  const body = $('#rd-body'); if (!body) return;
  body.querySelectorAll('video').forEach(v => {
    try { if (v._hls) { v._hls.destroy(); v._hls = null; } } catch (e) {}
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
  });
  body.querySelectorAll('iframe').forEach(f => f.remove());
}
function rdError(url, msg) {
  rdStopMedia();
  $('#rd-body').innerHTML = `<div class="rd-err">
    <b>Tidak bisa membaca halaman</b>
    <p>${esc(msg)}</p>
    <p>Situs ini mungkin memblokir pembaca server, butuh login, atau menolak permintaan. Coba lagi atau pakai “Buka sumber”.</p>
    <button class="rp-btn" type="button" id="rd-retry" style="margin-top:10px">Coba lagi</button>
  </div>`;
  const rb = document.getElementById('rd-retry');
  if (rb) rb.addEventListener('click', () => { rdCache.delete(url); rdOpen(url, rdTrigger, false); });
  $('#rd-state').textContent = 'gagal';
  $('#rd-open').href = url;
}
function rdImgProxyFallback(img) {
  if (!img) return false;
  const orig = img.dataset && img.dataset.orig;
  if (orig && !/\/img\?/i.test(orig) && !img.dataset.pxTried && typeof API !== 'undefined' && API != null) {
    img.dataset.pxTried = '1';
    img.src = rdProxyImgUrl(orig);
    return true;
  }
  return false;
}
function rdLeadImgFb(img) {
  if (rdImgProxyFallback(img)) return;
  if (img) {
    img.onerror = null;
    if (img.parentNode) img.parentNode.remove();
  }
}
function rdHeroFb(img) {

  if (rdImgProxyFallback(img)) return;
  if (img) {
    img.onerror = null;
    img.remove();
  }
}
function rdFigFb(img) {
  if (rdImgProxyFallback(img)) return;
  if (img) {
    img.onerror = null;
    const fig = img.closest('figure');
    if (fig) fig.remove();
    else img.remove();
  }
}
function rdArticle(d, url) {
  rdSyncWireDesc(d, url);
  const ts = d.time && !isNaN(Date.parse(d.time)) ? wibFull(Date.parse(d.time)) + ' WIB' : '';
  const cleanSite = (window.WireCore && WireCore.cleanSiteName)
    ? WireCore.cleanSiteName(d.site, d.final || url)
    : (d.site || '');
  const nrmPub = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cleanBy = d.byline && nrmPub(d.byline) !== nrmPub(cleanSite) ? d.byline : '';
  const meta = [cleanSite, cleanBy, ts].filter(Boolean);

  const posters = new Set();
  for (const v of (d.videos || [])) if (v && v.poster && v.kind !== 'probe') posters.add(v.poster);
  for (const b of (d.blocks || [])) if (b.k === 'v' && b.v && b.v.poster && b.v.kind !== 'probe') posters.add(b.v.poster);
  const hero = (d.img && d.imgVerified !== false && !posters.has(d.img)) ? d.img : '';
  const heroSrc = hero ? rdMediaImgSrc(hero, d.imgProxy) : '';
  const img = heroSrc ? `<img class="rd-hero" src="${escUrl(heroSrc)}" data-orig="${esc(hero)}" alt="" loading="eager" referrerpolicy="no-referrer" onerror="rdHeroFb(this)">` : '';
  const rdVidHtml = v => mediaVidHtml(v);
  const emptyFb = (d.wireFallback || d.textSource === 'none') && !(d.paras && d.paras.length);
  const note = d.videoPage
    ? `<div class="rd-note">Halaman video — konten utama adalah video; teks artikel tidak tersedia.</div>`
    : (d.wireFallback && d.textSource === 'rss_description')
      ? `<div class="rd-note">Ringkasan RSS — akses server dibatasi penerbit, menampilkan deskripsi resmi dari feed RSS (bukan artikel lengkap). Buka sumber untuk teks penuh.</div>`
    : (d.wireFallback || d.textSource === 'none')
      ? `<div class="rd-note">Akses konten lengkap dibatasi oleh proteksi penerbit. Buka sumber untuk membaca artikel lengkap.${emptyFb ? '<div><button class="rp-btn" type="button" id="rd-fb-retry" style="margin-top:8px">Coba lagi</button></div>' : ''}</div>`
    : (d.textSource === 'meta_description' || d.isFallback || d.thin)
      ? `<div class="rd-note">Ringkasan Metadata — halaman tidak mengirim isi artikel lengkap (login/JS). Menampilkan ringkasan metadata saja. Buka sumber untuk teks penuh.</div>`
    : '';
  let flow, hasBlocks = Array.isArray(d.blocks) && d.blocks.length > 0;
  if (hasBlocks) {
    let firstP = true;
    const chunks = [];
    for (let i = 0; i < d.blocks.length; i++) {
      const b = d.blocks[i];
      if (b.k === 'v') { if (b.v && b.v.kind !== 'probe') chunks.push(rdVidHtml(b.v)); continue; }
      if (b.k === 'i') {
        if (b.img && b.img.url) {
          const figSrc = rdMediaImgSrc(b.img.url, b.img.proxy);
          chunks.push(`<figure class="rd-fig"><img src="${escUrl(figSrc)}" data-orig="${esc(b.img.url)}" alt="${esc(b.img.cap || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="rdFigFb(this)">${b.img.cap ? `<figcaption>${esc(b.img.cap)}</figcaption>` : ''}</figure>`);
        }
        continue;
      }
      if (b.k === 'h') { chunks.push(`<h2 class="rd-h">${esc(b.t)}</h2>`); continue; }
      if (b.k === 'q') { chunks.push(`<blockquote class="rd-q">${rdLink(b.t)}</blockquote>`); continue; }
      if (b.k === 'li') {
        const items = [];
        while (i < d.blocks.length && d.blocks[i].k === 'li') { items.push(`<li>${rdLink(d.blocks[i].t)}</li>`); i++; }
        i--;
        chunks.push(`<ul class="rd-ul">${items.join('')}</ul>`);
        continue;
      }
      const cls = firstP ? 'rd-p rd-lead' : 'rd-p'; firstP = false;
      chunks.push(`<p class="${cls}">${rdLink(b.t)}</p>`);
    }
    flow = chunks.join('') || (note ? '' : '<p class="rd-p">Tidak ada teks yang bisa diekstrak.</p>');
  } else {
    const pl = (d.paras || []).map((p, i) => `<p class="rd-p${i === 0 ? ' rd-lead' : ''}">${rdLink(p)}</p>`);
    const vl = (d.videos || []).filter(v => v.kind === 'iframe' || v.kind === 'video').map(rdVidHtml);
    const outp = [];
    pl.forEach((p, i) => { outp.push(p); const k = i + 1; vl.forEach((v, j) => { const at = pl.length >= 2 ? Math.min(pl.length - 1, Math.max(1, Math.round(pl.length * (j + 1) / (vl.length + 1)))) : 1; if (at === k) outp.push(v); }); });
    if (!pl.length) outp.push(...vl);
    flow = `${note}${outp.join('') || (note ? '' : '<p class="rd-p">Tidak ada teks yang bisa diekstrak.</p>')}`;
  }
  rdStopMedia();
  $('#rd-body').innerHTML = `<article class="rd-art">
    <h1>${esc(cleanTitle(d.title || 'Tanpa judul', cleanSite || d.site))}</h1>
    <div class="rd-meta">${meta.map(x => `<span>${esc(x)}</span>`).join('')}</div>
    ${img}${hasBlocks ? note : ''}${flow}
  </article>`;
  const stateLabel = d.videoPage ? 'halaman video'
    : (d.wireFallback ? (d.textSource === 'rss_description' ? 'ringkasan rss' : 'dibatasi sumber')
    : (d.textSource === 'meta_description' || d.isFallback || d.thin ? 'ringkasan meta' : (d.paras || []).length + ' paragraf'));
  $('#rd-state').textContent = stateLabel + ' · ' + rdHostOf(d.final || url);
  const safeUrl = d.final || url;
  $('#rd-open').href = /^https?:\/\//i.test(String(safeUrl || '').trim()) ? String(safeUrl).trim() : '#';
  $('#rd-body').scrollTop = 0;
  const fbr = document.getElementById('rd-fb-retry');
  if (fbr) fbr.addEventListener('click', () => { rdCache.delete(url); rdOpen(url, rdTrigger, false, rdHero, true); });
  $('#rd-body').querySelectorAll('video.rd-vid').forEach(rdMountVideo);
}

function rdMountVideo(v) {
  if (!v.hasAttribute('data-hls')) return;
  if (!window.Hls && !v.canPlayType('application/vnd.apple.mpegurl')) {
    ensureHls().then(() => { if (v.isConnected && !v._hls) rdMountVideo(v); }).catch(() => {});
    return;
  }
  if (window.Hls && Hls.isSupported()) {
    const h = new Hls({ maxBufferLength: 30 });
    v._hls = h;
    h.loadSource(v.getAttribute('src')); h.attachMedia(v);
    v.addEventListener('error', () => { try { h.destroy(); v._hls = null; } catch (e) {} }, { once: true });
  }
}

function mountVidFacade(f, autoplay = false) {
  const raw = f && f.getAttribute('data-src');
  if (!raw) return;
  let src = raw;
  if (autoplay && /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//i.test(src)) {
    src += (src.includes('?') ? '&' : '?') + 'autoplay=1&rel=0';
  }
  const box = document.createElement('div'); box.className = 'rd-vid';

  box.innerHTML = `<iframe src="${escUrl(src)}" title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  f.replaceWith(box);
}
$('#rd-body').addEventListener('click', e => {
  const f = e.target.closest('.rd-facade');
  if (f) mountVidFacade(f, true);
});
$('#lead').addEventListener('click', e => {
  if (!e.target.closest('.lead-vid')) return;
  e.preventDefault();
  e.stopPropagation();
  const f = e.target.closest('.rd-facade');
  if (f) mountVidFacade(f, true);
});
const rdThreadCache = new Map();
let rdThreadSeq = 0;

function rdReplyNode(r, kind, depth) {
  const isX = kind === 'x';
  const name = deEmoji(r.name || r.full_name || '') || deEmoji(r.username || r.handle || '');
  const handle = isX ? (r.handle || '') : (r.username ? '@' + r.username : '');
  const ts = isX ? (r.ts || 0) : (r.created_at ? Date.parse(r.created_at) : 0);
  const avSrc = isX ? (r.avatar || '')
    : (r.avatar ? (API != null ? tokQ(API + '/img?u=' + encodeURIComponent(r.avatar)) : r.avatar) : '');
  const vf = isX ? (r.verified ? `<span class="vf">${ic('verified')}</span>` : '')
    : (r.is_verified ? `<span class="vf">${ic('thcheck')}</span>` : '');
  const kids = r.kids || r.replies || [];
  const likes = isX ? r.likes : r.like_count;
  const nrep = isX ? r.replies : r.reply_count;
  return `<article class="rd-r">
    <span class="rd-ra" style="--h:${hue(handle || name)}">${esc((name || '?').slice(0, 1).toUpperCase())}${avSrc ? `<img src="${escUrl(avSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>
    <div class="rd-rb">
      <div class="rd-rn"><span>${esc(name)}</span>${vf}</div>
      <div class="rd-rm">${esc(handle)}${ts ? ' · ' + esc(wibFull(ts)) + ' WIB' : ''}</div>
      <div class="rd-rt">${isX ? linkify(r.text || '') : linkifyThreads(r.text || '')}</div>
      <div class="rd-rc"><span>${I.like}${num(likes)}</span>${nrep ? `<span>${I.reply}${num(nrep)}</span>` : ''}</div>
      ${kids.length && depth < 3 ? `<div class="rd-rk">${kids.map(k => rdReplyNode(k, kind, depth + 1)).join('')}</div>` : ''}
    </div>
  </article>`;
}
async function rdLoadThread(kind, url) {
  const box = $('#rd-thread');
  if (!box) return;
  const seq = ++rdThreadSeq;
  box.innerHTML = `<div class="rd-rep"><div class="rd-rh"><b>Balasan</b><span>memuat…</span></div>
    <div class="rd-sk s"></div><div class="rd-sk"></div><div class="rd-sk s"></div></div>`;
  if (API == null) { box.innerHTML = ''; return; }
  try {
    let d = rdThreadCache.get(url);
    if (!d) {
      d = await getJson(API + '/api/thread?u=' + encodeURIComponent(url), 50000);
      if (d && d.ok) {
        rdThreadCache.set(url, d);
        if (rdThreadCache.size > 40) rdThreadCache.delete(rdThreadCache.keys().next().value);
      }
    }
    if (seq !== rdThreadSeq || rdCurrent !== url) return;
    if (!d || !d.ok) throw new Error((d && d.err) || 'tidak ada respons');
    const list = Array.isArray(d.replies) ? d.replies : (Array.isArray(d.post && d.post.replies) ? d.post.replies : []);
    const total = typeof d.count === 'number' ? d.count : ((d.post && typeof d.post.reply_count === 'number') ? d.post.reply_count : (typeof (d.post && d.post.replies) === 'number' ? d.post.replies : list.length));
    if (!list.length) {
      const isSearchDiag = d.err && /0 tweet|search_by_raw_query/i.test(d.err);
      const why = (d.err && !isSearchDiag) ? esc(String(d.err).slice(0, 180)) : 'Belum ada interaksi publik pada kiriman ini.';
      box.innerHTML = `<div class="rd-rep"><div class="rd-rh"><b>Balasan</b><span>0</span></div>
        <p class="rd-empty">${why}</p></div>`;
      rdFitView();
      return;
    }
    box.innerHTML = `<div class="rd-rep"><div class="rd-rh"><b>Balasan</b><span>${list.length} dari ${num(total)}</span></div>
      ${list.map(r => rdReplyNode(r, kind, 0)).join('')}</div>`;
    rdFitView();
  } catch (e) {
    if (seq !== rdThreadSeq || rdCurrent !== url) return;
    box.innerHTML = `<div class="rd-rep"><div class="rd-rh"><b>Balasan</b><span>gagal</span></div>
      <p class="rd-empty">${esc(e.message || 'tidak bisa memuat balasan')}</p></div>`;
  }
}

function isSocialPost(u) {
  return /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(u)
    || /^https?:\/\/(?:www\.)?threads\.(?:com|net)\/@[^/]+\/post\/[A-Za-z0-9_-]+/i.test(u);
}
function rdPostFromApi(d, url) {
  const p = d.post || {};
  if (d.kind === 'x') return { kind: 'x', p: {
    url: p.url || url, handle: p.handle || '', name: p.name || '', avatar: p.avatar || '',
    text: p.text || '', ts: p.ts || 0, replies: p.replies || 0, reposts: p.reposts || 0,
    likes: p.likes || 0, views: p.views || 0, verified: !!p.verified
  } };
  return { kind: 'threads', p: {
    url: p.url || url, username: p.username || '', full_name: p.full_name || '',
    avatar: p.avatar || '', text: p.text || '', created_at: p.created_at || '',
    like_count: p.like_count || 0, reply_count: p.reply_count || 0,
    repost_count: p.repost_count || 0, is_verified: !!p.is_verified, media: p.media || []
  } };
}
async function rdOpenSocial(url, trigger, push) {
  if (push && rdCurrentView && !(rdCurrentView.kind === 'web' && rdCurrentView.url === url)) rdPushView();
  const wasOpen = rdOn;
  if (!wasOpen) { rdSetOpen(true); rdDefaultPlace(); }
  $('#reader').classList.add('is-post');
  rdSyncBack();
  rdCurrent = url;
  rdCurrentView = { kind: 'web', url };
  rdTrigger = trigger || rdTrigger;
  $('#rd-kind').textContent = 'Post';
  $('#rd-host').textContent = rdHostOf(url);
  $('#rd-open').href = url;
  $('#rd-state').textContent = 'menarik…';
  rdStopMedia();
  $('#rd-body').innerHTML = '<div class="rd-art"><div class="rd-sk t"></div><div class="rd-sk"></div><div class="rd-sk"></div><div class="rd-sk s"></div></div>';
  $('#rd-body').scrollTop = 0;
  if (!wasOpen) { try { $('#rd-close').focus({ preventScroll: true }); } catch (e) {} }
  if (API == null) { rdError(url, 'Server belum terdeteksi. Jalankan node server.js.'); return; }
  try {
    const d = await getJson(API + '/api/thread?u=' + encodeURIComponent(url), 50000);
    if (rdCurrent !== url) return;
    if (!d || !d.ok) throw new Error((d && d.err) || 'tidak bisa memuat post');
    rdThreadCache.set(url, d);
    const out = rdPostFromApi(d, url);
    rdPost(out.kind, out.p, trigger, false);
  } catch (e) {
    if (rdCurrent !== url) return;
    rdError(url, e.message || 'gagal memuat post');
  }
}

const rdPrefetching = new Set();
function rdPrefetch(url) {
  if (API == null || !/^https?:/i.test(url) || isSocialPost(url)) return;
  if (rdCache.has(url) || rdPrefetching.has(url)) return;
  rdPrefetching.add(url);
  getJson(API + '/api/read?u=' + encodeURIComponent(url) + '&bg=1', 45000, 0)
    .then(d => {
      if (d && d.ok) {
        if (!d.wireFallback && !d.upstreamBlocked && !d.isFallback) {
          rdCache.set(url, d);
          if (rdCache.size > 80) rdCache.delete(rdCache.keys().next().value);
        }
        rdSyncWireDesc(d, url);
      }
    })
    .catch(() => {})
    .finally(() => rdPrefetching.delete(url));
}
const RD_PREF_SEL = 'a.lead, a.nw, a.si, a.tk, a.th-link, a.srcl, a.tw-txt a, a.th-txt a';
const rdPrefetchAnchor = a => { if (a && a.href && a.target === '_blank') rdPrefetch(a.href); };

document.addEventListener('pointerdown', e => {
  const a = e.target.closest && e.target.closest(RD_PREF_SEL);
  rdPrefetchAnchor(a);
}, { passive: true });

function rdPrefetchVisible() {
  if (API == null) return;
  const seen = new Set(), out = [];
  for (const a of document.querySelectorAll(RD_PREF_SEL)) {
    const h = a.href;
    if (!h || !/^https?:/i.test(h) || isSocialPost(h) || a.offsetParent === null) continue;
    if (seen.has(h) || rdCache.has(h) || rdPrefetching.has(h)) continue;
    seen.add(h); out.push(h);
    if (out.length >= 4) break;
  }
  out.forEach(rdPrefetch);
}
async function rdOpen(url, trigger, push = true, hero = '', forceFresh = false) {
  if (!/^https?:/i.test(url)) return;
  if (isSocialPost(url)) return rdOpenSocial(url, trigger, push);
  if (push && rdCurrentView && !(rdCurrentView.kind === 'web' && rdCurrentView.url === url)) rdPushView();
  rdCurrent = url;
  rdHero = hero || '';
  rdCurrentView = { kind: 'web', url, hero: rdHero };
  rdTrigger = trigger || rdTrigger;
  const wasOpen = rdOn;
  if (!wasOpen) { rdSetOpen(true); rdDefaultPlace(); }
  $('#reader').classList.remove('is-post');
  rdSyncBack();
  $('#rd-kind').textContent = 'Baca';
  $('#rd-host').textContent = rdHostOf(url);
  $('#rd-open').href = url;
  $('#rd-state').textContent = 'menarik…';
  rdStopMedia();
  $('#rd-body').innerHTML = '<div class="rd-art"><div class="rd-sk t"></div><div class="rd-sk"></div><div class="rd-sk"></div><div class="rd-sk s"></div><div class="rd-sk"></div><div class="rd-sk"></div><div class="rd-sk s"></div></div>';
  $('#rd-body').scrollTop = 0;
  if (!wasOpen) { try { $('#rd-close').focus({ preventScroll: true }); } catch (e) {} }
  if (API == null) { rdError(url, 'Server belum terdeteksi. Jalankan node server.js.'); return; }
  try {
    let d = forceFresh ? null : rdCache.get(url);
    if (!d) {
      d = await getJson(API + '/api/read?u=' + encodeURIComponent(url) + (forceFresh && SITREP_CAN_FRESH ? '&fresh=1' : ''), 45000, 0);
      if (d && d.ok && !d.wireFallback && !d.upstreamBlocked && !d.isFallback) {
        rdCache.set(url, d);
        if (rdCache.size > 80) rdCache.delete(rdCache.keys().next().value);
      }
    }
    if (rdCurrent !== url) return;
    if (!d || !d.ok) throw new Error((d && d.err) || 'tidak ada respons');
    rdArticle(d, url);
  } catch (e) {
    if (rdCurrent !== url) return;
    const msg = e.message || String(e);

    if (/abort|timeout|timed out|failed|network|HTTP 5|ECONN|fetch/i.test(msg) && !rdAutoRetried.has(url)) {
      rdAutoRetried.add(url);
      if (rdAutoRetried.size > 120) rdAutoRetried.delete(rdAutoRetried.keys().next().value);
      $('#rd-state').textContent = 'coba lagi…';
      setTimeout(() => { if (rdCurrent === url) rdOpen(url, rdTrigger, false, rdHero); }, 1500);
      return;
    }
    rdError(url, msg);
  }
}
function rdPost(kind, p, trigger, push = true) {
  const isX = kind === 'x';
  const url = p.url || (isX ? 'https://x.com/' : 'https://www.threads.com/');
  if (push) rdPushView();
  rdCurrent = url;
  rdCurrentView = { kind: 'post', postKind: kind, p };
  rdHero = '';
  rdTrigger = trigger || rdTrigger;
  const wasOpen = rdOn;
  if (!wasOpen) { rdSetOpen(true); rdDefaultPlace(); }
  $('#reader').classList.add('is-post');
  rdSyncBack();
  $('#rd-kind').textContent = isX ? 'Post · X' : 'Post · Threads';
  $('#rd-host').textContent = isX ? 'x.com' : 'threads.com';
  $('#rd-open').href = /^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : '#';
  const name0 = deEmoji(p.name || p.full_name || '');
  const name = name0 || deEmoji(p.username || p.handle || '');
  const handle = isX ? (p.handle || '') : '@' + (p.username || '');
  const ts = isX ? (p.ts || 0) : (p.created_at ? Date.parse(p.created_at) : 0);
  const avSrc = isX ? (p.avatar || '')
    : (p.avatar ? (API != null ? tokQ(API + '/img?u=' + encodeURIComponent(p.avatar)) : p.avatar) : '');
  const ini = esc(name.slice(0, 1).toUpperCase() || '?');
  const av = `<span class="rd-pa" style="--h:${hue(handle || name)}">${ini}${avSrc ? `<img src="${escUrl(avSrc)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;
  const vf = isX ? (p.verified ? `<span class="vf">${ic('verified')}</span>` : '')
    : (p.is_verified ? `<span class="vf">${ic('thcheck')}</span>` : '');
  const text = isX ? linkify(p.text || '') : linkifyThreads(p.text || '');
  const stats = isX
    ? `<span>${I.reply}${num(p.replies)}</span><span>${I.rt}${num(p.reposts)}</span><span>${I.like}${num(p.likes)}</span><span>${I.views}${num(p.views)}</span>`
    : `<span>${I.like}${num(p.like_count)}</span><span>${I.reply}${num(p.reply_count)}</span><span>${I.rt}${num(p.repost_count)}</span>`;
  let media = '';
  if (Array.isArray(p.media) && p.media.length) {
    const list = p.media.slice(0, 4);
    const mCount = Math.min(list.length, 4);
    media = `<div class="rd-media rd-m-${mCount}">` + list.map(m => {
      if (m.type === 'video') return `<video controls playsinline preload="metadata" src="${escUrl(m.url)}"></video>`;
      const src = (!isX && API != null) ? tokQ(API + '/img?u=' + encodeURIComponent(m.url)) : m.url;
      return `<img src="${escUrl(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
    }).join('') + '</div>';
  }
  rdStopMedia();
  $('#rd-body').innerHTML = `<div class="rd-post">${av}<div>
    <div class="rd-pn"><span>${esc(name)}</span>${vf}</div>
    <div class="rd-ph">${esc(handle)}${ts ? ' · ' + esc(wibFull(ts)) + ' WIB' : ''}</div>
    <div class="rd-pt">${text}</div>
    ${media}
    <div class="rd-stats">${stats}</div>
  </div></div><div id="rd-thread" class="rd-thread"></div>`;
  $('#rd-state').textContent = isX ? 'post x' : 'post threads';
  $('#rd-body').scrollTop = 0;
  if (!wasOpen) { try { $('#rd-close').focus({ preventScroll: true }); } catch (e) {} }
  rdFitView();
  rdLoadThread(isX ? 'x' : 'threads', url);
}
function rdBack() {
  const prev = rdStack.pop();
  if (!prev) return;
  rdSyncBack();
  if (prev.kind === 'post') rdPost(prev.postKind, prev.p, null, false);
  else rdOpen(prev.url, null, false, prev.hero || '');
}
function rdClose() {
  if (!rdOn) return;
  rdSetOpen(false);
  $('#reader').classList.remove('is-post');
  rdStopMedia();
  rdCurrent = ''; rdCurrentView = null; rdStack = [];
  rdSyncBack();
  const t = rdTrigger; rdTrigger = null;
  if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (e) {} }
}
$('#rd-close').addEventListener('click', rdClose);
$('#rd-back').addEventListener('click', rdBack);
$('#rd-body').addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target !== '_blank') return;
  e.preventDefault();
  rdOpen(a.href, a);
});
const rdH = $('#rd-drag');
rdH.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  e.preventDefault();
  const r = $('#reader').getBoundingClientRect();
  rdDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  $('#reader').classList.add('drag');
  try { rdH.setPointerCapture(e.pointerId); } catch (err) {}
});
addEventListener('pointermove', e => {
  if (!rdDrag) return;
  rdPlace(e.clientX - rdDrag.dx, e.clientY - rdDrag.dy);
});
function rdDrop(e) {
  if (!rdDrag) return;
  rdDrag = null;
  $('#reader').classList.remove('drag');
  try { if (rdH.hasPointerCapture(e.pointerId)) rdH.releasePointerCapture(e.pointerId); } catch (err) {}
  try {
    const r = $('#reader').getBoundingClientRect();
    localStorage.setItem('sitrep.reader', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
  } catch (err) {}
}
addEventListener('pointerup', rdDrop);
addEventListener('pointercancel', rdDrop);
addEventListener('resize', () => {
  paintHeroes();
  if (!rdOn) return;
  const r = $('#reader').getBoundingClientRect();
  rdPlace(r.left, r.top);
});
document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (a) {
    if (a.closest('#reader, #tvwrap, .glb, .mapwrap, .foot') || e.target.closest('.lead-vid')) return;
    if (a.target !== '_blank') return;
    const href = a.href;
    if (!/^https?:/i.test(href)) return;
    if (a.classList.contains('tw-o')) {
      const p = xPosts.find(x => x.url === href);
      if (p) { e.preventDefault(); rdPost('x', p, a); return; }
    }
    if (a.classList.contains('th-o')) {
      const p = tPosts.find(x => x.url === href);
      if (p) { e.preventDefault(); rdPost('threads', p, a); return; }
    }
    if (a.matches('.lead, .nw, .si, .tk, .th-link, .srcl, .tw-txt a, .th-txt a')) {
      const im = a.querySelector('img');
      e.preventDefault(); rdOpen(href, a, true, im ? (im.currentSrc || im.src || '') : ''); return;
    }
    return;
  }
  if (getSelection && String(getSelection()).trim()) return;
  const card = e.target.closest('.tw[data-url], .th[data-url]');
  if (!card || e.target.closest('a,button,.tw-share,.th-share')) return;
  const href = card.dataset.url;
  const isX = card.classList.contains('tw');
  const p = (isX ? xPosts : tPosts).find(x => x.url === href);
  if (!p) return;
  e.preventDefault();
  rdPost(isX ? 'x' : 'threads', p, card);
});

