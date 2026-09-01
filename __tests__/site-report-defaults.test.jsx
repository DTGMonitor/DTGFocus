/**
 * The report each site usually takes — Telfer's Data Quality assessment,
 * Leonora's Comprehensive, Vale's Tabulation.
 *
 * Two layers are covered here: the pure model (what a stored row means, and what
 * it is allowed to mean) and the generator itself (that opening it on a site
 * really does land on that site's report, and that saving writes what the form
 * is showing).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  normalizeDefault,
  defaultsBySite,
  applyDefaultToForm,
  matchesDefault,
  serializeDefault,
  describeDefault,
  clampCustomDays,
} from '@/utils/reportDefaults';

const CATALOGUES = {
  reportTypes: ['Radar', 'Insar'],
  categories: ['Water Body', 'Deformation', 'Data Quality', 'Comprehensive', 'Tabulation'],
  frequencies: ['daily', 'weekly', 'monthly', 'custom'],
};

describe('normalizeDefault — a stored row as the form can actually use it', () => {
  it('keeps the values the form offers', () => {
    const def = normalizeDefault(
      { site_id: 12, report_type: 'Radar', category: 'Comprehensive', frequency: 'weekly', custom_days: null },
      CATALOGUES
    );
    expect(def).toMatchObject({
      siteId: '12',
      reportType: 'Radar',
      category: 'Comprehensive',
      frequency: 'weekly',
      customDays: null,
    });
  });

  it('keys the site as a STRING, because that is what a <select> value is', () => {
    // `12` from the database would never match `'12'` from the DOM.
    expect(normalizeDefault({ site_id: 12, category: 'Tabulation' }, CATALOGUES).siteId).toBe('12');
    expect(defaultsBySite([{ site_id: 12, category: 'Tabulation' }], CATALOGUES).get('12')).toBeTruthy();
  });

  it('drops a value the form no longer offers rather than forcing it into a select', () => {
    // A row that outlives a rename must degrade to "no saved default for that
    // field", not to a <select> set to something it cannot show.
    const def = normalizeDefault(
      { site_id: 1, report_type: 'Lidar', category: 'Comprehensive', frequency: 'fortnightly' },
      CATALOGUES
    );
    expect(def.reportType).toBeNull();
    expect(def.frequency).toBeNull();
    expect(def.category).toBe('Comprehensive');
  });

  it('is null when nothing survives, so "a row exists" is not mistaken for "a default exists"', () => {
    expect(normalizeDefault(null, CATALOGUES)).toBeNull();
    expect(normalizeDefault({ site_id: 1, category: 'Nonsense' }, CATALOGUES)).toBeNull();
    expect(defaultsBySite([{ site_id: 1, category: 'Nonsense' }], CATALOGUES).size).toBe(0);
  });

  it('clamps a hand-edited span to what an analyst could have typed', () => {
    expect(normalizeDefault({ site_id: 1, frequency: 'custom', custom_days: 3650 }, CATALOGUES).customDays).toBe(366);
    expect(clampCustomDays('4.6')).toBe(5);
    // A cleared field is the shortest legal window — what the Days input has
    // always filled back in on blur. Only a non-number reaches the fallback.
    expect(clampCustomDays('')).toBe(1);
    expect(clampCustomDays('abc', null)).toBeNull();
    // …and a row that stored no span at all stays "no span", not one day.
    expect(normalizeDefault({ site_id: 1, frequency: 'custom', custom_days: null }, CATALOGUES).customDays).toBeNull();
  });
});

describe('applyDefaultToForm — sets what the default names, and nothing else', () => {
  const form = { reportType: 'Radar', category: 'Data Quality', frequency: 'monthly', customDays: 2, endDate: '2026-09-01' };

  it('leaves a field the default does not name alone', () => {
    // A site that always takes the Comprehensive report but picks its window per
    // report saves a category and no frequency.
    const next = applyDefaultToForm(form, { category: 'Comprehensive', reportType: null, frequency: null, customDays: null });
    expect(next.category).toBe('Comprehensive');
    expect(next.frequency).toBe('monthly');
    expect(next.endDate).toBe('2026-09-01');
  });

  it('returns the form untouched when there is no default', () => {
    expect(applyDefaultToForm(form, null)).toBe(form);
  });
});

describe('matchesDefault — is the form already on this site’s default?', () => {
  const selection = { reportType: 'Radar', category: 'Comprehensive', frequency: 'daily', customDays: 2 };

  it('ignores fields the default never claimed', () => {
    expect(matchesDefault({ category: 'Comprehensive' }, selection)).toBe(true);
    expect(matchesDefault({ category: 'Tabulation' }, selection)).toBe(false);
  });

  it('compares the span only behind a custom frequency', () => {
    expect(matchesDefault({ frequency: 'custom', customDays: 3 }, { ...selection, frequency: 'custom', customDays: 3 })).toBe(true);
    expect(matchesDefault({ frequency: 'custom', customDays: 3 }, { ...selection, frequency: 'custom', customDays: 4 })).toBe(false);
    expect(matchesDefault({ frequency: 'weekly', customDays: 3 }, { ...selection, frequency: 'weekly', customDays: 9 })).toBe(true);
  });

  it('is false with no default at all, so the control offers to save one', () => {
    expect(matchesDefault(null, selection)).toBe(false);
  });
});

describe('serializeDefault — what gets written', () => {
  it('stores the span only behind a custom frequency', () => {
    expect(serializeDefault(7, { reportType: 'Radar', category: 'Comprehensive', frequency: 'weekly', customDays: 5 }))
      .toMatchObject({ site_id: 7, category: 'Comprehensive', frequency: 'weekly', custom_days: null });
    expect(serializeDefault(7, { category: 'Comprehensive', frequency: 'custom', customDays: '5' }))
      .toMatchObject({ frequency: 'custom', custom_days: 5 });
  });

  it('writes null, not an empty string, for a field the form has not filled', () => {
    expect(serializeDefault(7, { category: 'Comprehensive', frequency: '' })).toMatchObject({
      report_type: null,
      frequency: null,
    });
  });
});

describe('describeDefault — the line the analyst reads', () => {
  const labels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' };

  it('reads in the form’s words, not the database’s', () => {
    expect(describeDefault({ reportType: 'Radar', category: 'Comprehensive', frequency: 'weekly' }, { frequencyLabels: labels }))
      .toBe('Radar · Comprehensive · Weekly');
  });

  it('names a custom window by its length', () => {
    expect(describeDefault({ category: 'Comprehensive', frequency: 'custom', customDays: 2 }, { frequencyLabels: labels }))
      .toBe('Comprehensive · 2-day window');
  });

  it('is empty for no default', () => {
    expect(describeDefault(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The generator itself.
// ---------------------------------------------------------------------------

const CLIENTS = [
  { id: 7, site_name: 'Telfer', company: 'Newcrest', location: 'WA', logo_path: null },
  { id: 8, site_name: 'Leonora', company: 'GoldFields', location: 'WA', logo_path: null },
];

/** Rows the stubbed `site_report_defaults` table answers with. */
let defaultRows = [];
/** Every write the modal makes, so the save path can be asserted on. */
let writes = [];

