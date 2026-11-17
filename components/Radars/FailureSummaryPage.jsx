import { useEffect, useState, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  LineChart, Line,
  ResponsiveContainer,
  Label,
  ReferenceDot
} from "recharts";
import FileUploadDropzone from "../../../../components/FileUploadDropzone";
import Header from "../../../../components/Header";
import React from "react";
import FilterButton from "../../../../components/FilterButton";

function FailureSummaryPage() {
  const [data, setData] = useState([]);
  const [selectedYear, setSelectedYear] = useState("All");
  const [selectedMonth, setSelectedMonth] = useState("All");
  const [selectedRadar, setSelectedRadar] = useState("All Radars");
  const [showCumulative, setShowCumulative] = useState("All Radars");
  const [viewMode, setViewMode] = useState("Total");
  const [reasonFilter, setReasonFilter] = useState("All");


  useEffect(() => {
    // Disable horizontal scrolling globally
    document.body.style.overflowX = "hidden";
    document.documentElement.style.overflowX = "hidden";

    const fetchData = async () => {
      if (selectedMonth === "All") {
        const url = `${import.meta.env.BASE_URL}Alarm_All.json`; // ✅ works in dev + prod
// typically becomes "/Alarm_All.json"
;

        try {
          const res = await fetch(url);
          if (!res.ok) {
            console.warn("Alarm_All.json not found");
            setData([]);
            return;
          }
          const json = await res.json();
          setData(Array.isArray(json) ? json : []);
        } catch (err) {
          console.error("Error fetching Alarm_All.json:", err.message);
          setData([]);
        }

      } else {
        // fetch individual month
        const selectedMonthNumber = new Date(`${selectedMonth} 1, ${selectedYear}`).getMonth() + 1;
        const formattedMonth = `${selectedYear}-${selectedMonthNumber.toString().padStart(2, '0')}`;
        const url = `${import.meta.env.BASE_URL}Alarm_${formattedMonth}.json`;

        try {
          const res = await fetch(url);
          if (!res.ok) {
            console.warn(`File not found: ${formattedMonth}`);
            setData([]);
            return;
          }
          const json = await res.json();
          setData(Array.isArray(json) ? json : []);
        } catch (err) {
          console.error(`Error fetching ${formattedMonth}:`, err.message);
          setData([]);
        }
      }
    };

    fetchData();
  }, [selectedYear, selectedMonth]);



  const filteredData = data.filter(item => {
    const createdDate = new Date(item.AlarmTriggeredTime);
    if (isNaN(createdDate)) return false;

    const itemYear = createdDate.getFullYear();
    const itemMonth = createdDate.toLocaleString("default", { month: "long" });

    const matchesYear =  selectedYear === "All" || itemYear === parseInt(selectedYear);
    const matchesMonth = selectedMonth === "All" || itemMonth === selectedMonth;
    const matchesRadar = selectedRadar === "All Radars" || item.field_1 === selectedRadar;

    const hasAlarm = item.AlarmTriggeredTime && item.AlarmTriggeredTime.trim() !== "";

    return hasAlarm && matchesYear && matchesMonth && matchesRadar;
  });

  const ssrCounts = {};
  const filteredReasonSource = reasonFilter === "All"
    ? filteredData
    : filteredData.filter(item =>
      reasonFilter === "Valid" ? item.field_9 === "Valid" : item.field_9 !== "Valid"
    );

  const reasonCounts = {};
  filteredReasonSource.forEach(item => {
    const reason = item.field_10 || "Unspecified";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });

  const allRadarNames = [...new Set(filteredReasonSource.map(item => item.field_1 || "Unknown"))];
  const radarDateCounts = {};

  filteredReasonSource.forEach(item => {
    const ssr = item.field_1 || "Unknown";
    ssrCounts[ssr] = (ssrCounts[ssr] || 0) + 1;

    const reason = item.field_10 || "Unspecified";


    const date = new Date(item.AlarmTriggeredTime).toISOString().split("T")[0];
    const radar = item.field_1 || "Unknown";

    if (!radarDateCounts[date]) {
      radarDateCounts[date] = {}; allRadarNames.forEach(name => radarDateCounts[date][name] = 0);
    }

    radarDateCounts[date][radar]++;
  });

  // Store alarm region counts by radar
  // Group by Radar → then count the most common Region (field_8)
  const radarRegionMap = {};

  filteredReasonSource.forEach(item => {
    const radar = item.field_1 || "Unknown";
    const region = item.field_8 || "Unspecified";

    if (!radarRegionMap[radar]) radarRegionMap[radar] = {};
    radarRegionMap[radar][region] = (radarRegionMap[radar][region] || 0) + 1;
  });

  const radarColors = [
    "#0EA5E9", "#F43F5E", "#6366F1", "#06B6D4", "#14B8A6", "#EC4899", "#EF4444", "#8B5CF6"
  ];

  const radarColorMap = {};
  allRadarNames.forEach((radar, i) => {
    radarColorMap[radar] = radarColors[i % radarColors.length];
  });

  // Alarm Regions
  const selectedRadarRegionCounts = {};

  if (selectedRadar !== "All Radars") {
    filteredReasonSource.forEach(item => {
      if (item.field_1 === selectedRadar) {
        const region = item.field_8 || "Unspecified";
        selectedRadarRegionCounts[region] = (selectedRadarRegionCounts[region] || 0) + 1;
      }
    });
  };

  const regionBarChartData = Object.entries(selectedRadarRegionCounts).map(([region, value]) => ({
    name: region,
    value
  }));

  const totalRegionAlarms = Object.values(selectedRadarRegionCounts).reduce((sum, v) => sum + v, 0);

  const regionPieChartData = Object.entries(selectedRadarRegionCounts).map(([region, count]) => {
    const percentage = parseFloat(((count / totalRegionAlarms) * 100).toFixed(1));
    return {
      name: region,
      count,           // raw number of alarms
      percentage       // computed percentage
    };
  }
  );

  // Total alarms
  const totalAlarms = filteredReasonSource.length;

  // Valid alarms
  const validAlarms = filteredReasonSource.filter(item => item.field_9 === "Valid").length;
  const percentageValid = totalAlarms > 0 ? Math.round((validAlarms / totalAlarms) * 100) : 0;

  // Unwanted alarms
  const unwantedAlarms = filteredReasonSource.filter(item => item.field_9 === "Unwanted").length;
  const percentageUnwanted = totalAlarms > 0 ? Math.round((unwantedAlarms / totalAlarms) * 100) : 0;

  //Priority levels
  const priorityCounts = filteredReasonSource.reduce((acc, item) => {
    const priority = item.field_7 || "Unspecified";
    acc[priority] = (acc[priority] || 0) + 1;
    return acc;
  }, {});

  const ssrChartData = Object.entries(ssrCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const reasonChartData = Object.entries(reasonCounts).map(([name, value]) => ({ name, value }));
  const lineChartData = Object.entries(radarDateCounts).map(([date, radars]) => ({
    name: date,
    ...radars
  }));

  //Priority Chart
  const priorityLevelMap = {
    "Red Alarm": { label: "Priority Level 1", color: "#EF4444" },     // Red
    "Orange Alarm": { label: "Priority Level 2", color: "#F97316" },  // Orange
    "Yellow Alarm": { label: "Priority Level 3", color: "#EAB308" },  // Yellow
    "Purple Alarm": { label: "Priority Level 4", color: "#A855F7" },  // Purple
    "Blue Alarm": { label: "Priority Level 5", color: "#3B82F6" }     // Blue
  };
  const priorityChartData = Object.entries(priorityCounts).map(([originalName, value]) => {
    const mapped = priorityLevelMap[originalName] || { label: originalName, color: "#9CA3AF" }; // Gray fallback
    return {
      name: mapped.label,
      value,
      fill: mapped.color
    };
  });
  const priorityOrder = ["Priority Level 1", "Priority Level 2", "Priority Level 3", "Priority Level 4", "Priority Level 5"];

  priorityChartData.sort((a, b) =>
    priorityOrder.indexOf(a.name) - priorityOrder.indexOf(b.name)
  );

  // Cumulative Radars
  const cumulativeDataMap = {};
  const sortedDates = Object.keys(radarDateCounts).sort();

  const cumulativeLineChartData = sortedDates.map(date => {
    const entry = { name: date };
    for (let radar of allRadarNames) {
      const dailyCount = radarDateCounts[date]?.[radar] || 0;
      cumulativeDataMap[radar] = (cumulativeDataMap[radar] || 0) + dailyCount;
      entry[radar] = cumulativeDataMap[radar];
    }
    return entry;
  });

  //Cumulative Regions
  const regionDateMap = {};

  filteredReasonSource.forEach(item => {
    if (selectedRadar !== "All Radars" && item.field_1 !== selectedRadar) return;

    const date = new Date(item.AlarmTriggeredTime).toISOString().split("T")[0];
    const region = item.field_8 || "Unspecified";

    if (!regionDateMap[date]) regionDateMap[date] = {};
    regionDateMap[date][region] = (regionDateMap[date][region] || 0) + 1;
  });

  const allRegions = [...new Set(Object.values(regionDateMap).flatMap(r => Object.keys(r)))];

  const regionLineChartData = Object.entries(regionDateMap)
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .map(([date, counts]) => {
      const entry = { name: date };
      allRegions.forEach(region => {
        entry[region] = counts[region] || 0;
      });
      return entry;
    });

  const cumulativeMap = {};
  const cumulativeRegionLineChartData = regionLineChartData.map(entry => {
    const cumEntry = { name: entry.name };
    allRegions.forEach(region => {
      cumulativeMap[region] = (cumulativeMap[region] || 0) + (entry[region] || 0);
      cumEntry[region] = cumulativeMap[region];
    });
    return cumEntry;
  });
  const isAllRadars = selectedRadar === "All Radars";

  const chartDataToUse = isAllRadars
    ? (showCumulative ? cumulativeLineChartData : lineChartData)
    : (showCumulative ? cumulativeRegionLineChartData : regionLineChartData);

  const chartKeys = isAllRadars
    ? Object.keys(radarDateCounts[Object.keys(radarDateCounts)[0]] || {})
    : allRegions;

  const regionColors = [
    "#0EA5E9", "#F43F5E", "#6366F1", "#06B6D4", "#156082", "#EC4899", "#EF4444", "#8B5CF6"
  ];

  const regionColorMap = {};
  allRegions.forEach((region, index) => {
    regionColorMap[region] = regionColors[index % regionColors.length];
  });


  // Alarms per day
  let monthDays;

  if (selectedMonth === "All") {
    const uniqueYearMonthSet = new Set(
      filteredReasonSource.map(item => {
        const d = new Date(item.AlarmTriggeredTime);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      })
    );

    let total = 0;
    uniqueYearMonthSet.forEach(ym => {
      const [year, month] = ym.split("-");
      const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
      total += daysInMonth;
    });

    monthDays = total;
  } else {
    const monthIndex = new Date(`${selectedMonth} 1, ${selectedYear}`).getMonth();
    monthDays = new Date(selectedYear, monthIndex + 1, 0).getDate();
  }
  const alarmsPerDay = totalAlarms > 0 ? Number(totalAlarms / monthDays).toFixed(1) : 0;

  // %Share (Radar)
  const ssrPercentageData = ssrChartData.map(item => {
    const percentage = parseFloat(((item.value / totalAlarms) * 100).toFixed(1));
    return {
      name: item.name,
      value: item.value,                // raw count
      percentage,                       // for tooltip and legend
      fill: radarColorMap[item.name] || "#888"
    };
  });

  // Alarm Improvement Status
  const improvementStatusCounts = {
    Modified: 0,
    "Awaiting Feedback": 0,
    "Not Implemented": 0
  };

  filteredReasonSource.forEach(item => {
    const status = String(item.AlarmImprovementStatus0 || "").trim();
    ;
    if (improvementStatusCounts.hasOwnProperty(status)) {
      improvementStatusCounts[status]++;
    }
  });

  const dtgTotal = Object.values(improvementStatusCounts).reduce((sum, val) => sum + val, 0);

  const improvementMarkers = filteredReasonSource
    .filter(item => {
      const status = String(item.AlarmImprovementStatus0 || "").trim();
      return status !== "";
    })
    .map(item => ({
      date: new Date(item.AlarmTriggeredTime).toISOString().split("T")[0],
      radar: item.field_1 || "Unknown",
      region: item.field_8 || "Unspecified",
      status: String(item.AlarmImprovementStatus0).trim()
    }));

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
    backgroundColor: "var(--dtg-bg-primary)",
    padding: "20px",
    borderRadius: "10px",
  };

  const chartTitle = {
    marginBottom: "10px",
    fontSize: "15px",
    color: "#14B8A6"
  };

  const yearOptions = [
    "All",
    ...new Set(
      data
        .map(item => {
          const date = new Date(item.AlarmTriggeredTime);
          return isNaN(date) ? null : date.getFullYear();
        })
        .filter(Boolean)
    ).values()
  ].sort((a, b) => {
    if (a === "All") return -1;
    if (b === "All") return 1;
    return b - a; // descending for years
  });

  const monthOptions = [
    "All",
    ...new Set(
      data
        .map(item => {
          const date = new Date(item.AlarmTriggeredTime);
          return isNaN(date)
            ? null
            : date.toLocaleString("default", { month: "long" });
        })
        .filter(Boolean)
    )
  ];

  const radarOptions = ["All Radars", ...new Set(data.map(d => d.field_1).filter(Boolean))];

  const cardStyle = {
    flex: "1",
    minWidth: "200px",
    backgroundColor: "var(--dtg-bg-primary)",
    borderRadius: "10px",
    padding: "20px",
    color: "var(--dtg-text-primary)",
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between"
  };

  const cardTitleStyle = {
    fontSize: "15px",
    margin: 0,
    marginBottom: "5px",
    color: "#14B8A6"
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
        backgroundColor: "var(--dtg-bg-primary)",
        border: "1px solid var(--dtg-border-medium)",
        padding: "10px",
        borderRadius: "6px",
        color: "var(--dtg-text-primary)",
        fontSize: "12px"
      }}>
        <p style={{ marginBottom: "6px" }}>{label}</p>
        {sortedPayload.map((entry, index) => (
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
      </div>
    );
  };

  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const { name, value, payload: entry } = payload[0]; // `entry` gives you the full object with percentage

      return (
        <div
          style={{
            backgroundColor: "var(--dtg-bg-primary)",
            border: "1px solid var(--dtg-border-medium)",
            padding: "10px",
            borderRadius: "8px",
            color: "var(--dtg-text-primary)",
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
            backgroundColor: "var(--dtg-bg-primary)",
            border: "1px solid var(--dtg-border-medium)",
            padding: "10px",
            borderRadius: "6px",
            color: "var(--dtg-text-primary)",
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

  const totalReason = reasonChartData.reduce((sum, entry) => sum + entry.value, 0);
  const sortedReasonChartData = [...reasonChartData].sort((a, b) => b.value - a.value);

  const CustomBarLabel = (props) => {
    const { x, y, width, height, value, index } = props;

    // Skip rendering if value is null/undefined or index is out of range
    if (value == null || !priorityChartData[index]) return null;

    const fill = priorityChartData[index].fill || "var(--dtg-text-primary)"; // fallback color

    return (
      <text
        x={x + width + 5}
        y={y + height / 2}
        fill={fill}
        fontSize={10}
        dominantBaseline="middle"
      >
        {value}
      </text>
    );
  };

  const levelCount = priorityChartData.length;
  const levelpointPadding = Math.max(15, 15 / levelCount);

  const ssrChartCount = ssrChartData.length;
  const ssrPointPadding = Math.max(30, 200 / ssrChartCount);
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
          color: "var(--dtg-text-secondary)",
          fontStyle: "italic",
        }}
      >
        {reasonFilter === "Valid"
          ? "No valid alarms by radar available."
          : reasonFilter === "Unwanted"
            ? "No unwanted alarms by radar available."
            : "No alarms by radar available."}
      </div>
    );
  } else if (selectedRadar === "All Radars") {
    chartContent = (
      <ResponsiveContainer width="100%" height={300}>
        {viewMode === "Total" ? (
          <BarChart data={ssrChartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#444" strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke="var(--dtg-text-secondary)" fontSize={12} scale="point" padding={{ left: ssrPointPadding, right: ssrPointPadding }} />
            <YAxis stroke="var(--dtg-text-secondary)" fontSize={12}>
              <Label
                value="Total Alarms"
                angle={-90}
                position="insideLeft"
                dy={30}
                style={{ fill: "var(--dtg-text-secondary)", fontSize: "12px" }}
              />
            </YAxis>
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--dtg-bg-primary)",
                border: "1px solid var(--dtg-border-medium)",
                padding: "10px",
                borderRadius: "6px",
                color: "var(--dtg-text-primary)",
                fontSize: "12px",
              }}
              formatter={(value) => [value, "Alarms"]}
            />
            <Bar dataKey="value" barSize={dynamicssrBarSize} fill="#14B8A6" radius={[5, 5, 0, 0]} label={{ position: "top", fill: "var(--dtg-text-primary)", fontSize: 10 }} />
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
                    <Cell key={`cell-${index}`} fill={radarColorMap[entry.name]} />
                  ))}
                </Pie>
              </PieChart>
            </div>

            <div style={{ minWidth: "200px", maxWidth: "300px", overflowWrap: "break-word" }}>
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
                        color: "var(--dtg-text-primary)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          fontSize: "12px",
                          color: "var(--dtg-text-secondary)",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            backgroundColor: radarColorMap[entry.name],
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
  } else {
    // Specific radar selected  show alarm region charts
    chartContent = (
      <div style={{ display: "flex", gap: "20px", width: "100%" }}>

        {regionBarChartData.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--dtg-text-secondary)",
              fontStyle: "italic",
              padding: "30px",
            }}
          >
            No region data available for {selectedRadar}.
          </div>
        ) : viewMode === "Total" ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={regionBarChartData} margin={{ top: 20, right: 10, bottom: 80, left: 0 }}>
              <CartesianGrid stroke="#444" strokeDasharray="3 3" />
              <XAxis dataKey="name"
                stroke="var(--dtg-text-secondary)"
                fontSize={9}
                angle={-45}
                textAnchor="end"
                interval={0}
                dy={10}
                scale="point" padding={{ left: regionPointPadding, right: regionPointPadding }} />
              <YAxis stroke="var(--dtg-text-secondary)" fontSize={12} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="value" barSize={dynamicregionBarSize} fill="#14B8A6" radius={[5, 5, 0, 0]} label={{ position: "top", fill: "var(--dtg-text-primary)", fontSize: 10 }} />
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
                        fill="var(--dtg-text-primary)"
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
          <div style={{ minWidth: "200px", maxWidth: "300px", overflowWrap: "break-word" }}>
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
                      color: "var(--dtg-text-primary)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        fontSize: "10px",
                        color: "var(--dtg-text-secondary)",
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

  const CustomBar = (props) => {
    const { x, y, width, height, fill } = props;
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        onMouseOver={() => { }} // override internal hover
      />
    );
  };


  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      boxSizing: "border-box",
      overflowY: "auto",
      overflowX: "hidden",
      backgroundColor: "var(--dtg-bg-primary)",
      color: "var(--dtg-text-primary)",
      fontFamily: "Inter, sans-serif",
      display: "flex",
      flexDirection: "column",
      padding: "10px",
      gap: "10px"
    }}>

      <Header />

      <div style={{
        display: "flex",
        gap: "10px",
        height: "100%",
        flexWrap: "nowrap",
      }}>
      
 </div>
    </div>
  );
}
export default FailureSummaryPage;




