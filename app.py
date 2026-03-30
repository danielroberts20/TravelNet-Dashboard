import json
import os
import sqlite3
import subprocess
import shutil
import psutil #type: ignore
from datetime import datetime, timezone
from functools import wraps

import requests
from flask import ( #type: ignore
    Flask, render_template, request, redirect, make_response,
    url_for, session, flash, jsonify, Response, stream_with_context
)

import logging
import re

class SilenceGetRequests(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return not ('" 200' in msg)

logging.getLogger("gunicorn.access").addFilter(SilenceGetRequests())

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "change-me-in-production")

ANSI_ESCAPE = re.compile(r'\x1b\[[0-9;]*m')


# ── Config ────────────────────────────────────────────────────────────────────
DASHBOARD_TOKEN    = os.environ.get("DASHBOARD_TOKEN", "")
COOKIE_NAME        = "tn_auth"
COOKIE_MAX_AGE     = 60 * 60 * 24 * 365  # 1 year
DB_PATH            = os.environ.get("DB_PATH", "/data/travel.db")
FASTAPI_URL        = os.environ.get("FASTAPI_URL", "http://fastapi:8000")
FASTAPI_API_KEY    = os.environ.get("FASTAPI_API_KEY", "")
DOCKER_CONTAINER   = os.environ.get("DOCKER_CONTAINER_NAME", "travelnet-api")

# Tables that can be reset from the dashboard (safelist)
RESETTABLE_TABLES = [
    "transactions",
    "fx_rates",
    "api_usage",
    "log_digest",
    "health_data",
    "health_sources",
    "workouts",
    "workout_route",
    "jobs",
    "cellular_state",
    "weather_hourly",
    "weather_daily",
    "known_locations",
    "gap_annotations",
    "state_of_mind",
    "trigger_log",
]

@app.route("/manifest.json")
def manifest():
    data = {
        "name": "TravelNet",
        "short_name": "TravelNet",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0d0f14",
        "theme_color": "#0d0f14",
        "icons": [
            {
                "src": "/static/icon.png",
                "sizes": "180x180",
                "type": "image/png"
            }
        ]
    }
    resp = make_response(json.dumps(data))
    resp.headers["Content-Type"] = "application/manifest+json"
    return resp

# ── Auth ──────────────────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.cookies.get(COOKIE_NAME) != DASHBOARD_TOKEN:
            return redirect(url_for("login", next=request.url))
        return f(*args, **kwargs)
    return decorated

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if request.form.get("token") == DASHBOARD_TOKEN:
            resp = redirect(request.args.get("next") or url_for("index"))
            resp.set_cookie(
                COOKIE_NAME,
                DASHBOARD_TOKEN,
                max_age=COOKIE_MAX_AGE,
                httponly=True,
                samesite="Lax",
                secure=True,
            )
            return resp
        flash("Incorrect token.", "error")
    return render_template("login.html")

@app.route("/logout")
def logout():
    resp = redirect(url_for("login"))
    resp.delete_cookie(COOKIE_NAME)
    return resp

# ── Helpers ───────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def fastapi_headers():
    h = {"Content-Type": "application/json"}
    if FASTAPI_API_KEY:
        h["Authorization"] = f"Bearer {FASTAPI_API_KEY}"
    return h

