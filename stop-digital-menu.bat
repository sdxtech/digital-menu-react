@echo off
setlocal

set "ROOT=%~dp0"
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

taskkill /FI "WINDOWTITLE eq digital-menu-backend" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq digital-menu-frontend" /T /F >nul 2>nul

cd /d "%ROOT%\infra"
docker compose stop

echo [digital-menu] Stopped backend/frontend windows and infra services.
exit /b 0
