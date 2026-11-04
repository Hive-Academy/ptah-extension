# Visual Review - TASK_2026_865_2a1d

## Before (TASK_2026_865 pre-step)

Baseline captures of the existing `AuthRequiredBannerComponent` (`libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`), rendered by `chat-view.component.html:147-156` when `AuthStateService.flagAuthRequired()` has set the banner. This branch has no renderer changes, so the worktree UI equals the base.

### Method

- Host: the REAL Electron app (Playwright `_electron.launch`, Electron renderer from `apps/ptah-extension-webview`), not a VS Code host and not headless Chromium.
- Build served: `/home/amun/ptah-extension/dist/apps/ptah-electron` (main checkout `main.mjs` and renderer, built 2026-11-03 about 13:43-13:45, before this task). The worktree has no `dist/` or `node_modules`, so the main checkout's build and the main checkout's e2e harness (`apps/ptah-electron-e2e/src/support/fixtures.ts`, `UiDriver`) were reused. The banner component is unchanged on this branch, so this build is a valid base for the banner.
- Isolation: the harness launcher uses a temp `--user-data-dir` and a temp `PTAH_DB_PATH`. `~/.ptah/state` and the real provider/auth settings were not touched.
- Mocked state (via `UiDriver.mockRpc`, an IPC `rpc` listener in the Electron main process):
  - `chat:start` returns `{ success: false, errorCode: 'AUTH_REQUIRED', error: 'Your OpenAI Codex sign-in has expired. Re-authenticate in a terminal to continue.', providerId: 'openai-codex' }`
  - The harness's default mocks cover workspace/auth status (`apiKey`).
  - Flow: `ui.goto('chat')`, type "hello" into `ptah-chat-input textarea`, press Enter. `MessageSender.handleAuthRequired` then calls `flagAuthRequired`, and the banner appears.
- Themes: `anubis` (dark) and `anubis-light` (light), set through `rpcBridge.setState({'theme-v2'})` plus `localStorage['ptah-theme-v2']`, then reload. `data-theme` was asserted to match.
- Command, run under the machine lock:
  `cd /home/amun/ptah-extension && NODE_PATH=/home/amun/ptah-extension/node_modules node scripts/verify.mjs --exec --task screenshots-before -- npx playwright test --config=/tmp/shots-before/playwright.config.ts`
  Result: 2 passed.
- Spec source (copy, saved as .txt so it is not picked up as a test): `screenshots/before/_capture.spec.ts.txt`. The original and its config are in `/tmp/shots-before/`.
- No repo source files were edited.

### Screenshots (`.ptah/specs/TASK_2026_865_2a1d/screenshots/before/`)

| File | Shows |
| --- | --- |
| `chat-view-auth-banner-dark.png` | Full Electron window, anubis dark theme. Chat tile with the failed turn, the banner above the composer. |
| `banner-closeup-dark.png` | Banner element only (752x59 px), dark. |
| `chat-view-auth-banner-light.png` | Full Electron window, anubis-light theme. |
| `banner-closeup-light.png` | Banner element only (752x59 px), light. |

What the banner looks like today (verified by viewing the light full-window and dark close-up images):
- A single compact bordered card with a warning-tinted border, positioned directly above the chat composer.
- Header row: key icon, "Authentication required", then a primary button "Re-authenticate in terminal" (provider `openai-codex`; otherwise "Open Settings") and an X dismiss button.
- Below the header: the message text in muted small text.
- There is no carry-over or switch-provider affordance yet, which is what the task adds.
- Also visible: the transcript shows "Message delivery failed. <message>" as an assistant turn.

### Limits

- The Electron main process is real, but the backend is mocked. Only `chat:start` and the harness defaults were mocked, so there is no real provider, token or session.
- The window size is the Electron default (about 1200x775). No viewport sweep was done, since this is a baseline pair.
- The themes captured are `anubis` and `anubis-light`, the two eager themes. The default `ptah-glass` was not captured.
- The dark full-window PNG was captured, but only the dark close-up and the light full-window were visually inspected here.
- The build is the main checkout's `dist` at build time, not a rebuild from this worktree. The "after" run must rebuild from the worktree (or a branch with renderer changes) and use the same spec for a like-for-like comparison.

## After (TASK_2026_865 carry-over UI)

Verdict: **ISSUES** (score 6/10). Two serious findings, one moderate. No visual-breaking findings.

### Method and environment

