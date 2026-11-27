import {useEffect, useMemo, useState} from "react";
import {combineNormalizedBeatData} from "../data/beatApiData.js";
import {getTodayInTimeZone} from "../data/executiveOverview.js";
import {fetchLiveAllUlbSummary, requestLiveAllUlbRefresh} from "../data/liveAllUlbApi.js";
import {
    clearWeightApiCache,
    fetchEmployeeReports,
    fetchEmployeesForUlb,
    fetchUlbDirectory,
} from "../data/weightCollectionApi.js";

export const LIVE_DATE = "live";
export const ALL_ULBS = "all";

// While the backend is building today's All-ULB snapshot the summary is polled more often.
const LIVE_POLL_BUSY_MS = 15000;
const LIVE_POLL_IDLE_MS = 60000;
const EMPTY_LIVE_STATE = {data: null, error: "", refreshError: "", loading: false};

/**
 * Loads the ULB directory, the selected ULB's employees and their Beat reports, and owns the
 * shared date / date-range selection used by every tab. "All ULBs" reads the backend's
 * live-date snapshot instead of downloading every employee report.
 */
export function useWeightCollectionData() {
    const [beatData, setBeatData] = useState(null);
    const [ulbs, setUlbs] = useState([]);
    const [selectedUlbId, setSelectedUlbId] = useState("");
    const [employeeList, setEmployeeList] = useState(null);
    const [liveAllUlb, setLiveAllUlb] = useState(EMPTY_LIVE_STATE);
    const [liveReloadKey, setLiveReloadKey] = useState(0);
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
    // When the selected ULB's reports were downloaded from the API (the oldest report counts),
    // and when the current refresh started.
    const [dataFetchedAt, setDataFetchedAt] = useState("");
    const [dataRefreshStartedAt, setDataRefreshStartedAt] = useState("");

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
            setDataFetchedAt("");
            setDataRefreshStartedAt("");
            return undefined;
        }

        const controller = new AbortController();
        const loadSelectedUlb = async () => {
            setEmployeeList(null);
            setLoadedSources([]);
            setBeatData(null);
            setReportProgress({completed: 0, total: 0});
            setReportErrors([]);
            setDataLoadError("");
            setDateSelection(LIVE_DATE);
            setAppliedRange(null);
            setRangeFromDate("");
            setRangeToDate("");
            setIsRangeOpen(false);
            setEmployeeListLoading(true);
            setReportLoading(false);
            setDataFetchedAt("");
            setDataRefreshStartedAt(new Date().toISOString());
            try {
                // All ULBs: the live summary effect below reads the backend snapshot.
                if (selectedUlbId === ALL_ULBS) return;

                const employees = await fetchEmployeesForUlb(selectedUlbId, {
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                const normalizedEmployeeList = {employees};
                setEmployeeList(normalizedEmployeeList);
                // Only employees with a Beat have house records, so only their reports are downloaded.
                const reportEmployees = employees.filter((employee) => employee.hasBeat !== false);
                setReportProgress({completed: 0, total: reportEmployees.length});
                setEmployeeListLoading(false);
                if (!reportEmployees.length) {
                    setDataFetchedAt(new Date().toISOString());
                    return;
                }

                setReportLoading(true);
                const {reports, errors} = await fetchEmployeeReports(selectedUlbId, reportEmployees, {
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
                const fetchTimes = reports.map(({data}) => data.fetchedAt).filter(Boolean).sort();
                setDataFetchedAt(fetchTimes[0] || new Date().toISOString());
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

    useEffect(() => {
        if (selectedUlbId !== ALL_ULBS) {
            setLiveAllUlb(EMPTY_LIVE_STATE);
            return undefined;
        }
        const controller = new AbortController();
        let timer;
        const load = async (first) => {
            if (first) setLiveAllUlb((current) => ({...current, loading: true, error: ""}));
            let busy = true;
            try {
                const summary = await fetchLiveAllUlbSummary({signal: controller.signal});
                if (controller.signal.aborted) return;
                setLiveAllUlb((current) => ({...current, data: summary, error: "", loading: false}));
                busy = summary.enabled !== false && (summary.refreshing || !summary.snapshot?.complete);
            } catch (error) {
                if (controller.signal.aborted) return;
                setLiveAllUlb((current) => ({
                    ...current,
                    loading: false,
                    error: error instanceof Error ? error.message : "Could not load All-ULB live data.",
                }));
            }
            timer = setTimeout(() => load(false), busy ? LIVE_POLL_BUSY_MS : LIVE_POLL_IDLE_MS);
        };
        load(true);
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [liveReloadKey, selectedUlbId]);

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
    const employeeListsByUlb = useMemo(
        () => selectedUlbId && selectedUlbId !== ALL_ULBS && employeeList
            ? {[selectedUlbId]: employeeList}
            : {},
        [employeeList, selectedUlbId],
    );
    const loadedEmployeeIds = useMemo(
        () => loadedSources.map((source) => source.employeeId).filter(Boolean),
        [loadedSources],
    );
    const listedEmployeeCount = Object.values(employeeListsByUlb).reduce(
        (total, list) => total + list.employees.length,
        0,
    );
    const visibleReportErrors = reportErrors.slice(0, 50);
    const hiddenRequestErrorCount = reportErrors.length - visibleReportErrors.length;
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

    // Refresh buttons always bypass the short-lived API response cache.
    const refreshUlbs = () => {
        clearWeightApiCache();
        setUlbReloadKey((key) => key + 1);
    };
    const refreshData = async () => {
        if (selectedUlbId === ALL_ULBS) {
            // Ask the backend to rebuild today's snapshot now, then poll for its progress.
            // A refusal (for example, live loading switched off) stays visible until the next attempt.
            try {
                await requestLiveAllUlbRefresh();
            } catch (error) {
                setLiveAllUlb((current) => ({
                    ...current,
                    refreshError: error instanceof Error ? error.message : "Could not start a live refresh.",
                }));
                return;
            }
            setLiveAllUlb((current) => ({...current, refreshError: ""}));
            setLiveReloadKey((key) => key + 1);
            return;
        }
        clearWeightApiCache();
        setDataReloadKey((key) => key + 1);
    };

    return {
        dataFetchedAt,
        dataRefreshStartedAt,
        beatData,
        ulbs,
        selectedUlbId,
        setSelectedUlbId,
        employeeList,
        liveAllUlb,
        dateSelection,
        rangeFromDate,
        setRangeFromDate,
        rangeToDate,
        setRangeToDate,
        isRangeOpen,
        setIsRangeOpen,
        appliedRange,
        loadedSources,
        employeeListLoading,
        reportLoading,
        reportProgress,
        dataLoadError,
        reportErrors,
        ulbLoading,
        ulbError,
        availableDates,
        employeeListsByUlb,
        loadedEmployeeIds,
        listedEmployeeCount,
        visibleReportErrors,
        hiddenRequestErrorCount,
        liveTodayDate,
        latestAvailableDate,
        calendarDateValue,
        rangeIsValid,
        handleDateSelectionChange,
        applyDateRange,
        refreshUlbs,
        refreshData,
    };
}
