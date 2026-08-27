// components/RadarDetail.jsx
import React, { useEffect, useState, useMemo } from "react";
import RadarMetricsChart from "@/components/Radars/Live/RadarMetricChart";
import useScrollableList from "@/components/Radars/Live/ScrollableList";
import { supabase } from "@/lib/supabaseClient";
import { FaFolder, FaSyncAlt, FaRegBell } from "react-icons/fa";
import { ImExit } from "react-icons/im";
import { IoMdMenu } from "react-icons/io";
import GaugeLive from "@/components/Radars/Live/gaugelive";
import DqpAppendixPreview from "@/components/Reusable/DqpAppendixPreview";
import { defTypeColour, labelColour, recordColour, tarpPriority, COLOUR_RANK } from "@/config/riskDisplay";

function splitRadarName(radar) {
  if (!radar) return { prefix: "", model: "" };
  const match = radar.match(/^([A-Za-z]+)(.*)$/);
  if (match) {
    return { prefix: match[1], model: match[2] };
  }
  return { prefix: radar, model: "" };
};

function DeformationHeatmap({ heatmapUrl, radar }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div
        style={{
          position: "relative",
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          cursor: heatmapUrl ? "zoom-in" : "default",
          borderRadius: "10px",
        }}
        onClick={() => heatmapUrl && setOpen(true)}
      >
        {heatmapUrl ? (
          <>
            <img
              src={heatmapUrl}
              alt={`Deformation heatmap for ${radar.WallFolder}`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transition: "transform 0.3s ease",
              }}
              className="heatmap-img"
            />           
          </>
        ) : (
          <p
            style={{
              fontSize: "12px",
              color: "#aaa",
              fontStyle: "italic",
            }}
          >
            No heatmap available
          </p>
        )}
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#111",
              padding: "12px",
              borderRadius: "10px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              maxWidth: "80vw",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <img
              src={heatmapUrl}
              alt="Full Heatmap"
              style={{
                maxWidth: "100%",
                maxHeight: "70vh",
                objectFit: "contain",
                borderRadius: "6px",
              }}
            />
            <button
              onClick={() => setOpen(false)}
              style={{
                marginTop: "10px",
                background: "#444",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              X
            </button>
          </div>
        </div>
      )}

      {/* Inline hover effect styles */}
      <style>
        {`
          .heatmap-img:hover {
            transform: scale(1.05);
          }
          .hover-overlay:hover {
            opacity: 1;
          }
        `}
      </style>
    </>
  );
};


function getIssues(record) {
  if (!record?.parameters) return [];

  const issues = [];
  const validStatuses = ["acceptable", "sub-optimal", "critical"]; // allowed only

  for (const [paramName, param] of Object.entries(record.parameters)) {
    // Check children (level 2)
    if (Array.isArray(param.children)) {
      for (const child of param.children) {
        const status = (child.value || "").trim().toLowerCase();
        if (child.level === 2 && validStatuses.includes(status)) {
          issues.push({
            level2: child.name,
            level1: param.name, // parent name
            status: child.value || "",
            comments: child.comments || "",
            appendix: child.appendix || null,
            // Carried through so the appendix panel can show the finding's
            // figures, not just its text — pivotParameterTree already attaches
            // them (RadarGallery resolves the ids before pivoting).
            images: Array.isArray(child.images) ? child.images : [],
          });
        }
      }
    }
  }

  return issues;
};

const IssueCard = ({ issue }) => {
  // `appendix` is the analyst's narrative, not a URL — the old markup linked it
  // as an href, which went nowhere, and the figures beside it were never shown
  // at all. Open the same panel the admin sensor detail's Data Quality table
  // opens instead.
  const [showAppendix, setShowAppendix] = useState(false);
  const hasAppendix = Boolean(issue.appendix) || (issue.images?.length > 0);

  const statusColors = {
    "Acceptable": "#e7be09ff",   // yellow
    "Sub-Optimal": "#c2550dff",  // orange
    "Critical": "#FF0000",       // red
  };
  const cardColors = {
    "Acceptable": "rgba(255,192,0,0.2)",   // yellow
    "Sub-Optimal": "rgba(233,113,50,0.2)",  // orange
    "Critical": "rgba(192,0,0,0.2)",       // red
  };
  return (
    <div
      style={{
        backgroundColor: cardColors[issue.status],
        borderRadius: "10px",
        padding: "10px",
        marginBottom: "10px",
        color: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: statusColors[issue.status] || "#888",
          }}
        />
        <strong style={{ fontSize: "14px", }}>
          {issue.level2.toUpperCase()} | {issue.level1}
        </strong>
      </div>
      <p style={{ margin: "5px 0", fontSize: "12px" }}>{issue.comments}</p>
      {hasAppendix && (
        <button
          type="button"
          onClick={() => setShowAppendix(true)}
          title={
            issue.images?.length
              ? `View appendix (${issue.images.length} figure${issue.images.length > 1 ? "s" : ""})`
              : "View appendix"
          }
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "#4FC3F7",
            fontWeight: "bold",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          [Appendix{issue.images?.length > 1 ? ` · ${issue.images.length} figures` : ""}]
        </button>
      )}
      {showAppendix && (
        <DqpAppendixPreview
          item={issue}
          fallbackCaption={issue.level2}
          onClose={() => setShowAppendix(false)}
        />
      )}
    </div>
  );
};

