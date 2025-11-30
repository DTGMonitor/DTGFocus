import React, { useState } from 'react';
import { 
  Shield, 
  AlertTriangle, 
  Clock, 
  Phone, 
  Mail, 
  MapPin, 
  Users,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  Bell,
  FileText,
  Printer
} from 'lucide-react';
import { Badge } from '@/components/LandingPage/ui/badge';
import {Button} from '@/components/LandingPage/ui/button';
import { Card } from '@/components/LandingPage/ui/card';
import { TarpDocumentView } from './TarpDocumentView';

// Import the TARP image
import tarpImage from 'figma:asset/e5b4b7853eeb65d5e7231d8d2e5bde8d95e7e096.png';

interface TarpProps {
  radarName: string;
}

// TARP data structure based on the image
const tarpData = {
  title: "GROUNDPROBE REMOTE MONITORING TARP",
  subtitle: "PT. INSANI BARAPERKASA",
  metadata: {
    draftProposed: "Pak Dasuki - Geotechnical Engineer ISP",
    approved: "Pak Oscar - KTT / Direktur ISP",
    date: "March 6, 2025",
    revision: "March 8, 2026"
  },
  triggers: [
    {
      id: 'grey-alarm',
      trigger: 'Grey Alarm (Link down)',
      level: 'grey',
      dayShift: {
        geotech: 'Call Geotech - Dayshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      nightShift: {
        geotech: 'Call Geotech - Nightshift',
        messaging: 'Sent Message WA Groups', 
        email: 'Email All'
      },
      remarks: [
        '1. Clear alarm and follow procedure as per TARP',
        '2. Check if possible to VNC for repair',
        '3. If able to connect manually with SOS proceed as per TARP and call support desk',
        '4. Advise remote link is down/intermittent and GSS no longer able to monitor remotely for current operationally monitor due to intermittent connection',
        '5. Advise Districts to follow site procedure for alarms',
        '6. State area of concern'
      ]
    },
    {
      id: 'lost-connection',
      trigger: 'Lost/Intermittent/Slow Connection',
      level: 'yellow',
      dayShift: {
        geotech: 'Call Geotech - Dayshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      nightShift: {
        geotech: 'Call Geotech - Nightshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      remarks: [
        '1. Advise to respond as per site TARP',
        '2. Conduct velocity analysis',
        '3. Conduct displacement update once it developed to progressive deformation',
        '4. State area of concern'
      ]
    },
    {
      id: 'linear-deformation',
      trigger: 'Linear Deformation Detected',
      level: 'orange',
      dayShift: {
        geotech: 'Call Geotech - Dayshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      nightShift: {
        geotech: 'Call Geotech - Nightshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      remarks: [
        '1. Advise to respond as per site TARP',
        '2. Conduct velocity analysis',
        '3. Conduct displacement update once it developed to progressive deformation',
        '4. State area of concern'
      ]
    },
    {
      id: 'progressive-deformation',
      trigger: 'Progressive Deformation Detected',
      level: 'red',
      dayShift: {
        geotech: 'Call Geotech - Dayshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      nightShift: {
        geotech: 'Call Geotech - Nightshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      remarks: [
        '1. State area of concern',
        '2. Advise to respond as per site TARP',
        '3. Conduct velocity analysis',
        '4. Conduct colleague forecast where possible as per procedure'
      ]
    },
    {
      id: 'failure-pattern',
      trigger: 'Failure Pattern Indication',
      level: 'critical',
      dayShift: {
        geotech: 'Call Geotech - Dayshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      nightShift: {
        geotech: 'Call Geotech - Nightshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      remarks: [
        '1. State area concern',
        '2. Advise to respond as per site TARP'
      ]
    },
    {
      id: 'offline-schedule',
      trigger: 'Offline Schedule',
      level: 'green',
      dayShift: {
        geotech: 'Call Geotech - Dayshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      nightShift: {
        geotech: 'Call Geotech - Nightshift',
        messaging: 'Sent Message WA Groups',
        email: 'Email All'
      },
      remarks: [
        '1. State time periods for offline',
        '2. Phone call to be follow up by email'
      ]
    }
  ],
  contacts: {
    primary: [
      { no: 1, name: 'Dasuki', role: 'Geotek Dayshift / Geotechnical eng', phone: '081218094432', email: 'gerryddasuki.85@gmail.com' },
      { no: 2, name: 'Dimas', role: 'Geotek Dayshift / Jr. Geotechnical eng', phone: '082394634187', email: 'dimasaputrapn@gmail.com' },
      { no: 3, name: 'Tentaff (Krimson Via Grup)', role: '', phone: '', email: '' },
      { no: 4, name: 'Tentaff (Krimson Via Grup)', role: '', phone: '', email: '' },
      { no: 5, name: 'IT', role: '', phone: '081347443223', email: 'itcanss23@gmail.com' },
      { no: 6, name: 'Mahmun', role: 'Senior Mining Engineer', phone: '085250833355', email: 'mahmunmr.mataram.s@gmail.com' },
      { no: 7, name: 'Pak Fransiskus Xaverius', role: 'South Operation Manager', phone: '081262659734', email: 'fransiskusx.utd@gmail.com' },
      { no: 8, name: 'Pak Sadimun', role: 'Safety and Health Superintendent', phone: '081348195666', email: 'pak.sadimun@yahoo.com' },
      { no: 9, name: 'Pak Mandar Aji', role: 'HSE System Superintendent', phone: '081217310777', email: 'mandar68@gmail.com' },
      { no: 10, name: 'Pak Rachma', role: 'HSE Manager', phone: '081348481228', email: 'rachma.kanchandani@gmail.com' },
      { no: 11, name: 'Pak Cecep Sudrajat', role: 'Manager Engineering and Development', phone: '081155026252', email: 'cv.sudrajat@gmail.com' },
      { no: 12, name: 'Pak Lucky Wibowo', role: 'Direktur Operational', phone: '081184248252', email: 'luckywibowo@gmail.com' },
      { no: 13, name: 'Pak Agus Wiranasya Oscar', role: 'KTT / Direktur ISP', phone: '081195625046', email: 'oscar.agus@gmail.com' }
    ],
    distribution: [
      { no: 1, name: 'Dasuki', role: 'Geotek Dayshift / Geotechnical eng', phone: '081218094432', email: 'gerryddasuki.85@gmail.com' },
      { no: 2, name: 'Dimas', role: 'Geotek Dayshift / Jr. Geotechnical eng', phone: '082394634187', email: 'dimasaputrapn@gmail.com' },
      { no: 3, name: 'Tentaff (Krimson Via Grup)', role: '', phone: '', email: '' },
      { no: 4, name: 'Tentaff (Krimson Via Grup)', role: '', phone: '', email: '' },
      { no: 6, name: 'Mahmun', role: 'Senior Mining Engineer', phone: '085250833355', email: 'mahmunmr.mataram.s@gmail.com' },
      { no: 7, name: 'Pak Fransiskus Xaverius', role: 'South Operation Manager', phone: '081262659734', email: 'fransiskusx.utd@gmail.com' },
      { no: 8, name: 'Pak Sadimun', role: 'Safety and Health Superintendent', phone: '081348195666', email: 'pak.sadimun@yahoo.com' },
      { no: 9, name: 'Pak Mandar Aji', role: 'HSE System Superintendent', phone: '081217310777', email: 'mandar68@gmail.com' },
      { no: 10, name: 'Pak Rachma', role: 'HSE Manager', phone: '081348481228', email: 'rachma.kanchandani@gmail.com' },
      { no: 11, name: 'Pak Cecep Sudrajat', role: 'Manager Engineering and Development', phone: '081155026252', email: 'cv.sudrajat@gmail.com' },
      { no: 12, name: 'Pak Lucky Wibowo', role: 'Direktur Operational', phone: '081184248252', email: 'luckywibowo@gmail.com' },
      { no: 13, name: 'Pak Agus Wiranasya Oscar', role: 'KTT / Direktur ISP', phone: '081195625046', email: 'oscar.agus@gmail.com' },
      { no: 14, name: 'Pak Lucky Wibowo', role: 'Direktur Operational', phone: '081184248252', email: 'lucky.wibowo@gmail.com' },
      { no: 15, name: 'Pak Agus Wiranasya Oscar', role: 'KTT / Direktur ISP', phone: '081195625046', email: 'oscar.agus@yahoo.co.id' }
    ]
  }
};

