/* ============================================================
   ui/io.js — everything that leaves or enters the app as a file: the PNG
   view, the CSV and ESRI grid exports, the colour ramp, and the project
   round-trip.
   ============================================================ */
'use strict';

SM.IO = (function () {

  var $ = SM.$, S = SM.S, LC = SM.LC, fmt = SM.fmt, TERRAIN = SM.TERRAIN_LAYERS;

  function init() {
    $('hiddenProj').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { loadProject(fr.result); };
      fr.readAsText(f); this.value = '';
    };
  }

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  /* --------------------------------------------------- map furniture

     An exported PNG leaves the app and is read by people who were not here
     when it was made — in a report, a slide, an email. Everything they need to
     interpret it has to be inside the image: what is being shown, what
     movement was assumed, which way is north, and how big things are.
     -------------------------------------------------------------------- */

  /**
   * Every colour the furniture uses, read once per draw rather than baked in
   * when the module loads. A host build swaps these literals for its own theme
   * tokens, and a token has to be resolved at draw time to follow a theme
   * switch — so they live in one place, as values, not scattered through the
   * drawing code.
   */
  function ink() {
    return {
      plate: SMTheme.col('--sm-hud-bg2'),
      edge: SMTheme.col('--sm-line'),
      head: SMTheme.col('--sm-fg'),
      body: SMTheme.col('--sm-fg'),
      dim: SMTheme.col('--sm-dim')
    };
  }

  function plate(g, x, y, w, h, sc) {
    var k = ink();
    g.fillStyle = k.plate;
    g.fillRect(x, y, w, h);
    g.strokeStyle = k.edge; g.lineWidth = Math.max(1, sc);
    g.strokeRect(x, y, w, h);
  }

  /** a plan view, where one scale holds across the whole image */
  function isPlanView() { return SM.V.cam.pitch >= 80; }

  /**
   * Scale bar, bottom left, drawn the way the on-screen one is: four
   * alternating segments over a round number of metres.
   *
   * `pixelsPerMetre` is measured at the camera target, so the bar is true
   * across a plan view and true only near the centre of a tilted one. It says
   * which, because a scale bar on a shared image is precisely the thing
   * somebody will measure off.
   */
  function drawScaleBar(g, W, H, sc) {
    var pick = SM.niceScale(150 * sc, SM.V.pixelsPerMetre() * sc);
    if (!pick) return;

    var k = ink();
    var caption = isPlanView() ? 'plan view' : 'at view centre — the view is tilted';
    var barW = pick.px, barH = 9 * sc, pad = 14 * sc;
    /* the caption can be wider than the bar itself, so measure before sizing */
    g.font = (9.5 * sc) + 'px Consolas, monospace';
    var plateW = Math.max(barW, g.measureText(caption).width) + pad * 2;
    var plateH = 50 * sc;
    var x = 16 * sc, y = H - 16 * sc - plateH;
    plate(g, x, y, plateW, plateH, sc);

    var bx = x + pad, by = y + 22 * sc;
    for (var i = 0; i < 4; i++) {
      g.fillStyle = (i % 2) ? k.plate : k.body;
      g.fillRect(bx + i * barW / 4, by, barW / 4, barH);
    }
    g.strokeStyle = k.body; g.lineWidth = Math.max(1, sc);
    g.strokeRect(bx, by, barW, barH);

    g.font = (11 * sc) + 'px Consolas, monospace';
    g.textBaseline = 'alphabetic';
    g.fillStyle = k.body;
    g.textAlign = 'left'; g.fillText('0', bx, by - 5 * sc);
    g.textAlign = 'right'; g.fillText(pick.label, bx + barW, by - 5 * sc);

    g.textAlign = 'left';
    g.fillStyle = k.dim;
    g.font = (9.5 * sc) + 'px Consolas, monospace';
    g.fillText(caption, bx, by + barH + 12 * sc);
  }

  /**
   * North arrow, bottom right. The camera's yaw is where it looks, so north on
   * screen turns the other way — the same sign the on-screen rose uses. The
   * letter stays upright while the needle turns, also as on screen, because a
   * rotated "N" is unreadable at half the bearings.
   */
  function drawNorthArrow(g, W, H, sc) {
    var k = ink();
    var R = 22 * sc, box = 76 * sc;
    var x = W - 16 * sc - box, y = H - 16 * sc - box;
    plate(g, x, y, box, box, sc);
    var cx = x + box / 2, cy = y + box / 2 + 6 * sc;

    g.save();
    g.translate(cx, cy);
    g.rotate(-SM.V.cam.yaw * Math.PI / 180);
    g.beginPath();
    g.arc(0, 0, R * 0.94, 0, Math.PI * 2);
    g.strokeStyle = k.edge; g.lineWidth = Math.max(1, sc);
    g.stroke();
    /* the same needle as the on-screen rose: tip, right barb, notch, left barb */
    g.beginPath();
    g.moveTo(0, -R);
    g.lineTo(R * 0.35, R * 0.59);
    g.lineTo(0, R * 0.29);
    g.lineTo(-R * 0.35, R * 0.59);
    g.closePath();
    g.fillStyle = k.body;
    g.fill();
    g.restore();

    g.fillStyle = k.body;
    g.font = 'bold ' + (12 * sc) + 'px Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('N', cx, y + 6 * sc);
  }

  /** what the map is: the layer, the movement assumed, and the sensors */
  function titleLines() {
    var L = SM.Symbology.currentLayer();
    var det = [];
    if (S.res) {
      var o = S.res.opts;
      var on = S.radars.filter(function (q) { return q.on !== false; }).length;
      det.push('movement   ' + Sens.describeMode(o));
      det.push('sensors    ' + on + ' of ' + S.radars.length +
        '   combine ' + (o.combine || 'max') +
        '   threshold ' + fmt(o.threshold, 2));
      var nd = Sens.activeDomains(o);
      if (nd) {
        det.push('domains    ' + nd + ' structural domain' + (nd > 1 ? 's' : '') +
          ' override that inside their outlines');
      }
    } else {
      det.push('terrain view — no sensitivity computed');
    }
    var r = S.radars[S.sel];
    if (r) {
      det.push('selected   ' + r.name + '   ' +
        fmt(r.x, 1) + ', ' + fmt(r.y, 1) + ', ' + fmt(r.z, 1));
    }
    det.push('grid       ' + S.grid.nx + ' × ' + S.grid.ny + ' @ ' + fmt(S.grid.dx, 2) + ' m');
    if (SM.Photo.has()) det.push('backdrop   ' + S.photo.name);
    return { head: 'SensiMap — ' + L.label, det: det };
  }

  /** the title block, sized to whatever it actually has to say */
  function drawTitleBlock(g, sc) {
    var k = ink(), t = titleLines();
    var headFont = (14 * sc) + 'px Segoe UI, sans-serif';
    var detFont = (11 * sc) + 'px Consolas, monospace';
    var pad = 12 * sc, lh = 15 * sc;

    g.font = headFont;
    var w = g.measureText(t.head).width;
    g.font = detFont;
    t.det.forEach(function (d) { w = Math.max(w, g.measureText(d).width); });

    var bw = w + pad * 2, bh = pad * 2 + 22 * sc + t.det.length * lh;
    plate(g, 10 * sc, 10 * sc, bw, bh, sc);

    g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = headFont; g.fillStyle = k.head;
    g.fillText(t.head, 10 * sc + pad, 10 * sc + pad);
    g.font = detFont; g.fillStyle = k.dim;
    t.det.forEach(function (d, i) {
      g.fillText(d, 10 * sc + pad, 10 * sc + pad + 24 * sc + i * lh);
    });
  }

  /* ------------------------------------------------------- raster out */
  function exportPNG() {
    if (!S.grid) return;
    var L = SM.Symbology.currentLayer(), c = SM.Symbology.cfg();
    var out = SM.V.snapshot(function (g, W, H, sc) {
      drawTitleBlock(g, sc);
      /* The colour bar shares the right edge with the north arrow, so it takes
         what is left rather than a fixed 300 px — otherwise its bottom label
         ends up underneath the arrow on a short image. */
      var cbTop = 60 * sc;
      var cbH = Math.min(300 * sc, H - cbTop - 124 * sc);
      if (cbH > 60 * sc) {
        ColorMaps.drawColorbarInto(g, W - 96 * sc, cbTop, 26 * sc, cbH,
          ColorMaps.buildLUT(c), c.vmin, c.vmax, L.label);
      }
      drawScaleBar(g, W, H, sc);
      drawNorthArrow(g, W, H, sc);
    });
    out.toBlob(function (b) { download('sensimap_' + S.layer + '_' + stamp() + '.png', b); });
  }

  function exportCSV() {
    if (!S.grid) return;
    var g = S.grid, res = S.res;
    /* the domain column comes off the LAST COMPUTE, not the current polygon
       list, so every row describes the run that produced the sensitivity beside it */
    var dIdx = res && res.domIdx, dNames = (res && res.domains) || [];
    var rows = ['x,y,z,slope_deg,aspect_deg' +
      (res ? ',range_m,sensitivity,amplitude,visible,measurable_mm' : '') +
      (dIdx ? ',domain,move_trend,move_plunge' : '')];
    var f = parseFloat($('inpTrue').value) || 10;
    var maskOn = $('chkAOI').checked && S.mask;
    for (var j = 0; j < g.ny; j++) {
      for (var i = 0; i < g.nx; i++) {
        var id = j * g.nx + i;
        if (g.z[id] !== g.z[id]) continue;
        if (maskOn && !S.mask[id]) continue;
        var line = (g.x0 + i * g.dx).toFixed(3) + ',' + (g.y0 + j * g.dy).toFixed(3) + ',' + g.z[id].toFixed(3) +
          ',' + (S.der.slope[id] * 180 / Math.PI).toFixed(2) + ',' + S.der.aspect[id].toFixed(1);
        if (res) {
          var C = res.combined;
          line += ',' + (C.range[id] === C.range[id] ? C.range[id].toFixed(2) : '') +
            ',' + (C.sens[id] === C.sens[id] ? C.sens[id].toFixed(4) : '') +
            ',' + (C.amp[id] === C.amp[id] ? C.amp[id].toFixed(4) : '') +
            ',' + (C.vis[id] === Sens.VIS.OK ? 1 : 0) +
            ',' + (C.sens[id] === C.sens[id] ? (C.sens[id] * f).toFixed(3) : '');
        }
        if (dIdx) {
          var D = dIdx[id] >= 0 ? dNames[dIdx[id]] : null;
          line += ',' + (D ? '"' + String(D.name).replace(/"/g, '""') + '"' : '') +
            ',' + (D ? Math.round(D.trend) : '') + ',' + (D ? Math.round(D.plunge) : '');
        }
        rows.push(line);
      }
    }
    download('sensimap_' + stamp() + '.csv', new Blob([rows.join('\n')], { type: 'text/csv' }));
  }

  function exportASC() {
    if (!S.grid) return;
    var L = SM.Symbology.currentLayer(); if (!L) return;
    var g = S.grid, nod = -9999;
    var head = 'ncols ' + g.nx + '\nnrows ' + g.ny + '\nxllcenter ' + g.x0 + '\nyllcenter ' + g.y0 +
      '\ncellsize ' + g.dx + '\nNODATA_value ' + nod + '\n';
    var parts = [head];
    for (var j = g.ny - 1; j >= 0; j--) {
      var row = new Array(g.nx);
      for (var i = 0; i < g.nx; i++) {
        var id = j * g.nx + i, v = L.values[id];
        var ok = (v === v) && (!S.res || TERRAIN[S.layer] || S.res.combined.vis[id] === Sens.VIS.OK);
        row[i] = ok ? (+v).toFixed(4) : nod;
      }
      parts.push(row.join(' ') + '\n');
    }
    download('sensimap_' + S.layer + '_' + stamp() + '.asc', new Blob(parts, { type: 'text/plain' }));
  }

  /**
   * The kinematic results as a table — every plane pair, its line of
   * intersection, the zone it fell in and the direction it would move. This is
   * the sheet that goes into the geotechnical review, so it carries the slope
   * face and friction angle it was assessed against in a header comment rather
   * than leaving the numbers to be interpreted against the wrong wall later.
   */
  function exportKinematics() {
    var r = S.kin;
    if (!r || !r.total) { SM.status('Nothing to export — nothing has been tested yet.'); return; }
    var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
    var head = '# SensiMap kinematic analysis — ' + (r.modeName || r.mode) + '\n' +
      '# slope face ' + Math.round(r.face.dip) + '/' + Math.round(r.face.dipDir) +
      '   friction angle ' + Math.round(r.phi) + ' deg' +
      (r.limit == null ? '   no lateral limits' : '   lateral limits +/-' + Math.round(r.limit) + ' deg') +
      '\n' +
      '# ' + r.nPrimary + ' primary, ' + r.nSecondary + ' secondary of ' + r.total + ' ' +
      (r.plots === 'poles' ? 'planes' : 'intersections') +
      ' (' + r.pctCritical.toFixed(1) + '% critical)\n' +
      (r.plots === 'both'
        ? '# base planes: ' + r.nSliding + ' sliding, ' + r.nRelease + ' release-only\n' : '');
    var out = [head];

    /* the intersection population — wedge axes, or the edges of a toppling
       block. Written first because it is what the mode counts. */
    if (r.pairs.length) {
      var rows = ['plane_a,dip_a,dipdir_a,plane_b,dip_b,dipdir_b,' +
        'intersection_trend,intersection_plunge,face_apparent_dip,zone,' +
        'in_contact,contact_length_m,moves_on,move_trend,move_plunge,note'];
      r.pairs.forEach(function (p) {
        rows.push([
          q(p.a.name), p.a.dip.toFixed(1), p.a.dipDir.toFixed(1),
          q(p.b.name), p.b.dip.toFixed(1), p.b.dipDir.toFixed(1),
          p.trend.toFixed(1), p.plunge.toFixed(1), (p.apparent || 0).toFixed(1),
          p.zone,
          /* whether the two are actually in contact on the model, and over how
             much line — a critical pair that meets nowhere is not a wedge, and a
             review sheet has to carry that distinction */
          p.contact === null ? 'untested' : (p.contact ? 'yes' : 'no'),
          p.seg ? p.seg.length.toFixed(1) : '',
          q(p.slide.on), p.slide.trend.toFixed(1), p.slide.plunge.toFixed(1),
          q(p.why)
        ].join(','));
      });
      out.push((r.plots === 'both' ? '# intersections — the block edges\n' : '') +
        rows.join('\n') + '\n');
    }

    /* the pole population — one row per plane, for the modes that fail on a
       single structure */
    if (r.poles.length) {
      var prows = ['plane,dip,dipdir,pole_trend,pole_plunge,off_face_dip_dir,zone,role,' +
        'located,move_trend,move_plunge,note'];
      r.poles.forEach(function (e) {
        prows.push([
          q(e.name), e.dip.toFixed(1), e.dipDir.toFixed(1),
          e.trend.toFixed(1), e.plunge.toFixed(1), (e.off || 0).toFixed(1),
          e.zone, e.role || '', e.placed ? 'yes' : 'no',
          e.slide ? e.slide.trend.toFixed(1) : '', e.slide ? e.slide.plunge.toFixed(1) : '',
          q(e.why)
        ].join(','));
      });
      out.push((r.plots === 'both' ? '# base planes — what the blocks topple over\n' : '') +
        prows.join('\n') + '\n');
    }

    if (r.nApart || r.nUntested) {
      out.push('# ' + r.nApart + ' pair(s) meet nowhere on the model' +
        (r.filtered ? ' and were left out' : ' and are listed anyway') +
        (r.nUntested ? ', ' + r.nUntested + ' untested for want of a location' : '') + '\n');
    }
    download('sensimap_kinematics_' + stamp() + '.csv',
      new Blob([out.join('\n')], { type: 'text/csv' }));
  }

  /** the stereonet on its own, at report resolution */
  function exportNet() {
    var src = $('netCanvas');
    if (!src || !src.width) { SM.status('Open the Structure tab first.'); return; }
    src.toBlob(function (b) { download('sensimap_stereonet_' + stamp() + '.png', b); });
  }

  /* ------------------------------------------------------- colour ramp */
  function exportScale() {
    var out = { layer: S.layer, config: SM.Symbology.cfg() };
    download('sensimap_scale_' + S.layer + '.json',
      new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  }

  function importScale() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = function () {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(fr.result);
          var c = o.config || o;
          LC[S.layer] = {
            preset: ColorMaps.resolve(c.preset), stops: c.stops, reverse: !!c.reverse,
            bands: c.bands || 0, gamma: c.gamma || 1, vmin: c.vmin, vmax: c.vmax, auto: false
          };
          SM.Symbology.syncForm(); SM.Symbology.colorize(); SM.Symbology.updateLegend();
          SM.Tree.refresh();
          SM.status('Colour ramp imported.');
        } catch (e) { SM.status('Bad ramp file: ' + e.message); }
      };
      fr.readAsText(inp.files[0]);
    };
    inp.click();
  }

  /* ------------------------------------------------------- project */
  function saveProject() {
    var proj = {
      app: 'SensiMap', version: 2,
      radars: S.radars, sel: S.sel,
      sens: {
        mode: SM.Model.mode(), custAz: +$('inpCustAz').value, custPl: +$('inpCustPl').value,
        custRel: SM.Model.custRel(), custOff: +$('inpCustOff').value,
        occlusion: $('chkOcclusion').checked, occAcc: $('selOccAcc').value,
        occTol: +$('inpOccTol').value, grazing: $('chkGrazing').checked, graz: +$('inpGraz').value,
        threshold: +$('inpThresh').value, trueDispl: +$('inpTrue').value,
        combine: $('selCombine').value
      },
      aoi: SM.AOI.aoiObj(), aoiNames: S.polyNames, layer: S.layer, colors: LC, show: S.show,
      /* the two layers that can paint the surface, each remembering its own
         raster — `layer` above is only the resolved winner, and a project
         reloaded with the result unticked must still know which analysis it
         was showing */
      modes: { terrain: S.terrainMode, analysis: S.analysisMode, result: S.result.on },
      /* how the terrain itself is painted, which is a view setting rather than
         a colour ramp and would otherwise be the one thing not restored */
      surface: { show: S.show.surface, flat: S.show.flat, flatColor: $('colFlat').value },
      /* the draped photo by name and strength only — the pixels are megabytes
         and belong to the file, not the project */
      photo: SM.Photo.has()
        ? { name: S.photo.name, on: S.photo.on, mix: S.photo.mix, mixAuto: S.photo.mixAuto }
        : null,
      clipView: { box: $('chkClipBox').checked, handles: $('chkClipHandles').checked },
      /* structural geology: the mapped planes, the slope face and friction
         angle they were assessed against, and the domains that carry a
         kinematic answer into the movement vector */
      structure: {
        planes: S.planes, domains: S.domains,
        face: SM.Structure.face(), phi: SM.Structure.phi(),
        mode: $('stMode').value, limit: +$('stLimit').value,
        equalArea: $('stEqualArea').checked,
        onlyContact: $('stOnlyContact').checked,
        planeSize: $('stPlaneSize').value, planeAlpha: +$('stPlaneAlpha').value,
        planeDraw: $('stPlaneDraw').value, planeClip: $('stPlaneClip').checked,
        blockH: $('stBlockH').value, autoBlock: $('stAutoBlock').checked,
        blockAoi: $('stBlockAoi').checked,
        domAlpha: +$('stDomAlpha').value
      },
      grid: { cell: $('inpCell').value, target: +$('inpTarget').value, search: $('selSearch').value, interp: $('selInterp').value },
      view: { yaw: SM.V.cam.yaw, pitch: SM.V.cam.pitch, dist: SM.V.cam.dist, target: SM.V.cam.target, ortho: SM.V.cam.ortho, opt: SM.V.opt }
    };
    download('sensimap_project_' + stamp() + '.json',
      new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' }));
  }

  function loadProject(txt) {
    var p;
    try { p = JSON.parse(txt); } catch (e) { SM.status('Bad project file.'); return; }
    if (p.radars) { S.radars = p.radars; S.sel = Math.min(p.sel || 0, S.radars.length - 1); }
    if (p.sens) {
      var q = p.sens;
      var rb = document.querySelector('input[name=smode][value=' + q.mode + ']');
      if (rb) rb.checked = true;
      $('customVec').style.display = q.mode === 'custom' ? '' : 'none';
      $('inpCustAz').value = q.custAz; $('inpCustPl').value = q.custPl;
      /* projects saved before the per-cell offset existed carry neither key */
      $('chkCustRel').checked = !!q.custRel;
      if (q.custOff != null) $('inpCustOff').value = q.custOff;
      SM.Model.syncCustomForm();
      $('chkOcclusion').checked = !!q.occlusion; $('selOccAcc').value = q.occAcc;
      $('inpOccTol').value = q.occTol; $('chkGrazing').checked = !!q.grazing; $('inpGraz').value = q.graz;
      $('inpThresh').value = q.threshold; $('inpTrue').value = q.trueDispl;
      $('selCombine').value = q.combine || 'selected';
    }
    if (p.aoi) {
      $('chkAOI').checked = !!p.aoi.on;
      /* .poly is a single region from a project saved before regions joined */
      SM.AOI.setPolys(p.aoi.polys || (p.aoi.poly ? [p.aoi.poly] : []), p.aoiNames);
      $('aoiXmin').value = p.aoi.xmin; $('aoiXmax').value = p.aoi.xmax;
      $('aoiYmin').value = p.aoi.ymin; $('aoiYmax').value = p.aoi.ymax;
      $('aoiZmin').value = p.aoi.zmin; $('aoiZmax').value = p.aoi.zmax;
      $('aoiSlopeMin').value = p.aoi.slopeMin; $('aoiSlopeMax').value = p.aoi.slopeMax;
      /* older projects carry only the box, so the bounds are rewritten from the
         rings rather than trusted — the pre-reject and the rings stay in step */
      SM.AOI.writePolyBounds();
    }
    /* projects saved before the Structure tab existed have no `structure` key;
       everything below simply stays empty for them */
    if (p.structure) {
      var q2 = p.structure;
      S.planes = (q2.planes || []).filter(function (x) { return x && isFinite(x.dip); });
      S.domains = (q2.domains || []).filter(function (x) { return x && x.ring && x.ring.length >= 3; });
      if (q2.face) SM.Structure.setFace(q2.face.dip, q2.face.dipDir);
      if (q2.phi != null) $('stPhi').value = q2.phi;
      if (q2.mode) $('stMode').value = q2.mode;
      /* saved before the other failure modes existed: the lateral limits key is
         absent, and the default is the one those projects were assessed with */
      if (q2.limit != null) $('stLimit').value = q2.limit;
      $('stEqualArea').checked = !!q2.equalArea;
      $('stOnlyContact').checked = !!q2.onlyContact;
      if (q2.planeSize != null) $('stPlaneSize').value = q2.planeSize;
      if (q2.planeAlpha != null) $('stPlaneAlpha').value = q2.planeAlpha;
      if (q2.domAlpha != null) $('stDomAlpha').value = q2.domAlpha;
      if (q2.planeDraw) $('stPlaneDraw').value = q2.planeDraw;
      $('stPlaneClip').checked = !!q2.planeClip;
      if (q2.blockH != null) $('stBlockH').value = q2.blockH;
      if (q2.autoBlock != null) $('stAutoBlock').checked = !!q2.autoBlock;
      $('stBlockAoi').checked = !!q2.blockAoi;
    }
    if (p.colors) Object.keys(p.colors).forEach(function (k) { if (LC[k]) LC[k] = p.colors[k]; });
    if (p.grid) {
      $('inpCell').value = p.grid.cell || ''; $('inpTarget').value = p.grid.target || 320;
      $('selSearch').value = p.grid.search || 2; $('selInterp').value = p.grid.interp || 'idw';
    }
    /* Newer projects carry both modes; older ones carry only the raster that
       was on screen, which says which layer owned it and therefore what the
       other one should fall back to. */
    if (p.modes) {
      if (p.modes.terrain) S.terrainMode = p.modes.terrain;
      if (p.modes.analysis) S.analysisMode = p.modes.analysis;
      S.result.on = p.modes.result !== false;
    } else if (p.layer) {
      if (SM.TERRAIN_LAYERS[p.layer]) { S.terrainMode = p.layer; S.result.on = false; }
      else { S.analysisMode = p.layer; S.result.on = true; }
    }
    if (p.layer) S.layer = p.layer;
    /* v1 projects carry the wireframe flag inside view.opt only */
    if (p.show) Object.keys(p.show).forEach(function (k) {
      if (S.show[k] != null) S.show[k] = !!p.show[k];
    });
    if (p.view) {
      SM.V.cam.yaw = p.view.yaw; SM.V.cam.pitch = p.view.pitch; SM.V.cam.dist = p.view.dist;
      SM.V.cam.target = p.view.target; SM.V.cam.ortho = !!p.view.ortho;
      if (p.view.opt) {
        Object.keys(p.view.opt).forEach(function (k) { SM.V.opt[k] = p.view.opt[k]; });
        $('inpOpacity').value = SM.V.opt.alpha; $('inpZScale').value = SM.V.opt.zScale;
        $('inpSunAz').value = SM.V.opt.sunAz; $('inpSunEl').value = SM.V.opt.sunEl;
        $('inpShade').value = SM.V.opt.shade;
        if (!p.show) S.show.wire = !!SM.V.opt.wire;
        $('selProjection').value = SM.V.cam.ortho ? 'ortho' : 'persp';
      }
    }
    if (p.clipView) {
      $('chkClipBox').checked = p.clipView.box !== false;
      $('chkClipHandles').checked = p.clipView.handles !== false;
      SM.V.setClipBoxVisible($('chkClipBox').checked);
    }
    if (p.surface) {
      if (p.surface.flatColor) $('colFlat').value = p.surface.flatColor;
      SM.Symbology.setSurface(p.surface.show !== false);
      SM.Symbology.setFlat(!!p.surface.flat);
    }
    if (p.photo) {
      S.photo.on = p.photo.on !== false;
      if (p.photo.mix != null) S.photo.mix = p.photo.mix;
      S.photo.mixAuto = p.photo.mixAuto !== false;
      SM.Photo.syncForm();
      /* the project remembers the settings, not the photograph */
      if (!SM.Photo.has() && p.photo.name) {
        SM.status('This project was saved with ' + p.photo.name +
          ' draped on it — drop that file again to bring the photo back.');
      }
    }
    SM.Sensors.loadForm(); SM.Symbology.syncForm();
    SM.Tree.applyShow();
    if (S.grid) {
      S.radars.forEach(SM.Sensors.snap);
      SM.AOI.recomputeMask();
      SM.Structure.recomputeIndex();
      /* resolve the two restored modes into the one raster that is painted —
         a project saved on an analysis has no result until it is recomputed */
      SM.Tree.applyActive();
      SM.Overlays.update();
    }
    SM.Structure.changed();
    SM.Tree.refresh(); SM.Cmd.refresh();
    SM.status('Project loaded — select a radar position, then press “Compute sensitivity map”.');
    SM.badge('project loaded', 'busy');
  }

  return {
    init: init, download: download, stamp: stamp,
    exportPNG: exportPNG, exportCSV: exportCSV, exportASC: exportASC,
    exportKinematics: exportKinematics, exportNet: exportNet,
    exportScale: exportScale, importScale: importScale,
    saveProject: saveProject, loadProject: loadProject
  };
})();
