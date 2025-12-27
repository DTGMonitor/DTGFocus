import React from 'react';

const ScaleBar = ({ scaleWidth = 3.98, mapWidth = 7.55 }) => {
  // Calculate the precise percentage width based on your image ratio
  const widthPercentage = (scaleWidth / mapWidth) * 100;

  return (
    <div
      style={{
        width: `${widthPercentage}%`,
        margin: '8px auto 4px auto',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* The Bar: Flex container with alternating blocks */}
      <div
        style={{
          display: 'flex',
          height: '6px',
          border: '1px solid #333',
          backgroundColor: 'white', // Ensure white blocks are white, not transparent
        }}
      >
        <div style={{ flex: 1, backgroundColor: '#000' }}></div>
        <div style={{ flex: 1 }}></div>
        <div style={{ flex: 1, backgroundColor: '#000' }}></div>
        <div style={{ flex: 1 }}></div>
        <div style={{ flex: 1, backgroundColor: '#000' }}></div>
      </div>

      {/* The Labels: Relative container for absolute positioning */}
      <div
        style={{
          position: 'relative',
          height: '12px',
          fontSize: '9px',
          color: '#333',
          marginTop: '2px',
        }}
      >
        {[0, 1, 2, 3, 4, 5].map((val) => (
          <span
            key={val}
            style={{
              position: 'absolute',
              left: `${(val / 5) * 100}%`,
              transform: 'translateX(-50%)',
              whiteSpace: "nowrap"
            }}
          >
            {val} km
          </span>
        ))}
      </div>
    </div>
  );
};

export default ScaleBar;