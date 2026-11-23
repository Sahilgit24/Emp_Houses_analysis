import {useEffect, useMemo, useState} from "react";
import {
    averageExecutiveOverview,
    getExecutiveEmployees,
    getExecutiveMonitoringDates,
    summarizeExecutiveOverview,
} from "../data/executiveOverview.js";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";

function OverviewFilter({label, children}) {
    return (
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-slate-700">
            {label}
            {children}
        </label>
    );
}

function employeeOptionKey(employee) {
    return `${encodeURIComponent(employee.ulbId)}:${encodeURIComponent(employee.id)}`;
}

function RingCoverage({percent, collected, total}) {
    const radius = 43;
    const circumference = 2 * Math.PI * radius;
    const value = Math.max(0, Math.min(100, percent || 0));
    return (
        <div className="flex flex-col items-center gap-3">
            <svg viewBox="0 0 120 120" className="h-48 w-48" role="img"
                aria-label={percent == null ? "Collection coverage unavailable" : `${percent.toFixed(1)} percent collection coverage`}>
                <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="12"/>
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * value / 100} ${circumference}`}
                    transform="rotate(-90 60 60)"
                />
                <text x="60" y="57" textAnchor="middle" className="fill-slate-900 text-xl font-bold">
                    {percent == null ? "—" : `${percent.toFixed(1)}%`}
                </text>
                <text x="60" y="74" textAnchor="middle" className="fill-slate-500 text-[9px]">
                    covered
                </text>
            </svg>
            <p className="text-center text-sm text-slate-600">
                {collected.toLocaleString(undefined, {maximumFractionDigits: 1})} of {total.toLocaleString()} houses collected
            </p>
        </div>
    );
}

function EmployeeStatusCard({label, value, detail, tone, onClick}) {
    const content = (
        <>
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className={`mt-2 text-3xl font-bold tabular-nums ${tone}`}>
                {value.toLocaleString(undefined, {maximumFractionDigits: 1})}
            </p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </>
    );
    const cardClassName = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
    if (!onClick) return <article className={cardClassName}>{content}</article>;

    return (
        <button
            type="button"
            onClick={onClick}
            aria-haspopup="dialog"
            aria-label={`${label}: ${value}. View employee list.`}
            className={`${cardClassName} text-left transition hover:border-blue-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600`}
        >
            {content}
        </button>
    );
}

export default function ExecutiveOverview({
    ulbs,
    selectedUlbId,
    sources,
    employeeListsByUlb,
    liveDate,
    ulbEmployeeErrors,
    reportErrors,
    isLoading,
    dateSelection,
    appliedRange,
}) {
    const [employeeSelection, setEmployeeSelection] = useState("all");
    const [viewMode, setViewMode] = useState("latest");
    const [employeeStatusDialog, setEmployeeStatusDialog] = useState(null);
    const scopedSources = useMemo(
        () => selectedUlbId === "all"
            ? sources
            : sources.filter((source) => String(source.ulbId || "") === String(selectedUlbId)),
        [selectedUlbId, sources],
    );
    const availableDates = useMemo(
        () => getExecutiveMonitoringDates(scopedSources),
        [scopedSources],
    );
    const employeeOptions = useMemo(
        () => getExecutiveEmployees(sources, employeeListsByUlb, selectedUlbId, ulbs),
        [employeeListsByUlb, selectedUlbId, sources, ulbs],
    );
    const selectedEmployee = selectedUlbId === "all"
        ? null
        : employeeOptions.find(
            (employee) => employeeOptionKey(employee) === employeeSelection,
        ) || null;

    useEffect(() => {
        if (employeeSelection !== "all" &&
            !employeeOptions.some((employee) => employeeOptionKey(employee) === employeeSelection)) {
            setEmployeeSelection("all");
        }
    }, [employeeOptions, employeeSelection]);

    useEffect(() => {
        setViewMode(appliedRange ? "average" : "latest");
    }, [appliedRange]);

    const latestDate = availableDates.at(-1) || "";
    const selectedDate = selectedUlbId === "all"
        ? liveDate
        : viewMode === "latest"
            ? (appliedRange?.toDate || (dateSelection === "live" ? latestDate : dateSelection) || latestDate)
            : appliedRange?.toDate || latestDate;
    const selectedRangeLabel = appliedRange
        ? `${appliedRange.fromDate} to ${appliedRange.toDate}`
        : "";
    const loadedEmployeeIdsByUlb = useMemo(() => {
        const idsByUlb = new Map();
        sources.forEach((source) => {
            const ids = idsByUlb.get(String(source.ulbId)) || new Set();
            if (source.employeeId) ids.add(String(source.employeeId));
            idsByUlb.set(String(source.ulbId), ids);
        });
        return idsByUlb;
    }, [sources]);
    const summaryEmployeeListsByUlb = useMemo(() => {
        if (selectedUlbId !== "all") return employeeListsByUlb;
        return Object.fromEntries(Object.entries(employeeListsByUlb).map(([ulbId, list]) => {
            const loadedIds = loadedEmployeeIdsByUlb.get(String(ulbId)) || new Set();
            return [ulbId, {
                ...list,
                employees: list.employees.filter((employee) => loadedIds.has(String(employee.id))),
            }];
        }));
    }, [employeeListsByUlb, loadedEmployeeIdsByUlb, selectedUlbId]);
    const summary = useMemo(
        () => viewMode === "average" && appliedRange
            ? averageExecutiveOverview(
                scopedSources,
                ulbs,
                summaryEmployeeListsByUlb,
                selectedUlbId,
                appliedRange.fromDate,
                appliedRange.toDate,
                selectedEmployee,
            )
            : summarizeExecutiveOverview(
                scopedSources,
                ulbs,
                summaryEmployeeListsByUlb,
                selectedUlbId,
                selectedDate,
                selectedEmployee,
            ),
        [
            appliedRange,
            summaryEmployeeListsByUlb,
            scopedSources,
            selectedDate,
            selectedEmployee,
            selectedUlbId,
            ulbs,
            viewMode,
        ],
    );
    const allUlbActivity = useMemo(() => {
        const activeEmployeeKeys = new Set(summary.activeEmployeeList.map(
            (employee) => `${employee.ulbId}\u0000${employee.id}`,
        ));
        const listErrors = new Set(ulbEmployeeErrors.map(({ulb}) => String(ulb.id)));
        const rows = ulbs.map((ulb) => {
            const ulbId = String(ulb.id);
            const listedEmployees = employeeListsByUlb[ulbId]?.employees;
            const loadedIds = loadedEmployeeIdsByUlb.get(ulbId) || new Set();
            const activeCount = (listedEmployees || []).filter((employee) =>
                activeEmployeeKeys.has(`${ulbId}\u0000${employee.id}`)
            ).length;
            const missingCount = listedEmployees
                ? listedEmployees.filter((employee) => !loadedIds.has(String(employee.id))).length
                : 0;
            let status;
            if (!listedEmployees) status = listErrors.has(ulbId) ? "Unavailable" : isLoading ? "Loading" : "Unavailable";
            else if (!listedEmployees.length) status = "No employees";
            else if (activeCount && missingCount && isLoading) status = "Active · loading";
            else if (activeCount && missingCount) status = "Active · partial";
            else if (activeCount) status = "Active";
            else if (missingCount && isLoading) status = "Loading";
            else if (missingCount) status = "Partial";
            else status = "Inactive";
            return {
                ...ulb,
                employeeCount: listedEmployees?.length || 0,
                activeCount,
                missingCount,
                status,
            };
        });
        const rank = (status) => status.startsWith("Active") ? 0
            : status === "Partial" ? 1
                : status === "Inactive" ? 2 : 3;
        return rows.sort((a, b) =>
            rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)
        );
    }, [employeeListsByUlb, isLoading, loadedEmployeeIdsByUlb, summary.activeEmployeeList, ulbEmployeeErrors, ulbs]);
    const listedEmployeesCount = Object.values(employeeListsByUlb).reduce(
        (total, list) => total + list.employees.length,
        0,
    );
    const missingReportsCount = allUlbActivity.reduce((total, row) => total + row.missingCount, 0);
    const activeUlbsCount = allUlbActivity.filter((row) => row.activeCount > 0).length;
    const inactiveUlbsCount = allUlbActivity.filter((row) => row.status === "Inactive").length;
    const incompleteUlbsCount = allUlbActivity.length - activeUlbsCount - inactiveUlbsCount;
    const hasIncompleteData = ulbEmployeeErrors.length > 0 || reportErrors.length > 0 || missingReportsCount > 0;
    const statusEmployees = employeeStatusDialog === "active"
        ? summary.activeEmployeeList
        : summary.inactiveEmployeeList;
    const statusDialogTitle = employeeStatusDialog === "active"
        ? `Active employees on ${selectedDate || "selected date"}`
        : `Inactive employees on ${selectedDate || "selected date"}`;
    const statusDialogDescription = viewMode === "average"
        ? `Employee status is shown for the final day of ${selectedRangeLabel}. The dashboard card displays the average per day across the full date range.`
        : `Employee status for ${selectedDate || "the selected date"} and the current ULB and employee filters.`;

    if (selectedUlbId === "all") {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                    <header>
                        <p className="text-sm font-semibold text-blue-700">Live monitoring · {liveDate} IST</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-900">All ULBs</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Daily activity and collection status across Maharashtra. All-ULB monitoring is live-date only.
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                            Live totals are calculated from each listed employee report; loading across all ULBs can take time.
                        </p>
                    </header>
                    {hasIncompleteData && !isLoading && (
                        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                            Some live data could not be loaded. Metrics below use successfully loaded employee reports only; employees with failed reports are not classified as inactive.
                            {missingReportsCount > 0 && ` ${missingReportsCount.toLocaleString()} employee reports are missing.`}
                        </p>
                    )}
                    <section aria-label="All-ULB live totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <EmployeeStatusCard
                            label="Active ULBs today"
                            value={activeUlbsCount}
                            detail="At least one employee has GPS and house records today"
                            tone="text-emerald-700"
                        />
                        <EmployeeStatusCard
                            label="Inactive ULBs today"
                            value={inactiveUlbsCount}
                            detail="All listed employee reports loaded; no qualifying activity today"
                            tone="text-amber-700"
                        />
                        <EmployeeStatusCard
                            label="ULBs pending / incomplete"
                            value={incompleteUlbsCount}
                            detail="Loading, partial, unavailable, or no employee records"
                            tone="text-slate-700"
                        />
                        <EmployeeStatusCard
                            label="Active employees today"
                            value={summary.activeEmployees}
                            detail={`${summary.totalEmployees.toLocaleString()} employees with successful reports`}
                            tone="text-emerald-700"
                            onClick={() => setEmployeeStatusDialog("active")}
                        />
                        <EmployeeStatusCard
                            label="Inactive employees today"
                            value={summary.inactiveEmployees}
                            detail="No qualifying GPS and house activity in loaded reports"
                            tone="text-amber-700"
                            onClick={() => setEmployeeStatusDialog("inactive")}
                        />
                        <EmployeeStatusCard
                            label="Houses in loaded reports"
                            value={summary.totalHouses}
                            detail={`${summary.collectedHouses.toLocaleString()} collected through today`}
                            tone="text-slate-900"
                        />
                    </section>

                    <section aria-labelledby="all-ulb-coverage-heading" className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                            <h2 id="all-ulb-coverage-heading" className="font-semibold text-slate-900">Live Coverage</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Collection status through {liveDate}; based on loaded reports.
                            </p>
                            <div className="mt-3">
                                <RingCoverage
                                    percent={summary.coveragePercent}
                                    collected={summary.collectedHouses}
                                    total={summary.totalHouses}
                                />
                            </div>
                        </article>
                        <article aria-labelledby="all-ulb-pattern-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                            <h2 id="all-ulb-pattern-heading" className="font-semibold text-slate-900">Collection Pattern</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Share of houses by latest recorded collection status through today.
                            </p>
                            <div
                                className="mt-5 flex h-5 overflow-hidden rounded-full bg-slate-100"
                                role="img"
                                aria-label={summary.collectionPattern.map((item) =>
                                    `${item.label}: ${item.percent.toFixed(1)}%`
                                ).join(", ")}
                            >
                                {summary.collectionPattern.map((item) => (
                                    <span
                                        key={item.key}
                                        title={`${item.label}: ${item.count.toLocaleString()} (${item.percent.toFixed(1)}%)`}
                                        style={{width: `${item.percent}%`, backgroundColor: item.color}}
                                    />
                                ))}
                            </div>
                            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                {summary.collectionPattern.map((item) => (
                                    <div key={item.key} className="flex items-start gap-2">
                                        <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm" style={{backgroundColor: item.color}}/>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-slate-700">{item.label}</p>
                                            <p className="text-xs text-slate-500">
                                                {item.count.toLocaleString()} houses · {item.percent.toFixed(1)}%
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {!summary.totalHouses && !isLoading && (
                                <p role="status" className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                    No house records were returned for the loaded employee reports.
                                </p>
                            )}
                        </article>
                    </section>

                    <section aria-labelledby="ulb-activity-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="p-4 sm:p-5">
                            <h2 id="ulb-activity-heading" className="font-semibold text-slate-900">ULB Activity Today</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Active means at least one reported employee has GPS route points dated today and house records in the report.
                            </p>
                        </div>
                        <div className="max-h-[34rem] overflow-auto">
                            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th scope="col" className="px-4 py-3 font-semibold">ULB</th>
                                        <th scope="col" className="px-4 py-3 font-semibold">Employees</th>
                                        <th scope="col" className="px-4 py-3 font-semibold">Active today</th>
                                        <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {allUlbActivity.map((ulb) => {
                                        const statusTone = ulb.status.startsWith("Active")
                                            ? "bg-emerald-100 text-emerald-800"
                                            : ulb.status === "Inactive"
                                                ? "bg-slate-100 text-slate-700"
                                                : "bg-amber-100 text-amber-800";
                                        return (
                                            <tr key={ulb.id}>
                                                <th scope="row" className="px-4 py-3 font-medium text-slate-800">{ulb.name}</th>
                                                <td className="px-4 py-3 tabular-nums text-slate-600">{ulb.employeeCount.toLocaleString()}</td>
                                                <td className="px-4 py-3 tabular-nums text-slate-600">{ulb.activeCount.toLocaleString()}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                                                        {ulb.status}
                                                    </span>
                                                    {ulb.missingCount > 0 && (
                                                        <span className="ml-2 text-xs text-amber-800">
                                                            {ulb.missingCount} report{ulb.missingCount === 1 ? "" : "s"} {isLoading ? "pending" : "missing"}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    <p className="text-xs text-slate-500">
                        Employee activity is measured from the selected date in IST. Collection categories use each house&apos;s latest recorded scan through that date.
                        {listedEmployeesCount > 0 && ` ${summary.totalEmployees.toLocaleString()} of ${listedEmployeesCount.toLocaleString()} listed employees have successful reports.`}
                    </p>
                </div>
                <Dialog
                    open={Boolean(employeeStatusDialog)}
                    onOpenChange={(open) => {
                        if (!open) setEmployeeStatusDialog(null);
                    }}
                >
                    <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
                        <DialogHeader className="shrink-0 pr-8">
                            <DialogTitle>{statusDialogTitle}</DialogTitle>
                            <DialogDescription>{statusDialogDescription}</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {statusEmployees.length ? (
                                <ul className="divide-y divide-slate-100">
                                    {statusEmployees.map((employee) => (
                                        <li key={`${employee.ulbId}:${employee.id}`} className="flex items-center justify-between gap-3 py-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-slate-800">{employee.name}</p>
                                                <p className="mt-1 text-xs text-slate-500">ID: {employee.id} · {employee.ulbName}</p>
                                            </div>
                                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                                employee.isActive
                                                    ? "bg-emerald-100 text-emerald-800"
                                                    : "bg-amber-100 text-amber-800"
                                            }`}>
                                                {employee.isActive ? "Active" : "Inactive"}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p role="status" className="py-8 text-center text-sm text-slate-500">
                                    No successfully reported {employeeStatusDialog} employees for today.
                                </p>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                <header>
                    <p className="text-sm font-semibold text-blue-700">
                        {viewMode === "average" ? "Daily average" : "Monitoring"} · {summary.ulbName}
                    </p>
                    <h1 className="mt-1 text-2xl font-bold text-slate-900">Executive Overview</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Employee activity and collection coverage for {summary.employeeName}.
                    </p>
                </header>

                <section aria-labelledby="overview-filters-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-4">
                        <h2 id="overview-filters-heading" className="font-semibold text-slate-900">Employee filter</h2>
                        <p className="mt-1 text-xs text-slate-500">Choose an employee. State, ULB, date, and range are shared across tabs.</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                        <OverviewFilter label="Employee">
                            <select
                                value={employeeSelection}
                                onChange={(event) => setEmployeeSelection(event.target.value)}
                                disabled={!employeeOptions.length}
                                className="w-full min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-700 disabled:bg-slate-100"
                            >
                                <option value="all">All employees</option>
                                {employeeOptions.map((employee) => (
                                    <option key={employeeOptionKey(employee)} value={employeeOptionKey(employee)}>
                                        {employee.name} · {employee.id}
                                    </option>
                                ))}
                            </select>
                        </OverviewFilter>
                        {appliedRange && (
                            <button
                                type="button"
                                onClick={() => setViewMode((mode) => mode === "average" ? "latest" : "average")}
                                className="rounded-lg border border-blue-700 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                            >
                                {viewMode === "average" ? "Show range end date" : "Average"}
                            </button>
                        )}
                        <p className="pb-2 text-sm text-slate-600">
                            {appliedRange
                                ? `Range: ${appliedRange.fromDate} to ${appliedRange.toDate}`
                                : `Date: ${selectedDate || "Live date"}`}
                        </p>
                    </div>
                </section>

                <section aria-labelledby="employee-activity-heading">
                    <div className="mb-3">
                        <h2 id="employee-activity-heading" className="font-semibold text-slate-900">Employee Activity</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            {viewMode === "average"
                                ? `Daily average across ${summary.averageDays} calendar days (${selectedRangeLabel}). An employee is active on a day when GPS route points and at least one scanned or unscanned house are recorded.`
                                : `Showing activity on ${selectedDate || "the latest available date"}. An employee is active when GPS route points and at least one scanned or unscanned house are recorded.`}
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <EmployeeStatusCard
                            label="Active employees"
                            value={summary.activeEmployees}
                            detail={`${viewMode === "average" ? "Average per day · " : ""}${summary.totalEmployees.toLocaleString()} employees in scope`}
                            tone="text-emerald-700"
                            onClick={() => setEmployeeStatusDialog("active")}
                        />
                        <EmployeeStatusCard
                            label="Inactive employees"
                            value={summary.inactiveEmployees}
                            detail={viewMode === "average" ? "Average inactive employees per day" : "No GPS route or house records on the date"}
                            tone="text-amber-700"
                            onClick={() => setEmployeeStatusDialog("inactive")}
                        />
                        <EmployeeStatusCard
                            label="Houses in scope"
                            value={summary.totalHouses}
                            detail={summary.ulbName}
                            tone="text-slate-900"
                        />
                    </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                    <article aria-labelledby="live-coverage-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <h2 id="live-coverage-heading" className="font-semibold text-slate-900">
                            {viewMode === "average" ? "Average Coverage" : "Coverage"}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                            {viewMode === "average"
                                ? `Daily average across ${summary.averageDays} calendar days.`
                                : `Houses with a recorded collection by ${selectedDate || "the latest available date"}.`}
                        </p>
                        <div className="mt-3">
                            <RingCoverage
                                percent={summary.coveragePercent}
                                collected={summary.collectedHouses}
                                total={summary.totalHouses}
                            />
                        </div>
                    </article>

                    <article aria-labelledby="collection-pattern-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <h2 id="collection-pattern-heading" className="font-semibold text-slate-900">Collection Pattern</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            {viewMode === "average"
                                ? `Average daily share by latest collection status over ${selectedRangeLabel}.`
                                : `Share of houses by their latest recorded collection status through ${selectedDate || "the latest available date"}.`}
                        </p>
                        <div
                            className="mt-5 flex h-5 overflow-hidden rounded-full bg-slate-100"
                            role="img"
                            aria-label={summary.collectionPattern.map((item) =>
                                `${item.label}: ${item.percent.toFixed(1)}%`
                            ).join(", ")}
                        >
                            {summary.collectionPattern.map((item) => (
                                <span
                                    key={item.key}
                                    title={`${item.label}: ${item.count.toLocaleString()} (${item.percent.toFixed(1)}%)`}
                                    style={{width: `${item.percent}%`, backgroundColor: item.color}}
                                />
                            ))}
                        </div>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            {summary.collectionPattern.map((item) => (
                                <div key={item.key} className="flex items-start gap-2">
                                    <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm" style={{backgroundColor: item.color}}/>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-slate-700">{item.label}</p>
                                        <p className="text-xs text-slate-500">
                                            {item.count.toLocaleString(undefined, {maximumFractionDigits: 1})} houses · {item.percent.toFixed(1)}%
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {!summary.totalHouses && (
                            <p role="status" className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                Select a ULB above to load employee reports and calculate collection coverage and patterns.
                            </p>
                        )}
                    </article>
                </section>

                <p className="text-xs text-slate-500">
                    Coverage treats any recorded collection as collected. Collection pattern classifies each house by its latest recorded scan: employee&apos;s own Beat, another assigned Beat, another or unidentified scanner, or no scan. Employee names come from the selected ULB&apos;s employee API list.
                </p>
            </div>
            <Dialog
                open={Boolean(employeeStatusDialog)}
                onOpenChange={(open) => {
                    if (!open) setEmployeeStatusDialog(null);
                }}
            >
                <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
                    <DialogHeader className="shrink-0 pr-8">
                        <DialogTitle>{statusDialogTitle}</DialogTitle>
                        <DialogDescription>{statusDialogDescription}</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {statusEmployees.length ? (
                            <ul className="divide-y divide-slate-100">
                                {statusEmployees.map((employee) => (
                                    <li
                                        key={`${employee.ulbId}:${employee.id}`}
                                        className="flex items-center justify-between gap-3 py-3"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-slate-800">{employee.name}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                ID: {employee.id} · {employee.ulbName}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                            employee.isActive
                                                ? "bg-emerald-100 text-emerald-800"
                                                : "bg-amber-100 text-amber-800"
                                        }`}>
                                            {employee.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p role="status" className="py-8 text-center text-sm text-slate-500">
                                No {employeeStatusDialog} employees for the selected filters.
                            </p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
