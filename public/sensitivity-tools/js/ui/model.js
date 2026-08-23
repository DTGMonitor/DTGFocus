/* ============================================================
   ui/model.js — the sensitivity model: the movement-vector choice, the
   line-of-sight options, and running the computation.
   ============================================================ */
'use strict';

SM.Model = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, numOr = SM.numOr, TERRAIN = SM.TERRAIN_LAYERS;

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name=smode]'), function (el) {
      el.onchange = function () {
        $('customVec').style.display = (mode() === 'custom') ? '' : 'none';
        invalidate();
      };
    });
    $('customVec').style.display = 'none';
    syncCustomForm();
    $('chkCustRel').onchange = function () { syncCustomForm(); invalidate(); };
    ['inpCustAz', 'inpCustPl', 'inpCustOff', 'chkOcclusion', 'selOccAcc', 'inpOccTol',
      'chkGrazing', 'inpGraz'].forEach(function (id) { $(id).onchange = invalidate; });

    $('inpThresh').onchange = function () {
      if (S.res) { restat(); SM.Symbology.colorize(); SM.Symbology.updateLegend(); }
    };
    $('inpTrue').onchange = function () {
      if (S.layer === 'mmres') { SM.Symbology.autoRange(false); SM.Symbology.syncForm(); }
      SM.Symbology.colorize(); SM.Symbology.updateLegend();
    };
    $('chkMaskBelow').onchange = function () { SM.Symbology.colorize(); };
  }

  function mode() {
    var el = document.querySelector('input[name=smode]:checked');
    return el ? el.value : 'steepest';
  }
  /** typed trend+plunge, or the per-cell offset from the steepest line */
  function custRel() { return $('chkCustRel').checked; }
  function syncCustomForm() {
    $('customAbs').classList.toggle('hidden', custRel());
    $('customOff').classList.toggle('hidden', !custRel());
  }

  /** a setting changed after a compute — say so rather than showing a stale map */
  function invalidate() {
    if (!S.res) return;
    SM.badge('recompute needed', 'busy');
    SM.status('Settings changed — press “Compute sensitivity map”.');
  }

  function computeOpts() {
    var active = S.radars.filter(function (r) { return r.on !== false; });
    var selIdx = Math.max(0, active.indexOf(S.radars[S.sel]));
    var cmb = $('selCombine').value;
    return {
      mode: mode(),
      custAz: parseFloat($('inpCustAz').value) || 0,
      custPl: parseFloat($('inpCustPl').value) || 0,
      custRel: custRel(),
      custOff: numOr('inpCustOff', 0),
      occlusion: $('chkOcclusion').checked,
      occStep: parseFloat($('selOccAcc').value) || 1,
      occTol: parseFloat($('inpOccTol').value) || 0,
      grazing: $('chkGrazing').checked,
      grazMax: parseFloat($('inpGraz').value) || 85,
      threshold: parseFloat($('inpThresh').value) || 0,
      combine: cmb === 'which' ? 'max' : cmb,
      selectedIndex: selIdx,
      mask: S.mask,
      /* structural domains override `mode` inside their own polygons — passed
         with their resolved cell index so the compute does not repeat the
         point-in-polygon pass the panel has already done */
      domains: S.domains,
      domIdx: S.domIdx,
      trueDispl: parseFloat($('inpTrue').value) || 10
    };
  }

  function recompute() {
    if (!S.grid) { SM.status('Load a model first.'); return; }
    if (S.busy) return;
    S.busy = true;
    SM.badge('computing…', 'busy');
    $('progWrap').classList.remove('hidden');
    SM.AOI.recomputeMask();
    SM.Structure.recomputeIndex();
    var opts = computeOpts();
    var t0 = performance.now();
    Sens.compute(S.grid, S.der, S.radars, opts, function (f, nm) {
      $('progBar').style.width = (f * 100).toFixed(1) + '%';
      $('progText').textContent = (f * 100).toFixed(0) + '%  ' + (nm || '');
    }).then(function (res) {
      S.res = res;
      S.res.opts = opts;
      var ms = (performance.now() - t0).toFixed(0);
      $('progWrap').classList.add('hidden');
      S.busy = false;
      /* a terrain layer was all there was to show before; now there is a result */
      if (TERRAIN[S.layer]) { S.layer = 'sens'; SM.Symbology.syncForm(); }
      SM.Symbology.autoRange(false);
      SM.Symbology.colorize();
      SM.Overlays.update();
      SM.Stats.update(); SM.Stats.updateRank();
      SM.Tree.refresh(); SM.Cmd.refresh();
      var nDom = res.domains ? res.domains.length : 0;
      SM.badge('sensitivity ' + opts.mode + (nDom ? ' +' + nDom + ' domain' + (nDom === 1 ? '' : 's') : ''), 'on');
      var st = res.stats;
      SM.status('Computed in ' + ms + ' ms — mean sensitivity ' + fmt(st.mean, 3) +
        ', usable area ' + (100 * st.usable).toFixed(1) + '%');
      SM.setHud('Sensitivity · ' + opts.mode.toUpperCase() +
        (nDom ? ' + ' + nDom + ' structural domain' + (nDom === 1 ? '' : 's') : ''),
        S.radars.filter(function (r) { return r.on !== false; }).length + ' sensor(s) · ' +
        (opts.occlusion ? 'shadow test on' : 'shadow test off') +
        ' · threshold ' + fmt(opts.threshold, 2));
      SM.emit('compute:done');
    }).catch(function (e) {
      S.busy = false;
      $('progWrap').classList.add('hidden');
      SM.badge('error', 'busy');
      SM.status('Compute failed: ' + e.message);
      console.error(e);
    });
  }

  /** re-summarise an existing result against a new threshold or mask */
  function restat() {
    if (!S.res) return;
    var thr = parseFloat($('inpThresh').value) || 0;
    S.res.opts.threshold = thr;
    S.res.perRadar.forEach(function (P) { P.stats = Sens.summarise(P, S.mask, thr, S.grid); });
    S.res.stats = Sens.summarise(S.res.combined, S.mask, thr, S.grid);
    SM.Stats.update(); SM.Stats.updateRank(); SM.Tree.refresh();
  }

  return {
    init: init, mode: mode, custRel: custRel, syncCustomForm: syncCustomForm,
    invalidate: invalidate, computeOpts: computeOpts, recompute: recompute, restat: restat
  };
})();
