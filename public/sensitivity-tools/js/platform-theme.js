/* ============================================================
   platform-theme.js — light/dark bridge for the embedded tool.

   Not an upstream file. scripts/sensitivity-theme.mjs copies this in and
   injects the <script> tag, so edit it here, never in public/.

   The tool runs in a same-origin iframe, and CSS custom properties do not
   cross a frame boundary — so the platform's theme has to be told to it.
   Three sources, most authoritative first:

     1. ?theme= on the iframe src. The host sets this, so the very first
        paint is already correct and there is no flash of the wrong theme.
     2. The host document's `dark` class, read directly through window.parent.
     3. The OS preference, for when the page is opened standalone.

   After the initial paint the host keeps us in step with postMessage.
   ============================================================ */
'use strict';

var SMTheme = (function () {
  var QUERY = /[?&]theme=(dark|light)/;
  var cache = {};

  function hostedTheme() {
    var m = QUERY.exec(location.search);
    if (m) return m[1] === 'dark';

    try {
      var host = window.parent.document.documentElement;
      if (host !== document.documentElement) return host.classList.contains('dark');
    } catch (e) {
      /* cross-origin embed — nothing to read, fall through to the OS */
    }

    return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function apply(dark) {
    document.documentElement.classList.toggle('dark', !!dark);
    cache = {}; // computed values just changed under us
  }

  /* Canvas has no var() — the histogram, colourbar and PNG export resolve
     their theme tokens through here instead. */
  function col(name) {
    if (cache[name] == null) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      cache[name] = (v || '').trim() || '#808080';
    }
    return cache[name];
  }

  function set(dark) {
    if (!!dark === document.documentElement.classList.contains('dark')) return;
    apply(dark);
    // ui.js repaints its canvases off this
    window.dispatchEvent(new Event('platformtheme'));
  }

  apply(hostedTheme());

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'platform-theme') set(e.data.theme === 'dark');
  });

  /* Standalone only — when embedded the host is the single source of truth
     and its own OS handling already reaches us over postMessage. */
  if (window.matchMedia && window.parent === window && !QUERY.test(location.search)) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) {
      mq.addEventListener('change', function () { set(mq.matches); });
    }
  }

  return { col: col, set: set };
})();
