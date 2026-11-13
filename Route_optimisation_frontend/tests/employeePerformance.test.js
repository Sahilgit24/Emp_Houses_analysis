import assert from "node:assert/strict";
import test from "node:test";
import {
    analyzeCollectionGaps,
    analyzeDailyDistance,
    analyzeDailyTime,
    analyzeHouseCoverage,
    analyzeOutsideBeatCollections,
    buildSuggestedHouses,
    findLongGpsStops,
    getReportWindowDays,
} from "../src/data/employeePerformance.js";

test("derives the reporting window and flags unusually long collection gaps", () => {
    const gapAnalysis = analyzeCollectionGaps([{
        date: "2026-10-14",
        collectionScans: [
            {datetime: "2026-10-14T08:00:00+05:30"},
            {datetime: "2026-10-14T08:20:00+05:30"},
            {datetime: "2026-10-14T11:20:00+05:30"},
            {datetime: "2026-10-14T11:40:00+05:30"},
        ],
    }]);

    assert.equal(getReportWindowDays("2026-10-01", "2026-10-30"), 30);
    assert.equal(gapAnalysis.typicalGapMinutes, 20);
    assert.equal(gapAnalysis.longGapThresholdMinutes, 60);
    assert.equal(gapAnalysis.longGaps.length, 1);
    assert.equal(gapAnalysis.longGaps[0].minutes, 180);
});

test("prioritizes historically overdue houses without treating one current-day absence as overdue", () => {
    const houses = [
        {
            houseId: "overdue",
            collectionStatus: "own",
            history: {
                collectionDates: ["2026-10-01", "2026-10-06", "2026-10-11"],
                typicalIntervalDays: 5,
                currentGapDays: 15,
                attentionStatus: "Highly Overdue",
            },
        },
        {
            houseId: "regular",
            collectionStatus: "own",
            history: {
                collectionDates: ["2026-10-01", "2026-10-06"],
                typicalIntervalDays: 5,
                currentGapDays: 1,
                attentionStatus: "Regular",
            },
        },
        {
            houseId: "unscanned-window",
            collectionStatus: "remaining",
            history: {
                collectionDates: [],
                typicalIntervalDays: null,
                currentGapDays: null,
                attentionStatus: "Insufficient History",
            },
        },
    ];

    const suggestions = buildSuggestedHouses(houses, 30);

    assert.deepEqual(suggestions.map((item) => item.house.houseId), ["overdue", "unscanned-window"]);
    assert.equal(suggestions[0].priority, "High");
    assert.match(suggestions[1].reason, /30-day reporting window/);
    assert.deepEqual(buildSuggestedHouses([houses[2]], 1), []);
});

test("suggests houses with repeated historical gaps even when the latest gap is short", () => {
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07", "2026-10-10"];
    const [suggestion] = buildSuggestedHouses([{
        houseId: "repeated-gaps",
        collectionStatus: "own",
        history: {
            collectionDates: dates,
            typicalIntervalDays: 1,
            currentGapDays: 1,
            attentionStatus: "Regular",
        },
    }], 30);

    assert.equal(suggestion.priority, "High");
    assert.equal(suggestion.repeatedLongGaps, 2);
    assert.match(suggestion.reason, /2 historical collection gaps/);
});

test("compares daily distance by matched collection workload and flags significant excess", () => {
    const analysis = analyzeDailyDistance([
        {date: "2026-10-01", distanceKm: 10, mappedHouseCount: 10, trackPoints: [{}]},
        {date: "2026-10-02", distanceKm: 12, mappedHouseCount: 12, trackPoints: [{}]},
        {date: "2026-10-03", distanceKm: 20, mappedHouseCount: 10, trackPoints: [{}]},
        {date: "2026-10-04", distanceKm: 8, mappedHouseCount: 0, trackPoints: [{}]},
    ]);

    assert.equal(analysis[2].expectedDistanceKm, 10);
    assert.equal(analysis[2].extraDistanceKm, 10);
    assert.equal(analysis[2].extraDistancePercent, 100);
    assert.equal(analysis[2].isSignificantExtra, true);
    assert.equal(analysis[3].expectedDistanceKm, null);
});

test("compares GPS-day time with the reporting-window median and identifies stationary stays", () => {
    const routes = [
        {date: "2026-10-01", durationMinutes: 100, trackPoints: [{}, {}]},
        {date: "2026-10-02", durationMinutes: 110, trackPoints: [{}, {}]},
        {date: "2026-10-03", durationMinutes: 400, trackPoints: [{}, {}]},
        {date: "2026-10-04", durationMinutes: 0, trackPoints: [{}, {}]},
    ];
    const timeAnalysis = analyzeDailyTime(routes);
    const points = [
        {datetime: "2026-10-03T08:00:00Z", timestamp: Date.parse("2026-10-03T08:00:00Z"), lat: 21, lon: 75},
        {datetime: "2026-10-03T08:20:00Z", timestamp: Date.parse("2026-10-03T08:20:00Z"), lat: 21.0001, lon: 75},
        {datetime: "2026-10-03T08:40:00Z", timestamp: Date.parse("2026-10-03T08:40:00Z"), lat: 21.0001, lon: 75.0001},
    ];

    assert.equal(timeAnalysis[2].normalTimeMinutes, 110);
    assert.equal(timeAnalysis[2].extraTimeMinutes, 290);
    assert.equal(timeAnalysis[2].isSignificantExtra, true);
    assert.equal(timeAnalysis[3].recordedTimeMinutes, null);
    assert.equal(findLongGpsStops({date: "2026-10-03", trackPoints: points}).length, 1);
    assert.equal(findLongGpsStops({date: "2026-10-03", trackPoints: points.slice(0, 2)}).length, 0);
});

