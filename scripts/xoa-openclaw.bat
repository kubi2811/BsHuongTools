@echo off
chcp 65001 >nul
title Xoa OpenClaw / 9router
setlocal

REM --- Bat buoc quyen Administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   [!] CAN QUYEN ADMINISTRATOR.
  echo       Chuot phai file xoa-openclaw.bat -^> "Run as administrator" -^> Yes.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   GO OPENCLAW / 9ROUTER (khong dung toi HIS / Tailscale)
echo ============================================================
echo.

echo [1/5] Xoa tac vu lich OpenClaw/9router...
schtasks /delete /tn "OpenClaw 9router Boot" /f >nul 2>&1
schtasks /delete /tn "OpenClaw Gateway" /f >nul 2>&1
echo       -^> xong

echo [2/5] Dung process OpenClaw (port 18789 + 20128 + node openclaw)...
for %%P in (18789 20128) do (
  for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do taskkill /F /PID %%i /T >nul 2>&1
)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'openclaw|9router' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo       -^> xong

echo [3/5] Xoa file tu-khoi-dong trong Startup...
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OpenClaw*.cmd" >nul 2>&1
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OpenClaw*.cmd.disabled" >nul 2>&1
echo       -^> xong

echo [4/5] Go goi npm openclaw + 9router...
call npm uninstall -g openclaw 9router
echo       -^> xong

echo [5/5] Doi ten thu muc du lieu .openclaw thanh backup (KHONG xoa han)...
if exist "%USERPROFILE%\.openclaw" (
  move "%USERPROFILE%\.openclaw" "%USERPROFILE%\.openclaw_BACKUP" >nul 2>&1
  if exist "%USERPROFILE%\.openclaw" (echo       -^> chua doi ten duoc ^(process con giu file? chay lai sau khi reboot^)) else (echo       -^> da doi ten thanh .openclaw_BACKUP)
) else (
  echo       -^> khong thay thu muc .openclaw
)

echo.
echo ============================================================
echo   XONG. OpenClaw da bi go + TAT tu-khoi-dong.
echo   Du lieu backup o: %USERPROFILE%\.openclaw_BACKUP
echo   (Chac chan khong can thi xoa thu muc backup do bang tay.)
echo   -^> NEN KHOI DONG LAI MAY 1 lan.
echo ============================================================
echo.
pause
