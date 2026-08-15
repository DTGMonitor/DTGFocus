/* ============================================================
   georef.js — put a radar scan on the mine grid from tied points.

   A radar scan is internally exact (Range == hypot(E,N,Elev) to the last
   decimal) but sits in a frame hung off the sensor head, whose position and
   bearing are only approximately known. The correction is therefore a RIGID
   body transform — rotation and translation, scale locked at 1. Nothing here
   stretches the scan, because stretching it would trade a known-good shape
   for a better-looking fit to hand-clicked points.

     q ~= R p + t      p = radar-local metres, q = mine grid metres

   Two fit modes, because they need different amounts of work from the user:

     'yaw'    rotation about the vertical only — 4 unknowns (bearing, E, N,
              Z). Correct whenever the radar was set up levelled, which is the
              normal case, and it needs only TWO tied points. Cannot tilt the
              scan, so a levelling error shows up as residual rather than
              being silently absorbed.
     'rigid'  full 3-D rotation — 6 unknowns, needs THREE non-collinear tied
              points. Use when the sensor was set up on a slope or the yaw fit
              leaves a residual with a vertical pattern to it.

   Because the source frame's origin IS the sensor head, `t` falls out of the
   solve as the radar's position on the mine grid — a number the surveyor can
   sanity-check directly, which is the cheapest error trap available here.
   ============================================================ */
'use strict';