- Host: the REAL Electron app (Playwright `_electron.launch`), built from this worktree (head 82254e3ac): `node scripts/verify.mjs --exec --task shots-after-build -- bash -c "npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron"` (exit 0, 280 s). Served from `<worktree>/dist/apps/ptah-electron` through the worktree's own copy of the e2e harness (`apps/ptah-electron-e2e/src/support/fixtures.ts`), so the entry resolved to the worktree dist, not the main checkout.
- Isolation: harness temp `--user-data-dir` and temp `PTAH_DB_PATH`; `~/.ptah/state` and real auth untouched.
- Run: `node scripts/verify.mjs --exec --task screenshots-after -- npx playwright test --config=/tmp/shots-after/playwright.config.ts` -> 12 passed (6 states x anubis dark / anubis-light). `data-theme` asserted per test. Window 1200x~775 (Electron default), same as the before set.
- Spec: `screenshots/after/_capture.spec.ts.txt` (original and config in `/tmp/shots-after/`).
- Reaching the refusal like the real flow: send a first message (`chat:start` mocked success), push `session:id-resolved` for a fixed session id plus an idle `turn_state`, then send a second message with `chat:continue` mocked to `{success:false, errorCode:'AUTH_REQUIRED', providerId:'openai-codex', error:<same text as before>}`. That sets the banner origin, so the renderer calls `chat:carry-over-check` (mocked per state).
- Mocks per state: 1 `chat:carry-over-check` = `{eligible:false}`; 2 = `{eligible:true, providerId:'anthropic', providerName:'Claude'}`; 3 same plus a main-process wrapper that holds `chat:carry-over` for 90 s (keeps the launch pending, records the call immediately); 4 `chat:carry-over` = `{success:true,...}`, then `session:id-resolved` carrying the observed `requestId` as `carryOverRequestId` (this is what the host stamps), which drives `claimSessionResolution` -> `completeBinding` -> notice; 5 same via typing `/compact`; 6 same as 5 with a Codex-named first turn.

### Screenshots (`screenshots/after/`, each as `<name>-dark|light-full.png` and `-closeup.png`)

| State | Files | Result |
| --- | --- | --- |
| 1 no button | `state1-banner-no-button-*` | PASS. Identical to before: header, "Re-authenticate in terminal", X; banner 752x59.1 px at the same position as the before banner. |
| 2 button | `state2-banner-with-button-*`, `state2-banner-button-focused-*` | Layout OK, contrast FAIL in light (see S1/S2). |
| 3 busy | `state3-busy-*` | PASS functionally: button disabled, `aria-busy=true`, spinner, exactly 1 `chat:carry-over` call after a real click, a forced click and a dispatched click. Banner height unchanged (59.1). |
| 4 notice after button | `state4-notice-after-button-*` | PASS. Banner is gone, green info notice above the composer, text matches `carryOverNotice('Claude')`, wraps to 2 lines, nothing truncated. |
| 5 notice after /compact | `state5-notice-after-compact-*` | ISSUES (M1): notice is partly covered. |
| 6 /compact codex -> Claude | `state6-compact-codex-to-claude-*` | ISSUES (M1), same as 5. |

### Findings

**Serious 1. "Continue with Claude" fails contrast in the light theme (anubis-light).** `auth-required-banner.component.ts` uses `btn btn-xs btn-outline btn-primary`. Computed text = border = `oklch(0.85 0.138 181)` (light teal) on the light banner surface: about 1.3-1.4:1 (computed from the oklch values, measured style via `getComputedStyle`; WCAG AA needs 4.5:1 for 11px text, 3:1 for the border). The label is barely legible in `state2-banner-with-button-light-closeup.png` and `-full.png`. The adjacent solid "Re-authenticate in terminal" button is fine (6.8:1). Fix: use a theme-safe outline style (for example `btn-outline` with `text-base-content` and a strong border, or `btn-secondary`/ghost with `text-primary-content`-aware colors) so the label meets 4.5:1 in both themes.

**Serious 2. Same button in dark: 3.2:1 for 11px text** (`oklch(0.546 0.215 263)` on `oklch(0.239 0.015 285)`). Passes the 3:1 component-border criterion, fails 4.5:1 for normal text. Visible in `state2-banner-with-button-dark-closeup.png`. Same fix as S1. The disabled/busy label in state 3 (20% opacity) is intentionally low-contrast and exempt, but its spinner is also very faint (`state3-busy-dark-closeup.png`, `state3-busy-light-closeup.png`); moderate.

**Moderate 1. In states 5 and 6 the slash-command "SUGGESTIONS / No matches found" popup stays open over the notice.** After `/compact` carries over, the composer is empty, yet the palette is still shown and covers the bottom line of the notice ("... text was sent to Claude." is cut off) in `state5-*-full.png` and `state6-*-full.png`, dark and light. The notice close-ups (`state5-*-closeup.png`) show the full text, so the notice itself is correct. Caveat: the harness typed `/compact` with `fill()` and clicked send; I did not capture the same step on the pre-change build or with real keystrokes, so this may be a harness artifact. Treat as needing a manual check. The relevant path is the early return in `message-sender.service.ts` (`tryCompactCarryOver` result returned before the input state is reset).

**Minor.** The button width grows from 124 to 138 px when the spinner shows, shifting its left edge by about 14 px (no vertical shift, banner height constant, no horizontal page scroll).

### Checks that passed

- Layout shift: banner box identical before and after the offer arrived (752x59.125 at the same y) in both themes; the button appears in the existing header row, so the composer does not move.
- Focus: Tab focus on the new button gives `:focus-visible` with a 2 px outline (dark `oklch(0.77 0.14 91)`, light `oklch(0.48 0.12 70)`); visible in `state2-banner-button-focused-dark.png` (and the light variant).
- Target size: 24 px high, 124-138 px wide (meets the 24x24 AA target criterion). No text truncation: scrollWidth within clientWidth for all buttons. Disclosure text is `sr-only` and linked by `aria-describedby`.
- Busy state blocks a second launch (see state 3).

