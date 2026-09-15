"""
Вход в Teams по одноразовому коду из письма (passwordless, HasPassword=0).

Сценарий (проверен по живому трафику login.live.com):
  1. POST /api/auth/teams-email/start {email}
     - headless-Chromium открывает https://teams.live.com/v2/,
       его редиректит на login.live.com/oauth20_authorize...,
       вводит e-mail, жмет Далее, выбирает/жмет "отправить код"
       (OTCNotAutoSent=1 — код сам не уходит, нужен клик).
  2. Пользователь читает код в почте и вызывает
     POST /api/auth/teams-email/submit-code {session_id, code}
     - бэкенд вводит код, отмечает "запомнить меня" (KMSI),
       ждет редиректа на teams.live.com, снимает skypetoken
       из сетевых запросов и сохраняет в БД.
Браузер между шагами живет в памяти (сессия), профиль — общий
backend/browser_data, поэтому "запомнить меня" прилипает навсегда.
"""
import os
import sys
import uuid
import time
import asyncio
from typing import Dict, Any, Optional

libs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "libs"))
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from .database import save_settings
from .teams_client import decode_token_info
from .browser_auth import (
    PROFILE_DIR,
    CHATS_CACHE_FILE,
    _browser_profile_lock,
    cleanup_browser_profile_locks,
    get_chrome_executable_path,
    extract_chats_from_page,
    extract_token_from_storage,
    set_email_login_active,
    enable_fast_routing,
)

SHOTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "email_login_shots"))
SESSION_TTL_SEC = 600

_sessions: Dict[str, Dict[str, Any]] = {}


def _launch_kwargs() -> Dict[str, Any]:
    chrome_exe = get_chrome_executable_path()
    args = [
        "--no-proxy-server",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
    ]
    try:
        # В Docker-контейнере работаем от root — без этих флагов Chromium не стартует
        if os.geteuid() == 0:
            args += ["--no-sandbox", "--disable-dev-shm-usage"]
    except AttributeError:
        pass  # Windows: geteuid отсутствует
    kwargs: Dict[str, Any] = {
        "user_data_dir": PROFILE_DIR,
        "headless": True,
        "args": args,
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "viewport": {"width": 1280, "height": 800},
        "locale": "ru-RU",
        "timezone_id": "Europe/Moscow",
        "ignore_default_args": ["--enable-automation"],
    }
    if chrome_exe:
        kwargs["executable_path"] = chrome_exe
    return kwargs



async def _shot(session: Dict[str, Any], name: str) -> Optional[str]:
    try:
        os.makedirs(SHOTS_DIR, exist_ok=True)
        path = os.path.join(SHOTS_DIR, f"{session['sid']}_{name}.png")
        await session["page"].screenshot(path=path)
        session["shots"][name] = path
        session["last_shot"] = name
        return path
    except Exception:
        return None


async def _describe_page(page) -> Dict[str, Any]:
    """Короткий слепок страницы для диагностики: url + видимые поля/кнопки."""
    try:
        data = await page.evaluate("""() => {
            const vis = (el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            };
            const inputs = [];
            for (const el of document.querySelectorAll('input')) {
                if (!vis(el)) continue;
                inputs.push({type: el.type, name: el.name, id: el.id,
                             placeholder: el.placeholder || '',
                             value: (el.value || '').slice(0, 40),
                             checked: !!el.checked});
            }
            const buttons = [];
            for (const el of document.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')) {
                if (!vis(el)) continue;
                const t = (el.innerText || el.value || '').trim().slice(0, 80);
                if (t) buttons.push(t);
            }
            // плитки вариантов входа (div с текстом e-mail / "код")
            const tiles = [];
            for (const el of document.querySelectorAll('[role=button], div[data-testid], button')) {
                if (!vis(el)) continue;
                const t = (el.innerText || '').trim().slice(0, 120);
                if (t && t.length < 120 && !buttons.includes(t)) tiles.push(t);
            }
            return {url: location.href.split('?')[0], title: document.title.slice(0, 120),
                    inputs, buttons: buttons.slice(0, 20), tiles: tiles.slice(0, 20)};
        }""")
        return data
    except Exception as e:
        return {"error": str(e)}


async def _wait_for_any_selector(page, selectors: list, timeout_ms: int = 4000, poll_ms: int = 80):
    """Ожидает появления любого из переданных селекторов, возвращает (handle, selector) сразу при обнаружении."""
    deadline = time.time() + (timeout_ms / 1000.0)
    while time.time() < deadline:
        for sel in selectors:
            try:
                el = await page.query_selector(sel)
                if el and await el.is_visible():
                    return el, sel
            except Exception:
                pass
        await asyncio.sleep(poll_ms / 1000.0)
    return None, None


