import {beatHasHouseRecords} from "./beatApiData.js";

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dateInWindow(date, fromDate, toDate) {
    return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}

function intervalMedian(dates) {
    const intervals = dates.slice(1).map((date, index) => {
        const start = Date.parse(`${dates[index]}T00:00:00Z`);
        const end = Date.parse(`${date}T00:00:00Z`);
        return (end - start) / 86400000;
    }).filter((days) => days > 0);
    return median(intervals);
}

function formatScanCount(value) {
    return `${Number.isInteger(value) ? value : value.toFixed(1)} scans per house`;
}

function daysSince(date, toDate) {
    if (!date || !toDate) return null;
    const start = Date.parse(`${date}T00:00:00Z`);
    const end = Date.parse(`${toDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return Math.max(0, Math.floor((end - start) / 86400000));
}

function addDays(date, days) {
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp + days * 86400000).toISOString().slice(0, 10);
}

function formatElapsedDays(value) {
    return `${Number.isInteger(value) ? value : value.toFixed(1)} days`;
}

export function getReportWindowDays(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    const start = Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.floor((end - start) / 86400000) + 1;
}

export function isEmployeeActiveOnDate(beats, employeeId, date) {
    if (!date) return false;
    return beats.some((beat) =>
        String(beat.assignedEmployee?.id || beat.beatUserId || "") === String(employeeId) &&
        beatHasHouseRecords(beat) &&
        (beat.routes || []).some((route) =>
            route.date === date && route.trackPoints?.length > 0
        )
    );
}

export function getBeatPlannerEmployeeOptions(employeeList, beats, selectedDate) {
    const reportsByEmployeeId = new Map();
    (beats || []).forEach((beat) => {
        const id = String(beat.assignedEmployee?.id || beat.beatUserId || "");
        if (id && !reportsByEmployeeId.has(id)) reportsByEmployeeId.set(id, beat);
    });

    const listedEmployees = Array.isArray(employeeList) ? employeeList : [];
    const employees = listedEmployees.length
        ? listedEmployees
        : [...reportsByEmployeeId.entries()].map(([id, beat]) => ({
            id,
            name: beat.assignedEmployee?.name || `Employee ${id}`,
        }));

    return employees.map((employee) => {
        const id = String(employee.id);
        const beat = reportsByEmployeeId.get(id) || null;
        const hasBeat = Boolean(
            beat && (
                beat.beatNameAvailable ||
                beat.fencePolygons?.length ||
                beat.houses?.length
            )
        );
        return {
            employeeId: id,
            name: employee.name || beat?.assignedEmployee?.name || `Employee ${id}`,
            mappingId: beat?.id || "",
            beatId: beat?.id || "",
            beatName: hasBeat ? beat.beatName : "",
            hasBeat,
            hasReport: Boolean(beat),
            isActive: beat ? isEmployeeActiveOnDate(beats, id, selectedDate) : null,
        };
    });
}

export function summarizeDailyEmployeeReport(coverage, routes, selectedDate) {
    if (!coverage?.details || !selectedDate) return null;

    const houseIdsByDate = new Map();
    coverage.details.forEach((detail) => {
        (detail.assignedCollectionDates || []).forEach((date) => {
            const houseIds = houseIdsByDate.get(date) || new Set();
            houseIds.add(detail.house.houseId);
            houseIdsByDate.set(date, houseIds);
        });
    });

    const previousDate = addDays(selectedDate, -1);
    const gpsPointsForDate = (date) => (routes || [])
        .filter((route) => route.date === date)
        .reduce((total, route) => total + (route.trackPoints?.length || 0), 0);
    const selectedDateGpsPointCount = gpsPointsForDate(selectedDate);
    const previousDateGpsPointCount = gpsPointsForDate(previousDate);
    const selectedDateHouseCount = houseIdsByDate.get(selectedDate)?.size || 0;
    const previousDateHouseCount = houseIdsByDate.get(previousDate)?.size || 0;

    return {
        selectedDate,
        previousDate,
        selectedDateHouseCount,
        previousDateHouseCount,
        houseCountChange: selectedDateHouseCount - previousDateHouseCount,
        selectedDateGpsPointCount,
        previousDateGpsPointCount,
        selectedDateAttendance: selectedDateGpsPointCount > 0 ? "Present" : "Absent",
        previousDateAttendance: previousDateGpsPointCount > 0 ? "Present" : "Absent",
    };
}

export function analyzeOutsideBeatCollections(routes, otherBeats, assignedEmployeeId, fromDate, toDate) {
    const housesByBeat = new Map();
    const housesByDate = new Map();
    let unmatchedScanCount = 0;
    const housesByReference = new Map();
    otherBeats.forEach((beat) => {
        beat.houses.forEach((house) => {
            if (!house.referenceId) return;
            const matches = housesByReference.get(house.referenceId) || [];
            matches.push({beat, house});
            housesByReference.set(house.referenceId, matches);
        });
    });

    const addHouse = (beat, house, date) => {
        const houses = housesByBeat.get(beat.id) || new Set();
        houses.add(house.houseId);
        housesByBeat.set(beat.id, houses);
        const dateHouses = housesByDate.get(date) || new Set();
        dateHouses.add(house.houseId);
        housesByDate.set(date, dateHouses);
    };

    routes.forEach((route) => {
        if (!dateInWindow(route.date, fromDate, toDate)) return;
        (route.collectionScans || []).forEach((scan) => {
            if (String(scan.scannerUserId || assignedEmployeeId || "") !== String(assignedEmployeeId || "") ||
                !assignedEmployeeId || scan.houseId) return;
            const matches = scan.plateId ? housesByReference.get(scan.plateId) || [] : [];
            if (matches.length !== 1) {
                unmatchedScanCount += 1;
                return;
            }
            const {beat, house} = matches[0];
            addHouse(beat, house, route.date);
        });
    });

    // The report API records scans on the houses of the Beat that was collected (house history with
    // the scanner's user ID), not in the collecting employee's own route. Read them from there too,
    // the same way Employee Alerts does.
    if (assignedEmployeeId) {
        otherBeats.forEach((beat) => {
            (beat.houses || []).forEach((house) => {
                (house.historyEvents || []).forEach((event) => {
                    if (String(event.scannerUserId || "") !== String(assignedEmployeeId) ||
                        !dateInWindow(event.date, fromDate, toDate)) return;
                    addHouse(beat, house, event.date);
                });
            });
        });
    }

    const byBeat = [...housesByBeat.entries()].map(([beatId, houseIds]) => {
        const beat = otherBeats.find((item) => item.id === beatId);
        return {
            beatId,
            beatName: beat?.beatName || beatId,
            count: houseIds.size,
            houseIds: [...houseIds].sort((a, b) => a.localeCompare(b)),
        };
    }).sort((a, b) => b.count - a.count);
    return {
        byBeat,
        byDate: [...housesByDate.entries()]
            .map(([date, houseIds]) => ({date, houseIds: [...houseIds].sort()}))
            .sort((a, b) => a.date.localeCompare(b.date)),
        totalHouses: byBeat.reduce((total, item) => total + item.count, 0),
        unmatchedScanCount,
    };
}

export function analyzeHouseCoverage(houses, routes, fromDate, toDate, assignedEmployee, otherBeats = []) {
    const assignedEmployeeId = String(assignedEmployee?.id || "");
    const assignedEmployeeName = assignedEmployee?.name || "Assigned employee";
    const scansByHouse = new Map();
    const selectedReferences = new Map();

    houses.forEach((house) => {
        if (!house.referenceId) return;
        const matches = selectedReferences.get(house.referenceId) || [];
        matches.push(house.houseId);
        selectedReferences.set(house.referenceId, matches);
    });

    const addScan = (houseId, scan, date, beatName, defaultScannerId = "", defaultScannerName = null) => {
        const hasScannerId = Boolean(scan.scannerUserId);
        const scannerId = String(scan.scannerUserId || defaultScannerId || "");
        const events = scansByHouse.get(houseId) || [];
        events.push({
            date,
            timestamp: Number.isFinite(Date.parse(scan.datetime))
                ? Date.parse(scan.datetime)
                : Date.parse(`${date}T00:00:00Z`),
            scannerId,
            scannerName: scan.scannerName || (hasScannerId
                ? scannerId === assignedEmployeeId ? assignedEmployeeName : `Employee ${scannerId}`
                : defaultScannerName || (scannerId === assignedEmployeeId
                    ? assignedEmployeeName
                    : scannerId ? `Employee ${scannerId}` : null)),
            beatName,
        });
        scansByHouse.set(houseId, events);
    };

    routes.forEach((route) => {
        if (!dateInWindow(route.date, fromDate, toDate)) return;
        route.collectionScans.forEach((scan) => {
            if (scan.houseId) {
                addScan(
                    scan.houseId,
                    scan,
                    route.date,
                    null,
                    assignedEmployeeId,
                    assignedEmployeeName,
                );
            }
        });
    });

    otherBeats.forEach((otherBeat) => {
        const otherEmployeeId = String(otherBeat.assignedEmployee?.id || otherBeat.beatUserId || "");
        const otherEmployeeName = otherBeat.assignedEmployee?.name ||
            (otherEmployeeId ? `Employee ${otherEmployeeId}` : null);
        otherBeat.routes.forEach((route) => {
            if (!dateInWindow(route.date, fromDate, toDate)) return;
            route.collectionScans.forEach((scan) => {
                const matches = scan.plateId ? selectedReferences.get(scan.plateId) || [] : [];
                if (matches.length === 1) {
                    addScan(
                        matches[0],
                        scan,
                        route.date,
                        otherBeat.beatName,
                        otherEmployeeId,
                        otherEmployeeName,
                    );
                }
            });
        });
    });

    const details = houses.map((house) => {
        const routeEvents = scansByHouse.get(house.houseId) || [];
        const historyDates = [...new Set((house.history?.collectionDates || [])
            .filter((date) => dateInWindow(date, fromDate, toDate)))];
        const snapshotDate = house.scanningDate?.slice(0, 10);
        const snapshotTimestamp = house.scanningDate ? Date.parse(house.scanningDate) : NaN;
        const snapshotIsInWindow = Boolean(snapshotDate &&
            dateInWindow(snapshotDate, fromDate, toDate));
        const snapshotScannerId = String(house.scannerUserId || "");

        const events = [...routeEvents];
        const eventDates = new Set(routeEvents.map((event) => event.date));
        (house.historyEvents || []).forEach((historyEvent) => {
            if (historyEvent.source !== "house-record-history" ||
                !dateInWindow(historyEvent.date, fromDate, toDate) ||
                eventDates.has(historyEvent.date)) return;
            eventDates.add(historyEvent.date);
            events.push({
                date: historyEvent.date,
                timestamp: Number.isFinite(Date.parse(historyEvent.timestamp))
                    ? Date.parse(historyEvent.timestamp)
                    : Date.parse(`${historyEvent.date}T00:00:00Z`),
                scannerId: String(historyEvent.scannerUserId || ""),
                scannerName: historyEvent.scannerName || null,
                beatName: null,
            });
        });
        if (snapshotIsInWindow && snapshotScannerId && !eventDates.has(snapshotDate)) {
            events.push({
                date: snapshotDate,
                timestamp: Number.isFinite(snapshotTimestamp)
                    ? snapshotTimestamp
                    : Date.parse(`${snapshotDate}T00:00:00Z`),
                scannerId: snapshotScannerId,
                scannerName: house.scannerName || (snapshotScannerId === assignedEmployeeId
                    ? assignedEmployeeName
                    : `Employee ${snapshotScannerId}`),
                beatName: null,
            });
        }

        const routeDates = new Set(routeEvents.map((event) => event.date));
        const dates = new Set([...historyDates, ...routeDates]);
        if (snapshotIsInWindow) dates.add(snapshotDate);
        const collectionDates = [...dates].sort();
        const lastRecordedDate = collectionDates.at(-1) || null;
        const assignedEvents = assignedEmployeeId
            ? events.filter((event) => event.scannerId === assignedEmployeeId)
            : [];
        const otherEvents = events.filter((event) =>
            Boolean(event.scannerId) && event.scannerId !== assignedEmployeeId
        );
        const assignedDates = new Set(assignedEvents.map((event) => event.date));
        const otherDates = new Set(otherEvents.map((event) => event.date));
        const additionalHistoryScanCount = historyDates.filter((date) => !routeDates.has(date)).length;
        const snapshotAddsHistoryScan = snapshotIsInWindow && !routeDates.has(snapshotDate) &&
            !historyDates.includes(snapshotDate);
        const recordedScanCount = routeEvents.length + additionalHistoryScanCount +
            (snapshotAddsHistoryScan ? 1 : 0);
        const typicalIntervalDays = intervalMedian(collectionDates);
        const currentGapDays = toDate
            ? daysSince(lastRecordedDate, toDate)
            : house.history?.currentGapDays ?? null;
        const hasOtherEmployeeCollection = otherEvents.length > 0;
        const hasAssignedEmployeeCollection = assignedEvents.length > 0;
        const otherEmployeeCollectionRecords = otherEvents;
        const repeatedLongGaps = typicalIntervalDays == null
            ? 0
            : collectionDates.slice(1).filter((date, index) =>
                daysSince(collectionDates[index], date) > typicalIntervalDays * 1.5
            ).length;

        return {
            house,
            collectionDays: collectionDates.length,
            assignedEmployeeCollectionDays: assignedDates.size,
            assignedCollectionDates: [...assignedDates].sort(),
            otherEmployeeCollectionDates: [...otherDates].sort(),
            assignedEmployeeScanCount: assignedEvents.length,
            otherEmployeeCollectionDays: otherDates.size,
            otherEmployeeScanCount: otherEvents.length,
            recordedScanCount,
            collectionDates,
            lastRecordedDate,
            latestScannerName: [...events]
                .filter((event) => event.scannerId)
                .sort((a, b) => a.timestamp - b.timestamp)
                .at(-1)?.scannerName || null,
            otherEmployeeCollectionRecords,
            latestOtherEmployeeRecord: [...otherEmployeeCollectionRecords]
                .sort((a, b) => a.timestamp - b.timestamp).at(-1) || null,
            latestScannerBeatName: [...events]
                .filter((event) => event.scannerId)
                .sort((a, b) => a.timestamp - b.timestamp)
                .at(-1)?.beatName || null,
            typicalIntervalDays,
            currentGapDays,
            repeatedLongGaps,
            collectionCategory: hasOtherEmployeeCollection
                ? "other"
                : hasAssignedEmployeeCollection
                    ? "own"
                    : "remaining",
        };
    });

    const typicalScanCount = median(details
        .map((detail) => detail.recordedScanCount)
        .filter((count) => count > 0));
    details.forEach((detail) => {
        detail.isLowFrequency = typicalScanCount != null &&
            detail.recordedScanCount < typicalScanCount * 0.5;
        detail.status = detail.recordedScanCount === 0
            ? "Not Collected"
            : detail.currentGapDays != null &&
                detail.typicalIntervalDays != null &&
                detail.currentGapDays > detail.typicalIntervalDays * 1.5
                ? "Overdue"
                : detail.isLowFrequency
                    ? "Low Frequency"
                    : detail.repeatedLongGaps >= 2
                        ? "Needs Attention"
                        : "Regular";
        detail.attentionReason = detail.status === "Not Collected"
            ? "No collection scan is recorded in the reporting period."
            : detail.status === "Overdue"
                ? `${formatElapsedDays(detail.currentGapDays)} since the last scan; normal interval is ${formatElapsedDays(detail.typicalIntervalDays)}.`
                : detail.status === "Low Frequency"
                    ? `${detail.recordedScanCount} scans, below half the typical ${formatScanCount(typicalScanCount)} per house.`
                    : detail.status === "Needs Attention"
                        ? `${detail.repeatedLongGaps} historical gaps exceeded 1.5 times this house's normal interval.`
                        : "Collection pattern is within the observed Beat history.";
    });

    const ownCount = details.filter((detail) => detail.collectionCategory === "own").length;
    const otherCount = details.filter((detail) => detail.collectionCategory === "other").length;
    const notCollectedCount = details.filter((detail) => detail.collectionCategory === "remaining").length;
    return {
        details,
        typicalScanCount,
        collectedAtLeastOnce: ownCount + otherCount,
        notCollected: notCollectedCount,
        lowFrequency: details.filter((detail) => detail.status === "Low Frequency").length,
        needsAttention: details.filter((detail) =>
            detail.status === "Needs Attention" || detail.status === "Overdue"
        ).length,
        assignedEmployeeCollected: ownCount,
        otherEmployeeCollected: otherCount,
        repeatedlyOtherEmployeeCollected: details.filter((detail) =>
            detail.otherEmployeeCollectionDays > 1
        ).length,
        remainingWithoutHistory: notCollectedCount,
        requiringAttention: details.filter((detail) => detail.status !== "Regular"),
    };
}

