import re
import shlex
from typing import Dict, Any, Tuple, Optional

def parse_curl_command(curl_command: str) -> Tuple[bool, Optional[str], Optional[str], Optional[str], Dict[str, str], Optional[str]]:
    """
    Parses a cURL command copied from browser DevTools.
    Returns (success, url, auth_header_name, auth_token, headers, error_message).
    """
    try:
        cleaned = curl_command.strip()
        # Remove line continuations
        cleaned = cleaned.replace("\\\r\n", " ").replace("\\\n", " ").replace("\\\r", " ")
        
        # Use shlex to split arguments respecting quotes
        try:
            tokens = shlex.split(cleaned)
        except Exception:
            # Fallback if shlex fails on unescaped chars
            tokens = cleaned.split()

        url = None
        headers: Dict[str, str] = {}
        auth_header_name = None
        auth_token = None

        i = 0
        while i < len(tokens):
            token = tokens[i]

            # Match URL
            if token.startswith("http://") or token.startswith("https://"):
                url = token
            elif (token == "-H" or token == "--header") and i + 1 < len(tokens):
                header_str = tokens[i + 1]
                if ":" in header_str:
                    name, val = header_str.split(":", 1)
                    name = name.strip()
                    val = val.strip()
                    headers[name] = val
                i += 1
            elif token == "--url" and i + 1 < len(tokens):
                url = tokens[i + 1]
                i += 1
            i += 1

        # If URL not found yet, try regex
        if not url:
            url_match = re.search(r"https?://[^\s\"']+", cleaned)
            if url_match:
                url = url_match.group(0).rstrip("'\"")

        # Detect auth headers (prioritize skypetoken/authentication for Teams)
        for h_name, h_val in headers.items():
            lower_name = h_name.lower()
            if "skypetoken=" in h_val or lower_name in ["authentication", "x-skypetoken"]:
                auth_header_name = h_name
                auth_token = h_val
                break

        if not auth_token:
            for h_name, h_val in headers.items():
                if h_name.lower() == "authorization":
                    auth_header_name = h_name
                    auth_token = h_val
                    break

        # If SkypeToken is in cookies or query, also detect
        if not auth_token:
            cookie_header = headers.get("Cookie") or headers.get("cookie")
            if cookie_header and "skypetoken=" in cookie_header:
                match = re.search(r"skypetoken=([^;]+)", cookie_header)
                if match:
                    auth_header_name = "Authentication"
                    auth_token = f"skypetoken={match.group(1)}"

        # Default fallback
        if not auth_header_name and auth_token:
            auth_header_name = "Authorization"

        # Remove auth header from general headers to prevent duplication
        clean_headers = {k: v for k, v in headers.items() if k.lower() not in ["authorization", "authentication", "x-skypetoken", "host", "content-length"]}

        return True, url, auth_header_name, auth_token, clean_headers, None
    except Exception as e:
        return False, None, None, None, {}, f"Ошибка разбора cURL: {str(e)}"
