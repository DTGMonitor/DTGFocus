"use client";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SlClock } from "react-icons/sl";
import { FaCalendarAlt } from "react-icons/fa";
import LogoSection from "@/components/Reusable/HeaderComponents/LogoSection";

// The sensitivity tool is a self-contained static app (WebGL viewer + DXF/Surpac
// parsers, no dependencies) living in public/sensitivity-tools. It is embedded as
// an iframe rather than ported to React so it can be refreshed straight from the
// upstream clone — see docs note in MonitoringSelection.
const APP_SRC = "/sensitivity-tools/index.html";

/**
 * The active platform theme, read off the `dark` class on <html>.
 *
 * Deliberately not useTheme(): app/layout.tsx mounts two nested ThemeProviders
 * — an outer one on `class` and an inner one on `data-theme` — and useTheme()
 * resolves to the inner. The class is what app/globals.css keys its --dtg-*
 * blocks off, so that is the one the tool has to agree with.
 */
const themeStore = {
  subscribe(onChange) {
    const mo = new MutationObserver(onChange);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => mo.disconnect();
  },
  get: () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  getServer: () => "light",
};

const SensitivityTools = () => {
  const iframeRef = useRef(null);

  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.get,
    themeStore.getServer
  );
  const isDark = theme === "dark";

  // Pinned on first render. The tool holds the loaded survey and the computed
  // map in memory, so the src must never change afterwards — a later toggle
  // goes over postMessage instead, which repaints without reloading.
  const [bootSrc] = useState(() => `${APP_SRC}?theme=${theme}`);

  const pushTheme = () => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "platform-theme", theme },
      window.location.origin
    );
  };
  useEffect(pushTheme, [theme]);

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

  // The teal that reads on the toolbar. #05CAC8 carries the dark screens but
  // only reaches ~1.9:1 on the light gradient, so light mode takes the deep
  // teal the pill already uses.
  const accent = isDark ? "#05CAC8" : "#024E4C";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--dtg-bg-primary)",
        color: "var(--dtg-text-primary)",
        fontFamily: "Inter, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Shared platform header — the DTG Focus mark routes back to home */}
      <div style={{ flexShrink: 0 }}>
        <LogoSection Subtitle="Sensitivity Tools" />
      </div>

      {/* Toolbar — mirrors the monitoring selection header. The grey ramp
          inverts between themes, so one gradient serves both. */}
      <div
        style={{
          flexShrink: 0,
          height: "40px",
          margin: "10px 10px 0",
          background:
            "linear-gradient(180deg, var(--dtg-gray-100) 0%, var(--dtg-gray-200) 75%, var(--dtg-gray-300) 100%)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderRadius: "4px",
        }}
      >
        {/* Empty. Going back is the logo's job now, but the slot stays so the
            title pill is centred on the bar rather than on the space the clock
            leaves over. */}
        <div style={{ flex: 1 }} />
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
          {/* Deep teal pill, so its label stays light in both themes */}
          <h2
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              margin: 0,
              color: "#f5f5f5",
            }}
          >
            SENSITIVITY TOOLS
          </h2>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginRight: 20,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SlClock size={20} color={accent} />
            <span>{timeString}</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <FaCalendarAlt size={20} color={accent} />
            <span>{dateString}</span>
          </div>
        </div>
      </div>

      {/* The tool itself */}
      <iframe
        ref={iframeRef}
        src={bootSrc}
        title="Radar Line-of-Sight Sensitivity Tool"
        allow="fullscreen"
        // Covers the case where the theme changed while the frame was still
        // loading and the initial postMessage had no document to land on.
        onLoad={pushTheme}
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
