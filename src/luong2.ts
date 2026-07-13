// LUỒNG 2: Khám sơ sinh (khám chuyên khoa trên hồ sơ CON). Tự Lưu, KHÔNG dừng xác nhận.
// Mở hồ sơ con (như L7) -> tờ điều trị (Z38.0, hướng xử trí "Khám bé", giờ 08:30) -> Lưu
// -> F2 chỉ định dịch vụ khám (theo loại khám) -> Đồng ý -> đóng cảnh báo
// -> Khám chuyên khoa (mời khoa 3050 sơ sinh + nội dung theo loại khám) -> Xác nhận -> Lưu.
import { type Page } from 'playwright';
import { step, checkpoint, nhapSach, xacNhanPopupNeuCo, dongCanhBaoNeuCo, bamLuu } from './helpers.js';
import { moToDieuTri, setTextarea, pickAntSelect, luuToDieuTri, moKhamChuyenKhoa } from './flow1.js';
import { timVaMoConTheoMaBA, setNgayGioLich, datChanDoanZ380 } from './luong6.js';

// Loại khám -> mã dịch vụ (bước F2) + nội dung yêu cầu (bước Khám chuyên khoa)
const LOAI_KHAM: Record<string, { code: string; noiDung: string }> = {
  'Khám tim':       { code: 'KB0302',   noiDung: 'khám SLSS và tầm soát bệnh tim bẩm sinh' },
  'Khám trẻ DV':    { code: 'KB0090',   noiDung: 'khám trẻ dịch vụ theo yêu cầu' },
  'Khám chiếu đèn': { code: 'PTTT1314', noiDung: 'khám và chiếu đèn trẻ SS' },
};

const GIO_L2 = '08:30:00'; // giờ y lệnh luồng 2 (khám sơ sinh)
const GIO_L3 = '09:00:00'; // giờ y lệnh luồng 3 (PHCN) - đổi từ 08:15 để tránh trùng giờ

// Điền form tờ điều trị con (dùng chung L2 & L3, khác nhau giờ + hướng xử trí).
async function dienFormKham(page: Page, ngay: string, gio: string, huongXuTri: string): Promise<void> {
  await step(page, `Ngày y lệnh = ${ngay} ${gio}`, async () => {
    await setNgayGioLich(page, 'Ngày y lệnh', ngay, gio);
  });
  await datChanDoanZ380(page); // xóa hết chẩn đoán cũ + đặt Z38.0 + verify
  await step(page, 'Diễn biến bệnh = "Bé hồng, khóc tốt"', async () => {
    await setTextarea(page, 'Diễn biến bệnh', 'Bé hồng, khóc tốt');
  });
  await step(page, `Hướng xử trí = "${huongXuTri}"`, async () => {
    await setTextarea(page, 'Hướng xử trí', huongXuTri);
  });
  await step(page, 'Chế độ chăm sóc = "Chế độ CS Cấp III"', async () => {
    await pickAntSelect(page, 'Chế độ chăm sóc', 'Chế độ CS Cấp III');
  });
}

// Thứ 7 không? (getDay: 0=CN..6=T7)
function laThu7(ngay: string): boolean {
  const [d, m, y] = ngay.split('/').map((s) => Number(s.trim()));
  return new Date(y, m - 1, d).getDay() === 6;
}

// F2 -> tick mã dịch vụ khám -> Đồng ý -> đóng cảnh báo (KHÔNG Lưu ở bước này)
async function chiDinhDichVuKham(page: Page, code: string): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: /Chỉ định dịch vụ kỹ thuật/i });
  await step(page, `Mở hộp thoại chỉ định DVKT (F2), tick ${code}`, async () => {
    await xacNhanPopupNeuCo(page, 800);
    const f2 = page.getByPlaceholder(/F2/i).first();
    await f2.scrollIntoViewIfNeeded();
    await f2.click();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const s = dialog.getByPlaceholder(/Chọn dịch vụ/i).first();
    await nhapSach(page, s, code);
    await page.waitForTimeout(1800);
    const row = dialog.locator('.ant-row, tr, [class*="item"]').filter({ hasText: new RegExp(code, 'i') }).first();
    const box = row.locator('.ant-checkbox').first();
    if (await box.count()) await box.click();
    else await row.getByText(new RegExp(code, 'i')).first().click();
    await page.waitForTimeout(900);
    await xacNhanPopupNeuCo(page, 1000); // nếu có thông báo -> Xác nhận
  }, { retries: 2 });

  await step(page, 'Bấm Đồng ý (dịch vụ khám)', async () => {
    await dialog.getByRole('button', { name: /Đồng ý/i }).first().click();
    await page.waitForTimeout(2000);
    await xacNhanPopupNeuCo(page, 800);
    await dongCanhBaoNeuCo(page); // nếu có cảnh báo -> Đóng
  });
}

