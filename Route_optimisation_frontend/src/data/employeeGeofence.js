import {isInsidePolygon} from "./routeBeatData.js";

const METERS_PER_LATITUDE_DEGREE = 111320;
const BUFFER_METERS = 20;
const BUFFER_CIRCLE_SEGMENTS = 24;

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

export function createEmployeeGeofence(houses) {
    const mappedHouses = houses.filter(isMappableHouse);
    const missingHouseIds = houses
        .filter((house) => !isMappableHouse(house))
        .map((house) => house.house_id || house.houseId || "House ID unavailable");
    const includedHouseIds = mappedHouses.map((house) =>
        house.house_id || house.houseId || "House ID unavailable"
    );

    if (!mappedHouses.length) {
        return {polygon: [], missingHouseIds, includedHouseIds, outsideHouseIds: []};
    }

    const referenceLatitude = mappedHouses.reduce((sum, house) => sum + house.lat, 0) /
        mappedHouses.length;
    const metersPerLongitudeDegree = Math.max(
        1,
        METERS_PER_LATITUDE_DEGREE * Math.cos(referenceLatitude * Math.PI / 180),
    );
    const projectedPoints = mappedHouses.map((house) => ({
        x: house.lon * metersPerLongitudeDegree,
        y: house.lat * METERS_PER_LATITUDE_DEGREE,
    }));
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
    const polygon = convexHull(bufferedPoints).map((point) => [
        point.y / METERS_PER_LATITUDE_DEGREE,
        point.x / metersPerLongitudeDegree,
    ]);
    const outsideHouseIds = mappedHouses
        .filter((house) => !isInsidePolygon(house, polygon))
        .map((house) => house.house_id || house.houseId || "House ID unavailable");

    return {polygon, missingHouseIds, includedHouseIds, outsideHouseIds};
}