export function getHistoricallyCollectedHouses(houses, routes, assignedEmployee, otherBeats = []) {
    return analyzeHouseCoverage(
        houses,
        routes,
        null,
        null,
        assignedEmployee,
        otherBeats,
    ).details
        .filter((detail) => detail.collectionDates.length > 0)
        .map((detail) => detail.house);
}

export function getHighPriorityHouses(coverage, reportWindowDays) {
    return coverage.details
        .filter((detail) =>
            (detail.recordedScanCount === 0 && reportWindowDays >= 30) ||
            (detail.currentGapDays != null && detail.currentGapDays >= 7)
        )
        .map((detail) => ({
            detail,
            daysSinceScan: detail.currentGapDays,
            unscannedThroughoutMonth: detail.recordedScanCount === 0 && reportWindowDays >= 30,
        }))
        .sort((a, b) => {
            if (a.daysSinceScan == null && b.daysSinceScan != null) return -1;
            if (b.daysSinceScan == null && a.daysSinceScan != null) return 1;
            return (b.daysSinceScan ?? 0) - (a.daysSinceScan ?? 0) ||
                a.detail.house.houseId.localeCompare(b.detail.house.houseId);
        });
}

function lastScanOnOrBefore(detail, endDate) {
    const dates = [
        ...(detail.house.history?.collectionDates || []),
        detail.house.scanningDate?.slice(0, 10),
        detail.lastRecordedDate,
    ].filter((date) => date && (!endDate || date <= endDate));
    return dates.sort().at(-1) || null;
}

