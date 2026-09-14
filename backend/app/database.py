import os
import aiosqlite
from typing import Optional, Dict, Any, List

DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "..", "dashboard.db"))

DEFAULT_DIRECTOR_URL = (
    "https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/"
    "19%3Auni01_qdehqktmkxxgh2ltgoat43ixmtfsmseojqajsi4iedcs2s6u4kaq%40thread.v2/messages"
)
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Seed default settings if empty
        defaults = {
            "director_chat_url": DEFAULT_DIRECTOR_URL,
            "director_message_template": DEFAULT_DIRECTOR_MESSAGE,
            "daily_chat_url": "",
            "auth_token": "",
            "auth_header_name": "Authorization",
            "custom_headers": "{}"
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

async def delete_shift_by_date(date_str: str):
    await ensure_db_initialized()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM shifts WHERE date = ?", (date_str,))
        await db.commit()

