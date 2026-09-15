import os
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from ..database import (
    get_shift_by_date,
    create_or_update_shift,
    get_shift_history,
    get_pending_scheduled_shifts,
    delete_shift_by_date,
    get_all_settings,
    save_settings,
    DB_PATH
)
from ..schemas import (
    ShiftSchema,
    StartShiftResponse,
    EndShiftRequest,
    EndShiftResponse,
    SendReportNowResponse,
    SaveDraftRequest,
    UpdateShiftRequest,
    UpdateShiftResponse
)
from ..browser_auth import extract_user_profile, has_browser_profile, PROFILE_DIR

router = APIRouter(prefix="/api/shifts", tags=["shifts"])

APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Europe/Moscow")
try:
    MOSCOW_TZ = ZoneInfo(APP_TIMEZONE)
except Exception:
    try:
        MOSCOW_TZ = ZoneInfo("Europe/Moscow")
    except Exception:
        MOSCOW_TZ = timezone(timedelta(hours=3))

def get_now_dt() -> datetime:
    return datetime.now(MOSCOW_TZ)

def get_today_str() -> str:
    return get_now_dt().strftime("%Y-%m-%d")

def get_now_time_str() -> str:
    return get_now_dt().strftime("%H:%M:%S")

def get_rounded_start_time() -> str:
    now = get_now_dt()
    if now.hour < 10 or (now.hour == 10 and now.minute == 0 and now.second == 0):
        return "10:00:00"
    if now.minute > 0 or now.second > 0:
        if now.hour >= 23:
            return "23:59:00"
        return f"{now.hour + 1:02d}:00:00"
    return f"{now.hour:02d}:00:00"

def get_rounded_end_time() -> str:
    now = get_now_dt()
    if now.minute > 0 or now.second > 0:
        if now.hour >= 23:
            return "23:59:00"
        return f"{now.hour + 1:02d}:00:00"
    return f"{now.hour:02d}:00:00"

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

async def execute_send_daily_report(date_str: str, force: bool = False) -> tuple[bool, int, str]:
    from .. import main
    shift = await get_shift_by_date(date_str)
    if not shift:
        return False, 404, "Смена не найдена."

    if shift.get("report_status") == "sent" and not force:
        return True, 200, "Отчёт уже был отправлен."

    full_message = (shift.get("daily_report") or "").strip()
    if not full_message:
        return False, 400, "Текст отчёта пуст."

    await create_or_update_shift(date_str, report_status="sending")

    settings = await get_all_settings()
    daily_url = settings.get("daily_chat_url", "").strip()

    auth_header, auth_token = await main.ensure_active_token()

    custom_headers = {}
    try:
        raw_custom = settings.get("custom_headers", "{}")
        if raw_custom:
            custom_headers = json.loads(raw_custom)
    except Exception:
        pass

    user_prof = extract_user_profile()
    sender_name = user_prof.get("name", "")

    success, status_code, resp_text = False, 0, ""
    if daily_url:
        success, status_code, resp_text = await main.send_teams_message(
            url=daily_url,
            message=full_message,
            auth_header_name=auth_header,
            auth_token=auth_token,
            custom_headers=custom_headers,
            sender_name=sender_name
        )

        if status_code in [401, 403] and has_browser_profile():
            print(f"⚠️ Teams вернул {status_code}, выполняем автоматическое обновление токена и повторяем...")
            auth_header, auth_token = await main.ensure_active_token(force_refresh=True)
            success, status_code, resp_text = await main.send_teams_message(
                url=daily_url,
                message=full_message,
                auth_header_name=auth_header,
                auth_token=auth_token,
                custom_headers=custom_headers,
                sender_name=sender_name
            )
    else:
        resp_text = "URL чата для отчётов не заполнен в настройках. Отчёт сохранён локально."
        success = True
        status_code = 200

    report_status = "sent" if success else "failed"
    now_time_str = get_now_time_str()

    await create_or_update_shift(
        date_str,
        report_status=report_status,
        report_sent_at=now_time_str,
        raw_response_end=json.dumps({"status_code": status_code, "response": resp_text}, ensure_ascii=False)
    )

    return success, status_code, resp_text

@router.get("/today", response_model=ShiftSchema)
async def get_today_shift():
    today = get_today_str()
    shift = await get_shift_by_date(today)
    if not shift:
        shift = await create_or_update_shift(
            today,
            status="not_started",
            daily_report="",
            start_time=None,
            end_time=None,
            report_status="not_scheduled",
            report_scheduled_at=None,
            report_sent_at=None
        )
    return ShiftSchema(**shift)

