from datetime import datetime, timedelta
from math import cos, floor, isfinite, radians
from statistics import median


def _read_date(value, field_name):
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a YYYY-MM-DD date.")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as error:
        raise ValueError(f"{field_name} must be a YYYY-MM-DD date.") from error
    return value


def _read_ids(value):
    if not isinstance(value, list):
        return set()
    return {str(item) for item in value if item is not None and str(item)}


def _read_number(value, minimum=None):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(number) or (minimum is not None and number < minimum):
        return None
    return number


def _read_daily_activity(records):
    if not isinstance(records, list):
        raise ValueError("daily_activity must be an array.")

    activity_by_date = {}
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Each daily_activity entry must be an object.")
        date = _read_date(record.get("date"), "daily_activity.date")
        if date in activity_by_date:
            raise ValueError(f"daily_activity contains duplicate date {date}.")
        coordinates = []
        for item in record.get("assigned_house_coordinates", []):
            if not isinstance(item, dict):
                continue
            lat = _read_number(item.get("lat"), -90)
            lon = _read_number(item.get("lon"), -180)
            if lat is None or lon is None or lat > 90 or lon > 180:
                continue
            coordinates.append((lat, lon))

        activity_by_date[date] = {
            "assigned_house_ids": _read_ids(record.get("assigned_house_ids")),
            "other_house_ids": _read_ids(record.get("other_house_ids")),
            "outside_beat_house_ids": _read_ids(record.get("outside_beat_house_ids")),
            "assigned_house_coordinates": coordinates,
            "has_activity_data": bool(record.get("has_activity_data")),
            "has_route_collection_data": bool(record.get("has_route_collection_data")),
        }
    return activity_by_date


def _read_house_patterns(records):
    if not isinstance(records, list):
        raise ValueError("house_patterns must be an array.")
    patterns = []
    for record in records:
        if not isinstance(record, dict):
            continue
        typical_interval = _read_number(record.get("typical_interval_days"), 0)
        if typical_interval == 0:
            typical_interval = None
        current_gap = _read_number(record.get("current_gap_days"), 0)
        try:
            repeated_long_gaps = max(0, int(record.get("repeated_long_gaps", 0)))
            collection_days = max(0, int(record.get("collection_days", 0)))
        except (TypeError, ValueError):
            repeated_long_gaps = collection_days = 0
        patterns.append({
            "house_id": str(record.get("house_id") or ""),
            "typical_interval_days": typical_interval,
            "current_gap_days": current_gap,
            "repeated_long_gaps": repeated_long_gaps,
            "collection_days": collection_days,
            "status": str(record.get("status") or ""),
        })
    return patterns


def _format_count(value):
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def _format_days(value):
    return f"{value:.1f}" if value % 1 else str(int(value))


def _grid_concentration(coordinates):
    if len(coordinates) < 5:
        return None
    cell_counts = {}
    for lat, lon in coordinates:
        longitude_scale = max(abs(cos(radians(lat))), 0.2)
        cell = (floor(lat * 100), floor(lon * 100 * longitude_scale))
        cell_counts[cell] = cell_counts.get(cell, 0) + 1
    largest_cell_count = max(cell_counts.values())
    return largest_cell_count / len(coordinates)


