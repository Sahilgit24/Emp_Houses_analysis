import {useEffect, useMemo, useState} from "react";
import {
    analyzeHouseCoverage,
    analyzeOutsideBeatCollections,
    getReportWindowDays,
    getHighPriorityHouses,
} from "../data/employeePerformance.js";

const COLLECTION_LABELS = {
    own: "Collected by Me",
    other: "Collected by Others",
    remaining: "Not Collected",
};

function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {maximumFractionDigits: digits});
}

function formatDays(value) {
    return value == null ? "—" : `${formatNumber(value, 1)} day${value === 1 ? "" : "s"}`;
}

function formatDate(value) {
    if (!value) return "Never";
    return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    });
}

function addDays(date, days) {
    if (!date) return null;
    const timestamp = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(timestamp)
        ? new Date(timestamp + days * 86400000).toISOString().slice(0, 10)
        : null;
}

function Card({label, value, detail, tone = "text-slate-900"}) {
    return (
        <article className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
            {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
        </article>
    );
}

function EmptyRow({columns, children}) {
    return <tr><td colSpan={columns} className="p-6 text-center text-slate-500">{children}</td></tr>;
}

export default function EmployeeApiDashboard({beatData, onShowHighPriorityHouses}) {
    const beats = beatData?.beats || [];
    const [selectedBeatId, setSelectedBeatId] = useState("");
    const [houseSearch, setHouseSearch] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [page, setPage] = useState(0);
    const [analysisEndDate, setAnalysisEndDate] = useState("");

    useEffect(() => {
        if (!beats.length) {
            setSelectedBeatId("");
            return;
        }
        if (!beats.some((item) => item.id === selectedBeatId)) setSelectedBeatId(beats[0].id);
    }, [beats, selectedBeatId]);

    const beat = beats.find((item) => item.id === selectedBeatId) || beats[0] || null;
    const analysisDateOptions = useMemo(() => {
        if (!beat) return [];
        const dates = new Set();
        (beat.routes || []).forEach((route) => dates.add(route.date));
        (beat.houses || []).forEach((house) => {
            (house.history?.collectionDates || []).forEach((date) => dates.add(date));
            if (house.scanningDate) dates.add(house.scanningDate.slice(0, 10));
        });
        if (beat.toDate) dates.add(beat.toDate);
        return [...dates]
            .filter((date) =>
                (!beat.fromDate || date >= beat.fromDate) &&
                (!beat.toDate || date <= beat.toDate)
            )
            .sort();
    }, [beat]);
    useEffect(() => {
        setAnalysisEndDate(analysisDateOptions.at(-1) || "");
    }, [beat?.id, analysisDateOptions]);
    const routes = useMemo(() => (beat?.routes || []).filter((route) =>
        (!beat?.fromDate || route.date >= beat.fromDate) &&
        (!beat?.toDate || route.date <= beat.toDate)
    ), [beat]);
    const effectiveEndDate = analysisEndDate || analysisDateOptions.at(-1) || beat?.toDate || null;
    const rollingStartDate = addDays(effectiveEndDate, -29);
    const dataStartDate = beat?.fromDate || analysisDateOptions[0] || effectiveEndDate;
    const effectiveStartDate = rollingStartDate && dataStartDate > rollingStartDate
        ? dataStartDate
        : rollingStartDate || dataStartDate;
    const analysisRoutes = useMemo(() => routes.filter((route) =>
        (!effectiveStartDate || route.date >= effectiveStartDate) &&
        (!effectiveEndDate || route.date <= effectiveEndDate)
    ), [effectiveEndDate, effectiveStartDate, routes]);
    const reportWindowDays = getReportWindowDays(effectiveStartDate, effectiveEndDate);
    const reportWindowLabel = reportWindowDays == null
        ? "available reporting period"
        : `${formatNumber(reportWindowDays)}-day reporting period`;
    const otherBeats = useMemo(() => beats.filter((item) => item.id !== beat?.id), [beats, beat?.id]);
    const houseCoverage = useMemo(
        () => analyzeHouseCoverage(
            beat?.houses || [],
            analysisRoutes,
            effectiveStartDate,
            effectiveEndDate,
            beat?.assignedEmployee,
            otherBeats,
        ),
        [analysisRoutes, beat, effectiveEndDate, effectiveStartDate, otherBeats],
    );
    const outsideBeatAnalysis = useMemo(
        () => analyzeOutsideBeatCollections(
            analysisRoutes,
            otherBeats,
            beat?.assignedEmployee?.id,
            effectiveStartDate,
            effectiveEndDate,
        ),
        [analysisRoutes, beat, effectiveEndDate, effectiveStartDate, otherBeats],
    );
    const highPriorityHouses = useMemo(
        () => getHighPriorityHouses(houseCoverage, reportWindowDays),
        [houseCoverage, reportWindowDays],
    );
    const highPriorityHouseIds = useMemo(
        () => highPriorityHouses
            .filter(({detail}) =>
                Number.isFinite(detail.house.lat) && Number.isFinite(detail.house.lon)
            )
            .map(({detail}) => detail.house.houseId),
        [highPriorityHouses],
    );
    const attentionCounts = useMemo(() => {
        const counts = {regular: 0, lowFrequency: 0, needsAttention: 0, overdue: 0, notCollected: 0, withHistory: 0};
        houseCoverage.details.forEach((detail) => {
            if (detail.collectionDays) counts.withHistory += 1;
            if (detail.status === "Regular") counts.regular += 1;
            else if (detail.status === "Low Frequency") counts.lowFrequency += 1;
            else if (detail.status === "Needs Attention") counts.needsAttention += 1;
            else if (detail.status === "Overdue") counts.overdue += 1;
            else counts.notCollected += 1;
        });
        return counts;
    }, [houseCoverage]);

    const visibleHouses = useMemo(() => houseCoverage.details
        .filter((detail) => collectionFilter === "all" || detail.collectionCategory === collectionFilter)
        .filter(({house}) => {
            const query = houseSearch.trim().toLowerCase();
            return !query || house.houseId.toLowerCase().includes(query) ||
                house.referenceId?.toLowerCase().includes(query);
        })
        .sort((a, b) => a.house.houseId.localeCompare(b.house.houseId)),
    [houseCoverage, collectionFilter, houseSearch]);
    const pageSize = 100;
    const pageCount = Math.max(1, Math.ceil(visibleHouses.length / pageSize));
    const currentPage = Math.min(page, pageCount - 1);
    const currentHouses = visibleHouses.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    const otherEmployeeGroups = useMemo(() => {
        const employees = new Map();
        houseCoverage.details.forEach((detail) => {
            detail.otherEmployeeCollectionRecords.forEach((record) => {
                const employeeKey = record.scannerId || record.scannerName;
                if (!employeeKey) return;
                const group = employees.get(employeeKey) || {
                    employeeKey,
                    employeeName: record.scannerName || `Employee ${record.scannerId}`,
                    houses: new Set(),
                };
                group.houses.add(detail.house.houseId);
                employees.set(employeeKey, group);
            });
        });
        return [...employees.values()]
            .map((group) => ({
                ...group,
                houses: [...group.houses].sort((a, b) => a.localeCompare(b)),
            }))
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }, [houseCoverage]);

    useEffect(() => setPage(0), [selectedBeatId, collectionFilter, houseSearch]);

    if (!beatData) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4">
                <p role="status" className="mx-auto max-w-7xl rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    Upload the Beat API file above to view employee house collection analysis.
                </p>
            </div>
        );
    }

    if (!beat) return <div className="p-4 text-sm text-slate-600">No Beat records were found in this API file.</div>;

    const ownCount = houseCoverage.assignedEmployeeCollected;
    const otherCount = houseCoverage.otherEmployeeCollected;
    const remainingCount = houseCoverage.remainingWithoutHistory;
    const totalHouses = beat.houses.length;
    const beatCoveragePercent = totalHouses
        ? (ownCount + otherCount) * 100 / totalHouses
        : null;
    const ownCoveragePercent = totalHouses ? ownCount * 100 / totalHouses : null;
    const regularRate = attentionCounts.withHistory
        ? attentionCounts.regular * 100 / attentionCounts.withHistory
        : null;
    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
                <header className="rounded-xl bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Employee Analysis</h1>
                            <p className="mt-1 text-sm text-slate-600">
                                House coverage and collection regularity for {beat.assignedEmployee.name}.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {beats.length > 1 && (
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                    Assigned Beat
                                    <select
                                        value={beat.id}
                                        onChange={(event) => setSelectedBeatId(event.target.value)}
                                        className="rounded border border-slate-300 bg-white p-2"
                                    >
                                        {beats.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {item.beatName} · {item.assignedEmployee.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            <label className="grid gap-1 text-sm font-medium text-slate-700">
                                Analyze through
                                <select
                                    value={effectiveEndDate || ""}
                                    onChange={(event) => setAnalysisEndDate(event.target.value)}
                                    disabled={!analysisDateOptions.length}
                                    className="rounded border border-slate-300 bg-white p-2 disabled:bg-slate-100"
                                >
                                    {analysisDateOptions.map((date) => (
                                        <option key={date} value={date}>{formatDate(date)}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                        {beat.beatName} · {formatDate(effectiveStartDate)} to {formatDate(effectiveEndDate)} · {reportWindowLabel}
                    </p>
                </header>

                <section aria-labelledby="beat-status-heading" className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 id="beat-status-heading" className="text-lg font-semibold text-slate-900">Beat Collection Status</h2>
                            <p className="mt-1 text-sm text-slate-600">
                                {formatNumber(totalHouses)} houses in My Beat: {formatNumber(ownCount)} collected by Me,{" "}
                                {formatNumber(otherCount)} by other employees, and {formatNumber(remainingCount)} not collected.
                                {" "}Overall Beat coverage is {beatCoveragePercent == null ? "unavailable" : `${formatNumber(beatCoveragePercent, 1)}%`}.
                            </p>
                        </div>
                        <div className="flex flex-col items-start gap-1">
                            <button
                                type="button"
                                onClick={() => onShowHighPriorityHouses?.({
                                    beatId: beat.id,
                                    houseIds: highPriorityHouseIds,
                                })}
                                disabled={!highPriorityHouseIds.length || !onShowHighPriorityHouses}
                                aria-label={`Show ${highPriorityHouseIds.length} high-priority houses for ${beat.beatName} on map`}
                                className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Show High-Priority Houses on Map ({formatNumber(highPriorityHouseIds.length)})
                            </button>
                            <span className="text-xs text-slate-500">
                                High priority: no scan in the 7 days before the selected analysis date.
                            </span>
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <Card label="Total Houses in My Beat" value={formatNumber(totalHouses)} />
                        <Card label="Collected by Me" value={formatNumber(ownCount)} tone="text-green-700"
                            detail={`${ownCoveragePercent == null ? "Unavailable" : `${formatNumber(ownCoveragePercent, 1)}%`} of My Beat houses; scanner must match the assigned employee.`} />
                        <Card label="Collected by Other Employees" value={formatNumber(otherCount)} tone="text-amber-700"
                            detail="These houses still belong to My Beat." />
                        <Card label="Not Collected" value={formatNumber(remainingCount)} tone="text-red-700"
                            detail="No identified employee scan in this period." />
                        <Card label="Overall Beat Coverage" value={beatCoveragePercent == null ? "Unavailable" : `${formatNumber(beatCoveragePercent, 1)}%`}
                            detail="Houses collected by Me or Others ÷ total houses." />
                    </div>
                    <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
                        <span className="font-semibold">{reportWindowLabel} regularity:</span>{" "}
                        {formatNumber(attentionCounts.regular)} regularly collected · {formatNumber(attentionCounts.lowFrequency)} low collection ·{" "}
                        {formatNumber(highPriorityHouses.length)} high priority ·{" "}
                        {formatNumber(attentionCounts.notCollected)} not collected.
                        {regularRate == null ? "" : ` ${formatNumber(regularRate, 1)}% of houses with collection history are within their observed pattern.`}
                        {" "}Outside-Beat houses collected by this employee: {beats.length > 1
                            ? formatNumber(outsideBeatAnalysis.totalHouses)
                            : "unavailable without other Beat data"}.
                    </p>
                    <p className="text-xs text-slate-500">
                        Collection categories use ScannerUserId matched to the assigned employee. Scans without an employee ID are included in scan frequency but are not attributed to Me or Others.
                    </p>
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">Houses Requiring Attention</h2>
                        <p className="mt-1 text-xs text-slate-600">
                            This is the same high-priority list. A house appears when it has no scan in the 7 days ending on the selected analysis date.
                        </p>
                    </div>
                    <div className="mt-3 max-h-[28rem] overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[420px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr><th className="p-3">House ID</th><th className="p-3">Last scanned</th><th className="p-3">Not scanned for</th></tr>
                            </thead>
                            <tbody>
                                {highPriorityHouses.map(({detail, daysSinceScan, unscannedThroughoutMonth}) => (
                                    <tr key={detail.house.houseId} className="border-t border-slate-100">
                                        <td className="p-3 font-medium">{detail.house.houseId}</td>
                                        <td className="p-3">{formatDate(detail.lastRecordedDate)}</td>
                                        <td className="p-3">{unscannedThroughoutMonth
                                            ? `No scan in the ${formatNumber(reportWindowDays)}-day period`
                                            : formatDays(daysSinceScan)}
                                        </td>
                                    </tr>
                                ))}
                                {!highPriorityHouses.length && <EmptyRow columns={3}>No houses were missed in the 7 days ending on this date.</EmptyRow>}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">Houses Collected by Other Employees</h2>
                        <p className="mt-1 text-xs text-slate-600">
                            These houses belong to My Beat. Select an employee to see the houses they collected.
                        </p>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800">
                        Total: {formatNumber(houseCoverage.otherEmployeeCollected)} distinct houses · {formatNumber(otherEmployeeGroups.length)} other employees
                    </p>
                    <div className="mt-2 max-h-[24rem] overflow-auto rounded border border-slate-200">
                        {otherEmployeeGroups.length ? otherEmployeeGroups.map((group) => (
                            <details key={group.employeeKey} className="border-b border-slate-100 last:border-b-0">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-sm hover:bg-slate-50">
                                    <span className="font-medium text-slate-800">{group.employeeName}</span>
                                    <span className="text-slate-600">{formatNumber(group.houses.length)} houses</span>
                                </summary>
                                <ul className="grid gap-1 bg-slate-50 px-3 pb-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                    {group.houses.map((houseId) => (
                                        <li key={houseId} className="rounded border border-slate-200 bg-white px-2 py-1">
                                            {houseId}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )) : (
                            <p className="p-6 text-center text-sm text-slate-500">
                                No My Beat houses have an identified scan by another employee in this period.
                            </p>
                        )}
                    </div>
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">My Collection Outside My Beat</h2>
                        <p className="mt-1 text-xs text-slate-600">
                            Counts distinct houses in other uploaded Beats scanned by this employee&apos;s ScannerUserId. This does not affect My Beat coverage.
                        </p>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800">
                        Total outside-Beat houses: {beats.length > 1
                            ? formatNumber(outsideBeatAnalysis.totalHouses)
                            : "Unavailable"}
                    </p>
                    <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[650px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr><th className="p-3">Other Beat</th><th className="p-3">Distinct houses</th><th className="p-3">House IDs</th></tr>
                            </thead>
                            <tbody>
                                {outsideBeatAnalysis.byBeat.map((item) => (
                                    <tr key={item.beatId} className="border-t border-slate-100">
                                        <td className="p-3">{item.beatName}</td>
                                        <td className="p-3">{formatNumber(item.count)}</td>
                                        <td className="p-3">{item.houseIds.slice(0, 12).join(", ")}{item.houseIds.length > 12
                                            ? ` and ${formatNumber(item.houseIds.length - 12)} more`
                                            : ""}</td>
                                    </tr>
                                ))}
                                {!outsideBeatAnalysis.byBeat.length && (
                                    <EmptyRow columns={3}>{beats.length > 1
                                        ? "No outside-Beat collection by this employee could be verified in this period."
                                        : "Upload other Beat data to verify outside-Beat collections."}</EmptyRow>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {outsideBeatAnalysis.unmatchedScanCount > 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                            {formatNumber(outsideBeatAnalysis.unmatchedScanCount)} scan(s) by this employee could not be matched to exactly one house in another uploaded Beat and are not included.
                        </p>
                    )}
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">{reportWindowLabel} Collection Frequency</h2>
                            <p className="mt-1 text-xs text-slate-600">
                                {formatNumber(houseCoverage.collectedAtLeastOnce)} houses have identified collection activity. Frequency counts route scans and available ScanningDate history.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <input
                                type="search"
                                value={houseSearch}
                                onChange={(event) => setHouseSearch(event.target.value)}
                                placeholder="Search house ID"
                                className="min-w-60 rounded border border-slate-300 px-3 py-2 text-sm"
                            />
                            <select value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}
                                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
                                <option value="all">All collection categories</option>
                                <option value="own">{COLLECTION_LABELS.own}</option>
                                <option value="other">{COLLECTION_LABELS.other}</option>
                                <option value="remaining">{COLLECTION_LABELS.remaining}</option>
                            </select>
                        </div>
                    </div>
                    <div className="mt-3 max-h-[34rem] overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[1050px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr><th className="p-3">House ID</th><th className="p-3">Collection category</th><th className="p-3">Scans / collection days</th><th className="p-3">Me / other scans</th><th className="p-3">Collection frequency</th><th className="p-3">Last scanned</th><th className="p-3">Normal interval</th><th className="p-3">Days since scan</th><th className="p-3">Status</th></tr>
                            </thead>
                            <tbody>
                                {currentHouses.map((detail) => (
                                    <tr key={detail.house.houseId} className="border-t border-slate-100">
                                        <td className="p-3 font-medium text-slate-900">{detail.house.houseId}</td>
                                        <td className="p-3">{COLLECTION_LABELS[detail.collectionCategory]}</td>
                                        <td className="p-3">{formatNumber(detail.recordedScanCount)} / {formatNumber(detail.collectionDays)}</td>
                                        <td className="p-3">{formatNumber(detail.assignedEmployeeScanCount)} / {formatNumber(detail.otherEmployeeScanCount)}</td>
                                        <td className="p-3">{detail.status === "Not Collected"
                                            ? "Not collected"
                                            : detail.isLowFrequency
                                                ? "Significantly below typical"
                                                : houseCoverage.typicalScanCount == null
                                                    ? "No frequency baseline"
                                                    : "Within typical range"}
                                        </td>
                                        <td className="p-3">{formatDate(detail.lastRecordedDate)}</td>
                                        <td className="p-3">{formatDays(detail.typicalIntervalDays)}</td>
                                        <td className="p-3">{formatDays(detail.currentGapDays)}</td>
                                        <td className="p-3">{detail.status}</td>
                                    </tr>
                                ))}
                                {!currentHouses.length && <EmptyRow columns={9}>No houses match these filters.</EmptyRow>}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                        <span>
                            Showing {visibleHouses.length ? formatNumber(currentPage * pageSize + 1) : 0}–
                            {formatNumber(Math.min((currentPage + 1) * pageSize, visibleHouses.length))} of {formatNumber(visibleHouses.length)}
                        </span>
                        <div className="flex gap-2">
                            <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}
                                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">Previous</button>
                            <span className="px-2 py-1">Page {currentPage + 1} of {pageCount}</span>
                            <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}
                                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">Next</button>
                        </div>
                    </div>
                </section>

                {(beat.historyWarnings?.unmatchedCollectionRecords > 0 ||
                    beat.historyWarnings?.ambiguousReferenceRecords > 0) && (
                    <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        {formatNumber(beat.historyWarnings.unmatchedCollectionRecords)} route collection record(s) did not match a house in this Beat and are not counted unless they match a house in another uploaded Beat.
                        {beat.historyWarnings.ambiguousReferenceRecords > 0 &&
                            ` ${formatNumber(beat.historyWarnings.ambiguousReferenceRecords)} ambiguous reference record(s) were excluded from house history.`}
                    </p>
                )}
            </div>
        </div>
    );
}
