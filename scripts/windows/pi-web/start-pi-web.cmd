@echo off
setlocal EnableExtensions

rem ============================================================
rem  Pi Web launcher
rem
rem  Usage:  start-pi-web.cmd [port] [quiet] [fork|official] [dev|prod] [rebuild] [dry] [help]
rem
rem  TARGET   fork     = this checkout (default; override the folder with PI_WEB_FORK)
rem           official = the npm package @agegr/pi-web on PATH
rem  MODE     dev      = hot reload, no build needed (default for the fork)
rem           prod     = serve the last production build
rem  REBUILD  build the fork first, then serve it (implies prod)
rem  DRY      print the resolved settings and exit without starting anything
rem
rem  Examples:
rem    start-pi-web.cmd                     fork, dev mode, port 30141
rem    start-pi-web.cmd 30142               the fork on another port
rem    start-pi-web.cmd rebuild             build the fork, then serve it
rem    start-pi-web.cmd official            the installed npm package
rem    start-pi-web.cmd dry prod 30144      just show what would be started
rem ============================================================

set "PORT="
set "QUIET=0"
set "TARGET=fork"
set "MODE="
set "REBUILD=0"
set "DRY=0"
set "RC=0"
set "LOG="
set "URL="
set "MATCHED="
set "ARG="
set "NONNUM="
set "PID="
set "KIND="
set "BUILD_RC="
set "FORK=%PI_WEB_FORK%"
if not defined FORK set "FORK=F:\documents\software\pi-web-gui"
set "HEAP=8192"

set "BASE=%~dp0"

:args
if "%~1"=="" goto argsdone
set "MATCHED="
if /i "%~1"=="help"     goto usage
if /i "%~1"=="quiet"    (set "QUIET=1" & set "MATCHED=1")
if /i "%~1"=="official" (set "TARGET=official" & set "MATCHED=1")
if /i "%~1"=="fork"     (set "TARGET=fork" & set "MATCHED=1")
if /i "%~1"=="dev"      (set "MODE=dev" & set "MATCHED=1")
if /i "%~1"=="prod"     (set "MODE=prod" & set "MATCHED=1")
if /i "%~1"=="rebuild"  (set "REBUILD=1" & set "MATCHED=1")
if /i "%~1"=="dry"      (set "DRY=1" & set "MATCHED=1")
if defined MATCHED goto nextarg
rem --- anything else must be a port number ---
set "ARG=%~1"
set "NONNUM="
for /f "delims=0123456789" %%D in ("%ARG%") do set "NONNUM=1"
if defined NONNUM goto badarg
if "%ARG:~0,1%"=="0" goto badport
if not "%ARG:~5,1%"=="" goto badport
if %ARG% LSS 1 goto badport
if %ARG% GTR 65535 goto badport
set "PORT=%ARG%"
:nextarg
shift
goto args

:argsdone
if not defined PORT set "PORT=30141"
rem one log per port, so two instances never truncate or lock each other
set "LOG=%BASE%pi-web-%PORT%.log"
if "%REBUILD%"=="1" set "MODE=prod"
if not defined MODE set "MODE=dev"
if "%REBUILD%"=="1" if /i "%TARGET%"=="official" goto badcombo
set "URL=http://127.0.0.1:%PORT%"

if "%DRY%"=="1" (
  echo target   : %TARGET%
  echo mode     : %MODE%
  echo port     : %PORT%
  echo rebuild  : %REBUILD%
  echo quiet    : %QUIET%
  echo fork dir : %FORK%
  echo log      : %LOG%
  exit /b 0
)

title Pi Web - %URL%

rem ---- is the port taken? say what holds it, warn, open the browser, stop ----
netstat -ano | findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [i] Port %PORT% is already in use - opening %URL%
  call :log "    you asked for: %TARGET%, mode %MODE%"
  call :describe %PORT%
  call :warnshared
  start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 100
)

if /i "%TARGET%"=="official" goto run_official
if /i "%MODE%"=="prod" goto run_fork_prod
goto run_fork_dev

rem =================== fork - dev mode (hot reload) ===================
:run_fork_dev
if not exist "%FORK%\package.json" (
  call :err "[ERROR] Fork not found at %FORK%"
  call :err "        Set PI_WEB_FORK or edit the FORK line in this file."
  goto fail
)
if not exist "%FORK%\node_modules\next\dist\bin\next" (
  call :err "[ERROR] node_modules is missing in %FORK% - run npm install there."
  goto fail
)
if exist "%FORK%\.next\dev\lock" call :log "[i] A dev server already runs in this checkout (next dev refuses a second one)."
call :initlog "fork dev on port %PORT%"
call :log "[i] target: fork (dev mode) from %FORK%"
pushd "%FORK%" || goto failpushd
start "" /b "%BASE%open-when-ready.cmd" %PORT%
if "%QUIET%"=="1" (
  node "node_modules\next\dist\bin\next" dev -H 127.0.0.1 -p %PORT% >> "%LOG%" 2>&1
) else (
  echo Starting Pi Web - fork, dev mode - at %URL%
  echo The first page load compiles for a few seconds; later code changes
  echo only need a browser reload. Close this window to stop the server.
  echo ============================================
  echo.
  node "node_modules\next\dist\bin\next" dev -H 127.0.0.1 -p %PORT%
)
set "RC=%ERRORLEVEL%"
popd
goto stopped

