# mdlz · My Experience — cấu trúc đo được, và behavior nên theo

Đo trực tiếp trên DOM sống, 2026-08-08, draft `R-172396` (Procurement Manager,
Indirect Vietnam), step 2/5. Mọi dòng dưới đây là **quan sát**, không suy luận.
Phần "behavior" là hệ quả rút ra từ cấu trúc, viết tách bạch để không lẫn với
dữ liệu.

---

## 0. Bức tranh chung

Step **My Experience** chứa 5 section, mỗi section có nút **Add Another**
riêng (đo được 4 nút `add-button` hiển thị cùng lúc):

```
My Experience
├── Work Experience   (repeating, có Delete mỗi row)
├── Education         (repeating)
├── Languages         (repeating)
├── Skills            (single field, multi-value bằng chips)
└── Resume/CV         (file upload)
```

**Hệ quả #1 — quan trọng nhất:** ba trong năm section là **repeating**. Không
có khái niệm "field Work From" ở step này; chỉ có "Work From **của row nào**".
Mọi định danh phẳng (label, selector đơn) đều mơ hồ ngay từ thiết kế.

---

## 1. Work Experience — một row

Container: `DIV`, chứa đúng các field sau (đo trên row 1):

| Field | `data-automation-id` | Control thật |
|---|---|---|
| Job Title | `formField-jobTitle` | `INPUT:text` |
| Company | `formField-companyName` | `INPUT:text` |
| Location | `formField-location` | `INPUT:text` |
| I currently work here | `formField-currentlyWorkHere` | `INPUT:checkbox` |
| From | `formField-startDate` | **2 × `INPUT:text` `role=spinbutton`**: `dateSectionMonth-input`, `dateSectionYear-input` |
| To | `formField-endDate` | giống From — **biến mất khỏi DOM khi "currently work here" được tick** |
| Role Description | `formField-roleDescription` | `TEXTAREA` |

Nút trong row: **`Calendar`** (mở month/year picker) và **`Delete`** (xoá row).

### Sự thật đo được về date

| Cách ghi | Kết quả |
|---|---|
| `KeyboardEvent` tổng hợp (content script) | **không ghi được gì** — `value=""`, `aria-valuenow=null` |
| CDP `insertText` | không ghi được gì |
| CDP keydown thật (người gõ) | ghi được |
| **Calendar picker + click tổng hợp** | **ghi được và commit** |

- Tín hiệu commit **duy nhất đáng tin** là `aria-valuenow`. `.value` đọc rỗng
  cả khi giá trị đã committed → mọi verify dựa trên `.value` là verify giả.
- Picker: `[data-automation-id="dateIcon"]` mở panel → `UL` chứa 12 ô tháng
  (`div[role="button"]`, `aria-label="May 2026"`, ô đang chọn có tiền tố
  `"Selected "`) → điều hướng năm bằng `button[aria-label="Previous Year"|"Next Year"]`
  nằm ở panel cha của `UL`.
