@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"
)

if not exist "%NODE_EXE%" (
  echo Node.js executable was not found.
  echo Install Node.js or run this task inside Codex where the bundled runtime is available.
  pause
  exit /b 1
)

set "KAKAO_REST_API_KEY="
set /p "KAKAO_REST_API_KEY=Kakao REST API key: "

if "%KAKAO_REST_API_KEY%"=="" (
  echo KAKAO_REST_API_KEY is empty. Geocoding was not run.
  pause
  exit /b 1
)

echo Running Kakao batch geocoding...
"%NODE_EXE%" scripts\prepare-data.mjs --geocode
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  echo.
  echo Done. Updated data.json and geocoding_failures.json.
) else (
  echo.
  echo Geocoding failed with exit code %EXIT_CODE%.
)

pause
exit /b %EXIT_CODE%
