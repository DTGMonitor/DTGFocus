/* ============================================================
   ui/measure.js — the ruler.

   A map tool for checking the model against itself. Click along a wall and it
   reports what every survey package reports — bearing, plan distance, height
   difference, slope distance, inclination — and then the three figures that
   actually matter for a slope job:

     · GROUND distance, walked over the raster rather than through it. On a
       benched wall it is much longer than the straight chord, and the gap
       between the two is a direct read on how broken the ground is.
     · SURFACE area against plan area. A steep face has far more rock in it
       than its outline suggests, and the ratio is the standard raster
       identity: area / cos(slope), summed cell by cell.
     · The EQUIVALENT UNIFORM SLOPE that ratio implies, next to the arithmetic
       mean of the raster's own slope values over the same cells.

   That last pair is the point of the tool. They are two independent routes to
   the same number — one from the areas, one from the derivatives — so when
   they agree the slope layer is behaving, and when they do not, the ground
   inside the polygon is not one wall and no single slope figure describes it.

   Nothing here writes to the model. A measurement is a question, not an edit.
   ============================================================ */
'use strict';

SM.Measure = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, fmtInt = SM.fmtInt;

  /* ------------------------------------------------------- formatting */
  /** metres, dropping the decimals once they stop meaning anything */
  function m(v) {
    if (v == null || v !== v) return '—';
    return (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)) + ' m';
  }
  function deg(v, signed) {
    if (v == null || v !== v) return '—';
    return (signed && v > 0 ? '+' : '') + v.toFixed(1) + '°';
  }
  function az(v) {
    if (v == null || v !== v) return '—';
    var a = Math.round(v) % 360;
    return (a < 10 ? '00' : a < 100 ? '0' : '') + a + '°';
  }
  /** square metres up to a hectare, then hectares — nobody reads 43 210 m² */
  function area(v) {
    if (v == null || v !== v) return '—';
    return v < 10000 ? fmt(v, 0) + ' m²' : fmt(v / 10000, 2) + ' ha';
  }

  /* ------------------------------------------------------- the numbers */
  /**
   * Everything derivable from the current point list.
   *
   * Rebuilt whole on each change rather than accumulated, because a Backspace
   * has to be able to take a leg back out and an accumulated total cannot.
   */
  function stats() {
    var g = S.grid, P = S.measure.pts;
    if (!g || P.length < 2) return null;
    var closed = S.measure.closed;
    var legs = [], nLeg = closed ? P.length : P.length - 1;
    var tPlan = 0, tSlope = 0, tGround = 0, rise = 0, fall = 0, gaps = 0;

    for (var k = 0; k < nLeg; k++) {
      var a = P[k], b = P[(k + 1) % P.length];
      var L = Grid.legStats(a[0], a[1], a[2], b[0], b[1], b[2]);
      var gl = Grid.groundLength(g, a[0], a[1], b[0], b[1]);
      L.ground = gl.length; gaps += gl.nGaps;
      legs.push(L);
      tPlan += L.plan; tSlope += L.slope; tGround += L.ground;
      if (L.dz > 0) rise += L.dz; else fall -= L.dz;
    }

    var first = P[0], last = P[P.length - 1];
    var direct = Grid.legStats(first[0], first[1], first[2], last[0], last[1], last[2]);

    var out = {
      n: P.length, closed: closed, legs: legs, gaps: gaps,
      planLength: tPlan, slopeLength: tSlope, groundLength: tGround,
      rise: rise, fall: fall, net: last[2] - first[2],
      direct: direct, surf: null, ringPlan: NaN
    };

    if (closed && P.length >= 3) {
      var ring = P.map(function (p) { return [p[0], p[1]]; });
      out.ringPlan = Math.abs(Grid.ringArea(ring));
      /* a bounding-box reject in front of the point-in-polygon test: the walk
         below visits every cell in the raster and most of them are nowhere near */
      var x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
      ring.forEach(function (p) {
        if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
        if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
      });
      out.surf = Grid.surfaceStats(g, S.der, function (x, y) {
        return x >= x1 && x <= x2 && y >= y1 && y <= y2 && Sens.pointInPoly(ring, x, y);
      });
    }
    return out;
  }

  /* ------------------------------------------------------- the panel */
  function render() {
    var panel = $('measurePanel'), body = $('measureBody'), head = $('measureCount');
    var P = S.measure.pts;
    if (!P.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    var st = stats();
    head.textContent = P.length + (P.length === 1 ? ' point' : ' points') +
      (S.measure.closed ? ' · closed' : '');
    if (!st) {
      body.innerHTML = '<div class="mHint">Click a second point to measure a distance.</div>';
      return;
    }

    var h = [];

    /* per-leg table, but only when there is more than one leg to compare */
    if (st.legs.length > 1) {
      h.push('<table class="mTable"><tr><th>#</th><th>bearing</th><th>plan</th>' +
        '<th>ΔRL</th><th>slope</th><th>incl</th></tr>');
      st.legs.forEach(function (L, i) {
        h.push('<tr><td>' + (i + 1) + '</td><td>' + az(L.bearing) + '</td><td>' + m(L.plan) +
          '</td><td>' + (L.dz > 0 ? '+' : '') + fmt(L.dz, 1) + '</td><td>' + m(L.slope) +
          '</td><td>' + deg(L.incline, true) + '</td></tr>');
      });
      h.push('</table>');
    } else {
      var L0 = st.legs[0];
      h.push(pair('bearing', az(L0.bearing)));
      h.push(pair('inclination', deg(L0.incline, true)));
    }

    h.push('<div class="mSep"></div>');
    h.push(pair('plan length', m(st.planLength)));
    h.push(pair('slope length', m(st.slopeLength)));
    /* the ground walk is the reason the ruler exists on broken terrain, so it
       carries the excess over the chord rather than leaving it to be worked out */
    h.push(pair('ground length', m(st.groundLength) +
      (st.slopeLength > 0
        ? ' <span class="mDim">×' + (st.groundLength / st.slopeLength).toFixed(2) + '</span>'
        : '')));
    h.push(pair('rise / fall', '+' + fmt(st.rise, 1) + ' / −' + fmt(st.fall, 1) + ' m'));

    if (!st.closed && st.legs.length > 1) {
      h.push('<div class="mSep"></div>');
      h.push(pair('first → last', az(st.direct.bearing) + ' · ' + m(st.direct.plan) +
        ' · ' + deg(st.direct.incline, true)));
    }
    if (st.gaps) {
      h.push('<div class="mWarn">' + st.gaps + ' sample' + (st.gaps === 1 ? '' : 's') +
        ' bridged a hole in the survey — the ground length is a floor, not a measurement.</div>');
    }

    if (st.closed && st.surf) {
      var s = st.surf;
      h.push('<div class="mSep"></div>');
      h.push(pair('plan area', area(st.ringPlan)));
      if (!s.cells) {
        h.push('<div class="mWarn">No raster cells inside — the polygon is smaller than one cell, ' +
          'or it is off the surveyed ground.</div>');
      } else {
        h.push(pair('surface area', area(s.surface) +
          ' <span class="mDim">×' + (s.surface / s.planCells).toFixed(2) + '</span>'));
        h.push(pair('cells counted', fmtInt(s.cells) +
          (s.noData ? ' <span class="mDim">+' + fmtInt(s.noData) + ' no-data</span>' : '')));
        h.push(pair('RL range', fmt(s.zmin, 1) + ' – ' + fmt(s.zmax, 1) +
          ' <span class="mDim">Δ' + fmt(s.zmax - s.zmin, 1) + '</span>'));
        h.push('<div class="mSep"></div>');
        /* the cross-check: two independent routes to the same slope */
        h.push(pair('slope, from areas', deg(s.equivSlope)));
        h.push(pair('slope, raster mean', deg(s.meanSlope) +
          ' <span class="mDim">' + deg(s.minSlope) + '–' + deg(s.maxSlope) + '</span>'));
        var gap = Math.abs(s.equivSlope - s.meanSlope);
        h.push('<div class="' + (gap > 5 ? 'mWarn' : 'mNote') + '">' + (gap > 5
          ? 'The two disagree by ' + gap.toFixed(1) + '° — the ground in here is not one wall, ' +
            'so no single slope figure describes it. Measure a smaller patch.'
          : 'The two agree to ' + gap.toFixed(1) + '°, so the slope layer is behaving over this patch.') +
          '</div>');
      }
    }

    body.innerHTML = h.join('');
  }

  function pair(k, v) {
    return '<div class="mRow"><span class="mKey">' + k + '</span><span class="mVal">' + v + '</span></div>';
  }

  /* ------------------------------------------------------- the tool */
  /* Arming is `Tools.set('measure')`, which clears any previous measurement on
     the way in; this is the guarded entry point for anything that wants to
     start one without going through the command registry. */
  function start() {
    if (!S.grid) { SM.status('Load a model first.'); return; }
    SM.Tools.set('measure');
  }

  function add(hit) {
    S.measure.pts.push([hit.x, hit.y, hit.z]);
    S.measure.closed = false;
    changed();
  }

  function undo() {
    if (!S.measure.pts.length) return;
    S.measure.pts.pop();
    S.measure.closed = false;
    changed();
  }

  /** `close` turns the chain into a ring, which is what unlocks the areas */
  function finish(close) {
    var P = S.measure.pts;
    if (P.length < 2) { SM.status('A measurement needs at least two points.'); return false; }
    if (close && P.length < 3) { SM.status('An area needs at least three points.'); return false; }
    S.measure.closed = !!close;
    changed();
    var st = stats();
    SM.status(close
      ? 'Area measured: ' + area(st.ringPlan) + ' in plan, ' +
        (st.surf && st.surf.cells ? area(st.surf.surface) + ' of surface' : 'no cells inside') + '.'
      : 'Measured ' + m(st.planLength) + ' in plan, ' + m(st.groundLength) + ' over the ground.');
    return true;
  }

  function clear() {
    S.measure.pts = [];
    S.measure.closed = false;
    changed();
  }

  /* The measurement stays on screen after the tool is put away — that is the
     whole point of taking one — so redrawing and re-rendering are the same
     step whether or not the tool is still armed. */
  function changed() {
    render();
    SM.Overlays.update();
    SM.Cmd.refresh();
  }

  /** the instruction strip, with the running answer in it */
  function banner() {
    var P = S.measure.pts;
    if (!P.length) return 'Click the first point to measure from  (Esc to cancel)';
    if (P.length === 1) return 'Click the next point  ·  Backspace undo  ·  Esc cancel';
    var st = stats();
    return P.length + ' points · ' + m(st.planLength) + ' plan · ' + m(st.groundLength) +
      ' ground · last leg ' + deg(st.legs[st.legs.length - 1].incline, true) +
      '  ·  Enter to finish  ·  click the first point to close an area  ·  Backspace undo';
  }

  function init() {
    $('measureClose').onclick = function () {
      clear();
      if (S.tool === 'measure') SM.Tools.set('identify');
    };
    /* a rebuilt raster invalidates the elevations the points were taken at */
    SM.on('model:built', clear);
  }

  return {
    init: init, start: start, add: add, undo: undo, finish: finish, clear: clear,
    stats: stats, render: render, banner: banner
  };
})();
