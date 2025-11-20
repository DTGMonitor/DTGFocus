import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, TrendingUp, Shield, ClipboardCheck } from 'lucide-react';

const safetyData = [
  {
    category: 'Work Environment & Ergonomics',
    items: [
      { name: 'Workstation ergonomically arranged', status: 'yes' },
      { name: 'Sufficient lighting in work area', status: 'yes' },
      { name: 'Room temperature suitable for work', status: 'yes' },
      { name: 'No tripping hazards or obstructions', status: 'yes' },
    ],
  },
  {
    category: 'Electrical & Equipment Safety',
    items: [
      { name: 'All electrical equipment properly grounded', status: 'yes' },
      { name: 'No exposed or damaged wiring', status: 'yes' },
      { name: 'Equipment operating within normal parameters', status: 'yes' },
      { name: 'Emergency stop buttons functional', status: 'yes' },
    ],
  },
  {
    category: 'Emergency & Incident Readiness',
    items: [
      { name: 'Fire extinguishers accessible and inspected', status: 'yes' },
      { name: 'Emergency exits clearly marked and unobstructed', status: 'yes' },
      { name: 'First aid kit fully stocked', status: 'yes' },
      { name: 'Emergency contact numbers posted', status: 'yes' },
    ],
  },
  {
    category: 'Fatigue & Personal Health Check',
    items: [
      { name: 'Adequate rest before shift', status: 'yes' },
      { name: 'No signs of excessive fatigue', status: 'yes' },
      { name: 'Personal protective equipment available', status: 'yes' },
      { name: 'Hydration and break areas accessible', status: 'yes' },
    ],
  },
];