def table_exists(conn, name):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
@login_required
def index():
    # System health
    disk  = shutil.disk_usage("/data")
    cpu = psutil.cpu_percent(interval=None)
    ram   = psutil.virtual_memory()
    temps = {}
    try:
        for name, entries in psutil.sensors_temperatures().items():
            for e in entries:
                temps[e.label or name] = e.current
    except Exception:
        pass

    health = {
        "disk_used_gb":  round(disk.used  / 1e9, 2),
        "disk_total_gb": round(disk.total / 1e9, 2),
        "disk_pct":      round(disk.used / disk.total * 100, 1),
        "cpu_pct":       cpu,
        "ram_used_gb":   round(ram.used  / 1e9, 2),
        "ram_total_gb":  round(ram.total / 1e9, 2),
        "ram_pct":       ram.percent,
        "temps":         temps,
    }

    # DB table stats
    tables = []
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        for r in rows:
            tname = r["name"]
            count = conn.execute(f"SELECT COUNT(*) FROM [{tname}]").fetchone()[0]
            tables.append({"name": tname, "count": count, "resettable": tname in RESETTABLE_TABLES})
        conn.close()
    except Exception as e:
        flash(f"DB error: {e}", "error")

    # API usage — fetch both services
    api_usage = {}
    try:
        conn = get_db()
        if table_exists(conn, "api_usage"):
            for service in ["exchangerate.host", "open-meteo"]:
                row = conn.execute(
                    "SELECT * FROM api_usage WHERE service = ? ORDER BY month DESC LIMIT 1",
                    (service,)
                ).fetchone()
                if row:
                    api_usage[service] = dict(row)
        conn.close()
    except Exception:
        pass

    # Recent log_digest entries
    recent_logs = []
    try:
        conn = get_db()
        if table_exists(conn, "log_digest"):
            rows = conn.execute(
                "SELECT * FROM log_digest ORDER BY rowid DESC LIMIT 20"
            ).fetchall()
            recent_logs = [dict(r) for r in rows]
        conn.close()
    except Exception:
        pass

    return render_template("index.html",
                           health=health,
                           tables=tables,
                           api_usage=api_usage,
                           recent_logs=recent_logs,
                           now=datetime.now(timezone.utc))


# ── DB section ────────────────────────────────────────────────────────────────

@app.route("/db")
@login_required
def db_view():
    return render_template("db.html")

@app.route("/api/db/meta")
@login_required
def db_meta_proxy():
    tables = {"tables": []}
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name"
        ).fetchall()
        for r in rows:
            tname = r["name"]
            ttype = r["type"]
            cols = [c[1] for c in conn.execute(f"PRAGMA table_info([{tname}])").fetchall()]
            tables["tables"].append({
                "name":       tname,
                "type":       ttype,
                "cols":       cols,
                "resettable": tname in RESETTABLE_TABLES,
            })
        conn.close()
    except Exception as e:
        flash(f"DB error: {e}", "error")
    return jsonify(tables)

@app.route("/api/db/count")
@login_required
def db_tables_counts():
    def generate():
        try:
            conn = get_db()
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name"
            ).fetchall()
            for r in rows:
                tname = r["name"]
                count = conn.execute(f"SELECT COUNT(*) FROM [{tname}]").fetchone()[0]
                yield f"data: {json.dumps({'name': tname, 'count': count})}\n\n"
            conn.close()
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# Old DB code
"""@app.route("/db")
@login_required
def db_view():
    tables = []
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name"
        ).fetchall()
        for r in rows:
            tname = r["name"]
            ttype = r["type"]
            count = conn.execute(f"SELECT COUNT(*) FROM [{tname}]").fetchone()[0]
            cols  = [c[1] for c in conn.execute(f"PRAGMA table_info([{tname}])").fetchall()]
            tables.append({
                "name":       tname,
                "type":       ttype,
                "count":      count,
                "cols":       cols,
                "resettable": tname in RESETTABLE_TABLES,
            })
        conn.close()
    except Exception as e:
        flash(f"DB error: {e}", "error")
    return render_template("db.html", tables=tables)"""


