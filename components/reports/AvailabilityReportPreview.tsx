import React from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { Activity, Clock, AlertCircle, Zap, CheckCircle2 } from 'lucide-react';
import { Progress } from "@/components/LandingPage/ui/progress";

const uptimeData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  uptime: 95 + Math.random() * 5,
}));

const downtimeByReasonData = [
  { reason: 'Scheduled Maintenance', hours: 24, color: '#14b8a6' },
  { reason: 'Power Outage', hours: 18, color: '#f97316' },
  { reason: 'Network Issues', hours: 12, color: '#ef4444' },
  { reason: 'Hardware Failure', hours: 8, color: '#8b5cf6' },
  { reason: 'Software Update', hours: 6, color: '#f59e0b' },
];

const radarAvailability = [
  { radar: 'SSR01', uptime: 99.3, downtime: 5, mtbf: 240, mttr: 1.7 },
  { radar: 'SSR02', uptime: 97.8, downtime: 16, mtbf: 103, mttr: 2.3 },
  { radar: 'IBIS01', uptime: 98.5, downtime: 11, mtbf: 144, mttr: 2.2 },
  { radar: 'PS2000', uptime: 96.9, downtime: 22, mtbf: 80, mttr: 2.4 },
];

const getUptimeColor = (uptime: number) => {
  if (uptime >= 99) return 'text-green-500';
  if (uptime >= 95) return 'text-yellow-500';
  return 'text-red-500';
};

export function AvailabilityReportPreview() {
  const avgUptime = radarAvailability.reduce((acc, r) => acc + r.uptime, 0) / radarAvailability.length;
  const totalDowntime = radarAvailability.reduce((acc, r) => acc + r.downtime, 0);
  const avgMTBF = radarAvailability.reduce((acc, r) => acc + r.mtbf, 0) / radarAvailability.length;

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Executive Summary</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-[var(--dtg-bg-card)] border border-green-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-6 h-6 text-green-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Average</span>
            </div>
            <p className={`text-3xl ${getUptimeColor(avgUptime)}`}>{avgUptime.toFixed(2)}%</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">System Uptime</p>
          </div>
          <div className="bg-[var(--dtg-bg-card)] border border-orange-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-6 h-6 text-orange-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Total</span>
            </div>
            <p className="text-3xl text-[var(--dtg-text-primary)]">{totalDowntime}h</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">Downtime</p>
          </div>
          <div className="bg-[var(--dtg-bg-card)] border border-teal-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-6 h-6 text-teal-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">MTBF</span>
            </div>
            <p className="text-3xl text-[var(--dtg-text-primary)]">{avgMTBF.toFixed(0)}h</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">Avg MTBF</p>
          </div>
          <div className="bg-[var(--dtg-bg-card)] border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-6 h-6 text-blue-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Status</span>
            </div>
            <p className="text-2xl text-green-500">Excellent</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">Performance</p>
          </div>
        </div>
      </div>

      {/* Key Findings */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Key Findings</h2>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">SSR01 achieved exceptional 99.3% uptime</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Demonstrating industry-leading reliability with minimal downtime of only 5 hours</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">Average uptime across all systems is 98.1%</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Exceeding the operational target of 95% uptime</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">Scheduled maintenance accounted for 33% of total downtime</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Planned maintenance windows effectively minimized unplanned outages</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">30-Day Uptime Trends</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={uptimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="day" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis stroke="#9ca3af" domain={[90, 100]} tick={{ fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Line type="monotone" dataKey="uptime" stroke="#14b8a6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Downtime by Reason</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={downtimeByReasonData} layout="horizontal">
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis type="number" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="reason" stroke="#9ca3af" width={120} tick={{ fontSize: 11 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="hours" radius={[0, 6, 6, 0]}>
                {downtimeByReasonData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* System Health Status */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">System Health Status</h2>
        <div className="grid grid-cols-2 gap-4">
          {radarAvailability.map((radar) => (
            <div key={radar.radar} className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${radar.uptime >= 99 ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-[var(--dtg-text-primary)]">{radar.radar}</span>
                </div>
                <span className={`text-xl ${getUptimeColor(radar.uptime)}`}>
                  {radar.uptime.toFixed(1)}%
                </span>
              </div>
              <Progress value={radar.uptime} className="h-2 bg-[var(--dtg-bg-primary)] mb-3" />
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
          ))}
        </div>
      </div>

      {/* Detailed Metrics Table */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Detailed Availability Metrics</h2>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--dtg-bg-primary)]">
              <tr>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Radar System</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Uptime %</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Downtime (h)</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">MTBF (h)</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">MTTR (h)</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Status</th>
              </tr>
            </thead>
            <tbody>
              {radarAvailability.map((radar) => (
                <tr key={radar.radar} className="border-t border-[var(--dtg-border-medium)]">
                  <td className="py-3 px-4 text-[var(--dtg-text-primary)]">{radar.radar}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xl ${getUptimeColor(radar.uptime)}`}>
                      {radar.uptime.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{radar.downtime}</td>
                  <td className="py-3 px-4 text-gray-300">{radar.mtbf}</td>
                  <td className="py-3 px-4 text-gray-300">{radar.mttr}</td>
                  <td className="py-3 px-4">
                    {radar.uptime >= 99 ? (
                      <span className="px-3 py-1 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
                        Excellent
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                        Good
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommendations */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Recommendations</h2>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">1</span>
            </div>
            <div>
              <p className="text-[var(--dtg-text-primary)]">Implement predictive maintenance for PS2000</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Lower MTBF (80h) suggests increased failure frequency requiring proactive intervention</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">2</span>
            </div>
            <div>
              <p className="text-[var(--dtg-text-primary)]">Continue best practices from SSR01 across all systems</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Apply successful maintenance and operational procedures to improve overall fleet performance</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
