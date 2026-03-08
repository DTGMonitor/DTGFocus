import React, { useState } from "react";
import ReportsList from "@/components/client/Reports/ReportList";

const RadarReport = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <div className="w-screen h-screen bg-[var(--dtg-bg-primary)] box-border overflow-y-auto overflow-x-hidden text-[#f5f5f5] font-['Inter',sans-serif] flex flex-col p-[10px] gap-[10px]">
      <ReportsList refreshTrigger={refreshTrigger} />

    </div>

  );
};

export default RadarReport;
