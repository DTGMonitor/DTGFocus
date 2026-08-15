/* ============================================================
   scan-layer.js — turn a georeferenced radar scan into something drawable,
   and answer "which scans cover this point?".

   Two jobs, both leaning on the fact that a scan is a RANGE IMAGE about the
   sensor rather than a loose point cloud:

     1. Drape — the pixel grid is already a quad mesh, so the surface comes
        free. The only real work is refusing to bridge quads that span an
        occlusion edge, where two neighbouring pixels sit on different walls
        and joining them would hang a curtain across open air.

     2. Cover — a click is carried back into the sensor's own spherical frame,
        where "does this scan see that point" is a bounds check on azimuth and
        elevation plus a range agreement test. No spatial index needed: the
        image IS the index.

   Colour: deformation is signed with a physically meaningful zero, so it takes
   a DIVERGING ramp — two arms with a neutral midpoint, symmetric about 0 mm —
   never a rainbow. A rainbow would put a vivid hue at "no movement", which is
   the one value that must read as nothing happening. The domain is forced
   symmetric for the same reason: an asymmetric stretch slides 0 mm off the
   neutral colour and quietly recolours stable ground. The stops themselves are
   editable, so a site can dial in its own scale without any of that changing.
   ============================================================ */
'use strict';

var ScanLayer = (function () {

  /* ---------------------------------------------- the deformation ramp

     The scale slope-monitoring crews already read: violet at the negative
     limit, through blue to WHITE at zero, then gold to red at the positive
     limit. White in the middle is the whole point — no movement has to look
     like nothing happening — and it is also why the domain below is forced
     symmetric. An asymmetric stretch would slide 0 mm off white and quietly
     recolour stable ground.

     The five stops are lightness-balanced rather than picked by eye. Taken
     literally, "blue" and "yellow" sit at OKLCH L 0.45 and 0.97: the yellow
     arm would wash out against white while the blue arm shouted, so equal
     movement would not read as equal. Both were re-stepped onto a shared
     lightness with their hue kept, giving 0.52 / 0.80 / 1.00 / 0.80 / 0.52 —
     monotonic out from the centre, and matched to within 0.001 per arm. */
  var DEFAULT_STOPS = [
    [0.00, '#8829d6'],   // violet, at -limit
    [0.25, '#91c1ff'],   // blue
    [0.50, '#ffffff'],   // white, at 0 mm
    [0.75, '#ebb500'],   // gold
    [1.00, '#c60009']    // red, at +limit
  ];

  /** A fresh mutable copy — the editor writes straight into what it is given. */
  function defaultStops() {
    return DEFAULT_STOPS.map(function (s) { return [s[0], s[1]]; });
  }

  /**
   * 256-entry LUT for a set of stops.
   *
   * `bands` quantises into flat classes and `gamma` bends the scale without
   * moving the ends — both are the tool's own colour-scale controls, passed
   * straight through so the deformation ramp behaves like every other scale
   * in the app rather than being a special case.
   */
  function lut(stops, opts) {
    opts = opts || {};
    return ColorMaps.buildLUT({
      stops: (stops && stops.length >= 2) ? stops : DEFAULT_STOPS,
      gamma: opts.gamma,
      bands: opts.bands
    });
  }

  /**
   * Colour domain, forced symmetric about zero.
   *
   * `clip` trims the tails to a percentile so one noisy pixel cannot flatten
   * the whole scan to the middle of the ramp — the usual reason a deformation
   * image comes out looking uniformly grey.
   */
  function domain(scan, opts) {
    opts = opts || {};
    if (isFinite(opts.limit) && opts.limit > 0) {
      return { vmin: -opts.limit, vmax: +opts.limit, limit: opts.limit };
    }
    var lim;
    var pct = opts.clipPercentile;
    if (pct > 0 && pct < 50) {
      var a = Float32Array.prototype.slice.call(scan.def).sort();
      var k = Math.floor(scan.n * (pct / 100));
      lim = Math.max(Math.abs(a[k]), Math.abs(a[scan.n - 1 - k]));
    } else {
      lim = Math.max(Math.abs(scan.defMin), Math.abs(scan.defMax));
    }
    if (!(lim > 0)) lim = 1;
    return { vmin: -lim, vmax: +lim, limit: lim };
  }

  /**
   * Per-vertex RGB in 0..1, ready for a vertex-coloured draw.
   * `ramp` is either a stops array or an already-built LUT.
   */
  function colours(scan, dom, ramp) {
    var L = (ramp && ramp.BYTES_PER_ELEMENT) ? ramp : lut(ramp);
    var out = new Float32Array(scan.n * 3);
    var span = dom.vmax - dom.vmin;
    for (var i = 0; i < scan.n; i++) {
      var t = (scan.def[i] - dom.vmin) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var c = ColorMaps.sample(L, t);
      out[i * 3] = c[0] / 255; out[i * 3 + 1] = c[1] / 255; out[i * 3 + 2] = c[2] / 255;
    }
    return out;
  }

  /* ---------------------------------------------- angular geometry */

  /* Median angle between horizontally and vertically adjacent pixels. Measured
     rather than assumed because beam spacing differs per radar and per scan
     window, and it is the yardstick every occlusion test below is scaled by. */
  function angularStep(scan) {
    var nx = scan.nx, ny = scan.ny, idx = scan.idx;
    var samples = [], i, j;
    var stride = Math.max(1, Math.floor((nx * ny) / 4000));
    var c = 0;
    for (j = 0; j < ny; j++) {
      for (i = 0; i + 1 < nx; i++) {
        if (c++ % stride) continue;
        var p = idx[j * nx + i], q = idx[j * nx + i + 1];
        if (p < 0 || q < 0) continue;
        var d = angleBetween(scan, p, q);
        if (d > 0) samples.push(d);
      }
    }
    if (!samples.length) return 0.004;   // ~4 mrad, a typical beam step
    samples.sort(function (a, b) { return a - b; });
    return samples[samples.length >> 1];
  }

  function angleBetween(scan, p, q) {
    var ax = scan.x[p], ay = scan.y[p], az = scan.z[p];
    var bx = scan.x[q], by = scan.y[q], bz = scan.z[q];
    var la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (!(la > 0) || !(lb > 0)) return 0;
    var dot = (ax * bx + ay * by + az * bz) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  /* ---------------------------------------------- drape mesh */

  /**
   * Build a triangle mesh from the pixel grid, in mine-grid coordinates.
   *
   * A quad is emitted only when all four corners returned a signal AND no edge
   * is longer than `maxEdgeFactor` times the spacing a continuous surface
   * would have at that range. That factor is a grazing-incidence allowance:
   * a wall seen almost edge-on legitimately stretches its pixels, so the limit
   * has to sit well above 1, while a true occlusion gap overshoots it by
   * orders of magnitude.
   *
   * The default of 32 is measured, not guessed. Histogramming that edge/spacing
   * ratio over the sample exports gives a strongly bimodal distribution: a
   * continuous-ground population decaying from ratio 1 through about 16, then a
   * separate occlusion population from roughly 64 upward (edges hundreds of
   * times nominal spacing — gaps across open air, not steep ground). Between
   * them sits a density valley around 32-128 holding only 1-3% of quads on
   * every scan tested, so 32 lands in the gap on all of them rather than
   * cutting into real wall. Erring toward cutting is deliberate: a false
   * surface drapes deformation colour across a void and reads as ground, which
   * is worse than an honest hole.
   */
  function buildMesh(scan, transform, opts) {
    opts = opts || {};
    var k = opts.maxEdgeFactor > 0 ? opts.maxEdgeFactor : 32;
    var ang = opts.angularStep > 0 ? opts.angularStep : angularStep(scan);

    var w = Georef.applyToScan(transform, scan);
    var nx = scan.nx, ny = scan.ny, idx = scan.idx;

    /* Optionally slide every pixel down its own line of sight until it lands
       on the survey surface, so the drape cannot float above or sink into the
       terrain. See drapeToTerrain for what that trades away. */
    var rng = scan.range, alive = null, drape = null;
    if (opts.terrain) {
      drape = drapeToTerrain(scan, transform, opts.terrain, w);
      rng = drape.range;
      alive = drape.alive;
    }

    /* Two triangles per quad, three indices each. */
    var tri = new Uint32Array((nx - 1) * (ny - 1) * 6);
    var nt = 0, dropped = 0;

    for (var j = 0; j + 1 < ny; j++) {
      for (var i = 0; i + 1 < nx; i++) {
        var a = idx[j * nx + i],
            b = idx[j * nx + i + 1],
            c = idx[(j + 1) * nx + i],
            d = idx[(j + 1) * nx + i + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) { dropped++; continue; }
        /* When draped, a pixel whose sight line never met the terrain has no
           honest position to draw at. */
        if (alive && !(alive[a] && alive[b] && alive[c] && alive[d])) { dropped++; continue; }

        /* Conservative: scale the allowance by the NEAREST corner, so a quad
           straddling a near edge and a far wall is judged against the near
           one and gets cut. */
        var rmin = Math.min(rng[a], rng[b], rng[c], rng[d]);
        var lim = k * Math.max(rmin, 1) * ang;
        var lim2 = lim * lim;

        if (d2(w, a, b) > lim2 || d2(w, a, c) > lim2 ||
            d2(w, b, d) > lim2 || d2(w, c, d) > lim2 || d2(w, a, d) > lim2) {
          dropped++;
          continue;
        }

        tri[nt++] = a; tri[nt++] = c; tri[nt++] = b;
        tri[nt++] = b; tri[nt++] = c; tri[nt++] = d;
      }
    }

    var mesh = {
      pos: w,                       // {x,y,z} Float64Array, mine grid
      index: tri.subarray(0, nt),
      triCount: nt / 3,
      droppedQuads: dropped,
      angularStep: ang
    };
    mesh.bounds = bounds(mesh);
    mesh.normals = normals(mesh);
    mesh.drape = drape;
    return mesh;
  }

  /**
   * Slide every pixel along its line of sight until it meets the survey
   * surface, replacing the radar's own range with the terrain's.
   *
   * Why this closes the gap: a georeference is a RIGID transform, so it can
   * only put the scan in the right place as a whole. Wherever the fit is a few
   * metres out — or the pit has been cut since the survey — the scan sits off
   * the ground and hangs in space. Projecting removes that entirely, because
   * the position is taken from the terrain rather than from the radar.
   *
   * What it trades away, and why the caller is told: the LOS offset it had to
   * absorb IS the georeference error. Draping hides that error rather than
   * fixing it, so a bad pose now looks clean. `medianOffset` is reported back
   * so the operator can still see how far the pose really is out.
   *
   * The march runs from the sensor outward and takes the FIRST surface it
   * meets, which is what the radar itself would have seen — starting nearer
   * the reported range would be faster but could snap a pixel onto a wall
   * behind the one that actually returned the signal.
   */
  function drapeToTerrain(scan, transform, grid, w) {
    var ox = transform.t[0], oy = transform.t[1], oz = transform.t[2];
    var alive = new Uint8Array(scan.n);
    var rng = new Float32Array(scan.n);
    var offsets = [];
    var missed = 0;

    for (var i = 0; i < scan.n; i++) {
      var dx = w.x[i] - ox, dy = w.y[i] - oy, dz = w.z[i] - oz;
      /* Look well past the reported range: if the pose is out, the terrain
         crossing is not where the radar said it was. */
      var hit = Grid.rayHit(grid, ox, oy, oz, dx, dy, dz, scan.range[i] * 2.5 + 100);
      if (!hit) { missed++; rng[i] = scan.range[i]; continue; }
      w.x[i] = hit.x; w.y[i] = hit.y; w.z[i] = hit.z;
      rng[i] = hit.t;
      alive[i] = 1;
      offsets.push(Math.abs(hit.t - scan.range[i]));
    }

    offsets.sort(function (a, b) { return a - b; });
    return {
      alive: alive,
      range: rng,
      missed: missed,
      hit: scan.n - missed,
      medianOffset: offsets.length ? offsets[offsets.length >> 1] : NaN
    };
  }

  /**
   * Area-weighted vertex normals, so the drape can be lit by the same shader
   * the terrain uses. Accumulating the raw cross products rather than
   * normalising per face is what does the area weighting — a big triangle
   * should steer the shared vertex more than a sliver does.
   *
   * Pixels that survived parsing but ended up in no triangle (their quads were
   * all cut) keep a straight-up normal; they are never drawn, and leaving a
   * zero there would put a NaN through the shader.
   */
  function normals(mesh) {
    var w = mesh.pos, n = w.x.length, idx = mesh.index;
    var out = new Float32Array(n * 3);

    for (var t = 0; t < idx.length; t += 3) {
      var a = idx[t], b = idx[t + 1], c = idx[t + 2];
      var ux = w.x[b] - w.x[a], uy = w.y[b] - w.y[a], uz = w.z[b] - w.z[a];
      var vx = w.x[c] - w.x[a], vy = w.y[c] - w.y[a], vz = w.z[c] - w.z[a];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      out[a * 3] += nx; out[a * 3 + 1] += ny; out[a * 3 + 2] += nz;
      out[b * 3] += nx; out[b * 3 + 1] += ny; out[b * 3 + 2] += nz;
      out[c * 3] += nx; out[c * 3 + 1] += ny; out[c * 3 + 2] += nz;
    }

    for (var i = 0; i < n; i++) {
      var x = out[i * 3], y = out[i * 3 + 1], z = out[i * 3 + 2];
      var L = Math.hypot(x, y, z);
      if (L > 1e-12) { out[i * 3] = x / L; out[i * 3 + 1] = y / L; out[i * 3 + 2] = z / L; }
      else { out[i * 3] = 0; out[i * 3 + 1] = 0; out[i * 3 + 2] = 1; }
    }
    return out;
  }

  function d2(w, p, q) {
    var dx = w.x[p] - w.x[q], dy = w.y[p] - w.y[q], dz = w.z[p] - w.z[q];
    return dx * dx + dy * dy + dz * dz;
  }

  /** Axis-aligned bounds of the georeferenced scan — a cheap pre-filter. */
  function bounds(mesh) {
    var w = mesh.pos, n = w.x.length;
    var b = {
      xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity,
      zmin: Infinity, zmax: -Infinity
    };
    for (var i = 0; i < n; i++) {
      if (w.x[i] < b.xmin) b.xmin = w.x[i];
      if (w.x[i] > b.xmax) b.xmax = w.x[i];
      if (w.y[i] < b.ymin) b.ymin = w.y[i];
      if (w.y[i] > b.ymax) b.ymax = w.y[i];
      if (w.z[i] < b.zmin) b.zmin = w.z[i];
      if (w.z[i] > b.zmax) b.zmax = w.z[i];
    }
    return b;
  }

  /* ---------------------------------------------- coverage test */

  /**
   * Precompute the sensor-frame angular table a coverage test needs.
   *
   * Azimuth is unwrapped against the scan's own mean bearing so a footprint
   * straddling due north does not split into two lobes at the +/-180 seam.
   */
  function coverageIndex(scan, transform, opts) {
    opts = opts || {};
    var n = scan.n;
    var az = new Float32Array(n), el = new Float32Array(n);
    var sx = 0, sy = 0, i;

    for (i = 0; i < n; i++) {
      var x = scan.x[i], y = scan.y[i], z = scan.z[i];
      var h = Math.hypot(x, y);
      az[i] = Math.atan2(y, x);
      el[i] = Math.atan2(z, h);
      sx += Math.cos(az[i]); sy += Math.sin(az[i]);
    }
    var centre = Math.atan2(sy, sx);

    var amin = Infinity, amax = -Infinity, emin = Infinity, emax = -Infinity;
    for (i = 0; i < n; i++) {
      var w = wrap(az[i] - centre);
      az[i] = w;
      if (w < amin) amin = w;
      if (w > amax) amax = w;
      if (el[i] < emin) emin = el[i];
      if (el[i] > emax) emax = el[i];
    }

    return {
      az: az, el: el, centre: centre,
      amin: amin, amax: amax, emin: emin, emax: emax,
      step: angularStep(scan),
      transform: transform,
      /* Where the surface actually IS along each sight line. When the drape has
         been projected onto the terrain that is the terrain's range, not the
         radar's — without this, a click on the draped surface would be judged
         against the radar's original range and fall outside tolerance, so a
         folder the operator can plainly see would report as not covering the
         point. */
      range: opts.range || scan.range
    };
  }

  function wrap(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /**
   * Does this scan cover a mine-grid point, and with what value?
   *
   * The range agreement test is what keeps a click on the near wall from
   * matching a pixel on the far wall that merely lies along the same line of
   * sight. `rangeTol` is generous by default because the terrain model and the
   * scan are independently georeferenced and will not agree to the metre.
   *
   * Returns null when the point is outside the footprint — "not covered" is a
   * real answer, and the caller lists a folder only when this is non-null.
   */
  function coverAt(scan, cidx, wx, wy, wz, opts) {
    opts = opts || {};
    var tolFactor = opts.angleTolPixels > 0 ? opts.angleTolPixels : 1.5;
    var rangeTol = opts.rangeTol > 0 ? opts.rangeTol : 50;

    var p = Georef.applyInverse(cidx.transform, wx, wy, wz);
    var h = Math.hypot(p[0], p[1]);
    var r = Math.hypot(h, p[2]);
    if (!(r > 0)) return null;

    var a = wrap(Math.atan2(p[1], p[0]) - cidx.centre);
    var e = Math.atan2(p[2], h);

    var pad = cidx.step * tolFactor;
    if (a < cidx.amin - pad || a > cidx.amax + pad) return null;
    if (e < cidx.emin - pad || e > cidx.emax + pad) return null;

    /* Nearest pixel by angle. A linear pass over at most ~25k pixels is well
       under a frame, and it sidesteps building an index that would have to be
       rebuilt every time the georeference is nudged. */
    var best = -1, bestD = Infinity;
    for (var i = 0; i < scan.n; i++) {
      var da = a - cidx.az[i], de = e - cidx.el[i];
      var dd = da * da + de * de;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (best < 0) return null;

    var angErr = Math.sqrt(bestD);
    if (angErr > pad) return null;

    var surfaceRange = (cidx.range || scan.range)[best];
    var dr = r - surfaceRange;
    if (Math.abs(dr) > rangeTol) return null;

    return {
      index: best,
      px: scan.px[best], py: scan.py[best],
      def: scan.def[best],
      range: surfaceRange,
      angleErrPixels: angErr / cidx.step,
      rangeErr: dr
    };
  }

  /* ---------------------------------------------- portable footprint

     The CSVs stay on the operator's machine but the georeference is shared, so
     a fresh session can know a folder is registered without holding any scan.
     For "what covers this point" to still work there, the record carries a
     coarse range image: the angular bounds plus a downsampled grid of ranges,
     a few kilobytes of JSON rather than the 25k-pixel original.

     It is an approximation and is treated as one — the tolerances below are
     looser than the exact test's, because a 48x24 grid cannot resolve a bench
     edge. Once the CSV is loaded the exact test takes over. */

  function footprint(scan, cidx, opts) {
    opts = opts || {};
    var gx = opts.gx || 48, gy = opts.gy || 24;
    var aspan = (cidx.amax - cidx.amin) || 1e-6;
    var espan = (cidx.emax - cidx.emin) || 1e-6;

    var sum = new Float64Array(gx * gy), cnt = new Uint32Array(gx * gy);
    for (var i = 0; i < scan.n; i++) {
      var cx = Math.floor((cidx.az[i] - cidx.amin) / aspan * gx);
      var cy = Math.floor((cidx.el[i] - cidx.emin) / espan * gy);
      if (cx < 0) cx = 0; if (cx >= gx) cx = gx - 1;
      if (cy < 0) cy = 0; if (cy >= gy) cy = gy - 1;
      var c = cy * gx + cx;
      sum[c] += scan.range[i]; cnt[c]++;
    }

    /* -1 marks a cell the scan never illuminated, which is a real answer:
       a hole in the fan is not covered. */
    var rg = new Array(gx * gy);
    for (var c2 = 0; c2 < rg.length; c2++) {
      rg[c2] = cnt[c2] ? Math.round(sum[c2] / cnt[c2]) : -1;
    }

    return {
      centre: cidx.centre,
      amin: cidx.amin, amax: cidx.amax,
      emin: cidx.emin, emax: cidx.emax,
      step: cidx.step, gx: gx, gy: gy, rg: rg
    };
  }

  /** Approximate coverage from a stored footprint, no scan required. */
  function coverFootprint(fp, transform, wx, wy, wz, opts) {
    opts = opts || {};
    var rangeTol = opts.rangeTol > 0 ? opts.rangeTol : 80;

    var p = Georef.applyInverse(transform, wx, wy, wz);
    var h = Math.hypot(p[0], p[1]);
    var r = Math.hypot(h, p[2]);
    if (!(r > 0)) return null;

    var a = wrap(Math.atan2(p[1], p[0]) - fp.centre);
    var e = Math.atan2(p[2], h);
    var pad = fp.step * 1.5;
    if (a < fp.amin - pad || a > fp.amax + pad) return null;
    if (e < fp.emin - pad || e > fp.emax + pad) return null;

    var aspan = (fp.amax - fp.amin) || 1e-6, espan = (fp.emax - fp.emin) || 1e-6;
    var cx = Math.floor((a - fp.amin) / aspan * fp.gx);
    var cy = Math.floor((e - fp.emin) / espan * fp.gy);
    if (cx < 0) cx = 0; if (cx >= fp.gx) cx = fp.gx - 1;
    if (cy < 0) cy = 0; if (cy >= fp.gy) cy = fp.gy - 1;

    var rr = fp.rg[cy * fp.gx + cx];
    if (!(rr >= 0)) return null;

    /* A coarse cell averages over a patch of wall, so the range it reports can
       legitimately sit a cell-width of relief away from the true surface. */
    var slack = rangeTol + rr * fp.step * Math.max(fp.gx, fp.gy) * 0.25;
    var dr = r - rr;
    if (Math.abs(dr) > slack) return null;

    return { approximate: true, range: rr, rangeErr: dr };
  }

  return {
    DEFAULT_STOPS: DEFAULT_STOPS,
    defaultStops: defaultStops,
    lut: lut,
    domain: domain,
    colours: colours,
    angularStep: angularStep,
    buildMesh: buildMesh,
    drapeToTerrain: drapeToTerrain,
    bounds: bounds,
    normals: normals,
    coverageIndex: coverageIndex,
    footprint: footprint,
    coverFootprint: coverFootprint,
    coverAt: coverAt
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ScanLayer;
