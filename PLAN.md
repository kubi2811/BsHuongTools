# PLAN — "Trợ lý nhập liệu HIS" (Hospital Input Assistant)

> File này dành cho **Claude Code** đọc và thực hiện, chạy trên laptop Windows 11 đặt tại bệnh viện.
> Chủ dự án (user) sẽ ngồi cùng và test từng bước.

---

## 0. Hướng dẫn làm việc cho Claude Code

1. Đọc **toàn bộ file** trước khi viết dòng code nào.
2. Trước khi bắt đầu, hỏi user các câu ở **mục 15** (chỉ hỏi cái nào chưa rõ).
3. Build theo từng Phase ở **mục 13**, đúng thứ tự. Cuối mỗi phase: chạy thử, hướng dẫn user test, chờ user xác nhận OK rồi mới sang phase tiếp theo.
4. Đây là tool nội bộ cho 1–2 người dùng → ưu tiên **đơn giản, dễ đọc, dễ sửa**. Không over-engineer, không cần scale, không cần Docker/Redis/microservice.
5. **Không tự bịa selector.** Nếu chưa có recording/ghi chú quy trình thật từ Phase 0 thì không được viết workflow — yêu cầu user chạy record trước.
6. Comment code bằng tiếng Việt.
7. Tuyệt đối giữ các nguyên tắc ở mục 2, kể cả khi user muốn làm nhanh.

---

## 1. Bối cảnh & mục tiêu

- Bác sĩ phải nhập tay các quy trình lặp lại (tiêm chủng, cấp đơn thuốc...) trên **web nội bộ bệnh viện (HIS)**. Mỗi ca mất 3–4 phút bấm, thao tác giống nhau, chỉ khác dữ liệu (tên bệnh nhân, loại thuốc...).
- Thiết bị: **1 laptop Win 11** cắm điện 24/24, nối WiFi bệnh viện (chỉ mạng này mới vào được HIS) + **1 iPhone** của bác sĩ.
- Mục tiêu: 1 web app chạy trên laptop. Bác sĩ (từ laptop hoặc iPhone) nhập dữ liệu tối thiểu → bấm **Start** → bot tự mở web HIS trên laptop và bấm/điền thay, có bước xác nhận trước khi lưu.
- Kết quả mong muốn: thao tác của người giảm từ 3–4 phút/ca xuống ~20–30 giây/ca, và có thể nhập hàng loạt.
- Kèm **trang thống kê** (chung một web với phần điều khiển): xem luồng nào đang chạy tới bước nào, bệnh nhân nào đã làm gì, luồng nào hay kẹt ở bước nào — có ảnh màn hình từng bước lưu trên laptop để đối chiếu.

---

## 2. Nguyên tắc bắt buộc (không thương lượng)

1. **Điểm xác nhận trước khi lưu.** Mặc định mọi workflow dừng ngay trước nút Lưu/Hoàn tất: bot điền xong → chụp màn hình → bác sĩ xem lại (trên laptop hoặc iPhone) → bấm "Xác nhận" thì bot mới bấm Lưu. Đây là y lệnh (thuốc/vaccine), sai là ảnh hưởng bệnh nhân. Sau này khi đã tin cậy, có thể tắt per-workflow qua config.
2. **Dữ liệu bệnh nhân ở local 100%.** Không cloud, không hosting ngoài, không gửi dữ liệu đi đâu. Server, DB, screenshot đều nằm trên laptop. iPhone kết nối qua Tailscale (mã hóa điểm-điểm).
3. **Một job một lúc.** Hàng đợi concurrency = 1, một cửa sổ browser duy nhất. Không bao giờ chạy song song trên HIS.
4. **Ghi vết đầy đủ.** Mỗi bước có log + screenshot để đối chiếu khi cần.
5. **Không hardcode mật khẩu HIS trong code.** Đăng nhập tay 1 lần trong browser profile bền vững. Auto-login là tùy chọn qua `.env` local, mặc định tắt.
6. **Fail an toàn.** Gặp bất kỳ điều bất thường (không thấy selector, trang lạ, popup lạ) → dừng job, chụp màn hình, đánh dấu failed, báo trên UI. KHÔNG đoán mò bấm tiếp.

---

## 3. Kiến trúc

