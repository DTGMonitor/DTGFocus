/* ============================================================
   structure.js — discontinuity geometry, stereographic projection and the
   kinematic failure tests.

   Everything here is pure geometry on the same axes the rest of the tool
   uses: x = east, y = north, z = up, angles in degrees, azimuths clockwise
   from grid north. No DOM, no state — the panel in ui/structure.js and the
   stereonet in ui/stereonet.js both read from this and nothing else, so the
   maths can be tested headlessly (tests/test_structure.js).

   Conventions, spelled out because half the mistakes in kinematic analysis
   are sign errors in one of them:

     plane      dip δ (0…90 below horizontal) + dip direction α (azimuth the
                plane falls towards).  Its UPWARD unit normal is
                  n = (sin α sin δ, cos α sin δ, cos δ)
     pole       the same normal taken downwards, which is what a lower-
                hemisphere stereonet plots: trend α+180, plunge 90−δ
     line       trend θ + plunge p (p ≥ 0 downwards), unit vector
                  v = (sin θ cos p, cos θ cos p, −sin p)
     wedge      the line of intersection of two planes = n₁ × n₂, flipped to
                point down.  This is the direction a wedge slides when it
                slides on both planes at once, and it is exactly the "cross
                product of two intersecting fault planes".

   The stereonet is LOWER HEMISPHERE. Equal-angle (Wulff) is the default,
   because that is what Dips uses for kinematic analysis; equal-area
   (Schmidt) is offered for pole density work where it is the honest choice.
   ============================================================ */
'use strict';

