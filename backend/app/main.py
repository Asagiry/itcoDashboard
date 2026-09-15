import os
import sys
import json
import asyncio
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

# Ensure local libs in backend/libs are discoverable
libs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "libs"))
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .auth import authenticate_user, create_auth_token, verify_auth_token
from .database import (
    init_db,
    get_all_settings,
    save_settings,
    get_shift_by_date,
    create_or_update_shift,
    get_shift_history,
    delete_shift_by_date
)
from .schemas import (
    LoginRequest,
    LoginResponse,
    SettingsSchema,
    ShiftSchema,
    StartShiftResponse,
    EndShiftRequest,
    EndShiftResponse,
    SaveDraftRequest,
    TestTeamsRequest,
    TestTeamsResponse,
    ParseCurlRequest,
    ParseCurlResponse,
    UpdateShiftRequest,
    UpdateShiftResponse,
    TeamsEmailStartRequest,
    TeamsEmailSubmitRequest
)
from .teams_client import send_teams_message, decode_token_info
from .curl_parser import parse_curl_command
from .browser_auth import (
    fetch_teams_conversations,
    run_browser_login,
    run_headless_refresh,
    ensure_active_token,
    extract_user_profile,
    PROFILE_DIR
)

async def proactive_token_keeper():
    """
    Runs in background: keeps Teams token permanently fresh well before it expires.
    Checks every 5 minutes. If remaining lifetime is under 60 minutes, silently refreshes
    it using the saved browser profile.
    """
    while True:
        try:
            await asyncio.sleep(300)
            if os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0:
                settings = await get_all_settings()
                token = settings.get("auth_token", "")
                info = decode_token_info(token)
                rem = info.get("remaining_seconds") or 0
                if info.get("is_expired") or rem < 3600:
                    print("🔄 Упреждающее фоновое обновление сессии Teams...")
                    await ensure_active_token(force_refresh=True)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Ошибка в proactive_token_keeper: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    keeper_task = None
    if os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0:
        asyncio.create_task(ensure_active_token())
        keeper_task = asyncio.create_task(proactive_token_keeper())
    yield
    if keeper_task:
        keeper_task.cancel()

app = FastAPI(title="ITCO Work Shift & Teams Dashboard", lifespan=lifespan)

# Allow CORS for local Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Allow CORS preflight OPTIONS requests
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    # Intercept all API endpoints except login
    if path.startswith("/api/") and path != "/api/auth/login":
        auth_header = request.headers.get("Authorization")
        token = None
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()

        username = verify_auth_token(token) if token else None
        if not username:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Необходима авторизация", "code": "UNAUTHORIZED"}
            )
        request.state.username = username

    return await call_next(request)

@app.post("/api/auth/login", response_model=LoginResponse)
async def login_endpoint(payload: LoginRequest):
    if not authenticate_user(payload.username, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль"
        )
    token = create_auth_token(payload.username.strip())
    return LoginResponse(
        success=True,
        token=token,
        user={
            "username": payload.username.strip(),
            "name": "Vladimir Epishin"
        }
    )

@app.get("/api/auth/me")
async def get_me_endpoint(request: Request):
    username = getattr(request.state, "username", "vepishin")
    return {
        "success": True,
        "user": {
            "username": username,
            "name": "Vladimir Epishin"
        }
    }


APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Europe/Moscow")
try:
    MOSCOW_TZ = ZoneInfo(APP_TIMEZONE)
except Exception:
    MOSCOW_TZ = ZoneInfo("Europe/Moscow")

def get_now_dt() -> datetime:
    return datetime.now(MOSCOW_TZ)

def get_today_str() -> str:
    return get_now_dt().strftime("%Y-%m-%d")

def get_now_time_str() -> str:
    return get_now_dt().strftime("%H:%M:%S")

def get_rounded_start_time() -> str:
    """
    Rounds shift opening time up to the hour (ceiling).
    - Arrived before 10:00 (e.g. 09:50) -> start official shift at 10:00:00.
    - If arrived after 10:00 with minutes (e.g. 10:15) -> ceil to next whole hour.
    NOTE: uses Moscow time (APP_TIMEZONE). On VPS system clock is UTC,
    so datetime.now() without tz gave 15:00 instead of 18:00.
    """
    now = get_now_dt()
    if now.hour < 10 or (now.hour == 10 and now.minute == 0 and now.second == 0):
        return "10:00:00"
    if now.minute > 0 or now.second > 0:
        if now.hour >= 23:
            return "23:59:00"
        return f"{now.hour + 1:02d}:00:00"
    return f"{now.hour:02d}:00:00"

