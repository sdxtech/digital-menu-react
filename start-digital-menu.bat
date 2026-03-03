@echo off
setlocal

set "ROOT=%~dp0"
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

echo [digital-menu] Waiting for Docker daemon...
set "READY=0"
for /l %%i in (1,1,60) do (
  docker info >nul 2>nul
  if not errorlevel 1 (
    set "READY=1"
    goto :docker_ready
  )
  timeout /t 2 /nobreak >nul
)

:docker_ready
if "%READY%"=="0" (
  echo [digital-menu] Docker daemon not ready. Open Docker Desktop and re-run this script.
  exit /b 1
)

echo [digital-menu] Starting infra services...
cd /d "%ROOT%\infra"
docker compose up -d

echo [digital-menu] Starting backend...
start "digital-menu-backend" /min cmd /c "cd /d ""%ROOT%\backend"" && npm run start:dev"

echo [digital-menu] Starting frontend...
start "digital-menu-frontend" /min cmd /c "cd /d ""%ROOT%\frontend"" && npm run dev"

echo [digital-menu] Started. Open http://localhost:5173
exit /b 0
