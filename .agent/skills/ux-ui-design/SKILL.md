---
name: ux-ui-design
description: Apply professional UX/UI design principles when working on interfaces. Use this skill when the task involves layout decisions, interaction design, visual hierarchy, information architecture, wireframing, design critique, component specification, or design system work — and the output must include a structural design artifact (flow, wireframe, spec, review, or token system). DO NOT trigger for pure performance engineering, growth strategy, analytics, or A/B test design without a visual interface component. Trigger for requests like "redesign this screen", "what's wrong with my layout", "create a wireframe", "review this UI", "build a design system", or "design the onboarding flow". If the deliverable is a visual or interaction artifact, use this skill.
---

# UX/UI Design Skill

Hướng dẫn thực thi UX/UI cho AI Agent — từ phân tích bối cảnh đến thiết kế có thể đo lường được trong môi trường product thực tế.

---

## Skill Boundaries (Scope Definition)

Skill này **owns**:
- Layout, visual hierarchy, information architecture
- Interaction design, user flows, wireframes
- Design critique và heuristic evaluation
- Design system, component specs, design tokens
- AI-native UX patterns

Skill này **delegates**:
- `frontend-design` — High-fidelity visual rendering, CSS/animation implementation
- Growth/strategy skill — Conversion funnel, A/B test design, metric strategy
- Data/analytics skill — Instrumentation setup, dashboard metrics

**Ranh giới rõ ràng**: Nếu câu hỏi là "thiết kế màn hình này trông như thế nào" → skill này. Nếu câu hỏi là "tôi nên track metric nào để tăng conversion" → không phải skill này. Nếu câu hỏi là "thiết kế màn hình này VÀ nó cần cải thiện conversion" → skill này + validation layer (Bước 9).

---

## Bước 0 — Chọn Execution Mode

**Trước khi làm bất cứ thứ gì**, xác định mode phù hợp. Mode quyết định phần nào của skill sẽ được dùng — bỏ qua phần còn lại.

```
MODE A — Discovery
  Khi: Vấn đề chưa rõ, cần hiểu user/context trước
  Dùng: Bước 1 (Context) + Bước 2a (User Flow)
  Bỏ qua: Design tokens, component anatomy, critique layers

MODE B — Structural Design
  Khi: Biết vấn đề, cần thiết kế cấu trúc/luồng
  Dùng: Bước 1 + Bước 2a + Bước 2b (Wireframe) + Bước 3 (UX principles)
  Bỏ qua: Design tokens chi tiết, critique framework

MODE C — Visual Refinement
  Khi: Có wireframe/flow rồi, cần nâng cấp visual quality
  Dùng: Bước 3 (Hierarchy, Cognitive Load) + Bước 5 (Design System) + delegate sang frontend-design
  Bỏ qua: User flow từ đầu, critique framework

MODE D — System Architecture
  Khi: Cần xây design system, component library, token system
  Dùng: Bước 5 (Design Tokens + Component Anatomy) + Bước 7 (A11y)
  Bỏ qua: Wireframe, user flow

MODE E — Critique Mode
  Khi: Có design sẵn, cần đánh giá / tìm lỗi
  Dùng: Bước 4 (5-layer review) + Bước 8 (Anti-patterns)
  Bỏ qua: Tất cả phần thiết kế từ đầu
```

Nếu không rõ mode → hỏi một câu duy nhất: *"Bạn đang ở giai đoạn nào — khám phá vấn đề, thiết kế cấu trúc, hay review design có sẵn?"*

---

## Bước 1 — Context Gathering (MODE A, B)

### 4 câu hỏi bắt buộc

| | Câu hỏi | Ví dụ trả lời |
|---|---|---|
| **Who** | Người dùng là ai? Trình độ, thiết bị, ngữ cảnh? | "Dev senior, desktop, dùng nhiều keyboard" |
| **What** | Job-to-be-done? Họ cần hoàn thành điều gì? | "Tạo PR và review code trong 1 flow" |
| **Why** | Mục tiêu business/product? KPI cần cải thiện? | "Tăng PR merge rate, giảm review time" |
| **Where** | Platform, viewport, integration context? | "Web app, 1280px+, tích hợp GitHub" |

