import assert from "node:assert/strict";
import test from "node:test";
import {
    getExecutiveMonitoringDates,
    summarizeExecutiveOverview,
} from "../src/data/executiveOverview.js";

function source(ulbId, beatId, employeeId, houses, routeDate = null, houseCounts = {}) {
    return {
        ulbId,
        data: {
            beats: [{
                id: beatId,
                beatName: `Beat ${beatId}`,
                assignedEmployee: {id: employeeId, name: `Employee ${employeeId}`},
                routes: routeDate ? [{date: routeDate, trackPoints: [{lat: 21, lon: 75}]}] : [],
                houses,
                ...houseCounts,
            }],
        },
    };
}

const ulbs = [
    {id: "ulb-a", name: "ULB A"},
    {id: "ulb-b", name: "ULB B"},
];

const sources = [
    source("ulb-a", "beat-1", "1", [
        {houseId: "inside", historyEvents: [{date: "2026-03-10", scannerUserId: "1"}]},
        {houseId: "outside", historyEvents: [{date: "2026-03-10", scannerUserId: "2"}]},
        {houseId: "other", historyEvents: [{date: "2026-03-10", scannerUserId: "unknown"}]},
        {houseId: "never", historyEvents: []},
    ], "2026-03-10"),
    source("ulb-a", "beat-2", "2", [], "2026-03-10", {
        totalScannedHouses: 0,
        totalNotScannedHouses: 0,
    }),
    source("ulb-b", "beat-3", "9", [
        {houseId: "ulb-b-house", historyEvents: [{date: "2026-03-10", scannerUserId: "9"}]},
    ], "2026-03-10"),
];

const employeeListsByUlb = {
    "ulb-a": {employees: [
        {id: "1", name: "Employee 1"},
        {id: "2", name: "Employee 2"},
        {id: "3", name: "Employee 3"},
    ]},
};

test("summarizes selected ULB activity and the four collection categories through the selected date", () => {
    const summary = summarizeExecutiveOverview(
        sources,
        ulbs,
        employeeListsByUlb,
        "ulb-a",
        "2026-03-10",
    );

    assert.equal(summary.totalEmployees, 3);
    assert.equal(summary.activeEmployees, 1);
    assert.equal(summary.inactiveEmployees, 2);
    assert.equal(summary.totalHouses, 4);
    assert.equal(summary.collectedHouses, 3);
    assert.equal(summary.coveragePercent, 75);
    assert.deepEqual(summary.collectionPattern.map(({key, count, percent}) => ({key, count, percent})), [
        {key: "inside", count: 1, percent: 25},
        {key: "outside", count: 1, percent: 25},
        {key: "other", count: 1, percent: 25},
        {key: "never", count: 1, percent: 25},
    ]);
});

test("all-ULB summary combines sources while dates before scanning show uncollected houses", () => {
    const allUlbs = summarizeExecutiveOverview(
        sources,
        ulbs,
        employeeListsByUlb,
        "all",
        "2026-03-09",
    );

    assert.equal(allUlbs.ulbName, "All ULBs");
    assert.equal(allUlbs.totalHouses, 5);
    assert.equal(allUlbs.totalEmployees, 4);
    assert.equal(allUlbs.activeEmployees, 0);
    assert.equal(allUlbs.inactiveEmployees, 4);
    assert.equal(allUlbs.collectedHouses, 0);
    assert.equal(allUlbs.collectionPattern.find(({key}) => key === "never").count, 5);
    assert.deepEqual(getExecutiveMonitoringDates(sources), ["2026-03-10"]);
});
