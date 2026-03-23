from __future__ import annotations

import asyncio
import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .auth import TOKEN_COOKIE, authenticate_user, create_user, get_user_from_request, make_token, parse_token
from .db import init_db

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / 'templates'
STATIC_DIR = BASE_DIR / 'static'
COOKIE_SECURE = os.getenv('COOKIE_SECURE', 'false').lower() in {'1', 'true', 'yes', 'on'}

app = FastAPI(title='CosySync', version='2.0.0')
app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@dataclass
class Participant:
    id: str
    username: str
    websocket: WebSocket


rooms: dict[str, dict[str, Participant]] = {}
rooms_lock = asyncio.Lock()


@app.on_event('startup')
async def startup_event() -> None:
    init_db()


@app.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/', response_class=HTMLResponse)
async def home(request: Request):
    user = get_user_from_request(request)
    if user:
        return RedirectResponse(url='/app', status_code=303)
    return RedirectResponse(url='/login', status_code=303)


@app.get('/login', response_class=HTMLResponse)
async def login_page(request: Request):
    user = get_user_from_request(request)
    if user:
        return RedirectResponse(url='/app', status_code=303)
    return templates.TemplateResponse('login.html', {'request': request})


@app.get('/app', response_class=HTMLResponse)
async def app_page(request: Request):
    user = get_user_from_request(request)
    if not user:
        return RedirectResponse(url='/login', status_code=303)
    return templates.TemplateResponse(
        'app.html',
        {
            'request': request,
            'username': user['username'],
            'token': user['token'],
        },
    )


@app.get('/preview', response_class=HTMLResponse)
async def preview_page(request: Request):
    return templates.TemplateResponse('preview.html', {'request': request})


@app.post('/api/register')
async def register(username: str = Form(...), password: str = Form(...)):
    try:
        user = create_user(username, password)
    except ValueError as exc:
        return JSONResponse({'ok': False, 'error': str(exc)}, status_code=400)

    token = make_token(user)
    response = JSONResponse({'ok': True, 'username': user['username']})
    response.set_cookie(
        TOKEN_COOKIE,
        token,
        httponly=True,
        samesite='lax',
        secure=COOKIE_SECURE,
        max_age=60 * 60 * 24 * 14,
    )
    return response


@app.post('/api/login')
async def login(username: str = Form(...), password: str = Form(...)):
    try:
        user = authenticate_user(username, password)
    except ValueError as exc:
        return JSONResponse({'ok': False, 'error': str(exc)}, status_code=400)

    if not user:
        return JSONResponse({'ok': False, 'error': 'Invalid username or password.'}, status_code=401)

    token = make_token(user)
    response = JSONResponse({'ok': True, 'username': user['username']})
    response.set_cookie(
        TOKEN_COOKIE,
        token,
        httponly=True,
        samesite='lax',
        secure=COOKIE_SECURE,
        max_age=60 * 60 * 24 * 14,
    )
    return response


@app.post('/api/logout')
async def logout():
    response = JSONResponse({'ok': True})
    response.delete_cookie(TOKEN_COOKIE)
    return response


@app.get('/api/room/new')
async def new_room() -> dict[str, Any]:
    room_id = secrets.token_urlsafe(5).replace('-', '').replace('_', '')[:8].lower()
    return {'ok': True, 'roomId': room_id}


@app.websocket('/ws/room/{room_id}')
async def room_ws(websocket: WebSocket, room_id: str, token: str):
    payload = parse_token(token)
    if not payload:
        await websocket.close(code=4401)
        return

    username = payload['username']
    participant_id = secrets.token_urlsafe(8)
    await websocket.accept()

    participant = Participant(id=participant_id, username=username, websocket=websocket)

    async with rooms_lock:
        room = rooms.setdefault(room_id, {})
        existing_peers = [{'id': p.id, 'username': p.username} for p in room.values()]
        room[participant_id] = participant

    await websocket.send_text(
        json.dumps(
            {
                'type': 'welcome',
                'selfId': participant_id,
                'roomId': room_id,
                'peers': existing_peers,
            }
        )
    )

    await broadcast(
        room_id,
        {
            'type': 'participant-joined',
            'peer': {'id': participant_id, 'username': username},
        },
        exclude={participant_id},
    )

    try:
        while True:
            raw_message = await websocket.receive_text()
            message = json.loads(raw_message)
            msg_type = message.get('type')
            target = message.get('target')

            if msg_type in {'offer', 'answer', 'ice-candidate'} and target:
                await send_to_peer(
                    room_id,
                    target,
                    {
                        'type': msg_type,
                        'from': participant_id,
                        'payload': message.get('payload'),
                    },
                )
            elif msg_type == 'event':
                await broadcast(
                    room_id,
                    {
                        'type': 'event',
                        'from': participant_id,
                        'username': username,
                        'event': message.get('event'),
                        'payload': message.get('payload'),
                    },
                    exclude={participant_id},
                )
            elif msg_type == 'ping':
                await websocket.send_text(json.dumps({'type': 'pong'}))
    except WebSocketDisconnect:
        pass
    finally:
        async with rooms_lock:
            room = rooms.get(room_id, {})
            room.pop(participant_id, None)
            if not room:
                rooms.pop(room_id, None)
        await broadcast(
            room_id,
            {
                'type': 'participant-left',
                'peerId': participant_id,
            },
            exclude={participant_id},
        )


async def send_to_peer(room_id: str, peer_id: str, message: dict[str, Any]) -> None:
    async with rooms_lock:
        room = rooms.get(room_id, {})
        peer = room.get(peer_id)
    if not peer:
        return
    try:
        await peer.websocket.send_text(json.dumps(message))
    except Exception:
        pass


async def broadcast(room_id: str, message: dict[str, Any], exclude: set[str] | None = None) -> None:
    exclude = exclude or set()
    async with rooms_lock:
        room = list(rooms.get(room_id, {}).values())
    payload = json.dumps(message)
    for participant in room:
        if participant.id in exclude:
            continue
        try:
            await participant.websocket.send_text(payload)
        except Exception:
            pass
