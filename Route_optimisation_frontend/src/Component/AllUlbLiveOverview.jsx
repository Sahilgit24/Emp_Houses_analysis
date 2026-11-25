import {useEffect, useMemo, useRef, useState} from "react";
import {Building2, CircleDashed, Globe2, Home, PieChart, Search, Target, UserCheck, UserX} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import {Avatar, HeroIcon, SectionIcon} from "./common/Decor.jsx";
import {EmployeeStatusCard, RingCoverage} from "./ExecutiveOverview.jsx";
import {
    fetchLiveAllUlbEmployees,
    fetchLiveAllUlbHouses,
    liveCollectionPattern,
} from "../data/liveAllUlbApi.js";

const PAGE_SIZE = 500;

const CATEGORY_DESCRIPTIONS = {
    inside: "Scanned today by the employee assigned to the house's Beat.",
    outside: "Scanned today by an employee assigned to another Beat in the same ULB.",
    other: "Scanned today by another or unidentified scanner that cannot be matched to an assigned Beat.",
    not_scanned_today: "No scan recorded today. Listed per Beat, because the house-level list across all ULBs is very large.",
};

function formatTime(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time)
        ? new Date(time).toLocaleTimeString("en-IN", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata"})
        : "";
}

function formatScanTime(value) {
    return value ? value.replace("T", " ").slice(0, 16) : "";
}

function statusTone(status) {
    if (status.startsWith("Active")) return "bg-emerald-100 text-emerald-800";
    if (status === "Inactive") return "bg-slate-100 text-slate-700";
    if (status === "Checking") return "bg-blue-50 text-blue-700";
    return "bg-amber-100 text-amber-800";
}

