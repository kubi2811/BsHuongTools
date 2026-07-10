// HELPER DÙNG CHUNG + LUỒNG 2/3 (khám chuyên khoa). Luồng 1 (chích vaccine) đã gộp vào
// luồng "khám bé" (src/luong7.ts). File này giữ các tiện ích chung: điều hướng an toàn,
// điền form tờ điều trị, tìm bệnh nhân, reset bộ lọc, khám chuyên khoa...
import { type Page } from 'playwright';
import { config } from './config.js';
import { step, chupManHinh, checkpoint, nhapSach, xacNhanPopupNeuCo, dongCanhBaoNeuCo } from './helpers.js';
import { dangNhapLaiNeuCan, dongThongBao } from './login.js';

// Điều hướng tới 1 trang HIS an toàn: nếu session hết hạn (bị đá về login) -> tự đăng
// nhập lại rồi vào lại đúng trang. Đóng luôn popup "Thông báo" nếu HIS bật lên.
// Dùng thay cho page.goto ở mọi chỗ điều hướng để "cover" bug lâu lâu bị logout.
export async function moTrangHIS(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (await dangNhapLaiNeuCan(page)) {
    // Vừa đăng nhập lại -> vào lại đúng trang cần
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }
  await dongThongBao(page);
}

// ---- Tiện ích điền theo NHÃN (locator tương đối, không phụ thuộc id GUID) ----

// Ô ngày giờ (antd): ô input[placeholder="Chọn thời gian"] đứng sau nhãn
export async function setNgayGio(page: Page, nhan: string, giaTri: string): Promise<void> {
  const input = page
    .getByText(nhan, { exact: false })
    .first()
    .locator('xpath=following::input[@placeholder="Chọn thời gian"][1]');
  await input.click();
  await input.fill(giaTri); // fill tự xóa giá trị cũ rồi gõ mới
  await input.press('Enter');
  await page.keyboard.press('Escape'); // đóng lịch nếu còn mở
  await page.waitForTimeout(400);
}

// Textarea tự do đứng sau nhãn
export async function setTextarea(page: Page, nhan: string, giaTri: string): Promise<void> {
  const ta = page.getByText(nhan, { exact: false }).first().locator('xpath=following::textarea[1]');
  await ta.click();
  await ta.fill(giaTri);
  await page.waitForTimeout(300);
}

// Ô ant-select đứng sau nhãn: mở dropdown, chọn option theo text
export async function pickAntSelect(page: Page, nhan: string, optionText: string): Promise<void> {
  const sel = page
    .getByText(nhan, { exact: false })
    .first()
    .locator('xpath=following::*[contains(@class,"ant-select")][1]');
  await sel.scrollIntoViewIfNeeded();
  await sel.click();
  await page.waitForTimeout(500);
  await page.locator('.ant-select-item-option', { hasText: optionText }).first().click();
  await page.waitForTimeout(400);
}

// Xử lý popup "Chọn khoa làm việc" xuất hiện sau đăng nhập (nếu có)
export async function chonKhoaLamViec(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Chọn khoa làm việc' });
  if (!(await dialog.isVisible().catch(() => false))) return;

  await step(page, 'Chọn khoa làm việc', async () => {
    // Combobox trong popup (ant-select). Bấm mở, gõ tên khoa, chọn option.
    const combo = dialog.locator('.ant-select, [role="combobox"]').first();
    await combo.click();
    await page.keyboard.type(config.khoa, { delay: 40 });
    await page.waitForTimeout(800);
    // Option khớp tên khoa trong dropdown đang mở
    await page.locator('.ant-select-item-option', { hasText: config.khoa }).first().click();
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await page.waitForTimeout(1500);
  });
}

// Mở trang Danh sách người bệnh nội trú
export async function moDanhSachNoiTru(page: Page): Promise<void> {
  await step(page, 'Mở Danh sách người bệnh nội trú', async () => {
    const url = config.hisUrl.replace(/\/$/, '') + '/quan-ly-noi-tru/danh-sach-nguoi-benh-noi-tru';
    await moTrangHIS(page, url); // tự đăng nhập lại nếu session hết hạn
  });
}

