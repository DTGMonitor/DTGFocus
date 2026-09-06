"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import toast from "react-hot-toast";
import { Loader, PowerOff } from "lucide-react";
import { toUTC } from "@/utils/timezoneUtils";
import {
  ARCHIVE_TYPE,
  decommissionLogEntries,
  decommissionStamps,
  hasSideEffects,
  impactLines,
  nowOnSiteClock,
  planDowntimeClosures,
  validateDecommission,
  type DecommissionImpact,
  type DecommissionRow,
} from "@/utils/radarDecommission";

/**
 * DecommissionRadarModal
 *
 * Takes one radar out of service, which is what moves it off the hourly
 * checklist. The mechanics and the reasoning live in utils/radarDecommission.ts;
 * this is the form and the write sequence.
 *
 * The panel is deliberately loud about consequences. From the board row an
 * operator can see the radar and its status, but not that it is carrying an open
 * downtime record or three active deformations — and those are exactly the rows
 * that go on lying about a radar that has left the site if nobody closes them.
 * So the modal counts them first and says so before the button is pressed.
 *
 * Props:
 *   isOpen    {boolean}
 *   row       {DecommissionRow}  the board row: radar id, wall folder, area, site
 *   timezone  {string}           IANA timezone of the SITE — the clock the
 *                                operator is picking the end of service on
 *   userID    {string}           work_log.submitted_by
 *   onClose   {Function}
 *   onDone    {Function}         after a successful decommission
 */

/** Why radars actually leave a site. Suggestions, not a closed list. */
const REASON_SUGGESTIONS = [
  "Contract ended",
  "Relocated to another site",
  "Returned to DTG",
  "Area mined out — monitoring complete",
  "Replaced by another radar",
  "Unit faulty — removed from site",
];

interface DecommissionRadarModalProps {
  isOpen: boolean;
  row: DecommissionRow | null;
  timezone?: string | null;
  userID?: string;
  onClose: () => void;
  onDone?: () => void;
}

const labelClass = "text-xs text-[var(--dtg-gray-700)]";

