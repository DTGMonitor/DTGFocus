/**
 * BoardViewSwitch
 *
 * Active ↔ Archived for the deformation board. A segmented control rather than a
 * checkbox because the two are different boards and not a filter over one: the
 * active side lists live chains with the actions that change them, the archived
 * side lists closed ones with the two ways back.
 *
 * The archived count is shown when it is known so the engineer can see there IS
 * history without switching; `null` (not yet loaded) prints no badge rather than
 * a zero that would read as "nothing archived".
 */
const OPTIONS = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
];

export default function BoardViewSwitch({ value = 'active', onChange, archivedCount = null }) {
  return (
    <div
      className="inline-flex rounded-md border border-[var(--dtg-border-medium)] p-0.5"
      role="group"
      aria-label="Deformation board view"
    >
      {OPTIONS.map(({ key, label }) => {
        const isActive = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange?.(key)}
            aria-pressed={isActive}
            className={[
              'px-3 py-1 text-xs font-medium rounded transition-colors',
              isActive
                ? 'bg-[var(--dtg-brand-orange)] text-white'
                : 'text-[var(--dtg-text-secondary)] hover:text-[var(--dtg-text-primary)]',
            ].join(' ')}
          >
            {label}
            {key === 'archived' && archivedCount !== null ? ` (${archivedCount})` : ''}
          </button>
        );
      })}
    </div>
  );
}
