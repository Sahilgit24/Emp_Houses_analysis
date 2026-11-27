import assert from "node:assert/strict";
import test from "node:test";
import {createEmployeeGeofence, findHousesInSeveralBeats, mergeCollectedHouses} from "../src/data/employeeGeofence.js";
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

test("excludes a house more than 100 m from every other house and reports it", () => {
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

test("excludes a house about 390 m from its nearest neighbour", () => {
    const houses = [
        ...houseGrid("H", 21.15, 79.09),
        {house_id: "far", lat: 21.154, lon: 79.09}, // ~390 m from the nearest house
    ];
    const candidate = createEmployeeGeofence(houses);

    assert.deepEqual(candidate.outlierHouseIds, ["far"]);
    assert.equal(isInsidePolygon({lat: 21.154, lon: 79.09}, candidate.polygon), false);
});

test("keeps a house within 100 m of its nearest neighbour", () => {
    const houses = [
        ...houseGrid("H", 21.15, 79.09),
        {house_id: "near", lat: 21.1512, lon: 79.09}, // ~78 m from the nearest house
    ];
    const candidate = createEmployeeGeofence(houses);

    assert.deepEqual(candidate.outlierHouseIds, []);
    assert.equal(isInsidePolygon({lat: 21.1512, lon: 79.09}, candidate.polygon), true);
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

test("the distance limit setting decides which isolated houses are left out", () => {
    const houses = [
        ...houseGrid("H", 21.15, 79.09),
        {house_id: "far", lat: 21.154, lon: 79.09}, // ~390 m from the nearest house
    ];
    assert.deepEqual(createEmployeeGeofence(houses, [], {distanceLimitMeters: 100}).outlierHouseIds, ["far"]);
    const wide = createEmployeeGeofence(houses, [], {distanceLimitMeters: 500});
    assert.deepEqual(wide.outlierHouseIds, []);
    assert.equal(wide.distanceLimitMeters, 500);
    assert.equal(isInsidePolygon({lat: 21.154, lon: 79.09}, wide.polygon), true);
});

test("with an existing boundary, houses beyond the limit outside it are left out", () => {
    // Existing Beat: a square of about 110 m around 21.150-21.151, 79.090-79.091.
    const existing = [[[21.15, 79.09], [21.151, 79.09], [21.151, 79.091], [21.15, 79.091]]];
    const houses = [
        {house_id: "inside", lat: 21.1505, lon: 79.0905},
        {house_id: "near", lat: 21.1515, lon: 79.0905}, // ~55 m outside
        {house_id: "far", lat: 21.154, lon: 79.0905}, // ~330 m outside
    ];
    const candidate = createEmployeeGeofence(houses, [], {
        distanceLimitMeters: 100,
        existingFencePolygons: existing,
    });
    assert.equal(candidate.outlierRule, "existingBoundary");
    assert.deepEqual(candidate.outlierHouseIds, ["far"]);
    assert.deepEqual(candidate.includedHouseIds, ["inside", "near"]);

    const wide = createEmployeeGeofence(houses, [], {distanceLimitMeters: 400, existingFencePolygons: existing});
    assert.deepEqual(wide.outlierHouseIds, []);
});

test("not trimming to neighbours keeps houses that lie inside a neighbouring fence", () => {
    const neighbor = [{
        id: "neighbor",
        polygons: [[
            [41.8798, -87.6279],
            [41.8805, -87.6279],
            [41.8805, -87.6274],
            [41.8798, -87.6274],
        ]],
    }];
    const houses = [
        {house_id: "own", lat: 41.88, lon: -87.6285},
        {house_id: "inside-neighbor", lat: 41.88, lon: -87.6277},
    ];
    assert.deepEqual(createEmployeeGeofence(houses, neighbor).outsideHouseIds, ["inside-neighbor"]);
    const untrimmed = createEmployeeGeofence(houses, neighbor, {trimToNeighbors: false});
    assert.deepEqual(untrimmed.outsideHouseIds, []);
    assert.equal(untrimmed.trimmedToNeighbors, false);
});

test("take mode moves collected houses from a neighbour and shrinks the neighbour's fence", () => {
    // Neighbour fence: a square east of this Beat. "shared" is collected by this Beat but sits inside it.
    const neighbor = [{
        id: "neighbor",
        name: "Neighbor Beat",
        polygons: [[[21.149, 79.0915], [21.152, 79.0915], [21.152, 79.095], [21.149, 79.095]]],
        houses: [
            {house_id: "neighbor-near", lat: 21.1505, lon: 79.0918},
            {house_id: "neighbor-far", lat: 21.1505, lon: 79.094},
        ],
    }];
    const houses = [
        ...houseGrid("H", 21.15, 79.09),
        {house_id: "shared", lat: 21.1505, lon: 79.092}, // ~50 m inside the neighbour fence, ~155 m from H
    ];

    const trimmed = createEmployeeGeofence(houses, neighbor, {distanceLimitMeters: 300});
    assert.deepEqual(trimmed.outsideHouseIds, ["shared"]);

    const taken = createEmployeeGeofence(houses, neighbor, {neighborMode: "take", distanceLimitMeters: 300});
    assert.equal(taken.geometryError, "");
    assert.deepEqual(taken.outsideHouseIds, []);
    assert.ok(taken.polygons.some((polygon) => isInsidePolygon({lat: 21.1505, lon: 79.092}, polygon)));
    assert.equal(taken.neighborUpdates.length, 1);
    const [update] = taken.neighborUpdates;
    assert.equal(update.id, "neighbor");
    // The neighbour no longer covers the taken house, keeps its far house, and does not overlap.
    assert.equal(update.polygons.some((polygon) => isInsidePolygon({lat: 21.1505, lon: 79.092}, polygon)), false);
    assert.ok(update.polygons.some((polygon) => isInsidePolygon({lat: 21.1505, lon: 79.094}, polygon)));
    assert.deepEqual(taken.takenHouses[0].collectedHouseIds, ["shared"]);
    assert.deepEqual(taken.takenHouses[0].neighborHouseIds, ["neighbor-near"]);
});

test("take mode refuses to swallow a neighbour's whole fence", () => {
    const neighbor = [{
        id: "tiny",
        name: "Tiny Beat",
        polygons: [[[21.1501, 79.0901], [21.1503, 79.0901], [21.1503, 79.0903], [21.1501, 79.0903]]],
    }];
    const houses = [...houseGrid("H", 21.15, 79.09), {house_id: "in-tiny", lat: 21.1502, lon: 79.0902}];
    const candidate = createEmployeeGeofence(houses, neighbor, {neighborMode: "take"});
    assert.match(candidate.geometryError, /cover all of Tiny Beat/);
    assert.deepEqual(candidate.polygons, []);
});

test("take mode does not cut a neighbour where this Beat has no collected house", () => {
    const neighbor = [{
        id: "tiny",
        name: "Tiny Beat",
        polygons: [[[21.1501, 79.0901], [21.1503, 79.0901], [21.1503, 79.0903], [21.1501, 79.0903]]],
    }];
    const candidate = createEmployeeGeofence(houseGrid("H", 21.15, 79.09), neighbor, {neighborMode: "take"});
    // The neighbour sits inside this Beat's area without any of its collected houses, so it is
    // trimmed from the candidate (which would leave a hole) instead of being cut away.
    assert.deepEqual(candidate.neighborUpdates, []);
    assert.match(candidate.geometryError, /hole/);
});

// Two separate areas 300 m apart with another Beat between them, plus a small house-free area
// shared by every Beat (like an office). Mirrors an employee who has two Beats.
const twoAreaBeat = () => {
    const areaA = [[21.15, 79.09], [21.1510, 79.09], [21.1510, 79.0910], [21.15, 79.0910]];
    const areaB = [[21.15, 79.0940], [21.1510, 79.0940], [21.1510, 79.0950], [21.15, 79.0950]];
    const office = [[21.16, 79.10], [21.1601, 79.10], [21.1601, 79.1001], [21.16, 79.1001]];
    const between = [[21.1495, 79.0915], [21.1515, 79.0915], [21.1515, 79.0935], [21.1495, 79.0935]];
    const houses = [
        ...houseGrid("A", 21.1502, 79.0902),
        ...houseGrid("B", 21.1502, 79.0942),
    ];
    return {areaA, areaB, office, between, houses};
};

test("an employee with two separate Beat areas gets two fences, not one joined fence", () => {
    const {areaA, areaB, office, between, houses} = twoAreaBeat();
    const neighbors = [
        {id: "middle", name: "Middle Beat", polygons: [between, office]},
        {id: "other", name: "Other Beat", polygons: [office]},
    ];
    const candidate = createEmployeeGeofence(houses, neighbors, {
        neighborMode: "take",
        existingFencePolygons: [office, areaA, areaB],
    });
    assert.equal(candidate.geometryError, "");
    assert.equal(candidate.builtAreaCount, 2);
    assert.equal(candidate.keptAreaCount, 1);
    assert.deepEqual(candidate.outsideHouseIds, []);
    // The street between the two areas belongs to Middle Beat and is not taken.
    assert.equal(candidate.polygons.some((polygon) => isInsidePolygon({lat: 21.1505, lon: 79.0925}, polygon)), false);
    assert.deepEqual(candidate.neighborUpdates, []);
    // The shared office area is kept as it was and no neighbour loses it.
    assert.ok(candidate.polygons.some((polygon) => isInsidePolygon({lat: 21.16005, lon: 79.10005}, polygon)));
    assert.equal(candidate.overlappingNeighborIds.includes("other"), false);
});


test("finds houses listed in more than one Beat", () => {
    const beats = [
        {id: "a", assignedEmployee: {id: "39", name: "Rahul"}, houses: [{house_id: "H1"}, {house_id: "H2"}, {house_id: "H2"}]},
        {id: "b", assignedEmployee: {id: "37", name: "Nikesh"}, houses: [{house_id: "H2"}, {house_id: "H3"}]},
        {id: "c", beatName: "Beat C", houses: [{houseId: "H2"}, {house_id: "H1"}]},
    ];
    const shared = findHousesInSeveralBeats(beats);
    assert.deepEqual([...shared.keys()].sort(), ["H1", "H2"]);
    assert.deepEqual(shared.get("H2").map((owner) => owner.label), ["Rahul (39)", "Nikesh (37)", "Beat C"]);
    assert.equal(shared.has("H3"), false);
});

test("merges 30-day and live collected houses without dropping any", () => {
    const month = [{house_id: "H1", lat: 21, lon: 79}, {house_id: "H2", lat: 21.1, lon: 79.1}];
    const live = [{house_id: "H2", lat: 21.1, lon: 79.1}, {house_id: "H3", lat: 21.2, lon: 79.2}];
    const page = [{house_id: null, lat: 21.3, lon: 79.3}, {houseId: "H1", lat: 21, lon: 79}];
    const merged = mergeCollectedHouses(month, live, page);
    assert.deepEqual(merged.map((house) => house.house_id ?? "no-id"), ["H1", "H2", "H3", "no-id"]);
});