@router.post("/start", response_model=StartShiftResponse)
async def start_shift():
    from .. import main
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

    auth_header, auth_token = await main.ensure_active_token()

    custom_headers = {}
    try:
        raw_custom = settings.get("custom_headers", "{}")
        if raw_custom:
            custom_headers = json.loads(raw_custom)
    except Exception:
        pass

    user_prof = extract_user_profile()
    sender_name = user_prof.get("name", "")

    success, status_code, resp_text = False, 0, ""
    if director_url:
        success, status_code, resp_text = await main.send_teams_message(
            url=director_url,
            message=message_text,
            auth_header_name=auth_header,
            auth_token=auth_token,
            custom_headers=custom_headers,
            sender_name=sender_name
        )

        if status_code in [401, 403] and has_browser_profile():
            auth_header, auth_token = await main.ensure_active_token(force_refresh=True)
            success, status_code, resp_text = await main.send_teams_message(
                url=director_url,
                message=message_text,
                auth_header_name=auth_header,
                auth_token=auth_token,
                custom_headers=custom_headers,
                sender_name=sender_name
            )
    else:
        resp_text = "URL чата с руководителем не заполнен. Запись смены создана локально."

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

@router.post("/draft")
async def save_draft(req: SaveDraftRequest):
    today = get_today_str()
    shift = await create_or_update_shift(today, daily_report=req.daily_report)
    return {"success": True, "shift": ShiftSchema(**shift)}

@router.post("/end", response_model=EndShiftResponse)
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

    now_time = get_rounded_end_time()
    now_dt = get_now_dt()

    parts = now_time.split(":")
    sh = int(parts[0])
    sm = int(parts[1]) if len(parts) > 1 else 0
    ss = int(parts[2]) if len(parts) > 2 else 0
    target_dt = datetime(now_dt.year, now_dt.month, now_dt.day, sh, sm, ss, tzinfo=MOSCOW_TZ)

    if now_dt < target_dt:
        updated_shift = await create_or_update_shift(
            today,
            status="completed",
            end_time=now_time,
            daily_report=req.daily_report.strip(),
            report_status="scheduled",
            report_scheduled_at=now_time
        )
        msg = f"Смена успешно завершена! Отчёт запланирован на отправку в {now_time[:5]}."
        return EndShiftResponse(
            success=True,
            shift=ShiftSchema(**updated_shift),
            message=msg,
            teams_status_code=None,
            teams_response=None
        )

    updated_shift = await create_or_update_shift(
        today,
        status="completed",
        end_time=now_time,
        daily_report=req.daily_report.strip(),
        report_status="sending",
        report_scheduled_at=now_time
    )

    success, status_code, resp_text = await execute_send_daily_report(today, force=True)
    refreshed_shift = await get_shift_by_date(today)

    msg = "Смена успешно завершена! " + (
        "Отчёт отправлен в Teams." if success else
        f"Локально смена закрыта. Статус Teams: {status_code} ({resp_text[:100]})."
    )

    return EndShiftResponse(
        success=True,
        shift=ShiftSchema(**refreshed_shift),
        message=msg,
        teams_status_code=status_code,
        teams_response=resp_text
    )

@router.post("/send-report-now", response_model=SendReportNowResponse)
async def send_report_now():
    today = get_today_str()
    shift = await get_shift_by_date(today)

    if not shift or shift.get("status") != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Смена на сегодня ещё не была завершена."
        )

    if not (shift.get("daily_report") or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Текст отчёта пуст."
        )

    success, status_code, resp_text = await execute_send_daily_report(today, force=True)
    refreshed_shift = await get_shift_by_date(today)

    msg = "Отчёт успешно отправлен в Teams!" if success else f"Ошибка отправки в Teams: {resp_text[:100]}"
    return SendReportNowResponse(
        success=success,
        shift=ShiftSchema(**refreshed_shift),
        message=msg,
        teams_status_code=status_code,
        teams_response=resp_text
    )

@router.get("/history", response_model=List[ShiftSchema])
async def get_history(limit: int = 100):
    rows = await get_shift_history(limit=limit)
    return [ShiftSchema(**r) for r in rows]

