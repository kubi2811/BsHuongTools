// Đảm bảo đã đăng nhập HIS. Ưu tiên auto-login bằng .env; nếu không dò được
// form thì dừng cho bác sĩ đăng nhập tay (hồ sơ bền vững sẽ nhớ session).
import { type Page } from 'playwright';
import { config } from './config.js';

// Trang đã đăng nhập hay chưa: dấu hiệu là còn thấy ô mật khẩu / URL có 'dang-nhap' / 'login'
async function looksLikeLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes('dang-nhap') || url.includes('login')) return true;
  const pass = page.locator('input[type="password"]');
  return (await pass.count()) > 0 && (await pass.first().isVisible().catch(() => false));
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto(config.hisUrl, { waitUntil: 'domcontentloaded' });
  // Chờ trang ổn định
  await page.waitForTimeout(1500);

  if (!(await looksLikeLoginPage(page))) {
    console.log('✅ Đã đăng nhập sẵn (session còn hiệu lực).');
    return;
  }

  console.log('🔑 Đang ở trang đăng nhập.');

  // Thử auto-login nếu có tài khoản trong .env
  if (config.hisUser && config.hisPass) {
    try {
      // Ô tài khoản: thử nhiều selector phổ biến
      const userInput = page
        .locator(
          'input[name="username"], input[name="userName"], input[name="account"], input[type="text"]:visible, input[type="email"]:visible'
        )
        .first();
      const passInput = page.locator('input[type="password"]:visible').first();

      // XÓA SẠCH tài khoản/mật khẩu do Chrome/Edge tự điền (autofill) trước khi nhập,
      // rồi gõ lại + kiểm tra đúng giá trị (tránh dư ký tự -> đăng nhập sai).
      const nhapChac = async (o: typeof userInput, giaTri: string) => {
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
      const loginBtn = page
        .getByRole('button', { name: /đăng nhập|login|sign in/i })
        .first();
      if (await loginBtn.count()) {
        await loginBtn.click();
      } else {
        await passInput.press('Enter');
      }

      // Chờ rời khỏi trang login
      await page.waitForTimeout(3500);
      if (!(await looksLikeLoginPage(page))) {
        console.log('✅ Auto-login thành công.');
        return;
      }
      console.log('⚠️  Auto-login chưa qua (có thể captcha/OTP). Chuyển sang đăng nhập tay.');
    } catch (e) {
      console.log('⚠️  Không tự điền được form login:', (e as Error).message);
    }
  }

  // Fallback: dừng cho bác sĩ đăng nhập tay trên cửa sổ Edge đang mở
  console.log('\n👉 Vui lòng ĐĂNG NHẬP TAY trên cửa sổ Edge, rồi quay lại đây bấm ▶ (Resume) trong Playwright Inspector.\n');
  await page.pause();
}
