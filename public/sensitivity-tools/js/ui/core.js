/* ============================================================
   ui/core.js — the namespace every other UI module extends.

   Holds the application state, the layer catalogue, the small formatting
   helpers and a one-line event bus. Nothing here touches a control: it is
   the vocabulary the panels are written in, so a module can be read without
   chasing what `S` or `fmt` mean.
   ============================================================ */
'use strict';

var SM = (function () {

  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180;

  /* layers computable from the raster alone — available before a compute */
  var TERRAIN_LAYERS = { slope: 1, aspect: 1, elev: 1 };

  /* ------------------------------------------------- layer catalogue
     The tree, the properties header, the legend title and the exported file
     names all name the same nine rasters, so the names live in one place. */
  var LAYERS = [
    { id: 'sens', name: 'Sensitivity', group: 'analysis', needsRes: true },
    { id: 'amp', name: 'Amplitude proxy', group: 'analysis', needsRes: true },
    { id: 'vis', name: 'Visibility', group: 'analysis', needsRes: true },
    { id: 'range', name: 'Range to sensor', group: 'analysis', needsRes: true },
    { id: 'mmres', name: 'Measurable displacement', group: 'analysis', needsRes: true },
    { id: 'which', name: 'Best sensor', group: 'analysis', needsRes: true },
    { id: 'elev', name: 'Elevation', group: 'terrain' },
    { id: 'slope', name: 'Slope angle', group: 'terrain' },
    { id: 'aspect', name: 'Aspect', group: 'terrain' }
  ];
  var LAYER_BY_ID = {};
  LAYERS.forEach(function (L) { LAYER_BY_ID[L.id] = L; });

  /* ------------------------------------------------------- state */
  var S = {
    files: [],          // {name, text, type, dataset, note, pending}
    preview: null,      // ascii preview of the pending file
    merged: null,
    grid: null, der: null,
    radars: [], sel: 0,
    res: null, mask: null,
    polys: [],          // drawn AOI regions, joined as a union
    polyNames: [],      // their labels, kept in step by ui/aoi.js
    regions: [],        // masked cell count per region, refilled with the mask
    polyHi: -1,         // region highlighted from the list

    /* ---- structural geology ----
       `planes` are mapped discontinuities (dip / dip direction); `kin` is the
       last kinematic result over them; `domains` are drawn polygons that carry
       their own movement vector and override the global assumption inside
       their own footprint, with `domIdx` the resolved cell -> domain lookup. */
    planes: [],
    kin: null,
    netHi: null,        // {kind:'plane'|'pair', index} lit on the stereonet
    domains: [],
    domIdx: null,
    domHi: -1,          // domain highlighted from the card list
    pendingDomain: null,// movement vector waiting for a polygon to be drawn
    /* the two planes behind the staged vector, when it came from a wedge —
       without them a block cannot be constructed, only traced */
    stagedPlanes: null,

    layer: 'elev',
    curLayer: null,     // the resolved layer object, cached for the read-out

    /* What the tree has selected. `kind` routes the Properties dock;
       `id` is the layer name, the sensor index or the region index. */
    node: { kind: 'none', id: null },

    /* Overlay visibility. These were tick boxes in the old sidebar; they are
       now tree rows, so the tree is the only thing that writes them and every
       drawing path reads them from here rather than from a checkbox. */
    show: {
      box: true, fan: true, vec: true, wire: false, struct: true, dom: true, fill: true,
      /* the terrain itself: `surface` draws the mesh at all, `flat` paints it
         one colour instead of the active layer's ramp */
      surface: true, flat: false, xline: true
    },

    /* Bumped by whoever recomputes the selection mask or the domain index.
       The draped polygon fills are built from those two, and rebuilding them
       is a pass over the raster, so the overlay caches its geometry against
       this counter rather than on every hover. */
    fillStamp: 0,

    /* armed map tool:
       nav | identify | sensor | aoi | plane | domain | measure | edit | anchor */
    tool: 'nav',
    clip: { mode: 'off', axis: 2, centre: NaN, thick: NaN },
    clipSyncing: false,
    pickBuf: [],
    /* the vertex being stretched, and the one under the cursor waiting to be
       grabbed — see ui/editpoly.js */
    editGrab: null,
    editHi: null,
    anchorPlane: null,  // the plane waiting for a click to place it
    /* the ruler's point list, kept out of pickBuf because a finished
       measurement stays on screen after the tool has been put away */
    measure: { pts: [], closed: false },
    probe: null,
    busy: false
  };

  /* Attachment point for optional add-on modules (radar-ui.js). They need two
     things the core cannot anticipate: to take over canvas clicks while a
     tie-point is being placed, and to watch ordinary probe clicks so they can
     answer "what covers this spot". Kept as a tiny surface so the core never
     has to know what the add-on actually does. */
  var EXT = { pick: null, cancel: null, probe: [] };

  var LAYER_DEFAULTS = {
    sens: { preset: 'green', vmin: 0, vmax: 1 },
    amp: { preset: 'amplitude', vmin: 0, vmax: 1 },
    vis: { preset: 'rdylgn', vmin: 0, vmax: 1, bands: 2 },
    range: { preset: 'viridis', auto: true },
    slope: { preset: 'turbo', vmin: 0, vmax: 90 },
    aspect: { preset: 'aspect', vmin: 0, vmax: 360 },
    elev: { preset: 'terrain', auto: true },
    which: { preset: 'sensors', auto: true, discrete: true },
    mmres: { preset: 'green', auto: true }
  };
  var LC = {};   // live per-layer colour configs
  Object.keys(LAYER_DEFAULTS).forEach(function (k) {
    var d = LAYER_DEFAULTS[k];
    LC[k] = {
      preset: d.preset, stops: ColorMaps.PRESETS[d.preset].stops.map(function (s) { return s.slice(); }),
      reverse: false, bands: d.bands || 0, gamma: 1,
      vmin: d.vmin != null ? d.vmin : 0, vmax: d.vmax != null ? d.vmax : 1,
      auto: !!d.auto
    };
  });

  /* ------------------------------------------------------- event bus
     Modules that must react to something they do not own subscribe here
     rather than importing each other. Three facts are broadcast: a new
     raster exists, a compute finished, and the tree needs redrawing. */
  var handlers = {};
  function on(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); }
  function emit(name, arg) {
    var list = handlers[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](arg);
  }

  /* ------------------------------------------------------- helpers */
  function throttle(fn, ms) {
    var last = 0, pend = null;
    return function () {
      var a = arguments, now = performance.now();
      if (now - last > ms) { last = now; fn.apply(null, a); }
      else { clearTimeout(pend); pend = setTimeout(function () { last = performance.now(); fn.apply(null, a); }, ms); }
    };
  }
  function status(t, right) {
    $('statusText').textContent = t;
    if (right != null) $('statusRight').textContent = right;
  }
  function setHud(title, sub) { $('hudTitle').textContent = title; $('hudSub').textContent = sub || ''; }
  function badge(t, cls) {
    var b = $('modeBadge'); b.textContent = t;
    b.className = 'badge' + (cls ? ' ' + cls : '');
  }
  function fmt(v, d) { return (v == null || v !== v) ? '—' : (+v).toFixed(d == null ? 2 : d); }
  /* counts may be grouped for readability … */
  function fmtInt(v) { return (v == null || v !== v) ? '—' : Math.round(v).toLocaleString(); }
  /* … but survey coordinates never are: a locale that groups with "." turns
     57996 into "57.996", which reads as 58 metres. Plain digits only. */
  function fmtCoord(v) { return (v == null || v !== v) ? '—' : String(Math.round(v)); }
  /* a canvas cannot read CSS variables, so resolve one at draw time — computed
     custom properties come back fully substituted, which is what lets a build
     that re-aliases the token theme the drawing without touching this file */
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function nearXY(hit, p, tol) {
    return !!p && Math.abs(hit.x - p[0]) <= tol && Math.abs(hit.y - p[1]) <= tol;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  /** value of a numeric field, falling back only when it is blank or unparseable
      — `parseFloat(x) || def` would throw away a deliberate 0 */
  function numOr(id, def) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : def;
  }
  function num(id, d) { var v = parseFloat($(id).value); return isFinite(v) ? v : d; }

  /** the raster's own extent, in survey units — wanted in half a dozen places */
  function extentOf(g) {
    if (!g) return null;
    var x2 = g.x0 + (g.nx - 1) * g.dx, y2 = g.y0 + (g.ny - 1) * g.dy;
    return { x1: g.x0, x2: x2, y1: g.y0, y2: y2, z1: g.zmin, z2: g.zmax, ext: Math.max(x2 - g.x0, y2 - g.y0) };
  }

  /** SVG sprite reference — every icon in generated markup goes through here */
  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#ic-' + name + '"></use></svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    $: $, DEG: DEG, TERRAIN_LAYERS: TERRAIN_LAYERS,
    LAYERS: LAYERS, LAYER_BY_ID: LAYER_BY_ID, LAYER_DEFAULTS: LAYER_DEFAULTS,
    S: S, LC: LC, EXT: EXT,
    V: null,                                  // the Viewer, once ui.js boots
    on: on, emit: emit,
    throttle: throttle, status: status, setHud: setHud, badge: badge,
    fmt: fmt, fmtInt: fmtInt, fmtCoord: fmtCoord, cssVar: cssVar,
    nearXY: nearXY, clamp: clamp, numOr: numOr, num: num,
    extentOf: extentOf, icon: icon, esc: esc
  };
})();