rem ================== fork - production build ==================
:run_fork_prod
if not exist "%FORK%\package.json" (
  call :err "[ERROR] Fork not found at %FORK%"
  call :err "        Set PI_WEB_FORK or edit the FORK line in this file."
  goto fail
)
if "%REBUILD%"=="0" goto fork_prod_check
if exist "%FORK%\.next\dev\lock" (
  call :err "[ERROR] A dev server is running in this checkout (next dev lock)."
  call :err "        Stop it first (stop-pi-web.cmd) - building during dev breaks both."
  goto fail
)
call :log "[i] Building the fork (a few minutes; V8 old-space limit %HEAP% MB) ..."
pushd "%FORK%" || goto failpushd
set "NODE_OPTIONS=--max-old-space-size=%HEAP%"
if "%QUIET%"=="1" (
  call npm run build >> "%LOG%" 2>&1
) else (
  call npm run build
)
set "BUILD_RC=%ERRORLEVEL%"
popd
if not "%BUILD_RC%"=="0" (
  call :err "[ERROR] The build failed - see the output above, or %LOG% in quiet mode."
  goto fail
)

:fork_prod_check
if not exist "%FORK%\.next\BUILD_ID" (
  call :err "[ERROR] No production build in %FORK%\.next - run: start-pi-web.cmd rebuild"
  goto fail
)
call :initlog "fork prod on port %PORT%"
call :log "[i] target: fork (production build) from %FORK%"
pushd "%FORK%" || goto failpushd
if "%QUIET%"=="1" (
  node "bin\pi-web.js" --port %PORT% >> "%LOG%" 2>&1
) else (
  echo Starting Pi Web - fork, production build - at %URL%
  echo Close this window to stop the server.
  echo ============================================
  echo.
  node "bin\pi-web.js" --port %PORT%
)
set "RC=%ERRORLEVEL%"
popd
goto stopped

rem ================== the installed npm package ==================
:run_official
where pi-web >nul 2>&1
if errorlevel 1 (
  call :err "[ERROR] pi-web was not found on PATH."
  call :err "        Install it with:  npm install -g @agegr/pi-web"
  goto fail
)
call :initlog "official pi-web on port %PORT%"
call :log "[i] target: installed official package on PATH"
if "%QUIET%"=="1" (
  call pi-web --port %PORT% >> "%LOG%" 2>&1
) else (
  echo Starting Pi Web - installed npm package - at %URL%
  echo Close this window to stop the server.
  echo ============================================
  echo.
  call pi-web --port %PORT%
)
set "RC=%ERRORLEVEL%"
goto stopped

:stopped
if "%QUIET%"=="0" (
  echo.
  echo ============================================
  echo Pi Web has stopped.
  pause
)
exit /b %RC%

:usage
echo.
echo   Pi Web launcher
echo.
echo     start-pi-web.cmd [port] [quiet] [fork^|official] [dev^|prod] [rebuild] [dry] [help]
echo.
echo     port      listen port, 1-65535 (default 30141)
echo     quiet     output goes to pi-web.log (the desktop shortcut also hides the window)
echo     fork      start %FORK%   (default)
echo     official  start the npm package @agegr/pi-web
echo     dev       fork with hot reload, no build needed (default)
echo     prod      fork from its last production build
echo     rebuild   run the fork's production build first (implies prod)
echo     dry       print the resolved settings and exit
echo.
echo   Stop whatever is running with:  stop-pi-web.cmd [port]
echo.
exit /b 0

:initlog
if "%QUIET%"=="1" echo [%DATE% %TIME%] %~1 > "%LOG%" 2>nul
exit /b 0

:log
echo %~1
if "%QUIET%"=="1" echo [%DATE% %TIME%] %~1 >> "%LOG%" 2>nul
exit /b 0

:err
if not defined LOG set "LOG=%BASE%pi-web-launcher.log"
echo %~1
echo [%DATE% %TIME%] %~1 >> "%LOG%" 2>nul
exit /b 0

:describe
rem Say what holds the port: this fork, the installed official package, or something else.
set "PID="
set "KIND=another program"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%~1 .*LISTENING"') do set "PID=%%P"
if not defined PID exit /b 0
for /f "usebackq delims=" %%C in (`powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=%PID%'; if ($p) { if ($p.CommandLine -match 'pi-web-gui') { 'this fork' } elseif ($p.CommandLine -match '@agegr') { 'the installed official package' } else { 'another program' } }" 2^>nul`) do set "KIND=%%C"
call :log "    PID %PID%: %KIND%"
exit /b 0

:warnshared
call :log "[!] Two pi-web servers share ~/.pi: never send, rename, delete or branch the same live conversation in both."
call :log "[!] The running/finished status is per server, not ownership. For a fully isolated second instance set PI_CODING_AGENT_DIR."
exit /b 0

:badarg
call :err "[ERROR] Unknown argument: %~1"
call :err "        Try: start-pi-web.cmd help"
exit /b 2

:badport
call :err "[ERROR] Not a valid port: %~1 (expected 1-65535)"
exit /b 2

:badcombo
call :err "[ERROR] rebuild only applies to the fork, not to official"
exit /b 2

:failpushd
call :err "[ERROR] Could not enter %FORK%"
goto fail

:fail
exit /b 1
