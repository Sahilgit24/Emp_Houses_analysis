import assert from "node:assert/strict";
import test from "node:test";
import {
    analyzeHouseCoverage,
    analyzeOutsideBeatCollections,
    getReportWindowDays,
    getBeatPlannerEmployeeOptions,
    getHighPriorityHouses,
    getHighPriorityAttentionHouses,
    getNextCollectionPriorities,
    getCoverageTrend,
    getWeeklyWindows,
    summarizeWeeklyCoverageTrend,
    isEmployeeActiveOnDate,
    summarizeCollectionPatterns,
    summarizeDailyEmployeeReport,
} from "../src/data/employeePerformance.js";

test("employee activity dots require house data and GPS points on the selected date", () => {
    const beats = [
        {
            assignedEmployee: {id: "active"},
            houses: [{houseId: "H1"}],
            routes: [{date: "2026-11-23", trackPoints: [{lat: 21, lon: 75}]}],
        },
        {
            assignedEmployee: {id: "no-house"},
            houses: [],
            routes: [{date: "2026-11-23", trackPoints: [{lat: 21, lon: 75}]}],
        },
        {
            assignedEmployee: {id: "other-date"},
            houses: [{houseId: "H2"}],
            routes: [{date: "2026-11-22", trackPoints: [{lat: 21, lon: 75}]}],
        },
    ];

    assert.equal(isEmployeeActiveOnDate(beats, "active", "2026-11-23"), true);
    assert.equal(isEmployeeActiveOnDate(beats, "no-house", "2026-11-23"), false);
    assert.equal(isEmployeeActiveOnDate(beats, "other-date", "2026-11-23"), false);
    assert.equal(isEmployeeActiveOnDate(beats, "active", null), false);
});

test("Beat planner employee options identify Beat owners and date-specific activity", () => {
    const employees = [
        {id: "active", name: "Active worker"},
        {id: "no-beat", name: "No Beat worker"},
        {id: "no-report", name: "Unavailable report"},
    ];
    const beats = [
        {
            id: "beat-1",
            beatName: "Beat 1",
            beatNameAvailable: false,
            assignedEmployee: {id: "active", name: "Active worker"},
            houses: [{houseId: "H1"}],
            routes: [{date: "2026-11-24", trackPoints: [{lat: 21, lon: 75}]}],
        },
        {
            id: "beat-2",
            beatName: "Beat 2",
            beatNameAvailable: false,
            assignedEmployee: {id: "no-beat", name: "No Beat worker"},
            houses: [],
            routes: [],
        },
    ];

    const options = getBeatPlannerEmployeeOptions(employees, beats, "2026-11-24");

    assert.deepEqual(options.map((employee) => ({
        id: employee.employeeId,
        hasBeat: employee.hasBeat,
        isActive: employee.isActive,
        hasReport: employee.hasReport,
    })), [
        {id: "active", hasBeat: true, isActive: true, hasReport: true},
        {id: "no-beat", hasBeat: false, isActive: false, hasReport: true},
        {id: "no-report", hasBeat: false, isActive: null, hasReport: false},
    ]);
});

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
    assert.deepEqual(
        coverage.details.find((item) => item.house.houseId === "own").assignedCollectionDates,
        ["2026-10-01"],
    );
    assert.deepEqual(
        coverage.details.find((item) => item.house.houseId === "other").otherEmployeeCollectionDates,
        ["2026-10-01"],
    );
});

