// pages/Sensors/Radars/Live/RadarStatusHub.jsx
import { useState, useRef } from "react";
import glossaryData from "../Data/glossary";
import { useRouter } from "next/navigation";
import LogoSection from "../components/HeaderComponents/LogoSection";
import React from "react";

const GlossaryPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const router = useRouter();

  // Filter by search term
  const filteredGlossary = glossaryData
    .filter((item) =>
      item.term.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => a.term.localeCompare(b.term));

  // Group by first letter
  const groupedGlossary = letters.map((letter) => ({
    letter,
    entries: filteredGlossary.filter((item) =>
      item.term.toUpperCase().startsWith(letter)
    ),
  }));


  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        padding: "10px",
        overflowY: "auto",
        overflowX: "hidden",
        backgroundColor: "#0E1117",
        color: "#f5f5f5",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: "10px"
      }}
    >
      <LogoSection
      Title={"Glossary"}/>
      <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    borderRadius: "20px",
                    height: "4px",
                    background: "linear-gradient(to bottom, #1E1E1E, #3A3A3A)"
                }}
            ></div>
      {/* Search Box */}
      <div style={{ padding: "20px", color: "#fff", display: "flex", flexDirection: "column" }}>
        <input
          type="text"
          placeholder="Search terms..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: "8px",
            width: "100%",
            maxWidth: "400px",
            marginBottom: "20px",
            borderRadius: "5px",
            border: "1px solid #ccc",
            alignSelf: "center"
          }}
        />

        {/* A-Z Navigation */}
        <div style={{ margin: "0px 100px 20px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "5px" }}>
          {letters.map((letter) => (
            <a
              key={letter}
              href={`#${letter}`}
              style={{
                color: "#14B8A6",
                textDecoration: "none",
                fontWeight: "bold",
                padding: "5px",
              }}
            >
              {letter}
            </a>
          ))}
        </div>

        {/* Glossary Entries */}
        {groupedGlossary.map((group) =>
          group.entries.length > 0 ? (
            <div key={group.letter} id={group.letter} style={{ marginBottom: "20px" }}>
              <h2 style={{ color: "#E97132" }}>{group.letter}</h2>
              {group.entries.map((item, index) => (
                <div key={index} style={{ marginBottom: "10px" }}>
                  <strong>{item.term}:</strong> {item.definition}
                </div>
              ))}
            </div>
          ) : null
        )}

      </div>
    </div>
  );
}

export default GlossaryPage;
