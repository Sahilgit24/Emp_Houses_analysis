import assert from "node:assert/strict";
import test from "node:test";
import {createEmployeeGeofence} from "../src/data/employeeGeofence.js";
import {analyzeHouseCoverage} from "../src/data/employeePerformance.js";
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

test("candidate inputs include only houses collected by the assigned employee", () => {
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
            house_id: "other",
            lat: 41.881,
            lon: -87.631,
            scannerUserId: "8",
            scanningDate: "2026-10-16T09:30:00Z",
            history: {collectionDates: ["2026-10-16"]},
        },
        {
            house_id: "assigned-no-coordinates",
            lat: null,
            lon: null,
            scannerUserId: "7",
            scanningDate: "2026-10-16T10:00:00Z",
            history: {collectionDates: ["2026-10-16"]},
        },
    ];
    const collection = analyzeHouseCoverage(houses, [], null, null, {id: "7"});
    const assignedHouses = collection.details
        .filter((detail) => detail.assignedCollectionDates.length > 0)
        .map((detail) => detail.house);
    const candidate = createEmployeeGeofence(assignedHouses);

    assert.deepEqual(candidate.includedHouseIds, ["assigned"]);
    assert.deepEqual(candidate.missingHouseIds, ["assigned-no-coordinates"]);
    assert.deepEqual(candidate.outsideHouseIds, []);
});
