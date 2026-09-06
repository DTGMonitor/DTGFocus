import UserDropdown from "../User";
import React, { useState, useRef } from "react";
// 👇 Import usePathname
import { useRouter, useParams, usePathname } from "next/navigation";
import { useUserSite } from "../useUserSite";
import { FiUser, FiChevronDown } from "react-icons/fi";
import { FocusLogo } from "@/components/Reusable/FocusLogo";
import { ADMIN_HOME } from "@/config/adminView";
import { companyLogo } from "@/utils/companyLogos";

function LogoSection({ Subtitle = [] }) {
    const { user, userSite, loading } = useUserSite();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const userBtnRef = useRef(null);
    const router = useRouter();
    const { client } = useParams(); // Keep this for the client-side redirect
    const pathname = usePathname(); // e.g., '/admin/home' or '/tools/GGP/home'
    const getInitial = (name) => {
        if (!name) return "";
        return name.split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map(word => word[0].toUpperCase())
            .join('');
    }
    
    // The compact mark: the Supabase-hosted one where the client has uploaded
    // it, else the legacy public/logo asset. See utils/companyLogos.ts.
    const siteLogo = companyLogo(userSite?.site, 'mark');

    // 👇 NEW: This function routes to the correct home page
    const handleLogoClick = () => {
        if (pathname.startsWith("/admin")) {
            // Monitoring selection is the admin landing page. /admin/home is a
            // separate radar+safety board whose cards point at routes that do
            // not exist, so it is not where "home" should take anyone.
            router.push(ADMIN_HOME);
        } else {
            // Otherwise, we must be in the client section, so use the client param
            router.push(`/tools/${client}/home`);
        }
    };

    return (
        <div className="flex justify-between items-center bg-[image:var(--dtg-bg-header)] py-2 px-5">
            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <button
                    type="button"
                    onClick={handleLogoClick}
                    title="Back to home"
                    aria-label="Back to home"
                    className="flex items-center bg-transparent border-0 p-0 cursor-pointer"
                >
                    <FocusLogo size="xs" orientation="horizontal" showTagline={false}/>
                </button>
            </div>
            {!loading && userSite && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 10px", flex: "0 0 auto", gap: 20 }}>
                    <button
                        ref={userBtnRef}
                        type="button"
                        title="User Menu" // Changed title for clarity
                        onClick={() => {
                            setShowUserMenu((v) => !v);
                        }}
                        className="flex items-center gap-1 bg-transparent hover:bg-[var(--dtg-bg-hover)] rounded-full pr-2"
                    >
                        <div
                            style={{
                                borderRadius: "50%",
                                padding: "5px",
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                width: "30px",
                                height: "30px",
                                backgroundColor: siteLogo ? "#fff" : "#14b8a6"
                            }}
                        >
                            {siteLogo ? (
                                <img
                                    src={siteLogo}
                                    alt="Logo"
                                    style={{
                                        width: "20px",
                                        height: "20px",
                                        objectFit: "contain",
                                    }}
                                />) : (
                                <h1 style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff', margin: 0 }}>{getInitial(userSite.displayname)}</h1>
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
                    user={userSite}
                    initial={getInitial(userSite?.displayname)}
                    site={userSite?.site?.site_name}
                    logo={siteLogo}
                />
            )}
        </div>
    );
}

export default LogoSection;