export function TarpComponent({ radarName }: TarpProps) {
  const [expandedTrigger, setExpandedTrigger] = useState<string | null>(null);
  const [showContacts, setShowContacts] = useState(false);
  const [showDocumentView, setShowDocumentView] = useState(false);

  const getTriggerColor = (level: string) => {
    switch (level) {
      case 'grey': return 'var(--color-dtg-gray-400)';
      case 'green': return 'var(--color-dtg-success-green)';
      case 'yellow': return 'var(--color-dtg-warning-yellow)';
      case 'orange': return 'var(--color-dtg-accent-orange)';
      case 'red': return 'var(--color-dtg-danger-red)';
      case 'critical': return 'var(--color-dtg-danger-red)';
      default: return 'var(--color-dtg-gray-400)';
    }
  };

  const getTriggerBgColor = (level: string) => {
    switch (level) {
      case 'grey': return 'bg-gray-500/10';
      case 'green': return 'bg-green-500/10';
      case 'yellow': return 'bg-yellow-500/10';
      case 'orange': return 'bg-orange-500/10';
      case 'red': return 'bg-red-500/10';
      case 'critical': return 'bg-red-500/20';
      default: return 'bg-gray-500/10';
    }
  };

  const getTriggerIcon = (level: string) => {
    switch (level) {
      case 'grey': return <Shield className="w-4 h-4" />;
      case 'green': return <Clock className="w-4 h-4" />;
      case 'yellow': return <AlertTriangle className="w-4 h-4" />;
      case 'orange': return <Zap className="w-4 h-4" />;
      case 'red': return <AlertTriangle className="w-4 h-4" />;
      case 'critical': return <Bell className="w-4 h-4" />;
      default: return <Shield className="w-4 h-4" />;
    }
  };

  // Show document view if requested
  if (showDocumentView) {
    return (
      <TarpDocumentView 
        radarName={radarName}
        onClose={() => setShowDocumentView(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* TARP Header */}
      <Card className="bg-[var(--color-dtg-bg-card)] border-[var(--color-dtg-border-light)] overflow-hidden">
        <div className="relative">
          {/* Futuristic header background */}
          <div className="bg-gradient-to-r from-[var(--color-dtg-primary-teal)] to-[var(--color-dtg-primary-teal-dark)] p-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--color-dtg-accent-orange)]/10 to-transparent"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-[var(--color-dtg-accent-orange)] rounded-lg flex items-center justify-center">
                    <Shield className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{tarpData.title}</h2>
                    <p className="text-[var(--color-dtg-accent-orange-light)] font-medium">{tarpData.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Button
                    size="sm"
                    onClick={() => setShowDocumentView(true)}
                    className="bg-white/10 hover:bg-white/20 text-white border-white/30"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    View as Document
                  </Button>
                  <Badge className="bg-[var(--color-dtg-accent-orange)]/20 text-[var(--color-dtg-accent-orange)] border-[var(--color-dtg-accent-orange)]/30">
                    Active Protocol
                  </Badge>
                </div>
              </div>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                <div className="bg-black/20 rounded-lg p-3">
                  <p className="text-xs text-[var(--color-dtg-text-muted)] mb-1">Draft Proposed</p>
                  <p className="text-sm text-white font-medium">{tarpData.metadata.draftProposed}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <p className="text-xs text-[var(--color-dtg-text-muted)] mb-1">Approved By</p>
                  <p className="text-sm text-white font-medium">{tarpData.metadata.approved}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <p className="text-xs text-[var(--color-dtg-text-muted)] mb-1">Date</p>
                  <p className="text-sm text-white font-medium">{tarpData.metadata.date}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <p className="text-xs text-[var(--color-dtg-text-muted)] mb-1">Revision</p>
                  <p className="text-sm text-white font-medium">{tarpData.metadata.revision}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Applied to radar badge */}
          <div className="p-4 bg-[var(--color-dtg-bg-secondary)] border-b border-[var(--color-dtg-border-light)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-[var(--color-dtg-accent-orange)]" />
                <span className="text-sm font-medium text-[var(--color-dtg-text-primary)]">
                  Applied to: <span className="text-[var(--color-dtg-accent-orange)]">{radarName}</span>
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-[var(--color-dtg-success-green)] rounded-full animate-pulse"></div>
                <span className="text-xs text-[var(--color-dtg-success-green)]">Active</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Primary Trigger Response Chart */}
      <Card className="p-6 bg-[var(--color-dtg-bg-card)] border-[var(--color-dtg-border-light)]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--color-dtg-text-primary)]">
            Primary Trigger Response Chart
          </h3>
          <Badge variant="outline" className="border-[var(--color-dtg-border-medium)] text-[var(--color-dtg-text-secondary)]">
            {tarpData.triggers.length} Trigger Levels
          </Badge>
        </div>

        <div className="space-y-3">
          {tarpData.triggers.map((trigger) => (
            <div 
              key={trigger.id} 
              className={`border rounded-lg transition-all duration-200 ${
                expandedTrigger === trigger.id 
                  ? 'border-[var(--color-dtg-accent-orange)] shadow-lg' 
                  : 'border-[var(--color-dtg-border-light)] hover:border-[var(--color-dtg-border-medium)]'
              }`}
            >
              {/* Trigger Header */}
              <div 
                className={`p-4 cursor-pointer ${getTriggerBgColor(trigger.level)} hover:bg-opacity-15 transition-colors`}
                onClick={() => setExpandedTrigger(expandedTrigger === trigger.id ? null : trigger.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ 
                        backgroundColor: getTriggerColor(trigger.level) + '20',
                        color: getTriggerColor(trigger.level)
                      }}
                    >
                      {getTriggerIcon(trigger.level)}
                    </div>
                    <div>
                      <h4 className="font-medium text-[var(--color-dtg-text-primary)]">
                        {trigger.trigger}
                      </h4>
                      <p className="text-xs text-[var(--color-dtg-text-muted)]">
                        Level: <span style={{ color: getTriggerColor(trigger.level) }}>{trigger.level.toUpperCase()}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge 
                      className="border-0 text-xs"
                      style={{ 
                        backgroundColor: getTriggerColor(trigger.level) + '20',
                        color: getTriggerColor(trigger.level)
                      }}
                    >
                      {trigger.level.toUpperCase()}
                    </Badge>
                    {expandedTrigger === trigger.id ? (
                      <ChevronUp className="w-4 h-4 text-[var(--color-dtg-text-muted)]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[var(--color-dtg-text-muted)]" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedTrigger === trigger.id && (
                <div className="border-t border-[var(--color-dtg-border-light)] bg-[var(--color-dtg-bg-secondary)]/50">
                  <div className="p-4 space-y-4">
                    
                    {/* Response Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Day Shift */}
                      <div className="bg-[var(--color-dtg-bg-card)] border border-[var(--color-dtg-border-light)] rounded-lg p-4">
                        <h5 className="font-medium text-[var(--color-dtg-text-primary)] mb-3 flex items-center">
                          <Clock className="w-4 h-4 mr-2 text-[var(--color-dtg-warning-yellow)]" />
                          Day Shift Response
                        </h5>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Phone className="w-3 h-3 text-[var(--color-dtg-info-blue)]" />
                            <span className="text-xs text-[var(--color-dtg-text-secondary)]">{trigger.dayShift.geotech}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Users className="w-3 h-3 text-[var(--color-dtg-success-green)]" />
                            <span className="text-xs text-[var(--color-dtg-text-secondary)]">{trigger.dayShift.messaging}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Mail className="w-3 h-3 text-[var(--color-dtg-accent-orange)]" />
                            <span className="text-xs text-[var(--color-dtg-text-secondary)]">{trigger.dayShift.email}</span>
                          </div>
                        </div>
                      </div>

                      {/* Night Shift */}
                      <div className="bg-[var(--color-dtg-bg-card)] border border-[var(--color-dtg-border-light)] rounded-lg p-4">
                        <h5 className="font-medium text-[var(--color-dtg-text-primary)] mb-3 flex items-center">
                          <Clock className="w-4 h-4 mr-2 text-[var(--color-dtg-info-blue)]" />
                          Night Shift Response
                        </h5>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Phone className="w-3 h-3 text-[var(--color-dtg-info-blue)]" />
                            <span className="text-xs text-[var(--color-dtg-text-secondary)]">{trigger.nightShift.geotech}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Users className="w-3 h-3 text-[var(--color-dtg-success-green)]" />
                            <span className="text-xs text-[var(--color-dtg-text-secondary)]">{trigger.nightShift.messaging}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Mail className="w-3 h-3 text-[var(--color-dtg-accent-orange)]" />
                            <span className="text-xs text-[var(--color-dtg-text-secondary)]">{trigger.nightShift.email}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Remarks */}
                    <div className="bg-[var(--color-dtg-bg-card)] border border-[var(--color-dtg-border-light)] rounded-lg p-4">
                      <h5 className="font-medium text-[var(--color-dtg-text-primary)] mb-3">Remarks & Procedure</h5>
                      <div className="space-y-2">
                        {trigger.remarks.map((remark, index) => (
                          <div key={index} className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 bg-[var(--color-dtg-accent-orange)] rounded-full mt-2 flex-shrink-0"></div>
                            <span className="text-xs text-[var(--color-dtg-text-secondary)] leading-relaxed">{remark}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Emergency Contact Information */}
      <Card className="p-6 bg-[var(--color-dtg-bg-card)] border-[var(--color-dtg-border-light)]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--color-dtg-text-primary)]">
            Emergency Contact Information
          </h3>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowContacts(!showContacts)}
            className="border-[var(--color-dtg-border-medium)]"
          >
            <Users className="w-4 h-4 mr-2" />
            {showContacts ? 'Hide Contacts' : 'Show Contacts'}
            {showContacts ? (
              <ChevronUp className="w-4 h-4 ml-2" />
            ) : (
              <ChevronDown className="w-4 h-4 ml-2" />
            )}
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-[var(--color-dtg-bg-secondary)] rounded-lg p-3 text-center">
            <div className="flex items-center justify-center mb-1">
              <Phone className="w-4 h-4 text-[var(--color-dtg-info-blue)]" />
            </div>
            <p className="text-lg font-bold text-[var(--color-dtg-text-primary)]">24/7</p>
            <p className="text-xs text-[var(--color-dtg-text-muted)]">Phone Line</p>
          </div>
          <div className="bg-[var(--color-dtg-bg-secondary)] rounded-lg p-3 text-center">
            <div className="flex items-center justify-center mb-1">
              <Users className="w-4 h-4 text-[var(--color-dtg-success-green)]" />
            </div>
            <p className="text-lg font-bold text-[var(--color-dtg-text-primary)]">{tarpData.contacts.primary.length}</p>
            <p className="text-xs text-[var(--color-dtg-text-muted)]">Primary Contacts</p>
          </div>
          <div className="bg-[var(--color-dtg-bg-secondary)] rounded-lg p-3 text-center">
            <div className="flex items-center justify-center mb-1">
              <Mail className="w-4 h-4 text-[var(--color-dtg-accent-orange)]" />
            </div>
            <p className="text-lg font-bold text-[var(--color-dtg-text-primary)]">{tarpData.contacts.distribution.length}</p>
            <p className="text-xs text-[var(--color-dtg-text-muted)]">Distribution List</p>
          </div>
        </div>

        {/* Contact Details */}
        {showContacts && (
          <div className="space-y-4">
            <div className="bg-[var(--color-dtg-bg-secondary)]/50 rounded-lg p-4">
              <h4 className="font-medium text-[var(--color-dtg-text-primary)] mb-3 flex items-center">
                <Phone className="w-4 h-4 mr-2 text-[var(--color-dtg-info-blue)]" />
                Primary Phone Line Contact
              </h4>
              <div className="text-center p-4 bg-[var(--color-dtg-bg-card)] rounded-lg border border-[var(--color-dtg-border-light)]">
                <p className="text-sm text-[var(--color-dtg-text-muted)] mb-2">
                  If no answer is received, an email and whatsapp message group will be sent by the GSS remote team to state this
                </p>
                <div className="flex items-center justify-center space-x-4 mt-3">
                  <Button size="sm" className="bg-[var(--color-dtg-info-blue)] hover:bg-[var(--color-dtg-info-blue-light)]">
                    <Phone className="w-4 h-4 mr-2" />
                    Emergency Hotline
                  </Button>
                  <Button size="sm" variant="outline" className="border-[var(--color-dtg-border-medium)]">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Full Directory
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 p-3 bg-[var(--color-dtg-warning-yellow)]/10 border border-[var(--color-dtg-warning-yellow)]/30 rounded-lg">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-[var(--color-dtg-warning-yellow)]" />
            <span className="text-sm font-medium text-[var(--color-dtg-warning-yellow)]">Important Note</span>
          </div>
          <p className="text-xs text-[var(--color-dtg-text-secondary)] mt-2">
            This TARP is specific to the Telfer West Dump monitoring system. All contact information and procedures 
            should be followed exactly as outlined. For system updates or modifications, contact the geotechnical team.
          </p>
        </div>
      </Card>
    </div>
  );
}