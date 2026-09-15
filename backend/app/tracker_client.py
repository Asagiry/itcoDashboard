import os
import json
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from .database import (
    get_all_settings,
    save_settings,
    save_tracker_projects,
    save_tracker_issues,
    get_tracker_projects,
    get_tracker_issues,
    update_tracker_issue_status_in_db
)

logger = logging.getLogger("tracker_client")
MOSCOW_TZ = timezone(timedelta(hours=3))

_tracker_logs: List[Dict[str, Any]] = []

def _add_tracker_log(level: str, message: str):
    timestamp = datetime.now(MOSCOW_TZ).strftime("%Y-%m-%d %H:%M:%S")
    entry = {"time": timestamp, "level": level, "message": message}
    _tracker_logs.append(entry)
    if len(_tracker_logs) > 200:
        _tracker_logs.pop(0)
    if level == "error":
        logger.error(message)
    elif level == "warning":
        logger.warning(message)
    else:
        logger.info(message)

def get_tracker_logs() -> List[Dict[str, Any]]:
    return list(_tracker_logs)

def normalize_tracker_status(raw_status: str) -> str:
    if not raw_status:
        return "todo"
    s = raw_status.strip().lower()
    if s in ["к выполнению", "todo", "backlog", "бэклог", "to do", "открыто"]:
        return "todo"
    if s in ["в работе", "in progress", "in_progress", "in-progress"]:
        return "in_progress"
    if s in ["готово к тестированию", "ready for testing", "ready_for_testing", "ready-for-testing"]:
        return "ready_for_testing"
    if s in ["тестирование", "testing", "in testing", "in_testing"]:
        return "testing"
    if s in ["ревью", "review", "in review", "in_review", "на ревью"]:
        return "review"
    if s in [
        "готово к мержу", "ready to merge", "ready_to_merge", "ready-to-merge",
        "ready for merge", "ready_for_merge", "ready-for-merge"
    ]:
        return "ready_to_merge"
    if s in [
        "ready for production", "ready_for_production", "ready-for-production",
        "done", "готово", "resolved", "закрыто", "canceled", "отменено"
    ]:
        return "ready_for_production"
    return "todo"