/**
 * One chainable, awaitable query builder per table.
 *
 * The modal's queries differ in shape (`.select().order()`, `.select().eq().eq()
 * .maybeSingle()`, a bare awaited `.select()`), so every method returns the same
 * object and the object itself is thenable.
 */
const makeChain = (result) => {
  const chain = {};
  const promise = () => Promise.resolve(result);
  for (const method of ['select', 'eq', 'order', 'in', 'gte', 'lte', 'limit', 'not']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = promise;
  chain.single = promise;
  chain.then = (onFulfilled, onRejected) => promise().then(onFulfilled, onRejected);
  return chain;
};

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      if (table === 'clients') return makeChain({ data: CLIENTS, error: null });
      if (table === 'site_report_defaults') {
        const chain = makeChain({ data: defaultRows, error: null });
        chain.upsert = (payload) => {
          writes.push({ kind: 'upsert', payload });
          return makeChain({ data: payload, error: null });
        };
        chain.delete = () => {
          writes.push({ kind: 'delete' });
          return makeChain({ data: null, error: null });
        };
        return chain;
      }
      return makeChain({ data: null, error: null });
    },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null }) }) },
  },
}));

jest.mock('@/components/Reusable/useUserSite', () => ({
  useUserSite: () => ({ user: { email: 'a@b.c' }, userSite: { displayname: 'Tester' }, loading: false }),
}));

