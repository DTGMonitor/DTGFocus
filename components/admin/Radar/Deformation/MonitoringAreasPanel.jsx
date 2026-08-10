'use client';

/**
 * The monitoring-point board for one wall folder.
 *
 * Only rendered for radars whose daily report lists every point rather than
 * only what is moving (see config/movementTableStyle.ts). On those radars this
 * roster IS the report's Area column: a point missing from here does not print,
 * however carefully it was scanned, and a point left here after the wall
 * retired prints "TARP 1 / No Significant" forever. So it is edited beside the
 * deformation records rather than in an admin screen nobody opens.
 *
 * Deliberately NOT a second source of deformation truth. Nothing here creates,
 * closes or levels a record: an area's row on the report is still driven by the
 * active chains filed against it, and this list only decides which areas are
 * asked about. Retiring a point does not touch its history.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/Reusable/Spinner';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Check,
  X,
  Trash2,
  Archive,
  RotateCcw,
  MapPin,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { isDuplicateArea, moveArea, sortOrderUpdates } from '@/utils/monitoringAreas';
import { areaKey } from '@/utils/dailyStatusRows';

const SELECT = 'id, name, sort_order, isactive';

export default function MonitoringAreasPanel({ sensor, activeTab, defaultOpen = false }) {
  const wallFolderId = sensor?.wallfolder_id;

  const [areas, setAreas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [showRetired, setShowRetired] = useState(false);

  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchAreas = useCallback(async () => {
    if (!wallFolderId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('monitoring_areas')
        .select(SELECT)
        .eq('wallfolder_id', wallFolderId)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (fetchError) throw fetchError;
      setAreas(data ?? []);
    } catch (err) {
      console.error('Error loading monitoring areas:', err);
      setError('Failed to load monitoring points.');
    } finally {
      setIsLoading(false);
    }
  }, [wallFolderId]);

  useEffect(() => {
    if (activeTab === undefined || activeTab === 'deformation') fetchAreas();
  }, [activeTab, fetchAreas]);

  // Retired points are kept out of the way by default: they are history, and
  // the list an operator is checking against the wall is the live one.
  const active = useMemo(() => areas.filter((a) => a.isactive !== 'No'), [areas]);
  const retired = useMemo(() => areas.filter((a) => a.isactive === 'No'), [areas]);
  const visible = showRetired ? [...active, ...retired] : active;

  // ── Add ────────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (isDuplicateArea(areas, name)) {
      // Asked here as well as in the database, so the operator reads "already
      // listed" rather than a unique-constraint error.
      toast.error(`"${name}" is already on this board.`);
      return;
    }

    setIsAdding(true);
    try {
      const nextOrder = areas.reduce((max, a) => Math.max(max, Number(a.sort_order) || 0), 0) + 1;
      const { error: insertError } = await supabase
        .from('monitoring_areas')
        .insert({ wallfolder_id: wallFolderId, name, sort_order: nextOrder });
      if (insertError) throw insertError;

      setNewName('');
      toast.success(`${name} added. It prints on the next report.`);
      await fetchAreas();
    } catch (err) {
      console.error('Error adding monitoring area:', err);
      toast.error('Could not add the monitoring point.');
    } finally {
      setIsAdding(false);
    }
  };

  // ── Rename ─────────────────────────────────────────────────────────────────

  const startEdit = (area) => {
    setEditId(area.id);
    setEditName(area.name ?? '');
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName('');
  };

  const handleRename = async (area) => {
    const name = editName.trim();
    if (!name || name === area.name) {
      cancelEdit();
      return;
    }
    if (isDuplicateArea(areas, name, area.id)) {
      toast.error(`"${name}" is already on this board.`);
      return;
    }

    setBusyId(area.id);
    try {
      const { error: updateError } = await supabase
        .from('monitoring_areas')
        .update({ name })
        .eq('id', area.id);
      if (updateError) throw updateError;

      // A rename changes what the point is MATCHED on as well as what prints.
      // Records already filed under the old spelling stop matching and would
      // print as their own extra row, so the operator is told rather than left
      // to discover it on tomorrow's report.
      if (areaKey(name) !== areaKey(area.name)) {
        toast('Existing records filed under the old name will list separately.', { icon: 'ℹ️' });
      }
      cancelEdit();
      await fetchAreas();
    } catch (err) {
      console.error('Error renaming monitoring area:', err);
      toast.error('Could not rename the monitoring point.');
    } finally {
      setBusyId(null);
    }
  };

  // ── Order ──────────────────────────────────────────────────────────────────

  const handleMove = async (index, delta) => {
    const reordered = moveArea(active, index, delta);
    const updates = sortOrderUpdates(active, reordered);
    if (updates.length === 0) return;

    setBusyId(active[index]?.id ?? null);
    // Optimistic: reordering is the one action here that is used repeatedly,
    // and a round trip per click makes the list feel like it is fighting back.
    setAreas((prev) => {
      const byId = new Map(reordered.map((a) => [String(a.id), a.sort_order]));
      return [...prev]
        .map((a) => (byId.has(String(a.id)) ? { ...a, sort_order: byId.get(String(a.id)) } : a))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
    });

    try {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('monitoring_areas')
          .update({ sort_order: update.sort_order })
          .eq('id', update.id);
        if (updateError) throw updateError;
      }
    } catch (err) {
      console.error('Error reordering monitoring areas:', err);
      toast.error('Could not save the new order.');
      await fetchAreas();
    } finally {
      setBusyId(null);
    }
  };

  // ── Retire / restore ───────────────────────────────────────────────────────

  const handleToggleActive = async (area) => {
    const next = area.isactive === 'No' ? 'Yes' : 'No';
    setBusyId(area.id);
    try {
      const { error: updateError } = await supabase
        .from('monitoring_areas')
        .update({ isactive: next })
        .eq('id', area.id);
      if (updateError) throw updateError;

      toast.success(
        next === 'No'
          ? `${area.name} retired — it stops printing on the report.`
          : `${area.name} restored to the board.`
      );
      await fetchAreas();
    } catch (err) {
      console.error('Error retiring monitoring area:', err);
      toast.error('Could not update the monitoring point.');
    } finally {
      setBusyId(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { error: deleteError } = await supabase
        .from('monitoring_areas')
        .delete()
        .eq('id', deleteTarget.id);
      if (deleteError) throw deleteError;

      toast.success(`${deleteTarget.name} removed from the board.`);
      setDeleteTarget(null);
      await fetchAreas();
    } catch (err) {
      console.error('Error deleting monitoring area:', err);
      toast.error('Could not remove the monitoring point.');
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const rowBusy = (area) => busyId === area.id;

  return (
    <div className="mb-4 rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)]">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--dtg-text-primary)]">
          <MapPin size={15} className="text-[var(--dtg-gray-500)]" />
          Monitoring Points
          <span className="text-xs font-normal text-[var(--dtg-gray-700)]">
            ({active.length}
            {retired.length > 0 ? `, ${retired.length} retired` : ''})
          </span>
        </span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--dtg-border-medium)] p-3">
          <p className="mb-3 text-xs text-[var(--dtg-gray-700)]">
            Every point here prints on the daily report each day, in this order. A point with no
            active deformation prints as TARP 1 / No Significant.
          </p>

          {/* Add */}
          <div className="mb-3 flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Add a monitoring point, e.g. Kaki disp 1"
              aria-label="New monitoring point"
              className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
            />
            <Button
              variant="brand"
              onClick={handleAdd}
              disabled={isAdding || !newName.trim()}
              className="shrink-0"
            >
              <Plus size={15} className="mr-1" />
              Add
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size={24} />
            </div>
          ) : error ? (
            <p className="py-4 text-center text-sm text-red-500">{error}</p>
          ) : visible.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--dtg-gray-700)]">
              No monitoring points yet. Until one is added, the report lists only active movements.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--dtg-border-medium)]">
              {visible.map((area, i) => {
                const isRetired = area.isactive === 'No';
                const editing = editId === area.id;
                return (
                  <li key={area.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-6 shrink-0 text-xs text-[var(--dtg-gray-500)]">{i + 1}.</span>

                    {editing ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleRename(area);
                            }
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          aria-label={`Rename ${area.name}`}
                          autoFocus
                          className="h-8 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Save name"
                          disabled={rowBusy(area)}
                          onClick={() => handleRename(area)}
                        >
                          <Check size={15} />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Cancel rename" onClick={cancelEdit}>
                          <X size={15} />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className={`flex-1 truncate text-sm ${
                            isRetired
                              ? 'text-[var(--dtg-gray-500)] line-through'
                              : 'text-[var(--dtg-text-primary)]'
                          }`}
                        >
                          {area.name}
                        </span>

                        {!isRetired && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Move ${area.name} up`}
                              disabled={i === 0 || rowBusy(area)}
                              onClick={() => handleMove(i, -1)}
                            >
                              <ChevronUp size={15} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Move ${area.name} down`}
                              disabled={i >= active.length - 1 || rowBusy(area)}
                              onClick={() => handleMove(i, 1)}
                            >
                              <ChevronDown size={15} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Rename ${area.name}`}
                              onClick={() => startEdit(area)}
                            >
                              <Pencil size={15} />
                            </Button>
                          </>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={isRetired ? `Restore ${area.name}` : `Retire ${area.name}`}
                          disabled={rowBusy(area)}
                          onClick={() => handleToggleActive(area)}
                        >
                          {isRetired ? <RotateCcw size={15} /> : <Archive size={15} />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${area.name}`}
                          disabled={rowBusy(area)}
                          onClick={() => setDeleteTarget(area)}
                        >
                          <Trash2 size={15} className="text-red-500" />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {retired.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRetired((v) => !v)}
              className="mt-2 text-xs text-[var(--dtg-gray-700)] underline"
            >
              {showRetired ? 'Hide' : 'Show'} {retired.length} retired point
              {retired.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Remove Monitoring Point"
        message={
          `Remove "${deleteTarget?.name ?? ''}" from this wall's board? Its deformation records are ` +
          'kept, and any that are still active will list on the report as an unregistered area. ' +
          'Retire it instead if you only want it to stop printing.'
        }
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        confirmLabel="Remove"
        isDestructive
        isConfirmDisabled={isDeleting}
      />
    </div>
  );
}
