# TASK_2026_674_fa33 (+675, +676, 681 leftovers) — plan (Partial depth, BUGFIX)

Base: `main` @ 6c0490f1f. Worktree `.claude-worktrees/chat-transcript-followups`, branch `fix/chat-transcript-followups`.
Implementer: codex lanes. Reviewer: Claude `code-logic-reviewer` (other family). Visual: `visual-reviewer`.

## Batches (file-disjoint)

| Batch | Items | Files (main) | Lane |
| --- | --- | --- | --- |
| T | 674, 675, 676 | `chat/src/lib/services/chat-store/session-history-replayer.service.ts`, `message-finalization.service.ts` (+ specs beside `session-loader.resync-live-seed.spec.ts`) | codex |
| U1 | L1, L2, L5 | `chat/.../molecules/agent-card/cli-lane-usage-summary.component.ts`, `molecules/compact-session/compact-session-card.component.ts`, `organisms/session-inspector/inspector-agents-section.component.ts` (+ specs); host signal for L2 from `chat-view` only if needed | codex |
| U2 | L3, L4 | canvas pane-side strip + `canvas-detail/canvas-lane-tabs` / `agent-dock-card` hover dismiss; L4 root cause first (shell or canvas), smallest CSS fix | codex |
| E | L6 | `apps/ptah-electron-e2e/src/showcase/*.scene.ts` selectors (no e2e run; typecheck/lint only) | codex, after a slot frees |
| R | L7 | one webview production build (user told first) + source-map analysis report; fix only if trivial | codex, last |

## Decisions (orchestrator, reversible)
- L2: in the Canvas host the compact card does not repeat what the focus header shows (title, status pill, Full view toggle); outside Canvas the card is unchanged. The lane picks the existing host signal (embed chrome token / input); no new global state.
- L1: raise the light-theme text tokens of the usage row to ≥ 4.5:1 (normal text); dark stays.

## Verify
1. Scoped: `npx nx run-many -t typecheck,lint -p chat chat-ui canvas --parallel=1`, then `-t test ... --maxWorkers=2` (+ `ptah-electron-e2e` typecheck/lint for E).
2. Claude code-logic review of T and U1/U2/E.
3. Electron screenshots for L1-L4 (dark + light, 1440/760/400), announced to the other sessions.

## Review round 1 (batch T, `code-logic-review-T.md` NEEDS_FIXES 6/10)
- 675 (M2/M3) decision: no time-based placement on the shared `placeFinalizedTrees` path (normal turns stay as on main). The resync repair records the owner's frozen placement explicitly on the live state; finalization uses it only when present, in the no-anchor and the anchor branch.
- 674 (M1): keep frozen root boundaries so two non-contiguous owners stay separate and ordered (fallback: contiguous owners only + warn).
- Fix lane: codex `e2f9ca0b` (fresh lane with handoff brief; the resume was refused for context size).
- L4 decision (orchestrator): closed without a code change. The Electron main window has `minWidth: 800` (`apps/ptah-electron/src/windows/main-window.ts:119`); the 400 px shots used Playwright viewport emulation, so the `electron-shell` overflow (six-tab nav + 13 rem actions, chat `min-w-[400px]`, editor `min-w-[300px]`, lane U2 report) is not reachable by users. The VS Code webview uses `app-shell`, not measured at 723 px. Reversible; reopen if a narrow-window host appears.

## Review round 1 (U1/U2/E, `code-logic-review-UE.md` NEEDS_FIXES 5.5/10); T-r2 APPROVED 8/10
- Orchestrator type fix: `session-history-replayer.service.ts:337` `seed && ... && filter()` could be `false` (TS2339/TS2488) → ternary with `[]`. typecheck,lint PASS for chat, chat-streaming, chat-types, canvas, ptah-electron-e2e.
- L2: keep the activity status row (grid tracks, needs-you count, fine status words); in Canvas hide only the title, the Full view button and a duplicate header pill, with `@if`.
- L2 host signal: keep `RAIL_TRANSCRIPT_RETENTION` (only Canvas binds it) with a comment. FOLLOW-UP: switch to `SESSION_EMBED_CHROME` after PR #736 (it adds the embed `chrome` wiring and edits `session-embed`; using it now would conflict).
- L3b: close the card that is open on a tab A→B sweep. E: iterate all canvas sessions, not only rendered panes.
- Fix lanes (fresh, handoff brief): U1 `5f32c910`, U2 `6e8f21bd`, E `cb1e583d`.
- Fix round result: UE-r2 APPROVED 8/10 (minor: e2e cleanup passes silently with the rail collapsed; no visibility guard in lane-console-review; long lines → prettier on commit). typecheck,lint PASS (5 projects); test PASS (chat, chat-streaming, canvas; chat-types has no test target).
- Batch R: user told; two production builds (baseline detached worktree `.claude-worktrees/bundle-baseline` @ c57a9a1e7 = 3.49 MB, then current), esbuild metafile diff, report only. Lane `d030b35c`. Electron dev build + screenshots after R.
- Batch R result (`reports/batch-R-bundle.md`, lane `d030b35c`): initial 3,490,969 B (c57a9a1e7) → 3,688,519 B (+197.55 kB). Main cause: chat inspector code made eager by the wide Canvas Rail's direct mount (`canvas-rail-board.component.ts:245`) although chat-view `@defer`s it; chat +145.8 kB, chat-ui +42.6 kB, canvas +29.4 kB, styles +11.5 kB. FOLLOW-UP (not in this PR): lazy-load the wide Rail inspector while keeping its visible details and focus behaviour; measure with one isolated build. Candidate 2: dock overflow menu (≤ 9.2 kB).
- USER (2026-10-16): lazy-load the wide Rail inspector in this PR + one measuring build; remove the baseline worktree (done; junction removed first with `rmdir`).
- Change (orchestrator, trivial edit): `canvas-rail-board.component.ts:245` wide aside inspector wrapped in `@defer (on idle)` — now all 5 `<ptah-session-inspector>` references are deferred. Spec "renders the focused session in the wide Details aside once its deferred block completes" (null before, present after `completeDeferBlocks`). canvas typecheck/lint PASS; rail-board spec 91/91.
- Measured (production build, `.ptah/tmp/bundle-diff-defer.mjs`): initial 3,688,519 B → 3,622,864 B (−65,655 B; transfer 777.07 → 765.70 kB); `libs/frontend/chat` −84.70 kB attributed. Remaining eager growth vs 3.49 MB: ~132 kB (chat-ui inspector stats, canvas dock, styles) — follow-up candidate: dock overflow menu (≤ 9.2 kB).
