# Batches - TASK_2026_610_6a10

Total tasks: 51 (PR A + PR B) + PR C + 4 Phase A fixes + 5 AF5 hardening | Batches: 31 active (A 7 + AF1-AF5, B+C 19 incl. the merged final measurement M) + 4 blocked (D) | Complete: 30/31 (A1-A7, AF1, AF2, AF3, AF4, AF5 [AF5a + AF5b], B1, B2, B3, B4, B5a, B5b, B6, B7, B8a, B8b, B8c, B9, B10, C1, C2a, C2b, C3, C4) | Phase A: APPROVED (logic 8/10, style 8/10, re-review round 1)

**Status 2026-10-05:** every implementation batch for PR A and PR B+C is done and committed. PR D (D1-D4) stays
BLOCKED on TASK_2026_594. Next: (1) M, the final measurement (orchestrator running it now; base `f314a4f8a` vs head);
(2) the Phase B+C review — code-logic, code-style and visual — on the combined B1-B10, C1-C4 and M diff.

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat` (branch
`feat/task-610-a2ui-coding-chat`, HEAD = merge-base `f314a4f8a`, verified with `git merge-base`). Every path below is
absolute. Lanes never run git. The team-leader verifies and commits each batch after its scoped check passes.

## Execution defaults (recorded, from the prompt and implementation-plan.md:929-1018)

- Executors: `codex` lane for shared, backend, scripts and assets batches. `opencode` lane for Angular webview batches
  (opencode has no messaging: each prompt is self-contained, with absolute paths, the plan line ranges, the pattern
  file and the exact verification command). A subagent (`frontend-developer`) where a batch needs judgement a lane
  cannot exercise (B5b, B6). Fallbacks: `backend-developer` for codex, `frontend-developer` for opencode.
- At most 3 batches in flight, all file-disjoint.
- Concurrency rule: two lanes may write to the same Nx project (for example A1 and A7 in `shared`) only on disjoint
  files. Lanes run only their own spec files while working. The team-leader runs the batch's full scoped
  `run-many` command serially at verification time, so a peer lane's half-finished file cannot fail another batch.
- PR boundary: plan rows say "PR A merged" for B1, B8a, B8c and B10. The prompt starts PR A and PR B now, and none of
  those batches has a code dependency on PR A (verified below). Default chosen: one branch, commits may interleave,
  dependencies are on committed batches, not on merged PRs. At the PR A cut the team-leader cherry-picks the A-batch
  commits (file-disjoint from every B commit, so they apply cleanly) onto `feat/task-610-pr-a`; PR B stacks on it.
- PR B + C merged (user decision 2026-10-04, context.md:121-126): PR B and PR C ship as one PR. C1-C4 are active and
  follow the B batches on the same branch; BM moves to the end and measures B+C. PR A still ships first; PR D stays
  blocked on TASK_2026_594.
- Review: one phase per PR. Phase A = A1-AM, Phase B+C = B1-B10, C1-C4, BM (one combined review). Each phase gets code-logic + style (new public API:
  shared utils exports, `chat-ui/turn-recap`, `chat-ui/ptah-ui`, `surface.index.ts` exports, `TOKENS.HOST_KIND`) +
  visual (tests row in A; blocks, fallbacks, reason line, snapshots in B; dark + light). Phase B's code-logic review
  checks B6 against TASK_2026_532 defects 1-6 and B8a-B9 against the L-7 truth table (implementation-plan.md:667-675).
- Never stage: `.ptah/specs/TASK_2026_594_31ff/task.md`, `.ptah/specs/TASK_2026_595_1c01/task.md` (pre-existing,
  unrelated modifications in this worktree).

## Plan validation

Status: PASSED WITH RISKS (4 plan defects fixed by re-splitting; no BLOCKER for PR A or PR B)

Plan defects found and how this decomposition resolves them:

1. **B4/B5 order is infeasible as written.** B4 creates `ptah-ui-block.component.ts`, which "registers with
   `PtahUiLiveWindow` and renders snapshot mode when not live" (implementation-plan.md:520), but `PtahUiLiveWindow` is
   created in B5 (implementation-plan.md:961), and B5 does not list `ptah-ui-block.component.ts` to wire it later.
   B4 also creates both components with no spec. Re-split: **B4** = renderer empty-title (declarative-dashboard
   only), **B5a** = live window, **B5b** = lazy entry + both components + their specs.
2. **B7 is missing a file.** B7 passes `[ptahUiOrderKey]` to the bubble (implementation-plan.md:377-378), but the
   bubble is mounted in the external template
   `libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html:50`, which B7 does not
   list (implementation-plan.md:963). Added to B7 (5 files).
3. **B10 runs before its content exists.** The reference needs "six worked examples from the corpus"
   (implementation-plan.md:693-694); the corpus is created in B3. Plan places B10 in G-B1. B10 now depends on B3.
4. **`measurement.md` has no owning batch.** Per-PR Electron measurements (implementation-plan.md:830-832,
   1011-1017) are required evidence but no batch writes them. Added **AM** and **BM** (measurement-only batches).

Queued-batch defect (fix before PR C starts):

5. **C2 is infeasible as written.** It passes `[ptahUiSnapshot]` from the transcript to the bubble, which binds at
   `chat-transcript.component.html:50`, not listed; C2 already has 6 files over 2 libs
   (implementation-plan.md:970). Adding the template makes 7. Must split into C2a (chat) and C2b (chat-ui) before
   PR C starts.

Assumptions:

- Every MODIFY path in PR A and PR B exists — verified (`test -e` over all 33 paths, run).
- `ptah-surface-authoring/SKILL.md` does not exist — verified, so B10 creates it (plan decision 9).
- A-7 `mcpToolProfile` forwarding sites: non-spec occurrences are only in `rpc-chat.types.ts`, `ai-provider.types.ts`,
  `chat-rpc.schema.ts`, `chat-session.service.ts` (6), `chat-slash-command-router.service.ts` (2),
  `sdk-query-options-builder.ts` and `mcp-apps-page/.../apps-session.service.ts` (Apps sender, out of scope) —
  verified by grep. B8b re-greps and must forward `ptahUiFence` at every site.
- A-10 DI order: `container.ts:41-42` calls `registerPhase0Platform` then `registerPhase1Infra` before phase 2 —
  verified. B8c's smoke spec pins it.
- `assembleSystemPrompt` is in `sdk-query-options-builder.ts:295` and called at `:1693`; optional-inject precedent at
  `:927, :945, :949` — verified.
- `assertEagerClosureKept` is exported (`scripts/electron-only-chunks.js:195-201`); `describeIfBuiltOrFail` and
  `PTAH_ALLOW_SKIP_UNBUILT` exist (`build-artifact-gate.ts:18, 27`); the webview has `statsJson: true`
  (`apps/ptah-extension-webview/project.json:71`) — verified.
- `chat-ui` does not import `declarative-dashboard` today (grep, no hit). The lattice allows it (`scope:webview`,
  `type:feature` → `type:ui`) — unverified against `eslint.config` depConstraints; B5b's lint run checks it.
- A-1, A-2 (Bash node shape after reload) — unverified; checked in A1 (fixture from an existing execution-tree spec)
  and A4 (session-loader fixture).
- A-3, A-4 (abort and legacy `streamingState`) — unverified; checked in A4.
- A-5 (copy reads node text, not DOM) — unverified; checked in B5b.
- A-6 (change set present after `session:turnEnded`) — PR C; recorded for C1.
- A-8, A-11 (594 `alert` tones, `dashboard-catalog/3`) — PR D; not checkable now.
- Nx project names (`project.json`, read): `@ptah-extension/shared`, `@ptah-extension/chat`,
  `@ptah-extension/chat-ui`, `@ptah-extension/declarative-dashboard`, `@ptah-extension/rpc-handlers`,
  `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `ptah-electron`. All have `typecheck`, `test`, `lint`.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Concurrent lanes in one Nx project see each other's half-written files | MEDIUM | Concurrency rule above; team-leader runs scoped checks serially |
| Shared main barrel gains zod through new utils | HIGH | A1, A2: `libs\shared\src\index.zod-free.spec.ts` must stay green (part of `shared` test run) |
| Fence mount forgeable (TASK_2026_532 defects 1-6) or leaks to VS Code | HIGH | B6 by subagent; trust and VS Code regression specs; phase B code-logic review |
| Hint reaches non-Electron sessions via a spoofed flag | HIGH | B8c host fact + B9 truth table; phase B code-logic review against L-7 |
| A6 real-build case fails closed without `stats.json` | MEDIUM | A6 verification builds the webview with `--stats-json` first |
| Parser/renderer enter the eager closure | HIGH | A6 gate; AM/BM run `npm run gate:eager-closure` and the `--base` diff |
| Registry drift (new RPC/push for host data) | MEDIUM | A7 contract spec, re-run in every `shared` test |
| `tsconfig.base.json`, `utils/index.ts`, `surface.index.ts`, `chat-transcript.component.*` edited by several batches | MEDIUM | Serialized by dependencies: A3 → B5b (tsconfig); A1 → A2 (utils barrel); A4 → B7 (transcript) |
| Live cap invariant (detach, inert, no source reads) needs design judgement | MEDIUM | B5b by subagent; instrumented 12-block test |

