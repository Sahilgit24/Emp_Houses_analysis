import {useEffect, useMemo, useState} from "react";
import {findOutsideBeatCollectionAlerts} from "../data/employeeAlerts.js";

const LIVE_DATE = "live";

export default function EmployeeAlerts({sources, ulbs, employeeListsByUlb, availableDates}) {
    const [dateSelection, setDateSelection] = useState(LIVE_DATE);
    const selectedDate = dateSelection === LIVE_DATE
        ? availableDates.at(-1) || ""
        : dateSelection;
    const alerts = useMemo(
        () => findOutsideBeatCollectionAlerts(sources, ulbs, employeeListsByUlb, selectedDate),
        [employeeListsByUlb, selectedDate, sources, ulbs],
    );

    useEffect(() => {
        if (dateSelection !== LIVE_DATE && !availableDates.includes(dateSelection)) {
            setDateSelection(LIVE_DATE);
        }
    }, [availableDates, dateSelection]);

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold text-amber-700">Collection monitoring</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-900">Employee Alerts</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Collections recorded for an employee in a different uploaded Beat.
                        </p>
                    </div>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                        Collection date
                        <select
                            value={dateSelection}
                            onChange={(event) => setDateSelection(event.target.value)}
                            disabled={!availableDates.length}
                            className="min-w-52 rounded-lg border border-slate-300 bg-white p-2.5 disabled:bg-slate-100"
                        >
                            <option value={LIVE_DATE}>
                                Latest available date{availableDates.at(-1) ? ` (${availableDates.at(-1)})` : ""}
                            </option>
                            {availableDates.map((date) => (
                                <option key={date} value={date}>{date}</option>
                            ))}
                        </select>
                    </label>
                </header>

                <section aria-labelledby="outside-beat-alerts-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                        <div>
                            <h2 id="outside-beat-alerts-heading" className="font-semibold text-slate-900">
                                Outside-Beat collections
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                {selectedDate ? `Collection history for ${selectedDate}` : "Upload employee Beat/API files to see collection alerts."}
                            </p>
                        </div>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900">
                            {alerts.length.toLocaleString()} alert{alerts.length === 1 ? "" : "s"}
                        </span>
                    </div>
                    {alerts.length ? (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                    <tr>
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
                            {selectedDate
                                ? "No verified outside-Beat collections were found for this date."
                                : "No collection dates are available. Upload the employee Beat/API files to populate this alert tab."}
                        </p>
                    )}
                </section>
                <p className="text-xs text-slate-500">
                    Alerts require a house collection record on the selected date and a scanner ID matching an employee assigned to a different uploaded Beat.
                </p>
            </div>
        </div>
    );
}
