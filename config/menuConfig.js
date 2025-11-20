// src/config/menuConfig.js
export const radarMenuItems = [
  { label: "LIVE RADAR", path: "/tools/:client/RadarStatusHub", icon: "CgMediaLive" },
  { label: "ALARM SUMMARY", path: "/tools/:client/AlarmSummaryPage", icon: "BsAlarm" },
  { label: "AVAILABILITY SUMMARY", path: "/tools/:client/AvailabilitySummaryPage", icon: "SlSpeedometer" },
  { label: "DATA QUALITY SUMMARY", path: "/tools/:client/DataQualitySummaryPage", icon: "PiPresentationChart" },
];

export const insarMenuItems = [
  { label: "WATER BODY", path: "/tools/:client/WB_insar", icon: "FaArrowUpFromGroundWater" },
];

export const adminMenuItems = [
  { label: "RADAR MONITORING", path: "/admin/Radar/RadarMonitoring", icon: "LuClock4" },
  { label: "NOTIFICATIONS", path: "/admin/Radar/Notifications", icon: "FaRegBell" },
  { label: "ALARM SUMMARY", path: "/admin/Radar/AlarmSummary", icon: "PiWarning" },
  { label: "DATA QUALITY", path: "/admin/Radar/DataQuality", icon: "PiPulse" },
  { label: "AVAILABILITY", path: "/admin/Radar/Availability", icon: "FiTrendingUp" },
  { label: "REPORTS", path: "/admin/Radar/Reports", icon: "HiOutlineDocumentChartBar" }
];

export const weatherIcons = [
  { label: "Not available", icon: "WiNa" },
  { label: "Sunny", icon: "MdSunny" },
  { label: "Clear", icon: "MdSunny" },
  { label: "Mostly sunny", icon: "MdWbSunny" },
  { label: "Partly sunny", icon: "WiDaySunnyOvercast" },
  { label: "Mostly cloudy", icon: "WiCloudy" },
  { label: "Cloudy", icon: "WiCloud" },
  { label: "Overcast", icon: "WiCloudyGusts" },
  { label: "Overcast with low clouds", icon: "WiCloudyWindy" },
  { label: "Fog", icon: "WiFog" },
  { label: "Light rain", icon: "WiSprinkle" },
  { label: "Rain", icon: "WiRain" },
  { label: "Possible rain", icon: "WiRaindrops" },
  { label: "Rain shower", icon: "WiShowers" },
  { label: "Thunderstorm", icon: "WiThunderstorm" },
  { label: "Local thunderstorms", icon: "WiStormShowers" },
  { label: "Light snow", icon: "WiSnow" },
  { label: "Snow", icon: "WiSnowflakeCold" },
  { label: "Possible snow", icon: "WiSnowWind" },
  { label: "Snow shower", icon: "WiSnow" },
  { label: "Rain and snow", icon: "WiRainMix" },
  { label: "Possible rain and snow", icon: "WiRaindrops" },
  { label: "Rain and snow", icon: "WiRainMix" },
  { label: "Freezing rain", icon: "WiRainMix" },
  { label: "Possible freezing rain", icon: "WiRaindrops" },
  { label: "Hail", icon: "WiHail" },
  { label: "Clear (night)", icon: "WiNightClear" },
  { label: "Mostly clear (night)", icon: "WiNightAltClear" },
  { label: "Partly clear (night)", icon: "WiNightAltPartlyCloudy" },
  { label: "Mostly cloudy (night)", icon: "WiNightAltCloudy" },
  { label: "Cloudy (night)", icon: "WiNightAltCloudyHigh" },
  { label: "Overcast with low clouds (night)", icon: "WiNightAltCloudyWindy" },
  { label: "Rain shower (night)", icon: "WiNightAltShowers" },
  { label: "Local thunderstorms (night)", icon: "WiNightAltThunderstorm" },
  { label: "Snow shower (night)", icon: "WiNightAltSnow" },
  { label: "Rain and snow (night)", icon: "WiNightAltRainMix" },
  { label: "Possible freezing rain (night)", icon: "WiNightAltSleet" },
];


