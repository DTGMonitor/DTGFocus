import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  LineChart, Line,
  ResponsiveContainer,
  Label,
  ReferenceDot
} from "recharts";
import FilterDropdown2 from "@/components/Reusable/FilterButton";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import { DateTime } from "luxon";
import Gauge from "@/components/Reusable/gauge";

function AvailabilitySummaryPage() {
  const [downtimeSummary, setDowntimeSummary] = useState([]);
  const [downtimePerDay, setDowntimePerDay] = useState([]);
  const [longestRecord, setLongestRecord] = useState([])
  const [selectedRadar, setSelectedRadar] = useState(["All Radars"]);
  const [showCumulative, setShowCumulative] = useState("Cumulative");
  const [user, setUser] = useState(null);

  const [startDate, setStartDate] = useState(() => {
    const end = DateTime.now().setZone("utc");
    return end.day < 15 ? end.minus({ days: 30 }).toJSDate() : end.startOf("month").toJSDate();
  });
  const [endDate, setEndDate] = useState(
    DateTime.now().setZone("utc").toJSDate()
  );

  const [allData, setAllData] = useState(["All"]);
  const [radarIdMap, setRadarIdMap] = useState({});


  // -------------------- AUTH --------------------
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);

    };
    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );

    return () => authListener.subscription.unsubscribe();
  }, []);

  // -------------------- FETCH RADARS --------------------
  useEffect(() => {
    const fetchRadars = async () => {
      const { data, error } = await supabase
        .from("latest_radar_wall_folders")
        .select(`
        id,
        radar_number,
        site_name,
        timezone,
        commenced_at,
        decommissioned_at
      `);

      if (error) {
        console.error("Error fetching radars:", error);
      } else {
        setAllData(data);
        console.log(data);
        const map = {};
        data.forEach(item => {
          if (item?.radar_number && item?.id) {
            map[item.radar_number] = item.id;
          }
        });
        setRadarIdMap(map);

      }
    };

    fetchRadars();
  }, []); // runs once

  const allRadarNames = [
    ...new Set(
      allData
        .map(item => item.radar_number) // go into radar object
        .filter(Boolean) // remove null/undefined
    ),
  ];


  // -------------------- LOAD DATA --------------------
  useEffect(() => {
    if (user)
      loadDowntimeSummary();
    loadDowntimePerDay();
    loadLongestRecord();
  }, [user, startDate, endDate, selectedRadar, radarIdMap]);

  const loadDowntimeSummary = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISODate(); // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISODate();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_downtime_summary", {
      start_date: startISODate,
      end_date: endISODate,
      radar_ids: radarIdsToQuery.length ? radarIdsToQuery : null,
    });

    if (error) {
      console.error("Error fetching downtime summary:", error);
      setDowntimeSummary([]);
    } else {

      setDowntimeSummary(data ?? []);
    }
  };

  const loadDowntimePerDay = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISODate();       // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISODate();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_downtime_per_day", {
      start_date: startISODate,
      end_date: endISODate,
      radar_ids: radarIdsToQuery.length ? radarIdsToQuery : null,
    })

    if (error) {
      console.error("Error fetching downtime per day:", error);
      setDowntimePerDay([]);
    } else {

      setDowntimePerDay(data ?? []);
    }
  };

  const loadLongestRecord = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISODate();       // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISODate();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_longest_downtime", {
      start_date: startISODate,
      end_date: endISODate,
      radar_ids: radarIdsToQuery.length ? radarIdsToQuery : null,
    });

    if (error) {
      console.error("Error fetching longest downtime:", error);
      setLongestRecord([]);
    } else {

      setLongestRecord(data?.[0] ?? null);
      ;
    }
  };

  // ---------------- FILTER BY RADAR ----------------
  const pickedRadars = useMemo(() => {
    return Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
  }, [selectedRadar]);

  const filteredDowntimeSummary = useMemo(() => {
    if (pickedRadars.length === 0) return downtimeSummary;
    return downtimeSummary.filter(d => pickedRadars.includes(d.radar_number));
  }, [downtimeSummary, pickedRadars]);


  // -------------------- DATA PREPARATION --------------------
  const totalTimeHours = DateTime.fromJSDate(endDate, { zone: "utc" }).endOf("day")
    .diff(DateTime.fromJSDate(startDate, { zone: "utc" }).startOf("day"), "hours")
    .hours;

  const computeAvailabilitySummary = (downtimeSummary = []) => {
    if (!Array.isArray(downtimeSummary) || downtimeSummary.length === 0) {
      return {
        physicalAvailability: "100",
        monitoringAvailability: "100",
        totalRadarUptime: totalTimeHours.toFixed(0),
        totalRadarDowntime: "0",
        totalMonitoringUptime: totalTimeHours.toFixed(0),
        totalMonitoringDowntime: "0",
        totalDowntime: "0",
        downtimeFrequency: "0.00",
        effective_hours: "0"
      };
    }

    // aggregate downtime by reason_group
    const totals = downtimeSummary.reduce(
      (acc, item) => {
        if (item.reason_group === "Radar Issue") {
          acc.radar += item.total_hours;
        } else if (item.reason_group === "Monitoring") {
          acc.monitoring += item.total_hours;
        }
        return acc;
      },
      { radar: 0, monitoring: 0 }
    );

    const totalRadarDowntime = totals.radar;
    const totalMonitoringDowntime = totals.monitoring;

    const physicalAvailability =
      ((totalTimeHours - totalRadarDowntime) / totalTimeHours) * 100;
    const monitoringAvailability =
      ((totalTimeHours - totalMonitoringDowntime) / totalTimeHours) * 100;

    const totalDowntime = totalRadarDowntime + totalMonitoringDowntime;
    const downtimeFrequency = totalDowntime / totalTimeHours;

    return {
      physicalAvailability: physicalAvailability.toFixed(0),
      monitoringAvailability: monitoringAvailability.toFixed(0),
      totalRadarUptime: (totalTimeHours - totalRadarDowntime).toFixed(0),
      totalRadarDowntime: totalRadarDowntime.toFixed(0),
      totalMonitoringUptime: (totalTimeHours - totalMonitoringDowntime).toFixed(0),
      totalMonitoringDowntime: totalMonitoringDowntime.toFixed(0),
      totalDowntime: totalDowntime.toFixed(0),
      downtimeFrequency: downtimeFrequency.toFixed(2),
    };
  };

  const {
    physicalAvailability,
    monitoringAvailability,
    totalRadarUptime,
    totalRadarDowntime,
    totalMonitoringUptime,
    totalMonitoringDowntime,
    totalDowntime,
    downtimeFrequency
  } = computeAvailabilitySummary(filteredDowntimeSummary);

  // aggregate downtime by reason
  const reasonTotals = filteredDowntimeSummary.reduce((acc, item) => {
    const key = item.reason || "Unknown";
    if (key === "No Downtime") return acc; // 🚫 skip
    acc[key] = (acc[key] || 0) + (item.total_hours || 0);
    return acc;
  }, {});

  const totalDuration = filteredDowntimeSummary.reduce(
    (sum, item) => sum + (item.total_hours || 0), 0
  );

  // transform into array for Recharts
  const pieData = Object.entries(reasonTotals).map(([reason, hours]) => ({
    name: reason,
    value: hours,
    percentage: totalDuration > 0 ? ((hours / totalDuration) * 100).toFixed(1) : "0",
  }));

  const reasonOrder = ["Connection", "PMP Issue", "Radar System Issue", "Relocation", "Maintenance"];
  const allReasons = reasonOrder;
  const orderedPieData = reasonOrder
    .map(reason => pieData.find(entry => entry.name === reason))
    .filter(Boolean);

  // ---------------- BAR CHART PREP ----------------
  const showAllRadars = selectedRadar.includes("All Radars");
  const allRadars = useMemo(() => {
    return [...new Set(filteredDowntimeSummary.map(d => d.radar_number).filter(Boolean))];
  }, [filteredDowntimeSummary]);


  // Define color palette
  const radarColors = [
    "#8B5CF6", "#156082", "#E97132", "#196B24",
    "#0F9ED5", "#A02B93", "#EC4899", "#EF4444"
  ];

  // Map radar_id to colors (cycle if > palette length)
  const fullRadarColorMap = {};
  allRadarNames.forEach((radar, index) => {
    fullRadarColorMap[radar] = radarColors[index % radarColors.length];
  });

  // Group downtime by radar_id and reason_group
  const groupedByRadar = (filteredDowntimeSummary || []).reduce((acc, item) => {
    const radarKey = item.radar_number || "Unknown";
    if (!acc[radarKey]) {
      acc[radarKey] = { radarDowntime: 0, monitoringDowntime: 0, effective_hours: item.effective_hours || 0 };
    }
    if (item.reason_group === "Radar Issue") {
      acc[radarKey].radarDowntime += item.total_hours || 0;
    } else if (item.reason_group === "Monitoring") {
      acc[radarKey].monitoringDowntime += item.total_hours || 0;
    }
    // Always keep the latest effective_hours (it’s the same per radar)
    acc[radarKey].effective_hours = item.effective_hours || acc[radarKey].effective_hours;
    return acc;
  }, {});


  // Build chart data per radar
  const barData = Object.entries(groupedByRadar).map(([radarNumber, values], idx) => {
    const { radarDowntime, monitoringDowntime, effective_hours } = values;

    const monitoringAvail =
      effective_hours > 0
        ? ((effective_hours - monitoringDowntime) / effective_hours) * 100
        : 0;

    const radarAvail =
      effective_hours > 0
        ? ((effective_hours - radarDowntime) / effective_hours) * 100
        : 0;

    return {
      radar: radarNumber,
      Monitoring: Math.max(0, monitoringAvail.toFixed(1)),
      Radar: Math.max(0, radarAvail.toFixed(1)),
      fill: fullRadarColorMap[radarNumber] || "#9ca3af",
    };
  });

  //------ Line charts ------
  function generateDateRange(startDate, endDate) {
    const range = [];
    let current = DateTime.fromJSDate(new Date(startDate));
    const last = DateTime.fromJSDate(new Date(endDate));

    while (current <= last) {
      range.push(current.toFormat("yyyy-LL-dd")); // <-- matches Supabase date
      current = current.plus({ days: 1 });
    }

    return range;
  };

  function buildRadarMarkers(radarsMeta) {
    const markers = [];

    radarsMeta.forEach(r => {
      const radarNumber = r.radar_number;
      const tz = r?.timezone || "UTC";

      // Service commenced marker
      if (r.commenced_at) {
        const commencedDate = DateTime.fromISO(r.commenced_at, { zone: "utc" })
          .setZone(tz)
          .toISODate(); // YYYY-MM-DD in local tz
        markers.push({
          date: commencedDate,
          radar: radarNumber,
          type: "servicecommenced"
        });
      }

      // Service decommissioned marker
      if (r.decommissioned_at) {
        const decommissionedDate = DateTime.fromISO(r.decommissioned_at, { zone: "utc" })
          .setZone(tz)
          .toISODate();
        markers.push({
          date: decommissionedDate,
          radar: radarNumber,
          type: "endofservice"
        });
      }
    });

    return markers;
  };

  const markers = buildRadarMarkers(allData);
  console.log(markers);


  function buildRadarChartData(raw, startDate, endDate, reasonGroup, selectedRadar, allRadars, radarsMeta) {
    const dateRange = generateDateRange(startDate, endDate);

    // Normalize selectedRadar → always array
    let radarToUse;
    if (Array.isArray(selectedRadar)) {
      radarToUse = (selectedRadar.length === 1 && selectedRadar[0] === "All Radars")
        ? (allRadars || [])
        : selectedRadar;
    } else {
      radarToUse = (selectedRadar === "All Radars") ? (allRadars || []) : selectedRadar;
    }
    radarToUse = (radarToUse || []).map(x => (x == null ? "" : String(x)));

    // Group raw data by radar_number
    const grouped = {};
    (raw || [])
      .filter(r => r.reason_group === reasonGroup)
      .forEach(r => {
        const radarKey = (r.radar_number ?? "").trim().toUpperCase();
        const recDate = String(r.record_date);
        if (!grouped[radarKey]) grouped[radarKey] = {};
        grouped[radarKey][recDate] = (grouped[radarKey][recDate] ?? 0) + (Number(r.duration_hours) || 0);
      });

    // Build date-indexed rows
    return dateRange.map(date => {
      const entry = { record_date: date };

      radarToUse.forEach(radarNumberRaw => {
        const radarNumberStr = radarNumberRaw == null ? "" : String(radarNumberRaw);
        const lookupKey = radarNumberStr.trim().toUpperCase();

        // --- get radar meta ---
        const meta = radarsMeta.find(r => r.radar_number === radarNumberStr);
        const tz = meta?.timezone || "UTC";

        const commenced = meta ? DateTime.fromISO(meta.commenced_at, { zone: "utc" }).setZone(tz).startOf("day") : null;
        const decommissioned = meta && meta.decommissioned_at
          ? DateTime.fromISO(meta.decommissioned_at, { zone: "utc" }).setZone(tz).endOf("day")
          : null;

        const current = DateTime.fromISO(date, { zone: tz });

        const inWindow =
          commenced && current >= commenced &&
          (!decommissioned || current <= decommissioned);

        entry[`radar_${radarNumberStr}`] = inWindow
          ? (grouped[lookupKey]?.[date] ?? 0)
          : null;
      });

      return entry;
    });
  };

  function buildReasonChartData(raw, startDate, endDate, reasons = reasonOrder) {
    const dateRange = generateDateRange(startDate, endDate);
    const grouped = {};

    raw.forEach(r => {
      const reason = r.reason || "None";
      if (!grouped[reason]) grouped[reason] = {};
      grouped[reason][r.record_date] =
        (grouped[reason][r.record_date] ?? 0) + r.duration_hours;
    });

    return dateRange.map(date => {
      const entry = { record_date: date };
      reasons.forEach(reason => {
        entry[reason] = grouped[reason]?.[date] ?? 0;
      });
      return entry;
    });
  };

  function makeCumulative(data, keys, radarsMeta = []) {
    if (!data?.length) return [];

    let totals = {};
    let stopped = {};

    return data.map(row => {
      let cumRow = { record_date: row.record_date };

      keys.forEach(key => {
        const radarNumber = key.replace(/^radar_/, "");
        const meta = radarsMeta.find(r => r.radar_number === radarNumber); // safe optional chaining

        const current = DateTime.fromISO(row.record_date);
        const commenced = meta ? DateTime.fromISO(meta.commenced_at) : null;
        const decommissioned = meta && meta.decommissioned_at ? DateTime.fromISO(meta.decommissioned_at) : null;

        const inWindow =
          commenced && current >= commenced &&
          (!decommissioned || current <= decommissioned);

        if (!inWindow) {
          if (decommissioned && current > decommissioned) stopped[key] = true;
          cumRow[key] = null;
        } else {
          if (!stopped[key]) {
            const val = row[key] ?? 0;
            totals[key] = (totals[key] ?? 0) + val;
            cumRow[key] = totals[key];
          } else {
            cumRow[key] = null;
          }
        }
      });

      return cumRow;
    });
  };

  function makeCumulative2(data, keys) {
    if (!data?.length) return [];
    let totals = {};
    return data.map(row => {
      const cumRow = { record_date: row.record_date };
      keys.forEach(key => {
        const val = row[key] ?? 0;
        totals[key] = (totals[key] ?? 0) + val;
        cumRow[key] = totals[key];
      });
      return cumRow;
    });
  };

  const [radarChartData, setRadarChartData] = useState([]);
  const [monitoringChartData, setMonitoringChartData] = useState([]);
  const [reasonChartData, setReasonChartData] = useState([]);

  useEffect(() => {
    if (!downtimePerDay.length) return;

    setRadarChartData(
      buildRadarChartData(downtimePerDay, startDate, endDate, "Radar Issue", selectedRadar, allRadars, allData)
    );
    setMonitoringChartData(
      buildRadarChartData(downtimePerDay, startDate, endDate, "Monitoring", selectedRadar, allRadars, allData)
    );
    setReasonChartData(
      buildReasonChartData(downtimePerDay, startDate, endDate, reasonOrder)
    );
  }, [downtimePerDay, startDate, endDate, selectedRadar, allRadars]);

  const radarLineData = showCumulative === "Cumulative"
    ? makeCumulative(radarChartData, allRadars.map(r => `radar_${r}`), allData)
    : radarChartData;

  const monitoringLineData = showCumulative === "Cumulative"
    ? makeCumulative(monitoringChartData, allRadars.map(r => `radar_${r}`), allData)
    : monitoringChartData;


  // Reason downtime data (cumulative toggle applied)
  const reasonLineData = showCumulative === "Cumulative"
    ? makeCumulative2(reasonChartData, reasonOrder)
    : reasonChartData;

  //------ TOP REASON AND DURATION ----
  //TOP REASON
  const [topReason, topDuration] = Object.entries(reasonTotals)
    .reduce((max, curr) => (curr[1] > max[1] ? curr : max), ["", 0]);


  // -------------------- THEME --------------------
  const xAxisScale = selectedRadar.length === 1 && !selectedRadar.includes("All Radars")
    ? "band"
    : "point";
  const ssrPointPadding = selectedRadar.length === 1 && !selectedRadar.includes("All Radars") ? 0 : showAllRadars ? 50
    : Math.max(50, 300 / selectedRadar.length);

  const reasonColorMap = { "Connection": "#156082", "PMP Issue": "#0F9ED5", "Radar System Issue": "#EF4444", "Relocation": "#EC4899", "Maintenance": "#A02B93" }
  const dropdownStyle = {
    padding: "8px",
    borderRadius: "6px",
    border: "1px solid #7F7F7F",
    backgroundColor: "#08403D",
    color: "#fff",
    fontSize: "14px"
  };
  const chartCard = {
    backgroundColor: "#262626",
    padding: "20px",
    borderRadius: "10px",
  };
  const chartTitle = {
    marginBottom: "10px",
    fontSize: "16px",
    color: "#f5f5f5",
    marginTop: 0
  };
  const cardStyle = {
    flex: "1",
    minWidth: "200px",
    backgroundColor: "#262626",
    borderRadius: "10px",
    padding: "20px",
    color: "#f5f5f5",
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between"
  };
  const cardTitleStyle = {
    fontSize: "18px",
    margin: 0,
    marginBottom: "5px",
    color: "#f5f5f5"
  };
  const cardValueStyle = {
    fontSize: "28px",
    fontWeight: "bold",
    margin: 0
  };
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    // Sort payload by value descending
    const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
    return (
      <div style={{
        backgroundColor: "#1B1B1B",
        border: "1px solid #5A6474",
        padding: "10px",
        borderRadius: "6px",
        color: "#f5f5f5",
        fontSize: "12px"
      }}>
        <p style={{ marginBottom: "6px" }}>{label}</p>
        {sortedPayload.map((entry, index) => (
          <div key={index} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span>{entry.name}: {entry.value?.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    );
  };

  const CustomLineTooltip = ({ active, payload, label, markers = [] }) => {
    if (!active || !payload || !payload.length) return null;
    const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
    // Find marker for the hovered date
    const matchingMarkers = markers.filter(m => m.date === label);
    return (
      <div style={{
        backgroundColor: "#1B1B1B",
        border: "1px solid #5A6474",
        padding: "10px",
        borderRadius: "6px",
        color: "#f5f5f5",
        fontSize: "12px"
      }}>
        <p style={{ marginBottom: "6px" }}>{label}</p>
        {/* Radar values */}
        {sortedPayload
          .filter(entry => entry.value > 0)
          .map((entry, index) => (
            <div key={index} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{
                width: 10,
                height: 10,
                backgroundColor: entry.color,
                borderRadius: "50%",
                display: "inline-block"
              }}></span>
              <span>{entry.name}: {entry.value?.toFixed(2)} hours</span>
            </div>
          ))}
        {/* ServiceCommenced / Off Service info */}
        {matchingMarkers.length > 0 && (
          <div style={{ marginTop: "8px", borderTop: "1px solid #5A6474", paddingTop: "6px" }}>
            {matchingMarkers.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <span style={{
                  width: 10,
                  height: 10,
                  backgroundColor: m.type === "servicecommenced" ? "green" : "red",
                  borderRadius: "50%",
                  display: "inline-block"
                }}></span>
                <span>{m.radar}: {m.type === "servicecommenced" ? "Service Commenced" : "End of Service"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const { name, value, payload: entry } = payload[0];
      return (
        <div
          style={{
            backgroundColor: "#1B1B1B",
            border: "1px solid #5A6474",
            padding: "10px",
            borderRadius: "8px",
            color: "#f5f5f5",
            fontSize: "12px",
            minWidth: "100px",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>{name} : {value.toFixed(2)} hours ({entry.percentage}%)</div>
        </div>
      );
    }
    return null;
  };

  return (
<div className="w-screen h-screen bg-[var(--dtg-bg-primary)] box-border overflow-y-auto overflow-x-hidden text-[#f5f5f5] font-['Inter',sans-serif] flex flex-col p-[10px] gap-[10px]">
      <div style={{
        display: "flex",
        gap: "10px",
        height: "100%",
        flexWrap: "nowrap",
      }}>
        {/* Sidebar Metrixs Placeholder*/}
        <div style={{
          flex: "0 0 25%",
          minWidth: "200px",
          maxWidth: "350px",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        }}>
          <div style={{
            display: "flex",
            flex: 0.7
          }}>
            <FilterDropdown2
              startDate={startDate}
              endDate={endDate}
              onApply={({ startDate: newStart, endDate: newEnd, radar }) => {
                setStartDate(newStart);
                setEndDate(newEnd);
                setSelectedRadar(radar && radar.length ? radar : ["All Radars"]);
              }}
              onReset={() => {
                const end = DateTime.now().setZone("utc");
                setEndDate(end.toJSDate());
                setStartDate(
                  end.day < 15
                    ? end.minus({ days: 30 }).toJSDate()
                    : end.startOf("month").toJSDate()
                );
                setSelectedRadar(["All Radars"]);
              }}
              onCancel={() => { }}
            />

          </div>
          <div style={{
            display: "flex",
            flex: 0.3,
            gap: 10
          }}>
            <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
              <div style={{ ...cardStyle, minWidth: 0 }}>
                <h2 style={chartTitle}>DURATION</h2>
                <div>
                  <p style={{ ...cardValueStyle, margin: 0, fontSize: "40px", color: "#EC834E" }}>{totalTimeHours.toFixed(0)}</p>
                  <p style={{ fontSize: "12px", margin: 0, color: "#ccc" }}>hours</p>
                </div>
              </div>
              <div style={{ ...cardStyle, flexDirection: "row", alignItems: "center", gap: 20, minWidth: 0 }}>
                <div>
                  <h2 style={{ ...chartTitle, margin: 0 }}>Overall</h2>
                  <h2 style={{ ...chartTitle, margin: 0 }}>Status</h2>
                </div>
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    backgroundColor: "#47D45A",
                  }}
                />
              </div>
            </div>
            <div style={{ ...cardStyle, minWidth: 0 }}>
              <h2 style={chartTitle}>SUMMARY</h2>
              <div>
                <p style={{ fontWeight: "bold", fontSize: "14px", margin: 0, color: "#fff" }}>Top Issue</p>
                <p style={{ fontWeight: "bold", fontSize: "14px", margin: 0, color: "#EC834E" }}>
                  {topReason} ({topDuration.toFixed(2)} hrs)
                </p>
              </div>
              <div>
                <p style={{ fontWeight: "bold", fontSize: "14px", margin: 0, color: "#fff" }}>Major Downtime</p>
                {longestRecord ? (
                  <div>
                    <p style={{ fontWeight: "bold", fontSize: "14px", margin: 0, color: "#EC834E" }}>
                      {Number(longestRecord?.duration_hours ?? 0).toFixed(2)} hours
                    </p>
                    <p style={{ fontSize: "12px", margin: 0, color: "#ccc" }}>
                      {longestRecord.downtime_from_local} - {longestRecord.downtime_to_local}
                    </p>
                    <p style={{ fontSize: "12px", margin: 0, color: "#ccc" }}>
                      {longestRecord.radar_number} | Reason: {longestRecord.reason}
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: "12px", margin: 0, color: "#ccc" }}>No downtime records</p>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Main Content */}
        {/* Chart Grid */}
        <div style={{
          flex: 1,
          minWidth: 0, // allows it to shrink properly
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gridTemplateRows: "0.2fr 1fr 1fr",
          gap: "10px",
          overflowX: "auto",
          overflowY: "hidden"
        }}>
          {/*Physical Availability*/}
          <div style={{ ...cardStyle, flexDirection: "row", gap: 20, alignItems: "center", borderRadius: 50, minWidth: 0, padding: "20px 40px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: "#47D45A",
                  }}
                />
                <p style={{ ...cardTitleStyle, fontWeight: "bold", marginBottom: 0 }}>Radar Operating Time</p>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: "40px", color: "#fff", fontWeight: "bold" }}> {physicalAvailability}%</h2>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <FaArrowUp size="10px" color="#47D45A" />
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#fff", fontWeight: "bold" }}>{totalRadarUptime}h</p>
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#ccc", margin: 0, textWrap: "balance" }}>total radar uptime</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <FaArrowDown size="10px" color="#F28B82" />
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#fff", fontWeight: "bold" }}>{totalRadarDowntime}h</p>
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#ccc", margin: 0, textWrap: "balance" }}>total radar downtime</p>
                  </div>
                </div>
              </div>
            </div>
            <Gauge
              percentage={physicalAvailability}
              imageSrc={"/icons/Radaricon.png"}
            />
          </div>
          {/*Use of Availability*/}
          <div style={{ ...cardStyle, flexDirection: "row", gap: 20, alignItems: "center", borderRadius: 50, minWidth: 0, padding: "20px 40px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: "#47D45A",
                  }}
                />
                <p style={{ ...cardTitleStyle, fontWeight: "bold", marginBottom: 0 }}>Monitoring Use of Availability</p>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: "40px", color: "#fff", fontWeight: "bold" }}> {monitoringAvailability}%</h2>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <FaArrowUp size="10px" color="#47D45A" />
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#fff", fontWeight: "bold" }}>{totalMonitoringUptime}h</p>
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#ccc", margin: 0, textWrap: "balance" }}>total available time</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <FaArrowDown size="10px" color="#F28B82" />
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#fff", fontWeight: "bold" }}>{totalMonitoringDowntime}h</p>
                    <p style={{ ...cardValueStyle, fontSize: "12px", color: "#ccc", margin: 0, textWrap: "balance" }}>total unavailable time</p>
                  </div>
                </div>
              </div>
            </div>
            <Gauge
              percentage={physicalAvailability}
              imageSrc={"/icons/Monitor.svg"}
            />
          </div>
          {/*Downtime*/}
          <div style={{ ...cardStyle, borderRadius: 50, minWidth: 0, padding: "20px 40px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: "#C00000",
                }}
              />
              <p style={{ ...cardTitleStyle, fontWeight: "bold", marginBottom: 0 }}>Downtime</p>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "40px", color: "#fff", fontWeight: "bold" }}>
                {totalDowntime}
                <span style={{ fontSize: "12px" }}> hours</span>
              </h2>
              <div style={{ display: "block", textAlign: "right" }}>
                <p style={{ fontSize: "14px", color: "#ccc", fontWeight: "bold", margin: 0 }}>Downtime Frequency</p>
                <p style={{ fontSize: "12px", color: "#ccc", margin: 0, textWrap: "balance" }}>{downtimeFrequency} hours/day</p>
              </div>
            </div>
          </div>
          {/* Radar Record - Bar Chart*/}
          <div style={cardStyle}>
            <div style={{ display: "flex", gap: 10 }}>
              <FaArrowUp size="14px" color="#47D45A" />
              <h2 style={chartTitle}>Radar Uptime Record</h2>
            </div>
            {barData.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  color: "#ccc",
                  fontStyle: "italic",
                }}
              >
                No downtime data to display.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: "100%", height: "100%" }}>
                <ResponsiveContainer width="100%" height="95%">
                  <BarChart
                    data={barData}
                    margin={{ top: 20 }}
                  >
                    <XAxis dataKey="radar" tick={false} tickLine={false} stroke="#ccc" fontSize={12} scale={xAxisScale} padding={{ left: ssrPointPadding, right: ssrPointPadding }} />
                    <YAxis
                      stroke="#ccc"
                      fontSize={12}
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip
                      content={CustomTooltip}
                    />
                    <Bar dataKey="Radar" radius={[5, 5, 0, 0]} label={{ position: "top", fill: "#ccc", fontSize: 10, formatter: (val) => `${val}%` }}>
                      {barData.map((entry, index) => (
                        <Cell key={`cell-r-${index}`} fill={entry.fill} />))}
                    </Bar>
                    <Legend
                      content={() => {
                        const radarsToShow = barData.map((d) => d.radar);
                        return (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "10px", color: "#aaa", justifyContent: "center", margin: 0 }}>
                            {radarsToShow.map((radar) => (
                              <div key={radar} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <div
                                  style={{
                                    width: 10,
                                    height: 10,
                                    backgroundColor: fullRadarColorMap[radar] || "#999",
                                  }}
                                />
                                <span>{radar}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>)}
          </div>
          {/* Monitoring Record - Bar Chart*/}
          <div style={cardStyle}>
            <div style={{ display: "flex", gap: 10 }}>
              <FaArrowUp size="14px" color="#47D45A" />
              <h2 style={chartTitle}>Monitoring Available Time Record</h2>
            </div>
            {barData.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  color: "#ccc",
                  fontStyle: "italic",
                }}
              >
                No downtime data to display.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: "100%", height: "100%" }}>
                <ResponsiveContainer width="100%" height="95%">
                  <BarChart
                    data={barData}
                    margin={{ top: 20 }}
                  >
                    <XAxis dataKey="radar" stroke="#ccc" tick={false} tickLine={false} fontSize={12} scale={xAxisScale} padding={{ left: ssrPointPadding, right: ssrPointPadding }} />
                    <YAxis
                      stroke="#ccc"
                      fontSize={12}
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip
                      content={CustomTooltip}
                    />
                    <Bar dataKey="Monitoring" radius={[5, 5, 0, 0]} label={{ position: "top", fill: "#ccc", fontSize: 10, formatter: (val) => `${val}%` }}>
                      {barData.map((entry, index) => (
                        <Cell key={`cell-r-${index}`} fill={entry.fill} />))}</Bar>
                    <Legend
                      content={() => {
                        const radarsToShow = barData.map((d) => d.radar);
                        return (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "10px", color: "#aaa", justifyContent: "center", margin: 0 }}>
                            {radarsToShow.map((radar) => (
                              <div key={radar} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <div
                                  style={{
                                    width: 10,
                                    height: 10,
                                    backgroundColor: fullRadarColorMap[radar] || "#999",
                                  }}
                                />
                                <span>{radar}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>)}
          </div>
          {/* Downtime Reason - Pie Chart */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={chartTitle}>Downtime Reason</h2>
            </div>
            {orderedPieData.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  color: "#ccc",
                  fontStyle: "italic",
                }}
              >
                No downtime data to display.
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", width: "100%", maxWidth: "100%", height: "100%" }}>
                <ResponsiveContainer width="60%" height="80%">
                  <PieChart>
                    <Pie
                      data={orderedPieData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius="100%"
                      innerRadius="70%"
                    >
                      {orderedPieData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={reasonColorMap[entry.name]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {orderedPieData.map((entry, index) => {
                      return (
                        <li key={`legend-${index}`} style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: "14px",
                          marginBottom: "6px",
                          color: "#f5f5f5",
                          gap: "20px"
                        }}>
                          {/* Left side: icon + reason name */}
                          <div style={{ display: "flex", alignItems: "center", fontSize: "12px", color: "#ccc" }}>
                            <span style={{
                              display: "inline-block",
                              width: 12,
                              height: 12,
                              backgroundColor: reasonColorMap[entry.name],
                              borderRadius: "50%",
                              marginRight: 8
                            }}></span>
                            {entry.name}
                          </div>
                          {/* Right side: value + percentage */}
                          <div style={{ minWidth: "70px", textAlign: "right", fontSize: "12px", fontWeight: "bold" }}>
                            {entry.value.toFixed(2)} hours
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>
          {/* Radar Downtime - Line Chart */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <FaArrowDown size="14px" color="#F28B82" />
                <h2 style={chartTitle}>Radar Downtime Record</h2>
              </div>
              <select
                style={dropdownStyle}
                value={showCumulative}
                onChange={(e) => setShowCumulative(e.target.value)}
              >
                <option value="Daily">Daily</option>
                <option value="Cumulative">Cumulative</option>
              </select>
            </div>

            <ResponsiveContainer width="100%" height="80%">
              <LineChart data={radarLineData} margin={{ left: 10, right: 10, top: 10 }}>
                <CartesianGrid stroke="#444" strokeDasharray="3 3" />
                <XAxis dataKey="record_date" stroke="#ccc" fontSize={12} />
                <YAxis stroke="#ccc" fontSize={12}>
                  <Label
                    value="Downtime (hrs)"
                    angle={-90}
                    position="insideLeft"
                    dy={40}
                    style={{ fill: "#ccc", fontSize: "12px" }}
                  />
                </YAxis>
                <Tooltip content={<CustomLineTooltip markers={markers}/>} />
                {allRadars.map(radar => (
                  <Line
                    key={`${radar}-radar`}
                    type="monotone"
                    dataKey={`radar_${radar}`}   // <-- just use this
                    stroke={fullRadarColorMap[radar]}
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 2 }}
                    name={`${radar} - Radar`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>

          </div>
          {/* Monitoring Unavailable Time - Line Chart */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <FaArrowDown size="14px" color="#F28B82" />
                <h2 style={chartTitle}>Monitoring Unavailable Time Record</h2>
              </div>
              <select
                style={dropdownStyle}
                value={showCumulative}
                onChange={(e) => setShowCumulative(e.target.value)}
              >
                <option value="Daily">Daily</option>
                <option value="Cumulative">Cumulative</option>
              </select>
            </div>

            <ResponsiveContainer width="100%" height="80%">
              <LineChart
                data={monitoringLineData}
                margin={{ left: 10, right: 10, top: 10 }}
              >
                <CartesianGrid stroke="#444" strokeDasharray="3 3" />
                <XAxis dataKey="record_date" stroke="#ccc" fontSize={12} />
                <YAxis stroke="#ccc" fontSize={12}>
                  <Label
                    value="Downtime (hrs)"
                    angle={-90}
                    position="insideLeft"
                    dy={40}
                    style={{ fill: "#ccc", fontSize: "12px" }}
                  />
                </YAxis>
                <Tooltip content={<CustomLineTooltip markers={markers}/>} />
                {allRadars.map(radar => (
                  <Line
                    key={`${radar}-monitoring`}
                    type="monotone"
                    dataKey={`radar_${radar}`}   // same format, no "_monitoring"
                    stroke={fullRadarColorMap[radar]}
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 2 }}
                    name={`${radar} - Monitoring`}
                  />
                ))}

              </LineChart>
            </ResponsiveContainer>

          </div>
          {/* Downtime Record - Line Chart */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
              <h2 style={chartTitle}>Downtime Record</h2>
              <select
                style={dropdownStyle}
                value={showCumulative}
                onChange={(e) => setShowCumulative(e.target.value)}
              >
                <option value="Daily">Daily</option>
                <option value="Cumulative">Cumulative</option>
              </select>
            </div>
            {downtimePerDay.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  color: "#ccc",
                  fontStyle: "italic",
                }}
              >
                No downtime data to display.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="80%">
                <LineChart data={reasonLineData} margin={{ left: 10, right: 10, top: 10 }}>
                  <CartesianGrid stroke="#444" strokeDasharray="3 3" />
                  <XAxis dataKey="record_date" stroke="#ccc" fontSize={12} />
                  <YAxis stroke="#ccc" fontSize={12}>
                    <Label
                      value="Downtime (hrs)"
                      angle={-90}
                      position="insideLeft"
                      dy={40}
                      style={{ fill: "#ccc", fontSize: "12px" }}
                    />
                  </YAxis>
                  <Tooltip content={<CustomLineTooltip />} />
                  {allReasons.map(reason => (
                    <Line
                      key={reason}
                      type="monotone"
                      dataKey={reason}
                      stroke={reasonColorMap[reason]}
                      strokeWidth={2}
                      connectNulls
                      dot={{ r: 2 }}
                      name={reason}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div >
  );
}
export default AvailabilitySummaryPage;