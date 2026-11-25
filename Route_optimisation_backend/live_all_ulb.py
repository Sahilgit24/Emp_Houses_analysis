"""Background loader for the All-ULB live view.

The external report API always returns 30 days of data per employee (about 6 MB, mostly GPS
points) and ignores date parameters, so loading every report in the browser is far too slow.
This module downloads the reports on the server on a schedule, keeps only the live date (IST),
and stores a compact snapshot that the frontend reads in one small request.

Classification for the live date matches the Executive Overview rules, restricted to scans
made today:
  * inside  - today's scan was made by the employee assigned to the house's Beat
  * outside - today's scan was made by an employee assigned to another Beat in the same ULB
  * other   - today's scan was made by another / unidentified scanner
  * not_scanned_today - no scan on the live date
An employee is active when their Beat has house records and their route for today has GPS points.
"""

import json
import logging
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

API_ENDPOINTS = {
    "ulbs": "https://weight.ictsbm.com/api/Get/AllULBListForWeightCollection",
    "employees": "https://weight.ictsbm.com/api/Get/GetActiveBeatUsers",
    "report": "https://weight.ictsbm.com/api/Get/BeatWiseHouseScanningCompleteReport",
}
IST = timezone(timedelta(hours=5, minutes=30))
CATEGORIES = ("inside", "outside", "other", "not_scanned_today")
COLLECTED_CATEGORIES = ("inside", "outside", "other")


def _env_int(name, default, minimum=1):
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


REPORT_WORKERS = _env_int("LIVE_ALL_ULB_REPORT_WORKERS", 24)
EMPLOYEE_LIST_WORKERS = _env_int("LIVE_ALL_ULB_LIST_WORKERS", 8)
REFRESH_MINUTES = _env_int("LIVE_ALL_ULB_REFRESH_MINUTES", 30, minimum=5)
# The background download is switched off by default: a full pass over all ULBs takes hours at
# the external API's current speed. Set LIVE_ALL_ULB_ENABLED=1 to turn it on.
LOADER_ENABLED = os.environ.get("LIVE_ALL_ULB_ENABLED", "0") == "1"
# After a failed refresh, wait this long before trying again instead of retrying every 30 seconds.
RETRY_BACKOFF_SECONDS = _env_int("LIVE_ALL_ULB_RETRY_MINUTES", 10) * 60
# Only one server process refreshes at a time; its lease expires if it stops renewing it.
LEASE_SECONDS = 300
REQUEST_TIMEOUT = (15, 180)
REQUEST_RETRIES = 2


def live_date_ist(now=None):
    return (now or datetime.now(IST)).astimezone(IST).strftime("%Y-%m-%d")


def _now_iso():
    return datetime.now(IST).isoformat(timespec="seconds")


def _text(value):
    return "" if value is None else str(value).strip()


def _first(record, keys):
    for key in keys:
        if isinstance(record, dict) and record.get(key) is not None:
            return record[key]
    return None


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_DECODER = json.JSONDecoder()


def normalize_ulbs(payload):
    if not isinstance(payload, list) or not payload:
        raise ValueError("The ULB API response must contain a non-empty JSON array.")
    ulbs = {}
    for record in payload:
        ulb_id = _text((record or {}).get("appid"))
        name = _text((record or {}).get("ulb"))
        if ulb_id and name:
            ulbs[ulb_id] = {"id": ulb_id, "name": name}
    return sorted(ulbs.values(), key=lambda ulb: ulb["name"].lower())


def _user_ids(records):
    return {_text((record or {}).get("UserId")) for record in records if isinstance(record, dict)}


