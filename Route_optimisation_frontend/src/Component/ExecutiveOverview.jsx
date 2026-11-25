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
import {
    Activity,
    Filter,
    Home,
    LayoutDashboard,
    PieChart,
    Target,
    UserCheck,
    UserX,
} from "lucide-react";
import {HeroIcon, MiniBar, SectionIcon, StatIcon} from "./common/Decor.jsx";
import {toneFromTextClass} from "./common/decorTones.js";

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

export function RingCoverage({percent, collected, total}) {
    const radius = 43;
    const circumference = 2 * Math.PI * radius;
    const value = Math.max(0, Math.min(100, percent || 0));
    return (
        <div className="flex flex-col items-center gap-3">
            <svg viewBox="0 0 120 120" className="h-48 w-48" role="img"
                aria-label={percent == null ? "Collection coverage unavailable" : `${percent.toFixed(1)} percent collection coverage`}>
                <defs>
                    <linearGradient id="coverage-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#34d399"/>
                        <stop offset="100%" stopColor="#059669"/>
                    </linearGradient>
                </defs>
                <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="12"/>
                <circle cx="60" cy="60" r="31" fill="#f0fdf4"/>
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke="url(#coverage-ring-gradient)"
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

function CollectionPattern({
    summary,
    selectedDate,
    viewMode,
    selectedRangeLabel,
    reportStatus,
    showUlbColumn,
}) {
    const [selectedCategory, setSelectedCategory] = useState(null);
    const categoryDescriptions = {
        inside: "The latest recorded scan through this date matches the employee assigned to this house's Beat.",
        outside: "The latest recorded scan through this date is attributed to an employee assigned to another Beat.",
        other: "The latest recorded scan is attributed to another or unidentified scanner, or cannot be verified against an assigned Beat.",
        never: "No scan appears in the collection history returned by the loaded reports through this date. This does not prove the house was never scanned.",
    };
    const selectedPattern = summary.collectionPattern.find(
        (item) => item.key === selectedCategory,
    );
    const listDate = viewMode === "average" ? selectedRangeLabel.split(" to ").at(-1) : selectedDate;
    const listTitle = selectedPattern
        ? `${selectedPattern.label} · ${selectedPattern.houses.length.toLocaleString()} houses`
        : "";

    return (
        <>
            <article aria-labelledby="collection-pattern-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <h2 id="collection-pattern-heading" className="section-heading font-semibold text-slate-900"><SectionIcon icon={PieChart} tone="violet"/>Collection Pattern</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            {viewMode === "average"
                                ? `Average daily share by latest collection status over ${selectedRangeLabel}.`
                                : `Share of houses by their latest recorded collection status through ${selectedDate || "the latest available date"}.`}
                        </p>
                    </div>
                    <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold tabular-nums text-slate-700">
                        {summary.totalHouses.toLocaleString()} houses
                    </p>
                </div>
                <div
                    className="mt-5 flex h-5 overflow-hidden rounded-full bg-slate-100"
                    role="group"
                    aria-label={summary.collectionPattern.map((item) =>
                        `${item.label}: ${item.count.toLocaleString(undefined, {maximumFractionDigits: 1})} houses, ${item.percent.toFixed(1)}%`
                    ).join(", ")}
                >
                    {summary.collectionPattern.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => item.houses.length && setSelectedCategory(item.key)}
                            disabled={!item.houses.length}
                            aria-label={`View ${item.label}: ${item.count.toLocaleString(undefined, {maximumFractionDigits: 1})} houses, ${item.percent.toFixed(1)} percent`}
                            title={`${item.label}: ${item.count.toLocaleString(undefined, {maximumFractionDigits: 1})} houses (${item.percent.toFixed(1)}%). ${categoryDescriptions[item.key]}`}
                            className="h-full min-w-0 border-0 p-0 disabled:cursor-default"
                            style={{width: `${item.percent}%`, backgroundColor: item.color}}
                        />
                    ))}
                </div>
                <div className="mt-5 grid gap-1 sm:grid-cols-2">
                    {summary.collectionPattern.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            disabled={!item.houses.length}
                            onClick={() => setSelectedCategory(item.key)}
                            title={categoryDescriptions[item.key]}
                            className="flex min-w-0 items-start gap-2 rounded-md p-2 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                            <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm" style={{backgroundColor: item.color}}/>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-slate-700">{item.label}</span>
                                <span className="block text-xs tabular-nums text-slate-500">
                                    {item.count.toLocaleString(undefined, {maximumFractionDigits: 1})} houses · {item.percent.toFixed(1)}%
                                    {viewMode === "average" ? " · avg/day" : ""}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
                <div className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                    reportStatus.incomplete
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-emerald-100 bg-emerald-50 text-emerald-800"
                }`}>
                    <p className="font-semibold">{reportStatus.label}</p>
                    <p className="mt-0.5">{reportStatus.detail}</p>
                </div>
                {!summary.totalHouses && (
                    <p role="status" className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        No house records are available to calculate this pattern.
                    </p>
                )}
            </article>
            <Dialog
                open={Boolean(selectedPattern)}
                onOpenChange={(open) => {
                    if (!open) setSelectedCategory(null);
                }}
            >
                <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl">
                    <DialogHeader className="shrink-0 pr-8">
                        <DialogTitle>{listTitle}</DialogTitle>
                        <DialogDescription>
                            {categoryDescriptions[selectedCategory]}
                            {viewMode === "average"
                                ? ` The list shows house status on the range end date (${listDate}); the displayed count is the daily average.`
                                : ` Status is through ${listDate || "the latest available date"}.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200">
                        <table className="w-full min-w-[700px] text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th scope="col" className="p-3">House ID</th>
                                    {showUlbColumn && <th scope="col" className="p-3">ULB</th>}
                                    <th scope="col" className="p-3">Beat</th>
                                    <th scope="col" className="p-3">Latest scan</th>
                                    <th scope="col" className="p-3">Scanner</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selectedPattern?.houses.map((house) => (
                                    <tr key={`${house.ulbId}:${house.beatName}:${house.houseId}`} className="border-t border-slate-100">
                                        <th scope="row" className="p-3 font-medium text-slate-800">{house.houseId}</th>
                                        {showUlbColumn && <td className="p-3 text-slate-600">{house.ulbName}</td>}
                                        <td className="p-3 text-slate-600">{house.beatName}</td>
                                        <td className="p-3 text-slate-600">{house.scannedDate || "No recorded scan"}</td>
                                        <td className="p-3 text-slate-600">
                                            {house.scannerName || house.scannerId || "Unidentified"}
                                        </td>
                                    </tr>
                                ))}
                                {!selectedPattern?.houses.length && (
                                    <tr><td colSpan={showUlbColumn ? 5 : 4} className="p-6 text-center text-slate-500">No houses in this category.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function EmployeeStatusCard({label, value, detail, tone, onClick, icon, total}) {
    const accent = toneFromTextClass(tone);
    const content = (
        <>
            <div className="stat-card-head">
                <p className="text-sm font-medium text-slate-600">{label}</p>
                {icon && <StatIcon icon={icon} tone={accent}/>}
            </div>
            <p className={`text-3xl font-bold tabular-nums ${tone}`}>
                {value.toLocaleString(undefined, {maximumFractionDigits: 1})}
            </p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
            <MiniBar value={value} total={total} tone={accent}/>
        </>
    );
    const cardClassName = `stat-card tone-${accent} rounded-xl border border-slate-200 bg-white p-4 shadow-sm`;
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
    reportErrors,
    isLoading,
    dateSelection,
    appliedRange,
}) {
    const [employeeSelection, setEmployeeSelection] = useState("all");
    const [viewMode, setViewMode] = useState("latest");
    const [employeeStatusDialog, setEmployeeStatusDialog] = useState(null);
    const scopedSources = useMemo(
        () => sources.filter((source) => String(source.ulbId || "") === String(selectedUlbId)),
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
    const selectedEmployee = employeeOptions.find(
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
    const selectedDate = viewMode === "latest"
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
    const summary = useMemo(
        () => viewMode === "average" && appliedRange
            ? averageExecutiveOverview(
                scopedSources,
                ulbs,
                employeeListsByUlb,
                selectedUlbId,
                appliedRange.fromDate,
                appliedRange.toDate,
                selectedEmployee,
            )
            : summarizeExecutiveOverview(
                scopedSources,
                ulbs,
                employeeListsByUlb,
                selectedUlbId,
                selectedDate,
                selectedEmployee,
            ),
        [
            appliedRange,
            employeeListsByUlb,
            scopedSources,
            selectedDate,
            selectedEmployee,
            selectedUlbId,
            ulbs,
            viewMode,
        ],
    );
    const reportScopeUlbIds = [String(selectedUlbId)];
    const expectedReportCount = reportScopeUlbIds.reduce(
        (total, ulbId) => total + (employeeListsByUlb[ulbId]?.employees || [])
            .filter((employee) => employee.hasBeat !== false).length,
        0,
    );
    const loadedReportCount = reportScopeUlbIds.reduce(
        (total, ulbId) => total + (loadedEmployeeIdsByUlb.get(ulbId)?.size || 0),
        0,
    );
    const scopedReportErrors = reportErrors.filter((error) =>
        !error.ulbId || String(error.ulbId) === String(selectedUlbId)
    );
    const missingEmployeeLists = reportScopeUlbIds.filter((ulbId) => !employeeListsByUlb[ulbId]).length;
    const missingReportCount = Math.max(
        0,
        expectedReportCount - loadedReportCount - scopedReportErrors.length,
    );
    const reportStatus = isLoading
        ? {
            label: expectedReportCount
                ? `Loading reports · ${loadedReportCount.toLocaleString()} of ${expectedReportCount.toLocaleString()} received`
                : "Loading employee lists and reports",
            detail: `${missingEmployeeLists.toLocaleString()} ULB employee list${missingEmployeeLists === 1 ? "" : "s"} still loading.`,
            incomplete: true,
        }
        : scopedReportErrors.length || missingReportCount || missingEmployeeLists
            ? {
                label: "Partial report data",
                detail: `${loadedReportCount.toLocaleString()} of ${expectedReportCount.toLocaleString()} employee reports loaded · ${scopedReportErrors.length.toLocaleString()} failed.`,
                incomplete: true,
            }
            : expectedReportCount
                ? {
                    label: `All ${loadedReportCount.toLocaleString()} employee reports loaded`,
                    detail: "Pattern totals include the loaded reports in the current ULB scope.",
                    incomplete: false,
                }
                : {
                    label: "No employee reports available",
                    detail: "Select a ULB or wait for its employee list to load.",
                    incomplete: true,
                };
    const statusEmployees = employeeStatusDialog === "active"
        ? summary.activeEmployeeList
        : summary.inactiveEmployeeList;
    const statusDialogTitle = employeeStatusDialog === "active"
        ? `Active employees on ${selectedDate || "selected date"}`
        : `Inactive employees on ${selectedDate || "selected date"}`;
    const statusDialogDescription = viewMode === "average"
        ? `Employee status is shown for the final day of ${selectedRangeLabel}. The dashboard card displays the average per day across the full date range.`
        : `Employee status for ${selectedDate || "the selected date"} and the current ULB and employee filters.`;

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                <header className="page-hero page-hero-row">
                    <HeroIcon icon={LayoutDashboard} tone="blue"/>
                    <div className="page-hero-text">
                    <p className="text-sm font-semibold text-blue-700">
                        {viewMode === "average" ? "Daily average" : "Monitoring"} · {summary.ulbName}
                    </p>
                    <h1 className="mt-1 text-2xl font-bold text-slate-900">Executive Overview</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Employee activity and collection coverage for {summary.employeeName}.
                    </p>
                    </div>
                </header>

                <section aria-labelledby="overview-filters-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:flex lg:items-end lg:justify-between lg:gap-8">
                    <div className="mb-4 lg:mb-1 lg:max-w-xs lg:shrink-0">
                        <h2 id="overview-filters-heading" className="section-heading font-semibold text-slate-900"><SectionIcon icon={Filter} tone="blue"/>Employee filter</h2>
                        <p className="mt-1 text-xs text-slate-500">Choose an employee. State, ULB, date, and range are shared across tabs.</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3 lg:max-w-3xl lg:flex-1">
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
                        <h2 id="employee-activity-heading" className="section-heading font-semibold text-slate-900"><SectionIcon icon={Activity} tone="blue"/>Employee Activity</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            {viewMode === "average"
                                ? `Daily average across ${summary.averageDays} calendar days (${selectedRangeLabel}). An employee is active on a day when GPS route points and at least one scanned or unscanned house are recorded.`
                                : `Showing activity on ${selectedDate || "the latest available date"}. An employee is active when GPS route points and at least one scanned or unscanned house are recorded.`}
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <EmployeeStatusCard
                            label="Active employees"
                            icon={UserCheck} total={summary.totalEmployees}
                            value={summary.activeEmployees}
                            detail={`${viewMode === "average" ? "Average per day · " : ""}${summary.totalEmployees.toLocaleString()} employees in scope`}
                            tone="text-emerald-700"
                            onClick={() => setEmployeeStatusDialog("active")}
                        />
                        <EmployeeStatusCard
                            label="Inactive employees"
                            icon={UserX} total={summary.totalEmployees}
                            value={summary.inactiveEmployees}
                            detail={viewMode === "average" ? "Average inactive employees per day" : "No GPS route or house records on the date"}
                            tone="text-amber-700"
                            onClick={() => setEmployeeStatusDialog("inactive")}
                        />
                        <EmployeeStatusCard
                            label="Houses in scope"
                            icon={Home}
                            value={summary.totalHouses}
                            detail={summary.ulbName}
                            tone="text-slate-900"
                        />
                    </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                    <article aria-labelledby="live-coverage-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <h2 id="live-coverage-heading" className="section-heading font-semibold text-slate-900">
                            <SectionIcon icon={Target} tone="emerald"/>
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

                    <CollectionPattern
                        summary={summary}
                        selectedDate={selectedDate}
                        viewMode={viewMode}
                        selectedRangeLabel={selectedRangeLabel}
                        reportStatus={reportStatus}
                        showUlbColumn={false}
                    />
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
