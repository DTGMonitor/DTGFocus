
import React, { useState, useCallback, useEffect } from "react";
import {
  AlertTriangle, Bell, WifiOff, CheckCircle, Settings, TrendingUp,
  Filter, Search, Clock, MapPin, User, X, ChevronDown, Activity, Zap
} from 'lucide-react';
import { Input } from '@/components/LandingPage/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/LandingPage/ui/select';
import { Badge } from '@/components/LandingPage/ui/badge';
import { Button } from '@/components/LandingPage/ui/button';
import { getCatConfig, getSeverityConfig } from '@/config/statusConfig';
import { supabase } from '@/lib/supabaseClient';
import { formatFromUTC } from "@/utils/timezoneUtils";
import { AddWorkLog } from '@/components/admin/Radar/Notifications/AddWorkLogModal';
import { useUserSite } from '@/components/Reusable/useUserSite';

interface Notification {
  id: string;
  category: 'deformation' | 'alarm' | 'downtime' | 'restored' | 'dqp';
  subject: { subject: string }[] | any;
  notes: string;
  location: string;
  created_at: string;
  action: string;
  wallfolder: { radar_id: { site_id: { timezone: string } } } | any;
  type: string;
  submitted_by: string;
}

interface Crosschecker {
  id: string;
  full_name: string;
}

