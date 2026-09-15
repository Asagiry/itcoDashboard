import os
import hmac
import hashlib
import base64
import json
import time
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("itco.auth")

# Try loading .env from project root
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=env_path)
    except ImportError:
        # Fallback simple .env parser if python-dotenv is not yet installed
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'\"")
                        if k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

DEFAULT_SECRET_KEY = "itco-dashboard-super-secure-token-secret-2026"
DEFAULT_PASSWORD = "itcodevelopment"

AUTH_SECRET_KEY = os.environ.get("AUTH_SECRET_KEY", DEFAULT_SECRET_KEY)
VALID_USERNAME = os.environ.get("APP_USERNAME", "vepishin")
VALID_PASSWORD = os.environ.get("APP_PASSWORD", DEFAULT_PASSWORD)

if AUTH_SECRET_KEY == DEFAULT_SECRET_KEY:
    logger.warning("AUTH_SECRET_KEY uses default value. Set AUTH_SECRET_KEY in .env for production.")
if VALID_PASSWORD == DEFAULT_PASSWORD:
    logger.warning("APP_PASSWORD uses default value. Set APP_PASSWORD in .env for production.")


def authenticate_user(username: str, password: str) -> bool:
    if not username or not password:
        return False
    current_username = os.environ.get("APP_USERNAME", VALID_USERNAME)
    current_password = os.environ.get("APP_PASSWORD", VALID_PASSWORD)
    user_ok = hmac.compare_digest(username.strip(), current_username.strip())
    pass_ok = hmac.compare_digest(password.strip(), current_password.strip())
    return user_ok and pass_ok


def create_auth_token(username: str) -> str:
    # 10 years expiration (3650 days) - "вечная сессия"
    secret = os.environ.get("AUTH_SECRET_KEY", AUTH_SECRET_KEY)
    expires_at = int(time.time()) + 3650 * 24 * 3600
    payload = json.dumps({"sub": username, "exp": expires_at}).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload).decode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_auth_token(token: str) -> Optional[str]:
    try:
        if not token or "." not in token:
            return None
        secret = os.environ.get("AUTH_SECRET_KEY", AUTH_SECRET_KEY)
        payload_b64, sig = token.split(".", 1)
        expected_sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8"))
        if data.get("exp") and data["exp"] < time.time():
            return None
        return data.get("sub")
    except Exception:
        return None
