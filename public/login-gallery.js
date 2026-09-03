const galleryItems = document.querySelectorAll('.login-gallery-item');
const lastTouch = new WeakMap();
let lastTouchToggle = 0;
function setGalleryZoom(item, zoomed) {
  galleryItems.forEach((candidate) => { if (candidate !== item) { candidate.classList.remove('is-zoomed'); candidate.setAttribute('aria-pressed', 'false'); } });
  item.classList.toggle('is-zoomed', zoomed);
  item.setAttribute('aria-pressed', String(zoomed));
  document.body.classList.toggle('gallery-zoom-open', zoomed);
}
galleryItems.forEach((item) => {
  item.addEventListener('dblclick', () => { if (Date.now() - lastTouchToggle > 600) setGalleryZoom(item, !item.classList.contains('is-zoomed')); });
  item.addEventListener('touchend', (event) => { const now = Date.now(); const previous = lastTouch.get(item) ?? 0; lastTouch.set(item, now); if (now - previous < 350) { event.preventDefault(); lastTouchToggle = now; lastTouch.set(item, 0); setGalleryZoom(item, !item.classList.contains('is-zoomed')); } }, { passive: false });
  item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setGalleryZoom(item, !item.classList.contains('is-zoomed')); } });
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const zoomed = document.querySelector('.login-gallery-item.is-zoomed'); if (zoomed) setGalleryZoom(zoomed, false); } });
