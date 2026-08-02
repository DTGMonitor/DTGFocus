import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import ImprovementResolution from '@/components/admin/Radar/Dqp/ImprovementResolution';
import { initialResolutions, unresolved } from '@/utils/dqpImprovements';

/**
 * The "→ Optimal" gate: every open recommendation, answered before the row can
 * claim Optimal.
 *
 * This is the one surface where resolution is NOT partial. Optimal is a
 * statement that nothing is outstanding on the radar, so leaving a
 * recommendation awaiting feedback while asserting it would be a contradiction —
 * hence `requireAll`, which drops the "leave open" choice and defaults every row
 * to Modified, as this modal always has. Partial resolution lives on the two
 * surfaces where the row is NOT claiming to be clear: the change to another
 * non-optimal value (ActionRequiredModal) and Edit entry.
 *
 * The list itself and what a resolution means are shared with those surfaces —
 * see ImprovementResolution — so an analyst reads the same thing either way.
 */
const FeedbackModal = ({ isOpen, onClose, data, onSubmit, regions }) => {
    const [itemData, setItemData] = useState({});
    const [seeded, setSeeded] = useState(false);

    // Seeded during render rather than from an effect: the choices are derived
    // from a prop, with no external system to synchronise with, so an effect
    // would only cost a second render. Re-seeded on every OPEN and cleared on
    // close, so a resolution picked and then cancelled out of does not come back
    // pre-selected the next time the gate fires.
    if (isOpen && !seeded) {
        setSeeded(true);
        setItemData(initialResolutions(data, { requireAll: true }));
    }
    if (!isOpen && seeded) setSeeded(false);

    if (!isOpen) return null;

    const handleChange = (id, patch) =>
        setItemData(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--dtg-bg-primary)]/80 backdrop-blur-sm overflow-y-auto">
            <div className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)] rounded-lg shadow-xl w-full max-w-2xl p-6 m-4 max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="mb-4 border-b pb-4">
                    <h2 className="text-xl font-bold text-[var(--dtg-gray-800]">Pending Alarm Improvements</h2>
                    <p className="text-sm text-[var(--dtg-gray-600] mt-1">
                        Setting this parameter to Optimal requires clearing out the following items currently
                        &quot;Awaiting Feedback&quot;. To close only some of them, set the row to another non-optimal
                        value instead, or use Edit entry.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto mb-4">
                    <ImprovementResolution
                        improvements={data ?? []}
                        regions={regions}
                        value={itemData}
                        onChange={handleChange}
                        requireAll
                    />
                </div>

                {/* Footer Actions */}
                <div className="flex justify-end space-x-3 pt-4 border-t mt-auto">
                    <Button onClick={onClose} variant='outline'>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => onSubmit(itemData)}
                        variant='brand'
                        // Every row starts answered, so this can only bite if a
                        // row somehow holds an unrecognised status.
                        disabled={unresolved(data, itemData).length > 0}
                    >
                        Submit
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default FeedbackModal;
