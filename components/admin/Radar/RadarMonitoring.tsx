import React, { useState, useEffect } from "react";
import { getRiskColor, getStatusColor, getQualityColor } from "@/config/statusConfig";
import { CheckCircle, XCircle, AlertTriangle, Activity, Clock, Mail, Download, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { Checkbox } from "@/components/LandingPage/ui/checkbox";
import { Button } from "@/components/LandingPage/ui/button";
import { supabase } from '@/lib/supabaseClient';
import { useUserSite } from '@/components/Reusable/useUserSite';
import SensorDetail from '@/components/admin/Radar/SensorDetail';
import { LocalTime } from "@/components/Reusable/Formatting";

interface RadarWallFolder {
  id: number;
  radar_number: string;
  station: number;
  site_name: string;
  wallfolder_id: number;
  dqp_record_id: number;
  type: string;
  area: string;
  risk: string;
  status: string;
  quality: string;
  hourlychecks: boolean[] | null;
  created_time: string;
  wallfolder?: {
    id: number;
    type: string;
    name: string;
  };
}

const shifts = {
  DS: { label: 'Day Shift (07-18)', hours: ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'], indices: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] },
  NS: { label: 'Night Shift (19-06)', hours: ['19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06'], indices: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6] },
  C: { label: 'Contractor (11-22)', hours: ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'], indices: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] }
};

function RadarMonitoring() {
  const [liveViewList, setLiveViewList] = useState<RadarWallFolder[]>([]);
  const [loadingLiveViewList, setLoadingLiveViewList] = useState(false);
  const [viewSensorDetail, setViewSensorDetail] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState(null);
  const [selectedShift, setSelectedShift] = useState<'DS' | 'NS' | 'C'>(() => {
    const currentHour = new Date().getHours()

    if (currentHour >= 6 && currentHour <= 18) {
      return 'DS'
    }
    return 'NS'
  }
  );

  const [selectedStation, setSelectedStation] = useState("1");
  const { userSite, loading: siteLoading } = useUserSite();
  const userID = userSite?.user_id;

  const isCheckboxDisabled = (hourIndex: number) => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

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

  const toggleHourlyCheck = async (ssrIndex: number, hourIndex: number) => {
    if (!userID) {
      console.error('User ID not available:', userID);
      alert('User ID not available. Please refresh the page.');
      return;
    }

    if (isCheckboxDisabled(hourIndex)) {
      alert('This time slot has passed and can no longer be checked.');
      return;
    }

    const sensor = liveViewList[ssrIndex];
    const checks = sensor.hourlychecks || Array(24).fill(false);
    const newChecks = [...checks];
    const actualIndex = shifts[selectedShift].indices[hourIndex];
    newChecks[actualIndex] = !newChecks[actualIndex];

    // Update UI optimistically
    setLiveViewList((prev) =>
      prev.map((s, sIdx) =>
        sIdx === ssrIndex ? { ...s, hourlychecks: newChecks, created_time: new Date().toISOString() } : s
      )
    );

    // Get current date in UTC+7
    const now = new Date();
    const utc7Date = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const todayDate = utc7Date.toISOString().split('T')[0];

    try {
      console.log('Toggling check for:', {
        radar_number: sensor.radar_number,
        wallfolder_id: sensor.wallfolder_id,
        record_date: todayDate,
        userID
      });

      // Check if record exists for today
      const { data: existingRecord, error: fetchError } = await supabase
        .from('dqp_records')
        .select('id, record_date, wall_folder_id, created_time, created_by, notes, action, checklist')
        .eq('wall_folder_id', sensor.wallfolder_id)
        .eq('record_date', todayDate)
        .maybeSingle();

      if (fetchError) {
        console.error('Fetch error:', fetchError);
        throw fetchError;
      }

      console.log('Existing record:', existingRecord);

      if (existingRecord) {
        // Update existing record
        console.log('Updating existing record:', existingRecord.id);
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
        console.log('Update successful');
      } else {
        // Get the most recent record to copy other values
        console.log('No existing record, fetching latest for defaults');
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

        console.log('Latest record:', latestRecord);

        // If no previous record exists or error, use defaults
        const notesValue = latestRecord?.notes || null;
        const actionValue = latestRecord?.action || null;

        const insertData = {
          radar_id: sensor.id,
          wall_folder_id: sensor.wallfolder_id,
          record_date: todayDate,
          checklist: newChecks,
          created_time: new Date().toISOString(),
          created_by: userID,
          notes: notesValue,
          action: actionValue
        };

        console.log('Inserting new record:', insertData);

        // Insert new record with today's date
        const { data: insertedData, error: insertError } = await supabase
          .from('dqp_records')
          .insert(insertData)
          .select();

        if (insertError) {
          console.error('Insert error:', insertError);
          throw insertError;
        }
        console.log('Insert successful:', insertedData);

        // Copy dqp_values from previous record if it exists
        if (latestRecord?.id && insertedData && insertedData.length > 0) {
          const newRecordId = insertedData[0].id;
          console.log('Copying dqp_values from record:', latestRecord.id, 'to new record:', newRecordId);

          // Fetch dqp_values from the previous record
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

            console.log('Inserting copied dqp_values:', newValues);

            // Insert copied values
            const { error: insertValuesError } = await supabase
              .from('dqp_values')
              .insert(newValues);

            if (insertValuesError) {
              console.error('Error inserting dqp_values:', insertValuesError);
            } else {
              console.log('Successfully copied dqp_values');
            }
          } else {
            console.log('No previous dqp_values to copy');
          }
        }
      }
    } catch (error) {
      console.error('Error updating checklist:', error);
      // Revert UI on error
      setLiveViewList((prev) =>
        prev.map((s, sIdx) =>
          sIdx === ssrIndex ? { ...s, hourlychecks: checks } : s
        )
      );
      alert(`Failed to update checklist: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleResetChecklist = () => {
    setLiveViewList((prev) =>
      prev.map((sensor) => ({
        ...sensor,
        hourlychecks: Array(24).fill(false),
      }))
    );
  };


  useEffect(() => {
    const fetchLiveView = async () => {
      try {
        setLoadingLiveViewList(true);
        const { data, error } = await supabase
          .from('latest_radar_wall_folders')
          .select('id, radar_number, station, site_name, wallfolder_id, wallfolder:radar_wall_folders!inner(id, type, name), dqp_record_id, type, area, risk, status, quality, hourlychecks, created_time')
          .eq('type', 'Live')
          .eq('station', selectedStation)
          .order('id');

        if (error) throw error;

        console.log('Fetched data:', data);
        setLiveViewList((data as RadarWallFolder[]) || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoadingLiveViewList(false);
      }
    };

    fetchLiveView();
  }, [selectedStation]);

  // ---- Handle Explore ----
  const handleExplore = (wallFolderID) => {
    const wallFolderIDData = liveViewList.find((r) => r.wallfolder_id === wallFolderID);
    setSelectedSensor(wallFolderIDData);
    setViewSensorDetail(true)
  };

  const currentShift = shifts[selectedShift];

  const totalAlarms = 2;
  const totalEvents = 5;
  const onlineDevices = liveViewList.filter(s => s.status !== 'Link Down').length;
  const totalDevices = liveViewList.length;
  const latestUpdate = new Date(Math.max(...liveViewList.map(s => new Date(s.created_time).getTime())));
  const qualityOrder = ['Critical', 'Sub-Optimal', 'Acceptable', 'Optimal'];
  if (!liveViewList || liveViewList.length === 0) {
    return <p className="text-gray-500">No data available</p>; // Or return null to render nothing
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

  return (
    <div className="w-full space-y-4 p-6">

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
          <Button size="sm" variant="orange">
            <Mail className="w-4 h-4 mr-2" />
            Email PDF
          </Button>
          <Button size="sm" variant="brand">
            <Download className="w-4 h-4 mr-2" />
            Export
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
        <div className="border rounded-lg p-4 bg-gradient-to-br from-[var(--yellow-from)] to-[var(--yellow-to)] border-[var(--yellow-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs mb-1">Overall Quality</p>
              <p className="text-2xl">{lowestQuality.quality}</p>
            </div>
            <TrendingUp className="w-10 h-10 text-teal-500/30" />
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
                  <tr key={sensor.radar_number} className="border-t border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-hover)]/50 transition-colors">
                    <td className="px-3 py-3 text-[var(--dtg-text-primary)] cursor-pointer sticky left-0 bg-[var(--dtg-bg-card)] z-10 border-r border-[var(--dtg-border-medium)]"
                      onClick={() => { setViewSensorDetail(true); handleExplore(sensor.wallfolder_id) }}>
                      <span className="font-mono">{sensor.radar_number}</span>
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
                      <span className={`px-2 py-1 rounded text-xs border ${getRiskColor(sensor.risk)}`}>
                        {sensor.risk}
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
          {viewSensorDetail && <SensorDetail sensor={selectedSensor} onClose={() => setViewSensorDetail(false)} />}
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
                {liveViewList.length > 0 ? Math.round((completedChecks / (liveViewList.length * 12)) * 100) : 0}%
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
              <p className="text-xl text-[var(--dtg-text-primary)]">{liveViewList.filter(s => s.status !== 'Operational').length}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RadarMonitoring;