/**
 * The pure parts of the site-wide status flows (Lost Connection / Scheduled
 * Offline): how a selection is named in the email, how the maintenance window
 * is converted into the site's clock, and which downtime write each ticked wall
 * folder receives.
 */

import {
    ALL_SELECTED_LABEL,
    defaultOfflineWindow,
    isSiteWideStatus,
    planDowntimeWrites,
    sensorSelectionLabel,
    siteLocalTimeFromUserLocal,
} from '@/utils/siteWideStatus';
import { generateEmailBodyScheduledOffline } from '@/config/formConfig';

const sensors = [
    { wallfolder_id: 1, radar_number: 'RADAR-01', area: 'North' },
    { wallfolder_id: 2, radar_number: 'RADAR-02', area: 'South' },
    { wallfolder_id: 3, radar_number: 'RADAR-03', area: 'East' },
];

describe('isSiteWideStatus', () => {
    it('routes only Lost Connection and Scheduled Offline to the multi-sensor flow', () => {
        expect(isSiteWideStatus('Lost Connection')).toBe(true);
        expect(isSiteWideStatus('Scheduled Offline')).toBe(true);
        expect(isSiteWideStatus('Link Down')).toBe(false);
        expect(isSiteWideStatus('Live')).toBe(false);
    });
});

describe('sensorSelectionLabel', () => {
    it('names a full selection with the status wording plus the site', () => {
        const label = sensorSelectionLabel(sensors, [1, 2, 3], 'Telfer', ALL_SELECTED_LABEL['Scheduled Offline']);
        expect(label.bare).toBe('All Radars');
        expect(label.withSite).toBe('All Radars - Telfer');
    });

    it('uses the Lost Connection wording for that status', () => {
        const label = sensorSelectionLabel(sensors, [1, 2, 3], 'Telfer', ALL_SELECTED_LABEL['Lost Connection']);
        expect(label.withSite).toBe('All Sensors - Telfer');
    });

    it('quotes a single sensor by its radar number', () => {
        const label = sensorSelectionLabel(sensors, [2], 'Telfer', 'All Radars');
        expect(label.bare).toBe('RADAR-02');
        expect(label.withSite).toBe('RADAR-02 - Telfer');
    });

    it('joins a partial selection', () => {
        const label = sensorSelectionLabel(sensors, [1, 3], 'Telfer', 'All Radars');
        expect(label.bare).toMatch(/RADAR-01/);
        expect(label.bare).toMatch(/RADAR-03/);
        expect(label.bare).not.toMatch(/RADAR-02/);
    });

    it('collapses two wall folders of one radar into a single name', () => {
        const twoFolders = [
            { wallfolder_id: 10, radar_number: 'RADAR-01' },
            { wallfolder_id: 11, radar_number: 'RADAR-01' },
            { wallfolder_id: 12, radar_number: 'RADAR-02' },
        ];
        expect(sensorSelectionLabel(twoFolders, [10, 11], 'Telfer', 'All Radars').bare).toBe('RADAR-01');
    });

    it('tolerates id types differing between the row and the selection', () => {
        expect(sensorSelectionLabel(sensors, ['2'], 'Telfer', 'All Radars').bare).toBe('RADAR-02');
    });

    it('falls back to the all-label when nothing is ticked', () => {
        expect(sensorSelectionLabel(sensors, [], 'Telfer', 'All Radars').bare).toBe('All Radars');
    });
});

