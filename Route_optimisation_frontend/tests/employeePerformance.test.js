import assert from "node:assert/strict";
import test from "node:test";
import {
    analyzeHouseCoverage,
    analyzeOutsideBeatCollections,
    getReportWindowDays,
    getHighPriorityHouses,
    getNextCollectionPriorities,
    getCoverageTrend,
    summarizeCollectionPatterns,
} from "../src/data/employeePerformance.js";

test("uses the selected reporting window for house collection history", () => {
    const houses = [{
        houseId: "H001",
        collectionStatus: "own",
        history: {collectionDates: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]},
    }, {
        houseId: "H002",
        scanned: false,
        scannerUserId: "assigned-user",
        scanningDate: "2026-10-02T08:00:00Z",
        history: {collectionDates: ["2026-10-02"]},
    }, {
        houseId: "H003",
        history: {collectionDates: []},
    }, {
        houseId: "H004",
        scanningDate: "2026-09-30T08:00:00Z",
        scanned: true,
        scannerUserId: "assigned-user",
        history: {collectionDates: ["2026-09-30"]},
    }];
    const coverage = analyzeHouseCoverage(houses, [{
        date: "2026-10-01",
        collectionScans: [
            {houseId: "H001", scannerUserId: "assigned-user"},
            {houseId: "H001", scannerUserId: "assigned-user"},
        ],
    }, {
        date: "2026-10-03",
        collectionScans: [{houseId: "H001", scannerUserId: "assigned-user"}],
    }], "2026-10-01", "2026-10-03", {id: "assigned-user", name: "Assigned worker"});

    assert.equal(getReportWindowDays("2026-10-01", "2026-10-30"), 30);
    assert.equal(coverage.details.find((item) => item.house.houseId === "H001").recordedScanCount, 4);
    assert.equal(coverage.details.find((item) => item.house.houseId === "H001").collectionDays, 3);
    assert.equal(coverage.details.find((item) => item.house.houseId === "H002").collectionCategory, "own");
    assert.equal(coverage.details.find((item) => item.house.houseId === "H001").collectionCategory, "own");
    assert.equal(coverage.details.find((item) => item.house.houseId === "H001").assignedEmployeeScanCount, 3);
    assert.equal(coverage.details.find((item) => item.house.houseId === "H004").recordedScanCount, 0);
    assert.equal(coverage.details.find((item) => item.house.houseId === "H004").status, "Not Collected");
    assert.deepEqual(
        coverage.requiringAttention.map((detail) => detail.house.houseId).sort(),
        ["H002", "H003", "H004"],
    );
    assert.deepEqual(getHighPriorityHouses(coverage, 3), []);
});

test("attributes ScanningDates to each house's ScannerUserId within the selected date", () => {
    const houses = [{
        houseId: "own",
        scannerUserId: "assigned-user",
        history: {collectionDates: ["2026-10-01", "2026-10-02"]},
        historyEvents: [
            {date: "2026-10-01", timestamp: "2026-10-01", source: "house-record-history", scannerUserId: "assigned-user"},
            {date: "2026-10-02", timestamp: "2026-10-02", source: "house-record-history", scannerUserId: "assigned-user"},
        ],
    }, {
        houseId: "other",
        scannerUserId: "other-user",
        history: {collectionDates: ["2026-10-01"]},
        historyEvents: [
            {date: "2026-10-01", timestamp: "2026-10-01", source: "house-record-history", scannerUserId: "other-user"},
        ],
    }, {
        houseId: "unscanned",
        history: {collectionDates: []},
        historyEvents: [],
    }];
    const coverage = analyzeHouseCoverage(
        houses,
        [],
        "2026-10-01",
        "2026-10-01",
        {id: "assigned-user", name: "Assigned worker"},
    );

    assert.equal(coverage.assignedEmployeeCollected, 1);
    assert.equal(coverage.otherEmployeeCollected, 1);
    assert.equal(coverage.remainingWithoutHistory, 1);
});

