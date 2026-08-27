"use client";
import ClientHeader from "@/components/client/ClientHeader";
import { radarMenuItems } from "@/config/menuConfig";
import RadarStatusHub from "@/components/Radars/RadarStatusHub";

export default function Page() {
  return (
    <div className="full-screen-container">
      <div className="sticky-header">
        <ClientHeader subtitle="Radar" menuItems={radarMenuItems} />
      </div>
      <RadarStatusHub />
    </div>
  );
}
