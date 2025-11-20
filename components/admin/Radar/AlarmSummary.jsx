import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Tooltip, Legend } from 'recharts';
import { AlertTriangle, TrendingDown, TrendingUp, Activity, Download, Filter } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/LandingPage/ui/select';
import { Badge } from '@/components/LandingPage/ui/badge';
import {Button} from '@/components/LandingPage/ui/button';

const alarmsByRadarData = [
  { name: 'SSR01', value: 462, color: '#14b8a6' },
  { name: 'SSR02', value: 261, color: '#14b8a6' },
  { name: 'SSR03', value: 78, color: '#14b8a6' },
  { name: 'IBIS01', value: 381, color: '#14b8a6' },
];

const alarmCausesData = [
  { name: 'Machinery Activity', value: 35, color: '#f97316' },
  { name: 'Vegetation', value: 15, color: '#ef4444' },
  { name: 'Atmospheric Changes', value: 20, color: '#8b5cf6' },
  { name: 'Sandstorm Event', value: 8, color: '#14b8a6' },
  { name: 'Diurnal Pattern', value: 12, color: '#f59e0b' },
  { name: 'Blasting Activity', value: 5, color: '#ec4899' },
  { name: 'Link Down', value: 3, color: '#6b7280' },
  { name: 'Water Refraction', value: 2, color: '#3b82f6' },
];

const alarmTrendsData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  SSR01: Math.floor(Math.random() * 50) + 20,
  SSR02: Math.floor(Math.random() * 40) + 15,
  SSR03: Math.floor(Math.random() * 30) + 10,
  IBIS01: Math.floor(Math.random() * 60) + 25,
}));

function AlarmSummary() {

const [timeRange, setTimeRange] = useState('30days');

  return (
    <div className="p-6 space-y-6 bg-[var(--dtg-bg-primary)] min-h-full">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--dtg-text-primary)]">Alarm Summary Report</h1>
          <p className="text-[var(--dtg-gray-700)] text-sm mt-1">Comprehensive alarm analysis and trends</p>
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
            <span className="text-[var(--dtg-gray-700)] text-sm">Total Alarms</span>
            <AlertTriangle className="w-5 h-5 text-[#f97316]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">1,182</div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingDown className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-500">-8.2% vs last period</span>
          </div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-700)] text-sm">Critical Alarms</span>
            <Activity className="w-5 h-5 text-[#ef4444]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">47</div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="w-4 h-4 text-red-500" />
            <span className="text-sm text-red-500">+3.1% vs last period</span>
          </div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-700)] text-sm">Avg Response Time</span>
            <Activity className="w-5 h-5 text-[#14b8a6]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">4.2m</div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingDown className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-500">-12% faster</span>
          </div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-700)] text-sm">False Positives</span>
            <Filter className="w-5 h-5 text-[#8b5cf6]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">8.3%</div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingDown className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-500">-2.1% improvement</span>
          </div>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alarms by Radar */}
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Alarms by Radar System</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={alarmsByRadarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="value" fill="#14b8a6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Alarm Causes Distribution */}
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Alarm Causes Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={alarmCausesData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {alarmCausesData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Alarm Trends */}
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6 lg:col-span-2">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">30-Day Alarm Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={alarmTrendsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="day" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Legend />
              <Line type="monotone" dataKey="SSR01" stroke="#14b8a6" strokeWidth={2} />
              <Line type="monotone" dataKey="SSR02" stroke="#f97316" strokeWidth={2} />
              <Line type="monotone" dataKey="SSR03" stroke="#8b5cf6" strokeWidth={2} />
              <Line type="monotone" dataKey="IBIS01" stroke="#f59e0b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Critical Alarms */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Recent Critical Alarms</h3>
        <div className="space-y-3">
          {[
            { radar: 'SSR01', cause: 'Rapid Deformation', time: '2 hours ago', severity: 'critical' },
            { radar: 'IBIS01', cause: 'Blasting Activity', time: '5 hours ago', severity: 'high' },
            { radar: 'SSR02', cause: 'Machinery Movement', time: '8 hours ago', severity: 'medium' },
          ].map((alarm, index) => (
            <div key={index} className="flex items-center justify-between p-4 bg-[var(--dtg-bg-primary)] rounded-lg border border-[var(--dtg-border-medium)]">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${
                  alarm.severity === 'critical' ? 'bg-red-500' :
                  alarm.severity === 'high' ? 'bg-orange-500' : 'bg-yellow-500'
                }`} />
                <div>
                  <div className="text-[var(--dtg-text-primary)]">{alarm.radar}</div>
                  <div className="text-[var(--dtg-gray-700)] text-sm">{alarm.cause}</div>
                </div>
              </div>
              <div className="text-right">
                <Badge variant="outline" className={`${
                  alarm.severity === 'critical' ? 'border-red-500 text-red-500' :
                  alarm.severity === 'high' ? 'border-orange-500 text-orange-500' : 'border-yellow-500 text-yellow-500'
                }`}>
                  {alarm.severity.toUpperCase()}
                </Badge>
                <div className="text-[var(--dtg-gray-700)] text-sm mt-1">{alarm.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


export default AlarmSummary;
