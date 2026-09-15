import os
from typing import Optional, Dict, Any
from fastapi import APIRouter, Request, HTTPException, status
from fastapi.responses import FileResponse

from ..auth import authenticate_user, create_auth_token
from ..database import get_all_settings, save_settings
from ..schemas import (
    LoginRequest,
    LoginResponse,
    TeamsEmailStartRequest,
    TeamsEmailSubmitRequest
)
from ..browser_auth import (
    run_browser_login,
    run_headless_refresh,
    has_browser_profile
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/login", response_model=LoginResponse)
async def login_endpoint(payload: LoginRequest):
    if not authenticate_user(payload.username, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль"
        )
    settings = await get_all_settings()
    acc_name = (settings.get("account_name") or payload.username).strip()
    token = create_auth_token(payload.username.strip())
    return LoginResponse(
        success=True,
        token=token,
        user={
            "username": payload.username.strip(),
            "name": acc_name
        }
    )

@router.get("/me")
async def get_me_endpoint(request: Request):
    username = getattr(request.state, "username", "admin")
    settings = await get_all_settings()
    acc_name = (settings.get("account_name") or username).strip()
    return {
        "success": True,
        "user": {
            "username": username,
            "name": acc_name
        }
    }

@router.get("/browser-status")
async def browser_status_endpoint():
    return {
        "success": True,
        "has_profile": has_browser_profile()
    }

@router.post("/browser-login")
async def browser_login_endpoint():
    result = await run_browser_login(timeout_seconds=180)
    return result

@router.post("/browser-refresh")
async def browser_refresh_endpoint():
    result = await run_headless_refresh()
    return result

# --- Teams e-mail OTP login ---

@router.post("/teams-email/start")
async def teams_email_start_endpoint(req: TeamsEmailStartRequest):
    from ..teams_email_login import start_email_login
    return await start_email_login(req.email)

@router.post("/teams-email/submit-code")
async def teams_email_submit_endpoint(req: TeamsEmailSubmitRequest):
    from ..teams_email_login import submit_email_code
    return await submit_email_code(req.session_id, req.code, req.remember_me)

@router.get("/teams-email/status/{session_id}")
async def teams_email_status_endpoint(session_id: str):
    from ..teams_email_login import get_email_session_status
    return await get_email_session_status(session_id)

@router.post("/teams-email/cancel")
async def teams_email_cancel_endpoint(payload: dict):
    from ..teams_email_login import cancel_email_login
    return await cancel_email_login(payload.get("session_id", ""))

@router.post("/teams-email/click")
async def teams_email_click_endpoint(payload: dict):
    from ..teams_email_login import click_in_session
    texts = payload.get("texts") or [payload.get("text", "")]
    return await click_in_session(payload.get("session_id", ""), *[t for t in texts if t])

@router.get("/teams-email/shot/{session_id}")
async def teams_email_shot_endpoint(session_id: str, name: Optional[str] = None):
    from ..teams_email_login import get_shot_path
    path = get_shot_path(session_id, name)
    if not path:
        raise HTTPException(status_code=404, detail="Скриншот не найден.")
    return FileResponse(path, media_type="image/png")
