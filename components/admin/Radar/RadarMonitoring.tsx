import React, { useState, useEffect, useCallback, useRef } from "react";
import { getRiskColor, getStatusColor, getQualityColor, getBandColor } from "@/config/statusConfig";
import { resolveRiskPresentation, pendingPresentation } from "@/config/riskDisplay";
import type { RiskPresentation, RiskRecordLike } from "@/config/riskDisplay";
import { CheckCircle, XCircle, AlertTriangle, Activity, Clock, Download, RefreshCw, TrendingUp, Zap, Loader, Plus } from 'lucide-react';
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { supabase } from '@/lib/supabaseClient';
import { useUserSite } from '@/components/Reusable/useUserSite';
import SensorDetail from '@/components/admin/Radar/SensorDetail';
import { LocalTime } from "@/components/Reusable/Formatting";
import { HandoverTemplate } from "@/components/admin/Reports/HandoverTemplates";
import AddSensorModal from '@/components/admin/Radar/AddSensorModal';
import {
  blankChecks,
  clearedShiftHours,
  localClock,
  nextChecks,
  shiftChecks as composeShiftChecks,
  shiftWindow,
  toChecks,
  withStoredDay
} from '@/utils/checklistDay';
import { carriedChecks, predecessorFolderIds } from '@/utils/checklistCarryOver';
import type { FolderLike } from '@/utils/checklistCarryOver';
import toast, { Toaster } from 'react-hot-toast';


interface RadarWallFolder {
  id: number;
  radar_number: string;
  station: number;
  site_name: string;
  wallfolder_id: number;
  dqp_record_id: number;
  type: string;
  area: string;
  /** Highest TARP level, straight from the view. Kept as the raw fact. */
  risk: string;
  /** How this sensor's site words that risk. Resolved in withRiskPresentation. */
  riskInfo?: RiskPresentation;
  status: string;
  quality: string;
  hourlychecks: boolean[] | null;
  created_time: string;
  wallfolder?: {
    id: number;
    type: string;
    name: string;
  }[] | any;
  timezone: string;
  total_score: number;
  normalised_score: number;
};

// 1. Add this interface above your component or with your other interfaces
interface UserSiteData {
  user_id: string;
  displayname: string;
  // Add other properties if you know them, e.g., site_name: string;
};

interface ShiftStats {
  events: number;
  alarms: number;
};

