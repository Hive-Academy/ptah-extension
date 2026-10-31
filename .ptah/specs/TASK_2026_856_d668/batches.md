# Batches - TASK_2026_856_d668

Total tasks: 36 | Batches: 36 | Waves: 12 | Complete: 18/36

Source: implementation-plan.md revision 3 (Gate 2 APPROVED, implementation-plan-review.md),
decisions.md #5-#10 (binding; all five Proposed Removals user-approved), context.md (lane roster).

`W` = `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics` (branch
`fix/persistent-session-metrics`). Every path below is `W\...` and therefore absolute. Never
edit the main checkout.

## Run rules (repeat in every lane and subagent prompt)

- Work only in `W`. Lanes do not run git; the team-leader commits.
- Memory-safe checks only: `npm run verify ...` as listed, one foreground run, long timeout,
  output filtered (`| tail -n 60`). Confirm the header "Running target ... for N projects" with N
  equal to the projects listed. Never workspace-wide, never `nx run-many` over unchanged
  projects, never build/serve/dev/e2e/package targets. Do not raise Nx or Jest parallelism.
- Electron first. Keep every host compiling.
- No stubs, TODO, PLACEHOLDER or mock data in place of logic. Missing data renders `—`/`≥`,
  never 0.
- Do not edit `batches.md` or `task.md`.

### Check levels (ordering fix for same-worktree parallel lanes)

Lanes in one wave share one worktree, so a project-wide lint/typecheck/test run by lane A can
read lane B's half-written files. To keep failures attributable:

1. **Lane check** (executor, inside the lane): only the batch's own specs,
   `npm run verify -- -t test -p <project> -- --testPathPatterns="<spec names>"`.
2. **Batch gate** (team-leader, Mode 2, after every lane of the wave has returned): the batch's
   scoped `npm run verify -- -p <projects>` and, where marked, the host typecheck `H`:
   `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-extension-webview,ptah-cli,ptah-tui`
   (`H-web` = `npm run verify -- -t typecheck -p ptah-extension-webview`).
   Commits stay one per batch, staged by explicit path.

### Executor policy (user rule)

- Every batch: **CLI lane, codex** first (confirmed room per context.md). Fallback order: another
  family with implementation capability (kimi code; grok/Glm only if their limits recover) ->
  subagent (`backend-developer` for agent-sdk / agent-generation / rpc-handlers batches,
  `frontend-developer` for frontend batches, either for pure shared TS).
- Subagent reason: N/A for every batch (bounded file sets, no interaction or git needed).
  Electron screenshots for "UI: yes" batches are NOT lane work; they are taken by the
  `visual-reviewer` subagent at the phase review (before = `main` base commit, after = branch).
