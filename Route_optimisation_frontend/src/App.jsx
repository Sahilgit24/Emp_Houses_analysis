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
        <div className="flex h-screen min-h-0 flex-col">
            <nav className="flex shrink-0 flex-nowrap gap-2 overflow-x-auto border-b bg-white px-4 py-2">
                <button
                    type="button"
                    onClick={() => setActivePlanner("route")}
                    className={`shrink-0 rounded px-4 py-2 text-sm font-medium ${activePlanner === "route" ? "bg-blue-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                >
                    Route Optimization
                </button>
                <button
                    type="button"
                    onClick={() => setActivePlanner("analytics")}
                    className={`shrink-0 rounded px-4 py-2 text-sm font-medium ${activePlanner === "analytics" ? "bg-blue-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                >
                    Employee Performance Analysis
                </button>
            </nav>
            <section className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-slate-50 px-4 py-3">
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                    Upload Beat API files (.json / .txt)
                    <input
                        type="file"
                        accept=".json,.txt,application/json,text/plain"
                        multiple
                        onChange={handleApiFiles}
                        disabled={loadingFile}
                        className="max-w-sm rounded border border-slate-300 bg-white p-2 text-sm"
                    />
                </label>
                {!loadingFile && (
                    <p className="text-xs text-slate-500">
                        Select multiple files at once or add more later. Beat IDs must be unique across the uploaded files.
                    </p>
                )}
                {loadingFile && <p role="status" className="text-sm text-slate-600">Reading and analyzing files…</p>}
                {beatData && !loadingFile && (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span role="status">
                            Loaded {beatData.beats.length} Beat(s) · {beatData.beats.reduce((total, beat) => total + beat.totalHouses, 0).toLocaleString()} houses
                            · {loadedSources.length} file(s)
                        </span>
                        <details className="text-xs">
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
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                            Clear data
                        </button>
                    </div>
                )}
                {!beatData && !loadingFile && (
                    <p className="text-sm text-slate-500">Upload one or more Beat API files to use the combined data in both tabs.</p>
                )}
                {uploadError && (
                    <p role="alert" className="w-full rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
                        {uploadError}
                    </p>
                )}
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
