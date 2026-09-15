import os
import sys
import re
import json
import time
import uuid
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

libs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "libs"))
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from .database import (
    get_all_settings,
    save_settings,
    get_tracker_projects,
    save_tracker_projects,
    get_tracker_issues,
    save_tracker_issues,
    update_tracker_issue_status_in_db,
    clear_tracker_data
)
from .browser_auth import (
    get_chrome_executable_path,
    container_chrome_args
)

TRACKER_PROFILE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tracker_browser_data"))
TRACKER_SHOTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tracker_shots"))
TRACKER_BASE_URL = "https://tracker.itco.su"
TRACKER_LOGIN_URL = "https://tracker.itco.su/login"
TRACKER_ISSUES_URL = "https://tracker.itco.su/workbench/itco/tracker/my-issues/issues"

_tracker_lock = asyncio.Lock()
_tracker_sessions: Dict[str, Dict[str, Any]] = {}
_tracker_logs: List[Dict[str, Any]] = []

STATUS_COLUMN_HEADERS = {
    "todo": ["todo", "to do", "к выполнению", "backlog", "бэклог", "icebox", "new", "новый", "open"],
    "in_progress": ["in progress", "в работе", "progress", "doing"],
    "ready_for_testing": ["ready for testing", "готово к тестированию", "ready for test", "на тестирование"],
    "testing": ["testing", "тестирование", "in qa", "qa"],
    "review": ["review", "ревью", "на ревью", "code review"],
    "ready_to_merge": ["ready for production", "done", "готово", "готово к мержу", "ready to merge", "closed", "закрыто", "canceled", "отменено", "выполнено"]
}


def add_tracker_log(message: str, level: str = "info"):
    """Appends a timestamped log entry to the in-memory log buffer."""
    ts = datetime.now().strftime("%H:%M:%S")
    entry = {"time": ts, "message": message, "level": level}
    _tracker_logs.append(entry)
    if len(_tracker_logs) > 200:
        _tracker_logs.pop(0)
    print(f"[{ts}] [Tracker:{level.upper()}] {message}")


def get_tracker_logs() -> List[Dict[str, Any]]:
    """Returns the latest in-memory Tracker stage logs."""
    return list(_tracker_logs)


def clear_tracker_logs():
    """Clears the in-memory Tracker log buffer."""
    _tracker_logs.clear()


def normalize_tracker_status(raw_status: Optional[str]) -> str:
    """
    Maps raw status names from Huly Tracker (RU / EN / Cyrillic) to 6 canonical status keys:
    - todo
    - in_progress
    - ready_for_testing
    - testing
    - review
    - ready_to_merge
    """
    if not raw_status:
        return "todo"
    s = raw_status.strip().lower()

    if s in ("todo", "in_progress", "ready_for_testing", "testing", "review", "ready_to_merge"):
        return s

    s_norm = s.replace("_", " ").replace("-", " ")

    if any(k in s_norm for k in ["готово к мержу", "ready to merge", "ready for merge", "мерж", "merge", "ready for production", "production"]):
        return "ready_to_merge"
    if any(k in s_norm for k in ["ревью", "review", "код ревью", "code review", "на ревью"]):
        return "review"
    if any(k in s_norm for k in ["готово к тест", "ready for test", "ready to test", "ready for qa", "qa ready", "to test", "ready_for_testing", "ready for testing", "на тестирование"]):
        return "ready_for_testing"
    if any(k in s_norm for k in ["тестир", "testing", "in qa", "qa", "test"]):
        return "testing"
    if any(k in s_norm for k in ["в работе", "в процессе", "in progress", "progress", "doing", "active"]):
        return "in_progress"
    if any(k in s_norm for k in ["к выполнению", "todo", "to do", "бэклог", "backlog", "new", "open", "новый", "открыт", "icebox"]):
        return "todo"
    if any(k in s_norm for k in ["готово", "done", "closed", "закрыт", "выполнен", "resolved", "canceled", "отменен"]):
        return "ready_to_merge"

    return "todo"


def cleanup_tracker_locks():
    """Removes lingering Chrome lock files in tracker_browser_data profile."""
    for fname in ["SingletonLock", "SingletonSocket", "SingletonCookie"]:
        fpath = os.path.join(TRACKER_PROFILE_DIR, fname)
        try:
            if os.path.islink(fpath) or os.path.exists(fpath):
                os.unlink(fpath)
        except Exception:
            pass


