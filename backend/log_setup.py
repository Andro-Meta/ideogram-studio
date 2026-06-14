"""
Persistent logging for the studio.

Everything important — model downloads, load phases, memory snapshots,
generation requests, errors — is written to logs/app.log (rotating, 3x5 MB)
so that after a crash or system freeze there is always evidence of what
happened. The console output still works as before.
"""
from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from settings import BASE_DIR

LOGS_DIR = BASE_DIR / "logs"
LOG_FILE = LOGS_DIR / "app.log"
# Written by the load watchdog just before an emergency abort; read at startup.
ABORT_MARKER = LOGS_DIR / "last_load_abort.json"

_FMT = logging.Formatter(
    "%(asctime)s %(levelname)-8s %(name)s :: %(message)s", "%Y-%m-%d %H:%M:%S"
)


class _FlushingFileHandler(RotatingFileHandler):
    """Flush after every record — survives hard crashes / power loss."""

    def emit(self, record: logging.LogRecord) -> None:
        super().emit(record)
        self.flush()


def setup_logging() -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()

    if any(isinstance(h, _FlushingFileHandler) for h in root.handlers):
        return  # already configured (uvicorn reload etc.)

    fh = _FlushingFileHandler(
        str(LOG_FILE), maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    fh.setFormatter(_FMT)
    root.addHandler(fh)
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

    # uvicorn's loggers don't propagate to root — attach the file handler directly
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).addHandler(fh)


def flush_all() -> None:
    for h in logging.getLogger().handlers:
        try:
            h.flush()
        except Exception:
            pass


def tail_log(lines: int = 200) -> list[str]:
    """Last N lines of the current log file (cheap, reads at most ~1 MB)."""
    try:
        with open(LOG_FILE, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 1_000_000))
            data = fh.read().decode("utf-8", errors="replace")
        return data.splitlines()[-lines:]
    except FileNotFoundError:
        return []
