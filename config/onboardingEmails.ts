// onboardingEmails.ts
//
// The draft each onboarding step hands to Outlook, in the language the site is
// emailed in.
//
// Every generator returns `{ subject, body }` and writes nothing — the same
// contract the deformation and status drafts already keep, because the app has
// never sent mail. `openOutlookDraft` opens the draft, the engineer reads it,
// and the engineer sends it. See utils/openOutlookDraft.ts.
//
// The wording is DTG's own onboarding correspondence, kept close enough to the
// thread it came from that an engineer recognises it: a short list of what is
// attached, the running checklist with its ticks, and a numbered list of what
// is being asked of the site. The checklist is reprinted in EVERY draft on
// purpose — it is what tells a client three weeks in why they are being emailed
// again and what is left.
//
// LOCALE. Which language a site is emailed in is decided by
// config/emailLocale.ts — `resolveEmailLocale`, the same resolution the
// deformation and downtime drafts use, so a site does not receive its alarms in
// Bahasa Indonesia and its onboarding in English. Subject brackets and
// timestamps are reused from that module too.
//
// The onboarding SENTENCES live here rather than in `EmailStrings`, because
// they are whole paragraphs and numbered lists particular to this flow, not the
// field labels and fragments that module's dictionary is built from. The two
// rules from emailLocale still hold:
//
//   * Prose, labels and brackets translate.
//   * Product and process names do not — TARP, DSRA, TeamViewer Tensor, alarm
//     mask, wall folder, PO. They are what a site engineer already reads on the
//     radar software and in the contract.
//
// The Onboarding TAB stays in English in both cases. It is a DTG-internal
// console; only what reaches the client is translated.

import {
    ONBOARDING_STEPS,
    contactChannelValue,
    describeContact,
    isReachable,
    isStepDone,
    summariseTrial,
    type ContactTestRow,
    type OnboardingRow,
    type OnboardingStepKey
} from './onboarding';
import { formatEmailTimestamp, translateBracket, type EmailLocale } from './emailLocale';

export interface OnboardingDraft {
    subject: string;
    body: string;
}

export interface OnboardingEmailContext {
    /** "Leonora". */
    siteName: string;
    /** "Genesis Minerals". */
    company?: string | null;
    /** "Leonora, WA". */
    location?: string | null;
    /** Radar numbers being commissioned, e.g. ['MSR254']. */
    radars?: string[];
    /** The DTG engineer running the onboarding — signs the draft. */
    engineerName?: string | null;
    engineerRole?: string | null;
    engineerPhone?: string | null;
    engineerEmail?: string | null;
    /** The onboarding, for the running checklist every draft reprints. */
    onboarding?: OnboardingRow | null;
    /** Contact trial results, for the two trial drafts. */
    tests?: ContactTestRow[] | null;
    /** Free-text the engineer typed into the step, appended as notes. */
    notes?: string | null;
    /** Step payload — latency, licence link, commencement time and so on. */
    payload?: Record<string, unknown> | null;
    /** Which language to write in. Defaults to English. */
    locale?: EmailLocale;
    /** The SITE's IANA zone, for the commencement timestamp. */
    timeZone?: string | null;
}

// ---------------------------------------------------------------------------
// The wording
// ---------------------------------------------------------------------------

interface OnboardingStrings {
    // Openers and closings.
    greeting: string;
    signOff: string;
    nameFallback: string;
    roleFallback: string;
    notesLabel: string;

    /** The checklist's step names. Deliberately apart from the tab's labels. */
    stepLabels: Record<OnboardingStepKey, string>;
    /** " <-- we are here" against the step being drafted. */
    hereMarker: string;
    checklistIntro: string;
    whereWeAre: string;

    // Contact-trial verdicts, and the shift a contact was tested on.
    results: Record<string, string>;
    dayShift: string;
    nightShift: string;
    noContacts: string;
    reachedHeading: (reached: number, total: number) => string;
    none: string;
    notReachedHeading: string;
    notTestedHeading: string;
    phoneCoverageShortfall: string;
    emailCoverageShortfall: string;