def get_rounded_end_time() -> str:
    """
    Rounds shift closing time up to the hour (ceiling in user's favor).
    - e.g. 17:31 (5:31 PM) -> 18:00:00.
    - 18:00:00 -> 18:00:00.
    - 18:10 -> 19:00:00.
    NOTE: uses Moscow time (APP_TIMEZONE).
    """
    now = get_now_dt()
    if now.minute > 0 or now.second > 0:
        if now.hour >= 23:
            return "23:59:00"
        return f"{now.hour + 1:02d}:00:00"
    return f"{now.hour:02d}:00:00"

# --- Shift Endpoints ---

@app.get("/api/shifts/today", response_model=ShiftSchema)
async def get_today_shift():
    today = get_today_str()
    shift = await get_shift_by_date(today)
    if not shift:
        shift = await create_or_update_shift(
            today,
            status="not_started",
            daily_report="",
            start_time=None,
            end_time=None
        )
    return shift

@app.post("/api/shifts/start", response_model=StartShiftResponse)
async def start_shift():
    today = get_today_str()
    shift = await get_shift_by_date(today)

    if shift and shift.get("status") in ["in_progress", "completed"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Смена на сегодня уже была начата и не может быть запущена повторно."
        )

    settings = await get_all_settings()
    director_url = settings.get("director_chat_url", "").strip()
    message_text = settings.get("director_message_template", "Здравствуйте, я на рабочем месте")

    # Automatically ensure token is active using persistent browser session
    auth_header, auth_token = await ensure_active_token()

    custom_headers = {}
    try:
        raw_custom = settings.get("custom_headers", "{}")
        if raw_custom:
            custom_headers = json.loads(raw_custom)
    except Exception:
        pass

    # Attempt to send message to Teams
    user_prof = extract_user_profile()
    sender_name = user_prof.get("name", "")

    success, status_code, resp_text = False, 0, ""
    if director_url:
        success, status_code, resp_text = await send_teams_message(
            url=director_url,
            message=message_text,
            auth_header_name=auth_header,
            auth_token=auth_token,
            custom_headers=custom_headers,
            sender_name=sender_name
        )

        # If 401 or 403, session might have been rotated by Microsoft; auto-refresh and retry once!
        if status_code in [401, 403] and os.path.exists(PROFILE_DIR):
            print(f"⚠️ Teams вернул {status_code}, выполняем автоматическое обновление токена и повторяем...")
            auth_header, auth_token = await ensure_active_token(force_refresh=True)
            success, status_code, resp_text = await send_teams_message(
                url=director_url,
                message=message_text,
                auth_header_name=auth_header,
                auth_token=auth_token,
                custom_headers=custom_headers,
                sender_name=sender_name
            )
    else:
        resp_text = "URL чата с руководителем не заполнен. Запись смены создана локально."

    # Update database shift record with rounded start time (e.g. 09:50 -> 10:00)
    now_time = get_rounded_start_time()
    updated_shift = await create_or_update_shift(
        today,
        status="in_progress",
        start_time=now_time,
        raw_response_start=json.dumps({"status_code": status_code, "response": resp_text}, ensure_ascii=False)
    )

    msg = "Смена успешно начата! " + (
        "Сообщение отправлено руководителю в Teams." if success else
        f"Внимание: отправка в Teams вернула код {status_code} ({resp_text[:100]}). Проверьте токен в настройках."
    )

    return StartShiftResponse(
        success=True,
        shift=ShiftSchema(**updated_shift),
        message=msg,
        teams_status_code=status_code,
        teams_response=resp_text
    )

@app.post("/api/shifts/draft")
async def save_draft(req: SaveDraftRequest):
    today = get_today_str()
    shift = await create_or_update_shift(today, daily_report=req.daily_report)
    return {"success": True, "shift": shift}

