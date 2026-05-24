@echo off
echo =========================================
echo   PayForge - UPI Payment Engine Setup
echo =========================================
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Node.js found.
    goto :install
)

echo [!] Node.js not found in PATH.
echo.
echo Please install Node.js from: https://nodejs.org/en/download
echo After installing, re-run this script.
echo.
pause
exit /b 1

:install
echo [*] Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

echo.
echo [*] Initializing database...
node server/db/init.js

echo.
echo =========================================
echo   Starting PayForge Server...
echo =========================================
echo.
echo   Payment Portal : http://localhost:3000
echo   Admin Dashboard: http://localhost:3000/admin.html
echo   Admin Token    : dev_admin_token
echo.
node server/index.js
pause
