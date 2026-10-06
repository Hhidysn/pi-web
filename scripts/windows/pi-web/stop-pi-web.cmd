@echo off
setlocal
set "PORT=30141"
set "FORCE=0"

:args
if "%~1"=="" goto argsdone
if /i "%~1"=="force" (set "FORCE=1") else (set "PORT=%~1")
shift
goto args

:argsdone
set "PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING"') do set "PID=%%P"

if not defined PID (
  echo.
  echo   Pi Web is not running on port %PORT%.
  echo.
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

echo.
echo   Pi Web is listening on port %PORT%  -  PID %PID%
echo.
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=%PID%'; if ($p) { Write-Host ('   name: ' + $p.Name); Write-Host ('   cmd : ' + $p.CommandLine) }"

if "%FORCE%"=="1" goto dokill

rem Fail closed: only the official package or this checkout, by exact entry point.
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=%PID%'; if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match '[\\/](pi-web-gui|@agegr[\\/]pi-web)[\\/]|[\\/]next[\\/]dist[\\/](bin[\\/]next|server[\\/]lib[\\/]start-server)') { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo.
  echo   [WARN] That process does not look like a Pi Web server.
  echo          Refusing to stop it.  Override with:  stop-pi-web.cmd %PORT% force
  echo.
  pause
  exit /b 1
)

:dokill
echo.
echo   Stopping port %PORT% ... this is a forced kill (taskkill /F):
echo   the server's running agents are not shut down gracefully.
taskkill /PID %PID% /T /F >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Could not stop PID %PID%.
  echo.
  pause
  exit /b 1
)
echo   [OK] Pi Web stopped.
echo.
ping -n 3 127.0.0.1 >nul
exit /b 0
