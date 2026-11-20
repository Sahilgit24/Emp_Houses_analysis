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
import AnalysisHouseMapDialog from "./AnalysisHouseMapDialog.jsx";
import StateUlbFilters from "./StateUlbFilters.jsx";
import {beatHasHouseRecords} from "../data/beatApiData.js";

function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {maximumFractionDigits: digits});
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

function Card({label, value, detail, tone = "text-slate-900", onClick}) {
    const content = (
        <>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
            {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-green-300 hover:bg-green-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
            >
                {content}
            </button>
        );
    }

    return (
        <article className="rounded-lg border border-slate-200 bg-white p-4">
            {content}
        </article>
    );
}

function sortHouseDetails(details, category, assignedEmployeeId = "", scannerId = "") {
    const firstTimestamp = (detail) => {
        const candidates = [];
        if (category !== "other") {
            (detail.assignedCollectionDates || []).forEach((date) => {
                candidates.push(Date.parse(`${date}T00:00:00Z`));
            });
        }
        (detail.otherEmployeeCollectionRecords || []).forEach((record) => {
            if (!scannerId || String(record.scannerId || record.scannerName || "") === String(scannerId)) {
                candidates.push(record.timestamp);
            }
        });
        (detail.house.historyEvents || []).forEach((event) => {
            if (category === "own" && String(event.scannerUserId || "") !== String(assignedEmployeeId)) return;
            if (scannerId && String(event.scannerUserId || event.scannerName || "") !== String(scannerId)) return;
            candidates.push(Date.parse(event.timestamp || `${event.date}T00:00:00Z`));
        });
        const valid = candidates.filter(Number.isFinite);
        return valid.length ? Math.min(...valid) : Number.POSITIVE_INFINITY;
    };

    return [...details].sort((a, b) =>
        firstTimestamp(a) - firstTimestamp(b) ||
        a.house.houseId.localeCompare(b.house.houseId)
    );
}

function toHouseMapRows(details, statusLabel, markerStatus) {
    return details.map((detail) => ({
        house: detail.house,
        statusLabel: statusLabel || ({
            own: "Collected by assigned employee",
            other: "Collected by another employee",
            remaining: "Not collected in this period",
        }[detail.collectionCategory] || detail.status || "House in this Beat"),
        lastScannedDate: detail.lastRecordedDate || null,
        scannerName: detail.latestScannerName || null,
        beatName: detail.latestScannerBeatName || null,
        detailText: detail.attentionReason || null,
        currentGapDays: detail.currentGapDays,
        typicalIntervalDays: detail.typicalIntervalDays,
        markerStatus: markerStatus || ({
            own: "own",
            other: "other",
            remaining: "remaining",
        }[detail.collectionCategory] || "own"),
    }));
}

function EmptyRow({columns, children}) {
    return <tr><td colSpan={columns} className="p-6 text-center text-slate-500">{children}</td></tr>;
}

function EmployeeAnalysisFilters({
    ulbs,
    selectedUlbId,
    onSelectedUlbIdChange,
    employeeOptions,
    selectedEmployeeId,
    onSelectedEmployeeIdChange,
    dateSelection,
    dateOptions,
    onDateSelectionChange,
}) {
    return (
        <div className="flex flex-wrap items-end gap-3">
            <StateUlbFilters
                ulbs={ulbs}
                selectedUlbId={selectedUlbId}
                onSelectedUlbIdChange={onSelectedUlbIdChange}
            />
            <label className="grid gap-1 text-sm font-medium text-slate-700">
                Employee
                <select
                    value={selectedEmployeeId}
                    onChange={(event) => onSelectedEmployeeIdChange(event.target.value)}
                    disabled={!employeeOptions.length}
                    className="min-w-52 rounded border border-slate-300 bg-white p-2 disabled:bg-slate-100"
                >
                    <option value="">{employeeOptions.length ? "Select an employee" : "Upload employee list"}</option>
                    {employeeOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                            {employee.name}{employee.isInactive ? " (Inactive)" : ""} · {employee.id}
                        </option>
                    ))}
                </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
                Analyze through
                <select
                    value={dateSelection}
                    onChange={(event) => onDateSelectionChange?.(event.target.value)}
                    disabled={!dateOptions.length}
                    className="rounded border border-slate-300 bg-white p-2 disabled:bg-slate-100"
                >
                    <option value="live">
                        Live date{dateOptions.at(-1) ? ` (${dateOptions.at(-1)})` : ""}
                    </option>
                    {dateOptions.map((date) => (
                        <option key={date} value={date}>{formatDate(date)}</option>
                    ))}
                </select>
            </label>
        </div>
    );
}

