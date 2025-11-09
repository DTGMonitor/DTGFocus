'use client';
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient";
import { MdShield } from "react-icons/md";

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
    border: "1px solid #7F7F7F",
    background: "rgba(23,23,23,0.8)",
    color: "#7F7F7F",
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
    fontWeight: "bold",
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        padding: "100px",
        overflowY: "auto",
        backgroundImage: `url("/radarBackground.png")`,
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
          display: "flex",
          minWidth: "350px",
          padding: "20px",
          flexDirection: "column",
          gap: 20,
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "rgba(2,78,76,0.3)",
          border: "1px solid #007573",
          borderRadius: 20,
        }}
      >
        <div
          style={{
            backgroundColor: "#007573",
            borderRadius: "5px",
            padding: "5px",
            width: 50,
            height: 50,
            alignItems: "center",
            justifyContent: "center",
            display: "flex",
          }}
        >
          <MdShield color="#fff" size={40} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          <h2 style={{ fontSize: "18px", margin: 0 }}>Reset Password</h2>
          <p style={{ color: "#aaa", margin: 10, fontSize: "12px" }}>
            Enter your new password to continue
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>New Password</p>
          <input
            type="password"
            placeholder="Enter new password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>Confirm Password</p>
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
          />
        </div>
        <button onClick={handleReset} style={buttonStyle}>
          RESET PASSWORD
        </button>
        {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
        {message && <p style={{ color: "#00E0D9", marginTop: 10 }}>{message}</p>}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
