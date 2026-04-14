@echo off
setlocal

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

pushd "%ROOT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids = docker compose --env-file 'docker-compose.prodlike.env' -f 'docker-compose.prodlike.yml' ps -q; if (-not $ids) { Write-Host '[digital-menu-prodlike] No running compose services.'; exit 1 }; docker stats $ids"
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
