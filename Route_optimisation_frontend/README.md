# Beat Route Planner

The frontend loads operational data from the Weight Collection APIs. The shared Filters bar above the tabs contains the State, ULB, date, and date-range controls. Select one ULB to load its employee list and every employee's Beat report for Executive Overview, Route Optimization, Employee Analysis, and Employee Alerts.

## Routing services

By default, the backend uses the public OSRM demo and routing.openstreetmap.de as a fallback. House and vehicle coordinates are sent to the configured routing service. To keep routing local, explicitly set `OSRM_BASE_URL=http://127.0.0.1:5000` and start the self-hosted OSRM service described below. OSM road extracts can differ from the basemap, so a road shown on the map is not guaranteed to be routable. OSRM geometry uses `[longitude, latitude]` in the API and is converted to Leaflet's `[latitude, longitude]` order.

The Beat House Route Planner uses OSRM and OpenStreetMap driving data; mapped residential and service roads are routable when present in the selected OSM extract. The public services are best-effort and may throttle or reject large route-matrix requests.

On Windows with Docker Desktop, prepare and start the local router with:

```powershell
cd D:\Agent\project_trajectory-main\Route_optimisation_backend\osrm
.\setup-osrm.ps1
```

The script downloads Geofabrik's Central Zone OSM extract (about 335 MB), prepares the OSRM road graph, starts the router container at `http://127.0.0.1:5000`, and checks that it is responding. This extract covers Nagpur and nearby central India. OSRM preprocessing may take several minutes and needs several GB of free disk space and memory. Keep Docker Desktop running while using the self-hosted router. The data files are kept in `Route_optimisation_backend\osrm\data` and are excluded from source control. OSM data is © OpenStreetMap contributors and is available under the ODbL. To stop the service, run `docker compose -f D:\Agent\project_trajectory-main\Route_optimisation_backend\osrm\docker-compose.yml down`.

To use the prepared local server instead of the public default, set `$env:OSRM_BASE_URL = "http://127.0.0.1:5000"` in the same PowerShell terminal before starting Flask. To explicitly use another OSRM-compatible service, set `OSRM_BASE_URL` to its base URL. To add a Valhalla comparison, explicitly set `VALHALLA_BASE_URL` to a reachable Valhalla-compatible service. Remote routing services receive the GPS/house coordinates used in their requests.

## Weight Collection APIs

The shared Filters bar loads the ULB list from `Get/AllULBListForWeightCollection`. After one ULB is selected, the app requests `Get/GetActiveBeatUsers` with the selected `AppId`, then requests `Get/BeatWiseHouseScanningCompleteReport` for every user in `AllUsers`, using both `AppId` and `userId` request headers. Report requests run with bounded concurrency. The filter bar shows loading progress, and individual failed reports are listed with an option to retry by refreshing the data. A failed report does not remove that employee from the employee list.

Selecting **All ULBs** reads a live-date snapshot from the backend (`/live/all-ulbs/*`) instead of downloading every employee report in the browser. The report API always returns 30 days per employee (about 6 MB, mostly GPS points), does not compress responses, and ignores date parameters, so the backend loader (`Route_optimisation_backend/live_all_ulb.py`) downloads every report on the server in the background, keeps only today's data (IST), and stores a compact snapshot in `data/live_all_ulb.sqlite3`. It is switched off by default, because a full pass takes hours at the report API's current speed; set `LIVE_ALL_ULB_ENABLED=1` on the backend to turn it on. When on, it starts with the server, downloads only employees listed in `AllBeats` (others have no house records), checks every ULB's likely-active employees first so ULB status appears early, refreshes every 30 minutes (`LIVE_ALL_ULB_REFRESH_MINUTES`), uses 24 parallel report requests (`LIVE_ALL_ULB_REPORT_WORKERS`), and keeps serving the previous snapshot while a new one is built; on a new day the first snapshot fills in ULB by ULB. Executive Overview shows today's employee activity, ULB status, coverage, and collection pattern (inside / outside / other / not scanned today, using scans made today only). House and employee lists open from the server page by page; "Not scanned today" is listed per Beat. **Refresh live data** asks the server to start a new refresh. Historical dates, ranges, and the other tabs are unavailable in this mode. For a selected ULB, the date dropdown, calendar, and date range remain shared across tabs. An applied date range drives Overview's daily average, limits Employee Analysis and Employee Alerts to the range, and displays the route map for the range's end date.

The app normalizes each report's `BeatWiseReport` and `RouteDetails` into the data shared by the tabs. Employee house counts and collection history use `BeatWiseReport` house fields, including `ScanningDates` and `ScanningDate`; `RouteDetails.Collectionlist` is not used for employee house counts or history. For route planning and GPS-based daily attendance, the corresponding `RouteDetails` should include a geofence, house coordinates, and dated routes with GPS points in `emproute`.

