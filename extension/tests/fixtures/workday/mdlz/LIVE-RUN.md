# mdlz v2 — quy trình chạy live (M4)

Ba milestone đầu chứng minh trên **harness dựng từ đo đạc**. Cách đó đúng với
những gì đã đo, và **không nói được gì về những gì chưa đo**. Milestone 4 là
phép đo thật, và nó bắt đầu bằng một lần **ĐỌC** — lần chạm đầu tiên vào một đơn
ứng tuyển thật không được phép là một lần ghi.

> **M5 đã thu hẹp phần phải đo.** Hai giả định trước đây (`input.files.length`
> và "nút Add nằm trong container của row") giờ dựa trên **chuỗi của chính
> Workday** — đọc từ bundle `compiled-lang/{cxs_apply_flow,generic}/en-US.json`
> mà apply flow tự tải (HAR 2026-08-04, asset dùng chung cho mọi tenant). Thứ
> **chưa** đo được là: chiến lược tìm section **theo tiêu đề** có đúng trên DOM
> thật không. Đó là câu hỏi số một của bước 2.

---

## 0. Ba mức của cờ

`chrome.storage.local.copoMdlzV2`

| Giá trị | v2 làm gì | v1 làm gì |
|---|---|---|
| *(không có)* / `false` | không gì cả | điền như hiện tại |
| `'dry'` | đọc trang, in bảng, **không ghi, không nhận trang** | điền như hiện tại |
| `true` | nhận trang khi đủ điều kiện, điền, verify | chỉ chạy khi v2 trả trang lại |

Đặt cờ (console của **extension context**, không phải context của trang):

```js
chrome.storage.local.set({ copoMdlzV2: 'dry' });   // bước 1
chrome.storage.local.set({ copoMdlzV2: true  });   // bước 3, chỉ sau khi bước 2 sạch
chrome.storage.local.remove('copoMdlzV2');         // tắt hẳn
```

---

## 1. Bước 1 — dry run trên draft thật

1. Mở một job mdlz thật, đi tới **My Experience** (draft cũ cũng được, không cần
   tạo đơn mới).
2. Bật cờ `'dry'`.
3. Chạy agent một pass như bình thường (⚡ / `copoStep()`), **hoặc** gọi thẳng:

   ```js
   await copoMdlzPreflight()
   ```

4. Copy phần trace `mdlz.preflight` + `mdlz.preflight.field` trong console.

Trang **không bị đụng** ở bước này: v1 vẫn điền đúng như hôm nay, v2 chỉ đọc.

---

## 2. Hai câu hỏi phép đo này sinh ra để trả lời

Đây là hai chỗ code đang **đoán theo hướng an toàn**. Cả hai đều nằm sẵn trong
bảng preflight:

### 2.1 `resume:` — tín hiệu "CV đã đính kèm"

Dòng đọc như: `resume: attached via [filename-on-page,input.files] (input=yes, files=1, filenameKnown=true)`

Ba tín hiệu, hỏi độc lập, **báo hết**:

| Tín hiệu | Là gì | Độ bền |
|---|---|---|
| `filename-on-page` | tên file CV xuất hiện trên trang (section Resume/CV liệt kê file đã upload) | bền nhất, sống qua re-render |
| `upload-confirmation` | chuỗi `"Successfully Uploaded!"` (`APPLY.FILE.Virus_Scan_Successful` trong bundle của Workday) | có thể chỉ là khoảnh khắc |
| `input.files` | `input.files.length > 0` | giả định ban đầu, giờ chỉ là một trong ba |

| Đọc được gì | Nghĩa là | Phải làm gì |
|---|---|---|
| `attached via [...]` có ≥1 tín hiệu | đủ để v2 nhận trang | đi tiếp bước 3 |
| `NOT attached via [nothing]` **sau khi v1 upload xong** | cả ba tín hiệu đều sai trên tenant này | ghi lại DOM quanh vùng Resume/CV rồi thêm tín hiệu thứ tư |
| `filenameKnown=false` | không có `cvData.fileName` để so | tín hiệu bền nhất đang không dùng được — kiểm tra đường truyền cvData |
| `input=absent` mà vẫn `attached` | trang tự nói có file dù không có input | bình thường |

