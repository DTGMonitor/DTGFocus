'use client';

import React, { useState } from 'react';
import { Clock, Radio, CheckCircle, AlertTriangle, Settings, Loader } from 'lucide-react';
import { useReportSchedules } from './useReportSchedules';
import { defaultReminderFor } from './scheduleUtils';

/**
 * Replaces the static "Scheduled Reports" list with a per-site report schedule.
 * Each site shows its sensor count, the time its report is due, and the reminder
 * time (default 30 min prior). In manage mode the deadline / reminder / enabled
 * fields become editable and persist via localStorage.
 */
export default function ScheduledReports() {
  const { sites, loading, saveSchedule } = useReportSchedules();
  const [editing, setEditing] = useState(false);

  return (
    <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg text-[var(--dtg-text-primary)]">Scheduled Reports</h3>
          <p className="text-[var(--dtg-gray-500)] text-sm">
            Daily report deadline and reminder per site
          </p>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          className="flex items-center gap-1.5 text-sm text-[#14b8a6] hover:text-[#0d9488] transition-colors"
        >
          <Settings className="w-4 h-4" />
          {editing ? 'Done' : 'Manage Schedule'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8 text-[var(--dtg-gray-400)]">
          <Loader className="w-5 h-5 animate-spin mr-2" />
          Loading sites...
        </div>
      ) : sites.length === 0 ? (
        <div className="p-8 text-center text-[var(--dtg-gray-500)] text-sm">
          No sites available.
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map((site) => {
            const generated = site.generatedToday;
            return (
              <div
                key={site.id}
                className="flex items-center justify-between gap-4 p-4 bg-[var(--dtg-bg-primary)] rounded-lg border border-[var(--dtg-border-medium)]"
              >
                {/* Site identity + status */}
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      site.schedule.enabled
                        ? generated
                          ? 'bg-green-500'
                          : 'bg-orange-500 animate-pulse'
                        : 'bg-gray-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[var(--dtg-text-primary)] truncate">{site.name}</div>
                    <div className="flex items-center gap-3 text-[var(--dtg-gray-500)] text-sm">
                      <span className="flex items-center gap-1">
                        <Radio className="w-3 h-3" />
                        {site.sensorCount - site.pendingSensors.length}/{site.sensorCount} reported
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Due {site.schedule.deadline}
                      </span>
                    </div>
                    {/* Sensors still missing today's report */}
                    {!generated && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {site.pendingSensors.map((s) => (
                          <span
                            key={s.radarNumber}
                            className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20"
                          >
                            {s.radarNumber}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Schedule controls / read-out */}
                {editing ? (
                  <div className="flex items-center gap-4">
                    <label className="flex flex-col text-xs text-[var(--dtg-gray-500)]">
                      Deadline
                      <input
                        type="time"
                        value={site.schedule.deadline}
                        onChange={(e) => {
                          const deadline = e.target.value;
                          // Keep reminder in step if it was still the default.
                          const wasDefault =
                            site.schedule.reminder ===
                            defaultReminderFor(site.schedule.deadline);
                          saveSchedule(site.id, {
                            deadline,
                            ...(wasDefault
                              ? { reminder: defaultReminderFor(deadline) }
                              : {}),
                          });
                        }}
                        className="mt-1 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded px-2 py-1 text-[var(--dtg-text-primary)] text-sm"
                      />
                    </label>
                    <label className="flex flex-col text-xs text-[var(--dtg-gray-500)]">
                      Reminder
                      <input
                        type="time"
                        value={site.schedule.reminder}
                        onChange={(e) =>
                          saveSchedule(site.id, { reminder: e.target.value })
                        }
                        className="mt-1 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded px-2 py-1 text-[var(--dtg-text-primary)] text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--dtg-gray-500)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={site.schedule.enabled}
                        onChange={(e) =>
                          saveSchedule(site.id, { enabled: e.target.checked })
                        }
                        className="accent-[#14b8a6]"
                      />
                      Enabled
                    </label>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <div className="text-[var(--dtg-gray-500)] text-xs">Reminder</div>
                      <div className="text-[var(--dtg-text-primary)] text-sm">
                        {site.schedule.enabled ? site.schedule.reminder : 'Off'}
                      </div>
                    </div>
                    {generated ? (
                      <span className="flex items-center gap-1 text-green-500 text-sm">
                        <CheckCircle className="w-4 h-4" />
                        Generated
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-orange-500 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        Pending
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
