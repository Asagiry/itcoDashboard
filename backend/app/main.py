import os
import sys
import json
import asyncio
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Add libs to sys.path for container/vendored packages
libs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "libs"))
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from .database import (
    ensure_db_initialized,
    get_all_settings,
    get_pending_scheduled_shifts,
)
from .auth import verify_auth_token
from .teams_client import send_teams_message, decode_token_info
from .browser_auth import ensure_active_token, PROFILE_DIR

from .routers.auth import router as auth_router
from .routers.shifts import (
    router as shifts_router,
    execute_send_daily_report,
    get_now_dt,
    MOSCOW_TZ
)
from .routers.tracker import router as tracker_router
from .routers.settings import router as settings_router

async def scheduled_report_runner():
    while True:
        try:
            await asyncio.sleep(5)
            pending_shifts = await get_pending_scheduled_shifts()
            now_dt = get_now_dt()
            for shift in pending_shifts:
                date_str = shift.get("date")
                sched_at = shift.get("report_scheduled_at") or shift.get("end_time") or "18:00:00"
                try:
                    parts = sched_at.split(":")
                    sh = int(parts[0])
                    sm = int(parts[1]) if len(parts) > 1 else 0
                    ss = int(parts[2]) if len(parts) > 2 else 0
                    s_year, s_month, s_day = map(int, date_str.split("-"))
                    sched_dt = datetime(s_year, s_month, s_day, sh, sm, ss, tzinfo=MOSCOW_TZ)
                except Exception as pe:
                    continue

                if now_dt >= sched_dt:
                    await execute_send_daily_report(date_str)
        except asyncio.CancelledError:
            break
        except Exception:
            pass

async def proactive_token_keeper():
    while True:
        try:
            await asyncio.sleep(300)
            if os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0:
                settings = await get_all_settings()
                token = settings.get("auth_token", "")
                info = decode_token_info(token)
                rem = info.get("remaining_seconds") or 0
                if info.get("is_expired") or rem < 3600:
                    await ensure_active_token(force_refresh=True)
        except asyncio.CancelledError:
            break
        except Exception:
            pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await ensure_db_initialized()
    keeper_task = None
    if os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0:
        asyncio.create_task(ensure_active_token())
        keeper_task = asyncio.create_task(proactive_token_keeper())
    scheduler_task = asyncio.create_task(scheduled_report_runner())
    yield
    # Shutdown
    if keeper_task:
        keeper_task.cancel()
    if scheduler_task:
        scheduler_task.cancel()

app = FastAPI(
    title="ITCO Shift & Tracker Dashboard API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# JWT Authentication Middleware
@app.middleware("http")
async def jwt_auth_middleware(request: Request, call_next):
    # Public endpoints
    open_paths = [
        "/api/auth/login",
        "/api/tracker/attachments",
        "/api/auth/teams-email/shot",
        "/api/tracker/auth/shot",
        "/api/tracker/debug-shot",
        "/docs",
        "/openapi.json",
        "/redoc",
    ]
    path = request.url.path

    if any(path.startswith(p) for p in open_paths) or not path.startswith("/api/"):
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()

    username = verify_auth_token(token) if token else None
    if not username:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Необходима авторизация", "code": "UNAUTHORIZED"}
        )
    request.state.username = username

    return await call_next(request)

# Include Modular Routers
app.include_router(auth_router)
app.include_router(shifts_router)
app.include_router(tracker_router)
app.include_router(settings_router)

# Static attachments for tracker issues
TRACKER_ATTACHMENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tracker_attachments"))
os.makedirs(TRACKER_ATTACHMENTS_DIR, exist_ok=True)
app.mount("/api/tracker/attachments", StaticFiles(directory=TRACKER_ATTACHMENTS_DIR), name="tracker_attachments")

# Static file serving if frontend is built
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
