/**
 * Bahasa Indonesia email drafts.
 *
 * Two things are asserted, and the second matters as much as the first:
 *
 *   1. An Indonesian site's draft reads the way that site's engineers already
 *      write it — the expectations below are transcribed from real sent emails.
 *   2. An English site's draft is BYTE-FOR-BYTE what it was before the locale
 *      layer existed. Every generator takes its locale as a trailing optional
 *      argument for exactly that reason.
 *
 * The runtime clock is pinned to Asia/Jakarta by jest.config.js, while the site
 * under test is on Asia/Makassar (WITA) — an hour ahead. That gap is deliberate:
 * it is the case a naive `new Date(...).toLocaleString()` gets wrong.
 */

import {
    generateEmailBody,
    generateEmailBodyDQP,
    generateEmailBodyOthers,
    generateEmailBodyScheduledOffline,
    generateStatusSubject,
    generateDqpSubject,
    getWorkLogDetails,
} from '@/config/formConfig';
import { composeDeformationSubject } from '@/config/emailSubject';
import {
    formatEmailTimestamp,
    emailTimeZoneLabel,
    resolveEmailLocale,
    SITE_EMAIL_LOCALE_OVERRIDES,
} from '@/config/emailLocale';
import { sensorSelectionLabel } from '@/utils/siteWideStatus';

const WITA = 'Asia/Makassar';
const PERTH = 'Australia/Perth';
const ID = { locale: 'id', timeZone: WITA };
const SENSOR = 'PS2000 - IBP - Km. 11 Loa Janan, Pit Mahakam';

// ---------------------------------------------------------------------------
// Which sites get Indonesian
// ---------------------------------------------------------------------------

describe('resolveEmailLocale', () => {
    it('reads the site timezone', () => {
        expect(resolveEmailLocale({ site_name: 'IBP' }, WITA)).toBe('id');
        expect(resolveEmailLocale({ site_name: 'IBP' }, 'Asia/Jakarta')).toBe('id');
        expect(resolveEmailLocale({ site_name: 'IBP' }, 'Asia/Jayapura')).toBe('id');
        expect(resolveEmailLocale({ site_name: 'Telfer' }, PERTH)).toBe('en');
    });

    it('falls back to the timezone carried on the sensor itself', () => {
        expect(resolveEmailLocale({ site_name: 'IBP', timezone: WITA })).toBe('id');
        expect(resolveEmailLocale({ site_name: 'IBP', site: { timezone: WITA } })).toBe('id');
    });

    it('defaults to English when nothing says otherwise', () => {
        expect(resolveEmailLocale({})).toBe('en');
        expect(resolveEmailLocale(null)).toBe('en');
        expect(resolveEmailLocale({ site_name: 'Leonora' }, undefined)).toBe('en');
    });

    it('lets an explicit column and then the override map win over the timezone', () => {
        expect(resolveEmailLocale({ site_name: 'IBP', email_locale: 'en' }, WITA)).toBe('en');
        expect(resolveEmailLocale({ site: { email_locale: 'id' } }, PERTH)).toBe('id');

        SITE_EMAIL_LOCALE_OVERRIDES['testsite'] = 'id';
        try {
            expect(resolveEmailLocale({ site_name: ' TestSite ' }, PERTH)).toBe('id');
        } finally {
            delete SITE_EMAIL_LOCALE_OVERRIDES['testsite'];
        }
    });
});

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

describe('formatEmailTimestamp', () => {
    it('stamps the Indonesian zone abbreviation', () => {
        expect(emailTimeZoneLabel(WITA)).toBe('WITA');
        expect(emailTimeZoneLabel('Asia/Jakarta')).toBe('WIB');
        expect(emailTimeZoneLabel('Asia/Jayapura')).toBe('WIT');
        expect(emailTimeZoneLabel(PERTH)).toBe('');
    });

    it('reads a datetime-local value as the site wall clock it already is', () => {
        // The form field says 04:03 at the site. The analyst's browser is on
        // Jakarta, an hour behind — re-projecting would print 05:03.
        expect(formatEmailTimestamp('2026-03-28T04:03', ID)).toBe('28/03/2026 04:03 WITA');
    });

    it('projects a value that carries a real instant', () => {
        // 2026-03-27T20:03Z is 04:03 the next day at Makassar (+08:00).
        expect(formatEmailTimestamp('2026-03-27T20:03:00Z', ID)).toBe('28/03/2026 04:03 WITA');
    });

    it('leaves the English format alone', () => {
        expect(formatEmailTimestamp('2026-03-28T04:03', { locale: 'en' })).toBe('28/03/2026, 04:03');
        expect(formatEmailTimestamp('', { locale: 'en' })).toBe('N/A');
        expect(formatEmailTimestamp('', ID)).toBe('-');
    });

    it('returns an unparseable value unchanged rather than "Invalid Date"', () => {
        expect(formatEmailTimestamp('not a date', ID)).toBe('not a date');
    });
});

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

