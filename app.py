import json
import os
import sqlite3
import subprocess
import shutil
import psutil #type: ignore
from zoneinfo import ZoneInfo
from datetime import datetime, timedelta, timezone
from functools import wraps

import requests
from flask import ( #type: ignore
    Flask, render_template, request, redirect, make_response,
    url_for, session, flash, jsonify, Response, stream_with_context,
    send_from_directory, abort
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
TREVOR_CONTAINER   = os.environ.get("TREVOR_CONTAINER_NAME", "trevor")
TREVOR_URL         = os.environ.get("TREVOR_URL", "http://trevor:8300")
TREVOR_API_KEY     = os.environ.get("TREVOR_API_KEY", "")
PREFECT_API_URL    = os.environ.get("PREFECT_API_URL", "http://pi-server.tail186ff8.ts.net:4200/api")


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
    "known_places",
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
            # API routes return 401 JSON; the SPA handles the redirect to /login
            if request.path.startswith("/api/") or request.path.startswith("/logs/stream"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

@app.route("/login", methods=["POST"])
def login():
    token = (request.get_json(silent=True) or {}).get("token") or request.form.get("token")
    if token == DASHBOARD_TOKEN:
        resp = make_response(jsonify({"ok": True}))
        resp.set_cookie(
            COOKIE_NAME,
            DASHBOARD_TOKEN,
            max_age=COOKIE_MAX_AGE,
            httponly=True,
            samesite="Lax",
            secure=True,
        )
        return resp
    return jsonify({"error": "Invalid token"}), 401

@app.route("/logout")
def logout():
    resp = redirect("/")
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

# ── Static assets (Vite build outputs to /assets/) ────────────────────────────
@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory("static/dist/assets", filename)

# ── SPA catch-all ─────────────────────────────────────────────────────────────
# Serves the React build for any URL not matched by an explicit Flask route.
# This means Flask still handles /api/*, /assets/*, /login, /logout, etc.,
# and React Router handles client-side navigation for everything else.

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    return send_from_directory("static/dist", "index.html")


# ── Routes ────────────────────────────────────────────────────────────────────



@app.route("/api/overview")
@login_required
def overview_api():
    """JSON equivalent of the index() template context — used by the React Overview page."""
    disk = shutil.disk_usage("/data")
    cpu  = psutil.cpu_percent(interval=None)
    ram  = psutil.virtual_memory()
    temps = {}
    try:
        for name, entries in psutil.sensors_temperatures().items():
            for e in entries:
                temps[e.label or name] = round(e.current, 1)
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

    tables = []
    api_usage = {}
    recent_logs = []
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        for r in rows:
            tname = r["name"]
            count = conn.execute(f"SELECT COUNT(*) FROM [{tname}]").fetchone()[0]
            tables.append({"name": tname, "count": count, "resettable": tname in RESETTABLE_TABLES})

        if table_exists(conn, "api_usage"):
            for service in ["exchangerate.host", "open-meteo"]:
                row = conn.execute(
                    "SELECT * FROM api_usage WHERE service = ? ORDER BY month DESC LIMIT 1",
                    (service,)
                ).fetchone()
                if row:
                    api_usage[service] = dict(row)

        if table_exists(conn, "log_digest"):
            rows = conn.execute(
                "SELECT * FROM log_digest ORDER BY rowid DESC LIMIT 20"
            ).fetchall()
            recent_logs = [dict(r) for r in rows]

        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "health":      health,
        "tables":      tables,
        "api_usage":   api_usage,
        "recent_logs": recent_logs,
        "now":         datetime.now(timezone.utc).isoformat(),
    })


# ── DB section ────────────────────────────────────────────────────────────────


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




