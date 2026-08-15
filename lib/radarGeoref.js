// lib/radarGeoref.js
//
// Supabase side of the radar scan georeference — the transform that places a
// wall folder's scans on the mine grid.
//
// The 3-D tool is a vendored static app in an iframe with no Supabase session
// of its own, so it asks the platform over postMessage and this module answers.
// See .kiro/specs/radar-scan-georef/migrations/001_radar_scan_georef.sql for
// why only the pose is stored and never the scan CSVs.

import { supabase } from '@/lib/supabaseClient'

const TABLE = 'radar_scan_georef'

/**
 * Database row -> the record shape the tool round-trips.
 *
 * The tool speaks camelCase and treats the record as opaque apart from
 * `mode` / `r` / `t`, so the mapping is the only place the two spellings meet.
 */
function toRecord(row) {
  if (!row) return null
  return {
    version: 1,
    key: row.scan_key,
    mode: row.mode,
    r: row.r,
    t: row.t,
    rms: row.rms,
    bearingDeg: row.bearing_deg,
    tiltDeg: row.tilt_deg,
    ties: row.ties ?? [],
    footprint: row.footprint ?? null,
    scans: row.scans ?? [],
    radar: row.radar_number,
    folder: row.folder_name,
    commenced: row.commenced,
    savedAt: row.updated_at ?? row.created_at,
  }
}

function toRow(key, record) {
  return {
    scan_key: key,
    radar_number: record.radar ?? null,
    folder_name: record.folder ?? null,
    commenced: record.commenced ?? null,
    mode: record.mode === 'rigid' ? 'rigid' : 'yaw',
    r: record.r,
    t: record.t,
    rms: record.rms ?? null,
    bearing_deg: record.bearingDeg ?? null,
    tilt_deg: record.tiltDeg ?? null,
    ties: record.ties ?? [],
    footprint: record.footprint ?? null,
    scans: record.scans ?? [],
  }
}

/**
 * Resolve the wall folder this key belongs to, if it has been commissioned.
 *
 * Best-effort by design: a radar often exports scans before its folder exists
 * in the platform, and refusing to save the georeference until the paperwork
 * catches up would throw away real work. The column stays null and the
 * migration's backfill picks it up later.
 */
async function resolveWallFolderId(record) {
  if (!record?.radar || !record?.folder) return null
  try {
    const { data: radar } = await supabase
      .from('radars')
      .select('id')
      .eq('radar_number', record.radar)
      .maybeSingle()
    if (!radar?.id) return null

    const { data: folder } = await supabase
      .from('radar_wall_folders')
      .select('id')
      .eq('radar_id', radar.id)
      .ilike('name', record.folder)
      .maybeSingle()
    return folder?.id ?? null
  } catch {
    return null
  }
}

/**
 * One wall folder's georeference, or null when it has never been placed.
 *
 * Throws on a failed lookup rather than returning null: to the tool those two
 * outcomes look identical, and reporting a database error as "not registered"
 * would send an operator off to re-survey tie points that already exist.
 */
export async function loadGeoref(key) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('scan_key', key)
    .maybeSingle()
  if (error) throw error
  return toRecord(data)
}

export async function saveGeoref(key, record) {
  const row = toRow(key, record)

  const wallfolderId = await resolveWallFolderId(record)
  if (wallfolderId) row.wallfolder_id = wallfolderId

  const { data: auth } = await supabase.auth.getUser()
  if (auth?.user?.id) row.created_by = auth.user.id

  // Upsert on scan_key so re-georeferencing corrects the existing pose instead
  // of adding a second one that later reads would have to choose between.
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'scan_key' })
    .select()
    .maybeSingle()
  if (error) throw error
  return toRecord(data)
}

export async function listGeoref() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toRecord)
}

export async function removeGeoref(key) {
  const { error } = await supabase.from(TABLE).delete().eq('scan_key', key)
  if (error) throw error
  return true
}

/**
 * Run one request from the embedded tool.
 *
 * Exported separately from the React component so the protocol can be tested
 * without mounting an iframe.
 */
export async function handleGeorefRequest(msg) {
  switch (msg?.op) {
    case 'ping':
      return true
    case 'load':
      return await loadGeoref(msg.key)
    case 'save':
      return await saveGeoref(msg.key, msg.record)
    case 'list':
      return await listGeoref()
    case 'remove':
      return await removeGeoref(msg.key)
    default:
      throw new Error(`unknown georeference operation: ${msg?.op}`)
  }
}