test("keeps employee, other-employee, and unverified house scans in separate categories", () => {
    const houses = [
        {
            houseId: "own",
            referenceId: "R1",
            history: {collectionDates: ["2026-10-01", "2026-10-02", "2026-10-03"]},
        },
        {
            houseId: "other",
            referenceId: "R2",
            scanned: true,
            scannerUserId: "other-user",
            scannerName: "Other collector",
            scanningDate: "2026-10-02T08:00:00Z",
            history: {collectionDates: ["2026-10-02"]},
        },
        {houseId: "never", history: {collectionDates: []}},
        {houseId: "old-only", scanned: true, scannerUserId: "assigned-user",
            scanningDate: "2026-09-30T08:00:00Z", history: {collectionDates: ["2026-09-30"]}},
        {houseId: "unknown", referenceId: "R4", history: {collectionDates: ["2026-10-03"]}},
    ];
    const coverage = analyzeHouseCoverage(houses, [{
        date: "2026-10-01",
        collectionScans: [
            {houseId: "own", scannerUserId: "assigned-user"},
            {houseId: "own", scannerUserId: "assigned-user"},
        ],
    }, {
        date: "2026-10-03",
        collectionScans: [{houseId: "own", scannerUserId: "assigned-user"}],
    }], "2026-10-01", "2026-10-03", {id: "assigned-user", name: "Assigned worker"}, [{
        id: "other-beat",
        beatUserId: "other-user",
        assignedEmployee: {name: "Other employee"},
        beatName: "Other Beat",
        houses: [],
        routes: [{
            date: "2026-10-01",
            collectionScans: [{plateId: "R2", scannerUserId: "other-user", scannerName: "Other collector"}],
        }, {
            date: "2026-10-03",
            collectionScans: [{plateId: "R2", scannerUserId: "other-user", scannerName: "Other collector"}],
        }],
    }]);

    assert.equal(coverage.assignedEmployeeCollected, 1);
    assert.equal(coverage.otherEmployeeCollected, 1);
    assert.equal(coverage.notCollected, 3);
    assert.equal(coverage.collectedAtLeastOnce, 2);
    assert.equal(coverage.details.find((item) => item.house.houseId === "own").collectionCategory, "own");
    const otherDetail = coverage.details.find((item) => item.house.houseId === "other");
    assert.equal(otherDetail.collectionCategory, "other");
    assert.equal(otherDetail.otherEmployeeScanCount, 3);
    assert.equal(otherDetail.latestScannerName, "Other collector");
    assert.equal(coverage.details.find((item) => item.house.houseId === "unknown").recordedScanCount, 1);
    assert.equal(coverage.details.find((item) => item.house.houseId === "unknown").collectionCategory, "remaining");
    assert.equal(
        coverage.assignedEmployeeCollected + coverage.otherEmployeeCollected + coverage.notCollected,
        houses.length,
    );
});

test("attributes route collection records without scanner IDs to the route's assigned employee", () => {
    const coverage = analyzeHouseCoverage([{
        houseId: "H-other",
        referenceId: "R-other",
        history: {collectionDates: []},
    }], [], "2026-10-01", "2026-10-03", {id: "assigned-user"}, [{
        id: "other-beat",
        beatUserId: "other-user",
        assignedEmployee: {id: "other-user", name: "Other employee"},
        beatName: "Other Beat",
        houses: [],
        routes: [{
            date: "2026-10-02",
            collectionScans: [{plateId: "R-other", datetime: "2026-10-02T09:00:00Z"}],
        }],
    }]);

    const detail = coverage.details[0];
    assert.equal(detail.collectionCategory, "other");
    assert.equal(detail.otherEmployeeScanCount, 1);
    assert.equal(detail.latestScannerName, "Other employee");
    assert.equal(coverage.otherEmployeeCollected, 1);
});

test("attributes route collections to the assigned employee when scanner IDs are missing", () => {
    const analysis = analyzeOutsideBeatCollections([{
        date: "2026-10-01",
        collectionScans: [
            {plateId: "R7", scannerUserId: "assigned-user", houseId: null},
            {plateId: "R7", scannerUserId: "assigned-user", houseId: null},
            {plateId: "R7", scannerUserId: "another-user", houseId: null},
            {plateId: "R7", houseId: null},
            {plateId: "unknown", scannerUserId: "assigned-user", houseId: null},
        ],
    }, {
        date: "2026-09-30",
        collectionScans: [{plateId: "R7", scannerUserId: "assigned-user", houseId: null}],
    }], [{
        id: "beat-7",
        beatName: "Beat 7",
        houses: [{houseId: "H7", referenceId: "R7"}],
    }], "assigned-user", "2026-10-01", "2026-10-30");

    assert.deepEqual(analysis.byBeat, [{
        beatId: "beat-7",
        beatName: "Beat 7",
        count: 1,
        houseIds: ["H7"],
    }]);
    assert.equal(analysis.totalHouses, 1);
    assert.equal(analysis.unmatchedScanCount, 1);
});

test("lists high-priority houses with their scan gap and keeps recent scans out", () => {
    const houses = [{
        houseId: "no-scan-month",
        history: {collectionDates: []},
    }, {
        houseId: "missed-week",
        history: {collectionDates: ["2026-11-02", "2026-11-05"]},
    }, {
        houseId: "missed-six-days",
        history: {collectionDates: ["2026-11-06"]},
    }, {
        houseId: "recent-other-employee",
        scanned: true,
        scannerUserId: "other-user",
        scanningDate: "2026-11-12T08:00:00Z",
        history: {collectionDates: ["2026-11-07", "2026-11-10", "2026-11-12"]},
    }];
    const coverage = analyzeHouseCoverage(
        houses,
        [],
        "2026-10-14",
        "2026-11-12",
        {id: "assigned-user"},
    );
    const highPriorityHouses = getHighPriorityHouses(coverage, 30);

    assert.equal(
        coverage.details.find((detail) => detail.house.houseId === "recent-other-employee").collectionCategory,
        "other",
    );
    assert.deepEqual(
        highPriorityHouses.map(({detail}) => detail.house.houseId).sort(),
        ["missed-week", "no-scan-month"],
    );
    assert.equal(
        highPriorityHouses.find(({detail}) => detail.house.houseId === "missed-week").daysSinceScan,
        7,
    );
    assert.equal(
        highPriorityHouses.find(({detail}) => detail.house.houseId === "no-scan-month").unscannedThroughoutMonth,
        true,
    );
});

