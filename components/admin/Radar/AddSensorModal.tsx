"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabaseClient";
import toast from "react-hot-toast";
import { Loader } from "lucide-react";
import {
  buildInitialDqpValues,
  describeParameterSet,
  type ParameterRow,
} from "@/config/radarParameterSets";

const NEW = "__new__";

interface ClientOption {
  id: number;
  site_name: string;
}

interface BrandOption {
  id: number;
  brand: string;
  color: string | null;
}

interface AddSensorModalProps {
  isOpen: boolean;
  onClose: () => void;
  userID?: string;
  onSuccess?: () => void;
}

const emptySite = {
  site_name: "",
  location: "",
  company: "",
  timezone: "",
  stock_code: "",
  place_id: "",
  latitude: "",
  longitude: "",
};

const emptyBrand = { brand: "", color: "#F8901F" };

/** Matches the UTC+7 "today" used by the hourly checklist in RadarMonitoring. */
const todayUtc7 = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split("T")[0];

export default function AddSensorModal({ isOpen, onClose, userID, onSuccess }: AddSensorModalProps) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [parameters, setParameters] = useState<ParameterRow[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [radarNumber, setRadarNumber] = useState("");
  const [siteId, setSiteId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [station, setStation] = useState("1");
  const [wallFolderName, setWallFolderName] = useState("");
  const [wallFolderArea, setWallFolderArea] = useState("");
  const [newSite, setNewSite] = useState(emptySite);
  const [newBrand, setNewBrand] = useState(emptyBrand);

  const isNewSite = siteId === NEW;
  const isNewBrand = brandId === NEW;

  const resetForm = useCallback(() => {
    setRadarNumber("");
    setSiteId("");
    setBrandId("");
    setStation("1");
    setWallFolderName("");
    setWallFolderArea("");
    setNewSite(emptySite);
    setNewBrand(emptyBrand);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      setLoadingOptions(true);
      try {
        const [clientRes, brandRes, paramRes] = await Promise.all([
          supabase.from("clients").select("id, site_name").order("site_name"),
          supabase.from("brand").select("id, brand, color").order("brand"),
          supabase.from("parameters").select("id, name, parent_id, level, weight").order("id"),
        ]);

        if (cancelled) return;
        if (clientRes.error) throw clientRes.error;
        if (brandRes.error) throw brandRes.error;
        if (paramRes.error) throw paramRes.error;

        setClients(clientRes.data || []);
        setBrands(brandRes.data || []);
        setParameters((paramRes.data as ParameterRow[]) || []);
      } catch (err) {
        console.error("Failed to load sensor form options:", err);
        if (!cancelled) toast.error("Could not load sites, brands and parameters.");
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const validate = (): string | null => {
    if (!userID) return "User ID not available. Please refresh the page.";
    if (!radarNumber.trim()) return "Radar number is required.";
    if (!siteId) return "Please choose a site.";
    if (!brandId) return "Please choose a brand.";
    if (!wallFolderName.trim()) return "Wall folder name is required.";
    if (!wallFolderArea.trim()) return "Wall folder area is required.";

    const stationNumber = Number(station);
    if (!Number.isInteger(stationNumber) || stationNumber < 1) return "Station must be a whole number of 1 or more.";

    if (isNewSite) {
      if (!newSite.site_name.trim()) return "New site needs a site name.";
      if (!newSite.location.trim()) return "New site needs a location.";
      if (!newSite.company.trim()) return "New site needs a company.";
      if (!newSite.timezone.trim()) return "New site needs a timezone.";
      if (newSite.latitude !== "" && Number.isNaN(Number(newSite.latitude))) return "Latitude must be a number.";
      if (newSite.longitude !== "" && Number.isNaN(Number(newSite.longitude))) return "Longitude must be a number.";
    }

    if (isNewBrand && !newBrand.brand.trim()) return "New brand needs a name.";
    if (parameters.length === 0) return "Parameter list did not load; cannot seed data quality values.";

    return null;
  };

  const handleSubmit = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }

    setSubmitting(true);

    // Track what we create so a late failure doesn't leave orphans behind.
    const created: { table: string; id: number }[] = [];
    const rollback = async () => {
      for (const row of [...created].reverse()) {
        const { error } = await supabase.from(row.table).delete().eq("id", row.id);
        if (error) console.error(`Rollback failed for ${row.table} id ${row.id}:`, error);
      }
    };

    try {
      // 1. Site (optional)
      let resolvedSiteId = Number(siteId);
      if (isNewSite) {
        const { data, error } = await supabase
          .from("clients")
          .insert({
            site_name: newSite.site_name.trim(),
            location: newSite.location.trim(),
            company: newSite.company.trim(),
            timezone: newSite.timezone.trim(),
            stock_code: newSite.stock_code.trim() || null,
            place_id: newSite.place_id.trim() || null,
            latitude: newSite.latitude === "" ? null : Number(newSite.latitude),
            longitude: newSite.longitude === "" ? null : Number(newSite.longitude),
          })
          .select("id")
          .single();
        if (error) throw error;
        resolvedSiteId = data.id;
        created.push({ table: "clients", id: data.id });
      }

      // 2. Brand (optional)
      let resolvedBrandId = Number(brandId);
      if (isNewBrand) {
        const { data, error } = await supabase
          .from("brand")
          .insert({ brand: newBrand.brand.trim(), color: newBrand.color })
          .select("id")
          .single();
        if (error) throw error;
        resolvedBrandId = data.id;
        created.push({ table: "brand", id: data.id });
      }

      const now = new Date().toISOString();
      const recordDate = todayUtc7();

      // 3. Radar
      const { data: radar, error: radarError } = await supabase
        .from("radars")
        .insert({
          radar_number: radarNumber.trim(),
          site_id: resolvedSiteId,
          commenced_at: recordDate, // radars.commenced_at is a date
          brand_id: resolvedBrandId,
          station: Number(station),
        })
        .select("id")
        .single();
      if (radarError) throw radarError;
      created.push({ table: "radars", id: radar.id });

      // 4. Wall folder
      const { data: wallFolder, error: wallFolderError } = await supabase
        .from("radar_wall_folders")
        .insert({
          radar_id: radar.id,
          name: wallFolderName.trim(),
          area: wallFolderArea.trim(),
          type: "Live",
          commenced_at: now, // radar_wall_folders.commenced_at is a timestamptz
        })
        .select("id")
        .single();
      if (wallFolderError) throw wallFolderError;
      created.push({ table: "radar_wall_folders", id: wallFolder.id });

      // 5. DQP record - 24 unchecked hourly slots
      const { data: record, error: recordError } = await supabase
        .from("dqp_records")
        .insert({
          radar_id: radar.id,
          wall_folder_id: wallFolder.id,
          record_date: recordDate,
          created_time: now,
          created_by: userID,
          notes: null,
          action: null,
          checklist: Array(24).fill(false),
        })
        .select("id")
        .single();
      if (recordError) throw recordError;
      created.push({ table: "dqp_records", id: record.id });

      // 6. Seed DQP values for the parameters this radar model actually has
      const values = buildInitialDqpValues(radarNumber.trim(), parameters, record.id);
      const { error: valuesError } = await supabase.from("dqp_values").insert(values);
      if (valuesError) throw valuesError;

      toast.success(`${radarNumber.trim()} added with ${values.length} data quality parameters.`);
      resetForm();
      onSuccess?.();
      onClose();
    } catch (err) {
      const message = (err as { message?: string })?.message || "Unknown error";
      console.error("Failed to add sensor:", err);
      toast.error(`Could not add sensor: ${message}`);
      await rollback();
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !submitting) onClose();
  };

  const field = "space-y-1.5";
  const labelClass = "text-sm text-[var(--dtg-text-primary)]";
  const hintClass = "text-xs text-[var(--dtg-gray-700)]";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)]">
        <DialogHeader>
          <DialogTitle>Add New Sensor</DialogTitle>
          <p className={hintClass}>
            Creates the radar, its live wall folder, today&apos;s DQP record and an initial set of optimal
            parameter values.
          </p>
        </DialogHeader>

        {loadingOptions ? (
          <div className="flex items-center justify-center py-10 text-[var(--dtg-gray-700)]">
            <Loader size={18} className="animate-spin mr-2" />
            Loading sites and brands...
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            {/* Radar number */}
            <div className={field}>
              <label className={labelClass}>Radar Number *</label>
              <Input
                value={radarNumber}
                onChange={(e) => setRadarNumber(e.target.value)}
                placeholder="e.g. SSR994FX, PS2000, MSR254"
              />
              {radarNumber.trim() !== "" && parameters.length > 0 && (
                <p className={hintClass}>{describeParameterSet(radarNumber.trim(), parameters.length)}</p>
              )}
            </div>

            {/* Site */}
            <div className={field}>
              <label className={labelClass}>Site *</label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border border-[var(--dtg-border-medium)]">
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.site_name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW}>+ Add new site...</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isNewSite && (
              <div className="grid gap-3 rounded-md border border-[var(--dtg-border-medium)] p-3">
                <p className={labelClass}>New Site Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className={field}>
                    <label className={hintClass}>Site Name *</label>
                    <Input
                      value={newSite.site_name}
                      onChange={(e) => setNewSite({ ...newSite, site_name: e.target.value })}
                      placeholder="Telfer"
                    />
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Location *</label>
                    <Input
                      value={newSite.location}
                      onChange={(e) => setNewSite({ ...newSite, location: e.target.value })}
                      placeholder="Western Australia"
                    />
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Company *</label>
                    <Input
                      value={newSite.company}
                      onChange={(e) => setNewSite({ ...newSite, company: e.target.value })}
                      placeholder="Greatland Gold"
                    />
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Timezone *</label>
                    <Input
                      value={newSite.timezone}
                      onChange={(e) => setNewSite({ ...newSite, timezone: e.target.value })}
                      placeholder="Australia/Perth"
                      list="dtg-timezone-options"
                    />
                    <datalist id="dtg-timezone-options">
                      <option value="Australia/Perth" />
                      <option value="Australia/Brisbane" />
                      <option value="Australia/Sydney" />
                      <option value="Asia/Jakarta" />
                      <option value="Asia/Makassar" />
                      <option value="Asia/Jayapura" />
                    </datalist>
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Stock Code</label>
                    <Input
                      value={newSite.stock_code}
                      onChange={(e) => setNewSite({ ...newSite, stock_code: e.target.value })}
                      placeholder="GGP"
                    />
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Place ID (Meteostat)</label>
                    <Input
                      value={newSite.place_id}
                      onChange={(e) => setNewSite({ ...newSite, place_id: e.target.value })}
                      placeholder="telfer-dome"
                    />
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Latitude</label>
                    <Input
                      type="number"
                      step="any"
                      value={newSite.latitude}
                      onChange={(e) => setNewSite({ ...newSite, latitude: e.target.value })}
                      placeholder="-21.71"
                    />
                  </div>
                  <div className={field}>
                    <label className={hintClass}>Longitude</label>
                    <Input
                      type="number"
                      step="any"
                      value={newSite.longitude}
                      onChange={(e) => setNewSite({ ...newSite, longitude: e.target.value })}
                      placeholder="122.23"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Brand */}
            <div className={field}>
              <label className={labelClass}>Brand *</label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select brand" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border border-[var(--dtg-border-medium)]">
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-sm border border-[var(--dtg-border-medium)]"
                          style={{ backgroundColor: b.color || "transparent" }}
                        />
                        {b.brand}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW}>+ Add new brand...</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isNewBrand && (
              <div className="grid grid-cols-2 gap-3 rounded-md border border-[var(--dtg-border-medium)] p-3">
                <div className={field}>
                  <label className={hintClass}>Brand Name *</label>
                  <Input
                    value={newBrand.brand}
                    onChange={(e) => setNewBrand({ ...newBrand, brand: e.target.value })}
                    placeholder="GroundProbe"
                  />
                </div>
                <div className={field}>
                  <label className={hintClass}>Colour *</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newBrand.color}
                      onChange={(e) => setNewBrand({ ...newBrand, color: e.target.value })}
                      className="h-9 w-12 rounded-md border border-[var(--dtg-border-medium)] bg-transparent p-1 cursor-pointer"
                      aria-label="Brand colour"
                    />
                    <Input
                      value={newBrand.color}
                      onChange={(e) => setNewBrand({ ...newBrand, color: e.target.value })}
                      placeholder="#F8901F"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Station */}
            <div className={field}>
              <label className={labelClass}>Station *</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={station}
                onChange={(e) => setStation(e.target.value)}
              />
            </div>

            {/* Wall folder */}
            <div className="grid grid-cols-2 gap-3">
              <div className={field}>
                <label className={labelClass}>Wall Folder Name *</label>
                <Input
                  value={wallFolderName}
                  onChange={(e) => setWallFolderName(e.target.value)}
                  placeholder="SSR994_260721_Telfer_WestDome_Stage_8"
                />
              </div>
              <div className={field}>
                <label className={labelClass}>Area *</label>
                <Input
                  value={wallFolderArea}
                  onChange={(e) => setWallFolderArea(e.target.value)}
                  placeholder="Open Pit"
                  list="dtg-area-options"
                />
                <datalist id="dtg-area-options">
                  <option value="Open Pit" />
                  <option value="Tailing" />
                </datalist>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="brand" onClick={handleSubmit} disabled={submitting || loadingOptions}>
            {submitting && <Loader size={16} className="animate-spin mr-2" />}
            {submitting ? "Adding..." : "Add Sensor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
