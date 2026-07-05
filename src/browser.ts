// Quản lý mở Edge (headed) với hồ sơ bền vững để giữ đăng nhập HIS
import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from './config.js';

export async function openBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  // Tạo sẵn thư mục dữ liệu
  fs.mkdirSync(config.profileDir, { recursive: true });
  fs.mkdirSync(config.screenshotDir, { recursive: true });

  // Mở Edge có sẵn trên Win 11 (channel msedge), headed để nhìn thấy bot làm gì
  const context = await chromium.launchPersistentContext(config.profileDir, {
    channel: 'msedge',
    headless: false,
    viewport: null, // dùng full cửa sổ
    args: ['--start-maximized'],
  });

  // Đặt timeout mặc định 15s cho mỗi action (theo PLAN mục 7)
  context.setDefaultTimeout(15_000);

  // Dùng tab đầu tiên có sẵn, hoặc mở mới
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}