test("compares the selected date with yesterday and uses GPS points for attendance", () => {
    const houses = Array.from({length: 25}, (_, index) => {
        const dates = [];
        if (index < 23) dates.push("2026-10-07");
        if (index < 20) dates.push("2026-10-09");
        if (index < 3) dates.push("2026-10-10");
        if (index === 24) dates.push("2026-10-04");
        return {
            houseId: `H${index + 1}`,
            history: {collectionDates: dates},
            historyEvents: dates.map((date) => ({
                date,
                timestamp: `${date}T09:00:00Z`,
                source: "house-record-history",
                scannerUserId: "assigned-user",
            })),
        };
    });
    houses.push({
        houseId: "other-employee-only",
        history: {collectionDates: ["2026-10-08"]},
        historyEvents: [{
            date: "2026-10-08",
            timestamp: "2026-10-08T09:00:00Z",
            source: "house-record-history",
            scannerUserId: "other-user",
        }],
    });
    const coverage = analyzeHouseCoverage(
        houses,
        [],
        "2026-10-01",
        "2026-10-10",
        {id: "assigned-user"},
    );

    assert.deepEqual(
        summarizeDailyEmployeeReport(coverage, [
            {date: "2026-10-09", trackPoints: [{}, {}]},
            {date: "2026-10-10", trackPoints: [{}]},
        ], "2026-10-10"),
        {
            selectedDate: "2026-10-10",
            previousDate: "2026-10-09",
            selectedDateHouseCount: 3,
            previousDateHouseCount: 20,
            houseCountChange: -17,
            selectedDateGpsPointCount: 1,
            previousDateGpsPointCount: 2,
            selectedDateAttendance: "Present",
            previousDateAttendance: "Present",
        },
    );
});

