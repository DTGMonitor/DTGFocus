/* ============================================================
   ui/overlays.js — everything drawn over the terrain as lines, plus the map
   tools that put it there.

   `Tools` owns which tool is armed and what a canvas click means; `Overlays`
   rebuilds the whole line set from state whenever anything moves. Rebuilding
   wholesale rather than patching is deliberate — there is exactly one place
   that decides what the view shows.
   ============================================================ */
'use strict';

SM.Overlays = (function () {

  var $ = SM.$, S = SM.S, DEG = SM.DEG;

  /* Walks each edge of a ring in short hops so the line follows the terrain
     instead of cutting through it. `close` adds the last→first edge. */
  function drapeRing(g, ext, ring, close) {
    var V = SM.V;
    var out = [], m = ring.length, lift = ext * 0.004;
    var edges = close ? m : m - 1;
    for (var k = 0; k < edges; k++) {
      var p = ring[k], q = ring[(k + 1) % m], N = 24;
      for (var t = 0; t < N; t++) {
        var f0 = t / N, f1 = (t + 1) / N;
        var x0 = p[0] + (q[0] - p[0]) * f0, y0 = p[1] + (q[1] - p[1]) * f0;
        var x1 = p[0] + (q[0] - p[0]) * f1, y1 = p[1] + (q[1] - p[1]) * f1;
        var z0 = Grid.sampleZ(g, x0, y0), z1 = Grid.sampleZ(g, x1, y1);
        if (z0 !== z0) z0 = g.zmin;
        if (z1 !== z1) z1 = g.zmin;
        V.seg(out, x0, y0, z0 + lift, x1, y1, z1 + lift);
      }
    }
    return out;
  }

  /* Above the terrain by this much, everywhere. Outlines and fills share it so
     an outline traces the edge of its own fill exactly instead of floating
     over it or sinking under it. */
  function liftOf(ext) { return ext * 0.004; }

  /**
   * A polygon painted onto the terrain, following every bench it crosses.
   *
   * Rather than triangulating the ring and draping the result — which needs an
   * ear-clip, a subdivision pass, and still guesses where the surface goes
   * between vertices — this walks the raster the analysis already runs on and
   * emits a quad per cell the polygon claims. Two consequences, both wanted:
   * the fill follows the survey exactly, and it shows the cells the analysis
   * ACTUALLY uses, so a domain whose polygon clips a bench edge looks clipped
   * rather than smooth. The crisp boundary is the outline drawn over the top.
   *
   * `claims(id)` answers "is this cell in?". Over `BUDGET` cells the quads grow
   * to span several cells each, so a domain covering half a mine costs the same
   * to draw as a small one and only looks blockier.
   */
  var BUDGET = 24000;

  /* Building a fill is a pass over the raster, and `update()` runs on every
     hover and every probe click, so the geometry is cached and rebuilt only
     when something that could change it has moved. `S.fillStamp` is bumped by
     whoever recomputes a mask or a domain index — the two things a fill is
     derived from — which keeps the invalidation with the change rather than in
     a guess made here. */
  var fillCache = { stamp: -1, aoi: null, domains: [] };

  function fresh() {
    if (fillCache.stamp === S.fillStamp) return true;
    fillCache = { stamp: S.fillStamp, aoi: null, domains: [] };
    return false;
  }

  function drapeFill(g, ext, claims, count) {
    var V = SM.V, out = [], lift = liftOf(ext);
    var k = Math.max(1, Math.ceil(Math.sqrt((count || 0) / BUDGET)));
    var nx = g.nx, ny = g.ny;
    for (var j = 0; j + k < ny; j += k) {
      for (var i = 0; i + k < nx; i += k) {
        if (!claims(j * nx + i)) continue;
        var i2 = i + k, j2 = j + k;
        var za = g.z[j * nx + i], zb = g.z[j * nx + i2];
        var zc = g.z[j2 * nx + i2], zd = g.z[j2 * nx + i];
        if (za !== za || zb !== zb || zc !== zc || zd !== zd) continue;
        var xa = g.x0 + i * g.dx, xb = g.x0 + i2 * g.dx;
        var ya = g.y0 + j * g.dy, yb = g.y0 + j2 * g.dy;
        V.vert(out, xa, ya, za + lift); V.vert(out, xb, ya, zb + lift); V.vert(out, xb, yb, zc + lift);
        V.vert(out, xa, ya, za + lift); V.vert(out, xb, yb, zc + lift); V.vert(out, xa, yb, zd + lift);
      }
    }
    return out;
  }

  /** how many cells a ring covers, so drapeFill can pick its stride up front */
  function countCells(g, ring) {
    var n = 0;
    for (var j = 0; j < g.ny; j++) {
      var y = g.y0 + j * g.dy;
      for (var i = 0; i < g.nx; i++) {
        if (Sens.pointInPoly(ring, g.x0 + i * g.dx, y)) n++;
      }
    }
    return n;
  }

  /** the masked cells, i.e. exactly the population the statistics describe */
  function aoiFill(g, ext) {
    if (fresh() && fillCache.aoi) return fillCache.aoi;
    var mask = S.mask;
    if (!mask) return null;
    var n = 0;
    for (var q = 0; q < mask.length; q++) if (mask[q]) n++;
    fillCache.aoi = n ? drapeFill(g, ext, function (id) { return !!mask[id]; }, n) : null;
    return fillCache.aoi;
  }

  /**
   * The cells one structural domain claims.
   *
   * Taken from the resolved index whenever there is one, so the shaded area and
   * the numbers on the domain card can never describe different cells. The ring
   * is only walked directly in the moment before the first index exists.
   */
  function domainFill(g, ext, d, i) {
    if (fresh() && fillCache.domains[i]) return fillCache.domains[i];
    var idx = S.domIdx, claims, cells = 0, q;
    if (idx) {
      for (q = 0; q < idx.length; q++) if (idx[q] === i) cells++;
      claims = function (id) { return idx[id] === i; };
    } else {
      cells = countCells(g, d.ring);
      claims = function (id) {
        var ii = id % g.nx;
        return Sens.pointInPoly(d.ring, g.x0 + ii * g.dx, g.y0 + ((id - ii) / g.nx) * g.dy);
      };
    }
    fillCache.domains[i] = cells ? drapeFill(g, ext, claims, cells) : null;
    return fillCache.domains[i];
  }

  /**
   * The corners of a mapped plane, as a rectangular patch.
   *
   * A disc says nothing about which way the structure runs. A rectangle laid
   * out along its own axes does: the long edges follow the STRIKE, the short
   * ones run down the DIP, so the patch sits in the wall the way the fault
   * does and its footprint on the terrain is the strike line. Longer along
   * strike than down dip because that is the shape of the thing being drawn.
   *
   * `size` is the full strike length in metres; the down-dip height is 0.62 of
   * it. Corners come back in ring order, so both the fill and the outline are
   * built from the same four points and cannot disagree.
   */
  var DIP_ASPECT = Struct.DIP_ASPECT;

  function planeCorners(anchor, dip, dipDir, size) {
    var w = size / 2, h = size * DIP_ASPECT / 2;
    var e1 = [Math.sin((dipDir - 90) * DEG), Math.cos((dipDir - 90) * DEG), 0];
    var e2 = Struct.dipVector(dip, dipDir);
    function at(u, v) {
      return [anchor[0] + e1[0] * u * w + e2[0] * v * h,
        anchor[1] + e1[1] * u * w + e2[1] * v * h,
        anchor[2] + e1[2] * u * w + e2[2] * v * h];
    }
    return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  }

  /**
   * Where a mapped plane actually cuts the ground — its TRACE.
   *
   * The rectangle is a symbol standing in the air; the trace is the line a
   * geologist would walk and flag, and it is the only part of a structure that
   * is genuinely visible on a surface. It is the zero contour of the plane's
   * signed distance evaluated at the terrain: positive above the plane,
   * negative below, and the crossing is where the structure daylights.
   *
   * Two things keep it honest and cheap. It is clipped to the patch — blanked
   * outside the rectangle's own extent — because an unbounded plane would
   * trace right across the model and claim ground nobody mapped. And it is
   * evaluated only over the patch's plan bounding box, a few hundred cells, so
   * it can be rebuilt every frame while a plane is being dragged.
   */
  function planeTrace(g, p, corners, size) {
    var n = Struct.planeNormal(Struct.clampDip(p.dip), p.dipDir);
    var e1 = [Math.sin((p.dipDir - 90) * DEG), Math.cos((p.dipDir - 90) * DEG), 0];
    var e2 = Struct.dipVector(p.dip, p.dipDir);
    var w = size / 2, h = size * DIP_ASPECT / 2, a = p.anchor;

    var bx1 = Infinity, bx2 = -Infinity, by1 = Infinity, by2 = -Infinity;
    corners.forEach(function (c) {
      if (c[0] < bx1) bx1 = c[0]; if (c[0] > bx2) bx2 = c[0];
      if (c[1] < by1) by1 = c[1]; if (c[1] > by2) by2 = c[1];
    });
    var i0 = Math.max(0, Math.floor((bx1 - g.x0) / g.dx) - 1);
    var i1 = Math.min(g.nx - 1, Math.ceil((bx2 - g.x0) / g.dx) + 1);
    var j0 = Math.max(0, Math.floor((by1 - g.y0) / g.dy) - 1);
    var j1 = Math.min(g.ny - 1, Math.ceil((by2 - g.y0) / g.dy) + 1);
    var wx = i1 - i0 + 1, wy = j1 - j0 + 1;
    if (wx < 2 || wy < 2) return [];

    var f = new Float64Array(wx * wy);
    for (var j = 0; j < wy; j++) {
      for (var i = 0; i < wx; i++) {
        var id = (j0 + j) * g.nx + (i0 + i), z = g.z[id];
        if (z !== z) { f[j * wx + i] = NaN; continue; }
        var dx = g.x0 + (i0 + i) * g.dx - a[0];
        var dy = g.y0 + (j0 + j) * g.dy - a[1];
        var dz = z - a[2];
        /* outside the rectangle's own extent this plane says nothing */
        var u = e1[0] * dx + e1[1] * dy + e1[2] * dz;
        var v = e2[0] * dx + e2[1] * dy + e2[2] * dz;
        if (Math.abs(u) > w || Math.abs(v) > h) { f[j * wx + i] = NaN; continue; }
        f[j * wx + i] = n[0] * dx + n[1] * dy + n[2] * dz;
      }
    }
    return Grid.contourSegments(f, wx, wy,
      g.x0 + i0 * g.dx, g.y0 + j0 * g.dy, g.dx, g.dy, 0);
  }

  /** the patch as two triangles */
  function planeFill(corners) {
    var V = SM.V, out = [], k = corners[0], l = corners[1], m = corners[2], n = corners[3];
    V.vert(out, k[0], k[1], k[2]); V.vert(out, l[0], l[1], l[2]); V.vert(out, m[0], m[1], m[2]);
    V.vert(out, k[0], k[1], k[2]); V.vert(out, m[0], m[1], m[2]); V.vert(out, n[0], n[1], n[2]);
    return out;
  }

  /**
   * The patch, cut back to the part inside the rock.
   *
   * Tessellated and tested quad by quad against the surface rather than
   * clipped analytically: the terrain is a height field with benches in it, not
   * a plane, and there is no closed form for where a rectangle crosses it. Each
   * quad is kept only if its middle sits at or below the ground, which stops
   * the rectangle hanging in the air in front of the face. Worth seeing only
   * with the surface turned down or off — behind an opaque wall it is, by
   * construction, invisible.
   */
  function planeFillClipped(g, p, size) {
    var V = SM.V, out = [];
    var e1 = [Math.sin((p.dipDir - 90) * DEG), Math.cos((p.dipDir - 90) * DEG), 0];
    var e2 = Struct.dipVector(p.dip, p.dipDir);
    var w = size / 2, h = size * DIP_ASPECT / 2, a = p.anchor;
    var NU = 24, NV = 16;
    function at(u, v) {
      return [a[0] + e1[0] * u * w + e2[0] * v * h,
        a[1] + e1[1] * u * w + e2[1] * v * h,
        a[2] + e1[2] * u * w + e2[2] * v * h];
    }
    for (var iu = 0; iu < NU; iu++) {
      for (var iv = 0; iv < NV; iv++) {
        var u0 = -1 + 2 * iu / NU, u1 = -1 + 2 * (iu + 1) / NU;
        var v0 = -1 + 2 * iv / NV, v1 = -1 + 2 * (iv + 1) / NV;
        var mid = at((u0 + u1) / 2, (v0 + v1) / 2);
        var zt = Grid.sampleZ(g, mid[0], mid[1]);
        if (zt !== zt || mid[2] > zt) continue;         // standing in the air
        var q00 = at(u0, v0), q10 = at(u1, v0), q11 = at(u1, v1), q01 = at(u0, v1);
        V.vert(out, q00[0], q00[1], q00[2]);
        V.vert(out, q10[0], q10[1], q10[2]);
        V.vert(out, q11[0], q11[1], q11[2]);
        V.vert(out, q00[0], q00[1], q00[2]);
        V.vert(out, q11[0], q11[1], q11[2]);
        V.vert(out, q01[0], q01[1], q01[2]);
      }
    }
    return out;
  }

  /**
   * The patch's four edges, plus a dip tick from the centre to the middle of
   * the down-dip edge — as world-space segments, before anything is decided
   * about which of them survive. The tick is what makes the rectangle readable:
   * without it a rectangle is symmetric and there is no telling which way it
   * falls.
   */
  function planeOutlineSegs(anchor, corners) {
    var out = [];
    for (var k = 0; k < 4; k++) {
      var p = corners[k], q = corners[(k + 1) % 4];
      out.push([p[0], p[1], p[2], q[0], q[1], q[2]]);
    }
    var lo = corners[2], hi = corners[3];               // the down-dip edge
    var mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    out.push([anchor[0], anchor[1], anchor[2], mid[0], mid[1], mid[2]]);
    /* two barbs on the tick, pointing back up dip */
    var bx = (corners[1][0] - corners[0][0]) / 2, by = (corners[1][1] - corners[0][1]) / 2,
      bz = (corners[1][2] - corners[0][2]) / 2;
    var dx = mid[0] - anchor[0], dy = mid[1] - anchor[1], dz = mid[2] - anchor[2];
    [0.16, -0.16].forEach(function (s) {
      out.push([mid[0], mid[1], mid[2],
        mid[0] - dx * 0.3 + bx * s, mid[1] - dy * 0.3 + by * s, mid[2] - dz * 0.3 + bz * s]);
    });
    return out;
  }

  /**
   * The outline, optionally cut back to the part inside the rock.
   *
   * Clipping the fill and leaving the wireframe whole was half a job: the
   * rectangle went on hanging in front of the face in outline, which is most
   * of what made it cluttered in the first place. Each segment is walked and
   * only the stretches whose midpoint sits at or below the ground are kept —
   * the same test the fill uses, at a finer step, so the two agree along their
   * shared edge.
   */
  function planeOutline(anchor, corners, g, clip) {
    var V = SM.V, out = [], segs = planeOutlineSegs(anchor, corners);
    var STEPS = 48;
    segs.forEach(function (s) {
      if (!clip) { V.seg(out, s[0], s[1], s[2], s[3], s[4], s[5]); return; }
      for (var t = 0; t < STEPS; t++) {
        var f0 = t / STEPS, f1 = (t + 1) / STEPS, fm = (f0 + f1) / 2;
        var mx = s[0] + (s[3] - s[0]) * fm, my = s[1] + (s[4] - s[1]) * fm;
        var mz = s[2] + (s[5] - s[2]) * fm;
        var zt = Grid.sampleZ(g, mx, my);
        if (zt !== zt || mz > zt) continue;             // this stretch is in the air
        V.seg(out,
          s[0] + (s[3] - s[0]) * f0, s[1] + (s[4] - s[1]) * f0, s[2] + (s[5] - s[2]) * f0,
          s[0] + (s[3] - s[0]) * f1, s[1] + (s[4] - s[1]) * f1, s[2] + (s[5] - s[2]) * f1);
      }
    });
    return out;
  }

  /* Marks a batch as belonging to the ground rather than to the instruments,
     which is what decides whether a section cuts it. Written as a helper so
     the distinction is made in one place and reads as a decision rather than
     as a property that happened to be set. */
  function ground(batch) { batch.clip = true; return batch; }

  function update() {
    if (!S.grid || !SM.V) return;
    var V = SM.V;
    /* Fills are collected separately and submitted first: the renderer draws
       batches in order, and an outline has to land on top of the area it
       traces rather than under it. */
    var g = S.grid, batches = [], fills = [];
    var x1 = g.x0, x2 = g.x0 + (g.nx - 1) * g.dx;
    var y1 = g.y0, y2 = g.y0 + (g.ny - 1) * g.dy;
    var z1 = g.zmin, z2 = g.zmax;
    var ext = Math.max(x2 - x1, y2 - y1);

    if (S.show.box) {
      var box = [];
      [[z1], [z2]].forEach(function (zz) {
        var z = zz[0];
        V.seg(box, x1, y1, z, x2, y1, z); V.seg(box, x2, y1, z, x2, y2, z);
        V.seg(box, x2, y2, z, x1, y2, z); V.seg(box, x1, y2, z, x1, y1, z);
      });
      V.seg(box, x1, y1, z1, x1, y1, z2); V.seg(box, x2, y1, z1, x2, y1, z2);
      V.seg(box, x2, y2, z1, x2, y2, z2); V.seg(box, x1, y2, z1, x1, y2, z2);
      batches.push({ verts: box, color: [0.35, 0.42, 0.52, 0.55] });
      /* north arrow + axes at the SW corner */
      var ax = [], al = ext * 0.09;
      V.seg(ax, x1, y1, z1, x1 + al, y1, z1);
      batches.push({ verts: ax, color: [1, 0.35, 0.35, 0.9] });
      var ay = [];
      V.seg(ay, x1, y1, z1, x1, y1 + al, z1);
      V.seg(ay, x1, y1 + al, z1, x1 - al * 0.12, y1 + al * 0.82, z1);
      V.seg(ay, x1, y1 + al, z1, x1 + al * 0.12, y1 + al * 0.82, z1);
      batches.push({ verts: ay, color: [0.4, 1, 0.5, 0.9] });
      var az2 = [];
      V.seg(az2, x1, y1, z1, x1, y1, z1 + al);
      batches.push({ verts: az2, color: [0.45, 0.7, 1, 0.9] });
    }

    /* AOI footprint draped on the surface */
    if ($('chkAOI').checked) {
      var a = SM.AOI.aoiObj();
      var rings = a.polys ||
        [[[a.xmin, a.ymin], [a.xmax, a.ymin], [a.xmax, a.ymax], [a.xmin, a.ymax]]];
      var plain = [], lit = [];
      rings.forEach(function (ring, i) {
        var v = drapeRing(g, ext, ring, true);
        if (a.polys && i === S.polyHi) lit = lit.concat(v); else plain = plain.concat(v);
      });
      if (plain.length) batches.push(ground({ verts: plain, color: [1, 1, 1, 0.85] }));
      if (lit.length) batches.push(ground({ verts: lit, color: [0.07, 0.76, 0.63, 1] }));
      /* Only once a region has actually been drawn: the plain X/Y rectangle is
         already described by everything outside it being dimmed, and washing
         the whole model in white on top of that explains nothing. Faintest of
         the three fills even so — the mask can cover most of the map, and the
         colours underneath it are the thing being read. */
      if (S.show.fill && S.polys.length && !(S.editGrab && S.editGrab.kind === 'region')) {
        var af = aoiFill(g, ext);
        if (af && af.length) fills.push(ground({ verts: af, color: [1, 1, 1, 0.1], tris: true }));
      }
    }

    /* structural domains: the drawn block, and the direction it is assumed to
       move. Both are wanted at once — the polygon says where the override
       applies, the arrow says what it overrides the movement vector with. */
    if (S.show.dom) S.domains.forEach(function (d, i) {
      if (d.on === false || !d.ring || d.ring.length < 3) return;
      var c = ColorMaps.hex2rgb(d.color).map(function (v) { return v / 255; });
      var lit = i === S.domHi;
      var dAlpha = SM.Structure.domainAlpha();
      /* while one of its vertices is held the outline moves at pointer rate but
         the shading does not — showing the old shape under the new outline
         would read as a bug, so it is dropped until the vertex lands */
      var editing = S.editGrab && S.editGrab.kind === 'domain' && S.editGrab.idx === i;
      if (S.show.fill && dAlpha > 0 && !editing) {
        var df = domainFill(g, ext, d, i);
        if (df && df.length) {
          fills.push(ground({
            verts: df,
            color: [c[0], c[1], c[2], lit ? Math.min(1, dAlpha * 1.5) : dAlpha], tris: true
          }));
        }
      }
      batches.push(ground({
        verts: drapeRing(g, ext, d.ring, true),
        color: [c[0], c[1], c[2], lit ? 1 : 0.85], noDepth: lit
      }));
      /* the arrow starts at the centroid, on the surface, and is drawn through
         the terrain so a steeply plunging vector is still visible */
      var cx = 0, cy = 0;
      d.ring.forEach(function (p) { cx += p[0]; cy += p[1]; });
      cx /= d.ring.length; cy /= d.ring.length;
      var cz = Grid.sampleZ(g, cx, cy);
      if (cz !== cz) return;
      var v = Sens.customVec(d.trend, d.plunge), Ld = ext * 0.07;
      var ex = cx + v[0] * Ld, ey = cy + v[1] * Ld, ez = cz + v[2] * Ld;
      var arr = [];
      V.seg(arr, cx, cy, cz, ex, ey, ez);
      /* a two-barb head, built in the plane that contains the shaft and up */
      var side = Struct.norm(Struct.cross(v, [0, 0, 1])) || [1, 0, 0];
      var back = Ld * 0.22;
      [1, -1].forEach(function (sgn) {
        V.seg(arr, ex, ey, ez,
          ex - v[0] * back + side[0] * back * 0.5 * sgn,
          ey - v[1] * back + side[1] * back * 0.5 * sgn,
          ez - v[2] * back + side[2] * back * 0.5 * sgn);
      });
      batches.push(ground({ verts: arr, color: [c[0], c[1], c[2], 1], noDepth: true }));
    });

    /* mapped planes, drawn as a patch at wherever they were picked. Only planes
       that came off the surface have a place to sit — a typed dip and dip
       direction is an orientation, not a location, and inventing one for it
       would put a structure on the wall that was never mapped there. */
    var pAlpha = SM.Structure.planeAlpha();
    var pDraw = SM.Structure.planeDraw();          // patch | trace | both
    var pClip = SM.Structure.planeClip();
    if (S.show.struct) S.planes.forEach(function (p, i) {
      if (p.on === false || !p.anchor) return;
      var c = ColorMaps.hex2rgb(p.color).map(function (q) { return q / 255; });
      var pSize = SM.Structure.planeSize(ext, p);
      var corners = planeCorners(p.anchor, p.dip, p.dipDir, pSize);
      var lit = S.netHi && S.netHi.kind === 'plane' && S.netHi.index === i;

      /* the trace: where the structure actually reaches the ground. Drawn on
         the surface and through it, so it stays readable round a crest. */
      if (pDraw !== 'patch') {
        var tr = planeTrace(g, p, corners, pSize), tv = [], lift = liftOf(ext);
        for (var k = 0; k < tr.length; k += 4) {
          var za = Grid.sampleZ(g, tr[k], tr[k + 1]);
          var zb = Grid.sampleZ(g, tr[k + 2], tr[k + 3]);
          if (za !== za || zb !== zb) continue;
          V.seg(tv, tr[k], tr[k + 1], za + lift, tr[k + 2], tr[k + 3], zb + lift);
        }
        if (tv.length) {
          batches.push(ground({ verts: tv, color: [c[0], c[1], c[2], 1], noDepth: true }));
        }
      }

      if (pDraw === 'trace') return;               // no rectangle at all

      if (S.show.fill && pAlpha > 0) {
        fills.push(ground({
          verts: pClip ? planeFillClipped(g, p, pSize) : planeFill(corners),
          color: [c[0], c[1], c[2], lit ? Math.min(1, pAlpha * 1.5) : pAlpha], tris: true
        }));
      }
      var ol = planeOutline(p.anchor, corners, g, pClip);
      if (ol.length) {
        batches.push(ground({ verts: ol, color: [c[0], c[1], c[2], lit ? 1 : 0.7], noDepth: !!lit }));
      }
    });

    /* the ruler. Two lines per leg on purpose: the draped one is the ground
       distance and the straight chord is the slope distance, and seeing the
       chord cut through the bench noses is the clearest possible statement of
       why the two numbers differ. Drawn through the terrain so a measurement
       taken round the back of a ridge is still readable. */
    var MP = S.measure.pts;
    if (MP.length) {
      var flat = MP.map(function (p) { return [p[0], p[1]]; });
      var mv = MP.length > 1 ? drapeRing(g, ext, flat, S.measure.closed) : [];
      var chord = [], nLeg = S.measure.closed ? MP.length : MP.length - 1;
      for (var mk = 0; mk < nLeg; mk++) {
        var ma = MP[mk], mbb = MP[(mk + 1) % MP.length];
        V.seg(chord, ma[0], ma[1], ma[2], mbb[0], mbb[1], mbb[2]);
      }
      var mt = ext * 0.008;
      var ticks = [];
      MP.forEach(function (p) {
        V.seg(ticks, p[0] - mt, p[1], p[2], p[0] + mt, p[1], p[2]);
        V.seg(ticks, p[0], p[1] - mt, p[2], p[0], p[1] + mt, p[2]);
        V.seg(ticks, p[0], p[1], p[2] - mt, p[0], p[1], p[2] + mt);
      });
      if (S.show.fill && S.measure.closed && MP.length >= 3 &&
          !(S.editGrab && S.editGrab.kind === 'measure')) {
        var mCount = countCells(g, flat);
        if (mCount) {
          fills.push(ground({
            verts: drapeFill(g, ext, function (id) {
              var ii = id % g.nx;
              return Sens.pointInPoly(flat, g.x0 + ii * g.dx, g.y0 + ((id - ii) / g.nx) * g.dy);
            }, mCount),
            color: [1, 0.82, 0.25, 0.16], tris: true
          }));
        }
      }
      if (chord.length) batches.push(ground({ verts: chord, color: [1, 0.82, 0.25, 0.35], noDepth: true }));
      if (mv.length) batches.push(ground({ verts: mv, color: [1, 0.82, 0.25, 1], noDepth: true }));
      /* the ticks stay whole: they mark points the operator put down, and a
         half-drawn cross is worse than no cross */
      batches.push({ verts: ticks, color: [1, 1, 1, 1], noDepth: true });
    }

    /* handles for the stretch tool: every vertex it could grab, with the one
       under the pointer — or the one being held — picked out. Drawn through
       the terrain so a handle round the back of a crest is still reachable. */
    if (S.tool === 'edit') {
      var hv = [], lv = [], hk = ext * 0.007, bk = ext * 0.013;
      SM.Edit.handles().forEach(function (H0) {
        var G = S.editGrab, H = S.editHi;
        var isLit = (G && G.kind === H0.kind && G.idx === H0.idx && G.vi === H0.vi) ||
          (!G && H && H.kind === H0.kind && H.idx === H0.idx && H.vi === H0.vi);
        /* `vz`, not `pz`: a host build patches the scan fan by matching one
           exact line of this file, and a second identical line here would be
           rewritten along with it. */
        var vz = H0.z;
        if (vz == null || vz !== vz) {
          vz = Grid.sampleZ(g, H0.x, H0.y);
          if (vz !== vz) vz = g.zmin;
          vz += liftOf(ext);
        }
        var arr = isLit ? lv : hv, k = isLit ? bk : hk;
        V.seg(arr, H0.x - k, H0.y - k, vz, H0.x + k, H0.y + k, vz);
        V.seg(arr, H0.x - k, H0.y + k, vz, H0.x + k, H0.y - k, vz);
        if (isLit) {
          V.seg(arr, H0.x - k, H0.y - k, vz, H0.x + k, H0.y - k, vz);
          V.seg(arr, H0.x + k, H0.y - k, vz, H0.x + k, H0.y + k, vz);
          V.seg(arr, H0.x + k, H0.y + k, vz, H0.x - k, H0.y + k, vz);
          V.seg(arr, H0.x - k, H0.y + k, vz, H0.x - k, H0.y - k, vz);
        }
      });
      if (hv.length) batches.push({ verts: hv, color: [1, 1, 1, 0.75], noDepth: true });
      if (lv.length) {
        batches.push({
          verts: lv,
          color: S.editGrab ? [1, 0.82, 0.25, 1] : [0.07, 0.76, 0.63, 1], noDepth: true
        });
      }
    }

    /* Where two mapped structures actually cross, drawn as the segment they
       share. This is the thing a stereonet cannot show: a pair can plot in the
       critical zone and still be two surfaces that never touch, and seeing the
       line — or its absence — is what tells them apart. Coloured by zone, so
       the ones worth worrying about read at a glance. */
    if (S.show.xline && S.kin) {
      var xr = [], xa = [], xn = [], sky = [];
      S.kin.pairs.forEach(function (p, pi) {
        if (!p.seg) return;
        var lit = S.netHi && S.netHi.kind === 'pair' && S.netHi.index === pi;
        var into = lit ? xr : (p.zone === 'primary' ? xr : p.zone === 'secondary' ? xa : xn);
        /* Split at the ground where the terrain is known. The part inside the
           rock is the wedge; the part standing in the air is why a critical
           pair can be no risk at all, and drawing it faint says that faster
           than any table can. */
        if (p.rock && p.rock.runs && p.rock.runs.length) {
          p.rock.runs.forEach(function (r) {
            var dst = r.rock ? into : sky;
            V.seg(dst, r.a[0], r.a[1], r.a[2], r.b[0], r.b[1], r.b[2]);
          });
        } else {
          V.seg(into, p.seg.p1[0], p.seg.p1[1], p.seg.p1[2],
            p.seg.p2[0], p.seg.p2[1], p.seg.p2[2]);
        }
      });
      if (sky.length) batches.push(ground({ verts: sky, color: [0.55, 0.6, 0.68, 0.35], noDepth: true }));
      if (xn.length) batches.push(ground({ verts: xn, color: [0.7, 0.75, 0.82, 0.7], noDepth: true }));
      if (xa.length) batches.push(ground({ verts: xa, color: [1, 0.7, 0.1, 1], noDepth: true }));
      if (xr.length) batches.push(ground({ verts: xr, color: [1, 0.25, 0.25, 1], noDepth: true }));
    }

    /* the polygon under construction: an open chain, with a tick on every
       vertex so the last click is visible before there is an edge to see */
    if ((S.tool === 'aoi' || S.tool === 'domain') && S.pickBuf.length) {
      var pv = drapeRing(g, ext, S.pickBuf, false), tk = ext * 0.006;
      S.pickBuf.forEach(function (p) {
        var pz = Grid.sampleZ(g, p[0], p[1]);
        if (pz !== pz) pz = g.zmin;
        pz += ext * 0.004;
        V.seg(pv, p[0] - tk, p[1], pz, p[0] + tk, p[1], pz);
        V.seg(pv, p[0], p[1] - tk, pz, p[0], p[1] + tk, pz);
      });
      /* the closing edge comes in dashed, so the shape reads as a polygon
         without pretending that last edge has been committed */
      if (S.pickBuf.length >= 3) {
        var pf = S.pickBuf[0], pl = S.pickBuf[S.pickBuf.length - 1];
        var fz = Grid.sampleZ(g, pf[0], pf[1]), lz = Grid.sampleZ(g, pl[0], pl[1]);
        if (fz !== fz) fz = g.zmin;
        if (lz !== lz) lz = g.zmin;
        for (var d = 0; d < 8; d += 2) {
          var u0 = d / 8, u1 = (d + 1) / 8;
          V.seg(pv,
            pl[0] + (pf[0] - pl[0]) * u0, pl[1] + (pf[1] - pl[1]) * u0, lz + (fz - lz) * u0 + ext * 0.004,
            pl[0] + (pf[0] - pl[0]) * u1, pl[1] + (pf[1] - pl[1]) * u1, lz + (fz - lz) * u1 + ext * 0.004);
        }
      }
      batches.push(ground({ verts: pv, color: [1, 0.82, 0.25, 0.95] }));
    }

    /* points collected for a three-point plane fit. No chain between them:
       they are samples of a surface, not the outline of one, and joining them
       up would suggest an order that does not matter. */
    if (S.tool === 'plane' && S.pickBuf.length) {
      var fitv = [], fk = ext * 0.008;
      S.pickBuf.forEach(function (p) {
        V.seg(fitv, p[0] - fk, p[1], p[2], p[0] + fk, p[1], p[2]);
        V.seg(fitv, p[0], p[1] - fk, p[2], p[0], p[1] + fk, p[2]);
        V.seg(fitv, p[0], p[1], p[2] - fk, p[0], p[1], p[2] + fk);
      });
      batches.push(ground({ verts: fitv, color: [0.07, 0.76, 0.63, 1], noDepth: true }));
      /* once three are down, show the plane they currently imply */
      var pv3 = Struct.fitPlane(S.pickBuf);
      if (pv3) {
        var pc = planeCorners(pv3.centre, pv3.dip, pv3.dipDir, SM.Structure.planeSize(ext));
        if (S.show.fill && SM.Structure.planeAlpha() > 0) {
          fills.push(ground({
            verts: planeFill(pc),
            color: [0.07, 0.76, 0.63, SM.Structure.planeAlpha()], tris: true
          }));
        }
        batches.push(ground({
          verts: planeOutline(pv3.centre, pc, g, SM.Structure.planeClip()),
          color: [0.07, 0.76, 0.63, 0.9], noDepth: true
        }));
      }
    }

    /* sensors */
    S.radars.forEach(function (r, i) {
      var col = ColorMaps.hex2rgb(r.color).map(function (v) { return v / 255; });
      var alpha = (r.on === false) ? 0.28 : 1;
      var v = [], s = ext * 0.012;
      /* mast */
      var zt = Grid.sampleZ(g, r.x, r.y);
      if (zt !== zt) zt = r.z - (r.dz || 0);
      V.seg(v, r.x, r.y, zt, r.x, r.y, r.z);
      /* box */
      var c1 = [r.x - s, r.y - s], c2 = [r.x + s, r.y - s], c3 = [r.x + s, r.y + s], c4 = [r.x - s, r.y + s];
      var zb = r.z, zu = r.z + s * 1.4;
      [[zb], [zu]].forEach(function (zz) {
        var z = zz[0];
        V.seg(v, c1[0], c1[1], z, c2[0], c2[1], z); V.seg(v, c2[0], c2[1], z, c3[0], c3[1], z);
        V.seg(v, c3[0], c3[1], z, c4[0], c4[1], z); V.seg(v, c4[0], c4[1], z, c1[0], c1[1], z);
      });
      [c1, c2, c3, c4].forEach(function (c) { V.seg(v, c[0], c[1], zb, c[0], c[1], zu); });
      /* cross-hair up-marker */
      V.seg(v, r.x, r.y, zu, r.x, r.y, zu + s * 1.6);
      batches.push({ verts: v, color: [col[0], col[1], col[2], alpha], noDepth: i === S.sel });

      /* the selected marker is drawn through the terrain, which would otherwise
         hide the fact that the antenna is underground — flag it in red */
      if (zt === zt && r.z < zt - 0.05) {
        var bur = [], m2 = ext * 0.014;
        V.seg(bur, r.x, r.y, r.z, r.x, r.y, zt);
        V.seg(bur, r.x - m2, r.y, r.z, r.x + m2, r.y, r.z);
        V.seg(bur, r.x, r.y - m2, r.z, r.x, r.y + m2, r.z);
        V.seg(bur, r.x - m2, r.y - m2, zt, r.x + m2, r.y + m2, zt);
        V.seg(bur, r.x - m2, r.y + m2, zt, r.x + m2, r.y - m2, zt);
        batches.push({ verts: bur, color: [1, 0.15, 0.15, 1], noDepth: true });
      }

      /* scan footprint of the selected sensor */
      if (S.show.fan && i === S.sel && r.on !== false) {
        var f = [], N2 = 64, R = Math.min(r.rmax, ext * 1.6);
        var lift = R * Math.tan(Math.max(-80, Math.min(80, r.el || 0)) * DEG);
        var a0 = (r.az - r.apAz) * DEG, a1 = (r.az + r.apAz) * DEG;
        var prev = null;
        for (var kk = 0; kk <= N2; kk++) {
          var ang = a0 + (a1 - a0) * kk / N2;
          var px = r.x + Math.sin(ang) * R, py = r.y + Math.cos(ang) * R;
          var pz = Grid.sampleZ(g, px, py);
          if (pz !== pz) pz = g.zmin;
          pz += lift;
          if (prev) V.seg(f, prev[0], prev[1], prev[2], px, py, pz);
          prev = [px, py, pz];
        }
        var e0x = r.x + Math.sin(a0) * R, e0y = r.y + Math.cos(a0) * R;
        var e1x = r.x + Math.sin(a1) * R, e1y = r.y + Math.cos(a1) * R;
        var z0 = Grid.sampleZ(g, e0x, e0y), z1b = Grid.sampleZ(g, e1x, e1y);
        V.seg(f, r.x, r.y, r.z, e0x, e0y, (z0 === z0 ? z0 : g.zmin) + lift);
        V.seg(f, r.x, r.y, r.z, e1x, e1y, (z1b === z1b ? z1b : g.zmin) + lift);
        batches.push({ verts: f, color: [col[0], col[1], col[2], 0.4] });
      }
    });

    /* probe: LOS + movement vectors */
    if (S.probe) {
      var p = S.probe, r0 = S.radars[S.sel];
      var los = [];
      if (r0) V.seg(los, r0.x, r0.y, r0.z, p.x, p.y, p.z);
      batches.push({ verts: los, color: [1, 1, 1, 0.75], noDepth: true });
      var mk = [], m = ext * 0.01;
      V.seg(mk, p.x - m, p.y, p.z, p.x + m, p.y, p.z);
      V.seg(mk, p.x, p.y - m, p.z, p.x, p.y + m, p.z);
      V.seg(mk, p.x, p.y, p.z - m, p.x, p.y, p.z + m);
      batches.push({ verts: mk, color: [1, 1, 0.2, 1], noDepth: true });

      if (S.show.vec) {
        var id = Grid.nodeIndex(g, p.x, p.y);
        if (id >= 0) {
          var fx = S.der.fx[id], fy = S.der.fy[id];
          var mag2 = fx * fx + fy * fy, mag = Math.sqrt(mag2), Lv = ext * 0.05;
          var arrow = function (vx, vy, vz, col2) {
            var arr = [], n2 = Math.hypot(vx, vy, vz) || 1;
            var ex = p.x + vx / n2 * Lv, ey = p.y + vy / n2 * Lv, ez = p.z + vz / n2 * Lv;
            V.seg(arr, p.x, p.y, p.z, ex, ey, ez);
            batches.push({ verts: arr, color: col2, noDepth: true });
          };
          if (mag > 1e-9) {
            var LL = Math.sqrt(mag2 + mag2 * mag2);
            arrow(-fx / LL, -fy / LL, -mag2 / LL, [1, 0.32, 0.32, 1]);   // steepest
            arrow(-fx / mag, -fy / mag, 0, [0.3, 0.85, 0.35, 1]);        // horizontal
          }
          arrow(0, 0, -1, [0.2, 0.6, 1, 1]);                             // vertical
          arrow(S.der.nx[id], S.der.ny[id], S.der.nz[id], [1, 0.6, 0.1, 1]); // normal
          if (SM.Model.mode() === 'custom') {
            var cv = SM.Model.custRel()
              ? Sens.slopeRelVec(fx, fy, SM.numOr('inpCustOff', 0))
              : Sens.customVec(parseFloat($('inpCustAz').value) || 0, parseFloat($('inpCustPl').value) || 0);
            arrow(cv[0], cv[1], cv[2], [0.88, 0.25, 0.98, 1]);
          }
          /* inside a structural domain none of the above is what the model
             uses, so the one that actually applies is drawn longer and in the
             domain's own colour rather than left to be guessed at */
          var dh = S.domIdx ? S.domIdx[id] : -1;
          if (dh >= 0 && S.domains[dh]) {
            var D = S.domains[dh], dvv = Sens.customVec(D.trend, D.plunge);
            var dc = ColorMaps.hex2rgb(D.color).map(function (q) { return q / 255; });
            var dv2 = [], Ld2 = ext * 0.075;
            V.seg(dv2, p.x, p.y, p.z,
              p.x + dvv[0] * Ld2, p.y + dvv[1] * Ld2, p.z + dvv[2] * Ld2);
            batches.push({ verts: dv2, color: [dc[0], dc[1], dc[2], 1], noDepth: true });
          }
        }
      }
    }

    V.setLines(fills.concat(batches));
    V.draw();
  }

  return {
    update: update, drapeRing: drapeRing,
    /* the edit tool puts its handles on the corners this returns, so both read
       the geometry from one place and cannot disagree about where they are */
    planeCorners: planeCorners, DIP_ASPECT: DIP_ASPECT,
    /* exposed so a trace can be checked against the plane and the survey it
       claims to lie on, which is the only thing that makes it a trace */
    planeTrace: planeTrace, planeOutline: planeOutline
  };
})();