@app.route("/db/table/<table>")
@login_required
def db_table(table):
    # Validate table exists in the DB (prevent arbitrary SQL injection via URL)
    try:
        conn = get_db()
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?", (table,)
        ).fetchone()
        if not exists:
            flash(f"Table '{table}' not found.", "error")
            return redirect(url_for("db_view"))

        pragma_rows = conn.execute(f"PRAGMA table_info([{table}])").fetchall()
        if pragma_rows:
            columns = [
                {
                    "cid":     r["cid"],
                    "name":    r["name"],
                    "type":    r["type"] or "—",
                    "notnull": bool(r["notnull"]),
                    "default": r["dflt_value"],
                    "pk":      bool(r["pk"]),
                }
                for r in pragma_rows
            ]
        else:
            # View — infer columns from first row
            sample = conn.execute(f"SELECT * FROM [{table}] LIMIT 1").fetchone()
            columns = [
                {"cid": i, "name": k, "type": "—", "notnull": False, "default": None, "pk": False}
                for i, k in enumerate(sample.keys())
            ] if sample else []

        total = conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]

        page      = max(1, int(request.args.get("page", 1)))
        page_size = int(request.args.get("page_size", 50))
        page_size = max(10, min(page_size, 500))
        order     = request.args.get("order", "rowid")
        direction = request.args.get("dir", "desc").lower()
        if direction not in ("asc", "desc"):
            direction = "desc"

        # Validate order column is a real column name
        col_names = [c["name"] for c in columns]
        if order not in col_names and order != "rowid":
            order = "rowid"

        offset = (page - 1) * page_size
        rows = conn.execute(
            f"SELECT * FROM [{table}] ORDER BY [{order}] {direction.upper()} LIMIT ? OFFSET ?",
            (page_size, offset)
        ).fetchall()
        rows = [list(r) for r in rows]

        total_pages = max(1, -(-total // page_size))  # ceiling division
        conn.close()
    except Exception as e:
        flash(f"DB error: {e}", "error")
        return redirect(url_for("db_view"))

    return render_template(
        "db_table.html",
        table=table,
        columns=columns,
        rows=rows,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        order=order,
        direction=direction,
        resettable=table in RESETTABLE_TABLES,
    )


@app.route("/db/reset/<table>", methods=["POST"])
@login_required
def db_reset(table):
    if table not in RESETTABLE_TABLES:
        flash(f"Table '{table}' is not in the reset safelist.", "error")
        return redirect(url_for("db_table", table=table))
    confirm = request.form.get("confirm_table")
    if confirm != table:
        flash("Confirmation name did not match. Table not reset.", "error")
        return redirect(url_for("db_table", table=table))
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/database/reset",
            headers=fastapi_headers(),
            params={"table": table},
            timeout=10,
        )
        if resp.ok:
            flash(f"Table '{table}' cleared successfully.", "success")
        else:
            flash(f"Reset failed: {resp.status_code} {resp.text}", "error")
    except Exception as e:
        flash(f"Reset failed: {e}", "error")
    return redirect(url_for("db_table", table=table))

@app.route("/db/table/<table>/download")
@login_required
def db_table_download(table):
    import csv
    import io
    try:
        conn = get_db()
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?", (table,)
        ).fetchone()
        if not exists:
            flash(f"Table '{table}' not found.", "error")
            return redirect(url_for("db_view"))

        cursor = conn.execute(f"SELECT * FROM [{table}]")
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        conn.close()

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(cols)
        writer.writerows(rows)
        buf.seek(0)

        return Response(
            buf.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={table}.csv"}
        )
    except Exception as e:
        flash(f"Download failed: {e}", "error")
        return redirect(url_for("db_table", table=table))

