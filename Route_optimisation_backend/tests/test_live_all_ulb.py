import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_all_ulb as live  # noqa: E402

TODAY = "2026-11-25"


def house(house_id, dates, scanner=None, name=None):
    return {
        "HouseId": house_id, "ReferanceId": f"R{house_id}", "Lat": 20.1, "Lon": 79.1,
        "Scanned": bool(dates), "ScannerUserId": scanner, "ScannerName": name, "ScanningDates": dates,
    }


def report(owner, scanned, not_scanned=(), gps_today=2):
    routes = [
        {"date": "2026-11-24", "emproute": [{"datetime": "2026-11-24T08:00:00", "lat": 20, "lon": 79}] * 5, "dumplist": []},
        {"date": TODAY, "emproute": [{"datetime": f"{TODAY}T08:00:00", "lat": 20, "lon": 79}] * gps_today, "dumplist": []},
    ]
    return {
        "BeatWiseReport": {
            "geofence": "", "BeatUserId": owner, "FromDate": "2026-10-27T00:00:00+05:30",
            "ToDate": f"{TODAY}T00:00:00+05:30", "TotalHouses": len(scanned) + len(not_scanned),
            "TotalScannedHouses": len(scanned), "TotalNotScannedHouses": len(not_scanned),
            "ScannedHouses": list(scanned), "NotScannedHouses": list(not_scanned),
        },
        "RouteDetails": {"dumpyards": [], "routes": routes},
    }


class ParseReportTests(unittest.TestCase):
    def test_fast_parse_keeps_only_todays_scans_and_route(self):
        raw = json.dumps(report("7", [
            house(1, [f"{TODAY}T09:10:00.1", "2026-11-24T09:00:00"], 7, "Seven"),
            house(2, ["2026-11-24T09:00:00"], 7, "Seven"),
        ], [house(3, [])], gps_today=3)).encode()
        [beat] = live.parse_report_for_date(raw, {"id": "7", "name": "Seven"}, TODAY)
        self.assertEqual(beat["gps_points_today"], 3)
        self.assertEqual(beat["beat_name"], "Beat assigned to Seven")
        self.assertEqual(beat["houses"], [
            ("1", f"{TODAY}T09:10:00.1", "7", "Seven"),
            ("2", "", "7", "Seven"),
            ("3", "", "", ""),
        ])

    def test_no_route_today_means_no_gps(self):
        raw = json.dumps(report("7", [house(1, [])], gps_today=0)).encode()
        [beat] = live.parse_report_for_date(raw, {"id": "7", "name": "Seven"}, TODAY)
        self.assertEqual(beat["gps_points_today"], 0)

    def test_unusual_route_field_order_falls_back_to_full_parse(self):
        payload = report("7", [house(1, [TODAY + "T08:00:00"], 7, "Seven")], gps_today=4)
        payload["RouteDetails"]["routes"] = [
            {"emproute": route["emproute"], "date": route["date"]} for route in payload["RouteDetails"]["routes"]
        ]
        [beat] = live.parse_report_for_date(json.dumps(payload), {"id": "7", "name": "Seven"}, TODAY)
        self.assertEqual(beat["gps_points_today"], 4)


class ClassifyTests(unittest.TestCase):
    def test_categories_for_today(self):
        own = {"employee": {"id": "7", "name": "Seven"}, "beats": [{
            "beat_id": "beat-user:7", "beat_name": "Beat 7", "owner_id": "7", "has_house_records": True,
            "gps_points_today": 5,
            "houses": [
                ("1", f"{TODAY}T08:00", "7", "Seven"),   # inside
                ("2", f"{TODAY}T08:05", "8", "Eight"),   # outside: 8 owns another Beat
                ("3", f"{TODAY}T08:10", "99", "Guest"),  # other: 99 owns no Beat
                ("4", "", "7", "Seven"),                 # not scanned today
            ],
        }]}
        other = {"employee": {"id": "8", "name": "Eight"}, "beats": [{
            "beat_id": "beat-user:8", "beat_name": "Beat 8", "owner_id": "8", "has_house_records": True,
            "gps_points_today": 0, "houses": [("5", "", "", "")],
        }]}
        employees, beats, houses, counts = live.classify_ulb([own, other], TODAY)
        self.assertEqual(counts, {"inside": 1, "outside": 1, "other": 1, "not_scanned_today": 2})
        self.assertEqual({row["id"]: row["status"] for row in employees}, {"7": "active", "8": "inactive"})
        self.assertEqual([row["category"] for row in houses], ["inside", "outside", "other"])
        self.assertEqual(beats[0]["not_scanned_today_count"], 1)


class LoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = live.LiveStore(os.path.join(self.tmp.name, "live.sqlite3"))

    def tearDown(self):
        self.tmp.cleanup()

    def fake_get(self, url, headers=None):
        headers = headers or {}
        if url == live.API_ENDPOINTS["ulbs"]:
            return json.dumps([{"ulb": "Alpha", "appid": 1}, {"ulb": "Beta", "appid": 2}]).encode()
        if url == live.API_ENDPOINTS["employees"]:
            if headers["AppId"] == "2":
                return json.dumps({"AllUsers": [{"UserId": 7, "UserName": "Broken"}]}).encode()
            return json.dumps({"AllUsers": [{"UserId": 7, "UserName": "Seven"}, {"UserId": 8, "UserName": "Eight"}]}).encode()
        if headers["AppId"] == "2":
            raise RuntimeError("Request failed (HTTP 500).")
        if headers["userId"] == "7":
            return json.dumps(report("7", [house(1, [TODAY + "T08:00"], 7, "Seven"), house(2, [TODAY + "T08:00"], 8, "Eight")])).encode()
        return json.dumps(report("8", [house(3, ["2026-11-24T08:00"], 8, "Eight")], gps_today=0)).encode()

    def test_full_run_builds_todays_snapshot(self):
        loader = live.LiveAllUlbLoader(store=self.store, session=object())
        with mock.patch.object(loader, "_get", side_effect=self.fake_get), \
                mock.patch.object(live, "live_date_ist", return_value=TODAY):
            loader.run_once()
            result = loader.snapshot()
        snapshot = result["snapshot"]
        self.assertTrue(snapshot["complete"])
        self.assertFalse(result["stale"])
        totals = snapshot["totals"]
        self.assertEqual(totals["employees"], 3)
        self.assertEqual(totals["loadedReports"], 2)
        self.assertEqual(totals["failedReports"], 1)
        self.assertEqual(totals["activeEmployees"], 1)
        self.assertEqual(totals["counts"], {"inside": 1, "outside": 1, "other": 0, "not_scanned_today": 1})
        statuses = {row["name"]: row["status"] for row in snapshot["ulbs"]}
        self.assertEqual(statuses, {"Alpha": "Active", "Beta": "Partial"})
        houses = self.store.query(
            "SELECT house_id FROM live_houses WHERE run_id = ? AND category = 'outside'", [snapshot["runId"]])
        self.assertEqual(houses, [{"house_id": "2"}])

        # Later runs replace older ones; the current and the previous snapshot are kept.
        for _ in range(2):
            with mock.patch.object(loader, "_get", side_effect=self.fake_get), \
                    mock.patch.object(live, "live_date_ist", return_value=TODAY):
                loader.run_once()
        runs = self.store.query("SELECT run_id FROM live_runs", [])
        self.assertEqual(len(runs), 2)
        reloaded = live.LiveAllUlbLoader(store=self.store, session=object())
        self.assertEqual(reloaded._complete_summary["totals"]["counts"]["outside"], 1)


