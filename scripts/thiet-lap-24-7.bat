@echo off
chcp 65001 >nul
title Thiet lap may chay HIS 24/7
setlocal

REM Thu muc goc du an (thu muc cha cua scripts\)
pushd "%~dp0.."
set "ROOT=%CD%"
popd

REM --- Bat buoc quyen Administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   [!] CAN QUYEN ADMINISTRATOR.
  echo       Dong cua so nay, CHUOT PHAI file thiet-lap-24-7.bat
  echo       -^> "Run as administrator" -^> Yes.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   THIET LAP MAY CHAY HIS 24/7
echo ============================================================
echo.

echo [1/5] Chan Windows Update TU KHOI DONG LAI khi dang dang nhap...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f >nul
echo       -^> OK (Update van tai/ cai, nhung KHONG tu restart)

echo [2/5] Khong Sleep / Hibernate khi cam dien...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
echo       -^> OK

echo [3/5] Gap man hinh (khi cam dien) = KHONG LAM GI...
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
echo       -^> OK (dong nap van chay)

echo [4/5] Tat Fast Startup (on dinh hon cho chay lien tuc)...
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f >nul
echo       -^> OK

echo [5/5] Tu chay HIS server khi dang nhap Windows...
schtasks /create /tn "HIS Server 24-7" /tr "\"%ROOT%\start-server.bat\"" /sc onlogon /rl highest /f >nul
if %errorlevel%==0 (echo       -^> OK: tao tac vu "HIS Server 24-7") else (echo       -^> Loi tao tac vu ^(bo qua cung duoc, van chay tay bang start-server.bat^))

echo.
echo ============================================================
echo   XONG! Nen KHOI DONG LAI may 1 lan de ap dung het.
echo   Tu gio: CAM SAC + dang nhap Windows -^> server tu chay,
echo   Windows Update se KHONG tu restart khi ban dang dung.
echo   (Thinh thoang nen tu tay Update + restart luc rANH.)
echo ============================================================
echo.
pause
