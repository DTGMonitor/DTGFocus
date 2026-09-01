import React, { useCallback, useEffect, useRef, useState } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useParams } from "next/navigation";
import LogoSection from "@/components/Reusable/HeaderComponents/LogoSection";
import WaterChart from "@/components/InSar/ChartWater";
import { supabase } from "@/lib/supabaseClient";
import { useUserSite } from "@/components/Reusable/useUserSite";
import "cesium-navigation-es6/dist/styles/cesium-navigation.css";
import { FaFilter } from "react-icons/fa";
import InSARCard from "@/components/InSar/CardLeft";
import NavSection from "@/components/Reusable/HeaderComponents/NavSection";
import { insarMenuItems } from "@/config/menuConfig";

const Viewer = ({ title, url, transform, setTransform }) => {
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = 0.1;
    let newScale = transform.scale + (e.deltaY < 0 ? scaleFactor : -scaleFactor);
    newScale = Math.min(Math.max(newScale, 1), 5); // clamp between 1x and 5x
    setTransform({ ...transform, scale: newScale });
  };

  const handleMouseDown = (e) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform({
      ...transform,
      x: transform.x + dx,
      y: transform.y + dy,
    });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        backgroundColor: "#262626",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        flex: 1,
        overflow: "hidden",
      }}>
      <div style={{
        background: "linear-gradient(to bottom, #0B514E, #3A3A3A)",
        color: "#fff",
        padding: "4px 8px",
        borderRadius: "4px",
        fontWeight: "bold",
        fontSize: "14px",
        width: "100%",
        display: "flex",
        justifyContent: "center"
      }}>
        {title}
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          padding: "5px",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <img
          src={url}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "center center",
            transition: isDragging.current ? "none" : "transform 0.05s linear",
            userSelect: "none",
            pointerEvents: "none",
            maxWidth: "100%",
            maxHeight: "100%",
          }} />
      </div>
    </div>
  )
};

const MONTH_NUMBER = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

/**
 * Fixed facts about the imagery this page shows. They describe the Sentinel-2
 * product the water-body pipeline runs on, not the site, so they are the same
 * for every client and are not worth a column. Total/Processed come from the
 * record count, so they are filled in per site below.
 */
const SENTINEL2_FACTS = {
  Satellite: "Sentinel 2",
  Instrument: "MSI",
  Product: "Level 2-A",
  Origin: "ESA",
  Orbit: "117",
  "Data Source": "Copernicus Browser (https://browser.dataspace.copernicus.eu/)",
};

