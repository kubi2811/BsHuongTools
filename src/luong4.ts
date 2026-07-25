// LUỒNG 4: Đánh toa xuất viện (kê đơn thuốc ra viện) - cơ chế "bộ chỉ định" (toa có sẵn).
// Chọn toa (Toa enpovid/orenko/curam/next MH) -> HIS tự nạp thuốc -> chỉ chỉnh "Số ngày".
import { type Page } from 'playwright';
import { step, checkpoint, nhapSach, dongCanhBaoNeuCo, xacNhanPopupNeuCo, bamLuu } from './helpers.js';
import { chonKhoaLamViec, setNgayGio, moTrangHIS, resetBoLocTimKiem } from './flow1.js';
import { docCotBang, dienOTheoCot } from './luong7.js';
import { config } from './config.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Chọn ngày trên ô antd DatePicker readonly (vd "Từ ngày", placeholder "Chọn thời điểm").
// QUAN TRỌNG: các date-picker đã đóng vẫn để lại dropdown ẨN trong DOM -> phải giới hạn thao
// tác vào dropdown ĐANG MỞ (:not(.ant-picker-dropdown-hidden)), nếu không .first() trúng ô ẩn.
async function chonNgayAntd(page: Page, nhan: string, ngay: string): Promise<void> {
  const [dd, mm, yyyy] = ngay.split('/').map((s) => s.trim());
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const picker = page.getByText(nhan, { exact: false }).first()
    .locator('xpath=following::div[contains(@class,"ant-picker")][1]');
  await picker.scrollIntoViewIfNeeded();
  await picker.click();
  const dd_ = page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)').last();
  await dd_.locator('.ant-picker-cell-in-view').first().waitFor({ state: 'visible', timeout: 8000 });
  for (let i = 0; i < 60; i++) {
    const head = (await dd_.locator('.ant-picker-header-view').first().textContent().catch(() => '')) || '';
    const my = /([A-Za-z]{3,})\D*(\d{4})/.exec(head);
    if (!my) break;
    const curM = MONTHS.findIndex((x) => my[1].startsWith(x));
    const curY = Number(my[2]);
    if (curM === Number(mm) - 1 && curY === Number(yyyy)) break;
    const back = curY > Number(yyyy) || (curY === Number(yyyy) && curM > Number(mm) - 1);
    await dd_.locator(back ? '.ant-picker-header-prev-btn' : '.ant-picker-header-next-btn').first().click();
    await page.waitForTimeout(250);
  }
  await dd_.locator(`.ant-picker-cell-in-view[title="${iso}"]`).first().click();
  await page.waitForTimeout(400);
  const got = (await picker.locator('input').first().inputValue().catch(() => '')) || '';
  if (!got.includes(ngay)) console.warn(`  ⚠️  "${nhan}" hiển thị "${got}" chưa khớp ${ngay}.`);
}

