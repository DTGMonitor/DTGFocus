import React, { useEffect, useState } from "react";
import Papa from "papaparse";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    ResponsiveContainer,
    Legend,
    Label
} from "recharts";
import { timeParse, timeFormat } from "d3-time-format";

const parseTime = timeParse("%-d/%-m/%Y");
const formatTime = timeFormat("%b %Y");

const PrismChart = ({ IDs = [], fromYear = null, toYear = null, dataUrl = null }) => {
    const [metric, setMetric] = useState("CummulativeDisplacement");
    const [chartData, setChartData] = useState([]);
    const [prismKeys, setPrismKeys] = useState([]);

    useEffect(() => {
        if (!dataUrl) {
            setChartData([]);
            setPrismKeys([]);
            return;
        }
        fetch(dataUrl)
            .then((res) => {
                if (!res.ok) throw new Error("No prism series at " + dataUrl);
                return res.text();
            })
            .then((csvText) => {
                const parsed = Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                }).data;
                console.log("Raw parsed CSV data:", parsed);

                // Filter by ID or year if provided
                let filtered = parsed.map(row => ({
                    ...row,
                    timestamp: new Date(row.date).getTime(), // add numeric timestamp
                    date: row.date,
                    ID: row.ID,
                    CummulativeDisplacement: parseFloat(row.CummulativeDisplacement),
                    Velocity: parseFloat(row.Velocity)
                }));

                if (IDs.length > 0) filtered = filtered.filter(row => IDs.includes(row.ID));
                if (fromYear)
                    filtered = filtered.filter(
                        (row) => new Date(row.date).getFullYear() >= fromYear
                    );
                if (toYear)
                    filtered = filtered.filter(
                        (row) => new Date(row.date).getFullYear() <= toYear
                    );

                const pivoted = pivotDataByMetric(filtered, metric);
                setChartData(pivoted);

                const uniqueIDs = [...new Set(filtered.map((row) => row.ID))];
                setPrismKeys(uniqueIDs);
            })
            // A site whose folder has no series file leaves the chart empty
            // rather than rejecting into nothing.
            .catch((err) => {
                console.error("Error loading prism series:", err);
                setChartData([]);
                setPrismKeys([]);
            });
    }, [metric, IDs, fromYear, toYear, dataUrl]);

    const latestDate =
        chartData.length > 0
            ? new Date(chartData[chartData.length - 1].timestamp)
            : null;


    const pivotDataByMetric = (data, metricKey) => {
        const grouped = {};
        data.forEach(({ timestamp, ID, [metricKey]: value }) => {
            if (!grouped[timestamp]) grouped[timestamp] = { timestamp };
            grouped[timestamp][ID] = value;
        });
        return Object.entries(grouped)
            .map(([timestamp, values]) => ({ timestamp: +timestamp, ...values }))
            .sort((a, b) => a.timestamp - b.timestamp);
    };

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const date = formatTime(new Date(label));
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
                        const unit = metric === "CummulativeDisplacement" ? "mm" : "mm/day";
                        return (
                            <div key={item.dataKey}>
                                {item.name || item.dataKey}: <span style={{ color: item.color }}>{Number(item.value).toFixed(2)} {unit}</span>
                            </div>
                        );
                    })}
                </div>
            );
        }

        return null;
    };

    return (
        <div
            style={{
                gridColumn: "2 / 2",
                gridRow: "2 / 2",
                background: "#262626",
                padding: "0 20px",
                color: "#14B8A6",
                borderRadius: "10px",
                fontSize: "15px",
                flex: 1,
                overflow: "hidden"
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", paddingRight: "5px", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Prism {metric} Chart</h3>

                {/* Optional metric toggle */}
                <div style={{ marginBottom: "8px" }}>
                    <select
                        value={metric}
                        onChange={(e) => setMetric(e.target.value)}
                        style={{
                            padding: "8px",
                            borderRadius: "6px",
                            border: "1px solid #7F7F7F",
                            backgroundColor: "#08403D",
                            color: "#fff",
                            fontSize: "14px",
                        }}
                    >
                        <option value="CummulativeDisplacement">Cummulative Displacement</option>
                        <option value="Velocity">Velocity</option>
                    </select>
                </div>
            </div>
            {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                        <CartesianGrid stroke="#444" strokeDasharray="3 3" />
                        <XAxis
                            dataKey="timestamp"
                            type="number"
                            scale="time"
                            domain={["auto", "auto"]}
                            tickFormatter={formatTime}
                            stroke="#ccc"
                            fontSize={12}
                        />
                        <YAxis yAxisId="left" stroke="#ccc" fontSize={12}>
                            <Label
                                value={metric === "CummulativeDisplacement" ? "Deformation (mm)" : "Velocity (mm/day)"}
                                angle={-90}
                                position="insideLeft"
                                dy={40}
                                style={{ fill: "#ccc", fontSize: "12px" }}
                            />
                        </YAxis>
                        <Tooltip content={<CustomTooltip />} />
                        {prismKeys.map((id, idx) => (
                            <Line
                                key={id}
                                type="monotone"
                                dataKey={id}
                                stroke={`hsl(${idx * 60}, 70%, 60%)`}
                                dot={false}
                                strokeWidth={2}
                                name={id}
                                yAxisId="left"
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <p>Loading data...</p>
            )}
            {latestDate && (
                <div
                    style={{
                        marginTop: "0px",
                        fontSize: "12px",
                        color: "#aaa",
                        textAlign: "right",
                        fontStyle: "italic",
                    }}
                >
                    Latest update:{" "}
                    {latestDate.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                    })}
                </div>
            )}

        </div>
    );
};

export default PrismChart;