### Constraint Discovery (bắt buộc — không bỏ qua)

Trước khi thiết kế, hỏi hoặc assume constraints:

```
Tech constraints:    Legacy codebase? Component library đang dùng? Build time budget?
Brand constraints:   Brand guidelines? Màu/font không được thay đổi?
Legal constraints:   GDPR? Accessibility law? Medical/fintech compliance?
Timeline:            Ship trong 1 sprint? MVP hay full redesign?
Backward compat:     Có user quen với layout hiện tại không? Migration path?
Performance budget:  Load time target? Bundle size limit?
```

**AI Agent rule**: Đừng đề xuất redesign greenfield nếu chưa biết constraints. Thiết kế trong constraint thực tế, không phải môi trường lý tưởng.

### Vertical Mode — Chọn ngữ cảnh ngành

```
fintech / banking   → Nhấn mạnh: trust signals, compliance labels, risk clarity,
                       confirmation steps, audit trail visibility
healthcare          → Nhấn mạnh: error prevention tối đa, liability reduction,
                       plain language, không để user guess về consequences
ai-native product   → Nhấn mạnh: AI transparency, confidence indicators,
                       editable outputs, fallback states (xem Bước 10)
enterprise saas     → Nhấn mạnh: information density, keyboard navigation,
                       bulk actions, power user shortcuts, role-based views
e-commerce          → Nhấn mạnh: trust, social proof, checkout friction reduction,
                       recovery flows cho abandoned cart
consumer mobile     → Nhấn mạnh: one-thumb reachability, gestural affordance,
                       instant feedback, offline resilience
```

---

## Bước 2 — Deliverable Selection

### 2a. User Flow / Information Architecture
**Khi nào**: "thiết kế luồng", "onboarding", "navigation structure", "IA"

Output format:
```
[Entry] → [Action] → [Decision Point]
                          ├── Yes → [Success / Next Step]
                          └── No  → [Error Recovery / Fallback]
```

Rules:
- Đếm số bước đến goal — mục tiêu luôn là ít hơn
- Phân biệt Happy Path / Edge Case / Error Path
- Ghi rõ: điều kiện chuyển state, data cần thiết tại mỗi bước

### 2b. Wireframe (Lo-fi)
**Khi nào**: Phác thảo layout, test ý tưởng nhanh

Rules:
- Grayscale only — không dùng màu thật
- Chú thích behaviour bên cạnh: *"click → modal", "scroll → sticky"*
- Dùng ASCII, HTML skeleton, hoặc SVG đơn giản
- Ưu tiên structure over aesthetics

### 2c. High-Fidelity UI
→ **Delegate sang `frontend-design` skill** sau khi wireframe được approve

Handoff checklist trước khi delegate:
```
✓ User flow đã xác nhận
✓ Wireframe key screens đã xong
✓ Design tokens (colors, spacing, typography) đã define
✓ Component states đã spec (hover, disabled, loading, error)
✓ Vertical mode đã chọn (fintech/SaaS/...)
```

### 2d. Component Specification
**Khi nào**: Dev cần build, design system cần document

Format chuẩn:
```
[ComponentName]
├── Variants:   primary | secondary | ghost | danger
├── Sizes:      sm | md | lg (height: 32 / 40 / 48px)
├── States:     default | hover | focus | active | disabled | loading | error
├── Props:      label, icon?, iconPosition?, isLoading?, isDisabled?
├── A11y:       role, aria-label, keyboard behavior
└── Behavior:   loading → spinner replaces label + prevent double-submit
                disabled → cursor: not-allowed, aria-disabled="true"
                error → red border + error message below
```

---

## Bước 3 — UX Principles (MODE B, C)

### 3.1 Visual Hierarchy
- Người dùng scan, không đọc — tổ chức theo **F-pattern** (content) hoặc **Z-pattern** (landing)
- **Một trang, một Primary CTA** — không có hai nút quan trọng ngang nhau
- Visual weight rule: `size > color > contrast > position`
- Typography minimum: 3 cấp độ rõ ràng (Heading / Subheading / Body)

