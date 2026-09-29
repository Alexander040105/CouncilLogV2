/* Wires window.COUNCILOG_LINKS into the page.
 * - element[data-link="x"] becomes a real link when links.x is set;
 *   otherwise it renders inert with a "— soon" suffix (see styles.css).
 * - div[data-slot="expoQr"] is revealed + populated when links.expoQr is set. */
(function () {
  var links = window.COUNCILOG_LINKS || {};

  document.querySelectorAll('[data-link]').forEach(function (el) {
    var url = links[el.getAttribute('data-link')];
    if (!url) {
      el.setAttribute('data-empty', '');
      el.removeAttribute('href');
      return;
    }
    el.removeAttribute('data-empty');
    el.setAttribute('href', url);
    if (/^https?:\/\//.test(url)) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    }
  });

  var slot = document.querySelector('[data-slot="expoQr"]');
  if (slot && links.expoQr) {
    var img = slot.querySelector('[data-qr-img]');
    if (img) img.src = links.expoQr;
    slot.hidden = false;
  }
})();
