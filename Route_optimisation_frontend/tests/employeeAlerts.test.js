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
        ulbId: "3339",
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

test("groups alerts by collection ULB, then by employee, with house counts", async () => {
    const {groupAlertsByUlb} = await import("../src/data/employeeAlerts.js");
    const alert = (date, houseId, employeeId, ulbName, beatName = "Beat X") => ({
        id: `${date}-${employeeId}-${ulbName}-${houseId}`,
        date,
        houseId,
        employeeId,
        employeeName: `Employee ${employeeId}`,
        employeeUlbName: "Home ULB",
        ulbName,
        beatName,
    });
    const groups = groupAlertsByUlb([
        alert("2026-11-20", "H1", "7", "ULB A"),
        alert("2026-11-21", "H1", "7", "ULB A"),
        alert("2026-11-21", "H2", "7", "ULB A", "Beat Y"),
        alert("2026-11-21", "H3", "8", "ULB A"),
        alert("2026-11-22", "H9", "9", "ULB B"),
    ]);
    assert.deepEqual(groups.map((group) => group.ulbName), ["ULB A", "ULB B"]);
    const [ulbA] = groups;
    assert.equal(ulbA.alertCount, 4);
    assert.equal(ulbA.houseCount, 3);
    assert.equal(ulbA.employees.length, 2);
    assert.equal(ulbA.employees[0].employeeId, "7");
    assert.equal(ulbA.employees[0].alertCount, 3);
    assert.equal(ulbA.employees[0].houseCount, 2);
    assert.deepEqual(ulbA.employees[0].beatNames, ["Beat X", "Beat Y"]);
    assert.equal(ulbA.employees[0].firstDate, "2026-11-20");
    assert.equal(ulbA.employees[0].lastDate, "2026-11-21");
});

test("ULBs with the same name and employees with the same ID in different ULBs stay separate", async () => {
    const {groupAlertsByUlb} = await import("../src/data/employeeAlerts.js");
    const alert = (ulbId, employeeUlbName, houseId) => ({
        id: `${ulbId}-${employeeUlbName}-${houseId}`,
        date: "2026-11-25",
        houseId,
        employeeId: "7",
        employeeName: "Employee 7",
        employeeUlbName,
        ulbId,
        ulbName: "Same Name Nagar Parishad",
        beatName: "Beat X",
    });
    const groups = groupAlertsByUlb([
        alert("100", "Home A", "H1"),
        alert("200", "Home B", "H2"),
        alert("100", "Home C", "H3"),
    ]);
    assert.equal(groups.length, 2);
    const first = groups.find((group) => group.ulbId === "100");
    assert.equal(first.employees.length, 2);
    assert.deepEqual(first.employees.map((employee) => employee.employeeUlbName).sort(), ["Home A", "Home C"]);
});
