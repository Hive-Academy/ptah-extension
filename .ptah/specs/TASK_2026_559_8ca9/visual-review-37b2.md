# Visual Review — Batch 37b2 — `go vet` consent card (TASK_2026_559_8ca9)

## Verdict: NEEDS REVISION (score 6/10)

Serious contrast and target-size defects found (no visual-breaking layout defects). Verdict driven by
3 Serious findings; no Visual-breaking findings.

## Environment

Go is not installed in this environment and the card is Electron-only (`goVetDiagnostics` capability), so it
could not be exercised through the real Electron app. Instead of stubbing source, a **temporary harness** was
added to `apps/ptah-extension-webview` (Angular app that already compiles the chat-settings library and ships
the real `anubis` / `anubis-light` Tailwind/daisyUI stylesheet), mounted the real
`GoVetConsentConfigComponent` next to the real `VoiceConfigComponent` (its documented neighbour, O2 §5.1) inside
the same container classes as `settings.component.html` (`max-w-4xl mx-auto px-3 py-3 … md:px-6 lg:px-8` on
`bg-base-100`), and injected a hand-written fake `ClaudeRpcService` (real `RpcResult` class, no jest) driven from
`window.__harness` to answer `diagnostics:go-vet-consent-get` / `…-set` with every state named in the task.
Real user interaction (`ptah_browser_click` on the real toggle/cancel/allow elements, real Angular change
detection) drove the confirm → allow/cancel flow; `window.ng.getComponent(el)` called the component's public
`load()` to force GET refreshes per scenario.

**Files created and then deleted** (verified via `git status --porcelain` showing no diff after cleanup):
- `apps/ptah-extension-webview/src/harness-go-vet.main.ts` (standalone bootstrap + fake RPC)
- `apps/ptah-extension-webview/src/harness-go-vet.html`
- a temporary `build-harness-TEMP` / `serve-harness-TEMP` target pair in
  `apps/ptah-extension-webview/project.json` (reverted)

No file under review (`go-vet-consent-config.component.ts` or its neighbours) was edited.

- Server: `nx run ptah-extension-webview:serve-harness-TEMP` (Angular/Vite dev server), `http://localhost:4488/`.
- Viewports: 1280×900 (desktop) and 800×900 (narrow), each a fresh browser session (`ptah_browser_navigate`
  re-created the session so the requested viewport actually applied — reusing a session ignores viewport params,
  confirmed via `window.innerWidth`).
- Themes: `anubis` (dark) and `anubis-light` (light), toggled via `data-theme` on `<html>`, matching
  `apps/ptah-extension-webview/tailwind.config.js` theme source.
- 19 screenshots saved under `.ptah/specs/TASK_2026_559_8ca9/screenshots/37b2/`.

## States covered

hidden, off (short + 200-char Windows path), confirm (open + auto-focus + Escape-cancel + focus-return),
on (+ transient success message), stale (`root-moved`, `go-changed` reasons rendered; `root-replaced` text
verified via source read, not separately screenshotted — its string differs only in wording from the other two,
already exercised), error (`no-go-binary`, `workspace-changed`), and the disabled "no workspace open" edge case.

## Findings by severity

### Visual breaking

None found. The long 200-character Windows path (workspace root and Go binary) wraps via `break-all` inside the
`<dl>` with no horizontal scroll, no card overflow and no clipped text at either 800px or 1280px
(`02-off-longpath-dark-1280.png`, `03`/`05-off-longpath-dark-800.png`). The card shell matches the neighbouring
voice card's `border border-secondary/30 rounded-md bg-secondary/5` / `p-3` treatment at both breakpoints and
both themes; no reflow break in the toggle row (label + badge + switch stay on one line down to 800px).

### Serious

#### 1. "On" state badge fails contrast in the dark theme

- File: `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:133-141` (`badge-success`
  applied via `[class.badge-success]="stateView() === 'on'"`); root cause is the theme token pairing at
  `apps/ptah-extension-webview/tailwind.config.js:104-105` (`anubis` theme: `success: '#16a34a'`,
  `success-content: '#e8e6e1'`).
