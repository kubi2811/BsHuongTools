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

echo [1/5] May chua co Node.js  -^> dang TU CAI (can Internet, 1-3 phut)...
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
echo [1/5] Node.js %NODEV%   OK

REM ================= 2) Cap nhat ban moi nhat tu GitHub =================
if not exist "%ROOT%\.git" goto skipupdate
where git >nul 2>&1
if errorlevel 1 goto skipupdate
echo [2/5] Dang kiem tra ban cap nhat moi...
git -C "%ROOT%" fetch --quiet origin 2>nul
for /f "delims=" %%a in ('git -C "%ROOT%" rev-parse HEAD 2^>nul') do set "CUR=%%a"
for /f "delims=" %%b in ('git -C "%ROOT%" rev-parse origin/main 2^>nul') do set "NEW=%%b"
if "%CUR%"=="%NEW%" (
  echo       -^> Dang dung ban moi nhat
  goto skipupdate
)
if "%NEW%"=="" (
  echo       -^> Khong ket noi duoc GitHub, dung ban hien tai
  goto skipupdate
)
echo       -^> Co ban moi! Dang tai ve...
git -C "%ROOT%" stash --quiet 2>nul
git -C "%ROOT%" pull --quiet origin main
if errorlevel 1 (
  echo       -^> Cap nhat that bai, dung ban hien tai
) else (
  echo       -^> DA CAP NHAT ban moi nhat
  set "NEEDINSTALL=1"
)
:skipupdate

REM ================= 3) Thu vien =================
if not exist "%ROOT%\node_modules" set "NEEDINSTALL=1"
if "%NEEDINSTALL%"=="1" (
  echo [3/5] Dang cai thu vien lan dau - can Internet, 1-3 phut...
  call npm install --no-audit --no-fund
)
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok

echo [3/5] Thu vien chua khop voi Node %NODEV% -^> dang cai lai (can Internet)...
REM better-sqlite3 la module bien dich theo phien ban Node. Phai XOA roi cai lai
REM thi no moi tai ban dung; chi "npm install" khong du vi npm thay da co san.
if exist "%ROOT%\node_modules\better-sqlite3" rmdir /s /q "%ROOT%\node_modules\better-sqlite3"
call npm install --no-audit --no-fund
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok

echo       -^> Van chua duoc, thu bien dich lai...
call npm rebuild better-sqlite3
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok
echo.
echo     [X] Cai thu vien that bai. Kiem tra Internet roi bam dup lai file nay.
echo.
pause
exit /b 1
:libok
echo [3/5] Thu vien        OK

REM ================= 4) File cau hinh .env =================
if exist "%ROOT%\.env" goto envok
echo.
echo [4/5] Chua co cau hinh - nhap thong tin dang nhap HIS:
echo.
set "U="
set /p U=      Tai khoan HIS (vd HUL28):
if "%U%"=="" (
  echo.
  echo     [X] Chua nhap tai khoan. Bam dup lai file nay.
  pause
  exit /b 1
)
set "P="
set /p P=      Mat khau HIS          :
if "%P%"=="" (
  echo.
  echo     [X] Chua nhap mat khau. Bam dup lai file nay.
  pause
  exit /b 1
)
set "K="
set /p K=      Khoa lam viec (Enter = Khoa San N2):
if "%K%"=="" set "K=Khoa Sản N2"
set "M="
set /p M=      Ma PIN vao web (Enter = 1234):
if "%M%"=="" set "M=1234"

> "%ROOT%\.env" echo # Cau hinh local - KHONG commit file nay
>> "%ROOT%\.env" echo HIS_URL=https://bvtudu.tudu.com.vn/
>> "%ROOT%\.env" echo PORT=3000
>> "%ROOT%\.env" echo PIN=%M%
>> "%ROOT%\.env" echo HIS_USER=%U%
>> "%ROOT%\.env" echo HIS_PASS=%P%
>> "%ROOT%\.env" echo KHOA=%K%
>> "%ROOT%\.env" echo CONFIRM_BEFORE_SAVE=true
echo.
echo       -^> Da luu cau hinh. Doi tai khoan sau: sua file .env
:envok
echo [4/5] Cau hinh .env   OK

REM ================= 5) Chay bot =================
echo [5/5] Dang khoi dong bot...
echo.
echo ============================================================
echo     May nay    :  http://localhost:3000
echo     Dien thoai :  dung 1 dia chi IPv4 duoi day, them  :3000
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
