/* ============================================================
   ui/editpoly.js — reshaping a boundary that has already been drawn.

   Every polygon in the tool is traced by clicking, and the first trace is
   never quite right: a domain overruns a bench, a region clips a crest, a
   measurement misses the toe by five metres. Redrawing the whole thing to move
   one corner is the wrong answer, so this tool grabs a single vertex and
   stretches it.

   It works by CLICK–MOVE–CLICK rather than by dragging, and that is deliberate:
   dragging in the 3D view already means orbit, and a tool that has to fight the
   camera for the left button is a tool that fights the operator. Click a vertex
   to pick it up, move the pointer and watch the boundary follow, click again to
   drop it. Escape puts it back where it was.

   One tool edits all three kinds of boundary — selection regions, structural
   domains and the ruler — because from the operator's side they are the same
   gesture on the same kind of object, and remembering which tool goes with
   which polygon would be pure ceremony.
   ============================================================ */
'use strict';

SM.Edit = (function () {

  var $ = SM.$, S = SM.S;

  /* Grab radius in SCREEN pixels — generous, because a handle is a few pixels
     of cross-hair on a surface the operator is also orbiting. Picking happens
     in screen space rather than in survey coordinates for one decisive reason:
     a plane's corner floats clear of the ground, so the terrain point under the
     cursor is nowhere near it in plan and a world-space radius would look for
     it in the wrong place. On screen, what you point at is what you get. */
  var GRAB_PX = 13;

  /* The world-space fallback, used only when there is no pointer event to work
     from — a scripted grab, or a call from a test. */
  var GRAB_CELLS = 3;

  function tol() {
    return S.grid ? Math.max(S.grid.dx, S.grid.dy) * GRAB_CELLS : 1;
  }

  /**
   * Everything with vertices that can be moved.
   *
   * Regions and domains hold [x, y]; the ruler holds [x, y, z] because its
   * whole purpose is the elevations. `hasZ` is what tells the mover which it
   * is dealing with, so a moved ruler point is re-levelled onto the surface
   * rather than dragged along at its old RL.
   */
  function targets() {
    var out = [];
    S.polys.forEach(function (ring, i) {
      out.push({ kind: 'region', idx: i, ring: ring, hasZ: false, min: 3 });
    });
    S.domains.forEach(function (d, i) {
      out.push({ kind: 'domain', idx: i, ring: d.ring, hasZ: false, min: 3 });
    });
    if (S.measure.pts.length) {
      out.push({ kind: 'measure', idx: 0, ring: S.measure.pts, hasZ: true,
        min: S.measure.closed ? 3 : 2 });
    }
    return out;
  }

  /**
   * A mapped plane is not a polygon — it is an anchor, an orientation and a
   * size, and the rectangle is derived from those. It still has to be
   * stretchable, so it gets handles of its own: the four CORNERS resize it and
   * the CENTRE moves it. Corner index 0-3, centre index 4.
   *
   * Only planes that have a location can be grabbed. A typed dip and dip
   * direction is an orientation and nothing more — it has to be placed on the
   * model before there is anything on the surface to take hold of.
   */
  var CENTRE = 4;

  /* A ring gets one more handle than it has vertices: its centroid, which moves
     the WHOLE boundary instead of one corner of it. Same idea as a plane's
     centre handle, and the thing that makes a duplicated polygon useful — a
     copy is only worth having if it can be put somewhere else in one gesture.
     Numbered below zero so it can never collide with a vertex index. */
  var MOVE = -1;

  function centroidOf(ring) {
    var cx = 0, cy = 0;
    for (var i = 0; i < ring.length; i++) { cx += ring[i][0]; cy += ring[i][1]; }
    return [cx / ring.length, cy / ring.length];
  }

  function planeHandles(out) {
    var g = S.grid;
    if (!g) return out;
    var ext = SM.extentOf(g).ext;
    S.planes.forEach(function (p, i) {
      if (p.on === false || !p.anchor) return;
      var size = SM.Structure.planeSize(ext, p);
      SM.Overlays.planeCorners(p.anchor, p.dip, p.dipDir, size).forEach(function (q, k) {
        out.push({ kind: 'plane', idx: i, vi: k, x: q[0], y: q[1], z: q[2] });
      });
      out.push({ kind: 'plane', idx: i, vi: CENTRE,
        x: p.anchor[0], y: p.anchor[1], z: p.anchor[2] });
    });
    return out;
  }

  /**
   * Every grabbable point there is, in survey coordinates. One list, used both
   * for picking and for drawing the handles, so what can be clicked on and what
   * can be seen cannot drift apart. `z` is null where the point has no level of
   * its own and should be draped onto the surface.
   */
  function handles() {
    var out = [];
    targets().forEach(function (T) {
      T.ring.forEach(function (p, vi) {
        out.push({ kind: T.kind, idx: T.idx, vi: vi,
          x: p[0], y: p[1], z: T.hasZ ? p[2] : null });
      });
      if (T.ring.length >= 3) {
        var c = centroidOf(T.ring);
        out.push({ kind: T.kind, idx: T.idx, vi: MOVE, x: c[0], y: c[1], z: null });
      }
    });
    return planeHandles(out);
  }

  function find(kind, idx) {
    var t = targets();
    for (var i = 0; i < t.length; i++) if (t[i].kind === kind && t[i].idx === idx) return t[i];
    return null;
  }

  /* ------------------------------------------------------- picking */
  /** the nearest handle in survey coordinates — the no-pointer fallback */
  function nearestVertex(x, y) {
    var H = handles(), best = null, r = tol();
    for (var i = 0; i < H.length; i++) {
      var d = Math.hypot(H[i].x - x, H[i].y - y);
      if (d <= r && (!best || d < best.dist)) {
        best = { kind: H[i].kind, idx: H[i].idx, vi: H[i].vi, dist: d };
      }
    }
    return best;
  }

  /** the nearest handle to the pointer, measured on screen where it is aimed */
  function nearestOnScreen(ev) {
    if (!ev || !SM.V || !SM.V.project) return null;
    var at = SM.V.pointerAt(ev), H = handles(), best = null;
    for (var i = 0; i < H.length; i++) {
      var sp = SM.V.project(H[i].x, H[i].y, H[i].z);
      if (!sp) continue;                                  // behind the camera
      var d = Math.hypot(sp[0] - at[0], sp[1] - at[1]);
      if (d <= GRAB_PX && (!best || d < best.dist)) {
        best = { kind: H[i].kind, idx: H[i].idx, vi: H[i].vi, dist: d };
      }
    }
    return best;
  }

  /** screen first, survey coordinates only when there is no pointer to use */
  function nearestAt(hit, ev) {
    return nearestOnScreen(ev) || (hit ? nearestVertex(hit.x, hit.y) : null);
  }

  /** perpendicular distance from a point to a segment, and where it lands */
  function toSegment(x, y, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var px = a[0] + dx * t, py = a[1] + dy * t;
    return { dist: Math.hypot(x - px, y - py), t: t, px: px, py: py };
  }

  /**
   * The nearest edge, for inserting a vertex into it. Only the middle of an
   * edge counts: near either end the operator is reaching for the vertex that
   * is already there, and quietly inserting a second one on top of it is the
   * kind of thing that makes a tool feel broken.
   */
  function nearestEdge(x, y) {
    var t = targets(), best = null, r = tol();
    for (var i = 0; i < t.length; i++) {
      var T = t[i], ring = T.ring;
      var closed = T.kind !== 'measure' || S.measure.closed;
      var nEdge = closed ? ring.length : ring.length - 1;
      for (var e = 0; e < nEdge; e++) {
        var seg = toSegment(x, y, ring[e], ring[(e + 1) % ring.length]);
        if (seg.t <= 0.001 || seg.t >= 0.999) continue;
        if (seg.dist <= r && (!best || seg.dist < best.dist)) {
          best = { kind: T.kind, idx: T.idx, ei: e, dist: seg.dist, px: seg.px, py: seg.py };
        }
      }
    }
    return best;
  }

  /* ------------------------------------------------------- the gesture */
  /** what a grabbed handle has to be put back to if the move is cancelled */
  function snapshot(kind, idx, vi) {
    if (kind === 'plane') {
      var P = S.planes[idx];
      return P ? { anchor: P.anchor ? P.anchor.slice() : null, size: P.size } : null;
    }
    var T = find(kind, idx);
    if (!T) return null;
    /* moving the whole ring has to be undoable as a whole, so the snapshot is
       every vertex rather than the one that was grabbed */
    if (vi === MOVE) return T.ring.map(function (p) { return p.slice(); });
    return T.ring[vi] ? T.ring[vi].slice() : null;
  }

  function grab(kind, idx, vi, ev) {
    var orig = snapshot(kind, idx, vi);
    if (!orig) return;
    S.editGrab = { kind: kind, idx: idx, vi: vi, orig: orig, scale: null };
    /* Resizing a plane by a corner is a screen gesture: remember how far the
       pointer started from the projected centre, and the size at that moment,
       so the patch scales by the ratio the pointer moves through. That is how
       a scale handle behaves in any editor, it needs no terrain under the
       cursor, and it stays predictable whatever the plane's orientation. */
    if (kind === 'plane' && vi !== CENTRE && ev && SM.V.project) {
      var P = S.planes[idx];
      var c = P && P.anchor ? SM.V.project(P.anchor[0], P.anchor[1], P.anchor[2]) : null;
      var at = SM.V.pointerAt(ev);
      if (c) {
        var d0 = Math.hypot(at[0] - c[0], at[1] - c[1]);
        if (d0 > 4) {
          S.editGrab.scale = {
            d0: d0, size0: SM.Structure.planeSize(SM.extentOf(S.grid).ext, P)
          };
        }
      }
    }
    S.editHi = null;
    banner();
    SM.Overlays.update();
  }

  /* Half the diagonal of a plane patch, as a multiple of half its strike
     length — the factor that turns "how far the corner was dragged" back into
     a size. */
  function halfDiag() {
    var a = SM.Overlays.DIP_ASPECT;
    return Math.sqrt(1 + a * a);
  }

  function minSize() { return S.grid ? Math.max(S.grid.dx, S.grid.dy) * 2 : 1; }

  /** move the held handle to wherever the pointer is */
  function moveTo(hit, ev) {
    var G = S.editGrab;
    if (!G) return;

    if (G.kind === 'plane') {
      var P = S.planes[G.idx];
      if (!P) { S.editGrab = null; return; }
      if (G.vi === CENTRE) {
        /* the centre carries the whole patch, level included: a structure put
           somewhere new sits on the surface there, not at its old RL. It is the
           one handle that must land on the ground, so it needs a terrain hit. */
        if (hit) P.anchor = [hit.x, hit.y, hit.z];
      } else if (G.scale && ev && SM.V.project) {
        var c = SM.V.project(P.anchor[0], P.anchor[1], P.anchor[2]);
        var at = SM.V.pointerAt(ev);
        if (c) {
          var d = Math.hypot(at[0] - c[0], at[1] - c[1]);
          P.size = Math.max(minSize(), G.scale.size0 * (d / G.scale.d0));
        }
      } else if (hit) {
        /* no pointer to scale by: fall back to the distance out from the
           centre, a corner being half a diagonal away from it */
        var w = Math.hypot(hit.x - P.anchor[0], hit.y - P.anchor[1], hit.z - P.anchor[2]);
        P.size = Math.max(minSize(), 2 * w / halfDiag());
      }
      SM.Overlays.update();
      return;
    }

    if (!hit) return;                       // a ring vertex has to land on ground
    var T = find(G.kind, G.idx);
    if (T && G.vi === MOVE) {
      /* the centroid follows the pointer and the rest of the ring comes with
         it, keeping its shape exactly */
      var c = centroidOf(T.ring);
      var mx = hit.x - c[0], my = hit.y - c[1];
      T.ring.forEach(function (p) {
        p[0] += mx; p[1] += my;
        /* a ruler point carries a level, and the level belongs to the ground
           it has just been moved over */
        if (T.hasZ) {
          var z = Grid.sampleZ(S.grid, p[0], p[1]);
          p[2] = z === z ? z : p[2];
        }
      });
      SM.Overlays.update();
      return;
    }
    if (!T) { S.editGrab = null; return; }
    var p = T.ring[G.vi];
    p[0] = hit.x; p[1] = hit.y;
    /* a ruler point carries its own level, and the level it should carry is
       the surface under where it has just been put */
    if (T.hasZ) p[2] = hit.z;
    SM.Overlays.update();
  }

  function drop() {
    var G = S.editGrab;
    if (!G) return;
    S.editGrab = null;
    commit(G.kind);
    banner();
  }

  /** put it back and let go — the undo for a move in progress */
  function cancel() {
    var G = S.editGrab;
    if (!G) return false;
    if (G.kind === 'plane') {
      var P = S.planes[G.idx];
      if (P) { P.anchor = G.orig.anchor; P.size = G.orig.size; }
      S.editGrab = null;
      commit('plane');
      banner();
      SM.status('Move cancelled — the plane is back where it was.');
      return true;
    }
    var T = find(G.kind, G.idx);
    if (T && G.vi === MOVE) {
      for (var r = 0; r < T.ring.length && r < G.orig.length; r++) {
        T.ring[r][0] = G.orig[r][0];
        T.ring[r][1] = G.orig[r][1];
        if (T.hasZ && G.orig[r].length > 2) T.ring[r][2] = G.orig[r][2];
      }
    } else if (T && T.ring[G.vi]) {
      T.ring[G.vi][0] = G.orig[0];
      T.ring[G.vi][1] = G.orig[1];
      if (T.hasZ && G.orig.length > 2) T.ring[G.vi][2] = G.orig[2];
    }
    S.editGrab = null;
    commit(G.kind);
    banner();
    SM.status('Move cancelled — the vertex is back where it was.');
    return true;
  }

  /** drop the held vertex out of the boundary altogether */
  function removeVertex() {
    var G = S.editGrab;
    if (!G) return;
    if (G.kind === 'plane') {
      SM.status('A mapped plane has no vertices — remove the whole plane in the Structure tab.');
      return;
    }
    var T = find(G.kind, G.idx);
    if (!T) return;
    if (G.vi === MOVE) {
      SM.status('That is the move handle — it holds the whole boundary, so there is no ' +
        'single vertex to remove. Grab a corner instead.');
      return;
    }
    if (T.ring.length <= T.min) {
      SM.status('That boundary is down to its last ' + T.min + ' points — remove the whole thing instead.');
      return;
    }
    T.ring.splice(G.vi, 1);
    S.editGrab = null;
    commit(G.kind);
    banner();
    SM.status('Vertex removed — ' + T.ring.length + ' left.');
  }

  function insert(kind, idx, ei, x, y) {
    var T = find(kind, idx);
    if (!T) return;
    var p = T.hasZ ? [x, y, Grid.sampleZ(S.grid, x, y)] : [x, y];
    if (T.hasZ && p[2] !== p[2]) p[2] = S.grid.zmin;
    T.ring.splice(ei + 1, 0, p);
    grab(kind, idx, ei + 1);
    SM.status('Vertex added — move it and click to drop.');
  }

  /**
   * Everything downstream of a reshaped boundary.
   *
   * Deferred to the drop rather than run on every pointer move: a region's mask
   * and a domain's cell index are both a pass over the raster, and doing that
   * at pointer rate would make the stretch crawl. While a vertex is held the
   * outline moves and the shading stays behind; on the drop they meet again.
   */
  function commit(kind) {
    if (kind === 'plane') {
      /* Where a plane sits and how big it is drawn are symbology: the kinematic
         analysis reads its dip and dip direction and nothing else, so there is
         no result to invalidate. The row does have to be redrawn though — it
         carries where the plane is, how big it is, and the control that hands
         a stretched one back to the default size. */
      SM.Overlays.update();
      SM.Structure.refreshPlanes();
      SM.Cmd.refresh();
      return;
    }
    if (kind === 'region') {
      SM.AOI.writePolyBounds();
      SM.AOI.apply();
      if (S.node.kind === 'region') SM.AOI.showRegion(S.node.id);
    } else if (kind === 'domain') {
      SM.Structure.domainsChanged();
    } else {
      SM.Measure.render();
      SM.Overlays.update();
    }
    SM.Cmd.refresh();
  }

  /* ------------------------------------------------------- wiring */
  /** live feedback: the held vertex follows, or the next one lights up */
  function hover(ev) {
    if (S.tool !== 'edit' || !S.grid) return;
    /* the raycast is only needed for the handles that have to land on ground;
       everything else is answered on screen, so a pointer over the sky still
       highlights and still scales a plane */
    var hit = SM.V.pickAt(ev);
    if (S.editGrab) { moveTo(hit, ev); return; }
    var n = nearestAt(hit, ev);
    var same = (!n && !S.editHi) ||
      (n && S.editHi && n.kind === S.editHi.kind && n.idx === S.editHi.idx && n.vi === S.editHi.vi);
    if (same) return;
    S.editHi = n;
    SM.Overlays.update();
  }

  function onClick(hit, ev) {
    /* Place it where the click landed rather than where the last hover left
       it. Hover is throttled, so the pointer can travel a little further
       before the button goes down — and a click with no hover in front of it
       at all (a script, a touch tap) has to work too. */
    if (S.editGrab) { moveTo(hit, ev); drop(); return; }
    var v = nearestAt(hit, ev);
    if (v) { grab(v.kind, v.idx, v.vi, ev); return; }
    if (!hit) return;                       // nothing aimed at, nothing under it
    var e = nearestEdge(hit.x, hit.y);
    if (e) { insert(e.kind, e.idx, e.ei, e.px, e.py); return; }
    /* The commonest reason nothing is grabbable is a mapped plane that was
       typed rather than picked: it has an orientation but no location, so
       there is nothing on the surface to take hold of. Say so, rather than
       leaving the operator clicking at a rectangle that was never drawn. */
    var homeless = S.planes.filter(function (p) { return p.on !== false && !p.anchor; }).length;
    SM.status('Nothing within reach — click closer to a handle, or to an edge to add a vertex.' +
      (homeless
        ? '  ' + homeless + ' typed plane' + (homeless === 1 ? ' has' : 's have') +
          ' no location yet — use “Place” on its row in the Structure tab.'
        : ''));
  }

  function banner() {
    var b = $('pickBanner');
    b.classList.remove('hidden');
    var G = S.editGrab;
    b.textContent = G
      ? (G.vi === MOVE
        ? 'Moving the whole boundary — click to drop it  ·  Esc puts it back'
        : G.kind === 'plane'
        ? (G.vi === CENTRE
          ? 'Moving a plane — click to drop it  ·  Esc puts it back'
          : 'Resizing a plane — click to set its size  ·  Esc puts it back')
          : 'Holding a vertex — move the pointer, click to drop  ·  Delete removes it  ·  Esc puts it back')
      : (handles().length
        ? 'Click a handle to pick it up, or an edge to add a vertex.  ' +
          'A centre handle moves the whole thing; a plane corner resizes it.  (Esc to finish)'
        : 'Nothing to stretch — draw a region or a domain, or place a plane on the model first  (Esc)');
  }

  /** leaving the tool must not leave a vertex stuck to the pointer */
  function release() {
    if (S.editGrab) drop();
    S.editHi = null;
  }

  function init() {
    document.addEventListener('keydown', function (e) {
      if (S.tool !== 'edit' || !S.editGrab) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeVertex(); }
    });
  }

  return {
    init: init, hover: hover, onClick: onClick, banner: banner, release: release,
    cancel: cancel, removeVertex: removeVertex,
    targets: targets, handles: handles, CENTRE: CENTRE, MOVE: MOVE,
    centroidOf: centroidOf,
    nearestVertex: nearestVertex, nearestOnScreen: nearestOnScreen,
    nearestAt: nearestAt, nearestEdge: nearestEdge,
    grab: grab, drop: drop, insert: insert
  };
})();