// Mở bệnh nhân theo MÃ BỆNH ÁN (duy nhất). CÓ VERIFY đúng BN (an toàn - không thao tác nhầm).
// SPA hay kẹt kết quả tìm kiếm cũ -> phải Hủy tìm kiếm reset, gõ chắc, và verify lại.
// Gộp tất cả vào 1 step tự điều hướng lại mỗi lần retry (mạng yếu / cache).
export async function moBenhNhanTheoMaBA(page: Page, maBA: string): Promise<void> {
  const listUrl = config.hisUrl.replace(/\/$/, '') + '/quan-ly-noi-tru/danh-sach-nguoi-benh-noi-tru';

  await step(page, `Tìm & mở BN theo Mã BA = ${maBA} (có verify an toàn)`, async () => {
    // Điều hướng lại danh sách (fresh mỗi lần thử) - tự đăng nhập lại nếu session hết hạn
    await moTrangHIS(page, listUrl);
    await page.waitForTimeout(1000);
    await chonKhoaLamViec(page);

    // Reset TOÀN BỘ bộ lọc cũ (xóa cả ô TÊN dính từ luồng 1 lẫn mã cũ) -> tránh lọc chồng
    await resetBoLocTimKiem(page);

    // Gõ vào Ô RIÊNG "Mã bệnh án" (lọc chính xác theo mã BA duy nhất) - nhập SẠCH + verify
    const s = page.getByPlaceholder(/^Mã bệnh án$/i).first();
    await nhapSach(page, s, maBA);
    await page.waitForTimeout(300);
    await s.press('Enter');
    await page.waitForTimeout(3000); // chờ kết quả cập nhật

    // Mở dòng đầu
    await page.locator('tr.ant-table-row').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // AN TOÀN: bắt buộc thấy đúng số Mã BA trên hồ sơ (dùng attached, không đòi visible).
    let dung = false;
    try {
      await page.getByText(maBA, { exact: false }).first().waitFor({ state: 'attached', timeout: 8000 });
      dung = true;
    } catch {
      dung = (await page.content().catch(() => '')).includes(maBA); // fallback: quét HTML
    }
    if (!dung) throw new Error(`Mở NHẦM bệnh nhân - không thấy Mã BA ${maBA} trên hồ sơ. Dừng an toàn.`);
  }, { retries: 3 });
}

// 1 "bộ chỉ định" (toa có sẵn trong HIS). Chọn toa -> HIS tự nạp thuốc; ta chỉ chỉnh "Số ngày".
export interface Toa {
  boChiDinh: RegExp;                       // text option trong dropdown "Chọn bộ chỉ định"
  nguon: 'kho' | 'nha-thuoc';              // toa nằm ở nguồn Kho hay Nhà thuốc
  soNgay: { match: RegExp; ngay: string }[]; // chỉnh "Số ngày" của thuốc khớp `match`
}

// Tên hiển thị (chip UI) -> định nghĩa toa. (option thật trong HIS đều chữ thường "toa ... MH")
export const TOA: Record<string, Toa> = {
  'Enpovid': {
    boChiDinh: /toa enpovid MH/i, nguon: 'kho',
    soNgay: [{ match: /enpovid/i, ngay: '5' }, { match: /phytogyno|vệ sinh/i, ngay: '1' }],
  },
  'Orenko': {
    boChiDinh: /toa orenko MH/i, nguon: 'kho',
    soNgay: [{ match: /orenko/i, ngay: '5' }, { match: /enpovid/i, ngay: '5' }, { match: /phytogyno|vệ sinh/i, ngay: '1' }],
  },
  'Curam': {
    boChiDinh: /toa curam MH/i, nguon: 'kho',
    soNgay: [{ match: /curam/i, ngay: '5' }, { match: /enpovid/i, ngay: '5' }, { match: /phytogyno|vệ sinh/i, ngay: '1' }],
  },
  'Cefa': {
    boChiDinh: /toa cefa MH/i, nguon: 'kho',
    soNgay: [{ match: /cefa/i, ngay: '3' }, { match: /enpovid/i, ngay: '5' }, { match: /phytogyno|vệ sinh/i, ngay: '1' }],
  },
  'Next': {
    boChiDinh: /toa next MH/i, nguon: 'nha-thuoc',
    soNgay: [{ match: /next.*cal|g\s*cal/i, ngay: '30' }, { match: /felnosat/i, ngay: '30' }],
  },
  'Next + Gema 0,4': {
    boChiDinh: /toa next gema 0[,.]4 MH/i, nguon: 'nha-thuoc',
    soNgay: [
      { match: /next.*cal|g\s*cal/i, ngay: '30' },
      { match: /felnosat/i, ngay: '30' },
      { match: /gemapaxane/i, ngay: '6' },
    ],
  },
  'Cefimed': {
    boChiDinh: /toa cefimed MH/i, nguon: 'nha-thuoc',
    soNgay: [
      { match: /next.*cal|g\s*cal/i, ngay: '30' },
      { match: /felnosat/i, ngay: '30' },
      { match: /imexime/i, ngay: '5' },
    ],
  },
};

