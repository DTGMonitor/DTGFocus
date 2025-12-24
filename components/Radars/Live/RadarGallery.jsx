import React, { useEffect, useState, useMemo } from "react";
import { FaArrowRight, FaRegBell, FaSyncAlt } from "react-icons/fa";
import { ImWarning } from "react-icons/im";
import { PiPresentationChartBold } from "react-icons/pi";
import { supabase } from "@/lib/supabaseClient";

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
    case "alarm standby":
      return COLORS.green;
    case "yellow alarm triggered":
      return COLORS.yellow;
    case "orange alarm triggered":
      return COLORS.orange;
    case "red alarm triggered":
      return COLORS.red;
    case "false alarm":
      return "#fff";
    default:
      return COLORS.grey;
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
const riskColor = (val) => {
  switch ((val || "").toLowerCase()) {
    case "regressive":
    case "no significant":
      return COLORS.green;
    case "linear long-term":
      return COLORS.yellow;
    case "linear":
      return COLORS.orange;
    case "progressive":
      return COLORS.red;
    case "rapid movement":
      return COLORS.purple;
    case "failure pattern":
    case "material detachment":
      return "#fff";
    default:
      return COLORS.grey;
  }
};

const riskGlow = (val) => {
  switch ((val || "").toLowerCase()) {
    case "progressive":
      return `drop-shadow(0 0 6px ${COLORS.red})`;
    case "rapid movement":
      return `drop-shadow(0 0 8px ${COLORS.purple})`;
    case "failure pattern":
    case "material detachment":
      return `drop-shadow(0 0 10px ${COLORS.orange})
              drop-shadow(0 0 15px ${COLORS.orange})`;
    default:
      return "none";
  }
};

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
  if (lower.includes("[action required]")) {
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
        "/images/radar/PS2000.png";
};

