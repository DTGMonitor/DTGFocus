import React, { useState, useMemo } from "react";
import LogoSection from "@/components/Reusable/HeaderComponents/LogoSection";
import NavSection from "@/components/Reusable/HeaderComponents/NavSection"; 
import { adminMenuItems } from "@/config/menuConfig";

import RadarMonitoring from "./RadarMonitoring";
import AlarmSummary from "@/components/admin/Radar/AlarmSummary";
import Availability from "@/components/admin/Radar/Availability";
import DataQuality from "@/components/admin/Radar/DataQuality";
import Notifications from "@/components/admin/Radar/Notifications";
import Reports from "@/components/admin/Radar/Reports";

import '../adminpagestyle.css';


const getComponentKeyFromPath = (path) => {
    return path.split("/").pop();
};


const components = {
    RadarMonitoring: <RadarMonitoring/>,
    AlarmSummary: <AlarmSummary />,
    Availability: <Availability />,
    DataQuality: <DataQuality />,
    Notifications: <Notifications />,
    Reports: <Reports />
};

function Radar() {
    const navItems = useMemo(() => {
        return adminMenuItems.map(item => ({
            label: item.label,
            icon: item.icon,

            key: getComponentKeyFromPath(item.path)
        }));
    }, []); 
    const [activeComponent, setActiveComponent] = useState(navItems[0]?.key || "");

    const handleMenuClick = (componentKey) => {
        setActiveComponent(componentKey);
    };

    return (
        <div className="full-screen-container">
            <div className="sticky-header bg-[var(--dtg-bg-primary)]">
                <LogoSection Subtitle="Radar" />

                <NavSection
                    menuItems={navItems} 
                    activeComponent={activeComponent}
                    onMenuClick={handleMenuClick}
                />
            </div>

            {components[activeComponent]}

        </div>
    );
}

export default Radar;