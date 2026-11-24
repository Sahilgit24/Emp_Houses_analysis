import {useEffect, useMemo, useState} from "react";
import {combineNormalizedBeatData} from "../data/beatApiData.js";
import {getTodayInTimeZone} from "../data/executiveOverview.js";
import {
    clearWeightApiCache,
    fetchEmployeeReportsAcrossUlbs,
    fetchEmployeeReports,
    fetchEmployeesForUlb,
    fetchEmployeesForUlbs,
    fetchUlbDirectory,
} from "../data/weightCollectionApi.js";

export const LIVE_DATE = "live";
export const ALL_ULBS = "all";

/**
 * Loads the ULB directory, the selected ULB's employees and their Beat reports, and owns the
 * shared date / date-range selection used by every tab.
 */
export function useWeightCollectionData() {
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

    // Refresh buttons always bypass the short-lived API response cache.
    const refreshUlbs = () => {
        clearWeightApiCache();
        setUlbReloadKey((key) => key + 1);
    };
    const refreshData = () => {
        clearWeightApiCache();
        setDataReloadKey((key) => key + 1);
    };

    return {
        beatData,
        ulbs,
        selectedUlbId,
        setSelectedUlbId,
        employeeList,
        ulbEmployeeErrors,
        employeeListProgress,
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
        visibleUlbEmployeeErrors,
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
