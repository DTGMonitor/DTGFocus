/**
 * Timestamps rendered on the SITE's clock rather than the viewer's.
 *
 * Jest pins the runtime to Asia/Jakarta (see jest.config.js), which is exactly
 * the case these tests need: the monitoring team sits at UTC+7 while the radar
 * they are watching is at UTC+10. A formatter built on getHours() passes
 * nothing here — it would answer in Jakarta time — so the runtime is part of
 * the assertion, not incidental to it.
 */

import { formatSiteDateTime } from '@/utils/siteTime';

describe('formatSiteDateTime', () => {
    it('renders a Port Moresby instant on the site clock, not the runtime one', () => {
        // 23:41 UTC is 09:41 the NEXT day in Port Moresby, and 06:41 in Jakarta.
        expect(formatSiteDateTime('2026-09-29T23:41:00Z', 'Pacific/Port_Moresby'))
            .toBe('09:41, 30 Sep 2026');
    });

    it('rolls the date as well as the time', () => {
        // Still 29 Sep in Jakarta, already 30 Sep at the site.
        expect(formatSiteDateTime('2026-09-29T16:00:00Z', 'Pacific/Port_Moresby'))
            .toBe('02:00, 30 Sep 2026');
    });

    it('renders a Perth site in Perth time', () => {
        expect(formatSiteDateTime('2026-09-29T23:41:00Z', 'Australia/Perth'))
            .toBe('07:41, 30 Sep 2026');
    });

    it('agrees with the runtime only when the site shares its zone', () => {
        expect(formatSiteDateTime('2026-09-29T23:41:00Z', 'Asia/Jakarta'))
            .toBe('06:41, 30 Sep 2026');
    });

    it('falls back to UTC rather than to the viewer when a site has no timezone', () => {
        expect(formatSiteDateTime('2026-09-29T23:41:00Z', null)).toBe('23:41, 29 Sep 2026');
        expect(formatSiteDateTime('2026-09-29T23:41:00Z', undefined)).toBe('23:41, 29 Sep 2026');
    });

    it('keeps the card readable when there is nothing to show', () => {
        expect(formatSiteDateTime(null, 'Australia/Perth')).toBe('N/A');
        expect(formatSiteDateTime('', 'Australia/Perth')).toBe('N/A');
        expect(formatSiteDateTime('not a date', 'Australia/Perth')).toBe('not a date');
    });

    it('pads single digits so the column stays aligned', () => {
        expect(formatSiteDateTime('2026-01-04T22:05:00Z', 'Pacific/Port_Moresby'))
            .toBe('08:05, 05 Jan 2026');
    });
});
