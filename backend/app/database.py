import os
import aiosqlite
from typing import Optional, Dict, Any, List

DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "..", "dashboard.db"))

DEFAULT_DIRECTOR_URL = ""
DEFAULT_DIRECTOR_MESSAGE = "Здравствуйте, я на рабочем месте"

_db_initialized = False

async def ensure_db_initialized():
    global _db_initialized
    if not _db_initialized:
        db_dir = os.path.dirname(os.path.abspath(DB_PATH))
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
        default_seed = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dashboard.db"))
        if not os.path.exists(DB_PATH) and os.path.exists(default_seed) and os.path.abspath(DB_PATH) != default_seed:
            import shutil
            shutil.copy2(default_seed, DB_PATH)
        await init_db()
        _db_initialized = True

async def get_db():
    await ensure_db_initialized()
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                start_time TEXT,
                end_time TEXT,
                status TEXT NOT NULL DEFAULT 'not_started',
                daily_report TEXT DEFAULT '',
                raw_response_start TEXT,
                raw_response_end TEXT,
                report_status TEXT NOT NULL DEFAULT 'not_scheduled',
                report_scheduled_at TEXT,
                report_sent_at TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Auto-migrate existing shifts table if columns are missing
        async with db.execute("PRAGMA table_info(shifts)") as cursor:
            columns = [row[1] for row in await cursor.fetchall()]
            if "report_status" not in columns:
                await db.execute("ALTER TABLE shifts ADD COLUMN report_status TEXT NOT NULL DEFAULT 'not_scheduled'")
            if "report_scheduled_at" not in columns:
                await db.execute("ALTER TABLE shifts ADD COLUMN report_scheduled_at TEXT")
            if "report_sent_at" not in columns:
                await db.execute("ALTER TABLE shifts ADD COLUMN report_sent_at TEXT")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS tracker_projects (
                id TEXT PRIMARY KEY,
                key TEXT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                color TEXT DEFAULT '#3b82f6',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS tracker_issues (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                project_id TEXT,
                project_key TEXT,
                project_name TEXT,
                status TEXT NOT NULL DEFAULT 'todo',
                assignee TEXT DEFAULT '',
                priority TEXT DEFAULT 'normal',
                component TEXT DEFAULT '',
                milestone TEXT DEFAULT '',
                is_bug INTEGER DEFAULT 0,
                time_spent TEXT DEFAULT '',
                comments_count INTEGER DEFAULT 0,
                attachments_count INTEGER DEFAULT 0,
                attachments_json TEXT DEFAULT '[]',
                tracker_url TEXT DEFAULT '',
                raw_data TEXT DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration columns for existing database
        for col_def in [
            "component TEXT DEFAULT ''",
            "milestone TEXT DEFAULT ''",
            "is_bug INTEGER DEFAULT 0",
            "time_spent TEXT DEFAULT ''",
            "comments_count INTEGER DEFAULT 0",
            "attachments_count INTEGER DEFAULT 0",
            "attachments_json TEXT DEFAULT '[]'"
        ]:
            try:
                await db.execute(f"ALTER TABLE tracker_issues ADD COLUMN {col_def}")
            except Exception:
                pass

        # Seed default settings if empty
        defaults = {
            "director_chat_url": DEFAULT_DIRECTOR_URL,
            "director_message_template": DEFAULT_DIRECTOR_MESSAGE,
            "daily_chat_url": "",
            "auth_token": "",
            "auth_header_name": "Authorization",
            "custom_headers": "{}",
            "tracker_url": "https://tracker.itco.su/workbench/itco/tracker/my-issues/issues",
            "tracker_account_name": "",
            "tracker_last_sync": ""
        }

        for key, val in defaults.items():
            await db.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, val)
            )

        await db.commit()

async def get_all_settings() -> Dict[str, str]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT key, value FROM settings") as cursor:
            rows = await cursor.fetchall()
            return {row["key"]: row["value"] for row in rows}

async def save_settings(settings: Dict[str, str]):
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        for key, value in settings.items():
            await db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value)
            )
        await db.commit()

async def get_shift_by_date(date_str: str) -> Optional[Dict[str, Any]]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM shifts WHERE date = ?", (date_str,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

async def create_or_update_shift(date_str: str, **fields) -> Dict[str, Any]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM shifts WHERE date = ?", (date_str,)) as cursor:
            existing = await cursor.fetchone()

        if existing:
            set_clauses = [f"{k} = ?" for k in fields.keys()]
            set_clauses.append("updated_at = CURRENT_TIMESTAMP")
            values = list(fields.values()) + [date_str]
            query = f"UPDATE shifts SET {', '.join(set_clauses)} WHERE date = ?"
            await db.execute(query, values)
        else:
            fields["date"] = date_str
            keys = list(fields.keys())
            placeholders = ", ".join(["?"] * len(keys))
            query = f"INSERT INTO shifts ({', '.join(keys)}) VALUES ({placeholders})"
            await db.execute(query, list(fields.values()))

        await db.commit()

        async with db.execute("SELECT * FROM shifts WHERE date = ?", (date_str,)) as cursor:
            row = await cursor.fetchone()
            return dict(row)

