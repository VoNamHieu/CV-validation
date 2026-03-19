# Plan: Nâng cấp Extension thành Agent tự động thực sự

## Tổng quan kiến trúc mới

Chuyển từ **"1-shot auto-filler"** sang **"Agentic Loop"**:

```
┌─────────────────────────────────────────────────────┐
│                   AGENT LOOP                         │
│                                                      │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐       │
│   │ OBSERVE  │──▶│  PLAN    │──▶│   ACT    │       │
│   │ (snapshot│   │ (LLM     │   │ (execute │       │
│   │  DOM)    │   │  decides)│   │  action) │       │
│   └────▲─────┘   └──────────┘   └────┬─────┘       │
│        │                              │              │
│        └──────────────────────────────┘              │
│              repeat until DONE                       │
└─────────────────────────────────────────────────────┘
```

Thay vì extract tất cả fields 1 lần → gửi LLM → fill hết, agent sẽ:
1. **Observe**: Chụp snapshot DOM hiện tại (visible elements, form state, errors, page structure)
2. **Plan**: Gửi snapshot + profile + action history cho LLM → LLM trả về **1 action tiếp theo**
3. **Act**: Thực hiện action (scroll, click, fill, select, upload, wait...)
4. **Loop**: Quay lại Observe, kiểm tra kết quả, tiếp tục cho đến khi LLM trả `DONE`

---

## Phase 1: Agent Core Loop (`content-agent.js` refactor)

### 1.1 Thêm `observePage()` — Snapshot DOM thông minh

Thay thế `extractFormFields()` bằng `observePage()` toàn diện hơn:

```js
function observePage() {
  return {
    url: location.href,
    title: document.title,
    // Visible form fields (có scroll vào view)
    formFields: extractVisibleFields(),
    // Buttons hiện tại (Apply, Next, Submit, Upload...)
    buttons: extractButtons(),
    // Error messages / validation
    errors: extractErrors(),
    // Detect modals, dialogs
    modals: detectModals(),
    // File upload inputs
    fileInputs: detectFileInputs(),
    // Current step indicator nếu có
    stepIndicator: detectStepIndicator(),
    // Page scroll position
    scrollInfo: {
      scrollTop: document.documentElement.scrollTop,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      hasMore: (document.documentElement.scrollHeight - document.documentElement.scrollTop - document.documentElement.clientHeight) > 100,
    },
  };
}
```

### 1.2 Thêm các action executors mới

Ngoài `fill`, `select`, `click` hiện tại, thêm:

| Action | Mô tả |
|--------|--------|
| `scroll_down` | Scroll xuống 500px để tìm thêm fields |
| `scroll_to` | Scroll đến element cụ thể |
| `click_button` | Click button (Next, Submit, Apply...) |
| `custom_select` | Handle React Select / custom dropdown |
| `date_pick` | Handle date picker (fill input + trigger) |
| `upload_file` | Trigger file upload input |
| `wait` | Chờ N ms (form loading, modal opening...) |
| `type_search` | Gõ text vào searchable dropdown rồi chọn option |
| `DONE` | Agent kết thúc, hiện confirmation |

### 1.3 Agentic Loop chính

```
runAgentLoop(profile):
  history = []
  maxSteps = 20  // safety limit

  for step in 1..maxSteps:
    observation = observePage()

    action = await callLLM(observation, profile, history)

    if action.type === 'DONE':
      showConfirmation()
      break

    result = await executeAction(action)
    history.push({ step, observation_summary, action, result })

    await sleep(500)  // để page update
```

---

## Phase 2: Nâng cấp LLM API (`/api/ai/map-form/route.ts`)

### 2.1 Tạo endpoint mới: `/api/ai/agent-step`

Endpoint mới nhận **observation + history** và trả về **1 action duy nhất**:

**Input:**
```json
{
  "observation": { /* observePage() output */ },
  "profile": { /* user profile */ },
  "history": [ /* previous steps */ ],
  "goal": "Fill and submit job application form"
}
```

**Output:**
```json
{
  "thought": "Form has 3 visible fields. I see a Next button, this is a multi-step form. Let me fill step 1 first.",
  "action": {
    "type": "fill",
    "selector": "#firstName",
    "value": "Nguyễn Văn A"
  }
}
```

### 2.2 System prompt cho Agent LLM

