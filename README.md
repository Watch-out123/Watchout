# CosySync Studio - VS Code Ready

Local start ke liye sabse simple tareeqa:

1. `run_local.bat` chalao
2. Browser me `http://127.0.0.1:8000/login` kholo

## Test login
- `aaryansh / movie123`
- `partner / movie123`

## Folder me kya hona chahiye
- `app/`
- `requirements.txt`
- `run_local.bat`
- `render.yaml`

## Local reset
Agar login ya DB issue aaye to `reset_local_db.bat` chalao.

## Render start command
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`

## Build command
`pip install -r requirements.txt`
