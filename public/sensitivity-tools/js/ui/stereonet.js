/* ============================================================
   ui/stereonet.js — the stereonet plot.

   One job: turn a `Struct.analyse` result into a lower-hemisphere projection
   on a 2D canvas, and say what is under the cursor. It holds no state of its
   own — `draw(canvas, model)` is given everything it needs and stashes the
   screen position of every symbol it painted on the model, so `hitAt` can
   answer without re-deriving anything.

   Reading the plot, for anyone who has not used one:

     · the outer circle is the horizon; the centre is straight down
     · a PLANE is a great circle — the arc it would cut through a bowl. A
       steep plane draws close to the diameter, a flat one hugs the perimeter
     · a POLE is the plane's normal, one dot instead of an arc
     · an INTERSECTION is where two great circles cross: the wedge axis, the
       direction the block would slide
     · the shading is the critical zone of the failure mode chosen in the
       panel — red primary, amber secondary — and what falls inside it is
       whichever population that mode tests: intersections for wedge sliding
       and direct toppling, poles for planar sliding and flexural toppling.
       The dashed curves are the constructions it is cut from (the daylight
       envelope, the slip limit, the friction cone) and the two straight lines
       across the net are the lateral limits

   The plot is deliberately unclipped by the terrain: it describes orientations,
   not places. What happens in a particular place is the 3D view's job.
   ============================================================ */
'use strict';