// Reset TOÀN BỘ bộ lọc ở Danh sách người bệnh nội trú trước khi tìm mới.
// QUAN TRỌNG: các luồng dùng ô lọc KHÁC nhau (luồng 1 tìm theo TÊN, luồng 4/5 theo MÃ BA).
// Nếu luồng trước để lại giá trị ở ô Mã bệnh án thì lần sau tìm theo tên sẽ bị lọc chồng
// (vừa tên vừa mã) -> ra RỖNG. Nên phải bấm "Hủy tìm kiếm" + xóa sạch cả ô tên lẫn ô Mã BA.
export async function resetBoLocTimKiem(page: Page): Promise<void> {
  const huy = page.getByRole('button', { name: /Hủy tìm kiếm/i }).first();
  if (await huy.isVisible().catch(() => false)) {
    await huy.click();
    await page.waitForTimeout(1000);
  }
  // Xóa sạch mọi ô lọc còn dính giá trị từ luồng trước (tên NB + Mã bệnh án / Mã NB)
  for (const re of [/Tìm.*tên NB/i, /^Mã bệnh án$/i, /^Mã NB$/i]) {
    const o = page.getByPlaceholder(re).first();
    if (await o.count()) {
      const v = (await o.inputValue().catch(() => '')) || '';
      if (v.trim()) await nhapSach(page, o, '');
    }
  }
  await page.waitForTimeout(400);
}

// Tìm bệnh nhân theo tên (rule: "CB + tên") rồi mở hồ sơ đứa con.
// Chống dính cache: reset bộ lọc, xóa sạch ô tìm, CHỜ ĐÚNG TÊN vừa nhập hiện ra rồi mới click.
export async function timVaMoBenhNhan(page: Page, tenBenhNhan: string): Promise<void> {
  // Regex khớp đúng tên vừa tìm (vd "CB <tên bệnh nhân>") - dùng để chờ & click đúng dòng
  const bnRe = new RegExp(tenBenhNhan.trim().replace(/\s+/g, '\\s+'), 'i');

  await step(page, `Tìm bệnh nhân "${tenBenhNhan}"`, async () => {
    // Reset bộ lọc cũ: xóa mã BA / tên dính từ luồng trước -> tránh lọc chồng ra RỖNG
    await resetBoLocTimKiem(page);
    const search = page.getByPlaceholder(/Tìm.*tên NB/i).first();
    // Nhập SẠCH + kiểm tra đúng tên
    await nhapSach(page, search, tenBenhNhan);
    await search.press('Enter');
    // ĐỢI đúng tên vừa tìm hiện ra trong bảng (mạng yếu / kết quả cũ chưa cập nhật)
    await page.getByText(bnRe).first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });

  await step(page, 'Mở hồ sơ bệnh nhân (đúng dòng vừa tìm)', async () => {
    // Click ĐÚNG dòng có tên vừa tìm, KHÔNG lấy "dòng CB đầu tiên" (tránh trúng ca cũ)
    await page.getByText(bnRe).first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
  }, { retries: 2 });
}

// Mở tab "Tờ điều trị, chỉ định" và tạo tờ điều trị (2 case: tạo mới / thêm mới)
export async function moToDieuTri(page: Page): Promise<void> {
  await step(page, 'Mở tab "Tờ điều trị, chỉ định"', async () => {
    await page.getByText('Tờ điều trị, chỉ định', { exact: false }).first().click();
    await page.waitForTimeout(1200);
  }, { retries: 2 });

  await step(page, 'Tạo/Thêm tờ điều trị', async () => {
    const taoMoi = page.getByRole('button', { name: /Tạo tờ điều trị mới/i }).first();
    const themMoi = page.getByRole('button', { name: /Thêm mới/i }).first();
    // ĐỢI 1 trong 2 nút load ra rồi mới bấm (mạng yếu / panel chưa render)
    await page.getByRole('button', { name: /Tạo tờ điều trị mới|Thêm mới/i }).first()
      .waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    if (await taoMoi.isVisible().catch(() => false)) {
      await taoMoi.click(); // Case: chưa có tờ điều trị
    } else if (await themMoi.isVisible().catch(() => false)) {
      await themMoi.click(); // Case: đã có -> thêm tờ mới
    } else {
      throw new Error('Không thấy nút "Tạo tờ điều trị mới" hoặc "Thêm mới"');
    }
    // Đợi form tờ điều trị mở ra (nút Lưu xuất hiện)
    await page.getByRole('button', { name: /^Lưu$/i }).first().waitFor({ state: 'visible', timeout: 15000 });
  });
}