@app.route("/db/download")
@login_required
def db_download():
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/database/download",
            headers=fastapi_headers(),
            stream=True,
            timeout=30,
        )
        if not resp.ok:
            flash(f"Download failed: {resp.status_code} {resp.text}", "error")
            return redirect(url_for("db_view"))

        filename = resp.headers.get("content-disposition", "").split("filename=")[-1] or "travel.db"
        return Response(
            resp.iter_content(chunk_size=8192),
            content_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        flash(f"Download failed: {e}", "error")
        return redirect(url_for("db_view"))


# ── Cron status ───────────────────────────────────────────────────────────────

@app.route("/crons")
@login_required
def crons():
    # Read cron status from log_digest table, grouped by job name
    jobs = []
    try:
        conn = get_db()
        if table_exists(conn, "log_digest"):
            rows = conn.execute("""
                SELECT * FROM log_digest
                ORDER BY rowid DESC
            """).fetchall()
            jobs = [dict(r) for r in rows]
        conn.close()
    except Exception as e:
        flash(f"DB error: {e}", "error")

    # Also read api_usage
    api_usage = {}
    try:
        conn = get_db()
        if table_exists(conn, "api_usage"):
            for service in ["exchangerate.host", "open-meteo"]:
                row = conn.execute(
                    "SELECT * FROM api_usage WHERE service = ? ORDER BY month DESC LIMIT 1",
                    (service,)
                ).fetchone()
                if row:
                    api_usage[service] = dict(row)
        conn.close()
    except Exception:
        pass

    return render_template("crons.html", jobs=jobs, api_usage=api_usage)


# ── Logs ──────────────────────────────────────────────────────────────────────

@app.route("/logs")
@login_required
def logs():
    lines = 200
    try:
        lines = int(request.args.get("lines", 200))
    except ValueError:
        pass
    return render_template("logs.html", container=DOCKER_CONTAINER, lines=lines)


@app.route("/logs/stream")
@login_required
def logs_stream():
    """SSE endpoint: streams docker logs tail then follows."""
    lines = request.args.get("lines", 200)
    container = DOCKER_CONTAINER

    def generate():
        cmd = ["docker", "logs", "--tail", str(lines), "--follow", container]
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in proc.stdout:
                line = line.rstrip()
                # Strip Docker timestamp prefix (e.g. "2026-03-21T13:42:06.991790564Z ")
                if 'T' in line and line[10] == 'T' and 'Z' in line[:35]:
                    line = line[line.index('Z') + 2:]
                # Strip ANSI colour codes
                line = ANSI_ESCAPE.sub('', line)
                yield f"data: {line}\n\n"
            proc.wait()
        except Exception as e:
            yield f"data: [ERROR] {e}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Upload ────────────────────────────────────────────────────────────────────

@app.route("/upload")
@login_required
def upload():
    return render_template("upload.html", fastapi_url=FASTAPI_URL)


@app.route("/upload/revolut", methods=["POST"])
@login_required
def upload_revolut():
    f = request.files.get("file")
    if not f:
        flash("No file selected.", "error")
        return redirect(url_for("upload"))
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/transactions/revolut",
            files={"file": (f.filename, f.stream, f.content_type)},
            headers={k: v for k, v in fastapi_headers().items() if k != "Content-Type"},
            timeout=30,
        )
        if resp.ok:
            flash(f"Revolut upload successful: {resp.json()}", "success")
        else:
            flash(f"FastAPI error {resp.status_code}: {resp.text}", "error")
    except Exception as e:
        flash(f"Upload failed: {e}", "error")
    return redirect(url_for("upload"))


@app.route("/upload/wise", methods=["POST"])
@login_required
def upload_wise():
    f = request.files.get("file")
    if not f:
        flash("No file selected.", "error")
        return redirect(url_for("upload"))
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/transactions/wise",
            files={"file": (f.filename, f.stream, f.content_type)},
            headers={k: v for k, v in fastapi_headers().items() if k != "Content-Type"},
            timeout=30,
        )
        if resp.ok:
            flash(f"Wise upload successful: {resp.json()}", "success")
        else:
            flash(f"FastAPI error {resp.status_code}: {resp.text}", "error")
    except Exception as e:
        flash(f"Upload failed: {e}", "error")
    return redirect(url_for("upload"))


# ── API health proxy ──────────────────────────────────────────────────────────

@app.route("/api/fastapi-health")
@login_required
def fastapi_health():
    try:
        resp = requests.get(f"{FASTAPI_URL}/health", headers=fastapi_headers(), timeout=5)
        return jsonify({"status": "ok", "code": resp.status_code, "body": resp.json()})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 503