Edge cases:

- Quoted or chained test commands, background Bash runs — Task A1.1 / A1.2
- Missing tokens or duration → `unavailable`, never `0` — Task A2.1
- No-op turn (no card, no row), reloaded tests row, VS Code shows no row — Task A4.3
- CRLF, escapes, tabs, indentation, caps 8,192/8,193 bytes, unclosed and nested fences, `$context` — Task B1.2 / B1.3
- Markdown, HTML, URL and entity literals stay literal; no `url`/`actions` keys — Task B3.2
- Empty title renders no `<h2>` — Task B4.1
- Chunk load failure, throwing pipeline, streaming open fence, 50-chunk identity, remount of snapshot — Task B5b.2 / B5b.3
- Subagent, user, thinking and `sendMessage`-nested text stay code; forged `ptah-ui-*` HTML; VS Code — Task B6.3
- Spoofed `ptahUiFence: true` on VS Code/TUI/CLI, `apps` profile — Task B9.2

---

## Batch A1: test-command matcher and turn tests detection — COMPLETE (8bcaf4049)

- Recommended executor: codex lane
- Fallback executor: backend-developer subagent
- Execution mode: sequential (single lane)
- Rationale: pure framework-free TypeScript in `libs/shared` (L-13)
- Tasks: 3 | Depends on: none | Parallel group: W1 (A1 ∥ A6 ∥ A7)
- Requirements: Req 1.2 (R1-R6 and example table), 1.6-1.7 (status table); comp. 1
- Phase: A | Phase review: code-logic + style + visual (at AM)
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task A1.1: classifyTestCommand with quote-aware tokenizer — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\test-command-matcher.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\test-command-matcher.spec.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\test-command.fixtures.ts`
- Plan reference: implementation-plan.md:300-322; task-description.md Req 1.2
- Pattern to follow: `libs\shared\src\lib\utils\` existing pure utils (`pickPrimaryModel`)
- Quality requirements: hand-written tokenizer, no backtracking regex; never throws; fixtures in a separate module
- Validation notes: every positive and negative row of the Req 1.2 example table is a fixture
- Implementation details: segment by `&&`, `||`, `;`, `|` outside quotes, then apply R1-R6

### Task A1.2: collectTurnTests and summarizeTurnTests — COMPLETE

- Depends on: Task A1.1
- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\turn-tests.utils.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\turn-tests.utils.spec.ts`
- Plan reference: implementation-plan.md:305-310
- Validation notes: resolve A-2 (`toolName === 'Bash'`, `run_in_background` in `toolInput`) from an existing
  execution-tree spec fixture and cite it in the spec; depth-first including agent subtrees; each node once
- Implementation details: `TurnTestRun = { command; outcome: 'passed'|'failed'|'unknown' }`

### Task A1.3: export from the utils barrel — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\index.ts`
- Validation notes: `libs\shared\src\index.zod-free.spec.ts` stays green

## Batch A2: turn source snapshot and usage formatters — COMPLETE (646398350)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Rationale: pure shared TypeScript; edits the utils barrel after A1
- Tasks: 3 | Depends on: A1 | Parallel group: W2
- Requirements: Req 1.3, 1.13 (read layer), 3.1 formatter agreement; comp. 2
- Phase: A
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task A2.1: buildTurnSourceSnapshot — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\turn-sources.utils.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\turn-sources.utils.spec.ts`
- Plan reference: implementation-plan.md:324-347
- Validation notes: missing tokens or duration → `unavailable`, never `0`; `TurnChangeSet` from `rpc-change-set.types.ts:47-70`

### Task A2.2: formatUsdCost and formatDurationMs — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\usage-format.utils.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\usage-format.utils.spec.ts`
- Pattern to follow: `libs\frontend\chat-ui\src\lib\atoms\cost-badge.component.ts:64-69`, `duration-badge.component.ts:27` (byte-identical output)

### Task A2.3: export from the utils barrel — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\index.ts`

## Batch A3: badges use shared formatters; tests row; turn-recap entry — COMPLETE (705ebf32f)

- Recommended executor: opencode lane | Fallback: frontend-developer subagent | Mode: sequential
- Rationale: presentational Angular in `chat-ui`, precedent `change-set-card` entry
- Tasks: 3 | Depends on: A2 | Parallel group: W3
- Requirements: Req 1.2, 1.3 (existing badge specs pass unchanged), 1.4, 1.6, 1.7, 1.11, 1.12; NFR a11y; comp. 2-3
- Phase: A
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`

### Task A3.1: badges delegate to shared formatters — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\atoms\cost-badge.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\atoms\duration-badge.component.ts`
- Validation notes: existing badge specs must pass without edits; delete the local formatting code (no duplicate)

### Task A3.2: TurnTestsRowComponent — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.spec.ts`
- Plan reference: implementation-plan.md:348-363
- Quality requirements: standalone, OnPush; outcome as text not colour alone; nothing for empty list; axe zero
  serious/critical in both themes

### Task A3.3: `@ptah-extension/chat-ui/turn-recap` entry — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\turn-recap.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\tsconfig.base.json`
- Pattern to follow: `libs\frontend\chat-ui\src\change-set-card.ts`, `tsconfig.base.json:49-51`

## Batch A4: transcript turn grouping and Electron-only tests row — COMPLETE (75b78cb74)

- Recommended executor: opencode lane | Fallback: frontend-developer subagent | Mode: sequential
- Tasks: 3 | Depends on: A3 | Parallel group: W4
- Requirements: Req 1.1, 1.4, 1.6-1.8, 1.12, VS Code no-row [user]; comp. 4 (PR A part)
- Phase: A
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

### Task A4.1: transcript-turns.ts — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-turns.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-turns.spec.ts`
- Pattern to follow: `transcript-change-set-anchors.ts:47-60` (`anchorInTurnWindow`)
- Validation notes: resolve A-3, A-4 (cite `message-finalization.service.ts:153-171`); unknown roles skipped

### Task A4.2: tests-row mount in the transcript — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
- Implementation details: `turnTestsAnchors` computed only when `VSCodeService.isElectron`; second
  `@defer (when runs.length > 0)` after the bubble slot, importing `@ptah-extension/chat-ui/turn-recap`; change-set
  block unchanged

### Task A4.3: change-set spec extensions — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.change-set.spec.ts`
- Validation notes: card after turn-ending message (1.1); no row or card for no-op turn (1.4); one file listing
  (1.12); reloaded tests row (1.8, A-1 session-loader fixture); `isElectron=false` → no tests row

### A4 notes (verification 2026-10-04)

- Plan cite is stale: message-finalization lives at
  `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`, not
  `libs/frontend/chat/src/lib/services/chat-store/message-finalization.service.ts`.
- `changeSetForMessage` (implementation-plan.md §4) is deferred to C2a, its only consumer.
- Verified: `run-many -t typecheck,test,lint -p @ptah-extension/chat` passed (161 suites, 2964 tests, lint 0
  errors). Report: `batch-A4-report.md`.

## Batch A5: zero-model-token boundary specs — COMPLETE (6b4946e24)

- Verified 2026-10-04: `chat` run-many passed; `npx jest -c libs/backend/agent-sdk/jest.config.ts
  .../sdk-query-options-builder.host-data.spec.ts` 1/1. Orchestrator fixed the backend spec (missing `tabId`, dead
  `hostTurn`); see `batch-A5-report.md`. PR A code is complete; AM can start.

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: A4 | Parallel group: W5
- Requirements: Req 1.5, 5.12 (PR A sentinels); comp. 5
- Phase: A
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat,@ptah-extension/agent-sdk`

### Task A5.1: sender boundary spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\services\message-sender.host-data.spec.ts`
- Validation notes: serialized `ChatContinueParams` (sender `:689`) contains no sentinel (`zz_sentinel_610.ts`,
  `0.610610`, `610610`, tests label); text `ExecutionNode.content` byte-identical

### Task A5.2: builder boundary spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.host-data.spec.ts`
- Pattern to follow: positional-stub construction in `sdk-query-options-builder.spec.ts`
- Validation notes: prompt and `systemPrompt.append` (`build()` `:972`, return `:1758-1762`) contain no sentinel

## Batch A6: eager-closure bundle gate — COMPLETE (4c47c7a43)

