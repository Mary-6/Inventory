@echo off
title Romarick's Vintage
setlocal

set "APP=%~dp0"
set "PG=C:\xampp\pgsql"
set "PGDATA=%PG%\data"
set "APPURL=http://127.0.0.1:4000"

echo ==========================================
echo   ROMARICK'S VINTAGE
echo   Premium Wholesale Drinks ^& Wine System
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org and try again.
  pause & exit /b 1
)
if not exist "%APP%server\src\index.js" ( echo [ERROR] Server files missing. & pause & exit /b 1 )

REM --- Start PostgreSQL if it is not already running ---
if exist "%PG%\bin\pg_ctl.exe" (
  "%PG%\bin\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
  if errorlevel 1 (
    echo Starting PostgreSQL...
    "%PG%\bin\pg_ctl.exe" -D "%PGDATA%" -l "%PG%\logfile.log" start >nul
    if errorlevel 1 ( echo [ERROR] PostgreSQL failed to start. See %PG%\logfile.log & pause & exit /b 1 )
  ) else ( echo PostgreSQL already running. )
) else (
  echo [WARN] Portable PostgreSQL not found at %PG%.
  echo        Set DATABASE_URL in server\.env to your PostgreSQL server.
)

REM --- First-run setup ---
if not exist "%APP%server\node_modules" (
  echo Installing dependencies ^(first run only^)...
  pushd "%APP%" && call npm run install:all && popd
)
if not exist "%APP%client\dist\index.html" (
  echo Building the web app ^(first run only^)...
  pushd "%APP%" && call npm run build && popd
)

REM --- Apply migrations ---
pushd "%APP%server"
node src\migrate.js >nul 2>&1
popd

REM --- Open browser and start the server ---
echo.
echo Starting Romarick's Vintage at %APPURL%
echo Keep this window open while using the app. Close it to stop.
start "" "%APPURL%"
pushd "%APP%server"
node src\index.js
popd
pause