@app.post("/api/shifts/end", response_model=EndShiftResponse)
async def end_shift(req: EndShiftRequest):
    today = get_today_str()
    shift = await get_shift_by_date(today)

    if not shift or shift.get("status") == "not_started":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя завершить смену, которая ещё не была начата."
        )

    if shift.get("status") == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Смена на сегодня уже завершена."
        )

    if not req.daily_report or not req.daily_report.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пожалуйста, заполните поле 'Что я сегодня сделал' перед завершением смены."
        )

    settings = await get_all_settings()
    daily_url = settings.get("daily_chat_url", "").strip()

    # Automatically ensure token is active using persistent browser session
    auth_header, auth_token = await ensure_active_token()

    custom_headers = {}
    try:
        raw_custom = settings.get("custom_headers", "{}")
        if raw_custom:
            custom_headers = json.loads(raw_custom)
    except Exception:
        pass

    # Strictly raw text of daily report - no prefixes, no date, no extra lines
    full_message = req.daily_report.strip()

    user_prof = extract_user_profile()
    sender_name = user_prof.get("name", "")

    success, status_code, resp_text = False, 0, ""
    if daily_url:
        success, status_code, resp_text = await send_teams_message(
            url=daily_url,
            message=full_message,
            auth_header_name=auth_header,
            auth_token=auth_token,
            custom_headers=custom_headers,
            sender_name=sender_name
        )

        # If 401 or 403, session might have been rotated by Microsoft; auto-refresh and retry once!
        if status_code in [401, 403] and os.path.exists(PROFILE_DIR):
            print(f"⚠️ Teams вернул {status_code}, выполняем автоматическое обновление токена и повторяем...")
            auth_header, auth_token = await ensure_active_token(force_refresh=True)
            success, status_code, resp_text = await send_teams_message(
                url=daily_url,
                message=full_message,
                auth_header_name=auth_header,
                auth_token=auth_token,
                custom_headers=custom_headers,
                sender_name=sender_name
            )
    else:
        resp_text = "URL чата для отчётов не заполнен в настройках. Отчёт сохранён локально."

    # Update database shift record with rounded end time (ceiling in user favor, e.g. 17:31 -> 18:00)
    now_time = get_rounded_end_time()
    updated_shift = await create_or_update_shift(
        today,
        status="completed",
        end_time=now_time,
        daily_report=req.daily_report.strip(),
        raw_response_end=json.dumps({"status_code": status_code, "response": resp_text}, ensure_ascii=False)
    )

    msg = "Смена успешно завершена! " + (
        "Отчёт отправлен в Teams." if success else
        f"Локально смена закрыта. Статус Teams: {status_code} ({resp_text[:100]})."
    )

    return EndShiftResponse(
        success=True,
        shift=ShiftSchema(**updated_shift),
        message=msg,
        teams_status_code=status_code,
        teams_response=resp_text
    )

@app.get("/api/shifts/history")
async def get_history(limit: int = 100):
    rows = await get_shift_history(limit=limit)
    return rows

def _parse_time_sec(t_str: Optional[str]) -> Optional[int]:
    if not t_str:
        return None
    try:
        parts = t_str.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        s = int(parts[2]) if len(parts) > 2 else 0
        return h * 3600 + m * 60 + s
    except Exception:
        return None

def _calc_shift_hours(start_str: Optional[str], end_str: Optional[str]) -> float:
    st = _parse_time_sec(start_str)
    et = _parse_time_sec(end_str)
    if st is not None and et is not None and et >= st:
        return (et - st) / 3600.0
    return 8.0