- Recommended executor: codex lane | Fallback: devops-engineer subagent | Mode: sequential
- Rationale: CommonJS script plus a node-side jest spec; precedent `packaged-deps.spec.ts`
- Tasks: 3 | Depends on: none | Parallel group: W1 (A1 ∥ A6 ∥ A7)
- Requirements: Req 5.1, 5.2, 5.9; comp. 15
- Phase: A
- Verify: `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json` then
  `npx nx run-many -t typecheck,test,lint -p ptah-electron` and `npm run gate:eager-closure`

### Task A6.1: scripts/eager-closure-gate.js — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\scripts\eager-closure-gate.js`
- Plan reference: implementation-plan.md:725-776
- Pattern to follow: `scripts\electron-only-chunks.js:150-173, 195-201` (reuse `assertEagerClosureKept`, do not copy)
- Implementation details: `forbiddenOutputs`, `assertNoForbiddenEager`, `eagerInputs`, `assertNoUnlistedEagerGrowth`,
  `FORBIDDEN_EAGER_INPUTS` and allow list exactly as the plan; CLI `<head-stats> [--base <base-stats>]`, exit 1

### Task A6.2: gate spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-electron\src\config\eager-closure-gate.spec.ts`
- Pattern to follow: `apps\ptah-electron\src\config\packaged-deps.spec.ts:69,215`; `build-artifact-gate.ts:27`
- Validation notes: synthetic cases (forbidden in `main.js` throws; in static chunk throws; only dynamic passes;
  unlisted growth with `--base` throws) plus the real-build case via `describeIfBuiltOrFail`, failing closed

### Task A6.3: npm script — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\package.json`
- Implementation details: `"gate:eager-closure": "node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json"`

## Batch A7: host-source registry contract test — COMPLETE (9814e1612)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: none | Parallel group: W1 (A1 ∥ A6 ∥ A7)
- Requirements: Req 1.13; comp. 16
- Phase: A
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task A7.1: baseline fixture — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\host-source-registry.baseline.ts`
- Implementation details: sorted `RPC_METHOD_NAMES` (`rpc.types.ts:4122`) and `Object.values(MESSAGE_TYPES)`
  (`messages/message-constants.ts:18`) captured at `f314a4f8a` (current HEAD); generate the arrays by running code,
  do not hand-type them

### Task A7.2: contract spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\host-source-registry.contract.spec.ts`
- Validation notes: header states a baseline change needs a Gate 2 exception; deep-equality on both arrays

## Batch AM: PR A Electron measurement — MERGED INTO M (plan change 2026-10-04)

- Plan change (orchestrator, 2026-10-04): AM and BM merge into one final measurement batch M that runs after C4,
  with one base build (`f314a4f8a`) measured against the final head. AM no longer gates the Phase A review; the
  Phase A review ran on A1-A7 and its fix round is AF1-AF4 below. The AM.1 content moves into M.

- Recommended executor: codex lane | Fallback: devops-engineer subagent | Mode: sequential
- Tasks: 1 | Depends on: A1-A7 | Parallel group: W6
- Requirements: Req 5.1, 5.2, 5.9, 5.10 (Electron only [user]); measurement only, no source edits
- Phase: A (last batch; triggers the Phase A review)
- Verify: `npm run gate:eager-closure` exits 0; `--base` run against `f314a4f8a` stats recorded

### Task AM.1: measurement.md (PR A section) — PENDING

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.ptah\specs\TASK_2026_610_6a10\measurement.md`
- Implementation details: initial-chunk report (evidence D5 method), eager-closure `--base` output, coding
  `tools/list` length and hash on the Electron-like host (evidence C6); base stats built in a temporary checkout of
  `f314a4f8a` that the lane does not commit

## Phase A review and fix round

- Reviews: `code-logic-review-phase-a.md` (5/10, REVISE) and `code-style-review-phase-a.md` (7/10, REVISE; 0
  blocking, 3 serious, 4 minor). Both REVISE findings are addressed by AF1-AF4 below.
- Status: **Phase A APPROVED** (2026-10-05). Re-review round 1 by the same two reviewers, scoped to
  `8bf2836a6..6d27e3c4f` (parent `36fb24ad9`): `code-logic-review-phase-a.md` 8/10 APPROVED and
  `code-style-review-phase-a.md` 8/10 APPROVED. Their minors were taken as AF5 hardening (AF5a `72d4ddca2`, AF5b
  `4fd4449e5`), not a second fix round.
- Checks before commit (team-leader, 2026-10-04): `npx nx run-many -t typecheck,test,lint -p
  @ptah-extension/shared,@ptah-extension/chat-execution-tree,@ptah-extension/chat-ui --parallel=1` exit 0 (9/9
  targets; tests 2481 + 486 + 26 = 2993 passed); `npx jest -c libs/frontend/chat/jest.config.ts
  transcript-turns.spec.ts message-sender.host-data.spec.ts` 2 suites, 12/12 passed. The full `chat` target was not
  run because C2a is editing chat files.
- Follow-up (out of scope, named later task): consolidate the 4 pre-existing cost formatters onto
  `formatUsdCost` — `compact-session-stats.component.ts:57`, `session-cost-summary.component.ts:121`,
  `session-stats-summary.component.ts:836`, `dashboard/format.utils.ts:26`.

## Batch AF1: failing test run shown as passed (blocking) — COMPLETE (8bf2836a6)

- Phase: A (fix round) | Report: `batch-AF1-report.md`
- Files: `libs/shared/src/lib/types/execution/node.ts` (`isError?`), `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts`
  (`isError: resultEvent?.isError`), `builders.spec.ts`, `libs/shared/src/lib/utils/turn-tests.utils.ts` + spec,
  `test-command-matcher.ts`; plus the orchestrator fixture fix in
  `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turns.spec.ts` (`bashNode` sets `isError`
  as the builder does). `ToolResultEvent.isError` is a required boolean (`stream.ts:172`), backend default `false`.

### Task AF1.1: outcome from `isError`, masked commands unknown — COMPLETE

## Batch AF2: bounded host-source contract and formatter docs — COMPLETE (31b66ac11)

- Phase: A (fix round) | Report: `batch-AF2-report.md`
- Files: `host-source-registry.contract.spec.ts` (bounded pattern check), `host-source-registry.baseline.ts`
  (header only), `usage-format.utils.ts` (JSDoc)

### Task AF2.1: contract spec, baseline header, JSDoc — COMPLETE

## Batch AF3: tests row a11y and real-store host-data spec — COMPLETE (041069db6)

- Phase: A (fix round) | Report: `batch-AF3-report.md` (written by the orchestrator after verifying the lane)
- Files: `turn-tests-row.component.ts` + spec (no `role="status"`, `rows()` computed),
  `message-sender.host-data.spec.ts` (real `ChangeSetStore`, positive and negative controls)

### Task AF3.1: tests row and host-data spec — COMPLETE

## Batch AF4: CI enforces the eager-closure gate — COMPLETE (6d27e3c4f)

- Phase: A (fix round) | Report: `batch-AF4-report.md`
- Files: `.github/workflows/ci.yml` — `Enforce eager-closure bundle gate` after `nx affected -t build`, guarded by
  `hashFiles('dist/apps/ptah-extension-webview/stats.json') != ''` (webview default build is production with
  `statsJson`)

### Task AF4.1: CI gate step — COMPLETE

## Batch AF5: hardening (Phase A re-review minors + review-dock flake) — COMPLETE (AF5a 72d4ddca2, AF5b 4fd4449e5)

- Committed as two batches (2026-10-05): **AF5a** `72d4ddca2` = AF5.2, AF5.4, AF5.5 (shared schema `isError` +
  `schemas.spec.ts`, `scripts/generate-host-source-registry-baseline.ts`, baseline header, contract spec pins
  removals); report `batch-AF5a-report.md`. **AF5b** `4fd4449e5` = AF5.1, AF5.3 (gate fails without `main.js`, gate
  spec 6 tests, review-dock spec mocks `chat-ui/ptah-ui` with a commented 20 s cold-test timeout); report
  `batch-AF5b-report.md`.
- Checks before commit: orchestrator ran full `shared` typecheck/test/lint (no cache) and the full `chat` test run,
  both pass; team-leader ran `nx run-many -t typecheck,lint -p @ptah-extension/chat,@ptah-extension/agent-sdk,ptah-electron
  --parallel=1` (6/6) and jest `eager-closure-gate.spec.ts` 6/6, `electron-shell.review-dock.spec.ts` with the
  host-data spec 2 suites 5/5.

- Source: Phase A re-review round 1 (`code-logic-review-phase-a.md`, `code-style-review-phase-a.md`, both
  APPROVED with minors) and the review-dock flake recorded at the B7+C2a commit (18f51a600).
- Recommended executor: CLI lanes x 3, one per lib group (AF5.1 | AF5.2 | AF5.3-AF5.5) | Fallback: frontend-developer
  (AF5.1), backend-developer (AF5.2), devops-engineer (AF5.3-AF5.5) | Mode: parallel
- Rationale: three file-disjoint groups, none touching a shared registry or entry point. This is more than 6 files
  across 3 areas, so each lane runs only its own scoped verify.
- Depends on: AF4 (committed) | Runs in parallel with C4 (file-disjoint, confirmed under C4)
- Phase: A (hardening) | Phase review: code-logic, scoped to the AF5 diff

### Task AF5.1: review-dock cold-load flake — COMPLETE (AF5b)

- File: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\templates\electron-shell.review-dock.spec.ts`
- Mock the lazy `@ptah-extension/chat-ui/ptah-ui` entry in this spec (preferred), or raise the test timeout with a
  comment giving the reason (the cold lazy-chunk compile under full-suite load). It must still assert that nothing
  loads before the dock opens.
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1`, full suite, with zero failures.

### Task AF5.2: `isError` in `ExecutionNodeSchema` (logic N1) — COMPLETE (AF5a)

- File: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\execution\schemas.ts`
  (object at about :53-75; `isError` is on `ExecutionNode`, `node.ts:155-156`, since AF1)