/* ============================================================
   Map tools — one armed at a time, exactly like a GIS.
   ============================================================ */
SM.Tools = (function () {

  var $ = SM.$, S = SM.S, EXT = SM.EXT;

  var LABEL = {
    nav: 'Navigate', identify: 'Identify', sensor: 'Place radar', aoi: 'Draw region',
    plane: 'Pick a plane', domain: 'Draw domain', measure: 'Measure',
    edit: 'Stretch vertices', anchor: 'Place plane'
  };
  /* the two tools that trace a closed ring behave identically; only what
     happens to the finished ring differs */
  function isRing(t) { return t === 'aoi' || t === 'domain'; }

  function set(t) {
    var hadPicks = S.pickBuf.length && (isRing(S.tool) || S.tool === 'plane');
    /* leaving the domain tool by any route drops the staged movement vector,
       so a half-abandoned wedge cannot attach itself to the next polygon */
    if (S.tool === 'domain' && t !== 'domain') S.pendingDomain = null;
    /* Re-arming the ruler starts a fresh measurement. The previous answer has
       been read by the time anyone reaches for the tool again, and silently
       appending the next click to it would be a surprise. */
    /* a vertex still stuck to the pointer has to be put down before the tool
       changes under it, or it would follow the next tool around */
    if (S.tool === 'edit' && t !== 'edit') SM.Edit.release();
    if (S.tool === 'anchor' && t !== 'anchor') S.anchorPlane = null;
    var reArm = t === 'measure' && S.tool !== 'measure';
    S.tool = t;
    S.pickBuf = [];
    $('sbTool').textContent = LABEL[t] || t;
    if (reArm) SM.Measure.clear();
    banner();
    if (hadPicks && S.grid) SM.Overlays.update();
    SM.Cmd.refresh();
  }

  /** the instruction strip at the bottom of the map, or nothing to say */
  function banner() {
    var b = $('pickBanner');
    if (S.tool === 'sensor') {
      b.classList.remove('hidden');
      b.textContent = 'Click the model to place “' +
        (S.radars[S.sel] ? S.radars[S.sel].name : 'radar') + '”  (Esc to cancel)';
    } else if (S.tool === 'domain' && S.pendingDomain && S.pendingDomain.auto) {
      b.classList.remove('hidden');
      b.textContent = autoBanner();
    } else if (isRing(S.tool)) {
      b.classList.remove('hidden');
      b.textContent = polyBanner();
    } else if (S.tool === 'plane') {
      b.classList.remove('hidden');
      b.textContent = planeBanner();
    } else if (S.tool === 'measure') {
      b.classList.remove('hidden');
      b.textContent = SM.Measure.banner();
    } else if (S.tool === 'edit') {
      SM.Edit.banner();
      return;
    } else if (S.tool === 'anchor') {
      b.classList.remove('hidden');
      var ap = S.planes[S.anchorPlane];
      b.textContent = 'Click the model to place ' + (ap ? '“' + ap.name + '”' : 'the plane') +
        '  (Esc to cancel)';
    } else {
      b.classList.add('hidden');
    }
  }

  /** what the ring being traced will become once it closes */
  function ringSubject() {
    if (S.tool !== 'domain') {
      return S.polys.length ? 'region ' + (S.polys.length + 1) : 'the AOI polygon';
    }
    var p = S.pendingDomain;
    return 'the block moving ' +
      (p ? Math.round(p.trend) + '° → ' + Math.round(p.plunge) + '°' : 'along the staged vector');
  }

  /** the auto-block tool asks for one point, not a boundary */
  function autoBanner() {
    var p = S.pendingDomain;
    return 'Click where the wedge daylights — the toe of it — and the block is built from ' +
      (p && p.planes ? p.planes[0].name + ' × ' + p.planes[1].name : 'the two planes') +
      '  (Esc to cancel)';
  }

  function polyBanner() {
    var n = S.pickBuf.length;
    var what = S.tool === 'domain' ? 'Structural domain'
      : (S.polys.length ? 'Region ' + (S.polys.length + 1) : 'AOI polygon');
    if (!n) return 'Click the first vertex of ' + ringSubject() + '  (Esc to cancel)';
    if (n < 3) return what + ' — ' + n + (n === 1 ? ' vertex' : ' vertices') +
      ', at least 3 needed  ·  Backspace undo  ·  Esc cancel';
    return what + ' — ' + n + ' vertices  ·  Enter, double-click or click the first vertex to close' +
      '  ·  Backspace undo  ·  Esc cancel';
  }

  function planeBanner() {
    var n = S.pickBuf.length;
    if (!n) return 'Click points along the structure on the model — 3 or more  (Esc to cancel)';
    if (n < 3) return 'Plane fit — ' + n + (n === 1 ? ' point' : ' points') +
      ', at least 3 needed  ·  Backspace undo  ·  Esc cancel';
    var f = Struct.fitPlane(S.pickBuf);
    return 'Plane fit — ' + n + ' points, currently ' + Math.round(f.dip) + '/' +
      Math.round(f.dipDir) + ' (scatter ' + f.rms.toFixed(2) + ' m)  ·  Enter to accept' +
      '  ·  Backspace undo  ·  Esc cancel';
  }

  function polyRefresh() {
    $('pickBanner').textContent = S.tool === 'plane' ? planeBanner() : polyBanner();
    SM.Overlays.update();
  }

  function finishPoly() {
    var tool = S.tool;
    var ring = S.pickBuf.slice();          /* set() empties the buffer */
    if (ring.length < 3) {
      SM.status(tool === 'plane'
        ? 'A plane needs at least 3 points — nothing was added.'
        : 'A polygon needs at least 3 vertices — nothing was added.');
      set('identify');
      return;
    }
    if (tool === 'plane') {
      /* the pending vector must survive set(), which is why the ring is copied
         and the tool changed before anything is committed */
      set('identify');
      SM.Structure.commitPlanePick(ring);
      return;
    }
    if (tool === 'domain') {
      var pend = S.pendingDomain;
      S.tool = 'identify'; S.pickBuf = [];      /* set() would drop `pend` */
      $('sbTool').textContent = LABEL.identify;
      banner();
      S.pendingDomain = pend;
      SM.Structure.commitDomainRing(ring.map(function (p) { return [p[0], p[1]]; }));
      SM.Cmd.refresh();
      return;
    }
    set('identify');
    SM.AOI.commitRing(ring);
  }

  function extRelease() {
    EXT.pick = null; EXT.cancel = null;
    $('pickBanner').classList.add('hidden');
    banner();
  }

  /* ------------------------------------------------- canvas clicks */
  function onCanvasClick(hit, ev) {
    /* An add-on placing a tie-point owns the click outright — it must not also
       move the probe or drop an AOI corner. */
    if (EXT.pick) { if (hit) EXT.pick(hit); return; }

    /* The stretch tool aims at overlay handles, which float clear of the
       terrain — so it takes the click before the "did the ray hit ground?"
       test. A corner poking above the crest has sky behind it and no terrain
       hit at all, and it still has to be grabbable. */
    if (S.tool === 'edit') { SM.Edit.onClick(hit, ev); return; }

    if (!hit) {
      if (S.tool === 'identify') {
        S.probe = null; $('hudReadout').classList.add('hidden'); SM.Overlays.update();
      }
      return;
    }

    if (S.tool === 'sensor') {
      SM.Sensors.placeAt(hit);
      set('identify');
      return;
    }

    if (S.tool === 'anchor') { SM.Structure.anchorAt(hit); set('identify'); return; }

    if (S.tool === 'measure') {
      var mb = S.measure.pts, msnap = S.grid ? Math.max(S.grid.dx, S.grid.dy) * 1.5 : 1;
      /* clicking back on the first point closes the ring, which is the gesture
         that turns a distance into an area */
      if (mb.length >= 3 && SM.nearXY(hit, mb[0], msnap)) { SM.Measure.finish(true); return; }
      if (mb.length >= 2 && SM.nearXY(hit, mb[mb.length - 1], msnap)) { SM.Measure.finish(false); return; }
      SM.Measure.add(hit);
      $('pickBanner').textContent = SM.Measure.banner();
      return;
    }

    if (S.tool === 'plane') {
      /* full 3D points here, not just X/Y: the whole purpose is the elevation
         difference between the picks, which is what the dip comes out of */
      var pb = S.pickBuf;
      if (SM.nearXY(hit, pb[pb.length - 1], S.grid ? Math.max(S.grid.dx, S.grid.dy) * 1.5 : 1)) {
        if (pb.length >= 3) finishPoly();
        return;
      }
      pb.push([hit.x, hit.y, hit.z]);
      polyRefresh();
      return;
    }

    /* one click builds the whole block when the staged vector came from a
       wedge and auto is on — there is nothing to trace */
    if (S.tool === 'domain' && S.pendingDomain && S.pendingDomain.auto) {
      var pend = S.pendingDomain;
      S.tool = 'identify'; S.pickBuf = [];
      $('sbTool').textContent = LABEL.identify;
      banner();
      S.pendingDomain = pend;
      if (!SM.Structure.autoBlockAt(hit)) {
        /* it did not build: stay in the tool so the next click can try again
           somewhere better, rather than making them start over */
        S.tool = 'domain';
        $('sbTool').textContent = LABEL.domain;
        banner();
      } else {
        S.pendingDomain = null;
      }
      SM.Cmd.refresh();
      return;
    }

    if (isRing(S.tool)) {
      var buf = S.pickBuf;
      /* A double-click lands twice within a pixel or two of the same spot, and
         clicking back onto the first vertex is the usual "close it here"
         gesture. Both mean finish; below three vertices they mean nothing yet,
         so the repeat is swallowed instead of stacking a duplicate vertex. */
      var snap = S.grid ? Math.max(S.grid.dx, S.grid.dy) * 1.5 : 1;
      if (SM.nearXY(hit, buf[buf.length - 1], snap) || SM.nearXY(hit, buf[0], snap)) {
        if (buf.length >= 3) finishPoly();
        return;
      }
      buf.push([hit.x, hit.y]);
      polyRefresh();
      return;
    }

    if (S.tool !== 'identify') return;      // Navigate leaves the probe alone

    S.probe = hit;
    SM.Probe.show(hit);
    SM.Overlays.update();
    for (var pi = 0; pi < EXT.probe.length; pi++) EXT.probe[pi](hit);
  }

  function init() {
    document.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (!typing && !EXT.pick && S.tool === 'measure') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (SM.Measure.finish(false)) set('identify');
          return;
        }
        if (e.key === 'Backspace') {
          e.preventDefault();
          SM.Measure.undo();
          $('pickBanner').textContent = SM.Measure.banner();
          return;
        }
      }
      if (!typing && !EXT.pick && (isRing(S.tool) || S.tool === 'plane')) {
        if (e.key === 'Enter') { e.preventDefault(); finishPoly(); return; }
        if (e.key === 'Backspace') {
          e.preventDefault();
          if (S.pickBuf.length) { S.pickBuf.pop(); polyRefresh(); }
          return;
        }
      }
      if (e.key !== 'Escape') return;
      if (EXT.pick) { var c = EXT.cancel; extRelease(); if (c) c(); return; }
      /* the first Escape puts a held vertex back; the second leaves the tool */
      if (S.tool === 'edit' && SM.Edit.cancel()) return;
      /* Escape abandons a measurement in progress; a finished one is left
         alone, because putting the tool away is not the same as being done
         with the answer */
      if (S.tool === 'measure' && !S.measure.closed && S.measure.pts.length) SM.Measure.clear();
      if (S.tool !== 'identify') set('identify');
    });
    set('identify');
  }

  return { init: init, set: set, banner: banner, extRelease: extRelease, onCanvasClick: onCanvasClick };
})();
