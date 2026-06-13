'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Radio, Check } from 'lucide-react';
import { useReportSchedules } from './useReportSchedules';
import { shouldRemind, isAckedToday, acknowledge } from './scheduleUtils';

const TICK_MS = 30_000; // re-check the clock every 30s
const REFRESH_MS = 5 * 60_000; // re-fetch report status every 5 min

/**
 * Watches every site's reminder time. When the reminder time has passed and no
 * report has been generated for that site today, a blocking popup with a
 * flashing orange border appears and must be acknowledged before it closes.
 *
 * Mount once near the top of the admin Radar area so it is active across tabs.
 */
export default function ReportReminderManager() {
  const { sites, refresh } = useReportSchedules();
  const [, setTick] = useState(0);
  const [ackVersion, setAckVersion] = useState(0);

  // Tick the clock so the reminder condition is re-evaluated over time.
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
  const due = sites.filter((s) =>
    shouldRemind(s.schedule, s.generatedToday, isAckedToday(s.id))
  );

  const handleAck = (siteId: string) => {
    acknowledge(siteId);
    setAckVersion((v) => v + 1);
  };

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
              {due.length} site{due.length === 1 ? '' : 's'} still need a report today
            </p>
          </div>
        </div>

        <div className="space-y-2 my-4 max-h-72 overflow-y-auto">
          {due.map((site) => (
            <div
              key={site.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--dtg-bg-primary)] border border-orange-500/30"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--dtg-text-primary)] truncate">{site.name}</span>
                  <span className="flex items-center gap-1 text-[var(--dtg-gray-500)] text-xs">
                    <Clock className="w-3 h-3" />
                    Due {site.schedule.deadline}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-orange-400 text-xs mt-1">
                  <Radio className="w-3 h-3 flex-shrink-0" />
                  <span className="text-[var(--dtg-gray-500)]">Missing:</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {site.pendingSensors.map((s) => (
                    <span
                      key={s.radarNumber}
                      className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/30"
                    >
                      {s.radarNumber}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => handleAck(site.id)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[#f97316] text-white hover:bg-[#ea580c] transition-colors flex-shrink-0"
              >
                <Check className="w-4 h-4" />
                Acknowledge
              </button>
            </div>
          ))}
        </div>

        <p className="text-[var(--dtg-gray-500)] text-xs">
          Please generate the missing report(s). Acknowledge each site to dismiss this
          reminder for today.
        </p>
      </div>
    </div>
  );
}
