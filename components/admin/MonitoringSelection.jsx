"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { FaArrowRight } from "react-icons/fa";
import { MdLocationOn } from "react-icons/md";
import { SlClock } from "react-icons/sl";
import { FaCalendarAlt } from "react-icons/fa";
import { ALL_SITES_HOME } from "@/config/clientView";

const MonitoringSelection = () => {
  const router = useRouter();

  const [activeCards, setActiveCards] = useState([]);
  const [location, setLocation] = useState("");
  const [company, setCompany] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // ---- MONITORING DOMAIN CONFIG ----
  const allDomains = [
    {
      id: 1,
      key: "SURFACE",
      title: "SURFACE",
      url: `/images/home/Surface.png`,
      Description:
        "Slope stability, radar alerts, and satellite ground movement above ground",
      Path: `/admin/Radar`,
      bgColor: "rgba(19,80,27,1)",
      gradColor: "linear-gradient(90deg, #1C4A0B 0%, #2D6E15 50%, #37841C 100%)",
    },
    {
      id: 2,
      key: "UNDERGROUND",
      title: "UNDERGROUND",
      url: `/images/home/Underground.png`,
      Description:
        "Convergence monitoring, scan QA/QC, and deformation tracking in the drifts",
      Path: null,
      bgColor: "rgba(8,79,106,1)",
      gradColor: "linear-gradient(90deg, #004562 0%, #00678F 50%, #007BAB 100%)",
    },
    {
      id: 3,
      key: "SENSIMAP",
      title: "SENSI MAP",
      url: `/images/home/Sensitivity.svg`,
      Description:
        "Radar line-of-sight sensitivity maps and slope monitoring position planning",
      Path: `/admin/SensitivityTools`,
      bgColor: "rgba(74,32,122,1)",
      gradColor: "linear-gradient(90deg, #3A1E63 0%, #6D3FB5 50%, #8B5CF6 100%)",
    },
    {
      id: 4,
      key: "CLIENTVIEW",
      title: "CLIENT VIEW",
      url: `/images/home/ClientView.png`,
      Description:
        "Open the client dashboard exactly as a site's team sees it",
      // Straight in, no site chosen first: the dashboards behind this card read
      // across every site and carry their own site filters, so picking one here
      // decided nothing. See config/clientView.
      Path: ALL_SITES_HOME,
      bgColor: "rgba(19,80,27,1)",
      gradColor: "linear-gradient(90deg, #0B4F4C 0%, #10807A 50%, #14B8A6 100%)",
    },
  ];

  // ---- HELPERS ----
  const setAlpha = (rgbaString, alpha) =>
    rgbaString.replace(/rgba?\(([^)]+)\)/, (_, values) => {
      const [r, g, b] = values.split(",").map((v) => v.trim()).slice(0, 3);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    });

  const handleExplore = (item) => {
    if (item.hasData) {
      router.push(item.Path);
    } else {
      setActiveCards((prev) =>
        prev.includes(item.id) ? prev : [...prev, item.id]
      );
    }
  };

  const handleBack = (e, id) => {
    e.stopPropagation();
    setActiveCards((prev) => prev.filter((cardId) => cardId !== id));
  };

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

  // ---- FETCH USER ----
  useEffect(() => {
    const init = async () => {
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.push("/"); // redirect to login if no session
        return;
      }

      const { data: userSite } = await supabase
        .from("user_sites")
        .select(
          "role, site_id, clients!fk_user_sites_clients(site_name, location, company, stock_code)"
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (userSite?.role === "admin") {
        setLocation("All Sites");
        setCompany("Admin");
      } else if (userSite?.clients) {
        setLocation(
          `${userSite.clients.site_name}, ${userSite.clients.location}`
        );
        setCompany(userSite.clients.company);
      } else {
        setLocation("No site assigned");
        setCompany("");
      }

      // SURFACE, SENSITIVITY and CLIENT VIEW are reachable — the underground app
      // is not ported yet, so its card falls through to the "No access" panel.
      // Per-site gating can be layered on later the same way site_dashboards
      // works for the surface dashboard picker.
      setItems(
        allDomains.map((d) => ({ ...d, hasData: d.Path !== null }))
      );
      setLoading(false);
    };

    init();
  }, [router]);

  // ---- UI RENDER ----
  if (loading)
    return (
      <div
        style={{
          color: "#fff",
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        Loading monitoring domains...
      </div>
    );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        padding: "10px",
        overflowY: "auto",
        backgroundImage: `url("/background/radarBackground.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: "#f5f5f5",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", width: "100%", maxWidth: "800px" }}>
        <p style={{ fontSize: "36px", fontWeight: "bold" }}>
          <span
            style={{
              background: "radial-gradient(circle, #07A996, #06CAB2, #19E1C9)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Welcome Back
          </span>
          <span style={{ color: "#fff" }}> {company} Team</span>
        </p>
        <p style={{ fontSize: "16px", color: "#A6A6A6" }}>
          Select the monitoring domain you want to work in
        </p>
      </div>

      {/* Toolbar */}
      <div
        style={{
          width: "100%",
          height: "40px",
          background:
            "linear-gradient(180deg, #212121 0%, #343434 75%, #404040 100%)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderRadius: "4px",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: 50 }}>
          <MdLocationOn size={20} color="#05CAC8" />
          <span>{location}</span>
        </div>
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
            CHOOSE YOUR MONITORING
          </h2>
        </div>
        <div style={{ display: "flex", gap: 10, marginRight: 50 }}>
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

      {/* Domain Grid */}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "30px",
            padding: "20px",
            width: "85%",
            height: "80%",
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => handleExplore(item)}
              style={{
                border: "1px solid #595959",
                borderRadius: "24px",
                padding: "20px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                backgroundColor: setAlpha(item.bgColor, 0.1),
                transition: "transform 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = "scale(1.03)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = "scale(1)")
              }
            >
              {/* Notification View */}
              {activeCards.includes(item.id) ? (
                <>
                  <div
                    style={{
                      border: `1px solid ${item.bgColor}`,
                      borderRadius: "40px",
                      width: "80%",
                      marginBottom: "15px",
                    }}
                  >
                    <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>
                      {item.title}
                    </h2>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="60"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#E63946"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <p style={{ fontWeight: "bold" }}>
                    No access{" "}
                    <span style={{ fontWeight: "normal" }}>
                      to this monitoring domain.
                    </span>
                  </p>
                  <p
                    style={{
                      marginTop: "10px",
                      color: "#ccc",
                      fontSize: "12px",
                      lineHeight: 1.4,
                    }}
                  >
                    If you believe this is an error,
                    <br />
                    please contact DTG Engineer at{" "}
                    <a
                      href="mailto:dtgmonitor@dtgeotech.com"
                      style={{ color: "#38BDF8" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      dtgmonitor@dtgeotech.com
                    </a>
                  </p>
                  <button
                    onClick={(e) => handleBack(e, item.id)}
                    style={{
                      backgroundColor: "#20625C",
                      border: "none",
                      padding: "6px 16px",
                      color: "#fff",
                      borderRadius: "3px",
                      marginTop: "10px",
                      cursor: "pointer",
                    }}
                  >
                    BACK
                  </button>
                </>
              ) : (
                <>
                  {/* Default View */}
                  <div
                    style={{
                      border: `2px solid ${item.bgColor}`,
                      borderRadius: "40px",
                      width: "80%",
                      marginBottom: "15px",
                    }}
                  >
                    <h2
                      style={{
                        fontSize: "20px",
                        fontWeight: "bold",
                        margin: 5,
                      }}
                    >
                      {item.title}
                    </h2>
                  </div>
                  <div
                    style={{
                      width: "80%",
                      height: "47%",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <img
                      src={item.url}
                      alt={item.title}
                      style={{
                        width: "90%",
                        height: "90%",
                        objectFit: "contain",
                        filter: `drop-shadow(0 0 5px ${setAlpha(
                          item.bgColor,
                          0.4
                        )})`,
                      }}
                    />
                  </div>
                  <p
                    style={{
                      fontSize: "16px",
                      color: "#D9D9D9",
                      fontStyle: "italic",
                      margin: "0 15px 10px",
                    }}
                  >
                    {item.Description}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExplore(item);
                    }}
                    style={{
                      background: item.gradColor,
                      border: "none",
                      padding: "8px 25px",
                      color: "#fff",
                      fontWeight: "bold",
                      borderRadius: "4px",
                      width: "80%",
                      display: "flex",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                  >
                    EXPLORE <FaArrowRight />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MonitoringSelection;
