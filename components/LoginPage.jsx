import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { MdShield } from "react-icons/md";
import { TbActivityHeartbeat } from "react-icons/tb";
import { SlTarget } from "react-icons/sl";
import { BsExclamationLg } from "react-icons/bs";
import PulsatingCircles from "@/components/Reusable/PulsatingCircles";
import SplashScreen from "@/components/WelcomePage";
import { useAuth } from "@/contexts/AuthContext";

const LoginPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();

    const [showSplash, setShowSplash] = useState(false);

    // --- 👇 NEW: Add a loading state ---
    const { loading: authLoading } = useAuth();

    const handleLogin = async () => {
        setError("");

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setError(error.message);
            return;
        }

        // --- Your existing logic is perfect ---
        await supabase.auth.setSession(data.session);

        const { data: profileData, error: profileError } = await supabase
            .from("user_sites")
            .select("user_id, site: clients(site_name, stock_code), role")
            .eq("user_id", data.user.id);

        let sites = profileData.map(s => s.site).filter(Boolean);
        const isAdmin = profileData.some(s => s.role === "admin");
        if (isAdmin) {
            // ... (fetch all clients logic) ...
        }

        // --- Save metadata (this is still correct) ---
        await supabase.auth.updateUser({
            data: {
                role: isAdmin ? 'admin' : 'client',
                sites: sites.map(s => s.stock_code)
            }
        });

        await supabase.auth.refreshSession();

        // --- This part will now work correctly ---
        setShowSplash(true);

        if (isAdmin) {
            setTimeout(() => {
                router.replace(`/admin/RadarMonitoring`);
            }, 3000);
        } else {
            const firstClient = sites[0]?.stock_code;
            if (!firstClient) {
                setError("Login successful, but no sites are assigned.");
                setShowSplash(false);
                await supabase.auth.signOut();
                return;
            }
            setTimeout(() => {
                router.replace(`/tools/${firstClient}/home`);
            }, 3000);
        }
    };

    // --- 👇 UPDATED: Show splash while checking session OR after login ---
    if (authLoading || showSplash) {
        return <SplashScreen />;
    }

    const inputStyle = {
        margin: "10px 0",
        padding: "10px",
        borderRadius: "6px",
        border: "1px solid #7F7F7F",
        background: "rgba(23,23,23,0.8)",
        color: "#7F7F7F"
    };

    const buttonStyle = {
        marginTop: "10px",
        padding: "10px",
        width: "100%",
        background: "linear-gradient(to bottom, #00554A, #007D6E, #009684)",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        color: "#fff",
        fontWeight: "bold"
    };

    return (
        <div
            style={{
                width: "100vw",
                height: "100vh",
                boxSizing: "border-box",
                padding: "100px",
                overflowY: "auto",
                backgroundImage: `url("/background/radarBackground.png")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                color: "#f5f5f5",
                fontFamily: "Inter, sans-serif",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    bottom: 10,
                    fontStyle: "italic",
                    color: "#aaa",
                    fontSize: "14px",
                }}
            >
                © 2025 DTG Project | All rights reserved
            </div>

            {/* Main Login Box */}
            <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <PulsatingCircles />
                </div>

                {/*MIDDLE  SECTION*/}
                <div style={{ display: "flex", padding: "100px", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
                    <div>
                        <span
                            style={{
                                background: "radial-gradient(circle, #00CED1, #15BCA9, #6EA4BF)",
                                WebkitBackgroundClip: "text",
                                WebkitTextFillColor: "transparent",
                                fontSize: "60px",
                                fontWeight: "bold"
                            }}
                        >
                            DTG FOCUS
                        </span>
                        <p style={{ color: "#ccc", fontSize: "20px", marginBottom: 0 }}>Advanced geotechnical monitoring with real-time analysis</p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                            {/* Label */}
                            <div
                                style={{
                                    borderRadius: "20px",
                                    fontWeight: "bold",
                                    textAlign: "center",
                                    border: "1px solid #00E0D9",
                                    padding: "5px 15px",
                                    color: "white",
                                }}
                            >
                                Key Features
                            </div>

                            {/* Line */}
                            <div
                                style={{
                                    flexGrow: 1,
                                    height: "2px",
                                    background: "linear-gradient(to right, #00E0D9, transparent)"
                                }}
                            />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: "10px" }}>
                            <div>
                                <div style={{ border: "1px solid #fff", borderRadius: "50%", alignItems: "center", display: "flex", justifyContent: "center", width: 35, height: 35 }}>
                                    <TbActivityHeartbeat size={30} />
                                </div>
                                <p style={{ fontSize: "14px", color: "#ccc" }}>Real-Time Monitoring</p>
                            </div>
                            <div>
                                <div style={{ border: "1px solid #fff", borderRadius: "50%", alignItems: "center", display: "flex", justifyContent: "center", width: 35, height: 35 }}>
                                    <SlTarget size={30} />
                                </div>
                                <p style={{ fontSize: "14px", color: "#ccc" }}>Precision Analysis</p>
                            </div>
                            <div>
                                <div style={{ border: "1px solid #fff", borderRadius: "50%", alignItems: "center", display: "flex", justifyContent: "center", width: 35, height: 35 }}>
                                    <BsExclamationLg size={30} />
                                </div>
                                <p style={{ fontSize: "14px", color: "#ccc" }}>Safety Critical</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div style={{ display: "flex", minWidth: "350px", padding: "20px", flexDirection: "column", gap: 20, justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(2,78,76,0.3)", border: "1px solid #007573", borderRadius: 20 }}>
                    <div style={{ backgroundColor: "#007573", borderRadius: "5px", padding: "5px", width: 50, height: 50, alignItems: "center", justifyContent: "center", display: "flex" }}>
                        <MdShield color="#fff" size={40} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                        <h2 style={{ fontSize: "18px", margin: 0 }}>SECURE ACCESS</h2>
                        <p style={{ color: "#aaa", margin: 10, fontSize: "12px" }}>Enter your credentials to continue</p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                        <p style={{ margin: 0, fontSize: "14px" }}>Username</p>
                        <input
                            type="email"
                            placeholder="Enter your email/username"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                        <p style={{ margin: 0, fontSize: "14px" }}>Password</p>
                        <input
                            type="password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                    <button onClick={handleLogin} style={buttonStyle}>
                        LOG IN
                    </button>

                    {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
                    <p
                        style={{ marginTop: 20, fontSize: 12, color: "#03716E", cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => router.push("/forgot-password")}
                    >
                        Forgot Password?
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
