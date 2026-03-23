@echo off
cd /d %~dp0

echo Installing requirements...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Dependency install failed.
  pause
  exit /b 1
)

start "" cmd /c "timeout /t 4 >nul && start "" http://127.0.0.1:8000/login"

echo.
echo Starting CosySync on http://127.0.0.1:8000/login
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
