const sharePost = async (el, url) => {
  try {
    if (navigator.share) { await navigator.share({ url }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      const old = el.innerHTML;
      el.style.color = '#17bf63';
      setTimeout(() => { el.innerHTML = old; el.style.color = ''; }, 900);
    }
  } catch (err) {  }
};
document.addEventListener('click', e => {
  const sh = e.target.closest('.tw-share, .th-share');
  if (!sh) return;
  const card = sh.closest('.tw[data-url], .th[data-url]');
  const url = card && card.dataset.url;
  if (!url || !/^https?:/i.test(url)) return;
  e.preventDefault(); e.stopPropagation();
  sharePost(sh, url);
});

$$('.pane').forEach(p => {
  const ph = p.querySelector('.ph');
  if (!ph) return;
  ph.addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, textarea, .soc-tabs')) return;
    p.classList.toggle('open');
    if (p.classList.contains('mkt')) paintHeroes();
    if (P.size && (p.contains(camGrid) || matchMedia('(max-width: 820px)').matches)) {
      requestAnimationFrame(() => { if (p.contains(camGrid)) layout(); refreshCamVis(); });
    }
  });
});
if (matchMedia('(max-width: 820px)').matches) {
  const first = $('.pane');
  if (first) first.classList.add('open');

  const soc = $('.pane[aria-label="Social live"]');
  if (soc) soc.classList.add('open');

}

ensureHls().catch(() => {});
if (!tvOn) tvOpen(true);

(async () => {
  await detectApi();
  drawCityBar(); renderCams();
  renderAllQchips();
  renderCatbar();
  sitInitMap();
  paintBreak();

  trackBg(pullDisaster().then(() => drawGlobe(performance.now())).catch(() => {}));
  pullBreaking();
  if (layerOn.peringatan) trackBg(pullAlerts().catch(() => {}));
  refreshAll(false);
})();