async def _click_button_like(page, *needles: str, timeout_ms: int = 3000) -> bool:
    """Кликает кнопку/текст, содержащий любую из подстрок (регистр не важен), как только она станет видимой."""
    needles_l = [n.lower() for n in needles]
    deadline = time.time() + (timeout_ms / 1000.0)
    while time.time() < deadline:
        try:
            handles = await page.query_selector_all("button, input[type=submit], input[type=button], [role=button], a")
            for h in handles:
                try:
                    if not await h.is_visible():
                        continue
                    txt = ((await h.inner_text()) or "").strip()
                    if not txt and await h.get_attribute("type") == "submit":
                        txt = (await h.get_attribute("value")) or ""
                    if any(n in txt.lower() for n in needles_l):
                        await h.click()
                        return True
                except Exception:
                    continue
            for n in needles:
                try:
                    loc = page.get_by_text(n, exact=False).first
                    if await loc.is_visible():
                        await loc.click()
                        return True
                except Exception:
                    continue
        except Exception:
            pass
        await asyncio.sleep(0.08)
    return False


def _page_is_limited(desc: Dict[str, Any]) -> bool:
    blob = " ".join([desc.get("title", "")] + desc.get("buttons", []) + desc.get("tiles", [])).lower()
    return "reached your limit" in blob or "limit with this" in blob


async def _check_remember_me(page) -> bool:
    """Отмечает чекбоксы 'запомнить меня / keep me signed in' если есть."""
    try:
        boxes = await page.query_selector_all('input[type="checkbox"]')
        checked_any = False
        for b in boxes:
            try:
                if await b.is_visible() and not await b.is_checked():
                    await b.check()
                    checked_any = True
            except Exception:
                continue
        return checked_any
    except Exception:
        return False


def _cleanup_session(sid: str) -> None:
    sess = _sessions.pop(sid, None)
    if sess and sess.get("token_future") and not sess["token_future"].done():
        sess["token_future"].cancel()
    if not _sessions:
        set_email_login_active(False)


async def _close_session_browser(sess: Dict[str, Any]) -> None:
    ctx = sess.pop("context", None)
    pw = sess.pop("playwright", None)
    try:
        if ctx is not None:
            await ctx.close()
    except Exception:
        pass
    try:
        if pw is not None:
            await pw.stop()
    except Exception:
        pass
    cleanup_browser_profile_locks()


