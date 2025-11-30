import React from 'react';
import { 
  Shield, 
  Phone, 
  Mail, 
  Clock,
  AlertTriangle,
  X,
  Printer,
  Zap,
  Wifi,
  Activity,
  TrendingUp,
  Radio,
  Users,
  Download,
  ChevronRight,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import {Button} from '@/components/LandingPage/ui/button';


interface TarpDocumentViewProps {
  radarName: string;
  onClose: () => void;
}

// Streamlined TARP data
const tarpData = {
  metadata: {
    version: "2.1",
    classification: "OPERATIONAL CRITICAL",
    lastUpdated: "March 8, 2025",
    approvedBy: "Pak Oscar - KTT / Direktur ISP",
    proposedBy: "Pak Dasuki - Geotechnical Engineer"
  },
  systemTriggers: [
    {
      id: 'link-down',
      name: 'Link Down',
      description: 'Communication link between radar and monitoring system is disrupted',
      level: 'grey',
      icon: Radio,
      severity: 'System Alert',
      actions: ['Call Geotech', 'Send WA Groups', 'Email Distribution'],
      procedures: [
        'Clear alarm and follow procedure as per TARP',
        'Check if possible to VNC for repair',
        'If able to connect manually with SOS proceed as per TARP',
        'Advise remote link is down/intermittent'
      ]
    },
    {
      id: 'connection-loss', 
      name: 'Connection Loss',
      description: 'Network connectivity issues affecting real-time monitoring capabilities',
      level: 'yellow',
      icon: Wifi,
      severity: 'Connectivity Issue',
      actions: ['Call Geotech', 'Send WA Groups', 'Email Distribution'],
      procedures: [
        'Advise to respond as per site TARP',
        'Conduct velocity analysis',
        'State area of concern'
      ]
    },
    {
      id: 'maintenance',
      name: 'Scheduled Offline',
      description: 'Planned maintenance window - scheduled system downtime',
      level: 'green',
      icon: Clock,
      severity: 'Planned Maintenance',
      actions: ['Call Geotech', 'Send WA Groups', 'Email Distribution'],
      procedures: [
        'State time periods for offline',
        'Phone call to be followed up by email'
      ]
    }
  ],
  movementTriggers: [
    {
      id: 'linear',
      name: 'Linear Deformation',
      description: 'Consistent deformation pattern detected indicating potential slope instability',
      level: 'orange',
      icon: TrendingUp,
      severity: 'Movement Alert',
      actions: ['Call Geotech', 'Send WA Groups', 'Email Distribution'],
      procedures: [
        'Advise to respond as per site TARP',
        'Conduct velocity analysis',
        'Conduct displacement update',
        'State area of concern'
      ]
    },
    {
      id: 'progressive',
      name: 'Progressive Deformation',
      description: 'Accelerating deformation indicating high probability of slope failure',
      level: 'red',
      icon: Activity,
      severity: 'Critical Movement',
      actions: ['Call Geotech', 'Send WA Groups', 'Email Distribution'],
      procedures: [
        'State area of concern',
        'Advise to respond as per site TARP',
        'Conduct velocity analysis',
        'Conduct collapse forecast where possible'
      ]
    },
    {
      id: 'failure',
      name: 'Failure Pattern',
      description: 'Critical deformation patterns indicating imminent slope failure risk',
      level: 'critical',
      icon: AlertTriangle,
      severity: 'Imminent Failure',
      actions: ['Call Geotech', 'Send WA Groups', 'Email Distribution'],
      procedures: [
        'State area concern',
        'Advise to respond as per site TARP'
      ]
    }
  ],
  phoneContacts: [
    { no: 1, name: 'Dasuki', role: 'Geotechnical Engineer', phone: '081218094432', priority: 'Primary' },
    { no: 2, name: 'Dimas', role: 'Jr. Geotechnical Engineer', phone: '082394634187', priority: 'Primary' },
    { no: 3, name: 'Mahmun', role: 'Senior Mining Engineer', phone: '085250833355', priority: 'Secondary' },
    { no: 4, name: 'Fransiskus Xaverius', role: 'South Operation Manager', phone: '081262659734', priority: 'Secondary' },
    { no: 5, name: 'Sadimun', role: 'Safety and Health Superintendent', phone: '081348195666', priority: 'Safety' },
    { no: 6, name: 'Lucky Wibowo', role: 'Direktur Operational', phone: '081184248252', priority: 'Management' },
    { no: 7, name: 'Agus Wiranasya Oscar', role: 'KTT / Direktur ISP', phone: '081195625046', priority: 'Management' }
  ],
  emailContacts: [
    'gerryddasuki.85@gmail.com',
    'dimasaputrapn@gmail.com', 
    'mahmunmr.mataram.s@gmail.com',
    'fransiskusx.utd@gmail.com',
    'pak.sadimun@yahoo.com',
    'mandar68@gmail.com',
    'rachma.kanchandani@gmail.com',
    'cv.sudrajat@gmail.com',
    'luckywibowo@gmail.com',
    'oscar.agus@gmail.com'
  ]
};

export function TarpDocumentView({ radarName, onClose }: TarpDocumentViewProps) {
  const handlePrint = () => {
    window.print();
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'grey': return '#6B7280';
      case 'green': return '#27AE60';
      case 'yellow': return '#F1C40F';
      case 'orange': return '#E67E22';
      case 'red': return '#E74C3C';
      case 'critical': return '#DC2626';
      default: return '#6B7280';
    }
  };

  const getLevelGradient = (level: string) => {
    switch (level) {
      case 'grey': return 'from-gray-500/10 to-gray-600/10';
      case 'green': return 'from-green-500/10 to-green-600/10';
      case 'yellow': return 'from-yellow-500/10 to-yellow-600/10';
      case 'orange': return 'from-orange-500/10 to-orange-600/10';
      case 'red': return 'from-red-500/10 to-red-600/10';
      case 'critical': return 'from-red-600/10 to-red-700/10';
      default: return 'from-gray-500/10 to-gray-600/10';
    }
  };

  return (
    <>
      {/* Floating Header - Always visible */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between p-4 max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-white">TARP Protocol</h1>
              <p className="text-xs text-gray-400">{radarName}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button 
              size="sm" 
              onClick={handlePrint}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <Download className="w-4 h-4 mr-1" />
              Export
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={onClose}
              className="text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Document Content */}
      <div className="min-h-screen bg-black text-white pt-16">
        <div className="max-w-5xl mx-auto px-6 py-8">
          
          {/* Hero Header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center space-x-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-4 py-2 mb-6">
              <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
              <span className="text-orange-400 text-sm">ACTIVE PROTOCOL</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              Trigger Action Response Plan
            </h1>
            <div className="space-y-1 mb-6">
              <p className="text-xl text-gray-300">GroundProbe Remote Monitoring System</p>
              <p className="text-gray-400">PT. Insani Baraperkasa</p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto text-sm">
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-green-400 font-medium">Version</div>
                <div className="text-white">{tarpData.metadata.version}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-blue-400 font-medium">Applied to</div>
                <div className="text-white">{radarName}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-orange-400 font-medium">Classification</div>
                <div className="text-white text-xs">{tarpData.metadata.classification}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-purple-400 font-medium">Updated</div>
                <div className="text-white text-xs">{tarpData.metadata.lastUpdated}</div>
              </div>
            </div>
          </div>

          {/* Response Protocol Overview */}
          <div className="mb-16">
            <h2 className="text-2xl font-bold text-center mb-8 text-white">Response Protocol Flow</h2>
            <div className="bg-gradient-to-r from-gray-900/80 to-gray-800/80 border border-gray-700/50 rounded-2xl p-6 backdrop-blur-sm">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="w-12 h-12 bg-red-500 rounded-xl flex items-center justify-center mb-3 mx-auto">
                    <AlertTriangle className="w-6 h-6 text-white" />
                  </div>
                  <p className="font-medium text-white text-sm">Alert Detected</p>
                  <p className="text-gray-400 text-xs">System triggers</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center mb-3 mx-auto">
                    <Phone className="w-6 h-6 text-white" />
                  </div>
                  <p className="font-medium text-white text-sm">Call Geotech</p>
                  <p className="text-gray-400 text-xs">Primary contact</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center mb-3 mx-auto">
                    <Mail className="w-6 h-6 text-white" />
                  </div>
                  <p className="font-medium text-white text-sm">Send Messages</p>
                  <p className="text-gray-400 text-xs">WA & Email</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center mb-3 mx-auto">
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  </div>
                  <p className="font-medium text-white text-sm">Execute Response</p>
                  <p className="text-gray-400 text-xs">Follow procedures</p>
                </div>
              </div>
            </div>
          </div>

          {/* System & Connectivity Triggers */}
          <div className="mb-16">
            <div className="flex items-center mb-8">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-3">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">System & Connectivity Triggers</h2>
            </div>
            
            <div className="grid gap-6">
              {tarpData.systemTriggers.map((trigger) => {
                const IconComponent = trigger.icon;
                return (
                  <div key={trigger.id} className={`bg-gradient-to-r ${getLevelGradient(trigger.level)} border border-white/10 rounded-2xl overflow-hidden`}>
                    <div className="p-6">
                      <div className="flex items-start gap-6 mb-6">
                        <div 
                          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: getLevelColor(trigger.level) + '30' }}
                        >
                          <IconComponent className="w-7 h-7" style={{ color: getLevelColor(trigger.level) }} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="text-xl font-bold text-white">{trigger.name}</h3>
                            <span 
                              className="px-3 py-1 rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: getLevelColor(trigger.level) }}
                            >
                              {trigger.level.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-gray-300 mb-4">{trigger.description}</p>
                          <div className="grid grid-cols-3 gap-3 mb-4">
                            {trigger.actions.map((action, index) => (
                              <div key={index} className="bg-black/20 rounded-lg px-3 py-2 text-center">
                                <span className="text-sm font-medium text-white">{action}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      
                      <div className="border-t border-white/10 pt-4">
                        <h4 className="font-medium text-white mb-3">Response Procedures:</h4>
                        <div className="grid gap-2">
                          {trigger.procedures.map((procedure, index) => (
                            <div key={index} className="flex items-start gap-3">
                              <div 
                                className="w-5 h-5 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0"
                                style={{ backgroundColor: getLevelColor(trigger.level) }}
                              >
                                <span className="text-white text-xs font-bold">{index + 1}</span>
                              </div>
                              <span className="text-sm text-gray-300">{procedure}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ground Movement Triggers */}
          <div className="mb-16">
            <div className="flex items-center mb-8">
              <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center mr-3">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">Ground Movement Triggers</h2>
            </div>
            
            <div className="grid gap-6">
              {tarpData.movementTriggers.map((trigger) => {
                const IconComponent = trigger.icon;
                return (
                  <div key={trigger.id} className={`bg-gradient-to-r ${getLevelGradient(trigger.level)} border border-white/10 rounded-2xl overflow-hidden`}>
                    <div className="p-6">
                      <div className="flex items-start gap-6 mb-6">
                        <div 
                          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: getLevelColor(trigger.level) + '30' }}
                        >
                          <IconComponent className="w-7 h-7" style={{ color: getLevelColor(trigger.level) }} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="text-xl font-bold text-white">{trigger.name}</h3>
                            <span 
                              className="px-3 py-1 rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: getLevelColor(trigger.level) }}
                            >
                              {trigger.level.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-gray-300 mb-4">{trigger.description}</p>
                          <div className="grid grid-cols-3 gap-3 mb-4">
                            {trigger.actions.map((action, index) => (
                              <div key={index} className="bg-black/20 rounded-lg px-3 py-2 text-center">
                                <span className="text-sm font-medium text-white">{action}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      
                      <div className="border-t border-white/10 pt-4">
                        <h4 className="font-medium text-white mb-3">Response Procedures:</h4>
                        <div className="grid gap-2">
                          {trigger.procedures.map((procedure, index) => (
                            <div key={index} className="flex items-start gap-3">
                              <div 
                                className="w-5 h-5 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0"
                                style={{ backgroundColor: getLevelColor(trigger.level) }}
                              >
                                <span className="text-white text-xs font-bold">{index + 1}</span>
                              </div>
                              <span className="text-sm text-gray-300">{procedure}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Emergency Contacts */}
          <div className="mb-16">
            <div className="flex items-center mb-8">
              <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center mr-3">
                <Phone className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">Emergency Contact Directory</h2>
            </div>

            {/* Contact Protocol */}
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-6">
              <div className="flex items-center mb-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400 mr-2" />
                <span className="font-medium text-yellow-300">Contact Protocol</span>
              </div>
              <p className="text-sm text-yellow-200">
                If no answer on primary phone line → Send WhatsApp message + Email distribution list
              </p>
            </div>

            {/* Phone Contacts */}
            <div className="bg-gradient-to-r from-green-500/10 to-green-600/10 border border-green-500/20 rounded-xl overflow-hidden mb-6">
              <div className="p-4 border-b border-green-500/20">
                <h3 className="font-bold text-green-300 flex items-center">
                  <Phone className="w-4 h-4 mr-2" />
                  24/7 Phone Line Contacts
                </h3>
              </div>
              <div className="p-4">
                <div className="grid gap-3">
                  {tarpData.phoneContacts.map((contact) => (
                    <div key={contact.no} className="flex items-center justify-between bg-black/20 rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs font-bold">{contact.no}</span>
                        </div>
                        <div>
                          <div className="font-medium text-white">{contact.name}</div>
                          <div className="text-sm text-gray-400">{contact.role}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-green-300 font-mono">{contact.phone}</div>
                        <div className={`text-xs px-2 py-1 rounded-full ${
                          contact.priority === 'Primary' ? 'bg-red-500/20 text-red-300' :
                          contact.priority === 'Secondary' ? 'bg-yellow-500/20 text-yellow-300' :
                          contact.priority === 'Safety' ? 'bg-orange-500/20 text-orange-300' :
                          'bg-blue-500/20 text-blue-300'
                        }`}>
                          {contact.priority}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Email Distribution */}
            <div className="bg-gradient-to-r from-blue-500/10 to-blue-600/10 border border-blue-500/20 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-blue-500/20">
                <h3 className="font-bold text-blue-300 flex items-center">
                  <Mail className="w-4 h-4 mr-2" />
                  Email Distribution List
                </h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2">
                  {tarpData.emailContacts.map((email, index) => (
                    <div key={index} className="bg-black/20 rounded-lg p-2 text-center">
                      <span className="text-sm text-blue-300 font-mono">{email}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Document Footer */}
          <div className="border-t border-gray-700 pt-8">
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                <div>
                  <div className="text-gray-400 mb-1">Version</div>
                  <div className="text-white font-medium">{tarpData.metadata.version}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Classification</div>
                  <div className="text-red-300 font-medium">{tarpData.metadata.classification}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Approved By</div>
                  <div className="text-white font-medium text-xs">{tarpData.metadata.approvedBy}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Generated</div>
                  <div className="text-white font-medium">{new Date().toLocaleDateString()}</div>
                </div>
              </div>
              <div className="text-center text-xs text-gray-500 border-t border-gray-700 pt-4">
                <p>This document contains operational critical information for emergency response procedures.</p>
                <p className="mt-1">DTG Dashboard System v2025.1 | PT. Insani Baraperkasa</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          
          body, html {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 11px !important;
          }
          
          * {
            background: white !important;
            color: black !important;
            border-color: #ccc !important;
          }
          
          .bg-gradient-to-r {
            background: #f8f9fa !important;
          }
          
          .bg-black\/20 {
            background: #f5f5f5 !important;
          }
          
          .text-white {
            color: black !important;
          }
          
          .text-gray-300,
          .text-gray-400 {
            color: #666 !important;
          }
          
          .border-white\/10 {
            border-color: #ddd !important;
          }
          
          .rounded-2xl,
          .rounded-xl {
            border-radius: 8px !important;
          }
          
          h1, h2, h3 {
            color: black !important;
            font-weight: bold !important;
          }
          
          .grid {
            display: block !important;
          }
          
          .grid > * {
            display: block !important;
            margin-bottom: 8px !important;
          }
          
          svg {
            color: black !important;
          }
        }
      `}</style>
    </>
  );
}