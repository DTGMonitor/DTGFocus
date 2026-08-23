/* ============================================================
   ui/aoi.js — the selection mask: a box plus any number of drawn regions,
   joined into one area the statistics, histogram and ranking describe.
   ============================================================ */
'use strict';

SM.AOI = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, fmtCoord = SM.fmtCoord, num = SM.num;

  var BOX_FIELDS = ['aoiXmin', 'aoiXmax', 'aoiYmin', 'aoiYmax'];
  var ALL_FIELDS = BOX_FIELDS.concat(['aoiZmin', 'aoiZmax', 'aoiSlopeMin', 'aoiSlopeMax']);

  function init() {
    $('chkAOI').onchange = function () { apply(); };
    $('aoiRegionName').onchange = function () {
      rename(+this.dataset.i, this.value);
      SM.status('Region renamed to “' + nameOf(+this.dataset.i) + '”.');
    };
    ALL_FIELDS.forEach(function (id) {
      $(id).onchange = function () {
        /* Typing an X/Y bound means the rectangle is the thing being steered,
           and a polygon drawn earlier would silently override it — so editing
           one of those four drops the rings. Z and slope stack on top of a
           polygon happily and leave it alone. */
        if (BOX_FIELDS.indexOf(id) >= 0) setPolys([]);
        apply();
      };
    });
    updateUI();
  }

  /** everything downstream of a mask change, in one place */
  function apply() {
    if (!S.grid) { updateUI(); return; }
    recomputeMask();
    SM.Symbology.colorize();
    SM.Overlays.update();
    if (S.res) SM.Model.restat();
    SM.Model.invalidate();
    SM.Tree.refresh();
    SM.Cmd.refresh();
  }

  function toggle() { $('chkAOI').checked = !$('chkAOI').checked; apply(); }
  function setOn(on) { $('chkAOI').checked = !!on; apply(); }

  /* Everything that can change the mask comes through here, so the per-region
     tallies can never drift from the mask the statistics use. */
  function recomputeMask() {
    if (!S.grid) return;
    S.regions = [];
    S.mask = Sens.aoiMask(S.grid, S.der, aoiObj(), S.regions);
    S.fillStamp++;                       /* the drawn fill is built from it */
    updateUI();
  }

  function aoiObj() {
    return {
      on: $('chkAOI').checked,
      xmin: num('aoiXmin', -1e12), xmax: num('aoiXmax', 1e12),
      ymin: num('aoiYmin', -1e12), ymax: num('aoiYmax', 1e12),
      zmin: num('aoiZmin', -1e12), zmax: num('aoiZmax', 1e12),
      polys: S.polys.length ? S.polys : null,
      slopeMin: num('aoiSlopeMin', 0), slopeMax: num('aoiSlopeMax', 90)
    };
  }

  /* The rings are the XY boundary; the four numbers stay on their combined
     bounding box so everything downstream that only knows about a box — the
     clip link, saved projects, the pre-reject inside aoiMask — keeps working
     unchanged. Regions are joined, never subtracted: the statistics describe
     every cell inside any of them, counted once. */
  /* Names live alongside the rings rather than inside them: a ring is an array
     of coordinate pairs, and JSON.stringify drops any property hung off an
     array, so a name stored on the ring would vanish the first time a project
     was saved. Every mutation of S.polys goes through the four functions below,
     which is what keeps the two lists in step. */
  function setPolys(rings, names) {
    var keep = [];
    S.polyNames = [];
    (rings || []).forEach(function (r, i) {
      if (!r || r.length < 3) return;
      keep.push(r);
      S.polyNames.push((names && names[i]) || '');
    });
    S.polys = keep;
    if (!S.polys.length) S.polyHi = -1;
    updateUI();
  }

  function addPoly(ring, name) {
    S.polys.push(ring);
    S.polyNames.push(name || '');
    S.polyHi = -1;
    updateUI();
  }

  /** the label a region goes by, falling back to its position in the list */
  function nameOf(i) {
    return (S.polyNames && S.polyNames[i]) || ('Region ' + (i + 1));
  }

  function rename(i, name) {
    if (i < 0 || i >= S.polys.length) return;
    S.polyNames[i] = String(name || '').trim();
    updateUI();
    SM.Tree.refresh();
  }

  /**
   * A copy of a region, nudged clear of the original.
   *
   * Two walls of the same pit often want the same shape in two places, and
   * re-tracing it by hand is work for nothing. The copy lands offset rather
   * than exactly on top, because a polygon hidden underneath another one
   * cannot be seen, grabbed or told apart from it.
   */
  function duplicatePoly(i) {
    if (i < 0 || i >= S.polys.length) return;
    var step = S.grid ? SM.extentOf(S.grid).ext * 0.04 : 10;
    addPoly(S.polys[i].map(function (p) { return [p[0] + step, p[1] + step]; }),
      nameOf(i).replace(/ \(copy( \d+)?\)$/, '') + ' (copy)');
    writePolyBounds();
    apply();
    SM.Tree.select('region', S.polys.length - 1);
    SM.status('“' + nameOf(S.polys.length - 1) + '” copied, offset so you can see it. ' +
      'Arm “Stretch / move” and drag its centre handle to put it where it belongs.');
  }

  function removePoly(i) {
    if (i < 0 || i >= S.polys.length) return;
    var label = nameOf(i);
    var gone = S.polys.splice(i, 1)[0];
    S.polyNames.splice(i, 1);
    S.polyHi = -1;
    /* the box is left where it is when the last region goes: those four numbers
       are what the panel shows, so they should stay what the mask obeys */
    if (S.polys.length) writePolyBounds();
    apply();
    if (S.node.kind === 'region') SM.Tree.select('aoi', 'aoi');
    SM.status(S.polys.length
      ? label + ' removed (' + gone.length + ' vertices) — ' + S.polys.length +
        ' left, statistics rejoined.'
      : 'Last region removed — the X/Y box now applies on its own.');
  }

  function clearPolys() {
    if (!S.polys.length) return;
    setPolys([]); apply();
    SM.status('Regions cleared — the X/Y box now applies on its own.');
  }

  /** the drawing tool closed a ring */
  function commitRing(ring) {
    addPoly(ring);
    writePolyBounds();
    $('chkAOI').checked = true;
    apply();
    SM.status(S.polys.length === 1
      ? 'Selection mask set from a ' + ring.length + '-vertex polygon. Draw again to add a second region.'
      : 'Region ' + S.polys.length + ' added — the statistics now cover all ' +
        S.polys.length + ' regions together.');
  }

  function polysBounds(rings) {
    var b = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
    rings.forEach(function (ring) {
      ring.forEach(function (p) {
        if (p[0] < b.xmin) b.xmin = p[0]; if (p[0] > b.xmax) b.xmax = p[0];
        if (p[1] < b.ymin) b.ymin = p[1]; if (p[1] > b.ymax) b.ymax = p[1];
      });
    });
    return b;
  }

  function writePolyBounds() {
    if (!S.polys.length) return;
    var b = polysBounds(S.polys);
    $('aoiXmin').value = fmtCoord(b.xmin); $('aoiXmax').value = fmtCoord(b.xmax);
    $('aoiYmin').value = fmtCoord(b.ymin); $('aoiYmax').value = fmtCoord(b.ymax);
  }

  /**
   * The "selected region" strip in Properties: what it is called, how big it
   * is, and the two things you can do to it. Shown only while a region is the
   * selected tree node, because the rest of the panel describes the mask as a
   * whole and would otherwise read as if it applied to this one region.
   */
  function showRegion(i) {
    var box = $('aoiRegionBox');
    if (i == null || i < 0 || i >= S.polys.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('aoiRegionName').value = nameOf(i);
    $('aoiRegionName').dataset.i = i;
    var ring = S.polys[i];
    var cellA = S.grid ? S.grid.dx * S.grid.dy : NaN;
    var c = (S.regions.length === S.polys.length) ? S.regions[i] : null;
    $('aoiRegionInfo').textContent = ring.length + ' vertices' +
      (c != null && cellA === cellA
        ? '  ·  ' + SM.fmtInt(c) + ' cells  ·  ' + fmt(c * cellA / 10000, 2) + ' ha'
        : '');
  }

  /* The four X/Y boxes stop being inputs once regions exist — they become a
     read-out of the rings' bounding box, and say so. */
  function updateUI() {
    var n = S.polys.length;
    $('aoiShape').textContent = !n ? 'rectangle'
      : n === 1 ? '1 polygon, ' + S.polys[0].length + ' vertices'
        : n + ' polygons joined';
    BOX_FIELDS.forEach(function (id) {
      var f = $(id).parentNode;
      if (f.dataset.baseTitle == null) f.dataset.baseTitle = f.title || '';
      f.classList.toggle('derived', !!n);
      f.title = n
        ? 'Combined bounding box of the drawn regions. Editing it by hand discards them.'
        : f.dataset.baseTitle;
    });
    if (SM.Tree) SM.Tree.refresh();
  }

  function setFull() {
    var g = S.grid; if (!g) return;
    setPolys([]);
    $('aoiXmin').value = fmt(g.x0, 0); $('aoiXmax').value = fmt(g.x0 + (g.nx - 1) * g.dx, 0);
    $('aoiYmin').value = fmt(g.y0, 0); $('aoiYmax').value = fmt(g.y0 + (g.ny - 1) * g.dy, 0);
    $('aoiZmin').value = fmt(g.zmin, 0); $('aoiZmax').value = fmt(Math.ceil(g.zmax), 0);
    $('aoiSlopeMin').value = 0; $('aoiSlopeMax').value = 90;
    recomputeMask();
  }
  function setFullAndApply() { setFull(); apply(); }

  /** the clip box asks for these — set the four numbers then re-mask */
  function setBox(min, max) {
    setPolys([]);
    $('aoiXmin').value = fmt(min[0], 1); $('aoiXmax').value = fmt(max[0], 1);
    $('aoiYmin').value = fmt(min[1], 1); $('aoiYmax').value = fmt(max[1], 1);
    $('aoiZmin').value = fmt(min[2], 1); $('aoiZmax').value = fmt(max[2], 1);
    $('chkAOI').checked = true;
    apply();
  }

  return {
    init: init, apply: apply, toggle: toggle, setOn: setOn,
    aoiObj: aoiObj, recomputeMask: recomputeMask,
    setPolys: setPolys, addPoly: addPoly, removePoly: removePoly, clearPolys: clearPolys,
    nameOf: nameOf, rename: rename, showRegion: showRegion, duplicatePoly: duplicatePoly,
    commitRing: commitRing, writePolyBounds: writePolyBounds,
    setFull: setFull, setFullAndApply: setFullAndApply, setBox: setBox
  };
})();