- Click vào icon nằm **ngoài màn hình** bị hit-test trúng phần tử khác → phải
  `scrollIntoView` trước khi click. (Cùng nguyên nhân với "Add Another không
  tạo row".)

### Behavior nên theo

1. **Date chỉ được ghi bằng picker.** Bỏ hẳn đường gõ tổng hợp cho
   `dateSection*` — nó chưa bao giờ ghi được, và mọi "filled" trước đây là
   Workday tự parse CV.
2. **Verify bằng `aria-valuenow`, đọc lại node mỗi lần.** Không giữ tham chiếu
   `monthEl`/`yearEl` qua các bước: Workday thay node khi re-render, verifier
   sẽ đọc xác chết và báo "chưa commit" cho giá trị đã commit.
3. **To là field có điều kiện.** Khi `currentlyWorkHere` được tick, `To` rời
   khỏi DOM — nên số ô `To` **không** bằng số row. Mọi ghép cặp theo index
   giữa hai danh sách toàn trang là sai ngay khi có một current role.
4. **Row phải có identity.** `title@company` là khoá tự nhiên (Job Title +
   Company đều bắt buộc), đủ để giữ đúng row qua re-render.
5. **Lỗi phải quy về row.** Workday chỉ nói `"The field From is required"`;
   biết nó thuộc row nào **chỉ có một cách**: đếm error node **bên trong
   container của row**. Không có cách nào khác, và đây là gốc của hiện tượng
   "cả 3 row cùng báo lỗi".

---

## 2. Education — một row

| Field | id | Control |
|---|---|---|
| School or University | `formField-schoolName` | `INPUT:text` |
| Degree | `formField-degree` | `BUTTON` `aria-haspopup=listbox` |

Field of Study / GPA **không có mặt** trên tenant này (recipe báo `absent` là đúng).

### Behavior nên theo

- Degree là listbox catalogue **theo ngành** ("B.B.A. - Bachelor of Business
  Administration or equivalent"), không có mục "Bachelor" chung → so khớp phải
  theo **subject**, và đây là field hợp lệ để hỏi model.
- Kết quả nên **cache theo `(CV degree + optionsHash)`** trong một run: hiện
  mỗi pass tốn ~9–11s cho một câu trả lời không đổi.

---

## 3. Languages — một row

| Field | id | Control |
|---|---|---|
| Language | `formField-language` | `BUTTON{listbox}` |
| I am fluent in this language | `formField-native` | `INPUT:checkbox` |
| Overall | `formField-<GUID>` ← **id ngẫu nhiên theo tenant** | `BUTTON{listbox}` |

### Behavior nên theo

1. **Overall không có automation-id ổn định** → phải định vị bằng **label
   trong container của row**, không bằng selector toàn trang.
2. Cả ba field đều thuộc **cùng một row**; đọc theo index qua ba truy vấn
   riêng là nguyên nhân đo được của "mất English + tick No".
3. **Tick và Overall đều bị Workday nuốt sau re-hydrate** → cần verify lại sau
   khi section settle, và verify đó phải đọc **trong row**.

---

## 4. Skills — một field, nhiều giá trị

| | |
|---|---|
| Wrapper | `formField-skills` |
| Control | `INPUT:text` (gõ để search) |
| Kết quả | popup portal, không nằm trong wrapper |
| Giá trị đã chọn | `selectedItemList` chứa các `selectedItem` (chips) — đo được 10 chip |
| Xoá chip | `DELETE_charm` (DIV bọc `svg`) bên trong chip — **`.click()` thường vô tác dụng**, cần chuỗi pointer/mouse đầy đủ |

### Behavior nên theo

1. **Chip là nguồn sự thật.** Đủ chip ⇒ **không chạm** vào ô search (hiện mỗi
   pass gõ lại 8 term để kết luận "already", ~39–44s).
2. **Kiểm danh tính chip vừa thêm.** Virtualiser tái sử dụng node hàng, nên
   node vừa match có thể đã là skill khác lúc click → phải **re-resolve theo
   label sau khi scroll**, và chip vừa xuất hiện phải đúng thứ đã xin (đã đo
   được các chip lạ: "Agentforce", "Agile Systems", "Agentic AI").
3. Chip có sẵn từ trước **không được đụng** — có thể là dữ liệu ứng viên tự
   thêm ở đơn khác.

---

## 5. Ba luật rút ra cho toàn step

1. **Một field, một owner — và owner là SECTION, không phải label.**
   Repeating section thì đơn vị nhỏ nhất có nghĩa là *row*, không phải *field*.
   Mọi lớp khác (recovery, needs, planner) chỉ được **báo lỗi cho owner**,
   không được tự chạm DOM.

2. **Định danh phải sống sót re-render.** Node không sống sót (Workday thay),
   nên khoá phải là dữ liệu: `title@company` cho Work Experience, tên ngôn ngữ
   cho Languages, text chip cho Skills. Đọc lại node ngay trước mỗi lần dùng.

3. **Tín hiệu commit khác nhau theo widget — và không cái nào là `.value`.**

   | Widget | Commit signal |
   |---|---|
   | date section | `aria-valuenow` |
   | listbox (Language, Degree, Overall) | text trên button / chip |
   | skills | chip trong `selectedItemList` |
   | checkbox | `.checked` **cộng với** không còn error trong row |

   Verify sai tín hiệu là nguồn gốc của cả hai loại lỗi đã gặp: báo hỏng cho
   field đã đúng, và báo xong cho field còn trống.

---

## 6. Điều còn chưa đo (không được đoán)

- **Row mới có sống sót qua Save không.** Đo được: thêm row + chọn date bằng
  picker thành công, 0 lỗi. Chưa đo: bấm Save ngay sau đó, row 3 còn không.
  Đây là phép đo phân định giữa *"agent ghi sai"* và *"Workday không nhận row
  mới"* — và là việc đầu tiên nên làm.
- **Error node nằm ở đâu khi lỗi đang sống.** Draft lúc đo đã sạch (2 row,
  0 lỗi), nên chưa chụp được cấu trúc DOM của error trong trạng thái hỏng.
