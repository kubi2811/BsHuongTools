// LUỒNG 1: CHÍCH VACCINE - xây dựng dần theo selector thật đã dò.
// Chạy headed để bác sĩ theo dõi. Mỗi giai đoạn xong sẽ dò DOM trang kế tiếp.
import { type Page } from 'playwright';
import { config } from './config.js';
import { step, chupManHinh, checkpoint, nhapSach, xacNhanPopupNeuCo } from './helpers.js';
import { dangNhapLaiNeuCan, dongThongBao } from './login.js';
import path from 'node:path';

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

// Tìm bệnh nhân theo tên (rule: "CB + tên") rồi mở hồ sơ đứa con.
// Chống dính cache: xóa sạch ô tìm, CHỜ ĐÚNG TÊN vừa nhập hiện ra rồi mới click dòng đó.
export async function timVaMoBenhNhan(page: Page, tenBenhNhan: string): Promise<void> {
  // Regex khớp đúng tên vừa tìm (vd "CB <tên bệnh nhân>") - dùng để chờ & click đúng dòng
  const bnRe = new RegExp(tenBenhNhan.trim().replace(/\s+/g, '\\s+'), 'i');

  await step(page, `Tìm bệnh nhân "${tenBenhNhan}"`, async () => {
    const search = page.getByPlaceholder(/Tìm.*tên NB/i).first();
    // Nhập SẠCH + kiểm tra đúng tên (chống dính cache mã BA/tên từ luồng trước)
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

// ĐIỂM XÁC NHẬN trước khi Lưu (an toàn y lệnh). Trả về true nếu được phép Lưu.
export async function confirmDiemLuu(page: Page, nhan: string): Promise<boolean> {
  const shot = path.join(config.screenshotDir, `XACNHAN-${Date.now()}-${nhan.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: shot }).catch(() => {});
  console.log(`\n⏸  ĐIỂM XÁC NHẬN [${nhan}]: đã điền xong, CHƯA Lưu.  📸 ${path.basename(shot)}`);
  const choPhep = process.env.AUTO_SAVE === '1' || !config.confirmBeforeSave;
  if (!choPhep) {
    console.log('   → Dừng lại để bác sĩ kiểm tra. Chạy lại với AUTO_SAVE=1 để bot tự bấm Lưu.\n');
  }
  return choPhep;
}

// Bấm "Đủ điều kiện tiêm chủng" (trên trang Tờ điều trị) TRƯỚC khi Lưu.
export async function duDieuKienTiemChung(page: Page): Promise<void> {
  await step(page, 'Bấm "Đủ điều kiện tiêm chủng"', async () => {
    await page.getByRole('button', { name: /Đủ điều kiện tiêm chủng/i }).first().click();
    await page.waitForTimeout(1800);
    // Nếu hiện popup xác nhận -> đồng ý
    const dlg = page.getByRole('dialog').filter({ hasText: /tiêm chủng|xác nhận|đồng ý|cảnh báo/i });
    if (await dlg.isVisible().catch(() => false)) {
      const ok = dlg.getByRole('button', { name: /Đồng ý|Xác nhận|^OK$|^Có$|^Lưu$/i }).first();
      if (await ok.count()) {
        await ok.click();
        await page.waitForTimeout(1200);
      }
    }
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
    await page.waitForTimeout(800);
  });
}

// STAGE 2: Chỉ định dịch vụ PK022 trên editor tờ điều trị (sau khi Lưu tờ)
export async function chiDinhDichVu(page: Page, maDV = 'PK022'): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: /Chỉ định dịch vụ kỹ thuật/i });

  await step(page, `Mở hộp thoại chỉ định dịch vụ (F2), gõ ${maDV}`, async () => {
    // Đóng popup "tạo trùng tờ điều trị" nếu còn sót lại (nó che ô F2 -> scroll timeout)
    await xacNhanPopupNeuCo(page, 1000);
    const f2 = page.getByPlaceholder(/F2/i).first();
    await f2.scrollIntoViewIfNeeded();
    await f2.click();
    await f2.fill(maDV);
    // Đợi hộp thoại mở ra (mạng yếu)
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });

  await step(page, `Lọc & tick dịch vụ ${maDV} trong hộp thoại`, async () => {
    // Gõ mã vào ô "Chọn dịch vụ" bên trong hộp thoại để lọc
    const search = dialog.getByPlaceholder(/Chọn dịch vụ/i).first();
    await search.click();
    await search.fill(maDV);
    await page.waitForTimeout(2000);
    // Tick ô .ant-checkbox của dòng chứa mã (click input ẩn không toggle được)
    const row = dialog
      .locator('.ant-row, tr, [class*="item"]')
      .filter({ hasText: new RegExp(maDV, 'i') })
      .first();
    const box = row.locator('.ant-checkbox').first();
    if (await box.count()) {
      await box.click();
    } else {
      await row.getByText(new RegExp(maDV, 'i')).first().click();
    }
    await page.waitForTimeout(1000);
    // Xác nhận đã vào panel "Đã chọn"
    const daChon = dialog.locator('text=Đã chọn').first();
    await daChon.waitFor({ state: 'visible' }).catch(() => {});
  });

  await step(page, 'Bấm Đồng ý', async () => {
    await dialog.getByRole('button', { name: /Đồng ý/i }).click();
    await page.waitForTimeout(2000);
  });

  await step(page, 'Đóng popup cảnh báo tạm ứng (nếu có)', async () => {
    const warn = page.getByRole('dialog').filter({ hasText: /tạm ứng|Cảnh báo/i });
    if (await warn.isVisible().catch(() => false)) {
      await warn.getByRole('button', { name: /Đóng|Bỏ qua/i }).first().click();
      await page.waitForTimeout(1000);
    }
  });

  // Trên editor tờ điều trị: bấm "Đủ điều kiện tiêm chủng" TRƯỚC khi Lưu (theo yêu cầu)
  await duDieuKienTiemChung(page);

  await checkpoint(page, 'Trước khi Lưu chỉ định dịch vụ (PK022)');
  await step(page, 'Lưu chỉ định dịch vụ (góc phải)', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(2000);
  });
}

// ---- STAGE 3: KHÁM SÀNG LỌC ----

// Mở trang sàng lọc, tìm BN, mở chi tiết phiếu (linh hoạt: Gọi khám hoặc icon xem)
export async function moChiTietSangLoc(page: Page, ten: string): Promise<void> {
  await step(page, 'Mở Danh sách khám sàng lọc', async () => {
    await moTrangHIS(page, config.hisUrl.replace(/\/$/, '') + '/quan-ly-tiem-chung/danh-sach-kham-sang-loc');
    await page.waitForTimeout(700);
  });
  await chonKhoaLamViec(page);
  const nameRe = new RegExp(ten.trim().replace(/\s+/g, '\\s+'), 'i');
  // Đặt bộ lọc "Ngày thực hiện" = Tất cả để tìm ra record dù khác ngày (theo note)
  await step(page, 'Đặt Ngày thực hiện = Tất cả', async () => {
    await page.getByPlaceholder('Ngày thực hiện').first().click();
    await page.waitForTimeout(600);
    await page.getByText('Tất cả', { exact: true }).first().click();
    await page.waitForTimeout(1200);
  }, { retries: 2 });
  await step(page, `Tìm "${ten}" trên trang sàng lọc`, async () => {
    const s = page.getByPlaceholder(/Tìm mã tiêm chủng/i).first();
    // Nhập SẠCH + kiểm tra đúng tên (chống dính cache từ luồng trước)
    await nhapSach(page, s, ten);
    await s.press('Enter');
    // Đợi đúng tên vừa tìm hiện ra
    await page.getByText(nameRe).first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });
  await step(page, 'Mở chi tiết phiếu sàng lọc (ưu tiên "Chờ khám")', async () => {
    const rows = page.getByRole('row').filter({ hasText: nameRe });
    // Nếu search ra nhiều record -> chọn record có trạng thái "Chờ khám" và bấm "Gọi khám"
    const choKham = rows.filter({ hasText: /Chờ khám/i }).first();
    if (await choKham.count()) {
      await choKham.getByText(/Gọi khám/i).first().click();
    } else {
      // Không có "Chờ khám": lấy dòng đầu, có "Gọi khám" thì click, không thì icon xem 👁
      const row = rows.first();
      const gk = row.getByText(/Gọi khám/i);
      if (await gk.count()) await gk.first().click();
      else await row.locator('svg').first().click();
    }
    await page.waitForLoadState('domcontentloaded');
    // Đợi trang chi tiết sàng lọc load (menu "Chỉ định vắc xin" xuất hiện)
    await page.getByText('Chỉ định vắc xin', { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });
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

// ---- STAGE 4: CHỈ ĐỊNH VẮC XIN ----

export interface Vaccine {
  code: string;       // mã trong danh sách (BCG0001 / VGB0002) - để tick chính xác
  ten: string;        // tên hiển thị (BCG / VGB) - để dò dòng "Đã chọn"
  soLuong?: string;   // số lượng (BCG = 0.1)
  duongDung: string;  // đường dùng (BCG "Tiêm trong da", VGB "Tiêm bắp")
}

export const VACCINE_MAC_DINH: Record<string, Vaccine> = {
  BCG: { code: 'BCG0001', ten: 'BCG', soLuong: '1', duongDung: 'Tiêm trong da' },
  VGB: { code: 'VGB0002', ten: 'VGB', duongDung: 'Tiêm bắp' },
};

// Mở panel Chỉ định vắc xin, chọn vaccine + set số lượng/đường dùng, Đồng ý.
// DỪNG trước nút Lưu cuối cùng (theo yêu cầu). Trả về true nếu được phép Lưu cuối.
export async function chiDinhVaccine(page: Page, vaccines: Vaccine[]): Promise<void> {
  await step(page, 'Mở panel "Chỉ định vắc xin"', async () => {
    await page.getByText('Chỉ định vắc xin', { exact: false }).first().click();
    // Đợi ô "Chọn vắc xin" của panel hiện ra
    await page.getByPlaceholder(/Chọn vắc xin/i).first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });
  await step(page, 'Mở popup chọn vắc xin', async () => {
    await page.getByPlaceholder(/Chọn vắc xin/i).first().click();
    // Đợi popup bảng vaccine hiện ra
    await page.getByRole('dialog').filter({ hasText: /Chỉ định vắc xin/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
  }, { retries: 2 });

  const popup = page.getByRole('dialog').filter({ hasText: /Chỉ định vắc xin/i });

  for (const v of vaccines) {
    await step(page, `Tick vắc xin ${v.ten} (${v.code})`, async () => {
      // Dòng bảng bên trái có MÃ vaccine (duy nhất) -> click ô .ant-checkbox-wrapper
      const row = popup.locator('tr.ant-table-row').filter({ hasText: v.code }).first();
      await row.locator('.ant-checkbox-wrapper').first().waitFor({ state: 'visible', timeout: 15000 });
      await row.locator('.ant-checkbox-wrapper').first().click();
      await page.waitForTimeout(800);
    }, { retries: 2 });
  }

  for (const v of vaccines) {
    await step(page, `Thiết lập ${v.ten}: SL=${v.soLuong ?? 'mặc định'}, đường dùng=${v.duongDung}`, async () => {
      // Dòng trong panel "Đã chọn" = dòng bảng có tên vaccine VÀ có ô nhập số lượng
      const row = popup
        .locator('tr.ant-table-row')
        .filter({ hasText: new RegExp('^\\s*' + v.ten, 'i') })
        .filter({ has: page.locator('input[type="number"], input.ant-input-number-input') })
        .first();
      if (v.soLuong) {
        const sl = row.locator('input.ant-input-number-input, input[type="number"]').first();
        await sl.scrollIntoViewIfNeeded();
        await sl.fill(v.soLuong);
        await page.waitForTimeout(300);
      }
      // Đường dùng: ant-select searchable ở cột phải cùng -> mở, GÕ để lọc, chọn option
      const dd = row.locator('.ant-select').last();
      if (await dd.count()) {
        await dd.scrollIntoViewIfNeeded();
        await dd.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(v.duongDung, { delay: 30 }); // gõ lọc (list ảo)
        await page.waitForTimeout(900);
        const opt = page.locator('.ant-select-item-option', { hasText: new RegExp(v.duongDung, 'i') }).first();
        await opt.waitFor({ state: 'visible', timeout: 8000 });
        await opt.click();
        await page.waitForTimeout(500);
      }
    }, { retries: 2 });
  }

  await step(page, 'Bấm Đồng ý (đưa vắc xin vào phiếu)', async () => {
    await popup.getByRole('button', { name: /Đồng ý/i }).click();
    await page.waitForTimeout(2000);
  });
}

// Bấm nút Lưu CUỐI CÙNG của luồng (lưu chỉ định vắc xin)
export async function luuVaccineCuoi(page: Page): Promise<void> {
  await step(page, 'Bấm Lưu CUỐI (chỉ định vắc xin)', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(1200);
  });
}

// ---- ORCHESTRATOR: chạy trọn luồng 1 ----

export interface Flow1Data {
  tenBenhNhan: string; // đã gồm tiền tố "CB " nếu cần
  ngay: string;        // DD/MM/YYYY (giờ mặc định 08:00:00)
  vaccines: Vaccine[]; // BCG và/hoặc VGB
}

// Chạy trọn luồng 1. Tự bấm Lưu ở các stage trung gian; tới trước nút Lưu CUỐI
// thì gọi onConfirm() (để bác sĩ xác nhận trên UI). Nếu onConfirm trả true -> Lưu cuối.
export async function chayLuong1(
  page: Page,
  data: Flow1Data,
  _onConfirm: (screenshot: string) => Promise<boolean>
): Promise<void> {
  // STAGE 1: Tờ điều trị
  await moDanhSachNoiTru(page);
  await chonKhoaLamViec(page);
  await timVaMoBenhNhan(page, data.tenBenhNhan);
  await moToDieuTri(page);
  await dienFormToDieuTri(page, data.ngay);
  await luuToDieuTri(page);

  // STAGE 2: Chỉ định dịch vụ PK022
  await chiDinhDichVu(page, 'PK022');

  // STAGE 3: Khám sàng lọc
  await moChiTietSangLoc(page, data.tenBenhNhan);
  await luuPhieuSangLoc(page);

  // STAGE 4: Chỉ định vắc xin (dừng trước Lưu cuối)
  await chiDinhVaccine(page, data.vaccines);

  // Luồng 1 (tiêm chủng): theo yêu cầu bác sĩ -> TỰ bấm Lưu CUỐI luôn, KHÔNG chờ xác nhận.
  // Vẫn chụp ảnh trước khi Lưu để lưu vết trên timeline (audit).
  await checkpoint(page, 'Trước khi Lưu cuối (tự lưu - luồng 1)');
  await luuVaccineCuoi(page);
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
