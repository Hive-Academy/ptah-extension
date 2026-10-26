# Batches - TASK_2026_714_c8a2

Total tasks: 48 | Batches: 41 | Complete: see per-batch headers. P2, P3, P4 (3a/3c/3d, 3b.2),
9a and 10a are merged to main through PR #809 (the per-batch headers in P2-P4 below were not all
updated by the earlier runs; `git log origin/main` is the record). PR #808 merged 2026-10-25:
nothing is #808-blocked any more. Session 7 (2026-10-25) re-validated P5 against main 16c6455e1
and runs P5 (5a-5c, with 3b.1 as 5b). Blocked on evidence: 5 in P11.
From P5 on, W means `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`
(branch feat/codex-runtime-integration from origin/main 16c6455e1).

Batch ids start at 2a because 1a-1l were the evidence spike. W below means the worktree root
`D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat` (every path is absolute under
it). Production Codex App Server routing stays DISABLED for every batch in this file: no batch may
enable a consumer for production or flip a production capability default. Session 7 update: a
dev-only route switch (Batch DS1, unpackaged builds only) may turn on the chat route, and
Removals A and B are IN SCOPE as the last phases, each only after parity proof (decisions.md).

## Plan validation

Status: PASSED WITH RISKS (no BLOCKER: the contradictions below are settled by user decisions in
`decisions.md`, which outranks `implementation-plan.md` per the plan's own Authority line, and the
batches implement the settled form).

### Stress test: plan items that contradict the settled decisions

| #   | Plan item (implementation-plan.md)                                                                                                                                               | Settled decision (decisions.md, last rows)                                                                                                                                                                                                                                                                   | How the batches resolve it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | §6 `ApprovalOutcome` includes `allowWithInput(validated replacement)`; outcome table row "modifiedInput"; G4/G13 demand modifiedInput side-effect proof (:197, :217, :323, :326) | No native edited input in Codex. Offered decisions: accept, accept for session, decline, cancel (T3 Code parity). "Edit" = decline + a follow-up user message (turn/steer, or interrupt + new turn); documented as NOT equivalent to Claude updatedInput (runs 6f-6j)                                        | 2a defines `CodexApprovalDecision = 'accept' \| 'acceptForSession' \| 'decline' \| 'cancel'`; no allowWithInput. 2g: a reply carrying edited input for a Codex request is answered `decline` BEFORE effect and returns `editNotSupported` so the consumer can send the user's text as a normal follow-up. 2i adds `steer()` to `CodexContext`. 8c makes the Codex prompt offer only the four decisions. G4's modifiedInput acceptance is replaced by "edit reply never runs the original; decline observed (6j)" |
| C2  | §6 policy table, ask row: "Baseline workspace-write/no network" (:207)                                                                                                           | Ask = granular approval policy (all five flags true) + read-only sandbox; requires `initialize.capabilities.experimentalApi = true`. Reads and other sandbox-allowed actions run unprompted; writes, file changes, escalated commands and MCP calls ask first                                                | 2e maps ask to granular-all-true + read-only + experimentalApi=true, matching the harness `policy()` (`libs/backend/codex-runtime/tools/evidence-harness.ts:973-1000`) observed in 6e/6f. 2d sends experimentalApi=true whenever the profile uses granular                                                                                                                                                                                                                                                       |
| C3  | §6 "Always Allow ... scoped rule" (:197, :218) as a single outcome                                                                                                               | Codex `acceptForSession` covers only the exact command/patch (research-t3code-approvals.md §2); "accept for session" is the offered decision                                                                                                                                                                 | 2f RuleStore records a Ptah-side scoped rule (provider/home/workspace/thread/kind[/tool]) on acceptForSession and 2g auto-answers later matching requests with `acceptForSession`; in-memory, host-runtime lifetime (plan :222 unchanged). Scope semantics remain an unproved gate (2k)                                                                                                                                                                                                                          |
| C4  | Plan and spike harness assumed MCP approval via `item/mcpToolCall/requestApproval`                                                                                               | In codex 0.155.1, MCP approvals arrive as `mcpServer/elicitation/request` (6h root cause, 6i observed)                                                                                                                                                                                                       | 2b validates `mcpServer/elicitation/request` params/response from the pinned schema; 2g answers `{action: accept\|decline\|cancel}`. MCP accept-for-session is enforced by the Ptah RuleStore, never by `_meta.persist` (unproved)                                                                                                                                                                                                                                                                               |
| C5  | §2 `CodexContext` has no follow-up/steer operation (:113-121)                                                                                                                    | Edit flow needs turn/steer or interrupt + new turn (6j proved steer in-turn)                                                                                                                                                                                                                                 | 2a/2i add `steer(input): Promise<CodexTurnReceipt>` (turn/steer) next to interrupt + startTurn                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C6  | Inputs: "0058 is taken by 712; use 0059+" (:20)                                                                                                                                  | Migration 0059 is 712's; 714 uses 0060+                                                                                                                                                                                                                                                                      | No batch adds a migration (identity lives in metadata detail JSON, plan :230). If a later batch proves a schema need, it uses 0060+                                                                                                                                                                                                                                                                                                                                                                              |
| C7  | §6 yolo row: session-scoped full-access only if proven (:210)                                                                                                                    | Spike observed YOLO interrupt under workspace-write + on-request only (6h)                                                                                                                                                                                                                                   | 2e encodes the observed mapping (yolo/auto-edit: workspace-write; plan: read-only); full access stays unproved and is a recorded parity-gate item in 2k                                                                                                                                                                                                                                                                                                                                                          |
| C8  | Plan treats the 712 claim list as the five files at :14-18                                                                                                                       | Real PR #808 also changes `libs/shared/src/index.ts`, `agent-adapter.types.ts`, auth-providers `src/index.ts`, `di/register.ts`, `provider-owner.resolver.ts`(+spec), cli-agent-runtime `cli-adapter.interface.ts` and `di/register.ts`, agent-sdk `src/index.ts` (`gh api .../pulls/808/files`, 2026-10-24) | Every batch that edits any of those files, or the user's hard list, is in a phase marked "blocked on #808 merge + rebase"                                                                                                                                                                                                                                                                                                                                                                                        |
| C9  | Bundled codex 0.155.1 vs global 0.163.0                                                                                                                                          | Core must check the manifest/version pin                                                                                                                                                                                                                                                                     | 2b verifies `codex --version` output and binary SHA-256 against `codex-app-server-protocol.manifest.json` (pinnedVersion 0.155.1, win32/x64) before handshake; mismatch refuses to open, never regenerates. 2k keeps every consumer disabled on platforms with no manifest row (observation 7)                                                                                                                                                                                                                   |
| C10 | §7 history, file rewind and subagent controls                                                                                                                                    | native-route-evidence.md: history/rewind/subagents, profile inputs, isolation, Always Allow scope, remote MCP, packaged binaries all unproved                                                                                                                                                                | Phase P11 is BLOCKED ON EVIDENCE: no refusal-only placeholder is built (plan :356). Needs a user-approved spike budget (2 of 20 turns remain)                                                                                                                                                                                                                                                                                                                                                                    |

Assumptions:

- A1 zod 4.6.5 (root `package.json:207`, shared `node_modules`) is usable from codex-runtime;
  verified present. 2b adds it to `libs/backend/codex-runtime/package.json` dependencies so the
  Nx dependency-checks lint passes.
- A2 `IProcessSpawner` from `@ptah-extension/platform-core`
  (`libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:126`) is the spawner
  port; verified present. 2a re-uses it, does not redefine it; 2a verifies the codex-runtime ->
  platform-core edge passes the module-boundary lint.
- A3 The existing `CodexAccountUsageService` already drives `codex app-server` for
  `account/rateLimits/read` (`codex-account-usage.service.ts:257`, `:303`); 2j lifts that
  behavior into the core client, 3b makes the service delegate. Unverified: response shape parity
  — 3b checks it with the existing usage spec unchanged.
- A4 PR #808 merges with additive-only changes to the shared files listed in C8; post-808 phases
  start with a rebase and re-read of those files before editing (each blocked batch carries this
  as its first task step).
- A5 `turn/steer` is in the 0.155.1 manifest and accepted in-turn (6j). Interrupt + new turn is
  the fallback when no turn is active.

| Risk                                                                                                  | Severity | Mitigation                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 A core contract change after consumers start forces rework                                         | MEDIUM   | Consumers (P6-P10) start only after P2's phase review accepts the public API (style review included)                                                                     |
| R2 Approval handling answers before effect is gated, or a stale/duplicate reply authorizes a new turn | HIGH     | 2g correlation key contextId+processGeneration+threadId+turnId+requestId, exactly-one response, timeout/dispose -> decline or kill; spec cases required in 2g acceptance |
| R3 An edited-input reply executes the original action                                                 | HIGH     | 2g declines before effect; 2g + 8c specs pin it                                                                                                                          |
| R4 Version drift picks global codex 0.163.0                                                           | HIGH     | 2b pin check; 8a composition passes only the bundled binary path; mismatch fails visibly                                                                                 |
| R5 Someone flips native routing on before gates pass                                                  | HIGH     | 2k `CodexParityGate` defaults every consumer to disabled from a static evidence ledger; 8a/8d/8e composition specs assert disabled; no batch edits that default          |
| R6 Conflict with #808 on shared index/register files                                                  | MEDIUM   | C8 classification; blocked phases start with rebase                                                                                                                      |
| R7 Per-home auth refactor (3a) introduces a second writer or breaks legacy proxy refresh              | HIGH     | 3a acceptance: single writer per home, facade delegates, existing codex-auth spec unchanged in behavior                                                                  |
| R8 Lane home correction (2c) changes which credentials a running legacy lane reads                    | MEDIUM   | 2c reads the same explicit/env CODEX_HOME the lane executes with; spec covers explicit, env, and default home                                                            |
| R9 Heavy checks exhaust RAM                                                                           | MEDIUM   | One scoped `nx run-many` per batch, `--parallel=1`, Jest `--maxWorkers=2`, at most 3 heavy checks machine-wide (user rule 2026-10-24)                                    |

Edge cases:

- UTF-8 frame split across chunks, oversize frame, unknown method, result/method mismatch —
  2b, 2d
- Approval reply after timeout, after process restart, duplicate reply, reply for another turn —
  2g
- Edited-input reply for a Codex request — 2g, 8c
- MCP elicitation with required form fields that cannot be filled -> decline — 2g
- Interrupt that cannot be confirmed blocks a second turn — 2i
- Persist thread identity fails -> child closed, orphan thread not adopted — 2i
- Two contexts on the same CODEX_HOME keep distinct immutable config — 2e, 2i
- Usage read for home B never fills home A's cache; old-generation response dropped — 2j, 3b
- Missing manifest row for platform/arch -> consumer stays disabled — 2b, 2k
- Legacy lane with explicit CODEX_HOME reads that home's auth.json — 2c

## Decisions

| Decision                                                                                         | Options                                                                      | Evidence                                                                                                    | Reversible                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Treat all PR #808 code files (C8), not only the user's list, as blocked                          | User list only; full PR file list                                            | `gh api repos/Hive-Academy/ptah-extension/pulls/808/files`                                                  | Yes, after #808 merges                            |
| Level mapping for the profile builder = spike-observed mapping                                   | Plan table; spike mapping; granular for all levels                           | `evidence-harness.ts:973-1000`; runs 6e-6h; user decision on ask                                            | Yes; full-access YOLO needs new evidence          |
| Codex approval UI offers exactly accept / accept for session / decline / cancel; no edit control | Keep Claude edit control and convert server-side; hide edit for Codex        | User decision "Codex edit matches T3 Code"; research-t3code-approvals.md §2/§4                              | Yes; 2g still declines any edit reply defensively |
| Accept-for-session is Ptah-side, enforced by the core RuleStore                                  | Rely on Codex acceptForSession only; `_meta.persist` for MCP; Ptah RuleStore | Codex session scope is exact-command only (T3 research §2); `_meta.persist` unproved                        | Yes                                               |
| Core index/registration exports land in one final core batch (2k), plus 2a for contracts         | Each batch edits index.ts; one owner                                         | Parallel batches must not share a public entry point                                                        | Yes                                               |
| Build consumer files that need only the core (9a, 10a, 10b) while #808 is open                   | Wait for #808; build new-file-only parts                                     | Those files are new and not in #808; rollout order chat -> gateway -> lanes is about enabling, not building | Yes                                               |
| No migration                                                                                     | Add 0060 now; detail JSON                                                    | Plan :230 (identity in metadata detail JSON); C6                                                            | Yes, 0060+ if a need is proved                    |

## Execution waves (for the orchestrator)

- Wave 1 (runnable NOW, parallel, file-disjoint): 2a, 2b, 2c. (3c is also eligible now if a
  lane frees up; it touches only auth-providers files outside #808.)
- Wave 2: 2d, 2e, 2f, 2h, 3a, 3c (needs 2a; 2d/2f/2h also need 2b). Max 3 concurrent.
- Wave 3: 2g, 2j, 3d. Wave 4: 2i. Wave 5: 2k, then 3b, 9a, 10a, 10b.
- After #808 merges and this branch rebases: P5 -> P6 -> P7 -> P8 -> P9 (9b) -> P10 (10c).
- Superseded by the Session 7 plan (bottom of this file): P5b -> P6 -> P7 -> P8 -> P9 -> P10 ->
  S0/S1 -> P11 -> P12 -> P13 -> S2 -> P14 -> P15 -> P16. Old P11 is replaced by P11-P13.
- Session 14 (user decision D5): P10 now ends with 10d lane parity proof and 10e.. Removal B;
  P16 is gone. Order: P8 -> P9 -> P10 (incl. Removal B) -> S0/S1 -> P11 -> P12 -> P13 -> S2 ->
  P14 -> P15 Removal A.

---

# Phase P2 — Core runtime (@ptah-extension/codex-runtime) — runnable now

Phase review: code-logic + style (new public API). Implementer family: Codex (CLI lane).
Reviewer family: Claude (code-logic-reviewer + code-style-reviewer subagents).
Verification command for every P2 batch:
`npx nx run-many -t test typecheck lint -p @ptah-extension/codex-runtime --parallel=1`
(Jest inside uses the project config; output tailed.)

## Batch 2a: Core contracts and ports — COMPLETE (verified; 4212bb4e7)
- Verification (Wave 1, team-leader): see 2b line; 2a and 2b share the codex-runtime run.

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: Claude (different from implementer)
- Rationale: types-first foundation every other core batch imports; small and self-contained
- Tasks: 2 | Depends on: none | Runnable now: YES
- Phase: P2 | Phase review: code-logic + style

### Task 2a.1: Runtime domain types — COMPLETE

- Files (CREATE): W/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts,
  W/libs/backend/codex-runtime/src/lib/codex-account-usage.types.ts
- Plan reference: implementation-plan.md:105-132 (§2), :193-224 (§6), :242-244 (§8); C1, C3, C5
- Pattern to follow: discriminated unions in W/libs/shared/src/lib/types/agent-adapter.types.ts
- Implementation details: `CodexExecutionProfile` (readonly, frozen fields per plan :97),
  `CodexThreadIdentity` (threadId, contextId, processGeneration, normalizedHome, workspaceId,
  providerId, profileFingerprint), `CodexTurnInput`, `CodexTurnReceipt`, `CodexTurnSettings`,
  `AppliedSettings` (effectiveNow | nextTurn, revision), `CodexRuntimeEvent` discriminated union
  (textDelta, textFinal, toolStarted/toolCompleted with stable ids, reasoning, file, image,
  usage (reported only, optional fields absent not zero), compaction, approvalRequested,
  approvalSettled, error (sanitized), terminal), `CodexApprovalRequest` with kind
  `command | fileChange | mcpElicitation | permissions | userInput`, and
  `CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'` (NO
  edited-input variant; a JSDoc line states edit = decline + follow-up message, not equivalent to
  Claude updatedInput). Usage DTO per plan :151 (moved from auth-providers, which re-exports it
  in 3b).
- Quality requirements: no `any`; readonly fields; no import from auth-providers/agent-sdk/apps.

### Task 2a.2: Ports, DI tokens and initial exports — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-runtime-ports.ts,
  W/libs/backend/codex-runtime/src/lib/codex-home-auth-reader.ts,
  W/libs/backend/codex-runtime/src/lib/di/tokens.ts; MODIFY
  W/libs/backend/codex-runtime/src/index.ts
- Depends on: Task 2a.1
- Plan reference: implementation-plan.md:29, :124, :138-143 (§3), :197
- Implementation details: ports `CodexExecutableSource` (resolved path + expected manifest row),
  `ApprovalSink.request(request, signal): Promise<CodexApprovalDecision | {decision:'decline';
editNotSupported:true}>`, `CodexThreadIdentityStore` (persist/markInactive/read), `Clock`,
  logger port; spawner = `IProcessSpawner` from `@ptah-extension/platform-core` (A2);
  `CodexHomeAuthReader` per plan :138-143 (`isAuthenticated`, `ensureTokensFresh`,
  `getUsageEligibility`, `watch` -> events `{home, generation, kind}`, never credentials).
  tokens.ts = `Symbol.for(...)` tokens only (no tsyringe import needed). index.ts exports
  types/ports/tokens only.
- Validation notes: A2 module-boundary lint must pass.

### Batch 2a verification

- Files exist with real types; `npx nx run-many -t test typecheck lint -p
@ptah-extension/codex-runtime --parallel=1` passes; existing 175 tools specs still pass.

## Batch 2b: Protocol validator and version pin — COMPLETE (verified; 2a0fe0ff8)
- Verification (Wave 1, team-leader): codex-runtime test 3 suites / 295 passed; typecheck OK; lint
  0 errors, 4 warnings. Phase-review note: CodexProtocolManifest (codex-protocol-manifest.ts:2) and
  CodexExecutableManifestRow (codex-runtime-ports.ts:8) overlap; 2d/2k must pick one.

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: Claude
- Rationale: self-contained (zod + pinned schema/manifest JSON); no import from 2a, so it runs in
  parallel with 2a
- Tasks: 2 | Depends on: none | Runnable now: YES
- Phase: P2 | Phase review: code-logic + style

### Task 2b.1: Method-specific Zod validation — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts,
  W/libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts; MODIFY
  W/libs/backend/codex-runtime/package.json (add `zod` dependency, A1);
  MODIFY W/libs/backend/codex-runtime/tsconfig.json only if `resolveJsonModule` is needed
- Plan reference: implementation-plan.md:124-128; C4
- Pattern to follow: method lists in
  W/libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json; evidence
  frame handling in W/libs/backend/codex-runtime/tools/evidence-frames.ts
- Implementation details: hand-written Zod schemas (no generated executable TS, plan :126) for the
  JSON-RPC envelope and the methods the runtime uses: initialize/initialized (experimentalApi
  capability), thread/start, thread/resume, turn/start, turn/steer, turn/interrupt,
  thread/compact/start, account/rateLimits/read, notifications (item/started, item/completed,
  item/agentMessage/delta, turn/started, turn/completed, thread/tokenUsage/updated, error), and
  server requests item/commandExecution/requestApproval, item/fileChange/requestApproval,
  item/permissions/requestApproval, item/tool/requestUserInput, mcpServer/elicitation/request with
  their response shapes (decision literals accept/acceptForSession/decline/cancel;
  elicitation `{action, content?, _meta?}`). Unknown method or invalid params -> typed
  `CodexProtocolError`, never silently passed. Validate field names against the pinned
  schema JSON in the spec (load schema, assert each modeled method exists).
- Quality requirements: validation happens before correlation/dispatch.

### Task 2b.2: Manifest and version pin check — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-protocol-manifest.ts,
  W/libs/backend/codex-runtime/src/lib/codex-protocol-manifest.spec.ts
- Plan reference: implementation-plan.md:126; C9; observation 7
- Implementation details: `verifyCodexBinary({executablePath, versionOutput, sha256, platform,
arch}, manifest)` -> ok | mismatch(reason). Compares pinnedVersion (0.155.1), binary SHA-256,
  platform/arch row; developer absolute paths are diagnostic only (never identity). Missing
  platform row -> `unsupportedPlatform`. No regeneration on mismatch.
- Validation notes: spec covers global 0.163.0 version output -> mismatch.

### Batch 2b verification

- Scoped command passes; spec proves unknown method, wrong result shape, mismatched version,
  mismatched sha, missing platform row all fail.

## Batch 2d: App Server process and JSONL transport — COMPLETE (verified Wave 2; commit pending)

- Verification (Wave 2, team-leader): codex-runtime Jest 7/7 suites, 372 tests passed (only
  the in-flight 2e spec excluded); typecheck OK; lint 0 errors, 4 warnings. On disk:
  pin check via verifyCodexBinary before spawn (:88-93) plus spawn-time launchGuard digest;
  IProcessSpawner with args ['app-server'], no shell; 1 MiB fixed frame buffer, strict UTF-8,
  frames validated before correlation/dispatch (:201-230); 4 MiB queued bytes; 128 pending
  requests/approvals; 10 s / 30 s / 5 min timeouts; idempotent close with 1 s kill timer
  and listener cleanup; remote error text never copied. experimentalApi always true because
  the 2b validator requires literal true (validator :539). Manifest duplication resolved via
  CodexExecutableSource.expectedManifestRow (ports :10-22).
- Carried RISK for the P2 code-logic review (not a 2d rejection): child env is
  `{...process.env, CODEX_HOME}` (:98), so host ANTHROPIC_* proxy tokens and any
  OPENAI_API_KEY/CODEX_API_KEY reach the Codex child; the spike harness used an allowlist
  (tools/evidence-harness.ts:304-322). Reviewer decides allowlist vs denylist; fix lands with
  2i or a P2 fix batch.

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential | Subagent reason: N/A | Review family: Claude
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Rationale: lifecycle/timeout logic is dense; isolated in one file + spec
- Tasks: 1 | Depends on: 2a, 2b | Runnable now: after 2a+2b
- Phase: P2 | Phase review: code-logic + style

### Task 2d.1: Process lifecycle — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-app-server-process.ts,
  W/libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts
- Plan reference: implementation-plan.md:124-130
- Implementation details: spawn via `IProcessSpawner` with argument array `['app-server']`, no
  shell, fresh child env containing only the profile's CODEX_HOME override (no host env
  mutation); pin check (2b) before handshake; one initialize per process generation with
  experimentalApi=true when the profile's approval policy is granular; incremental UTF-8 JSONL
  framing, 1 MiB frame cap, bounded queued bytes, bounded request map; timeouts 10 s handshake,
  30 s ordinary request, 5 min approval; close = stop sends, reject pending, invalidate
  approvals, close stdin, wait 1 s, kill, await exit; all exit/error/abort/dispose paths
  idempotent and release timers/listeners. Never retry a mutating request after ambiguous
  acceptance.
