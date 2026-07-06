// Đảm bảo đã đăng nhập HIS. Ưu tiên auto-login bằng .env; nếu không dò được
// form thì dừng cho bác sĩ đăng nhập tay (hồ sơ bền vững sẽ nhớ session).
import { type Page, type Locator } from 'playwright';
import { config } from './config.js';

// Trang đã đăng nhập hay chưa: dấu hiệu là còn thấy ô mật khẩu / URL có 'dang-nhap' / 'login'
export async function looksLikeLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes('dang-nhap') || url.includes('login')) return true;
  const pass = page.locator('input[type="password"]');
  return (await pass.count()) > 0 && (await pass.first().isVisible().catch(() => false));
}

// Đóng popup "Thông báo / cập nhật tính năng" (announcement HIS bật sau login) - best effort.
export async function dongThongBao(page: Page): Promise<void> {
  const dlg = page.getByRole('dialog')
    .filter({ hasText: /Thông báo|BIG UPDATE|cập nhật tính năng|quy định mới/i }).first();
  if (!(await dlg.isVisible().catch(() => false))) return;
  const btn = dlg.getByRole('button', { name: /Đóng|Đã hiểu|Tôi đã hiểu|Bỏ qua|Không hiển thị|^OK$/i }).first();
  if (await btn.count()) await btn.click().catch(() => {});
  else {
    const x = dlg.locator('.ant-modal-close, [aria-label="Close"], .anticon-close').first();
    if (await x.count()) await x.click().catch(() => {});
  }
  await page.waitForTimeout(600);
}

// Điền form login (giả định ĐANG ở trang login). Trả về true nếu qua được trang login.
// XÓA SẠCH tài khoản/mật khẩu do Chrome/Edge tự điền (autofill) trước khi nhập,
// rồi gõ lại + kiểm tra đúng giá trị (tránh dư ký tự -> đăng nhập sai).
async function autoLogin(page: Page): Promise<boolean> {
  if (!(config.hisUser && config.hisPass)) return false;
  try {
    const userInput = page
      .locator('input[name="username"], input[name="userName"], input[name="account"], input[type="text"]:visible, input[type="email"]:visible')
      .first();
    const passInput = page.locator('input[type="password"]:visible').first();

    const nhapChac = async (o: Locator, giaTri: string) => {
      for (let i = 0; i < 3; i++) {
        await o.click();
        await o.press('Control+a');
        await o.press('Delete');
        await page.waitForTimeout(150);
        await o.pressSequentially(giaTri, { delay: 30 });
        await page.waitForTimeout(200);
        if ((await o.inputValue().catch(() => '')) === giaTri) return;
      }
    };
    await nhapChac(userInput, config.hisUser);
    await nhapChac(passInput, config.hisPass);

    // Nút đăng nhập: thử theo role/text, fallback Enter
    const loginBtn = page.getByRole('button', { name: /đăng nhập|login|sign in/i }).first();
    if (await loginBtn.count()) await loginBtn.click();
    else await passInput.press('Enter');

    await page.waitForTimeout(3500);
    return !(await looksLikeLoginPage(page));
  } catch (e) {
    console.log('⚠️  Không tự điền được form login:', (e as Error).message);
    return false;
  }
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto(config.hisUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await dongThongBao(page);

  if (!(await looksLikeLoginPage(page))) {
    console.log('✅ Đã đăng nhập sẵn (session còn hiệu lực).');
    return;
  }

  console.log('🔑 Đang ở trang đăng nhập.');
  if (await autoLogin(page)) {
    console.log('✅ Auto-login thành công.');
    await dongThongBao(page);
    return;
  }
  console.log('⚠️  Auto-login chưa qua (có thể captcha/OTP). Chuyển sang đăng nhập tay.');

  // Fallback: dừng cho bác sĩ đăng nhập tay trên cửa sổ Edge đang mở
  console.log('\n👉 Vui lòng ĐĂNG NHẬP TAY trên cửa sổ Edge, rồi quay lại đây bấm ▶ (Resume) trong Playwright Inspector.\n');
  await page.pause();
}

// Nếu bị đá về trang login giữa chừng (session hết hạn) -> tự đăng nhập lại.
// Trả về true nếu VỪA đăng nhập lại (để caller vào lại đúng trang cần). Ném lỗi nếu login lại thất bại.
export async function dangNhapLaiNeuCan(page: Page): Promise<boolean> {
  await dongThongBao(page);
  if (!(await looksLikeLoginPage(page))) return false;
  console.warn('  ⚠️  Session hết hạn (bị đá về trang đăng nhập) -> đang đăng nhập lại...');
  if (!(await autoLogin(page))) {
    throw new Error('Session hết hạn và KHÔNG tự đăng nhập lại được (captcha/OTP?). Dừng an toàn.');
  }
  await dongThongBao(page);
  console.log('  ✅ Đã đăng nhập lại, tiếp tục.');
  return true;
}
