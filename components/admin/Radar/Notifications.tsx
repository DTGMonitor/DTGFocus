
import React, { useState } from "react";
import {
  AlertTriangle, Bell, WifiOff, CheckCircle, Settings, TrendingUp,
  Filter, Search, Clock, MapPin, User, X, ChevronDown, Activity, Zap
} from 'lucide-react';
import { Input } from '@/components/LandingPage/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/LandingPage/ui/select';
import { Badge } from '@/components/LandingPage/ui/badge';
import { Button} from '@/components/LandingPage/ui/button';
import { getTypeConfig, getSeverityConfig } from '@/config/statusConfig';

interface Notification {
  id: string;
  type: 'deformation' | 'alarm' | 'downtime' | 'restored' | 'optimization' | 'system';
  title: string;
  message: string;
  location: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  read: boolean;
  actionRequired: boolean;
}

const notificationData: Notification[] = [
  {
    id: '1',
    type: 'deformation',
    title: 'Movement Detected - SSR-02',
    message: 'Linear deformation pattern detected at East Slope. Rate: 2.5mm/day',
    location: 'East Slope',
    timestamp: '2025-10-20 14:23',
    severity: 'warning',
    read: false,
    actionRequired: true,
  },
  {
    id: '2',
    type: 'alarm',
    title: 'Critical Alarm - IBIS01',
    message: 'Velocity threshold exceeded. Immediate review required',
    location: 'South Bench',
    timestamp: '2025-10-20 14:15',
    severity: 'critical',
    read: false,
    actionRequired: true,
  },
  {
    id: '3',
    type: 'downtime',
    title: 'Connection Lost - IBIS01',
    message: 'IBIS01 South Bench has lost connection. Last data received at 10:45',
    location: 'South Bench',
    timestamp: '2025-10-20 11:00',
    severity: 'critical',
    read: false,
    actionRequired: true,
  },
  {
    id: '4',
    type: 'restored',
    title: 'System Restored - SSR-01',
    message: 'SSR-01 North Wall has been restored and is now operational',
    location: 'North Wall',
    timestamp: '2025-10-20 10:30',
    severity: 'info',
    read: true,
    actionRequired: false,
  },
  {
    id: '5',
    type: 'deformation',
    title: 'Velocity Increase - SSR-02',
    message: 'Velocity has increased by 15% in the last 24 hours',
    location: 'East Slope',
    timestamp: '2025-10-20 09:45',
    severity: 'warning',
    read: false,
    actionRequired: true,
  },
  {
    id: '6',
    type: 'system',
    title: 'Data Quality Improved - SSR-03',
    message: 'Data quality parameters have returned to optimal levels',
    location: 'West Pit',
    timestamp: '2025-10-20 08:15',
    severity: 'info',
    read: true,
    actionRequired: false,
  },
  {
    id: '7',
    type: 'optimization',
    title: 'Alarm Threshold Optimized',
    message: 'PS2000 alarm thresholds have been automatically adjusted based on recent patterns',
    location: 'Central Area',
    timestamp: '2025-10-20 07:30',
    severity: 'info',
    read: true,
    actionRequired: false,
  },
];

