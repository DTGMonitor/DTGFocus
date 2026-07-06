import fc from 'fast-check';

// The hook module instantiates a Supabase browser client at import time; stub it
// so these pure-logic tests do not require live credentials.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import {
  mergeSites,
  applyOptimisticPatch,
  SiteReportStatus,
} from '../useReportSchedules';
import { defaultReminderFor, SiteSchedule } from '../scheduleUtils';
import { RADAR_TYPE, BULLETIN_TYPES, defaultScheduleFor } from '../reportTypes';

const RUNS = 100;

// A registry row (radar wall) with valid site_id + radar_number.
const validRowArb = fc.record({
  site_id: fc.integer({ min: 0, max: 8 }).map(String),
  radar_number: fc.integer({ min: 0, max: 8 }).map((n) => `R${n}`),
  type: fc.constant<string | undefined>(undefined),
});

const maybeArchiveRowArb = fc.record({
  site_id: fc.integer({ min: 0, max: 8 }).map(String),
  radar_number: fc.integer({ min: 0, max: 8 }).map((n) => `R${n}`),
  type: fc.oneof(fc.constant<string | undefined>(undefined), fc.constant('Archive')),
});

const timeArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

const siteStatusArb = fc.record({
  id: fc.integer({ min: 0, max: 20 }).map(String),
  name: fc.string(),
  schedule: fc.record({
    deadline: timeArb,
    reminder: timeArb,
    enabled: fc.boolean(),
  }),
});

function buildSite(s: {
  id: string;
  name: string;
  schedule: SiteSchedule;
}): SiteReportStatus {
  return {
    id: s.id,
    name: s.name,
    hasRadar: true,
    sensorCount: 0,
    sensors: [],
    pendingSensors: [],
    generatedToday: true,
    schedule: s.schedule,
    bulletins: BULLETIN_TYPES.map((def) => ({
      type: def.key,
      label: def.label,
      cadence: def.cadence,
      schedule: defaultScheduleFor(def),
      generatedInPeriod: false,
    })),
    saving: false,
    saveError: null,
  };
}