For one selected ULB, the **Live date** option follows the latest available report date; choosing a historical date applies it in the tabs that support date filtering. In All-ULB mode, live date means the current date in `Asia/Kolkata` and no historical dates are available. An employee is active for a date when their report has GPS route points for that date and house records. Employee Analysis uses the selected date as the end of its existing rolling reporting window, while Route Optimization shows that day's route. “Collected by assigned employee,” “collected by other employee,” and “remaining / no collection recorded” are kept distinct. Missing scan records do not prove a house was missed. Employee house history uses valid `ScanningDates` and `ScanningDate` values from `BeatWiseReport`.

## Beat House Route Planner

The **Route Optimization** tab compares the assigned employee's selected-day GPS route with a proposed route for houses without a recorded collection scan. Only report houses linked to `RouteDetails.houses`, inside the Beat geofence, and within the configurable corridor of that day's GPS track are eligible; the optimizer may skip eligible houses. Green house fill means the report says collected by the assigned employee, amber means collected by another employee, and red means no collection was recorded. A cyan outline marks a house matched to a scan on the selected date; a blue outline is a planned stop, not proof of collection. Click a house for its HouseId, scanner, scan date, and route status. The dashed employee-colored line is the recorded GPS route.

The **Beat/Route Enhancement** tab uses one **Beat / Employee** selector. It lists Beats with their assigned employee and marks employees active today when their report contains house records and GPS route points for the current date.

**Rebuild Beat Geofence** creates a preview from every house in the selected Beat with recorded collection history, regardless of scanner, and clips it to neighboring Beat fences so overlapping areas are removed and shared edges align. The preview reports the percentage of mappable historical house locations inside the candidate; this is point coverage, not a measure of source coordinate accuracy. Keeping the preview is disabled if clipping excludes any mappable historical house or produces unsupported geometry; the existing fence remains in place. Kept overrides apply only for the current browser session and are not written back to API data.

The map uses the selected date's GPS points for the actual route and optimization endpoints. Changing the date clears old route results. Actual GPS and optimized routes can be replayed independently; planned stops remain distinct from collection records. Dumpyards are map markers, not route stops.

Only eligible remaining houses within the configurable corridor of the selected day's timestamped GPS track are supplied to the optimizer; houses outside that corridor are excluded. Orange map markers identify route candidates. The corridor is measured against the raw GPS trace and does not prove a house was visited or collected. The selected day's earliest and latest GPS coordinates are fixed route endpoints. Its road-matched distance is a hard upper bound, reduced by 0.01 km so the displayed recommendation must be strictly shorter than the actual route; equal or longer candidates are discarded. The backend requests an OSRM distance-and-duration matrix and uses Google OR-Tools guided local search to prioritize houses planned, then road distance, estimated drive time, and repeated road distance. Up to four route candidates are compared. Without accurate per-house service duration or live traffic, the estimate is driving time only and does not enforce a shift-time limit.

The default uses the public OSRM services described above; configure `OSRM_BASE_URL` to use the local Docker instance. A matrix for hundreds of houses can take time or be throttled. OR-Tools uses a bounded heuristic search and does not prove the global optimum. The map shows the optimized road route separately from the historical vehicle trip. Actual and optimized road geometries are sampled at 25 m intervals against the Beat polygon; detected outside sections are highlighted and their approximate distance is reported. Detected outside sections require review; they are not claimed to be authorized access connections. Vehicle capacity, shift-time, and multi-dump-trip constraints are not enforced without validated inputs.

## Employee Performance Analysis

This tab reads the selected ULB's API reports, as does the route planner. The employee selector defaults to **All employees** whenever the tab is opened; its green dot identifies employees with GPS points and house records on the shared selected date. The all-employee view lists daily activity and report status, while selecting one employee opens their detailed analysis. Its summary covers GPS distance, observed GPS time span, matched unique-house visits, dump weight, and overall Beat collection, followed by assigned-employee, other-employee, and no-record counts; daily route/GPS activity; and house collection history with recorded intervals and attention labels. Daily Attendance & Collection compares the selected date with the immediately previous calendar day. Under the configured attendance rule, a day with no GPS points is shown as Absent; its recorded scan count is still shown for review. House Attention Queue distinguishes houses with no ScanningDates in the available BeatWiseReport history from houses that have a recorded scan but are due (current gap above 1.5 times their typical interval); a gap above 2.5 times the typical interval is high priority. No scan in the available report does not prove a house was never cleaned. GPS distance is a straight-line estimate, and GPS time is the first-to-last timestamp span rather than active or paid work time. Dump weights are reported in kg only when positive values have a recognized kg/tonnes unit; zero or unitless values are unavailable. Coverage Trend compares equal-length adjacent windows and shows insufficient data when verified collection records are unavailable in either window. Search and filters operate on the selected Beat. A missing collection record is not proof of a missed visit, and a route stop is not proof of collection.

