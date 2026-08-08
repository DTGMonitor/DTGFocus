// The daily radar reporting-services notification.
//
// The Hidden Valley draft below is the wording DTG already sends by hand; it is
// the acceptance test for the generator. Everything else here pins the parts
// that vary per site: how many radars reported, what the ones that did not are
// doing, and which day the reports cover.

// `useDailyReportDraft` pulls in the browser Supabase client at module scope.
// Only its pure helpers are exercised here, so a stub is enough to let the
// module load.
jest.mock('@/lib/supabaseClient', () => ({
    supabase: {
        from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        storage: { from: () => ({ download: () => Promise.resolve({ data: null, error: null }) }) },
    },
}));

const {
    buildDailyReportDraft,
    buildStatusNote,
    formatPeriodDate,
    joinRadars,
    parseReportDate,
    siteGroupFor,
    statusPhrase,
} = require('@/components/admin/Radar/ReportReminder/dailyReportDraft');

const {
    detectSpan,
    detectVariant,
    resolveSiteReports,
    yesterdayKey,
} = require('@/components/admin/Radar/ReportReminder/useDailyReportDraft');

describe('period date', () => {
    test('a bare YYYY-MM-DD is read as a local day, not UTC midnight', () => {
        const d = parseReportDate('2026-08-07');
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(7);
        expect(d.getDate()).toBe(7);
    });

    test('formats the way the drafts write it', () => {
        expect(formatPeriodDate('2026-08-07')).toBe('7 August 2026');
        expect(formatPeriodDate('2026-08-07', 'id')).toBe('7 Agustus 2026');
    });

    test('an absent date yields an empty string rather than "Invalid Date"', () => {
        expect(formatPeriodDate(null)).toBe('');
        expect(formatPeriodDate('not a date')).toBe('');
    });
});

describe('radar lists', () => {
    test('one, two, and the serial comma from three up', () => {
        expect(joinRadars(['SSR777XT'])).toBe('SSR777XT');
        expect(joinRadars(['SSR777XT', 'SSR778XT'])).toBe('SSR777XT and SSR778XT');
        expect(joinRadars(['SSR925XT', 'SSR535XT', 'SSR778XT'])).toBe(
            'SSR925XT, SSR535XT, and SSR778XT'
        );
    });

    test('Indonesian joins with dan', () => {
        expect(joinRadars(['SSR777XT', 'SSR778XT'], 'id')).toBe('SSR777XT dan SSR778XT');
    });
});

describe('the status note', () => {
    test('maps a status to its consequence, not its name', () => {
        expect(statusPhrase('Link Down')).toBe('no data updated');
        expect(statusPhrase('Lost Connection')).toBe('connection lost');
        expect(statusPhrase('Scheduled Offline')).toBe('scheduled offline');
    });

    test('an unmapped status degrades to itself rather than to nothing', () => {
        expect(statusPhrase('Radar System Issue')).toBe('radar system issue');
        expect(statusPhrase(null)).toBe('no report generated');
    });

    test('radars sharing a status collapse into one clause', () => {
        const note = buildStatusNote([
            { radarNumber: 'SSR925XT', status: 'Link Down' },
            { radarNumber: 'SSR535XT', status: 'Link Down' },
            { radarNumber: 'SSR778XT', status: 'Link Down' },
        ]);
        expect(note).toBe('Note: SSR535XT, SSR778XT, and SSR925XT — no data updated.');
    });

    test('mixed statuses become one clause each, link-down first', () => {
        const note = buildStatusNote([
            { radarNumber: 'SSR778XT', status: 'Lost Connection' },
            { radarNumber: 'SSR925XT', status: 'Link Down' },
            { radarNumber: 'SSR535XT', status: 'Link Down' },
        ]);
        expect(note).toBe(
            'Note: SSR535XT and SSR925XT — no data updated; SSR778XT — connection lost.'
        );
    });

    test('nothing missing means no note at all', () => {
        expect(buildStatusNote([])).toBe('');
    });
});

