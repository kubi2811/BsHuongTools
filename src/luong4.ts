// LUỒNG 4: Đánh toa xuất viện (kê đơn thuốc ra viện).
// Dữ liệu combo/thuốc mã hóa theo note (mã thuốc, số lượng, liều, cách dùng).
// Phần thao tác HIS (selector) ở dưới - sẽ hoàn thiện sau khi dò với 1 Mã Bệnh án test.

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

// Từ các combo user chọn -> danh sách thuốc (dedupe theo key thuốc).
export function buildDanhSachThuoc(comboNames: string[]): ThuocRaVien[] {
  const keys: string[] = [];
  for (const name of comboNames) {
    for (const k of (COMBO_CHON[name] || [])) if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((k) => THUOC[k]).filter(Boolean);
}
