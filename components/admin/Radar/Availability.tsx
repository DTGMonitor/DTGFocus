import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Legend, Cell
} from 'recharts';
import {
  Activity, TrendingUp, Clock, Zap, AlertCircle, CheckCircle2,
  Download, Calendar
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/LandingPage/ui/select";
import { Progress } from "@/components/LandingPage/ui/progress";
import { Button } from "@/components/LandingPage/ui/button";

const uptimeData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  SSR01: 95 + Math.random() * 5,
  SSR02: 92 + Math.random() * 6,
  IBIS01: 94 + Math.random() * 5,
  PS2000: 91 + Math.random() * 7,
}));

const downtimeByReasonData = [
  { reason: 'Scheduled Maintenance', hours: 24, color: '#14b8a6' },
  { reason: 'Power Outage', hours: 18, color: '#f97316' },
  { reason: 'Network Issues', hours: 12, color: '#ef4444' },
  { reason: 'Hardware Failure', hours: 8, color: '#8b5cf6' },
  { reason: 'Software Update', hours: 6, color: '#f59e0b' },
  { reason: 'Weather Conditions', hours: 4, color: '#06b6d4' },
];

const radarAvailability = [
  {
    radar: 'SSR01',
    uptime: 99.3,
    totalHours: 720,
    downtime: 5,
    incidents: 3,
    mtbf: 240, // Mean Time Between Failures (hours)
    mttr: 1.7, // Mean Time To Repair (hours)
  },
  {
    radar: 'SSR02',
    uptime: 97.8,
    totalHours: 720,
    downtime: 16,
    incidents: 7,
    mtbf: 103,
    mttr: 2.3,
  },
  {
    radar: 'IBIS01',
    uptime: 98.5,
    totalHours: 720,
    downtime: 11,
    incidents: 5,
    mtbf: 144,
    mttr: 2.2,
  },
  {
    radar: 'PS2000',
    uptime: 96.9,
    totalHours: 720,
    downtime: 22,
    incidents: 9,
    mtbf: 80,
    mttr: 2.4,
  },
];

