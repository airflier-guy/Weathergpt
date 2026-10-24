@echo off
title WeatherGPT - save your keys
cd /d "%~dp0"
echo.
echo This creates the .env file for you in the correct place.
echo Paste a value by RIGHT-CLICKING in this window, then press Enter.
echo Press Enter on its own to skip a line.
echo.
set "G="
set "T="
set /p G=Gemini API key: 
set /p T=Telegram bot token: 
> .env echo GEMINI_API_KEY=%G%
>> .env echo TELEGRAM_BOT_TOKEN=%T%
echo.
echo Saved. The .env file is now in: %cd%
echo.
echo Next: close the WeatherGPT black window if it is open, then double-click start.
echo.
pause
