// LUỒNG 4: Đánh toa xuất viện (kê đơn thuốc ra viện).
// Dữ liệu combo/thuốc mã hóa theo note (mã thuốc, số lượng, liều, cách dùng).
import { type Page } from 'playwright';
import { step, checkpoint, nhapSach } from './helpers.js';
import { chonKhoaLamViec, setNgayGio, moTrangHIS } from './flow1.js';
import { config } from './config.js';

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

    // Reset bộ lọc cũ (SPA hay kẹt kết quả trước) bằng nút "Hủy tìm kiếm" nếu có
    const huy = page.getByRole('button', { name: /Hủy tìm kiếm/i }).first();
    if (await huy.isVisible().catch(() => false)) {
      await huy.click();
      await page.waitForTimeout(1200);
    }

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

export interface ThuocRaVien {
  ma: string;             // mã thuốc để gõ tìm (vd 03EN0095)
  ten: string;            // tên hiển thị để nhận dòng "Đã chọn"
  nguon: 'kho' | 'nha-thuoc'; // Thuốc kho / Thuốc nhà thuốc
  slSang?: string;        // Sl sáng
  slToi?: string;         // Sl tối
  soLuong: string;        // Số lượng
  cachDungThem?: string;  // nối thêm vào SAU text cách dùng có sẵn (vd "khi đói")
  cachDung?: string;      // ghi đè cách dùng (vd "Rửa ngoài âm hộ")
}

// Bảng thuốc (theo RULE trong note)
export const THUOC: Record<string, ThuocRaVien> = {
  enpovid:   { ma: '03EN0095', ten: 'enpovid',    nguon: 'kho',       slSang: '1', slToi: '1', soLuong: '10', cachDungThem: 'khi đói' },
  phytogyno: { ma: '06PH0001', ten: 'phytogyno',  nguon: 'kho',       soLuong: '1', cachDung: 'Rửa ngoài âm hộ' },
  orenko:    { ma: '08OR0001', ten: 'orenko',     nguon: 'kho',       slSang: '1', slToi: '1', soLuong: '10' },
  curam:     { ma: '08CU0046', ten: 'curam',      nguon: 'kho',       slSang: '1', slToi: '1', soLuong: '10' },
  nextgcal:  { ma: 'THNEX001', ten: 'Next Gcal',  nguon: 'nha-thuoc', slSang: '2', soLuong: '60' },
  felnosat:  { ma: 'THFEL001', ten: 'Felnosat',   nguon: 'nha-thuoc', slSang: '1', slToi: '1', soLuong: '60', cachDungThem: 'khi đói' },
  gema04:    { ma: 'THGEM003', ten: 'Gemapaxane', nguon: 'nha-thuoc', soLuong: '6' }, // gemapaxane 0.4ml
  gema06:    { ma: 'THGEM002', ten: 'Gemapaxane', nguon: 'nha-thuoc', soLuong: '6' }, // gemapaxane 0.6ml
};

// Các combo user có thể chọn (nhiều combo cùng lúc). Combo 5 tách 2 option theo loại gema.
// Key = tên hiển thị trên UI (chip), value = danh sách key thuốc.
export const COMBO_CHON: Record<string, string[]> = {
  'Bổ Enpovid':        ['enpovid', 'phytogyno'],
  'Orenko':            ['orenko', 'enpovid', 'phytogyno'],
  'Curam':             ['curam', 'enpovid', 'phytogyno'],
  'Next':              ['nextgcal', 'felnosat'],
  'Next + Gema 0.4':   ['nextgcal', 'felnosat', 'gema04'],
  'Next + Gema 0.6':   ['nextgcal', 'felnosat', 'gema06'],
};

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

