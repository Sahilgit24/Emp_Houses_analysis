import {useState} from "react";
import {CalendarRange, ChevronDown, RefreshCw, SlidersHorizontal} from "lucide-react";
import {ALL_ULBS, LIVE_DATE} from "@/hooks/useWeightCollectionData.js";

function formatTime(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time)
        ? new Date(time).toLocaleTimeString("en-IN", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata"})
        : "";
}

/** Status line for the All-ULB view, which reads the backend's live-date snapshot. */
function LiveAllUlbStatus({live}) {
    const summary = live?.data;
    const snapshot = summary?.snapshot;
    const progress = summary?.refreshProgress;
    if (live?.error && !snapshot) return <p role="alert" className="text-red-700">{live.error}</p>;
    if (!summary) {
        return live?.refreshError
            ? <p role="alert" className="text-amber-800">{live.refreshError}</p>
            : <p role="status">Loading All-ULB live data…</p>;
    }
    if (summary.enabled === false && !snapshot) {
        return (
            <>
                <p role="status">All-ULB live monitoring is switched off on the server.</p>
                {live.refreshError && <p role="alert" className="text-amber-800">{live.refreshError}</p>}
            </>
        );
    }
    const refreshText = progress
        ? progress.reportsTotal
            ? `Server refresh in progress: ${progress.reportsDone.toLocaleString()} of ${progress.reportsTotal.toLocaleString()} Beat employee reports.`
            : `Server refresh in progress: ${progress.employeeListsDone.toLocaleString()} of ${progress.employeeListsTotal.toLocaleString()} ULB employee lists.`
        : "";
    return (
        <>
            {snapshot ? (
                <p role="status">
                    {snapshot.complete
                        ? `Live data for ${snapshot.liveDate}, updated ${formatTime(snapshot.generatedAt)} IST · ${snapshot.totals.loadedReports.toLocaleString()} employee reports across ${snapshot.totals.ulbs.toLocaleString()} ULBs. Updates every ${summary.refreshMinutes} minutes.`
                        : `Checking today's ULB activity: ${snapshot.totals.activeUlbs.toLocaleString()} active, ${snapshot.totals.inactiveUlbs.toLocaleString()} inactive, ${(snapshot.totals.checkingUlbs ?? snapshot.totals.pendingUlbs).toLocaleString()} still being checked${snapshot.totals.incompleteUlbs ? `, ${snapshot.totals.incompleteUlbs.toLocaleString()} unavailable or partial` : ""}.`}
                    {summary.stale && ` This snapshot is from ${snapshot.liveDate}; today's data is being prepared.`}
                    {refreshText && ` ${refreshText}`}
                </p>
            ) : (
                <p role="status">{refreshText || "The server is preparing today's All-ULB snapshot."}</p>
            )}
            {live.error && <p role="alert" className="text-amber-800">{live.error}</p>}
            {live.refreshError && <p role="alert" className="text-amber-800">{live.refreshError}</p>}
            {progress?.reportsTotal > 0 && (
                <progress
                    className="mt-1 block h-1.5 w-full accent-blue-700"
                    value={progress.reportsDone}
                    max={progress.reportsTotal}
                    aria-label="Server All-ULB refresh progress"
                />
            )}
        </>
    );
}

export default function FilterBar({data, onSelectAllUlbs}) {
    const {
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
    const invalidBoundaryCount = beatData?.beats.filter((beat) => beat.geofenceIssues?.length).length || 0;
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
                                    ? <LiveAllUlbStatus live={liveAllUlb}/>
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
                                                                {employeeList.employees.some((employee) => employee.hasBeat === false)
                                                                    ? ` (only employees with a Beat have reports)`
                                                                    : ""}
                                                                {beatData ? ` · ${beatData.beats.reduce((total, beat) => total + beat.totalHouses, 0).toLocaleString()} houses` : ""}.
                                                                {invalidBoundaryCount > 0
                                                                    ? ` ${invalidBoundaryCount.toLocaleString()} ${invalidBoundaryCount === 1 ? "Beat has" : "Beats have"} an invalid boundary (marked in Employee Analysis).`
                                                                    : ""}
                                                            </p>
                                                            : <p>Select a ULB to load its data.</p>}
                        {reportLoading && reportProgress.total > 0 && (
                            <progress
                                className="mt-1 block h-1.5 w-full accent-blue-700"
                                value={reportProgress.completed}
                                max={reportProgress.total}
                                aria-label={selectedUlbId === ALL_ULBS ? "All-ULB employee report loading progress" : "Employee report loading progress"}
                            />
                        )}
                        {reportErrors.length > 0 && (
                            <details className="mt-1 text-xs text-amber-900">
                                <summary className="cursor-pointer font-semibold">
                                    Failed employee requests ({reportErrors.length})
                                </summary>
                                <ul className="mt-1 list-inside list-disc">
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