const WB_insar = () => {
  const { client } = useParams();
  const { userSite, loading: userLoading } = useUserSite();
  const isAdmin = userSite?.role === "admin";

  const [siteOptions, setSiteOptions] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const siteId = selectedSite?.id ?? null;
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [yearOptions, setYearOptions] = useState([]);
  const [monthOptions, setMonthOptions] = useState([]);
  const [meta, setMeta] = useState(null);
  const [images, setImages] = useState({ falseColor: "", trueColor: "", mndwi: "" });
  const [imagesLoading, setImagesLoading] = useState(true);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [rows, setRows] = useState([]);

  // -------- Which site's data --------
  // Every site is listed, as on Rainfall, so an admin can switch between them —
  // this page resolves a real site_id and has no all-sites reading, so without
  // a picker the all-sites view had nothing to show. The opening choice is the
  // user's own site if they have one, else the site the [client] segment names
  // (that segment is a stock_code), else the first site. A client user is
  // pinned to their own site: the control is theirs to read, not to change.
  useEffect(() => {
    if (userLoading) return;
    let cancelled = false;

    const loadSites = async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, site_name, location, stock_code")
        .order("site_name");
      if (error) {
        console.error("Error loading sites:", error);
        return;
      }
      if (cancelled) return;

      const sites = data || [];
      setSiteOptions(sites);
      if (sites.length === 0) return;

      const own = sites.find((s) => s.id === userSite?.site?.id);
      const routed = client ? sites.find((s) => s.stock_code === client) : null;
      setSelectedSite(own || routed || sites[0]);
    };

    loadSites();
    return () => { cancelled = true; };
  }, [client, userSite?.site?.id, userLoading]);

  // A month picked for one site means nothing for the next one, and the series
  // a site actually has may not include it. Clear the period on every site
  // change so handleAvailableOptions below can open on the new site's newest
  // month instead of holding a selection that has no imagery behind it.
  useEffect(() => {
    setYear("");
    setMonth("");
    setYearOptions([]);
    setMonthOptions([]);
    setMeta(null);
    setRows([]);
  }, [siteId]);

  // -------- Period options, from whatever months the series actually has --------
  const handleAvailableOptions = useCallback(({ years, months, default: fallback }) => {
    setYearOptions(years.map(String));
    setMonthOptions(months);
    // Open on the newest month rather than a hardcoded one, so a new upload is
    // what the page shows without a code change.
    setYear((current) => current || fallback.year);
    setMonth((current) => current || fallback.month);
  }, []);

  // -------- Imagery for the selected month --------
  useEffect(() => {
    if (!year || !month || !siteId) {
      setImages({ falseColor: "", trueColor: "", mndwi: "" });
      setImagesLoading(false);
      return;
    }
    let cancelled = false;

    const loadImages = async () => {
      setImagesLoading(true);
      try {
        const mm = MONTH_NUMBER[month] || month;
        const products = ["False Color", "True Color", "MNDWI"];
        const [falseColor, trueColor, mndwi] = await Promise.all(
          products.map(async (product) => {
            const { data, error } = await supabase.storage
              .from("Insar")
              .createSignedUrl(`${siteId}/${year}-${mm}_${product}.png`, 3600);
            if (error) throw error;
            return data.signedUrl;
          })
        );
        if (!cancelled) setImages({ falseColor, trueColor, mndwi });
      } catch (error) {
        console.error("Error loading images:", error);
        if (!cancelled) setImages({ falseColor: "", trueColor: "", mndwi: "" });
      } finally {
        if (!cancelled) setImagesLoading(false);
      }
    };

    loadImages();
    return () => { cancelled = true; };
  }, [year, month, siteId]);

  // The Data Availability card: the site's own facts plus the fixed Sentinel-2
  // ones. Record count doubles as Total and Processed — every month written to
  // the table has been processed.
  const rowToRender = meta
    ? {
      ...SENTINEL2_FACTS,
      Site: meta.siteName || "Unknown Site",
      Location: meta.location || "Unknown Location",
      Lat: meta.coordinates?.lat ?? 0,
      Lon: meta.coordinates?.lon ?? 0,
      "Total Data": meta.totalRecords || 0,
      "Processed Data": meta.totalRecords || 0,
      Notes: meta.company || "",
    }
    : null;

  const cardStyle = {
    backgroundColor: "#262626",
    borderRadius: "10px",
    padding: "10px 20px",
    color: "#f5f5f5",
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between"
  };

  const cardTitleStyle = {
    fontSize: "18px",
    margin: 0,
    color: "#f5f5f5"
  };

  const selectStyle = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: "6px",
    backgroundColor: "#0B514E",
    color: "#fff",
    fontSize: "14px",
    border: "none",
    outline: "none"
  };

  const getStatusColor = (status) => {
    if (status === "Increasing") return "#FFFF00";
    if (status === "Decreasing") return "#FFFF00";
    if (status === "Dry") return "#F59E0B";
    return "#ccc";
  };

  return (
    // Full-viewport flex column, as the deployed build has it. The old root was
    // `flex: 1`, which only meant something inside the Insar.jsx tab container
    // — on its own route it resolved to auto height, so the row below (which
    // asks for height: 100%) collapsed to its content and left the chart short
    // with dead space under it. A definite height here is what lets that row
    // shrink to exactly the space the header leaves.
    <div
      style={{
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        overflowY: "auto",
        overflowX: "hidden",
        // Hardcoded, like the header block below and every card on this page:
        // the InSAR viewer is dark-only, so the themed token would hand it a
        // white ground under white text.
        backgroundColor: "#050910",
        color: "#f5f5f5",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        padding: "10px",
        gap: "10px",
      }}
    >
      {/* The header lived in the Insar.jsx tab container, so the /WB_insar
          route rendered the map with no logo and no tabs. The deployed build
          puts it on the page itself — do the same, so the route is complete
          however it is reached. */}
      <div style={{ display: "flex", flexDirection: "column", background: "#050910" }}>
        <LogoSection Subtitle="InSAR" />
        <NavSection menuItems={insarMenuItems} routed />
      </div>
      <div style={{
        display: "flex",
        gap: "10px",
        height: "100%",
        flexWrap: "nowrap",
      }}>
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
          {/*Maps */}
          <div style={{ borderRadius: "10px", flex: 1, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
            {imagesLoading ? (
              <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "20px" }}>
                Loading images...
              </div>
            ) : !images.falseColor && !images.trueColor && !images.mndwi ? (
              <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "20px", color: "#8fbfba" }}>
                No water-body imagery for {selectedSite?.site_name || "this site"}.
              </div>
            ) : (
              <>
                <Viewer
                  title="False Color Map"
                  url={images.falseColor || null}
                  transform={transform}
                  setTransform={setTransform}
                />
                <Viewer
                  title="True Color Map"
                  url={images.trueColor || null}
                  transform={transform}
                  setTransform={setTransform}
                />
                <Viewer
                  title="MNDWI Color Map"
                  url={images.mndwi || null}
                  transform={transform}
                  setTransform={setTransform}
                />
              </>
            )}
          </div>

          <WaterChart
            selectedMonth={month}
            selectedYear={year}
            onStatusChange={setRows}
            availableOptions={handleAvailableOptions}
            metaData={setMeta}
            siteId={siteId}
          />

        </div>
        {/* RIGHT: Filters & cards */}
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
            flexDirection: "column",
            backgroundColor: "#073331",
            padding: "16px",
            minWidth: 0,
            borderRadius: "10px",
            justifyContent: "space-between"
          }}>
            <div style={{ marginBottom: "12px", fontWeight: "bold", color: "#f5f5f5", fontSize: "18px", gap: "10px", display: "flex", alignItems: "-moz-initial" }}>
              <FaFilter size={18} color="#E97132" />
              IMAGE SELECTION
            </div>

            {/* Site Picker */}
            <label style={{ display: "block", marginBottom: "10px", padding: "10px", border: "1px solid #0C7266", borderRadius: "10px" }}>
              <span style={{ display: "block", marginBottom: "4px", color: "#ccc", fontSize: "14px" }}>Site Selection</span>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <img
                  src="/icons/Location.svg"
                  alt=""
                  style={{
                    width: "30px",
                    height: "30px",
                    objectFit: "contain",
                  }} />
                <select
                  disabled={!isAdmin}
                  value={selectedSite?.id || ""}
                  onChange={(e) =>
                    setSelectedSite(siteOptions.find((s) => s.id === Number(e.target.value)) || null)
                  }
                  style={{ ...selectStyle, cursor: isAdmin ? "pointer" : "not-allowed" }}
                >
                  {siteOptions.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedSite?.location && (
                <span style={{ display: "block", marginTop: "6px", color: "#8fbfba", fontSize: "12px" }}>
                  {selectedSite.location}
                </span>
              )}
            </label>

            {/* Date Picker */}
            <label style={{ display: "block", marginBottom: "10px", padding: "10px", border: "1px solid #0C7266", borderRadius: "10px" }}>
              <span style={{ display: "block", marginBottom: "4px", color: "#ccc", fontSize: "14px" }}>Period Selection</span>
              <div style={{ display: "flex", gap: "10px" }}>
                <img
                  src="/icons/Calendar.svg"
                  style={{
                    width: "30px",
                    height: "30px",
                    objectFit: "contain",
                  }} />
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  style={selectStyle}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  style={selectStyle}
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>

          {/* Status Card */}
          <div style={{ ...cardStyle, flex: 0.2 }}>
            <h4 style={cardTitleStyle}>Status</h4>
            {rows.length > 0 && (
              <div style={{ marginTop: "20px" }}>
                {rows.map(([label, value], index) => (
                  <div key={index} style={{ display: "flex" }}>
                    <div
                      style={{
                        width: "100px",
                        textAlign: "left",
                        paddingRight: "8px",
                        fontSize: "18px",
                        color: "#bbb",
                        fontWeight: "bold",
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ paddingRight: "4px" }}>:</div>
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: "bold",
                        color: getStatusColor(value),
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {rowToRender && (
            <InSARCard summarydata={rowToRender} />
          )}
        </div>

      </div>
    </div>
  );
};

export default WB_insar;
