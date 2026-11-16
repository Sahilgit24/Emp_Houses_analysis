import React, {useMemo, useRef, useState} from "react";
import L from "leaflet";
import {MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap} from "react-leaflet";
import {API_URL} from "@/config.js";
import {
    analyzeHouseCoverage,
    getHighPriorityHouses,
    getReportWindowDays,
} from "@/data/employeePerformance.js";
import {isInsidePolygon} from "@/data/routeBeatData.js";

const startIcon = L.icon({
    iconUrl: "/house-icons/start.jpeg",
    iconSize: [32, 45],
    iconAnchor: [16, 44],
    popupAnchor: [0, -42],
});
const endIcon = L.icon({
    iconUrl: "/house-icons/end.jpeg",
    iconSize: [32, 45],
    iconAnchor: [16, 44],
    popupAnchor: [0, -42],
});
const dumpyardIcon = L.icon({
    iconUrl: "/house-icons/dumpyard.jpeg",
    iconSize: [32, 45],
    iconAnchor: [16, 44],
    popupAnchor: [0, -42],
});
const playbackVehicleIcon = L.divIcon({
    className: "",
    html: '<div style="font-size:24px;line-height:28px;text-shadow:0 1px 3px #fff" title="Optimized route position">🚛</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 24],
});
const ALL_EMPLOYEES = "__all_employees__";
const EMPLOYEE_ROUTE_COLORS = [
    "#2563eb", "#ea580c", "#9333ea", "#0891b2", "#16a34a", "#db2777",
    "#ca8a04", "#4f46e5", "#0f766e", "#c026d3", "#be123c", "#475569",
];
const HOUSE_STATUS_STYLES = {
    own: {
        label: "Collected by assigned employee",
        icon: "/house-icons/collected-by-me.jpeg",
    },
    other: {
        label: "Collected by another employee",
        icon: "/house-icons/collected-by-others.jpeg",
    },
    attention: {
        label: "High-priority house",
        icon: "/house-icons/needs-attention.jpeg",
    },
    remaining: {
        label: "No collection recorded",
        icon: "/house-icons/not-collected.jpeg",
    },
};

function getRoutePosition(routePath, progress) {
    if (!routePath?.length) return null;
    if (routePath.length === 1 || progress <= 0) return [routePath[0].lat, routePath[0].lon];

    const segmentLengths = [];
    let totalLength = 0;
    for (let index = 1; index < routePath.length; index += 1) {
        const previous = routePath[index - 1];
        const current = routePath[index];
        const latDistance = (current.lat - previous.lat) * 111320;
        const lonDistance = (current.lon - previous.lon) * 111320 *
            Math.cos((previous.lat + current.lat) * Math.PI / 360);
        const segmentLength = Math.hypot(latDistance, lonDistance);
        segmentLengths.push(segmentLength);
        totalLength += segmentLength;
    }

    let remainingDistance = totalLength * progress;
    for (let index = 0; index < segmentLengths.length; index += 1) {
        const segmentLength = segmentLengths[index];
        if (remainingDistance <= segmentLength || index === segmentLengths.length - 1) {
            const fraction = segmentLength === 0 ? 0 : Math.min(1, remainingDistance / segmentLength);
            const from = routePath[index];
            const to = routePath[index + 1];
            return [
                from.lat + (to.lat - from.lat) * fraction,
                from.lon + (to.lon - from.lon) * fraction,
            ];
        }
        remainingDistance -= segmentLength;
    }
    const lastPoint = routePath[routePath.length - 1];
    return [lastPoint.lat, lastPoint.lon];
}

function distanceFromRouteMeters(point, routePath) {
    if (!routePath?.length) return null;
    let minimum = Infinity;
    for (let index = 0; index < routePath.length; index += 1) {
        const from = routePath[index];
        const to = routePath[Math.min(index + 1, routePath.length - 1)];
        minimum = Math.min(minimum, distanceFromRouteSegmentMeters(point, from, to));
    }
    return minimum;
}

function distanceFromRouteSegmentMeters(point, from, to) {
    const metersPerDegree = 111320;
    const cosLatitude = Math.cos(point.lat * Math.PI / 180);
    const fromX = (from.lon - point.lon) * metersPerDegree * cosLatitude;
    const fromY = (from.lat - point.lat) * metersPerDegree;
    const toX = (to.lon - point.lon) * metersPerDegree * cosLatitude;
    const toY = (to.lat - point.lat) * metersPerDegree;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, -(fromX * dx + fromY * dy) / lengthSquared));
    return Math.hypot(fromX + fraction * dx, fromY + fraction * dy);
}

function createRouteSegmentIndex(routePath, maximumDistanceMeters) {
    if (!routePath?.length) return null;
    const origin = routePath[Math.floor(routePath.length / 2)];
    const metersPerDegree = 111320;
    const longitudeScale = metersPerDegree * Math.cos(origin.lat * Math.PI / 180);
    const cellSize = Math.max(100, maximumDistanceMeters * 2);
    const padding = maximumDistanceMeters + cellSize;
    const cells = new Map();
    const globalSegments = [];
    const segments = routePath.length === 1
        ? [{from: routePath[0], to: routePath[0]}]
        : routePath.slice(1).map((to, index) => ({from: routePath[index], to}));

    const project = (point) => ({
        x: (point.lon - origin.lon) * longitudeScale,
        y: (point.lat - origin.lat) * metersPerDegree,
    });
    const cellKey = (x, y) => `${x}:${y}`;
    for (const segment of segments) {
        const from = project(segment.from);
        const to = project(segment.to);
        const minX = Math.floor((Math.min(from.x, to.x) - padding) / cellSize);
        const maxX = Math.floor((Math.max(from.x, to.x) + padding) / cellSize);
        const minY = Math.floor((Math.min(from.y, to.y) - padding) / cellSize);
        const maxY = Math.floor((Math.max(from.y, to.y) + padding) / cellSize);
        if ((maxX - minX + 1) * (maxY - minY + 1) > 256) {
            globalSegments.push(segment);
            continue;
        }
        for (let x = minX; x <= maxX; x += 1) {
            for (let y = minY; y <= maxY; y += 1) {
                const key = cellKey(x, y);
                const nearby = cells.get(key) || [];
                nearby.push(segment);
                cells.set(key, nearby);
            }
        }
    }

    return {cells, cellKey, cellSize, globalSegments, project};
}

function distanceFromRouteIndexMeters(point, index) {
    if (!index) return Infinity;
    const projected = index.project(point);
    const key = index.cellKey(
        Math.floor(projected.x / index.cellSize),
        Math.floor(projected.y / index.cellSize),
    );
    let minimum = Infinity;
    for (const segment of index.globalSegments) {
        minimum = Math.min(minimum, distanceFromRouteSegmentMeters(point, segment.from, segment.to));
    }
    for (const segment of index.cells.get(key) || []) {
        minimum = Math.min(minimum, distanceFromRouteSegmentMeters(point, segment.from, segment.to));
    }
    return minimum;
}

function getOutsideBeatSections(routePath, polygon) {
    const polygons = Array.isArray(polygon?.[0]?.[0]) ? polygon : [polygon];
    if (!routePath?.length || !polygons.some((item) => item?.length >= 3)) {
        return {sections: [], distanceKm: 0};
    }

    const sections = [];
    let activeSection = null;
    let distanceMeters = 0;
    const closeSection = () => {
        if (activeSection?.length > 1) sections.push(activeSection);
        activeSection = null;
    };

    for (let index = 1; index < routePath.length; index += 1) {
        const from = routePath[index - 1];
        const to = routePath[index];
        const midpointLatitude = (from.lat + to.lat) / 2;
        const dx = (to.lon - from.lon) * 111320 * Math.cos(midpointLatitude * Math.PI / 180);
        const dy = (to.lat - from.lat) * 111320;
        const segmentLength = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(segmentLength / 25));

        for (let step = 0; step < steps; step += 1) {
            const startFraction = step / steps;
            const endFraction = (step + 1) / steps;
            const start = {
                lat: from.lat + (to.lat - from.lat) * startFraction,
                lon: from.lon + (to.lon - from.lon) * startFraction,
            };
            const end = {
                lat: from.lat + (to.lat - from.lat) * endFraction,
                lon: from.lon + (to.lon - from.lon) * endFraction,
            };
            const midpoint = {
                lat: (start.lat + end.lat) / 2,
                lon: (start.lon + end.lon) / 2,
            };
            if (!polygons.some((item) => isInsidePolygon(midpoint, item))) {
                if (!activeSection) activeSection = [start];
                activeSection.push(end);
                distanceMeters += segmentLength / steps;
            } else {
                closeSection();
            }
        }
    }
    closeSection();

    return {sections, distanceKm: distanceMeters / 1000};
}

function getCollectedHouseIds(beat, day) {
    if (!beat?.hasHouseIds || !day) return new Set();
    const scannedHouseIds = new Set(day.collectionScans.map((scan) => scan.houseId).filter(Boolean));
    const scannedPlateIds = new Set(day.collectionScans.map((scan) => scan.plateId).filter(Boolean));
    return new Set(beat.houses
        .filter((house) => scannedHouseIds.has(house.house_id) ||
            scannedPlateIds.has(house.house_id) ||
            (house.master_plate_id && scannedPlateIds.has(house.master_plate_id)) ||
            house.history?.collectionDates?.includes(day.date))
        .map((house) => house.house_id));
}

function getHouseCollectionStatusForDate(house, date, assignedEmployeeId) {
    if (!house?.history?.collectionDates?.includes(date)) return "remaining";
    const scannerUserId = String(house.scannerUserId || "");
    if (!scannerUserId) return "remaining";
    return scannerUserId === String(assignedEmployeeId || "") ? "own" : "other";
}

function sampleTrackPoints(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    return Array.from({length: maxPoints}, (_, index) =>
        points[Math.round(index * (points.length - 1) / (maxPoints - 1))]
    );
}

function createHousePopup(lines) {
    const content = document.createElement("div");
    lines.forEach((line, index) => {
        if (index > 0) content.append(document.createElement("br"));
        content.append(document.createTextNode(line));
    });
    return content;
}