- Add `isError: z.boolean().optional()` and a schema spec case that keeps the value through a parse.
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task AF5.3: eager-closure gate fails without `main.js` (logic N2 / style N2) — COMPLETE (AF5b)

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\scripts\eager-closure-gate.js`,
  `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-electron\src\config\eager-closure-gate.spec.ts`
- Exit non-zero with a clear message when `main.js` is not found in the stats, and add a spec case for it.

### Task AF5.4: baseline regeneration script (style N3) — COMPLETE (AF5a)

- Files: CREATE a script under `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\scripts\`
  that holds the regeneration one-liner, and MODIFY
  `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\host-source-registry.baseline.ts`
  so its header references that script.

### Task AF5.5: A7 check pins removals (style N4) — COMPLETE (AF5a)

- Depends on: AF5.4 (same lane)
- File: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\host-source-registry.contract.spec.ts`
- Fail when a baseline host-source name is removed, as well as when a new one is added.
- Verify (AF5.3-AF5.5): `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,ptah-electron`

---

## Batch B1: fence segmentation and parser — COMPLETE (dad0b4efa)

- Wave 2 result: the scoped `shared` run passed (typecheck, 90 suites / 2,393 tests, lint 0 errors), but the parser
  breaks its own B1.3 validation notes ("never throws"; unknown sources reject). Not committed.

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 3 | Depends on: none in code (see PR boundary default) | Parallel group: W2
- Requirements: grammar (EBNF, lexical table), Req 2.12, 3.3, 3.10; comp. 6
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task B1.1: ptah-ui.types.ts — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui.types.ts`

### Task B1.2: segmentPtahUi — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.spec.ts`
- Plan reference: implementation-plan.md:420-445
- Validation notes: outer-fence tracking (backtick or tilde, ≥3); unclosed stays markdown; nested fences

### Task B1.3: parsePtahUi — COMPLETE (own-key fix verified at `ptah-ui-parser.ts:143`)

- Defect (reproduced with `tsx`): `sourceName` tests `value in PTAH_UI_SOURCES`
  (`libs\shared\src\mcp-apps-contracts\ptah-ui-parser.ts:143`), which matches `Object.prototype` keys, and `isName`
  (`:146`, `/^[a-z]+$/`) admits `constructor`. Results:
  - `stats` / `  Files | $constructor.files` THROWS `Cannot read properties of undefined (reading 'includes')` at
    `:141` (`PTAH_UI_SOURCES[source.value].scalars`).
  - `table $constructor` + `  cols path` THROWS at `:98` (`...columns.includes`).
  - `list $constructor` returns `ok: true` with `source: 'constructor'` (an unknown source accepted).
- Required fix: own-key lookup (`Object.hasOwn`, or a `ReadonlySet` of the three names). Add parser spec cases for
  `$constructor` in all three positions (stats value, source table with `cols`, source list) asserting
  `unknown-source` and no throw. Only `ptah-ui-parser.ts` and `ptah-ui-parser.spec.ts` change. Re-run
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`.

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.spec.ts`
- Validation notes: caps first (8,192 bytes, 200 lines); one valid + one invalid case per lexical row; every listed
  fixture; `$diff.files` vs `\$diff.files`; `$context` unknown; never throws; `note` NOT included (PR D)

## Batch B2: converter, resolver, pipeline — COMPLETE (5284f9e89)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 3 | Depends on: B1, A2 (`TurnSourceSnapshot`, formatters) | Parallel group: W3
- Requirements: Req 2.1, 2.2, 2.4, 2.11, 2.17, 3.2-3.8 (with `null` snapshot); comp. 7
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task B2.1: convertPtahUi — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.spec.ts`
- Validation notes: per-element deep-equal fixtures; no actions/inputs/data refs; versions from `surface-catalog.ts:10-11`

### Task B2.2: resolvePtahUi — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.spec.ts`
- Validation notes: `pending`/`unavailable` text never `0`/`$0`/blank; literals never merge into source rows

### Task B2.3: renderPtahUiBlock and exports — COMPLETE (`surface.index.ts` 136 lines)

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\surface.index.ts`
- Validation notes: caps → parse → convert → resolve → `validateSurfaceDocument(doc, countBytes)`; a throw →
  `internal error`; `surface.index.ts` stays ≤150 lines (118 today); main barrel stays zod-free

## Batch B3: pipeline trust specs, corpus, compactness — COMPLETE (3282f0978)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 3 | Depends on: B2 | Parallel group: W4
- Requirements: Req 2.3, 2.8, 2.12, 3.3, 5.13; comp. 7
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task B3.1: corpus — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui.corpus.ts`
- Validation notes: ≥6 cases; B10 takes its worked examples from here

### Task B3.2: pipeline spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.spec.ts`
- Validation notes: markdown/HTML/URL/entity literals stay literal; no `url`/`actions` keys; budget breach names budget

### Task B3.3: compactness spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\mcp-apps-contracts\ptah-ui-compactness.spec.ts`
- Implementation details: `gpt-tokenizer` `encode` (4.0.0); fence tokens < `JSON.stringify(conversion)` tokens

## Batch B4: renderer omits empty title — COMPLETE (51d837c65)

- Recommended executor: opencode lane | Fallback: frontend-developer subagent | Mode: sequential
- Tasks: 1 | Depends on: none | Parallel group: W2 or later (file-disjoint from every other batch)
- Requirements: L-9; comp. 8
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/declarative-dashboard`

### Task B4.1: `@if (hasTitle())` around the heading — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.spec.ts`
- Plan reference: implementation-plan.md:494-502; heading at `surface-renderer.component.ts:190-192`
- Validation notes: existing specs unchanged and green; Apps page unchanged for non-empty titles

## Batch B5a: PtahUiLiveWindow — COMPLETE (2bbd53f93)

- Recommended executor: opencode lane | Fallback: frontend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: none | Parallel group: W3 or later
- Requirements: Req 5.4 (window half), decision 10, L-5; comp. 9
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`

- Verified 2026-10-04: chat-ui typecheck/test/lint passed (run together with B5b). Report: `batch-B5a-report.md`.

### Task B5a.1: live window service and spec — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\services\ptah-ui-live-window.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\services\ptah-ui-live-window.spec.ts`
- Implementation details: `@Injectable()` (not root); `register(key, orderKey): Signal<boolean>`; ≤512 keys; no
  timers/observers; `liveCount()` test seam; `PTAH_UI_LIVE_CAP = 8`
- Validation notes: spec covers 12 registrations, `liveCount() <= 8` after each, re-registration of a destroyed key
  keeps its position (remount case)

### Task B5a.2: main barrel export — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\index.ts`
- Validation notes: export only the window and cap; nothing from the lazy entry enters the main barrel

## Batch B5b: `chat-ui/ptah-ui` lazy entry, message text host and block — COMPLETE (9ce4f84f7)

- Verified 2026-10-04: chat-ui typecheck/test/lint passed (479 tests); `@ptah-extension/chat` typecheck passed
  (`tsconfig.base.json` alias). 12-block live-cap test: blocks 1-4 snapshot, 1 detach, 0 pipeline reruns, `inert`.
  Axe 0 serious/critical across 6 states x 2 themes. A-5 resolved. Deviation 1 accepted (`PTAH_UI_BLOCK_PIPELINE`
  declared in the block file to avoid an import cycle). Deviation 2 fixed by orchestrator decision: only
  `(renderFailed)` bound (shows the "could not display" fallback); specs pin the 4 interaction outputs unbound.
  Report: `batch-B5b-report.md`.
