import polygonClipping from "polygon-clipping";
import {isInsidePolygon} from "./routeBeatData.js";

const METERS_PER_LATITUDE_DEGREE = 111320;
const BUFFER_METERS = 20;
const BUFFER_CIRCLE_SEGMENTS = 24;
// Default distance limit for the Beat Geofence rebuild; the Route tab lets the user change it.
export const OUTLIER_DISTANCE_METERS = 100;
export const MIN_DISTANCE_LIMIT_METERS = 10;
export const MAX_DISTANCE_LIMIT_METERS = 5000;

export function clampDistanceLimit(value) {
    const meters = Number(value);
    if (!Number.isFinite(meters)) return OUTLIER_DISTANCE_METERS;
    return Math.min(MAX_DISTANCE_LIMIT_METERS, Math.max(MIN_DISTANCE_LIMIT_METERS, Math.round(meters)));
}

/**
 * Combines lists of collected houses into one, keeping each House ID once (the first copy
 * wins). Houses without an ID are kept by coordinate so none is dropped.
 */
export function mergeCollectedHouses(...lists) {
    const merged = new Map();
    lists.flat().forEach((house) => {
        if (!house) return;
        const houseId = house.house_id ?? house.houseId;
        const key = houseId != null && houseId !== "" ? `id:${houseId}` : `at:${house.lat},${house.lon}`;
        if (!merged.has(key)) merged.set(key, house);
    });
    return [...merged.values()];
}

/**
 * Houses whose House ID appears in more than one Beat's house list.
 * Returns Map(houseId -> [{beatId, label}]) with every Beat that lists the house.
 */
export function findHousesInSeveralBeats(beats = []) {
    const listing = new Map();
    beats.forEach((beat) => {
        const label = beat.assignedEmployee?.name
            ? `${beat.assignedEmployee.name} (${beat.assignedEmployee.id})`
            : beat.beatName || String(beat.id);
        new Set((beat.houses || [])
            .map((house) => house.house_id ?? house.houseId)
            .filter((houseId) => houseId != null && houseId !== "")
            .map(String))
            .forEach((houseId) => {
                if (!listing.has(houseId)) listing.set(houseId, []);
                listing.get(houseId).push({beatId: beat.id, label});
            });
    });
    return new Map([...listing].filter(([, owners]) => owners.length > 1));
}

const houseIdOf = (house) => house.house_id || house.houseId || "House ID unavailable";

// Indexes of points with no other point within limit metres.
// Uses a grid of limit-sized cells so each point only checks the 3x3 cells around it.
function findIsolatedPointIndexes(points, limit) {
    if (points.length < 2) return [];
    const cellKey = (cx, cy) => `${cx}:${cy}`;
    const cells = new Map();
    points.forEach((point, index) => {
        const key = cellKey(
            Math.floor(point.x / limit),
            Math.floor(point.y / limit),
        );
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(index);
    });
    const limitSquared = limit ** 2;
    return points.reduce((isolated, point, index) => {
        const cx = Math.floor(point.x / limit);
        const cy = Math.floor(point.y / limit);
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                const hasNeighbor = (cells.get(cellKey(cx + dx, cy + dy)) || []).some((other) =>
                    other !== index &&
                    (points[other].x - point.x) ** 2 + (points[other].y - point.y) ** 2 <= limitSquared
                );
                if (hasNeighbor) return isolated;
            }
        }
        isolated.push(index);
        return isolated;
    }, []);
}

// Distance in metres from a projected point to a projected ring (0 when inside it).
function distanceToRing(point, ring) {
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > point.y) !== (yj > point.y) &&
            point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        const dx = xi - xj;
        const dy = yi - yj;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared
            ? Math.max(0, Math.min(1, ((point.x - xj) * dx + (point.y - yj) * dy) / lengthSquared))
            : 0;
        best = Math.min(best, Math.hypot(point.x - (xj + t * dx), point.y - (yj + t * dy)));
    }
    return inside ? 0 : best;
}

function isMappablePoint(point) {
    return Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        point[0] >= -90 && point[0] <= 90 &&
        point[1] >= -180 && point[1] <= 180;
}

function closeRing(points) {
    if (!points.length) return points;
    const first = points[0];
    const last = points.at(-1);
    return first[0] === last[0] && first[1] === last[1]
        ? points
        : [...points, first];
}

