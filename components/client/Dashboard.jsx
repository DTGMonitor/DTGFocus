"use client";
import React, { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { FaArrowRight, FaArrowLeft } from "react-icons/fa";
import { MdLocationOn } from "react-icons/md";
import { SlClock } from "react-icons/sl";
import { FaCalendarAlt } from "react-icons/fa";
import { isAllSites } from "@/config/clientView";
import { ADMIN_HOME } from "@/config/adminView";

/**
 * The client landing page — five dashboard cards, one per sensor family.
 *
 * A port of the deployed build's `/:client/home`, with two differences:
 *
 *   - routes are Next's `/tools/<client>/…` rather than the deployed `/<client>/…`
 *   - the header is this repo's own FOCUS LogoSection wherever a page carries one
 *
 * Which cards a site may open is data, not code: `site_dashboards` lists the
 * dashboard_keys the site is entitled to, and a card without one falls through
 * to the "No data found" panel instead of routing. An admin sees all five, the
 * same way the deployed build does.
 */
const Dashboard = () => {
  const router = useRouter();
  const params = useParams();
  const client = params?.client;

  const [activeCards, setActiveCards] = useState([]);
  const [location, setLocation] = useState("");
  const [company, setCompany] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // Only an admin has an admin board to go back to — a site's own team has no
  // such page, so the Back control is theirs alone.
  const [isAdmin, setIsAdmin] = useState(false);

  // ---- DASHBOARD CONFIG ----
  // `key` is the dashboard_key stored on site_dashboards — do not rename one
  // without migrating the rows.
  const allDashboards = [
    {
      id: 1,
      key: "RADAR",
      title: "RADAR",
      url: "/images/home/Radar.png",
      Description:
        "Real time alerts radar status, data quality, and deformation tracking",
      Path: `/tools/${client}/RadarStatusHub`,
      bgColor: "rgba(19,80,27,1)",
      gradColor: "linear-gradient(90deg, #1C4A0B 0%, #2D6E15 50%, #37841C 100%)",
    },
    {
      id: 2,
      key: "INSAR",
      title: "INSAR",
      url: "/images/home/InSar.png",
      Description: "Satellite analysis for long-term ground movement",
      Path: `/tools/${client}/WB_insar`,
      bgColor: "rgba(8,79,106,1)",
      gradColor: "linear-gradient(90deg, #004562 0%, #00678F 50%, #007BAB 100%)",
    },
    {
      id: 3,
      key: "PRISM",
      title: "PRISM",
      url: "/images/home/Prism.png",
      Description:
        "Measure three-dimensional ground movement with millimeter accuracy",
      Path: `/tools/${client}/PrismViewer`,
      bgColor: "rgba(112,48,160,1)",
      gradColor: "linear-gradient(90deg, #29084E 0%, #401174 50%, #4E168B 100%)",
    },
    {
      id: 4,
      key: "VWP",
      title: "VWP",
      url: "/images/home/VWP.png",
      Description: "Monitor pore water pressure with piezometer data",
      Path: `/tools/${client}/VWP`,
      bgColor: "rgba(231,100,0,1)",
      gradColor: "linear-gradient(90deg, #863700 0%, #C25300 50%, #E76400 100%)",
    },
    {
      id: 5,
      key: "RAINFALL",
      title: "RAINFALL",
      url: "/images/home/Rainfall.png",
      Description: "Get the realtime rainfall data to support analysis",
      Path: `/tools/${client}/Rainfall`,
      bgColor: "rgba(0,0,255,1)",
      gradColor: "linear-gradient(90deg, #05012E 0%, #1504FD 50%, #28B8E4 100%)",
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

  // ---- FETCH USER & ENTITLEMENTS ----
  useEffect(() => {
    const init = async () => {
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.push("/login");
        return;
      }

      const { data: userSite, error } = await supabase
        .from("user_sites")
        .select(
          "role, site_id, clients!fk_user_sites_clients(site_name, location, company, stock_code)"
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !userSite) {
        setIsAdmin(false);
        setLocation("No site assigned");
        setCompany("");
        setItems([]);
        setLoading(false);
        return;
      }

      let allowedKeys = [];

      setIsAdmin(userSite.role === "admin");

      if (userSite.role === "admin") {
        // An admin has no site of their own, so the header names whatever the
        // URL is on. The monitoring board sends them to the ALL-SITES view,
        // which is not a stock_code and must not be looked up as one — the
        // dashboards behind it read across every site anyway. A real stock_code
        // still reaches here when an admin is handed a site's own link.
        if (isAllSites(client)) {
          setLocation("All Sites");
          setCompany("Admin");
        } else {
          const { data: viewed } = await supabase
            .from("clients")
            .select("site_name, location, company")
            .eq("stock_code", client)
            .maybeSingle();

          setLocation(
            viewed ? `${viewed.site_name}, ${viewed.location}` : "All Sites"
          );
          setCompany(viewed?.company || "Admin");
        }
        allowedKeys = allDashboards.map((d) => d.key);
      } else if (userSite.clients) {
        setLocation(
          `${userSite.clients.site_name}, ${userSite.clients.location}`
        );
        setCompany(userSite.clients.company);

        const { data: dashboards, error: dashError } = await supabase
          .from("site_dashboards")
          .select("dashboard_key")
          .eq("site_id", userSite.site_id);

        if (dashError) {
          console.error("Error fetching dashboards:", dashError);
        } else if (dashboards) {
          allowedKeys = dashboards.map((d) => d.dashboard_key);
        }
      } else {
        setLocation("Unknown Site");
        setCompany("");
      }

      setItems(
        allDashboards.map((d) => ({ ...d, hasData: allowedKeys.includes(d.key) }))
      );
      setLoading(false);
    };

    init();
    // `client` is in the URL, so an admin switching sites re-reads entitlements.
  }, [router, client]);

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
        Loading dashboards...
      </div>
    );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        position: "relative",
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
      {/* Back to the admin board. An admin reaches this dashboard from the
          CLIENT VIEW card on /admin/monitoring, and had no way back but the
          browser's own Back button. */}
      {isAdmin && (
        <button
          type="button"
          onClick={() => router.push(ADMIN_HOME)}
          title="Back to admin home"
          aria-label="Back to admin home"
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            border: "1px solid #05CAC8",
            borderRadius: "4px",
            background: "rgba(2, 78, 76, 0.85)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          <FaArrowLeft /> ADMIN HOME
        </button>
      )}

      {/* Header */}
      <div style={{ textAlign: "center", width: "100%", maxWidth: "800px", padding: "0 20px" }}>
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
          Explore real-time monitoring summaries of slope movement and ground
          conditions
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
            CHOOSE YOUR DASHBOARD
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

      {/* Dashboard Grid */}
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
                    No data found{" "}
                    <span style={{ fontWeight: "normal" }}>
                      for this dashboard.
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
                      margin: "0 auto 10px auto",
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

export default Dashboard;
