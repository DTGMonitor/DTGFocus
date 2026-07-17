import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    Tooltip
} from "recharts";
import { buildRadarData } from "./radarChart";
import React from "react";

/**
 * @param {object} record
 * @param {number} [width]  Fixed pixel size. Omit for the live dashboard, which
 *   uses ResponsiveContainer. REQUIRED for report/export rendering:
 *   ResponsiveContainer measures its parent, and in a detached or off-screen
 *   container that parent has no resolved height — so `height="80%"` computes to
 *   0 and the chart rasterizes blank into the PDF.
 * @param {number} [height]
 * @param {string} [outerRadius]  Shrink to leave room for the axis labels — they
 *   are drawn OUTSIDE the polygon and are clipped by the SVG box otherwise.
 * @param {object} [margin]       Reserves horizontal room for long labels
 *   ("Atm. Correction"), which otherwise run off the left/right edges.
 * @param {number} [tickFontSize]
 * @param {string} [tickColor]
 * @param {string} [gridStroke]  Grid ring colour. The default is tuned for the
 *   dark live dashboard; on white report paper it prints far too heavy.
 * @param {number[]} [gridRadii]  Explicit ring radii, in PIXELS. Recharts
 *   otherwise derives them from the radius axis ticks, which for the [0,5]
 *   domain land at scores 0/2/4/5 — straight through the Sub-Optimal score. The
 *   report passes its severity band edges so the rings trace the scale instead.
 *   See components/admin/Radar/report/radarGeometry.js.
 */
function RadarMetricsChart({
    record,
    width,
    height,
    outerRadius = "80%",
    margin,
    tickFontSize,
    tickColor,
    gridStroke = "#393939",
    gridRadii,
}) {
    const data = buildRadarData(record);
    const isFixed = Number.isFinite(width) && Number.isFinite(height);
    /* --------------------------------------------------
     Color Maps
  -------------------------------------------------- */
    const COLORS = {
        green: "#13501B",
        yellow: "#b18503ff",
        orange: "#80350E",
        red: "#8b0202ff",
        grey: "#aaa",
        purple: "#D86ECC"
    };

    // Overall scale
    const overallstatusColor = (val) => {
        switch ((val || "").toLowerCase()) {
            case "optimal":
                return COLORS.green;
            case "acceptable":
                return COLORS.yellow;
            case "sub-optimal":
            case "suboptimal":
                return COLORS.orange;
            case "critical":
                return COLORS.red;
            default:
                return COLORS.grey;
        }
    };

    const dotColor = (val) => {
        switch ((val || "").toLowerCase()) {
            case "optimal":
                return "#47D45A";
            case "acceptable":
                return "#FFC000";
            case "sub-optimal":
            case "suboptimal":
                return "#E97132";
            case "critical":
                return "#C00000";
            default:
                return COLORS.grey;
        }
    };

    const PARAMETER_LABELS = {
        SystemHealth: "System Health",
        ScanArea: "Scan Area",
        AtmosphericCorrection: "Atm. Correction",
        // add others as needed
    };

    const formatParameterLabel = (name) => {
        const str = String(name || ""); // make sure it's always a string
        return PARAMETER_LABELS[str] || str.replace(/([a-z])([A-Z])/g, "$1 $2");
    };


    const chart = (
        <RadarChart
            cx="50%"
            cy="50%"
            outerRadius={outerRadius}
            data={data}
            {...(isFixed ? { width, height } : {})}
            {...(margin ? { margin } : {})}
        >
            <PolarGrid
                radialLines={false}
                stroke={gridStroke}
                {...(gridRadii ? { polarRadius: gridRadii } : {})}
            />
            <PolarAngleAxis
                dataKey="subject"
                fontSize={tickFontSize ? `${tickFontSize}px` : "12px"}
                {...(tickColor ? { tick: { fill: tickColor, fontSize: tickFontSize ?? 12 } } : {})}
                tickFormatter={(name) => formatParameterLabel(name)}
            />
            <PolarRadiusAxis domain={[0, 5]} tick={false} axisLine={false} />
            <Radar
                name="Metrics"
                dataKey="score"
                stroke={overallstatusColor(record.parameters?.Overall?.value)}
                strokeWidth={3}
                fill="none"
                isAnimationActive={!isFixed}
                dot={({ cx, cy, index }) => (
                    <circle
                        cx={cx}
                        cy={cy}
                        r={3}
                        fill={dotColor(data[index].status)}
                        filter={`drop-shadow(0 0 8px #fff)`}
                    />
                )}
            />
        </RadarChart>
    );

    // Fixed size: render the chart directly. Animation is off so the export
    // snapshot never catches a half-drawn polygon.
    if (isFixed) return chart;

    return (
        <ResponsiveContainer width="100%" height="80%">
            {chart}
        </ResponsiveContainer>
    );
}

export default RadarMetricsChart;
