import React, { useState, useEffect } from "react";
import { FaFilter } from "react-icons/fa";
import Select from "react-select";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { DateTime } from "luxon";
import { supabase } from "@/lib/supabaseClient";

export default function FilterDropdown2({
    startDate,
    endDate,
    onApply,
    onCancel,
    onReset,
    anchorColor = "#073331",
    accentColor = "#14B8A6",
    iconColor = "#E97132",
    iconSize = 18,
}) {
    const [tmpStartDate, setTmpStartDate] = useState(startDate);
    const [tmpEndDate, setTmpEndDate] = useState(endDate);

    // selections
    const [site, setSite] = useState("All");
    const [area, setArea] = useState("All");
    const [brand, setBrand] = useState("All");
    const [radar, setRadar] = useState(["All Radars"]);

    // raw data
    const [allData, setAllData] = useState([]);

    // option lists
    const [siteOptions, setSiteOptions] = useState([]);


    // fetch once
    useEffect(() => {
        const fetchRadars = async () => {
            const { data, error } = await supabase
                .from("latest_radar_wall_folders")
                .select(`
            id,
            radar_number,
            site_name,
            brand,
          commenced_at,
          type,
          area
        `);

            if (error) {
                console.error("Error fetching radars:", error);
            } else {
                setAllData(data);

                setSiteOptions([
                    "All",
                    ...new Set(data.map((d) => d?.site_name).filter(Boolean)),
                ]);

            }
        };

        fetchRadars();
    }, []);

    // cascade filtering
    // Areas (always available, even if Site=All)
    const filteredAreas = [
        "All",
        ...Array.from(
            new Set(
                allData
                    .filter(
                        (d) =>
                            (site === "All" || d?.site_name === site)
                    )
                    .map((d) => d.area)
            )
        ).filter(Boolean),
    ];

    // Brands depend on Site + Area
    const filteredBrands = [
        "All",
        ...Array.from(
            new Set(
                allData
                    .filter(
                        (d) =>
                            (site === "All" || d?.site_name === site) &&
                            (area === "All" || d.area === area)
                    )
                    .map((d) => d?.brand)
            )
        ).filter(Boolean),
    ];

    // Radars depend on Site + Area + Brand
    // Compute filtered radars dynamically
    const filteredRadars = [
        "All Radars",
        ...Array.from(
            new Set(
                allData
                    .filter(
                        (d) =>
                            (site === "All" || d?.site_name === site) &&
                            (area === "All" || d.area === area) &&
                            (brand === "All" || d?.brand === brand)
                    )
                    .map((d) => d.radar_number)
            )
        ).filter(Boolean),
    ];

    // Ensure radar selection always valid
    const resolvedRadarSelection =
        radar.includes("All Radars") ? filteredRadars.slice(1) : radar;


    useEffect(() => {
        setTmpStartDate(startDate);
        setTmpEndDate(endDate);
    }, [startDate, endDate]);

    useEffect(() => {
        setRadar(radar);
    }, [radar]);

    // Reset Area, Brand, Radar when Site changes
    useEffect(() => {
        setArea("All");
        setBrand("All");
        setRadar(["All Radars"]);
    }, [site]);

    // Reset Brand, Radar when Area changes
    useEffect(() => {
        setBrand("All");
        setRadar(["All Radars"]);
    }, [area]);

    // Reset Radar when Brand changes
    useEffect(() => {
        setRadar(["All Radars"]);
    }, [brand]);


    // apply
    const handleApply = () => {
        const expandedRadar =
            radar.includes("All Radars") ? filteredRadars.slice(1) : radar;

        onApply?.({
            startDate: tmpStartDate,
            endDate: tmpEndDate,
            radar: expandedRadar,
        });
    };


    const handleCancel = () => {
        setTmpStartDate(startDate);
        setTmpEndDate(endDate);
        setRadar(radar);
        setArea("All");
        setBrand("All");
        setSite("All");
        onCancel?.();
    };

    const handleReset = () => {
        setTmpStartDate(DateTime.fromISO("2025-09-01", { zone: "utc" }).toJSDate());
        setTmpEndDate(DateTime.utc().endOf("day").toJSDate());
        setRadar(["All Radars"]);
        setSite("All");
        setArea("All");
        setBrand("All");
        onReset?.();
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                backgroundColor: anchorColor,
                padding: "16px",
                minWidth: 0,
                borderRadius: "10px",
                gap: 5
            }}
        >
            <div
                style={{
                    fontWeight: "bold",
                    color: "#f5f5f5",
                    fontSize: "18px",
                    gap: "10px",
                    display: "flex",
                    alignItems: "-moz-initial"
                }}
            >
                <FaFilter size={iconSize} color={iconColor} />
                ADVANCED FILTERING
            </div>

            {/* Date Picker */}
            <label style={{ display: "block", padding: "10px", border: "1px solid #0C7266", borderRadius: "10px" }}>
                <span style={{ display: "block", marginBottom: "4px", color: "#ccc", fontSize: "14px" }}>Period Selection</span>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        flexWrap: "nowrap",
                    }}
                >
                    {/* Calendar icon */}
                    <div style={{ flexShrink: 0 }}>
                        <img
                            src="/icons/Calendar.svg"
                            style={{
                                width: "30px",
                                height: "30px",
                                objectFit: "contain",
                            }}
                        />
                    </div>
                    {/* Date pickers */}
                    <div
                        style={{
                            display: "flex",
                            flex: 1,
                            gap: "10px",
                            minWidth: 0, // Ensures shrinking works
                            alignItems: "center",
                        }}
                    >
                        {/* Start Date */}
                        <DatePicker
                            selected={tmpStartDate}
                            maxDate={tmpEndDate}
                            onChange={(date) => {
                                setTmpStartDate(date);
                            }}
                            placeholderText="Start Date"
                            customInput={
                                <input
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        padding: "8px 10px",
                                        borderRadius: "6px",
                                        backgroundColor: "#09403D",
                                        color: "#fff",
                                        width: "100%",
                                        boxSizing: "border-box",
                                        border: "1px solid #09403D"
                                    }}
                                />
                            }
                        />
                        <p style={{ margin: 0, color: "#fff", fontWeight: "bold" }}>-</p>
                        {/* End Date */}
                        <DatePicker
                            selected={tmpEndDate}
                            minDate={tmpStartDate}
                            onChange={(date) => {
                                setTmpEndDate(date);
                            }}
                            placeholderText="End Date"
                            customInput={
                                <input
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        padding: "8px 10px",
                                        borderRadius: "6px",
                                        backgroundColor: "#09403D",
                                        color: "#fff",
                                        width: "100%",
                                        boxSizing: "border-box",
                                        border: "1px solid #09403D"
                                    }}
                                />
                            }
                        />
                    </div>
                </div>
            </label>

            {/* Site */}
            <label style={blockLabel}>
                <span style={labelSpan}>Site Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <img
                        src="/icons/Location.svg"
                        style={{
                            width: "35px",
                            height: "35px",
                            objectFit: "contain",
                        }} />
                    <div style={buttonGrid}>

                        {siteOptions.map((s) => (
                            <button
                                key={s}
                                onClick={() => setSite(s)}
                                style={btnStyle(site === s, accentColor)}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            </label>

            {/* Area */}
            <label style={blockLabel}>
                <span style={labelSpan}>Area Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}><img
                    src="/icons/Area.svg"
                    style={{
                        width: "35px",
                        height: "35px",
                        objectFit: "contain",
                    }} />
                    <div style={buttonGrid}>
                        {filteredAreas.map((a) => (
                            <button
                                key={a}
                                onClick={() => setArea(a)}
                                style={btnStyle(area === a, accentColor)}
                            >
                                {a}
                            </button>
                        ))}
                    </div>
                </div>
            </label>

            {/* Brand */}
            <label style={blockLabel}>
                <span style={labelSpan}>Radar Brand</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <img
                        src="/icons/Radar.svg"
                        style={{
                            width: "35px",
                            height: "35px",
                            objectFit: "contain",
                        }} />
                    <div style={buttonGrid}>
                        {filteredBrands.map((b) => (
                            <button
                                key={b}
                                onClick={() => setBrand(b)}
                                style={btnStyle(brand === b, accentColor)}
                            >
                                {b}
                            </button>
                        ))}
                    </div>
                </div>
            </label>

            {/* Radar */}
            <label style={blockLabel}>
                <span style={labelSpan}>Sensor Selection</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <img
                        src="/icons/Checklist.svg"
                        style={{
                            width: "30px",
                            height: "30px",
                            objectFit: "contain",
                        }} />
                    <Select
                        isMulti
                        options={filteredRadars.map((r) => ({ label: r, value: r }))}
                        value={radar.map((r) => ({ label: r, value: r }))}
                        onChange={(selected) => {
                            const selectedValues = selected.map((s) => s.value);

                            if (selectedValues.includes("All Radars")) {
                                // Show "All Radars" in UI, but store actual full radar list behind the scenes
                                setRadar(["All Radars"]);
                            } else {
                                setRadar(selectedValues);
                            }
                        }}
                        isSearchable
                        closeMenuOnSelect={false}
                        styles={reactSelectStyles}
                    />
                </div>
            </label>

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                    type="button"
                    onClick={handleReset}
                    style={smallBtnStyle({ bg: "#444", color: "#ccc" })}
                >
                    Reset
                </button>
                <button
                    type="button"
                    onClick={handleCancel}
                    style={smallBtnStyle({ bg: "#444", color: "#fff" })}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleApply}
                    style={smallBtnStyle({ bg: accentColor, color: "#fff", bold: true })}
                >
                    Apply
                </button>
            </div>
        </div>
    );
}