interface UserSiteData {
  user_id: string;
  displayname: string;
  // Add other properties if you know them, e.g., site_name: string;
}

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotificationList, setLoadingNotificationList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');
  const [crosscheckers, setCrosscheckers] = useState<Crosschecker[]>([]);
  const [showModal, setShowModal] = useState(false);
  const { userSite, loading: siteLoading } = useUserSite() as { userSite: UserSiteData | null, loading: boolean };
  const userID = userSite?.user_id;

  const filteredNotifications = notifications.filter(n => {
    const matchesSearch = (n.subject?.subject || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (n.notes || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || n.type === filterType;
    const matchesCategory = filterCategory === 'all' || n.category === filterCategory;
    const matchesSubject = filterSubject === 'all' || n.subject?.subject.toLowerCase() === filterSubject;
    //const matchesRead = !showOnlyUnread;
    return matchesSearch && matchesType && matchesCategory && matchesSubject;
  });

  const deleteNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const typeStats = {
    deformation: notifications.filter(n => n.category === 'deformation').length,
    alarm: notifications.filter(n => n.category === 'alarm').length,
    downtime: notifications.filter(n => n.category === 'downtime').length,
    restored: notifications.filter(n => n.category === 'restored').length,
    dqp: notifications.filter(n => n.category === 'dqp').length,
    critical: notifications.filter(n => n.subject?.subject.toLowerCase() === 'critical').length,
    actionrequired: notifications.filter(n => n.action !== 'No action required').length
  };

  const fetchNotifications = useCallback(async () => {

    try {
      setLoadingNotificationList(true);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('work_log')
        .select('id, created_at,subject:subject(subject),wallfolder:radar_wall_folders(radar_id:radars(site_id:clients(site_name,timezone))),location,category,action,notes,type, submitted_by')
        .gte('created_at', twentyFourHoursAgo)
        .order('id', { ascending: false });

      if (error) throw error;
      console.log(data);

      setNotifications((data as Notification[]) || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoadingNotificationList(false);
    }
    ;
  }, []);

  useEffect(() => {
    fetchNotifications()
  },
    [fetchNotifications]);

  // Crosschecker
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const targetNames = ['Adib Izzuddin', 'Lintang Sadewa', 'Nurhuda Santoso', 'Nessy Salsabilita'];
        const { data, error } = await supabase.rpc('get_safe_crosscheckers', { target_names: targetNames });
        if (error) throw error;
        if (data) setCrosscheckers(data);
      } catch (err) {
        console.error("Error fetching crosscheckers:", err);
      }
    };
    fetchUsers();
  }, []);

  const getDisplayName = (userid: string) => {
    const user = crosscheckers.find((c) => String(c.id) === String(userid));
    return user ? user.full_name : 'Unknown';
  };


  return (
    <div className="w-full space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl text-[var(--dtg-text-primary)]">Notifications Center</h1>

            {/*<Badge className="bg-red-500/20 text-red-400 border-red-500/30 px-3 py-1">
              New
            </Badge>*/}

          </div>
          <p className="text-[var(--dtg-gray-700)] text-sm">Monitor system alerts, events, and status updates</p>
        </div>
        <Button variant='orange' onClick={() => setShowModal(true)}>
          + Add Activity
        </Button>
        <AddWorkLog isOpen={showModal} onClose={() => setShowModal(false)} userID={userID} onSuccess={()=>fetchNotifications()}/>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-6 gap-3">
        <div className="bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <Bell className="w-5 h-5 text-[var(--dtg-primary-teal-dark)]" />
            <span className="text-2xl text-[var(--dtg-text-primary)]">{notifications.length}</span>
          </div>
          <p className="text-xs text-[var(--dtg-gray-400)]">Total Notifications</p>
        </div>
        <div className="border rounded-lg p-4
    bg-gradient-to-br
    
    from-[var(--red-from)] 
    to-[var(--red-to)] 
    border-[var(--red-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-2xl text-red-400">{typeStats.critical}</span>
          </div>
          <p className="text-xs text-white">Critical Alerts</p>
        </div>
        <div className="border rounded-lg p-4
    bg-gradient-to-br
    
    from-[var(--yellow-from)] 
    to-[var(--yellow-to)] 
    border-[var(--yellow-border)]">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-5 h-5 text-orange-400" />
            <span className="text-2xl text-orange-400">{typeStats.actionrequired}</span>
          </div>
          <p className="text-xs text-white">Action Required</p>
        </div>
        <div className="border rounded-lg p-4
    bg-gradient-to-br
    
    from-[var(--blue-from)] 
    to-[var(--blue-to)] 
    border-[var(--blue-border)]">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <span className="text-2xl text-blue-400">{typeStats.deformation}</span>
          </div>
          <p className="text-xs text-white">Deformation</p>
        </div>
        <div className="border rounded-lg p-4
    bg-gradient-to-br
    
    from-[var(--orange-from)] 
    to-[var(--orange-to)] 
    border-[var(--orange-border)]">
          <div className="flex items-center justify-between mb-2">
            <WifiOff className="w-5 h-5 text-orange-400" />
            <span className="text-2xl text-orange-400">{typeStats.downtime}</span>
          </div>
          <p className="text-xs text-white">Downtime</p>
        </div>
        <div className="border rounded-lg p-4
    bg-gradient-to-br
    
    from-[var(--green-from)] 
    to-[var(--green-to)] 
    border-[var(--green-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-2xl text-green-400">{typeStats.restored}</span>
          </div>
          <p className="text-xs text-white">Restored</p>
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
              <SelectItem value="radar">Radar</SelectItem>
              <SelectItem value="insar">Insar</SelectItem>
              <SelectItem value="prism">Prism</SelectItem>
              <SelectItem value="emesent">Emesent</SelectItem>
              <SelectItem value="dashboard">Dashboard</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="bg-[var(--dtg-bg-primary)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="deformation">Deformation</SelectItem>
              <SelectItem value="alarm">Alarm</SelectItem>
              <SelectItem value="downtime">Downtime</SelectItem>
              <SelectItem value="restored">Restored</SelectItem>
              <SelectItem value="dqp">Data Quality</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="bg-[var(--dtg-bg-primary)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
              <SelectItem value="all">All Subjects</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="moderate risk">Moderate Risk</SelectItem>
              <SelectItem value="service offline">Service Offline</SelectItem>
              <SelectItem value="notification only">Notification Only</SelectItem>
            </SelectContent>
          </Select>
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
              const typeConfig = getCatConfig(notification.type);
              const severityConfig = getSeverityConfig(notification?.subject?.subject.toLowerCase())
              const Icon = typeConfig.icon;
              const timezone = "Asia/Jakarta";
              const LocalTime = formatFromUTC(notification.created_at, timezone);
              const actionBadge = notification.action?.length > 16 ? "Action Required" : notification.action;

              return (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-[var(--primary)]/50 transition-all border-l-4 'bg-[var(--primary)]/10'
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
                          <h3 className={`text-[var(--dtg-text-primary)] text-lg font-bold`}>
                            {notification.category.toUpperCase()}
                          </h3>

                          <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
                          <Badge className={`${severityConfig.bg} ${severityConfig.color} border ${severityConfig.border} text-xs`}>
                            {notification.subject?.subject}
                          </Badge>
                          {notification.action !== 'No action required' && (
                            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">
                              {actionBadge}
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

                      <p className="text-[var(--dtg-gray-600)] text-sm mb-3">{notification.notes}</p>

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{LocalTime}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>{notification.location}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          <span>{getDisplayName(notification.submitted_by)}</span>
                        </div>
                        {/*<Badge className={`${severityConfig.bg} ${severityConfig.color} border ${severityConfig.border} text-xs`}>
                          {notification.severity.toUpperCase()}
                        </Badge>
                        {!notification.read && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="ml-auto text-[var(--dtg-primary-teal-dark)] hover:text-teal-300 transition-colors"
                          >
                            Mark as Read
                          </button>
                        */}
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
