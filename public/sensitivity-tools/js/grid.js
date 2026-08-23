/* ============================================================
   grid.js — build a regular elevation raster from points / TINs and
   derive the surface geometry the sensitivity model needs.

   Grid convention:  node (i,j) → x = x0 + i*dx , y = y0 + j*dy
                     z[j*nx + i]   (NaN = no data)  , j runs south→north
   ============================================================ */
'use strict';

var Grid = (function () {

  /* ------------------------------------------------ merge datasets */
  function merge(list) {
    var np = 0, nt = 0, i;
    /* node-bearing files first, so an index-only Surpac .dtm can borrow
       the vertices of the .str it was loaded with */
    list = list.slice().sort(function (a, b) {
      var ka = (a.kind === 'tri-index') ? 1 : 0, kb = (b.kind === 'tri-index') ? 1 : 0;
      return ka - kb;
    });
    for (i = 0; i < list.length; i++) {
      if (list[i].grid) continue;
      np += (list[i].pts || []).length;
      nt += (list[i].tris || []).length;
    }
    var pts = new Float64Array(np), tris = nt ? new Uint32Array(nt) : null;
    var po = 0, to = 0, base = 0, needNodes = false;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.grid) continue;
      var p = d.pts || [], t = d.tris || [];
      for (var k = 0; k < p.length; k++) pts[po + k] = p[k];
      var vbase = po / 3;
      /* an index-only Surpac .dtm borrows the nodes of the .str loaded with it */
      var ibase = (d.kind === 'tri-index') ? 0 : vbase;
      if (d.kind === 'tri-index') needNodes = true;
      for (var m = 0; m < t.length; m++) tris[to + m] = t[m] + ibase;
      po += p.length; to += t.length; base = vbase;
    }
    /* drop triangles whose node numbers fall outside the loaded vertices —
       happens when a .dtm is paired with the wrong .str */
    var dropped = 0;
    if (tris) {
      var nv = pts.length / 3, w = 0;
      for (var q = 0; q < tris.length; q += 3) {
        if (tris[q] < nv && tris[q + 1] < nv && tris[q + 2] < nv) {
          tris[w++] = tris[q]; tris[w++] = tris[q + 1]; tris[w++] = tris[q + 2];
        } else dropped++;
      }
      tris = tris.subarray(0, w);
      if (!w) tris = null;
    }
    return { pts: pts, tris: tris, needNodes: needNodes, dropped: dropped };
  }

  function bbox(pts) {
    var b = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity, zmin: Infinity, zmax: -Infinity };
    for (var i = 0; i < pts.length; i += 3) {
      var x = pts[i], y = pts[i + 1], z = pts[i + 2];
      if (x < b.xmin) b.xmin = x; if (x > b.xmax) b.xmax = x;
      if (y < b.ymin) b.ymin = y; if (y > b.ymax) b.ymax = y;
      if (z < b.zmin) b.zmin = z; if (z > b.zmax) b.zmax = z;
    }
    return b;
  }

  /* ------------------------------------------------------ build */
  /**
   * opts = {cell, targetCells, searchCells, interp:'idw'|'nearest'|'mean',
   *         fill:bool, fillIter, smooth:0..5}
   */
  function build(merged, opts) {
    opts = opts || {};
    var pts = merged.pts, tris = merged.tris;
    if (!pts.length) {
      if (merged.needNodes) throw new Error(
        'This Surpac .dtm holds only the triangle list — the XYZ coordinates live in the ' +
        'matching .str file. Load BOTH files together (select both in the dialog, or drag ' +
        'them in at the same time).');
      throw new Error('No coordinates found in the loaded file(s).');
    }
    var b = bbox(pts);
    var W = b.xmax - b.xmin, H = b.ymax - b.ymin;
    if (!(W > 0) || !(H > 0)) throw new Error('Degenerate extent — check the column mapping (X / Y may be identical).');

    var target = Math.max(40, Math.min(1400, opts.targetCells || 320));
    var cell = opts.cell > 0 ? opts.cell : Math.max(W, H) / target;
    var nx = Math.max(2, Math.floor(W / cell) + 1);
    var ny = Math.max(2, Math.floor(H / cell) + 1);
    /* guard rail on total memory */
    var MAXN = 2200000;
    while (nx * ny > MAXN) { cell *= 1.25; nx = Math.floor(W / cell) + 1; ny = Math.floor(H / cell) + 1; }

    var g = {
      nx: nx, ny: ny, dx: cell, dy: cell, x0: b.xmin, y0: b.ymin,
      z: new Float32Array(nx * ny), src: b, cell: cell
    };
    g.z.fill(NaN);

    var filledBy = 'idw';
    if (tris && tris.length >= 3) { rasterTris(g, pts, tris); filledBy = 'tin'; }
    var missing = countNaN(g.z);
    if (missing > 0 && (!tris || missing > 0.15 * nx * ny)) {
      idw(g, pts, opts);            // points-only models, or gaps left by the TIN
      if (filledBy === 'tin') filledBy = 'tin+idw';
    }

    if (opts.fill !== false) fillHoles(g, opts.fillIter == null ? 2 : opts.fillIter | 0);
    if (opts.smooth > 0) smoothZ(g, opts.smooth | 0);

    /* z range of the raster */
    var zmin = Infinity, zmax = -Infinity, valid = 0;
    for (var i = 0; i < g.z.length; i++) {
      var v = g.z[i];
      if (v !== v) continue;
      valid++;
      if (v < zmin) zmin = v; if (v > zmax) zmax = v;
    }
    g.zmin = valid ? zmin : 0; g.zmax = valid ? zmax : 1;
    g.valid = valid;
    g.method = filledBy;
    g.nPoints = pts.length / 3;
    g.nTris = tris ? tris.length / 3 : 0;
    g.dropped = merged.dropped || 0;
    if (!valid) throw new Error('Gridding produced no valid cells — try a bigger cell size / search radius.');
    return g;
  }

  function countNaN(z) { var n = 0; for (var i = 0; i < z.length; i++) if (z[i] !== z[i]) n++; return n; }

  /* --------------------------------------- TIN → raster (max z) */
  function rasterTris(g, pts, tris) {
    var nx = g.nx, ny = g.ny, z = g.z, x0 = g.x0, y0 = g.y0, dx = g.dx, dy = g.dy;
    for (var t = 0; t < tris.length; t += 3) {
      var i0 = tris[t] * 3, i1 = tris[t + 1] * 3, i2 = tris[t + 2] * 3;
      var ax = pts[i0], ay = pts[i0 + 1], az = pts[i0 + 2];
      var bx = pts[i1], by = pts[i1 + 1], bz = pts[i1 + 2];
      var cx = pts[i2], cy = pts[i2 + 1], cz = pts[i2 + 2];
      var minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx);
      var miny = Math.min(ay, by, cy), maxy = Math.max(ay, by, cy);
      var ci0 = Math.max(0, Math.floor((minx - x0) / dx)), ci1 = Math.min(nx - 1, Math.ceil((maxx - x0) / dx));
      var cj0 = Math.max(0, Math.floor((miny - y0) / dy)), cj1 = Math.min(ny - 1, Math.ceil((maxy - y0) / dy));
      if (ci1 < ci0 || cj1 < cj0) continue;
      var d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue;
      for (var j = cj0; j <= cj1; j++) {
        var py = y0 + j * dy, row = j * nx;
        for (var i = ci0; i <= ci1; i++) {
          var px = x0 + i * dx;
          var l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
          if (l1 < -1e-6 || l1 > 1 + 1e-6) continue;
          var l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
          if (l2 < -1e-6 || l2 > 1 + 1e-6) continue;
          var l3 = 1 - l1 - l2;
          if (l3 < -1e-6) continue;
          var zz = l1 * az + l2 * bz + l3 * cz;
          var cur = z[row + i];
          if (cur !== cur || zz > cur) z[row + i] = zz;
        }
      }
    }
  }

  /* ----------------------------------------- scattered points → raster */
  function idw(g, pts, opts) {
    var nx = g.nx, ny = g.ny, dx = g.dx, dy = g.dy, x0 = g.x0, y0 = g.y0, z = g.z;
    var R = Math.max(1, opts.searchCells || 2);
    var np = pts.length / 3;
    var ncell = nx * ny;

    /* bucket points by cell (counting sort) */
    var counts = new Int32Array(ncell + 1);
    var cellIdx = new Int32Array(np);
    var i, ci, cj, c;
    for (i = 0; i < np; i++) {
      ci = Math.round((pts[i * 3] - x0) / dx);
      cj = Math.round((pts[i * 3 + 1] - y0) / dy);
      if (ci < 0) ci = 0; if (ci >= nx) ci = nx - 1;
      if (cj < 0) cj = 0; if (cj >= ny) cj = ny - 1;
      c = cj * nx + ci; cellIdx[i] = c; counts[c + 1]++;
    }
    for (i = 0; i < ncell; i++) counts[i + 1] += counts[i];
    var order = new Int32Array(np), cursor = counts.slice(0, ncell);
    for (i = 0; i < np; i++) { order[cursor[cellIdx[i]]++] = i; }

    var rad = R * Math.max(dx, dy) * 1.05, rad2 = rad * rad;
    var mode = opts.interp || 'idw';

    for (var j = 0; j < ny; j++) {
      var py = y0 + j * dy, row = j * nx;
      for (var ii = 0; ii < nx; ii++) {
        if (z[row + ii] === z[row + ii]) continue;          // already set by the TIN
        var px = x0 + ii * dx;
        var wsum = 0, vsum = 0, best = Infinity, bestZ = NaN, n = 0;
        for (var dj = -R; dj <= R; dj++) {
          var jj = j + dj; if (jj < 0 || jj >= ny) continue;
          for (var di = -R; di <= R; di++) {
            var iii = ii + di; if (iii < 0 || iii >= nx) continue;
            var cc = jj * nx + iii;
            for (var k = counts[cc]; k < counts[cc + 1]; k++) {
              var pi = order[k] * 3;
              var ddx = pts[pi] - px, ddy = pts[pi + 1] - py;
              var d2 = ddx * ddx + ddy * ddy;
              if (d2 > rad2) continue;
              var pz = pts[pi + 2];
              n++;
              if (d2 < best) { best = d2; bestZ = pz; }
              if (mode === 'mean') { vsum += pz; wsum += 1; }
              else if (mode === 'idw') { var w = 1 / (d2 + 1e-6); vsum += pz * w; wsum += w; }
            }
          }
        }
        if (!n) continue;
        if (mode === 'nearest') z[row + ii] = bestZ;
        else if (best < 1e-8) z[row + ii] = bestZ;
        else z[row + ii] = vsum / wsum;
      }
    }
  }

  /* ------------------------------------------------- hole filling */
  function fillHoles(g, iter) {
    if (!iter) return;
    var nx = g.nx, ny = g.ny, z = g.z;
    for (var it = 0; it < iter; it++) {
      var add = [], cnt = 0;
      for (var j = 0; j < ny; j++) {
        for (var i = 0; i < nx; i++) {
          var id = j * nx + i;
          if (z[id] === z[id]) continue;
          var s = 0, n = 0;
          for (var dj = -1; dj <= 1; dj++) {
            var jj = j + dj; if (jj < 0 || jj >= ny) continue;
            for (var di = -1; di <= 1; di++) {
              var ii = i + di; if (ii < 0 || ii >= nx) continue;
              var v = z[jj * nx + ii];
              if (v === v) { s += v; n++; }
            }
          }
          if (n >= 4) { add.push(id, s / n); cnt++; }
        }
      }
      if (!cnt) break;
      for (var k = 0; k < add.length; k += 2) z[add[k]] = add[k + 1];
    }
  }

  /* ------------------------------------------------ light smoothing */
  function smoothZ(g, passes) {
    var nx = g.nx, ny = g.ny;
    for (var p = 0; p < passes; p++) {
      var out = new Float32Array(g.z);
      for (var j = 1; j < ny - 1; j++) {
        for (var i = 1; i < nx - 1; i++) {
          var id = j * nx + i;
          if (g.z[id] !== g.z[id]) continue;
          var s = 0, n = 0;
          for (var dj = -1; dj <= 1; dj++)for (var di = -1; di <= 1; di++) {
            var v = g.z[(j + dj) * nx + (i + di)];
            if (v === v) { var w = (di === 0 && dj === 0) ? 4 : 1; s += v * w; n += w; }
          }
          out[id] = s / n;
        }
      }
      g.z = out;
    }
  }

  /* -------------------------------------------- surface derivatives */
  /** slope (rad), aspect (rad, 0=N clockwise), unit normal, gradient fx,fy */
  function derive(g) {
    var nx = g.nx, ny = g.ny, z = g.z, dx = g.dx, dy = g.dy, n = nx * ny;
    var fx = new Float32Array(n), fy = new Float32Array(n);
    var nxv = new Float32Array(n), nyv = new Float32Array(n), nzv = new Float32Array(n);
    var slope = new Float32Array(n), aspect = new Float32Array(n);

    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var id = j * nx + i;
        if (z[id] !== z[id]) { slope[id] = NaN; aspect[id] = NaN; nzv[id] = 1; continue; }
        var zL = zAt(z, nx, ny, i - 1, j), zR = zAt(z, nx, ny, i + 1, j);
        var zD = zAt(z, nx, ny, i, j - 1), zU = zAt(z, nx, ny, i, j + 1);
        var gx, gy;
        if (zL === zL && zR === zR) gx = (zR - zL) / (2 * dx);
        else if (zR === zR) gx = (zR - z[id]) / dx;
        else if (zL === zL) gx = (z[id] - zL) / dx;
        else gx = 0;
        if (zD === zD && zU === zU) gy = (zU - zD) / (2 * dy);
        else if (zU === zU) gy = (zU - z[id]) / dy;
        else if (zD === zD) gy = (z[id] - zD) / dy;
        else gy = 0;
        fx[id] = gx; fy[id] = gy;
        var mag = Math.sqrt(gx * gx + gy * gy);
        slope[id] = Math.atan(mag);
        /* aspect = downslope azimuth, degrees from north, clockwise */
        var az = Math.atan2(-gx, -gy) * 180 / Math.PI;   // (-gx,-gy) = downslope
        if (az < 0) az += 360;
        aspect[id] = az;
        var L = Math.sqrt(gx * gx + gy * gy + 1);
        nxv[id] = -gx / L; nyv[id] = -gy / L; nzv[id] = 1 / L;
      }
    }
    return { fx: fx, fy: fy, nx: nxv, ny: nyv, nz: nzv, slope: slope, aspect: aspect };
  }
  function zAt(z, nx, ny, i, j) {
    if (i < 0 || i >= nx || j < 0 || j >= ny) return NaN;
    return z[j * nx + i];
  }

  /* --------------------------------------------- bilinear sampling */
  function sampleZ(g, x, y) {
    var fi = (x - g.x0) / g.dx, fj = (y - g.y0) / g.dy;
    var i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) {
      var ii = Math.round(fi), jj = Math.round(fj);
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) return NaN;
      return g.z[jj * g.nx + ii];
    }
    var tx = fi - i, ty = fj - j, nx = g.nx;
    var z00 = g.z[j * nx + i], z10 = g.z[j * nx + i + 1];
    var z01 = g.z[(j + 1) * nx + i], z11 = g.z[(j + 1) * nx + i + 1];
    var ok = (z00 === z00) + (z10 === z10) + (z01 === z01) + (z11 === z11);
    if (ok === 4) {
      return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
    }
    if (ok === 0) return NaN;
    /* partial: nearest valid corner */
    var best = Infinity, bz = NaN;
    var cs = [[z00, 0, 0], [z10, 1, 0], [z01, 0, 1], [z11, 1, 1]];
    for (var k = 0; k < 4; k++) {
      var v = cs[k][0]; if (v !== v) continue;
      var d = (tx - cs[k][1]) * (tx - cs[k][1]) + (ty - cs[k][2]) * (ty - cs[k][2]);
      if (d < best) { best = d; bz = v; }
    }
    return bz;
  }

  /* ------------------------------------ line-of-sight occlusion test */
  /**
   * true when the straight line R→T stays above the terrain.
   * stepCells: sampling interval in cells (0.5 fine … 2 coarse)
   */
  function losClear(g, rx, ry, rz, tx, ty, tz, stepCells, tol) {
    var dx = tx - rx, dy = ty - ry, dz = tz - rz;
    var horiz = Math.sqrt(dx * dx + dy * dy);
    if (horiz < 1e-6) return true;
    var stepLen = Math.max(0.05, stepCells) * g.dx;
    var n = Math.ceil(horiz / stepLen);
    if (n < 2) return true;
    /* stop short of the target so the target cell itself never shadows it */
    var stopF = 1 - Math.max(1.5 * g.dx, 1e-6) / horiz;
    if (stopF <= 0) return true;
    for (var k = 1; k < n; k++) {
      var f = k / n;
      if (f > stopF) break;
      var px = rx + dx * f, py = ry + dy * f, pz = rz + dz * f;
      var zt = sampleZ(g, px, py);
      if (zt !== zt) continue;
      if (zt > pz + tol) return false;
    }
    return true;
  }

  /**
   * Same march as losClear, but reports the WORST obstruction instead of
   * bailing out at the first one — used by the probe to explain a shadow.
   * Returns null when the sight line is clear, otherwise
   * {f, dist, excess, x, y, z, raise} where `excess` is how far the terrain
   * pokes above the sight line and `raise` is how much higher the antenna
   * would have to sit to clear it.
   */
  function losBlocker(g, rx, ry, rz, tx, ty, tz, stepCells, tol) {
    var dx = tx - rx, dy = ty - ry, dz = tz - rz;
    var horiz = Math.sqrt(dx * dx + dy * dy);
    if (horiz < 1e-6) return null;
    var slant = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var stepLen = Math.max(0.05, stepCells) * g.dx;
    var n = Math.ceil(horiz / stepLen);
    if (n < 2) return null;
    var stopF = 1 - Math.max(1.5 * g.dx, 1e-6) / horiz;
    if (stopF <= 0) return null;
    var worst = null;
    for (var k = 1; k < n; k++) {
      var f = k / n;
      if (f > stopF) break;
      var px = rx + dx * f, py = ry + dy * f, pz = rz + dz * f;
      var zt = sampleZ(g, px, py);
      if (zt !== zt) continue;
      var excess = zt - (pz + tol);
      if (excess > 0 && (!worst || excess > worst.excess)) {
        worst = {
          f: f, dist: f * slant, excess: excess, x: px, y: py, z: zt,
          /* raising the antenna by d lifts the ray at fraction f by d(1-f) */
          raise: excess / Math.max(1e-6, 1 - f)
        };
      }
    }
    return worst;
  }

  /* ---------------------------- ray → terrain intersection (picking) */
  /** clip = {min:[x,y,z], max:[x,y,z]} in world coords, or null */
  function rayHit(g, ox, oy, oz, dx, dy, dz, maxDist, clip) {
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-12) return null;
    dx /= L; dy /= L; dz /= L;
    var step = g.dx * 0.5;
    var far = maxDist || (Math.max(g.nx * g.dx, g.ny * g.dy) * 3 + (g.zmax - g.zmin) * 3);
    var prevT = 0, prevD = null;
    for (var t = 0; t < far; t += step) {
      var px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      var zt = sampleZ(g, px, py);
      /* geometry hidden by the clip box must not be pickable */
      if (clip && zt === zt && (px < clip.min[0] || px > clip.max[0] ||
        py < clip.min[1] || py > clip.max[1] ||
        zt < clip.min[2] || zt > clip.max[2])) { prevD = null; prevT = t; continue; }
      if (zt !== zt) { prevD = null; prevT = t; continue; }
      var d = pz - zt;
      if (prevD !== null && prevD > 0 && d <= 0) {
        /* bisect for a clean hit */
        var lo = prevT, hi = t;
        for (var it = 0; it < 24; it++) {
          var mid = (lo + hi) / 2;
          var mz = sampleZ(g, ox + dx * mid, oy + dy * mid);
          if (mz !== mz) break;
          if (oz + dz * mid - mz > 0) lo = mid; else hi = mid;
        }
        var tt = (lo + hi) / 2;
        return { x: ox + dx * tt, y: oy + dy * tt, z: sampleZ(g, ox + dx * tt, oy + dy * tt), t: tt };
      }
      prevD = d; prevT = t;
    }
    return null;
  }

  function nodeIndex(g, x, y) {
    var i = Math.round((x - g.x0) / g.dx), j = Math.round((y - g.y0) / g.dy);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
    return j * g.nx + i;
  }

  /* ============================================================
     Measurement — the numbers a ruler has to produce.

     Kept here rather than in the panel that shows them because they are raster
     geometry like everything else above, and because a figure used to CHECK
     the slope model has to be testable without a browser in the way.
     ============================================================ */

  /**
   * One leg of a measurement, between two points in survey coordinates.
   *
   * `bearing` is degrees from grid north clockwise, `incline` is degrees above
   * the horizontal and keeps its sign — a leg measured downhill reads negative,
   * which is what tells you the direction was taken down the wall rather than
   * up it. `slope` is the straight line through the air; the distance along the
   * ground is `groundLength`, and the two differ by every bench in between.
   */
  function legStats(x1, y1, z1, x2, y2, z2) {
    var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    var plan = Math.sqrt(dx * dx + dy * dy);
    var bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return {
      plan: plan, dz: dz, slope: Math.sqrt(plan * plan + dz * dz),
      bearing: bearing,
      /* a purely vertical leg has no bearing to speak of, and its inclination
         is ±90 by definition rather than by an atan2 of two zeros */
      incline: plan < 1e-9 ? (dz >= 0 ? 90 : -90) : Math.atan2(dz, plan) * 180 / Math.PI
    };
  }

  /**
   * Distance from A to B measured over the terrain instead of through it.
   *
   * Walked at `step` cells so it follows benches and berms; a gap in the survey
   * is bridged by carrying the last known level forward rather than dropping
   * the leg, so a hole in the data shortens the answer instead of voiding it.
   * `nGaps` reports how many samples were bridged, because a ground length with
   * a hundred bridged samples is not a measurement anyone should quote.
   */
  function groundLength(g, x1, y1, x2, y2, step) {
    var dx = x2 - x1, dy = y2 - y1;
    var plan = Math.sqrt(dx * dx + dy * dy);
    if (plan < 1e-9) return { length: 0, nGaps: 0, n: 0 };
    var cell = Math.min(g.dx, g.dy) * (step || 0.5);
    var n = Math.max(1, Math.ceil(plan / cell));
    var total = 0, gaps = 0, pz = sampleZ(g, x1, y1);
    if (pz !== pz) { pz = g.zmin; gaps++; }
    var px = x1, py = y1;
    for (var k = 1; k <= n; k++) {
      var t = k / n, qx = x1 + dx * t, qy = y1 + dy * t;
      var qz = sampleZ(g, qx, qy);
      if (qz !== qz) { qz = pz; gaps++; }
      total += Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py) + (qz - pz) * (qz - pz));
      px = qx; py = qy; pz = qz;
    }
    return { length: total, nGaps: gaps, n: n };
  }

  /** signed shoelace area of a ring of [x,y]; the sign is the winding */
  function ringArea(ring) {
    var a = 0, m = ring.length;
    for (var i = 0, j = m - 1; i < m; j = i++) {
      a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return a / 2;
  }

  /**
   * What a closed measurement covers, in plan and over the actual ground.
   *
   * The true surface area is the plan area of each cell divided by the cosine
   * of its slope — the standard raster identity, and the reason a steep wall
   * has far more rock face than its plan outline suggests. `equivSlope` inverts
   * that over the whole polygon: the dip a single uniform plane would need to
   * have this much surface over this much plan. It is NOT the arithmetic mean
   * of the cell slopes (`meanSlope` is), and on mixed ground the two differ —
   * comparing them is a quick read on how uniform the wall really is.
   *
   * `inside(x, y)` is the polygon test, supplied by the caller so this stays
   * free of any opinion about how the ring is stored.
   */
  function surfaceStats(g, der, inside) {
    var cellA = g.dx * g.dy;
    var cells = 0, surface = 0, sumSlope = 0, maxSlope = -Infinity, minSlope = Infinity;
    var zmin = Infinity, zmax = -Infinity, noData = 0;
    for (var j = 0; j < g.ny; j++) {
      var y = g.y0 + j * g.dy;
      for (var i = 0; i < g.nx; i++) {
        var x = g.x0 + i * g.dx;
        if (!inside(x, y)) continue;
        var id = j * g.nx + i, z = g.z[id];
        if (z !== z) { noData++; continue; }
        var s = der.slope[id];
        if (s !== s) { noData++; continue; }
        cells++;
        surface += cellA / Math.cos(s);
        sumSlope += s;
        if (s > maxSlope) maxSlope = s;
        if (s < minSlope) minSlope = s;
        if (z < zmin) zmin = z;
        if (z > zmax) zmax = z;
      }
    }
    var D = 180 / Math.PI;
    /* the plan area of the cells counted, not of the drawn ring: they differ by
       the raster's own stair-stepping, and the ratio has to compare like with
       like or a small polygon on a coarse grid reports a nonsense slope */
    var planCells = cells * cellA;
    var ratio = surface > 0 ? planCells / surface : NaN;
    return {
      cells: cells, noData: noData,
      planCells: planCells, surface: surface,
      meanSlope: cells ? sumSlope / cells * D : NaN,
      maxSlope: cells ? maxSlope * D : NaN,
      minSlope: cells ? minSlope * D : NaN,
      equivSlope: cells ? Math.acos(Math.max(-1, Math.min(1, ratio))) * D : NaN,
      zmin: cells ? zmin : NaN, zmax: cells ? zmax : NaN
    };
  }

  /* ============================================================
     Turning a set of cells back into a boundary.

     A block worked out cell by cell — the ground a wedge would release, say —
     has to come back as a polygon before anything else in the tool can use it:
     domains, statistics and the saved project all speak in rings. These three
     do that, and they live here because they are raster geometry and can be
     tested without a browser anywhere near them.
     ============================================================ */

  /**
   * The connected run of cells reachable from a seed, four-ways.
   *
   * Connectivity matters: a wedge test satisfied on the far side of the pit is
   * not part of this wedge, and taking every cell that passes would drag it in.
   * The seed is forced in whatever `test` says of it, because it is the point
   * the operator pointed at and an off-by-one on a cell edge should not turn
   * one click into nothing at all.
   */
  function floodFill(g, seed, test) {
    var n = g.nx * g.ny, mask = new Uint8Array(n);
    if (seed < 0 || seed >= n) return mask;
    var stack = [seed], nx = g.nx;
    mask[seed] = 1;
    while (stack.length) {
      var id = stack.pop();
      var i = id % nx, j = (id - i) / nx;
      /* west, east, south, north */
      if (i > 0) push(id - 1);
      if (i < nx - 1) push(id + 1);
      if (j > 0) push(id - nx);
      if (j < g.ny - 1) push(id + nx);
    }
    return mask;

    function push(q) {
      if (mask[q] || !test(q)) return;
      mask[q] = 1;
      stack.push(q);
    }
  }

  /**
   * The outline of a cell mask, as closed rings in survey coordinates.
   *
   * Built by walking the cell boundaries rather than by contouring: every
   * inside cell contributes the edges of its own square that face an outside
   * cell, directed so the inside stays on the left, and the edges are then
   * stitched end to end. The result is blocky — it is the cell set, exactly, in
   * the same stair-steps the shading draws — and it is right by construction
   * for any shape at all, including one with holes or a one-cell isthmus, which
   * is more than can be said for a marching-squares table with its saddles.
   *
   * Rings come back largest first, so the caller can take the block and leave
   * the specks. Each is closed implicitly: the last point joins the first.
   */
  function maskRings(g, mask) {
    var nx = g.nx, ny = g.ny;
    /* an edge keyed by its start corner, in half-cell lattice units so the
       coordinates are integers and can be compared exactly */
    var edges = {}, key = function (u, v) { return u + ',' + v; };
    function inside(i, j) {
      return i >= 0 && j >= 0 && i < nx && j < ny && !!mask[j * nx + i];
    }
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        if (!mask[j * nx + i]) continue;
        var l = 2 * i - 1, r = 2 * i + 1, b = 2 * j - 1, t = 2 * j + 1;
        if (!inside(i, j - 1)) add(l, b, r, b);      // bottom, heading east
        if (!inside(i + 1, j)) add(r, b, r, t);      // right, heading north
        if (!inside(i, j + 1)) add(r, t, l, t);      // top, heading west
        if (!inside(i - 1, j)) add(l, t, l, b);      // left, heading south
      }
    }

    var rings = [], k;
    for (k in edges) {
      if (!Object.prototype.hasOwnProperty.call(edges, k) || !edges[k]) continue;
      rings.push(walk(k));
    }
    /* half-lattice units to survey coordinates */
    var out = rings.map(function (ring) {
      return ring.map(function (p) {
        return [g.x0 + p[0] / 2 * g.dx, g.y0 + p[1] / 2 * g.dy];
      });
    }).filter(function (ring) { return ring.length >= 3; });
    out.sort(function (a, b2) { return Math.abs(ringArea(b2)) - Math.abs(ringArea(a)); });
    return out;

    function add(u0, v0, u1, v1) {
      var kk = key(u0, v0);
      /* one start corner can carry two outgoing edges where the region pinches
         to a point; keep them in a list so neither is lost */
      (edges[kk] || (edges[kk] = [])).push([u1, v1]);
    }
    function walk(startKey) {
      var parts = startKey.split(','), u = +parts[0], v = +parts[1];
      var ring = [], guard = 0, limit = 4 * nx * ny + 16;
      while (guard++ < limit) {
        var list = edges[key(u, v)];
        if (!list || !list.length) break;
        var nxt = list.shift();
        if (!list.length) delete edges[key(u, v)];
        ring.push([u, v]);
        u = nxt[0]; v = nxt[1];
        if (u === +parts[0] && v === +parts[1]) break;   // closed
      }
      return dropCollinear(ring);
    }
  }

  /** a stair-stepped ring carries three points per step; only the turns matter */
  function dropCollinear(ring) {
    var out = [];
    for (var i = 0; i < ring.length; i++) {
      var a = ring[(i - 1 + ring.length) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross !== 0) out.push(b);
    }
    return out.length >= 3 ? out : ring;
  }

  /**
   * The `level` contour of a scalar field, as loose line segments.
   *
   * Marching squares with linear interpolation along each cell edge, which is
   * what makes the line smooth rather than stair-stepped — the opposite choice
   * from `maskRings` above, and the right one here: a fault trace is a line
   * across the ground, not the edge of a set of cells.
   *
   * Segments come back unordered and unjoined, as `[x1,y1,x2,y2, …]`. Nothing
   * that draws them needs them stitched — a line batch is a list of segments
   * anyway — and stitching would only add a way to get it wrong.
   *
   * A NaN anywhere in a cell's four corners skips that cell, so the caller can
   * blank the field outside the region it cares about and get a contour
   * clipped to it for free.
   */
  function contourSegments(field, nx, ny, x0, y0, dx, dy, level) {
    var out = [];
    level = level || 0;
    for (var j = 0; j < ny - 1; j++) {
      for (var i = 0; i < nx - 1; i++) {
        var v00 = field[j * nx + i], v10 = field[j * nx + i + 1];
        var v11 = field[(j + 1) * nx + i + 1], v01 = field[(j + 1) * nx + i];
        if (v00 !== v00 || v10 !== v10 || v11 !== v11 || v01 !== v01) continue;
        var code = (v00 > level ? 1 : 0) | (v10 > level ? 2 : 0) |
          (v11 > level ? 4 : 0) | (v01 > level ? 8 : 0);
        if (code === 0 || code === 15) continue;
        var xa = x0 + i * dx, ya = y0 + j * dy, xb = xa + dx, yb = ya + dy;
        /* where the level crosses each edge, by linear interpolation */
        var e0 = [lerp(xa, xb, v00, v10), ya];                 // bottom
        var e1 = [xb, lerp(ya, yb, v10, v11)];                 // right
        var e2 = [lerp(xa, xb, v01, v11), yb];                 // top
        var e3 = [xa, lerp(ya, yb, v00, v01)];                 // left
        switch (code) {
          case 1: case 14: seg(e3, e0); break;
          case 2: case 13: seg(e0, e1); break;
          case 3: case 12: seg(e3, e1); break;
          case 4: case 11: seg(e1, e2); break;
          case 6: case 9: seg(e0, e2); break;
          case 7: case 8: seg(e2, e3); break;
          default:
            /* the two saddles. Which way the contour turns is genuinely
               ambiguous from the corners alone, so it is settled by the value
               at the middle of the cell — the usual resolution, and the one
               that keeps a trace connected the way the surface actually is. */
            var mid = (v00 + v10 + v11 + v01) / 4;
            if ((mid > level) === (code === 5)) { seg(e3, e2); seg(e1, e0); }
            else { seg(e3, e0); seg(e1, e2); }
        }
      }
    }
    return out;

    function lerp(a, b, va, vb) {
      var t = (level - va) / (vb - va);
      return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
    }
    /* A corner sitting exactly ON the level puts both of its edge crossings at
       that corner, and the segment between them has no length. It is not a
       contour, and stitching would trip over it, so it never gets emitted. */
    function seg(p, q) {
      if (p[0] === q[0] && p[1] === q[1]) return;
      out.push(p[0], p[1], q[0], q[1]);
    }
  }

  /**
   * Loose contour segments joined end to end into polylines.
   *
   * `contourSegments` hands back an unordered pile, which is all a line batch
   * needs; a POLYGON needs them in order. Endpoints are matched on a quantised
   * key rather than by distance, because marching squares emits the shared
   * endpoint of two neighbouring cells from identical arithmetic — the values
   * are bit-for-bit equal, so exact matching is both correct and quick.
   *
   * Each result carries `closed`. An open one means the contour ran off the
   * edge of the field, which for a block boundary means the block is not
   * bounded there — worth knowing rather than papering over.
   */
  function stitchSegments(segs, tol) {
    var q = tol || 1e-9;
    var k = function (x, y) { return Math.round(x / q) + ',' + Math.round(y / q); };
    var ends = {}, used = new Uint8Array(segs.length / 4), i;
    for (i = 0; i < segs.length; i += 4) {
      push(k(segs[i], segs[i + 1]), i / 4);
      push(k(segs[i + 2], segs[i + 3]), i / 4);
    }
    var out = [];
    for (i = 0; i < used.length; i++) {
      if (used[i]) continue;
      out.push(walk(i));
    }
    return out;

    function push(key, si) { (ends[key] || (ends[key] = [])).push(si); }

    /** the end of segment `si` that is not the one at `key` */
    function other(si, key) {
      var a = [segs[si * 4], segs[si * 4 + 1]], b = [segs[si * 4 + 2], segs[si * 4 + 3]];
      return k(a[0], a[1]) === key ? b : a;
    }
    function next(key, from) {
      var list = ends[key] || [];
      for (var m = 0; m < list.length; m++) if (!used[list[m]] && list[m] !== from) return list[m];
      return -1;
    }

    function walk(si) {
      used[si] = 1;
      var a = [segs[si * 4], segs[si * 4 + 1]], b = [segs[si * 4 + 2], segs[si * 4 + 3]];
      var line = [a, b], startKey = k(a[0], a[1]);
      /* forwards from b, then backwards from a */
      var cur = b, guard = 0;
      while (guard++ < used.length + 2) {
        var key = k(cur[0], cur[1]);
        if (key === startKey) return { pts: line, closed: true };
        var nx2 = next(key, -1);
        if (nx2 < 0) break;
        used[nx2] = 1;
        cur = other(nx2, key);
        line.push(cur);
      }
      cur = a; guard = 0;
      while (guard++ < used.length + 2) {
        var key2 = k(cur[0], cur[1]);
        var pv = next(key2, -1);
        if (pv < 0) break;
        used[pv] = 1;
        cur = other(pv, key2);
        line.unshift(cur);
      }
      var f = line[0], l = line[line.length - 1];
      return { pts: line, closed: k(f[0], f[1]) === k(l[0], l[1]) };
    }
  }

  /**
   * The rock between the surface and a floor, cell by cell.
   *
   * `floorAt(id, x, y)` returns the level of the base under that cell, or NaN
   * where there is none. Thickness is measured VERTICALLY, which is what makes
   * `plan area × thickness` a volume; a cell whose floor is above the surface
   * contributes nothing rather than a negative.
   *
   * `maxThickness` comes back alongside the total because it is the honesty
   * check on it: a wedge bounded by two near-vertical planes is arbitrarily
   * deep, and a volume quoted without knowing that is a number with no
   * geometry behind it.
   */
  function volumeUnder(g, mask, floorAt) {
    var cellA = g.dx * g.dy;
    var vol = 0, sumT = 0, maxT = 0, cells = 0;
    for (var j = 0; j < g.ny; j++) {
      for (var i = 0; i < g.nx; i++) {
        var id = j * g.nx + i;
        if (mask && !mask[id]) continue;
        var z = g.z[id];
        if (z !== z) continue;
        var f = floorAt(id, g.x0 + i * g.dx, g.y0 + j * g.dy);
        if (f !== f) continue;
        var t = z - f;
        if (!(t > 0)) continue;
        vol += cellA * t; sumT += t; cells++;
        if (t > maxT) maxT = t;
      }
    }
    return {
      volume: vol, cells: cells,
      meanThickness: cells ? sumT / cells : NaN,
      maxThickness: cells ? maxT : NaN
    };
  }

  /**
   * Douglas–Peucker on a closed ring.
   *
   * A cell-by-cell outline is a staircase with a vertex every cell, which is
   * unusable as a boundary anyone has to edit afterwards. This keeps the shape
   * to within `tol` metres and throws the rest away. The ring is split at the
   * vertex furthest from the first before simplifying, so the answer does not
   * depend on where the walk happened to start.
   */
  function simplifyRing(ring, tol) {
    if (!ring || ring.length < 4) return ring ? ring.slice() : ring;
    var far = 0, fd = -1;
    for (var i = 1; i < ring.length; i++) {
      var d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
      if (d > fd) { fd = d; far = i; }
    }
    var a = dp(ring.slice(0, far + 1), tol);
    var b = dp(ring.slice(far).concat([ring[0]]), tol);
    var out = a.concat(b.slice(1, b.length - 1));
    return out.length >= 3 ? out : ring.slice();

    function dp(pts, t) {
      if (pts.length < 3) return pts.slice();
      var first = pts[0], last = pts[pts.length - 1];
      var worst = 0, wi = 0;
      for (var k = 1; k < pts.length - 1; k++) {
        var dd = perp(pts[k], first, last);
        if (dd > worst) { worst = dd; wi = k; }
      }
      if (worst <= t) return [first, last];
      return dp(pts.slice(0, wi + 1), t).concat(dp(pts.slice(wi), t).slice(1));
    }
    function perp(p, a2, b2) {
      var dx = b2[0] - a2[0], dy = b2[1] - a2[1];
      var L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) return Math.hypot(p[0] - a2[0], p[1] - a2[1]);
      var u = ((p[0] - a2[0]) * dx + (p[1] - a2[1]) * dy) / L2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      return Math.hypot(p[0] - (a2[0] + dx * u), p[1] - (a2[1] + dy * u));
    }
  }

  return {
    merge: merge, bbox: bbox, build: build, derive: derive,
    floodFill: floodFill, maskRings: maskRings, simplifyRing: simplifyRing,
    contourSegments: contourSegments, stitchSegments: stitchSegments,
    volumeUnder: volumeUnder,
    sampleZ: sampleZ, losClear: losClear, losBlocker: losBlocker,
    rayHit: rayHit, nodeIndex: nodeIndex,
    fillHoles: fillHoles,
    legStats: legStats, groundLength: groundLength,
    ringArea: ringArea, surfaceStats: surfaceStats
  };
})();