// Từ các combo user chọn -> danh sách thuốc (dedupe theo key thuốc).
export function buildDanhSachThuoc(comboNames: string[]): ThuocRaVien[] {
  const keys: string[] = [];
  for (const name of comboNames) {
    for (const k of (COMBO_CHON[name] || [])) if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((k) => THUOC[k]).filter(Boolean);
}

// ---- Các bước thao tác trên form đơn thuốc ra viện ----

// Kiểm tra "đã có đơn -> dừng" (theo note) rồi tạo tờ nếu chưa có.
// Chờ đúng trạng thái (nút Tạo HOẶC form đã mở) rồi mới quyết -> tránh race báo nhầm "đã có".
export async function taoToDonThuoc(page: Page): Promise<void> {
  await step(page, 'Kiểm tra & Tạo tờ điều trị đơn thuốc ra viện', async () => {
    const taoBtn = page.getByRole('button', { name: /Tạo tờ điều trị đơn thuốc ra viện/i }).first();
    const formField = page.getByPlaceholder(/Chọn thuốc/i).first();
    // Chờ 1 trong 2: nút Tạo (chưa có đơn) HOẶC ô Chọn thuốc (đã có đơn/form đang mở)
    await Promise.race([
      taoBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
      formField.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(500);
    if (await taoBtn.isVisible().catch(() => false)) {
      await taoBtn.click(); // chưa có đơn -> tạo mới
      await formField.waitFor({ state: 'visible', timeout: 15000 });
    } else if (await formField.isVisible().catch(() => false)) {
      // Đã có đơn thuốc (form hiện sẵn) -> DỪNG (theo note, tránh kê trùng)
      throw new Error('ĐÃ CÓ đơn thuốc ra viện cho bệnh nhân này -> dừng luồng (theo note).');
    } else {
      throw new Error('Không xác định được trạng thái màn Đơn thuốc ra viện (web chưa load?).');
    }
  });
}

// Set Ngày y lệnh = ngay + 17:00:00 (theo note luồng 4)
export async function setNgayYLenhDonThuoc(page: Page, ngay: string): Promise<void> {
  await step(page, `Ngày y lệnh = ${ngay} 17:00:00`, async () => {
    await setNgayGio(page, 'Ngày y lệnh', `${ngay} 17:00:00`);
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

// Chọn & điền tất cả thuốc trong hộp thoại "Chỉ định thuốc" rồi Đồng ý.
export async function chonThuoc(page: Page, thuocList: ThuocRaVien[]): Promise<void> {
  await step(page, 'Mở hộp thoại chọn thuốc [F2]', async () => {
    await page.getByPlaceholder(/Chọn thuốc/i).first().click();
    await page.getByRole('dialog').filter({ hasText: /Chỉ định thuốc/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1000);
  }, { retries: 2 });

  const dialog = page.getByRole('dialog').filter({ hasText: /Chỉ định thuốc/i });

  // Nhóm theo nguồn: kho trước (section 0, mặc định), rồi nhà thuốc (thêm section 1)
  const sapXep = [...thuocList].sort((a, b) => (a.nguon === 'kho' ? 0 : 1) - (b.nguon === 'kho' ? 0 : 1));
  let daThemNhaThuoc = false;

  for (const t of sapXep) {
    // Section kho = ô tìm thứ 0; section nhà thuốc = ô tìm thứ 1 (sau khi thêm)
    const sectionIdx = t.nguon === 'kho' ? 0 : 1;
    if (t.nguon === 'nha-thuoc' && !daThemNhaThuoc) {
      await step(page, 'Thêm nguồn "Thuốc nhà thuốc"', async () => {
        await doiNguon(page, dialog, true);
      }, { retries: 2 });
      daThemNhaThuoc = true;
    }

    await step(page, `Tick thuốc ${t.ten} (${t.ma})`, async () => {
      // Gõ vào ô tìm CỦA ĐÚNG SECTION (kho=nth0, nhà thuốc=nth1) - nhập SẠCH + verify
      const s = dialog.getByPlaceholder(/Nhập tên thuốc/i).nth(sectionIdx);
      await nhapSach(page, s, t.ma);
      await page.waitForTimeout(2000);
      const row = dialog.locator('tr.ant-table-row').filter({ hasText: t.ma }).first();
      await row.locator('.ant-checkbox-wrapper').first().waitFor({ state: 'visible', timeout: 12000 });
      await row.locator('.ant-checkbox-wrapper').first().click();
      await page.waitForTimeout(1000);
      // Popup cảnh báo "đã được chỉ định ... Tiếp tục chỉ định thêm?" -> Xác nhận (theo note)
      const canhBao = page.getByRole('dialog').filter({ hasText: /Tiếp tục chỉ định thêm|Cảnh báo/i });
      if (await canhBao.isVisible().catch(() => false)) {
        await canhBao.getByRole('button', { name: /Xác nhận/i }).first().click();
        await page.waitForTimeout(1000);
      }
    }, { retries: 2 });

    await step(page, `Điền ${t.ten}: SL=${t.soLuong}${t.slSang ? ', sáng ' + t.slSang : ''}${t.slToi ? ', tối ' + t.slToi : ''}`, async () => {
      // Dòng trong panel "Đã chọn" = dòng có tên thuốc VÀ có ô nhập (không phải checkbox)
      const row = dialog.locator('tr.ant-table-row')
        .filter({ hasText: new RegExp(t.ten, 'i') })
        .filter({ has: page.locator('input:not([type="checkbox"])') })
        .first();
      // Sắp xếp các ô theo TOẠ ĐỘ X (DOM order khác thứ tự cột!) -> điền theo hạng cột:
      // rank 0=Số ngày, 1=Sl sáng, 2=Sl chiều, 3=Sl tối, 4=Sl đêm, 5=Số lượng, 6=SL sơ cấp, 7=Cách dùng
      const oList = row.locator('input:not([type="checkbox"]), textarea');
      const n = await oList.count();
      const boxes: { i: number; x: number }[] = [];
      for (let i = 0; i < n; i++) {
        const bb = await oList.nth(i).boundingBox().catch(() => null);
        boxes.push({ i, x: bb ? bb.x : 999999 });
      }
      boxes.sort((a, b) => a.x - b.x);
      const oTheoCot = (rank: number) => oList.nth(boxes[rank].i);

      // Điền chắc: click -> xóa -> gõ từng ký tự -> Tab (commit). Verify + điền lại nếu trống.
      const setO = async (rank: number, val: string) => {
        const o = oTheoCot(rank);
        for (let lan = 0; lan < 2; lan++) {
          await o.click();
          await o.press('Control+a');
          await o.press('Delete');
          await o.pressSequentially(val, { delay: 50 });
          await o.press('Tab');
          await page.waitForTimeout(400);
          if ((await o.inputValue().catch(() => '')) === val) return;
        }
      };
      // Điền LIỀU trước (HIS tự tính Số lượng = liều×Số ngày), rồi Số lượng CUỐI để ĐÈ lại
      // đúng giá trị note yêu cầu (vd enpovid liều 1+1 nhưng Số lượng chỉ 10).
      if (t.slSang) await setO(1, t.slSang);
      if (t.slToi) await setO(3, t.slToi);
      await setO(5, t.soLuong);
      await page.waitForTimeout(300);
      // Cách dùng = rank 7
      if (boxes.length > 7) {
        const cd = oTheoCot(7);
        if (t.cachDung) {
          await cd.fill(t.cachDung);
        } else if (t.cachDungThem) {
          const cur = (await cd.inputValue().catch(() => '')) || '';
          await cd.fill((cur.trim() + ' ' + t.cachDungThem).trim());
        }
        await page.waitForTimeout(200);
      }
    }, { retries: 2 });
  }

  await step(page, 'Bấm Đồng ý [F4] (đưa thuốc vào đơn)', async () => {
    await dialog.getByRole('button', { name: /Đồng ý/i }).first().click();
    await page.waitForTimeout(2000);
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
  ngay: string;        // DD/MM/YYYY (giờ mặc định 17:00:00)
  combos: string[];    // tên combo user chọn (COMBO_CHON keys)
}

// Luồng 4: đánh toa xuất viện. Theo note: KHÔNG cần điểm xác nhận - cứ Lưu hoàn thành.
export async function chayLuong4(page: Page, data: Flow4Data): Promise<void> {
  const thuoc = buildDanhSachThuoc(data.combos);
  if (!thuoc.length) throw new Error('Chưa chọn combo thuốc nào.');

  await moBenhNhanTheoMaBA(page, data.maBA);
  await moTabDonThuocRaVien(page);
  await taoToDonThuoc(page);              // dừng nếu đã có đơn
  await setNgayYLenhDonThuoc(page, data.ngay);
  await chonThuoc(page, thuoc);
  await checkpoint(page, 'Đơn thuốc trước khi Lưu');
  await luuDonThuoc(page);
}