const DefCard = ({ def }) => {
  // Dot and card take the band colour of the deformation TYPE, so a record whose
  // site assigns no TARP level is still coloured for what it is. The TARP level
  // itself is still printed where the record carries one.
  const BAND_DOT = {
    green: "#47D45A",
    yellow: "#e7be09ff",
    orange: "#c2550dff",
    red: "#FF0000",
    darkred: "#8B0000",
    grey: "#888",
    pink: "#FF33CC",
  };
  const BAND_CARD = {
    green: "rgba(71,212,90,0.2)",
    yellow: "rgba(255,192,0,0.2)",
    orange: "rgba(233,113,50,0.2)",
    red: "rgba(192,0,0,0.2)",
    // Carried heavier than the other bands: a 0.2 wash of a colour this dark is
    // indistinguishable from red's at a glance, which is the one thing it must not be.
    darkred: "rgba(139,0,0,0.45)",
    grey: "rgba(136,136,136,0.2)",
    pink: "rgba(255,51,204,0.2)",
  };

  // The same rule the timeline cards use — the more severe of the trend and its
  // TARP level, so the colour never under-states. The empty-list placeholder
  // carries "No Significant" in place of a type, which only `labelColour` can
  // read, so it answers where the record itself cannot.
  const hasBand = Boolean(defTypeColour(def.def_type)) || tarpPriority(def.tarp_level) > 0;
  const band = hasBand ? recordColour(def) : labelColour(def.tarp_level || def.def_type);

  return (
    <div
      style={{
        backgroundColor: BAND_CARD[band],
        borderRadius: "10px",
        padding: "10px",
        marginBottom: "10px",
        color: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: BAND_DOT[band],
          }}
        />
        <strong style={{ fontSize: "14px", }}>
          {def.tarp_level || def.def_type || ""}
        </strong>
      </div>
      <p style={{ margin: "5px 0", fontSize: "12px" }}>{def.mappedDefDetail} observed over {def.location}</p>
      {def.appendix && (
        <a href={def.appendix} style={{ color: "#4FC3F7", fontWeight: "bold" }}>
          [Appendix A]
        </a>
      )}
    </div>
  );
};

const AlarmCard = ({ al, rec }) => {

  const COLORS = {
    green: "#13501B",
    yellow: "#FFC000",
    orange: "#E97132",
    red: "#f43232ff",
    grey: "#aaa",
    purple: "#D86ECC",
    blue: "#008cffff"
  };

  // Alarm scale
  const alarmstatusColor = (val) => {
    switch ((val || "").toLowerCase()) {
      case "blue":
        return COLORS.blue;
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

  const alarmGlow = (val) => {
    switch ((val || "").toLowerCase()) {
      case "red":
        return `drop-shadow(0 0 4px ${COLORS.red})`;
      case "orange":
        return `drop-shadow(0 0 4px ${COLORS.orange})`;
      case "yellow":
        return `drop-shadow(0 0 4px ${COLORS.yellow})`;
      case "blue":
        return `drop-shadow(0 0 4px ${COLORS.blue})`;
      default:
        return "none";
    }
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr",
        alignItems: "center",
        marginBottom: "10px"
      }}
    >
      <FaRegBell color={rec?.reason === "False" ? "#fff" : alarmstatusColor(al.alarmtype)}
        size="1em"
        style={{
          visibility: al.isactive !== "Active" ? "hidden" : "visible",
          filter: rec?.reason === "False" ? `drop-shadow(0 0 8px #fff)` : alarmGlow(al.alarmtype)
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 70px 70px 1fr",
          backgroundColor: "#404040",
          borderRadius: "10px",
          padding: "0 10px",
          color: al.isactive !== "Active" ? "#7f7f7f" : rec?.reason === "False" ? "#fff" : alarmstatusColor(al.alarmtype)
        }}
      >
        <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "9px", textAlign: "left" }}>
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: alarmstatusColor(al.alarmtype)
            }}
          />
          {al.name}
        </div>
        <p style={{ fontSize: "9px" }}>| {al.isactive}</p>
        <p style={{ fontSize: "9px" }}>| {rec?.reason}</p>
        <p style={{ fontSize: "9px" }}>| {rec?.cause}</p>
      </div>
    </div>
  );
};


