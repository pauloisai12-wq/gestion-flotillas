@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Iniciando Flotillas v2 + ngrok
echo ============================================
echo.

REM --- 0. ngrok instalado ---
where ngrok >nul 2>&1
if errorlevel 1 (
    echo [ERROR] ngrok no esta en el PATH.
    echo         Instalalo desde https://ngrok.com/download
    echo         o ejecuta:  winget install Ngrok.Ngrok
    pause
    exit /b 1
)

REM --- 1. Docker Desktop ---
docker ps >nul 2>&1
if errorlevel 1 goto start_docker
echo [1/6] Docker Desktop ya estaba corriendo.
goto compose_up

:start_docker
echo [1/6] Docker Desktop no esta corriendo. Abriendolo...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo       Esperando al daemon. Puede tardar hasta 60s...

:wait_docker
timeout /t 5 /nobreak >nul
docker ps >nul 2>&1
if errorlevel 1 goto wait_docker
echo       Daemon listo.

:compose_up
echo.
echo [2/6] Levantando Postgres + Redis...
docker compose up -d postgres redis >nul 2>&1

echo       Esperando a Postgres...
:wait_pg
timeout /t 2 /nobreak >nul
docker exec flotillas_postgres pg_isready -U flotillas_user -d flotillas_db >nul 2>&1
if errorlevel 1 goto wait_pg
echo       Postgres listo.

echo.
echo [3/6] Iniciando API en ventana nueva...
start "Flotillas API" cmd /k "cd /d %~dp0api && npm run dev"

echo [4/6] Limpiando cache .next/ y iniciando Web (dev mode)...
if exist "%~dp0web\.next" rmdir /S /Q "%~dp0web\.next" >nul 2>&1
start "Flotillas Web" cmd /k "cd /d %~dp0web && npm run dev"

echo.
echo [5/6] Esperando a que el web responda...

set /a RETRIES=0
:wait_web
timeout /t 2 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:3000 > "%TEMP%\fl_status.txt" 2>nul
set /p WEBSTATUS=<"%TEMP%\fl_status.txt"
del "%TEMP%\fl_status.txt" 2>nul
if "!WEBSTATUS!"=="307" goto web_ready
if "!WEBSTATUS!"=="200" goto web_ready
set /a RETRIES+=1
if !RETRIES! lss 30 goto wait_web
echo       Timeout esperando al web. Abriendo ngrok igual...

:web_ready
echo       Web listo.

echo.
echo [6/6] Iniciando tunel ngrok hacia el puerto 3000...
start "ngrok" cmd /k "ngrok http 3000 --log=stdout"

echo       Esperando a ngrok...
set /a RETRIES=0
:wait_ngrok
timeout /t 2 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:4040/api/tunnels > "%TEMP%\fl_ngrok.txt" 2>nul
set /p NGROKSTATUS=<"%TEMP%\fl_ngrok.txt"
del "%TEMP%\fl_ngrok.txt" 2>nul
if "!NGROKSTATUS!"=="200" goto ngrok_ready
set /a RETRIES+=1
if !RETRIES! lss 15 goto wait_ngrok
echo       Timeout esperando a ngrok.
goto end

:ngrok_ready
echo       ngrok listo.
echo.

REM Obtener la URL publica de ngrok con PowerShell (parsea JSON)
for /f "delims=" %%U in ('powershell -NoProfile -Command "(Invoke-RestMethod http://localhost:4040/api/tunnels).tunnels ^| Where-Object { $_.proto -eq 'https' } ^| Select-Object -First 1 -ExpandProperty public_url"') do set NGROK_URL=%%U

if not defined NGROK_URL (
    echo [WARN] No se pudo obtener la URL publica. Mira la ventana de ngrok.
    goto end
)

echo Abriendo navegador en URL publica...
start "" "!NGROK_URL!"
start "" "http://localhost:4040"

:end
echo.
echo ============================================
echo   Flotillas v2 expuesto con ngrok
echo ============================================
echo.
echo   Local Web:        http://localhost:3000
echo   Local API:        http://localhost:3001
echo   Inspector ngrok:  http://localhost:4040
if defined NGROK_URL (
    echo   URL publica:      !NGROK_URL!
    echo   Portal publico:   !NGROK_URL!/cargas/registro-rapido
)
echo.
echo   Cuentas de prueba:
echo     admin@flotillas.com           / admin123
echo     vehiculos@flotillas.com       / super123
echo     gasolina@flotillas.com        / super123
echo     mantenimiento@flotillas.com   / super123
echo.
echo   Para detener:  doble click en stop-ngrok.bat
echo ============================================
echo.
pause
