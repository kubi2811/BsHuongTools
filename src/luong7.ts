// LUỒNG 7: Khám bé (khám + tiêm chủng trên hồ sơ CON, kết thúc khám & đóng hồ sơ).
// Mở hồ sơ con (như L6) -> tờ điều trị (xóa hết chẩn đoán, đặt Z38.0, hướng xử trí "Chích vaccin")
// -> Lưu -> F2 PK022 -> Đồng ý -> Lưu -> Đủ điều kiện tiêm chủng -> Xem chi tiết (MỞ TAB MỚI)
// -> phiếu sàng lọc dưới 1 tháng -> Lưu -> chỉ định vaccine (BCG liều 0.1 / VGB) -> Lưu
// -> Kết thúc khám -> Cho về -> Đồng ý -> Đóng hồ sơ -> Đồng ý -> ĐÓNG TAB THỪA.
// KHÔNG có điểm xác nhận: chạy tự động hết (theo yêu cầu bác sĩ).
import { type Page, type Locator } from 'playwright';
import { step, checkpoint, nhapSach, xacNhanPopupNeuCo, dongCanhBaoNeuCo } from './helpers.js';
import { moToDieuTri, setTextarea, pickAntSelect, luuToDieuTri, luuPhieuSangLoc } from './flow1.js';
import { timVaMoConTheoMaBA, setNgayGioLich, setChanDoan } from './luong6.js';

// Bật L7_STOP_AFTER_FORM=1 để DỪNG sau khi điền form (chưa Lưu gì) - dùng khi test lần đầu.
const STOP_AFTER_FORM = process.env.L7_STOP_AFTER_FORM === '1';

// Đọc thông báo lỗi validation của HIS (truyền dạng CHUỖI: esbuild chèn __name làm hỏng function).
const DOC_LOI_JS = `(() => {
  const out = [];
  const push = (t) => { t = (t || '').trim().replace(/\\s+/g, ' '); if (t && out.indexOf(t) < 0) out.push(t.slice(0, 140)); };
  document.querySelectorAll('.ant-form-item-explain-error, .ant-form-item-explain, .ant-message-error, .ant-message-notice, .ant-notification-notice-message, .ant-notification-notice-description').forEach((e) => push(e.textContent));
  document.querySelectorAll('.ant-form-item-has-error, .ant-select-status-error, .ant-input-status-error, [class*="has-error"]').forEach((e) => {
    const box = e.closest('.ant-row, .ant-form-item, div');
    push('TRUONG LOI: ' + ((box && box.textContent) || '').trim().slice(0, 70));
  });
  return out.slice(0, 12);
})()`;

export interface VaccineL7 {
  code: string;        // mã trong bảng (BCG0001 / VGB0002) - tick chính xác
  ten: string;         // tên hiển thị (BCG / VGB) - dò dòng "Đã chọn"
  lieuLuong?: string;  // ô "Liều lượng" (BCG = 0.1). Số lượng HIS tự để 1.
  duongDung: string;   // BCG "Tiêm trong da", VGB "Tiêm bắp"
}

export const VACCINE_L7: Record<string, VaccineL7> = {
  BCG: { code: 'BCG0001', ten: 'BCG', lieuLuong: '0.1', duongDung: 'Tiêm trong da' },
  VGB: { code: 'VGB0002', ten: 'VGB', duongDung: 'Tiêm bắp' },
};

// ---- Đọc tiêu đề cột + toạ độ X của bảng chứa dòng (DOM order ≠ thứ tự cột) ----
interface Cot { name: string; x: number; w: number }

