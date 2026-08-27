import { useEffect, useState } from "react";
import React from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  LineChart, Line,
  ResponsiveContainer,
  Label, LabelList,
  ReferenceDot
} from "recharts";
import FilterDropdown2 from "@/components/Reusable/FilterButton";
import { DateTime } from "luxon";


function AlarmSummaryPage() {
  const [alarmByRadars, setAlarmByRadars] = useState([]);
  const [alarmsByReason, setAlarmsByReason] = useState([]);
  const [alarmsByRegion, setAlarmsByRegion] = useState([]);
  const [selectedRadar, setSelectedRadar] = useState(["All Radars"]);
  const [alarmsPerRadarPerDay, setAlarmsPerRadarPerDay] = useState([]);
  const [alarmsPerRegionPerDay, setAlarmsPerRegionPerDay] = useState([]);
  const [showCumulative, setShowCumulative] = useState("Cumulative");
  const [viewMode, setViewMode] = useState("Total");
  const [reasonFilter, setReasonFilter] = useState("All");
  // Guarded: this page has its own route now, so the initializer also runs
  // during the server render, where there is no localStorage.
  const [selectedArea, setSelectedArea] = useState(() => {
    if (typeof window === "undefined") return "All";
    return localStorage.getItem("selectedArea") || "All";
  });

  const [user, setUser] = useState(null);

  const [endDate, setEndDate] = useState(
    DateTime.now().setZone("utc").toJSDate()
  );

  const [startDate, setStartDate] = useState(() => {
    const end = DateTime.now().setZone("utc");
    return end.day < 15 ? end.minus({ days: 30 }).toJSDate() : end.startOf("month").toJSDate();
  });

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

  useEffect(() => {
    if (user)
      loadRadarAlarms();
    loadReasonAlarms();
    loadRegionAlarms();
    loadRegionAlarmsPerDay();
    loadRadarAlarmsPerDay();
  }, [user, startDate, endDate, selectedRadar, radarIdMap, reasonFilter]);

  const loadRadarAlarms = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISO(); // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISO();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_radar_alarm_stats", {
      p_start_date: startISODate,
      p_end_date: endISODate,
      p_radars: radarIdsToQuery.length ? radarIdsToQuery : null,
      p_reasons: reasonFilter === "All" ? ["Valid", "False"] : [reasonFilter],
    });


    if (error) {
      console.error("Error fetching alarm stats:", error);
      setAlarmByRadars([]);
    } else {
      setAlarmByRadars(data ?? []);
    }
  };

  const loadReasonAlarms = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISO(); // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISO();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_reason_alarm_stats", {
      p_start_date: startISODate,
      p_end_date: endISODate,
      p_radars: radarIdsToQuery.length ? radarIdsToQuery : null,
      p_reasons: reasonFilter === "All" ? ["Valid", "False"] : [reasonFilter],
    });


    if (error) {
      console.error("Error fetching alarm stats:", error);
      setAlarmsByReason([]);
    } else {

      setAlarmsByReason(data ?? []);
    }
  };

  const loadRegionAlarms = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISO(); // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISO();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_region_alarm_stats", {
      p_start_date: startISODate,
      p_end_date: endISODate,
      p_radars: radarIdsToQuery.length ? radarIdsToQuery : null,
      p_reasons: reasonFilter === "All" ? ["Valid", "False"] : [reasonFilter],
    });


    if (error) {
      console.error("Error fetching alarm stats:", error);
      setAlarmsByRegion([]);
    } else {

      setAlarmsByRegion(data ?? []);
      console.log("Alarms by Region:", data);
    }
  };

  const loadRegionAlarmsPerDay = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISO(); // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISO();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_alarm_per_region_per_day", {
      p_start_date: startISODate,
      p_end_date: endISODate,
      p_radars: radarIdsToQuery.length ? radarIdsToQuery : null,
      p_reasons: reasonFilter === "All" ? ["Valid", "False"] : [reasonFilter],
    });


    if (error) {
      console.error("Error fetching alarm stats:", error);
      setAlarmsPerRegionPerDay([]);
    } else {

      setAlarmsPerRegionPerDay(data ?? []);
      console.log("Alarms Per Day by Region:", data);
    }
  };

  const loadRadarAlarmsPerDay = async () => {
    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("utc") // send UTC to RPC
      .toISO(); // keep timestamp, not just date

    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("utc")
      .toISO();

    // Pick selected radars (skip "All Radars")
    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(rr => radarIdMap[rr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_alarm_per_radar_per_day", {
      p_start_date: startISODate,
      p_end_date: endISODate,
      p_radars: radarIdsToQuery.length ? radarIdsToQuery : null,
      p_reasons: reasonFilter === "All" ? ["Valid", "False"] : [reasonFilter],
    });


    if (error) {
      console.error("Error fetching alarm stats:", error);
      setAlarmsPerRadarPerDay([]);
    } else {

      setAlarmsPerRadarPerDay(data ?? []);
      console.log("Alarms Per Day by Radar:", data);
    }
  };

  // This is used to check if there is data to display.
  const filteredReasonSource = alarmByRadars ?? [];

  // --- Data for "Alarms by Radar" chart ---
  const ssrChartData = (alarmByRadars ?? []).map(item => ({
    name: item.radar_number || "Unknown",
    value: Number(item.total_count),
    percentage: Number(item.percentage)
  }));

  const reasonChartData = (alarmsByReason ?? []).map(item => ({
    name: item.cause,
    value: Number(item.total_count),
    percentage: Number(item.percentage)
  }));

  const priorityTotals = (alarmsByReason ?? []).reduce((acc, item) => {
    acc.red += Number(item.red) || 0;
    acc.orange += Number(item.orange) || 0;
    acc.yellow += Number(item.yellow) || 0;
    acc.purple += Number(item.purple) || 0;
    acc.blue += Number(item.blue) || 0;
    return acc;
  }, { red: 0, orange: 0, yellow: 0, purple: 0, blue: 0 });

  const priorityChartData = [
    { name: '1', value: priorityTotals.red, fill: '#EF4444' },
    { name: '2', value: priorityTotals.orange, fill: '#F97316' },
    { name: '3', value: priorityTotals.yellow, fill: '#EAB308' },
    { name: '4', value: priorityTotals.purple, fill: '#A855F7' },
    { name: '5', value: priorityTotals.blue, fill: '#3B82F6' }
  ];

  // --- Data for "Total Alarms" card ---
  const totalAlarms = (alarmByRadars ?? []).reduce((sum, item) => sum + Number(item.total_count), 0);

  // --- TOP RADAR for "Frequent Alarm" card ---
  const [topRadar, topRadarCount] = Object.entries(
    ssrChartData.reduce((acc, curr) => ({ ...acc, [curr.name]: curr.value }), {})
  ).reduce((max, curr) => (curr[1] > max[1] ? curr : max), ["", 0]);

  const [topReason, topCount] = Object.entries(
    alarmsByReason.reduce((acc, curr) => ({ ...acc, [curr.cause]: curr.total_count }), {})
  ).reduce((max, curr) => (curr[1] > max[1] ? curr : max), ["", 0]);

  const isAllRadarsSelected = selectedRadar === "All Radars" ||
    (Array.isArray(selectedRadar) && selectedRadar.includes("All Radars"));

  const [topRegion, topRegionCount] = Object.entries(
    (alarmsByRegion ?? []).reduce((acc, curr) => ({ ...acc, [curr.region || curr.name]: curr.total_count }), {})
  ).reduce((max, curr) => (curr[1] > max[1] ? curr : max), ["N/A", 0]);

  // --- Process Line Chart Data ---
  const processLineData = (data, keyProp, valProp) => {
    if (!data || data.length === 0) return [];
    const grouped = {};
    data.forEach(item => {
      const date = item.alarm_date;
      if (!grouped[date]) grouped[date] = { name: date };
      grouped[date][item[keyProp]] = Number(item[valProp]);
    });
    return Object.values(grouped).sort((a, b) => new Date(a.name) - new Date(b.name));
  };

  const processMarkers = (data, keyProp) => {
    if (!data || data.length === 0) return [];
    const markers = [];
    data.forEach(item => {
      const date = item.alarm_date;
      const key = item[keyProp];
      if (item.modified_count > 0) markers.push({ date, [keyProp === 'radar_number' ? 'radar' : 'region']: key, status: "Modified", count: item.modified_count });
      if (item.awaiting_feedback_count > 0) markers.push({ date, [keyProp === 'radar_number' ? 'radar' : 'region']: key, status: "Awaiting Feedback", count: item.awaiting_feedback_count });
      if (item.not_implemented_count > 0) markers.push({ date, [keyProp === 'radar_number' ? 'radar' : 'region']: key, status: "Not Implemented", count: item.not_implemented_count });
    });
    return markers;
  };

  const lineChartData = processLineData(alarmsPerRadarPerDay, 'radar_number', 'daily_count');
  const cumulativeLineChartData = processLineData(alarmsPerRadarPerDay, 'radar_number', 'cumulative_count');

  const regionLineChartData = processLineData(alarmsPerRegionPerDay, 'region_name', 'daily_count');
  const cumulativeRegionLineChartData = processLineData(alarmsPerRegionPerDay, 'region_name', 'cumulative_count');

  const radarArray = Array.isArray(selectedRadar) ? selectedRadar : [selectedRadar];
  const isMultipleRadars = radarArray.length > 1 || isAllRadarsSelected;

  const improvementMarkers = isMultipleRadars
    ? processMarkers(alarmsPerRadarPerDay, 'radar_number')
    : processMarkers(alarmsPerRegionPerDay, 'region_name');

  const regionBarChartData = (alarmsByRegion ?? []).map(item => ({
    name: item.region || item.name || "Unknown",
    value: Number(item.total_count)
  }));

  const totalRegionAlarms = (alarmsByRegion ?? []).reduce((sum, item) => sum + Number(item.total_count), 0);

  const regionPieChartData = (alarmsByRegion ?? []).map(item => ({
    name: item.region || item.name || "Unknown",
    count: Number(item.total_count),
    percentage: totalRegionAlarms > 0 ? ((Number(item.total_count) / totalRegionAlarms) * 100).toFixed(1) : 0
  }));

  const validAlarms = (alarmsByReason ?? []).filter(item => item.reason === "Valid");
  const falseAlarms = (alarmsByReason ?? []).filter(item => item.reason === "False");
  const percentageValid = (validAlarms ?? []).reduce((sum, item) => sum + Number(item.percentage), 0).toFixed(1);
  const percentageFalse = (falseAlarms ?? []).reduce((sum, item) => sum + Number(item.percentage), 0).toFixed(1);

  // --- Alarms per day calculation ---
  const diffInDays = DateTime.fromJSDate(endDate).diff(DateTime.fromJSDate(startDate), 'days').toObject().days;
  const alarmsPerDay = totalAlarms > 0 && diffInDays >= 1 ? (totalAlarms / diffInDays).toFixed(1) : 0;

  const radarColors = [
    "#156082", "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#EC4899", "#EF4444", "#8B5CF6"
  ];

  const fullRadarColorMap = {};
  allRadarNames.forEach((radar, index) => {
    fullRadarColorMap[radar] = radarColors[index % radarColors.length];
  });

  // --- Data for "% Share" pie chart ---
  const ssrPercentageData = (alarmByRadars ?? []).map(item => ({
    name: item.radar_number,
    value: Number(item.total_count),
    percentage: Number(item.percentage),
    fill: fullRadarColorMap[item.radar_number] || "#888"
  }));

  const PriorityLevelsBox = ({ data }) => {
    return (
      <div
        style={{ ...cardStyle, minWidth: 0 }}
      >
        <p style={{ ...cardTitleStyle, fontWeight: "bold" }}>Priority Levels</p>
        <ResponsiveContainer width="100%">
          <BarChart data={data} >
            <XAxis dataKey="name"
              stroke="#ccc" fontSize={12}
              scale="point"
              padding={{ left: 30, right: 30 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1B1B1B",
                border: "1px solid #5A6474",
                padding: "10px",
                borderRadius: "6px",
                fontSize: "12px",
              }}
              labelFormatter={(label) => (
                <span style={{ color: "white" }}>
                  Level {label}
                </span>
              )}
              formatter={(value, name, props) => {
                const color = props.payload.fill;
                return [
                  <span style={{ color }}>Alarms: {value}</span>,
                  null
                ];
              }}
            />
            <Bar dataKey="value" barSize={dynamicssrBarSize} radius={[5, 5, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                style={{ fontSize: 10, fontWeight: "bold" }}
                content={({ x, y, width, value, index }) => {
                  const color = data[index].fill;
                  return (
                    <text
                      x={x + width / 2}
                      y={y - 1}
                      textAnchor="middle"
                      fill={color}
                      fontSize={10}
                      fontWeight="bold"
                    >
                      {value}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  

  const isSingleRadar = radarArray.length === 1 && !isAllRadarsSelected;

  

  const chartDataToUse = isMultipleRadars
    ? (showCumulative ? cumulativeLineChartData : lineChartData)
    : (showCumulative ? cumulativeRegionLineChartData : regionLineChartData);



  // Choose chart keys
  const allRegions = [...new Set((alarmsPerRegionPerDay ?? []).map(item => item.region_name || "Unknown"))];
  const chartKeys = isMultipleRadars
    ? allRadarNames
    : allRegions;

  const regionColors = [
    "#0EA5E9", "#F43F5E", "#6366F1", "#06B6D4", "#156082", "#EC4899", "#EF4444", "#8B5CF6"
  ];

  const regionColorMap = {};
  allRegions.forEach((region, index) => {
    regionColorMap[region] = regionColors[index % regionColors.length];
  });

  const statusColorMap = {
    "Modified": "#22C55E",           // Green
    "Awaiting Feedback": "#FACC15",  // Amber
    "Not Implemented": "#EF4444",    // Red
  };

  const statusLegendMap = {
    "Not Implemented": {
      color: "#EF4444",
      description: "Recommendation requested but site decided not to implement/no longer needed."
    },
    "Awaiting Feedback": {
      color: "#FACC15",
      description: "Recommendation requested but site has not replied."
    },
    "Modified": {
      color: "#22C55E",
      description: "Recommendation already applied by site."
    }
  };

  const pieColors = ["#0EA5E9", "#F43F5E", "#6366F1", "#06B6D4", "#156082", "#EC4899", "#EF4444", "#8B5CF6"];

  const dropdownStyle = {
    padding: "8px",
    borderRadius: "6px",
    border: "1px solid #7F7F7F",
    backgroundColor: "#08403D",
    color: "#fff",
    fontSize: "14px"
  }; const chartCard = {
    backgroundColor: "#262626",
    padding: "20px",
    borderRadius: "10px",
  };

  const chartTitle = {
    marginBottom: "10px",
    fontSize: "18px",
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

  const CustomTooltip = ({ active, payload, label, markers }) => {
    if (!active || !payload || !payload.length) return null;

    const sortedPayload = [...payload].sort((a, b) => b.name - a.name);

    // Filter improvement markers for current label (date)
    const markersForDate = markers?.filter(marker => marker.date === label) || [];

    // Group markers by status
    const statusGrouped = {};
    markersForDate.forEach(marker => {
      const status = marker.status || "Unknown";
      if (!statusGrouped[status]) {
        statusGrouped[status] = [];
      }
      statusGrouped[status].push(marker);
    });

    return (
      <div style={{
        backgroundColor: "#1B1B1B",
        border: "1px solid #5A6474",
        padding: "10px",
        borderRadius: "6px",
        color: "#f5f5f5",
        fontSize: "12px",
        maxWidth: "320px"
      }}>
        <p style={{ marginBottom: "6px", fontWeight: "bold" }}>{label}</p>

        {/* Main chart values */}
        {sortedPayload.
          filter(entry => entry.value > 0)
          .map((entry, index) => (
            <div key={index} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{
                width: 10,
                height: 10,
                backgroundColor: entry.color,
                borderRadius: "50%",
                display: "inline-block"
              }}></span>
              <span>{entry.name}: {entry.value}</span>
            </div>
          ))}

        {/* Spacer */}
        {markersForDate.length > 0 && <hr style={{ margin: "8px 0", borderColor: "#444" }} />}

        {/* Improvement Markers by Status */}
        {Object.entries(statusGrouped).map(([status, entries], idx) => (
          <div key={`status-${idx}`} style={{ marginBottom: "6px" }}>
            <div style={{
              fontWeight: "bold",
              color: statusColorMap[status] || "#fff"
            }}>
              {status} ({entries.length})
            </div>
            {(() => {
              const countMap = {};

              entries.forEach(e => {
                const key = isSingleRadar ? e.region : e.radar;
                if (!countMap[key]) {
                  countMap[key] = 0;
                }
                countMap[key]++;
              });

              return Object.entries(countMap).map(([key, count], i) => (
                <div key={i} style={{ marginLeft: "10px", fontSize: "11px", color: "#ccc" }}>
                  • {key}{count > 1 ? ` (${count})` : ""}
                </div>
              ));
            })()}

          </div>
        ))}
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
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>{name}</div>
          <div style={{ color: "#14B8A6" }}>Alarms: {value} ({entry.percentage}%)</div>
        </div>
      );
    }

    return null;
  };

  const CustomBarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            backgroundColor: "#1B1B1B",
            border: "1px solid #5A6474",
            padding: "10px",
            borderRadius: "6px",
            color: "#f5f5f5",
            fontSize: "12px",
            minWidth: "100px",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>{label}</div>
          <div style={{ color: "#14B8A6" }}>
            Alarms : {payload[0].value}
          </div>
        </div>
      );
    }

    return null;
  };

  const totalReason = 0; // Placeholder
  const sortedReasonChartData = [...reasonChartData].sort((a, b) => b.value - a.value);

  const ssrChartCount = ssrChartData.length;
  const ssrPointPadding = Math.max(50, 200 / ssrChartCount);
  const dynamicssrBarSize = Math.max(14, 100 - ssrChartCount * 2);

  const regionChartCount = regionBarChartData.length;
  const regionPointPadding = Math.max(50, 200 / regionChartCount);
  const dynamicregionBarSize = Math.max(14, 100 - regionChartCount * 2);

  let chartContent;


  if (filteredReasonSource.length === 0) {
    chartContent = (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "250px",
          color: "#ccc",
          fontStyle: "italic",
        }}
      >
        {reasonFilter === "Valid"
          ? "No valid alarms by radar available."
          : reasonFilter === "False"
            ? "No false alarms by radar available."
            : "No alarms by radar available."}
      </div>
    );
  } else if (isMultipleRadars) {
    chartContent = (
      <ResponsiveContainer width="100%" height={300}>
        {viewMode === "Total" ? (
          <BarChart data={ssrChartData} margin={{ top: 20, right: 10, bottom: 0, left: 0 }}>
            <XAxis dataKey="name" tick={false} tickLine={false} stroke="#ccc" fontSize={12} scale="point" padding={{ left: ssrPointPadding, right: ssrPointPadding }} />
            <YAxis stroke="#ccc" fontSize={12}>
              <Label
                value="Total Alarms"
                angle={-90}
                position="insideLeft"
                dy={30}
                style={{ fill: "#ccc", fontSize: "12px" }}
              />
            </YAxis>
            <Tooltip
              content={<CustomBarTooltip />}
            />
            <Bar dataKey="value" barSize={dynamicssrBarSize} radius={[5, 5, 0, 0]} label={{ position: "top", fill: "#fff", fontSize: 10 }}>
              {ssrChartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={isSingleRadar ? regionColorMap[entry.name] : fullRadarColorMap[entry.name] || "#999"}
                />
              ))}
            </Bar>
            <Legend
              content={() => {
                const radarsToShow = ssrChartData.map((d) => d.name);
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "10px", color: "#aaa", justifyContent: "center", margin: 0 }}>
                    {radarsToShow.map((name) => (
                      <div key={name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div
                          style={{
                            width: 10,
                            height: 10,
                            backgroundColor: fullRadarColorMap[name] || "#999",
                          }}
                        />
                        <span>{name}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </BarChart>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ width: 300, height: 300 }}>
              <PieChart width={300} height={300}>
                <Tooltip content={<CustomPieTooltip />} />
                <Pie
                  data={ssrPercentageData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={120}
                  labelLine={false}
                  label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                    const RADIAN = Math.PI / 180;
                    const radius = outerRadius - 20;
                    const x = cx + radius * Math.cos(-midAngle * RADIAN);
                    const y = cy + radius * Math.sin(-midAngle * RADIAN);

                    const percentage = percent * 100;

                    return (
                      <text
                        x={x}
                        y={y}
                        fill="white"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="11px"
                      >
                        {percentage < 1 ? "<1%" : `${percentage.toFixed(1)}%`}
                      </text>
                    );
                  }}
                >
                  {ssrPercentageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={fullRadarColorMap[entry.name]} />
                  ))}
                </Pie>
              </PieChart>
            </div>

            <div style={{ minWidth: "200px", maxWidth: "300px", maxHeight: "250px", overflowY: "scroll", overflowWrap: "break-word" }}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {ssrChartData.map((entry, index) => {
                  const percentage = ((entry.value / totalReason) * 100).toFixed(1);
                  return (
                    <li
                      key={`legend-${index}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "14px",
                        marginBottom: "20px",
                        color: "#f5f5f5",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          fontSize: "12px",
                          color: "#ccc",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            backgroundColor: fullRadarColorMap[entry.name],
                            borderRadius: "50%",
                            marginRight: 8,
                          }}
                        ></span>
                        {entry.name}
                      </div>
                      <div
                        style={{
                          minWidth: "80px",
                          textAlign: "right",
                          fontSize: "12px",
                          fontWeight: "bold",
                        }}
                      >
                        {entry.value} ({percentage}%)
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </ResponsiveContainer>
    );
  } else if (isSingleRadar) {
    // Specific radar selected  show alarm region charts
    chartContent = (
      <div style={{ display: "flex", gap: "20px", width: "100%" }}>

        {regionBarChartData.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "#ccc",
              fontStyle: "italic",
              padding: "30px",
            }}
          >
            No region data available for {selectedRadar}.
          </div>
        ) : viewMode === "Total" ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={regionBarChartData} margin={{ top: 20, right: 10, bottom: 0, left: 0 }}>
              <XAxis dataKey="name"
                stroke="#ccc"
                fontSize={9}
                angle={-45}
                textAnchor="end"
                tick={false} tickLine={false}
                interval={0}
                dy={10}
                scale="point" padding={{ left: regionPointPadding, right: regionPointPadding }} />
              <YAxis stroke="#ccc" fontSize={12} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="value" barSize={dynamicregionBarSize} fill="#14B8A6" radius={[5, 5, 0, 0]} label={{ position: "top", fill: "#fff", fontSize: 10 }}>
                {chartKeys.map((key, index) => (
                  <Cell key={key} fill={isSingleRadar ? regionColorMap[key] : fullRadarColorMap[key]} />))}
              </Bar>
              <Legend
                content={() => {
                  const regionToShow = regionBarChartData.map((d) => d.name);
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "10px", color: "#aaa", justifyContent: "center", margin: 0 }}>
                      {regionToShow.map((name) => (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              backgroundColor: regionColorMap[name] || "#999",
                            }}
                          />
                          <span>{name}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <div style={{ display: "flex", width: "50%" }}>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Tooltip content={<CustomPieTooltip />} />
                <Pie
                  data={regionPieChartData}
                  dataKey="count"
                  nameKey="name"
                  outerRadius={110}
                  labelLine={false}
                  label={({ cx, cy, midAngle, outerRadius, percent }) => {
                    const RADIAN = Math.PI / 180;
                    const radius = outerRadius - 20;
                    const x = cx + radius * Math.cos(-midAngle * RADIAN);
                    const y = cy + radius * Math.sin(-midAngle * RADIAN);

                    const pct = percent * 100;
                    if (pct < 1) return null;
                    return (
                      <text
                        x={x}
                        y={y}
                        fill="#fff"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="11px"
                      >
                        {pct < 1 ? "<1%" : `${pct.toFixed(1)}%`}
                      </text>
                    );
                  }}
                >
                  {regionPieChartData.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={pieColors[i % pieColors.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ minWidth: "200px", maxWidth: "300px", maxHeight: "250px", overflowY: "scroll", overflowWrap: "break-word" }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {regionPieChartData.map((entry, index) => {
                return (
                  <li
                    key={`legend-${index}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "14px",
                      marginBottom: "20px",
                      color: "#f5f5f5",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        fontSize: "10px",
                        color: "#ccc",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 12,
                          height: 12,
                          backgroundColor: pieColors[index % pieColors.length],
                          borderRadius: "50%",
                          marginRight: 8,
                        }}
                      ></span>
                      {entry.name}
                    </div>
                    <div
                      style={{
                        minWidth: "80px",
                        textAlign: "right",
                        fontSize: "12px",
                        fontWeight: "bold",
                      }}
                    >
                      {entry.count} ({entry.percentage}%)
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        )}
      </div>

    );
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
              radar={selectedRadar} // This prop is not used by FilterDropdown2, but keeping it doesn't hurt
              area={selectedArea}
              onApply={({ startDate, endDate, radar, area }) => {
                setStartDate(startDate);
                setEndDate(endDate);
                setSelectedRadar(radar);
                setSelectedArea(area);
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
                setSelectedArea("All");
              }}
            />
          </div>

          {/*Total Alarms*/}
          <div style={{ ...cardStyle, minWidth: 0, flex: 0.15 }}>
            <p style={{ ...cardTitleStyle, fontWeight: "bold" }}>Total Alarms</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "40px", color: "#EC834E", fontWeight: "bold" }}> {totalAlarms}</h2>
                <p style={{ ...cardValueStyle, fontSize: "12px", color: "#ccc", margin: 0 }}>{alarmsPerDay} alarms/day</p>
              </div>
              <div style={{ display: "block", color: "#ccc" }}>
                <p style={{ fontSize: "12px", margin: 0 }}>
                  <span style={{ color: "green" }}>☑ </span>
                  <span style={{ fontWeight: "bold" }}>{percentageValid}%</span> Valid Alarms
                </p>
                <p style={{ fontSize: "12px", margin: 0 }}>
                  <span style={{ color: "red" }}>⮽ </span>
                  <span style={{ fontWeight: "bold" }}>{percentageFalse}%</span> False Alarms
                </p>
              </div>
            </div>
          </div>

          <div style={{
            display: "flex",
            gap: "10px",
            flex: 0.15
          }}>
            {/* Valid/False Alarm */}
            <div style={{ ...cardStyle, minWidth: 0 }}>
              <h4 style={{ ...cardTitleStyle, fontSize: "14px" }}>
                Frequent Alarm
              </h4>
              <p style={{ ...cardValueStyle, fontSize: "20px", color: "#EC834E" }}>{isSingleRadar ? topRegion : topRadar}</p>
            </div>
            <div style={{ ...cardStyle, minWidth: 0 }}>
              <h4 style={{ ...cardTitleStyle, fontSize: "14px" }}>
                Most Alarm Cause
              </h4>
              <p style={{ ...cardValueStyle, fontSize: "16px", color: "#EC834E" }}>{topReason}</p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        {/* Chart Grid */}
        <div style={{
          flex: 1,
          minWidth: 0, // allows it to shrink properly
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          borderRadius: "10px",
          overflowX: "auto",
          overflowY: "hidden"
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 0.5fr",
            gap: "10px",
            flex: 1,
            width: "100%"
          }}>
            {/* Alarms by Radar */}
            <div style={{ ...chartCard }}>
              <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
                <h2 style={chartTitle}> {isMultipleRadars
                  ? viewMode === "Total"
                    ? "Total Alarms by Radar"
                    : "Alarm Share by Radar (%)"
                  : viewMode === "Total"
                    ? `Alarm Region Count  ${selectedRadar}`
                    : `Alarm Region Share (%)  ${selectedRadar}`}</h2>
                <select
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value)}
                  style={dropdownStyle}
                >
                  <option value="Total">Total</option>
                  <option value="Percentage">% Share</option>
                </select>
              </div>
              {chartContent}
            </div>

            {/* Alarm Causes - Pie Chart */}
            <div style={{ ...chartCard }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={chartTitle}>Alarm Causes</h2>
                <select
                  value={reasonFilter}
                  onChange={(e) => setReasonFilter(e.target.value)}
                  style={dropdownStyle}
                >
                  <option value="All">All</option>
                  <option value="Valid">Valid Only</option>
                  <option value="False">False Only</option>
                </select>
              </div>
              {filteredReasonSource.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "250px", // Match your chart height
                    color: "#ccc",
                    fontStyle: "italic",
                  }}
                >
                  {reasonFilter === "Valid"
                    ? "No valid alarms available"
                    : reasonFilter === "False"
                      ? "No false alarms available"
                      : "No alarm data available"}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", width: "100%", maxWidth: "100%", marginTop: 10 }}>
                  <ResponsiveContainer width="60%" height={300}>
                    <PieChart>
                      <Pie
                        data={sortedReasonChartData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={110}
                        innerRadius={70}
                      >
                        {sortedReasonChartData.map((entry, index) => (
                          <Cell
                            key={`cell-${entry.name || index}`}
                            fill={pieColors[index % pieColors.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{
                        backgroundColor: "#1B1B1B",
                        border: "1px solid #5A6474",
                        padding: "10px",
                        borderRadius: "6px",
                        color: "#f5f5f5",
                        fontSize: "12px"
                      }}
                        itemStyle={{ color: "f5f5f5" }}
                        formatter={(value, _, props) => {
                          const total = reasonChartData.reduce((sum, entry) => sum + entry.value, 0);
                          const reasonName = props?.payload?.name || "Reason";
                          const percentage = ((value / total) * 100).toFixed(1);
                          return [`${value} (${percentage}%)`, reasonName];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ marginLeft: "20px", maxHeight: "250px", overflowY: "scroll" }}>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {sortedReasonChartData.map((entry, index) => {
                        return (
                          <li key={`legend-${index}`} style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "14px",
                            marginBottom: "6px",
                            color: "#f5f5f5",
                          }}>
                            {/* Left side: icon + reason name */}
                            <div style={{ display: "flex", alignItems: "center", fontSize: "12px", color: "#ccc" }}>
                              <span style={{
                                display: "inline-block",
                                width: 12,
                                height: 12,
                                backgroundColor: pieColors[index % pieColors.length],
                                borderRadius: "50%",
                                marginRight: 8
                              }}></span>
                              {entry.name}
                            </div>

                            {/* Right side: value + percentage */}
                            <div style={{ minWidth: "80px", textAlign: "right", fontSize: "12px", fontWeight: "bold" }}>
                              {entry.value} ({entry.percentage}%)
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
            {/* Priority Levels*/}
            <PriorityLevelsBox data={priorityChartData} />
          </div>

          {/* Alarm Trends - Line Chart */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
              <h2 style={chartTitle}>{isMultipleRadars
                ? showCumulative
                  ? "Cumulative Alarms by Radar"
                  : "Daily Alarm Trends"
                : showCumulative
                  ? `Cumulative Alarms by Region - ${selectedRadar}`
                  : `Daily Alarm Trends by Region - ${selectedRadar}`}</h2>
              <select
                value={showCumulative ? "Cumulative" : "Daily"}
                onChange={(e) => setShowCumulative(e.target.value === "Cumulative")}
                style={dropdownStyle
                }>
                <option value="Daily">Daily</option>
                <option value="Cumulative">Cumulative</option>
              </select>
            </div>
            {filteredReasonSource.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "250px", // Match your chart height
                  color: "#ccc",
                  fontStyle: "italic",
                }}
              >
                {reasonFilter === "Valid"
                  ? "No valid alarms over time to display."
                  : reasonFilter === "False"
                    ? "No false alarms over time to display."
                    : "No alarms over time to display."}
              </div>
            ) : (
              <div style={{ width: "100%", maxWidth: "100%", overflow: "visible" }}>
                <div style={{ width: "100%", minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={chartDataToUse} margin={{ left: 10, right: 10, top: 10 }}>
                      <CartesianGrid stroke="#444" strokeDasharray="3 3" />
                      <XAxis dataKey="name" stroke="#ccc" fontSize={12} />
                      <YAxis stroke="#ccc" fontSize={12} margin={0}>
                        <Label
                          value={showCumulative ? "Cumulative Alarms" : "Daily Alarms"}
                          angle={-90}
                          position="insideLeft"
                          dy={40}
                          style={{ fill: "#ccc", fontSize: "12px" }}
                        />
                      </YAxis>
                      <Tooltip content={<CustomTooltip markers={improvementMarkers} />} />
                      {chartKeys.map((key, index) => (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stroke={isSingleRadar ? regionColorMap[key] : fullRadarColorMap[key]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                        />
                      ))}
                      {isMultipleRadars
                        ? improvementMarkers.map((m, index) => (
                          <ReferenceDot
                            key={`dot-${index}`}
                            x={m.date}
                            y={
                              showCumulative
                                ? cumulativeLineChartData.find(d => d.name === m.date)?.[m.radar] || 0
                                : lineChartData.find(d => d.name === m.date)?.[m.radar] || 0
                            }

                            r={6}
                            fill={statusColorMap[m.status] || "#ccc"}
                            ifOverflow="visible"
                          />
                        ))
                        : improvementMarkers
                          .map((m, index) => (
                            <ReferenceDot
                              key={`dot-${index}`}
                              x={m.date}
                              y={
                                showCumulative
                                  ? cumulativeRegionLineChartData.find(d => d.name === m.date)?.[m.region] || 0
                                  : regionLineChartData.find(d => d.name === m.date)?.[m.region] || 0
                              }
                              r={6}
                              fill={statusColorMap[m.status] || "#ccc"}
                              ifOverflow="visible"
                            />
                          ))}
                    </LineChart>
                  </ResponsiveContainer>

                </div>
              </div>
            )}
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: "10px",
              marginTop: "10px",
              fontSize: "12px",
              color: "#ccc"
            }}>
              {Object.entries(statusLegendMap).map(([status, { color, description }]) => (
                <div key={status} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: color
                  }} />
                  <div>
                    {description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
export default AlarmSummaryPage;
