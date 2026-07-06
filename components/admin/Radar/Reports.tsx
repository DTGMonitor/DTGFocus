import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  FileBarChart, FileText, Calendar, Clock, CheckCircle,
  AlertTriangle, TrendingUp, RefreshCw
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ReportTemplate } from "@/components/reports/ReportTemplate";
import { AlarmReportPreview } from '../../reports/AlarmReportPreview';
import { DataQualityReportPreview } from '../../reports/DataQualityReportPreview';
import { AvailabilityReportPreview } from '../../reports/AvailabilityReportPreview';
import { SafetyReportPreview } from '../../reports/SafetyReportPreview';
import AdminUpload from "@/components/admin/Reports/AdminUpload";
import ReportList from "@/components/admin/Reports/ReportList";
import ReportTemplateModal from "@/components/admin/Reports/ReportTemplateModal";
import ScheduledReports from "@/components/admin/Radar/ReportReminder/ScheduledReports";

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
  const [totalCount, setTotalCount] = useState(0);
  const [thisMonthCount, setThisMonthCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [lastMonthCount, setLastMonthCount] = useState(0);
  const thisMonth = (new Date()).getMonth();
  const thisYear = (new Date()).getFullYear();

  //PASSING DATA
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Count ALL reports directly from the DB, independent of the date-limited list
  // rendered by <ReportList /> so the stat cards reflect the full dataset.
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const startOfThisMonth = fmt(new Date(thisYear, thisMonth, 1));
        const startOfNextMonth = fmt(new Date(thisYear, thisMonth + 1, 1));
        const startOfLastMonth = fmt(new Date(thisYear, thisMonth - 1, 1));

        const countQuery = () =>
          supabase.from('reports').select('*', { count: 'exact', head: true });

        const [totalRes, thisMonthRes, lastMonthRes, pendingRes, completedRes] =
          await Promise.all([
            countQuery(),
            countQuery().gte('date', startOfThisMonth).lt('date', startOfNextMonth),
            countQuery().gte('date', startOfLastMonth).lt('date', startOfThisMonth),
            countQuery().ilike('status', 'pending'),
            countQuery().ilike('status', 'completed'),
          ]);

        setTotalCount(totalRes.count || 0);
        setThisMonthCount(thisMonthRes.count || 0);
        setLastMonthCount(lastMonthRes.count || 0);
        setPendingCount(pendingRes.count || 0);
        setCompletedCount(completedRes.count || 0);
      } catch (error) {
        console.error('Error fetching report stats:', error);
      }
    };

    fetchStats();
  }, [refreshTrigger, thisMonth, thisYear]);

  const percentageCompleted = totalCount > 0 ? completedCount / totalCount * 100 : 0;
  const reportIncrement = thisMonthCount - lastMonthCount;
  const getIncrementDisplay = (inc: number) => {
    if (inc > 0) return {text:`+${inc}`, color: 'text-green-500'};
    if (inc < 0) return {text:`${inc}`, color: 'text-orange-500'};
     return {text:'0', color: 'text-[var(--dtg-gray-500)]'};
  };
  const reportIncDisplay = getIncrementDisplay(reportIncrement);


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
            onClick={handleRefresh}
            variant="brand"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh All
          </Button>
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
          <div className="text-3xl text-[var(--dtg-text-primary)]">{totalCount}</div>
          <div className="text-sm text-[var(--dtg-gray-500)] mt-1">Last 90 days</div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">This Month</span>
            <TrendingUp className="w-5 h-5 text-[#f97316]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">{thisMonthCount}</div>
          <div className={`text-sm ${reportIncDisplay.color} mt-1`}>{reportIncDisplay.text} vs last month</div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Pending Review</span>
            <AlertTriangle className="w-5 h-5 text-[#ef4444]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">{pendingCount}</div>
          <div className="text-sm text-[var(--dtg-gray-500)] mt-1">Requires attention</div>
        </div>

        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--dtg-gray-500)] text-sm">Completed</span>
            <CheckCircle className="w-5 h-5 text-[#10b981]" />
          </div>
          <div className="text-3xl text-[var(--dtg-text-primary)]">{completedCount}</div>
          <div className="text-sm text-[var(--dtg-gray-500)] mt-1">{percentageCompleted}% completion rate</div>
        </div>
      </div>
      {showReportUpload &&
        <AdminUpload onClose={() => setReportUpload(false)} />}

      {showReportModal &&
        <ReportTemplateModal onClose={() => setShowReportModal(false)} radarData={null} sensor={null}/>}
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

      <ReportList refreshTrigger={refreshTrigger} />

      {/* Scheduled Reports — per-site deadline & reminder */}
      <ScheduledReports />

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