describe('siteLocalTimeFromUserLocal', () => {
    // Anchored to a fixed instant, and to an explicit analyst zone, so the
    // assertions do not move with the calendar or with the machine.
    const anchor = new Date('2026-07-30T02:00:00Z');
    const JAKARTA = 'Asia/Jakarta';

    it('reads the analyst wall clock as the site wall clock', () => {
        // The engineer says 11:30 in Jakarta (+07:00); Telfer (+08:00) reads 12:30.
        expect(siteLocalTimeFromUserLocal('11:30', 'Australia/Perth', anchor, JAKARTA)).toBe('12:30');
        expect(siteLocalTimeFromUserLocal('13:00', 'Australia/Perth', anchor, JAKARTA)).toBe('14:00');
    });

    it('is the identity when the site shares the analyst clock', () => {
        expect(siteLocalTimeFromUserLocal('11:30', JAKARTA, anchor, JAKARTA)).toBe('11:30');
    });

    it('runs backwards for a site behind the analyst', () => {
        expect(siteLocalTimeFromUserLocal('11:30', 'UTC', anchor, JAKARTA)).toBe('04:30');
    });

    it('wraps across midnight rather than clamping', () => {
        // 23:30 in Jakarta is already the next day at Telfer.
        expect(siteLocalTimeFromUserLocal('23:30', 'Australia/Perth', anchor, JAKARTA)).toBe('00:30');
    });

    it('pads a single-digit hour', () => {
        expect(siteLocalTimeFromUserLocal('9:05', JAKARTA, anchor, JAKARTA)).toBe('09:05');
    });

    it('returns empty for an unparseable time', () => {
        expect(siteLocalTimeFromUserLocal('', 'Australia/Perth', anchor, JAKARTA)).toBe('');
        expect(siteLocalTimeFromUserLocal('not-a-time', 'Australia/Perth', anchor, JAKARTA)).toBe('');
    });

    it('defaultOfflineWindow seeds the picker with 11:30-13:00 in site time', () => {
        expect(defaultOfflineWindow('Australia/Perth', anchor, JAKARTA)).toEqual({
            from: '12:30',
            to: '14:00',
        });
    });

    it('defaultOfflineWindow keeps the 90-minute span whatever the site zone', () => {
        const minutes = (hhmm) => {
            const [h, m] = hhmm.split(':').map(Number);
            return h * 60 + m;
        };
        ['UTC', 'Australia/Perth', 'America/Denver', 'Africa/Johannesburg'].forEach((tz) => {
            const { from, to } = defaultOfflineWindow(tz, anchor, JAKARTA);
            expect((minutes(to) - minutes(from) + 1440) % 1440).toBe(90);
        });
    });
});

describe('planDowntimeWrites', () => {
    it('inserts for every folder with nothing open', () => {
        const plan = planDowntimeWrites([1, 2, 3], [], 'Lost Connection');
        expect(plan.insertFolders).toEqual([1, 2, 3]);
        expect(plan.closeIds).toEqual([]);
        expect(plan.updates).toEqual([]);
    });

    it('edits in place when the same status is already open', () => {
        const open = [{ id: 99, wallfolder: 2, type: 'Lost Connection', from: '2026-07-30T01:00:00Z' }];
        const plan = planDowntimeWrites([1, 2], open, 'Lost Connection');
        expect(plan.updates).toEqual([{ id: 99, wallfolder: 2 }]);
        expect(plan.insertFolders).toEqual([1]);
        expect(plan.closeIds).toEqual([]);
    });

    it('closes a different open failure and opens the new one', () => {
        const open = [{ id: 77, wallfolder: 3, type: 'Link Down', from: '2026-07-30T01:00:00Z' }];
        const plan = planDowntimeWrites([3], open, 'Lost Connection');
        expect(plan.closeIds).toEqual([77]);
        expect(plan.insertFolders).toEqual([3]);
        expect(plan.updates).toEqual([]);
    });

    it('takes the latest open record when a folder has more than one', () => {
        const open = [
            { id: 1, wallfolder: 5, type: 'Link Down', from: '2026-07-01T00:00:00Z' },
            { id: 2, wallfolder: 5, type: 'Lost Connection', from: '2026-07-29T00:00:00Z' },
        ];
        const plan = planDowntimeWrites([5], open, 'Lost Connection');
        expect(plan.updates).toEqual([{ id: 2, wallfolder: 5 }]);
        expect(plan.closeIds).toEqual([]);
    });

    it('ignores open records for folders that were not ticked', () => {
        const open = [{ id: 42, wallfolder: 9, type: 'Link Down', from: '2026-07-30T01:00:00Z' }];
        const plan = planDowntimeWrites([1], open, 'Lost Connection');
        expect(plan.closeIds).toEqual([]);
        expect(plan.insertFolders).toEqual([1]);
    });
});

describe('generateEmailBodyScheduledOffline', () => {
    it('matches the notification template', () => {
        const body = generateEmailBodyScheduledOffline(
            'All Radars',
            '12:30',
            '14:00',
            'Scheduled maintenance from the DTG side.',
            'Lintang',
            ''
        );

        expect(body).toBe(
            [
                'SENSOR: All Radars',
                'TIME: 12:30-14:00 (site local time)',
                '',
                'REASON: Scheduled maintenance from the DTG side.',
                '',
                'DTG engineers will advise when the system is back online.',
                '',
                'Kind regards,',
                'Lintang',
            ].join('\n')
        );
    });

    it('appends a crosschecker when one is chosen', () => {
        const body = generateEmailBodyScheduledOffline(
            'RADAR-01', '12:30', '14:00', 'Reason.', 'Lintang', '& Adib Izzuddin'
        );
        expect(body).toContain('Lintang & Adib Izzuddin');
    });
});
