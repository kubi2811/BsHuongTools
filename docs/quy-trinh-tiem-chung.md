# Quy trình 1 — Chích vaccine (selector thật đã dò)

> Tài liệu Phase 0: URL + selector THẬT lấy từ HIS BV Từ Dũ (ISOFH).
> Nguyên tắc: **id là GUID ngẫu nhiên → KHÔNG dùng id**. Dùng placeholder / role / text / nhãn.

## Đăng nhập
- URL: `https://bvtudu.tudu.com.vn/`
- Auto-login được (form thường, KHÔNG captcha/OTP tại thời điểm dò). Tài khoản để trong `.env` (không commit).
- Sau đăng nhập, ở trang Danh sách nội trú xuất hiện popup **"Chọn khoa làm việc"**
  (role=dialog) → combobox ant-select + nút "Lưu". Chọn "Khoa Sản N2".
  Popup chỉ hiện lần đầu mỗi phiên (được nhớ sau đó).

## Các trang & selector

| Bước | URL / Selector | Ghi chú |
|---|---|---|
| Danh sách nội trú | `/quan-ly-noi-tru/danh-sach-nguoi-benh-noi-tru` | Điều hướng bằng URL. **Param `?tenNb=` KHÔNG tự tìm** (SPA) |
| Ô tìm bệnh nhân | `getByPlaceholder(/Tìm.*tên NB/)` | Gõ "CB + tên" → Enter |
| Mở hồ sơ con | `getByText(/^CB /)` | Dòng bắt đầu "CB" = con |
| Chi tiết BN | `/chi-tiet-nguoi-benh-noi-tru/<id>` | id do HIS sinh |
| Tab tờ điều trị | `getByText('Tờ điều trị, chỉ định')` | menu trái |
| Tạo/Thêm tờ | button `Tạo tờ điều trị mới` (chưa có) / `Thêm mới` (đã có) | 2 case |
| Form tờ điều trị | `/to-dieu-tri/them-moi` | |

### Điền form tờ điều trị (locator tương đối theo nhãn — xpath following)
- **Ngày y lệnh / Ngày khám**: `input[placeholder="Chọn thời gian"]` sau nhãn.
  Set `DD/MM/YYYY 08:00:00` (giờ mặc định 08:00:00, bác sĩ chỉ nhập ngày).
- **Diễn biến bệnh**: textarea — mặc định đã có "Bé hồng, khóc tốt".
- **Hướng xử trí**: `textarea` sau nhãn → "Chích vaccin".
- **Chế độ chăm sóc**: `.ant-select` sau nhãn → option "Chế độ CS Cấp III".
- **Thời gian đi buồng**: date sau nhãn = ngày y lệnh.
- **Chẩn đoán / Bác sĩ**: tự điền sẵn (Z38, tài khoản đăng nhập).
- Nút **Lưu**: `getByRole('button',{name:/^Lưu$/}).last()` (góc phải).

## STAGE 2 — Chỉ định dịch vụ (ĐÃ CHẠY OK)
- Sau khi Lưu tờ điều trị THÀNH CÔNG → URL đổi thành
  `/chi-tiet-nguoi-benh-noi-tru/to-dieu-tri/<id>?tab=0` (editor có bảng Chỉ định dịch vụ).
- Ô **"Tìm kiếm [F2]"**: `getByPlaceholder(/F2/)` → gõ `PK022` → hộp thoại
  "Chỉ định dịch vụ kỹ thuật" mở ra.
- Trong hộp thoại: ô `getByPlaceholder(/Chọn dịch vụ/)` gõ `PK022` để lọc →
  tick `.ant-checkbox` của dòng chứa mã → **Đồng ý** → cảnh báo tạm ứng thì **Đóng** → **Lưu**.
- Lỗi hay gặp: "Thời gian Y lệnh phải lớn hơn thời gian vào khoa" (ngày y lệnh quá sớm);
  "Không được thêm mới tờ điều trị cùng thời gian y lệnh trong một khoa" (đã có tờ cùng ngày/giờ → dùng ngày khác hoặc mở tờ đã có).

## STAGE 3 — Khám sàng lọc (ĐÃ CHẠY OK)
- URL: `/quan-ly-tiem-chung/danh-sach-kham-sang-loc`.
- **BẮT BUỘC đặt "Ngày thực hiện" = Tất cả TRƯỚC khi tìm** (mặc định lọc theo hôm nay →
  record khác ngày bị ẩn, tìm ra rỗng). Cách: click `getByPlaceholder('Ngày thực hiện')`
  → dropdown preset hiện (Tất cả / Hôm nay / Hôm qua / 7 ngày trước / 30 ngày trước /
  Tháng hiện tại / Tháng trước / Tuỳ chọn) → click `getByText('Tất cả',{exact:true})`.
- Ô tìm: `getByPlaceholder(/Tìm mã tiêm chủng/)` → gõ "CB + tên" → Enter.
- Mở chi tiết: nếu ra NHIỀU record → ưu tiên dòng trạng thái **"Chờ khám"** rồi bấm "Gọi khám";
  nếu không có "Chờ khám" → dòng đầu, "Gọi khám" nếu có, không thì click `svg` đầu (icon xem).
  **KHÔNG click `.last()` — dễ trúng "Bỏ qua".**
- Chi tiết: `/quan-ly-tiem-chung/kham-sang-loc/<idBN>/<idSL>`. "Loại phiếu sàng lọc"
  thường đã sẵn "Bảng kiểm trước tiêm chủng đối với trẻ dưới 1 tháng tuổi..." → Lưu.

## STAGE 4 — Chỉ định vắc xin (ĐÃ CHẠY OK, DỪNG trước Lưu cuối)
- Menu trái "Chỉ định vắc xin" → panel có "Thêm chỉ định" → ô `getByPlaceholder(/Chọn vắc xin/)`
  → click mở **popup "Chỉ định vắc xin"** (bảng ant-table).
- Tick: `tr.ant-table-row` chứa **mã** (BCG0001/VGB0002) → click `.ant-checkbox-wrapper`.
- Panel "Đã chọn" (bảng phải): dòng theo tên (BCG/VGB) + có ô số lượng.
  - Số lượng: `input.ant-input-number-input`. BCG = 0.1 (HIS cảnh báo mềm "Không được chỉ
    định SL lẻ BCG" — bác sĩ tự quyết khi Lưu).
  - **Đường dùng**: ant-select searchable ở cột phải cùng → click → **GÕ để lọc** (list ảo)
    → chọn option. BCG "Tiêm trong da", VGB "Tiêm bắp".
- **Đồng ý** đưa vaccine vào phiếu. **DỪNG trước nút "Lưu" (góc phải)** — nút Lưu CUỐI của luồng.
- ⚠️ TUYỆT ĐỐI KHÔNG dùng `page.keyboard.press('Escape')` khi popup mở — Escape đóng cả ant-modal.

## Trạng thái build
- ✅ CẢ 4 STAGE CHẠY THẬT OK (headed), dừng đúng trước nút Lưu cuối cùng.
- Code: `src/flow1.ts` (các stage), `src/probe*.ts` (script dò/test từng stage).
