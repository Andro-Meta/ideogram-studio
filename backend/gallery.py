"""
Gallery — async SQLite CRUD for generation history.
All DB access goes through the connection stored in app.state.db.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

import aiosqlite

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'pending',
    prompt_json     TEXT,
    prompt_text     TEXT,
    settings_json   TEXT NOT NULL DEFAULT '{}',
    image_path      TEXT,
    seed            INTEGER,
    width           INTEGER,
    height          INTEGER,
    sampler_preset  TEXT,
    model_variant   TEXT,
    duration_ms     INTEGER,
    created_at      TEXT NOT NULL,
    error_message   TEXT,
    favorite        INTEGER NOT NULL DEFAULT 0
)
"""

_ROW_KEYS = [
    "id", "status", "prompt_json", "prompt_text", "settings_json",
    "image_path", "seed", "width", "height", "sampler_preset",
    "model_variant", "duration_ms", "created_at", "error_message",
    "favorite",
]


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return dict(zip(_ROW_KEYS, row))


async def init_db(db: aiosqlite.Connection) -> None:
    await db.execute(CREATE_TABLE)
    # Migration for databases created before the favorite column existed
    async with db.execute("PRAGMA table_info(jobs)") as cur:
        columns = {row[1] for row in await cur.fetchall()}
    if "favorite" not in columns:
        await db.execute(
            "ALTER TABLE jobs ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0"
        )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)"
    )
    await db.commit()


async def create_job(
    db: aiosqlite.Connection,
    *,
    job_id: str | None = None,
    prompt_json: str | None = None,
    prompt_text: str | None = None,
    settings_json: str = "{}",
    seed: int | None = None,
    width: int | None = None,
    height: int | None = None,
    sampler_preset: str | None = None,
    model_variant: str | None = None,
) -> str:
    job_id = job_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO jobs (id, status, prompt_json, prompt_text, settings_json,
           seed, width, height, sampler_preset, model_variant, created_at)
           VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (job_id, prompt_json, prompt_text, settings_json,
         seed, width, height, sampler_preset, model_variant, now),
    )
    await db.commit()
    return job_id


async def complete_job(
    db: aiosqlite.Connection,
    job_id: str,
    *,
    image_path: str,
    seed: int,
    duration_ms: int,
) -> None:
    await db.execute(
        """UPDATE jobs SET status='done', image_path=?, seed=?, duration_ms=?
           WHERE id=?""",
        (image_path, seed, duration_ms, job_id),
    )
    await db.commit()


async def fail_job(
    db: aiosqlite.Connection,
    job_id: str,
    error_message: str,
) -> None:
    await db.execute(
        "UPDATE jobs SET status='failed', error_message=? WHERE id=?",
        (error_message, job_id),
    )
    await db.commit()


async def get_job(db: aiosqlite.Connection, job_id: str) -> dict | None:
    async with db.execute(
        f"SELECT {', '.join(_ROW_KEYS)} FROM jobs WHERE id=?", (job_id,)
    ) as cur:
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def list_jobs(
    db: aiosqlite.Connection,
    *,
    page: int = 1,
    per_page: int = 20,
    status: str | None = "done",
    search: str | None = None,
    favorites_only: bool = False,
) -> tuple[list[dict], int]:
    offset = (page - 1) * per_page

    clauses: list[str] = []
    filter_params: list = []
    if status:
        clauses.append("status=?")
        filter_params.append(status)
    if favorites_only:
        clauses.append("favorite=1")
    if search:
        # Match against the stored caption JSON and plain prompt text
        clauses.append("(prompt_json LIKE ? OR prompt_text LIKE ?)")
        like = f"%{search}%"
        filter_params.extend([like, like])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params_count: list = list(filter_params)
    params_list:  list = [*filter_params, per_page, offset]

    async with db.execute(
        f"SELECT COUNT(*) FROM jobs {where}", params_count
    ) as cur:
        total = (await cur.fetchone())[0]

    async with db.execute(
        f"SELECT {', '.join(_ROW_KEYS)} FROM jobs {where} "
        f"ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params_list,
    ) as cur:
        rows = await cur.fetchall()

    return [_row_to_dict(r) for r in rows], total


async def insert_derived(
    db: aiosqlite.Connection,
    *,
    source: dict,
    new_id: str,
    image_path: str,
    width: int,
    height: int,
) -> None:
    """Insert a completed gallery record derived from an existing one (edits)."""
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO jobs (id, status, prompt_json, prompt_text, settings_json,
           image_path, seed, width, height, sampler_preset, model_variant,
           duration_ms, created_at)
           VALUES (?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)""",
        (new_id, source.get("prompt_json"), source.get("prompt_text"),
         source.get("settings_json") or "{}", image_path, source.get("seed"),
         width, height, source.get("sampler_preset"), source.get("model_variant"),
         now),
    )
    await db.commit()


async def insert_imported(
    db: aiosqlite.Connection,
    *,
    new_id: str,
    image_path: str,
    width: int,
    height: int,
    label: str,
) -> None:
    """Insert a user-imported image as a completed gallery record.

    No seed/sampler/variant — those only exist for generated images; the
    GalleryItem schema and cards already treat them as nullable.
    """
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO jobs (id, status, prompt_json, prompt_text, settings_json,
           image_path, seed, width, height, sampler_preset, model_variant,
           duration_ms, created_at)
           VALUES (?, 'done', NULL, ?, '{}', ?, NULL, ?, ?, NULL, NULL, NULL, ?)""",
        (new_id, label, image_path, width, height, now),
    )
    await db.commit()


async def set_favorite(
    db: aiosqlite.Connection, job_id: str, favorite: bool
) -> bool:
    """Returns False when the job does not exist."""
    cur = await db.execute(
        "UPDATE jobs SET favorite=? WHERE id=?", (1 if favorite else 0, job_id)
    )
    await db.commit()
    return cur.rowcount > 0


async def delete_job(db: aiosqlite.Connection, job_id: str) -> str | None:
    """Returns image_path if found, so caller can delete the file."""
    async with db.execute(
        "SELECT image_path FROM jobs WHERE id=?", (job_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return None
    image_path = row[0]
    await db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
    await db.commit()
    return image_path
