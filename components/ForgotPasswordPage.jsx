'use client';
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient";

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSendReset = async () => {
    setError("");
    setMessage("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://dashboard.digitaltwingeotechnical.com/reset-password"
    });


    if (error) {
      setError(error.message);
    } else {
      setMessage("Password reset email sent! Check your inbox.");
      setTimeout(() => {
        router.push("/");
      }, 3000);
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
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundImage: `url("/radarBackground.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          padding: 30,
          backgroundColor: "rgba(2,78,76,0.3)",
          border: "1px solid #007573",
          borderRadius: 20,
          minWidth: 350,
        }}
      >
        <h2 style={{ color: "#fff", textAlign: "center" }}>Forgot Password</h2>
        <p style={{ color: "#aaa", textAlign: "center", fontSize: 12 }}>
          Enter your email to receive a password reset link
        </p>
        <input
          type="email"
          placeholder="Your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <button onClick={handleSendReset} style={buttonStyle}>
          SEND RESET EMAIL
        </button>
        {error && <p style={{ color: "red" }}>{error}</p>}
        {message && <p style={{ color: "#00E0D9" }}>{message}</p>}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