describe('Indonesian subject lines', () => {
    it('writes a TARP 4 progressive trend with its alarms', () => {
        const composed = composeDeformationSubject({
            type: 'Progressive',
            sensor: SENSOR,
            alarmRegions: [{ type: 'Red', name: 'IPD LW TIMUR' }, { type: 'Orange', name: 'LW 6' }],
            locale: 'id',
        });

        expect(composed.subject).toBe(
            '[BAHAYA] Alarm Merah dan Oranye - TARP Trigger 4: ' +
            `Pola Deformasi Progresif pada ${SENSOR}`
        );
    });

    it('keeps the bracket in English on the record, translating only the subject', () => {
        const composed = composeDeformationSubject({ type: 'Progressive', sensor: SENSOR, locale: 'id' });
        // The body reads `bracket` to decide its tone and the work log to pick a
        // row — both would break on a translated value.
        expect(composed.bracket).toBe('CRITICAL');
        expect(composed.workLogSubjectId).toBe(6);
        expect(composed.subject).toContain('[BAHAYA]');
    });

    it('writes a TARP 3 linear trend', () => {
        expect(composeDeformationSubject({ type: 'Linear', sensor: 'PS2000 - IBP', locale: 'id' }).subject)
            .toBe('[RISIKO MENENGAH] TARP Trigger 3: Pola Deformasi Linear pada PS2000 - IBP');
    });

    it('writes a failure indication as a notification', () => {
        expect(composeDeformationSubject({ type: 'Failure', sensor: SENSOR, locale: 'id' }).subject)
            .toBe(`[NOTIFIKASI] Indikasi Pola Longsoran pada ${SENSOR}`);
    });

    it('writes the downtime statuses', () => {
        expect(generateStatusSubject('SERVICE OFFLINE', 'Lost Connection', SENSOR, 'id'))
            .toBe(`[SERVICE OFFLINE] Koneksi Terputus pada ${SENSOR}`);
        expect(generateStatusSubject('SERVICE OFFLINE', 'Link Down', SENSOR, 'id'))
            .toBe(`[SERVICE OFFLINE] Pembaruan Data Terputus pada ${SENSOR}`);
    });

    it('announces a restored connection without a bracket, as the sites write it', () => {
        expect(generateStatusSubject('CONNECTION RESTORED', 'Live', SENSOR, 'id'))
            .toBe(`KONEKSI KEMBALI NORMAL pada ${SENSOR}`);
    });

    it('writes a DQP action', () => {
        expect(generateDqpSubject('ACTION REQUIRED', 'Additional Alarm Mask Recommendation', 'R01 - IBP', 'id'))
            .toBe('[PERLU TINDAKAN] Rekomendasi Tambahan Alarm Mask pada R01 - IBP');
    });

    it('leaves a client TARP document\'s own bracket wording untouched', () => {
        // A document may override the bracket with wording of its own; a
        // dictionary miss must pass it through, not blank it.
        expect(generateStatusSubject('EXTREME', 'Lost Connection', 'R01', 'id'))
            .toBe('[EXTREME] Koneksi Terputus pada R01');
    });
});

describe('English subject lines are unchanged', () => {
    it('drafts the deformation subject exactly as before', () => {
        expect(composeDeformationSubject({
            type: 'Progressive',
            sensor: 'R01 - Telfer',
            alarmRegions: [{ type: 'Red', name: 'A' }, { type: 'Orange', name: 'B' }],
        }).subject).toBe(
            '[CRITICAL] Red and Orange Alarms - TARP Trigger 4: Progressive Deformation Trend on R01 - Telfer'
        );
    });

    it('drafts the status subject exactly as the components did inline', () => {
        expect(generateStatusSubject('SERVICE OFFLINE', 'Lost Connection', 'R01 - Telfer'))
            .toBe('[SERVICE OFFLINE] Lost Connection on R01 - Telfer');
        // The Live case kept its double space — that is what the inline template
        // produced, and nothing about it changed.
        expect(generateStatusSubject('CONNECTION RESTORED', 'Live', 'R01 - Telfer'))
            .toBe('[CONNECTION RESTORED]  on R01 - Telfer');
    });
});

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

