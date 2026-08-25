import { Pencil, AlertTriangle, Phone, Mail, MessageCircle, PhoneOff } from 'lucide-react';
import { resolveResponseRequirement } from '@/config/tarpDocument';
import {
  tarpStrings,
  translateNotice,
  translateResponseLabel,
  translateRiskRating,
  translateTriggerRow,
} from '@/config/tarpLocale';

/**
 * TarpChart
 *
 * Renders a TARP document's trigger rows as the client's chart reads: grouped
 * by risk band, colour-coded, with the numbered comment list intact.
 *
 * On an Indonesian site the rows are translated for DISPLAY only (see
 * config/tarpLocale.ts) — `onEdit` still hands back the untranslated row, so an
 * engineer amends the English the email engine reads.
 *
 * Props:
 *   triggers              {TarpTrigger[]} - normalised rows, in display order
 *   defaultResponseMethod {string}        - the document's normal response
 *   locale                {'en'|'id'}     - language the chart is read in
 *   editable              {boolean}       - show the per-row edit affordance
 *   onEdit                {function}      - (trigger) => void
 */

const METHOD_ICON = {
  call: Phone,
  call_then_email: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  na: PhoneOff,
};

const COLOUR_STYLE = {
  red: { background: 'rgba(239, 68, 68, 0.18)', color: '#f87171', border: 'rgba(239, 68, 68, 0.45)' },
  orange: { background: 'rgba(249, 115, 22, 0.18)', color: '#fb923c', border: 'rgba(249, 115, 22, 0.45)' },
  yellow: { background: 'rgba(234, 179, 8, 0.18)', color: '#facc15', border: 'rgba(234, 179, 8, 0.45)' },
  grey: { background: 'rgba(148, 163, 184, 0.18)', color: '#cbd5e1', border: 'rgba(148, 163, 184, 0.45)' },
  green: { background: 'rgba(34, 197, 94, 0.18)', color: '#4ade80', border: 'rgba(34, 197, 94, 0.45)' },
};

const styleFor = (colour) => COLOUR_STYLE[colour] || COLOUR_STYLE.grey;

/** Groups consecutive rows sharing a risk rating, as the chart merges them. */
export const groupByRiskBand = (triggers = []) => {
  const bands = [];
  triggers.forEach((trigger) => {
    const last = bands[bands.length - 1];
    if (last && last.riskRating === (trigger.riskRating || null)) {
      last.triggers.push(trigger);
    } else {
      bands.push({ riskRating: trigger.riskRating || null, triggers: [trigger] });
    }
  });
  return bands;
};

export default function TarpChart({
  triggers = [],
  defaultResponseMethod = 'call',
  locale = 'en',
  editable = false,
  onEdit,
}) {
  const t = tarpStrings(locale);

  if (!triggers.length) {
    return (
      <p className="text-sm text-[var(--dtg-text-muted)] italic px-4 py-6">
        {t.emptyDocument}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-[var(--dtg-text-muted)] border-b border-[var(--dtg-border-medium)]">
            <th className="px-3 py-2 font-medium w-28">{t.riskRating}</th>
            <th className="px-3 py-2 font-medium w-56">{t.trigger}</th>
            <th className="px-3 py-2 font-medium">{t.description}</th>
            <th className="px-3 py-2 font-medium w-48">{t.dayShift}</th>
            <th className="px-3 py-2 font-medium w-48">{t.nightShift}</th>
            <th className="px-3 py-2 font-medium w-72">{t.comment}</th>
            {editable && <th className="px-3 py-2 font-medium w-12" />}
          </tr>
        </thead>

        {groupByRiskBand(triggers).map((band, bandIndex) => (
          <tbody key={`${band.riskRating}-${bandIndex}`}>
            {band.triggers.map((source, rowIndex) => {
              // The response is resolved from the ENGLISH row: `inferResponseMethod`
              // reads the day-shift cell for the words "call" / "email", which a
              // translated cell no longer contains.
              const response = resolveResponseRequirement(source, { defaultResponseMethod });
              const trigger = translateTriggerRow(source, locale);
              const colour = styleFor(trigger.colour);
              const MethodIcon = METHOD_ICON[response?.method] || Phone;
              return (
                <tr
                  key={trigger.id ?? `${bandIndex}-${rowIndex}`}
                  className="border-b border-[var(--dtg-border-light)] align-top"
                >
                  {rowIndex === 0 && (
                    <td
                      rowSpan={band.triggers.length}
                      className="px-3 py-3 font-semibold border-r border-[var(--dtg-border-light)]"
                    >
                      {translateRiskRating(band.riskRating, locale)
                        || <span className="text-[var(--dtg-text-muted)]">—</span>}
                    </td>
                  )}

                  <td className="px-3 py-3">
                    {/* Matrix-layout charts group their triggers by parameter.
                        It rides with the trigger rather than taking a column of
                        its own, because the band merge down the left is what
                        makes this chart readable and a second merged axis would
                        cut across it. */}
                    {trigger.parameter && (
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--dtg-text-muted)]">
                        {trigger.parameter}
                      </div>
                    )}
                    <span
                      className="inline-block px-2 py-1 rounded text-xs font-semibold border"
                      style={{
                        backgroundColor: colour.background,
                        color: colour.color,
                        borderColor: colour.border,
                      }}
                    >
                      {trigger.triggerLabel}
                    </span>
                    {trigger.bandLabel && (
                      <div className="mt-1 text-xs text-[var(--dtg-text-muted)]">
                        {trigger.bandLabel}
                      </div>
                    )}
                    {trigger.defType && (
                      <div className="mt-1 text-[11px] text-[var(--dtg-text-muted)]">
                        {t.drives} <code>{trigger.defType}</code>
                        {trigger.tarpLevel !== null && ` → TARP ${trigger.tarpLevel}`}
                        {trigger.requiresAlarm && ` (${t.alarmOnly})`}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-3 text-[var(--dtg-text-secondary)] whitespace-pre-line">
                    {trigger.description || '—'}
                  </td>
                  <td className="px-3 py-3 text-[var(--dtg-text-secondary)]">
                    {response && (
                      <div
                        className={`mb-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          response.deviates
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/50'
                            : 'text-[var(--dtg-text-muted)]'
                        }`}
                      >
                        <MethodIcon size={11} />
                        {translateResponseLabel(response.label, locale).toUpperCase()}
                      </div>
                    )}
                    <div>{trigger.dayShift || '—'}</div>
                  </td>
                  <td className="px-3 py-3 text-[var(--dtg-text-secondary)]">
                    {trigger.nightShift || '—'}
                  </td>

                  <td className="px-3 py-3 text-[var(--dtg-text-secondary)]">
                    {trigger.comments?.length ? (
                      <ul className="space-y-1">
                        {trigger.comments.map((comment, i) => (
                          <li key={i} className="leading-relaxed">{comment}</li>
                        ))}
                      </ul>
                    ) : '—'}

                    {response?.deviates && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-300">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>{translateNotice(response.notice, locale)}</span>
                      </div>
                    )}

                    {trigger.extraNote && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-[var(--dtg-text-muted)]">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>{trigger.extraNote}</span>
                      </div>
                    )}
                  </td>

                  {editable && (
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => onEdit?.(source)}
                        className="p-1.5 rounded hover:bg-[var(--dtg-bg-secondary)] text-[var(--dtg-text-muted)] hover:text-[var(--dtg-brand-orange)] transition-colors"
                        aria-label={`Edit ${trigger.triggerLabel}`}
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
