from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import Request

from .db import get_conn, qmark

SECRET_KEY = os.getenv('COSYSYNC_SECRET_KEY', os.getenv('WATCHPARTY_SECRET_KEY', 'change-this-in-production-please'))
TOKEN_COOKIE = 'cosysync_token'
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def _b64url_decode(data: str) -> bytes:
    padding = '=' * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 260000)
    return f'{salt}${digest.hex()}'


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _digest = stored_hash.split('$', 1)
    except ValueError:
        return False
    candidate = hash_password(password, salt)
    return hmac.compare_digest(candidate, stored_hash)


def normalize_username(username: str) -> str:
    username = (username or '').strip().lower()
    if not username or len(username) < 3:
        raise ValueError('Username must be at least 3 characters long.')
    if any(ch not in 'abcdefghijklmnopqrstuvwxyz0123456789_-' for ch in username):
        raise ValueError('Use only letters, numbers, underscore, or dash in username.')
    return username


def create_user(username: str, password: str) -> dict[str, Any]:
    username = normalize_username(username)
    if len(password) < 6:
        raise ValueError('Password must be at least 6 characters long.')

    qm = qmark()
    with get_conn() as conn:
        existing = conn.execute(f'SELECT id FROM users WHERE username = {qm}', (username,)).fetchone()
        if existing:
            raise ValueError('Username already exists.')

        password_hash = hash_password(password)
        cursor = conn.execute(
            f'INSERT INTO users (username, password_hash) VALUES ({qm}, {qm})',
            (username, password_hash),
        )
        conn.commit()

        user_id = getattr(cursor, 'lastrowid', None)
        if user_id is None:
            row = conn.execute(f'SELECT id FROM users WHERE username = {qm}', (username,)).fetchone()
            user_id = row['id'] if row else None

    return {'id': user_id, 'username': username}


def authenticate_user(username: str, password: str) -> dict[str, Any] | None:
    username = normalize_username(username)
    qm = qmark()
    with get_conn() as conn:
        row = conn.execute(
            f'SELECT id, username, password_hash FROM users WHERE username = {qm}',
            (username,),
        ).fetchone()

    if not row or not verify_password(password, row['password_hash']):
        return None

    return {'id': row['id'], 'username': row['username']}


def ensure_demo_users() -> None:
    """Seed local demo users when COSYSYNC_AUTO_SEED_DEMO is enabled.

    This keeps local testing simple without forcing default users into production.
    """
    auto_seed = os.getenv('COSYSYNC_AUTO_SEED_DEMO', 'false').lower() in {'1', 'true', 'yes', 'on'}
    if not auto_seed:
        return

    demo_users = [
        ('aaryansh', 'movie123'),
        ('partner', 'movie123'),
    ]
    qm = qmark()
    with get_conn() as conn:
        count_row = conn.execute('SELECT COUNT(*) AS total FROM users').fetchone()
        total = count_row['total'] if count_row else 0
        if total:
            return
        for username, password in demo_users:
            conn.execute(
                f'INSERT INTO users (username, password_hash) VALUES ({qm}, {qm})',
                (username, hash_password(password)),
            )
        conn.commit()


def make_token(user: dict[str, Any]) -> str:
    payload = {
        'uid': user['id'],
        'username': user['username'],
        'exp': int(time.time()) + TOKEN_TTL_SECONDS,
    }
    payload_bytes = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    payload_part = _b64url_encode(payload_bytes)
    signature = hmac.new(SECRET_KEY.encode('utf-8'), payload_part.encode('utf-8'), hashlib.sha256).digest()
    return f'{payload_part}.{_b64url_encode(signature)}'


def parse_token(token: str | None) -> dict[str, Any] | None:
    if not token or '.' not in token:
        return None
    try:
        payload_part, signature_part = token.split('.', 1)
        expected_sig = hmac.new(SECRET_KEY.encode('utf-8'), payload_part.encode('utf-8'), hashlib.sha256).digest()
        incoming_sig = _b64url_decode(signature_part)
        if not hmac.compare_digest(expected_sig, incoming_sig):
            return None
        payload = json.loads(_b64url_decode(payload_part).decode('utf-8'))
        if int(payload.get('exp', 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def get_user_from_request(request: Request) -> dict[str, Any] | None:
    token = request.cookies.get(TOKEN_COOKIE)
    payload = parse_token(token)
    if not payload:
        return None
    return {'id': payload['uid'], 'username': payload['username'], 'token': token}
