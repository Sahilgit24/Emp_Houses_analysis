import unittest

from employee_anomalies import analyze_employee_anomalies
from flask import Flask
from routes.analytics import analytics_bp


def _activity(date, assigned_count=5, outside_count=0, coordinates=None, route_data=True):
    return {
        "date": date,
        "assigned_house_ids": [f"{date}-own-{index}" for index in range(assigned_count)],
        "other_house_ids": [],
        "outside_beat_house_ids": [f"{date}-outside-{index}" for index in range(outside_count)],
        "assigned_house_coordinates": coordinates or [],
        "has_activity_data": True,
        "has_route_collection_data": route_data,
    }


def _spread_coordinates():
    return [{"lat": 20 + index * 0.02, "lon": 78} for index in range(5)]


class EmployeeAnomalyTests(unittest.TestCase):
    def test_detects_daily_output_drop_against_immediately_previous_day(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 100,
            "daily_activity": [
                _activity("2026-10-01", assigned_count=10),
                _activity("2026-10-02", assigned_count=10),
                _activity("2026-10-03", assigned_count=10),
                _activity("2026-10-04", assigned_count=5),
            ],
            "house_patterns": [{
                "house_id": "H-1",
                "collection_days": 4,
                "typical_interval_days": 2,
                "current_gap_days": 1,
                "repeated_long_gaps": 0,
                "status": "Regular",
            }],
        })

        output_change = next(
            anomaly for anomaly in result["anomalies"]
            if anomaly["type"] == "Daily assigned-employee collection change"
        )
        self.assertEqual(output_change["severity"], "High")
        self.assertEqual(output_change["normal_pattern"], "10 houses on 2026-10-03 (immediately previous day)")
        self.assertIn("decreased by 50.0%", output_change["reason"])

    def test_daily_output_uses_yesterday_instead_of_older_history(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 2000,
            "daily_activity": [
                _activity("2026-10-01", assigned_count=10),
                _activity("2026-10-02", assigned_count=20),
                _activity("2026-10-03", assigned_count=100),
                _activity("2026-10-04", assigned_count=120),
            ],
            "house_patterns": [],
        })

        output_change = next(
            anomaly for anomaly in result["anomalies"]
            if anomaly["type"] == "Daily assigned-employee collection change"
        )
        self.assertEqual(output_change["severity"], "Low")
        self.assertEqual(output_change["normal_pattern"], "100 houses on 2026-10-03 (immediately previous day)")
        self.assertIn("+20.0%", output_change["current_pattern"])

    def test_small_daily_change_is_not_reported_and_threshold_bands_are_exact(self):
        def find_daily_anomaly(previous_count, current_count):
            result = analyze_employee_anomalies({
                "selected_date": "2026-10-04",
                "total_houses": 1000,
                "daily_activity": [
                    _activity("2026-10-03", assigned_count=previous_count),
                    _activity("2026-10-04", assigned_count=current_count),
                ],
                "house_patterns": [],
            })
            return next(
                (anomaly for anomaly in result["anomalies"]
                 if anomaly["type"] == "Daily assigned-employee collection change"),
                None,
            )

        self.assertIsNone(find_daily_anomaly(868, 900))
        self.assertIsNone(find_daily_anomaly(900, 868))
        self.assertIsNone(find_daily_anomaly(100, 110))
        self.assertEqual(find_daily_anomaly(100, 120)["severity"], "Low")
        self.assertEqual(find_daily_anomaly(100, 135)["severity"], "Medium")
        self.assertEqual(find_daily_anomaly(100, 136)["severity"], "High")

    def test_daily_comparison_requires_immediately_previous_day_data(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 100,
            "daily_activity": [
                _activity("2026-10-02", assigned_count=10),
                _activity("2026-10-04", assigned_count=20),
            ],
            "house_patterns": [],
        })

        self.assertFalse(any(
            anomaly["type"] == "Daily assigned-employee collection change"
            for anomaly in result["anomalies"]
        ))
        self.assertTrue(any(
            "immediately previous day (2026-10-03)" in message
            for message in result["insufficient_data"]
        ))

    def test_daily_percent_is_insufficient_when_yesterday_count_is_zero(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 100,
            "daily_activity": [
                _activity("2026-10-03", assigned_count=0),
                _activity("2026-10-04", assigned_count=20),
            ],
            "house_patterns": [],
        })

        self.assertFalse(any(
            anomaly["type"] == "Daily assigned-employee collection change"
            for anomaly in result["anomalies"]
        ))
        self.assertTrue(any(
            "zero houses on the immediately previous day" in message
            for message in result["insufficient_data"]
        ))

    def test_detects_full_output_drop_for_a_small_employee_beat(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 10,
            "daily_activity": [
                _activity("2026-10-01", assigned_count=2),
                _activity("2026-10-02", assigned_count=2),
                _activity("2026-10-03", assigned_count=2),
                _activity("2026-10-04", assigned_count=0),
            ],
            "house_patterns": [{
                "house_id": "H-1",
                "collection_days": 4,
                "typical_interval_days": 2,
                "current_gap_days": 1,
                "repeated_long_gaps": 0,
                "status": "Regular",
            }],
        })

        output_change = next(
            anomaly for anomaly in result["anomalies"]
            if anomaly["type"] == "Daily assigned-employee collection change"
        )
        self.assertEqual(output_change["severity"], "High")

    def test_reports_recurring_gaps_and_overdue_house_pattern(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 1,
            "daily_activity": [_activity("2026-10-04")],
            "house_patterns": [{
                "house_id": "H-1",
                "collection_days": 5,
                "typical_interval_days": 2,
                "current_gap_days": 7,
                "repeated_long_gaps": 2,
                "status": "Overdue",
            }],
        })

        anomaly_types = {anomaly["type"] for anomaly in result["anomalies"]}
        self.assertIn("Repeated long collection gaps", anomaly_types)
        self.assertIn("Unusually long current collection gaps", anomaly_types)
        self.assertTrue(all(anomaly["severity"] in {"Low", "Medium", "High"} for anomaly in result["anomalies"]))

    def test_detects_outside_beat_increase_and_geographic_concentration(self):
        coordinates = _spread_coordinates()
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 50,
            "daily_activity": [
                _activity("2026-10-01", coordinates=coordinates),
                _activity("2026-10-02", coordinates=coordinates),
                _activity("2026-10-03", coordinates=coordinates),
                _activity(
                    "2026-10-04",
                    outside_count=4,
                    coordinates=[{"lat": 20, "lon": 78}] * 5,
                ),
            ],
            "house_patterns": [{
                "house_id": "H-1",
                "collection_days": 4,
                "typical_interval_days": 2,
                "current_gap_days": 1,
                "repeated_long_gaps": 0,
                "status": "Regular",
            }],
        })

        anomaly_types = {anomaly["type"] for anomaly in result["anomalies"]}
        self.assertIn("Increase in outside-Beat collection", anomaly_types)
        self.assertIn("Collection concentrated in one GPS area", anomaly_types)

    def test_returns_insufficient_data_when_historical_baseline_is_too_short(self):
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-03",
            "total_houses": 20,
            "daily_activity": [
                _activity("2026-10-02"),
                _activity("2026-10-03"),
            ],
            "house_patterns": [],
        })

        self.assertEqual(result["anomalies"], [])
        self.assertTrue(any(message.startswith("House collection gaps:") for message in result["insufficient_data"]))
        self.assertTrue(any(message.startswith("Beat coverage change:") for message in result["insufficient_data"]))
        self.assertTrue(any(message.startswith("Outside-Beat collection change:") for message in result["insufficient_data"]))
        self.assertTrue(any(message.startswith("Geographic concentration:") for message in result["insufficient_data"]))

    def test_returns_no_findings_when_complete_history_is_within_observed_patterns(self):
        coordinates = _spread_coordinates()
        result = analyze_employee_anomalies({
            "selected_date": "2026-10-04",
            "total_houses": 50,
            "daily_activity": [
                _activity("2026-10-01", coordinates=coordinates),
                _activity("2026-10-02", coordinates=coordinates),
                _activity("2026-10-03", coordinates=coordinates),
                _activity("2026-10-04", coordinates=coordinates),
            ],
            "house_patterns": [{
                "house_id": "H-1",
                "collection_days": 4,
                "typical_interval_days": 2,
                "current_gap_days": 1,
                "repeated_long_gaps": 0,
                "status": "Regular",
            }],
        })

        self.assertEqual(result["anomalies"], [])
        self.assertEqual(result["insufficient_data"], [])

    def test_exposes_anomaly_calculation_endpoint(self):
        app = Flask(__name__)
        app.register_blueprint(analytics_bp)
        response = app.test_client().post("/analytics/employee-anomalies", json={
            "selected_date": "2026-10-03",
            "total_houses": 20,
            "daily_activity": [],
            "house_patterns": [],
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "success")


if __name__ == "__main__":
    unittest.main()
