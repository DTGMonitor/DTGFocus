// Legend data for status indicators
export const legendData = {
  overallDqpStatus: [
    { status: 'monitoring-optimal', color: '#27AE60', label: 'Monitoring Optimal' },
    { status: 'action-required', color: '#E67E22', label: 'Action Required: Alarm Optimization' },
    { status: 'critical-condition', color: '#E74C3C', label: 'Critical Condition: Radar Offline, TARP 4' },
    { status: 'lost-connection', color: '#6B7280', label: 'Lost Connection' }
  ],
  radarStatus: [
    { status: 'online', color: '#27AE60', label: 'ONLINE' },
    { status: 'offline', color: '#E74C3C', label: 'OFFLINE' },
    { status: 'n-a', color: '#6B7280', label: 'N/A' }
  ],
  deformationStatus: [
    { status: 'n-a', color: '#6B7280', label: 'N/A' },
    { status: 'no-significant', color: '#27AE60', label: 'No Significant' },
    { status: 'regressive', color: '#27AE60', label: 'Regressive' },
    { status: 'linear-long-term', color: '#F1C40F', label: 'Linear Long-term' },
    { status: 'linear', color: '#E67E22', label: 'Linear' },
    { status: 'progressive', color: '#E67E22', label: 'Progressive' },
    { status: 'rapid-movement', color: '#9B59B6', label: 'Rapid Movement' },
    { status: 'failure-pattern', color: '#E74C3C', label: 'Failure Pattern' }
  ],
  alarmStatus: [
    { status: 'alarm-n-a', color: '#6B7280', label: 'Alarm N/A' },
    { status: 'alarm-standby', color: '#27AE60', label: 'Alarm Standby' },
    { status: 'unresolved-alarms', color: '#6B7280', label: 'Unresolved Alarms' },
    { status: 'alarm-triggered', color: '#F1C40F', label: 'Alarm Triggered' },
    { status: 'alarm-triggered-orange', color: '#E67E22', label: 'Alarm Triggered' },
    { status: 'alarm-triggered-red', color: '#E74C3C', label: 'Alarm Triggered' }
  ]
};

export const getRiskColor = (level: string) => {
  switch (level) {
    case 'High': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'Medium': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'Low': return 'bg-green-500/20 text-green-400 border-green-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
};

export const getStatusColor = (status: string) => {
  switch (status) {
    case 'Operational': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'Warning': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'Link Down': return 'bg-red-500/20 text-red-400 border-red-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
};

export const getQualityColor = (quality: number) => {
  if (quality >= 90) return 'text-green-500';
  if (quality >= 75) return 'text-yellow-500';
  return 'text-red-500';
};

export const getQualityStatus = (score: number) => {
  if (score >= 90) return { label: 'Excellent', color: 'bg-green-500' };
  if (score >= 75) return { label: 'Good', color: 'bg-yellow-500' };
  return { label: 'Needs Attention', color: 'bg-red-500' };
};

import {
  AlertTriangle, Bell, WifiOff, CheckCircle, Settings, TrendingUp,
  Filter, Search, Clock, MapPin, User, X, ChevronDown, Activity, Zap
} from 'lucide-react';

export const getTypeConfig = (type: string) => {
  switch (type) {
    case 'deformation':
      return { icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
    case 'alarm':
      return { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
    case 'downtime':
      return { icon: WifiOff, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
    case 'restored':
      return { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' };
    case 'optimization':
      return { icon: Settings, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/30' };
    case 'system':
      return { icon: Activity, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' };
    default:
      return { icon: Bell, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30' };
  }
};

export const getSeverityConfig = (severity: string) => {
  switch (severity) {
    case 'critical':
      return { color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500', borderLeft: 'border-l-red-500' };
    case 'warning':
      return { color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500', borderLeft: 'border-l-yellow-500' };
    case 'info':
      return { color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500', borderLeft: 'border-l-blue-500' };
    default:
      return { color: 'text-gray-400', bg: 'bg-gray-500/20', border: 'border-gray-500', borderLeft: 'border-l-gray-500' };
  }
};