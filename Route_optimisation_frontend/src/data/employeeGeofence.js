import polygonClipping from "polygon-clipping";
import {isInsidePolygon} from "./routeBeatData.js";

const METERS_PER_LATITUDE_DEGREE = 111320;
const BUFFER_METERS = 20;
const BUFFER_CIRCLE_SEGMENTS = 24;
export const OUTLIER_DISTANCE_METERS = 500;

const houseIdOf = (house) => house.house_id || house.houseId || "House ID unavailable";

// Indexes of points with no other point within OUTLIER_DISTANCE_METERS.
// Uses a grid of OUTLIER_DISTANCE_METERS cells so each point only checks the 3x3 cells around it.
function findIsolatedPointIndexes(points) {
    if (points.length < 2) return [];
    const cellKey = (cx, cy) => `${cx}:${cy}`;
    const cells = new Map();
    points.forEach((point, index) => {
        const key = cellKey(
            Math.floor(point.x / OUTLIER_DISTANCE_METERS),
            Math.floor(point.y / OUTLIER_DISTANCE_METERS),
        );
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(index);
    });
    const limitSquared = OUTLIER_DISTANCE_METERS ** 2;
    return points.reduce((isolated, point, index) => {
        const cx = Math.floor(point.x / OUTLIER_DISTANCE_METERS);
        const cy = Math.floor(point.y / OUTLIER_DISTANCE_METERS);
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

export function createEmployeeGeofence(houses, neighboringFences = []) {
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
    // Houses more than OUTLIER_DISTANCE_METERS from every other house are treated as likely
    // coordinate errors and left out of the boundary. They are only excluded while most
    // houses remain, so a genuinely sparse Beat is not emptied.
    const isolatedIndexes = new Set(findIsolatedPointIndexes(allMappedHouses.map(project)));
    const excludeOutliers = isolatedIndexes.size > 0 &&
        isolatedIndexes.size * 2 < allMappedHouses.length;
    const mappedHouses = excludeOutliers
        ? allMappedHouses.filter((_, index) => !isolatedIndexes.has(index))
        : allMappedHouses;
    const outlierHouseIds = excludeOutliers
        ? allMappedHouses.filter((_, index) => isolatedIndexes.has(index)).map(houseIdOf)
        : [];
    const includedHouseIds = mappedHouses.map(houseIdOf);
    const projectedPoints = mappedHouses.map(project);
    const sourceHull = convexHull(projectedPoints);
    const bufferedPoints = sourceHull.flatMap((point) =>
        Array.from({length: BUFFER_CIRCLE_SEGMENTS}, (_, index) => {
            const angle = 2 * Math.PI * index / BUFFER_CIRCLE_SEGMENTS;
            return {
                x: point.x + BUFFER_METERS * Math.cos(angle),
                y: point.y + BUFFER_METERS * Math.sin(angle),
            };
        })
    );
    const candidateRing = closeRing(convexHull(bufferedPoints).map((point) => [
        point.x,
        point.y,
    ]));
    const candidateGeometry = [candidateRing];
    const projectedNeighborFences = neighboringFences.map((fence) => ({
        id: fence.id,
        name: fence.name,
        polygons: toProjectedPolygon(fence.polygons || [], metersPerLongitudeDegree)
            .map((ring) => [ring]),
    })).filter((fence) => fence.polygons.length);
    let overlappingNeighborIds;
    let overlappingNeighborNames;
    let clippedGeometry;
    try {
        overlappingNeighborIds = projectedNeighborFences
            .filter((fence) => hasPolygonArea(polygonClipping.intersection(
                candidateGeometry,
                ...fence.polygons,
            )))
            .map((fence) => String(fence.id));
        overlappingNeighborNames = projectedNeighborFences
            .filter((fence) => overlappingNeighborIds.includes(String(fence.id)))
            .map((fence) => fence.name || String(fence.id));
        const neighboringGeometry = projectedNeighborFences.flatMap((fence) => fence.polygons);
        const neighboringUnion = neighboringGeometry.length
            ? polygonClipping.union(neighboringGeometry[0], ...neighboringGeometry.slice(1))
            : null;
        clippedGeometry = neighboringUnion
            ? polygonClipping.difference(candidateGeometry, neighboringUnion)
            : [candidateGeometry];
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
            geometryError: `Could not safely align this geofence with neighboring boundaries: ${detail}`,
        };
    }
    const hasUnsupportedHoles = clippedGeometry.some((polygon) => polygon.length > 1);
    const geometryError = hasUnsupportedHoles
        ? "A neighboring fence would create a hole in the new boundary. The candidate cannot be represented safely."
        : "";
    const polygons = geometryError
        ? []
        : clippedGeometry
            .filter((polygon) => polygon[0]?.length >= 4)
            .map((polygon) => toLatLonRing(polygon[0], metersPerLongitudeDegree))
            .filter((polygon) => polygon.length >= 3);
    const outsideHouseIds = mappedHouses
        .filter((house) => !polygons.some((polygon) => isInsidePolygon(house, polygon)))
        .map(houseIdOf);

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
    };
}
