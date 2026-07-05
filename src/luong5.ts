// LUỒNG 5: Nhập thuốc (tạm thời: tạo tờ điều trị trên MẸ theo cách thức đẻ).
// Hướng xử trí / diễn biến / chẩn đoán phụ thuộc "Cách thức đẻ" đọc từ Thông tin con.
import { type Page } from 'playwright';
import { step, chupManHinh } from './helpers.js';
import { config } from './config.js';
import { moBenhNhanTheoMaBA } from './luong4.js';
import { moToDieuTri, luuToDieuTri, setNgayGio, setTextarea, pickAntSelect } from './flow1.js';

// Text diễn biến bệnh theo hướng xử trí (đúng note)
const DIENBIEN_HAU_PHAU = 'Tổng trạng không suy dinh dưỡng. Tiêu được. Tiểu được. Bụng mềm. Vết mổ khô. Tử cung co hồi khá. Sản dịch sậm.';
const DIENBIEN_HAU_SAN = 'Tổng trạng không suy dinh dưỡng. Tiêu được. Tiểu được. Bụng mềm. Tử cung co hồi khá.Sản dịch sậm. Tầng sinh môn mềm. ';

export interface QuyetDinhSanh {
  cachDe: string;       // giá trị đọc được
  isMo: boolean;        // Mổ lấy thai
  huongXuTri: string;   // "Theo dõi hậu phẫu" (mổ) / "Theo dõi hậu sản" (thường)
  dienBien: string;
  chanDoan: string;     // mã chẩn đoán: o82 (mổ) / o81 (hút,kềm) / o80 (thường)
}

// Đọc "Cách thức đẻ" của con (Thông tin con thứ 1) và suy ra hướng xử trí/chẩn đoán.
export async function docCachThucDe(page: Page, maBA: string): Promise<QuyetDinhSanh> {
  await moBenhNhanTheoMaBA(page, maBA);
  const idDetail = page.url().split('/').pop()!.split('?')[0];

  await step(page, 'Vào chi tiết Thông tin con', async () => {
    await page.goto(config.hisUrl.replace(/\/$/, '') + '/quan-ly-noi-tru/chi-tiet-nguoi-benh-noi-tru/thong-tin-con/chi-tiet/' + idDetail, { waitUntil: 'domcontentloaded' });
    // Chờ có nhãn "Cách thức đẻ" (KHÔNG click mở section - dễ đóng lại)
    await page.getByText(/Cách thức đẻ/i).first().waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForTimeout(500);
  }, { retries: 2 });

  let cachDe = '';
  // Ưu tiên đọc ô select đứng sau nhãn
  try {
    cachDe = (await page.getByText(/Cách thức đẻ/i).first()
      .locator('xpath=following::*[contains(@class,"ant-select-selection-item")][1]')
      .textContent({ timeout: 5000 })) || '';
  } catch { /* fallback dưới */ }
  if (!cachDe.trim()) {
    const body = await page.evaluate(() => document.body.innerText);
    const m = /(Mổ lấy thai|Sanh hút|Sanh kềm|Sanh kìm|Sanh thường)/i.exec(body);
    cachDe = m ? m[0] : '';
  }
  cachDe = cachDe.trim();
  if (!cachDe) throw new Error('Không đọc được "Cách thức đẻ" (Thông tin con trống?) - dừng an toàn.');

  const isMo = /Mổ lấy thai/i.test(cachDe);
  const isHut = /hút/i.test(cachDe);
  const isKem = /kềm|kìm/i.test(cachDe);
  const qd: QuyetDinhSanh = {
    cachDe,
    isMo,
    huongXuTri: isMo ? 'Theo dõi hậu phẫu' : 'Theo dõi hậu sản',
    dienBien: isMo ? DIENBIEN_HAU_PHAU : DIENBIEN_HAU_SAN,
    chanDoan: isMo ? 'o82' : (isHut || isKem ? 'o81' : 'o80'),
  };
  console.log(`  → Cách thức đẻ: "${cachDe}" -> Hướng xử trí "${qd.huongXuTri}", chẩn đoán ${qd.chanDoan}`);
  return qd;
}

// Điền form Tờ điều trị của MẸ theo quyết định sanh. ngay="DD/MM/YYYY".
export async function dienFormLuong5(page: Page, ngay: string, qd: QuyetDinhSanh, gio = '08:00:00'): Promise<void> {
  const ngayGio = `${ngay} ${gio}`;
  // Ngày y lệnh = Ngày khám = Thời gian đi buồng (user nhập)
  await step(page, `Ngày y lệnh = ${ngayGio}`, async () => { await setNgayGio(page, 'Ngày y lệnh', ngayGio); });
  await step(page, `Ngày khám = ${ngayGio}`, async () => { await setNgayGio(page, 'Ngày khám', ngayGio); });

  // Verify Chẩn đoán bệnh khớp mã (o80/o81/o82) - form thường tự điền theo cách đẻ
  await step(page, `Kiểm tra Chẩn đoán bệnh (mong đợi ${qd.chanDoan.toUpperCase()})`, async () => {
    const body = await page.evaluate(() => document.body.innerText);
    const re = new RegExp('\\b' + qd.chanDoan + '\\b', 'i');
    if (!re.test(body)) {
      console.warn(`  ⚠️  Chẩn đoán trên form KHÔNG chứa ${qd.chanDoan.toUpperCase()} - bác sĩ kiểm tra lại khi xác nhận.`);
    }
  });

  await step(page, 'Diễn biến bệnh (theo hướng xử trí)', async () => {
    await setTextarea(page, 'Diễn biến bệnh', qd.dienBien);
  });
  await step(page, `Hướng xử trí = "${qd.huongXuTri}"`, async () => {
    await setTextarea(page, 'Hướng xử trí', qd.huongXuTri);
  });
  await step(page, 'Chế độ chăm sóc = "Chế độ CS Cấp III"', async () => {
    await pickAntSelect(page, 'Chế độ chăm sóc', 'Chế độ CS Cấp III');
  });
  await step(page, `Thời gian đi buồng = ${ngay}`, async () => {
    await setNgayGio(page, 'Thời gian đi buồng', ngayGio);
  });
}

// ---- ORCHESTRATOR luồng 5 (tạm thời tới bước tạo tờ điều trị, dừng trước Lưu) ----
export interface Flow5Data { maBA: string; ngay: string; }

export async function chayLuong5(
  page: Page,
  data: Flow5Data,
  onConfirm: (screenshot: string) => Promise<boolean>
): Promise<void> {
  // 1) Đọc cách thức đẻ (mở mẹ + Thông tin con) -> quyết định hướng xử trí/chẩn đoán
  const qd = await docCachThucDe(page, data.maBA);

  // 2) Quay lại hồ sơ MẸ, mở tab Tờ điều trị
  const idDetail = page.url().split('/').pop()!.split('?')[0];
  await step(page, 'Về hồ sơ mẹ (tab Tờ điều trị)', async () => {
    await page.goto(config.hisUrl.replace(/\/$/, '') + '/quan-ly-noi-tru/chi-tiet-nguoi-benh-noi-tru/' + idDetail + '?tab=2', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }, { retries: 2 });

  await moToDieuTri(page);
  await dienFormLuong5(page, data.ngay, qd);

  // 3) Điểm xác nhận trước Lưu (tạm dừng - user sẽ bổ sung logic thuốc sau)
  const shot = await chupManHinh(page, 'l5-xac-nhan-truoc-luu');
  const choPhep = await onConfirm(shot);
  if (choPhep) await luuToDieuTri(page);
}
