import React, { useEffect, useState, useMemo } from "react";
import { FaArrowRight, FaRegBell, FaSyncAlt } from "react-icons/fa";
import { ImWarning } from "react-icons/im";
import { PiPresentationChartBold } from "react-icons/pi";
import { supabase } from "@/lib/supabaseClient";
import { pivotParameterTree } from "@/utils/buildRadarRecord";
import { DQP_IMAGE_COLUMNS, attachDqpImages } from "@/utils/dqpImages";
import { resolveRiskPresentation } from "@/config/riskDisplay";

function countLevel2StatusesFromParamTree(paramTree) {
  const counts = { Acceptable: 0, "Sub-Optimal": 0, Critical: 0 };

  if (!paramTree) return counts;

  for (const parent of Object.values(paramTree)) {
    const children = parent.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const status = (child.value || "").trim();
      if (counts.hasOwnProperty(status)) counts[status]++;
    }
  }
  return counts;
};

function splitRadarName(radar) {
  if (!radar) return { prefix: "", model: "" };
  const match = radar.match(/^([A-Za-z]+)(.*)$/);
  if (match) {
    return { prefix: match[1], model: match[2] };
  }
  return { prefix: radar, model: "" };
};

/* --------------------------------------------------
   Color Maps
-------------------------------------------------- */
const COLORS = {
  green: "#008000",
  yellow: "#e7be09ff",
  orange: "#c2550dff",
  red: "#FF0000",
  grey: "#888888",
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

// Alarm scale
const alarmstatusColor = (val) => {
  switch ((val || "").toLowerCase()) {
    case "n/a":
      return COLORS.grey;
    case "yellow":
      return COLORS.yellow;
    case "orange":
      return COLORS.orange;
    case "red":
      return COLORS.red;
    case "false":
      return "#fff";
    default:
      return COLORS.green;
  }
};

const alarmGlow = (val) => {
  switch ((val || "").toLowerCase()) {
    case "red alarm triggered":
      return `drop-shadow(0 0 8px ${COLORS.red})`;
    case "orange alarm triggered":
      return `drop-shadow(0 0 8px ${COLORS.orange})`;
    case "yellow alarm triggered":
      return `drop-shadow(0 0 8px ${COLORS.yellow})`;
    case "false alarm":
      return `drop-shadow(0 0 8px #fff)`;
    default:
      return "none";
  }
};

//connection scale
const CONNECTION_CONFIG = {
  Optimal: { bars: 4, color: "#00B050" },   // green
  Slow: { bars: 2, color: "#E97132" },   // orange
  Lost: { bars: 0, color: "#7F7F7F" },   // grey
};

const ConnectionBars = ({ connection }) => {
  const { bars, color } = CONNECTION_CONFIG[connection] || { bars: 0, color: "#9E9E9E" };

  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: (i + 1) * 4, // increasing bar heights
            borderRadius: 2,
            backgroundColor: i < bars ? color : "#7F7F7F", // filled vs empty
          }}
        />
      ))}
    </div>
  );
};


// RiskRating scale
//
// Keyed on the BAND colour, not the TARP level: the wall is client-facing, and a
// site whose TARP chart carries no numbers reads "Red Notification" here (see
// config/riskDisplay.ts). The band is the fact both wordings share.
const riskColor = (colour) => {
  switch (colour) {
    case "green":
      return COLORS.green;
    case "yellow":
      return COLORS.yellow;
    case "orange":
      return COLORS.orange;
    case "red":
      return COLORS.red;
    default:
      return COLORS.grey;
  }
};

const riskGlow = (colour) =>
  colour === "red" ? `drop-shadow(0 0 6px ${COLORS.red})` : "none";

//comments color
const commentColor = (val) => {
  if (!val) return "#595959";
  const lower = val.toLowerCase();
  if (lower.includes("critical")) return COLORS.red;
  if (lower.includes("[action required]")) return "#80350E";
  return "#595959";
};

//glow card
const getGlowColor = (text) => {
  if (!text) return "0 0 10px 6px rgba(57, 212, 1, 0.6)";
  const lower = text.toLowerCase();
  if (lower.includes("critical")) {
    return "0 0 10px 6px rgba(183,28,28,0.6)";
  }
  if (lower.includes("sub-optimal")) {
    return "0 0 10px 6px rgba(233,133, 50, 0.6)";
  }
  if (lower.includes("action required")) {
    return "0 0 10px 6px rgba(255, 255, 0, 0.6)";
  }
  if (lower.includes("acceptable")) {
    return "0 0 10px 6px rgba(255, 255, 0, 0.6)";
  }
  if (lower.includes("lost connection")) {
    return "0 4px 20px rgba(0,0,0,0.5)";
  }
  return "0 0 10px 6px rgba(57, 212, 1, 0.6)";
};


