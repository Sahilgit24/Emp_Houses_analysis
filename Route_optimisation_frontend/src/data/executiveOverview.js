import {beatHasHouseRecords} from "./beatApiData.js";

function beatKey(ulbId, beatId) {
    return `${ulbId}\u0000${beatId}`;
}

function employeeKey(ulbId, employeeId) {
    return `${ulbId}\u0000${employeeId}`;
}

export function getExecutiveMonitoringDates(sources) {
    const dates = new Set();
    sources.forEach((source) => {
        (source.data.beats || []).forEach((beat) => {
            (beat.routes || []).forEach((route) => {
                if (route.date) dates.add(route.date);
            });
            (beat.houses || []).forEach((house) => {
                (house.historyEvents || []).forEach((event) => {
                    if (event.date) dates.add(event.date);
                });
            });
        });
    });
    return [...dates].sort();
}

export function summarizeExecutiveOverview(
    sources,
    ulbs,
    employeeListsByUlb,
    ulbSelection,
    date,
) {
    const scopedSources = ulbSelection === "all"
        ? sources
        : sources.filter((source) => String(source.ulbId || "") === String(ulbSelection));
    const beats = scopedSources.flatMap((source) =>
        (source.data.beats || []).map((beat) => ({
            beat,
            ulbId: String(source.ulbId || ""),
        }))
    );
    const ulbNames = new Map(ulbs.map((ulb) => [String(ulb.id), ulb.name]));
    const assignedBeatsByEmployee = new Map();
    const activeEmployees = new Set();
    const employees = new Map();
    const counts = {inside: 0, outside: 0, other: 0, never: 0};
    let totalHouses = 0;

    Object.entries(employeeListsByUlb).forEach(([ulbId, employeeList]) => {
        if (ulbSelection !== "all" && String(ulbId) !== String(ulbSelection)) return;
        (employeeList.employees || []).forEach((employee) => {
            const id = String(employee.id);
            employees.set(employeeKey(ulbId, id), {id, ulbId, name: employee.name});
        });
    });

    beats.forEach(({beat, ulbId}) => {
        const ownerId = String(beat.assignedEmployee?.id || "");
        if (!ownerId) return;
        const ownerKey = employeeKey(ulbId, ownerId);
        if (!employees.has(ownerKey)) {
            employees.set(ownerKey, {
                id: ownerId,
                ulbId,
                name: beat.assignedEmployee.name || `Employee ${ownerId}`,
            });
        }
        const assignments = assignedBeatsByEmployee.get(ownerId) || [];
        assignments.push({key: beatKey(ulbId, beat.id), ulbId, beatName: beat.beatName});
        assignedBeatsByEmployee.set(ownerId, assignments);

        if (beatHasHouseRecords(beat) && (beat.routes || []).some((route) =>
            route.date === date && route.trackPoints?.length > 0
        )) {
            activeEmployees.add(ownerKey);
        }
    });

    beats.forEach(({beat, ulbId}) => {
        const ownerId = String(beat.assignedEmployee?.id || "");
        (beat.houses || []).forEach((house) => {
            totalHouses += 1;
            const relevantEvents = (house.historyEvents || [])
                .filter((event) => event.date && event.date <= date)
                .sort((a, b) =>
                    a.date.localeCompare(b.date) ||
                    (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0)
                );
            const latestEvent = relevantEvents.at(-1);
            if (!latestEvent) {
                counts.never += 1;
                return;
            }

            const scannerId = String(latestEvent.scannerUserId || "");
            if (scannerId && scannerId === ownerId) {
                counts.inside += 1;
                return;
            }

            const scannerAssignments = assignedBeatsByEmployee.get(scannerId) || [];
            if (scannerId && scannerAssignments.length &&
                scannerAssignments.some((assignment) =>
                    assignment.key !== beatKey(ulbId, beat.id)
                )) {
                counts.outside += 1;
                return;
            }
            counts.other += 1;
        });
    });

    const totalEmployees = employees.size;
    const activeEmployeeCount = activeEmployees.size;
    const totalCollected = counts.inside + counts.outside + counts.other;
    const coveragePercent = totalHouses
        ? totalCollected * 100 / totalHouses
        : null;
    const collectionPattern = [
        {key: "inside", label: "Collected inside assigned Beat", count: counts.inside, color: "#16a34a"},
        {key: "outside", label: "Collected outside assigned Beat", count: counts.outside, color: "#f97316"},
        {key: "other", label: "Collected by other / unverified", count: counts.other, color: "#2563eb"},
        {key: "never", label: "Never scanned", count: counts.never, color: "#dc2626"},
    ].map((item) => ({
        ...item,
        percent: totalHouses ? item.count * 100 / totalHouses : 0,
    }));

    return {
        ulbName: ulbSelection === "all"
            ? "All ULBs"
            : ulbNames.get(String(ulbSelection)) || "Selected ULB",
        date,
        totalEmployees,
        activeEmployees: activeEmployeeCount,
        inactiveEmployees: Math.max(0, totalEmployees - activeEmployeeCount),
        totalHouses,
        collectedHouses: totalCollected,
        coveragePercent,
        collectionPattern,
    };
}