```
 iPhone (Safari, PWA)              Laptop Win 11 (cắm 24/24, WiFi bệnh viện)
┌──────────────────┐   Tailscale   ┌────────────────────────────────────────┐
│  UI điều khiển    │◄─────────────►│  Node.js server (Express, port 3000)  │
│  - tạo job        │  (hoặc LAN)   │   ├─ UI tĩnh (React build)             │
│  - xem hàng đợi   │               │   ├─ REST API + SQLite (jobs, logs)    │
│  - bấm Xác nhận   │               │   └─ Queue (1 job/lúc)                 │
└──────────────────┘               │          │                             │
                                   │          ▼                             │
                                   │  Playwright → Edge (headed,            │
                                   │  persistent profile giữ đăng nhập)     │
                                   │          │                             │
                                   │          ▼                             │
                                   │   Web HIS nội bộ bệnh viện             │
                                   └────────────────────────────────────────┘
```

Laptop vừa là **server** vừa là **robot**. iPhone chỉ là remote control qua trình duyệt.

---

## 4. Stack kỹ thuật

| Thành phần | Chọn | Lý do |
|---|---|---|
| Runtime | Node.js 20/22 LTS + TypeScript, chạy bằng `tsx` | Khỏi cần build step cho server, đơn giản |
| Server | Express | Quen thuộc, đủ dùng |
| DB | better-sqlite3, file `data/app.db` | Không cần DB server, backup = copy file |
| Automation | **Playwright**, `channel: 'msedge'`, headed, `launchPersistentContext('./data/browser-profile')` | Edge có sẵn trên Win 11; persistent profile giữ session đăng nhập HIS; headed để nhìn thấy bot làm gì và đăng nhập tay khi cần |
| Frontend | React + Vite + MUI, mobile-first, build ra `server/public` | User quen React/MUI; server serve luôn file tĩnh |
| Realtime | Polling 2 giây | Đơn giản, đủ dùng; nâng SSE sau nếu muốn |
| Truy cập từ xa | Tailscale (gói personal, miễn phí) | Xem mục 10 |

Ghi chú cài đặt:
- Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` khi `npm install` (dùng Edge có sẵn, khỏi tải Chromium).
- Khi server khởi động, nếu port đã bận → thoát ngay với thông báo rõ (tránh chạy 2 bot cùng lúc).

File `.env` mẫu:

```env
PORT=3000
PIN=doi-cai-nay-ngay          # mã PIN đăng nhập UI
HIS_URL=https://...           # URL trang HIS, user cung cấp
SCREENSHOT_RETENTION_DAYS=7
# Tùy chọn auto-login (mặc định để trống — đăng nhập tay):
# HIS_USER=
# HIS_PASS=
```

---

## 5. Cấu trúc thư mục

```
hisbot/
├── PLAN.md                     # file này
├── .env
├── server/
│   ├── index.ts                # Express app, serve UI + API
│   ├── config.ts               # đọc .env
│   ├── api/                    # routes: auth, jobs, workflows, system
│   ├── queue/queue.ts          # hàng đợi concurrency 1, state lưu trong DB
│   ├── runner/
│   │   ├── browser.ts          # BrowserManager: mở/đóng/watchdog persistent context
│   │   ├── executor.ts         # nhận job từ queue, tạo RunContext, chạy workflow
│   │   └── helpers.ts          # ensureLoggedIn, fillByLabel, clickAndWaitNav...
│   ├── workflows/
│   │   ├── registry.ts         # auto-load các folder workflow
│   │   └── tiem-chung/
│   │       ├── manifest.json
│   │       └── run.ts
│   └── db/
│       ├── db.ts
│       └── migrations.sql
├── ui/                         # React + Vite, build ra ../server/public
├── data/                       # KHÔNG commit git, KHÔNG để trong folder OneDrive sync
│   ├── app.db
│   ├── screenshots/
│   ├── logs/
│   └── browser-profile/        # session đăng nhập HIS nằm ở đây
├── docs/
│   ├── recordings/             # code sinh ra từ playwright codegen
│   └── quy-trinh-*.md          # ghi chú quy trình từ Phase 0
└── scripts/
    ├── record.ts               # mở playwright codegen tới HIS_URL để ghi quy trình mới
    └── start.bat               # dùng cho Task Scheduler autostart