- Validation notes: fake spawner in spec; no real binary run.

### Batch 2d verification

- Scoped command passes; spec covers fragmentation, oversize, timeout, crash mid-request,
  double close, terminal-before-exit.

## Batch 2e: Execution profile builder — COMPLETE (verified by orchestrator: 17/17 spec, project typecheck+lint by lane; P2 review note: experimentalApi only for ask here vs always true in 2d; approvalsReviewer field not in 2a contract)

- Recommended executor: CLI lane, Codex family | Execution mode: sequential | Review family:
  Claude | Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 2a | Runnable now: after 2a
- Phase: P2 | Phase review: code-logic + style

### Task 2e.1: buildCodexExecutionProfile — IN_PROGRESS

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-execution-profile.ts,
  W/libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts
- Plan reference: implementation-plan.md:97-103; C2, C7
- Implementation details: validate + `Object.freeze` all fields (plan :97); precedence (plan :99);
  path normalization (realpath when existing, resolve otherwise); level mapping:
  ask = granular {sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval
  all true} + read-only + approvalsReviewer user + experimentalApi; plan = read-only;
  auto-edit = workspace-write; yolo = workspace-write with Ptah-side auto-accept of ordinary
  classes; network off for all; explicit lane full-access/never only when the caller supplies it
  (never inferred, never for chat). Non-secret fingerprint (secrets excluded). Instruction
  sources enumerated separately from MCP; HTTP/OAuth/stdio MCP entries preserved as references.
- Validation notes: same-home profiles stay distinct; spec asserts the ask mapping equals the
  harness mapping at `tools/evidence-harness.ts:973-1000`.

### Batch 2e verification

- Scoped command passes.

## Batch 2f: Permission policy and rule store — COMPLETE (verified Wave 2; commit pending)

- Verification (Wave 2, team-leader): same codex-runtime run as 2d. Policy (:11-25):
  userInput always presented; plan declines every approval (a rule hit cannot exit plan);
  rule hit -> acceptForSession; yolo accepts ordinary classes; auto-edit accepts only
  fileChange; returns only present/accept/acceptForSession/decline. RuleStore: in-memory,
  scope provider+home+workspace+thread, exact command+cwd / exact file set / MCP server+tool,
  only acceptForSession records, clear(scope), dispose; no agent-sdk import.

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: 2a, 2b | Runnable now: after 2a+2b
- Phase: P2 | Phase review: code-logic + style

### Task 2f.1: CodexPermissionPolicy — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-permission-policy.ts,
  W/libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts
- Plan reference: implementation-plan.md:205-224; C2, C3, C7
- Implementation details: pure decision function (level, request kind, rule-store hit) ->
  `present` | auto `accept`/`acceptForSession`/`decline`. auto-edit auto-accepts only
  fileChange; commands/MCP/permissions keep a prompt; yolo auto-accepts ordinary classes but
  never userInput (questions stay interactive); plan never auto-accepts writes.

### Task 2f.2: CodexPermissionRuleStore — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-permission-rule-store.ts,
  W/libs/backend/codex-runtime/src/lib/codex-permission-rule-store.spec.ts
- Plan reference: implementation-plan.md:218, :222; C3
- Implementation details: in-memory, scope key provider+home+workspace+kind(+command prefix /
  file scope / MCP server+tool); survives child restart (lives on the runtime, not the process);
  explicit `clear(scope)`; host dispose clears; no disk persistence; does not import the agent-sdk
  PermissionRuleStore.

### Batch 2f verification

- Scoped command passes; spec proves cross-home/workspace/tool isolation.

## Batch 2h: Event translator — COMPLETE (verified Wave 2; commit pending)

- Verification (Wave 2, team-leader): same codex-runtime run as 2d. Covers every validated
  notification; tool ids = item ids; one terminal per thread+turn with late events
  suppressed; usage from tokenUsage.last only when reported, no cost; fixed sanitized error
  messages. Recorded-order replay reads tracked spike-run-6h/6i/6j.json with synthetic
  payloads (spec :342-426). Lint fix for no-fallthrough at :49 applied by the lane.
- Notes for the P2 review: item/started emits `toolStarted` for commandExecution (start, not
  "ran"; decline maps to `cancelled`); the spec depends on the task-spec folder for fixtures.

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 2a, 2b | Runnable now: after 2a+2b
- Phase: P2 | Phase review: code-logic + style

### Task 2h.1: CodexEventTranslator — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-event-translator.ts,
  W/libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts
- Plan reference: implementation-plan.md:244
- Pattern to follow: sanitized frames in W/libs/backend/codex-runtime/tools/evidence-frames.ts
- Implementation details: validated notifications -> ordered `CodexRuntimeEvent`s; stable tool
  ids from item ids; `item/started` is NOT "command ran" (runs 6b-6e); exactly one terminal per
  turn; usage only when reported (absent stays absent); errors sanitized (no paths/home/tokens).
  Fixtures from the sanitized spike transcripts (spike-run-6h/6i/6j.json) used as spec input,
  labeled as recorded evidence, not fabricated.

### Batch 2h verification

- Scoped command passes.

## Batch 2g: Approval bridge — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Rationale: security-sensitive; kept to one file + spec so review is focused
- Tasks: 1 | Depends on: 2f (and 2a, 2b) | Runnable now: after 2f
- Phase: P2 | Phase review: code-logic + style

### Task 2g.1: CodexApprovalBridge — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts,
  W/libs/backend/codex-runtime/src/lib/codex-approval-bridge.spec.ts
- Plan reference: implementation-plan.md:197, :213-224; C1, C3, C4
- Implementation details: server request -> policy (2f) -> `ApprovalSink` when presented;
  correlation key contextId+processGeneration+threadId+turnId+requestId; exactly one validated
  response; stale/duplicate replies ignored; timeout/dispose -> decline if writable else end the
  process; acceptForSession records a RuleStore rule and auto-answers later matching requests;
  MCP elicitation -> `{action}` (accept fills only enum/default fields it can, else decline,
  per research-t3code-approvals.md §3); permissions/requestApproval -> scope turn/session; an
  edited-input reply -> `decline` before effect + `editNotSupported` result (never runs original
  or replacement).
- Validation notes: R2, R3.

### Batch 2g verification

- Scoped command passes; spec covers duplicate, stale generation, timeout, edit reply, MCP
  decline/cancel, session rule reuse.

## Batch 2j: Account usage client — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 2d | Runnable now: after 2d
- Phase: P2 | Phase review: code-logic + style

### Task 2j.1: CodexAccountUsageClient — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts,
  W/libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts
- Plan reference: implementation-plan.md:149; A3
- Pattern to follow: W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:257-303
- Implementation details: `read(home, {refresh?, signal?})` via a short-lived process (2d);
  cache/flights/eligibility/generation keyed by normalized home; home echo verified where the
  manifest supports it; old-generation responses dropped.

### Batch 2j verification

- Scoped command passes; spec covers two homes concurrently.

## Batch 2i: Runtime and context — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 2d, 2e, 2g, 2h | Runnable now: after those
- Phase: P2 | Phase review: code-logic + style

### Task 2i.1: CodexRuntime.open / CodexContext — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-runtime.ts,
  W/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts
- Plan reference: implementation-plan.md:109-132; C5
- Implementation details: one process per context; never pooled by home; operations serialized
  per context; persist thread identity (store port) before first turn, failure closes child and
  does not adopt the orphan thread; `startTurn`, `steer` (turn/steer, in-turn), `interrupt`
  (uncertain interrupt blocks a second turn), `updateNextTurn` (revisioned AppliedSettings),
  `compact` (thread/compact/start; wire shape evidence-gated, implemented against the pinned
  schema), `close`; exit after commit marks inactive keeping threadId; no proxy fallback.
- Validation notes: same-home chat/chat and chat/lane isolation in spec with a fake spawner.

### Batch 2i verification

- Scoped command passes.

## Batch 2k: Parity gate, DI registration and exports — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: 2a-2j | Runnable now: after the rest of P2
- Phase: P2 (last batch -> phase review due) | Phase review: code-logic + style

### Task 2k.1: CodexParityGate — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-parity-gate.ts,
  W/libs/backend/codex-runtime/src/lib/codex-parity-gate.spec.ts
- Plan reference: implementation-plan.md:324 (G5), :264-273; C9, C10; R5
- Implementation details: static evidence ledger mirroring native-route-evidence.md
  (observed: command accept/deny, file accept, plan read-only, auto-edit boundary, YOLO
  interrupt, compaction listed only if evidence exists, MCP approval; unproved: profile inputs,
  isolation, history/rewind, Always Allow scope, subagents, remote MCP, packaged binaries,
  full-access YOLO). `isEnabled(consumer, platform)` returns false for chat/gateway/lane while any
  required item is unproved or "unsupported"; unsupported is never a pass.

### Task 2k.2: Registration and public exports — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/di/registration.ts; MODIFY
  W/libs/backend/codex-runtime/src/index.ts, W/libs/backend/codex-runtime/package.json
  (tsyringe if used)
- Implementation details: `registerCodexRuntime(container, ports)`; nullable registrations use
  `{ useFactory: () => null }`, never `{ useValue: null }`; services never call
  `container.resolve` internally.

### Batch 2k verification

- Scoped command passes; then return NEEDS REVIEW for P2 (combined diff 2a..2k).

---

# Phase P3 — Legacy lane home correction (@ptah-extension/cli-agent-runtime) — runnable now

Phase review: code-logic. Implementer: Codex; reviewer: Claude.
Phase P3 — COMPLETE. Review: code-logic-review-batch-2c.md, APPROVED 8/10 (implementer Codex,
reviewer Claude). Moderate finding carried to Batch 3a: the Windows default prefers HOME over
USERPROFILE, and harness-sync codexHomeDir() resolves differently; 3a adds one shared Codex
home resolver.

## Batch 2c: Legacy Codex lane reads auth from its execution home — COMPLETE (verified; commit fix(cli-agent-runtime) read codex lane auth)
- Verification (Wave 1, team-leader): cli-agent-runtime test 111 suites / 2385 passed, 1 skipped;
  typecheck OK; lint 0 errors, 51 warnings. Scope exception recorded: one-line prefer-const fix in
  agent-process-manager.service.spec.ts:608-610 (pre-existing on main, blocks project lint).
  Per-spawn CODEX_HOME is not a CliCommandOptions field, so the order is env CODEX_HOME >
  HOME/USERPROFILE/homedir + .codex (codex-cli.adapter.ts:429-432). Phase P3 code-logic review due.

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: Claude
- Rationale: required interim fix (plan :153, requirement 4.5); files not in #808; independent of
  the core
- Tasks: 1 | Depends on: none | Runnable now: YES
- Phase: P3 | Phase review: code-logic

### Task 2c.1: Explicit/env CODEX_HOME for credential reads — COMPLETE

- Files: MODIFY
  W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts,
  W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts
- Plan reference: implementation-plan.md:153
- Current defect: `codex-cli.adapter.ts:429-430` builds `HOME/.codex/auth.json` unconditionally
- Implementation details: credential reads use the same home the lane executes with: explicit
  per-spawn CODEX_HOME > `process.env.CODEX_HOME` > HOME/USERPROFILE/homedir + `.codex`. Keep
  old permission policy, exec workaround and SDK use unchanged.
- Validation notes: R8.

### Batch 2c verification

- `npx nx run-many -t test typecheck lint -p @ptah-extension/cli-agent-runtime --parallel=1`
  (or scoped Jest `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts
libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts
--coverage=false --maxWorkers=2` followed by typecheck + lint for the project).

---

# Phase P4 — Per-home auth and legacy auth intent (@ptah-extension/auth-providers) — runnable now (outside #808 files)

