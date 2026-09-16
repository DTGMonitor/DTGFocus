/* ============================================================
   radar-trend.js — deformation against time at one place.

   A single scan answers "how much has this wall moved". A folder of scans
   answers "and is it getting worse", which is the question that actually
   decides whether anyone is allowed below it. This module turns the loaded
   scans of every wall folder watching one point or region into a single time
   series, and takes the three derivatives the crews read alongside it:

     deformation        mm        cumulative movement along the line of sight
     velocity           mm/h      its slope over a trailing rate window
     inverse velocity   h/mm      1 / |velocity| — the Fukuzono construction,
                                  whose descent toward zero is the collapse
                                  forecast
     acceleration       mm/h²     the slope of the velocity, so a rate that is
                                  merely high can be told from one that is
                                  running away

   Everything here is arithmetic on arrays: no DOM, no viewer, no globals
   beyond ScanLayer and Sens. That is deliberate — the failure forecast is the
   one number in this tool that people act on, so it is testable headlessly
   (tests/test_radar_trend.js) rather than only through a canvas.

   ── The one genuinely ambiguous thing ─────────────────────────────────────

   A radar CSV is named for a WINDOW, not an instant:

     SSR535_260808_HVM_HVK7_East_Wall-1_15082026_1838_16082026_0136
                                        └─ start ──┘ └─── end ───┘

   and the deformation in it is the movement accumulated across that window.
   How a folder of such files composes into one cumulative curve depends
   entirely on how the operator exported them, and the files cannot say which:

     shared    every file starts at the same reference instant and ends later
               than the last. Each file is ALREADY cumulative, so the value is
               plotted as it stands. This is what a "since commencement" export
               looks like.
     chained   the windows run end-to-start in sequence, each measuring only
               its own stretch of time. The cumulative curve is then the
               running SUM, and plotting the raw values would show a flat
               series while the wall walked away.

   Guessing wrong does not produce a slightly-off chart, it produces the wrong
   answer — so the rule is narrow and stated rather than clever: identical
   start stamps mean `shared`, anything else means `chained`, the caller can
   override, and whichever is used is reported back to be shown on screen.
   Gaps and overlaps between chained windows are reported too, because an
   overlap counts the same movement twice and a gap loses movement entirely.
   ============================================================ */
'use strict';