async function docCotBang(row: Locator): Promise<Cot[]> {
  // antd bảng header cố định: <thead> nằm ở <table> RIÊNG với <tbody>.
  // -> thử table gần nhất trước, không có thì leo lên div gần nhất CÓ chứa thead.
  let ths = row.locator('xpath=ancestor::table[1]').locator('thead th');
  if (!(await ths.count())) {
    ths = row.locator('xpath=ancestor::div[.//thead][1]').locator('thead th');
  }
  const n = await ths.count();
  const cols: Cot[] = [];
  for (let i = 0; i < n; i++) {
    const name = ((await ths.nth(i).textContent().catch(() => '')) || '').trim();
    const bb = await ths.nth(i).boundingBox().catch(() => null);
    if (bb) cols.push({ name, x: bb.x, w: bb.width });
  }
  return cols;
}

// Điền ô nằm dưới cột có tiêu đề khớp `tenCot` (khớp theo toạ độ X, không đoán index).
async function dienOTheoCot(page: Page, row: Locator, cols: Cot[], tenCot: RegExp, val: string): Promise<void> {
  const col = cols.find((c) => tenCot.test(c.name));
  if (!col) {
    throw new Error(`Không thấy cột khớp ${tenCot}. Các cột hiện có: [${cols.map((c) => c.name || '(trống)').join(' | ')}]`);
  }
  const inputs = row.locator('input:not([type="checkbox"])');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const o = inputs.nth(i);
    const bb = await o.boundingBox().catch(() => null);
    if (!bb) continue;
    const cx = bb.x + bb.width / 2;
    if (cx < col.x || cx > col.x + col.w) continue; // ô này không thuộc cột cần điền
    for (let lan = 0; lan < 3; lan++) {
      await o.click();
      await o.press('Control+a');
      await o.press('Delete');
      await o.pressSequentially(val, { delay: 45 });
      await o.press('Tab');
      await page.waitForTimeout(350);
      if (((await o.inputValue().catch(() => '')) || '') === val) return;
    }
    throw new Error(`Ô cột "${col.name}" không giữ giá trị "${val}".`);
  }
  throw new Error(`Không thấy ô nhập nào nằm dưới cột "${col.name}".`);
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

// ---- Điền form tờ điều trị của CON ----
export async function dienFormLuong7(page: Page, ngay: string, gio: string): Promise<void> {
  await step(page, `Ngày y lệnh = ${ngay} ${gio}`, async () => {
    await setNgayGioLich(page, 'Ngày y lệnh', ngay, gio);
  });
  await datChanDoanZ380(page);
  await step(page, 'Diễn biến bệnh = "Bé hồng, khóc tốt"', async () => {
    await setTextarea(page, 'Diễn biến bệnh', 'Bé hồng, khóc tốt');
  });
  await step(page, 'Hướng xử trí = "Chích vaccin"', async () => {
    await setTextarea(page, 'Hướng xử trí', 'Chích vaccin');
  });
  await step(page, 'Chế độ chăm sóc = "Chế độ CS Cấp III"', async () => {
    await pickAntSelect(page, 'Chế độ chăm sóc', 'Chế độ CS Cấp III');
  });
}

// ---- F2 -> PK022 -> Đồng ý -> đóng cảnh báo -> Lưu ----
export async function chiDinhPK022(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: /Chỉ định dịch vụ kỹ thuật/i });

  await step(page, 'Mở hộp thoại chỉ định DVKT (F2)', async () => {
    await xacNhanPopupNeuCo(page, 800);
    const f2 = page.getByPlaceholder(/F2/i).first();
    await f2.scrollIntoViewIfNeeded();
    await f2.click();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });

  await step(page, 'Lọc & tick PK022', async () => {
    const s = dialog.getByPlaceholder(/Chọn dịch vụ/i).first();
    await nhapSach(page, s, 'PK022');
    await page.waitForTimeout(1800);
    const row = dialog.locator('.ant-row, tr, [class*="item"]').filter({ hasText: /PK022/i }).first();
    const box = row.locator('.ant-checkbox').first();
    if (await box.count()) await box.click();
    else await row.getByText(/PK022/i).first().click();
    await page.waitForTimeout(900);
    await xacNhanPopupNeuCo(page, 1200); // "nếu có thông báo thì bấm Xác nhận"
  }, { retries: 2 });

  await step(page, 'Bấm Đồng ý (PK022)', async () => {
    await dialog.getByRole('button', { name: /Đồng ý/i }).first().click();
    await page.waitForTimeout(2000);
    await xacNhanPopupNeuCo(page, 800);
  });

  await step(page, 'Đóng cảnh báo (nếu có)', async () => {
    await dongCanhBaoNeuCo(page);
  });

  await checkpoint(page, 'Trước khi Lưu chỉ định PK022');
  await step(page, 'Lưu (sau chỉ định PK022)', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(2500);
    await xacNhanPopupNeuCo(page, 800);
    await dongCanhBaoNeuCo(page);
  });
}