/** Dialog that loads a server-side list page by page. */
function LiveListDialog({request, onClose}) {
    const [state, setState] = useState({items: [], total: 0, loading: false, error: ""});
    // The controller of the list currently shown; pages that arrive for an older list are ignored.
    const listController = useRef(null);

    useEffect(() => {
        if (!request) return undefined;
        const controller = new AbortController();
        listController.current = controller;
        setState({items: [], total: 0, loading: true, error: ""});
        request.load({offset: 0, limit: PAGE_SIZE, signal: controller.signal})
            .then((page) => setState({items: page.items || [], total: page.total || 0, loading: false, error: ""}))
            .catch((error) => {
                if (!controller.signal.aborted) {
                    setState({items: [], total: 0, loading: false, error: error.message || "The list could not be loaded."});
                }
            });
        return () => controller.abort();
    }, [request]);

    const loadMore = async () => {
        const controller = listController.current;
        if (!controller || controller.signal.aborted) return;
        setState((current) => ({...current, loading: true}));
        try {
            const page = await request.load({offset: state.items.length, limit: PAGE_SIZE, signal: controller.signal});
            if (controller.signal.aborted) return;
            setState((current) => ({...current, items: [...current.items, ...(page.items || [])], loading: false}));
        } catch (error) {
            if (controller.signal.aborted) return;
            setState((current) => ({...current, loading: false, error: error.message || "More rows could not be loaded."}));
        }
    };

    return (
        <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl">
                {request && (
                    <>
                        <DialogHeader className="shrink-0 pr-8">
                            <DialogTitle>{request.title}{state.total ? ` · ${state.total.toLocaleString()}` : ""}</DialogTitle>
                            <DialogDescription>{request.description}</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[640px] text-left text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    <tr>{request.columns.map((column) => <th key={column.label} scope="col" className="p-3">{column.label}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {state.items.map((item, index) => (
                                        <tr key={index} className="border-t border-slate-100">
                                            {request.columns.map((column) => (
                                                <td key={column.label} className="p-3 text-slate-700">{column.render(item)}</td>
                                            ))}
                                        </tr>
                                    ))}
                                    {!state.loading && !state.error && !state.items.length && (
                                        <tr><td colSpan={request.columns.length} className="p-6 text-center text-slate-500">Nothing to show.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                            <span role="status">
                                {state.loading
                                    ? "Loading…"
                                    : state.error
                                        ? <span className="text-red-700">{state.error}</span>
                                        : `Showing ${state.items.length.toLocaleString()} of ${state.total.toLocaleString()}`}
                            </span>
                            {!state.loading && state.items.length < state.total && (
                                <button type="button" onClick={loadMore} className="app-btn">Load more</button>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default function AllUlbLiveOverview({live, liveDate}) {
    const [listRequest, setListRequest] = useState(null);
    const [ulbQuery, setUlbQuery] = useState("");
    const summary = live?.data;
    const snapshot = summary?.snapshot;
    const totals = snapshot?.totals;
    const runId = snapshot?.runId;
    const pattern = useMemo(() => liveCollectionPattern(totals), [totals]);
    const collectedToday = totals
        ? totals.counts.inside + totals.counts.outside + totals.counts.other
        : 0;
    const coveragePercent = totals?.totalHouses ? collectedToday * 100 / totals.totalHouses : null;
    const ulbRows = useMemo(() => {
        const rank = (status) => status.startsWith("Active") ? 0
            : status === "Partial" ? 1
                : status === "Inactive" ? 2
                    : status === "Checking" ? 3 : 4;
        const query = ulbQuery.trim().toLowerCase();
        return (snapshot?.ulbs || [])
            .filter((ulb) => !query || ulb.name.toLowerCase().includes(query))
            .map((ulb) => {
                const collected = ulb.counts.inside + ulb.counts.outside + ulb.counts.other;
                return {...ulb, collected, coverage: ulb.totalHouses ? collected * 100 / ulb.totalHouses : null};
            })
            .sort((a, b) => rank(a.status) - rank(b.status) || b.activeEmployees - a.activeEmployees || a.name.localeCompare(b.name));
    }, [snapshot, ulbQuery]);

    const openEmployees = (status) => setListRequest({
        title: status === "active" ? `Active employees on ${snapshot.liveDate}` : `Inactive employees on ${snapshot.liveDate}`,
        description: status === "active"
            ? "Employees whose Beat has house records and whose route has GPS points today."
            : "Beat employees whose report loaded but has no GPS route points today. Employees without a Beat are not listed.",
        load: (page) => fetchLiveAllUlbEmployees({status, runId, ...page}),
        columns: [
            {label: "Employee", render: (row) => <span className="person-cell"><Avatar name={row.name}/>{row.name}</span>},
            {label: "ID", render: (row) => <span className="id-chip">{row.id}</span>},
            {label: "ULB", render: (row) => row.ulbName},
        ],
    });
    const openCategory = (item) => setListRequest({
        title: item.label,
        description: CATEGORY_DESCRIPTIONS[item.key],
        load: (page) => fetchLiveAllUlbHouses({category: item.key, runId, ...page}),
        columns: item.key === "not_scanned_today"
            ? [
                {label: "ULB", render: (row) => row.ulbName},
                {label: "Beat", render: (row) => row.beatName},
                {label: "Houses not scanned today", render: (row) => `${row.notScannedToday.toLocaleString()} of ${row.totalHouses.toLocaleString()}`},
            ]
            : [
                {label: "House ID", render: (row) => <span className="id-chip">{row.houseId}</span>},
                {label: "ULB", render: (row) => row.ulbName},
                {label: "Beat", render: (row) => row.beatName},
                {label: "Scanned at", render: (row) => formatScanTime(row.scannedAt)},
                {label: "Scanner", render: (row) => row.scannerName || row.scannerId || "Unidentified"},
            ],
    });

    const header = (
        <header className="page-hero page-hero-teal page-hero-row">
            <HeroIcon icon={Globe2} tone="teal"/>
            <div className="page-hero-text">
                <p className="text-sm font-semibold text-blue-700">Live monitoring · {snapshot?.liveDate || liveDate} IST</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">All ULBs</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Today&apos;s activity and collection status across Maharashtra. All-ULB monitoring shows the live date only.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    The server prepares this view in the background{summary ? ` and updates it every ${summary.refreshMinutes} minutes` : ""}
                    {snapshot?.complete ? ` · last updated ${formatTime(snapshot.generatedAt)} IST` : ""}.
                </p>
            </div>
        </header>
    );

    if (!snapshot) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                    {header}
                    <p role={live?.error ? "alert" : "status"} className={`rounded-xl border p-6 text-center text-sm ${
                        live?.error ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600"
                    }`}>
                        {live?.error || (summary?.enabled === false
                            ? "All-ULB live monitoring is switched off on the server, because loading every ULB takes several hours with the current report API. Select a single ULB to see its data."
                            : summary
                                ? "The server is preparing today's All-ULB data. The first ULBs appear here as soon as they are ready."
                                : "Loading All-ULB live data…")}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
                {header}
                {(!snapshot.complete || summary.stale) && (
                    <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                        {summary.stale
                            ? `These figures are from ${snapshot.liveDate}. Today's snapshot is being prepared and will replace them automatically.`
                            : `Checking today's activity ULB by ULB. A ULB is marked Active as soon as one of its employees is found working today, and Inactive once all its Beat employees are checked. Coverage and the collection pattern appear when every ULB is finished.`}
                    </p>
                )}
                {snapshot.complete && totals.failedReports > 0 && (
                    <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                        {totals.failedReports.toLocaleString()} employee report{totals.failedReports === 1 ? "" : "s"} could not be loaded. Figures use the loaded reports only; those employees are not counted as inactive.
                    </p>
                )}

                {!snapshot.complete ? (
                    <section aria-label="All-ULB activity so far" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <EmployeeStatusCard
                            label="Active ULBs today" icon={Building2} total={totals.ulbs}
                            value={totals.activeUlbs}
                            detail="At least one employee found working today"
                            tone="text-emerald-700"
                        />
                        <EmployeeStatusCard
                            label="Inactive ULBs today" icon={Building2} total={totals.ulbs}
                            value={totals.inactiveUlbs}
                            detail="All Beat employees checked; nobody working today"
                            tone="text-amber-700"
                        />
                        <EmployeeStatusCard
                            label="ULBs still being checked" icon={CircleDashed} total={totals.ulbs}
                            value={totals.checkingUlbs ?? totals.pendingUlbs}
                            detail={totals.incompleteUlbs
                                ? `${totals.incompleteUlbs.toLocaleString()} more are unavailable or partial`
                                : "No active employee found yet"}
                            tone="text-slate-700"
                        />
                        <EmployeeStatusCard
                            label="Active employees found" icon={UserCheck} total={totals.beatEmployees}
                            value={totals.activeEmployees}
                            detail={`${totals.checkedReports.toLocaleString()} of ${totals.beatEmployees.toLocaleString()} Beat employees checked`}
                            tone="text-emerald-700"
                        />
                    </section>
                ) : (
                    <section aria-label="All-ULB live totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <EmployeeStatusCard
                            label="Active ULBs today" icon={Building2} total={totals.ulbs}
                            value={totals.activeUlbs}
                            detail="At least one employee has GPS and house records today"
                            tone="text-emerald-700"
                        />
                        <EmployeeStatusCard
                            label="Inactive ULBs today" icon={Building2} total={totals.ulbs}
                            value={totals.inactiveUlbs}
                            detail="All listed employee reports loaded; no qualifying activity today"
                            tone="text-amber-700"
                        />
                        <EmployeeStatusCard
                            label="ULBs pending / incomplete" icon={CircleDashed} total={totals.ulbs}
                            value={totals.pendingUlbs}
                            detail="Loading, partial, unavailable, or no employee records"
                            tone="text-slate-700"
                        />
                        <EmployeeStatusCard
                            label="Active employees today" icon={UserCheck} total={totals.loadedReports}
                            value={totals.activeEmployees}
                            detail={`${totals.loadedReports.toLocaleString()} employees with loaded reports`}
                            tone="text-emerald-700"
                            onClick={() => openEmployees("active")}
                        />
                        <EmployeeStatusCard
                            label="Inactive employees today" icon={UserX} total={totals.loadedReports}
                            value={totals.inactiveEmployees}
                            detail={totals.noBeatEmployees
                                ? `No GPS route points today · ${totals.noBeatEmployees.toLocaleString()} more employees have no Beat`
                                : "No GPS route points today in loaded reports"}
                            tone="text-amber-700"
                            onClick={() => openEmployees("inactive")}
                        />
                        <EmployeeStatusCard
                            label="Houses in loaded reports" icon={Home}
                            value={totals.totalHouses}
                            detail={`${collectedToday.toLocaleString()} scanned today`}
                            tone="text-slate-900"
                        />
                    </section>
                )}

                {snapshot.complete && (
                <section className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                    <article aria-labelledby="live-coverage-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <h2 id="live-coverage-heading" className="section-heading font-semibold text-slate-900"><SectionIcon icon={Target} tone="emerald"/>Coverage Today</h2>
                        <p className="mt-1 text-sm text-slate-500">Houses scanned on {snapshot.liveDate} out of all houses in loaded reports.</p>
                        <div className="mt-3">
                            <RingCoverage percent={coveragePercent} collected={collectedToday} total={totals.totalHouses}/>
                        </div>
                    </article>
                    <article aria-labelledby="live-pattern-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <h2 id="live-pattern-heading" className="section-heading font-semibold text-slate-900"><SectionIcon icon={PieChart} tone="violet"/>Collection Pattern Today</h2>
                                <p className="mt-1 text-sm text-slate-500">Who scanned each house today. Select a category to see the list.</p>
                            </div>
                            <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold tabular-nums text-slate-700">
                                {totals.totalHouses.toLocaleString()} houses
                            </p>
                        </div>
                        <div className="mt-5 flex h-5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                            {pattern.map((item) => (
                                <span key={item.key} className="h-full" style={{width: `${item.percent}%`, backgroundColor: item.color}}/>
                            ))}
                        </div>
                        <div className="mt-5 grid gap-1 sm:grid-cols-2">
                            {pattern.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    disabled={!item.count}
                                    onClick={() => openCategory(item)}
                                    title={CATEGORY_DESCRIPTIONS[item.key]}
                                    className="flex min-w-0 items-start gap-2 rounded-md p-2 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 disabled:cursor-default disabled:hover:bg-transparent"
                                >
                                    <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm" style={{backgroundColor: item.color}}/>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium text-slate-700">{item.label}</span>
                                        <span className="block text-xs tabular-nums text-slate-500">
                                            {item.count.toLocaleString()} houses · {item.percent.toFixed(1)}%
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </article>
                </section>
                )}

                <section aria-labelledby="ulb-activity-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5">
                        <div>
                            <h2 id="ulb-activity-heading" className="section-heading font-semibold text-slate-900"><SectionIcon icon={Building2} tone="blue"/>ULB Activity Today</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Active means at least one employee has GPS route points today and house records in the report. Houses and scans appear once a ULB is fully checked.
                            </p>
                        </div>
                        <label className="relative w-full sm:w-64">
                            <span className="sr-only">Search ULBs</span>
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true"/>
                            <input
                                type="search"
                                value={ulbQuery}
                                onChange={(event) => setUlbQuery(event.target.value)}
                                placeholder="Search ULBs"
                                style={{paddingLeft: "2.25rem"}}
                                className="ui-control w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 text-sm"
                            />
                        </label>
                    </div>
                    <div className="max-h-[34rem] overflow-auto">
                        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th scope="col" className="px-4 py-3 font-semibold">ULB</th>
                                    <th scope="col" className="px-4 py-3 font-semibold">Employees</th>
                                    <th scope="col" className="px-4 py-3 font-semibold">Active today</th>
                                    <th scope="col" className="px-4 py-3 font-semibold">Houses</th>
                                    <th scope="col" className="px-4 py-3 font-semibold">Scanned today</th>
                                    <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {ulbRows.map((ulb) => (
                                    <tr key={ulb.id}>
                                        <th scope="row" className="px-4 py-3 font-medium text-slate-800">
                                            <span className="person-cell"><Avatar name={ulb.name}/>{ulb.name}</span>
                                        </th>
                                        <td className="px-4 py-3 tabular-nums text-slate-600">{ulb.employees.toLocaleString()}</td>
                                        <td className="px-4 py-3 tabular-nums text-slate-600">{ulb.activeEmployees.toLocaleString()}</td>
                                        <td className="px-4 py-3 tabular-nums text-slate-600">{ulb.checking ? "—" : ulb.totalHouses.toLocaleString()}</td>
                                        <td className="px-4 py-3 tabular-nums text-slate-600">
                                            {ulb.checking ? "—" : ulb.collected.toLocaleString()}
                                            {!ulb.checking && ulb.coverage != null && <span className="ml-1 text-xs text-slate-400">({ulb.coverage.toFixed(1)}%)</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(ulb.status)}`}>
                                                {ulb.status}
                                            </span>
                                            {ulb.checking && ulb.beatEmployees > 0 && (
                                                <span className="ml-2 text-xs text-slate-500">
                                                    {ulb.checkedReports.toLocaleString()} of {ulb.beatEmployees.toLocaleString()} checked
                                                </span>
                                            )}
                                            {ulb.failedReports > 0 && (
                                                <span className="ml-2 text-xs text-amber-800">
                                                    {ulb.failedReports} report{ulb.failedReports === 1 ? "" : "s"} failed
                                                </span>
                                            )}
                                            {ulb.listError && <span className="ml-2 text-xs text-amber-800">Employee list failed</span>}
                                        </td>
                                    </tr>
                                ))}
                                {!ulbRows.length && (
                                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">No ULBs match this search.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
                <p className="text-xs text-slate-500">
                    Collection categories use scans recorded today ({snapshot.liveDate}, IST) only. Outside-Beat means the scanner is assigned to another Beat in the same ULB.
                </p>
            </div>
            <LiveListDialog request={listRequest} onClose={() => setListRequest(null)}/>
        </div>
    );
}