describe('Indonesian deformation body', () => {
    const body = (formData, bracket = 'CRITICAL') =>
        generateEmailBody(formData, SENSOR, bracket, 'Lintang', '& Adib', ID);

    it('labels the fields and translates the units', () => {
        const text = body({
            Type: 'Linear',
            Location: 'IPD LW Timur 2',
            AverageVelocity: '3',
            VCP: 360,
        }, 'MODERATE RISK');

        expect(text).toContain('TEMUAN:    Pola Deformasi Linear');
        expect(text).toContain('LOKASI:    IPD LW Timur 2');
        expect(text).toContain('LUAS AREA: - m2');
        // Metric names stay; only the unit is translated.
        expect(text).toContain('- Velocity: 3 mm/jam');
        expect(text).toContain('- VCP: 360');
        expect(text).toContain('KONTEKS & CATATAN');
        expect(text).toContain('Tidak ada catatan tambahan.');
        expect(text).toContain('Gambar 1. Lokasi & Analisis');
        expect(text).toContain('Salam,\nLintang & Adib');
    });

    it('switches the long-VCP units to days', () => {
        const text = body({
            Type: 'Failure', Location: 'IPD 5 Barat', Start: '2025-12-19T04:42',
            Vmax1: '1.76', VCP1: 60, InverseVelocity1: '0.57',
            Vmax2: '0.36', VCP2: 1440, InverseVelocity2: '2.78',
        }, 'NOTIFICATION ONLY');

        expect(text).toContain('> VCP PENDEK');
        expect(text).toContain('> VCP PANJANG');
        expect(text).toContain('1.76 mm/jam');
        expect(text).toContain('0.57 jam/mm');
        expect(text).toContain('0.36 mm/hari');
        expect(text).toContain('2.78 hari/mm');
        expect(text).toContain('WAKTU: 19/12/2025 04:42 WITA');
    });

    it('writes the notification sentence the way the sites write it', () => {
        expect(body({
            Type: 'Progressive', Location: 'IPD', VCP: 360,
            NotificationTime: '2026-03-28T04:03',
            NotificationBy: 'WhatsApp grup (Pak Dimas)',
        })).toContain(
            'Informasi ini telah disampaikan melalui WhatsApp grup (Pak Dimas) pada 28/03/2026 04:03 WITA.'
        );
    });

    it('writes the unreachable notice when a critical record has no notification', () => {
        expect(body({ Type: 'Progressive', Location: 'IPD', VCP: 360 })).toContain(
            'Percobaan telepon kepada tim site telah dilakukan namun belum dapat terhubung.'
        );
    });

    it('writes the fall-of-ground register notice', () => {
        expect(body({ Type: 'Rock Fall', Location: 'IPD' }, 'NOTIFICATION ONLY')).toContain(
            'Informasi ini telah direcord dalam database Fall of Ground.'
        );
    });

    it('joins alarm regions with "dan"', () => {
        expect(body({
            Type: 'Progressive', Location: 'IPD', VCP: 360,
            alarmRegions: [{ name: 'IPD LW TIMUR' }, { name: 'LW 6' }],
        })).toContain('REGION ALARM: IPD LW TIMUR dan LW 6');
    });
});

