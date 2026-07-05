@echo off
REM Khởi động Trợ lý nhập liệu HIS. Dùng cho Task Scheduler (trigger: At log on).
REM Chạy dạng "Run only when user is logged on" (browser headed cần desktop session).
cd /d "%~dp0.."
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
call npm run server
pause
