import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Tooltip, Legend } from 'recharts';
import { AlertTriangle, TrendingDown, Activity, CheckCircle, XCircle } from 'lucide-react';

const alarmsByRadarData = [
  { name: 'SSR01', value: 462, color: '#14b8a6' },
  { name: 'SSR02', value: 261, color: '#f97316' },
  { name: 'IBIS01', value: 78, color: '#8b5cf6' },
  { name: 'PS2000', value: 381, color: '#f59e0b' },
];

const alarmCausesData = [
  { name: 'Machinery Activity', value: 35, color: '#f97316' },
  { name: 'Vegetation', value: 15, color: '#ef4444' },
  { name: 'Atmospheric', value: 20, color: '#8b5cf6' },
  { name: 'Sandstorm', value: 8, color: '#14b8a6' },
  { name: 'Diurnal', value: 12, color: '#f59e0b' },
  { name: 'Blasting', value: 5, color: '#ec4899' },
  { name: 'Link Down', value: 3, color: '#6b7280' },
  { name: 'Water', value: 2, color: '#3b82f6' },
];

const alarmTrendsData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  count: Math.floor(Math.random() * 50) + 20,
}));

export function AlarmReportPreview() {
  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Executive Summary</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-[var(--dtg-bg-card)] border border-red-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Total</span>
            </div>
            <p className="text-3xl text-[var(--dtg-text-primary)]">1,182</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">Alarm Events</p>
          </div>
          <div className="bg-[var(--dtg-bg-card)] border border-orange-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-6 h-6 text-orange-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Critical</span>
            </div>
            <p className="text-3xl text-[var(--dtg-text-primary)]">47</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">High Priority</p>
          </div>
          <div className="bg-[var(--dtg-bg-card)] border border-green-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-6 h-6 text-green-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Resolved</span>
            </div>
            <p className="text-3xl text-[var(--dtg-text-primary)]">98.2%</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">Resolution Rate</p>
          </div>
          <div className="bg-[var(--dtg-bg-card)] border border-teal-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingDown className="w-6 h-6 text-teal-500" />
              <span className="text-sm text-[var(--dtg-gray-500)]">Trend</span>
            </div>
            <p className="text-3xl text-green-500">-8.2%</p>
            <p className="text-xs text-[var(--dtg-gray-500)] mt-1">vs Last Period</p>
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
              <p className="text-[var(--dtg-text-primary)]">Overall alarm frequency decreased by 8.2% compared to the previous reporting period</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Indicating improved system stability and operational efficiency</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-orange-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">SSR01 recorded the highest alarm count with 462 events</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Primarily attributed to machinery activity and environmental factors</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">Machinery activity remains the leading cause at 35% of total alarms</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Followed by atmospheric changes (20%) and vegetation (15%)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Alarms by Radar System</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={alarmsByRadarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="value" fill="#14b8a6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Alarm Causes Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={alarmCausesData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {alarmCausesData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', fontSize: '12px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 30-Day Trend */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">30-Day Alarm Trends</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={alarmTrendsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
            <XAxis dataKey="day" stroke="#9ca3af" tick={{ fontSize: 12 }} />
            <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
              labelStyle={{ color: '#fff' }}
            />
            <Line type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
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
              <p className="text-[var(--dtg-text-primary)]">Continue monitoring SSR01 closely due to elevated alarm frequency</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Consider adjusting sensitivity thresholds or investigating environmental factors</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">2</span>
            </div>
            <div>
              <p className="text-[var(--dtg-text-primary)]">Implement enhanced vegetation management protocols</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Vegetation accounts for 15% of alarms and can be proactively addressed</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">3</span>
            </div>
            <div>
              <p className="text-[var(--dtg-text-primary)]">Maintain current response time standards</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Average response time of 4.2 minutes demonstrates excellent operational readiness</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
