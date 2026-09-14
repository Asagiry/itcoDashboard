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
    account_name: Optional[str] = Field("Vladimir Epishin", description="Имя пользователя Teams")
    account_status: Optional[str] = Field("active", description="active | inactive")
    last_login_at: Optional[str] = Field(None, description="Время входа / обновления токена")

class ShiftSchema(BaseModel):
    id: Optional[int] = None
    date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    status: str = Field("not_started", description="not_started | in_progress | completed")
    daily_report: Optional[str] = ""
    raw_response_start: Optional[str] = None
    raw_response_end: Optional[str] = None
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

class SaveDraftRequest(BaseModel):
    daily_report: str = Field(..., description="Текст черновика отчета")

class EndShiftResponse(BaseModel):
    success: bool
    shift: ShiftSchema
    message: str
    teams_status_code: Optional[int] = None
    teams_response: Optional[str] = None

class TestTeamsRequest(BaseModel):
    chat_type: str = Field("director", description="director или daily")
    custom_message: Optional[str] = "Тестовое сообщение из дашборда учета смен."

class TestTeamsResponse(BaseModel):
    success: bool
    status_code: int
    url: str
    response_body: str
    error: Optional[str] = None

class ParseCurlRequest(BaseModel):
    curl_command: str

class ParseCurlResponse(BaseModel):
    success: bool
    url: Optional[str] = None
    auth_header_name: Optional[str] = None
    auth_token: Optional[str] = None
    headers: Dict[str, str] = {}
    error: Optional[str] = None