// The two data layers fire whole fetch cascades the moment their category is
// selected, and none of it is what these tests are about.
jest.mock('@/components/admin/Reports/useComprehensiveReportData', () => ({
  useComprehensiveReportData: () => ({ data: null, loading: false }),
}));
jest.mock('@/components/admin/Reports/useDailyReportData', () => ({
  useDailyReportData: () => ({ data: null, loading: false }),
}));

import { supabase } from '@/lib/supabaseClient';
import ReportTemplateModal from '@/components/admin/Reports/ReportTemplateModal';

describe('ReportTemplateModal — the site’s default selection', () => {
  const sensor = (siteId, siteName) => ({
    id: 1,
    site_id: siteId,
    wallfolder_id: 42,
    radar_number: 'RDR-01',
    site_name: siteName,
    timezone: 'Australia/Perth',
  });

  beforeEach(() => {
    defaultRows = [];
    writes = [];
  });

  const category = () => screen.getByLabelText(/category/i, { selector: 'select' });
  const reportType = () => screen.getByLabelText(/report type/i, { selector: 'select' });

  const mount = (props) =>
    render(<ReportTemplateModal onClose={() => {}} radarData={null} {...props} />);

  it('opens a site with no saved default on the form’s own selection', async () => {
    mount({ sensor: sensor(7, 'Telfer') });
    await waitFor(() => expect(screen.getByText(/No default set/)).toBeInTheDocument());
    expect(category().value).toBe('Data Quality');
  });

  it('opens Leonora on the Comprehensive report it actually takes', async () => {
    defaultRows = [{ site_id: 8, report_type: 'Radar', category: 'Comprehensive', frequency: 'weekly', custom_days: null }];
    mount({ sensor: sensor(8, 'Leonora') });

    await waitFor(() => expect(category().value).toBe('Comprehensive'));
    expect(reportType().value).toBe('Radar');
    // The frequency comes with it — the report is a weekly one, and leaving that
    // to be re-chosen every morning is the other half of the same mistake.
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveClass('border-[var(--dtg-primary-teal-dark)]');
  });

  it('lets the analyst move off the default without it snapping back', async () => {
    const user = userEvent.setup();
    defaultRows = [{ site_id: 8, report_type: 'Radar', category: 'Comprehensive', frequency: 'weekly' }];
    mount({ sensor: sensor(8, 'Leonora') });

    await waitFor(() => expect(category().value).toBe('Comprehensive'));
    await user.selectOptions(category(), 'Data Quality');

    // A default that re-applied on every render would undo the correction the
    // analyst just made — worse than never applying it at all.
    expect(category().value).toBe('Data Quality');
    await waitFor(() => expect(screen.getByText('changed')).toBeInTheDocument());
  });

  it('saves the current selection as the site’s default', async () => {
    const user = userEvent.setup();
    mount({ sensor: sensor(8, 'Leonora') });

    await waitFor(() => expect(screen.getByText(/No default set/)).toBeInTheDocument());
    await user.selectOptions(category(), 'Tabulation');
    await user.click(screen.getByRole('button', { name: /save as default/i }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].payload).toMatchObject({
      site_id: 8,
      report_type: 'Radar',
      category: 'Tabulation',
      // Tabulation has no granularity to choose; the form fixes it at daily and
      // the saved default has to agree with what was on screen.
      frequency: 'daily',
      custom_days: null,
      updated_by: 'Tester',
    });
  });

  it('says so, and stays out of the way, when the table has not been created yet', async () => {
    const spy = jest.spyOn(supabase, 'from');
    spy.mockImplementation((table) => {
      if (table === 'clients') return makeChain({ data: CLIENTS, error: null });
      if (table === 'site_report_defaults') {
        return makeChain({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
      }
      return makeChain({ data: null, error: null });
    });

    mount({ sensor: sensor(7, 'Telfer') });

    // The generator is unchanged — a missing table must never block a report.
    await waitFor(() => expect(screen.getByText(/not set up yet/i)).toBeInTheDocument());
    expect(category().value).toBe('Data Quality');
    expect(screen.getByRole('button', { name: /save as default/i })).toBeDisabled();

    spy.mockRestore();
  });
});
