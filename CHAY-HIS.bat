@echo off
chcp 65001 >nul
title Tro ly nhap lieu HIS
cd /d "%~dp0"
set "ROOT=%CD%"

cls
echo ============================================================
echo     TRO LY NHAP LIEU HIS  -  dang chuan bi, doi chut...
echo ============================================================
echo.

REM ================= 1) Node.js =================
where node >nul 2>&1
if not errorlevel 1 goto nodeok

echo [1/4] May chua co Node.js  -^> dang TU CAI (can Internet, 1-3 phut)...
where winget >nul 2>&1
if errorlevel 1 goto nowinget
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 goto nodeok

:nowinget
echo.
echo     [X] Khong tu cai Node.js duoc.
echo         Vao  https://nodejs.org  tai ban LTS  -^> cai xong bam dup lai file nay.
echo.
pause
exit /b 1

:nodeok
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [1/4] Node.js %NODEV%   OK

REM ================= 2) File cau hinh .env =================
if exist "%ROOT%\.env" goto envok
echo.
echo [2/4] [X] THIEU file .env  (tai khoan HIS + ma PIN).
echo           Chep file .env tu may cu vao thu muc:
echo           %ROOT%
echo.
pause
exit /b 1
:envok
echo [2/4] Cau hinh .env   OK

REM ================= 3) Thu vien =================
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok
echo [3/4] Dang cai thu vien (lan dau hoac Node khac ban) - can Internet...
call npm install
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok
echo.
echo     [X] Cai thu vien that bai. Noi Internet roi bam dup lai file nay.
echo.
pause
exit /b 1
:libok
echo [3/4] Thu vien        OK

REM ================= 4) Chay bot =================
echo [4/4] Dang khoi dong bot...
echo.
echo ============================================================
echo     May nay    :  http://localhost:3000
echo     Dien thoai :  dung 1 dia chi IPv4 duoi day, them  :3000
echo     Ma PIN     :  xem trong file .env  (mac dinh 1234)
echo.
ipconfig | findstr /c:"IPv4"
echo ============================================================
echo     CU DE CUA SO NAY MO trong luc dung.
echo     Dong cua so = TAT bot.
echo ============================================================
echo.

REM Tat server cu con giu port 3000 (neu co) de tranh chay 2 ban
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
call npm run server

echo.
echo ============================================================
echo     BOT DA DUNG. Bam phim bat ky de dong cua so.
echo     Muon chay lai: bam dup file  CHAY-HIS.bat
echo ============================================================
pause >nul
