@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"
)

if not exist "%NODE_EXE%" (
  echo Node.js executable was not found.
  pause
  exit /b 1
)

set "KAKAO_JAVASCRIPT_KEY="
set /p "KAKAO_JAVASCRIPT_KEY=Kakao JavaScript key: "

if "%KAKAO_JAVASCRIPT_KEY%"=="" (
  echo Kakao JavaScript key is empty. index.html was not changed.
  pause
  exit /b 1
)

"%NODE_EXE%" scripts\set-kakao-js-key.mjs
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  echo.
  echo Done. Start a local server and open http://localhost:8080/
) else (
  echo.
  echo Failed with exit code %EXIT_CODE%.
)

pause
exit /b %EXIT_CODE%
