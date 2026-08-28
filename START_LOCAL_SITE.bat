@echo off
setlocal
title AGR Local Website
cd /d "%~dp0web_app"

set "AGR_NODE=C:\Users\alekseev\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "AGR_PNPM=C:\Users\alekseev\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

if not exist "%AGR_NODE%" (
  where node >nul 2>nul
  if errorlevel 1 goto no_node
  set "AGR_NODE=node"
)

if not exist "%AGR_PNPM%" (
  where pnpm >nul 2>nul
  if errorlevel 1 (
    where npm >nul 2>nul
    if errorlevel 1 goto no_pnpm
    set "AGR_PNPM=npm"
  ) else (
    set "AGR_PNPM=pnpm"
  )
)

set "PATH=C:\Users\alekseev\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\alekseev\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;%PATH%"

echo Preparing the latest local website...
if "%AGR_PNPM%"=="npm" (
  call npm run build
) else (
  call "%AGR_PNPM%" exec vinext build
)
if errorlevel 1 goto build_error

echo.
echo ============================================================
echo   AGR website is running
echo   Address: http://localhost:3000
echo   Keep this window open while the website is in use.
echo ============================================================
echo.

start "" "http://localhost:3000"
"%AGR_NODE%" local-server.mjs
echo.
echo The website has stopped.
pause
exit /b

:no_node
echo Node.js was not found. Please contact your administrator.
pause
exit /b 1

:no_pnpm
echo pnpm was not found. Please contact your administrator.
pause
exit /b 1

:build_error
echo Website preparation failed. See the error above.
pause
exit /b 1
