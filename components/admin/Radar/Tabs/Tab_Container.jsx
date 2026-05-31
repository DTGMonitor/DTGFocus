/**
 * Tab_Container
 *
 * Presentational component that renders the four tab headers for SensorDetail.
 * Owns no internal state — the parent controls `activeTab` and `onTabChange`.
 *
 * Props:
 *   activeTab   : 'deformation' | 'alarm' | 'dqp' | 'downtime'
 *   onTabChange : (tabKey: string) => void
 *
 * Requirements: 1.1, 1.2, 1.3
 */

const TABS = [
  { key: 'deformation', label: 'Deformation' },
  { key: 'alarm',       label: 'Alarm' },
  { key: 'dqp',         label: 'Data Quality' },
  { key: 'downtime',    label: 'Downtime' },
];

export default function Tab_Container({ activeTab, onTabChange }) {
  return (
    <div className="flex items-center border-b border-[var(--dtg-border-dark)] bg-[var(--dtg-bg-card)]">
      {TABS.map(({ key, label }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={[
              'px-5 py-3 text-sm font-medium transition-colors duration-200 whitespace-nowrap',
              'focus:outline-none',
              isActive
                ? 'border-b-2 border-[var(--dtg-brand-orange)] text-[var(--dtg-text-primary)] font-semibold'
                : 'text-[var(--dtg-text-muted)] hover:text-[var(--dtg-text-secondary)] border-b-2 border-transparent',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
