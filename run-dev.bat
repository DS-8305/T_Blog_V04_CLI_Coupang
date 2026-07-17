@echo off
setlocal

cd /d "%~dp0"

set "PNPM_CMD="

for /d %%D in ("%~dp0.local\runtime\node-v*-win-x64") do (
  if exist "%%~fD\pnpm.cmd" (
    set "PATH=%%~fD;%PATH%"
    set "PNPM_CMD=%%~fD\pnpm.cmd"
  )
)

if not defined PNPM_CMD (
  set "CODEX_DEPS=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
  if exist "%CODEX_DEPS%\bin\pnpm.cmd" (
    set "PATH=%CODEX_DEPS%\bin;%CODEX_DEPS%\node\bin;%PATH%"
    set "PNPM_CMD=%CODEX_DEPS%\bin\pnpm.cmd"
  )
)

if not defined PNPM_CMD (
  where pnpm.cmd >nul 2>nul
  if not errorlevel 1 set "PNPM_CMD=pnpm.cmd"
)

if not defined PNPM_CMD (
  echo pnpm was not found.
  echo.
  echo Install Node.js and pnpm, or keep the portable runtime under:
  echo %~dp0.local\runtime
  echo.
  echo Then run:
  echo powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local-runtime.ps1
  pause
  exit /b 1
)

"%PNPM_CMD%" run electron:dev

pause