SM.Net = (function () {

  var DEG = Math.PI / 180;
  /* symbols smaller than this cannot be aimed at with a mouse, so the hit
     radius is held here rather than being tied to the drawn dot size */
  var HIT = 9;

  function col(name, fallback) { return SM.cssVar(name, fallback); }

  /* ------------------------------------------------------- geometry */
  /** the plot frame: centre and radius in CSS pixels, with room for labels */
  function frame(canvas) {
    var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    var pad = 18;
    var r = Math.max(20, Math.min(w, h) / 2 - pad);
    return { cx: w / 2, cy: h / 2, r: r, w: w, h: h };
  }

  function place(F, p) { return [F.cx + p[0] * F.r, F.cy + p[1] * F.r]; }

  function toScreen(F, trend, plunge, equalArea) {
    return place(F, Struct.project(trend, plunge, equalArea));
  }

  /**
   * A cone about a horizontal axis — the small circles of the underlying net.
   * Only the lower half of each cone is visible, so the sampled curve is cut
   * into runs wherever it crosses the horizon rather than drawn as one stroke
   * that would jump across the plot.
   */
  function smallCircle(axis, halfAngle, equalArea, steps) {
    var a = halfAngle * DEG, ca = Math.cos(a), sa = Math.sin(a);
    /* two directions perpendicular to the axis */
    var e1 = Struct.norm(Struct.cross(axis, [0, 0, 1])) || [1, 0, 0];
    var e2 = Struct.norm(Struct.cross(axis, e1));
    var runs = [], cur = [], N = steps || 181;
    for (var i = 0; i < N; i++) {
      var t = 2 * Math.PI * i / (N - 1), c = Math.cos(t), s = Math.sin(t);
      var v = [
        axis[0] * ca + (e1[0] * c + e2[0] * s) * sa,
        axis[1] * ca + (e1[1] * c + e2[1] * s) * sa,
        axis[2] * ca + (e1[2] * c + e2[2] * s) * sa
      ];
      if (v[2] > 1e-9) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
      var L = Struct.vecToLine(v);
      if (L) cur.push(Struct.project(L.trend, L.plunge, equalArea));
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  }

  /* ------------------------------------------------------- painting */
  function poly(g, F, pts, close) {
    if (!pts || !pts.length) return;
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var s = place(F, pts[i]);
      if (i) g.lineTo(s[0], s[1]); else g.moveTo(s[0], s[1]);
    }
    if (close) g.closePath();
  }

  function dot(g, s, r, fill, stroke) {
    g.beginPath();
    g.arc(s[0], s[1], r, 0, 2 * Math.PI);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.4; g.stroke(); }
  }

  /** a hollow square, the conventional symbol for a line of intersection */
  function square(g, s, r, fill, stroke) {
    g.beginPath();
    g.rect(s[0] - r, s[1] - r, 2 * r, 2 * r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.4; g.stroke(); }
  }

  /**
   * Paint the whole plot.
   *
   * model = {
   *   planes   : [{name, dip, dipDir, on, color}]
   *   face     : {dip, dipDir}          the slope being assessed
   *   phi      : friction angle, degrees
   *   mode     : failure mode id — decides which zones are shaded and which
   *              way round the friction cone is measured
   *   limit    : lateral limits in degrees, or null where the mode has none
   *   result   : Struct.analyse(...) or null
   *   show     : {net, zones, cone, faceGC, planes, poles, ints, labels}
   *   equalArea: false = Wulff (Dips default), true = Schmidt
   *   hi       : {kind, index} — the row hovered in the tables, drawn lit
   * }
   */
  function draw(canvas, model) {
    var g = canvas.getContext('2d');
    var F = frame(canvas), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(F.w * dpr);
    canvas.height = Math.round(F.h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, F.w, F.h);

    var show = model.show || {}, ea = !!model.equalArea;
    var hits = { ints: [], poles: [] };

    /* ---- the disc ---- */
    g.beginPath();
    g.arc(F.cx, F.cy, F.r, 0, 2 * Math.PI);
    g.fillStyle = col('--panel', '#1c222b');
    g.fill();

    /* ---- underlying net ---- */
    if (show.net) {
      g.save();
      g.beginPath(); g.arc(F.cx, F.cy, F.r, 0, 2 * Math.PI); g.clip();
      g.strokeStyle = col('--line', '#2c3542');
      g.lineWidth = 1;
      g.globalAlpha = 0.9;
      for (var d = 10; d < 90; d += 10) {
        poly(g, F, Struct.greatCircle(d, 90, 121, ea)); g.stroke();
        poly(g, F, Struct.greatCircle(d, 270, 121, ea)); g.stroke();
      }
      for (var a = 10; a < 180; a += 10) {
        smallCircle([0, 1, 0], a, ea, 181).forEach(function (run) { poly(g, F, run); g.stroke(); });
      }
      g.restore();
    }

    /* ---- critical zones, under everything else ----
       Every shape comes from Struct.zones, built out of the same inequalities
       the results table classifies with. The plot holds no rules of its own:
       whatever the mode is, this paints what it was handed. */
    var Z = model.face
      ? Struct.zones(model.mode, model.face, model.phi, model.limit, ea)
      : null;
    if (show.zones && Z) {
      g.fillStyle = col('--warn', '#ffb300');
      g.globalAlpha = 0.16;
      Z.secondary.forEach(function (lobe) { poly(g, F, lobe, true); g.fill(); });
      g.fillStyle = col('--bad', '#ff5252');
      g.globalAlpha = 0.24;
      Z.primary.forEach(function (p) { poly(g, F, p, true); g.fill(); });
      g.globalAlpha = 1;

      /* the constructions the zones are cut from — the daylight envelope, the
         slip limit, the slope-angle circle — drawn thin so the boundary can be
         read off the plot rather than taken on trust */
      g.save();
      g.setLineDash([4, 3]);
      g.strokeStyle = col('--warn', '#ffb300');
      g.lineWidth = 1.2;
      Z.curves.forEach(function (c) { poly(g, F, c.pts); g.stroke(); });
      Z.circles.forEach(function (c) {
        g.beginPath();
        g.arc(F.cx, F.cy, F.r * Struct.plungeRadius(c.plunge, ea), 0, 2 * Math.PI);
        g.stroke();
      });
      /* the lateral limits: two full lines across the net, as in Dips */
      g.strokeStyle = col('--dim2', '#6d7887');
      Z.diameters.forEach(function (t) {
        var ux = Math.sin(t * DEG), uy = -Math.cos(t * DEG);
        g.beginPath();
        g.moveTo(F.cx - ux * F.r, F.cy - uy * F.r);
        g.lineTo(F.cx + ux * F.r, F.cy + uy * F.r);
        g.stroke();
      });
      g.restore();

      /* Dips' zone numbers. Direct toppling has three regions in two colours —
         one of them is primary for an intersection and secondary for a pole —
         so the shading alone cannot say which is which. */
      if (Z.labels.length) {
        g.font = '10px Segoe UI, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        Z.labels.forEach(function (L) {
          var s = toScreen(F, L.trend, L.plunge, ea);
          g.fillStyle = col('--panel', '#1c222b');
          g.globalAlpha = 0.75;
          g.beginPath(); g.arc(s[0], s[1], 7, 0, 2 * Math.PI); g.fill();
          g.globalAlpha = 1;
          g.fillStyle = col('--dim', '#8f9bab');
          g.fillText(L.text, s[0], s[1]);
        });
      }
    }

    /* ---- friction cone. For a line it is φ measured in from the rim; for a
       pole it is φ from the centre, and drawing the wrong one puts the circle
       in the mirror-image place. The mode decides. ---- */
    if (show.cone) {
      g.save();
      g.setLineDash([5, 4]);
      g.strokeStyle = col('--bad', '#ff5252');
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(F.cx, F.cy, F.r * Struct.plungeRadius(Struct.coneFor(model.mode, model.phi).plunge, ea),
        0, 2 * Math.PI);
      g.stroke();
      g.restore();
    }

    /* ---- the slope face ---- */
    if (show.faceGC && model.face) {
      g.strokeStyle = col('--warn', '#ffb300');
      g.lineWidth = 2.4;
      poly(g, F, Struct.greatCircle(model.face.dip, model.face.dipDir, 181, ea));
      g.stroke();
    }

    /* ---- the discontinuities ----
       Under a pole mode the poles ARE the result, so each one is filled with
       the zone it landed in and outlined in the plane's own colour: the
       identity stays readable, and which of them matter is visible without
       reading the table. */
    var poleZone = {};
    if (model.result && model.result.poles && model.result.poles.length) {
      model.result.poles.forEach(function (e) {
        var k = (model.planes || []).indexOf(e.p);
        if (k >= 0) poleZone[k] = e.zone;
      });
    }
    (model.planes || []).forEach(function (P, i) {
      if (P.on === false) return;
      var lit = model.hi && model.hi.kind === 'plane' && model.hi.index === i;
      var c = P.color || col('--acc', '#2f9bff');
      if (show.planes) {
        g.strokeStyle = c;
        g.lineWidth = lit ? 3 : 1.6;
        g.globalAlpha = lit ? 1 : 0.9;
        poly(g, F, Struct.greatCircle(P.dip, P.dipDir, 181, ea));
        g.stroke();
        g.globalAlpha = 1;
      }
      if (show.poles) {
        var pl = Struct.pole(P.dip, P.dipDir);
        var s = toScreen(F, pl.trend, pl.plunge, ea);
        var pz = poleZone[i];
        var fill = pz === 'primary' ? col('--bad', '#ff5252')
          : pz === 'secondary' ? col('--warn', '#ffb300') : c;
        dot(g, s, lit ? 5.5 : (pz === 'primary' ? 5 : 4), fill,
          pz && pz !== 'none' ? c : col('--bg', '#12161c'));
        hits.poles.push({ x: s[0], y: s[1], index: i });
      }
    });

    /* ---- lines of intersection ---- */
    if (show.ints && model.result) {
      model.result.pairs.forEach(function (p, i) {
        var s = toScreen(F, p.trend, p.plunge, ea);
        var lit = model.hi && model.hi.kind === 'pair' && model.hi.index === i;
        var fill = p.zone === 'primary' ? col('--bad', '#ff5252')
          : p.zone === 'secondary' ? col('--warn', '#ffb300')
            : col('--panel2', '#222a34');
        square(g, s, lit ? 6 : 4.2, fill, lit ? col('--fg', '#e6ebf2') : col('--bg', '#12161c'));
        hits.ints.push({ x: s[0], y: s[1], index: i });
      });
    }

    /* ---- rim, ticks and cardinal labels, last so nothing overdraws them ---- */
    g.strokeStyle = col('--line2', '#3a4553');
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(F.cx, F.cy, F.r, 0, 2 * Math.PI); g.stroke();
    g.strokeStyle = col('--dim2', '#6d7887');
    g.lineWidth = 1;
    for (var t = 0; t < 360; t += 10) {
      var len = (t % 90 === 0) ? 7 : (t % 30 === 0 ? 5 : 3);
      var ux = Math.sin(t * DEG), uy = -Math.cos(t * DEG);
      g.beginPath();
      g.moveTo(F.cx + ux * F.r, F.cy + uy * F.r);
      g.lineTo(F.cx + ux * (F.r - len), F.cy + uy * (F.r - len));
      g.stroke();
    }
    /* centre cross — the vertical, easy to lose once the net is on */
    g.strokeStyle = col('--dim2', '#6d7887');
    g.beginPath();
    g.moveTo(F.cx - 4, F.cy); g.lineTo(F.cx + 4, F.cy);
    g.moveTo(F.cx, F.cy - 4); g.lineTo(F.cx, F.cy + 4);
    g.stroke();

    g.fillStyle = col('--dim', '#8f9bab');
    g.font = '10px ' + 'Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (L) {
      var ux = Math.sin(L[1] * DEG), uy = -Math.cos(L[1] * DEG);
      g.fillText(L[0], F.cx + ux * (F.r + 10), F.cy + uy * (F.r + 10));
    });

    model._hits = hits;
    model._frame = F;
    return F;
  }

  /**
   * What is under the pointer. Whichever population the mode is actually
   * testing wins when both are in reach — under planar sliding the poles are
   * the analysis, and under wedge sliding the intersections are.
   */
  function hitAt(model, px, py) {
    var h = model._hits;
    if (!h) return null;
    var poleFirst = model.result && model.result.plots === 'poles';
    function nearest(list, kind) {
      var best = null;
      for (var i = 0; i < list.length; i++) {
        var d = Math.hypot(list[i].x - px, list[i].y - py);
        if (d <= HIT && (!best || d < best.dist)) best = { kind: kind, index: list[i].index, dist: d };
      }
      return best;
    }
    return poleFirst
      ? (nearest(h.poles, 'plane') || nearest(h.ints, 'pair'))
      : (nearest(h.ints, 'pair') || nearest(h.poles, 'plane'));
  }

  /** the trend/plunge the cursor is sitting on, for a live read-out */
  function orientationAt(model, px, py) {
    var F = model._frame;
    if (!F) return null;
    var dx = (px - F.cx) / F.r, dy = (py - F.cy) / F.r;
    var r = Math.hypot(dx, dy);
    if (r > 1.0001) return null;
    /* invert the projection: r = tan((90-p)/2) or sqrt2 sin((90-p)/2) */
    var half = model.equalArea
      ? Math.asin(Math.max(-1, Math.min(1, r / Math.SQRT2)))
      : Math.atan(r);
    var plunge = 90 - 2 * half / DEG;
    var trend = Struct.wrap360(Math.atan2(dx, -dy) / DEG);
    return { trend: trend, plunge: Math.max(0, Math.min(90, plunge)) };
  }

  return { draw: draw, hitAt: hitAt, orientationAt: orientationAt, smallCircle: smallCircle };
})();
