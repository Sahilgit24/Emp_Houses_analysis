import {useMemo, useState} from "react";
import {ArrowLeft, BellRing, Building2, ChevronRight, Home, MapPinned, ScanLine, Users} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import {Avatar, HeroIcon, SectionIcon, StatIcon} from "./common/Decor.jsx";
import {findOutsideBeatCollectionAlerts, groupAlertsByUlb} from "../data/employeeAlerts.js";

const LIVE_DATE = "live";

function plural(count, word) {
    return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function dateSpan(first, last) {
    if (!first) return "";
    return first === last ? first : `${first} to ${last}`;
}

function SummaryCard({label, value, icon, tone}) {
    return (
        <div className={`stat-card tone-${tone} rounded-xl border border-slate-200 bg-white p-4 shadow-sm`}>
            <div className="stat-card-head">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
                </div>
                <StatIcon icon={icon} tone={tone}/>
            </div>
        </div>
    );
}

function UlbCard({group, onOpen}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="stat-card tone-amber group flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition focus-visible:outline-2 focus-visible:outline-amber-500"
        >
            <div className="stat-card-head w-full">
                <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900" title={group.ulbName}>{group.ulbName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{dateSpan(group.firstDate, group.lastDate)}</p>
                </div>
                <StatIcon icon={Building2} tone="amber"/>
            </div>
            <dl className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
                <div className="info-tile">
                    <dt className="text-[11px] text-slate-500">Employees</dt>
                    <dd className="text-lg font-bold text-slate-900">{group.employees.length.toLocaleString()}</dd>
                </div>
                <div className="info-tile">
                    <dt className="text-[11px] text-slate-500">Houses</dt>
                    <dd className="text-lg font-bold text-slate-900">{group.houseCount.toLocaleString()}</dd>
                </div>
                <div className="info-tile">
                    <dt className="text-[11px] text-slate-500">Scans</dt>
                    <dd className="text-lg font-bold text-slate-900">{group.alertCount.toLocaleString()}</dd>
                </div>
            </dl>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-700">
                View employees
                <ChevronRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden="true"/>
            </span>
        </button>
    );
}

function EmployeeList({group, onSelect}) {
    return (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {group.employees.map((employee) => (
                <li key={employee.key}>
                    <button
                        type="button"
                        onClick={() => onSelect(employee.key)}
                        className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                    >
                        <Avatar name={employee.employeeName}/>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-slate-900">{employee.employeeName}</span>
                            <span className="block truncate text-xs text-slate-500">
                                ID {employee.employeeId} · Assigned in {employee.employeeUlbName}
                            </span>
                        </span>
                        <span className="hidden text-right text-xs text-slate-500 sm:block">
                            <span className="block font-semibold text-slate-900">{plural(employee.houseCount, "house")}</span>
                            {plural(employee.alertCount, "scan")}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true"/>
                    </button>
                </li>
            ))}
        </ul>
    );
}

