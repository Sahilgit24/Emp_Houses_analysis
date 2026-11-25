function beatKey(ulbId, beatId) {
    return `${ulbId}\u0000${beatId}`;
}

export function findOutsideBeatCollectionAlerts(
    sources,
    ulbs,
    employeeListsByUlb,
    fromDate,
    toDate = fromDate,
) {
    if (!fromDate || !toDate || fromDate > toDate) return [];

    const ulbNames = new Map(ulbs.map((ulb) => [String(ulb.id), ulb.name]));
    const employeeNames = new Map();
    const assignedBeatsByEmployee = new Map();
    const allBeats = sources.flatMap((source) =>
        (source.data.beats || []).map((beat) => ({
            beat,
            ulbId: String(source.ulbId || ""),
        }))
    );

    Object.values(employeeListsByUlb).forEach((employeeList) => {
        (employeeList.employees || []).forEach((employee) => {
            employeeNames.set(String(employee.id), employee.name);
        });
    });

    allBeats.forEach(({beat, ulbId}) => {
        const employeeId = String(beat.assignedEmployee?.id || "");
        if (!employeeId) return;
        if (!employeeNames.has(employeeId)) {
            employeeNames.set(employeeId, beat.assignedEmployee.name || `Employee ${employeeId}`);
        }
        const assignments = assignedBeatsByEmployee.get(employeeId) || [];
        assignments.push({
            key: beatKey(ulbId, beat.id),
            ulbId,
            beatName: beat.beatName,
        });
        assignedBeatsByEmployee.set(employeeId, assignments);
    });

    const uniqueAlerts = new Map();
    allBeats.forEach(({beat: targetBeat, ulbId: targetUlbId}) => {
        (targetBeat.houses || []).forEach((house) => {
            (house.historyEvents || []).forEach((event) => {
                const employeeId = String(event.scannerUserId || "");
                if (!employeeId || !event.date || event.date < fromDate || event.date > toDate) return;
                const assignments = assignedBeatsByEmployee.get(employeeId) || [];
                if (!assignments.length || assignments.some((assignment) =>
                    assignment.key === beatKey(targetUlbId, targetBeat.id)
                )) return;

                const employeeUlbIds = [...new Set(assignments.map((assignment) => assignment.ulbId))];
                const employeeUlbNames = employeeUlbIds.map((id) => ulbNames.get(id) || id).filter(Boolean);
                const alert = {
                    id: `${event.date}-${employeeId}-${targetUlbId}-${targetBeat.id}-${house.houseId}`,
                    date: event.date,
                    houseId: house.houseId,
                    employeeId,
                    employeeName: employeeNames.get(employeeId) || event.scannerName || `Employee ${employeeId}`,
                    employeeUlbName: employeeUlbNames.join(", ") || "Unknown",
                    ulbId: targetUlbId,
                    ulbName: ulbNames.get(targetUlbId) || targetUlbId || "Unknown",
                    beatName: targetBeat.beatName,
                };
                uniqueAlerts.set(alert.id, alert);
            });
        });
    });

    return [...uniqueAlerts.values()].sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.ulbName.localeCompare(b.ulbName) ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.houseId.localeCompare(b.houseId)
    );
}

/**
 * Groups outside-Beat alerts for display: one entry per collection ULB, each listing the
 * employees who collected there and, for every employee, the houses they scanned.
 * The alerts themselves are unchanged; this only arranges them.
 */
export function groupAlertsByUlb(alerts) {
    const ulbs = new Map();
    alerts.forEach((alert) => {
        const ulbName = alert.ulbName || "Unknown";
        // Group by the ULB's ID (names are not guaranteed unique); fall back to the name without an ID.
        const ulbKey = alert.ulbId ? `id:${alert.ulbId}` : `name:${ulbName}`;
        let ulb = ulbs.get(ulbKey);
        if (!ulb) {
            ulb = {ulbKey, ulbId: alert.ulbId || "", ulbName, alerts: [], employees: new Map()};
            ulbs.set(ulbKey, ulb);
        }
        ulb.alerts.push(alert);
        // Employee IDs are only unique within their own ULB, so the key includes it.
        const employeeKey = `${alert.employeeUlbName || ""}\u0000${alert.employeeId}`;
        let employee = ulb.employees.get(employeeKey);
        if (!employee) {
            employee = {
                key: employeeKey,
                employeeId: alert.employeeId,
                employeeName: alert.employeeName,
                employeeUlbName: alert.employeeUlbName,
                alerts: [],
            };
            ulb.employees.set(employeeKey, employee);
        }
        employee.alerts.push(alert);
    });

    const summarize = (items) => {
        const dates = items.map((alert) => alert.date).sort();
        return {
            alertCount: items.length,
            houseCount: new Set(items.map((alert) => alert.houseId)).size,
            beatNames: [...new Set(items.map((alert) => alert.beatName).filter(Boolean))].sort(),
            firstDate: dates[0] || "",
            lastDate: dates.at(-1) || "",
        };
    };

    return [...ulbs.values()]
        .map((ulb) => {
            const employees = [...ulb.employees.values()]
                .map((employee) => ({...employee, ...summarize(employee.alerts)}))
                .sort((a, b) => b.alertCount - a.alertCount || a.employeeName.localeCompare(b.employeeName));
            return {
                ulbKey: ulb.ulbKey,
                ulbId: ulb.ulbId,
                ulbName: ulb.ulbName,
                alerts: ulb.alerts,
                employees,
                ...summarize(ulb.alerts),
            };
        })
        .sort((a, b) => b.alertCount - a.alertCount || a.ulbName.localeCompare(b.ulbName));
}
