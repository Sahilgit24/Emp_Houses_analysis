import unittest
from unittest.mock import patch

import route_optimizer
from route_optimizer import optimize_beat_house_routes


class StopBeforeRouting(Exception):
    pass


TRACK = [{"lat": 21.0005, "lon": 79.0005, "datetime": "2026-01-01T08:00:00"}]
SINGLE = "21.0,79.0;21.0,79.001;21.001,79.001;21.001,79.0"
TWO_PART = SINGLE + ":21.002,79.002;21.002,79.003;21.003,79.003;21.003,79.002"


class BeatGeofenceParsingTests(unittest.TestCase):
    def _houses_sent_to_router(self, geofence, houses):
        """Run the optimizer up to the first routing call and return the points it would route."""
        captured = {}

        def fake_matrix(points, _requests):
            captured["points"] = points
            raise StopBeforeRouting

        with patch.object(route_optimizer, "_request_osrm_distance_matrix", side_effect=fake_matrix):
            with self.assertRaises(StopBeforeRouting):
                optimize_beat_house_routes(TRACK, houses, geofence)
        return captured["points"]

    def test_single_part_geofence_still_accepted(self):
        points = self._houses_sent_to_router(SINGLE, [{"house_id": "a", "lat": 21.0005, "lon": 79.0005}])
        self.assertTrue(any(point.get("house_id") == "a" for point in points if isinstance(point, dict)))

    def test_multi_part_geofence_keeps_houses_in_every_part(self):
        houses = [
            {"house_id": "first-part", "lat": 21.0005, "lon": 79.0005},
            {"house_id": "second-part", "lat": 21.0025, "lon": 79.0025},
            {"house_id": "outside", "lat": 21.01, "lon": 79.01},
        ]
        points = self._houses_sent_to_router(TWO_PART, houses)
        ids = {point.get("house_id") for point in points if isinstance(point, dict)}
        self.assertIn("first-part", ids)
        self.assertIn("second-part", ids)
        self.assertNotIn("outside", ids)

    def test_malformed_part_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "valid 'lat,lon;lat,lon'"):
            optimize_beat_house_routes(TRACK, [{"lat": 21.0005, "lon": 79.0005}], SINGLE + ":bad")


if __name__ == "__main__":
    unittest.main()