### 3.2 Cognitive Load
- **Progressive disclosure**: chỉ hiện thông tin khi user cần
- **Chunking**: tối đa 5–7 items mỗi nhóm
- **Defaults thông minh**: pre-fill, smart suggestions, sensible fallbacks
- **Eliminate unnecessary choice**: system tự quyết được thì đừng hỏi user

### 3.3 Feedback & System Status
| Thời gian | Response |
|---|---|
| < 100ms | Instant — không cần indicator |
| 100ms – 1s | Optional subtle animation |
| 1s – 10s | Spinner + disable input |
| > 10s | Progress bar + estimated time + cancel option |

- Disabled state phải giải thích **tại sao** (tooltip hoặc helper text)
- Destructive actions phải có confirmation với consequence rõ ràng

### 3.4 Error Design
Thứ tự ưu tiên: **Prevent > Detect early > Recover gracefully**

Công thức error message:
```
[Cái gì sai] + [Tại sao] + [Cách fix]

❌ "Invalid input"
✅ "Số điện thoại không hợp lệ — Nhập đúng 10 chữ số, bắt đầu bằng 0 (vd: 0912345678)"
```

### 3.5 Pattern Recognition
Dùng familiar patterns trước khi sáng tạo. Người dùng không muốn học lại:
- Navigation: breadcrumb, tabs, sidebar, hamburger (đúng context)
- Data: table với sort/filter, pagination vs infinite scroll (có anchor)
- Feedback: toast (non-blocking), modal (blocking + important), inline (form)
- Semantic colors: đỏ = danger, xanh lá = success, vàng = warning — **không đảo**

---

## Bước 4 — Design Critique (MODE E)

Đánh giá theo 5 lớp, theo thứ tự này:

### Layer 1: Usability
```
[ ] User biết mình đang ở đâu trong hệ thống?
[ ] Primary action rõ ràng ngay lập tức?
[ ] Flow hoàn thành được mà không cần hướng dẫn?
[ ] Error states được handle không?
[ ] Có undo / go back / cancel không?
[ ] Empty states có hướng dẫn gì không?
```

### Layer 2: Visual Clarity
```
[ ] Contrast text/bg đạt WCAG AA (4.5:1 normal, 3:1 large/UI)?
[ ] Font size body >= 16px?
[ ] Tap targets >= 44x44px (mobile)?
[ ] Thông tin quan trọng nhất có nổi bật nhất không?
[ ] White space đủ để scan dễ không?
```

### Layer 3: Consistency
```
[ ] Spacing theo grid (4px/8px unit)?
[ ] Color palette nhất quán với design tokens?
[ ] Same action → same visual pattern toàn app?
[ ] Naming nhất quán? (không gọi cùng thứ 2 tên khác nhau)
[ ] Tone of voice nhất quán?
```

### Layer 4: Performance Perception
```
[ ] Loading states tồn tại (skeleton > spinner > blank)?
[ ] Optimistic UI cho actions phổ biến?
[ ] Transitions smooth, không jarring?
[ ] First Contentful Paint có meaningful content?
```

### Layer 5: Emotional Design
```
[ ] First impression tạo trust?
[ ] Success moments được celebrate (micro-delight)?
[ ] Tone phù hợp với audience (formal/friendly/technical)?
[ ] App "cảm giác" nhanh hay chậm?
```

**Output format của critique**: Mỗi lỗi ghi theo format:
```
[Layer] [Severity: Critical/Major/Minor] — Mô tả vấn đề → Đề xuất fix cụ thể
```

---

## Bước 5 — Design System (MODE C, D)

### Design Tokens

