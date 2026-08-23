/* ============================================================
   ui.js — bootstrap.

   Creates the viewer, starts every UI module in dependency order, and
   publishes the small surface that optional add-ons (radar-ui.js) attach to.
   The panels themselves live in js/ui/*.js.
   ============================================================ */
'use strict';

(function () {

  var $ = SM.$, S = SM.S, EXT = SM.EXT;

  function init() {
    try {
      SM.V = new Viewer($('glcanvas'));
    } catch (e) {
      alert('WebGL error: ' + e.message);
      return;
    }
    /* the event goes through as well as the hit: tools that aim at overlay
       handles have to pick in screen space, where the handles actually are */
    SM.V.onClick = function (hit, ev) { SM.Tools.onCanvasClick(hit, ev); };
    SM.V.onHover = SM.throttle(function (ev) {
      SM.Probe.hover(ev);
      /* the stretch tool needs the pointer, not just the clicks — it only
         raycasts a second time while it is actually armed */
      SM.Edit.hover(ev);
    }, 40);

    /* shell first: the docks and the Properties router everything else fills */
    SM.Shell.init();
    SM.Cmd.build();

    SM.Symbology.init();
    SM.Data.init();
    SM.Sensors.init();
    SM.Model.init();
    SM.AOI.init();
    SM.Structure.init();
    SM.Measure.init();
    SM.Edit.init();
    SM.Clip.init();
    SM.Stats.init();
    SM.IO.init();
    SM.Tree.init();
    SM.Tools.init();

    SM.Cmd.refresh();
    SM.status('Ready — add terrain data, or load the demo open pit.');
    SM.setHud('No model loaded', 'Drop a .dtm / .dxf / .xyz file anywhere on this window');
    SM.Shell.updateFurniture();

    /* the two canvases that cache theme colours have to be repainted when a
       host build swaps the palette under us */
    window.addEventListener('platformtheme', function () {
      SM.Symbology.updateLegend(); SM.Stats.layoutHist(); SM.Structure.redraw();
    });
  }

  /* ---------------------------------------------------- add-on surface

     Everything an add-on module is allowed to reach. Deliberately functions
     rather than live references, because the viewer and grid are replaced
     wholesale when a new survey is loaded. */
  window.SensiMap = {
    viewer: function () { return SM.V; },
    /* "Is there a surface to click on?" The viewer's grid is the honest answer,
       because that is the thing pickAt actually raycasts — S.grid is the UI's
       copy of the same raster and is only consulted as a fallback. */
    grid: function () { return (SM.V && SM.V.grid) || S.grid || null; },
    status: SM.status,
    redraw: function () { if (SM.V) SM.V.draw(); },

    /* Bring the deformation panel forward — the add-on calls this when a scan
       lands, so the operator is looking at the thing that just changed. */
    revealScans: function () { SM.Shell.revealScans(); },
    /* Redraw the layer tree after the add-on's own folder list changed. */
    refreshTree: function () { if (SM.Tree) SM.Tree.refresh(); },

    /* Take exclusive ownership of canvas clicks until released. `onCancel`
       fires if the user presses Escape, so the add-on can unwind its own
       half-finished state instead of being left mid-workflow. */
    claimPick: function (fn, message, onCancel) {
      SM.Tools.set('identify');
      EXT.pick = fn; EXT.cancel = onCancel || null;
      var b = $('pickBanner');
      b.classList.remove('hidden');
      b.textContent = message || 'Click on the model  (Esc to cancel)';
    },
    setPickMessage: function (message) {
      var b = $('pickBanner');
      if (!b.classList.contains('hidden')) b.textContent = message;
    },
    releasePick: function () { SM.Tools.extRelease(); },

    /* Observe ordinary probe clicks — the ones that are not placing anything. */
    onProbe: function (fn) { EXT.probe.push(fn); }
  };

  /* ---------------------------------------------------- start */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