- Note for visual review: check the effect of `prose` styles on the renderer, and run colour contrast in the live
  app (jsdom cannot check it).

- Recommended executor: frontend-developer subagent
- Fallback executor: opencode lane with the full task text
- Execution mode: sequential
- Rationale: the live-cap invariant (frozen renderable, detached detector, `inert` subtree, hidden text alternative)
  and the instrumented 12-block test need design decisions mid-flight
- Tasks: 3 | Depends on: B2, B4, B5a, A3 (serial `tsconfig.base.json`) | Parallel group: W5
- Requirements: Req 2.3-2.7, 2.13, 2.17, 5.4, NFR a11y (axe both themes, keyboard); comp. 9
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`

### Task B5b.1: entry and path alias — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\ptah-ui.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\tsconfig.base.json`
- Implementation details: `PTAH_UI_BLOCK_PIPELINE` InjectionToken, `providedIn: 'root'`, factory `() => renderPtahUiBlock`

### Task B5b.2: PtahUiMessageTextComponent — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-message-text.component.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-message-text.component.spec.ts`
- Validation notes: markdown segments use `<markdown [data]="seg.text | surfaceMarkdown: active()">` as at
  `execution-node.component.ts:136-138`; track `md:<n>`/`ui:<ordinal>`; open fence = code; 50-chunk identity = 1

### Task B5b.3: PtahUiBlockComponent — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.spec.ts`
- Validation notes: fallback HTML identical to a normal fence; reason line `data-ptah-ui-reason` outside `<code>` with
  `aria-describedby`; throwing pipeline stub; instrumented live-cap test (blocks 1-4 snapshot with detach spy, 0
  recomputations, `inert` ancestor; blocks 5-12 live; remount 1, 6, 12); axe per state; resolve A-5 (copy sites);
  no outputs bound on the renderer; lint confirms the `chat-ui` → `declarative-dashboard` edge is allowed

## Batch B6: execution-node and bubble wiring with the Electron gate — COMPLETE (2dac29bcb)

- Verified 2026-10-04: `chat-ui,chat` run-many (`--parallel=1`) passed (orchestrator: 163 suites, 2,992 tests);
  production webview build AOT OK; eager-closure gate 720 inputs (+6 vs 714), 2,848,414 initial bytes (+7.3 KB).
- Accepted deviation: `chat-transcript.component.ts` adds only the `PtahUiLiveWindow` import and provider (diff
  checked). B7.1's provider half is therefore done; B7.1 keeps the order key, the `.html` binding and its spec.
  Report: `batch-B6-report.md`.

- MUST (from B5b): provide `PtahUiLiveWindow` in the per-tab (transcript-scoped) injector. Without it the block's
  injection fails and every block falls into the `@error` markdown.

- Recommended executor: frontend-developer subagent
- Fallback executor: opencode lane with the full task text
- Execution mode: sequential
- Rationale: security-relevant mount (TASK_2026_532 defects 1-6) and the VS Code byte-for-byte regression; needs
  judgement on `@defer`/`@placeholder`/`@error` composition and on which recursions must not forward the context
- Tasks: 3 | Depends on: B5b | Parallel group: W6
- Requirements: Req 2.1, 2.4, 2.9, 2.10, 5.2, VS Code fence stays code [user]; comp. 10
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

### Task B6.1: fence-line check and execution-node branch — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\execution\ptah-ui-fence-line.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.component.ts`
- Validation notes: `hasPtahUiFenceLine` has zero imports; `ptahUi` input forwarded only in `@case ('message')`
  (`:249-262`), never in agent (`:239-246`) or tool recursions (`:176, :205`)

### Task B6.2: bubble builds the context on Electron only — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`
- Implementation details: input `ptahUiOrderKey`; context `null` unless `role === 'assistant'` and
  `inject(VSCodeService).isElectron`; mount at `message-bubble.component.html:102-110`

### Task B6.3: execution-node ptah-ui spec — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.ptah-ui.spec.ts`
- Validation notes: VS Code (`isElectron=false`) → ordinary code block, no reason line, no `ptah-ui-*`, no deferred
  load; 2.10 scope cases; forged HTML/`data-ptah-ui-*`, ```` ```ptah-ui-x ````, indented fence → no surface; no
  deferred load without a fence line; `provide-markdown-rendering.spec.ts` untouched

## Batch B7: transcript live window and Electron sender flag — COMPLETE (18f51a600, combined with C2a)

- Verified by the orchestrator (`batch-B7-report.md`). Its transcript files (`chat-transcript.component.ts/.html`,
  `chat-transcript.ptah-ui.spec.ts`, `transcript-spec-harness.ts`) are shared with C2a, so B7 and C2a landed as one
  commit, `18f51a600`, together with the orchestrator's stub fixes (`transcript-spec-harness.ts` gains
  `ptahUiSnapshot`; `chat-view.keepalive.spec.ts` bubble stub gains `ptahUiOrderKey`/`ptahUiSnapshot`, fixing NG0303).
- Checks 2026-10-04: `run-many -t typecheck,lint -p @ptah-extension/chat` passed; jest on `organisms/`,
  `chat-view.keepalive.spec.ts`, `services/message-sender*` passed (31 suites, 381 tests). Full chat run
  (orchestrator): 3,005 passed, 1 failed, `electron-shell.review-dock.spec.ts` "loads nothing until the dock
  opens…". That failure is the cold lazy-chunk timeout flake B6 predicted, not a regression. It passes alone (2/2, twice).
  It was committed with the failure on record and is tracked as AF5.1.

- Recommended executor: opencode lane | Fallback: frontend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: B6, A4 (transcript files), B8a (`ptahUiFence` param type) | Parallel group: W7
- Requirements: Req 2.14 (client half), 5.4 (tab scope), 3.x transcript wiring with `null` snapshot; comp. 4 (PR B), 11
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

### Task B7.1: provide PtahUiLiveWindow and pass the order key — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.ptah-ui.spec.ts`
- Scope change 2026-10-04: the provider already landed in B6 (`2dac29bcb`); do not add it again. B7.1 = order key
  binding + spec (the spec must assert one `PtahUiLiveWindow` per transcript/tab).
- Implementation details: `providers: [TranscriptRenderWindow, PtahUiLiveWindow]` (`:153`, done in B6); `[ptahUiOrderKey]` on
  `<ptah-message-bubble>` at `.html:50` (file added by this decomposition, plan defect 2)

### Task B7.2: sender sets `ptahUiFence` on Electron — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\services\message-sender.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\services\message-sender.service.spec.ts`
- Implementation details: `...(this.vscode.isElectron ? { ptahUiFence: true } : {})` at `chat:start` (`:440`) and
  `chat:continue` (`:689`); spec: Electron → `true`, `isElectron=false` → key absent

## Batch B8a: `ptahUiFence` wire types and zod — COMPLETE (83dd0dca1)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: none in code | Parallel group: W2
- Requirements: Req 2.14, 1.13 (param key set = base + `ptahUiFence`); comp. 11
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers`

### Task B8a.1: types — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\rpc-chat.types.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\ai-provider.types.ts`
- Implementation details: `ptahUiFence?: boolean` beside `mcpToolProfile` (`rpc-chat.types.ts:66`, `:124-159`;
  `ai-provider.types.ts:161`)

### Task B8a.2: zod schema and spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.spec.ts`
- Validation notes: `z.boolean().optional()` at `:61, :75`; accept `true`/`false`/absent, reject `"yes"` for start
  and continue; key set = base + `ptahUiFence`

## Batch B8b: forward the flag into AISessionConfig — COMPLETE (afc0ad05b)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: B8a | Parallel group: W3
- Requirements: Req 2.14; A-7; comp. 11
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`

### Task B8b.1: propagation — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`
- Validation notes: re-grep `mcpToolProfile`; forward `ptahUiFence` at every site (`chat-session.service.ts:122, 157,
  567, 745, 1429`; router `:127-128`); report any extra site found

### Task B8b.2: specs — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.ptah-ui-flag.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\rpc-handlers\src\lib\chat\session\chat-continue-slash-before-resume.spec.ts`

## Batch B8c: trusted host fact `TOKENS.HOST_KIND` — COMPLETE (8ba240713)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: none | Parallel group: W2 or W3
- Requirements: Req 2.14 (Electron only [user]), decision 8, L-7, A-10; comp. 11
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core,ptah-electron`

### Task B8c.1: token and type — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\vscode-core\src\di\tokens.ts`
- Implementation details: `HOST_KIND: Symbol.for('HostKind')`; `export type HostKind = 'vscode' | 'electron' | 'cli' | 'tui'`

