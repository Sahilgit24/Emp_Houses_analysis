function text(value) {
    return value == null ? "" : String(value).trim();
}

function firstValue(record, keys) {
    for (const key of keys) {
        if (record?.[key] != null && text(record[key]) !== "") return record[key];
    }
    return null;
}

function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = text(value).toLowerCase();
    if (["true", "1", "yes", "scanned"].includes(normalized)) return true;
    if (["false", "0", "no", "unscanned"].includes(normalized)) return false;
    return null;
}

function parseDate(value, label) {
    const dateTime = text(value);
    if (!dateTime || !Number.isFinite(Date.parse(dateTime))) {
        throw new Error(`${label} must contain a valid date or timestamp.`);
    }
    return dateTime.slice(0, 10);
}

function parseCoordinate(latitude, longitude, label) {
    if (latitude == null || longitude == null || text(latitude) === "" || text(longitude) === "") {
        throw new Error(`${label} must contain both latitude and longitude.`);
    }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
        throw new Error(`${label} contains an invalid latitude or longitude.`);
    }
    return {lat, lon};
}

function parseOptionalWeight(value, label) {
    if (value == null || text(value) === "") return null;
    const weight = Number(value);
    if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`${label} must be a non-negative number.`);
    }
    return weight;
}

function coordinateKey(point) {
    return `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`;
}

