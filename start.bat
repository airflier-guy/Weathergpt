@echo off
title WeatherGPT
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page...
  echo Install the LTS version, restart your computer, then double-click start.bat again.
  start https://nodejs.org
  pause
  exit /b
)
if not exist package.json (
  echo package.json not found. Please EXTRACT the zip first, then run start.bat from the extracted weathergpt folder.
  pause
  exit /b
)
if not exist node_modules (
  echo Installing, please wait about a minute...
  call npm install
)
echo.
echo Starting WeatherGPT. Your browser will open in a few seconds.
echo Keep this window open. Close it to stop the app.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
node server.js
pause
