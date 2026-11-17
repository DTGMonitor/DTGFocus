'use client';
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { MdShield } from "react-icons/md";
import { motion, AnimatePresence } from 'motion/react';
import { Activity, Crosshair } from 'lucide-react';
import { MissionButton } from "./Reusable/MissionButton";

const MovingLines = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden"
    style={{ opacity: 'var(--auth-line-opacity)', mixBlendMode: 'var(--auth-line-blend)' }}>
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

const ResetPasswordPage = () => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState(null);

  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash; // e.g. #access_token=...
    const params = new URLSearchParams(hash.replace("#", ""));
    const accessToken = params.get("access_token");

    if (!accessToken) {
      setError("Invalid or expired link.");
    } else {
      setToken(accessToken);
    }
  }, []);


  const handleReset = async () => {
    setError("");
    setMessage("");

    if (!newPassword || newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser(
        { password: newPassword },
        { accessToken: token }
      );

      if (error) {
        setError(error.message);
      } else {
        setMessage("Password successfully updated! Redirecting to login...");
        setTimeout(() => {
          router.push("/");
        }, 2000);
      }
    } catch (err) {
      setError("Something went wrong. Try again.");
    }
  };

  const inputStyle = {
    margin: "10px 0",
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid var(--auth-hairline-strong)",
    background: "var(--auth-field-bg)",
    color: "rgb(var(--auth-fg-rgb))",
  };

  const buttonStyle = {
    marginTop: "10px",
    padding: "10px",
    width: "100%",
    background: "linear-gradient(to bottom, #00554A, #007D6E, #009684)",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    color: "var(--auth-btn-fg)",
    fontWeight: "bold",
  };

  return (
    <div className="min-h-screen w-full bg-[var(--auth-bg-to)] flex flex-col items-center justify-center relative overflow-hidden font-sans selection:bg-[rgb(var(--auth-accent-rgb)/0.2)]">
      {/* BACKGROUND WITH GRADATION & PLAIN AREAS */}
      <div className="absolute inset-0 z-0">

        {/* Main Gradation: From Bioluminescent Forest-Teal to Pure Black */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--auth-bg-from)] via-[var(--auth-bg-via)] to-[var(--auth-bg-to)]" />

        {/* Radial Depth */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,var(--auth-vignette)_95%)]" />

        {/* Atmosphere Highlight */}
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-[rgb(var(--auth-accent-soft-rgb)/0.10)] blur-[150px] rounded-full" />
      </div>
      <MovingLines />
      <SystemPerimeter />
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[440px]"
      >
        <div className="absolute -inset-[1px] bg-gradient-to-b from-[rgb(var(--auth-accent-rgb)/0.35)] via-transparent to-[rgb(var(--auth-accent-rgb)/0.15)] rounded-[2.5rem] opacity-20 transition-opacity" />

        <div className="bg-[var(--auth-card-bg)] backdrop-blur-[40px] border border-[var(--auth-hairline)] rounded-[2.5rem] p-8 md:p-10 shadow-[var(--auth-card-shadow)] relative overflow-hidden">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
            <h2 style={{ fontSize: "18px", margin: 0, color: "rgb(var(--auth-fg-rgb))" }}>Reset Password</h2>
            <p style={{ color: "rgb(var(--auth-muted-rgb))", margin: 10, fontSize: "12px" }}>
              Enter your new password to continue
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "rgb(var(--auth-fg-rgb))" }}>New Password</p>
            <input
              type="password"
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "rgb(var(--auth-fg-rgb))" }}>Confirm Password</p>
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
            />
          </div>
          <MissionButton
            label="SUBMIT"
            type="submit"
            className="w-full mt-10"
            onClick={handleReset}
          />
          {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
          {message && <p style={{ color: "rgb(var(--auth-accent-rgb))", marginTop: 10 }}>{message}</p>}
        </div>
      </motion.div>
    </div>

  );
};

export default ResetPasswordPage;