export function SafetyReportPreview() {
  const totalItems = safetyData.reduce((sum, cat) => sum + cat.items.length, 0);
  const passedItems = safetyData.reduce(
    (sum, cat) => sum + cat.items.filter((item) => item.status === 'yes').length,
    0
  );
  const escalatedIssues = safetyData.reduce(
    (sum, cat) => sum + cat.items.filter((item) => item.status === 'no').length,
    0
  );
  const score = Math.round((passedItems / totalItems) * 100);

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div>
        <h2 className="text-xl text-white mb-4 pb-2 border-b border-[#3a3a3a]">Executive Summary</h2>
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-[#2a2a2a] border border-green-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Shield className="w-6 h-6 text-green-500" />
              <span className="text-sm text-gray-400">Score</span>
            </div>
            <p className="text-3xl text-white">{score}</p>
            <p className="text-xs text-gray-400 mt-1">Safety Score</p>
          </div>
          <div className="bg-[#2a2a2a] border border-teal-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-6 h-6 text-teal-500" />
              <span className="text-sm text-gray-400">Result</span>
            </div>
            <p className="text-xl text-green-500">Excellent</p>
            <p className="text-xs text-gray-400 mt-1">Overall Status</p>
          </div>
          <div className="bg-[#2a2a2a] border border-orange-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
              <span className="text-sm text-gray-400">Issues</span>
            </div>
            <p className="text-3xl text-white">{escalatedIssues}</p>
            <p className="text-xs text-gray-400 mt-1">Escalated</p>
          </div>
          <div className="bg-[#2a2a2a] border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <ClipboardCheck className="w-6 h-6 text-blue-500" />
              <span className="text-sm text-gray-400">Project</span>
            </div>
            <p className="text-sm text-white mt-2">Monitoring</p>
            <p className="text-xs text-gray-400 mt-1">Current Project</p>
          </div>
          <div className="bg-[#2a2a2a] border border-purple-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-6 h-6 text-purple-500" />
              <span className="text-sm text-gray-400">Location</span>
            </div>
            <p className="text-xs text-white mt-2">Office - Yogyakarta</p>
            <p className="text-xs text-gray-400 mt-1">Inspection Site</p>
          </div>
        </div>
      </div>

      {/* Inspection Details */}
      <div>
        <h2 className="text-xl text-white mb-4 pb-2 border-b border-[#3a3a3a]">Inspection Details</h2>
        <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Inspection Date:</span>
              <span className="text-white ml-2">{new Date().toLocaleDateString()}</span>
            </div>
            <div>
              <span className="text-gray-400">Inspector:</span>
              <span className="text-white ml-2">Telfer Operator</span>
            </div>
            <div>
              <span className="text-gray-400">Shift:</span>
              <span className="text-white ml-2">Dayshift</span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Findings */}
      <div>
        <h2 className="text-xl text-white mb-4 pb-2 border-b border-[#3a3a3a]">Key Findings</h2>
        <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-white">100% compliance across all safety categories</p>
              <p className="text-gray-400 text-sm mt-1">All 16 inspection points passed successfully</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-white">Work environment exceeds safety standards</p>
              <p className="text-gray-400 text-sm mt-1">Ergonomics, lighting, and temperature all within optimal ranges</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-white">Emergency preparedness fully compliant</p>
              <p className="text-gray-400 text-sm mt-1">All emergency equipment accessible, functional, and within inspection dates</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-white">Personnel health and safety protocols followed</p>
              <p className="text-gray-400 text-sm mt-1">Adequate rest, PPE availability, and fatigue management measures in place</p>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Category Results */}
      <div>
        <h2 className="text-xl text-white mb-4 pb-2 border-b border-[#3a3a3a]">Detailed Category Results</h2>
        <div className="grid grid-cols-2 gap-4">
          {safetyData.map((category, idx) => {
            const passedCount = category.items.filter(item => item.status === 'yes').length;
            const percentage = Math.round((passedCount / category.items.length) * 100);
            
            return (
              <div key={idx} className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white">{category.category}</h3>
                  <span className={`text-xl ${percentage === 100 ? 'text-green-500' : 'text-yellow-500'}`}>
                    {percentage}%
                  </span>
                </div>
                <div className="space-y-2">
                  {category.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center justify-between text-sm bg-[#1a1a1a] rounded p-2">
                      <span className="text-gray-300 flex-1">{item.name}</span>
                      {item.status === 'yes' ? (
                        <CheckCircle className="w-4 h-4 text-green-500 ml-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500 ml-2" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Table */}
      <div>
        <h2 className="text-xl text-white mb-4 pb-2 border-b border-[#3a3a3a]">Inspection Summary</h2>
        <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#1a1a1a]">
              <tr>
                <th className="text-left py-3 px-4 text-gray-400 text-sm">Category</th>
                <th className="text-center py-3 px-4 text-gray-400 text-sm">Items Checked</th>
                <th className="text-center py-3 px-4 text-gray-400 text-sm">Passed</th>
                <th className="text-center py-3 px-4 text-gray-400 text-sm">Issues</th>
                <th className="text-center py-3 px-4 text-gray-400 text-sm">Completion %</th>
                <th className="text-center py-3 px-4 text-gray-400 text-sm">Status</th>
              </tr>
            </thead>
            <tbody>
              {safetyData.map((category, idx) => {
                const passedCount = category.items.filter(item => item.status === 'yes').length;
                const issuesCount = category.items.filter(item => item.status === 'no').length;
                const percentage = Math.round((passedCount / category.items.length) * 100);
                
                return (
                  <tr key={idx} className="border-t border-[#3a3a3a]">
                    <td className="py-3 px-4 text-white">{category.category}</td>
                    <td className="py-3 px-4 text-center text-gray-300">{category.items.length}</td>
                    <td className="py-3 px-4 text-center text-green-500">{passedCount}</td>
                    <td className="py-3 px-4 text-center text-red-500">{issuesCount}</td>
                    <td className="py-3 px-4 text-center text-white">{percentage}%</td>
                    <td className="py-3 px-4 text-center">
                      {percentage === 100 ? (
                        <span className="px-3 py-1 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
                          Excellent
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                          Review Required
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommendations */}
      <div>
        <h2 className="text-xl text-white mb-4 pb-2 border-b border-[#3a3a3a]">Recommendations</h2>
        <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">1</span>
            </div>
            <div>
              <p className="text-white">Maintain current safety standards and procedures</p>
              <p className="text-gray-400 text-sm mt-1">Continue regular inspections and proactive safety management practices</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">2</span>
            </div>
            <div>
              <p className="text-white">Schedule next safety inspection for next shift</p>
              <p className="text-gray-400 text-sm mt-1">Regular inspections ensure continued compliance and early issue detection</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-400 text-sm">3</span>
            </div>
            <div>
              <p className="text-white">Conduct refresher training on emergency procedures</p>
              <p className="text-gray-400 text-sm mt-1">Quarterly training ensures all personnel remain familiar with emergency protocols</p>
            </div>
          </div>
        </div>
      </div>

      {/* Conclusion */}
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-7 h-7 text-green-500" />
          </div>
          <div>
            <h3 className="text-lg text-white mb-2">Conclusion</h3>
            <p className="text-gray-300">
              The safety inspection has been completed successfully with a perfect score of {score}%. All safety categories meet 
              or exceed required standards. The work environment is safe for all personnel to proceed with operations. 
              No immediate corrective actions required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
