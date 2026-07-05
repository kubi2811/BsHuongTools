// DEMO luồng 1 (chích vaccine) - GIAI ĐOẠN A: kiểm tra khả thi
// Mục tiêu: mở Edge headed -> đăng nhập HIS -> tìm bệnh nhân theo tên -> dừng cho xem.
// Điều hướng bằng URL (chắc chắn), chưa đụng vào các selector chưa xác minh.
import path from 'node:path';
import { openBrowser } from './browser.js';
import { ensureLoggedIn } from './login.js';
import { config } from './config.js';

// Tên bệnh nhân: lấy từ tham số dòng lệnh, mặc định là ca test trong ảnh
// Rule tìm kiếm: "CB + tên bệnh nhân" (CB = con bà -> tìm con đi chích)
const tenBenhNhan = process.argv.slice(2).join(' ').trim() || 'CB nguyễn văn a';

async function main() {
  console.log('=== DEMO LUỒNG 1: CHÍCH VACCINE (giai đoạn A - kiểm tra khả thi) ===\n');
  const { context, page } = await openBrowser();

  try {
    // B1: Đăng nhập (tự động hoặc tay)
    console.log('Bước 1: Kiểm tra/đăng nhập HIS...');
    await ensureLoggedIn(page);

    // B2: Vào Danh sách người bệnh nội trú + tìm theo tên (qua URL, chắc chắn)
    console.log(`Bước 2: Tìm bệnh nhân "${tenBenhNhan}" trong Danh sách nội trú...`);
    const url =
      config.hisUrl.replace(/\/$/, '') +
      '/quan-ly-noi-tru/danh-sach-nguoi-benh-noi-tru?tenNb=' +
      encodeURIComponent(tenBenhNhan);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Chụp màn hình để đối chiếu
    const shot = path.join(config.screenshotDir, `demo-timBN-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log('📸 Đã chụp:', shot);

    console.log('\n✅ Tới đây đã chứng minh: điều khiển Edge + đăng nhập + tìm bệnh nhân đều CHẠY ĐƯỢC.');
    console.log('👉 Cửa sổ Edge đang mở. Xem kết quả tìm kiếm trên màn hình.');
    console.log('   Bấm ▶ (Resume) trong Playwright Inspector để tiếp tục ghi các bước sau.\n');

    // Dừng lại để bác sĩ xem + để ghi selector các bước tiếp theo
    await page.pause();
  } catch (err) {
    console.error('❌ Lỗi:', (err as Error).message);
    const shot = path.join(config.screenshotDir, `demo-loi-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    console.error('📸 Ảnh lúc lỗi:', shot);
    await page.pause();
  } finally {
    await context.close();
  }
}

main();
