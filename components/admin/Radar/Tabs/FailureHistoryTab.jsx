import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Spinner } from '@/components/Reusable/Spinner';
import { formatTimestamp } from '@/utils/tabHelpers';
import {
  FAILURE_DEF_TYPE,
  FAILURE_FIELDS,
  VCP_SETS,
  statsByVcp,
  vcpUsage,
  numericStats,
  categoryCounts,
  extractVelocitySamples,
  formatStat,
  inverseUnit,
} from '@/utils/failureStats';
import { velocityUnit } from '@/utils/reportDefDetails';

/**
 * FailureHistoryTab
 *
 * Summary statistics over every Failure ever recorded on the open sensor's SITE
 * — every radar, every wall folder, archived folders included. Past failures
 * are what the next alarm threshold is calibrated against, and one wall folder
 * rarely holds enough of them to say anything.
 *
 * Read-only. Records are edited on the Deformation tab of their own folder.
 *
 * Props:
 *   sensor    {object} - needs `site_id`
 *   timezone  {string} - IANA timezone of the SITE
 *   activeTab {string} - re-fetches when switched to 'failures'
 */

const FAILURE_SELECT =
  'id, start, created_at, location, def_type, isactive, properties, wallfolder_id, ' +
  'wallfolder:radar_wall_folders!inner(id, name, area, type, radar:radars!inner(id, radar_number, site_id))';

const TH = 'px-3 py-2 text-left text-xs font-semibold text-[var(--dtg-text-secondary)] uppercase tracking-wide whitespace-nowrap';
const TD = 'px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]';
const SELECT =
  'bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-1.5 px-2 text-sm text-[var(--dtg-text-primary)] outline-none focus:border-[var(--dtg-brand-orange)]';

const pct = (share) => `${Math.round(share * 100)}%`;

function ModeCell({ mode, decimals }) {
  if (!mode.values.length) {
    return <span title="No value repeats">—</span>;
  }
  const shown = mode.values.slice(0, 3).map((v) => formatStat(v, decimals)).join(', ');
  const more = mode.values.length > 3 ? ` +${mode.values.length - 3}` : '';
  return (
    <span title={mode.count > 1 ? `Occurs ${mode.count}×` : undefined}>
      {shown}{more}
      {mode.count > 1 && <span className="text-[var(--dtg-text-muted)]"> ({mode.count}×)</span>}
    </span>
  );
}

const STAT_COLUMNS = ['n', 'Mean', 'Mode', 'Median', 'P90', 'Min', 'Max'];

function StatCells({ stats, decimals }) {
  return (
    <>
      <td className={TD}>{stats.n}</td>
      <td className={`${TD} font-medium text-[var(--dtg-text-primary)]`}>{formatStat(stats.mean, decimals)}</td>
      <td className={TD}><ModeCell mode={stats.mode} decimals={decimals} /></td>
      <td className={`${TD} font-medium text-[var(--dtg-text-primary)]`}>{formatStat(stats.median, decimals)}</td>
      <td className={`${TD} font-medium text-[var(--dtg-text-primary)]`}>{formatStat(stats.p90, decimals)}</td>
      <td className={TD}>{formatStat(stats.min, decimals)}</td>
      <td className={TD}>{formatStat(stats.max, decimals)}</td>
    </>
  );
}

