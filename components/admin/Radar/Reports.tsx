import React, { useState } from 'react';
import {
  FileBarChart, Download, FileText, Calendar, Clock, CheckCircle,
  AlertTriangle, TrendingUp, Eye, Share2, Filter, Search
} from 'lucide-react';
import { Button } from "@/components/LandingPage/ui/button";
import { ReportTemplate } from "@/components/reports/ReportTemplate";
import { AlarmReportPreview } from '../../reports/AlarmReportPreview';
import { DataQualityReportPreview } from '../../reports/DataQualityReportPreview';
import { AvailabilityReportPreview } from '../../reports/AvailabilityReportPreview';
import { SafetyReportPreview } from '../../reports/SafetyReportPreview';
import AdminUpload from "@/components/admin/Reports/AdminUpload";
import ReportList from "@/components/admin/Reports/ReportList";
import ReportTemplateModal from "@/components/admin/Reports/ReportTemplateModal";

interface Report {
  id: string;
  title: string;
  type: 'alarm' | 'data-quality' | 'availability' | 'safety';
  date: string;
  generatedBy: string;
  status: 'completed' | 'pending' | 'draft';
  size: string;
}

const recentReports: Report[] = [
  {
    id: '1',
    title: 'Monthly Alarm Summary - October 2024',
    type: 'alarm',
    date: 'Oct 31, 2024',
    generatedBy: 'Telfer Operator',
    status: 'completed',
    size: '2.4 MB'
  },
  {
    id: '2',
    title: 'Data Quality Report - Week 43',
    type: 'data-quality',
    date: 'Oct 27, 2024',
    generatedBy: 'System Auto',
    status: 'completed',
    size: '1.8 MB'
  },
  {
    id: '3',
    title: 'System Availability Analysis - Q3 2024',
    type: 'availability',
    date: 'Oct 25, 2024',
    generatedBy: 'Telfer Engineer',
    status: 'completed',
    size: '3.1 MB'
  },
  {
    id: '4',
    title: 'Safety Inspection Summary - October',
    type: 'safety',
    date: 'Oct 20, 2024',
    generatedBy: 'Telfer Operator',
    status: 'completed',
    size: '1.2 MB'
  },
  {
    id: '5',
    title: 'Weekly Data Quality Report',
    type: 'data-quality',
    date: 'In Progress',
    generatedBy: 'Telfer Operator',
    status: 'draft',
    size: '-'
  },
];