@app.get("/api/shifts/salary-stats")
async def get_salary_stats():
    """
    Calculates salary statistics:
    - Monthly base: 35,000 ₽
    - Shift rate (8h): 1,667 ₽
    - Hourly rate: 208.375 ₽
    - Minute rate: 3.472917 ₽
    """
    MONTHLY_RATE = 35000.0
    SHIFT_RATE = 1667.0
    HOURLY_RATE = SHIFT_RATE / 8.0  # 208.375
    MINUTE_RATE = HOURLY_RATE / 60.0  # ~3.472917

    history = await get_shift_history(limit=500)
    # ВАЖНО: на VPS системное время UTC, поэтому всегда используем московское время.
    now = get_now_dt()
    month_prefix = now.strftime("%Y-%m")

    completed_shifts = []
    completed_hours = 0.0
    completed_earned = 0.0

    for s in history:
        date_str = s.get("date", "")
        if date_str.startswith(month_prefix) and s.get("status") == "completed":
            hrs = _calc_shift_hours(s.get("start_time"), s.get("end_time"))
            earned = round(hrs * HOURLY_RATE, 2)
            completed_shifts.append(s)
            completed_hours += hrs
            completed_earned += earned

    # Today's shift calculation
    today_str = get_today_str()
    today_shift = await get_shift_by_date(today_str)

    today_minutes_worked = 0.0
    today_earned_live = 0.0

    if today_shift and today_shift.get("status") == "in_progress":
        st = _parse_time_sec(today_shift.get("start_time"))
        if st is not None:
            now_sec = now.hour * 3600 + now.minute * 60 + now.second
            elapsed_sec = max(0, now_sec - st)
            today_minutes_worked = elapsed_sec / 60.0
            today_earned_live = round(today_minutes_worked * MINUTE_RATE, 2)
    elif today_shift and today_shift.get("status") == "completed":
        hrs = _calc_shift_hours(today_shift.get("start_time"), today_shift.get("end_time"))
        today_minutes_worked = hrs * 60.0
        today_earned_live = round(hrs * HOURLY_RATE, 2)

    total_month_earned_live = round(
        completed_earned + (today_earned_live if today_shift and today_shift.get("status") == "in_progress" else 0.0),
        2
    )
    progress_percent = min(100.0, round((total_month_earned_live / MONTHLY_RATE) * 100, 1))

    return {
        "monthly_rate": MONTHLY_RATE,
        "shift_rate": SHIFT_RATE,
        "hourly_rate": HOURLY_RATE,
        "minute_rate": MINUTE_RATE,
        "month_name": "Сентябрь 2026",
        "month_prefix": month_prefix,
        "completed_shifts_count": len(completed_shifts),
        "completed_hours_total": round(completed_hours, 1),
        "completed_earned_total": round(completed_earned, 2),
        "today_minutes_worked": round(today_minutes_worked, 1),
        "today_earned_live": today_earned_live,
        "total_month_earned_live": total_month_earned_live,
        "progress_percent": progress_percent,
        "today_shift": today_shift
    }

@app.post("/api/shifts/reset-today")
async def reset_today_shift():
    today = get_today_str()
    await delete_shift_by_date(today)
    new_shift = await create_or_update_shift(
        today,
        status="not_started",
        daily_report="",
        start_time=None,
        end_time=None
    )
    return {"success": True, "message": "Статус смены за сегодня успешно сброшен.", "shift": new_shift}


def _normalize_time_str(value: Optional[str]) -> Optional[str]:
    """Accepts HH:MM or HH:MM:SS, returns HH:MM:SS. None/empty -> None."""
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    parts = v.split(":")
    try:
        if len(parts) == 2:
            h, m = int(parts[0]), int(parts[1])
            s = 0
        elif len(parts) == 3:
            h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            raise ValueError("bad format")
        if not (0 <= h <= 23 and 0 <= m <= 59 and 0 <= s <= 59):
            raise ValueError("out of range")
        return f"{h:02d}:{m:02d}:{s:02d}"
    except Exception:
        raise HTTPException(status_code=400, detail=f"Некорректное время '{value}'. Формат HH:MM или HH:MM:SS.")


@app.put("/api/shifts/{date_str}", response_model=UpdateShiftResponse)
async def update_shift_by_date(date_str: str, req: UpdateShiftRequest):
    """Ручная правка смены (доделка: схемы UpdateShift* уже были, эндпоинта не было).
    Позволяет исправить битую запись после сбоя часового пояса на VPS.
    Поддерживает duration_hours: end_time = start_time + duration."""
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="Некорректная дата. Формат YYYY-MM-DD.")
    shift = await get_shift_by_date(date_str)
    if not shift:
        raise HTTPException(status_code=404, detail=f"Смена за {date_str} не найдена.")

    fields: dict = {}
    start_norm = _normalize_time_str(req.start_time) if req.start_time is not None else None
    end_norm = _normalize_time_str(req.end_time) if req.end_time is not None else None

    # duration_hours имеет приоритет над end_time, если задан вместе со start
    if req.duration_hours is not None:
        try:
            dur = float(req.duration_hours)
        except Exception:
            raise HTTPException(status_code=400, detail="duration_hours должен быть числом.")
        if not (0 < dur <= 24):
            raise HTTPException(status_code=400, detail="duration_hours должен быть в диапазоне (0, 24].")
        base_start = start_norm or shift.get("start_time")
        if not base_start:
            raise HTTPException(status_code=400, detail="Для duration_hours нужен start_time.")
        st_sec = _parse_time_sec(base_start)
        if st_sec is None:
            raise HTTPException(status_code=400, detail="Некорректный start_time.")
        et_sec = st_sec + int(round(dur * 3600))
        if et_sec >= 24 * 3600:
            et_sec = 24 * 3600 - 60  # cap 23:59
        end_norm = f"{et_sec // 3600:02d}:{(et_sec % 3600) // 60:02d}:{et_sec % 60:02d}"
        if req.start_time is not None:
            fields["start_time"] = start_norm
        fields["end_time"] = end_norm
    else:
        if req.start_time is not None:
            fields["start_time"] = start_norm
        if req.end_time is not None:
            fields["end_time"] = end_norm

    if req.daily_report is not None:
        fields["daily_report"] = req.daily_report
    if req.status is not None:
        if req.status not in ("not_started", "in_progress", "completed"):
            raise HTTPException(status_code=400, detail="Некорректный status.")
        fields["status"] = req.status

    if not fields:
        raise HTTPException(status_code=400, detail="Нет полей для обновления.")
    updated = await create_or_update_shift(date_str, **fields)
    return UpdateShiftResponse(success=True, shift=ShiftSchema(**updated), message=f"Смена за {date_str} обновлена.")


