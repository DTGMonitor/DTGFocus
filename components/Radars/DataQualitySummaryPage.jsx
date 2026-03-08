import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import FilterDropdown2 from "@/components/Reusable/FilterButton";
import { DateTime } from "luxon";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, ScatterChart, XAxis, YAxis, ZAxis, Scatter } from 'recharts';
import { getIconComponent } from "@/components/Reusable/IconMapper";

export default function DataQualitySummaryPage() {
  const [user, setUser] = useState(null);
  const [dqpValues, setDqpValues] = useState([]);
  const [frequentIssues, setFrequentIssues] = useState([]);
  const [overallData, setOverallData] = useState([]);
  const [endDate, setEndDate] = useState(
    DateTime.now().setZone("utc").toJSDate()
  );

  const [startDate, setStartDate] = useState(() => {
    const end = DateTime.now().setZone("utc");
    return end.day < 15 ? end.minus({ days: 30 }).toJSDate() : end.startOf("month").toJSDate();
  });

  const [selectedRadar, setSelectedRadar] = useState(["All Radars"]);
  const [selectedArea, setSelectedArea] = useState("All");

  const [radarOptions, setRadarOptions] = useState(["All Radars"]);
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
        .from("radars")
        .select("id, radar_number");

      if (error) {
        console.error("Error fetching radars:", error);
      } else {
        const map = {};
        data.forEach(r => {
          map[r.radar_number] = r.id;
        });
        setRadarIdMap(map);
        setRadarOptions(["All Radars", ...data.map(r => r.radar_number)]);
      }
    };
    fetchRadars();
  }, []);

  // -------------------- LOAD DATA --------------------
  useEffect(() => {
    if (user)
      loadData();
    loadFrequentIssues();
    loadOverallData();
  }, [user, startDate, endDate, selectedRadar, radarIdMap]);

  const loadData = async () => {

    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("Australia/Perth")
      .toISODate();
    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("Australia/Perth")
      .toISODate();

    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(ssr => radarIdMap[ssr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_dqp_value_counts", {
      start_date: startISODate,
      end_date: endISODate,
      radars: radarIdsToQuery.length ? radarIdsToQuery : null
    });

    if (error) {
      console.error("RPC error:", error);
    } else {
      console.log("RPC summary counts:", data);
      setDqpValues(data ?? []);
    }
  };

  const loadFrequentIssues = async () => {


    const startISODate = DateTime.fromJSDate(startDate)
      .setZone("Australia/Perth")
      .toISODate();
    const endISODate = DateTime.fromJSDate(endDate)
      .setZone("Australia/Perth")
      .toISODate();

    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(ssr => radarIdMap[ssr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_level2_issues", {
      start_date: startISODate,
      end_date: endISODate,
      radars: radarIdsToQuery.length ? radarIdsToQuery : null
    });

    if (error) {
      console.error("RPC error (frequent issues):", error);
    } else {
      // Prepare chart data
      console.log("RPC frequent issues:", data);
      const chartData = data.map(item => ({
        name: item.parameter_name,
        value: Number(item.count_value)
      }));
      setFrequentIssues(chartData);
    }
  };

  const loadOverallData = async () => {
    const startISO = DateTime.fromJSDate(startDate).setZone("Australia/Perth").toISODate();
    const endISO = DateTime.fromJSDate(endDate).setZone("Australia/Perth").toISODate();

    const picked = Array.isArray(selectedRadar)
      ? selectedRadar.filter(r => r && r !== "All Radars")
      : [];
    const radarIdsToQuery = picked.map(ssr => radarIdMap[ssr]).filter(Boolean);

    const { data, error } = await supabase.rpc("get_overall_per_radar_day", {
      start_date: startISO,
      end_date: endISO,
      radars: radarIdsToQuery.length ? radarIdsToQuery : null,
    });
    if (error) {
      console.error(error);
      return;
    }

    // Step 1: normalize one point per radar per day
    const ptsRaw = (data ?? []).map(row => {
      const dateStr = row.record_date; // "YYYY-MM-DD" from SQL
      const x = DateTime.fromISO(`${dateStr}T00:00:00`, { zone: "UTC" }).toMillis();
      const status = row.status;
      const y = qualityOrder.length - qualityOrder.indexOf(status);
      return {
        x,
        y,
        status,
        radar: row.radar_ssr ?? `Radar ${row.radar_id}`,
        dateStr,
      };
    }).filter(p => p.y !== -1);

    // Step 2: safety dedupe by (radar, date, status) if needed
    const seen = new Set();
    const pts = [];
    for (const p of ptsRaw) {
      const k = `${p.radar}|${p.dateStr}|${p.status}`;
      if (!seen.has(k)) {
        seen.add(k);
        pts.push(p);
      }
    }

    // After your deduped `pts` (one per radar/day/status) — replace Step 3 with:
    const groupedByDate = {}; // dateStr -> { x, dateStr, statuses: { status -> Set(radars) } }

    for (const p of pts) {
      const key = p.dateStr;
      if (!groupedByDate[key]) groupedByDate[key] = { x: p.x, dateStr: p.dateStr, statuses: {} };

      if (!groupedByDate[key].statuses[p.status]) {
        groupedByDate[key].statuses[p.status] = new Set();
      }
      groupedByDate[key].statuses[p.status].add(p.radar);
    }

    // create per-status points, with z = count and radars = Array
    const ptsAgg = [];
    for (const g of Object.values(groupedByDate)) {
      for (const [status, radarSet] of Object.entries(g.statuses)) {
        ptsAgg.push({
          x: g.x,
          y: qualityOrder.length - qualityOrder.indexOf(status), // 1..4 mapping as you wanted
          status,
          z: radarSet.size,               // bubble size
          radars: Array.from(radarSet),   // unique radars
          dateStr: g.dateStr,
        });
      }
    }
    console.log("RPC overall data:", data);
    setOverallData(ptsAgg);

  };


  function prepareDonutChartData(summaryData) {
    // Only level 1 for donut titles
    const level1Data = summaryData.filter(d => d.parameter_level === 1);

    const grouped = level1Data.reduce((acc, item) => {
      if (!acc[item.parameter_id]) acc[item.parameter_id] = { title: item.parameter_name, counts: {} };
      const status = item.status;
      acc[item.parameter_id].counts[status] = (acc[item.parameter_id].counts[status] || 0) + Number(item.count_status);
      return acc;
    }, {});

    return Object.values(grouped).map(param => ({
      title: param.title,
      data: ["Optimal", "Acceptable", "Sub-Optimal", "Critical"].map(status => ({
        name: status,
        value: param.counts[status] || 0
      }))
    }));
  };

  const donutChartsData = prepareDonutChartData(dqpValues);

  const sortedChartsData = [
    ...donutChartsData.filter(c => c.title !== "Overall"),
    ...donutChartsData.filter(c => c.title === "Overall")
  ]

  const qualityOrder = ["Optimal", "Acceptable", "Sub-Optimal", "Critical"];

  const totalFrequentIssues = frequentIssues.reduce((sum, d) => sum + d.value, 0);
  const issuesWithPercent = frequentIssues.map(d => ({
    ...d,
    percent: ((d.value / totalFrequentIssues) * 100).toFixed(1)
  }));

  //DATE DIFFERENCE
  const start = DateTime.fromJSDate(startDate).startOf("day");
  const end = DateTime.fromJSDate(endDate).endOf("day");

  // Decide step size dynamically (daily if short, weekly if long, monthly if very long)
  const diffDays = end.diff(start, "days").days;
  let step = { days: 1 };
  if (diffDays > 60) step = { days: 7 };
  if (diffDays > 365) step = { months: 1 };

  // Generate ticks
  const ticks = [];
  let current = start;
  while (current <= end) {
    ticks.push(current.toMillis());
    current = current.plus(step);
  }


  const statusColorMap = { "Optimal": "#47D45A", "Acceptable": "#FFC000", "Sub-Optimal": "#E97132", "Critical": "#C00000" };

  const pieColors = ["#0EA5E9", "#F43F5E", "#6366F1", "#06B6D4", "#156082", "#EC4899", "#EF4444", "#8B5CF6"];

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
    fontSize: "18px",
    color: "#f5f5f5",
    marginTop: 0
  };

  const cardStyle = {
    flex: "1",
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

  const parameterIcons = [
    { label: "System Health", icon: "MdHealthAndSafety" },
    { label: "Scan Area", icon: "PiScanFill" },
    { label: "Photograph", icon: "IoMdPhotos" },
    { label: "Masks", icon: "FaShieldAlt" },
    { label: "Alarms", icon: "BsAlarmFill" },
    { label: "Atmospheric Correction", icon: "BsCloudSun" },
    { label: "Visual Data", icon: "PiCubeTransparent" }
  ];

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
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>{name} : {value}</div>
        </div>
      );
    }

    return null;
  };

  //LINE TOOLTIP
  const [hoverPoint, setHoverPoint] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }
  }, []);

  const zValues = overallData.length ? overallData.map(d => d.z) : [];
  const zMin = zValues.length ? Math.min(...zValues) : 1;
  const zMax = zValues.length ? Math.max(...zValues) : 1;
  const R_MIN = 3, R_MAX = 6;
  const radiusFor = (z) => {
    if (zMin === zMax) return (R_MIN + R_MAX) / 2;
    return R_MIN + ((z - zMin) / (zMax - zMin)) * (R_MAX - R_MIN);
  };
  // preprocess once
  const pointLookup = useMemo(() => {
    const map = {};
    overallData.forEach(p => {
      map[`${p.dateStr}-${p.status}`] = p;
    });
    return map;
  }, [overallData]);

  const renderPoint = (props) => {
    const { cx, cy, payload, fill } = props;
    if (cx === undefined || cy === undefined) return null;

    const r = radiusFor(payload.z ?? 1);

    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke="rgba(0,0,0,0.12)"
        onMouseEnter={(e) => {
          const rect = containerRef.current?.getBoundingClientRect();
          // use payload directly OR lookup
          const pt = pointLookup[`${payload.dateStr}-${payload.status}`] || payload;
          setHoverPoint(pt);
          if (rect) {
            setTooltipPos({
              x: e.clientX - rect.left + 8,
              y: e.clientY - rect.top + 8,
            });
          }
        }}
        onMouseMove={(e) => {
          const rect = containerRef.current?.getBoundingClientRect();
          const pt = pointLookup[`${payload.dateStr}-${payload.status}`] || payload;
          setHoverPoint(pt);

          if (rect) {
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            setTooltipPos({
              x: offsetX,
              y: offsetY,
            });
          }
        }}
        onMouseLeave={() => {
          setHoverPoint(null);
        }}
        style={{ cursor: "pointer" }}
      />
    );
  };

  //SUMMARY
  function getNonOptimalSummary(summaryData) {
    const validStatuses = ["Optimal", "Acceptable", "Sub-Optimal", "Critical"];

    // Only level 1 and exclude "Overall"
    const level1Data = summaryData.filter(
      d => d.parameter_level === 1 && d.parameter_name !== "Overall"
    );

    const grouped = level1Data.reduce((acc, item) => {
      if (!validStatuses.includes(item.status)) return acc; // skip "Not Available" or unknown

      if (!acc[item.parameter_id]) acc[item.parameter_id] = { title: item.parameter_name, total: 0, optimal: 0 };

      acc[item.parameter_id].total += Number(item.count_status);
      if (item.status === "Optimal") acc[item.parameter_id].optimal += Number(item.count_status);

      return acc;
    }, {});

    return Object.values(grouped)
      .map(param => {
        const optimalPercent = param.total ? (param.optimal / param.total) * 100 : 0;
        const nonOptimalPercent = Math.round(100 - optimalPercent);

        let message = "";
        if (param.title === "System Health") message = `${nonOptimalPercent}% minor issues`;
        else if (param.title === "Scan Area") message = `~${nonOptimalPercent}% Consistent low coherence on tailing dams`;
        else if (param.title === "Alarms") message = `~${nonOptimalPercent}% issues due to continuous false alarms`;
        else if (param.title === "Visual Data") message = `Mostly acceptable (${nonOptimalPercent}% due to the absence of graphic cards)`;
        else message = `${nonOptimalPercent}% non-optimal`;

        return { title: param.title, message, nonOptimalPercent };
      })
      .filter(param => param.nonOptimalPercent > 0);
  }



  // Usage:
  const summary = getNonOptimalSummary(dqpValues);

  //CONTENT

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
          <div style={{ ...cardStyle, gap: "10px", minWidth: 0, }
          }><h4 style={cardTitleStyle}>Overall Summary (All Radars)</h4>
            {summary.map(item => (
              <div
                key={item.title}
                // CHANGE 1: Use flexbox for the container
                style={{ display: "flex", marginBottom: "4px" }}
              >
                <div
                  style={{
                    // CHANGE 2: Set the width for the label column
                    width: "100px", // Increase this width slightly to ensure "System Health" fits
                    flexShrink: 0, // Prevent the label from shrinking
                    textAlign: "left",
                    paddingRight: "8px",
                    fontSize: "12px",
                    color: "#aaa",
                  }}
                >
                  {item.title}
                </div>

                {/* Message content */}
                <div style={{ fontSize: "12px" }}>{item.message}</div>
              </div>
            ))}</div>


        </div>

        {/* Main Content */}
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
            display: "flex",
            gap: "10px",
            flex: 1,
            width: "100%"
          }}>
            <div style={{ flex: 0.65, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridTemplateRows: "repeat(2,1fr)", gap: "10px" }}>
              {sortedChartsData.map((chart, i) => {
                // Compute total for this chart
                const total = chart.data.reduce((sum, d) => sum + d.value, 0);

                // Order chart data according to qualityOrder and add percentage
                const orderedPieData = qualityOrder
                  .map(q => chart.data.find(d => d.name === q))
                  .filter(Boolean)
                  .map(d => ({
                    ...d,
                    percentage: total ? ((d.value / total) * 100).toFixed(0) : 0
                  }));

                const chartIcon = parameterIcons.find(p => p.label === chart.title);
                const Icon = getIconComponent(chartIcon?.icon);
                const outerRadius = 55;
                const innerRadius = chart.title === "Overall" ? 0 : 50;
                const iconSize = outerRadius;

                return (
                  <div key={i} style={{ ...chartCard, backgroundColor: chart.title === "Overall" ? "#595959" : "#262626" }}>
                    <h4 style={chartTitle}>{
                      chart.title === "Overall"
                        ? "Quality Summary"
                        : chart.title === "Atmospheric Correction"
                          ? "Atm. Correction"
                          : chart.title
                    }</h4>
                    <div style={{ display: "flex", alignItems: "center", width: "100%", maxWidth: "100%" }}>
                      <ResponsiveContainer width="60%" height={120}>
                        <PieChart>
                          <Pie
                            data={orderedPieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={outerRadius}
                            innerRadius={innerRadius}
                            stroke="none"
                          >
                            {orderedPieData.map((entry, idx) => (
                              <Cell key={`cell-${idx}`} fill={statusColorMap[entry.name]} />
                            ))}

                            {Icon && (
                              <foreignObject
                                x={`50%`}
                                y={`50%`}
                                width={iconSize}
                                height={iconSize}
                                style={{ transform: `translate(-${iconSize / 2}px, -${iconSize / 2}px)` }}
                              >
                                <Icon size={iconSize} color="#ddd" />
                              </foreignObject>
                            )}
                          </Pie>
                          <Tooltip content={<CustomPieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>

                      {/* Custom legend */}
                      <div style={{ marginLeft: "20px" }}>
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                          {orderedPieData.map((entry, index) => (
                            <li
                              key={`legend-${index}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                fontSize: "14px",
                                marginBottom: "6px",
                                color: "#f5f5f5",
                              }}
                            >
                              {/* Left: color circle + status name */}
                              <div style={{ display: "flex", alignItems: "center", fontSize: "12px", color: "#ccc" }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    width: 12,
                                    height: 12,
                                    backgroundColor: statusColorMap[entry.name],
                                    borderRadius: "50%",
                                    marginRight: 8
                                  }}
                                />
                              </div>

                              {/* Right: value + percentage */}
                              <div
                                style={{
                                  textAlign: "right",
                                  fontSize: "12px",
                                  fontWeight: "bold"
                                }}
                              >
                                {entry.percentage}%
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })}


            </div>
            <div style={{ ...chartCard, flex: 0.35 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={chartTitle}>Frequent Issue List</h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", width: "100%", maxWidth: "100%" }}>
                <ResponsiveContainer width="60%" height={300}>
                  <PieChart>
                    <Pie
                      data={issuesWithPercent}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={120}
                    >
                      {issuesWithPercent.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={CustomPieTooltip} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Custom legend */}
                <div style={{ marginLeft: "5px" }}>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {issuesWithPercent.map((entry, index) => (
                      <li
                        key={`legend-${index}`}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: "14px",
                          marginBottom: "6px",
                          color: "#f5f5f5",
                        }}
                      >
                        {/* Left: color circle + status name */}
                        <div style={{ display: "flex", alignItems: "center", fontSize: "12px", color: "#ccc" }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 12,
                              height: 12,
                              backgroundColor: pieColors[index % pieColors.length],
                              borderRadius: "50%",
                              marginRight: 8
                            }}
                          />
                          {entry.name}
                        </div>

                        {/* Right: value + percentage */}
                        <div
                          style={{
                            textAlign: "right",
                            fontSize: "12px",
                            fontWeight: "bold"
                          }}
                        >
                          {entry.percent}%
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
              <h2 style={chartTitle}>Overall Data Quality Record</h2>
            </div>
            <div style={{ width: "100%", minWidth: 0 }}>
              <div ref={containerRef} style={{ position: "relative" }} onMouseLeave={() => setHoverPoint(null)}>
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ left: 50, right: 16, top: 8, bottom: 8 }}>
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={[start.toMillis(), end.toMillis()]}
                      ticks={ticks}
                      tickFormatter={(ms) => DateTime.fromMillis(ms).toFormat("yyyy-MM-dd")}
                      fontSize={12}
                      stroke="#ccc"
                    />
                    <YAxis
                      dataKey="y"
                      type="number"
                      domain={[0, qualityOrder.length]}
                      ticks={[1, 2, 3, 4]}
                      tick={({ x, y, payload }) => {
                        const status = qualityOrder[qualityOrder.length - payload.value];
                        const color = statusColorMap[status];

                        return (
                          <g transform={`translate(${x},${y})`}>
                            <circle cx={-90} cy={0} r={4} fill={color} />
                            <text
                              x={-80} // relative to the circle
                              y={5}
                              textAnchor="start"
                              fill="#9ca3af"
                              fontSize={12}
                            >
                              {status}
                            </text>
                          </g>
                        );
                      }}
                      stroke="none"
                    />


                    <ZAxis dataKey="z" type="number" range={[R_MIN, R_MAX]} />
                    {/* DO NOT use Recharts Tooltip here (it is the cause of mismatch) */}
                    {qualityOrder.map((st) => (
                      <Scatter
                        key={st}
                        name={st}
                        data={overallData.filter((p) => p.status === st)}
                        fill={statusColorMap[st]}
                        shape={renderPoint}    // our custom shape that sets hoverPoint
                      />
                    ))}

                  </ScatterChart>
                </ResponsiveContainer>

                {/* Custom floating tooltip positioned inside container */}
                {hoverPoint && (
                  <div
                    style={{
                      position: "absolute",
                      left: tooltipPos.x,
                      top: tooltipPos.y,
                      // Flip horizontally if tooltip would overflow container width
                      transform: `
        translate(
          ${tooltipPos.x > containerSize.width - 150 ? "-100%" : "8px"},
          ${tooltipPos.y > containerSize.height - 80 ? "-100%" : "8px"}
        )
      `,
                      background: "#1B1B1B",
                      border: "1px solid #5A6474",
                      padding: 10,
                      borderRadius: 6,
                      color: "#f5f5f5",
                      fontSize: 12,
                      zIndex: 999,
                      pointerEvents: "none"
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {hoverPoint.dateStr}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          background: statusColorMap[hoverPoint.status],
                          borderRadius: "50%",
                          display: "inline-block",
                        }}
                      />
                      <div>
                        {hoverPoint.status} ({hoverPoint.z})
                      </div>
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {hoverPoint.radars?.join(", ")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
