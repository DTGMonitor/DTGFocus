import { render } from '@testing-library/react';
import { RainfallCharts } from '@/components/admin/Radar/report/blocks/RainfallCharts';
import { dailyStrings } from '@/config/dailyReportLocale';
import { TABULATION_SECTIONS } from '@/config/reportSections';
import { DAILY_USABLE_H } from '@/components/admin/Radar/report/constants';

// The rainfall charts are the first RENDERED chart on the Tabulation report —
// every graph on it until now was a pasted screenshot. That puts them on the
// html2canvas path, where the failure mode is silent: a chart that rasterizes
// blank, or a colour that paints transparent, still passes every render test
// that only asks "did it mount". These tests pin the four things that would
// each print a hole in a client's PDF.

const window_ = (n, { gapAt = null, missingAt = null } = {}) => ({
  series: Array.from({ length: n }, (_, i) => ({
    observedAt: new Date(Date.parse('2026-09-22T00:00:00Z') + i * 5 * 60_000).toISOString(),
    rainDailyMm: i * 0.2,
    rainRateMmh: i % 7 === 0 ? 23.4 : 1.2,
  })),
  hourly: Array.from({ length: 4 }, (_, i) => ({
    hourStart: new Date(Date.parse('2026-09-22T00:00:00Z') + i * 3_600_000).toISOString(),
    rainMm: i === gapAt ? null : 1,
    coveredMinutes: i === gapAt ? 10 : 60,
    sampleCount: 12,
    hadReset: false,
    missing: i === missingAt,
  })),
  station: { timezone: 'Asia/Singapore' },
});

const full = () =>
  render(
    <RainfallCharts
      strings={dailyStrings('id')}
      day={window_(60, { gapAt: 2, missingAt: 3 })}
      week={window_(200)}
      timezone="Asia/Singapore"
    />
  );

describe('report rainfall charts', () => {
  test('both plots rasterize at a FIXED pixel size, with no ResponsiveContainer', () => {
    // The one that bites. The report mounts every block a second time in a
    // hidden measurement layer that resolves no height; there
    // ResponsiveContainer measures 0 and the chart reaches the PDF blank.
    const { container } = full();

    const svgs = container.querySelectorAll('svg.recharts-surface');
    expect(svgs.length).toBe(2);
    for (const svg of Array.from(svgs)) {
      expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(svg.getAttribute('height'))).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll('.recharts-responsive-container').length).toBe(0);
  });

  test('no CSS custom property reaches the page', () => {
    // html2canvas 1.x resolves neither var() nor oklch() and paints them
    // TRANSPARENT — the chart would print as a hole, not as a wrong colour.
    // The live panel is full of var(--fog-*); the print palette must not be.
    const { container } = full();

    expect(container.innerHTML).not.toMatch(/var\(--/);
    expect(container.innerHTML).not.toMatch(/oklch\(/);

    const strokes = new Set(
      Array.from(container.querySelectorAll('.recharts-line-curve')).map((c) =>
        c.getAttribute('stroke')
      )
    );
    expect([...strokes].sort()).toEqual(['#0f9b93', '#3498db']);
  });

  test('carries no interactivity into the paper', () => {
    // The measured pass and the printed pass must render identically, and
    // paper has no hover. A Tooltip would also make the two passes differ.
    const { container } = full();
    expect(container.querySelectorAll('.recharts-tooltip-wrapper').length).toBe(0);
  });

  test('an unwatched hour is banded and explained, in the report language', () => {
    const { container } = full();
    expect(container.querySelectorAll('.recharts-reference-area').length).toBeGreaterThan(0);
    // Indonesian: Vale's report locale.
    expect(container.textContent).toContain('Area berarsir');
  });

  test('a window with no readings prints the reason, never empty axes', () => {
    // Empty axes would read as a week with no rain, which is the one thing
    // this section must never imply.
    const { container } = render(
      <RainfallCharts
        strings={dailyStrings('en')}
        day={{ series: [], hourly: [] }}
        week={{ series: [], hourly: [] }}
        timezone="UTC"
      />
    );

    expect(container.querySelectorAll('svg.recharts-surface').length).toBe(0);
    expect(container.textContent).toContain('No station readings');
  });

  test('the block fits one page — the paginator never splits it', () => {
    // A block taller than the usable height gets its own page and silently
    // overflows. Measured height is 0 in jsdom, so this pins the DECLARED
    // geometry instead: two 150px plots plus chrome, well inside the budget.
    const { container } = full();
    const declared = Array.from(container.querySelectorAll('svg.recharts-surface'))
      .reduce((h, s) => h + Number(s.getAttribute('height')), 0);

    // Chrome: section bar, two captions, the footnote and the borders.
    expect(declared + 120).toBeLessThan(DAILY_USABLE_H);
  });

  test('the section is registered on the Tabulation report, after the summary', () => {
    // The charts EVIDENCE the summary's rainfall line rather than replacing it.
    const keys = TABULATION_SECTIONS.map((s) => s.key);
    expect(keys).toContain('rainCharts');
    expect(keys.indexOf('rainCharts')).toBe(keys.indexOf('summary') + 1);
    // Stored layouts are lists of these keys — renaming one drops the section
    // from every site that saved a layout.
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('both report languages define every chart string', () => {
    for (const locale of ['en', 'id']) {
      const s = dailyStrings(locale);
      for (const k of ['rainChartHeading', 'rainChart24h', 'rainChart7d', 'rainChartDaily', 'rainChartRate', 'rainChartNoData', 'rainChartGaps']) {
        expect(typeof s[k]).toBe('string');
        expect(s[k].length).toBeGreaterThan(0);
      }
    }
  });
});
