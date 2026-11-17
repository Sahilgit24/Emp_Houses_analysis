"use client";
import "@/App.css";
import BeatHouseRoutePlanner from "./Component/Map/BeatHouseRoutePlanner";
import EmployeeApiDashboard from "./Component/EmployeeApiDashboard";
import {useMemo, useState} from "react";
import {combineNormalizedBeatData, normalizeBeatApiPayload} from "./data/beatApiData.js";

const LIVE_DATE = "live";

export default function App() {
    const [activePlanner, setActivePlanner] = useState("route");
    const [beatData, setBeatData] = useState(null);
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

    return (
        <div className="app-shell flex h-screen min-h-0 flex-col">
            <header className="app-header shrink-0">
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
                        onClick={() => setActivePlanner("route")}
                        className={`app-tab ${activePlanner === "route" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "route" ? "page" : undefined}
                    >
                        Route Optimization
                    </button>
                    <button
                        type="button"
                        onClick={() => setActivePlanner("analytics")}
                        className={`app-tab ${activePlanner === "analytics" ? "app-tab-active" : ""}`}
                        aria-current={activePlanner === "analytics" ? "page" : undefined}
                    >
                        Employee Analysis
                    </button>
                </nav>
            </header>
            <section className="upload-bar shrink-0">
                <div className="upload-bar-main">
                    <div className="upload-intro">
                        <span className="upload-icon" aria-hidden="true">↑</span>
                        <div>
                            <p className="upload-title">Beat API data</p>
                            <p className="upload-caption">JSON or TXT · Data stays in this session</p>
                        </div>
                    </div>
                    <label className="upload-input-wrap">
                        <span className="sr-only">Upload Beat API files (.json / .txt)</span>
                    <input
                        type="file"
                        accept=".json,.txt,application/json,text/plain"
                        multiple
                        onChange={handleApiFiles}
                        disabled={loadingFile}
                        className="upload-input"
                    />
                    </label>
                    {loadingFile && <p role="status" className="upload-status">Reading and analyzing files…</p>}
                </div>
                <div className="upload-bar-meta">
                {beatData && !loadingFile && (
                    <div className="loaded-data-row">
                        <span className="loaded-data-pill" role="status">
                            Loaded {beatData.beats.length} Beat(s) · {beatData.beats.reduce((total, beat) => total + beat.totalHouses, 0).toLocaleString()} houses
                            · {loadedSources.length} file(s)
                        </span>
                        <details className="uploaded-files text-xs">
                            <summary className="cursor-pointer">Uploaded filenames</summary>
                            <ul className="mt-1 list-inside list-disc">
                                {loadedSources.map((source, index) => <li key={`${source.fileName}-${index}`}>{source.fileName}</li>)}
                            </ul>
                        </details>
                        <button
                            type="button"
                            onClick={() => {
                                setBeatData(null);
                                setLoadedSources([]);
                                setUploadError("");
                                setHighPriorityHouseRequest(null);
                                setDateSelection(LIVE_DATE);
                            }}
                            className="clear-data-button"
                        >
                            Clear data
                        </button>
                    </div>
                )}
                {!beatData && !loadingFile && (
                    <p className="upload-hint">Select multiple files, or add files later. Beat IDs must be unique across uploads.</p>
                )}
                {uploadError && (
                    <p role="alert" className="upload-error w-full rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
                        {uploadError}
                    </p>
                )}
                </div>
            </section>
            <main className="min-h-0 flex-1">
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
                        beatData={beatData}
                        onShowHighPriorityHouses={handleShowHighPriorityHouses}
                        dateSelection={dateSelection}
                        availableDates={availableDates}
                        onDateSelectionChange={setDateSelection}
                    />
                </div>
            </main>
        </div>
    );
}