async def get_tracker_auth_status() -> Dict[str, Any]:
    """Checks if Tracker browser profile exists and has saved credentials/session."""
    has_profile = os.path.exists(TRACKER_PROFILE_DIR) and len(os.listdir(TRACKER_PROFILE_DIR)) > 0
    settings = await get_all_settings()
    acc_name = settings.get("tracker_account_name", "")
    last_sync = settings.get("tracker_last_sync", "")
    tracker_url = settings.get("tracker_url", TRACKER_ISSUES_URL)

    return {
        "success": True,
        "is_authenticated": has_profile,
        "account_name": acc_name or ("Авторизован в ITCO Tracker" if has_profile else ""),
        "workspace": "itco",
        "tracker_url": tracker_url,
        "last_sync": last_sync
    }


def _launch_headless_kwargs() -> Dict[str, Any]:
    chrome_exe = get_chrome_executable_path()
    args = [
        "--no-proxy-server",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
    ] + container_chrome_args()
    kwargs: Dict[str, Any] = {
        "user_data_dir": TRACKER_PROFILE_DIR,
        "headless": True,
        "args": args,
        "viewport": {"width": 1280, "height": 800},
        "locale": "ru-RU",
        "timezone_id": "Europe/Moscow",
        "ignore_default_args": ["--enable-automation"],
    }
    if chrome_exe:
        kwargs["executable_path"] = chrome_exe
    return kwargs


async def _handle_workspace_selection(page, timeout: int = 15) -> bool:
    """
    Handles the /login/selectWorkspace screen in Huly by finding and clicking the 'itco' workspace.
    """
    start_t = time.time()
    while time.time() - start_t < timeout:
        cur_url = page.url
        if "/workbench/itco" in cur_url or ("/workbench" in cur_url and "selectWorkspace" not in cur_url):
            return True

        if "selectWorkspace" in cur_url:
            add_tracker_log("🏢 Экран выбора рабочего пространства (selectWorkspace)...")
            await page.wait_for_timeout(1000)

            # Click workspace element
            clicked = False
            for selector in [
                'button:has-text("itco")',
                'div:has-text("itco")',
                'a:has-text("itco")',
                'button:has-text("ITCO")',
                'div:has-text("ITCO")',
                'a:has-text("ITCO")',
                '[data-workspace="itco"]',
                '[class*="workspace"]',
                '[class*="card"]',
                '[role="button"]',
                'button'
            ]:
                try:
                    loc = page.locator(selector).first
                    if await loc.is_visible():
                        add_tracker_log(f"👆 Клик по рабочему пространству ({selector})...")
                        await loc.click()
                        clicked = True
                        await page.wait_for_timeout(1500)
                        break
                except Exception:
                    continue

            if not clicked:
                try:
                    await page.evaluate(r"""() => {
                        const items = Array.from(document.querySelectorAll('button, [role="button"], a, div'));
                        const itco = items.find(el => (el.innerText || '').toLowerCase().includes('itco'));
                        if (itco) itco.click();
                        else {
                            const btn = document.querySelector('button, [role="button"]');
                            if (btn) btn.click();
                        }
                    }""")
                    await page.wait_for_timeout(1500)
                except Exception:
                    pass

        await page.wait_for_timeout(1000)

    return "/workbench" in page.url