- Review family: implementer codex -> phase code-logic review by `code-logic-reviewer`
  subagent (claude family, decisions #4). If a batch falls back to a claude subagent, that
  batch's review needs a different family (kimi code lane) or an exception label.

## Plan validation

Status: PASSED WITH RISKS

Checks run on disk (read-only):

- All 16 Nx project names exist (`project.json` `name`): `@ptah-extension/{core,shared,chat-state,chat-ui,chat,chat-streaming,command-center,canvas,workspace-indexing,git-ui,memory-curator-ui,setup-wizard,harness-builder,agent-sdk,agent-generation,rpc-handlers}`; hosts `ptah-electron`, `ptah-extension-vscode`, `ptah-extension-webview`, `ptah-cli`, `ptah-tui`. No other app imports these libs (license-server, landing-page, docs, video-studio checked).
- Every MODIFY/DELETE path in the plan exists; every CREATE path is absent (wall-clock, token-usage, context-fill, subagent-tool-count, and the 7 new specs). No "create" overwrites working code.
- Removed symbols are referenced only where the plan says: `CacheCountdownClockService` (inspector-cache-tile + 3 specs), `TranscriptLiveClock` (chat-transcript), `commandCenterClock` (controller + its spec), `SessionCostSummaryComponent` (two index exports). None is exported from a lib index except `SessionCostSummaryComponent`.
- `AgentMonitorStore.tick()` readers (non-spec): agent-card (B11), subagent-lane (B8b), lane-transcript (B8a) only. B20's dependency set is complete.
- Contract `compact-rail-card` input `contextPercent = input<number | null>(null)` already nullable: B8b's `number | null` producer matches B7's consumer without a type change.
- The `provider-setup-wizard` `probeTimer` `setInterval` (`:2409`) is covered by Component 13 T2 (B16), so the final `setInterval` grep gate is reachable.

Assumptions:

- One SDK result per user prompt (Component 18) — unverified; Task TC2.1 must confirm on a fresh read of `session-stats-owner.service.ts` and report it.
- `liveTurns` / `isStreaming` name in lane-transcript — unverified; Task B8a.1 checks.
- `page.tabs` field type in the Command Center controller — unverified; Task B18.1 checks.
- `restoreLayout` -> `syncFromBackend` path — unverified; Task B15.1 checks.
- Existing CX2 fixtures contain no sidechain record after the last main frame — unverified; Task CX2.1 reports any byte change per F13/F14.
- `isCompactSummary` absence — verified by Gate 2 (D24); TC0 projects it.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-A `session-loader.service.ts` holds a literal NUL byte inside a template literal (`:1324`, `` `${sessionId}\0${agentId}` ``); `grep` reads the file as binary and patch tools may refuse or strip it | HIGH | Task CX4.1: preserve the byte; before/after `grep -c -aP '\x00'` count must be equal (1); if the patch tool cannot edit the file, report rather than rewrite with `\u0000` changes in other lines. Team-leader re-checks in Mode 2. |
| R-B Same-worktree parallel lanes read each other's half-written files in project-wide checks | MEDIUM | Check levels above: lanes run spec-scoped tests only; the batch gate runs after the wave. At most 2 batches of one Nx project per wave. |
| R-C TC1 ledger gate and perf spec (`session-stats-reader.perf.spec.ts`) | MEDIUM | TC1 acceptance names the perf spec; batch gate runs full agent-sdk tests. |
| R-D TC2 owner turn semantics (provisional estimate `turnCount: 0`) | MEDIUM | TC2 test pins 4 + 2 + estimate = 6; assumption check above. |
| R-E CX4 two resume branches + model normalisation | MEDIUM | F10 x3, F12 x4 and normalisation case in `session-loader.service.spec.ts`; `session-loader.resync-live-seed.spec.ts` unchanged. |
| R-F B3b reconciliation of a wedged run past the ceiling | MEDIUM | Component 3 cases 1-7 in handler spec. |
| R-G Ordering of removals (B5b after B5a; B20 after B8a, B8b, B11) | MEDIUM | Wave order below; grep gates in each batch. |
| R-H B8b's "unknown window hidden" needs B7's rail change to be visible in Electron | LOW | Soft dependency B8b after B7 (wave 9 after wave 8). |
| R-I B13b and B18 pin F2/F6 through `sessionContextCue`, which CX3 rewires | LOW | Soft dependency on CX3 (wave 3) so the pins run against the final cue. |
| R-J B13a (`session-inspector.component`) and B13b (store) may share the inspector model type | LOW | Placed in different waves (9 and 10). |
| R-K B21 grep must not hit the shared `SessionCostSummary` interface / `calculateSessionCostSummary` (`libs/shared/src/lib/utils/subagent-cost.utils.ts:38,163`), which stay | LOW | B21 acceptance pattern is component-specific; executor told not to touch shared. |
| R-L Verify lock allows 2 concurrent checks; 3-lane waves queue | LOW | Expected; not a failure. |
| R-M "UI: yes" batches need Electron before/after screenshots that lanes cannot take | MEDIUM | Visual-reviewer at each phase review; before from `main` base commit. Listed per phase. |

Edge cases:

- Unknown or untrusted context window renders `—`, never `0%` — CX3, CX4, B8b, B13b, HB1, B18.
- Known `0%` still renders — B7.
- Already-expired permission/question on mount fires deny exactly once — B6.
- Hidden document pauses clocks; visible refreshes — B1.
- Host field absent (older host) for `regenerationStartedAt` and `turnCount` — B3b, B16, TC3, B13b.
- Compaction as latest record with no snapshot carries the same-model reading forward (F12, 15%) — CX4.
- Sidechain frames and compact boundaries ignored for context — CX2.
- Workspace removal resolves cross-workspace lookups to `null` — B4, B13b.

## Execution waves

Batches in one wave are file-disjoint, have every dependency in an earlier wave, and number at
most 3. Start wave N+1 only when every batch of wave N is COMPLETE (committed).

| Wave | Batches (projects) | Waits on |
| --- | --- | --- |
| 1 | B1 (core), B2 (shared), TC0 (agent-sdk) | — |
| 2 | CX1 (shared), B3a (agent-generation), B4 (chat-state) | B2 |
| 3 | TC1 (shared, agent-sdk), CX3 (chat-state, chat-ui), B8a (chat) | TC0, CX1, B1 |
| 4 | B3b (shared, rpc-handlers), CX4 (chat), B5a (chat-ui) | B3a, CX1+CX3, B1 |
| 5 | TC2 (agent-sdk), TC3 (chat-state), CX5 (chat) | TC1, CX3 |
| 6 | CX2 (agent-sdk), HB1 (harness-builder), B5b (chat-ui) | CX1+TC1, CX3, B5a |
| 7 | B16 (chat), B6 (chat-ui), B10 (chat) | B1+B3b, B1, B2 |
| 8 | B11 (chat), B7 (chat-ui), B19a (canvas, workspace-indexing) | B1+B10, B2, B1 |
| 9 | B8b (chat), B13a (chat), B19b (git-ui, memory-curator-ui) | B1 (+B7 soft), B1, B1 |
| 10 | B12 (chat), B13b (chat), B19c (setup-wizard) | B2, B2+B4+TC1 (+CX3 soft), B1 |
| 11 | B14 (chat), B15 (core, chat), B18 (command-center) | B1, B1, B1+B4 (+CX3 soft) |
| 12 | B17 (chat), B20 (chat-streaming), B21 (chat-ui, chat) | B1, B8a+B8b+B11, — |

Serial shared-file pairs (by dependency, never same wave): `libs/shared/src/lib/utils/index.ts`
B2 (w1) -> CX1 (w2); `session-history-reader.service.ts` + spec TC1 (w3) -> CX2 (w6).

## Phases

- **Phase 1 — Foundations, host contracts, context %**: waves 1-6 (B1, B2, TC0, CX1, B3a, B4, TC1, CX3, B8a, B3b, CX4, B5a, TC2, TC3, CX5, CX2, HB1, B5b). Phase review: code-logic + style (new public API: `injectWallClock`/`WallClockService`, token and context-fill helpers, `ENHANCED_PROMPTS_RUN_CEILING_MS`, `regenerationStartedAt`, `turnCount`, `contextFillStats` export) + visual (CX4, HB1).
- **Phase 2 — Consumers and removals**: waves 7-12 (B16, B6, B10, B11, B7, B19a, B8b, B13a, B19b, B12, B13b, B19c, B14, B15, B18, B17, B20, B21). Phase review: code-logic + visual (B7, B8b, B11, B12, B13a, B13b, B14, B16, B18). No new lib public API (B21 removes an approved export).
- Final gate after Phase 2 review: `npm run verify` (affected vs `main`, under the lock) plus the plan's grep gates (implementation-plan.md "Team-leader handoff" verification points).

---

## Batch B1: Core wall clock — COMPLETE

- Wave: 1 | Phase: 1 | Depends on: none
- Recommended executor: CLI lane codex (frontend TS) | Execution mode: sequential
- Fallback order: other family same capability -> same family other model -> frontend-developer subagent
- Subagent reason: N/A | Review family: claude (phase code-logic)
- Rationale: 3 files, one lib, new API with a self-contained spec.
- Tasks: 1 | Libs: core

### Task B1.1: Create `WallClockService` + `injectWallClock` — COMPLETE

- Files: CREATE `W\libs\frontend\core\src\lib\services\wall-clock.service.ts`, `W\libs\frontend\core\src\lib\services\wall-clock.service.spec.ts`; MODIFY `W\libs\frontend\core\src\lib\services\index.ts`
- Plan reference: implementation-plan.md Component 1 (:231-258), B1 (:748-756)
- Acceptance: exported from `@ptah-extension/core`; one interval per cadence ('second', 'coarse'); pause while hidden, refresh on visible; idempotent release; `active` predicate gates acquisition.
- Tests: `wall-clock.service.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/core -- --testPathPatterns="wall-clock"`
- Batch gate: `npm run verify -- -p @ptah-extension/core`, then `H` (public export)
- UI: no

## Batch B2: Shared token helpers — COMPLETE

- Wave: 1 | Phase: 1 | Depends on: none
- Recommended executor: CLI lane codex (TS) | Fallback: other family -> backend-developer or frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: shared

### Task B2.1: Canonical token helpers — COMPLETE

- Files: CREATE `W\libs\shared\src\lib\utils\token-usage.utils.ts`, `W\libs\shared\src\lib\utils\token-usage.utils.spec.ts`; MODIFY `W\libs\shared\src\lib\utils\index.ts`, `W\libs\shared\src\lib\utils\cli-usage.utils.ts`, `W\libs\shared\src\lib\utils\cli-usage.utils.spec.ts`
- Plan reference: Component 2 (:259-277), B2 (:757-765)
- Acceptance: `messageTokenTotal` (number | null; unknown -> null, known 0 -> 0, includes both cache classes), `sessionTokenTotal` (finite `tokenCount` else null, never recomputes), `cliUsageTokenTotal` ({value, exact} | null); all exported from `@ptah-extension/shared`.
- Tests: `token-usage.utils.spec.ts`, `cli-usage.utils.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/shared -- --testPathPatterns="token-usage|cli-usage"`
- Batch gate: `npm run verify -- -p @ptah-extension/shared`, then `H`
- UI: no

## Batch TC0: `isCompactSummary` history projection — COMPLETE

- Wave: 1 | Phase: 1 | Depends on: none
- Recommended executor: CLI lane codex (backend TS) | Fallback: other family -> backend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: agent-sdk

### Task TC0.1: Project `isCompactSummary` — COMPLETE

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts`
- Plan reference: Component 22 (:643-657), TC0 (:802-810)
- Acceptance: literal `true` converts to `isCompactSummary: true`; any other value converts with no key; all other converted fields unchanged.
- Tests: `jsonl-reader.service.spec.ts` (new cases); `jsonl-reader.streaming.spec.ts`, `jsonl-reader.account-context.spec.ts` unchanged and passing
- Lane check: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="jsonl-reader"`
- Batch gate: `npm run verify -- -p @ptah-extension/agent-sdk`, then `H`
- UI: no

## Batch CX1: Shared context fill helpers — COMPLETE

- Wave: 2 | Phase: 1 | Depends on: B2 (`utils/index.ts`, serial)
- Recommended executor: CLI lane codex (TS) | Fallback: other family -> either developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: shared

### Task CX1.1: `contextFillTokens`, `trustedContextWindow`, `contextFillPercent` — COMPLETE

- Files: CREATE `W\libs\shared\src\lib\utils\context-fill.utils.ts`, `W\libs\shared\src\lib\utils\context-fill.utils.spec.ts`; MODIFY `W\libs\shared\src\lib\utils\index.ts`
- Plan reference: Component 2b (:278-289), formula table and F-table (:140-199), CX1 (:766-774)
- Acceptance: F1-F6 pass; output tokens are not a parameter of `contextFillTokens`; `contextFillPercent` rounds to 0.1, unclamped, null for bad input.
- Tests: `context-fill.utils.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/shared -- --testPathPatterns="context-fill"`
- Batch gate: `npm run verify -- -p @ptah-extension/shared`, then `H`
- UI: no

## Batch B3a: Generation ceiling export — COMPLETE

- Wave: 2 | Phase: 1 | Depends on: none
- Recommended executor: CLI lane codex (backend TS) | Fallback: other family -> backend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: agent-generation

### Task B3a.1: Export `ENHANCED_PROMPTS_RUN_CEILING_MS` — COMPLETE

- Files: MODIFY `W\libs\backend\agent-generation\src\lib\services\enhanced-prompts\enhanced-prompts.service.ts`, `W\libs\backend\agent-generation\src\lib\services\enhanced-prompts\index.ts`, `W\libs\backend\agent-generation\src\index.ts`
- Plan reference: Component 3 (:290-323), B3a (:775-783)
- Acceptance: importable from `@ptah-extension/agent-generation`; equals `GENERATION_LOCK_TIMEOUT_MS + GENERATION_LOCK_GRACE_MS`; lock behaviour unchanged.
- Tests: existing enhanced-prompts service specs pass unchanged
- Lane check: `npm run verify -- -t test -p @ptah-extension/agent-generation -- --testPathPatterns="enhanced-prompts"`
- Batch gate: `npm run verify -- -p @ptah-extension/agent-generation`, then `H`
- UI: no

## Batch B4: Reactive cross-workspace lookup — COMPLETE

- Wave: 2 | Phase: 1 | Depends on: none
- Recommended executor: CLI lane codex (Angular signals) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-state

### Task B4.1: `backgroundTabsRevision` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-state\src\lib\tab-workspace-partition.service.ts`, `W\libs\frontend\chat-state\src\lib\tab-workspace-partition.service.spec.ts`, `W\libs\frontend\chat-state\src\lib\tab-manager.service.ts`, `W\libs\frontend\chat-state\src\lib\tab-manager.service.spec.ts`
- Plan reference: Component 4 (:324-343), B4 (:793-801)
- Acceptance: the four writers bump the revision once each, including `removeWorkspaceState` (`tab-workspace-partition.service.ts:460`); active-only sync does not; a tracked lookup re-runs after a background update and resolves to `null` after workspace removal.
- Tests: both specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-state -- --testPathPatterns="tab-workspace-partition|tab-manager.service"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-state`
- UI: no

## Batch TC1: Turn count contract, ledger and aggregator — COMPLETE

- Wave: 3 | Phase: 1 | Depends on: TC0
- Recommended executor: CLI lane codex (backend TS) | Fallback: other family -> backend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: shared, agent-sdk

### Task TC1.1: `turnCount` on `SessionStatsEntry` via ledger paths — COMPLETE

- Files: MODIFY `W\libs\shared\src\lib\types\rpc\rpc-session.types.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-usage-ledger.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-usage-aggregator.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-usage-aggregator.spec.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`
- Plan reference: Component 18 (:528-601), TC1 (:811-819)
- Validation notes: R-C. `ledgerFromMessages` forwards `isMeta`, `isSidechain`, `isCompactSummary` (TC0) and `message.content`.
- Acceptance: every ledger-path entry (sessions list, resume prefix) carries `turnCount`; a contribution with any missing value omits it; parity fixture gives 2 on raw-ledger and resume paths; a compact-summary user record is never a prompt; perf spec passes.
- Tests: `session-usage-aggregator.spec.ts`, `session-history-reader.service.spec.ts`, `session-stats-reader.perf.spec.ts` (unchanged)
- Lane check: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="session-usage-aggregator|session-history-reader.service|session-stats-reader.perf"`
- Batch gate: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk`, then `H`
- UI: no

## Batch CX3: Context helpers in chat-state and chat-ui — COMPLETE

- Wave: 3 | Phase: 1 | Depends on: CX1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-state, chat-ui

### Task CX3.1: Route the trust predicate and percent through shared helpers — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-state\src\lib\live-context-stats.ts`, `W\libs\frontend\chat-state\src\lib\live-context-stats.spec.ts`, `W\libs\frontend\chat-state\src\index.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-view.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-view.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.spec.ts`
- Plan reference: Component 19 (:602-624), CX3 (:848-856)
- Acceptance: no local trust predicate or percent formula remains in these files; `contextFillStats` exported from `@ptah-extension/chat-state`; `sessionContextCue` output identical; F2, F3, F6, F8 pass.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-state,@ptah-extension/chat-ui -- --testPathPatterns="live-context-stats|session-stats-view|session-stats-summary"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-state,@ptah-extension/chat-ui`, then `H` (public export)
- UI: no (identical output)

## Batch B8a: Transcript clocks — COMPLETE

- Wave: 3 | Phase: 1 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B8a.1: Replace `TranscriptLiveClock` and lane-transcript `monitor.tick` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\organisms\transcript\lane-transcript.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\transcript\lane-transcript.component.spec.ts`; DELETE `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-live-clock.ts`
- Plan reference: Component 8 (:394-406), B8a (:923-931); removal approved (decisions #5)
- Validation notes: confirm the `liveTurns` predicate name in lane-transcript; else `isStreaming()`.
- Acceptance: live elapsed label unchanged; no `TranscriptLiveClock` and no `monitor.tick` read in these files.
- Tests: both specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-transcript.component|lane-transcript.component"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: no

## Batch B3b: Host regeneration flag — COMPLETE

- Wave: 4 | Phase: 1 | Depends on: B3a
- Recommended executor: CLI lane codex (backend TS) | Fallback: other family -> backend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: shared, rpc-handlers

### Task B3b.1: `regenerationStartedAt` contract + handler reconciliation — COMPLETE

- Files: MODIFY `W\libs\shared\src\lib\types\rpc\rpc-setup.types.ts`, `W\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.ts`, `W\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.spec.ts`
- Plan reference: Component 3 (:290-323), B3b (:784-792)
- Validation notes: R-F; force-release does not settle the regenerate promise (`enhanced-prompts.service.ts:323-346`), so liveness is gated by the ceiling.
- Acceptance: Component 3 verification cases 1-7, including the never-settling run past `ENHANCED_PROMPTS_RUN_CEILING_MS`.
- Tests: `enhanced-prompts-rpc.handlers.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns="enhanced-prompts-rpc"`
- Batch gate: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers`, then `H`
- UI: no

## Batch CX4: Live derivation and resume carry-forward — COMPLETE

- Wave: 4 | Phase: 1 | Depends on: CX1, CX3
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task CX4.1: Shared formula in derivation; carry-forward on both resume branches — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\services\chat-store\session-live-stats.util.ts`, `W\libs\frontend\chat\src\lib\services\chat-store\session-live-stats.util.spec.ts`, `W\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`, `W\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts`
- Plan reference: Component 19 (:602-624), CX4 (:857-865)
- Validation notes: **R-A** — `session-loader.service.ts:1324` contains a literal NUL byte inside a template literal. Preserve it; report `grep -c -aP '\x00'` before and after (must both be 1). R-E.
- Acceptance: F2-F4 in derivation; F10 in all three cases; F12 in all four (no-snapshot latest compact boundary resumes prior 30,000/200,000 at 15%); `normalizeModelKey` equality on both branches; compaction-seed branch unchanged.
- Tests: `session-live-stats.util.spec.ts`, `session-loader.service.spec.ts`, `session-loader.resync-live-seed.spec.ts` (unchanged)
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-live-stats.util|session-loader"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 1 visual): known context % survives Ctrl+R and session re-open; repeat after `/compact`.

## Batch B5a: chat-ui clock consumers — COMPLETE

- Wave: 4 | Phase: 1 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-ui

### Task B5a.1: Cache tile, boot progress, spec migration off `CacheCountdownClockService` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-cache-tile.component.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-cache-tile.component.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-session-stats.component.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\boot-progress\boot-progress.component.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\boot-progress\boot-progress.component.spec.ts`
- Plan reference: Component 6 (:360-382), B5a (:884-892)
- Acceptance: `grep -rn "CacheCountdownClockService" libs apps` hits only the service file and its own spec; boot label unchanged.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns="inspector-cache-tile|inspector-session-stats|boot-progress"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: no

## Batch TC2: Live owner turn count — COMPLETE

- Wave: 5 | Phase: 1 | Depends on: TC1
- Recommended executor: CLI lane codex (backend TS) | Fallback: other family -> backend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: agent-sdk

### Task TC2.1: Owner turn count — COMPLETE

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.spec.ts`
- Plan reference: Component 18 (:528-601), TC2 (:820-828)
- Validation notes: R-D; confirm and report the one-SDK-result-per-prompt assumption on a fresh read (`:864-891`, `runContribution` `:1091-1136`).
- Acceptance: prefix plus accepted results; duplicates do not count; provisional estimate carries `turnCount: 0` (prefix 4 + 2 accepted + estimate = 6); incomplete runs and unreadable prefixes omit the field.
- Tests: `session-stats-owner.service.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="session-stats-owner"`
- Batch gate: `npm run verify -- -p @ptah-extension/agent-sdk`, then `H`
- UI: no

## Batch TC3: Snapshot validator — COMPLETE

- Wave: 5 | Phase: 1 | Depends on: TC1
- Recommended executor: CLI lane codex (TS) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-state

### Task TC3.1: Validate `turnCount` at the boundary — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-state\src\lib\session-stats-snapshot.ts`, `W\libs\frontend\chat-state\src\lib\session-stats-snapshot.spec.ts`
- Plan reference: Component 18 (:528-601), TC3 (:829-837)
- Acceptance: valid `turnCount` passes; absent passes (older host); negative, fractional or string rejects the snapshot.
- Tests: `session-stats-snapshot.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-state -- --testPathPatterns="session-stats-snapshot"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-state`
- UI: no

## Batch CX5: Context view pin tests — COMPLETE

- Wave: 5 | Phase: 1 (tests only) | Depends on: CX3
- Recommended executor: CLI lane codex (Angular tests) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task CX5.1: Pin inspector tile and empty-state ring — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\services\session-stats\session-stats-source.spec.ts`, `W\libs\frontend\chat\src\lib\services\vitals\chat-vitals.store.spec.ts`
- Plan reference: "Every frontend view of context %" (:200-227), CX5 (:866-874)
- Acceptance: F2, F3, F5, F6 through `SessionStatsSource.inputs().context` and `ChatVitalsStore.context()`. Test-only; no source change.
- Tests: the two specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-stats-source|chat-vitals.store"`
- Batch gate: `npm run verify -- -t test -p @ptah-extension/chat`
- UI: no

## Batch CX2: Host context formula sites — COMPLETE

- Wave: 6 | Phase: 1 | Depends on: CX1, TC1 (serial on `session-history-reader.service.ts` + spec)
- Recommended executor: CLI lane codex (backend TS) | Fallback: other family -> backend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: agent-sdk

### Task CX2.1: `contextFillTokens` at both host sites; sidechain skip — COMPLETE

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.live-stats.spec.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`
- Plan reference: Component 20 (:625-634), CX2 (:838-847)
- Validation notes: rebase mentally on TC1's committed edits to the reader. Report any fixture whose payload changes (F13/F14).
- Acceptance: both sites call `contextFillTokens`; `extractContextSnapshot` skips sidechain assistant frames and compact boundaries; F1, F3, F7, F9, F11, F13, F14 pass; existing payloads byte-identical.
- Tests: `stream-transformer.live-stats.spec.ts`, `session-history-reader.service.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="stream-transformer.live-stats|session-history-reader.service"`
- Batch gate: `npm run verify -- -p @ptah-extension/agent-sdk`, then `H`
- UI: no

## Batch HB1: Harness builder context summary — COMPLETE

- Wave: 6 | Phase: 1 | Depends on: CX3
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: harness-builder

### Task HB1.1: Collapsed summary via `sessionContextCue` — COMPLETE

- Files: MODIFY `W\libs\frontend\harness-builder\src\lib\components\sidebar\builder-session-section.component.ts`, `W\libs\frontend\harness-builder\src\lib\components\sidebar\builder-session-section.component.spec.ts`
- Plan reference: Component 23 (:658-671), HB1 (:875-883)
- Acceptance: F2 renders `Context 65%`; both F6 inputs render `Context —`; never `Context 0%` for untrusted/missing window; `Context — · Cost unavailable` case unchanged; no new import edge.
- Tests: `builder-session-section.component.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/harness-builder -- --testPathPatterns="builder-session-section"`
- Batch gate: `npm run verify -- -p @ptah-extension/harness-builder`
- UI: yes (Phase 1 visual): resumed unknown window `Context 0%` -> `Context —`; live known window unchanged.

## Batch B5b: Delete `CacheCountdownClockService` — COMPLETE

- Wave: 6 | Phase: 1 | Depends on: B5a
- Recommended executor: CLI lane codex | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-ui

### Task B5b.1: Delete service and spec — COMPLETE

- Files: DELETE `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\cache-countdown-clock.service.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\cache-countdown-clock.service.spec.ts`
- Plan reference: Proposed Removals row 1 (approved, decisions #5), B5b (:893-901)
- Acceptance: `grep -rn "CacheCountdownClockService\|cache-countdown-clock" libs apps` returns nothing.
- Tests: chat-ui suite
- Lane check: the grep above
- Batch gate: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: no

## Batch B16: Settings clocks and T1 UI — COMPLETE

- Wave: 7 | Phase: 2 | Depends on: B1, B3b
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B16.1: Drawer on host `regenerationStartedAt`; wizard and account-row clocks — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\settings\pro-features\system-prompt-drawer.component.ts`, `W\libs\frontend\chat\src\lib\settings\pro-features\system-prompt-drawer.component.spec.ts`, `W\libs\frontend\chat\src\lib\settings\providers\provider-setup-wizard.component.ts`, `W\libs\frontend\chat\src\lib\settings\providers\provider-setup-wizard.component.spec.ts`, `W\libs\frontend\chat\src\lib\settings\providers\accounts\ambient-account-row.component.ts`, `W\libs\frontend\chat\src\lib\settings\providers\accounts\ambient-account-row.component.spec.ts`
- Plan reference: Component 13 (:465-489), B16 (:1004-1012); removal of the client regenerate heuristic approved (decisions #5)
- Acceptance: drawer, wizard and row cases of the Component 13 seam, including coarse-tick reconciliation and the absent-field (older host) case; wizard `probeTimer` `setInterval` removed; destroy cancels the probe.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="system-prompt-drawer|provider-setup-wizard|ambient-account-row"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): drawer during a running regeneration, after close and reopen.

## Batch B6: Countdown cards — COMPLETE

- Wave: 7 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-ui

### Task B6.1: Permission and question countdowns on the wall clock — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-ui\src\lib\molecules\permissions\permission-request-card.component.ts`; CREATE `W\libs\frontend\chat-ui\src\lib\molecules\permissions\permission-request-card.component.spec.ts`; MODIFY `W\libs\frontend\chat-ui\src\lib\molecules\question-card.component.ts`; CREATE `W\libs\frontend\chat-ui\src\lib\molecules\question-card.component.spec.ts`
- Plan reference: Component 6 (:360-382), B6 (:902-913)
- Acceptance: deny fires exactly once, including an already-expired mount; after expiry `jest.getTimerCount() === 0` and the release was called; no acquire when `timeoutAt === 0`.
- Tests: the two new specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns="permission-request-card|question-card"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: no

## Batch B10: Lane usage resolver — COMPLETE

- Wave: 7 | Phase: 2 | Depends on: B2
- Recommended executor: CLI lane codex (TS/Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B10.1: `resolveCliLaneUsage` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\utils\lane-stats.adapters.ts`, `W\libs\frontend\chat\src\lib\utils\lane-stats.adapters.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-lane-usage-summary.component.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-lane-usage-summary.component.spec.ts`
- Plan reference: Component 9 (:407-420), B10 (:941-949)
- Acceptance: `resolveCliLaneUsage` exists (host `usageTotals` first, segments fallback marked partial); `cliLaneStats` unchanged for existing fixtures; partial renders `≥`.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="lane-stats.adapters|stats-bar.utils|cli-lane-usage-summary"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: no

## Batch B11: Lane usage consumers + agent card clock — COMPLETE

- Wave: 8 | Phase: 2 | Depends on: B1, B10
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B11.1: Header, summary and inspector on one resolver; agent card off `store.tick` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agent-usage.ts`; CREATE `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agent-usage.spec.ts`
- Plan reference: Component 10 (:421-433), B11 (:950-958)
- Acceptance: header, summary and inspector agree for one fixture; no `store.tick` in agent-card (`:286,300` today).
- Tests: `cli-agent-output.component.spec.ts`, `inspector-agent-usage.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="cli-agent-output|inspector-agent-usage"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): CLI agent card header with the partial `≥` cue.

## Batch B7: chat-ui metric views — COMPLETE

- Wave: 8 | Phase: 2 | Depends on: B2
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-ui

### Task B7.1: Token badge total and rail known-0% — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-ui\src\lib\atoms\token-badge.component.ts`, `W\libs\frontend\chat-ui\src\lib\atoms\token-badge.component.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.spec.ts`
- Plan reference: Component 7 (:383-393), B7 (:914-922)
- Validation notes: rail input is already `input<number | null>(null)` (`:404`); the fix is the `?? 0` at `:443`.
- Acceptance: badge total includes both cache classes; `NaN`/null renders `—` with tooltip `Token usage unavailable`; rail shows known `0%`, hides `null`.
- Tests: the two specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns="token-badge|compact-rail-card"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: yes (Phase 2 visual): message token badge on a cached turn; compact rail card at 0%.

## Batch B19a: Canvas + indexing — COMPLETE

- Wave: 8 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: canvas, workspace-indexing

### Task B19a.1: Lane tabs, empty board day key, indexing relative time — COMPLETE

- Files: MODIFY `W\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-tabs.component.ts`, `W\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-tabs.component.spec.ts`, `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-empty-board.component.ts`, `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-empty-board.component.spec.ts`, `W\libs\frontend\workspace-indexing\src\lib\workspace-indexing.component.ts`, `W\libs\frontend\workspace-indexing\src\lib\workspace-indexing.component.spec.ts`
- Plan reference: Component 16 (:511-521), B19a (:1031-1042)
- Acceptance: lane tabs advance 1 s per fake second while ticking, `getTimerCount() === 0` when not, no local `setInterval`; empty-board day key flips at local midnight, load-wait `setTimeout` unchanged; indexing label changes after 30 s and not between ticks.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/canvas,@ptah-extension/workspace-indexing -- --testPathPatterns="canvas-lane-tabs|canvas-empty-board|workspace-indexing.component"`
- Batch gate: `npm run verify -- -p @ptah-extension/canvas,@ptah-extension/workspace-indexing`
- UI: no

## Batch B8b: Lane and compact card clocks — COMPLETE

- Wave: 9 | Phase: 2 | Depends on: B1 (soft: B7, R-H)
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B8b.1: Subagent lane and compact card on the wall clock; strict context cue — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.ts`, `W\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.spec.ts`
- Plan reference: Component 8 (:394-406), B8b (:932-940)
- Acceptance: elapsed survives a remount; no per-card interval (`compact-session-card.component.ts:518` today); no `monitor.tick` in subagent-lane (`:291,324` today); F2 = 65 and F6 = null on the card.
- Tests: both specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="subagent-lane.component|compact-session-card"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): compact card context badge after a resume; unknown window hidden instead of `0%`.

## Batch B13a: Inspector components — COMPLETE

- Wave: 9 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B13a.1: Agents-section clock; orchestrator "In" = uncached input — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agents-section.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agents-section.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\session-inspector.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\session-inspector.component.spec.ts`
- Plan reference: Component 12 (:441-464), B13a (:968-976)
- Validation notes: R-J — do not change `session-inspector.types.ts` or the store (B13b owns the store).
- Acceptance: no section interval when no agent runs (`getTimerCount() === 0`); elapsed advances while one runs; "In" equals `tokens.input`.
- Tests: the two specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="inspector-agents-section|session-inspector.component"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): inspector orchestrator row "In" value.

## Batch B19b: Git + memory — COMPLETE

- Wave: 9 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: git-ui, memory-curator-ui

### Task B19b.1: History timeline, stash popover, memory diagnostics on the coarse clock — COMPLETE

- Files: MODIFY `W\libs\frontend\git-ui\src\lib\history\history-timeline.component.ts`, `W\libs\frontend\git-ui\src\lib\history\history-timeline.component.spec.ts`, `W\libs\frontend\git-ui\src\lib\stash\stash-popover.component.ts`, `W\libs\frontend\git-ui\src\lib\stash\stash-popover.component.spec.ts`, `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`, `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`
- Plan reference: Component 16 (:511-521), B19b (:1043-1055)
- Acceptance: "ago" labels advance after 30 s with no new data; `stashAge` signature unchanged and fed the coarse `now()`; memory `now` from the coarse clock, not `recentEvents`; `getTimerCount() === 0` after destroy.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/git-ui,@ptah-extension/memory-curator-ui -- --testPathPatterns="history-timeline|stash-popover|memory-diagnostics-accordion"`
- Batch gate: `npm run verify -- -p @ptah-extension/git-ui,@ptah-extension/memory-curator-ui`
- UI: no

## Batch B12: Turn metrics — COMPLETE

- Wave: 10 | Phase: 2 | Depends on: B2
- Recommended executor: CLI lane codex (TS/Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B12.1: Cache classes in turn facts — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\utils\turn-facts.utils.ts`; CREATE `W\libs\frontend\chat\src\lib\utils\turn-facts.utils.spec.ts`; MODIFY `W\libs\frontend\chat\src\lib\components\molecules\turn\turn-activity-panel.component.ts`
- Plan reference: Component 11 (:434-440), B12 (:959-967)
- Acceptance: cache classes appear; coverage labels unchanged.
- Tests: `turn-facts.utils.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="turn-facts.utils"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): turn activity tokens row.

## Batch B13b: Inspector store — COMPLETE

- Wave: 10 | Phase: 2 | Depends on: B2, B4, TC1 (soft: CX3, R-I)
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B13b.1: Host tokens, host `turnCount`, strict context, cross-workspace — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\services\session-inspector\session-inspector.store.ts`; CREATE `W\libs\frontend\chat\src\lib\services\session-inspector\session-inspector.store.spec.ts`
- Plan reference: Component 12 (:441-464), B13b (:977-985)
- Acceptance: `tokenCount` absent -> `tokens: null`; F2, F6; turns precedence (host 7 with cursor -> 7; none and no cursor -> loaded count; none with cursor -> null; host 0 -> 0); background update re-evaluates; workspace removal -> null stats.
- Tests: `session-inspector.store.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-inspector.store"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): tokens `—` without host `tokenCount`; host turn count on a paged history; context `—` for an unknown window.

## Batch B19c: Setup wizard — COMPLETE

- Wave: 10 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: setup-wizard

### Task B19c.1: Root-owned analysis start; dashboard and shell clocks — COMPLETE

- Files: MODIFY `W\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`, `W\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts`, `W\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts`; CREATE `W\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.spec.ts`; MODIFY `W\libs\frontend\setup-wizard\src\lib\components\generation-workflow-shell.component.ts`, `W\libs\frontend\setup-wizard\src\lib\components\generation-workflow-shell.component.spec.ts`
- Plan reference: Component 5 (:344-359), Component 16 (:511-521), B19c (:1056-1064)
- Acceptance: elapsed derived from the root start, correct after a remount and after `reset()`; handoff countdown unchanged in whole seconds; dashboard `setInterval` (`:229`) and shell 250 ms interval (`:453`) gone.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/setup-wizard -- --testPathPatterns="setup-wizard-state|analysis-stats-dashboard|generation-workflow-shell"`
- Batch gate: `npm run verify -- -p @ptah-extension/setup-wizard`
- UI: no

## Batch B14: Subagent tool count + inline duration — COMPLETE

- Wave: 11 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B14.1: `subagentToolCount`; tile and inline bubble — COMPLETE

- Files: CREATE `W\libs\frontend\chat\src\lib\utils\subagent-tool-count.ts`, `W\libs\frontend\chat\src\lib\utils\subagent-tool-count.spec.ts`; MODIFY `W\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts`, `W\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts`
- Plan reference: Component 15 (:496-510), B14 (:986-994)
- Acceptance: lag-plus-trim test (3 -> 2 -> 3); count carries `title="Current known count"`; inline duration ticks while running.
- Tests: the three specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="subagent-tool-count|subagent-tile|inline-agent-bubble"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: yes (Phase 2 visual): inline agent bubble duration while running.

## Batch B15: Workspace loading start — COMPLETE

- Wave: 11 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: core, chat

### Task B15.1: Root-owned loading start; coarse day key — COMPLETE

- Files: MODIFY `W\libs\frontend\core\src\lib\services\electron-layout.service.ts`, `W\libs\frontend\core\src\lib\services\electron-layout.service.spec.ts`, `W\libs\frontend\chat\src\lib\components\templates\workspace-loading-state.component.ts`, `W\libs\frontend\chat\src\lib\components\templates\workspace-loading-state.component.spec.ts`
- Plan reference: Component 5 (:344-359), B15 (:995-1003)
- Validation notes: confirm `restoreLayout` -> `syncFromBackend` on a fresh read.
- Acceptance: hint deadline anchored on the service start; day key follows the coarse clock.
- Tests: both specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/core,@ptah-extension/chat -- --testPathPatterns="electron-layout.service|workspace-loading-state"`
- Batch gate: `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat`
- UI: no

## Batch B18: Command Center — COMPLETE

- Wave: 11 | Phase: 2 | Depends on: B1, B4 (soft: CX3, R-I)
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: command-center

### Task B18.1: Cross-workspace stats; core clock; delete `commandCenterClock` — COMPLETE

- Files: MODIFY `W\libs\frontend\command-center\src\lib\components\command-center-page.component.ts`, `W\libs\frontend\command-center\src\lib\components\command-center-page.component.spec.ts`, `W\libs\frontend\command-center\src\lib\components\command-center-page.controller.ts`, `W\libs\frontend\command-center\src\lib\components\command-center-page.controller.spec.ts`; DELETE `W\libs\frontend\command-center\src\lib\components\command-center-clock.ts`, `W\libs\frontend\command-center\src\lib\components\command-center-clock.spec.ts`
- Plan reference: Component 14 (:490-495), B18 (:1022-1030); removal approved (decisions #5)
- Validation notes: confirm the `page.tabs` field type in the controller.
- Acceptance: background tab yields stats and re-renders on update; `contextCue().percent === 65` for F2; `grep -rn "commandCenterClock\|command-center-clock" libs apps` returns nothing.
- Tests: page and controller specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/command-center -- --testPathPatterns="command-center-page"`
- Batch gate: `npm run verify -- -p @ptah-extension/command-center`
- UI: yes (Phase 2 visual): Command Center with the root tab in a background workspace.

## Batch B17: Notices and welcome clocks — COMPLETE

- Wave: 12 | Phase: 2 | Depends on: B1
- Recommended executor: CLI lane codex (Angular) | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat

### Task B17.1: Overview tab, resume banner, welcome on the coarse clock — COMPLETE

- Files: MODIFY `W\libs\frontend\chat\src\lib\settings\providers\connection-drawer\overview-tab.component.ts`, `W\libs\frontend\chat\src\lib\settings\providers\connection-drawer\overview-tab.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts`, `W\libs\frontend\chat\src\lib\components\templates\electron-welcome.component.ts`, `W\libs\frontend\chat\src\lib\components\templates\electron-welcome.component.spec.ts`
- Plan reference: Component 13 (:465-489), B17 (:1013-1021)
- Acceptance: age labels advance every 30 s while open; no per-row interval (overview `:313` today).
- Tests: overview and welcome specs
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="overview-tab|electron-welcome"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat`
- UI: no

## Batch B20: Retire the monitor tick — COMPLETE

- Wave: 12 | Phase: 2 | Depends on: B8a, B8b, B11
- Recommended executor: CLI lane codex | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-streaming

### Task B20.1: Remove `tick` + `startTick/stopTick/syncTick` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts` (+ `W\libs\frontend\chat-streaming\src\lib\agent-monitor.store.spec.ts` only if it references the tick)
- Plan reference: Component 17 (:522-527), B20 (:1065-1073); removal approved (decisions #5)
- Validation notes: precondition grep (non-spec) `grep -rnE "(store|monitor)\.tick\(\)" libs/frontend --include=*.ts` returns nothing before the edit; all `syncTick()` call sites (`:1550,1753,2137,2239,2259`) and `stopTick()` (`:1283`) removed with it.
- Acceptance: grep precondition holds; dependants typecheck.
- Tests: `agent-monitor.store.spec.ts`
- Lane check: `npm run verify -- -t test -p @ptah-extension/chat-streaming -- --testPathPatterns="agent-monitor.store"`
- Batch gate: `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat,@ptah-extension/canvas`, then `H-web` (public member removed)
- UI: no

## Batch B21: Delete `SessionCostSummaryComponent` — COMPLETE

- Wave: 12 | Phase: 2 | Depends on: none (placed late to keep earlier chat-ui/chat waves at <=2 per project)
- Recommended executor: CLI lane codex | Fallback: other family -> frontend-developer subagent
- Subagent reason: N/A | Execution mode: sequential | Tasks: 1 | Libs: chat-ui, chat

### Task B21.1: Delete component and both exports — COMPLETE

- Files: DELETE `W\libs\frontend\chat-ui\src\lib\molecules\session\session-cost-summary.component.ts`; MODIFY `W\libs\frontend\chat-ui\src\index.ts` (`:114`), `W\libs\frontend\chat\src\lib\components\index.ts` (`:103`)
- Plan reference: Component 21 (:635-642), B21 (:1074-1082); removal approved (decisions #5)
- Validation notes: R-K — keep shared `SessionCostSummary` / `calculateSessionCostSummary`.
- Acceptance: `grep -rn "SessionCostSummaryComponent\|ptah-session-cost-summary" libs apps` returns nothing; `SessionStatsSummaryComponent` still re-exported.
- Tests: chat-ui and chat suites
- Lane check: the grep above
- Batch gate: `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat`, then `H`
- UI: no

## Escalations

None at design level. Every issue found was fixed by ordering or a check-level rule:
R-A (NUL byte in `session-loader.service.ts`) is an executor-handling risk, not a design defect;
R-B (shared-worktree parallel checks) is handled by the two check levels; R-H, R-I, R-J by wave
placement.
