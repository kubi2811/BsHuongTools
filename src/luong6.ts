// LUỒNG 6: Nhập sàng lọc bé (xét nghiệm sàng lọc sơ sinh).
// Tìm MẸ theo Mã BA -> hover tên mẹ mở hồ sơ CON -> tờ điều trị con -> chẩn đoán Z38.0
// -> hướng xử trí "Xét nghiệm sàng lọc" -> Lưu -> F2 chỉ định XN (XN000530 [+XN000536]).
import { type Page } from 'playwright';
import { config } from './config.js';
import { step, checkpoint, chupManHinh, nhapSach, xacNhanPopupNeuCo } from './helpers.js';
import {
  resetBoLocTimKiem, chonKhoaLamViec, moToDieuTri,
  setTextarea, pickAntSelect, luuToDieuTri, moTrangHIS,
} from './flow1.js';

// ---- Ô ngày/giờ: ô .input-date (type=text) NHẬP THẲNG được (đồng bộ với ant-picker ẩn).
//      Chỉ cần gõ "DD/MM/YYYY HH:mm:ss" - ngày do user chọn, giờ mặc định 09:00:00. ----
export async function setNgayGioLich(page: Page, nhan: string, ngay: string, gio = '09:00:00'): Promise<void> {
  const full = `${ngay} ${gio}`;
  const wrap = page.getByText(nhan, { exact: false }).first()
    .locator('xpath=ancestor::div[contains(@class,"date")][1]');
  const input = wrap.locator('input.input-date').first();
  await input.scrollIntoViewIfNeeded();
  for (let lan = 0; lan < 3; lan++) {
    await input.click();
    await input.press('Control+a');
    await input.press('Delete');
    await input.fill(full);
    await input.press('Enter');
    await input.press('Tab'); // blur -> commit onChange
    await page.waitForTimeout(400);
    const got = (await input.inputValue().catch(() => '')) || '';
    if (got.includes(ngay)) return;
  }
  console.warn(`  ⚠️  Ngày y lệnh chưa nhận đúng "${full}" sau 3 lần - kiểm tra khi xác nhận.`);
}