function toProjectedPolygon(rings, metersPerLongitudeDegree) {
    return rings
        .filter((ring) => Array.isArray(ring) && ring.length >= 3)
        .map((ring) => closeRing(ring
            .filter(isMappablePoint)
            .map(([lat, lon]) => [
                lon * metersPerLongitudeDegree,
                lat * METERS_PER_LATITUDE_DEGREE,
            ])))
        .filter((ring) => ring.length >= 4);
}

function toLatLonRing(ring, metersPerLongitudeDegree) {
    const points = ring.map(([x, y]) => [
        y / METERS_PER_LATITUDE_DEGREE,
        x / metersPerLongitudeDegree,
    ]);
    if (points.length > 1 &&
        points[0][0] === points.at(-1)[0] &&
        points[0][1] === points.at(-1)[1]) {
        points.pop();
    }
    return points;
}

function hasPolygonArea(geometry) {
    return geometry.some((polygon) =>
        polygon[0]?.length >= 4 &&
        Math.abs(polygon[0].reduce((area, point, index, ring) => {
            const next = ring[(index + 1) % ring.length];
            return area + point[0] * next[1] - next[0] * point[1];
        }, 0)) > 1e-6
    );
}

function isMappableHouse(house) {
    return Number.isFinite(house.lat) &&
        Number.isFinite(house.lon) &&
        house.lat >= -90 && house.lat <= 90 &&
        house.lon >= -180 && house.lon <= 180;
}

function convexHull(points) {
    if (points.length <= 1) return points;

    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (origin, a, b) =>
        (a.x - origin.x) * (b.y - origin.y) -
        (a.y - origin.y) * (b.x - origin.x);
    const lower = [];
    const upper = [];

    sorted.forEach((point) => {
        while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) {
            lower.pop();
        }
        lower.push(point);
    });
    [...sorted].reverse().forEach((point) => {
        while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) {
            upper.pop();
        }
        upper.push(point);
    });

    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Builds a candidate Beat boundary around houses with collection history.
 *
 * options.distanceLimitMeters: houses farther than this from the existing Beat boundary (or,
 *   without a usable boundary, from every other house) are left out as too far away.
 * options.existingFencePolygons: the Beat's current boundary, as [lat, lon] rings.
 * options.neighborMode: how the candidate meets neighbouring Beat fences.
 *   "trim"    (default) cut the candidate where it overlaps a neighbour; houses there stay out.
 *   "take"    where an overlap holds this Beat's collected houses, cut it out of the neighbour's
 *             fence instead, so those houses move to this Beat; other overlaps are trimmed.
 *             The fences still do not overlap.
 *   "overlap" keep both fences whole, overlapping.
 *   (options.trimToNeighbors: false is accepted as "overlap".)
 * neighboringFences[].houses: optional [{house_id, lat, lon}] of each neighbour, used to report
 *   the neighbour's own houses that end up inside the new fence.
 */