## Separate backend analytics API

The Flask endpoints `/analytics/dashboard` and `/analytics/import` remain available to direct clients. The `/analytics/employee-anomalies` endpoint calculates anomaly facts from daily and house-pattern summaries for direct clients; the frontend no longer calls it, and it does not read or write the analytics database. Imported records are merged/upserted into SQLite at `Route_optimisation_backend\data\operational_analytics.sqlite3`; there is no live operational database connection. Set `ANALYTICS_DB_PATH` to select another file and back it up with the operational source data. No sample records are seeded.

The import endpoint accepts a JSON object with any of these arrays:

```json
{
  "beats": [
    {
      "beat_id": "source-beat-id",
      "beat_name": "Source beat name",
      "state": "source state",
      "municipal_corporation": "source corporation",
      "zone": "source zone",
      "ward": "source ward",
      "geofence": "lat,lon;lat,lon;lat,lon"
    }
  ],
  "houses": [
    {"beat_id": "source-beat-id", "house_id": "source-house-id", "lat": 20.0, "lon": 78.0}
  ],
  "vehicles": [
    {"vehicle_id": "source-vehicle-id", "vehicle_name": "source name", "capacity_kg": 5000}
  ],
  "collection_records": [
    {
      "date": "2026-10-28",
      "beat_id": "source-beat-id",
      "house_id": "source-house-id",
      "vehicle_id": "source-vehicle-id",
      "trip_id": "source-trip-id",
      "covered": true
    }
  ],
  "gps_points": [
    {
      "vehicle_id": "source-vehicle-id",
      "beat_id": "source-beat-id",
      "trip_id": "source-trip-id",
      "timestamp": "2026-10-28T08:00:00",
      "lat": 20.0,
      "lon": 78.0
    }
  ],
  "dumping_weights": [
    {
      "record_id": "source-weighment-id",
      "date": "2026-10-28",
      "vehicle_id": "source-vehicle-id",
      "beat_id": "source-beat-id",
      "trip_id": "source-trip-id",
      "weight": 1250,
      "unit": "kg",
      "wet_weight": 700,
      "dry_weight": 550,
      "allocation_method": "unknown"
    }
  ]
}
```

For direct API imports, supply the relevant operational arrays in one JSON payload; the employee ID, when needed, is represented by the backend analytics grouping fields. This import workflow is separate from the shared Beat API file used by the frontend.

The Analytics import also accepts the combined route-planner file directly (`.json` or `.txt` containing JSON) with root `geofence`, `houses`, and `routes`. GPS points are imported, and `Collectionlist` entries are saved as collection records. For this dataset, each collection-list `referanceId`/`referenceId` is the House ID, as confirmed by the operator. Unique reference IDs therefore count as houses recorded visited (once per day); repeated scans of one ID on the same day do not increase the house count. GPS movement alone is not counted as a visit. Combined-file house coordinates are linked to House IDs only when the house object contains an explicit ID and that ID maps consistently to one coordinate; ambiguous IDs are left unlinked. Re-import combined files after upgrading to establish these links for previously imported data. Combined-file `dumplist` events are counted as recorded dump trips. Their source total/wet/dry values are only used as measured weights when they are positive and an explicit recognized unit is supplied; zero or unitless values remain unavailable. This direct import does not infer capacity or an approved employee-to-area assignment.

For explicit collection records, provide a house master with stable IDs and dated records with `covered: true/false`. For the combined route export, the collection-list reference field is treated as the House ID according to the confirmed source format. Employee-specific GPS files containing only `date` and `emproute` can be selected with other employee files; assign each file its employee ID in the import form. Dumping weights require a vehicle, date, positive numeric total weight and `kg` or `tonnes`; `wet_weight` and `dry_weight` are optional recorded component weights (with optional `wet_unit`/`dry_unit`, otherwise they use `unit`). When both positive components are present and total weight is omitted, total is their sum. Missing or zero weights remain unavailable. Stable `record_id` values are recommended for repeat imports. `vehicles.capacity_kg` is optional and must be an actual recorded capacity.

Weight is stored in kilograms. A weighment is not assigned to a beat just because a vehicle served that beat. For a trip that spans multiple beats, set `allocation_method` to `trip_total` only when the weight is the total load for that identified trip; it is then apportioned by that trip's distinct covered-house counts and labeled estimated. Use `beat_direct` only for an explicitly measured/allocated beat weight. Ambiguous records remain visible in vehicle/overall totals and are reported as unallocated instead of being guessed into beat totals. Weight per covered house is disposal weight divided by recorded covered houses; it is not household waste generation.

Linked operational-bundle imports can additionally use beat coverage tables, explicit missed-house records, and weight-allocation summaries. GPS distance is point-to-point, not road-matched; GPS-observed time is not an engine-on measurement.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