function EmployeeHouses({employee}) {
    return (
        <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
                <span className="status-pill tone-amber">{plural(employee.houseCount, "house")}</span>
                <span className="status-pill tone-slate">{plural(employee.alertCount, "scan")}</span>
                <span className="status-pill tone-blue">{dateSpan(employee.firstDate, employee.lastDate)}</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <tr>
                            <th className="p-3">Collection date</th>
                            <th className="p-3">House ID</th>
                            <th className="p-3">Beat recorded</th>
                        </tr>
                    </thead>
                    <tbody>
                        {employee.alerts.map((alert) => (
                            <tr key={alert.id} className="border-t border-slate-100">
                                <td className="p-3 text-slate-700">{alert.date}</td>
                                <td className="p-3"><span className="id-chip">{alert.houseId}</span></td>
                                <td className="p-3 text-slate-700">{alert.beatName}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function EmployeeAlerts({
    sources,
    ulbs,
    employeeListsByUlb,
    availableDates,
    dateSelection = LIVE_DATE,
    appliedRange = null,
}) {
    const selectedDate = dateSelection === LIVE_DATE
        ? availableDates.at(-1) || ""
        : dateSelection;
    const fromDate = appliedRange?.fromDate || selectedDate;
    const toDate = appliedRange?.toDate || selectedDate;
    const alerts = useMemo(
        () => findOutsideBeatCollectionAlerts(sources, ulbs, employeeListsByUlb, fromDate, toDate),
        [employeeListsByUlb, fromDate, sources, toDate, ulbs],
    );
    const groups = useMemo(() => groupAlertsByUlb(alerts), [alerts]);
    const employeeCount = useMemo(() => new Set(alerts.map((alert) => alert.employeeId)).size, [alerts]);
    const houseCount = useMemo(
        () => groups.reduce((total, group) => total + group.houseCount, 0),
        [groups],
    );

    const [openUlbKey, setOpenUlbKey] = useState(null);
    const [openEmployeeKey, setOpenEmployeeKey] = useState(null);
    const openGroup = groups.find((group) => group.ulbKey === openUlbKey) || null;
    const openEmployee = openGroup?.employees.find((employee) => employee.key === openEmployeeKey) || null;

    const closeDialog = () => {
        setOpenUlbKey(null);
        setOpenEmployeeKey(null);
    };

    const periodLabel = appliedRange
        ? `Collection history from ${fromDate} to ${toDate}`
        : selectedDate
            ? `Collection history for ${selectedDate}`
            : "";

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                <header className="page-hero page-hero-amber page-hero-row">
                    <HeroIcon icon={BellRing} tone="amber"/>
                    <div className="page-hero-text">
                        <p className="text-sm font-semibold text-amber-700">Collection monitoring</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-900">Employee Alerts</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Collections recorded for an employee in a different assigned Beat.
                        </p>
                    </div>
                </header>

                {alerts.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard label="ULBs with alerts" value={groups.length} icon={Building2} tone="amber"/>
                        <SummaryCard label="Employees" value={employeeCount} icon={Users} tone="violet"/>
                        <SummaryCard label="Houses" value={houseCount} icon={Home} tone="blue"/>
                        <SummaryCard label="Outside-Beat scans" value={alerts.length} icon={ScanLine} tone="rose"/>
                    </div>
                )}

                <section aria-labelledby="outside-beat-alerts-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                        <div>
                            <h2 id="outside-beat-alerts-heading" className="section-heading font-semibold text-slate-900">
                                <SectionIcon icon={MapPinned} tone="amber"/>
                                Outside-Beat collections by ULB
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                {periodLabel
                                    ? `${periodLabel}. Select a ULB to see its employees, then an employee to see the houses.`
                                    : "Select a ULB above to load collection alerts."}
                            </p>
                        </div>
                        <span className="status-pill tone-amber text-sm">
                            {alerts.length.toLocaleString()} alert{alerts.length === 1 ? "" : "s"}
                        </span>
                    </div>
                    {groups.length ? (
                        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                            {groups.map((group) => (
                                <UlbCard
                                    key={group.ulbKey}
                                    group={group}
                                    onOpen={() => {
                                        setOpenUlbKey(group.ulbKey);
                                        setOpenEmployeeKey(null);
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <p role="status" className="p-6 text-center text-sm text-slate-500">
                            {fromDate
                                ? appliedRange
                                    ? "No verified outside-Beat collections were found in this range."
                                    : "No verified outside-Beat collections were found for this date."
                                : "No collection dates are available. Select a ULB above to load its employee reports."}
                        </p>
                    )}
                </section>
                <p className="text-xs text-slate-500">
                    Alerts use the shared date selection or include every verified collection in the applied range. A scanner ID must match an employee assigned to a different loaded Beat.
                </p>
            </div>

            <Dialog open={Boolean(openGroup)} onOpenChange={(open) => { if (!open) closeDialog(); }}>
                <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
                    {openGroup && (
                        <>
                            <DialogHeader className="shrink-0 pr-8">
                                {openEmployee ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setOpenEmployeeKey(null)}
                                            className="mb-1 inline-flex w-fit items-center gap-1 text-xs font-semibold text-amber-700 hover:underline"
                                        >
                                            <ArrowLeft className="size-3.5" aria-hidden="true"/>
                                            All employees in {openGroup.ulbName}
                                        </button>
                                        <DialogTitle className="flex items-center gap-2">
                                            <Avatar name={openEmployee.employeeName}/>
                                            {openEmployee.employeeName}
                                        </DialogTitle>
                                        <DialogDescription>
                                            ID {openEmployee.employeeId} · Assigned in {openEmployee.employeeUlbName}. Houses scanned outside the assigned Beat in {openGroup.ulbName}.
                                        </DialogDescription>
                                    </>
                                ) : (
                                    <>
                                        <DialogTitle>{openGroup.ulbName}</DialogTitle>
                                        <DialogDescription>
                                            {plural(openGroup.employees.length, "employee")} collected outside their assigned Beat here: {plural(openGroup.houseCount, "house")}, {plural(openGroup.alertCount, "scan")}. Select an employee to see the houses.
                                        </DialogDescription>
                                    </>
                                )}
                            </DialogHeader>
                            <div className="min-h-0 flex-1 overflow-y-auto">
                                {openEmployee
                                    ? <EmployeeHouses employee={openEmployee}/>
                                    : <EmployeeList group={openGroup} onSelect={setOpenEmployeeKey}/>}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