def normalize_employees(payload):
    """Employee list with two hints used to order and limit report downloads.

    has_beat: the employee appears in AllBeats. Only these employees' reports contain house
              records, so only they can be active (when AllBeats is missing, everyone is checked).
    priority: the employee appears in BothActiveUsers (user and Beat enabled); checked first.
    """
    payload = payload or {}
    records = payload.get("AllUsers") or payload.get("AllBeats")
    if not isinstance(records, list):
        raise ValueError("The employee list must contain an AllUsers or AllBeats array.")
    beat_ids = _user_ids(payload["AllBeats"]) if isinstance(payload.get("AllBeats"), list) else None
    priority_ids = _user_ids(payload.get("BothActiveUsers") or [])
    employees = {}
    for record in records:
        employee_id = _text((record or {}).get("UserId"))
        name = _text((record or {}).get("UserName"))
        if employee_id and name:
            employees[employee_id] = {
                "id": employee_id,
                "name": name,
                "has_beat": beat_ids is None or employee_id in beat_ids,
                "priority": employee_id in priority_ids,
            }
    return sorted(employees.values(), key=lambda employee: employee["name"].lower())


def report_order(employee_lists):
    """Beat employees to download, round-robin across ULBs with likely-active employees first.

    Every ULB gets its first reports early, so its Active status appears within minutes.
    """
    queues = []
    for ulb_id, employees in employee_lists.items():
        beat_employees = [employee for employee in employees if employee["has_beat"]]
        beat_employees.sort(key=lambda employee: not employee["priority"])
        if beat_employees:
            queues.append((ulb_id, beat_employees))
    order = []
    index = 0
    while queues:
        remaining = []
        for ulb_id, employees in queues:
            order.append((ulb_id, employees[index]))
            if index + 1 < len(employees):
                remaining.append((ulb_id, employees))
        queues = remaining
        index += 1
    return order


def _value_after_key(text, key, start=0):
    """Decodes the JSON value that follows "key": in text, without parsing anything else."""
    match = re.compile(r'"%s"\s*:\s*' % re.escape(key)).search(text, start)
    if not match:
        return None, -1
    value, end = _DECODER.raw_decode(text, match.end())
    return value, end


def _today_route_points(text, live_date):
    """Returns the number of GPS points in the route dated live_date, or None if it must be parsed fully."""
    route_start = text.find('"RouteDetails"')
    if route_start < 0:
        return 0
    section = text[route_start:]
    fast = list(re.finditer(r'\{\s*"date"\s*:\s*"%s' % re.escape(live_date), section))
    if fast:
        points = 0
        for match in fast:
            route, _ = _DECODER.raw_decode(section, match.start())
            track = _first(route, ["emproute", "EmpRoute", "track_points", "TrackPoints"]) or []
            points += len(track) if isinstance(track, list) else 0
        return points
    if re.search(r'"(?:date|Date)"\s*:\s*"%s' % re.escape(live_date), section):
        return None  # unusual field order: caller falls back to a full parse
    return 0


def _route_points_from_details(route_details, live_date):
    routes = _first(route_details or {}, ["routes", "Routes"]) or []
    points = 0
    for route in routes if isinstance(routes, list) else []:
        if _text(_first(route, ["date", "Date"]))[:10] == live_date:
            track = _first(route, ["emproute", "EmpRoute", "track_points", "TrackPoints"]) or []
            points += len(track) if isinstance(track, list) else 0
    return points


def _beat_from_report(report, employee, live_date, today_points):
    owner_id = _text(employee["id"])
    reported_name = _text(_first(report, ["BeatName", "BeatLabel", "beatName", "BeatCode", "BeatId", "BeatID"]))
    beat_id = _text(_first(report, ["BeatId", "BeatID", "beatId", "BeatCode"])) or f"beat-user:{owner_id}"
    houses = []
    seen = set()
    for key in ("ScannedHouses", "NotScannedHouses"):
        for record in report.get(key) or []:
            house_id = _text(_first(record, ["HouseId", "houseId", "house_id"]))
            if not house_id or house_id in seen:
                continue
            seen.add(house_id)
            values = list(record.get("ScanningDates") or record.get("scanningDates") or [])
            if record.get("ScanningDate") is not None:
                values.append(record.get("ScanningDate"))
            today_scans = sorted(_text(value) for value in values if _text(value)[:10] == live_date)
            houses.append((
                house_id,
                today_scans[-1] if today_scans else "",
                _text(_first(record, ["ScannerUserId", "scannerUserId"])),
                _text(_first(record, ["ScannerName", "scannerName"])),
            ))
    scanned_total = report.get("TotalScannedHouses")
    not_scanned_total = report.get("TotalNotScannedHouses")
    if scanned_total is not None or not_scanned_total is not None:
        has_house_records = (_safe_int(scanned_total) > 0) or (_safe_int(not_scanned_total) > 0)
    else:
        has_house_records = bool(houses)
    return {
        "beat_id": beat_id,
        "beat_name": reported_name or f"Beat assigned to {employee['name'] or owner_id}",
        "owner_id": owner_id,
        "has_house_records": has_house_records,
        "gps_points_today": today_points,
        "houses": houses,
    }


