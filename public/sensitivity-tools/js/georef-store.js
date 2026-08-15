/* ============================================================
   georef-store.js — where a wall folder's georeference is kept.

   SensiMap runs in two places and must behave the same in both:

     embedded   inside the DTG Focus platform, in an iframe. The parent frame
                owns the Supabase session, so persistence is a postMessage
                round trip and the transform is shared across every operator
                on the site.
     standalone opened straight off disk with no server at all. Then
                localStorage is the whole story — still useful, because the
                point of saving is that the NEXT scan of the same wall folder
                georeferences itself without asking.

   The transport is chosen by asking rather than guessing: the store pings the
   parent on start-up and falls back to localStorage if nothing answers inside
   the timeout. Guessing from `window.parent !== window` would be wrong the
   moment the tool is embedded in anything that is not the platform.
   ============================================================ */
'use strict';

var GeorefStore = (function () {

  var LS_KEY = 'sensimap.georef.v1';
  var PROBE_MS = 1500;

  var mode = 'pending';          // 'pending' | 'platform' | 'local'
  var seq = 0;
  var waiting = {};              // request id -> {resolve, reject, timer}
  var readyQueue = [];
  var probeTimer = null;

  /* ---------------------------------------------- transport */

  function post(op, payload) {
    return new Promise(function (resolve, reject) {
      var id = 'gr' + (++seq);
      var timer = setTimeout(function () {
        delete waiting[id];
        reject(new Error('the platform did not respond'));
      }, 8000);
      waiting[id] = { resolve: resolve, reject: reject, timer: timer };
      window.parent.postMessage(
        Object.assign({ type: 'sensimap-georef', op: op, id: id }, payload || {}), '*'
      );
    });
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;

    /* The parent announcing itself, either unprompted or answering our ping. */
    if (d.type === 'sensimap-georef-ready') { settle('platform'); return; }
    if (d.type !== 'sensimap-georef-result') return;

    var w = waiting[d.id];
    if (!w) return;
    clearTimeout(w.timer);
    delete waiting[d.id];
    if (d.ok) w.resolve(d.data);
    else w.reject(new Error(d.error || 'save failed'));
  });

  function settle(m) {
    if (mode !== 'pending') return;
    mode = m;
    if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
    var q = readyQueue; readyQueue = [];
    for (var i = 0; i < q.length; i++) q[i]();
  }

  function ready() {
    if (mode !== 'pending') return Promise.resolve(mode);
    return new Promise(function (resolve) {
      readyQueue.push(function () { resolve(mode); });
    });
  }

  function init() {
    if (window.parent === window) { settle('local'); return; }
    try {
      window.parent.postMessage({ type: 'sensimap-georef', op: 'ping' }, '*');
    } catch (e) { settle('local'); return; }
    probeTimer = setTimeout(function () { settle('local'); }, PROBE_MS);
  }

  /* ---------------------------------------------- local fallback */

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeLocal(all) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); return true; }
    catch (e) { return false; }
  }

  /* ---------------------------------------------- api */

  /**
   * The georeference for one wall folder, or null if it has never been placed.
   * A rejection is NOT a null — a lookup that failed must not be reported to
   * the user as "this folder is unregistered", or they will re-survey ties
   * that already exist.
   */
  function load(key) {
    return ready().then(function (m) {
      if (m === 'platform') return post('load', { key: key });
      return readLocal()[key] || null;
    });
  }

  function save(key, record) {
    var stamped = Object.assign({}, record, { key: key, savedAt: new Date().toISOString() });
    return ready().then(function (m) {
      if (m === 'platform') return post('save', { key: key, record: stamped });
      var all = readLocal();
      all[key] = stamped;
      if (!writeLocal(all)) throw new Error('browser storage is full');
      return stamped;
    });
  }

  function remove(key) {
    return ready().then(function (m) {
      if (m === 'platform') return post('remove', { key: key });
      var all = readLocal();
      delete all[key];
      writeLocal(all);
      return true;
    });
  }

  /** Every registered wall folder, for the "already registered" list. */
  function list() {
    return ready().then(function (m) {
      if (m === 'platform') return post('list', {});
      var all = readLocal(), out = [];
      for (var k in all) {
        if (Object.prototype.hasOwnProperty.call(all, k)) out.push(all[k]);
      }
      return out;
    });
  }

  function where() { return mode; }

  init();

  return { load: load, save: save, remove: remove, list: list, where: where, ready: ready };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeorefStore;
