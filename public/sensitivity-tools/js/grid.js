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

  return {
    merge: merge, bbox: bbox, build: build, derive: derive,
    sampleZ: sampleZ, losClear: losClear, losBlocker: losBlocker,
    rayHit: rayHit, nodeIndex: nodeIndex,
    fillHoles: fillHoles
  };
})();
