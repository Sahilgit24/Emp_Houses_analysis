import assert from "node:assert/strict";
import test from "node:test";
import {
    fetchEmployeeReport,
    fetchEmployeeReports,
    fetchEmployeeReportsAcrossUlbs,
    fetchEmployeesForUlb,
    fetchEmployeesForUlbs,
    fetchUlbDirectory,
    WEIGHT_API_ENDPOINTS,
    clearWeightApiCache,
} from "../src/data/weightCollectionApi.js";

function response(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    };
}

function employeeReport(userId) {
    return {
        BeatWiseReport: {
            BeatUserId: userId,
            TotalHouses: 0,
            TotalScannedHouses: 0,
            TotalNotScannedHouses: 0,
            ScannedHouses: [],
            NotScannedHouses: [],
        },
        RouteDetails: {
            geofence: "21,75;21,76;22,76",
            houses: [],
            dumpyards: [],
            routes: [],
        },
    };
}

test("loads API ULBs and employees with the expected GET headers", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push({url, options});
        if (url === WEIGHT_API_ENDPOINTS.ulbs) {
            return response([{appid: 3339, ulb: "Sample ULB"}]);
        }
        return response({AllUsers: [{UserId: 7, UserName: "Assigned worker"}]});
    };

    assert.deepEqual(await fetchUlbDirectory({fetcher}), [{id: "3339", name: "Sample ULB"}]);
    assert.deepEqual(await fetchEmployeesForUlb("3339", {fetcher}), [
        {id: "7", name: "Assigned worker"},
    ]);
    assert.equal(calls[0].options.method, "GET");
    assert.deepEqual(calls[1].options.headers, {AppId: "3339"});
});

test("loads employee lists across ULBs with bounded requests and retains per-ULB failures", async () => {
    let active = 0;
    let peak = 0;
    const progress = [];
    const result = await fetchEmployeesForUlbs([
        {id: "a", name: "ULB A"},
        {id: "b", name: "ULB B"},
        {id: "c", name: "ULB C"},
    ], {
        concurrency: 2,
        onProgress: (item) => progress.push(item),
        fetcher: async (_url, options) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active -= 1;
            if (options.headers.AppId === "b") return response({message: "failed"}, 500);
            return response({AllUsers: [{UserId: options.headers.AppId, UserName: `Employee ${options.headers.AppId}`}]});
        },
    });

    assert.equal(peak, 2);
    assert.deepEqual(Object.keys(result.employeeListsByUlb).sort(), ["a", "c"]);
    assert.deepEqual(result.employeeListsByUlb.a.employees, [{id: "a", name: "Employee a"}]);
    assert.deepEqual(result.errors.map(({ulb}) => ulb.id), ["b"]);
    assert.deepEqual(progress.at(-1), {completed: 3, total: 3});
});

test("loads an employee report with both identifiers and preserves API employee names", async () => {
    let request;
    const normalized = await fetchEmployeeReport("3339", {id: "7", name: "Assigned worker"}, {
        fetcher: async (url, options) => {
            request = {url, options};
            return response(employeeReport(7));
        },
    });

    assert.equal(request.url, WEIGHT_API_ENDPOINTS.employeeReport);
    assert.deepEqual(request.options.headers, {AppId: "3339", userId: "7"});
    assert.equal(normalized.beats[0].assignedEmployee.name, "Assigned worker");
    assert.equal(normalized.beats[0].beatName, "Beat assigned to Assigned worker");
    assert.equal(normalized.raw, undefined);
    assert.equal(normalized.beats[0].raw, undefined);
});

test("limits concurrent report requests and reports individual failures", async () => {
    let active = 0;
    let peak = 0;
    const progress = [];
    const employees = Array.from({length: 5}, (_, index) => ({
        id: String(index + 1),
        name: `Employee ${index + 1}`,
    }));
    const result = await fetchEmployeeReports("3339", employees, {
        concurrency: 2,
        onProgress: (item) => progress.push(item),
        fetcher: async (_url, options) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active -= 1;
            return options.headers.userId === "3"
                ? response({message: "failed"}, 500)
                : response(employeeReport(Number(options.headers.userId)));
        },
    });

    test("loads cross-ULB reports with the matching app ID and identifies failed ULB reports", async () => {
        const targets = [
            {ulbId: "a", ulbName: "ULB A", appId: "111", employee: {id: "1", name: "One"}},
            {ulbId: "b", ulbName: "ULB B", appId: "222", employee: {id: "2", name: "Two"}},
            {ulbId: "c", ulbName: "ULB C", appId: "333", employee: {id: "3", name: "Three"}},
        ];
        let active = 0;
        let peak = 0;
        const result = await fetchEmployeeReportsAcrossUlbs(targets, {
            concurrency: 2,
            fetcher: async (_url, options) => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 2));
                active -= 1;
                return options.headers.userId === "2"
                    ? response({message: "failed"}, 503)
                    : response(employeeReport(options.headers.userId));
            },
        });

        assert.equal(peak, 2);
        assert.equal(result.reports.length, 2);
        assert.equal(result.reports[0].ulbId, "a");
        assert.equal(result.reports[0].ulbName, "ULB A");
        assert.equal(result.reports[0].employee.id, "1");
        assert.equal(result.errors[0].ulbId, "b");
        assert.equal(result.errors[0].employee.id, "2");
        assert.equal(result.reports[1].ulbId, "c");
    });

    assert.equal(peak, 2);
    assert.equal(result.reports.length, 4);
    assert.deepEqual(result.errors.map(({employee}) => employee.id), ["3"]);
    assert.equal(progress.length, 5);
    assert.deepEqual(progress.at(-1), {completed: 5, total: 5});
});

test("reuses a recent API response and refetches after the cache is cleared", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return {ok: true, json: async () => [{appid: 1, ulb: `ULB call ${calls}`}]};
    };
    try {
        clearWeightApiCache();
        const first = await fetchUlbDirectory();
        first[0].name = "mutated by caller";
        const second = await fetchUlbDirectory();
        assert.equal(calls, 1);
        assert.equal(second[0].name, "ULB call 1", "cached data must not share objects with earlier callers");

        clearWeightApiCache();
        const third = await fetchUlbDirectory();
        assert.equal(calls, 2);
        assert.equal(third[0].name, "ULB call 2");
    } finally {
        globalThis.fetch = originalFetch;
        clearWeightApiCache();
    }
});

test("an injected fetcher always bypasses the cache", async () => {
    let calls = 0;
    const fetcher = async () => {
        calls += 1;
        return {ok: true, json: async () => [{appid: 1, ulb: "Test ULB"}]};
    };
    await fetchUlbDirectory({fetcher});
    await fetchUlbDirectory({fetcher});
    assert.equal(calls, 2);
});
