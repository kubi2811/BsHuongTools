// Tiện ích dùng chung cho các luồng: chụp màn hình theo bước, dò DOM.
import fs from 'node:fs';
import path from 'node:path';
import { type Page, type Locator } from 'playwright';
import { config } from './config.js';

// Nhập text SẠCH: xóa hết giá trị cũ (chống dính cache từ luồng trước) rồi gõ + KIỂM TRA đúng.
export async function nhapSach(page: Page, o: Locator, value: string): Promise<void> {
  for (let lan = 0; lan < 3; lan++) {
    await o.click();
    await o.press('Control+a');
    await o.press('Delete');
    await page.waitForTimeout(150);
    if (value) await o.pressSequentially(value, { delay: 35 });
    await page.waitForTimeout(200);
    if ((await o.inputValue().catch(() => '')) === value) return;
  }
  console.warn(`  ⚠️  Ô không giữ đúng giá trị "${value}" sau 3 lần thử (SPA đè cache?).`);
}

// Nếu HIS hiện popup xác nhận (vd "Đã có tờ điều trị ngày ... Xác nhận tạo trùng tờ điều trị")
// thì bấm "Xác nhận" để tiếp tục (theo yêu cầu bác sĩ). Chỉ bấm khi popup có nút "Xác nhận"
// -> KHÔNG đụng nhầm popup cảnh báo chỉ có nút Đóng/Bỏ qua. Trả về true nếu đã bấm.
export async function xacNhanPopupNeuCo(page: Page, timeoutMs = 2500): Promise<boolean> {
  const dlg = page.getByRole('dialog')
    .filter({ hasText: /Xác nhận|Cảnh báo|tạo trùng|Đã có tờ điều trị/i }).first();
  if (!(await dlg.isVisible().catch(() => false))) {
    await dlg.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
  }
  if (!(await dlg.isVisible().catch(() => false))) return false;
  const btn = dlg.getByRole('button', { name: /^\s*Xác nhận\s*$/i }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(1200);
    console.log('  ✓ Đã bấm "Xác nhận" trên popup (tạo trùng/cảnh báo).');
    return true;
  }
  return false;
}