function RadarDetail({ radar, onBack }) {

  if (!radar) {
    return (
      <div style={{ color: "#ccc", padding: "20px" }}>
        Select a radar to view details
      </div>
    );
  };

  const issues = getIssues(radar);

  const [defRecords, setDefRecords] = useState([]);
  const [error, setError] = useState("");

  // deformation data
  useEffect(() => {
    if (!radar) return;

    const loadData = async () => {
      try {
        const { data, error } = await supabase
          .from("def_records")
          .select(`
          id, created_at, location, precursors, def_type, tarp_level, isactive, start,
          wall_folder:radar_wall_folders!inner(
            id, type, name, radar_id
          )
        `)
          .eq("wall_folder.name", radar.WallFolder)   // ✅ filter on actual column
          .order("created_at", { ascending: false });

        if (error) throw error;

        setDefRecords(data || []);

      } catch (err) {
        console.error("Error loading deformation data:", err);
        setError("Failed to load deformation data.");
      }
    };

    loadData();
  }, [radar]);

  //DEFORMATION LIST PREP
  // --- Mapping helpers ---
  const mapDefDetail = (def_type) => {
    if (!def_type) return "No significant deformation trend";

    const type = def_type.toLowerCase();
    if (
      type.includes("linear") ||
      type.includes("progressive") ||
      type.includes("regressive")
    ) {
      return `${def_type} deformation trend`;
    }

    return def_type; // fallback
  };


  // Worst first — by band colour, then by TARP level. Sorting on the level alone
  // sank every record a site assigns no level to (a rock fall, a Leonora blast)
  // below the harmless ones.
  const sortByTarp = (list) => {
    return [...list].sort((a, b) => {
      const byBand = COLOUR_RANK[recordColour(b)] - COLOUR_RANK[recordColour(a)];
      if (byBand !== 0) return byBand;
      return tarpPriority(b.tarp_level) - tarpPriority(a.tarp_level);
    });
  };


  // Group into 3 buckets only
  const normalizeDefType = (type = "") => {
    const t = type.toLowerCase();
    if (t.includes("linear long-term")) return "Linear Long-term";
    if (t.includes("linear")) return "Linear";
    if (
      t.includes("progressive") ||
      t.includes("rapid") ||
      t.includes("failure") ||
      t.includes("detachment")
    ) {
      return "TARP 4";
    }
    return "Other";
  };

  const countByDefType = (list) => {
    const base = {
      "Linear Long-term": 0,
      "Linear": 0,
      "TARP 4": 0,
    };

    return list.reduce((acc, rec) => {
      const norm = normalizeDefType(rec.def_type);
      if (acc.hasOwnProperty(norm)) {
        acc[norm] += 1;
      }
      return acc;
    }, base);
  };

  const buildSummary = (counts) => {
    return Object.entries(counts)
      .map(([type, count]) => {
        if (count > 0 && type !== "Other") {
          if (type === "TARP 4") {
            return "Failure Pattern/material detachment/rapid movement/progressive deformation trend observed.";
          }
          return `${type} deformation trend observed.`;
        }
        return null;
      })
      .filter(Boolean);
  };

  // --- Main computed list ---
  const defList = useMemo(() => {
    if (!defRecords || defRecords.length === 0) {
      return {
        sorted: [{
          id: "fallback",
          // No level: a site that quotes no TARP numbers must not be told
          // "TARP 1" as the wording for having nothing active.
          tarp_level: "",
          def_type: "No Significant",
          mappedDefDetail: "No significant deformation trend",
          location: "the scan area",
        },],
        counts: {
          "Linear Long-term": 0,
          "Linear": 0,
          "TARP 4": 0
        },
        summary: ["No significant deformation trend observed."],
        fallback: true,
      };
    }

    const enriched = defRecords.map((rec) => ({
      ...rec,
      mappedDefDetail: mapDefDetail(rec.def_type),
    }));

    const sorted = sortByTarp(enriched);
    const counts = countByDefType(sorted);
    const summary = buildSummary(counts);

    return { sorted, counts, summary, fallback: false };
  }, [defRecords]);

  //ALARM
  const [alarmRegions, setAlarmRegions] = useState([]);
  const [error1, setError1] = useState("");

  // alarm data
  useEffect(() => {
    if (!radar) return;

    const loadData = async () => {
      try {
        const { data, error1 } = await supabase
          .from("alarm_regions")
          .select(`
            id, name,isactive,alarmtype,
            wallfolder:radar_wall_folders!inner(
            id, type, name, radar_id
          )
          )
        `)
          .eq("wallfolder.name", radar.WallFolder)

        if (error1) throw error1;

        setAlarmRegions(data || []);
        console.log("alarm_regions", data);
      } catch (err) {
        console.error("Error loading alarm data:", err);
        setError("Failed to load alarm data.");
      }
    };

    loadData();
  }, [radar]);

  // ALARM RECORDS
  const [alarmRecords, setAlarmRecords] = useState([]);
  const [error2, setError2] = useState("");

  // alarm records data
  useEffect(() => {
    if (!radar || alarmRegions.length === 0) return;

    const loadRecords = async () => {
      try {
        // collect only ACTIVE region IDs
        const activeRegionIds = alarmRegions
          .filter(r => r.isactive)
          .map(r => r.id);

        if (activeRegionIds.length === 0) {
          setAlarmRecords([]);
          return;
        }

        // fetch latest alarm per region
        const latestRecords = [];
        for (const regionId of activeRegionIds) {
          const { data, error } = await supabase
            .from("alarm_records")
            .select(`
            id, created_at, triggered_at, location, reason, cause,
            alarm_region:alarm_regions!inner(
              id, name, isactive, alarmtype
            )
          `)
            .eq("alarm_regions.isactive", "Active")
            .eq("alarm_region", regionId)
            .order("triggered_at", { ascending: false })
            .limit(1)
            .maybeSingle(); // only one latest record

          if (error) throw error;
          if (data) latestRecords.push(data);
        }

        setAlarmRecords(latestRecords);

        console.log("latest alarm_records", latestRecords);
      } catch (err) {
        console.error("Error loading alarm records:", err);
        setError2("Failed to load alarm records.");
      }
    };

    loadRecords();
  }, [radar, alarmRegions]);

  // ALARM IMPROVEMENT
  const [alarmImprovement, setAlarmImprovement] = useState([]);
  const [error3, setError3] = useState("");

  // alarm records data
  useEffect(() => {
    if (!radar || alarmRegions.length === 0) return;

    const loadRecords = async () => {
      try {

        const { data, error3 } = await supabase
          .from("alarm_improvement")
          .select(`
            id, recommendation_submission,type,improvement_status,site_action,site_engineer,
            alarm_records:alarm_records!inner(
              id, alarm_region:alarm_regions!inner(name,wallfolder:radar_wall_folders!inner(name))
            )
          `)
          .eq("alarm_records.alarm_region.wallfolder.name", radar.WallFolder)
          .eq("improvement_status", "Awaiting Feedback")
          .order("recommendation_submission", { ascending: false })

        if (error3) throw error3;

        setAlarmImprovement(data);

        console.log("improvement", data);
      } catch (err) {
        console.error("Error loading alarm improvement:", err);
        setError2("Failed to load alarm improvement.");
      }
    };

    loadRecords();
  }, [radar, alarmRegions]);

  const improvementBanner = useMemo(() => {
    if (!alarmImprovement || alarmImprovement.length === 0) {
      return [{
        action: "",
        type: "No action required"
      }];
    }

    const typeCounts = alarmImprovement.reduce((acc, item) => {
      const { type } = item;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(typeCounts).map(([type, count]) => ({
      action: "[ACTION REQUIRED]",
      type: count > 1 ? `${type} (${count}x)` : type,
    }));
  }, [alarmImprovement]);

  // DOWNTIME
  const [downtime, setDowntime] = useState([]);
  const [error4, setError4] = useState("");

  // downtime records data
  useEffect(() => {

    const loadRecords = async () => {
      try {
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000); // now - 24h
        const windowEnd = new Date();

        const { data, error } = await supabase
          .from("downtime_records")
          .select(`
            id, submission,type, reason, from, to,
            wallfolder:radar_wall_folders!inner(id, name, radar:radars!inner(id,radar_number))
          `)
          .eq("wallfolder.radar.radar_number", radar.radar)
          .or(`to.gte.${windowStart.toISOString()},to.is.null`)
          .order("submission", { ascending: false });

        if (error) throw error;

        const categories = {
          "Mechanical Availability": {
            Maintenance: { hours: 0, percentage: 0 },
            Relocation: { hours: 0, percentage: 0 },
            "Radar System Issue": { hours: 0, percentage: 0 }
          },
          "Use of Availability": {
            "Connection": { hours: 0, percentage: 0 },
            "PMP Issue": { hours: 0, percentage: 0 }
          }
        };

        // overlap calculation
        let totalDowntimeMs = 0;
        data.forEach((d) => {
          
          const from = new Date(d.from);
          const to = new Date(d.to || windowEnd);

          const overlapStart = from < windowStart ? windowStart : from;
          const overlapEnd = to > windowEnd ? windowEnd : to;
          const overlapMs = Math.max(0, overlapEnd - overlapStart);

          totalDowntimeMs += overlapMs;

          const reason = d.reason;
          const hours = overlapMs / (1000 * 60 * 60);

          // add to correct category if defined
          for (const [cat, reasons] of Object.entries(categories)) {
            if (reason in reasons) {
              categories[cat][reason].hours += hours;
            }
          }
        });

        // --- MODIFIED CALCULATION LOGIC ---

        const totalWindowHours = 24;

        // 1. Calculate the total hours for Mechanical Availability first.
        const mechanicalReasons = categories["Mechanical Availability"];
        const totalMechanicalHours = Object.values(mechanicalReasons).reduce(
          (total, reasonData) => total + reasonData.hours,
          0
        );

        // 2. Calculate the "available" time after mechanical downtime.
        const availableHours = totalWindowHours - totalMechanicalHours;

        // 3. Calculate percentages for "Mechanical Availability"
        for (const reasonData of Object.values(mechanicalReasons)) {
          // Note: Better to do calculations before formatting with .toFixed()
          const percentage = (reasonData.hours / totalWindowHours) * 100;
          reasonData.percentage = percentage.toFixed(0);
          reasonData.hours = reasonData.hours.toFixed(2);
        }

        // 4. Calculate percentages for "Use of Availability"
        const useOfAvailabilityReasons = categories["Use of Availability"];
        for (const reasonData of Object.values(useOfAvailabilityReasons)) {
          // Use the new denominator. Handle division by zero just in case.
          const denominator = availableHours > 0 ? availableHours : totalWindowHours;
          const percentage = (reasonData.hours / denominator) * 100;
          reasonData.percentage = percentage.toFixed(0);
          reasonData.hours = reasonData.hours.toFixed(2);
        }

        setDowntime(categories);

        console.log("downtime grouped", categories);
      } catch (err) {
        console.error("Error loading downtime:", err);
        setError4("Failed to load downtime");
      }
    };

    loadRecords();
  }, [radar]);

  //DEFORMATION IMAGE

  const [heatmapUrl, setHeatmapUrl] = useState(null);

  useEffect(() => {
    if (!radar?.Company || !radar?.Site || !radar?.WallFolder) return;

    const fetchImage = async () => {
      // Normalize inputs
      const company = radar.Company?.trim();
      const site = radar.Site?.trim();
      let wall = radar.WallFolder?.trim();

      // Avoid double ".jpg"
      if (!wall.toLowerCase().endsWith(".jpg")) {
        wall = `${wall}.jpg`;
      }

      const path = `${company}/${site}/${wall}`;

      const { data, error } = await supabase.storage
        .from("Deformation")
        .createSignedUrl(path, 3600);

      if (error) {
        console.error("Error fetching heatmap:", error.message, { path });
        setHeatmapUrl(null);
      } else {
        setHeatmapUrl(data.signedUrl);
      }
    };


    fetchImage();
  }, [radar?.Company, radar?.Site, radar?.WallFolder]);


  // Define orderings
  const statusOrder = {
    Active: 1,
    Standby: 2,
    Inactive: 3,
  };

  const typeOrder = {
    Red: 1,
    Orange: 2,
    Yellow: 3,
    Blue: 4,
    Purple: 5,
  };

  // Sort alarmRegions before rendering
  const sortedRegions = [...alarmRegions].sort((a, b) => {
    const statusDiff = (statusOrder[a.isactive] || 99) - (statusOrder[b.isactive] || 99);
    if (statusDiff !== 0) return statusDiff;

    return (typeOrder[a.alarmtype] || 99) - (typeOrder[b.alarmtype] || 99);
  });

  const {
    containerRef: dqaRef,
    atEnd: dqaAtEnd,
    handleScroll: dqaScroll,
    handleArrowClick: dqaArrowClick,
  } = useScrollableList(160);

  const {
    containerRef: defRef,
    atEnd: defAtEnd,
    handleScroll: defScroll,
    handleArrowClick: defArrowClick,
  } = useScrollableList(160);

  const {
    containerRef: alarmRef,
    atEnd: alarmAtEnd,
    handleScroll: alarmScroll,
    handleArrowClick: alarmArrowClick,
  } = useScrollableList(160);

  const StatusBadge = ({ status }) => {
    const style = {
      padding: "0 20px",
      height: "60%",
      backgroundColor: isOff ? "#777" : status === "ONLINE" ? "#008000" : "#C00000",
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

  /* --------------------------------------------------
   Color Maps
-------------------------------------------------- */
  const COLORS = {
    green: "#13501B",
    yellow: "#b18503ff",
    orange: "#80350E",
    red: "#8b0202ff",
    // Rapid Movement — the band above red (config/riskDisplay.ts). This palette
    // is already darkened for the panel background, so the extra step has to go
    // darker still to stay distinguishable from red.
    darkred: "#4a0000",
    grey: "#aaa",
    // Data Contamination — the band below every finding. Darkened to sit on the
    // same panel background as the rest of this palette.
    pink: "#a3007d",
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

  const overallCol = overallstatusColor(radar.parameters.Overall?.value);

  //glow card
  const getGlowColor = (text) => {
    if (!text) return "0 0 10px 6px rgba(57, 212, 1, 0.6)";
    const lower = text.toLowerCase();
    if (lower.includes("critical")) {
      return "0 0 10px 6px rgba(183,28,28,0.6)";
    }
    if (lower.includes("action required")) {
      return "0 0 10px 6px rgba(255, 255, 0, 0.6)";
    }
    if (lower.includes("lost connection")) {
      return "0 4px 20px rgba(0,0,0,0.5)";
    }
    return "0 0 10px 6px rgba(57, 212, 1, 0.6)";
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

  // RiskRating scale — keyed on the band colour resolved in RadarGallery, which
  // follows the deformation type at every site (config/riskDisplay.ts). Reading
  // the label instead never matched once the label became a TARP level.
  const riskColor = (colour) => {
    switch (colour) {
      case "green": return COLORS.green;
      case "yellow": return COLORS.yellow;
      case "orange": return COLORS.orange;
      case "red": return COLORS.red;
      case "darkred": return COLORS.darkred;
      case "pink": return COLORS.pink;
      default: return COLORS.grey;
    }
  };

  const riskCol = riskColor(radar.RiskColour ?? labelColour(radar.RiskRating));

  //DQP Menu
  const DQPMenuItems = [
    { label: "OVERALL ANALYSIS" },
    /*{ label: "GLOSSARY" },
        { label: "APPENDIX" },
        { label: "GENERATE REPORT" }*/
  ];

  const [activeDQP, setActiveDQP] = useState("OVERALL ANALYSIS");
  const [activeDef, setActiveDef] = useState("OVERALL ANALYSIS");

  const handleClick = (label) => {
    setActiveDQP(label);
  };

  const handleClick2 = (label) => {
    setActiveDef(label);
  };

  const cardStyle = {
    backgroundColor: "#262626",
    borderRadius: 32,
    padding: 32,
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: 20
  };

  //comments color
  const commentColor = (val) => {
    if (!val) return "#595959";
    const lower = val.toLowerCase();
    if (lower.includes("critical")) return COLORS.red;
    if (lower.includes("[action required]")) return "#80350E";
    return "#595959";
  };

  const isOff = radar._mappedStatus === "OFF SERVICE";
  const { prefix, model } = splitRadarName(radar.radar);

  return (
    <div
      style={{
        padding: "20px",
        borderRadius: "12px",
        color: "#f5f5f5",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        flex: 1
      }}
    >
      {/* Title */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#262626",
        borderRadius: "10px",
        padding: "5px 20px",
        boxShadow: getGlowColor(radar.Notes)
      }}>
        <h2 style={{ margin: 0, fontSize: "20px" }}>
          <span style={{ color: isOff ? "#ccc" : radar.BrandColor || "#ccc", fontWeight: "bold" }}>
            {prefix}
          </span>
          <span style={{ color: isOff ? "#ccc" : "#fff" }}>{model}</span>
        </h2>
        <div style={{
          display: "flex",
          padding: "0 20px",
          gap: "10px",
          alignItems: "center",
          backgroundColor: "#404040",
          borderRadius: "20px",
          fontSize: "14px",
        }}>
          <FaFolder />
          {radar.WallFolder}
        </div>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px"
        }}>
          <ConnectionBars connection={radar.Connection} />
          <StatusBadge status={radar._mappedStatus} />
        </div>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          fontSize: "14px",
          fontWeight: "bold",
          color: isOff ? "#777" : "#fff"
        }}>
          <FaSyncAlt color={isOff ? "#777" : "#009688"} />
          {radar.AssessmentDate
            ? new Date(radar.AssessmentDate).toLocaleString()
            : "Unknown"}
        </div>
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 12px",
            background: "#7F7F7F",
            border: "none",
            borderRadius: "20px",
            color: "#fff",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            gap: "10px"
          }}
        >
          RETURN
          <ImExit />
        </button>
      </div>

      {/* Main Content */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gridTemplateRows: "1fr 1fr",
          gap: "10px",
          height: "100%",
        }}
      >
        <div style={cardStyle}>
          <h3 style={{ margin: 0, justifySelf: "left" }}>Daily Availability</h3>
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>
            <GaugeLive
              downtime={downtime} isOff={radar._mappedStatus === "OFF SERVICE"} />
          </div>
        </div>
        <div style={{ ...cardStyle, flexDirection: "row" }}>
          <div style={{
            display: "flex",
            alignItems: "left",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 1 / 3,
            gap: "20px"
          }}>
            <h3 style={{ margin: 0, justifySelf: "left" }}>Data Quality Assessment</h3>
            <RadarMetricsChart record={radar} />
          </div>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 2 / 3,
            gap: "10px"
          }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                borderRadius: "20px",
                width: "100%"
              }}
            >
              {DQPMenuItems.map((item) => {
                const isActive = activeDQP === item.label;
                const isGenerateReport = item.label === "GENERATE REPORT";
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleClick(item.label)}
                    style={{
                      border: "none",
                      width: "180px",
                      borderRadius: "20px",
                      outline: "none",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                      fontSize: "14px",
                      fontWeight: "bold",
                      color: isGenerateReport
                        ? "#00D6D1"
                        : "#fff",
                      background: isGenerateReport
                        ? "#171717" // orange for GENERATE REPORT
                        : isActive
                          ? "#404040" // bright green for active
                          : "#171717",
                      transition: "all 0.3s ease",
                      position: "relative",
                      padding: "10px 20px",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", height: "100%", width: "100%" }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 2 / 5, backgroundColor: "#3A3A3A", borderRadius: "10px", padding: "20px", gap: "20px" }}>
                <div style={{ backgroundColor: overallCol, borderRadius: "8px", padding: "8px", fontSize: "14px" }}>Overall Score: <strong>{radar.parameters.Overall?.value.toUpperCase()}</strong></div>
                <span>
                  <p style={{ fontWeight: "bold", fontSize: "12px", margin: 0 }}>SUMMARY:</p>
                  <p style={{ fontSize: "12px", margin: 0 }}>{radar.parameters.Overall?.value === "Optimal" ? radar.parameters.Overall?.comments : radar.parameters.Overall?.value + " due to " + radar.parameters.Overall?.comments.toLowerCase()}</p>
                </span>
                <span>
                  <p style={{ fontWeight: "bold", fontSize: "12px", margin: 0 }}>ACTION:</p>
                  <p style={{ fontSize: "12px", margin: 0 }}>{radar.Action}</p>
                </span>
              </div>
              <div style={{ display: "block", flex: 3 / 5, backgroundColor: "#3A3A3A", borderRadius: "10px", padding: "20px 20px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flex: 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: "14px" }}>
                    <IoMdMenu />
                    Issue List
                  </div>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "12px", color: "#FFC000" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#FFC000",
                        }}
                      />
                      {radar.level2Counts.Acceptable}
                    </div>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "12px", color: "#E97132" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#E97132",
                        }}
                      />
                      {radar.level2Counts["Sub-Optimal"]}
                    </div>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "12px", color: "#C00000" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#C00000",
                        }}
                      />
                      {radar.level2Counts.Critical}
                    </div>
                  </div>
                </div>
                <div style={{ paddingTop: "10px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div
                    ref={dqaRef}
                    onScroll={dqaScroll}
                    style={{ maxHeight: "140px", overflow: "hidden" }}
                  >
                    {issues.map((issue, idx) => (
                      <IssueCard key={idx} issue={issue} />
                    ))}
                  </div>

                  {issues.length > 1 && (
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <button
                        onClick={dqaArrowClick}
                        style={{
                          background: "none",
                          border: "none",
                          outline: "none",
                          cursor: "pointer",
                          fontSize: "20px",
                          color: "#fff",
                          transform: dqaAtEnd ? "rotate(180deg)" : "none",
                          transition: "transform 0.3s",
                        }}
                      >
                        ▼
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, justifyContent: "revert", padding: "20px 20px 10px" }}>
          <h3 style={{ margin: 0, justifySelf: "left" }}>Alarm</h3>
          {improvementBanner.map((banner, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: commentColor(banner.action),
                fontSize: "14px",
                padding: "5px 10px",
                borderRadius: "10px",
                color: "#fff",
              }}
            >
              <strong>{banner.action}</strong> {banner.type}
            </div>))}
          <div style={{ paddingTop: "10px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div
              ref={alarmRef}
              onScroll={alarmScroll}
              style={{ maxHeight: "160px", overflow: "hidden" }}
            >
              {
                sortedRegions.map((al) => {
                  const rec = alarmRecords.find(r => r.alarm_region.id === al.id);
                  return <AlarmCard key={al.id} al={al} rec={rec} />;
                })
              }

            </div>
            {alarmRegions.length > 4 && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  onClick={alarmArrowClick}
                  style={{
                    background: "none",
                    border: "none",
                    outline: "none",
                    cursor: "pointer",
                    fontSize: "20px",
                    color: "#fff",
                    transform: alarmAtEnd ? "rotate(180deg)" : "none",
                    transition: "transform 0.3s",
                  }}
                >
                  ▼
                </button>
              </div>
            )}
          </div>
        </div>


        <div style={{ ...cardStyle, flexDirection: "row" }}>
          <div style={{
            display: "flex",
            alignItems: "left",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 1 / 3,
            gap: "20px"
          }}>
            <h3 style={{ margin: 0, justifySelf: "left" }}>Deformation</h3>
             <DeformationHeatmap heatmapUrl={heatmapUrl} radar={radar} />
          </div>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 2 / 3,
            gap: "10px"
          }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                borderRadius: "20px",
                width: "100%"
              }}
            >
              {DQPMenuItems.map((item) => {
                const isActive = activeDef === item.label;
                const isGenerateReport = item.label === "GENERATE REPORT";
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleClick2(item.label)}
                    style={{
                      border: "none",
                      width: "180px",
                      borderRadius: "20px",
                      outline: "none",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                      fontSize: "14px",
                      fontWeight: "bold",
                      color: isGenerateReport
                        ? "#00D6D1"
                        : "#fff",
                      background: isGenerateReport
                        ? "#171717" // orange for GENERATE REPORT
                        : isActive
                          ? "#404040" // bright green for active
                          : "#171717",
                      transition: "all 0.3s ease",
                      position: "relative",
                      padding: "10px 20px",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", height: "100%", width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 2 / 5,
                  backgroundColor: "#3A3A3A",
                  borderRadius: "10px",
                  padding: "20px",
                  gap: "20px",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    backgroundColor: riskCol,
                    borderRadius: "8px",
                    padding: "8px",
                    fontSize: "14px",
                  }}
                >
                  Overall Risk: <strong>{radar.TARP}</strong>
                </div>

                <div>
                  <p style={{ fontWeight: "bold", fontSize: "12px", margin: 0 }}>SUMMARY:</p>
                  {defList.summary.length > 0 && (
                    <div
                      style={{
                        marginTop: "0px",
                        color: "#fff",
                        fontSize: "12px",
                      }}
                    >
                      <ul style={{ paddingLeft: "18px", margin: 0 }}>
                        {defList.summary.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "block", flex: 3 / 5, backgroundColor: "#3A3A3A", borderRadius: "10px", padding: "20px 20px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flex: 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: "14px" }}>
                    <IoMdMenu />
                    Deformation List
                  </div>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "12px", color: "#FFC000" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#FFC000",
                        }}
                      />
                      {defList.counts["Linear Long-term"]}
                    </div>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "12px", color: "#E97132" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#E97132",
                        }}
                      />
                      {defList.counts.Linear}
                    </div>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: "12px", color: "#C00000" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#C00000",
                        }}
                      />
                      {defList.counts["TARP 4"]}
                    </div>
                  </div>
                </div>
                <div style={{ paddingTop: "10px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div
                    ref={defRef}
                    onScroll={defScroll}
                    style={{ maxHeight: "140px", overflow: "hidden" }}
                  >
                    {defList.sorted.map((def) => (
                      <DefCard key={def.id} def={def} />
                    ))}
                  </div>

                  {defList.sorted.length > 2 && (
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <button
                        onClick={defArrowClick}
                        style={{
                          background: "none",
                          border: "none",
                          outline: "none",
                          cursor: "pointer",
                          fontSize: "20px",
                          color: "#fff",
                          transform: defAtEnd ? "rotate(180deg)" : "none",
                          transition: "transform 0.3s",
                        }}
                      >
                        ▼
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
}

export default RadarDetail;
