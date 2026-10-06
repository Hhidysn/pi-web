@echo off
setlocal EnableExtensions
rem Open the browser once the server answers, not merely once the port is bound.
rem Usage: open-when-ready.cmd <port>
rem The log to note a timeout in is derived from this file's folder and the port,
rem the same way start-pi-web.cmd names it (pi-web-<port>.log).
set "PORT=%~1"
if "%PORT%"=="" exit /b 1
set "BASE=%~dp0"
set "LOG=%BASE%pi-web-%PORT%.log"
set "URL=http://127.0.0.1:%PORT%/"
set "HAVECURL="
where curl >nul 2>&1 && set "HAVECURL=1"
for /l %%I in (1,1,30) do (
  if defined HAVECURL (
    curl -s -o nul --max-time 2 "%URL%" && (start "" "%URL%" & exit /b 0)
  ) else (
    netstat -an | findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING" >nul 2>&1 && (start "" "%URL%" & exit /b 0)
  )
  ping -n 2 127.0.0.1 >nul
)
echo [%DATE% %TIME%] browser not opened: %URL% did not answer within ~60 s >> "%LOG%" 2>nul
exit /b 1
