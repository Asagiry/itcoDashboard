from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

class LoginRequest(BaseModel):
    username: str = Field(..., description="Логин пользователя")
    password: str = Field(..., description="Пароль пользователя")

class LoginResponse(BaseModel):
    success: bool
    token: str
    user: Dict[str, str]

class SettingsSchema(BaseModel):
    director_chat_url: str = Field(..., description="URL чата с руководителем")
    director_message_template: str = Field("Здравствуйте, я на рабочем месте", description="Текст сообщения о начале смены")
    daily_chat_url: str = Field("", description="URL чата для отчётов")
    auth_token: Optional[str] = Field("", description="Токен авторизации (SkypeToken или Bearer)")
    auth_header_name: Optional[str] = Field("Authentication", description="Название заголовка (Authorization или Authentication или x-skypetoken)")
    custom_headers: Optional[str] = Field("{}", description="Дополнительные заголовки в JSON-формате")
    token_info: Optional[Dict[str, Any]] = Field(None, description="Информация о сроке жизни токена")
    has_browser_profile: Optional[bool] = Field(False, description="Наличие сохранённой сессии браузера")
    auto_refresh_active: Optional[bool] = Field(False, description="Флаг автоматического обновления сессии")
    account_name: Optional[str] = Field("", description="Имя пользователя Teams")
    account_status: Optional[str] = Field("active", description="active | inactive")
    last_login_at: Optional[str] = Field(None, description="Время входа / обновления токена")
    monthly_rate: Optional[float] = Field(35000.0, description="Оклад за месяц в рублях")

class ShiftSchema(BaseModel):
    id: Optional[int] = None
    date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    status: str = Field("not_started", description="not_started | in_progress | completed")
    daily_report: Optional[str] = ""
    raw_response_start: Optional[str] = None
    raw_response_end: Optional[str] = None
    report_status: Optional[str] = Field("not_scheduled", description="not_scheduled | scheduled | sending | sent | failed")
    report_scheduled_at: Optional[str] = None
    report_sent_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class StartShiftResponse(BaseModel):
    success: bool
    shift: ShiftSchema
    message: str
    teams_status_code: Optional[int] = None
    teams_response: Optional[str] = None

class EndShiftRequest(BaseModel):
    daily_report: str = Field(..., description="Текст отчета за рабочий день")

class SendReportNowResponse(BaseModel):
    success: bool
    shift: ShiftSchema
    message: str
    teams_status_code: Optional[int] = None
    teams_response: Optional[str] = None

class SaveDraftRequest(BaseModel):
    daily_report: str = Field(..., description="Текст черновика отчета")

class EndShiftResponse(BaseModel):
    success: bool
    shift: ShiftSchema
    message: str
    teams_status_code: Optional[int] = None
    teams_response: Optional[str] = None

class TestTeamsRequest(BaseModel):
    chat_type: str = Field("self", description="self, director или daily")
    custom_message: Optional[str] = "test ping"

class TestTeamsResponse(BaseModel):
    success: bool
    status_code: int
    url: str
    response_body: str
    error: Optional[str] = None

class UpdateShiftRequest(BaseModel):
    start_time: Optional[str] = Field(None, description="Время начала смены (HH:MM:SS или HH:MM)")
    end_time: Optional[str] = Field(None, description="Время завершения смены (HH:MM:SS или HH:MM)")
    duration_hours: Optional[float] = Field(None, description="Длительность смены в часах (например, 8.0)")
    daily_report: Optional[str] = Field(None, description="Текст ежедневного отчета")
    status: Optional[str] = Field(None, description="Статус смены: not_started, in_progress, completed")
    report_status: Optional[str] = Field(None, description="Статус отправки отчёта: not_scheduled, scheduled, sending, sent, failed")
    report_scheduled_at: Optional[str] = Field(None, description="Запланированное время отправки (HH:MM:SS)")
    report_sent_at: Optional[str] = Field(None, description="Фактическое время отправки отчёта (HH:MM:SS)")

class UpdateShiftResponse(BaseModel):
    success: bool
    shift: ShiftSchema
    message: str

class TeamsEmailStartRequest(BaseModel):
    email: str = Field(..., description="E-mail учетной записи Microsoft (Teams)")

class TeamsEmailSubmitRequest(BaseModel):
    session_id: str = Field(..., description="ID сессии входа из start")
    code: str = Field(..., description="Одноразовый код из письма")
    remember_me: bool = Field(True, description="Отметить 'запомнить меня' (KMSI)")

# --- Tracker Schemas ---

class TrackerProjectSchema(BaseModel):
    id: str
    key: str
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#3b82f6"
    updated_at: Optional[str] = None

class TrackerIssueSchema(BaseModel):
    id: str
    key: str
    title: str
    description: Optional[str] = ""
    project_id: Optional[str] = ""
    project_key: Optional[str] = ""
    project_name: Optional[str] = ""
    status: str = Field("todo", description="todo | in_progress | ready_for_testing | testing | review | ready_to_merge")
    assignee: Optional[str] = ""
    priority: Optional[str] = "normal"
    component: Optional[str] = ""
    milestone: Optional[str] = ""
    is_bug: Optional[bool] = False
    time_spent: Optional[str] = ""
    comments_count: Optional[int] = 0
    attachments_count: Optional[int] = 0
    attachments_json: Optional[str] = "[]"
    tracker_url: Optional[str] = ""
    raw_data: Optional[str] = "{}"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class TrackerStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="Новый статус задачи: todo, in_progress, ready_for_testing, testing, review, ready_to_merge")

class TrackerStatusUpdateResponse(BaseModel):
    success: bool
    message: str
    issue: Optional[TrackerIssueSchema] = None

class TrackerSyncResponse(BaseModel):
    success: bool
    message: str
    projects_count: int = 0
    issues_count: int = 0
    projects: List[TrackerProjectSchema] = []
    issues: List[TrackerIssueSchema] = []
    logs: List[str] = []

class TrackerAuthStatusResponse(BaseModel):
    success: bool
    is_authenticated: bool
    account_name: Optional[str] = ""
    workspace: Optional[str] = "itco"
    tracker_url: Optional[str] = ""
    last_sync: Optional[str] = ""

class TrackerPasswordLoginRequest(BaseModel):
    email: str = Field(..., description="E-mail пользователя ITCO Tracker")
    password: str = Field(..., description="Пароль пользователя")

class TrackerPasswordLoginResponse(BaseModel):
    success: bool
    message: str
    account_name: Optional[str] = ""
    issues_count: int = 0
    logs: List[str] = []

class TrackerLogsResponse(BaseModel):
    success: bool
    logs: List[Dict[str, Any]] = []