Phase review: code-logic. Implementer: Codex; reviewer: Claude.
Verification for every P4 batch:
`npx nx run-many -t test typecheck lint -p @ptah-extension/auth-providers --parallel=1`.
No P4 batch edits auth-providers `src/index.ts`, `di/register.ts`, `register-providers.ts` or
`quota/provider-owner.resolver.ts` (those are in 5c, post-#808).

## Batch 3a: CodexHomeAuthService and default-home facade — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: 2a | Runnable now: after 2a
- Phase: P4 | Phase review: code-logic
- Carried from P3 review (code-logic-review-batch-2c.md, moderate): add one shared Codex home
  resolver (CODEX_HOME > USERPROFILE on Windows / HOME elsewhere > os.homedir(), + `.codex`)
  and use it in the legacy adapter (codex-cli.adapter.ts:429-432) and harness-sync
  codexHomeDir() so both resolve the same home; spec covers Windows HOME vs USERPROFILE.
  If the resolver must live outside auth-providers, the executor reports where and why.

### Task 3a.1: CodexHomeAuthService — PENDING

- Files: CREATE
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts,
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts
- Plan reference: implementation-plan.md:138-147; R7
- Implementation details: implements core `CodexHomeAuthReader`; per-normalized-home lock,
  refresh flight, atomic write (unique temp + rename), watcher refcounts, explicit refresh timeout,
  no blind retry of rotating tokens.

### Task 3a.2: CodexAuthService becomes a facade — PENDING

- Files: MODIFY
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts, its existing
  same-directory spec (create `codex-auth.service.spec.ts` if absent)
- Depends on: Task 3a.1
- Implementation details: default-home facade delegating to the same owner, including legacy
  proxy refresh; no second mutex/writer; legacy provider-only auth-change event kept, emitted only
  for the default home. Registration of the new service happens in 5c (post-#808); until then
  the facade constructs/receives the owner without touching di/register.ts (executor documents
  how).

### Batch 3a verification

- Scoped command passes; existing codex-auth behavior specs unchanged.

## Batch 3c: AuthOperationContext and CodexProxyPolicy — IN_PROGRESS

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: none (eligible for Wave 1) | Runnable now: YES
- Phase: P4 | Phase review: code-logic

### Task 3c.1: Proxy policy — IN_PROGRESS

- Files: CREATE W/libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts,
  W/libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts; MODIFY
  W/libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts
- Plan reference: implementation-plan.md:157-165
- Implementation details: `AuthOperationContext` {reason, hostNativeCodex, providerId,
  normalizedHome?}; policy decides native-return-before-env-teardown vs legacy proxy start.
  Omitted context = current behavior (hostNativeCodex defaults false; nothing enables it here).

### Task 3c.2: Keyed AuthManager flights — IN_PROGRESS

- Files: MODIFY W/libs/backend/auth-providers/src/lib/auth/auth-manager.ts and its spec
- Depends on: Task 3c.1
- Implementation details: `configureAuthentication(provider, context?)`; flights keyed by
  provider+home+reason+host policy; incompatible operations serialize without sharing results;
  Copilot and other providers unchanged.

### Batch 3c verification

- Scoped command passes; Copilot and Claude auth specs unchanged.

## Batch 3d: OAuth proxy strategy honors the context — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 3c | Runnable now: after 3c
- Phase: P4 | Phase review: code-logic

### Task 3d.1 — PENDING

- Files: MODIFY W/libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts and
  its spec
- Plan reference: implementation-plan.md:161-165
- Implementation details: pass context into the Codex branch; native-enabled host returns before
  clearing auth env or starting a proxy; Copilot branch untouched.

### Batch 3d verification

- Scoped command passes.

## Batch 3b: Home-bound usage service and quota reader — PARTIAL (3b.2 COMPLETE, merged in #809; 3b.1 moved to P5 Batch 5b)

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: 2k (core exports), 3a | Runnable now: after P2
- Phase: P4 (last batch -> phase review) | Phase review: code-logic

### Task 3b.1: Usage service delegates to the core client — PENDING

- Files: MODIFY
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts and spec,
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts
- Plan reference: implementation-plan.md:149-151; A3
- Implementation details: `getAccountUsage({home?, refresh?, signal?})`,
  `currentOwnerKey(home?)`, `clearCache(home?)`; omitted home = default resolver, never
  last-focused; DTO re-exported from core so existing imports keep compiling.

### Task 3b.2: Plan-usage reader home supplier — PENDING

- Files: MODIFY W/libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts
  and spec
- Implementation details: `createCodexPlanUsageReader(usage, now = Date.now, homeSource?)` keeps
  the clock argument (`:51-58`), forwards home each read.

### Batch 3b verification

- Scoped command passes; then NEEDS REVIEW for P4 (3a, 3c, 3d, 3b).

---

# Phase P5 — Shared contracts, usage home API, profile seam — COMPLETE (gate closed 2026-10-25; re-review APPROVED 8.5/10)

Phase review: code-logic + style (new public API). Implementer family: Codex (CLI lane).
Reviewer family: Claude (in-process code-logic-reviewer + code-style-reviewer subagents).
Re-validated 2026-10-25 against main 16c6455e1 (after #808, #809, #818). Execution order:
5a and 5b in parallel (file-disjoint: shared vs auth-providers/auth-providers-tokens; neither
depends on the other), then 5c (needs 5a types and 5b interfaces). Last batch 5c -> phase review.
Verification is memory-safe and scoped only (`npm run verify -- -p ...`, see CLAUDE.md).

### P5 re-validation against main (what #808 and the P2-P4 merges changed)

- `ProviderAccountBinding` / `accountBindingId` (712) now live on `ProviderProfile`
  (`libs/shared/src/lib/types/provider-profile.types.ts:22-24`). SessionRuntimeIdentity does NOT
  copy them: Codex account selection is TASK_2026_715 and binds through the home.
- `PermissionLevel` exists (`libs/shared/src/lib/types/model-autopilot.types.ts:20`),
  `EffortLevel` exists (`ai-provider.types.ts:137`). Core `AppliedSettings`
  (`libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:116-119`) cannot be imported by
  shared (shared is the bottom layer; core does not import shared).
- `PermissionRequest` lives in `libs/shared/src/lib/types/permission.types.ts:30` (not in
  rpc.types.ts). `PERMISSION_AUTO_RESOLVED` / `PERMISSION_SESSION_CLEANUP` exist
  (`message-constants.ts:229-230`) with untyped payloads; a per-request cancel does not exist.
- AUTH_PROVIDERS_TOKENS moved to `libs/backend/auth-providers-tokens/src/lib/tokens.ts:38-41`
  (re-exported by `auth-providers/src/lib/di/tokens.ts`).
- Codex registrations are in `auth-providers/src/lib/providers/register-providers.ts:66-97`
  (`di/register.ts` has no Codex usage registration to change; `:296` only resolves the usage
  token for plan usage).
- CodexHomeAuthService is not DI-registered; it is a per-host owner via
  `CodexHomeAuthService.forHost(logger, workspaceProvider)`
  (`codex-home-auth.service.ts:67-100`, comment "until DI registration in 5c").
- The proxy policy is a pure function `resolveCodexProxyPolicy`
  (`auth/codex-proxy-policy.ts:6`); it needs no DI registration (plan 5c item dropped).
- Owner resolver Codex methods moved to `quota/provider-owner.resolver.ts:565-588`
  (`ownerForCodexHome()`, `resolveCodexHomeOwner()`), constructor `:466-476`.
- `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace` is at
  `workspace-provider-profile-resolver.ts:127-171`, constructor `:94-109`.
- Usage service: legacy default-home App Server read `codex-account-usage.service.ts:155-313`;
  owner key = `accountOwnerKey('openai-codex', home\0email)` (`:262-264`); returns activity
  (`account/usage/read`, `:277-305`). Core `CodexAccountUsageClient`
  (`codex-runtime/src/lib/codex-account-usage-client.ts`) differs: no activity read, owner key
  from `accountId` (`:305`), and the process verifies the pinned binary digest. See decision
  P5-D1.
- DI guards (`apps/*/src/di/expected-resolvable.ts`) list handler classes only; no RPC method is
  added in P5, so `rpc-surface.spec.ts` / `surface-composition.spec.ts` stay unchanged unless a
  run proves otherwise.

### P5 decisions (team-leader, 2026-10-25)

| Id | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| P5-D1 | 3b.1: the usage service delegates EXPLICIT non-default homes to an injected nullable core client; the default home keeps the existing App Server read until a parity item closes | Full replacement now; defer all of 3b.1; explicit-home delegation with nullable client | Full replacement changes user-visible usage now: core drops `activity` (service `:277-305` vs client `usageResult`), changes owner keys (email vs accountId, breaks 712 owner-keyed quota rows), and fails on a non-pinned codex binary. Hard constraint: no user-visible change while the gate is closed. Nullable client follows the core's own `{useFactory: () => null}` pattern (`registration.ts:62-72`) | Yes: P8 composition binds the client; default-home cutover is a recorded parity item |
| P5-D2 | Shared defines its own `AppliedSettings` (same shape as core) and `SessionApprovalDecision` | Import core from shared; duplicate structurally | Shared cannot depend on a backend lib | Yes |
| P5-D3 | `RuntimeHostCapabilities` and `CodexProfileSeed` live in shared `session-runtime.types.ts` | Core; auth-providers; shared | Seed crosses auth-providers -> rpc-handlers/agent-sdk/gateway/lanes; must be credential-free plain data | Yes |
| P5-D4 | 5a does not modify `agent-adapter.types.ts` or `rpc.types.ts` | Additive edits now; defer to the consumer batch (P6/P7) | No P5 consumer; replace-not-accumulate; plan :363 says "only as needed" | Yes |
| P5-D5 | Per-request approval cancel = new constant `PERMISSION_PROMPT_CANCELLED` with a typed payload; frontend wiring stays in 8b | Reuse auto-resolved; reuse session-cleanup; new typed message | Auto-resolved means "resolved without the user"; session-cleanup is whole-session. Plan :199 asks for a typed session-scoped message | Yes |
| P5-D6 | Native branch of resolveExecutionProfile only when `hostCapabilities.nativeCodex === true`; every host passes false while the parity gate is closed (no caller until P7) | Read the gate inside auth-providers; host-supplied capability | Plan :85 `hostCapabilities`; gate stays in composition (`resolveGatedCodexRuntime`) | Yes |

## Batch 5a: SessionRuntimeIdentity and shared contracts — COMPLETE (085a9341d)

- Recommended executor: CLI lane, Codex family | Execution mode: sequential (one lane) |
  Review family: Claude (different from implementer) | Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Rationale: bounded additive contracts in one project; runs in parallel with 5b (disjoint files)
- Tasks: 1 | Depends on: none | Phase: P5 | Phase review: code-logic + style (new public API)

### Task 5a.1: Session runtime contracts — COMPLETE

- Files: CREATE W/libs/shared/src/lib/types/session-runtime.types.ts and
  W/libs/shared/src/lib/types/session-runtime.types.spec.ts; MODIFY W/libs/shared/src/index.ts,
  W/libs/shared/src/lib/types/permission.types.ts (additive optional field),
  W/libs/shared/src/lib/types/messages/message-constants.ts (one constant), plus
  W/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts ONLY if a shared spec requires
  the new message type there.
- Plan reference: implementation-plan.md:76-90, :147-161, :193-199, :358-363; decisions P5-D2..D6
- Pattern to follow: `libs/shared/src/lib/types/provider-account.types.ts` +
  `provider-account.schemas.ts` (readonly interfaces + Zod schema next to them)
- Implementation details:
  - `SessionRuntimeKind = 'claude-sdk' | 'codex-app-server'`.
  - `SessionRuntimeIdentity` (readonly): `version: 1`, `sessionId: SessionId`, `providerId`,
    `workspaceId`, `runtime: SessionRuntimeKind`, `codex?: { normalizedHome: string }` required
    when runtime is codex-app-server and absent for claude-sdk (discriminated union on runtime).
    Zod schema `SessionRuntimeIdentitySchema` + `parseSessionRuntimeIdentity(value)` returning a
    result (no throw) for persisted/IPC boundaries; unknown version rejected.
  - `sessionRuntimeIdentityMismatch(a, b)` pure helper: returns the first mismatching field
    among providerId / workspaceId / runtime / normalizedHome, or null (resume must fail on a
    mismatch, plan :78).
  - `RuntimeHostCapabilities` (readonly `{ nativeCodex: boolean }`), `RuntimeConsumer =
    'chat' | 'gateway' | 'lane'`.
  - `CodexProfileSeed` (readonly, credential-free): `providerId: 'openai-codex'`,
    `consumer: RuntimeConsumer`, `workspacePath`, `home` (case-preserving resolved path),
    `normalizedHome` (identity key), `model`, `existingIdentity?: SessionRuntimeIdentity`.
    Doc comment: never carries tokens, env, proxy URLs or headers.
  - `AppliedSettings` `{ timing: 'effectiveNow' | 'nextTurn'; revision: number }` (same shape as
    core, P5-D2).
  - `SessionRuntimeControls` exactly as plan :151-158 (setPermission(PermissionLevel),
    setModel, setEffort(EffortLevel | undefined), interrupt, compact) using existing SessionId,
    PermissionLevel, EffortLevel.
  - `SessionApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'`;
    `PermissionRequest.allowedDecisions?: readonly SessionApprovalDecision[]` (doc: present only
    for Codex requests; absent = existing Claude prompt).
  - `PERMISSION_PROMPT_CANCELLED: 'permission:prompt-cancelled'` + exported
    `PermissionPromptCancelledPayload { sessionId: string; requestId: string; reason:
    'timeout' | 'disposed' | 'turn-ended' | 'superseded' }`.
  - Export all from `libs/shared/src/index.ts`. No existing name or shape changes.
- Spec: schema accepts both runtimes, rejects codex identity without home, claude identity with
  home, unknown version, unknown extra keys (strict); mismatch helper per field.
- Validation notes: shared is imported by every host — additive only; no existing export
  renamed; no `any`/`@ts-ignore`/`as unknown as`.

### Batch 5a verification

- `npm run verify -- -p @ptah-extension/shared` passes (header names 1 project).
- Team-leader then runs host typecheck once for the phase:
  `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.

## Batch 5b: Usage service home API delegates to the core client (was 3b.1) — COMPLETE (5a7e8f989)

- Recommended executor: CLI lane, Codex family | Execution mode: sequential (one lane) |
  Review family: Claude | Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Rationale: one service + its contract + its registration; disjoint from 5a
- Tasks: 1 | Depends on: 2k, 3a (merged) | Phase: P5

### Task 5b.1: Home-aware usage service and registrations — COMPLETE

- Files: MODIFY W/libs/backend/auth-providers-tokens/src/lib/tokens.ts,
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts and
  `codex-account-usage.service.spec.ts` (same dir),
  W/libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts,
  W/libs/backend/auth-providers/src/lib/providers/register-providers.ts (+ its spec in the same
  directory if one asserts the registration list).
- Plan reference: implementation-plan.md:147-152; batches.md Task 3b.1; decision P5-D1;
  batch-3b-report.md "Blocked on #808"; code-logic-review-batch-3b.md (finding 1 closure).
- Pattern to follow: nullable registration `registration.ts:62-72` in codex-runtime;
  `instanceCachingFactory` usage at `register-providers.ts:66-68`.
- Implementation details:
  - Tokens: `SDK_CODEX_HOME_AUTH: Symbol.for('SdkCodexHomeAuth')` (the single
    CodexHomeAuthReader owner) and `SDK_CODEX_USAGE_CLIENT: Symbol.for('SdkCodexUsageClient')`
    (nullable core `CodexAccountUsageClient`).
  - register-providers: `SDK_CODEX_HOME_AUTH` = `instanceCachingFactory(c =>
    CodexHomeAuthService.forHost(c.resolve(TOKENS.LOGGER), c.resolve(PLATFORM_TOKENS
    .WORKSPACE_PROVIDER)))` — the SAME owner the CodexAuthService facade uses (forHost is keyed by
    workspace provider). `SDK_CODEX_USAGE_CLIENT` = `{ useFactory: () => null }` unless already
    registered (`isRegistered(token, true)`): host composition (P8) binds the real client.
  - `ICodexAccountUsageService.getAccountUsage({home?, refresh?, signal?})`,
    `clearCache(home?)`; `ICodexOwnerKeySource.currentOwnerKey(home?)` (update doc comments).
  - Service: inject `SDK_CODEX_USAGE_CLIENT` (`CodexAccountUsageClient | null`). A home that is
    omitted or whose `normalizeCodexHomeKey(home, process.platform)` equals the default
    resolver's key takes the EXISTING default-home path unchanged. Any other home delegates to
    the core client (`read(home, {refresh, signal})`, `currentOwnerKey(home)`,
    `clearCache(home)`); with a null client it returns `service-unavailable` / `null` / no-op
    exactly as today's refusal. Never answer an explicit home with default-home data, never the
    last-focused account. `close()` does not close the core client (composition owns it).
  - Keep the DTO re-export from core (`codex-provider.types.ts:90-93`).
- Spec: default home and omitted home hit the legacy path (existing tests keep passing
  unchanged); Windows-case/trailing-separator alias of the default home is the default home;
  explicit other home -> client.read with home/refresh/signal; null client -> service-unavailable;
  owner key and clearCache per home do not touch the default-home cache; abort propagation.
- Validation notes: Risk R5-1 (P5-D1) — the default-home user-visible result must be
  unchanged; record in the report the parity items that block a default-home cutover (activity
  read, owner-key derivation, binary pin).

### Batch 5b verification

- `npm run verify -- -p @ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens`
  (header names 2 projects). Known noise: translation-proxy.sdk.integration.spec.ts EPERM on
  Windows; 3 pre-existing auth-providers lint errors.

## Batch 5c: resolveExecutionProfile seam, same-home owner resolution, exports — COMPLETE (953fee97d)

- Recommended executor: CLI lane, Codex family | Execution mode: sequential (one lane) |
  Review family: Claude | Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Rationale: three auth-providers seams in one project, 5 files; needs 5a types and 5b interfaces
- Tasks: 2 | Depends on: 5a, 5b | Phase: P5 (last batch -> phase review)

### Task 5c.1: resolveExecutionProfile — COMPLETE

- Files: MODIFY W/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts
  and `workspace-provider-profile-resolver.spec.ts` (same dir)
- Plan reference: implementation-plan.md:76-94; decision P5-D6
- Implementation details: add `resolveExecutionProfile(input)` with the plan :82-90 signature
  using the 5a types. Order: (1) existing identity with runtime `claude-sdk` -> legacy branch;
  (2) existing identity with runtime `codex-app-server` -> requires `hostCapabilities
  .nativeCodex`, else throw a typed error (never fall back to proxy); provider/workspace/home
  mismatch (`sessionRuntimeIdentityMismatch`) throws; (3) no identity: active provider for the
  workspace (`activeProviderResolver.resolveActiveAuthForPath`) is `openai-codex` AND
  `nativeCodex` -> native seed; otherwise legacy. Native branch builds a `CodexProfileSeed` from
  the injected `SDK_CODEX_HOME_RESOLVER` path (`home`) and `normalizeCodexHomeKey`
  (`normalizedHome`) and the resolved model, and calls NONE of proxyPool.acquire, AuthManager
  .configureAuthentication, buildProfile or any AuthEnv mutation. Legacy branch returns
  `{ runtime: 'claude-sdk', providerProfile: await this.resolveProviderProfileForWorkspace(...) }`
  unchanged (including its AuthRequiredError refusal — no global fallback).
- Spec: native branch with spies proving zero proxy/auth calls; nativeCodex false -> legacy for
  openai-codex; codex identity on a non-native host throws; each mismatch throws; claude identity
  stays legacy even when native is available; legacy result equals the existing method's.

### Task 5c.2: Same-home owner resolution and public exports — COMPLETE

- Files: MODIFY W/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts and
  `provider-owner.resolver.spec.ts` (same dir), W/libs/backend/auth-providers/src/index.ts
- Plan reference: implementation-plan.md:150 (owner resolver must use the same home), :369
- Implementation details: `ownerForCodexHome(home?)` and `resolveCodexHomeOwner(home?)` pass the
  same `home` to `currentOwnerKey(home)` / `getAccountUsage({ home })`; the unknown key uses
  `home ?? this.codexHome.path`. Omitted home = today's behaviour (callers at `:713` unchanged).
  index.ts exports `CodexHomeAuthService`, `resolveCodexProxyPolicy` + `CodexProxyPolicy` type,
  and `ICodexOwnerKeySource` if not already exported; nothing removed.
- Spec: explicit home owner never returns the default-home owner key; unknown owner keyed by
  the explicit home; default path unchanged.

### Batch 5c verification

- `npm run verify -- -p @ptah-extension/auth-providers` (1 project).
- Phase P5 gate (team-leader): host typecheck
  `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`,
  then NEEDS REVIEW (code-logic + style) on the combined P5 diff.

## Batch 5d: P5 review fix round — COMPLETE (52e06df02; re-review APPROVED 8.5/10, code-logic-review-p5-fixes.md)

- Recommended executor: CLI lane, Codex family (resume of the 5c lane) | sequential |
  Review family: Claude | Subagent reason: N/A
- Tasks: 1 | Depends on: 5c | Phase: P5 (fix batch; its phase review is the one re-review,
  scoped to the fix commit)
- Source: code-logic-review-p5.md (REVISE 6.5/10) findings 1, 2 (Serious), 3 (Moderate, would
  put a Claude model id into a Codex runtime config); code-style-review-p5.md (APPROVED 7/10)
  findings 1 and 3 (Moderate, same function / owner-key split for a default-home alias).
- Recorded, not fixed (named later work): logic 4 (schema accepts unnormalized strings —
  P6/P7 identity writers normalize), logic 5 (payload-map entry for PERMISSION_PROMPT_CANCELLED —
  8b), logic 6 (explicit-home auth-file invalidation — P8 composition), style 2 (exports and
  SDK_CODEX_HOME_AUTH consumed in P6-P8), style 4-9 (Minor).

### Task 5d.1: resolveExecutionProfile resume/model fixes and owner unknown-key alias — COMPLETE

- Files: MODIFY W/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts
  and its spec; W/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts and its spec.

### P5 gate — CLOSED (2026-10-25)

- Phase P5 commits: 085a9341d (5a), 5a7e8f989 (5b), 953fee97d (5c), 52e06df02 (5d). Docs:
  7335067e2. Host typecheck passed at the gate.
- Reviews: code-logic-review-p5.md (REVISE 6.5) -> fix round 5d -> code-logic-review-p5-fixes.md
  APPROVED 8.5/10 (implementer Codex, reviewer Claude); code-style-review-p5.md APPROVED 7/10.
- Carried items (owner batch): persist normalized workspace ids with ONE shared helper for persist
  and compare (6p + 6d); surface a silent case-mismatch model fallback to the Codex default (6p
  + 7a); normalizedHome schema refine (6p); PERMISSION_PROMPT_CANCELLED payload-map entry (8b);
  explicit-home auth-file invalidation (8a). Resume survives a workspace provider switch: P6
  records this as the intended behavior (no block-on-switch rule) unless the user decides
  otherwise.

### P5 risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R5-1 usage default-home result changes for users | HIGH | P5-D1; 5b spec pins default path unchanged |
| R5-2 shared additive change breaks a host | MEDIUM | Host typecheck at the phase gate |
| R5-3 native seed path touches proxy/global auth | HIGH | 5c.1 spies assert zero calls |
| R5-4 parallel 5a/5b lanes see each other's half edits | LOW | Disjoint projects; lanes report, never fix, foreign failures |
| R5-5 owner key for explicit home leaks default owner | MEDIUM | 5b + 5c.2 specs |

---

# Run state (session 16, 2026-10-26) — P8 fix round 2 (8g)

- Fresh team-leader. Inputs: live-test-p8b.md (FAIL a, D5), code-logic-review-p8f.md (REVISE 7/10),
  code-style-review-p8f.md (APPROVE 8/10). Batch 8g decomposed (5 sub-batches, see "Batch 8g").
- S-N0 recorded as pre-existing on main -> separate PR.
- 8g-1 RUNNING: Codex lane a70bf6e6-6065-4495-b8e7-aa63445b1b09 (17:48Z), deliverable
  batch-8g-1-report.md. 8g-2 RUNNING in parallel: Codex lane 907e737f-19fb-43c5-b05d-c936daf46525
  (17:48Z), deliverable batch-8g-2-report.md.
- WRAP-UP (coordinator, session ends): no new sub-batch or lane started after this point.
- 8g-1 lane ended (resume 01a17953-dc41-7ad2-956a-a4c785ba34bd); it later picked up a queued
  message, moved its real-config spec into chat-session.native.spec.ts (no
  chat-session.service.spec.ts), and was STOPPED by the team-leader at ~18:05Z before it
  applied the ptahUiFence mapping. Verify `-p @ptah-extension/rpc-handlers` 3/3 pass; re-run 3/3
  cache hit (same tree). 8g-1 COMMITTED df531dd52 (body says D5 still open).
- **D5 still OPEN.** `message-sender.service.ts:476` always sends `ptahUiFence: true`
  (Electron) and the committed policy rejects it, so the default Electron send still fails.
  Decision (coordinator): do not reject it; map to the native developer instructions —
  profile `developerPrompt` carries `PTAH_UI_HINT` when `ptahUiFence === true` and the tool
  profile is `coding` (same gate as `sdk-query-options-builder.ts:1821-1824`); add
  `PTAH_UI_HINT` to the agent-sdk barrel (one line, `index.ts` prompt-harness block); if no
  native carrier works, accept-and-ignore with a debug log. Frontend stays runtime-unaware.
  The real-config spec must use the options message-sender builds by default (ptahUiFence
  true) and assert no rejected keys + developerPrompt contains PTAH_UI_HINT. Next session:
  resume 8g-1 lane 01a17953-dc41-7ad2-956a-a4c785ba34bd with this (task "8g-1b"), verify
  `-p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`.
- 8g-2 lane ended (resume 01a17954-2161-76c0-876a-f0d93a46f38f). Report batch-8g-2-report.md:
  M-N1, M-N2, M-N3, style M2 (new codex-binding.types.ts), M4/M5 done. Files:
  apps/ptah-electron/src/di/codex-runtime-composition.ts (+ .spec.ts),
  apps/ptah-electron/src/di/codex-session-binding.ts, apps/ptah-electron/src/di/codex-binding.types.ts (NEW),
  apps/ptah-electron/src/activation/shutdown.ts (+ shutdown.spec.ts),
  libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts (comment).
  Verify `-p ptah-electron,@ptah-extension/codex-runtime,@ptah-extension/settings-core` FAILED
  (13/14 tasks pass; ptah-electron:test 1 suite): `src/activation/shutdown.spec.ts` "Test suite
  failed to run": TypeError reading `SURFACE_STATE_SERVICE` of undefined at
  `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:127`, import chain
  shutdown.spec.ts:14 -> `src/di/codex-session-binding.ts:16` (runtime import of the
  `@ptah-extension/rpc-handlers` barrel) -> handlers/index.ts:17. The new spec loads the real
  binding, and the barrel's module-init order breaks in that context. 1273 other tests pass.
  Fix direction: make codex-session-binding.ts import only types from rpc-handlers (or move
  the runtime value it needs behind the composition), or have shutdown.spec.ts mock that
  module; do not widen allow-lists. 8g-2 is UNCOMMITTED (files above). Next session: resume the
  8g-2 lane 01a17954-2161-76c0-876a-f0d93a46f38f with this failure, then re-verify.
- 8g-3, 8g-4, 8g-5: NOT STARTED. Phase gate: NOT RUN.
- Deferred with reasons: S-N0 (pre-existing on main -> separate PR); M-N7 + M3 remainder
  (no delivery receipt / renderer-ready port, see "Batch 8g deferred"); 8f accepted items
  (M2 rollback, M6 surfaceMode, tabId fallback, ipc-bridge console.warn, global registry,
  LIVE D4).

# Run state (session 15, 2026-10-26) — P8 fix round 8f

- Fresh team-leader (Mode 2). Orphaned verifies 41480/42716 gone from the lock.
- 8f-1/8f-2/8f-3 checks done on disk: 21 removed agent-sdk barrel names have no consumer in
  apps/ or libs/ (tracked + untracked); pin data has the six fields only; composition and spec
  no longer import settings-core. Team-leader added one 8f-1 spec: packaged root + executable
  outside the bundle throws `outside the host bundle`.
- 8f-3 COMMITTED 020ec6fd8 (codex-runtime verify pass).
- 8f-1 first verify FAILED (ptah-electron typecheck: logger port takes metadata not Error at
  composition.ts:249; spec settingsStore mock not an ISettingsStore; main.quit-path.spec.ts:493
  expected message string after withBudget now logs the Error). Team-leader fixed all three;
  re-verify 14/14 pass. 8f-1 COMMITTED 1b46e5de7.
- 8f-2 first verify: test/typecheck pass; lint new error no-unsafe-finally at
  codex-chat-adapter.spec.ts:665 (throw in generator finally) -> team-leader replaced with an
  explicit iterator whose next/return reject; re-verify pass (known accounts.spec lint only).
  8f-2 COMMITTED 50c2634c7. Deferred: no metadata rollback after a later cancel (no rollback
  API on CodexChatMetadataPort).
- Docs COMMITTED 949c74b7e (reviews, live-test-p8.md, 8f-1..3 reports).
- 8f-4 RUNNING: Codex lane agent 72aebf85-b6bf-4323-9f04-3bbf2b654b95 (started 16:44Z),
  deliverable batch-8f-4-report.md. Then 8f-5, then the phase gate.
- 8f-4 lane ended PARTIAL (D3, S3, S5/M5, S6, M3 done, uncommitted, unverified). S1 needs the
  raw workspace in the identity cache (agent-sdk wiring/session-runtime-identity-cache.ts):
  team-leader authorized the scope expansion; fresh Codex lane 1a31ca04-4651-4c58-8c95-6e6d72691b64
  (16:54Z) doing S1 only, appending to batch-8f-4-report.md.
- S1 lane done (resume id 01a17922-99de-7e13-8440-4b10cddb2515): optional lookup
  `workspacePath` from codexThread.workspaceId; record throws `missing-workspace-path`.
  8f-4 scoped verify (rpc-handlers, agent-sdk, chat) running; 8f-4 resume id for fixes
  01a17919-beb2-71b2-bb25-89719874269e.
- 8f-5 RUNNING in parallel (Electron files only, disjoint from the 8f-4 verify): Codex lane
  98a20a26-e6a3-4d04-a0cc-9c26e63df9f7 (16:58Z), deliverable batch-8f-5-report.md. ipc-bridge
  responder typed from rpc-handlers `CodexChatHostPorts` (no lib edit planned).
- 8f-4 verify 1 FAILED on 3 specs (identity-store spec lacked new workspacePath; host-ports spec
  passed a 2-item decision list; event-callbacks spec expected 5 logs though `result` is now a
  no-op). Team-leader fixed the specs; re-verify (test,typecheck rpc-handlers+agent-sdk) running.
  Lint: only known agent-sdk accounts.spec and chat lazy-load/voice errors (untouched files).
- 8f-5 lane done PARTIAL (resume 01a17925-ec4b-7310-8f17-b30dd3a840c7): S2 + S3 done; M6
  (surfaceMode) and tabId-undefined minor DEFERRED (both need libs changes: ChatSessionService
  passes surfaceMode only to the broadcaster; host ports/controls require a string tabId);
  console.warn kept (bridge has no Logger); global binding registry kept (BootRefs/quit paths).
  8f-5 verify (ptah-electron, settings-core) queued.
- 8f-4 re-verify 4/4 pass. 8f-4 COMMITTED 42dc59cea.
- 8f-5 verify 1 FAILED: lint prefer-const `untrack` (composition.ts:541) and
  surface-composition.spec.ts guard regex did not allow `register<CodexChatHostPorts>(`.
  Team-leader fixed both (tracking holder; regex allows an optional type argument);
  re-verify 11/11 pass. 8f-5 COMMITTED e1f8138f6.
- Phase gate: degradation audit FAILED first (rpc-handlers 2 > baseline 1: codex-chat-host-ports.ts
  catch returning false after a coded warning); team-leader added a `reported` marker
  (60a3dada2), audit re-run PASS. di-lint PASS. Typecheck ptah-electron, ptah-extension-vscode,
  ptah-cli, ptah-tui PASS (4/4). vscode-core host-attention-ingress test PASS.
- 8f COMPLETE and green: 020ec6fd8 (8f-3), 1b46e5de7 (8f-1), 50c2634c7 (8f-2), 949c74b7e (docs),
  42dc59cea (8f-4), e1f8138f6 (8f-5), 60a3dada2 (audit marker). NOT pushed (coordinator pushes).
- Next (coordinator): push, watch PR #823 CI, live Electron test p8b (ask permission level
  first), then the one re-review scoped to the 8f commits (code-logic + code-style).

# Run state (session 14, 2026-10-26) — P8 in progress, 8a-2 re-split

- Coordinator decisions D1-D6 recorded (decisions.md last rows). 8a-2 Part B becomes 8a-2a ->
  8a-2b -> 8a-2c -> 8b (definitions under Batch 8a / 8b). Removal B moved to the end of P10
  (10d proof, 10e.. removal); P16 removed.
- Blocker 6 re-check: a concrete `CodexHomeAuthReader` DOES exist —
  `CodexHomeAuthService` (auth-providers, exported index.ts:49, registered as
  AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_AUTH). 8a-2c binds it; no new reader is built.
- Blocker 5: authKey is derivable (`resolveAuthProviderKey(authMethod, seed.providerId)`); no
  product decision needed.
- Verification noise added: Electron E2E `state.spec.ts:41` flaked once on 315c6a98f (passed
  on re-run).

# Run state (session 14, 2026-10-26) — P8 in progress

- Commits (team-leader): 18424ac85 fix degradation audit (codex-chat-host-ports `failed` now a block
  handler logging the real Error; audit pass, baseline unchanged); df836898b 8a-2a (pin lookup +
  UUID v4/v7; verify shared,codex-runtime pass); b5226c69a 8a-2b (verify rpc-handlers pass;
  agent-sdk test/typecheck pass, lint only known accounts.spec:174,183).
- 8a-2a check: literal `require` of the manifest JSON passes codex-runtime lint; Electron main is
  an esbuild ESM bundle, which inlines a resolved relative JSON require. Carry to P8 review: the
  bundle then also contains the manifest's diagnostic `binaryPath` (developer path) and method
  lists; the Zod projection strips them at runtime only.
- turnId (8a-2b CRITICAL), team-leader decision (native first): `CodexChatAdapterPorts.callbacks(
  sessionId, turn)` receives the native turn identity from the App Server `turn/start` receipt
  (codex-chat-adapter.ts, same object CodexChatEvents uses); `undefined` only for the session-level
  cleanup error. The callbacks factory takes `turn` instead of `messageId()`; content without a
  turn is refused and logged. Reversible.
- 8a-2b triage, fixed in b5226c69a: (1) approvals — the runtime never emits approvalRequested/
  approvalSettled on the chat event stream (translator: approvals belong to the bridge); the sink
  presents them through `presentation` (host attention). The callbacks no longer present them
  (no double prompt). (2) failed compaction publishes only `compaction_complete`, no synthetic
  CHAT_ERROR (the App Server's own error/terminal ends a failed turn). (3) the callbacks' empty
  `catch` around the logger (degradation empty-catch) removed; errors are logged with the real
  Error. (4) settings-record reader typed as `readForPath(...): unknown` (spec TS2322 fixed, no
  cast).
- Deferred to 8a-2c (binding): pass the shared STREAM_DELIVERY_COORDINATOR to the callbacks; call
  settings record `discardProfile` on a failed open, `release` on session end, `dispose` at
  shutdown; wrap ports with `record.wrapPorts`.
- Deferred to P8 review: compaction start uses trigger 'auto' / preTokens 0 (runtime event has
  phase only — needs upstream metadata for manual trigger and token count); hidden-tab terminal
  slot holds one terminal, so a callbacks CHAT_ERROR and the broadcaster CHAT_COMPLETE can
  overwrite each other; result reconciliation block index when only deltas streamed; image/file
  card rendering and relative native file paths (live Electron run); agent-sdk max-lines warning
  codex-chat-adapter.ts (763 > 700).
- Later session 14 commits: 3207fdda9 8b (verify -p ptah-electron,rpc-handlers,chat,shared; chat
  lint only pre-existing lazy-load import errors; host-attention spec pass; team-leader fixes: IPC
  `isRegistered` guard before resolving CODEX_CHAT_ADAPTER_PORTS, spec registers the production
  null factory); 19bbb3316 8a-2c-lib (team-leader, coordinator-directed: the SDK replaces the
  host metadata port at register.ts CODEX_CHAT_ADAPTER, so the record binds to a native adapter
  lifecycle instead of wrapping metadata); d69ca18a3 8a-2c (Codex lane; team-leader fixes:
  missing closing brace, TS2532 `persisted?.`, deep relative lib imports -> public agent-sdk
  exports CodexChatAdapter/registerCodexChatServices, source-scan spec regex, binding registry
  split into codex-binding-registry.ts so shutdown does not import rpc-handlers).
- P8 phase-gate pass (after 8b, at d69ca18a3): degradation audit pass, di-lint OK, four-host
  typecheck (ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui) pass, vscode-core
  host-attention-ingress spec pass. Next: live Electron test (user), then the P8 phase review.
- P8 review list (add to the code-logic / code-style review scope):
  - New public API: agent-sdk CodexChatSessionLifecycle, CodexChatTurnIdentity, CodexChatAdapter,
    registerCodexChatServices; rpc-handlers callbacks factory and settings record.
  - First native open hashes the bundled binary (readFileSync + sha256) and runs
    `execFileSync --version` synchronously on the Electron main thread (createScope is
    synchronous). Dev-route only today; must move off the main thread or become async before the
    gate opens.
  - Electron `tabId(id)` falls back to the session id when no tab is known.
  - Legacy control settings derive the auth namespace from the workspace's CURRENT auth, not an
    immutable per-session snapshot (provider change within one workspace).
  - `runtime-admission-mismatch` still missing from rpc-error-codes.types.ts; direct
    SDK_AGENT_ADAPTER caller audit.
  - Items listed above under "Deferred to P8 review" (compaction trigger/preTokens, hidden-tab
    terminal slot, result block index, manifest JSON in the bundle, adapter max-lines).
- User decisions (coordinator relay, session 14): per batch only the scoped verify; degradation
  audit, di-lint, four-host typecheck and host-attention run once after 8b (plus di-lint when DI
  registration changes, host-attention when permission emission changes). Live Electron test
  right after 8b, BEFORE the P8 phase review. PR scope per P8 D7.

# Run state (session 13, 2026-10-26) — P8 in progress, 8a-2 Part B BLOCKED

- Commits (team-leader): 25326130c 8d (vscode guard specs; verify -p ptah-extension-vscode 35/35);
  d8b8122fe 8a-1 (rpc-handlers host ports + agent-sdk approvals narrowed to
  Pick<SessionApprovalRouter,'register'|'respond'|'cancelPrompt'>; verify rpc-handlers 3/3);
  f853ff5bc 8a-1c (agent-sdk CodexThreadIdentityStore; agent-sdk+rpc-handlers test/typecheck pass,
  agent-sdk lint only known accounts.spec:174,183; di-lint pass; four-host typecheck pass);
  9cb10a20f fix: Codex PERMISSION_REQUEST via webviewManager + hostAttention release (CI failure
  host-attention-ingress.spec.ts:49 on d8b8122fe; rpc-handlers 3/3, vscode-core spec pass);
  5f33eae1c 8a-2 Part A ('codex-app-server' added to shared ProviderId; shared+rpc-handlers 6/6,
  four-host typecheck 4/4).
- 8a-2 Part B NOT implemented — executor stopped on scope (batch-8a-2-report.md): (1) codex-runtime
  exports only the pin type, not the manifest row (deep import forbidden); (2) Electron phase-2 is
  synchronous, so the awaited identity init must go in bootstrap.ts (after state storage :457 and
  webview manager :493, before registerRpcSurface wire-runtime.ts:332) plus shutdown.ts dispose;
  (3) permission replies need ipc-bridge.ts:416 (8b); (4) G4: no existing observer consumes Codex
  callbacks — composing "from existing observers" is impossible, needs a callbacks factory over
  the broadcaster (contradicts the accepted G4 decision -> coordinator); (5) G3: profile() lacks the
  provider settings namespace; (6) no concrete CodexHomeAuthReader (usage: null leaves explicit-home
  invalidation unmet); (7) scope factory throws when the bundled binary is missing -> create lazily.
  Proposed split: 8a-2a codex-runtime manifest-row export; 8a-2b rpc-handlers callbacks factory;
  8a-2c Electron binding (~8 files incl. bootstrap.ts, shutdown.ts, 4 guard specs); ipc hop to 8b.
- New risks for P8 review / live run: (a) Codex thread ids are used as Ptah SessionId
  (codex-chat-adapter.ts:227 SessionId.from, identity store persist) and UUID_REGEX is v4-only
  (branded.types.ts:41) — if App Server thread ids are UUIDv7 every native open is refused;
  confirm before any live run. (b) codexThread.workspaceId raw vs codexExecution.workspaceId
  normalized in one record — reviewers check every comparison. (c) codex-chat-host-ports pending
  map keeps an entry after a decision until dismiss/cancel (pre-existing).
- 8b not started (depends on the 8a-2c binding).

# Run state (session 12 close, 2026-10-26) — P8 in progress

- Commits (team-leader, not pushed): c8eb6ea50 feat(chat-streaming,chat): batch 8c; 93c101ba3
  feat(electron): batch 8a-0; 956254955 test(cli-engine,cli): batch 8e.
- Deciding verify (team-leader, started 10:00:24): `npm run verify -- -p
  @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,@ptah-extension/cli-engine,ptah-cli`
  -> 61 tasks: 59 succeeded, 2 failed. Green: ptah-electron lint/test/typecheck, cli-engine and
  ptah-cli lint/test/typecheck, rpc-handlers lint/typecheck. Red: rpc-handlers:test
  (codex-chat-host-ports.spec.ts TS2352/TS2322 casts and an incomplete message_complete event; this
  run started before fix round 2), ptah-extension-vscode:test (8d defects below). Earlier run
  `-p ptah-electron,@ptah-extension/chat-streaming,@ptah-extension/chat`: chat-streaming
  lint/test/typecheck and chat test/typecheck green; chat lint fails only on pre-existing
  lazy-load static import errors (known noise).
- Uncommitted on purpose (red or unverified):
  - 8a-1 (rpc-handlers): libs/backend/rpc-handlers/src/lib/chat/codex-host/ (4 files),
    src/index.ts, package.json (adds @ptah-extension/codex-runtime), batch-8a-1b-report.md. Fix
    round 2 (spec casts, message_complete fixture, package dependency, error causes) landed AFTER
    the deciding run started: needs one rpc-handlers verify, then commit. Open review item: the
    spec uses ProviderInfo id 'ptah-cli' because shared ProviderId
    (libs/shared/src/lib/types/ai-provider.types.ts:12) has no Codex member; the factory takes
    `info` as a dep, so 8a-2 decides what ProviderInfo the native adapter reports (gap, not a
    label to keep).
  - 8d (VS Code): apps/ptah-extension-vscode/src/di/{expected-resolvable.ts,
    container.smoke.spec.ts, rpc-surface.spec.ts, surface-composition.spec.ts}, batch-8d-report.md.
    Defects: surface-composition.spec.ts:95-99 TS2339/TS2345 (readFileSync result typed
    string | Buffer; pass 'utf8' or narrow); rpc-surface.spec.ts asserts chat:sendMessage and
    config:model-switch / effort-set / autopilot-toggle on the VS Code surface, but they are not in
    the received list (check the real RPC names before asserting). Back to the 8d executor.
- 8a-1c spec (P8 decision 1, decisions.md, coordinator option A): agent-sdk implements
  CodexThreadIdentityStore on SessionMetadataStore. Store only the identity mapping (threadId,
  contextId, processGeneration, normalizedHome, workspaceId, active/inactive); history stays in
  the App Server thread (resume via thread/resume by threadId). One record feeds
  SESSION_RUNTIME_IDENTITY_LOOKUP and the store; old codexExecution records stay readable (spec for
  an old record without the new fields). persist() is awaited before the first turn; a failed write
  refuses the launch with a typed error. markInactive compares before writing (a stale generation
  never clears a newer thread). Verify agent-sdk + rpc-handlers + di-lint + four-host typecheck.
- Next order: (1) rpc-handlers verify -> commit 8a-1; (2) 8d fix -> verify ptah-extension-vscode
  -> commit; (3) 8a-1c; (4) 8a-2 (bind: settings from profile(), callbacks composed from existing
  observers, ProviderInfo decision, permission replies via the returned handlePermissionResponse,
  8a acceptance audits, di-lint, four-host typecheck); (5) 8b (IPC mirrors the 8c wire mapping);
  (6) P8 phase review (code-logic; visual review for 8c in Electron dark + light after an
  approved live run; write-path trace of native/legacy persistence vs config RPC handles).

# Run state (session 11 close, 2026-10-26)

- P7 CLOSED. Commits: 7a b7f936961, 7c d9e9956c3, 7b cbbb8a337, 7d 4a2f15579 + 6a1ed5cbe, di-lint
  fix f57e381f9, 7e e8586f4ba. Reviews: code-logic-review-p7.md REVISE 4/10, then
  code-logic-rereview-p7.md APPROVED 7/10 (Claude reviewer, Codex implementer).
- 7e verify: rpc-handlers lint/test/typecheck 3/3 (after aligning 3 config-rpc spec fixtures to
  SessionUnavailableError). agent-sdk tests and typecheck passed; agent-sdk lint fails only on
  session-query-executor.accounts.spec.ts:174,:183 (no-unexpected-multiline), identical to
  origin/main. di-lint passed. Host typecheck (electron, vscode, cli, tui) 4/4.
- PR #826 merged into main (b72dd7a54). The coordinator merges origin/main into this branch next,
  applying the #826 merge rules recorded under Batch 7d (currentModel after the last await before
  prepare(); resolveStoredModel only on the Claude branch). P8 restarts after that merge; the 8a
  acceptance list is under Batch 8a.

# Run state (session 11, 2026-10-26)

- P7 implemented: 7a b7f936961, 7c d9e9956c3, 7b cbbb8a337. 7c ran after the fence lifted (#824
  is an ancestor of HEAD). Committed 7c before 7b; the files are disjoint.
- 7b merge hygiene for PR #826 (same two service files): every format-only hunk that the 7b lane's
  Prettier run added was reverted (chat-session.service.ts 16, chat-slash-command-router 18).
  The unformatted lines from main stay unformatted. The pre-commit hook left both files unchanged.
  Expected #826 conflicts: only the semantic hunks that move the resolveProviderProfileForWorkspace
  call into the prepare() fallback at start, resume and slash relaunch.
- Verify: npm run verify -- -p @ptah-extension/rpc-handlers -> lint, test, typecheck 3/3 passed
  (no cache hits). Host typecheck ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui -> 4/4
  passed.
- Next: P7 code-logic phase review (Claude reviewer, Codex implementer) on b7f936961^..HEAD of
  the rpc-handlers code. Then P8.

# Run state (session 9, 2026-10-25)

- Base: HEAD ef4e34932 (origin/main merged in; #824 merged into main as b5c9c8047). The fix-PR
  fence is LIFTED: 7c no longer waits.
- P6: 6a (a566781a5) + 6c (a65ff9595) COMPLETE. 6b + 6d were implemented by parallel Codex
  lanes (file-disjoint); both lanes are STOPPED (not running). Their files are on disk and are
  verified and committed by the team-leader (session 10). The 6b specs needed valid SessionId
  fixtures after 6d's stricter identity schema. Then 6e, host typecheck, then STOP for the P6
  phase review (code-logic + style, Claude reviewer).
- Account-feature overlap check (main b022672ac..50c345920, Claude multi-account):
  - 6a, 6b, 6c, 6e: no overlap (new files under codex-app-server/, or DI files the feature did
    not touch).
  - 6d: OVERLAP on W/libs/backend/agent-sdk/src/lib/session-metadata-store.ts. It now carries
    Claude `accountBinding` gates (`SessionAccountBindingError`, :85-105, :736-812) and
    `preservedIndexEntry` (:367-384, index rebuild tolerates one bad stored binding). Plan
    adjustment for 6d: `updateCodexExecution` must not read, write or require `accountBinding`;
    a Codex row never carries one; the index rebuild keeps using `preservedIndexEntry`; spec a
    Codex row next to a row with an unparseable binding (both stay listed). The account spec
    `session-metadata-store.account-binding.spec.ts` must keep passing unchanged.
    sdk-agent-adapter.ts and session-runtime.schemas.ts: not touched by the feature.
  - Later phases: the account choice is now forwarded through vscode-lm-tools agent spawn args
    (`agent-spawn-args.schema.ts`) and the CLI; 8e/10b must keep a Claude account choice out of
    the Codex lane path (Codex lanes ignore it or reject it visibly). Recorded for 10b.

# Run state (session 7 wrap-up, 2026-10-25)

- Done this session: P5 closed; P5b (DS1 0541f372b, review APPROVED 8/10); 6p (389d08ce1).
- In progress: Phase P6 (6p COMPLETE; 6a-6e PENDING). No lane running, no uncommitted task files.
- Next batch: 6a (Codex lane; 6c may run in parallel with 6a, file-disjoint, but not while a
  commit hook runs). Then 6b, 6d, 6e -> host typecheck -> P6 phase review (code-logic + style).
- Open items: 7c waits for the fix/provider-switch-model-sync merge into main and then into this
  branch; 8a acceptance check M2 (Electron passes `app.isPackaged` verbatim); lane deliverable
  paths must be absolute (the task-folder-relative form is doubled by the checker).

# Session 7 plan (2026-10-25) — order, rules and validation

Order (user decision, decisions.md last rows): P5b dev route switch -> P6 -> P7 -> P8 -> P9 (9b)
-> P10 (10b, 10c) -> S0/S1 gap spikes (paid) -> P11 native subagents -> P12 native sessions ->
P13 file-rewind checkpoint -> S2 remaining spikes (paid) -> P14 parity ledger + live Electron
parity run -> P15 Removal A -> P16 Removal B. Principle: use a native App Server feature wherever
it exists; build only where it does not (file rewind is the one confirmed build).

Rules for every batch below:

- Verification is `npm run verify -- -p <projects>` (or `-t <target> -p <projects>`, extra Jest
  flags after a second `--`), never `npx nx run-many` (CLAUDE.md supersedes the older P6-P11
  commands; the per-batch commands below are rewritten). Confirm the "Running target ... for N
  projects" header. Shared-lib phases add a host typecheck at the phase gate:
  `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
- Fix-PR fence: branch fix/provider-switch-model-sync owns config-rpc.handlers.ts (+spec),
  config-saved-model-option.ts, auth-state.service.ts, model-state.service.ts,
  model-selector.component.ts, provider-account-card.component.ts (+ specs). No batch here edits
  them until the coordinator merges main in after that PR merges. Only 7c is affected; it is
  sequenced behind that merge. P15/P16 re-check the fence before they start.
- Default executor: CLI lane, Codex family (confirmed room in `ptah_agent_list` 2026-10-25);
  reviewer: Claude subagent (different family). Fallback order: other family same capability ->
  same family other provider/model -> subagent.
- Lanes never commit, push or open PRs; the team-leader commits; the coordinator pushes.

Plan validation for the session-7 additions: PASSED WITH RISKS.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R7-1 dev switch leaks into a packaged build | HIGH | DS1 pure reader returns null when packaged; spec matrix; 8a asserts composition passes `app.isPackaged`; P5b review |
| R7-2 dev switch bypasses the gate for gateway/lane | MEDIUM | DS1 override typed to consumer 'chat' only; spec asserts gateway/lane still throw |
| R7-3 workspace-id persist/compare drift | MEDIUM | 6p one shared helper; 6d persists through it |
| R7-4 silent model substitution | MEDIUM | 6p returns the substitution; 7a emits a user-visible notice |
| R7-5 child-thread events pollute the main transcript | HIGH | 11a tags events by source threadId; 11b routes child events under the agent card; spec with interleaved parent/child frames |
| R7-6 child approval answered by nobody (hang) or auto-allowed | HIGH | 11b routes child-thread approvals to the parent session's sink; unroutable -> decline, never accept |
| R7-7 thread/revert shape differs from the schema reading | MEDIUM | S1 revert spike before 12a; 12a validates against the pinned schema |
| R7-8 shadow-tree checkpoint touches the user's index/refs | HIGH | 13a temp GIT_INDEX_FILE and a private ref namespace; spec asserts status/HEAD/index unchanged |
| R7-9 a removal drops a capability | HIGH | P15/P16 start with a parity-inventory refresh vs the base commit; removal only after P14 proof |
| R7-10 a removal exceeds the 6-file batch cap | MEDIUM | Removal batches are staged inside ONE phase and land as ONE commit each (user decision) |

Assumptions:

- AS7-1 `agentRole` and `parentThreadId` in the pinned schema
  (`protocol/codex-app-server-protocol.schema.json` ~:20378, ~:20462) are what personas and child
  mapping need — unverified; 11c starts with a schema/source check and reports a gap if roles are
  not configurable.
- AS7-2 `thread/read` returns enough item detail to replay through `CodexEventTranslator` —
  unverified; 12b spec replays a `thread/read` fixture captured in S1.
- AS7-3 `thread/revert {threadId, beforeTurnId}` is accepted on paginated threads by the pinned
  binary — unverified; S1 revert spike.

---

# Phase P5b — Dev route switch (@ptah-extension/codex-runtime) — COMPLETE (review APPROVED 8/10, code-logic-review-p5b.md)

Phase review: code-logic (it is a bypass of the production gate). Implementer Codex lane,
reviewer Claude subagent.

## Batch DS1: Dev-only chat route override — COMPLETE (0541f372b; plan docs 22f44920a; report batch-DS1-report.md; phase review APPROVED 8/10 code-logic-review-p5b.md, Claude reviewer)

- Recommended executor: CLI lane, Codex family | Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A | Review family: Claude (different from implementer)
- Tasks: 2 | Depends on: P5 | Phase: P5b | Phase review: code-logic
- Rationale: one project, six files, one coupled change (port + resolver + exports).
- Verification: `npm run verify -- -p @ptah-extension/codex-runtime` (1 project), then
  `npm run verify -- -t typecheck -p @ptah-extension/gateway-chat-bridge,@ptah-extension/auth-providers`
  (the two direct dependents of the registration API).

### Task DS1.1: Pure dev-route reader — COMPLETE

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-dev-route.ts and
  `codex-dev-route.spec.ts`
- Pattern to follow: W/apps/ptah-electron/src/main.ts:122 (`!app.isPackaged &&
  process.env['PTAH_E2E'] === '1'`); W/libs/backend/codex-runtime/src/lib/codex-parity-gate.ts
  (pure, frozen values, no I/O).
- Implementation details: `export interface CodexDevRouteOverride { readonly consumer: 'chat';
  readonly source: 'PTAH_CODEX_RUNTIME_DEV' }`; `readCodexDevRouteOverride(input: { readonly
  isPackaged: boolean; readonly env: Readonly<Record<string, string | undefined>> }):
  CodexDevRouteOverride | null` returns a frozen override only when `isPackaged === false` AND
  `env['PTAH_CODEX_RUNTIME_DEV'] === '1'` exactly; otherwise null. No `process` access inside the
  module — the host passes both inputs.
- Validation notes: R7-1. Spec matrix: packaged + '1' -> null; unpackaged + '1' -> override;
  unpackaged + 'true' / '0' / ' 1' / undefined -> null; returned object frozen.

### Task DS1.2: Gated resolver honors the override for chat only — COMPLETE

- Depends on: DS1.1
- Files: MODIFY W/libs/backend/codex-runtime/src/lib/di/tokens.ts,
  W/libs/backend/codex-runtime/src/lib/di/registration.ts and `registration.spec.ts`,
  W/libs/backend/codex-runtime/src/index.ts
- Implementation details: add `CODEX_RUNTIME_TOKENS.DevRouteOverride`; extend
  `CodexRuntimeRegistrationPorts` with OPTIONAL `devRoute?: CodexDevRouteOverride | null`
  (absent = null; optional because `codex-gateway-adapter.ts:43,58` spreads
  `Omit<CodexRuntimeRegistrationPorts, 'sink'>` from its callers, and a required field would break
  the gateway project; 8a sets it explicitly for Electron). Register it (null via
  `useFactory: () => null`). `resolveGatedCodexRuntime` keeps the gate unchanged (the
  `enabled: false` literal stays) and, when the gate is disabled, returns the runtime ONLY if
  consumer === 'chat' and the registered override's consumer is 'chat'; it logs one warning per
  container through the registered Logger port (development-only wording naming
  PTAH_CODEX_RUNTIME_DEV). Gateway and lane still throw 'Codex production routing disabled by
  parity gate'. Export the type, the reader and the token from index.ts.
- Validation notes: R7-1, R7-2. Spec: absent and null override -> chat throws; override -> chat
  resolves the same cached runtime, gateway and lane throw; warning logged once; the gate
  decision object is still `enabled: false`. The only caller outside codex-runtime is
  `codex-gateway-adapter.ts:58` — it must compile unchanged (do not edit other projects).

### Batch DS1 verification

- Result (team-leader, 2026-10-25): files verified on disk; `npm run verify -- -p
  @ptah-extension/codex-runtime` PASS (lint 0 errors / 8 warnings in untouched files, 17 suites /
  784 tests, typecheck); `-t typecheck -p @ptah-extension/gateway-chat-bridge,@ptah-extension/auth-providers`
  PASS (2 projects). Implementer: Codex lane; reviewer for the phase: Claude.

- Both artifacts exist with real logic; `npm run verify -- -p @ptah-extension/codex-runtime`
  passes (tailed); R7-1/R7-2 specs present. Last P5b batch -> NEEDS REVIEW (code-logic).

---

# Phase P6 — Chat runtime consumer (@ptah-extension/agent-sdk) — IN_PROGRESS

Phase review: code-logic + style (new public API). Implementer: Codex; reviewer: Claude.
Verification for every agent-sdk batch: `npm run verify -- -p @ptah-extension/agent-sdk`.
Prefix D = W/libs/backend/agent-sdk/src/lib/codex-app-server/ (directory absent on disk
2026-10-25 — every D file is CREATE). Phase gate adds the host typecheck.

## Batch 6p: P5 carried items — shared workspace key and model substitution — COMPLETE (389d08ce1)

- Result (team-leader, 2026-10-25): files verified on disk (report batch-6p-report.md, Codex
  lane). codex-runtime lint/test (17 suites, 808 tests)/typecheck PASS. auth-providers typecheck
  PASS; test: 75 suites pass, only `translation-proxy.sdk.integration.spec.ts` fails (known
  Windows EPERM noise, 6 tests); lint: the 3 known pre-existing errors (package.json:9,
  provider-account.store.spec.ts:132, provider-account.store.ts:16 — untouched files). Lane ran
  the 7-project typecheck (ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui,
  gateway-chat-bridge, agent-sdk, rpc-handlers): PASS.
- Handed on: the normalizedHome refine lives in
  W/libs/shared/src/lib/types/session-runtime.schemas.ts:20 (`z.string().min(1)`) -> moved to
  6d. Relative stored workspace ids are now rejected (content-free AuthRequiredError) instead
  of resolved against cwd — acceptable while the gate is closed; note for the P6 review.

- Executor: CLI lane, Codex family | sequential | Review: Claude | Subagent reason: N/A
- Files (6, 2 projects): MODIFY W/libs/backend/codex-runtime/src/lib/codex-home-path.ts and
  `codex-home-path.spec.ts`, W/libs/backend/codex-runtime/src/index.ts,
  W/libs/backend/codex-runtime/src/lib/codex-dev-route.spec.ts (P5b review M1 only);
  W/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts and its spec
- P5b review M1 (code-logic-review-p5b.md): add a codex-dev-route.spec.ts case for a missing /
  undefined `isPackaged` (cast) returning null, the R7-1 failure mode. Test only.
- Details: move the private `workspaceIdentityKey` (resolver :222) to an exported
  `normalizeCodexWorkspaceKey(path, platform)` next to `normalizeCodexHomeKey`; backslash ->
  slash only on win32 (fixes the POSIX collision in code-logic-review-p5-fixes.md); a relative
  stored id is rejected (resolver maps the throw to its content-free error) instead of resolving
  against cwd. The resolver result gains `modelSubstitution?: { requested; used; reason:
  'not-in-catalog' | 'case-mismatch' }` whenever the requested model is replaced; a case-only
  match maps to the catalog id. normalizedHome schema refine if it lives in these files; else 6d.
- Verification: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/auth-providers`
  (2 projects; known noise: 3 pre-existing auth-providers lint errors).

## Batch 6a: Chat events and approval routing — COMPLETE (a566781a5; report batch-6a-report.md)

- Result (team-leader, session 9): six files verified on disk (real logic, no stubs); Codex lane
  (implementer), continuation lane added `@ptah-extension/codex-runtime` to
  W/libs/backend/agent-sdk/package.json (lint dependency rule; the import is new in 6a).
  `npm run verify -- -p @ptah-extension/agent-sdk`: test PASS (185 suites / 4008 tests, lane run,
  cache hit on mine), typecheck PASS, lint 2 errors / 95 warnings — both errors are known noise:
  session-query-executor.accounts.spec.ts:174,183 `no-unexpected-multiline`, file and eslint
  config identical to origin/main. This Nx version prints `NX 3 tasks: ...`, not "Running target
  ... for N projects"; the verify lock label confirmed one project.
- Edit replies -> decline + editNotSupported + injected follow-up: matches the batch details and
  the core ApprovalSink contract (no user decision needed).
- Note for 6b/6e (P6 review): SessionApprovalRouter keeps an owner entry when the sink settles on
  timeout/abort/disposal; the composer must call the `register()` release function on settle.

- Files: CREATE D+codex-chat-events.ts, D+codex-chat-approval-sink.ts,
  D+session-approval-router.ts, each with same-stem spec (6 files)
- Plan reference: implementation-plan.md:197-199, :244
- Details: project CodexRuntimeEvent -> FlatStreamEventUnion; sink offers the four decisions; an
  edit reply returns decline + editNotSupported and the consumer posts the user's text as a
  follow-up (steer when a turn is active, else new turn); Claude requests keep the SDK handler.
  The router keys requests by session AND thread id so 11b adds child threads without a rewrite.
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

## Batch 6b: Codex chat adapter and routing adapter — COMPLETE (027cc1a69; report batch-6b-report.md)

- Result (team-leader, session 10): four files verified on disk (real logic). Specs fixed to
  valid SessionId fixtures by a fix lane (6d's stricter schema). `npm run verify -- -p
  @ptah-extension/agent-sdk,@ptah-extension/shared` ("Running targets lint, test, typecheck for
  2 projects"): agent-sdk 188 suites passed / 4053 tests passed (only failure was the 6e DI
  spec, fixed in 6e), typecheck PASS, lint 2 known-noise errors
  (session-query-executor.accounts.spec.ts:174,183); shared 125 suites / 3805 tests PASS.
- Approval release: `present` stores the `SessionApprovalRouter.register()` release; `dismiss`
  (called on every sink settle, incl. timeout/abort/disposal) invokes it
  (codex-chat-adapter.ts:226-243). The P6 review must confirm the sink dismisses on every
  settle path.

- Files: CREATE D+codex-chat-adapter.ts, D+routing-agent-adapter.ts, each with same-stem spec
- Plan reference: implementation-plan.md:25, :187
- Details: IAgentAdapter over the identity router; no proxy fallback after native selection;
  routing decided by persisted identity, never the focused provider; the native runtime is
  obtained ONLY through `resolveGatedCodexRuntime(container, 'chat', platform)`, so the DS1 dev
  override is the single switch; with the gate closed and no override the legacy path runs.
- Executor/review/fallback as 6a.

## Batch 6c: Runtime-neutral session controls — COMPLETE (a65ff9595; report batch-6c-report.md)

- Result (team-leader, session 9): four files verified on disk; Codex lane. Team-leader rejected
  two legacy deviations and a fresh Codex lane fixed them: (1) BLOCKING live yolo sent SDK
  'bypassPermissions', which disables canUseTool (AskUserQuestion/ExitPlanMode,
  permission-mode-map.ts:9-30) -> now PERMISSION_MODE_MAP (yolo -> 'default', level 'yolo');
  (2) legacy max was refused (capability removal, user-reserved) -> today's behavior kept: live
  xhigh, persisted max, timing 'nextTurn' (session-control.service.ts:569-606). Specs 5 suites /
  63 tests PASS; agent-sdk verify as 6a (same known lint noise).
- Note for the P6 review: a failed interrupt stays blocked until a successful interrupt or
  `releaseSession` (no turn-end release; lane decision 2 in the report).

- Files: CREATE D+session-runtime-router.ts, D+legacy-session-controls.ts, each with same-stem
  spec
- Plan reference: implementation-plan.md:171-191
- Details: SDK aliases (incl. live yolo -> bypassPermissions) only in LegacySessionControls;
  apply-before-save with rollback; failed interrupt blocks follow-up.
- Executor/review/fallback as 6a. File-disjoint from 6a/6b: may run parallel with 6a.

## Batch 6d: Metadata identity and legacy auth propagation — COMPLETE (8aaaa169c; report batch-6d-report.md)

- Result (team-leader, session 10): seven files verified on disk (plus the port file
  auth-env.port.ts, authorized for the structural AuthOperationContext). Account overlap
  adjustment honored: `updateCodexExecution` neither reads, writes nor requires `accountBinding`
  (a save that adds one to a Codex row is rejected); the index rebuild keeps
  `preservedIndexEntry`; `session-metadata-store.account-binding.spec.ts` unchanged and passing.
  Verify as 6b (same run). `npm run verify -- -t typecheck -p
  @ptah-extension/auth-providers,ptah-electron`: "Successfully ran target typecheck for 2
  projects".
- Follow-up (6d/host): `updateCodexExecution` accepts no title; new native rows get
  name = sessionId (pinned by the 6e DI spec). A title needs a writer-contract extension.

- Files: MODIFY W/libs/backend/agent-sdk/src/lib/session-metadata-store.ts and
  `session-metadata-store.spec.ts`, W/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts;
  CREATE W/libs/backend/agent-sdk/src/lib/legacy-runtime-auth.spec.ts; MODIFY
  W/libs/shared/src/lib/types/session-runtime.schemas.ts (normalizedHome refine, carried from
  6p) — 5 files, 2 projects; verify `-p @ptah-extension/agent-sdk,@ptah-extension/shared`
- Plan reference: implementation-plan.md:161, :230
- Details: optional `codexExecution` metadata via `updateCodexExecution` (sole writer, existing
  enqueueWrite); workspaceId persisted through `normalizeCodexWorkspaceKey` (6p), the same helper
  the resolver compares with; save preserves omitted runtime metadata; never converts a legacy
  row; Codex metadata is keyed by thread id and carries only title, workspace, provider, runtime
  and child agents (native-session decision — no transcript copy); SDK adapter change limited to
  typed AuthOperationContext propagation (`initialize(context?)`).
- Executor/review/fallback as 6a.

## Batch 6e: agent-sdk DI and exports — COMPLETE (f660c19bf; report batch-6e-report.md; P6 phase review PENDING)

- Result (team-leader, session 10): `npm run verify -- -p @ptah-extension/agent-sdk`: 189 suites
  passed / 4054 tests passed (3 skipped), typecheck PASS, lint 2 known-noise errors
  (session-query-executor.accounts.spec.ts:174,183), no 6e file in lint output. Host typecheck
  `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`:
  "Successfully ran target typecheck for 4 projects". Diff checked against the 6e decision row.
- P6 phase review due: code-logic + code-style (new public API), Claude reviewer, combined diff
  ef4e34932..f660c19bf (P6 commits a566781a5, a65ff9595, 8aaaa169c, 027cc1a69, f660c19bf).

- Executor: Codex lane (backend-developer role); decision row "6e" in decisions.md
  (orchestrator, session 10): synchronous lookup + async `initializeSessionRuntimeIdentityLookup`,
  nullable host tokens, approval release on settle, name = sessionId spec. A fixture lane made
  the DI spec's real-store test platform-correct (win32 workspace/home). Files: di/tokens.ts,
  di/register.ts, src/index.ts, NEW di/register.codex-runtime.spec.ts.

- Files: MODIFY W/libs/backend/agent-sdk/src/lib/di/tokens.ts,
  W/libs/backend/agent-sdk/src/lib/di/register.ts, W/libs/backend/agent-sdk/src/index.ts
- Details: register routers/adapters; native capability injected by host, default disabled;
  `{ useFactory: () => null }` for nullable bindings. Last P6 batch -> host typecheck -> phase
  review (code-logic + style).
- Executor/review/fallback as 6a.

## Batch 6f: P6 review fix round — COMPLETE (f8dfd61cc, 47e28da09; reports batch-6f-*-report.md; re-review PENDING)

- Result (team-leader, session 10): five Codex lanes (CORE, ROUTING, STORE, ADAPTER, WIRING) plus
  two spec-only lanes (invalid SessionId literal, vscode-core value import, three new
  `as unknown as` casts removed). Verify `npm run verify -- -p @ptah-extension/codex-runtime,
  @ptah-extension/gateway-chat-bridge,@ptah-extension/agent-sdk,@ptah-extension/shared`:
  codex-runtime 17 suites / 828 tests PASS, lint 0 errors; gateway-chat-bridge 4 / 132 PASS;
  shared 125 / 3805 PASS; agent-sdk typecheck PASS. After the spec fixes: agent-sdk test 193
  suites / 4100 tests PASS (3 skipped); lint 2 known-noise errors only
  (session-query-executor.accounts.spec.ts:174,183). Host typecheck (ptah-electron,
  ptah-extension-vscode, ptah-cli, ptah-tui): "Successfully ran target typecheck for 4 projects".
  The Linux CI fixture fix (platform-chosen paths) was verified on Windows only; CI confirms Linux.
- Deferred with reason:
  - Live stats callback stays an explicit refusal: SessionStatsLivePayload needs SessionStatsEntry
    fields that native usage does not report (no invented counters). Compaction preTokens and
    stream usage are mapped.
  - `review/start` (`/review`): tracked gap, no Ptah UI on this path (decision P6 fix 7).
  - FM9: solved as an explicit host contract plus a resolution guard
    (lib/wiring/codex-runtime-composition.ts) that throws on late binding changes; it cannot
    revoke references already held. 8a must audit direct SDK_AGENT_ADAPTER consumers
    (chat-session.service.ts:1071, 1237, 1330).
  - Type-level assignability check of agent-sdk AuthOperationContext against auth-providers'
    schema type: cross-project test, deferred to 7a/8a (the type is now exported).
  - Folder rename codex-app-server/ -> session-runtime/ (style "noted, not counted"): before P7
    binds to it, if the orchestrator wants it.
  - Agent-sdk-owned registrations are documented as non-overridable instead of guarded.
- Open note for the re-review: CodexModelInfo.id carries the wire `Model.id`, not `Model.model`;
  turn settings use that id. Confirm against the App Server contract (they coincide for the
  bundled presets).

- Trigger: P6 phase review REVISE (code-logic-review-p6.md 4/10; code-style-review-p6.md 6/10).
  Orchestrator decisions "P6 fix 1..11" in decisions.md. One fix round, then a re-review scoped
  to the fix commits.
- Executors: Codex lanes, file-disjoint, Claude re-review. Subagent reason: N/A.
  - CORE (codex-runtime): `model/list` -> `CodexContext.listModels()`; home-key contract spec.
    Verify `-p @ptah-extension/codex-runtime` (+ gateway-chat-bridge fake update).
  - ROUTING (D+routing-agent-adapter, session-runtime-router, session-approval-router, NEW
    session-runtime-identity): B1, B2 (RuntimeAdmissionPort), M2 router side, M3/FM7
    cancelPrompt, S2, model routing (`listSessionModels`).
  - STORE (session-metadata-store.ts + spec): style B1, S4 (CodexSessionMetadataError), M5,
    Windows casing, field preservation.
  - ADAPTER (codex-chat-adapter, codex-chat-events, codex-chat-approval-sink + specs): B3, M1,
    M2 native, M3 no timeout + `cancel`, M4 listModels/usage, S3 logger, S7 split open().
    Runs after CORE.
  - WIRING (NEW lib/wiring/*, di/register.ts, di/tokens.ts, index.ts, register spec): S1, S5,
    S6, decision 9 cache, FM9, admission token, AuthOperationContext export. Runs last.
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/shared,
  @ptah-extension/codex-runtime,@ptah-extension/gateway-chat-bridge`, then `-t typecheck -p
  ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
- Tracked gap (decision P6 fix 7): App Server `review/start` (`/review`) has no Ptah UI on this
  path; not built in P6. Revisit in a later phase (candidate: P11/P12 slash surface).

## Batch 6g: P6 second fix round (re-review) — COMPLETE (commits below; narrow re-review PENDING)

- Trigger: re-review code-logic-rereview-p6.md REVISE 6/10 (SN1 + 9 moderate),
  code-style-rereview-p6.md APPROVE 7/10 (S1-R). Decisions "P6 fix 12..21" in decisions.md.
- Executors: Codex lanes CORE2, ROUTING2, WIRING2, ADAPTER2, two follow-up lanes after the first
  team-leader verify (process-layer model/list fail-closed; stream-exhaustion busy, lint shape,
  fixtures), one spec lane (cancel presented exactly once per settle path). Reports:
  batch-6g-{core,routing,wiring,adapter}-report.md.
- Verify `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/gateway-chat-bridge,
  @ptah-extension/agent-sdk,@ptah-extension/shared`: codex-runtime 17 suites / 834 tests PASS,
  lint 0 errors; gateway-chat-bridge 4 / 132 PASS; shared 125 / 3805 PASS; agent-sdk 193 suites /
  4124 tests PASS (3 skipped), typecheck PASS, lint 2 known-noise errors only
  (session-query-executor.accounts.spec.ts:174,183). First run had 4 codex-runtime + 3 agent-sdk
  failures and a new lint error; all fixed by the follow-up lanes (real fixes, no weakened specs).
- 8a host contract (from batch-6g-wiring-report.md "Host contract for 8a"):
  1. Register SDK services, await `initializeSessionRuntimeIdentityLookup(store, logger)`, bind
     all runtime ports before resolving AGENT_ADAPTER, ROUTING_AGENT_ADAPTER or any consumer that
     holds them; bind session controls before SESSION_RUNTIME_ROUTER.
  2. SESSION_RUNTIME_IDENTITY_LOOKUP, CODEX_CHAT_ADAPTER_PORTS, RUNTIME_ADMISSION_PORT,
     RUNTIME_HOST_CAPABILITIES (and SDK-owned CODEX_CHAT_ADAPTER) are STABLE instances
     (registerInstance or a cached factory). Rebinding after first resolution needs a fresh
     container; the guard cannot revoke held references.
  3. Lookup or native ports bound without RUNTIME_ADMISSION_PORT throws
     CodexRuntimeCompositionError `missing-admission-port`; all-null keeps the exact SDK adapter.
  4. An unstable binding throws `unstable-binding` ("bind a stable instance"); other codes:
     identity-lookup-disposed, persisted-identity-unavailable, session-thread-mismatch. Hosts
     branch on `code`, never on message text.
  5. Native metadata writes go through the initialized lookup inside SDK composition; hosts own
     lookup disposal.
  6. NATIVE_SESSION_CONTROLS.canSendFollowUp wraps the DI-resolved CODEX_CHAT_ADAPTER
     `canSendFollowUp(sessionId)` (arrow wrapper keeps the receiver). Hosts never import the
     adapter class as a value (S1-R: no value export).
- 8a audit list (direct SDK-adapter use that bypasses routing): chat-session.service.ts:1071, 1237,
  1330; chat-stream-broadcaster.service.ts:351-359 (decision P6 fix 12).
- Deferred with reason:
  - M8 (models for a native session with no open context) -> 8a: needs a host-level model
    source (an App Server process without a thread); Electron first.
  - M9 (VS Code/CLI hosts without ISessionRecordRepository preload one workspace) -> 8d/8e:
    Electron uses the records repository (listAll across projects).
  - Live stats stay refused (decision P6 fix 21): cacheCreation now comes from the wire, but a
    resumed context has no prior message count and no lifetime totals, so SessionStatsEntry
    messageCount/totals cannot be exact; no invented counters.
  - SN1 limit (decision P6 fix 21): metadata.save has no rollback; a tab close during the save
    lets it finish, then no turn starts, the context closes, busy/ownership are released; the row
    stays resumable. Spec "cancel during save".
  - Store M9 style (two workspace-key rules): not behavior-preserving to unify cheaply (legacy
    permissive helper vs strict Codex key); kept, reason in batch-6g-routing-report.md.
  - Style M8 (approval identity as string): shared PermissionPromptCancelledPayload carries a
    string sessionId on the wire.
  - m1 accumulator replay spec: needs frontend libs (agent-sdk must not import them); event
    order pinned in codex-chat-events.spec.ts.
  - register.ts still over the 700-line max-lines warning (down 125 lines; not an error).
  - `review/start` tracked gap (unchanged).

## Batch 6h: P6 cleanup after re-review 2 — COMPLETE (4b6f6f3a3; no new phase review)

- Trigger: code-logic-rereview2-p6.md APPROVED 6g (7/10, 0 blocking, 0 serious); orchestrator
  asked for N1, N2, N3 (decision P6 fix 22), m-a and the cache-write caveat.
- Lanes: CORE3 (`CodexReportedUsage.lastRequestTotalTokens` = wire `tokenUsage.last.totalTokens`),
  ADAPTER3 (N1 publish recheck + overlapping resume of one thread + resume-id alias for
  endSession/interruptSession/owns; N2 preTokens from the last request frame; m-a Stop before the
  receipt returns true), WIRING3 (any partial native binding throws CodexRuntimeCompositionError
  `partial-native-binding` naming the missing tokens; host-bound vs default capabilities
  distinguished by registration source). Reports batch-6h-{core,adapter,wiring}-report.md.
- Verify `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/gateway-chat-bridge,
  @ptah-extension/agent-sdk`: codex-runtime 17 / 834 PASS; gateway-chat-bridge 4 / 132 PASS;
  agent-sdk 193 suites / 4148 tests PASS (3 skipped), typecheck PASS, lint 2 known-noise errors
  only. Host typecheck (ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui): "Successfully
  ran target typecheck for 4 projects".
- Cache-write caveat (open question, decisions.md "Cache-write caveat"): upstream rust-v0.155.1
  does not prove that `cacheWriteInputTokens` is inside `inputTokens` (no doc comment;
  `non_cached_input` does not subtract it). Mapping unchanged (input = inputTokens -
  cachedInputTokens; cacheCreation = cacheWriteInputTokens). Settle with a spike (S0/S1) before
  any cost is derived from it.
- 8a audit list addition: "same session in two tabs" (two tabs resuming one native thread; the
  adapter rejects/joins the second open, the host must route the second tab to the first).

### P6 gate — CLOSED (2026-10-26)

- Reviews: code-logic-review-p6.md (REVISE 4/10) -> 6f -> code-logic-rereview-p6.md (REVISE
  6/10) + code-style-rereview-p6.md (APPROVE 7/10) -> 6g -> code-logic-rereview2-p6.md (APPROVE
  7/10) -> 6h cleanup (team-leader Mode 2 verify). Implementer family Codex, reviewer family
  Claude. Decisions P6 fix 1..22 in decisions.md.

---

# Phase P7 — Chat RPC (@ptah-extension/rpc-handlers) — COMPLETE (P7 CLOSED: review REVISE 4/10 code-logic-review-p7.md; fix 7d; re-review APPROVED 7/10 code-logic-rereview-p7.md; cleanup 7e)

Phase review: code-logic. Implementer: Codex; reviewer: Claude. Verification:
`npm run verify -- -p @ptah-extension/rpc-handlers`. Prefix R = W/libs/backend/rpc-handlers/src/lib/.

## Batch 7a: ChatRuntimeProfileService — COMPLETE (b7f936961; report batch-7a-report.md)

- Files: CREATE R+chat/session/chat-runtime-profile.service.ts and same-stem spec
- Plan reference: implementation-plan.md:95 (G1)
- Details: when the resolver returns `modelSubstitution` (6p), emit a user-visible session notice
  naming the requested and the used model (carried P5 item).
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

## Batch 7b: Chat start/resume and slash routing — COMPLETE (cbbb8a337; report batch-7b-report.md)

- Files: MODIFY R+chat/session/chat-session.service.ts,
  R+chat/session/chat-slash-command-router.service.ts; CREATE
  R+chat/session/chat-slash-command-router.native.spec.ts
- Plan reference: implementation-plan.md:95, :189 (re-locate line anchors on disk)
- Details: both start and resume delegate to prepare(); native /compact ->
  SessionRuntimeControls.compact; legacy slash unchanged; resume after a workspace provider switch
  keeps the stored identity (recorded behavior, P5 gate).
- Executor/review/fallback as 7a.

## Batch 7c: Config RPC through SessionRuntimeControls — COMPLETE (d9e9956c3; report batch-7c-report.md; P7 phase review PENDING)

- Files: MODIFY R+handlers/config-rpc.handlers.ts; CREATE R+handlers/config-runtime-controls.spec.ts
- Fence: config-rpc.handlers.ts is changed by fix/provider-switch-model-sync. Start only after
  the coordinator merges main (with that PR) into this branch; re-read the file then. If the fix
  PR is still open when P8 is ready, P8 proceeds: nothing in P8 needs 7c; the P7 phase review then
  runs after 7c.
- Plan reference: implementation-plan.md:181-185 (G2); remove `mapPermissionToSdkMode` direct SDK
  calls; audit auth/provider/config-scope callers.
- Executor/review/fallback as 7a. Last P7 batch -> phase review.

## Batch 7d: P7 review fix round — COMPLETE (4a2f15579, 6a1ed5cbe; di-lint fix f57e381f9; re-review APPROVED 7/10 code-logic-rereview-p7.md)

- Review: code-logic-review-p7.md, REVISE 4/10 (B1, B2, S1, S2, M1-M6, minors). Decisions: P7 fix
  1-8 in decisions.md. One fix round; then a narrow re-review on the 7d commits.
- Execution mode: parallel, two Codex CLI lanes, file-disjoint. Fallback order: other family same
  capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family:
  Claude (implementer Codex).
- Batch-cap exception: each lane owns up to 8 files across rpc-handlers, agent-sdk and shared,
  because each fix spans the RPC caller and its port contract. One deciding verify covers both.

### Task 7d.1: chat side (B1, S1, R7-4 notice, slash metadata minor) — COMPLETE (4a2f15579)

- Lane A files: R+chat/session/chat-session.service.ts, chat-slash-command-router.service.ts,
  chat-runtime-profile.service.ts (+spec), chat-session.native.spec.ts,
  chat-slash-command-router.native.spec.ts; W/libs/shared/src/lib/types/agent-adapter.types.ts;
  W/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts (+spec).
- Report: batch-7d-a-report.md.

### Task 7d.2: config side (B2, S2, permission rollback, M1/M2) — COMPLETE (6a1ed5cbe)

- Lane B files: R+handlers/config-rpc.handlers.ts (+spec), config-runtime-controls.ts (+spec);
  W/libs/shared/src/lib/types/session-runtime.types.ts;
  W/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts (+spec),
  session-runtime-router.ts (+spec).
- Report: batch-7d-b-report.md.

### Batch 7d carried rules (for 8a and the #826 merge)

- 8a persistence contract (P7 fix 4): when SESSION_RUNTIME_ROUTER is bound, the session controls own
  the settings write and its rollback; the config RPC passes `applyTo` to them and does not
  write. Without bound controls the RPC writes. 8a binds the router and the legacy persistence
  port so that exactly one write happens. Final wording and the native-route rule:
  batch-7d-b-report.md.
- 8a: cancel during `prepare()` is not observed (pre-existing on the Claude path, FM10); 8a
  decides whether the native launch checks the abort before opening the thread.
- 8a: the notice's top-level `message_complete` may trigger queued-content dispatch in
  streaming-handler.service.ts:508-519 (FM8, M4, not reproduced); verify in 8a or give the notice
  its own event type.
- 8a: `prepare()` refusals are plain Errors without an RPC code (minor).
  `ResolvedChatExecution.config` carries `mcpServersOverride` (may hold MCP auth headers): never
  log or fingerprint it.
- 8a: `chat:start` with no caller path now requires the host-default root to be inside
  `getWorkspaceFolders()` (minor, low risk on Electron/CLI: `activeFolder ?? folders[0]`).
- #826 merge rules (P7 fix 8): compute `currentModel` after the last await before `prepare()` in
  start, resume and slash relaunch; apply `resolveStoredModel` only on the Claude (legacy) branch.

- Batch 7d result (session 11): deciding verify -p shared, agent-sdk, rpc-handlers: 8/9 passed
  (tests and typecheck for all three; lint for shared and rpc-handlers). agent-sdk lint fails only on
  2 no-unexpected-multiline errors in helpers/session-lifecycle/session-query-executor.accounts.spec.ts
  :174,:183, a file identical to origin/main (accounts feature), not touched by this task. di-lint
  passes after f57e381f9. Host typecheck ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui,
  ptah-extension-webview: 5/5 passed.
- 7d open items for 8a (beyond the carried rules above): native session controls need their own
  persistence port, since the router only dispatches (batch-7d-b-report.md decision 3). The fallback
  cannot restore a live effort after a failed save, because SessionControl does not track live
  effort: it logs a warning and rejects. The fallback detects a non-live session from the
  SdkError message ('session not found' / 'session query not initialized'), which is fragile;
  8a's bound controls replace it. Permission restore writes resolved values as explicit values,
  so the scope can drift (pre-existing M2 limit).

### Batch 7d verification

- npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk,@ptah-extension/shared
  (team-leader's deciding run), then the four-host typecheck.

## Batch 7e: P7 re-review cleanup — COMPLETE (e8586f4ba; report batch-7e-report.md; no new phase review)

- Re-review: code-logic-rereview-p7.md APPROVED 7/10 (0 blocking, 0 serious, 5 moderate).
  Decisions P7 fix 9-11.
- Executor: one Codex CLI lane, sequential. Report batch-7e-report.md. Fallback order as 7a.
- Files: R+chat/session/chat-session.service.ts, chat-slash-command-router.service.ts,
  chat-session.native.spec.ts, chat-slash-command-router.native.spec.ts, R+handlers/config-runtime-controls.ts
  (+spec); W/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts (+spec); at most
  one agent-sdk file for a typed session-unavailable signal if that is the smaller change.
- Verify: rpc-handlers + agent-sdk, di-lint, host typecheck.

---

---

# Phase P8 — Host composition and approval presentation — PENDING (needs P6, P7 except 7c)

Phase review: code-logic; visual review (Electron, dark + light) for 8c. Electron first; VS Code
and CLI get compatible bindings only (no feature work).

## Batch 8a: Electron DI composition and dev switch wiring — COMPLETE (8a-2c d69ca18a3; P8 phase review PENDING after the live Electron test)

- Session 12 split (team-leader decision, 6-file cap): no host implementation of
  CodexChatAdapterPorts, RuntimeAdmissionPort, NativeSessionControls or LegacySessionControlPorts
  exists yet (grep over libs/apps at d24de2a2c), so the port factories go into a NEW Electron file
  instead of growing phase-2-libraries.ts.
  - 8a-0 — COMPLETE (93c101ba3): CREATE W/apps/ptah-electron/src/di/codex-runtime-composition.ts and
    `codex-runtime-composition.spec.ts` — host-specific infrastructure only (routing/capability
    from gate + DS1 with `isPackaged`/`env` verbatim, bundled-root-constrained executable, per-session
    child runtime scope with runtime -> usage -> container close, awaited identity initializer).
    Report batch-8a-1-report.md (the lane stopped at the rpc-handlers export boundary). Verify
    `npm run verify -- -p ptah-electron`.
  - 8a-1 — COMPLETE (d8b8122fe + attention fix 9cb10a20f); 8a-1c — COMPLETE (f853ff5bc);
    8a-2 Part A — COMPLETE (5f33eae1c); 8a-2 Part B — BLOCKED (see Run state session 13).
    Original 8a-1 entry (re-scoped after 8a-0; coordinator allowed narrow public exports from
    rpc-handlers): the host-agnostic ports live in rpc-handlers, which owns ChatStreamBroadcaster,
    ChatRuntimeProfileService, permission presentation and config persistence (plan: "Electron
    registers shared ports"). CREATE R+chat/codex-host/ codex-chat-host-ports.ts (+spec: profile,
    admission, presentation, replacement, callbacks, publish), native-session-controls.ts (+spec:
    persistence-owning, canSendFollowUp, exactly-once write, effort/permission-scope rollback),
    legacy-session-control-ports.ts; MODIFY R+index.ts (narrow exports). Verify rpc-handlers,
    di-lint, four-host typecheck. Report batch-8a-1b-report.md.
  - 8a-1 result (session 12): factories written and exported, NOT bindable yet. Gaps found
    (batch-8a-1b-report.md "Needs a lib batch"), decided by the team-leader or sent to the
    coordinator:
    - G1 FM-R5 "single physical write": NOT a gap. code-logic-rereview-p7.md:119-122 defines
      FM-R5 as one logical owner (exactly one save per change, applyTo honoured, autopilot pair,
      partial-write restore). The factory already restores partial writes. No settings-core
      transaction API (team-leader decision; reversible).
    - G2 RESOLVED by P8 decision 1 (coordinator, option A) -> new batch 8a-1c before 8a-2:
      agent-sdk CodexThreadIdentityStore on SessionMetadataStore (identity mapping only; old
      codexExecution records stay readable with a spec; awaited persist with a typed failure;
      compare-before-markInactive). Verify agent-sdk + rpc-handlers + di-lint + host typecheck.
      Original finding: no persistent CodexThreadIdentityStore implementation exists anywhere
      (interface codex-runtime-ports.ts:33; grep over libs/apps finds no implementer). runtime.open
      must persist the identity before the first turn, and resume needs read(contextId); session
      metadata (session-metadata-store.ts:76) keeps only provider/workspace/home. Owner and storage
      are a plan decision -> coordinator.
    - G3: initial per-session control settings (`settings(sessionId)`) have no supported source.
      Smallest option: profile() records the session's model/effort/permission when it builds the
      profile, inactive sessions read the persisted binding; no agent-sdk change. Pending G2's owner.
    - G4: concrete CodexChatEventCallbacks (result/content/live/compaction observers) are injected,
      not assembled. 8a-2 composes them from existing rpc-handlers observers.
    - Write-path trace (review item): the factory writes through WorkspaceScopeResolver with the
      session's provider namespace (providerSelectedModelDef/providerReasoningEffortDef), while the
      unbound config RPC writes through modelSettings/reasoningSettings handles and configManager
      (config-rpc.handlers.ts:212,:749,:365). The phase review must confirm both reach the same
      physical keys and scopes.
  - 8a-2 Part B re-split (session 14, coordinator D1-D4; decisions.md last rows). Order
    8a-2a -> 8a-2b -> 8a-2c -> 8b. 8a-2a and 8a-2b are file-disjoint and may run in parallel;
    8a-2a commits first because the 8a-2b v7 schema spec needs it.
  - 8a-2a — COMPLETE (df836898b) (libs: codex-runtime, shared). Executor: CLI lane, Codex family; review
    Claude. Files (max 6):
    - codex-runtime: CREATE `src/lib/codex-executable-pin.ts` (+ `.spec.ts`): a reviewed-row
      lookup `findCodexExecutablePin(platform, arch)` over the reviewed manifest JSON, returning
      `undefined` when there is no row (blocker 1); MODIFY `src/index.ts` (export it).
    - shared (D3): MODIFY `src/lib/types/branded.types.ts`: `UUID_REGEX` accepts version 4 OR 7
      (`[47]` in the version nibble), RFC variant `[89ab]` kept; rewrite the comment above it
      (v4 = Claude SDK and Ptah-minted ids; v7 = Codex App Server thread ids,
      codex-app-server-protocol.schema.json:20434); `SessionId.create()` stays v4. MODIFY
      `branded.types.spec.ts`: v7 accepted by SessionId.validate/from/safeParse; version 1/3/5/
      8/9, bad variant, nil and max still rejected.
    - Reader audit (team-leader, session 14): no reader uses "is v4" to tell id kinds apart.
      Readers: session-stats-reader.service.ts:169,:279 (Claude JSONL filenames, v4 only on
      disk, widening is harmless); chat-rpc.schema.ts:56, session-rpc.schema.ts:25,
      session-rpc.handlers.ts:287, session-organization-rpc.schema.ts:65 (session id
      boundaries — must accept v7 or a native session is refused at RPC); permission.schemas.ts
      and permission.parsers.ts (sessionId and tabId; parsers and schemas share UUID_REGEX, so
      wire-parsers.equivalence.spec stays in lockstep; its UUID_BAD_VERSION is version 9);
      MessageId/CorrelationId/TabId reuse the regex (v4-minted; accepting v7 distinguishes
      nothing). sdk-permission-handler.ts:883 uses uuid.validate (any version). Local v4-only
      copies NOT changed (not session ids): chat-state ids.ts (ConversationId, BackgroundAgentId,
      SurfaceId), agent-process.types.ts AgentId, ptah-tui use-chat.spec.ts.
    - Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/shared`; di-lint;
      four-host typecheck; tests of the shared consumers above:
      `npm run verify -- -t test -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`.
  - 8a-2b — COMPLETE (b5226c69a; turnId + triage below) (lib: rpc-handlers). Executor: CLI lane, Codex family; review Claude.
    Files (max 6) under R+chat/codex-host/:
    - CREATE `codex-chat-event-callbacks.ts` (+ spec) (D2, blocker 4): a factory that builds a
      concrete `CodexChatEventCallbacks` (agent-sdk codex-chat-events.ts:30-47) over the existing
      `ChatStreamBroadcaster` and existing webview message types: final reasoning, compaction
      phases, file/image/approval live events, error text. Reuse existing chat message types and
      the existing streaming pipeline; a new message type only when no equivalent exists, with
      the reason in the report. No log-only callback.
    - CREATE `codex-session-settings-record.ts` (+ spec) (G3, blocker 5): records the session's
      settings when `profile()` builds the profile (model, effort, permission, workspace) and
      `authKey = resolveAuthProviderKey(<the session's auth method>, seed.providerId)`
      (platform-core settings-auth-key.ts:12; the same derivation the legacy route uses,
      effective-route-method.ts:204, workspace-scope-methods.ts:95); inactive sessions derive
      authKey from the identity record's providerId and read the persisted provider-namespaced
      model/effort at the workspace scope. Throws a typed error for an unknown session.
    - MODIFY `R+index.ts` (narrow exports); MODIFY `handlers/chat-rpc.schema.spec.ts` (a v7
      session id passes the chat schemas; needs 8a-2a).
    - Verify: `npm run verify -- -p @ptah-extension/rpc-handlers`.
  - 8a-2c-lib — COMPLETE (19bbb3316): agent-sdk `CodexChatAdapterPorts.sessions` lifecycle
    (opened/closed); settings record binds to it (wrapPorts/discardProfile/release removed).
  - 8a-2c — COMPLETE (d69ca18a3) (app: ptah-electron; 8 files, coordinator-approved exception to the 6-file
    cap: one project, four of them guard specs). Executor: CLI lane, Codex family; review Claude.
    - MODIFY `codex-runtime-composition.ts` (+ spec): async `bindElectronCodexChat(container,
      { isPackaged: app.isPackaged, env: process.env, ... })`; literal
      `container.register(SDK_TOKENS.X, { useValue })` for SESSION_RUNTIME_IDENTITY_LOOKUP,
      CODEX_CHAT_ADAPTER_PORTS, RUNTIME_ADMISSION_PORT, RUNTIME_HOST_CAPABILITIES,
      NATIVE_SESSION_CONTROLS, LEGACY_SESSION_CONTROL_PORTS; ProviderInfo id
      `'codex-app-server'`; identity store from `createCodexThreadIdentityStore(lookup,
      metadataStore)`; callbacks from 8a-2b; settings from the 8a-2b record. Blocker 7: the scope
      factory (bundled binary, pin from 8a-2a, sha256 + `--version` identity) is created lazily
      and only when `capabilities.nativeCodex` is true; native off never touches the binary.
      Blocker 6: `usage: { auth, profileForHome }` with `auth` = the existing concrete
      `CodexHomeAuthService` (auth-providers index.ts:49, AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_AUTH,
      register-providers.ts:63) — it already watches the explicit home's auth file; the App
      Server's native `account/updated` and `account/login/completed` notifications and
      `account/read` (protocol schema) are used where the runtime already consumes them; build
      nothing new for invalidation.
    - MODIFY `activation/bootstrap.ts` (blocker 2): await the bind after state storage (:457)
      and WEBVIEW_MANAGER (:493), before `registerRpcSurface` (wire-runtime.ts:332) and
      `startAgentAdapterInitialization`; MODIFY `activation/shutdown.ts`: `lookup.dispose()`,
      scope close, runtime -> usage -> container close.
    - MODIFY the four DI guard specs: `expected-resolvable.ts`, `container.smoke.spec.ts`,
      `rpc-surface.spec.ts`, `surface-composition.spec.ts`.
    - Audits (8a acceptance list) recorded in the batch report.
    - Verify: `npm run verify -- -p ptah-electron`; di-lint; four-host typecheck.
- Recommended executor: CLI lane, Codex family | Review: Claude | Subagent reason: N/A
- Files: MODIFY W/apps/ptah-electron/src/di/phase-2-libraries.ts, `expected-resolvable.ts`,
  `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`; CREATE
  W/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts
- Details: register core ports with the BUNDLED codex binary path (R4); pass
  `devRoute: readCodexDevRouteOverride({ isPackaged: app.isPackaged, env: process.env })` (DS1);
  router resolves native-off by default; explicit-home auth-file invalidation (carried P5 logic
  6). Spec: gate disabled (R5); packaged -> devRoute null; unpackaged + PTAH_CODEX_RUNTIME_DEV=1
  -> chat routes native, gateway/lane do not.
- Acceptance check from P5b review M2 (code-logic-review-p5b.md): Electron passes the real
  `app.isPackaged` verbatim (no coercion, no default) to `readCodexDevRouteOverride`; no other
  host (VS Code, CLI, TUI, gateway) passes a non-null `devRoute`. The 8a review must confirm both.
- 8a acceptance list from P6/P7 (code-logic-review-p7.md, code-logic-rereview-p7.md, batch 7d
  carried rules above). Each needs code or a recorded reason:
  - `await initializeSessionRuntimeIdentityLookup(store, logger)` before the first resolution;
    bind stable instances before the first adapter resolution.
  - Register literally (`container.register(TOKEN, ...)` in a register*.ts) every token a class
    injects (di-lint).
  - Native session controls with `canSendFollowUp` and their own persistence: exactly one settings
    write per change on the native route (FM-R5), the same single-owner rule as legacy.
  - Build the validated CodexExecutionProfile; do NOT publish the model notice again (7b does).
  - Live effort may diverge from the saved value after a failed save on the Claude fallback
    (FM-R2, config-rpc.handlers.ts:746-750): bound controls must own effort rollback.
  - Permission restore scope drift (FM-R6/M2); overlapping model switches restore the wrong
    predecessor on the fallback (minor); `runtime-admission-mismatch` is not in
    rpc-error-codes.types.ts (minor).
  - Audit: direct SDK_AGENT_ADAPTER users in chat-session.service.ts; broadcaster cleanup
    chat-stream-broadcaster.service.ts:351-359; the same session open in two tabs; pending-resume
    thread-id cleanup; cancel during `prepare()`; the notice's `message_complete` versus queued
    content.
- Verification: `npm run verify -- -p ptah-electron`

## Batch 8b: Electron IPC approval ownership — COMPLETE (3207fdda9; report batch-8b-report.md)

- Files: MODIFY W/apps/ptah-electron/src/ipc/ipc-bridge.ts; MODIFY
  W/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts and its spec
- Details: IPC routes request ownership to SessionApprovalRouter; typed session-scoped cancel;
  cancelPrompt posts no response; PERMISSION_PROMPT_CANCELLED payload-map entry (carried P5
  logic 5).
- Session 14 additions (coordinator D1, D4; 3 projects, coordinator-directed exception to the
  2-project cap):
  - Blocker 3: `ipc-bridge.ts:416` routes a permission reply through the bound
    `handlePermissionResponse` (Codex request ids reach the Codex host ports, others the Claude
    `SdkPermissionHandler.handleResponse`).
  - D4: MODIFY W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts and
    its spec: remove a request from the pending map when the user decides (today it stays until
    dismiss/cancel), keeping the host-attention release (host-attention-ingress.spec.ts).
- Verification: `npm run verify -- -p ptah-electron,@ptah-extension/chat,@ptah-extension/rpc-handlers`
  (chat has pre-existing lint noise — compare with main before attributing); di-lint; four-host
  typecheck; `npm run verify -- -t test -p @ptah-extension/vscode-core --
  --testPathPatterns=host-attention-ingress`.
- Executor/review as 8a.

## Batch 8c: Codex approval decisions in the permission prompt — COMPLETE (code; report batch-8c-report.md; visual review waits for an approved live Electron run)

- Wire mapping 8a-1/8b must mirror: accept->allow, acceptForSession->always_allow,
  decline->deny_with_message (no reason), cancel->deny. 6 files (dispatcher + spec added).

- Recommended executor: frontend-developer subagent (Claude family)
- Subagent reason: rendered UI change needs Electron dark/light screenshots (visual work a lane
  cannot capture)
- Review family: Codex CLI lane (code-logic review), plus visual-reviewer subagent in Electron
  (dark + light; before screenshots from the base commit, after from the batch)
- Files: MODIFY W/libs/frontend/chat-streaming/src/lib/permission-handler.service.ts and
  `permission-handler.service.spec.ts`; plus the existing permission prompt component that
  renders decisions (executor locates it; max 4 files, chat-streaming + chat only; never a
  fix-PR file)
- Details: when a request carries `allowedDecisions`, render exactly those (accept, accept for
  session, decline, cancel) and no edit control; Claude prompts unchanged.
- Verification: `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat`
- File-disjoint from 8a/8b: may run in parallel with 8a.

## Batch 8d: VS Code compatible bindings — COMPLETE (25326130c; report batch-8d-report.md)

- Files: MODIFY W/apps/ptah-extension-vscode/src/di/phase-2-libraries.ts, `expected-resolvable.ts`,
  `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`
- Details: compatible ports, `devRoute: null`, legacy chat default; no UI rollout.
- Verification: `npm run verify -- -p ptah-extension-vscode`
- Executor/review as 8a.

## Batch 8e: CLI engine and ptah-cli bindings — COMPLETE (956254955; report batch-8e-report.md; container.ts unchanged, LEGACY_SESSION_CONTROL_PORTS unbound)

- Files: MODIFY W/libs/backend/cli-engine/src/lib/container.ts,
  W/libs/backend/cli-engine/src/lib/surface-composition.spec.ts,
  W/apps/ptah-cli/src/di/expected-resolvable.ts; CREATE
  W/libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts
- Details: `devRoute: null`.
- Verification: `npm run verify -- -p @ptah-extension/cli-engine,ptah-cli`
- Executor/review as 8a. Last P8 batch -> host typecheck -> phase review (code-logic; visual
  review for 8c).

## Batch 8f: P8 fix round (live-test-p8.md, code-logic-review-p8.md, code-style-review-p8.md) — COMPLETE (020ec6fd8..60a3dada2; re-review pending after live test)

- Phase: P8 | Phase review: the one re-review, scoped to the 8f commits (code-logic + style,
  new public API) after the coordinator reruns the live Electron test.
- Recommended executor: CLI lane, implementation capability (Codex had the only confirmed room).
  Fallback order: other family same capability -> same family other model -> subagent.
  Subagent reason: N/A. Review family: implementer Codex, reviewer Claude (different family).
- Order: 8f-1, 8f-2, 8f-3 in parallel (file-disjoint: Electron app + one new rpc-handlers file /
  agent-sdk / codex-runtime); then 8f-4 (rpc-handlers + chat, needs 8f-1 and 8f-2); then 8f-5
  (Electron style, needs 8f-1 and 8f-4).
- Lanes never verify, commit or push; team-leader runs each scoped verify and commits.

### Batch 8f-1: Electron boot, dev binary root, TC-18, shutdown, async verification — COMPLETE (1b46e5de7)

- Items: LIVE D1, CI TC-18, logic B1, S2, S7, M1, M8, minor (profiles cleared before scope close,
  lexical bundled-root check).
- Files: W/apps/ptah-electron/src/activation/bootstrap.ts, `shutdown.ts`;
  W/apps/ptah-electron/src/di/codex-runtime-composition.ts (+ .spec.ts), `codex-binding-registry.ts`;
  CREATE W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-legacy-session-settings.ts
  (+ .spec.ts), MODIFY rpc-handlers index.ts (one export line).
- Verification: `npm run verify -- -p ptah-electron,@ptah-extension/rpc-handlers,@ptah-extension/settings-core`

### Batch 8f-2: agent-sdk adapter errors, split, barrel — COMPLETE (50c2634c7)

- Items: LIVE D2, logic S4 (adapter + sink), M2, style S1 (adapter < 700 lines behind the same
  class), style S4 (barrel).
- Files: W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts (+ new sibling
  file(s)), `codex-chat-approval-sink.ts`, specs, W/libs/backend/agent-sdk/src/index.ts.
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk`

### Batch 8f-3: executable pin without the developer manifest — COMPLETE (020ec6fd8)

- Items: style S5, logic M7 (lazy, no import-time parse).
- Files: W/libs/backend/codex-runtime/src/lib/codex-executable-pin.ts (+ spec, + generated pin
  data file), index.ts only if the export changes.
- Verification: `npm run verify -- -p @ptah-extension/codex-runtime`

### Batch 8f-4: host ports, callbacks, settings record, failed start — COMPLETE (42dc59cea)

- Items: LIVE D3, logic S1, S3, S5, S6, M3, M5; adapter side of S5 (await reconciliation).
- Verification: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk,@ptah-extension/chat`

### Batch 8f-5: Electron composition split and typed IPC port — COMPLETE (e1f8138f6)

- Items: style S2 (rest), S3, logic M6, style minors (registry handle, console.warn, tabId).
- Verification: `npm run verify -- -p ptah-electron,@ptah-extension/settings-core` (+ the lib that
  exports the responder type)

### Batch 8f deferred / out of round

- 8f-5 logic M6: Codex callbacks never receive surfaceMode (ChatSessionService passes it only to
  the broadcaster; needs an rpc-handlers/agent-sdk config change). Later task.
- 8f-5 minor: tabId falls back to the session id (host ports, callbacks and controls require a
  string tabId; needs libs changes). Later task. console.warn in ipc-bridge kept (no Logger in
  the bridge); process-global binding registry kept (BootRefs, background boot, quit paths).
- 8f-2 M2 remainder: metadata saved before a later cancel is not rolled back (no rollback API).
- LIVE D4 (workspace save also writes global `provider.openai-codex.mainAgent.modelTier.*`):
  pre-existing, the known #824 leftover; separate small PR (user).

## Batch 8g: P8 fix round 2 (live-test-p8b.md, code-logic-review-p8f.md, code-style-review-p8f.md) — IN_PROGRESS (8g-1 df531dd52; D5 open; 8g-2 uncommitted)

- Phase: P8 | Phase gate once after 8g-5: degradation-audit lint, di-lint lint, 4-host typecheck
  (ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui), vscode-core host-attention-ingress
  test. Phase review: the coordinator's re-review after the live p8c run (code-logic + style).
- Recommended executor: CLI lane, implementation capability (Codex: the only lane with confirmed
  room). Fallback order: other family same capability -> same family other model -> subagent.
  Subagent reason: N/A. Review family: implementer Codex, reviewer Claude (different family).
- Order: 8g-1 || 8g-2 (file-disjoint: rpc-handlers / Electron + codex-runtime); 8g-3 after 8g-1
  commits (rpc-handlers verify must not see half-written files); 8g-4 after 8g-1 and 8g-3
  (shares the chat-session spec 8g-1 picks, needs the 8g-3 error guard); 8g-5 after 8g-4 (codes).
- Lanes never verify, commit or push; team-leader runs each scoped verify and commits.

### Plan validation (8g)

Status: PASSED WITH RISKS

- S-N0 (hidden-tab terminal slot overwrite) is PRE-EXISTING on main:
  `chat-stream-delivery-coordinator.service.ts` has no diff vs main (`git diff main...HEAD` empty;
  last change 9ff6fb2e5 on main). Per the coordinator rule it goes to a separate small PR and is
  NOT fixed here. Recorded under "Batch 8g deferred".
- D5 per-key decision (evidence: runtime rejects any `mcpServers` entry,
  `codex-runtime.ts:88-97`, "secret resolution ... not present at this boundary"; parity row
  `parity-inventory.md:39` says MCP/output-style inputs apply natively "or the turn fails
  visibly"; partials are Claude only, `parity-inventory.md:44`):

  | Key | Decision | Reason |
  | --- | --- | --- |
  | `mcpServerRunning` | strip, coded info log when true | host availability flag, always sent; native MCP attachment unsupported at the runtime boundary; production stays behind the parity gate |
  | `workflowsDisabled` | strip | Claude SDK workflow toggle (`sdk-query-options-builder.ts:1377`), always sent; no native workflows on Codex chat |
  | `includePartialMessages` | strip | Claude SDK only; App Server streams deltas natively |
  | `mcpServersOverride` (non-empty) | reject, error names the key | user HTTP/OAuth/Smithery servers cannot be attached natively yet; fail visibly per parity row 39 |
  | `thinking` | reject, names the key | Claude thinking config; Codex uses `effort` (supported) |
  | `outputStyleName` | reject, names the key | flag-tier Claude output style; `outputStyleBody` is supported |
  | `mcpToolProfile` | reject when defined and not `coding`, names the key | non-coding tool profiles need Ptah MCP (surfaces / child sessions) |
  | `ptahUiFence` | MAP (revised 17:58Z, coordinator: a key the default Electron send always sets must not be rejected) | `message-sender.service.ts:476` sends `ptahUiFence: true` on every Electron send. Native carrier: profile `developerPrompt` (`codex-execution-profile.ts:28`) carries `PTAH_UI_HINT` when true and the tool profile is `coding`, same gate as `sdk-query-options-builder.ts:1821-1824`. 8g-1 adds `PTAH_UI_HINT` to the agent-sdk barrel (one line). |

  Rule for every key: the default Electron send must pass; the 8g-1 real-config spec uses the
  options message-sender builds by default.

  Reversible: each row flips to "map" when native MCP lands (later task, parity row 39 stays open
  for the P14 ledger).

Assumptions:

- The Electron renderer does not send `thinking` / `outputStyleName` for a default Codex send —
  unverified; Task 8g-1.1 checks the real config and the 8g-1 real-config spec proves the default.
- `buildMcpServersOverride` returns `undefined` when there are no overrides
  (`chat-session.service.ts:474-478`) — verified by read; spec asserts it.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A user with Smithery/OAuth servers cannot open native Codex chat | MEDIUM | visible error naming `mcpServersOverride`; dev route only (parity gate) |
| Resume path (`chat-session.service.ts:~1682`) builds the same keys | HIGH | 8g-1 real-config spec covers start AND resume configs |
| Verify of 8g-1 picks up 8g-3 edits | MEDIUM | 8g-3 starts only after the 8g-1 commit |
| Shared `rpc-error-codes.types.ts` change hits every host | MEDIUM | phase gate 4-host typecheck |

### Batch 8g-1: D5 profile option policy, approval settle, undelivered prompt — IN_PROGRESS (df531dd52 committed; D5 ptahUiFence mapping still open -> 8g-1b)

- Items: LIVE D5 (blocker), logic M-N4 / S3 remainder, M3 remainder (resolved-but-undelivered
  send), M-N7 (re-present pending approvals on renderer reload — only if a native/existing
  webview-ready hook makes it small; else return a defer reason).
- Files (prefix R = W/libs/backend/rpc-handlers/src/lib/chat/): R/codex-host/codex-chat-host-ports.ts
  (+ .spec.ts); CREATE R/codex-host/codex-chat-profile-options.ts (+ .spec.ts);
  R/session/chat-session.native.spec.ts (real-config test only; chat-session.service.spec.ts does
  not exist) or, if its mocks cannot drive launchSdkSession, CREATE
  R/session/chat-session.codex-profile-config.spec.ts (authorized 17:52Z).
- Task 8g-1.1: pure `classifyCodexChatOptions(config)` -> `{ supported, stripped, rejected }`
  per the D5 table; `profile()` strips host keys, throws coded `CodexChatOptionError`
  (code `unsupported-option`, `key`, message names the key) on the first rejected key.
- Task 8g-1.2: spec (native.spec or the new codex-profile-config spec) that captures the config the REAL
  `launchSdkSession` passes to `sdkAdapter.startChatSession` (chat:start and resume, default
  settings, `mcpServerRunning: true`, `workflowsDisabled: false`) and asserts the classifier
  rejects nothing.
- Task 8g-1.3: `handlePermissionResponse` — when `respond` returns false or throws, settle the
  entry (release host attention), send PERMISSION_AUTO_RESOLVED, return true (the id is Codex's;
  must not fall through to the Claude handler). Coded warn kept.
- Task 8g-1.4: M3 remainder / M-N7 per the item line.
- Task 8g-1.5 (added 17:58Z): map `ptahUiFence` to the native developerPrompt (PTAH_UI_HINT);
  one-line `PTAH_UI_HINT` export in W/libs/backend/agent-sdk/src/index.ts.
- Verification: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`

### Batch 8g-2: Electron binary inspection, shutdown budget, style — IN_PROGRESS (written, verify FAILED shutdown.spec.ts, uncommitted)

- Items: logic M-N1 (do not cache failed/timed-out inspections), M-N2 (digest compared with the
  pin BEFORE `--version` runs), M-N3 (budget expiry must not leave threads `active`), style M2
  (type cycle codex-session-binding.ts <-> codex-runtime-composition.ts; exported interfaces over
  `ReturnType` aliases), style M5 (internal helpers not exported / clearly marked), style M4
  (single-platform note on the pin data).
- Files: W/apps/ptah-electron/src/di/codex-runtime-composition.ts (+ .spec.ts),
  W/apps/ptah-electron/src/di/codex-session-binding.ts (a new small types file allowed),
  W/apps/ptah-electron/src/activation/shutdown.ts (+ its spec),
  W/libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts (comment only).
- Verification: `npm run verify -- -p ptah-electron,@ptah-extension/codex-runtime,@ptah-extension/settings-core`

### Batch 8g-3: compaction single signal, barrel, typed adapter error guard — PENDING

- Depends on: 8g-1 committed.
- Items: logic M-N6 (one compaction start signal, trigger/preTokens from native App Server data,
  no hard-coded `auto`/0 when the native event says otherwise), style M1 (CodexChatAdapter and
  registerCodexChatServices marked `@internal` for tests, or removed if the Electron spec can use
  the container token without new Electron edits), export a typed guard
  `isCodexChatAdapterError(error): error is CodexChatAdapterError` + its code type for M-N5.
- Files: W/libs/backend/agent-sdk/src/index.ts, agent-sdk codex-app-server/codex-chat-turn-stream.ts
  (+ spec), codex-chat-adapter.ts (guard only), R/codex-host/codex-chat-event-callbacks.ts (+ spec).
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`

### Batch 8g-4: typed Codex RPC codes, cancelled is not an error, legacy settings style — PENDING

- Depends on: 8g-1, 8g-3.
- Items: logic M-N5 / M4 / D3 backend: replace the `error.name` match with the guard; dedicated
  codes in `rpc-error-codes.types.ts` (busy, cancelled, unsupported-option with the key in the
  message, unavailable/runtime-failed); `cancelled` maps to a non-error result; cover chat:start
  AND resume/continue (`chat-session.service.ts:~710, ~803`). Style M3: Zod enum for effort in
  codex-legacy-session-settings.ts, typed error code like `CodexSessionSettingsError`.
- Files: R/session/chat-session.service.ts (+ the session spec 8g-1 used, or a new focused spec),
  W/libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts,
  R/codex-host/codex-legacy-session-settings.ts (+ .spec.ts).
- Verification: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/shared`

### Batch 8g-5: frontend cancelled start and Orchestrator chip state — PENDING

- Depends on: 8g-4.
- Items: D3 remainder: a `cancelled` start shows no "could not start" error; the Orchestrator
  agent chip shows the error state (not done/green) after a failed start; new codes handled in
  message-sender.service.ts.
- Files: W/libs/frontend/chat/src/lib/services/message-sender.service.ts (+ spec), the chip's
  state source (agent card / agent monitor; lane locates it) (+ spec). At most 6 files.
- Verification: `npm run verify -- -p @ptah-extension/chat`

### Batch 8g deferred / out of round

- S-N0 hidden-tab terminal slot: pre-existing on main (coordinator file unchanged on this
  branch); separate small PR against main.
- M-N7 + M3 remainder (pending Codex approvals lost on renderer reload; a resolved but
  undelivered PERMISSION_REQUEST): DEFERRED (approval-UX gap, not a blocker for live a-f).
  Evidence: Codex host deps expose only `broadcastMessage(): Promise<void>`; the Electron adapter
  `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:103-111` drops the `sendToRenderer`
  boolean, so there is no delivery receipt; renderer readiness (`bootstrap.ts:212-264`) is private
  host wiring for `attention:getSnapshot`, not a subscription injected into the ports; the Claude
  replay `chat:pending-questions` (`chat-rpc.handlers.ts:317-330` -> `sdk-permission-handler.ts:1216`)
  covers AskUserQuestion only. Needs delivery receipts + a renderer-ready subscription with
  listener cleanup (Electron + rpc-handlers). Later task.
- Still accepted from 8f: M2 rollback, M6 surfaceMode, tabId fallback, ipc-bridge console.warn,
  process-global binding registry, LIVE D4 (separate PR).

---

# Phase P9 — Gateway consumer (@ptah-extension/gateway-chat-bridge)

Phase review: code-logic. Implementer: Codex; reviewer: Claude. Verification:
`npm run verify -- -p @ptah-extension/gateway-chat-bridge`.
Prefix G = W/libs/backend/gateway-chat-bridge/src/lib/.

## Batch 9a: Gateway adapter and approval sink — COMPLETE (merged in #809)

## Batch 9b: Gateway profile and bridge integration — PENDING (needs 6p)

- Files: CREATE G+codex-gateway-profile.ts and spec, G+gateway-chat-bridge.native.spec.ts; MODIFY
  G+gateway-chat-bridge.ts (native branch only; re-locate anchors), G+di/register.ts,
  W/libs/backend/gateway-chat-bridge/src/index.ts
- Details: no legacy new-session fallback on ambiguous native resume; Claude gateway unchanged;
  native branch gated off (the DS1 dev override does NOT cover gateway). Note:
  `codex-gateway-adapter.ts:23,52` constructs `new CodexParityGate()` directly instead of the
  gated resolver — record for the P9 review (one gate per host); fix only if it fits the cap.
  Last P9 batch -> phase review.
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

---

# Phase P10 — Lane consumer (@ptah-extension/cli-agent-runtime)

Phase review: code-logic. Implementer: Codex; reviewer: Claude. Verification:
`npm run verify -- -p @ptah-extension/cli-agent-runtime` (known noise: 5-6 pre-existing lint
errors). Prefix L = W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/.

## Batch 10a: Lane profile and events — COMPLETE (merged in #809)

## Batch 10b: App Server lane adapter — PENDING (needs 10a)

- Files: CREATE L+codex-app-server-lane.adapter.ts and spec;
  CREATE W/libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts
- Details: implements CliAdapter.runSdk/SdkHandle over CodexContext; steer:false, interrupt:false
  capability preserved; abort disposes context; no Codex SDK import; never retries via SDK.
  Native subagents stay DISABLED for lanes (keeps `codex-lane-config.builder.ts:104` behavior) —
  decision recorded at this lane migration (session 7 decisions below).
- Executor/review as 9b.

## Batch 10c: Detection factory and interface — PENDING (needs 10b)

- Files: MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts
  (factory instead of direct construction), `cli-adapters/cli-adapter.interface.ts` (optional
  Codex context/policy), W/libs/backend/cli-agent-runtime/src/index.ts
- Details: legacy adapter remains default; native lane selection gated off.
- Executor/review as 9b.

## Batch 10d: Lane parity proof on the App Server — PENDING (needs 10c; stop and return before any live or paid run)

- Session 14 (user decision D5): lanes run on the App Server adapter and pass a lane parity proof
  (refresh the lane preserve list against the base commit; every capability present with a
  passing test or approved removal) before Removal B.

## Batch 10e..: Removal B (@openai/codex-sdk for CLI lanes) — PENDING (needs 10d proof; was P16)

- Moved from P16 to the END of P10 (user decision D5). Structure as P15: read-only parity
  refresh, file-disjoint removal batches, one commit with the proof reference. Last P10 batch ->
  phase review (code-logic + style on the removal commit).

---

# Phase S — Spike turns (paid; approved 8 turns, <=30000 tokens/turn, <=100000/run) — MOVED to follow-up PR (D7)

Every paid run is a stop point: the team-leader returns to the coordinator before it starts.

## Batch S0: Gap spike cases in the evidence harness — PENDING (after P10)

- Executor: CLI lane, Codex family | Review: folded into the P11 phase review
- Files: MODIFY W/libs/backend/codex-runtime/tools/evidence-cases.json,
  `evidence-cases-round.ts` and spec, `evidence-round-plan.ts` and spec
- Details: round 8 cases — revert (2-3 turns: two turns, then `thread/revert {threadId,
  beforeTurnId}` before the second, then `thread/read` to confirm; save the frames as a 12b
  fixture); file edit via apply_patch vs shell edit (1 turn: approval kind and item type of
  each); native subagent (1 turn spawning one child; save `collabAgentToolCall`,
  `subAgentActivity`, `parentThreadId`, `agentRole` frames as an 11a fixture). Estimates use the
  corrected ~24k/31k/38k per command turn (1n note).
- Verification: `npm run verify -- -t test -p @ptah-extension/codex-runtime`

## Batch S1: Gap spike run — PENDING (paid; stop and return before running)

- Codex lane runs the harness under the verify lock; output `spike-run-8.json` / `.md`.
- Budget: 4-5 of the 8 turns. Afterwards report the remaining count.

## Batch S2: Remaining spikes — PENDING (paid; after P13; stop and return before running)

- Always Allow different-command (must fit 30k/turn — 7c was ~92k, so redesign the case) and
  remote MCP, within the turns left after S1.

---

# Phase P11 — Native subagents — MOVED to follow-up PR (D7)

Phase review: code-logic. Implementer Codex, reviewer Claude. Native features only; the
Ptah-owned spawn tool is dropped.

## Batch 11a: Translator maps native subagent items — PENDING

- Files: MODIFY W/libs/backend/codex-runtime/src/lib/codex-event-translator.ts (start point :324:
  `collabAgentToolCall` is a generic tool row today) and `codex-event-translator.spec.ts`,
  `codex-runtime.types.ts`; CREATE `__fixtures__/subagent-frames.json` (from S1)
- Details: new CodexRuntimeEvent variants `subagentStarted {parentThreadId, childThreadId,
  toolId, agentRole?, prompt?}` / `subagentCompleted {childThreadId, status, summary?}` from
  `collabAgentToolCall` + `subAgentActivity`; every event carries its source threadId so child
  frames are distinguishable from the parent's (R7-5).
- Verification: `npm run verify -- -p @ptah-extension/codex-runtime`

## Batch 11b: Chat projection — agent cards and child approvals — PENDING (needs 11a)

- Files: MODIFY D+codex-chat-events.ts and spec, D+session-approval-router.ts and spec; CREATE
  D+codex-subagent-tracker.ts and spec
- Details: subagentStarted -> `agent_start`, completion -> `agent_completed`
  (`libs/shared/src/lib/types/execution/stream.ts:42-53`); child-thread events go under the agent
  card, never into the main transcript; child-thread approvals route to the parent session's
  sink with the agent label; unroutable -> decline (R7-6). The tracker supplies the child list
  for metadata (6d).
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk`

## Batch 11c: Personas — Ptah agent files to Codex named roles, or a gap report — PENDING

- Step 1 (read-only, Codex lane): check the pinned schema (`agentRole` ~:20378) and Codex
  source/docs for a configurable named-role mechanism; the answer goes into the lane report and
  the team-leader records it in decisions.md.
- Step 2 only if supported: map Ptah agent files to the role configuration in the execution
  profile (codex-execution-profile.ts + spec; max 4 files, codex-runtime only). If NOT supported:
  no code; the gap goes to the coordinator (no workaround — user decision).
- Last P11 batch -> phase review.

---

# Phase P12 — Native sessions: history, resume, rollback — MOVED to follow-up PR (D7)

Phase review: code-logic. Source of truth: the Codex rollout JSONL in each CODEX_HOME
`sessions/`. Ptah keeps only metadata keyed by thread id (6d). No Ptah JSONL copy.

## Batch 12a: Protocol methods thread/read and thread/revert — PENDING

- Files: MODIFY W/libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts,
  `codex-protocol-schemas.ts`, `codex-protocol-validator.spec.ts`
- Details: validate `thread/read` and `thread/revert {threadId, beforeTurnId}` from the pinned
  schema (~:886, ~:718). Do NOT add `thread/rollback` (refuses paginated threads, removed by
  0.163; 7e -32600).
- Verification: `npm run verify -- -p @ptah-extension/codex-runtime`

## Batch 12b: History reader and revert on the runtime — PENDING (needs 12a)

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-session-history.ts and spec; MODIFY
  `codex-runtime.ts`, `codex-runtime.types.ts`, `codex-runtime.spec.ts`
- Details: `readHistory(threadId)` = `thread/read` -> CodexEventTranslator replay -> ordered
  events including child threads (rebuilds agent cards on resume); `revert(threadId,
  beforeTurnId)` on CodexContext; resume stays `thread/resume`. Spec replays the S1 fixture
  (AS7-2).
- Verification: `npm run verify -- -p @ptah-extension/codex-runtime`

## Batch 12c: History and rewind routers — PENDING (needs 12b, 6e)

- Files: CREATE D+session-history-router.ts, D+session-rewind-router.ts, each with same-stem spec
- Details: Codex sessions read native history; Claude sessions keep the existing reader; history
  rollback calls `revert`; file rewind delegates to the P13 checkpoint (interface here, wired in
  13b).
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk`

## Batch 12d: RPC history delegation — PENDING (needs 12c)

- Files: MODIFY R+chat/session/chat-history-read.service.ts, R+handlers/session-rpc.handlers.ts;
  CREATE R+handlers/session-native-history.spec.ts
- Verification: `npm run verify -- -p @ptah-extension/rpc-handlers`. Last P12 batch -> phase
  review.

---

# Phase P13 — File-rewind checkpoint (built; not native) — MOVED to follow-up PR (D7)

Phase review: code-logic.

## Batch 13a: Turn-start git shadow-tree checkpoint — PENDING

- Files: CREATE D+turn-file-checkpoint.ts and spec
- Details: at turn start, snapshot the workspace with a temporary `GIT_INDEX_FILE` (`git add -A`
  into the temp index, `write-tree`, `commit-tree`) under a private ref
  `refs/ptah/checkpoints/<threadId>/<turnId>`; rewind restores the files changed since that tree
  and returns the existing `SessionRewindResult`
  (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:598`: canRewind, error, filesChanged,
  insertions, deletions). Non-git workspace or git failure -> `canRewind: false` + error. Never
  touches the user's index, HEAD, branches or stash (R7-8; spec in a temp repo asserts `git
  status --porcelain`, HEAD and index unchanged). Ref pruning bounded per thread.
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk`

## Batch 13b: Wire the checkpoint into turn start and the rewind router — PENDING (needs 13a)

- Files: MODIFY D+codex-chat-adapter.ts and spec, D+session-rewind-router.ts and spec
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk`. Last P13 batch -> phase review.

---

# Phase P14 — Parity ledger and live Electron parity — PENDING (D7: needs P10 incl. Removal B; P11-P13/S moved out)

## Batch 14a: Reviewed parity-gate ledger update — PENDING

- Files: MODIFY W/libs/backend/codex-runtime/src/lib/codex-parity-gate.ts and
  `codex-parity-gate.spec.ts`
- Details: update CODEX_PARITY_EVIDENCE from reviewed runs 7a2-7f (exact-command session grant,
  same-home isolation, resume, profile-inputs) and S1/S2 (revert, file vs shell edit, subagents,
  different-command Always Allow, remote MCP); each row cites its spike file; unproved rows stay
  unproved. The gate stays `enabled: false` (production enablement is a separate user decision).
- Phase review: code-logic (ledger accuracy against the spike JSON).

## Batch 14b: Live Electron parity run on the new path — PENDING (stop and return before running)

- Executor: visual-reviewer / Claude subagent (needs a running Electron build and screenshots).
  HANDOFF.md Electron live-test procedure with `PTAH_CODEX_RUNTIME_DEV=1`; reruns the session-7
  scenarios plus subagents, history, resume, revert, rewind and approvals; dark + light. Paid
  model turns -> coordinator approval first.
- Output: parity proof recorded per row in parity-inventory.md.

---

# Phase P15 — Removal A (Claude Agent SDK + Codex translation proxy for main chat) — PENDING (needs P14 proof)

- 15a (read-only, Claude subagent): refresh parity-inventory.md against the OLD surface at the
  base commit; list every file of the proxy path; a capability without proof blocks.
- 15b..: file-disjoint removal batches (<=6 files each, Codex lanes), verified per batch and
  committed ONCE for the whole removal with the proof reference (user decision). Claude provider
  behavior unchanged; host typecheck for all four hosts; re-check the fix-PR fence.
- Phase review: code-logic + style on the removal commit.

# Phase P16 — MOVED (session 14, user decision D5): Removal B is now Batch 10e.. at the end of P10

- Removal A stays P15.

---

## Out of scope for this batch plan

- Enabling any consumer for production (packaged builds): needs every required observation or
  user-approved reductions, then a separate user rollout decision.
- Runtime selector UI, TUI and VS Code feature work.

## Session 7 decisions (team-leader)

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Dev switch = env `PTAH_CODEX_RUNTIME_DEV=1`, honored only when `app.isPackaged === false`, chat consumer only, read by the host and passed in as a port | Settings key; env var; build flag | Pattern `apps/ptah-electron/src/main.ts:122` (PTAH_E2E); the gate is documented as "no environment probes" (`codex-parity-gate.ts`), so the env read stays in the host; a settings key would need editing ~/.ptah/settings.json | Yes |
| Dev switch is its own phase (P5b) with a code-logic review | Fold into P6 | It bypasses the production gate; smallest reviewable diff | Yes |
| Shared workspace key helper lives in codex-runtime `codex-home-path.ts` | libs/shared; auth-providers | auth-providers and agent-sdk both depend on codex-runtime; libs/shared also feeds the frontend (no node `path`) | Yes |
| Lanes keep native subagents disabled at the 10b migration | Enable for lanes | `codex-lane-config.builder.ts:104`; lane parity is about restrictions | Yes, user input to enable |
| S0/S1 gap spikes run before P11/P12, not at the end | All spikes last | Subagent mapping and revert depend on observed frames (AS7-2, AS7-3) | Yes |
| A removal phase may exceed the 6-file cap by staging several verified batches into one commit | One commit per batch | User decision: each removal is its own commit with its proof | Yes |
| Old P11 (evidence-blocked history/file history/subagent controls) is replaced by P11-P13 | Keep blocked | User principle "native first" + research-codex-gaps.md | Yes |
