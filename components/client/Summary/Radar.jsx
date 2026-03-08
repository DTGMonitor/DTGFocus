// pages/Sensors/Radars/Live/Radar.jsx

import React from "react";

// 1. IMPORT YOUR PAGE COMPONENTS
import RadarStatusHub from "@/components/Radars/RadarStatusHub";
import AlarmSummaryPage from "@/components/Radars/AlarmSummaryPage";
import AvailabilitySummaryPage from "@/components/Radars/AvailabilitySummaryPage";
import DataQualitySummaryPage from "@/components/Radars/DataQualitySummaryPage";

// 2. COMPONENT MAP
const subComponents = {
    RadarStatusHub: <RadarStatusHub />,
    AlarmSummaryPage: <AlarmSummaryPage />,
    AvailabilitySummaryPage: <AvailabilitySummaryPage />,
    DataQualitySummaryPage: <DataQualitySummaryPage />,
};

function Radar({ activeSubComponent }) {
    
    // Default to RadarStatusHub if it's the first time loading the Summary View
    const componentToRender = subComponents[activeSubComponent] || <RadarStatusHub />;

    return (
       <div className="w-screen h-screen box-border overflow-y-auto overflow-x-hidden text-[#f5f5f5] font-['Inter',sans-serif] flex flex-col gap-[10px]">
            
            {/* The old NavSection is gone. Just render the dashboard! */}
            {componentToRender}

        </div>
    );
}

export default Radar;