function CanvasHouseLayer({data, historicalPath, nearRouteThreshold, onHouseSelect}) {
    const map = useMap();
    const onHouseSelectRef = useRef(onHouseSelect);
    const historicalPathRef = useRef(historicalPath);
    const nearRouteThresholdRef = useRef(nearRouteThreshold);
    onHouseSelectRef.current = onHouseSelect;
    historicalPathRef.current = historicalPath;
    nearRouteThresholdRef.current = nearRouteThreshold;

    React.useEffect(() => {
        if (!data.features.length) return undefined;
        const canvas = L.DomUtil.create("canvas", "leaflet-house-canvas leaflet-zoom-animated");
        canvas.style.position = "absolute";
        canvas.style.pointerEvents = "none";
        map.getPanes().overlayPane.appendChild(canvas);
        const context = canvas.getContext("2d");
        if (!context) {
            L.DomUtil.remove(canvas);
            throw new Error("Could not create the map house-marker canvas.");
        }

        let isActive = true;
        const statusIcons = {
            own: new Image(),
            other: new Image(),
            attention: new Image(),
            remaining: new Image(),
        };

        const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
        const draw = () => {
            const size = map.getSize();
            const topLeft = map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(canvas, topLeft);
            canvas.width = size.x * pixelRatio;
            canvas.height = size.y * pixelRatio;
            canvas.style.width = `${size.x}px`;
            canvas.style.height = `${size.y}px`;
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            context.clearRect(0, 0, size.x, size.y);
            for (const feature of data.features) {
                const {
                    house,
                    statusIcon,
                } = feature.properties;
                const point = map.latLngToLayerPoint([house.lat, house.lon]).subtract(topLeft);
                const statusImage = statusIcons[statusIcon];
                const hasStatusImage = statusImage?.complete && statusImage.naturalWidth > 0;
                const iconWidth = 24;
                const iconHeight = 34;
                if (point.x < -iconHeight || point.y < -iconHeight || point.x > size.x + iconHeight || point.y > size.y + iconHeight) continue;
                if (!hasStatusImage) continue;
                context.drawImage(
                    statusImage,
                    point.x - iconWidth / 2,
                    point.y - iconHeight,
                    iconWidth,
                    iconHeight,
                );
            }
        };
        Object.entries(statusIcons).forEach(([status, image]) => {
            const style = HOUSE_STATUS_STYLES[status];
            image.onload = () => {
                if (isActive) draw();
            };
            image.onerror = () => {
                console.error(`Could not load the ${style.label} map icon at ${style.icon}.`);
            };
            image.src = style.icon;
        });
        Object.values(statusIcons).forEach((image) => {
            if (image.complete && image.naturalWidth > 0) draw();
        });
        const handleClick = (event) => {
            const clickPoint = map.latLngToContainerPoint(event.latlng);
            let nearestFeature = null;
            let nearestDistanceSquared = 18 * 18;
            for (const feature of data.features) {
                const {house} = feature.properties;
                const housePoint = map.latLngToContainerPoint([house.lat, house.lon]);
                const dx = clickPoint.x - housePoint.x;
                const dy = clickPoint.y - housePoint.y;
                const distanceSquared = dx * dx + dy * dy;
                if (distanceSquared < nearestDistanceSquared) {
                    nearestFeature = feature;
                    nearestDistanceSquared = distanceSquared;
                }
            }
            if (!nearestFeature) return;
            const {house, beat, hasBeatDetails, popupLines} = nearestFeature.properties;
            const lines = [...popupLines];
            if (hasBeatDetails) {
                const historicalDistance = distanceFromRouteMeters(house, historicalPathRef.current);
                lines.push(
                    Number.isFinite(historicalDistance) && historicalDistance <= nearRouteThresholdRef.current
                        ? `Within ${nearRouteThresholdRef.current} m of the selected day's GPS track (${Math.round(historicalDistance)} m away)`
                        : `Outside the ${nearRouteThresholdRef.current} m selected-route corridor`,
                    "GPS or route proximity does not confirm collection.",
                );
            }
            onHouseSelectRef.current(house, beat);
            map.openPopup(createHousePopup(lines), [house.lat, house.lon]);
        };

        map.on("moveend zoomend resize", draw);
        map.on("click", handleClick);
        draw();
        return () => {
            isActive = false;
            map.off("moveend zoomend resize", draw);
            map.off("click", handleClick);
            L.DomUtil.remove(canvas);
        };
    }, [data, map]);

    return null;
}