async def _run_huly_bridge(cmd: str, *args: str) -> Dict[str, Any]:
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "huly_bridge.cjs")),
        os.path.abspath(os.path.join(os.getcwd(), "backend", "huly_bridge.cjs")),
        os.path.abspath("/app/backend/huly_bridge.cjs"),
        os.path.abspath("backend/huly_bridge.cjs"),
        os.path.abspath("huly_bridge.cjs"),
    ]
    bridge_script = next((c for c in candidates if os.path.isfile(c)), None)
    if not bridge_script:
        return {"success": False, "error": f"Bridge script not found. Checked paths: {candidates}"}

    cmd_args = ["node", bridge_script, cmd] + list(args)
    _add_tracker_log("info", f"Запуск Huly Bridge: {cmd}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        out_str = stdout.decode("utf-8", errors="replace").strip()
        err_str = stderr.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            error_msg = err_str or out_str or f"Process exited with code {proc.returncode}"
            try:
                err_json = json.loads(err_str)
                if isinstance(err_json, dict) and "error" in err_json:
                    error_msg = err_json["error"]
            except Exception:
                pass
            _add_tracker_log("error", f"Ошибка Huly Bridge ({cmd}): {error_msg}")
            return {"success": False, "error": error_msg}

        lines = [line.strip() for line in out_str.split("\n") if line.strip()]
        if not lines:
            return {"success": False, "error": "Пустой ответ от Huly Bridge"}

        data = json.loads(lines[-1])
        return data
    except Exception as e:
        _add_tracker_log("error", f"Исключение при вызове Huly Bridge: {e}")
        return {"success": False, "error": str(e)}

async def get_tracker_auth_status() -> Dict[str, Any]:
    settings = await get_all_settings()
    token = settings.get("tracker_token", "").strip()
    account_name = settings.get("tracker_account_name", "").strip()
    last_sync = settings.get("tracker_last_sync", "").strip()
    tracker_url = settings.get("tracker_url", "https://tracker.itco.su/workbench/itco/tracker/my-issues/issues").strip()

    is_authenticated = bool(token)
    if not account_name and is_authenticated:
        account_name = "vepishin@it-co.ru"

    return {
        "success": True,
        "is_authenticated": is_authenticated,
        "account_name": account_name,
        "workspace": "itco",
        "tracker_url": tracker_url,
        "last_sync": last_sync
    }

async def run_tracker_password_login(email: str, password: str) -> Dict[str, Any]:
    _add_tracker_log("info", f"Авторизация в ITCO Tracker (Huly) для: {email}")
    res = await _run_huly_bridge("login", email, password)
    if not res.get("success"):
        msg = res.get("error", "Ошибка авторизации в трекере")
        _add_tracker_log("error", f"Авторизация не удалась: {msg}")
        return {
            "success": False,
            "message": msg,
            "account_name": "",
            "issues_count": 0,
            "logs": [l["message"] for l in _tracker_logs[-10:]]
        }

    token = res.get("token", "")
    account_id = res.get("account", "")
    account_name = res.get("email", email)

    await save_settings({
        "tracker_token": token,
        "tracker_account_id": account_id,
        "tracker_account_name": account_name,
        "tracker_workspace": res.get("workspace", "itco")
    })
    _add_tracker_log("info", "Успешная авторизация в Huly! Токен сохранен.")

    sync_res = await fetch_tracker_data(force_refresh=True)
    issues_count = len(sync_res.get("issues", []))

    return {
        "success": True,
        "message": f"Авторизация успешна. Загружено {issues_count} задач.",
        "account_name": account_name,
        "issues_count": issues_count,
        "logs": [l["message"] for l in _tracker_logs[-10:]]
    }

async def logout_tracker() -> Dict[str, Any]:
    await save_settings({
        "tracker_token": "",
        "tracker_account_id": "",
        "tracker_account_name": "",
        "tracker_last_sync": ""
    })
    _add_tracker_log("info", "Сессия трекера сброшена.")
    return {"success": True, "message": "Сессия трекера успешно сброшена."}

async def fetch_tracker_data(force_refresh: bool = False) -> Dict[str, Any]:
    settings = await get_all_settings()
    token = settings.get("tracker_token", "").strip()
    account_id = settings.get("tracker_account_id", "").strip()

    if not token:
        db_projects = await get_tracker_projects()
        db_issues = await get_tracker_issues()
        _add_tracker_log("warning", "Токен трекера не найден, возвращаем кэшированные данные из БД.")
        return {
            "success": False,
            "message": "Требуется авторизация в ITCO Tracker",
            "projects": db_projects,
            "issues": db_issues,
            "logs": [l["message"] for l in _tracker_logs[-10:]]
        }

    _add_tracker_log("info", "Синхронизация задач через прямой Huly WebSocket API...")
    res = await _run_huly_bridge("sync", token, account_id)

    if not res.get("success"):
        err = res.get("error", "Ошибка синхронизации с трекером")
        _add_tracker_log("error", f"Ошибка синхронизации: {err}")
        db_projects = await get_tracker_projects()
        db_issues = await get_tracker_issues()
        return {
            "success": False,
            "message": f"Ошибка синхронизации: {err}",
            "projects": db_projects,
            "issues": db_issues,
            "logs": [l["message"] for l in _tracker_logs[-10:]]
        }

    projects = res.get("projects", [])
    issues = res.get("issues", [])

    await save_tracker_projects(projects)
    await save_tracker_issues(issues, replace_all=True)

    now_str = datetime.now(MOSCOW_TZ).strftime("%Y-%m-%d %H:%M:%S")
    await save_settings({"tracker_last_sync": now_str})

    _add_tracker_log("info", f"Синхронизировано {len(issues)} задач из {len(projects)} проектов.")
    return {
        "success": True,
        "message": f"Успешно синхронизировано {len(issues)} задач.",
        "projects": projects,
        "issues": issues,
        "logs": [l["message"] for l in _tracker_logs[-10:]]
    }

async def _apply_status_change_in_tracker(issue_key: str, new_status: str) -> bool:
    settings = await get_all_settings()
    token = settings.get("tracker_token", "").strip()
    account_id = settings.get("tracker_account_id", "").strip()
    if not token:
        _add_tracker_log("warning", "Нет токена для обновления статуса в Huly.")
        return False

    res = await _run_huly_bridge("update_status", token, account_id, issue_key, new_status)
    if res.get("success"):
        _add_tracker_log("info", f"Статус задачи {issue_key} успешно обновлен в Huly на {new_status}")
        return True
    else:
        _add_tracker_log("error", f"Не удалось обновить статус задачи {issue_key} в Huly: {res.get('error')}")
        return False

async def update_tracker_issue_status(issue_key: str, new_status: str) -> Dict[str, Any]:
    norm_status = normalize_tracker_status(new_status)
    _add_tracker_log("info", f"Изменение статуса задачи {issue_key} -> {norm_status}")

    # 1. Update in local DB immediately for 0ms UI response
    updated_issue = await update_tracker_issue_status_in_db(issue_key, norm_status)

    # 2. Sync mutation with live Huly transactor in background
    asyncio.create_task(_apply_status_change_in_tracker(issue_key, norm_status))

    return {
        "success": True,
        "message": f"Статус задачи {issue_key} обновлен на '{norm_status}'",
        "issue": updated_issue
    }