var Georef = (function () {

  var DEG = 180 / Math.PI;

  /* ---------------------------------------------- small matrix helpers */
  /* Row-major 3x3 throughout: m[r*3 + c]. */

  function matMul(a, b) {
    var o = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
      }
    }
    return o;
  }

  function transpose(m) {
    return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  }

  function det3(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7])
         - m[1] * (m[3] * m[8] - m[5] * m[6])
         + m[2] * (m[3] * m[7] - m[4] * m[6]);
  }

  /**
   * One-sided Jacobi SVD of a 3x3, A = U * diag(S) * V^T.
   *
   * One-sided rather than the textbook two-sided form because it only ever
   * touches column pairs: it stays accurate when A is near-singular, which is
   * exactly what a user clicking three nearly-collinear tied points produces.
   * Iterating on columns also means U falls out as normalised columns at the
   * end rather than needing a second decomposition.
   */
  function svd3(A) {
    var U = A.slice(), V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var i, p, q;

    for (var sweep = 0; sweep < 40; sweep++) {
      var off = 0;
      for (p = 0; p < 2; p++) {
        for (q = p + 1; q < 3; q++) {
          var app = 0, aqq = 0, apq = 0;
          for (i = 0; i < 3; i++) {
            var up = U[i * 3 + p], uq = U[i * 3 + q];
            app += up * up; aqq += uq * uq; apq += up * uq;
          }
          off += apq * apq;
          if (Math.abs(apq) < 1e-18) continue;

          /* Givens rotation that zeroes the p,q inner product. */
          var tau = (aqq - app) / (2 * apq);
          var t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
          var c = 1 / Math.sqrt(1 + t * t), s = c * t;

          for (i = 0; i < 3; i++) {
            var u1 = U[i * 3 + p], u2 = U[i * 3 + q];
            U[i * 3 + p] = c * u1 - s * u2;
            U[i * 3 + q] = s * u1 + c * u2;
            var v1 = V[i * 3 + p], v2 = V[i * 3 + q];
            V[i * 3 + p] = c * v1 - s * v2;
            V[i * 3 + q] = s * v1 + c * v2;
          }
        }
      }
      if (off < 1e-30) break;
    }

    var S = [0, 0, 0];
    for (q = 0; q < 3; q++) {
      var nrm = Math.hypot(U[q], U[3 + q], U[6 + q]);
      S[q] = nrm;
      if (nrm > 1e-12) { U[q] /= nrm; U[3 + q] /= nrm; U[6 + q] /= nrm; }
    }

    /* A singular value at numerical zero leaves its column as noise divided by
       noise: not orthogonal to the other two, so U is no longer a rotation and
       V*U^T comes out skewed. This is not an exotic edge case — three tie
       points always centre onto a plane, making the covariance rank 2, so this
       runs on the commonest valid fit there is.
       Rebuild the missing direction as the right-handed completion of the two
       good ones. Taking the cyclic pair (k+1, k+2) keeps both U and V proper
       rotations, which is what lets the det correction in solveRigidRot mean
       what it says. */
    var tol = Math.max(S[0], S[1], S[2]) * 1e-9;
    var weak = [];
    for (q = 0; q < 3; q++) if (!(S[q] > tol)) weak.push(q);
    if (weak.length === 1) {
      var k = weak[0];
      setCol(U, k, cross(getCol(U, (k + 1) % 3), getCol(U, (k + 2) % 3)));
      setCol(V, k, cross(getCol(V, (k + 1) % 3), getCol(V, (k + 2) % 3)));
    }

    return { U: U, S: S, V: V };
  }

  function getCol(m, k) { return [m[k], m[3 + k], m[6 + k]]; }
  function setCol(m, k, v) { m[k] = v[0]; m[3 + k] = v[1]; m[6 + k] = v[2]; }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  /* ---------------------------------------------- transforms */

  function identity() {
    return { mode: 'rigid', r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  }

  /** Map one radar-local point onto the mine grid. */
  function apply(tr, x, y, z) {
    var r = tr.r, t = tr.t;
    return [
      r[0] * x + r[1] * y + r[2] * z + t[0],
      r[3] * x + r[4] * y + r[5] * z + t[1],
      r[6] * x + r[7] * y + r[8] * z + t[2]
    ];
  }

  /** Mine grid back to radar-local — used to hit-test a click against a scan. */
  function applyInverse(tr, x, y, z) {
    var r = tr.r, t = tr.t;
    var dx = x - t[0], dy = y - t[1], dz = z - t[2];
    /* R is orthonormal, so the inverse is the transpose — no solve needed. */
    return [
      r[0] * dx + r[3] * dy + r[6] * dz,
      r[1] * dx + r[4] * dy + r[7] * dz,
      r[2] * dx + r[5] * dy + r[8] * dz
    ];
  }

  /** Transform a whole scan in place into freshly allocated site-grid arrays. */
  function applyToScan(tr, scan) {
    var n = scan.n;
    var X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
    var r = tr.r, t = tr.t;
    for (var i = 0; i < n; i++) {
      var x = scan.x[i], y = scan.y[i], z = scan.z[i];
      X[i] = r[0] * x + r[1] * y + r[2] * z + t[0];
      Y[i] = r[3] * x + r[4] * y + r[5] * z + t[1];
      Z[i] = r[6] * x + r[7] * y + r[8] * z + t[2];
    }
    return { x: X, y: Y, z: Z };
  }

  /* ---------------------------------------------- the solve */

  function centroid(pts) {
    var c = [0, 0, 0];
    for (var i = 0; i < pts.length; i++) {
      c[0] += pts[i][0]; c[1] += pts[i][1]; c[2] += pts[i][2];
    }
    c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
    return c;
  }

  /* Rotation about the vertical that best carries centred p onto centred q.
     Closed form: maximising sum(q . Rz(th) p) over th is a single atan2, so
     there is nothing to iterate and nothing to seed. */
  function solveYaw(P, Q) {
    var sc = 0, ss = 0;
    for (var i = 0; i < P.length; i++) {
      sc += Q[i][0] * P[i][0] + Q[i][1] * P[i][1];
      ss += Q[i][1] * P[i][0] - Q[i][0] * P[i][1];
    }
    var th = Math.atan2(ss, sc);
    var c = Math.cos(th), s = Math.sin(th);
    return { r: [c, -s, 0, s, c, 0, 0, 0, 1], theta: th, strength: Math.hypot(sc, ss) };
  }

  /* Full rotation by Kabsch: R = V * diag(1,1,det) * U^T of the cross
     covariance. The det term is what keeps the result a rotation instead of
     letting the fit mirror the scan to shave off residual. */
  function solveRigidRot(P, Q) {
    var H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < P.length; i++) {
      for (var a = 0; a < 3; a++) {
        for (var b = 0; b < 3; b++) H[a * 3 + b] += P[i][a] * Q[i][b];
      }
    }
    var s = svd3(H);
    var Vt = transpose(s.V);
    var d = det3(matMul(s.V, transpose(s.U))) < 0 ? -1 : 1;
    var D = [1, 0, 0, 0, 1, 0, 0, 0, d];
    /* R maps p -> q, i.e. R = V D U^T. */
    var R = matMul(matMul(s.V, D), transpose(s.U));
    return { r: R, sv: s.S };
  }

  /**
   * Fit a transform to hand-placed tied points.
   *
   * @param pairs [{ src:[x,y,z], dst:[x,y,z] }] — src radar-local, dst mine grid
   * @param opts  { mode:'yaw'|'rigid' }
   * @returns { ok, mode, r, t, rms, residuals, maxResidual, worst,
   *            origin, bearingDeg, tiltDeg, warning, error }
   *
   * Always reports per-point residuals, not just the RMS: a single fat-fingered
   * tie is the common failure and an aggregate number hides it, whereas one
   * row standing out names the point to re-place.
   */
  function solve(pairs, opts) {
    opts = opts || {};
    var mode = opts.mode === 'rigid' ? 'rigid' : 'yaw';
    var need = mode === 'rigid' ? 3 : 2;

    if (!pairs || pairs.length < need) {
      return {
        ok: false, mode: mode,
        error: 'Need at least ' + need + ' tied points for a ' +
               (mode === 'rigid' ? 'full 3-D' : 'bearing') + ' fit — ' +
               (pairs ? pairs.length : 0) + ' placed.'
      };
    }

    var src = pairs.map(function (p) { return p.src; });
    var dst = pairs.map(function (p) { return p.dst; });
    var cs = centroid(src), cd = centroid(dst);
    var P = src.map(function (p) { return [p[0] - cs[0], p[1] - cs[1], p[2] - cs[2]]; });
    var Q = dst.map(function (p) { return [p[0] - cd[0], p[1] - cd[1], p[2] - cd[2]]; });

    var R, warning = null;

    if (mode === 'yaw') {
      var yw = solveYaw(P, Q);
      R = yw.r;
      /* All tie points stacked on one vertical line leaves the bearing free. */
      if (yw.strength < 1e-9) {
        return {
          ok: false, mode: mode,
          error: 'Tied points are vertically stacked — the bearing is undetermined. ' +
                 'Place points that are separated horizontally.'
        };
      }
    } else {
      var rg = solveRigidRot(P, Q);
      R = rg.r;
      /* Collinear ties leave rotation about their own axis free, and the fit
         would look perfect while being free to spin — worth refusing.
         The tell is the SECOND singular value collapsing, not the third.
         Three centred points always span a plane, so the cross-covariance is
         rank 2 and its third singular value is identically zero for EVERY
         valid three-point solve; testing that would reject the classic
         minimum case outright. Kabsch handles a rank-2 covariance correctly —
         the det term in solveRigidRot is exactly what resolves the leftover
         sign once the third axis is unconstrained. */
      var sv = rg.sv.slice().sort(function (a, b) { return b - a; });
      if (sv[0] < 1e-12 || sv[1] / sv[0] < 1e-6) {
        return {
          ok: false, mode: mode,
          error: 'Tied points are collinear — a full 3-D fit needs three points ' +
                 'that are not on one line. Add a point off the line, or use the ' +
                 'bearing-only fit.'
        };
      }
    }

    /* t places the sensor head, because the source origin IS the sensor head. */
    var t = [
      cd[0] - (R[0] * cs[0] + R[1] * cs[1] + R[2] * cs[2]),
      cd[1] - (R[3] * cs[0] + R[4] * cs[1] + R[5] * cs[2]),
      cd[2] - (R[6] * cs[0] + R[7] * cs[1] + R[8] * cs[2])
    ];
    var tr = { mode: mode, r: R, t: t };

    var residuals = [], sum = 0, worst = 0, maxR = 0;
    for (var i = 0; i < pairs.length; i++) {
      var f = apply(tr, src[i][0], src[i][1], src[i][2]);
      var e = Math.hypot(f[0] - dst[i][0], f[1] - dst[i][1], f[2] - dst[i][2]);
      residuals.push(e);
      sum += e * e;
      if (e > maxR) { maxR = e; worst = i; }
    }
    var rms = Math.sqrt(sum / pairs.length);

    /* An exactly-determined fit passes through every point by construction, so
       its zero residual is arithmetic, not evidence. Say so — a clean-looking
       0.00 m is otherwise read as a good fit. */
    if (pairs.length === need) {
      warning = 'Exactly ' + need + ' points: the fit passes through them by ' +
                'construction, so the residual cannot detect a mis-click. Add ' +
                'one more point to get a real check.';
    }

    /* Bearing the scan was rotated by, and how far off level the fit came out.
       Tilt is the angle the local vertical was tipped through — under a yaw
       fit it is 0 by definition, so a non-trivial value only ever appears in
       rigid mode, where it is the number that says "the sensor was on a
       slope" or "a tied point is wrong". */
    var bearing = Math.atan2(R[3], R[0]) * DEG;
    if (bearing < 0) bearing += 360;
    var tilt = Math.acos(Math.max(-1, Math.min(1, R[8]))) * DEG;

    return {
      ok: true,
      mode: mode,
      r: R,
      t: t,
      rms: rms,
      residuals: residuals,
      maxResidual: maxR,
      worst: worst,
      origin: t.slice(),      // sensor head on the mine grid
      bearingDeg: bearing,
      tiltDeg: tilt,
      warning: warning
    };
  }

  /* ---------------------------------------------- persistence */

  /* Stored shape is deliberately flat and explicit: nine rotation terms and
     three translations, plus the tied points that produced them. Keeping the
     ties means a georeference can be reopened and adjusted later instead of
     being redone from scratch when a wall gets re-surveyed. */
  function serialise(fit, pairs) {
    return {
      version: 1,
      mode: fit.mode,
      r: Array.prototype.slice.call(fit.r),
      t: Array.prototype.slice.call(fit.t),
      rms: fit.rms,
      bearingDeg: fit.bearingDeg,
      tiltDeg: fit.tiltDeg,
      ties: (pairs || []).map(function (p) {
        return { src: p.src.slice(), dst: p.dst.slice(), label: p.label || null };
      })
    };
  }

  function deserialise(rec) {
    if (!rec || !rec.r || rec.r.length !== 9 || !rec.t || rec.t.length !== 3) return null;
    return {
      mode: rec.mode === 'rigid' ? 'rigid' : 'yaw',
      r: Array.prototype.slice.call(rec.r),
      t: Array.prototype.slice.call(rec.t)
    };
  }

  return {
    solve: solve,
    apply: apply,
    applyInverse: applyInverse,
    applyToScan: applyToScan,
    identity: identity,
    serialise: serialise,
    deserialise: deserialise,
    _svd3: svd3,
    _det3: det3,
    _matMul: matMul
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Georef;
