import {useEffect, useMemo, useState} from "react";
import {
    analyzeCollectionGaps,
    analyzeDailyDistance,
    analyzeDailyTime,
    analyzeHouseCoverage,
    analyzeOutsideBeatCollections,
    buildSuggestedHouses,
    findLongGpsStops,
    getReportWindowDays,
    medianValue,
} from "../data/employeePerformance.js";

const COLLECTION_LABELS = {
    own: "Collected by Me",
    other: "Collected by Others",
    remaining: "Not Collected",
};

const TABS = [
    {id: "distance", label: "Distance"},
    {id: "time", label: "Time"},
    {id: "houses", label: "Houses"},
    {id: "overall", label: "Overall Performance"},
];

function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {maximumFractionDigits: digits});
}

function formatDays(value) {
    return value == null ? "Unavailable" : `${formatNumber(value, 1)} day${value === 1 ? "" : "s"}`;
}

function formatDuration(minutes) {
    if (minutes == null) return "Unavailable";
    const totalMinutes = Math.round(minutes);
    if (totalMinutes < 60) return `${formatNumber(totalMinutes)} min`;
    const hours = Math.floor(totalMinutes / 60);
    const remainder = totalMinutes % 60;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatTimestamp(value) {
    if (!value) return "No scan recorded";
    return value.replace("T", " ").replace(/([+-]\d\d:\d\d|Z)$/, "");
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

function formatRouteEndpoints(route) {
    const first = route.trackPoints[0];
    const last = route.trackPoints.at(-1);
    if (!first || !last) return "GPS endpoints unavailable";
    return `${first.lat.toFixed(5)}, ${first.lon.toFixed(5)} to ${last.lat.toFixed(5)}, ${last.lon.toFixed(5)}`;
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

export default function EmployeeApiDashboard({beatData}) {
    const beats = beatData?.beats || [];
    const [selectedBeatId, setSelectedBeatId] = useState("");
    const [activeTab, setActiveTab] = useState("distance");
    const [selectedDate, setSelectedDate] = useState("");
    const [houseSearch, setHouseSearch] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [page, setPage] = useState(0);

    useEffect(() => {
        if (!beats.length) {
            setSelectedBeatId("");
            return;
        }
        if (!beats.some((item) => item.id === selectedBeatId)) setSelectedBeatId(beats[0].id);
    }, [beats, selectedBeatId]);

    const beat = beats.find((item) => item.id === selectedBeatId) || beats[0] || null;
    const routes = useMemo(() => (beat?.routes || [])
        .filter((route) => (!beat?.fromDate || route.date >= beat.fromDate) &&
            (!beat?.toDate || route.date <= beat.toDate))
        .map((route) => ({
            ...route,
            mappedHouseCount: new Set(route.collectionScans.map((scan) => scan.houseId).filter(Boolean)).size,
        })), [beat]);
    const dailyDistances = useMemo(() => analyzeDailyDistance(routes), [routes]);
    const dailyTimes = useMemo(() => analyzeDailyTime(routes), [routes]);
    const latestActivityRoute = [...routes].reverse()
        .find((route) => route.trackPoints.length || route.collectionScans.length) || routes.at(-1) || null;
    const selectedRoute = routes.find((route) => route.date === selectedDate) || latestActivityRoute;
    const reportWindowDays = getReportWindowDays(beat?.fromDate, beat?.toDate);
    const reportWindowLabel = reportWindowDays == null
        ? "reporting window"
        : `${formatNumber(reportWindowDays)}-day reporting window`;

    useEffect(() => {
        if (routes.length && !routes.some((route) => route.date === selectedDate)) {
            setSelectedDate(latestActivityRoute.date);
        }
    }, [beat?.id, latestActivityRoute, routes, selectedDate]);

    const gpsRoutes = routes.filter((route) => route.trackPoints.length > 0);
    const totalDistanceKm = gpsRoutes.reduce((sum, route) => sum + route.distanceKm, 0);
    const totalRecordedMinutes = dailyTimes.reduce((sum, route) => sum + (route.recordedTimeMinutes || 0), 0);
    const recordedTimeDays = dailyTimes.filter((route) => route.recordedTimeMinutes != null).length;
    const gaps = useMemo(() => analyzeCollectionGaps(routes), [routes]);
    const gpsStops = useMemo(() => routes.flatMap((route) => findLongGpsStops(route)), [routes]);
    const selectedDayGaps = selectedRoute
        ? gaps.gaps.filter((gap) => gap.date === selectedRoute.date)
        : [];
    const selectedDayScans = [...(selectedRoute?.collectionScans || [])]
        .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    const selectedDayLongGaps = selectedRoute
        ? gaps.longGaps.filter((gap) => gap.date === selectedRoute.date)
        : [];
    const selectedDistanceAnalysis = dailyDistances.find((route) => route.date === selectedRoute?.date);
    const selectedTimeAnalysis = dailyTimes.find((route) => route.date === selectedRoute?.date);

    const otherBeats = useMemo(() => beats.filter((item) => item.id !== beat?.id), [beats, beat?.id]);
    const outsideBeatAnalysis = useMemo(
        () => analyzeOutsideBeatCollections(routes, otherBeats, beat?.assignedEmployee.id),
        [beat, otherBeats, routes],
    );

    const houseCoverage = useMemo(
        () => analyzeHouseCoverage(
            beat?.houses || [],
            routes,
            beat?.fromDate,
            beat?.toDate,
            beat?.assignedEmployee,
            otherBeats,
        ),
        [beat, otherBeats, routes],
    );
    const suggestedHouses = useMemo(
        () => buildSuggestedHouses(
            houseCoverage.requiringAttention.map((detail) => ({
                ...detail.house,
                analysisCollectionDates: detail.collectionDates,
                analysisScanCount: detail.recordedScanCount,
                analysisOtherScanCount: detail.otherEmployeeScanCount,
                analysisStatus: detail.status,
                analysisReason: detail.attentionReason,
                analysisCurrentGapDays: detail.currentGapDays,
                analysisTypicalIntervalDays: detail.typicalIntervalDays,
                analysisRepeatedLongGaps: detail.repeatedLongGaps,
                analysisLastRecordedDate: detail.lastRecordedDate,
            })),
            reportWindowDays,
            beat?.fromDate,
            beat?.toDate,
        ),
        [beat, houseCoverage, reportWindowDays],
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
        .sort((a, b) => a.house.houseId.localeCompare(b.house.houseId)), [houseCoverage, collectionFilter, houseSearch]);
    const pageSize = 100;
    const pageCount = Math.max(1, Math.ceil(visibleHouses.length / pageSize));
    const currentPage = Math.min(page, pageCount - 1);
    const currentHouses = visibleHouses.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    const otherEmployeeRows = houseCoverage.details.flatMap((detail) =>
        detail.otherEmployeeCollectionRecords.map((record, index) => ({
            house: detail.house,
            record,
            key: `${detail.house.houseId}-${record.date}-${record.timestamp}-${index}`,
        }))
    );

    useEffect(() => setPage(0), [selectedBeatId, collectionFilter, houseSearch]);

    if (!beatData) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4">
                <p role="status" className="mx-auto max-w-7xl rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    Upload the Beat API file above to view employee distance, time, and house collection analysis.
                </p>
            </div>
        );
    }

    if (!beat) return <div className="p-4 text-sm text-slate-600">No Beat records were found in this API file.</div>;

    const highDistanceRoutes = dailyDistances.filter((route) => route.isSignificantExtra);
    const highTimeRoutes = dailyTimes.filter((route) => route.isSignificantExtra);
    const ownCount = houseCoverage.assignedEmployeeCollected;
    const otherCount = houseCoverage.otherEmployeeCollected;
    const remainingCount = houseCoverage.remainingWithoutHistory;
    const ownCoveragePercent = beat.totalHouses
        ? ownCount * 100 / beat.totalHouses
        : null;
    const regularRate = attentionCounts.withHistory
        ? attentionCounts.regular * 100 / attentionCounts.withHistory
        : null;
    const topSuggestions = suggestedHouses.slice(0, 5);

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
                <header className="rounded-xl bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Employee Analysis</h1>
                            <p className="mt-1 text-sm text-slate-600">
                                Recorded GPS route and house collection patterns for {beat.assignedEmployee.name}.
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
                    <p className="mt-3 text-xs text-slate-500">
                        {beat.beatName} · {beat.fromDate || "Start date unavailable"} to {beat.toDate || "End date unavailable"} · {reportWindowLabel}
                    </p>
                </header>

                <nav role="tablist" aria-label="Employee analysis sections" className="flex flex-wrap gap-2">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === tab.id
                                ? "bg-blue-700 text-white"
                                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                {activeTab === "distance" && (
                    <section role="tabpanel" className="flex flex-col gap-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Card
                                label="Total GPS route distance"
                                value={`${formatNumber(totalDistanceKm, 2)} km`}
                                detail="Sum of distances between consecutive employee GPS points."
                            />
                            <Card
                                label="Average distance per GPS day"
                                value={gpsRoutes.length ? `${formatNumber(totalDistanceKm / gpsRoutes.length, 2)} km` : "Unavailable"}
                                detail={`Average over ${formatNumber(gpsRoutes.length)} days with GPS points; days without GPS are excluded.`}
                            />
                        </div>
                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900">Day-wise distance</h2>
                                    <p className="mt-1 text-xs text-slate-600">
                                        GPS-track distance is calculated from recorded coordinates, not road-network distance.
                                    </p>
                                </div>
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                    Select date
                                    <select
                                        value={selectedRoute?.date || ""}
                                        onChange={(event) => setSelectedDate(event.target.value)}
                                        className="rounded border border-slate-300 bg-white px-3 py-2"
                                    >
                                        {routes.map((route) => <option key={route.date} value={route.date}>{route.date}</option>)}
                                    </select>
                                </label>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                <Card label="Selected-day route distance" value={selectedRoute?.trackPoints.length
                                    ? `${formatNumber(selectedRoute.distanceKm, 2)} km`
                                    : "Unavailable"} detail={`${selectedRoute?.date || "No route date"} · GPS points: ${formatNumber(selectedRoute?.trackPoints.length || 0)}`} />
                                <Card label="Expected / extra distance" value={selectedDistanceAnalysis?.expectedDistanceKm == null
                                    ? "Unavailable"
                                    : `${formatNumber(selectedDistanceAnalysis.expectedDistanceKm, 2)} km / +${formatNumber(selectedDistanceAnalysis.extraDistanceKm, 2)} km`}
                                detail={selectedDistanceAnalysis?.extraDistancePercent == null
                                    ? "No comparable GPS day with matched collections."
                                    : `${formatNumber(selectedDistanceAnalysis.extraDistancePercent, 1)}% above expected distance.`} />
                                <Card label="Selected-day route coverage" value={`${formatNumber(selectedRoute?.mappedHouseCount || 0)} houses`}
                                    detail="Distinct assigned-Beat houses matched to this employee's route scans." />
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                Expected distance is the median GPS distance per matched collection house across comparable days, multiplied by that day&apos;s matched-house count. Significant extra distance is at least 2 km and 25% above expected; this is a workload-adjusted benchmark, not an optimized road route.
                            </p>
                            <div className="mt-4 max-h-[34rem] overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[1050px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">Date</th><th className="p-3">Actual distance</th><th className="p-3">Normal / expected</th><th className="p-3">Extra distance</th><th className="p-3">Extra %</th><th className="p-3">Matched houses</th><th className="p-3">Reason / route area</th></tr>
                                    </thead>
                                    <tbody>
                                        {[...dailyDistances].reverse().map((route) => (
                                            <tr key={route.date} className="border-t border-slate-100">
                                                <td className="p-3">{route.date}</td>
                                                <td className="p-3">{route.trackPoints.length ? `${formatNumber(route.distanceKm, 2)} km` : "Unavailable"}</td>
                                                <td className="p-3">{route.expectedDistanceKm == null ? "Unavailable" : `${formatNumber(route.expectedDistanceKm, 2)} km`}</td>
                                                <td className={`p-3 ${route.isSignificantExtra ? "font-semibold text-red-700" : ""}`}>
                                                    {route.extraDistanceKm == null ? "Unavailable" : `+${formatNumber(route.extraDistanceKm, 2)} km`}
                                                </td>
                                                <td className="p-3">{route.extraDistancePercent == null ? "Unavailable" : `${formatNumber(route.extraDistancePercent, 1)}%`}</td>
                                                <td className="p-3">{formatNumber(route.mappedHouseCount)}</td>
                                                <td className="p-3">
                                                    {route.isSignificantExtra
                                                        ? `Above workload benchmark for ${formatNumber(route.mappedHouseCount)} matched houses; ${formatRouteEndpoints(route)}`
                                                        : route.expectedDistanceKm == null
                                                            ? "Insufficient matched-house GPS comparison"
                                                            : "Within workload-adjusted range"}
                                                </td>
                                            </tr>
                                        ))}
                                        {!routes.length && <EmptyRow columns={7}>No dated route records were included.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </section>
                )}

                {activeTab === "time" && (
                    <section role="tabpanel" className="flex flex-col gap-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Card
                                label="Total recorded GPS time"
                                value={formatDuration(totalRecordedMinutes)}
                                detail="Sum of each GPS day's first-to-last recorded point span; not paid or active work time."
                            />
                            <Card
                                label="Average time per GPS day"
                                value={recordedTimeDays ? formatDuration(totalRecordedMinutes / recordedTimeDays) : "Unavailable"}
                                detail={`Average over ${formatNumber(recordedTimeDays)} days with a measurable GPS time span.`}
                            />
                        </div>
                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900">Day-wise recorded time and collection gaps</h2>
                                    <p className="mt-1 text-xs text-slate-600">
                                        A gap is the elapsed time between adjacent recorded collection timestamps, not proof of idle or wasted time.
                                    </p>
                                </div>
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                    Select date
                                    <select
                                        value={selectedRoute?.date || ""}
                                        onChange={(event) => setSelectedDate(event.target.value)}
                                        className="rounded border border-slate-300 bg-white px-3 py-2"
                                    >
                                        {routes.map((route) => <option key={route.date} value={route.date}>{route.date}</option>)}
                                    </select>
                                </label>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-4">
                                <Card label="Selected-day GPS span" value={selectedTimeAnalysis?.recordedTimeMinutes == null
                                    ? "Unavailable"
                                    : formatDuration(selectedTimeAnalysis.recordedTimeMinutes)} detail="First-to-last GPS point timestamp." />
                                <Card label="Normal / extra time" value={selectedTimeAnalysis?.normalTimeMinutes == null
                                    ? "Unavailable"
                                    : `${formatDuration(selectedTimeAnalysis.normalTimeMinutes)} / +${formatDuration(selectedTimeAnalysis.extraTimeMinutes)}`}
                                detail="Normal is the median across GPS days in this reporting window." />
                                <Card label="Recorded collection gaps" value={formatNumber(selectedDayGaps.length)}
                                    detail={gaps.typicalGapMinutes == null ? "No adjacent scan timestamps available." : `Typical gap across recorded days: ${formatDuration(gaps.typicalGapMinutes)}.`} />
                                <Card label="Long collection gaps" value={formatNumber(selectedDayLongGaps.length)}
                                    detail={`Long means over ${formatDuration(gaps.longGapThresholdMinutes)} (max of 60 minutes or 2× the observed median).`} />
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                Extra time is the amount above the median GPS-day span; days at least 60 minutes and 25% above normal are highlighted. Long stationary GPS stretches are presented as unusual stops, not as evidence of wasted time.
                            </p>
                            <div className="mt-4 max-h-[34rem] overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[900px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">Date</th><th className="p-3">Recorded time</th><th className="p-3">Normal time</th><th className="p-3">Extra time</th><th className="p-3">Collection scans</th><th className="p-3">Longest collection gap</th><th className="p-3">Unusual-time flag</th></tr>
                                    </thead>
                                    <tbody>
                                        {[...dailyTimes].reverse().map((route) => {
                                            const dayGaps = gaps.gaps.filter((gap) => gap.date === route.date);
                                            const longestGap = dayGaps.reduce((longest, gap) => Math.max(longest, gap.minutes), 0);
                                            return (
                                                <tr key={route.date} className="border-t border-slate-100">
                                                    <td className="p-3">{route.date}</td>
                                                    <td className="p-3">{route.recordedTimeMinutes == null ? "Unavailable" : formatDuration(route.recordedTimeMinutes)}</td>
                                                    <td className="p-3">{route.normalTimeMinutes == null ? "Unavailable" : formatDuration(route.normalTimeMinutes)}</td>
                                                    <td className={`p-3 ${route.isSignificantExtra ? "font-semibold text-amber-700" : ""}`}>
                                                        {route.extraTimeMinutes == null ? "Unavailable" : `+${formatDuration(route.extraTimeMinutes)}`}
                                                    </td>
                                                    <td className="p-3">{formatNumber(route.collectionScans.length)}</td>
                                                    <td className="p-3">{longestGap ? formatDuration(longestGap) : "Unavailable"}</td>
                                                    <td className="p-3">{route.isSignificantExtra ? "Unusually long GPS span" : "—"}</td>
                                                </tr>
                                            );
                                        })}
                                        {!routes.length && <EmptyRow columns={7}>No dated route records were included.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                            <h3 className="mt-5 font-semibold text-slate-800">Long stationary GPS stops</h3>
                            <p className="mt-1 text-xs text-slate-500">
                                GPS points remaining within 50 meters for at least 30 minutes. Coordinates show the observed area; a stop alone does not establish its purpose.
                            </p>
                            <div className="mt-2 max-h-72 overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[750px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">Date</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Duration</th><th className="p-3">Approx. location</th></tr>
                                    </thead>
                                    <tbody>
                                        {gpsStops.map((stop, index) => (
                                            <tr key={`${stop.date}-${stop.start}-${index}`} className="border-t border-slate-100">
                                                <td className="p-3">{stop.date}</td>
                                                <td className="p-3">{formatTimestamp(stop.start)}</td>
                                                <td className="p-3">{formatTimestamp(stop.end)}</td>
                                                <td className="p-3">{formatDuration(stop.durationMinutes)}</td>
                                                <td className="p-3">{stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}</td>
                                            </tr>
                                        ))}
                                        {!gpsStops.length && <EmptyRow columns={5}>No GPS stay of at least 30 minutes within 50 meters was identified.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                            <h3 className="mt-5 font-semibold text-slate-800">Collection scans on {selectedRoute?.date || "selected date"}</h3>
                            <div className="mt-2 max-h-72 overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[520px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">Scan time</th><th className="p-3">HouseId</th><th className="p-3">Gap from previous scan</th><th className="p-3">Gap flag</th></tr>
                                    </thead>
                                    <tbody>
                                        {selectedDayScans.map((scan, index) => {
                                            const precedingGap = selectedDayGaps.find((gap) => gap.end === scan);
                                            const isLong = precedingGap && precedingGap.minutes > gaps.longGapThresholdMinutes;
                                            return (
                                                <tr key={`${scan.datetime}-${scan.houseId || scan.plateId || index}`} className="border-t border-slate-100">
                                                    <td className="p-3">{scan.datetime.slice(11, 19) || "Time unavailable"}</td>
                                                    <td className="p-3">{scan.houseId || "Unmatched route scan"}</td>
                                                    <td className="p-3">{precedingGap ? formatDuration(precedingGap.minutes) : "First scan"}</td>
                                                    <td className="p-3">{isLong ? "Long recorded gap" : "—"}</td>
                                                </tr>
                                            );
                                        })}
                                        {!selectedRoute?.collectionScans.length && <EmptyRow columns={4}>No collection scans were recorded for this date.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </section>
                )}

                {activeTab === "houses" && (
                    <section role="tabpanel" className="flex flex-col gap-4">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            <Card label="Total Houses in My Beat" value={formatNumber(beat.totalHouses)} />
                            <Card label="Collected by Me" value={formatNumber(ownCount)} tone="text-green-700"
                                detail="Houses with My Beat collection activity and no other-employee collection in this period." />
                            <Card label="Collected by Other Employees" value={formatNumber(otherCount)} tone="text-amber-700"
                                detail="My Beat houses with collection activity from another employee; not counted as my coverage." />
                            <Card label="Not Yet Collected" value={formatNumber(remainingCount)} tone="text-red-700"
                                detail="No collection record during this reporting period." />
                            <Card label="My Beat Coverage" value={ownCoveragePercent == null ? "Unavailable" : `${formatNumber(ownCoveragePercent, 1)}%`}
                                detail="Collected by me ÷ total houses in My Beat." />
                        </div>
                        <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
                            <span className="font-semibold">30-day regularity:</span>{" "}
                            {formatNumber(attentionCounts.regular)} regular · {formatNumber(attentionCounts.lowFrequency)} low frequency ·{" "}
                            {formatNumber(attentionCounts.needsAttention + attentionCounts.overdue)} needs attention ·{" "}
                            {formatNumber(attentionCounts.notCollected)} not collected.
                            {" "}Each house is counted once in My Beat coverage; houses with other-employee scans are excluded from Collected by Me.
                        </p>

                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">Houses Requiring Attention</h2>
                                <p className="mt-1 text-xs text-slate-600">
                                    Houses are included for no recorded scan, low scan frequency, overdue collection intervals, or repeated long gaps.
                                </p>
                            </div>
                            <div className="mt-3 max-h-[28rem] overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[850px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">House</th><th className="p-3">Scans in period</th><th className="p-3">Last scanned</th><th className="p-3">Days since scan</th><th className="p-3">Status</th><th className="p-3">Why it needs attention</th></tr>
                                    </thead>
                                    <tbody>
                                        {houseCoverage.requiringAttention.map((detail) => (
                                            <tr key={detail.house.houseId} className="border-t border-slate-100">
                                                <td className="p-3 font-medium">{detail.house.houseId}</td>
                                                <td className="p-3">{formatNumber(detail.recordedScanCount)}</td>
                                                <td className="p-3">{formatDate(detail.lastRecordedDate)}</td>
                                                <td className="p-3">{formatDays(detail.currentGapDays)}</td>
                                                <td className={`p-3 font-semibold ${detail.status === "Not Collected" || detail.status === "Overdue"
                                                    ? "text-red-700"
                                                    : "text-amber-700"}`}>{detail.status}</td>
                                                <td className="p-3">{detail.attentionReason}</td>
                                            </tr>
                                        ))}
                                        {!houseCoverage.requiringAttention.length && <EmptyRow columns={6}>No houses currently meet the reporting-period attention criteria.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">Suggested Houses for Next Collection</h2>
                                <p className="mt-1 text-xs text-slate-600">
                                    Prioritized from the houses above using the 30-day scan count, last scan date, historical interval, and repeated gaps.
                                </p>
                            </div>
                            <div className="mt-3 max-h-[28rem] overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[820px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">House</th><th className="p-3">Last scanned</th><th className="p-3">Days since scan</th><th className="p-3">Scans in period</th><th className="p-3">Reason</th><th className="p-3">Priority</th></tr>
                                    </thead>
                                    <tbody>
                                        {suggestedHouses.map((suggestion) => (
                                            <tr key={suggestion.house.houseId} className="border-t border-slate-100">
                                                <td className="p-3 font-medium">{suggestion.house.houseId}</td>
                                                <td className="p-3">{formatDate(suggestion.lastRecordedDate)}</td>
                                                <td className="p-3">{formatDays(suggestion.currentGapDays)}</td>
                                                <td className="p-3">{formatNumber(suggestion.windowScanCount)}</td>
                                                <td className="p-3">{suggestion.reason}</td>
                                                <td className={`p-3 font-semibold ${suggestion.priority === "High" ? "text-red-700" : "text-amber-700"}`}>
                                                    {suggestion.priority}
                                                </td>
                                            </tr>
                                        ))}
                                        {!suggestedHouses.length && <EmptyRow columns={6}>No houses need prioritization based on this period&apos;s history.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">Collected by Other Employees</h2>
                                <p className="mt-1 text-xs text-slate-600">
                                    These houses belong to My Beat and have collection scans by another employee during the reporting period. They are not included in Collected by Me.
                                </p>
                            </div>
                            <p className="mt-3 text-sm font-semibold text-slate-800">
                                Total houses collected by others: {formatNumber(houseCoverage.otherEmployeeCollected)} distinct houses · {formatNumber(otherEmployeeRows.length)} scan records
                            </p>
                            <div className="mt-2 max-h-[24rem] overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[600px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">House</th><th className="p-3">Scanner employee</th><th className="p-3">Scanning date</th></tr>
                                    </thead>
                                    <tbody>
                                        {otherEmployeeRows.map(({house, record, key}) => (
                                            <tr key={key} className="border-t border-slate-100">
                                                <td className="p-3 font-medium">{house.houseId}</td>
                                                <td className="p-3">{record.scannerName || "Other employee (name unavailable)"}</td>
                                                <td className="p-3">{formatDate(record.date)}</td>
                                            </tr>
                                        ))}
                                        {!otherEmployeeRows.length && <EmptyRow columns={3}>No assigned-Beat houses have a recorded scan by another employee in this period.</EmptyRow>}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">My Collection Outside My Beat</h2>
                                <p className="mt-1 text-xs text-slate-600">
                                    Verified by matching my route collections to houses in other uploaded Beats. This activity is separate from My Beat coverage.
                                </p>
                            </div>
                            <p className="mt-3 text-sm font-semibold text-slate-800">
                                Total houses collected outside My Beat: {beats.length > 1
                                    ? formatNumber(outsideBeatAnalysis.totalHouses)
                                    : "Unavailable"}
                            </p>
                            <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-200">
                                <table className="w-full min-w-[420px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                        <tr><th className="p-3">Other Beat</th><th className="p-3">Distinct houses collected</th></tr>
                                    </thead>
                                    <tbody>
                                        {outsideBeatAnalysis.byBeat.map((item) => (
                                            <tr key={item.beatId} className="border-t border-slate-100">
                                                <td className="p-3">{item.beatName}</td>
                                                <td className="p-3">{formatNumber(item.count)}</td>
                                            </tr>
                                        ))}
                                        {!outsideBeatAnalysis.byBeat.length && (
                                            <EmptyRow columns={2}>{beats.length > 1
                                                ? "No outside-Beat house could be verified in this period."
                                                : "Upload other Beat data to verify outside-Beat collections."}</EmptyRow>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {outsideBeatAnalysis.unmatchedScanCount > 0 && (
                                <p className="mt-2 text-xs text-slate-500">
                                    {formatNumber(outsideBeatAnalysis.unmatchedScanCount)} route collection(s) could not be matched to a unique house in another uploaded Beat and are not included.
                                </p>
                            )}
                        </section>

                        <section className="rounded-xl bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900">Collection Frequency for Every House</h2>
                                    <p className="mt-1 text-xs text-slate-600">
                                        {formatNumber(houseCoverage.collectedAtLeastOnce)} houses have collection history in the 30-day period. Intervals use distinct collection dates; employee names come from available scan records.
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
                                        <tr><th className="p-3">House ID</th><th className="p-3">Collected by</th><th className="p-3">Scans / collection days</th><th className="p-3">Me / other scans</th><th className="p-3">Collection frequency</th><th className="p-3">Last scanned</th><th className="p-3">Normal interval</th><th className="p-3">Days since scan</th><th className="p-3">Status</th></tr>
                                    </thead>
                                    <tbody>
                                        {currentHouses.map((detail) => {
                                            const {house} = detail;
                                            return (
                                            <tr key={house.houseId} className="border-t border-slate-100">
                                                <td className="p-3 font-medium text-slate-900">{house.houseId}</td>
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
                                                <td className="p-3">{formatTimestamp(detail.lastRecordedDate ? `${detail.lastRecordedDate}T00:00:00` : null)}</td>
                                                <td className="p-3">{formatDays(detail.typicalIntervalDays)}</td>
                                                <td className="p-3">{formatDays(detail.currentGapDays)}</td>
                                                <td className="p-3">{detail.status}</td>
                                            </tr>
                                            );
                                        })}
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
                        {(beat.historyWarnings.unmatchedCollectionRecords > 0 || beat.historyWarnings.ambiguousReferenceRecords > 0) && (
                            <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                {formatNumber(beat.historyWarnings.unmatchedCollectionRecords)} route collection record(s) did not match a house in this Beat and are not counted as outside-Beat collections unless another uploaded Beat has a matching reference.
                                {beat.historyWarnings.ambiguousReferenceRecords > 0 &&
                                    ` ${formatNumber(beat.historyWarnings.ambiguousReferenceRecords)} ambiguous reference record(s) were excluded from house history.`}
                            </p>
                        )}
                    </section>
                )}

                {activeTab === "overall" && (
                    <section role="tabpanel" className="flex flex-col gap-4">
                        <section className="rounded-xl bg-white p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-slate-900">Overall performance summary</h2>
                            <p className="mt-2 text-sm text-slate-700">
                                {formatNumber(ownCount)} of {formatNumber(beat.totalHouses)} assigned-Beat houses are attributed to the assigned employee in the report
                                {regularRate == null ? "." : `; ${formatNumber(regularRate, 1)}% of houses with scan history are currently within their recorded regular interval.`}
                                {" "}{formatNumber(totalDistanceKm, 2)} km of GPS route distance and {formatDuration(totalRecordedMinutes)} of recorded GPS span are available across {formatNumber(gpsRoutes.length)} GPS days.
                            </p>
                        </section>
                        <div className="grid gap-3 lg:grid-cols-2">
                            <section className="rounded-xl bg-white p-4 shadow-sm">
                                <h3 className="font-semibold text-slate-900">Main strengths</h3>
                                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
                                    <li>{formatNumber(ownCount)} houses are recorded as collected by the assigned employee.</li>
                                    <li>{formatNumber(attentionCounts.regular)} houses with history are within their normal interval.</li>
                                    <li>GPS tracks are available on {formatNumber(gpsRoutes.length)} of {formatNumber(routes.length)} dated route days.</li>
                                </ul>
                            </section>
                            <section className="rounded-xl bg-white p-4 shadow-sm">
                                <h3 className="font-semibold text-slate-900">Main issues to review</h3>
                                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
                                    <li>{formatNumber(suggestedHouses.length)} houses meet overdue, repeated-gap, low-frequency, or no-window-record criteria.</li>
                                    <li>{formatNumber(otherCount)} assigned-Beat houses are attributed to other employees; {formatNumber(remainingCount)} are remaining / unscanned.</li>
                                    <li>{formatNumber(houseCoverage.repeatedlyOtherEmployeeCollected)} houses have matched scans by other employees on multiple days.</li>
                                    <li>{formatNumber(gaps.longGaps.length)} collection gaps exceed the observed long-gap threshold; gaps do not establish idle time.</li>
                                </ul>
                            </section>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                            <section className="rounded-xl bg-white p-4 shadow-sm">
                                <h3 className="font-semibold text-slate-900">Distance and time patterns to review</h3>
                                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
                                    {highDistanceRoutes.map((route) => (
                                        <li key={`distance-${route.date}`}>{route.date}: {formatNumber(route.distanceKm, 2)} km actual vs {formatNumber(route.expectedDistanceKm, 2)} km workload-adjusted expected (+{formatNumber(route.extraDistanceKm, 2)} km, {formatNumber(route.extraDistancePercent, 1)}%). GPS endpoints: {formatRouteEndpoints(route)}.</li>
                                    ))}
                                    {highTimeRoutes.map((route) => (
                                        <li key={`time-${route.date}`}>{route.date}: {formatDuration(route.durationMinutes)} GPS span vs {formatDuration(route.normalTimeMinutes)} normal (+{formatDuration(route.extraTimeMinutes)}).</li>
                                    ))}
                                    {gpsStops.slice(0, 5).map((stop, index) => (
                                        <li key={`stop-${stop.date}-${stop.start}-${index}`}>{stop.date}: unusual GPS stay of {formatDuration(stop.durationMinutes)} near {stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}.</li>
                                    ))}
                                    {gaps.longGaps.slice(0, 5).map((gap, index) => (
                                        <li key={`gap-${gap.date}-${gap.start.datetime}-${index}`}>{gap.date}: {formatDuration(gap.minutes)} between recorded collections.</li>
                                    ))}
                                    {!highDistanceRoutes.length && !highTimeRoutes.length && !gaps.longGaps.length && (
                                        <li>No unusually high distance, time span, or long collection gap was identified in the available records.</li>
                                    )}
                                </ul>
                                <p className="mt-2 text-xs text-slate-500">Distance flags use matched-house workload and a median per-house GPS benchmark; time flags use the median GPS-day span. Long stationary GPS stretches are unusual activity only, not a conclusion about their cause.</p>
                            </section>
                            <section className="rounded-xl bg-white p-4 shadow-sm">
                                <h3 className="font-semibold text-slate-900">Suggested collection focus</h3>
                                {topSuggestions.length ? (
                                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
                                        {topSuggestions.map((suggestion) => (
                                            <li key={suggestion.house.houseId}>
                                                {suggestion.house.houseId} ({suggestion.priority}): {suggestion.reason}
                                                {suggestion.house.lat != null && ` · ${formatNumber(suggestion.house.lat, 5)}, ${formatNumber(suggestion.house.lon, 5)}`}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-sm text-slate-600">No overdue or repeated-gap house was identified from the recorded history.</p>
                                )}
                                {houseCoverage.otherEmployeeCollected > 0 && (
                                    <p className="mt-3 text-sm text-slate-700">
                                {formatNumber(houseCoverage.repeatedlyOtherEmployeeCollected)} house(s) matched collection records on multiple days in other uploaded employees&apos; routes. For unmatched route history, the report exposes only each house&apos;s latest scanner attribution, so repeated collection by other employees cannot be confirmed from that snapshot alone.
                                    </p>
                                )}
                                <p className="mt-3 text-xs text-slate-500">
                                    Use the listed overdue HouseIds and coordinates as candidate focus points for the next route. The provided records do not include a road-network route optimizer for these targets.
                                </p>
                            </section>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
