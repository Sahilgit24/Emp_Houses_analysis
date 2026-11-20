"use client";
import "@/App.css";
import BeatHouseRoutePlanner from "./Component/Map/BeatHouseRoutePlanner";
import EmployeeApiDashboard from "./Component/EmployeeApiDashboard";
import EmployeeAlerts from "./Component/EmployeeAlerts.jsx";
import ExecutiveOverview from "./Component/ExecutiveOverview";
import {useMemo, useState} from "react";
import {combineNormalizedBeatData, normalizeBeatApiPayload} from "./data/beatApiData.js";
import {normalizeEmployeeList, normalizeUlbList} from "./data/executiveLocations.js";

const LIVE_DATE = "live";

export default function App() {
    const [activePlanner, setActivePlanner] = useState("overview");
    const [beatData, setBeatData] = useState(null);
    const [ulbs, setUlbs] = useState([]);
    const [selectedUlbId, setSelectedUlbId] = useState("");
    const [overviewUlbId, setOverviewUlbId] = useState("all");
    const [ulbFileName, setUlbFileName] = useState("");
    const [employeeListsByUlb, setEmployeeListsByUlb] = useState({});
    const [dateSelection, setDateSelection] = useState(LIVE_DATE);
    const [loadedSources, setLoadedSources] = useState([]);
    const [uploadError, setUploadError] = useState("");
    const [loadingFile, setLoadingFile] = useState(false);
    const [highPriorityHouseRequest, setHighPriorityHouseRequest] = useState(null);
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
    const selectedUlbBeatData = useMemo(() => {
        if (!selectedUlbId) return null;
        const sources = loadedSources.filter((source) => source.ulbId === selectedUlbId);
        if (!sources.length) return null;
        return {
            beats: sources.flatMap((source) => source.data.beats),
            raw: sources.map((source) => source.data.raw),
            sourceName: sources.map((source) => source.fileName).join(", "),
        };
    }, [loadedSources, selectedUlbId]);
    const selectedUlbEmployeeList = selectedUlbId
        ? employeeListsByUlb[selectedUlbId] || null
        : null;

    const handleShowHighPriorityHouses = (request) => {
        setHighPriorityHouseRequest(request);
        setActivePlanner("route");
    };

    const handleApiFiles = async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        setLoadingFile(true);
        setUploadError("");
        try {
            const incomingSources = await Promise.all(files.map(async (file) => {
                try {
                    const payload = JSON.parse(await file.text());
                    const normalized = normalizeBeatApiPayload(payload);
                    return {
                        fileName: file.name,
                        ulbId: selectedUlbId,
                        data: {...normalized, sourceName: file.name},
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Could not read the API data file.";
                    throw new Error(`${file.name}: ${message}`);
                }
            }));
            const nextSources = [...loadedSources, ...incomingSources];
            const combined = combineNormalizedBeatData(nextSources.map((source) => source.data));
            setLoadedSources(nextSources);
            setBeatData(combined);
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "Could not read the API data file.");
        } finally {
            setLoadingFile(false);
            event.target.value = "";
        }
    };

    const handleUlbFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setLoadingFile(true);
        setUploadError("");
        try {
            const ulbFile = normalizeUlbList(JSON.parse(await file.text()));
            setUlbs(ulbFile);
            setUlbFileName(file.name);
            setSelectedUlbId((current) =>
                ulbFile.some((ulb) => ulb.id === current) ? current : ""
            );
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "Could not read the ULB list file.");
        } finally {
            setLoadingFile(false);
            event.target.value = "";
        }
    };

    const handleEmployeeListFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!selectedUlbId) {
            setUploadError("Select a ULB before uploading its employee list.");
            event.target.value = "";
            return;
        }
        setLoadingFile(true);
        setUploadError("");
        try {
            const employees = normalizeEmployeeList(JSON.parse(await file.text()));
            setEmployeeListsByUlb((current) => ({
                ...current,
                [selectedUlbId]: {fileName: file.name, employees},
            }));
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "Could not read the employee list file.");
        } finally {
            setLoadingFile(false);
            event.target.value = "";
        }
    };

    return (
        <div className="app-shell flex h-screen min-h-0 flex-row">
            <aside className="app-sidebar shrink-0">
                <div className="app-brand">
                    <div className="app-brand-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M4.5 18.5 9 13l3 2.5 7.5-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="4.5" cy="18.5" r="1.5" fill="currentColor" />
                            <circle cx="19.5" cy="6.5" r="1.5" fill="currentColor" />
                        </svg>
                    </div>
                    <div>
                        <p className="app-brand-title">Beat Operations</p>
                        <p className="app-brand-subtitle">Route planning & collection insights</p>
                    </div>
                </div>
                <nav className="app-tabs" aria-label="Workspace sections">
                    <button
                        type="button"
                        onClick={() => setActivePlanner("overview")}
                        className={`app-tab ${activePlanner === "overview" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "overview" ? "page" : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">▦</span>
                        <span>Executive Overview</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("route")}
                        className={`app-tab ${activePlanner === "route" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "route" ? "page" : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">⌖</span>
                        <span>Beat/Route Enhancement</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("analytics")}
                        className={`app-tab ${activePlanner === "analytics" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "analytics" ? "page" : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">◷</span>
                        <span>Employee Analysis</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("alerts")}
                        className={`app-tab ${activePlanner === "alerts" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "alerts" ? "page" : undefined}
                    >
                        <span className="app-tab-icon" aria-hidden="true">!</span>
                        <span>Employee Alert</span>
                    </button>
                </nav>
                <div className="app-sidebar-footer">
                    <span className="app-sidebar-footer-dot" aria-hidden="true"/>
                    Beat Operations
                </div>
            </aside>
            <div className="app-workspace flex min-h-0 min-w-0 flex-1 flex-col">
                <section className="upload-bar shrink-0">
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                        <div className="upload-intro">
                            <span className="upload-icon" aria-hidden="true">↑</span>
                            <div>
                                <p className="upload-title">Data files</p>
                                <p className="upload-caption">Upload the ULB list, then its employee list and Beat/API files</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <label className="upload-input-wrap">
                                <span className="mb-1 block text-xs font-semibold text-slate-600">ULB list</span>
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={handleUlbFile}
                                    disabled={loadingFile}
                                    className="upload-input"
                                />
                            </label>
                            <label className="upload-input-wrap">
                                <span className="mb-1 block text-xs font-semibold text-slate-600">Employee list for selected ULB</span>
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={handleEmployeeListFile}
                                    disabled={loadingFile || !selectedUlbId}
                                    className="upload-input"
                                />
                            </label>
                            <label className="upload-input-wrap">
                                <span className="mb-1 block text-xs font-semibold text-slate-600">Employee Beat/API files for selected ULB</span>
                                <input
                                    type="file"
                                    accept=".json,.txt,application/json,text/plain"
                                    multiple
                                    onChange={handleApiFiles}
                                    disabled={loadingFile || !selectedUlbId}
                                    className="upload-input"
                                />
                            </label>
                            <span className="pb-1 text-xs text-slate-500">
                                Assigning uploads to: {ulbs.find((ulb) => ulb.id === selectedUlbId)?.name || "select a ULB in the overview or Employee Analysis"}
                            </span>
                            {loadingFile && <p role="status" className="upload-status">Reading files…</p>}
                        </div>
                    </div>
                    <div className="upload-bar-meta">
                        {(beatData || ulbFileName || Object.keys(employeeListsByUlb).length > 0) && !loadingFile && (
                            <div className="loaded-data-row">
                                {beatData && (
                                    <span className="loaded-data-pill" role="status">
                                        Loaded {beatData.beats.length} Beat(s) · {beatData.beats.reduce((total, beat) => total + beat.totalHouses, 0).toLocaleString()} houses
                                        · {loadedSources.length} file(s)
                                    </span>
                                )}
                                {loadedSources.length > 0 && (
                                    <details className="uploaded-files text-xs">
                                        <summary className="cursor-pointer">Beat/API filenames</summary>
                                        <ul className="mt-1 list-inside list-disc">
                                            {loadedSources.map((source, index) => <li key={`${source.fileName}-${index}`}>{source.fileName}</li>)}
                                        </ul>
                                    </details>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBeatData(null);
                                        setLoadedSources([]);
                                        setUlbs([]);
                                        setSelectedUlbId("");
                                        setUlbFileName("");
                                        setEmployeeListsByUlb({});
                                        setUploadError("");
                                        setHighPriorityHouseRequest(null);
                                        setDateSelection(LIVE_DATE);
                                    }}
                                    className="clear-data-button"
                                >
                                    Clear all uploads
                                </button>
                            </div>
                        )}
                        {(ulbFileName || Object.keys(employeeListsByUlb).length > 0) && (
                            <div className="text-right text-xs text-slate-500">
                                {ulbFileName && <p>ULB list: {ulbFileName}</p>}
                                {Object.entries(employeeListsByUlb).map(([ulbId, employeeList]) => (
                                    <p key={ulbId}>
                                        {employeeList.fileName} · {ulbs.find((ulb) => ulb.id === ulbId)?.name || ulbId} · {employeeList.employees.length} employees
                                    </p>
                                ))}
                            </div>
                        )}
                        {uploadError && (
                            <p role="alert" className="upload-error w-full rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
                                {uploadError}
                            </p>
                        )}
                    </div>
                </section>
                <main className="min-h-0 flex-1">
                    <div className={`h-full ${activePlanner === "overview" ? "" : "hidden"}`}>
                        <ExecutiveOverview
                            ulbs={ulbs}
                            selectedUlbId={overviewUlbId}
                            onSelectedUlbIdChange={setOverviewUlbId}
                            sources={loadedSources}
                            employeeListsByUlb={employeeListsByUlb}
                        />
                    </div>
                    <div className={`h-full ${activePlanner === "route" ? "" : "hidden"}`}>
                        <BeatHouseRoutePlanner
                            visible={activePlanner === "route"}
                            beatData={beatData}
                            highPriorityHouseRequest={highPriorityHouseRequest}
                            dateSelection={dateSelection}
                            availableDates={availableDates}
                            onDateSelectionChange={setDateSelection}
                        />
                    </div>
                    <div className={`h-full ${activePlanner === "analytics" ? "" : "hidden"}`}>
                        <EmployeeApiDashboard
                            beatData={selectedUlbBeatData}
                            employeeList={selectedUlbEmployeeList}
                            ulbs={ulbs}
                            selectedUlbId={selectedUlbId}
                            onSelectedUlbIdChange={setSelectedUlbId}
                            onShowHighPriorityHouses={handleShowHighPriorityHouses}
                            dateSelection={dateSelection}
                            availableDates={[]}
                            onDateSelectionChange={setDateSelection}
                        />
                    </div>
                    <div className={`h-full ${activePlanner === "alerts" ? "" : "hidden"}`}>
                        <EmployeeAlerts
                            sources={loadedSources}
                            ulbs={ulbs}
                            employeeListsByUlb={employeeListsByUlb}
                            availableDates={availableDates}
                        />
                    </div>
                </main>
            </div>
        </div>
    );
}
