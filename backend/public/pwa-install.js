/* Attendance Tracker — install affordance for the companion dashboard PWA.
 *
 * Chrome's install mini-infobar is easy to miss and iOS Safari shows nothing at
 * all, so this renders a small, dismissible bar prompting "Add to Home Screen".
 * Self-contained: injects its own markup + styles, no page changes required.
 *
 * Never shows when: running inside an iframe (the Meet add-on panel), already
 * installed (standalone display-mode / iOS navigator.standalone), or previously
 * dismissed (localStorage). Android/desktop Chrome uses the real
 * beforeinstallprompt; iOS falls back to a Share-sheet hint.
 */
(function () {
  // Only ever run at the top level — never inside the Meet add-on iframe.
  if (window.self !== window.top) return;

  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
  if (standalone) return;

  var DISMISS_KEY = 'att_pwa_install_dismissed';
  try { if (localStorage.getItem(DISMISS_KEY)) return; } catch (e) { /* private mode → just proceed */ }

  var deferredPrompt = null;
  var ua = navigator.userAgent || '';
  var isIos = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* best-effort */ }
    var b = document.getElementById('pwa-install-bar');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function makeBar(innerHtml) {
    if (document.getElementById('pwa-install-bar') || !document.body) return null;
    var bar = document.createElement('div');
    bar.id = 'pwa-install-bar';
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9997;max-width:460px;margin:0 auto;'
      + 'background:#161b22;border:1px solid #30363d;border-radius:12px;padding:12px 14px;display:flex;align-items:center;'
      + 'gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;'
      + 'font-size:.85rem;color:#e6edf3';
    bar.innerHTML = innerHtml;
    document.body.appendChild(bar);
    var closeBtn = bar.querySelector('[data-pwa-dismiss]');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    return bar;
  }

  var ICON = '<img src="/icons/icon-192.png" alt="" style="width:34px;height:34px;border-radius:8px;flex-shrink:0" />';
  var CLOSE = '<button type="button" data-pwa-dismiss aria-label="Dismiss" style="background:none;border:none;'
    + 'color:#8b949e;font-size:1.3rem;line-height:1;cursor:pointer;padding:0 2px;flex-shrink:0">×</button>';

  // Android / desktop Chrome — the real install prompt.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var bar = makeBar(
      ICON
      + '<div style="flex:1;line-height:1.35"><strong>Install Attendance Tracker</strong><br>'
      + '<span style="color:#8b949e">Add it to your home screen for one-tap access.</span></div>'
      + '<button type="button" data-pwa-install style="background:#34A853;color:#fff;border:none;padding:8px 14px;'
      + 'border-radius:8px;font-weight:600;cursor:pointer;flex-shrink:0">Install</button>'
      + CLOSE
    );
    if (!bar) return;
    var installBtn = bar.querySelector('[data-pwa-install]');
    if (installBtn) installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return dismiss();
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; dismiss(); }, function () { dismiss(); });
    });
  });

  // Chrome fires this after a successful install — clear the bar for good.
  window.addEventListener('appinstalled', dismiss);

  // iOS Safari has no beforeinstallprompt — show a Share-sheet hint once loaded.
  if (isIos) {
    window.addEventListener('load', function () {
      makeBar(
        ICON
        + '<div style="flex:1;line-height:1.35"><strong>Add to Home Screen</strong><br>'
        + '<span style="color:#8b949e">Tap the Share icon, then “Add to Home Screen”.</span></div>'
        + CLOSE
      );
    });
  }
})();
