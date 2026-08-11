'use client';

/**
 * The Tabulation report's generator running-time strip.
 *
 * Seven days of minutes, latest on the left, keyed to the DAY the generator ran
 * rather than to a position in the strip. That is the whole design: the analyst
 * fills one cell each morning, and the next morning the window has moved so the
 * same stored figure is simply one column further right. Nothing is shifted,
 * re-keyed or re-typed — see utils/generatorRuntime.ts.
 *
 * Reads and writes are per CELL. A report edition is composed over minutes, not
 * submitted, and there is no "save" on the page: a figure is committed when the
 * analyst leaves the field, so closing the modal cannot lose it.
 *
 * Never throws. A failed load leaves the strip empty and typeable; a failed
 * write leaves the typed value on screen and says so, because silently dropping
 * a number the analyst watched themselves enter is worse than an error.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  generatorDays,
  generatorLabel,
  parseMinutes,
  minutesText,
} from '@/utils/generatorRuntime';

/**
 * @param {number|string} radarId  `sensor.id` — the radar, not the wall folder.
 *   A re-aimed radar keeps its generator, so the history must not be scoped to
 *   the folder it happens to be scanning.
 * @param {string} reportDay  'YYYY-MM-DD' on the SITE's calendar.
 * @param {boolean} enabled
 */
export function useGeneratorRuntime(radarId, reportDay, enabled = true) {
  const days = useMemo(() => generatorDays(reportDay), [reportDay]);

  // date → the cell's text, as typed. Kept as strings, not numbers: '' is a
  // state a number cannot hold, and it is the state a cell is in while the
  // analyst is clearing it.
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);

  const active = Boolean(enabled && radarId && days.length);
  const windowKey = days.join('|');

  useEffect(() => {
    if (!active) {
      setValues({});
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from('generator_runtime')
        .select('run_date, minutes')
        .eq('radar_id', radarId)
        .in('run_date', days);

      if (cancelled) return;
      if (err) {
        console.warn('[Daily report] generator running time failed to load:', err);
        setError('Could not load the generator running time.');
        return;
      }

      // Merged INTO whatever is on screen rather than replacing it: the load
      // re-runs when the report date changes, and a cell the analyst has already
      // typed into must not be blanked by a fetch that knows nothing about it.
      const stored = {};
      (data ?? []).forEach((row) => {
        stored[String(row.run_date).slice(0, 10)] = minutesText(row.minutes);
      });
      setError(null);
      setValues((prev) => ({ ...stored, ...prev }));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, radarId, windowKey]);

  const onChange = useCallback((date, value) => {
    setValues((prev) => ({ ...prev, [date]: value }));
  }, []);

  /**
   * Store one day's figure.
   *
   * A cleared cell DELETES the row instead of writing 0. Zero is a reading in
   * its own right — the generator did not run — and the report says so; a day
   * nobody has answered yet must stay distinguishable from one that answered
   * zero.
   *
   * The typed text is normalised back into the field from the parsed value, so
   * "620abc" and "  620 " both settle as the 620 that was actually stored and
   * the strip never shows a number the database does not hold.
   */
  const onCommit = useCallback(
    async (date) => {
      if (!radarId || !date) return;

      const minutes = parseMinutes(values[date]);
      setValues((prev) => ({ ...prev, [date]: minutesText(minutes) }));

      const { error: err } =
        minutes === null
          ? await supabase
              .from('generator_runtime')
              .delete()
              .eq('radar_id', radarId)
              .eq('run_date', date)
          : await supabase
              .from('generator_runtime')
              .upsert({ radar_id: radarId, run_date: date, minutes }, { onConflict: 'radar_id,run_date' });

      if (err) {
        console.warn('[Daily report] generator running time failed to save:', err);
        setError('Could not save the generator running time.');
        return;
      }
      setError(null);
    },
    [radarId, values]
  );

  /**
   * What the template renders: one entry per column, left (yesterday) to right.
   * The strip is built from `days`, not from what was stored, so a day with no
   * row is a blank column rather than a missing one.
   */
  const columns = useMemo(
    () => days.map((date) => ({ date, label: generatorLabel(date), value: values[date] ?? '' })),
    [days, values]
  );

  return { columns, onChange, onCommit, error };
}

export default useGeneratorRuntime;
