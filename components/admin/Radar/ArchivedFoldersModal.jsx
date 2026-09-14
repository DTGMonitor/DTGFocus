import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { X, Archive, Calendar, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { Spinner } from "@/components/Reusable/Spinner";
import TimelineView from "@/components/admin/Radar/Deformation/TimelineView";
import { getBandCardColor, getBandDotColor, getStatusColor } from "@/config/statusConfig";
import { recordColour, recordBadgeLabel, getRiskDisplayMode } from "@/config/riskDisplay";
import { folderDisplayLabel } from "@/utils/reportWallFolders";
import {
  formatTimestamp,
  normalizePrecursorss,
  resolveTimelineChain,
  resolveChainTips,
  resolveArchivedChainTips,
  resolveDetectedBy,
} from "@/utils/tabHelpers";

/**
 * ArchivedFoldersModal
 *
 * A read-only window onto the wall folders this radar has retired.
 *
 * A radar accrues folders over its life: re-aimed at a new stage, renamed, or
 * retired with the radar itself. Everything recorded under a folder stays where
 * it was written — deformation, alarms, downtime, the data-quality sheet — but
 * the app only ever shows the CURRENT folder, so the moment a folder is archived
 * its history becomes unreachable from anywhere except a report run over exactly
 * the right window.
 *
 * This is the window. It reads and never writes: no edit, no restore, no delete,
 * and no control that could be mistaken for one. That is the whole point of it —
 * an archived folder is a closed book, and the reason it is safe to open one from
 * a live radar's panel is that opening it cannot change anything.
 *
 * Deformation is split the way the Deformation tab splits it, because the two
 * halves mean different things about a retired folder: records left ACTIVE were
 * still being reported when the folder was retired (a rotation carries none of
 * them forward), while ARCHIVED ones had already been closed out. A decommission
 * resolves everything, so a decommissioned radar's folders show only the second.
 */

const ARCHIVE_TYPE = "Archive";

const TIMELINE_SELECT =
  "id, created_at, location, precursors, def_type, tarp_level, isactive, start, detected_by, alarm, crosschecked_by, notification_time, site_engineer, properties, notes, wallfolder_id";

const SECTIONS = [
  { key: "deformation", label: "Deformation" },
  { key: "alarm", label: "Alarms" },
  { key: "downtime", label: "Downtime" },
  { key: "dqp", label: "Data Quality" },
];

const EMPTY_DATA = {
  deformation: [],
  alarms: [],
  downtime: [],
  dqp: [],
};

/** A dash rather than an empty cell, so a blank column reads as "not recorded". */
const orDash = (value) => {
  const text = String(value ?? "").trim();
  return text || "—";
};

export default function ArchivedFoldersModal({
  isOpen,
  sensor,
  timezone,
  crosscheckers = [],
  onClose,
}) {
  const radarId = sensor?.id ?? null;
  const riskMode = getRiskDisplayMode(sensor);

  const [folders, setFolders] = useState([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState(null);

  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [section, setSection] = useState("deformation");

  const [data, setData] = useState(EMPTY_DATA);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataError, setDataError] = useState(null);

  const [timelineKey, setTimelineKey] = useState(null);
  const [timelineChain, setTimelineChain] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState(null);

  const selectedFolder = useMemo(
    () => folders.find((f) => String(f.id) === String(selectedFolderId)) || null,
    [folders, selectedFolderId]
  );

  // ── Folder registry ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const load = async () => {
      if (radarId == null) {
        setFolders([]);
        setFolderError("This radar carries no id, so its folder history cannot be looked up.");
        return;
      }
      setIsLoadingFolders(true);
      setFolderError(null);
      try {
        const { data: rows, error } = await supabase
          .from("radar_wall_folders")
          .select("id, name, area, type, commenced_at, decommissioned_at, location_group")
          .eq("radar_id", radarId)
          .eq("type", ARCHIVE_TYPE)
          .order("commenced_at", { ascending: false });

        if (error) throw error;
        if (cancelled) return;
        setFolders(rows || []);
        // Land on the most recently commenced one: it is the folder the current
        // one replaced, which is what someone opening this almost always wants.
        setSelectedFolderId((rows || [])[0]?.id ?? null);
      } catch (err) {
        console.error("Error loading archived wall folders:", err);
        if (!cancelled) setFolderError("Failed to load the archived wall folders.");
      } finally {
        if (!cancelled) setIsLoadingFolders(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, radarId]);

  // Opening fresh must not show the last visit's folder data behind a spinner.
  useEffect(() => {
    if (isOpen) return;
    setFolders([]);
    setSelectedFolderId(null);
    setSection("deformation");
    setData(EMPTY_DATA);
    setDataError(null);
    setTimelineKey(null);
    setTimelineChain([]);
  }, [isOpen]);

  // ── The selected folder's data ──────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || selectedFolderId == null) return;
    let cancelled = false;

    const load = async () => {
      setIsLoadingData(true);
      setDataError(null);
      setTimelineKey(null);
      setTimelineChain([]);
      try {
        // The alarm registry resolves first: alarm_records hang off regions, and
        // the regions hang off the folder, so there is nothing to query until
        // the region ids are known.
        const { data: regions, error: regionError } = await supabase
          .from("alarm_regions")
          .select("id, name, alarmtype")
          .eq("wallfolder", selectedFolderId);
        if (regionError) throw regionError;

        const regionIds = (regions || []).map((r) => r.id);
        const regionById = new Map((regions || []).map((r) => [String(r.id), r]));

        // The sheet a folder was scored on is its LATEST dqp_record — the one the
        // folder carried when it was retired.
        const { data: dqpRecord, error: dqpRecordError } = await supabase
          .from("dqp_records")
          .select("id, created_time")
          .eq("wall_folder_id", selectedFolderId)
          .order("created_time", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (dqpRecordError) throw dqpRecordError;

        const [defRes, alarmRes, downtimeRes, dqpRes] = await Promise.all([
          supabase
            .from("def_records")
            .select(TIMELINE_SELECT)
            .eq("wallfolder_id", selectedFolderId)
            .order("created_at", { ascending: false }),
          regionIds.length
            ? supabase
                .from("alarm_records")
                .select("id, triggered_at, alarm_region, location, reason, cause, detected_by")
                .in("alarm_region", regionIds)
                .order("triggered_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("downtime_records")
            .select("id, type, reason, from, to, detected_by, action, notes, notification_time, site_engineer")
            .eq("wallfolder", selectedFolderId)
            .order("from", { ascending: false, nullsFirst: false }),
          dqpRecord?.id
            ? supabase
                .from("dqp_values")
                .select("value, notes, appendix, parameter_id, parameters!inner(id, name, level, parent_id)")
                .eq("dqp_record_id", dqpRecord.id)
                .order("parameter_id", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        ]);

        for (const res of [defRes, alarmRes, downtimeRes, dqpRes]) {
          if (res?.error) throw res.error;
        }
        if (cancelled) return;

        setData({
          deformation: defRes.data || [],
          alarms: (alarmRes.data || []).map((a) => ({
            ...a,
            region: regionById.get(String(a.alarm_region)) || null,
          })),
          downtime: downtimeRes.data || [],
          dqp: dqpRes.data || [],
        });
      } catch (err) {
        console.error("Error loading archived folder data:", err);
        if (!cancelled) {
          setData(EMPTY_DATA);
          setDataError("Failed to load this folder's records.");
        }
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedFolderId]);

  // ── Deformation chains ──────────────────────────────────────────────────────

  // Everything in the folder is loaded in one read, so the two halves are split
  // here rather than in two queries: `resolveArchivedChainTips` needs to see the
  // active records anyway to tell a closed chain from a superseded node.
  const { liveChains, closedChains } = useMemo(() => {
    const all = data.deformation;
    const active = all.filter((r) => r.isactive === "Yes");
    const archived = all.filter((r) => r.isactive !== "Yes");
    return {
      liveChains: resolveChainTips(active),
      closedChains: resolveArchivedChainTips(archived, all),
    };
  }, [data.deformation]);

  const fetchRecordById = useCallback(async (id) => {
    const { data: row, error } = await supabase
      .from("def_records")
      .select(TIMELINE_SELECT)
      .eq("id", id)
      .single();
    if (error) throw error;
    return row;
  }, []);

  const expandTimeline = useCallback(
    async (record, branchId = null, key = null) => {
      const nodeKey = key ?? String(record.id);
      if (timelineKey === nodeKey) {
        setTimelineKey(null);
        setTimelineChain([]);
        setTimelineError(null);
        return;
      }
      setTimelineKey(nodeKey);
      setTimelineError(null);

      if (normalizePrecursorss(record.precursors).length === 0) {
        setTimelineChain([{ ...record, related: [] }]);
        return;
      }

      setTimelineLoading(true);
      try {
        const { chain, error } = await resolveTimelineChain(record, fetchRecordById, 50, { branchId });
        setTimelineChain(chain);
        setTimelineError(error);
      } catch (err) {
        console.error("Error resolving archived timeline chain:", err);
        setTimelineChain([{ ...record, related: [] }]);
        setTimelineError("Timeline may be incomplete.");
      } finally {
        setTimelineLoading(false);
      }
    },
    [fetchRecordById, timelineKey]
  );

  const timelinePanel = (
    <TimelineView
      chain={timelineChain}
      isLoading={timelineLoading}
      error={timelineError}
      timezone={timezone}
      crosscheckers={crosscheckers}
      riskMode={riskMode}
    />
  );

  const renderDefCard = (record, branchId, key, note) => {
    const isOpen = timelineKey === key;
    const band = recordColour(record);
    const badge = recordBadgeLabel(record, riskMode);
    return (
      <div key={key} className={`flex flex-col gap-2 border rounded-lg p-3 ${getBandCardColor(band)}`}>
        <div className="flex justify-between items-center gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex gap-3 items-center text-sm">
              <span className={`w-4 h-4 rounded-xl shrink-0 ${getBandDotColor(band)}`} />
              <p>
                {badge ? (
                  <>
                    <strong>{badge}</strong> |{" "}
                  </>
                ) : null}
                {record.def_type} - {record.location}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-light text-xs text-[var(--dtg-text-secondary)]">
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {formatTimestamp(record.created_at, timezone)}
              </span>
              <span>Reported by: {resolveDetectedBy(record.detected_by, crosscheckers)}</span>
              {note ? <span>{note}</span> : null}
            </div>
          </div>
          <button
            onClick={() => expandTimeline(record, branchId, key)}
            title={isOpen ? "Hide timeline" : "View timeline"}
            aria-label="Toggle archived folder timeline"
            className="p-1 shrink-0 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
          >
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        {isOpen && timelinePanel}
      </div>
    );
  };

  // ── Section bodies ──────────────────────────────────────────────────────────

  const emptyNote = (text) => <p className="py-6 text-center text-sm text-[var(--dtg-text-secondary)]">{text}</p>;

  const renderDeformation = () => {
    if (data.deformation.length === 0) {
      return emptyNote("No deformation was recorded under this wall folder.");
    }
    return (
      <div className="flex flex-col gap-4">
        {liveChains.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
              Still open when the folder was retired ({liveChains.length})
            </h4>
            <p className="text-xs text-[var(--dtg-text-secondary)]">
              These were never archived — the folder was rotated out from under them, so they stopped
              being reported without ever being closed off.
            </p>
            {liveChains.map((tip) =>
              renderDefCard(tip.record, tip.branchId, tip.key, tip.branchRecord ? `Chain of ${tip.branchRecord.def_type}` : null)
            )}
          </div>
        )}
        {closedChains.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
              Closed chains ({closedChains.length})
            </h4>
            {closedChains.map((record) => renderDefCard(record, null, String(record.id), null))}
          </div>
        )}
      </div>
    );
  };

  const table = (headers, rows) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[var(--dtg-text-secondary)] uppercase tracking-wide">
          <tr className="border-b border-[var(--dtg-border-medium)]">
            {headers.map((h) => (
              <th key={h} className="py-2 pr-4 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dtg-border-medium)]/60">{rows}</tbody>
      </table>
    </div>
  );

  const renderAlarms = () =>
    data.alarms.length === 0
      ? emptyNote("No alarms were recorded against this wall folder's regions.")
      : table(
          ["Triggered", "Region", "Location", "Reason", "Cause", "Detected by"],
          data.alarms.map((a) => (
            <tr key={a.id} className="align-top">
              <td className="py-2 pr-4 whitespace-nowrap">{formatTimestamp(a.triggered_at, timezone)}</td>
              <td className="py-2 pr-4">{orDash(a.region?.name)}</td>
              <td className="py-2 pr-4">{orDash(a.location)}</td>
              <td className="py-2 pr-4">{orDash(a.reason)}</td>
              <td className="py-2 pr-4">{orDash(a.cause)}</td>
              <td className="py-2 pr-4">{resolveDetectedBy(a.detected_by, crosscheckers)}</td>
            </tr>
          ))
        );

  const renderDowntime = () =>
    data.downtime.length === 0
      ? emptyNote("No downtime was recorded under this wall folder.")
      : table(
          ["Status", "From", "To", "Reason", "Action", "Detected by", "Notes"],
          data.downtime.map((d) => (
            <tr key={d.id} className="align-top">
              <td className="py-2 pr-4 whitespace-nowrap">
                <span className={`px-2 py-0.5 rounded border ${getStatusColor(d.type)}`}>{orDash(d.type)}</span>
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">{formatTimestamp(d.from, timezone)}</td>
              {/* An open record is not missing data: the folder was retired with
                  the radar still down, and "—" would read as a gap in the log. */}
              <td className="py-2 pr-4 whitespace-nowrap">
                {d.to ? formatTimestamp(d.to, timezone) : <span className="text-yellow-400">still open</span>}
              </td>
              <td className="py-2 pr-4">{orDash(d.reason)}</td>
              <td className="py-2 pr-4">{orDash(d.action)}</td>
              <td className="py-2 pr-4">{resolveDetectedBy(d.detected_by, crosscheckers)}</td>
              <td className="py-2 pr-4 max-w-[18rem]">{orDash(d.notes)}</td>
            </tr>
          ))
        );

  const renderDqp = () =>
    data.dqp.length === 0
      ? emptyNote("No data-quality sheet was scored for this wall folder.")
      : table(
          ["Parameter", "Value", "Notes", "Appendix"],
          data.dqp.map((v) => (
            <tr key={`${v.parameter_id}`} className="align-top">
              {/* Indented by the parameter's level so a sub-parameter reads as
                  belonging to its parent, the way the live sheet prints it. */}
              <td className="py-2 pr-4" style={{ paddingLeft: `${(v.parameters?.level ?? 0) * 12}px` }}>
                {orDash(v.parameters?.name)}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">{orDash(v.value)}</td>
              <td className="py-2 pr-4 max-w-[20rem]">{orDash(v.notes)}</td>
              <td className="py-2 pr-4 max-w-[16rem]">{orDash(v.appendix)}</td>
            </tr>
          ))
        );

  const sectionBody = () => {
    if (isLoadingData) {
      return (
        <div className="flex items-center justify-center py-16">
          <Spinner size={32} />
        </div>
      );
    }
    if (dataError) return <p className="py-8 text-center text-sm text-red-500">{dataError}</p>;
    if (section === "deformation") return renderDeformation();
    if (section === "alarm") return renderAlarms();
    if (section === "downtime") return renderDowntime();
    return renderDqp();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--dtg-bg-card)] rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col border border-[var(--dtg-border-medium)] shadow-xl text-[var(--dtg-text-primary)]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--dtg-border-medium)] p-5">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Archive size={18} />
              Archived Wall Folders
            </h2>
            <p className="text-xs text-[var(--dtg-text-secondary)] mt-1 flex items-center gap-1.5">
              <Eye size={12} />
              View only — {sensor?.radar_number ?? "this radar"}&apos;s retired folders and everything
              recorded under them. Nothing here can be changed.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close archived wall folders"
            className="p-1 rounded text-gray-400 hover:text-[var(--dtg-text-primary)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Folder registry */}
          <div className="w-64 shrink-0 border-r border-[var(--dtg-border-medium)] overflow-y-auto">
            {isLoadingFolders ? (
              <div className="flex justify-center py-8">
                <Spinner size={24} />
              </div>
            ) : folderError ? (
              <p className="p-4 text-xs text-red-500">{folderError}</p>
            ) : folders.length === 0 ? (
              <p className="p-4 text-xs text-[var(--dtg-text-secondary)]">
                This radar has never retired a wall folder — everything it has ever recorded is under
                the folder it is on now.
              </p>
            ) : (
              folders.map((folder) => {
                const isSelected = String(folder.id) === String(selectedFolderId);
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      setSelectedFolderId(folder.id);
                      setSection("deformation");
                    }}
                    className={[
                      "w-full text-left px-4 py-3 border-b border-[var(--dtg-border-medium)]/60 transition-colors",
                      isSelected
                        ? "bg-[var(--dtg-bg-primary)] border-l-2 border-l-[var(--dtg-brand-orange)]"
                        : "hover:bg-[var(--dtg-bg-primary)]/50",
                    ].join(" ")}
                  >
                    <p className="text-sm font-medium truncate">{folderDisplayLabel(folder)}</p>
                    <p className="text-[11px] text-[var(--dtg-text-secondary)] mt-0.5">
                      {formatTimestamp(folder.commenced_at, timezone)}
                    </p>
                    <p className="text-[11px] text-[var(--dtg-text-secondary)]">
                      retired {formatTimestamp(folder.decommissioned_at, timezone)}
                    </p>
                  </button>
                );
              })
            )}
          </div>

          {/* Selected folder */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!selectedFolder ? (
              <p className="p-6 text-sm text-[var(--dtg-text-secondary)]">
                Select a folder to read what was recorded under it.
              </p>
            ) : (
              <>
                <div className="px-5 pt-4">
                  <h3 className="text-lg font-semibold">{folderDisplayLabel(selectedFolder)}</h3>
                  <p className="text-xs text-[var(--dtg-text-secondary)]">
                    {formatTimestamp(selectedFolder.commenced_at, timezone)} →{" "}
                    {formatTimestamp(selectedFolder.decommissioned_at, timezone)}
                  </p>
                </div>

                <div className="flex items-center border-b border-[var(--dtg-border-medium)] mt-3 px-5">
                  {SECTIONS.map(({ key, label }) => {
                    const isActive = section === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSection(key)}
                        className={[
                          "px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap focus:outline-none border-b-2",
                          isActive
                            ? "border-[var(--dtg-brand-orange)] text-[var(--dtg-text-primary)] font-semibold"
                            : "border-transparent text-[var(--dtg-text-muted)] hover:text-[var(--dtg-text-secondary)]",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 overflow-y-auto p-5">{sectionBody()}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
