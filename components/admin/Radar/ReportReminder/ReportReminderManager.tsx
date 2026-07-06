'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Radio, Check, Satellite } from 'lucide-react';
import { useReportSchedules } from './useReportSchedules';
import { shouldRemindFor, isAckedFor, acknowledgeFor, Cadence } from './scheduleUtils';
import { RADAR_TYPE } from './reportTypes';

const TICK_MS = 30_000; // re-check the clock every 30s
const REFRESH_MS = 5 * 60_000; // re-fetch report status every 5 min

/** A single overdue report obligation surfaced in the popup. */
interface DueItem {
  key: string;
  siteName: string;
  reportType: string;
  cadence: Cadence;
  icon: 'radar' | 'bulletin';
  label: string;
  deadlineLabel: string;
  missing: string[];
  onAck: () => void;
}

/**
 * Watches every site's report obligations (radar daily plus opt-in bulletin
 * reports such as monthly InSAR). When an obligation's reminder time has passed
 * on a due day and the report is still missing, a blocking popup appears and
 * must be acknowledged before it closes.
 *
 * Mount once near the top of the admin Radar area so it is active across tabs.
 */
export default function ReportReminderManager() {
  const { sites, refresh } = useReportSchedules();
  const [, setTick] = useState(0);
  const [ackVersion, setAckVersion] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), TICK_MS);
    const reload = setInterval(() => refresh(), REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(reload);
    };
  }, [refresh]);

  // ackVersion is read so acknowledging forces a recompute of `due`.
  void ackVersion;

  const ack = (reportType: string, siteId: string, cadence: Cadence) => {
    acknowledgeFor(reportType, siteId, cadence);
    setAckVersion((v) => v + 1);
  };

  const due: DueItem[] = [];
  for (const s of sites) {
    if (
      s.hasRadar &&
      shouldRemindFor(
        s.schedule,
        'daily',
        s.generatedToday,
        isAckedFor(RADAR_TYPE.key, s.id, 'daily')
      )
    ) {
      due.push({
        key: `${s.id}:${RADAR_TYPE.key}`,
        siteName: s.name,
        reportType: RADAR_TYPE.key,
        cadence: 'daily',
        icon: 'radar',
        label: 'Radar report',
        deadlineLabel: `Due ${s.schedule.deadline}`,
        missing: s.pendingSensors.map((p) => p.radarNumber),
        onAck: () => ack(RADAR_TYPE.key, s.id, 'daily'),
      });
    }

    for (const b of s.bulletins) {
      if (
        shouldRemindFor(
          b.schedule,
          b.cadence,
          b.generatedInPeriod,
          isAckedFor(b.type, s.id, b.cadence)
        )
      ) {
        due.push({
          key: `${s.id}:${b.type}`,
          siteName: s.name,
          reportType: b.type,
          cadence: b.cadence,
          icon: 'bulletin',
          label: `${b.label} (${b.cadence})`,
          deadlineLabel:
            b.cadence === 'monthly' ? 'Due last day 23:59' : `Due ${b.schedule.deadline}`,
          missing: [`${b.label} report`],
          onAck: () => ack(b.type, s.id, b.cadence),
        });
      }
    }
  }

  if (due.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <style>{`
        @keyframes report-reminder-flash {
          0%, 100% { border-color: #f97316; box-shadow: 0 0 0 1px rgba(249,115,22,0.6); }
          50% { border-color: #7c2d12; box-shadow: 0 0 26px 4px rgba(249,115,22,0.55); }
        }
        .report-reminder-flash { animation: report-reminder-flash 1s ease-in-out infinite; }
      `}</style>

      <div className="report-reminder-flash w-full max-w-md rounded-xl border-4 bg-[var(--dtg-bg-card)] p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h3 className="text-lg text-[var(--dtg-text-primary)] font-bold">
              Report Reminder
            </h3>
            <p className="text-[var(--dtg-gray-500)] text-sm">
              {due.length} report{due.length === 1 ? '' : 's'} still overdue
            </p>
          </div>
        </div>

        <div className="space-y-2 my-4 max-h-72 overflow-y-auto">
          {due.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--dtg-bg-primary)] border border-orange-500/30"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[var(--dtg-text-primary)] truncate">{item.siteName}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] text-[var(--dtg-gray-400)]">
                    {item.label}
                  </span>
                  <span className="flex items-center gap-1 text-[var(--dtg-gray-500)] text-xs">
                    <Clock className="w-3 h-3" />
                    {item.deadlineLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-orange-400 text-xs mt-1">
                  {item.icon === 'bulletin' ? (
                    <Satellite className="w-3 h-3 flex-shrink-0" />
                  ) : (
                    <Radio className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="text-[var(--dtg-gray-500)]">Missing:</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.missing.map((label) => (
                    <span
                      key={label}
                      className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/30"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={item.onAck}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[#f97316] text-white hover:bg-[#ea580c] transition-colors flex-shrink-0"
              >
                <Check className="w-4 h-4" />
                Acknowledge
              </button>
            </div>
          ))}
        </div>

        <p className="text-[var(--dtg-gray-500)] text-xs">
          Please generate the missing report(s). Daily reminders are dismissed for the
          rest of the day; weekly and monthly reminders return each hour on the due day
          until the report is uploaded.
        </p>
      </div>
    </div>
  );
}