// ---- Tìm MẸ theo Mã BA rồi mở hồ sơ CON (hover tên -> popup -> link chi tiết con) ----
export async function timVaMoConTheoMaBA(page: Page, maBA: string): Promise<void> {
  const listUrl = config.hisUrl.replace(/\/$/, '') + '/quan-ly-noi-tru/danh-sach-nguoi-benh-noi-tru';

  await step(page, `Tìm MẸ theo Mã BA = ${maBA}`, async () => {
    await moTrangHIS(page, listUrl); // tự đăng nhập lại nếu hết phiên
    await page.waitForTimeout(1000);
    await chonKhoaLamViec(page);
    await resetBoLocTimKiem(page); // xóa mọi ô lọc dính từ luồng trước
    const s = page.getByPlaceholder(/^Mã bệnh án$/i).first();
    await nhapSach(page, s, maBA);
    await page.waitForTimeout(300);
    await s.press('Enter');
    await page.waitForTimeout(2500);
    // Chờ dòng kết quả (có "Con:" = ca mẹ+con)
    await page.locator('tr.ant-table-row').first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 3 });

  await step(page, 'Mở hồ sơ CON (hover tên mẹ -> popup -> icon mở con)', async () => {
    const row = page.locator('tr.ant-table-row').first();
    // Hover TÊN CON (span.con-name) để hiện popover thông tin con (có icon mở hồ sơ).
    const conName = row.locator('.con-name').first();
    const hoverTarget = (await conName.count()) ? conName : row.locator('.con-item, .tenNb').first();
    await hoverTarget.scrollIntoViewIfNeeded();
    // Popover thông tin con (lọc theo nội dung để tránh trúng popover khác đang ẩn)
    const popContent = page.locator('.ant-popover-inner-content')
      .filter({ hasText: /Tên người bệnh|Mã NB|Chẩn đoán/i }).last();
    let popped = false;
    for (let i = 0; i < 4; i++) {
      await hoverTarget.hover({ force: true });
      await page.waitForTimeout(600);
      if (await popContent.count()) { popped = true; break; }
    }
    if (!popped) throw new Error('Không hiện popup thông tin con khi hover tên con (.con-name).');

    await popContent.waitFor({ state: 'visible', timeout: 6000 });
    // Giữ popover mở rồi bấm icon (svg) MỞ hồ sơ con
    await popContent.hover();
    await page.waitForTimeout(200);
    await popContent.locator('svg').first().click();

    // Chờ điều hướng sang trang chi tiết con
    await page.waitForURL(/chi-tiet-nguoi-benh-noi-tru\/\d+/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // VERIFY đúng CON: mã BA con dạng <maBA>.1.x HOẶC hồ sơ sơ sinh ("ngày tuổi").
    const conMaRe = new RegExp(maBA.replace(/\./g, '\\.') + '\\.1');
    let dungCon = false;
    try {
      await page.getByText(new RegExp(conMaRe.source + '|ngày tuổi', 'i')).first()
        .waitFor({ state: 'attached', timeout: 10000 });
      dungCon = true;
    } catch {
      dungCon = conMaRe.test(await page.content().catch(() => ''));
    }
    if (!dungCon) throw new Error(`Mở NHẦM hồ sơ - không thấy mã con ${maBA}.1 / "ngày tuổi". URL=${page.url()}`);
  }, { retries: 2 });
}

// ---- Chẩn đoán bệnh (ant-select searchable): gõ mã -> chọn option ----
export async function setChanDoan(page: Page, ma = 'z38.0'): Promise<void> {
  const maEsc = ma.replace(/\./g, '\\.');
  await step(page, `Chẩn đoán bệnh = ${ma.toUpperCase()}`, async () => {
    const sel = page.getByText(/Chẩn đoán bệnh|Chẩn đoán chính/i).first()
      .locator('xpath=following::*[contains(@class,"ant-select")][1]');
    await sel.scrollIntoViewIfNeeded();
    await sel.click();
    await page.waitForTimeout(400);
    await page.keyboard.type(ma, { delay: 45 }); // gõ lọc
    await page.waitForTimeout(1300);
    const opt = page.locator('.ant-select-item-option', { hasText: new RegExp(maEsc, 'i') }).first();
    await opt.waitFor({ state: 'visible', timeout: 8000 });
    await opt.click();
    await page.waitForTimeout(500);
  }, { retries: 2 });
}

// ---- Diễn biến bệnh: ghi text tự do (textarea) hoặc combobox "Chọn diễn biến" ----
async function setDienBien(page: Page, text: string): Promise<void> {
  await step(page, `Diễn biến bệnh = "${text}"`, async () => {
    const ta = page.getByText(/Diễn biến/i).first().locator('xpath=following::textarea[1]');
    if ((await ta.count()) && (await ta.isVisible().catch(() => false))) {
      await ta.click();
      await ta.fill(text);
      await page.waitForTimeout(300);
      return;
    }
    // Fallback: ô "Chọn diễn biến" (combobox cho gõ tự do)
    const cb = page.getByPlaceholder(/diễn biến/i).first();
    await cb.click();
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(500);
    await cb.press('Enter').catch(() => {});
  });
}

// ---- Điền form Tờ điều trị của CON cho sàng lọc ----
export async function dienFormLuong6(page: Page, ngay: string): Promise<void> {
  await step(page, `Ngày y lệnh = ${ngay} 09:00:00`, async () => {
    await setNgayGioLich(page, 'Ngày y lệnh', ngay, '09:00:00');
  });
  await setDienBien(page, 'Bé hồng, khóc tốt');
  await setChanDoan(page, 'z38.0');
  await step(page, 'Hướng xử trí = "Xét nghiệm sàng lọc"', async () => {
    await setTextarea(page, 'Hướng xử trí', 'Xét nghiệm sàng lọc');
  });
  await step(page, 'Chế độ chăm sóc = "Chế độ CS Cấp III"', async () => {
    await pickAntSelect(page, 'Chế độ chăm sóc', 'Chế độ CS Cấp III');
  });
}

// ---- Chỉ định dịch vụ kỹ thuật (F2): tick từng mã XN, rồi Đồng ý ----
export async function chiDinhXetNghiem(page: Page, codes: string[]): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: /Chỉ định dịch vụ kỹ thuật/i });

  await step(page, 'Mở hộp thoại chỉ định DVKT (F2)', async () => {
    await xacNhanPopupNeuCo(page, 800); // đóng popup còn sót che ô F2
    const f2 = page.getByPlaceholder(/F2/i).first();
    await f2.scrollIntoViewIfNeeded();
    await f2.click();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });

  for (const code of codes) {
    await step(page, `Lọc & tick xét nghiệm ${code}`, async () => {
      // Gõ SẠCH mã vào ô "Chọn dịch vụ" trong hộp thoại (xóa mã cũ trước)
      const search = dialog.getByPlaceholder(/Chọn dịch vụ/i).first();
      await nhapSach(page, search, code);
      await page.waitForTimeout(1800);
      // Tick ô .ant-checkbox của dòng chứa mã (bên bảng trái)
      const row = dialog.locator('.ant-row, tr, [class*="item"]')
        .filter({ hasText: new RegExp(code, 'i') }).first();
      const box = row.locator('.ant-checkbox').first();
      if (await box.count()) await box.click();
      else await row.getByText(new RegExp(code, 'i')).first().click();
      await page.waitForTimeout(900);
      await xacNhanPopupNeuCo(page, 800); // popup xác nhận (nếu có)
    }, { retries: 2 });
  }

  await step(page, 'Bấm Đồng ý (đưa xét nghiệm vào tờ)', async () => {
    await dialog.getByRole('button', { name: /Đồng ý/i }).first().click();
    await page.waitForTimeout(2000);
    await xacNhanPopupNeuCo(page, 800);
  });

  await step(page, 'Đóng cảnh báo tạm ứng (nếu có)', async () => {
    await dongCanhBaoTamUng(page);
  });
}