const shifts = {
  DS: { label: 'Day Shift (07-18)', hours: ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'], indices: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] },
  NS: { label: 'Night Shift (19-06)', hours: ['19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06'], indices: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6] },
  C: { label: 'Cross Shift (11-22)', hours: ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'], indices: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] }
};



function RadarMonitoring() {
  const [liveViewList, setLiveViewList] = useState<RadarWallFolder[]>([]);
  const [stats, setStats] = useState<ShiftStats>({ events: 0, alarms: 0 });
  const [loadingLiveViewList, setLoadingLiveViewList] = useState(false);
  const [viewSensorDetail, setViewSensorDetail] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState<RadarWallFolder | null>(null);
  const [selectedShift, setSelectedShift] = useState<'DS' | 'NS' | 'C'>(() => {
    const currentHour = new Date().getHours()

    if (currentHour >= 6 && currentHour <= 18) {
      return 'DS'
    }
    return 'NS'
  }
  );

  const [selectedStation, setSelectedStation] = useState("1");
  const { userSite, loading: siteLoading } = useUserSite() as { userSite: UserSiteData | null, loading: boolean };
  const userID = userSite?.user_id;

  // Keep a live ref of the list so serialized toggles read the freshest checklist.
  const liveViewListRef = useRef<RadarWallFolder[]>([]);
  // Per-record promise chain that serializes toggles, preventing the
  // read-then-insert race that created duplicate dqp_records.
  const toggleLocks = useRef<Map<string, Promise<unknown>>>(new Map());
  // Every wall folder the board's radars have ever had, archived ones included:
  // what a re-aimed radar carries its checklist from. Loaded with the board.
  const radarFoldersRef = useRef<FolderLike[]>([]);

  const [showPreview, setShowPreview] = useState(false);
  const [showAddSensor, setShowAddSensor] = useState(false);

  useEffect(() => {
    liveViewListRef.current = liveViewList;
  }, [liveViewList]);

  const isCheckboxDisabled = (hourIndex: number) => {
    // The operator's own clock — the columns are their hours, in their day.
    const { hour: currentHour, minute: currentMinute } = localClock();

    const targetHour = shifts[selectedShift].indices[hourIndex];

    if (selectedShift === 'NS') {
      if (targetHour < 12 && currentHour >= 18) {
        return false
      }

      if (currentHour < 12 && targetHour >= 18) {
        return true;
      }
    }

    if (currentHour > targetHour) {
      return true
    };
    if (currentHour === targetHour && currentMinute > 0) {
      return true
    };

    return false
  };

  /**
   * The checklist a folder with no record of its own for `recordDate` inherits
   * from the folder it replaced. Null when nothing carries.
   *
   * See utils/checklistCarryOver.ts — scoped to the one date, and to folders the
   * radar has retired.
   */
  const carriedFor = async (
    sensor: RadarWallFolder,
    recordDate: string
  ): Promise<boolean[] | null> => {
    const predecessors = predecessorFolderIds(
      radarFoldersRef.current,
      sensor.id,
      sensor.wallfolder_id
    );
    if (predecessors.length === 0) return null;

    const { data, error } = await supabase
      .from('dqp_records')
      .select('wall_folder_id, checklist')
      .in('wall_folder_id', predecessors)
      .eq('record_date', recordDate);

    if (error) {
      // A folder change without its history is still workable — the day just
      // starts blank, as it did before carry-over existed.
      console.error('Error reading the previous folder\'s checklist:', error);
      return null;
    }

    return carriedChecks(
      predecessors,
      new Map((data || []).map((r) => [r.wall_folder_id, r.checklist]))
    );
  };

  /**
   * Persist one sensor's checklist for one record date.
   *
   * `decide` receives what already stands for that date — the folder's own
   * record, else the folder it replaced (a re-aimed radar keeps the shift it was
   * halfway through), else null when nothing is recorded at all — and returns the
   * array to write, or null to leave the date alone.
   *
   * The new array is derived from the row just read, never from what is on
   * screen: the view hands back the newest dqp_record whatever its date, so a
   * sensor nobody checked yesterday displays an older day's ticks, and writing
   * those forward stamped them onto today's record. They then sat on hours the
   * gate had already locked, which is what made a wrongly-ticked row impossible
   * to clear.
   *
   * Resolves with the array that stands for that date afterwards.
   */
  const writeChecklist = async (
    sensor: RadarWallFolder,
    recordDate: string,
    decide: (dayChecks: boolean[] | null) => boolean[] | null
  ): Promise<boolean[]> => {
    const { data: existingRecord, error: fetchError } = await supabase
      .from('dqp_records')
      .select('id, checklist')
      .eq('wall_folder_id', sensor.wallfolder_id)
      .eq('record_date', recordDate)
      .maybeSingle();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      throw fetchError;
    }

    const standing = existingRecord
      ? toChecks(existingRecord.checklist)
      : await carriedFor(sensor, recordDate);

    const newChecks = decide(standing);
    // Nothing to change on this date — don't create a record just to hold blanks.
    if (!newChecks) return standing ?? blankChecks();

    if (existingRecord) {
      const { error: updateError } = await supabase
        .from('dqp_records')
        .update({
          checklist: newChecks,
          created_time: new Date().toISOString(),
          created_by: userID
        })
        .eq('id', existingRecord.id);

      if (updateError) {
        console.error('Update error:', updateError);
        throw updateError;
      }
      return newChecks;
    }

    // First write of this folder's day. The working notes carry forward from the
    // folder's own previous record; ticks only ever carry within one date, and
    // only from the folder this one replaced (see carriedFor).
    const { data: latestRecord, error: latestError } = await supabase
      .from('dqp_records')
      .select('id, notes, action')
      .eq('wall_folder_id', sensor.wallfolder_id)
      .order('record_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error('Latest record fetch error:', latestError);
    }

    const { data: insertedData, error: insertError } = await supabase
      .from('dqp_records')
      .insert({
        radar_id: sensor.id,
        wall_folder_id: sensor.wallfolder_id,
        record_date: recordDate,
        checklist: newChecks,
        created_time: new Date().toISOString(),
        created_by: userID,
        notes: latestRecord?.notes || null,
        action: latestRecord?.action || null
      })
      .select();

    if (insertError) {
      // Another client (e.g. a second tab) created today's record between our
      // existence check and this insert. The unique (wall_folder_id, record_date)
      // constraint caught the duplicate — fall back to updating the existing row
      // instead of erroring out and reverting the user's tick.
      if (insertError.code === '23505') {
        console.warn('Duplicate blocked by unique constraint; updating existing row instead');
        const { error: conflictUpdateError } = await supabase
          .from('dqp_records')
          .update({
            checklist: newChecks,
            created_time: new Date().toISOString(),
            created_by: userID
          })
          .eq('wall_folder_id', sensor.wallfolder_id)
          .eq('record_date', recordDate);

        if (conflictUpdateError) {
          console.error('Conflict update error:', conflictUpdateError);
          throw conflictUpdateError;
        }
        // The row already existed, so its dqp_values were already seeded — don't
        // re-copy them (that would create duplicate dqp_values).
        return newChecks;
      }
      console.error('Insert error:', insertError);
      throw insertError;
    }

    // Copy dqp_values from previous record if it exists
    if (latestRecord?.id && insertedData && insertedData.length > 0) {
      const newRecordId = insertedData[0].id;

      const { data: previousValues, error: valuesError } = await supabase
        .from('dqp_values')
        .select('*')
        .eq('dqp_record_id', latestRecord.id);

      if (valuesError) {
        console.error('Error fetching previous dqp_values:', valuesError);
      } else if (previousValues && previousValues.length > 0) {
        // Prepare new values with updated dqp_record_id
        const newValues = previousValues.map(({ id, created_at, ...value }) => ({
          ...value,
          dqp_record_id: newRecordId
        }));

        const { error: insertValuesError } = await supabase
          .from('dqp_values')
          .insert(newValues);

        if (insertValuesError) {
          console.error('Error inserting dqp_values:', insertValuesError);
        }
      }
    }

    return newChecks;
  };

  /**
   * Serialize checklist writes per record: the next write only runs after the
   * previous one has fully committed. This kills the read-then-insert race where
   * a quick check-then-uncheck both saw "no record yet" and each inserted a row,
   * leaving two dqp_records with the same wall_folder_id + record_date. Keyed by
   * both, since a night shift's two dates are two rows that cannot race.
   */
  const queueChecklistWrite = (
    sensor: RadarWallFolder,
    recordDate: string,
    decide: (dayChecks: boolean[] | null) => boolean[] | null
  ): Promise<boolean[]> => {
    const key = `${sensor.wallfolder_id}:${recordDate}`;
    const previous = toggleLocks.current.get(key) ?? Promise.resolve();
    const current = previous.then(() => writeChecklist(sensor, recordDate, decide));
    // Swallow errors on the stored lock so one failure doesn't break the chain.
    toggleLocks.current.set(key, current.catch(() => {}));
    return current;
  };

  const toggleHourlyCheck = async (ssrIndex: number, hourIndex: number) => {
    if (!userID) {
      console.error('User ID not available:', userID);
      toast.error('User ID not available. Please refresh the page.');
      return;
    }

    const sensor = liveViewListRef.current[ssrIndex];
    if (!sensor || sensor.wallfolder_id == null) return;

    if (isCheckboxDisabled(hourIndex)) {
      toast.error('This time slot has passed and can no longer be checked.');
      return;
    }

    const indices = shifts[selectedShift].indices;
    const shiftDates = shiftWindow(indices);
    const actualIndex = indices[hourIndex];
    // The record this slot belongs to — for the night shift, 01:00 is the day
    // after the 19:00 that opened the same shift.
    const recordDate = shiftDates.dateForHour(actualIndex);
    const previousChecks = toChecks(sensor.hourlychecks);
    // What the click asks for, read off the box the user actually saw.
    const desired = !previousChecks[actualIndex];

    // Update UI optimistically
    setLiveViewList((prev) =>
      prev.map((s, sIdx) => {
        if (sIdx !== ssrIndex) return s;
        const optimistic = toChecks(s.hourlychecks);
        optimistic[actualIndex] = desired;
        return { ...s, hourlychecks: optimistic, created_time: new Date().toISOString() };
      })
    );

    try {
      const stored = await queueChecklistWrite(sensor, recordDate, (dayChecks) =>
        nextChecks(dayChecks, actualIndex, desired)
      );

      // Settle on what was actually stored, for the hours that date owns — the
      // other date of a night shift keeps what it is already showing.
      setLiveViewList((prev) =>
        prev.map((s, sIdx) =>
          sIdx === ssrIndex
            ? { ...s, hourlychecks: withStoredDay(s.hourlychecks, indices, shiftDates, recordDate, stored) }
            : s
        )
      );
    } catch (error) {
      console.error('Error updating checklist:', error);
      // Revert UI on error
      setLiveViewList((prev) =>
        prev.map((s, sIdx) =>
          sIdx === ssrIndex ? { ...s, hourlychecks: previousChecks } : s
        )
      );
      toast.error(`Failed to update checklist: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  /**
   * Replace each row's checklist with the one the displayed shift actually stands
   * on — which is one record for the day and cross shifts, and two for the night
   * shift, whose evening hours are filed under the date it started.
   *
   * Three ways the view's own `hourlychecks` misleads, all corrected here:
   *
   *   - `latest_radar_wall_folders` carries the newest dqp_record for a wallfolder
   *     whatever its date, so a sensor that went unchecked yesterday arrives
   *     holding yesterday's ticks, which read as today's work and inflate the
   *     completion figures below.
   *   - it is one record, so at midnight a night shift lost the 19:00..23:00 it
   *     had already verified.
   *   - it is keyed by wall folder, so a radar re-aimed mid-shift arrived blank.
   *     A folder with no record of its own for a date carries the retired
   *     folder's — see utils/checklistCarryOver.ts.
   */
  const withShiftChecklists = async (rows: RadarWallFolder[]): Promise<RadarWallFolder[]> => {
    const wallfolderIds = rows
      .map((r) => r.wallfolder_id)
      .filter((id): id is number => id != null);
    if (wallfolderIds.length === 0) return rows;

    const indices = shifts[selectedShift].indices;
    const shiftDates = shiftWindow(indices);
    const radarIds = Array.from(new Set(rows.map((r) => r.id).filter((id) => id != null)));

    // Every folder these radars have, retired ones included: the board only shows
    // the live one, and carry-over needs to know what came before it.
    const { data: folderData, error: folderError } = await supabase
      .from('radar_wall_folders')
      .select('id, radar_id, type, commenced_at, decommissioned_at')
      .in('radar_id', radarIds);

    if (folderError) {
      // Without the folder history there is no carry-over, but the shift's own
      // records still read correctly. Don't fail the board over it.
      console.error('Error fetching wall folder history:', folderError);
    }
    const folders = (folderData as FolderLike[]) || [];
    radarFoldersRef.current = folders;

    const readableIds = Array.from(
      new Set([...wallfolderIds, ...folders.map((f) => f.id)])
    );

    const { data, error } = await supabase
      .from('dqp_records')
      .select('wall_folder_id, record_date, checklist')
      .in('wall_folder_id', readableIds)
      .in('record_date', shiftDates.dates);

    if (error) {
      // Keep the view's value rather than blanking the whole board on a
      // transient read failure.
      console.error("Error fetching the shift's checklists:", error);
      return rows;
    }

    // date → wall folder → checklist. Sliced to the calendar date so the key
    // matches shiftDates whatever PostgREST hands back for the column.
    const byDate = new Map<string, Map<number, boolean[] | null>>();
    (data || []).forEach((r) => {
      const date = String(r.record_date).slice(0, 10);
      const forDate = byDate.get(date) ?? new Map<number, boolean[] | null>();
      forDate.set(r.wall_folder_id, r.checklist);
      byDate.set(date, forDate);
    });

    return rows.map((r) => {
      const predecessors = predecessorFolderIds(folders, r.id, r.wallfolder_id);

      return {
        ...r,
        hourlychecks: composeShiftChecks(indices, shiftDates, (date) => {
          const forDate = byDate.get(date) ?? new Map<number, boolean[] | null>();
          if (forDate.has(r.wallfolder_id)) return forDate.get(r.wallfolder_id);
          return carriedChecks(predecessors, forDate);
        })
      };
    });
  };

  /**
   * Attach each row's risk line, worded the way its SITE words it.
   *
   * The view's `risk` column is the highest TARP level across the sensor's
   * active deformation records — true for Telfer, but Leonora only quotes a
   * level at TARP 3 and 4, and Hidden Valley quotes none at all. The wording
   * needs the deformation TYPE behind the level, which the view does not carry,
   * so the records are read here and resolved by config/riskDisplay.ts. One
   * query for the whole board.
   */
  const withRiskPresentation = async (rows: RadarWallFolder[]): Promise<RadarWallFolder[]> => {
    const wallfolderIds = rows
      .map((r) => r.wallfolder_id)
      .filter((id): id is number => id != null);
    if (wallfolderIds.length === 0) return rows;

    const { data, error } = await supabase
      .from('def_records')
      .select('wallfolder_id, def_type, tarp_level, created_at, location')
      .in('wallfolder_id', wallfolderIds)
      .eq('isactive', 'Yes');

    if (error) {
      // The board is still usable without it — each row falls back to whatever
      // its site can say from the view alone.
      console.error('Error fetching active deformations:', error);
      return rows.map((r) => ({ ...r, riskInfo: pendingPresentation(r) }));
    }

    const byFolder = new Map<number, RiskRecordLike[]>();
    (data || []).forEach((rec: RiskRecordLike & { wallfolder_id: number }) => {
      const list = byFolder.get(rec.wallfolder_id);
      if (list) list.push(rec);
      else byFolder.set(rec.wallfolder_id, [rec]);
    });

    return rows.map((r) => ({
      ...r,
      riskInfo: resolveRiskPresentation(byFolder.get(r.wallfolder_id) ?? [], r)
    }));
  };

  const fetchLiveView = useCallback(async () => {
    if (!selectedStation) return;
    try {
      setLoadingLiveViewList(true);
      const { data, error } = await supabase
        .from('latest_radar_wall_folders')
        .select('id, radar_number, site_id, station, site_name, wallfolder_id, wallfolder:radar_wall_folders!inner(id, type, name), dqp_record_id, type, area, risk, status, quality, hourlychecks, created_time, timezone, total_score, normalised_score')
        .neq('type', 'Archive')
        .eq('station', selectedStation)
        .order('id');

      if (error) throw error;


      setLiveViewList(
        await withRiskPresentation(await withShiftChecklists((data as RadarWallFolder[]) || []))
      );
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoadingLiveViewList(false);
    }
    ;
    // The shift decides which record dates the grid is assembled from, so
    // switching shift has to re-read, not just re-slice what is in state.
  }, [selectedStation, selectedShift]);

  /**
   * Clear the displayed shift's checklist for these sensors — in the database,
   * not just on screen.
   *
   * Reset used to clear state alone, so the ticks came straight back on the next
   * refetch (a shift change, a closed sensor detail, a reload). With the hour
   * gate refusing clicks on slots that have passed, a row holding ticks nobody
   * meant to make had no way out at all. Clearing has to reach dqp_records.
   *
   * It reaches every record the shift stands on — both dates of a night shift —
   * but only that shift's own hours: a night operator resetting their grid must
   * not take the day shift's morning with it. A date holding nothing is left
   * alone rather than given an empty record.
   */
  const clearChecklists = async (sensors: RadarWallFolder[]) => {
    if (!userID) {
      console.error('User ID not available:', userID);
      toast.error('User ID not available. Please refresh the page.');
      return;
    }
    if (sensors.length === 0) return;

    const indices = shifts[selectedShift].indices;
    const shiftDates = shiftWindow(indices);

    const clearing = new Set(sensors.map((s) => s.wallfolder_id));
    // A row only ever holds the displayed shift's hours, so blanking it on screen
    // says exactly "this shift is cleared".
    setLiveViewList((prev) =>
      prev.map((s) => (clearing.has(s.wallfolder_id) ? { ...s, hourlychecks: blankChecks() } : s))
    );

    const results = await Promise.allSettled(
      sensors.flatMap((sensor) =>
        shiftDates.dates.map((date) =>
          queueChecklistWrite(sensor, date, (dayChecks) =>
            dayChecks ? clearedShiftHours(dayChecks, indices, shiftDates, date) : null
          )
        )
      )
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.error('Checklist clear failures:', failed.map((f) => (f as PromiseRejectedResult).reason));
      toast.error(`Failed to clear ${failed.length} of ${results.length} records.`);
    } else {
      toast.success(
        sensors.length === 1
          ? `Cleared this shift's checklist for ${sensors[0].radar_number}.`
          : `Cleared this shift's checklist for ${sensors.length} sensors.`
      );
    }

    // Re-read rather than trust the optimistic state — a partial failure leaves
    // the board honest about what actually got cleared.
    fetchLiveView();
  };

  /** Clear one row. The narrow case: a single radar carrying ticks it shouldn't. */
  const handleClearSensorChecklist = (ssrIndex: number) => {
    const sensor = liveViewListRef.current[ssrIndex];
    if (!sensor || sensor.wallfolder_id == null) return;

    if (!window.confirm(
      `Clear the ${shifts[selectedShift].label} checklist for ${sensor.radar_number} (${sensor.site_name})?`
    )) return;

    clearChecklists([sensor]);
  };

  /**
   * Clear every row on the station.
   *
   * The confirm names the sites because this reaches sensors the operator may
   * not have come here for: a station mixes Telfer with Hidden Valley, and an
   * hour cleared here cannot be re-ticked once the gate has closed on it.
   */
  const handleResetChecklist = () => {
    const sensors = liveViewListRef.current.filter((s) => s.wallfolder_id != null);
    if (sensors.length === 0) return;

    const sites = Array.from(new Set(sensors.map((s) => s.site_name))).join(', ');
    if (!window.confirm(
      `Clear the ${shifts[selectedShift].label} checklist for all ${sensors.length} sensors on station ${selectedStation} (${sites})?\n\n` +
      `Checks already recorded this shift will be lost, and hours that have passed cannot be re-ticked. ` +
      `To clear a single radar instead, use the reset icon on its row.`
    )) return;

    clearChecklists(sensors);
  };

  useEffect(() => {
    fetchLiveView()
  },
    [fetchLiveView]);

  // In Parent Component

  // Add this Effect to auto-update the popup when the background list refreshes
  useEffect(() => {
    if (selectedSensor && liveViewList.length > 0) {
      // Find the updated version of the currently selected sensor
      const updatedVersion = liveViewList.find(s => s.id === selectedSensor.id);

      // If we found it, and it looks different (e.g. different wallfolder), update the state!
      if (updatedVersion && updatedVersion.wallfolder_id !== selectedSensor.wallfolder_id) {
        console.log("Syncing selected sensor with new data...");
        setSelectedSensor(updatedVersion);
      }
    }
  }, [liveViewList, selectedSensor]);

  // ---- Handle Explore ----
  const handleExplore = (wallFolderID: number) => {
    const wallFolderIDData = liveViewList.find((r) => r.wallfolder_id === wallFolderID);
    setSelectedSensor(wallFolderIDData || null);
    setViewSensorDetail(true)
  };

  const currentShift = shifts[selectedShift];
  const onlineDevices = liveViewList.filter(s => s.status !== 'Link Down').length;
  const totalDevices = liveViewList.length;
  const latestUpdate = new Date(Math.max(...liveViewList.map(s => new Date(s.created_time).getTime())));
  const qualityOrder = ['Critical', 'Sub-Optimal', 'Acceptable', 'Optimal'];


  const fetchStats = useCallback(async () => {

    // 2. Call the RPC
    const { data, error } = await supabase
      .rpc('get_my_shift_counts', {
        _user_timezone: 'Asia/Jakarta',
        _shift: selectedShift
      });

    if (error) {
      console.error('Error fetching shift stats:', error);
    } else {
      // RPC returns JSON, so we cast it to our interface
      setStats(data as ShiftStats);
    }
  }, [selectedShift]);

  useEffect(() => {
    fetchLiveView(); fetchStats()
  },
    [fetchLiveView, fetchStats]);

  const totalAlarms = stats.alarms;
  const totalEvents = stats.events;
  if (loadingLiveViewList) {
    return (
      <div className="flex justify-center items-center p-10 text-[var(--dtg-gray-400)]">
        <Loader size={24} className="animate-spin mr-2" />
        Checking user permissions...
      </div>
    );
  }

  if (!liveViewList || liveViewList.length === 0) {
    // Still offer "Add Sensor" here — an empty station is exactly when a new
    // sensor needs commissioning, and the main toolbar below never renders.
    return (
      <div className="w-full space-y-4 p-6">
        <Toaster position="top-center" reverseOrder={false} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl text-[var(--dtg-text-primary)]">SSR Monitoring &amp; Hourly Checklist</h1>
            <p className="text-[var(--dtg-gray-700)] text-sm">No sensors found for station {selectedStation}.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 mr-4">
              <label className="text-sm text-[var(--dtg-gray-700)]">Station:</label>
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[var(--dtg-border-medium)] rounded bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
              >
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </div>
            <Button variant="brand" size="sm" onClick={() => setShowAddSensor(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Sensor
            </Button>
          </div>
        </div>
        <AddSensorModal
          isOpen={showAddSensor}
          onClose={() => setShowAddSensor(false)}
          userID={userID}
          onSuccess={() => { fetchLiveView(); }}
        />
      </div>
    );
  }

  // 2. Your Logic (Safe to run now)
  const lowestQuality = liveViewList.reduce((low, curr) => {
    const lowestIndex = qualityOrder.indexOf(low.quality);
    const currentIndex = qualityOrder.indexOf(curr.quality);
    // Ensure we handle cases where a quality isn't found in the order array (-1)
    if (currentIndex === -1) return low;
    return currentIndex < lowestIndex ? curr : low;
  });

  // Calculate stats for selected shift only
  const getShiftChecks = (checks: boolean[] | null) => {
    const allChecks = checks || Array(24).fill(false);
    return currentShift.indices.map(idx => allChecks[idx]);
  };

  const completedChecks = liveViewList.reduce((acc, s) => {
    const shiftChecks = getShiftChecks(s.hourlychecks);
    return acc + shiftChecks.filter(Boolean).length;
  }, 0);

  const missedChecks = liveViewList.reduce((acc, s) => {
    const shiftChecks = getShiftChecks(s.hourlychecks);
    return acc + shiftChecks.filter(c => !c).length;
  }, 0);

  // Red band rather than 'TARP 4': Hidden Valley's most severe row is a "Red
  // Notification" and would otherwise never count as needing attention.
  const attentionRequired = liveViewList.filter(
    s => s.status !== 'Live' || s.quality === 'Critical' || (s.riskInfo?.colour ?? '') === 'red' || s.risk === 'TARP 4'
  ).length;
  const completionRate = liveViewList.length > 0 ? Math.round((completedChecks / (liveViewList.length * 12)) * 100) : 0;

  const reportInfo = {
    user: userSite,
    misscheck: missedChecks,
    completedcheck: completedChecks,
    attentionreq: attentionRequired,
    completion: completionRate,
    shift: selectedShift,
    totalalarm: totalAlarms,
    totalevent: totalEvents,
    onlinedevice: onlineDevices / totalDevices,
    quality: lowestQuality.quality,
    latestupdate: latestUpdate
  };

  return (
    <div className="w-full space-y-4 p-6"> <Toaster position="top-center" reverseOrder={false} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--dtg-text-primary)]">SSR Monitoring & Hourly Checklist</h1>
          <p className="text-[var(--dtg-gray-700)] text-sm">Real-time sensor verification - {new Date().toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-4">
            <label className="text-sm text-[var(--dtg-gray-700)]">Shift:</label>
            <select
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value as 'DS' | 'NS' | 'C')}
              className="px-3 py-1.5 text-sm border border-[var(--dtg-border-medium)] rounded bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
            >
              <option value="DS">Day Shift (06-18)</option>
              <option value="NS">Night Shift (18-06)</option>
              <option value="C">Cross Shift (10-22)</option>
            </select>
          </div>
          <div className="flex items-center gap-2 mr-4">
            <label className="text-sm text-[var(--dtg-gray-700)]">Station:</label>
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="px-3 py-1.5 text-sm border border-[var(--dtg-border-medium)] rounded bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
            >
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={handleResetChecklist}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset
          </Button>

          <Button variant="outline" size="sm" onClick={() => setShowAddSensor(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Sensor
          </Button>

          <Button size="sm" variant="brand" onClick={() => setShowPreview(true)}>
            <Download className="w-4 h-4 mr-2" />
            Preview & Export
          </Button>
        </div>
      </div>

      {/* Compact KPI Cards */}
      <div className="grid grid-cols-5 gap-3">
        <div className="border rounded-lg p-4 bg-gradient-to-br from-[var(--red-from)] to-[var(--red-to)] border-[var(--red-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs mb-1">Total Alarms</p>
              <p className="text-3xl text-white">{totalAlarms}</p>
            </div>
            <AlertTriangle className="w-10 h-10 text-red-500/30" />
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-gradient-to-br from-[var(--blue-from)] to-[var(--blue-to)] border-[var(--blue-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs mb-1">Events</p>
              <p className="text-3xl text-white">{totalEvents}</p>
            </div>
            <Activity className="w-10 h-10 text-blue-500/30" />
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-gradient-to-br from-[var(--green-from)] to-[var(--green-to)] border-[var(--green-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs mb-1">Online</p>
              <p className="text-3xl text-white">{onlineDevices}/{totalDevices}</p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-500/30" />
          </div>
        </div>
        <div className={`border rounded-lg p-4 ${getRiskColor(lowestQuality.quality)}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs mb-1">Overall Quality</p>
              <p className="text-2xl">{lowestQuality.quality}</p>
            </div>
            <TrendingUp className="w-10 h-10" />
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-gradient-to-br from-[var(--purple-from)] to-[var(--purple-to)] border-[var(--purple-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs mb-1">Last Update</p>
              <p className="text-lg text-white"><LocalTime utcTime={latestUpdate} format="full" /></p>
            </div>
            <Clock className="w-10 h-10 text-purple-500/30" />
          </div>
        </div>
      </div>

      {/* Unified Compact Table */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--dtg-bg-primary)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-[var(--dtg-gray-700)] sticky left-0 bg-[var(--dtg-bg-primary)] z-10 border-r border-[var(--dtg-border-medium)]">SSR</th>
                <th className="px-3 py-2 text-left text-xs text-[var(--dtg-gray-700)] min-w-[120px]">Site Name</th>
                <th className="px-3 py-2 text-left text-xs text-[var(--dtg-gray-700)] min-w-[120px]">Area</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)]">Risk</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)]">Status</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)]">Quality</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)] border-l border-b border-[var(--dtg-border-medium)]" colSpan={12}>Hourly Verification (Last 12 Hours)</th>
              </tr>
              <tr className="bg-[var(--dtg-bg-primary)]">
                <th className="border-r border-[var(--dtg-border-medium)]" />
                <th colSpan={5}></th>
                {currentShift.hours.map((hour) => (
                  <th key={hour} className="px-2 py-1 text-center text-[10px] text-[var(--dtg-gray-500)] border-l border-[var(--dtg-border-medium)]">
                    {hour}:00
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liveViewList.map((sensor, sensorIdx) => {
                const allChecks = sensor.hourlychecks || Array(24).fill(false);
                const shiftChecks = currentShift.indices.map(idx => allChecks[idx]);

                return (
                  <tr key={sensor.radar_number} className="group border-t border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-hover)]/50 transition-colors">
                    <td className="px-3 py-3 text-[var(--dtg-text-primary)] sticky left-0 bg-[var(--dtg-bg-card)] z-10 border-r border-[var(--dtg-border-medium)]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono cursor-pointer"
                          onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}>
                          {sensor.radar_number}
                        </span>
                        <button
                          type="button"
                          title={`Clear this shift's checklist for ${sensor.radar_number}`}
                          aria-label={`Clear this shift's checklist for ${sensor.radar_number}`}
                          onClick={(e) => { e.stopPropagation(); handleClearSensorChecklist(sensorIdx); }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)]"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[var(--dtg-text-secondary)] text-sm cursor-pointer"
                      onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}
                    >{sensor.site_name}</td>
                    <td className="px-3 py-3 text-[var(--dtg-text-secondary)] text-sm cursor-pointer"
                      onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}
                    >{sensor.area}</td>
                    <td className="px-3 py-3 text-center cursor-pointer"
                      onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}
                    >
                      <span className={`px-2 py-1 rounded text-xs border ${getBandColor(sensor.riskInfo?.colour)}`}>
                        {sensor.riskInfo?.label ?? sensor.risk}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-center cursor-pointer"
                      onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}>
                      <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(sensor.status)}`}>
                        {sensor.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center cursor-pointer"
                      onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}>
                      <span className={`text-sm px-2 py-1 rounded text-xs border ${getRiskColor(sensor.quality)}`}>
                        {sensor.quality}
                      </span>
                    </td>

                    {shiftChecks.map((checked, hourIdx) => {
                      const disabled = isCheckboxDisabled(hourIdx);

                      return (
                        <td key={hourIdx} className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)]">
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={() => toggleHourlyCheck(sensorIdx, hourIdx)}
                              className={`w-5 h-5 ${disabled
                                ? checked
                                  ? 'bg-green-500/20 border-green-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500'
                                  : 'opacity-50 cursor-not-allowed'
                                : checked
                                  ? 'bg-green-500/20 border-green-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500'
                                  : 'border-gray-600 hover:border-gray-500'
                                }`}
                            />
                          </div>
                        </td>
                      )
                    })}
                  </tr>

                )
              })}
            </tbody>
          </table>
          {viewSensorDetail && <SensorDetail key={selectedSensor?.id} userSite={userSite} timezone={selectedSensor?.timezone} sensor={selectedSensor} onClose={() => { fetchLiveView(), fetchStats(), setViewSensorDetail(false) }} onRefresh={() => { fetchStats(), fetchLiveView() }} onUpdateComplete={() => { fetchStats(), fetchLiveView() }} shift={selectedShift} />}
        </div>
      </div>

      {/* Quick Stats Footer */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Completed Checks</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">{completedChecks}</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Missed Checks</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">{missedChecks}</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-teal-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Completion Rate</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">
                {completionRate}%
              </p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Attention Required</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">{attentionRequired}</p>
            </div>
          </div>
        </div>
      </div>
      {
        showPreview && (
          <HandoverTemplate
            reportInfo={reportInfo}
            data={liveViewList}
            onClose={() => setShowPreview(false)}
            preloadedNotifications={null}
          />
        )
      }
      <AddSensorModal
        isOpen={showAddSensor}
        onClose={() => setShowAddSensor(false)}
        userID={userID}
        onSuccess={() => { fetchLiveView(); }}
      />
    </div > // This is the final closing div of your component
  );
}

export default RadarMonitoring;