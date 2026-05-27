@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Deteniendo Flotillas v2 + ngrok
echo ============================================
echo.

echo [1/3] Matando ngrok...
taskkill /F /IM ngrok.exe >nul 2>&1
echo       ngrok detenido.

echo.
echo [2/3] Matando procesos node (API + Web)...
taskkill /F /IM node.exe >nul 2>&1
echo       Procesos node terminados.

echo.
echo [3/3] Deteniendo contenedores Docker...
docker compose down >nul 2>&1
echo       Postgres + Redis detenidos.

echo.
echo ============================================
echo   Todo apagado.
echo ============================================
echo.
echo   Docker Desktop sigue abierto en idle (~200 MB).
echo   Para cerrarlo del todo: icono ballena ^> Quit Docker Desktop.
echo.
pause
