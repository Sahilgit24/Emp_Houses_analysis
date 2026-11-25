export function normalizeUlbList(payload) {
    if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("The ULB API response must contain a non-empty JSON array.");
    }

    const ulbs = payload.map((record, index) => {
        const id = String(record?.appid ?? "").trim();
        const name = String(record?.ulb ?? "").trim();
        if (!id || !name) {
            throw new Error(`ULB API record ${index + 1} must include both appid and ulb.`);
        }
        return {id, name};
    });
    const ids = new Set(ulbs.map((ulb) => ulb.id));
    if (ids.size !== ulbs.length) {
        throw new Error("The ULB API response contains duplicate appid values.");
    }
    return ulbs.sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeEmployeeList(payload) {
    const records = payload?.AllUsers ?? payload?.AllBeats;
    if (!Array.isArray(records)) {
        throw new Error("The employee list must contain an AllUsers or AllBeats array.");
    }

    const employeeId = (record) => String(record?.UserId ?? "").trim();
    const inactiveEmployeeIds = new Set(
        (Array.isArray(payload.InactiveUsers) ? payload.InactiveUsers : [])
            .map(employeeId)
            .filter(Boolean),
    );
    const activeEmployeeIds = new Set(
        (Array.isArray(payload.ActiveUsers) ? payload.ActiveUsers : [])
            .map(employeeId)
            .filter(Boolean),
    );
    // Employees listed in AllBeats have a Beat. Only their reports contain house records, so the
    // others' reports are not downloaded. Without an AllBeats list, hasBeat is left unset (unknown).
    const beatEmployeeIds = Array.isArray(payload.AllBeats) && payload.AllUsers
        ? new Set(payload.AllBeats.map(employeeId).filter(Boolean))
        : null;
    const employeesById = new Map();
    records.forEach((record, index) => {
        const id = employeeId(record);
        const name = String(record?.UserName ?? "").trim();
        if (!id || !name) {
            throw new Error(`Employee record ${index + 1} must include both UserId and UserName.`);
        }
        let isInactive;
        if (record?.IsUserActive != null) {
            const activeValue = String(record.IsUserActive).trim().toLowerCase();
            isInactive = !(record.IsUserActive === true || activeValue === "1" || activeValue === "true");
        } else if (inactiveEmployeeIds.has(id)) {
            isInactive = true;
        } else if (activeEmployeeIds.has(id)) {
            isInactive = false;
        }
        employeesById.set(id, {
            id,
            name,
            ...(isInactive == null ? {} : {isInactive}),
            ...(beatEmployeeIds ? {hasBeat: beatEmployeeIds.has(id)} : {}),
        });
    });
    return [...employeesById.values()].sort((a, b) => a.name.localeCompare(b.name));
}
