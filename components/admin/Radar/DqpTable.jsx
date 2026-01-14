import { Checkbox } from "@/components/LandingPage/ui/checkbox";

export const QualityTable = ({ data }) => {
    // Safety check: if no data, don't render an empty table
    if (!data || data.length === 0) return null;
    const isChecked = (currentValue, statusColumn) => {
        return currentValue?.toLowerCase() === statusColumn.toLowerCase();
    };

    return (
        <div className="overflow-x-auto border border-[var(--dtg-border-medium)] rounded-lg">
            <table className="w-full">
                <thead className="bg-[var(--dtg-bg-card)]">
                    {/* Top Header Row */}
                    <tr>
                        <th
                            rowSpan={2}
                            className="px-3 py-2 text-left text-xs font-bold text-[var(--dtg-gray-700)] border-r border-b border-[var(--dtg-border-medium)] sticky left-0 bg-[var(--dtg-bg-card)] z-10 w-[200px]"
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
                    {/* Sub Header Row */}
                    <tr className="bg-[var(--dtg-bg-primary)] border-b border-[var(--dtg-border-medium)]">
                        <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--dtg-gray-700)] border-r border-[var(--dtg-border-light)]">
                            Optimal
                        </th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--dtg-gray-700)] border-r border-[var(--dtg-border-light)]">
                            Acceptable
                        </th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--dtg-gray-700)] border-r border-[var(--dtg-border-light)]">
                            Sub-Optimal
                        </th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--dtg-gray-700)]">
                            Critical
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((item, index) => (
                        <tr key={index} className="border-b border-[var(--dtg-border-light)] last:border-0 hover:bg-[var(--dtg-bg-card)]">
                            {/* Make sure these keys match your actual DB column names */}
                            <td className="px-3 py-2 text-sm font-medium border-r border-[var(--dtg-border-light)]">{item.parameter?.name}</td>
                            <td className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)]">
                                <div className="flex items-center justify-center">
                                    <Checkbox
                                        checked={isChecked(item.value, 'Optimal')}
                                        readOnly
                                        className={`w-5 h-5 ${
                                            isChecked(item.value, 'Optimal')
                                                ? 'bg-green-500/20 border-green-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500'
                                                : 'border-gray-600 hover:border-gray-500'
                                            }`}
                                    />
                                </div>
                            </td>
                            <td className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)]">
                                <div className="flex items-center justify-center">
                                    <Checkbox
                                        checked={isChecked(item.value, 'Acceptable')}
                                        readOnly
                                        className={`w-5 h-5 ${
                                            isChecked(item.value, 'Acceptable')
                                                ? 'bg-yellow-500/20 border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500'
                                                : 'border-gray-600 hover:border-gray-500'
                                            }`}
                                    />
                                </div>
                            </td>
                            <td className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)]">
                                <div className="flex items-center justify-center">
                                    <Checkbox
                                        checked={isChecked(item.value, 'Sub-Optimal')}
                                        readOnly
                                        className={`w-5 h-5 ${
                                            isChecked(item.value, 'Sub-Optimal')
                                                ? 'bg-orange-500/20 border-orange-500 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500'
                                                : 'border-gray-600 hover:border-gray-500'
                                            }`}
                                    />
                                </div>
                            </td>
                            <td className="px-2 py-3 text-center border-l border-[var(--dtg-border-medium)]">
                                <div className="flex items-center justify-center">
                                    <Checkbox
                                        checked={isChecked(item.value, 'Critical')}
                                        readOnly
                                        className={`w-5 h-5 ${
                                            isChecked(item.value, 'Critical')
                                                ? 'bg-red-500/20 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500'
                                                : 'border-gray-600 hover:border-gray-500'
                                            }`}
                                    />
                                </div>
                            </td>
                            <td className="px-3 py-2 text-sm text-[var(--dtg-text-secondary)] border-l border-[var(--dtg-border-medium)]">{item.notes || "-"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};