// Điền form Tờ điều trị theo note. ngay = "DD/MM/YYYY".
// gio khác nhau theo luồng để tránh trùng thời gian y lệnh trong 1 khoa cùng ngày:
// L1 = 08:00:00, L2 = 08:01:00, L3 = 08:02:00.
export async function dienFormToDieuTri(page: Page, ngay: string, huongXuTri = 'Chích vaccin', gio = '08:00:00'): Promise<void> {
  const ngayGio = `${ngay} ${gio}`;

  await step(page, `Ngày y lệnh = ${ngayGio}`, async () => {
    await setNgayGio(page, 'Ngày y lệnh', ngayGio);
  });
  await step(page, `Ngày khám = ${ngayGio}`, async () => {
    await setNgayGio(page, 'Ngày khám', ngayGio);
  });
  await step(page, 'Diễn biến bệnh = "Bé hồng, khóc tốt"', async () => {
    // Mặc định form đã có sẵn; chỉ điền nếu textarea đang trống
    const ta = page.getByText('Diễn biến bệnh', { exact: false }).first().locator('xpath=following::textarea[1]');
    const val = (await ta.inputValue().catch(() => '')) || '';
    if (!val.trim()) await ta.fill('Bé hồng, khóc tốt');
  });
  await step(page, `Hướng xử trí = "${huongXuTri}"`, async () => {
    await setTextarea(page, 'Hướng xử trí', huongXuTri);
  });
  await step(page, 'Chế độ chăm sóc = "Chế độ CS Cấp III"', async () => {
    await pickAntSelect(page, 'Chế độ chăm sóc', 'Chế độ CS Cấp III');
  });
  await step(page, `Thời gian đi buồng = ${ngay}`, async () => {
    await setNgayGio(page, 'Thời gian đi buồng', ngayGio);
  });
}

// Bấm nút Lưu ở góc phải form Tờ điều trị và chờ dấu hiệu thành công
export async function luuToDieuTri(page: Page): Promise<void> {
  await checkpoint(page, 'Trước khi Lưu tờ điều trị');
  await step(page, 'Bấm Lưu Tờ điều trị', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(1500);
    // Nếu đã có tờ điều trị cùng ngày -> HIS hỏi "Xác nhận tạo trùng" -> bấm Xác nhận (theo yêu cầu)
    await xacNhanPopupNeuCo(page);
    // Cảnh báo mềm chỉ có nút Đóng (vd "thời gian y lệnh > thời gian vào khoa") -> đóng để không chặn bước sau
    await dongCanhBaoNeuCo(page);
    await page.waitForTimeout(800);
  });
}

// Chọn Loại phiếu sàng lọc (mặc định "dưới 1 tháng tuổi") rồi Lưu
export async function luuPhieuSangLoc(page: Page, loaiPhieuChua = 'dưới 1 tháng tuổi'): Promise<void> {
  await step(page, 'Chọn Loại phiếu sàng lọc', async () => {
    const sel = page.getByText('Loại phiếu sàng lọc', { exact: false }).first().locator('xpath=following::*[contains(@class,"ant-select")][1]');
    // Nếu đã đúng loại thì thôi; nếu chưa thì mở dropdown chọn
    const cur = (await sel.textContent().catch(() => '')) || '';
    if (!cur.includes(loaiPhieuChua)) {
      await sel.click();
      await page.waitForTimeout(600);
      await page.locator('.ant-select-item-option', { hasText: new RegExp(loaiPhieuChua, 'i') }).first().click();
      await page.waitForTimeout(500);
    }
  });
  await checkpoint(page, 'Trước khi Lưu phiếu sàng lọc');
  await step(page, 'Lưu phiếu sàng lọc', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(2000);
  });
}

