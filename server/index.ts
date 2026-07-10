// Server "Trợ lý nhập liệu HIS" - Express + SQLite + hàng đợi 1 job + điều khiển browser.
// Chạy: npm run server  (mở http://localhost:3000)
import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config, ROOT } from '../src/config.js';
import { ensureLoggedIn } from '../src/login.js';
import { setStepReporter } from '../src/helpers.js';
import { chayLuongKhamChuyenKhoa } from '../src/flow1.js';
import { chayLuong2 } from '../src/luong2.js';
import { chayLuong4, COMBO_CHON } from '../src/luong4.js';
import { chayLuong5 } from '../src/luong5.js';
import { chayLuong6 } from '../src/luong6.js';
import { chayLuong7, VACCINE_L7, type VaccineL7 } from '../src/luong7.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- DB ----------
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
const db = new Database(path.join(ROOT, 'data', 'app.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  patient_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  current_step TEXT,
  confirm_shot TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  step TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  screenshot TEXT,
  duration_ms INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs(job_id);
`);

// Job đang chạy dở lúc server tắt -> đánh dấu failed (không tự resume, tránh double-submit)
db.prepare(`UPDATE jobs SET status='failed', error='Gián đoạn giữa chừng (server restart)' WHERE status IN ('running','waiting_confirm')`).run();

const nowVN = () => new Date().toISOString();

// Dọn ảnh chụp cũ hơn N ngày (ảnh chứa dữ liệu bệnh nhân - PLAN mục 16). Log chữ trong DB vẫn giữ.
function donAnhCu(): void {
  const ttlMs = config.screenshotRetentionDays * 24 * 3600 * 1000;
  if (!(ttlMs > 0)) return;
  const now = Date.now();
  let n = 0;
  try {
    for (const f of fs.readdirSync(config.screenshotDir)) {
      const p = path.join(config.screenshotDir, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && now - st.mtimeMs > ttlMs) { fs.unlinkSync(p); n++; }
      } catch { /* bỏ qua file lỗi */ }
    }
    if (n) console.log(`🧹 Đã dọn ${n} ảnh/file cũ hơn ${config.screenshotRetentionDays} ngày.`);
  } catch { /* thư mục chưa tồn tại */ }
}

// ---------- Workflow manifest ----------
const F_HOTEN = { key: 'hoTen', label: 'Tên bệnh nhân (khỏi gõ "CB")', type: 'text', required: true };
const F_NGAY = { key: 'ngay', label: 'Ngày y lệnh (DD/MM/YYYY)', type: 'text', required: true };
const WORKFLOWS = [
  {
    // Luồng 1 = code luồng "khám bé" (chayLuong7): mở hồ sơ con, tiêm chủng, kết thúc khám, đóng hồ sơ.
    id: 'tiem-chung',
    name: 'Chích vaccine (Luồng 1)',
    icon: '💉',
    patientNameField: 'maBA',
    fields: [
      { key: 'maBA', label: 'Mã bệnh án (mẹ)', type: 'text', required: true },
      { key: 'ngay', label: 'Ngày y lệnh', type: 'text', required: true },
      { key: 'gio', label: 'Giờ y lệnh', type: 'time', default: '08:00:00', required: true },
      { key: 'vaccines', label: 'Vaccine (tự chọn)', type: 'multiselect', options: ['BCG', 'VGB'], required: true },
    ],
  },
  {
    id: 'kham-so-sinh',
    name: 'Khám sơ sinh (Luồng 2)',
    icon: '👶',
    patientNameField: 'maBA',
    fields: [
      { key: 'maBA', label: 'Mã bệnh án (mẹ)', type: 'text', required: true },
      { key: 'ngay', label: 'Ngày y lệnh', type: 'text', required: true },
      { key: 'loaiKham', label: 'Loại khám', type: 'select', options: ['Khám tim', 'Khám trẻ DV', 'Khám chiếu đèn'], required: true },
    ],
  },
  {
    id: 'kham-phcn',
    name: 'Khám phục hồi chức năng (Luồng 3)',
    icon: '🧑‍⚕️',
    patientNameField: 'hoTen',
    fields: [F_HOTEN, F_NGAY],
  },
  {
    id: 'don-thuoc-ra-vien',
    name: 'Đánh toa xuất viện (Luồng 4)',
    icon: '💊',
    patientNameField: 'maBA',
    fields: [
      { key: 'maBA', label: 'Mã bệnh án (mẹ)', type: 'text', required: true },
      { key: 'ngay', label: 'Ngày y lệnh (DD/MM/YYYY)', type: 'text', required: true },
      { key: 'combos', label: 'Combo thuốc (chọn nhiều được)', type: 'multiselect', options: Object.keys(COMBO_CHON), required: true },
    ],
  },
  {
    id: 'nhap-thuoc',
    name: 'Nhập thuốc / hậu sản (Luồng 5)',
    icon: '🤱',
    patientNameField: 'maBA',
    fields: [
      { key: 'maBA', label: 'Mã bệnh án (mẹ)', type: 'text', required: true },
      { key: 'ngay', label: 'Ngày y lệnh (DD/MM/YYYY)', type: 'text', required: true },
    ],
  },
  {
    id: 'sang-loc-be',
    name: 'Nhập sàng lọc bé (Luồng 6)',
    icon: '🧪',
    patientNameField: 'maBA',
    fields: [
      { key: 'maBA', label: 'Mã bệnh án (mẹ)', type: 'text', required: true },
      { key: 'ngay', label: 'Ngày y lệnh (DD/MM/YYYY)', type: 'text', required: true },
      { key: 'loaiXN', label: 'Loại XN sàng lọc (chọn 1 hoặc cả 2)', type: 'multiselect', options: ['Thường quy', 'Mở rộng'], default: ['Thường quy', 'Mở rộng'], required: true },
    ],
  },
];

// ---------- Quản lý browser (1 context bền vững, dùng lại) ----------
class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async getPage(): Promise<Page> {
    if (this.context && this.page && !this.page.isClosed()) return this.page;
    fs.mkdirSync(config.profileDir, { recursive: true });
    fs.mkdirSync(config.screenshotDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(config.profileDir, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
    });
    this.context.setDefaultTimeout(15_000);
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    return this.page;
  }

  async restart(): Promise<void> {
    try { await this.context?.close(); } catch {}
    this.context = null;
    this.page = null;
    await this.getPage();
  }

  async status(): Promise<{ browserOk: boolean; hisLoggedIn: boolean }> {
    const browserOk = !!(this.context && this.page && !this.page.isClosed());
    return { browserOk, hisLoggedIn: browserOk };
  }
}
const bm = new BrowserManager();

// ---------- Hàng đợi (concurrency = 1) ----------
const pendingConfirms = new Map<number, (ok: boolean) => void>();
let running = false;

function nextQueued(): { id: number } | undefined {
  return db.prepare(`SELECT id FROM jobs WHERE status='queued' ORDER BY id ASC LIMIT 1`).get() as any;
}

async function processQueue(): Promise<void> {
  if (running) return;
  const job = nextQueued();
  if (!job) return;
  running = true;

  const row = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(job.id) as any;
  const data = JSON.parse(row.data_json);
  db.prepare(`UPDATE jobs SET status='running', started_at=?, current_step='Bắt đầu' WHERE id=?`).run(nowVN(), job.id);

  // Ghi log từng bước vào DB + cập nhật current_step
  setStepReporter((r) => {
    db.prepare(`INSERT INTO job_logs(job_id, step, level, screenshot, duration_ms, at) VALUES(?,?,?,?,?,?)`)
      .run(job.id, r.name, r.level, r.screenshot, r.durationMs, nowVN());
    db.prepare(`UPDATE jobs SET current_step=? WHERE id=?`).run(r.name, job.id);
  });

  try {
    const page = await bm.getPage();
    await ensureLoggedIn(page);

    const tenBenhNhan = 'CB ' + (data.hoTen || '').trim();
    // Điểm xác nhận: chờ bác sĩ bấm Xác nhận/Hủy trên UI
    const onConfirm = async (shot: string) => {
      db.prepare(`UPDATE jobs SET status='waiting_confirm', confirm_shot=?, current_step='Chờ bác sĩ xác nhận trước Lưu cuối' WHERE id=?`).run(shot, job.id);
      return await new Promise<boolean>((resolve) => pendingConfirms.set(job.id, resolve));
    };

    // Chọn orchestrator theo loại luồng
    if (row.workflow_id === 'tiem-chung') {
      // Luồng 1 = code luồng khám bé (chayLuong7): mở hồ sơ con + tiêm chủng + kết thúc khám. Tự chạy hết.
      const vaccines: VaccineL7[] = (data.vaccines || []).map((v: string) => VACCINE_L7[v]).filter(Boolean);
      await chayLuong7(page, { maBA: data.maBA, ngay: data.ngay, gio: data.gio, vaccines });
    } else if (row.workflow_id === 'kham-so-sinh') {
      // Luồng 2: khám chuyên khoa sơ sinh trên hồ sơ con (tự Lưu, không dừng)
      await chayLuong2(page, { maBA: data.maBA, ngay: data.ngay, loaiKham: data.loaiKham });
    } else if (row.workflow_id === 'kham-phcn') {
      await chayLuongKhamChuyenKhoa(page, { tenBenhNhan, ngay: data.ngay, gio: '08:02:00', huongXuTri: 'Khám phục hồi chức năng', maKhoa: '4074', noiDung: '' }, onConfirm);
    } else if (row.workflow_id === 'don-thuoc-ra-vien') {
      // Luồng 4 tìm theo Mã BA + KHÔNG có điểm xác nhận (note: cứ Lưu hoàn thành)
      await chayLuong4(page, { maBA: data.maBA, ngay: data.ngay, combos: data.combos });
    } else if (row.workflow_id === 'nhap-thuoc') {
      // Luồng 5: tạo tờ điều trị mẹ theo cách thức đẻ, dừng ở điểm xác nhận trước Lưu
      await chayLuong5(page, { maBA: data.maBA, ngay: data.ngay }, onConfirm);
    } else if (row.workflow_id === 'sang-loc-be') {
      // Luồng 6: map loại XN -> mã dịch vụ (Thường quy=XN000530, Mở rộng=XN000536); chọn 1 hoặc cả 2
      const mapXN: Record<string, string> = { 'Thường quy': 'XN000530', 'Mở rộng': 'XN000536' };
      const codes = (data.loaiXN || []).map((x: string) => mapXN[x]).filter(Boolean);
      await chayLuong6(page, { maBA: data.maBA, ngay: data.ngay, codes }, onConfirm);
    } else {
      throw new Error('Workflow chưa hỗ trợ: ' + row.workflow_id);
    }

    const finalRow = db.prepare(`SELECT status FROM jobs WHERE id=?`).get(job.id) as any;
    // Nếu đã bị hủy ở điểm xác nhận thì giữ canceled, ngược lại success
    if (finalRow.status !== 'canceled') {
      db.prepare(`UPDATE jobs SET status='success', finished_at=?, current_step='Hoàn tất' WHERE id=?`).run(nowVN(), job.id);
    }
  } catch (e) {
    db.prepare(`UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=?`).run((e as Error).message, nowVN(), job.id);
  } finally {
    setStepReporter(null);
    pendingConfirms.delete(job.id);
    running = false;
    setTimeout(processQueue, 500); // chạy job kế nếu có
  }
}

// ---------- Express ----------
const app = express();
app.use(express.json());

// Auth PIN qua cookie đơn giản
function getCookie(req: express.Request, name: string): string | null {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.split('=')[1]) : null;
}
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (getCookie(req, 'pin') === config.pin) return next();
  res.status(401).json({ error: 'Chưa đăng nhập' });
}

app.post('/api/auth/login', (req, res) => {
  if (req.body?.pin === config.pin) {
    res.setHeader('Set-Cookie', `pin=${encodeURIComponent(config.pin)}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Sai mã PIN' });
  }
});

