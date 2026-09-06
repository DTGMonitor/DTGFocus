"use client";

// BoardControls.tsx
//
// The header controls the SSR checklist board is sorted and narrowed with.
// Presentation only — what the ordering and matching MEAN lives in
// utils/radarBoardView.ts, so both can be reasoned about (and tested) apart.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { BoardColumn, SortState } from "@/utils/radarBoardView";

interface SortHeaderProps {
  column: BoardColumn;
  sort: SortState | null;
  /** Cycles the column: unsorted → ascending → descending → unsorted. */
  onSort: (key: BoardColumn["key"]) => void;
  /** Matches the column's own cell alignment, so the heading sits over its values. */
  align?: "left" | "center";
  children?: React.ReactNode;
}

/**
 * A column heading that sorts, with its filter menu sitting beside it.
 *
 * The indicator is always rendered, dimmed until the column is the one sorting,
 * so the heading does not change width when a sort moves between columns.
 */
export function SortHeader({ column, sort, onSort, align = "left", children }: SortHeaderProps) {
  const active = sort?.key === column.key;
  const Icon = !active ? ChevronsUpDown : sort?.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <div className={`flex items-center gap-1 ${align === "center" ? "justify-center" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        aria-label={`Sort by ${column.label}`}
        title={`Sort by ${column.label}`}
        className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--dtg-text-primary)] ${active ? "text-[var(--dtg-text-primary)]" : "text-[var(--dtg-gray-700)]"
          }`}
      >
        <span>{column.label}</span>
        <Icon className={`w-3 h-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
      {children}
    </div>
  );
}

interface ColumnFilterMenuProps {
  column: BoardColumn;
  /** The values present in this column, in the order the menu should list them. */
  options: string[];
  /** Ticked values. Empty means "everything" — the state the menu opens in. */
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Options list long enough that finding one by eye stops being reasonable. */
const SEARCHABLE_FROM = 8;

/**
 * A pick-list filter for one column.
 *
 * The panel is positioned `fixed` from the button's own rect rather than
 * absolutely inside the header: the table scrolls horizontally, and an
 * absolutely positioned panel would be clipped by that scroll box the moment it
 * ran past the bottom of the header row.
 *
 * It is also portalled to the body. `position: sticky` makes a stacking context
 * of its own, so a panel left inside the pinned <th> could never rise above the
 * sticky cells further down the table however high its z-index went — the whole
 * heading, panel included, is painted at the heading's level. Out at the body it
 * ranks on its own: above the board, below the page header's z-10.
 */
export function ColumnFilterMenu({ column, options, selected, onChange }: ColumnFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const PANEL_WIDTH = 224;

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Hang under the button, pulled back inside the window if the column sits
    // near the right edge.
    const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8);
    setAnchor({ left: Math.max(8, left), top: rect.bottom + 4 });
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Follow the button while anything scrolls — the table itself scrolls, and so
    // does the page under a sticky header.
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const filtering = selected.length > 0;
  const shown = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen((was) => !was);
          setQuery("");
        }}
        aria-label={`Filter by ${column.label}`}
        aria-expanded={open}
        title={
          filtering
            ? `${column.label}: ${selected.join(", ")}`
            : `Filter by ${column.label}`
        }
        className={`rounded p-0.5 transition-colors ${filtering || open
          ? "text-[var(--dtg-accent-orange)] opacity-100"
          : "text-[var(--dtg-gray-500)] opacity-60 hover:opacity-100"
          }`}
      >
        <Filter className="w-3 h-3" fill={filtering ? "currentColor" : "none"} />
      </button>

      {open && anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          // Inline, not a utility class: this has to land above the board's
          // sticky cells and below the page header's z-10, and a stray arbitrary
          // z utility that never reaches the compiled CSS fails silently — the
          // panel just sinks back under the pinned column.
          style={{ left: anchor.left, top: anchor.top, width: PANEL_WIDTH, zIndex: 9 }}
          className="fixed rounded-lg border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--dtg-border-medium)] px-3 py-2">
            <span className="text-xs text-[var(--dtg-text-primary)]">{column.label}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={!filtering}
              className="text-[10px] text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)] disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          {options.length >= SEARCHABLE_FROM && (
            <div className="border-b border-[var(--dtg-border-medium)] p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Find ${column.label.toLowerCase()}...`}
                className="w-full rounded border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-primary)] px-2 py-1 text-xs text-[var(--dtg-text-primary)] outline-none"
              />
            </div>
          )}

          <div className="max-h-60 overflow-y-auto py-1">
            {shown.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dtg-gray-500)]">No matching values.</p>
            )}
            {shown.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-[var(--dtg-text-secondary)] hover:bg-[var(--dtg-bg-hover)]/50"
              >
                <Checkbox
                  checked={selected.includes(option)}
                  onCheckedChange={() => toggle(option)}
                  className="w-3.5 h-3.5"
                />
                <span className="truncate" title={option}>{option}</span>
              </label>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

interface FilterSummaryProps {
  shown: number;
  total: number;
  activeFilters: number;
  onClear: () => void;
}

/**
 * What the board is currently hiding.
 *
 * The KPI cards and the exported handover deliberately keep counting the whole
 * station, so a filtered board has to say plainly that it is not showing all of
 * it — otherwise a row missing from the grid reads as a radar that is gone.
 */
export function FilterSummary({ shown, total, activeFilters, onClear }: FilterSummaryProps) {
  if (activeFilters === 0) {
    return (
      <span className="text-xs text-[var(--dtg-gray-500)]">{total} sensors</span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--dtg-text-secondary)]">
        Showing {shown} of {total} sensors
      </span>
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 rounded border border-[var(--dtg-border-medium)] px-2 py-0.5 text-[10px] text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)]"
      >
        <X className="w-3 h-3" />
        Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
      </button>
    </div>
  );
}