### Task B8c.2: Electron registration and smoke spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-electron\src\di\phase-1-infra.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-electron\src\di\container.smoke.spec.ts`
- Validation notes: `{ useValue: 'electron' }`; spec resolves `TOKENS.HOST_KIND === 'electron'`; no other host edited

## Batch B9: system-prompt hint and the L-7 gate — COMPLETE (a220a6bbe)

- Recommended executor: codex lane | Fallback: backend-developer subagent | Mode: sequential
- Tasks: 2 | Depends on: B8a, B8c | Parallel group: W4
- Requirements: Req 2.14, 5.11, Electron-only hint [user]; comp. 12
- Phase: B
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core,@ptah-extension/agent-sdk`
- B8c finding (Wave 2): the `@ptah-extension/vscode-core` barrel (`libs\backend\vscode-core\src\index.ts:1`) exports
  `TOKENS` from `./di/tokens` but not the type `HostKind`. B9 must export it when it injects the token and type the
  builder field `HostKind | undefined`. File added to B9 as Task B9.3 (B9 is now 6 files over 2 libs).

### Task B9.1: hint constant — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\prompt-harness\index.ts`
- Validation notes: PR B text omits the "Host data…" sentence and `note`; `encode(...).length <= 100`; names skill
  `ptah-surface-authoring`; hint exactly once directly after `PTAH_CORE_SYSTEM_PROMPT`; absent without the field

### Task B9.2: builder gate and truth-table spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ptah-ui-hint.spec.ts`
- Implementation details: last optional ctor param `@inject(TOKENS.HOST_KIND, { isOptional: true })` (pattern
  `:945-951`); `AssembleSystemPromptInput.ptahUiHint?` (`:230-262`), push after `:310`; at `:1693`
  `ptahUiHint: this.hostKind === 'electron' && (sessionConfig?.mcpToolProfile ?? 'coding') === 'coding' && sessionConfig?.ptahUiFence === true`
- Validation notes: all 7 truth-table rows (implementation-plan.md:667-675), including spoofed `true` on
  `undefined`/`'vscode'`/`'tui'`/`'cli'`

### Task B9.3: export `HostKind` from the vscode-core barrel — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\vscode-core\src\index.ts`
- Implementation details: `export { TOKENS, type HostKind } from './di/tokens';`; nothing else in the barrel changes

## Batch B10: `ptah-surface-authoring` skill — COMPLETE (6546ab57f)

- Recommended executor: codex lane | Fallback: technical-content-writer subagent | Mode: sequential
- Tasks: 2 | Depends on: B3 (corpus examples; plan defect 3) | Parallel group: W5
- Requirements: Req 2.15; comp. 13
- Phase: B
- Verify: `npm run manifest:check`

### Task B10.1: SKILL.md and reference — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\SKILL.md`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\ptah-ui.md`
- Validation notes: re-check SKILL.md absence at start (594 may have added it; then add only a pointer); EBNF, lexical
  table, source table without `$context`, caps, fallback, six corpus examples; no `note` yet

### Task B10.2: regenerate manifest — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\content-manifest.json`
- Implementation details: `npm run manifest:generate`, never hand-edit
- Verified 2026-10-04: `manifest:check` up to date (sha256:c847c91c…, 228 files); the manifest diff adds only the two
  skill files. C3 changed no asset, so the manifest is committed with B10. Report: `batch-B10-report.md`.

## Batch BM: PR B+C Electron measurement — PENDING (becomes M: the single final measurement after C4)

- Plan change 2026-10-04: AM is merged here. M runs after C4, builds the base (`f314a4f8a`) once and measures it
  against the final head, and writes both the PR A and PR B+C sections of `measurement.md`. M still triggers the
  Phase B+C review.

- Recommended executor: codex lane | Fallback: devops-engineer subagent | Mode: sequential
- Tasks: 1 | Depends on: B1-B10, C1-C4 (PR B+C merged) | Parallel group: W8 (after C4)
- Requirements: Req 5.1, 5.2, 5.9, 5.10, 5.11, 5.13 (Electron only [user]); measurement only
- Phase: B+C (last batch; triggers the combined Phase B+C review)
- Verify: `npm run gate:eager-closure` exits 0 on the PR B+C build; `--base` diff shows only allow-listed eager growth

### Task BM.1: measurement.md (PR B section) — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.ptah\specs\TASK_2026_610_6a10\measurement.md`
- Implementation details: initial chunk, no-fence chunk log (5.2), coding `tools/list` hash unchanged (5.10), hint
  text/chars/tokens (5.11), corpus figures (5.13), eager-closure `--base` output

## Run log

### Wave 6 commits (team-leader, C2b, A5, B6)

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui,@ptah-extension/chat --parallel=1` exit 0;
  `npx jest -c libs/backend/agent-sdk/jest.config.ts .../sdk-query-options-builder.host-data.spec.ts` 1/1.
- Commits: C2b `3f686a897`, A5 `6b4946e24`, B6 `2dac29bcb`. Only batch files staged; 594/595 `task.md` untouched.
- Next, dependencies confirmed: AM (A1-A7 committed; codex lane, fallback devops-engineer) ∥ B7 (B6, A4, B8a
  committed; opencode lane, fallback frontend-developer; file-disjoint from AM). Then C2a (C2b, B6, B7; opencode,
  fallback frontend-developer), then C4 (C2a; codex, fallback backend-developer), then BM (B1-B10, C1-C4; codex,
  fallback devops-engineer), which triggers the Phase B+C review. AM triggers the Phase A review.

### Wave 4 commits (team-leader, B1-B3)

- Scoped run before commit: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1` passed
  (0/3 from cache), including the zod-free barrel spec and the A7 contract spec; `surface.index.ts` is 136 lines.
- B9 gap closed: `ptah-ui-hint.spec.ts` 3/3 passes now that `parsePtahUi` is exported from the surface entry (B2).
- Commits: B1 `dad0b4efa`, B2 `5284f9e89`, B3 `3282f0978`. `ptah-ui-pipeline.spec.ts` is in B3 (its owning task
  B3.2); B2 stays covered without it because `ptah-ui-resolver.spec.ts` drives `renderPtahUiBlock`.
- Next when A4 and B5a land: B5b (frontend-developer subagent; needs B2, B4, B5a, A3), then B6
  (frontend-developer subagent, security-sensitive; needs B5b). Now startable: B10 (codex lane; B3 committed),
  C1 (codex lane; B1+B2+B3 and A2 committed). C3 (codex lane) needs B10's `references\ptah-ui.md` first, and
  shares `content-manifest.json` with B10, so run it after B10, not beside it.

### Wave 1 (A1, A6, A7) — COMPLETE

- A1 `8bcaf4049`, A7 `9814e1612`: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --skip-nx-cache`
  passed (86 suites, 2,323 tests, including `index.zod-free.spec.ts` and the new contract spec).
- A6 `4c47c7a43`: `npx nx run-many -t typecheck,test,lint -p ptah-electron --skip-nx-cache` passed (gate spec 5/5,
  real-build case ran against the current `stats.json`); `npm run gate:eager-closure` exit 0, baseline 714 eager
  inputs, 2,841,104 initial bytes. Not rebuilt for verification (stats file current). The first A6 build failure
  came from the environment: `node_modules` was not a junction. The orchestrator fixed it.
- Lanes touched only their listed files (`git status`, `git diff --stat`).

### Wave 2 (A2, B1, B8a, B8c, B4) — VERIFIED

- A2 `646398350` and the B8a shared half: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared
  --skip-nx-cache` passed (90 suites, 2,393 tests, including `index.zod-free.spec.ts` and the A7 contract spec; lint
  0 errors).
- B8a `83dd0dca1`: plus `-p @ptah-extension/rpc-handlers` passed (136 suites, 3,962 passed / 7 skipped; lint 0 errors).
- B8c `8ba240713`: `-p @ptah-extension/vscode-core,ptah-electron` typecheck and tests passed (45 + 58 suites). The
  first parallel run's lint failed with 631 errors, all in a transient esbuild bundle
  `apps\ptah-electron\src\windows\.shell-security-*\permission-policy.cjs` that `shell-csp.spec.ts` writes and deletes
  while the test target runs. Lint re-run serially (`--parallel=1`): 0 errors. Environmental race, not B8c. From now
  on run `ptah-electron` lint with `--parallel=1` or after its tests.
- B4 `51d837c65`: `-p @ptah-extension/declarative-dashboard` passed (17 suites, 218 tests; lint 0 errors).
- B1 NOT ACCEPTED (defect under Task B1.3); not committed although its scoped run passed.
- Lanes touched only their listed files (`git status`, `git diff --stat`).

### Wave 3 — PARTIALLY COMMITTED