// ---- Đủ điều kiện tiêm chủng -> Xem chi tiết (mở TAB MỚI trang khám sàng lọc) ----
export async function moTrangKhamSangLoc(page: Page): Promise<Page> {
  await step(page, 'Bấm "Đủ điều kiện tiêm chủng"', async () => {
    await page.getByRole('button', { name: /Đủ điều kiện tiêm chủng/i }).first().click();
    await page.waitForTimeout(2000);
  });

  let sangLoc: Page = page;
  await step(page, 'Bấm "Xem chi tiết" -> mở trang khám sàng lọc', async () => {
    const btn = page.getByRole('button', { name: /Xem chi tiết/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    const ctx = page.context();
    const choTabMoi = ctx.waitForEvent('page', { timeout: 12000 }).catch(() => null);
    await btn.click();
    const tabMoi = await choTabMoi;
    if (tabMoi) {
      sangLoc = tabMoi;
      await sangLoc.waitForLoadState('domcontentloaded').catch(() => {});
    }
    await sangLoc.waitForTimeout(2500);
    if (!/kham-sang-loc/i.test(sangLoc.url())) {
      throw new Error(`Chưa vào được trang khám sàng lọc. URL=${sangLoc.url()}`);
    }
  }, { retries: 1 });
  return sangLoc;
}

// ---- Chỉ định vắc xin: tick mã, điền LIỀU LƯỢNG (theo tiêu đề cột) + đường dùng ----
export async function chiDinhVaccineL7(page: Page, vaccines: VaccineL7[]): Promise<void> {
  await step(page, 'Mở panel "Chỉ định vắc xin"', async () => {
    await page.getByText('Chỉ định vắc xin', { exact: false }).first().click();
    await page.getByPlaceholder(/Chọn vắc xin/i).first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });

  await step(page, 'Mở popup chọn vắc xin', async () => {
    await page.getByPlaceholder(/Chọn vắc xin/i).first().click();
    await page.getByRole('dialog').filter({ hasText: /Chỉ định vắc xin/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
  }, { retries: 2 });

  const popup = page.getByRole('dialog').filter({ hasText: /Chỉ định vắc xin/i });

  for (const v of vaccines) {
    await step(page, `Tick vắc xin ${v.ten} (${v.code})`, async () => {
      const row = popup.locator('tr.ant-table-row').filter({ hasText: v.code }).first();
      const cb = row.locator('.ant-checkbox-wrapper').first();
      await cb.waitFor({ state: 'visible', timeout: 15000 });
      await cb.click();
      await page.waitForTimeout(900);
      await xacNhanPopupNeuCo(page, 800);
    }, { retries: 2 });
  }

  for (const v of vaccines) {
    await step(page, `Thiết lập ${v.ten}: liều=${v.lieuLuong ?? 'mặc định'}, đường dùng=${v.duongDung}`, async () => {
      const row = popup.locator('tr.ant-table-row')
        .filter({ hasText: new RegExp('^\\s*' + v.ten, 'i') })
        .filter({ has: page.locator('input.ant-input-number-input, input[type="number"]') })
        .first();
      await row.scrollIntoViewIfNeeded();

      const cols = await docCotBang(row);
      console.log(`  ↳ Cột bảng "Đã chọn" (${v.ten}): ${cols.map((c) => c.name || '(trống)').join(' | ')}`);

      if (v.lieuLuong) await dienOTheoCot(page, row, cols, /Liều\s*lượng/i, v.lieuLuong);

      // Đường dùng: ant-select cuối dòng (list ảo -> gõ để lọc)
      const dd = row.locator('.ant-select').last();
      if (await dd.count()) {
        await dd.scrollIntoViewIfNeeded();
        await dd.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(v.duongDung, { delay: 30 });
        await page.waitForTimeout(900);
        const opt = page.locator('.ant-select-item-option', { hasText: new RegExp(v.duongDung, 'i') }).first();
        await opt.waitFor({ state: 'visible', timeout: 8000 });
        await opt.click();
        await page.waitForTimeout(500);
      }
    }, { retries: 2 });
  }

  await step(page, 'Bấm Đồng ý (đưa vắc xin vào phiếu)', async () => {
    await popup.getByRole('button', { name: /Đồng ý/i }).first().click();
    await page.waitForTimeout(2000);
    await xacNhanPopupNeuCo(page, 800);
  });
}

// Chọn option trong dropdown antd ĐANG MỞ (các dropdown đã đóng vẫn nằm trong DOM -> dễ click nhầm).
async function chonOptionDangMo(page: Page, re: RegExp): Promise<void> {
  const dd = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  const opt = dd.locator('.ant-select-item-option').filter({ hasText: re }).first();
  await opt.waitFor({ state: 'visible', timeout: 8000 });
  await opt.click();
}

// ---- Kết thúc khám -> Cho về -> Đồng ý -> Đóng hồ sơ -> Đồng ý ----
// Form "Kết thúc khám" nằm trong ant-popover (role=tooltip), KHÔNG phải ant-modal.
export async function ketThucKham(page: Page): Promise<void> {
  await step(page, 'Bấm "Kết thúc khám"', async () => {
    const btn = page.getByRole('button', { name: /Kết thúc khám/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await page.waitForTimeout(1200);
  }, { retries: 1 });

  await step(page, 'Hướng điều trị = "Cho về" -> Đồng ý', async () => {
    const huong = page.locator('#keyHuongDieuTri');
    await huong.waitFor({ state: 'visible', timeout: 15000 });
    await huong.click();
    await page.waitForTimeout(500);
    await huong.pressSequentially('Cho về', { delay: 30 }); // gõ lọc
    await page.waitForTimeout(900);
    await chonOptionDangMo(page, /Cho về/i);
    await page.waitForTimeout(800);

    const pop = page.locator('.ant-popover-inner-content').filter({ has: page.locator('#keyHuongDieuTri') }).last();
    await pop.getByRole('button', { name: /^\s*Đồng ý\s*$/i }).first().click();
    await page.waitForTimeout(2500);

    // Popover chưa đóng => còn trường bắt buộc (vd "Kết quả") -> liệt kê option để biết chọn gì.
    if (await page.locator('#keyHuongDieuTri').isVisible().catch(() => false)) {
      await page.locator('#keyKetQua').click().catch(() => {});
      await page.waitForTimeout(900);
      const ds = (await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
        .allTextContents()).map((s) => s.trim()).filter(Boolean);
      throw new Error('Popover "Kết thúc khám" chưa đóng - trường "Kết quả" (bắt buộc) chưa chọn. Option: '
        + (ds.length ? ds.slice(0, 15).join(' | ') : '(không đọc được)'));
    }
  });

  await step(page, 'Bấm "Đóng hồ sơ" -> Đồng ý', async () => {
    const btn = page.getByRole('button', { name: /Đóng hồ sơ/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await page.waitForTimeout(1200);
    // Xác nhận có thể là modal HOẶC popover
    const okModal = page.getByRole('dialog').getByRole('button', { name: /^\s*(Đồng ý|Xác nhận)\s*$/i }).first();
    const okPop = page.locator('.ant-popover-inner-content').getByRole('button', { name: /^\s*(Đồng ý|Xác nhận)\s*$/i }).first();
    if (await okModal.isVisible().catch(() => false)) await okModal.click();
    else if (await okPop.isVisible().catch(() => false)) await okPop.click();
    await page.waitForTimeout(2500);
  });
}

// ---- ORCHESTRATOR luồng 7 (tự động hết, KHÔNG dừng xác nhận) ----
export interface Flow7Data {
  maBA: string;         // Mã bệnh án MẸ
  ngay: string;         // DD/MM/YYYY
  gio: string;          // HH:mm:ss (user nhập)
  vaccines: VaccineL7[]; // BCG và/hoặc VGB
}

export async function chayLuong7(page: Page, data: Flow7Data): Promise<void> {
  if (!data.vaccines?.length) throw new Error('Chưa chọn vaccine nào.');
  const ctx = page.context();
  let sangLoc: Page | null = null;

  try {
    // 1-4) Mở hồ sơ CON + tạo tờ điều trị
    await timVaMoConTheoMaBA(page, data.maBA);
    await moToDieuTri(page);

    // 6-10) Điền form
    await dienFormLuong7(page, data.ngay, data.gio);

    if (STOP_AFTER_FORM) {
      await checkpoint(page, 'L7 DEBUG - đã điền form, CHƯA Lưu');
      throw new Error('DEBUG: dừng sau khi điền form (L7_STOP_AFTER_FORM=1). Chưa Lưu gì cả.');
    }

    // 11) Lưu tờ điều trị
    await luuToDieuTri(page);

    // Xác minh ĐÃ LƯU THẬT: nếu validation chặn, form vẫn ở "Thêm mới" và không có ô F2.
    // Đọc luôn thông báo lỗi của HIS để biết THIẾU TRƯỜNG NÀO (không đoán mò).
    await step(page, 'Kiểm tra tờ điều trị đã lưu', async () => {
      await page.waitForTimeout(1500);
      const loi = (await page.evaluate(DOC_LOI_JS).catch(() => [])) as string[];
      const daLuu = await page.getByPlaceholder(/F2/i).first()
        .waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
      if (!daLuu) {
        throw new Error('Tờ điều trị CHƯA lưu được. HIS báo: ' + (loi.length ? loi.join(' || ') : '(không đọc được thông báo lỗi)'));
      }
    });

    // 12-16) F2 -> PK022 -> Đồng ý -> đóng cảnh báo -> Lưu
    await chiDinhPK022(page);

    // 17-18) Đủ điều kiện tiêm chủng -> Xem chi tiết (mở tab mới)
    sangLoc = await moTrangKhamSangLoc(page);

    // 19) Phiếu sàng lọc dưới 1 tháng tuổi -> Lưu
    await luuPhieuSangLoc(sangLoc, 'dưới 1 tháng tuổi');

    // 20) Chỉ định vaccine -> Lưu
    await chiDinhVaccineL7(sangLoc, data.vaccines);
    await checkpoint(sangLoc, 'Trước khi Lưu chỉ định vắc xin');
    await step(sangLoc, 'Lưu chỉ định vắc xin', async () => {
      await sangLoc!.getByRole('button', { name: /^Lưu$/i }).last().click();
      await sangLoc!.waitForTimeout(2500);
      await xacNhanPopupNeuCo(sangLoc!, 800);
      await dongCanhBaoNeuCo(sangLoc!);
    });

    // 21) Kết thúc khám -> Cho về -> Đồng ý -> Đóng hồ sơ -> Đồng ý
    await ketThucKham(sangLoc);
    await checkpoint(sangLoc, 'Sau khi kết thúc khám & đóng hồ sơ');
  } finally {
    // Đóng MỌI tab thừa (kể cả khi lỗi giữa chừng) để không phình tab, nặng máy.
    for (const p of ctx.pages()) {
      if (p !== page && !p.isClosed()) await p.close().catch(() => {});
    }
  }
}