test("reports absent when the selected day has no GPS points even if scans exist", () => {
    const coverage = analyzeHouseCoverage([{
        houseId: "scan-without-gps",
        history: {collectionDates: ["2026-10-10"]},
        historyEvents: [{
            date: "2026-10-10",
            timestamp: "2026-10-10T09:00:00Z",
            source: "house-record-history",
            scannerUserId: "assigned-user",
        }],
    }], [], null, "2026-10-10", {id: "assigned-user"});
    const report = summarizeDailyEmployeeReport(coverage, [], "2026-10-10");

    assert.equal(report.selectedDateAttendance, "Absent");
    assert.equal(report.selectedDateHouseCount, 1);
    assert.equal(report.selectedDateGpsPointCount, 0);
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
    assert.deepEqual(analysis.byDate, [{
        date: "2026-10-01",
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

test("bases attention and high priority on historical problems, not a missing selected-day scan", () => {
    const coverage = analyzeHouseCoverage([{
        houseId: "never-scanned",
        history: {collectionDates: []},
    }, {
        houseId: "long-abnormal-gap",
        history: {collectionDates: ["2026-10-01", "2026-10-03", "2026-10-05"]},
    }, {
        houseId: "normal-not-scanned-today",
        history: {collectionDates: ["2026-10-06", "2026-10-08", "2026-10-10", "2026-10-12"]},
    }, {
        houseId: "normal-peer",
        history: {collectionDates: ["2026-10-06", "2026-10-08", "2026-10-10", "2026-10-12"]},
    }], [], null, "2026-10-13", {id: "assigned-user"});
    const priorities = getNextCollectionPriorities(coverage, "2026-10-13");
    const highPriority = getHighPriorityAttentionHouses(priorities);

    assert.deepEqual(
        priorities.map((item) => item.detail.house.houseId).sort(),
        ["long-abnormal-gap", "never-scanned"],
    );
    assert.equal(priorities.find((item) => item.detail.house.houseId === "never-scanned").priorityLabel,
        "High priority — no scan in report history");
    assert.equal(priorities.find((item) => item.detail.house.houseId === "long-abnormal-gap")
        .priorityLabel, "High priority — overdue");
    assert.equal(highPriority.length, 2);
    assert.ok(highPriority.every((item) => priorities.includes(item)));
    assert.ok(!priorities.some((item) => item.detail.house.houseId === "normal-not-scanned-today"));
});

test("retains complete scan history for house analysis beyond the reporting window", () => {
    const houses = [{
        houseId: "historically-scanned",
        history: {collectionDates: ["2026-09-01", "2026-09-03", "2026-09-05"]},
    }];
    const reportCoverage = analyzeHouseCoverage(
        houses, [], "2026-10-01", "2026-10-03", {id: "assigned-user"},
    );
    const historicalCoverage = analyzeHouseCoverage(
        houses, [], null, "2026-10-03", {id: "assigned-user"},
    );
    const [priority] = getNextCollectionPriorities(historicalCoverage, "2026-10-03");

    assert.equal(reportCoverage.details[0].collectionDays, 0);
    assert.deepEqual(historicalCoverage.details[0].collectionDates,
        ["2026-09-01", "2026-09-03", "2026-09-05"]);
    assert.equal(priority.lastScannedDate, "2026-09-05");
    assert.equal(priority.daysSinceScan, 28);
    assert.equal(priority.priorityLabel, "High priority — overdue");
});

test("historical priorities and patterns ignore scans after the selected date", () => {
    const coverage = analyzeHouseCoverage([{
        houseId: "first-scanned-later",
        history: {collectionDates: ["2026-10-10"]},
    }], [], null, "2026-10-03", {id: "assigned-user"});

    const [priority] = getNextCollectionPriorities(coverage, "2026-10-03");
    const patterns = summarizeCollectionPatterns(coverage);
    assert.equal(priority.priorityLabel, "High priority — no scan in report history");
    assert.equal(priority.lastScannedDate, null);
    assert.equal(patterns.noRecordedCollection, 1);
    assert.equal(patterns.recordedHouseDays, 0);
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
        "Improving",
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

test("splits a 30-day window into four full weeks ending on the selected date", () => {
    assert.deepEqual(getWeeklyWindows("2026-10-26", "2026-11-24"), [
        {fromDate: "2026-10-28", toDate: "2026-11-03"},
        {fromDate: "2026-11-04", toDate: "2026-11-10"},
        {fromDate: "2026-11-11", toDate: "2026-11-17"},
        {fromDate: "2026-11-18", toDate: "2026-11-24"},
    ]);
    assert.deepEqual(getWeeklyWindows("2026-11-14", "2026-11-24"), [
        {fromDate: "2026-11-18", toDate: "2026-11-24"},
    ]);
    assert.deepEqual(getWeeklyWindows("2026-11-20", "2026-11-24"), []);
    assert.deepEqual(getWeeklyWindows("2026-11-24", "2026-11-20"), []);
});

test("compares the latest week with the average of earlier weeks", () => {
    const weeks = [
        {fromDate: "a", toDate: "a", percent: 50},
        {fromDate: "b", toDate: "b", percent: 60},
        {fromDate: "c", toDate: "c", percent: 70},
    ];
    const trend = summarizeWeeklyCoverageTrend(weeks);
    assert.equal(trend.latest.percent, 70);
    assert.equal(trend.earlierAverage, 55);
    assert.equal(trend.earlierWeekCount, 2);
    assert.equal(trend.changePercentagePoints, 15);
    assert.equal(trend.trend, "Improving");

    assert.equal(summarizeWeeklyCoverageTrend([{percent: 60}, {percent: 52}]).trend, "Declining");
    assert.equal(summarizeWeeklyCoverageTrend([{percent: 60}, {percent: 60.5}]).trend, "Stable");
});

test("weekly trend needs at least two measured weeks", () => {
    assert.equal(summarizeWeeklyCoverageTrend([]).trend, "Insufficient data");
    const single = summarizeWeeklyCoverageTrend([{percent: 40}, {percent: null}]);
    assert.equal(single.trend, "Insufficient data");
    assert.equal(single.changePercentagePoints, null);
});

test("outside-Beat collections are read from the other Beat's house scan history", () => {
    const otherBeats = [{
        id: "beat-ankush",
        beatName: "Beat assigned to Ankush",
        houses: [
            {houseId: "H1", referenceId: "R1", historyEvents: [
                {date: "2026-11-24", scannerUserId: "6"},
                {date: "2026-11-25", scannerUserId: "6"},
            ]},
            {houseId: "H2", referenceId: "R2", historyEvents: [{date: "2026-11-25", scannerUserId: "65"}]},
            {houseId: "H3", referenceId: "R3", historyEvents: [{date: "2026-10-01", scannerUserId: "6"}]},
        ],
    }];
    // The employee's own routes carry GPS only (no collection scans), as in the live API.
    const routes = [{date: "2026-11-25", collectionScans: []}];
    const analysis = analyzeOutsideBeatCollections(routes, otherBeats, "6", "2026-11-20", "2026-11-25");
    assert.equal(analysis.totalHouses, 1);
    assert.deepEqual(analysis.byBeat, [{
        beatId: "beat-ankush", beatName: "Beat assigned to Ankush", count: 1, houseIds: ["H1"],
    }]);
    assert.deepEqual(analysis.byDate, [
        {date: "2026-11-24", houseIds: ["H1"]},
        {date: "2026-11-25", houseIds: ["H1"]},
    ]);
});