@app.get("/api/debug/time")
async def debug_time():
    """Диагностика часового пояса на VPS: системное UTC vs московское."""
    sys_now = datetime.now()
    msk_now = get_now_dt()
    return {
        "app_timezone": APP_TIMEZONE,
        "system_local": sys_now.strftime("%Y-%m-%d %H:%M:%S"),
        "moscow_now": msk_now.strftime("%Y-%m-%d %H:%M:%S"),
        "moscow_today": msk_now.strftime("%Y-%m-%d"),
        "rounded_end_now": get_rounded_end_time(),
    }

# --- Settings Endpoints ---

@app.get("/api/settings", response_model=SettingsSchema)
async def get_settings():
    has_profile = os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0
    data = await get_all_settings()
    token = data.get("auth_token", "")
    info = decode_token_info(token)

    # If token expired or expiring soon (< 15 mins) and profile exists, auto-refresh
    if (not token or info.get("is_expired") or (info.get("remaining_seconds") or 0) < 900) and has_profile:
        header, token = await ensure_active_token()
        data = await get_all_settings()
        info = decode_token_info(token)

    is_active = has_profile and bool(token) and (not info.get("is_expired")) and ((info.get("remaining_seconds") or 0) > 0)
    last_login = info.get("issued_at") or info.get("expires_at")

    user_prof = extract_user_profile()
    account_name = user_prof.get("name") or info.get("skypeid") or data.get("account_name") or "Пользователь Teams"

    return SettingsSchema(
        director_chat_url=data.get("director_chat_url", ""),
        director_message_template=data.get("director_message_template", "Здравствуйте, я на рабочем месте"),
        daily_chat_url=data.get("daily_chat_url", ""),
        auth_token=token,
        auth_header_name=data.get("auth_header_name", "Authentication"),
        custom_headers=data.get("custom_headers", "{}"),
        token_info=info,
        has_browser_profile=has_profile,
        auto_refresh_active=has_profile,
        account_name=account_name,
        account_status="active" if is_active else "inactive",
        last_login_at=last_login
    )

@app.post("/api/settings")
async def update_settings(req: SettingsSchema):
    # Validate JSON in custom_headers
    if req.custom_headers:
        try:
            json.loads(req.custom_headers)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Некорректный JSON в дополнительных заголовках: {str(e)}")

    current = await get_all_settings()
    save_dict = {
        "director_chat_url": req.director_chat_url,
        "director_message_template": req.director_message_template,
        "daily_chat_url": req.daily_chat_url,
        "auth_token": req.auth_token.strip() if (req.auth_token and req.auth_token.strip()) else current.get("auth_token", ""),
        "auth_header_name": req.auth_header_name or current.get("auth_header_name", "Authentication"),
        "custom_headers": req.custom_headers if req.custom_headers is not None else current.get("custom_headers", "{}")
    }
    await save_settings(save_dict)
    return {"success": True, "message": "Настройки успешно сохранены."}

SELF_NOTES_CHAT_URL = "https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/48%3Anotes/messages"

