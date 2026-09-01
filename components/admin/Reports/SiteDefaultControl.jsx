'use client';

/**
 * "Which report does this site usually take?" — the config pane's answer.
 *
 * Sits directly under the Report Type and Category selects because it is about
 * those two controls: it states what the site's saved default is, whether the
 * form is currently on it, and writes the current selection back as the new one.
 *
 * SCREEN-ONLY, like the layout editor beside it. Nothing here reaches the paper.
 *
 * Deliberately NOT a checkbox that saves on toggle. Writing this row changes
 * what every analyst sees for this client from tomorrow morning, so it is an
 * explicit button with the value it is about to store spelled out next to it —
 * the same treatment the layout editor gives Save.
 *
 * Styled to match ReportLayoutEditor's panel (the two are neighbours in the
 * pane, and a second visual language between them would read as a second kind
 * of setting).
 */

import { describeDefault } from '@/utils/reportDefaults';

const panel = {
    background: '#111418',
    color: '#fff',
    borderRadius: 6,
    padding: 10,
};

const btn = {
    padding: '3px 8px',
    borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontSize: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
};

const primaryBtn = {
    ...btn,
    background: '#0f766e',
    borderColor: '#0f766e',
    fontWeight: 600,
};

const disabledBtn = { ...btn, opacity: 0.45, cursor: 'not-allowed' };

const muted = { fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 };

const STATUS_TONE = {
    error: '#f87171',
    unavailable: '#fbbf24',
    saved: '#4ade80',
    saving: '#fbbf24',
    idle: 'rgba(255,255,255,0.5)',
};

/**
 * @param {string} siteName   The client's name, for a message that says WHICH
 *   site is about to be changed — "the site" is not enough when the modal can
 *   be switched between clients without closing.
 * @param {object|null} siteDefault  The site's saved default (normalised), or null.
 * @param {boolean} matches   The form is already on that default.
 * @param {boolean} hasSite   A client is selected at all.
 * @param {boolean} available The defaults table exists (see useSiteReportDefaults).
 * @param {{kind: string, message: string}} status
 * @param {Record<string,string>} frequencyLabels  Stored value → the form's word.
 * @param {string} customFrequency
 * @param {Function} onSave   Save the current selection as this site's default.
 * @param {Function} onClear  Remove it.
 */
export function SiteDefaultControl({
    siteName,
    siteDefault,
    matches = false,
    hasSite = false,
    available = true,
    status,
    frequencyLabels,
    customFrequency,
    onSave,
    onClear,
}) {
    const saving = status?.kind === 'saving';
    const summary = describeDefault(siteDefault, { frequencyLabels, customFrequency });
    const canWrite = hasSite && available && !saving;

    return (
        <div style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 12, flex: 1 }}>Site default report</strong>
                {siteDefault && matches ? (
                    <span style={{ fontSize: 10, color: '#4ade80' }}>in use</span>
                ) : siteDefault ? (
                    <span style={{ fontSize: 10, color: '#fbbf24' }}>changed</span>
                ) : null}
            </div>

            <p style={{ ...muted, marginTop: 6 }}>
                {!hasSite ? (
                    'Select a client to set the report it usually takes.'
                ) : siteDefault ? (
                    <>
                        {siteName} opens on <span style={{ color: '#fff' }}>{summary}</span>.
                    </>
                ) : (
                    <>No default set — {siteName} opens on the form’s own selection.</>
                )}
            </p>

            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!canWrite || matches}
                    style={canWrite && !matches ? primaryBtn : disabledBtn}
                    title={
                        matches
                            ? 'The form is already on this site’s default.'
                            : 'Store the current Report Type, Category and Frequency for this site.'
                    }
                >
                    {siteDefault ? 'Update default' : 'Save as default'}
                </button>
                {siteDefault ? (
                    <button type="button" onClick={onClear} disabled={!canWrite} style={canWrite ? btn : disabledBtn}>
                        Clear
                    </button>
                ) : null}
            </div>

            {status?.message ? (
                <p style={{ fontSize: 10, marginTop: 6, color: STATUS_TONE[status.kind] ?? muted.color, lineHeight: 1.4 }}>
                    {status.message}
                </p>
            ) : null}
        </div>
    );
}

export default SiteDefaultControl;