/* --- Styles --- */
const blockLabel = {
    display: "block",
    padding: "10px",
    border: "1px solid #0C7266",
    borderRadius: "10px",
};
const labelSpan = {
    display: "block",
    color: "#ccc",
    fontSize: "14px",
    marginBottom: "5px"
};
const buttonGrid = {
    display: "grid",
    flex: 1,
    gridTemplateColumns: "1fr 1fr",
    gap: "8px"
};
const btnStyle = (active, accentColor) => ({
    backgroundColor: active ? accentColor : "#08403D",
    color: active ? "#fff" : "#ccc",
    borderRadius: "6px",
    padding: "6px",
    fontSize: "12px",
    cursor: "pointer",
    border: "none",
});
const StyledInput = React.forwardRef((props, ref) => (
    <input
        {...props}
        ref={ref}
        style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: "6px",
            backgroundColor: "#09403D",
            color: "#fff",
            border: "1px solid #09403D",
        }}
    />
));
const smallBtnStyle = ({ bg, color, bold = false }) => ({
    padding: "4px 10px",
    borderRadius: "4px",
    border: "none",
    background: bg,
    color,
    fontSize: "12px",
    fontWeight: bold ? "bold" : "normal",
    cursor: "pointer",
});
const reactSelectStyles = {
    container: (base) => ({
        ...base,
        flex: 1,
    }),
    valueContainer: (base) => ({
        ...base,
        flexWrap: "wrap",
        padding: 0
    }),
    control: (base, state) => ({
        ...base,
        backgroundColor: state.isDisabled ? "#2f2f2f" : "#08403D", // ⬅ custom color when disabled
        border: "none", // ⬅ remove border
        borderRadius: "6px",
        boxShadow: "none",
        fontSize: "12px",
        color: "#fff",
        opacity: state.isDisabled ? 0.5 : 1, // ⬅ optionally dim
        cursor: state.isDisabled ? "not-allowed" : "default",
    }),
    multiValue: (styles) => ({
        ...styles,
        backgroundColor: "#14B8A6",
        color: "#fff",
    }),
    input: (base) => ({
        ...base,
        color: "#fff",
    }),
    menu: (base) => ({
        ...base,
        backgroundColor: "#1B1B1B",
        color: "#fff",
    }),
    option: (base, state) => ({
        ...base,
        backgroundColor: state.isFocused ? "#08403D" : "#1B1B1B",
        color: "#fff",
        cursor: "pointer",
    }),
};
