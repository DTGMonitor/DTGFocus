/**
 * The tab gate: which tabs a sensor shows, given where its site is in onboarding.
 *
 * "Only display the onboarding flow tab until all finished and the live
 * commencement sent" is the whole rule, and it has three states — not two — so
 * each is pinned here.
 */

import { render, screen } from '@testing-library/react';
import Tab_Container, { visibleTabs } from '@/components/admin/Radar/Tabs/Tab_Container';

const labels = () => screen.getAllByRole('button').map((b) => b.textContent);

describe('visibleTabs', () => {
    test('a site still onboarding gets ONE tab', () => {
        expect(visibleTabs({ showOnboarding: true, onboardingOnly: true })).toEqual([
            { key: 'onboarding', label: 'Onboarding' }
        ]);
    });

    test('a finished onboarding keeps its tab alongside the other five', () => {
        const tabs = visibleTabs({ showOnboarding: true, onboardingOnly: false });
        expect(tabs.map((t) => t.key)).toEqual([
            'onboarding',
            'deformation',
            'alarm',
            'dqp',
            'downtime',
            'tarp'
        ]);
    });

    test('a site with no onboarding record shows the original five, unchanged', () => {
        // Everything live before this feature existed. Adding an empty tab to
        // every one of those sensors would be noise, not information.
        const tabs = visibleTabs({ showOnboarding: false, onboardingOnly: false });
        expect(tabs.map((t) => t.key)).toEqual([
            'deformation',
            'alarm',
            'dqp',
            'downtime',
            'tarp'
        ]);
    });

    test('called with no arguments it defaults to the pre-onboarding behaviour', () => {
        expect(visibleTabs().map((t) => t.key)).toEqual([
            'deformation',
            'alarm',
            'dqp',
            'downtime',
            'tarp'
        ]);
    });

    test('onboardingOnly wins even if the caller forgets showOnboarding', () => {
        expect(visibleTabs({ onboardingOnly: true }).map((t) => t.key)).toEqual(['onboarding']);
    });
});

describe('Tab_Container', () => {
    test('an unfinished site renders the onboarding tab and nothing else', () => {
        render(
            <Tab_Container
                activeTab="onboarding"
                onTabChange={() => {}}
                showOnboarding
                onboardingOnly
            />
        );
        expect(labels()).toEqual(['Onboarding']);
        expect(screen.queryByText('Deformation')).toBeNull();
        expect(screen.queryByText('TARP')).toBeNull();
    });

    test('a finished site renders every tab', () => {
        render(
            <Tab_Container activeTab="deformation" onTabChange={() => {}} showOnboarding />
        );
        expect(labels()).toEqual([
            'Onboarding',
            'Deformation',
            'Alarm',
            'Data Quality',
            'Downtime',
            'TARP'
        ]);
    });

    test('the default props leave existing sensors exactly as they were', () => {
        render(<Tab_Container activeTab="deformation" onTabChange={() => {}} />);
        expect(labels()).toEqual([
            'Deformation',
            'Alarm',
            'Data Quality',
            'Downtime',
            'TARP'
        ]);
    });
});
