// DqpTable.jsx
import { useMemo, Fragment, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { getRiskColorSolid } from "@/config/statusConfig";
import { PARAMETER_CONFIG } from "@/config/parameterConfig";
import { supabase } from "@/lib/supabaseClient";
import { ExternalLink, X, Loader, ImageDown } from 'lucide-react';
import { exportDqpTableImage } from "./dqpImageExport";
import toast from 'react-hot-toast';

const isRowInvalid = (item) => {
    // If it's NOT Alarms (ID 6) and value is N/A, mark it red
    return item.parameter?.parent_id !== 6 && item.value === 'N/A';
};

export const QualityTable = ({ data, onUpdate, exportTitle = 'Data Quality', exportSubtitle = '' }) => {
    const [previewItem, setPreviewItem] = useState(null);
    const [previewImages, setPreviewImages] = useState([]);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // A row carries N figures, each with its own caption. They are signed as a
    // batch so the preview opens in one round trip rather than one per figure.
    const handleViewImage = async (item) => {
        const images = item.images ?? [];
        if (!images.length) return;
        setPreviewItem(item);
        setPreviewImages([]);
        setLoadingPreview(true);
        try {
            const signed = await Promise.all(images.map(async (img) => {
                const { data, error } = await supabase.storage
                    .from('Radar')
                    .createSignedUrl(img.image_url, 3600);
                if (error) throw error;
                return { ...img, url: data.signedUrl };
            }));
            setPreviewImages(signed);
        } catch (error) {
            console.error('Error loading image:', error);
            setPreviewItem(null); // close modal on error
        } finally {
            setLoadingPreview(false);
        }
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
                parameterConfig: PARAMETER_CONFIG,
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
            <div className="flex justify-end mb-2">
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
                                            // Config Check (Your existing config logic)
                                            const allowedStatuses = PARAMETER_CONFIG[item.parameter?.name];
                                            const isAllowed = allowedStatuses ? allowedStatuses.includes(status) : true;

                                            return (
                                                <td key={status} className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)] bg-opacity-50">
                                                    {isAllowed ? (
                                                        <div className="flex items-center justify-center">
                                                            <Checkbox
                                                                checked={item.value === status}
                                                                onCheckedChange={(isChecked) => {
                                                                    const ALARMS_PARENT_ID = 6;
                                                                    const isAlarmChild = item.parameter?.parent_id === ALARMS_PARENT_ID;

                                                                    if (isAlarmChild) {
                                                                        // For alarm items, allow unchecking to set status to 'N/A'
                                                                        if (isChecked) {
                                                                            onUpdate(item, 'value', status);
                                                                        } else {
                                                                            onUpdate(item, 'value', 'N/A');
                                                                        }
                                                                    } else {
                                                                        // Original behavior for non-alarm items (prevents unchecking)
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
        {previewItem && (
                <div
                    className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5"
                    onClick={() => setPreviewItem(null)}
                >
                    <div
                        className="w-full max-w-4xl bg-[var(--dtg-bg-card)] rounded-lg overflow-hidden flex flex-col relative border border-[var(--dtg-border-medium)] max-h-[90vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-5 py-3 border-b border-[var(--dtg-border-medium)] flex justify-between items-center flex-shrink-0">
                            <h3 className="m-0 text-[var(--dtg-text-primary)] text-base">
                                Image Preview
                                {previewImages.length > 1 && (
                                    <span className="ml-2 text-sm text-[var(--dtg-text-secondary)]">
                                        ({previewImages.length} figures)
                                    </span>
                                )}
                            </h3>
                            <button
                                onClick={() => setPreviewItem(null)}
                                className="bg-transparent border-none text-[var(--dtg-gray-400)] cursor-pointer p-1 flex items-center hover:text-[var(--dtg-text-primary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            {loadingPreview ? (
                                <div className="h-96 flex items-center justify-center text-[var(--dtg-text-primary)]">
                                    <Loader className="animate-spin mr-2" /> Loading Image...
                                </div>
                            ) : (
                                // Stacked and scrollable rather than a carousel: the captions
                                // only make sense read against each other, and the report
                                // prints them in this same order.
                                <div className="space-y-6">
                                    {previewImages.map((img, i) => (
                                        <div key={img.id ?? i}>
                                            <img
                                                src={img.url}
                                                alt={`DQP appendix figure ${i + 1}`}
                                                className="w-full h-auto max-h-[65vh] object-contain rounded"
                                            />
                                            <p className="text-center text-sm text-[var(--dtg-text-secondary)] mt-3 italic">
                                                <strong>Figure {i + 1}. </strong>
                                                {img.caption || previewItem.parameter?.name}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {previewItem.appendix && (
                                 <p className="text-justify text-sm text-[var(--dtg-text-secondary)] mt-2">{previewItem.appendix}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};