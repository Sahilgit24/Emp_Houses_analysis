import assert from "node:assert/strict";
import test from "node:test";
import {createEmployeeGeofence} from "../src/data/employeeGeofence.js";
import {getHistoricallyCollectedHouses} from "../src/data/employeePerformance.js";
import {isInsidePolygon} from "../src/data/routeBeatData.js";

test("employee geofence encloses mapped houses for single, linear, and polygon inputs", () => {
    const houseGroups = [
        [{house_id: "one", lat: 41.88, lon: -87.63}],
        [
            {house_id: "first", lat: 41.88, lon: -87.63},
            {house_id: "second", lat: 41.881, lon: -87.63},
        ],
        [
            {house_id: "northwest", lat: 41.881, lon: -87.632},
            {house_id: "northeast", lat: 41.881, lon: -87.628},
            {house_id: "south", lat: 41.878, lon: -87.63},
        ],
    ];

    houseGroups.forEach((houses) => {
        const {polygon} = createEmployeeGeofence(houses);

        assert.ok(polygon.length >= 3);
        houses.forEach((house) => assert.equal(isInsidePolygon(house, polygon), true));
    });
});

test("employee geofence reports unmappable houses and handles an empty mapped set", () => {
    const result = createEmployeeGeofence([
        {house_id: "mapped", lat: 41.88, lon: -87.63},
        {house_id: "missing", lat: null, lon: null},
    ]);
    const emptyResult = createEmployeeGeofence([
        {house_id: "missing", lat: null, lon: null},
    ]);

    assert.deepEqual(result.missingHouseIds, ["missing"]);
    assert.deepEqual(result.includedHouseIds, ["mapped"]);
    assert.equal(isInsidePolygon({lat: 41.88, lon: -87.63}, result.polygon), true);
    assert.deepEqual(emptyResult.polygon, []);
    assert.deepEqual(emptyResult.missingHouseIds, ["missing"]);
});

test("geofence candidates include every house with history, regardless of scanner", () => {
    const houses = [
        {
            house_id: "assigned",
            lat: 41.88,
            lon: -87.63,
            scannerUserId: "7",
            scanningDate: "2026-10-16T09:00:00Z",
            history: {collectionDates: ["2026-10-16"]},
        },
        {
            house_id: "other-employee",
            lat: 41.881,
            lon: -87.631,
            scannerUserId: "8",
            scanningDate: "2026-10-16T09:30:00Z",
            history: {collectionDates: ["2026-10-16"]},
        },
        {
            house_id: "historical-no-coordinates",
            lat: null,
            lon: null,
            scannerUserId: "8",
            scanningDate: "2026-10-15T10:00:00Z",
            history: {collectionDates: ["2026-10-15"]},
        },
        {
            house_id: "never-collected",
            lat: 41.882,
            lon: -87.632,
            scannerUserId: null,
            scanningDate: null,
            history: {collectionDates: []},
        },
    ];
    const historyHouses = getHistoricallyCollectedHouses(houses, [], {id: "7"});
    const candidate = createEmployeeGeofence(historyHouses);

    assert.deepEqual(candidate.includedHouseIds, ["assigned", "other-employee"]);
    assert.deepEqual(candidate.missingHouseIds, ["historical-no-coordinates"]);
    assert.deepEqual(candidate.outsideHouseIds, []);
});

test("candidate fence clips to neighboring boundaries while preserving historical houses", () => {
    const houses = [
        {house_id: "west", lat: 41.88, lon: -87.628},
        {house_id: "north", lat: 41.8803, lon: -87.628},
    ];
    const candidate = createEmployeeGeofence(houses, [{
        id: "neighbor",
        name: "Neighbor Beat",
        polygons: [[
            [41.8798, -87.6279],
            [41.8805, -87.6279],
            [41.8805, -87.6274],
            [41.8798, -87.6274],
        ]],
    }]);

    assert.deepEqual(candidate.overlappingNeighborIds, ["neighbor"]);
    assert.deepEqual(candidate.overlappingNeighborNames, ["Neighbor Beat"]);
    assert.deepEqual(candidate.outsideHouseIds, []);
    assert.equal(candidate.polygons.length, 1);
    houses.forEach((house) =>
        assert.ok(candidate.polygons.some((polygon) => isInsidePolygon(house, polygon)))
    );
    assert.equal(
        candidate.polygons.some((polygon) =>
            isInsidePolygon({lat: 41.88, lon: -87.6277}, polygon)
        ),
        false,
    );
});

test("reports historical houses that conflict with a neighboring fence", () => {
    const candidate = createEmployeeGeofence([
        {house_id: "inside-neighbor", lat: 41.88, lon: -87.6277},
    ], [{
        id: "neighbor",
        polygons: [[
            [41.8798, -87.6279],
            [41.8805, -87.6279],
            [41.8805, -87.6274],
            [41.8798, -87.6274],
        ]],
    }]);

    assert.deepEqual(candidate.outsideHouseIds, ["inside-neighbor"]);
});

// ~111 m per 0.001° latitude; 0.005° ≈ 557 m.
function houseGrid(prefix, lat, lon, count = 4) {
    return Array.from({length: count}, (_, index) => ({
        house_id: `${prefix}${index + 1}`,
        lat: lat + (index % 2) * 0.0005,
        lon: lon + Math.floor(index / 2) * 0.0005,
    }));
}

test("excludes a house more than 500 m from every other house and reports it", () => {
    const houses = [
        ...houseGrid("H", 21.15, 79.09),
        {house_id: "far-away", lat: 21.165, lon: 79.09}, // ~1.6 km north
    ];
    const candidate = createEmployeeGeofence(houses);

    assert.deepEqual(candidate.outlierHouseIds, ["far-away"]);
    assert.deepEqual(candidate.includedHouseIds, ["H1", "H2", "H3", "H4"]);
    assert.deepEqual(candidate.outsideHouseIds, []);
    assert.equal(isInsidePolygon({lat: 21.165, lon: 79.09}, candidate.polygon), false);
    assert.equal(isInsidePolygon({lat: 21.158, lon: 79.09}, candidate.polygon), false);
});

test("keeps a house within 500 m of its nearest neighbour", () => {
    const houses = [
        ...houseGrid("H", 21.15, 79.09),
        {house_id: "near", lat: 21.154, lon: 79.09}, // ~390 m from the nearest house
    ];
    const candidate = createEmployeeGeofence(houses);

    assert.deepEqual(candidate.outlierHouseIds, []);
    assert.equal(isInsidePolygon({lat: 21.154, lon: 79.09}, candidate.polygon), true);
});

test("does not exclude isolated houses when they are half or more of the Beat", () => {
    const houses = [
        {house_id: "a", lat: 21.15, lon: 79.09},
        {house_id: "b", lat: 21.16, lon: 79.09},
        {house_id: "c", lat: 21.17, lon: 79.09},
    ];
    const candidate = createEmployeeGeofence(houses);

    assert.deepEqual(candidate.outlierHouseIds, []);
    assert.deepEqual(candidate.includedHouseIds, ["a", "b", "c"]);
    houses.forEach((house) => assert.equal(isInsidePolygon(house, candidate.polygon), true));
});