async def start_email_login(email: str) -> Dict[str, Any]:
    from playwright.async_api import async_playwright

    email = (email or "").strip()
    if not email or "@" not in email:
        return {"success": False, "message": "Укажите корректный e-mail."}

    # чистим протухшие сессии
    now = time.time()
    for sid, s in list(_sessions.items()):
        if now - s.get("created_at", now) > SESSION_TTL_SEC:
            await _close_session_browser(s)
            _cleanup_session(sid)

    sid = uuid.uuid4().hex[:8]
    session: Dict[str, Any] = {
        "sid": sid, "email": email, "status": "starting",
        "created_at": now, "shots": {}, "last_shot": None,
        "page": None, "context": None, "playwright": None,
        "token_future": None, "extracted": {"token": None, "header": "Authentication"},
    }
    _sessions[sid] = session
    set_email_login_active(True)

    async with _browser_profile_lock:
        cleanup_browser_profile_locks()
        os.makedirs(PROFILE_DIR, exist_ok=True)
        loop = asyncio.get_event_loop()
        session["token_future"] = loop.create_future()
        pw = None
        try:
            pw = await async_playwright().start()
            session["playwright"] = pw
            context = await pw.chromium.launch_persistent_context(**_launch_kwargs())
            session["context"] = context
            await enable_fast_routing(context)
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {} };
            """)

            def on_request(request):
                try:
                    for h_name, h_val in request.headers.items():
                        if "skypetoken=" in h_val:
                            if not session["token_future"].done():
                                session["extracted"] = {"token": h_val, "header": h_name}
                                session["token_future"].set_result(True)
                        elif h_name.lower() == "x-skypetoken":
                            if not session["token_future"].done():
                                session["extracted"] = {"token": "skypetoken=" + h_val.strip(), "header": "Authentication"}
                                session["token_future"].set_result(True)
                except Exception:
                    pass

            context.on("request", on_request)
            page = context.pages[0] if context.pages else await context.new_page()
            session["page"] = page

            # Если в профиле уже живая сессия — токен поймается сразу
            try:
                await page.goto("https://teams.live.com/v2/", wait_until="domcontentloaded", timeout=10000)
            except Exception:
                pass

            tok = await extract_token_from_storage(page)
            if tok:
                session["extracted"] = tok
            if session["extracted"]["token"]:
                return await _finish_success(session, "Сессия уже активна, новый код не понадобился.")

            # Ждем редирект на login.live.com; Teams без сессии может показать
            # маркетинговую страницу (/gather) — тогда жмем Sign in сами.
            on_login = False
            try:
                if "login.live.com" in page.url:
                    on_login = True
                else:
                    await page.wait_for_url("**/login.live.com/**", timeout=5000)
                    on_login = True
            except Exception:
                pass

            if not on_login:
                await _click_button_like(page, "отклонить", "reject", "принять", "accept", "необязательные", timeout_ms=1000)
                await _click_button_like(page, "sign in", "войти", "log in", timeout_ms=1500)
                try:
                    if "login.live.com" in page.url:
                        on_login = True
                    else:
                        await page.wait_for_url("**/login.live.com/**", timeout=8000)
                        on_login = True
                except Exception:
                    on_login = False

            if not on_login:
                await _shot(session, "no_redirect")
                desc = await _describe_page(page)
                session["status"] = "need_check"
                return {"success": False, "session_id": sid, "stage": "no_redirect",
                        "message": "Не попали на страницу входа Microsoft.", "page": desc}

            # Быстрый динамический поиск поля ввода e-mail
            email_selectors = [
                'input[name="loginfmt"]', '#usernameEntry', '#i0116',
                'input[type="email"]', 'input[name="login"]', 'input[type="text"]'
            ]
            email_input, _ = await _wait_for_any_selector(page, email_selectors, timeout_ms=5000)

            if email_input is None:
                # может уже этап выбора аккаунта/кода — снимаем состояние
                await _shot(session, "unknown_stage")
                desc = await _describe_page(page)
                session["status"] = "need_check"
                opts = desc.get("buttons", []) + desc.get("tiles", [])
                return {"success": True, "session_id": sid, "stage": "unknown",
                        "message": "Страница входа в неожиданном состоянии, нужен взгляд.",
                        "options": opts[:12], "page": desc}

            await email_input.fill(email)
            await _check_remember_me(page)
            await _shot(session, "email_filled")

            # Далее
            clicked = await _click_button_like(page, "далее", "next", "продолжить", "войти", timeout_ms=2000)
            if not clicked:
                try:
                    await page.keyboard.press("Enter")
                except Exception:
                    pass

            await asyncio.sleep(0.3)

            # Проверяем, не появилось ли поле подтверждения email (proofConfirmationText)
            proof_selectors = ['#proofConfirmationText', 'input[name="proofConfirmation"]', 'input[name="otc_proof"]']
            proof_input, _ = await _wait_for_any_selector(page, proof_selectors, timeout_ms=2000)
            if proof_input:
                try:
                    await proof_input.fill(email)
                    await _click_button_like(page, "далее", "next", "отправить", "send", timeout_ms=2000)
                    await asyncio.sleep(0.3)
                except Exception:
                    pass

            # Если открылся ввод пароля — пробуем переключиться на код на почту
            pwd_el, _ = await _wait_for_any_selector(page, ['input[type="password"]', '#i0118'], timeout_ms=1500)
            if pwd_el:
                await _click_button_like(
                    page,
                    "одноразовый код", "код по электронной почте", "отправить код",
                    "другие способы", "other ways", "use a code", "email a code",
                    "sign in with a code", timeout_ms=2000
                )
                await asyncio.sleep(0.3)

            # Если уже поле кода — отлично, иначе ищем кнопку "отправить код"
            has_code = await _page_has_code_input_async(page)
            if not has_code:
                await _click_button_like(
                    page, "отправить код", "send code", "получить код", "код",
                    "отправить", "текст", "email", "письмо", timeout_ms=2000)
                await asyncio.sleep(0.3)
                has_code = await _page_has_code_input_async(page)

            await _shot(session, "after_email")
            desc = await _describe_page(page)
            if not has_code:
                has_code = _page_has_code_input(desc)

            if _page_is_limited(desc):
                # Microsoft временно режет отправку кодов (наш лимит исчерпан
                # несколькими запросами подряд). Код НЕ отправлен.
                await _click_button_like(page, "Sign in a different way", "другим способом", timeout_ms=2000)
                await asyncio.sleep(0.3)
                await _shot(session, "limited_options")
                desc = await _describe_page(page)
                session["status"] = "limited"
                opts = desc.get("buttons", []) + desc.get("tiles", [])
                return {"success": False, "session_id": sid, "stage": "limited",
                        "message": ("Microsoft временно ограничил отправку кодов на почту "
                                    "(слишком частые запросы). Подождите 30–60 минут и нажмите "
                                    "«Отправить код» один раз. Либо выберите другой способ ниже."),
                        "options": opts[:12], "page": desc}

            session["status"] = "code_sent" if has_code else "need_check"
            await _check_remember_me(page)
            opts = desc.get("buttons", []) + desc.get("tiles", [])
            return {"success": True, "session_id": sid, "stage": session["status"],
                    "message": ("Код отправлен на почту. Введите его в дашборде."
                                if session["status"] == "code_sent"
                                else "Microsoft ожидает подтверждения или выбора действия. Введите код, если получили, либо выберите вариант ниже."),
                    "options": opts[:12],
                    "page": desc}
        except Exception as e:
            await _close_session_browser(session)
            _cleanup_session(sid)
            return {"success": False, "message": f"Не удалось начать вход: {e}"}


def _page_has_code_input(desc: Dict[str, Any]) -> bool:
    for i in desc.get("inputs", []):
        nm = (i.get("name") or "").lower()
        iid = (i.get("id") or "").lower()
        ph = (i.get("placeholder") or "").lower()
        tp = (i.get("type") or "").lower()
        if iid.startswith("code") or nm in ("otc", "code", "otp", "securitycode", "proofcode") or "otc" in iid or "otc" in nm:
            return True
        if "код" in ph or "code" in ph or "one-time" in ph:
            return True
        if tp in ("text", "tel", "number", "") and ("код" in ph or "code" in ph):
            return True
    for b in desc.get("buttons", []) + desc.get("tiles", []):
        bl = b.lower()
        if "ввести код" in bl or "enter code" in bl or "проверить код" in bl or "verify" in bl:
            return True
    return False


async def _page_has_code_input_async(page) -> bool:
    for sel in [
        "#codeEntry-0", "#idTxtBx_OTC_Password",
        'input[name="otc"]', 'input[name="code"]', 'input[name="otp"]',
        'input[name="ProofCode"]', 'input[name="securitycode"]'
    ]:
        try:
            el = await page.query_selector(sel)
            if el and await el.is_visible():
                return True
        except Exception:
            pass
    return False


async def submit_email_code(session_id: str, code: str, remember_me: bool = True) -> Dict[str, Any]:
    session = _sessions.get(session_id)
    if not session:
        return {"success": False, "message": "Сессия входа не найдена или истекла. Начните заново."}
    code = (code or "").strip().replace(" ", "")
    if not code:
        return {"success": False, "message": "Введите код из письма."}
    page = session.get("page")
    if page is None:
        return {"success": False, "message": "Браузер сессии уже закрыт. Начните заново."}

    async with _browser_profile_lock:
        try:
            filled = False
            # Вариант А: 6 отдельных окошек codeEntry-0..5 (современный UI Microsoft)
            first_box = await page.query_selector("#codeEntry-0")
            if first_box and await first_box.is_visible():
                try:
                    await first_box.click()
                    await page.keyboard.type(code, delay=20)
                    filled = True
                except Exception:
                    pass

                # Страховка: если автопереход не сработал для всех окошек
                for idx in range(min(len(code), 6)):
                    try:
                        box = await page.query_selector(f"#codeEntry-{idx}")
                        if box:
                            val = await box.input_value()
                            if not val:
                                await box.fill(code[idx])
                    except Exception:
                        pass

            # Вариант Б: одиночное поле кода
            if not filled:
                for sel in [
                    '#idTxtBx_OTC_Password', 'input[name="ProofCode"]', 'input[name="otc"]',
                    'input[name="code"]', 'input[name="otp"]', 'input[name="securitycode"]',
                    'input[type="tel"]', 'input[type="text"]', 'input[type="number"]'
                ]:
                    try:
                        el = await page.query_selector(sel)
                        if el and await el.is_visible():
                            await el.click()
                            await el.fill(code)
                            filled = True
                            break
                    except Exception:
                        continue

            if not filled:
                await _shot(session, "code_input_not_found")
                desc = await _describe_page(page)
                return {"success": False, "session_id": session_id,
                        "message": "Не найдено поле для ввода кода на странице. Проверьте снимок экрана.",
                        "page": desc}

            if remember_me:
                await _check_remember_me(page)

            await _shot(session, "code_filled")
            clicked = await _click_button_like(page, "войти", "проверить", "verify", "sign in",
                                               "далее", "next", "продолжить", "отправить", "submit", "#idSIButton9",
                                               timeout_ms=1500)
            if not clicked:
                try:
                    await page.keyboard.press("Enter")
                except Exception:
                    pass

            # Быстрое реактивное ожидание токена и обработка KMSI
            deadline = time.time() + 25.0
            kmsi_handled = False
            while time.time() < deadline:
                # 1. Проверяем токен из сети
                if session["extracted"]["token"]:
                    return await _finish_success(session, "Вход выполнен! Токен сохранен.")

                # 2. Проверяем хранилище браузера
                tok = await extract_token_from_storage(page)
                if tok:
                    session["extracted"] = tok
                    return await _finish_success(session, "Вход выполнен! Токен сохранен.")

                # 3. Обработка экрана KMSI ("Остаться в системе?")
                if not kmsi_handled:
                    try:
                        kmsi_chk = await page.query_selector('#KmsiCheckboxField, input[name="DontShowAgain"]')
                        if kmsi_chk and await kmsi_chk.is_visible():
                            kmsi_handled = True
                            if not await kmsi_chk.is_checked():
                                await kmsi_chk.check()
                            await _click_button_like(page, "да", "yes", "остаться в системе", "stay signed", "#idSIButton9", timeout_ms=1000)
                    except Exception:
                        pass

                await asyncio.sleep(0.12)

            await _shot(session, "need_attention")
            desc = await _describe_page(page)
            session["status"] = "need_check"
            return {"success": False, "session_id": session_id,
                    "message": "Код не принят или нужен дополнительный шаг. Смотрите снимок экрана.",
                    "page": desc}
        except Exception as e:
            return {"success": False, "session_id": session_id, "message": f"Ошибка при вводе кода: {e}"}



async def _finish_success(session: Dict[str, Any], message: str) -> Dict[str, Any]:
    token = session["extracted"]["token"]
    header = session["extracted"]["header"]
    await save_settings({"auth_token": token, "auth_header_name": header})
    page = session.get("page")
    if page is not None:
        try:
            await extract_chats_from_page(page)
        except Exception:
            pass
    sid = session["sid"]
    await _close_session_browser(session)
    _cleanup_session(sid)
    return {"success": True, "message": message, "token_info": decode_token_info(token)}


async def get_email_session_status(session_id: str) -> Dict[str, Any]:
    session = _sessions.get(session_id)
    if not session:
        return {"success": False, "message": "Сессия не найдена."}
    page = session.get("page")
    desc = await _describe_page(page) if page else {}
    return {"success": True, "session_id": session_id, "status": session.get("status"),
            "email": session.get("email"), "page": desc,
            "last_shot": session.get("last_shot")}


async def click_in_session(session_id: str, *needles: str) -> Dict[str, Any]:
    """Отладочный клик по кнопке/тексту внутри живой сессии (для нестандартных страниц)."""
    session = _sessions.get(session_id)
    if not session or session.get("page") is None:
        return {"success": False, "message": "Сессия не найдена."}
    page = session["page"]
    async with _browser_profile_lock:
        try:
            ok = await _click_button_like(page, *needles, timeout_ms=8000)
            await page.wait_for_timeout(2500)
            await _shot(session, "after_click")
            desc = await _describe_page(page)
            # вдруг токен поймался сам (уже залогинен)
            if session["extracted"]["token"]:
                return await _finish_success(session, "Вход выполнен! Токен сохранен.")
            return {"success": ok, "session_id": session_id,
                    "message": "Клик выполнен." if ok else "Кнопка не найдена.",
                    "page": desc}
        except Exception as e:
            return {"success": False, "session_id": session_id, "message": f"Ошибка клика: {e}"}


async def cancel_email_login(session_id: str) -> Dict[str, Any]:
    session = _sessions.get(session_id)
    if not session:
        return {"success": True, "message": "Сессия уже завершена."}
    async with _browser_profile_lock:
        await _close_session_browser(session)
        _cleanup_session(session_id)
    return {"success": True, "message": "Сессия входа отменена."}


def get_shot_path(session_id: str, name: Optional[str] = None) -> Optional[str]:
    session = _sessions.get(session_id)
    if not session:
        # поищем файл напрямую (сессия могла уже закрыться после успеха)
        if name:
            p = os.path.join(SHOTS_DIR, f"{session_id}_{name}.png")
            return p if os.path.isfile(p) else None
        return None
    if name:
        p = session["shots"].get(name)
        return p if p and os.path.isfile(p) else None
    last = session.get("last_shot")
    if last:
        p = session["shots"].get(last)
        if p and os.path.isfile(p):
            return p
    return None