def parse_issues_from_raw_text(text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Parses issues and projects from raw innerText stream of Huly Kanban / list view.
    Supports Cyrillic keys (e.g. МКС-189) and Latin keys (e.g. ITCO-102).
    """
    lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
    issues: List[Dict[str, Any]] = []
    projects_map: Dict[str, Dict[str, Any]] = {}

    current_status = "todo"
    key_regex = re.compile(r'^([A-Za-zА-Яа-яЁё0-9]{2,10}-\d+)$')

    def detect_column_status(line_txt: str) -> Optional[str]:
        t = line_txt.lower().strip()
        for stat, aliases in STATUS_COLUMN_HEADERS.items():
            if t in aliases:
                return stat
        return None

    i = 0
    while i < len(lines):
        line = lines[i]

        col_stat = detect_column_status(line)
        if col_stat:
            current_status = col_stat
            i += 1
            if i < len(lines) and lines[i].isdigit():
                i += 1
            continue

        m = key_regex.match(line)
        if m:
            key = m.group(1).upper()
            project_key = key.split('-')[0]
            title = ""
            if i + 1 < len(lines):
                next_l = lines[i + 1]
                if not key_regex.match(next_l) and not detect_column_status(next_l):
                    title = next_l

            if not any(iss["key"] == key for iss in issues):
                issues.append({
                    "id": key,
                    "key": key,
                    "title": title or key,
                    "description": "",
                    "project_id": project_key.lower(),
                    "project_key": project_key,
                    "project_name": project_key,
                    "status": current_status,
                    "priority": "normal",
                    "tracker_url": f"https://tracker.itco.su/workbench/itco/tracker/{key}"
                })
                if project_key not in projects_map:
                    projects_map[project_key] = {
                        "id": project_key.lower(),
                        "key": project_key,
                        "name": project_key,
                        "description": "",
                        "color": "#3b82f6"
                    }
        i += 1

    return issues, list(projects_map.values())


async def extract_and_save_tracker_data(page) -> Dict[str, Any]:
    """
    Extracts all projects and user issues from the open Tracker page using deep DOM analysis
    and text stream parsing with full Cyrillic (e.g. МКС-189) and Latin support.
    """
    os.makedirs(TRACKER_SHOTS_DIR, exist_ok=True)
    try:
        # 1. Take a debug screenshot
        shot_path = os.path.join(TRACKER_SHOTS_DIR, "last_sync_debug.png")
        try:
            await page.screenshot(path=shot_path)
            add_tracker_log("📸 Снимок страницы сохранён (last_sync_debug.png)")
        except Exception:
            pass

        # 2. Extract text dump for debugging and backup parsing
        body_text = ""
        try:
            body_text = await page.inner_text("body")
            dump_path = os.path.join(TRACKER_SHOTS_DIR, "last_sync_text.txt")
            with open(dump_path, "w", encoding="utf-8") as f:
                f.write(body_text)
        except Exception:
            pass

        # 3. Deep JS DOM extractor with full Unicode / Cyrillic regex
        dom_data = await page.evaluate(r"""() => {
            const issues = [];
            const projectsMap = {};
            const clean = (txt) => (txt || '').replace(/\s+/g, ' ').trim();

            // Match both Latin and Cyrillic issue keys like МКС-189, ITCO-102
            const keyRegex = /([A-Za-zА-Яа-яЁё0-9]{2,10}-\d+)/gu;
            const bodyText = document.body ? document.body.innerText : '';
            const allMatches = bodyText.match(keyRegex) || [];
            const uniqueKeys = Array.from(new Set(allMatches));

            for (const key of uniqueKeys) {
                const upperKey = key.toUpperCase();
                const projectKey = upperKey.split('-')[0] || 'ITCO';

                const treeWalker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode: (node) => {
                            return node.nodeValue && node.nodeValue.includes(key)
                                ? NodeFilter.FILTER_ACCEPT
                                : NodeFilter.FILTER_SKIP;
                        }
                    }
                );

                let targetNode = treeWalker.nextNode();
                let container = null;

                if (targetNode && targetNode.parentElement) {
                    let cur = targetNode.parentElement;
                    for (let step = 0; step < 8 && cur && cur !== document.body; step++) {
                        const rect = cur.getBoundingClientRect();
                        if (rect.height >= 22 && rect.height <= 500 && rect.width >= 100) {
                            container = cur;
                            if (
                                cur.getAttribute('role') === 'row' ||
                                cur.getAttribute('role') === 'listitem' ||
                                (cur.className && typeof cur.className === 'string' && (
                                    cur.className.includes('card') ||
                                    cur.className.includes('row') ||
                                    cur.className.includes('item') ||
                                    cur.className.includes('issue')
                                ))
                            ) {
                                break;
                            }
                        }
                        cur = cur.parentElement;
                    }
                }

                let fullText = container ? container.innerText : '';
                let title = '';
                let statusText = '';
                let fullUrl = window.location.origin + '/workbench/itco/tracker/' + encodeURIComponent(upperKey);

                if (container) {
                    const linkEl = container.querySelector('a[href*="issue"], a[href*="tracker"]') || (container.tagName === 'A' ? container : null);
                    if (linkEl && linkEl.getAttribute('href')) {
                        const href = linkEl.getAttribute('href');
                        fullUrl = href.startsWith('http') ? href : window.location.origin + href;
                    }

                    const titleEl = container.querySelector('[class*="title"], [class*="summary"], [class*="name"], h3, h4, h5, a');
                    if (titleEl && titleEl.innerText) {
                        const candidate = clean(titleEl.innerText);
                        if (candidate && candidate !== key && candidate.length > 2) {
                            title = candidate;
                        }
                    }

                    if (!title) {
                        const lines = fullText.split('\n').map(clean).filter(Boolean);
                        title = lines.find(l => l !== key && !l.includes(key) && l.length > 3) || key;
                    }

                    const statusEl = container.querySelector('[class*="status"], [class*="state"], [class*="badge"]');
                    if (statusEl && statusEl.innerText) {
                        statusText = clean(statusEl.innerText);
                    }

                    if (!statusText) {
                        let colParent = container.parentElement;
                        for (let c = 0; c < 6 && colParent && colParent !== document.body; c++) {
                            const headerEl = colParent.querySelector('[class*="header"], [class*="title"], h2, h3');
                            if (headerEl && headerEl.innerText) {
                                const hText = clean(headerEl.innerText).toLowerCase();
                                if (['todo', 'to do', 'к выполнению', 'in progress', 'в работе', 'ready for testing', 'готово к тестированию', 'testing', 'тестирование', 'review', 'ревью', 'ready for production', 'ready to merge', 'done', 'готово'].some(kw => hText.includes(kw))) {
                                    statusText = hText;
                                    break;
                                }
                            }
                            colParent = colParent.parentElement;
                        }
                    }
                }

                if (!statusText) {
                    const textLower = (fullText || '').toLowerCase();
                    for (const sName of ['ready for production', 'готово к мержу', 'ready to merge', 'review', 'ревью', 'ready for testing', 'готово к тестированию', 'testing', 'тестирование', 'in progress', 'в работе', 'todo', 'to do', 'к выполнению', 'done', 'готово']) {
                        if (textLower.includes(sName)) {
                            statusText = sName;
                            break;
                        }
                    }
                }

                issues.push({
                    id: upperKey,
                    key: upperKey,
                    title: title || upperKey,
                    description: '',
                    project_id: projectKey.toLowerCase(),
                    project_key: projectKey,
                    project_name: projectKey,
                    status_raw: statusText || 'todo',
                    tracker_url: fullUrl,
                    priority: 'normal'
                });

                if (!projectsMap[projectKey]) {
                    projectsMap[projectKey] = {
                        id: projectKey.toLowerCase(),
                        key: projectKey,
                        name: projectKey,
                        description: '',
                        color: '#3b82f6'
                    };
                }
            }

            return {
                issues,
                projects: Object.values(projectsMap)
            };
        }""")

        raw_issues = dom_data.get("issues", [])
        raw_projects = dom_data.get("projects", [])

        # 4. Text-stream fallback if DOM extractor returned fewer issues than text stream
        if body_text:
            text_issues, text_projects = parse_issues_from_raw_text(body_text)
            if len(text_issues) > len(raw_issues):
                add_tracker_log(f"📋 Извлечено {len(text_issues)} задач из текстового потока страницы...")
                raw_issues = text_issues
                raw_projects = text_projects

        normalized_issues = []
        for iss in raw_issues:
            status_raw = iss.pop("status_raw", "")
            norm_status = normalize_tracker_status(status_raw or iss.get("status"))
            
            # Filter out ready for production if requested
            if "production" in (status_raw or "").lower():
                continue
                
            iss["status"] = norm_status
            iss["assignee"] = iss.get("assignee") or "vepishin@it-co.ru"
            normalized_issues.append(iss)

        if raw_projects:
            await save_tracker_projects(raw_projects)

        if normalized_issues:
            # Purge any old tasks not in the freshly extracted user-assigned list
            fresh_keys = [iss["key"] for iss in normalized_issues if iss.get("key")]
            if fresh_keys:
                import aiosqlite
                from .database import DB_PATH
                async with aiosqlite.connect(DB_PATH) as db:
                    placeholders = ",".join(["?"] * len(fresh_keys))
                    await db.execute(f"DELETE FROM tracker_issues WHERE key NOT IN ({placeholders})", fresh_keys)
                    await db.commit()

            await save_tracker_issues(normalized_issues)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await save_settings({"tracker_last_sync": now_str})

        add_tracker_log(f"📦 Сохранено в базу: {len(normalized_issues)} назначенных задач, {len(raw_projects)} проектов", "success")

        fresh_projects = await get_tracker_projects()
        fresh_issues = await get_tracker_issues()

        return {
            "success": True,
            "projects": fresh_projects,
            "issues": fresh_issues
        }
    except Exception as e:
        err_msg = f"Ошибка извлечения данных со страницы: {e}"
        add_tracker_log(err_msg, "error")
        return {"success": False, "error": str(e), "projects": [], "issues": []}


async def run_tracker_password_login(email: str, password: str) -> Dict[str, Any]:
    """
    Headless login via Email & Password with full stage logging and selectWorkspace support.
    """
    import httpx
    from playwright.async_api import async_playwright

    clear_tracker_logs()
    email = (email or "").strip()
    password = (password or "").strip()

    if not email or "@" not in email:
        add_tracker_log("❌ Укажите корректный e-mail.", "error")
        return {"success": False, "message": "Укажите корректный e-mail.", "logs": [l["message"] for l in get_tracker_logs()]}
    if not password:
        add_tracker_log("❌ Введите пароль.", "error")
        return {"success": False, "message": "Введите пароль.", "logs": [l["message"] for l in get_tracker_logs()]}

    add_tracker_log(f"🔐 Проверка учётных данных {email} в API Tracker...")

    # 1. Direct Instant API Pre-check
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://tracker.itco.su/_accounts",
                json={"method": "login", "params": {"email": email, "password": password}},
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                    "Referer": "https://tracker.itco.su/login",
                    "x-timezone": "Europe/Moscow"
                }
            )
            data = resp.json()
            if "error" in data:
                err_code = str(data["error"].get("code", "") or data["error"])
                add_tracker_log(f"❌ Ошибка проверки API: {err_code}", "error")
                if "AccountNotFound" in err_code:
                    return {"success": False, "message": "Учётная запись не найдена или неверный логин.", "logs": [l["message"] for l in get_tracker_logs()]}
                elif "InvalidPassword" in err_code or "Password" in err_code:
                    return {"success": False, "message": "Неверный пароль от ITCO Tracker.", "logs": [l["message"] for l in get_tracker_logs()]}
                else:
                    return {"success": False, "message": f"Ошибка авторизации: {err_code}", "logs": [l["message"] for l in get_tracker_logs()]}

            add_tracker_log(f"✅ Учётные данные подтверждены API Huly (аккаунт: {email})", "success")
    except Exception as e:
        add_tracker_log(f"⚠️ Пре-чек API пропущен ({e}), продолжаем авторизацию через браузер...", "warning")

    # 2. Establish Headless Playwright Session
    os.makedirs(TRACKER_PROFILE_DIR, exist_ok=True)
    os.makedirs(TRACKER_SHOTS_DIR, exist_ok=True)

    async with _tracker_lock:
        cleanup_tracker_locks()
        context = None
        try:
            add_tracker_log("🌐 Запуск изолированной сессии Chromium...")
            async with async_playwright() as p:
                context = await p.chromium.launch_persistent_context(**_launch_headless_kwargs())
                page = context.pages[0] if context.pages else await context.new_page()

                page.on("console", lambda msg: print(f"[TrackerBrowser] {msg.text[:120]}"))

                add_tracker_log(f"📄 Открытие страницы авторизации {TRACKER_LOGIN_URL}...")
                await page.goto(TRACKER_LOGIN_URL, wait_until="domcontentloaded")
                await page.wait_for_timeout(2000)

                # Locate email and password inputs
                email_input = await page.query_selector('input[name="email"], input[type="email"], input[type="text"]')
                pwd_input = await page.query_selector('input[name="current-password"], input[type="password"]')

                if not email_input or not pwd_input:
                    add_tracker_log("❌ Поля ввода логина/пароля не найдены на странице", "error")
                    return {
                        "success": False,
                        "message": "Не найдены поля ввода логина/пароля на странице входа.",
                        "logs": [l["message"] for l in get_tracker_logs()]
                    }

                add_tracker_log("🔑 Заполнение формы и отправка учётных данных...")
                await email_input.fill(email)
                await pwd_input.fill(password)
                await page.wait_for_timeout(300)

                # Click Log In button
                login_btn = await page.query_selector('button:has-text("Log In"), button:has-text("Войти"), form button')
                if login_btn:
                    await login_btn.click()
                else:
                    await pwd_input.press("Enter")

                add_tracker_log("⏳ Ожидание перехода в рабочее пространство...")

                # Handle workspace selection (selectWorkspace) or workbench transition
                in_workbench = await _handle_workspace_selection(page, timeout=18)
                if in_workbench:
                    add_tracker_log(f"🚀 Вход в рабочее пространство выполнен! URL: {page.url}", "success")
                else:
                    add_tracker_log(f"⚠️ Ожидание перехода. Текущий адрес: {page.url}", "warning")

                # Navigate to user issues
                add_tracker_log("🚀 Переход к разделу задач: /workbench/itco/tracker/my-issues/issues...")
                if "tracker/my-issues/issues" not in page.url:
                    await page.goto(TRACKER_ISSUES_URL, wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)

                # Wait for issues to appear in DOM via WebSocket sync
                add_tracker_log("⏳ Ожидание загрузки карточек задач из Huly (WebSocket)...")
                for i in range(14):
                    count = await page.evaluate(r"""() => {
                        const body = document.body ? document.body.innerText : '';
                        const matches = body.match(/([A-Za-zА-Яа-яЁё0-9]{2,10}-\d+)/gu);
                        return matches ? new Set(matches).size : 0;
                    }""")
                    if count > 0:
                        add_tracker_log(f"🔍 Обнаружено {count} задач на странице (шаг {i+1})...", "success")
                        await page.wait_for_timeout(2000)
                        break
                    await page.wait_for_timeout(1000)

                # Extract and save data
                extract_res = await extract_and_save_tracker_data(page)
                issues = extract_res.get("issues", [])

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                await save_settings({
                    "tracker_account_name": email,
                    "tracker_last_sync": now_str,
                    "tracker_auth_status": "active"
                })

                await context.close()
                context = None

                add_tracker_log(f"🎉 Вход и синхронизация успешно завершены! Задач: {len(issues)}", "success")

                return {
                    "success": True,
                    "message": f"Успешный вход в ITCO Tracker под {email}! Загружено задач: {len(issues)}",
                    "account_name": email,
                    "issues_count": len(issues),
                    "logs": [l["message"] for l in get_tracker_logs()]
                }
        except Exception as e:
            err_msg = f"Ошибка авторизации в Tracker: {e}"
            add_tracker_log(f"❌ {err_msg}", "error")
            return {
                "success": False,
                "message": err_msg,
                "logs": [l["message"] for l in get_tracker_logs()]
            }
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            cleanup_tracker_locks()


async def fetch_tracker_data(force_refresh: bool = False) -> Dict[str, Any]:
    """
    Fetches projects and user issues from ITCO Tracker.
    """
    cached_projects = await get_tracker_projects()
    cached_issues = await get_tracker_issues()

    if not force_refresh and (cached_projects or cached_issues):
        return {
            "success": True,
            "message": "Данные загружены из локального кэша.",
            "projects": cached_projects,
            "issues": cached_issues,
            "logs": [l["message"] for l in get_tracker_logs()]
        }

    if not os.path.exists(TRACKER_PROFILE_DIR) or len(os.listdir(TRACKER_PROFILE_DIR)) == 0:
        add_tracker_log("⚠️ Сессия ITCO Tracker не найдена. Требуется вход.", "warning")
        return {
            "success": False,
            "message": "Сессия ITCO Tracker не найдена. Пожалуйста, выполните вход.",
            "projects": cached_projects,
            "issues": cached_issues,
            "logs": [l["message"] for l in get_tracker_logs()]
        }

    from playwright.async_api import async_playwright

    clear_tracker_logs()
    add_tracker_log("🔄 Запуск синхронизации с ITCO Tracker...")

    async with _tracker_lock:
        cleanup_tracker_locks()
        context = None
        try:
            async with async_playwright() as p:
                add_tracker_log("🌐 Запуск браузерной сессии...")
                context = await p.chromium.launch_persistent_context(**_launch_headless_kwargs())
                page = context.pages[0] if context.pages else await context.new_page()

                add_tracker_log(f"🚀 Открытие {TRACKER_ISSUES_URL}...")
                await page.goto(TRACKER_ISSUES_URL, wait_until="domcontentloaded")
                await page.wait_for_timeout(2000)

                # Check if landed on selectWorkspace
                if "selectWorkspace" in page.url:
                    await _handle_workspace_selection(page, timeout=10)
                    if "tracker/my-issues/issues" not in page.url:
                        await page.goto(TRACKER_ISSUES_URL, wait_until="domcontentloaded")

                # Wait for issues to load
                add_tracker_log("⏳ Ожидание обновления карточек задач (WebSocket)...")
                for i in range(14):
                    count = await page.evaluate(r"""() => {
                        const body = document.body ? document.body.innerText : '';
                        const matches = body.match(/([A-Za-zА-Яа-яЁё0-9]{2,10}-\d+)/gu);
                        return matches ? new Set(matches).size : 0;
                    }""")
                    if count > 0:
                        add_tracker_log(f"🔍 Найдено {count} задач в DOM...", "success")
                        await page.wait_for_timeout(2000)
                        break
                    await page.wait_for_timeout(1000)

                # Extract and save
                res = await extract_and_save_tracker_data(page)
                issues = res.get("issues", [])

                await context.close()
                context = None

                fresh_projects = await get_tracker_projects()
                fresh_issues = await get_tracker_issues()

                add_tracker_log(f"🎉 Синхронизация завершена! Всего задач: {len(fresh_issues)}", "success")

                return {
                    "success": True,
                    "message": f"Синхронизация с ITCO Tracker успешно завершена! Загружено задач: {len(fresh_issues)}",
                    "projects": fresh_projects,
                    "issues": fresh_issues,
                    "logs": [l["message"] for l in get_tracker_logs()]
                }
        except Exception as e:
            err_msg = f"Ошибка синхронизации с Tracker: {e}"
            add_tracker_log(f"❌ {err_msg}", "error")
            return {
                "success": False,
                "message": err_msg,
                "projects": cached_projects,
                "issues": cached_issues,
                "logs": [l["message"] for l in get_tracker_logs()]
            }
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            cleanup_tracker_locks()


async def update_tracker_issue_status(issue_key: str, new_status: str) -> Dict[str, Any]:
    """
    Updates the status of an issue in ITCO Tracker and updates local cache.
    """
    target_status = normalize_tracker_status(new_status)
    allowed_transitions = ["todo", "in_progress", "ready_for_testing", "testing", "review", "ready_to_merge"]
    if target_status not in allowed_transitions:
        return {
            "success": False,
            "message": f"Недопустимый статус для ручного перевода: '{new_status}'. Доступны: {', '.join(allowed_transitions)}"
        }

    # First update in local DB
    updated = await update_tracker_issue_status_in_db(issue_key, target_status)
    if not updated:
        return {
            "success": False,
            "message": f"Задача с ключом '{issue_key}' не найдена в базе данных."
        }

    # Attempt to apply change on live Tracker via headless browser session if available
    if os.path.exists(TRACKER_PROFILE_DIR) and len(os.listdir(TRACKER_PROFILE_DIR)) > 0:
        asyncio.create_task(_apply_status_change_in_tracker(issue_key, target_status))

    status_labels = {
        "todo": "TODO",
        "in_progress": "In progress",
        "ready_for_testing": "ready for testing",
        "testing": "Testing",
        "review": "review",
        "ready_to_merge": "ready for merge"
    }

    return {
        "success": True,
        "message": f"Статус задачи {issue_key} изменён на «{status_labels.get(target_status, target_status)}»",
        "issue": updated
    }


async def _apply_status_change_in_tracker(issue_key: str, target_status: str):
    """Background task to click status dropdown in Tracker web page."""
    from playwright.async_api import async_playwright

    async with _tracker_lock:
        cleanup_tracker_locks()
        context = None
        try:
            async with async_playwright() as p:
                context = await p.chromium.launch_persistent_context(**_launch_headless_kwargs())
                page = context.pages[0] if context.pages else await context.new_page()

                target_url = f"https://tracker.itco.su/workbench/itco/tracker/{issue_key}"
                await page.goto(target_url, wait_until="domcontentloaded")
                await page.wait_for_timeout(2000)

                status_texts = {
                    "todo": ["TODO", "To Do", "К выполнению", "Todo"],
                    "in_progress": ["In Progress", "In progress", "В работе"],
                    "ready_for_testing": ["Ready for testing", "Ready for Testing", "Готово к тестированию", "ready for testing"],
                    "testing": ["Testing", "Тестирование", "In QA", "QA"],
                    "review": ["Review", "Ревью", "review"],
                    "ready_to_merge": ["Ready for merge", "Ready to merge", "Готово к мержу", "Ready for production", "Done", "Готово"]
                }
                needles = status_texts.get(target_status, [])

                for needle in needles:
                    try:
                        loc = page.get_by_text(needle, exact=False).first
                        if await loc.is_visible():
                            await loc.click()
                            await page.wait_for_timeout(1000)
                            break
                    except Exception:
                        pass

                await context.close()
                context = None
        except Exception as e:
            print(f"Background status sync to Tracker for {issue_key} failed: {e}")
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            cleanup_tracker_locks()


async def logout_tracker() -> Dict[str, Any]:
    """Clears saved browser profile, cookies, and database cache for ITCO Tracker."""
    import shutil
    async with _tracker_lock:
        cleanup_tracker_locks()
        if os.path.exists(TRACKER_PROFILE_DIR):
            try:
                shutil.rmtree(TRACKER_PROFILE_DIR, ignore_errors=True)
            except Exception as e:
                print(f"Error removing tracker profile directory: {e}")

        await clear_tracker_data()
        await save_settings({
            "tracker_account_name": "",
            "tracker_last_sync": "",
            "tracker_auth_status": "none"
        })
        clear_tracker_logs()
        add_tracker_log("🚪 Сессия трекера успешно закрыта, локальные данные удалены.")

        return {
            "success": True,
            "message": "Вы успешно вышли из ITCO Tracker."
        }


def get_tracker_shot_path(session_id: str) -> Optional[str]:
    session = _tracker_sessions.get(session_id)
    if session and session.get("shot_path") and os.path.isfile(session["shot_path"]):
        return session["shot_path"]
    shot_path = os.path.join(TRACKER_SHOTS_DIR, f"{session_id}_start.png")
    if os.path.isfile(shot_path):
        return shot_path
    last_debug = os.path.join(TRACKER_SHOTS_DIR, "last_sync_debug.png")
    return last_debug if os.path.isfile(last_debug) else None


async def run_tracker_login(timeout_seconds: int = 120) -> Dict[str, Any]:
    """Interactive browser login (opens Chromium window if available)."""
    from playwright.async_api import async_playwright
    os.makedirs(TRACKER_PROFILE_DIR, exist_ok=True)
    async with _tracker_lock:
        cleanup_tracker_locks()
        context = None
        try:
            async with async_playwright() as p:
                chrome_exe = get_chrome_executable_path()
                launch_kwargs: Dict[str, Any] = {
                    "user_data_dir": TRACKER_PROFILE_DIR,
                    "headless": False,
                    "args": ["--no-proxy-server", "--start-maximized"] + container_chrome_args()
                }
                if chrome_exe:
                    launch_kwargs["executable_path"] = chrome_exe
                context = await p.chromium.launch_persistent_context(**launch_kwargs)
                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto(TRACKER_LOGIN_URL, wait_until="domcontentloaded")
                start_t = time.time()
                success = False
                while time.time() - start_t < timeout_seconds:
                    if "/workbench/itco" in page.url or ("tracker" in page.url and "/login" not in page.url):
                        success = True
                        break
                    await asyncio.sleep(1)
                if not success:
                    return {"success": False, "message": "Время ожидания входа истекло."}
                await asyncio.sleep(2)
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                await save_settings({"tracker_last_sync": now_str, "tracker_auth_status": "active"})
                await extract_and_save_tracker_data(page)
                await context.close()
                context = None
                return {"success": True, "message": "Вход в ITCO Tracker выполнен успешно!"}
        except Exception as e:
            return {"success": False, "message": f"Ошибка входа: {e}"}
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            cleanup_tracker_locks()


async def start_tracker_code_login(email: str) -> Dict[str, Any]:
    """Headless code login initialization."""
    return {"success": False, "message": "Вход по одноразовому коду временно недоступен. Используйте пароль."}


async def submit_tracker_code_login(session_id: str, code: str) -> Dict[str, Any]:
    """Headless code login submission."""
    return {"success": False, "message": "Вход по одноразовому коду временно недоступен. Используйте пароль."}