function FitMapBounds({points, visible, layoutKey, focusHouse}) {
    const map = useMap();
    const focusHouseRef = useRef(focusHouse);
    focusHouseRef.current = focusHouse;
    React.useEffect(() => {
        if (!visible || points.length === 0) return undefined;
        const frame = requestAnimationFrame(() => {
            map.invalidateSize();
            if (!focusHouseRef.current) {
                const firstPoint = points[0];
                const pointsShareLocation = points.every((point) =>
                    point[0] === firstPoint[0] && point[1] === firstPoint[1]
                );
                if (pointsShareLocation) map.setView(firstPoint, Math.max(map.getZoom(), 17));
                else map.fitBounds(points, {padding: [28, 28]});
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [map, points, visible, layoutKey]);
    return null;
}

function FocusHouse({house}) {
    const map = useMap();
    React.useEffect(() => {
        if (!house || house.lat == null || house.lon == null) return;
        const frame = requestAnimationFrame(() => {
            map.flyTo([house.lat, house.lon], Math.max(map.getZoom(), 18), {duration: 0.35});
        });
        return () => cancelAnimationFrame(frame);
    }, [house, map]);
    return null;
}

function formatDuration(minutes) {
    const totalMinutes = Math.round(Number(minutes) || 0);
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

function BeatRouteMap({
    beat,
    boundaryBeats,
    allBeats = [],
    employeeRouteLayers,
    showAllEmployeeHouses,
    routes,
    selectedRouteId,
    recordedRoute,
    trackPoints,
    layer,
    visible,
    selectedDate,
    nearRouteThreshold,
    coveredHouseIds,
    showCollectedOnly,
    showHighPriorityOnly,
    highPriorityHouseIds,
    collectionMappingAvailable,
    isMapMaximized,
    onHouseSelect,
    optimizationCandidateHouseIds,
    focusHouse,
}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackType, setPlaybackType] = useState("historical");
    const [progress, setProgress] = useState(0);
    const progressRef = useRef(0);
    const selectedRoute = routes.find((route) => route.route_id === selectedRouteId);
    const stops = useMemo(
        () => selectedRoute?.stops || routes[0]?.stops || [],
        [routes, selectedRoute],
    );
    const recordedRouteColor = employeeRouteLayers.length === 1
        ? employeeRouteLayers[0].color
        : "#0f766e";
    const plannedHouseKeys = useMemo(
        () => new Set(stops.filter((stop) => stop.type === "house").map((stop) => stop.house_id)),
        [stops],
    );
    const visibleHouses = useMemo(
        () => (beat?.houses || []).filter((house) =>
            house.lat != null && house.lon != null &&
            (!showHighPriorityOnly || highPriorityHouseIds.has(house.house_id)) &&
            (!showCollectedOnly || coveredHouseIds.has(house.house_id))
        ),
        [beat, coveredHouseIds, highPriorityHouseIds, showCollectedOnly, showHighPriorityOnly],
    );
    const houseEntries = useMemo(() => beat
        ? visibleHouses.map((house) => ({house, beat}))
        : showAllEmployeeHouses
            ? boundaryBeats.flatMap((boundary) => (boundary.houses || [])
                .filter((house) => Number.isFinite(house.lat) && Number.isFinite(house.lon))
                .map((house) => ({house, beat: boundary})))
            : [],
    [beat, boundaryBeats, showAllEmployeeHouses, visibleHouses]);
    const attentionDetailsByBeat = useMemo(() => {
        const beatsInScope = beat ? [beat] : boundaryBeats;
        return new Map(beatsInScope.map((item) => {
            const otherBeats = allBeats.filter((otherBeat) => otherBeat.id !== item.id);
            const coverage = analyzeHouseCoverage(
                item.houses || [],
                item.routes || [],
                item.fromDate,
                item.toDate,
                item.assignedEmployee,
                otherBeats,
            );
            return [item.id, new Map(coverage.requiringAttention.map((detail) => [
                detail.house.houseId,
                detail,
            ]))];
        }));
    }, [allBeats, beat, boundaryBeats]);
    const historicalPath = useMemo(() => recordedRoute?.route_path?.length
            ? recordedRoute.route_path
            : trackPoints,
        [recordedRoute, trackPoints],
    );
    const displayHistoricalPath = useMemo(
        () => sampleTrackPoints(historicalPath, 5000),
        [historicalPath],
    );
    const historicalOutsideBeat = useMemo(
        () => getOutsideBeatSections(displayHistoricalPath, beat?.fencePolygons || beat?.fencePoints),
        [displayHistoricalPath, beat],
    );
    const optimizedOutsideBeat = useMemo(
        () => getOutsideBeatSections(selectedRoute?.route_path, beat?.fencePolygons || beat?.fencePoints),
        [selectedRoute, beat],
    );
    const playbackPath = playbackType === "historical" ? historicalPath : selectedRoute?.route_path || [];
    const houseFeatureData = useMemo(() => ({
        type: "FeatureCollection",
        features: houseEntries.map(({house, beat: houseBeat}) => {
            const collectionStatus = selectedDate
                ? getHouseCollectionStatusForDate(
                    house,
                    selectedDate,
                    houseBeat.assignedEmployee?.id || houseBeat.beatUserId,
                )
                : house.collectionStatus;
            const categoryColor = HOUSE_STATUS_STYLES[collectionStatus];
            const attentionDetail = attentionDetailsByBeat.get(houseBeat.id)?.get(house.house_id);
            const includedInPlan = plannedHouseKeys.has(house.route_key);
            const collectedToday = house.house_id != null && coveredHouseIds.has(house.house_id);
            const isOptimizationCandidate = optimizationCandidateHouseIds.has(house.house_id);
            const popupLines = beat
                ? [
                    house.house_id
                        ? `House ID: ${house.house_id}`
                        : "House ID unavailable; coordinate-only candidate",
                    `${house.lat.toFixed(6)}, ${house.lon.toFixed(6)}`,
                    `Status on ${selectedDate}: ${categoryColor.label}`,
                    ...(attentionDetail
                        ? [`Collection attention: ${attentionDetail.attentionReason}`]
                        : []),
                    `Scanner: ${house.scannerName || "Unavailable"} (${house.scannerUserId || "ID unavailable"})`,
                    `Scanning date: ${house.scanningDate || "Not recorded"}`,
                    collectionMappingAvailable
                        ? collectedToday
                            ? "Collection record linked to the selected route date"
                            : "No linked collection record for the selected route date"
                        : "Selected-day collection history unavailable",
                    includedInPlan
                        ? "Included in the recommended route (planned, not confirmed collected)"
                        : "Not included in the recommended route",
                    ...(house.master_plate_id ? [`Master plate: ${house.master_plate_id}`] : []),
                    isOptimizationCandidate
                        ? "Eligible remaining house within the route corridor"
                        : "Not currently eligible for route optimization",
                ]
                : [
                    `Beat: ${houseBeat.beatName}`,
                    house.house_id ? `House ID: ${house.house_id}` : "House ID unavailable",
                    `Status on ${selectedDate}: ${categoryColor.label}`,
                    ...(attentionDetail
                        ? [`Collection attention: ${attentionDetail.attentionReason}`]
                        : []),
                    `Scanner: ${house.scannerName || "Unavailable"} (${house.scannerUserId || "ID unavailable"})`,
                    `Scanning date: ${house.scanningDate || "Not recorded"}`,
                    `${house.lat.toFixed(6)}, ${house.lon.toFixed(6)}`,
                ];
            return {
                type: "Feature",
                geometry: {type: "Point", coordinates: [house.lon, house.lat]},
                properties: {
                    house,
                    beat: houseBeat,
                    hasBeatDetails: Boolean(beat),
                    popupLines,
                    statusIcon: showHighPriorityOnly && highPriorityHouseIds.has(house.house_id)
                        ? "attention"
                        : collectionStatus,
                },
            };
        }),
    }), [
        beat,
        attentionDetailsByBeat,
        collectionMappingAvailable,
        coveredHouseIds,
        highPriorityHouseIds,
        houseEntries,
        optimizationCandidateHouseIds,
        plannedHouseKeys,
        selectedDate,
        showHighPriorityOnly,
    ]);
    const vehiclePosition = getRoutePosition(playbackPath, progress);
    const bounds = useMemo(() => {
        const housePoints = houseEntries.map(({house}) => [house.lat, house.lon]);
        if (showHighPriorityOnly) return housePoints;
        const pathPoints = sampleTrackPoints(selectedRoute?.route_path || [], 2000)
            .map((point) => [point.lat, point.lon]);
        const recordedPathPoints = sampleTrackPoints(recordedRoute?.route_path?.length
            ? recordedRoute.route_path
            : trackPoints, 2000).map((point) => [point.lat, point.lon]);
        const dumpyardPoints = (beat?.dumpyards || []).map((dumpyard) => [dumpyard.lat, dumpyard.lon]);
        const endpoints = stops.filter((stop) => stop.type !== "house").map((stop) => [stop.lat, stop.lon]);
        const fencePoints = boundaryBeats.flatMap((boundary) =>
            (boundary.fencePolygons || [boundary.fencePoints || []]).flat()
        );
        const optimizerFencePoints = boundaryBeats.flatMap((boundary) =>
            (boundary.optimizerFencePolygons || []).flat()
        );
        const employeePoints = employeeRouteLayers.flatMap((item) =>
            sampleTrackPoints(item.trackPoints, 1000).map((point) => [point.lat, point.lon])
        );
        return [...pathPoints, ...recordedPathPoints, ...housePoints, ...dumpyardPoints, ...endpoints, ...fencePoints, ...optimizerFencePoints, ...employeePoints];
    }, [beat, boundaryBeats, employeeRouteLayers, houseEntries, recordedRoute, selectedRoute, showHighPriorityOnly, stops, trackPoints]);
    const center = bounds[0] || [0, 0];
    const tileUrl = layer === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const routeColors = ["#2563eb", "#ea580c", "#9333ea", "#0891b2"];

    React.useEffect(() => {
        progressRef.current = 0;
        setProgress(0);
        setIsPlaying(false);
    }, [selectedRouteId, trackPoints]);

    React.useEffect(() => {
        if (!isPlaying || playbackPath.length < 2) return undefined;
        const playbackDuration = 30000;
        const startedAt = performance.now() - progressRef.current * playbackDuration;
        let frameId;
        const updateProgress = (now) => {
            const nextProgress = Math.min(1, (now - startedAt) / playbackDuration);
            progressRef.current = nextProgress;
            setProgress(nextProgress);
            if (nextProgress >= 1) {
                setIsPlaying(false);
                return;
            }
            frameId = requestAnimationFrame(updateProgress);
        };
        frameId = requestAnimationFrame(updateProgress);
        return () => cancelAnimationFrame(frameId);
    }, [isPlaying, playbackPath]);

    return (
        <div className="relative h-full w-full">
        <MapContainer center={center} zoom={13} className="h-full w-full">
            <TileLayer
                attribution={layer === "satellite"
                    ? "Tiles &copy; Esri"
                    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
                url={tileUrl}
            />
            <FitMapBounds points={bounds} visible={visible} layoutKey={isMapMaximized} focusHouse={focusHouse}/>
            <FocusHouse house={focusHouse}/>
            {boundaryBeats.flatMap((boundary) =>
                (boundary.fencePolygons || [boundary.fencePoints || []]).map((polygon, index) =>
                    {
                        const selectedBeat = employeeRouteLayers.find((item) =>
                            item.employee.beatId?.toLowerCase() === boundary.id.toLowerCase()
                        );
                        return polygon.length > 2 && (
                            <Polygon
                                key={`${boundary.id}-excel-boundary-${index}`}
                                positions={polygon}
                                pathOptions={{
                                    color: boundary.employeeColor || selectedBeat?.color || "#dc2626",
                                    weight: selectedBeat ? 5 : 2,
                                    fillColor: boundary.employeeColor || selectedBeat?.color || "#dc2626",
                                    fillOpacity: selectedBeat ? 0.14 : 0.01,
                                }}
                            />
                        );
                    }
                )
            )}
            {boundaryBeats.flatMap((boundary) =>
                (boundary.optimizerFencePolygons || []).map((polygon, index) =>
                    polygon.length > 2 && (
                        <Polygon
                            key={`${boundary.id}-employee-file-boundary-${index}`}
                            positions={polygon}
                            pathOptions={{
                                color: boundary.employeeColor || employeeRouteLayers.find((item) =>
                                    item.employee.beatId?.toLowerCase() === boundary.id.toLowerCase()
                                )?.color || "#2563eb",
                                weight: 2,
                                fillOpacity: 0.02,
                                dashArray: "7 5",
                            }}
                        />
                    )
                )
            )}
            {employeeRouteLayers.map(({employee, trackPoints, color}) => {
                const routeLinePoints = sampleTrackPoints(trackPoints, 2000);
                return (
                    <React.Fragment key={`employee-route-${employee.id}`}>
                    {routeLinePoints.length > 1 && (
                        <Polyline
                            positions={routeLinePoints.map((point) => [point.lat, point.lon])}
                            pathOptions={{color, weight: 3, opacity: 0.75, dashArray: "6 5"}}
                        >
                            <Popup>{employee.name} ({employee.id}) · GPS route for {trackPoints[0].datetime?.slice(0, 10) || "selected date"}</Popup>
                        </Polyline>
                    )}
                    {trackPoints.length > 0 && !selectedRoute?.route_path?.length && (
                        <>
                            <Marker position={[trackPoints[0].lat, trackPoints[0].lon]} icon={startIcon}>
                                <Popup>{employee.name} ({employee.id}) · route start</Popup>
                            </Marker>
                            <Marker position={[trackPoints[trackPoints.length - 1].lat, trackPoints[trackPoints.length - 1].lon]} icon={endIcon}>
                                <Popup>{employee.name} ({employee.id}) · latest route point</Popup>
                            </Marker>
                        </>
                    )}
                    </React.Fragment>
                );
            })}
            {recordedRoute?.route_path?.length > 1 && (
                <>
                    <Polyline
                        positions={recordedRoute.route_path.map((point) => [point.lat, point.lon])}
                        pathOptions={{color: "#fff", weight: 8, opacity: 0.9}}
                    />
                    <Polyline
                        positions={recordedRoute.route_path.map((point) => [point.lat, point.lon])}
                        pathOptions={{color: recordedRouteColor, weight: 4, opacity: 0.9, dashArray: "8 5"}}
                    >
                        <Popup>
                            Recorded vehicle trip, road-matched through {recordedRoute.point_count} timestamped GPS points.
                            <br/>
                            {recordedRoute.provider} road geometry
                        </Popup>
                    </Polyline>
                </>
            )}
            {!recordedRoute?.route_path?.length && trackPoints.length > 1 && employeeRouteLayers.length === 0 && (
                <Polyline
                    positions={sampleTrackPoints(trackPoints, 2000).map((point) => [point.lat, point.lon])}
                    pathOptions={{color: "#0f766e", weight: 4, opacity: 0.9, dashArray: "5 5"}}
                >
                    <Popup>
                        Recorded GPS points joined in timestamp order. This is a direct GPS line, not road-matched geometry.
                    </Popup>
                </Polyline>
            )}
            {historicalOutsideBeat.sections.map((section, index) => (
                <Polyline
                    key={`historical-outside-${index}`}
                    positions={section.map((point) => [point.lat, point.lon])}
                    pathOptions={{color: "#dc2626", weight: 7, opacity: 0.9}}
                >
                    <Popup>Historical road section outside the beat boundary (sampled estimate).</Popup>
                </Polyline>
            ))}
            {optimizedOutsideBeat.sections.map((section, index) => (
                <Polyline
                    key={`optimized-outside-${index}`}
                    positions={section.map((point) => [point.lat, point.lon])}
                    pathOptions={{color: "#7c3aed", weight: 8, opacity: 0.95}}
                >
                    <Popup>Optimized road section outside the beat boundary (sampled estimate).</Popup>
                </Polyline>
            ))}
            {selectedRoute?.route_path?.length > 1 && (
                <Polyline
                    positions={selectedRoute.route_path.map((point) => [point.lat, point.lon])}
                    pathOptions={{
                        color: routeColors[Math.max(0, routes.indexOf(selectedRoute)) % routeColors.length],
                        weight: 5,
                        opacity: 0.9,
                    }}
                />
            )}
            {vehiclePosition && playbackPath.length > 1 && (
                <Marker position={vehiclePosition} icon={playbackVehicleIcon} zIndexOffset={1000}>
                    <Popup>{playbackType === "historical" ? "Preview position along the selected day's historical route" : "Preview position along the optimized route"}</Popup>
                </Marker>
            )}
            {stops.filter((stop) =>
                stop.type === "house" && Number.isFinite(stop.road_lat) && Number.isFinite(stop.road_lon)
            ).map((stop) => (
                <Polyline
                    key={`house-access-${stop.sequence}`}
                    positions={[[stop.road_lat, stop.road_lon], [stop.lat, stop.lon]]}
                    pathOptions={{color: "#f97316", weight: 2, opacity: 0.75, dashArray: "3 4"}}
                />
            ))}
            {houseFeatureData.features.length > 0 && (
                <CanvasHouseLayer
                    data={houseFeatureData}
                    historicalPath={historicalPath}
                    nearRouteThreshold={nearRouteThreshold}
                    onHouseSelect={onHouseSelect}
                />
            )}
            {(beat?.dumpyards || []).map((dumpyard, index) => (
                <Marker key={`dumpyard-${index}`} position={[dumpyard.lat, dumpyard.lon]} icon={dumpyardIcon}>
                    <Popup>{dumpyard.name}<br/>{dumpyard.lat.toFixed(6)}, {dumpyard.lon.toFixed(6)}<br/>Reference location, not a route stop.</Popup>
                </Marker>
            ))}
            {stops.filter((stop) => stop.type !== "house").map((stop) => (
                <Marker
                    key={stop.type}
                    position={[stop.lat, stop.lon]}
                    icon={stop.type === "start" ? startIcon : endIcon}
                >
                    <Popup>{stop.type === "start" ? "Vehicle route start" : "Vehicle route end"}<br/>
                        {stop.lat.toFixed(6)}, {stop.lon.toFixed(6)}
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
        <div className="absolute bottom-4 left-4 right-4 z-[1000] flex flex-wrap items-center gap-2 rounded-lg bg-white/95 p-3 shadow sm:right-auto sm:min-w-[420px]">
            <button type="button" onClick={() => {
                if (playbackType !== "historical") {
                    setPlaybackType("historical");
                    progressRef.current = 0;
                    setProgress(0);
                } else if (progress >= 1) {
                    progressRef.current = 0;
                    setProgress(0);
                }
                setIsPlaying((playing) => playbackType === "historical" && playing ? false : true);
            }} disabled={historicalPath.length < 2}
            className="shrink-0 rounded bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
                {isPlaying && playbackType === "historical" ? "Pause actual route" : progress >= 1 && playbackType === "historical" ? "Replay actual route" : "Play actual route"}
            </button>
            <button type="button" onClick={() => {
                if (playbackType !== "optimized") {
                    setPlaybackType("optimized");
                    progressRef.current = 0;
                    setProgress(0);
                } else if (progress >= 1) {
                    progressRef.current = 0;
                    setProgress(0);
                }
                setIsPlaying((playing) => playbackType === "optimized" && playing ? false : true);
            }} disabled={!selectedRoute?.route_path || selectedRoute.route_path.length < 2}
            className="shrink-0 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                {isPlaying && playbackType === "optimized" ? "Pause optimized route" : progress >= 1 && playbackType === "optimized" ? "Replay optimized route" : "Play optimized route"}
            </button>
            <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={progress}
                aria-label={`${playbackType === "historical" ? "Actual" : "Optimized"} vehicle route position`}
                onChange={(event) => {
                    const nextProgress = Number(event.target.value);
                    progressRef.current = nextProgress;
                    setProgress(nextProgress);
                    if (nextProgress >= 1) setIsPlaying(false);
                }}
                className="min-w-0 flex-1 accent-blue-700"
            />
            <span className="shrink-0 text-xs tabular-nums text-slate-600">{Math.round(progress * 100)}%</span>
        </div>
        </div>
    );
}

export default function BeatHouseRoutePlanner({
    visible = true,
    beatData,
    highPriorityHouseRequest,
    dateSelection = "live",
    availableDates = [],
    onDateSelectionChange,
}) {
    const [selectedBeatId, setSelectedBeatId] = useState("");
    const [selectedEmployeeKey, setSelectedEmployeeKey] = useState(ALL_EMPLOYEES);
    const [layer, setLayer] = useState("streets");
    const [routes, setRoutes] = useState([]);
    const [recordedRoute, setRecordedRoute] = useState(null);
    const [selectedRouteId, setSelectedRouteId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [maxDistanceKm, setMaxDistanceKm] = useState("30");
    const [nearRouteThreshold, setNearRouteThreshold] = useState("50");
    const [showCollectedOnly, setShowCollectedOnly] = useState(false);
    const [showHighPriorityOnly, setShowHighPriorityOnly] = useState(false);
    const [highPriorityHouseIds, setHighPriorityHouseIds] = useState(() => new Set());
    const [selectedHouse, setSelectedHouse] = useState(null);
    const [houseDetailsVisible, setHouseDetailsVisible] = useState(false);
    const [houseSearchQuery, setHouseSearchQuery] = useState("");
    const [houseSearchError, setHouseSearchError] = useState("");
    const [isMapMaximized, setIsMapMaximized] = useState(false);

    const beatFiles = beatData?.beats || [];
    const employees = useMemo(() => beatFiles.map((beat, index) => ({
        key: beat.id,
        id: beat.assignedEmployee.id,
        name: beat.assignedEmployee.name,
        mappingId: beat.id,
        beatId: beat.id,
        days: beat.routes,
        color: EMPLOYEE_ROUTE_COLORS[index % EMPLOYEE_ROUTE_COLORS.length],
        beatName: beat.beatName,
    })), [beatFiles]);

    React.useEffect(() => {
        if (!isMapMaximized) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === "Escape") setIsMapMaximized(false);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isMapMaximized]);

    const activeEmployees = useMemo(() => employees.map((employee) => ({
        id: employee.mappingId,
        employeeId: employee.id,
        name: employee.name,
        beatId: employee.beatId,
        beatName: employee.beatName,
        color: employee.color,
    })), [employees]);
    const employeeOptions = activeEmployees;
    const selectedEmployee = selectedEmployeeKey === ALL_EMPLOYEES
        ? null
        : employees.find((employee) => employee.mappingId.toLowerCase() === selectedEmployeeKey.toLowerCase()) || null;
    const selectedEmployeeMapping = activeEmployees.find((employee) =>
        employee.id.toLowerCase() === selectedEmployeeKey.toLowerCase()
    ) || null;
    const employeesInScope = useMemo(() => employees.filter((employee) =>
        selectedEmployeeKey === ALL_EMPLOYEES
            ? (!selectedBeatId || employee.beatId === selectedBeatId)
            : employee.mappingId.toLowerCase() === selectedEmployeeKey.toLowerCase()
    ), [employees, selectedBeatId, selectedEmployeeKey]);
    const dateScopeBeats = useMemo(() => selectedEmployee
        ? beatFiles.filter((item) => item.id === selectedEmployee.beatId)
        : selectedBeatId
            ? beatFiles.filter((item) => item.id === selectedBeatId)
            : beatFiles, [beatFiles, selectedBeatId, selectedEmployee]);
    const scopedDateOptions = useMemo(() => {
        const dates = new Set();
        dateScopeBeats.forEach((item) => {
            (item.routes || []).forEach((route) => dates.add(route.date));
            (item.houses || []).forEach((house) => {
                (house.history?.collectionDates || []).forEach((date) => dates.add(date));
                if (house.scanningDate) dates.add(house.scanningDate.slice(0, 10));
            });
            if (item.toDate) dates.add(item.toDate);
        });
        return [...dates].sort();
    }, [dateScopeBeats]);
    const selectedDate = dateSelection === "live"
        ? scopedDateOptions.at(-1) || availableDates.at(-1) || ""
        : dateSelection;
    const employeeRouteLayers = useMemo(() =>
        employeesInScope.flatMap((employee) => {
            const routeDay = employee.days.find((item) => item.date === selectedDate);
            return routeDay?.trackPoints.length
                ? [{employee, trackPoints: routeDay.trackPoints, color: employee.color}]
                : [];
        }), [employeesInScope, selectedDate]);
    const displayedBeatId = selectedEmployeeKey !== ALL_EMPLOYEES
        ? selectedEmployeeMapping?.beatId || ""
        : selectedBeatId;
    const normalizedBeatId = displayedBeatId.toLowerCase();
    const beat = displayedBeatId ? beatFiles.find((item) =>
        item.id.toLowerCase() === normalizedBeatId ||
        item.beatName.toLowerCase() === normalizedBeatId
    ) || null : null;
    const boundariesToDisplay = useMemo(() => {
        const displayAllBoundaries = selectedEmployeeKey !== ALL_EMPLOYEES || !selectedBeatId;
        const visibleBeats = displayAllBoundaries
            ? beatFiles
            : beatFiles.filter((item) => item.id === selectedBeatId);
        return visibleBeats.map((item) => ({
            ...item,
            employeeColor: employees.find((employee) => employee.beatId === item.id)?.color,
        }));
    }, [beatFiles, employees, selectedBeatId, selectedEmployeeKey]);
    const beatBoundaryColor = beat
        ? employeeRouteLayers.find((item) =>
            item.employee.beatId?.toLowerCase() === beat.id.toLowerCase()
        )?.color || "#dc2626"
        : "#dc2626";
    const days = useMemo(() => selectedEmployee ? selectedEmployee.days
        : [...new Set(employeesInScope.flatMap((employee) => employee.days.map((item) => item.date)))]
            .sort()
            .map((date) => {
                const employeeDays = employeesInScope.map((employee) =>
                    employee.days.find((item) => item.date === date)
                ).filter(Boolean);
                return {
                    date,
                    trackPoints: employeeDays.flatMap((item) => item.trackPoints),
                    collectionScans: employeeDays.flatMap((item) => item.collectionScans),
                    distanceKm: employeeDays.reduce((total, item) => total + item.distanceKm, 0),
                };
            }), [employeesInScope, selectedEmployee]);
    const day = useMemo(
        () => days.find((item) => item.date === selectedDate) || (selectedDate ? {
            date: selectedDate,
            trackPoints: [],
            collectionScans: [],
            distanceKm: 0,
        } : null),
        [days, selectedDate],
    );
    const selectedDateCoverage = useMemo(
        () => beat && selectedDate
            ? analyzeHouseCoverage(
                beat.houses,
                [],
                selectedDate,
                selectedDate,
                beat.assignedEmployee,
            )
            : null,
        [beat, selectedDate],
    );
    const selectedRoute = routes.find((route) => route.route_id === selectedRouteId) || null;
    const collectionMappingAvailable = Boolean(beat?.hasHouseIds && day);
    const coveredHouseIds = useMemo(() => getCollectedHouseIds(beat, day), [beat, day]);
    const highPriorityHouseIdsForBeat = useMemo(() => {
        if (!beat) return new Set();
        const otherBeats = beatFiles.filter((item) => item.id !== beat.id);
        const coverage = analyzeHouseCoverage(
            beat.houses,
            beat.routes,
            beat.fromDate,
            beat.toDate,
            beat.assignedEmployee,
            otherBeats,
        );
        return new Set(getHighPriorityHouses(
            coverage,
            getReportWindowDays(beat.fromDate, beat.toDate),
        )
            .filter(({detail}) =>
                Number.isFinite(detail.house.lat) && Number.isFinite(detail.house.lon)
            )
            .map(({detail}) => detail.house.houseId));
    }, [beat, beatFiles]);
    const selectedHouseRoute = useMemo(
        () => selectedHouse?.beat?.routes.find((route) => route.date === selectedDate) || null,
        [selectedDate, selectedHouse],
    );
    const selectedHouseCollectedOnDate = useMemo(
        () => Boolean(
            selectedHouse?.beat &&
            selectedHouse?.house.house_id &&
            (selectedHouseRoute
                ? getCollectedHouseIds(selectedHouse.beat, selectedHouseRoute).has(selectedHouse.house.house_id)
                : selectedHouse.house.history?.collectionDates?.includes(selectedDate))
        ),
        [selectedDate, selectedHouse, selectedHouseRoute],
    );
    const historicalOutsideBeat = useMemo(
        () => getOutsideBeatSections(recordedRoute?.route_path, beat?.fencePolygons || beat?.fencePoints),
        [recordedRoute, beat],
    );
    const optimizedOutsideBeat = useMemo(
        () => getOutsideBeatSections(selectedRoute?.route_path, beat?.fencePolygons || beat?.fencePoints),
        [selectedRoute, beat],
    );
    const closestHouseToRoute = useMemo(() => {
        if (!beat?.houses.length || !day?.trackPoints.length) return null;
        const referencePath = sampleTrackPoints(recordedRoute?.route_path?.length
            ? recordedRoute.route_path
            : day.trackPoints, 300);
        return beat.houses
            .map((house) => ({house, distanceMeters: distanceFromRouteMeters(house, referencePath)}))
            .filter((item) => Number.isFinite(item.distanceMeters))
            .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;
    }, [beat, day, recordedRoute]);
    const routeCorridorMeters = Math.max(0, Number(nearRouteThreshold) || 0);
    const routeDistanceIndex = useMemo(
        () => createRouteSegmentIndex(beat && day?.trackPoints.length ? day.trackPoints : null, routeCorridorMeters),
        [beat, day, routeCorridorMeters],
    );
    const routeCandidateHouses = useMemo(() => {
        if (!beat?.houses.length) return [];
        const polygons = beat.fencePolygons || [beat.fencePoints];
        return beat.houses.filter((house) =>
            house.isRouteHouse &&
            house.lat != null &&
            house.lon != null &&
            polygons.some((polygon) => isInsidePolygon(house, polygon))
        );
    }, [beat]);
    const housesOnSelectedDayRoute = useMemo(() => {
        if (!day?.trackPoints.length) return [];
        return routeCandidateHouses.filter((house) =>
            !coveredHouseIds.has(house.house_id) &&
            distanceFromRouteIndexMeters(house, routeDistanceIndex) <= routeCorridorMeters
        );
    }, [coveredHouseIds, day, routeCandidateHouses, routeCorridorMeters, routeDistanceIndex]);
    const optimizationCandidateHouseIds = useMemo(
        () => new Set(housesOnSelectedDayRoute.map((house) => house.house_id)),
        [housesOnSelectedDayRoute],
    );
    React.useEffect(() => {
        setSelectedHouse(null);
        setHouseDetailsVisible(false);
        setHouseSearchError("");
    }, [beatData, selectedBeatId, selectedEmployeeKey, selectedDate]);
    React.useEffect(() => {
        if (selectedEmployeeKey !== ALL_EMPLOYEES &&
            !activeEmployees.some((item) => item.id.toLowerCase() === selectedEmployeeKey.toLowerCase())) {
            setSelectedEmployeeKey(ALL_EMPLOYEES);
        }
    }, [selectedEmployeeKey, activeEmployees]);

    React.useEffect(() => {
        if (!beatFiles.length) {
            setSelectedBeatId("");
            setSelectedEmployeeKey(ALL_EMPLOYEES);
            setShowCollectedOnly(false);
            setShowHighPriorityOnly(false);
            setHighPriorityHouseIds(new Set());
            setRoutes([]);
            setRecordedRoute(null);
            setSelectedRouteId("");
            return;
        }
        const firstBeat = beatFiles[0];
        setSelectedBeatId(firstBeat.id);
        setSelectedEmployeeKey(firstBeat.id);
        setShowCollectedOnly(false);
        setShowHighPriorityOnly(false);
        setHighPriorityHouseIds(new Set());
        setRoutes([]);
        setRecordedRoute(null);
        setSelectedRouteId("");
    }, [beatData]);

    React.useEffect(() => {
        if (!highPriorityHouseRequest) return;
        const targetBeat = beatFiles.find((item) => item.id === highPriorityHouseRequest.beatId);
        if (!targetBeat) {
            setError("The selected Beat for high-priority houses is no longer available.");
            return;
        }
        const nextHighPriorityHouseIds = new Set(highPriorityHouseRequest.houseIds);
        if (!nextHighPriorityHouseIds.size) {
            setError(`No high-priority houses in ${targetBeat.beatName} have map coordinates.`);
            return;
        }
        setSelectedBeatId(targetBeat.id);
        setSelectedEmployeeKey(targetBeat.id);
        setShowCollectedOnly(false);
        setHighPriorityHouseIds(nextHighPriorityHouseIds);
        setShowHighPriorityOnly(true);
        setSelectedHouse(null);
        setHouseDetailsVisible(false);
        clearResults();
        setError("");
        setNotice(`Showing ${nextHighPriorityHouseIds.size.toLocaleString()} high-priority houses in ${targetBeat.beatName}.`);
    }, [highPriorityHouseRequest, beatFiles]);

    const clearResults = () => {
        setRoutes([]);
        setRecordedRoute(null);
        setSelectedRouteId("");
    };

    const handleOptimize = async () => {
        if (selectedEmployeeKey === ALL_EMPLOYEES) {
            setError("Select one employee to optimize that employee's route.");
            return;
        }
        if (!day?.trackPoints.length || !beat) return;
        if (!beat.houses?.length) {
            setError("This Beat has no house records available to optimize.");
            return;
        }
        if (housesOnSelectedDayRoute.length === 0) {
            setError(`No remaining, RouteDetails-linked houses inside the Beat are within ${routeCorridorMeters} m of the selected day's GPS route. Increase the corridor or review the selected day's route data.`);
            return;
        }
        const distanceLimit = Number(maxDistanceKm);
        if (!Number.isFinite(distanceLimit) || distanceLimit <= 0 || distanceLimit > 1000) {
            setError("Enter a maximum route distance between 0 and 1,000 km.");
            return;
        }
        setLoading(true);
        setError("");
        setNotice("");
        clearResults();
        try {
            const trackResponse = await fetch(`${API_URL}/optimize_employee_route`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    track_points: day.trackPoints.map(({lat, lon, datetime}) => ({lat, lon, datetime})),
                }),
            });
            const trackData = await trackResponse.json();
            if (!trackResponse.ok) {
                throw new Error(trackData.message || `Could not road-match the recorded vehicle track (HTTP ${trackResponse.status}).`);
            }
            const recordedRouteOption = trackData.alternatives?.find((route) =>
                Array.isArray(route.route_path) && route.route_path.length > 1
            );
            if (!recordedRouteOption) {
                throw new Error("The routing service did not return road geometry for the recorded vehicle track.");
            }
            const actualDistanceKm = Number(recordedRouteOption.distance_km);
            if (!Number.isFinite(actualDistanceKm) || actualDistanceKm <= 0) {
                throw new Error("The road-matched actual route has no valid distance, so a safe route comparison cannot be made.");
            }
            const effectiveDistanceLimitKm = Math.min(distanceLimit, actualDistanceKm - 0.01);
            if (effectiveDistanceLimitKm <= 0) {
                throw new Error(
                    `The selected day's road-matched actual route is only ${actualDistanceKm.toFixed(2)} km; ` +
                    "there is no positive route limit that can guarantee a strictly shorter recommendation."
                );
            }
            const response = await fetch(`${API_URL}/optimize_beat_routes`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    track_points: day.trackPoints.map(({lat, lon, datetime}) => ({lat, lon, datetime})),
                    houses: housesOnSelectedDayRoute.map((house) => ({
                        ...house,
                        house_id: house.route_key,
                    })),
                    geofence: beat.optimizerGeofence || beat.geofence,
                    max_routes: 4,
                    max_distance_km: effectiveDistanceLimitKm,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || `Route request failed (HTTP ${response.status}).`);
            }
            const routesShorterThanActual = Array.isArray(data.routes)
                ? data.routes.filter((route) => Number(route.distance_km) < actualDistanceKm)
                : [];
            if (routesShorterThanActual.length === 0) {
                throw new Error(
                    `No optimized route is strictly shorter than the selected day's road-matched route (${actualDistanceKm.toFixed(2)} km). ` +
                    "Try reducing the candidate corridor; the planner will not show a route that is equal in length or longer."
                );
            }
            setRecordedRoute({
                ...recordedRouteOption,
                point_count: trackData.point_count,
            });
            setRoutes(routesShorterThanActual);
            setSelectedRouteId(routesShorterThanActual[0].route_id);
            const endpointNote = data.start_inside_beat && data.end_inside_beat
                ? ""
                : " The recorded vehicle start/end is outside the beat, so its connecting road route leaves the fence.";
            const routeCoverageSummary = `Using only the ${day.date} GPS route, the recommended route can visit ` +
                `${routesShorterThanActual[0].houses_covered} of ${data.house_count} houses within ${routeCorridorMeters} m of that track. ` +
                `Its road distance is strictly shorter than the actual route (${actualDistanceKm.toFixed(2)} km).`;
            setNotice(`${routeCoverageSummary} Planned visits are not proof of collection. Routes are ranked by coverage, road distance, estimated time, then repeated road distance, within the ${effectiveDistanceLimitKm.toFixed(2)} km limit.${endpointNote}`);
        } catch (requestError) {
            setError(`Could not plan beat house routes: ${requestError.message || requestError}`);
        } finally {
            setLoading(false);
        }
    };

    const handleFindHouse = (event) => {
        event.preventDefault();
        const query = houseSearchQuery.trim().toLowerCase();
        if (!query) {
            setHouseSearchError("Enter a HouseId to find.");
            return;
        }
        const searchableBeatFiles = selectedEmployeeKey !== ALL_EMPLOYEES && beat
            ? [beat]
            : boundariesToDisplay;
        const searchableHouses = searchableBeatFiles.flatMap((boundary) =>
            (boundary.houses || [])
                .filter((house) => house.house_id && house.lat != null && house.lon != null)
                .map((house) => ({house, beat: boundary}))
        );
        const match = searchableHouses.find(({house}) => house.house_id.toLowerCase() === query) ||
            searchableHouses.find(({house}) => house.house_id.toLowerCase().includes(query));
        if (!match) {
            setHouseSearchError(`No house matching “${houseSearchQuery.trim()}” with map coordinates was found.`);
            return;
        }
        if (showCollectedOnly && beat?.id === match.beat.id && !coveredHouseIds.has(match.house.house_id)) {
            setShowCollectedOnly(false);
        }
        if (showHighPriorityOnly && !highPriorityHouseIds.has(match.house.house_id)) {
            setShowHighPriorityOnly(false);
            setHighPriorityHouseIds(new Set());
        }
        setSelectedHouse(match);
        setHouseDetailsVisible(true);
        setHouseSearchError("");
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-slate-50 p-4">
            <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
                <section className="rounded-xl bg-white p-5 shadow-sm">
                    <h1 className="text-2xl font-bold text-slate-900">Beat House Route Planner</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Beat ownership and house status come from the shared API upload above. The planner uses the assigned employee&apos;s recorded GPS route as the actual route, then compares it with a route for houses without a recorded collection scan.
                        Public OSRM routing is used by default, so house and GPS coordinates are sent to its routing service.
                    </p>
                    <div className="mt-4 flex flex-wrap items-end gap-4">
                        {beatFiles.length > 0 && (
                            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                                Beat
                                <select
                                    value={selectedBeatId}
                                    onChange={(event) => {
                                        const nextBeatId = event.target.value;
                                        setSelectedBeatId(nextBeatId);
                                        setShowCollectedOnly(false);
                                        setShowHighPriorityOnly(false);
                                        setHighPriorityHouseIds(new Set());
                                        const selectedStillInBeat = employees.some((employee) =>
                                            employee.mappingId === selectedEmployeeKey && employee.beatId === nextBeatId
                                        );
                                        if (selectedEmployeeKey !== ALL_EMPLOYEES && !selectedStillInBeat) {
                                            setSelectedEmployeeKey(ALL_EMPLOYEES);
                                        }
                                        clearResults();
                                        setError("");
                                        setNotice("");
                                    }}
                                    className="rounded border border-slate-300 bg-white p-2"
                                >
                                    <option value="">All Beats</option>
                                    {beatFiles.map((beatFile) => <option key={beatFile.id} value={beatFile.id}>{beatFile.beatName}</option>)}
                                </select>
                            </label>
                        )}
                        {employeeOptions.length > 0 && (
                            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                                Assigned employee
                                <select
                                    value={selectedEmployeeKey}
                                    onChange={(event) => {
                                        const employeeKey = event.target.value;
                                        if (employeeKey === ALL_EMPLOYEES) {
                                            setSelectedEmployeeKey(ALL_EMPLOYEES);
                                            setSelectedBeatId("");
                                            setShowCollectedOnly(false);
                                            setShowHighPriorityOnly(false);
                                            setHighPriorityHouseIds(new Set());
                                            clearResults();
                                            setError("");
                                            setNotice("");
                                            return;
                                        }
                                        const mapping = activeEmployees.find((item) => item.id === employeeKey);
                                        setSelectedEmployeeKey(employeeKey);
                                        if (mapping?.beatId) setSelectedBeatId(mapping.beatId);
                                        setShowCollectedOnly(false);
                                        setShowHighPriorityOnly(false);
                                        setHighPriorityHouseIds(new Set());
                                        clearResults();
                                        setError("");
                                        setNotice("");
                                    }}
                                    className="rounded border border-slate-300 bg-white p-2"
                                >
                                    <option value={ALL_EMPLOYEES}>All assigned employees</option>
                                    {employeeOptions.map((employeeId) => (
                                        <option key={employeeId.id} value={employeeId.id} style={{color: employeeId.color}}>
                                            ● {employeeId.name} ({employeeId.employeeId}) · {employeeId.beatName} · {employeeId.color}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {availableDates.length > 0 && (
                            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                                {selectedEmployee ? "Employee route date" : "Route date"}
                                <select value={dateSelection} onChange={(event) => {
                                    onDateSelectionChange?.(event.target.value);
                                    setShowCollectedOnly(false);
                                    clearResults();
                                    setError("");
                                    setNotice("");
                                }} className="rounded border border-slate-300 bg-white p-2">
                                    <option value="live">
                                        Live date{scopedDateOptions.at(-1) ? ` (${scopedDateOptions.at(-1)})` : ""}
                                    </option>
                                    {availableDates.map((date) => (
                                        <option key={date} value={date}>
                                            {date}{!days.some((item) => item.date === date)
                                                ? " (no route record)"
                                                : days.find((item) => item.date === date)?.trackPoints.length
                                                    ? ""
                                                    : " (no GPS points)"}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {beat && (
                            <div className="flex flex-col gap-1">
                                {showHighPriorityOnly || showCollectedOnly ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowHighPriorityOnly(false);
                                            setShowCollectedOnly(false);
                                            setHighPriorityHouseIds(new Set());
                                            setSelectedHouse(null);
                                            setHouseDetailsVisible(false);
                                        }}
                                        className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
                                    >
                                        Show all houses in {beat.beatName}
                                    </button>
                                ) : (
                                    <>
                                        {day && (
                                            <button
                                                type="button"
                                                title={`Filter houses to collection records matched on ${day.date}.`}
                                                disabled={!collectionMappingAvailable || coveredHouseIds.size === 0}
                                                onClick={() => {
                                                    setShowCollectedOnly(true);
                                                    setSelectedHouse(null);
                                                    setHouseDetailsVisible(false);
                                                }}
                                                className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Show only {day.date} collections ({coveredHouseIds.size} houses)
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            title="Filter to high-priority houses based on this Beat's full reporting period, not just the selected day."
                                            disabled={!highPriorityHouseIdsForBeat.size}
                                            onClick={() => {
                                                setShowHighPriorityOnly(true);
                                                setShowCollectedOnly(false);
                                                setHighPriorityHouseIds(highPriorityHouseIdsForBeat);
                                                setSelectedHouse(null);
                                                setHouseDetailsVisible(false);
                                            }}
                                            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Show High-Priority Houses (30-day) ({highPriorityHouseIdsForBeat.size})
                                        </button>
                                        {day && day.collectionScans.length > 0 && coveredHouseIds.size === 0 && (
                                            <span className="max-w-56 text-xs text-amber-800">
                                                This date has scans, but none match a house in this Beat.
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        {employeeRouteLayers.length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
                                {employeeRouteLayers.map(({employee, color}) => (
                                    <span key={employee.key} className="inline-flex items-center gap-1">
                                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{backgroundColor: color}}/>
                                        {employee.name} ({employee.id})
                                    </span>
                                ))}
                            </div>
                        )}
                        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                            Maximum route distance (km)
                            <input type="number" min="1" max="1000" step="1" value={maxDistanceKm}
                                onChange={(event) => { setMaxDistanceKm(event.target.value); clearResults(); }}
                                className="w-40 rounded border border-slate-300 p-2"/>
                            <span className="max-w-52 text-xs font-normal text-slate-500">The selected day&apos;s actual distance is also a hard maximum.</span>
                        </label>
                        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                            Route candidate corridor from selected-day GPS (m)
                            <input type="number" min="0" max="1000" step="10" value={nearRouteThreshold}
                                onChange={(event) => { setNearRouteThreshold(event.target.value); clearResults(); }}
                                className="w-40 rounded border border-slate-300 p-2"/>
                            <span className="max-w-52 text-xs font-normal text-slate-500">Only houses this close to the selected day&apos;s GPS track are optimized.</span>
                            <span className="max-w-52 text-xs font-normal text-slate-500">Every other house in the beat is excluded; the optimizer may also skip nearby candidates.</span>
                        </label>
                        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                            Map style
                            <select value={layer} onChange={(event) => setLayer(event.target.value)}
                                className="rounded border border-slate-300 bg-white p-2">
                                <option value="streets">Streets</option>
                                <option value="satellite">Satellite</option>
                            </select>
                        </label>
                        <button type="button" onClick={handleOptimize}
                            disabled={loading || selectedEmployeeKey === ALL_EMPLOYEES || !day?.trackPoints.length || !beat?.houses.length}
                            className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                            {loading ? "Optimizing road routes…" : "Find and compare routes"}
                        </button>
                    </div>
                    {selectedEmployee && (
                        <p className="mt-2 text-xs text-slate-600">
                            Selected employee: {selectedEmployee.name} ({selectedEmployee.id}) · Assigned Beat: {selectedEmployee.beatId || "unmapped"} · {beat?.houses.length || 0} houses loaded
                        </p>
                    )}
                    {selectedEmployeeKey !== ALL_EMPLOYEES && !selectedEmployee && (
                        <p role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                            The selected Beat has no assigned employee route in this API file.
                        </p>
                    )}
                    {selectedBeatId && beat && !beat.houses.length && (
                        <p role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                            No house coordinates were supplied for this Beat.
                        </p>
                    )}
                    {selectedBeatId && !beat && (
                        <p role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                            No Beat boundary matches “{selectedBeatId}”.
                        </p>
                    )}
                    {beat && (
                        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded border border-slate-200 p-2"><strong>Beat:</strong> {beat.beatName}</div>
                            <div className="rounded border border-slate-200 p-2"><strong>Assigned employee:</strong> {beat.assignedEmployee.name} ({beat.beatUserId})</div>
                            <div className="rounded border border-slate-200 p-2"><strong>Total houses:</strong> {beat.totalHouses.toLocaleString()}</div>
                            <div className="rounded border border-slate-200 p-2"><strong>Data period:</strong> {beat.fromDate || "Unavailable"} – {beat.toDate || "Unavailable"}</div>
                            <div className="rounded border border-slate-200 p-2"><strong>Collected by assigned employee on selected date:</strong> {selectedDateCoverage ? selectedDateCoverage.assignedEmployeeCollected.toLocaleString() : "—"}</div>
                            <div className="rounded border border-slate-200 p-2"><strong>Collected by other employees on selected date:</strong> {selectedDateCoverage ? selectedDateCoverage.otherEmployeeCollected.toLocaleString() : "—"}</div>
                            <div className="rounded border border-slate-200 p-2"><strong>Not scanned on selected date:</strong> {selectedDateCoverage ? selectedDateCoverage.remainingWithoutHistory.toLocaleString() : "—"}</div>
                            <div className="rounded border border-slate-200 p-2">
                                <strong>Beat geofence:</strong> {beat.fencePolygons.length} polygon(s), {beat.fencePolygons.reduce((count, polygon) => count + polygon.length, 0).toLocaleString()} points
                            </div>
                        </div>
                    )}
                    {loading && (
                        <p className="mt-3 text-sm text-slate-600">
                            Matching the selected day&apos;s actual GPS route to roads and optimizing houses without a collection record within {routeCorridorMeters} m of that track. Route alternatives may take several minutes on public routing services.
                        </p>
                    )}
                    {!beatData && (
                        <p role="status" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            Upload the API file above to load Beat, house, and route data.
                        </p>
                    )}
                    {day && day.trackPoints.length === 0 && (
                        <p className="mt-3 text-sm text-amber-800">This day has no vehicle GPS points, so it cannot provide route endpoints.</p>
                    )}
                    {error && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                    {notice && <p role="status" className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
                    {beat && beat.unmatchedRouteHouseCoordinates > 0 && (
                        <p role="status" className="mt-2 text-xs text-amber-800">
                            {beat.unmatchedRouteHouseCoordinates} RouteDetails house coordinate(s) could not be linked to a HouseId and are excluded from route optimization.
                        </p>
                    )}
                </section>

                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl bg-white p-4 shadow-sm">
                        <div className="text-sm text-slate-500">Actual route</div>
                        <div className="mt-1 text-lg font-semibold">{day?.date || "—"}</div>
                        {day?.trackPoints.length > 0 && <div className="mt-1 text-xs text-slate-500">
                            {day.trackPoints.length.toLocaleString()} GPS points · {day.distanceKm.toFixed(2)} km
                            {selectedEmployee ? " GPS estimate" : " combined GPS estimate across employees"}
                        </div>}
                    </div>
                    <div className="rounded-xl bg-white p-4 shadow-sm">
                        <div className="text-sm text-slate-500">Total houses</div>
                        <div className="mt-1 text-lg font-semibold">{beat ? beat.totalHouses.toLocaleString() : "—"}</div>
                        {beat && <div className="mt-1 text-xs text-slate-500">{routeCandidateHouses.length.toLocaleString()} route-coordinate houses</div>}
                    </div>
                    <div className="rounded-xl bg-white p-4 shadow-sm">
                        <div className="text-sm text-slate-500">Collected by assigned employee on selected date</div>
                        <div className="mt-1 text-lg font-semibold">{selectedDateCoverage ? selectedDateCoverage.assignedEmployeeCollected.toLocaleString() : "—"}</div>
                    </div>
                    <div className="rounded-xl bg-white p-4 shadow-sm">
                        <div className="text-sm text-slate-500">Collected by other employees on selected date</div>
                        <div className="mt-1 text-lg font-semibold">{selectedDateCoverage ? selectedDateCoverage.otherEmployeeCollected.toLocaleString() : "—"}</div>
                    </div>
                    <div className="rounded-xl bg-white p-4 shadow-sm">
                        <div className="text-sm text-slate-500">Not scanned on selected date</div>
                        <div className="mt-1 text-lg font-semibold">{selectedDateCoverage ? selectedDateCoverage.remainingWithoutHistory.toLocaleString() : "—"}</div>
                        {beat && <div className="mt-1 text-xs text-slate-500">{housesOnSelectedDayRoute.length.toLocaleString()} near-route optimization candidates</div>}
                    </div>
                </section>

                {selectedRoute && recordedRoute && (
                    <section className="rounded-xl bg-white p-4 shadow-sm">
                        <h2 className="font-semibold text-slate-900">Historical vs. optimized route</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Historical distance and time are the road-matched GPS trip. Negative changes indicate reductions; optimized estimates exclude collection-service time and live traffic.
                        </p>
                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[520px] text-left text-sm">
                                <thead className="border-b text-xs text-slate-500">
                                    <tr>
                                        <th className="py-2 pr-4">Route</th>
                                        <th className="py-2 pr-4">Houses planned</th>
                                        <th className="py-2 pr-4">Road distance</th>
                                        <th className="py-2 pr-4">Estimated driving time</th>
                                        <th className="py-2">Repeated road distance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2 pr-4">Historical ({recordedRoute.provider || "road matched"})</td>
                                        <td className="py-2 pr-4">—</td>
                                        <td className="py-2 pr-4">{Number(recordedRoute.distance_km).toFixed(2)} km</td>
                                        <td className="py-2 pr-4">{formatDuration(recordedRoute.duration_minutes)}</td>
                                        <td className="py-2">{Number(recordedRoute.backtrack_distance_km || 0).toFixed(2)} km</td>
                                    </tr>
                                    <tr className="font-medium text-slate-900">
                                        <td className="py-2 pr-4">Optimized route (planned stops)</td>
                                        <td className="py-2 pr-4">{selectedRoute.houses_covered} planned / {housesOnSelectedDayRoute.length} route candidates; {Math.max(0, housesOnSelectedDayRoute.length - selectedRoute.houses_covered)} not selected</td>
                                        <td className="py-2 pr-4">{Number(selectedRoute.distance_km).toFixed(2)} km</td>
                                        <td className="py-2 pr-4">{formatDuration(selectedRoute.duration_minutes)}</td>
                                        <td className="py-2">{Number(selectedRoute.backtrack_distance_km || 0).toFixed(2)} km</td>
                                    </tr>
                                    <tr className="border-t border-slate-100 text-xs text-slate-600">
                                        <td className="py-2 pr-4">Change from historical</td>
                                        <td className="py-2 pr-4">Planned houses shown above</td>
                                        <td className="py-2 pr-4">{(Number(selectedRoute.distance_km) - Number(recordedRoute.distance_km)).toFixed(2)} km</td>
                                        <td className="py-2 pr-4">{(Number(selectedRoute.duration_minutes) - Number(recordedRoute.duration_minutes)).toFixed(0)} min</td>
                                        <td className="py-2">—</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                            Beat-boundary check uses 25 m sampling of road geometry. Outside sections are highlighted in red (actual)
                            and purple (optimized). The optimized route has approximately {optimizedOutsideBeat.distanceKm.toFixed(2)} km
                            outside the beat; approved access connections were not supplied, so those sections need review.
                            {recordedRoute?.route_path?.length > 1 &&
                                ` The actual route has approximately ${historicalOutsideBeat.distanceKm.toFixed(2)} km outside the beat.`}
                            {" "}Vehicle capacity, operating-time limits, and dump-trip constraints are not enforced without validated inputs.
                        </div>
                    </section>
                )}

                {(beat || boundariesToDisplay.length > 0 || employeeRouteLayers.length > 0 || selectedEmployee || routes.length > 0) && (
                    <>
                    <section className="rounded-xl bg-white p-4 shadow-sm">
                        <h2 className="text-sm font-semibold text-slate-900">
                            Map key{day?.date ? ` · selected date ${day.date}` : ""}
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700">
                            {Object.entries(HOUSE_STATUS_STYLES).map(([status, style]) => (
                                <span key={status} className="inline-flex items-center gap-1.5">
                                    <img src={style.icon} alt="" className="h-[34px] w-6 object-contain"/>
                                    {status === "own"
                                        ? `${style.label}${beat?.assignedEmployee.name ? ` (${beat.assignedEmployee.name})` : ""}`
                                        : style.label}
                                </span>
                            ))}
                            {collectionMappingAvailable && (
                                <span>House details report selected-date collection matches for {day.date}.</span>
                            )}
                            {routes.length > 0 && (
                                <span>Recommended route visits are not confirmed collection.</span>
                            )}
                            {employeeRouteLayers.map(({employee, color}) => (
                                <span key={employee.key} className="inline-flex items-center gap-1.5">
                                    <span className="inline-block w-6 border-t-2 border-dashed" style={{borderColor: color}}/>
                                    {employee.name}&apos;s recorded GPS route on {selectedDate}
                                </span>
                            ))}
                            {beat && (
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="inline-block h-3.5 w-3.5 border-2 bg-blue-50" style={{borderColor: beatBoundaryColor}}/>
                                    Beat boundary outline
                                </span>
                            )}
                            {historicalOutsideBeat.distanceKm > 0 && (
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="inline-block w-6 border-t-4 border-red-600"/>
                                    Estimated actual-route section outside the Beat
                                </span>
                            )}
                            {optimizedOutsideBeat.distanceKm > 0 && (
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="inline-block w-6 border-t-4 border-purple-700"/>
                                    Estimated planned-route section outside the Beat
                                </span>
                            )}
                        </div>
                        <form onSubmit={handleFindHouse} className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="grid gap-1 text-xs font-medium text-slate-700">
                                Find a house by HouseId
                                <input
                                    type="search"
                                    value={houseSearchQuery}
                                    onChange={(event) => setHouseSearchQuery(event.target.value)}
                                    placeholder="Enter HouseId"
                                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                                />
                            </label>
                            <button
                                type="submit"
                                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Find and zoom
                            </button>
                            {houseSearchError && <p role="alert" className="text-xs text-red-700">{houseSearchError}</p>}
                        </form>
                        <p className="mt-2 text-xs text-slate-600">
                                House pins show collection status: green is collected by the assigned employee, blue by another employee, orange needs attention, and red is not collected. Click a pin for its HouseId, scanner, scan date, and route status. At any zoom, clicking within 18 pixels selects the nearest displayed house.
                        </p>
                        {selectedHouse && houseDetailsVisible && (
                            <div role="status" className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-slate-800">
                                <div>
                                    <strong>{selectedHouse.house.house_id || "House"} · {selectedHouse.beat.beatName}</strong>
                                    <div>Status on {selectedDate}: {HOUSE_STATUS_STYLES[getHouseCollectionStatusForDate(
                                        selectedHouse.house,
                                        selectedDate,
                                        selectedHouse.beat.assignedEmployee?.id || selectedHouse.beat.beatUserId,
                                    )].label}</div>
                                    <div>Scanner: {selectedHouse.house.scannerName || "Unavailable"} ({selectedHouse.house.scannerUserId || "ID unavailable"})</div>
                                    <div>Scanning date: {selectedHouse.house.scanningDate || "Not recorded"}</div>
                                    <div>
                                        {selectedHouseRoute
                                            ? selectedHouseCollectedOnDate
                                                ? `Matched to a collection scan on ${selectedDate}`
                                                : `No matched collection scan on ${selectedDate}`
                                            : selectedHouseCollectedOnDate
                                                ? `House report shows a scan on ${selectedDate}; no route record was provided`
                                                : `No route record for ${selectedDate}`}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setHouseDetailsVisible(false)}
                                    className="rounded border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-100"
                                >
                                    Close house details
                                </button>
                            </div>
                        )}
                    </section>
                    <section className={`grid min-h-[620px] flex-1 gap-4 ${isMapMaximized
                        ? "fixed inset-3 z-[2000] min-h-0 grid-cols-1 bg-slate-50 p-2 shadow-2xl"
                        : "lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]"}`}>
                        <div className={`relative min-h-[400px] overflow-hidden rounded-xl bg-white shadow-sm ${isMapMaximized ? "h-full min-h-0" : ""}`}>
                            <button
                                type="button"
                                onClick={() => setIsMapMaximized((maximized) => !maximized)}
                                aria-label={isMapMaximized ? "Restore map size" : "Maximize map"}
                                className="absolute right-3 top-3 z-[1200] rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow hover:bg-slate-50"
                            >
                                {isMapMaximized ? "Restore map" : "Maximize map"}
                            </button>
                            <BeatRouteMap
                                key={layer}
                                beat={beat}
                                boundaryBeats={boundariesToDisplay}
                                allBeats={beatFiles}
                                employeeRouteLayers={employeeRouteLayers}
                                showAllEmployeeHouses={selectedEmployeeKey === ALL_EMPLOYEES}
                                routes={routes}
                                selectedRouteId={selectedRouteId}
                                recordedRoute={recordedRoute}
                                trackPoints={selectedEmployee ? day?.trackPoints || [] : []}
                                layer={layer}
                                visible={visible}
                                selectedDate={selectedDate}
                                nearRouteThreshold={Math.max(0, Number(nearRouteThreshold) || 0)}
                                coveredHouseIds={coveredHouseIds}
                                showCollectedOnly={showCollectedOnly}
                                showHighPriorityOnly={showHighPriorityOnly}
                                highPriorityHouseIds={highPriorityHouseIds}
                                collectionMappingAvailable={collectionMappingAvailable}
                                isMapMaximized={isMapMaximized}
                                optimizationCandidateHouseIds={optimizationCandidateHouseIds}
                                focusHouse={selectedHouse?.house || null}
                                onHouseSelect={(house, houseBeat) => {
                                    setSelectedHouse({house, beat: houseBeat});
                                    setHouseDetailsVisible(true);
                                    setHouseSearchError("");
                                }}
                            />
                        </div>
                        {!isMapMaximized && <aside className="flex flex-col gap-3 rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm">
                            <div>
                                <h2 className="font-semibold text-slate-900">Optimized route</h2>
                                {closestHouseToRoute && (
                                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-slate-800">
                                        <div className="font-semibold">Closest house to the recorded route</div>
                                        <div className="mt-1">
                                            {closestHouseToRoute.house.house_id || "House ID unavailable"}
                                        </div>
                                        <div className="font-mono text-xs">
                                            {closestHouseToRoute.house.lat.toFixed(6)}, {closestHouseToRoute.house.lon.toFixed(6)}
                                        </div>
                                        <div className="mt-1 text-xs">
                                            About {Math.round(closestHouseToRoute.distanceMeters)} m from the {recordedRoute?.route_path?.length ? "road-matched route" : "GPS line"}.
                                            This indicates proximity only, not collection.
                                        </div>
                                    </div>
                                )}
                                <p className="mt-2">Only beat houses within {routeCorridorMeters} m of the selected day&apos;s raw GPS track are sent to the optimizer; houses farther away are excluded. The selected day&apos;s first and last GPS points anchor the proposed route. Route alternatives are ranked by maximum houses planned, minimum road distance, minimum estimated drive time, then repeated road distance. GPS proximity and a planned stop do not prove collection. Use “Play actual route” to replay that day&apos;s GPS track or “Play optimized route” to preview the proposal.</p>
                                {selectedRoute?.stops?.length > 1 && (
                                    <p className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-700">
                                        From {selectedRoute.stops[0].lat.toFixed(5)}, {selectedRoute.stops[0].lon.toFixed(5)}
                                        {" "}to {selectedRoute.stops[selectedRoute.stops.length - 1].lat.toFixed(5)}, {selectedRoute.stops[selectedRoute.stops.length - 1].lon.toFixed(5)}
                                    </p>
                                )}
                                <p className="mt-1">Green pins are collected by the assigned employee, blue pins by another employee, orange pins need attention based on collection history, and red pins have no collection record. House details show whether a scan matched the selected date or a route is planned. Dashed route lines show recorded employee GPS. Orange dashed links connect houses to nearby roads.</p>
                            </div>
                            {routes.map((route, index) => (
                                <label key={route.route_id}
                                    className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${route.route_id === selectedRouteId ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}>
                                    <input type="radio" name="beat-route" value={route.route_id}
                                        checked={route.route_id === selectedRouteId}
                                        onChange={() => setSelectedRouteId(route.route_id)}/>
                                    <span>
                                        <span className="block font-medium text-slate-900">{route.label || `Route ${index + 1}`}</span>
                                        <span className="text-xs text-slate-600">{route.houses_covered} houses · {route.distance_km} km · {route.duration_minutes} min</span>
                                    </span>
                                </label>
                            ))}
                            {selectedRoute && (
                                <p className="font-semibold text-slate-900">
                                    Selected: {selectedRoute.houses_covered} houses · {selectedRoute.distance_km} km · {selectedRoute.duration_minutes} min
                                </p>
                            )}
                            {selectedRoute && (
                                <div className="max-h-[520px] overflow-y-auto rounded border border-slate-200">
                                    <table className="w-full text-left text-xs">
                                        <thead className="sticky top-0 bg-slate-100 text-slate-700">
                                            <tr><th className="p-2">Stop</th><th className="p-2">Location</th></tr>
                                        </thead>
                                        <tbody>
                                            {selectedRoute.stops.map((stop) => (
                                                <tr key={`${selectedRoute.route_id}-${stop.sequence}`} className="border-t border-slate-100">
                                                    <td className="p-2">{stop.sequence}. {stop.type === "house"
                                                        ? routeCandidateHouses.find((house) => house.route_key === stop.house_id)?.house_id || "Unidentified house location"
                                                        : stop.type === "start" ? "Start" : "End"}</td>
                                                    <td className="p-2">{stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </aside>}
                    </section>
                    </>
                )}
            </div>
        </div>
    );
}