### Limits

- Backend mocked; no real provider, session or summary. The notice is driven by a synthesised `session:id-resolved` with the observed `requestId`.
- State 6 cannot show a native Codex session differently: the renderer is runtime-agnostic (no `codex-app-server` reference under `libs/frontend`); the runtime and Codex history reading are host-side (Batches 10-11) and are not exercised by mocks. State 6 only shows the renderer path for a chat that started on provider `openai-codex`, carried to Claude; it is visually the same as state 5.
- Single window size, two eager themes (not `ptah-glass`), no narrow-width sweep. Contrast figures for S1/S2 are computed from the oklch tokens with a WCAG luminance formula, not from a pixel sample.
- Notice is auto-dismissed after 15 s; all captures were taken inside that window.
- `dist/` is the dev build (development configuration), not the production renderer.

## After fix 6 (re-capture)

Verdict: **PASS** for S1, S2, notice contrast, spinner and focus ring. M1 unchanged (pre-existing, out of scope). No new findings.

### Method

- Real Electron app (Playwright `_electron.launch`), rebuilt from this worktree at head c8a6fb402: `node scripts/verify.mjs --exec --task shots-fix6-build -- bash -c "npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron"` (exit 0, 272 s). The harness is the worktree copy, so the entry resolves to the worktree `dist/`.
- Run: `NODE_PATH=<worktree>/node_modules node scripts/verify.mjs --exec --task screenshots-fix6 -- npx playwright test --config=/tmp/shots-fix6/playwright.config.ts` -> 8 passed, 4 skipped (states 1 and 6 skipped by request). Same isolation (temp user-data-dir, temp `PTAH_DB_PATH`) and same mocks as the earlier After run. `data-theme` asserted per test. Window 1200x775.
- Spec: `/tmp/shots-fix6/capture.spec.ts` (derived from `screenshots/after/_capture.spec.ts.txt`, output redirected, contrast probe added).
- Screenshots: `screenshots/after-fix6/` (states 2, 3, 4, 5 x dark/light, full + close-up, plus `state2-banner-button-focused-{dark,light}.png`). Every PNG was viewed.
- Contrast method: `getComputedStyle` of the element (`color`, `border-top-color`). Each colour is resolved to sRGB through a canvas `fillStyle` -> `getImageData`, so oklch is converted by the browser, not by me. The surface is the ancestor background layers composited over white. Ratio is WCAG 2.x relative luminance, (L1+0.05)/(L2+0.05). Pixel-exact, not estimated from tokens. Border is measured against the banner surface.

### Results

| Item | Dark `anubis` | Light `anubis-light` | Criterion | Verdict |
| --- | --- | --- | --- | --- |
| S1 button text (`btn btn-xs btn-outline text-base-content-muted`) | 5.76:1 | 5.48:1 | 4.5:1 text | PASS (was about 1.3-1.4:1 in light) |
| S2 button border | 5.76:1 (1 px) | 5.48:1 (2 px) | 3:1 UI component | PASS |
| Notice text (`text-base-content` on `bg-success/10`) | 13.2:1 | 14.48:1 | 4.5:1 | PASS |
| Busy spinner (own colour, `text-base-content-muted`) | 5.69:1 | 3.74:1 | 3:1 UI component | PASS |
| Focus ring on the button (Tab, `:focus-visible`) | 2 px solid `oklch(0.77 0.14 91)` | 2 px solid `oklch(0.48 0.12 70)` | visible | PASS (`state2-banner-button-focused-*.png`: ring clearly visible, not clipped) |

Notes:
- Busy state: the disabled button label is at 20% alpha (1.75:1 dark, 1.46:1 light). That is the daisyUI disabled style; WCAG 1.4.3 exempts inactive components. The spinner carries the busy signal and is legible in both themes (`state3-busy-*-closeup.png`). The label is dim but readable as "Continue with Claude" in the close-ups. This is informational, not a finding.
- Notice border (`border-success/30`, 1.77:1 dark, 1.42:1 light) is decorative; the text carries the information, and the box is distinguishable by its green tint in `state4-*-closeup.png`.
- Layout: button and banner layout unchanged by the class change (same banner row, no wrapping, no truncation visible in the close-ups). "Re-authenticate in terminal" remains the single solid primary action.
- Notice wraps to 2 lines, nothing truncated, in state 4 (both themes).

### M1 (out of scope)

`state5-notice-after-compact-{dark,light}-full.png`: the slash palette ("SUGGESTIONS / No matches found") still covers the lower part of the notice after `/compact`. Behaviour unchanged from the earlier After run. The notice text colour fix is verified on the uncovered state 4 and on the notice element's computed style in state 5 (same 13.2:1 / 14.48:1). Still pre-existing and not caused by this task.

### Limits

Same as the earlier After run: backend mocked, one window size, two eager themes (not `ptah-glass`), dev build, notice captured inside its 15 s auto-dismiss window. Disabled-state contrast is reported but exempt.
