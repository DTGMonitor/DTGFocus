import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { motion, AnimatePresence } from 'motion/react';
import {
    User,
    Lock,
    Eye,
    EyeOff,
    Loader2,
    ChevronRight,
    ShieldCheck,
    Signal,
    Cpu,
    Activity,
    Crosshair
} from 'lucide-react';
import { FocusLogo } from "./Reusable/FocusLogo";
import { useAuth } from "@/contexts/AuthContext";
import { MissionButton } from "./Reusable/MissionButton";
import { TransitionScreen } from "./TransitionScreen";

const MovingLines = () => (
    <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ opacity: 'var(--auth-line-opacity)', mixBlendMode: 'var(--auth-line-blend)' }}
    >
        <svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
            <motion.path
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: [0, 1, 0] }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                d="M-100,200 C150,150 300,350 1100,250"
                stroke="rgb(var(--auth-accent-rgb))" strokeWidth="0.5"
            />
            <motion.path
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: [0, 0.8, 0] }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear", delay: 2 }}
                d="M-100,800 C400,750 600,850 1100,700"
                stroke="rgb(var(--auth-muted-rgb))" strokeWidth="0.5"
            />
            <motion.path
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: [0, 0.5, 0] }}
                transition={{ duration: 12, repeat: Infinity, ease: "linear", delay: 5 }}
                d="M200,-100 C250,300 150,700 300,1100"
                stroke="rgb(var(--auth-accent-rgb))" strokeWidth="0.3"
            />
            <motion.path
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: [0, 0.5, 0] }}
                transition={{ duration: 18, repeat: Infinity, ease: "linear", delay: 8 }}
                d="M800,-100 C750,400 850,600 700,1100"
                stroke="rgb(var(--auth-muted-rgb))" strokeWidth="0.3"
            />
        </svg>
    </div>
);

// 2. SYSTEM PERIMETER - Reduced to icons only
const SystemPerimeter = () => (
    <div className="absolute inset-0 p-12 pointer-events-none z-20 select-none overflow-hidden opacity-30">
        <div className="absolute top-10 left-10">
            <div className="w-1.5 h-1.5 bg-[rgb(var(--auth-accent-rgb))] rounded-full animate-pulse" />
        </div>
        <div className="absolute top-10 right-10 flex gap-2">
            <div className="w-1 h-1 bg-[rgb(var(--auth-muted-rgb)/0.35)] rounded-full" />
            <div className="w-1 h-1 bg-[rgb(var(--auth-muted-rgb)/0.6)] rounded-full" />
            <div className="w-1 h-1 bg-[rgb(var(--auth-accent-rgb))] rounded-full" />
        </div>
        <div className="absolute bottom-10 left-10">
            <Activity size={12} className="text-[rgb(var(--auth-accent-rgb)/0.5)]" />
        </div>
        <div className="absolute bottom-10 right-10">
            <div className="w-8 h-8 rounded-full border border-[var(--auth-hairline)] flex items-center justify-center">
                <Crosshair size={10} className="text-[rgb(var(--auth-accent-rgb)/0.5)]" />
            </div>
        </div>
    </div>
);

const LoginPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showTransition, setShowTransition] = useState(false);
    const [targetPath, setTargetPath] = useState("");

    // --- 👇 NEW: Add a loading state ---
    const { loading: authLoading } = useAuth();

    const handleLogin = async () => {
        setError("");
        setIsLoading(true);
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setError(error.message);
            setIsLoading(false);
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

        if (isAdmin) {
            setTargetPath("/admin/Radar");
            setShowTransition(true);
        } else {
            const firstClient = sites[0]?.stock_code;
            if (!firstClient) {
                setError("Login successful, but no sites are assigned.");
                await supabase.auth.signOut();
                setIsLoading(false);
                return;
            }
            setTargetPath(`/tools/${firstClient}/home`);
            setShowTransition(true);
        }
    };

    return (
        <div className="min-h-screen w-full bg-[var(--auth-bg-to)] flex flex-col items-center justify-center relative overflow-hidden font-sans selection:bg-[rgb(var(--auth-accent-rgb)/0.2)]">
            {showTransition && <TransitionScreen onComplete={() => router.replace(targetPath)} />}

            {/* BACKGROUND WITH GRADATION & PLAIN AREAS */}
            <div className="absolute inset-0 z-0">

                {/* Main Gradation: brand hue falling off to the base surface */}
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--auth-bg-from)] via-[var(--auth-bg-via)] to-[var(--auth-bg-to)]" />

                {/* Radial Depth */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,var(--auth-vignette)_95%)]" />

                {/* Atmosphere Highlight */}
                <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-[rgb(var(--auth-accent-soft-rgb)/0.10)] blur-[150px] rounded-full" />
            </div>

            <MovingLines />
            <SystemPerimeter />

            {/* CORE INTERFACE */}
            {!showTransition && (
            <div className="relative z-30 w-full flex flex-col items-center px-6">

                {/* BRANDING HUB */}
                <motion.div
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center mb-8 text-center"
                >
                    <div className="relative mb-8 transform scale-90 md:scale-100">
                        <div className="absolute inset-0 bg-[rgb(var(--auth-accent-soft-rgb)/0.12)] blur-[60px] rounded-full" />
                        <FocusLogo size="xl" showTagline={false} />
                    </div>

                    <div className="space-y-3">
                        <h1 className="block text-[10px] md:text-[11px] font-bold uppercase tracking-[1em] text-[rgb(var(--auth-fg-rgb)/0.75)] leading-none mr-[-1em]">
                            Geotechnical Foresight,
                        </h1>
                        <h2 className="block text-[10px] md:text-[11px] font-bold uppercase tracking-[1em] text-[rgb(var(--auth-muted-rgb)/0.85)] leading-none mr-[-1em]">
                            Driven by Intelligence.
                        </h2>
                    </div>
                </motion.div>

                {/* REFINED AUTH CONSOLE - Wider and Proportional (Less Tall) */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.99 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-[440px]"
                >
                    <div className="relative group">
                        {/* Soft Edge Glow */}
                        <div className="absolute -inset-[1px] bg-gradient-to-b from-[rgb(var(--auth-accent-rgb)/0.35)] via-transparent to-[rgb(var(--auth-accent-rgb)/0.15)] rounded-[2.5rem] opacity-40 transition-opacity" />

                        <div className="bg-[var(--auth-card-bg)] backdrop-blur-[40px] border border-[var(--auth-hairline)] rounded-[2.5rem] p-8 md:p-10 shadow-[var(--auth-card-shadow)] relative overflow-hidden">
                            <div className="grid grid-cols-1 gap-6">
                                {/* Field: Identity */}
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between px-2">
                                        {/* Lower opacity on the label to make it "glow" less than the text */}
                                        <label className="text-[9px] font-bold uppercase tracking-[0.4em] text-[rgb(var(--auth-fg-rgb)/0.75)]">Identity</label>
                                        <Signal className="w-3 h-3 text-[rgb(var(--auth-accent-rgb)/0.7)]" />
                                    </div>
                                    <div className="relative">
                                        <User className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgb(var(--auth-fg-rgb)/0.55)]" />
                                        <input
                                            type="text"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="ID_SIGN"
                                            className="w-full bg-[var(--auth-field-bg)] border border-[var(--auth-hairline)] rounded-2xl py-4.5 pl-15 pr-6 text-[13px] font-bold tracking-[0.1em] placeholder:text-[rgb(var(--auth-fg-rgb)/0.65)] focus:outline-none focus:border-[var(--auth-hairline-strong)] focus:bg-[var(--auth-field-bg-focus)] transition-all appearance-none autofill:shadow-[0_0_0_30px_var(--auth-field-bg)_inset]"
                                            style={{ WebkitTextFillColor: 'rgb(var(--auth-fg-rgb))' }}
                                        />
                                    </div>
                                </div>

                                {/* Field: Security */}
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between px-2">
                                        <span className="text-[9px] font-bold uppercase tracking-[0.4em] text-[rgb(var(--auth-fg-rgb)/0.75)]">Security</span>
                                        <ShieldCheck className="w-3 h-3 text-[rgb(var(--auth-accent-rgb)/0.7)]" />
                                    </div>
                                    <div className="relative group/field">
                                        <Lock className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgb(var(--auth-fg-rgb)/0.55)] group-focus-within/field:text-[rgb(var(--auth-accent-rgb)/0.8)] transition-colors" />
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="••••••••"
                                            className="w-full bg-[var(--auth-field-bg)] border border-[var(--auth-hairline)] rounded-2xl py-4.5 pl-15 pr-15 text-[13px] font-bold tracking-[0.6em] placeholder:text-[rgb(var(--auth-fg-rgb)/0.65)] focus:outline-none focus:border-[var(--auth-hairline-strong)] focus:bg-[var(--auth-field-bg-focus)] transition-all appearance-none autofill:shadow-[0_0_0_30px_var(--auth-field-bg)_inset]"
                                            style={{ WebkitTextFillColor: 'rgb(var(--auth-fg-rgb))' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-6 top-1/2 -translate-y-1/2 text-[rgb(var(--auth-fg-rgb)/0.55)] hover:text-[rgb(var(--auth-accent-rgb))] transition-colors"
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="text-[var(--dtg-danger-red)] text-[10px] font-bold uppercase tracking-[0.3em] text-center">
                                    {error}
                                </div>
                            )}

                            <MissionButton
                                label="INITIALIZE"
                                loading={isLoading}
                                type="submit"
                                className="w-full mt-10"
                                onClick={handleLogin}
                            />

                            {/* ACTION LINKS */}
                            <div className="mt-10 pt-8 border-t border-[var(--auth-hairline)] flex items-center justify-center px-2">
                                <button
                                    onClick={() => router.push("/forgot-password")}
                                    className="text-[9px] font-bold uppercase tracking-[0.4em] text-[rgb(var(--auth-fg-rgb)/0.75)] hover:text-[rgb(var(--auth-accent-rgb))] transition-colors text-right">Credential Help</button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
            )}

            {/* AMBIENT SIGNAL PULSE */}
            {!showTransition && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 opacity-30">
                <div className="w-1.5 h-1.5 bg-[rgb(var(--auth-accent-rgb))] rounded-full animate-ping shadow-[0_0_10px_rgb(var(--auth-accent-rgb))]" />
            </div>
            )}

        </div>
    );
};

export default LoginPage;
