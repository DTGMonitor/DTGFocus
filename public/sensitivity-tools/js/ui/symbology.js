/* ============================================================
   ui/symbology.js — how the active raster is coloured: the ramp editor in
   Properties, the per-cell colouring itself, and the legend over the map.
   ============================================================ */
'use strict';

SM.Symbology = (function () {

  var $ = SM.$, S = SM.S, LC = SM.LC, clamp = SM.clamp, TERRAIN = SM.TERRAIN_LAYERS;

  function init() {
    buildPresetList();

    $('selPreset').onchange = function () {
      var p = ColorMaps.PRESETS[$('selPreset').value];
      cfg().preset = $('selPreset').value;
      cfg().stops = p.stops.map(function (s) { return s.slice(); });
      refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
    };
    $('btnAddStop').onclick = function () {
      var c = cfg();
      c.stops.push([0.5, ColorMaps.sampleHex(lut(), 0.5)]);
      c.stops.sort(function (a, b) { return a[0] - b[0]; });
      refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
    };
    $('btnEvenStops').onclick = function () {
      var c = cfg(), n = c.stops.length;
      c.stops.forEach(function (s, i) { s[0] = n > 1 ? i / (n - 1) : 0; });
      refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
    };
    $('btnRevStops').onclick = function () {
      var c = cfg();
      c.stops = c.stops.map(function (s) { return [1 - s[0], s[1]]; }).sort(function (a, b) { return a[0] - b[0]; });
      refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
    };
    ['inpVmin', 'inpVmax', 'inpBands', 'inpGamma'].forEach(function (id) {
      $(id).onchange = function () {
        var c = cfg();
        c.vmin = parseFloat($('inpVmin').value); c.vmax = parseFloat($('inpVmax').value);
        c.bands = parseInt($('inpBands').value, 10) || 0;
        c.gamma = parseFloat($('inpGamma').value) || 1;
        c.auto = false;
        if (!(c.vmax > c.vmin)) c.vmax = c.vmin + 1;
        refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
      };
    });
    ['colNoData', 'colOccluded', 'colOutside', 'colBelow'].forEach(function (id) {
      $(id).onchange = function () { colorize(); };
    });
    $('btnAutoRange').onclick = function () {
      cfg().auto = true; autoRange(true); colorize(); updateLegend();
    };

    /* Which raster each of the two paintable layers is showing. These are the
       rows the tree used to carry: a layer is one thing, and the several ways
       it can be coloured are a property of it. */
    $('selTerrainMode').onchange = function () { SM.Tree.setTerrainMode(this.value); };
    $('selAnalysisMode').onchange = function () { SM.Tree.setAnalysisMode(this.value); };

    /* the terrain as a backdrop rather than a map: hide it outright, or paint
       it one colour so the structures drawn on it are all there is to read */
    /* the viewer starts with its own default; make the two agree explicitly
       rather than relying on them having been written the same way twice */
    SM.V.opt.surface = S.show.surface;
    $('chkSurface').onchange = function () { setSurface(this.checked); };
    $('chkFlat').onchange = function () { setFlat(this.checked); };
    $('colFlat').oninput = function () { if (S.show.flat) colorize(); };
    $('btnRevertColour').onclick = function () { setFlat(false); };

    /* The terrain's opacity is the viewer's mesh alpha, and it has two
       controls — the terrain's own sheet and the View tab — kept on one value. */
    $('inpTerrainAlpha').oninput = function () { setTerrainAlpha(SM.readOpacity('inpTerrainAlpha')); };
    $('inpResultAlpha').oninput = function () { setResultAlpha(SM.readOpacity('inpResultAlpha')); };

    /* rendering controls live in the View tab but belong to the viewer */
    $('inpOpacity').oninput = function () { setTerrainAlpha(+this.value); };
    $('inpZScale').oninput = function () { SM.V.opt.zScale = +this.value; SM.V.draw(); };
    $('inpSunAz').oninput = function () { SM.V.opt.sunAz = +this.value; SM.V.draw(); };
    $('inpSunEl').oninput = function () { SM.V.opt.sunEl = +this.value; SM.V.draw(); };
    $('inpShade').oninput = function () { SM.V.opt.shade = +this.value; SM.V.draw(); };
    $('selProjection').onchange = function () { SM.V.cam.ortho = this.value === 'ortho'; SM.V.draw(); };

    syncForm();
  }

  function buildPresetList() {
    var sel = $('selPreset');
    sel.innerHTML = '';
    Object.keys(ColorMaps.PRESETS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = ColorMaps.PRESETS[k].name || k;
      sel.appendChild(o);
    });
  }

  /** show or hide the terrain mesh; every overlay keeps drawing either way */
  function setSurface(on) {
    S.show.surface = !!on;
    SM.V.opt.surface = !!on;
    $('chkSurface').checked = !!on;
    updateLegend();
    SM.V.draw();
    SM.Tree.refresh(); SM.Cmd.refresh();
  }

  /** one flat colour instead of the active layer's ramp, and back again */
  function setFlat(on) {
    S.show.flat = !!on;
    $('chkFlat').checked = !!on;
    colorize();
    SM.Tree.refresh(); SM.Cmd.refresh();
    SM.status(on
      ? 'Terrain painted one flat colour — the layer colouring is hidden until you turn this off.'
      : 'Terrain back to the ' + (currentLayer() || {}).label + ' colour scale.');
  }

  /** see-through terrain: the mesh alpha, never low enough to lose the surface */
  function setTerrainAlpha(a) {
    a = clamp(+a || 1, 0.15, 1);
    SM.V.opt.alpha = a;
    $('inpOpacity').value = a;
    SM.showOpacity('inpTerrainAlpha', 'outTerrainAlpha', a);
    SM.V.draw();
    SM.Tree.refresh();
  }

  /** how strongly the processing result covers the terrain's own colouring */
  function setResultAlpha(a) {
    S.result.alpha = clamp(a == null || a !== a ? 1 : +a, 0, 1);
    SM.showOpacity('inpResultAlpha', 'outResultAlpha', S.result.alpha);
    colorize();
    SM.Tree.refresh();
  }

  function cfg() { return LC[S.layer] || LC.sens; }
  function lut() { return ColorMaps.buildLUT(cfg()); }

  function syncForm() {
    var c = cfg();
    c.preset = ColorMaps.resolve(c.preset);   // tolerate keys from older files
    $('selPreset').value = c.preset;
    $('inpVmin').value = c.vmin; $('inpVmax').value = c.vmax;
    $('inpBands').value = c.bands; $('inpGamma').value = c.gamma;
    var L = SM.LAYER_BY_ID[S.layer];
    $('cmName').textContent = L ? '— ' + L.name : '';
    $('selTerrainMode').value = S.terrainMode;
    $('selAnalysisMode').value = S.analysisMode;
    $('chkSurface').checked = !!S.show.surface;
    $('chkFlat').checked = !!S.show.flat;
    $('inpOpacity').value = SM.V.opt.alpha;
    SM.showOpacity('inpTerrainAlpha', 'outTerrainAlpha', SM.V.opt.alpha);
    SM.showOpacity('inpResultAlpha', 'outResultAlpha', S.result.alpha);
    /* The ramp editor is shared by the terrain and the result, so say which
       one it is editing — otherwise an unticked result silently edits the
       terrain's scale while its own row is selected. */
    var note = $('resultNote');
    if (note) {
      note.textContent = S.result.on
        ? 'On screen. The colour scale below is this analysis’ own.'
        : 'Unticked — the terrain is what you see, and the scale below is the ' +
          'terrain’s. Tick the row to bring the result back.';
    }
    refreshStopEditor();
  }

  function refreshStopEditor() {
    var c = cfg(), box = $('stopsEditor'), L = ColorMaps.buildLUT(c);
    box.innerHTML = '';
    c.stops.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'stopRow';
      row.innerHTML =
        '<input type="color" value="' + s[1] + '">' +
        '<input type="number" min="0" max="1" step="0.01" value="' + (+s[0]).toFixed(2) + '">' +
        '<div class="bar"></div><button class="rm" title="remove">✕</button>';
      var ci = row.children[0], pi = row.children[1], bar = row.children[2];
      bar.style.background = s[1];
      ci.oninput = function () { s[1] = ci.value; bar.style.background = ci.value; colorize(); updateLegend(); };
      ci.onchange = function () { SM.Tree.refresh(); };
      pi.onchange = function () {
        s[0] = clamp(parseFloat(pi.value) || 0, 0, 1);
        c.stops.sort(function (a, b) { return a[0] - b[0]; });
        refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
      };
      row.children[3].onclick = function () {
        if (c.stops.length <= 2) return;
        c.stops.splice(i, 1); refreshStopEditor(); colorize(); updateLegend(); SM.Tree.refresh();
      };
      box.appendChild(row);
    });
    var prev = document.createElement('div');
    prev.className = 'stopRow';
    prev.innerHTML = '<div class="bar" style="height:20px"></div>';
    prev.firstChild.style.background = ColorMaps.cssGradient(L, true);
    box.appendChild(prev);
  }

  /**
   * force = true  → stretch to the real data range (the “Auto range” button)
   * force = false → only layers flagged auto follow their natural range
   */
  function autoRange(force) {
    if (!S.grid) return;
    var c = cfg(), L = currentLayer();
    if (!L) return;
    var r;
    if (force) r = Sens.range(L.values, S.mask);
    else if (c.auto) r = (L.vmin != null && L.vmax != null) ? [L.vmin, L.vmax] : Sens.range(L.values, S.mask);
    else return;
    c.vmin = +(+r[0]).toFixed(3); c.vmax = +(+r[1]).toFixed(3);
    if (!(c.vmax > c.vmin)) c.vmax = c.vmin + 1;
    $('inpVmin').value = c.vmin; $('inpVmax').value = c.vmax;
  }

  function currentLayer() { return layerOf(S.layer); }

  /** the values behind one named raster, falling back to elevation for an
      analysis that has no run behind it yet */
  function layerOf(name) {
    if (!S.grid) return null;
    if (!S.res && !TERRAIN[name]) name = 'elev';
    if (S.res) return Sens.layer(name, S.res, S.grid, S.der, { trueDispl: parseFloat($('inpTrue').value) || 10 });
    /* terrain-only layers before a compute */
    var n = S.grid.nx * S.grid.ny;
    if (name === 'slope') {
      var s = new Float32Array(n);
      for (var i = 0; i < n; i++) s[i] = S.der.slope[i] * 180 / Math.PI;
      return { values: s, vmin: 0, vmax: 90, label: 'Slope angle', unit: '°' };
    }
    if (name === 'aspect') return { values: S.der.aspect, vmin: 0, vmax: 360, label: 'Aspect', unit: '°' };
    return { values: S.grid.z, vmin: S.grid.zmin, vmax: S.grid.zmax, label: 'Elevation', unit: 'm' };
  }

  /* ------------------------------------------------- colorize */
  function colorize() {
    if (!S.grid) return;
    var L = currentLayer(); if (!L) return;
    S.curLayer = L;                       // cached for the hover read-out
    var c = cfg();
    var g = S.grid, n = g.nx * g.ny;
    var out = new Float32Array(n * 3);

    /* Flat mode: one colour over the whole surface, so the terrain becomes a
       backdrop for the structures drawn on it instead of a map competing with
       them. Deliberately plain — no visibility codes, no below-threshold
       greying, no mask dimming — because the point is to stop the surface
       saying anything. Holes keep the no-data colour; a hole is geometry that
       is missing, not ground that has been given a uniform colour. Hill
       shading still applies, which is what keeps the relief readable. */
    if (S.show.flat) {
      var fc = ColorMaps.hex2rgb($('colFlat').value);
      var nd = ColorMaps.hex2rgb($('colNoData').value);
      for (var fi = 0; fi < n; fi++) {
        var fo = fi * 3, ok = g.z[fi] === g.z[fi], src = ok ? fc : nd;
        out[fo] = src[0] / 255; out[fo + 1] = src[1] / 255; out[fo + 2] = src[2] / 255;
      }
      SM.Photo.blend(out, null);       /* flat colour is not a statement about a cell */
      if (SM.Photo.has()) SM.Photo.syncForm();
      SM.V.setColors(out);
      SM.V.draw();
      updateLegend();
      return;
    }

    out = paint(S.layer, L, c);

    /* A part-transparent result is mixed over what the terrain would show with
       the result unticked — photo and all — so 0% is exactly that view rather
       than some third look nobody asked for. Only paid for in between. */
    var a = resultAlpha();
    if (a < 1) {
      var TL = layerOf(S.terrainMode), tc = LC[S.terrainMode];
      /* an auto-ranged terrain scale is only stretched while it is the active
         layer, so read its natural range here rather than a stale one —
         rounded as autoRange() rounds it, or 0% would not match unticking */
      if (tc.auto && TL.vmin != null && TL.vmax != null) {
        var lo = +(+TL.vmin).toFixed(3), hi = +(+TL.vmax).toFixed(3);
        tc = { stops: tc.stops, bands: tc.bands, gamma: tc.gamma, reverse: tc.reverse,
               discrete: tc.discrete, vmin: lo, vmax: hi > lo ? hi : lo + 1 };
      }
      var under = paint(S.terrainMode, TL, tc);
      for (var k = 0; k < out.length; k++) out[k] = under[k] + (out[k] - under[k]) * a;
    }

    if (SM.Photo.has()) SM.Photo.syncForm();
    SM.V.setColors(out);
    SM.V.draw();
    updateLegend();
  }

  /** the result's opacity while it is what is painted; 1 whenever it is not */
  function resultAlpha() {
    if (!S.res || TERRAIN[S.layer]) return 1;
    var a = S.result.alpha;
    return (a == null || a !== a) ? 1 : clamp(a, 0, 1);
  }

  /**
   * Colour every node by one raster, photo blended underneath.
   * @param {string} name  the raster's id — decides the visibility codes and
   *        the below-threshold grey-out, which belong to analyses only
   * @param {object} L     its values, from layerOf()
   * @param {object} c     its colour config
   * @returns {Float32Array} n*3 of 0-1 RGB
   */
  function paint(name, L, c) {
    var LUT = ColorMaps.buildLUT(c);
    var g = S.grid, n = g.nx * g.ny;
    var out = new Float32Array(n * 3);
    var vmin = c.vmin, vmax = c.vmax, span = (vmax - vmin) || 1;

    var cNo = ColorMaps.hex2rgb($('colNoData').value);
    var cOcc = ColorMaps.hex2rgb($('colOccluded').value);
    var cOut = ColorMaps.hex2rgb($('colOutside').value);
    var cLow = ColorMaps.hex2rgb($('colBelow').value);
    var useVis = S.res && !TERRAIN[name] && name !== 'vis';
    var vis = S.res ? S.res.combined.vis : null;
    var maskOn = $('chkAOI').checked && S.mask;
    /* how far a cell outside the mask is pulled toward the out-of-scan
       colour — the mask's own opacity scales it, so 0% leaves no trace */
    var dim = 0.68 * clamp(S.aoiAlpha == null ? 1 : S.aoiAlpha, 0, 1), keep = 1 - dim;
    if (dim <= 0) maskOn = false;
    var maskBelow = $('chkMaskBelow').checked && (name === 'sens' || name === 'mmres');
    var thr = parseFloat($('inpThresh').value) || 0;
    if (name === 'mmres') thr = thr * (parseFloat($('inpTrue').value) || 10);
    var VISC = Sens.VIS;
    /* 1 where the layer gave the node a real colour; a draped photo shows
       through everywhere else, so no-data stops meaning "grey field" */
    var lit = new Uint8Array(n);

    for (var id = 0; id < n; id++) {
      var o = id * 3, r, gg, b;
      var z = g.z[id];
      if (z !== z) { r = cNo[0]; gg = cNo[1]; b = cNo[2]; }
      else {
        var v = L.values[id];
        var code = vis ? vis[id] : VISC.OK;
        if (useVis && code === VISC.SHADOW) { r = cOcc[0]; gg = cOcc[1]; b = cOcc[2]; }
        else if (useVis && code === VISC.OUTSIDE) { r = cOut[0]; gg = cOut[1]; b = cOut[2]; }
        else if (useVis && code === VISC.GRAZING) { r = (cOcc[0] + cOut[0]) / 2; gg = (cOcc[1] + cOut[1]) / 2; b = (cOcc[2] + cOut[2]) / 2; }
        else if (v !== v) { r = cNo[0]; gg = cNo[1]; b = cNo[2]; }
        else if (maskBelow && v < thr) { r = cLow[0]; gg = cLow[1]; b = cLow[2]; }
        else {
          var t = (v - vmin) / span;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var q = ColorMaps.sample(LUT, t);
          r = q[0]; gg = q[1]; b = q[2];
          lit[id] = 1;
        }
        if (maskOn && !S.mask[id]) { r = r * keep + cOut[0] * dim; gg = gg * keep + cOut[1] * dim; b = b * keep + cOut[2] * dim; }
      }
      out[o] = r / 255; out[o + 1] = gg / 255; out[o + 2] = b / 255;
    }
    SM.Photo.blend(out, lit, name);
    return out;
  }

  function updateLegend() {
    if (!S.grid) return;
    var L = currentLayer(); if (!L) return;
    /* a colour bar for a scale nothing is being coloured by is worse than no
       colour bar at all */
    if (S.show.flat || !SM.V.opt.surface) { $('legend').classList.add('hidden'); return; }
    var c = cfg();
    $('legend').classList.remove('hidden');
    $('legendTitle').innerHTML = L.label + (L.unit ? ' <span class="dim">[' + L.unit + ']</span>' : '');
    ColorMaps.drawColorbar($('cbCanvas'), ColorMaps.buildLUT(c), c.vmin, c.vmax, {
      width: 76, height: 300, ticks: 6,
      marker: (S.layer === 'sens') ? (parseFloat($('inpThresh').value) || null) : null,
      decimals: (c.vmax - c.vmin) >= 50 ? 0 : 2
    });
    updateMaskLegend();
  }

  /* the dark tones are meaningful, not missing data — spell them out */
  function updateMaskLegend() {
    var box = $('legendMask');
    if (!S.res || TERRAIN[S.layer] || S.layer === 'vis') { box.innerHTML = ''; return; }
    var st = S.res.stats, n = st.nData || 1;
    var rows = [
      ['colOccluded', 'shadowed', st.nShadow / n],
      ['colOutside', 'out of scan', st.nOutside / n]
    ];
    if (st.nGraz) rows.push(['colOccluded', 'grazing', st.nGraz / n]);
    if ($('chkMaskBelow').checked) rows.push(['colBelow', 'below thr.', null]);
    rows.push(['colNoData', 'no data', null]);
    box.innerHTML = rows.map(function (r) {
      return '<div class="r"><i style="background:' + $(r[0]).value + '"></i>' + r[1] +
        (r[2] != null ? '<b>' + (100 * r[2]).toFixed(0) + '%</b>' : '') + '</div>';
    }).join('');
  }

  return {
    init: init, setSurface: setSurface, setFlat: setFlat,
    setTerrainAlpha: setTerrainAlpha, setResultAlpha: setResultAlpha, resultAlpha: resultAlpha,
    cfg: cfg, lut: lut, syncForm: syncForm, refreshStopEditor: refreshStopEditor,
    autoRange: autoRange, currentLayer: currentLayer, colorize: colorize,
    updateLegend: updateLegend
  };
})();