var RadarTrend = (function () {

  var HOUR = 3600e3;

  /* How far two chained windows may fail to meet before it is worth saying so,
     as a fraction of the median window length. Scan windows are written to the
     minute and exported by hand, so demanding they join exactly would warn on
     every real folder; a quarter of a window is where a missing scan starts to
     matter more than a rounded stamp. */
  var JOIN_TOL = 0.25;

  /* ---------------------------------------------- sampling

     Two ways to ask the same question, and they are not the same computation.

     A point is asked of the scan: `coverAt` walks the pixels in the sensor's
     own angular frame and returns the one looking at that spot, which is the
     same test the "wall folders here" panel uses — so the chart and the panel
     can never disagree about whether a scan watches a place.

     A region is asked of the pixels: every pixel already has a mine-grid
     position from the mesh, so the region is tested against those rather than
     re-asking coverAt per cell. That is one pass per scan instead of thousands,
     and it aggregates the pixels the radar actually returned rather than a
     resampling of them. */

  /**
   * One sample per scan that covers a mine-grid point.
   *
   * Scans that do not cover it are absent rather than zero — "the radar cannot
   * see this spot" and "the radar sees no movement here" are opposite answers
   * and a 0 mm would read as the second.
   */
  function samplePoint(recs, x, y, z, opts) {
    var out = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (!r.scan || !r.cidx) continue;
      var c = ScanLayer.coverAt(r.scan, r.cidx, x, y, z, opts);
      if (!c) continue;
      out.push(sample(r, c.def, 1, sightLine(r, x, y, z)));
    }
    return out;
  }

  /**
   * One sample per scan, summarising the pixels that fall inside the rings.
   *
   * `stat` picks what "the region moved" means, and the three are genuinely
   * different questions: `mean` is the block's behaviour, `median` is the same
   * question with a noisy pixel unable to shout, and `peak` is the worst pixel
   * in it — which is what a trigger level is usually written against.
   *
   * `n` comes back with every sample because the pixel count is the honest
   * health warning on this series: a region half outside one scan's footprint
   * produces a real number from a different piece of wall than the scan
   * before it, and the only visible symptom is n moving.
   */
  function sampleArea(recs, rings, opts) {
    opts = opts || {};
    var stat = opts.stat || 'mean';
    var out = [];

    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (!r.scan) continue;
      var pos = r.mesh && r.mesh.pos;
      if (!pos) continue;
      /* A pixel whose sight line never met the terrain kept its undraped
         position and is not drawn; including it would summarise a piece of
         wall the operator cannot see. */
      var alive = r.mesh.drape ? r.mesh.drape.alive : null;

      var vals = [], cx = 0, cy = 0, cz = 0;
      for (var k = 0; k < r.scan.n; k++) {
        if (alive && !alive[k]) continue;
        if (!inAny(rings, pos.x[k], pos.y[k])) continue;
        vals.push(r.scan.def[k]);
        cx += pos.x[k]; cy += pos.y[k]; cz += pos.z[k];
      }
      if (!vals.length) continue;
      var m = vals.length;
      out.push(sample(r, reduce(vals, stat), m,
        sightLine(r, cx / m, cy / m, cz / m)));
    }
    return out;
  }

  /**
   * The unit vector from this scan's sensor to the sampled ground, in the mine
   * grid.
   *
   * Carried on every sample because it is what makes joining two wall folders
   * either sound or a category error. A radar records movement ALONG its line
   * of sight, so two folders watching one spot from the same pad measure the
   * same component of the same movement and join cleanly, while two watching
   * it from opposite sides of the pit measure two different projections and
   * cannot be put on one scale at all. Nothing here decides which — it records
   * the geometry so `stitch` can say how far apart they are looking from.
   */
  function sightLine(rec, x, y, z) {
    var t = rec.cidx && rec.cidx.transform && rec.cidx.transform.t;
    if (!t) return null;
    var dx = x - t[0], dy = y - t[1], dz = z - t[2];
    var L = Math.hypot(dx, dy, dz);
    if (!(L > 0)) return null;
    return [dx / L, dy / L, dz / L];
  }

  /** Angle between two sight lines, in degrees; NaN when either is unknown. */
  function sightAngle(a, b) {
    if (!a || !b) return NaN;
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }

  /** The average direction a folder looked at this spot from, over its scans. */
  function meanSightLine(list) {
    var x = 0, y = 0, z = 0, n = 0;
    for (var i = 0; i < list.length; i++) {
      var u = list[i].los;
      if (!u) continue;
      x += u[0]; y += u[1]; z += u[2]; n++;
    }
    if (!n) return null;
    var L = Math.hypot(x, y, z);
    return L > 0 ? [x / L, y / L, z / L] : null;
  }

  function inAny(rings, x, y) {
    for (var i = 0; i < rings.length; i++) {
      if (Sens.pointInPoly(rings[i], x, y)) return true;
    }
    return false;
  }

  /** mean, median, or the largest movement in either direction, signed. */
  function reduce(vals, stat) {
    var i;
    if (stat === 'peak') {
      var best = vals[0];
      for (i = 1; i < vals.length; i++) {
        if (Math.abs(vals[i]) > Math.abs(best)) best = vals[i];
      }
      return best;
    }
    if (stat === 'median') {
      var s = vals.slice().sort(function (a, b) { return a - b; });
      var m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    var sum = 0;
    for (i = 0; i < vals.length; i++) sum += vals[i];
    return sum / vals.length;
  }

  function sample(rec, def, n, los) {
    var m = rec.scan.meta;
    return {
      id: rec.id, key: rec.key || (m && m.key) || null,
      filename: m && m.filename,
      startAt: m && m.startAt ? +m.startAt : null,
      endAt: m && m.endAt ? +m.endAt : null,
      def: def, n: n, los: los || null
    };
  }

  /* ---------------------------------------------- composition */

  /** `shared` only when every window opens at the same instant. */
  function detectMode(samples) {
    if (samples.length < 2) return 'shared';
    var t0 = samples[0].startAt;
    for (var i = 1; i < samples.length; i++) {
      if (samples[i].startAt !== t0) return 'chained';
    }
    return 'shared';
  }

  /**
   * Samples -> a cumulative curve, plus whatever is wrong with it.
   *
   * Both modes plant an explicit zero at the first window's start. It is not a
   * measurement, it is the definition of the reference — and without it a
   * two-scan folder would draw a line with no origin, from which no velocity
   * could be taken at all.
   */
  function cumulate(samples, mode) {
    var warn = [];
    var s = samples.slice().sort(function (a, b) {
      return (a.startAt - b.startAt) || (a.endAt - b.endAt);
    });

    var pts = [{ t: s[0].startAt, d: 0, sample: null }];

    if (mode === 'shared') {
      var byEnd = s.slice().sort(function (a, b) { return a.endAt - b.endAt; });
      for (var i = 0; i < byEnd.length; i++) {
        pts.push({ t: byEnd[i].endAt, d: byEnd[i].def, sample: byEnd[i] });
      }
      return { points: pts, warnings: warn };
    }

    /* Chained. The median window is the yardstick for "do these join": scan
       windows vary in length and an absolute tolerance in minutes would be
       either meaningless on a week-long window or deafening on an hourly one. */
    var med = medianSpan(s);
    var run = 0, prevEnd = null, gaps = 0, laps = 0;

    for (var j = 0; j < s.length; j++) {
      if (prevEnd !== null) {
        var slip = s[j].startAt - prevEnd;
        if (slip > med * JOIN_TOL) gaps++;
        else if (slip < -med * JOIN_TOL) laps++;
      }
      run += s[j].def;
      pts.push({ t: s[j].endAt, d: run, sample: s[j] });
      prevEnd = s[j].endAt;
    }

    if (gaps) {
      warn.push(gaps + (gaps === 1 ? ' gap' : ' gaps') + ' between windows — ' +
        'movement during the missing time is not in this curve.');
    }
    if (laps) {
      warn.push(laps + (laps === 1 ? ' window overlaps' : ' windows overlap') +
        ' the one before it — the shared stretch is counted twice, so the ' +
        'curve reads high. Re-export the windows end to start, or plot a ' +
        'folder whose scans share one reference.');
    }
    return { points: pts, warnings: warn };
  }

  function medianSpan(s) {
    var spans = [];
    for (var i = 0; i < s.length; i++) {
      var d = s[i].endAt - s[i].startAt;
      if (d > 0) spans.push(d);
    }
    if (!spans.length) return HOUR;
    spans.sort(function (a, b) { return a - b; });
    return spans[spans.length >> 1];
  }

  /* ---------------------------------------------- derivatives */

  /** Linear interpolation over a series of {t, <field>}, clamped at both ends. */
  function valueAt(series, field, t) {
    if (!series.length) return NaN;
    if (t <= series[0].t) return series[0][field];
    var last = series.length - 1;
    if (t >= series[last].t) return series[last][field];
    for (var i = 1; i <= last; i++) {
      if (series[i].t < t) continue;
      var a = series[i - 1], b = series[i];
      var f = (t - a.t) / (b.t - a.t);
      return a[field] + f * (b[field] - a[field]);
    }
    return series[last][field];
  }

  /**
   * Velocity, inverse velocity and acceleration onto the cumulative points.
   *
   * The rate window is a trailing one: the value at a sample is taken against
   * where the curve was `windowHours` earlier, interpolating if no scan landed
   * exactly there. Smoothing matters more here than anywhere else in the tool
   * — a point-to-point rate between two scans an hour apart is dominated by
   * the radar's own noise, and inverse velocity then swings through decades
   * for reasons that have nothing to do with the wall.
   *
   * The window never shortens the interval below the one between neighbouring
   * samples, so asking for a window finer than the scans themselves degrades
   * to point-to-point instead of dividing by nearly zero.
   */
  function derive(pts, windowHours) {
    var win = windowHours > 0 ? windowHours * HOUR : 0;
    var first = pts[0].t;
    var i, back;

    /* Every point carries all three fields whether or not one could be worked
       out, so "is there a value here" is one test — `v === v` — everywhere
       downstream. A missing field and a NaN field read differently in
       JavaScript, and the chart would draw a line through the difference. */
    for (i = 0; i < pts.length; i++) { pts[i].v = NaN; pts[i].iv = NaN; pts[i].a = NaN; }

    for (i = 1; i < pts.length; i++) {
      back = win ? Math.min(pts[i - 1].t, pts[i].t - win) : pts[i - 1].t;
      if (back < first) back = first;
      var dt = (pts[i].t - back) / HOUR;
      if (!(dt > 0)) continue;
      pts[i].v = (pts[i].d - valueAt(pts, 'd', back)) / dt;
      pts[i].vFrom = back;
    }

    /* Inverse velocity is about the MAGNITUDE of the movement: a wall that
       relaxes back a little between two advances has a signed velocity that
       crosses zero, and a signed reciprocal would fling the curve to both
       infinities on either side of it. */
    for (i = 1; i < pts.length; i++) {
      var v = pts[i].v;
      pts[i].iv = (v === v && v !== 0) ? 1 / Math.abs(v) : NaN;
    }

    /* Acceleration is taken from the SMOOTHED velocity over the same window,
       not from the raw curve twice — differencing raw samples twice squares
       the noise and the result is unreadable at any real scan interval. */
    var vs = [];
    for (i = 0; i < pts.length; i++) if (pts[i].v === pts[i].v) vs.push(pts[i]);
    if (vs.length >= 2) {
      for (i = 1; i < vs.length; i++) {
        back = win ? Math.min(vs[i - 1].t, vs[i].t - win) : vs[i - 1].t;
        if (back < vs[0].t) back = vs[0].t;
        var da = (vs[i].t - back) / HOUR;
        if (!(da > 0)) continue;
        vs[i].a = (vs[i].v - valueAt(vs, 'v', back)) / da;
      }
    }
    return pts;
  }

  /* ---------------------------------------------- joining wall folders

     A wall outlives the folder that watches it. The radar is moved for a cut,
     re-set up on a new pad, or the folder is simply re-commenced after a
     re-survey — and each time a NEW wall folder starts counting from a new
     zero. Plotting them separately makes the operator do the arithmetic that
     matters most, in their head, across two charts.

     So the folders are joined. The one thing that must not happen while doing
     it is adding their values: each folder's deformation is measured from its
     own reference instant, so a second folder's "−4 mm" means four millimetres
     since IT started, not since the wall was first watched. What carries across
     a join is the SHAPE — the increments — and the running curve supplies the
     level.

     Concretely, each later folder is offset so that it continues the curve
     already built rather than restarting it:

       where they overlap in time   the offset is the mean difference between
                                    the running curve and the newcomer across
                                    the overlap. Averaging rather than taking
                                    one instant is what stops a single noisy
                                    scan at the handover shifting the whole
                                    rest of the record.
       where they do not            the curve is held level to the newcomer's
                                    own start. Movement in that gap was not
                                    measured by anything, and is reported as
                                    missing rather than invented.

     What this cannot fix is geometry. A radar measures movement along its line
     of sight, so two folders looking at a spot from different places measure
     different components of the same motion and have no common scale. That is
     not visible in the numbers, only in the sensor positions — which is why
     every sample carries its sight line, and why an angle between two joined
     folders is reported rather than quietly absorbed into an offset. */

  /* Above this, two folders are not really looking from the same place any
     more. A radar re-set up on its own pad lands within a degree or two; ten
     degrees is past anything a re-levelling explains, and is where the two
     records stop being two halves of one measurement. */
  var LOS_TOL_DEG = 10;

  /**
   * Per-folder curves -> one continuous curve.
   *
   * @param groups [{ key, points, los }] each already cumulated in its own frame
   * @returns { points, joins, warnings }
   */
  function stitch(groups) {
    var warnings = [], joins = [], i, j;

    var live = [];
    for (i = 0; i < groups.length; i++) if (groups[i].points.length) live.push(groups[i]);
    if (!live.length) return { points: [], joins: [], warnings: warnings };

    live.sort(function (a, b) { return a.points[0].t - b.points[0].t; });

    var out = [], head = live[0], swallowed = [];
    for (i = 0; i < head.points.length; i++) out.push(carry(head.points[i], head.key, 0));

    for (var k = 1; k < live.length; k++) {
      var G = live[k], tail = out[out.length - 1];
      var future = [], overlap = [];

      for (j = 0; j < G.points.length; j++) {
        if (G.points[j].t > tail.t) future.push(G.points[j]);
        else if (G.points[j].t >= out[0].t) overlap.push(G.points[j]);
      }

      /* Wholly inside what is already plotted. Dropping it is right — the
         curve loses nothing — but silently dropping a folder the operator can
         see in the tree is not, so it is collected and named below. */
      if (!future.length) { swallowed.push(G.key); continue; }

      var off, bridged = false, gapH = 0;
      if (overlap.length) {
        var sum = 0;
        for (j = 0; j < overlap.length; j++) {
          sum += valueAt(out, 'd', overlap[j].t) - overlap[j].d;
        }
        off = sum / overlap.length;
      } else {
        /* Nothing watched this spot between the two records. Holding the last
           known level is the only honest continuation: any slope drawn across
           that gap would be a number no radar produced. */
        off = tail.d;
        bridged = true;
        gapH = (future[0].t - tail.t) / HOUR;
      }

      joins.push({
        t: future[0].t, from: tail.key, to: G.key, offset: off,
        bridged: bridged, gapHours: gapH, overlap: overlap.length,
        angleDeg: sightAngle(head.los, G.los)
      });

      for (j = 0; j < future.length; j++) out.push(carry(future[j], G.key, off));
      head = G;
    }

    return { points: out, joins: joins, warnings: warnings.concat(joinNotes(joins, swallowed)) };
  }

  /**
   * What is wrong with a set of joins, said once rather than once per join.
   *
   * A wall watched across a year can carry a dozen handovers, and a line of
   * prose for each buries the chart it is supposed to annotate — which is a
   * failure of the warning, not of the reader. So one or two get the specific
   * sentence, and a run of them gets counted and totalled instead. The
   * per-join detail is never lost: it is on `joins`, and the caller lists it.
   */
  function joinNotes(joins, swallowed) {
    var out = [], i;

    if (swallowed.length === 1) {
      out.push('The record of ' + swallowed[0] + ' lies entirely inside what is ' +
        'already joined here, so it adds nothing to the curve and was left out.');
    } else if (swallowed.length > 1) {
      out.push(swallowed.length + ' wall folders lie entirely inside the records ' +
        'around them, so they add nothing to the curve and were left out: ' +
        swallowed.join(', ') + '.');
    }

    var gaps = [], wide = [], worst = 0, total = 0;
    for (i = 0; i < joins.length; i++) {
      if (joins[i].bridged) { gaps.push(joins[i]); total += joins[i].gapHours; }
      if (joins[i].angleDeg > LOS_TOL_DEG) {
        wide.push(joins[i]);
        if (joins[i].angleDeg > worst) worst = joins[i].angleDeg;
      }
    }

    if (gaps.length === 1) {
      out.push('Nothing covers this spot for the ' + Math.round(gaps[0].gapHours) +
        ' h between ' + gaps[0].from + ' and ' + gaps[0].to + ' — the curve is ' +
        'held level across the gap, and any movement in it is missing from every ' +
        'figure here.');
    } else if (gaps.length > 1) {
      out.push(gaps.length + ' of the ' + joins.length + ' joins cross a stretch ' +
        'nothing was watching, ' + Math.round(total) + ' h in total. The curve is ' +
        'held level across each, so any movement in them is missing from every ' +
        'figure here.');
    }

    if (wide.length === 1) {
      out.push(wide[0].from + ' and ' + wide[0].to + ' look at this spot from ' +
        Math.round(wide[0].angleDeg) + '° apart, so they measure different ' +
        'components of the same movement. They are joined by shape, not on a ' +
        'common scale — read the two stretches as two records rather than one number.');
    } else if (wide.length > 1) {
      out.push(wide.length + ' of the ' + joins.length + ' joins put two folders ' +
        'more than ' + LOS_TOL_DEG + '° apart, up to ' + Math.round(worst) + '°. ' +
        'Those folders measure different components of the same movement, so the ' +
        'curve across them is joined by shape and is not one number on one scale. ' +
        'Read it as a sequence of records, and use the folder control to take any ' +
        'one of them on its own.');
    }

    return out;
  }

  /* A copy, never the original: `derive` writes the rates onto whatever it is
     given, and a folder's own curve must survive being joined into several. */
  function carry(p, key, off) {
    return { t: p.t, d: p.d + off, sample: p.sample, key: key };
  }

  /* ---------------------------------------------- the whole thing */

  /**
   * Samples -> a plottable series, across as many wall folders as they came from.
   *
   * @param samples from samplePoint / sampleArea, tagged with their folder key
   * @param opts    { mode:'auto'|'shared'|'chained', windowHours }
   * @returns { ok, points, samples, folders, joins, mode, autoMode, warnings,
   *            span, windowHours }
   */
  function build(samples, opts) {
    opts = opts || {};
    var warnings = [], i;

    /* A scan whose filename carried no window has no place on a time axis. It
       is still drawn on the terrain, so say how many were left out rather than
       letting the chart quietly describe a subset. */
    var dated = [], undated = 0;
    for (i = 0; i < samples.length; i++) {
      if (samples[i].startAt && samples[i].endAt &&
          samples[i].endAt > samples[i].startAt) dated.push(samples[i]);
      else undated++;
    }
    if (undated) {
      warnings.push(undated + (undated === 1 ? ' scan carries' : ' scans carry') +
        ' no readable scan window and cannot be placed on the time axis.');
    }
    if (!dated.length) {
      return { ok: false, points: [], samples: [], folders: [], joins: [],
        mode: null, warnings: warnings };
    }

    /* Every folder is composed in its OWN frame first — the shared/chained
       question is asked once per folder, because two folders exported by two
       people on two days need not have been exported the same way. */
    var byKey = Object.create(null), order = [];
    for (i = 0; i < dated.length; i++) {
      var k = dated[i].key || '';
      if (!byKey[k]) { byKey[k] = []; order.push(k); }
      byKey[k].push(dated[i]);
    }

    var groups = [];
    for (i = 0; i < order.length; i++) {
      var list = byKey[order[i]];
      var auto = detectMode(list);
      var mode = (opts.mode && opts.mode !== 'auto') ? opts.mode : auto;
      var c = cumulate(list, mode);
      groups.push({
        key: order[i], samples: list, points: c.points,
        mode: mode, autoMode: auto, forced: mode !== auto,
        los: meanSightLine(list), warnings: c.warnings,
        span: { t0: c.points[0].t, t1: c.points[c.points.length - 1].t }
      });
    }

    /* Record order, not the order the scans happened to be filed in: every
       reader of `folders` — the note, the header, the export — means "first
       record" by folders[0], and the warnings should read the same way. */
    groups.sort(function (a, b) { return a.points[0].t - b.points[0].t; });

    var many = groups.length > 1;
    var perFolder = [];
    for (i = 0; i < groups.length; i++) {
      for (var w = 0; w < groups[i].warnings.length; w++) {
        perFolder.push({ key: groups[i].key, text: groups[i].warnings[w] });
      }
      /* Asked per folder, because two folders legitimately cover different
         parts of a region — it is one folder's own count moving between its
         own scans that means the curve is comparing different ground. */
      var cov = coverageSpread(groups[i].samples);
      if (cov > 0.35) {
        perFolder.push({ key: groups[i].key,
          text: 'the number of pixels summarised changes by ' + Math.round(cov * 100) +
            '% between scans — parts of this region fall outside some of them, ' +
            'so the curve compares different ground.' });
      }
    }
    warnings = warnings.concat(gather(perFolder, many));

    var joined = stitch(groups);
    var pts = derive(joined.points, opts.windowHours);
    warnings = warnings.concat(joined.warnings);

    /* The top-level mode describes the whole curve, so it can only name one
       rule when every folder was read the same way. */
    var mode0 = groups[0].mode, auto0 = groups[0].autoMode, mixed = false;
    for (i = 1; i < groups.length; i++) if (groups[i].mode !== mode0) mixed = true;

    return {
      ok: pts.length >= 2,
      points: pts,
      samples: dated,
      folders: groups,
      joins: joined.joins,
      mode: mixed ? 'mixed' : mode0,
      autoMode: mixed ? 'mixed' : auto0,
      forced: !!(opts.mode && opts.mode !== 'auto') && mode0 !== auto0,
      warnings: warnings,
      windowHours: opts.windowHours > 0 ? opts.windowHours : 0,
      span: { t0: pts[0].t, t1: pts[pts.length - 1].t }
    };
  }

  /**
   * Per-folder complaints, collapsed by what they say.
   *
   * Fourteen folders each reporting "1 gap between windows" is fourteen lines
   * carrying one fact, and a note that long stops being read at all — which
   * costs more than the detail it spent. Identical texts are therefore counted
   * and the folders listed behind the count; a single folder keeps its own
   * sentence, unprefixed, because there is nothing to tell it apart from.
   */
  function gather(items, many) {
    var byText = Object.create(null), order = [], out = [], i;
    for (i = 0; i < items.length; i++) {
      var t = items[i].text;
      if (!byText[t]) { byText[t] = []; order.push(t); }
      byText[t].push(items[i].key);
    }
    for (i = 0; i < order.length; i++) {
      var keys = byText[order[i]], text = order[i];
      if (!many) out.push(text.charAt(0).toUpperCase() + text.slice(1));
      else if (keys.length === 1) out.push(keys[0] + ': ' + text);
      else out.push(keys.length + ' wall folders report the same: ' + text +
        ' (' + keys.join(', ') + ')');
    }
    return out;
  }

  /** Spread of the per-sample pixel counts, as a fraction of the median. */
  function coverageSpread(samples) {
    var ns = [];
    for (var i = 0; i < samples.length; i++) if (samples[i].n > 0) ns.push(samples[i].n);
    if (ns.length < 2) return 0;
    ns.sort(function (a, b) { return a - b; });
    var med = ns[ns.length >> 1];
    if (!med) return 0;
    return (ns[ns.length - 1] - ns[0]) / med;
  }

  /* ---------------------------------------------- axis help

     Inverse velocity has no upper bound: a wall that pauses between two scans
     puts a value thousands of times the rest of the series into it, and an
     axis fitted to the maximum flattens the descent the whole construction
     exists to show. So the axis is fitted to a percentile and the outliers are
     allowed to run off the top, where they are still visibly off the top.
   */

  /**
   * A drawing range over `field`, ignoring the wildest tail.
   * @param pct fraction of the values to keep at each end (0 = plain min/max)
   */
  function range(pts, field, pct) {
    var v = [];
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][field];
      if (x === x && isFinite(x)) v.push(x);
    }
    if (!v.length) return null;
    v.sort(function (a, b) { return a - b; });
    var k = pct > 0 ? Math.floor(v.length * pct) : 0;
    var lo = v[Math.min(k, v.length - 1)];
    var hi = v[Math.max(v.length - 1 - k, 0)];
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
    return { min: lo, max: hi, trueMin: v[0], trueMax: v[v.length - 1], n: v.length };
  }

  return {
    samplePoint: samplePoint, sampleArea: sampleArea,
    build: build, stitch: stitch, detectMode: detectMode, cumulate: cumulate,
    derive: derive, valueAt: valueAt, range: range, reduce: reduce,
    sightAngle: sightAngle, meanSightLine: meanSightLine,
    HOUR: HOUR, LOS_TOL_DEG: LOS_TOL_DEG
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RadarTrend;