var Struct = (function () {

  var DEG = Math.PI / 180;
  /* A plane at exactly 90° has an infinite tangent; every apparent-dip
     formula below would return NaN for it. Vertical structures are real and
     common, so they are pulled a hundredth of a degree off vertical rather
     than allowed to poison a whole results table. */
  var MAX_DIP = 89.99;

  function clampDip(d) { return Math.max(0, Math.min(MAX_DIP, +d || 0)); }
  function wrap360(a) { a = a % 360; return a < 0 ? a + 360 : a; }
  /** signed difference a−b folded into −180…180 */
  function angDiff(a, b) { var d = wrap360(a - b); return d > 180 ? d - 360 : d; }

  /* ------------------------------------------------------ vectors */
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(v) {
    var L = Math.sqrt(dot(v, v));
    return L < 1e-12 ? null : [v[0] / L, v[1] / L, v[2] / L];
  }

  /** upward unit normal of a plane */
  function planeNormal(dip, dipDir) {
    var d = dip * DEG, a = dipDir * DEG, s = Math.sin(d);
    return [Math.sin(a) * s, Math.cos(a) * s, Math.cos(d)];
  }

  /**
   * How much shorter a mapped patch is down dip than along strike.
   *
   * Lives here rather than in the drawing code because it is not decoration
   * any more: once two patches are tested for whether they actually meet, this
   * number is part of the answer.
   */
  var DIP_ASPECT = 0.62;

  /** the horizontal line in the plane — its strike, as a unit vector */
  function strikeVector(dipDir) {
    var s = (dipDir - 90) * DEG;
    return [Math.sin(s), Math.cos(s), 0];
  }

  /** the plane's steepest downhill line — the direction it would slide on its own */
  function dipVector(dip, dipDir) {
    var d = dip * DEG, a = dipDir * DEG, c = Math.cos(d);
    return [Math.sin(a) * c, Math.cos(a) * c, -Math.sin(d)];
  }

  /** trend + plunge → downward unit vector (identical convention to Sens.customVec) */
  function lineVec(trend, plunge) {
    var t = trend * DEG, p = plunge * DEG, c = Math.cos(p);
    return [Math.sin(t) * c, Math.cos(t) * c, -Math.sin(p)];
  }

  /** any vector → the trend/plunge of the downward end of the same line */
  function vecToLine(v) {
    var u = norm(v);
    if (!u) return null;
    if (u[2] > 0) u = [-u[0], -u[1], -u[2]];
    return {
      trend: wrap360(Math.atan2(u[0], u[1]) / DEG),
      plunge: Math.asin(Math.max(-1, Math.min(1, -u[2]))) / DEG
    };
  }

  /** any normal → the plane it belongs to */
  function normalToPlane(n) {
    var u = norm(n);
    if (!u) return null;
    if (u[2] < 0) u = [-u[0], -u[1], -u[2]];
    return {
      dip: Math.acos(Math.max(-1, Math.min(1, u[2]))) / DEG,
      dipDir: wrap360(Math.atan2(u[0], u[1]) / DEG)
    };
  }

  /** the plane's pole as a lower-hemisphere line */
  function pole(dip, dipDir) {
    return { trend: wrap360(dipDir + 180), plunge: 90 - clampDip(dip) };
  }

  /**
   * Apparent dip of a plane measured along a horizontal bearing.
   *
   *      tan(apparent) = tan(dip) · cos(bearing − dip direction)
   *
   * Negative means the bearing points INTO the face rather than out of it —
   * the caller has to test the sign, not just the magnitude, or a structure
   * dipping into the wall reads as if it daylighted out of it.
   */
  function apparentDip(dip, dipDir, trend) {
    var c = Math.cos(angDiff(trend, dipDir) * DEG);
    if (Math.abs(c) < 1e-12) return 0;
    return Math.atan(Math.tan(clampDip(dip) * DEG) * c) / DEG;
  }

  /**
   * Line of intersection of two planes — the wedge axis.
   * Returns null when the planes are parallel (nothing intersects).
   */
  function intersection(a, b) {
    var L = cross(planeNormal(clampDip(a.dip), a.dipDir), planeNormal(clampDip(b.dip), b.dipDir));
    if (Math.sqrt(dot(L, L)) < 1e-9) return null;        // parallel or coincident
    return vecToLine(L);
  }

  /**
   * Where two MAPPED patches actually meet, if they meet at all.
   *
   * `intersection` above answers a question about orientations: two planes at
   * these attitudes cross along this bearing. That is what a stereonet knows
   * and all it can know. But a wedge needs two surfaces that are in contact
   * somewhere in the pit, and two structures mapped four hundred metres apart
   * form no wedge however their poles plot. This is the test the stereonet
   * cannot make: it clips the line of intersection of the two infinite planes
   * to both finite patches and reports the segment that survives, or null.
   *
   * A patch is `{anchor, dip, dipDir, w, h}` — half its strike length and half
   * its down-dip height — so what counts as "meeting" is the extent the plane
   * was actually drawn with. That is the honest reading: the size is the
   * operator's statement of how far the structure runs.
   */
  function patchIntersection(a, b) {
    if (!a || !b || !a.anchor || !b.anchor) return null;
    var nA = planeNormal(clampDip(a.dip), a.dipDir);
    var nB = planeNormal(clampDip(b.dip), b.dipDir);
    var d = cross(nA, nB), dd = dot(d, d);
    if (dd < 1e-12) return null;                       // parallel: never meet
    var dLen = Math.sqrt(dd);

    /* a point on both planes: the standard construction, and the reason it is
       written out rather than solved is that it needs no matrix inverse and
       degrades gracefully as the two planes approach parallel */
    var cA = dot(nA, a.anchor), cB = dot(nB, b.anchor);
    var u1 = cross(nB, d), u2 = cross(d, nA);
    var P0 = [
      (cA * u1[0] + cB * u2[0]) / dd,
      (cA * u1[1] + cB * u2[1]) / dd,
      (cA * u1[2] + cB * u2[2]) / dd
    ];

    /* clip the line to each patch in turn, as a running interval in t */
    var lo = -Infinity, hi = Infinity;
    if (!clip(a) || !clip(b)) return null;
    if (!(hi - lo > 1e-9)) return null;                // they touch at a point at most

    return {
      p1: at(lo), p2: at(hi), length: (hi - lo) * dLen,
      /* the same line the stereonet plots, so the two can be checked against
         each other rather than trusted separately */
      line: vecToLine(d)
    };

    function at(t) { return [P0[0] + d[0] * t, P0[1] + d[1] * t, P0[2] + d[2] * t]; }

    function clip(p) {
      var rel = [P0[0] - p.anchor[0], P0[1] - p.anchor[1], P0[2] - p.anchor[2]];
      return slab(strikeVector(p.dipDir), p.w) &&
        slab(dipVector(clampDip(p.dip), p.dipDir), p.h);

      function slab(e, half) {
        var o = dot(e, rel), s = dot(e, d);
        if (Math.abs(s) < 1e-12) return Math.abs(o) <= half;   // parallel to this pair of edges
        var t0 = (-half - o) / s, t1 = (half - o) / s;
        if (t0 > t1) { var sw = t0; t0 = t1; t1 = sw; }
        if (t0 > lo) lo = t0;
        if (t1 < hi) hi = t1;
        return hi > lo;
      }
    }
  }

  /**
   * Where a shared segment sits relative to the ground — and therefore whether
   * there is any rock in the wedge at all.
   *
   * Two patches can be in contact and still bound nothing: they cross in the
   * AIR, out beyond the face, and the "wedge" between them is a wedge of sky.
   * That pair is critical on the stereonet, in contact on the model, and no
   * risk of anything. Nothing above can tell them apart, because nothing above
   * has looked at the terrain.
   *
   * `surfaceZ(x, y)` gives the ground level, or NaN off the survey. The segment
   * is walked and split where it crosses:
   *
   *   air        every part of it stands above the ground. No rock, no wedge.
   *   rock       all of it is buried inside the mapped extents. There IS rock,
   *              but the line does not reach the face here — the patches are
   *              too small to show where it would, so extend them and look again.
   *   daylight   it crosses. Rock behind, an exit at the front: the real thing.
   *   unknown    the segment is off the surveyed ground entirely.
   *
   * `runs` comes back with it so the two halves can be drawn differently —
   * seeing the line hang in the air is the quickest possible explanation of
   * why a critical pair was set aside.
   */
  function segmentInRock(seg, surfaceZ, steps) {
    if (!seg || typeof surfaceZ !== 'function') return null;
    var N = Math.max(8, steps || 64);
    var p1 = seg.p1, p2 = seg.p2;
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    var full = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var lenRock = 0, lenAir = 0, known = 0;
    var runs = [], cur = null, day = null;
    var prevIn = null, prevT = 0;

    for (var k = 0; k <= N; k++) {
      var t = k / N;
      var x = p1[0] + dx * t, y = p1[1] + dy * t, z = p1[2] + dz * t;
      var zt = surfaceZ(x, y);
      var inRock = (zt === zt) ? (z <= zt) : null;
      if (inRock !== null) known++;
      if (k > 0 && prevIn !== null && inRock !== null) {
        var seglen = full / N;
        if (inRock) lenRock += seglen; else lenAir += seglen;
        /* the crossing, by linear interpolation between the two samples */
        if (inRock !== prevIn && !day) {
          var f = 0.5;                       // half a step is inside the sampling error anyway
          var tt = prevT + (t - prevT) * f;
          day = [p1[0] + dx * tt, p1[1] + dy * tt, p1[2] + dz * tt];
        }
      }
      if (inRock !== prevIn) {
        if (cur) { cur.b = [x, y, z]; runs.push(cur); }
        cur = inRock === null ? null : { a: [x, y, z], b: [x, y, z], rock: inRock };
      } else if (cur) cur.b = [x, y, z];
      prevIn = inRock; prevT = t;
    }
    if (cur) runs.push(cur);

    var status = !known ? 'unknown'
      : (lenRock > 0 && lenAir > 0) ? 'daylight'
        : lenRock > 0 ? 'rock' : 'air';
    return {
      status: status, lenRock: lenRock, lenAir: lenAir,
      daylight: status === 'daylight' ? day : null, runs: runs
    };
  }

  /* -------------------------------------------------- best-fit plane */
  /** symmetric 3×3 eigen-decomposition by cyclic Jacobi — small, exact enough,
      and it avoids pulling in a matrix library for nine numbers */
  function jacobi3(m) {
    var a = [m[0].slice(), m[1].slice(), m[2].slice()];
    var v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (var sweep = 0; sweep < 24; sweep++) {
      var off = a[0][1] * a[0][1] + a[0][2] * a[0][2] + a[1][2] * a[1][2];
      if (off < 1e-24) break;
      for (var p = 0; p < 2; p++) for (var q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        var theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        var t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        var c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (var k = 0; k < 3; k++) {
          var akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (k = 0; k < 3; k++) {
          var apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
          var vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
        }
      }
    }
    return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
  }

  /**
   * Least-squares plane through three or more points, as dip / dip direction.
   *
   * `pts` is [[x,y,z], …] in survey coordinates. The normal is the eigenvector
   * of the smallest eigenvalue of the centred covariance — the direction the
   * points vary least along. `rms` is the scatter about that plane in metres,
   * which is the number that says whether the picks really were coplanar:
   * three clicks always fit perfectly, ten clicks along a fault trace do not.
   */
  function fitPlane(pts) {
    if (!pts || pts.length < 3) return null;
    var n = pts.length, cx = 0, cy = 0, cz = 0, i;
    for (i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1]; cz += pts[i][2]; }
    cx /= n; cy /= n; cz /= n;
    var m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (i = 0; i < n; i++) {
      var dx = pts[i][0] - cx, dy = pts[i][1] - cy, dz = pts[i][2] - cz;
      m[0][0] += dx * dx; m[0][1] += dx * dy; m[0][2] += dx * dz;
      m[1][1] += dy * dy; m[1][2] += dy * dz; m[2][2] += dz * dz;
    }
    m[1][0] = m[0][1]; m[2][0] = m[0][2]; m[2][1] = m[1][2];
    var e = jacobi3(m), k = 0;
    for (i = 1; i < 3; i++) if (e.values[i] < e.values[k]) k = i;
    var nv = norm([e.vectors[0][k], e.vectors[1][k], e.vectors[2][k]]);
    if (!nv) return null;
    var pl = normalToPlane(nv);
    var ss = 0;
    for (i = 0; i < n; i++) {
      var d = (pts[i][0] - cx) * nv[0] + (pts[i][1] - cy) * nv[1] + (pts[i][2] - cz) * nv[2];
      ss += d * d;
    }
    pl.rms = Math.sqrt(ss / n);
    pl.centre = [cx, cy, cz];
    pl.n = n;
    return pl;
  }

  /**
   * Mean orientation of a bundle of surface normals — the vector mean, not the
   * arithmetic mean of the angles, which would wrap wrongly near north.
   * `pick(i)` returns [nx,ny,nz] for member i, or null to skip it.
   * Returns the plane plus `R`, the resultant length 0…1: near 1 the wall has
   * one orientation, near 0 it is a bowl and no single "slope face" describes it.
   */
  function meanNormal(count, pick) {
    var sx = 0, sy = 0, sz = 0, m = 0;
    for (var i = 0; i < count; i++) {
      var v = pick(i);
      if (!v) continue;
      var u = norm(v);
      if (!u) continue;
      if (u[2] < 0) u = [-u[0], -u[1], -u[2]];       // all normals taken upwards
      sx += u[0]; sy += u[1]; sz += u[2]; m++;
    }
    if (!m) return null;
    var R = Math.sqrt(sx * sx + sy * sy + sz * sz) / m;
    var pl = normalToPlane([sx, sy, sz]);
    if (!pl) return null;
    pl.R = R; pl.n = m;
    return pl;
  }

  /* ============================================================
     Stereographic projection — lower hemisphere.

     A line of plunge p plots at radius r from the centre of a unit disc:
       equal-angle (Wulff)   r = tan((90−p)/2)
       equal-area (Schmidt)  r = √2 · sin((90−p)/2)
     Both are normalised so the horizon (p = 0) lands on r = 1. Screen
     placement is north up, east right: x = r sin θ, y = −r cos θ, and the
     caller scales by the plot radius.
     ============================================================ */
  /** trend/plunge → [x, y] on a unit disc, north up and east right */
  function project(trend, plunge, equalArea) {
    var h = (90 - Math.max(0, Math.min(90, plunge))) / 2 * DEG;
    var r = equalArea ? Math.SQRT2 * Math.sin(h) : Math.tan(h);
    var t = trend * DEG;
    return [r * Math.sin(t), -r * Math.cos(t)];
  }

  /** the radius the horizon-relative plunge circle sits at — the friction cone */
  function plungeRadius(plunge, equalArea) {
    var h = (90 - Math.max(0, Math.min(90, plunge))) / 2 * DEG;
    return equalArea ? Math.SQRT2 * Math.sin(h) : Math.tan(h);
  }

  /**
   * A plane's great circle as a polyline on the unit disc.
   *
   * Parametrised inside the plane rather than by sampling trends, so it stays
   * exact at every dip: e₁ is the strike direction, e₂ the dip vector, and
   * e₁cos t + e₂sin t sweeps the whole lower half in one continuous arc for
   * t ∈ [0, π] — no hemisphere flip to stitch across, and a vertical plane
   * degenerates gracefully into the diameter it should be.
   */
  function greatCircle(dip, dipDir, steps, equalArea) {
    var d = clampDip(dip), N = steps || 121;
    var s = (dipDir - 90) * DEG;
    var e1 = [Math.sin(s), Math.cos(s), 0];
    var e2 = dipVector(d, dipDir);
    var out = [];
    for (var i = 0; i < N; i++) {
      var t = Math.PI * i / (N - 1);
      var c = Math.cos(t), q = Math.sin(t);
      var L = vecToLine([e1[0] * c + e2[0] * q, e1[1] * c + e2[1] * q, e1[2] * c + e2[2] * q]);
      if (L) out.push(project(L.trend, L.plunge, equalArea));
    }
    return out;
  }

  /* ============================================================
     Kinematic analysis.

     Following Dips: the slope face is one plane (dip / dip direction), the
     friction angle φ is shared by every joint surface, and each mode runs its
     test on one of two populations — the LINES OF INTERSECTION of every
     enabled pair of planes, or the POLES of the planes themselves.

     All five Dips modes are here. Which population each uses, and whether the
     LATERAL LIMITS apply, is declared in MODES below and dispatched in
     `analyse`; the individual tests are `wedgeZone`, `planarZone`,
     `flexuralZone`, `directZone` and `baseZone`, each with the Dips criteria
     written out above it. The critical zones they describe are turned into
     polygons for the stereonet by `zones`, from the same inequalities — the
     shading and the answers cannot disagree, because there is one statement of
     each rule.

     Wedge sliding, verbatim from the Dips documentation:
       · primary critical zone   — inside the plane friction cone and outside
         the slope plane. Those wedges slide on both planes, down the line of
         intersection.
       · secondary critical zone — the area between the slope plane and a
         great circle inclined at the friction angle, one lobe either side of
         the primary zone. The intersection there is flatter than φ, but a
         single joint whose dip vector is steeper than φ can still slide, so
         the movement direction is that joint's dip vector, not the wedge axis.
       · no lateral limits are applied — the second plane frees the wedge to
         release across the full lateral range.

     "Outside the slope plane" is the daylighting test written as an
     inequality: a line plots outside the slope's great circle exactly when it
     is aimed out of the face (within ±90° of the dip direction) and plunges
     less steeply than the face's apparent dip along its own trend.
     ============================================================ */

  /**
   * What a pair amounts to on the ground, in one word.
   *
   * Six states, ranked by how much of a wedge is really there. One function
   * decides it, and the sort, the results table and the divider between them
   * all read from here — a table that ordered itself by one rule and labelled
   * itself by another would be worse than either.
   *
   *   daylight  rock behind the face and the line reaches it: releasable
   *   rock      rock, but the line stays buried inside the mapped extents
   *   contact   the two touch; no surface loaded, so the rock cannot be judged
   *   unknown   a plane has no location, or the line is off the surveyed ground
   *   air       they cross in front of the face. No rock between them at all
   *   apart     as mapped, they never touch
   *
   * `unknown` sits above `air`, deliberately: not knowing is not the same as
   * knowing there is nothing, and burying an untested pair under a ruled-out
   * one would hide the very thing that needs a location adding.
   */
  var CONTACT_RANK = { daylight: 0, rock: 1, contact: 2, unknown: 3, air: 4, apart: 5 };

  function contactState(pair) {
    if (!pair) return 'unknown';
    if (pair.contact === false) return 'apart';
    if (pair.contact === null) return 'unknown';
    if (!pair.rock) return 'contact';
    return CONTACT_RANK[pair.rock.status] == null ? 'unknown' : pair.rock.status;
  }

  /** true when the pair bounds no rock at all — the bottom band of the table */
  function isEmptyWedge(pair) {
    return CONTACT_RANK[contactState(pair)] >= CONTACT_RANK.air;
  }

  /**
   * The failure modes, in Dips' own order.
   *
   *   plots   which population the mode counts. 'intersections' tests every
   *           pair of planes, 'poles' tests every plane on its own, 'both'
   *           needs the two together — direct toppling is the only one, and it
   *           is the reason this field exists rather than a boolean.
   *   limits  whether LATERAL LIMITS apply. Planar sliding, flexural toppling
   *           and direct toppling all restrict the critical zone to structures
   *           squarely enough aligned with the wall to break out of it; wedge
   *           sliding is the one mode with none, because the second plane
   *           frees the block sideways by itself.
   */
  var MODES = [
    { id: 'wedge', name: 'Wedge sliding', plots: 'intersections', limits: false,
      hint: 'Every pair of planes is intersected; the wedge slides down that line of intersection.' },
    { id: 'planar', name: 'Planar sliding', plots: 'poles', limits: true,
      hint: 'Each plane on its own: a slab daylights out of the face, dips steeper than φ, ' +
        'and strikes near enough parallel to the wall to release.' },
    { id: 'planarNL', name: 'Planar sliding (no limits)', plots: 'poles', limits: false,
      hint: 'The same test with the lateral limits turned off — the whole daylight envelope ' +
        'counts. This is the Markland test.' },
    { id: 'flexural', name: 'Flexural toppling', plots: 'poles', limits: true,
      hint: 'Steep layers dipping INTO the face, free to slip against one another and bend ' +
        'out of the wall. Goodman’s slip limit: the layer normal must be flatter than φ above the slope.' },
    { id: 'direct', name: 'Direct toppling', plots: 'both', limits: true,
      hint: 'Two joint sets whose intersections dip into the face cut discrete blocks; a third ' +
        'set gives them a base to topple over. Intersections AND base-plane poles are both tested.' }
  ];

  /** the usual lateral limit — Dips suggests 20° to 30°, and 20 is its default */
  var LIMIT = 20;

  function modeOf(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return MODES[0];
  }

  /** how far off an axis a bearing lies, 0…180 — the lateral-limit measure */
  function offAxis(trend, axis) { return Math.abs(angDiff(trend, axis)); }

  /** does a downward line escape from the face, and by how much room to spare? */
  function daylight(face, trend, plunge) {
    var ap = apparentDip(face.dip, face.dipDir, trend);
    return { apparent: ap, out: ap > 0 && plunge < ap };
  }

  /**
   * Classify one line of intersection.
   * `face` = {dip, dipDir} of the slope, `phi` = friction angle in degrees.
   */
  function wedgeZone(trend, plunge, face, phi) {
    var dl = daylight(face, trend, plunge);
    var res = { zone: 'none', apparent: dl.apparent, why: '' };
    if (!dl.out) {
      res.why = dl.apparent <= 0
        ? 'aimed into the wall, not out of it'
        : 'plunges ' + plunge.toFixed(1) + '° — steeper than the face\'s ' +
          dl.apparent.toFixed(1) + '° along that bearing, so it never daylights';
      return res;
    }
    if (plunge > phi) {
      res.zone = 'primary';
      res.why = 'daylights and plunges ' + plunge.toFixed(1) + '° > φ ' + phi.toFixed(0) + '°';
      return res;
    }
    /* flatter than φ: still critical if it sits outside the great circle of a
       plane dipping at the friction angle in the same direction as the face */
    var fricApp = apparentDip(phi, face.dipDir, trend);
    if (plunge > fricApp) {
      res.zone = 'secondary';
      res.why = 'flatter than φ, but outside the ' + phi.toFixed(0) +
        '° friction plane — release on one joint';
      return res;
    }
    res.why = 'plunges ' + plunge.toFixed(1) + '° — flatter than φ ' + phi.toFixed(0) + '°';
    return res;
  }

  /**
   * Which single joint of a secondary wedge actually moves, and where to.
   * The plane has to dip steeper than φ and daylight in the face; if both do,
   * the steeper one governs. Returns null when neither qualifies, which makes
   * the pair critical on paper and inert in practice.
   */
  function slidingPlane(a, b, face, phi) {
    var best = null;
    [a, b].forEach(function (p, i) {
      if (p.dip <= phi) return;
      var ap = apparentDip(face.dip, face.dipDir, p.dipDir);
      if (!(ap > 0 && p.dip < ap)) return;              // does its dip vector daylight?
      if (!best || p.dip > best.plane.dip) best = { plane: p, which: i };
    });
    return best;
  }

  /* ---------------------------------------------------- planar sliding
     Dips plots POLES (or dip vectors — the same test read either way) and
     calls a plane critical when it is all three of:

       · inside the DAYLIGHT ENVELOPE. The plane's dip vector points out of
         the face and is flatter than the face is along that same bearing, so
         the slab can slide out into space rather than into the wall. That is
         the `daylight` test above, applied to the dip vector.
       · outside the POLE FRICTION CONE. The cone angle is φ measured from the
         CENTRE of the net, and a pole of plunge 90−δ sits at δ from the
         centre — so "outside the cone" is exactly δ > φ, the plane dipping
         steeper than friction.
       · inside the LATERAL LIMITS. Planar failure is only ever seen where the
         slab can break out more or less square to the wall; ±20° to ±30° of
         the face's dip direction is the usual allowance.

     The lateral limits are the ONLY difference between this mode and planar
     sliding (no limits), so a plane that fails on that count alone is not
     thrown away — it is reported SECONDARY. Those are the slabs that
     daylight and beat friction but strike obliquely, and switching to the
     no-limits mode turns every one of them red. */
  function planarZone(plane, face, phi, limit) {
    var dip = clampDip(plane.dip), dir = wrap360(plane.dipDir);
    var dl = daylight(face, dir, dip);
    var res = { zone: 'none', apparent: dl.apparent, off: offAxis(dir, face.dipDir), why: '' };
    if (!dl.out) {
      res.why = dl.apparent <= 0
        ? 'dips into the wall, not out of it'
        : 'dips ' + dip.toFixed(1) + '° — steeper than the face\'s ' + dl.apparent.toFixed(1) +
          '° along that bearing, so the slab is buried and cannot daylight';
      return res;
    }
    if (dip <= phi) {
      res.why = 'daylights, but dips ' + dip.toFixed(1) + '° — flatter than φ ' +
        phi.toFixed(0) + '°, so it holds on friction alone';
      return res;
    }
    if (limit != null && res.off > limit) {
      res.zone = 'secondary';
      res.why = 'daylights and beats φ, but its dip direction is ' + Math.round(res.off) +
        '° off the face — outside the ±' + Math.round(limit) + '° lateral limits, so it has ' +
        'no release to break out sideways';
      return res;
    }
    res.zone = 'primary';
    res.why = 'daylights at ' + dl.apparent.toFixed(1) + '°, dips ' + dip.toFixed(1) +
      '° > φ ' + phi.toFixed(0) + '°' +
      (limit == null ? '' : ', ' + Math.round(res.off) + '° off the face dip direction');
    return res;
  }

  /* -------------------------------------------------- flexural toppling
     Goodman (1980): for the layers to slip past one another — which is what
     lets a toppling column bend out of the wall at all — the BEDDING NORMAL
     must be inclined less steeply than a line at the friction angle above the
     slope. Written as dips that is

         (90 − δ_joint)  ≤  δ_face − φ

     with the layers dipping into the face. Dips draws the right-hand side as
     the SLIP LIMIT: a plane of dip (δ_face − φ) in the face's own dip
     direction. Poles outside its great circle topple; poles inside it do not.
     Off the face's dip direction that great circle is the inequality above
     with the apparent dip in place of the true one, which is the same
     relaxation Dips makes and the reason the limits are not optional here.

     Lateral limits are mandatory for this mode in Dips. A layer striking
     obliquely still has a pole outside the slip limit, so without them the
     test would call a wall critical on structure that cannot topple towards
     it; those are reported SECONDARY rather than dropped. */
  function flexuralZone(plane, face, phi, limit) {
    var dip = clampDip(plane.dip), dir = wrap360(plane.dipDir);
    var pl = pole(dip, dir);
    var slip = clampDip(face.dip) - phi;
    var res = { zone: 'none', apparent: 0, off: offAxis(pl.trend, face.dipDir),
      pole: pl, slip: slip, why: '' };
    if (!(slip > 0)) {
      res.why = 'the face dips ' + clampDip(face.dip).toFixed(0) + '° — flatter than φ ' +
        phi.toFixed(0) + '°, so no inter-layer slip is possible on any structure';
      return res;
    }
    var out = daylight({ dip: slip, dipDir: face.dipDir }, pl.trend, pl.plunge);
    res.apparent = out.apparent;
    if (!out.out) {
      res.why = out.apparent <= 0
        ? 'dips out of the face rather than into it — nothing to topple'
        : 'its pole plunges ' + pl.plunge.toFixed(1) + '°, inside the ' + slip.toFixed(1) +
          '° slip limit: the layers cannot slip past one another, so the column cannot bend out';
      return res;
    }
    if (limit != null && res.off > limit) {
      res.zone = 'secondary';
      res.why = 'steep enough into the face for inter-layer slip, but striking ' +
        Math.round(res.off) + '° off square — outside the ±' + Math.round(limit) +
        '° lateral limits, so the columns lean across the wall rather than out of it';
      return res;
    }
    res.zone = 'primary';
    res.why = 'dips ' + dip.toFixed(1) + '° into the face; its pole at ' + pl.plunge.toFixed(1) +
      '° clears the ' + slip.toFixed(1) + '° slip limit (face ' + clampDip(face.dip).toFixed(0) +
      '° − φ ' + phi.toFixed(0) + '°)';
    return res;
  }

  /* ---------------------------------------------------- direct toppling
     Two populations, and the mode is only real when both are present.

     INTERSECTIONS — the edges of the blocks. Dips takes them as critical when
     they dip INTO the slope within the lateral limits and plunge steeper than
     a circle of cone angle equal to the slope angle: zones 1 and 2, the
     primary zone. Near-vertical intersections outside the lateral limits are
     zone 3, OBLIQUE toppling, and are bounded by the friction cone.

     POLES — the base planes those blocks topple over. A pole inside the
     friction cone (a plane flatter than φ) is a release surface only: zones 2
     and 3. A pole outside the friction cone but inside the slope-angle circle
     and within the lateral limits is zone 1: a base plane that can slide as
     well as release. */
  function directZone(trend, plunge, face, phi, limit) {
    var g = directGeom(face, phi, limit), res = { zone: 'none', apparent: 0, off: 0, why: '' };
    var w = directWhere(trend, plunge, g);
    res.off = w.off;
    if (w.zone === 1 || w.zone === 2) {
      res.zone = 'primary';
      res.why = 'plunges ' + plunge.toFixed(1) + '° into the slope, steeper than the ' +
        g.slopeP.toFixed(1) + '° slope-angle circle and ' + Math.round(w.off) +
        '° off square — blocks can form and topple over a base plane';
      return res;
    }
    if (w.zone === 3) {
      res.zone = 'secondary';
      res.why = 'near vertical at ' + plunge.toFixed(1) + '° and ' + Math.round(w.off) +
        '° off the slope, outside the lateral limits — inside the friction cone, so it can ' +
        'only topple obliquely';
      return res;
    }
    res.why = w.backwards
      ? 'plunges ' + plunge.toFixed(1) + '° but towards the face, not into the slope — the ' +
        'blocks lean out of the wall already and there is nothing to rotate over'
      : plunge < g.slopeP
        ? 'plunges ' + plunge.toFixed(1) + '° — flatter than the ' + g.slopeP.toFixed(1) +
          '° slope-angle circle, so no block stands up on it'
        : 'lies ' + Math.round(w.off) + '° off the slope, outside the ±' + Math.round(g.lim) +
          '° lateral limits and outside the friction cone';
    return res;
  }

  /**
   * The three circles and two lines the direct-toppling zones are cut from.
   * One function, so the test and the shaded polygons cannot drift apart.
   */
  function directGeom(face, phi, limit) {
    return {
      into: wrap360(face.dipDir + 180),            // the into-slope bearing
      out: wrap360(face.dipDir),                   // the other end of the same line
      slopeP: 90 - clampDip(face.dip),             // circle at cone angle = slope angle
      fricP: 90 - phi,                             // the pole friction cone
      lim: limit == null ? LIMIT : limit
    };
  }

  /**
   * Which of Dips' three zones a point falls in — 0 for none.
   *
   * Measured straight off the Dips overlay figure rather than inferred, because
   * two things about it are easy to get wrong and neither is written down:
   *
   *   · the overlay carries THREE diameters, not two. Two are the lateral
   *     limits, at ±limit about the slope dip direction; the third is the
   *     slope's STRIKE, at ±90°, and that is what bounds zone 3. So zone 3
   *     runs from the lateral limit out to 90° off the into-slope bearing and
   *     stops there. Beyond 90° the line dips out of the face rather than into
   *     it, and Dips leaves that whole half of the friction cone unshaded —
   *     rightly: a block edge plunging towards the face already leans out of
   *     the wall, and there is nothing for it to rotate over.
   *   · zones 1 and 2 are ONE red sector reaching the centre. The friction
   *     cone drawn across it is what separates them, and it separates them
   *     only for the poles: an intersection anywhere in that sector cuts a
   *     block, while a pole inside the cone is a release surface and a pole
   *     outside it is a base plane that can slide as well.
   *
   *   1  in the into-slope lobe, inside the slope-angle circle, OUTSIDE the
   *      friction cone
   *   2  the same lobe, inside the friction cone
   *   3  inside the friction cone, between the lateral limit and 90° off —
   *      oblique toppling
   *   0  everything else
   */
  function directWhere(trend, plunge, g) {
    var off = offAxis(trend, g.into);
    if (off <= g.lim) {
      if (plunge < g.slopeP) return { zone: 0, off: off, backwards: false };
      return { zone: plunge >= g.fricP ? 2 : 1, off: off, backwards: false };
    }
    if (off <= 90 && plunge >= g.fricP) return { zone: 3, off: off, backwards: false };
    return { zone: 0, off: off, backwards: off > 90 };
  }

  /**
   * The base-plane half of direct toppling: what one plane could do for a block.
   *
   * Read off exactly the same three zones as the intersections, which is the
   * point of Dips plotting both populations on one overlay:
   *
   *   zone 1        outside the friction cone — the plane dips steeper than φ
   *                 but flatter than the wall, so blocks can SLIDE on it as
   *                 well as topple over it
   *   zones 2 & 3   inside the friction cone — nothing slides on a plane that
   *                 flat, but it still lets the blocks go. Release only, and
   *                 that is a secondary finding whichever of the two it is:
   *                 the lateral limits separate a base plane square to the
   *                 wall from an oblique one, not a real one from a paper one.
   */
  function baseZone(plane, face, phi, limit) {
    var dip = clampDip(plane.dip), pl = pole(dip, wrap360(plane.dipDir));
    var g = directGeom(face, phi, limit);
    var w = directWhere(pl.trend, pl.plunge, g);
    var res = { zone: 'none', role: 'none', off: w.off, pole: pl, apparent: 0, why: '' };
    if (w.zone === 1) {
      res.zone = 'primary';
      res.role = 'sliding';
      res.why = 'dips ' + dip.toFixed(1) + '° out of the face, steeper than φ ' +
        phi.toFixed(0) + '° and flatter than the wall — a base plane the blocks can ' +
        'slide on as well as topple over';
      return res;
    }
    if (w.zone === 2 || w.zone === 3) {
      res.zone = 'secondary';
      res.role = 'release';
      res.why = 'dips ' + dip.toFixed(1) + '° — flatter than φ ' + phi.toFixed(0) +
        '°, so nothing slides on it, but it can act as ' +
        (w.zone === 2 ? 'a base for the blocks to topple over'
          : 'an oblique release surface (' + Math.round(w.off) + '° off the slope)');
      return res;
    }
    res.why = w.backwards
      ? 'dips back into the hill rather than out of the face — it holds the blocks up ' +
        'rather than letting them go'
      : pl.plunge < g.slopeP
        ? 'dips ' + dip.toFixed(1) + '° — steeper than the face, so it undercuts nothing'
        : 'lies ' + Math.round(w.off) + '° off the slope, outside the ±' + Math.round(g.lim) +
          '° lateral limits';
    return res;
  }

  /**
   * Where a toppling column's face actually goes.
   *
   * A column rotating about its base moves perpendicular to its own axis, in
   * the vertical plane that contains it: out of the wall and down. So for an
   * axis plunging p towards θ INTO the slope, the movement is (θ+180, 90−p) —
   * a column standing vertical topples horizontally outwards, one leaning back
   * at 70° moves out and 20° down. For flexural toppling the axis is the
   * layer's dip vector, which makes the movement direction its pole; for
   * direct toppling it is the line of intersection cutting the block.
   *
   * This is not something Dips reports — Dips stops at critical or not. It is
   * needed here because the whole point of the tab is to hand a movement
   * direction to the sensitivity model, and a toppling wall does not move down
   * the dip of anything.
   */
  function toppleVector(trend, plunge) {
    return { trend: wrap360(trend + 180), plunge: Math.max(0, Math.min(90, 90 - plunge)) };
  }

  /**
   * Run the failure-mode test over every pair of enabled planes.
   *
   * planes : [{name, dip, dipDir, on, color, …}] — anything else on the object
   *          is carried through untouched, so the caller can keep its own ids.
   * face   : {dip, dipDir} of the slope being assessed
   * phi    : friction angle, degrees
   *
   * Returns every pair, critical or not, so the table can show the near misses
   * — the ones a 5° change in the face orientation would turn critical.
   */
  function analyse(planes, face, phi, mode, opts) {
    var live = (planes || []).filter(function (p) { return p && p.on !== false; });
    var pairs = [], poles = [], nPrimary = 0, nSecondary = 0;
    phi = +phi || 0;
    opts = opts || {};
    var M = modeOf(mode);
    /* Lateral limits belong to the mode, not to the operator: wedge sliding
       has none to set, and turning them off is what "planar sliding (no
       limits)" IS. So the number is read only where the mode says it counts. */
    var limit = M.limits
      ? (opts.limit == null ? LIMIT : Math.max(0, Math.min(90, +opts.limit || 0)))
      : null;
    /* `patch(plane)` turns a mapped plane into its drawn extent, or null when
       it has no location. Without it every pair is untestable and the analysis
       behaves exactly as it did before — which is what a pure orientation
       study wants. */
    var patchOf = opts.patch || function () { return null; };
    var surfaceZ = opts.surface || null;
    var nApart = 0, nUntested = 0, nAir = 0, nSliding = 0, nRelease = 0;
    /* Which populations this mode counts. Direct toppling is the one that
       needs both: intersections cut the blocks, poles give them a base. */
    var doPairs = M.plots !== 'poles', doPoles = M.plots !== 'intersections';
    for (var i = 0; doPairs && i < live.length; i++) {
      for (var j = i + 1; j < live.length; j++) {
        var A = live[i], B = live[j];
        var L = intersection(A, B);
        if (!L) continue;                                  // parallel: no wedge
        /* Do the two structures actually meet anywhere? A pair can sit in the
           critical zone on orientation alone while being mapped at opposite
           ends of the pit, and that is a wedge on paper and nowhere else. */
        var pa = patchOf(A), pb = patchOf(B);
        var seg = (pa && pb) ? patchIntersection(pa, pb) : null;
        var contact = (pa && pb) ? !!seg : null;
        /* In contact is not the same as bounding any rock: two patches can
           cross out in the air beyond the face, and that wedge is a wedge of
           sky however its poles plot. */
        var rock = (seg && surfaceZ) ? segmentInRock(seg, surfaceZ) : null;
        if (contact === false) nApart++;
        else if (contact === null) nUntested++;
        else if (rock && rock.status === 'air') nAir++;
        if (opts.onlyContact && (contact === false || (rock && rock.status === 'air'))) continue;

        var z, slide;
        if (M.id === 'direct') {
          /* the block edge, not a sliding line: the pair is here because two
             steep joints cut a column out of the wall, and what moves is the
             column rotating over its base */
          z = directZone(L.trend, L.plunge, face, phi, limit);
          var tv = toppleVector(L.trend, L.plunge);
          slide = { trend: tv.trend, plunge: tv.plunge,
            on: z.zone === 'secondary' ? 'toppling obliquely out of the face'
              : 'toppling out of the face' };
        } else {
          z = wedgeZone(L.trend, L.plunge, face, phi);
          slide = { trend: L.trend, plunge: L.plunge, on: 'both planes' };
          if (z.zone === 'secondary') {
            var sp = slidingPlane(A, B, face, phi);
            if (sp) {
              var dv = { trend: sp.plane.dipDir, plunge: clampDip(sp.plane.dip) };
              slide = { trend: dv.trend, plunge: dv.plunge, on: sp.plane.name };
            } else {
              /* nothing can actually release — demote it rather than report a
                 critical wedge with no mechanism behind it */
              z = { zone: 'none', apparent: z.apparent,
                why: 'flatter than φ and neither joint dips steeper than φ into the face' };
            }
          }
        }
        if (z.zone === 'primary') nPrimary++;
        else if (z.zone === 'secondary') nSecondary++;
        pairs.push({
          a: A, b: B, ai: i, bi: j, kind: 'pair',
          trend: L.trend, plunge: L.plunge,
          zone: z.zone, why: z.why, apparent: z.apparent, off: z.off,
          slide: slide, contact: contact, seg: seg, rock: rock
        });
      }
    }
    /* Sorted by whether the wedge is really there FIRST, and only then by how
       critical it is. A pair that bounds no rock cannot fail however its poles
       plot, so it belongs under everything that can — otherwise the top of the
       table fills with wedges of sky and the real ones are read past. */
    pairs.sort(function (p, q) {
      var rp = CONTACT_RANK[contactState(p)], rq = CONTACT_RANK[contactState(q)];
      if (rp !== rq) return rp - rq;
      var zone = { primary: 0, secondary: 1, none: 2 };
      if (zone[p.zone] !== zone[q.zone]) return zone[p.zone] - zone[q.zone];
      return q.plunge - p.plunge;
    });

    /* ---- the pole population: one row per plane, for the modes that fail on
       a single structure rather than on a pair of them ---- */
    if (doPoles) {
      live.forEach(function (P, pi) {
        var dip = clampDip(P.dip), dir = wrap360(P.dipDir);
        var z = M.id === 'flexural' ? flexuralZone(P, face, phi, limit)
          : M.id === 'direct' ? baseZone(P, face, phi, limit)
            : planarZone(P, face, phi, limit);
        var pl = pole(dip, dir), slide = null;
        if (M.id === 'flexural') {
          var tv = toppleVector(dir, dip);            // = the pole, taken out of the face
          slide = { trend: tv.trend, plunge: tv.plunge, on: 'toppling on ' + P.name };
        } else if (M.id === 'direct') {
          /* a release plane has no movement direction of its own — what moves
             is the block above it, and that comes off the intersection row */
          if (z.role === 'sliding') slide = { trend: dir, plunge: dip, on: P.name };
        } else {
          slide = { trend: dir, plunge: dip, on: P.name };
        }
        if (M.id === 'direct') {
          if (z.role === 'sliding') nSliding++;
          else if (z.role === 'release') nRelease++;
        } else if (z.zone === 'primary') nPrimary++;
        else if (z.zone === 'secondary') nSecondary++;
        poles.push({
          p: P, pi: pi, kind: 'pole', name: P.name,
          dip: dip, dipDir: dir, trend: pl.trend, plunge: pl.plunge,
          zone: z.zone, role: z.role || null, why: z.why, apparent: z.apparent, off: z.off,
          slide: slide, placed: !!patchOf(P)
        });
      });
      var pzone = { primary: 0, secondary: 1, none: 2 };
      poles.sort(function (p, q) {
        if (pzone[p.zone] !== pzone[q.zone]) return pzone[p.zone] - pzone[q.zone];
        return q.dip - p.dip;
      });
    }

    /* What the mode's percentage is a percentage OF. Direct toppling counts
       its intersections, the way Dips does, and reports the base planes
       beside them rather than mixing two populations into one figure. */
    var total = M.plots === 'poles' ? poles.length : pairs.length;
    return {
      mode: M.id, modeName: M.name, plots: M.plots, limit: limit,
      face: face, phi: phi,
      planes: live, pairs: pairs, poles: poles, total: total,
      nPrimary: nPrimary, nSecondary: nSecondary,
      nSliding: nSliding, nRelease: nRelease, nBase: nSliding + nRelease,
      /* how many pairs were mapped apart, and how many could not be tested
         because a plane has no location — both belong in the summary, because
         a percentage means something different depending on them */
      nApart: nApart, nUntested: nUntested, nAir: nAir, filtered: !!opts.onlyContact,
      nCritical: nPrimary + nSecondary,
      pctCritical: total ? 100 * (nPrimary + nSecondary) / total : 0,
      pctPrimary: total ? 100 * nPrimary / total : 0
    };
  }

  /* ------------------------------------------- critical-zone outlines
     The same inequalities as wedgeZone, turned into closed polygons on the
     unit disc so the stereonet can shade what the numbers mean. */

  /**
   * Primary crescent: bounded outward by the slope's great circle and inward
   * by the friction cone. It exists only over the bearings where the face's
   * apparent dip still beats φ, i.e. cos(θ−α) > tan φ / tan δ.
   */
  function primaryZone(face, phi, equalArea, steps) {
    var d = clampDip(face.dip);
    if (!(d > phi)) return null;                       // a wall flatter than φ has none
    var k = Math.tan(phi * DEG) / Math.tan(d * DEG);
    if (k >= 1) return null;
    var half = Math.acos(Math.max(-1, Math.min(1, k))) / DEG;
    var N = steps || 90, out = [], i, th;
    for (i = 0; i <= N; i++) {                         // along the friction cone
      th = face.dipDir - half + 2 * half * i / N;
      out.push(project(th, phi, equalArea));
    }
    for (i = N; i >= 0; i--) {                         // back along the slope plane
      th = face.dipDir - half + 2 * half * i / N;
      out.push(project(th, Math.max(phi, apparentDip(d, face.dipDir, th)), equalArea));
    }
    return out;
  }

  /**
   * The two secondary lobes: between the slope plane and a great circle
   * dipping at φ in the same direction. They pinch to a point on the dip
   * direction itself (where the friction plane's apparent dip IS φ) and open
   * out to the perimeter at ±90°, which is what makes them read as two lobes
   * flanking the primary crescent.
   */
  function secondaryZones(face, phi, equalArea, steps) {
    var d = clampDip(face.dip);
    if (!(d > phi)) return [];
    var N = steps || 60, lobes = [];
    [1, -1].forEach(function (sgn) {
      var inner = [], outer = [];
      for (var i = 0; i <= N; i++) {
        var th = face.dipDir + sgn * 90 * i / N;
        var slopeApp = apparentDip(d, face.dipDir, th);
        var fricApp = apparentDip(phi, face.dipDir, th);
        inner.push(project(th, Math.max(0, Math.min(slopeApp, phi)), equalArea));
        outer.push(project(th, Math.max(0, fricApp), equalArea));
      }
      outer.reverse();
      lobes.push(inner.concat(outer));
    });
    return lobes;
  }

  /* ---------------------------------------------- the other modes' zones

     Every one of them is the region between two plunge curves over a range of
     bearings, so they are all built by the same sweep. `lo` is the outer edge
     (the smaller plunge, further from the centre) and `hi` the inner one;
     either may be a constant or a function of the bearing. */
  function band(t0, t1, lo, hi, equalArea, steps) {
    var N = steps || 90, out = [], i, t;
    var fLo = typeof lo === 'function' ? lo : function () { return lo; };
    var fHi = typeof hi === 'function' ? hi : function () { return hi; };
    for (i = 0; i <= N; i++) { t = t0 + (t1 - t0) * i / N; out.push(project(t, fLo(t), equalArea)); }
    for (i = N; i >= 0; i--) { t = t0 + (t1 - t0) * i / N; out.push(project(t, fHi(t), equalArea)); }
    return out;
  }

  /** a circle of constant plunge — a cone about the vertical, as a polygon */
  function circleZone(plunge, equalArea, steps) {
    var N = steps || 120, out = [];
    for (var i = 0; i <= N; i++) out.push(project(360 * i / N, plunge, equalArea));
    return out;
  }

  /**
   * The daylight envelope: every pole whose plane's dip vector points out of
   * the face. For a pole trend t the plane dips towards t+180, and the steepest
   * it can be and still daylight is the face's apparent dip along that bearing
   * — so the envelope is plunge = 90 − apparent, closing at the centre of the
   * net at ±90° where the apparent dip runs out.
   */
  function daylightEnvelope(face, equalArea, steps) {
    var d = clampDip(face.dip), N = steps || 120, out = [];
    for (var i = 0; i <= N; i++) {
      var t = face.dipDir + 90 + 180 * i / N;         // pole trends: the back half
      out.push(project(t, 90 - Math.max(0, apparentDip(d, face.dipDir, t + 180)), equalArea));
    }
    return out;
  }

  /** planar sliding: inside the envelope, outside the pole friction cone */
  function planarZones(face, phi, limit, equalArea, steps) {
    var d = clampDip(face.dip), out = { primary: [], secondary: [] };
    if (!(d > phi)) return out;                        // a wall flatter than φ releases nothing
    var k = Math.tan(phi * DEG) / Math.tan(d * DEG);
    if (k >= 1) return out;
    var half = Math.acos(Math.max(-1, Math.min(1, k))) / DEG;
    var into = face.dipDir + 180;
    var lo = function (t) { return 90 - Math.max(phi, apparentDip(d, face.dipDir, t + 180)); };
    var hi = 90 - phi;
    var lim = limit == null ? half : Math.min(half, limit);
    out.primary.push(band(into - lim, into + lim, lo, hi, equalArea, steps));
    if (limit != null && limit < half) {
      out.secondary.push(band(into + limit, into + half, lo, hi, equalArea, steps));
      out.secondary.push(band(into - half, into - limit, lo, hi, equalArea, steps));
    }
    return out;
  }

  /** flexural toppling: poles outside the slip limit, inside the lateral limits */
  function flexuralZones(face, phi, limit, equalArea, steps) {
    var slip = clampDip(face.dip) - phi, out = { primary: [], secondary: [] };
    if (!(slip > 0)) return out;
    var ax = face.dipDir, lim = limit == null ? LIMIT : limit;
    var hi = function (t) { return Math.max(0, apparentDip(slip, ax, t)); };
    out.primary.push(band(ax - lim, ax + lim, 0, hi, equalArea, steps));
    /* the same band carried out to ±90°, where the slip limit meets the rim:
       structure steep enough to topple but striking too obliquely to do it
       towards this wall */
    if (lim < 89) {
      out.secondary.push(band(ax + lim, ax + 89.9, 0, hi, equalArea, steps));
      out.secondary.push(band(ax - 89.9, ax - lim, 0, hi, equalArea, steps));
    }
    return out;
  }

  /**
   * Direct toppling. Zones 1 and 2 together are one sector: within the lateral
   * limits of the into-slope bearing, from the slope-angle circle in to the
   * centre. Zone 3 — oblique toppling — is the rest of the friction cone, and
   * it is emitted as the whole cone because the primary sector is painted over
   * the top of it.
   */
  function directZones(face, phi, limit, equalArea, steps) {
    var g = directGeom(face, phi, limit);
    var out = { primary: [], secondary: [], labels: [] };
    var into = g.into, lim = g.lim, mid = (g.fricP + 90) / 2;
    /* zones 1 and 2 — one red sector on the into-slope bearing, from the
       slope-angle circle all the way to the centre. The friction cone is drawn
       across it and the numbers name the two halves, because the split matters
       to the poles and not to the intersections. */
    out.primary.push(band(into - lim, into + lim, g.slopeP, 90, equalArea, steps));
    if (g.fricP > g.slopeP) {
      out.labels.push({ text: '1', trend: into, plunge: (g.slopeP + g.fricP) / 2 });
    }
    out.labels.push({ text: '2', trend: into, plunge: mid });
    /* zone 3 — from the lateral limit round to the strike, and no further.
       Past 90° the structure dips out of the face, and that half of the
       friction cone is not toppling of any kind. */
    if (lim < 90) {
      out.secondary.push(band(into + lim, into + 90, g.fricP, 90, equalArea, steps));
      out.secondary.push(band(into - 90, into - lim, g.fricP, 90, equalArea, steps));
      out.labels.push({ text: '3', trend: into + (lim + 90) / 2, plunge: mid });
      out.labels.push({ text: '3', trend: into - (lim + 90) / 2, plunge: mid });
    }
    return out;
  }

  /**
   * Everything the stereonet has to paint for one mode, in one object, so the
   * plot holds no rules of its own:
   *
   *   primary/secondary  filled polygons, the critical zones
   *   circles            stroked cones about the vertical, by plunge
   *   curves             stroked reference lines — the daylight envelope, the
   *                      slip limit
   *   diameters          the lateral limits, as full lines across the net
   *   labels             Dips' zone numbers, where a mode has more than two
   *                      regions and the colours alone cannot say which is which
   */
  function zones(mode, face, phi, limit, equalArea, steps) {
    var M = modeOf(mode);
    var out = { primary: [], secondary: [], circles: [], curves: [], diameters: [], labels: [] };
    if (!face) return out;
    var lim = M.limits ? (limit == null ? LIMIT : limit) : null;
    var d = clampDip(face.dip);
    if (M.id === 'wedge') {
      var pri = primaryZone(face, phi, equalArea, steps);
      if (pri) out.primary.push(pri);
      out.secondary = secondaryZones(face, phi, equalArea, steps);
      return out;
    }
    if (M.id === 'planar' || M.id === 'planarNL') {
      var pz = planarZones(face, phi, lim, equalArea, steps);
      out.primary = pz.primary; out.secondary = pz.secondary;
      out.curves.push({ kind: 'daylight', pts: daylightEnvelope(face, equalArea, steps) });
    } else if (M.id === 'flexural') {
      var fz = flexuralZones(face, phi, lim, equalArea, steps);
      out.primary = fz.primary; out.secondary = fz.secondary;
      if (d > phi) {
        out.curves.push({ kind: 'slip', pts: greatCircle(d - phi, face.dipDir, 181, equalArea) });
      }
    } else if (M.id === 'direct') {
      var dz = directZones(face, phi, lim, equalArea, steps);
      out.primary = dz.primary; out.secondary = dz.secondary; out.labels = dz.labels;
      /* both circles belong to the overlay here — the slope-angle circle caps
         the red sector and the friction cone divides zone 1 from zone 2 — so
         the cone is drawn whether or not the φ-cone switch is on */
      out.circles.push({ kind: 'slope', plunge: 90 - d });
      out.circles.push({ kind: 'friction', plunge: 90 - phi });
      /* and a third diameter: the slope's STRIKE, which is where zone 3 stops */
      out.diameters.push(face.dipDir + 90);
    }
    if (lim != null) out.diameters.push(face.dipDir - lim, face.dipDir + lim);
    return out;
  }

  /**
   * Where the friction cone goes for a mode, and what it means there.
   *
   * For a line — a wedge axis — the cone is φ measured from the RIM: a line
   * flatter than φ plots outside it and cannot slide. For a pole it is φ from
   * the CENTRE, and a pole outside it belongs to a plane steeper than φ. Same
   * friction angle, opposite sense, and drawing the wrong one puts the circle
   * in a mirror-image place on the plot.
   */
  function coneFor(mode, phi) {
    var M = modeOf(mode);
    return M.plots === 'intersections'
      ? { plunge: phi, label: 'plane friction cone — a line flatter than φ plots outside it' }
      : { plunge: 90 - phi, label: 'pole friction cone — a plane steeper than φ plots outside it' };
  }

  return {
    DEG: DEG, MAX_DIP: MAX_DIP, DIP_ASPECT: DIP_ASPECT, LIMIT: LIMIT,
    clampDip: clampDip, wrap360: wrap360, angDiff: angDiff,
    cross: cross, dot: dot, norm: norm,
    planeNormal: planeNormal, dipVector: dipVector, strikeVector: strikeVector,
    patchIntersection: patchIntersection, segmentInRock: segmentInRock, lineVec: lineVec,
    vecToLine: vecToLine, normalToPlane: normalToPlane, pole: pole,
    apparentDip: apparentDip, intersection: intersection,
    fitPlane: fitPlane, meanNormal: meanNormal,
    project: project, plungeRadius: plungeRadius, greatCircle: greatCircle,
    MODES: MODES, modeOf: modeOf, offAxis: offAxis,
    daylight: daylight, wedgeZone: wedgeZone, slidingPlane: slidingPlane,
    planarZone: planarZone, flexuralZone: flexuralZone,
    directZone: directZone, directGeom: directGeom, directWhere: directWhere,
    baseZone: baseZone, toppleVector: toppleVector,
    CONTACT_RANK: CONTACT_RANK, contactState: contactState, isEmptyWedge: isEmptyWedge,
    analyse: analyse, primaryZone: primaryZone, secondaryZones: secondaryZones,
    daylightEnvelope: daylightEnvelope, planarZones: planarZones,
    flexuralZones: flexuralZones, directZones: directZones,
    zones: zones, coneFor: coneFor, circleZone: circleZone
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Struct;