@app.route("/api/db/table/<table>")
@login_required
def db_table_api(table):
    """JSON equivalent of db_table() — used by the React DatabaseTable page."""
    try:
        conn = get_db()
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?", (table,)
        ).fetchone()
        if not exists:
            return jsonify({"error": f"Table '{table}' not found"}), 404

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
            sample = conn.execute(f"SELECT * FROM [{table}] LIMIT 1").fetchone()
            columns = [
                {"cid": i, "name": k, "type": "—", "notnull": False, "default": None, "pk": False}
                for i, k in enumerate(sample.keys())
            ] if sample else []

        total     = conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
        page      = max(1, int(request.args.get("page", 1)))
        page_size = int(request.args.get("page_size", 50))
        page_size = max(10, min(page_size, 500))
        order     = request.args.get("order", "rowid")
        direction = request.args.get("dir", "desc").lower()
        if direction not in ("asc", "desc"):
            direction = "desc"

        col_names = [c["name"] for c in columns]
        if order not in col_names and order != "rowid":
            order = "rowid"

        offset = (page - 1) * page_size
        rows = conn.execute(
            f"SELECT * FROM [{table}] ORDER BY [{order}] {direction.upper()} LIMIT ? OFFSET ?",
            (page_size, offset)
        ).fetchall()
        rows = [list(r) for r in rows]

        total_pages = max(1, -(-total // page_size))
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "table":       table,
        "columns":     columns,
        "rows":        rows,
        "total":       total,
        "page":        page,
        "page_size":   page_size,
        "total_pages": total_pages,
        "order":       order,
        "direction":   direction,
        "resettable":  table in RESETTABLE_TABLES,
    })


@app.route("/api/db/reset/<table>", methods=["POST"])
@login_required
def db_reset_api(table):
    """JSON version of db_reset() — used by the React DatabaseTable page."""
    if table not in RESETTABLE_TABLES:
        return jsonify({"error": f"Table '{table}' is not in the reset safelist"}), 400
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/database/reset",
            headers=fastapi_headers(),
            params={"table": table},
            timeout=10,
        )
        if resp.ok:
            return jsonify({"ok": True, "message": f"Table '{table}' cleared successfully"})
        return jsonify({"error": f"Reset failed: {resp.status_code} {resp.text}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503



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


# ── DB pruning ────────────────────────────────────────────────────────────────

@app.route("/api/db/prune/tables")
@login_required
def prune_tables_proxy():
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/database/prune/tables",
            headers=fastapi_headers(),
            timeout=5,
        )
        return (resp.content, resp.status_code, {"Content-Type": "application/json"})
    except Exception as e:
        return jsonify({"error": str(e)}), 503

@app.route("/api/db/prune/preview", methods=["POST"])
@login_required
def prune_preview_proxy():
    data = request.get_json(silent=True) or {}
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/database/prune/preview",
            headers=fastapi_headers(),
            json=data,
            timeout=30,
        )
        result = resp.json()
        if resp.ok and "counts" in result:
            # Enrich with current total row counts so the UI can show rows remaining.
            # Cascade-only tables have no direct timestamp column so we skip them.
            totals = {}
            _cascade_only = {"mood_labels", "mood_associations"}
            try:
                conn = get_db()
                for table in result["counts"]:
                    if table not in _cascade_only:
                        row = conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()
                        totals[table] = row[0] if row else 0
                conn.close()
            except Exception:
                pass
            result["totals"] = totals
        return (json.dumps(result), resp.status_code, {"Content-Type": "application/json"})
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/api/db/prune/execute", methods=["POST"])
@login_required
def prune_execute_proxy():
    data = request.get_json(silent=True) or {}
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/database/prune/execute",
            headers=fastapi_headers(),
            json=data,
            timeout=60,
        )
        return (resp.content, resp.status_code, {"Content-Type": "application/json"})
    except Exception as e:
        return jsonify({"error": str(e)}), 503


# ── Schedule / Prefect ────────────────────────────────────────────────────────

try:
    from croniter import croniter as _croniter
    _HAS_CRONITER = True
except ImportError:
    _HAS_CRONITER = False

_ORDINALS = {
    1:'1st', 2:'2nd', 3:'3rd', 4:'4th', 5:'5th', 6:'6th', 7:'7th', 8:'8th',
    9:'9th', 10:'10th', 11:'11th', 12:'12th', 13:'13th', 14:'14th', 15:'15th',
    16:'16th', 17:'17th', 18:'18th', 19:'19th', 20:'20th', 21:'21st', 22:'22nd',
    23:'23rd', 24:'24th', 25:'25th', 26:'26th', 27:'27th', 28:'28th',
    29:'29th', 30:'30th', 31:'31st',
}
_DOW_NAMES = {0:'Sunday', 1:'Monday', 2:'Tuesday', 3:'Wednesday',
              4:'Thursday', 5:'Friday', 6:'Saturday'}