export default function EmployeeApiDashboard({
    beatData,
    employeeList,
    ulbs,
    selectedUlbId,
    onSelectedUlbIdChange,
    onShowHighPriorityHouses,
    dateSelection = "live",
    availableDates = [],
    onDateSelectionChange,
}) {
    const beats = beatData?.beats || [];
    const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
    const [anomalyResult, setAnomalyResult] = useState(null);
    const [anomalyLoading, setAnomalyLoading] = useState(false);
    const [anomalyError, setAnomalyError] = useState("");
    const [houseMapDialog, setHouseMapDialog] = useState(null);

    const employeeOptions = useMemo(() => {
        const source = employeeList?.employees || beats.map((item) => ({
            id: String(item.assignedEmployee.id),
            name: item.assignedEmployee.name,
        }));
        const hasHouseRecordsByEmployee = new Map();
        beats.forEach((item) => {
            const id = String(item.assignedEmployee?.id || item.beatUserId || "");
            if (!id) return;
            hasHouseRecordsByEmployee.set(
                id,
                (hasHouseRecordsByEmployee.get(id) || false) || beatHasHouseRecords(item),
            );
        });
        const uniqueEmployees = [...new Map(source.map((employee) => [String(employee.id), {
            id: String(employee.id),
            name: employee.name,
        }])).values()].sort((a, b) => a.name.localeCompare(b.name));
        return uniqueEmployees.map((employee) => ({
            ...employee,
            isInactive: hasHouseRecordsByEmployee.has(employee.id) &&
                !hasHouseRecordsByEmployee.get(employee.id),
        }));
    }, [beats, employeeList]);
    useEffect(() => {
        if (selectedEmployeeId && !employeeOptions.some((employee) => employee.id === selectedEmployeeId)) {
            setSelectedEmployeeId("");
        }
    }, [employeeOptions, selectedEmployeeId]);

    const beat = beats.find((item) =>
        String(item.assignedEmployee.id) === selectedEmployeeId
    ) || null;
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
    const noScanHistoryHouses = useMemo(
        () => historicalHouseCoverage.details
            .filter((detail) => !detail.collectionDates.length)
            .sort((a, b) => a.house.houseId.localeCompare(b.house.houseId)),
        [historicalHouseCoverage],
    );
    const housesOverdueUpToWeek = useMemo(
        () => historicalHouseCoverage.details
            .filter((detail) =>
                detail.status === "Overdue" &&
                detail.currentGapDays != null &&
                detail.typicalIntervalDays != null &&
                detail.currentGapDays - detail.typicalIntervalDays * 1.5 <= 7
            )
            .sort((a, b) =>
                ((a.currentGapDays ?? 0) - (a.typicalIntervalDays ?? 0) * 1.5) -
                    ((b.currentGapDays ?? 0) - (b.typicalIntervalDays ?? 0) * 1.5) ||
                a.house.houseId.localeCompare(b.house.houseId)
            ),
        [historicalHouseCoverage],
    );
    const noScanHistoryCount = noScanHistoryHouses.length;
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
                    houses: new Map(),
                };
                group.houses.set(detail.house.houseId, detail);
                employees.set(employeeKey, group);
            });
        });
        return [...employees.values()]
            .map((group) => ({
                ...group,
                houses: sortHouseDetails([...group.houses.values()], "other", "", group.employeeKey),
            }))
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }, [houseCoverage]);
    const otherEmployeeHouseDetails = useMemo(
        () => sortHouseDetails(
            [...new Map(otherEmployeeGroups.flatMap((group) =>
                group.houses.map((detail) => [detail.house.houseId, detail])
            )).values()],
            "other", beat?.assignedEmployee?.id,
        ),
        [beat?.assignedEmployee?.id, otherEmployeeGroups],
    );

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
    const openHouseMap = (title, description, houses, geofencePolygons = beat.fencePolygons) => {
        setHouseMapDialog({title, description, houses, geofencePolygons});
    };
    const collectionHouseDetails = (coverage, category) => sortHouseDetails(
        coverage.details.filter((detail) => category === "all" ||
            (category === "own" && detail.collectionCategory === "own") ||
            (category === "other" && detail.collectionCategory === "other") ||
            (category === "remaining" && detail.collectionCategory === "remaining")),
        category, beat.assignedEmployee.id,
    );
    const openCoverageMap = (coverage, category, label, periodLabel) => {
        const details = collectionHouseDetails(coverage, category);
        const statusLabel = category === "own"
            ? "Collected by assigned employee"
            : category === "other"
                ? "Collected by another employee"
                : category === "remaining"
                    ? "Not collected in this period"
                    : null;
        openHouseMap(
            `${label} (${formatNumber(details.length)})`,
            `${periodLabel} Select a house to highlight it on the map and view its details.`,
            toHouseMapRows(details, statusLabel, category === "all" ? "own" : category),
        );
    };
    const outsideBeatMapRows = (item) => {
        const outsideBeat = otherBeats.find((otherBeat) => otherBeat.id === item.beatId);
        const houseIds = new Set(item.houseIds);
        return (outsideBeat?.houses || [])
            .filter((house) => houseIds.has(house.houseId))
            .sort((a, b) =>
                (a.history?.collectionDates?.[0] || a.houseId).localeCompare(
                    b.history?.collectionDates?.[0] || b.houseId,
                ) || a.houseId.localeCompare(b.houseId)
            )
            .map((house) => ({
                house,
                statusLabel: `Collected outside ${beat.beatName}`,
                lastScannedDate: house.history?.lastCollectionAt?.slice(0, 10) ||
                    house.scanningDate?.slice(0, 10) || null,
                scannerName: null,
                beatName: item.beatName,
                markerStatus: "own",
            }));
    };

    if (!selectedEmployeeId) {
        const hasEmployeeList = Boolean(employeeList);
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4">
                <section className="mx-auto flex max-w-7xl flex-col gap-4 rounded-xl bg-white p-5 shadow-sm">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Employee Analysis</h1>
                        <p className="mt-1 text-sm text-slate-600">Choose a ULB and employee to view that employee&apos;s analysis.</p>
                    </div>
                    <EmployeeAnalysisFilters
                        ulbs={ulbs}
                        selectedUlbId={selectedUlbId}
                        onSelectedUlbIdChange={onSelectedUlbIdChange}
                        employeeOptions={employeeOptions}
                        selectedEmployeeId={selectedEmployeeId}
                        onSelectedEmployeeIdChange={setSelectedEmployeeId}
                        dateSelection={dateSelection}
                        dateOptions={dateOptions}
                        onDateSelectionChange={onDateSelectionChange}
                    />
                    <p role="status" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                        {!selectedUlbId
                            ? "Upload the ULB list, then select a ULB."
                            : !hasEmployeeList && !beats.length
                                ? "Upload the employee list and Beat/API files for this ULB."
                                : !employeeOptions.length
                                    ? "No employees are available for this ULB."
                                    : !selectedEmployeeId
                                        ? "Select an employee to view their analysis."
                                        : "No Beat/API data is loaded for this ULB."}
                    </p>
                </section>
            </div>
        );
    }

    if (!beat) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4">
                <section className="mx-auto flex max-w-7xl flex-col gap-4 rounded-xl bg-white p-5 shadow-sm">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Employee Analysis</h1>
                        <p className="mt-1 text-sm text-slate-600">Choose an employee with uploaded Beat/API data.</p>
                    </div>
                    <EmployeeAnalysisFilters
                        ulbs={ulbs}
                        selectedUlbId={selectedUlbId}
                        onSelectedUlbIdChange={onSelectedUlbIdChange}
                        employeeOptions={employeeOptions}
                        selectedEmployeeId={selectedEmployeeId}
                        onSelectedEmployeeIdChange={setSelectedEmployeeId}
                        dateSelection={dateSelection}
                        dateOptions={dateOptions}
                        onDateSelectionChange={onDateSelectionChange}
                    />
                    <p role="status" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                        No Beat/API data is loaded for the selected employee in this ULB.
                    </p>
                </section>
            </div>
        );
    }

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
                        <EmployeeAnalysisFilters
                            ulbs={ulbs}
                            selectedUlbId={selectedUlbId}
                            onSelectedUlbIdChange={onSelectedUlbIdChange}
                            employeeOptions={employeeOptions}
                            selectedEmployeeId={selectedEmployeeId}
                            onSelectedEmployeeIdChange={setSelectedEmployeeId}
                            dateSelection={dateSelection}
                            dateOptions={dateOptions}
                            onDateSelectionChange={onDateSelectionChange}
                        />
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
                        <Card
                            label="Total Houses in My Beat"
                            value={formatNumber(totalHouses)}
                            onClick={() => openCoverageMap(houseCoverage, "all", "All houses in My Beat", `All houses in ${beat.beatName}.`)}
                        />
                        <Card label="Collected by Me" value={formatNumber(ownCount)} tone="text-green-700"
                            onClick={() => openCoverageMap(houseCoverage, "own", "Collected by Me", `Houses collected by ${beat.assignedEmployee.name} in the selected ${reportWindowLabel}.`)}
                            detail={`${ownCoveragePercent == null ? "Unavailable" : `${formatNumber(ownCoveragePercent, 1)}%`} in the selected reporting window; scanner must match the assigned employee.`} />
                        <Card label="Collected by Other Employees" value={formatNumber(otherCount)} tone="text-amber-700"
                            onClick={() => openCoverageMap(houseCoverage, "other", "Collected by Other Employees", `Houses collected by other employees in the selected ${reportWindowLabel}.`)}
                            detail="In the selected reporting window; these houses still belong to My Beat." />
                        <Card label="Not Collected" value={formatNumber(remainingCount)} tone="text-red-700"
                            onClick={() => openCoverageMap(houseCoverage, "remaining", "Not Collected", `Houses without an identified employee scan in the selected ${reportWindowLabel}.`)}
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
                                <Card
                                    label="Total Houses"
                                    value={formatNumber(totalHouses)}
                                    onClick={() => openCoverageMap(selectedDateCoverage, "all", "All houses on selected date", `All houses in ${beat.beatName}; collection status is evaluated for ${formatDate(effectiveEndDate)}.`)}
                                />
                                <Card label="Collected by Me" value={formatNumber(selectedDateCoverage.assignedEmployeeCollected)} tone="text-green-700"
                                    onClick={() => openCoverageMap(selectedDateCoverage, "own", "Collected by Me on selected date", `Houses collected by ${beat.assignedEmployee.name} on ${formatDate(effectiveEndDate)}.`)} />
                                <Card label="Collected by Other Employees" value={formatNumber(selectedDateCoverage.otherEmployeeCollected)} tone="text-amber-700"
                                    onClick={() => openCoverageMap(selectedDateCoverage, "other", "Collected by Other Employees on selected date", `Houses collected by other employees on ${formatDate(effectiveEndDate)}.`)} />
                                <Card label="Not Scanned on Selected Date" value={formatNumber(selectedDateCoverage.remainingWithoutHistory)} tone="text-red-700"
                                    onClick={() => openCoverageMap(selectedDateCoverage, "remaining", "Not Scanned on Selected Date", `Houses with no identified employee scan on ${formatDate(effectiveEndDate)}.`)} />
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

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="border-b border-slate-100 pb-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Collection follow-up
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-900">
                            House Attention Queue
                        </h2>
                        <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                            Review houses with no ScanningDates entry in the available report history, or houses that are overdue by up to 7 days beyond their usual collection interval. Missing scan history does not prove a house was never cleaned.
                        </p>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => openHouseMap(
                                `No scan recorded (${formatNumber(noScanHistoryHouses.length)})`,
                                "These houses have no ScanningDates entry in the available BeatWiseReport history through the selected date. This does not claim that they were never cleaned.",
                                toHouseMapRows(noScanHistoryHouses, "No scan recorded in available history", "remaining"),
                            )}
                            className="group flex min-h-24 items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-slate-100 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                        >
                            <span>
                                <span className="block font-semibold text-slate-900">No scan recorded</span>
                                <span className="mt-1 block text-xs text-slate-600">No ScanningDates entry in the available report history</span>
                            </span>
                            <span className="shrink-0 text-2xl font-bold tabular-nums text-slate-900">
                                {formatNumber(noScanHistoryCount)}
                                <span className="sr-only"> houses</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openHouseMap(
                                `Overdue by up to 7 days (${formatNumber(housesOverdueUpToWeek.length)})`,
                                `These houses have passed 1.5 times their typical collection interval and are no more than 7 days beyond that due point, through ${formatDate(effectiveEndDate)}.`,
                                toHouseMapRows(housesOverdueUpToWeek, "Overdue by up to 7 days", "attention"),
                            )}
                            className="group flex min-h-24 items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-300 hover:bg-amber-100 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                        >
                            <span>
                                <span className="block font-semibold text-amber-950">Overdue by up to 7 days</span>
                                <span className="mt-1 block text-xs text-amber-800">Past 1.5× the typical interval, by no more than 7 days</span>
                            </span>
                            <span className="shrink-0 text-2xl font-bold tabular-nums text-amber-950">
                                {formatNumber(housesOverdueUpToWeek.length)}
                                <span className="sr-only"> houses</span>
                            </span>
                        </button>
                    </div>
                </section>

                <section className="rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">Houses Collected by Other Employees</h2>
                        <p className="mt-1 text-xs text-slate-600">
                            These houses belong to My Beat. Select an employee to see the houses they collected.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => openHouseMap(
                            `Collected by other employees (${formatNumber(otherEmployeeHouseDetails.length)})`,
                            "Houses from My Beat collected by other employees in the selected reporting period.",
                            toHouseMapRows(otherEmployeeHouseDetails, "Collected by another employee", "other"),
                        )}
                        className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:border-green-300 hover:bg-green-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
                    >
                        Total: {formatNumber(houseCoverage.otherEmployeeCollected)} distinct houses · {formatNumber(otherEmployeeGroups.length)} other employees
                    </button>
                    <div className="mt-2 max-h-[24rem] overflow-auto rounded border border-slate-200">
                        {otherEmployeeGroups.length ? otherEmployeeGroups.map((group) => (
                            <button
                                type="button"
                                key={group.employeeKey}
                                onClick={() => openHouseMap(
                                    `${group.employeeName} (${formatNumber(group.houses.length)} houses)`,
                                    `My Beat houses collected by ${group.employeeName} in the selected reporting period.`,
                                    toHouseMapRows(group.houses, `Collected by ${group.employeeName}`, "other"),
                                )}
                                className="flex w-full items-center justify-between gap-3 border-b border-slate-100 p-3 text-left text-sm transition last:border-b-0 hover:bg-green-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-green-600"
                            >
                                <span className="font-medium text-slate-800">{group.employeeName}</span>
                                <span className="text-slate-600">{formatNumber(group.houses.length)} houses · View map</span>
                            </button>
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
                    <button
                        type="button"
                        disabled={!beats.length || !outsideBeatAnalysis.totalHouses}
                        onClick={() => openHouseMap(
                            `Collected outside My Beat (${formatNumber(outsideBeatAnalysis.totalHouses)})`,
                            `Houses collected by ${beat.assignedEmployee.name} in other uploaded Beats during the selected reporting period.`,
                            outsideBeatAnalysis.byBeat.flatMap((item) => outsideBeatMapRows(item)),
                            outsideBeatAnalysis.byBeat.flatMap((item) =>
                                otherBeats.find((otherBeat) => otherBeat.id === item.beatId)?.fencePolygons || []
                            ),
                        )}
                        className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:border-green-300 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Total outside-Beat houses: {beats.length > 1
                            ? formatNumber(outsideBeatAnalysis.totalHouses)
                            : "Unavailable"} · View map
                    </button>
                    <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-200">
                        <table className="w-full min-w-[650px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                                <tr><th className="p-3">Other Beat</th><th className="p-3">Distinct houses</th><th className="p-3">House IDs</th></tr>
                            </thead>
                            <tbody>
                                {outsideBeatAnalysis.byBeat.map((item) => (
                                    <tr key={item.beatId} className="border-t border-slate-100">
                                        <td className="p-3">{item.beatName}</td>
                                        <td className="p-3">
                                            <button
                                                type="button"
                                                onClick={() => openHouseMap(
                                                    `${item.beatName} (${formatNumber(item.count)} houses)`,
                                                    `Houses collected by ${beat.assignedEmployee.name} in ${item.beatName}.`,
                                                    outsideBeatMapRows(item),
                                                    otherBeats.find((otherBeat) => otherBeat.id === item.beatId)?.fencePolygons || [],
                                                )}
                                                className="font-semibold text-green-800 underline decoration-green-300 underline-offset-2 hover:text-green-950"
                                            >
                                                {formatNumber(item.count)} · View map
                                            </button>
                                        </td>
                                        <td className="p-3">
                                            <button
                                                type="button"
                                                onClick={() => openHouseMap(
                                                    `${item.beatName} (${formatNumber(item.count)} houses)`,
                                                    `Houses collected by ${beat.assignedEmployee.name} in ${item.beatName}.`,
                                                    outsideBeatMapRows(item),
                                                    otherBeats.find((otherBeat) => otherBeat.id === item.beatId)?.fencePolygons || [],
                                                )}
                                                className="text-left text-green-800 underline decoration-green-300 underline-offset-2 hover:text-green-950"
                                            >
                                                {item.houseIds.slice(0, 12).join(", ")}{item.houseIds.length > 12
                                                    ? ` and ${formatNumber(item.houseIds.length - 12)} more`
                                                    : ""}
                                            </button>
                                        </td>
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
                <section aria-labelledby="coverage-trend-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div>
                        <h2 id="coverage-trend-heading" className="text-lg font-semibold text-slate-900">Coverage Trend</h2>
                        <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                            See whether more or fewer houses were collected in this period than in the previous period of the same length. Coverage is the share of Beat houses scanned by you or another employee. A change of +5 percentage points means coverage went from, for example, 40% to 45%.
                        </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Card
                            label="Previous matching period"
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
                            label="Selected period"
                            value={coverageTrend.currentPercent == null
                                ? "Unavailable"
                                : `${formatNumber(coverageTrend.currentPercent, 1)}%`}
                            detail={`${formatDate(effectiveStartDate)} to ${formatDate(effectiveEndDate)}`}
                        />
                        <Card
                            label="Coverage change"
                            value={coverageTrend.changePercentagePoints == null
                                ? "Unavailable"
                                : `${coverageTrend.changePercentagePoints > 0 ? "+" : ""}${formatNumber(coverageTrend.changePercentagePoints, 1)} pp`}
                            detail={!previousWindowIsAvailable
                                ? "Previous-period comparison unavailable for this reporting range."
                                : "Difference in percentage points"}
                        />
                        <Card
                            label="Direction"
                            value={coverageTrend.trend === "Insufficient data"
                                ? "Unavailable"
                                : coverageTrend.trend}
                            detail={!previousWindowIsAvailable
                                ? "Previous-period comparison unavailable for this reporting range."
                                : coverageTrend.trend === "Insufficient data"
                                    ? "Coverage data is unavailable for this comparison."
                                    : "Based on the difference between the two coverage percentages."}
                            tone={coverageTrend.trend === "Improving"
                                ? "text-green-700"
                                : coverageTrend.trend === "Declining"
                                    ? "text-red-700"
                                    : "text-slate-900"}
                        />
                    </div>
                </section>

                <section aria-labelledby="collection-pattern-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div>
                        <h2 id="collection-pattern-heading" className="text-lg font-semibold text-slate-900">Collection Pattern</h2>
                        <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                            These summaries use all available scan history through {formatDate(effectiveEndDate)}. Long gaps describe timing patterns only; they do not prove a house was deliberately skipped.
                        </p>
                    </div>
                    <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Scanned on multiple days: </span>
                            {formatNumber(collectionPatterns.repeatedlyCollected)} houses have scans recorded on more than one date.
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Scanned less often than typical: </span>
                            {historicalHouseCoverage.typicalScanCount == null
                                ? "There is not enough scan history to estimate a typical Beat baseline."
                                : `${formatNumber(collectionPatterns.lowFrequency)} houses have fewer than half the typical ${formatNumber(historicalHouseCoverage.typicalScanCount, 1)} recorded scans per house.`}
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Repeated long gaps between scans: </span>
                            {collectionPatterns.recordedHouseDays
                                ? `${formatNumber(collectionPatterns.recurringLongGaps)} houses have at least two gaps longer than 1.5 times their own usual gap between scans.`
                                : "There is not enough scan history to check for repeated gaps."}
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">No scan in the available report: </span>
                            {formatNumber(collectionPatterns.noRecordedCollection)} houses have no ScanningDates entry in the report history. This does not establish that a house was never cleaned.
                        </li>
                        <li className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 sm:col-span-2">
                            <span className="font-semibold text-slate-900">Month with the most recorded activity: </span>
                            {collectionPatterns.busiestMonth
                                ? `${formatMonth(collectionPatterns.busiestMonth.month)} had the most recorded house-days (${formatNumber(collectionPatterns.busiestMonth.houseDays)}). A house scanned on one date counts as one house-day.`
                                : "Not enough historical periods are available to compare months."}
                        </li>
                    </ul>
                </section>

                <section aria-labelledby="anomaly-detection-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div>
                        <h2 id="anomaly-detection-heading" className="text-lg font-semibold text-slate-900">
                            Anomaly Detection
                        </h2>
                        <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                            Checks for unusual recorded patterns. Daily house counts are compared with the previous calendar day; other checks use recent activity or each house’s scan history. An alert is a signal to review, not proof of misconduct.
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
                                    <p className="font-medium">Some checks could not be completed:</p>
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
                                                <th className="p-3">What looks unusual</th>
                                                <th className="p-3">What happened</th>
                                                <th className="p-3">What is typical for comparison</th>
                                                <th className="p-3">Severity</th>
                                                <th className="p-3">Why it is flagged</th>
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
                <AnalysisHouseMapDialog
                    open={Boolean(houseMapDialog)}
                    onOpenChange={(open) => {
                        if (!open) setHouseMapDialog(null);
                    }}
                    title={houseMapDialog?.title || ""}
                    description={houseMapDialog?.description || ""}
                    houses={houseMapDialog?.houses || []}
                    geofencePolygons={houseMapDialog?.geofencePolygons || beat.fencePolygons || []}
                />
            </div>
        </div>
    );
}