function Availability() {
  const [timeRange, setTimeRange] = useState('30days');

  const getUptimeColor = (uptime: number) => {
    if (uptime >= 99) return 'text-green-500';
    if (uptime >= 95) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getUptimeStatus = (uptime: number) => {
    if (uptime >= 99) return { label: 'Excellent', color: 'bg-green-500' };
    if (uptime >= 95) return { label: 'Good', color: 'bg-yellow-500' };
    return { label: 'Needs Attention', color: 'bg-red-500' };
  };

  const avgUptime = radarAvailability.reduce((acc, r) => acc + r.uptime, 0) / radarAvailability.length;
  const totalDowntime = radarAvailability.reduce((acc, r) => acc + r.downtime, 0);
  const totalIncidents = radarAvailability.reduce((acc, r) => acc + r.incidents, 0);
  const avgMTBF = radarAvailability.reduce((acc, r) => acc + r.mtbf, 0) / radarAvailability.length;

  return (
    <div className="p-6 space-y-6 bg-[var(--dtg-bg-primary)] min-h-full">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--dtg-text-primary)]">System Availability Summary</h1>
          <p className="text-[var(--dtg-gray-500)] text-sm mt-1">System uptime, downtime analysis, and reliability metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
              <SelectItem value="90days">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="orange">
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Average Uptime</span>
            <Activity className="w-5 h-5 text-[#14b8a6]" />
          </div>
          <div className={`text-3xl ${getUptimeColor(avgUptime)}`}>
            {avgUptime.toFixed(2)}%
          </div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-500">+0.3% vs last period</span>
          </div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Total Downtime</span>
            <Clock className="w-5 h-5 text-[#f97316]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">{totalDowntime}h</div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-sm text-[var(--dtg-gray-500)]">Across all systems</span>
          </div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Total Incidents</span>
            <AlertCircle className="w-5 h-5 text-[#ef4444]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">{totalIncidents}</div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-sm text-[var(--dtg-gray-500)]">Last 30 days</span>
          </div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Avg MTBF</span>
            <Zap className="w-5 h-5 text-[#8b5cf6]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">{avgMTBF.toFixed(0)}h</div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-500">Improving</span>
          </div>
        </div>
      </div>

      {/* Uptime Trends */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">30-Day Uptime Trends (%)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={uptimeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
            <XAxis dataKey="day" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" domain={[85, 100]} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
              labelStyle={{ color: '#fff' }}
            />
            <Legend />
            <Line type="monotone" dataKey="SSR01" stroke="#14b8a6" strokeWidth={2} />
            <Line type="monotone" dataKey="SSR02" stroke="#f97316" strokeWidth={2} />
            <Line type="monotone" dataKey="IBIS01" stroke="#8b5cf6" strokeWidth={2} />
            <Line type="monotone" dataKey="PS2000" stroke="#f59e0b" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Downtime by Reason */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Downtime by Reason</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={downtimeByReasonData} layout="horizontal">
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis type="number" stroke="#9ca3af" />
              <YAxis type="category" dataKey="reason" stroke="#9ca3af" width={140} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="hours" radius={[0, 8, 8, 0]}>
                {downtimeByReasonData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* System Health Status */}
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">System Health Status</h3>
          <div className="space-y-4">
            {radarAvailability.map((radar) => {
              const status = getUptimeStatus(radar.uptime);
              return (
                <div key={radar.radar} className="bg-[var(--dtg-bg-primary)] rounded-lg p-4 border border-[var(--dtg-border-medium)]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${status.color}`} />
                      <span className="text-[var(--dtg-text-primary)]">{radar.radar}</span>
                    </div>
                    <span className={`text-xl ${getUptimeColor(radar.uptime)}`}>
                      {radar.uptime.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={radar.uptime} className="h-2 bg-[var(--dtg-bg-card)] mb-2" />
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-[var(--dtg-gray-500)]">Downtime: </span>
                      <span className="text-[var(--dtg-text-primary)]">{radar.downtime}h</span>
                    </div>
                    <div>
                      <span className="text-[var(--dtg-gray-500)]">MTBF: </span>
                      <span className="text-[var(--dtg-text-primary)]">{radar.mtbf}h</span>
                    </div>
                    <div>
                      <span className="text-[var(--dtg-gray-500)]">MTTR: </span>
                      <span className="text-[var(--dtg-text-primary)]">{radar.mttr}h</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detailed Availability Table */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Detailed Availability Metrics</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--dtg-border-medium)]">
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Radar System</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Uptime %</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Total Hours</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Downtime (h)</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Incidents</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">MTBF (h)</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">MTTR (h)</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Status</th>
              </tr>
            </thead>
            <tbody>
              {radarAvailability.map((radar) => {
                const status = getUptimeStatus(radar.uptime);
                return (
                  <tr key={radar.radar} className="border-b border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-primary)] transition-colors">
                    <td className="py-3 px-4 text-[var(--dtg-text-primary)]">{radar.radar}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xl ${getUptimeColor(radar.uptime)}`}>
                        {radar.uptime.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[var(--dtg-gray-600)]">{radar.totalHours}</td>
                    <td className="py-3 px-4 text-[var(--dtg-gray-600)]">{radar.downtime}</td>
                    <td className="py-3 px-4 text-[var(--dtg-gray-600)]">{radar.incidents}</td>
                    <td className="py-3 px-4 text-[var(--dtg-gray-600)]">{radar.mtbf}</td>
                    <td className="py-3 px-4 text-[var(--dtg-gray-600)]">{radar.mttr}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {radar.uptime >= 99 ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-yellow-500" />
                        )}
                        <span className="text-sm text-[var(--dtg-gray-600)]">{status.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Maintenance Schedule */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg text-[var(--dtg-text-primary)]">Upcoming Maintenance Schedule</h3>
          <Calendar className="w-5 h-5 text-[#14b8a6]" />
        </div>
        <div className="space-y-3">
          {[
            { radar: 'SSR01', type: 'Preventive Maintenance', date: 'Nov 5, 2024', duration: '4 hours' },
            { radar: 'IBIS01', type: 'Firmware Update', date: 'Nov 8, 2024', duration: '2 hours' },
            { radar: 'PS2000', type: 'Calibration Check', date: 'Nov 12, 2024', duration: '3 hours' },
          ].map((maintenance, index) => (
            <div key={index} className="flex items-center justify-between p-4 bg-[var(--dtg-bg-primary)] rounded-lg border border-[var(--dtg-border-medium)]">
              <div className="flex items-center gap-4">
                <div className="w-2 h-2 bg-[#14b8a6] rounded-full" />
                <div>
                  <div className="text-[var(--dtg-text-primary)]">{maintenance.radar}</div>
                  <div className="text-[var(--dtg-gray-500)] text-sm">{maintenance.type}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[var(--dtg-text-primary)]">{maintenance.date}</div>
                <div className="text-[var(--dtg-gray-500)] text-sm">{maintenance.duration}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


export default Availability;
