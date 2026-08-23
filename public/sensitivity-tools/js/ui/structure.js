/* ============================================================
   ui/structure.js — the Structure tab: mapped discontinuities, the kinematic
   failure test, and the structural domains that carry its answer into the
   sensitivity map.

   The workflow the panel is built around, in the order the buttons appear:

     1. describe the wall            slope dip / dip direction / friction
     2. get the structure in         type dip & dip direction, or pick points
                                     off the surface and let it fit the plane
     3. choose a failure mode        all five Dips modes: wedge sliding,
                                     planar sliding with and without lateral
                                     limits, flexural and direct toppling
     4. read the stereonet           critical zone, poles, wedge axes
     5. push a result into the map   draw the block the wedge would release,
                                     and that polygon's cells switch from the
                                     global movement assumption to the wedge's
                                     own line of intersection

   Step 5 is the point of the whole tab. Everywhere else in the tool the
   movement vector is one global assumption; a structural domain is a drawn
   area that overrides it, so a mapped wedge and the wall around it can be
   assessed for line-of-sight sensitivity in the same run, each against the
   direction it would actually move.
   ============================================================ */
'use strict';

SM.Structure = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, esc = SM.esc, num = SM.num, numOr = SM.numOr;

  /* Enough distinct hues that a mapped joint set stays legible on the
     stereonet without anyone having to choose colours by hand. Mid-tone rather
     than pastel throughout: these are drawn on the terrain and on a plot whose
     background follows the host theme, so they have to read on both. */
  var PALETTE = ['#2f9bff', '#12c2a0', '#f57c00', '#c026d3', '#e53935',
    '#558b2f', '#0097a7', '#d81b60', '#6d4cff', '#8d6e63'];
  var seq = 0;

  /* what the stereonet draws, persisted only for the session */
  var show = { net: false, zones: true, cone: true, faceGC: true, planes: true, poles: true, ints: true };

  /* ------------------------------------------------------- helpers */
  function nextColour() { return PALETTE[(S.planes.length + seq++) % PALETTE.length]; }

  function face() {
    return { dip: SM.clamp(num('stFaceDip', 60), 0, 90), dipDir: Struct.wrap360(num('stFaceDir', 90)) };
  }
  function phi() { return SM.clamp(num('stPhi', 30), 0, 89); }
  /** the failure mode's own record, never just its id — the id alone says nothing */
  function mode() { return Struct.modeOf($('stMode').value); }
  function limit() { return SM.clamp(num('stLimit', Struct.LIMIT), 0, 90); }

  /** square metres up to a hectare, then hectares */
  function areaTxt(v) {
    if (v == null || v !== v) return '—';
    return v < 10000 ? fmt(v, 0) + ' m²' : fmt(v / 10000, 2) + ' ha';
  }
  /** cubic metres, and millions of them once a block is that big */
  function volTxt(v) {
    if (v == null || v !== v) return '—';
    return v >= 1e6 ? fmt(v / 1e6, 2) + ' Mm³' : SM.fmtInt(v) + ' m³';
  }

  /** trend/plunge written the way a geotech says it out loud */
  function tp(trend, plunge) {
    return pad3(trend) + ' → ' + Math.round(plunge) + '°';
  }
  function pad3(a) {
    var v = Math.round(Struct.wrap360(a)) % 360;
    return (v < 10 ? '00' : v < 100 ? '0' : '') + v;
  }
  /** dip / dip direction, the way it is written on a mapping sheet */
  function dd(dip, dipDir) { return Math.round(dip) + '/' + pad3(dipDir); }

  /* ---------------------------------------------- how they are drawn
     The 3D symbols are cosmetic — nothing in the analysis reads them — so they
     live in the panel rather than in state, and the overlay asks for them at
     draw time. `ext` is the model extent, used only for the automatic size. */

  /**
   * Strike length of a drawn plane rectangle, in metres.
   *
   * A plane that has been stretched by its corner carries its own size and
   * keeps it; everything else follows the panel field, and the panel field
   * falls back to a tenth of the model extent. So the default moves them all
   * and an individual stretch is never undone by it.
   */
  function planeSize(ext, plane) {
    if (plane && isFinite(plane.size) && plane.size > 0) return plane.size;
    var v = num('stPlaneSize', NaN);
    return isFinite(v) && v > 0 ? v : (ext || 1000) * 0.1;
  }

  /* Trace-only leaves no rectangle, so the controls that shape one have
     nothing to act on and say so rather than sitting there live. */
  function syncPlaneDraw() {
    var trace = planeDraw() === 'trace';
    ['stPlaneSize', 'stPlaneAlpha', 'stPlaneClip'].forEach(function (id) {
      $(id).disabled = trace;
    });
    $('stPlaneClip').parentNode.title = trace
      ? 'Nothing to clip — only the trace is being drawn.'
      : 'Cut the rectangle back to the part inside the rock — fill and outline both — so ' +
        'nothing hangs in the air in front of the face. What is left is behind the surface, ' +
        'so turn the surface down or off in the View tab to see it, or draw the trace instead.';
  }

  /** hand a plane back to the panel default after it has been stretched */
  function resetPlaneSize(i) {
    if (!S.planes[i]) return;
    delete S.planes[i].size;
    SM.Overlays.update();
    renderPlanes();
  }

  /**
   * Give a typed orientation somewhere to sit.
   *
   * A dip and a dip direction describe how a structure lies, not where it is,
   * so nothing is drawn for one until it is placed — and until it is drawn
   * there is nothing on the surface to grab and stretch. This arms a one-shot
   * pick that sets the anchor from the next click on the model.
   */
  function placePlane(i) {
    if (!S.grid) { SM.status('Load a model first.'); return; }
    if (!S.planes[i]) return;
    S.anchorPlane = i;
    SM.Tools.set('anchor');
  }

  /** the click that lands a plane, from the anchor tool */
  function anchorAt(hit) {
    var i = S.anchorPlane;
    S.anchorPlane = null;
    var p = S.planes[i];
    if (!p) return;
    p.anchor = [hit.x, hit.y, hit.z];
    SM.Overlays.update();
    renderPlanes();
    SM.Tree.refresh(); SM.Cmd.refresh();
    SM.status(p.name + ' placed at ' + Math.round(hit.x) + ', ' + Math.round(hit.y) +
      ', RL ' + Math.round(hit.z) + ' — the stretch tool can move and resize it now.');
  }
  function planeAlpha() { return SM.clamp(num('stPlaneAlpha', 26), 0, 100) / 100; }

  /** patch | trace | both — how much of a mapped plane is drawn */
  function planeDraw() { return $('stPlaneDraw') ? $('stPlaneDraw').value : 'both'; }
  /** keep only the part of the patch that is inside the rock */
  function planeClip() { return !!($('stPlaneClip') && $('stPlaneClip').checked); }
  function domainAlpha() { return SM.clamp(num('stDomAlpha', 32), 0, 100) / 100; }

  /* ============================================================
     Discontinuity planes
     ============================================================ */
  function addPlane(dip, dipDir, name, extra) {
    var p = {
      name: name || ('Plane ' + (S.planes.length + 1)),
      dip: SM.clamp(+dip || 0, 0, 90),
      dipDir: Struct.wrap360(+dipDir || 0),
      color: nextColour(), on: true, anchor: null
    };
    if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
    S.planes.push(p);
    changed();
    return p;
  }

  /**
   * A copy of a mapped plane.
   *
   * One joint set outcrops in several places along a wall and each occurrence
   * wants its own patch on the model; the orientation is the same every time.
   * A placed copy lands offset from the original so it can be seen and grabbed
   * rather than hidden exactly underneath it.
   */
  function duplicatePlane(i) {
    var src = S.planes[i];
    if (!src) return;
    var step = S.grid ? SM.extentOf(S.grid).ext * 0.05 : 10;
    var copy = {
      name: src.name.replace(/ \(copy( \d+)?\)$/, '') + ' (copy)',
      dip: src.dip, dipDir: src.dipDir, color: src.color, on: src.on !== false,
      anchor: src.anchor ? [src.anchor[0] + step, src.anchor[1] + step, src.anchor[2]] : null
    };
    if (isFinite(src.size)) copy.size = src.size;
    S.planes.push(copy);
    changed();
    SM.status('“' + copy.name + '” copied — ' + dd(copy.dip, copy.dipDir) +
      (copy.anchor
        ? ', offset so you can see it. Arm “Stretch / move” and drag its centre handle into place.'
        : '. It has no location yet — press ⌖ on its row to place it on the model.'));
  }

  /**
   * Every plane in or every plane out.
   *
   * A mapped set is worked with a set at a time — try the whole bedding set,
   * then only the two joints, then all of it again — and clicking twenty tick
   * boxes to ask one question is not analysis, it is data entry.
   */
  function setAllPlanes(on) {
    if (!S.planes.length) return;
    S.planes.forEach(function (p) { p.on = !!on; });
    changed();
    SM.status(on
      ? 'All ' + S.planes.length + ' planes back in the analysis.'
      : 'All planes left out — nothing to intersect, so there are no wedges.');
  }

  /** how many of a list are switched on, for a tick box that has three states */
  function countOn(list) {
    var n = 0;
    list.forEach(function (o) { if (o.on !== false) n++; });
    return n;
  }

  function removePlane(i) {
    if (i < 0 || i >= S.planes.length) return;
    var gone = S.planes.splice(i, 1)[0];
    changed();
    SM.status('Removed ' + gone.name + '.');
  }

  function renamePlane(i, name) {
    var p = S.planes[i];
    if (!p) return;
    p.name = String(name || '').trim() || ('Plane ' + (i + 1));
    renderPlanes(); renderResults();
    SM.Overlays.update(); SM.Tree.refresh();
  }

  function clearPlanes() {
    if (!S.planes.length) return;
    S.planes = [];
    changed();
    SM.status('All mapped planes discarded.');
  }

  /**
   * Bulk entry, because structural data arrives as a column of numbers and
   * nobody should retype it. One record per line, `dip dipdir [name]`, with
   * any of comma / tab / semicolon / spaces between the fields. A line whose
   * first two fields are not numbers is treated as a header and skipped, so
   * pasting straight out of a spreadsheet works.
   */
  function parsePasted(text) {
    var out = [], bad = 0;
    (text || '').split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (!t || t.charAt(0) === '#') return;
      var f = t.split(/[,;\t]+|\s{1,}/).filter(function (s) { return s !== ''; });
      if (f.length < 2) { bad++; return; }
      var a = parseFloat(f[0]), b = parseFloat(f[1]);
      if (!isFinite(a) || !isFinite(b)) { bad++; return; }      // header row
      if (a < 0 || a > 90) { bad++; return; }                   // not a dip
      out.push({ dip: a, dipDir: b, name: f.length > 2 ? f.slice(2).join(' ') : null });
    });
    return { rows: out, skipped: bad };
  }

  function importPasted() {
    var r = parsePasted($('stPaste').value);
    if (!r.rows.length) {
      SM.status('Nothing readable in that paste — expected “dip dipdir [name]”, one per line.');
      return;
    }
    r.rows.forEach(function (row, i) {
      addPlaneQuiet(row.dip, row.dipDir, row.name || ('J' + (S.planes.length + 1)));
    });
    $('stPaste').value = '';
    $('stPasteWrap').classList.add('hidden');
    changed();
    SM.status('Added ' + r.rows.length + ' plane' + (r.rows.length === 1 ? '' : 's') +
      (r.skipped ? ' — ' + r.skipped + ' line(s) skipped as headers or junk.' : '.'));
  }

  /** the same as addPlane without the redraw, for bulk paths */
  function addPlaneQuiet(dip, dipDir, name) {
    S.planes.push({
      name: name, dip: SM.clamp(+dip || 0, 0, 90), dipDir: Struct.wrap360(+dipDir || 0),
      color: nextColour(), on: true, anchor: null
    });
  }

  /* ------------------------------------------- planes off the surface
     Arming the pick tool is the `tool.plane` command, so the button in the
     panel, the Tools menu and the tool bar all go through the one registration
     rather than this module wiring a second path to the same thing. */

  /**
   * Turn the picked points into a mapped plane. Three points define one
   * exactly; more are least-squared, and the scatter about the fit is reported
   * because that is what says whether the trace really was planar.
   */
  function commitPlanePick(pts) {
    var fit = Struct.fitPlane(pts);
    if (!fit) { SM.status('Those points do not define a plane — try again, further apart.'); return; }
    var p = addPlane(fit.dip, fit.dipDir, 'Picked ' + (S.planes.length + 1), {
      anchor: fit.centre, rms: fit.rms, nPicks: pts.length
    });
    SM.status('Fitted ' + dd(p.dip, p.dipDir) + ' through ' + pts.length +
      ' points — scatter ' + fmt(fit.rms, 2) + ' m about the plane.');
  }

  /* ============================================================
     The slope face — typed, or read off the ground the tool already has
     ============================================================ */
  function faceFromProbe() {
    if (!S.probe || !S.der) { SM.status('Identify a cell on the wall first.'); return; }
    var id = Grid.nodeIndex(S.grid, S.probe.x, S.probe.y);
    if (id < 0) { SM.status('That point is off the raster.'); return; }
    setFace(S.der.slope[id] * 180 / Math.PI, S.der.aspect[id]);
    SM.status('Slope face taken from the probed cell: ' + dd(face().dip, face().dipDir) + '.');
  }

  /**
   * Mean orientation of every cell in the selection mask. Vector mean of the
   * surface normals, not an average of angles — and it reports the resultant,
   * because a mask spanning two walls has no single face orientation and the
   * number it returns would be meaningless without that warning.
   */
  function faceFromMask() {
    if (!S.der || !S.mask) { SM.status('Build a model first.'); return; }
    var der = S.der, mask = S.mask;
    var m = Struct.meanNormal(mask.length, function (i) {
      if (!mask[i]) return null;
      if (der.nz[i] !== der.nz[i]) return null;
      return [der.nx[i], der.ny[i], der.nz[i]];
    });
    if (!m) { SM.status('No cells in the selection mask.'); return; }
    setFace(m.dip, m.dipDir);
    SM.status('Slope face averaged over ' + SM.fmtInt(m.n) + ' masked cells: ' +
      dd(m.dip, m.dipDir) +
      (m.R < 0.85 ? ' — but the mask spans several orientations (resultant ' +
        fmt(m.R, 2) + '), so restrict it to one wall.' : '.'));
  }

  function setFace(dip, dipDir) {
    $('stFaceDip').value = Math.round(dip * 10) / 10;
    $('stFaceDir').value = Math.round(dipDir);
    changed();
  }

  /* ============================================================
     The analysis
     ============================================================ */
  /**
   * A mapped plane as the patch it is actually drawn as, or null when it has no
   * location. This is what lets the analysis ask whether two structures meet
   * anywhere in the pit, rather than only whether their orientations cross.
   */
  function patchOf(p) {
    if (!p || !p.anchor || !S.grid) return null;
    var size = planeSize(SM.extentOf(S.grid).ext, p);
    return {
      anchor: p.anchor, dip: p.dip, dipDir: p.dipDir,
      w: size / 2, h: size * Struct.DIP_ASPECT / 2
    };
  }

  function run() {
    S.kin = Struct.analyse(S.planes, face(), phi(), $('stMode').value, {
      limit: limit(),
      patch: patchOf,
      /* the terrain, so the analysis can tell a wedge of rock from a wedge of
         sky — two patches can be in contact out in front of the face */
      surface: S.grid ? function (x, y) { return Grid.sampleZ(S.grid, x, y); } : null,
      onlyContact: !!($('stOnlyContact') && $('stOnlyContact').checked)
    });
    return S.kin;
  }

  /**
   * Make the panel say what the chosen mode actually does.
   *
   * Three things move with the mode: the lateral limits are meaningless for
   * wedge sliding and for planar sliding with the limits off, the results
   * table counts a different population, and the stereonet has to be plotting
   * that population or the shaded zones sit over nothing. The switches stay
   * the operator's to set — they are only pre-set on a genuine change of mode,
   * which is the moment the old choice stopped being about the same thing.
   */
  function syncMode(switched) {
    var M = mode();
    var cell = $('stLimitCell');
    $('stLimit').disabled = !M.limits;
    cell.classList.toggle('naCell', !M.limits);
    cell.title = M.limits
      ? 'Lateral limits, in degrees either side of the slope dip direction. Structure ' +
        'striking further off square than this cannot break out of the wall, so it is ' +
        'reported as a near miss — amber — rather than as critical. Dips suggests 20° to 30°.'
      : (M.id === 'wedge'
        ? 'Wedge sliding applies no lateral limits: the second plane releases the block ' +
          'sideways by itself, which is exactly what distinguishes it from a planar slide.'
        : 'This mode is the no-limits one — the whole daylight envelope counts.');
    $('stModeHint').textContent = M.hint;
    $('stResultsSub').textContent = M.plots === 'poles' ? 'every plane on its own'
      : M.plots === 'both' ? 'block edges, and the base planes under them'
        : 'every plane pair';
    if (switched) {
      show.ints = M.plots !== 'poles';
      show.poles = M.plots !== 'intersections';
      syncNetButtons();
    }
  }

  /** the stereonet's overlay switches, redrawn from `show` */
  function syncNetButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('#stNetOpts [data-net]'), function (b) {
      b.classList.toggle('on', !!show[b.getAttribute('data-net')]);
    });
  }

  /** everything downstream of a structural change, in one place */
  function changed() {
    run();
    refresh();
    SM.Overlays.update();
    SM.Tree.refresh();
    SM.Cmd.refresh();
  }

  /* ============================================================
     Structural domains — where a kinematic result becomes a movement vector
     ============================================================ */

  /**
   * The ground a wedge would actually release, worked out rather than traced.
   *
   * Three things bound it, which is exactly what a wedge IS:
   *
   *   the JOINT PLANES      one or two of them, passing through the point the
   *     structure daylights. Two is a wedge, one is a planar slab, and the
   *     paragraph below describes the wedge; a slab is the same with one flank.
   *     The block is the rock standing above both of them — the quadrant of
   *     space around their line of intersection that contains "straight up",
   *     which with upward normals is simply the side where both signed
   *     distances are positive. That is what puts the two joint traces on the
   *     ground as the block's flanks.
   *   the SLOPE FACE        is the survey itself. Only cells whose terrain
   *     stands above both planes qualify, so the shape follows every bench and
   *     berm the wall actually has instead of an idealised plane.
   *   the LIMIT             caps it. On a uniform face the terrain rises faster
   *     than the line of intersection does — that is the daylighting condition
   *     — so the region never closes upslope on its own and would run to the
   *     crest and beyond. `height` is the vertical extent above the daylight
   *     point, which is how a wedge gets quoted anyway ("a 40 m block").
   *
   * Only the run connected to the daylight point is taken: the same test is
   * satisfied on other walls, and those are different wedges.
   *
   * Returns null when nothing worth calling a block comes out.
   */
  function wedgeBlock(planeA, planeB, anchor, height, aoi) {
    var g = S.grid;
    if (!g || !planeA || !anchor) return null;
    /* One plane or two. A wedge is the rock above BOTH of its joints; a planar
       slide is the rock above its single one, and everything else about the
       construction — the terrain, the height cap, the connected run, the zero
       contour — is the same. So the second plane is optional rather than a
       second function, and a slab's boundary comes out of the same code that
       puts a wedge's flanks on its two traces. */
    var nA = Struct.planeNormal(Struct.clampDip(planeA.dip), planeA.dipDir);
    var nB = planeB ? Struct.planeNormal(Struct.clampDip(planeB.dip), planeB.dipDir) : null;
    var zTop = anchor[2] + height;
    var cell = Math.max(g.dx, g.dy);
    /* Only when asked for. The selection mask is a statistics filter that is
       often left at the full extent, and silently taking it as a block boundary
       would cut wedges off square for reasons nobody chose. */
    var limit = (aoi && S.mask && $('chkAOI').checked) ? S.mask : null;

    /**
     * How far inside the block a point is, in metres, as the closest of the
     * three things that bound it: above plane A, above plane B, under the
     * height cap. Positive inside, negative out — so the ZERO of this field is
     * the block's boundary, and where each constraint is the binding one that
     * zero IS that constraint's own line. Along the flanks it is exactly the
     * trace the plane draws on the ground, which is the whole point: the block
     * edge and the trace are the same line computed the same way, so they
     * cannot disagree by a pixel.
     */
    var slack = cell * 0.5;
    function depth(id, x, y) {
      var z = g.z[id];
      if (z !== z) return NaN;
      var dx = x - anchor[0], dy = y - anchor[1], dz = z - anchor[2];
      /* Half a cell of slack on the FLANKS, so the daylight point — where both
         plane distances are zero — is not rounded out from under the click.
         None on the height cap: that one is a number the operator typed, and a
         block that overshoots it by a metre and a half is not what was asked
         for. */
      var d = Math.min(nA[0] * dx + nA[1] * dy + nA[2] * dz + slack, zTop - z);
      if (nB) d = Math.min(d, nB[0] * dx + nB[1] * dy + nB[2] * dz + slack);
      return d;
    }

    /* Connectivity first: the same three conditions hold on other walls, and
       those are different wedges. Half a cell of slack keeps the daylight
       point itself — where all three are zero — from being rounded out. */
    var seed = Grid.nodeIndex(g, anchor[0], anchor[1]);
    if (seed < 0) return null;
    var mask = Grid.floodFill(g, seed, function (id) {
      if (limit && !limit[id]) return false;
      var i = id % g.nx;
      var d = depth(id, g.x0 + i * g.dx, g.y0 + ((id - i) / g.nx) * g.dy);
      return d === d && d > 0;
    });
    var cells = 0, q;
    for (q = 0; q < mask.length; q++) cells += mask[q];
    if (cells < 4) return null;

    /* Now the boundary, as the zero contour of that same field. Cells that
       pass the test but belong to some other lobe are pushed negative so the
       contour closes around this block alone; the AOI, when it is limiting,
       is applied the same way — which is what makes a drawn region act as the
       block's outer boundary rather than merely trimming the cell count. */
    var n = g.nx * g.ny, f = new Float64Array(n);
    for (q = 0; q < n; q++) {
      var i2 = q % g.nx;
      var d2 = depth(q, g.x0 + i2 * g.dx, g.y0 + ((q - i2) / g.nx) * g.dy);
      if (d2 !== d2) { f[q] = NaN; continue; }
      if (!mask[q] && d2 > 0) d2 = -d2;
      if (limit && !limit[q] && d2 > 0) d2 = -d2;
      f[q] = d2;
    }
    var lines = Grid.stitchSegments(Grid.contourSegments(f, g.nx, g.ny, g.x0, g.y0, g.dx, g.dy, 0));

    /* the ring the daylight point is standing in; failing that the biggest,
       which is what a block running off the edge of the survey leaves behind */
    var best = null, bestA = -1;
    lines.forEach(function (L) {
      if (L.pts.length < 3) return;
      var a = Math.abs(Grid.ringArea(L.pts));
      var holds = L.closed && Sens.pointInPoly(L.pts, anchor[0], anchor[1]);
      var score = holds ? a + 1e12 : a;
      if (score > bestA) { bestA = score; best = L; }
    });
    if (!best) return null;

    /* A light simplify only: enough to spare the operator a handle per cell,
       not enough to lift the boundary off the traces it was built from. */
    var ring = Grid.simplifyRing(best.pts, cell * 0.75);
    if (!ring || ring.length < 3) return null;
    return {
      ring: ring, cells: cells, mask: mask, closed: best.closed,
      clipped: !!limit
    };
  }

  /**
   * What the block is made of: its footprint, the rock face over it, and the
   * rock behind that face.
   *
   * Volume is measured from the surface down to whichever of the two planes is
   * HIGHER at each cell — the wedge is the rock above both, so the higher plane
   * is its floor. Vertical thickness, so plan area times thickness is a volume.
   * `maxThickness` comes back with it as the honesty check: two near-vertical
   * planes make an arbitrarily deep wedge, and a volume quoted without that is
   * a number with no geometry behind it.
   */
  function blockGeometry(d) {
    var g = S.grid;
    if (!g || !S.der || !d || !d.ring || d.ring.length < 3) return null;
    var ring = d.ring;
    var x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    ring.forEach(function (p) {
      if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
      if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
    });
    function inside(x, y) {
      return x >= x1 && x <= x2 && y >= y1 && y <= y2 && Sens.pointInPoly(ring, x, y);
    }
    var out = Grid.surfaceStats(g, S.der, inside);
    out.planRing = Math.abs(Grid.ringArea(ring));

    /* volume needs the two planes, so only a block that was built from them
       has one — a hand-traced polygon is a footprint and nothing more */
    var w = d.wedge;
    if (w && w.planes && w.planes.length && w.anchor) {
      var ns = w.planes.map(function (p) {
        return Struct.planeNormal(Struct.clampDip(p.dip), p.dipDir);
      });
      var a = w.anchor;
      var mask = new Uint8Array(g.nx * g.ny);
      for (var j = 0; j < g.ny; j++) {
        for (var i = 0; i < g.nx; i++) {
          if (inside(g.x0 + i * g.dx, g.y0 + j * g.dy)) mask[j * g.nx + i] = 1;
        }
      }
      /* the floor is whichever plane is HIGHER here — the block is the rock
         above all of them, so the highest one is what it stands on */
      out.vol = Grid.volumeUnder(g, mask, function (id, x, y) {
        var z = -Infinity;
        for (var k = 0; k < ns.length; k++) z = Math.max(z, planeZ(ns[k], a, x, y));
        return z;
      });
    }
    return out;
  }

  /** the level of a plane at a place, from its normal and a point on it */
  function planeZ(n, anchor, x, y) {
    if (Math.abs(n[2]) < 1e-9) return -Infinity;   // vertical: never the floor
    return anchor[2] - (n[0] * (x - anchor[0]) + n[1] * (y - anchor[1])) / n[2];
  }

  /** whether a drawn region should act as the block's outer boundary too */
  function blockUsesAoi() {
    return !!($('stBlockAoi') && $('stBlockAoi').checked && $('chkAOI').checked);
  }

  /** what an auto-built block should reach up to, in metres above daylight */
  function blockHeight() {
    var v = num('stBlockH', NaN);
    if (isFinite(v) && v > 0) return v;
    var g = S.grid;
    return g ? Math.max(10, (g.zmax - g.zmin) * 0.25) : 50;
  }

  /**
   * Whether there is a movement direction ready to attach a polygon to, and
   * the state of the button that starts drawing one.
   *
   * A domain is two steps — choose the direction, then trace the ground it
   * applies to — and the first step is easy to skip. A button that looks
   * pressable and then silently does nothing is the worst possible answer, so
   * it is disabled until there is something to draw, and says what is missing.
   */
  function syncDomainBuilder() {
    var t = num('stDomTrend', NaN), p = num('stDomPlunge', NaN);
    var ready = isFinite(t) && isFinite(p) && !!S.grid;
    var auto = !!S.stagedPlanes;
    $('stAutoBlock').disabled = !auto;
    $('stAutoWrap').title = auto
      ? 'Click once where the structure daylights and the block is worked out from ' +
        (S.stagedPlanes.length > 1 ? 'the two planes' : 'the plane') +
        ', the survey and the height below.'
      : 'Only available for a sliding result taken from the results table — a typed trend and ' +
        'plunge does not say which planes bound the block, and a TOPPLING mass has no mapped ' +
        'floor to build one from: its basal surface cuts across the layers rather than following ' +
        'any of them. Trace the footprint instead.';
    $('stBlockH').disabled = !auto || !$('stAutoBlock').checked;
    var aoiOn = $('chkAOI').checked;
    $('stBlockAoi').disabled = !auto || !$('stAutoBlock').checked || !aoiOn;
    $('stBlockAoi').parentNode.title = aoiOn
      ? 'Stop the block at the edge of the drawn selection mask as well as at the two ' +
        'planes and the height — so a region you have drawn becomes its outer boundary.'
      : 'No area of interest is switched on, so there is no polygon to limit the block to.';
    var btn = $('stDrawDomain'), chip = $('stDomReady');
    btn.disabled = !ready;
    btn.lastChild.nodeValue = (auto && $('stAutoBlock').checked)
      ? ' Build the block from one click'
      : ' Draw the block on the model';
    btn.title = ready
      ? (auto && $('stAutoBlock').checked
        ? 'Click once where it daylights; the block is built from the ' +
          (S.stagedPlanes.length > 1 ? 'two planes' : 'plane') + '.'
        : 'Trace the block this movement direction applies to.')
      : (S.grid
        ? 'Set a trend and plunge first — press “Use” on a result in the table above, or type them here.'
        : 'Load a model first.');
    chip.className = 'stChip' + (ready ? ' crit' : '');
    chip.textContent = ready
      ? 'ready — ' + tp(t, p)
      : 'no direction chosen yet';
    return ready;
  }

  /** stage a movement direction, then let the operator draw the block it belongs to */
  function drawDomain() {
    if (!S.grid) { SM.status('Load a model first.'); return; }
    var t = num('stDomTrend', NaN), p = num('stDomPlunge', NaN);
    if (!isFinite(t) || !isFinite(p)) {
      SM.status('No movement direction yet — press “Use” on a wedge in the results table, ' +
        'or type a trend and plunge, then draw the block.');
      return;
    }
    S.pendingDomain = {
      trend: Struct.wrap360(t), plunge: SM.clamp(p, -90, 90),
      name: $('stDomName').value.trim() || null,
      note: $('stDomNote').value || '',
      /* the two planes, when the vector came from a wedge — that is what lets
         the block be constructed instead of traced */
      planes: S.stagedPlanes || null,
      auto: $('stAutoBlock').checked && !!S.stagedPlanes
    };
    SM.Tools.set('domain');
  }

  /**
   * One click, and the block is worked out from the structure.
   *
   * The click says where the structure daylights — the toe of it, the point
   * the line of intersection (or, for a planar slide, the plane itself)
   * reaches the surface — and everything else follows from the planes and the
   * survey.
   */
  function autoBlockAt(hit) {
    var pend = S.pendingDomain;
    if (!pend || !pend.planes || !pend.planes.length) return false;
    var one = pend.planes.length < 2;
    var built = wedgeBlock(pend.planes[0], one ? null : pend.planes[1],
      [hit.x, hit.y, hit.z], blockHeight(), blockUsesAoi());
    if (!built) {
      SM.status('No block came out there — the ' + (one ? 'plane' : 'wedge') +
        ' does not daylight at that point. ' +
        'Click lower on the face, at the toe of it, or raise the block height.');
      return false;
    }
    /* a snapshot, not a reference: the planes can be edited or deleted later
       and the block would then be reporting a volume against geometry that no
       longer exists */
    pend.wedge = {
      planes: pend.planes.map(function (p) {
        return { name: p.name, dip: p.dip, dipDir: p.dipDir };
      }),
      anchor: [hit.x, hit.y, hit.z], height: blockHeight()
    };
    commitDomainRing(built.ring, built.cells, built);
    return true;
  }

  function commitDomainRing(ring, autoCells, built) {
    var pend = S.pendingDomain || { trend: num('stDomTrend', 0), plunge: num('stDomPlunge', 0) };
    S.pendingDomain = null;
    var d = {
      name: pend.name || ('Domain ' + (S.domains.length + 1)),
      ring: ring, trend: pend.trend, plunge: pend.plunge,
      note: pend.note || '', color: PALETTE[(S.domains.length + 3) % PALETTE.length], on: true,
      wedge: pend.wedge || null
    };
    S.domains.push(d);
    afterDomainChange();
    /* Say what happens next, and be specific about it. The domain is drawn on
       the terrain the moment it is closed, but the SENSITIVITY does not change
       until the model is run again — and "nothing happened" is exactly how
       that reads if nobody says so. */
    SM.status('“' + d.name + '” created — ' +
      (autoCells
        ? 'built from the ' + (pend.wedge && pend.wedge.planes.length > 1 ? 'two planes' : 'plane') +
          ' over ' + SM.fmtInt(autoCells) + ' cells, ' +
          ring.length + ' vertices'
        : ring.length + ' vertices') +
      (built && built.clipped ? ', clipped to the area of interest' : '') +
      (built && built.closed === false
        ? ', open at the edge of the survey' : '') +
      ', moving ' + tp(d.trend, d.plunge) + '. ' + (S.res
        ? 'Press “Compute sensitivity map” again to see what the radar makes of it.'
        : 'Press “Compute sensitivity map” to see what the radar makes of it.'));
    SM.badge('recompute needed', 'busy');
  }

  /**
   * A copy of a domain, nudged clear of the original so it can be seen and
   * grabbed. The same wedge often releases in two or three places along a
   * wall; re-deriving the direction each time is work for nothing.
   */
  function duplicateDomain(i) {
    var src = S.domains[i];
    if (!src) return;
    var step = S.grid ? SM.extentOf(S.grid).ext * 0.04 : 10;
    var copy = {
      name: src.name.replace(/ \(copy( \d+)?\)$/, '') + ' (copy)',
      ring: src.ring.map(function (p) { return [p[0] + step, p[1] + step]; }),
      trend: src.trend, plunge: src.plunge, note: src.note,
      color: src.color, on: src.on !== false
    };
    S.domains.push(copy);
    S.domHi = S.domains.length - 1;
    afterDomainChange();
    SM.status('“' + copy.name + '” copied — same movement direction, ' +
      'offset so you can see it. Arm “Stretch vertices” and drag its centre handle ' +
      'to put it where it belongs.');
  }

  /** every domain overriding the movement vector, or none of them */
  function setAllDomains(on) {
    if (!S.domains.length) return;
    S.domains.forEach(function (d) { d.on = !!on; });
    afterDomainChange();
    SM.status(on
      ? 'All ' + S.domains.length + ' domains active — recompute to see them.'
      : 'All domains switched off — the whole model is back on the global movement vector. ' +
        'Recompute to see that.');
  }

  function removeDomain(i) {
    if (i < 0 || i >= S.domains.length) return;
    var gone = S.domains.splice(i, 1)[0];
    afterDomainChange();
    SM.status('Removed “' + gone.name + '”.');
  }

  function renameDomain(i, name) {
    if (!S.domains[i]) return;
    S.domains[i].name = String(name || '').trim() || ('Domain ' + (i + 1));
    renderDomains();
    SM.Tree.refresh();
  }

  function toggleDomain(i) {
    if (!S.domains[i]) return;
    S.domains[i].on = S.domains[i].on === false;
    afterDomainChange();
  }

  function clearDomains() {
    if (!S.domains.length) return;
    S.domains = [];
    afterDomainChange();
    SM.status('All structural domains cleared — the whole model is back on the global movement vector.');
  }

  /** the resolved per-cell index, rebuilt whenever the polygons move */
  function recomputeIndex() {
    S.domIdx = (S.grid && S.domains.length) ? Sens.domainIndex(S.grid, S.domains) : null;
    S.fillStamp++;                       /* the drawn fill is built from it */
  }

  function afterDomainChange() {
    recomputeIndex();
    refresh();
    SM.Overlays.update();
    SM.Tree.refresh();
    SM.Cmd.refresh();
    SM.Model.invalidate();
  }

  /**
   * What the radar would actually measure inside one domain.
   *
   * Read off the LAST COMPUTE, not the current polygon list — `S.res` carries
   * the domain set it was run with, so a domain edited since the compute shows
   * no numbers rather than numbers belonging to a different shape.
   */
  function domainStats(i) {
    if (!S.res || !S.res.domIdx || !S.res.domains) return null;
    var live = S.res.domains.indexOf(S.domains[i]);
    if (live < 0) return null;
    var mask = Sens.domainMask(S.res.domIdx, live);
    var thr = numOr('inpThresh', 0.5);
    return Sens.summarise(S.res.combined, mask, thr, S.grid);
  }

  /* ============================================================
     Rendering the panel
     ============================================================ */
  function refresh() {
    renderPlanes();
    renderResults();
    renderDomains();
    syncDomainBuilder();
    redraw();
  }

  function renderPlanes() {
    var host = $('stPlaneList');
    if (!S.planes.length) {
      host.innerHTML = '<div class="treeEmpty">No planes yet — type a dip and dip direction above, ' +
        'pick three points off the surface, or paste a mapping list.</div>';
      return;
    }
    var nOn = countOn(S.planes);
    var h = ['<table class="dataTable structTable"><tr>' +
      '<th><input type="checkbox" class="stAllOn" title="' +
      (nOn === S.planes.length
        ? 'All planes are in the analysis. Untick to leave them all out.'
        : 'Tick to put every plane back in the analysis.') +
      '"' + (nOn === S.planes.length ? ' checked' : '') + '></th>' +
      '<th></th><th>Name</th><th>Dip</th><th>Dip dir</th><th></th></tr>'];
    S.planes.forEach(function (p, i) {
      h.push('<tr data-i="' + i + '" class="stRow' + (p.on === false ? ' off' : '') + '">' +
        '<td><input type="checkbox" class="stOn"' + (p.on === false ? '' : ' checked') + '></td>' +
        '<td><input type="color" class="stCol" value="' + esc(p.color) +
        '" title="Colour of this plane on the stereonet and in the 3D view"></td>' +
        '<td><input type="text" class="stName" value="' + esc(p.name) +
        '" title="' + esc(planeHint(p)) + '"></td>' +
        '<td><input type="number" class="stDip mini" value="' + Math.round(p.dip * 10) / 10 +
        '" min="0" max="90" step="1"></td>' +
        '<td><input type="number" class="stDir mini" value="' + Math.round(p.dipDir) +
        '" min="0" max="360" step="1"></td>' +
        '<td class="stAct">' +
        '<button class="miniBtn stPlace" title="' +
        (p.anchor
          ? 'Placed on the model. Click to move it somewhere else; the stretch tool resizes it by its corners.'
          : 'This is an orientation with no location, so nothing is drawn for it. Click, then click the model to place it.') +
        '">' + (p.anchor ? '⌖' : '+⌖') + '</button>' +
        '<button class="miniBtn stDup" title="Copy this plane — same orientation, ' +
        'offset so it can be moved to where the next one outcrops">Copy</button>' +
        (isFinite(p.size)
          ? '<button class="miniBtn stReset" title="Back to the default plane size">↺</button>'
          : '') +
        '<button class="tx stDel" title="Remove">×</button></td></tr>');
    });
    host.innerHTML = h.join('') + '</table>';
    /* the middle state cannot be written as an attribute */
    var all = host.querySelector('.stAllOn');
    if (all) all.indeterminate = nOn > 0 && nOn < S.planes.length;
  }

  function planeHint(p) {
    var pl = Struct.pole(p.dip, p.dipDir);
    var s = dd(p.dip, p.dipDir) + '  ·  pole ' + tp(pl.trend, pl.plunge);
    if (p.rms != null) s += '  ·  fitted through ' + p.nPicks + ' picks, ' + fmt(p.rms, 2) + ' m scatter';
    s += p.anchor
      ? '  ·  placed at ' + Math.round(p.anchor[0]) + ', ' + Math.round(p.anchor[1])
      : '  ·  not placed on the model — an orientation only';
    if (isFinite(p.size)) s += '  ·  drawn ' + Math.round(p.size) + ' m along strike';
    return s;
  }

  /**
   * The one column that says whether this wedge is real.
   *
   * Four ways it can fail to be, and they are different failures: the two
   * structures never touch; they touch but only out in the air beyond the
   * face, bounding no rock at all; they bound rock but the line does not reach
   * the face inside the extents they were drawn with; or one of them has no
   * location and none of this can be told. Collapsing those into a tick would
   * throw away the reason.
   */
  function meetsCell(p) {
    var st = Struct.contactState(p);
    var text, why, cls;
    if (st === 'apart') {
      text = 'apart'; cls = ' apart';
      why = 'Critical on orientation alone. As mapped, these two never touch, so this ' +
        'wedge exists on the stereonet and nowhere in the pit.';
    } else if (st === 'air') {
      text = 'in air'; cls = ' apart';
      why = 'They do cross — but out in front of the face, above the ground. There is no ' +
        'rock between them here, so there is nothing to fail. Nothing on the stereonet ' +
        'can tell you this; only the survey can.';
    } else if (st === 'rock') {
      text = 'buried'; cls = ' buried';
      why = 'They bound ' + Math.round(p.rock.lenRock) + ' m of rock, but the line does not ' +
        'reach the face inside the extents these planes are drawn with — so nothing releases ' +
        'here as mapped. Stretch the patches down-plunge and look again.';
    } else if (st === 'daylight') {
      text = Math.round(p.rock.lenRock) + ' m';
      cls = '';
      why = 'The real thing: ' + Math.round(p.rock.lenRock) + ' m of rock behind the face and ' +
        'the line reaches daylight, so this wedge can release.';
    } else if (st === 'contact') {
      text = Math.round(p.seg.length) + ' m'; cls = '';
      why = 'In contact over ' + Math.round(p.seg.length) + ' m. No surface loaded, so ' +
        'whether it holds any rock cannot be told.';
    } else {
      text = '—'; cls = '';
      why = 'Cannot be told — one of the planes has no location. Place it on the model ' +
        'with ⌖ and this fills in.';
    }
    return '<td class="mono' + cls + '" title="' + esc(why) + '">' + text + '</td>';
  }

  /**
   * What each mode calls the things it counts.
   *
   * A table headed "Wedge / Axis / Slides on" is actively wrong for a toppling
   * analysis, and a summary that says "3 of 6 intersections critical" when the
   * mode tests one plane at a time is worse than wrong — it is confidently
   * misleading. So the words come from the mode, in one place, rather than
   * being written into the markup.
   */
  var WORDS = {
    wedge: {
      pop: 'intersections', head: ['Wedge', 'Axis'], move: 'Slides on',
      zone: { primary: 'both planes', secondary: 'one plane', none: 'stable' },
      sum: { primary: 'sliding on both planes', secondary: 'on one plane', none: 'stable' }
    },
    direct: {
      pop: 'intersections', head: ['Block', 'Edge'], move: 'Moves',
      zone: { primary: 'topples', secondary: 'oblique', none: 'no block' },
      sum: { primary: 'cutting toppling blocks', secondary: 'toppling obliquely', none: 'no block' }
    },
    planar: {
      pop: 'planes', head: ['Plane', 'Dip / dir'], move: 'Slides',
      zone: { primary: 'planar slide', secondary: 'off square', none: 'stable' },
      sum: { primary: 'daylighting and steeper than φ', secondary: 'outside the lateral limits',
        none: 'stable' }
    },
    flexural: {
      pop: 'planes', head: ['Plane', 'Dip / dir'], move: 'Topples',
      zone: { primary: 'topples', secondary: 'off square', none: 'stable' },
      sum: { primary: 'free to topple', secondary: 'outside the lateral limits', none: 'stable' }
    }
  };
  WORDS.planarNL = WORDS.planar;

  function words(M) { return WORDS[M.id] || WORDS.wedge; }
  function chip(zone, text) {
    return '<span class="stChip ' + (zone === 'primary' ? 'crit' : zone === 'secondary' ? 'sec' : '') +
      '">' + text + '</span>';
  }

  function renderResults() {
    var r = S.kin, box = $('stSummary'), host = $('stPairList');
    var M = mode(), W = words(M);
    if (!r || !r.total) {
      var live = S.planes.filter(function (p) { return p.on !== false; }).length;
      box.innerHTML = M.plots === 'poles'
        ? (live ? 'Nothing to test.' : 'Map a plane — ' + M.name.toLowerCase() +
          ' tests each one on its own.')
        : (live < 2
          ? 'Two enabled planes are needed before there is an intersection to test.'
          : 'No intersections — the enabled planes are parallel.');
      host.innerHTML = '';
      return;
    }

    box.innerHTML =
      '<b>' + r.nCritical + ' of ' + r.total + '</b> ' + W.pop + ' critical &nbsp;' +
      '<b>' + fmt(r.pctCritical, 1) + '%</b><br>' +
      '<span class="stChip crit">' + r.nPrimary + ' ' + W.sum.primary + '</span> ' +
      (r.nSecondary || M.limits || M.id === 'wedge'
        ? '<span class="stChip sec">' + r.nSecondary + ' ' + W.sum.secondary + '</span> ' : '') +
      '<span class="stChip">' + (r.total - r.nCritical) + ' ' + W.sum.none + '</span><br>' +
      '<span class="dim">face ' + dd(r.face.dip, r.face.dipDir) + ' · φ ' + Math.round(r.phi) + '°' +
      (r.limit == null ? ' · no lateral limits' : ' · limits ±' + Math.round(r.limit) + '°') +
      '</span>' +
      /* direct toppling is the one mode that needs two populations at once, so
         the count of one of them alone is not an answer */
      (M.id === 'direct'
        ? '<br><span class="stChip' + (r.nSliding ? ' crit' : '') + '">' + r.nSliding +
          ' sliding base planes</span> <span class="stChip' + (r.nRelease ? ' sec' : '') + '">' +
          r.nRelease + ' release surfaces</span>' +
          (r.nPrimary && !r.nBase
            ? '<br><span class="w">No base plane mapped. Direct toppling needs a third set for ' +
              'the blocks to topple over — as mapped, these blocks have no floor.</span>'
            : '')
        : '') +
      (r.nApart
        ? '<br><span class="dim">' + r.nApart + ' pair' + (r.nApart === 1 ? '' : 's') +
          (r.filtered ? ' left out — mapped apart, so they meet nowhere on the model'
            : ' meet nowhere on the model') + '</span>'
        : '') +
      (r.nAir
        ? '<br><span class="dim">' + r.nAir + ' pair' + (r.nAir === 1 ? '' : 's') +
          (r.filtered ? ' left out — they cross' : ' cross') +
          ' in front of the face, bounding no rock</span>'
        : '') +
      (r.nUntested
        ? '<br><span class="dim">' + r.nUntested + ' pair' + (r.nUntested === 1 ? '' : 's') +
          ' untested — a plane has no location</span>'
        : '');

    host.innerHTML = M.plots === 'poles' ? poleTable(r, M)
      : M.plots === 'both'
        ? '<div class="subhead stSub">Block edges <span class="dim">every plane pair</span></div>' +
          pairTable(r, M) +
          '<div class="subhead stSub">Base planes <span class="dim">what the blocks topple over</span></div>' +
          poleTable(r, M)
        : pairTable(r, M);
  }

  /** the intersection population: wedge axes, or the edges of a toppling block */
  function pairTable(r, M) {
    var W = words(M);
    var h = ['<table class="dataTable structTable"><tr>' +
      '<th>' + W.head[0] + '</th><th>' + W.head[1] + '</th><th>Meets</th><th>Mode</th>' +
      '<th>' + W.move + '</th><th></th></tr>'];
    var wasEmpty = false;
    r.pairs.forEach(function (p, i) {
      /* one rule away from the top of the table: everything below this line
         bounds no rock, so nothing below it can fail */
      var empty = Struct.isEmptyWedge(p);
      if (empty && !wasEmpty && i > 0) {
        h.push('<tr class="stSplit"><td colspan="6">nothing below bounds any rock</td></tr>');
      }
      wasEmpty = empty;
      h.push('<tr data-i="' + i + '" data-kind="pair" class="stRow zone-' + p.zone +
        '" title="' + esc(p.why) + '">' +
        '<td>' + esc(p.a.name) + ' × ' + esc(p.b.name) + '</td>' +
        '<td class="mono">' + tp(p.trend, p.plunge) + '</td>' +
        meetsCell(p) +
        '<td>' + chip(p.zone, W.zone[p.zone]) + '</td>' +
        '<td class="mono">' + (p.zone === 'none' ? '—' : tp(p.slide.trend, p.slide.plunge)) + '</td>' +
        '<td><button class="miniBtn stUse"' + (p.zone === 'none' ? ' disabled' : '') +
        ' title="' + (p.zone === 'none'
          ? 'Nothing to apply — this pair is not critical.'
          : 'Take this result’s movement direction down to the domain builder, ' +
            'then draw the block it applies to.') +
        '">Use</button></td></tr>');
    });
    return h.join('') + '</table>';
  }

  /**
   * The pole population: one row per plane.
   *
   * There is no "Meets" column here, and its absence is the honest answer
   * rather than an omission — a single plane needs no second structure to be
   * in contact with. What a located plane does give is the trace it cuts on the
   * surface, which is drawn in the 3D view; the row says whether there is one.
   */
  function poleTable(r, M) {
    var W = words(M), base = M.id === 'direct';
    var h = ['<table class="dataTable structTable"><tr>' +
      '<th>' + (base ? 'Plane' : W.head[0]) + '</th><th>' + (base ? 'Dip / dir' : W.head[1]) +
      '</th><th>Pole</th><th>' + (base ? 'Role' : 'Mode') + '</th>' +
      '<th>' + (base ? 'Slides' : W.move) + '</th><th></th></tr>'];
    r.poles.forEach(function (e) {
      var idx = S.planes.indexOf(e.p);
      var lbl = base
        ? (e.role === 'sliding' ? 'base + slide' : e.role === 'release' ? 'release only' : 'no part')
        : W.zone[e.zone];
      h.push('<tr data-i="' + idx + '" data-kind="plane" class="stRow zone-' + e.zone +
        '" title="' + esc(e.why + (e.placed ? '' :
          ' — no location, so nothing is drawn for it on the model')) + '">' +
        '<td>' + esc(e.name) + '</td>' +
        '<td class="mono">' + dd(e.dip, e.dipDir) + '</td>' +
        '<td class="mono">' + tp(e.trend, e.plunge) + '</td>' +
        '<td>' + chip(e.zone, lbl) + '</td>' +
        '<td class="mono">' + (e.slide ? tp(e.slide.trend, e.slide.plunge) : '—') + '</td>' +
        '<td><button class="miniBtn stUse"' + (e.slide && e.zone !== 'none' ? '' : ' disabled') +
        ' title="' + (e.slide && e.zone !== 'none'
          ? 'Take this plane’s movement direction down to the domain builder.'
          : base
            ? 'A release surface does not move on its own — take the direction from a block edge above.'
            : 'Nothing to apply — this plane is not critical.') +
        '">Use</button></td></tr>');
    });
    return h.join('') + '</table>';
  }

  function renderDomains() {
    var host = $('stDomainList');
    if (!S.domains.length) {
      host.innerHTML = '<div class="treeEmpty">No structural domains yet — the whole model ' +
        'uses the movement vector chosen in <b>Processing</b>.<br><br>' +
        'To add one: press <b>Use</b> on a wedge in the results table above, then ' +
        '<b>Draw the block on the model</b> and trace the ground it applies to. ' +
        'The map changes when you compute again.</div>';
      return;
    }
    var cellA = S.grid ? S.grid.dx * S.grid.dy : NaN;
    var f = numOr('inpTrue', 10);
    var dOn = countOn(S.domains);
    var h = ['<div class="domAll"><label class="chk"><input type="checkbox" class="domAllOn"' +
      (dOn === S.domains.length ? ' checked' : '') + '> ' +
      dOn + ' of ' + S.domains.length + ' active</label></div>'];
    S.domains.forEach(function (d, i) {
      var st = domainStats(i);
      var geo = blockGeometry(d);
      h.push('<div class="domCard' + (d.on === false ? ' off' : '') + '" data-i="' + i + '">' +
        '<div class="domHead">' +
        '<input type="checkbox" class="domOn"' + (d.on === false ? '' : ' checked') + '>' +
        '<input type="color" class="domCol" value="' + esc(d.color) +
        '" title="Colour of this domain in the 3D view">' +
        '<input type="text" class="domName" value="' + esc(d.name) +
        '" title="What this domain is called — in the tree, the 3D view and the CSV export">' +
        '<button class="tx domDel" title="Remove">×</button></div>' +
        (d.note ? '<div class="domNote">' + esc(d.note) + '</div>' : '') +
        '<div class="domStats mono">' +
        (geo && geo.cells
          ? 'plan ' + areaTxt(geo.planRing) + ' · face ' + areaTxt(geo.surface) +
            ' <span class="dim">×' + (geo.surface / geo.planCells).toFixed(2) + '</span><br>' +
            (geo.vol && geo.vol.cells
              ? 'volume <b>' + volTxt(geo.vol.volume) + '</b> · thickness ' +
                fmt(geo.vol.meanThickness, 1) + ' m mean, ' +
                fmt(geo.vol.maxThickness, 1) + ' m max<br>' +
                /* A wedge bounded by two planes and a slope face has no upper
                   release surface: the rock above both planes keeps deepening
                   away from the point it daylights at. So the volume is set
                   partly by where the block was capped, not by the structure
                   alone, and saying so is the difference between a figure and
                   a misleading figure. */
                (d.wedge && geo.vol.maxThickness > 2 * (d.wedge.height || 0)
                  ? '<span class="mWarn">no upper release surface — this volume is ' +
                    'set by the ' + Math.round(d.wedge.height) + ' m block height as much as ' +
                    'by the ' + (d.wedge.planes && d.wedge.planes.length > 1
                      ? 'two planes' : 'plane') + '</span><br>'
                  : '')
              : '')
          : '') +
        (st
          ? SM.fmtInt(st.nVis) + ' visible cells · ' + fmt(st.areaVis / 10000, 2) + ' ha<br>' +
            'mean S ' + fmt(st.mean, 3) + ' · p10 ' + fmt(st.p10, 3) + ' · usable ' +
            (100 * st.usable).toFixed(0) + '%<br>' +
            f + ' mm true → <b>' + fmt(st.mean * f, 2) + ' mm</b> along the line of sight'
          : (d.ring.length + ' vertices' +
            (cellA === cellA ? '' : '') + ' · <span class="dim">compute to see what the radar would measure</span>')) +
        '</div>' +
        /* the actions get a row to themselves: crammed into the header beside a
           name field they were squeezed to nothing and nobody found them */
        '<div class="domActions">' +
        '<span class="mono domVec">' + tp(d.trend, d.plunge) + '</span>' +
        '<button class="miniBtn domDup" title="Copy this domain — same movement direction, ' +
        'offset so it can be moved to the next place the wedge releases">Copy</button>' +
        '<button class="miniBtn domMove" title="Arm the stretch tool, then drag this domain’s ' +
        'centre handle to move the whole block, or a corner to reshape it">Move / reshape</button>' +
        '</div></div>');
    });
    host.innerHTML = h.join('');
    var dall = host.querySelector('.domAllOn');
    if (dall) dall.indeterminate = dOn > 0 && dOn < S.domains.length;
  }

  /* ------------------------------------------------------- stereonet */
  function model() {
    return {
      planes: S.planes, face: face(), phi: phi(), result: S.kin,
      mode: $('stMode').value, limit: mode().limits ? limit() : null,
      show: show, equalArea: $('stEqualArea').checked, hi: S.netHi
    };
  }
  var _m = null;

  function redraw() {
    var c = $('netCanvas');
    if (!c || !c.clientWidth) return;                 // hidden pane has no size
    _m = model();
    SM.Net.draw(c, _m);
  }

  function highlight(kind, index) {
    var same = S.netHi && S.netHi.kind === kind && S.netHi.index === index;
    if (same || (!kind && !S.netHi)) return;
    S.netHi = kind ? { kind: kind, index: index } : null;
    markRows();
    redraw();
    SM.Overlays.update();
  }

  function markRows() {
    var hi = S.netHi;
    /* the results table holds pair rows, pole rows, or — under direct toppling
       — both, so each row says which population it belongs to */
    Array.prototype.forEach.call($('stPairList').querySelectorAll('.stRow'), function (r) {
      r.classList.toggle('hi', !!hi && hi.kind === (r.getAttribute('data-kind') || 'pair') &&
        +r.getAttribute('data-i') === hi.index);
    });
    Array.prototype.forEach.call($('stPlaneList').querySelectorAll('.stRow'), function (r) {
      r.classList.toggle('hi', !!hi && hi.kind === 'plane' && +r.getAttribute('data-i') === hi.index);
    });
  }

  /**
   * Load one analysis result into the domain builder.
   *
   * `planes` is the part that matters as much as the direction: it is what
   * lets the block be CONSTRUCTED from the structure instead of traced. It is
   * staged only where the failed mass really is bounded by mapped surfaces —
   * the rock above a wedge's two planes, or above a planar slide's one. A
   * toppling column has no mapped floor: its basal failure surface is a
   * notional plane cutting across the layers, not anything anybody mapped, so
   * for the toppling modes the direction is staged alone and the footprint is
   * traced. Building a "block above the joints" there would put a confident
   * volume on geometry that does not exist.
   */
  function useResult(kind, i) {
    var r = S.kin;
    if (!r) return;
    if (kind === 'plane') return usePole(i);
    var p = r.pairs[i];
    if (!p || p.zone === 'none') return;
    var toppling = r.mode === 'direct';
    S.stagedPlanes = toppling ? null : [p.a, p.b];
    $('stDomTrend').value = Math.round(p.slide.trend);
    $('stDomPlunge').value = Math.round(p.slide.plunge);
    $('stDomName').value = p.a.name + ' × ' + p.b.name;
    $('stDomNote').value = (toppling
      ? (p.zone === 'primary' ? 'Blocks cut by ' : 'Oblique toppling on ') +
        p.a.name + ' and ' + p.b.name + ', toppling out of the face over a base plane'
      : p.zone === 'primary'
        ? 'Wedge on ' + p.a.name + ' and ' + p.b.name + ', sliding down the line of intersection'
        : 'Release on ' + p.slide.on + ' alone (wedge axis flatter than φ)') +
      ' · face ' + dd(face().dip, face().dipDir) + ', φ ' + Math.round(phi()) + '°';
    syncDomainBuilder();
    /* The builder sits at the bottom of a long panel, so filling its fields is
       invisible from where the button was pressed. Bring it into view and flash
       it: without that, "Use" looks like it did nothing at all. */
    var box = $('stDomainBuilder');
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    box.classList.remove('flash');
    void box.offsetWidth;                       // restart the animation
    box.classList.add('flash');
    staged(p.slide);
    highlight('pair', i);
  }

  /** the same, for a mode whose result is one plane rather than a pair */
  function usePole(planeIndex) {
    var r = S.kin, P = S.planes[planeIndex];
    var e = P && r && r.poles.filter(function (q) { return q.p === P; })[0];
    if (!e || !e.slide || e.zone === 'none') return;
    var slab = r.mode === 'planar' || r.mode === 'planarNL' ||
      (r.mode === 'direct' && e.role === 'sliding');
    /* a slab IS the rock above its own plane, so one plane is enough to build
       the block from — the same construction as a wedge, with one flank */
    S.stagedPlanes = slab ? [e.p] : null;
    $('stDomTrend').value = Math.round(e.slide.trend);
    $('stDomPlunge').value = Math.round(e.slide.plunge);
    $('stDomName').value = e.name;
    $('stDomNote').value = (r.mode === 'flexural'
      ? 'Flexural toppling of ' + e.name + ' (' + dd(e.dip, e.dipDir) +
        '), columns rotating out of the face'
      : r.mode === 'direct'
        ? 'Sliding base plane ' + e.name + ' (' + dd(e.dip, e.dipDir) + ') under toppling blocks'
        : 'Planar slide on ' + e.name + ' (' + dd(e.dip, e.dipDir) + '), down the dip vector') +
      (e.zone === 'secondary' ? ', outside the ±' + Math.round(r.limit) + '° lateral limits' : '') +
      ' · face ' + dd(face().dip, face().dipDir) + ', φ ' + Math.round(phi()) + '°';
    syncDomainBuilder();
    var box = $('stDomainBuilder');
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    box.classList.remove('flash');
    void box.offsetWidth;
    box.classList.add('flash');
    staged(e.slide);
    highlight('plane', planeIndex);
  }

  /** what to say once a direction is in the builder — the next step, not the last one */
  function staged(slide) {
    SM.status('Movement direction ' + tp(slide.trend, slide.plunge) + ' ready — now press “' +
      (S.stagedPlanes && $('stAutoBlock').checked
        ? 'Build the block from one click” and click where it daylights.'
        : 'Draw the block on the model” and trace its footprint.'));
  }

  /* ============================================================
     Wiring
     ============================================================ */
  function init() {
    ['stFaceDip', 'stFaceDir', 'stPhi', 'stLimit'].forEach(function (id) {
      $(id).onchange = changed;
    });
    /* a change of mode is a change of question: the results table, the plotted
       population and the shaded zones all follow it */
    $('stMode').onchange = function () { syncMode(true); changed(); };
    $('stEqualArea').onchange = redraw;
    $('stOnlyContact').onchange = changed;
    /* purely how things are drawn, so nothing is recomputed — just repainted */
    ['stPlaneSize', 'stPlaneAlpha', 'stDomAlpha'].forEach(function (id) {
      $(id).oninput = function () { SM.Overlays.update(); };
    });
    ['stPlaneDraw', 'stPlaneClip'].forEach(function (id) {
      $(id).onchange = function () { syncPlaneDraw(); SM.Overlays.update(); };
    });
    syncPlaneDraw();

    $('stAddPlane').onclick = function () {
      var d = num('stNewDip', NaN), a = num('stNewDir', NaN);
      if (!isFinite(d) || !isFinite(a)) { SM.status('Type a dip and a dip direction.'); return; }
      var p = addPlane(d, a, $('stNewName').value.trim() || null);
      $('stNewName').value = '';
      SM.status('Added ' + p.name + ' — ' + dd(p.dip, p.dipDir) + '.');
    };
    $('stClearPlanes').onclick = clearPlanes;
    $('stPasteToggle').onclick = function () { $('stPasteWrap').classList.toggle('hidden'); };
    $('stPasteApply').onclick = importPasted;
    $('stFaceProbe').onclick = faceFromProbe;
    $('stFaceMask').onclick = faceFromMask;
    $('stDrawDomain').onclick = drawDomain;
    ['stDomTrend', 'stDomPlunge'].forEach(function (id) {
      $(id).oninput = syncDomainBuilder;
    });
    $('stAutoBlock').onchange = syncDomainBuilder;
    /* typing a direction by hand is not a wedge, so the block cannot be
       constructed from it — drop back to tracing rather than build nonsense */
    ['stDomTrend', 'stDomPlunge'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (S.stagedPlanes) { S.stagedPlanes = null; syncDomainBuilder(); }
      });
    });
    $('stClearDomains').onclick = clearDomains;

    /* the stereonet overlay switches */
    Array.prototype.forEach.call(document.querySelectorAll('#stNetOpts [data-net]'), function (b) {
      var k = b.getAttribute('data-net');
      b.onclick = function () {
        show[k] = !show[k];
        b.classList.toggle('on', !!show[k]);
        redraw();
      };
    });
    syncNetButtons();
    syncMode(false);

    /* plane list: edit in place, toggle, delete, hover to light up the net */
    var pl = $('stPlaneList');
    pl.addEventListener('change', function (e) {
      if (e.target.classList.contains('stAllOn')) { setAllPlanes(e.target.checked); return; }
      var row = e.target.closest('.stRow'); if (!row) return;
      var i = +row.getAttribute('data-i'), p = S.planes[i]; if (!p) return;
      /* Renaming changes nothing the analysis reads, and rebuilding the table
         under a field being typed in would take the caret with it. */
      if (e.target.classList.contains('stName')) {
        p.name = String(e.target.value || '').trim() || ('Plane ' + (i + 1));
        e.target.value = p.name;
        renderResults();
        SM.Overlays.update(); SM.Tree.refresh();
        return;
      }
      /* Colour is cosmetic. Repaint, but do not re-run the analysis and do not
         rebuild the row the picker is still attached to. */
      if (e.target.classList.contains('stCol')) {
        p.color = e.target.value;
        redraw(); SM.Overlays.update(); SM.Tree.refresh();
        return;
      }
      if (e.target.classList.contains('stOn')) p.on = e.target.checked;
      else if (e.target.classList.contains('stDip')) p.dip = SM.clamp(parseFloat(e.target.value) || 0, 0, 90);
      else if (e.target.classList.contains('stDir')) p.dipDir = Struct.wrap360(parseFloat(e.target.value) || 0);
      changed();
    });
    pl.addEventListener('click', function (e) {
      var row = e.target.closest('.stRow'); if (!row) return;
      var ri = +row.getAttribute('data-i');
      if (e.target.closest('.stDel')) removePlane(ri);
      else if (e.target.closest('.stDup')) duplicatePlane(ri);
      else if (e.target.closest('.stPlace')) placePlane(ri);
      else if (e.target.closest('.stReset')) resetPlaneSize(ri);
    });
    pl.addEventListener('mousemove', function (e) {
      var row = e.target.closest('.stRow');
      highlight(row ? 'plane' : null, row ? +row.getAttribute('data-i') : -1);
    });
    pl.addEventListener('mouseleave', function () { highlight(null, -1); });

    /* results list */
    var rl = $('stPairList');
    rl.addEventListener('click', function (e) {
      var row = e.target.closest('.stRow'); if (!row) return;
      if (e.target.closest('.stUse')) {
        useResult(row.getAttribute('data-kind') || 'pair', +row.getAttribute('data-i'));
      }
    });
    rl.addEventListener('mousemove', function (e) {
      var row = e.target.closest('.stRow');
      highlight(row ? (row.getAttribute('data-kind') || 'pair') : null,
        row ? +row.getAttribute('data-i') : -1);
    });
    rl.addEventListener('mouseleave', function () { highlight(null, -1); });

    /* domain cards */
    var dl = $('stDomainList');
    dl.addEventListener('change', function (e) {
      if (e.target.classList.contains('domAllOn')) { setAllDomains(e.target.checked); return; }
      var card = e.target.closest('.domCard'); if (!card) return;
      var di = +card.getAttribute('data-i');
      if (e.target.classList.contains('domOn')) toggleDomain(di);
      else if (e.target.classList.contains('domName')) renameDomain(di, e.target.value);
      /* colour is cosmetic: repaint, but do not invalidate the computed map */
      else if (e.target.classList.contains('domCol') && S.domains[di]) {
        S.domains[di].color = e.target.value;
        SM.Overlays.update();
        SM.Tree.refresh();
      }
    });
    dl.addEventListener('click', function (e) {
      var card = e.target.closest('.domCard'); if (!card) return;
      if (e.target.closest('.domDel')) removeDomain(+card.getAttribute('data-i'));
      else if (e.target.closest('.domDup')) duplicateDomain(+card.getAttribute('data-i'));
      else if (e.target.closest('.domMove')) {
        S.domHi = +card.getAttribute('data-i');
        SM.Tools.set('edit');
        SM.status('Stretch tool armed — drag “' + S.domains[S.domHi].name +
          '” by its centre handle to move it, or by a corner to reshape it.');
      }
    });
    dl.addEventListener('mousemove', function (e) {
      var card = e.target.closest('.domCard');
      var i = card ? +card.getAttribute('data-i') : -1;
      if (i === S.domHi) return;
      S.domHi = i;
      SM.Overlays.update();
    });
    dl.addEventListener('mouseleave', function () {
      if (S.domHi < 0) return;
      S.domHi = -1; SM.Overlays.update();
    });

    /* the stereonet itself: hover reads out an orientation, click picks a symbol */
    var c = $('netCanvas');
    c.addEventListener('mousemove', function (e) {
      if (!_m) return;
      var b = c.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
      var hit = SM.Net.hitAt(_m, px, py);
      highlight(hit ? hit.kind : null, hit ? hit.index : -1);
      var o = SM.Net.orientationAt(_m, px, py);
      $('netReadout').textContent = hit
        ? describeHit(hit)
        : (o ? 'line ' + tp(o.trend, o.plunge) + '   ·   plane ' +
          dd(90 - o.plunge, Struct.wrap360(o.trend + 180)) : '');
      c.style.cursor = hit ? 'pointer' : 'crosshair';
    });
    c.addEventListener('mouseleave', function () {
      highlight(null, -1);
      $('netReadout').textContent = '';
    });
    c.addEventListener('click', function (e) {
      if (!_m) return;
      var b = c.getBoundingClientRect();
      var hit = SM.Net.hitAt(_m, e.clientX - b.left, e.clientY - b.top);
      if (hit) useResult(hit.kind, hit.index);
    });

    /* a canvas has no size while its pane is display:none */
    SM.on('layout', redraw);
    SM.on('struct:shown', redraw);
    SM.on('compute:done', function () { renderDomains(); });
    SM.on('model:built', function () { recomputeIndex(); refresh(); });
    window.addEventListener('platformtheme', redraw);

    changed();
  }

  function describeHit(hit) {
    if (hit.kind === 'plane') {
      var p = S.planes[hit.index];
      if (!p) return '';
      /* under a pole mode the pole IS the result, so say what it did in the
         test rather than only what it is */
      var e = S.kin && S.kin.poles.filter(function (q) { return q.p === p; })[0];
      return p.name + '  ' + (e ? dd(e.dip, e.dipDir) + '  pole ' + tp(e.trend, e.plunge) +
        '  —  ' + e.why : planeHint(p));
    }
    var w = S.kin && S.kin.pairs[hit.index];
    if (!w) return '';
    return w.a.name + ' × ' + w.b.name + '  axis ' + tp(w.trend, w.plunge) + '  —  ' + w.why;
  }

  return {
    init: init, refresh: refresh, redraw: redraw, run: run, changed: changed,
    addPlane: addPlane, removePlane: removePlane, clearPlanes: clearPlanes,
    setAllPlanes: setAllPlanes, setAllDomains: setAllDomains, countOn: countOn,
    duplicatePlane: duplicatePlane, renamePlane: renamePlane,
    parsePasted: parsePasted, commitPlanePick: commitPlanePick,
    faceFromProbe: faceFromProbe, faceFromMask: faceFromMask, setFace: setFace, face: face, phi: phi,
    drawDomain: drawDomain, commitDomainRing: commitDomainRing,
    syncDomainBuilder: syncDomainBuilder, wedgeBlock: wedgeBlock,
    blockHeight: blockHeight, autoBlockAt: autoBlockAt,
    duplicateDomain: duplicateDomain,
    removeDomain: removeDomain, toggleDomain: toggleDomain, clearDomains: clearDomains,
    domainsChanged: afterDomainChange, renameDomain: renameDomain,
    recomputeIndex: recomputeIndex, domainStats: domainStats,
    highlight: highlight, useResult: useResult, usePole: usePole,
    mode: mode, limit: limit, syncMode: syncMode, show: show,
    planeSize: planeSize, planeAlpha: planeAlpha, domainAlpha: domainAlpha,
    blockGeometry: blockGeometry, blockUsesAoi: blockUsesAoi,
    planeDraw: planeDraw, planeClip: planeClip, patchOf: patchOf,
    placePlane: placePlane, anchorAt: anchorAt, resetPlaneSize: resetPlaneSize,
    refreshPlanes: renderPlanes
  };
})();
