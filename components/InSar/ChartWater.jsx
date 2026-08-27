import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  ComposedChart,
  Bar,
  Line,
  Label,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from "recharts";

/**
 * Water-body area and rainfall for one site, month by month.
 *
 * The series used to come from a CSV checked into public/ (Jan–Sep 2025 only,
 * hand-updated). It now comes from `client_images`, which is where the pipeline
 * writes each month's figures — one row per product per month, carrying the
 * measured `tsf7`/`tsf8` areas and `rainfall` alongside the image path. MNDWI is
 * the row read here because it is the product the areas are measured from; the
 * other two are the same month's imagery.
 *
 * @param siteId            clients.id — the site whose series to read
 * @param availableOptions  called with {years, months, default:{year, month}}
 *                          once the series loads, so the period picker offers
 *                          exactly what exists and opens on the newest month
 * @param metaData          called with the site and record-count facts the
 *                          Data Availability card prints
 */
const WaterChart = ({ selectedMonth, selectedYear, onStatusChange, availableOptions, metaData, siteId }) => {
  const [chartData, setChartData] = useState([]);
  const latestDate = chartData.length > 0
    ? chartData[chartData.length - 1].date
    : null;

  // Held in refs so a parent that passes inline callbacks does not re-run the
  // fetch on every render.
  const availableOptionsRef = useRef(availableOptions);
  const metaDataRef = useRef(metaData);

  // Declared before the fetch effect so it has already run by the time that one
  // fires on mount — and the fetch reads the refs asynchronously in any case.
  useEffect(() => {
    availableOptionsRef.current = availableOptions;
    metaDataRef.current = metaData;
  });

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("client_images")
        .select(`
          date,
          subcategory,
          rainfall,
          tsf7,
          tsf8,
          image_url,
          client:clients(
            site_name,
            location,
            company,
            latitude,
            longitude)`)
        .eq("subcategory", "MNDWI")
        // Scoped to the site being viewed. The table holds every client's
        // figures, so an unfiltered read would put one site's water bodies on
        // another site's dashboard.
        .eq("client_id", siteId)
        .order("date", { ascending: true });

      if (error) {
        console.error("Error fetching data:", error);
        return;
      }
      if (cancelled) return;

      const withStatus = (data || []).map((row, index, arr) => {
        if (index === 0) return { ...row, TSF7_Status: "N/A", TSF8_Status: "N/A" };
        const prev = arr[index - 1];
        const getStatus = (curr, previous) => {
          if (curr === 0) return "Dry";
          if (curr < previous) return "Decreasing";
          if (curr > previous) return "Increasing";
          return "Stable";
        };
        return {
          ...row,
          TSF7_Status: getStatus(row.tsf7, prev.tsf7),
          TSF8_Status: getStatus(row.tsf8, prev.tsf8),
        };
      });

      setChartData(withStatus);

      if (availableOptionsRef.current && withStatus.length > 0) {
        const years = [...new Set(withStatus.map((r) => new Date(r.date).getFullYear()))]
          .sort((a, b) => b - a);
        const months = [...new Set(withStatus.map((r) =>
          new Date(r.date).toLocaleString("en-US", { month: "long" })))];
        const newest = new Date(withStatus[withStatus.length - 1].date);
        availableOptionsRef.current({
          years,
          months,
          default: {
            year: newest.getFullYear().toString(),
            month: newest.toLocaleString("en-US", { month: "long" }),
          },
        });
      }

      if (metaDataRef.current && (data || []).length > 0) {
        const client = data[0].client || {};
        metaDataRef.current({
          totalRecords: data.length,
          siteName: client.site_name,
          location: client.location,
          company: client.company,
          coordinates: { lat: client.latitude, lon: client.longitude },
        });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // Whenever the selected period changes, report that month's status.
  useEffect(() => {
    if (!selectedMonth || !selectedYear || chartData.length === 0) return;

    const selectedRecord = chartData.find((d) => {
      const dateObj = new Date(d.date);
      const monthName = dateObj.toLocaleString("en-US", { month: "long" });
      return (
        String(dateObj.getFullYear()) === String(selectedYear) &&
        monthName.toLowerCase() === selectedMonth.toLowerCase()
      );
    });

    if (!onStatusChange) return;
    onStatusChange(
      selectedRecord
        ? [
          ["TSF-7", selectedRecord.TSF7_Status],
          ["TSF-8", selectedRecord.TSF8_Status],
        ]
        : [["TSF-7", "No Data"], ["TSF-8", "No Data"]]
    );
  }, [selectedMonth, selectedYear, chartData, onStatusChange]);


  
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const date = new Date(label).toLocaleString("en-GB", {
        month: "short",
        year: "numeric"
      });

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
          <div><strong>{date}</strong></div>
          {payload.map((item) => {
            let unit = item.dataKey === "rainfall" ? "mm" : "km²";
            return (
              <div key={item.dataKey}>
                {item.name}: <span style={{ color: item.color }}>{item.value} {unit}</span>
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  };

  const renderLabel = ({ x, y, width, height, value, stroke }) => {
    if (value == null) return null;
    const text = String(value); const paddingX = 4; const paddingY = 2; const textWidth = text.length * 6; const boxWidth = textWidth + paddingX * 2; const boxHeight = 14;
    const isBar = width != null && height != null;
    const labelX = isBar ? x + width / 2 : x;
    const labelY = isBar ? y + height / 2 : y; return (<g> {/* background box */} <rect x={labelX - boxWidth / 2} y={labelY - boxHeight / 2} width={boxWidth} height={boxHeight} fill="#262626" rx={3} ry={3} /> {/* text */} <text x={labelX} y={labelY + 3} textAnchor="middle" fill={stroke || "#fff"} fontSize="10" fontWeight="bold" > {text} </text> </g>);
  };

  return (
    <div
      style={{
        background: "#262626",
        padding: "20px",
        color: "#fff",
        borderRadius: "10px",
        fontSize: "15px",
        flex: 1,
        display: "flex",
        flexDirection: "column"
      }}
    >
      <h3 style={{ margin: "0 0 10px" }}>WATER BODY MAPPING</h3>
      <ResponsiveContainer width="100%" height="80%">
        <ComposedChart data={chartData}>
          <defs>
            <pattern
              id="rainPattern"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="rgba(74,144,226,0.2)" />  {/* light background */}
              <line x1="0" y1="0" x2="0" y2="6" stroke="#4A90E2" strokeWidth="2" />
            </pattern>
          </defs>

          <CartesianGrid stroke="#444" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            stroke="#ccc"
            fontSize={12}
            tickFormatter={(timestamp) =>
              new Date(timestamp).toLocaleDateString("en-GB", {
                month: "short",
                year: "2-digit",
              })
            }
          />

          <YAxis fontSize={12} yAxisId="left" stroke="#ccc">
            <Label
              value="Water Area (km²)"
              angle={-90}
              position="insideLeft"
              dy={40}
              style={{ fill: "#ccc", fontSize: "12px" }}
            />
          </YAxis>
          <YAxis
            fontSize={12}
            yAxisId="right"
            orientation="right"
            stroke="#ccc"
            scale="log"
            domain={[0.1, 1000]} // avoid log(0)
            allowDataOverflow
          >
            <Label
              value="Rainfall (mm)"
              angle={90}
              position="insideRight"
              dy={40}
              style={{ fill: "#ccc", fontSize: "12px" }}
            />
          </YAxis>

          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: "12px" }} />

          <Line
            yAxisId="left"
            type="monotone"
            dataKey="tsf7"
            stroke="#FFC000"
            label={(props) => renderLabel({ ...props, stroke: "#FFC000" })}
            dot={false}
            name="TSF-7"
            strokeWidth={2}
            strokeDasharray="5 5"
          />

          <Line
            yAxisId="left"
            type="monotone"
            dataKey="tsf8"
            stroke="#FFFF00"
            label={(props) => renderLabel({ ...props, stroke: "#FFFF00" })}
            dot={false}
            name="TSF-8"
            strokeWidth={2}
            strokeDasharray="5 5"
          />
          <Bar yAxisId="right" dataKey="rainfall" fill="url(#rainPattern)" name="Monthly Rain" label={(props) => renderLabel({ ...props, stroke: "#4A90E2" })} />
        </ComposedChart>
      </ResponsiveContainer>
      {latestDate && (
        <div
          style={{
            marginTop: "10px",
            fontSize: "12px",
            color: "#aaa",
            textAlign: "right",
            fontStyle: "italic",
          }}
        >
          Latest update:{" "}
          {new Date(latestDate).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
          })}
        </div>
      )}

    </div>
  );
};

export default WaterChart;
