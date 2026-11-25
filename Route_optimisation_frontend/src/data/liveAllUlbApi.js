import {API_URL} from "../config.js";

// The All-ULB view reads a live-date snapshot that the backend builds in the background,
// instead of downloading every employee report in the browser.

function liveUrl(path, params = {}) {
    const base = API_URL.endsWith("/") ? API_URL : `${API_URL}/`;
    const url = new URL(`live/all-ulbs/${path}`, base);
    Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== "") url.searchParams.set(key, String(value));
    });
    return url.toString();
}

async function readJson(response) {
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) {
        throw new Error(payload?.message || `Live data request failed (HTTP ${response.status}).`);
    }
    return payload;
}

// A request that gets no answer in this time is reported as an error instead of loading forever.
export const LIVE_REQUEST_TIMEOUT_MS = 20000;

async function request(url, {signal, ...options} = {}, fetcher) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), LIVE_REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => timeout.abort();
    signal?.addEventListener("abort", abortFromCaller);
    try {
        return await readJson(await (fetcher || globalThis.fetch)(url, {...options, signal: timeout.signal}));
    } catch (error) {
        if (signal?.aborted) throw error;
        if (error?.name === "AbortError") {
            throw new Error("The backend server did not respond in time. Check that it is running and not paused, then refresh.");
        }
        if (error instanceof TypeError) {
            throw new Error("Could not reach the backend server for All-ULB live data. Check that it is running.");
        }
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromCaller);
    }
}

export function fetchLiveAllUlbSummary({signal, fetcher} = {}) {
    return request(liveUrl("summary"), {signal}, fetcher);
}

export function requestLiveAllUlbRefresh({signal, fetcher} = {}) {
    return request(liveUrl("refresh"), {method: "POST", signal}, fetcher);
}

export function fetchLiveAllUlbEmployees({status, ulbId, runId, limit = 500, offset = 0, signal, fetcher} = {}) {
    return request(liveUrl("employees", {status, ulbId, runId, limit, offset}), {signal}, fetcher);
}

export function fetchLiveAllUlbHouses({category, ulbId, runId, limit = 500, offset = 0, signal, fetcher} = {}) {
    return request(liveUrl("houses", {category, ulbId, runId, limit, offset}), {signal}, fetcher);
}

/** Share of houses in each category; percentages use the snapshot's total houses. */
export function liveCollectionPattern(totals) {
    const total = totals?.totalHouses || 0;
    const counts = totals?.counts || {};
    return [
        {key: "inside", label: "Collected inside assigned Beat", color: "#16a34a"},
        {key: "outside", label: "Collected outside assigned Beat", color: "#f97316"},
        {key: "other", label: "Collected by other / unverified", color: "#2563eb"},
        {key: "not_scanned_today", label: "Not scanned today", color: "#dc2626"},
    ].map((item) => {
        const count = counts[item.key] || 0;
        return {...item, count, percent: total ? count * 100 / total : 0};
    });
}
