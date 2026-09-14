/* ============================================================
   ui/photo.js — the draped orthophoto.

   A georeferenced photograph is not a layer in the analytical sense: it has no
   values, nothing is computed from it, and it never becomes the model. It is a
   backdrop, so it lives beneath the active layer's colours rather than beside
   them — the surface is painted with the photo, and the layer is mixed over the
   top at a strength the user sets, exactly the way a GIS stacks a raster over
   an ortho.

   Where the active layer has nothing to say about a cell — no data, or the
   whole surface in flat-colour mode — the photo shows through at full strength.
   That is what makes a sensitivity patch read as sitting *on* the pit rather
   than floating in a field of grey.
   ============================================================ */
'use strict';

SM.Photo = (function () {

  var $ = SM.$, S = SM.S, status = SM.status;

  function init() {
    var c = $('chkOrtho');
    if (c) {
      c.onchange = function () {
        S.photo.on = c.checked;
        repaint();
      };
    }
    var m = $('inpOrthoMix');
    if (m) {
      m.oninput = function () {
        S.photo.mix = (parseFloat(m.value) || 0) / 100;
        S.photo.mixAuto = false;          // the user has an opinion now
        showMix();
        repaint();
        SM.Tree.refresh();
      };
    }
    var r = $('btnOrthoClear');
    if (r) r.onclick = function () { clear(); };
    showMix();
    syncForm();
  }

  function showMix() {
    var out = $('outOrthoMix');
    if (out) {
      out.textContent = Math.round(mix() * 100) + '%' + (S.photo.mixAuto ? ' auto' : '');
    }
  }

  function has() { return !!(S.photo && S.photo.image); }

  /**
   * How strongly the active layer covers the photo, 0-1.
   *
   * Left on auto, that depends on what is being shown. An analysis layer
   * carries something the photograph cannot — sensitivity, visibility — so it
   * covers almost completely, and the photo fills in where the layer has no
   * value, which is the way a GIS composite reads. A terrain layer says what
   * the photo and the hill shading already say, so it gets out of the way and
   * the photograph is what you see. The slider overrides both.
   */
  function mix() {
    if (!S.photo.mixAuto) return S.photo.mix;
    var analysis = !!S.res && !SM.TERRAIN_LAYERS[S.layer];
    return analysis ? 0.85 : 0;
  }

  /** the photo is sampled onto grid nodes, so a new model needs a new drape */
  function rebuild() {
    if (!has() || !S.grid) { if (S.photo) S.photo.drape = null; return; }
    if (!Ortho.overlaps(S.photo.image, S.grid)) {
      S.photo.drape = null;
      S.photo.away = true;
      return;
    }
    S.photo.away = false;
    S.photo.drape = Ortho.sample(S.photo.image, S.grid);
  }

  /**
   * Take a photo dataset from the GeoTIFF reader.
   * @param {{name,image,note}} ds
   */
  function load(ds) {
    S.photo.mixAuto = true;
    S.photo.name = ds.name;
    S.photo.image = ds.image;
    S.photo.note = ds.note;
    S.photo.on = true;
    S.photo.drape = null;
    S.photo.away = false;
    var c = $('chkOrtho');
    if (c) c.checked = true;
    syncForm();

    if (!S.grid) {
      status(ds.name + ' loaded — add terrain data and it will be draped over it.');
      SM.Tree.refresh();
      renderList();
      return;
    }
    rebuild();
    report();
    SM.Symbology.colorize();
    renderList();
    SM.Tree.refresh();
  }

  /** say how the photo landed against the model, because "nothing happened" is
      almost always a coordinate-system mismatch rather than a broken file */
  function report() {
    if (!has() || !S.grid) return;
    if (S.photo.away) {
      var b = Ortho.bounds(S.photo.image);
      /* prepended: the grid description below it is still worth reading */
      $('gridInfo').innerHTML = '<span class="w"><b>' + S.photo.name + ' does not overlap the ' +
        'model.</b> The photo covers ' + SM.fmtCoord(b.xmin) + '–' + SM.fmtCoord(b.xmax) + ' E, ' +
        SM.fmtCoord(b.ymin) + '–' + SM.fmtCoord(b.ymax) + ' N, while the terrain is at ' +
        SM.fmtCoord(S.grid.x0) + ' E, ' + SM.fmtCoord(S.grid.y0) + ' N. They are almost ' +
        'certainly in different coordinate systems or UTM zones — reproject the photo to ' +
        'match the survey.</span>' + '\n' + $('gridInfo').innerHTML;
      status(S.photo.name + ' does not overlap the terrain — check its coordinate system.');
      return;
    }
    var d = S.photo.drape;
    if (!d) return;
    var pct = 100 * d.covered / (S.grid.nx * S.grid.ny);
    status(S.photo.name + ' draped over ' + pct.toFixed(0) + '% of the model.');
  }

  /** re-drape onto a new model and say how it landed */
  function rebuildAndReport() {
    if (!has()) return;
    rebuild();
    report();
    renderList();
  }

  function renderList() {
    if (SM.Data && SM.Data.renderFileList) SM.Data.renderFileList();
  }

  function clear() {
    S.photo.image = null;
    S.photo.drape = null;
    S.photo.name = '';
    S.photo.note = '';
    S.photo.away = false;
    syncForm();
    repaint();
    renderList();
    /* the row it was selected by has just gone — do not leave Properties
       describing a photo that is no longer loaded */
    if (S.node.kind === 'photo') SM.Tree.select(S.grid ? 'terrain' : 'none', S.grid ? 'terrain' : null);
    else SM.Tree.refresh();
  }

  function repaint() {
    if (S.grid) SM.Symbology.colorize();
    SM.Cmd.refresh();
  }

  function setOn(on) {
    S.photo.on = !!on;
    var c = $('chkOrtho');
    if (c) c.checked = S.photo.on;
    repaint();
    SM.Tree.refresh();
  }

  function syncForm() {
    /* the sheet is only ever shown by selecting the photo's own row, and that
       row exists only while a photo is loaded — nothing to hide here */
    var nm = $('orthoName');
    if (nm) nm.textContent = has() ? S.photo.name : '';
    var nt = $('orthoNote');
    if (nt) nt.textContent = has() ? (S.photo.note || '') : '';
    var c = $('chkOrtho');
    if (c) c.checked = !!S.photo.on;
    var m = $('inpOrthoMix');
    if (m) m.value = Math.round(mix() * 100);
    showMix();
  }

  /**
   * Mix the photo underneath the colours the symbology just computed.
   *
   * @param {Float32Array} out  n*3 of 0-1 RGB, modified in place
   * @param {Uint8Array} [lit]  1 where the active layer gave the node a real
   *        colour. Nodes it says nothing about — and every node when this is
   *        omitted, which is flat-colour mode — show the photo alone.
   */
  function blend(out, lit) {
    if (!S.photo.on || !has() || !S.photo.drape) return;
    var d = S.photo.drape, cover = d.cover, prgb = d.rgb;
    var m0 = mix(), n = cover.length;
    for (var id = 0; id < n; id++) {
      if (!cover[id]) continue;
      var o = id * 3, m = (lit && lit[id]) ? m0 : 0;
      if (m >= 1) continue;
      var k = 1 - m;
      out[o] = prgb[o] * k + out[o] * m;
      out[o + 1] = prgb[o + 1] * k + out[o + 1] * m;
      out[o + 2] = prgb[o + 2] * k + out[o + 2] * m;
    }
  }

  return {
    init: init, load: load, clear: clear, rebuild: rebuild, report: report,
    rebuildAndReport: rebuildAndReport, mix: mix,
    blend: blend, has: has, setOn: setOn, syncForm: syncForm
  };
})();