describe('subject', () => {
    test('names only the radars that reported', () => {
        const draft = buildDailyReportDraft({
            siteName: 'Hidden Valley',
            reportedRadars: ['SSR777XT'],
            missingRadars: [],
            periodDate: '2026-08-07',
            senderName: 'Nessy',
        });
        expect(draft.subject).toContain('of SSR777XT - Hidden Valley');
    });

    test('a degenerate empty list leaves no "of  -" gap behind', () => {
        const draft = buildDailyReportDraft({
            siteName: 'Hidden Valley',
            reportedRadars: [],
            missingRadars: [],
            periodDate: '2026-08-07',
            senderName: 'Nessy',
        });
        expect(draft.subject).toBe(
            'Daily Radar Reporting Services - Hidden Valley period of 7 August 2026'
        );
        expect(draft.subject).not.toMatch(/ {2}/);
    });
});

describe('recipients', () => {
    test('To is the site distribution group, Cc is DTG Engineers', () => {
        const draft = buildDailyReportDraft({
            siteName: 'Hidden Valley',
            reportedRadars: ['SSR777XT'],
            missingRadars: [],
            periodDate: '2026-08-07',
            senderName: 'Nessy',
        });
        expect(draft.to).toBe('"Hidden Valley [All]"');
        expect(draft.cc).toBe('DTG Engineers');
        expect(siteGroupFor('BIB')).toBe('"BIB [All]"');
    });
});

describe('the Hidden Valley draft', () => {
    const draft = buildDailyReportDraft({
        siteName: 'Hidden Valley',
        reportedRadars: ['SSR777XT'],
        missingRadars: [
            { radarNumber: 'SSR925XT', status: 'Link Down' },
            { radarNumber: 'SSR535XT', status: 'Link Down' },
            { radarNumber: 'SSR778XT', status: 'Link Down' },
        ],
        periodDate: '2026-08-07',
        senderName: 'Nessy',
    });

    test('subject', () => {
        expect(draft.subject).toBe(
            'Daily Radar Reporting Services of SSR777XT - Hidden Valley period of 7 August 2026'
        );
    });

    test('body', () => {
        expect(draft.body).toBe(
            [
                'Dear All,',
                '',
                'Please find attached the Daily Radar Reporting Services of SSR777XT - Hidden Valley for the period of 7 August 2026.',
                '',
                'Note: SSR535XT, SSR778XT, and SSR925XT — no data updated.',
                '',
                'Thank you.',
                '',
                'Regards,',
                'Nessy',
            ].join('\n')
        );
    });

    test('a full house drops the Note paragraph entirely', () => {
        const clean = buildDailyReportDraft({
            siteName: 'Hidden Valley',
            reportedRadars: ['SSR777XT', 'SSR778XT'],
            missingRadars: [],
            periodDate: '2026-08-07',
            senderName: 'Nessy',
        });
        expect(clean.body).not.toContain('Note:');
        expect(clean.subject).toBe(
            'Daily Radar Reporting Services of SSR777XT and SSR778XT - Hidden Valley period of 7 August 2026'
        );
    });
});

