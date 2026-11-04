# Visual Re-check (Home) - TASK_2026_864_1376, HEAD 13ec7db9b

## Environment
- Electron DEV app only, built from the worktree (`nx run-many -t build-dev,copy-renderer-dev -p ptah-electron` under the verify lock; dist main.mjs built after HEAD). Launched `electron dist/apps/ptah-electron/main.mjs`, `NODE_ENV=development`, `--user-data-dir=/tmp/pr-udd2`, `--remote-debugging-port=9333`; driven over CDP (playwright-core). Viewport via `Emulation.setDeviceMetricsOverride`; theme via `data-theme` `ptah-glass` / `ptah-glass-light`; route via the Angular router (`ng.ɵgetRouterInstance`), because the renderer uses a memory location. Axe-core run per theme. App stopped at the end; nothing left listening on 9333.
- Real state: Codex bundled 0.165.0 signed in (chosen connection = Codex), Claude Code installed and signed in. Both Ready.
- Not-ready and Claude-chosen states were SIMULATED in memory only (set `AuthStateService._persistedAuthMethod` and `CodexReadinessService.viewState` signals on the live Home component). Nothing saved, no sign-in, no agent run, no `codex login`.
- Widths 1280x900, 1024x800, 600x900 (audit selection, not a support contract); dark and light. Screenshots in `visual-review-home/`.

## Checks
| # | Check | Result | Evidence (theme, width) |
|---|-------|--------|-------------------------|
| 1a | Home strip names chosen connection | PASS: "1 Codex / Ready" (chosen = Codex), not Claude-only | home-codex-ready-{dark,light}-{1280x900,1024x800,600x900}.png |
| 1b | Footer link | PASS: "Review your connection and settings" | home-codex-ready-*.png |
| 1c | Connection readiness banner on Home | PASS (see 3c) | home-codex-off-*.png |
| 2a | Finding 3 (invalid `role="chosen"`) | PASS: host now carries `connectionrole="chosen"`, no `role`; axe 0 violations in drawer, dark + light | drawer-credentials-{dark,light}-1280x900.png |
| 2b | Finding 4 (empty pill when signed in) | PASS: no empty bordered pill; copy + "Sign in with Codex" button only | drawer-credentials-dark-1280x900.png |
| 3a | Chosen = Codex, ready: strip Ready, no banner | PASS | home-codex-ready-*.png |
| 3b | Chosen = Claude Code (simulated): "1 Claude Code / Ready", no banner | PASS | home-claude-{dark,light}-{1280x900,1024x800}.png |
| 3c | Chosen = Codex not signed in (simulated): strip "Needs sign-in" + banner "Codex is not signed in. Codex is your main connection. You can still pick a path." + Sign in button | PASS; warning icon, readable, no overflow | home-codex-off-{dark,light}-{1280x900,1024x800}.png |
| 4 | Revisit: from the simulated stale state go to /onboarding/ready, then back to Home | PASS: Home shows "Checking" at 200 ms, "Ready" and no banner by 1.5 s; no stale "Needs sign-in" | revisit-stage1-dark-1280x900.png, revisit-home-{dark,light}-1280x900.png |
| 5a | Axe (all rules) on Home, dark + light, 1280 | PASS: 0 violations incl. color-contrast and aria | home-codex-ready-*, home-claude-*, home-codex-off-* |
| 5b | Focus visibility | PASS: 14 Tab stops, each with 2px solid outline plus ring, logical order | focus-light-stop4.png, focus-light-stop8.png |
| 5c | Layout 1024 / 1280 (and 600) | PASS: no horizontal scroll in either theme at any width; no clipping | home-codex-ready-*, home-codex-off-* |

## Findings
| # | Severity | Finding |
|---|----------|---------|
| A | Moderate | When the first readiness RPCs time out (first launch while the machine was under heavy build load; log: `RPC timeout ... auth:getCodexReadiness`, `provider:getAmbientClaudeStatus`), the Home strip stayed on "Checking" then "Taking longer" for 30+ s with no banner and no retry. Not reproducible on a fresh launch once the backend was responsive (settled to Ready in under 10 s), so it is an edge case, but Home offers no recovery action in that state. Consider showing the banner with Retry once the slow state persists. Screenshot: the first-run capture was overwritten by the relaunch; the state is recorded in the DOM probes only. |
| B | Minor | Standalone text links are 20-21px high ("Back to chat", "Analyze current project", "Only generate agents", "New project", "AI team builder", "Review your connection and settings"), below the 24px target criterion (WCAG 2.5.8); the inline-link exemption does not clearly cover standalone links. Pre-existing and outside Batch 22 scope. |
| C | Minor | The Home h1 shows a boxed focus outline from programmatic route focus on every capture. Appears to be the intended route-focus pattern; noted only. |

No Blocking and no Serious findings.

## Not reached
- Real Codex-signed-out and Claude-signed-out states and the real slow/error copy: would need signing out or breaking a CLI on this machine; simulated for the strip and banner only.
- Real chosen = Claude Code: would need saving a provider setting; simulated in memory only. In-app Codex sign-in block panel layout (signed-out): not reached.
- Prototype side-by-side was not redone for Home; layout matches design-spec section 1 on inspection (strip, banner above resume, footer copy).

## Verdict
APPROVED (Blocking 0, Serious 0, Moderate 1, Minor 2).
