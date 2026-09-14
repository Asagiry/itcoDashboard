import json
import base64
import time
import httpx
from datetime import datetime
from typing import Dict, Any, Tuple, Optional

def decode_token_info(token_str: str) -> Dict[str, Any]:
    """
    Decodes JWT payload to extract expiration time, remaining seconds, and user ID.
    """
    if not token_str or not token_str.strip():
        return {"has_token": False, "status": "empty"}

    raw = token_str.replace("skypetoken=", "").replace("Bearer ", "").strip()
    parts = raw.split(".")
    if len(parts) >= 2:
        try:
            payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
            data = json.loads(base64.urlsafe_b64decode(payload_b64))
            exp = data.get("exp")
            now = int(time.time())

            if exp:
                remaining = exp - now
                expires_dt = datetime.fromtimestamp(exp).strftime("%d.%m.%Y %H:%M:%S")
                iat = data.get("iat")
                issued_dt = datetime.fromtimestamp(iat).strftime("%d.%m.%Y %H:%M:%S") if iat else None
                return {
                    "has_token": True,
                    "is_jwt": True,
                    "exp_timestamp": exp,
                    "expires_at": expires_dt,
                    "issued_at": issued_dt,
                    "is_expired": remaining <= 0,
                    "remaining_seconds": max(0, remaining),
                    "skypeid": data.get("skypeid") or data.get("cid"),
                }
        except Exception:
            pass

    return {
        "has_token": True,
        "is_jwt": False,
        "is_expired": False,
        "remaining_seconds": None,
        "expires_at": None,
        "issued_at": None,
    }


import re
import html
import urllib.parse

def normalize_teams_conversation_url(url: str) -> str:
    """
    Normalizes a Teams chatsvc URL by ensuring the thread/conversation ID in the path is properly URL-encoded.
    e.g. /conversations/19:aebc...@thread.skype/messages -> /conversations/19%3Aaebc...%40thread.skype/messages
    Prevents 404 'Invalid ThreadId.' errors.
    """
    if not url or "conversations/" not in url:
        return url

    pattern = r'(conversations/)([^/]+)(/messages.*)?'
    def replace_conv_id(m):
        prefix = m.group(1)
        conv_id = m.group(2)
        suffix = m.group(3) or ''
        # unquote first to prevent double-encoding
        unquoted = urllib.parse.unquote(conv_id)
        # quote safely (encode : and @)
        encoded = urllib.parse.quote(unquoted, safe='')
        return f"{prefix}{encoded}{suffix}"

    return re.sub(pattern, replace_conv_id, url)

def format_message_for_teams(message: str) -> str:
    """
    Converts plain text into clean Teams HTML:
    - Preserves paragraphs without huge empty void spaces.
    - Preserves single line breaks using <br/>.
    - Preserves indentation and multiple spaces using &nbsp;.
    - Escapes HTML entities (&, <, >).
    """
    if not message or not message.strip():
        return ""

    # Split text into paragraphs separated by one or more blank lines
    raw_paragraphs = re.split(r'\n\s*\n', message.strip())
    html_paragraphs = []

    for para in raw_paragraphs:
        lines = para.split('\n')
        escaped_lines = []
        for line in lines:
            esc = html.escape(line)
            # Preserve leading spaces/indents
            leading_spaces = len(esc) - len(esc.lstrip(' '))
            if leading_spaces > 0:
                esc = ('&nbsp;' * leading_spaces) + esc[leading_spaces:]
            # Preserve consecutive spaces (2 or more)
            esc = re.sub(r' {2,}', lambda m: '&nbsp;' * len(m.group(0)), esc)
            escaped_lines.append(esc)

        # Lines within a single paragraph are separated by clean <br/>
        para_content = "<br/>".join(escaped_lines)
        html_paragraphs.append(f"<p>{para_content}</p>")

    return "".join(html_paragraphs)


_shared_http_client: Optional[httpx.AsyncClient] = None

async def get_shared_http_client() -> httpx.AsyncClient:
    global _shared_http_client
    if _shared_http_client is None or _shared_http_client.is_closed:
        _shared_http_client = httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20, keepalive_expiry=120.0)
        )
    return _shared_http_client

async def send_teams_message(
    url: str,
    message: str,
    auth_header_name: str,
    auth_token: str,
    custom_headers: Optional[Dict[str, str]] = None,
    sender_name: Optional[str] = None
) -> Tuple[bool, int, str]:
    """
    Sends a message to Microsoft Teams chatsvc endpoint.
    Returns (success, status_code, response_text).
    """
    if not url:
        return False, 400, "URL чата Teams не указан в настройках."

    target_url = normalize_teams_conversation_url(url.strip())

    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    }

    # Add auth token if provided
    if auth_token:
        header_name = auth_header_name.strip() if auth_header_name else "Authorization"
        headers[header_name] = auth_token.strip()

    # Add custom extra headers
    if custom_headers:
        for k, v in custom_headers.items():
            if k and v:
                headers[k.strip()] = v.strip()

    clean_message = message.strip()
    formatted_html = format_message_for_teams(clean_message)
    client_msg_id = str(int(time.time() * 1000000))

    # Primary payload: RichText/Html with preserved line breaks and indents
    payload = {
        "content": formatted_html,
        "messagetype": "RichText/Html",
        "contenttype": "text",
        "clientmessageid": client_msg_id,
        "properties": {}
    }
    if sender_name and sender_name.strip():
        payload["imdisplayname"] = sender_name.strip()

    t0 = time.time()
    try:
        client = await get_shared_http_client()
        response = await client.post(target_url, json=payload, headers=headers)
        
        # If 400 with RichText, fallback to clean text
        if response.status_code == 400:
            payload_fallback = {
                "content": clean_message,
                "messagetype": "Text",
                "contenttype": "text",
                "clientmessageid": client_msg_id
            }
            if sender_name and sender_name.strip():
                payload_fallback["imdisplayname"] = sender_name.strip()
            fallback_resp = await client.post(target_url, json=payload_fallback, headers=headers)
            duration = time.time() - t0
            print(f"⚡ [Teams] Fallback отправка сообщения выполнена за {duration:.2f} сек. (HTTP {fallback_resp.status_code})")
            success = fallback_resp.status_code in [200, 201, 202]
            return success, fallback_resp.status_code, fallback_resp.text

        duration = time.time() - t0
        print(f"⚡ [Teams] Отправка сообщения выполнена за {duration:.2f} сек. (HTTP {response.status_code})")
        success = response.status_code in [200, 201, 202]
        return success, response.status_code, response.text
    except httpx.RequestError as exc:
        duration = time.time() - t0
        print(f"❌ [Teams] Ошибка отправки за {duration:.2f} сек.: {exc}")
        return False, 500, f"Сетевая ошибка при запросе к Teams: {str(exc)}"
    except Exception as exc:
        duration = time.time() - t0
        print(f"❌ [Teams] Непредвиденная ошибка за {duration:.2f} сек.: {exc}")
        return False, 500, f"Непредвиденная ошибка: {str(exc)}"
