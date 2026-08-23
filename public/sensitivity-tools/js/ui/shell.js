/* ============================================================
   ui/shell.js — the window furniture: dock sizing, collapsible panels, the
   right-hand tab strip, the Properties router, the modals and the map's own
   north arrow and scale bar.

   It knows nothing about radars or sensitivity. Its whole job is to put the
   right pane in front of the operator and keep the chrome in step with the
   camera.
   ============================================================ */
'use strict';

SM.Shell = (function () {

  var $ = SM.$, S = SM.S;

  /* Which property section belongs to which kind of tree node, and how the
     Properties header should introduce it. */
  var PROPS = {
    none: { pane: 'propNone', icon: 'layers', kind: 'Pick a layer in the tree' },
    layer: { pane: 'propSymbology', icon: 'ramp', kind: 'Raster layer · symbology' },
    sensor: { pane: 'propSensor', icon: 'sensor', kind: 'Radar position' },
    aoi: { pane: 'propAOI', icon: 'mask', kind: 'Selection mask' },
    region: { pane: 'propAOI', icon: 'polygon', kind: 'Drawn region' },
    scan: { pane: 'propScan', icon: 'scan', kind: 'Radar deformation' }
  };

  /* ------------------------------------------------------- docks */
  function bindGutters() {
    drag($('gutterLeft'), 'dockLeft', 1);
    drag($('gutterRight'), 'dockRight', -1);

    function drag(handle, dockId, sign) {
      if (!handle) return;
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var dock = $(dockId), start = e.clientX, w0 = dock.offsetWidth;
        handle.classList.add('dragging');
        function move(ev) {
          var w = SM.clamp(w0 + sign * (ev.clientX - start), 200, 620);
          dock.style.width = w + 'px';
          if (SM.V) SM.V.resize();
        }
        function up() {
          handle.classList.remove('dragging');
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          layoutAll();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }

    /* the split between Data Sources and Layers */
    var h = document.querySelector('.hgutter');
    if (h) h.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var pane = $('panelSources'), start = e.clientY, h0 = pane.offsetHeight;
      h.classList.add('dragging');
      function move(ev) {
        pane.style.height = SM.clamp(h0 + ev.clientY - start, 90, window.innerHeight - 260) + 'px';
      }
      function up() {
        h.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function toggleDock(side) {
    var d = $(side === 'left' ? 'dockLeft' : 'dockRight');
    var g = $(side === 'left' ? 'gutterLeft' : 'gutterRight');
    var off = d.classList.toggle('collapsed');
    g.classList.toggle('hidden', off);
    if (SM.V) SM.V.resize();
    layoutAll();
  }

  /* ------------------------------------------------------- panels */
  function bindPanels() {
    Array.prototype.forEach.call(document.querySelectorAll('.panelHead'), function (head) {
      head.addEventListener('click', function (e) {
        /* the header carries its own buttons — only bare header clicks fold it */
        if (e.target.closest('.panelTools')) return;
        head.parentNode.classList.toggle('shut');
      });
    });
  }

  /* ------------------------------------------------------- tabs */
  function bindTabs() {
    $('dockTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.dockTab');
      if (b) tab(b.getAttribute('data-tab'));
    });
  }

  function tab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.dockTab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabPane'), function (p) {
      p.classList.toggle('on', p.getAttribute('data-pane') === name);
    });
    /* the histogram canvas has no size while its pane is display:none */
    if (name === 'stats') SM.emit('stats:shown');
    if (name === 'struct') SM.emit('struct:shown');
  }

  /**
   * Point the Properties dock at one thing.
   *
   * `kind` picks the section and the sub-title; `name` is whatever the tree
   * row said, so the header always echoes the row the operator clicked.
   */
  function showProps(kind, name) {
    var p = PROPS[kind] || PROPS.none;
    Array.prototype.forEach.call(document.querySelectorAll('#tabProps .propSection'), function (sec) {
      sec.classList.toggle('hidden', sec.id !== p.pane);
    });
    $('propName').textContent = name || (kind === 'none' ? 'No layer selected' : '');
    $('propKind').textContent = p.kind;
    $('propIcon').innerHTML = '<use href="#ic-' + p.icon + '"></use>';
  }

  /** bring the Properties tab forward — used when a click elsewhere implies it */
  function focusProps() { tab('props'); }

  /** radar-ui asks for this when a deformation scan lands */
  function revealScans() {
    tab('props');
    if (SM.Tree) SM.Tree.select('scan', null);
    else showProps('scan', 'Deformation scans');
  }

  /* ------------------------------------------------------- modals */
  function bindModals() {
    $('btnHelpClose').onclick = function () { $('helpModal').classList.add('hidden'); };
    $('btnCancelAscii').onclick = function () { $('asciiPanel').classList.add('hidden'); };
    /* click the scrim, or press Escape, to dismiss whichever is open */
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
      m.addEventListener('mousedown', function (e) { if (e.target === m) m.classList.add('hidden'); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = document.querySelector('.modal:not(.hidden)');
      if (open) { open.classList.add('hidden'); e.stopPropagation(); }
    }, true);
  }

  /* ------------------------------------------------- map furniture */
  /* Nice round numbers only — a scale bar reading "137 m" is worse than
     useless, because the eye cannot subdivide it. */
  var NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];

  function updateFurniture() {
    var V = SM.V;
    if (!V) return;
    var rose = document.getElementById('northRose');
    /* The camera's yaw is where it looks; north on screen turns the other way.
       The SVG transform ATTRIBUTE, whose `rotate(a cx cy)` carries its own
       pivot: it needs no transform-origin, no transform-box, and behaves the
       same in every engine. The one thing that can defeat it is an author
       stylesheet setting `transform` on the same element, because a
       presentation attribute loses to any CSS rule — so css/style.css must
       never do that, and tests/test_shell.js checks that it does not. */
    if (rose) rose.setAttribute('transform', 'rotate(' + (-V.cam.yaw).toFixed(1) + ' 20 20)');

    var ppm = V.pixelsPerMetre();
    var txt = $('scaleBarText');
    if (!ppm || !isFinite(ppm) || !S.grid) { txt.textContent = '—'; return; }
    var target = 120;                               // the bar's CSS width
    var want = target / ppm, pick = NICE[NICE.length - 1];
    for (var i = 0; i < NICE.length; i++) { if (NICE[i] >= want) { pick = NICE[i]; break; } }
    var px = pick * ppm;
    document.querySelector('.sbBar').style.width = Math.round(px) + 'px';
    txt.textContent = pick >= 1000 ? (pick / 1000) + ' km' : pick + ' m';
  }

  /* ------------------------------------------------------- layout */
  function layoutAll() {
    if (SM.V) SM.V.resize();
    SM.emit('layout');
  }

  function init() {
    bindGutters();
    bindPanels();
    bindTabs();
    bindModals();
    showProps('none');

    var paint = SM.throttle(updateFurniture, 60);
    SM.V.onDraw = paint;
    window.addEventListener('resize', function () { SM.V.resize(); SM.emit('layout'); });
  }

  return {
    init: init, tab: tab, showProps: showProps, focusProps: focusProps,
    toggleDock: toggleDock, revealScans: revealScans, updateFurniture: updateFurniture
  };
})();
