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

export function analyzeOutsideBeatCollections(routes, otherBeats, assignedEmployeeId, fromDate, toDate) {
    const housesByBeat = new Map();
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

    routes.forEach((route) => {
        if (!dateInWindow(route.date, fromDate, toDate)) return;
        route.collectionScans.forEach((scan) => {
            if (String(scan.scannerUserId || "") !== String(assignedEmployeeId || "") ||
                !assignedEmployeeId || scan.houseId) return;
            const matches = scan.plateId ? housesByReference.get(scan.plateId) || [] : [];
            if (matches.length !== 1) {
                unmatchedScanCount += 1;
                return;
            }
            const {beat, house} = matches[0];
            const houses = housesByBeat.get(beat.id) || new Set();
            houses.add(house.houseId);
            housesByBeat.set(beat.id, houses);
        });
    });

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

    const addScan = (houseId, scan, date, beatName) => {
        const scannerId = String(scan.scannerUserId || "");
        const events = scansByHouse.get(houseId) || [];
        events.push({
            date,
            timestamp: Number.isFinite(Date.parse(scan.datetime))
                ? Date.parse(scan.datetime)
                : Date.parse(`${date}T00:00:00Z`),
            scannerId,
            scannerName: scan.scannerName || (scannerId === assignedEmployeeId
                ? assignedEmployeeName
                : scannerId ? `Employee ${scannerId}` : null),
            beatName,
        });
        scansByHouse.set(houseId, events);
    };

    routes.forEach((route) => {
        if (!dateInWindow(route.date, fromDate, toDate)) return;
        route.collectionScans.forEach((scan) => {
            if (scan.houseId) addScan(scan.houseId, scan, route.date, null);
        });
    });

    otherBeats.forEach((otherBeat) => {
        otherBeat.routes.forEach((route) => {
            if (!dateInWindow(route.date, fromDate, toDate)) return;
            route.collectionScans.forEach((scan) => {
                const matches = scan.plateId ? selectedReferences.get(scan.plateId) || [] : [];
                if (matches.length === 1) {
                    addScan(matches[0], scan, route.date, otherBeat.beatName);
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
        if (snapshotIsInWindow && snapshotScannerId &&
            !routeEvents.some((event) =>
                event.date === snapshotDate && event.scannerId === snapshotScannerId
            )) {
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