    // Step 1 — administration.
    adminSubject: string;
    adminOpening: (radars: string, site: string) => string;
    adminAttached: string;
    adminAttachments: string[];
    adminSequence: string;
    adminAsk: string;
    adminItems: string[];
    adminClosing: string;

    // Step 2 — remote connection.
    connectionSubject: string;
    connectionOpening: string;
    connectionAsk: string;
    connectionItems: (radars: string, workstation: string) => string[];
    connectionLicenceLink: (link: string) => string;
    connectionLicenceFollows: string;
    connectionClosing: string;

    // Step 3 — communication trial.
    commsSubject: string;
    commsOpening: string;
    commsClean: string;
    commsAction: string;

    // Step 4 — email trial.
    emailSubject: string;
    emailOpening: string;
    emailAsk: string;
    emailStatus: string;

    // Step 5 — system readiness.
    readinessSubject: string;
    readinessOpening: (radars: string) => string;
    readinessConfirmedHeading: string;
    readinessConfirmed: string[];
    readinessClosing: string;

    // Step 6 — live commencement.
    commencementSubject: string;
    commencementOpening: (radars: string, site: string, when: string) => string;
    commencementComplete: string;
    commencementRecordHeading: string;
    commencementPhone: (reached: number, total: number) => string;
    commencementEmail: (confirmed: number, total: number) => string;
    commencementNext: string;
    commencementItems: string[];
    commencementThanks: string;

    // Fallbacks.
    theRadar: string;
    theSite: string;
    and: string;
}