// Feature: scalable-report-scheduler, Property 1: Default radar schedule for sites without a stored row
describe('Property 1: default radar schedule for sites without a stored row', () => {
  it('every site absent from the schedule map gets the default radar schedule', () => {
    fc.assert(
      fc.property(fc.array(validRowArb, { minLength: 1 }), (rows) => {
        const merged = mergeSites([], rows, [], new Map());
        for (const site of merged) {
          expect(site.schedule).toEqual(defaultScheduleFor(RADAR_TYPE));
        }
      }),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 2: Merge preserves all discovered sites (clients ∪ radar wall)
describe('Property 2: merge completeness', () => {
  it('output site IDs equal the union of client ids and radar-wall site ids', () => {
    fc.assert(
      fc.property(
        fc.array(validRowArb, { minLength: 1 }),
        fc.array(fc.integer({ min: 20, max: 30 }).map(String)),
        (rows, clientIds) => {
          const clients = clientIds.map((id) => ({ id, name: `C${id}` }));
          const merged = mergeSites(clients, rows, [], new Map());
          const expected = new Set<string>([
            ...clientIds,
            ...rows.map((r) => r.site_id),
          ]);
          const actual = new Set(merged.map((s) => s.id));
          expect(actual).toEqual(expected);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 3: Site isolation — saving one site leaves others unchanged
describe('Property 3: site isolation', () => {
  it('applyOptimisticPatch changes only the target site radar schedule', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(siteStatusArb, { selector: (s) => s.id, minLength: 1 })
          .map((arr) => arr.map(buildSite)),
        fc.integer({ min: 0, max: 20 }).map(String),
        fc.record({ deadline: timeArb, reminder: timeArb, enabled: fc.boolean() }),
        (sites, targetId, patch) => {
          const before = new Map(sites.map((s) => [s.id, s.schedule]));
          const after = applyOptimisticPatch(sites, targetId, patch);
          for (const s of after) {
            if (s.id !== targetId) {
              expect(s.schedule).toBe(before.get(s.id));
            }
          }
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 4: Archive rows are excluded from sensor discovery
describe('Property 4: archive rows excluded', () => {
  it('no sensor from an Archive row appears in the merged output', () => {
    fc.assert(
      fc.property(fc.array(maybeArchiveRowArb), (rows) => {
        const merged = mergeSites([], rows, [], new Map());
        const nonArchive = new Set(
          rows
            .filter((r) => r.type !== 'Archive')
            .map((r) => `${r.site_id}::${r.radar_number}`)
        );
        for (const site of merged) {
          for (const sensor of site.sensors) {
            expect(nonArchive.has(`${site.id}::${sensor.radarNumber}`)).toBe(true);
          }
        }
      }),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 5: Sensor deduplication within a site
describe('Property 5: sensor deduplication', () => {
  it('each radar_number appears at most once per site', () => {
    fc.assert(
      fc.property(fc.array(validRowArb, { minLength: 1 }), (rows) => {
        const merged = mergeSites([], rows, [], new Map());
        for (const site of merged) {
          const ids = site.sensors.map((s) => s.radarNumber);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 6: Sites are sorted alphabetically by name
describe('Property 6: alphabetical sort', () => {
  it('output is non-decreasing by localeCompare of name', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }).map(String), { minLength: 2 }),
        (ids) => {
          const clients = ids.map((id) => ({ id, name: `Site-${id}` }));
          const merged = mergeSites(clients, [], [], new Map());
          for (let i = 1; i < merged.length; i++) {
            expect(
              merged[i - 1].name.localeCompare(merged[i].name)
            ).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 7: Case-insensitive sensor-to-report matching
describe('Property 7: case-insensitive sensor-to-report matching', () => {
  it('sensor.generatedToday equals filename.includes(sensorId), case-insensitive', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.string(),
        (radar, filename) => {
          const merged = mergeSites(
            [{ id: '1', name: 'S' }],
            [{ site_id: '1', radar_number: radar }],
            [{ filename, clientId: null }],
            new Map()
          );
          const sensor = merged[0].sensors[0];
          const expected = filename.toLowerCase().includes(radar.toLowerCase());
          expect(sensor.generatedToday).toBe(expected);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 8: generatedToday and pendingSensors are consistent
describe('Property 8: generatedToday / pendingSensors consistency', () => {
  it('generatedToday === (pendingSensors.length === 0) and per-sensor flags agree', () => {
    fc.assert(
      fc.property(
        fc.array(validRowArb, { minLength: 1 }),
        fc.array(fc.record({ filename: fc.string(), clientId: fc.constant(null) })),
        (rows, reports) => {
          const merged = mergeSites([], rows, reports, new Map());
          for (const site of merged) {
            if (!site.hasRadar) continue;
            expect(site.generatedToday).toBe(site.pendingSensors.length === 0);
            const pending = new Set(site.pendingSensors.map((s) => s.radarNumber));
            for (const sensor of site.sensors) {
              expect(sensor.generatedToday).toBe(!pending.has(sensor.radarNumber));
            }
          }
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 18: Bulletin defaults + generated-this-period flag
describe('Property 18: bulletin schedule default and generated-this-period flag', () => {
  it('sites without a bulletin row get defaults; flag mirrors bulletinGenerated', () => {
    fc.assert(
      fc.property(
        fc.array(validRowArb, { minLength: 1 }),
        fc.array(fc.integer({ min: 0, max: 8 }).map(String)),
        (rows, insarIds) => {
          const bulletinGenerated = new Map([['insar', new Set(insarIds)]]);
          const merged = mergeSites([], rows, [], new Map(), bulletinGenerated);
          for (const site of merged) {
            // One bulletin obligation per configured type.
            expect(site.bulletins).toHaveLength(BULLETIN_TYPES.length);
            for (const def of BULLETIN_TYPES) {
              const b = site.bulletins.find((x) => x.type === def.key)!;
              expect(b.schedule).toEqual(defaultScheduleFor(def));
              const expected =
                def.key === 'insar' ? new Set(insarIds).has(site.id) : false;
              expect(b.generatedInPeriod).toBe(expected);
            }
          }
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 13: Custom reminder is preserved when deadline changes
describe('Property 13: custom reminder preserved on deadline change', () => {
  it('changing only the deadline never rewrites a custom reminder', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.constant('site-1'),
          name: fc.constant('Site 1'),
          schedule: fc
            .record({ deadline: timeArb, reminder: timeArb, enabled: fc.boolean() })
            .filter((s) => s.reminder !== defaultReminderFor(s.deadline)),
        }),
        timeArb,
        (siteRec, newDeadline) => {
          const sites = [buildSite(siteRec)];
          const after = applyOptimisticPatch(sites, 'site-1', { deadline: newDeadline });
          expect(after[0].schedule.reminder).toBe(siteRec.schedule.reminder);
          expect(after[0].schedule.deadline).toBe(newDeadline);
        }
      ),
      { numRuns: RUNS }
    );
  });
});