export function createEmployeeGeofence(houses, neighboringFences = [], options = {}) {
    const distanceLimit = clampDistanceLimit(options.distanceLimitMeters ?? OUTLIER_DISTANCE_METERS);
    const neighborMode = ["trim", "take", "overlap"].includes(options.neighborMode)
        ? options.neighborMode
        : options.trimToNeighbors === false ? "overlap" : "trim";
    const trimToNeighbors = neighborMode === "trim";
    const allMappedHouses = houses.filter(isMappableHouse);
    const missingHouseIds = houses
        .filter((house) => !isMappableHouse(house))
        .map(houseIdOf);

    if (!allMappedHouses.length) {
        return {
            polygon: [],
            polygons: [],
            missingHouseIds,
            includedHouseIds: [],
            outlierHouseIds: [],
            outsideHouseIds: [],
            overlappingNeighborIds: [],
            overlappingNeighborNames: [],
            geometryError: "",
            distanceLimitMeters: distanceLimit,
            outlierRule: "isolated",
            trimmedToNeighbors: trimToNeighbors,
            neighborMode,
            neighborUpdates: [],
            takenHouses: [],
        };
    }

    const referenceLatitude = allMappedHouses.reduce((sum, house) => sum + house.lat, 0) /
        allMappedHouses.length;
    const metersPerLongitudeDegree = Math.max(
        1,
        METERS_PER_LATITUDE_DEGREE * Math.cos(referenceLatitude * Math.PI / 180),
    );
    const project = (house) => ({
        x: house.lon * metersPerLongitudeDegree,
        y: house.lat * METERS_PER_LATITUDE_DEGREE,
    });
    // With an existing boundary, houses more than distanceLimit outside it are left out.
    // Without one, houses more than distanceLimit from every other house are treated as likely
    // coordinate errors. Isolated houses are only excluded while most houses remain, so a
    // genuinely sparse Beat is not emptied.
    const existingRings = toProjectedPolygon(options.existingFencePolygons || [], metersPerLongitudeDegree);
    const outlierRule = existingRings.length ? "existingBoundary" : "isolated";
    let isolatedIndexes;
    let excludeOutliers;
    if (outlierRule === "existingBoundary") {
        isolatedIndexes = new Set(allMappedHouses.map(project)
            .map((point, index) => ({index, distance: Math.min(...existingRings.map((ring) => distanceToRing(point, ring)))}))
            .filter((item) => item.distance > distanceLimit)
            .map((item) => item.index));
        excludeOutliers = isolatedIndexes.size > 0;
    } else {
        isolatedIndexes = new Set(findIsolatedPointIndexes(allMappedHouses.map(project), distanceLimit));
        excludeOutliers = isolatedIndexes.size > 0 &&
            isolatedIndexes.size * 2 < allMappedHouses.length;
    }
    const mappedHouses = excludeOutliers
        ? allMappedHouses.filter((_, index) => !isolatedIndexes.has(index))
        : allMappedHouses;
    const outlierHouseIds = excludeOutliers
        ? allMappedHouses.filter((_, index) => isolatedIndexes.has(index)).map(houseIdOf)
        : [];
    const includedHouseIds = mappedHouses.map(houseIdOf);
    const ruleDetails = {
        distanceLimitMeters: distanceLimit,
        outlierRule,
        trimmedToNeighbors: trimToNeighbors,
        neighborMode,
        neighborUpdates: [],
        takenHouses: [],
    };
    if (!mappedHouses.length) {
        return {
            polygon: [],
            polygons: [],
            missingHouseIds,
            includedHouseIds,
            outlierHouseIds,
            outsideHouseIds: [],
            overlappingNeighborIds: [],
            overlappingNeighborNames: [],
            geometryError: "",
            ...ruleDetails,
        };
    }
    const projectedPoints = mappedHouses.map(project);
    const bufferedHullRing = (points) => closeRing(convexHull(points.flatMap((point) =>
        Array.from({length: BUFFER_CIRCLE_SEGMENTS}, (_, index) => {
            const angle = 2 * Math.PI * index / BUFFER_CIRCLE_SEGMENTS;
            return {
                x: point.x + BUFFER_METERS * Math.cos(angle),
                y: point.y + BUFFER_METERS * Math.sin(angle),
            };
        })
    )).map((point) => [point.x, point.y]));
    // A Beat can have several separate areas (for example one employee with two Beats). Each
    // collected house belongs to the existing area it is in or nearest to, and every area gets
    // its own boundary, so separate areas are not joined across the streets between them.
    // Existing areas with no collected houses (such as an office area shared by every Beat)
    // are kept unchanged and never cut from or into a neighbour.
    const housesByArea = new Map();
    projectedPoints.forEach((point) => {
        let area = 0;
        if (existingRings.length > 1) {
            let best = Infinity;
            existingRings.forEach((ring, index) => {
                const distance = distanceToRing(point, ring);
                if (distance < best) {
                    best = distance;
                    area = index;
                }
            });
        }
        if (!housesByArea.has(area)) housesByArea.set(area, []);
        housesByArea.get(area).push(point);
    });
    const preservedRings = existingRings.length
        ? existingRings.filter((_, index) => !housesByArea.has(index))
        : [];
    const areaGeometries = [...housesByArea.values()].map((points) => [[bufferedHullRing(points)]]);
    const insideProjected = (point, polygon) =>
        distanceToRing(point, polygon[0]) === 0 &&
        !polygon.slice(1).some((hole) => distanceToRing(point, hole) === 0);
    const collectedIdSet = new Set(includedHouseIds.map(String));
    const projectedNeighborFences = neighboringFences.map((fence) => ({
        id: fence.id,
        name: fence.name,
        latLonPolygons: fence.polygons || [],
        houses: fence.houses || [],
        // The neighbour's own houses: listed in its Beat and not also listed as this Beat's houses.
        ownPoints: (fence.houses || [])
            .filter((house) => isMappableHouse(house) && !collectedIdSet.has(String(houseIdOf(house))))
            .map(project),
        polygons: toProjectedPolygon(fence.polygons || [], metersPerLongitudeDegree)
            .map((ring) => [ring]),
    })).filter((fence) => fence.polygons.length);
    const contested = new Map();
    // reason "mostly": the neighbour's own houses outnumber this Beat's there;
    // reason "hole": taking it would leave a hole inside the neighbour's fence.
    const markContested = (fence, collectedHouses, neighborHouses, reason) => {
        const entry = contested.get(fence.id) || {
            neighborId: fence.id,
            neighborName: fence.name || String(fence.id),
            collectedHouses: 0,
            neighborHouses: 0,
            reasons: [],
        };
        entry.collectedHouses += collectedHouses;
        entry.neighborHouses += neighborHouses;
        if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
        contested.set(fence.id, entry);
    };
    const overlappingNeighborIds = [];
    const overlappingNeighborNames = [];
    const noteOverlap = (fence) => {
        if (overlappingNeighborIds.includes(String(fence.id))) return;
        overlappingNeighborIds.push(String(fence.id));
        overlappingNeighborNames.push(fence.name || String(fence.id));
    };
    let clippedGeometry;
    let neighborUpdates = [];
    let neighborError = "";
    try {
        let candidateGeometry = areaGeometries.length > 1
            ? polygonClipping.union(areaGeometries[0], ...areaGeometries.slice(1))
            : areaGeometries[0];
        // Each overlap with a neighbour's area is decided on its own. In "take" mode only the area
        // around this Beat's collected houses in that overlap is taken, and only when those houses
        // outnumber the neighbour's own houses there; everything else (and every overlap in "trim"
        // mode) is trimmed from the candidate. So a neighbour is never cut where this Beat has no
        // collected house, or where the houses are mostly the neighbour's.
        const trimParts = [];
        const takeParts = new Map();
        projectedNeighborFences.forEach((fence) => {
            fence.polygons.forEach((piece) => {
                const parts = polygonClipping.intersection(candidateGeometry, piece)
                    .filter((part) => hasPolygonArea([part]));
                if (!parts.length) return;
                noteOverlap(fence);
                if (neighborMode === "overlap") return;
                parts.forEach((part) => {
                    const ours = neighborMode === "take"
                        ? projectedPoints.filter((point) => insideProjected(point, part))
                        : [];
                    if (!ours.length) {
                        trimParts.push(part);
                        return;
                    }
                    // Anchor the taken area to this Beat's nearby houses outside the overlap, so it
                    // joins this Beat's side instead of becoming an island inside the neighbour.
                    const anchors = projectedPoints.filter((point) =>
                        !insideProjected(point, part) &&
                        ours.some((own) => Math.hypot(own.x - point.x, own.y - point.y) <= distanceLimit));
                    const region = polygonClipping.intersection([part], [[bufferedHullRing([...ours, ...anchors])]])
                        .filter((item) => hasPolygonArea([item]));
                    const theirs = fence.ownPoints.filter((point) =>
                        region.some((item) => insideProjected(point, item))).length;
                    if (!region.length || theirs > ours.length) {
                        trimParts.push(part);
                        markContested(fence, ours.length, theirs, "mostly");
                        return;
                    }
                    if (!takeParts.has(fence.id)) takeParts.set(fence.id, {parts: [], whole: [], ours: 0});
                    const taking = takeParts.get(fence.id);
                    taking.parts.push(...region);
                    taking.whole.push(part);
                    taking.ours += ours.length;
                    const rest = polygonClipping.difference([part], ...region.map((item) => [item]))
                        .filter((item) => hasPolygonArea([item]));
                    trimParts.push(...rest);
                });
            });
        });
        // A cut that would leave a hole inside the neighbour's fence is not made; that overlap
        // is trimmed from the candidate instead and reported.
        const holeFree = new Map();
        takeParts.forEach((taking, fenceId) => {
            const fence = projectedNeighborFences.find((item) => item.id === fenceId);
            const remaining = polygonClipping.difference(fence.polygons, ...taking.parts.map((item) => [item]));
            if (remaining.some((polygon) => polygon.length > 1)) {
                trimParts.push(...taking.whole);
                markContested(fence, taking.ours, 0, "hole");
            } else {
                holeFree.set(fenceId, remaining);
            }
        });
        if (trimParts.length) {
            candidateGeometry = polygonClipping.difference(candidateGeometry, ...trimParts);
        }
        clippedGeometry = candidateGeometry;
        neighborUpdates = projectedNeighborFences
            .filter((fence) => holeFree.has(fence.id))
            .map((fence) => {
                const remaining = holeFree.get(fence.id);
                const name = fence.name || String(fence.id);
                const polygons = remaining
                    .filter((polygon) => polygon[0]?.length >= 4)
                    .map((polygon) => toLatLonRing(polygon[0], metersPerLongitudeDegree))
                    .filter((polygon) => polygon.length >= 3);
                if (!neighborError && !polygons.length) {
                    neighborError = `The new fence would cover all of ${name}'s fence. Lower the distance limit or use "Leave them out".`;
                }
                return {id: fence.id, name, polygons, latLonPolygons: fence.latLonPolygons, houses: fence.houses};
            });
    } catch (error) {
        const detail = error instanceof Error ? error.message : "Invalid polygon geometry.";
        return {
            polygon: [],
            polygons: [],
            missingHouseIds,
            includedHouseIds,
            outlierHouseIds,
            outsideHouseIds: includedHouseIds,
            overlappingNeighborIds: [],
            overlappingNeighborNames: [],
            ...ruleDetails,
            geometryError: `Could not safely align this geofence with neighboring boundaries: ${detail}`,
        };
    }
    const hasUnsupportedHoles = clippedGeometry.some((polygon) => polygon.length > 1);
    const geometryError = hasUnsupportedHoles
        ? "A neighboring fence would create a hole in the new boundary. The candidate cannot be represented safely."
        : neighborError;
    const builtPolygons = geometryError
        ? []
        : clippedGeometry
            .filter((polygon) => polygon[0]?.length >= 4)
            .map((polygon) => toLatLonRing(polygon[0], metersPerLongitudeDegree))
            .filter((polygon) => polygon.length >= 3);
    const keptAreas = builtPolygons.length
        ? preservedRings.map((ring) => toLatLonRing(ring, metersPerLongitudeDegree)).filter((ring) => ring.length >= 3)
        : [];
    const polygons = [...builtPolygons, ...keptAreas];
    const outsideHouseIds = mappedHouses
        .filter((house) => !polygons.some((polygon) => isInsidePolygon(house, polygon)))
        .map(houseIdOf);
    const insideAny = (house, rings) => rings.some((ring) => ring.length >= 3 && isInsidePolygon(house, ring));
    // Collected houses that lie in a neighbour's current fence and move to this Beat, plus the
    // neighbour's own listed houses that the new fence now covers.
    const takenHouses = geometryError ? [] : neighborUpdates.map((update) => ({
        neighborId: update.id,
        neighborName: update.name,
        collectedHouseIds: mappedHouses
            .filter((house) => insideAny(house, update.latLonPolygons))
            .map(houseIdOf),
        neighborHouseIds: update.houses
            .filter((house) => isMappableHouse(house) && insideAny(house, polygons))
            .map(houseIdOf),
    }));

    return {
        polygon: polygons[0] || [],
        polygons,
        missingHouseIds,
        includedHouseIds,
        outlierHouseIds,
        outsideHouseIds,
        overlappingNeighborIds,
        overlappingNeighborNames,
        geometryError,
        ...ruleDetails,
        neighborUpdates: geometryError
            ? []
            : neighborUpdates.map(({id, name, polygons: rings}) => ({id, name, polygons: rings})),
        takenHouses,
        // Overlaps not taken: the neighbour's own houses outnumber this Beat's there, or taking
        // them would leave a hole in the neighbour's fence.
        contestedNeighbors: geometryError ? [] : [...contested.values()],
        builtAreaCount: builtPolygons.length,
        keptAreaCount: keptAreas.length,
    };
}
