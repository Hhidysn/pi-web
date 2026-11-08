@echo off
setlocal EnableExtensions
set "PORT=30141"
set "FORCE=0"

:args
if "%~1"=="" goto argsdone
if /i "%~1"=="force" (set "FORCE=1") else (set "PORT=%~1")
shift
goto args

:argsdone
if not exist "%~dp0stop-pi-web.ps1" (
  echo.
  echo   [ERROR] Missing helper: %~dp0stop-pi-web.ps1
  echo.
  exit /b 1
)

rem 启动器可能在等待此次停止，先记录 pending，成功后再改成 stopped。
set "RUN_ID="
set "STOP_FILE="
if exist "%~dp0pi-web-%PORT%.run" set /p "RUN_ID=" <"%~dp0pi-web-%PORT%.run"
if defined RUN_ID set "STOP_FILE=%~dp0pi-web-%PORT%-%RUN_ID%.stop"
if defined STOP_FILE >"%STOP_FILE%" echo pending

if "%FORCE%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-pi-web.ps1" -Port %PORT% -Force
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-pi-web.ps1" -Port %PORT%
)
set "RC=%ERRORLEVEL%"

if defined STOP_FILE (
  if "%RC%"=="0" (
    >"%STOP_FILE%" echo stopped
  ) else (
    >"%STOP_FILE%" echo failed
  )
)

exit /b %RC%