```css
/* SPACING — base 4px */
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-6: 24px;  --space-8: 32px;
--space-12: 48px; --space-16: 64px;

/* TYPOGRAPHY */
--text-xs: 12px; --text-sm: 14px; --text-base: 16px;
--text-lg: 18px; --text-xl: 20px; --text-2xl: 24px;
--text-3xl: 30px; --text-4xl: 36px;
--font-regular: 400; --font-medium: 500;
--font-semibold: 600; --font-bold: 700;
--leading-tight: 1.25; --leading-normal: 1.5;

/* SEMANTIC COLORS — không dùng hex trực tiếp */
--color-primary; --color-primary-hover; --color-primary-active;
--color-success; --color-warning; --color-danger;
--color-text-primary; --color-text-secondary; --color-text-disabled;
--color-bg-base; --color-bg-subtle; --color-bg-overlay;
--color-border; --color-border-focus;

/* RADIUS */
--radius-sm: 4px; --radius-md: 8px;
--radius-lg: 12px; --radius-full: 9999px;

/* ELEVATION */
--shadow-sm: 0 1px 2px rgba(0,0,0,.05);
--shadow-md: 0 4px 6px rgba(0,0,0,.07);
--shadow-lg: 0 10px 15px rgba(0,0,0,.1);

/* Z-INDEX */
--z-dropdown: 100; --z-sticky: 200;
--z-modal: 400; --z-toast: 500;
```

### Spacing Rules
- Related elements: 8px
- Between sections: 24–32px
- Card/container padding: 16–24px
- Screen edge margin: 16px (mobile) / 24px (tablet) / 32–64px (desktop)

---

## Bước 6 — Mobile-First Checklist (MODE B, C)

```
LAYOUT
  [ ] Readable ở 320px minimum width
  [ ] Single column cho primary content
  [ ] Breakpoints: 320 / 375 / 768 / 1024 / 1280 / 1440px

INTERACTION
  [ ] Tap targets >= 44x44px
  [ ] Gap giữa targets >= 8px
  [ ] Không có hover-only interactions
  [ ] Swipe gestures có fallback

FORM
  [ ] Input type đúng (email/tel/number) → đúng keyboard
  [ ] Labels visible luôn (không chỉ placeholder)
  [ ] Submit button visible khi keyboard mở

PERFORMANCE
  [ ] Images có srcset
  [ ] Font chỉ load weights cần dùng
```

---

## Bước 7 — Accessibility Baseline (luôn áp dụng)

Minimum: **WCAG 2.1 Level AA**

```
VISUAL
  ✓ Text contrast >= 4.5:1, UI elements >= 3:1
  ✓ Không dùng màu là signal duy nhất
  ✓ Focus ring visible
  ✓ Text zoom 200% không mất content

SEMANTIC
  ✓ Heading hierarchy không skip (h1→h2→h3)
  ✓ <button> cho actions, <a href> cho navigation
  ✓ Form labels linked (htmlFor hoặc aria-labelledby)
  ✓ Images có alt="" (decorative) hoặc alt="description"

KEYBOARD & SCREEN READER
  ✓ Tab order logic
  ✓ Modal traps focus, trả focus khi đóng
  ✓ Custom components có ARIA roles
  ✓ Dynamic content có aria-live="polite"
  ✓ Skip nav link cho keyboard users
```

---

## Bước 8 — Anti-Pattern Blacklist

| Anti-Pattern | Vấn đề | Fix |
|---|---|---|
| Placeholder = Label | Mất khi typing | Floating label hoặc label above input |
| Auto-rotate carousel | Vestibular disorders + hard to read | Manual control only |
| Infinite scroll không có URL anchor | Back button broken | Load-more với URL state |
| `user-scalable=no` | A11y violation | Xoá dòng này |
| Modal on page load | Disorienting | Chỉ trigger từ user action |
| Error chỉ ở form top | User không biết field nào sai | Inline validation + summary |
| "Click here" link text | Screen reader vô nghĩa | Descriptive anchor text |
| Icon-only interactive element | Không accessible | aria-label hoặc visible tooltip |
| Password field hidden by default | Cannot verify what typed | Show/hide toggle |
| Confirm dialog "OK / Cancel" | Không rõ hậu quả | "Xoá dự án / Giữ lại" |

---

## Bước 9 — Validation Layer (Product Context)

**Dùng khi**: Design có mục tiêu business rõ ràng và cần đo lường kết quả.

### 9.1 Design Hypothesis
```
Format:
"Chúng tôi tin rằng [thay đổi design này] sẽ giúp [user segment]
làm được [action] dễ hơn, dẫn đến [metric] tăng/giảm [target %]."

Ví dụ:
"Chúng tôi tin rằng moving CTA lên above-the-fold sẽ giúp first-time visitors
click signup dễ hơn, dẫn đến signup conversion tăng 15%."
```