// Đóng popup "Cảnh báo - Người bệnh cần tạm ứng..." (nút Đóng/Bỏ qua) để không chặn nút Lưu.
async function dongCanhBaoTamUng(page: Page): Promise<void> {
  const warn = page.getByRole('dialog').filter({ hasText: /tạm ứng|Cảnh báo/i });
  if (await warn.isVisible().catch(() => false)) {
    await warn.getByRole('button', { name: /Đóng|Bỏ qua|^OK$/i }).first().click();
    await page.waitForTimeout(800);
  }
}

// Bấm Lưu CUỐI của luồng (lưu chỉ định xét nghiệm)
export async function luuSangLocCuoi(page: Page): Promise<void> {
  await step(page, 'Bấm Lưu CUỐI (chỉ định xét nghiệm)', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(1500);
    await xacNhanPopupNeuCo(page);
  });
}

// ---- ORCHESTRATOR luồng 6 ----
export interface Flow6Data {
  maBA: string;     // Mã bệnh án MẸ
  ngay: string;     // DD/MM/YYYY (giờ 09:00:00)
  codes: string[];  // mã XN cần chỉ định (XN000530 thường quy / XN000536 mở rộng)
}

export async function chayLuong6(
  page: Page,
  data: Flow6Data,
  onConfirm: (screenshot: string) => Promise<boolean>
): Promise<void> {
  if (!data.codes?.length) throw new Error('Chưa chọn loại xét nghiệm sàng lọc nào.');

  // 1) Tìm mẹ theo Mã BA -> mở hồ sơ CON
  await timVaMoConTheoMaBA(page, data.maBA);

  // 2) Tờ điều trị của CON (tạo mới / thêm mới)
  await moToDieuTri(page);

  // 3) Điền form (ngày, diễn biến, chẩn đoán Z38.0, hướng xử trí, chế độ CS) rồi Lưu
  await dienFormLuong6(page, data.ngay);
  await luuToDieuTri(page); // tự Lưu + tự Xác nhận popup tạo trùng nếu có

  // 4) Chỉ định xét nghiệm sàng lọc (F2) - tick các mã user chọn
  await chiDinhXetNghiem(page, data.codes);

  // 5) ĐIỂM XÁC NHẬN trước nút Lưu CUỐI (an toàn y lệnh - đây là chỉ định có phí)
  const shot = await chupManHinh(page, 'l6-xac-nhan-truoc-luu-cuoi');
  const choPhep = await onConfirm(shot);
  if (choPhep) await luuSangLocCuoi(page);
}
