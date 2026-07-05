// Đọc cấu hình từ file .env (chỉ ở local)
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Thư mục gốc dự án (src/.. )
export const ROOT = path.resolve(__dirname, '..');

export const config = {
  hisUrl: process.env.HIS_URL ?? 'https://bvtudu.tudu.com.vn/',
  hisUser: process.env.HIS_USER ?? '',
  hisPass: process.env.HIS_PASS ?? '',
  khoa: process.env.KHOA ?? 'Khoa Sản N2',
  pin: process.env.PIN ?? '1234',
  confirmBeforeSave: process.env.CONFIRM_BEFORE_SAVE !== '0',
  // Số ngày giữ ảnh chụp (ảnh chứa dữ liệu bệnh nhân) trước khi tự xóa
  screenshotRetentionDays: Number(process.env.SCREENSHOT_RETENTION_DAYS ?? '7'),
  // Hồ sơ Edge bền vững - giữ session đăng nhập HIS
  profileDir: path.join(ROOT, 'data', 'browser-profile'),
  screenshotDir: path.join(ROOT, 'data', 'screenshots'),
};
