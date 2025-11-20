import React, { useEffect, useState, useCallback } from "react";
import Papa from "papaparse";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Label,
    ResponsiveContainer,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Radar,
    Legend
} from "recharts";
import LogoSection from '@/components/Reusable/HeaderComponents/LogoSection';
import { formatInTimeZone } from 'date-fns-tz';
import DatePicker from "react-datepicker";
import { FaCloud } from "react-icons/fa";
import { WiDirectionUp, WiThermometer } from "react-icons/wi";
import { LuDroplets, LuWind } from "react-icons/lu";
import { IoMdRefresh } from "react-icons/io";
import { useUserSite } from "@/components/Reusable/useUserSite";
import { getIconComponent } from "@/components/Reusable/IconMapper";
import { weatherIcons } from "@/config/menuConfig";
import { supabase } from "@/lib/supabaseClient";

const BASE_URL = "/api/point";
const HISTORICAL_BASE_URL = "/api/historical";


function formatDate(date) {
    if (!date) return null;
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

function getTotal(numbers) {
    return numbers.reduce((acc, curr) => acc + curr, 0)
};

function getAverage(numbers) {
    if (numbers.length === 0) {
        return 0;
    }

    const total = getTotal(numbers);
    return total / numbers.length;
};

function getHighest(numbers) {
    if (numbers.length === 0) {
        return 0;
    }

    return Math.max(...numbers);
};

function getLowest(numbers) {
    if (numbers.length === 0) {
        return 0;
    }

    return Math.min(...numbers);
};

function degreeToCompass(deg) {
    const directions = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
    ];

    const val = Math.floor((deg / 22.5) + 0.5);
    return directions[val % 16];
};

function speedToBin(speedMps) {
    if (speedMps == null) return 'Calm';

    // No conversion needed, just bin the value
    if (speedMps <= 0.5) return 'Calm';
    if (speedMps <= 5) return '1-5 m/s';
    if (speedMps <= 10) return '6-10 m/s';
    if (speedMps <= 15) return '11-15 m/s';
    return '> 15 m/s';
};

function processWindRoseData(hourlyData) {
    // 1. Define all 16 directions and all speed bins
    const directions = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ];
    const speedBins = ['Calm', '1-5 m/s', '6-10 m/s', '11-15 m/s', '> 15 m/s'];

    // 2. Create a frequency map
    const freqMap = {};
    directions.forEach(dir => {
        freqMap[dir] = {};
        speedBins.forEach(bin => {
            freqMap[dir][bin] = 0; // Initialize all counts to 0
        });
    });

    // 3. Count every single hourly observation
    hourlyData.forEach(row => {
        if (row.WindDirection != null && row.WindSpeed != null) {
            const dir = degreeToCompass(row.WindDirection);
            const bin = speedToBin(row.WindSpeed);

            if (freqMap[dir] && freqMap[dir][bin] !== undefined) {
                freqMap[dir][bin]++;
            }
        }
    });

    // 4. Convert the map to the array structure Recharts needs
    // e.g., { direction: "N", "1-5 m/s": 10, "6-10 m/s": 5, ... }
    const totalObservations = hourlyData.length;
    const chartData = directions.map(dir => {
        const entry = { direction: dir };
        let totalForDir = 0;

        speedBins.forEach(bin => {
            const count = freqMap[dir][bin];
            // Store as percentage frequency
            entry[bin] = (count / totalObservations) * 100;
            totalForDir += count;
        });

        // You might also want a "total" percentage for that direction
        entry.total = (totalForDir / totalObservations) * 100;
        return entry;
    });

    return chartData;
}