export interface Flow2Data {
  maBA: string;
  ngay: string;     // DD/MM/YYYY (giờ mặc định 08:30:00)
  loaiKham: string; // 'Khám tim' | 'Khám trẻ DV' | 'Khám chiếu đèn'
}

// Tự chạy hết, KHÔNG có điểm xác nhận.
export async function chayLuong2(page: Page, data: Flow2Data): Promise<void> {
  const lk = LOAI_KHAM[data.loaiKham];
  if (!lk) throw new Error('Loại khám không hợp lệ: ' + data.loaiKham);

  // 1-5) Mở hồ sơ CON + tờ điều trị
  await timVaMoConTheoMaBA(page, data.maBA);
  await moToDieuTri(page);

  // 6-11) Điền form (Z38.0, hướng xử trí "Khám bé", ...) -> Lưu
  await dienFormKham(page, data.ngay, GIO_L2, 'Khám bé');
  await luuToDieuTri(page);
  await kiemTraDaLuu(page);

  // 12-15) F2 chỉ định dịch vụ khám theo loại
  await chiDinhDichVuKham(page, lk.code);

  // 16-19) Khám chuyên khoa: SỬA NGÀY = ngày user, mời khoa 3050, nội dung theo loại -> Xác nhận
  await moKhamChuyenKhoa(page, '3050', lk.noiDung, data.ngay);

  // 20) Lưu cuối
  await luuCuoiKhamChuyenKhoa(page);
}

async function kiemTraDaLuu(page: Page): Promise<void> {
  await step(page, 'Kiểm tra tờ điều trị đã lưu', async () => {
    const ok = await page.getByPlaceholder(/F2/i).first()
      .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!ok) throw new Error('Tờ điều trị CHƯA lưu được (ngày y lệnh quá sớm/trùng?). Dừng an toàn.');
  });
}

async function luuCuoiKhamChuyenKhoa(page: Page): Promise<void> {
  await checkpoint(page, 'Trước khi Lưu cuối (khám chuyên khoa)');
  if (process.env.L23_STOP_BEFORE_LUU === '1') {
    throw new Error('DEBUG: dừng trước Lưu cuối (L23_STOP_BEFORE_LUU=1). Chưa Lưu cuối.');
  }
  await step(page, 'Bấm Lưu CUỐI (khám chuyên khoa)', async () => {
    await bamLuu(page); // đợi hết overlay/dialog rồi mới bấm Lưu, retry nếu bị che
    await xacNhanPopupNeuCo(page, 800);
    await dongCanhBaoNeuCo(page);
  });
}

// ---- LUỒNG 3: KHÁM PHỤC HỒI CHỨC NĂNG (PHCN) trên hồ sơ CON ----
export interface Flow3Data {
  maBA: string;
  ngay: string; // DD/MM/YYYY (giờ auto 08:15:00)
}

// Tự chạy hết, KHÔNG có điểm xác nhận. Mã dịch vụ: KB0094 (ngày thường) / KB0096 (thứ 7).
export async function chayLuong3(page: Page, data: Flow3Data): Promise<void> {
  const code = laThu7(data.ngay) ? 'KB0096' : 'KB0094';

  await timVaMoConTheoMaBA(page, data.maBA);
  await moToDieuTri(page);
  await dienFormKham(page, data.ngay, GIO_L3, 'Khám PHCN');
  await luuToDieuTri(page);
  await kiemTraDaLuu(page);

  await chiDinhDichVuKham(page, code);
  // Khám chuyên khoa: sửa NGÀY = ngày user, mời khoa 4074 (PHCN), nội dung để trống -> Xác nhận
  await moKhamChuyenKhoa(page, '4074', '', data.ngay);

  await luuCuoiKhamChuyenKhoa(page);
}