const EN: OnboardingStrings = {
    greeting: 'Hi Team,',
    signOff: 'Kind regards,',
    nameFallback: '[Your name]',
    roleFallback: 'Geotechnical Engineer',
    notesLabel: 'Notes:',

    stepLabels: {
        administration: 'Administration',
        remote_connection: 'Remote Connection Test',
        communication_trial: 'Communication Trial',
        email_trial: 'Email Trial',
        system_readiness: 'System Readiness',
        live_commencement: 'Live Commencement'
    },
    hereMarker: '  <-- we are here',
    checklistIntro: 'The sequence from here:',
    whereWeAre: 'Where we are:',

    results: {
        pending: 'Not yet tested',
        reachable: 'Reachable',
        no_answer: 'No answer',
        unreachable: 'Unreachable',
        wrong_details: 'Wrong details'
    },
    dayShift: 'day shift',
    nightShift: 'night shift',
    noContacts: 'No contacts were listed for this trial.',
    reachedHeading: (reached, total) => `Contacts we reached (${reached} of ${total}):`,
    none: '  - none',
    notReachedHeading: 'Contacts we could NOT reach — these need your attention:',
    notTestedHeading: 'Not yet tested:',
    phoneCoverageShortfall:
        'At this point the escalation path does not yet meet the minimum of two reachable phone levels. Please confirm replacement numbers so we can retest before commencement.',
    emailCoverageShortfall:
        'No address on the distribution list has confirmed delivery yet. Please check junk and quarantine filters, and whitelist the DTG sending domain.',

    adminSubject: 'Onboarding: Acknowledgement, TARP and Contacts',
    adminOpening: (radars, site) =>
        `Thank you again for engaging DTG for remote monitoring of ${radars} at ${site}. We are at the administration stage of onboarding.`,
    adminAttached: 'Attached:',
    adminAttachments: [
        'Radar Risk and Limitations document',
        'Radar brand limitation document',
        'Proposed DTG Radar TARP'
    ],
    adminSequence: 'The sequence from here:',
    adminAsk: 'Three things are needed from your side:',
    adminItems: [
        'ACKNOWLEDGEMENT — the limitations documents form part of our conditions of service delivery. Could the accountable site engineer reply to this email confirming they have reviewed and acknowledged both?',
        'TARP CONTACTS — for day shift and night shift: geotechnical on-call (24/7), dispatch, the email distribution list, and the escalation path if no phone contact is reachable (at least two phone levels).',
        'TARP REVIEW — a short meeting to walk through the proposed TARP and make it specific to the pit being monitored. Please let us know a time that suits.'
    ],
    adminClosing: 'Once these are settled we move to the remote connection test.',

    connectionSubject: 'Onboarding: Remote Connection Test',
    connectionOpening:
        'The administration stage is settled — thank you. Next is the remote connection test.',
    connectionAsk: 'What we need:',
    connectionItems: (radars, workstation) => [
        'IT approval to remote into the monitoring workstation, if that has not already been given.',
        `Install the preconfigured remote-access licence file on the workstation connected to ${radars}${workstation}. It is fully preconfigured — it only needs to be installed.`,
        'Once installed, let us know and we will run the connection test and latency check from our end.'
    ],
    connectionLicenceLink: (link) => `Download link: ${link}`,
    connectionLicenceFollows:
        'The licence file link follows in a separate email from our IT team.',
    connectionClosing:
        'The connection is read-only for monitoring purposes and does not alter your radar configuration without your engineer present.',

    commsSubject: 'Onboarding: Communication Trial Results',
    commsOpening: 'We have run the trial calls against the TARP contact list. Results below.',
    commsClean:
        'The escalation path is confirmed working. No action is needed from your side on this step.',
    commsAction:
        'Please confirm corrected numbers, or nominate alternates, for the contacts above. We will retest and update the TARP contact list.',

    emailSubject: 'Onboarding: Email Trial',
    emailOpening:
        'This is the onboarding test notification for the radar monitoring distribution list. It is a trial only — no deformation has been detected and no response is required under the TARP.',
    emailAsk:
        'Could each recipient reply to confirm this arrived in their inbox rather than junk or quarantine? DTG alarm notifications are time-critical, so a filtered address is the same as an unreachable one.',
    emailStatus: 'Delivery status so far:',

    readinessSubject: 'Onboarding: System Readiness',
    readinessOpening: (radars) =>
        `${radars} is now configured on our monitoring dashboard and we have completed our readiness checks.`,
    readinessConfirmedHeading: 'Confirmed on our side:',
    readinessConfirmed: [
        'Radar and its live wall folder created',
        'Data quality parameters seeded and reviewed against the scan',
        'Alarm regions and masks configured on the radar software',
        'TARP document loaded and set to active',
        'Daily report template and distribution confirmed'
    ],
    readinessClosing:
        'If anything above does not match your expectation — particularly the alarm regions, the TARP thresholds or who receives the daily report — please tell us before commencement rather than after.',

    commencementSubject: 'Live Monitoring Commencement',
    commencementOpening: (radars, site, when) =>
        `Formal remote monitoring of ${radars} at ${site} has now commenced${when}.`,
    commencementComplete: 'Onboarding is complete:',
    commencementRecordHeading: 'For the record, as tested during onboarding:',
    commencementPhone: (reached, total) =>
        `  - Phone escalation: ${reached} of ${total} contacts reachable`,
    commencementEmail: (confirmed, total) =>
        `  - Email distribution: ${confirmed} of ${total} addresses confirmed`,
    commencementNext: 'From here:',
    commencementItems: [
        'Our engineers monitor the radar on shift and respond per the agreed TARP.',
        'You receive a daily report, and immediate notification of any TARP trigger.',
        'Any change to your TARP contacts should be sent to us so the escalation path stays current.'
    ],
    commencementThanks: 'Thank you for your assistance through the onboarding.',

    theRadar: 'the radar',
    theSite: 'the site',
    and: 'and'
};

