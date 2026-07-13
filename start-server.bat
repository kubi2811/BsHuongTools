@echo off
title Tro ly nhap lieu HIS - Server
cd /d "%~dp0"

echo ============================================================
echo    TRO LY NHAP LIEU HIS  -  dang khoi dong server...
echo ------------------------------------------------------------
echo    May nay   :  http://localhost:3000
echo    Dien thoai:  dung 1 dia chi IPv4 duoi day, them  :3000
echo    Ma PIN    :  xem trong file .env  (mac dinh 1234)
echo.
ipconfig | findstr /c:"IPv4"
echo ============================================================
echo    Cu de cua so nay MO trong luc dung. Dong = tat server.
echo ============================================================
echo.

REM Dung server cu dang chiem port 3000 (neu co) de chay ban MOI - tranh chay 2 server.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
call npm run server

echo.
echo ============================================================
echo    SERVER DA DUNG. Nhan phim bat ky de dong cua so nay.
echo    Muon chay lai: bam dup file  start-server.bat
echo ============================================================
pause >nul