/* --------------------------------------------------
   StatusBadge (styled to match IconBox sm)
-------------------------------------------------- */
const StatusBadge = ({ status, disabled }) => {
  const style = {
    width: "100%", // Fill the grid cell
    height: "60%",
    backgroundColor: disabled ? "#555" : status === "ONLINE" ? "#008000" : "#C00000",
    color: "#fff",
    borderRadius: "8px",
    fontWeight: "bold",
    fontSize: "12px",
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  };

  return <div style={style}>{status}</div>;
};

const getRadarImage = (radarName) => {
  const suffix = (radarName || "").trim().toUpperCase().slice(-2);
  return suffix === "XT" ? "/images/radar/3DRAR.png" :
    suffix === "FX" ? "/images/radar/2DRAR.png" :
      suffix === "NI" ? "/images/radar/2DRAR.png" :
        "/PS2000.png";
};

const getOverallNotes = (status, quality, riskColour) => {
  const normalisedStatus = status?.toLowerCase();
  const normalisedQuality = quality?.toLowerCase();

  if (normalisedStatus === 'archive' || normalisedStatus === 'lost connection') return 'Lost Connection';
  // Red band rather than 'TARP 4' — the same severity at a site that quotes no level.
  if (normalisedStatus === 'link down' || riskColour === 'red') return 'Critical';
  if (normalisedQuality !== 'optimal') return `Data Quality ${normalisedQuality}`;
  return 'N/A'
}