function StatTable({ leading, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]">
            {[...leading, ...STAT_COLUMNS].map((col) => (
              <th key={col} className={TH}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

const Row = ({ children }) => (
  <tr className="border-b border-[var(--dtg-border-light)] hover:bg-[var(--dtg-bg-secondary)] transition-colors">
    {children}
  </tr>
);

const Empty = ({ children }) => (
  <p className="py-6 text-center text-sm text-[var(--dtg-text-muted)]">{children}</p>
);

export default function FailureHistoryTab({ sensor, timezone, activeTab }) {
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [field, setField] = useState('inverseVelocity');
  const [vcpSet, setVcpSet] = useState('all');
  const [showRecords, setShowRecords] = useState(false);

  const fetchFailures = useCallback(async () => {
    if (!sensor?.site_id) {
      setError('This sensor has no site, so there is no failure history to summarise.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('def_records')
        .select(FAILURE_SELECT)
        .eq('def_type', FAILURE_DEF_TYPE)
        .eq('wallfolder.radar.site_id', sensor.site_id)
        .order('start', { ascending: false, nullsFirst: false });
      if (fetchError) throw fetchError;
      setRecords(data || []);
    } catch (err) {
      console.error('Error fetching failure history:', err);
      setError('Failed to load the failure history for this site.');
    } finally {
      setIsLoading(false);
    }
  }, [sensor?.site_id]);

  useEffect(() => {
    if (activeTab === 'failures') fetchFailures();
  }, [activeTab, fetchFailures]);

  const fieldDef = FAILURE_FIELDS.find((f) => f.key === field);

  const scope = useMemo(() => {
    const radars = new Set(records.map((r) => r.wallfolder?.radar?.radar_number).filter(Boolean));
    const folders = new Set(records.map((r) => r.wallfolder_id));
    return { radars: radars.size, folders: folders.size };
  }, [records]);

  const summary = useMemo(() => {
    switch (fieldDef.kind) {
      case 'by-vcp': return { rows: statsByVcp(records, field, vcpSet) };
      case 'vcp': return vcpUsage(records, vcpSet);
      case 'numeric': return { stats: numericStats(records, fieldDef.prop, fieldDef.decimals) };
      default: return { counts: categoryCounts(records, fieldDef.prop) };
    }
  }, [records, field, fieldDef, vcpSet]);

  const usesVcpSet = fieldDef.kind === 'by-vcp' || fieldDef.kind === 'vcp';

  const renderSummary = () => {
    const { decimals } = fieldDef;

    if (fieldDef.kind === 'by-vcp') {
      if (!summary.rows.length) return <Empty>No {fieldDef.label.toLowerCase()} recorded on these failures.</Empty>;
      return (
        <StatTable
          leading={['VCP (min)', 'Unit', 'Failures']}
          rows={summary.rows.map((row) => (
            <Row key={row.vcp ?? 'none'}>
              <td className={`${TD} font-medium text-[var(--dtg-text-primary)]`}>
                {row.vcp === null ? <span className="italic text-[var(--dtg-text-muted)]">Not recorded</span> : formatStat(row.vcp, 0)}
              </td>
              <td className={TD}>{row.unit ?? '—'}</td>
              <td className={TD}>{row.records}</td>
              <StatCells stats={row} decimals={decimals} />
            </Row>
          ))}
        />
      );
    }

    if (fieldDef.kind === 'vcp') {
      if (!summary.usage.length) return <Empty>No VCP recorded on these failures.</Empty>;
      return (
        <div className="space-y-4">
          <StatTable
            leading={['Unit']}
            rows={<Row><td className={TD}>min</td><StatCells stats={summary.stats} decimals={decimals} /></Row>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]">
                  {['VCP (min)', 'Velocity unit', 'Failures using it', 'Share'].map((col) => (
                    <th key={col} className={TH}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.usage.map((u) => (
                  <Row key={u.vcp}>
                    <td className={`${TD} font-medium text-[var(--dtg-text-primary)]`}>{formatStat(u.vcp, 0)}</td>
                    <td className={TD}>{velocityUnit(u.vcp)} · {inverseUnit(u.vcp)}</td>
                    <td className={TD}>{u.records}</td>
                    <td className={TD}>{pct(u.share)}</td>
                  </Row>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (fieldDef.kind === 'numeric') {
      if (!summary.stats.n) return <Empty>No {fieldDef.label.toLowerCase()} recorded on these failures.</Empty>;
      return (
        <StatTable
          leading={['Unit']}
          rows={<Row><td className={TD}>{fieldDef.unit ?? '—'}</td><StatCells stats={summary.stats} decimals={decimals} /></Row>}
        />
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]">
              {[fieldDef.label, 'Failures', 'Share'].map((col) => (
                <th key={col} className={TH}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.counts.map((c) => (
              <Row key={c.label}>
                <td className={`${TD} ${c.blank ? 'italic text-[var(--dtg-text-muted)]' : 'font-medium text-[var(--dtg-text-primary)]'}`}>{c.label}</td>
                <td className={TD}>{c.count}</td>
                <td className={TD}>{pct(c.share)}</td>
              </Row>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderRecords = () => {
    const samplesByRecord = new Map();
    for (const s of extractVelocitySamples(records)) {
      if (!samplesByRecord.has(s.recordId)) samplesByRecord.set(s.recordId, {});
      samplesByRecord.get(s.recordId)[s.set] = s;
    }
    const velocityCell = (s) => {
      if (!s) return '—';
      const parts = [];
      if (s.velocity !== null) parts.push(`${formatStat(s.velocity, 2)} ${s.vcp !== null ? velocityUnit(s.vcp) : ''}`.trim());
      if (s.inverseVelocity !== null) {
        parts.push(`${formatStat(s.inverseVelocity, 4)} ${s.vcp !== null ? inverseUnit(s.vcp) : ''}${s.inverseDerived ? '*' : ''}`.trim());
      }
      return (
        <span>
          {parts.join(' / ') || '—'}
          {s.vcp !== null && <span className="text-[var(--dtg-text-muted)]"> @ {formatStat(s.vcp, 0)} min</span>}
        </span>
      );
    };

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]">
              {['Event time', 'Radar', 'Wall folder', 'Location', 'Short VCP (V / 1/V)', 'Long VCP (V / 1/V)', 'Max def.', 'Coherence', 'Type', 'Materials'].map((col) => (
                <th key={col} className={TH}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const p = r.properties || {};
              const sets = samplesByRecord.get(r.id) || {};
              const archived = r.wallfolder?.type === 'Archive';
              return (
                <Row key={r.id}>
                  <td className={TD}>{formatTimestamp(r.start || r.created_at, timezone)}</td>
                  <td className={`${TD} font-medium text-[var(--dtg-text-primary)]`}>{r.wallfolder?.radar?.radar_number ?? '—'}</td>
                  <td className={TD}>
                    {r.wallfolder?.name ?? '—'}
                    {archived && <span className="ml-1 text-xs text-[var(--dtg-text-muted)]">(archived)</span>}
                  </td>
                  <td className={`${TD} max-w-[160px] truncate`} title={r.location || undefined}>{r.location || '—'}</td>
                  <td className={TD}>{velocityCell(sets[1])}</td>
                  <td className={TD}>{velocityCell(sets[2])}</td>
                  <td className={TD}>{p.MaximumDeformation ?? '—'}</td>
                  <td className={TD}>{p.Coherence ?? '—'}</td>
                  <td className={TD}>{p.TypeOfFailure || '—'}</td>
                  <td className={TD}>{p.Materials || '—'}</td>
                </Row>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--dtg-text-muted)]">* Inverse velocity not stored on the record; derived as 1 / Vmax.</p>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (error) {
    return <p className="py-8 text-center text-sm text-red-500">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--dtg-text-primary)]">
            Failure history — {sensor.site_name || 'this site'}
          </h3>
          <p className="text-xs text-[var(--dtg-text-muted)]">
            {records.length} failure{records.length === 1 ? '' : 's'} across {scope.radars} radar{scope.radars === 1 ? '' : 's'} and {scope.folders} wall folder{scope.folders === 1 ? '' : 's'}, archived folders included.
          </p>
        </div>

        {records.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--dtg-text-muted)]">
              Field
              <select value={field} onChange={(e) => setField(e.target.value)} className={SELECT}>
                <optgroup label="Key">
                  {FAILURE_FIELDS.filter((f) => f.primary).map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Additional">
                  {FAILURE_FIELDS.filter((f) => !f.primary).map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            {usesVcpSet && (
              <label className="flex flex-col gap-1 text-xs text-[var(--dtg-text-muted)]">
                VCP set
                <select value={vcpSet} onChange={(e) => setVcpSet(e.target.value)} className={SELECT}>
                  {VCP_SETS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <Empty>No failures have been recorded on this site.</Empty>
      ) : (
        <>
          {renderSummary()}

          {fieldDef.kind !== 'category' && (
            <p className="text-xs text-[var(--dtg-text-muted)]">
              {fieldDef.kind === 'by-vcp' && 'Grouped by the VCP each value was measured over — values from different VCPs are never averaged together. '}
              P90 is the value 90% of failures reached or exceeded (smallest 10% excluded; 10th percentile, as Excel PERCENTILE.INC). Mode is shown only when a value repeats.
            </p>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowRecords((v) => !v)}
              className="text-sm font-medium text-[var(--dtg-brand-orange)] hover:underline"
            >
              {showRecords ? 'Hide' : 'Show'} the {records.length} failure record{records.length === 1 ? '' : 's'}
            </button>
            {showRecords && <div className="mt-2">{renderRecords()}</div>}
          </div>
        </>
      )}
    </div>
  );
}
