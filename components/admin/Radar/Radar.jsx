import React, { useState, useMemo } from "react";
import LogoSection from "@/components/Reusable/HeaderComponents/LogoSection";
import NavSection from "@/components/Reusable/HeaderComponents/NavSection"; 
import { adminMenuItems } from "@/config/menuConfig";
import RadarMonitoring from "./RadarMonitoring";
import Notifications from "@/components/admin/Radar/Notifications";
import Reports from "@/components/admin/Radar/Reports";
import ReportReminderManager from "@/components/admin/Radar/ReportReminder/ReportReminderManager";
import '../adminpagestyle.css';


const getComponentKeyFromPath = (path) => {
    return path.split("/").pop();
};


const components = {
    RadarMonitoring: <RadarMonitoring/>,
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
            <div className="sticky-header">
                <LogoSection Subtitle="Radar" />

                <NavSection
                    menuItems={navItems} 
                    activeComponent={activeComponent}
                    onMenuClick={handleMenuClick}
                />
            </div>

            {components[activeComponent]}

            {/* Daily report-generation reminder — active across all tabs */}
            <ReportReminderManager />

        </div>
    );
}

export default Radar;