function Reports() {
  const [showReportUpload, setReportUpload] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [viewingReport, setViewingReport] = useState<'alarm' | 'data-quality' | 'availability' | 'safety' | null>(null);

  return (
    <div className="p-6 space-y-6 bg-[var(--dtg-bg-primary)] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--dtg-text-primary)]">Report Management</h1>
          <p className="text-[var(--dtg-gray-500)] text-sm mt-1">Generate, view, and export system reports</p>
        </div>
        <div className="flex items-center space-x-6">
          <Button
            onClick={() => { setShowReportModal((a => !a)) }}
            variant="brand"
          >
            <FileBarChart className="w-4 h-4" />
            Create New Report
          </Button>
          <Button
            onClick={() => { setReportUpload((a => !a)) }}
            variant="orange"
          >
            <FileBarChart className="w-4 h-4" />
            Upload Files
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Total Reports</span>
            <FileText className="w-5 h-5 text-[#14b8a6]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">127</div>
          <div className="text-sm text-[var(--dtg-gray-500)] mt-1">Last 90 days</div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">This Month</span>
            <TrendingUp className="w-5 h-5 text-[#f97316]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">23</div>
          <div className="text-sm text-green-500 mt-1">+8 vs last month</div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Pending Review</span>
            <AlertTriangle className="w-5 h-5 text-[#ef4444]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">5</div>
          <div className="text-sm text-[var(--dtg-gray-500)] mt-1">Requires attention</div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Completed</span>
            <CheckCircle className="w-5 h-5 text-[#10b981]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">122</div>
          <div className="text-sm text-[var(--dtg-gray-500)] mt-1">96% completion rate</div>
        </div>
      </div>
      {showReportUpload &&
        <AdminUpload onClose={() => setReportUpload(false)} />}

      {showReportModal &&
        <ReportTemplateModal onClose={() => setShowReportModal(false)} />}
      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button
          onClick={() => setViewingReport('alarm')}
          className="group rounded-lg p-6 text-left transition-all border bg-gradient-to-br
    
    from-[var(--red-from)] 
    to-[var(--red-to)] 
    border-[var(--red-border)]
    
    hover:from-[var(--red-from-hover)] 
    hover:to-[var(--red-to-hover)]"
        >
          <AlertTriangle className="w-8 h-8 text-red-500 mb-3 group-hover:scale-110 transition-transform" />
          <h3 className="text-white mb-1">View Alarm Summary</h3>
          <p className="text-sm text-[var(--dtg-gray-400)]">Comprehensive alarm analysis report</p>
        </button>

        <button
          onClick={() => setViewingReport('data-quality')}
          className="group rounded-lg p-6 text-left transition-all border bg-gradient-to-br
    
    from-[var(--blue-from)] 
    to-[var(--blue-to)] 
    border-[var(--blue-border)]
    
    hover:from-[var(--blue-from-hover)] 
    hover:to-[var(--blue-to-hover)]"
        >
          <FileBarChart className="w-8 h-8 text-blue-500 mb-3 group-hover:scale-110 transition-transform" />
          <h3 className="text-white mb-1">View Data Quality</h3>
          <p className="text-sm text-[var(--dtg-gray-400)]">Quality metrics and analysis</p>
        </button>

        <button
          onClick={() => setViewingReport('availability')}
          className="group rounded-lg p-6 text-left transition-all border bg-gradient-to-br
    
    from-[var(--green-from)] 
    to-[var(--green-to)] 
    border-[var(--green-border)]
    
    hover:from-[var(--green-from-hover)] 
    hover:to-[var(--green-to-hover)]"
        >
          <TrendingUp className="w-8 h-8 text-green-500 mb-3 group-hover:scale-110 transition-transform" />
          <h3 className="text-white mb-1">View Availability</h3>
          <p className="text-sm text-[var(--dtg-gray-400)]">Uptime and reliability report</p>
        </button>

        <button
          onClick={() => setViewingReport('safety')}
          className="group rounded-lg p-6 text-left transition-all border bg-gradient-to-br
    
    from-[var(--yellow-from)] 
    to-[var(--yellow-to)] 
    border-[var(--yellow-border)]
    
    hover:from-[var(--yellow-from-hover)] 
    hover:to-[var(--yellow-to-hover)]"
        >
          <CheckCircle className="w-8 h-8 text-yellow-500 mb-3 group-hover:scale-110 transition-transform" />
          <h3 className="text-white mb-1">View Safety Report</h3>
          <p className="text-sm text-[var(--dtg-gray-400)]">Safety inspection data</p>
        </button>
      </div>

      <ReportList />

      {/* Report Templates */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <h3 className="text-lg text-[var(--dtg-text-primary)] mb-4">Report Templates</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: 'Daily Operations Report', icon: Clock, color: 'text-[#14b8a6]' },
            { name: 'Weekly Summary Report', icon: Calendar, color: 'text-[#f97316]' },
            { name: 'Monthly Analysis Report', icon: TrendingUp, color: 'text-[#8b5cf6]' },
          ].map((template, index) => {
            const Icon = template.icon;
            return (
              <button key={index} className="flex items-center gap-3 p-4 bg-[var(--dtg-bg-primary)] rounded-lg border border-[var(--dtg-border-medium)] hover:border-[#14b8a6] transition-all text-left">
                <Icon className={`w-6 h-6 ${template.color}`} />
                <span className="text-[var(--dtg-text-primary)]">{template.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scheduled Reports */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg text-[var(--dtg-text-primary)]">Scheduled Reports</h3>
          <button className="text-sm text-[#14b8a6] hover:text-[#0d9488] transition-colors">
            Manage Schedule
          </button>
        </div>
        <div className="space-y-3">
          {[
            { name: 'Daily Data Quality', frequency: 'Every day at 6:00 AM', nextRun: 'Tomorrow' },
            { name: 'Weekly Safety Summary', frequency: 'Every Monday at 8:00 AM', nextRun: 'Nov 4, 2024' },
            { name: 'Monthly Availability Report', frequency: 'First day of month', nextRun: 'Dec 1, 2024' },
          ].map((scheduled, index) => (
            <div key={index} className="flex items-center justify-between p-4 bg-[var(--dtg-bg-primary)] rounded-lg border border-[var(--dtg-border-medium)]">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <div>
                  <div className="text-[var(--dtg-text-primary)]">{scheduled.name}</div>
                  <div className="text-[var(--dtg-gray-500)] text-sm">{scheduled.frequency}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[var(--dtg-gray-500)] text-sm">Next run</div>
                <div className="text-[var(--dtg-text-primary)] text-sm">{scheduled.nextRun}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Report Preview Modals */}
      {viewingReport === 'alarm' && (
        <ReportTemplate type="alarm" onClose={() => setViewingReport(null)}>
          <AlarmReportPreview />
        </ReportTemplate>
      )}
      {viewingReport === 'data-quality' && (
        <ReportTemplate type="data-quality" onClose={() => setViewingReport(null)}>
          <DataQualityReportPreview />
        </ReportTemplate>
      )}
      {viewingReport === 'availability' && (
        <ReportTemplate type="availability" onClose={() => setViewingReport(null)}>
          <AvailabilityReportPreview />
        </ReportTemplate>
      )}
      {viewingReport === 'safety' && (
        <ReportTemplate type="safety" onClose={() => setViewingReport(null)}>
          <SafetyReportPreview />
        </ReportTemplate>
      )}
    </div>
  );
}


export default Reports;
