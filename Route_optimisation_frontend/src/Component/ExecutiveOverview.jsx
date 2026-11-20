import {useEffect, useMemo, useState} from "react";
import StateUlbFilters from "./StateUlbFilters.jsx";
import {getExecutiveMonitoringDates, summarizeExecutiveOverview} from "../data/executiveOverview.js";

function OverviewFilter({label, children}) {
    return (
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-slate-700">
            {label}
            {children}
        </label>
    );
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
                {collected.toLocaleString()} of {total.toLocaleString()} houses collected
            </p>
        </div>
    );
}

function EmployeeStatusCard({label, value, detail, tone}) {
    return (
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className={`mt-2 text-3xl font-bold tabular-nums ${tone}`}>{value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </article>
    );
}

export default function ExecutiveOverview({
    ulbs,
    selectedUlbId,
    onSelectedUlbIdChange,
    sources,
    employeeListsByUlb,
}) {
    const [dateSelection, setDateSelection] = useState("live");
    const scopedSources = useMemo(() => selectedUlbId === "all"
        ? sources
        : sources.filter((source) => String(source.ulbId || "") === String(selectedUlbId)),
    [selectedUlbId, sources]);
    const availableDates = useMemo(
        () => getExecutiveMonitoringDates(scopedSources),
        [scopedSources],
    );
    useEffect(() => {
        if (dateSelection !== "live" && !availableDates.includes(dateSelection)) {
            setDateSelection("live");
        }
    }, [availableDates, dateSelection]);
    const selectedDate = dateSelection === "live"
        ? availableDates.at(-1) || ""
        : dateSelection;
    const summary = useMemo(
        () => summarizeExecutiveOverview(
            scopedSources,
            ulbs,
            employeeListsByUlb,
            selectedUlbId,
            selectedDate,
        ),
        [employeeListsByUlb, scopedSources, selectedDate, selectedUlbId, ulbs],
    );

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                <header>
                    <p className="text-sm font-semibold text-blue-700">Live monitoring · {summary.ulbName}</p>
                    <h1 className="mt-1 text-2xl font-bold text-slate-900">Executive Overview</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Employee activity and collection coverage across the selected ULB scope.
                    </p>
                </header>

                <section aria-labelledby="overview-filters-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-4">
                        <h2 id="overview-filters-heading" className="font-semibold text-slate-900">Filters</h2>
                        <p className="mt-1 text-xs text-slate-500">Choose all ULBs or focus on a single ULB and monitoring date.</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <StateUlbFilters
                            ulbs={ulbs}
                            selectedUlbId={selectedUlbId}
                            onSelectedUlbIdChange={onSelectedUlbIdChange}
                            includeAllUlbs
                        />
                        <OverviewFilter label="Monitoring date">
                            <select
                                value={dateSelection}
                                onChange={(event) => setDateSelection(event.target.value)}
                                disabled={!availableDates.length}
                                className="w-full min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-700 disabled:bg-slate-100"
                            >
                                <option value="live">
                                    Latest available date{availableDates.at(-1) ? ` (${availableDates.at(-1)})` : ""}
                                </option>
                                {availableDates.map((date) => (
                                    <option key={date} value={date}>{date}</option>
                                ))}
                            </select>
                        </OverviewFilter>
                    </div>
                </section>

                <section aria-labelledby="employee-activity-heading">
                    <div className="mb-3">
                        <h2 id="employee-activity-heading" className="font-semibold text-slate-900">Employee Activity</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Active means GPS route points were recorded on {selectedDate || "the selected date"} and the employee&apos;s Beat has at least one scanned or unscanned house.
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <EmployeeStatusCard
                            label="Active employees"
                            value={summary.activeEmployees}
                            detail={`GPS route and house records · ${summary.totalEmployees.toLocaleString()} employees total`}
                            tone="text-emerald-700"
                        />
                        <EmployeeStatusCard
                            label="Inactive employees"
                            value={summary.inactiveEmployees}
                            detail="No GPS route recorded on the monitoring date"
                            tone="text-amber-700"
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
                        <h2 id="live-coverage-heading" className="font-semibold text-slate-900">Live Coverage</h2>
                        <p className="mt-1 text-sm text-slate-500">Houses with a recorded collection by the monitoring date.</p>
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
                            Share of houses by their latest recorded collection status through {selectedDate || "the selected date"}.
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
                        {!summary.totalHouses && (
                            <p role="status" className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                Upload employee Beat/API files to calculate collection coverage and patterns.
                            </p>
                        )}
                    </article>
                </section>

                <p className="text-xs text-slate-500">
                    Coverage treats any recorded collection as collected. Collection pattern classifies each house by its latest recorded scan: employee&apos;s own Beat, another assigned Beat, another or unidentified scanner, or no scan. Missing employee lists fall back to employees found in Beat/API files.
                </p>
            </div>
        </div>
    );
}