// Đóng popup cảnh báo chỉ có nút Đóng/Bỏ qua (vd "Người bệnh cần tạm ứng...") để không chặn nút Lưu.
export async function dongCanhBaoNeuCo(page: Page): Promise<boolean> {
  const warn = page.getByRole('dialog').filter({ hasText: /tạm ứng|Cảnh báo|Thông báo/i }).first();
  if (!(await warn.isVisible().catch(() => false))) return false;
  const btn = warn.getByRole('button', { name: /^\s*(Đóng|Bỏ qua|OK)\s*$/i }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

// Bấm 1 nút trong dialog rồi ĐỢI dialog đóng hẳn; retry nếu chưa đóng (vd "Xác nhận" khám chuyên khoa
// đôi lúc bấm hụt -> dialog còn mở che nút Lưu -> lỗi "subtree intercepts pointer events").
export async function bamRoiChoDongDialog(page: Page, dialog: Locator, tenNut: RegExp, lanThu = 3): Promise<void> {
  for (let i = 0; i < lanThu; i++) {
    await dialog.getByRole('button', { name: tenNut }).first().click().catch(() => {});
    await page.waitForTimeout(1300);
    if (!(await dialog.isVisible().catch(() => false))) return;
  }
  throw new Error('Dialog không đóng sau khi bấm nút (còn che màn hình).');
}

// Bấm nút "Lưu" (góc phải) CHẮC CHẮN: đợi spinner "Vui lòng chờ"/ant-spin tắt + không còn dialog che,
// rồi mới bấm; retry nếu bị chặn; cuối cùng force click.
export async function bamLuu(page: Page): Promise<void> {
  const luu = page.getByRole('button', { name: /^\s*Lưu\s*$/i }).last();
  for (let i = 0; i < 4; i++) {
    await page.locator('.ant-spin-spinning').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.getByText(/Vui lòng chờ/i).first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    try {
      await luu.click({ timeout: 6000 });
      await page.waitForTimeout(1500);
      return;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  await luu.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
}

// Hook báo tiến độ để server ghi log + hiển thị lên UI (đặt bởi executor)
export type StepReport = { name: string; screenshot: string; level: 'info' | 'error'; durationMs: number; error?: string };
let reporter: ((r: StepReport) => void) | null = null;
export function setStepReporter(fn: ((r: StepReport) => void) | null): void {
  reporter = fn;
}

export interface StepOpts {
  capture?: boolean;  // chụp ảnh khi thành công (mặc định false - tối ưu tốc độ)
  retries?: number;   // số lần thử lại nếu lỗi (mạng yếu chưa load kịp). Mặc định 0.
}

// Ghi log 1 bước. Nếu lỗi và còn retries -> đợi rồi thử lại (cho mạng bệnh viện chậm).
// KHÔNG đặt retries cho bước có tác dụng ghi (Lưu/Đồng ý) để tránh submit 2 lần.
export async function step(page: Page, name: string, fn: () => Promise<void>, opts: StepOpts = {}): Promise<void> {
  const retries = opts.retries ?? 0;
  const t0 = Date.now();
  console.log(`▶ ${name}...`);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fn();
      let shotName = '';
      if (opts.capture) {
        const shot = path.join(config.screenshotDir, `${Date.now()}-${slug(name)}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        shotName = path.basename(shot);
      }
      const dur = Date.now() - t0;
      console.log(`  ✓ ${name} (${dur}ms)${shotName ? '  📸' : ''}${attempt ? ` [thử lại ${attempt}]` : ''}`);
      reporter?.({ name, screenshot: shotName, level: 'info', durationMs: dur });
      return;
    } catch (e) {
      if (attempt < retries) {
        console.warn(`  ↻ ${name} lỗi, đợi web load rồi thử lại (${attempt + 1}/${retries})...`);
        await page.waitForTimeout(3000); // đợi mạng/web load ra
        continue;
      }
      const shot = path.join(config.screenshotDir, `LOI-${Date.now()}-${slug(name)}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      const html = path.join(config.screenshotDir, `LOI-${Date.now()}-${slug(name)}.html`);
      await fs.promises.writeFile(html, await page.content().catch(() => '')).catch(() => {});
      console.error(`  ✗ ${name}: ${(e as Error).message}  📸 ${path.basename(shot)}`);
      reporter?.({ name, screenshot: path.basename(shot), level: 'error', durationMs: Date.now() - t0, error: (e as Error).message });
      throw e;
    }
  }
}

// Checkpoint: chụp 1 ảnh + đưa vào timeline UI (dùng trước mỗi lần Lưu để bác sĩ kiểm).
export async function checkpoint(page: Page, label: string): Promise<void> {
  const shot = await chupManHinh(page, label);
  console.log(`  📸 ${label}`);
  reporter?.({ name: '📸 ' + label, screenshot: shot, level: 'info', durationMs: 0 });
}

// Chụp màn hình đơn lẻ (dùng cho điểm xác nhận), trả về tên file
export async function chupManHinh(page: Page, label: string): Promise<string> {
  const shot = path.join(config.screenshotDir, `${Date.now()}-${slug(label)}.png`);
  await page.screenshot({ path: shot }).catch(() => {});
  return path.basename(shot);
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 40);
}

// Đoạn JS dò DOM (chuỗi để tránh esbuild chèn __name). Trả về các phần tử hiển thị.
export const DUMP_JS = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nearLabel = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + el.id + '"]');
      if (l && l.textContent.trim()) return l.textContent.trim().slice(0, 40);
    }
    const box = el.closest('.ant-form-item,.form-group,.row,.col,tr,div');
    if (box) {
      const l = box.querySelector('label');
      if (l && l.textContent.trim()) return l.textContent.trim().slice(0, 40);
    }
    return null;
  };
  const pick = (el) => ({
    tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), id: el.id || null,
    name: el.getAttribute('name'), placeholder: el.getAttribute('placeholder'),
    aria: el.getAttribute('aria-label'), role: el.getAttribute('role'),
    near: nearLabel(el),
    text: (el.textContent || '').trim().slice(0, 60) || null,
  });
  const inputs = Array.from(document.querySelectorAll('input,textarea')).filter(vis).map(pick);
  const buttons = Array.from(document.querySelectorAll('button,[role="button"],a[role="tab"]')).filter(vis).map(pick);
  const combos = Array.from(document.querySelectorAll('select,[role="combobox"]')).filter(vis).map(pick);
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"],.ant-modal')).filter(vis).map((d) => {
    const t = d.querySelector('[class*="title"],.ant-modal-title,h1,h2,h3');
    return { title: (t ? t.textContent : '').trim().slice(0, 80) };
  });
  return { url: location.href, dialogs, inputs, buttons, combos };
})()`;

// Dò DOM trang hiện tại, lưu ra file JSON + in console
export async function dump(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(1500);
  const info = await page.evaluate(DUMP_JS);
  const out = path.join(config.screenshotDir, `dump-${slug(label)}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(info, null, 2), 'utf8');
  console.log(`\n=== DÒ DOM [${label}] ===`);
  console.log(JSON.stringify(info, null, 2));
  console.log(`💾 ${out}\n`);
}