export default function DecommissionRadarModal({
  isOpen,
  row,
  timezone,
  userID,
  onClose,
  onDone,
}: DecommissionRadarModalProps) {
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // What this decommission will reach, counted from the database rather than
  // guessed from the row — see the note at the top of the file.
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [folderIds, setFolderIds] = useState<number[]>([]);
  const [impact, setImpact] = useState<DecommissionImpact>({ folders: 0, downtime: 0, deformations: 0 });

  const loadImpact = useCallback(async () => {
    if (!row?.id) return;
    setLoadingImpact(true);
    setImpactError(null);
    try {
      // Every folder the radar still has open, not just the one the board row
      // stands on: the view shows a radar's LATEST folder, and a radar that
      // somehow carries two live ones must not leave one of them behind.
      const { data: folders, error: folderError } = await supabase
        .from("radar_wall_folders")
        .select("id")
        .eq("radar_id", row.id)
        .neq("type", ARCHIVE_TYPE);
      if (folderError) throw folderError;

      const ids = (folders || []).map((f: { id: number }) => f.id);
      setFolderIds(ids);

      if (ids.length === 0) {
        setImpact({ folders: 0, downtime: 0, deformations: 0 });
        return;
      }

      const [downtimeRes, defRes] = await Promise.all([
        supabase.from("downtime_records").select("id").in("wallfolder", ids).is("to", null),
        supabase.from("def_records").select("id").in("wallfolder_id", ids).eq("isactive", "Yes"),
      ]);
      if (downtimeRes.error) throw downtimeRes.error;
      if (defRes.error) throw defRes.error;

      setImpact({
        folders: ids.length,
        downtime: (downtimeRes.data || []).length,
        deformations: (defRes.data || []).length,
      });
    } catch (err) {
      console.error("Could not read what this decommission would touch:", err);
      setImpactError(
        "Could not read the radar's open records. Decommissioning now may leave downtime accruing — retry before continuing."
      );
    } finally {
      setLoadingImpact(false);
    }
  }, [row?.id]);

  useEffect(() => {
    if (!isOpen) return;
    setAt(nowOnSiteClock(timezone));
    setReason("");
    setImpactError(null);
    setFolderIds([]);
    setImpact({ folders: 0, downtime: 0, deformations: 0 });
    loadImpact();
  }, [isOpen, timezone, loadImpact]);

  const handleSubmit = async () => {
    if (!row) return;
    if (!userID) {
      toast.error("User ID not available. Please refresh the page.");
      return;
    }

    const problem = validateDecommission({ at, reason }, row);
    if (problem) {
      toast.error(problem);
      return;
    }

    const instant = toUTC(at, timezone || "UTC");
    if (!instant) {
      toast.error("That date and time could not be read.");
      return;
    }
    const stamps = decommissionStamps(instant, timezone);

    // The board row's own folder is always in scope, even if the folder read
    // above failed or came back empty — that read is for counting, not for
    // deciding what gets archived.
    const targets = Array.from(
      new Set([...(folderIds || []), row.wallfolder_id].filter((id): id is number => typeof id === "number"))
    );

    setSubmitting(true);
    try {
      // 1. Close whatever downtime is still running. FIRST, because this is the
      //    write that stops availability accruing forever, and a failure here
      //    must leave the radar visibly on the board rather than silently gone
      //    with the meter still running.
      const { data: openRecords, error: openError } = await supabase
        .from("downtime_records")
        .select("id, wallfolder, from")
        .in("wallfolder", targets)
        .is("to", null);
      if (openError) throw openError;

      for (const closure of planDowntimeClosures(openRecords || [], stamps.instant)) {
        const { error } = await supabase
          .from("downtime_records")
          .update({ to: closure.to })
          .eq("id", closure.id);
        if (error) throw error;
      }

      // 2. Resolve the deformations, so a radar off site stops carrying a TARP.
      const { error: defError } = await supabase
        .from("def_records")
        .update({ isactive: "No" })
        .in("wallfolder_id", targets)
        .eq("isactive", "Yes");
      if (defError) throw defError;

      // 3. Stamp the radar BEFORE archiving its folders. The two cannot be one
      //    transaction from the browser, and of the two half-states this is the
      //    recoverable one: a stamped radar whose folder is still live shows up
      //    in both lists and can be finished off. The reverse — archived folder,
      //    unstamped radar — is a row that has left the board with nothing left
      //    pointing at it.
      const { error: radarError } = await supabase
        .from("radars")
        .update({ decommissioned_at: stamps.serviceDate })
        .eq("id", row.id);
      if (radarError) throw radarError;

      // 4. Archive the folders. This is the write the checklist actually reads.
      const { error: wallError } = await supabase
        .from("radar_wall_folders")
        .update({ type: ARCHIVE_TYPE, decommissioned_at: stamps.instant })
        .in("id", targets);
      if (wallError) throw wallError;

      // 5. The work log is a record OF the decommission, not a precondition for
      //    it — the same trade the status flows make.
      const { error: logError } = await supabase
        .from("work_log")
        .insert(decommissionLogEntries(row, targets, reason, userID, new Date().toISOString()));
      if (logError) console.error("Decommission work log insert failed:", logError);

      toast.success(
        `${row.radar_number} decommissioned — removed from the checklist. Recommission it from "Show decommissioned".`
      );
      onDone?.();
      onClose();
    } catch (err) {
      const message = (err as { message?: string })?.message || "Unknown error";
      console.error("Failed to decommission radar:", err);
      toast.error(`Could not decommission ${row.radar_number}: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!row) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PowerOff className="w-4 h-4 text-red-500" />
            Decommission {row.radar_number}
          </DialogTitle>
          <p className={labelClass}>
            {row.site_name}
            {row.area ? ` · ${row.area}` : ""}
            {row.status ? ` · currently ${row.status}` : ""}
          </p>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label className={labelClass}>
              Service ended {timezone ? `(${timezone})` : "(UTC)"} *
            </label>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            <p className={labelClass}>
              On the site&apos;s clock — the same clock the outage records and the availability chart are
              read against.
            </p>
          </div>

          <div className="grid gap-1.5">
            <label className={labelClass}>Reason *</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this radar leaving service?"
              list="dtg-decommission-reasons"
            />
            <datalist id="dtg-decommission-reasons">
              {REASON_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <p className={labelClass}>Recorded in the work log — the only trace of why this happened.</p>
          </div>

          {/* Amber only when the decommission reaches past the wall folder.
              Archiving a folder is routine; closing somebody's open downtime
              record or resolving a live TARP is not, and the operator should be
              made to read that line rather than skim it. */}
          <div
            className={`rounded-md border p-3 ${
              !loadingImpact && hasSideEffects(impact)
                ? 'border-amber-500/50 bg-amber-500/10'
                : 'border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-primary)]'
            }`}
          >
            <p className="text-xs text-[var(--dtg-text-primary)] mb-2">What this does</p>
            {loadingImpact ? (
              <p className="flex items-center gap-2 text-xs text-[var(--dtg-gray-700)]">
                <Loader size={14} className="animate-spin" />
                Checking what this radar still has open...
              </p>
            ) : (
              <ul className="space-y-1">
                {impactLines(impact).map((line) => (
                  <li key={line} className="text-xs text-[var(--dtg-text-secondary)] flex gap-2">
                    <span className="text-[var(--dtg-gray-500)]">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
            {impactError && <p className="mt-2 text-xs text-red-500">{impactError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || loadingImpact}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting && <Loader size={16} className="animate-spin mr-2" />}
            {submitting ? "Decommissioning..." : "Decommission"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
