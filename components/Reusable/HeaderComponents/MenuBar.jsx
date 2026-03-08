// src/components/MenuBar.jsx
import React, { useState, useRef, useEffect } from "react";
import { radarMenuItems } from "@/config/menuConfig";
import { FiChevronRight, FiCheck } from "react-icons/fi";
import { ToolBar} from "@/components/Reusable/HeaderComponents/ToolBar";

function toProperTitleCase(str) {
    const lowerWords = ["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "in", "of"];
    return str
        .toLowerCase()
        .split(" ")
        .map((word, index) =>
            index === 0 || !lowerWords.includes(word)
                ? word.charAt(0).toUpperCase() + word.slice(1)
                : word
        )
        .join(" ");
}

const getComponentKeyFromPath = (path) => path.split("/").pop();

const MenuBar = ({ page="LiveView", activeComponent, onMenuClick, toolBarProps }) => {
    const [openMenu, setOpenMenu] = useState(null);
    const [checkedItems, setCheckedItems] = useState({
        "Show Gridlines": false,
        "Legend": true,
        "Menu Bar": true,
        "Coordinate": true,
        "Toolbar": true,
        "Hazard only": false,
        "All": true,
        "Radar": true,
        "Prism": true,
        "VWP": true,
    });

    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleCheck = (label) => {
        setCheckedItems(prev => ({ ...prev, [label]: !prev[label] }));
    };

    const handleItemClick = (item) => {
        if (item.children) return;

        if (item.type === 'checkbox') {
            toggleCheck(item.label);
            return;
        }

        if (item.key) {
            onMenuClick(item.key);
            setOpenMenu(null);
        } else {
            console.log(`Clicked ${item.label}`);
            setOpenMenu(null);
        }
    };

    const summaryChildren = radarMenuItems.map(item => ({
        label: toProperTitleCase(item.label),
        key: getComponentKeyFromPath(item.path)
    }));

    const homeKey = "LiveView";
    const reportKey = "Reports";

    const menuStructure = [
        {
            label: "File",
            children: [
                {
                    label: "Import",
                    children: [
                        { label: "DXF/DEM" },
                        { label: "CSV" },
                        { label: "Tif" }
                    ]
                },
                { label: "Export" },
                {
                    label: "Project",
                    children: [
                        { label: "All Sites" },
                        { label: "Telfer" },
                        { label: "Site A" }
                    ]
                }
            ]
        },
        { label: "Home", key: homeKey },
        {
            label: "Summary",
            children: summaryChildren
        },
        {
            label: "Report",
            children: [
                { label: "Report Collection", key: reportKey },
                { label: "Compose Report" }
            ]
        },
        {
            label: "Analysis",
            children: [
                { label: "Deformation Analysis", key: "DeformationAnalysis" },
                { label: "Custom Analysis", key: "CustomAnalysis" },
                {
                    label: "Data Cleansing",
                    children: [
                        { label: "PrismWatch" },
                        { label: "LumenTrace" }
                    ]
                },
                { label: "AI Summary", key: "AISummary" },
                { label: "Data Confidence Index" }
            ]
        },
        {
            label: "Filters",
            children: [
                { label: "Hazard only", type: "checkbox" },
                {
                    label: "Sensors",
                    children: [
                        { label: "All", type: "checkbox" },
                        { label: "Radar", type: "checkbox" },
                        { label: "Prism", type: "checkbox" },
                        { label: "VWP", type: "checkbox" }
                    ]
                },
                { label: "Hide All", type: "checkbox" }
            ]
        },
        {
            label: "Edit",
            children: [
                {
                    label: "Add",
                    children: [
                        { label: "Placemark" },
                        { label: "Data Layer" }
                    ]
                },
                { label: "Undo" },
                { label: "Redo" },
                { label: "Copy" },
                { label: "Paste" }
            ]
        },
        {
            label: "View",
            children: [
                { label: "Show Gridlines", type: "checkbox" },
                { label: "Basemap Settings" },
                {
                    label: "Show Map Tools",
                    children: [
                        { label: "Legend", type: "checkbox" },
                        { label: "Menu Bar", type: "checkbox" },
                        { label: "Coordinate", type: "checkbox" },
                        { label: "Toolbar", type: "checkbox" }
                    ]
                }
            ]
        },
        {
            label: "Tools",
            children: [
                { label: "Measurement" },
                {
                    label: "Selection",
                    children: [
                        { label: "Line" },
                        { label: "Rectangle" },
                        { label: "Polygon" },
                        { label: "Clear Selection" }
                    ]
                }
            ]
        },
        {
            label: "Help",
            children: [
                { label: "Keyboard Shortcuts" },
                { label: "Documentations" },
                { label: "Videos" },
                { label: "Community Platform" },
                { label: "Send Feedback" },
                { label: "About" }
            ]
        }
    ];

    const isSummaryActive = summaryChildren.some(child => child.key === activeComponent);
    const isReportActive = activeComponent === reportKey;
    const isAnalysisActive = ["DeformationAnalysis", "AISummary", "CustomAnalysis"].includes(activeComponent);
    const isHomeActive = activeComponent === homeKey || isAnalysisActive;

    const isActive = (topItem) => {
        if (topItem.label === "Home") return isHomeActive;
        if (topItem.label === "Summary") return isSummaryActive;
        if (topItem.label === "Report") return isReportActive;
        return false;
    };

    const visibleMenuStructure = menuStructure.filter(item => {
        if (isHomeActive) return true;
        const hiddenItems = ["Analysis", "Filters", "Edit", "View", "Tools"];
        return !hiddenItems.includes(item.label);
    });

    return (
        <div className="w-full bg-[var(--dtg-bg-card)] border-b border-[var(--dtg-border-dark)] text-[var(--dtg-text-primary)] text-sm select-none" ref={menuRef}>
            <div className="flex items-center px-2">
                {visibleMenuStructure.map((topItem, index) => (
                    <div key={index} className="relative group">
                        <button
                            className={`px-3 py-1.5 hover:bg-[var(--dtg-bg-hover)] rounded-sm transition-colors ${openMenu === index ? 'bg-[var(--dtg-bg-hover)]' : ''} ${isActive(topItem) ? 'text-teal-400 font-medium' : ''}`}
                            onClick={() => {
                                if (topItem.children) {
                                    setOpenMenu(openMenu === index ? null : index);
                                } else {
                                    handleItemClick(topItem);
                                }
                            }}
                            onMouseEnter={() => {
                                if (openMenu !== null && topItem.children) {
                                    setOpenMenu(index);
                                }
                            }}
                        >
                            {topItem.label}
                        </button>
                        {topItem.children && openMenu === index && (
                            <DropdownMenu items={topItem.children} parentActive={true} onItemClick={handleItemClick} checkedItems={checkedItems} />
                        )}
                    </div>
                ))}
            </div>
            {isHomeActive && toolBarProps && (
                <ToolBar {...toolBarProps} />
            )}
        </div>
    );
};

const DropdownMenu = ({ items, parentActive, onItemClick, checkedItems }) => {
    if (!parentActive) return null;

    return (
        <div className="absolute left-0 top-full min-w-[200px] bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-dark)] shadow-xl py-1 z-50">
            {items.map((item, idx) => (
                <MenuItem key={idx} item={item} onItemClick={onItemClick} checkedItems={checkedItems} />
            ))}
        </div>
    );
};

const MenuItem = ({ item, onItemClick, checkedItems }) => {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className="relative px-4 py-1.5 hover:bg-[var(--dtg-bg-hover)] cursor-pointer flex items-center justify-between group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={(e) => {
                if (!item.children) {
                    e.stopPropagation();
                    onItemClick(item);
                }
            }}
        >
            <div className="flex items-center gap-2">
                {item.type === 'checkbox' && (
                    <div className="w-4 flex justify-center">
                        {checkedItems[item.label] && <FiCheck size={14} className="text-teal-400" />}
                    </div>
                )}
                <span className={item.type === 'checkbox' ? "" : "ml-6"}>{item.label}</span>
            </div>
            {item.children && <FiChevronRight size={14} className="text-gray-400" />}

            {item.children && isHovered && (
                <div className="absolute left-full top-0 min-w-[200px] bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-dark)] shadow-xl py-1 z-50">
                    {item.children.map((subItem, subIdx) => (
                        <MenuItem key={subIdx} item={subItem} onItemClick={onItemClick} checkedItems={checkedItems} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default MenuBar;
