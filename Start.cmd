@echo off
setlocal
cd /d "%~dp0"
set "VIET_NODE=node"
if exist "runtime-path.txt" set /p VIET_NODE=<"runtime-path.txt"
if exist "tools\node\node.exe" set "VIET_NODE=%~dp0tools\node\node.exe"
echo Viet Studio: http://127.0.0.1:8765
"%VIET_NODE%" scripts\start.mjs
if errorlevel 1 pause