async def get_shift_history(limit: int = 100) -> List[Dict[str, Any]]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM shifts ORDER BY date DESC LIMIT ?", (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def get_pending_scheduled_shifts() -> List[Dict[str, Any]]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM shifts WHERE report_status = 'scheduled' ORDER BY date ASC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def delete_shift_by_date(date_str: str):
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM shifts WHERE date = ?", (date_str,))
        await db.commit()

# --- Tracker Database Functions ---

async def get_tracker_projects() -> List[Dict[str, Any]]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM tracker_projects ORDER BY name ASC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def save_tracker_projects(projects: List[Dict[str, Any]]):
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        for p in projects:
            p_id = p.get("id") or p.get("key") or p.get("name")
            p_key = p.get("key") or p_id
            p_name = p.get("name") or p_key
            p_desc = p.get("description", "")
            p_color = p.get("color", "#3b82f6")
            await db.execute("""
                INSERT INTO tracker_projects (id, key, name, description, color, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    key=excluded.key,
                    name=excluded.name,
                    description=excluded.description,
                    color=excluded.color,
                    updated_at=CURRENT_TIMESTAMP
            """, (p_id, p_key, p_name, p_desc, p_color))
        await db.commit()

async def get_tracker_issues(project_key: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM tracker_issues WHERE 1=1"
        params = []
        if project_key and project_key != "all":
            query += " AND (project_key = ? OR project_id = ?)"
            params.extend([project_key, project_key])
        if status and status != "all":
            query += " AND status = ?"
            params.append(status)
        if search and search.strip():
            s = f"%{search.strip()}%"
            query += " AND (key LIKE ? OR title LIKE ? OR description LIKE ? OR project_name LIKE ?)"
            params.extend([s, s, s, s])
        query += " ORDER BY updated_at DESC, id DESC"
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def save_tracker_issues(issues: List[Dict[str, Any]], replace_all: bool = False):
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        if replace_all:
            await db.execute("DELETE FROM tracker_issues")
        for iss in issues:
            i_id = str(iss.get("id") or iss.get("key") or "")
            if not i_id:
                continue
            i_key = iss.get("key") or i_id
            i_title = iss.get("title") or "Без названия"
            i_desc = iss.get("description", "")
            i_pid = iss.get("project_id", "")
            i_pkey = iss.get("project_key", "")
            i_pname = iss.get("project_name", "")
            i_status = iss.get("status", "todo")
            i_assignee = iss.get("assignee", "")
            i_priority = iss.get("priority", "normal")
            i_component = iss.get("component", "")
            i_milestone = iss.get("milestone", "")
            i_is_bug = 1 if iss.get("is_bug") else 0
            i_time_spent = iss.get("time_spent", "")
            i_comments_count = int(iss.get("comments_count") or 0)
            i_attachments_count = int(iss.get("attachments_count") or 0)
            i_attachments_json = iss.get("attachments_json", "[]")
            if isinstance(i_attachments_json, list):
                import json
                i_attachments_json = json.dumps(i_attachments_json, ensure_ascii=False)
            i_url = iss.get("tracker_url", "")
            i_raw = iss.get("raw_data", "{}")
            if isinstance(i_raw, dict):
                import json
                i_raw = json.dumps(i_raw, ensure_ascii=False)
            await db.execute("""
                INSERT INTO tracker_issues (id, key, title, description, project_id, project_key, project_name, status, assignee, priority, component, milestone, is_bug, time_spent, comments_count, attachments_count, attachments_json, tracker_url, raw_data, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    key=excluded.key,
                    title=excluded.title,
                    description=CASE WHEN excluded.description != '' THEN excluded.description ELSE tracker_issues.description END,
                    project_id=excluded.project_id,
                    project_key=excluded.project_key,
                    project_name=excluded.project_name,
                    status=excluded.status,
                    assignee=excluded.assignee,
                    priority=excluded.priority,
                    component=excluded.component,
                    milestone=excluded.milestone,
                    is_bug=excluded.is_bug,
                    time_spent=excluded.time_spent,
                    comments_count=CASE WHEN excluded.comments_count > 0 THEN excluded.comments_count ELSE tracker_issues.comments_count END,
                    attachments_count=CASE WHEN excluded.attachments_count > 0 THEN excluded.attachments_count ELSE tracker_issues.attachments_count END,
                    attachments_json=CASE WHEN excluded.attachments_json != '[]' AND excluded.attachments_json != '' THEN excluded.attachments_json ELSE tracker_issues.attachments_json END,
                    tracker_url=excluded.tracker_url,
                    raw_data=excluded.raw_data,
                    updated_at=CURRENT_TIMESTAMP
            """, (i_id, i_key, i_title, i_desc, i_pid, i_pkey, i_pname, i_status, i_assignee, i_priority, i_component, i_milestone, i_is_bug, i_time_spent, i_comments_count, i_attachments_count, i_attachments_json, i_url, i_raw))
        await db.commit()

async def update_tracker_issue_status_in_db(issue_key: str, new_status: str) -> Optional[Dict[str, Any]]:
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("""
            UPDATE tracker_issues
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE key = ? OR id = ?
        """, (new_status, issue_key, issue_key))
        await db.commit()
        async with db.execute("SELECT * FROM tracker_issues WHERE key = ? OR id = ?", (issue_key, issue_key)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

async def clear_tracker_data():
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM tracker_issues")
        await db.execute("DELETE FROM tracker_projects")
        await db.commit()
