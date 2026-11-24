import {useState} from "react";
import {CalendarRange, ChevronDown, RefreshCw, SlidersHorizontal} from "lucide-react";
import {ALL_ULBS, LIVE_DATE} from "@/hooks/useWeightCollectionData.js";

export default function FilterBar({data, onSelectAllUlbs}) {
    const {
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
    } = data;
    // On small screens the filter fields can be collapsed to a one-line summary.
    const [filtersOpen, setFiltersOpen] = useState(
        () => !globalThis.matchMedia?.("(max-width: 760px)").matches,
    );
    const filterSummary = [
        selectedUlbId === ALL_ULBS ? "All ULBs" : ulbs.find((ulb) => ulb.id === selectedUlbId)?.name || "No ULB",
        selectedUlbId === ALL_ULBS ? "Live" : dateSelection === LIVE_DATE ? "Live date" : dateSelection,
    ].join(" · ");

    return (
            <section aria-labelledby="shared-filters-heading" className="app-filterbar shrink-0 px-4 py-3 sm:px-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <span className="app-filterbar-icon" aria-hidden="true"><SlidersHorizontal/></span>
                        <h2 id="shared-filters-heading" className="text-sm font-semibold text-slate-900">Filters</h2>
                    </div>
                    <button
                        type="button"
                        onClick={() => setFiltersOpen((open) => !open)}
                        aria-expanded={filtersOpen}
                        aria-controls="shared-filter-fields"
                        className="app-filter-toggle"
                    >
                        <span className="truncate">{filterSummary}</span>
                        <ChevronDown className={filtersOpen ? "rotate-180" : ""} aria-hidden="true"/>
                    </button>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={refreshUlbs}
                            disabled={ulbLoading}
                            className="app-btn app-btn-secondary"
                        >
                            <RefreshCw className={ulbLoading ? "animate-spin" : ""} aria-hidden="true"/>
                            Refresh ULBs
                        </button>
                        <button
                            type="button"
                            onClick={refreshData}
                            disabled={!selectedUlbId || employeeListLoading || reportLoading}
                            className="app-btn app-btn-primary"
                        >
                            <RefreshCw className={employeeListLoading || reportLoading ? "animate-spin" : ""} aria-hidden="true"/>
                            {selectedUlbId === ALL_ULBS ? "Refresh live data" : "Refresh data"}
                        </button>
                    </div>
                </div>
                <div id="shared-filter-fields" className={`app-filter-fields ${filtersOpen ? "" : "is-collapsed"}`}>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="app-field min-w-40">
                        State
                        <select
                            value="Maharashtra"
                            disabled
                            className="ui-control"
                        >
                            <option value="Maharashtra">Maharashtra</option>
                        </select>
                    </label>
                    <label className="app-field min-w-64">
                        ULB
                        <select
                            value={selectedUlbId}
                            onChange={(event) => {
                                setSelectedUlbId(event.target.value);
                                if (event.target.value === ALL_ULBS) onSelectAllUlbs();
                            }}
                            disabled={ulbLoading || !ulbs.length}
                            className="ui-control"
                        >
                            <option value="">Select a ULB</option>
                            <option value={ALL_ULBS}>All ULBs</option>
                            {ulbs.map((ulb) => (
                                <option key={ulb.id} value={ulb.id}>{ulb.name}</option>
                            ))}
                        </select>
                    </label>
                    {selectedUlbId === ALL_ULBS ? (
                        <div className="app-live-badge mb-1">
                            <span className="app-live-dot" aria-hidden="true"/>
                            Live monitoring · {liveTodayDate} (IST)
                        </div>
                    ) : (
                        <>
                            <label className="app-field min-w-40">
                                Date
                                <select
                                    value={dateSelection}
                                    onChange={(event) => handleDateSelectionChange(event.target.value)}
                                    disabled={!availableDates.length}
                                    className="ui-control"
                                >
                                    <option value={LIVE_DATE}>
                                        Live date{latestAvailableDate ? ` (${latestAvailableDate})` : ""}
                                    </option>
                                    {availableDates.map((date) => (
                                        <option key={date} value={date}>{date}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="app-field min-w-40">
                                Calendar date
                                <input
                                    type="date"
                                    value={calendarDateValue}
                                    min={availableDates[0] || undefined}
                                    max={latestAvailableDate || undefined}
                                    onChange={(event) => handleDateSelectionChange(event.target.value)}
                                    disabled={!availableDates.length}
                                    className="ui-control"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => setIsRangeOpen((open) => !open)}
                                disabled={!availableDates.length}
                                aria-expanded={isRangeOpen}
                                className="app-btn app-btn-outline mb-px"
                            >
                                <CalendarRange aria-hidden="true"/>
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
                        <label className="app-field">
                            From date
                            <input
                                type="date"
                                value={rangeFromDate}
                                min={availableDates[0] || undefined}
                                max={latestAvailableDate || undefined}
                                onChange={(event) => setRangeFromDate(event.target.value)}
                                disabled={!availableDates.length}
                                className="ui-control"
                            />
                        </label>
                        <label className="app-field">
                            To date
                            <input
                                type="date"
                                value={rangeToDate}
                                min={availableDates[0] || undefined}
                                max={latestAvailableDate || undefined}
                                onChange={(event) => setRangeToDate(event.target.value)}
                                disabled={!availableDates.length}
                                className="ui-control"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={applyDateRange}
                            disabled={!rangeIsValid}
                            className="app-btn app-btn-primary mb-px"
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
                </div>
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
    );
}