app.get('/api/workflows', requireAuth, (_req, res) => res.json(WORKFLOWS));

app.post('/api/jobs', requireAuth, (req, res) => {
  const { workflowId, data } = req.body || {};
  if (!workflowId || !data) return res.status(400).json({ error: 'Thiếu dữ liệu' });
  const info = db.prepare(`INSERT INTO jobs(workflow_id, data_json, patient_name, status, created_at) VALUES(?,?,?, 'queued', ?)`)
    .run(workflowId, JSON.stringify(data), data.hoTen || (data.maBA ? 'Mã BA ' + data.maBA : null), nowVN());
  setTimeout(processQueue, 100);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/jobs', requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT id, workflow_id, patient_name, status, current_step, error, created_at, finished_at FROM jobs ORDER BY id DESC LIMIT 50`).all();
  res.json(rows);
});

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Không thấy job' });
  const logs = db.prepare(`SELECT step, level, screenshot, duration_ms, at FROM job_logs WHERE job_id=? ORDER BY id ASC`).all(req.params.id);
  res.json({ job, logs });
});

app.post('/api/jobs/:id/confirm', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const resolve = pendingConfirms.get(id);
  if (!resolve) return res.status(400).json({ error: 'Job không ở trạng thái chờ xác nhận' });
  db.prepare(`UPDATE jobs SET status='running', current_step='Đang lưu cuối' WHERE id=?`).run(id);
  resolve(true);
  res.json({ ok: true });
});

