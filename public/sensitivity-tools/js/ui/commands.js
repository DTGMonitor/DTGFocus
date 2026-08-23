/* ============================================================
   ui/commands.js — one registry behind the menu bar, the tool bar and every
   button in the docks.

   A command is declared once with its label, icon, availability rule and
   effect. The menu bar and the tool bar are generated from that declaration,
   and any button anywhere can trigger it by carrying `data-cmd="id"`. Nothing
   in the app wires a second click handler for an action that already exists,
   so a command can never be live in one place and dead in another.
   ============================================================ */
'use strict';

SM.Cmd = (function () {

  var $ = SM.$, S = SM.S;

  /* A module may not exist yet when this file loads, so every effect resolves
     its target at call time. `mod` keeps that lookup honest — a typo becomes a
     status message rather than a silent no-op. */
  function call(path, arg) {
    var parts = path.split('.'), o = SM;
    for (var i = 0; i < parts.length - 1; i++) o = o && o[parts[i]];
    var fn = o && o[parts[parts.length - 1]];
    if (typeof fn !== 'function') { SM.status('Not available: ' + path); return; }
    return fn(arg);
  }

  var hasGrid = function () { return !!S.grid; };
  var hasRes = function () { return !!S.res; };

  /* ------------------------------------------------------- registry */
  var LIST = [
    /* --- project --- */
    { id: 'project.open', label: 'Add terrain data…', icon: 'adddata',
      hint: 'Add a DTM, DXF, Surpac string or ASCII point file',
      run: function () { $('fileInput').click(); } },
    { id: 'project.demo', label: 'Load demo open pit', icon: 'pit',
      hint: 'A synthetic 330 m benched pit with a bulging wall',
      run: function () { call('Data.loadDemo'); } },
    { id: 'model.build', label: 'Build / rebuild model', icon: 'grid',
      hint: 'Re-grid the loaded data with the current cell size',
      enabled: function () { return S.files.some(function (f) { return f.dataset; }); },
      run: function () { call('Data.buildModel'); } },
    { id: 'project.save', label: 'Save project', icon: 'save',
      hint: 'Sensors, settings, colour ramps and camera as one JSON file',
      run: function () { call('IO.saveProject'); } },
    { id: 'project.load', label: 'Load project', icon: 'openproj',
      hint: 'Restore a saved project',
      run: function () { $('hiddenProj').click(); } },

    /* --- map tools (mutually exclusive) --- */
    { id: 'tool.nav', label: 'Navigate', icon: 'pan', tool: 'nav',
      hint: 'Orbit, pan and zoom without probing' },
    { id: 'tool.identify', label: 'Identify', icon: 'identify', tool: 'identify',
      hint: 'Click a cell to read its coordinates, slope and sensitivity' },
    { id: 'tool.sensor', label: 'Place radar', icon: 'sensor', tool: 'sensor',
      hint: 'Click the model to move the selected radar position there',
      enabled: hasGrid },
    { id: 'tool.aoi', label: 'Draw region', icon: 'polygon', tool: 'aoi',
      hint: 'Trace an area of interest vertex by vertex — Enter closes it',
      enabled: hasGrid },
    { id: 'tool.plane', label: 'Pick a plane', icon: 'plane', tool: 'plane',
      hint: 'Click three or more points along a structure on the surface and fit a plane through them',
      enabled: hasGrid },
    { id: 'tool.measure', label: 'Measure', icon: 'ruler', tool: 'measure',
      hint: 'Distance, height difference, inclination, ground length and surface area — the check on the slope model',
      enabled: hasGrid },
    { id: 'tool.edit', label: 'Stretch vertices', icon: 'stretch', tool: 'edit',
      hint: 'Pick up a vertex of any region, domain or measurement and move it; click an edge to add one',
      enabled: function () {
        return !!S.grid && !!(S.polys.length || S.domains.length || S.measure.pts.length ||
          S.planes.some(function (p) { return p.on !== false && p.anchor; }));
      } },
    { id: 'region.dup', label: 'Duplicate region', icon: 'copy',
      hint: 'Copy the selected region, offset so it can be moved into place',
      enabled: function () { return S.node.kind === 'region'; },
      run: function () { call('AOI.duplicatePoly', S.node.id); } },
    { id: 'measure.clear', label: 'Clear measurement', icon: 'trash',
      enabled: function () { return !!S.measure.pts.length; },
      run: function () { call('Measure.clear'); } },

    /* --- view --- */
    { id: 'view.fit', label: 'Zoom to full extent', icon: 'extent',
      hint: 'Frame the whole model', enabled: hasGrid,
      run: function () { SM.V.fit(); } },
    { id: 'view.plan', label: 'Plan view', icon: 'plan',
      hint: 'Look straight down', enabled: hasGrid,
      run: function () { SM.V.viewTop(); } },
    { id: 'view.iso', label: 'Isometric view', icon: 'iso',
      hint: 'Standard three-quarter view', enabled: hasGrid,
      run: function () { SM.V.viewIso(); } },
    { id: 'view.eye', label: 'Radar eye', icon: 'eye',
      hint: 'Put the camera at the selected sensor — see exactly what it sees',
      enabled: hasGrid,
      run: function () { var r = S.radars[S.sel]; if (r) SM.V.viewFrom(r.x, r.y, r.z); } },

    /* overlay toggles — the tree owns the same flags, these are the menu path */
    { id: 'show.surface', label: 'Terrain surface', icon: 'pit',
      hint: 'Hide the terrain mesh; everything drawn on it keeps drawing',
      enabled: hasGrid,
      toggle: function () { return S.show.surface; },
      run: function () { call('Symbology.setSurface', !S.show.surface); } },
    { id: 'show.flat', label: 'Single flat colour', icon: 'ramp',
      hint: 'Paint the terrain one colour instead of the active layer’s scale — untick to revert',
      enabled: hasGrid,
      toggle: function () { return S.show.flat; },
      run: function () { call('Symbology.setFlat', !S.show.flat); } },
    { id: 'show.wire', label: 'Wireframe', icon: 'wire',
      toggle: function () { return S.show.wire; },
      run: function () { call('Tree.setShow', 'wire'); } },
    { id: 'show.box', label: 'Bounding box & axes', icon: 'axes',
      toggle: function () { return S.show.box; },
      run: function () { call('Tree.setShow', 'box'); } },
    { id: 'show.fan', label: 'Scan footprint / LOS', icon: 'fan',
      toggle: function () { return S.show.fan; },
      run: function () { call('Tree.setShow', 'fan'); } },
    { id: 'show.vec', label: 'Movement vectors', icon: 'vector',
      toggle: function () { return S.show.vec; },
      run: function () { call('Tree.setShow', 'vec'); } },
    { id: 'show.struct', label: 'Mapped planes', icon: 'plane',
      toggle: function () { return S.show.struct; },
      run: function () { call('Tree.setShow', 'struct'); } },
    { id: 'show.dom', label: 'Domain outlines & vectors', icon: 'wedge',
      toggle: function () { return S.show.dom; },
      run: function () { call('Tree.setShow', 'dom'); } },
    { id: 'show.xline', label: 'Plane intersections', icon: 'wedge',
      hint: 'The line two mapped planes actually share on the model',
      toggle: function () { return S.show.xline; },
      run: function () { call('Tree.setShow', 'xline'); } },
    { id: 'show.fill', label: 'Shade drawn areas', icon: 'polygon',
      hint: 'Fill the selection mask, the structural domains and the mapped planes, not just outline them',
      toggle: function () { return S.show.fill; },
      run: function () { call('Tree.setShow', 'fill'); } },
    { id: 'panel.left', label: 'Layers panel', icon: 'layers',
      toggle: function () { return !$('dockLeft').classList.contains('collapsed'); },
      run: function () { call('Shell.toggleDock', 'left'); } },
    { id: 'panel.right', label: 'Properties panel', icon: 'ramp',
      toggle: function () { return !$('dockRight').classList.contains('collapsed'); },
      run: function () { call('Shell.toggleDock', 'right'); } },

    /* --- layer --- */
    { id: 'sensor.add', label: 'Add radar position', icon: 'plus',
      hint: 'A new sensor, dropped somewhere over the model',
      run: function () { call('Sensors.add'); } },
    { id: 'sensor.dup', label: 'Duplicate radar position', icon: 'copy',
      hint: 'Copy the selected sensor, geometry and all',
      enabled: function () { return !!S.radars.length; },
      run: function () { call('Sensors.duplicate'); } },
    { id: 'layer.remove', label: 'Remove selected item', icon: 'trash',
      hint: 'Delete the selected radar position or drawn region',
      enabled: function () { return S.node.kind === 'sensor' || S.node.kind === 'region'; },
      run: function () { call('Tree.removeSelected'); } },

    /* --- symbology --- */
    { id: 'scale.export', label: 'Export colour ramp', icon: 'save',
      hint: 'Save this layer’s ramp so every map in a report matches',
      run: function () { call('IO.exportScale'); } },
    { id: 'scale.import', label: 'Import colour ramp', icon: 'openproj',
      hint: 'Apply a saved ramp to the active layer',
      run: function () { call('IO.importScale'); } },

    /* --- analysis --- */
    { id: 'analysis.compute', label: 'Compute sensitivity map', icon: 'compute',
      hint: 'Run the line-of-sight model over every cell',
      enabled: hasGrid,
      run: function () { call('Model.recompute'); } },
    { id: 'aoi.toggle', label: 'Restrict analysis to AOI', icon: 'mask',
      hint: 'Statistics, histogram and ranking then cover the mask only',
      toggle: function () { return $('chkAOI').checked; },
      enabled: hasGrid,
      run: function () { call('AOI.toggle'); } },
    { id: 'aoi.full', label: 'AOI = full extent', icon: 'extent',
      hint: 'Reset the mask to the whole model', enabled: hasGrid,
      run: function () { call('AOI.setFullAndApply'); } },
    { id: 'aoi.clear', label: 'Clear drawn regions', icon: 'trash',
      hint: 'Discard every region and go back to the plain X/Y rectangle',
      enabled: function () { return !!S.polys.length; },
      run: function () { call('AOI.clearPolys'); } },

    /* --- structural geology --- */
    { id: 'struct.show', label: 'Structure tab', icon: 'net',
      hint: 'Mapped discontinuities, the kinematic test and the stereonet',
      run: function () { call('Shell.tab', 'struct'); } },
    { id: 'struct.domain', label: 'Draw structural domain', icon: 'wedge',
      hint: 'Trace the block a wedge would release; its cells then move down that wedge’s own direction',
      enabled: hasGrid,
      run: function () { call('Structure.drawDomain'); } },
    { id: 'struct.planesOn', label: 'Use every discontinuity', icon: 'plane',
      hint: 'Put every mapped plane back into the kinematic analysis',
      enabled: function () {
        return !!S.planes.length && SM.Structure.countOn(S.planes) < S.planes.length;
      },
      run: function () { call('Structure.setAllPlanes', true); } },
    { id: 'struct.planesOff', label: 'Use no discontinuities', icon: 'plane',
      hint: 'Leave every mapped plane out, without deleting any of them',
      enabled: function () { return !!SM.Structure.countOn(S.planes); },
      run: function () { call('Structure.setAllPlanes', false); } },
    { id: 'struct.domainsOn', label: 'Switch every domain on', icon: 'wedge',
      enabled: function () {
        return !!S.domains.length && SM.Structure.countOn(S.domains) < S.domains.length;
      },
      run: function () { call('Structure.setAllDomains', true); } },
    { id: 'struct.domainsOff', label: 'Switch every domain off', icon: 'wedge',
      hint: 'The whole model goes back to the global movement vector',
      enabled: function () { return !!SM.Structure.countOn(S.domains); },
      run: function () { call('Structure.setAllDomains', false); } },
    { id: 'struct.clearPlanes', label: 'Clear mapped planes', icon: 'trash',
      enabled: function () { return !!S.planes.length; },
      run: function () { call('Structure.clearPlanes'); } },
    { id: 'struct.clearDomains', label: 'Clear structural domains', icon: 'trash',
      hint: 'Every cell goes back to the global movement vector',
      enabled: function () { return !!S.domains.length; },
      run: function () { call('Structure.clearDomains'); } },

    /* --- clipping --- */
    { id: 'clip.off', label: 'No clipping', icon: 'iso',
      toggle: function () { return S.clip.mode === 'off'; },
      enabled: hasGrid, run: function () { call('Clip.setMode', 'off'); } },
    { id: 'clip.box', label: 'Clip box', icon: 'clipbox',
      hint: 'Six draggable faces in survey coordinates',
      toggle: function () { return S.clip.mode === 'box'; },
      enabled: hasGrid, run: function () { call('Clip.setMode', 'box'); } },
    { id: 'clip.slab', label: 'Cross-section', icon: 'section',
      hint: 'A thin slab you can walk through the model',
      toggle: function () { return S.clip.mode === 'slab'; },
      enabled: hasGrid, run: function () { call('Clip.setMode', 'slab'); } },
    { id: 'clip.back', label: 'Section back', icon: 'back',
      hint: 'Step the section back by one thickness',
      enabled: function () { return S.clip.mode === 'slab'; },
      run: function () { call('Clip.step', -1); } },
    { id: 'clip.fwd', label: 'Section forward', icon: 'fwd',
      hint: 'Step the section forward by one thickness',
      enabled: function () { return S.clip.mode === 'slab'; },
      run: function () { call('Clip.step', 1); } },
    { id: 'clip.toAoi', label: 'Use clip box as AOI', icon: 'mask',
      enabled: function () { return S.clip.mode !== 'off'; },
      run: function () { call('Clip.toAOI'); } },
    { id: 'clip.fromAoi', label: 'Clip box from AOI', icon: 'clipbox',
      enabled: function () { return S.clip.mode !== 'off'; },
      run: function () { call('Clip.fromAOI'); } },

    /* --- export --- */
    { id: 'export.png', label: 'Export PNG view', icon: 'image',
      hint: 'The 3D view with a title block and colour bar',
      enabled: hasGrid, run: function () { call('IO.exportPNG'); } },
    { id: 'export.csv', label: 'Export CSV', icon: 'table',
      hint: 'One row per cell: coordinates, slope, sensitivity, visibility',
      enabled: hasGrid, run: function () { call('IO.exportCSV'); } },
    { id: 'export.kin', label: 'Export kinematic results', icon: 'table',
      hint: 'One row per plane pair: intersection, critical zone and movement direction',
      enabled: function () { return !!(S.kin && S.kin.total); },
      run: function () { call('IO.exportKinematics'); } },
    { id: 'export.net', label: 'Export stereonet PNG', icon: 'image',
      hint: 'The stereonet on its own, for a report figure',
      enabled: function () { return !!S.planes.length; },
      run: function () { call('IO.exportNet'); } },
    { id: 'export.asc', label: 'Export ESRI ASCII grid', icon: 'raster',
      hint: 'The active layer as a .asc raster',
      enabled: hasGrid, run: function () { call('IO.exportASC'); } },

    /* --- help --- */
    { id: 'help.show', label: 'Quick guide & parameter reference', icon: 'help',
      key: 'F1', run: function () { $('helpModal').classList.remove('hidden'); } }
  ];

  var BY_ID = {};
  LIST.forEach(function (c) { BY_ID[c.id] = c; });

  /* ------------------------------------------------------- layout */
  var MENUS = [
    { title: 'Project', items: ['project.open', 'project.demo', '-', 'model.build', '-',
      'project.save', 'project.load', '-', 'export.png', 'export.csv', 'export.asc',
      'export.kin', 'export.net'] },
    { title: 'Tools', items: ['tool.nav', 'tool.identify', 'tool.sensor', 'tool.aoi', 'tool.plane',
      '-', 'tool.edit', '-', 'tool.measure', 'measure.clear'] },
    { title: 'Layer', items: ['sensor.add', 'sensor.dup', 'region.dup', 'layer.remove', '-',
      'scale.export', 'scale.import'] },
    { title: 'Analysis', items: ['analysis.compute', '-', 'aoi.toggle', 'aoi.full', 'aoi.clear'] },
    { title: 'Structure', items: ['struct.show', '-', 'tool.plane', 'struct.domain', '-',
      'struct.planesOn', 'struct.planesOff', 'struct.domainsOn', 'struct.domainsOff', '-',
      'struct.clearPlanes', 'struct.clearDomains', '-', 'export.kin', 'export.net'] },
    { title: 'View', items: ['view.fit', 'view.plan', 'view.iso', 'view.eye', '-',
      'show.surface', 'show.flat', '-',
      'show.wire', 'show.box', 'show.fan', 'show.vec', 'show.struct', 'show.dom',
      'show.xline', 'show.fill', '-',
      'clip.off', 'clip.box', 'clip.slab', '-', 'clip.toAoi', 'clip.fromAoi', '-',
      'panel.left', 'panel.right'] },
    { title: 'Help', items: ['help.show'] }
  ];

  var TOOLBAR = [
    ['project.open', 'project.demo', 'model.build'],
    ['tool.nav', 'tool.identify', 'tool.sensor', 'tool.aoi', 'tool.plane', 'tool.edit', 'tool.measure'],
    ['view.fit', 'view.plan', 'view.iso', 'view.eye'],
    ['analysis.compute', 'struct.show'],
    ['aoi.toggle', 'clip.box', 'clip.slab', 'clip.back', 'clip.fwd'],
    ['export.png', 'export.csv', 'export.asc'],
    ['project.save', 'project.load']
  ];

  /* ------------------------------------------------------- running */
  function run(id) {
    var c = BY_ID[id];
    if (!c) { SM.status('Unknown command: ' + id); return; }
    if (c.enabled && !c.enabled()) return;
    if (c.tool) { call('Tools.set', c.tool); refresh(); return; }
    if (c.run) c.run();
    refresh();
  }

  /* ------------------------------------------------------- building */
  function build() {
    var mb = $('menubar');
    mb.innerHTML = MENUS.map(function (m) {
      return '<div class="menuRoot"><button class="menuTitle">' + SM.esc(m.title) + '</button>' +
        '<div class="menuPop">' + m.items.map(menuItem).join('') + '</div></div>';
    }).join('');

    var tb = $('toolbar');
    tb.innerHTML = TOOLBAR.map(function (grp) {
      return '<div class="tgroup">' + grp.map(toolButton).join('') + '</div>';
    }).join('<div class="tsep"></div>');

    /* one delegated click for menu titles, and one document-wide dismiss */
    mb.addEventListener('click', function (e) {
      var t = e.target.closest('.menuTitle');
      if (!t) return;
      var root = t.parentNode, wasOpen = root.classList.contains('open');
      closeMenus();
      if (!wasOpen) { root.classList.add('open'); refresh(); }
    });
    mb.addEventListener('mouseover', function (e) {
      /* once one menu is open, sliding sideways opens the next — the usual
         desktop behaviour, and the reason menus feel fast */
      if (!mb.querySelector('.menuRoot.open')) return;
      var t = e.target.closest('.menuTitle');
      if (!t || t.parentNode.classList.contains('open')) return;
      closeMenus(); t.parentNode.classList.add('open'); refresh();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#menubar')) closeMenus();
    });

    /* every [data-cmd] in the document, wherever it lives */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmd]');
      if (!b || b.disabled) return;
      e.preventDefault();
      closeMenus();
      run(b.getAttribute('data-cmd'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'F1') { e.preventDefault(); run('help.show'); }
    });

    refresh();
  }

  function closeMenus() {
    Array.prototype.forEach.call($('menubar').querySelectorAll('.menuRoot.open'),
      function (r) { r.classList.remove('open'); });
  }

  function menuItem(id) {
    if (id === '-') return '<div class="menuSep"></div>';
    var c = BY_ID[id];
    if (!c) return '';
    return '<button class="menuItem" data-cmd="' + id + '"' +
      (c.hint ? ' title="' + SM.esc(c.hint) + '"' : '') + '>' +
      SM.icon(c.icon || 'chevron') + '<span>' + SM.esc(c.label) + '</span>' +
      (c.key ? '<span class="mKey">' + c.key + '</span>' : '') + '</button>';
  }

  function toolButton(id) {
    var c = BY_ID[id];
    if (!c) return '';
    var wide = id === 'analysis.compute';
    return '<button class="tbtn' + (wide ? ' wide accent' : '') + '" data-cmd="' + id + '" title="' +
      SM.esc(c.label + (c.hint ? ' — ' + c.hint : '')) + '">' +
      SM.icon(c.icon || 'chevron') + (wide ? '<span>Compute</span>' : '') + '</button>';
  }

  /** Re-evaluate every command's availability and pressed state. Cheap enough
      to call after anything, which is what keeps the three surfaces agreeing. */
  function refresh() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-cmd]'), function (el) {
      var c = BY_ID[el.getAttribute('data-cmd')];
      if (!c) return;
      var ok = !c.enabled || c.enabled();
      if (el.tagName === 'BUTTON') el.disabled = !ok;
      var lit = c.tool ? (S.tool === c.tool) : (c.toggle ? !!c.toggle() : false);
      el.classList.toggle('on', lit && !c.tool);
      el.classList.toggle('armed', lit && !!c.tool);
    });
  }

  return { build: build, run: run, refresh: refresh, closeMenus: closeMenus };
})();