def _humanize_cron(expr: str) -> str:
    """Convert a 5-field cron expression to a human-readable string."""
    try:
        parts = expr.strip().split()
        if len(parts) != 5:
            return expr
        minute, hour, dom, month, dow = parts

        # Every N hours: "0 */4 * * *"
        if '/' in hour:
            n = hour.split('/')[1]
            if n.isdigit():
                return f"Every {n} hours"
            return expr

        if not (minute.isdigit() and hour.isdigit()):
            return expr
        time_str = f"{int(hour):02d}:{int(minute):02d}"

        # Daily: "0 2 * * *"
        if dom == '*' and month == '*' and dow == '*':
            return f"Daily at {time_str}"

        # Specific weekday: "0 1 * * 0"
        if dom == '*' and month == '*' and dow != '*' and dow.isdigit():
            name = _DOW_NAMES.get(int(dow), f'Weekday {dow}')
            return f"{name}s at {time_str}"

        # Day(s) of month: "0 3 2,16 * *" or "0 0 1 * *"
        if dom != '*' and month == '*' and dow == '*':
            days = [int(d) for d in dom.split(',') if d.isdigit()]
            if not days:
                return expr
            day_strs = [_ORDINALS.get(d, f'{d}th') for d in days]
            if len(day_strs) == 1:
                return f"{day_strs[0]} of month at {time_str}"
            if len(day_strs) == 2:
                return f"{day_strs[0]} & {day_strs[1]} at {time_str}"
            return ', '.join(day_strs[:-1]) + f' & {day_strs[-1]} at {time_str}'

        return expr
    except Exception:
        return expr


def _cron_is_daily(expr: str) -> bool:
    """True for crons that fire exactly once per day (e.g. '0 2 * * *')."""
    try:
        parts = expr.strip().split()
        _, hour, dom, month, dow = parts
        return dom == '*' and month == '*' and dow == '*' and '/' not in hour
    except Exception:
        return False


def _cron_next_run(expr: str, tz_name: str) -> float | None:
    """Return the next scheduled run as a Unix timestamp, or None."""
    if not _HAS_CRONITER:
        return None
    try:
        tz  = ZoneInfo(tz_name)
        now = datetime.now(tz)
        it  = _croniter(expr, now)
        return it.get_next(datetime).timestamp()
    except Exception:
        return None


def _fmt_duration(secs: float) -> str:
    s = int(secs)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}h {m}m {sec}s"
    if m:
        return f"{m}m {sec}s"
    return f"{sec}s"


def _format_prefect_run(run: dict, tz_name: str) -> dict:
    """Format a Prefect flow run for the dashboard. Times in the flow's scheduled timezone."""
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    def fmt_dt(iso_str):
        if not iso_str:
            return None
        try:
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
            return dt.astimezone(tz).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return iso_str

    state      = run.get("state") or {}
    total_secs = run.get("total_run_time")
    start_iso  = run.get("start_time")
    return {
        "flow_run_id":    run.get("id"),
        "state_type":     state.get("type"),
        "state_name":     state.get("name"),
        "start_time":     fmt_dt(start_iso),
        "start_time_iso": start_iso,
        "duration_human": _fmt_duration(total_secs) if total_secs else None,
    }


@app.route("/api/crons")
@login_required
def crons_api():
    """Log digest and API usage — used by the React Schedule page."""
    jobs = []
    api_usage = {}
    try:
        conn = get_db()
        if table_exists(conn, "log_digest"):
            rows = conn.execute("SELECT * FROM log_digest ORDER BY rowid DESC").fetchall()
            jobs = [dict(r) for r in rows]
        if table_exists(conn, "api_usage"):
            for service in ["exchangerate.host", "open-meteo"]:
                row = conn.execute(
                    "SELECT * FROM api_usage WHERE service = ? ORDER BY month DESC LIMIT 1",
                    (service,)
                ).fetchone()
                if row:
                    api_usage[service] = dict(row)
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"jobs": jobs, "api_usage": api_usage})