- B8b `afc0ad05b`: `npx nx run-many -t typecheck,lint,test -p @ptah-extension/rpc-handlers --parallel=1
  --skip-nx-cache` passed.
- A3 `705ebf32f`: `-p @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` passed.
- B9 `a220a6bbe`: `-p @ptah-extension/vscode-core,@ptah-extension/agent-sdk --parallel=1 --skip-nx-cache` passed
  (in the working tree, with the uncommitted B1/B2 files present; see Phase B+C note 8).
- Held: B1 (fix 2 done), B2 (fix 1 done), B3 (finished, orchestrator-verified: fence tokens 10-33% of JSON tokens,
  trust cases pass, B2 source-state matrix kept). B1+B2+B3 commit together next run, with `surface.index.ts`.
- Next free slots (B3 done; 2 of 3 used): A4 (opencode; deps A3 committed; `libs/frontend/chat/.../transcript/*`)
  and B5a (opencode; no deps; `libs/frontend/chat-ui/src/lib/services/ptah-ui-live-window*`, `chat-ui/src/index.ts`).
  File-disjoint from each other and from the held B1-B3 `shared` files.

| Batch | Executor | Fallback | Files (file-disjoint) |
| --- | --- | --- | --- |
| B1 fix round | codex lane (resume the B1 session if last active < 5 min, else fresh) | backend-developer | `ptah-ui-parser.ts`, `ptah-ui-parser.spec.ts` |
| A3 | opencode lane | frontend-developer | `chat-ui` cost/duration badges, `molecules/turn-recap/turn-tests-row*`, `src/turn-recap.ts`, `tsconfig.base.json` |
| B8b | codex lane | backend-developer | `rpc-handlers/.../chat/session/chat-session.service.ts`, `chat-slash-command-router.service.ts`, `chat-session.ptah-ui-flag.spec.ts`, `chat-continue-slash-before-resume.spec.ts` |

Dependencies confirmed: A3 needs A2 (committed); B8b needs B8a (committed). B2 needs B1 and stays blocked until the
B1 fix commits. B9 (B8a + B8c committed) and B5a (no deps) take the next free slots. A3 is first because it is on the
PR A critical path (A3 -> A4 -> A5 -> AM).

| Batch | Executor | Fallback | Files (file-disjoint) |
| --- | --- | --- | --- |
| A2 | codex lane | backend-developer | `libs/shared/src/lib/utils/turn-sources.utils*`, `usage-format.utils*`, `utils/index.ts` |
| B1 | codex lane | backend-developer | `libs/shared/src/mcp-apps-contracts/ptah-ui.types.ts`, `ptah-ui-fence*`, `ptah-ui-parser*` |
| B8a | codex lane | backend-developer | `rpc-chat.types.ts`, `ai-provider.types.ts`, `chat-rpc.schema(.spec).ts` |

A2 and B1 share the `shared` project, so each lane runs only its own specs. B8a also reaches `shared`. The
team-leader runs each batch's scoped `run-many` serially at verification. B8a adds a param field, not an RPC
method, so the A7 contract spec must stay green. B4 and B8c take the next free slots.

## Phase A code-logic review — orchestrator findings to examine (at AM; not fixed now)

1. **A7 registry scope is unbounded.** `host-source-registry.contract.spec.ts:13-21` deep-equals the whole
   `RPC_METHOD_NAMES` and `MESSAGE_TYPES`. After merge, any unrelated PR that adds an RPC method or message type
   fails this test. The review should weigh limiting it to host-source-related names (turn usage, change set,
   tests, duration, cost) or another bounded approach.
2. **Bash exit status → node status is unverified.** `turn-tests.utils.ts:19-25` (`outcomeFor`) maps `complete` →
   `passed` and `error` → `failed`. No spec or cited code shows that a non-zero Bash exit sets `status: 'error'` in the
   execution tree. If it stays `complete`, a failing `npm test` shows as passed. Trace the SDK tool_result
   `is_error` → node status path and pin it with a fixture.
3. **Blanket catches hide bugs.** `turn-tests.utils.ts:32,51-53` (`collectTurnTests`) returns `[]` on any throw.
   The catch at `turn-tests.utils.ts:58,68-70` (`summarizeTurnTests`) cannot be reached. Remove both or narrow
   them. Also weigh `test-command-matcher.ts:163-168`.

## Phase A review — notes added in Wave 2

4. **A2 duration heuristic.** `formatDurationMs` (`usage-format.utils.ts:10-13`) multiplies any positive value below
   100 by 1000, copied from `duration-badge.component.ts:27-41`, so a real 50 ms value renders as `50.0s`.
   Byte-identical by design (A3 keeps the badge specs unchanged); decide whether to keep it or record it.
5. **A2 usage reads only the block message.** `usageFor(input.blockMessage)` (`turn-sources.utils.ts:72-87`) ignores
   other assistant messages in the turn, while tests come from all assistant roots. Check against Req 1.3.
6. **A2 tests become `unavailable` when any assistant message has `streamingState === null`**
   (`turn-sources.utils.ts:64-70`). Check against A-4 (legacy `streamingState`) once A4 resolves it.

## Phase A review — notes added in Wave 3 (orchestrator)

7. **A3 live region on every historical turn.** `role="status"` on `TurnTestsRowComponent` makes each historical
   turn's row a live region; a static `<section>` with an `aria-label` is likely better.
8. **A3 template method call.** `outcomeClass()` is a method call in the template; prefer a computed or pure mapping.

## Phase B+C review — notes added in Wave 3 (orchestrator)

6. **B9 hint purpose.** The hint never says WHEN to use a `ptah-ui` block, nor that the host fills `$` sources (the
   core purpose). (The earlier concern about advertising `$diff`/`$tests`/`$usage` before PR C is withdrawn: PR B and
   C ship together, context.md:121-126.) C3 is the natural place to fix the wording.
7. **B2 validation and pipeline order (fixed).** The orchestrator found that a pending or unavailable source table
   failed validation (`[[source]]`, one cell versus 4 columns) and that the pipeline returned the pre-validation
   surface. Both fixed in B2 review fix 1, re-verified end to end by the orchestrator. Lesson: pipeline batches need
   an end-to-end validator test.
8. **B9 commit ordering.** `ptah-ui-hint.spec.ts:2` imports `parsePtahUi` from
   `@ptah-extension/shared/mcp-apps-contracts/surface`, exported by B1/B2 (`surface.index.ts`), not yet committed.
   B9 `a220a6bbe` is not standalone-green until the B1+B2+B3 commit lands next run.
9. **C3 hint headroom.** The C3 hint (`13bf47252`) is 77 tokens, 23 under budget. A one-line example might fit and
   would spare the agent its first skill load (the 3-line example was dropped at 107 tokens). "in Ptah Electron" is
   redundant: only Electron sessions receive the hint.

## Phase B+C review — notes added at the B6/A5/C2b commit (orchestrator, recorded by team-leader)

10. **VS Code output is not literally byte-identical.** Text output matches, but each text node gains one empty
    `<!--container-->` Angular comment from B6's new `@if`. Accepted by the orchestrator as invisible and
    behaviour-neutral; the reviewer confirms (copy, a11y tree, any DOM-snapshot specs).
11. **CI flake risk.** Specs that reach `execution-node` now load the lazy `ptah-ui` chunk eagerly. On a cold run
    `electron-shell.review-dock.spec.ts` hit its 5 s timeout once. Consider mocking the lazy entry in that spec or
    raising its timeout.
12. **Eager-closure growth +6 inputs** (714 → 720; +7.3 KB initial). BM must run the gate with `--base` and confirm
    every new eager input is allow-listed.
13. **A5 backend spec is narrow by construction.** The builder has no host-data input, so
    `sdk-query-options-builder.host-data.spec.ts` can only assert absence. The frontend
    `message-sender.host-data.spec.ts` is the real boundary test; C4 extends both.

## Phase B review — notes added in Wave 2

1. **Style: inline `HOST_KIND`.** `tokens.ts:290` writes `HOST_KIND: Symbol.for('HostKind')` inline; every other
   `TOKENS` entry is a named const declared above. For the Phase B style review; not fixed now.
2. **Style: B1 parser density.** `ptah-ui-parser.ts:131-149` packs whole functions on single lines (`parseCells` is one
   line). Lint passes; readability and Prettier conformance belong to the style review.
