import assert from "node:assert/strict";
import test from "node:test";
import {findOutsideBeatCollectionAlerts} from "../src/data/employeeAlerts.js";

function source(ulbId, id, employeeId, houses) {
    return {
        ulbId,
        data: {
            beats: [{
                id,
                beatName: `Beat ${id}`,
                assignedEmployee: {id: employeeId, name: `Employee ${employeeId}`},
                houses,
            }],
        },
    };
}

test("alerts for verified collections in another Beat on the selected date", () => {
    const sources = [
        source("3339", "own-beat", "7", []),
        source("3339", "other-beat", "8", [{
            houseId: "H-OUTSIDE",
            historyEvents: [{date: "2026-11-17", scannerUserId: "7", scannerName: "Employee 7"}],
        }]),
    ];
    const alerts = findOutsideBeatCollectionAlerts(
        sources,
        [{id: "3339", name: "Amalner Nagar Parishad"}],
        {3339: {employees: [{id: "7", name: "Assigned worker"}]}},
        "2026-11-17",
    );

    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0], {
        id: "2026-11-17-7-3339-other-beat-H-OUTSIDE",
        date: "2026-11-17",
        houseId: "H-OUTSIDE",
        employeeId: "7",
        employeeName: "Assigned worker",
        employeeUlbName: "Amalner Nagar Parishad",
        ulbName: "Amalner Nagar Parishad",
        beatName: "Beat other-beat",
    });
});

test("excludes own-Beat scans, other dates, unassigned scanners, and duplicate records", () => {
    const ownBeatHouses = [{
        houseId: "H-OWN",
        historyEvents: [{date: "2026-11-17", scannerUserId: "7"}],
    }];
    const otherBeatHouses = [{
        houseId: "H-OUTSIDE",
        historyEvents: [
            {date: "2026-11-17", scannerUserId: "7"},
            {date: "2026-11-17", scannerUserId: "7"},
            {date: "2026-11-16", scannerUserId: "7"},
            {date: "2026-11-17", scannerUserId: "unknown"},
        ],
    }];
    const alerts = findOutsideBeatCollectionAlerts([
        source("3339", "own-beat", "7", ownBeatHouses),
        source("3339", "other-beat", "8", otherBeatHouses),
    ], [{id: "3339", name: "Amalner Nagar Parishad"}], {}, "2026-11-17");

    assert.deepEqual(alerts.map((alert) => alert.houseId), ["H-OUTSIDE"]);
});

test("reports the collection ULB when an employee scans in another ULB", () => {
    const alerts = findOutsideBeatCollectionAlerts([
        source("3339", "own-beat", "7", []),
        source("3076", "other-ulb-beat", "8", [{
            houseId: "H-CROSS-ULB",
            historyEvents: [{date: "2026-11-17", scannerUserId: "7"}],
        }]),
    ], [
        {id: "3339", name: "Amalner Nagar Parishad"},
        {id: "3076", name: "Aarmori Nagar Parishad"},
    ], {}, "2026-11-17");

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].employeeUlbName, "Amalner Nagar Parishad");
    assert.equal(alerts[0].ulbName, "Aarmori Nagar Parishad");
});

test("includes outside-Beat alerts on every date in an inclusive range", () => {
    const alerts = findOutsideBeatCollectionAlerts([
        source("3339", "own-beat", "7", []),
        source("3339", "other-beat", "8", [{
            houseId: "H-RANGE",
            historyEvents: [
                {date: "2026-11-16", scannerUserId: "7"},
                {date: "2026-11-17", scannerUserId: "7"},
                {date: "2026-11-18", scannerUserId: "7"},
                {date: "2026-11-19", scannerUserId: "7"},
            ],
        }]),
    ], [{id: "3339", name: "Amalner Nagar Parishad"}], {}, "2026-11-17", "2026-11-18");

    assert.deepEqual(alerts.map(({date}) => date), ["2026-11-17", "2026-11-18"]);
});

test("returns no alerts without a selected date", () => {
    assert.deepEqual(findOutsideBeatCollectionAlerts([], [], {}, ""), []);
});
