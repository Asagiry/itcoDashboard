import json
from typing import Optional, List
from fastapi import APIRouter, HTTPException

from ..database import get_all_settings, save_settings
from ..schemas import (
    SettingsSchema,
    TestTeamsRequest,
    TestTeamsResponse,
    ParseCurlRequest,
    ParseCurlResponse
)
from ..browser_auth import (
    fetch_teams_conversations,
    has_browser_profile,
    extract_user_profile
)
from ..teams_client import decode_token_info
from ..curl_parser import parse_curl_command

router = APIRouter(prefix="/api", tags=["settings"])

SELF_NOTES_CHAT_URL = "https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/48%3Anotes/messages"

@router.get("/settings", response_model=SettingsSchema)
async def get_settings_endpoint():
    from .. import main
    data = await get_all_settings()
    auth_hdr, token = await main.ensure_active_token()
    info = decode_token_info(token) if token else {}
    has_profile = has_browser_profile()

    is_active = has_profile and bool(token) and (not info.get("is_expired")) and ((info.get("remaining_seconds") or 0) > 0)
    last_login = info.get("issued_at") or info.get("expires_at")

    user_prof = extract_user_profile()
    account_name = user_prof.get("name") or info.get("skypeid") or data.get("account_name") or "Пользователь Teams"

    monthly_rate_val = 35000.0
    try:
        if data.get("monthly_rate"):
            monthly_rate_val = float(data.get("monthly_rate"))
    except (ValueError, TypeError):
        pass

    return SettingsSchema(
        director_chat_url=data.get("director_chat_url", ""),
        director_message_template=data.get("director_message_template", "Здравствуйте, я на рабочем месте"),
        daily_chat_url=data.get("daily_chat_url", ""),
        auth_token=token or data.get("auth_token", ""),
        auth_header_name=data.get("auth_header_name", "Authentication"),
        custom_headers=data.get("custom_headers", "{}"),
        token_info=info,
        has_browser_profile=has_profile,
        auto_refresh_active=has_profile,
        account_name=account_name,
        account_status="active" if is_active else "inactive",
        last_login_at=last_login,
        monthly_rate=monthly_rate_val
    )

@router.post("/settings")
async def update_settings(req: SettingsSchema):
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
        "custom_headers": req.custom_headers if req.custom_headers is not None else current.get("custom_headers", "{}"),
        "monthly_rate": str(req.monthly_rate if req.monthly_rate is not None and req.monthly_rate > 0 else 35000.0)
    }
    await save_settings(save_dict)
    return {"success": True, "message": "Настройки успешно сохранены."}

@router.post("/settings/test-teams", response_model=TestTeamsResponse)
@router.post("/settings/teams/test", response_model=TestTeamsResponse)
async def test_teams_endpoint(req: TestTeamsRequest):
    from .. import main
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

    auth_header, auth_token = await main.ensure_active_token()
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

    user_prof = extract_user_profile()
    sender_name = user_prof.get("name", "")

    success, status_code, resp_text = await main.send_teams_message(
        url=target_url,
        message=test_msg,
        auth_header_name=auth_header,
        auth_token=auth_token,
        custom_headers=custom_headers,
        sender_name=sender_name
    )

    return TestTeamsResponse(
        success=success,
        status_code=status_code,
        url=target_url,
        response_body=resp_text,
        error=None if success else f"Teams вернул статус {status_code}"
    )

@router.post("/settings/parse-curl", response_model=ParseCurlResponse)
async def parse_curl_endpoint(req: ParseCurlRequest):
    success, url, auth_header, auth_token, headers, err = parse_curl_command(req.curl_command)
    if not success:
        return ParseCurlResponse(success=False, error=err)

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

@router.get("/teams/chats")
async def get_teams_chats(force: bool = False):
    from .. import main
    auth_header, auth_token = await main.ensure_active_token()
    chats = await fetch_teams_conversations(auth_token, auth_header, force_refresh=force)
    return {"success": True, "chats": chats}