### 2.2 `sections:` — nút Add của từng section

Đọc dòng `sections: work:2r/2e/add=rows education:0r/1e/add=heading languages:1r/1e/add=NO`
và `addButtonsOnPage: N`.

Hai cách xác định, ghi rõ cách nào đã dùng:

| `add=` | Nghĩa là |
|---|---|
| `rows` | tìm qua container của row có sẵn — đường chắc nhất |
| `heading` | tìm qua **tiêu đề section** ("Work Experience"/"Education"/"Languages" — chuỗi của chính Workday). **Đường này CHƯA từng chạy trên trang thật** → đây là thứ quan trọng nhất cần xác nhận ở bước 2 |
| `NO` | không xác định được → planner báo gap, v2 trả trang lại (an toàn) |

**Cách kiểm `heading` đúng hay sai:** section 0 row mà báo `add=heading` thì
sang bước 3, xem row mới có mọc **đúng section đó** không. Mọc nhầm section =
chiến lược heading sai trên tenant này → phải bỏ, quay về chỉ dùng `rows`.

### 2.3 Những thứ khác đáng đọc trong bảng

- `unknownWidgets:` — field nào v2 **không có capability**. Phải rỗng trước khi
  bật `true`; mỗi cái tên ở đây là một widget cần đo rồi thêm capability.
- `wouldWrite` / `alreadyRight` — đối chiếu bằng mắt với trang: field nào bảng
  nói "already right" mà trên màn hình đang trống thì **verify đang nói dối**,
  và đó là lỗi nghiêm trọng nhất trong toàn hệ (M2 tồn tại để chặn đúng nó).
- `orphans:` — phải là `0` khi không có list nào đang mở.
- Từng dòng `mdlz.preflight.field`: `kind` có đúng loại widget không (date phải
  là `date`, Skills phải là `searchMulti`, Degree/Language phải là `listbox`).

---

## 3. Bước 3 — chạy thật, trên draft không quan trọng

Chỉ khi bảng ở bước 2 sạch:

1. `chrome.storage.local.set({ copoMdlzV2: true })`
2. Chạy trên **một draft không định nộp**, và đọc trace:
   - `mdlz.plan` — bao nhiêu task, bao nhiêu add
   - `mdlz.sched.task` — từng field: result, số lần retry, có leak popup không
   - `mdlz.sched.leak` — phải **không xuất hiện**
   - `mdlz.pass` — `filled` / `satisfied` / `failed` / `halted`
3. **Pass thứ hai** trên cùng trang đó: `filled` phải là `0` và mọi field
   `SATISFIED` — đây chính là gate M3, đo trên trang thật.
4. Đối chiếu từng field trên màn hình với `mdlz.field.verify`. Bất kỳ chỗ nào
   verdict ≠ thực tế là một **verdict sai** → ghi lại `kind`, `signal`, giá trị
   thật, rồi sửa capability tương ứng.

---

## 4. Nếu có gì sai

- v2 lỗi giữa chừng → router bắt exception, **v1 nhận lại pass đó**. Trang không
  bị kẹt.
- Muốn dừng ngay: `chrome.storage.local.remove('copoMdlzV2')` rồi F5.
- Không có gì được ghi ra ngoài trang: preflight chỉ đọc DOM và in ra console.

---

## 5. Sau khi đo xong

Mọi con số đọc được ở bước 2–3 thuộc về repo, không thuộc về một cuộc chat:

- Số nào **trái** với giả định → sửa code + ghi phép đo vào comment ngay chỗ sửa.
- Widget nào mới → thêm fixture vào `tests/fixtures/workday/mdlz/` theo schema
  trong `../README.md` (sửa fixture cho test xanh là nước đi bị cấm).
- Pathology nào mới → thêm vào `tests/harness/hostile-page.js` **và**
  `hostile-widget.html`, kèm dòng đo được nó.