test("does not mark a house with a recent scan as high priority or infer a full month from a short window", () => {
    const recentScanCoverage = analyzeHouseCoverage([{
        houseId: "recent",
        history: {collectionDates: ["2026-10-29"]},
    }], [], "2026-10-01", "2026-10-30", {id: "assigned-user"});
    const shortWindowCoverage = analyzeHouseCoverage([{
        houseId: "not-scanned",
        history: {collectionDates: []},
    }], [], "2026-10-01", "2026-10-03", {id: "assigned-user"});

    assert.deepEqual(getHighPriorityHouses(recentScanCoverage, 30), []);
    assert.deepEqual(getHighPriorityHouses(shortWindowCoverage, 3), []);
});

test("builds next-collection priorities from existing history and attention status", () => {
    const coverage = analyzeHouseCoverage([{
        houseId: "never-scanned",
        history: {collectionDates: []},
    }, {
        houseId: "long-gap",
        history: {collectionDates: ["2026-10-01"]},
    }, {
        houseId: "recent",
        history: {collectionDates: ["2026-10-09"]},
    }], [], "2026-10-08", "2026-10-10", {id: "assigned-user"});
    const existingHighPriority = getHighPriorityHouses(coverage, 3);
    assert.deepEqual(existingHighPriority, []);
    const priorities = getNextCollectionPriorities(
        coverage,
        3,
        "2026-10-10",
        existingHighPriority,
    );

    assert.deepEqual(
        priorities.map((item) => item.detail.house.houseId),
        ["never-scanned", "long-gap"],
    );
    assert.equal(priorities[0].priorityLabel, "Highest — no scan history");
    assert.equal(priorities[0].lastScannedDate, null);
    assert.equal(priorities[1].daysSinceScan, 9);
    assert.equal(priorities[1].lastScannedDate, "2026-10-01");
});

test("excludes houses scanned on the selected analysis date from next-collection priorities", () => {
    const coverage = analyzeHouseCoverage([{
        houseId: "not-scanned-today",
        history: {collectionDates: ["2026-10-01"]},
    }, {
        houseId: "scanned-today",
        history: {collectionDates: ["2026-10-01", "2026-10-10"]},
    }], [], "2026-10-01", "2026-10-10", {id: "assigned-user"});
    const scannedToday = coverage.details.find((detail) =>
        detail.house.houseId === "scanned-today"
    );

    const priorities = getNextCollectionPriorities(
        coverage,
        10,
        "2026-10-10",
        [{detail: scannedToday}],
    );

    assert.deepEqual(
        priorities.map((item) => item.detail.house.houseId),
        ["not-scanned-today"],
    );
});

test("coverage trend compares verified windows and reports insufficient data", () => {
    assert.deepEqual(
        getCoverageTrend({collectedAtLeastOnce: 1}, {collectedAtLeastOnce: 2}, 4),
        {
            previousPercent: 25,
            currentPercent: 50,
            changePercentagePoints: 25,
            trend: "Improving",
        },
    );
    assert.equal(
        getCoverageTrend({collectedAtLeastOnce: 2}, {collectedAtLeastOnce: 2}, 4).trend,
        "Stable",
    );
    assert.equal(
        getCoverageTrend({collectedAtLeastOnce: 0}, {collectedAtLeastOnce: 2}, 4).trend,
        "Insufficient data",
    );
});

test("summarizes repeated collection, lower frequency, recurring gaps, and period concentration", () => {
    const patterns = summarizeCollectionPatterns({details: [{
        collectionDays: 2,
        collectionDates: ["2026-10-31", "2026-11-02"],
        isLowFrequency: true,
        repeatedLongGaps: 2,
    }, {
        collectionDays: 0,
        collectionDates: [],
        isLowFrequency: false,
        repeatedLongGaps: 0,
    }, {
        collectionDays: 1,
        collectionDates: ["2026-11-03"],
        isLowFrequency: false,
        repeatedLongGaps: 0,
    }]});

    assert.deepEqual(patterns, {
        repeatedlyCollected: 1,
        lowFrequency: 1,
        recurringLongGaps: 1,
        noRecordedCollection: 1,
        busiestMonth: {month: "2026-11", houseDays: 2},
        recordedHouseDays: 3,
    });
});
