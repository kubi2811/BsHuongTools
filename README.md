# Trợ lý nhập liệu HIS (BS Hương Tools)

Tool nội bộ tự động hóa nhập liệu web HIS bằng **Playwright + Edge**, có giao diện web
điều khiển từ điện thoại/máy tính. Bác sĩ nhập dữ liệu tối thiểu → bot tự điền trên HIS,
dừng ở điểm xác nhận trước khi Lưu (an toàn y lệnh).

## Các luồng đã có
- **Luồng 1** — Chích vaccine (tờ điều trị → chỉ định dịch vụ PK022 → khám sàng lọc → chỉ định vaccine BCG/VGB).
- **Luồng 2** — Khám sơ sinh (tờ điều trị → khám chuyên khoa khoa sơ sinh).
- **Luồng 3** — Khám phục hồi chức năng.
- **Luồng 4** — Đánh toa xuất viện (đang phát triển).

## Chạy
```bash
npm install                 # cài dependencies (dùng Edge có sẵn, không tải Chromium)
cp .env.example .env        # điền HIS_URL, HIS_USER, HIS_PASS, PIN...
npm run server              # mở http://localhost:3000 (đăng nhập bằng PIN)
```

Truy cập từ điện thoại (cùng WiFi): `http://<IP-máy>:3000`.

## Kiến trúc
- `server/index.ts` — Express + SQLite (better-sqlite3) + hàng đợi 1 job + quản lý Edge bền vững + REST API + phục vụ UI.
- `ui/index.html` — giao diện web mobile-first (PIN → trang chủ → form → chi tiết job có timeline ảnh + nút Xác nhận/Hủy).
- `src/flow1.ts` — các bước Playwright cho từng luồng (orchestrator + hàm dùng chung).
- `src/luong4.ts` — dữ liệu combo/thuốc cho luồng đánh toa xuất viện.
- Chi tiết selector: `docs/quy-trinh-tiem-chung.md`. Kế hoạch tổng thể: `PLAN.md`.

## Nguyên tắc an toàn
Dữ liệu bệnh nhân ở local 100%; 1 job/lúc; dừng xác nhận trước khi Lưu (y lệnh);
không hardcode mật khẩu (đọc từ `.env`, không commit); fail an toàn không đoán mò.

> ⚠️ KHÔNG commit `.env`, `data/`, `note.txt` (chứa mật khẩu HIS + dữ liệu bệnh nhân).
