@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Deteniendo Flotillas v2
echo ============================================
echo.

echo [1/2] Matando procesos node (API + Web)...
taskkill /F /IM node.exe >nul 2>&1
echo       Procesos node terminados.

echo.
echo [2/2] Deteniendo contenedores Docker...
docker compose down >nul 2>&1
echo       Postgres + Redis detenidos.

echo.
echo ============================================
echo   Todo apagado. Libera ~1 GB de RAM.
echo ============================================
echo.
echo   Docker Desktop sigue abierto en idle (~200 MB).
echo   Para cerrarlo del todo: icono ballena ^> Quit Docker Desktop.
echo.
pause
