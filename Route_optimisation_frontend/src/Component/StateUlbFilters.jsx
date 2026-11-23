export default function StateUlbFilters({
    ulbs,
    selectedUlbId,
    onSelectedUlbIdChange,
    includeAllUlbs = false,
}) {
    return (
        <>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
                State
                <select
                    value="Maharashtra"
                    disabled
                    className="rounded border border-slate-300 bg-slate-100 p-2 text-slate-700 disabled:cursor-not-allowed"
                >
                    <option value="Maharashtra">Maharashtra</option>
                </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
                ULB
                <select
                    value={selectedUlbId}
                    onChange={(event) => onSelectedUlbIdChange(event.target.value)}
                    disabled={!ulbs.length}
                    className="min-w-52 rounded border border-slate-300 bg-white p-2 disabled:bg-slate-100"
                >
                    <option value={includeAllUlbs ? "all" : ""}>
                        {ulbs.length
                            ? includeAllUlbs ? "All ULBs" : "Select a ULB"
                            : "ULB list unavailable"}
                    </option>
                    {ulbs.map((ulb) => (
                        <option key={ulb.id} value={ulb.id}>{ulb.name}</option>
                    ))}
                </select>
            </label>
        </>
    );
}
