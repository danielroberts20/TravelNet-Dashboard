# TravelNet Admin Dashboard

A Flask-based admin dashboard for TravelNet, intended to run inside Tailscale only.

## Features

| Section | What it does |
|---|---|
| **Overview** | CPU, RAM, disk, temperature + DB row counts + API usage + recent log events |
| **Database** | Browse all tables with last-5-rows preview, reset resettable tables (with typed confirmation) |
| **Cron Jobs** | Schedule reference + FX API usage + log digest history |
| **Logs** | Live SSE stream of `docker logs --follow` with level colouring and auto-scroll |
| **Upload** | Revolut CSV and Wise ZIP upload forms, forwarded to FastAPI endpoints |

## Setup

### 1. Add env vars to your `.env`

```env
DASHBOARD_PASSWORD=your-secure-password-here
FLASK_SECRET_KEY=some-long-random-string-for-session-signing
```

### 2. Place the dashboard directory

Put this `dashboard/` folder alongside your existing `docker-compose.yml`:

```
travelnet/
├── docker-compose.yml        ← your existing file
├── dashboard/                ← this directory
│   ├── app.py
│   ├── Dockerfile
│   ├── requirements.txt
│   └── templates/
└── server/
    └── app/
```

### 3. Merge the compose service

Add the `dashboard` service from `docker-compose.dashboard.yml` into your main
`docker-compose.yml`, or include it with:

```bash
docker compose -f docker-compose.yml -f dashboard/docker-compose.dashboard.yml up -d
```

### 4. Fix the docker.sock permission

The dashboard user (uid 1001) needs read access to `/var/run/docker.sock`:

```bash
# Option A: add dashboard user to the docker group on the host
sudo usermod -aG docker $(whoami)   # or the user running docker

# Option B: set the GID of the docker group explicitly in the Dockerfile
# (see comment in Dockerfile)
```

The simplest approach on a Pi is to check the group owning the socket:
```bash
ls -la /var/run/docker.sock
# srw-rw---- 1 root docker 0 ...
```
Then set `group_add: [docker-gid]` in the compose service, where `docker-gid` is
the numeric GID from `getent group docker | cut -d: -f3`.

### 5. Access via Tailscale

The port is bound to `127.0.0.1:8080` only. Access it at:

```
http://<your-pi-tailscale-ip>:8080
```

## Resettable tables

Only tables in the `RESETTABLE_TABLES` safelist in `app.py` can be cleared from the UI.
Edit this list to add or remove tables. Resets require typing the exact table name as confirmation.

## Cron triggering

Crons currently run at host level and are read-only in this dashboard (status display only).
Manual triggering via FastAPI subprocess delegation is planned as a future addition.

## Log streaming

The Logs page streams `docker logs --follow <container>` using Server-Sent Events (SSE).
Lines are colour-coded by level (ERROR=red, WARNING=yellow, DEBUG=dim, INFO=default).
Auto-scroll can be paused without disconnecting.
