import assert from "node:assert/strict";
import test from "node:test";
import {combineNormalizedBeatData, normalizeBeatApiPayload} from "../src/data/beatApiData.js";

const sample = {
    BeatWiseReport: {
        BeatUserId: 7,
        FromDate: "2026-10-14T00:00:00+05:30",
        ToDate: "2026-10-16T00:00:00+05:30",
        TotalHouses: 3,
        TotalScannedHouses: 2,
        TotalNotScannedHouses: 1,
        ScannedHouses: [
            {
                HouseId: "H1",
                ReferanceId: "R1",
                Lat: 21.01,
                Lon: 75.01,
                Scanned: true,
                ScannerUserId: 7,
                ScannerName: "Assigned worker",
                ScanningDate: "2026-10-16T09:00:00+05:30",
            },
            {
                HouseId: "H2",
                ReferanceId: "R2",
                Lat: 21.02,
                Lon: 75.02,
                Scanned: true,
                ScannerUserId: 8,
                ScannerName: "Other worker",
                ScanningDate: "2026-10-16T09:30:00+05:30",
            },
        ],
        NotScannedHouses: [
            {
                HouseId: "H3",
                ReferanceId: "R3",
                Lat: 21.03,
                Lon: 75.03,
                Scanned: false,
                ScannerUserId: null,
                ScannerName: null,
                ScanningDate: null,
            },
        ],
    },
    RouteDetails: {
        geofence: "21,75;21,76;22,76",
        houses: [{lat: 21.01, lon: 75.01}, {lat: 21.03, lon: 75.03}],
        dumpyards: [],
        routes: [
            {
                date: "2026-10-15",
                emproute: [{datetime: "2026-10-15T08:00:00", lat: 21.01, lon: 75.01}],
                Collectionlist: [{referanceId: "R1", datetime: "2026-10-15T09:00:00+05:30", lat: 21.01, lon: 75.01}],
                dumplist: [],
            },
            {
                date: "2026-10-16",
                emproute: [
                    {datetime: "2026-10-16T08:00:00", lat: 21.01, lon: 75.01},
                    {datetime: "2026-10-16T08:10:00", lat: 21.02, lon: 75.02},
                ],
                Collectionlist: [{referanceId: "R1", datetime: "2026-10-16T09:00:00+05:30", lat: 21.01, lon: 75.01}],
                dumplist: [],
            },
        ],
    },
};

test("normalizes owner, other-employee, and remaining houses with stable IDs", () => {
    const [beat] = normalizeBeatApiPayload(sample).beats;
    assert.deepEqual(beat.classificationCounts, {own: 1, other: 1, remaining: 1});
    assert.equal(beat.houses[0].houseId, "H1");
    assert.equal(beat.houses[0].collectionStatus, "own");
    assert.equal(beat.houses[1].collectionStatus, "other");
    assert.equal(beat.houses[2].collectionStatus, "remaining");
    assert.equal(beat.reportedTotalHouses, 3);
    assert.equal(beat.totalScannedHouses, 2);
    assert.equal(beat.totalNotScannedHouses, 1);
    assert.equal(beat.houses[0].isRouteHouse, true);
    assert.equal(beat.houses[1].isRouteHouse, true);
    assert.equal(beat.routeHouseCoordinates.length, 3);
});

test("uses ScanningDates history and computes intervals without Collectionlist", () => {
    const [beat] = normalizeBeatApiPayload(sample).beats;
    const house = beat.houses.find((item) => item.houseId === "H1");
    assert.deepEqual(house.history.collectionDates, ["2026-10-16"]);
    assert.equal(house.history.collectionCount, 1);
    assert.equal(house.history.typicalIntervalDays, null);
    assert.equal(house.history.currentGapDays, 0);
    assert.deepEqual(beat.routes[1].collectionScans, []);
    assert.ok(beat.routes[1].distanceKm > 0);
});

test("normalizes dump weight measurements from route records", () => {
    const withDumpWeight = structuredClone(sample);
    withDumpWeight.RouteDetails.routes[1].dumplist = [{
        referanceId: "D1",
        datetime: "2026-10-16T10:00:00+05:30",
        totalGcWeight: "125.5",
        totalWetWeight: 80,
        totalDryWeight: 45.5,
    }];

    const [beat] = normalizeBeatApiPayload(withDumpWeight).beats;
    assert.deepEqual(beat.routes[1].dumpEvents[0], {
        referenceId: "D1",
        datetime: "2026-10-16T10:00:00+05:30",
        lat: null,
        lon: null,
        totalGcWeight: 125.5,
        totalWetWeight: 80,
        totalDryWeight: 45.5,
        weightUnit: null,
        raw: withDumpWeight.RouteDetails.routes[1].dumplist[0],
    });
});

