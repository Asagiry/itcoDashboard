import os
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..database import (
    get_tracker_projects,
    get_tracker_issues
)
from ..schemas import (
    TrackerAuthStatusResponse,
    TrackerLogsResponse,
    TrackerPasswordLoginRequest,
    TrackerPasswordLoginResponse,
    TrackerCodeStartRequest,
    TrackerCodeSubmitRequest,
    TrackerProjectSchema,
    TrackerIssueSchema,
    TrackerSyncResponse,
    TrackerStatusUpdateRequest,
    TrackerStatusUpdateResponse
)
from ..tracker_client import (
    get_tracker_auth_status,
    get_tracker_logs,
    run_tracker_password_login,
    start_tracker_code_login,
    submit_tracker_code_login,
    get_tracker_shot_path,
    run_tracker_login,
    logout_tracker,
    fetch_tracker_data,
    update_tracker_issue_status
)

router = APIRouter(prefix="/api/tracker", tags=["tracker"])

@router.get("/status", response_model=TrackerAuthStatusResponse)
async def tracker_status_endpoint():
    status_data = await get_tracker_auth_status()
    return TrackerAuthStatusResponse(**status_data)

@router.get("/logs", response_model=TrackerLogsResponse)
async def tracker_logs_endpoint():
    logs = get_tracker_logs()
    return TrackerLogsResponse(success=True, logs=logs)

@router.post("/auth/password-login", response_model=TrackerPasswordLoginResponse)
async def tracker_password_login_endpoint(req: TrackerPasswordLoginRequest):
    result = await run_tracker_password_login(req.email, req.password)
    return TrackerPasswordLoginResponse(
        success=result.get("success", False),
        message=result.get("message", ""),
        account_name=result.get("account_name", ""),
        issues_count=result.get("issues_count", 0),
        logs=result.get("logs", [])
    )

@router.post("/auth/code-start")
async def tracker_code_start_endpoint(req: TrackerCodeStartRequest):
    result = await start_tracker_code_login(req.email)
    return result

@router.post("/auth/code-submit")
async def tracker_code_submit_endpoint(req: TrackerCodeSubmitRequest):
    result = await submit_tracker_code_login(req.session_id, req.code)
    return result

@router.get("/auth/shot/{session_id}")
async def tracker_shot_endpoint(session_id: str):
    path = get_tracker_shot_path(session_id)
    if not path:
        raise HTTPException(status_code=404, detail="Скриншот не найден.")
    return FileResponse(path, media_type="image/png")

@router.get("/debug-shot")
async def tracker_debug_shot_endpoint():
    shot_path = os.path.join(os.path.dirname(__file__), "..", "..", "tracker_shots", "last_sync_debug.png")
    if not os.path.isfile(shot_path):
        raise HTTPException(status_code=404, detail="Скриншот последней синхронизации ещё не создан.")
    return FileResponse(shot_path, media_type="image/png")

@router.post("/login")
async def tracker_login_endpoint():
    result = await run_tracker_login(timeout_seconds=120)
    return result

@router.post("/logout")
async def tracker_logout_endpoint():
    result = await logout_tracker()
    return result

@router.get("/projects", response_model=List[TrackerProjectSchema])
async def tracker_projects_endpoint():
    projects = await get_tracker_projects()
    return [TrackerProjectSchema(**p) for p in projects]

@router.get("/issues", response_model=List[TrackerIssueSchema])
async def tracker_issues_endpoint(
    project_key: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None
):
    issues = await get_tracker_issues(project_key=project_key, status=status, search=search)
    return [TrackerIssueSchema(**i) for i in issues]

@router.post("/sync", response_model=TrackerSyncResponse)
async def tracker_sync_endpoint():
    res = await fetch_tracker_data(force_refresh=True)
    projects = res.get("projects", [])
    issues = res.get("issues", [])
    return TrackerSyncResponse(
        success=res.get("success", False),
        message=res.get("message", "Синхронизация завершена"),
        projects_count=len(projects),
        issues_count=len(issues),
        projects=[TrackerProjectSchema(**p) for p in projects],
        issues=[TrackerIssueSchema(**i) for i in issues],
        logs=res.get("logs", [])
    )

@router.post("/issues/{issue_key}/status", response_model=TrackerStatusUpdateResponse)
async def tracker_update_status_endpoint(issue_key: str, req: TrackerStatusUpdateRequest):
    res = await update_tracker_issue_status(issue_key, req.status)
    issue_data = res.get("issue")
    return TrackerStatusUpdateResponse(
        success=res.get("success", False),
        message=res.get("message", ""),
        issue=TrackerIssueSchema(**issue_data) if issue_data else None
    )


@router.get("/attachments/{issue_key}/{filename}")
async def tracker_attachment_endpoint(issue_key: str, filename: str):
    clean_key = os.path.basename(issue_key)
    clean_fn = os.path.basename(filename)
    base_media = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "media", "attachments"))
    file_path = os.path.abspath(os.path.join(base_media, clean_key, clean_fn))

    if not file_path.startswith(base_media) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Вложение не найдено.")

    ext = os.path.splitext(clean_fn)[1].lower()
    media_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf"
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=media_type)

