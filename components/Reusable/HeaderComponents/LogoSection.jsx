import UserDropdown from "../User";
import React, { useState, useRef } from "react";
// 👇 Import usePathname
import { useRouter, useParams, usePathname } from "next/navigation"; 
import { useUserSite } from "../useUserSite";
import { FiUser, FiChevronDown } from "react-icons/fi";

function LogoSection({ Subtitle = [] }) {
    const { user, userSite, loading } = useUserSite();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const userBtnRef = useRef(null);
    const router = useRouter();
    const { client } = useParams(); // Keep this for the client-side redirect
    const pathname = usePathname(); // e.g., '/admin/home' or '/tools/GGP/home'

    // 👇 NEW: This function routes to the correct home page
    const handleLogoClick = () => {
      if (pathname.startsWith("/admin")) {
        // If we are anywhere in the admin section, go to admin home
        router.push("/admin/home");
      } else {
        // Otherwise, we must be in the client section, so use the client param
        router.push(`/tools/${client}/home`);
      }
    };

    return (
        <div className="flex justify-between items-center bg-[image:var(--dtg-bg-header)] p-5">
            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "5px 10px", flex: "0 0 auto" }}>
                    <button
                        type="button"
                        title="Home"
                        onClick={handleLogoClick} // 👈 USE THE NEW FUNCTION HERE
                        style={{
                            backgroundColor: "transparent",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            color: "#fff",
                            outline: "none"
                        }}
                    >
                        <div>
                            <img
                                src="/logo/DTG/DTG Focus.png"
                                alt="DTG"
                                style={{
                                    width: 60,
                                    height: 60,
                                    objectFit: "contain",
                                    filter: "drop-shadow(0 0 5px rgba(255,255,255,1))",
                                }}
                            />
                        </div>
                    </button>
                </div>
                {/* ... rest of your component is perfect ... */}
                <div>
                    <p
                        style={{
                            background: "linear-gradient(180deg, #00CED1, #15BCA9, #6EA4BF)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            fontSize: "40px",
                            fontWeight: "bold"
                        }}
                    >
                        DTG FOCUS
                    </p>
                    <p
                        className="text-[var(--dtg-text-light)]"
                    >
                        Geotechnical Monitoring Dashboard - {Subtitle}
                    </p>
                </div>
            </div>
            {!loading && userSite && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 10px", flex: "0 0 auto", gap: 20 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <h4 className="text-white">
                            {userSite.displayname}
                        </h4>
                        <p className="text-white">
                            {userSite.site?.site_name
                                ? `${userSite.site.site_name}, ${userSite.site.company}`
                                : "Administrator"}
                        </p>
                    </div>
                    <button
                        ref={userBtnRef}
                        type="button"
                        title="User Menu" // Changed title for clarity
                        onClick={() => {
                            setShowUserMenu((v) => !v);
                        }}
                        className="flex items-center p-2 bg-[var(--dtg-bg-card)] hover:bg-[var(--dtg-bg-hover)]"
                    >
                        <div
                            style={{
                                borderRadius: "50%",
                                padding: "5px",
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                width: "100%",
                                height: "100%",
                                backgroundColor: userSite.site?.logo_path ? "#fff" : "#14b8a6"
                            }}
                        >
                            {userSite.site?.logo_path ? (
                                <img
                                    src= "/logo/CompanyLogo/LogoOnly/user.png"
                                    alt="Logo"
                                    style={{
                                        width: "24px",
                                        height: "24px",
                                        objectFit: "contain",
                                    }}
                                />) : (
                                <FiUser size={24} color="#fff" />
                            )}
                        </div>
                        <FiChevronDown size={20} color="#ccc" />
                    </button>
                </div>
            )}
            {showUserMenu && (
                <UserDropdown
                    open={showUserMenu}
                    anchorRef={userBtnRef}
                    onClose={() => setShowUserMenu(false)}
                    user={user}
                    site={userSite?.site?.site_name}
                    logo={userSite?.site?.logo_path || "../logo/CompanyLogo/LogoOnly/user.png"}
                />
            )}
        </div>
    );
}

export default LogoSection;