```

---

## 6. Database (SQLite)

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  data_json TEXT NOT NULL,          -- dữ liệu form người dùng nhập
  patient_name TEXT,                -- trích từ field khai báo trong manifest → tra cứu/thống kê
  patient_code TEXT,                -- mã BN, như trên
  status TEXT NOT NULL DEFAULT 'queued',
  -- queued | running | waiting_confirm | success | failed | canceled
  error TEXT,
  current_step TEXT,
  created_at TEXT NOT NULL,         -- ISO string, UI hiển thị theo giờ VN
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  step TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',   -- info | error
  message TEXT,
  screenshot TEXT,                      -- đường dẫn file ảnh (nếu có)
  duration_ms INTEGER,                  -- thời gian chạy của bước → thống kê bước chậm
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_patient ON jobs(patient_name, patient_code);
CREATE INDEX IF NOT EXISTS idx_logs_job     ON job_logs(job_id);
```

Quy tắc: job đang `running` mà server bị tắt/restart giữa chừng → khi khởi động lại, đánh dấu job đó `failed` với lỗi "gián đoạn giữa chừng" để người chạy lại tay. **Không tự resume nửa chừng** — tránh double-submit trên HIS.

---

## 7. Workflow engine

Mỗi quy trình = 1 folder trong `server/workflows/<id>/` gồm 2 file:

**`manifest.json`** — khai báo input để UI **tự sinh form** (thêm quy trình mới không phải sửa UI):

```json
{
  "id": "tiem-chung",
  "name": "Tạo đơn tiêm chủng",
  "icon": "💉",
  "confirmBeforeSubmit": true,
  "patientNameField": "hoTen",
  "patientCodeField": "maBN",
  "fields": [
    { "key": "hoTen", "label": "Họ tên bệnh nhân", "type": "text", "required": true },
    { "key": "maBN", "label": "Mã bệnh nhân", "type": "text", "required": false },
    { "key": "loaiVaccine", "label": "Loại vaccine", "type": "select",
      "options": ["<điền sau Phase 0>"] }
  ]
}
```

> Danh sách field trên chỉ là ví dụ — field thật sẽ chốt ở Phase 0.
> `patientNameField` / `patientCodeField` báo cho hệ thống biết field nào là danh tính bệnh nhân — dùng cho tra cứu và trang thống kê.

**`run.ts`** — các bước Playwright:

```ts
import type { Page } from 'playwright';
import type { RunContext } from '../../runner/executor';

export async function run(page: Page, ctx: RunContext) {
  const { data } = ctx;

  await ctx.step('Mở trang tiêm chủng', async () => {
    await page.goto(ctx.config.hisUrl + '/duong-dan-lay-tu-recording'); // TODO Phase 0
  });

  await ctx.step('Tìm bệnh nhân', async () => {
    await page.fill('#txtTimBN', data.hoTen);   // TODO: selector thật từ recording
    // ...
  });

  await ctx.step('Điền thông tin đơn', async () => {
    // ... TODO từ recording
  });

  // Dừng lại, chụp màn hình, chờ bác sĩ bấm Xác nhận trên UI
  await ctx.confirmPoint('Kiểm tra đơn trước khi lưu');

  await ctx.step('Bấm Lưu', async () => {
    await page.click('#btnLuu');                // TODO
    // chờ dấu hiệu lưu thành công (toast/URL đổi/...) rồi mới coi là xong
  });
}
```

**RunContext API** (executor cung cấp):

```ts
interface RunContext {
  data: Record<string, string>;   // dữ liệu form của job
  config: { hisUrl: string };
  step(name: string, fn: () => Promise<void>): Promise<void>;
  // ^ tự động: ghi log, chụp screenshot SAU khi step xong; nếu lỗi → chụp màn hình
  //   + lưu page.content() ra file .html để debug selector, rồi throw
  confirmPoint(name: string): Promise<void>;
  // ^ chụp màn hình, set job.status = 'waiting_confirm', PAUSE cho tới khi
  //   user bấm Xác nhận (tiếp tục) hoặc Hủy (job → canceled) trên UI.
  //   Nếu manifest.confirmBeforeSubmit = false thì hàm này tự skip.
  screenshot(label?: string): Promise<string>;
  log(msg: string): void;
}
```

**Quy tắc chọn selector** (áp dụng khi viết run.ts từ recording):
- Ưu tiên: `#id` > `[name=...]` > `getByLabel()` / `getByRole()` > text. Tránh `nth-child`, tránh class tự sinh.
- Default timeout mỗi action: 15 giây.
- HIS có iframe → dùng `page.frameLocator()`. Có popup cửa sổ mới → `context.waitForEvent('page')`.
- Sau bước Lưu phải **chờ dấu hiệu thành công** rõ ràng, không được "bấm xong coi như xong".