export function getNextCollectionPriorities(coverage, endDate) {
    return coverage.details.map((detail) => {
        const lastScannedDate = lastScanOnOrBefore(detail, endDate);
        const daysSinceScan = daysSince(lastScannedDate, endDate);
        // The coverage is already capped at endDate. Do not let a later scan
        // make a house look as though it had been scanned on this historical date.
        const neverScanned = !(detail.collectionDates || []).length;
        const hasHistoryThroughDate = (detail.collectionDays || 0) > 0;
        const overdue = detail.status === "Overdue";
        const significantlyOverdue = hasHistoryThroughDate &&
            daysSinceScan != null &&
            detail.typicalIntervalDays != null &&
            daysSinceScan > detail.typicalIntervalDays * 2.5;
        const priority = neverScanned || significantlyOverdue || overdue;
        if (!priority) return null;

        const priorityLabel = neverScanned
            ? "High priority — no scan in report history"
            : significantlyOverdue
                ? "High priority — overdue"
                : overdue
                    ? "Due — collection interval exceeded"
                    : "Due";
        const reason = neverScanned
            ? "No ScanningDates entry is present for this house in the selected BeatWiseReport history."
            : significantlyOverdue || overdue
                ? `${formatElapsedDays(daysSinceScan)} since its last scan; its normal interval is ${formatElapsedDays(detail.typicalIntervalDays)}.`
                : detail.attentionReason;

        return {
            detail,
            lastScannedDate,
            daysSinceScan,
            priorityLabel,
            reason,
            frequency: neverScanned
                ? "No scans in available history"
                : `${detail.recordedScanCount} scans across ${detail.collectionDays} historical collection days`,
            priorityRank: neverScanned ? 5
                : significantlyOverdue ? 4
                    : overdue ? 2 : 1,
        };
    }).filter(Boolean).sort((a, b) =>
        b.priorityRank - a.priorityRank ||
        (b.daysSinceScan ?? -1) - (a.daysSinceScan ?? -1) ||
        b.detail.repeatedLongGaps - a.detail.repeatedLongGaps ||
        a.detail.house.houseId.localeCompare(b.detail.house.houseId)
    );
}

