"use client";
import ClientHeader from "@/components/client/ClientHeader";
import { radarMenuItems } from "@/config/menuConfig";
import ReportsList from "@/components/client/Reports/ReportList";

export default function Page() {
  return (
    <div className="full-screen-container">
      <div className="sticky-header">
        <ClientHeader subtitle="Radar" menuItems={radarMenuItems} />
      </div>
      {/* `page` narrows the library to reports.type = 'radar', the way the
          deployed build splits the radar and InSAR report tabs. */}
      <div className="flex flex-col gap-[10px] p-[10px]">
        <ReportsList page="radar" />
      </div>
    </div>
  );
}