Prompt hướng dẫn LLM suy nghĩ theo bước:
- Phân tích observation: đang ở bước nào, có error không, form đã fill gì chưa
- Quyết định 1 action tiếp theo (không phải toàn bộ)
- Biết khi nào cần scroll, khi nào cần click Next, khi nào DONE
- Nhận diện custom UI components và cách tương tác

---

## Phase 3: Smart DOM Interaction

### 3.1 Custom Dropdown Handler

```js
async function handleCustomSelect(selector, searchText) {
  // 1. Click vào dropdown trigger
  // 2. Chờ option list xuất hiện
  // 3. Tìm option matching searchText
  // 4. Click option
  // 5. Nếu có search input, gõ text trước
}
```

Detect patterns:
- `.react-select__control` → React Select
- `[class*="MuiAutocomplete"]` → MUI
- `[class*="ant-select"]` → Ant Design
- `[role="combobox"]` → Generic ARIA combobox
- `[role="listbox"]` → Generic listbox

### 3.2 Scroll Strategy

```js
async function scrollToFindMore() {
  // Scroll down 500px
  // Wait 500ms for lazy-loaded content
  // Re-extract fields
  // Compare with previous extraction
}
```

### 3.3 File Upload

```js
async function triggerFileUpload(selector, fileUrl) {
  // Option 1: Nếu profile có CV file URL → fetch blob → set vào input
  // Option 2: Nếu có DataTransfer API → simulate drag & drop
  // Option 3: Chỉ highlight input và thông báo user cần upload thủ công
}
```

### 3.4 Modal/iframe Detection

```js
function detectModals() {
  // Tìm visible modals: [role="dialog"], .modal.show, [class*="modal"]
  // Tìm iframes chứa form: iframe[src*="apply"], iframe[src*="form"]
  // Nếu có iframe → cần inject script vào iframe (manifest permission)
}
```

---

## Phase 4: Error Recovery

### 4.1 Detect Validation Errors

```js
function extractErrors() {
  // Tìm error messages: .error, .invalid-feedback, [class*="error"], [role="alert"]
  // Tìm fields có class invalid/error
  // Trả về cho LLM để nó quyết định sửa
}
```

### 4.2 Action Result Verification

Sau mỗi fill action, verify:
- Field value đã đúng chưa (so sánh value thực tế)
- Có validation error mới xuất hiện không
- Nếu sai → thêm vào history, LLM sẽ biết và retry

---

## Phase 5: Cập nhật Background & Communication

### 5.1 Background.js

- Thêm handler cho message type `PROXY_AGENT_STEP` (proxy cho endpoint mới)
- Tăng timeout batch từ 60s → 120s (vì agent loop cần nhiều thời gian hơn)
- Thêm progress detail hơn (step X/Y, action history)

### 5.2 Manifest.json

- Nếu cần vào iframe: thêm `"all_frames": true` cho content script
- Nếu cần download CV file: thêm permission `downloads`

---

## Thứ tự triển khai

| # | Task | File changes | Priority |
|---|------|-------------|----------|
| 1 | Tạo `/api/ai/agent-step` endpoint | `frontend/src/app/api/ai/agent-step/route.ts` | **P0** |
| 2 | Refactor `content-agent.js` → agentic loop | `extension/content-agent.js` | **P0** |
| 3 | Thêm `observePage()` với scroll, buttons, errors | `extension/content-agent.js` | **P0** |
| 4 | Thêm action executors (scroll, custom_select, wait) | `extension/content-agent.js` | **P0** |
| 5 | Update background.js proxy cho endpoint mới | `extension/background.js` | **P1** |
| 6 | Custom dropdown detection & interaction | `extension/content-agent.js` | **P1** |
| 7 | File upload handling | `extension/content-agent.js` | **P1** |
| 8 | Modal/iframe detection | `extension/content-agent.js` | **P2** |
| 9 | Update manifest cho iframe support | `extension/manifest.json` | **P2** |
| 10 | Tăng batch timeout + progress detail | `extension/background.js` | **P2** |

---

## Giới hạn & Rủi ro

- **Token cost**: Mỗi step gọi LLM 1 lần → 20 steps = 20 API calls. Cần optimize observation size.
- **Speed**: Agentic loop chậm hơn 1-shot. Mỗi step ~3-5s (LLM call + action + wait).
- **Safety**: Agent có thể click sai button. Cần có `maxSteps` limit và blacklist actions (không auto-submit payment forms).
- **iframe CORS**: Một số iframe cross-origin sẽ không truy cập được DOM. Fallback: thông báo user.
