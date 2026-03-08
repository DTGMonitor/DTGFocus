import React from "react";

const ToggleGroup = ({ options = [], activeValue, onChange }) => {
  const toggleBtnStyle = (isActive) => ({
    borderRadius: "30px",
    border: isActive ? "1px solid #AA4512" : "none",
    padding: "6px 20px",
    fontSize: "13px",
    background: isActive
      ? "linear-gradient(180deg, #682200 0%, #983503 75%, #B54107 100%)"
      : "transparent",
    color: isActive? "#fff" : "var(--dtg-text-primary)",
    cursor: "pointer",
    transition: "all 0.3s ease",
    fontWeight: isActive ? "bold" : "normal",
    outline: "none",
    boxShadow: "none",
    transform: isActive ? "scale(1.1)" : "scale(1)",
  });

  return (
    <div style={{ display: "flex", flex: "0", justifyContent:"center" }}>
      <div
        style={{
          display: "flex",
          border: "1px solid #AA4512",
          justifyContent: "center",
          alignItems: "center",
          borderRadius: "40px",
          overflow: "visible",
          marginTop: "10px",
        }}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            style={toggleBtnStyle(activeValue === opt.value|| (opt.value === undefined && activeValue == null))}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ToggleGroup;