def _safe_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def parse_report_for_date(raw, employee, live_date):
    """Reduces one raw report (bytes or str) to the live date's beats and house scans."""
    text = raw.decode("utf-8-sig") if isinstance(raw, (bytes, bytearray)) else raw
    reports, _ = _value_after_key(text, "BeatWiseReport")
    if reports is None:
        reports, _ = _value_after_key(text, "beatWiseReport")
    if reports is None:
        raise ValueError("The report does not contain BeatWiseReport data.")
    report_list = [report for report in (reports if isinstance(reports, list) else [reports])
                   if isinstance(report, dict)]
    if not report_list:
        return []  # no Beat in this report: the employee has no house records

    simple = len(report_list) == 1 and isinstance(report_list[0], dict) and \
        not any(key in report_list[0] for key in ("RouteDetails", "routeDetails"))
    today_points = _today_route_points(text, live_date) if simple else None
    if today_points is not None:
        return [_beat_from_report(report_list[0], employee, live_date, today_points)]

    payload = json.loads(text)  # rare: multi-beat or unusual layout
    reports = payload.get("BeatWiseReport") or payload.get("beatWiseReport")
    report_list = [report for report in (reports if isinstance(reports, list) else [reports])
                   if isinstance(report, dict)]
    root_routes = payload.get("RouteDetails") or payload.get("routeDetails")
    beats = []
    for index, report in enumerate(report_list):
        details = report.get("RouteDetails") or report.get("routeDetails")
        if details is None:
            if isinstance(root_routes, list):
                details = root_routes[index] if index < len(root_routes) else None
            elif len(report_list) == 1:
                details = root_routes
        beats.append(_beat_from_report(report, employee, live_date, _route_points_from_details(details, live_date)))
    return beats


def classify_ulb(employee_results, live_date):
    """Classifies every house of one ULB for the live date.

    employee_results: list of {"employee": {...}, "beats": [...]} for reports that loaded.
    Returns (employee_rows, beat_rows, house_rows, counts).
    """
    assignments = {}
    for result in employee_results:
        for beat in result["beats"]:
            assignments.setdefault(beat["owner_id"], set()).add(beat["beat_id"])

    counts = dict.fromkeys(CATEGORIES, 0)
    employee_rows, beat_rows, house_rows = [], [], []
    for result in employee_results:
        employee = result["employee"]
        active = any(beat["has_house_records"] and beat["gps_points_today"] > 0 for beat in result["beats"])
        employee_rows.append({"id": employee["id"], "name": employee["name"], "status": "active" if active else "inactive"})
        for beat in result["beats"]:
            beat_counts = dict.fromkeys(CATEGORIES, 0)
            for house_id, scanned_at, scanner_id, scanner_name in beat["houses"]:
                if not scanned_at:
                    category = "not_scanned_today"
                elif scanner_id and scanner_id == beat["owner_id"]:
                    category = "inside"
                elif scanner_id and any(key != beat["beat_id"] for key in assignments.get(scanner_id, ())):
                    category = "outside"
                else:
                    category = "other"
                beat_counts[category] += 1
                if category != "not_scanned_today":
                    house_rows.append({
                        "category": category,
                        "employee_id": employee["id"],
                        "beat_name": beat["beat_name"],
                        "house_id": house_id,
                        "scanned_at": scanned_at,
                        "scanner_id": scanner_id,
                        "scanner_name": scanner_name,
                    })
            for key, value in beat_counts.items():
                counts[key] += value
            beat_rows.append({
                "employee_id": employee["id"],
                "employee_name": employee["name"],
                "beat_name": beat["beat_name"],
                "active": active,
                "total_houses": len(beat["houses"]),
                **{f"{key}_count": value for key, value in beat_counts.items()},
            })
    return employee_rows, beat_rows, house_rows, counts


