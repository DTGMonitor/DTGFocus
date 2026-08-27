// DqpTable.jsx
import { useMemo, Fragment, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { getRiskColorSolid } from "@/config/statusConfig";
import { getAllowedStatuses, canBeNotApplicable } from "@/config/parameterConfig";
import { ExternalLink, Loader, ImageDown, FilePlus2, BookOpen, Pencil } from 'lucide-react';
import { exportDqpTableImage } from "./dqpImageExport";
import DqpGuidanceModal from "./DqpGuidanceModal";
import DqpAppendixPreview from "@/components/Reusable/DqpAppendixPreview";
import toast from 'react-hot-toast';

const isRowInvalid = (item) => {
    // N/A is a real answer on the rows that may be left blank — the Alarms
    // group and the Reutech Masks row. Anywhere else it means "not assessed".
    return !canBeNotApplicable(item.parameter) && item.value === 'N/A';
};

/**
 * Only a row that already sits on a non-optimal status can take another action
 * plan — Optimal and N/A are the states the modal exists to move *away* from,
 * and requesting either of them never opens it.
 */
const canAddAction = (item) => item.value !== 'Optimal' && item.value !== 'N/A';

export const QualityTable = ({ data, onUpdate, onEdit, exportTitle = 'Data Quality', exportSubtitle = '', radarNumber = '' }) => {
    const [previewItem, setPreviewItem] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isGuidanceOpen, setIsGuidanceOpen] = useState(false);

    // Signing and layout live in DqpAppendixPreview, shared with the client
    // radar detail so the two show a finding's appendix identically.
    const handleViewImage = (item) => {
        if (!(item.images ?? []).length) return;
        setPreviewItem(item);
    };
    
    const processedGroups = useMemo(() => {
        const groups = {};
        const parentStatusMap = {};

        // PASS 1: Find all Level 1 (Parent) values and store them
        data.forEach((item) => {
            if (item.parameter?.level === 1) {
                parentStatusMap[item.parameter.id] = item.value;
            }
        });

        // PASS 2: Group the Children
        data.forEach((item) => {
            const param = item.parameter;

            // Skip invalid data
            if (!param) return;

            // Skip Level 1 items (we don't want them as rows)
            if (param.level === 1 || param.level === 0) return;

            const groupId = param.parent_id || param.parent?.id || 0;
            const groupName = param.parent?.name || "General";

            if (!groups[groupId]) {
                groups[groupId] = {
                    id: groupId,
                    name: groupName,
                    // HERE IS THE FIX: Attach the parent's status to the group
                    status: parentStatusMap[groupId],
                    items: []
                };
            }
            groups[groupId].items.push(item);
        });

        // Sort groups and items
        return Object.values(groups)
            .sort((a, b) => a.id - b.id)
            .map(group => {
                group.items.sort((a, b) => a.parameter.id - b.parameter.id);
                return group;
            });
    }, [data]);

    // Hooks first — this early return used to sit above them, which made the
    // hook order depend on `data`.
    if (!data || data.length === 0) return null;

    // The exported PNG is a light-themed rebuild of `processedGroups`, not a
    // snapshot of this table — see dqpImageExport.js for why.
    const handleExportImage = async () => {
        setIsExporting(true);
        try {
            await exportDqpTableImage({
                groups: processedGroups,
                title: exportTitle,
                subtitle: exportSubtitle,
                radarNumber,
            });
            toast.success('Image downloaded');
        } catch (error) {
            console.error('Error exporting data quality image:', error);
            toast.error(error?.message || 'Could not export the image.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <>
            <div className="flex justify-end gap-2 mb-2">
                <button
                    onClick={() => setIsGuidanceOpen(true)}
                    title="What each status on these rows means, from the Data Quality Parameter document"
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--dtg-border-medium)] text-[var(--dtg-text-secondary)] hover:text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-bg-card)] transition-colors"
                >
                    <BookOpen size={14} />
                    Guidance
                </button>
                <button
                    onClick={handleExportImage}
                    disabled={isExporting}
                    title="Download this table as a single light-themed PNG"
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--dtg-border-medium)] text-[var(--dtg-text-secondary)] hover:text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-bg-card)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isExporting ? <Loader size={14} className="animate-spin" /> : <ImageDown size={14} />}
                    {isExporting ? 'Preparing…' : 'Export Image'}
                </button>
            </div>
            <div className="overflow-x-auto border border-[var(--dtg-border-medium)] rounded-lg">
            <table className="w-full border-collapse">
                <thead className="bg-[var(--dtg-bg-card)]">
                    <tr>
                        {/* The Group Header Column (Vertical) */}
                        <th rowSpan={2} className="w-[40px] border-r border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)]"></th>
                        <th
                            rowSpan={2}
                            className="px-3 py-2 text-left text-xs font-bold text-[var(--dtg-gray-700)] border-r border-b border-[var(--dtg-border-medium)] w-[200px]"
                        >
                            Parameter
                        </th>
                        <th
                            colSpan={4}
                            className="px-3 py-2 text-center text-xs font-bold text-[var(--dtg-gray-700)] border-b border-[var(--dtg-border-medium)]"
                        >
                            Status
                        </th>
                        <th
                            rowSpan={2}
                            className="px-3 py-2 text-center text-xs font-bold text-[var(--dtg-gray-700)] border-l border-b border-[var(--dtg-border-medium)] w-[300px]"
                        >
                            Notes
                        </th>
                    </tr>
                    <tr className="bg-[var(--dtg-bg-primary)] border-b border-[var(--dtg-border-medium)]">
                        {['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical'].map((status, i) => (
                            <th key={status} className={`px-3 py-2 text-center text-xs font-semibold text-[var(--dtg-gray-700)] ${i < 3 ? 'border-r border-[var(--dtg-border-light)]' : ''}`}>
                                {status}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {processedGroups.map((group) => (
                        <Fragment key={group.id}>
                            {group.items.map((item, index) => {
                                const isFirstInGroup = index === 0;

                                return (
                                    <tr key={item.parameter.id} className={`border-b border-[var(--dtg-border-light)] ${isRowInvalid(item) ? 'bg-red-50' : 'hover:bg-[var(--dtg-bg-card)]'}`}>

                                        {/* Vertical Header (Existing Logic) */}
                                        {isFirstInGroup && (
                                            <td rowSpan={group.items.length} className={`${getRiskColorSolid(group.status || item.value)} text-white font-bold text-center border-r border-b border-[var(--dtg-border-medium)] w-[40px] p-0 align-middle`}>
                                                <div className="flex items-center justify-center w-full [writing-mode:vertical-rl] rotate-180 py-4 px-2 whitespace-nowrap uppercase text-xs tracking-wider">
                                                    {group.name}
                                                </div>
                                            </td>
                                        )}

                                        {/* Parameter Name */}
                                        <td className="px-3 py-2 text-sm font-medium border-r border-[var(--dtg-border-light)]">
                                            {item.parameter?.name}
                                        </td>

                                        {/* INTERACTIVE CHECKBOXES */}
                                        {['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical'].map((status) => {
                                            // Config Check (Your existing config logic).
                                            // A status the row already holds stays visible even when the
                                            // config no longer offers it — several rows were scored while
                                            // their name was missing from PARAMETER_CONFIG and every box
                                            // was open, and hiding those ticks would read as "not assessed".
                                            const allowedStatuses = getAllowedStatuses(item.parameter?.name, radarNumber);
                                            const isAllowed = allowedStatuses
                                                ? allowedStatuses.includes(status) || item.value === status
                                                : true;

                                            return (
                                                <td key={status} className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)] bg-opacity-50">
                                                    {isAllowed ? (
                                                        <div className="flex items-center justify-center">
                                                            <Checkbox
                                                                checked={item.value === status}
                                                                onCheckedChange={(isChecked) => {
                                                                    if (canBeNotApplicable(item.parameter)) {
                                                                        // These rows may be left blank; unticking records 'N/A'.
                                                                        if (isChecked) {
                                                                            onUpdate(item, 'value', status);
                                                                        } else {
                                                                            onUpdate(item, 'value', 'N/A');
                                                                        }
                                                                    } else {
                                                                        // Every other row must hold a status (prevents unchecking)
                                                                        onUpdate(item, 'value', status);
                                                                    }
                                                                }}
                                                                className={`w-5 h-5 ${item.value === status
                                                                    ? getRiskColorSolid(status)
                                                                    : 'border-gray-600 hover:border-gray-500'
                                                                    }`}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="h-5 w-5 mx-auto bg-gray-100/10 rounded-sm border border-transparent opacity-20">-</div>
                                                    )}
                                                </td>
                                            );
                                        })}

                                        {/* EDITABLE NOTES */}
                                        <td className="px-2 py-2 text-sm border-l border-[var(--dtg-border-medium)]">
                                            <div className="flex items-center justify-between gap-2">
                                                <label
                                                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-[var(--dtg-primary)] rounded px-1 text-[var(--dtg-text-secondary)]"
                                                >
                                                    {item.notes}
                                                </label>
                                                {/* Re-open the action plan at the status the row already
                                                    holds. Ticking the checked box cannot do this — for an
                                                    alarm child that gesture means "clear to N/A" — so
                                                    logging a second improvement against an unchanged
                                                    status needs its own affordance. */}
                                                {/* Correcting the wording or the figures, with the status
                                                    left where it is — on an alarm row this is the only way
                                                    to do that without filing a second improvement, and the
                                                    only way to close a recommendation the site answered
                                                    without declaring the whole row Optimal. */}
                                                {onEdit && (
                                                    <button
                                                        onClick={() => onEdit(item)}
                                                        className="flex-shrink-0 text-[var(--dtg-gray-400)] hover:text-[var(--dtg-text-primary)] transition-colors"
                                                        title="Edit the notes, captions and appendix, and close any answered recommendations (no status change, no new improvement)"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                )}
                                                {canAddAction(item) && (
                                                    <button
                                                        onClick={() => onUpdate(item, 'value', item.value)}
                                                        className="flex-shrink-0 text-[var(--dtg-gray-400)] hover:text-[var(--dtg-text-primary)] transition-colors"
                                                        title={`Add another improvement at ${item.value} (starts from the current notes and figures)`}
                                                    >
                                                        <FilePlus2 size={14} />
                                                    </button>
                                                )}
                                                {item.images?.length > 0 && (
                                                    <button
                                                        onClick={() => handleViewImage(item)}
                                                        className="flex items-center gap-0.5 text-blue-400 hover:text-blue-300 transition-colors"
                                                        title={item.images.length === 1 ? 'View image' : `View ${item.images.length} images`}
                                                    >
                                                        <ExternalLink size={14} />
                                                        {/* The count is the whole point of the change — without it a row
                                                            with three figures is indistinguishable from one with a single
                                                            figure, which is how the missing uploads went unnoticed. */}
                                                        {item.images.length > 1 && (
                                                            <span className="text-[10px] font-semibold leading-none">{item.images.length}</span>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </Fragment>
                    ))}
                </tbody>
            </table>
        </div>
        <DqpGuidanceModal
                isOpen={isGuidanceOpen}
                onClose={() => setIsGuidanceOpen(false)}
                groups={processedGroups}
                radarNumber={radarNumber}
            />
        <DqpAppendixPreview
            item={previewItem}
            fallbackCaption={previewItem?.parameter?.name}
            onClose={() => setPreviewItem(null)}
        />
        </>
    );
};