function Rainfall() {
    const { user, userSite } = useUserSite();
    const isAdmin = userSite?.role === "admin";

    const [hourlyData, setHourlyData] = useState([]);
    const [rawData, setRawData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [windRoseData, setWindRoseData] = useState([]);
    const [selectedDate, setSelectedDate] = useState(() => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
    }
    );
    const [endDate, setEndDate] = useState(new Date());
    const [siteOptions, setSiteOptions] = useState([]);
    const [selectedSite, setSelectedSite] = useState(null);
    const [summary, setSummary] = useState({
        overall: "",
        precipitation: 0,
        windspeed: 0,
        windangle: 0,
        temperature: 0,
        cloudcover: 0,
    });


    // 🔹 Fetch all sites from Supabase
    useEffect(() => {
        async function fetchSites() {
            const { data, error } = await supabase.from("clients").select("*");
            if (error) {
                console.error("❌ Failed to fetch sites:", error);
                return;
            }

            setSiteOptions(data || []);

            if (data?.length > 0) {
                const defaultSite = isAdmin
                    ? data[0]
                    : data.find((s) => s.id === userSite?.site?.id);
                setSelectedSite(defaultSite || data[0]);
            }
        }

        fetchSites();
    }, [isAdmin, userSite?.site?.id]);

    // 🔹 Fetch weather for selected site (Meteosource)
    const getAllWeather = useCallback(async () => {
        if (!selectedSite?.place_id) return;

        try {
            const placeId = selectedSite.place_id;
            const response = await fetch(`${BASE_URL}?place_id=${placeId}&units=metric`);

            if (!response.ok) throw new Error("Failed to fetch weather data");

            const siteWeather = await response.json();

            if (siteWeather?.current) {
                setSummary({
                    overall: siteWeather.current.summary,
                    precipitation: siteWeather.current.precipitation.total,
                    windspeed: siteWeather.current.wind.speed,
                    windangle: siteWeather.current.wind.angle,
                    temperature: siteWeather.current.temperature,
                    cloudcover: siteWeather.current.cloud_cover,
                });
            }
        } catch (error) {
            console.error("❌ Failed to get current weather:", error);
        }
    }, [selectedSite]);

    // 🔹 Fetch historical weather for selected site and date (from Meteostat)
    const getHistoricalWeather = useCallback(async () => {
        setIsLoading(true);

        const lat = selectedSite?.latitude;
        const lon = selectedSite?.longitude;
        const timezone = selectedSite?.timezone;
        const dateStr = formatDate(selectedDate);
        const endDateStr = formatDate(endDate);

        if (!lat || !lon || !timezone || !dateStr || !endDateStr) {
            console.warn("Skipping Meteostat fetch: Missing site data.");
            setHourlyData([]);
            setWindRoseData([]);
            setIsLoading(false);
            return;
        }

        try {
            const url = `${HISTORICAL_BASE_URL}?lat=${lat}&lon=${lon}&start=${dateStr}&end=${endDateStr}&timezone=${timezone}&units=metric`;
            const response = await fetch(url);

            if (!response.ok) throw new Error("Failed to fetch Meteostat data");

            const data = await response.json();

            if (data.data) {
                const now = new Date();
                const cutoffTime = new Date(now.getTime() - (6 * 60 * 60 * 1000));

                // ✅ --- FIX THIS BLOCK --- ✅
                const confirmedData = data.data.filter(row => {
                    // Treat the API string as UTC by appending 'Z'
                    const rowTimeAsUtc = new Date(row.time + "Z");
                    return rowTimeAsUtc <= cutoffTime;
                });

                // 1️⃣ Parse data
                // 🔹 MODIFIED: Handle null/undefined values during parsing
                const parsedData = confirmedData.map(row => ({
                    Date: row.time,
                    Rainfall: row.prcp || 0,
                    Temperature: row.temp,
                    Humidity: row.rhum,

                    // --- ⬇️ THIS IS THE CHANGE ⬇️ ---
                    // Convert from km/h to m/s immediately
                    WindSpeed: row.wspd != null ? row.wspd / 3.6 : null,

                    WindDirection: row.wdir
                }));

                const roseData = processWindRoseData(parsedData);
                setWindRoseData(roseData);

                const rawHourlyTableData = [...parsedData].sort((a, b) =>
                    new Date(b.Date) - new Date(a.Date)
                );

                setRawData(rawHourlyTableData);

                // 2️⃣ Compute date difference
                const diffDays = Math.ceil(
                    (new Date(endDateStr) - new Date(dateStr)) / (1000 * 60 * 60 * 24)
                );

                let aggregated = [];

                // 3️⃣ Conditional aggregation
                if (diffDays <= 7) {
                    // 🔹 Keep hourly
                    aggregated = parsedData;

                } else if (diffDays <= 61) {
                    // 🔹 MODIFIED: Daily aggregation for ALL metrics
                    const dailyMap = {};

                    parsedData.forEach((row) => {
                        const dayKey = row.Date.slice(0, 10);
                        if (!dailyMap[dayKey]) {
                            dailyMap[dayKey] = {
                                RainfallSum: 0,
                                TempSum: 0, TempCount: 0,
                                HumiditySum: 0, HumidityCount: 0,
                                WindSpeedSum: 0, WindSpeedCount: 0,
                            };
                        }

                        const stats = dailyMap[dayKey];

                        // Rainfall is always summed
                        stats.RainfallSum += row.Rainfall; // We know this is 0 or a number

                        // For averages, we only add if the data exists
                        if (row.Temperature !== null && row.Temperature !== undefined) {
                            stats.TempSum += row.Temperature;
                            stats.TempCount += 1;
                        }
                        if (row.Humidity !== null && row.Humidity !== undefined) {
                            stats.HumiditySum += row.Humidity;
                            stats.HumidityCount += 1;
                        }
                        if (row.WindSpeed !== null && row.WindSpeed !== undefined) {
                            stats.WindSpeedSum += row.WindSpeed;
                            stats.WindSpeedCount += 1;
                        }
                    });

                    // Now, convert the map to an array, calculating the averages
                    aggregated = Object.entries(dailyMap).map(([day, stats]) => ({
                        Date: day,
                        Rainfall: stats.RainfallSum,
                        Temperature: stats.TempCount > 0 ? (stats.TempSum / stats.TempCount) : null,
                        Humidity: stats.HumidityCount > 0 ? (stats.HumiditySum / stats.HumidityCount) : null,
                        WindSpeed: stats.WindSpeedCount > 0 ? (stats.WindSpeedSum / stats.WindSpeedCount) : null,
                    }));

                } else {
                    // 🔹 MODIFIED: Monthly aggregation for ALL metrics
                    const monthMap = {};

                    parsedData.forEach((row) => {
                        const monthKey = row.Date.slice(0, 7);
                        if (!monthMap[monthKey]) {
                            monthMap[monthKey] = {
                                RainfallSum: 0,
                                TempSum: 0, TempCount: 0,
                                HumiditySum: 0, HumidityCount: 0,
                                WindSpeedSum: 0, WindSpeedCount: 0,
                            };
                        }

                        const stats = monthMap[monthKey];

                        stats.RainfallSum += row.Rainfall;

                        if (row.Temperature !== null && row.Temperature !== undefined) {
                            stats.TempSum += row.Temperature;
                            stats.TempCount += 1;
                        }
                        if (row.Humidity !== null && row.Humidity !== undefined) {
                            stats.HumiditySum += row.Humidity;
                            stats.HumidityCount += 1;
                        }
                        if (row.WindSpeed !== null && row.WindSpeed !== undefined) {
                            stats.WindSpeedSum += row.WindSpeed;
                            stats.WindSpeedCount += 1;
                        }
                    });

                    // Convert map to array, calculating averages
                    aggregated = Object.entries(monthMap).map(([month, stats]) => ({
                        Date: month,
                        Rainfall: stats.RainfallSum,
                        Temperature: stats.TempCount > 0 ? (stats.TempSum / stats.TempCount) : null,
                        Humidity: stats.HumidityCount > 0 ? (stats.HumiditySum / stats.HumidityCount) : null,
                        WindSpeed: stats.WindSpeedCount > 0 ? (stats.WindSpeedSum / stats.WindSpeedCount) : null,
                    }));
                }

                // 4️⃣ Update state
                setHourlyData(aggregated);
                console.log(`✅ Aggregated to ${diffDays <= 7 ? "hourly" : diffDays <= 61 ? "daily" : "monthly"} data:`, aggregated);

            } else {
                setHourlyData([]);
            }

        } catch (error) {
            console.error("❌ Failed to get Meteostat historical weather:", error);
            setHourlyData([]);
            setWindRoseData([]);
        } finally {
            setIsLoading(false);
        }
    }, [selectedSite, selectedDate, endDate]);

    // 🔹 Fetch weather (Meteosource)
    useEffect(() => {
        getAllWeather();
    }, [getAllWeather]); // 👈 Now just depends on the memoized function

    // 🔹 Fetch historical weather (Meteostat)
    useEffect(() => {
        getHistoricalWeather();
    }, [getHistoricalWeather]); // 👈 Now just depends on the memoized function


    // --- Step 3: Add the Refresh Handler ---
    const handleRefresh = () => {
        console.log("🔄 Refreshing all data...");
        // Manually call both functions
        getAllWeather();
        getHistoricalWeather();
    };

    // 🔹 Map overall summary to icon
    const overallSummary = weatherIcons.find(
        (item) => item.label.toLowerCase() === summary.overall?.toLowerCase()
    );
    const IconComp = getIconComponent(overallSummary?.icon);

    // ... inside your Rainfall component ...

    const formatTick = (tickItem) => {
        const timezone = selectedSite?.timezone || 'UTC';

        try {
            // 'tickItem' is "2025-11-02 03:00:00" (from the API, which is UTC)

            // 1. Create a Date object, explicitly telling it the string is UTC
            const date = new Date(tickItem + "Z");

            // 2. Now, format that UTC date into the site's timezone
            // This will correctly shift the time by +8 hours
            if (tickItem.length === 7) { // Monthly "YYYY-MM"
                return formatInTimeZone(date, timezone, "MMM yyyy");
            }
            if (tickItem.length === 10) { // Daily "YYYY-MM-DD"
                return formatInTimeZone(date, timezone, "MM-dd");
            }
            // Hourly "yyyy-MM-dd HH:mm:ss"
            return formatInTimeZone(date, timezone, "MM-dd HH:mm");
        } catch {
            return tickItem; // Fallback
        }
    };

    // ... rest of your component

    //Summary Cards
    const rainfallData = hourlyData.map(item => item.Rainfall || 0);
    const temperatureData = hourlyData
        .map(item => item.Temperature)
        .filter(temp => temp != null);
    const totalRainfall = getTotal(rainfallData);
    const averageRainfall = getAverage(rainfallData);
    const highestRainfall = getHighest(rainfallData);
    const lowestRainfall = getLowest(rainfallData);
    const averageTemperature = getAverage(temperatureData);
    const highestTemperature = getHighest(temperatureData);
    const lowestTemperature = getLowest(temperatureData);


    // 🔽 ADD THESE HANDLERS 🔽
    const handleStartDateChange = (date) => {
        if (date > endDate) {
            setEndDate(date);
        }
        setSelectedDate(date);
    };

    const handleEndDateChange = (date) => {
        if (date < selectedDate) {
            setSelectedDate(date);
        }
        setEndDate(date);
    };
    // 🔼 (End Handlers) 🔼


    const handleExport = () => {
        // 1. Create a new array with formatted data for the CSV
        const exportData = rawData.map(row => ({
            // Use formatTick for the date, just like in the table
            "Date Time": formatTick(row.Date),

            // Format the numbers to match your table
            "Rainfall (mm)": typeof row.Rainfall === "number" ? row.Rainfall.toFixed(2) : "N/A",
            "Temperature (°C)": typeof row.Temperature === "number" ? row.Temperature.toFixed(2) : "N/A",
            "Humidity (%)": typeof row.Humidity === "number" ? row.Humidity.toFixed(2) : "N/A",
            "Wind Speed (m/s)": typeof row.WindSpeed === "number" ? row.WindSpeed.toFixed(2) : "N/A",
            "Wind Direction (°)": typeof row.WindDirection === "number" ? row.WindDirection.toFixed(0) : "N/A",
        }));

        // 2. Unparse the new, formatted array
        const csv = Papa.unparse(exportData);

        // 3. The rest of your download logic is perfect
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${selectedSite?.site_name}_raw_weather_data.csv`;
        link.click();
    };

    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload || !payload.length) return null;
        // Sort payload by value descending
        const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
        return (
            <div style={{
                backgroundColor: "#1B1B1B",
                border: "1px solid #5A6474",
                padding: "10px",
                borderRadius: "6px",
                color: "#f5f5f5",
                fontSize: "12px"
            }}>
                <p style={{ marginBottom: "6px" }}>{formatTick(label)}</p>
                {sortedPayload.map((entry, index) => (
                    <div key={index} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span>{entry.name}: {entry.value?.toFixed(2)}mm</span>
                    </div>
                ))}
            </div>
        );
    };

    const CustomWindTooltip = ({ active, payload, label }) => {
        if (!active || !payload || !payload.length) return null;
        // Sort payload by value descending
        const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
        return (
            <div style={{
                backgroundColor: "#1B1B1B",
                border: "1px solid #5A6474",
                padding: "10px",
                borderRadius: "6px",
                color: "#f5f5f5",
                fontSize: "12px"
            }}>
                <p style={{ marginBottom: "6px" }}>{label}</p>
                {sortedPayload.map((entry, index) => (
                    <div key={index} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span>{entry.name}: {entry.value?.toFixed(0)}%</span>
                    </div>
                ))}
            </div>
        );
    };

    const speedBins = ['1-5 m/s', '6-10 m/s', '11-15 m/s', '> 15 m/s'];
    // You can assign colors to them
    const speedBinColors = ['rgba(0, 238, 255, 1)', 'rgba(133, 239, 133, 1)', '#ffc658', 'rgba(242, 76, 76, 1)'];

    // 🔹 Styles (same as yours, omitted for brevity)
    const cardStyle = {
        flex: "1",
        backgroundColor: "#1B1B1B",
        borderRadius: "10px",
        padding: "10px 20px",
        color: "#f5f5ff",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
    };

    return (
        <div
            style={{
                width: "100vw",
                height: "100vh",
                boxSizing: "border-box",
                backgroundColor: "#050910",
                color: "#f5f5f5",
                fontFamily: "Inter, sans-serif",
                display: "flex",
                flexDirection: "column",
                padding: "10px",
                gap: "10px",
            }}
        >
            {/* Header */}
            <div style={{ flexShrink: 0 }}>
                <LogoSection Subtitle="Rainfall Data" />
                <div
                    style={{
                        height: "4px",
                        borderRadius: "20px",
                        background: "linear-gradient(to bottom, #1E1E1E, #3A3A3A)",
                    }}
                />
            </div>

            <div style={{ display: "flex", gap: "10px", height: "100%" }}>
                {/* LEFT: Chart and table */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={cardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <h3>Rainfall Chart</h3>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
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
                                        selected={selectedDate}
                                        onChange={(date) => {
                                            handleStartDateChange(date); // ◀️ UPDATE THIS
                                        }}
                                        placeholderText="Start Date"
                                        // --- OPTIMIZATION 7 ---
                                        // Disable the date picker while the API is fetching
                                        // to prevent spamming your API quota.
                                        disabled={isLoading}
                                        // --- (End Optimization) ---
                                        customInput={
                                            <input
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    padding: "8px 10px",
                                                    borderRadius: "6px",
                                                    backgroundColor: "#14B8A6",
                                                    color: "#fff",
                                                    boxSizing: "border-box",
                                                    border: "1px solid #09403D",
                                                    // --- OPTIMIZATION 8 ---
                                                    // Visually show it's disabled
                                                    cursor: isLoading ? "not-allowed" : "pointer",
                                                    opacity: isLoading ? 0.6 : 1,
                                                    // --- (End Optimization) ---
                                                }}
                                            />
                                        }
                                    />
                                    {/* 🔽 ADD THIS NEW DATEPICKER 🔽 */}
                                    <span style={{ color: "#888" }}>-</span>
                                    <DatePicker
                                        selected={endDate}
                                        onChange={(date) => {
                                            handleEndDateChange(date);
                                        }}
                                        placeholderText="End Date"
                                        disabled={isLoading}
                                        customInput={
                                            <input
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    padding: "8px 10px",
                                                    borderRadius: "6px",
                                                    backgroundColor: "#14B8A6",
                                                    color: "#fff",
                                                    boxSizing: "border-box",
                                                    border: "1px solid #09403D",
                                                    cursor: isLoading ? "not-allowed" : "pointer",
                                                    opacity: isLoading ? 0.6 : 1,
                                                }}
                                            />
                                        }
                                    />
                                </div>
                                <button
                                    onClick={handleRefresh}
                                    disabled={isLoading}
                                    style={{
                                        borderRadius: "6px",
                                        backgroundColor: "#0e574fff",
                                        color: "#fff",
                                        border: "1px solid #09403D",
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#14B8A6"}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#0e574fff"}
                                >
                                    {isLoading ? "Refreshing..." : <IoMdRefresh />}
                                </button>
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                            {/* --- OPTIMIZATION 5 --- */}
                            {/* Check loading state and hourlyData length */}
                            {isLoading ? (
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>
                                    Loading historical data...
                                </div>
                            ) : hourlyData.length === 0 ? (
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>
                                    No data available for this date.
                                </div>
                            ) : (
                                <BarChart data={hourlyData}>
                                    {/* Point the BarChart to `hourlyData` */}
                                    {/* --- (End Optimization) --- */}
                                    <CartesianGrid stroke="#444" strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="Date" // This now maps to `row.time` from the API
                                        tick={{ fontSize: 12 }}
                                        tickFormatter={formatTick}
                                        angle={-45}
                                        textAnchor="end"
                                        height={60}
                                    />
                                    <YAxis stroke="#ccc" fontSize={12}>
                                        <Label
                                            value="Rainfall (mm)"
                                            angle={-90}
                                            position="insideLeft"
                                            dy={30}
                                            style={{ fill: "#ccc", fontSize: "12px" }}
                                        />
                                    </YAxis>
                                    <Tooltip content={CustomTooltip} />
                                    <Bar dataKey="Rainfall" fill="url(#colorGradient)" radius={[4, 4, 0, 0]} />
                                    <defs>
                                        <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#21D0EB" />
                                            <stop offset="100%" stopColor="#0A95B6" />
                                        </linearGradient>
                                    </defs>
                                </BarChart>
                            )}
                        </ResponsiveContainer>
                    </div>

                    {/* Raw data table + export */}
                    <div style={cardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", maxHeight: "30px", alignItems: "center", paddingTop: 10 }}>
                            <h3>Raw Hourly Data Table</h3>
                            <button
                                onClick={handleExport}
                                style={{
                                    backgroundColor: "#14B8A6",
                                    border: "none",
                                    borderRadius: "5px",
                                    padding: "6px 12px",
                                    color: "white",
                                    fontSize: "12px"
                                }}
                            >
                                Export CSV
                            </button>
                        </div>
                        <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                            <table style={{ width: "100%", fontSize: "13px", color: "#ddd" }}>
                                <thead>
                                    <tr>
                                        <th>Date, Time (UTC+8)</th>
                                        <th style={{ textAlign: "right" }}>Rainfall (mm)</th>
                                        <th style={{ textAlign: "right" }}>Temperature (°C)</th>
                                        <th style={{ textAlign: "right" }}>Relative Humidity (%)</th>
                                        <th style={{ textAlign: "right" }}>Wind Speed (m/s)</th>
                                        <th style={{ textAlign: "right" }}>Wind Direction</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* --- OPTIMIZATION 6 --- */}
                                    {/* Point the table map to `hourlyData` */}
                                    {rawData.map((row) => (
                                        <tr key={row.Date}>
                                            <td>{formatTick(row.Date)}</td>
                                            <td style={{ textAlign: "right" }}>
                                                {/* The field is already named `Rainfall` thanks to our transform */}
                                                {typeof row.Rainfall === "number"
                                                    ? row.Rainfall.toFixed(2)
                                                    : "N/A"}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {/* The field is already named `Temperature` thanks to our transform */}
                                                {typeof row.Temperature === "number"
                                                    ? row.Temperature.toFixed(2)
                                                    : "N/A"}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {/* The field is already named `Humidity` thanks to our transform */}
                                                {typeof row.Humidity === "number"
                                                    ? row.Humidity.toFixed(2)
                                                    : "N/A"}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {/* The field is already named `WindSpeed` thanks to our transform */}
                                                {typeof row.WindSpeed === "number"
                                                    ? row.WindSpeed.toFixed(2)
                                                    : "N/A"}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {/* The field is already named `WindDirection` thanks to our transform */}
                                                {typeof row.WindDirection === "number"
                                                    ? row.WindDirection.toFixed(2)
                                                    : "N/A"}
                                            </td>
                                        </tr>
                                    ))}
                                    {/* --- (End Optimization) --- */}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Weather summary and filters */}
                <div style={{ flex: "0 0 25%", maxWidth: "350px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            background: "linear-gradient(135deg, #0091B5 0%, #007971 100%)",
                            borderRadius: "10px",
                            padding: "16px"
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", flexDirection: "column" }}>
                            {/* Site Selector */}
                            <select
                                disabled={!isAdmin}
                                value={selectedSite?.id || ""}
                                onChange={(e) =>
                                    setSelectedSite(siteOptions.find((s) => s.id === Number(e.target.value)))
                                }
                                style={{
                                    background: "none",
                                    fontSize: "14px",
                                    border: "none",
                                    outline: "none",
                                    color: "#AFF7F2",
                                    borderRadius: "8px",
                                    cursor: isAdmin ? "pointer" : "not-allowed",
                                }}
                            >

                                {siteOptions.map((site) => (
                                    <option key={site.id} value={site.id}>
                                        {site.site_name}
                                    </option>
                                ))}
                            </select>
                            <p style={{ color: "#AFF7F2", fontSize: "14px", margin: "0 4px" }}>{selectedSite?.location}</p>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <p style={{ fontSize: "40px", margin: "10px 0" }}>
                                    {summary.temperature}°C
                                </p>
                                {IconComp ? (
                                    <IconComp size={80} />
                                ) : (
                                    <span className="text-gray-400 text-sm">No icon</span>
                                )}
                            </div>
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3,1fr)",
                                gap: 30,
                                borderTop: "1px solid rgba(0,224,217,0.3)",
                                paddingTop: 10,
                                justifyItems: "center"
                            }}
                        >
                            <div>
                                <LuWind style={{ color: "#AFF7F2" }} size={20} />
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <WiDirectionUp
                                        size={20}
                                        style={{ color: "#AFF7F2", transform: `rotate(${summary.windangle}deg)` }}
                                    />
                                    <p style={{ color: "#AFF7F2", fontSize: "14px", margin: 0 }}>{summary.windspeed}m/s</p>
                                </div>
                            </div>
                            <div>
                                <LuDroplets style={{ color: "#AFF7F2" }} size={20} />
                                <p style={{ color: "#AFF7F2", fontSize: "14px", margin: 0 }}>{summary.precipitation}mm</p>
                            </div>
                            <div>
                                <FaCloud style={{ color: "#AFF7F2" }} size={20} />
                                <p style={{ color: "#AFF7F2", fontSize: "14px", margin: 0 }}>{summary.cloudcover}%</p>
                            </div>
                        </div>
                    </div>
                    <div
                        style={{ ...cardStyle, flex: 0.4 }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                                <p style={{ color: "#fff", fontSize: "30px", margin: 0 }}>
                                    {totalRainfall.toFixed(1)}
                                    <span style={{ color: "#ccc" }}> mm</span>
                                </p>
                                <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Total Rainfall</p>
                            </div>
                            <div style={{ padding: "10px", borderRadius: "10px", background: "#032f2cff" }}>
                                <LuDroplets style={{ color: "#AFF7F2" }} size={50} />
                            </div>
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3,1fr)",
                                gap: 30,
                                justifyItems: "center",
                                marginTop: 10
                            }}
                        >
                            <div>
                                <p style={{ color: "#fff", fontWeight: "bold", fontSize: "16px", margin: 0 }}>{averageRainfall.toFixed(1)}</p>
                                <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Average</p>
                            </div>
                            <div>
                                <p style={{ color: "#fff", fontWeight: "bold", fontSize: "16px", margin: 0 }}>{highestRainfall.toFixed(1)}</p>
                                <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Highest</p>
                            </div>
                            <div>
                                <p style={{ color: "#fff", fontWeight: "bold", fontSize: "16px", margin: 0 }}>{lowestRainfall.toFixed(1)}</p>
                                <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Lowest</p>
                            </div>
                        </div>
                    </div>
                    <div
                        style={{ ...cardStyle, flex: 0.4, flexDirection: "row", alignItems: "center" }}
                    >

                        <div>
                            <p style={{ color: "#fff", fontSize: "30px", margin: 0 }}>
                                {averageTemperature.toFixed(1)}
                                <span style={{ color: "#ccc" }}> °C</span>
                            </p>
                            <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Average Temperature</p>
                        </div>
                        <div>
                            <div>
                                <p style={{ color: "#fff", fontWeight: "bold", fontSize: "16px", margin: 0 }}>{highestTemperature.toFixed(1)}</p>
                                <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Highest</p>
                            </div>
                            <div>
                                <p style={{ color: "#fff", fontWeight: "bold", fontSize: "16px", margin: 0 }}>{lowestTemperature.toFixed(1)}</p>
                                <p style={{ color: "#aaa", fontSize: "14px", margin: 0 }}>Lowest</p>
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", padding: "10px", borderRadius: "10px", background: "#0A3643" }}>
                            <WiThermometer style={{ color: "#00D3BD" }} size={50} />
                        </div>


                    </div>
                    <div
                        style={{ ...cardStyle, alignItems: "center" }}>
                        <p style={{ color: "#aaa", paddingTop: "10px", fontSize: "14px", margin: 0, alignSelf: "flex-start" }}>Wind Speed & Direction</p>
                        <ResponsiveContainer>
                            <RadarChart
                                cx="50%"
                                cy="50%"
                                outerRadius="90%"
                                data={windRoseData}
                            >
                                {/* Grid and angle labels (N, NE, E, SE, S, SW, W, NW) */}
                                <PolarGrid stroke="#393939" />
                                <PolarAngleAxis dataKey="direction" style={{ fontSize: "10px" }} />
                                {/* This axis shows the percentage (e.g., 0%, 5%, 10%) */}
                                <PolarRadiusAxis angle={45} domain={[0, 'auto']} style={{ fontSize: "12px" }} tickFormatter={(value) => `${value.toFixed(0)}%`} stroke="#aaa" />

                                {/* Create one "Radar" (layer) for each speed bin */}
                                {speedBins.map((bin, index) => (
                                    <Radar
                                        key={bin}
                                        name={bin}
                                        dataKey={bin}
                                        stackId="a" // This "stacks" the layers
                                        stroke={speedBinColors[index]}
                                        fill={speedBinColors[index]}
                                        fillOpacity={0.7}
                                    />
                                ))}
                                <Tooltip
                                    content={CustomWindTooltip}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                        <div style={{ display: "flex", gap: "5px", fontSize: "10px", color: "#aaa", justifyContent: "center", marginTop: 10 }}>
                            {speedBins.map((bin, index) => (
                                <div key={bin} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <div
                                        style={{
                                            width: 10,
                                            height: 10,
                                            backgroundColor: speedBinColors[index] || "#999",
                                        }}
                                    />
                                    <span>{bin}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Rainfall;