---

## 8. REST API

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | `{pin}` → set cookie phiên (30 ngày) |
| GET | `/api/workflows` | Danh sách workflow (từ manifest) |
| POST | `/api/jobs` | `{workflowId, data}` hoặc `{workflowId, batch: data[]}` (nhập hàng loạt) |
| GET | `/api/jobs?status=&patient=&workflowId=&from=&to=&limit=` | Danh sách job, lọc theo trạng thái / bệnh nhân / luồng / khoảng ngày |
| GET | `/api/jobs/:id` | Chi tiết job + logs + URL screenshot |
| POST | `/api/jobs/:id/confirm` | Tiếp tục job đang `waiting_confirm` |
| POST | `/api/jobs/:id/cancel` | Hủy job (queued hoặc waiting_confirm) |
| POST | `/api/jobs/:id/retry` | Tạo job mới copy dữ liệu từ job failed |
| GET | `/api/system/status` | `{browserOk, hisLoggedIn, queueLength, currentJob, needsLogin}` |
| POST | `/api/system/open-browser` | Mở/khởi động lại browser (dùng khi cần đăng nhập tay HIS) |
| GET | `/api/stats/overview?from=&to=` | Thẻ số liệu: số ca theo trạng thái & theo luồng, số ca hôm nay, thời gian trung bình mỗi ca |
| GET | `/api/stats/steps?workflowId=&from=&to=` | Bảng điểm kẹt: số lần lỗi + thời gian trung bình theo từng bước của từng luồng |
| GET | `/screenshots/:file` | Ảnh (yêu cầu đã đăng nhập PIN) |

Mọi route (trừ login) đều qua middleware kiểm tra cookie PIN.

---

## 9. UI — các màn hình

Mobile-first (bác sĩ chủ yếu dùng iPhone), nút to, thao tác được bằng 1 tay.

1. **Đăng nhập PIN** — 1 ô nhập, lưu cookie 30 ngày.
2. **Trang chủ** — banner trạng thái hệ thống (🟢 Bot sẵn sàng / 🔴 Cần đăng nhập lại HIS trên laptop / 🔵 Đang chạy job X) + lưới nút quy trình (Tiêm chủng, Cấp thuốc...) + 5 job gần nhất.
3. **Form quy trình** — sinh tự động từ manifest → nút **"Chạy ngay"** / **"Thêm vào hàng đợi"**.
4. **Nhập hàng loạt** — textarea dán từ Excel (tab-separated), preview thành bảng, map cột với field, tạo N job một lượt.
5. **Hàng đợi & lịch sử** — danh sách job, badge màu theo trạng thái, tap để xem chi tiết.
6. **Chi tiết job** — timeline từng bước + screenshot; nếu `waiting_confirm` → hiện ảnh form đã điền + 2 nút to **✅ Xác nhận** / **❌ Hủy**. Đây là màn hình bác sĩ dùng nhiều nhất từ điện thoại.
7. **Thống kê** — tab riêng trong cùng web (không phải site tách rời; số liệu đọc live từ SQLite qua API):
   - **Thẻ số liệu**: số ca hôm nay; thành công / lỗi / đang chờ xác nhận; tổng số ca theo từng luồng. Có bộ lọc khoảng ngày + luồng.
   - **Đang chạy & chờ xác nhận**: mỗi dòng = luồng, bệnh nhân, bước hiện tại, đã ở bước đó bao lâu. Job chờ xác nhận quá 10 phút hoặc đứng yên bất thường → highlight đỏ. Tap mở chi tiết job (timeline + ảnh).
   - **Bảng điểm kẹt**: đếm số lần lỗi theo từng bước của từng luồng trong khoảng thời gian chọn (ví dụ "Cấp thuốc → bước Tìm bệnh nhân: lỗi 4 lần tuần này") + thời gian trung bình mỗi bước → nhìn là biết luồng nào hay kẹt ở bước nào.
   - **Tra cứu bệnh nhân**: gõ tên hoặc mã BN → danh sách các ca của bệnh nhân đó (luồng nào, khi nào, kết quả) → tap xem timeline + ảnh màn hình từng bước.
   - Ảnh của các ca cũ hơn `SCREENSHOT_RETENTION_DAYS` đã bị dọn → hiện ghi chú "ảnh đã xóa theo chính sách lưu trữ", log chữ vẫn còn nguyên.
