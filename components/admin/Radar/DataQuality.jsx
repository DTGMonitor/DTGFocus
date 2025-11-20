import React, { useState } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  LineChart, Line, Tooltip, Legend
} from 'recharts';
import {
  Database, Camera, Scan, Shield, Eye, Settings, CheckCircle,
  AlertTriangle, XCircle, Download, TrendingUp
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/LandingPage/ui/select";
import { Progress } from "@/components/LandingPage/ui/progress";
import { Button } from "@/components/LandingPage/ui/button";
import { getQualityColor, getQualityStatus } from "@/config/statusConfig";

const radarQualityData = [
  {
    radar: 'SSR01',
    System: 96,
    'Scan Area': 95,
    Photograph: 93,
    Masks: 98,
    Alarms: 92,
    Correction: 94,
    'Visual Data': 90,
    overall: 94
  },
  {
    radar: 'SSR02',
    System: 89,
    'Scan Area': 88,
    Photograph: 91,
    Masks: 87,
    Alarms: 86,
    Correction: 90,
    'Visual Data': 88,
    overall: 88
  },
  {
    radar: 'IBIS01',
    System: 93,
    'Scan Area': 92,
    Photograph: 94,
    Masks: 95,
    Alarms: 90,
    Correction: 91,
    'Visual Data': 89,
    overall: 92
  },
  {
    radar: 'PS2000',
    System: 91,
    'Scan Area': 90,
    Photograph: 89,
    Masks: 92,
    Alarms: 88,
    Correction: 93,
    'Visual Data': 87,
    overall: 90
  }
];

const qualityTrendData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  SSR01: 92 + Math.floor(Math.random() * 8),
  SSR02: 85 + Math.floor(Math.random() * 8),
  IBIS01: 88 + Math.floor(Math.random() * 8),
  PS2000: 87 + Math.floor(Math.random() * 8),
}));

const qualityCategories = [
  { category: 'System', icon: Database, weight: 20, score: 92 },
  { category: 'Scan Area', icon: Scan, weight: 15, score: 91 },
  { category: 'Photograph', icon: Camera, weight: 15, score: 92 },
  { category: 'Masks', icon: Shield, weight: 10, score: 93 },
  { category: 'Alarms', icon: AlertTriangle, weight: 15, score: 89 },
  { category: 'Correction', icon: Settings, weight: 15, score: 92 },
  { category: 'Visual Data', icon: Eye, weight: 10, score: 89 }
];

