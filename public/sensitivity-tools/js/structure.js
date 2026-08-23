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
     friction angle φ is shared by both joint surfaces, and the test is run on
     the LINES OF INTERSECTION of every enabled pair of planes.

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

  var MODES = [
    { id: 'wedge', name: 'Wedge sliding', plots: 'intersections',
      hint: 'Every pair of planes is intersected; the wedge slides down that line of intersection.' }
  ];

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
    var pairs = [], nPrimary = 0, nSecondary = 0;
    phi = +phi || 0;
    opts = opts || {};
    /* `patch(plane)` turns a mapped plane into its drawn extent, or null when
       it has no location. Without it every pair is untestable and the analysis
       behaves exactly as it did before — which is what a pure orientation
       study wants. */
    var patchOf = opts.patch || function () { return null; };
    var surfaceZ = opts.surface || null;
    var nApart = 0, nUntested = 0, nAir = 0;
    for (var i = 0; i < live.length; i++) {
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

        var z = wedgeZone(L.trend, L.plunge, face, phi);
        var slide = { trend: L.trend, plunge: L.plunge, on: 'both planes' };
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
        if (z.zone === 'primary') nPrimary++;
        else if (z.zone === 'secondary') nSecondary++;
        pairs.push({
          a: A, b: B, ai: i, bi: j,
          trend: L.trend, plunge: L.plunge,
          zone: z.zone, why: z.why, apparent: z.apparent,
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
    var total = pairs.length;
    return {
      mode: mode || 'wedge', face: face, phi: phi,
      planes: live, pairs: pairs, total: total,
      nPrimary: nPrimary, nSecondary: nSecondary,
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

  return {
    DEG: DEG, MAX_DIP: MAX_DIP, DIP_ASPECT: DIP_ASPECT,
    clampDip: clampDip, wrap360: wrap360, angDiff: angDiff,
    cross: cross, dot: dot, norm: norm,
    planeNormal: planeNormal, dipVector: dipVector, strikeVector: strikeVector,
    patchIntersection: patchIntersection, segmentInRock: segmentInRock, lineVec: lineVec,
    vecToLine: vecToLine, normalToPlane: normalToPlane, pole: pole,
    apparentDip: apparentDip, intersection: intersection,
    fitPlane: fitPlane, meanNormal: meanNormal,
    project: project, plungeRadius: plungeRadius, greatCircle: greatCircle,
    MODES: MODES, daylight: daylight, wedgeZone: wedgeZone, slidingPlane: slidingPlane,
    CONTACT_RANK: CONTACT_RANK, contactState: contactState, isEmptyWedge: isEmptyWedge,
    analyse: analyse, primaryZone: primaryZone, secondaryZones: secondaryZones
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Struct;