def analyze_employee_anomalies(payload):
    if not isinstance(payload, dict):
        raise ValueError("Upload a JSON object containing anomaly analysis data.")
    selected_date = _read_date(payload.get("selected_date"), "selected_date")
    total_houses = payload.get("total_houses")
    if isinstance(total_houses, bool) or not isinstance(total_houses, int) or total_houses < 0:
        raise ValueError("total_houses must be a non-negative integer.")

    activity_by_date = _read_daily_activity(payload.get("daily_activity"))
    house_patterns = _read_house_patterns(payload.get("house_patterns"))
    anomalies = []
    insufficient_data = []
    current_day = activity_by_date.get(selected_date)
    previous_date = (
        datetime.strptime(selected_date, "%Y-%m-%d") - timedelta(days=1)
    ).strftime("%Y-%m-%d")
    previous_day = activity_by_date.get(previous_date)
    previous_activity_days = [
        activity_by_date[date]
        for date in sorted(activity_by_date)
        if date < selected_date and activity_by_date[date]["has_activity_data"]
    ][-5:]

    if current_day is None or not current_day["has_activity_data"]:
        insufficient_data.append(
            "Daily collection comparison: no route or collection activity is recorded for the selected date."
        )
    elif previous_day is None or not previous_day["has_activity_data"]:
        insufficient_data.append(
            f"Daily collection comparison: no route or collection activity is recorded for the immediately previous day ({previous_date})."
        )
    else:
        current_count = len(current_day["assigned_house_ids"])
        previous_count = len(previous_day["assigned_house_ids"])
        severity = None
        if previous_count == 0:
            insufficient_data.append(
                f"Daily collection comparison: percentage change cannot be calculated from zero houses on the immediately previous day ({previous_date})."
            )
        else:
            change_percent = abs(current_count - previous_count) * 100 / previous_count
            severity = (
                "Low" if change_percent > 10 and change_percent <= 20
                else "Medium" if change_percent > 20 and change_percent <= 35
                else "High" if change_percent > 35
                else None
            )
        if severity:
            direction = "increased" if current_count > previous_count else "decreased"
            anomalies.append({
                "type": "Daily assigned-employee collection change",
                "current_pattern": f"{_format_count(current_count)} unique houses on {selected_date} ({'+' if current_count > previous_count else '-'}{change_percent:.1f}% vs previous day)",
                "normal_pattern": f"{_format_count(previous_count)} houses on {previous_date} (immediately previous day)",
                "severity": severity,
                "reason": f"Recorded daily collection {direction} by {change_percent:.1f}% compared with the immediately previous day.",
            })

    coverage_days = [
        day for day in previous_activity_days
        if day["assigned_house_ids"] or day["other_house_ids"] or day["has_activity_data"]
    ]
    if total_houses <= 0:
        insufficient_data.append(
            "Beat coverage change: cannot be assessed because the Beat has no houses."
        )
    elif current_day is None or not current_day["has_activity_data"]:
        insufficient_data.append(
            "Beat coverage change: no route or collection activity is recorded for the selected date."
        )
    elif len(coverage_days) < 3:
        insufficient_data.append(
            "Beat coverage change: at least three previous recorded days are needed for comparison."
        )
    else:
        current_covered = len(current_day["assigned_house_ids"] | current_day["other_house_ids"])
        current_percent = current_covered * 100 / total_houses
        baseline_percent = median(
            len(day["assigned_house_ids"] | day["other_house_ids"]) * 100 / total_houses
            for day in coverage_days
        )
        change = abs(current_percent - baseline_percent)
        if change >= 10:
            severity = "High" if change >= 30 else "Medium" if change >= 20 else "Low"
            direction = "increased" if current_percent > baseline_percent else "decreased"
            anomalies.append({
                "type": "Daily Beat coverage change",
                "current_pattern": f"{current_percent:.1f}% ({current_covered} of {total_houses} houses) on {selected_date}",
                "normal_pattern": f"Median {baseline_percent:.1f}% across {len(coverage_days)} previous activity days",
                "severity": severity,
                "reason": f"Recorded Beat coverage {direction} by {change:.1f} percentage points from the recent median.",
            })

    eligible_patterns = [
        pattern for pattern in house_patterns
        if pattern["typical_interval_days"] is not None and pattern["collection_days"] >= 2
    ]
    if not eligible_patterns:
        insufficient_data.append(
            "House collection gaps: history is insufficient to assess recurring gaps or overdue intervals."
        )
    else:
        repeated_gap_houses = [
            pattern for pattern in eligible_patterns if pattern["repeated_long_gaps"] >= 2
        ]
        if repeated_gap_houses:
            proportion = len(repeated_gap_houses) / len(eligible_patterns)
            severity = "High" if proportion >= 0.2 else "Medium" if proportion >= 0.1 else "Low"
            anomalies.append({
                "type": "Repeated long collection gaps",
                "current_pattern": f"{len(repeated_gap_houses)} houses have at least two recorded gaps longer than 1.5 times their own typical interval",
                "normal_pattern": f"{len(eligible_patterns)} houses have enough scan history to establish an interval",
                "severity": severity,
                "reason": "Repeated gaps identify houses for attention; they do not establish that a house was deliberately skipped.",
            })

        overdue_houses = [
            pattern for pattern in eligible_patterns
            if pattern["status"] == "Overdue" and pattern["current_gap_days"] is not None
        ]
        if overdue_houses:
            most_overdue = max(
                overdue_houses,
                key=lambda pattern: pattern["current_gap_days"] /
                pattern["typical_interval_days"],
            )
            ratio = most_overdue["current_gap_days"] / most_overdue["typical_interval_days"]
            severity = "High" if ratio >= 3 else "Medium" if ratio >= 2 else "Low"
            anomalies.append({
                "type": "Unusually long current collection gaps",
                "current_pattern": f"{len(overdue_houses)} houses are overdue; longest current gap is {_format_days(most_overdue['current_gap_days'])} days",
                "normal_pattern": f"Longest overdue house's typical interval is {_format_days(most_overdue['typical_interval_days'])} days",
                "severity": severity,
                "reason": f"The longest current gap is {ratio:.1f} times that house's historical interval.",
            })

    route_collection_days = [
        (date, activity_by_date[date])
        for date in sorted(activity_by_date)
        if date < selected_date and activity_by_date[date]["has_route_collection_data"]
    ][-5:]
    current_route_data = current_day and current_day["has_route_collection_data"]
    if not current_route_data or len(route_collection_days) < 3:
        insufficient_data.append(
            "Outside-Beat collection change: at least three previous route collection records are needed for comparison."
        )
    else:
        current_outside_count = len(current_day["outside_beat_house_ids"])
        baseline_outside_count = median(
            len(day["outside_beat_house_ids"]) for _, day in route_collection_days
        )
        increase = current_outside_count - baseline_outside_count
        if baseline_outside_count == 0:
            severity = "High" if increase >= 10 else "Medium" if increase >= 5 else "Low"
            significant_increase = increase >= 2
        else:
            ratio = current_outside_count / baseline_outside_count
            severity = "High" if ratio >= 3 else "Medium" if ratio >= 2 else "Low"
            significant_increase = ratio >= 1.5 and increase >= 2
        if increase > 0 and significant_increase:
            anomalies.append({
                "type": "Increase in outside-Beat collection",
                "current_pattern": f"{current_outside_count} distinct outside-Beat houses on {selected_date}",
                "normal_pattern": f"Median {_format_count(baseline_outside_count)} distinct houses across {len(route_collection_days)} previous route collection days",
                "severity": severity,
                "reason": "The selected day's verified outside-Beat collection count is higher than the recent historical median.",
            })

    current_concentration = (
        _grid_concentration(current_day["assigned_house_coordinates"])
        if current_day and current_day["has_activity_data"] else None
    )
    historical_concentrations = [
        concentration
        for day in previous_activity_days
        if (concentration := _grid_concentration(day["assigned_house_coordinates"])) is not None
    ]
    if current_concentration is None or len(historical_concentrations) < 3:
        insufficient_data.append(
            "Geographic concentration: at least five mapped assigned-employee houses on the selected day and three previous days are needed for comparison."
        )
    else:
        baseline_concentration = median(historical_concentrations)
        change = current_concentration - baseline_concentration
        if change >= 0.2:
            severity = "High" if change >= 0.5 else "Medium" if change >= 0.35 else "Low"
            current_mapped = len(current_day["assigned_house_coordinates"])
            concentrated_count = round(current_concentration * current_mapped)
            anomalies.append({
                "type": "Collection concentrated in one GPS area",
                "current_pattern": f"{concentrated_count} of {current_mapped} mapped assigned-employee houses ({current_concentration * 100:.1f}%) fell in one approximately 1-km grid cell",
                "normal_pattern": f"Previous-day median concentration was {baseline_concentration * 100:.1f}%",
                "severity": severity,
                "reason": f"The selected day's largest-cell share is {change * 100:.1f} percentage points above its historical median.",
            })

    severity_rank = {"High": 0, "Medium": 1, "Low": 2}
    anomalies.sort(key=lambda item: (severity_rank[item["severity"]], item["type"]))
    return {
        "status": "success",
        "anomalies": anomalies,
        "insufficient_data": list(dict.fromkeys(insufficient_data)),
    }
