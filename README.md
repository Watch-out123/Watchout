# CosySync

A cozy premium watch-party web app built with FastAPI + WebRTC.

## What it does
- Login / register
- Create or join a room
- Invite multiple people with the same room link
- WhatsApp invite button
- Screen share with browser audio when supported
- Multiple remote screens shown in a grid
- Quick-open buttons for YouTube, Netflix, Prime Video, Disney+, Spotify, and Drive
- Heart reaction, ready ping, vibe buttons, theater mode
- Users saved locally in SQLite by default
- Optional `DATABASE_URL` support for PostgreSQL later (for example Supabase Postgres)

## Local run
### Windows
1. Install Python 3.11 or newer.
2. Double-click `run.bat`.
3. Open `http://localhost:8000`.

### Mac / Linux
```bash
chmod +x run.sh
./run.sh
```
Then open `http://localhost:8000`.

## How to use
1. Create an account on each device.
2. One person creates a room.
3. Copy the invite link or use the WhatsApp invite button.
4. Everyone joins using the same link or room code.
5. Any participant can click **Start screen share**.
6. In Chrome or Edge, choose the movie tab and enable audio.
7. If remote audio does not autoplay, click **Enable room audio** once.

## Data storage
- Rooms are in memory only.
- Only user login IDs / password hashes are stored.
- Default storage is local SQLite: `data/cosysync.db`
- If you later set `DATABASE_URL`, the app can use PostgreSQL instead.

## Render hosting
This repo includes `render.yaml`.

Quick manual setup:
1. Push this folder to GitHub.
2. In Render, create a new **Web Service** from the repo.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add env vars:
   - `COSYSYNC_SECRET_KEY` = any long random secret
   - `COOKIE_SECURE` = `true`
   - optional `DATABASE_URL` if moving logins to Supabase Postgres later

## Notes
- Screen sharing works on `http://localhost` locally or `https://` when hosted.
- Browser support for shared audio is not identical everywhere.
- This app opens official streaming sites in a new tab. It does not collect or store third-party streaming passwords.
- This is a mesh WebRTC setup, so it works best for small rooms.
