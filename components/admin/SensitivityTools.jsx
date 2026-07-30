"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FaArrowLeft } from "react-icons/fa";
import { SlClock } from "react-icons/sl";
import { FaCalendarAlt } from "react-icons/fa";

// The sensitivity tool is a self-contained static app (WebGL viewer + DXF/Surpac
// parsers, no dependencies) living in public/sensitivity-tools. It is embedded as
// an iframe rather than ported to React so it can be refreshed straight from the
// upstream clone — see docs note in MonitoringSelection.
const APP_SRC = "/sensitivity-tools/index.html";

const SensitivityTools = () => {
  const router = useRouter();

  // ---- DATE & TIME ----
  const [dateTime, setDateTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const timeString = dateTime.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateString = dateTime.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#1a1a1a",
        color: "#f5f5f5",
        fontFamily: "Inter, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Toolbar — mirrors the monitoring selection header */}
      <div
        style={{
          flexShrink: 0,
          height: "40px",
          margin: "10px 10px 0",
          background:
            "linear-gradient(180deg, #212121 0%, #343434 75%, #404040 100%)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderRadius: "4px",
        }}
      >
        <button
          onClick={() => router.push("/admin/monitoring")}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginLeft: 20,
            background: "none",
            border: "none",
            color: "#f5f5f5",
            fontSize: "14px",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <FaArrowLeft size={16} color="#05CAC8" />
          <span>Back to monitoring</span>
        </button>
        <div
          style={{
            backgroundColor: "#024E4C",
            borderRadius: "40px",
            height: "100%",
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: "bold", margin: 0 }}>
            SENSITIVITY TOOLS
          </h2>
        </div>
        <div style={{ display: "flex", gap: 10, marginRight: 20 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SlClock size={20} color="#05CAC8" />
            <span>{timeString}</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <FaCalendarAlt size={20} color="#05CAC8" />
            <span>{dateString}</span>
          </div>
        </div>
      </div>

      {/* The tool itself */}
      <iframe
        src={APP_SRC}
        title="Radar Line-of-Sight Sensitivity Tool"
        allow="fullscreen"
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          display: "block",
          minHeight: 0,
        }}
      />
    </div>
  );
};

export default SensitivityTools;
