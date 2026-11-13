function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dateInWindow(date, fromDate, toDate) {
    if (!fromDate || !toDate) return true;
    return date >= fromDate && date <= toDate;
}

function intervalMedian(dates) {
    const intervals = dates.slice(1).map((date, index) => {
        const start = Date.parse(`${dates[index]}T00:00:00Z`);
        const end = Date.parse(`${date}T00:00:00Z`);
        return (end - start) / 86400000;
    }).filter((days) => days > 0);
    return median(intervals);
}

function collectionStatus(typicalIntervalDays, currentGapDays) {
    if (typicalIntervalDays == null || currentGapDays == null) return "Insufficient History";
    if (currentGapDays <= typicalIntervalDays) return "Regular";
    if (currentGapDays <= typicalIntervalDays * 1.5) return "Due";
    if (currentGapDays <= typicalIntervalDays * 2.5) return "Monitor";
    if (currentGapDays <= typicalIntervalDays * 4) return "Overdue";
    return "Highly Overdue";
}

function daysSince(date, toDate) {
    if (!date || !toDate) return null;
    const start = Date.parse(`${date}T00:00:00Z`);
    const end = Date.parse(`${toDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return Math.max(0, Math.floor((end - start) / 86400000));
}

export function getReportWindowDays(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    const start = Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.floor((end - start) / 86400000) + 1;
}

function haversineMeters(from, to) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(to.lat - from.lat);
    const longitudeDelta = radians(to.lon - from.lon);
    const term = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) *
        Math.sin(longitudeDelta / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

export function analyzeDailyDistance(routes) {
    const comparableRoutes = routes.filter((route) =>
        route.trackPoints.length > 0 && route.mappedHouseCount > 0
    );
    const normalDistancePerHouseKm = median(comparableRoutes.map((route) =>
        route.distanceKm / route.mappedHouseCount
    ));

    return routes.map((route) => {
        const expectedDistanceKm = normalDistancePerHouseKm == null ||
            route.mappedHouseCount === 0 || route.trackPoints.length === 0
            ? null
            : normalDistancePerHouseKm * route.mappedHouseCount;
        const extraDistanceKm = expectedDistanceKm == null
            ? null
            : Math.max(0, route.distanceKm - expectedDistanceKm);
        const extraDistancePercent = expectedDistanceKm > 0
            ? extraDistanceKm * 100 / expectedDistanceKm
            : null;
        return {
            ...route,
            expectedDistanceKm,
            extraDistanceKm,
            extraDistancePercent,
            isSignificantExtra: extraDistanceKm != null &&
                extraDistanceKm >= Math.max(2, expectedDistanceKm * 0.25),
        };
    });
}

export function analyzeDailyTime(routes) {
    const gpsDays = routes.filter((route) =>
        route.trackPoints.length > 1 &&
        Number.isFinite(route.durationMinutes) &&
        route.durationMinutes > 0
    );
    const normalTimeMinutes = median(gpsDays.map((route) => route.durationMinutes));
    return routes.map((route) => {
        const recordedTimeMinutes = route.trackPoints.length > 1 &&
            Number.isFinite(route.durationMinutes) &&
            route.durationMinutes > 0
            ? route.durationMinutes
            : null;
        const extraTimeMinutes = normalTimeMinutes == null || recordedTimeMinutes == null
            ? null
            : Math.max(0, recordedTimeMinutes - normalTimeMinutes);
        return {
            ...route,
            recordedTimeMinutes,
            normalTimeMinutes,
            extraTimeMinutes,
            isSignificantExtra: extraTimeMinutes != null &&
                extraTimeMinutes >= Math.max(60, normalTimeMinutes * 0.25),
        };
    });
}

export function findLongGpsStops(route, minimumMinutes = 30, radiusMeters = 50) {
    const points = [...route.trackPoints]
        .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.lat) && Number.isFinite(point.lon))
        .sort((a, b) => a.timestamp - b.timestamp);
    if (points.length < 2) return [];

    const stops = [];
    let start = points[0];
    let last = points[0];
    let anchor = points[0];
    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        if (haversineMeters(anchor, point) > radiusMeters) {
            const durationMinutes = (last.timestamp - start.timestamp) / 60000;
            if (durationMinutes >= minimumMinutes) {
                stops.push({
                    date: route.date,
                    start: start.datetime,
                    end: last.datetime,
                    durationMinutes,
                    lat: anchor.lat,
                    lon: anchor.lon,
                });
            }
            start = point;
            anchor = point;
        }
        last = point;
    }

    const durationMinutes = (last.timestamp - start.timestamp) / 60000;
    if (durationMinutes >= minimumMinutes) {
        stops.push({
            date: route.date,
            start: start.datetime,
            end: last.datetime,
            durationMinutes,
            lat: anchor.lat,
            lon: anchor.lon,
        });
    }
    return stops;
}

export function analyzeCollectionGaps(routes) {
    const gaps = [];
    routes.forEach((route) => {
        const scans = [...route.collectionScans]
            .map((scan) => ({scan, timestamp: Date.parse(scan.datetime)}))
            .filter((item) => Number.isFinite(item.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);
        for (let index = 1; index < scans.length; index += 1) {
            const minutes = (scans[index].timestamp - scans[index - 1].timestamp) / 60000;
            if (minutes > 0) {
                gaps.push({
                    date: route.date,
                    start: scans[index - 1].scan,
                    end: scans[index].scan,
                    minutes,
                });
            }
        }
    });
    const typicalGapMinutes = median(gaps.map((gap) => gap.minutes));
    const longGapThresholdMinutes = Math.max(60, (typicalGapMinutes || 0) * 2);
    return {
        gaps,
        typicalGapMinutes,
        longGapThresholdMinutes,
        longGaps: gaps.filter((gap) => gap.minutes > longGapThresholdMinutes),
    };
}

export function analyzeOutsideBeatCollections(routes, otherBeats, assignedEmployeeId) {
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

    routes.forEach((route) => route.collectionScans.forEach((scan) => {
        if (String(scan.scannerUserId || "") !== String(assignedEmployeeId || "")) return;
        if (scan.houseId) return;
        const matches = scan.plateId ? housesByReference.get(scan.plateId) || [] : [];
        if (matches.length !== 1) {
            unmatchedScanCount += 1;
            return;
        }
        const {beat, house} = matches[0];
        const houses = housesByBeat.get(beat.id) || new Set();
        houses.add(house.houseId);
        housesByBeat.set(beat.id, houses);
    }));

    const byBeat = [...housesByBeat.entries()].map(([beatId, houseIds]) => {
        const beat = otherBeats.find((item) => item.id === beatId);
        return {
            beatId,
            beatName: beat?.beatName || beatId,
            count: houseIds.size,
            houseIds: [...houseIds].sort(),
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
    const assignedScansByHouse = new Map();
    const selectedReferences = new Map();
    houses.forEach((house) => {
        if (!house.referenceId) return;
        const matches = selectedReferences.get(house.referenceId) || [];
        matches.push(house.houseId);
        selectedReferences.set(house.referenceId, matches);
    });
    const otherScansByHouse = new Map();
    otherBeats.forEach((otherBeat) => {
        otherBeat.routes.forEach((route) => {
            if (!dateInWindow(route.date, fromDate, toDate)) return;
            route.collectionScans.forEach((scan) => {
                const scannerId = String(scan.scannerUserId || "");
                if (!scannerId || scannerId === assignedEmployeeId) return;
                const matches = scan.plateId ? selectedReferences.get(scan.plateId) || [] : [];
                if (matches.length !== 1) return;
                const events = otherScansByHouse.get(matches[0]) || [];
                events.push({
                    date: route.date,
                    timestamp: Number.isFinite(Date.parse(scan.datetime))
                        ? Date.parse(scan.datetime)
                        : Date.parse(`${route.date}T00:00:00Z`),
                    scannerName: scan.scannerName || "Other employee (name unavailable)",
                    scannerId,
                    beatName: otherBeat.beatName,
                });
                otherScansByHouse.set(matches[0], events);
            });
        });
    });
    routes.forEach((route) => {
        if (!dateInWindow(route.date, fromDate, toDate)) return;
        route.collectionScans.forEach((scan) => {
            if (!scan.houseId) return;
            const scannerId = String(scan.scannerUserId || "");
            if (!scannerId) return;
            const scansByHouse = scannerId === assignedEmployeeId ? assignedScansByHouse : otherScansByHouse;
            const events = scansByHouse.get(scan.houseId) || [];
            events.push({
                date: route.date,
                timestamp: Number.isFinite(Date.parse(scan.datetime))
                    ? Date.parse(scan.datetime)
                    : Date.parse(`${route.date}T00:00:00Z`),
                scannerName: scan.scannerName || (scannerId === assignedEmployeeId
                    ? assignedEmployeeName
                    : "Other employee (name unavailable)"),
                scannerId,
                beatName: null,
            });
            scansByHouse.set(scan.houseId, events);
        });
    });

    const details = houses.map((house) => {
        const recordedDates = new Set((house.history.collectionDates || [])
            .filter((date) => dateInWindow(date, fromDate, toDate)));
        const assignedEvents = assignedScansByHouse.get(house.houseId) || [];
        const otherEvents = otherScansByHouse.get(house.houseId) || [];
        const assignedDates = new Set(assignedEvents.map((event) => event.date));
        const otherDates = new Set(otherEvents.map((event) => event.date));
        assignedDates.forEach((date) => recordedDates.add(date));
        otherDates.forEach((date) => recordedDates.add(date));

        const events = [...assignedEvents, ...otherEvents];
        const scanningDate = house.scanningDate;
        const snapshotDate = scanningDate?.slice(0, 10);
        const snapshotTimestamp = scanningDate ? Date.parse(scanningDate) : NaN;
        const snapshotIsInWindow = snapshotDate && dateInWindow(snapshotDate, fromDate, toDate);
        const snapshotScannerId = String(house.scannerUserId || "");
        const snapshotHasValidScanner = Boolean(snapshotIsInWindow && snapshotScannerId);
        if (snapshotHasValidScanner) {
            events.push({
                date: snapshotDate,
                timestamp: Number.isFinite(snapshotTimestamp)
                    ? snapshotTimestamp
                    : Date.parse(`${snapshotDate}T00:00:00Z`),
                scannerName: house.scannerName || (
                    snapshotScannerId === assignedEmployeeId
                        ? assignedEmployeeName
                        : "Other employee (name unavailable)"
                ),
                scannerId: snapshotScannerId,
            });
            recordedDates.add(snapshotDate);
        }

        const dates = [...recordedDates].sort();
        const latestEvent = events.filter((event) => Number.isFinite(event.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp).at(-1);
        const snapshotIsLatest = snapshotHasValidScanner &&
            (!latestEvent || snapshotTimestamp >= latestEvent.timestamp);
        const latestScannerId = snapshotIsLatest ? events.at(-1)?.scannerId : latestEvent?.scannerId;
        const lastRecordedDate = snapshotIsLatest ? snapshotDate : latestEvent?.date || dates.at(-1) || null;
        const typicalIntervalDays = intervalMedian(dates);
        const currentGapDays = toDate
            ? daysSince(lastRecordedDate, toDate)
            : house.history.currentGapDays;
        const assignedEmployeeScanCount = assignedEvents.length +
            (snapshotIsInWindow && !assignedDates.has(snapshotDate) &&
                String(house.scannerUserId || "") === assignedEmployeeId ? 1 : 0);
        const otherEmployeeScanCount = otherEvents.length +
            (snapshotHasValidScanner && !otherDates.has(snapshotDate) &&
                snapshotScannerId !== assignedEmployeeId ? 1 : 0);
        const recordedScanCount = assignedEmployeeScanCount + otherEmployeeScanCount +
            dates.filter((date) =>
                !assignedDates.has(date) &&
                !otherDates.has(date) &&
                !(snapshotIsInWindow && snapshotDate === date)
            ).length +
            (snapshotIsInWindow && !assignedDates.has(snapshotDate) && !otherDates.has(snapshotDate) &&
                !house.scannerUserId ? 1 : 0);
        const categorizedAsOwn = Boolean(latestEvent || snapshotIsInWindow) &&
            latestScannerId === assignedEmployeeId;
        const categorizedAsOther = Boolean(latestEvent || snapshotIsInWindow) &&
            latestScannerId !== assignedEmployeeId;
        const snapshotIsOther = snapshotHasValidScanner && snapshotScannerId !== assignedEmployeeId;
        const hasOtherEmployeeCollection = otherEvents.length > 0 || snapshotIsOther;
        const hasAssignedEmployeeCollection = assignedEvents.length > 0 ||
            (snapshotHasValidScanner && snapshotScannerId === assignedEmployeeId);
        const otherEmployeeCollectionRecords = [...otherEvents];
        if (snapshotIsOther && !otherDates.has(snapshotDate)) {
            otherEmployeeCollectionRecords.push({
                date: snapshotDate,
                timestamp: snapshotTimestamp,
                scannerName: house.scannerName || "Other employee (name unavailable)",
            });
        }
        const repeatedLongGaps = typicalIntervalDays == null
            ? 0
            : dates.slice(1).filter((date, index) =>
                daysSince(dates[index], date) > typicalIntervalDays * 1.5
            ).length;

        return {
            house,
            collectionDays: recordedDates.size,
            assignedEmployeeCollectionDays: assignedDates.size,
            assignedEmployeeScanCount,
            otherEmployeeCollectionDays: otherDates.size,
            otherEmployeeScanCount,
            recordedScanCount,
            collectionDates: dates,
            lastRecordedDate,
            latestScannerName: snapshotIsLatest
                ? house.scannerName || (categorizedAsOwn ? assignedEmployeeName : "Other employee (name unavailable)")
                : latestEvent?.scannerName || null,
            otherEmployeeCollectionRecords,
            latestOtherEmployeeRecord: [...otherEmployeeCollectionRecords]
                .sort((a, b) => a.timestamp - b.timestamp).at(-1) || null,
            latestScannerBeatName: latestEvent?.beatName || null,
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
    const typicalScanCount = median(details.map((detail) => detail.recordedScanCount).filter((count) => count > 0));
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
        needsAttention: details.filter((detail) => detail.status === "Needs Attention" || detail.status === "Overdue").length,
        assignedEmployeeCollected: ownCount,
        otherEmployeeCollected: otherCount,
        repeatedlyOtherEmployeeCollected: details.filter((detail) => detail.otherEmployeeCollectionDays > 1).length,
        remainingWithoutHistory: notCollectedCount,
        requiringAttention: details.filter((detail) => detail.status !== "Regular"),
    };
}

export function buildSuggestedHouses(houses, reportWindowDays, fromDate = null, toDate = null) {
    const inWindowHouses = houses.map((house) => {
        const dates = [...new Set(house.analysisCollectionDates || house.history.collectionDates || [])]
            .filter((date) => !fromDate || !toDate || dateInWindow(date, fromDate, toDate))
            .sort();
        const scanCount = Number.isFinite(house.analysisScanCount) ? house.analysisScanCount : dates.length;
        return {
            ...house,
            analysisDates: dates,
            windowCollectionCount: dates.length,
            windowScanCount: scanCount,
            windowOtherScanCount: Number.isFinite(house.analysisOtherScanCount)
                ? house.analysisOtherScanCount
                : 0,
            status: house.analysisStatus || null,
            attentionReason: house.analysisReason || null,
            analysisCurrentGapDays: Number.isFinite(house.analysisCurrentGapDays)
                ? house.analysisCurrentGapDays
                : null,
            analysisTypicalIntervalDays: Number.isFinite(house.analysisTypicalIntervalDays)
                ? house.analysisTypicalIntervalDays
                : null,
            analysisRepeatedLongGaps: Number.isFinite(house.analysisRepeatedLongGaps)
                ? house.analysisRepeatedLongGaps
                : 0,
            analysisLastRecordedDate: house.analysisLastRecordedDate || null,
        };
    });
    const typicalScanCount = median(inWindowHouses
        .map((house) => house.windowScanCount)
        .filter((count) => count > 0));

    return inWindowHouses.map((house) => {
        const dates = house.analysisDates;
        const typicalIntervalDays = house.analysisTypicalIntervalDays ?? intervalMedian(dates);
        const currentGapDays = house.analysisCurrentGapDays ?? (toDate
            ? daysSince(dates.at(-1), toDate)
            : house.history.currentGapDays);
        const repeatedLongGaps = house.analysisRepeatedLongGaps || (typicalIntervalDays == null
            ? 0
            : dates.slice(1).filter((date, index) =>
                daysSince(dates[index], date) > typicalIntervalDays * 1.5
            ).length);
        const gapRatio = typicalIntervalDays && currentGapDays != null
            ? currentGapDays / typicalIntervalDays
            : null;
        const overdue = gapRatio != null && gapRatio > 1.5;
        const unscannedThroughoutWindow = dates.length === 0 && reportWindowDays >= 7;
        const lowFrequency = typicalScanCount != null &&
            house.windowScanCount < typicalScanCount * 0.5;
        const requiresAttention = house.status
            ? house.status !== "Regular"
            : overdue || repeatedLongGaps >= 2 || unscannedThroughoutWindow || lowFrequency;

        if (!requiresAttention) return null;

        let priority = "Medium";
        if (house.status === "Not Collected" ||
            (gapRatio != null && gapRatio >= 2.5) || repeatedLongGaps >= 2 ||
            (typicalScanCount != null && house.windowScanCount === 0)) priority = "High";
        const reason = unscannedThroughoutWindow
            ? `No scan is recorded in the ${reportWindowDays}-day reporting window; prior interval is unavailable.`
            : house.attentionReason
                ? house.attentionReason
            : repeatedLongGaps >= 2
                ? `${repeatedLongGaps} historical collection gaps exceeded 1.5 times the normal interval.`
                : lowFrequency
                    ? `${house.windowScanCount} recorded scan(s), below half the typical ${formatScanCount(typicalScanCount)} in the reporting window.`
                : `${gapRatio.toFixed(1)} times the normal collection interval has elapsed.`;

        return {
            house,
            priority,
            reason,
            status: house.status || (unscannedThroughoutWindow ? "Not Collected" : overdue ? "Overdue" : "Low Frequency"),
            repeatedLongGaps,
            currentGapDays,
            typicalIntervalDays,
            attentionStatus: house.status || collectionStatus(typicalIntervalDays, currentGapDays),
            lastRecordedDate: house.analysisLastRecordedDate || dates.at(-1) || null,
            windowCollectionCount: house.windowCollectionCount,
            windowScanCount: house.windowScanCount,
            windowOtherScanCount: house.windowOtherScanCount,
            typicalScanCount,
        };
    }).filter(Boolean).sort((a, b) =>
        (b.priority === "High" ? 1 : 0) - (a.priority === "High" ? 1 : 0) ||
        (b.currentGapDays || 0) - (a.currentGapDays || 0) ||
        a.house.houseId.localeCompare(b.house.houseId)
    );
}

function formatScanCount(value) {
    return `${Number.isInteger(value) ? value : value.toFixed(1)} scans per house`;
}

function formatElapsedDays(value) {
    return `${Number.isInteger(value) ? value : value.toFixed(1)} days`;
}

export function medianValue(values) {
    return median(values);
}
