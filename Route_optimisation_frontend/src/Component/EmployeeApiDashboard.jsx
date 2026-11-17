import {useEffect, useMemo, useState} from "react";
import {
    analyzeHouseCoverage,
    analyzeOutsideBeatCollections,
    getReportWindowDays,
    getHighPriorityAttentionHouses,
    getNextCollectionPriorities,
    getCoverageTrend,
    summarizeCollectionPatterns,
    summarizeDailyEmployeeReport,
} from "../data/employeePerformance.js";
import {API_URL} from "../config.js";
import EmployeeAiReview from "./EmployeeAiReview.jsx";

function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {maximumFractionDigits: digits});
}

function roundedPercent(value) {
    return value == null ? null : Number(value.toFixed(1));
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

function formatMonth(value) {
    return new Date(`${value}-01T00:00:00Z`).toLocaleDateString(undefined, {
        month: "long",
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

export default function EmployeeApiDashboard({
    beatData,
    onShowHighPriorityHouses,
    dateSelection = "live",
    availableDates = [],
    onDateSelectionChange,
}) {
    const beats = beatData?.beats || [];
    const [selectedBeatId, setSelectedBeatId] = useState("");
    const [priorityPage, setPriorityPage] = useState(0);
    const [anomalyResult, setAnomalyResult] = useState(null);
    const [anomalyLoading, setAnomalyLoading] = useState(false);
    const [anomalyError, setAnomalyError] = useState("");

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
    const dateOptions = useMemo(
        () => [...new Set([...availableDates, ...analysisDateOptions])].sort(),
        [analysisDateOptions, availableDates],
    );
    const routes = useMemo(() => (beat?.routes || []).filter((route) =>
        (!beat?.fromDate || route.date >= beat.fromDate) &&
        (!beat?.toDate || route.date <= beat.toDate)
    ), [beat]);
    const effectiveEndDate = dateSelection === "live"
        ? analysisDateOptions.at(-1) || beat?.toDate || null
        : dateSelection || analysisDateOptions.at(-1) || beat?.toDate || null;
    const rollingStartDate = addDays(effectiveEndDate, -29);
    const dataStartDate = beat?.fromDate || analysisDateOptions[0] || effectiveEndDate;
    const effectiveStartDate = rollingStartDate && dataStartDate > rollingStartDate
        ? dataStartDate
        : rollingStartDate || dataStartDate;
    const historicalDataStartDate = useMemo(() => {
        if (!beat) return effectiveEndDate;
        const dates = [
            beat.fromDate,
            ...(beat.routes || []).map((route) => route.date),
            ...(beat.houses || []).flatMap((house) => [
                ...(house.history?.collectionDates || []),
                house.scanningDate?.slice(0, 10),
            ]),
        ].filter(Boolean).sort();
        return dates[0] || effectiveEndDate;
    }, [beat, effectiveEndDate]);
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
    const selectedDateCoverage = useMemo(
        () => beat && effectiveEndDate
            ? analyzeHouseCoverage(
                beat.houses,
                [],
                effectiveEndDate,
                effectiveEndDate,
                beat.assignedEmployee,
            )
            : null,
        [beat, effectiveEndDate],
    );
    const previousWindowEndDate = addDays(effectiveStartDate, -1);
    const previousWindowStartDate = reportWindowDays == null || !previousWindowEndDate
        ? null
        : addDays(previousWindowEndDate, -(reportWindowDays - 1));
    const previousWindowIsAvailable = Boolean(previousWindowStartDate &&
        previousWindowEndDate &&
        previousWindowStartDate >= historicalDataStartDate &&
        (!beat?.toDate || previousWindowEndDate <= beat.toDate));
    const previousHouseCoverage = useMemo(() => {
        if (!previousWindowIsAvailable || !beat) return null;
        const previousRoutes = (beat.routes || []).filter((route) =>
            route.date >= previousWindowStartDate && route.date <= previousWindowEndDate
        );
        return analyzeHouseCoverage(
            beat.houses,
            previousRoutes,
            previousWindowStartDate,
            previousWindowEndDate,
            beat.assignedEmployee,
            otherBeats,
        );
    }, [
        beat,
        otherBeats,
        previousWindowEndDate,
        previousWindowIsAvailable,
        previousWindowStartDate,
    ]);
    const coverageTrend = useMemo(
        () => getCoverageTrend(previousHouseCoverage, houseCoverage, beat?.houses.length || 0),
        [beat, houseCoverage, previousHouseCoverage],
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
    const historicalRoutes = useMemo(
        () => (beat?.routes || []).filter((route) =>
            !effectiveEndDate || route.date <= effectiveEndDate
        ),
        [beat, effectiveEndDate],
    );
    const historicalHouseCoverage = useMemo(
        () => analyzeHouseCoverage(
            beat?.houses || [],
            historicalRoutes,
            null,
            effectiveEndDate,
            beat?.assignedEmployee,
            otherBeats,
        ),
        [beat, effectiveEndDate, historicalRoutes, otherBeats],
    );
    const dailyEmployeeReport = useMemo(
        () => summarizeDailyEmployeeReport(historicalHouseCoverage, historicalRoutes, effectiveEndDate),
        [effectiveEndDate, historicalHouseCoverage, historicalRoutes],
    );
    const historicalOutsideBeatAnalysis = useMemo(
        () => analyzeOutsideBeatCollections(
            historicalRoutes,
            otherBeats,
            beat?.assignedEmployee?.id,
            null,
            effectiveEndDate,
        ),
        [beat, effectiveEndDate, historicalRoutes, otherBeats],
    );
    const anomalyPayload = useMemo(() => {
        if (!beat || !effectiveEndDate) return null;
        const outsideHouseIdsByDate = new Map(
            historicalOutsideBeatAnalysis.byDate.map(({date, houseIds}) => [date, houseIds]),
        );
        const routesByDate = new Map();
        const assignedEmployeeId = String(beat.assignedEmployee?.id || "");
        historicalRoutes.forEach((route) => {
            const routeData = routesByDate.get(route.date) || {
                hasRouteData: false,
                hasRouteCollectionData: false,
            };
            routeData.hasRouteData = true;
            routeData.hasRouteCollectionData = routeData.hasRouteCollectionData ||
                Boolean(assignedEmployeeId && route.collectionScans.some((scan) =>
                    String(scan.scannerUserId || assignedEmployeeId) === assignedEmployeeId
                ));
            routesByDate.set(route.date, routeData);
        });
        const activityDates = new Set(routesByDate.keys());
        historicalHouseCoverage.details.forEach((detail) => {
            detail.assignedCollectionDates.forEach((date) => activityDates.add(date));
            detail.otherEmployeeCollectionDates.forEach((date) => activityDates.add(date));
        });

        return {
            selected_date: effectiveEndDate,
            total_houses: beat.houses.length,
            daily_activity: [...activityDates].sort().map((date) => {
                const assignedDetails = historicalHouseCoverage.details.filter((detail) =>
                    detail.assignedCollectionDates.includes(date)
                );
                const otherHouseIds = historicalHouseCoverage.details
                    .filter((detail) => detail.otherEmployeeCollectionDates.includes(date))
                    .map((detail) => detail.house.houseId);
                const routeData = routesByDate.get(date);
                return {
                    date,
                    assigned_house_ids: assignedDetails.map((detail) => detail.house.houseId),
                    other_house_ids: otherHouseIds,
                    outside_beat_house_ids: outsideHouseIdsByDate.get(date) || [],
                    assigned_house_coordinates: assignedDetails
                        .filter((detail) =>
                            Number.isFinite(detail.house.lat) &&
                            Number.isFinite(detail.house.lon)
                        )
                        .map((detail) => ({
                            lat: detail.house.lat,
                            lon: detail.house.lon,
                        })),
                    has_activity_data: Boolean(
                        routeData?.hasRouteData || assignedDetails.length || otherHouseIds.length
                    ),
                    has_route_collection_data: Boolean(routeData?.hasRouteCollectionData),
                };
            }),
            house_patterns: historicalHouseCoverage.details.map((detail) => ({
                house_id: detail.house.houseId,
                collection_days: detail.collectionDays,
                typical_interval_days: detail.typicalIntervalDays,
                current_gap_days: detail.currentGapDays,
                repeated_long_gaps: detail.repeatedLongGaps,
                status: detail.status,
            })),
        };
    }, [
        beat,
        effectiveEndDate,
        historicalHouseCoverage,
        historicalOutsideBeatAnalysis.byDate,
        historicalRoutes,
    ]);

    useEffect(() => {
        if (!anomalyPayload) {
            setAnomalyResult(null);
            setAnomalyError("");
            setAnomalyLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        setAnomalyResult(null);
        setAnomalyError("");
        setAnomalyLoading(true);
        const loadAnomalies = async () => {
            try {
                const response = await fetch(`${API_URL}/analytics/employee-anomalies`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(anomalyPayload),
                    signal: controller.signal,
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || "The anomaly analysis request failed.");
                }
                if (result.status !== "success") {
                    throw new Error("The anomaly analysis returned an invalid response.");
                }
                setAnomalyResult(result);
            } catch (error) {
                if (error.name !== "AbortError") {
                    setAnomalyError(error.message || "Anomaly analysis is unavailable.");
                }
            } finally {
                if (!controller.signal.aborted) setAnomalyLoading(false);
            }
        };
        loadAnomalies();
        return () => controller.abort();
    }, [anomalyPayload]);
    const nextCollectionPriorities = useMemo(
        () => getNextCollectionPriorities(
            historicalHouseCoverage,
            effectiveEndDate,
        ),
        [effectiveEndDate, historicalHouseCoverage],
    );
    const highPriorityHouses = useMemo(
        () => getHighPriorityAttentionHouses(nextCollectionPriorities),
        [nextCollectionPriorities],
    );
    const noScanHistoryCount = nextCollectionPriorities.filter((item) =>
        !item.detail.collectionDates.length
    ).length;
    const dueHouseCount = nextCollectionPriorities.length - noScanHistoryCount;
    const priorityPageSize = 50;
    const priorityPageCount = Math.max(1, Math.ceil(nextCollectionPriorities.length / priorityPageSize));
    const currentPriorityPage = Math.min(priorityPage, priorityPageCount - 1);
    const currentPriorityHouses = nextCollectionPriorities.slice(
        currentPriorityPage * priorityPageSize,
        (currentPriorityPage + 1) * priorityPageSize,
    );
    const collectionPatterns = useMemo(
        () => summarizeCollectionPatterns(historicalHouseCoverage),
        [historicalHouseCoverage],
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
        const counts = {regular: 0, lowFrequency: 0, needsAttention: 0, overdue: 0, withHistory: 0};
        historicalHouseCoverage.details.forEach((detail) => {
            if (detail.collectionDays) counts.withHistory += 1;
            if (detail.status === "Regular") counts.regular += 1;
            else if (detail.status === "Low Frequency") counts.lowFrequency += 1;
            else if (detail.status === "Needs Attention") counts.needsAttention += 1;
            else if (detail.status === "Overdue") counts.overdue += 1;
        });
        return counts;
    }, [historicalHouseCoverage]);

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

    useEffect(() => setPriorityPage(0), [selectedBeatId, effectiveEndDate]);

    const ownCount = houseCoverage.assignedEmployeeCollected;
    const otherCount = houseCoverage.otherEmployeeCollected;
    const remainingCount = houseCoverage.remainingWithoutHistory;
    const totalHouses = beat?.houses.length || 0;
    const reportTotalHouses = beat?.reportedTotalHouses ?? totalHouses;
    const reportScannedHouses = beat?.totalScannedHouses ??
        houseCoverage.assignedEmployeeCollected + houseCoverage.otherEmployeeCollected;
    const reportNotScannedHouses = beat?.totalNotScannedHouses ??
        houseCoverage.remainingWithoutHistory;
    const dailyHouseCountChange = dailyEmployeeReport?.houseCountChange ?? 0;
    const beatCoveragePercent = totalHouses
        ? (ownCount + otherCount) * 100 / totalHouses
        : null;
    const ownCoveragePercent = totalHouses ? ownCount * 100 / totalHouses : null;
    const regularRate = attentionCounts.withHistory
        ? attentionCounts.regular * 100 / attentionCounts.withHistory
        : null;
    const aiReviewSummary = useMemo(() => {
        if (!beat) return null;
        return {
            employeeName: beat.assignedEmployee.name,
            beatName: beat.beatName,
            reportingPeriod: {
                from: effectiveStartDate,
                through: effectiveEndDate,
                days: reportWindowDays,
            },
            coverage: {
                totalHousesInBeat: totalHouses,
                housesCollectedByAssignedEmployee: ownCount,
                housesCollectedByOtherEmployees: otherCount,
                housesWithAnyCollection: houseCoverage.collectedAtLeastOnce,
                housesNotCollected: remainingCount,
                coveragePercent: roundedPercent(beatCoveragePercent),
                coverageDefinition: "Beat coverage percentage uses housesWithAnyCollection divided by totalHousesInBeat; housesWithAnyCollection includes both assigned-employee and other-employee collections.",
            },
            collectionRegularity: {
                regularlyCollectedHouses: attentionCounts.regular,
                lowFrequencyHouses: attentionCounts.lowFrequency,
                housesWithLongCollectionGaps: attentionCounts.needsAttention,
                overdueHouses: attentionCounts.overdue,
                housesRequiringAttention: nextCollectionPriorities.length,
                highPriorityHouses: highPriorityHouses.length,
                housesNotCollected: remainingCount,
                housesWithCollectionHistory: attentionCounts.withHistory,
                withinObservedPatternPercent: roundedPercent(regularRate),
                withinObservedPatternPercentDefinition: "Percentage of housesWithCollectionHistory whose status is Regular through the selected analysis date; this does not describe all Beat houses.",
            },
            outsideBeatCollection: {
                distinctHousesCollected: beats.length > 1 ? outsideBeatAnalysis.totalHouses : null,
            },
        };
    }, [
        attentionCounts,
        beat,
        beatCoveragePercent,
        beats.length,
        effectiveEndDate,
        effectiveStartDate,
        houseCoverage.collectedAtLeastOnce,
        nextCollectionPriorities.length,
        highPriorityHouses.length,
        otherCount,
        outsideBeatAnalysis.totalHouses,
        ownCount,
        regularRate,
        remainingCount,
        reportWindowDays,
        totalHouses,
    ]);

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
                                    value={dateSelection}
                                    onChange={(event) => onDateSelectionChange?.(event.target.value)}
                                    disabled={!dateOptions.length}
                                    className="rounded border border-slate-300 bg-white p-2 disabled:bg-slate-100"
                                >
                                    <option value="live">
                                        Live date{analysisDateOptions.at(-1) ? ` (${analysisDateOptions.at(-1)})` : ""}
                                    </option>
                                    {dateOptions.map((date) => (
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
                                In the selected {reportWindowLabel}, {formatNumber(totalHouses)} houses in My Beat: {formatNumber(ownCount)} collected by Me,{" "}
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
                                High-priority houses have no scan recorded in BeatWiseReport history or a gap over 2.5 times their usual interval.
                            </span>
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <Card label="Total Houses in My Beat" value={formatNumber(totalHouses)} />
                        <Card label="Collected by Me" value={formatNumber(ownCount)} tone="text-green-700"
                            detail={`${ownCoveragePercent == null ? "Unavailable" : `${formatNumber(ownCoveragePercent, 1)}%`} in the selected reporting window; scanner must match the assigned employee.`} />
                        <Card label="Collected by Other Employees" value={formatNumber(otherCount)} tone="text-amber-700"
                            detail="In the selected reporting window; these houses still belong to My Beat." />
                        <Card label="Not Collected" value={formatNumber(remainingCount)} tone="text-red-700"
                            detail="No identified employee scan in the selected reporting window." />
                        <Card label="Overall Beat Coverage" value={beatCoveragePercent == null ? "Unavailable" : `${formatNumber(beatCoveragePercent, 1)}%`}
                            detail="Houses collected by Me or Others in the selected reporting window ÷ total houses." />
                    </div>
                    <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
                        <span className="font-semibold">Full report period ({formatDate(beat.fromDate)} to {formatDate(beat.toDate)}):</span>{" "}
                        {formatNumber(reportTotalHouses)} total houses · {formatNumber(reportScannedHouses)} scanned ·{" "}
                        {formatNumber(reportNotScannedHouses)} not scanned.
                    </p>
                    {selectedDateCoverage && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                            <h3 className="font-semibold text-slate-900">
                                Selected date collection status · {formatDate(effectiveEndDate)}
                            </h3>
                            <p className="mt-1 text-sm text-slate-600">
                                Counts each HouseId once using its ScanningDates entry for this date.
                            </p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                <Card label="Total Houses" value={formatNumber(totalHouses)} />
                                <Card label="Collected by Me" value={formatNumber(selectedDateCoverage.assignedEmployeeCollected)} tone="text-green-700" />
                                <Card label="Collected by Other Employees" value={formatNumber(selectedDateCoverage.otherEmployeeCollected)} tone="text-amber-700" />
                                <Card label="Not Scanned on Selected Date" value={formatNumber(selectedDateCoverage.remainingWithoutHistory)} tone="text-red-700" />
                                <Card
                                    label="Selected Date Coverage"
                                    value={totalHouses
                                        ? `${formatNumber(selectedDateCoverage.collectedAtLeastOnce * 100 / totalHouses, 1)}%`
                                        : "Unavailable"}
                                    detail="Unique houses scanned on this date ÷ total houses."
                                />
                            </div>
                        </div>
                    )}
                    <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
                        <span className="font-semibold">Historical house patterns through {formatDate(effectiveEndDate)}:</span>{" "}
                        {formatNumber(attentionCounts.regular)} regular · {formatNumber(attentionCounts.lowFrequency)} low frequency ·{" "}
                        {formatNumber(attentionCounts.overdue)} overdue · {formatNumber(attentionCounts.needsAttention)} with recurring long gaps ·{" "}
                        {formatNumber(nextCollectionPriorities.length)} requiring attention ({formatNumber(highPriorityHouses.length)} high priority) ·{" "}
                        {formatNumber(collectionPatterns.noRecordedCollection)} with no scan recorded in the available BeatWiseReport history.
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
                        <h2 className="text-lg font-semibold text-slate-900">
                            House Attention Queue
                        </h2>
                        <p className="mt-1 text-xs text-slate-600">
                            “No scan recorded” means no ScanningDates entry appears in available BeatWiseReport history; it does not claim the house was never cleaned. Due means the gap exceeds 1.5 times its usual interval. High priority means no scan is recorded or the gap exceeds 2.5 times its usual interval.
                        </p>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
                            <span className="font-semibold text-slate-900">No scan recorded: </span>{formatNumber(noScanHistoryCount)} houses
                        </p>
                        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                            <span className="font-semibold">Due: </span>{formatNumber(dueHouseCount)} houses with scan history
                        </p>
                        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
                            <span className="font-semibold">High priority: </span>{formatNumber(highPriorityHouses.length)} houses (includes no-scan and overdue houses)
                        </p>
                    </div>
                    <div className="mt-3 max-h-[34rem] overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[1050px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr>
                                    <th className="p-3">House ID</th>
                                    <th className="p-3">Last scanned date</th>
                                    <th className="p-3">Days since last scan</th>
                                    <th className="p-3">Collection frequency</th>
                                    <th className="p-3">Priority</th>
                                    <th className="p-3">Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentPriorityHouses.map((item) => (
                                    <tr key={item.detail.house.houseId} className="border-t border-slate-100">
                                        <td className="p-3 font-medium text-slate-900">{item.detail.house.houseId}</td>
                                        <td className="p-3">{item.lastScannedDate
                                            ? formatDate(item.lastScannedDate)
                                            : !item.detail.collectionDates.length ? "No scan recorded" : "No scan by selected date"}
                                        </td>
                                        <td className="p-3">{item.daysSinceScan == null
                                            ? !item.detail.collectionDates.length ? "No scan recorded" : "—"
                                            : formatDays(item.daysSinceScan)}
                                        </td>
                                        <td className="p-3">{item.frequency}</td>
                                        <td className="p-3 font-medium">{item.priorityLabel}</td>
                                        <td className="p-3">{item.reason}</td>
                                    </tr>
                                ))}
                                {!nextCollectionPriorities.length && (
                                    <EmptyRow columns={6}>No houses currently meet the historical attention criteria.</EmptyRow>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {nextCollectionPriorities.length > priorityPageSize && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                            <span>
                                Showing {formatNumber(currentPriorityPage * priorityPageSize + 1)}–
                                {formatNumber(Math.min((currentPriorityPage + 1) * priorityPageSize, nextCollectionPriorities.length))} of {formatNumber(nextCollectionPriorities.length)}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    disabled={currentPriorityPage === 0}
                                    onClick={() => setPriorityPage(currentPriorityPage - 1)}
                                    className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
                                >
                                    Previous
                                </button>
                                <span className="px-2 py-1">Page {currentPriorityPage + 1} of {priorityPageCount}</span>
                                <button
                                    type="button"
                                    disabled={currentPriorityPage >= priorityPageCount - 1}
                                    onClick={() => setPriorityPage(currentPriorityPage + 1)}
                                    className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
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
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">
                            Daily Attendance &amp; Collection
                        </h2>
                        <p className="mt-1 text-xs text-slate-600">
                            Compares {formatDate(effectiveEndDate)} with the immediately previous day. Attendance follows your rule: no GPS points means Absent.
                        </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <Card
                            label={`Attendance · ${formatDate(effectiveEndDate)}`}
                            value={dailyEmployeeReport?.selectedDateAttendance || "Unavailable"}
                            tone={dailyEmployeeReport?.selectedDateAttendance === "Present" ? "text-green-700" : "text-red-700"}
                            detail={dailyEmployeeReport?.selectedDateAttendance === "Absent"
                                ? `Absent by GPS rule · ${formatNumber(dailyEmployeeReport?.selectedDateGpsPointCount || 0)} GPS points recorded.`
                                : `${formatNumber(dailyEmployeeReport?.selectedDateGpsPointCount || 0)} GPS points recorded.`}
                        />
                        <Card
                            label={`Yesterday · ${formatDate(dailyEmployeeReport?.previousDate)}`}
                            value={dailyEmployeeReport?.previousDateAttendance || "Unavailable"}
                            tone={dailyEmployeeReport?.previousDateAttendance === "Present" ? "text-green-700" : "text-red-700"}
                            detail={`${formatNumber(dailyEmployeeReport?.previousDateGpsPointCount || 0)} GPS points recorded; no GPS means Absent.`}
                        />
                        <Card
                            label="Houses collected · selected day"
                            value={`${formatNumber(dailyEmployeeReport?.selectedDateHouseCount || 0)} houses`}
                            detail="Unique HouseIds scanned by the assigned employee."
                        />
                        <Card
                            label="Houses collected · yesterday"
                            value={`${formatNumber(dailyEmployeeReport?.previousDateHouseCount || 0)} houses`}
                            detail="Unique HouseIds scanned on the previous calendar day."
                        />
                        <Card
                            label="Change vs yesterday"
                            value={`${dailyHouseCountChange > 0 ? "+" : ""}${formatNumber(dailyHouseCountChange)} houses`}
                            tone={dailyHouseCountChange > 0 ? "text-green-700" : dailyHouseCountChange < 0 ? "text-amber-700" : "text-slate-900"}
                            detail="Difference in unique assigned-employee house scans."
                        />
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
                <EmployeeAiReview summary={aiReviewSummary} />

                <section aria-labelledby="coverage-trend-heading" className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 id="coverage-trend-heading" className="text-lg font-semibold text-slate-900">Coverage Trend</h2>
                        <p className="mt-1 text-xs text-slate-600">
                            Compares equal-length adjacent reporting windows using the existing verified Beat coverage calculation. Change is shown in percentage points.
                        </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Card
                            label="Previous coverage"
                            value={coverageTrend.previousPercent == null
                                ? "Unavailable"
                                : `${formatNumber(coverageTrend.previousPercent, 1)}%`}
                            detail={!previousWindowIsAvailable
                                ? "Previous-period comparison unavailable for this reporting range."
                                : previousWindowStartDate && previousWindowEndDate
                                ? `${formatDate(previousWindowStartDate)} to ${formatDate(previousWindowEndDate)}`
                                : "Previous-period comparison unavailable for this reporting range."}
                        />
                        <Card
                            label="Current coverage"
                            value={coverageTrend.currentPercent == null
                                ? "Unavailable"
                                : `${formatNumber(coverageTrend.currentPercent, 1)}%`}
                            detail={`${formatDate(effectiveStartDate)} to ${formatDate(effectiveEndDate)}`}
                        />
                        <Card
                            label="Change"
                            value={coverageTrend.changePercentagePoints == null
                                ? "Unavailable"
                                : `${coverageTrend.changePercentagePoints > 0 ? "+" : ""}${formatNumber(coverageTrend.changePercentagePoints, 1)} pp`}
                            detail={!previousWindowIsAvailable
                                ? "Previous-period comparison unavailable for this reporting range."
                                : "Percentage-point change between equal-length windows"}
                        />
                        <Card
                            label="Trend"
                            value={coverageTrend.trend === "Insufficient data"
                                ? "Unavailable"
                                : coverageTrend.trend}
                            detail={!previousWindowIsAvailable
                                ? "Previous-period comparison unavailable for this reporting range."
                                : coverageTrend.trend === "Insufficient data"
                                    ? "Coverage data is unavailable for this comparison."
                                    : "Based only on recorded collection coverage."}
                            tone={coverageTrend.trend === "Improving"
                                ? "text-green-700"
                                : coverageTrend.trend === "Declining"
                                    ? "text-red-700"
                                    : "text-slate-900"}
                        />
                    </div>
                </section>

                <section aria-labelledby="collection-pattern-heading" className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 id="collection-pattern-heading" className="text-lg font-semibold text-slate-900">Collection Pattern</h2>
                        <p className="mt-1 text-xs text-slate-600">
                            A concise summary of complete available ScanningDates history through the selected date; recorded gaps are not proof that a house was deliberately skipped.
                        </p>
                    </div>
                    <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Repeated collections: </span>
                            {formatNumber(collectionPatterns.repeatedlyCollected)} houses have recorded scans on multiple distinct days.
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Lower collection frequency: </span>
                            {historicalHouseCoverage.typicalScanCount == null
                                ? "Insufficient data to establish a Beat frequency baseline."
                                : `${formatNumber(collectionPatterns.lowFrequency)} houses are below the existing Beat frequency baseline of ${formatNumber(historicalHouseCoverage.typicalScanCount, 1)} scans per house.`}
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Recurring long gaps: </span>
                            {collectionPatterns.recordedHouseDays
                                ? `${formatNumber(collectionPatterns.recurringLongGaps)} houses have at least two recorded gaps exceeding 1.5 times their own typical interval.`
                                : "Insufficient data to assess recurring collection gaps."}
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">No scan recorded in available report history: </span>
                            {formatNumber(collectionPatterns.noRecordedCollection)} houses have no recorded collection dates. This does not establish that a house was never cleaned.
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 sm:col-span-2">
                            <span className="font-semibold text-slate-900">Period concentration: </span>
                            {collectionPatterns.busiestMonth
                                ? `Activity was highest in ${formatMonth(collectionPatterns.busiestMonth.month)} (${formatNumber(collectionPatterns.busiestMonth.houseDays)} recorded house-days).`
                                : "Not enough historical periods available."}
                        </li>
                    </ul>
                </section>

                <section aria-labelledby="anomaly-detection-heading" className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 id="anomaly-detection-heading" className="text-lg font-semibold text-slate-900">
                            Anomaly Detection
                        </h2>
                        <p className="mt-1 text-xs text-slate-600">
                            Deterministic comparisons of recorded activity with recent and house-specific historical patterns. An anomaly signals a pattern for attention; it does not imply misconduct.
                        </p>
                    </div>
                    {anomalyLoading && (
                        <p role="status" className="mt-3 text-sm text-slate-600">
                            Comparing recorded activity with historical patterns…
                        </p>
                    )}
                    {anomalyError && (
                        <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                            Anomaly analysis is unavailable: {anomalyError}
                        </p>
                    )}
                    {anomalyResult && (
                        <>
                            {anomalyResult.anomalies.length === 0 && anomalyResult.insufficient_data.length === 0 && (
                                <p className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">
                                    No significant anomalies detected.
                                </p>
                            )}
                            {anomalyResult.insufficient_data.length > 0 && (
                                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                    <p className="font-medium">Insufficient data for these checks:</p>
                                    <ul className="mt-1 list-inside list-disc">
                                        {anomalyResult.insufficient_data.map((reason) => <li key={reason}>{reason}</li>)}
                                    </ul>
                                </div>
                            )}
                            {anomalyResult.anomalies.length > 0 && (
                                <div className="mt-3 overflow-auto rounded border border-slate-200">
                                    <table className="w-full min-w-[900px] text-left text-sm">
                                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                                            <tr>
                                                <th className="p-3">Anomaly type</th>
                                                <th className="p-3">Current pattern/value</th>
                                                <th className="p-3">Normal/historical pattern</th>
                                                <th className="p-3">Severity</th>
                                                <th className="p-3">Reason</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {anomalyResult.anomalies.map((anomaly) => (
                                                <tr key={anomaly.type} className="border-t border-slate-100 align-top">
                                                    <td className="p-3 font-medium text-slate-900">{anomaly.type}</td>
                                                    <td className="p-3 text-slate-700">{anomaly.current_pattern}</td>
                                                    <td className="p-3 text-slate-700">{anomaly.normal_pattern}</td>
                                                    <td className="p-3">
                                                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                                                            anomaly.severity === "High"
                                                                ? "bg-red-100 text-red-800"
                                                                : anomaly.severity === "Medium"
                                                                    ? "bg-amber-100 text-amber-800"
                                                                    : "bg-blue-100 text-blue-800"
                                                        }`}>
                                                            {anomaly.severity}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-slate-700">{anomaly.reason}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
