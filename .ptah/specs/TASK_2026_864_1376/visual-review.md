# Visual Review - TASK_2026_864_1376 (PR #916, head a4923f00c)

## Environment

- Electron DEV app only. Built from the worktree with `nx build-dev ptah-electron` + `nx copy-renderer-dev ptah-electron` (under the verify lock; no package/e2e/serve target), launched as `electron dist/apps/ptah-electron/main.mjs` with `NODE_ENV=development`, an isolated `--user-data-dir=/tmp/pr-udd` and `PTAH_DB_PATH=/tmp/pr-udd/ptah.db` (no real database touched), `--remote-debugging-port=9333`. Driven over CDP with playwright-core; viewport via `Emulation.setDeviceMetricsOverride`; theme via `data-theme` `ptah-glass` / `ptah-glass-light` (same method as `apps/ptah-electron-e2e/src/support/axe.ts`). App stopped at the end.
- Real machine CLI state: Claude Code installed (`~/.local/bin/claude`, version "Not available", signed in); Codex bundled copy 0.165.0, signed in; main connection = Codex. Both providers Ready.
- Widths: 600, 767, 768, 800, 1024, 1280 (height 900) and 800x600; dark + light. Audit selection, not a support contract. Axe (axe-core from node_modules) run per theme at 1280.
- Screenshots: `visual-review/` next to this file (names `<screen>-<theme>-<WxH>.png`).
- Safety: no sign-in started, no provider setting saved. The radio confirm was opened with ArrowLeft and cancelled (state reverted to Codex, focus returned to the Codex radio).

## Findings

| # | Screen | Width | Theme | Finding | Severity | Screenshot |
| - | ------ | ----- | ----- | ------- | -------- | ---------- |
| 1 | Home (`/onboarding`) | all (600-1280, 800x600) | both | Home was not migrated. Strip item 1 reads "Claude Code / Ready" while the main connection is Codex (stage 1 and 2 correctly read "Codex"). Home still uses `ptah-ready-strip` without `[connection]` and `ptah-claude-readiness-banner` (`onboarding-home.component.ts:77,112`), so the banner cannot name the chosen connection. AC 4.3 / 4.4 not met on Home. | Blocking | home-dark-800x600.png, home-light-1280x900.png |
| 2 | Home footer link | all | both | Link still says "Review Claude Code and settings" (`onboarding-home.component.ts:306`); design-spec section 1 and batches.md:939 require "Review your connection and settings". | Serious | home-dark-1280x900.png |
| 3 | Settings > Providers > Codex drawer > Credentials | all | both | Axe `aria-roles` (critical): `<ptah-codex-sign-in-block layout="compact" role="chosen">` puts an invalid ARIA role on the host (`credentials-tab.component.ts:192`). The `role` input leaks as an attribute. Same risk at `provider-panel.component.ts:246` (bound, so the attribute is set only if reflected; verify). The e2e axe gate fails on critical. Fix: rename the input (`variant`/`connectionRole`) or `host: {'[attr.role]': 'null'}`. | Serious | drawer-credentials-light-600x900.png |
| 4 | Same drawer | 600-1280 | both | When signed in (`phase()==='ready'`, layout compact) the sign-in block renders an empty bordered pill between the copy and the "Sign in with Codex" button. Visual noise, reads as a broken input. Render nothing (or no border) when the block has no content. | Moderate | drawer-credentials-light-600x900.png, drawer-credentials-after-dark-1280-empty.png |
| 5 | Stage 1 | 1280 | both | Codex "Installed" row merges the long bundled path and "Yes. Ptah's bundled copy is used." in one cell with no separation; the Codex panel is ~80px taller than Claude's, so the two panels are unequal in weight when paths differ. No clipping, wraps correctly at 600. | Minor | stage1-ready-dark-1280x900.png, stage1-ready-light-600x900.png |
| 6 | Stage 1 | all | both | Claude "Version: Not available" although installed and signed in (real CLI state; copy is truthful but gives no hint). | Minor | stage1-ready-dark-1280x900.png |

No horizontal scroll at any width. No clipped text in stage 1 (only sr-only live regions matched the clip probe on stage 2 and Home).

## Checks

| Check | Result | Notes |
| ----- | ------ | ----- |
| Two provider panels, same structure (h2, subline, chip, three facts) | PASS | Same rows and chip words; weight differs only by main-connection border/tag (as designed) and finding 5. |
| Chosen provider emphasis matches prototype (primary border, "Main connection" tag; other muted) | PASS | stage1-ready-*. |
| Radio group semantics (`role=radiogroup`, labelled/described, native radios, labels) | PASS | `connection-choice-label` / `-help`. |
| Keyboard: single tab stop on checked radio, ArrowLeft selects, confirm appears | PASS | Pending radio moves, confirm "Use Claude Code as your main connection? ... Saved to: This workspace." with "Use Claude Code" / "Cancel". |
| Cancel reverts and returns focus | PASS | Verified in DOM. |
| Visible focus (outline 2px + ring on radio, buttons) | PASS | stage1-radio-focus-*, stage1-ready-focus-tab*. |
| Facts not clipped at 600 | PASS | stage1-ready-light-600x900.png. |
| Nested interactive in cards | PASS | 0 nested interactive elements in `main`; axe clean on stage 1 / stage 2 / Home both themes. |
| Contrast both themes | PASS | No `color-contrast` violations in axe on stage 1, stage 2, Home, drawer. |
| Nothing stays aria-busy after settle | PASS | Re-check: busy 2 -> 1 -> 0 within ~1s; final 0. |
| Heading order | PASS | h1, h2 Claude Code, h2 Codex. |
| Banner on stage 2 matches chosen connection | NOT REACHABLE | Both providers ready, banner not shown (only "Codex is ready." live region; stage 2 lead names Codex: PASS). |
| Banner on Home matches chosen connection | FAIL | See finding 1 (old banner component, Claude-only strip). |
| Error / slow / install-help / sign-in-help copy vs design spec | NOT REACHABLE | Needs a missing/unsigned CLI or a delayed probe; forcing it would alter the machine's CLI or settings. |
| In-app Codex sign-in block (panel layout, chat re-auth) | NOT REACHABLE | Only visible when Codex is signed out; starting sign-in is forbidden. Drawer credentials tab reached (findings 3, 4). |
| Prototype comparison (stage1-states / stage1-codex-main) for reachable state | PASS | Layout, choice control, tags, confirm match `stage1-codex-main.html` and the confirm screenshot. |
| Stage 2 / Home at 600 to 1280 both themes, no overflow | PASS | stage2-providers-*, home-*. |

## Verdict

REVISE. Blocking: Home still shows the Claude-only strip and banner (and old footer copy) instead of following the chosen connection. Serious: invalid `role="chosen"` on the Codex sign-in block host (axe critical in the drawer). Stage 1 itself matches the prototype and the accessibility checks that were reachable pass.