app.post('/api/jobs/:id/cancel', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const resolve = pendingConfirms.get(id);
  if (resolve) {
    db.prepare(`UPDATE jobs SET status='canceled', finished_at=?, current_step='Đã hủy (không Lưu)' WHERE id=?`).run(nowVN(), id);
    resolve(false);
  } else {
    db.prepare(`UPDATE jobs SET status='canceled', finished_at=? WHERE id=? AND status='queued'`).run(nowVN(), id);
  }
  res.json({ ok: true });
});

app.get('/api/system/status', requireAuth, async (_req, res) => {
  const s = await bm.status();
  const queued = (db.prepare(`SELECT COUNT(*) c FROM jobs WHERE status='queued'`).get() as any).c;
  const cur = db.prepare(`SELECT id, patient_name, current_step FROM jobs WHERE status IN ('running','waiting_confirm') ORDER BY id DESC LIMIT 1`).get();
  res.json({ ...s, queueLength: queued, currentJob: cur || null });
});

app.post('/api/system/open-browser', requireAuth, async (_req, res) => {
  try { const p = await bm.getPage(); await ensureLoggedIn(p); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/system/restart-browser', requireAuth, async (_req, res) => {
  try { await bm.restart(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// Ảnh màn hình (yêu cầu đăng nhập)
app.get('/screenshots/:file', requireAuth, (req, res) => {
  const f = path.join(config.screenshotDir, path.basename(String(req.params.file)));
  if (fs.existsSync(f)) res.sendFile(f);
  else res.status(404).end();
});

// UI tĩnh
app.use(express.static(path.join(ROOT, 'ui')));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`\n🚀 Trợ lý nhập liệu HIS đang chạy: http://localhost:${PORT}`);
  console.log(`   PIN đăng nhập UI: ${config.pin}`);
  // Dọn ảnh cũ lúc khởi động + mỗi 6 giờ (ảnh chứa dữ liệu bệnh nhân)
  donAnhCu();
  setInterval(donAnhCu, 6 * 3600 * 1000);
  // Chạy tiếp job còn trong hàng đợi (nếu có)
  processQueue();
});
