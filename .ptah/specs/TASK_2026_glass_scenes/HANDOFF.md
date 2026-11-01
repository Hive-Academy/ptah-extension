# HANDOFF — TASK_2026_glass_scenes

Worktree: `D:\projects\ptah-extension\.claude-worktrees\glass-theme-scenes`
Branch: `feat/glass-theme-scenes` (LOCAL ONLY — not pushed, no PR yet)

## Goal (user request + decisions already made)

1. Remove DaisyUI `dark` theme (looked like `dracula`); keep `dracula`. Persisted `dark` migrates to `dracula`. DONE.
2. Add two image backdrops ("scenes") `pyramid` and `temple` to Ptah Glass dark (`ptah-glass`) and light (`ptah-glass-light`). DONE.
3. User asked for much less blur: pane blur 0px (semi-transparent fills carry readability), overlay blur 6px, lower tints. User approved the rendered look. DONE.
4. Temple image replaced with the user's 2752x1536 version (no white border). DONE.
5. `pyramid` is the DEFAULT scene; a stored scene choice wins. DONE.
6. Six glass "opaque surface" polish fixes (user screenshots: Command Center card touching header; Tasks page + WORKSPACES sidebar; Thoth panel; Dashboard; Settings Providers tab only; Marketplace left sidebar only). IN PROGRESS (Codex lane).
- User authorized heavy Codex use ("I have a reset") plus Claude subagents for the remaining work.
- Motion PR #880 (other session) is MERGED into main; this branch already merged main after it.

## Done (commits on feat/glass-theme-scenes, verified)

- 1d8f10e2e feat(core,chat-ui,webview): drop dark theme, add pyramid/temple scenes
- f12cc59c0 fix(webview): bundle glass scene images beside styles.css (webp in apps/ptah-extension-webview/src/backgrounds/, CSS url("./backgrounds/..."); public/ path broke the Angular build)
- 8d14dd750 merge origin/main
- 9d59f8fe5 feat(webview): lighten Ptah Glass blur and tint so scenes show
- 57ea18aa9 feat(webview): near-clear glass blur and 16:9 temple backdrop
- 0cfea488e fix(webview): zero pane blur, drop dead dark Ptah Glass tokens (review S1: dark-mode block at styles.css ~2708 is specificity (0,4,0) and overrides the (0,3,0) ptah-glass block; option (a) chosen = keep the rendered look the user approved)
- 753bbc19c feat(core,chat-ui,webview): make pyramid the default glass scene (data-scene now always set for Ptah Glass)
- dc071b348 merge origin/main incl. motion PR #880 (conflicts resolved: theme.service.ts keeps scenes + motion style; theme-toggle spec scene 'pyramid' + Glass count 5; e2e theme.spec.ts stays test.fixme with "35 themes")
- Verify on merged HEAD: `npm run verify -- -p ptah-extension-webview,@ptah-extension/core,@ptah-extension/chat-ui` passed (chat-ui re-run after fixing tile count 6->5: 1813 tests pass).
- Reviews: code-logic-review.md (phase 1 APPROVED, Kimi), code-logic-review-2.md (REVISE S1, Antigravity) -> fixed -> code-logic-rereview-2.md APPROVED. Commits 753bbc19c and the merge have NOT had an independent review yet.
- Known unrelated failure: `ptah-electron-e2e:lint` flags fs.watch in git-watcher.spec.ts (not touched by this task).

## In progress (uncommitted in worktree)

Codex lane implementing `.ptah/specs/TASK_2026_glass_scenes/design-spec-glass-polish.md` (by ui-ux-designer subagent). Files it is editing:
- apps/ptah-extension-webview/src/styles.css (cleared-roots list ~3477-3484 + new shared `:root[data-glass='on'] :is(.surface-1,.surface-2)` scrim rule)
- apps/ptah-extension-webview/src/app/glass-scrim.spec.ts
- libs/frontend/command-center/src/lib/components/command-center-start.component.ts (glass-only top/bottom 1rem margin; decision: margin, not centering)
- libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts, libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts (Settings Providers — root cause was NOT found statically; lane told to investigate harder)
- libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts (empty-state plate)
- NOT ours: `task-tracking/landing-live-demo/HANDOFF.md` shows modified — do not stage it.

## Open problems / decisions

- Settings Providers grey: root cause unconfirmed (design spec open question 1). Check batch-report-4.md; if still a guess, verify visually in Electron.
- M1 accepted risk: text contrast not re-measured at 0px blur / final values; user reviews visually.
- Lane availability: Antigravity quota out (~104h), Kimi 429 rate-limited, Grok balance exhausted (402), OpenCode/Glm at limit. Codex works (~92% weekly; user OK'd using it). For an independent (non-Codex) review, try Kimi again; else use a Claude code-logic-reviewer subagent (user allowed subagents).
- No before/after screenshots captured by us; user's screenshots are in C:\Users\abdal\AppData\Local\Temp\claude\D--projects-ptah-extension\132a7def-abf0-4762-815b-bbd1be5d28db\images\5.png..10.png (before).

## Key files

- .ptah/specs/TASK_2026_glass_scenes/design-spec-glass-polish.md — spec for the 6 polish fixes.
- .ptah/specs/TASK_2026_glass_scenes/batch-report-4.md — Codex deliverable (pending).
- apps/ptah-extension-webview/src/styles.css — glass tokens (~2650-2790), scene layer + Ptah Glass scene blocks (~2840-2910), surfaces (~2955+), cleared roots (~3477).
- libs/frontend/core/src/lib/services/theme.service.ts — ThemeName, SCENES, DEFAULT_SCENE='pyramid', dark->dracula migration, motion style (from #880).
- libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts — picker; Backdrop inside "Themes" tabpanel.
- apps/ptah-extension-webview/src/index.html — pre-paint script (must match ThemeService; guarded by theme-pre-paint-parity.spec.ts).

## Background work

- Codex lane `25e76c3e-cd4d-4b44-b408-1ada74914877` — implements design-spec-glass-polish.md, deliverable batch-report-4.md. State: running (CLI session 01a19884-3fcc-70f3-bec1-60cd54414474 for resume).

## Next steps

1. On `<agent-lane-completed>` for 25e76c3e: read batch-report-4.md, review `git diff` (only the 6 files above + spec). Confirm glass-only scoping.
2. Re-run checks: `npm run verify -- -p ptah-extension-webview,@ptah-extension/chat,@ptah-extension/command-center,@ptah-extension/tasks-ui -- --output-style=static` (confirm real Nx names in each project.json; header must say N projects).
3. Commit by explicit paths (commitlint scopes in .commitlintrc.json, e.g. `fix(webview,chat,tasks-ui): ...`; check command-center scope exists). Foreground commit. Co-Authored-By line.
4. Independent code-logic review of commits 753bbc19c, dc071b348 and the polish commit (non-Codex: Kimi if 429 clears, else Claude code-logic-reviewer subagent). Fix Blocking/Serious once, short re-review.
5. Fresh Electron build for the user: `node scripts/verify.mjs --exec --task electron-serve-glass -- npx nx serve ptah-electron --skip-nx-cache --output-style=static > /tmp/glass-serve.log 2>&1` (background). Ask user to check Tasks, Thoth, Dashboard, Settings > Providers, Marketplace sidebar, Command Center, and Temple/Pyramid backdrops.
6. After user approval: push in background + `gh pr create` against main (title < 70 chars, ## Summary + ## Test plan with real results, end with the Claude Code attribution line). Watch CI and reviews; report PR URL.
