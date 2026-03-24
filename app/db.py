from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DATABASE_URL = os.getenv('DATABASE_URL', '').strip()
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'data'
SQLITE_PATH = DATA_DIR / 'cosysync.db'

_IS_POSTGRES = DATABASE_URL.startswith('postgresql://') or DATABASE_URL.startswith('postgres://')

if _IS_POSTGRES:
    import psycopg
    from psycopg.rows import dict_row


@contextmanager
def get_conn() -> Iterator[object]:
    if _IS_POSTGRES:
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        try:
            yield conn
        finally:
            conn.close()
    else:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()


def qmark() -> str:
    return '%s' if _IS_POSTGRES else '?'


def init_db() -> None:
    with get_conn() as conn:
        if _IS_POSTGRES:
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
                '''
            )
            conn.commit()
        else:
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                '''
            )
            conn.commit()