# ── Location map ──────────────────────────────────────────────────────────────

@app.route("/location")
@login_required
def location():
    return render_template("location.html")


@app.route("/api/location-points")
@login_required
def location_points():
    """Return 48h window of deduplicated points from location_unified view.

    Optional query param: end_date=YYYY-MM-DD (defaults to now).
    Window is always 48 hours ending at end of the specified date.

    Dedup rules:
      - Overland preferred when a Shortcuts point is within 60s and ~1km
      - Both kept if locations differ significantly (genuine divergence)
    """
    end_date_str = request.args.get("end_date")
    try:
        if end_date_str:
            end_dt = datetime.strptime(end_date_str, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        else:
            end_dt = datetime.now(timezone.utc)
    except ValueError:
        return jsonify({"error": f"Invalid date format: {end_date_str}, use YYYY-MM-DD"}), 400

    until = int(end_dt.timestamp())
    since = until - 172800  # 48 hours

    try:
        conn = get_db()

        # Check view exists — fall back gracefully if migration hasn't run yet
        view_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='view' AND name='location_unified'"
        ).fetchone()

        if view_exists:
            rows = conn.execute("""
                SELECT timestamp, lat, lon, altitude, activity,
                       battery, speed, device, accuracy, source
                FROM location_unified
                WHERE datetime(timestamp) >= datetime(?, 'unixepoch')
                  AND datetime(timestamp) <= datetime(?, 'unixepoch')
                ORDER BY timestamp ASC
            """, (since, until)).fetchall()
            points = [dict(r) for r in rows]
            points = _dedup_location(points)
        else:
            # View not yet created — fall back to querying tables directly
            points = _query_tables_directly(conn, since, until)

        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Split back into sources for the map (different colours)
    overland  = [
        {"lat": p["lat"], "lon": p["lon"], "ts": p["timestamp"],
         "activity": p["activity"], "battery": p["battery"], "speed": p["speed"]}
        for p in points if p["source"] == "overland"
    ]
    shortcuts = [
        {"lat": p["lat"], "lon": p["lon"], "ts": p["timestamp"],
         "activity": p["activity"], "battery": p["battery"], "device": p.get("device")}
        for p in points if p["source"] == "shortcuts"
    ]

    return jsonify({
        "overland":  overland,
        "shortcuts": shortcuts,
        "since":     since,
        "until":     until,
        "end_date":  end_date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    })


def _ts_to_epoch(ts) -> float:
    """Convert ISO 8601 string or Unix int/float to epoch seconds."""
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        from datetime import datetime as dt
        d = dt.fromisoformat(ts.replace("Z", "+00:00"))
        return d.timestamp()
    except Exception:
        return 0.0


def _dedup_location(points: list, time_window: int = 60, dist_threshold: float = 0.01) -> list:
    """Drop Shortcuts points that are within time_window seconds and
    dist_threshold degrees of an Overland point. Keep both if far apart."""
    import math

    overland  = [p for p in points if p["source"] == "overland"]
    shortcuts = [p for p in points if p["source"] == "shortcuts"]

    overland_ts = [_ts_to_epoch(p["timestamp"]) for p in overland]

    kept_shortcuts = []
    for pt in shortcuts:
        pt_ts   = _ts_to_epoch(pt["timestamp"])
        matched = False
        for i, ots in enumerate(overland_ts):
            if abs(pt_ts - ots) <= time_window:
                op   = overland[i]
                dist = math.sqrt((pt["lat"] - op["lat"]) ** 2 + (pt["lon"] - op["lon"]) ** 2)
                if dist <= dist_threshold:
                    matched = True
                    break
        if not matched:
            kept_shortcuts.append(pt)

    merged = overland + kept_shortcuts
    merged.sort(key=lambda p: p["timestamp"])
    return merged