3. **Logic: B1 grammar interpretation** (`batch-B1-report.md`). Per "Spec correction 2026-10-04" (context.md), `$` is
   a source position only at the start of a stats value and as a `table`/`list` argument: `$5.00` as a stats value
   rejects, `\$5.00` is literal, and table cells, stats labels and chart labels keep leading and mid-cell `$` literal.
   The target opener stays exact ```` ```ptah-ui ```` at column 0; outer backtick/tilde fences accept 0-3 leading
   spaces (CommonMark), 4 spaces is indented code. The B1 review-fix round applied fix 1 (literal dollars in cells,
   stats labels, chart labels) and fix 2 (0-3 space outer fences).
4. **Logic: own-key source lookup.** Confirm the Task B1.3 `$constructor` fix, and that B2's converter and resolver use
   no `in` or index lookup on a plain object that accepts prototype keys.
5. **Visual: empty header after B4.** With no title and no description, `surface-renderer.component.ts:191-194` still
   renders an empty `<header class="col-span-full ...">` that takes a grid row gap (`gap-y-4`). Check it in the
   Phase B visual review on titleless `ptah-ui` blocks.

## Suggested waves (≤3 in flight, file-disjoint)

| Wave | Batches | Executors |
| --- | --- | --- |
| W1 | A1, A6, A7 | codex, codex, codex |
| W2 | A2, B1, B8a (then B4, B8c as slots free) | codex, codex, codex (B4 opencode) |
| W3 | A3, B2, B8b / B8c / B5a | opencode, codex, codex/opencode |
| W4 | A4, B3, B9 | opencode, codex, codex |
| W5 | A5, B5b, B10 | codex, subagent, codex |
| W6 | AM, B6 | codex, subagent |
| W7 | B7, C1, C3 (after B10) | opencode, codex, codex |
| W8 | C2b, then C2a, then C4 | opencode, opencode, codex |
| W9 | BM (B+C) | codex |

Waves are guidance; the hard rule is the "Depends on" line plus file-disjointness. Serialized shared files:
`utils/index.ts` (A1 → A2), `tsconfig.base.json` (A3 → B5b), `chat-transcript.component.*` (A4 → B7),
`surface.index.ts` (B2 only in PR B).

---

## PR C batches — ACTIVE, same PR as B (user decision 2026-10-04)

C batches follow the B batches on this branch and precede BM. Dependencies re-pointed from BM to the B batches whose
files they extend. Phase: B+C.

## Batch C1: resolver and snapshot sources — COMPLETE (991015ec4)

- Executor: codex lane | Depends on: B1+B2+B3 committed (resolver, pipeline spec), A2 | Group: G-C1 (C1 ∥ C3)
- Files: `libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts` (+ `.spec.ts`), `libs\shared\src\lib\utils\turn-sources.utils.ts` (+ `.spec.ts`) under the worktree root
- Requirements: Req 3.1-3.8; A-6 resolved here
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`
- Verified 2026-10-04: shared run-many passed. Closes Req 3.2/3.4/3.5/3.6 gaps; A-6 resolved (`$diff` stays pending
  until the late `git:turnChangeSet` push). Report: `batch-C1-report.md`.

## Batch C2b: block snapshot input — COMPLETE (3f686a897)

- Verified 2026-10-04: specs only (B5b had already added the `snapshot` input); 4 specs: in-place update without
  remount, 0 recomputations when frozen, `null` snapshot → "unavailable", block with no sources. `chat-ui` run-many
  passed. Report: `batch-C2b-report.md`.

- Split from C2 (plan defect 5: the plan's 6 files omit `chat-transcript.component.html`, bubble binding at `:50`;
  7 files total). C2b runs first.
- Files: `libs\frontend\chat-ui\src\lib\...\ptah-ui-block.component.ts`, `ptah-ui-block.component.spec.ts` (snapshot
  input updates in place; exact paths as B5b creates them)
- Executor: opencode lane | Fallback: frontend-developer | Depends on: C1, B5b (creates the block)
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`
- Next after B5b commits: C2b (opencode) runs in parallel with B6 (frontend-developer subagent). They are
  file-disjoint (confirmed 2026-10-04). C2b touches only the `chat-ui` block component and its spec. B6 touches only `chat`
  files: `ptah-ui-fence-line.ts`, `execution-node.component.ts`, `message-bubble.component.ts/.html` and
  `execution-node.ptah-ui.spec.ts`.

## Batch C2a: snapshot wiring in chat — COMPLETE (18f51a600, combined with B7)

- Verified 2026-10-04 (`batch-C2a-report.md`): `ptahUiSnapshots` map in `chat-transcript.component.ts/.html`,
  `ptahUiSnapshot` input in `message-bubble.component.ts` threaded through `execution-node.component.ts`, and the
  C2a describe in `chat-transcript.ptah-ui.spec.ts`. `message-bubble.component.html` needed no change. Same checks
  and the same recorded review-dock flake as B7.

- Files (chat, 6): `chat-transcript.component.ts`, `chat-transcript.component.html`, `message-bubble.component.ts`,
  `message-bubble.component.html`, `execution-node.component.ts`, `chat-transcript.ptah-ui.spec.ts`
- Executor: opencode lane | Fallback: frontend-developer | Depends on: C2b, B6 (`execution-node`, bubble), B7
  (`chat-transcript.component.*`; serialized A4 → B7 → C2a)
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

## Batch C3: hint and skill sources text — COMPLETE (13bf47252)

- Executor: codex lane | Depends on: B9 (hint, committed a220a6bbe), B10 (`references\ptah-ui.md`) | Group: G-C1
- Files: `ptah-ui-hint.ts`, `ptah-ui-hint.spec.ts`, `references\ptah-ui.md`, `content-manifest.json`
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk` and `npm run manifest:check`
- Verified 2026-10-04: agent-sdk typecheck, test, lint passed; `manifest:check` up to date. Hint rewritten to 77 tokens
  (was 99); `references\ptah-ui.md` and the manifest unchanged by C3 (manifest committed with B10). Report:
  `batch-C3-report.md`.

## Batch C4: fence-bound sentinels — COMPLETE (d056195dd)

- Committed 2026-10-05; report `batch-C4-report.md`. The orchestrator removed a wrong assertion (the system hint must
  not be required to carry the prior fence) and noted it in the report. Checks: chat + agent-sdk + ptah-electron
  typecheck/lint 6/6; jest backend host-data 2/2, frontend host-data 3/3.

- Executor: codex lane | Depends on: C2a (committed 18f51a600)
- File-disjoint from AF5 (confirmed 2026-10-04): C4 writes only the two `*.host-data.spec.ts` files below. AF5
  writes `electron-shell.review-dock.spec.ts`, `libs/shared/.../execution/schemas.ts`, `scripts/eager-closure-gate.js`
  and its spec, a new `scripts/` baseline script, and the `host-source-registry.baseline.ts` and
  `.contract.spec.ts` files. There is no overlap.
- Files: `message-sender.host-data.spec.ts`, `sdk-query-options-builder.host-data.spec.ts`
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat,@ptah-extension/agent-sdk`

## Queued: PR D — BLOCKED on TASK_2026_594 and the D2 plan amendment

D cannot start until TASK_2026_594 merges with `SURFACE_CATALOG_VERSION = 'dashboard-catalog/3'` and an `alert`
kind (A-11, A-8), and the Gate 2 condition is met: a plan amendment giving D2's exact file list and its
parallel-group conflict check (context.md, "Gate 2 — APPROVED"; implementation-plan-review.md defect 1).

## Batch D1: `text-block` catalog kind — QUEUED, BLOCKED (594)

- Executor: codex lane | Group: G-D1 (D1 ∥ D3)
- Files (confirm after 594 lands): `surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`,
  `surface-text-fallback.ts`, `surface-contract.spec.ts`, `surface-text-fallback.spec.ts` (all
  `libs\shared\src\mcp-apps-contracts\`); must NOT change `SURFACE_CATALOG_VERSION`

## Batch D2: `text-block` renderer mapping — QUEUED, BLOCKED (594 + D2 amendment)

- Executor: opencode lane | Group: G-D2 | File list: none until the amendment

## Batch D3: `note` in parser and converter — QUEUED, BLOCKED (594)

- Executor: codex lane | Group: G-D1
- Files: `ptah-ui-parser.ts` (+ `.spec.ts`), `ptah-ui-converter.ts` (+ `.spec.ts`), `ptah-ui.corpus.ts`

## Batch D4: hint and skill `note` text — QUEUED, BLOCKED (D3)

- Executor: codex lane | Group: G-D2
- Files: `ptah-ui-hint.ts`, `ptah-ui-hint.spec.ts`, `references\ptah-ui.md`, `content-manifest.json`

## Phase verification (each PR)

- Every listed artifact exists and contains real work (no TODO, stub or placeholder)
- Each batch's one scoped command passes before its commit; output tailed
- No per-batch review: the phase's code-logic (+ style + visual) review runs on the combined diff after AM / BM commit
- `libs\shared\src\index.zod-free.spec.ts` and `host-source-registry.contract.spec.ts` green on every `shared` run
- Edge cases listed above are addressed
