"use client";
import "@/App.css";
import BeatHouseRoutePlanner from "./Component/Map/BeatHouseRoutePlanner";
import EmployeeApiDashboard from "./Component/EmployeeApiDashboard";
import EmployeeAlerts from "./Component/EmployeeAlerts.jsx";
import ExecutiveOverview from "./Component/ExecutiveOverview";
import {useEffect, useMemo, useState} from "react";
import {combineNormalizedBeatData} from "./data/beatApiData.js";
import {getTodayInTimeZone} from "./data/executiveOverview.js";
import {
    fetchEmployeeReportsAcrossUlbs,
    fetchEmployeeReports,
    fetchEmployeesForUlb,
    fetchEmployeesForUlbs,
    fetchUlbDirectory,
} from "./data/weightCollectionApi.js";

const LIVE_DATE = "live";
const ALL_ULBS = "all";

export default function App() {
    const [activePlanner, setActivePlanner] = useState("overview");
    const [beatData, setBeatData] = useState(null);
    const [ulbs, setUlbs] = useState([]);
    const [selectedUlbId, setSelectedUlbId] = useState("");
    const [employeeList, setEmployeeList] = useState(null);
    const [allEmployeeListsByUlb, setAllEmployeeListsByUlb] = useState({});
    const [ulbEmployeeErrors, setUlbEmployeeErrors] = useState([]);
    const [employeeListProgress, setEmployeeListProgress] = useState({completed: 0, total: 0});
    const [dateSelection, setDateSelection] = useState(LIVE_DATE);
    const [rangeFromDate, setRangeFromDate] = useState("");
    const [rangeToDate, setRangeToDate] = useState("");
    const [isRangeOpen, setIsRangeOpen] = useState(false);
    const [appliedRange, setAppliedRange] = useState(null);
    const [loadedSources, setLoadedSources] = useState([]);
    const [employeeListLoading, setEmployeeListLoading] = useState(false);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportProgress, setReportProgress] = useState({completed: 0, total: 0});
    const [dataLoadError, setDataLoadError] = useState("");
    const [reportErrors, setReportErrors] = useState([]);
    const [ulbLoading, setUlbLoading] = useState(true);
    const [ulbError, setUlbError] = useState("");
    const [ulbReloadKey, setUlbReloadKey] = useState(0);
    const [dataReloadKey, setDataReloadKey] = useState(0);
    const [highPriorityHouseRequest, setHighPriorityHouseRequest] = useState(null);

    useEffect(() => {
        const controller = new AbortController();
        const loadUlbs = async () => {
            setUlbLoading(true);
            setUlbError("");
            try {
                const ulbList = await fetchUlbDirectory({signal: controller.signal});
                setUlbs(ulbList);
                setSelectedUlbId((current) =>
                    current === ALL_ULBS || ulbList.some((ulb) => ulb.id === current) ? current : ""
                );
            } catch (error) {
                if (controller.signal.aborted) return;
                setUlbError(error instanceof Error
                    ? error.message
                    : "Could not load the ULB list from the API.");
            } finally {
                if (!controller.signal.aborted) setUlbLoading(false);
            }
        };
        loadUlbs();
        return () => controller.abort();
    }, [ulbReloadKey]);

    useEffect(() => {
        if (!selectedUlbId) {
            setEmployeeList(null);
            setAllEmployeeListsByUlb({});
            setUlbEmployeeErrors([]);
            setEmployeeListProgress({completed: 0, total: 0});
            setLoadedSources([]);
            setBeatData(null);
            setReportProgress({completed: 0, total: 0});
            setReportErrors([]);
            setDataLoadError("");
            setEmployeeListLoading(false);
            setReportLoading(false);
            setAppliedRange(null);
            setRangeFromDate("");
            setRangeToDate("");
            setIsRangeOpen(false);
            setDateSelection(LIVE_DATE);
            return undefined;
        }

        const controller = new AbortController();
        const loadSelectedUlb = async () => {
            setEmployeeList(null);
            setAllEmployeeListsByUlb({});
            setUlbEmployeeErrors([]);
            setEmployeeListProgress({completed: 0, total: 0});
            setLoadedSources([]);
            setBeatData(null);
            setReportProgress({completed: 0, total: 0});
            setReportErrors([]);
            setDataLoadError("");
            setHighPriorityHouseRequest(null);
            setDateSelection(LIVE_DATE);
            setAppliedRange(null);
            setRangeFromDate("");
            setRangeToDate("");
            setIsRangeOpen(false);
            setEmployeeListLoading(true);
            setReportLoading(false);
            try {
                if (selectedUlbId === ALL_ULBS) {
                    if (!ulbs.length) {
                        throw new Error("The ULB list is empty; refresh the ULB list before loading all-ULB monitoring.");
                    }

                    setEmployeeListProgress({completed: 0, total: ulbs.length});
                    const {employeeListsByUlb: allEmployeeLists, errors: employeeErrors} =
                        await fetchEmployeesForUlbs(ulbs, {
                            signal: controller.signal,
                            onProgress: setEmployeeListProgress,
                        });
                    if (controller.signal.aborted) return;
                    setAllEmployeeListsByUlb(allEmployeeLists);
                    setUlbEmployeeErrors(employeeErrors);
                    setEmployeeListLoading(false);

                    const employeeTargets = ulbs.flatMap((ulb) =>
                        (allEmployeeLists[ulb.id]?.employees || []).map((employee) => ({
                            ulbId: ulb.id,
                            ulbName: ulb.name,
                            appId: ulb.id,
                            employee,
                        }))
                    );
                    setReportProgress({completed: 0, total: employeeTargets.length});
                    if (!employeeTargets.length) return;

                    setReportLoading(true);
                    const {reports, errors: reportErrors} = await fetchEmployeeReportsAcrossUlbs(
                        employeeTargets,
                        {signal: controller.signal, onProgress: setReportProgress},
                    );
                    if (controller.signal.aborted) return;
                    const sources = reports.map(({ulbId, ulbName, employee, data}) => ({
                        fileName: `${employee.name} (${employee.id})`,
                        employeeId: String(employee.id),
                        ulbId,
                        ulbName,
                        data: {...data, sourceName: `${employee.name} (${employee.id})`},
                    }));
                    setLoadedSources(sources);
                    setBeatData(null);
                    setReportErrors(reportErrors);
                    return;
                }

                const employees = await fetchEmployeesForUlb(selectedUlbId, {
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                const normalizedEmployeeList = {employees};
                setEmployeeList(normalizedEmployeeList);
                setReportProgress({completed: 0, total: employees.length});
                setEmployeeListLoading(false);
                if (!employees.length) return;

                setReportLoading(true);
                const {reports, errors} = await fetchEmployeeReports(selectedUlbId, employees, {
                    signal: controller.signal,
                    onProgress: setReportProgress,
                });
                if (controller.signal.aborted) return;
                const sources = reports.map(({employee, data}) => {
                    const fileName = `${employee.name} (${employee.id})`;
                    return {
                        fileName,
                        employeeId: String(employee.id),
                        ulbId: selectedUlbId,
                        data: {...data, sourceName: fileName},
                    };
                });
                const combinedData = sources.length
                    ? combineNormalizedBeatData(sources.map((source) => source.data))
                    : null;
                setLoadedSources(sources);
                setBeatData(combinedData);
                setReportErrors(errors);
            } catch (error) {
                if (controller.signal.aborted) return;
                setDataLoadError(error instanceof Error
                    ? error.message
                    : "Could not load employee data.");
            } finally {
                if (!controller.signal.aborted) {
                    setEmployeeListLoading(false);
                    setReportLoading(false);
                }
            }
        };
        loadSelectedUlb();
        return () => controller.abort();
    }, [dataReloadKey, selectedUlbId, ulbs]);

    const availableDates = useMemo(() => {
        const dates = new Set();
        (beatData?.beats || []).forEach((beat) => {
            (beat.routes || []).forEach((route) => dates.add(route.date));
            (beat.houses || []).forEach((house) => {
                (house.history?.collectionDates || []).forEach((date) => dates.add(date));
                if (house.scanningDate) dates.add(house.scanningDate.slice(0, 10));
            });
            if (beat.toDate) dates.add(beat.toDate);
        });
        return [...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    }, [beatData]);
    useEffect(() => {
        if (!availableDates.length) {
            setRangeFromDate("");
            setRangeToDate("");
            setAppliedRange(null);
            return;
        }
        const firstDate = availableDates[0];
        const lastDate = availableDates.at(-1);
        setRangeFromDate((current) =>
            current && current >= firstDate && current <= lastDate ? current : firstDate
        );
        setRangeToDate((current) =>
            current && current >= firstDate && current <= lastDate ? current : lastDate
        );
        setAppliedRange((current) => current &&
            (current.fromDate < firstDate || current.toDate > lastDate) ? null : current
        );
    }, [availableDates]);
    const employeeListsByUlb = useMemo(() => {
        if (selectedUlbId === ALL_ULBS) return allEmployeeListsByUlb;
        return selectedUlbId && employeeList
            ? {[selectedUlbId]: employeeList}
            : {};
    }, [allEmployeeListsByUlb, employeeList, selectedUlbId]);
    const loadedEmployeeIds = useMemo(
        () => loadedSources.map((source) => source.employeeId).filter(Boolean),
        [loadedSources],
    );
    const listedEmployeeCount = Object.values(employeeListsByUlb).reduce(
        (total, list) => total + list.employees.length,
        0,
    );
    const visibleUlbEmployeeErrors = ulbEmployeeErrors.slice(0, 50);
    const visibleReportErrors = reportErrors.slice(0, Math.max(0, 50 - visibleUlbEmployeeErrors.length));
    const hiddenRequestErrorCount = ulbEmployeeErrors.length + reportErrors.length -
        visibleUlbEmployeeErrors.length - visibleReportErrors.length;
    const liveTodayDate = getTodayInTimeZone("Asia/Kolkata");
    const latestAvailableDate = availableDates.at(-1) || "";
    const calendarDateValue = dateSelection === LIVE_DATE
        ? latestAvailableDate
        : dateSelection;
    const rangeIsValid = Boolean(
        rangeFromDate &&
        rangeToDate &&
        rangeFromDate <= rangeToDate &&
        availableDates.length &&
        rangeFromDate >= availableDates[0] &&
        rangeToDate <= availableDates.at(-1)
    );

    const handleDateSelectionChange = (value) => {
        setDateSelection(value || LIVE_DATE);
        setAppliedRange(null);
    };

    const applyDateRange = () => {
        if (!rangeIsValid) return;
        setAppliedRange({fromDate: rangeFromDate, toDate: rangeToDate});
        setDateSelection(rangeToDate);
        setIsRangeOpen(false);
    };

    const handleShowHighPriorityHouses = (request) => {
        setHighPriorityHouseRequest(request);
        setActivePlanner("route");
    };

    return (
        <div className="app-shell flex h-screen min-h-0 flex-row">
            <aside className="app-sidebar shrink-0">
                <div className="app-brand">
                    <div className="app-brand-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M4.5 18.5 9 13l3 2.5 7.5-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="4.5" cy="18.5" r="1.5" fill="currentColor" />
                            <circle cx="19.5" cy="6.5" r="1.5" fill="currentColor" />
                        </svg>
                    </div>
                    <div>
                        <p className="app-brand-title">Beat Operations</p>
                        <p className="app-brand-subtitle">Route planning & collection insights</p>
                    </div>
                </div>
                <nav className="app-tabs" aria-label="Workspace sections">
                    <button
                        type="button"
                        onClick={() => setActivePlanner("overview")}
                        className={`app-tab ${activePlanner === "overview" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "overview" ? "page" : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">▦</span>
                        <span>Executive Overview</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("route")}
                        disabled={selectedUlbId === ALL_ULBS}
                        className={`app-tab ${activePlanner === "route" ? "app-tab-active" : ""} ${selectedUlbId === ALL_ULBS ? "cursor-not-allowed opacity-50" : ""}`}
                        aria-current={activePlanner === "route" ? "page" : undefined}
                        title={selectedUlbId === ALL_ULBS ? "Select one ULB to use route planning." : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">⌖</span>
                        <span>Beat/Route Enhancement</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("analytics")}
                        disabled={selectedUlbId === ALL_ULBS}
                        className={`app-tab ${activePlanner === "analytics" ? "app-tab-active" : ""} ${selectedUlbId === ALL_ULBS ? "cursor-not-allowed opacity-50" : ""}`}
                        aria-current={activePlanner === "analytics" ? "page" : undefined}
                        title={selectedUlbId === ALL_ULBS ? "Select one ULB to use employee analysis." : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">◷</span>
                        <span>Employee Analysis</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("alerts")}
                        disabled={selectedUlbId === ALL_ULBS}
                        className={`app-tab ${activePlanner === "alerts" ? "app-tab-active" : ""} ${selectedUlbId === ALL_ULBS ? "cursor-not-allowed opacity-50" : ""}`}
                        aria-current={activePlanner === "alerts" ? "page" : undefined}
                        title={selectedUlbId === ALL_ULBS ? "Select one ULB to view employee alerts." : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">!</span>
                        <span>Employee Alert</span>
                    </button>
                </nav>
                <div className="app-sidebar-footer">
                    <span className="app-sidebar-footer-dot" aria-hidden="true"/>
                    Beat Operations
                </div>
            </aside>
            <div className="app-workspace flex min-h-0 min-w-0 flex-1 flex-col">
                <section aria-labelledby="shared-filters-heading" className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h2 id="shared-filters-heading" className="text-sm font-semibold text-slate-900">Filters</h2>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setUlbReloadKey((key) => key + 1)}
                                disabled={ulbLoading}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
                            >
                                Refresh ULBs
                            </button>
                            <button
                                type="button"
                                onClick={() => setDataReloadKey((key) => key + 1)}
                                disabled={!selectedUlbId || employeeListLoading || reportLoading}
                                className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                                {selectedUlbId === ALL_ULBS ? "Refresh live data" : "Refresh data"}
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="grid min-w-40 gap-1 text-sm font-semibold text-slate-700">
                            State
                            <select
                                value="Maharashtra"
                                disabled
                                className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 font-normal text-slate-700"
                            >
                                <option value="Maharashtra">Maharashtra</option>
                            </select>
                        </label>
                        <label className="grid min-w-64 gap-1 text-sm font-semibold text-slate-700">
                            ULB
                            <select
                                value={selectedUlbId}
                                onChange={(event) => {
                                    setSelectedUlbId(event.target.value);
                                    if (event.target.value === ALL_ULBS) setActivePlanner("overview");
                                }}
                                disabled={ulbLoading || !ulbs.length}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100"
                            >
                                <option value="">Select a ULB</option>
                                <option value={ALL_ULBS}>All ULBs</option>
                                {ulbs.map((ulb) => (
                                    <option key={ulb.id} value={ulb.id}>{ulb.name}</option>
                                ))}
                            </select>
                        </label>
                        {selectedUlbId === ALL_ULBS ? (
                            <div className="pb-2 text-sm font-semibold text-slate-700">
                                Live monitoring · {liveTodayDate} (IST)
                            </div>
                        ) : (
                            <>
                                <label className="grid min-w-40 gap-1 text-sm font-semibold text-slate-700">
                                    Date
                                    <select
                                        value={dateSelection}
                                        onChange={(event) => handleDateSelectionChange(event.target.value)}
                                        disabled={!availableDates.length}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100"
                                    >
                                        <option value={LIVE_DATE}>
                                            Live date{latestAvailableDate ? ` (${latestAvailableDate})` : ""}
                                        </option>
                                        {availableDates.map((date) => (
                                            <option key={date} value={date}>{date}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="grid min-w-40 gap-1 text-sm font-semibold text-slate-700">
                                    Calendar date
                                    <input
                                        type="date"
                                        value={calendarDateValue}
                                        min={availableDates[0] || undefined}
                                        max={latestAvailableDate || undefined}
                                        onChange={(event) => handleDateSelectionChange(event.target.value)}
                                        disabled={!availableDates.length}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setIsRangeOpen((open) => !open)}
                                    disabled={!availableDates.length}
                                    aria-expanded={isRangeOpen}
                                    className="rounded-lg border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
                                >
                                    {isRangeOpen ? "Hide date range" : "Apply range"}
                                </button>
                                {appliedRange && (
                                    <span className="pb-2 text-xs font-medium text-blue-800">
                                        Applied: {appliedRange.fromDate} to {appliedRange.toDate}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    {isRangeOpen && selectedUlbId !== ALL_ULBS && (
                        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                            <label className="grid gap-1 text-sm font-medium text-slate-700">
                                From date
                                <input
                                    type="date"
                                    value={rangeFromDate}
                                    min={availableDates[0] || undefined}
                                    max={latestAvailableDate || undefined}
                                    onChange={(event) => setRangeFromDate(event.target.value)}
                                    disabled={!availableDates.length}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"
                                />
                            </label>
                            <label className="grid gap-1 text-sm font-medium text-slate-700">
                                To date
                                <input
                                    type="date"
                                    value={rangeToDate}
                                    min={availableDates[0] || undefined}
                                    max={latestAvailableDate || undefined}
                                    onChange={(event) => setRangeToDate(event.target.value)}
                                    disabled={!availableDates.length}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={applyDateRange}
                                disabled={!rangeIsValid}
                                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                                Apply range to all tabs
                            </button>
                            {rangeFromDate && rangeToDate && rangeFromDate > rangeToDate && (
                                <p role="alert" className="w-full text-sm text-red-700">
                                    The start date must be on or before the end date.
                                </p>
                            )}
                        </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-start justify-between gap-3 text-sm text-slate-600" aria-live="polite">
                        <div className="min-w-0 flex-1">
                            {ulbLoading
                                ? <p role="status">Loading ULB list…</p>
                                : ulbError
                                    ? <p role="alert" className="text-red-700">{ulbError}</p>
                                    : selectedUlbId === ALL_ULBS
                                        ? employeeListLoading
                                            ? <p role="status">Loading employee lists for all ULBs: {employeeListProgress.completed.toLocaleString()} of {employeeListProgress.total.toLocaleString()}.</p>
                                            : dataLoadError
                                                ? <p role="alert" className="text-red-700">{dataLoadError}</p>
                                                : reportLoading
                                                    ? <p role="status">
                                                        Loading live reports for {listedEmployeeCount.toLocaleString()} employees: {reportProgress.completed.toLocaleString()} of {reportProgress.total.toLocaleString()}. Up to four reports are fetched at a time.
                                                    </p>
                                                    : (ulbEmployeeErrors.length || reportErrors.length)
                                                        ? <p role="alert" className="text-amber-800">
                                                            Partial live data: {loadedSources.length.toLocaleString()} of {reportProgress.total.toLocaleString()} employee reports loaded; {ulbEmployeeErrors.length.toLocaleString()} ULB employee lists and {reportErrors.length.toLocaleString()} reports failed.
                                                        </p>
                                                        : <p role="status">
                                                            Live data loaded for {Object.keys(employeeListsByUlb).length.toLocaleString()} of {ulbs.length.toLocaleString()} ULBs, {listedEmployeeCount.toLocaleString()} employees, and {loadedSources.length.toLocaleString()} reports.
                                                        </p>
                                        : !selectedUlbId
                                            ? <p>Select a ULB to load its employee list and reports.</p>
                                            : employeeListLoading
                                                ? <p role="status">Loading employees for {ulbs.find((ulb) => ulb.id === selectedUlbId)?.name || "selected ULB"}…</p>
                                                : reportLoading
                                                    ? <p role="status">
                                                        Loading employee reports: {reportProgress.completed.toLocaleString()} of {reportProgress.total.toLocaleString()}
                                                    </p>
                                                    : dataLoadError
                                                        ? <p role="alert" className="text-red-700">{dataLoadError}</p>
                                                        : reportErrors.length
                                                            ? <p role="alert" className="text-amber-800">
                                                                Loaded {loadedSources.length} of {reportProgress.total} reports; {reportErrors.length} failed.
                                                            </p>
                                                            : employeeList
                                                                ? <p role="status">
                                                                    Loaded {employeeList.employees.length.toLocaleString()} employees and {loadedSources.length.toLocaleString()} reports
                                                                    {beatData ? ` · ${beatData.beats.reduce((total, beat) => total + beat.totalHouses, 0).toLocaleString()} houses` : ""}.
                                                                </p>
                                                                : <p>Select a ULB to load its data.</p>}
                            {selectedUlbId === ALL_ULBS && employeeListLoading && employeeListProgress.total > 0 && (
                                <progress
                                    className="mt-1 block h-1.5 w-full accent-blue-700"
                                    value={employeeListProgress.completed}
                                    max={employeeListProgress.total}
                                    aria-label="ULB employee list loading progress"
                                />
                            )}
                            {reportLoading && reportProgress.total > 0 && (
                                <progress
                                    className="mt-1 block h-1.5 w-full accent-blue-700"
                                    value={reportProgress.completed}
                                    max={reportProgress.total}
                                    aria-label={selectedUlbId === ALL_ULBS ? "All-ULB employee report loading progress" : "Employee report loading progress"}
                                />
                            )}
                            {(ulbEmployeeErrors.length > 0 || reportErrors.length > 0) && (
                                <details className="mt-1 text-xs text-amber-900">
                                    <summary className="cursor-pointer font-semibold">
                                        Failed ULB or employee requests ({ulbEmployeeErrors.length + reportErrors.length})
                                    </summary>
                                    <ul className="mt-1 list-inside list-disc">
                                        {visibleUlbEmployeeErrors.map(({ulb, message}) => (
                                            <li key={`ulb-${ulb.id}`}>{ulb.name}: employee list could not be loaded: {message}</li>
                                        ))}
                                        {visibleReportErrors.map(({employee, ulbName, ulbId, message}) => (
                                            <li key={`${ulbId || selectedUlbId}-${employee.id}`}>
                                                {ulbName ? `${ulbName} · ` : ""}{employee.name} ({employee.id}): {message}
                                            </li>
                                        ))}
                                        {hiddenRequestErrorCount > 0 && (
                                            <li>{hiddenRequestErrorCount.toLocaleString()} additional failures not shown.</li>
                                        )}
                                    </ul>
                                </details>
                            )}
                        </div>
                    </div>
                </section>
                <main className="min-h-0 flex-1">
                    <div className={`h-full ${activePlanner === "overview" ? "" : "hidden"}`}>
                        <ExecutiveOverview
                            ulbs={ulbs}
                            selectedUlbId={selectedUlbId}
                            sources={loadedSources}
                            employeeListsByUlb={employeeListsByUlb}
                            liveDate={liveTodayDate}
                            ulbEmployeeErrors={ulbEmployeeErrors}
                            reportErrors={reportErrors}
                            isLoading={employeeListLoading || reportLoading}
                            dateSelection={dateSelection}
                            appliedRange={appliedRange}
                        />
                    </div>
                    <div className={`h-full ${activePlanner === "route" ? "" : "hidden"}`}>
                        <BeatHouseRoutePlanner
                            visible={activePlanner === "route"}
                            beatData={beatData}
                            highPriorityHouseRequest={highPriorityHouseRequest}
                            dateSelection={dateSelection}
                            availableDates={availableDates}
                            appliedRange={appliedRange}
                        />
                    </div>
                    <div className={`h-full ${activePlanner === "analytics" ? "" : "hidden"}`}>
                        <EmployeeApiDashboard
                            key={selectedUlbId || "no-ulb"}
                            beatData={beatData}
                            employeeList={employeeList}
                            onShowHighPriorityHouses={handleShowHighPriorityHouses}
                            dateSelection={dateSelection}
                            appliedRange={appliedRange}
                            availableDates={availableDates}
                            loadedEmployeeIds={loadedEmployeeIds}
                            isLoading={employeeListLoading || reportLoading}
                            isActive={activePlanner === "analytics"}
                        />
                    </div>
                    <div className={`h-full ${activePlanner === "alerts" ? "" : "hidden"}`}>
                        <EmployeeAlerts
                            sources={loadedSources}
                            ulbs={ulbs}
                            employeeListsByUlb={employeeListsByUlb}
                            availableDates={availableDates}
                            dateSelection={dateSelection}
                            appliedRange={appliedRange}
                        />
                    </div>
                </main>
            </div>
        </div>
    );
}
