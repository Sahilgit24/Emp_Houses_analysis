import {useMemo} from "react";
import {findOutsideBeatCollectionAlerts} from "../data/employeeAlerts.js";

const LIVE_DATE = "live";

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
    const periodLabel = appliedRange
        ? `Collection history from ${fromDate} to ${toDate}`
        : selectedDate
            ? `Collection history for ${selectedDate}`
            : "";

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold text-amber-700">Collection monitoring</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-900">Employee Alerts</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Collections recorded for an employee in a different assigned Beat.
                        </p>
                    </div>
                </header>

                <section aria-labelledby="outside-beat-alerts-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                        <div>
                            <h2 id="outside-beat-alerts-heading" className="font-semibold text-slate-900">
                                Outside-Beat collections
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                {periodLabel || "Select a ULB above to load collection alerts."}
                            </p>
                        </div>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900">
                            {alerts.length.toLocaleString()} alert{alerts.length === 1 ? "" : "s"}
                        </span>
                    </div>
                    {alerts.length ? (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[850px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                    <tr>
                                        <th className="p-3">Collection date</th>
                                        <th className="p-3">House ID</th>
                                        <th className="p-3">Employee</th>
                                        <th className="p-3">Employee&apos;s ULB</th>
                                        <th className="p-3">Collection ULB</th>
                                        <th className="p-3">Beat recorded</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {alerts.map((alert) => (
                                        <tr key={alert.id} className="border-t border-slate-100">
                                            <td className="p-3 text-slate-700">{alert.date}</td>
                                            <td className="p-3 font-semibold text-slate-900">{alert.houseId}</td>
                                            <td className="p-3 text-slate-700">{alert.employeeName} ({alert.employeeId})</td>
                                            <td className="p-3 text-slate-700">{alert.employeeUlbName}</td>
                                            <td className="p-3 text-slate-700">{alert.ulbName}</td>
                                            <td className="p-3 text-slate-700">{alert.beatName}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
        </div>
    );
}