function DataQuality() {
  const [selectedRadar, setSelectedRadar] = useState('all');
  const [timeRange, setTimeRange] = useState('30days');

  return (
    <div className="p-6 space-y-6 bg-[var(--dtg-bg-primary)] min-h-full">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--dtg-text-primary)]">Data Quality Summary</h1>
          <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Comprehensive data quality metrics and analysis</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedRadar} onValueChange={setSelectedRadar}>
            <SelectTrigger className="w-48 bg-[var(--dtg-bg-card] border-[var(--dtg-border-medium] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card] border-[var(--dtg-border-medium] text-[var(--dtg-text-primary)]">
              <SelectItem value="all">All Radars</SelectItem>
              <SelectItem value="SSR01">SSR01</SelectItem>
              <SelectItem value="SSR02">SSR02</SelectItem>
              <SelectItem value="IBIS01">IBIS01</SelectItem>
              <SelectItem value="PS2000">PS2000</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40 bg-[var(--dtg-bg-card] border-[var(--dtg-border-medium] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card] border-[var(--dtg-border-medium] text-[var(--dtg-text-primary)]">
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

      {/* Overall Quality Score */}
      <div className="bg-gradient-to-br from-[#14b8a6]/20 to-[#f97316]/20 border border-[var(--dtg-border-medium] rounded-lg p-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[var(--dtg-gray-500)] mb-2">Overall Data Quality Score</h2>
            <div className="flex items-baseline gap-3">
              <span className="text-6xl text-[var(--dtg-text-primary)]">91</span>
              <span className="text-2xl text-[var(--dtg-gray-500)]">/ 100</span>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <TrendingUp className="w-5 h-5 text-green-500" />
              <span className="text-green-500">+2.3% improvement this month</span>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-6 h-6 text-green-500" />
              <span className="text-xl text-[var(--dtg-text-primary)]">Excellent</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-end gap-2">
                <span className="text-[var(--dtg-gray-500)]">4 Radars Online</span>
                <div className="w-2 h-2 bg-green-500 rounded-full" />
              </div>
              <div className="flex items-center justify-end gap-2">
                <span className="text-[var(--dtg-gray-500)]">Uptime: 99.7%</span>
                <CheckCircle className="w-4 h-4 text-green-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quality Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {qualityCategories.map((category) => {
          const Icon = category.icon;
          const status = getQualityStatus(category.score);
          return (
            <div key={category.category} className="bg-[var(--dtg-bg-card] border border-[var(--dtg-border-medium] rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <Icon className="w-5 h-5 text-[#14b8a6]" />
                <span className="text-xs text-[var(--dtg-gray-500)]">Weight: {category.weight}%</span>
              </div>
              <div className="mb-2">
                <div className="text-sm text-[var(--dtg-gray-500)]">{category.category}</div>
                <div className={`text-2xl ${getQualityColor(category.score)}`}>
                  {category.score}%
                </div>
              </div>
              <Progress value={category.score} className="h-2 bg-[var(--dtg-bg-primary)]" />
              <div className={`mt-2 text-xs px-2 py-1 rounded-full inline-block ${status.color}`}>
                {status.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Radar Quality Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Quality Chart */}
        <div className="bg-[var(--dtg-bg-card] border border-[var(--dtg-border-medium] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Quality by Radar System</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={radarQualityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="radar" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="overall" fill="#14b8a6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Multi-dimensional Quality */}
        <div className="bg-[var(--dtg-bg-card] border border-[var(--dtg-border-medium] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Multi-dimensional Quality Analysis</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={[radarQualityData[0]]}>
              <PolarGrid stroke="#3a3a3a" />
              <PolarAngleAxis dataKey="radar" tick={{ fill: '#9ca3af' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#9ca3af' }} />
              <Radar name="System" dataKey="System" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.6} />
              <Radar name="Scan Area" dataKey="Scan Area" stroke="#f97316" fill="#f97316" fillOpacity={0.6} />
              <Radar name="Photograph" dataKey="Photograph" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
              />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Quality Trends */}
        <div className="bg-[var(--dtg-bg-card] border border-[var(--dtg-border-medium] rounded-lg p-6 lg:col-span-2">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">30-Day Quality Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={qualityTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="day" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" domain={[70, 100]} />
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
      </div>

      {/* Detailed Radar Status */}
      <div className="bg-[var(--dtg-bg-card] border border-[var(--dtg-border-medium] rounded-lg p-6">
        <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Detailed Radar Status</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--dtg-border-medium]">
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Radar</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">System</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Scan Area</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Photograph</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Masks</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Alarms</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Overall</th>
              </tr>
            </thead>
            <tbody>
              {radarQualityData.map((radar) => (
                <tr key={radar.radar} className="border-b border-[var(--dtg-border-medium] hover:bg-[var(--dtg-bg-primary)] transition-colors">
                  <td className="py-3 px-4 text-[var(--dtg-text-primary)]">{radar.radar}</td>
                  <td className="py-3 px-4">
                    <span className={getQualityColor(radar.System)}>{radar.System}%</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={getQualityColor(radar['Scan Area'])}>{radar['Scan Area']}%</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={getQualityColor(radar.Photograph)}>{radar.Photograph}%</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={getQualityColor(radar.Masks)}>{radar.Masks}%</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={getQualityColor(radar.Alarms)}>{radar.Alarms}%</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-xl ${getQualityColor(radar.overall)}`}>{radar.overall}%</span>
                      {radar.overall >= 90 ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : radar.overall >= 75 ? (
                        <AlertTriangle className="w-5 h-5 text-yellow-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


export default DataQuality;
