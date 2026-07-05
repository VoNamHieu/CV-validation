import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// Files that intentionally hand-pick hex colors because they render a CV
// DOCUMENT — a résumé must look identical regardless of the app's light/dark
// theme, so following the app's color tokens here would be wrong, not right.
// Exempt from the no-raw-hex-color rule below.
const CV_TEMPLATE_FILES = [
  "src/lib/cv-templates/**",
  "src/components/CvDocumentPreview.tsx",
  "src/components/CvTemplatePicker.tsx",
];

// ── Grandfather lists ────────────────────────────────────────────────────
// Both lists below exist so a stricter rule can land WITHOUT immediately
// breaking the build over pre-existing violations elsewhere in the app
// (measured 2026-07 during a design-system audit). Files here get the rule
// at 'warn' instead of 'error' — still visible in `next lint` output, not
// silenced, just not build-blocking. New code anywhere NOT on these lists is
// held to 'error' immediately, so the debt can't grow.
// → When you fix a file's violations, DELETE it from the list. Don't add new
//   files here for new code — that defeats the point.

const A11Y_GRANDFATHERED = [
  "src/app/admin/page.tsx",                    // label-has-associated-control
  "src/components/CvDocumentPreview.tsx",      // click-events-have-key-events / no-static-element-interactions / no-autofocus
  "src/components/EditableCvPreview.tsx",      // click-events-have-key-events / no-static-element-interactions
  "src/components/FloatingFeedback.tsx",       // no-autofocus
  "src/components/admin/PromotedPanel.tsx",    // label-has-associated-control
  "src/components/views/HistoryView.tsx",      // label-has-associated-control / click-events-have-key-events
  "src/lib/consent-context.tsx",               // click-events-have-key-events / no-static-element-interactions
];

const RAW_HEX_GRANDFATHERED = [
  "src/components/steps/StepEditCv.tsx",
  "src/components/steps/StepUploadCV.tsx",
  "src/components/Landing.tsx",
  "src/components/Mode1ResultBanner.tsx",
  "src/components/admin/PromotedPanel.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── Accessibility ──────────────────────────────────────────────────────
  // eslint-config-next's core-web-vitals preset already registers the
  // 'jsx-a11y' plugin namespace but only enables ~6 rules at 'warn'. Layer
  // the plugin's full recommended set on top — re-registering the plugin
  // object here throws "Cannot redefine plugin" in flat config, so this adds
  // only `rules`, reusing the namespace nextVitals already set up. This is
  // what would have caught the keyboard-inaccessible CV dropzone
  // (click-events-have-key-events / no-static-element-interactions) and the
  // missing modal semantics (aria-* rules) before they shipped.
  { rules: jsxA11y.flatConfigs.recommended.rules },
  {
    files: A11Y_GRANDFATHERED,
    rules: Object.fromEntries(
      Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, "warn"]),
    ),
  },

  // ── Design tokens ──────────────────────────────────────────────────────
  // No hand-picked hex colors outside CV templates. The app has a semantic
  // token system (var(--accent-red), var(--text-muted), ...) with distinct
  // light/dark values; a literal hex bypasses it, silently breaks in
  // whichever theme it wasn't eyeballed in, and tends to duplicate a token
  // with a slightly different (sometimes contrast-failing) value.
  // Matches bare hex literals only ('#ef4444') — not colors embedded inside
  // longer strings like `linear-gradient(135deg, #dc2626, #ef4444)`, and not
  // '#fff'/'#000' (their own contrast never varies by theme, so they're not
  // where this bug class actually lives — flagging them is just noise).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: CV_TEMPLATE_FILES,
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "Literal[value=/^#(?!(?:fff|000|ffffff|000000)$)([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/i]",
        message:
          "Hardcoded hex color — use a design token (var(--accent-red), var(--text-muted), ...) from globals.css instead. It won't adapt to dark mode and often duplicates a token at a slightly different, sometimes contrast-failing, value.",
      }],
    },
  },
  {
    files: RAW_HEX_GRANDFATHERED,
    rules: { "no-restricted-syntax": "warn" },
  },
]);

export default eslintConfig;
