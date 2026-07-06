'use client';

import { useState } from 'react';
import {
  Clock,
  Radio,
  CheckCircle,
  AlertTriangle,
  Settings,
  Loader,
  Satellite,
} from 'lucide-react';
import {
  useReportSchedules,
  SiteReportStatus,
} from './useReportSchedules';
import { defaultReminderFor, Cadence, SiteSchedule } from './scheduleUtils';
import { RADAR_TYPE } from './reportTypes';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const INPUT_CLASS =
  'mt-1 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded px-2 py-1 text-[var(--dtg-text-primary)] text-sm';

function periodWord(cadence: Cadence): string {
  if (cadence === 'weekly') return 'this week';
  if (cadence === 'monthly') return 'this month';
  return 'today';
}

function dueLabel(cadence: Cadence, schedule: SiteSchedule): string {
  if (cadence === 'monthly') return 'Due last day 23:59';
  if (cadence === 'weekly') {
    const wd = schedule.weekday != null ? WEEKDAYS[schedule.weekday] : '—';
    return `Due ${wd} ${schedule.deadline}`;
  }
  return `Due ${schedule.deadline}`;
}

/** Editable controls for one obligation's schedule, adapting to its cadence. */
function ScheduleControls({
  cadence,
  schedule,
  onPatch,
  syncReminderOnDeadline,
}: {
  cadence: Cadence;
  schedule: SiteSchedule;
  onPatch: (patch: Partial<SiteSchedule>) => void;
  syncReminderOnDeadline?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {cadence === 'weekly' && (
        <label className="flex flex-col text-xs text-[var(--dtg-gray-500)]">
          Weekday
          <select
            value={schedule.weekday ?? 1}
            onChange={(e) => onPatch({ weekday: Number(e.target.value) })}
            className={INPUT_CLASS}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}

      {cadence === 'monthly' ? (
        <span className="flex items-center gap-1 text-[var(--dtg-gray-500)] text-xs">
          <Clock className="w-3 h-3" />
          Due last day 23:59
        </span>
      ) : (
        <label className="flex flex-col text-xs text-[var(--dtg-gray-500)]">
          Deadline
          <input
            type="time"
            value={schedule.deadline}
            onChange={(e) => {
              const deadline = e.target.value;
              const wasDefault =
                syncReminderOnDeadline &&
                schedule.reminder === defaultReminderFor(schedule.deadline);
              onPatch({
                deadline,
                ...(wasDefault ? { reminder: defaultReminderFor(deadline) } : {}),
              });
            }}
            className={INPUT_CLASS}
          />
        </label>
      )}

      <label className="flex flex-col text-xs text-[var(--dtg-gray-500)]">
        {cadence === 'monthly' ? 'Reminder from' : 'Reminder'}
        <input
          type="time"
          value={schedule.reminder}
          onChange={(e) => onPatch({ reminder: e.target.value })}
          className={INPUT_CLASS}
        />
      </label>
    </div>
  );
}

/**
 * Per-site report schedule panel. Each site shows its radar (daily, sensor-based)
 * obligation plus any opt-in bulletin obligations (InSAR, VWP, …) with their own
 * cadence. In manage mode the deadline / reminder / enabled / weekday fields are
 * editable and persist to Supabase (site_report_schedules, keyed by site + type).
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
            Report deadlines and reminders per site
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
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              editing={editing}
              saveSchedule={saveSchedule}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteCard({
  site,
  editing,
  saveSchedule,
}: {
  site: SiteReportStatus;
  editing: boolean;
  saveSchedule: (siteId: string, patch: Partial<SiteSchedule>, reportType?: string) => void;
}) {
  const generated = site.generatedToday;
  const visibleBulletins = editing
    ? site.bulletins
    : site.bulletins.filter((b) => b.schedule.enabled);

  return (
    <div className="flex flex-col gap-3 p-4 bg-[var(--dtg-bg-primary)] rounded-lg border border-[var(--dtg-border-medium)]">
      {/* Site header */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-[var(--dtg-text-primary)] truncate">{site.name}</div>
        {editing && site.saving && (
          <Loader className="w-4 h-4 animate-spin text-[var(--dtg-gray-400)]" />
        )}
        {editing && site.saveError && (
          <span
            className="text-red-400 text-xs max-w-[160px] truncate"
            title={site.saveError}
          >
            Save failed
          </span>
        )}
      </div>

      {/* Radar (daily, sensor-based) — only when the site has radar sensors */}
      {site.hasRadar && (
        <div className="flex items-start justify-between gap-4 border-t border-[var(--dtg-border-medium)] pt-3">
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
              <div className="text-[var(--dtg-text-primary)] text-sm">Radar</div>
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

          {editing ? (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-[var(--dtg-gray-500)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={site.schedule.enabled}
                  onChange={(e) =>
                    saveSchedule(site.id, { enabled: e.target.checked }, RADAR_TYPE.key)
                  }
                  className="accent-[#14b8a6]"
                />
                Enabled
              </label>
              <ScheduleControls
                cadence="daily"
                schedule={site.schedule}
                syncReminderOnDeadline
                onPatch={(patch) => saveSchedule(site.id, patch, RADAR_TYPE.key)}
              />
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
      )}

      {/* Bulletin obligations (InSAR, VWP, …) */}
      {visibleBulletins.map((b) => (
        <div
          key={b.type}
          className="flex items-start justify-between gap-4 border-t border-[var(--dtg-border-medium)] pt-3"
        >
          <div className="min-w-0">
            <label className="flex items-center gap-1.5 text-[var(--dtg-text-primary)] text-sm cursor-pointer">
              {editing && (
                <input
                  type="checkbox"
                  checked={b.schedule.enabled}
                  onChange={(e) =>
                    saveSchedule(site.id, { enabled: e.target.checked }, b.type)
                  }
                  className="accent-[#14b8a6]"
                />
              )}
              <Satellite className="w-3.5 h-3.5" />
              {b.label}
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] text-[var(--dtg-gray-400)]">
                {b.cadence}
              </span>
            </label>
            <div className="flex items-center gap-1 text-[var(--dtg-gray-500)] text-xs mt-1">
              <Clock className="w-3 h-3" />
              {dueLabel(b.cadence, b.schedule)}
            </div>
          </div>

          {editing ? (
            b.schedule.enabled && (
              <ScheduleControls
                cadence={b.cadence}
                schedule={b.schedule}
                onPatch={(patch) => saveSchedule(site.id, patch, b.type)}
              />
            )
          ) : b.generatedInPeriod ? (
            <span className="flex items-center gap-1 text-green-500 text-sm">
              <CheckCircle className="w-4 h-4" />
              Generated {periodWord(b.cadence)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-orange-500 text-sm">
              <AlertTriangle className="w-4 h-4" />
              Pending
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
