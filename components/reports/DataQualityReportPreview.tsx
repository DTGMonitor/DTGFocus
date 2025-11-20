import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { Database, Camera, Scan, Shield, CheckCircle, TrendingUp } from 'lucide-react';
import { Progress } from "@/components/LandingPage/ui/progress";

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

const qualityCategories = [
  { category: 'System', icon: Database, score: 92, weight: 20 },
  { category: 'Scan Area', icon: Scan, score: 91, weight: 15 },
  { category: 'Photograph', icon: Camera, score: 92, weight: 15 },
  { category: 'Masks', icon: Shield, score: 93, weight: 10 },
];

const getQualityColor = (score: number) => {
  if (score >= 90) return 'text-green-500';
  if (score >= 75) return 'text-yellow-500';
  return 'text-red-500';
};

export function DataQualityReportPreview() {
  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Executive Summary</h2>
        <div className="bg-gradient-to-br from-teal-500/20 to-blue-500/10 border border-teal-500/30 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--dtg-gray-500)] mb-2">Overall Data Quality Score</p>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl text-[var(--dtg-text-primary)]">91</span>
                <span className="text-2xl text-[var(--dtg-gray-500)]">/ 100</span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-green-500">+2.3% improvement this period</span>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-6 h-6 text-green-500" />
                <span className="text-xl text-[var(--dtg-text-primary)]">Excellent</span>
              </div>
              <div className="space-y-1 text-sm text-[var(--dtg-gray-500)]">
                <p>4 Radars Online</p>
                <p>Uptime: 99.7%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quality Categories */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Quality Categories</h2>
        <div className="grid grid-cols-4 gap-4">
          {qualityCategories.map((category) => {
            const Icon = category.icon;
            return (
              <div key={category.category} className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <Icon className="w-5 h-5 text-teal-400" />
                  <span className="text-xs text-[var(--dtg-gray-500)]">Weight: {category.weight}%</span>
                </div>
                <div className="mb-2">
                  <div className="text-sm text-[var(--dtg-gray-500)]">{category.category}</div>
                  <div className={`text-2xl ${getQualityColor(category.score)}`}>
                    {category.score}%
                  </div>
                </div>
                <Progress value={category.score} className="h-2 bg-[var(--dtg-bg-primary)]" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Key Findings */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Key Findings</h2>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">All radar systems maintain quality scores above 85%</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Exceeding the minimum operational threshold of 75%</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">SSR01 leads with 94% overall quality score</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Demonstrates excellent mask configuration and atmospheric correction</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2" />
            <div className="flex-1">
              <p className="text-[var(--dtg-text-primary)]">SSR02 shows slight decrease in scan area quality (88%)</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Requires attention to optimize coverage and reduce blind spots</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Quality by Radar System</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={radarQualityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="radar" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis stroke="#9ca3af" domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="overall" fill="#14b8a6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
          <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Multi-dimensional Analysis</h3>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={[radarQualityData[0]]}>
              <PolarGrid stroke="#3a3a3a" />
              <PolarAngleAxis dataKey="radar" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Radar name="System" dataKey="System" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.5} />
              <Radar name="Scan" dataKey="Scan Area" stroke="#f97316" fill="#f97316" fillOpacity={0.5} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', fontSize: '12px' }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Radar Status */}
      <div>
        <h2 className="text-xl text-[var(--dtg-text-primary)] mb-4 pb-2 border-b border-[var(--dtg-border-medium)]">Detailed Radar Status</h2>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--dtg-bg-primary)]">
              <tr>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Radar</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">System</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Scan Area</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Photograph</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Overall</th>
                <th className="text-left py-3 px-4 text-[var(--dtg-gray-500)] text-sm">Status</th>
              </tr>
            </thead>
            <tbody>
              {radarQualityData.map((radar) => (
                <tr key={radar.radar} className="border-t border-[var(--dtg-border-medium)]">
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
                    <span className={`text-xl ${getQualityColor(radar.overall)}`}>{radar.overall}%</span>
                  </td>
                  <td className="py-3 px-4">
                    {radar.overall >= 90 ? (
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
              <p className="text-[var(--dtg-text-primary)]">Optimize scan area coverage for SSR02</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Review and adjust scan parameters to improve area coverage from 88% to target of 92%</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">2</span>
            </div>
            <div>
              <p className="text-[var(--dtg-text-primary)]">Maintain current quality standards across all systems</p>
              <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Continue regular calibration and maintenance schedules to sustain excellent performance</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