// The Indonesian wording follows the register DTG's Indonesian sites already
// receive — "Semangat Pagi," to open, "Salam," to close, and "Izin
// menginformasikan…" where an English draft would say "Please be advised".
// Product and process names stay as the site reads them on the radar software
// and in the contract: TARP, alarm mask, wall folder, TeamViewer Tensor, PO.
const ID: OnboardingStrings = {
    greeting: 'Semangat Pagi,',
    signOff: 'Salam,',
    nameFallback: '[Nama Anda]',
    roleFallback: 'Geotechnical Engineer',
    notesLabel: 'Catatan:',

    stepLabels: {
        administration: 'Administrasi',
        remote_connection: 'Uji Koneksi Remote',
        communication_trial: 'Uji Komunikasi',
        email_trial: 'Uji Email',
        system_readiness: 'Kesiapan Sistem',
        live_commencement: 'Dimulainya Monitoring'
    },
    hereMarker: '  <-- tahap saat ini',
    checklistIntro: 'Tahapan selanjutnya:',
    whereWeAre: 'Posisi saat ini:',

    results: {
        pending: 'Belum diuji',
        reachable: 'Dapat dihubungi',
        no_answer: 'Tidak diangkat',
        unreachable: 'Tidak dapat dihubungi',
        wrong_details: 'Data tidak sesuai'
    },
    dayShift: 'shift siang',
    nightShift: 'shift malam',
    noContacts: 'Tidak ada kontak yang terdaftar untuk pengujian ini.',
    reachedHeading: (reached, total) => `Kontak yang berhasil dihubungi (${reached} dari ${total}):`,
    none: '  - tidak ada',
    notReachedHeading: 'Kontak yang TIDAK dapat dihubungi — mohon perhatian:',
    notTestedHeading: 'Belum diuji:',
    phoneCoverageShortfall:
        'Sampai saat ini jalur eskalasi belum memenuhi minimum dua level kontak telepon yang dapat dihubungi. Mohon konfirmasi nomor pengganti agar dapat kami uji ulang sebelum monitoring dimulai.',
    emailCoverageShortfall:
        'Belum ada alamat pada daftar distribusi yang mengonfirmasi penerimaan. Mohon periksa folder junk dan quarantine, serta whitelist domain pengirim DTG.',

    adminSubject: 'Onboarding: Konfirmasi, TARP dan Kontak',
    adminOpening: (radars, site) =>
        `Terima kasih telah mempercayakan layanan remote monitoring ${radars} di ${site} kepada DTG. Saat ini kami berada pada tahap administrasi onboarding.`,
    adminAttached: 'Terlampir:',
    adminAttachments: [
        'Dokumen Radar Risk and Limitations',
        'Dokumen limitasi radar sesuai merek',
        'Usulan DTG Radar TARP'
    ],
    adminSequence: 'Tahapan selanjutnya:',
    adminAsk: 'Terdapat tiga hal yang kami perlukan dari sisi site:',
    adminItems: [
        'KONFIRMASI — dokumen limitasi merupakan bagian dari ketentuan penyediaan layanan kami. Mohon site engineer yang bertanggung jawab membalas email ini sebagai konfirmasi bahwa kedua dokumen telah ditinjau dan disetujui.',
        'KONTAK TARP — untuk shift siang dan shift malam: geotechnical on-call (24/7), dispatch, daftar distribusi email, serta jalur eskalasi apabila tidak ada kontak telepon yang dapat dihubungi (minimal dua level telepon).',
        'TINJAUAN TARP — pertemuan singkat untuk membahas usulan TARP agar sesuai dengan pit yang dimonitor. Mohon informasikan waktu yang sesuai.'
    ],
    adminClosing:
        'Setelah ketiganya selesai, kami lanjutkan ke tahap uji koneksi remote.',

    connectionSubject: 'Onboarding: Uji Koneksi Remote',
    connectionOpening:
        'Tahap administrasi telah selesai — terima kasih. Tahap berikutnya adalah uji koneksi remote.',
    connectionAsk: 'Yang kami perlukan:',
    connectionItems: (radars, workstation) => [
        'Persetujuan tim IT site untuk akses remote ke workstation monitoring, apabila belum diberikan.',
        `Instalasi file lisensi remote access yang telah dikonfigurasi pada workstation yang terhubung dengan ${radars}${workstation}. File tersebut sudah terkonfigurasi penuh — hanya perlu diinstal.`,
        'Setelah terinstal, mohon informasikan kepada kami agar uji koneksi dan pengukuran latency dapat kami jalankan dari sisi DTG.'
    ],
    connectionLicenceLink: (link) => `Tautan unduh: ${link}`,
    connectionLicenceFollows:
        'Tautan file lisensi akan menyusul pada email terpisah dari tim IT kami.',
    connectionClosing:
        'Koneksi ini bersifat read-only untuk keperluan monitoring dan tidak mengubah konfigurasi radar tanpa didampingi engineer site.',

    commsSubject: 'Onboarding: Hasil Uji Komunikasi',
    commsOpening:
        'Kami telah melakukan uji panggilan terhadap daftar kontak TARP. Berikut hasilnya.',
    commsClean:
        'Jalur eskalasi telah terkonfirmasi berfungsi. Tidak ada tindakan yang diperlukan dari sisi site pada tahap ini.',
    commsAction:
        'Mohon konfirmasi nomor yang benar, atau tunjuk kontak pengganti, untuk kontak di atas. Kami akan menguji ulang dan memperbarui daftar kontak TARP.',

    emailSubject: 'Onboarding: Uji Email',
    emailOpening:
        'Email ini merupakan notifikasi uji coba onboarding untuk daftar distribusi radar monitoring. Bersifat pengujian saja — tidak ada deformasi yang terdeteksi dan tidak ada respons yang diperlukan berdasarkan TARP.',
    emailAsk:
        'Mohon setiap penerima membalas untuk mengonfirmasi bahwa email ini masuk ke inbox, bukan ke junk atau quarantine. Notifikasi alarm DTG bersifat time-critical, sehingga alamat yang terfilter sama saja dengan alamat yang tidak dapat dihubungi.',
    emailStatus: 'Status penerimaan sejauh ini:',

    readinessSubject: 'Onboarding: Kesiapan Sistem',
    readinessOpening: (radars) =>
        `Izin menginformasikan bahwa ${radars} telah terkonfigurasi pada dashboard monitoring kami dan pemeriksaan kesiapan telah selesai dilakukan.`,
    readinessConfirmedHeading: 'Telah dikonfirmasi dari sisi kami:',
    readinessConfirmed: [
        'Radar dan live wall folder telah dibuat',
        'Parameter kualitas data telah disiapkan dan ditinjau terhadap hasil scan',
        'Region dan alarm mask telah dikonfigurasi pada software radar',
        'Dokumen TARP telah dimuat dan berstatus aktif',
        'Template laporan harian dan daftar distribusi telah dikonfirmasi'
    ],
    readinessClosing:
        'Apabila terdapat hal di atas yang belum sesuai harapan — terutama region alarm, threshold TARP, atau penerima laporan harian — mohon informasikan kepada kami sebelum monitoring dimulai.',

    commencementSubject: 'Dimulainya Monitoring Live',
    commencementOpening: (radars, site, when) =>
        `Izin menginformasikan bahwa layanan remote monitoring ${radars} di ${site} telah resmi dimulai${when}.`,
    commencementComplete: 'Onboarding telah selesai:',
    commencementRecordHeading: 'Sebagai catatan, hasil pengujian selama onboarding:',
    commencementPhone: (reached, total) =>
        `  - Eskalasi telepon: ${reached} dari ${total} kontak dapat dihubungi`,
    commencementEmail: (confirmed, total) =>
        `  - Distribusi email: ${confirmed} dari ${total} alamat terkonfirmasi`,
    commencementNext: 'Selanjutnya:',
    commencementItems: [
        'Engineer kami memantau radar sesuai shift dan merespons sesuai TARP yang telah disepakati.',
        'Site menerima laporan harian, serta notifikasi segera untuk setiap trigger TARP.',
        'Mohon informasikan setiap perubahan kontak TARP kepada kami agar jalur eskalasi selalu mutakhir.'
    ],
    commencementThanks: 'Terima kasih atas dukungannya selama proses onboarding.',

    theRadar: 'radar',
    theSite: 'site',
    and: 'dan'
};

