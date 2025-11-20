
import React, { useState } from "react";
import { getRiskColor, getStatusColor, getQualityColor } from "@/config/statusConfig";
import { CheckCircle, XCircle, AlertTriangle, Activity, Clock, Mail, Download, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { Checkbox } from "@/components/LandingPage/ui/checkbox";
import { Button } from "@/components/LandingPage/ui/button";

interface SensorData {
  ssr: string;
  siteName: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  status: 'Operational' | 'Link Down' | 'Warning';
  dataQuality: number; // 0-100
  hourlyChecks: boolean[];
}

const mockSensorData: SensorData[] = [
  {
    ssr: 'SSR-01',
    siteName: 'North Wall',
    riskLevel: 'Medium',
    status: 'Operational',
    dataQuality: 98,
    hourlyChecks: [true, true, true, true, true, true, true, true, true, true, true, true],
  },
  {
    ssr: 'SSR-02',
    siteName: 'East Slope',
    riskLevel: 'High',
    status: 'Warning',
    dataQuality: 87,
    hourlyChecks: [true, true, true, true, true, true, true, true, true, true, false, false],
  },
  {
    ssr: 'SSR-03',
    siteName: 'West Pit',
    riskLevel: 'Low',
    status: 'Operational',
    dataQuality: 96,
    hourlyChecks: [true, true, true, true, true, true, true, true, true, true, true, true],
  },
  {
    ssr: 'IBIS01',
    siteName: 'South Bench',
    riskLevel: 'Medium',
    status: 'Link Down',
    dataQuality: 45,
    hourlyChecks: [true, true, true, true, false, false, false, false, false, false, false, false],
  },
  {
    ssr: 'PS2000',
    siteName: 'Central Area',
    riskLevel: 'Medium',
    status: 'Operational',
    dataQuality: 94,
    hourlyChecks: [true, true, true, true, true, true, true, true, true, true, true, true],
  },
];

const hoursDS = ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'];
const hoursNS = ['19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06'];
const hoursC = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'];

function RadarMonitoring() {
  const [sensorData, setSensorData] = useState(mockSensorData);
  const toggleHourlyCheck = (ssrIndex: number, hourIndex: number) => {
    setSensorData((prev) =>
      prev.map((sensor, sIdx) => {
        if (sIdx !== ssrIndex) return sensor;

        return {
          ...sensor,
          hourlyChecks: sensor.hourlyChecks.map((checked, hIdx) =>
            hIdx === hourIndex ? !checked : checked
          ),
        };
      })
    );
  };

  const totalAlarms = 2;
  const totalEvents = 5;
  const onlineDevices = sensorData.filter(s => s.status !== 'Link Down').length;
  const totalDevices = sensorData.length;
  const avgQuality = Math.round(sensorData.reduce((acc, s) => acc + s.dataQuality, 0) / sensorData.length);

  return (
    <div className="w-full space-y-4 pt-4">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--dtg-text-primary)]">SSR Monitoring & Hourly Checklist</h1>
          <p className="text-[var(--dtg-gray-700)] text-sm">Real-time sensor verification - {new Date().toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button size="sm" variant="orange">
            <Mail className="w-4 h-4 mr-2" />
            Email PDF
          </Button>
          <Button size="sm" variant="brand">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Compact KPI Cards */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--dtg-gray-700)] text-xs mb-1">Total Alarms</p>
              <p className="text-3xl text-[var(--dtg-text-primary)]">{totalAlarms}</p>
            </div>
            <AlertTriangle className="w-10 h-10 text-red-500/30" />
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--dtg-gray-700)] text-xs mb-1">Events</p>
              <p className="text-3xl text-[var(--dtg-text-primary)]">{totalEvents}</p>
            </div>
            <Activity className="w-10 h-10 text-blue-500/30" />
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--dtg-gray-700)] text-xs mb-1">Online</p>
              <p className="text-3xl text-[var(--dtg-text-primary)]">{onlineDevices}/{totalDevices}</p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-500/30" />
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--dtg-gray-700)] text-xs mb-1">Avg Quality</p>
              <p className={`text-3xl ${getQualityColor(avgQuality)}`}>{avgQuality}%</p>
            </div>
            <TrendingUp className="w-10 h-10 text-teal-500/30" />
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--dtg-gray-700)] text-xs mb-1">Last Update</p>
              <p className="text-lg text-[var(--dtg-text-primary)]">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <Clock className="w-10 h-10 text-purple-500/30" />
          </div>
        </div>
      </div>

      {/* Unified Compact Table */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--dtg-bg-primary)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-[var(--dtg-gray-700)] sticky left-0 bg-[var(--dtg-bg-primary)] z-10 border-r border-[var(--dtg-border-medium)]">SSR</th>
                <th className="px-3 py-2 text-left text-xs text-[var(--dtg-gray-700)] min-w-[120px]">Site Name</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)]">Risk</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)]">Status</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)]">Quality</th>
                <th className="px-3 py-2 text-center text-xs text-[var(--dtg-gray-700)] border-l border-b border-[var(--dtg-border-medium)]" colSpan={12}>Hourly Verification (Last 12 Hours)</th>
              </tr>
              <tr className="bg-[var(--dtg-bg-primary)]">
                <th className="border-r border-[var(--dtg-border-medium)]" />
                <th colSpan={4}></th>
                {hoursDS.map((hour) => (
                  <th key={hour} className="px-2 py-1 text-center text-[10px] text-[var(--dtg-gray-500)] border-l border-[var(--dtg-border-medium)]">
                    {hour}:00
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sensorData.map((sensor, sensorIdx) => (
                <tr key={sensor.ssr} className="border-t border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-hover)]/50 transition-colors">
                  <td className="px-3 py-3 text-[var(--dtg-text-primary)] sticky left-0 bg-[var(--dtg-bg-card)] z-10 border-r border-[var(--dtg-border-medium)]">
                    <span className="font-mono">{sensor.ssr}</span>
                  </td>
                  <td className="px-3 py-3 text-[var(--dtg-text-secondary)] text-sm">{sensor.siteName}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs border ${getRiskColor(sensor.riskLevel)}`}>
                      {sensor.riskLevel}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(sensor.status)}`}>
                      {sensor.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-sm ${getQualityColor(sensor.dataQuality)}`}>
                      {sensor.dataQuality}%
                    </span>
                  </td>
                  {sensor.hourlyChecks.map((checked, hourIdx) => (
                    <td key={hourIdx} className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)]">
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleHourlyCheck(sensorIdx, hourIdx)}
                          className={`w-5 h-5 ${checked
                            ? 'bg-green-500/20 border-green-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500'
                            : 'border-gray-600 hover:border-gray-500'
                            }`}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Stats Footer */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Completed Checks</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">{sensorData.reduce((acc, s) => acc + s.hourlyChecks.filter(Boolean).length, 0)}</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Missed Checks</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">{sensorData.reduce((acc, s) => acc + s.hourlyChecks.filter(c => !c).length, 0)}</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-teal-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Completion Rate</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">
                {Math.round((sensorData.reduce((acc, s) => acc + s.hourlyChecks.filter(Boolean).length, 0) / (sensorData.length * 12)) * 100)}%
              </p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-gray-700)]">Attention Required</p>
              <p className="text-xl text-[var(--dtg-text-primary)]">{sensorData.filter(s => s.status !== 'Operational').length}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RadarMonitoring;
