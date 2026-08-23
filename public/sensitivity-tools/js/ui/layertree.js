/* ============================================================
   ui/layertree.js — the Layers panel, and the single source of truth for
   which raster is painted and which overlays are drawn.

   The tree is not a view of some other control: the radio buttons under
   Analysis and Terrain *are* the active-layer setting, the tick boxes *are*
   `S.show` and `radar.on`, and selecting a row is what routes the Properties
   dock. Everything else in the app reads that state rather than a widget.
   ============================================================ */
'use strict';

SM.Tree = (function () {

  var $ = SM.$, S = SM.S, esc = SM.esc, icon = SM.icon;

  /* which groups are unfolded — remembered across rebuilds */
  var open = { analysis: true, terrain: true, sensors: true, scans: true, aoi: true,
    planes: true, domains: true, anno: false };

  var ANNO = [
    { key: 'fan', name: 'Scan footprint / LOS', icon: 'fan',
      hint: 'The selected sensor’s scan sector draped on the terrain, and the line of sight to the probed cell' },
    { key: 'vec', name: 'Movement vectors', icon: 'vector',
      hint: 'At the probed cell: steepest (red), horizontal (green), vertical (blue), normal (orange), custom (magenta)' },
    { key: 'box', name: 'Bounding box & axes', icon: 'axes',
      hint: 'Model extent box plus a north arrow and axis triad at the south-west corner' },
    { key: 'wire', name: 'Wireframe', icon: 'wire',
      hint: 'The raster mesh over the surface — shows whether the cell size resolves your benches' },
    { key: 'struct', name: 'Mapped planes', icon: 'plane',
      hint: 'A disc at each plane picked off the surface, oriented on its dip and dip direction. Typed orientations have no location, so nothing is drawn for them' },
    { key: 'dom', name: 'Domain outlines & vectors', icon: 'wedge',
      hint: 'Each structural domain’s footprint draped on the terrain, with an arrow along the movement direction it forces' },
    { key: 'xline', name: 'Plane intersections', icon: 'wedge',
      hint: 'The segment two mapped planes actually share, where they are in contact on the model — red where the pair is critical in the failure mode being tested, amber where it is a near miss, grey where it is neither. A pair with no line here never touches, however its poles plot. The pole modes — planar sliding, flexural toppling — test single planes and have no intersections to draw' },
    { key: 'fill', name: 'Shade drawn areas', icon: 'polygon',
      hint: 'Paint the area inside each polygon onto the terrain, not just its outline — the selection mask, every structural domain, and mapped planes as solid discs. The shading follows the raster, so it shows the cells the analysis actually claims' }
  ];

  /* ------------------------------------------------------- markup */
  function row(o) {
    var cls = ['tnode'];
    if (o.group) cls.push('group');
    if (o.disabled) cls.push('dis');
    if (o.selected) cls.push('sel');
    if (o.active) cls.push('act');
    if (o.hi) cls.push('hi');
    if (o.group && !o.open) cls.push('shut');

    var h = '<div class="' + cls.join(' ') + '" data-k="' + o.kind + '"' +
      (o.id != null ? ' data-i="' + esc(o.id) + '"' : '') +
      (o.indet ? ' data-indet="1"' : '') +
      ' style="padding-left:' + (4 + (o.depth || 0) * 13) + 'px"' +
      (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>';

    h += o.group
      ? '<button class="ttwist" data-twist="' + esc(o.id) + '">' + icon('chevron') + '</button>'
      : '<span class="ttwist empty"></span>';

    if (o.check === 'radio') {
      h += '<input class="tbox" type="radio" name="treeLayer" value="' + esc(o.id) + '"' +
        (o.on ? ' checked' : '') + (o.disabled ? ' disabled' : '') + '>';
    } else if (o.check === 'box') {
      h += '<input class="tbox" type="checkbox"' + (o.on ? ' checked' : '') +
        (o.disabled ? ' disabled' : '') + '>';
    } else {
      h += '<span class="tbox"></span>';
    }

    if (o.ramp) h += '<span class="tramp" style="background:' + o.ramp + '"></span>';
    else if (o.swatch) h += '<span class="tswatch" style="background:' + esc(o.swatch) + '"></span>';
    else if (o.icon) h += icon(o.icon, 'ticon');

    h += '<span class="tname">' + esc(o.name) + '</span>';
    if (o.meta) h += '<span class="tmeta">' + esc(o.meta) + '</span>';
    h += o.removable ? '<button class="tx" title="Remove">×</button>' : '';
    return h + '</div>';
  }

  function groupRow(id, name, extra, opts) {
    var o = { kind: 'group', id: id, name: name, group: true, open: open[id],
      depth: 0, icon: null, meta: extra || '' };
    if (opts) Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    return row(o);
  }

  /* ------------------------------------------------------- build */
  function refresh() {
    var host = $('layerTree');
    if (!host) return;
    var h = [];
    var sel = S.node;

    /* ---- the surface itself, above the layers painted onto it ---- */
    h.push(row({
      kind: 'surface', id: 'surface', name: 'Terrain surface', depth: 0, check: 'box',
      on: S.show.surface, icon: 'pit', disabled: !S.grid,
      meta: S.show.flat ? 'flat colour' : '',
      hint: 'Show or hide the terrain mesh. Overlays keep drawing either way. ' +
        'Its colouring — the layer scale, or one flat colour — is in the View tab.'
    }));

    /* ---- raster layers, one radio across both groups ---- */
    ['analysis', 'terrain'].forEach(function (grp) {
      h.push(groupRow(grp, grp === 'analysis' ? 'Analysis' : 'Terrain'));
      if (!open[grp]) return;
      SM.LAYERS.forEach(function (L) {
        if (L.group !== grp) return;
        var off = L.needsRes && !S.res;
        h.push(row({
          kind: 'layer', id: L.id, name: L.name, depth: 1, check: 'radio',
          on: S.layer === L.id, disabled: off || !S.grid,
          selected: sel.kind === 'layer' && sel.id === L.id,
          active: S.layer === L.id,
          ramp: rampCss(L.id),
          hint: off ? L.name + ' — compute the sensitivity map first' : L.name
        }));
      });
    });

    /* ---- radar positions ---- */
    h.push(groupRow('sensors', 'Radar positions',
      S.radars.length ? S.radars.length + '' : ''));
    if (open.sensors) {
      if (!S.radars.length) h.push('<div class="treeEmpty">No radar positions yet — use <b>+</b> above.</div>');
      S.radars.forEach(function (r, i) {
        h.push(row({
          kind: 'sensor', id: i, name: r.name, depth: 1, check: 'box', on: r.on !== false,
          swatch: r.color, selected: i === S.sel,
          active: i === S.sel,
          meta: usableOf(i),
          removable: S.radars.length > 1,
          hint: 'Tick to include this position in the computation. ' +
            Math.round(r.x) + ', ' + Math.round(r.y) + ', RL ' + Math.round(r.z)
        }));
      });
    }

    /* ---- radar deformation scans, owned by the add-on ---- */
    var folders = (window.RadarUI && RadarUI.folders) ? RadarUI.folders() : [];
    if (folders.length) {
      h.push(groupRow('scans', 'Deformation scans', folders.length + ''));
      if (open.scans) folders.forEach(function (f) {
        h.push(row({
          kind: 'scan', id: f.key, name: f.name, depth: 1, icon: 'scan',
          selected: sel.kind === 'scan',
          meta: f.placed ? f.scans.length + ' scan' + (f.scans.length === 1 ? '' : 's') : 'not placed',
          hint: f.placed ? 'Georeferenced — ' + f.radar : 'Needs georeferencing before it can be drawn'
        }));
        if (!f.placed) return;
        f.scans.forEach(function (s) {
          h.push(row({
            kind: 'scanItem', id: s.id, name: s.when, depth: 2, check: 'box', on: s.visible,
            icon: 'raster', meta: s.peak, hint: 'Show or hide this scan in the 3D view'
          }));
        });
      });
    }

    /* ---- area of interest ---- */
    h.push(row({
      kind: 'aoi', id: 'aoi', name: 'Area of interest', group: true, open: open.aoi,
      depth: 0, check: 'box', on: $('chkAOI') && $('chkAOI').checked,
      selected: sel.kind === 'aoi',
      meta: S.polys.length ? S.polys.length + ' region' + (S.polys.length === 1 ? '' : 's') : 'rectangle',
      hint: 'Restricts statistics, the histogram and the position ranking to the cells inside the mask'
    }));
    if (open.aoi) S.polys.forEach(function (ring, i) {
      h.push(row({
        kind: 'region', id: i, name: SM.AOI.nameOf(i), depth: 1, icon: 'polygon',
        selected: sel.kind === 'region' && sel.id === i,
        hi: i === S.polyHi, removable: true,
        meta: regionMeta(i, ring),
        hint: ring.length + ' vertices — hover to pick it out in the 3D view'
      }));
    });

    /* ---- structural geology: the mapped planes, then the domains they
       produced. Both are edited in the Structure tab; the tree carries the
       tick boxes and is the quickest way back to that tab. ---- */
    if (S.planes.length) {
      var pOn = SM.Structure.countOn(S.planes);
      h.push(groupRow('planes', 'Discontinuities', pOn + ' / ' + S.planes.length, {
        check: 'box', on: pOn === S.planes.length,
        indet: pOn > 0 && pOn < S.planes.length,
        hint: 'Tick to put every discontinuity into the kinematic analysis, untick to leave them all out'
      }));
      if (open.planes) S.planes.forEach(function (p, i) {
        h.push(row({
          kind: 'plane', id: i, name: p.name, depth: 1, check: 'box', on: p.on !== false,
          swatch: p.color, removable: true,
          hi: !!S.netHi && S.netHi.kind === 'plane' && S.netHi.index === i,
          meta: Math.round(p.dip) + '/' + Math.round(p.dipDir),
          hint: 'Untick to leave this plane out of the kinematic analysis'
        }));
      });
    }
    if (S.domains.length) {
      var dOn = SM.Structure.countOn(S.domains);
      h.push(groupRow('domains', 'Structural domains', dOn + ' / ' + S.domains.length, {
        check: 'box', on: dOn === S.domains.length,
        indet: dOn > 0 && dOn < S.domains.length,
        hint: 'Tick to let every domain override the movement vector, untick to switch them all off'
      }));
      if (open.domains) S.domains.forEach(function (d, i) {
        h.push(row({
          kind: 'domain', id: i, name: d.name, depth: 1, check: 'box', on: d.on !== false,
          swatch: d.color, removable: true, hi: i === S.domHi,
          meta: Math.round(d.trend) + '→' + Math.round(d.plunge),
          hint: 'Cells inside this polygon are modelled as moving ' +
            Math.round(d.trend) + '° at ' + Math.round(d.plunge) + '° plunge, ' +
            'whatever the global movement vector says'
        }));
      });
    }

    /* ---- annotations ---- */
    h.push(groupRow('anno', 'Annotations'));
    if (open.anno) ANNO.forEach(function (a) {
      h.push(row({
        kind: 'anno', id: a.key, name: a.name, depth: 1, check: 'box',
        on: !!S.show[a.key], icon: a.icon, hint: a.hint
      }));
    });

    host.innerHTML = h.join('');
    /* the middle state of a group's tick box is not an attribute, so it has to
       be set on the element after the markup lands */
    Array.prototype.forEach.call(host.querySelectorAll('.tnode.group[data-indet] .tbox'),
      function (b) { b.indeterminate = true; });
  }

  /* the ramp preview each raster row carries, so the tree doubles as a legend */
  function rampCss(id) {
    var c = SM.LC[id];
    if (!c) return null;
    try { return ColorMaps.cssGradient(ColorMaps.buildLUT(c), true); }
    catch (e) { return null; }
  }

  function usableOf(i) {
    if (!S.res) return '';
    var r = S.radars[i];
    for (var k = 0; k < S.res.perRadar.length; k++) {
      if (S.res.perRadar[k].radar === r) return (100 * S.res.perRadar[k].stats.usable).toFixed(0) + '%';
    }
    return '';
  }

  /* Cell counts come from the last mask pass, so they are blanked whenever the
     two are out of step rather than shown stale. */
  function regionMeta(i, ring) {
    var counts = (S.regions.length === S.polys.length) ? S.regions : null;
    var c = counts ? counts[i] : null;
    if (c == null) return ring.length + ' pts';
    var cellA = S.grid ? S.grid.dx * S.grid.dy : NaN;
    return ring.length + ' pts · ' + (cellA === cellA ? SM.fmt(c * cellA / 10000, 1) + ' ha' : SM.fmtInt(c));
  }

  /* ------------------------------------------------------- actions */
  function select(kind, id) {
    S.node = { kind: kind, id: id };
    var name = '';
    if (kind === 'layer') name = (SM.LAYER_BY_ID[id] || {}).name;
    else if (kind === 'sensor') name = (S.radars[id] || {}).name;
    else if (kind === 'region') name = SM.AOI.nameOf(+id);
    else if (kind === 'aoi') name = 'Area of interest';
    else if (kind === 'scan') name = 'Deformation scans';
    SM.Shell.showProps(kind, name);
    /* the region strip inside the AOI pane follows the selection, so the pane
       describes the mask and the strip describes the one region picked */
    SM.AOI.showRegion(kind === 'region' ? +id : null);
    if (kind !== 'none') SM.Shell.focusProps();
    refresh();
    SM.Cmd.refresh();
  }

  /** the raster painted on the surface */
  function setLayer(id) {
    var L = SM.LAYER_BY_ID[id];
    if (!L) return;
    if (L.needsRes && !S.res) {
      SM.status('Compute the sensitivity map first — showing elevation.');
      id = 'elev';
    }
    S.layer = id;
    SM.Symbology.syncForm();
    SM.Symbology.autoRange(false);
    SM.Symbology.colorize();
    select('layer', id);
  }

  function setShow(key) {
    S.show[key] = !S.show[key];
    applyShow();
    refresh();
    SM.Cmd.refresh();
  }

  function applyShow() {
    if (SM.V) { SM.V.opt.wire = !!S.show.wire; }
    SM.Overlays.update();
    if (SM.V) SM.V.draw();
  }

  function removeSelected() {
    if (S.node.kind === 'sensor') SM.Sensors.remove(S.node.id);
    else if (S.node.kind === 'region') SM.AOI.removePoly(S.node.id);
  }

  /* hovering a plane or a domain row picks it out in the 3D view and, for a
     plane, on the stereonet as well — one highlight, both places */
  function hoverStruct(kind, i) {
    if (kind === 'domain') {
      if (i === S.domHi) return;
      S.domHi = i;
      SM.Overlays.update();
      return;
    }
    SM.Structure.highlight(i >= 0 ? 'plane' : null, i);
  }

  /* ------------------------------------------------------- wiring */
  function init() {
    var host = $('layerTree');

    host.addEventListener('click', function (e) {
      var tw = e.target.closest('.ttwist[data-twist]');
      if (tw) {
        var k = tw.getAttribute('data-twist');
        open[k] = !open[k];
        refresh();
        return;
      }
      var node = e.target.closest('.tnode');
      if (!node) return;
      var kind = node.getAttribute('data-k');
      var id = node.getAttribute('data-i');

      if (e.target.closest('.tx')) {
        e.stopPropagation();
        if (kind === 'sensor') SM.Sensors.remove(+id);
        else if (kind === 'region') SM.AOI.removePoly(+id);
        else if (kind === 'plane') SM.Structure.removePlane(+id);
        else if (kind === 'domain') SM.Structure.removeDomain(+id);
        return;
      }
      if (e.target.closest('.tbox')) return;      // handled by the change event

      if (kind === 'group') { open[id] = !open[id]; refresh(); return; }
      if (kind === 'layer') { setLayer(id); return; }
      if (kind === 'sensor') { SM.Sensors.select(+id); return; }
      if (kind === 'region') { select('region', +id); return; }
      if (kind === 'aoi') { select('aoi', 'aoi'); return; }
      if (kind === 'scan' || kind === 'scanItem') { select('scan', id); return; }
      /* structural rows have no Properties pane of their own: everything about
         them is edited in the Structure tab, so clicking one goes there */
      if (kind === 'plane' || kind === 'domain') {
        SM.Shell.tab('struct');
        SM.Structure.highlight(kind === 'plane' ? 'plane' : null, +id);
        if (kind === 'domain') { S.domHi = +id; SM.Overlays.update(); }
        return;
      }
      if (kind === 'anno') { setShow(id); return; }
      /* the surface has no properties of its own — how it is drawn lives in
         the View tab, so that is where the row goes */
      if (kind === 'surface') { SM.Shell.tab('view'); return; }
    });

    host.addEventListener('change', function (e) {
      var box = e.target.closest('.tbox');
      if (!box) return;
      var node = e.target.closest('.tnode');
      var kind = node.getAttribute('data-k'), id = node.getAttribute('data-i');

      if (kind === 'layer') { setLayer(id); return; }
      if (kind === 'sensor') { SM.Sensors.setEnabled(+id, box.checked); return; }
      if (kind === 'group') {
        if (id === 'planes') SM.Structure.setAllPlanes(box.checked);
        else if (id === 'domains') SM.Structure.setAllDomains(box.checked);
        return;
      }
      if (kind === 'anno') { setShow(id); return; }
      if (kind === 'plane') {
        if (S.planes[+id]) { S.planes[+id].on = box.checked; SM.Structure.changed(); }
        return;
      }
      if (kind === 'domain') { SM.Structure.toggleDomain(+id); return; }
      if (kind === 'surface') { SM.Symbology.setSurface(box.checked); return; }
      if (kind === 'aoi') { SM.AOI.setOn(box.checked); return; }
      if (kind === 'scanItem') {
        if (window.RadarUI && RadarUI.toggleScan) RadarUI.toggleScan(id);
        return;
      }
    });

    /* hovering a region picks it out in the 3D view, exactly as the old
       region list did — the highlight lives in the overlay, not in CSS alone */
    host.addEventListener('mousemove', function (e) {
      var node = e.target.closest('.tnode[data-k=region]');
      var i = node ? +node.getAttribute('data-i') : -1;
      var dn = e.target.closest('.tnode[data-k=domain]');
      hoverStruct('domain', dn ? +dn.getAttribute('data-i') : -1);
      var pn = e.target.closest('.tnode[data-k=plane]');
      hoverStruct('plane', pn ? +pn.getAttribute('data-i') : -1);
      if (i === S.polyHi) return;
      S.polyHi = i;
      markHi();
      SM.Overlays.update();
    });
    host.addEventListener('mouseleave', function () {
      hoverStruct('domain', -1);
      hoverStruct('plane', -1);
      if (S.polyHi < 0) return;
      S.polyHi = -1;
      markHi();
      SM.Overlays.update();
    });

    refresh();
  }

  /* repaint the highlight without rebuilding the row under the pointer */
  function markHi() {
    Array.prototype.forEach.call($('layerTree').querySelectorAll('.tnode[data-k=region]'), function (r) {
      r.classList.toggle('hi', +r.getAttribute('data-i') === S.polyHi);
    });
  }

  return {
    init: init, refresh: refresh, select: select, setLayer: setLayer,
    setShow: setShow, applyShow: applyShow, removeSelected: removeSelected
  };
})();