const STRINGS: Record<EmailLocale, OnboardingStrings> = { en: EN, id: ID };

/** The wording pack for a locale. Anything unknown falls back to English. */
export const onboardingStrings = (locale: EmailLocale = 'en'): OnboardingStrings =>
    STRINGS[locale] ?? EN;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const text = (value: unknown): string => String(value ?? '').trim();

/** "Leonora, WA — Genesis Minerals", with whichever halves exist. */
const siteHeading = (ctx: OnboardingEmailContext, S: OnboardingStrings): string => {
    const place = [text(ctx.siteName), text(ctx.location)].filter(Boolean).join(', ');
    const company = text(ctx.company);
    return company && place ? `${place} — ${company}` : place || company || S.theSite;
};

/** "MSR254" / "MSR254 and SSR994" / "MSR254, SSR994 and PS2000". */
const radarList = (ctx: OnboardingEmailContext, S: OnboardingStrings): string => {
    const list = (ctx.radars || []).map(text).filter(Boolean);
    if (list.length === 0) return S.theRadar;
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(', ')} ${S.and} ${list[list.length - 1]}`;
};

/**
 * The running checklist, ticked from the live step rows.
 *
 * The step being drafted right now is neither ticked nor left blank — it is
 * marked as in progress, because that is the one the email is about.
 */
const checklistBlock = (
    onboarding: OnboardingRow | null | undefined,
    activeKey: OnboardingStepKey,
    S: OnboardingStrings
): string =>
    ONBOARDING_STEPS.map((step) => {
        const done = isStepDone(onboarding, step.key);
        const box = done ? '[x]' : '[ ]';
        const marker = !done && step.key === activeKey ? S.hereMarker : '';
        return `${box} ${S.stepLabels[step.key]}${marker}`;
    }).join('\n');

const signature = (ctx: OnboardingEmailContext, S: OnboardingStrings): string => {
    const lines = [
        S.signOff,
        '',
        text(ctx.engineerName) || S.nameFallback,
        text(ctx.engineerRole) || S.roleFallback,
        'Digital Twin Geotechnical'
    ];
    if (text(ctx.engineerPhone)) lines.push(`M: ${text(ctx.engineerPhone)}`);
    if (text(ctx.engineerEmail)) lines.push(`E: ${text(ctx.engineerEmail)}`);
    return lines.join('\n');
};

const notesBlock = (notes: string | null | undefined, S: OnboardingStrings): string[] => {
    const value = text(notes);
    return value ? ['', S.notesLabel, value] : [];
};

/** Join the parts of a body, collapsing the runs of blank lines they leave. */
const compose = (parts: (string | string[])[]): string =>
    parts
        .flat()
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const numbered = (items: string[]): string[] => items.map((item, i) => `${i + 1}. ${item}`);

/** "[PERLU TINDAKAN]" / "[ACTION REQUIRED]" — the same brackets every draft uses. */
const bracket = (value: string, locale: EmailLocale): string =>
    `[${translateBracket(value, locale)}]`;

// ---------------------------------------------------------------------------
// Trial result blocks
// ---------------------------------------------------------------------------

/**
 * Who answered and who did not — the answer to "tell the client which contacts
 * are reachable".
 *
 * Written as two explicit lists rather than one annotated one. A site reading
 * this has to act on the second list, and a reachable contact buried among ten
 * that answered is how an unreachable night-shift number survives an onboarding.
 */
export const trialResultBlock = (
    tests: ContactTestRow[] | null | undefined,
    channel: 'phone' | 'email',
    locale: EmailLocale = 'en'
): string[] => {
    const S = onboardingStrings(locale);
    const summary = summariseTrial(tests, channel);
    if (summary.total === 0) return [S.noContacts];

    const shiftOf = (row: ContactTestRow): string =>
        row.shift ? ` [${row.shift === 'day' ? S.dayShift : S.nightShift}]` : '';

    const line = (row: ContactTestRow): string => {
        const detail = contactChannelValue(row);
        const remark = text(row.remark) ? ` — ${text(row.remark)}` : '';
        return `  - ${describeContact(row)}${shiftOf(row)}${detail ? `: ${detail}` : ''}${remark}`;
    };

    const failed = (row: ContactTestRow): string => {
        const detail = contactChannelValue(row);
        const remark = text(row.remark) ? ` — ${text(row.remark)}` : '';
        const verdict = S.results[row.result] ?? S.results.pending;
        return `  - ${describeContact(row)}${shiftOf(row)}${detail ? `: ${detail}` : ''} — ${verdict}${remark}`;
    };

    const out: string[] = [];

    out.push(S.reachedHeading(summary.reachable.length, summary.total));
    out.push(...(summary.reachable.length ? summary.reachable.map(line) : [S.none]));
    out.push('');

    if (summary.unreachable.length) {
        out.push(S.notReachedHeading);
        out.push(...summary.unreachable.map(failed));
        out.push('');
    }

    if (summary.untested.length) {
        out.push(S.notTestedHeading);
        out.push(...summary.untested.map(line));
        out.push('');
    }

    if (!summary.meetsMinimumCoverage) {
        out.push(channel === 'phone' ? S.phoneCoverageShortfall : S.emailCoverageShortfall);
    }

    return out;
};

// ---------------------------------------------------------------------------
// Per-step drafts
// ---------------------------------------------------------------------------

type Generator = (ctx: OnboardingEmailContext, S: OnboardingStrings, locale: EmailLocale) => OnboardingDraft;

const administration: Generator = (ctx, S, locale) => ({
    subject: `${bracket('ACTION REQUIRED', locale)} ${S.adminSubject} — ${siteHeading(ctx, S)}`,
    body: compose([
        S.greeting,
        '',
        S.adminOpening(radarList(ctx, S), siteHeading(ctx, S)),
        '',
        S.adminAttached,
        ...S.adminAttachments.map((a) => `  - ${a}`),
        '',
        S.adminSequence,
        '',
        checklistBlock(ctx.onboarding, 'administration', S),
        '',
        S.adminAsk,
        '',
        ...numbered(S.adminItems),
        '',
        S.adminClosing,
        ...notesBlock(ctx.notes, S),
        '',
        signature(ctx, S)
    ])
});

const remoteConnection: Generator = (ctx, S, locale) => {
    const licenceLink = text(ctx.payload?.licenceLink);
    const workstation = text(ctx.payload?.workstation);
    const items = S.connectionItems(radarList(ctx, S), workstation ? ` (${workstation})` : '');

    // The licence line sits between "install it" and "tell us when it's done",
    // which is the order the site works in.
    items.splice(2, 0, licenceLink ? S.connectionLicenceLink(licenceLink) : S.connectionLicenceFollows);

    return {
        subject: `${bracket('ACTION REQUIRED', locale)} ${S.connectionSubject} — ${siteHeading(ctx, S)}`,
        body: compose([
            S.greeting,
            '',
            S.connectionOpening,
            '',
            S.whereWeAre,
            '',
            checklistBlock(ctx.onboarding, 'remote_connection', S),
            '',
            S.connectionAsk,
            '',
            ...numbered(items),
            '',
            S.connectionClosing,
            ...notesBlock(ctx.notes, S),
            '',
            signature(ctx, S)
        ])
    };
};

const communicationTrial: Generator = (ctx, S, locale) => {
    const summary = summariseTrial(ctx.tests, 'phone');
    const clean = summary.meetsMinimumCoverage && summary.unreachable.length === 0;
    return {
        subject: `${bracket(clean ? 'NOTIFICATION ONLY' : 'ACTION REQUIRED', locale)} ${
            S.commsSubject
        } — ${siteHeading(ctx, S)}`,
        body: compose([
            S.greeting,
            '',
            S.commsOpening,
            '',
            trialResultBlock(ctx.tests, 'phone', locale),
            '',
            S.whereWeAre,
            '',
            checklistBlock(ctx.onboarding, 'communication_trial', S),
            '',
            clean ? S.commsClean : S.commsAction,
            ...notesBlock(ctx.notes, S),
            '',
            signature(ctx, S)
        ])
    };
};

const emailTrial: Generator = (ctx, S, locale) => {
    const summary = summariseTrial(ctx.tests, 'email');
    const clean = summary.meetsMinimumCoverage && summary.unreachable.length === 0;
    return {
        subject: `${bracket(clean ? 'NOTIFICATION ONLY' : 'ACTION REQUIRED', locale)} ${
            S.emailSubject
        } — ${siteHeading(ctx, S)}`,
        body: compose([
            S.greeting,
            '',
            S.emailOpening,
            '',
            S.emailAsk,
            '',
            S.emailStatus,
            '',
            trialResultBlock(ctx.tests, 'email', locale),
            '',
            S.whereWeAre,
            '',
            checklistBlock(ctx.onboarding, 'email_trial', S),
            ...notesBlock(ctx.notes, S),
            '',
            signature(ctx, S)
        ])
    };
};

const systemReadiness: Generator = (ctx, S, locale) => ({
    subject: `${bracket('NOTIFICATION ONLY', locale)} ${S.readinessSubject} — ${siteHeading(ctx, S)}`,
    body: compose([
        S.greeting,
        '',
        S.readinessOpening(radarList(ctx, S)),
        '',
        S.readinessConfirmedHeading,
        ...S.readinessConfirmed.map((item) => `  - ${item}`),
        '',
        S.whereWeAre,
        '',
        checklistBlock(ctx.onboarding, 'system_readiness', S),
        '',
        S.readinessClosing,
        ...notesBlock(ctx.notes, S),
        '',
        signature(ctx, S)
    ])
});

const liveCommencement: Generator = (ctx, S, locale) => {
    // A pre-formatted label wins: the commencement dialog stamps the moment the
    // operator picked, in the site's own zone. Otherwise the raw value is put
    // through the same formatter every other draft's timestamps use.
    const label = text(ctx.payload?.commencementLabel);
    const raw = text(ctx.payload?.commencedAt);
    const when = label || (raw ? formatEmailTimestamp(raw, { locale, timeZone: ctx.timeZone }) : '');

    const phoneSummary = summariseTrial(ctx.tests, 'phone');
    const emailSummary = summariseTrial(ctx.tests, 'email');

    return {
        subject: `${bracket('NOTIFICATION ONLY', locale)} ${S.commencementSubject} — ${siteHeading(
            ctx,
            S
        )}`,
        body: compose([
            S.greeting,
            '',
            S.commencementOpening(
                radarList(ctx, S),
                siteHeading(ctx, S),
                when ? ` — ${when}` : ''
            ),
            '',
            S.commencementComplete,
            '',
            checklistBlock(ctx.onboarding, 'live_commencement', S),
            '',
            S.commencementRecordHeading,
            S.commencementPhone(phoneSummary.reachable.length, phoneSummary.total),
            S.commencementEmail(emailSummary.reachable.length, emailSummary.total),
            '',
            S.commencementNext,
            ...numbered(S.commencementItems),
            '',
            S.commencementThanks,
            ...notesBlock(ctx.notes, S),
            '',
            signature(ctx, S)
        ])
    };
};

const GENERATORS: Record<OnboardingStepKey, Generator> = {
    administration,
    remote_connection: remoteConnection,
    communication_trial: communicationTrial,
    email_trial: emailTrial,
    system_readiness: systemReadiness,
    live_commencement: liveCommencement
};

/**
 * The draft for one onboarding step.
 *
 * Returns null for a key this version does not know, rather than a half-written
 * email — a draft the engineer cannot see the whole of is worse than no draft.
 */
export const buildOnboardingDraft = (
    stepKey: string,
    ctx: OnboardingEmailContext
): OnboardingDraft | null => {
    const generator = GENERATORS[stepKey as OnboardingStepKey];
    if (!generator) return null;

    const locale: EmailLocale = ctx.locale === 'id' ? 'id' : 'en';
    return generator(ctx, onboardingStrings(locale), locale);
};

/**
 * Who a step's draft is addressed to, from the TARP distribution list.
 *
 * The email trial goes to the distribution list because testing it IS the step.
 * Every other draft goes to the same list, which is where the client's
 * accountable engineers already are — an onboarding email that reaches a
 * different set of people than the alarms will is not a test of anything.
 */
export const draftRecipients = (
    tests: ContactTestRow[] | null | undefined,
    fallback: string[] = []
): string => {
    const addresses = (tests || []).map((row) => text(row.email)).filter(Boolean);
    const unique = Array.from(new Set([...addresses, ...fallback.map(text).filter(Boolean)]));
    return unique.join('; ');
};

/** Only the addresses a trial has actually confirmed. Used by the commencement notice. */
export const confirmedRecipients = (tests: ContactTestRow[] | null | undefined): string => {
    const addresses = (tests || [])
        .filter((row) => row.channel === 'email' && isReachable(row.result))
        .map((row) => text(row.email))
        .filter(Boolean);
    return Array.from(new Set(addresses)).join('; ');
};