@router.get("/salary-stats")
async def get_salary_stats():
    settings = await get_all_settings()
    monthly_rate_val = 35000.0
    try:
        if settings.get("monthly_rate"):
            monthly_rate_val = float(settings.get("monthly_rate"))
    except (ValueError, TypeError):
        pass

    MONTHLY_RATE = monthly_rate_val if monthly_rate_val > 0 else 35000.0
    SHIFT_RATE = 1667.0 if abs(MONTHLY_RATE - 35000.0) < 0.1 else round(MONTHLY_RATE / 21.0, 2)
    HOURLY_RATE = SHIFT_RATE / 8.0
    MINUTE_RATE = HOURLY_RATE / 60.0

    history = await get_shift_history(limit=500)
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
        "hourly_rate": round(HOURLY_RATE, 3),
        "minute_rate": round(MINUTE_RATE, 4),
        "month": month_prefix,
        "completed_shifts_count": len(completed_shifts),
        "completed_hours_total": round(completed_hours, 1),
        "completed_earned_total": round(completed_earned, 2),
        "today_minutes_worked": round(today_minutes_worked, 1),
        "today_earned_live": today_earned_live,
        "total_month_earned_live": total_month_earned_live,
        "progress_percent": progress_percent,
        "today_shift": today_shift
    }

@router.post("/reset-today")
async def reset_today_shift():
    today = get_today_str()
    await delete_shift_by_date(today)
    new_shift = await create_or_update_shift(
        today,
        status="not_started",
        daily_report="",
        start_time=None,
        end_time=None,
        report_status="not_scheduled",
        report_scheduled_at=None,
        report_sent_at=None
    )
    return {"success": True, "message": "Статус смены за сегодня успешно сброшен.", "shift": ShiftSchema(**new_shift)}

@router.post("/reset-all-data")
async def reset_all_data_endpoint():
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM shifts")
        await db.commit()
    return {"success": True, "message": "Все данные смен успешно удалены из базы."}

@router.put("/{date_str}", response_model=UpdateShiftResponse)
async def update_shift_endpoint(date_str: str, req: UpdateShiftRequest):
    shift = await get_shift_by_date(date_str)
    
    update_fields = {}
    if req.duration_hours is not None:
        dur = float(req.duration_hours)
        if dur <= 0:
            update_fields["start_time"] = None
            update_fields["end_time"] = None
            update_fields["status"] = "not_started"
        else:
            update_fields["start_time"] = "10:00:00"
            end_hour = 10 + int(dur)
            end_min = int(round((dur - int(dur)) * 60))
            if end_hour >= 24:
                end_hour = 23
                end_min = 59
            update_fields["end_time"] = f"{end_hour:02d}:{end_min:02d}:00"
            update_fields["status"] = "completed"
    else:
        if req.start_time is not None:
            val = req.start_time.strip()
            if val and len(val.split(":")) == 2:
                val += ":00"
            update_fields["start_time"] = val if val else None
            
        if req.end_time is not None:
            val = req.end_time.strip()
            if val and len(val.split(":")) == 2:
                val += ":00"
            update_fields["end_time"] = val if val else None
            
        if req.daily_report is not None:
            update_fields["daily_report"] = req.daily_report.strip()
            
        if req.status is not None:
            update_fields["status"] = req.status.strip()
        else:
            curr_start = update_fields.get("start_time", (shift or {}).get("start_time"))
            curr_end = update_fields.get("end_time", (shift or {}).get("end_time"))
            if curr_start and curr_end:
                update_fields["status"] = "completed"
            elif curr_start:
                update_fields["status"] = "in_progress"
            else:
                update_fields["status"] = (shift or {}).get("status", "not_started")

    if req.report_status is not None:
        update_fields["report_status"] = req.report_status
    if req.report_scheduled_at is not None:
        update_fields["report_scheduled_at"] = req.report_scheduled_at
    if req.report_sent_at is not None:
        update_fields["report_sent_at"] = req.report_sent_at

    updated = await create_or_update_shift(date_str, **update_fields)
    return UpdateShiftResponse(
        success=True,
        shift=ShiftSchema(**updated),
        message=f"Данные за смену {date_str} успешно сохранены!"
    )

@router.delete("/{date_str}")
async def delete_shift_endpoint(date_str: str):
    await delete_shift_by_date(date_str)
    return {
        "success": True,
        "message": f"Смена на дату {date_str} удалена"
    }
