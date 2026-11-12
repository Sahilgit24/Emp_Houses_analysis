import {useEffect, useMemo, useState} from "react";

const COLLECTION_LABELS = {
    own: "Collected by assigned employee",
    other: "Collected by other employee",
    remaining: "Remaining / no collection recorded",
};

const ATTENTION_RANK = {
    "Highly Overdue": 5,
    Overdue: 4,
    Monitor: 3,
    Due: 2,
    Regular: 1,
    "Insufficient History": 0,
};

function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {maximumFractionDigits: digits});
}

function formatDays(value) {
    if (value == null) return "Insufficient history";
    return `${formatNumber(value, 1)} day${value === 1 ? "" : "s"}`;
}

function formatTimestamp(value) {
    if (!value) return "No scan recorded";
    return value.replace("T", " ").replace(/([+-]\d\d:\d\d|Z)$/, "");
}

function weightInKilograms(dump, field) {
    const value = dump[field];
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = (dump.weightUnit || "").trim().toLowerCase();
    if (["kg", "kilogram", "kilograms"].includes(unit)) return value;
    if (["tonne", "tonnes", "metric_ton", "metric_tons", "t"].includes(unit)) return value * 1000;
    return null;
}

function sumReportedWeight(dumpEvents, field) {
    const values = dumpEvents.map((dump) => weightInKilograms(dump, field)).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function formatReportedWeight(weight) {
    return weight == null ? "Unavailable" : `${formatNumber(weight, 2)} kg`;
}

export default function EmployeeApiDashboard({beatData}) {
    const beats = beatData?.beats || [];
    const [selectedBeatId, setSelectedBeatId] = useState("");
    const [houseSearch, setHouseSearch] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [attentionOnly, setAttentionOnly] = useState(false);
    const [page, setPage] = useState(0);

    useEffect(() => {
        if (!beats.length) {
            setSelectedBeatId("");
            return;
        }
        if (!beats.some((beat) => beat.id === selectedBeatId)) setSelectedBeatId(beats[0].id);
    }, [beats, selectedBeatId]);

    const beat = beats.find((item) => item.id === selectedBeatId) || beats[0] || null;
    const dailyRoutes = useMemo(() => (beat?.routes || []).map((route) => {
        const mappedHouseIds = new Set(
            route.collectionScans.map((scan) => scan.houseId).filter(Boolean),
        );
        return {...route, mappedHouseCount: mappedHouseIds.size};
    }).sort((a, b) => b.date.localeCompare(a.date)), [beat]);
    const dailyCollectionTotal = useMemo(
        () => dailyRoutes.reduce((sum, route) => sum + route.mappedHouseCount, 0),
        [dailyRoutes],
    );
    const performanceSummary = useMemo(() => {
        const uniqueCollectedHouseIds = new Set();
        const dumpEvents = dailyRoutes.flatMap((route) => route.dumpEvents || []);
        dailyRoutes.forEach((route) => {
            route.collectionScans.forEach((scan) => {
                if (scan.houseId) uniqueCollectedHouseIds.add(scan.houseId);
            });
        });
        const totalHouses = beat?.totalHouses || 0;
        const reportedCollectedHouses = (beat?.classificationCounts.own || 0) +
            (beat?.classificationCounts.other || 0);
        const measuredDumpWeightCount = dumpEvents.filter((dump) =>
            ["totalGcWeight", "totalWetWeight", "totalDryWeight"]
                .some((field) => weightInKilograms(dump, field) != null)
        ).length;
        return {
            distanceKm: dailyRoutes.reduce((sum, route) => sum + route.distanceKm, 0),
            observedMinutes: dailyRoutes.reduce((sum, route) =>
                sum + (route.durationMinutes == null ? 0 : route.durationMinutes), 0),
            daysWithGps: dailyRoutes.filter((route) => route.trackPoints.length > 0).length,
            uniqueCollectedHouseCount: uniqueCollectedHouseIds.size,
            houseVisitCount: dailyCollectionTotal,
            dumpRecordCount: dumpEvents.length,
            measuredDumpWeightCount,
            totalGcWeight: sumReportedWeight(dumpEvents, "totalGcWeight"),
            totalWetWeight: sumReportedWeight(dumpEvents, "totalWetWeight"),
            totalDryWeight: sumReportedWeight(dumpEvents, "totalDryWeight"),
            reportedCollectedHouses,
            overallCollectionRate: totalHouses ? reportedCollectedHouses * 100 / totalHouses : null,
        };
    }, [beat, dailyRoutes, dailyCollectionTotal]);
    const historyCounts = useMemo(() => {
        const counts = {withHistory: 0, attention: 0};
        (beat?.houses || []).forEach((house) => {
            if (house.history.collectionCount > 0) counts.withHistory += 1;
            if (["Due", "Monitor", "Overdue", "Highly Overdue"].includes(house.history.attentionStatus)) {
                counts.attention += 1;
            }
        });
        return counts;
    }, [beat]);
    const filteredHouses = useMemo(() => (beat?.houses || [])
        .filter((house) => collectionFilter === "all" || house.collectionStatus === collectionFilter)
        .filter((house) => !attentionOnly || ATTENTION_RANK[house.history.attentionStatus] >= 2)
        .filter((house) => {
            const query = houseSearch.trim().toLowerCase();
            return !query || house.houseId.toLowerCase().includes(query) ||
                house.referenceId?.toLowerCase().includes(query);
        })
        .sort((a, b) =>
            ATTENTION_RANK[b.history.attentionStatus] - ATTENTION_RANK[a.history.attentionStatus] ||
            a.houseId.localeCompare(b.houseId)
        ), [beat, collectionFilter, attentionOnly, houseSearch]);

    const pageSize = 100;
    const pageCount = Math.max(1, Math.ceil(filteredHouses.length / pageSize));
    const currentPage = Math.min(page, pageCount - 1);
    const visibleHouses = filteredHouses.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    useEffect(() => {
        setPage(0);
    }, [selectedBeatId, houseSearch, collectionFilter, attentionOnly]);

    if (!beatData) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4">
                <p role="status" className="mx-auto max-w-7xl rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    Upload the Beat API file above to view assigned-Beat performance and house collection history.
                </p>
            </div>
        );
    }

    if (!beat) {
        return <div className="p-4 text-sm text-slate-600">No Beat records were found in this API file.</div>;
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
                <section className="rounded-xl bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Employee Analysis</h1>
                            <p className="mt-1 text-sm text-slate-600">
                                Collection and route activity from the shared Beat API file. Missing scan records are not proof that a house was missed.
                            </p>
                        </div>
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
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <article className="rounded-lg border border-slate-200 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employee / assigned Beat</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{beat.assignedEmployee.name}</p>
                            <p className="mt-1 text-xs text-slate-600">
                                BeatUserId: {beat.beatUserId} · {beat.beatName}
                            </p>
                            {!beat.beatNameAvailable && (
                                <p className="mt-1 text-xs text-amber-700">A separate BeatId/name was not included; using BeatUserId as the stable key.</p>
                            )}
                        </article>
                        <article className="rounded-lg border border-slate-200 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data period</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{beat.fromDate || "Unavailable"} – {beat.toDate || "Unavailable"}</p>
                            <p className="mt-1 text-xs text-slate-600">House-level history uses ScanningDate and matched RouteDetails collection timestamps.</p>
                        </article>
                        <article className="rounded-lg border border-slate-200 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded route activity</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{formatNumber(dailyRoutes.length)} days</p>
                            <p className="mt-1 text-xs text-slate-600">
                                {formatNumber(dailyCollectionTotal)} distinct HouseIds linked to route scans across {formatNumber(beat.routes.reduce((sum, route) => sum + route.trackPoints.length, 0))} GPS points.
                            </p>
                        </article>
                    </div>
                </section>

                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Performance summary">
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">GPS distance estimate</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(performanceSummary.distanceKm, 2)} km</p>
                        <p className="mt-1 text-xs text-slate-500">Straight-line distance across recorded GPS points.</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Observed GPS time span</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(performanceSummary.observedMinutes / 60, 1)} hours</p>
                        <p className="mt-1 text-xs text-slate-500">Sum of each day&apos;s first-to-last GPS timestamp span across {formatNumber(performanceSummary.daysWithGps)} days; not paid or active work time.</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">House collection activity</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(performanceSummary.uniqueCollectedHouseCount)} unique houses</p>
                        <p className="mt-1 text-xs text-slate-500">{formatNumber(performanceSummary.houseVisitCount)} distinct house visits across days, matched from route collection records.</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Dump weight recorded</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">
                            {performanceSummary.totalGcWeight == null
                                ? "Unavailable"
                                : formatReportedWeight(performanceSummary.totalGcWeight)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                            {formatNumber(performanceSummary.dumpRecordCount)} dump records · {formatNumber(performanceSummary.measuredDumpWeightCount)} with positive weight and a recognized unit. {performanceSummary.totalGcWeight == null
                                ? "No positive GC weight values with kg/tonnes units were supplied."
                                : `Wet: ${formatReportedWeight(performanceSummary.totalWetWeight)} · Dry: ${formatReportedWeight(performanceSummary.totalDryWeight)}.`}
                        </p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Overall Beat collection</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">
                            {performanceSummary.overallCollectionRate == null
                                ? "Unavailable"
                                : `${formatNumber(performanceSummary.overallCollectionRate, 1)}%`}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                            {formatNumber(performanceSummary.reportedCollectedHouses)} of {formatNumber(beat.totalHouses)} houses marked collected by the assigned employee or others.
                        </p>
                    </article>
                </section>

                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Total houses</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(beat.totalHouses)}</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Own collection</p>
                        <p className="mt-2 text-2xl font-bold text-green-700">{formatNumber(beat.classificationCounts.own)}</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Collected by others in assigned Beat</p>
                        <p className="mt-2 text-2xl font-bold text-amber-700">{formatNumber(beat.classificationCounts.other)}</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Remaining / no scan recorded</p>
                        <p className="mt-2 text-2xl font-bold text-red-700">{formatNumber(beat.classificationCounts.remaining)}</p>
                    </article>
                    <article className="rounded-xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">Houses needing attention</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(historyCounts.attention)}</p>
                        <p className="mt-1 text-xs text-slate-500">Based on recorded history; not a missed-collection count.</p>
                    </article>
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-900">Daily route and collection activity</h2>
                    <p className="mt-1 text-xs text-slate-600">
                        Collection totals count distinct HouseIds matched by ReferenceId in the assigned employee&apos;s RouteDetails. GPS distance is a straight-line estimate along recorded points, not road distance. Dump weights are converted to kg only when a positive value and recognized kg/tonnes unit are provided.
                    </p>
                    <div className="mt-3 max-h-[28rem] overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[950px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr>
                                    <th className="p-3">Date</th>
                                    <th className="p-3">HouseIds linked to route scans</th>
                                    <th className="p-3">Route scan records</th>
                                    <th className="p-3">GPS points</th>
                                    <th className="p-3">GPS distance estimate</th>
                                    <th className="p-3">Observed GPS span</th>
                                    <th className="p-3">Dump records</th>
                                    <th className="p-3">GC weight</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyRoutes.map((route) => (
                                    <tr key={route.date} className="border-t border-slate-100">
                                        <td className="p-3">{route.date}</td>
                                        <td className="p-3">{formatNumber(route.mappedHouseCount)}</td>
                                        <td className="p-3">{formatNumber(route.collectionScans.length)}</td>
                                        <td className="p-3">{formatNumber(route.trackPoints.length)}</td>
                                        <td className="p-3">{route.trackPoints.length ? `${formatNumber(route.distanceKm, 2)} km` : "Unavailable"}</td>
                                        <td className="p-3">{route.durationMinutes == null ? "Unavailable" : `${formatNumber(route.durationMinutes, 0)} min`}</td>
                                        <td className="p-3">{formatNumber((route.dumpEvents || []).length)}</td>
                                        <td className="p-3">{formatReportedWeight(
                                            sumReportedWeight(route.dumpEvents || [], "totalGcWeight"),
                                        )}</td>
                                    </tr>
                                ))}
                                {!dailyRoutes.length && (
                                    <tr><td colSpan={8} className="p-6 text-center text-slate-500">No dated route records were included.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                        Activity gaps between GPS or collection records can include travel, stops, or missing scans; they do not prove idle or wasted time.
                    </p>
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">House collection history and attention</h2>
                            <p className="mt-1 text-xs text-slate-600">
                                {formatNumber(historyCounts.withHistory)} houses have at least one linked collection date. Typical intervals use the median gap between distinct recorded dates.
                            </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                                type="checkbox"
                                checked={attentionOnly}
                                onChange={(event) => setAttentionOnly(event.target.checked)}
                            />
                            Show Due / Monitor / Overdue / Highly Overdue only
                        </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <input
                            type="search"
                            value={houseSearch}
                            onChange={(event) => setHouseSearch(event.target.value)}
                            placeholder="Search HouseId or ReferenceId"
                            className="min-w-60 rounded border border-slate-300 px-3 py-2 text-sm"
                        />
                        <select
                            value={collectionFilter}
                            onChange={(event) => setCollectionFilter(event.target.value)}
                            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                            <option value="all">All collection categories</option>
                            <option value="own">{COLLECTION_LABELS.own}</option>
                            <option value="other">{COLLECTION_LABELS.other}</option>
                            <option value="remaining">{COLLECTION_LABELS.remaining}</option>
                        </select>
                    </div>
                    <div className="mt-3 max-h-[34rem] overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[1050px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr>
                                    <th className="p-3">HouseId</th>
                                    <th className="p-3">Collection category</th>
                                    <th className="p-3">Last collection record</th>
                                    <th className="p-3">Previous collection</th>
                                    <th className="p-3">Recorded collections</th>
                                    <th className="p-3">Typical interval</th>
                                    <th className="p-3">Current gap</th>
                                    <th className="p-3">History status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleHouses.map((house) => (
                                    <tr key={house.houseId} className="border-t border-slate-100">
                                        <td className="p-3 font-medium text-slate-900">{house.houseId}</td>
                                        <td className="p-3">{COLLECTION_LABELS[house.collectionStatus]}</td>
                                        <td className="p-3">{formatTimestamp(house.history.lastCollectionAt)}</td>
                                        <td className="p-3">{formatTimestamp(house.history.previousCollectionAt)}</td>
                                        <td className="p-3">{formatNumber(house.history.collectionCount)}</td>
                                        <td className="p-3">{formatDays(house.history.typicalIntervalDays)}</td>
                                        <td className="p-3">{formatDays(house.history.currentGapDays)}</td>
                                        <td className="p-3">{house.history.attentionStatus}</td>
                                    </tr>
                                ))}
                                {!visibleHouses.length && (
                                    <tr><td colSpan={8} className="p-6 text-center text-slate-500">No houses match these filters.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                        <span>
                            Showing {filteredHouses.length ? formatNumber(currentPage * pageSize + 1) : 0}–
                            {formatNumber(Math.min((currentPage + 1) * pageSize, filteredHouses.length))} of {formatNumber(filteredHouses.length)}
                        </span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={currentPage === 0}
                                onClick={() => setPage(currentPage - 1)}
                                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <span className="px-2 py-1">Page {currentPage + 1} of {pageCount}</span>
                            <button
                                type="button"
                                disabled={currentPage >= pageCount - 1}
                                onClick={() => setPage(currentPage + 1)}
                                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </section>

                {(beat.historyWarnings.unmatchedCollectionRecords > 0 || beat.historyWarnings.ambiguousReferenceRecords > 0) && (
                    <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        {formatNumber(beat.historyWarnings.unmatchedCollectionRecords)} route collection record(s) had ReferenceIds not found in BeatWiseReport and were excluded from house history.
                        {beat.historyWarnings.ambiguousReferenceRecords > 0 &&
                            ` ${formatNumber(beat.historyWarnings.ambiguousReferenceRecords)} record(s) had ambiguous ReferenceIds and were also excluded.`}
                    </p>
                )}
                {beats.length === 1 && (
                    <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
                        Other-Beat collection: no other Beat data was included in this file. The normalized model retains a separate record per Beat for later multi-Beat uploads.
                    </p>
                )}
            </div>
        </div>
    );
}
