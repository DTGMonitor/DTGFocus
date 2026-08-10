import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// jsdom gives every element zero size, so recharts' ResponsiveContainer
// measures 0x0, refuses to draw, and warns. Pinning it to a real size makes the
// charts render actual SVG — which is what lets the missing-hour rule below be
// asserted against the chart itself rather than only against the table view.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={800} height={300}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});
import {
  breakOnGaps,
  saturationSpans,
  MAX_CONNECT_MINUTES,
} from '@/components/admin/Fog/fogPresentation';
import { DataAgeBadge } from '@/components/admin/Fog/DataAgeBadge';
import { FogGuidance } from '@/components/admin/Fog/FogGuidance';
import { FogStatusCard } from '@/components/admin/Fog/FogStatusCard';
import { RainfallPanel } from '@/components/admin/Fog/RainfallPanel';
import type { FogResponse, RainfallResponse } from '@/components/admin/Fog/types';

// ---------------------------------------------------------------------------
// Navigation wiring
// ---------------------------------------------------------------------------

describe('admin nav', () => {
  test('every admin menu entry has a component registered behind it', () => {
    // components/admin/Radar/Radar.jsx is a STATE SWITCH, not a router: it maps
    // the last path segment of each adminMenuItems entry to a component and
    // renders `components[activeComponent]`. A menu entry with no matching key
    // renders `undefined` — a tab that opens to a blank page, with no 404 and
    // no console error to notice. This caught exactly that for FOG MONITOR.
    //
    // The source is scanned rather than imported because the map holds live JSX
    // and importing it would pull the whole radar monitoring tree into jsdom.
    const { adminMenuItems } = jest.requireActual('@/config/menuConfig');
    const source = readFileSync(
      join(process.cwd(), 'components/admin/Radar/Radar.jsx'),
      'utf8'
    );

    const literal = source.match(/const components = \{([\s\S]*?)\n\};/);
    expect(literal).not.toBeNull();

    const registered = new Set(
      [...(literal as RegExpMatchArray)[1].matchAll(/^\s*(\w+)\s*:/gm)].map(
        (m) => m[1]
      )
    );

    const missing = (adminMenuItems as { label: string; path: string }[])
      .map((item) => ({ label: item.label, key: item.path.split('/').pop() }))
      .filter((item) => !registered.has(item.key as string));

    expect(missing).toEqual([]);
  });

  test('every admin menu icon resolves in the icon mapper', () => {
    // IconMapper registers a fixed set of react-icons packs. "wi" is NOT among
    // them, so a WiFog icon silently resolves to null.
    const { adminMenuItems } = jest.requireActual('@/config/menuConfig');
    const { getIconComponent } = jest.requireActual(
      '@/components/Reusable/IconMapper'
    );

    const unresolved = (adminMenuItems as { label: string; icon: string }[])
      .filter((item) => getIconComponent(item.icon) === null)
      .map((item) => `${item.label}: ${item.icon}`);

    expect(unresolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Guidance document
// ---------------------------------------------------------------------------

describe('fog guidance', () => {
  // FogGuidance.tsx reproduces docs-konsep-kabut.md. Two copies of one document
  // drift; these phrases are the load-bearing ones, and each must be present in
  // BOTH — so editing either alone fails here.
  const LOAD_BEARING = [
    'jarak pandang < 1 km',
    'DPD = T − Td',
    '0,17 × (100 − RH)',
    'pengadukan mendistribusikan pendinginan ke lapisan puluhan meter',
    'Angin nol memberi skor rendah secara sengaja. Ini bukan bug.',
    'anemometer mangkuk mulai berputar pada ~2–3 km/jam',
    '|dT/dt| < 0,2 °C/jam',
    'Di bawah 8 pembacaan sistem menolak menilai',
    'dua pembacaan berturut-turut harus sepakat sebelum vonis berubah',
    'Kolom DPD sendirian memisahkan kabut dari asap pembakaran',
    'bukan pengganti pengamatan lapangan',
  ];

  /** Strip markdown emphasis and collapse whitespace so both sides compare. */
  const flatten = (text: string) =>
    text
      .replace(/[*`\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  test('every load-bearing statement is in the source markdown', () => {
    const markdown = flatten(
      readFileSync(join(process.cwd(), 'docs-konsep-kabut.md'), 'utf8')
    );
    const missing = LOAD_BEARING.filter((p) => !markdown.includes(flatten(p)));
    expect(missing).toEqual([]);
  });

  test('and every one of them is rendered in the app', () => {
    const { container } = render(<FogGuidance open onClose={() => {}} />);
    const rendered = flatten(container.textContent ?? '');
    const missing = LOAD_BEARING.filter((p) => !rendered.includes(flatten(p)));
    expect(missing).toEqual([]);
  });

  test('leads with the scope caveat, not the scoring table', () => {
    // The single most important sentence: this is an inference, not a
    // measurement. Burying it under the method would invert the document.
    render(<FogGuidance open onClose={() => {}} />);
    expect(screen.getByText(/Ruang lingkup/)).toBeInTheDocument();
    expect(screen.getByText(/menyimpulkan/)).toBeInTheDocument();
  });

  test('renders nothing until opened, and closes on request', async () => {
    const onClose = jest.fn();
    const { rerender, container } = render(
      <FogGuidance open={false} onClose={onClose} />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<FogGuidance open onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

    await userEvent.click(screen.getByRole('button', { name: /tutup/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('the cooling diagram uses the same colours as the live chart', () => {
    // An explanatory figure that colours temperature differently from the
    // chart beside it teaches the wrong association.
    const { container } = render(<FogGuidance open onClose={() => {}} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg?.innerHTML).toContain('var(--fog-temp)');
    expect(svg?.innerHTML).toContain('var(--fog-dew)');
    expect(svg?.innerHTML).toContain('var(--fog-sat-band)');
  });
});

const TZ = 'Asia/Singapore';
const t0 = new Date('2026-08-08T12:00:00Z').getTime();
const at = (min: number) => t0 + min * 60_000;

// ---------------------------------------------------------------------------
// Chart honesty helpers
// ---------------------------------------------------------------------------

describe('line gaps', () => {
  test('a break is inserted where polling stopped', () => {
    // A continuous line across a hole asserts we know what the air did. We do
    // not, so the series is cut.
    const points = [
      { t: at(0), tempC: 20 },
      { t: at(5), tempC: 20.1 },
      { t: at(90), tempC: 18 }, // 85-minute hole
    ];

    const out = breakOnGaps(points, ['tempC']);

    expect(out).toHaveLength(4);
    expect(out[2].tempC).toBeNull();
    expect(out[2].t).toBeGreaterThan(at(5));
    expect(out[2].t).toBeLessThan(at(90));
  });

  test('a gap within tolerance is bridged', () => {
    const points = [
      { t: at(0), tempC: 20 },
      { t: at(MAX_CONNECT_MINUTES), tempC: 19.5 },
    ];
    expect(breakOnGaps(points, ['tempC'])).toHaveLength(2);
  });
});

describe('saturation shading', () => {
  test('a span closes when the air leaves saturation', () => {
    const points = [
      { t: at(0), dpdC: 0.2 },
      { t: at(5), dpdC: 0.3 },
      { t: at(10), dpdC: 2.0 },
      { t: at(15), dpdC: 0.1 },
    ];
    const spans = saturationSpans(points, 1.0);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ from: at(0), to: at(5) });
  });

  test('shading never spans a polling hole', () => {
    // Both sides saturated, but nobody watched the middle. Shading straight
    // through would claim the layer persisted for hours we did not observe.
    const points = [
      { t: at(0), dpdC: 0.2 },
      { t: at(5), dpdC: 0.2 },
      { t: at(200), dpdC: 0.2 },
      { t: at(205), dpdC: 0.2 },
    ];
    const spans = saturationSpans(points, 1.0);

    expect(spans).toHaveLength(2);
    expect(spans[0].to).toBe(at(5));
    expect(spans[1].from).toBe(at(200));
  });

  test('a null depression is not treated as saturated', () => {
    const spans = saturationSpans(
      [
        { t: at(0), dpdC: null },
        { t: at(5), dpdC: null },
      ],
      1.0
    );
    expect(spans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Data age
// ---------------------------------------------------------------------------

describe('data age badge', () => {
  test('a stale reading says so in words, not only in colour', () => {
    render(
      <DataAgeBadge
        age={{ observedAt: '2026-08-08T10:00:00Z', ageMinutes: 95, stale: true }}
        timezone={TZ}
      />
    );
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.6 h ago/)).toBeInTheDocument();
  });

  test('a station that has never reported is treated as stale, not unknown', () => {
    render(
      <DataAgeBadge
        age={{ observedAt: null, ageMinutes: null, stale: true }}
        timezone={TZ}
      />
    );
    expect(screen.getByText(/no reading yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fog status card
// ---------------------------------------------------------------------------

function fogResponse(overrides: Partial<FogResponse> = {}): FogResponse {
  return {
    station: {
      macAddress: 'C8:C9:A3:0F:C7:FD',
      name: 'ASBSAR1',
      latitude: -2.5034,
      longitude: 121.5176,
      elevationM: 950,
      distanceKm: 3.2,
      timezone: TZ,
      stationType: 'AMBWeatherPro_V5.1.1',
    },
    assessment: {
      assessedAt: '2026-08-08T21:00:00Z',
      verdict: 'FOG_LIKELY',
      rawVerdict: 'FOG_LIKELY',
      hysteresisHeld: false,
      scoreA: 85,
      reason: 'All radiation-fog preconditions satisfied',
      components: [
        { component: 'saturation', points: 30, max: 30, detail: 'DPD 0.10 °C', available: true },
        { component: 'persistence', points: 5, max: 15, detail: 'saturated 40 minutes', available: false },
        { component: 'wind', points: 20, max: 20, detail: '3.4 km/h', available: true },
        { component: 'plateau', points: 20, max: 20, detail: 'dT/dt +0.00 °C/h', available: true },
        { component: 'radiative', points: 10, max: 10, detail: 'peak kt 0.80', available: true },
        { component: 'reservoir', points: 0, max: 5, detail: 'no antecedent rain', available: false },
      ],
      gates: [],
      minutesSaturated: 40,
      dTdt: 0,
      ktPeak: 0.8,
      pressureDeltaHpa: 0.1,
      historyHours: 24,
      readingCount: 288,
      indexBAvailable: false,
      algorithmVersion: '1',
    },
    series: [],
    thresholds: { dpdSatC: 1, windVetoKmh: 12, likelyMin: 70, ambiguousMin: 45 },
    dataAge: { observedAt: '2026-08-08T21:00:00Z', ageMinutes: 3, stale: false },
    ...overrides,
  };
}

describe('fog status card', () => {
  test('shows the verdict and the score against its thresholds', () => {
    render(<FogStatusCard data={fogResponse()} loading={false} />);

    expect(screen.getByText('Fog likely')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '85');
  });

  test('says how much of the score was actually measurable', () => {
    // Persistence and reservoir are capped by short history: 15 + 5 = 20 points
    // that could not be earned. A card showing 85/100 without that is claiming
    // more confidence than the data supports.
    render(<FogStatusCard data={fogResponse()} loading={false} />);
    expect(screen.getByText(/80 of 100 measurable/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/not yet fully measurable/i).length
    ).toBeGreaterThanOrEqual(2);
  });

  test('states explicitly when index B could not run', () => {
    render(<FogStatusCard data={fogResponse()} loading={false} />);
    expect(screen.getByText(/index b unavailable/i)).toBeInTheDocument();
  });

  test('a fired gate zeroes the score but keeps the breakdown visible', () => {
    const data = fogResponse();
    data.assessment!.verdict = 'NO_FOG';
    data.assessment!.scoreA = 0;
    data.assessment!.gates = [
      { gate: 'raining', detail: 'raining now (1.40 mm/h)' },
    ];

    render(<FogStatusCard data={data} loading={false} />);

    expect(screen.getByText(/score vetoed/i)).toBeInTheDocument();
    // Both the gate's name and its reading are shown.
    expect(screen.getAllByText(/raining now/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/1\.40 mm\/h/)).toBeInTheDocument();
    // The components still report what they earned — a near miss stays visible.
    expect(screen.getByText(/80 of 100 measurable/)).toBeInTheDocument();
    expect(screen.getByText('DPD 0.10 °C')).toBeInTheDocument();
  });

  test('explains a held verdict rather than silently showing the old one', () => {
    const data = fogResponse();
    data.assessment!.verdict = 'NO_FOG';
    data.assessment!.rawVerdict = 'FOG_LIKELY';
    data.assessment!.hysteresisHeld = true;

    render(<FogStatusCard data={data} loading={false} />);
    expect(screen.getByText(/two consecutive readings that agree/i)).toBeInTheDocument();
  });

  test('an unscored station explains why instead of showing zero', () => {
    const data = fogResponse();
    data.assessment!.verdict = 'INSUFFICIENT_HISTORY';
    data.assessment!.scoreA = null;
    data.assessment!.readingCount = 3;

    render(<FogStatusCard data={data} loading={false} />);

    expect(screen.getByText('Not enough history')).toBeInTheDocument();
    expect(screen.getByText(/needs 8 readings/i)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rainfall
// ---------------------------------------------------------------------------

function rainResponse(): RainfallResponse {
  return {
    station: fogResponse().station,
    range: '24h',
    hourly: [
      { hourStart: '2026-08-08T01:00:00Z', rainMm: 2.4, coveredMinutes: 60, sampleCount: 12, hadReset: false, missing: false },
      { hourStart: '2026-08-08T02:00:00Z', rainMm: 0, coveredMinutes: 60, sampleCount: 12, hadReset: false, missing: false },
      { hourStart: '2026-08-08T03:00:00Z', rainMm: null, coveredMinutes: 10, sampleCount: 2, hadReset: false, missing: false },
      { hourStart: '2026-08-08T04:00:00Z', rainMm: null, coveredMinutes: 0, sampleCount: 0, hadReset: false, missing: true },
    ],
    daily: [
      { dayStart: '2026-08-07T16:00:00Z', rainMm: 12.4, sampleCount: 288, hoursObserved: 24, complete: true },
      { dayStart: '2026-08-08T16:00:00Z', rainMm: 3.1, sampleCount: 90, hoursObserved: 9, complete: false },
    ],
    currentRate: { rainRateMmh: 0, raining: false },
    coverageRule: { minCoveredMinutes: 45, note: 'Hours below the coverage threshold report null, not zero.' },
    dataAge: { observedAt: '2026-08-08T21:00:00Z', ageMinutes: 3, stale: false },
  };
}

describe('rainfall', () => {
  test('an unwatched hour and a dry hour are not the same in the table', async () => {
    // The rule the whole panel exists for. A dry hour is a measurement; an
    // unwatched hour is an absence, and they must never read alike.
    render(<RainfallPanel data={rainResponse()} loading={false} range="24h" />);

    await userEvent.click(screen.getByRole('button', { name: /table/i }));

    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getAllByText(/not measured/i).length).toBe(2);
  });

  test('an unwatched hour draws no bar; a dry hour draws one at the baseline', () => {
    // The rule expressed in the chart itself. Four hours in the fixture: 2.4 mm,
    // 0 mm, and two with no usable total. Recharts emits a rectangle per
    // non-null datum, so a null hour must contribute nothing at all — an
    // invisible zero-height bar and an absent bar are the same pixels, but only
    // one of them is a claim about the weather.
    const { container } = render(
      <RainfallPanel data={rainResponse()} loading={false} range="24h" />
    );

    // Bar group 0 is the hourly chart, group 1 the daily totals.
    const groups = container.querySelectorAll('.recharts-bar');
    const hourlyBars = groups[0].querySelectorAll('.recharts-bar-rectangle');

    // Exactly two of the four hours produced a measurement: 2.4 mm and 0 mm.
    // The 0 mm bar MUST be present — recharts drops zero-height bars unless
    // minPointSize forces a baseline mark, and without it a dry hour would be
    // pixel-identical to an unwatched one.
    expect(hourlyBars.length).toBe(2);

    // And the unwatched stretch is marked rather than silently skipped.
    expect(
      container.querySelectorAll('.recharts-reference-area').length
    ).toBeGreaterThan(0);
  });

  test('counts the unwatched hours in the summary', () => {
    render(<RainfallPanel data={rainResponse()} loading={false} range="24h" />);
    expect(screen.getByText(/2 h unwatched/)).toBeInTheDocument();
  });

  test('warns that an incomplete day is a floor, not a total', () => {
    render(<RainfallPanel data={rainResponse()} loading={false} range="24h" />);
    expect(screen.getByText(/a floor, not a total/i)).toBeInTheDocument();
  });
});