### 9.2 Metric Mapping

| Design Change | Primary KPI | Secondary KPI |
|---|---|---|
| Redesign onboarding | Time-to-first-value | Day-7 retention |
| Simplify checkout | Checkout completion rate | Cart abandon rate |
| Improve error messages | Form submit success rate | Support ticket volume |
| Redesign navigation | Task completion rate | Time-on-task |
| Empty state redesign | Feature adoption rate | Bounce from empty state |

### 9.3 Instrumentation Requirements
```
Mỗi design change cần:
- Event: [screen]_[element]_[action] (vd: checkout_cta_clicked)
- Funnel step: Xác định đây là bước thứ mấy trong funnel
- Error tracking: Log lỗi user gặp ở đâu
- Rage click detection: Nơi user frustrated
- Session replay trigger: Khi nào cần record session
```

### 9.4 A/B Test Structure (khi cần)
```
Control:   Design hiện tại
Variant A: [Thay đổi X]
Sample:    Minimum statistical significance (thường >= 1000 sessions/variant)
Duration:  Đủ để capture weekly cycle (thường 2 tuần)
Success:   Primary metric tăng >= [target] với p < 0.05
Guard:     Secondary metric không giảm > [threshold]
```

---

## Bước 10 — AI-Native UX Patterns

**Dùng khi**: Product có AI-generated content, recommendations, hoặc automation.

### 10.1 Transparency Patterns
```
Confidence Indicator
  - Hiện khi AI không chắc chắn (ví dụ: "87% confident")
  - Low confidence → đề xuất human review
  - Never hide uncertainty

"Why this?" Explanation
  - Mọi AI suggestion đều có thể expand để xem lý do
  - Format: "Gợi ý này dựa trên [X, Y, Z]"
  - User có thể disagree mà không mất flow

AI Source Attribution
  - Rõ ràng phân biệt AI-generated vs human-generated content
  - Label: badge, icon, hoặc color token riêng
```

### 10.2 Control & Editability
```
Editable AI Output
  - AI output KHÔNG phải final — luôn editable ngay tại chỗ
  - Inline edit > copy-paste sang chỗ khác
  - Auto-save draft khi user edit

Regeneration Flow
  - "Thử lại" button luôn visible
  - Option: "Thử lại với hướng khác" (variant prompt)
  - History: user có thể quay lại output trước
  - Undo regeneration nếu output cũ tốt hơn
```

### 10.3 Safe Fallback States
```
AI Unavailable
  - Degrade gracefully — feature vẫn dùng được, chỉ không có AI assist
  - Message: "AI assist tạm thời không khả dụng. Bạn vẫn có thể [action] thủ công."
  - KHÔNG block toàn bộ screen

AI Processing
  - Skeleton stream (text appears progressively) > loading spinner
  - Cancel button trong 2 giây đầu
  - Partial result useful hơn là chờ full result

Hallucination Recovery
  - Flag content AI có thể hallucinate (dates, numbers, names)
  - "Verify this" prompt cho critical information
  - Easy path để report và correct AI error
```

### 10.4 Memory & Context Awareness
```
Khi AI nhớ user context:
  - Hiện rõ AI đang dùng thông tin gì ("Dựa trên dự án X của bạn...")
  - User có thể xem và xoá memory
  - Memory scope rõ ràng (conversation / session / account level)

Khi AI không có context:
  - Hỏi trước khi assume
  - Progressive context gathering (không hỏi 10 câu cùng lúc)
```

---

## Quick Reference: Mode Selection

```
"Tôi chưa biết muốn thiết kế gì"          → MODE A (Discovery)
"Giúp tôi thiết kế flow onboarding"        → MODE A + B
"Redesign màn hình dashboard này"           → MODE B + C
"Xây design system cho app"                → MODE D
"Nhận xét UI này có vấn đề gì"             → MODE E (Critique)
"Tạo component Button spec"                → MODE D
"Thiết kế lại và đo improvement"           → MODE B + C + Bước 9
"App AI của tôi cần UX tốt hơn"            → MODE B + Bước 10
```
