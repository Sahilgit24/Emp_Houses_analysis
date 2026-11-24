import {normalizeBeatApiPayload} from "./beatApiData.js";
import {normalizeEmployeeList, normalizeUlbList} from "./executiveLocations.js";

export const WEIGHT_API_ENDPOINTS = {
    ulbs: "https://weight.ictsbm.com/api/Get/AllULBListForWeightCollection",
    employees: "https://weight.ictsbm.com/api/Get/GetActiveBeatUsers",
    employeeReport: "https://weight.ictsbm.com/api/Get/BeatWiseHouseScanningCompleteReport",
};

const REPORT_CONCURRENCY = 4;
const ULB_CONCURRENCY = 4;

// Short-lived in-memory cache of raw API payloads, so switching back to a recently loaded ULB
// does not re-download every report. Payloads are cloned on read and normalized again by the
// callers, so cached and fresh loads produce identical data. Refresh buttons clear the cache.
export const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const RESPONSE_CACHE_MAX_ENTRIES = 300;
const responseCache = new Map();

export function clearWeightApiCache() {
    responseCache.clear();
}

async function getJson(url, headers = {}, signal, fetcher) {
    // Only the app's own network fetches are cached; an injected fetcher (tests) always runs.
    const cacheKey = fetcher ? null : `${url}|${JSON.stringify(headers)}`;
    if (cacheKey) {
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() - cached.storedAt < RESPONSE_CACHE_TTL_MS) {
            return structuredClone(cached.payload);
        }
        responseCache.delete(cacheKey);
    }
    const response = await (fetcher || globalThis.fetch)(url, {method: "GET", headers, signal});
    if (!response.ok) {
        throw new Error(`Request failed (HTTP ${response.status}).`);
    }
    const payload = await response.json();
    if (cacheKey) {
        responseCache.set(cacheKey, {payload: structuredClone(payload), storedAt: Date.now()});
        // Map keeps insertion order, so the first keys are the oldest entries.
        while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
            responseCache.delete(responseCache.keys().next().value);
        }
    }
    return payload;
}

export async function fetchUlbDirectory({signal, fetcher} = {}) {
    const payload = await getJson(WEIGHT_API_ENDPOINTS.ulbs, {}, signal, fetcher);
    return normalizeUlbList(payload);
}

export async function fetchEmployeesForUlb(appId, {signal, fetcher} = {}) {
    if (!appId) throw new Error("Select a ULB before loading employees.");
    const payload = await getJson(
        WEIGHT_API_ENDPOINTS.employees,
        {AppId: String(appId)},
        signal,
        fetcher,
    );
    return normalizeEmployeeList(payload);
}

export async function fetchEmployeesForUlbs(
    ulbs,
    {signal, fetcher, onProgress, concurrency = ULB_CONCURRENCY} = {},
) {
    if (!Array.isArray(ulbs)) {
        throw new Error("ULB employee loading requires a ULB list.");
    }

    const employeeListsByUlb = {};
    const errors = [];
    let nextIndex = 0;
    let completed = 0;
    const worker = async () => {
        while (nextIndex < ulbs.length) {
            if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
            const ulb = ulbs[nextIndex];
            nextIndex += 1;
            try {
                employeeListsByUlb[ulb.id] = {
                    employees: await fetchEmployeesForUlb(ulb.id, {signal, fetcher}),
                };
            } catch (error) {
                if (signal?.aborted) throw error;
                errors.push({
                    ulb,
                    message: error instanceof Error ? error.message : "The employee list could not be loaded.",
                });
            } finally {
                completed += 1;
                if (!signal?.aborted) onProgress?.({completed, total: ulbs.length});
            }
        }
    };

    const workerCount = Math.min(Math.max(1, concurrency), ulbs.length);
    await Promise.all(Array.from({length: workerCount}, () => worker()));
    return {employeeListsByUlb, errors};
}

