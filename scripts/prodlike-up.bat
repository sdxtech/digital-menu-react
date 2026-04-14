@echo off
setlocal

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

echo [digital-menu-prodlike] Waiting for Docker daemon...
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
  echo [digital-menu-prodlike] Docker daemon not ready. Open Docker Desktop and try again.
  exit /b 1
)

pushd "%ROOT%"
docker compose --env-file docker-compose.prodlike.env -f docker-compose.prodlike.yml up --build -d
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
