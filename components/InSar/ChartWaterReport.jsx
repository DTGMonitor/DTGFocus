import React from "react";
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
  Legend
} from "recharts";

const WaterChartReport = ({ chartData }) => {
  // Defensive check for missing data
  if (!chartData || chartData.length === 0) {
    return <div style={{ color: 'white' }}>No data available for chart</div>;
  }

  const renderLabel = (props) => {
    const { x, y, width, height, value, stroke } = props;

    // --- FIX 1: Safety Check for NaN ---
    // If value is null, OR x/y are not valid numbers, do not render.
    if (value == null || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const text = String(value);
    const paddingX = 4;
    const textWidth = text.length * 6;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = 14;

    // Logic to center label based on Bar vs Line
    const isBar = width != null && height != null;
    const labelX = isBar ? x + width / 2 : x;
    const labelY = isBar ? y + height / 2 : y;

    return (
      <g>
        <rect
          x={labelX - boxWidth / 2}
          y={labelY - boxHeight / 2}
          width={boxWidth}
          height={boxHeight}
          fill="#262626"
          rx={3}
          ry={3}
        />
        <text
          x={labelX}
          y={labelY + 3}
          textAnchor="middle"
          fill={stroke || "#fff"}
          fontSize="10"
          fontWeight="bold"
        >
          {text}
        </text>
      </g>
    );
  };

  return (
    <div
      style={{
        padding: "20px",
        color: "#134e4a",
        borderRadius: "10px",
        border: "2px solid #134e4a",
        fontSize: "15px",
        width: "100%",
        height: "55%",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <defs>
            <pattern
              id="rainPattern"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="rgba(37,99,235,0.2)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#4A90E2" strokeWidth="2" />
            </pattern>
          </defs>

          <CartesianGrid stroke="#444" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            stroke="#ccc"
            fontSize={12}
            tickFormatter={(date) =>
              new Date(date).toLocaleDateString("en-GB", {
                month: "short",
                year: "2-digit",
              })
            }
          />

          {/* --- FIX 2: Left Axis Scaling --- */}
          <YAxis
            fontSize={12}
            yAxisId="left"
            stroke="#ccc"
            // Use function to add 20% headroom to the max value found
            domain={[0, (dataMax) => Math.ceil((dataMax * 1.2) * 100) / 100]}
          >
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
            domain={[0.1, 1000]}
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
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          <Bar
            yAxisId="right"
            dataKey="rainfall"
            fill="url(#rainPattern)"
            name="Monthly Rain"
            isAnimationActive={false}
            label={(props) => renderLabel({ ...props, stroke: "#4A90E2" })}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="tsf7"
            stroke="#ff5500ff"
            isAnimationActive={false}
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
            stroke="#ffbf00ff"
            isAnimationActive={false}
            label={(props) => renderLabel({ ...props, stroke: "#FFFF00" })}
            dot={false}
            name="TSF-8"
            strokeWidth={2}
            strokeDasharray="5 5"
          />

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default WaterChartReport;