@app.post("/api/settings/test-teams", response_model=TestTeamsResponse)
async def test_teams_endpoint(req: TestTeamsRequest):
    settings = await get_all_settings()
    if req.chat_type == "self":
        target_url = SELF_NOTES_CHAT_URL
        test_msg = req.custom_message or "test ping"
    elif req.chat_type == "director":
        target_url = settings.get("director_chat_url", "").strip()
        test_msg = req.custom_message or "test ping"
    elif req.chat_type == "daily":
        target_url = settings.get("daily_chat_url", "").strip()
        test_msg = req.custom_message or "test ping"
    else:
        target_url = SELF_NOTES_CHAT_URL
        test_msg = req.custom_message or "test ping"

    if not target_url:
        return TestTeamsResponse(
            success=False,
            status_code=400,
            url="",
            response_body="",
            error="URL выбранного чата не указан в настройках."
        )

    auth_header, auth_token = await ensure_active_token()
    if not auth_token:
        auth_header = settings.get("auth_header_name", "Authentication")
        auth_token = settings.get("auth_token", "")

    custom_headers = {}
    try:
        raw_custom = settings.get("custom_headers", "{}")
        if raw_custom:
            custom_headers = json.loads(raw_custom)
    except Exception:
        pass

    success, status_code, resp_text = await send_teams_message(
        url=target_url,
        message=test_msg,
        auth_header_name=auth_header,
        auth_token=auth_token,
        custom_headers=custom_headers
    )

    return TestTeamsResponse(
        success=success,
        status_code=status_code,
        url=target_url,
        response_body=resp_text,
        error=None if success else f"Teams вернул статус {status_code}"
    )

@app.post("/api/settings/parse-curl", response_model=ParseCurlResponse)
async def parse_curl_endpoint(req: ParseCurlRequest):
    success, url, auth_header, auth_token, headers, err = parse_curl_command(req.curl_command)
    if not success:
        return ParseCurlResponse(success=False, error=err)

    # Immediately auto-save to database so parameters persist across reboots
    save_dict = {}
    if url:
        save_dict["director_chat_url"] = url
    if auth_token:
        save_dict["auth_token"] = auth_token
    if auth_header:
        save_dict["auth_header_name"] = auth_header
    if headers:
        save_dict["custom_headers"] = json.dumps(headers)
    if save_dict:
        await save_settings(save_dict)

    return ParseCurlResponse(
        success=True,
        url=url,
        auth_header_name=auth_header,
        auth_token=auth_token,
        headers=headers
    )

# --- Browser Auth & Chat Picker Endpoints ---

@app.get("/api/teams/chats")
async def get_teams_chats(force: bool = False):
    auth_header, auth_token = await ensure_active_token()
    chats = await fetch_teams_conversations(auth_token, auth_header, force_refresh=force)
    return {"success": True, "chats": chats}

@app.get("/api/auth/browser-status")
async def get_browser_status():
    has_profile = os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0
    return {"success": True, "has_profile": has_profile}

@app.post("/api/auth/browser-login")
async def browser_login_endpoint():
    result = await run_browser_login(timeout_seconds=120)
    return result

@app.post("/api/auth/browser-refresh")
async def browser_refresh_endpoint():
    result = await run_headless_refresh()
    return result

# --- Teams e-mail OTP login (passwordless) ---

@app.post("/api/auth/teams-email/start")
async def teams_email_start_endpoint(req: TeamsEmailStartRequest):
    from .teams_email_login import start_email_login
    return await start_email_login(req.email)

@app.post("/api/auth/teams-email/submit-code")
async def teams_email_submit_endpoint(req: TeamsEmailSubmitRequest):
    from .teams_email_login import submit_email_code
    return await submit_email_code(req.session_id, req.code, req.remember_me)

@app.get("/api/auth/teams-email/status/{session_id}")
async def teams_email_status_endpoint(session_id: str):
    from .teams_email_login import get_email_session_status
    return await get_email_session_status(session_id)

@app.post("/api/auth/teams-email/cancel")
async def teams_email_cancel_endpoint(payload: dict):
    from .teams_email_login import cancel_email_login
    return await cancel_email_login(payload.get("session_id", ""))

@app.post("/api/auth/teams-email/click")
async def teams_email_click_endpoint(payload: dict):
    from .teams_email_login import click_in_session
    texts = payload.get("texts") or [payload.get("text", "")]
    return await click_in_session(payload.get("session_id", ""), *[t for t in texts if t])

@app.get("/api/auth/teams-email/shot/{session_id}")
async def teams_email_shot_endpoint(session_id: str, name: Optional[str] = None):
    from .teams_email_login import get_shot_path
    path = get_shot_path(session_id, name)
    if not path:
        raise HTTPException(status_code=404, detail="Скриншот не найден.")
    return FileResponse(path, media_type="image/png")

# Static file serving if frontend is built
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't hijack API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