/* --------------------------------------------------
   RadarCard
-------------------------------------------------- */
const RadarCard = ({
  name,
  BrandColor,
  updated,
  status,
  image,
  Overall,
  Notes,
  RiskRating,
  RiskColour,
  Alarms,
  onExplore
}) => {
  const isOff = status === "OFF SERVICE";
  const mappedConnection = status?.toLowerCase() === "off service" ? "Lost" : "Optimal";
  const radarImgSrc = image ?? getRadarImage(name);

  const cardStyle = {
    backgroundColor: isOff ? "var(--dtg-bg-hover)" : "var(--dtg-bg-card)",
    borderRadius: 32,
    padding: 32,
    color: "var(--dtg-text-primary)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    transition: "transform 0.3s ease",
    cursor: "pointer",
    gap: 20
  };

  const dynamicCardStyle = {
    ...cardStyle,
    boxShadow: getGlowColor(Notes),
  };

  const imgWrapperStyle = {
    width: 300,
    height: 190,
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  const radarImgStyle = {
    maxWidth: "130%",
    maxHeight: "200px",
    objectFit: "contain",
    filter: isOff ? "grayscale(100%) brightness(100%)" : "none",
    opacity: isOff ? 0.8 : 1,
  };

  const footerStyle = {
    backgroundColor: isOff ? "#777" : "#009688",
    textAlign: "center",
    borderRadius: 6,
    padding: "8px 0",
    fontWeight: "bold",
    fontSize: 16
  };

  // Colors
  const overallCol = overallstatusColor(Overall);
  const alarmCol = alarmstatusColor(Alarms);
  const riskCol = riskColor(RiskColour);
  const { prefix, model } = splitRadarName(name);

  return (
    <div
      style={dynamicCardStyle}
      onMouseEnter={(e) => !isOff && (e.currentTarget.style.transform = "scale(1.02)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onClick={onExplore}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 32, lineHeight: 1 }}>
          <span style={{ color: isOff ? "var(--dtg-text-muted)" : BrandColor || "var(--dtg-text-secondary)", fontWeight: "bold" }}>
            {prefix}
          </span>
          <span style={{ color: isOff ? "var(--dtg-text-muted)" : "var(--dtg-text-primary)" }}>{model}</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FaSyncAlt color={isOff ? "#777" : "#009688"} />
          <p
            style={{
              fontSize: 12,
              color: "var(--dtg-text-secondary)",
              fontStyle: "italic",
              margin: "4px 0 0 0",
            }}
          >
            {updated}
          </p>
        </div>
      </div>
      <div
        style={{
          backgroundColor: commentColor(Notes),
          fontSize: "10px",
          padding: "5px 10px",
          borderRadius: "10px",
          color: "#fff",
        }}
      >
        <strong>{Notes}</strong>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
        {/* Left column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 2,
            gap: 16,
          }}
        >
          {/* Indicators Grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Row 1 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <StatusBadge status={status} disabled={isOff} />
              <div style={{ display: "flex", justifyContent: "space-between", flex: 1, alignItems: "center" }}>
                <PiPresentationChartBold color={isOff ? COLORS.grey : overallCol} size="20%" />
                <ConnectionBars connection={mappedConnection} />
              </div>
            </div>

            {/* Row 2 */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", border: `2px solid ${isOff ? COLORS.grey : riskCol}`, borderRadius: "10px", padding: "10px 0" }}>
                <ImWarning color={isOff ? COLORS.grey : riskCol}
                  size="3em"
                  style={{ filter: riskGlow(RiskColour) }}
                />
                <p style={{ marginTop: 5, marginBottom: 0, fontSize: "10px", color: "var(--dtg-text-muted)" }}>{RiskRating}</p>
              </div>
              <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", border: `2px solid ${isOff ? COLORS.grey : alarmCol}`, borderRadius: "10px", padding: "10px 0" }}>
                <FaRegBell color={isOff ? COLORS.grey : alarmCol}
                  size="3em"
                  style={{ filter: alarmGlow(Alarms) }}
                />
                <p style={{ marginTop: 5, marginBottom: 0, fontSize: "10px", color: "var(--dtg-text-muted)" }}>
                  {Alarms && Alarms.includes("Alarm Triggered")
                    ? "Alarm Triggered"
                    : Alarms || "N/A"
                  }</p>
              </div>
            </div>

            {/* Row 3 */}
            <button
              style={{
                backgroundColor: isOff ? COLORS.grey : "#00605E",
                border: "none",
                padding: "8px 25px",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "bold",
                cursor: "pointer",
                borderRadius: "4px",
                width: "100%",
                display: "flex",
                flex: 1,
                justifyContent: "space-between"
              }}
            >
              EXPLORE MORE DETAILS
              <FaArrowRight />
            </button>
          </div>
        </div>

        {/* Radar Image */}
        <div style={imgWrapperStyle}>
          <img src={radarImgSrc} alt={name} style={radarImgStyle} />
        </div>
      </div>

      {/* Footer */}
      <div style={{ ...footerStyle, display: "none" }}>Explore more</div>
    </div>
  );
};

const formatDateDisplay = (dateStr) => {
  if (!dateStr) return "N/A";
  const dt = new Date(dateStr);
  if (isNaN(dt)) return dateStr;

  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const month = dt.toLocaleString("en-US", { month: "short" }); // "Sep"
  const yyyy = dt.getFullYear();

  return `${hh}:${mm}, ${dd} ${month} ${yyyy}`;
};

const mapStatus = (status) => {
  if (!status) return "OFF SERVICE";
  const s = status.toLowerCase();
  if (s === "live") return "ONLINE";
  if (s === "archive") return "OFF SERVICE";
  return "OFFLINE"; // fallback
};

/* ---------- main gallery (fetch real data) ---------- */
const RadarGallery = ({ statusFilter, onExplore }) => {
  const [rawRecords, setRawRecords] = useState([]);
  const [error, setError] = useState("");

  // ---- Existing Supabase fetch logic ----
  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: latestWall, error: error1 } = await supabase
          .from("latest_radar_wall_folders")
          .select(`
            id, radar_number, site_id, site_name, timezone, brand, wallfolder_id, type, area, risk, status, quality, dqp_record_id, created_time, alarm_triggered
          `)
          .order("id", { ascending: true });

        if (error1) throw error1;
        if (!latestWall?.length) {
          setRawRecords([]);
          return;
        }

        // Manual fetch for wall folders since view relationship is missing
        const wallIds = [...new Set(latestWall.map((r) => r.wallfolder_id).filter(Boolean))];

        // Active deformations, so each radar's risk can be worded the way its
        // own site words it. The view's `risk` is the highest TARP level, which
        // is only the truth for sites that quote TARP numbers.
        const { data: activeDefs, error: errorDefs } = await supabase
          .from("def_records")
          .select("wallfolder_id, def_type, tarp_level, created_at, location")
          .in("wallfolder_id", wallIds)
          .eq("isactive", "Yes");

        if (errorDefs) throw errorDefs;
        const defsByFolder = (activeDefs || []).reduce((acc, rec) => {
          (acc[rec.wallfolder_id] ||= []).push(rec);
          return acc;
        }, {});
        const { data: wallFolders, error: errorWF } = await supabase
          .from("radar_wall_folders")
          .select("id, name")
          .in("id", wallIds);

        if (errorWF) throw errorWF;
        const wallMap = (wallFolders || []).reduce((acc, wf) => ({ ...acc, [wf.id]: wf }), {});

        const assessmentIds = latestWall.map((a) => a.dqp_record_id);
        // inside loadData(), replace your assessment_values fetch + pivot logic with this:

        // fetch both level 1 & 2 with the fields we need
        const { data: allValues, error: error2 } = await supabase
          .from("dqp_values")
          .select(`
    dqp_record_id,
    value,
    notes,
    appendix,
    ${DQP_IMAGE_COLUMNS},
    parameters!inner(id, name, level, parent_id)
  `)
          .in("dqp_record_id", assessmentIds)
          .in("parameters.level", [0, 1, 2]);

        if (error2) throw error2;

        // Figures are ids in an array column, so they need a second lookup to
        // become storage paths — see utils/dqpImages.js.
        const valuesWithImages = await attachDqpImages(supabase, allValues);

        // group rows by dqp_record_id
        const grouped = {};
        (valuesWithImages || []).forEach((row) => {
          const aid = row.dqp_record_id;
          grouped[aid] = grouped[aid] || [];
          grouped[aid].push(row);
        });

        // pivot into nested parameter trees with robust orphan handling
        // (shared with the Comprehensive report — see utils/buildRadarRecord)
        const pivoted = {};

        for (const [aid, rows] of Object.entries(grouped)) {
          const { parameters, emptyChildren } = pivotParameterTree(rows);
          pivoted[aid] = {
            dqp_record_id: aid,
            parameters,
            _emptyChildren: emptyChildren.map((c) => ({ ...c, dqp_record_id: aid })),
          };
        }

        // now build merged records (keeps your earlier shape and also attaches counts + missing list)
        const merged = latestWall.map((a) => {
          const paramTree = pivoted[a.dqp_record_id]?.parameters || {};
          const emptyChildren = pivoted[a.dqp_record_id]?._emptyChildren || [];
          const mappedConnection = (connection) => {
            const cleanConnection = connection?.toLowerCase();
            switch (cleanConnection) {
              case "lost connection":
              case "off service":
              case "archive":
                return "Lost"
              default:
                return "Optimal";
            }
          };


          const risk = resolveRiskPresentation(defsByFolder[a.wallfolder_id] || [], a);

          return {
            radar: a.radar_number,
            Site: a.site_name,
            Company: a.radar?.site.company,
            brand: a.brand,
            BrandColor: a.brand.color,
            AssessmentDate: a.created_time,
            RiskRating: risk.label,
            RiskColour: risk.colour,
            TARP: risk.label,
            ALARMS: a.alarm_triggered,
            Connection: a.connection,
            Quality: a.quality,
            Status: a.status || "N/A",
            WallFolder: a.wallfolder_id || "N/A",
            WallName: wallMap[a.wallfolder_id]?.name || "N/A",
            Notes: getOverallNotes(a.status, a.quality, risk.colour),
            Action: a.action,
            Connection: mappedConnection(a.status),
            // nested
            parameters: paramTree,

            // handy diagnostics
            level2Counts: countLevel2StatusesFromParamTree(paramTree),
            level2MissingCount: emptyChildren.length,
            level2MissingList: emptyChildren
          };
        });

        setRawRecords(merged);
        console.log(merged);
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load data.");
      }
    };

    loadData();
  }, []);


  // ---- Handle Explore ----
  const handleExplore = (radar) => {
    const radarData = sortedRecords.find((r) => r.radar === radar);
    if (onExplore) onExplore(radarData); // ⬅ pass up
  };

  // ---- Data prep ----
  const latestRecords = useMemo(() => {
    return rawRecords.map((rec) => ({
      ...rec,
      _mappedStatus: mapStatus(rec.Status)
    }));
  }, [rawRecords]);

  const filteredRecords = useMemo(() => {
    if (!statusFilter) return latestRecords;
    return latestRecords.filter((r) => r._mappedStatus === statusFilter);
  }, [latestRecords, statusFilter]);

  const sortedRecords = useMemo(() => {
    const arr = [...filteredRecords];
    const statusRank = (status) => {
      if (status === "ONLINE") return 0;
      if (status === "OFF SERVICE") return 2;
      return 1;
    };
    arr.sort((a, b) => {
      const rankA = statusRank(a._mappedStatus);
      const rankB = statusRank(b._mappedStatus);
      if (rankA !== rankB) return rankA - rankB;
      return (a.radar || "").localeCompare(b.radar || "");
    });
    return arr;
  }, [filteredRecords]);

  // ---- Layout switch ----
  if (error) return <div style={{ color: "red", padding: 24 }}>{error}</div>;
  if (!rawRecords) return <div style={{ color: "#ccc", padding: 24 }}>Loading…</div>;
  if (rawRecords.length === 0) return <div style={{ color: "#ccc", padding: 24 }}>No data found</div>;


  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(500px, 1fr))",
        gap: 24,
        padding: 24,
      }}
    >
      {sortedRecords.map((rec) => (
        <RadarCard
          key={rec.radar}
          name={rec.radar}
          brand={rec.brand}
          BrandColor={rec.BrandColor}
          updated={formatDateDisplay(rec.AssessmentDate)}
          status={rec._mappedStatus}
          Overall={rec.Quality}
          Notes={rec.Notes}
          Alarms={rec.ALARMS}
          RiskRating={rec.RiskRating}
          RiskColour={rec.RiskColour}
          onExplore={() => handleExplore(rec.radar)}
        />
      ))}
    </div>
  );
};

export default RadarGallery;
