from flask import Blueprint, jsonify, request

from live_all_ulb import CATEGORIES, COLLECTED_CATEGORIES, get_loader

live_all_ulb_bp = Blueprint("live_all_ulb", __name__, url_prefix="/live/all-ulbs")

MAX_PAGE_SIZE = 1000


class StaleRunError(Exception):
    """The requested snapshot has been replaced and its rows deleted."""


def _page():
    try:
        limit = min(MAX_PAGE_SIZE, max(1, int(request.args.get("limit", 200))))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        raise ValueError("limit and offset must be whole numbers.")
    return limit, offset


def _run_id():
    loader = get_loader()
    loader.start()
    requested = request.args.get("runId")
    if requested:
        try:
            run_id = int(requested)
        except ValueError:
            raise ValueError("runId must be a number.")
        if not loader.store.run_exists(run_id):
            raise StaleRunError("This list belongs to an older snapshot that has been replaced. Close it and open it again.")
        return run_id
    return loader.served_run_id()


def _paged(table, where, params, order, columns):
    limit, offset = _page()
    store = get_loader().store
    total = store.query(f"SELECT COUNT(*) AS n FROM {table} WHERE {where}", params)[0]["n"]
    items = store.query(
        f"SELECT {columns} FROM {table} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        [*params, limit, offset],
    )
    return {"total": total, "limit": limit, "offset": offset, "items": items}


def _error(error, status=400):
    return jsonify({"status": "error", "message": str(error)}), status


@live_all_ulb_bp.route("/summary", methods=["GET"])
def summary():
    loader = get_loader()
    loader.start()
    return jsonify(loader.snapshot())


@live_all_ulb_bp.route("/refresh", methods=["POST"])
def refresh():
    from live_all_ulb import LOADER_ENABLED
    if not LOADER_ENABLED:
        return jsonify({"started": False, "message": "All-ULB live loading is switched off on the server (LIVE_ALL_ULB_ENABLED=0)."}), 409
    started = get_loader().request_refresh()
    return jsonify({"started": started, "message": "Refresh started." if started else "A refresh is already running."}), 202


@live_all_ulb_bp.route("/employees", methods=["GET"])
def employees():
    try:
        run_id = _run_id()
        if run_id is None:
            return jsonify({"total": 0, "items": []})
        where, params = ["run_id = ?"], [run_id]
        status = request.args.get("status")
        if status:
            if status not in ("active", "inactive", "failed", "no_beat"):
                return _error("status must be active, inactive, failed or no_beat.")
            where.append("status = ?")
            params.append(status)
        if request.args.get("ulbId"):
            where.append("ulb_id = ?")
            params.append(request.args["ulbId"])
        return jsonify(_paged(
            "live_employees", " AND ".join(where), params, "name COLLATE NOCASE, ulb_name, employee_id",
            "ulb_id AS ulbId, ulb_name AS ulbName, employee_id AS id, name, status, error",
        ))
    except StaleRunError as error:
        return _error(error, 410)
    except ValueError as error:
        return _error(error)


@live_all_ulb_bp.route("/houses", methods=["GET"])
def houses():
    try:
        category = request.args.get("category", "")
        if category not in CATEGORIES:
            return _error(f"category must be one of: {', '.join(CATEGORIES)}.")
        run_id = _run_id()
        if run_id is None:
            return jsonify({"total": 0, "items": []})
        ulb_id = request.args.get("ulbId")
        if category in COLLECTED_CATEGORIES:
            where, params = ["run_id = ?", "category = ?"], [run_id, category]
            if ulb_id:
                where.append("ulb_id = ?")
                params.append(ulb_id)
            return jsonify(_paged(
                "live_houses", " AND ".join(where), params, "ulb_name, beat_name, scanned_at DESC",
                "ulb_id AS ulbId, ulb_name AS ulbName, beat_name AS beatName, house_id AS houseId, "
                "scanned_at AS scannedAt, scanner_id AS scannerId, scanner_name AS scannerName",
            ))
        # Houses not scanned today are listed per Beat; the house-level list would be millions of rows.
        where, params = ["run_id = ?", "not_scanned_today_count > 0"], [run_id]
        if ulb_id:
            where.append("ulb_id = ?")
            params.append(ulb_id)
        return jsonify(_paged(
            "live_beats", " AND ".join(where), params, "not_scanned_today_count DESC, ulb_name",
            "ulb_id AS ulbId, ulb_name AS ulbName, beat_name AS beatName, employee_name AS employeeName, "
            "total_houses AS totalHouses, not_scanned_today_count AS notScannedToday",
        ))
    except StaleRunError as error:
        return _error(error, 410)
    except ValueError as error:
        return _error(error)
