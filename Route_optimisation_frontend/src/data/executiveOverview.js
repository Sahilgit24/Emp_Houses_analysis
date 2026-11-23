import {beatHasHouseRecords} from "./beatApiData.js";

function beatKey(ulbId, beatId) {
    return `${ulbId}\u0000${beatId}`;
}

function employeeKey(ulbId, employeeId) {
    return `${ulbId}\u0000${employeeId}`;
}

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) &&
        new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function getTodayInTimeZone(timeZone, date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
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

function getScopedSources(sources, ulbSelection) {
    return ulbSelection === "all"
        ? sources
        : sources.filter((source) => String(source.ulbId || "") === String(ulbSelection));
}

export function getExecutiveEmployees(sources, employeeListsByUlb, ulbSelection, ulbs) {
    const employees = new Map();
    Object.entries(employeeListsByUlb).forEach(([ulbId, employeeList]) => {
        if (ulbSelection !== "all" && String(ulbId) !== String(ulbSelection)) return;
        (employeeList.employees || []).forEach((employee) => {
            const id = String(employee.id);
            employees.set(employeeKey(ulbId, id), {
                id,
                ulbId,
                name: employee.name,
            });
        });
    });

    getScopedSources(sources, ulbSelection).forEach((source) => {
        (source.data.beats || []).forEach((beat) => {
            const id = String(beat.assignedEmployee?.id || "");
            if (!id) return;
            const ulbId = String(source.ulbId || "");
            const key = employeeKey(ulbId, id);
            if (!employees.has(key)) {
                employees.set(key, {
                    id,
                    ulbId,
                    name: beat.assignedEmployee.name || `Employee ${id}`,
                });
            }
        });
    });

    const ulbNames = new Map(ulbs.map((ulb) => [String(ulb.id), ulb.name]));
    return [...employees.values()]
        .map((employee) => ({
            ...employee,
            ulbName: ulbNames.get(employee.ulbId) || employee.ulbId,
        }))
        .sort((a, b) =>
            a.name.localeCompare(b.name) ||
            a.ulbName.localeCompare(b.ulbName) ||
            a.id.localeCompare(b.id)
        );
}

export function summarizeExecutiveOverview(
    sources,
    ulbs,
    employeeListsByUlb,
    ulbSelection,
    date,
    selectedEmployee = null,
) {
    const allBeats = getScopedSources(sources, ulbSelection).flatMap((source) =>
        (source.data.beats || []).map((beat) => ({
            beat,
            ulbId: String(source.ulbId || ""),
        }))
    );
    const beats = selectedEmployee
        ? allBeats.filter(({beat, ulbId}) =>
            String(beat.assignedEmployee?.id || "") === String(selectedEmployee.id) &&
            ulbId === String(selectedEmployee.ulbId)
        )
        : allBeats;
    const ulbNames = new Map(ulbs.map((ulb) => [String(ulb.id), ulb.name]));
    const assignedBeatsByEmployee = new Map();
    const activeEmployees = new Set();
    const employees = new Map(
        getExecutiveEmployees(sources, employeeListsByUlb, ulbSelection, ulbs)
            .filter((employee) => !selectedEmployee ||
                employeeKey(employee.ulbId, employee.id) ===
                    employeeKey(selectedEmployee.ulbId, selectedEmployee.id))
            .map((employee) => [
                employeeKey(employee.ulbId, employee.id),
                employee,
            ]),
    );
    const counts = {inside: 0, outside: 0, other: 0, never: 0};
    let totalHouses = 0;

    allBeats.forEach(({beat, ulbId}) => {
        const ownerId = String(beat.assignedEmployee?.id || "");
        if (!ownerId) return;
        const ownerKey = employeeKey(ulbId, ownerId);
        if (!employees.has(ownerKey) && (!selectedEmployee ||
            employeeKey(ulbId, ownerId) ===
                employeeKey(selectedEmployee.ulbId, selectedEmployee.id))) {
            employees.set(ownerKey, {
                id: ownerId,
                ulbId,
                name: beat.assignedEmployee.name || `Employee ${ownerId}`,
            });
        }
        const assignments = assignedBeatsByEmployee.get(ownerId) || [];
        assignments.push({key: beatKey(ulbId, beat.id), ulbId, beatName: beat.beatName});
        assignedBeatsByEmployee.set(ownerId, assignments);
    });

    beats.forEach(({beat, ulbId}) => {
        const ownerId = String(beat.assignedEmployee?.id || "");
        const ownerKey = employeeKey(ulbId, ownerId);
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
    const employeeStatusList = [...employees.entries()]
        .map(([key, employee]) => ({
            ...employee,
            ulbName: ulbNames.get(employee.ulbId) || employee.ulbId,
            isActive: activeEmployees.has(key),
        }))
        .sort((a, b) =>
            a.name.localeCompare(b.name) ||
            a.ulbName.localeCompare(b.ulbName) ||
            a.id.localeCompare(b.id)
        );
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
        employeeName: selectedEmployee?.name || "All employees",
        date,
        totalEmployees,
        activeEmployees: activeEmployeeCount,
        inactiveEmployees: Math.max(0, totalEmployees - activeEmployeeCount),
        activeEmployeeList: employeeStatusList.filter((employee) => employee.isActive),
        inactiveEmployeeList: employeeStatusList.filter((employee) => !employee.isActive),
        totalHouses,
        collectedHouses: totalCollected,
        coveragePercent,
        collectionPattern,
    };
}

export function averageExecutiveOverview(
    sources,
    ulbs,
    employeeListsByUlb,
    ulbSelection,
    fromDate,
    toDate,
    selectedEmployee = null,
) {
    if (!isValidDate(fromDate) || !isValidDate(toDate) || fromDate > toDate) {
        throw new Error("Choose a valid date range with the start date on or before the end date.");
    }

    const dailySummaries = [];
    for (let day = Date.parse(`${fromDate}T00:00:00Z`);
        day <= Date.parse(`${toDate}T00:00:00Z`);
        day += 86400000) {
        const date = new Date(day).toISOString().slice(0, 10);
        dailySummaries.push(summarizeExecutiveOverview(
            sources,
            ulbs,
            employeeListsByUlb,
            ulbSelection,
            date,
            selectedEmployee,
        ));
    }
    const average = (values) =>
        values.reduce((total, value) => total + value, 0) / dailySummaries.length;
    const latestSummary = dailySummaries.at(-1);
    return {
        ...latestSummary,
        date: `${fromDate} to ${toDate}`,
        averageDays: dailySummaries.length,
        activeEmployees: average(dailySummaries.map((summary) => summary.activeEmployees)),
        inactiveEmployees: average(dailySummaries.map((summary) => summary.inactiveEmployees)),
        totalHouses: average(dailySummaries.map((summary) => summary.totalHouses)),
        collectedHouses: average(dailySummaries.map((summary) => summary.collectedHouses)),
        coveragePercent: latestSummary.coveragePercent == null
            ? null
            : average(dailySummaries.map((summary) => summary.coveragePercent)),
        collectionPattern: latestSummary.collectionPattern.map((item, index) => ({
            ...item,
            count: average(dailySummaries.map((summary) =>
                summary.collectionPattern[index].count
            )),
            percent: average(dailySummaries.map((summary) =>
                summary.collectionPattern[index].percent
            )),
        })),
    };
}
