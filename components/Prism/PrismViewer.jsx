import React, { useState, Suspense, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import SiteModel from '@/components/Prism/SurfaceModel/SiteModel';
import LogoSection from '@/components/Reusable/HeaderComponents/LogoSection';
import PrismChart from '@/components/Prism/Chart';
import { OrbitSyncProvider } from '@/components/Prism/SurfaceModel/OrbitSyncContext';
import SyncedOrbitControls from '@/components/Prism/SurfaceModel/SyncedOrbitControl';
import Papa from "papaparse";
import Prisms from '@/components/Prism/PrismPoints';
import * as THREE from 'three';
import { FaFilter } from 'react-icons/fa';
import RiskSummary from '@/components/Prism/RiskSummary';
import Select from "react-select";
import { useRouter, useParams } from "next/navigation";
import ColorBar from "@/components/InSar/Legend";
import { supabase } from "@/lib/supabaseClient";
import { useUserSite } from "@/components/Reusable/useUserSite";


const ViewerCanvas = ({ title, url, isSource, prisms, colorbar }) => {
  const [bbox, setBbox] = useState(null);
 

  return (
    <div style={{
      backgroundColor: "#262626",
      borderRadius: "8px",
      padding: "10px",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      flexShrink: 1,
      overflow: "hidden",
      position: "relative"
    }}>
      <div style={{
        backgroundColor: "#3b3b3b",
        color: "#fff",
        padding: "4px 8px",
        borderRadius: "4px",
        fontWeight: "bold",
        fontSize: "14px",
        width: "fit-content"
      }}>
        {title}
      </div>


      <div style={{ flexGrow: 1, minHeight: 0, width: "100%", height: "100%", overflow: "hidden" }}>

        <Canvas camera={{ fov: 20 }} style={{ width: "100%", height: "100%", display: "block" }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[10, 10, 10]} intensity={5} />


          <Suspense fallback={null}>
            <SiteModel
              url={url}
              onBoundingBoxComputed={(siteBox) => {
                if (!(siteBox instanceof THREE.Box3)) {
                  console.error("siteBox is not a THREE.Box3!", siteBox);
                  return;
                }

                if (prisms.length > 0) {
                  const prismBox = new THREE.Box3();
                  prisms.forEach(p => {
                    const point = new THREE.Vector3(p.x, p.y, p.z);
                    prismBox.expandByPoint(point);
                  });

                  // expand by prism bounds
                  siteBox.expandByPoint(prismBox.min);
                  siteBox.expandByPoint(prismBox.max);
                }

                setBbox({
                  center: siteBox.getCenter(new THREE.Vector3()),
                  size: siteBox.getSize(new THREE.Vector3())
                });
              }}
            />

            {bbox && <Prisms data={prisms} offset={bbox.center} />}
          </Suspense>

          <SyncedOrbitControls source={isSource} boundingBox={bbox} />
        </Canvas>
      </div>  {/* 🔑 Color bar overlay (relative to ViewerCanvas) */}
      {colorbar && (
        <div
          style={{
            position: "absolute",
            top: "60px",
            left: "20px",
            fontSize: "10px",
            color: "#ccc",
            borderRadius: "6px",
            zIndex: 999,
          }}
        >
          <ColorBar
            min={colorbar.min}
            max={colorbar.max}
            gradient={colorbar.gradient}
            units={colorbar.units}
          />
        </div>
      )}
    </div>
  );
};

export default function PrismViewer() {
  const [prisms, setPrisms] = useState([]);
  const [areaOptions, setAreaOptions] = useState([]);
  // No hardcoded opening area any more: which areas exist depends on the site,
  // so the first one the site's summary file lists is what opens.
  const [selectedArea, setSelectedArea] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  // new state
  const [selectedRisk, setSelectedRisk] = useState(null);
  const { client } = useParams();
  const { userSite, loading: userLoading } = useUserSite();
  const isAdmin = userSite?.role === "admin";

  const [siteOptions, setSiteOptions] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [hasModels, setHasModels] = useState(false);

  // The prism data ships as static files under /data/PRISM/<site_name>/, so the
  // site's name is the folder these paths are built from.
  const siteFolder = selectedSite?.site_name || null;
  const summaryUrl = siteFolder ? `/data/PRISM/${siteFolder}/Data/PrismSummary.csv` : null;
  const seriesUrl = siteFolder ? `/data/PRISM/${siteFolder}/Data/prism_data.csv` : null;
  const displacementUrl = siteFolder ? `/data/PRISM/${siteFolder}/Surface/Displacement.glb` : null;
  const velocityUrl = siteFolder ? `/data/PRISM/${siteFolder}/Surface/Velocity.glb` : null;

  // Same site list and same opening choice as Rainfall: the user's own site if
  // they have one, else the site the [client] segment names (that segment is a
  // stock_code), else the first site. Only an admin may switch.
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

  // The surface models are loaded through Suspense with no error boundary, so
  // pointing the loader at a site that has no .glb would take the whole canvas
  // down. Check first and show the empty state instead.
  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      if (!displacementUrl || !velocityUrl) {
        if (!cancelled) setHasModels(false);
        return;
      }
      const found = await Promise.all(
        [displacementUrl, velocityUrl].map((url) =>
          fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(() => false)
        )
      );
      if (!cancelled) setHasModels(found.every(Boolean));
    };

    probe();
    return () => { cancelled = true; };
  }, [displacementUrl, velocityUrl]);

  // compute risks based on selectedIds
  const riskOptions = useMemo(() => {
    const risks = prisms
      .filter(p => selectedIds.includes(p.id)) // only prisms in current selection
      .map(p => p.risk);                      // get their risks

    return [...new Set(risks)]; // unique risks
  }, [prisms, selectedIds]);

  const filteredPrisms = useMemo(() => {
    return prisms.filter(p => {
      const matchArea = !selectedArea || p.area === selectedArea;
      const matchRisk = !selectedRisk || p.risk === selectedRisk;
      return matchArea && matchRisk;
    });
  }, [prisms, selectedArea, selectedRisk]);

  const prismOptions = filteredPrisms.map(p => ({
    label: p.id,
    value: p.id
  }));



  // Read the selected site's prism summary. Keyed on the site alone — the area
  // buttons set their own selection, so re-downloading the file on every area
  // click (as this used to) bought nothing.
  useEffect(() => {
    if (!summaryUrl) return;
    let cancelled = false;

    const clear = () => {
      if (cancelled) return;
      setPrisms([]);
      setAreaOptions([]);
      setSelectedArea(null);
      setSelectedIds([]);
      setSelectedRisk(null);
    };

    Papa.parse(summaryUrl, {
      header: true,
      download: true,
      dynamicTyping: true,
      error: (err) => {
        console.error("Error loading prism summary:", err);
        clear();
      },
      complete: (result) => {
        if (cancelled) return;
        const cleaned = (result.data || [])
          .filter(p => p["Easting (m)"] && p["Northing (m)"] && p["Elevation (m)"])
          .map(p => ({
            x: p["Easting (m)"],
            y: p["Northing (m)"],
            z: p["Elevation (m)"],
            id: p.ID,
            risk: p.RiskRating,
            area: p.Area
          }));

        if (cleaned.length === 0) {
          clear();
          return;
        }

        setPrisms(cleaned);
        // --- Extract unique area options ---
        const uniqueAreas = [...new Set(cleaned.map(p => p.area).filter(Boolean))];
        const sortedAreas = uniqueAreas.sort((a, b) => {
          const numA = parseInt(a.replace("Area ", ""), 10);
          const numB = parseInt(b.replace("Area ", ""), 10);
          return numA - numB;
        });
        setAreaOptions(sortedAreas);

        // Open on the site's first area, with every prism in it selected.
        const openingArea = sortedAreas[0] ?? null;
        setSelectedArea(openingArea);
        setSelectedRisk(null);
        setSelectedIds(
          openingArea ? cleaned.filter(p => p.area === openingArea).map(p => p.id) : []
        );
      },
    });

    return () => { cancelled = true; };
  }, [summaryUrl]);

  /* --- Styles --- */
  const blockLabel = {
    display: "block",
    padding: "10px",
    border: "1px solid #0C7266",
    borderRadius: "10px",
  };
  const labelSpan = {
    display: "block",
    color: "#ccc",
    fontSize: "14px",
    marginBottom: "5px"
  };
  const buttonGrid = {
    display: "grid",
    flex: 1,
    gridTemplateColumns: "1fr 1fr",
    gap: "8px"
  };

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      boxSizing: "border-box",
      overflow: "hidden",
      backgroundColor: "#050910",
      color: "#f5f5f5",
      fontFamily: "Inter, sans-serif",
      display: "flex",
      flexDirection: "column",
      padding: "10px",
      gap: "10px"
    }}>
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <LogoSection Subtitle="Prism" />
        <div style={{
          height: "4px",
          borderRadius: "20px",
          background: "linear-gradient(to bottom, #1E1E1E, #3A3A3A)"
        }} />
      </div>

      {/* Main Content */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(200px, 20%) 1fr",
        gridTemplateRows: "1fr minmax(200px, 40%)",
        gap: "10px",
        flex: 1,
        minHeight: 0
      }}>
        {/* Sidebar */}
        <div style={{ gridRow: "1 / 3", gridColumn: "1 / 2", borderRadius: "10px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%" }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              backgroundColor: "#073331",
              padding: "16px",
              minWidth: 0,
              borderRadius: "10px",
              gap: 10
            }}>
              <div style={{ marginBottom: "12px", fontWeight: "bold", color: "#f5f5f5", fontSize: "18px", gap: "10px", display: "flex", alignItems: "-moz-initial" }}>
                <FaFilter size={18} color="#E97132" />
                ADVANCED FILTERING
              </div>

              {/* Site */}
              <label style={blockLabel}>
                <span style={labelSpan}>Site Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      borderRadius: "6px",
                      backgroundColor: "#08403D",
                      color: "#fff",
                      fontSize: "12px",
                      border: "none",
                      outline: "none",
                      cursor: isAdmin ? "pointer" : "not-allowed",
                    }}
                  >
                    {siteOptions.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.site_name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              {/* Area */}
              <label style={blockLabel}>
                <span style={labelSpan}>Area Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <img
                    src="/icons/Location.svg"
                    style={{
                      width: "35px",
                      height: "35px",
                      objectFit: "contain",
                    }} />
                  <div style={buttonGrid}>
                    {areaOptions.length === 0 && (
                      <span style={{ gridColumn: "1 / -1", color: "#8fbfba", fontSize: "12px" }}>
                        No prism data for this site.
                      </span>
                    )}
                    {areaOptions.map((area) => (
                      <button
                        key={area}
                        type="button"
                        onClick={() => {
                          setSelectedArea(area);
                          // 👇 auto-select all IDs from this area
                          const idsInArea = prisms.filter(p => p.area === area).map(p => p.id);
                          setSelectedIds(idsInArea);
                        }}
                        style={{
                          backgroundColor: selectedArea === area ? "#14B8A6" : "#08403D",
                          color: selectedArea === area ? "#fff" : "#ccc",
                          borderRadius: "6px",
                          padding: "6px",
                          fontSize: "12px",
                          marginRight: "5px",
                          border: "none",
                          outline: "none",
                          cursor: "pointer"
                        }}
                      >
                        {area}
                      </button>
                    ))}
                  </div>
                </div>
              </label>

              {/* Prism Selection */}
              <label style={blockLabel}>
                <span style={labelSpan}>Prism Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <img
                    src="/icons/Prism.svg"
                    style={{
                      width: "30px",
                      height: "30px",
                      objectFit: "contain",
                    }}
                    alt="Prism Icon"
                  />
                  <Select
                    isMulti
                    value={selectedIds.map((id) => ({ label: id, value: id }))}
                    options={prismOptions} // ✅ now filtered by area + risk
                    onChange={(selected) => {
                      const selectedValues = selected ? selected.map((s) => s.value) : [];
                      setSelectedIds(selectedValues);
                    }}
                    isSearchable
                    closeMenuOnSelect={false}
                    styles={{
                      container: (base) => ({
                        ...base,
                        flex: 1,
                      }),
                      valueContainer: (base) => ({
                        ...base,
                        flexWrap: "wrap",
                        padding: 0,
                        height: "100px",
                        overflowY: "auto"
                      }),
                      control: (base, state) => ({
                        ...base,
                        backgroundColor: state.isDisabled ? "#2f2f2f" : "#08403D", // ⬅ custom color when disabled
                        border: "none", // ⬅ remove border
                        borderRadius: "6px",
                        boxShadow: "none",
                        fontSize: "12px",
                        color: "#fff",
                        opacity: state.isDisabled ? 0.5 : 1, // ⬅ optionally dim
                        cursor: state.isDisabled ? "not-allowed" : "default",
                      }),
                      multiValue: (styles) => ({
                        ...styles,
                        backgroundColor: "#14B8A6",
                        color: "#fff",
                      }),
                      input: (base) => ({
                        ...base,
                        color: "#fff",
                      }),
                      menu: (base) => ({
                        ...base,
                        backgroundColor: "#1B1B1B",
                        color: "#fff",
                      }),
                      option: (base, state) => ({
                        ...base,
                        backgroundColor: state.isFocused ? "#08403D" : "#1B1B1B",
                        color: "#fff",
                        cursor: "pointer",
                      }),
                    }}
                  />
                </div>
              </label>

              {/* Risk Selection */}
              <label style={blockLabel}>
                <span style={labelSpan}>Risk Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <img
                    src="/icons/Risk.svg"
                    style={{
                      width: "30px",
                      height: "30px",
                      objectFit: "contain",
                    }}
                    alt="Risk Icon"
                  />
                  <div style={buttonGrid}>
                    {riskOptions.map((risk) => (
                      <button
                        key={risk}
                        type="button"
                        onClick={() => {
                          setSelectedRisk(risk);

                          // auto-select all IDs from this risk
                          const idsInRisk = prisms
                            .filter(p => p.risk === risk && (!selectedArea || p.area === selectedArea))
                            .map(p => p.id);

                          setSelectedIds(idsInRisk);
                        }}
                        style={{
                          backgroundColor: selectedRisk === risk ? "#14B8A6" : "#08403D",
                          color: selectedRisk === risk ? "#fff" : "#ccc",
                          borderRadius: "6px",
                          padding: "6px",
                          fontSize: "12px",
                          marginRight: "5px",
                          border: "none",
                          outline: "none",
                          cursor: "pointer"
                        }}
                      >
                        {risk}
                      </button>
                    ))}
                  </div>
                </div>
              </label>


            </div>

            <RiskSummary data={prisms} selectedIDs={selectedIds} />

          </div>
        </div>

        {/* Top Dual 3D Views */}
        {hasModels ? (
          <OrbitSyncProvider>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
              <ViewerCanvas
                title="Cumulative Displacement"
                url={displacementUrl}
                isSource
                prisms={prisms.filter(p => p.area === selectedArea && selectedIds.includes(p.id))}
                colorbar={{
                  min: -40,
                  max: 40,
                  gradient: "linear-gradient(to bottom, red, yellow, green, lightblue, blue)",
                  units: "mm",
                }}
              />
              <ViewerCanvas
                title="Velocity"
                url={velocityUrl}
                prisms={prisms.filter(p => p.area === selectedArea && selectedIds.includes(p.id))}
                colorbar={{
                  min: -1,
                  max: 2,
                  gradient: "linear-gradient(to bottom, red, yellow, green, lightblue, blue)",
                  units: "mm/d",
                }}
              />
            </div>
          </OrbitSyncProvider>
        ) : (
          <div style={{
            backgroundColor: "#262626",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8fbfba",
            fontSize: "14px",
          }}>
            No surface model for {selectedSite?.site_name || "this site"}.
          </div>
        )}



        {/* Bottom Chart */}
        <div style={{
          backgroundColor: "#262626",
          borderRadius: "10px",
          padding: "20px",
          gridColumn: "2 / 3",
          gridRow: "2 / 3",
          minHeight: 0,
          overflow: "hidden"
        }}>
          {selectedIds.length > 0 ? (
            <PrismChart IDs={selectedIds} dataUrl={seriesUrl} />
          ) : (
            <p style={{ color: "#aaa" }}>Select an area and prism(s) to view chart.</p>
          )}
        </div>
      </div>
    </div>
  );
}