describe('the Telfer data-quality draft', () => {
    const draft = buildDailyReportDraft({
        siteName: 'Telfer',
        reportedRadars: ['SSR460XT', 'SSR461XT', 'SSR994FX', 'SSR844FX'],
        missingRadars: [],
        periodDate: '2026-02-14',
        senderName: 'Nessy',
        variant: 'dataQuality',
        span: '24h',
    });

    test('subject names the assessment and its window, not the radar service', () => {
        expect(draft.subject).toBe(
            '24h Data Quality Assessment of SSR460XT, SSR461XT, SSR844FX, and SSR994FX - Telfer period of 14 February 2026'
        );
    });

    test('body runs the site straight into the period — no "for the"', () => {
        expect(draft.body).toBe(
            [
                'Dear All,',
                '',
                'Please find attached the 24h Data Quality Assessment of SSR460XT, SSR461XT, SSR844FX, and SSR994FX - Telfer period of 14 February 2026.',
                '',
                'Thank you.',
                '',
                'Regards,',
                'Nessy',
            ].join('\n')
        );
        expect(draft.body).not.toContain('for the period of');
    });

    test('a weekly assessment names its own window', () => {
        const weekly = buildDailyReportDraft({
            siteName: 'Telfer',
            reportedRadars: ['SSR460XT'],
            missingRadars: [],
            periodDate: '2026-02-14',
            senderName: 'Nessy',
            variant: 'dataQuality',
            span: '7d',
        });
        expect(weekly.subject).toBe(
            '7d Data Quality Assessment of SSR460XT - Telfer period of 14 February 2026'
        );
    });

    test('an unknown window falls back to 24h rather than to nothing', () => {
        const draft2 = buildDailyReportDraft({
            siteName: 'Telfer',
            reportedRadars: ['SSR460XT'],
            missingRadars: [],
            periodDate: '2026-02-14',
            senderName: 'Nessy',
            variant: 'dataQuality',
            span: null,
        });
        expect(draft2.subject).toContain('24h Data Quality Assessment');
    });
});

describe('the BIB Indonesian draft', () => {
    const draft = buildDailyReportDraft({
        siteName: 'BIB',
        reportedRadars: ['PS 2000'],
        missingRadars: [],
        periodDate: '2026-05-06',
        senderName: 'Nessy',
        locale: 'id',
    });

    test('subject names the report shortly', () => {
        expect(draft.subject).toBe('Laporan Harian PS 2000 - BIB Periode 6 Mei 2026');
    });

    test('body spells the report out and closes on a comma', () => {
        expect(draft.body.split('\n').slice(0, 3)).toEqual([
            'Dengan Hormat,',
            '',
            'Terlampir Laporan Harian Analisis Data Deformasi PS 2000 - BIB periode 6 Mei 2026,',
        ]);
    });

    test('closes in Indonesian', () => {
        expect(draft.body).toContain('Terima kasih.');
        expect(draft.body).toContain('Salam,');
    });

    test('the status note is Indonesian too', () => {
        const withNote = buildDailyReportDraft({
            siteName: 'BIB',
            reportedRadars: ['PS 2000'],
            missingRadars: [{ radarNumber: 'PS 2001', status: 'Link Down' }],
            periodDate: '2026-05-06',
            senderName: 'Nessy',
            locale: 'id',
        });
        expect(withNote.body).toContain('Catatan: PS 2001 — data tidak terbarui.');
    });

    test('an Indonesian data-quality draft keeps the English shape', () => {
        const dq = buildDailyReportDraft({
            siteName: 'BIB',
            reportedRadars: ['PS 2000'],
            missingRadars: [],
            periodDate: '2026-05-06',
            senderName: 'Nessy',
            locale: 'id',
            variant: 'dataQuality',
            span: '24h',
        });
        expect(dq.subject).toBe('Penilaian Kualitas Data 24h PS 2000 - BIB Periode 6 Mei 2026');
    });
});

describe('variant detection', () => {
    test('reports.category is authoritative', () => {
        expect(detectVariant({ filename: 'x.pdf', category: 'data quality' })).toBe('dataQuality');
        expect(detectVariant({ filename: 'x.pdf', category: 'comprehensive' })).toBe('radar');
    });

    test('a legacy row with no category falls back to the filename', () => {
        expect(
            detectVariant({
                filename: '4/20260214 24h Data Quality Assessment of SSR460XT - Telfer.pdf',
            })
        ).toBe('dataQuality');
        expect(detectVariant({ filename: '4/20260807 Daily Radar Report of SSR777XT.pdf' })).toBe(
            'radar'
        );
    });

    test('the window is read off the filename the modal wrote', () => {
        expect(
            detectSpan('4/20260214 24h Data Quality Assessment of SSR460XT - Telfer.pdf')
        ).toBe('24h');
        expect(detectSpan('4/20260214 7d Data Quality Assessment of SSR460XT - Telfer.pdf')).toBe(
            '7d'
        );
        expect(detectSpan('4/20260807 Comprehensive of SSR777XT.pdf')).toBeNull();
    });
});