@app.route("/api/prefect/deployments")
@login_required
def prefect_deployments():
    """Proxy Prefect deployment list with last-run status for the Schedule page."""
    try:
        deps_resp = requests.post(
            f"{PREFECT_API_URL}/deployments/filter",
            json={"limit": 200, "offset": 0},
            timeout=10,
        )
        deps_resp.raise_for_status()
        deployments = deps_resp.json()

        if not deployments:
            return jsonify([])

        dep_ids = [d["id"] for d in deployments]

        runs_resp = requests.post(
            f"{PREFECT_API_URL}/flow_runs/filter",
            json={
                "limit": 200,
                "sort": "START_TIME_DESC",
                "flow_runs": {
                    "deployment_id": {"any_": dep_ids},
                    # Exclude pre-created cron runs (null start_time) so they
                    # don't shadow PENDING/RUNNING/COMPLETED runs as last_run.
                    "state": {"type": {"not_any_": ["SCHEDULED"]}},
                },
            },
            timeout=10,
        )
        runs_resp.raise_for_status()

        # Keep most recent run per deployment (already sorted desc)
        last_run_by_dep: dict = {}
        for run in runs_resp.json():
            dep_id = run.get("deployment_id")
            if dep_id and dep_id not in last_run_by_dep:
                last_run_by_dep[dep_id] = run

        result = []
        for dep in sorted(deployments, key=lambda d: (d.get("name") or "").lower()):
            # Prefect 3.x uses a `schedules` list; fall back to legacy `schedule` dict
            schedules    = dep.get("schedules") or []
            active_sched = next((s for s in schedules if s.get("active")), None)
            sched_inner  = (active_sched or {}).get("schedule") or dep.get("schedule") or {}
            cron_expr    = sched_inner.get("cron")
            tz_name      = sched_inner.get("timezone", "UTC") if cron_expr else "UTC"

            schedule_data = {
                "cron":          cron_expr,
                "label":         _humanize_cron(cron_expr) if cron_expr else None,
                "timezone":      tz_name,
                "is_daily":      _cron_is_daily(cron_expr) if cron_expr else False,
                "next_run_epoch": _cron_next_run(cron_expr, tz_name) if cron_expr else None,
            } if cron_expr else None

            last_run = last_run_by_dep.get(dep["id"])

            result.append({
                "id":          dep["id"],
                "name":        dep.get("name") or "",
                "flow_name":   dep.get("flow_name") or "",
                "description": dep.get("description") or "",
                "paused":      dep.get("paused", False) or dep.get("status") == "PAUSED",
                "notifies":    "notifies" in dep.get("tags", []),
                "schedule":    schedule_data,
                "last_run":    _format_prefect_run(last_run, tz_name) if last_run else None,
            })

        return jsonify(result)
    except requests.HTTPError as e:
        return jsonify({"error": f"Prefect API error {e.response.status_code}"}), 502
    except requests.RequestException as e:
        return jsonify({"error": f"Prefect unreachable: {e}"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/prefect/run/<deployment_id>", methods=["POST"])
@login_required
def prefect_trigger_run(deployment_id):
    """Trigger an ad-hoc Prefect deployment run."""
    try:
        resp = requests.post(
            f"{PREFECT_API_URL}/deployments/{deployment_id}/create_flow_run",
            json={},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return jsonify({"ok": True, "flow_run_id": data.get("id"), "name": data.get("name")})
    except requests.HTTPError as e:
        return jsonify({"error": f"Prefect returned {e.response.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/api/prefect/flow-run/<flow_run_id>")
@login_required
def prefect_flow_run_status(flow_run_id):
    """Poll the state of a single Prefect flow run."""
    try:
        resp = requests.get(
            f"{PREFECT_API_URL}/flow_runs/{flow_run_id}",
            timeout=10,
        )
        resp.raise_for_status()
        run = resp.json()
        return jsonify({"id": run.get("id"), "state": run.get("state")})
    except requests.HTTPError as e:
        return jsonify({"error": f"Prefect error {e.response.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


# ── Logs ──────────────────────────────────────────────────────────────────────



@app.route("/api/logs/config")
@login_required
def logs_config():
    """Provides container names and defaults for the React Logs page."""
    return jsonify({
        "container":        DOCKER_CONTAINER,
        "trevor_container": TREVOR_CONTAINER,
        "default_lines":    200,
    })


@app.route("/logs/stream")
@login_required
def logs_stream():
    """SSE endpoint: streams docker logs tail then follows."""
    lines = request.args.get("lines", 200)
    # Validate container against allowlist to prevent arbitrary command injection
    requested = request.args.get("container", DOCKER_CONTAINER)
    if requested not in {DOCKER_CONTAINER, TREVOR_CONTAINER}:
        requested = DOCKER_CONTAINER
    container = requested

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



@app.route("/upload/revolut", methods=["POST"])
@login_required
def upload_revolut():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file selected"}), 400
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/transactions/revolut",
            files={"file": (f.filename, f.stream, f.content_type)},
            headers={k: v for k, v in fastapi_headers().items() if k != "Content-Type"},
            timeout=30,
        )
        if resp.ok:
            return jsonify({"ok": True, "result": resp.json()})
        return jsonify({"error": f"FastAPI error {resp.status_code}: {resp.text}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/upload/wise", methods=["POST"])
@login_required
def upload_wise():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file selected"}), 400
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/transactions/wise",
            files={"file": (f.filename, f.stream, f.content_type)},
            headers={k: v for k, v in fastapi_headers().items() if k != "Content-Type"},
            timeout=30,
        )
        if resp.ok:
            return jsonify({"ok": True, "result": resp.json()})
        return jsonify({"error": f"FastAPI error {resp.status_code}: {resp.text}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.route("/upload/flight", methods=["POST"])
@login_required
def upload_flight():
    data = request.get_json(silent=True) or {}
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/upload/flight",
            json=data,
            headers=fastapi_headers(),
            timeout=15,
        )
        if resp.ok:
            return jsonify({"ok": True, "result": resp.json()})
        return jsonify({"error": f"FastAPI error {resp.status_code}: {resp.text}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 503


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
            "SELECT name FROM sqlite_master WHERE type='view' AND name='location_overland_cleaned'"
        ).fetchone()

        if view_exists:
            rows = conn.execute("""
                SELECT timestamp, latitude, longitude, altitude, activity,
                       battery_level AS battery, speed, device_id AS device, horizontal_accuracy AS accuracy, 'overland' AS source
                FROM location_overland_cleaned
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
        {"lat": p["latitude"], "lon": p["longitude"], "ts": p["timestamp"],
         "activity": p["activity"], "battery": p["battery"], "speed": p["speed"]}
        for p in points if p["source"] == "overland"
    ]
    shortcuts = [
        {"lat": p["latitude"], "lon": p["longitude"], "ts": p["timestamp"],
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
                dist = math.sqrt((pt["latitude"] - op["latitude"]) ** 2 + (pt["longitude"] - op["longitude"]) ** 2)
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
            SELECT timestamp, latitude, longitude, altitude, activity,
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



# ── Config ────────────────────────────────────────────────────────────────────



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


# ── Trevor proxy ─────────────────────────────────────────────────────────────

def trevor_headers():
    return {"Content-Type": "application/json", "X-API-Key": TREVOR_API_KEY}

@app.route("/api/trevor/health")
@login_required
def trevor_health():
    try:
        resp = requests.get(f"{TREVOR_URL}/health", timeout=5)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e), "status": "unreachable"}), 503

@app.route("/api/trevor/chat", methods=["POST"])
@login_required
def trevor_chat():
    body = request.get_json(silent=True) or {}
    try:
        resp = requests.post(
            f"{TREVOR_URL}/chat",
            headers=trevor_headers(),
            json=body,
            timeout=120,  # LLM inference can be slow
        )
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 503


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
