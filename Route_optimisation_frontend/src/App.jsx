import {lazy, Suspense, useState} from "react";
import ErrorBoundary from "./Component/common/ErrorBoundary.jsx";
import TabSkeleton from "./Component/common/TabSkeleton.jsx";
import FilterBar from "./Component/layout/FilterBar.jsx";
import Sidebar from "./Component/layout/Sidebar.jsx";
import {NAV_ITEMS} from "./Component/layout/navItems.js";
import {ALL_ULBS, useWeightCollectionData} from "./hooks/useWeightCollectionData.js";

// Each tab's code is downloaded the first time the tab is opened.
const ExecutiveOverview = lazy(() => import("./Component/ExecutiveOverview"));
const AllUlbLiveOverview = lazy(() => import("./Component/AllUlbLiveOverview.jsx"));
const BeatHouseRoutePlanner = lazy(() => import("./Component/Map/BeatHouseRoutePlanner"));
const EmployeeApiDashboard = lazy(() => import("./Component/EmployeeApiDashboard"));
const EmployeeAlerts = lazy(() => import("./Component/EmployeeAlerts.jsx"));

export default function App() {
    const [activePlanner, setActivePlanner] = useState("overview");
    // Tabs stay mounted after their first visit so their selections are kept when switching back.
    const [visitedTabs, setVisitedTabs] = useState(() => new Set(["overview"]));
    const data = useWeightCollectionData();
    const {
        beatData,
        ulbs,
        selectedUlbId,
        employeeList,
        liveAllUlb,
        dateSelection,
        appliedRange,
        loadedSources,
        employeeListLoading,
        reportLoading,
        reportErrors,
        availableDates,
        employeeListsByUlb,
        loadedEmployeeIds,
        liveTodayDate,
    } = data;

    const selectTab = (tabId) => {
        setActivePlanner(tabId);
        setVisitedTabs((current) => current.has(tabId) ? current : new Set([...current, tabId]));
    };
    const tabLabel = (tabId) => NAV_ITEMS.find((item) => item.id === tabId)?.label || "This section";

    const renderTab = (tabId, content) => (
        <div className={`app-tab-panel h-full ${activePlanner === tabId ? "" : "hidden"}`}>
            {visitedTabs.has(tabId) && (
                <ErrorBoundary label={tabLabel(tabId)} resetKey={selectedUlbId}>
                    <Suspense fallback={<TabSkeleton label={tabLabel(tabId)}/>}>
                        {content}
                    </Suspense>
                </ErrorBoundary>
            )}
        </div>
    );

    return (
        <div className="app-shell flex h-screen min-h-0 flex-row">
            <Sidebar
                activePlanner={activePlanner}
                onSelect={selectTab}
                allUlbsSelected={selectedUlbId === ALL_ULBS}
            />
            <div className="app-workspace flex min-h-0 min-w-0 flex-1 flex-col">
                <FilterBar data={data} onSelectAllUlbs={() => selectTab("overview")}/>
                <main className="min-h-0 flex-1">
                    {renderTab("overview", selectedUlbId === ALL_ULBS ? (
                        <AllUlbLiveOverview live={liveAllUlb} liveDate={liveTodayDate}/>
                    ) : (
                        <ExecutiveOverview
                            ulbs={ulbs}
                            selectedUlbId={selectedUlbId}
                            sources={loadedSources}
                            employeeListsByUlb={employeeListsByUlb}
                            reportErrors={reportErrors}
                            isLoading={employeeListLoading || reportLoading}
                            dateSelection={dateSelection}
                            appliedRange={appliedRange}
                        />
                    ))}
                    {renderTab("route", (
                        <BeatHouseRoutePlanner
                            visible={activePlanner === "route"}
                            ulbId={selectedUlbId}
                            beatData={beatData}
                            employeeList={employeeList}
                            liveDate={liveTodayDate}
                            dateSelection={dateSelection}
                            availableDates={availableDates}
                            appliedRange={appliedRange}
                        />
                    ))}
                    {renderTab("analytics", (
                        <EmployeeApiDashboard
                            key={selectedUlbId || "no-ulb"}
                            beatData={beatData}
                            employeeList={employeeList}
                            dateSelection={dateSelection}
                            appliedRange={appliedRange}
                            availableDates={availableDates}
                            loadedEmployeeIds={loadedEmployeeIds}
                            isLoading={employeeListLoading || reportLoading}
                            isActive={activePlanner === "analytics"}
                        />
                    ))}
                    {renderTab("alerts", (
                        <EmployeeAlerts
                            sources={loadedSources}
                            ulbs={ulbs}
                            employeeListsByUlb={employeeListsByUlb}
                            availableDates={availableDates}
                            dateSelection={dateSelection}
                            appliedRange={appliedRange}
                        />
                    ))}
                </main>
            </div>
        </div>
    );
}