describe('resolveSiteReports', () => {
    const radars = [
        { radarNumber: 'SSR777XT', status: 'Live' },
        { radarNumber: 'SSR925XT', status: 'Link Down' },
        { radarNumber: 'SSR778XT', status: 'Lost Connection' },
    ];

    test('matches a radar to its report by filename, case-insensitively', () => {
        const out = resolveSiteReports(radars, [
            {
                filename: '12/20260807 Daily Assessment of ssr777xt - Hidden Valley.pdf',
                date: '2026-08-07',
            },
        ]);
        expect(out.reportedRadars).toEqual(['SSR777XT']);
        expect(out.missingRadars).toEqual([
            { radarNumber: 'SSR925XT', status: 'Link Down' },
            { radarNumber: 'SSR778XT', status: 'Lost Connection' },
        ]);
        expect(out.attachments).toEqual([
            '12/20260807 Daily Assessment of ssr777xt - Hidden Valley.pdf',
        ]);
        expect(out.periodDate).toBe('2026-08-07');
    });

    test('the period comes from the report, not from the calendar', () => {
        const out = resolveSiteReports(
            radars,
            [{ filename: 'x/SSR777XT.pdf', date: '2026-08-05' }],
            '2026-08-07'
        );
        expect(out.periodDate).toBe('2026-08-05');
    });

    test('falls back when a legacy row carries no date', () => {
        const out = resolveSiteReports(
            radars,
            [{ filename: 'x/SSR777XT.pdf', date: null }],
            '2026-08-07'
        );
        expect(out.periodDate).toBe('2026-08-07');
    });

    test('one report per radar — a shared file is not attached twice', () => {
        const out = resolveSiteReports(
            [
                { radarNumber: 'SSR777XT', status: 'Live' },
                { radarNumber: 'SSR778XT', status: 'Live' },
            ],
            [{ filename: 'x/SSR777XT and SSR778XT.pdf', date: '2026-08-07' }]
        );
        expect(out.reportedRadars).toEqual(['SSR777XT', 'SSR778XT']);
        expect(out.attachments).toHaveLength(1);
    });

    test('no reports at all leaves nothing to send', () => {
        const out = resolveSiteReports(radars, []);
        expect(out.reportedRadars).toEqual([]);
        expect(out.missingRadars).toHaveLength(3);
    });

    test('carries the variant and window through from the matched reports', () => {
        const out = resolveSiteReports(
            [
                { radarNumber: 'SSR460XT', status: 'Live' },
                { radarNumber: 'SSR461XT', status: 'Live' },
            ],
            [
                {
                    filename: '4/20260214 24h Data Quality Assessment of SSR460XT - Telfer.pdf',
                    date: '2026-02-14',
                    category: 'data quality',
                },
                {
                    filename: '4/20260214 24h Data Quality Assessment of SSR461XT - Telfer.pdf',
                    date: '2026-02-14',
                    category: 'data quality',
                },
            ]
        );
        expect(out.variant).toBe('dataQuality');
        expect(out.span).toBe('24h');
    });

    test('a mixed day falls back to the radar wording rather than mislabelling', () => {
        const out = resolveSiteReports(
            [
                { radarNumber: 'SSR460XT', status: 'Live' },
                { radarNumber: 'SSR461XT', status: 'Live' },
            ],
            [
                { filename: 'x/SSR460XT.pdf', date: '2026-02-14', category: 'data quality' },
                { filename: 'x/SSR461XT.pdf', date: '2026-02-14', category: 'comprehensive' },
            ]
        );
        expect(out.variant).toBe('radar');
        expect(out.span).toBeNull();
    });

    test('yesterdayKey is the local day before', () => {
        expect(yesterdayKey(new Date(2026, 7, 8, 6, 0))).toBe('2026-08-07');
        expect(yesterdayKey(new Date(2026, 0, 1, 6, 0))).toBe('2025-12-31');
    });
});
