
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

from .auth import TOKEN_COOKIE, authenticate_user, create_user, ensure_demo_users, get_user_from_request, make_token, parse_token
from .db import init_db

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / 'templates'
STATIC_DIR = BASE_DIR / 'static'
COOKIE_SECURE = os.getenv('COOKIE_SECURE', 'false').lower() in {'1', 'true', 'yes', 'on'}

app = FastAPI(title='CosySync Studio', version='3.0.0')
app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@dataclass
class Participant:
    id: str
    username: str
    websocket: WebSocket


rooms: dict[str, dict[str, Any]] = {}
rooms_lock = asyncio.Lock()


def room_state_payload(room: dict[str, Any]) -> dict[str, Any]:
    participants = room.get('participants', {})
    host_id = room.get('host_id')
    return {
        'locked': room.get('locked', False),
        'title': room.get('title') or 'Movie night',
        'hostId': host_id,
        'participants': [
            {
                'id': p.id,
                'username': p.username,
                'isHost': p.id == host_id,
            }
            for p in participants.values()
        ],
    }


@app.on_event('startup')
async def startup_event() -> None:
    init_db()
    ensure_demo_users()


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


async def send_to_peer(room_id: str, peer_id: str, payload: dict[str, Any]) -> None:
    async with rooms_lock:
        room = rooms.get(room_id)
        target = room and room.get('participants', {}).get(peer_id)
    if not target:
        return
    try:
        await target.websocket.send_text(json.dumps(payload))
    except Exception:
        pass


async def broadcast(room_id: str, payload: dict[str, Any], exclude: set[str] | None = None) -> None:
    exclude = exclude or set()
    async with rooms_lock:
        room = rooms.get(room_id)
        participants = list((room or {}).get('participants', {}).values())
    data = json.dumps(payload)
    for participant in participants:
        if participant.id in exclude:
            continue
        try:
            await participant.websocket.send_text(data)
        except Exception:
            pass


async def broadcast_room_state(room_id: str) -> None:
    async with rooms_lock:
        room = rooms.get(room_id)
        if not room:
            return
        payload = {'type': 'room-state', 'room': room_state_payload(room)}
    await broadcast(room_id, payload)


@app.websocket('/ws/room/{room_id}')
async def room_ws(websocket: WebSocket, room_id: str, token: str):
    payload = parse_token(token)
    if not payload:
        await websocket.close(code=4401)
        return

    username = payload['username']
    participant_id = secrets.token_urlsafe(8)

    async with rooms_lock:
        room = rooms.get(room_id)
        if room and room.get('locked'):
            await websocket.close(code=4403)
            return

    await websocket.accept()
    participant = Participant(id=participant_id, username=username, websocket=websocket)

    async with rooms_lock:
        room = rooms.setdefault(
            room_id,
            {
                'participants': {},
                'host_id': participant_id,
                'locked': False,
                'title': 'Movie night',
            },
        )
        existing_peers = [{'id': p.id, 'username': p.username} for p in room['participants'].values()]
        room['participants'][participant_id] = participant
        if not room.get('host_id'):
            room['host_id'] = participant_id
        current_state = room_state_payload(room)

    await websocket.send_text(
        json.dumps(
            {
                'type': 'welcome',
                'selfId': participant_id,
                'roomId': room_id,
                'peers': existing_peers,
                'room': current_state,
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
    await broadcast_room_state(room_id)

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
                event_name = message.get('event')
                payload_data = message.get('payload') or {}

                if event_name in {'lock-room', 'unlock-room', 'set-title'}:
                    async with rooms_lock:
                        room = rooms.get(room_id)
                        if not room or room.get('host_id') != participant_id:
                            continue
                        if event_name == 'lock-room':
                            room['locked'] = True
                        elif event_name == 'unlock-room':
                            room['locked'] = False
                        elif event_name == 'set-title':
                            title = str(payload_data.get('title', '')).strip()[:64]
                            room['title'] = title or 'Movie night'
                    await broadcast_room_state(room_id)
                    await broadcast(
                        room_id,
                        {
                            'type': 'event',
                            'from': participant_id,
                            'username': username,
                            'event': event_name,
                            'payload': payload_data,
                        },
                    )
                else:
                    await broadcast(
                        room_id,
                        {
                            'type': 'event',
                            'from': participant_id,
                            'username': username,
                            'event': event_name,
                            'payload': payload_data,
                        },
                        exclude={participant_id} if event_name in {'heart', 'ready', 'vibe'} else set(),
                    )
            elif msg_type == 'ping':
                await websocket.send_text(json.dumps({'type': 'pong'}))
    except WebSocketDisconnect:
        pass
    finally:
        need_state_broadcast = False
        new_host_name = None
        async with rooms_lock:
            room = rooms.get(room_id, {})
            participants = room.get('participants', {})
            participants.pop(participant_id, None)

            if not participants:
                rooms.pop(room_id, None)
            else:
                if room.get('host_id') == participant_id:
                    new_host = next(iter(participants.values()))
                    room['host_id'] = new_host.id
                    new_host_name = new_host.username
                    need_state_broadcast = True

        await broadcast(
            room_id,
            {
                'type': 'participant-left',
                'peerId': participant_id,
            },
        )
        if need_state_broadcast:
            await broadcast_room_state(room_id)
            await broadcast(
                room_id,
                {
                    'type': 'event',
                    'from': participant_id,
                    'username': username,
                    'event': 'host-changed',
                    'payload': {'newHostName': new_host_name or 'Host'},
                },
            )
