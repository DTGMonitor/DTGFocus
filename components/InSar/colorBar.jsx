import React from "react";

const ColorBar = ({ min = -20, max = 60, units = "mm", gradient, orientation }) => {
    const isHorizontal = orientation === 'horizontal';

    // Compute intermediate values
    const mid = (min + max) / 2;
    const step = (max - min) / 4;
    const tickValues = [max, max - step, mid, min + step, min];

    // Dynamic sizing based on orientation
    const containerStyle = isHorizontal
        ? { width: "200px", height: "auto", display: "flex", flexDirection: "column" } // Increased width slightly for text
        : { width: "60px", height: "auto" };

    const barStyle = isHorizontal
        ? { height: "20px", width: "100%" }
        : { height: "150px", width: "20px" };

    return (
        <div
            style={{
                borderRadius: "8px",
                fontSize: "12px",
                color: "black",
                textAlign: "center",
                boxSizing: "border-box", 
                ...containerStyle, 
            }}
        >
            <div style={{ marginBottom: "5px", fontWeight: "bold" }}>{units}</div>

            {/* THE BAR AND TICKS */}
            <div
                style={{
                    margin: "0 auto",
                    background: gradient || "linear-gradient(to bottom, red, blue)",
                    border: "1px solid #ccc",
                    position: "relative",
                    ...barStyle, 
                }}
            >
                {tickValues.map((val, i) => {
                    const pct = ((max - val) / (max - min)) * 100;

                    const tickPositionStyles = isHorizontal
                        ? {
                            left: `${pct}%`,
                            top: "24px",                 
                            transform: "translateX(-50%)", 
                          }
                        : {
                            top: `${pct}%`,
                            left: "24px",                  
                            transform: "translateY(-50%)", 
                          };

                    return (
                        <div
                            key={i}
                            style={{
                                position: "absolute",
                                fontSize: "11px",
                                whiteSpace: "nowrap",
                                fontWeight: "bold", // Made numbers bold to match image
                                ...tickPositionStyles,
                            }}
                        >
                            {val.toFixed(1)}
                        </div>
                    );
                })}
            </div>

            {/* --- NEW SECTION: LEGEND LABELS --- */}
            {isHorizontal && (
                <div style={{ 
                    display: 'flex', 
                    width: '100%', 
                    marginTop: '25px', // Push down to clear the tick numbers
                    justifyContent: 'space-between' 
                }}>
                    <div style={{ 
                        flex: 1, 
                        textAlign: 'center', 
                        fontWeight: 'bold', 
                        textDecoration: 'underline',
                        fontSize: '10px'
                    }}>
                        Non Water
                    </div>
                    <div style={{ 
                        flex: 1, 
                        textAlign: 'center', 
                        fontWeight: 'bold', 
                        textDecoration: 'underline',
                        fontSize: '10px'
                    }}>
                        Surface Water
                    </div>
                </div>
            )}
        </div>
    );
};

export default ColorBar;