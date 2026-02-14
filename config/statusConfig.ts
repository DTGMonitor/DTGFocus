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
    case 'TARP 4': case 'Critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'TARP 3': case 'Sub-Optimal': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'TARP 2': case 'Acceptable': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'TARP 1': case 'Optimal': return 'bg-green-500/20 text-green-400 border-green-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
};

export const getRiskColorSolid = (level: string) => {
  switch (level) {
    case 'TARP 4': case 'Critical': return 'bg-red-500/40 border-red-500';
    case 'TARP 3': case 'Sub-Optimal': return 'bg-orange-500/40 border-orange-500';
    case 'TARP 2': case 'Acceptable': return 'bg-yellow-500/40 border-yellow-500';
    case 'TARP 1': case 'Optimal': return 'bg-green-500/40 border-green-500';
    default: return 'bg-gray-500/40 border-gray-500';
  }
};

export const getAlarmStatusColors = (level: number) => {
  switch (level) {
    case 5: return "bg-blue-500";
    case 4: return "bg-purple-500";
    case 3: return "bg-yellow-500";
    case 2: return "bg-orange-500";
    case 1: return "bg-red-500";
    default: return 'bg-gray-500'
  }
};

export const getStatusDotColors = (level: string) => {
  switch (level) {
    case "TARP 1": return "bg-green-500";
    case "TARP 2": return "bg-yellow-500";
    case "TARP 3": return "bg-orange-500";
    case "TARP 4": return "bg-red-500";
    default: return 'bg-red-500'
  }
};

export const getCardColors = (val = "") => {
  const lower = val.toLowerCase();
  if (lower.includes("regressive")) return "bg-yellow-500/20";
  if (lower.includes("linear long-term")) return "bg-yellow-500/20";
  if (lower.includes("linear accelerating")) return "bg-red-500/20";
  if (lower.includes("linear")) return "bg-orange-500/20";
  if (lower.includes("progressive")) return "bg-red-500/20";
  if (lower.includes("rapid movement")) return "bg-red-700/20";
  if (lower.includes("detachment")) return "bg-red-700/20";
  if (lower.includes("failure")) return "bg-red-700/20";
  if (lower.includes("forecast")) return "bg-red-700/20";
  if (lower.includes("rock fall")) return "bg-red-700/20";
  return "bg-green-500/20";
};

export const getStatusColor = (status: string) => {
  switch (status) {
    case 'Live': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'Intermittent': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'Link Down': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'Lost Connection': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
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
  Radar,
  Satellite,
  Pyramid,
  TrainFrontTunnel,
  SquareDashedBottomCode
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
    case 'dqp':
      return { icon: Settings, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/30' };
    default:
      return { icon: Bell, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30' };
  }
};

export const getCatConfig = (type: string) => {
  switch (type) {
    case 'radar':
      return { icon: Radar, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
    case 'insar':
      return { icon: Satellite, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
    case 'prism':
      return { icon: Pyramid, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
    case 'emesent':
      return { icon: TrainFrontTunnel, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' };
    case 'dashboard':
      return { icon: SquareDashedBottomCode, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/30' };
    default:
      return { icon: Bell, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30' };
  }
};

export const getSeverityConfig = (severity: string) => {
  switch (severity) {
    case 'critical':
      return { color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500', borderLeft: 'border-l-red-500' };
    case 'moderate risk':
      return { color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500', borderLeft: 'border-l-yellow-500' };
    case 'notification only':
      return { color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500', borderLeft: 'border-l-blue-500' };
    case 'update':
      return { color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500', borderLeft: 'border-l-green-500' };
    default:
      return { color: 'text-gray-400', bg: 'bg-gray-500/20', border: 'border-gray-500', borderLeft: 'border-l-gray-500' };
  }
};

export const getOverallColor = (status: string, quality: string, risk: string) => {
  const normalisedStatus = status?.toLowerCase();
  const normalisedQuality = quality?.toLowerCase();
  const normalisedRisk = risk?.toLowerCase();

  if (normalisedStatus === 'lost connection') {
    return {
      bg: 'gray-500',
      bgGradient: 'from-gray-500/10 to-gray-100/10'
    }
  }

  if (normalisedQuality === 'critical' || normalisedRisk === 'tarp 4') {
    return {
      bg: 'red-500',
      bgGradient: 'from-red-500/10 to-red-100/10'
    }
  }

  if (normalisedQuality === 'sub-optimal' || normalisedRisk === 'tarp 3') {
    return {
      bg: 'orange-500',
      bgGradient: 'from-orange-500/10 to-orange-100/10'
    }
  }

  if (normalisedQuality === 'acceptable' || normalisedRisk === 'tarp 2') {
    return {
      bg: 'yellow-500',
      bgGradient: 'from-yellow-500/10 to-yellow-100/10'
    }
  }

  if (normalisedQuality === 'optimal' || normalisedRisk === 'tarp 1') {
    return {
      bg: 'green-500',
      bgGradient: 'from-green-500/10 to-green-100/10'
    }
  }
  return {
    bg: 'gray-500',
    bgGradient: 'from-gray-500/10 to-gray-100/10'
  }
};

export const getStatusDefinition = (status: string) => {
  const normalisedStatus = status.toLowerCase();
  switch (normalisedStatus) {
    case 'optimal': return { action: 'No action is required', definition: 'The system settings and data are optimal to monitor and manage risk, utilising the technology to its maximum capability.', summary:'No significant quality-related concerns affect slope stability monitoring.' }
    case 'acceptable': return { action: 'No urgent action is required', definition: 'The system settings and data are satisfactory to monitor and manage risk, utilising the technology to its maximum capability.', summary:'Minor limitations are present, but monitoring effectiveness is maintained.' }
    case 'sub-optimal': return {action: 'Some action is required due to an apparent unacceptable risk', definition: 'Require client action or confirmation that risk is managed adequately with site controls or other.', summary: 'Monitoring performance is reduced, limiting risk management confidence.'}
    case 'critical' : return {action:'Obvious and/or urgent need for action/response', definition:'A condition exists where the radar or sensor is not functional and hence completely incapable of providing meaningful data.', summary: 'Monitoring capability is lost or unreliable.'}
  }};