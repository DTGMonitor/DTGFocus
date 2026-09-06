/**
 * Tab_Container
 *
 * Presentational component that renders the tab headers for SensorDetail.
 * Owns no internal state — the parent controls `activeTab` and `onTabChange`.
 *
 * Props:
 *   activeTab   : 'onboarding' | 'deformation' | 'alarm' | 'dqp' | 'downtime' | 'tarp'
 *   onTabChange : (tabKey: string) => void
 *   showOnboarding : boolean — offer the Onboarding tab at all. False for sites
 *                    with no onboarding record (everything live before the flow
 *                    existed), which would otherwise gain an empty tab.
 *   onboardingOnly : boolean — the site is still being onboarded, so Onboarding
 *                    is the ONLY tab. Not merely a disabled state: there is
 *                    genuinely nothing to record against a radar whose
 *                    escalation path has never been dialled, and a greyed-out
 *                    row of five tabs reads as a bug rather than a sequence.
 *
 * Requirements: 1.1, 1.2, 1.3
 */

const ONBOARDING_TAB = { key: 'onboarding', label: 'Onboarding' };

const TABS = [
  { key: 'deformation', label: 'Deformation' },
  { key: 'alarm',       label: 'Alarm' },
  { key: 'dqp',         label: 'Data Quality' },
  { key: 'downtime',    label: 'Downtime' },
  { key: 'tarp',        label: 'TARP' },
];

/** The tabs a sensor shows, given where its site is in onboarding. */
export const visibleTabs = ({ showOnboarding = false, onboardingOnly = false } = {}) => {
  if (onboardingOnly) return [ONBOARDING_TAB];
  return showOnboarding ? [ONBOARDING_TAB, ...TABS] : TABS;
};

export default function Tab_Container({
  activeTab,
  onTabChange,
  showOnboarding = false,
  onboardingOnly = false,
}) {
  const tabs = visibleTabs({ showOnboarding, onboardingOnly });

  return (
    <div className="flex items-center border-b border-[var(--dtg-border-dark)] bg-[var(--dtg-bg-card)]">
      {tabs.map(({ key, label }) => {
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