8. **PWA** — `manifest.json` + icon + apple-touch-icon để "Add to Home Screen" trên iPhone, mở fullscreen như app thật.

---

## 10. Truy cập từ iPhone — không cần domain/hosting

**Phương án chính: Tailscale** (gói personal miễn phí):
- Cài Tailscale trên laptop + app Tailscale trên iOS, đăng nhập **cùng một tài khoản** → 2 máy nằm trong mạng riêng ảo mã hóa (WireGuard), thấy nhau dù iPhone đang dùng 4G/5G hay WiFi khác.
- Bật MagicDNS → truy cập ổn định qua `http://<tên-laptop>:3000`.
- Mạng bệnh viện có chặn kiểu gì thì Tailscale thường vẫn chạy (tự fallback relay qua HTTPS 443).

**Phương án phụ (cùng WiFi bệnh viện):** gõ thẳng `http://<IP-laptop>:3000`. Chỉ chạy nếu WiFi không bật AP/client isolation — Phase 0 sẽ test. Kể cả khi LAN chạy được, vẫn nên cài Tailscale để dùng khi bác sĩ không ở trong vùng WiFi.

**KHÔNG dùng** hosting/VPS/tunnel công cộng: dữ liệu bệnh nhân không nên đi qua server bên ngoài, và bot vẫn bắt buộc chạy trên laptop nên hosting ngoài không giải quyết được gì.

---

## 11. Chạy bền 24/7 trên Win 11

- **Windows tự đăng nhập** user khi khởi động (netplwiz) — bắt buộc, vì browser chạy headed cần desktop session. → Vì máy tự đăng nhập, cần cất laptop chỗ an toàn/khóa phòng.
- **Task Scheduler**: task "HIS Assistant", trigger *At log on*, chạy `scripts/start.bat`, chọn *Run only when user is logged on* (KHÔNG cài dạng Windows service — service không mở được cửa sổ browser).
- **Nguồn điện**: `powercfg /change standby-timeout-ac 0` (không bao giờ sleep khi cắm điện); Control Panel → Power Options → "When I close the lid" = **Do nothing**. Tắt màn hình thì không sao.
- **Windows Update**: đặt Active hours trùng giờ làm việc để máy chỉ restart ban đêm; hệ thống tự lên lại sau restart.
- **Watchdog** trong server: phát hiện browser crash/bị đóng → tự mở lại; hàng đợi giữ nguyên.
- **Dọn dẹp**: mỗi đêm xóa screenshot cũ hơn `SCREENSHOT_RETENTION_DAYS`; log server ghi ra `data/logs/` xoay vòng theo ngày.
- UI có nút **"Restart bot"** (đóng mở lại browser) để xử lý nhanh khi kẹt.

---

## 12. Xử lý lỗi & phiên đăng nhập HIS

- **Trước mỗi job**: chạy `ensureLoggedIn(page)` — mở 1 trang chuẩn của HIS, nếu bị đá về trang login → **pause toàn bộ queue**, set trạng thái hệ thống `needs_login`, UI hiện banner đỏ "Cần đăng nhập lại HIS trên laptop". Job giữ nguyên trong hàng đợi, sau khi đăng nhập lại thì tự chạy tiếp.
- **Tùy chọn** (mặc định TẮT): nếu user điền `HIS_USER/HIS_PASS` vào `.env` thì `ensureLoggedIn` tự đăng nhập lại. Chỉ bật nếu HIS không có captcha/OTP.
- **Retry**: lỗi mạng/timeout → tự retry 1 lần; lỗi không tìm thấy selector → KHÔNG retry (dừng để người xem, vì có thể giao diện HIS đã đổi).
- Mỗi step lỗi: chụp màn hình + lưu `page.content()` ra file `.html` trong `data/screenshots/` để debug selector.

---

## 13. Roadmap theo Phase

### Phase 0 — Khảo sát & ghi quy trình (làm tại bệnh viện, cùng bác sĩ, ~1 buổi)
Mục tiêu: biến "quy trình trong đầu bác sĩ" thành tài liệu selector cụ thể. **Chưa code gì cả.**