export function getHighPriorityAttentionHouses(attentionHouses) {
    return attentionHouses.filter((item) => item.priorityRank >= 3);
}

// A change smaller than this many percentage points is reported as "Stable".
export const WEEKLY_TREND_STABLE_BAND_PP = 1;

/**
 * Splits a date range into full 7-day weeks that end on endDate, oldest first.
 * A partial week at the start of the range is left out so every week is the same length.
 */
export function getWeeklyWindows(startDate, endDate, maxWeeks = 4) {
    if (!startDate || !endDate || startDate > endDate) return [];
    const weeks = [];
    let weekEnd = endDate;
    while (weeks.length < maxWeeks) {
        const weekStart = addDays(weekEnd, -6);
        if (!weekStart || weekStart < startDate) break;
        weeks.unshift({fromDate: weekStart, toDate: weekEnd});
        weekEnd = addDays(weekStart, -1);
    }
    return weeks;
}

/**
 * Compares the latest week's coverage with the average of the earlier weeks.
 * weeks: [{fromDate, toDate, percent}] oldest first; percent may be null when unavailable.
 */
export function summarizeWeeklyCoverageTrend(weeks) {
    const measured = (weeks || []).filter((week) => Number.isFinite(week.percent));
    if (measured.length < 2) {
        return {
            latest: measured.at(-1) || null,
            earlierAverage: null,
            earlierWeekCount: 0,
            changePercentagePoints: null,
            trend: "Insufficient data",
        };
    }
    const latest = measured.at(-1);
    const earlier = measured.slice(0, -1);
    const earlierAverage = earlier.reduce((total, week) => total + week.percent, 0) / earlier.length;
    const changePercentagePoints = latest.percent - earlierAverage;
    return {
        latest,
        earlierAverage,
        earlierWeekCount: earlier.length,
        changePercentagePoints,
        trend: Math.abs(changePercentagePoints) < WEEKLY_TREND_STABLE_BAND_PP
            ? "Stable"
            : changePercentagePoints > 0
                ? "Improving"
                : "Declining",
    };
}