/* --------------------------------------------------
   RadarCard
-------------------------------------------------- */
const RadarCard = ({
  name,
  brand,
  BrandColor,
  updated,
  status,
  image,
  Overall,
  Notes,
  Action,
  RiskRating,
  Alarms,
  onExplore,
  connection
}) => {
  const isOff = status === "OFF SERVICE";
  const radarImgSrc = image ?? getRadarImage(name);

  const cardStyle = {
    backgroundColor: isOff ? "#3A3A3A" : "#262626",
    borderRadius: 32,
    padding: 32,
    color: "#fff",
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
  const riskCol = riskColor(RiskRating);
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
          <span style={{ color: isOff ? "#ccc" : BrandColor || "#ccc", fontWeight: "bold" }}>
            {prefix}
          </span>
          <span style={{ color: isOff ? "#ccc" : "#fff" }}>{model}</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FaSyncAlt color={isOff ? "#777" : "#009688"} />
          <p
            style={{
              fontSize: 12,
              color: "#b4b2b2ff",
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
        <strong>{Notes}</strong> {Action || "N/A"}
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
                <ConnectionBars connection={connection} />
              </div>
            </div>

            {/* Row 2 */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", border: `2px solid ${isOff ? COLORS.grey : riskCol}`, borderRadius: "10px", padding: "10px 0" }}>
                <ImWarning color={isOff ? COLORS.grey : riskCol}
                  size="3em"
                  style={{ filter: riskGlow(RiskRating) }}
                />
                <p style={{ marginTop: 5, marginBottom: 0, fontSize: "10px", color: "#BFBFBF" }}>{RiskRating}</p>
              </div>
              <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", border: `2px solid ${isOff ? COLORS.grey : alarmCol}`, borderRadius: "10px", padding: "10px 0" }}>
                <FaRegBell color={isOff ? COLORS.grey : alarmCol}
                  size="3em"
                  style={{ filter: alarmGlow(Alarms) }}
                />
                <p style={{ marginTop: 5, marginBottom: 0, fontSize: "10px", color: "#BFBFBF" }}>
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

const mapNotes = (notes, overall) => {
  if (!notes) return "";
  const n = notes.toLowerCase();
  if (n.includes("dqp")) return "[" + notes + " " + overall + "]";
  if (n.includes("optimal")) return "";
  return "[" + notes + "]";
};

const mapAction = (notes, overallcomments, action) => {
  if (!notes) return "";
  const n = notes.toLowerCase();
  if (n.includes("dqp")) return overallcomments;
  return action;
};

/* ---------- main gallery (fetch real data) ---------- */
const RadarGallery = ({ statusFilter, onExplore }) => {
  const [rawRecords, setRawRecords] = useState([]);
  const [error, setError] = useState("");

  // ---- Existing Supabase fetch logic ----
  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: assessments, error: error1 } = await supabase
          .from("live_assessments")
          .select(`
            id, radar_id, wall_folder_id, assessment_date, risk_rating, tarp, alarm_status, connection, notes, action,
            radar:radars(radar_number, brand:brand(brand,color),site:clients(site_name,company)),
            wall_folder:radar_wall_folders!live_assessments_wall_folder_id_fkey(type,name)
          `)
          .order("assessment_date", { ascending: false });

        if (error1) throw error1;
        if (!assessments?.length) {
          setRawRecords([]);
          return;
        }

        const latestMap = {};
        assessments.forEach((a) => {
          if (
            !latestMap[a.radar_id] ||
            new Date(latestMap[a.radar_id].assessment_date) < new Date(a.assessment_date)
          ) {
            latestMap[a.radar_id] = a;
          }
        });
        const latestAssessments = Object.values(latestMap);

        const assessmentIds = latestAssessments.map((a) => a.id);
        // inside loadData(), replace your assessment_values fetch + pivot logic with this:

        // fetch both level 1 & 2 with the fields we need
        const { data: allValues, error: error2 } = await supabase
          .from("assessment_values")
          .select(`
    assessment_id,
    value_text,
    comments,
    parameters!inner(id, name, level, parent_id)
  `)
          .in("assessment_id", assessmentIds)
          .in("parameters.level", [1, 2]);

        if (error2) throw error2;

        // group rows by assessment_id
        const grouped = {};
        (allValues || []).forEach((row) => {
          const aid = row.assessment_id;
          grouped[aid] = grouped[aid] || [];
          grouped[aid].push(row);
        });

        // pivot into nested parameter trees with robust orphan handling
        const pivoted = {};

        for (const [aid, rows] of Object.entries(grouped)) {
          // map of parameter metadata by id (to lookup parent names)
          const metaById = {};
          rows.forEach((r) => {
            const p = r.parameters;
            metaById[p.id] = metaById[p.id] || { id: p.id, name: p.name, level: p.level, parent_id: p.parent_id };
          });

          // keyed by cleaned name (remove spaces so you can keep using rec.parameters.Overall)
          const paramsByKey = {};
          const emptyChildren = []; // track children with empty value_text (helpful to debug)

          // create level-1 entries (if present)
          rows.forEach((r) => {
            const p = r.parameters;
            if (p.level === 1) {
              const key = p.name;
              paramsByKey[key] = paramsByKey[key] || {
                id: p.id,
                name: p.name,
                value: r.value_text || "",
                comments: r.comments || "",
                level: 1,
                children: []
              };

              // prefer non-empty values if multiple rows exist
              if (!paramsByKey[key].value && r.value_text) paramsByKey[key].value = r.value_text;
              if (!paramsByKey[key].comments && r.comments) paramsByKey[key].comments = r.comments;
            }
          });

          // attach level-2 rows (children). If parent missing, create a placeholder parent entry.
          rows.forEach((r) => {
            const p = r.parameters;
            if (p.level === 2) {
              const parentMeta = metaById[p.parent_id];
              const parentKey = parentMeta ? parentMeta.name.replace(/\s+/g, "") : `Parent_${p.parent_id}`;

              if (!paramsByKey[parentKey]) {
                // placeholder parent so children are not lost
                paramsByKey[parentKey] = {
                  id: parentMeta?.id || p.parent_id,
                  name: parentMeta?.name || `Unknown (${p.parent_id})`,
                  value: "",
                  comments: "",
                  level: 1,
                  children: []
                };
              }

              const child = {
                id: p.id,
                name: p.name,
                value: r.value_text || "",
                comments: r.comments || "",
                level: 2,
                parent_id: p.parent_id
              };

              paramsByKey[parentKey].children.push(child);

              if (!r.value_text) {
                emptyChildren.push({
                  id: p.id,
                  name: p.name,
                  parent_id: p.parent_id,
                  assessment_id: aid
                });
              }
            }
          });

          pivoted[aid] = {
            assessment_id: aid,
            parameters: paramsByKey,
            _emptyChildren: emptyChildren
          };
        }

        // now build merged records (keeps your earlier shape and also attaches counts + missing list)
        const merged = latestAssessments.map((a) => {
          const paramTree = pivoted[a.id]?.parameters || {};
          const emptyChildren = pivoted[a.id]?._emptyChildren || [];

          return {
            radar: a.radar?.radar_number,
            Site: a.radar?.site.site_name,
            Company: a.radar?.site.company,
            brand: a.radar?.brand.brand,
            BrandColor: a.radar?.brand.color,
            AssessmentDate: a.assessment_date,
            RiskRating: a.risk_rating,
            TARP: a.tarp,
            ALARMS: a.alarm_status,
            Connection: a.connection,
            Status: a.wall_folder?.type || "N/A",
            WallFolder: a.wall_folder?.name || "N/A",
            Notes: a.notes,
            Action: a.action,

            // nested
            parameters: paramTree,

            // handy diagnostics
            level2Counts: countLevel2StatusesFromParamTree(paramTree),
            level2MissingCount: emptyChildren.length,
            level2MissingList: emptyChildren
          };
        });

        setRawRecords(merged);
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
      _mappedStatus: mapStatus(rec.Status),
      _mappedNotes: mapNotes(rec.Notes, rec.parameters.Overall?.value),
      _mappedAction: mapAction(rec.Notes, rec.parameters.Overall?.comments, rec.Action)
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
          Overall={rec.parameters.Overall?.value}
          Notes={rec._mappedNotes}
          Action={rec._mappedAction}
          Alarms={rec.ALARMS}
          RiskRating={rec.RiskRating}
          connection={rec.Connection}
          onExplore={() => handleExplore(rec.radar)}
        />
      ))}
    </div>
  );
};

export default RadarGallery;