- [ ] Mở HIS bằng Edge bình thường → xác nhận web chạy tốt trên Edge/Chromium, **không đòi IE mode**. *Nếu đòi IE mode → dừng, xem Plan B mục 14.*
- [ ] Viết `scripts/record.ts` (đọc HIS_URL từ .env, spawn `npx playwright codegen --channel=msedge <url>`). Bác sĩ thao tác trọn vẹn 1 ca tiêm chủng (ưu tiên bệnh nhân/môi trường test nếu có), lưu code sinh ra vào `docs/recordings/tiem-chung.ts`.
- [ ] Ghi `docs/quy-trinh-tiem-chung.md`: URL từng trang, selector từng ô, giá trị nhập, chỗ nào phải chờ loading, nút Lưu cuối cùng là nút nào, dấu hiệu lưu thành công là gì.
- [ ] Xác định: cơ chế login (form? captcha? OTP?), session timeout bao lâu, HIS có cho đăng nhập 2 nơi cùng lúc không.
- [ ] Test kết nối: iPhone bắt WiFi bệnh viện, dựng server tạm trên laptop (`npx serve`), thử mở `http://<IP-laptop>:3000` từ iPhone → chốt dùng LAN hay chỉ Tailscale.

**Acceptance:** có file mô tả quy trình đủ chi tiết để code workflow không cần đoán bất kỳ selector nào.

### Phase 1 — Skeleton (server + browser + UI khung)
- [ ] Init project TypeScript, Express, SQLite migrations, queue concurrency 1.
- [ ] `BrowserManager`: mở persistent context Edge headed, watchdog cơ bản.
- [ ] UI: màn hình PIN, trang chủ, hiển thị trạng thái hệ thống, nút "Mở browser / Kiểm tra đăng nhập".

**Acceptance:** từ UI bấm "Kiểm tra" → bot mở HIS trên laptop, báo đúng đã đăng nhập hay chưa.

### Phase 2 — Workflow tiêm chủng end-to-end
- [ ] Viết manifest + `run.ts` theo recording Phase 0; RunContext đầy đủ (step / screenshot / confirmPoint).
- [ ] Form UI sinh từ manifest; màn hình chi tiết job với timeline + ảnh + nút Xác nhận/Hủy.

**Acceptance:** nhập 1 bệnh nhân trên UI (laptop) → bot điền xong → bác sĩ xác nhận → lưu thành công trên HIS, có đủ log + screenshot. Thao tác của người < 30 giây.

### Phase 3 — Hàng đợi, nhập hàng loạt, độ bền lỗi
- [ ] Màn hình batch dán từ Excel → tạo N job, chạy tuần tự.
- [ ] Retry lỗi mạng; phát hiện mất phiên → pause queue + banner; nút retry job failed.

**Acceptance:** 5 job chạy liên tiếp, người chỉ cần bấm xác nhận từng ca, không phải đụng vào HIS.

### Phase 4 — Trang thống kê & giám sát
- [ ] Migration DB: thêm `patient_name`, `patient_code` (jobs) + `duration_ms` (job_logs) + index; khi tạo job, trích tên/mã BN từ field khai báo trong manifest.
- [ ] API: `/api/stats/overview`, `/api/stats/steps`, mở rộng filter cho `/api/jobs`.
- [ ] Tab Thống kê trên UI: thẻ số liệu, bảng "đang chạy & chờ xác nhận" (kèm cảnh báo kẹt), bảng điểm kẹt theo bước, tra cứu bệnh nhân.

**Acceptance:** sau khi đã chạy vài chục job, mở tab Thống kê thấy đúng: số ca hôm nay theo từng luồng, job đang chạy ở bước nào, bước nào hay lỗi nhất; gõ tên 1 bệnh nhân ra được lịch sử các ca + xem lại ảnh màn hình từng bước của ca đó.

### Phase 5 — iPhone
- [ ] Cài Tailscale trên laptop + iPhone, bật MagicDNS; hướng dẫn bác sĩ Add to Home Screen.
- [ ] Hoàn thiện responsive + PWA.

**Acceptance:** bác sĩ đứng nơi khác, dùng 4G, tạo job + bấm xác nhận được từ iPhone.

### Phase 6 — Vận hành 24/7
- [ ] Task Scheduler autostart, power settings, Windows auto sign-in, log rotation, dọn screenshot, nút "Restart bot".

