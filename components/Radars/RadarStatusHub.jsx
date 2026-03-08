// pages/Sensors/Radars/Live/RadarStatusHub.jsx
import { useState } from "react";
import RadarGallery from "@/components/Radars/Live/RadarGallery";
import RadarDetail from "@/components/Radars/Live/RadarDetail"; // import detail page
import ToggleGroup from "@/components/Reusable/ToggleGroup";
import React from "react";

function RadarStatusHub() {
  const [statusFilter, setStatusFilter] = useState(undefined);
  const [selectedRadar, setSelectedRadar] = useState(null); // ⬅ moved here

  const statusOptions = [
    { label: "ACTIVE", value: "ONLINE" },
    { label: "ALL", value: undefined },
    { label: "INACTIVE", value: "OFF SERVICE" },
  ];

  // When radar clicked in gallery
  const handleExplore = (radar) => {
    setSelectedRadar(radar);
  };

  // Back from detail
  const handleBack = () => {
    setSelectedRadar(null);
  };

  return (
 <div className="bg-[var(--dtg-bg-primary)] box-border overflow-y-auto overflow-x-hidden text-[#f5f5f5] font-['Inter',sans-serif] flex flex-col p-[10px] gap-[10px]">
      {/* Status filter toggle only visible in gallery mode */}
      {!selectedRadar && (
        <ToggleGroup
          options={statusOptions}
          activeValue={statusFilter}
          onChange={setStatusFilter}
        />
      )}

      {/* Swap between gallery and detail */}
      {selectedRadar ? (
        <RadarDetail radar={selectedRadar} onBack={handleBack} />
      ) : (
        <RadarGallery statusFilter={statusFilter} onExplore={handleExplore} />
      )}
    </div>
  );
}

export default RadarStatusHub;
