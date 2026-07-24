@echo off
chcp 65001 >nul
title Cai dat Tro ly nhap lieu HIS tren may moi
cd /d "%~dp0.."
set "ROOT=%CD%"

echo ============================================================
echo    KIEM TRA / CAI DAT TREN MAY MOI
echo ============================================================
echo.

REM ---------- 1) Node.js ----------
where node >nul 2>&1
if errorlevel 1 goto nonode
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [OK] Node.js %NODEV%
echo      (May goc dung v24. Neu ban lon khac, script se tu cai lai thu vien.)
goto checkedge

:nonode
echo [X] CHUA CAI Node.js
echo.
echo     Vao https://nodejs.org  tai ban "LTS" ^-^> cai dat ^-^> chay lai file nay.
echo.
pause
exit /b 1

REM ---------- 2) Microsoft Edge ----------
:checkedge
set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE1%" goto edgeok
if exist "%EDGE2%" goto edgeok
echo [X] KHONG THAY Microsoft Edge. Bot chay bang Edge nen bat buoc phai co.
echo     Cai Edge roi chay lai file nay.
pause
exit /b 1
:edgeok
echo [OK] Microsoft Edge

REM ---------- 3) File .env (tai khoan HIS) ----------
if exist "%ROOT%\.env" goto envok
echo [X] THIEU file .env (chua tai khoan HIS + ma PIN).
echo     Chep file .env tu may cu vao thu muc: %ROOT%
pause
exit /b 1
:envok
echo [OK] Co file .env

REM ---------- 4) Thu vien ----------
echo.
echo [..] Kiem tra thu vien (better-sqlite3 la module bien dich theo phien ban Node)...
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok
echo      Thu vien chua chay duoc voi Node tren may nay -^> dang cai lai (can Internet)...
call npm install
node -e "require('better-sqlite3')" >nul 2>&1
if not errorlevel 1 goto libok
echo.
echo [X] Van loi. Hay noi mang Internet roi chay lenh:  npm install
echo     (hoac cai dung Node v24 giong may goc de dung thu vien co san trong zip)
pause
exit /b 1
:libok
echo [OK] Thu vien san sang

echo.
echo ============================================================
echo    XONG! May nay da chay duoc.
echo.
echo    Chay bot   :  bam dup file  start-server.bat  (thu muc goc)
echo    Tu chay 24/7:  chuot phai scripts\thiet-lap-24-7.bat -^> Run as administrator
echo ============================================================
echo.
pause
