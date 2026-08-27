"use client";
import ClientHeader from "@/components/client/ClientHeader";
import { insarMenuItems } from "@/config/menuConfig";
import ReportsList from "@/components/client/Reports/ReportList";

export default function Page() {
  return (
    <div className="full-screen-container">
      <div className="sticky-header">
        <ClientHeader subtitle="InSAR Available Report" menuItems={insarMenuItems} />
      </div>
      <div className="flex flex-col gap-[10px] p-[10px]">
        <ReportsList page="insar" />
      </div>
    </div>
  );
}