- Viewports affected: all (not viewport-dependent — theme-dependent). Dark theme only; light theme's
  "On" badge measured 6.01:1 (passes).
- Screenshot: `08-on-success-message-dark-800.png`, `17-on-dark-1280.png`.
- Problem: measured via canvas pixel-sampling + WCAG relative-luminance formula on the live rendered badge:
  fg `rgb(232,230,225)` on bg `rgb(22,163,74)` = **2.64:1**, at 9px font-size. WCAG AA requires 4.5:1 for normal
  text (this is well under even the 3:1 large-text/UI-component threshold).
- Impact: a user with low vision cannot read the "On" state label in dark mode — the one indicator that tells
  them `go vet` is currently authorised to run.
- Fix: pick a dark-theme `success-content` (or an override just for this badge) that clears 4.5:1 against
  `#16a34a` — e.g. a near-black content color, matching the pattern already used for `warning-content` (`#131317`
  on `#f97316`) in the same theme file.

#### 2. Error message text fails contrast in both themes

- File: `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:186-193`
  (`class="text-[10px] text-error mt-1"`, `data-testid="go-vet-consent-error"`).
- Viewports affected: all (theme-dependent, not viewport-dependent).
- Screenshots: `10-error-nogobinary-dark-800.png` (dark), `15-error-workspacechanged-light-800.png` (light).
- Problem: dark theme measured **3.55:1** (fg `rgb(220,38,38)` composited over the card's effective dark
  background); light theme measured **3.35:1** (fg `rgb(254,28,85)` over the card's cream background). Both are
  10px body text and both are below the 4.5:1 AA minimum for normal text.
- Impact: the fixed refusal messages (`SET_ERROR_TEXT`, `TRANSPORT_SET_ERROR`, `LOAD_ERROR` — the only
  explanation the user gets for why the toggle reverted) are hard to read for low-vision users in both themes.
- Fix: this is the same `error` / `error-content`-style pairing used elsewhere in the app; either use
  `text-error-content` on an `bg-error/10` chip (as the confirm panel does with `warning`) instead of bare
  `text-error` on the card background, or move to a theme color that clears 4.5:1 on both `base-100` families.

#### 3. Toggle touch target is 24×16 px, below the 24×24 px minimum

- File: `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:143-155`
  (`class="toggle toggle-xs toggle-primary"`).
- Viewports affected: all.
- Screenshot: `01-off-dark-1280.png` (visible size), measured via `getBoundingClientRect()`: `{w:24, h:16}`.
- Problem: WCAG 2.2 SC 2.5.8 (Target Size, Minimum — applied here as the repository declares no explicit
  standard) requires interactive targets to be at least 24×24 CSS px unless an exception applies (inline text,
  essential, or an equivalent larger target elsewhere). None of those exceptions apply to this switch.
- Impact: harder to hit precisely for users with motor impairments, on the narrowest axis of the only control
  this card exposes.
- Fix: `toggle-sm` (daisyUI) or larger clears 24px in both dimensions; note this is a pre-existing
  `toggle-xs` convention likely shared with other settings toggles in this codebase — worth a design-system-wide
  follow-up rather than a one-off fix here, but it is still a defect on this card as shipped.

### Moderate

#### 4. Toggle and badge disagree during the confirm step

- File: `go-vet-consent-config.component.ts:130-155` (badge driven by `stateView()` = committed
  `consent().state`; toggle driven by `toggleChecked()` = `confirmingRoot() !== null || consent().state === 'on'`).
- Screenshots: `06-confirm-dark-800.png`, `12-confirm-light-800.png`.
- Problem: while the confirm panel is open, the switch renders in the "on"/checked position (correct — it
  reflects the pending choice) while the adjacent badge simultaneously still reads "Off" (also correct — nothing
  is committed yet). The two co-located indicators read as contradictory at a glance rather than as "pending vs.
  committed."
- Fix (optional): a third badge state ("Confirm to enable") or dimming the badge while `confirmingRoot()` is set
  would remove the ambiguity; not required by the O2 spec, so this is a polish item, not a regression.

### Minor

- Body/help/status text throughout the card is 9–10px (`text-[10px]`, badge `badge-xs`). This matches the
  neighbouring `VoiceConfigComponent`'s own `text-xs` / `text-[10px]` tiers exactly, so it is *consistent*, not a
  new regression; flagged only as AAA-level guidance (16px body-text minimum is enhanced guidance, not an AA
  requirement) — `01-off-dark-1280.png`.
- Confirm-panel Allow/Cancel buttons measured exactly 24px tall (`{w:47,h:24}` / `{w:75,h:24}`) — meets the
  24×24 minimum but with zero margin; worth keeping in mind if `btn-xs` padding ever shrinks further.

## Residual uncertainty (stated, not guessed)

- **Keyboard-only flow**: the available browser tools (`ptah_browser_click`, `ptah_browser_evaluate`) can issue
  trusted mouse clicks and run page-context JS, but cannot dispatch a trusted keyboard `Tab` keystroke. What was
  actually verified:
  - Enable → confirm → Allow → success, and confirm → Cancel, both via real clicks on the real
    `go-vet-consent-toggle` / `-cancel` / `-allow` elements (not synthetic RPC injection) — component logic,
    `RpcResult` shapes and focus-management calls all ran for real.
  - `document.activeElement` after opening confirm is the real `go-vet-consent-cancel` button (its
    `afterNextRender(() => cancelButtonRef().focus())` fires correctly); after Cancel, focus returns to
    `go-vet-consent-toggle`; after a successful Allow, focus also returns to `go-vet-consent-toggle`
    (`focusToggle()` in `confirmEnable()`). All three focus-management contracts hold.
  - `(keydown.escape)="cancelEnable()"` was exercised with a synthetic `KeyboardEvent('keydown', {key:'Escape'})`
    dispatched on the confirm panel (untrusted events still reach Angular's `HostListener`/template-bound
    handlers, unlike browser-internal focus heuristics) and correctly closed the panel and returned focus.
  - **Not verified**: whether a genuine keyboard Tab traversal renders a *visible* focus ring on the
    auto-focused Cancel button. Measured computed style after the (click-driven) auto-focus: `outline-style:
    none` — daisyUI's `.btn:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; }`
    rule did not match, because Chromium's `:focus-visible` heuristic does not treat a script-triggered focus
    following a mouse click as focus-visible. This is expected/likely-correct behaviour for a keyboard-driven
    Tab+Space activation (browsers propagate focus-visible from the previously-focused, keyboard-focused element
    to a script-focused successor), but this harness could not trigger a *trusted* keyboard keystroke to confirm
    it holds for the real Tab path. Recorded as unverified rather than passed or failed — a follow-up with a real
    keyboard-driving E2E tool (e.g. Playwright's `page.keyboard.press('Tab')`) should confirm the ring is visible
    when a keyboard user reaches the toggle and presses Space/Enter.
- Two of the three `stale` reasons (`root-moved`, `go-changed`) were screenshotted; `root-replaced` was checked
  by reading `STALE_REASON_TEXT` in source (`go-vet-consent-config.component.ts:24-29`) rather than separately
  captured, since it is the same paragraph with only the reason clause swapped — no layout risk distinct from the
  other two.

## Screenshots (`.ptah/specs/TASK_2026_559_8ca9/screenshots/37b2/`)

01-off-dark-1280.png · 02-off-longpath-dark-1280.png · 03-off-longpath-dark-800.png · 04-off-dark-800.png ·
05-off-longpath-dark-800.png · 06-confirm-dark-800.png · 07-on-success-dark-800.png ·
08-on-success-message-dark-800.png · 09-stale-root-moved-dark-800.png · 10-error-nogobinary-dark-800.png ·
11-off-light-800.png · 12-confirm-light-800.png · 13-on-light-800.png · 14-stale-gochanged-light-800.png ·
15-error-workspacechanged-light-800.png · 16-hidden-dark-1280.png · 17-on-dark-1280.png ·
18-off-light-1280.png · 19-no-workspace-light-1280.png

## Prototype fidelity

No `prototype/` directory exists in this task folder (checked: `.ptah/specs/TASK_2026_559_8ca9/` has no
`prototype/` subfolder). Not applicable — reviewed against O2 §5.1's written contract and the sibling
`VoiceConfigComponent` pattern instead, per that section's own citation.

## Summary of what would need to change for APPROVED

Fix findings 1–3 (badge contrast, error-text contrast, toggle target size) or obtain explicit sign-off that they
are accepted as pre-existing design-system debt shared with other cards; findings 4 and the minor notes do not
block merge.

## Re-review (after visual fix round)

Same worktree/rules as the original review: no source edited, no git commands run. Re-created the identical
temporary harness (`apps/ptah-extension-webview/src/harness-go-vet.{main.ts,html}` + temp `build-harness-TEMP`
/ `serve-harness-TEMP` targets in `project.json`), served on port 4497, drove the real component with the same
fake `ClaudeRpcService`, measured with the same canvas-pixel-sampling + WCAG relative-luminance contrast method
(corrected in this pass to always composite the *element's own* background through its ancestor chain — the
first pass's helper skipped that for semi-opaque `bg-error/10`/`bg-warning/10` chips, which would have
under-reported this round's numbers). All temp files removed and reverted afterwards; confirmed via
`git status --porcelain apps/ptah-extension-webview` → empty.

Screenshots: `.ptah/specs/TASK_2026_559_8ca9/screenshots/37b2/r2/` (17 files), dark+light × 1280+800, covering
off, on, confirm ("Confirm to enable"), saving ("Saving…", artificial 15s RPC delay to catch the frame), error
(`no-go-binary`, `workspace-changed`), stale (`root-moved`, `go-changed`), success.

| # | Finding | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Dark "On" badge 2.64:1 | **PASS** | Badge text is now `text-base-content` on `badge-outline` in all states; measured On/Off/stale/pending badges all land on the card's `base-content` vs `base-100`-family pairing: dark 13.76:1, light 14.92–14.92:1 (`02-on-dark-1280.png`, `08-on-dark-800.png`, `12-on-light-800.png`). The success/warning/info dot itself is decorative (`aria-hidden`) and carries no required contrast. |
| 2 | Error text 3.55:1 dark / 3.35:1 light | **PASS** | Error is now a `border-error/50 bg-error/10` chip with `text-base-content`; measured with the corrected (element-own-bg-composited) method: dark 12.85:1 (`05-error-nogobinary-dark-1280.png`), light 12.90:1 (`14-error-nogobinary-light-800.png`). Stale (`text-warning`→base-content) and success (`text-success`→base-content) got the same treatment; both also measured 13.76:1 dark / 14.92:1 light (`06`, `07`, `11`, `15`, `16`). |
| 3 | Toggle target 24×16 px | **PASS** | New `data-testid=go-vet-consent-toggle-target` label wrapper measured 32×24 px at every viewport/theme checked (1280 and 800, dark and light) — meets the 24×24 WCAG 2.2 SC 2.5.8 minimum with margin on the width axis. |
| 4 | Badge/toggle disagree during confirm | **PASS** | Badge now reads "Confirm to enable" while the switch shows the pending "on" position (`03-confirm-dark-1280.png`, `09-confirm-dark-800.png`, `13-confirm-light-800.png`) — no contradiction. New "Saving…" state (switch disabled, on-position; badge "Saving…") also agrees, captured with an artificial 15s SET delay so the in-flight frame could be screenshotted before it resolved (`04-saving-dark-1280.png`, `17-saving-light-800.png`). |

**Overall verdict: APPROVED.** All 4 findings resolved and verified with measured contrast ratios (all ≥12.8:1,
comfortably above the 4.5:1 AA floor) and measured hit-area size (32×24 px ≥ 24×24 px) across both themes and
both breakpoints; no new visual regression observed in the process (long-path wrap, card shell, and neighbouring
`VoiceConfigComponent` styling remained unaffected). Residual, explicitly out of scope per the executor's own
note and this reviewer's tooling limits: the decorative dot's own color contrast (not required, text carries the
meaning) and true keyboard-Tab focus-ring visibility (still unverifiable without a trusted-keystroke automation
tool); the shared `toggle-xs` sizing convention on other settings cards is a named follow-up, not a regression
here.