test("calculates house coverage, scan frequency, and overdue intervals inside the selected window", () => {
    const houses = [
        {
            houseId: "frequent",
            collectionStatus: "own",
            history: {
                collectionDates: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"],
                currentGapDays: 0,
            },
        },
        {
            houseId: "rare",
            referenceId: "R2",
            collectionStatus: "other",
            scannerUserId: "other-user",
            scannerName: "Other collector",
            scanningDate: "2026-10-02T08:00:00Z",
            history: {
                collectionDates: ["2026-10-02"],
                currentGapDays: 1,
            },
        },
        {
            houseId: "never",
            collectionStatus: "remaining",
            history: {collectionDates: [], currentGapDays: null},
        },
        {
            houseId: "old-only",
            collectionStatus: "own",
            scannerUserId: "assigned-user",
            scanningDate: "2026-09-30T08:00:00Z",
            history: {collectionDates: ["2026-09-30"], currentGapDays: 1},
        },
    ];
    const coverage = analyzeHouseCoverage(houses, [{
        date: "2026-10-01",
        collectionScans: [{houseId: "frequent"}, {houseId: "frequent"}],
    }, {
        date: "2026-10-03",
        collectionScans: [{houseId: "frequent"}],
    }], "2026-10-01", "2026-10-03", {id: "assigned-user", name: "Assigned worker"}, [{
        id: "other-beat",
        beatUserId: "other-user",
        assignedEmployee: {name: "Other employee"},
        routes: [{
            date: "2026-10-01",
            collectionScans: [{plateId: "R2"}],
        }, {
            date: "2026-10-03",
            collectionScans: [{plateId: "R2"}],
        }],
    }]);

    assert.equal(coverage.collectedAtLeastOnce, 2);
    assert.equal(coverage.notCollected, 2);
    assert.equal(coverage.typicalScanCount, 3.5);
    assert.equal(coverage.assignedEmployeeCollected, 1);
    assert.equal(coverage.otherEmployeeCollected, 1);
    assert.equal(coverage.repeatedlyOtherEmployeeCollected, 1);
    assert.equal(coverage.remainingWithoutHistory, 2);
    assert.equal(coverage.details.find((item) => item.house.houseId === "frequent").collectionDays, 3);
    assert.equal(coverage.details.find((item) => item.house.houseId === "frequent").typicalIntervalDays, 1);
    assert.equal(coverage.details.find((item) => item.house.houseId === "rare").recordedScanCount, 3);
    assert.equal(coverage.details.find((item) => item.house.houseId === "frequent").collectionCategory, "own");
    assert.equal(coverage.details.find((item) => item.house.houseId === "rare").collectionCategory, "other");
    assert.equal(coverage.details.find((item) => item.house.houseId === "rare").latestScannerName, "Other employee");
    assert.equal(coverage.details.find((item) => item.house.houseId === "frequent").status, "Regular");
    assert.equal(coverage.details.find((item) => item.house.houseId === "never").status, "Not Collected");
    assert.equal(coverage.details.find((item) => item.house.houseId === "old-only").collectionDays, 0);
    assert.equal(coverage.details.find((item) => item.house.houseId === "old-only").status, "Not Collected");
    assert.equal(
        coverage.assignedEmployeeCollected + coverage.otherEmployeeCollected + coverage.notCollected,
        houses.length,
    );
});

test("keeps verified outside-Beat collections separate and counts distinct houses by Beat", () => {
    const analysis = analyzeOutsideBeatCollections([{
        date: "2026-10-01",
        collectionScans: [
            {plateId: "R7", houseId: null},
            {plateId: "R7", houseId: null},
            {plateId: "unknown", houseId: null},
        ],
    }], [{
        id: "beat-7",
        beatName: "Beat 7",
        houses: [{houseId: "H7", referenceId: "R7"}],
    }]);

    assert.deepEqual(analysis.byBeat, [{beatId: "beat-7", beatName: "Beat 7", count: 1}]);
    assert.equal(analysis.totalHouses, 1);
    assert.equal(analysis.unmatchedScanCount, 1);
});

test("suggests below-normal collection frequency across the reporting window", () => {
    const suggestions = buildSuggestedHouses([
        {
            houseId: "normal-frequency",
            collectionStatus: "own",
            analysisCollectionDates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
            analysisScanCount: 4,
            history: {currentGapDays: 0},
        },
        {
            houseId: "low-frequency",
            collectionStatus: "own",
            analysisCollectionDates: ["2026-10-04"],
            analysisScanCount: 1,
            history: {currentGapDays: 0},
        },
    ], 4, "2026-10-01", "2026-10-04");

    assert.deepEqual(suggestions.map((item) => item.house.houseId), ["low-frequency"]);
    assert.equal(suggestions[0].windowScanCount, 1);
    assert.match(suggestions[0].reason, /below half the typical 2.5 scans per house/);
});