export default function Notifications() {
  const [notifications, setNotifications] = useState(notificationData);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);

  const filteredNotifications = notifications.filter(n => {
    const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.message.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || n.type === filterType;
    const matchesSeverity = filterSeverity === 'all' || n.severity === filterSeverity;
    const matchesRead = !showOnlyUnread || !n.read;
    return matchesSearch && matchesType && matchesSeverity && matchesRead;
  });

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const deleteNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const criticalCount = notifications.filter(n => n.severity === 'critical' && !n.read).length;
  const actionRequiredCount = notifications.filter(n => n.actionRequired && !n.read).length;

  const typeStats = {
    deformation: notifications.filter(n => n.type === 'deformation' && !n.read).length,
    alarm: notifications.filter(n => n.type === 'alarm' && !n.read).length,
    downtime: notifications.filter(n => n.type === 'downtime' && !n.read).length,
    restored: notifications.filter(n => n.type === 'restored').length,
    optimization: notifications.filter(n => n.type === 'optimization').length,
    system: notifications.filter(n => n.type === 'system' && !n.read).length,
  };

  return (
    <div className="w-full space-y-4 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl text-[var(--dtg-text-primary)]">Notifications Center</h1>
            {unreadCount > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 px-3 py-1">
                {unreadCount} New
              </Badge>
            )}
          </div>
          <p className="text-[var(--dtg-gray-700)] text-sm">Monitor system alerts, events, and status updates</p>
        </div>
        <Button
          onClick={markAllAsRead}
          variant="brand"
        >
          Mark All as Read
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-6 gap-3">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <Bell className="w-5 h-5 text-[var(--dtg-primary-teal-dark)]" />
            <span className="text-2xl text-[var(--dtg-text-primary)]">{notifications.length}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-700)]">Total Notifications</p>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-2xl text-red-400">{criticalCount}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-700)]">Critical Alerts</p>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-orange-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-5 h-5 text-orange-400" />
            <span className="text-2xl text-orange-400">{actionRequiredCount}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-700)]">Action Required</p>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <span className="text-2xl text-blue-400">{typeStats.deformation}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-700)]">Deformation</p>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <WifiOff className="w-5 h-5 text-orange-400" />
            <span className="text-2xl text-orange-400">{typeStats.downtime}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-700)]">Downtime</p>
        </div>
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-2xl text-green-400">{typeStats.restored}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-700)]">Restored</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
        <div className="grid grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-700)]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notifications..."
              className="pl-10 bg-[var(--dtg-bg-primary)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="bg-[var(--dtg-bg-primary)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="deformation">Deformation</SelectItem>
              <SelectItem value="alarm">Alarm</SelectItem>
              <SelectItem value="downtime">Downtime</SelectItem>
              <SelectItem value="restored">Restored</SelectItem>
              <SelectItem value="optimization">Optimization</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="bg-[var(--dtg-bg-primary)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 px-4 py-2 bg-[var(--dtg-bg-primary)] border border-[var(--dtg-border-medium)] rounded-lg cursor-pointer hover:bg-[var(--dtg-bg-hover)] transition-all">
            <input
              type="checkbox"
              checked={showOnlyUnread}
              onChange={(e) => setShowOnlyUnread(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-500"
            />
            <span className="text-[var(--dtg-text-primary)] text-sm">Unread Only</span>
          </label>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg overflow-hidden">
        <div className="divide-y divide-[var(--dtg-primary)]]">
          {filteredNotifications.length === 0 ? (
            <div className="p-12 text-center">
              <Bell className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-[var(--dtg-gray-700)] text-lg">No notifications found</p>
              <p className="text-gray-500 text-sm mt-2">Try adjusting your filters</p>
            </div>
          ) : (
            filteredNotifications.map((notification) => {
              const typeConfig = getTypeConfig(notification.type);
              const severityConfig = getSeverityConfig(notification.severity);
              const Icon = typeConfig.icon;

              return (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-[var(--primary)]/50 transition-all border-l-4 ${severityConfig.borderLeft} ${!notification.read ? 'bg-[var(--primary)]/10' : ''
                    }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`w-12 h-12 rounded-lg ${typeConfig.bg} border ${typeConfig.border} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-6 h-6 ${typeConfig.color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`text-[var(--dtg-text-primary)] ${!notification.read ? 'font-semibold' : ''}`}>
                            {notification.title}
                          </h3>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
                          )}
                          {notification.actionRequired && (
                            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">
                              Action Required
                            </Badge>
                          )}
                        </div>
                        <button
                          onClick={() => deleteNotification(notification.id)}
                          className="p-1 hover:bg-red-500/20 rounded transition-all"
                        >
                          <X className="w-4 h-4 text-[var(--dtg-gray-700)] hover:text-red-400" />
                        </button>
                      </div>

                      <p className="text-[var(--dtg-gray-700)] text-sm mb-3">{notification.message}</p>

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{notification.timestamp}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>{notification.location}</span>
                        </div>
                        <Badge className={`${severityConfig.bg} ${severityConfig.color} border ${severityConfig.border} text-xs`}>
                          {notification.severity.toUpperCase()}
                        </Badge>
                        {!notification.read && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="ml-auto text-[var(--dtg-primary-teal-dark)] hover:text-teal-300 transition-colors"
                          >
                            Mark as Read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
