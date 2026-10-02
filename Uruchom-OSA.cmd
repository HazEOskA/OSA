@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" "scripts\launch-dashboard.mjs"
) else (
  node "scripts\launch-dashboard.mjs"
)
if errorlevel 1 pause