**Acceptance:** reboot laptop → không đụng gì, vài phút sau iPhone vào lại được bình thường.

### Phase 7 — Nhân bản quy trình mới (cấp thuốc, ...)
- [ ] Với mỗi quy trình mới: lặp lại Phase 0 (record) + tạo folder workflow mới theo template. Mỗi quy trình ~1 buổi.

---

## 14. Rủi ro & Plan B

| Rủi ro | Cách xử lý |
|---|---|
| HIS chỉ chạy IE mode (một số HIS Việt Nam cũ) → Playwright không điều khiển được | Plan B: đổi executor sang **Power Automate Desktop** (có sẵn trên Win 11, miễn phí) hoặc AutoHotkey điều khiển chuột/phím theo tọa độ. Kiến trúc server/queue/UI giữ nguyên, chỉ thay tầng runner. Kém bền hơn Playwright nên chỉ dùng khi bắt buộc. |
| WiFi bệnh viện chặn thiết bị thấy nhau (AP isolation) | Đã chọn Tailscale làm phương án chính nên không ảnh hưởng. |
| HIS chỉ cho 1 phiên đăng nhập → bot chạy làm bác sĩ bị đăng xuất nơi khác | Hỏi IT xin tài khoản riêng cho bot, hoặc quy ước khung giờ chạy bot. Ghi nhận ở Phase 0. |
| HIS đổi giao diện → selector hỏng | Bot fail an toàn + screenshot; selector nằm gọn trong `run.ts` từng workflow nên sửa nhanh. |
| Session hết hạn giữa hàng đợi | `ensureLoggedIn` + pause queue + banner (mục 12). |
| Laptop restart do Windows Update | Autostart phục hồi; job đang chạy dở đánh dấu failed để chạy lại tay (không tự resume, tránh double-submit). |
| Nhập trùng (chạy 2 lần cùng 1 bệnh nhân) | Nếu HIS có dấu hiệu "đơn đã tồn tại" → workflow check trước khi lưu; ngoài ra lịch sử job + screenshot giúp đối chiếu. |

---

## 15. Câu hỏi Claude Code cần chốt với user trước khi code

1. URL của HIS? Đăng nhập kiểu gì (form thường / captcha / OTP)?
2. Có bệnh nhân test hoặc môi trường test không, hay phải thử trên ca thật? (nếu ca thật → tuyệt đối giữ confirm mode và test với bác sĩ ngồi cạnh)
3. Quy trình tiêm chủng gồm chính xác những field nào? (sẽ chốt hẳn trong Phase 0)
4. HIS có cho phép đăng nhập 2 nơi cùng lúc không?
5. Bác sĩ muốn xác nhận từng ca trên điện thoại lâu dài, hay sau giai đoạn thử nghiệm sẽ cho bot chạy thẳng?
6. Đã trao đổi với quản lý/IT bệnh viện về việc dùng tool hỗ trợ nhập liệu chưa? (nên có để tránh rắc rối về sau, và để hỏi câu 4 + xin tài khoản bot nếu cần)
7. Muốn giữ ảnh màn hình các ca trong bao lâu để tra cứu lại trên trang thống kê? (mặc định 7 ngày tự xóa; ảnh chứa dữ liệu bệnh nhân nên không nên giữ quá lâu)

---

## 16. Riêng tư & bảo mật

- Toàn bộ DB, screenshot, browser profile nằm trong folder dự án trên laptop. Đặt dự án ở đường dẫn ngoài vùng sync, ví dụ `C:\hisbot\` — **tuyệt đối không đặt trong Desktop/Documents nếu OneDrive đang bật backup**, vì screenshot chứa dữ liệu bệnh nhân sẽ bị đẩy lên cloud.
- UI có PIN; chỉ truy cập qua Tailscale hoặc LAN nội bộ; không mở port ra internet, không port-forward router.
- Screenshot tự xóa sau N ngày (mặc định 7, chỉnh bằng `SCREENSHOT_RETENTION_DAYS`). Lịch sử job dạng chữ (bệnh nhân, luồng, các bước, kết quả) giữ lâu dài trong DB để thống kê; muốn tra cứu lại ảnh của ca cũ thì tăng số ngày — đổi lại là ảnh chứa dữ liệu bệnh nhân nằm trên máy lâu hơn, cần cân nhắc.
- `.gitignore`: `data/`, `.env`.
