// Runner luồng 1 - chạy headed. Điền form Tờ điều trị rồi dừng ở điểm xác nhận.
// Chỉ bấm Lưu khi đặt AUTO_SAVE=1 (an toàn y lệnh - PLAN mục 2).
import { openBrowser } from './browser.js';
import { ensureLoggedIn } from './login.js';
import {
  chonKhoaLamViec,
  moDanhSachNoiTru,
  timVaMoBenhNhan,
  moToDieuTri,
  dienFormToDieuTri,
  confirmDiemLuu,
  luuToDieuTri,
} from './flow1.js';

const tenBenhNhan = process.argv.slice(2).join(' ').trim() || 'CB nguyễn văn a';
// Ngày y lệnh: env NGAY hoặc mặc định hôm nay (DD/MM/YYYY)
const ngay = process.env.NGAY || new Date().toLocaleDateString('en-GB'); // en-GB = DD/MM/YYYY

async function main() {
  console.log('=== LUỒNG 1: CHÍCH VACCINE ===');
  console.log(`Bệnh nhân: ${tenBenhNhan} | Ngày y lệnh: ${ngay}\n`);
  const { context, page } = await openBrowser();
  try {
    await ensureLoggedIn(page);
    await moDanhSachNoiTru(page);
    await chonKhoaLamViec(page);
    await timVaMoBenhNhan(page, tenBenhNhan);
    await moToDieuTri(page);
    await dienFormToDieuTri(page, ngay);

    // Điểm xác nhận trước khi Lưu
    if (await confirmDiemLuu(page, 'To-dieu-tri')) {
      await luuToDieuTri(page);
      console.log('✅ Đã Lưu Tờ điều trị.');
    }
  } catch (err) {
    console.error('❌ Dừng an toàn:', (err as Error).message);
  } finally {
    await context.close();
  }
}

main();
