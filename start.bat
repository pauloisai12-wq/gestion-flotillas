@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Iniciando Flotillas v2
echo ============================================
echo.

REM --- 1. Docker Desktop ---
docker ps >nul 2>&1
if errorlevel 1 goto start_docker
echo [1/5] Docker Desktop ya estaba corriendo.
goto compose_up

:start_docker
echo [1/5] Docker Desktop no esta corriendo. Abriendolo...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo       Esperando al daemon. Puede tardar hasta 60s...

:wait_docker
timeout /t 5 /nobreak >nul
docker ps >nul 2>&1
if errorlevel 1 goto wait_docker
echo       Daemon listo.

:compose_up
echo.
echo [2/5] Levantando Postgres + Redis...
docker compose up -d postgres redis >nul 2>&1

echo       Esperando a Postgres...
:wait_pg
timeout /t 2 /nobreak >nul
docker exec flotillas_postgres pg_isready -U flotillas_user -d flotillas_db >nul 2>&1
if errorlevel 1 goto wait_pg
echo       Postgres listo.

echo.
echo [3/5] Iniciando API en ventana nueva...
start "Flotillas API" cmd /k "cd /d %~dp0api && npm run dev"

echo [4/5] Iniciando Web en ventana nueva...
start "Flotillas Web" cmd /k "cd /d %~dp0web && npm run start"

echo.
echo [5/5] Esperando a que el web responda...

set /a RETRIES=0
:wait_web
timeout /t 2 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:3000 > "%TEMP%\fl_status.txt" 2>nul
set /p WEBSTATUS=<"%TEMP%\fl_status.txt"
del "%TEMP%\fl_status.txt" 2>nul
if "!WEBSTATUS!"=="307" goto web_ready
if "!WEBSTATUS!"=="200" goto web_ready
set /a RETRIES+=1
if !RETRIES! lss 20 goto wait_web
echo       Timeout esperando al web. Abriendo igual...

:web_ready
echo       Web listo.
echo.
echo Abriendo navegador...
start "" "http://localhost:3000"
REM Fallback por si start no abrió el navegador
if errorlevel 1 explorer "http://localhost:3000"

echo.
echo ============================================
echo   Flotillas v2 arriba
echo ============================================
echo.
echo   Web:  http://localhost:3000
echo   API:  http://localhost:3001
echo   Portal publico:  /cargas/registro-rapido
echo.
echo   Cuentas de prueba:
echo     admin@flotillas.com           / admin123
echo     vehiculos@flotillas.com       / super123
echo     gasolina@flotillas.com        / super123
echo     mantenimiento@flotillas.com   / super123
echo.
echo   Para detener:  doble click en stop.bat
echo ============================================
echo.
pause
