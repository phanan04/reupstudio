@echo off
setlocal
cd /d "%~dp0"
echo Requires Node.js 24 and Python 3.12. Downloads models into this folder.
node scripts\setup.mjs %*
if errorlevel 1 pause
