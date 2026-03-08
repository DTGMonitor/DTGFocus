// MainPage.jsx
import React, { useState, useMemo } from "react";
import LogoSection from "@/components/Reusable/HeaderComponents/LogoSection";
import MenuBar from "@/components/Reusable/HeaderComponents/MenuBar";

// Import both configs
import { homeMenuItems, radarMenuItems } from "@/config/menuConfig";

import { LiveView } from "@/components/client/Live/LiveView";
import Radar from "@/components/client/Summary/Radar";
import Reports from "@/components/client/Reports/Reports";

const getComponentKeyFromPath = (path) => {
    return path.split("/").pop();
};

function MainPage() {
    const navItems = useMemo(() => {
        return homeMenuItems.map(item => ({
            label: item.label,
            icon: item.icon,
            key: getComponentKeyFromPath(item.path)
        }));
    }, []);

    const [activeComponent, setActiveComponent] = useState(navItems[0]?.key || "LiveView");

    // --- ToolBar State (Lifted from LiveView) ---
    const [visibleLayers, setVisibleLayers] = useState(['Radar', 'Prism', 'InSAR', 'Piezometer']);
    const [isGlobalHidden, setIsGlobalHidden] = useState(false);
    const [hazardOnly, setHazardOnly] = useState(false);
    const [activeTool, setActiveTool] = useState(null);

    const toggleLayer = (layer) => {
        setVisibleLayers(prev => 
            prev.includes(layer) ? prev.filter(l => l !== layer) : [...prev, layer]
        );
    };

    const toggleAllVisibility = () => {
        setIsGlobalHidden(!isGlobalHidden);
    };

    const handleMenuClick = (componentKey) => {
        setActiveComponent(componentKey);
    };

    // Create an array of keys that belong specifically to the Radar sub-menu
    const radarSubKeys = useMemo(() => {
        return radarMenuItems.map(item => getComponentKeyFromPath(item.path));
    }, []);

    // Keys that should trigger the LiveView map overlay
    const liveViewKeys = ["LiveView", "DeformationAnalysis", "CustomAnalysis", "AISummary"];

    const toolBarProps = {
        visibleLayers,
        toggleLayer,
        isGlobalHidden,
        toggleAllVisibility,
        hazardOnly,
        setHazardOnly,
        activeTool,
        setActiveTool
    };

    // Decide what to render in the main canvas
    let contentToRender;

    if (radarSubKeys.includes(activeComponent) || activeComponent === "Radar") {
        contentToRender = <Radar activeSubComponent={activeComponent} />;
    } else if (activeComponent === "Reports") {
        contentToRender = <Reports />;
    } else if (liveViewKeys.includes(activeComponent)) {
        // If it's the home page OR any of the analysis menus, 
        // stay on LiveView and pass the mode down!
        contentToRender = <LiveView pageMode={activeComponent} {...toolBarProps} />;
    } else {
        // Fallback
        contentToRender = <LiveView pageMode="LiveView" {...toolBarProps} />;
    }

    return (
        <div className="flex flex-col h-screen w-full overflow-hidden bg-[var(--dtg-bg-main)]">
            <div className="flex-shrink-0 z-30 bg-[var(--dtg-bg-card)] shadow-md border-b border-[var(--dtg-border-dark)]">
                <LogoSection Subtitle="Radar" />
                <MenuBar
                    menuItems={navItems}
                    activeComponent={activeComponent}
                    onMenuClick={handleMenuClick}
                    toolBarProps={toolBarProps}
                />
            </div>
            <div className="flex flex-1 overflow-hidden">
                <main className="flex-1 overflow-auto relative">
                    {contentToRender}
                </main>
            </div>
        </div>
    );
}

export default MainPage;