// ---- KHÁM CHUYÊN KHOA (dùng cho luồng 2: khám sơ sinh, luồng 3: PHCN) ----

// Mở dialog "Khám chuyên khoa" trên editor tờ điều trị, chọn khoa + nội dung, Xác nhận.
export async function moKhamChuyenKhoa(page: Page, maKhoa: string, noiDung: string): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: /Khám chuyên khoa/i });

  await step(page, 'Bấm "Khám chuyên khoa"', async () => {
    await page.getByRole('button', { name: /Khám chuyên khoa/i }).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('button', { name: /Khám chuyên khoa/i }).first().click();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });

  await step(page, `Mời khoa khám chuyên khoa = ${maKhoa}`, async () => {
    // ant-select đứng sau nhãn "Mời khoa khám chuyên khoa"
    const sel = dialog.getByText('Mời khoa khám chuyên khoa', { exact: false }).first()
      .locator('xpath=following::*[contains(@class,"ant-select")][1]');
    await sel.click();
    await page.keyboard.type(maKhoa, { delay: 40 });
    await page.waitForTimeout(1000);
    const opt = page.locator('.ant-select-item-option', { hasText: maKhoa }).first();
    await opt.waitFor({ state: 'visible', timeout: 10000 });
    await opt.click();
    await page.waitForTimeout(500);
  }, { retries: 2 });

  // Nội dung yêu cầu (L2 có, L3 để trống)
  if (noiDung) {
    await step(page, `Nội dung yêu cầu = "${noiDung}"`, async () => {
      const ta = dialog.getByPlaceholder(/Nhập nội dung yêu cầu/i).first();
      await ta.click();
      await ta.fill(noiDung);
    });
  }

  await step(page, 'Bấm Xác nhận (khám chuyên khoa)', async () => {
    await dialog.getByRole('button', { name: /Xác nhận/i }).click();
    await page.waitForTimeout(1500);
  });
}

// ---- ORCHESTRATOR: luồng 2 (khám sơ sinh) & luồng 3 (khám PHCN) ----

export interface FlowKCKData {
  tenBenhNhan: string;
  ngay: string;
  gio: string;        // "08:01:00" (L2) / "08:02:00" (L3)
  huongXuTri: string; // "Khám sơ sinh" (L2) / "Khám phục hồi chức năng" (L3)
  maKhoa: string;     // "3050" (sơ sinh) / "4074" (PHCN)
  noiDung: string;    // L2 "Khám trẻ dịch vụ theo yêu cầu" / L3 để trống
}

// Tạo tờ điều trị (hướng xử trí theo luồng) -> Lưu -> Khám chuyên khoa -> Xác nhận
// -> DỪNG trước nút Lưu CUỐI cho bác sĩ xác nhận.
export async function chayLuongKhamChuyenKhoa(
  page: Page,
  data: FlowKCKData,
  onConfirm: (screenshot: string) => Promise<boolean>
): Promise<void> {
  await moDanhSachNoiTru(page);
  await chonKhoaLamViec(page);
  await timVaMoBenhNhan(page, data.tenBenhNhan);
  await moToDieuTri(page);
  await dienFormToDieuTri(page, data.ngay, data.huongXuTri, data.gio);
  await luuToDieuTri(page);

  await moKhamChuyenKhoa(page, data.maKhoa, data.noiDung);

  // ĐIỂM XÁC NHẬN trước nút Lưu CUỐI
  const shot = await chupManHinh(page, 'xac-nhan-truoc-luu-cuoi');
  const choPhep = await onConfirm(shot);
  if (choPhep) {
    await step(page, 'Bấm Lưu CUỐI (khám chuyên khoa)', async () => {
      await page.getByRole('button', { name: /^Lưu$/i }).last().click();
      await page.waitForTimeout(2000);
    });
  }
}
