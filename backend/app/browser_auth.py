import os
import sys
import re
import html
import json
import time
import asyncio
import signal
import subprocess
import httpx
from typing import List, Dict, Any, Optional, Tuple

libs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "libs"))
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from .database import get_all_settings, save_settings
from .teams_client import decode_token_info

PROFILE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "browser_data"))
CHATS_CACHE_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "teams_chats_cache.json"))

_browser_profile_lock = asyncio.Lock()

def get_chrome_executable_path() -> Optional[str]:
    """
    Returns Chrome/Chromium executable path across Linux, Windows, macOS.
    """
    if sys.platform == "win32":
        candidates = [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ]
        for p in candidates:
            if os.path.isfile(p):
                return p
        return None
    elif sys.platform == "darwin":
        for p in [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        ]:
            if os.path.isfile(p):
                return p
        return None
    else:
        for p in ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]:
            if os.path.isfile(p):
                return p
    return None

def cleanup_browser_profile_locks():
    """
    Cleans up any dangling Chrome processes and stale Chromium Singleton lock files
    (SingletonLock, SingletonSocket, SingletonCookie) to prevent ProcessSingleton errors.
    """
    if sys.platform != "win32":
        try:
            res = subprocess.run(
                ["pgrep", "-f", f"user-data-dir={PROFILE_DIR}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            if res.stdout.strip():
                pids = res.stdout.strip().split()
                for pid in pids:
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except Exception:
                        pass
                time.sleep(0.3)
        except Exception:
            pass

    for fname in ["SingletonLock", "SingletonSocket", "SingletonCookie"]:
        fpath = os.path.join(PROFILE_DIR, fname)
        try:
            if os.path.islink(fpath) or os.path.exists(fpath):
                os.unlink(fpath)
        except Exception:
            pass


def extract_user_profile(profile_dir: str = PROFILE_DIR) -> Dict[str, str]:
    """
    Dynamically extracts the user's real display name and work email from Teams local storage.
    Never relies on hardcoded strings.
    """
    ls_dir = os.path.join(profile_dir, "Default", "Local Storage", "leveldb")
    if os.path.exists(ls_dir):
        for fname in os.listdir(ls_dir):
            if fname.endswith(".ldb") or fname.endswith(".log"):
                fpath = os.path.join(ls_dir, fname)
                try:
                    with open(fpath, "rb") as f:
                        content = f.read()
                        matches = re.findall(b"\"name\":\"([^\"]+)\"[^}]*\"preferred_username\":\"([^\"]+)\"", content)
                        if matches:
                            return {
                                "name": matches[0][0].decode("utf-8", "ignore"),
                                "email": matches[0][1].decode("utf-8", "ignore")
                            }
                        matches_rev = re.findall(b"\"preferred_username\":\"([^\"]+)\"[^}]*\"name\":\"([^\"]+)\"", content)
                        if matches_rev:
                            return {
                                "name": matches_rev[0][1].decode("utf-8", "ignore"),
                                "email": matches_rev[0][0].decode("utf-8", "ignore")
                            }
                except Exception:
                    pass
    return {"name": "", "email": ""}

async def extract_chats_from_page(page) -> List[Dict[str, Any]]:
    """
    Extracts real human chat names and topics from Teams IndexedDB (conversation-manager).
    """
    try:
        raw_chats = await page.evaluate("""async () => {
            const dbs = await window.indexedDB.databases();
            const convDbName = dbs.map(d => d.name).find(n => n.includes("conversation-manager"));
            if (!convDbName) return [];

            function readAll(dbName) {
                return new Promise((resolve) => {
                    const req = indexedDB.open(dbName);
                    req.onsuccess = () => {
                        const db = req.result;
                        const storeNames = Array.from(db.objectStoreNames);
                        if (!storeNames.length) return resolve([]);
                        const tx = db.transaction(storeNames[0], "readonly");
                        const store = tx.objectStore(storeNames[0]);
                        const getAllReq = store.getAll();
                        getAllReq.onsuccess = () => resolve(getAllReq.result);
                        getAllReq.onerror = () => resolve([]);
                    };
                    req.onerror = () => resolve([]);
                });
            }

            const items = await readAll(convDbName);
            const list = [];
            for (const it of items) {
                if (!it || !it.id) continue;
                if (it.id.startsWith("48:notes") || it.id.includes("streamofnotifications") || it.id.includes("streamofcalllogs") || it.id.includes("stream01_")) continue;

                let title = "";
                if (it.threadProperties && it.threadProperties.topic) {
                    title = it.threadProperties.topic;
                } else if (it.chatTitle && it.chatTitle.shortTitle) {
                    title = it.chatTitle.shortTitle;
                } else if (it.chatTitle && it.chatTitle.longTitle) {
                    title = it.chatTitle.longTitle;
                }

                if (!title) {
                    const members = (it.chatTitle && it.chatTitle.avatarUsersInfo) || [];
                    const names = members.map(m => m.displayName).filter(Boolean);
                    if (names.length) title = names.join(", ");
                }

                if (!title) {
                    title = it.id;
                }

                let preview = "";
                if (it.lastMessage && it.lastMessage.content) {
                    preview = it.lastMessage.content.replace(/<[^>]+>/g, "").trim().slice(0, 45);
                }

                list.push({
                    id: it.id,
                    title: title,
                    url: "https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/" + encodeURIComponent(it.id) + "/messages",
                    preview: preview
                });
            }
            return list;
        }""")

        if raw_chats:
            with open(CHATS_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(raw_chats, f, ensure_ascii=False, indent=2)
            return raw_chats
    except Exception as e:
        print(f"Error extracting chats from page: {e}")
    return []

async def fetch_teams_conversations(auth_token: str = "", auth_header_name: str = "Authentication") -> List[Dict[str, Any]]:
    """
    Fetches the list of active Teams conversations with real human names.
    Uses local cache if available, or calls the fast chatsvc HTTP API directly.
    """
    if os.path.exists(CHATS_CACHE_FILE):
        try:
            with open(CHATS_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached and len(cached) > 0:
                return cached
        except Exception:
            pass

    # Fast HTTP API fetch
    if not auth_token:
        settings = await get_all_settings()
        auth_token = settings.get("auth_token", "")
        auth_header_name = settings.get("auth_header_name", "Authentication")

    if not auth_token:
        return []

    headers = {
        auth_header_name: auth_token.strip(),
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    }
    url = "https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=50"

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return []
            data = resp.json()
            convs = data.get("conversations", [])

            chat_list = []
            for c in convs:
                cid = c.get("id", "")
                if not cid or cid.startswith("48:notes") or "stream01_" in cid or "streamof" in cid:
                    continue

                props = c.get("properties", {})
                topic = props.get("topic")

                last_msg = c.get("lastMessage", {})
                content = last_msg.get("content", "")
                clean_content = html.unescape(re.sub(r"<[^>]+>", "", content).strip())
                if len(clean_content) > 45:
                    clean_content = clean_content[:45] + "..."

                title = topic if topic else f"Чат {cid[:25]}..."
                full_url = f"https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/{cid}/messages"

                chat_list.append({
                    "id": cid,
                    "title": title,
                    "url": full_url,
                    "preview": clean_content
                })
            if chat_list:
                try:
                    with open(CHATS_CACHE_FILE, "w", encoding="utf-8") as f:
                        json.dump(chat_list, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
            return chat_list
    except Exception as e:
        print(f"Error fetching conversations via HTTP API: {e}")
        return []

async def run_browser_login(timeout_seconds: int = 120) -> Dict[str, Any]:
    """
    Opens Google Chrome for user to log into Teams, captures skypetoken, saves it, and refreshes chat cache.
    """
    from playwright.async_api import async_playwright

    os.makedirs(PROFILE_DIR, exist_ok=True)
    async with _browser_profile_lock:
        cleanup_browser_profile_locks()
        extracted = {"token": None, "header": "Authentication"}
        token_future = asyncio.get_event_loop().create_future()

        context = None
        try:
            async with async_playwright() as p:
                chrome_exe = get_chrome_executable_path()
                launch_kwargs: Dict[str, Any] = {
                    "user_data_dir": PROFILE_DIR,
                    "headless": False,
                    "args": ["--no-proxy-server", "--start-maximized", "--no-first-run", "--no-default-browser-check"]
                }
                if chrome_exe:
                    launch_kwargs["executable_path"] = chrome_exe
                else:
                    launch_kwargs["channel"] = "chrome"

                context = await p.chromium.launch_persistent_context(**launch_kwargs)

                def on_request(request):
                    for h_name, h_val in request.headers.items():
                        if "skypetoken=" in h_val:
                            if not token_future.done():
                                extracted["token"] = h_val
                                extracted["header"] = h_name
                                token_future.set_result(True)
                        elif h_name.lower() == "x-skypetoken":
                            if not token_future.done():
                                extracted["token"] = "skypetoken=" + h_val.strip()
                                extracted["header"] = "Authentication"
                                token_future.set_result(True)

                context.on("request", on_request)

                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto("https://teams.live.com/v2/", wait_until="domcontentloaded")

                await asyncio.wait_for(token_future, timeout=timeout_seconds)
                token = extracted["token"]
                header = extracted["header"]

                await save_settings({
                    "auth_token": token,
                    "auth_header_name": header
                })

                # Wait a few seconds for chats to sync into IndexedDB and extract them
                await asyncio.sleep(3)
                await extract_chats_from_page(page)
                await context.close()
                context = None

                info = decode_token_info(token)
                return {
                    "success": True,
                    "message": "Вход выполнен успешно! Токен и контакты автоматически сохранены.",
                    "token_info": info
                }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "message": "Время ожидания входа истекло (120 секунд)."
            }
        except Exception as exc:
            return {
                "success": False,
                "message": f"Ошибка при авторизации в браузере: {str(exc)}"
            }
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            cleanup_browser_profile_locks()

async def run_headless_refresh() -> Dict[str, Any]:
    """
    Runs background headless Chrome using saved profile to auto-refresh skypetoken and chat cache.
    Uses --no-proxy-server to prevent proxy failures.
    """
    from playwright.async_api import async_playwright

    if not os.path.exists(PROFILE_DIR):
        return {"success": False, "message": "Профиль браузера не найден. Выполните вход через браузер один раз."}

    async with _browser_profile_lock:
        cleanup_browser_profile_locks()
        extracted = {"token": None, "header": "Authentication"}
        token_future = asyncio.get_event_loop().create_future()

        context = None
        try:
            async with async_playwright() as p:
                chrome_exe = get_chrome_executable_path()
                launch_kwargs: Dict[str, Any] = {
                    "user_data_dir": PROFILE_DIR,
                    "headless": True,
                    "args": ["--no-proxy-server", "--no-first-run", "--no-default-browser-check"]
                }
                if chrome_exe:
                    launch_kwargs["executable_path"] = chrome_exe
                else:
                    launch_kwargs["channel"] = "chrome"

                context = await p.chromium.launch_persistent_context(**launch_kwargs)

                def on_request(request):
                    for h_name, h_val in request.headers.items():
                        if "skypetoken=" in h_val:
                            if not token_future.done():
                                extracted["token"] = h_val
                                extracted["header"] = h_name
                                token_future.set_result(True)
                        elif h_name.lower() == "x-skypetoken":
                            if not token_future.done():
                                extracted["token"] = "skypetoken=" + h_val.strip()
                                extracted["header"] = "Authentication"
                                token_future.set_result(True)

                context.on("request", on_request)

                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto("https://teams.live.com/v2/", wait_until="domcontentloaded")

                await asyncio.wait_for(token_future, timeout=25)
                token = extracted["token"]
                header = extracted["header"]

                await save_settings({
                    "auth_token": token,
                    "auth_header_name": header
                })

                # Refresh chats cache
                await asyncio.sleep(2)
                await extract_chats_from_page(page)
                await context.close()
                context = None

                info = decode_token_info(token)
                return {
                    "success": True,
                    "message": "Сессия Teams успешно обновлена в фоновом режиме!",
                    "token_info": info
                }
        except Exception as e:
            return {"success": False, "message": f"Фоновое обновление не удалось: {str(e)}"}
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            cleanup_browser_profile_locks()

async def ensure_active_token(force_refresh: bool = False) -> Tuple[str, str]:
    """
    Checks if current skypetoken is valid. If missing, expired, or about to expire in < 15 mins,
    and browser profile exists, automatically runs headless silent refresh.
    Returns (auth_header_name, auth_token).
    """
    settings = await get_all_settings()
    token = settings.get("auth_token", "")
    header = settings.get("auth_header_name", "Authentication")

    if token and not force_refresh:
        info = decode_token_info(token)
        if info.get("has_token") and info.get("is_jwt"):
            rem = info.get("remaining_seconds") or 0
            if not info.get("is_expired") and rem > 900:
                return header, token

    # Token is expired or expiring soon, or force_refresh requested
    if os.path.exists(PROFILE_DIR) and len(os.listdir(PROFILE_DIR)) > 0:
        # Re-check settings in case another call already refreshed it
        settings = await get_all_settings()
        token = settings.get("auth_token", "")
        header = settings.get("auth_header_name", "Authentication")
        if token and not force_refresh:
            info = decode_token_info(token)
            rem = info.get("remaining_seconds") or 0
            if not info.get("is_expired") and rem > 900:
                return header, token

        print("🔄 Автоматическое фоновое обновление сессии Teams через сохранённый профиль браузера...")
        res = await run_headless_refresh()
        if res.get("success"):
            fresh_settings = await get_all_settings()
            return fresh_settings.get("auth_header_name", "Authentication"), fresh_settings.get("auth_token", "")
        else:
            print(f"⚠️ Не удалось фоново обновить сессию Teams: {res.get('message')}")

    return header, token