export function getCoverageTrend(previousCoverage, currentCoverage, totalHouses) {
    const getPercent = (coverage) => coverage && totalHouses > 0
        ? coverage.collectedAtLeastOnce * 100 / totalHouses
        : null;
    const previousPercent = getPercent(previousCoverage);
    const currentPercent = getPercent(currentCoverage);
    if (previousPercent == null || currentPercent == null) {
        return {
            previousPercent,
            currentPercent,
            changePercentagePoints: null,
            trend: "Insufficient data",
        };
    }

    const changePercentagePoints = currentPercent - previousPercent;
    return {
        previousPercent,
        currentPercent,
        changePercentagePoints,
        trend: changePercentagePoints > 0
            ? "Improving"
            : changePercentagePoints < 0
                ? "Declining"
                : "Stable",
    };
}

export function summarizeCollectionPatterns(coverage) {
    const details = coverage.details || [];
    const activityByMonth = new Map();
    details.forEach((detail) => {
        detail.collectionDates.forEach((date) => {
            const month = date.slice(0, 7);
            activityByMonth.set(month, (activityByMonth.get(month) || 0) + 1);
        });
    });
    const busiestMonth = activityByMonth.size < 2
        ? null
        : [...activityByMonth.entries()]
            .sort(([monthA, countA], [monthB, countB]) =>
                countB - countA || monthA.localeCompare(monthB)
            )[0];

    return {
        repeatedlyCollected: details.filter((detail) => detail.collectionDays > 1).length,
        lowFrequency: details.filter((detail) => detail.isLowFrequency).length,
        recurringLongGaps: details.filter((detail) => detail.repeatedLongGaps >= 2).length,
        noRecordedCollection: details.filter((detail) => !(detail.collectionDates || []).length).length,
        busiestMonth: busiestMonth
            ? {month: busiestMonth[0], houseDays: busiestMonth[1]}
            : null,
        recordedHouseDays: [...activityByMonth.values()].reduce((total, count) => total + count, 0),
    };
}