function parseGeofence(value, label) {
    if (Array.isArray(value)) {
        const polygon = value.map((point, index) => {
            if (!Array.isArray(point) || point.length < 2) {
                throw new Error(`${label} has an invalid coordinate at item ${index + 1}.`);
            }
            const {lat, lon} = parseCoordinate(point[0], point[1], `${label} item ${index + 1}`);
            return [lat, lon];
        });
        if (polygon.length < 3) throw new Error(`${label} must contain at least three coordinates.`);
        return [polygon];
    }

    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} is missing.`);
    }
    const polygons = value.split(":").map((polygonText, polygonIndex) => {
        const polygon = polygonText.split(";").map((pair, pointIndex) => {
            const parts = pair.split(",").map((part) => part.trim());
            if (parts.length !== 2) {
                throw new Error(`${label} has an invalid coordinate at polygon ${polygonIndex + 1}, point ${pointIndex + 1}.`);
            }
            const {lat, lon} = parseCoordinate(
                parts[0],
                parts[1],
                `${label} polygon ${polygonIndex + 1}, point ${pointIndex + 1}`,
            );
            return [lat, lon];
        });
        if (polygon.length < 3) {
            throw new Error(`${label} polygon ${polygonIndex + 1} must contain at least three coordinates.`);
        }
        return polygon;
    });
    return polygons;
}

function haversineDistanceKm(from, to) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(to.lat - from.lat);
    const longitudeDelta = radians(to.lon - from.lon);
    const term = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) *
        Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

function summarizeHistory(events, toDate, collectionStatus) {
    const byDate = new Map();
    events.forEach((event) => {
        const existing = byDate.get(event.date);
        if (!existing || Date.parse(event.timestamp) > Date.parse(existing.timestamp)) {
            byDate.set(event.date, event);
        }
    });
    const collectionEvents = [...byDate.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const collectionDates = collectionEvents.map((event) => event.date);
    const intervals = [];
    for (let index = 1; index < collectionDates.length; index += 1) {
        const previous = Date.parse(`${collectionDates[index - 1]}T00:00:00Z`);
        const current = Date.parse(`${collectionDates[index]}T00:00:00Z`);
        const days = Math.round((current - previous) / 86400000);
        if (days > 0) intervals.push(days);
    }
    intervals.sort((a, b) => a - b);
    const middle = Math.floor(intervals.length / 2);
    const typicalIntervalDays = intervals.length === 0 ? null
        : intervals.length % 2 === 1
            ? intervals[middle]
            : (intervals[middle - 1] + intervals[middle]) / 2;
    const lastCollectionAt = collectionEvents.at(-1)?.timestamp || null;
    const previousCollectionAt = collectionEvents.at(-2)?.timestamp || null;
    const lastDate = collectionDates.at(-1);
    const currentGapDays = lastDate && toDate
        ? Math.max(0, Math.floor(
            (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86400000,
        ))
        : null;

    let attentionStatus = "Insufficient History";
    if (typicalIntervalDays != null && currentGapDays != null) {
        if (currentGapDays <= typicalIntervalDays) attentionStatus = "Regular";
        else if (currentGapDays <= typicalIntervalDays * 1.5) attentionStatus = "Due";
        else if (currentGapDays <= typicalIntervalDays * 2.5) attentionStatus = "Monitor";
        else if (currentGapDays <= typicalIntervalDays * 4) attentionStatus = "Overdue";
        else attentionStatus = "Highly Overdue";
    }

    return {
        collectionDates,
        collectionCount: collectionDates.length,
        lastCollectionAt,
        previousCollectionAt,
        typicalIntervalDays,
        currentGapDays,
        attentionStatus,
        collectionStatus,
    };
}

function normalizeBeat(report, routeDetails, index) {
    if (!report || typeof report !== "object" || Array.isArray(report)) {
        throw new Error(`BeatWiseReport item ${index + 1} must be an object.`);
    }
    if (!routeDetails || typeof routeDetails !== "object" || Array.isArray(routeDetails)) {
        throw new Error(`RouteDetails for BeatWiseReport item ${index + 1} must be an object.`);
    }

    const ownerId = text(firstValue(report, ["BeatUserId", "beatUserId"]));
    if (!ownerId) throw new Error(`BeatWiseReport item ${index + 1} is missing BeatUserId.`);
    const beatId = text(firstValue(report, ["BeatId", "BeatID", "beatId", "BeatCode"])) ||
        `beat-user:${ownerId}`;
    const reportedName = text(firstValue(report, [
        "BeatName", "BeatLabel", "beatName", "BeatCode", "BeatId", "BeatID",
    ]));
    const fromDate = report.FromDate == null ? null : parseDate(report.FromDate, "FromDate");
    const toDate = report.ToDate == null ? null : parseDate(report.ToDate, "ToDate");

    const scannedRows = report.ScannedHouses;
    const unscannedRows = report.NotScannedHouses;
    if (scannedRows != null && !Array.isArray(scannedRows)) {
        throw new Error(`Beat ${beatId} ScannedHouses must be an array.`);
    }
    if (unscannedRows != null && !Array.isArray(unscannedRows)) {
        throw new Error(`Beat ${beatId} NotScannedHouses must be an array.`);
    }
    const sourceRows = [
        ...(scannedRows || []).map((record) => ({record, listedAsScanned: true})),
        ...(unscannedRows || []).map((record) => ({record, listedAsScanned: false})),
    ];
    if (!sourceRows.length) throw new Error(`Beat ${beatId} has no scanned or unscanned houses.`);

    const houseIds = new Set();
    const houses = sourceRows.map(({record, listedAsScanned}, rowIndex) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new Error(`Beat ${beatId} house item ${rowIndex + 1} must be an object.`);
        }
        const houseId = text(firstValue(record, ["HouseId", "houseId", "house_id"]));
        const referenceId = text(firstValue(record, [
            "ReferanceId", "ReferenceId", "referenceId", "referanceId", "reference_id",
        ]));
        if (!houseId) {
            throw new Error(`Beat ${beatId} house item ${rowIndex + 1} is missing HouseId.`);
        }
        if (houseIds.has(houseId)) throw new Error(`Beat ${beatId} has duplicate HouseId "${houseId}".`);
        houseIds.add(houseId);

        const latitude = firstValue(record, ["Lat", "lat", "Latitude", "latitude"]);
        const longitude = firstValue(record, ["Lon", "lon", "Lng", "lng", "Longitude", "longitude"]);
        const point = latitude == null && longitude == null
            ? {lat: null, lon: null}
            : parseCoordinate(latitude, longitude, `Beat ${beatId} HouseId ${houseId}`);
        const scannerUserId = text(firstValue(record, ["ScannerUserId", "scannerUserId"]));
        const scannedValue = parseBoolean(firstValue(record, ["Scanned", "scanned"]));
        const scanned = scannedValue == null ? listedAsScanned : scannedValue;
        const scanningDates = record.ScanningDates ?? record.scanningDates ?? [];
        if (!Array.isArray(scanningDates)) {
            throw new Error(`Beat ${beatId} HouseId ${houseId} ScanningDates must be an array.`);
        }
        const collectionStatus = !scanned || !scannerUserId
            ? "remaining"
            : scannerUserId === ownerId ? "own" : "other";
        const house = {
            houseId,
            house_id: houseId,
            referenceId: referenceId || null,
            reference_id: referenceId || null,
            lat: point.lat,
            lon: point.lon,
            scanned,
            scannerUserId: scannerUserId || null,
            scannerName: text(firstValue(record, ["ScannerName", "scannerName"])) || null,
            scanningDate: record.ScanningDate == null ? null : text(record.ScanningDate),
            collectionStatus,
            route_key: houseId,
            master_plate_id: referenceId || null,
            routeCoordinateKey: point.lat == null ? null : coordinateKey(point),
            isRouteHouse: false,
            historyEvents: [],
            raw: record,
        };
        const historyDates = new Set();
        [...scanningDates, record.ScanningDate].forEach((value) => {
            if (value == null || text(value) === "") return;
            const date = parseDate(value, `House ${houseId} ScanningDates`);
            if (historyDates.has(date)) return;
            historyDates.add(date);
            house.historyEvents.push({
                date,
                timestamp: text(value),
                source: "house-record-history",
                scannerUserId,
                scannerName: house.scannerName,
            });
        });
        return house;
    });

    const rawGeofence = firstValue(report, ["geofence", "Geofence", "GeoFence"]) ??
        firstValue(routeDetails, ["geofence", "Geofence", "GeoFence"]);
    const fencePolygons = parseGeofence(rawGeofence, `Beat ${beatId} geofence`);
    const fencePoints = fencePolygons[0];
    const routeHouseCoordinates = [];
    const routeCoordinateKeys = new Set();
    const coordinatesByKey = new Map();
    houses.forEach((house) => {
        if (!house.routeCoordinateKey) return;
        house.isRouteHouse = true;
        const key = house.routeCoordinateKey;
        routeCoordinateKeys.add(key);
        const coordinate = coordinatesByKey.get(key);
        if (coordinate) {
            coordinate.houseIds.push(house.houseId);
        } else {
            const routeHouseCoordinate = {
                route_key: `coordinate:${key}`,
                coordinateKey: key,
                lat: house.lat,
                lon: house.lon,
                houseIds: [house.houseId],
            };
            coordinatesByKey.set(key, routeHouseCoordinate);
            routeHouseCoordinates.push(routeHouseCoordinate);
        }
    });
    const unmatchedRouteHouseCoordinates = 0;

    const rawDumpyards = routeDetails.dumpyards ?? routeDetails.Dumpyards ?? [];
    if (!Array.isArray(rawDumpyards)) throw new Error(`Beat ${beatId} RouteDetails.dumpyards must be an array.`);
    const dumpyards = rawDumpyards.map((record, dumpyardIndex) => {
        const point = parseCoordinate(
            firstValue(record, ["lat", "Lat", "latitude", "Latitude"]),
            firstValue(record, ["lon", "Lon", "lng", "Lng", "longitude", "Longitude"]),
            `Beat ${beatId} dumpyard ${dumpyardIndex + 1}`,
        );
        return {
            ...point,
            name: text(firstValue(record, ["name", "Name", "dyId", "DyId"])) ||
                `Dumpyard ${dumpyardIndex + 1}`,
        };
    });

    const rawRoutes = routeDetails.routes ?? routeDetails.Routes ?? [];
    if (!Array.isArray(rawRoutes)) throw new Error(`Beat ${beatId} RouteDetails.routes must be an array.`);
    const routes = rawRoutes.map((record, routeIndex) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new Error(`Beat ${beatId} route item ${routeIndex + 1} must be an object.`);
        }
        const date = parseDate(record.date ?? record.Date, `Beat ${beatId} route ${routeIndex + 1} date`);
        const rawTrack = record.emproute ?? record.EmpRoute ?? record.track_points ?? record.TrackPoints ?? [];
        if (!Array.isArray(rawTrack)) throw new Error(`Beat ${beatId} route ${date} emproute must be an array.`);
        const trackPoints = rawTrack.map((point, pointIndex) => {
            const coordinate = parseCoordinate(
                firstValue(point, ["lat", "Lat", "latitude", "Latitude"]),
                firstValue(point, ["lon", "Lon", "lng", "Lng", "longitude", "Longitude"]),
                `Beat ${beatId} GPS point ${pointIndex + 1} on ${date}`,
            );
            const datetime = text(firstValue(point, ["datetime", "DateTime", "timestamp", "Timestamp"])) || date;
            if (!Number.isFinite(Date.parse(datetime))) {
                throw new Error(`Beat ${beatId} GPS point ${pointIndex + 1} on ${date} has an invalid timestamp.`);
            }
            return {...coordinate, datetime, timestamp: Date.parse(datetime)};
        }).sort((a, b) => a.timestamp - b.timestamp);

        const rawDumpEvents = record.dumplist ?? record.DumpList ?? record.dumpList ?? [];
        if (!Array.isArray(rawDumpEvents)) {
            throw new Error(`Beat ${beatId} dumplist on ${date} must be an array.`);
        }
        const dumpEvents = rawDumpEvents.map((dump, dumpIndex) => {
            if (!dump || typeof dump !== "object" || Array.isArray(dump)) {
                throw new Error(`Beat ${beatId} dump record ${dumpIndex + 1} on ${date} must be an object.`);
            }
            const datetime = text(firstValue(dump, ["datetime", "DateTime", "timestamp", "Timestamp"])) || date;
            if (!Number.isFinite(Date.parse(datetime))) {
                throw new Error(`Beat ${beatId} dump record ${dumpIndex + 1} on ${date} has an invalid timestamp.`);
            }
            const latitude = firstValue(dump, ["lat", "Lat", "latitude", "Latitude"]);
            const longitude = firstValue(dump, ["lon", "Lon", "lng", "Lng", "longitude", "Longitude"]);
            const point = latitude == null && longitude == null
                ? {lat: null, lon: null}
                : parseCoordinate(latitude, longitude, `Beat ${beatId} dump record ${dumpIndex + 1} on ${date}`);
            return {
                referenceId: text(firstValue(dump, [
                    "referanceId", "ReferanceId", "referenceId", "ReferenceId",
                ])) || null,
                datetime,
                lat: point.lat,
                lon: point.lon,
                totalGcWeight: parseOptionalWeight(
                    firstValue(dump, ["totalGcWeight", "TotalGcWeight"]),
                    `Beat ${beatId} totalGcWeight on ${date}`,
                ),
                totalWetWeight: parseOptionalWeight(
                    firstValue(dump, ["totalWetWeight", "TotalWetWeight"]),
                    `Beat ${beatId} totalWetWeight on ${date}`,
                ),
                totalDryWeight: parseOptionalWeight(
                    firstValue(dump, ["totalDryWeight", "TotalDryWeight"]),
                    `Beat ${beatId} totalDryWeight on ${date}`,
                ),
                weightUnit: text(firstValue(dump, ["weightUnit", "WeightUnit", "unit", "Unit"])) || null,
                raw: dump,
            };
        });

        let distanceKm = 0;
        for (let pointIndex = 1; pointIndex < trackPoints.length; pointIndex += 1) {
            distanceKm += haversineDistanceKm(trackPoints[pointIndex - 1], trackPoints[pointIndex]);
        }
        const firstTimestamp = trackPoints[0]?.timestamp;
        const lastTimestamp = trackPoints.at(-1)?.timestamp;
        return {
            date,
            trackPoints,
            collectionScans: [],
            dumpEvents,
            distanceKm,
            durationMinutes: firstTimestamp == null || lastTimestamp == null
                ? null
                : Math.max(0, (lastTimestamp - firstTimestamp) / 60000),
        };
    }).sort((a, b) => a.date.localeCompare(b.date));

    houses.forEach((house) => {
        house.historyEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        house.history = summarizeHistory(house.historyEvents, toDate, house.collectionStatus);
    });

    const ownerName = text(firstValue(report, [
        "BeatUserName", "BeatEmployeeName", "EmployeeName", "ScannerName",
    ])) || text(houses.find((house) =>
        house.scannerUserId === ownerId && house.scannerName,
    )?.scannerName) || `Employee ${ownerId}`;
    const classificationCounts = houses.reduce((counts, house) => {
        counts[house.collectionStatus] += 1;
        return counts;
    }, {own: 0, other: 0, remaining: 0});

    return {
        id: beatId,
        beatName: reportedName || `Beat assigned to ${ownerName}`,
        beatNameAvailable: Boolean(reportedName),
        beatUserId: ownerId,
        assignedEmployee: {id: ownerId, name: ownerName},
        fromDate,
        toDate,
        reportedTotalHouses: Number.isFinite(Number(report.TotalHouses)) ? Number(report.TotalHouses) : null,
        totalHouses: houses.length,
        totalScannedHouses: Number.isFinite(Number(report.TotalScannedHouses))
            ? Number(report.TotalScannedHouses)
            : houses.filter((house) => house.scanned).length,
        totalNotScannedHouses: Number.isFinite(Number(report.TotalNotScannedHouses))
            ? Number(report.TotalNotScannedHouses)
            : houses.filter((house) => !house.scanned).length,
        classificationCounts,
        geofence: rawGeofence,
        fencePoints,
        fencePolygons,
        houses,
        routeHouseCoordinates,
        routeCoordinateKeys: [...routeCoordinateKeys],
        unmatchedRouteHouseCoordinates,
        dumpyards,
        routes,
        hasHouseIds: houses.every((house) => Boolean(house.houseId)),
        historyWarnings: {unmatchedCollectionRecords: 0, ambiguousReferenceRecords: 0},
        raw: report,
    };
}

export function normalizeBeatApiPayload(payload, sourceName = "API file") {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(`${sourceName} must contain a JSON object.`);
    }
    const sourceReports = payload.BeatWiseReport ?? payload.beatWiseReport;
    const reports = Array.isArray(sourceReports) ? sourceReports : [sourceReports];
    if (!reports.length || reports.some((report) => !report)) {
        throw new Error(`${sourceName} must contain BeatWiseReport data.`);
    }

    const beats = reports.map((report, index) => {
        let routeDetails = report.RouteDetails ?? report.routeDetails;
        if (routeDetails == null) {
            const rootRoutes = payload.RouteDetails ?? payload.routeDetails;
            if (Array.isArray(rootRoutes)) routeDetails = rootRoutes[index];
            else if (reports.length === 1) routeDetails = rootRoutes;
        }
        return normalizeBeat(report, routeDetails, index);
    });
    const beatIds = new Set();
    for (const beat of beats) {
        if (beatIds.has(beat.id)) {
            throw new Error(`Multiple BeatWiseReport records use Beat ID "${beat.id}". Provide a unique BeatId for each Beat.`);
        }
        beatIds.add(beat.id);
    }
    return {beats, raw: payload, sourceName};
}

export function combineNormalizedBeatData(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
        throw new Error("At least one normalized Beat API file is required.");
    }

    const beats = [];
    const beatSources = new Map();
    for (const source of sources) {
        if (!source || !Array.isArray(source.beats) || typeof source.sourceName !== "string") {
            throw new Error("Cannot combine invalid normalized Beat API data.");
        }
        for (const beat of source.beats) {
            if (beatSources.has(beat.id)) {
                const existingSource = beatSources.get(beat.id);
                throw new Error(
                    `Beat ID "${beat.id}" appears in both "${existingSource}" and "${source.sourceName}". ` +
                    "Upload each Beat once, or give separate Beats distinct Beat IDs.",
                );
            }
            beatSources.set(beat.id, source.sourceName);
            beats.push(beat);
        }
    }

    return {
        beats,
        raw: sources.map((source) => source.raw),
        sourceName: sources.map((source) => source.sourceName).join(", "),
    };
}
