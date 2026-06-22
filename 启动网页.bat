@echo off
cd /d "%~dp0"
set PORT=3010
echo Starting local voice clone web server on http://localhost:%PORT% ...
node server.js
pause
