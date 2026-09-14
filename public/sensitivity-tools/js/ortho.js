/* ============================================================
   ortho.js — drape a georeferenced photograph over the terrain.

   The viewer colours the surface one RGB per grid node (Viewer.setColors), so
   there is no texture to manage: draping an orthophoto means sampling it at
   every node's world position once, and keeping that as a second colour source
   the symbology can blend the active layer over.

   Resampling is deliberate. A mine ortho is 5–10 cm; the model grid is metres,
   so one cell covers hundreds of photo pixels and point-sampling would pick one
   of them at random — the drape would crawl with noise and change every time
   the grid resolution did. Cells coarser than the photo are box-averaged
   instead, over a bounded subsample so the cost stays predictable.

   Coverage is tracked separately from colour: an ortho is clipped to a flight
   boundary, and outside it there is no photograph rather than a black one.
   ============================================================ */
'use strict';

var Ortho = (function () {

  /* A cell is averaged over at most this many samples per axis. Beyond about
     4x4 the drape stops changing visibly but the cost keeps climbing, and on a
     1000 x 1000 grid every extra sample is another megapixel of work. */
  var MAX_SUB = 4;

  /**
   * Sample a photo onto a grid's nodes.
   *
   * @param {{w,h,rgb,alpha,x0,y0,dx,dy}} im  photo; x0,y0 is the centre of the
   *        north-west pixel and rows run north → south.
   * @param {{nx,ny,dx,dy,x0,y0}} g  the model grid; rows run south → north.
   * @returns {{rgb:Float32Array, cover:Uint8Array, covered:number}}
   *          rgb is 0-1 per node, cover is 1 where the photo actually has
   *          pixels, and `covered` counts those nodes.
   */
  function sample(im, g) {
    var n = g.nx * g.ny;
    var rgb = new Float32Array(n * 3);
    var cover = new Uint8Array(n);
    var covered = 0;

    /* how many photo pixels a cell spans, capped */
    var subX = clampSub(g.dx / im.dx), subY = clampSub(g.dy / im.dy);
    var box = subX > 1 || subY > 1;

    for (var iy = 0; iy < g.ny; iy++) {
      var wy = g.y0 + iy * g.dy;
      for (var ix = 0; ix < g.nx; ix++) {
        var wx = g.x0 + ix * g.dx;
        var id = iy * g.nx + ix, o = id * 3;
        var r = 0, gg = 0, b = 0, hits = 0;

        if (!box) {
          var p = bilinear(im, wx, wy);
          if (p) { r = p[0]; gg = p[1]; b = p[2]; hits = 1; }
        } else {
          /* average over the cell's footprint, sampling its interior evenly */
          for (var sy = 0; sy < subY; sy++) {
            var fy = wy + g.dy * ((sy + 0.5) / subY - 0.5);
            for (var sx = 0; sx < subX; sx++) {
              var fx = wx + g.dx * ((sx + 0.5) / subX - 0.5);
              var q = nearest(im, fx, fy);
              if (!q) continue;
              r += q[0]; gg += q[1]; b += q[2]; hits++;
            }
          }
        }
        if (!hits) continue;                    /* no photograph here */
        rgb[o] = r / hits / 255;
        rgb[o + 1] = gg / hits / 255;
        rgb[o + 2] = b / hits / 255;
        cover[id] = 1;
        covered++;
      }
    }
    return { rgb: rgb, cover: cover, covered: covered };
  }

  function clampSub(ratio) {
    var k = Math.round(ratio);
    if (!(k > 1)) return 1;
    return k > MAX_SUB ? MAX_SUB : k;
  }

  var px = [0, 0, 0];

  /** nearest photo pixel, or null outside the image or where it is transparent */
  function nearest(im, x, y) {
    var c = Math.round((x - im.x0) / im.dx);
    var r = Math.round((im.y0 - y) / im.dy);     /* photo rows run north → south */
    if (c < 0 || r < 0 || c >= im.w || r >= im.h) return null;
    var i = r * im.w + c;
    if (im.alpha && im.alpha[i] < 128) return null;
    px[0] = im.rgb[i * 3]; px[1] = im.rgb[i * 3 + 1]; px[2] = im.rgb[i * 3 + 2];
    return px;
  }

  /** bilinear blend, used when the photo is coarser than the cells */
  function bilinear(im, x, y) {
    var fc = (x - im.x0) / im.dx, fr = (im.y0 - y) / im.dy;
    var c0 = Math.floor(fc), r0 = Math.floor(fr);
    var tx = fc - c0, ty = fr - r0;
    var r = 0, g = 0, b = 0, wsum = 0;
    for (var dy = 0; dy < 2; dy++) {
      for (var dx = 0; dx < 2; dx++) {
        var cc = c0 + dx, rr = r0 + dy;
        if (cc < 0 || rr < 0 || cc >= im.w || rr >= im.h) continue;
        var i = rr * im.w + cc;
        if (im.alpha && im.alpha[i] < 128) continue;
        var wgt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
        if (wgt <= 0) continue;
        r += im.rgb[i * 3] * wgt; g += im.rgb[i * 3 + 1] * wgt; b += im.rgb[i * 3 + 2] * wgt;
        wsum += wgt;
      }
    }
    if (!wsum) return null;
    px[0] = r / wsum; px[1] = g / wsum; px[2] = b / wsum;
    return px;
  }

  /** the photo's world extent, for reporting how it lines up with the model */
  function bounds(im) {
    return {
      xmin: im.x0 - im.dx / 2,
      xmax: im.x0 + (im.w - 0.5) * im.dx,
      ymin: im.y0 - (im.h - 0.5) * im.dy,
      ymax: im.y0 + im.dy / 2
    };
  }

  /**
   * Do a photo and a grid overlap at all? A photo in the right CRS but the
   * wrong zone lands thousands of kilometres away, and silently draping
   * nothing is the least useful thing that could happen.
   */
  function overlaps(im, g) {
    var b = bounds(im);
    var gx0 = g.x0 - g.dx / 2, gx1 = g.x0 + (g.nx - 0.5) * g.dx;
    var gy0 = g.y0 - g.dy / 2, gy1 = g.y0 + (g.ny - 0.5) * g.dy;
    return b.xmin < gx1 && b.xmax > gx0 && b.ymin < gy1 && b.ymax > gy0;
  }

  return { sample: sample, bounds: bounds, overlaps: overlaps, MAX_SUB: MAX_SUB };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Ortho;
