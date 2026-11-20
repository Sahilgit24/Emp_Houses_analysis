export function normalizeUlbList(payload) {
    if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("The ULB file must contain a non-empty JSON array.");
    }

    const ulbs = payload.map((record, index) => {
        const id = String(record?.appid ?? "").trim();
        const name = String(record?.ulb ?? "").trim();
        if (!id || !name) {
            throw new Error(`ULB record ${index + 1} must include both appid and ulb.`);
        }
        return {id, name};
    });
    const ids = new Set(ulbs.map((ulb) => ulb.id));
    if (ids.size !== ulbs.length) {
        throw new Error("The ULB file contains duplicate appid values.");
    }
    return ulbs.sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeEmployeeList(payload) {
    if (!payload || !Array.isArray(payload.AllBeats)) {
        throw new Error("The employee-list file must contain an AllBeats array.");
    }

    const employeesById = new Map();
    payload.AllBeats.forEach((record, index) => {
        const id = String(record?.UserId ?? "").trim();
        const name = String(record?.UserName ?? "").trim();
        if (!id || !name) {
            throw new Error(`Employee record ${index + 1} must include both UserId and UserName.`);
        }
        employeesById.set(id, {id, name});
    });
    return [...employeesById.values()].sort((a, b) => a.name.localeCompare(b.name));
}