export const TOA_NAMES = Object.keys(TOA); // cho UI (multiselect)

// Mở tab "Đơn thuốc ra viện" (tab=9) của hồ sơ đang mở, bằng URL cho chắc chắn.
export async function moTabDonThuocRaVien(page: Page): Promise<void> {
  await step(page, 'Mở tab "Đơn thuốc ra viện"', async () => {
    const url = page.url().split('?')[0] + '?tab=9';
    await moTrangHIS(page, url);
    await page.waitForTimeout(1000);
    // Chờ khu vực đơn thuốc load (nút Tạo hoặc thông báo "Chưa tạo")
    await page.getByText(/đơn thuốc ra viện/i).first().waitFor({ state: 'visible', timeout: 15000 });
  }, { retries: 2 });
}

// ---- Các bước thao tác trên form đơn thuốc ra viện ----

// Vào đơn thuốc ra viện: nếu ĐÃ CÓ đơn cũ -> Xóa (đơn cũ có thể nhập sai) -> Đồng ý -> tạo lại.
// Chờ đúng trạng thái (nút Tạo HOẶC form đã mở) rồi mới quyết -> tránh race.
export async function taoToDonThuoc(page: Page): Promise<void> {
  await step(page, 'Vào đơn thuốc (xóa đơn cũ nếu có) & tạo tờ mới', async () => {
    const taoBtn = page.getByRole('button', { name: /Tạo tờ điều trị đơn thuốc ra viện/i }).first();
    const formField = page.getByPlaceholder(/Chọn thuốc/i).first();
    // Chờ 1 trong 2: nút Tạo (chưa có đơn) HOẶC ô Chọn thuốc (đã có đơn/form đang mở)
    await Promise.race([
      taoBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
      formField.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(500);

    // ĐÃ CÓ đơn (form hiện, chưa có nút Tạo) -> XÓA đơn cũ rồi tạo lại.
    if (!(await taoBtn.isVisible().catch(() => false)) && (await formField.isVisible().catch(() => false))) {
      await step(page, 'Xóa đơn thuốc ra viện cũ', async () => {
        const xoaBtn = page.getByRole('button', { name: /^\s*Xóa\s*$/i }).first();
        await xoaBtn.waitFor({ state: 'visible', timeout: 10000 });
        await xoaBtn.click();
        // Popup "Xoá dữ liệu - Bạn có chắc chắn muốn xóa Đơn thuốc ra viện?" -> Đồng ý
        const dlg = page.getByRole('dialog').filter({ hasText: /Đơn thuốc ra viện|Xoá dữ liệu/i }).first();
        await dlg.waitFor({ state: 'visible', timeout: 10000 });
        await dlg.getByRole('button', { name: /Đồng ý/i }).first().click();
        await page.waitForTimeout(2500);
        await xacNhanPopupNeuCo(page, 800);
        // Sau khi xóa -> nút "Tạo tờ điều trị đơn thuốc ra viện" xuất hiện lại
        await taoBtn.waitFor({ state: 'visible', timeout: 15000 });
      });
    }

    // Chưa có đơn (hoặc vừa xóa xong) -> bấm Tạo.
    if (await taoBtn.isVisible().catch(() => false)) {
      await taoBtn.click();
      await formField.waitFor({ state: 'visible', timeout: 15000 });
    } else if (!(await formField.isVisible().catch(() => false))) {
      throw new Error('Không xác định được trạng thái màn Đơn thuốc ra viện (web chưa load?).');
    }
  });
}

// Set Ngày y lệnh = ngay + 08:00:00 (theo quy trình bác sĩ)
export async function setNgayYLenhDonThuoc(page: Page, ngay: string): Promise<void> {
  await step(page, `Ngày y lệnh = ${ngay} 08:00:00`, async () => {
    await setNgayGio(page, 'Ngày y lệnh', `${ngay} 08:00:00`);
  });
}

// Cộng thêm 1 ngày cho chuỗi "DD/MM/YYYY".
function cong1Ngay(ngay: string): string {
  const [d, m, y] = ngay.split('/').map((s) => Number(s.trim()));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

// "Số ngày cho đơn" = 5 (ô textarea số) và "Từ ngày" = Ngày y lệnh + 1 (ô chọn ngày - lịch antd).
// "Từ ngày" LUÔN tự tính, bác sĩ không phải nhập.
export async function setSoNgayVaTuNgay(page: Page, ngay: string): Promise<void> {
  await step(page, 'Số ngày cho đơn = 5', async () => {
    const ta = page.getByText(/Số ngày cho đơn/i).first().locator('xpath=following::textarea[1]');
    await ta.click();
    await ta.press('Control+a');
    await ta.press('Delete');
    await ta.pressSequentially('5', { delay: 40 });
    await ta.press('Tab');
    await page.waitForTimeout(300);
  });
  const tuNgay = cong1Ngay(ngay);
  await step(page, `Từ ngày = ${tuNgay} (Ngày y lệnh + 1)`, async () => {
    await chonNgayAntd(page, 'Từ ngày', tuNgay);
  });
}

// Đổi nguồn thuốc (Thuốc Kho / Thuốc nhà thuốc) trong hộp thoại
async function doiNguon(page: Page, dialog: ReturnType<Page['getByRole']>, nhaThuoc: boolean): Promise<void> {
  // Dropdown nguồn = ant-select đang hiển thị "Thuốc Kho"/"Thuốc nhà thuốc" (KHÔNG phải "Chọn gói dịch vụ")
  const sel = dialog.locator('.ant-select').filter({ hasText: /Thuốc Kho|Thuốc nhà thuốc/i }).first();
  await sel.click();
  await page.waitForTimeout(600);
  const opt = nhaThuoc ? /^Thuốc nhà thuốc$/i : /^Thuốc kho$/i;
  await page.locator('.ant-select-item-option', { hasText: opt }).first().click();
  await page.waitForTimeout(1500);
}

// Chọn các "bộ chỉ định" (toa) trong hộp thoại "Chỉ định thuốc" rồi chỉnh Số ngày, Đồng ý.
export async function chonBoChiDinh(page: Page, toaKeys: string[]): Promise<void> {
  await step(page, 'Mở hộp thoại chọn thuốc [F2]', async () => {
    await page.getByPlaceholder(/Chọn thuốc/i).first().click();
    await page.getByRole('dialog').filter({ hasText: /Chỉ định thuốc/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1000);
  }, { retries: 2 });

  const dialog = page.getByRole('dialog').filter({ hasText: /Chỉ định thuốc/i });

  // Toa KHO trước, rồi toa NHÀ THUỐC (đổi nguồn 1 lần).
  const toas = toaKeys.map((k) => ({ key: k, def: TOA[k] })).filter((t) => t.def);
  const sapXep = [...toas].sort((a, b) => (a.def!.nguon === 'kho' ? 0 : 1) - (b.def!.nguon === 'kho' ? 0 : 1));
  let daDoiNhaThuoc = false;

  for (const { key, def } of sapXep) {
    if (def!.nguon === 'nha-thuoc' && !daDoiNhaThuoc) {
      await step(page, 'Đổi nguồn "Thuốc nhà thuốc"', async () => {
        await doiNguon(page, dialog, true);
      }, { retries: 2 });
      daDoiNhaThuoc = true;
    }

    await step(page, `Chọn bộ chỉ định: ${key}`, async () => {
      // Mở dropdown "Chọn bộ chỉ định" và chọn đúng toa
      const boSel = dialog.locator('.ant-select').filter({ hasText: /bộ chỉ định/i })
        .or(dialog.getByText(/Chọn bộ chỉ định/i).locator('xpath=ancestor::*[contains(@class,"ant-select")][1]')).first();
      await boSel.scrollIntoViewIfNeeded();
      await boSel.click();
      await page.waitForTimeout(800);
      const opt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
        .filter({ hasText: def!.boChiDinh }).first();
      await opt.waitFor({ state: 'visible', timeout: 8000 });
      await opt.click();
      await page.waitForTimeout(2000);
      // Cảnh báo "thuốc đã được chỉ định..." -> Xác nhận
      await xacNhanPopupNeuCo(page, 1500);
      await page.waitForTimeout(1500);
      // Chờ thuốc ĐẦU TIÊN của toa render ra bảng Đã chọn (có ô nhập) trước khi chỉnh số ngày
      await dialog.locator('tr.ant-table-row')
        .filter({ hasText: def!.soNgay[0].match })
        .filter({ has: page.locator('input:not([type="checkbox"])') })
        .first().waitFor({ state: 'visible', timeout: 15000 });
    }, { retries: 2 });

    // Chỉnh "Số ngày" cho từng thuốc trong toa (khớp theo tên thuốc, điền theo tiêu đề cột)
    for (const sn of def!.soNgay) {
      await step(page, `Số ngày (${key}) [${sn.match.source}] = ${sn.ngay}`, async () => {
        const row = dialog.locator('tr.ant-table-row')
          .filter({ hasText: sn.match })
          .filter({ has: page.locator('input:not([type="checkbox"])') })
          .first();
        await row.waitFor({ state: 'visible', timeout: 12000 });
        await row.scrollIntoViewIfNeeded();
        const cols = await docCotBang(row);
        await dienOTheoCot(page, row, cols, /Số ngày/i, sn.ngay);
      }, { retries: 2 });
    }
  }

  await step(page, 'Bấm Đồng ý [F4] (đưa thuốc vào đơn)', async () => {
    await dialog.getByRole('button', { name: /Đồng ý/i }).first().click();
    await page.waitForTimeout(2000);
    await xacNhanPopupNeuCo(page, 800);
    await dongCanhBaoNeuCo(page);
  });
}

// HIS báo "Thời gian thực hiện DV phải nhỏ hơn thời gian chuyển khoa, ra viện" khi hồ sơ ĐÃ có
// thời gian ra viện sớm hơn ngày y lệnh của đơn. Trả true nếu đang có thông báo đó.
async function coLoiThoiGianRaVien(page: Page): Promise<boolean> {
  const txt = await page.locator('.ant-message, .ant-notification, [class*="toast"]')
    .allTextContents().catch(() => [] as string[]);
  return txt.some((t) => /thời gian thực hiện DV phải nhỏ hơn/i.test(t));
}

// Xóa "Thời gian ra viện" trong Thông tin chung > Tổng kết ra viện, rồi Lưu.
// (Theo quy trình bác sĩ: gặp lỗi trên thì xóa mốc ra viện đi rồi kê toa lại.)
export async function xoaThoiGianRaVien(page: Page): Promise<void> {
  const urlHoSo = page.url().split('?')[0];

  await step(page, 'Mở Thông tin chung > Tổng kết ra viện', async () => {
    await moTrangHIS(page, urlHoSo + '?tab=0');
    await page.waitForTimeout(1500);
    const muc = page.getByText(/Tổng kết ra viện/i).first();
    await muc.waitFor({ state: 'visible', timeout: 15000 });
    await muc.scrollIntoViewIfNeeded();
    // Bấm icon bút chì (sửa) nằm cạnh tiêu đề "Tổng kết ra viện"
    const khoi = muc.locator('xpath=ancestor::div[contains(@class,"ant-row") or contains(@class,"ant-col")][1]');
    const but = khoi.locator('.anticon-edit, svg[data-icon="edit"]').first();
    if (await but.count()) await but.click();
    else await muc.locator('xpath=following::*[name()="svg"][1]').click();
    await page.waitForTimeout(1500);
  }, { retries: 2 });

  await step(page, 'Xóa hết "Thời gian ra viện"', async () => {
    const o = page.getByText(/Thời gian ra viện/i).first()
      .locator('xpath=following::input[1]');
    await o.waitFor({ state: 'visible', timeout: 10000 });
    // Ô ngày antd hay có nút "x" xóa nhanh; không có thì xóa bằng bàn phím.
    const wrap = o.locator('xpath=ancestor::div[contains(@class,"ant-picker")][1]');
    const nutXoa = wrap.locator('.ant-picker-clear').first();
    if (await nutXoa.count()) {
      await wrap.hover();
      await nutXoa.click({ force: true });
    } else {
      await o.click();
      await o.press('Control+a');
      await o.press('Delete');
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(600);
    const conLai = ((await o.inputValue().catch(() => '')) || '').trim();
    if (conLai) throw new Error(`Chưa xóa được "Thời gian ra viện" (còn "${conLai}").`);
  }, { retries: 2 });

  await step(page, 'Lưu tổng kết ra viện', async () => {
    await bamLuu(page);
    await xacNhanPopupNeuCo(page, 1000);
    await dongCanhBaoNeuCo(page);
  });
}

// Lưu đơn thuốc ra viện (nút Lưu góc phải form)
export async function luuDonThuoc(page: Page): Promise<void> {
  await step(page, 'Bấm Lưu đơn thuốc ra viện', async () => {
    await page.getByRole('button', { name: /^Lưu$/i }).last().click();
    await page.waitForTimeout(2500);
  });
}

// ---- ORCHESTRATOR luồng 4 ----
export interface Flow4Data {
  maBA: string;
  ngay: string;    // DD/MM/YYYY (giờ y lệnh auto 08:00:00)
  toa: string[];   // tên toa user chọn (TOA keys: Enpovid/Orenko/Curam/Next)
}

// Luồng 4: đánh toa xuất viện bằng bộ chỉ định. KHÔNG có điểm xác nhận - cứ Lưu hoàn thành.
export async function chayLuong4(page: Page, data: Flow4Data): Promise<void> {
  if (!data.toa?.length) throw new Error('Chưa chọn toa (bộ chỉ định) nào.');

  await moBenhNhanTheoMaBA(page, data.maBA);

  // Kê toa. Nếu HIS báo "Thời gian thực hiện DV phải nhỏ hơn thời gian chuyển khoa, ra viện"
  // -> xóa Thời gian ra viện ở Tổng kết ra viện rồi kê lại (theo quy trình bác sĩ), thử tối đa 2 lần.
  for (let lan = 0; lan < 2; lan++) {
    await moTabDonThuocRaVien(page);
    await taoToDonThuoc(page);            // có đơn cũ -> xóa rồi tạo lại
    await setNgayYLenhDonThuoc(page, data.ngay);
    await setSoNgayVaTuNgay(page, data.ngay);
    await chonBoChiDinh(page, data.toa);

    if (!(await coLoiThoiGianRaVien(page))) break;
    if (lan === 1) throw new Error('Vẫn báo "Thời gian thực hiện DV phải nhỏ hơn thời gian ra viện" sau khi đã xóa thời gian ra viện. Dừng an toàn.');
    console.log('  ⚠️  HIS báo lỗi thời gian ra viện -> xóa Thời gian ra viện rồi kê toa lại.');
    await xoaThoiGianRaVien(page);
  }

  await checkpoint(page, 'Đơn thuốc trước khi Lưu');
  if (process.env.L4_STOP_BEFORE_LUU === '1') {
    throw new Error('DEBUG: dừng trước Lưu (L4_STOP_BEFORE_LUU=1). Đơn CHƯA được Lưu.');
  }
  await luuDonThuoc(page);
}