def ulb_status(row):
    if row["list_error"]:
        return "Unavailable"
    if row["pending"]:
        return "Active" if row["active_employees"] else "Checking"
    if not row["employees"]:
        return "No employees"
    if row["active_employees"] and row["failed_reports"]:
        return "Active · partial"
    if row["active_employees"]:
        return "Active"
    if row["failed_reports"]:
        return "Partial"
    return "Inactive"


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def default_database_path():
    configured = os.environ.get("LIVE_ALL_ULB_DATABASE")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent / "data" / "live_all_ulb.sqlite3"


class LiveStore:
    def __init__(self, path=None):
        self.path = Path(path or default_database_path())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.token = uuid.uuid4().hex  # identifies this process's lease
        with self._connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS live_runs (
                    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    live_date TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL,
                    summary_json TEXT
                );
                CREATE TABLE IF NOT EXISTS live_employees (
                    run_id INTEGER, ulb_id TEXT, ulb_name TEXT, employee_id TEXT, name TEXT,
                    status TEXT, error TEXT
                );
                CREATE TABLE IF NOT EXISTS live_beats (
                    run_id INTEGER, ulb_id TEXT, ulb_name TEXT, employee_id TEXT, employee_name TEXT,
                    beat_name TEXT, active INTEGER, total_houses INTEGER, inside_count INTEGER,
                    outside_count INTEGER, other_count INTEGER, not_scanned_today_count INTEGER
                );
                CREATE TABLE IF NOT EXISTS live_houses (
                    run_id INTEGER, category TEXT, ulb_id TEXT, ulb_name TEXT, employee_id TEXT,
                    beat_name TEXT, house_id TEXT, scanned_at TEXT, scanner_id TEXT, scanner_name TEXT
                );
                CREATE TABLE IF NOT EXISTS live_lease (
                    id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, heartbeat REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS live_employees_run ON live_employees (run_id, status, ulb_id);
                CREATE INDEX IF NOT EXISTS live_beats_run ON live_beats (run_id, ulb_id);
                CREATE INDEX IF NOT EXISTS live_houses_run ON live_houses (run_id, category, ulb_id);
            """)
            # A run left 'running' by a server that stopped can never finish. Runs of another process
            # that still holds a live lease are left alone.
            lease = connection.execute("SELECT heartbeat FROM live_lease WHERE id = 1").fetchone()
            if not lease or time.time() - lease["heartbeat"] >= LEASE_SECONDS:
                connection.execute("UPDATE live_runs SET status = 'abandoned' WHERE status = 'running'")

    @contextmanager
    def _connect(self):
        """Opens a connection, commits on success, rolls back on error, and always closes it."""
        connection = sqlite3.connect(self.path, timeout=60)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def acquire_lease(self):
        """True when this process may refresh: no other process holds a live lease."""
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT owner, heartbeat FROM live_lease WHERE id = 1").fetchone()
            if row and row["owner"] != self.token and time.time() - row["heartbeat"] < LEASE_SECONDS:
                return False
            connection.execute(
                "INSERT OR REPLACE INTO live_lease (id, owner, heartbeat) VALUES (1, ?, ?)",
                (self.token, time.time()),
            )
            return True

    def renew_lease(self):
        with self._lock, self._connect() as connection:
            connection.execute("UPDATE live_lease SET heartbeat = ? WHERE id = 1 AND owner = ?",
                               (time.time(), self.token))

    def release_lease(self):
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM live_lease WHERE id = 1 AND owner = ?", (self.token,))

    def run_exists(self, run_id):
        with self._connect() as connection:
            return connection.execute(
                "SELECT 1 FROM live_runs WHERE run_id = ?", (run_id,)).fetchone() is not None

    def start_run(self, live_date):
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO live_runs (live_date, started_at, status) VALUES (?, ?, 'running')",
                (live_date, _now_iso()),
            )
            return cursor.lastrowid

    def write_ulb(self, run_id, ulb, employee_rows, beat_rows, house_rows):
        with self._lock, self._connect() as connection:
            connection.executemany(
                "INSERT INTO live_employees VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(run_id, ulb["id"], ulb["name"], row["id"], row["name"], row["status"], row.get("error"))
                 for row in employee_rows],
            )
            connection.executemany(
                "INSERT INTO live_beats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [(run_id, ulb["id"], ulb["name"], row["employee_id"], row["employee_name"], row["beat_name"],
                  int(row["active"]), row["total_houses"], row["inside_count"], row["outside_count"],
                  row["other_count"], row["not_scanned_today_count"]) for row in beat_rows],
            )
            connection.executemany(
                "INSERT INTO live_houses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [(run_id, row["category"], ulb["id"], ulb["name"], row["employee_id"], row["beat_name"],
                  row["house_id"], row["scanned_at"], row["scanner_id"], row["scanner_name"]) for row in house_rows],
            )

    def finish_run(self, run_id, status, summary):
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE live_runs SET status = ?, finished_at = ?, summary_json = ? WHERE run_id = ?",
                (status, _now_iso(), json.dumps(summary), run_id),
            )
            if status == "complete":
                # Keep this snapshot and the previous complete one, so lists that were opened on the
                # previous snapshot can still be paged until the next refresh; delete everything older.
                previous = connection.execute(
                    "SELECT run_id FROM live_runs WHERE status = 'complete' AND run_id <> ? "
                    "ORDER BY run_id DESC LIMIT 1", (run_id,)).fetchone()
                keep = {run_id, previous[0] if previous else run_id}
                old = [row[0] for row in connection.execute(
                    "SELECT run_id FROM live_runs WHERE status <> 'running'") if row[0] not in keep]
                for old_id in old:
                    for table in ("live_employees", "live_beats", "live_houses", "live_runs"):
                        connection.execute(f"DELETE FROM {table} WHERE run_id = ?", (old_id,))

    def discard_run(self, run_id):
        with self._lock, self._connect() as connection:
            for table in ("live_employees", "live_beats", "live_houses", "live_runs"):
                connection.execute(f"DELETE FROM {table} WHERE run_id = ?", (run_id,))

    def latest_complete(self):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT run_id, summary_json FROM live_runs WHERE status = 'complete' ORDER BY run_id DESC LIMIT 1"
            ).fetchone()
        return (row["run_id"], json.loads(row["summary_json"])) if row else (None, None)

    def query(self, sql, params):
        with self._connect() as connection:
            return [dict(row) for row in connection.execute(sql, params)]


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

class LiveAllUlbLoader:
    def __init__(self, store=None, session=None, refresh_minutes=REFRESH_MINUTES):
        self.store = store or LiveStore()
        self.session = session or self._make_session()
        self.refresh_seconds = refresh_minutes * 60
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread = None
        self._running = None  # state of the run in progress
        self._last_started = 0.0
        self._last_error = ""
        self._last_failed = 0.0
        self._last_renew = 0.0
        self._complete_run_id, self._complete_summary = self.store.latest_complete()

    @staticmethod
    def _make_session():
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=4, pool_maxsize=REPORT_WORKERS + EMPLOYEE_LIST_WORKERS)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    # -- scheduling -------------------------------------------------------
    def start(self):
        if not LOADER_ENABLED:
            return
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._loop, name="live-all-ulb-loader", daemon=True)
            self._thread.start()

    def request_refresh(self):
        if not LOADER_ENABLED:
            return False
        with self._lock:
            already_running = self._running is not None
            self._last_started = 0.0
            self._last_failed = 0.0  # an explicit refresh skips the failure backoff
        self._wake.set()
        self.start()
        return not already_running

    def _due(self):
        if self._running is not None:
            return False
        if self._last_failed and time.time() - self._last_failed < RETRY_BACKOFF_SECONDS:
            return False
        today = live_date_ist()
        complete_date = (self._complete_summary or {}).get("liveDate")
        return complete_date != today or time.time() - self._last_started >= self.refresh_seconds

    def _loop(self):
        while True:
            try:
                if self._due():
                    self.run_once()
            except Exception as error:  # keep the scheduler alive
                logger.exception("Live All-ULB refresh failed")
                self._last_error = str(error)
                self._last_failed = time.time()
            self._wake.wait(30)
            self._wake.clear()

    # -- fetching ---------------------------------------------------------
    def _get(self, url, headers=None):
        last_error = None
        for attempt in range(REQUEST_RETRIES + 1):
            try:
                response = self.session.get(url, headers=headers or {}, timeout=REQUEST_TIMEOUT)
                if response.status_code >= 500 and attempt < REQUEST_RETRIES:
                    raise requests.HTTPError(f"HTTP {response.status_code}")
                if not response.ok:
                    raise ValueError(f"Request failed (HTTP {response.status_code}).")
                return response.content
            except (requests.RequestException, ValueError) as error:
                last_error = error
                if isinstance(error, ValueError) or attempt == REQUEST_RETRIES:
                    break
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(str(last_error) or "Request failed.")

    def _load_employees(self, ulb):
        return normalize_employees(json.loads(self._get(API_ENDPOINTS["employees"], {"AppId": ulb["id"]})))

    def _load_report(self, ulb, employee, live_date):
        raw = self._get(API_ENDPOINTS["report"], {"AppId": ulb["id"], "userId": employee["id"]})
        return parse_report_for_date(raw, employee, live_date)

    # -- one refresh ------------------------------------------------------
    def run_once(self):
        live_date = live_date_ist()
        with self._lock:
            if self._running is not None:
                return
            self._last_started = time.time()
            self._last_error = ""
        if not self.store.acquire_lease():
            self._last_error = "Another server process is already refreshing the All-ULB data."
            return
        try:
            ulbs = normalize_ulbs(json.loads(self._get(API_ENDPOINTS["ulbs"])))
        except Exception:
            self.store.release_lease()
            raise
        run_id = self.store.start_run(live_date)
        state = {
            "run_id": run_id,
            "live_date": live_date,
            "started_at": _now_iso(),
            "ulbs": {ulb["id"]: self._empty_ulb_row(ulb) for ulb in ulbs},
            "lists_done": 0,
            "reports_total": 0,
            "reports_done": 0,
            "reports_failed": 0,
        }
        with self._lock:
            self._running = state
        try:
            self._run(ulbs, state)
            summary = self._summary_from_state(state, complete=True)
            self.store.finish_run(run_id, "complete", summary)
            with self._lock:
                self._complete_run_id, self._complete_summary = run_id, summary
                self._last_failed = 0.0
        except Exception:
            self.store.discard_run(run_id)
            raise
        finally:
            self.store.release_lease()
            with self._lock:
                self._running = None

    @staticmethod
    def _empty_ulb_row(ulb):
        return {
            "id": ulb["id"], "name": ulb["name"], "pending": True, "list_error": "",
            "employees": 0, "beat_employees": 0, "checked_reports": 0,
            "loaded_reports": 0, "failed_reports": 0, "active_employees": 0,
            "total_houses": 0, **{f"{key}_count": 0 for key in CATEGORIES},
        }

    def _run(self, ulbs, state):
        employee_lists = {}
        with ThreadPoolExecutor(EMPLOYEE_LIST_WORKERS) as pool:
            futures = {pool.submit(self._load_employees, ulb): ulb for ulb in ulbs}
            for future in as_completed(futures):
                ulb = futures[future]
                row = state["ulbs"][ulb["id"]]
                try:
                    employee_lists[ulb["id"]] = future.result()
                    row["employees"] = len(employee_lists[ulb["id"]])
                    row["beat_employees"] = sum(1 for item in employee_lists[ulb["id"]] if item["has_beat"])
                except Exception as error:
                    row["list_error"] = str(error) or "The employee list could not be loaded."
                    row["pending"] = False
                with self._lock:
                    state["lists_done"] += 1
                    state["reports_total"] += row["beat_employees"]

        pending = {ulb_id: sum(1 for item in employees if item["has_beat"])
                   for ulb_id, employees in employee_lists.items()}
        results = {ulb_id: [] for ulb_id in employee_lists}
        failures = {ulb_id: [] for ulb_id in employee_lists}
        ulb_by_id = {ulb["id"]: ulb for ulb in ulbs}
        for ulb_id, count in pending.items():
            if count == 0:
                self._finalize_ulb(state, ulb_by_id[ulb_id], [], [], employee_lists[ulb_id])

        with ThreadPoolExecutor(REPORT_WORKERS) as pool:
            futures = {}
            for ulb_id, employee in report_order(employee_lists):
                ulb = ulb_by_id[ulb_id]
                futures[pool.submit(self._load_report, ulb, employee, state["live_date"])] = (ulb, employee)
            for future in as_completed(futures):
                ulb, employee = futures[future]
                try:
                    beats = future.result()
                    results[ulb["id"]].append({"employee": employee, "beats": beats})
                    active = any(beat["has_house_records"] and beat["gps_points_today"] > 0 for beat in beats)
                    with self._lock:  # the ULB turns Active as soon as one active employee is found
                        row = state["ulbs"][ulb["id"]]
                        row["checked_reports"] += 1
                        row["active_employees"] += int(active)
                except Exception as error:
                    failures[ulb["id"]].append({**employee, "error": str(error) or "The report could not be loaded."})
                    with self._lock:
                        state["reports_failed"] += 1
                with self._lock:
                    state["reports_done"] += 1
                if time.time() - self._last_renew >= 60:
                    self.store.renew_lease()
                    self._last_renew = time.time()
                pending[ulb["id"]] -= 1
                if pending[ulb["id"]] == 0:
                    self._finalize_ulb(state, ulb, results.pop(ulb["id"]), failures.pop(ulb["id"]),
                                       employee_lists[ulb["id"]])

    def _finalize_ulb(self, state, ulb, employee_results, failed, employees):
        employee_rows, beat_rows, house_rows, counts = classify_ulb(employee_results, state["live_date"])
        employee_rows += [{"id": item["id"], "name": item["name"], "status": "failed", "error": item["error"]}
                          for item in failed]
        # Employees without a Beat have no house records, so they cannot be active; no report is needed.
        employee_rows += [{"id": item["id"], "name": item["name"], "status": "no_beat", "error": "No Beat assigned"}
                          for item in employees if not item["has_beat"]]
        self.store.write_ulb(state["run_id"], ulb, employee_rows, beat_rows, house_rows)
        with self._lock:
            row = state["ulbs"][ulb["id"]]
            row.update({
                "pending": False,
                "loaded_reports": len(employee_results),
                "failed_reports": len(failed),
                "active_employees": sum(1 for item in employee_rows if item["status"] == "active"),
                "total_houses": sum(counts.values()),
                **{f"{key}_count": value for key, value in counts.items()},
            })

    # -- reading ----------------------------------------------------------
    def _summary_from_state(self, state, complete):
        with self._lock:
            rows = [dict(row) for row in state["ulbs"].values()]
            progress = {
                "employeeListsDone": state["lists_done"],
                "employeeListsTotal": len(state["ulbs"]),
                "reportsDone": state["reports_done"],
                "reportsTotal": state["reports_total"],
                "reportsFailed": state["reports_failed"],
            }
        ulb_rows = []
        for row in rows:
            ulb_rows.append({
                "id": row["id"],
                "name": row["name"],
                "status": ulb_status(row),
                "listError": row["list_error"],
                "employees": row["employees"],
                "beatEmployees": row["beat_employees"],
                "checking": row["pending"] and not row["list_error"],
                "checkedReports": row["checked_reports"],
                "loadedReports": row["loaded_reports"],
                "failedReports": row["failed_reports"],
                "activeEmployees": row["active_employees"],
                "totalHouses": row["total_houses"],
                "counts": {key: row[f"{key}_count"] for key in CATEGORIES},
            })
        done_rows = [row for row in ulb_rows if not row["checking"]]
        totals = {
            "ulbs": len(ulb_rows),
            "activeUlbs": sum(1 for row in ulb_rows if row["activeEmployees"] > 0),
            "inactiveUlbs": sum(1 for row in ulb_rows if row["status"] == "Inactive"),
            "employees": sum(row["employees"] for row in ulb_rows),
            "beatEmployees": sum(row["beatEmployees"] for row in ulb_rows),
            "checkedReports": sum(row["checkedReports"] for row in ulb_rows),
            "loadedReports": sum(row["loadedReports"] for row in ulb_rows),
            "failedReports": sum(row["failedReports"] for row in ulb_rows),
            "activeEmployees": sum(row["activeEmployees"] for row in ulb_rows),
            "totalHouses": sum(row["totalHouses"] for row in done_rows),
            "counts": {key: sum(row["counts"][key] for row in done_rows) for key in CATEGORIES},
        }
        # Inactive = Beat employees in finished ULBs whose report loaded but shows no work today.
        # Employees without a Beat have no report and are counted separately.
        totals["inactiveEmployees"] = sum(max(0, row["loadedReports"] - row["activeEmployees"]) for row in done_rows)
        totals["noBeatEmployees"] = sum(max(0, row["employees"] - row["beatEmployees"])
                                        for row in done_rows if not row["listError"])
        totals["pendingUlbs"] = totals["ulbs"] - totals["activeUlbs"] - totals["inactiveUlbs"]
        totals["checkingUlbs"] = sum(1 for row in ulb_rows if row["checking"] and row["activeEmployees"] == 0)
        totals["incompleteUlbs"] = totals["pendingUlbs"] - totals["checkingUlbs"]
        return {
            "runId": state["run_id"],
            "liveDate": state["live_date"],
            "startedAt": state["started_at"],
            "generatedAt": _now_iso(),
            "complete": complete,
            "progress": progress,
            "totals": totals,
            "ulbs": ulb_rows,
        }

    def snapshot(self):
        """The summary to show: today's complete snapshot, else today's partial run, else the last one."""
        today = live_date_ist()
        if self._running is None:
            stored_id, stored_summary = self.store.latest_complete()
            if stored_id is not None and stored_id != self._complete_run_id:
                with self._lock:
                    self._complete_run_id, self._complete_summary = stored_id, stored_summary
        with self._lock:
            running = self._running
            complete_summary = self._complete_summary
        running_summary = self._summary_from_state(running, complete=False) if running else None
        if complete_summary and complete_summary.get("liveDate") == today:
            chosen = complete_summary
        elif running_summary and running_summary["liveDate"] == today:
            chosen = running_summary
        else:
            chosen = complete_summary or running_summary
        return {
            "enabled": LOADER_ENABLED,
            "liveDate": today,
            "refreshMinutes": self.refresh_seconds // 60,
            "refreshing": running is not None,
            "refreshProgress": running_summary["progress"] if running_summary else None,
            "lastError": self._last_error,
            "snapshot": chosen,
            "stale": bool(chosen) and chosen.get("liveDate") != today,
        }

    def served_run_id(self):
        snapshot = self.snapshot()["snapshot"]
        return snapshot["runId"] if snapshot else None


_loader = None
_loader_lock = threading.Lock()


def get_loader():
    global _loader
    with _loader_lock:
        if _loader is None:
            _loader = LiveAllUlbLoader()
        return _loader
