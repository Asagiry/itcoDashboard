import os
import hmac
import hashlib
import base64
import json
import time
from typing import Optional

AUTH_SECRET_KEY = os.environ.get("AUTH_SECRET_KEY", "itco-dashboard-super-secure-token-secret-2026")
VALID_USERNAME = os.environ.get("APP_USERNAME", "vepishin")
VALID_PASSWORD = os.environ.get("APP_PASSWORD", "itcodevelopment")

def authenticate_user(username: str, password: str) -> bool:
    if not username or not password:
        return False
    # Constant-time comparison
    user_ok = hmac.compare_digest(username.strip(), VALID_USERNAME)
    pass_ok = hmac.compare_digest(password.strip(), VALID_PASSWORD)
    return user_ok and pass_ok

def create_auth_token(username: str) -> str:
    # 10 years expiration (3650 days) - "вечная сессия"
    expires_at = int(time.time()) + 3650 * 24 * 3600
    payload = json.dumps({"sub": username, "exp": expires_at}).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload).decode("utf-8")
    sig = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"

def verify_auth_token(token: str) -> Optional[str]:
    try:
        if not token or "." not in token:
            return None
        payload_b64, sig = token.split(".", 1)
        expected_sig = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8"))
        if data.get("exp") and data["exp"] < time.time():
            return None
        return data.get("sub")
    except Exception:
        return None