def _query_tables_directly(conn, since: int, until: int) -> list:
    """Fallback: query the two tables directly if the unified view doesn't exist yet."""
    points = []
    if table_exists(conn, "location_overland"):
        rows = conn.execute("""
            SELECT timestamp, lat, lon, altitude, activity,
                   battery_level AS battery, speed, device_id AS device,
                   horizontal_accuracy AS accuracy
            FROM location_overland
            WHERE datetime(timestamp) >= datetime(?, 'unixepoch')
              AND datetime(timestamp) <= datetime(?, 'unixepoch')
            ORDER BY timestamp ASC
        """, (since, until)).fetchall()
        points += [{**dict(r), "source": "overland"} for r in rows]

    if table_exists(conn, "location_shortcuts"):
        rows = conn.execute("""
            SELECT datetime(timestamp, 'unixepoch') AS timestamp,
                   latitude AS lat, longitude AS lon, altitude,
                   activity, CAST(battery AS REAL) / 100.0 AS battery,
                   NULL AS speed, device, NULL AS accuracy
            FROM location_shortcuts
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        """, (since, until)).fetchall()
        points += [{**dict(r), "source": "shortcuts"} for r in rows]

    points.sort(key=lambda p: p["timestamp"])
    return _dedup_location(points)


# ── Cron runs ─────────────────────────────────────────────────────────────────

CRON_RUNS_PATH = os.environ.get("CRON_RUNS_PATH", "/data/cron_runs.json")

@app.route("/api/cron-runs")
@login_required
def cron_runs_api():
    import json
    try:
        with open(CRON_RUNS_PATH) as f:
            data = json.load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Config ────────────────────────────────────────────────────────────────────

@app.route("/config")
@login_required
def config_page():
    return render_template("config.html")


@app.route("/api/config", methods=["GET"])
@login_required
def config_get():
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/metadata/config",
            headers=fastapi_headers(),
            timeout=5,
        )
        if resp.ok:
            return jsonify(resp.json())
        return jsonify({"error": f"FastAPI returned {resp.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/api/config", methods=["POST"])
@login_required
def config_post():
    data = request.get_json()
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/metadata/config",
            headers=fastapi_headers(),
            json=data,
            timeout=5,
        )
        if resp.ok:
            return jsonify(resp.json())
        return jsonify({"error": resp.text}), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/api/config/<key>", methods=["DELETE"])
@login_required
def config_delete(key):
    try:
        resp = requests.delete(
            f"{FASTAPI_URL}/metadata/config/{key}",
            headers=fastapi_headers(),
            timeout=5,
        )
        if resp.ok:
            return jsonify(resp.json())
        return jsonify({"error": resp.text}), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/api/restart", methods=["POST"])
@login_required
def restart_server():
    RESTARTABLE = {DOCKER_CONTAINER, "travelnet-dashboard"}
    data = request.get_json(silent=True) or {}
    container = data.get("container", DOCKER_CONTAINER)
    if container not in RESTARTABLE:
        return jsonify({"error": f"Container '{container}' is not restartable"}), 400
    try:
        subprocess.Popen(["docker", "restart", container])
        return jsonify({"message": f"Restarting {container}…"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Status proxy ──────────────────────────────────────────────────────────────

@app.route("/api/status")
@login_required
def status_proxy():
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/metadata/status",
            headers=fastapi_headers(),
            timeout=5,
        )
        if resp.ok:
            return jsonify(resp.json())
        return jsonify({"error": f"FastAPI returned {resp.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


# ── Backups ───────────────────────────────────────────────────────────────────

@app.route("/backups")
@login_required
def backups_page():
    return render_template("backups.html")


@app.route("/api/backups")
@login_required
def backups_proxy():
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/metadata/backups",
            headers=fastapi_headers(),
            timeout=20,  # rclone can be slow
        )
        if resp.ok:
            return jsonify(resp.json())
        return jsonify({"error": f"FastAPI returned {resp.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