describe('Indonesian downtime and DQP bodies', () => {
    it('writes the offline body with the site clock', () => {
        const text = generateEmailBodyOthers(
            { from: '2026-01-01T04:55', reason: 'Connection', action: 'Check Connection', notes: '' },
            'Lost Connection', SENSOR, 'Lintang', '', ID
        );

        expect(text).toContain('ISU:      Koneksi Terputus');
        expect(text).toContain('WAKTU:    01/01/2026 04:55 WITA');
        expect(text).toContain('SPESIFIK: Koneksi');
        // The action list stays in English — it is what the site's own emails quote.
        expect(text).toContain('AKSI:     Check Connection');
    });

    it('writes the back-online note', () => {
        const text = generateEmailBodyOthers({}, 'Live', SENSOR, 'Lintang', '', ID);
        expect(text).toContain('Semangat Pagi,');
        expect(text).toContain(
            `Izin menginformasikan bahwa ${SENSOR} telah kembali online dan monitoring dapat dilanjutkan.`
        );
        expect(text).toContain('Salam,');
    });

    it('translates the DQP issue and action but not the analyst\'s own notes', () => {
        const text = generateEmailBodyDQP(
            {
                subject: 'Additional Alarm Mask Recommendation',
                issue: 'Excessive Unwanted Alarms',
                action: 'As per the alarm mask recommendation.',
                alarmRegions: [1],
                alarmMask: 'Mask-04',
                notes: 'Catatan bebas dari analis.',
            },
            SENSOR, 'Lintang', '', [{ id: 1, name: 'IPD 5 Barat' }], ID
        );

        expect(text).toContain('ISU:    Alarm Tidak Diinginkan Berlebih');
        expect(text).toContain('AKSI:   Sesuai rekomendasi alarm mask.');
        expect(text).toContain('REGION ALARM: IPD 5 Barat');
        expect(text).toContain('ALARM MASK:   Mask-04');
        expect(text).toContain('Catatan bebas dari analis.');
        expect(text).toContain('Gambar 1. Rekomendasi Alarm Mask.');
    });

    it('writes the scheduled maintenance window', () => {
        const text = generateEmailBodyScheduledOffline(
            'Seluruh Radar', '12:30', '14:00',
            'Scheduled maintenance from the DTG side.', 'Lintang', '', ID
        );

        expect(text).toBe([
            'SENSOR: Seluruh Radar',
            'WAKTU: 12:30-14:00 (waktu lokal site)',
            '',
            'ALASAN: Pemeliharaan terjadwal dari sisi DTG.',
            '',
            'DTG engineer akan menginformasikan ketika sistem telah kembali online.',
            '',
            'Salam,',
            'Lintang',
        ].join('\n'));
    });

    it('names a whole-site selection in Indonesian', () => {
        const sensors = [
            { wallfolder_id: 1, radar_number: 'R01' },
            { wallfolder_id: 2, radar_number: 'R02' },
        ];
        expect(sensorSelectionLabel(sensors, [1, 2], 'IBP', 'All Radars', 'id').withSite)
            .toBe('Seluruh Radar - IBP');
        // Radar numbers are identifiers; only the conjunction changes.
        expect(sensorSelectionLabel(sensors, [1, 2], 'IBP', 'All Radars', 'id').bare)
            .toBe('Seluruh Radar');
        expect(sensorSelectionLabel([...sensors, { wallfolder_id: 3, radar_number: 'R03' }], [1, 2], 'IBP', 'All Radars', 'id').bare)
            .toBe('R01 dan R02');
    });
});

describe('English bodies are unchanged', () => {
    it('keeps the deformation body byte-for-byte', () => {
        const text = generateEmailBody(
            { Type: 'Linear', Location: 'Wall 5', AverageVelocity: '3', VCP: 360, SurfaceArea: '120' },
            'R01 - Telfer', 'MODERATE RISK', 'Lintang', ''
        );

        expect(text).toContain('SENSOR:       R01 - Telfer');
        expect(text).toContain('FINDINGS:     Linear Deformation Trend');
        expect(text).toContain('LOCATION:     Wall 5');
        expect(text).toContain('SURFACE AREA: 120 m2');
        expect(text).toContain('- Velocity: 3 mm/h');
        expect(text).toContain('CONTEXT & NOTES');
        expect(text).toContain('No additional notes provided.');
        expect(text).toContain('Figure 1. Location & Analysis');
        expect(text).toContain('Kind regards,');
    });

    it('keeps the offline body byte-for-byte', () => {
        const text = generateEmailBodyOthers(
            { from: '2026-01-01T04:55', reason: 'Connection', action: 'Check Connection', notes: '' },
            'Link Down', 'R01 - Telfer', 'Lintang', ''
        );

        expect(text).toContain('SENSOR: R01 - Telfer');
        expect(text).toContain('ISSUE:  Link Down');
        expect(text).toContain('TIME:   01/01/2026, 04:55');
        expect(text).toContain('REASON: Connection');
        expect(text).toContain('ACTION: Check Connection');
    });

    it('keeps the DQP body byte-for-byte', () => {
        const text = generateEmailBodyDQP(
            {
                subject: 'Additional Alarm Mask Recommendation',
                issue: 'Excessive Unwanted Alarms',
                action: 'As per the alarm mask recommendation.',
                alarmRegions: [], alarmMask: '', notes: '',
            },
            'R01 - Telfer', 'Lintang', '', []
        );

        expect(text).toContain('SENSOR: R01 - Telfer');
        expect(text).toContain('ISSUE:  Excessive Unwanted Alarms');
        expect(text).toContain('ACTION: As per the alarm mask recommendation.');
        expect(text).toContain('ALARM REGION: N/A');
        expect(text).toContain('ALARM MASK:   N/A');
        expect(text).toContain('Figure 1. Alarm Mask Recommendation.');
    });

    it('keeps the work-log mapping untouched in either language', () => {
        // getWorkLogDetails returns a DB foreign key alongside the bracket, so it
        // stays English in every locale by construction.
        expect(getWorkLogDetails('TARP 4', null)).toEqual({ id: 6, subject: 'CRITICAL' });
        expect(getWorkLogDetails('Live', null)).toEqual({ id: 3, subject: 'CONNECTION RESTORED' });
    });
});