class BeatFirstTests(unittest.TestCase):
    def test_employee_hints_and_round_robin_order(self):
        employees = live.normalize_employees({
            "AllUsers": [{"UserId": 1, "UserName": "A"}, {"UserId": 2, "UserName": "B"}, {"UserId": 3, "UserName": "C"}],
            "AllBeats": [{"UserId": 2, "UserName": "B"}, {"UserId": 3, "UserName": "C"}],
            "BothActiveUsers": [{"UserId": 3, "UserName": "C"}],
        })
        self.assertEqual([(e["id"], e["has_beat"], e["priority"]) for e in employees],
                         [("1", False, False), ("2", True, False), ("3", True, True)])
        other = [{"id": "9", "name": "Z", "has_beat": True, "priority": False}]
        order = live.report_order({"u1": employees, "u2": other})
        # Priority employee first, every ULB gets its first report before any ULB gets a second.
        self.assertEqual([(ulb, e["id"]) for ulb, e in order], [("u1", "3"), ("u2", "9"), ("u1", "2")])

    def test_employees_without_beat_are_not_downloaded_and_count_inactive(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        store = live.LiveStore(os.path.join(tmp.name, "live.sqlite3"))
        requested = []

        def fake_get(url, headers=None):
            headers = headers or {}
            if url == live.API_ENDPOINTS["ulbs"]:
                return json.dumps([{"ulb": "Alpha", "appid": 1}]).encode()
            if url == live.API_ENDPOINTS["employees"]:
                return json.dumps({
                    "AllUsers": [{"UserId": 7, "UserName": "Seven"}, {"UserId": 8, "UserName": "No beat"}],
                    "AllBeats": [{"UserId": 7, "UserName": "Seven"}],
                }).encode()
            requested.append(headers["userId"])
            return json.dumps(report("7", [house(1, [TODAY + "T08:00"], 7, "Seven")])).encode()

        loader = live.LiveAllUlbLoader(store=store, session=object())
        with mock.patch.object(loader, "_get", side_effect=fake_get), \
                mock.patch.object(live, "live_date_ist", return_value=TODAY):
            loader.run_once()
            totals = loader.snapshot()["snapshot"]["totals"]
        self.assertEqual(requested, ["7"])
        self.assertEqual((totals["employees"], totals["beatEmployees"]), (2, 1))
        self.assertEqual((totals["activeEmployees"], totals["inactiveEmployees"], totals["noBeatEmployees"]), (1, 0, 1))
        self.assertEqual(totals["activeUlbs"], 1)

    def test_ulb_is_active_while_still_checking(self):
        row = {"list_error": "", "pending": True, "active_employees": 1, "employees": 5, "failed_reports": 0}
        self.assertEqual(live.ulb_status(row), "Active")
        self.assertEqual(live.ulb_status({**row, "active_employees": 0}), "Checking")


class RobustnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "live.sqlite3")

    def tearDown(self):
        self.tmp.cleanup()

    def test_empty_or_malformed_beat_report_means_no_beats(self):
        employee = {"id": "7", "name": "Seven"}
        self.assertEqual(live.parse_report_for_date(b'{"BeatWiseReport": [], "RouteDetails": []}', employee, TODAY), [])
        self.assertEqual(live.parse_report_for_date(b'{"BeatWiseReport": [null], "RouteDetails": {}}', employee, TODAY), [])

    def test_only_one_process_holds_the_refresh_lease(self):
        first, second = live.LiveStore(self.path), live.LiveStore(self.path)
        self.assertTrue(first.acquire_lease())
        self.assertFalse(second.acquire_lease())
        first.release_lease()
        self.assertTrue(second.acquire_lease())

    def test_new_process_does_not_abandon_a_run_whose_owner_is_alive(self):
        first = live.LiveStore(self.path)
        self.assertTrue(first.acquire_lease())
        run_id = first.start_run(TODAY)
        live.LiveStore(self.path)  # a second process starting up
        self.assertEqual(first.query("SELECT status FROM live_runs WHERE run_id = ?", [run_id]),
                         [{"status": "running"}])

    def test_previous_complete_snapshot_is_kept_for_open_lists(self):
        store = live.LiveStore(self.path)
        ids = []
        for _ in range(3):
            run_id = store.start_run(TODAY)
            store.finish_run(run_id, "complete", {"liveDate": TODAY, "runId": run_id})
            ids.append(run_id)
        self.assertFalse(store.run_exists(ids[0]))
        self.assertTrue(store.run_exists(ids[1]))
        self.assertTrue(store.run_exists(ids[2]))

    def test_failed_refresh_backs_off(self):
        loader = live.LiveAllUlbLoader(store=live.LiveStore(self.path), session=object())
        loader._last_failed = live.time.time()
        self.assertFalse(loader._due())
        loader._last_failed = live.time.time() - live.RETRY_BACKOFF_SECONDS - 1
        self.assertTrue(loader._due())


if __name__ == "__main__":
    unittest.main()