function releaseRawPayloadReferences(normalized) {
    delete normalized.raw;
    normalized.beats.forEach((beat) => {
        delete beat.raw;
        (beat.houses || []).forEach((house) => delete house.raw);
        (beat.dumpEvents || []).forEach((dump) => delete dump.raw);
    });
    return normalized;
}

export async function fetchEmployeeReport(appId, employee, {signal, fetcher} = {}) {
    if (!appId) throw new Error("Select a ULB before loading employee reports.");
    if (!employee?.id) throw new Error("The employee report request requires a user ID.");
    const payload = await getJson(
        WEIGHT_API_ENDPOINTS.employeeReport,
        {AppId: String(appId), userId: String(employee.id)},
        signal,
        fetcher,
    );
    const normalized = normalizeBeatApiPayload(
        payload,
        `${employee.name || `Employee ${employee.id}`} (${employee.id})`,
    );
    normalized.beats = normalized.beats.map((beat) => ({
        ...beat,
        beatName: beat.beatNameAvailable ? beat.beatName : `Beat assigned to ${employee.name || employee.id}`,
        assignedEmployee: {
            ...beat.assignedEmployee,
            id: String(employee.id),
            name: employee.name || beat.assignedEmployee.name,
        },
        beatUserId: String(employee.id),
    }));
    return releaseRawPayloadReferences(normalized);
}

export async function fetchEmployeeReports(
    appId,
    employees,
    {signal, fetcher, onProgress, concurrency = REPORT_CONCURRENCY} = {},
) {
    if (!Array.isArray(employees)) {
        throw new Error("Employee reports require an employee list.");
    }
    const reports = new Array(employees.length);
    const errors = new Array(employees.length);
    let nextIndex = 0;
    let completed = 0;

    const worker = async () => {
        while (nextIndex < employees.length) {
            if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
            const index = nextIndex;
            const employee = employees[index];
            nextIndex += 1;
            try {
                reports[index] = {
                    employee,
                    data: await fetchEmployeeReport(appId, employee, {signal, fetcher}),
                };
            } catch (error) {
                if (signal?.aborted) throw error;
                errors[index] = {
                    employee,
                    message: error instanceof Error ? error.message : "The employee report could not be loaded.",
                };
            } finally {
                completed += 1;
                if (!signal?.aborted) onProgress?.({completed, total: employees.length});
            }
        }
    };

    const workerCount = Math.min(Math.max(1, concurrency), employees.length);
    await Promise.all(Array.from({length: workerCount}, () => worker()));
    return {
        reports: reports.filter(Boolean),
        errors: errors.filter(Boolean),
    };
}

export async function fetchEmployeeReportsAcrossUlbs(
    employeeTargets,
    {signal, fetcher, onProgress, concurrency = REPORT_CONCURRENCY} = {},
) {
    if (!Array.isArray(employeeTargets)) {
        throw new Error("Employee reports require an employee list.");
    }

    const reports = new Array(employeeTargets.length);
    const errors = new Array(employeeTargets.length);
    let nextIndex = 0;
    let completed = 0;
    const worker = async () => {
        while (nextIndex < employeeTargets.length) {
            if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
            const index = nextIndex;
            const target = employeeTargets[index];
            nextIndex += 1;
            try {
                reports[index] = {
                    ulbId: target.ulbId,
                    ulbName: target.ulbName,
                    employee: target.employee,
                    data: await fetchEmployeeReport(target.appId, target.employee, {signal, fetcher}),
                };
            } catch (error) {
                if (signal?.aborted) throw error;
                errors[index] = {
                    ulbId: target.ulbId,
                    ulbName: target.ulbName,
                    employee: target.employee,
                    message: error instanceof Error ? error.message : "The employee report could not be loaded.",
                };
            } finally {
                completed += 1;
                if (!signal?.aborted) onProgress?.({completed, total: employeeTargets.length});
            }
        }
    };

    const workerCount = Math.min(Math.max(1, concurrency), employeeTargets.length);
    await Promise.all(Array.from({length: workerCount}, () => worker()));
    return {
        reports: reports.filter(Boolean),
        errors: errors.filter(Boolean),
    };
}
