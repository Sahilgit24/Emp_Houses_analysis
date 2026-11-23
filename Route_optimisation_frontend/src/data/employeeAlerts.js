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
