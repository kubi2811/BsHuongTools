// LUỒNG 6: Nhập sàng lọc bé (xét nghiệm sàng lọc sơ sinh).
// Tìm MẸ theo Mã BA -> hover tên mẹ mở hồ sơ CON -> tờ điều trị con -> chẩn đoán Z38.0
// -> hướng xử trí "Xét nghiệm sàng lọc" -> Lưu -> F2 chỉ định XN (XN000530 [+XN000536]).
import { type Page, type Locator } from 'playwright';
import { config } from './config.js';
import { step, checkpoint, nhapSach, xacNhanPopupNeuCo, dongCanhBaoNeuCo } from './helpers.js';
import {
  resetBoLocTimKiem, chonKhoaLamViec, moToDieuTri,
  setTextarea, pickAntSelect, luuToDieuTri, moTrangHIS,
} from './flow1.js';

// ---- Ô ngày/giờ: ô .input-date (type=text) NHẬP THẲNG được (đồng bộ với ant-picker ẩn).
//      Chỉ cần gõ "DD/MM/YYYY HH:mm:ss" - ngày do user chọn, giờ mặc định 09:00:00. ----
export async function setNgayGioLich(page: Page, nhan: string, ngay: string, gio = '09:00:00'): Promise<void> {
  const full = `${ngay} ${gio}`;
  const lbl = page.getByText(nhan, { exact: false }).first();
  // Ưu tiên ô .input-date trong khối .date của nhãn; fallback: ô .input-date đầu tiên SAU nhãn.
  let input = lbl.locator('xpath=ancestor::div[contains(@class,"date")][1]').locator('input.input-date').first();
  if (!(await input.count())) {
    input = lbl.locator('xpath=following::input[contains(@class,"input-date")][1]');
  }
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

  // Mã BA của CON = mã mẹ + ".x.y" (vd mẹ "NNNNNNN" -> con "NNNNNNN.3.1"). Mẹ KHÔNG có phần ".x".
  const conMaRe = new RegExp(maBA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\d');

  // Gộp tìm + mở con vào 1 step: mỗi lần retry tự điều hướng lại từ trang danh sách
  // (nếu tách 2 step, retry của step sau sẽ chạy khi đã rời trang danh sách -> timeout khó hiểu).
  await step(page, `Tìm MẸ theo Mã BA ${maBA} & mở hồ sơ CON`, async () => {
    await moTrangHIS(page, listUrl); // tự đăng nhập lại nếu hết phiên
    await page.waitForTimeout(1000);
    await chonKhoaLamViec(page);
    await resetBoLocTimKiem(page); // xóa mọi ô lọc dính từ luồng trước
    const s = page.getByPlaceholder(/^Mã bệnh án$/i).first();
    await nhapSach(page, s, maBA);
    await page.waitForTimeout(300);
    await s.press('Enter');
    await page.waitForTimeout(2500);

    // Chờ ĐÚNG dòng có liên kết CON (chứng tỏ bảng đã lọc xong, không phải kết quả cũ).
    // Nếu không có -> báo lỗi RÕ: mã BA sai (không có bệnh nhân) hay có nhưng không phải ca mẹ+con.
    const conNames = page.locator('tr.ant-table-row .con-name');
    const daHienCon = await conNames.first().waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true).catch(() => false);
    if (!daHienCon) {
      const soDong = await page.locator('tr.ant-table-row').count();
      if (soDong === 0) throw new Error(`Không tìm thấy bệnh nhân với Mã BA "${maBA}" — kiểm tra lại mã BA (gõ đủ/đúng số).`);
      throw new Error(`Có bệnh nhân nhưng KHÔNG thấy hồ sơ CON (không phải ca mẹ+con?) — kiểm tra lại Mã BA "${maBA}".`);
    }
    const soCon = await conNames.count();
    if (soCon > 1) {
      throw new Error(`Kết quả có ${soCon} bé (sinh đôi hoặc lọc chưa đúng) - KHÔNG tự đoán, dừng an toàn.`);
    }

    // Hover TÊN CON (span.con-name) để hiện popover thông tin con (có icon mở hồ sơ).
    const conName = conNames.first();
    await conName.scrollIntoViewIfNeeded();
    const popContent = page.locator('.ant-popover-inner-content')
      .filter({ hasText: /Tên người bệnh|Mã NB|Chẩn đoán/i }).last();
    let popped = false;
    for (let i = 0; i < 4; i++) {
      await conName.hover({ force: true });
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

    // VERIFY đúng CON: hồ sơ phải mang mã <maBA>.x.y (mẹ chỉ có <maBA>).
    let dungCon = false;
    try {
      await page.getByText(conMaRe).first().waitFor({ state: 'attached', timeout: 10000 });
      dungCon = true;
    } catch {
      dungCon = conMaRe.test(await page.content().catch(() => ''));
    }
    if (!dungCon) throw new Error(`Mở NHẦM hồ sơ - không thấy mã con dạng ${maBA}.x.y. URL=${page.url()}`);
  }, { retries: 3 });
}

// ---- Chẩn đoán bệnh (ant-select tag, searchable): gõ mã -> chọn option -> VERIFY chip đã dính.
// Trước hay bị: chọn option xong nhưng form không commit (chip không hiện) -> khi Lưu chẩn đoán trống.
export async function setChanDoan(page: Page, ma = 'z38.0'): Promise<void> {
  const maRe = new RegExp(ma.replace(/\./g, '\\.'), 'i');
  const box = oChanDoan(page); // ô "Chẩn đoán bệnh"
  await step(page, `Chẩn đoán bệnh = ${ma.toUpperCase()}`, async () => {
    for (let lan = 0; lan < 3; lan++) {
      const sel = box.locator('.ant-select').first();
      await sel.scrollIntoViewIfNeeded();
      await sel.click();
      await page.waitForTimeout(400);
      await page.keyboard.type(ma, { delay: 45 }); // gõ lọc
      await page.waitForTimeout(1300);
      const opt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option', { hasText: maRe }).first();
      if (await opt.count()) {
        await opt.click();
        await page.waitForTimeout(700);
      }
      // VERIFY: chip ĐÃ CHỌN (.ant-select-selection-item) trong ô chẩn đoán chứa mã
      const chip = (await box.locator('.ant-select-selection-item').allTextContents()).join(' ');
      if (maRe.test(chip)) return;
      await page.keyboard.press('Escape').catch(() => {}); // đóng dropdown, thử lại
      await page.waitForTimeout(400);
    }
    throw new Error(`Không chọn được chẩn đoán ${ma.toUpperCase()} (chip không dính sau 3 lần) - dừng an toàn.`);
  });
}

// ---- Chẩn đoán: XÓA HẾT tag cũ rồi đặt Z38.0, có VERIFY (sai chẩn đoán là hại bệnh nhân) ----
function oChanDoan(page: Page): Locator {
  return page.getByText(/Chẩn đoán bệnh/i).first()
    .locator('xpath=ancestor::div[contains(@class,"ant-row") or contains(@class,"ant-col")][1]');
}

export async function datChanDoanZ380(page: Page): Promise<void> {
  const CLOSE = '.ant-select-selection-item-remove, .ant-tag-close-icon, .anticon-close, svg[data-icon="close"]';

  await step(page, 'Xóa hết chẩn đoán bệnh cũ', async () => {
    const box = oChanDoan(page);
    await box.first().waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 25; i++) {
      const closes = box.locator(CLOSE);
      if (!(await closes.count())) break;
      await closes.first().click({ force: true });
      await page.waitForTimeout(350);
    }
    const con = await box.locator(CLOSE).count();
    if (con) throw new Error(`Còn ${con} tag chẩn đoán chưa xóa được - dừng an toàn.`);
  }, { retries: 1 });

  await setChanDoan(page, 'z38.0');

  await step(page, 'Kiểm tra chẩn đoán = Z38.0', async () => {
    const txt = ((await oChanDoan(page).textContent().catch(() => '')) || '');
    if (!/z38\.0/i.test(txt)) throw new Error(`Chẩn đoán sau khi đặt không chứa Z38.0 (đang là: "${txt.slice(0, 80)}") - dừng an toàn.`);
  });
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
  await datChanDoanZ380(page); // xóa hết chẩn đoán cũ + đặt Z38.0 + VERIFY (tránh Lưu hụt -> lỗi F2)
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
    await dongCanhBaoNeuCo(page);
  });
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
  _onConfirm: (screenshot: string) => Promise<boolean>
): Promise<void> {
  if (!data.codes?.length) throw new Error('Chưa chọn loại xét nghiệm sàng lọc nào.');

  // 1) Tìm mẹ theo Mã BA -> mở hồ sơ CON
  await timVaMoConTheoMaBA(page, data.maBA);

  // 2) Tờ điều trị của CON (tạo mới / thêm mới)
  await moToDieuTri(page);

  // 3) Điền form (ngày, diễn biến, chẩn đoán Z38.0, hướng xử trí, chế độ CS) rồi Lưu
  await dienFormLuong6(page, data.ngay);
  await luuToDieuTri(page); // tự Lưu + tự Xác nhận popup tạo trùng nếu có

  // Xác minh ĐÃ LƯU THẬT (nếu chẩn đoán/ngày lỗi -> form còn "Thêm mới" -> báo rõ, không mù ở F2)
  await step(page, 'Kiểm tra tờ điều trị đã lưu', async () => {
    const ok = await page.getByPlaceholder(/F2/i).first()
      .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!ok) throw new Error('Tờ điều trị CHƯA lưu được (chẩn đoán chưa dính / ngày y lệnh sớm-trùng?). Dừng an toàn.');
  });

  // 4) Chỉ định xét nghiệm sàng lọc (F2) - tick các mã user chọn
  await chiDinhXetNghiem(page, data.codes);

  // 5) Theo yêu cầu bác sĩ: TỰ bấm Lưu CUỐI luôn, KHÔNG chờ xác nhận.
  //    Vẫn chụp ảnh trước khi Lưu để lưu vết trên timeline (audit).
  await checkpoint(page, 'Trước khi Lưu cuối (tự lưu - sàng lọc)');
  await luuSangLocCuoi(page);
}