test("uses unique HouseIds and ignores RouteDetails houses and Collectionlist", () => {
    const newFormat = structuredClone(sample);
    newFormat.RouteDetails.houses = [{lat: "invalid", lon: "invalid"}];
    newFormat.RouteDetails.routes[0].Collectionlist = [null];

    const [beat] = normalizeBeatApiPayload(newFormat).beats;
    assert.equal(beat.houses.length, 3);
    assert.equal(beat.routeHouseCoordinates.length, 3);
    assert.deepEqual(beat.routes[0].collectionScans, []);
    assert.deepEqual(beat.houses.find((item) => item.houseId === "H3").history.collectionDates, []);
});

test("reads the geofence from BeatWiseReport", () => {
    const withReportGeofence = structuredClone(sample);
    withReportGeofence.BeatWiseReport.Geofence = "21.1,75.1;21.2,75.2;21.3,75.3";
    delete withReportGeofence.RouteDetails.geofence;

    const [beat] = normalizeBeatApiPayload(withReportGeofence).beats;
    assert.equal(beat.geofence, withReportGeofence.BeatWiseReport.Geofence);
    assert.deepEqual(beat.fencePoints, [[21.1, 75.1], [21.2, 75.2], [21.3, 75.3]]);
});

test("reads ScanningDates once per house and carries the row scanner to each date", () => {
    const withScanningDates = structuredClone(sample);
    withScanningDates.BeatWiseReport.ScannedHouses[0].ScanningDates = [
        "2026-10-14T09:00:00+05:30",
        "2026-10-15T09:00:00+05:30",
        "2026-10-15T10:00:00+05:30",
    ];

    const [beat] = normalizeBeatApiPayload(withScanningDates).beats;
    const house = beat.houses.find((item) => item.houseId === "H1");
    assert.deepEqual(house.history.collectionDates, ["2026-10-14", "2026-10-15", "2026-10-16"]);
    assert.deepEqual(
        house.historyEvents.map((event) => event.scannerUserId),
        ["7", "7", "7"],
    );
    assert.equal(house.history.collectionCount, 3);
});

test("keeps ScanningDate history even when the snapshot Scanned flag is false", () => {
    const withScanningDate = structuredClone(sample);
    const house = withScanningDate.BeatWiseReport.NotScannedHouses[0];
    house.ScannerUserId = 7;
    house.ScanningDate = "2026-10-16T10:00:00+05:30";

    const [beat] = normalizeBeatApiPayload(withScanningDate).beats;
    const normalizedHouse = beat.houses.find((item) => item.houseId === "H3");
    assert.equal(normalizedHouse.scanned, false);
    assert.deepEqual(normalizedHouse.history.collectionDates, ["2026-10-16"]);
});

test("rejects duplicate HouseIds instead of using row position as an identity", () => {
    const invalid = structuredClone(sample);
    invalid.BeatWiseReport.NotScannedHouses[0].HouseId = "H1";
    assert.throws(() => normalizeBeatApiPayload(invalid), /duplicate HouseId/);
});

test("combines separate files with distinct Beat IDs", () => {
    const secondFile = structuredClone(sample);
    secondFile.BeatWiseReport.BeatUserId = 8;
    const combined = combineNormalizedBeatData([
        normalizeBeatApiPayload(sample, "first.json"),
        normalizeBeatApiPayload(secondFile, "second.json"),
    ]);

    assert.deepEqual(combined.beats.map((beat) => beat.id), ["beat-user:7", "beat-user:8"]);
    assert.equal(combined.sourceName, "first.json, second.json");
});

test("rejects duplicate Beat IDs across files with both filenames", () => {
    assert.throws(
        () => combineNormalizedBeatData([
            normalizeBeatApiPayload(sample, "first.json"),
            normalizeBeatApiPayload(sample, "second.json"),
        ]),
        /Beat ID "beat-user:7" appears in both "first.json" and "second.json"/,
    );
});
