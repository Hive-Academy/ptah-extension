# Batches - TASK_2026_692_f748

Total tasks: 29 | Batches: 17 | Complete: 2/17

Worktree (all edits, checks, commits): `D:\projects\ptah-extension\.claude-worktrees\idle-compaction`
(branch `feat/idle-compaction`, base `7bdc6eed4`). Below, `<W>` means that absolute path; every
file path in a lane prompt must be written out in full.

Inputs: `implementation-plan.md` Revision 3 + Gate 2 amendment (`decisions.md` #10),
`task-description.md` Revision 3, `decisions.md` (#6-#10 binding), `context.md`.

## Run rules (repeat in every lane prompt)

- Repo `CLAUDE.md` verification rules: only the changed project(s); Nx project names are the
  `@ptah-extension/<lib>` names (apps: `ptah-cli`, `ptah-electron`, `ptah-extension-vscode`);
  `--parallel=1` for Nx, `--coverage=false --maxWorkers=2` for Jest; one heavy check at a time;
  never `build`/`serve`/`dev`/`e2e`/`package`; never workspace-wide; filter output with `| tail`.
- Lanes never run git. The team-leader owns `batches.md` and all commits.
- Every new constructor parameter is an optional LAST parameter (default `null`/`undefined`, or
  `@inject(token, { isOptional: true })`) so the existing direct-construction specs keep
  compiling unchanged: `new SessionQueryExecutor(` in 4 specs, `new SessionLifecycleManager(` in
  2, `new CompactionHookHandler(` in 2, the router in 2 rpc-handlers specs.
- No stubs, TODO, placeholder or mock logic in production files. New files < 500 lines.
- Executor default: CLI lane, implementation capability (codex is the only lane with confirmed
  quota on 2026-10-17; the orchestrator re-checks `ptah_agent_list` at spawn). Fallback order:
  other family same capability -> same family other provider/model -> subagent
  (`backend-developer`, or `frontend-developer` for Phase 3 frontend batches). The 2026-10-15
  "CLI lanes instead of Claude subagents" rule in the user CLAUDE.md expired 2026-10-16, so the
  subagent fallback is allowed.
- Review family: implementer is the codex family; phase code-logic review by a Claude
  `code-logic-reviewer` (different family). If a batch falls back to a Claude subagent, its phase
  review needs a non-Claude lane or a recorded same-family exception.

## Plan validation

Status: PASSED WITH RISKS

Stress test against the files on disk (all 38 MODIFY targets exist; `helpers/compaction/idle/`
does not exist yet, so every CREATE is a true create):

1. Contracts on both sides. Checked: pump `sendMessage` options `{ origin, admission }` and the
   synchronous section after the second `assertAdmissible` (`session-stream-pump.service.ts:207-255`)
   — `beforeEnqueue` fits between `assertAdmissible` and `markActive`; `CompactionCallbackRegistry.register`
   returns a disposer (`compaction-callback-registry.ts:32-37`); `SdkAdapterEvents.onCompactionComplete`
   returns a disposer (`sdk-adapter-events.service.ts:224-229`); `PostCompactRekeyTarget =
   Pick<IContextUsagePort,'rekey'>` (`compaction-hook-handler.ts:45,169-190`) — the service's
   `rekey(from,to)` satisfies it; `CompactionCompleteEvent` has no idle field today
   (`libs/shared/src/lib/types/execution/stream.ts:288-300`); `isStreamEvent`/`isMessageStart`
   are exported from `types/sdk-types/claude-sdk.types.ts:334,444`; `readSubagentRequestUsage`
   and `SubagentRequestUsage` exported (`subagent-budget-monitor.ts:152,210`); SDK 0.3.278
   `SDKMessageOrigin` at `sdk.d.ts:5030`, `origin?` on user messages `:5408`; rxjs 7.8.2 is at the
   root (`package.json:197`) and Electron (`apps/ptah-electron/package.json:47`), absent from
   agent-sdk and ptah-cli `package.json`; no npm workspaces, so no lockfile change. All collaborators
   of the service are registered in `registerSdkServices` (`register.ts:404,452,564,649`). OK.
2. Event order. The plan defines both completion orders and trampolines every signal; A3 is the
   residual live assumption (gated below).
3. Dependency failure. Fail-open for every producer call; lookups wrapped (`lookup-failed`);
   missing optional collaborators degrade. OK.
4. Unnamed inputs/states. Count assertions that the new settings keys break:
   `libs/shared/src/lib/types/advanced-settings.types.spec.ts:38` expects 27 keys (becomes 29).
   RISK, carried by Task 5.1.
5. Runtime failure fallback. Refusal sends nothing; claim always released by timeout; the user
   keeps manual `/compact` and the existing threshold compaction. Off switch is the setting. OK.

Assumptions:

- A1 (anchor skew 5 s) — unverified; senior-tester live run in QA (log `anchorAt` vs
  `firstEventAt - ttft_ms`). Not a batch gate.
- A2 (streamed `/compact` with `origin: { kind: 'coordinator' }` runs as the slash command) —
  unverified; **live probe P1 gates the acceptance (commit) of Batch 10**, the batch that makes the
  send path live in production DI. Run P1 early (in parallel with Batch 1) so a failure surfaces
  before Phase 2 work is spent.
- A3 (`compact_boundary` before the turn's `result`; PostCompact order logged) — unverified;
  same probe P1, same gate.
- A4 (main-thread `assistant` frames carry `usage.cache_creation` split) — unit fixture in Task
  3.1 plus the P1 log.
- A5 (webview settles on the idle turn's own `result` after a coalesced `chat:continue`) —
  senior-tester live run in QA.
- `@nx/dependency-checks` counts a type-only `rxjs` import — assumed; the dependency is added in
  Batch 2 together with the first `rxjs` import either way (Task 2.3).
- Booleans under `compaction.*` do not trip `budgetDefault` (only `BUDGET_KEYS` are checked,
  `compaction-config-provider.ts:50-55`) — verified on disk; Task 6.2 adds a spec asserting the
  provider constructs with the boolean default present.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A2 fails: CLI treats a coordinator-origin `/compact` as prompt text | HIGH | Probe P1 before Batch 10 commits; on FAIL stop the rollout and escalate (fallback = human origin + render suppression needs a user decision). Do not work around |
| Existing direct-construction specs break on new constructor params | MEDIUM | Optional last params only (run rules); Tasks 9.1, 10.2, 11.1, 12.1 |
| Shared spec pins 27 advanced settings | LOW | Task 5.1 updates the count and adds the two key rows |
| Service spec too large for one lane (40-call ceiling) | MEDIUM | Split: core cases Batch 7, coalescing/ordering/NFR cases Batch 8 (`idle-compaction.service.coalesce.spec.ts`) |
| Router admission race (await between `admitManualCompact` and `executeSlashCommand`) | HIGH | Task 12.1 requires no `await` between them; spec with a deferred `resolveProviderProfileForWorkspace` |
| `postCompactSeen` cleared on TRIGGERED->COMPACTING (Gate 2 finding) | HIGH | Task 1.1 keeps it across TRIGGERED->COMPACTING; required test PreCompact -> PostCompact -> late compacting frame -> manual `send` (coordinator spec Task 1.2, router spec Task 12.1) |
| Pending send promise outlives a released session | MEDIUM | `beforeEnqueue` liveness veto (Task 7.1); spec in Task 8.1 |
| Timer handles keep Node alive / leak | MEDIUM | Unref'd scheduler (Task 2.2); 1 000-session zero-actions spec (Task 8.1) |
| `session-lifecycle-manager.ts` already 814 lines | LOW | Thin delegates only (Task 9.2); lint warn, not error |
| UI completion evidence | MEDIUM | Settings rows + marker text are rendered UI with no prototype: Mode 3 needs before (base `7bdc6eed4`) / after screenshots, dark + light, of Settings > Advanced > Context budgets and of a compaction marker; the orchestrator schedules the visual-reviewer after Phase 3 |
| Settings write path | MEDIUM | Mode 3 write-path trace: `settings:set` -> `~/.ptah/settings.json` (`FILE_BASED_SETTINGS_KEYS`) -> `CompactionConfigProvider.getIdleCompactionConfig` at arm/fire and `onDidChangeConfiguration` -> `settings-changed` |

Edge cases:

- Manual `/compact` before / after the idle claim, and during the router's awaits — Tasks 1.2, 8.1, 12.1
- PostCompact before boundary, PostCompact without boundary, boundary without PostCompact — Tasks 4.1, 8.1
- Same-frame `attempt-due` + `input` in both orders; duplicate/stale `attempt-due` — Tasks 4.1, 8.1
- Late feedback signal for a released key never reopens a group — Task 8.1
- Sleep/wake (`lapsed`) — Tasks 3.2, 7.2
- Malformed persisted settings (non-boolean, non-integer, < 100 000) — Task 6.2
- Rekey before/after boundary keeps the notice on the boundary's `session_id` — Tasks 4.1, 14.2
- Codex-proxy session never arms; OBSERVE_ONLY records still claimable (D1 final) — Tasks 3.2, 8.1

## Live probe P1 (gate for Batch 10) — run by the orchestrator — PASSED

Result (2026-10-17, `research-report.md` § "Live probe P1"): A2 PASS, A3 PASS (boundary 2 ms
before the compaction `result`), A4 PASS (`ephemeral_1h`/`ephemeral_5m` split present).
PostCompact fired BEFORE `compact_boundary` (same `session_id`). Observed order: PreCompact,
PostCompact, status, a second `system init` (same `session_id`), `compact_boundary`, two `user`
echo frames, `result` (`num_turns` 0, zero usage). The Batch 10 commit gate is satisfied.
Follow-up notes are recorded on Batches 4 and 9.

Purpose: settle A2/A3 (and log A4) against the real bundled CLI of
`@anthropic-ai/claude-agent-sdk` 0.3.278, independent of Ptah code, so it can run now.

How:

1. Write a scratch script at `<W>\.ptah\tmp\idle-probe\probe.mjs` (`.ptah/**` is git-ignored,
   `.gitignore:135`; never commit it). Run it from `<W>` with `node` in the foreground (Bash tool,
   timeout 600000). It is not an Nx target, so the CLAUDE.md build/serve ban does not apply; it
   spends a small amount of the user's Claude usage (two short turns plus one compaction).
2. The script calls `query({ prompt: <async iterable of SDKUserMessage>, options: { cwd: <a new
   empty temp dir>, hooks: { PreCompact: [...], PostCompact: [...] } } })` using the user's
   normal Claude auth (no API key override). Push turn 1: a short user prompt ("Reply with the
   word ok."). After its `result`, push `{ type: 'user', message: { role: 'user', content:
   '/compact' }, parent_tool_use_id: null, session_id: <id from init>, origin: { kind:
   'coordinator' } }` — the same shape `createUserMessage` builds for `sendIdleCompact`.
3. Log one line per frame and hook with `Date.now()`: `type`, `subtype`, `session_id`,
   `compact_metadata`, `result.num_turns`, assistant `message.usage` (cache_creation split), and
   for hooks `hook_event_name`, `trigger`, `session_id`. Close the iterable after the second
   `result`.
4. PASS A2: PreCompact fires with `trigger: 'manual'`, a `system`/`compact_boundary` frame
   arrives, and the second `result` has `num_turns === 0` with no assistant text answering
   "/compact". PASS A3: `compact_boundary` precedes that `result`; record where PostCompact fell
   (before boundary / between / after result). A4: note whether turn-1 `assistant` usage had the
   `cache_creation` split.
5. Record the result in `<W>\.ptah\specs\TASK_2026_692_f748\research-report.md` (section
   "Live probe P1": date, SDK/CLI version, the frame/hook log excerpt, PASS/FAIL per A2, A3, A4).
   The team-leader reads that section before accepting Batch 10.
6. On A2 FAIL: do not commit Batch 10; stop and escalate to the user with the plan's fallback
   (human origin + Ptah-side render suppression). On A3 boundary-after-result: escalate to the
   architect (reducer's `turn-ended` in `precompact` would report `compaction-failed`).
   A PostCompact order surprise alone is not a failure (both orders are handled).

Optional in-app confirmation (send via `sendIdleCompact`) stays with the senior-tester's QA live
run together with A1/A5.

## Phases

| Phase | Batches | Review |
| --- | --- | --- |
| 1 — Core engine | 1-8 | code-logic (Claude, different family) + style (new public types in `agent-sdk/src/index.ts`) |
| 2 — Wiring and send path | 9-13 | code-logic + style (new public DI token `SDK_IDLE_COMPACTION`) |
| 3 — Idle notice | 14-17 | code-logic + visual (rendered marker text and settings rows) |

Parallel-safe batch groups (file-disjoint, no shared entry point), if the orchestrator wants
concurrency (max 3 lanes, one heavy check at a time): after Batch 1 -> {2, 5, 12}; after 2 -> {3, 4};
after 5 -> {6}. Default ordering below is sequential by number.

## Batch 1: Coordinator idle claim and manual admission — COMPLETE (commit 70478faf7)

- Recommended executor: CLI lane [implementation, TypeScript backend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: one class + its type + its spec + two type exports; tightly coupled, one lane.
- Tasks: 2 | Depends on: none
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 2.4, 2.5, 2.6 (coordinator side), 2.7 (admission order), D9, D10

### Task 1.1: Claim, reservation and `postCompactSeen` on the coordinator record — COMPLETE

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-coordinator.ts`,
  `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-state.types.ts`,
  `<W>\libs\backend\agent-sdk\src\index.ts`
- Plan reference: implementation-plan.md:160-218 (component 1), :587-604 (component 9 `index.ts` exports), D9, D10
- Pattern to follow: record shape `compaction-coordinator.ts:63-67`; `transition` `:295-322`
- Quality requirements: synchronous, O(1), never throws; no state transition or listener emission for claim/reservation/`postCompactSeen`; header comment updated.
- Validation notes: Gate 2 amendment — `postCompactSeen` survives TRIGGERED->COMPACTING; cleared only when leaving open states (->COOLDOWN/BACKOFF/IDLE), on a new PreCompact opening TRIGGERED from a closed state, and on `register` reset. `onPostCompact` sets it before the equal-id early return; return value unchanged.
- Implementation details: add `claimIdle`, `releaseIdleClaim`, `getIdleClaim`, `admitManualCompact`, `releaseManualReservation`; `requestManualCompact` returns `coalesced` for a held claim before the open check and `deduped` only when open and not `postCompactSeen`; add `{ readonly action: 'coalesced' }` to `ManualCompactDecision`; export `type ManualCompactDecision` and `type ManualCompactAdmission = Pick<CompactionCoordinator, 'requestManualCompact' | 'admitManualCompact' | 'releaseManualReservation'>` from `src/index.ts` (nothing else).

### Task 1.2: Coordinator spec cases — COMPLETE

- Depends on: Task 1.1
- File: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-coordinator.spec.ts`
- Plan reference: implementation-plan.md:204-214 (verification seam)
- Pattern to follow: existing cases in the same spec
- Quality requirements: every case listed in the seam, including the required Gate 2 test: PreCompact -> PostCompact -> late `status: compacting` (TRIGGERED->COMPACTING) -> `requestManualCompact`/`admitManualCompact` -> `send`.
- Validation notes: both orders (`admitManualCompact` then `claimIdle` -> `manual-reserved`; `claimIdle` then `admitManualCompact` -> `coalesced`, no reservation).

### Batch 1 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -20`
- Artifacts exist with real implementations; no per-batch review.

## Batch 2: Idle contracts, unref'd scheduler, rxjs dependency — COMPLETE (commit PENDING_SHA)

- Recommended executor: CLI lane [implementation, TypeScript backend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: first `rxjs` import and the dependency declaration must land together (AC 7.1/7.2, lint `@nx/dependency-checks`).
- Tasks: 3 | Depends on: none (file-disjoint from Batch 1)
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 7.1, 7.2, NFR process lifetime

### Task 2.1: `idle-compaction.types.ts` — COMPLETE

- File: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.types.ts` (CREATE)
- Plan reference: implementation-plan.md:219-260 (component 2)
- Pattern to follow: `compaction-state.types.ts` (readonly literal unions)
- Quality requirements: no `any`; readonly; constants exactly as the plan; `import type { SchedulerLike } from 'rxjs'`; origin type via `types/sdk-types/claude-sdk.types`.
- Implementation details: constants, `CacheTtlClass`, `LastRequestSnapshot`, `IdleSignal` union (external + internal signals, each internal naming its attempt), `IdleStep`, `IdleTimerSpec`, effect union, reason-code unions, ports `IdleCompactionSignals`, `IdleCompactSender`, `IdleBoundaryNotice`, `IdleCompactionTiming`, `IdleSendVetoedError` may live in the service (Batch 7).

### Task 2.2: Unref'd `SchedulerLike` + spec — COMPLETE

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\unref-scheduler.ts` (CREATE), `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\unref-scheduler.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:403-424 (component 6)
- Pattern to follow: unref timer seam `compaction-coordinator.ts:51-61`
- Quality requirements: public rxjs types only, no `rxjs/internal`; one handle per action; zero after unsubscribe.
- Validation notes: the spec must drive a real `timer(1000, createUnrefScheduler())` under jest fake timers (verifies the `this`-bound action assumption) and assert `unref` was called.

### Task 2.3: Declare `rxjs` — COMPLETE

- Files: `<W>\libs\backend\agent-sdk\package.json`, `<W>\apps\ptah-cli\package.json`
- Plan reference: implementation-plan.md:725-736 (component 13)
- Implementation details: `"rxjs": "7.8.2"`; in ptah-cli between `reflect-metadata` (line 83) and `sqlite-vec` (line 84). No npm install (root already has 7.8.2; no workspaces, no lockfile change). Electron and VS Code unchanged.

### Batch 2 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle/unref-scheduler.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -20 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15 && npx nx lint @ptah-extension/agent-sdk 2>&1 | tail -20 && npx nx lint ptah-cli 2>&1 | tail -20`

## Batch 3: Request tracker and fire gate (pure) — IN_PROGRESS

- Recommended executor: CLI lane [implementation, TypeScript backend]
- Execution mode: sequential (one lane; two independent pure units)
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: two small pure modules with table specs, similar difficulty.
- Tasks: 2 | Depends on: Batch 2
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 1.1, 1.2, 3.1-3.9 (3.7 as amended by decision 9)

### Task 3.1: `MainRequestTracker` + `classifyCacheTtl` + spec — IN_PROGRESS

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-request-tracker.ts` (CREATE), `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-request-tracker.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:262-292 (component 3), D3
- Pattern to follow: `readSubagentRequestUsage` (`helpers/compaction/subagent-budget-monitor.ts:210-237`); guards `isStreamEvent`/`isMessageStart` from `types/sdk-types/claude-sdk.types.ts:334,444`
- Quality requirements: O(1) per frame; never throws; no clock of its own.
- Validation notes: A4 fixture — an `assistant` frame with `usage.cache_creation` split; read-only last request after an earlier 1h write -> `not-1h`; AC 1.2 anchor (send t=0, response t=7 min -> anchor <= t0).

### Task 3.2: `evaluateFireGate` + spec — IN_PROGRESS

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-fire-gate.ts` (CREATE), `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-fire-gate.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:380-401 (component 5), D1
- Quality requirements: pure; refusal order exactly as the plan; Codex proxy is the only `not-actable`; OBSERVE_ONLY is not a refusal.
- Validation notes: one case per AC 3.1-3.9 incl. sleep/wake `lapsed` math (`now - fireAt > 60_000` or `now >= expiresAt`).

### Batch 3 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.spec.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15`

## Batch 4: Idle session reducer (pure) — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend, state machines]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: the hardest pure unit; isolated so it does not stall easier work.
- Tasks: 1 | Depends on: Batch 2
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 1.1-1.5, 2.4, 2.6, 2.8, 2.9, 4.1, 4.2, 4.5, 4.7, 6.4 (notice identity)

### Task 4.1: `reduceIdleSession` + spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.ts` (CREATE), `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:294-378 (component 4), D2, D8, D10
- Quality requirements: total, pure, no clock reads; `timer` field derived on every reduction; `fire` emitted only by `attempt-due` naming the current Pending attempt; `claimId` minted there.
- Validation notes: every case in the verification seam (:366-376), incl. boundary->result->PostCompact (claim held through `boundary-ended`), PostCompact-first, PostCompact without boundary, `postcompact-timeout`, `postcompacted` + new-run `session-bound` / `pre-compact` -> closed with no notice.
- P1 note (second init frame): the live CLI re-emits `system init` with the SAME `session_id`
  after compaction, between PostCompact and `compact_boundary`. Only a `session-bound` with a NEW
  `runToken` may cancel/close; add a spec case that a `session-bound` carrying the current
  `runToken` in `precompact` / `postcompacted` changes nothing (the idle notice still lands on the
  boundary). Also add the observed live order PreCompact -> PostCompact -> boundary -> `turn-ended`
  as a case (PostCompact-first is the real order).

### Batch 4 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15`

## Batch 5: Settings descriptors and file-key allow-list — PENDING

- Recommended executor: CLI lane [implementation, TypeScript]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: two libraries, two source + two spec files; agent-sdk config provider depends on these defaults.
- Tasks: 2 | Depends on: none
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 5.1, 5.2, 5.5 (partial), D5

### Task 5.1: `ADVANCED_SETTINGS` descriptors + spec — PENDING

- Files: `<W>\libs\shared\src\lib\types\advanced-settings.types.ts`, `<W>\libs\shared\src\lib\types\advanced-settings.types.spec.ts`
- Plan reference: implementation-plan.md:620-650 (component 10), D5
- Pattern to follow: existing `context-budgets` descriptors (`advanced-settings.types.ts:123-213`), boolean descriptor at `:208`
- Validation notes: RISK — spec line 38 pins 27 keys; update to 29 and add range rows for `compaction.idleCompactionMinTokens` (100 000-5 000 000, integer) and a boolean row. Labels/help text exactly as the plan.

### Task 5.2: `FILE_BASED_SETTINGS_KEYS` + spec — PENDING

- Files: `<W>\libs\backend\platform-core\src\file-settings-keys.ts`, `<W>\libs\backend\platform-core\src\file-settings-keys.spec.ts`
- Plan reference: implementation-plan.md:631
- Pattern to follow: compaction budget entries `file-settings-keys.ts:220-225`
- Implementation details: add both keys next to the compaction budgets; spec asserts membership and defaults (true, 200 000).

### Batch 5 verification

- Command: `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/platform-core --parallel=1 2>&1 | grep -E "Running target|Tests:|Test Suites:|FAIL|Successfully|failed" | tail -20` (header must say 2 projects)

## Batch 6: Idle config read and export key list — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: agent-sdk half of component 10; the service (Batch 7) calls `getIdleCompactionConfig`.
- Tasks: 2 | Depends on: Batch 5
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 5.3, 5.4, 5.5

### Task 6.1: `KNOWN_CONFIG_KEYS` + spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts`, `<W>\libs\backend\agent-sdk\src\lib\types\settings-export.types.spec.ts`
- Plan reference: implementation-plan.md:632
- Pattern to follow: compaction keys case at `settings-export.types.spec.ts:72-80`

### Task 6.2: `getIdleCompactionConfig` + spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts`, `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.spec.ts`
- Plan reference: implementation-plan.md:633-637
- Pattern to follow: `warnOnce` and defaults `compaction-config-provider.ts:35-55,107-112,186-207`
- Validation notes: unset -> defaults; non-boolean enabled -> true; min not an integer >= 100 000 -> 200 000 (never clamped); one WARN per distinct bad value; provider still constructs with the boolean default present (ASSUMPTION on `BUDGET_KEYS` check).

### Batch 6 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/types/settings-export.types.spec.ts libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15`

## Batch 7: IdleCompactionService (RxJS pipeline) and core spec — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend, RxJS]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: the orchestration unit; the heavy ordering/coalesce/NFR cases move to Batch 8 to stay within one lane's budget.
- Tasks: 2 | Depends on: Batches 1, 2, 3, 4, 6
- Phase: 1 | Phase review: deferred to Batch 8
- ACs: 1.1, 2.1-2.3, 2.6, 2.9, 3.3, 4.1-4.7

### Task 7.1: Service + internal barrel — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.ts` (CREATE), `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\index.ts` (CREATE)
- Plan reference: implementation-plan.md:426-533 (component 7)
- Pattern to follow: plain class + seams like `CompactionCoordinator`; no tsyringe decorator
- Quality requirements: one trampolined FIFO `enqueue` for every signal; alias index; `groupBy` with release duration; `scan` -> `tap(runEffects)` -> `share`; one `switchMap` timer from `state.timer`; `exhaustMap(fire)`; per-group `catchError`; release in `finalize`; `dispose` idempotent; logs never carry message text.
- Validation notes: `beforeEnqueue` checks group live + `latest` still this attempt in `sending`, then `claimIdle`; throws `IdleSendVetoedError` unless `claimed`; error mapping exactly as the plan (`SessionAdmissionRefusedError` -> `not-idle-at-send`, `manual-reserved` -> `manual-compact-reserved`). Settings subscription filters `ptah.compaction.enabled`, `ptah.compaction.idleCompactionEnabled`, `ptah.compaction.idleCompactionMinTokens`.

### Task 7.2: Core service spec — PENDING

- Depends on: Task 7.1
- File: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:512-530 (first part of the seam)
- Quality requirements: `VirtualTimeScheduler` + mutable wall clock; arm->fire->send with `require-idle`, coordinator origin and claim; busy at send (2.2); claim timeout (2.6); BACKOFF / failed send (2.9); sleep/wake `lapsed` (3.3); cancellations 4.1-4.7; dispose.

### Batch 7 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15`

## Batch 8: Service ordering, coalescing and leak spec — PENDING

- Recommended executor: CLI lane [testing, TypeScript, RxJS virtual time]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: different from implementer (phase 1 review)
- Rationale: test-only batch with a real `CompactionCoordinator`; closes Phase 1.
- Tasks: 1 | Depends on: Batch 7
- Phase: 1 | Phase review: code-logic + style, due after this batch commits (diff from parent of Batch 1's commit to HEAD)
- ACs: 2.4, 2.5, 2.7, R1-R4, D10, NFR leak/perf

### Task 8.1: `idle-compaction.service.coalesce.spec.ts` — PENDING

- File: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.coalesce.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:516-530
- Quality requirements: real coordinator; manual via `admitManualCompact` before and after the claim; boundary -> result -> manual -> PostCompact; PostCompact-first and PostCompact-without-boundary + manual -> `send` without advancing virtual time, on an acting (`e2Passed: true`) and an OBSERVE_ONLY record; same-frame `attempt-due`/`input`/feedback both orders; unresolved send promise + release -> veto, no claim, no group, `scheduler.actions.length === 0`; late feedback for released key; 1 000 sessions armed and released -> zero actions, zero retained entries.
- Validation notes: if a case exposes a service defect, report it with `file:line`; do not edit the service in this batch (the team-leader returns it to Batch 7's executor).

### Batch 8 verification

- Command: `npx nx test @ptah-extension/agent-sdk --parallel=1 2>&1 | grep -E "Tests:|Test Suites:|FAIL|failed" | tail -20` (whole-project run once, closing Phase 1)

## Batch 9: Session tap signals — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 2 review)
- Rationale: one 1 024-line file plus a focused new spec; isolated from the manager edits.
- Tasks: 1 | Depends on: Batches 3, 7
- Phase: 2 | Phase review: deferred to Batch 13
- ACs: 1.1-1.5 producers, 4.4 (release), A4

### Task 9.1: `CompactionSessionTap` idle producers — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts`, `<W>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.idle-signals.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:536-552 (8a)
- Pattern to follow: tap `guard` try/catch and fail-open rule `session-query-executor.service.ts:225-233`; tap construction `:615`
- Validation notes: `idle` is an optional LAST parameter of both `SessionQueryExecutor` and the tap (default `null`) so the 4 existing `new SessionQueryExecutor(` specs compile unchanged; `turnId` computed before the `!port || !query` early return; `turnContext` called before the read's early return; `sessionReleased` for every released id.
- P1 note (second init frame): after compaction the CLI emits a second `system init` with the
  same `session_id`. Call `sessionBound` only from `bind` (which today runs only on an id change,
  `session-query-executor.service.ts:244`), never per `init` frame, and never mint a new
  `runToken` or start a new turn/request for it. Spec: a same-id `init` frame after
  `compact_boundary` produces no `sessionBound`/`requestStarted` call. The two `user` echo frames
  between boundary and `result` are not user `input` and must not emit `input`.

### Batch 9 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15`

## Batch 10: Pump veto, facade, token and DI registration (send path live) — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend, tsyringe]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 2 review)
- Rationale: these six files together make the idle send path reachable in production; splitting them would commit a token without a registration or a facade injecting an unregistered token.
- Tasks: 3 | Depends on: Batch 9
- Phase: 2 | Phase review: deferred to Batch 13
- **Acceptance gate: Live probe P1 must be recorded as A2 PASS and A3 PASS in `research-report.md` before this batch is committed.** Implementation may proceed before P1 finishes; the team-leader holds the commit.
- ACs: 2.1, 2.2, 2.3, 4.6, 4.7 (prefix change), rekey

### Task 10.1: Pump `beforeEnqueue` + spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts`, `<W>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.spec.ts`
- Plan reference: implementation-plan.md:554-559 (8b)
- Validation notes: honoured only with `admission: 'require-idle'`; called after the second `assertAdmissible` and before `markActive`/push (`session-stream-pump.service.ts:241-247`); a throw queues nothing and propagates.

### Task 10.2: Token, facade delegates and facade spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\di\tokens.ts`, `<W>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`, `<W>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.idle.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:561-571 (8c), :589 (token)
- Pattern to follow: optional injects (`commit-message-generator.service.ts:98`)
- Validation notes: `@inject(SDK_TOKENS.SDK_IDLE_COMPACTION, { isOptional: true })` as the LAST constructor parameter (2 existing `new SessionLifecycleManager(` specs); thin delegates only (file is 814 lines); `sendIdleCompact` does not emit `input`; `dispose()` disposes the service.

### Task 10.3: DI registration — PENDING

- File: `<W>\libs\backend\agent-sdk\src\lib\di\register.ts`
- Plan reference: implementation-plan.md:589-598 (component 9)
- Pattern to follow: coordinator factory `register.ts:476-494`; optional resolve `:461-473`; lazy closure `:824-843`
- Validation notes: sender is a lazy closure resolving `SDK_SESSION_LIFECYCLE_MANAGER` at call time (breaks the manager <-> service cycle); timing `{ scheduler: createUnrefScheduler(), now: () => Date.now() }`; missing `WORKSPACE_PROVIDER`/`SDK_ADAPTER_EVENTS` -> degraded, one DEBUG.

### Batch 10 verification

- Command: `npx nx test @ptah-extension/agent-sdk --parallel=1 2>&1 | grep -E "Tests:|Test Suites:|FAIL|failed" | tail -20 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -15 && npx nx lint @ptah-extension/agent-sdk 2>&1 | tail -20`
- Gate: `research-report.md` "Live probe P1" shows A2 PASS and A3 PASS.

## Batch 11: PostCompact rekey target and CLI smoke assertion — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend, tsyringe]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 2 review)
- Rationale: hook handler change (agent-sdk) plus the CLI host smoke assertion (ptah-cli) that proves the new registration resolves; the Electron and VS Code smoke assertions go to Batch 13 to keep each batch at 2 projects.
- Tasks: 2 | Depends on: Batch 10
- Phase: 2 | Phase review: deferred to Batch 13
- ACs: rekey (4.x), D10 hook part, DI guard

### Task 11.1: `CompactionHookHandler` idle target + PostCompact fallback id + spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts`, `<W>\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.spec.ts`
- Plan reference: implementation-plan.md:573-582 (8d)
- Validation notes: optional inject as LAST parameter (2 existing `new CompactionHookHandler(` sites: its spec and `live-usage-tracker.spec.ts`); add `['idle-compaction', this.idleCompaction]` to `rekeySessionState`; call `coordinator.onPostCompact(postFallbackSessionId, postPayloadSessionId ?? postFallbackSessionId)` whenever the fallback id is set; `rekeySessionState` keeps the both-ids condition.

### Task 11.2: CLI smoke assertion — PENDING

- File: `<W>\apps\ptah-cli\src\di\container.smoke.spec.ts`
- Plan reference: implementation-plan.md:600-605
- Pattern to follow: `apps/ptah-cli/src/di/container.smoke.spec.ts:347-353`
- Implementation details: `SDK_TOKENS.SDK_IDLE_COMPACTION` resolves to one instance after `registerSdkServices`.

### Batch 11 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts libs/backend/agent-sdk/src/lib/helpers/live-usage-tracker.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -20 && npx nx test ptah-cli --parallel=1 2>&1 | grep -E "Tests:|Test Suites:|FAIL|failed" | tail -15`

## Batch 12: Manual `/compact` admission in the router — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend, concurrency]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 2 review)
- Rationale: router change + its spec close the admission rule; one library. Needs only Batch 1 (coordinator API and `ManualCompactAdmission` export), so it may run in parallel with Batches 2-11 if the orchestrator wants concurrency.
- Tasks: 1 | Depends on: Batch 1
- Phase: 2 | Phase review: deferred to Batch 13
- ACs: 2.5, 2.7, D6, D9, D10 (router)

### Task 12.1: Router fast path + authoritative admission + spec — PENDING

- Files: `<W>\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`, `<W>\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.idle-coalesce.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:651-688 (component 11), D6, D9, D10
- Pattern to follow: router `new-query` branch `chat-slash-command-router.service.ts:114-162`
- Validation notes: inject `SDK_TOKENS.SDK_COMPACTION_COORDINATOR` optional, typed `ManualCompactAdmission`, as the LAST constructor parameter (existing `chat-continue-slash-before-resume.spec.ts`, `chat-session-provider-profile.spec.ts` construct the router); **no `await` between `admitManualCompact` and the `executeSlashCommand` call**; `releaseManualReservation` in `finally`; a throwing coordinator call -> log + `send`. Spec: claim held; no claim; claim taken during a deferred `resolveProviderProfileForWorkspace`; reservation released on resolve and reject; D10 with a real coordinator (PreCompact -> PostCompact -> late compacting -> `send`, `executeSlashCommand` once); TRIGGERED without PostCompact -> `deduped`.

### Batch 12 verification

- Command: `npx nx test @ptah-extension/rpc-handlers --parallel=1 2>&1 | grep -E "Tests:|Test Suites:|FAIL|failed" | tail -15 && npx nx typecheck @ptah-extension/rpc-handlers 2>&1 | tail -10`

## Batch 13: Electron and VS Code smoke assertions — PENDING

- Recommended executor: CLI lane [testing, TypeScript, tsyringe]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 2 review)
- Rationale: one assertion in each of two existing host smoke specs; test-only; closes Phase 2.
- Tasks: 1 | Depends on: Batch 10
- Phase: 2 | Phase review: code-logic + style, due after this batch commits (diff from parent of Batch 9's commit to HEAD; include Batch 12's commit even if it landed earlier)
- ACs: DI guard (component 9)

### Task 13.1: Host smoke assertions — PENDING

- Files: `<W>\apps\ptah-electron\src\di\container.smoke.spec.ts`, `<W>\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts`
- Plan reference: implementation-plan.md:600-605
- Pattern to follow: Task 11.2

### Batch 13 verification

- Command: `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -15 && npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -15`

## Batch 14: Notice contract and backend stamp — PENDING

- Recommended executor: CLI lane [implementation, TypeScript backend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 3 review)
- Rationale: shared field + the transformer that sets it; frontend batches depend on the field.
- Tasks: 2 | Depends on: Batch 10 (`idleCompactionNoticeFor` on the facade)
- Phase: 3 | Phase review: deferred to Batch 17
- ACs: 6.1, 6.3, 6.4, D4, D8

### Task 14.1: `CompactionCompleteEvent.idleCompaction` — PENDING

- File: `<W>\libs\shared\src\lib\types\execution\stream.ts`
- Plan reference: implementation-plan.md:696-697
- Implementation details: `readonly idleCompaction?: { readonly preTokens: number }` on `CompactionCompleteEvent` (`stream.ts:288-300`).

### Task 14.2: Transformer stamp + spec — PENDING

- Files: `<W>\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.ts`, `<W>\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.spec.ts`
- Plan reference: implementation-plan.md:698-700, D4
- Validation notes: optional call `helpers.sessionLifecycle.idleCompactionNoticeFor?.(sdkMessage.session_id ?? resolvedSessionId)`; stamp only when the lookup returns a notice; partial lifecycle fakes in the spec keep working; the PostCompact-only advisory fallback is not stamped (D4).

### Batch 14 verification

- Command: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -20 && npx nx typecheck @ptah-extension/shared 2>&1 | tail -10 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -10`

## Batch 15: Marker record and marker component — PENDING

- Recommended executor: CLI lane [implementation, Angular frontend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 3 review)
- Rationale: two leaf units of the frontend chain in two libraries.
- Tasks: 2 | Depends on: Batch 14
- Phase: 3 | Phase review: deferred to Batch 17
- ACs: 6.1, 6.2, 6.3

### Task 15.1: `ConversationRegistry` marker field + spec — PENDING

- Files: `<W>\libs\frontend\chat-state\src\lib\conversation-registry.service.ts`, `<W>\libs\frontend\chat-state\src\lib\conversation-registry.service.spec.ts`
- Plan reference: implementation-plan.md:703-706
- Validation notes: `idleCompaction` on `CompactionMarkerRecord`, persisted; `readPersisted` validates finite >= 0; dropped when a new boundary has none.

### Task 15.2: `CompactionMarkerComponent` idle sentence + spec — PENDING

- Files: `<W>\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-marker.component.ts`, `<W>\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-marker.component.spec.ts`
- Plan reference: implementation-plan.md:690-723 (component 12)
- Quality requirements: OnPush unchanged; text exactly `Compacted while idle to save usage before the prompt cache expired (was <N> tokens).` with N via the component's `format`; generic "Context compacted" otherwise; spec pins that "manual" never appears (AC 6.2).

### Batch 15 verification

- Command: `npx nx run-many -t test -p @ptah-extension/chat-state @ptah-extension/chat-ui --parallel=1 2>&1 | grep -E "Running target|Tests:|Test Suites:|FAIL|Successfully|failed" | tail -15` (header must say 2 projects)

## Batch 16: Streaming pass-through — PENDING

- Recommended executor: CLI lane [implementation, Angular frontend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 3 review)
- Rationale: one library, the accumulator and the handler that forwards its result.
- Tasks: 1 | Depends on: Batch 14
- Phase: 3 | Phase review: deferred to Batch 17
- ACs: 6.1 (forwarding)

### Task 16.1: Accumulator result + streaming-handler forwarding + spec — PENDING

- Files: `<W>\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts`, `<W>\libs\frontend\chat-streaming\src\lib\accumulator-core.service.spec.ts`, `<W>\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts`
- Plan reference: implementation-plan.md:702-704

### Batch 16 verification

- Command: `npx nx test @ptah-extension/chat-streaming --parallel=1 2>&1 | grep -E "Tests:|Test Suites:|FAIL|failed" | tail -15`

## Batch 17: Chat store, lifecycle and view binding — PENDING

- Recommended executor: CLI lane [implementation, Angular frontend]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase 3 review)
- Rationale: last link of the chain in `chat`; closes Phase 3.
- Tasks: 1 | Depends on: Batches 15, 16
- Phase: 3 | Phase review: code-logic + visual, due after this batch commits (diff from parent of Batch 14's commit to HEAD). Visual: before (base `7bdc6eed4`) / after screenshots, dark + light, of the idle marker and Settings > Advanced > Context budgets rows.
- ACs: 6.1, 6.3, 5.1 (rendered rows)

### Task 17.1: `chat.store` -> `CompactionLifecycleService` -> registry; `chat-view` binding + spec — PENDING

- Files: `<W>\libs\frontend\chat\src\lib\services\chat.store.ts`, `<W>\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.ts`, `<W>\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.spec.ts`, `<W>\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
- Plan reference: implementation-plan.md:702-707
- Validation notes: `handleCompactionComplete` forwards the field to `setCompactionMarkerTokens`; `chat-view` binds `[idleCompaction]` on the marker.

### Batch 17 verification

- Command: `npx nx test @ptah-extension/chat --parallel=1 2>&1 | grep -E "Tests:|Test Suites:|FAIL|failed" | tail -15 && npx nx typecheck @ptah-extension/chat 2>&1 | tail -10`

## Completion prerequisites (Mode 3)

- Every batch COMPLETE with a commit SHA; Phase 1-3 reviews accepting.
- `research-report.md` "Live probe P1" A2/A3 PASS (A4 noted).
- Visual evidence (dark + light, before/after) for the marker and the two settings rows.
- Write-path trace for `compaction.idleCompactionEnabled` / `compaction.idleCompactionMinTokens`.
- Parity: N/A (no surface replaced, consolidated, rebuilt or redesigned; additive setting rows and one marker text variant).
- QA after Mode 3: senior-tester live run for A1 and A5 and the in-app `sendIdleCompact` path.
