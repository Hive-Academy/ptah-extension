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

# Run state (session 17, 2026-10-27) — P8 fix round 2 (8g) code complete, gate green

- Fresh team-leader (Mode 2). All lanes Codex CLI (implementer family Codex); none verified,
  committed or pushed. Team-leader ran every verify under the lock and committed in the
  foreground. Branch not pushed (coordinator pushes).
- 8g-1b — COMMITTED 1194ed505. D5 closed: `ptahUiFence` supported; when true and the tool
  profile is `coding`, PTAH_UI_HINT is appended to the native Codex developerPrompt.
  `mcpToolProfile: 'coding'` supported, any other value -> coded CodexChatOptionError (team-leader
  review caught an unconditional accept). Real-config spec uses the renderer-shaped payload on a
  temp dir (first run failed ENOENT on a fake path; fixed). Verify `-p rpc-handlers,agent-sdk`:
  tests + typecheck pass; agent-sdk lint known noise only.
- 8g-2 — COMMITTED 3362b2ad5. shutdown.spec load failure fixed with a spec-local
  `jest.mock('@ptah-extension/rpc-handlers')` (the binding imports runtime values, so a
  type-only import was impossible); real binding shutdown helpers still tested. Verify
  `-p ptah-electron,codex-runtime,settings-core`: PASS (exit 0).
- 8g-3 — COMMITTED 2f9a98bd9. One compaction start from the adapter with native preTokens
  (skipped + debug log without a sample; reported 0 kept); no libs/shared change; failed
  manual/auto compaction -> CHAT_ERROR, never compaction_complete; /compact coalescing.
  Barrel: @internal marks, isCodexChatAdapterError + CodexChatAdapterErrorCode. Two lanes wrote
  concurrently (queued coordinator messages); final diff checked. Verify
  `-p agent-sdk,rpc-handlers` tests + typecheck pass (lint known noise); ptah-electron typecheck
  PASS.
- 8g-4 — COMMITTED 82901d5c4. CODEX_BUSY / CODEX_UNSUPPORTED_OPTION / CODEX_UNAVAILABLE /
  CODEX_RUNTIME_FAILED; cancelled -> `{ success:false, cancelled:true }` (no log/Sentry, adapter
  no longer logs cancelled); failed /compact -> `settled + CODEX_RUNTIME_FAILED`; legacy settings
  derive effort from EFFORT_LEVEL_SCHEMA + LegacyCodexSessionSettingsError. Shared changes are
  additive/optional. First verify: 1 stale spec (chat-session-agent-child.spec.ts) + 1 new
  module-boundary lint error (deep import in native.spec); fixed with a local error fixture and a
  partial guard mock (real guard covered in codex-chat-adapter.spec.ts). Re-verify
  `-p shared,rpc-handlers,agent-sdk,chat`: all tests + typecheck pass; lint known noise only.
- 8g-5 — COMMITTED aa8dd6c60. Cancelled start/continue/resume settle quietly; settled compact
  failure keeps CHAT_ERROR as the only error (message-dispatch.service.ts authorized as 7th
  file); CODEX_* messages; Orchestrator chip failed after failed start, absent after cancel.
  Verify `-p chat`: tests + typecheck pass; lint known noise (242/140, unchanged).
  Minor (recorded, not fixed): on cancel both message-sender and message-dispatch call
  markLoaded/markTabIdle (idempotent).
- **P8 phase gate (2026-10-27 ~16:52Z, HEAD aa8dd6c60): ALL PASS.** degradation-audit:lint
  exit 0; di-lint:lint exit 0; typecheck ptah-electron, ptah-extension-vscode, ptah-cli,
  ptah-tui 4/4 succeeded; vscode-core test `--testPathPatterns=host-attention-ingress` 1/1
  succeeded.
- Process: lanes called ptah_get_diagnostics twice (8g-4, 8g-5) despite the rule; both returned
  UNAVAILABLE; no stray TS process remained.
- Next (coordinator): push, live Electron p8c run (STOP before it — not run here), then the
  P8 re-review (code-logic + style, reviewer family Claude).

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

## Batch 8g: P8 fix round 2 (live-test-p8b.md, code-logic-review-p8f.md, code-style-review-p8f.md) — COMPLETE (code; 8g-1 df531dd52 + 8g-1b 1194ed505; 8g-2 3362b2ad5; 8g-3 2f9a98bd9; 8g-4 82901d5c4; 8g-5 aa8dd6c60; phase gate PASS; re-review after live p8c)

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

### Batch 8g-1: D5 profile option policy, approval settle, undelivered prompt — COMPLETE (df531dd52; 8g-1b 1194ed505 closes D5; reports batch-8g-1-report.md, batch-8g-1b-report.md)

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

### Batch 8g-2: Electron binary inspection, shutdown budget, style — COMPLETE (3362b2ad5; reports batch-8g-2-report.md, batch-8g-2b-report.md)

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

### Batch 8g-3: compaction single signal, barrel, typed adapter error guard — COMPLETE (2f9a98bd9; report batch-8g-3-report.md)

- Depends on: 8g-1 committed.
- Items: logic M-N6 (one compaction start signal, trigger/preTokens from native App Server data,
  no hard-coded `auto`/0 when the native event says otherwise), style M1 (CodexChatAdapter and
  registerCodexChatServices marked `@internal` for tests, or removed if the Electron spec can use
  the container token without new Electron edits), export a typed guard
  `isCodexChatAdapterError(error): error is CodexChatAdapterError` + its code type for M-N5.
- Files: W/libs/backend/agent-sdk/src/index.ts, agent-sdk codex-app-server/codex-chat-turn-stream.ts
  (+ spec), codex-chat-adapter.ts (guard only), R/codex-host/codex-chat-event-callbacks.ts (+ spec).
- Verification: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`

### Batch 8g-4: typed Codex RPC codes, cancelled is not an error, legacy settings style — COMPLETE (82901d5c4; report batch-8g-4-report.md)

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

### Batch 8g-5: frontend cancelled start and Orchestrator chip state — COMPLETE (aa8dd6c60; report batch-8g-5-report.md)

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
- Known limitation (8g-1b): MCP Apps page + Codex runtime. The only `mcpToolProfile` sender is
  `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:250,332` (`'apps'`). On
  the Codex runtime that start now fails with `CodexChatOptionError` (key `mcpToolProfile`)
  instead of being silently ignored; the apps profile needs native Ptah MCP attachment (parity
  row 39). Main chat never sends `mcpToolProfile`, so the default Electron Codex start passes.

## Batch 8h: P8 fix round 3 (live-test-p8c.md D6, M1, M2) — COMPLETE (code; 8h-2 c02d25f2f; 8h-1,3,4 18ef3fef8; P8 re-review pending)

- Phase: P8 | Phase gate once after 8h: degradation-audit lint, di-lint lint, 4-host typecheck,
  vscode-core host-attention-ingress test. Phase review: the coordinator's P8 re-review.
- Recommended executor: CLI lane, implementation capability (Codex: only lane with confirmed
  room). Fallback: other family same capability -> same family other model -> subagent.
  Subagent reason: N/A. Review family: implementer Codex, reviewer Claude.
- Execution mode: parallel (8h-1 and 8h-2 are file-disjoint, same project; one verify after both).
- Coordinator decision (final): ambient host-assembled keys are STRIPPED with one info log each
  (names only, never URLs/headers/tokens/values); explicit caller requests stay REJECTED.

### Ambient-key audit (team-leader, read of chat-session.service.ts + chat-slash-command-router.service.ts)

| Key | Set by (ambient source) | Paths | Decision |
| --- | --- | --- | --- |
| tabId, workspaceId, projectPath, name, prompt, model, runtime | builder | start/child/handoff/resume | supported |
| systemPrompt, effort, files, images | renderer options / params | start, resume | supported |
| enhancedPromptsContent | `resolveEnhancedPromptsContent` | all | supported |
| permissionLevel | child/handoff `childPermissionLevel` | child, handoff | supported |
| outputStyleBody | `outputStyleActivation.resolveSessionFields` | start, resume | supported |
| ptahUiFence | renderer (always true on Electron) | start, resume, slash | supported (8g-1b map) |
| mcpToolProfile `'coding'` | params | start, resume, slash | supported |
| mcpServerRunning | `isMcpServerRunning` / `.mcp.json` check | all | strip + `ptah-mcp-not-attached` (existing) |
| workflowsDisabled | `resolveWorkflowsDisabled()` | start, resume | strip (existing) |
| includePartialMessages | renderer options | start | strip (existing) |
| mcpServersOverride `{}` | `buildMcpServersOverride` | start, child, handoff | strip (existing) |
| mcpServersOverride with entries | `buildMcpServersOverride` merges Smithery + OAuth (ambient) + caller `params.mcpServersOverride` (no current producer) | start, child, handoff | **strip** (8h), info `codex-user-mcp-not-attached` with server names only |
| thinking | `options.thinking` / `params.thinking` (no current renderer producer) | start, resume | **strip** (8h), info log: Codex reasoning uses native `effort` |
| outputStyleName | `resolveSessionFields` (flag tier) | start, resume | **strip** (8h), info log: output style not applied on Codex |
| mcpToolProfile other than `'coding'` | explicit caller (MCP Apps page `'apps'`) | start | reject (CodexChatOptionError) |
| any other key | none today | - | reject (CodexChatOptionError) |

- Not keys but checked: `providerProfile` only on the claude-sdk branch; slash router config goes to
  `prepare()` only (no classifier); Codex `executeSlashCommand` supports `/compact` only;
  `sendMessageToSession` options are files/images only.
- RISK (recorded, not in this round): Codex adapter `resumeSession` on an id still in its
  `sessions` map rejects any key except prompt/tabId (`codex-chat-adapter.ts:209-217`,
  `activeResumeConfig`). chat-session resumes when `hasLiveSessionStream` is false, which includes
  a live record whose broadcaster loop has exited (`chat-session.service.ts:1587-1595`). That
  edge would fail with CODEX_RUNTIME_FAILED. Recorded for the P8 re-review / live p8d watch.

### Batch 8h-1: D6 ambient-key strips + real-config spec — COMPLETE (18ef3fef8; reports batch-8h-1-report.md)

- HOLD (coordinator, ~17:45Z): the strip of non-empty `mcpServersOverride` and of
  `outputStyleName` is ON HOLD pending a user decision (conflicts with parity-inventory.md:39,
  "apply natively or the turn fails visibly"). Lane 8h-1 was already spawned with the strip; it
  finishes, but that part is not committed until the coordinator sends the final rule for those
  two keys. `thinking` strip, M1, audit and the real-config spec scaffolding proceed.
- FINAL RULE (user decision, 2026-10-27, relayed by the coordinator): non-empty
  `mcpServersOverride` and `outputStyleName` are stripped AND the chat shows ONE visible,
  non-error notice per session start/resume ("Codex chat: MCP servers not attached: a, b";
  "Codex chat: output style 'X' is not applied"), names only, never repeated per turn. This
  revises parity-inventory.md row 39: the FEATURE fails visibly, not the turn. Carrier: the
  existing model-substitution notice (`ChatRuntimeProfileService.publishModelSubstitution`, an
  ordinary assistant message over CHAT_CHUNK, once per prepared execution); no shared contract
  change, no CHAT_ERROR, session not failed.
- Lane 8h-1 strips + logs ACCEPTED; notice added in 8h-3 (same lane, resumed).

### Batch 8h-3: visible notice for not-applied Codex inputs — COMPLETE (18ef3fef8; report batch-8h-3-report.md)

- Files: R/session/chat-runtime-profile.service.ts (+ .spec.ts), R/session/chat-session.service.ts
  (call sites only), R/session/chat-slash-command-router.service.ts (call site only, if renamed),
  R/session/chat-session.native.spec.ts.
- Generalize the once-per-execution model notice into one runtime-notice publisher (replace, no
  second method): model substitution + MCP servers not attached + output style not applied.

### Batch 8h-4: active-record resume applies the option classification — COMPLETE (18ef3fef8; reports batch-8h-4-report.md, -4b, -4c)

- RISK above promoted (coordinator). Files: W/libs/backend/agent-sdk/src/lib/codex-app-server/
  codex-chat-adapter.ts (+ .spec.ts), R/codex-host/codex-chat-host-ports.ts (+ .spec.ts) for a
  narrow host classification port. Open-session resume: ambient keys stripped, unreviewed keys
  rejected (CodexChatOptionError), turn proceeds; no notice (not repeated per turn).

- Files (R = W/libs/backend/rpc-handlers/src/lib/chat/): R/codex-host/codex-chat-profile-options.ts
  (+ .spec.ts), R/codex-host/codex-chat-host-ports.ts (+ .spec.ts), R/session/chat-session.native.spec.ts.
- Classifier strips non-empty `mcpServersOverride`, `thinking`, `outputStyleName`; exposes MCP
  server names (map keys) for the log; `profile()` emits one info log per stripped ambient key.
- Real-config spec: Smithery and OAuth resolvers return ONE server each; thinking + outputStyleName
  set as the real services would; assert zero rejected, strips logged without URLs/headers/tokens,
  native start proceeds; keep the renderer-shaped payload test.

### Batch 8h-2: M1 real chat:start outcome log — COMPLETE (c02d25f2f; reports batch-8h-2-report.md, -2b, -2c)

- Files: W/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts (+ .spec.ts).
- `runRpc` logs failure (with errorCode, never the error text payload beyond the code) when the
  resolved result is `{ success: false }`, `cancelled` when cancelled, success otherwise.

### M2: DEFERRED

- The "api error" label is the shared terminal reason `'api_error'` set by
  `message-sender.service.ts:554` for CODEX_* failures and rendered by chat-ui
  (`compact-session-summary.ts:461`); the roster (`session-agent-roster.service.ts:91`) only reads
  it. A non-API label needs a new terminal reason across shared + chat + chat-ui, more than the
  roster service + its spec. Later task.

### Batch 8h verification

- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk,ptah-electron`
  (ptah-electron added: new `checkOptions` adapter port). Run 1: 2 spec type errors (8h-2b, 8h-4c
  fixed); run 2: 3 exact-call spec failures (registration debug log, 8h-2c fixed); run 3: all
  tests + typecheck pass (rpc-handlers 186 suites / 4814 tests); only agent-sdk lint known noise
  (`session-query-executor.accounts.spec.ts:174,183`).
- Commits: 8h-2 c02d25f2f; 8h-1,3,4 18ef3fef8 (one commit: the new port and its host
  implementation must compile together).
- P8 phase gate (2026-10-27 ~18:37Z, HEAD 18ef3fef8): degradation-audit:lint exit 0; di-lint:lint
  exit 0; typecheck ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui 4/4 succeeded;
  vscode-core test `--testPathPatterns=host-attention-ingress` 1/1 succeeded. ALL PASS.
- Minor (recorded, not fixed): the publish catch still warns "Model substitution notice failed"
  (now covers all runtime notices); in codex-chat-adapter.ts the class doc comment sits above the
  new `TrackedSession` alias. For the P8 re-review.

### Batch 8h deferred

- P14 parity gap: native mapping of user MCP servers (Smithery/OAuth HTTP) into the Codex App
  Server `mcp_servers` config (parity row 39 stays open).
- P14 parity gap: output style by name (`outputStyleName`, flag tier) on Codex.
- P14 parity gap: native apply of a CHANGED model / effort / permissionLevel on an active Codex
  resume (8h-4b logs `codex-active-resume-options-not-applied` with key names only).
- M2 label (above). Active-record resume RISK: fixed in 8h-4/8h-4b.

## Batch 8i: P8 fix round 4 (live-test-p8d.md D7: diagnosable open failure + start probe) — COMPLETE (code; 8i-1 c2a06f834; 8i-2 092095c4b; phase gate PASS; probe run and P8 re-review pending)

- Phase: P8 | Phase gate once after 8i-2: degradation-audit lint, di-lint lint, 4-host typecheck,
  vscode-core host-attention-ingress test. Phase review: the coordinator's P8 re-review.
- Recommended executor: CLI lane, implementation capability (Codex: only lane with confirmed
  room). Fallback: other family same capability -> same family other model -> subagent.
  Subagent reason: N/A. Review family: implementer Codex, reviewer Claude.
- Execution mode: sequential (8i-2 consumes the 8i-1 failure log / stderr tail API).
- Verify per batch: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk,ptah-electron`.

### Plan validation (8i)

- Consumers of the old text 'Codex context could not be opened': only
  `codex-runtime.spec.ts` (grep over libs/apps). agent-sdk and rpc-handlers do not match on it.
  The message stays; only `cause` and a log are added. OK.
- `CodexAppServerProcess` has no logger today (constructor: spawner, executable, binary,
  profile, handlers). RISK (LOW): adding a logger must not change behaviour; an optional
  trailing constructor argument keeps every existing spec call site valid. Task 8i-1.
- `fail(message)` keeps only the first message; the underlying exception (e.g. a
  `CodexProtocolError` with `code`/`method` from `validateCodexFrame`) is dropped in `onData`'s
  catch. RISK (MEDIUM): the method that failed is exactly the D7 evidence; keep the original as
  `cause` of the failure error and name the frame method (never the frame). Task 8i-1.
- ASSUMPTION: an unknown server NOTIFICATION method (e.g. MCP startup status during
  thread/start) fails validation and kills the process. Unverified; the probe (8i-2) settles it.
- Stderr ring buffer: bounded bytes and lines; redaction (Bearer, sk-, Authorization) applied
  on read; never logged at info. Task 8i-1.
- Probe: no Electron, no build target, no turn/start. Load check only (`--help`, no spawn) is
  allowed to the lane; the coordinator runs the real probe.

### Batch 8i-1: keep and log the real open failure cause — COMPLETE (c2a06f834)

- Files (W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/):
  W/libs/backend/codex-runtime/src/lib/codex-runtime.ts, codex-app-server-process.ts,
  codex-runtime.spec.ts, codex-app-server-process.spec.ts, optional new
  codex-stderr-tail.ts (+ .spec.ts), W/libs/backend/codex-runtime/src/index.ts only if an export
  is needed by 8i-2.
- `open()` rethrow keeps `cause`; one `logger.error` with error class, message, method, rpc code,
  redacted stderr tail. Process: failure error carries cause + method; debug log of the tail on
  process failure / rejected request.
- Lane: Codex (CLI session 01a17ed6-080d-78c3-ad71-9fa7cc42923d), 6 min, report
  batch-8i-1-report.md. Files match the declared set (git status checked).
- PROCESS NOTE: the lane called `ptah_get_diagnostics` once despite the ban (its backend-developer
  role preamble requires it; the task prompt forbids it). Result 0 errors; not used as evidence.
  Future lane prompts: state that the task prompt's ban overrides the role preamble.
- Public surface: the lane added `export { CodexProcessFailureError }` to the package index for
  the probe. Team-leader decision: index.ts is NOT committed in 8i-1 (no consumer yet); 8i-2 owns
  it and keeps the export only if the probe imports it from `@ptah-extension/codex-runtime`,
  otherwise reverts it.
- Verify (codex-runtime, agent-sdk, ptah-electron): 14/15 tasks pass, 0 cache hits. The one
  failure is `@ptah-extension/agent-sdk:lint`, 2 `no-unexpected-multiline` errors in
  session-query-executor.accounts.spec.ts:174,183, a file this task never touched and that is
  byte-identical to origin/main (came in with the main merge 42170f631). Pre-existing, not an
  8i-1 regression; committed on that basis. Reported to the coordinator for a main-side fix.

### Batch 8i-2: local start probe script — COMPLETE (092095c4b; reports batch-8i-2-report.md, -2b)

- File: W/scripts/codex-start-probe.ts (one file). Real `CodexRuntime.open` with an
  Electron-equivalent profile (codex-chat-host-ports.ts, codex-chat-profile-options.ts,
  apps/ptah-electron/src/di/codex-runtime-composition.ts), initialize -> thread/start -> close.
  `--no-user-mcp` variant uses a native App Server config override.
- Lane: Codex (CLI sessions 01a17eea-c85b-7fb0-a52c-faf590adc138; fix 01a17ef0-1b0b-7260-adb4-421ae5da2c27).
  Files: scripts/codex-start-probe.ts, scripts/codex-start-probe.tsconfig.json; index.ts export
  of CodexProcessFailureError KEPT (the probe imports it) and committed here. git status: no
  undeclared files.
- Probe typecheck `npx tsc --noEmit -p scripts/codex-start-probe.tsconfig.json` (under the lock):
  first FAIL TS2322 (spawner handle `pid` optional vs SpawnedProcessHandle) + a `runtime!`
  assertion; fixed by the lane (typed handle adapter); re-run PASS. `npx eslint` on the file:
  clean. scripts/ has no project.json, so no Nx lint/test/typecheck target picks the probe up.
- MCP suppression: `-c mcp_servers.<name>.enabled=false` appended after `app-server` for each
  `[mcp_servers.<name>]` header name in CODEX_HOME/config.toml (evidence: rust-v0.155.1
  config_override.rs, mcp_types.rs). Whether the override is honoured after the subcommand is
  for the probe run to show (the variant prints the suppressed names).
- Default model `gpt-6.1-sol`; add `--model gpt-5.6-luna` to match the live-test selection.
- Verify (codex-runtime, agent-sdk, ptah-electron): 14/15 pass; same pre-existing agent-sdk lint
  failure as 8i-1 (session-query-executor.accounts.spec.ts:174,183, identical to origin/main).

### Batch 8i phase gate — PASS (2026-10-27, after 092095c4b)

- degradation-audit:lint PASS; di-lint:lint PASS; typecheck ptah-electron, ptah-extension-vscode,
  ptah-cli, ptah-tui PASS (4 tasks); vscode-core host-attention-ingress test PASS (1 task).

### Batch 8i deferred

- Pre-existing agent-sdk lint errors from main (`no-unexpected-multiline`,
  session-query-executor.accounts.spec.ts:174,183): fix on main or in a separate commit; not in
  this task's scope. CI lint for agent-sdk will fail on this PR until it is fixed.
- Run the probe (coordinator), both variants, then fix D7 itself from its evidence.
- D7 contract gap (`ptah-mcp-not-attached` notice vs Codex attaching Ptah MCP from config.toml):
  per P8 D8, native chat honours MCP servers; resolved in the P14 MCP mapping.

## Batch 8j: P8 fix round 5 (D7 real fix: server-shape tolerance + notification timing) — COMPLETE (code eccc2182f; phase gate PASS; probe re-run and P8 re-review pending)

- Phase: P8 | Phase gate once after 8j-1 and 8j-2: degradation-audit lint, di-lint lint, 4-host
  typecheck, vscode-core host-attention-ingress test. Phase review: the coordinator's P8 re-review.
- Recommended executor: CLI lane, implementation capability (Codex: only lane with confirmed
  room). Fallback: other family same capability -> same family other model -> subagent.
  Subagent reason: N/A. Review family: implementer Codex, reviewer Claude.
- Execution mode: parallel (8j-1 and 8j-2 are file-disjoint and independent). One combined
  verify over the working tree, then one commit per sub-batch.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk,ptah-electron`.

### Evidence (coordinator 8i probe, codex-cli 0.155.1, pin check OK)

- Variant 1 (real profile): `thread/start` fails with CodexProtocolError invalidResult; stderr
  empty. A read-only safeParse of the real result with `threadResult` (strictObject) reports
  unrecognized_keys at ["thread"]: environments, extra, canAcceptDirectInput, daybreakEnabled;
  at []: runtimeWorkspaceRoots, activePermissionProfile, multiAgentMode.
- Variant 2 (`--no-user-mcp`): fails earlier at notification `remoteControl/status/changed`
  with Error('Unexpected notification') (codex-app-server-process.ts:363-364) because `ready`
  is set only after `initialized` is written (line 222); the server sends it right after the
  initialize reply. User MCP servers are NOT the cause. The 8i ASSUMPTION (unknown notification
  kills the process) is confirmed for unknown methods (validator `unknownMethod`) and for any
  notification before `ready`.

### Plan validation (8j)

- Server data validation is strict (`z.strictObject`) across results, notification params and
  server-request params; the pinned schema is additive between patch builds, so any added
  field kills `open()`. Fix: server-sent shapes strip unknown keys, keep required fields and
  types. Client-sent params (ours) and our replies to server requests stay strict. Task 8j-1.
- RISK (MEDIUM): building blocks are shared by both directions (sandbox, approvalPolicy,
  functionOutput, permissions, `empty`, input-like content). A tolerant variant must not leak
  into client params. 8j-1 builds a server variant per dual-use block; specs pin both sides.
- RISK (LOW): spec `rejects malformed %s params and result` feeds `{ misspelled: true }` to every
  result; results with no required field (e.g. `empty`) now accept it. Spec changes to the new
  rule with the reason; the params half stays.
- Validator keeps `unknownMethod` for methods outside the pinned manifest (contract unchanged);
  the PROCESS decides to ignore unknown notifications (debug log once per method). Task 8j-2.
- Pre-ready notifications: only after the initialize response arrived; bounded buffer, flushed
  in order once `ready`; `initialized` from the server and server requests before ready stay
  errors. Before the initialize response a notification stays an error. Task 8j-2.
- `model/list` request-local rejection (process.ts:340-352) still applies to type drift and
  missing required fields; keep it. Task 8j-2 confirms.
- Pinned schema contract spec (field names subset/required) is unaffected by unknown-key mode.

### Batch 8j-1: tolerant server-shape schemas — COMPLETE (eccc2182f)

- Files (W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/):
  W/libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts, codex-protocol-methods.ts,
  codex-protocol-validator.ts, codex-protocol-validator.spec.ts.
- Report: batch-8j-1-report.md.

### Batch 8j-2: non-fatal notification timing and unknown notifications — COMPLETE (eccc2182f; fixes 8j-2b, 8j-2c)

- Files: W/libs/backend/codex-runtime/src/lib/codex-app-server-process.ts,
  codex-app-server-process.spec.ts.
- Report: batch-8j-2-report.md.

### Batch 8j execution record

- 8j-1 lane: Codex (CLI session 01a17efc-31d1-7d81-b87a-b39603c505be), 6 min, batch-8j-1-report.md.
  Server-only blocks now strip (z.object): commandAction, every item variant (nested), turnError,
  turn, thread, threadResult, elicitation, usage, rateWindow, rateLimits; all codexRequestSchemas
  RESULTS (initialize, thread/start, thread/resume, turn/start, turn/steer, turn/interrupt,
  thread/compact/start, model/list, account/rateLimits/read); all codexServerRequestSchemas
  PARAMS; all notification params except `initialized` (former looseObject ones switched to
  strip); incoming envelope + JSON-RPC error object (with a pre-strip routing refine: id type,
  method excludes result/error, response excludes params, result XOR error).
  Dual-use pairs (original strict / new tolerant): empty/serverEmpty, approvalPolicy/
  serverApprovalPolicy, sandbox/serverSandbox, input/serverInput, textElement/serverTextElement,
  functionOutput/serverFunctionOutput, permissions/serverPermissions. Kept strict: every client
  request params, every server-request RESULT (our replies), `initialized`.
  Manifest/parity-gate specs: no strictness dependency (binary identity / rollout evidence only).
- 8j-2 lane: Codex (CLI session 01a17efc-75b3-7b71-b89b-e4ec1eb4802c), 3 min, batch-8j-2-report.md.
  `initializeResponseReceived` set on the successful initialize response; notifications after it
  and before `ready` buffered (64, overflow fails closed), flushed after `ready`; unknown
  notification methods ignored (catch of validator `unknownMethod` after envelope validation,
  no id), debug log once per method, 64-name cap; buffer and set cleared on close. model/list
  request-local rejection kept (type drift / missing fields still reach it).
- Combined verify (parallel lanes, each blind to the other): 5 spec failures, all old-strictness
  assertions (codex-runtime.spec.ts model-list invalid table + idle malformed traffic; process spec
  invalid-unknown-notification envelope + malformed catalog envelope). Fixed spec-only by 8j-2b
  (fresh lane, session 01a17f0f-8338-7f00-bfe6-0b9b049ac436) and 8j-2c (resume: string-match
  assertion; restored the `reasoningEffort: ''` min(1) case).
- Verify (codex-runtime, agent-sdk, ptah-electron; lock line lists the 3 projects): 14/15 pass; the
  one failure is the known pre-existing agent-sdk lint (session-query-executor.accounts.spec.ts:
  174,183, no-unexpected-multiline), unchanged from main. codex-runtime tests 887.
- Commit decision: ONE code commit for 8j-1 + 8j-2 (eccc2182f), not two. Reason: the lanes ran in
  parallel and 8j-1 alone fails codex-runtime specs that 8j-2b fixed; only the combined tree was
  verified, so a split commit would record an unverified intermediate state.
- PROCESS NOTE: the 8j-1 lane called `ptah_get_diagnostics` once despite the ban (role preamble
  again); it returned unavailable, no files changed, not used as evidence.

### Batch 8j phase gate — PASS (2026-10-27, after eccc2182f)

- degradation-audit:lint PASS; di-lint:lint PASS; typecheck ptah-electron, ptah-extension-vscode,
  ptah-cli, ptah-tui PASS (4 tasks); vscode-core host-attention-ingress test PASS (1 task).

### Batch 8j deferred

- Coordinator: re-run the probe (both variants) on eccc2182f; then the P8 re-review (reviewer
  family Claude, implementer Codex) over 9b5f4c86c..eccc2182f.
- Minor: the process's unsupported-server-request pre-check (codex-app-server-process.ts
  `unsupported` z.strictObject) still rejects an UNKNOWN server request carrying an extra envelope
  key (falls through to a fatal unknownMethod instead of a `Method not found` reply). Unchanged
  behaviour from before 8j; align with the stripping envelope in a later round.
- Unknown notifications before the initialize response are ignored (not fatal) — a known-method
  notification there stays fatal. Accepted: unknown methods carry no state Ptah reads.
- Pre-existing agent-sdk lint errors from main (see 8i deferred).

## Batch 8k: P8 fix round 6 (live-test-p8e.md D8, D10, D11, D12, tool naming, session stats) — IN_PROGRESS (8k-1..8k-5 COMPLETE; phase gate re-run and P8 re-review pending, coordinator, after 8l)

- Phase: P8 | Phase gate once after 8k-5: degradation-audit lint, di-lint lint, 4-host typecheck,
  vscode-core host-attention-ingress test. Phase review: the coordinator's P8 re-review (reviewer
  family Claude, implementer Codex/Glm), after the live re-test. Not run in this round.
- Principle: the native Codex path produces the SAME contracts the Claude path produces
  (FlatStreamEventUnion, `turn_state` lifecycle, PermissionRequest, session RPCs). Fix the Codex
  backend side; no Codex special case in the frontend unless a shared contract lacks a field.
- Recommended executor: CLI lane, implementation capability. Codex for 8k-1, 8k-3, 8k-4, 8k-5
  (near weekly limit; on a confirmed limit fall back to Glm), Glm (ptah-cli) for 8k-2. Fallback
  order: other family same capability -> same family other provider/model -> subagent.
  Subagent reason: N/A. Review family: implementers Codex + Glm (Ollama Cloud), reviewer Claude.
- Execution mode: waves. Wave A parallel {8k-1, 8k-2} (file-disjoint). Wave B parallel
  {8k-3, 8k-4} (file-disjoint, both need wave A). Wave C 8k-5 (specs over the whole path).
  One combined verify per wave over the working tree; commit per sub-batch when the sub-batch
  alone is verifiable, else one commit per wave (8j precedent).
- Verify (W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration):
  `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/codex-runtime,@ptah-extension/rpc-handlers,ptah-electron`
  (only the changed projects of the wave). Known pre-existing lint: agent-sdk
  session-query-executor.accounts.spec.ts:174,183.

### Plan validation (8k) — PASSED WITH RISKS

Evidence read by the team-leader (file:line at e91e967c9):

- D8 root cause confirmed: `CodexChatEvents.map` emits `message_start` and terminal
  `message_complete` only (agent-sdk codex-app-server/codex-chat-events.ts:101-111, 237-265); no
  Codex file touches `SessionTurnStateRegistry`. Claude emits `turn_state(generating)` before the
  root `message_start` (message-transform/stream-event.transformer.ts:193-198) and
  `turn_state(settleTurn)` on `result` (result-message.transformer.ts:28-36). Broadcaster safety
  net needs phase `generating` (chat-stream-broadcaster.service.ts finally block). Each Codex turn
  is one stream (`streamCodexChatTurn`, codex-chat-turn-stream.ts:51); follow-ups go through the
  host `publish` port into `streamEventsToWebview` (codex-chat-host-ports.ts last lines).
- D11 root cause confirmed: wire id = JSON key (codex-chat-host-ports.ts `key()` and `present`),
  parser requires UUID (shared permission.parsers.ts:51). Also found: `toolUseId: request.toolId`
  is always undefined because the bridge never sets `toolId`
  (codex-runtime codex-approval-bridge.ts request literal ~:177-187); the native item id is
  `params.itemId` (runtime resolveTarget, codex-runtime.ts:362-365) and equals the `toolStarted`
  `toolId` = `item.id` (codex-event-translator.ts:261-280). `toolName` falls back to the raw kind;
  `description` is `params.reason` or "Codex requests approval". `timeoutAt: 0` while the bridge
  auto-declines after 240 s (codex-approval-bridge.ts:315-318): the card shows "no timeout" for a
  request that expires. `tabId` comes from `state.tabId(id)`, which falls back to the session id
  (apps/ptah-electron/src/di/codex-session-binding.ts:54).
- D12 root cause confirmed: `chat:abort` -> `interruptSession` -> `close()` (same as Claude's
  `interruptSession`, which ends the session: sdk-agent-adapter.ts:1783-1789). The aborted
  subscription ends the event iterator and the loop falls through to
  `throw deps.error('runtime-failed', 'stream')` (codex-chat-turn-stream.ts:118-140). The
  broadcaster classifies a user abort by "abort"/"cancel" in the message; `CodexChatAdapterError`
  message is `Codex chat <op>: <code>`, so code `cancelled` classifies as a user abort and
  `failure()` already skips the error log for it (codex-chat-adapter.ts:727-737). The pending
  approval is released by `sink.dispose()` -> `cancelPrompt` + `dismiss` (codex-chat-approval-sink.ts),
  but those carry the JSON key / raw request id, never a renderer-known id.
- D10 root cause confirmed: `session:validate` only looks for a Claude JSONL
  (session-rpc.handlers.ts:1048-1067). SessionMetadataStore already holds `codexExecution`
  (runtime `codex-app-server`) and `codexThread` (session-metadata-store.ts:245-248), which the
  Electron `readResumeIdentity` reads (apps/ptah-electron/src/di/codex-runtime-composition.ts:538).
- Session stats: stats ARE emitted (`Session stats received` in p8e with tokens), but the payload
  has no `modelUsage` and no `sessionStats` (codex-chat-turn-stream.ts:98-112); the frontend
  header derives Model/Context from `modelUsage` and the snapshot from `sessionStats`
  (frontend chat session-stats-aggregator.service.ts:119-180). Native `modelContextWindow` exists on
  `thread/tokenUsage/updated` (codex-protocol-methods.ts:343-348) but the translator drops it.
  So: emitted but incomplete; 8k-4 confirms against the header code before changing it.
- Tool naming: translator names are native (`commandExecution`, `fileChange`, `server/tool`,
  `webSearch`) (codex-event-translator.ts:261-400); the projection passes them through
  (codex-chat-events.ts:187-202).

Risks:

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Turn-state revision is per session id; the Codex thread id is the Ptah session id, so a resumed Codex thread continues the same floor (no restart) | LOW | 8k-1 uses the shared registry instance (SDK_SESSION_TURN_STATE_REGISTRY) |
| A detached consumer (drain path) settles without a consumer; the broadcaster already forced idle | LOW | 8k-1: drain path calls settle/forceIdle on the registry without yielding; spec |
| Mapping Codex `fileChange` to Claude `Edit`/`Write` needs inputs the renderer may require (old_string/new_string) | MEDIUM | 8k-2 maps only where the renderer's required inputs exist; else keeps the raw type; decisions recorded |
| `state.tabId` falls back to the session id: a permission could carry a thread id as `tabId` | MEDIUM | 8k-3 omits `tabId` when the lookup has no real tab (the field is optional in the parser) |
| Codex-side stop must not leave Codex pending approvals or host notices | MEDIUM | 8k-1 settles pending approvals of the turn on every terminal path; 8k-3/8k-5 pin hostAttention.resolve with the wire id |
| Codex weekly limit at 92% | MEDIUM | fallback to Glm per lane recovery order |

Assumptions:

- `chat:continue` for a Codex-owned session reaches `CodexChatAdapter.resumeSession` once
  `session:validate` says exists (routing by identity lookup). Unverified; 8k-3 checks the
  continue path and states the evidence.
- `parsePermissionRequest` is importable from `@ptah-extension/shared` in backend specs. 8k-3/8k-5 check.

Decisions (team-leader):

- Codex failed turn -> `recordFailure(id, { error: 'unknown', terminalReason: null })` then
  `settleTurn` -> phase `failed` (Claude's failed phase comes from the StopFailure snapshot the
  same way). Interrupted -> `settleTurn(id, 'aborted_streaming')`. Completed ->
  `settleTurn(id, 'completed')`. Reversible.
- Stop keeps Claude semantics (close the session) but the turn stream raises
  `CodexChatAdapterError('cancelled', 'turn')`, which the shared broadcaster classifies as a
  user abort. No `turn/interrupt` rewrite of `chat:abort` this round. Reversible.
- Wire approval id = `randomUUID()` per presentation, host map wire id -> correlation; every
  outbound message (`PERMISSION_AUTO_RESOLVED`, `PERMISSION_PROMPT_CANCELLED`) and the host
  attention release use the wire id.
- `timeoutAt` = the bridge's real decline deadline (new `expiresAt` on CodexApprovalRequest),
  not 0, so the card and the renderer expiry match the native timeout.
- D10 option A: `session:validate` answers `exists: true` for a session whose metadata carries
  `codexExecution.runtime === 'codex-app-server'` and a valid `codexThread`.

Deferred / not this round:

- D9 (history after reload, = P12 `thread/read`): REQUIRED BEFORE Removal A (P15).
- Native MCP attach and the wrong `ptah-mcp-not-attached` notice: round 8l.
- Plan-limits "Unavailable" for Codex: recorded only.
- Manual mode running read-only commands without a prompt (Codex sandbox policy): observation only.
- The host notice title shows the raw session id when metadata has no name: recorded only.

### Batch 8k-1: Codex turn lifecycle (D8) and user-abort classification (D12, adapter side) — COMPLETE (65a5537e6)

- Files: W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts,
  codex-chat-adapter.ts, codex-chat-approval-sink.ts, W/libs/backend/agent-sdk/src/lib/di/register.ts,
  specs codex-chat-adapter.spec.ts, codex-chat-approval-sink.spec.ts, new
  codex-chat-turn-lifecycle.spec.ts (same folder).
- Report: batch-8k-1-report.md.

### Batch 8k-2: native tool presentation and approval identity in core — COMPLETE (095e4246e)

- Files: new W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-tool-presentation.ts + .spec.ts,
  W/libs/backend/agent-sdk/src/index.ts (export), W/libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts,
  codex-runtime.types.ts, codex-approval-bridge.spec.ts.
- Report: batch-8k-2-report.md.

### Batch 8k-3: host approval wire contract (D11, D12 host side), session:validate (D10), tool names in the projection — COMPLETE (785de99ef D10 + projection; 5598b15c1 host ports D11)

- NOT ACCEPTED part: W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts
  + .spec.ts stay uncommitted in the worktree. rpc-handlers typecheck (source) passed; the spec
  suite fails to compile: codex-chat-host-ports.spec.ts:360, :457, :458, :572 pass
  `['deny', 'allowOnce']` where `typeof CODEX_CHAT_APPROVAL_CHOICES` (4-tuple) is required, and
  :556 passes a `string` `reason` where PermissionPromptCancelledPayload['reason'] is required
  (the it.each table needs literal types). Spec-only typing; production code unchanged by the fix.
  Next: resume the 8k-3 lane (Codex session 01a17f67-41d3-7741-98c6-b3d0180d50c6) with these
  five lines, re-run `npm run verify -- -t test -p @ptah-extension/rpc-handlers`, then commit.
- Minor (recorded, not fixed): session-rpc.handlers.ts:125 keeps a LOCAL copy of the codexThread
  schema because `parseCodexThreadRecord` (session-metadata-store.ts:136) is not exported from the
  agent-sdk barrel. Export it and drop the copy in a later round.

- Files: W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts + .spec.ts,
  W/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts + its spec,
  W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts + .spec.ts.
- Report: batch-8k-3-report.md.

### Batch 8k-4: native session stats (model, context, tokens) — COMPLETE (dac92cedb)

- Finding: Model and Context were never emitted (no modelUsage row; translator dropped
  modelContextWindow). Header Tokens/Cost read the session-lifetime `sessionStats` snapshot,
  which Codex never sends. DEFERRED: wiring Codex into the Claude stats owner
  (stream-transformer.ts statsOwner.replaceRun) for sessionStats; Cost stays null (unpriced).
  Native wire reports no effective model; the session's settings.model is used.

- Files: W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts (stats
  payload), codex-chat-adapter.ts (model hand-off only if needed),
  W/libs/backend/codex-runtime/src/lib/codex-event-translator.ts, codex-runtime.types.ts,
  codex-event-translator.spec.ts, plus the turn-lifecycle spec from 8k-1 for the stats assertions.
- Report: batch-8k-4-report.md.

### Batch 8k execution record

- Lanes: 8k-1 Codex (01a17f46-50d7-7fc3-a307-0f2f62a57f6b; continuation 01a17f4b-...; fix round
  01a17f5b-8187-71f2-b142-d5e7703b17ea), 8k-2 Glm (1fe2d164-737c-4ba1-ac30-055b998245d8), 8k-3
  Codex (01a17f67-41d3-7741-98c6-b3d0180d50c6), 8k-4 Glm (ad357a12-ecb2-4cf6-9ac9-e6e88dd45484).
  No lane ran verification or ptah_get_diagnostics; git status after each lane showed only
  declared files (8k-1 flagged and then fixed the out-of-scope Electron spec).
- Wave A verify (agent-sdk, codex-runtime, ptah-electron): 1st run 3 failures (sink spec fixture
  over-spread into a strict reply; Electron spec container lacked SDK_SESSION_TURN_STATE_REGISTRY),
  fixed spec-only; re-run test agent-sdk + ptah-electron PASS. Lint: only the known pre-existing
  agent-sdk session-query-executor.accounts.spec.ts:174,183.
- Wave B verify (agent-sdk, codex-runtime, rpc-handlers, ptah-electron): 16/18; failures = the
  known agent-sdk lint and the codex-chat-host-ports.spec.ts compile errors (see 8k-3).
- Commits: 65a5537e6 (8k-1), 095e4246e (8k-2), dac92cedb (8k-4), 785de99ef (8k-3 part:
  D10 + projection tool names). 785de99ef subject is 74 chars (over the 72 rule); not pushed,
  not amended (no history rewrite).
- Codex weekly limit rose 92% -> 95% over this round.

### Batch 8k phase gate — PASS (2026-10-28, after 785de99ef; host-ports pair uncommitted in tree)

- degradation-audit:lint PASS; di-lint:lint PASS; typecheck ptah-electron, ptah-extension-vscode,
  ptah-cli, ptah-tui PASS (4 tasks); vscode-core host-attention-ingress test PASS.

### Batch 8k-5: end-to-end contract specs (host + translator + projection) — COMPLETE (c1b2a1364)

- Executor: team-leader (Claude, in-process; no lane). Specs only, no production change.
- Verify: `npm run verify -- -t test -p @ptah-extension/rpc-handlers` PASS; `npm run verify -- -p
  @ptah-extension/rpc-handlers` PASS (lint 0 errors / 52 pre-existing warnings, none in the new
  file; typecheck; test 188 suites, 4852 passed, 7 skipped). New file: 3 tests pass.
- Findings (no production change): see batch-8k-5-report.md (renderer parser drops
  `allowedDecisions`; answered native prompt also broadcasts PERMISSION_AUTO_RESOLVED; follow-up
  turns published by session id are ended by the broadcaster teardown).

- Coverage already landed per path, but per unit, not end to end: turn lifecycle ordering with a
  real registry (codex-chat-turn-lifecycle.spec.ts), approval payload through the REAL
  `parsePermissionRequest` with toolUseId = request.toolId (codex-chat-host-ports.spec.ts), stop
  during approval -> `cancelled` error + prompt cancelled + notice released with the wire id
  (lifecycle spec + host-ports spec), toolId = native itemId (codex-approval-bridge.spec.ts).
- Still owed (the required end-to-end specs): one spec per path through translator -> projection ->
  turn stream -> host ports, and the comparison with a Claude fixture turn through the real
  Claude transformer. Required before the P8 live re-test is signed off.

- Files: new W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts.
- Specs: (1) a completed turn emits the same ordered root lifecycle (`turn_state` generating,
  `message_start`, ..., `message_complete`, `turn_state` idle) as a Claude fixture turn through the
  real Claude transformer; (2) an approval produces a PermissionRequest that passes the real
  `parsePermissionRequest` and whose `toolUseId` equals the `tool_start` `toolCallId`; (3) stop
  during approval -> abort-classified error, `turn_state` idle `aborted_streaming`, prompt cancelled
  and host notice released with the wire id.
- Report: batch-8k-5-report.md.

## Round 8l: native MCP for Codex main chat (D8 parity; P8 D13) — BATCHES COMPLETE (8l-1a 4f12d4c04, 8l-1b f3d9e950c, 8l-1c b959b58d9, 8l-2 9b364c658, 8l-3 e448b5517; gateway-chat-bridge verify PASS; phase gate + P8 re-review pending at the coordinator)

- Phase: P8 | Phase gate and P8 re-review: the coordinator, after this round (not run here).
- Binding user decisions: D8 (native chat honours Ptah MCP AND the user's MCP servers; never
  strip MCP to bypass a problem; the 8h/D6 strip-with-notice is removed here) and P8 D13 (harness
  sync stays in this PR; Ptah's synced `ptah` entry is overridden per Ptah thread; the user's
  hand-written config.toml entries are untouched; full harness-sync removal in the follow-up PR).
- Recommended executor: CLI lane, implementation capability. Codex is at 98% weekly, opencode at
  its monthly limit: Glm (ptah-cli, Ollama Cloud) is the lane. Fallback order: other family same
  capability -> same family other provider/model -> subagent. Subagent reason: N/A.
  Review family: implementer Glm, reviewer Claude (coordinator's P8 re-review).
- Execution mode: sequential (every batch depends on the previous; 8l-1c and 8l-2 share
  codex-chat-host-ports.ts). One lane, resumed per batch when its session is fresh.
- Verify per batch: only the changed projects (`npm run verify -- -p <projects>`), then at the end
  of the round the dependents of codex-runtime that the round changed (cli-agent-runtime,
  agent-sdk, rpc-handlers, ptah-electron).

### Plan validation (8l) — PASSED WITH RISKS

Evidence read by the team-leader (file:line at 0dd1aa9d8):

- `codex-runtime.ts:91-100` refuses any profile with `mcpServers`. `RuntimeContext.open`
  (`codex-runtime.ts:304-331`) builds `thread/start` params without `config`, and `thread/resume`
  reuses the same params. `threadOptions.config` exists (`codex-protocol-schemas.ts:484`,
  `object.nullish()`); the pinned schema marks ThreadStartParams/ThreadResumeParams `config` as
  `additionalProperties: true` with no further shape.
- `CodexMcpServer` (`codex-runtime.types.ts:41-56`) carries only references (`envReferences`,
  `headerReferences`, `authReference`); the profile schema (`codex-execution-profile.ts:39-67`)
  refuses URLs with userinfo, query or hash. No resolver exists at the runtime boundary.
- The fingerprint identity (`codex-execution-profile.ts:255-279`) includes `mcpServers`, and
  `CodexRuntime.open` (`codex-runtime.ts:77-89`) refuses a resume whose `profileFingerprint`
  differs from the stored identity.
- Claude main chat's Ptah MCP URL is `http://localhost:${PTAH_MCP_PORT}/session/{routing id}`,
  routing id = tabId preferred over sessionId (`sdk-query-options-builder.ts:1924-1957`). The MCP
  server's closed grammar accepts `/session/{id}/workspace/{root}`
  (`http-server.handler.ts:283-313`); `ptahMcpServerUrl` (`cli-agent-runtime/.../ptah-mcp-url.ts:46`)
  builds only the `/agent/{id}/workspace/{root}` lane shape.
- Lanes pass `mcp_servers.ptah.url` and `mcp_servers.ptah.tool_timeout_sec=960`
  (`codex-lane-config.builder.ts:144-163`, `CODEX_PTAH_TOOL_TIMEOUT_SEC` not exported publicly).
  The evidence harness proved the dotted-key override grammar for MCP servers as process `-c`
  overrides (`tools/evidence-harness.ts:1432-1437`, spike 1k).
- User servers reach the host as `mcpServersOverride: Record<string, McpHttpServerOverride>`
  (`type: 'http'`, `url`, `headers`; `rpc-chat.types.ts:31-35`) from Smithery + OAuth
  (`chat-session.service.ts:455-484`). OAuth headers carry `Authorization: Bearer <token>`
  (`mcp-oauth-override-resolver.ts:65-69`); legacy Smithery URLs carry `config` and `api_key` in
  the QUERY (`smithery-wire.constants.ts:70-83`). No producer emits stdio or sse today.
- The D6 strip: `codex-chat-profile-options.ts:23-30` (`mcpServerRunning`, `mcpServersOverride`),
  logs at `codex-chat-host-ports.ts:163-173`, the visible notice at
  `chat-runtime-profile.service.ts:164-169`.
- Finding 3 of 8k-5: `ports.publish` streams follow-up turns under the session id
  (`codex-chat-host-ports.ts:428-429`); the broadcaster captures `getSessionToken(sessionId)`
  (`chat-stream-broadcaster.service.ts:155`) and calls `endSessionIfTokenMatches` at exit
  (`:412-416`); the Codex adapter returns the live session token (`codex-chat-adapter.ts:561-583`)
  and closes the session on a match. Plausible by reading; 8l-3 pins it with a spec first.

Decisions (team-leader; reversible; recorded in decisions.md under P8 D13):

- DL1 Config channel: MCP servers go natively in the `thread/start` AND `thread/resume` `config`
  object as dotted keys, one whole table per server: `"mcp_servers.<name>": { ... }`. A whole-table
  value replaces Ptah's synced `[mcp_servers.ptah]` entry for this thread and leaves every other
  config.toml entry (e.g. `node_repl`) untouched. Never a top-level `mcp_servers` key (it would
  replace the user's whole table). Options: thread config (chosen; native, per thread, the
  coordinator's direction) vs process `-c` overrides (proven by the harness; fallback if the probe
  shows the thread config is not applied).
- DL2 Secrets: the profile keeps references only. Resolved values travel in a separate
  `secrets` argument of `CodexRuntime.open(profile, resume?, secrets?)` (a `ReadonlyMap` of
  reference -> value) built by the host per open and passed through by the adapter; they are
  written only into the `config` of the thread/start|resume frame on the child's stdin. Never in
  the profile, the fingerprint, the identity store, logs or errors. Options: frame config (chosen;
  one boundary, testable) vs process env + `env_http_headers` (hardening option, later).
- DL3 Fingerprint: `mcpServers` leave the thread-identity fingerprint. They are re-applied on every
  open (start and resume) like model and effort, so a tab id in the Ptah URL or an added user
  server cannot make a native session unresumable. The previous spec that pinned references in
  the fingerprint is replaced.
- DL4 Ptah URL: `http://localhost:{PTAH_MCP_PORT}/session/{enc(routing id)}/workspace/{enc(cwd)}`,
  routing id = `config.tabId` preferred, else the session id (Claude parity), through a new
  session-scoped sibling of `ptahMcpServerUrl` in the same file. `tool_timeout_sec` =
  `CODEX_PTAH_TOOL_TIMEOUT_SEC` (960, lane parity). Attached only when `mcpServerRunning === true`.
- DL5 User servers: each `mcpServersOverride` entry becomes an http server; every header value is
  a secret reference; a URL with a query becomes `url` = origin + path plus `urlReference` to the
  full URL (the runtime checks the resolved URL has the same origin + path). Caller entry wins on a
  name collision with `ptah` (Claude `mergeMcpOverride` parity). The core refuses names outside
  `[A-Za-z0-9_-]` (dotted config keys; Codex's own name rule). OAuth keys contain dots
  (`deriveMcpOAuthServerKey`, `mcp-oauth.service.ts:163-172`), so the HOST maps each name to a
  Codex-safe name (every other character -> `_`) and refuses a collision after mapping with a
  coded, visible error (never drops a server). The host logs names and transports only.
- DL6 Transports in the core: stdio -> `command`, `args`, `env` (resolved); http -> `url`,
  `http_headers` (resolved), `tool_timeout_sec`; sse -> same keys as http (Codex speaks streamable
  HTTP; a failing server is reported by Codex at startup, the thread still opens). `authReference`
  -> `http_headers.Authorization = "Bearer <value>"`, refused if `Authorization` is also a header.

Risks:

| Risk | Severity | Mitigation |
| --- | --- | --- |
| The thread `config` dotted-key format is not what the App Server applies | HIGH | 8l-1b spec pins the exact frame; coordinator probe (HANDOFF step 7) must show `ptah` attached; fallback DL1 `-c` overrides |
| A secret reaches a log, error, stored identity or fingerprint | HIGH | 8l-1a/8l-1b/8l-2 specs assert no secret value in logger calls, thrown messages, persisted identity, profile JSON or fingerprint |
| Fingerprint change makes pre-8l stored native threads unresumable | LOW | native chat is dev-gated (PTAH_CODEX_RUNTIME_DEV); recorded in DL3 |
| URL secret in a Smithery query is refused by the profile schema | MEDIUM | DL5 `urlReference`; 8l-2 spec with a query URL |
| Follow-up turn teardown (8k-5 finding 3) | MEDIUM | 8l-3 spec first, fix only if reproduced |

Assumptions:

- `CodexRuntime.open` callers other than the chat adapter (gateway, usage client, probe) pass no
  secrets and keep compiling with an optional third parameter. 8l-1b checks.
- Codex does not persist thread `config` override values into its rollout files. Unverified;
  recorded for the live test p8f (coordinator).

Edge cases:

- MCP server not running -> no `ptah` entry, no notice (Claude logs and omits). 8l-1c.
- No routing id (no tabId and no session id) while MCP runs -> coded error, chat fails visibly
  (Claude throws SdkError). 8l-1c.
- A reference without a value -> refused before spawn, message names the server only. 8l-1b.
- Resume after reload under a new tab id -> resumes (DL3). 8l-1a spec + 8l-1c spec.

### Batch 8l-1a: core MCP config builder and profile fields — COMPLETE (4f12d4c04; report batch-8l-1a-report.md)

- Files (C = W/libs/backend/codex-runtime/src/lib/): new C/codex-mcp-config.ts, new
  C/codex-mcp-config.spec.ts, C/codex-runtime.types.ts, C/codex-execution-profile.ts,
  C/codex-execution-profile.spec.ts, W/libs/backend/codex-runtime/src/index.ts.
- Tasks: (1) `CodexMcpServer` gains optional `toolTimeoutSec` (positive int) on every variant and
  `urlReference` on http/sse; `CodexMcpSecrets = ReadonlyMap<string, string>`; the `CodexRuntime`
  port `open(profile, resume?, secrets?)`. (2) Profile schema: the new fields, server names
  `^[A-Za-z0-9_-]+$`; `mcpServers` removed from the fingerprint identity (DL3). (3) Pure
  `buildCodexMcpConfigOverrides(servers, secrets)` -> `Record<string, CodexJsonValue>` per DL1,
  DL5, DL6; coded `CodexMcpConfigError` whose message names the server, never a value.
  (4) Specs: per transport (stdio, http, sse), Ptah entry with tool timeout, urlReference
  origin/path check, authReference, missing reference, no secret in errors, fingerprint unchanged by
  servers and references.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime`.

### Batch 8l-1b: runtime applies MCP config on thread/start and thread/resume; adapter passes secrets — COMPLETE (f3d9e950c; report batch-8l-1b-report.md)

- Files: C/codex-runtime.ts, C/codex-runtime.spec.ts,
  W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts (+ codex-chat-adapter.spec.ts).
- Tasks: replace the `mcpServers` refusal (`codex-runtime.ts:92`) with a pre-spawn build of the
  config (unresolved reference -> refused before spawn); send `config` on thread/start and
  thread/resume; the adapter port `profile()` may return `secrets`, passed to `runtime.open`.
  Specs: exact frames, secret absent from logs/identity store/errors, refusal before spawn.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk`.

### Batch 8l-1c: Ptah MCP attached natively to Codex chat — COMPLETE (b959b58d9; report batch-8l-1c-report.md)

- Files: W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts (+ spec),
  cli-adapters/index.ts (export the session builder and `CODEX_PTAH_TOOL_TIMEOUT_SEC`),
  R/codex-host/codex-chat-host-ports.ts (+ .spec.ts) (R = W/libs/backend/rpc-handlers/src/lib/chat/).
- Tasks: DL4; remove the "Ptah MCP is not attached" log; specs: start (tab id), resume (session
  id fallback / new tab id still resumes), MCP not running, missing routing id.
- Verify: `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers`.

### Batch 8l-2: the user's MCP servers natively; D6 strip and notice removed — COMPLETE (9b364c658; report batch-8l-2-report.md)

- Files (7, one atomic contract: strip and its notice leave together): R/codex-host/
  codex-chat-host-ports.ts (+ .spec.ts), R/codex-host/codex-chat-profile-options.ts (+ .spec.ts),
  R/session/chat-runtime-profile.service.ts (+ .spec.ts), R/session/chat-session.native.spec.ts.
- Tasks: DL5; `mcpServerRunning` and `mcpServersOverride` become supported keys; the MCP notice
  line and `codex-user-mcp-not-attached` log go (output-style and model notices stay). Specs per
  transport the host produces (http with headers, http with query URL), real-config spec
  (Smithery + OAuth resolvers) attaches both, and a spec that no secret value appears in any
  logger call, the profile JSON, the fingerprint, the persisted identity or the notice.
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers`.

### Batch 8l-3: follow-up native turns keep the live thread (8k-5 finding 3) — COMPLETE (e448b5517; report batch-8l-3-report.md; defect real)

- Files: spec first (R/codex-host/ or R/streaming/), fix only if reproduced, in the Codex side
  (agent-sdk codex-chat-adapter.ts token semantics or the host publish), never the shared
  broadcaster's Claude behaviour. Findings 1-2 of 8k-5: recorded only.
- Verify: the changed projects.

## Round 8m: protocol parity (native Codex chat == Claude UI contracts) — IN_PROGRESS (Wave 1 COMPLETE: 3fe884270, 41c73d47c, d2f2fb2c5; Wave 2 COMPLETE: 38803702e, d82b252ba, f7a6a31dd; Wave 3 COMPLETE: 1096bf516 (8m-7), df8cfb638 (8m-9), 10581f566 (8m-8), 65def9e96 (8m-10); not pushed by the team-leader; phase gate: see "Round 8m phase gate" below)

- Phase: P8 | Phase gate and P8 re-review: the coordinator, after this round (code-logic; style
  only if a new public API appears). The team-leader commits per batch, does not push.
- Goal (user): native Codex chat produces EXACTLY Claude's UI contracts (FlatStreamEventUnion,
  turn_state, PermissionRequest, the AskUserQuestion flow, tool input/output shapes). Fix in the
  translation layer only: codex-runtime `codex-event-translator.ts` / `codex-approval-bridge.ts`
  -> agent-sdk `codex-chat-events.ts` / `codex-tool-presentation.ts` -> rpc-handlers
  `codex-host/codex-chat-host-ports.ts`. No Codex special case in the frontend, no second proxy.
- Every gap is pinned by a parity spec that compares the Codex output with the Claude
  fixture/shape for the same case (pattern: `R/codex-host/codex-chat-native-contract.spec.ts`).
- Binding: D8 (never strip, revert or comment out MCP). Electron first; Claude behavior unchanged.
- Executors (user request via coordinator, 2026-10-28): every batch is a CLI lane in W
  (workingDirectory = W), one batch per lane, vendors mixed; no in-process subagent. Live list
  14:45 UTC: codex (cli, confirmed room, 4% weekly), Glm (ptah-cli
  pc-355b645d-35af-4974-84cf-9cf961ea0164, Ollama Cloud), grok (cli, limits unknown),
  antigravity (cli, limit reader failed); opencode AT LIMIT (do not use); copilot disabled;
  cursor/pi not installed. codex and Glm first; grok/antigravity as extra capacity; a lane that
  fails to start or stalls -> reassign the batch (fallback: other family same capability ->
  same family other provider/model -> subagent with a reason). Review family: implementer
  codex/Glm/grok/antigravity, reviewer Claude (coordinator's P8 re-review) — satisfies
  decision 7. Record the vendor that wrote each batch in its header.
- Execution mode: three waves of file-disjoint batches, at most 3 lanes in flight. A wave's
  commits start only after EVERY lane of the wave has finished (lint-staged hides unstaged
  changes during the pre-commit hook); then git status for undeclared files, scoped verify under
  the lock, commit batch by batch with explicit paths; only then the next wave.
- Lane rules (FIRST lines of every lane task): NEVER call ptah_get_diagnostics; NEVER verify,
  commit or push; edit ONLY the declared files; the CLAUDE.md verify and Electron-first rules;
  no `any` / `as unknown as` / `@ts-ignore` / `eslint-disable`; never strip MCP; 40 tool calls;
  write the batch report to the declared absolute path
  (`.ptah/specs/TASK_2026_714_c8a2/batch-8m-<id>-report.md`) and call ptah_agent_report.
- Wave plan: Wave 1 = 8m-1 (codex), 8m-2 (Glm), 8m-3 (grok, else antigravity). Wave 2 = 8m-4
  (Glm), 8m-5 (codex), 8m-6 (grok/antigravity). Wave 3 = 8m-7 (codex). G6 is in Wave 1.

### Plan validation (8m) — PASSED WITH RISKS

Evidence (file:line at 88404d091; C = W/libs/backend/codex-runtime/src/lib, A =
W/libs/backend/agent-sdk/src/lib/codex-app-server, R = W/libs/backend/rpc-handlers/src/lib/chat):

- G6 (coordinator, highest priority): `C/codex-execution-profile.ts:226-255` maps 'ask' to
  read-only + granular approvals, 'auto-edit'/'yolo' to workspace-write + on-request. Codex then
  asks only on model-requested escalation (live-test-p8f b turn 1). Codex source (openai/codex
  main, fetched 2026-10-28): `core/src/safety.rs` `assess_patch_safety`: `UnlessTrusted =>
  return Ok(SafetyCheck::AskUser)` for every patch; OnRequest/Granular auto-approve patches
  inside writable roots. `core/src/exec_policy.rs` `render_decision_for_unmatched_command`:
  `UnlessTrusted => Decision::Prompt` ("require approval for every command that is not
  explicitly allowed by an exec policy rule"); OnRequest/Granular with a restricted sandbox ->
  `Allow` unless the command requests a sandbox override. Schema allows "untrusted"
  (`protocol/codex-app-server-protocol.schema.json` AskForApproval; `C/codex-protocol-schemas.ts:20,33`).
  `C/codex-permission-policy.ts:41` already auto-accepts fileChange for 'auto-edit', presents
  commands, declines everything in 'plan'. Fingerprint identity includes sandboxPolicy and
  approvalPolicy (`C/codex-execution-profile.ts:264-275`).
- G1: `C/codex-event-translator.ts:274-277, 295-298, 347-350` replace failed/declined results
  with `safeError(...).message` ("Codex could not complete this operation.").
- G2: `A/codex-tool-presentation.ts:65-73` adds `cwd` to the Bash input.
- G3: `C/codex-event-translator.ts:238-251` emits reasoning only on completion; `item/reasoning/
  summaryTextDelta|textDelta` are unmodeled; `A/codex-chat-events.ts:166-178` -> host
  `R/codex-host/codex-chat-event-callbacks.ts:80-89` publishes `thinking_delta` even for `''`.
- G4: `C/codex-runtime.ts:59,376` option `requestUserInput` is never passed by a host;
  `C/codex-approval-bridge.ts:233-236` then answers `{}`. Claude path:
  `agent-sdk/src/lib/permission/ask-user-question.service.ts` (ASK_USER_QUESTION_REQUEST,
  registry, idle auto-pick, abort -> null, `chat:pending-questions` replay).
- G5: `libs/shared/src/lib/types/permission.parsers.ts:47-107` drops `allowedDecisions` (the
  only wire entry point, `chat-message-handler.service.ts:734`), so the 8c frontend readers are
  dead; `R/codex-host/codex-chat-host-ports.ts:466-475` `dismiss` still finds the wire id while
  `handlePermissionResponse` (:491-545) is inside `respond`, so PERMISSION_AUTO_RESOLVED follows
  a user answer (8k-5 finding 2).
- L1: `A/codex-chat-adapter.ts:628-635` `interruptSession` closes the context; native `/compact`
  (`R/session/chat-slash-command-router.service.ts:363-371`) then hits `session()` ->
  `unavailable` (`A/codex-chat-adapter.ts:735-739`) -> CODEX_UNAVAILABLE
  (`R/session/chat-session.service.ts:564-568`). Claude's Stop keeps the tab usable.
- L3: `R/codex-host/codex-chat-host-ports.ts:295-302` logs user servers as "attached"; the Ptah
  attach (:327-336) is not logged.

Decisions (team-leader; reversible; recorded in decisions.md as P8 D14-D18):

- D14 (G6): 'ask' and 'auto-edit' -> approvalPolicy `untrusted` + sandbox workspace-write
  (writableRoots [cwd], network false). 'plan' and 'yolo' unchanged. Claude semantics: Manual
  asks before every non-read-only tool; acceptEdits auto-accepts edits but asks for Bash; plan
  never executes; bypass runs all. The Ptah policy already gives auto-edit its edit auto-accept.
- D15 (G1/G2/G3): the core passes real bounded results (output text, exit code, MCP error text,
  declined status) instead of the generic text; agent-sdk formats them into Claude's tool_result
  shape; Bash input is exactly Claude's {command, description?}; reasoning streams as
  thinking_delta from summary deltas and an empty reasoning item opens no thinking block.
- D16 (G5): `allowedDecisions` leaves the contract end to end (host payload, shared type, dead
  8c frontend readers). The Codex prompt is Claude's prompt; the host maps Claude's decision
  vocabulary (allow/always_allow/deny_with_message/deny), as today. No PERMISSION_AUTO_RESOLVED
  after a user answer.
- D17 (L1): Stop on a native turn sends `turn/interrupt` and keeps the context (Claude parity:
  the tab stays usable); the UI contract of the Stop spec is unchanged (cancelled ->
  aborted_streaming, prompt cancelled once). Close only when the interrupt fails or no terminal
  arrives (runtime 30 s timer); then the next send / `/compact` resumes.
- D18 (G4): Codex `requestUserInput` uses Claude's AskUserQuestion flow and contracts (same
  service instance, request/response/auto-resolved messages, pending-questions replay, abort).

Risks:

| Risk | Severity | Mitigation |
| --- | --- | --- |
| After approval an `untrusted` command may still run in the workspace-write sandbox; network or out-of-workspace writes then fail and Codex may ask a second time | MEDIUM | 8m-1 documents it; the coordinator's live re-test (scenario b, plain prompt) checks it; harness `policy()` updated so the evidence harness can prove it |
| The fingerprint changes for 'ask'/'auto-edit'; threads created before 8m-1 may fail resume | MEDIUM | 8m-1 finds the resume comparison and pins the behavior (coded refusal or accepted, never a silent mismatch) |
| Real tool output can carry secrets (env dumps) | MEDIUM | 8m-2 bounds output size and keeps unknown payload shapes out; the same exposure Claude's Bash output has (parity) |
| Interrupt during an approval: bridge answers `cancel`, server terminal may not arrive | MEDIUM | 8m-5 keeps the existing 30 s runtime timer -> close -> next send resumes; spec |
| Removing `allowedDecisions` touches 3 projects; chat lint has pre-existing errors | LOW | 8m-6 compares lint with main; exception recorded (atomic contract removal) |
| AskUserQuestion answers are keyed by question text; Codex wants answers by question id | MEDIUM | 8m-7 maps both ways with a spec; duplicate question texts are disambiguated |

Assumptions:

- Codex App Server accepts `approvalPolicy: "untrusted"` with `approvalsReviewer: "user"` on
  thread/start and turn/start (schema yes; live proof by the coordinator with the harness).
- The Claude reference shapes for a failed Bash / denied tool are taken from
  `SdkMessageTransformer` and the Claude permission deny text (8m-4 reads them, no guessing).

Edge cases: failed command with empty output (exit code only); declined vs interrupted vs
failed status; MCP error with structured content; reasoning item with summary deltas then a
different final text; empty reasoning; Stop with no active turn; Stop while opening; question
with `isOther`/`isSecret`; question aborted by Stop; webview not delivered -> auto-pick.

### Wave 1 (3 lanes in parallel; file-disjoint)

### Batch 8m-1: Manual-mode approvals before execution (G6, highest priority) — COMPLETE (commit 3fe884270; verify 4 green 2026-10-28 16:25: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/rpc-handlers` 6/6 tasks; `-t typecheck -p @ptah-extension/agent-sdk` 1/1; Wave 1; lane: codex, agent 82984c64, CLI session 01a18323-a5a9-7ca2-975e-2f6b0a5e3b05; 6m 32s; diff reviewed on disk; scope added C/codex-runtime.ts for the resume fingerprint pin)

- Result: D14 in the profile and harness `policy()`; resume with a changed fingerprint -> named, logged `CodexResumeProfileChangedError` (code `resume-profile-changed`) before spawn; specs for profile per level, thread/turn frames, resume refusal, pre-start file/command Allow/Deny.
- Verify 1 (2026-10-28 15:50, `-p codex-runtime,rpc-handlers`): FAILED 3/6 — (1) `tools/evidence-harness.ts:1015` TS2322, the harness `ApprovalPolicy` type lacks 'untrusted' (also blocks evidence-harness.spec, evidence-cases-round.spec, codex-execution-profile.spec); (2) `R/codex-host/codex-chat-native-contract.spec.ts:811` the 4 pre-start approval cases time out at 5 s. 8m-2/8m-3 parts green (codex-runtime 688/688 of compiled suites; rpc-handlers 4995 pass, only these 4 fail).
- Fix round 1: codex resume (agent 2edcf452) started a fresh lane on model `gpt-6.1-terra` from `agentOrchestration.codexModel` -> `model_not_found` for the ChatGPT account, exit 1 after 4 s, no work. Fallback (coordinator-approved; other family, same capability): Glm ptah-cli opus, agent 18224cc8, report `batch-8m-1-fix-report.md`. User settings not edited.
- Fix round 1 result (Glm agent 18224cc8, CLI session 44d17a59-173c-4750-b06d-59a0721baaf5, 8m 4s; `batch-8m-1-fix-report.md`): harness `ApprovalPolicy` gains 'untrusted'; `evidence-harness.spec`/`evidence-cases-round.spec` expectations follow D14 (no level uses granular any more); the pre-start spec waited for a `message_start` that is only synthesized with the first item event -> it now waits for the turn start; its deny cases send `deny_with_message` (-> Codex `decline`, turn continues). Team-leader check: Deny button sends `deny` (permission-request-card.component.ts:128); Claude `deny` = `interrupt: true` and `deny_with_message` = `interrupt: false` (sdk-permission-handler.ts:1059-1114); host `deny`->`cancel`, `deny_with_message`->`decline` is parity, pre-existing, no fix. Minor gap recorded: no pre-start plain-deny -> cancel case (8m-5 owns interrupt).
- Verify 2 (2026-10-28 16:04, `-p codex-runtime,rpc-handlers`): 5/6 green; codex-runtime:test FAILED — every round-7a case in `tools/evidence-cases-round.spec.ts` throws 'Effective config differs from bounded profile': `tools/evidence-cases-round.ts:173` (override `sandbox_mode=\"read-only\"`) and `:418` (config check) still hard-code the old ask sandbox. Fix round 2: Glm (fresh lane with handoff brief, agent 05249472), scope `evidence-cases-round.ts` + its spec. Verify B (`-t typecheck -p agent-sdk`): green.
- Verify 3 (2026-10-28 16:15): 5/6 green; codex-runtime:test 922/925 — 3 fail in `tools/evidence-harness.spec.ts` 'ask-command-edit evidence flow' (marker-read / read-approval) with 'Unexpected command' (`evidence-harness.ts:1701`): under 'untrusted' a read command now requests approval, which the old granular+read-only flow never did. Fix round 2 (Glm 05249472, CLI session 45eaa266, 2m 9s) had aligned `evidence-cases-round.ts` :173/:418/:483-490 with `selected.sandbox` (verified). Fix round 3: Glm (fresh lane, handoff brief) agent 4d74c841, scope evidence-harness.ts + spec; identity gates must stay.
- Follow-ups (team-leader decisions): (a) `CodexChatAdapter.failure` wraps the refusal as runtime-failed and `ChatSessionService.codexFailure` shows CODEX_RUNTIME_FAILED 'Codex chat could not complete the operation.' -> the user-facing mapping moves to 8m-5 (owner of the adapter and `chat-session.service.ts` in Wave 2). (b) The harness accepts a file approval outside `policy()` only with `validatedFileItems`; pre-item-start requests may not fit -> p8g live-test checklist item.
- Fix round 3 result (Glm agent 4d74c841, CLI session ffb20c40-341b-4d76-8abf-fde6cdb1f786, 5m 42s): root cause was the tolerated marker-read gate (`evidence-harness.ts` ~:1817) requiring `selected.sandbox === 'read-only'`, so the marker read fell to the identity gate (~:1849, 'Unexpected command'). The gate now requires `approvalPolicy === 'untrusted'` with the same bounds (ask-command-edit only, one read, before the first approval, marker-read shape); the read approval keeps its identity checks and is always declined; note text 'untrusted ask: no approval request observed'; spec labels updated.
- p8g live-test checklist (coordinator): count Manual-mode approval prompts for plain read commands (untrusted may ask for reads outside Codex's known-safe list) and compare with Claude Manual.

- Files (declared deliverables): C/codex-execution-profile.ts, C/codex-execution-profile.spec.ts,
  C/codex-runtime.spec.ts (thread/start + turn/start frames),
  W/libs/backend/codex-runtime/tools/evidence-harness.ts (`policy()` mirrors the profile),
  C/codex-parity-gate.ts only if its proof notes name the old mapping,
  R/codex-host/codex-chat-native-contract.spec.ts (this wave's only writer of that file).
- Tasks: D14 mapping; find where `profileFingerprint` is compared on resume and pin it (coded
  refusal or accepted, never a silent mismatch); specs: profile per level (ask, auto-edit, plan,
  yolo), exact turn/start frame; end-to-end contract: in 'ask' a `item/fileChange/requestApproval`
  and a `item/commandExecution/requestApproval` arriving before the item starts each produce one
  PermissionRequest (passes the real parser); Allow -> accept, the item then runs; Deny -> the item
  is declined and never completes as success. MCP untouched.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/rpc-handlers`.

### Batch 8m-2: core passes real tool results and reasoning deltas (G1 core, G3 core) — COMPLETE (commit 41c73d47c; verify 4 green 2026-10-28 16:25: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/rpc-handlers` 6/6 tasks; `-t typecheck -p @ptah-extension/agent-sdk` 1/1; Wave 1; lane: Glm ptah-cli Ollama Cloud, opus tier, agent aa286ef2, CLI session 92a570f6-2ba7-49d7-bed9-7e6ec4cc9250; 12m 18s; diff reviewed on disk)

- Result: commandExecution forwards bounded `aggregatedOutput` + optional `exitCode`; mcpToolCall forwards result content (`_meta` dropped) + bounded `errorText`; dynamicToolCall forwards its content items; cap `MAX_TOOL_OUTPUT_CHARS` 10000 per string leaf with `\n[output truncated]`; retry/terminal errors stay sanitized. `item/reasoning/summaryTextDelta` / `textDelta` -> reasoning `delta` events (empty -> none; textDelta silent per item once a summary delta streamed); final reasoning still emitted (consumer contract for 8m-4: replace-on-final per itemId, in the batch report).
- Notes (Minor, recorded, not fixed): the two delta schemas are registered in `codex-protocol-validator.ts`, which shadows the `codex-protocol-methods.ts` export (every importer uses the validator; a pure move into methods is a later cleanup); `webSearch` results and `fileChange` diffs are not length-bounded (outside G1 scope); the bound is per string leaf, not per whole payload.

- Files: C/codex-event-translator.ts, C/codex-event-translator.spec.ts, C/codex-runtime.types.ts,
  C/codex-protocol-schemas.ts, C/codex-protocol-validator.ts (+ .spec.ts if the unmodeled list
  changes).
- Tasks: commandExecution completed/failed/declined -> real `aggregatedOutput` (bounded, cut
  marked), `exitCode`, status; mcpToolCall error -> the server's error text (bounded) and result
  content; dynamicToolCall failure -> its content items; declined -> status cancelled, no invented
  text; keep the unknown-item / unknown-notification rules (no arbitrary payload echo). Model
  `item/reasoning/summaryTextDelta` (and `textDelta` when no summary) -> `reasoning` phase delta;
  final reasoning still emitted. Specs per case. A new optional field on a runtime event must keep
  agent-sdk compiling (no consumer change in this batch).
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime` and
  `npm run verify -- -t typecheck -p @ptah-extension/agent-sdk`.

### Batch 8m-3: host prompt lifecycle and MCP logs (G5 host, L3, L2b check) — COMPLETE (commit d2f2fb2c5; verify 4 green 2026-10-28 16:25: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/rpc-handlers` 6/6 tasks; `-t typecheck -p @ptah-extension/agent-sdk` 1/1; Wave 1; lane: grok, agent 32155fda, CLI session 01a18324-2d6b-77d3-8d8c-66e3023e059f; 7m 59s; review fix 1 resumed as agent 0f8a906a)

- Result: no PERMISSION_AUTO_RESOLVED after a delivered user answer (wire id settled before `respond`; still one when dismissed without an answer or the answer cannot be delivered); `allowedDecisions` no longer sent; `ptah-mcp-attached` log with URL pathname only; user servers logged as `codex-user-mcp-configured`.
- Review fix 1 (team-leader): `R/session/chat-session.native.spec.ts:335` still asserted `codex-user-mcp-attached` -> scope extended to that spec, lane resumed (agent 0f8a906a, 40s): expectation now `codex-user-mcp-configured`; verified on disk, only that hunk changed.
- L2b deferred (not in this file): native sessions are named with the thread id because `createCodexChatMetadataPort` (`agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts:10-23`) drops the title and `updateCodexExecution` (`session-metadata-store.ts` ~:1030) sets `name: existing?.name ?? sessionId`; `messageCount` reads only Claude JSONL. Proposed: pass the title into `updateCodexExecution` without overwriting a user rename. Owner: follow-up batch (not in Round 8m scope).

- Files: R/codex-host/codex-chat-host-ports.ts, R/codex-host/codex-chat-host-ports.spec.ts.
- Tasks: no PERMISSION_AUTO_RESOLVED after a user answer (still sent when the answer cannot be
  delivered); stop sending `allowedDecisions` (D16; the shared field is removed in 8m-6); L3: log
  the Ptah attach with the URL path shape (`/session/{routingId}/workspace/...`, routing ids
  allowed, no secrets) under a coded `ptah-mcp-attached`, and user servers as "configured"
  (not attached/reachable); L2b: locate the sessions-rail preview source (read-only); fix only if
  the cause is in this file's native path, else record deferred in the report.
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers`.

### Wave 2 (after Wave 1 is committed; 3 lanes in parallel; file-disjoint)

### Batch 8m-4: Claude-shaped tool cards and thinking (G2, G1 projection, G3 projection, live L2) — COMPLETE (commit 38803702e; verify green 2026-10-28 16:58: `-p agent-sdk,rpc-handlers,ptah-electron` 15/15 after review fix 1 = Glm agent 6fd094a7, CLI session bdae7e2b: strip the output's trailing line breaks before the exit-code line; Wave 2; lane: Glm ptah-cli opus, agent 41d548ee, CLI session 5b1dbe4c-8c2a-422f-bd95-c8348d8c875f; 13m 18s; diff reviewed on disk)

- Result: Bash input = Claude `{command, description?}` (no `cwd`; approval card uses the same helper); `presentCodexToolResult`: cancelled -> Claude's hard-deny tool_result text, isError; failed / non-zero exit -> real output + 'Command failed with exit code N', isError; exit 0 unchanged; MCP error -> `errorText`, isError. Thinking: one thinking_delta per reasoning delta; final published once with source complete (replace-on-final: accumulator-core.service.ts:359-367 sets, never appends); empty reasoning opens no block; the callbacks drop empty content like Claude's stream (stream-event.transformer.ts:463, :503). Write/Edit/Read keep their current shapes (lane decision, accepted).
- Notes (Minor, recorded, not fixed): `CODEX_DENIED_TOOL_RESULT_TEXT` is an exact copy of the Claude CLI's canned hard-deny string (no repo constant exists; it lives in the CLI binary); every 'cancelled' item uses it, including a deny_with_message decline, a plan-mode policy decline and a Stop, where Claude would show 'Permission denied by user ... User's message: ...' for deny_with_message (card behavior identical: isError true).

- Depends on: 8m-2.
- Files: A/codex-tool-presentation.ts (+ .spec.ts), A/codex-chat-events.ts (+ .spec.ts),
  R/codex-host/codex-chat-event-callbacks.ts (+ .spec.ts). Exception: 6 files, 2 projects.
- Tasks: Bash input == Claude's (command, description) — no `cwd`, no "Arguments" section;
  Write/Edit/Read/MCP inputs checked the same way; a failed Bash tool_result == Claude's failed
  Bash (content text with exit code and stderr/stdout, `isError` true -> card not "Command
  succeeded"); a declined tool == Claude's denial result text; thinking_delta streamed per
  summary delta, no block for empty reasoning, final text not duplicated. Parity specs compare
  with the Claude path (`SdkMessageTransformer` in agent-sdk; Claude deny text from
  `sdk-permission-handler.ts`), not with hand-written shapes.
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`.

### Batch 8m-5: Stop interrupts the turn, the tab stays usable (L1) — COMPLETE (commit d82b252ba; verify green 2026-10-28 16:58: `-p agent-sdk,rpc-handlers,ptah-electron` 15/15; Wave 2; lane: codex, agent e62bf1cb; started 2026-10-28 16:27 UTC; scope adds R/session/chat-slash-command-router.service.ts + new .native.spec.ts only if /compact needs it; the mapping spec goes in R/session/chat-session.native.spec.ts (no chat-session.service.spec.ts exists); hold released 2026-10-28: coordinator "CODEX OK", the user set agentOrchestration.codexModel to a supported model; no lane model override (never gpt-6.1-*: bundled codex 0.155.1 rejects it))

- First pass (codex agent e62bf1cb, CLI session 01a18356-3b74-79b2-98d4-fd13de009e4c, 7m 54s; reviewed on disk): Stop interrupts the turn and keeps the native thread (`stopRequested`), closes only when the interrupt is refused/fails or the runtime's 30 s timer synthesizes a failed terminal; native `/compact` reopens an inactive stored thread with an empty prompt first; `resume-profile-changed` becomes a `CodexChatAdapterError` code and reaches the user as the 'Start a new chat' message (wire code stays CODEX_RUNTIME_FAILED).
- Team-leader decisions: (1) the message is enough for D14a; a distinct shared error code is deferred (Minor, no shared change). (2) CONFIRMED defect: `/clear` (`chat-slash-command-router.service.ts:230-231`) relied on `interruptSession` closing the native context; after D17 it no longer does, so the next send would continue the cleared Codex thread -> review fix 1 (codex resume, fresh lane with handoff brief, agent 1e2431e3): explicit awaited native close on /clear (Claude path unchanged) + specs; also `instanceof CodexResumeProfileChangedError` instead of name/code duck-typing where the index exports it.
- Review fix 1 result (codex, fresh lane with handoff brief, agent 1e2431e3, CLI session 01a1835e-227c-7c93-9c09-700ec69b74e9, 5m 14s): native `/clear` (router :231-243) interrupts an active turn, then in `finally` awaits the new `CodexChatAdapter.closeSession` (cancels an opening, closes the context), then broadcasts clear; Claude `/clear` keeps its interrupt path; the router injects `SDK_TOKENS.CODEX_CHAT_ADAPTER` optionally (registered in agent-sdk `codex-runtime-composition.ts`). Specs: router native idle/busy + Claude path, adapter awaited close. `CodexResumeProfileChangedError` is not exported from the codex-runtime index, so the name/code check stays (Minor, recorded; an index export would add a public API).
- Parity gap found (coordinator check, P8 re-review / P14): 'Deny with message' -> host maps to `decline` and passes `reason` (`codex-chat-host-ports.ts:537`), the sink accepts it (`codex-chat-approval-sink.ts:29`), but the approval bridge never sends a user reason to Codex (its only `reason` is read from the server's request params, `codex-approval-bridge.ts:188`). The typed reason never reaches the Codex model; Claude passes it (`sdk-permission-handler.ts:1059-1073`). Not fixed in Round 8m. p8g live-test item: 'Deny with message: the model's next reply reflects the typed reason' (expected to fail today).

- Files: A/codex-chat-adapter.ts (+ .spec.ts), A/codex-chat-turn-stream.ts, R/session/chat-session.service.ts (+ .spec.ts; added after 8m-1: map `resume-profile-changed` to a clear coded refusal, not CODEX_RUNTIME_FAILED),
  A/codex-chat-turn-lifecycle.spec.ts, R/codex-host/codex-chat-native-contract.spec.ts (this
  wave's only writer).
- Tasks: D17; update the 8k-5 Stop spec (no `context.close`, bridge `cancel`, same UI events);
  new specs: after Stop during approval a plain follow-up and native `/compact` succeed on the
  same thread; Stop with no active turn; interrupt failure / no terminal -> close -> next send
  and `/compact` resume (no CODEX_UNAVAILABLE).
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`.

### Batch 8m-6: `allowedDecisions` leaves the shared contract (G5 shared/frontend) — COMPLETE (commit f7a6a31dd; verify 2026-10-28 16:46-16:48: `-p shared,chat-streaming,chat` 8/9 (chat:lint 2 pre-existing errors, exception recorded), `-t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` 4/4; lint exception: `chat:lint` 2 pre-existing errors, `no-control-regex` chat-attention-source.service.ts (same line at HEAD :44 and main :27) and `no-useless-escape` attention-context.util.ts (untouched); none new; Wave 2; lane: grok, agent 0e7798d6, CLI session 01a18356-844f-73f3-8612-7d2c8dbb1ef6; 4m 16s; diff reviewed on disk)

- Result: `PermissionRequest.allowedDecisions` removed from libs/shared; dead native-decision paths removed: `APPROVAL_RESPONSE_DECISION` + `handleApprovalDecision` (permission-handler.service.ts), `APPROVAL_DECISION_ACTIONS` + allowed-filtered actions (chat-attention-source.service.ts), the native branch + 'cancel' action id (chat-attention-action-dispatcher.service.ts). Every permission request offers Claude's actions (Allow, Always allow, Deny, Deny with message). No caller left in libs/ or apps/ (grep); remaining `allowedDecisions` mentions are spec assertions that the real parser drops the wire field.

- Depends on: 8m-3 (host no longer sets the field).
- Files: libs/shared/src/lib/types/permission.types.ts; libs/frontend/chat-streaming/src/lib/
  permission-handler.service.ts (+ .spec.ts); libs/frontend/chat/src/lib/services/
  chat-attention-source.service.ts (+ .spec.ts), chat-attention-action-dispatcher.service.ts
  (+ .spec.ts). Exception: 3 projects, 7 files (one atomic contract removal).
- Tasks: remove the field and the dead 8c readers (native decision handling) with their specs;
  Claude prompt behavior unchanged (its specs stay green); no new Codex special case.
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/chat-streaming,@ptah-extension/chat`
  (chat lint compared with main: pre-existing lazy-load import errors) and
  `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.

### Wave 3 (after Wave 2 is committed)

### Batch 8m-7: Codex questions use Claude's AskUserQuestion flow (G4, mcpElicitation check) — COMPLETE (commit 1096bf516; verify 2026-10-28 green: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron` 3 projects + 6 deps EXIT 0; team-leader fixes before commit: SDK CanUseTool needs `requestId` and returns `PermissionResult | null` (codex-chat-user-questions.ts), specs imported agent-sdk by relative path (@nx/enforce-module-boundaries) -> agent-sdk now exports AskUserQuestionService, PendingResponseRegistry, ASK_USER_QUESTION_IDLE_TIMEOUT_MS; G4 completes with the bridge timeout fix in 8m-9 (df8cfb638); Wave 3; lane: codex, agent 91cbba59, CLI session 01a18375-2ffb-7143-b268-922b5a4d2a44, 7m 33s; diff reviewed on disk; started 2026-10-28 17:00 UTC; the bridge already forwards the runtime option (codex-runtime.ts:392 -> codex-approval-bridge.ts:339), so G4 is host wiring; must NOT edit C/codex-approval-bridge.ts — owned by 8m-9 in Wave 3; report a needed bridge change instead)

- Result: new `R/codex-host/codex-chat-user-questions.ts` maps Codex `requestUserInput` (id, header, question, options, isOther, isSecret) to Claude's AskUserQuestion through `SdkPermissionHandler.createCallback('AskUserQuestion')` (the same AskUserQuestionService, registry, replay, host attention, idle auto-pick); answers map back by question id; duplicate texts get a suffix; abort -> empty answers, registry cleared; secret questions offer no options (nothing auto-picked or logged). Electron wires it as the runtime's `requestUserInput` (`apps/ptah-electron/src/di/codex-runtime-composition.ts:404`); the rpc-handlers barrel exports it; no DI token/RPC added, so the guard specs are unchanged. The gateway registration (`gateway-chat-bridge/codex-gateway-adapter.ts:58`) stays unwired (P9). VS Code/CLI/TUI construct no CodexRuntime.
- Team-leader decisions: (1) the bridge's `DEFAULT_APPROVAL_TIMEOUT_MS` 240 s (`codex-approval-bridge.ts:29`, :349) also bounds user-input requests and fires before Claude's 300 s `ASK_USER_QUESTION_IDLE_TIMEOUT_MS` auto-pick (`ask-user-question.service.ts:29`) -> fix in Round 8m: `userInput` requests get a bridge timeout longer than 300 s, so Claude's auto-pick answers first (the bridge timer stays a backstop); owner 8m-9 (resume after its own work). (2) MCP elicitation form/URL UI and masked secret input -> P14 parity gaps, not Round 8m: Ptah's Claude path has no elicitation handler or form UI (only exported `OnElicitation` types) and Claude's question card has no secret mode (`question-card.component.ts:202`), so there is no Claude contract to match; building one is a new shared UI contract. Today Codex elicitations show as a permission card and accept only a synthesized default (`codex-approval-bridge.ts:365-369`); the adapter never logs secret answers.

- Files: new R/codex-host/codex-chat-user-questions.ts (+ .spec.ts),
  W/apps/ptah-electron/src/di/codex-runtime-composition.ts, R/codex-host/codex-chat-native-contract.spec.ts;
  DI guard specs (container.smoke.spec.ts, expected-resolvable.ts, rpc-surface.spec.ts,
  surface-composition.spec.ts) only if a service/RPC is registered.
- Tasks: D18; the runtime option `requestUserInput` is wired in Electron; map Codex questions
  (id, header, question, options, isOther, isSecret) to AskUserQuestionRequest through the SAME
  AskUserQuestionService instance (ASK_USER_QUESTION_REQUEST / RESPONSE / AUTO_RESOLVED,
  pending-questions replay, host attention) and answers back by question id; abort/Stop ->
  registry cleared, bridge `cancel`; idle/undelivered -> Claude's auto-pick; check
  `mcpServer/elicitation/request` against Claude's elicitation path; fix or record deferred.
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron`.

### Batch 8m-8: native sessions rail keeps a real title and count (L2b backend) — COMPLETE (commit 10581f566; verify green with 8m-7 (same command); continuation 2026-10-28 18:19 UTC by the fresh team-leader: codex agent d71a34ef, new CLI session 01a183bc-d92d-7b91-8f8e-21d83930d999 (resume of 01a18380 fell back to a fresh lane with a handoff brief; full brief given), 4m 53s; team-leader review fixes: (1) Electron production built its own inline metadata port that dropped the title and had no completedTurn -> Electron now uses the shared createCodexChatMetadataPort (exported from agent-sdk) and ElectronCodexIdentityLookup gains incrementCodexMessageCount; (2) a rejected count write blocked callbacks.result -> caught and logged `message-count-write-failed`, spec added; (3) register.codex-runtime.spec.ts now asserts the title; (4) session-rpc spec imported SessionId as a type; count = +2 per completed turn, matches Claude's JSONL counter (user record + first assistant reply); scope widened to session-runtime-identity-cache.ts (title passthrough), codex-chat-adapter.ts / codex-chat-turn-stream.ts (completed-turn count writer) and session-rpc.handlers.ts (native count reader); earlier lane: codex, agent a66a2694, started 2026-10-28 17:13 UTC (fallback); first lane Glm agent f95b125b exited NO-DELIVERABLE after 11m 25s: Ollama Cloud 429 'session usage limit' (Glm AT LIMIT, reset unknown; skip Glm for the rest of this round); it left a partial non-compiling edit in session-metadata-store.ts (`codexSessionName` called, never defined) that the codex lane reviews and completes; added 2026-10-28 by coordinator decision)

- Depends on: 8m-5 (owns `A/codex-chat-adapter.ts` `persistMetadata` in Wave 2; 8m-8 reads it, does not edit it).
- Cause (8m-3 report): `W/libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts:10-23` ignores the title that `CodexChatAdapter.persistMetadata` passes; `updateCodexExecution` (`W/libs/backend/agent-sdk/src/lib/session-metadata-store.ts` ~:1030) sets `name: existing?.name ?? sessionId`, so the rail shows the thread id; `messageCount` in `session:list` comes only from Claude JSONL (`W/libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts`; `session-rpc.handlers.ts` ~:497-554), so native rows stay at 0.
- Files: the metadata port (+ new .spec.ts), `session-metadata-store.ts` (+ `session-metadata-store.spec.ts`), `session-message-count.ts` (+ .spec.ts); `session-rpc.handlers.ts` only if the native count source cannot live behind the count helper. Exception: up to 7 files, 2 projects.
- Tasks: keep the native title (non-empty title sets the name when the stored name is missing or equals the session id; never overwrite a user rename); a native message count/preview source that does not read Claude JSONL (e.g. counted turns recorded in the session record, or the rollout), backend only, no frontend special case; Claude rows unchanged (their specs stay green).
- File-disjoint from 8m-7 (codex-host user questions, Electron composition, native contract spec, DI guard specs): yes, so both run in parallel in Wave 3.
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`.
### Batch 8m-9: Deny with message reaches the Codex model (deny-reason parity) — COMPLETE (commit df8cfb638; verify 2026-10-28 green: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge` 9/9 tasks EXIT 0 (948 / 2705 / 133 tests); extras reviewed by the fresh team-leader and accepted: typed carrier (narrowed by the team-leader to a union: edit marker XOR denialReason), userInput backstop 330 s > 300 s idle auto-pick, elicitation rules (url / openai form modes / forms needing typed values -> immediate decline + `codex-elicitation-unanswerable`, no card; tool-approval forms keep the card; content only const/default + approve grant; checked against the pinned schema oneOf and the harness tool-approval fixture `persist` optional enum); team-leader spec fixes: untyped jest.fn question mocks (TS2493) and the older "does not remember an MCP grant" spec updated to the new decline-without-card contract; constructor guard `USER_INPUT_BACKSTOP_MS <= HOST_QUESTION_IDLE_TIMEOUT_MS` compares constants (Minor, recorded); lane: grok, agent d9267c1a, CLI session 01a18375-c8d6-7dd1-b151-d0a624741931, 11m 18s; D19 reviewed: no reason field on the v2 approval responses or TurnSteerParams (schema :2873-2884, :25233-25262; strictObject boundary), so decline is sent unchanged, then `turn/steer` with Claude-like wording on the same turn, coded warning `codex-denial-feedback-undelivered` on failure; continuation resumed 2026-10-28 17:14: typed denialReason carrier instead of the edit marker, userInput timeout > 300 s, elicitation rules; added by coordinator decision P8 D19)

- Gap (found in 8m-5 review): host maps `deny_with_message` -> `decline` and passes `reason` (`R/codex-host/codex-chat-host-ports.ts:537`), the sink accepts it (`A/codex-chat-approval-sink.ts:29`), but `C/codex-approval-bridge.ts` never sends a user reason to Codex (its only `reason` is the server's request param, :188). Claude passes the typed reason to the model (`sdk-permission-handler.ts:1059-1073`).
- Approach (D19, in order): (1) native: a reason/message field on the command/file approval decline response or on the turn APIs in the pinned App Server schema; (2) else deliver the typed reason to the model after the decline on the same thread/turn through a native path (`turn/steer` or the next input item), so the next reply reflects it. No frontend change, no second proxy.
- Files: C/codex-approval-bridge.ts (+ .spec.ts); R/codex-host/codex-chat-host-ports.ts (+ .spec.ts) only if needed; C/codex-runtime.ts (+ spec) only if the steer path needs a runtime method. File ownership in Wave 3: 8m-9 owns `codex-approval-bridge.ts`; 8m-7 must not edit it (it reports any bridge change it needs) -> 8m-7, 8m-8, 8m-9 are file-disjoint and run in parallel.
- Specs: the typed reason reaches the Codex request; plain Deny unchanged (`cancel`); Allow unchanged; empty reason sends nothing extra.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/rpc-handlers`.
- p8g live-test item: 'Deny with message: the model's next reply reflects the typed reason'.
- Follow-up for the 8m-9 resume (after its D19 work; the bridge owner): (a) `userInput` requests get a bridge timeout above Claude's 300 s `ASK_USER_QUESTION_IDLE_TIMEOUT_MS` so the auto-pick answers first (8m-7 decision 1). (b) Elicitation (coordinator check): today `mcpServer/elicitation/request` takes the normal approval path (policy -> Claude permission card -> 240 s backstop; accept -> `{action:'accept', content: formContent(params)}`, else decline / cancel on abort, `codex-approval-bridge.ts:365-369`); it is never an unknown request or a process kill. Codex uses it for MCP tool-call approvals (spike-run-6i), so an immediate decline for all elicitations would break MCP (D8). Defect: when `formContent` cannot produce content (url mode or a form needing user values) the user still sees a card and Allow still returns decline -> decline those immediately with a coded log and no card (Claude has no elicitation handler, its SDK declines); tool-approval elicitations keep the card. Specs for both. Coordinator addition: `formContent` may only send content that represents the approval itself or schema-declared defaults/consts, never invented values for user-facing fields; anything else counts as "cannot answer" -> immediate decline. Specs: tool-approval elicitation (card, accept/decline), url mode (decline, no card), form needing user input (decline, no card), plus the userInput timeout > 300 s.
### Batch 8m-10: D14 applies to native main chat only; CLI lanes keep the settled policy — COMPLETE (commit 65def9e96; verify green with 8m-9 (same command; cli-agent-runtime 2705 passed incl. codex-lane-profile.spec.ts); lane: grok, agent 2b38c10e, CLI session 01a183bd-0cc2-7711-8425-c230e3efcfc0, 4m 0s, started 2026-10-28 18:19 UTC; diff reviewed on disk: non-chat consumers restore the exact pre-8m-1 mapping from 3fe884270 (ask granular + read-only, auto-edit on-request + workspace-write); codex-lane-profile.ts/.spec.ts unchanged (they already expected the pre-8m-1 lane behavior); added 2026-10-28 by coordinator after CI on c7367c036; planned lane: grok after its 8m-9 continuation; Glm AT LIMIT)

- CI regression (PR #823, test shard 4/4): `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts` fails 'delegates auto-edit to the settled core policy' (:239, expected 'on-request', received 'untrusted') and 'retains suppression and Ptah attachment in public core settings'. Cause: `buildCodexLaneProfileSettings` (`codex-lane-profile.ts` :96 `consumer: 'lane'`) uses the shared `buildCodexExecutionProfile`, so D14 (8m-1, 3fe884270) also changed headless lanes, where nobody answers approvals. Missed because the 8m-1 verify scope lacked cli-agent-runtime. Behavior regression; the lane spec is right.
- Fix (team-leader): the profile already carries `consumer` ('chat' | 'gateway' | 'lane' | 'usage', `C/codex-execution-profile.ts:19`). D14 'untrusted' + workspace-write applies only to `consumer === 'chat'`; every other consumer keeps the settled pre-8m-1 mapping ('ask' -> granular approvals + read-only; 'auto-edit'/'yolo' -> on-request + workspace-write; 'plan' unchanged). No lane-side override. Evidence harness `policy()` mirrors the chat profile (unchanged). Fingerprint: chat unchanged vs 8m-1; lane/gateway fingerprints return to their pre-8m-1 values.
- Files: C/codex-execution-profile.ts (+ spec); `codex-lane-profile.ts` (+ spec) only if the lane spec needs nothing but the restored core policy (expected: no lane change). File-disjoint from 8m-8 (metadata) and 8m-9 (bridge/runtime/sink).
- Specs: lane auto-edit stays on-request + workspace-write; lane ask stays granular + read-only; chat ask/auto-edit stay untrusted + workspace-write; gateway follows the settled mapping (D14 was decided for main chat only).
- Verify (scope rule from now on: every codex-runtime change also runs cli-agent-runtime, plus gateway-chat-bridge when it consumes the profile): `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge`.
### Round 8m follow-ups (Minor, recorded, no lane)

- `tools/evidence-harness.ts` compares `realpathSync(manifest.binaryPath)` with the resolved binary before the digest checks, so a harness run from another checkout fails; the digest already identifies the binary (CodeRabbit on PR #839, revisited in #823). Fix later: drop the path comparison, keep the platform/arch/binary digest and schema digest checks.
- `CodexResumeProfileChangedError` is not exported from the codex-runtime index; agent-sdk and rpc-handlers detect it by name/code (8m-5).
- A distinct shared wire code for `resume-profile-changed` (today CODEX_RUNTIME_FAILED with the 'Start a new chat' message) (8m-5).
- 8m-2: reasoning delta schemas registered in the validator (shadowing the methods export); webSearch/fileChange outputs unbounded; cap per string leaf.
- 8m-4: every 'cancelled' item uses Claude's hard-deny text, including deny_with_message declines (Claude shows 'Permission denied by user ...').
- 8m-8: `CodexChatMetadataPort.completedTurn` is optional only so older spec fakes compile; make it required and update the fakes (codex-chat-turn-lifecycle.spec.ts, chat-session.native.spec.ts, codex-chat-native-contract.spec.ts, codex-chat-host-ports.spec.ts).
- 8m-8: the native count is +2 per completed turn; a turn whose reply is only a tool call still counts 2 (Claude counts the first assistant record of each reply). Recheck in the p8g live test.
- 8m-9: the bridge constructor guard `USER_INPUT_BACKSTOP_MS <= HOST_QUESTION_IDLE_TIMEOUT_MS` compares two constants; replace with a spec that pins backstop > 300 s (codex-runtime cannot import agent-sdk's constant).
- 8m-7/8m-8: new agent-sdk barrel exports (AskUserQuestionService, PendingResponseRegistry, ASK_USER_QUESTION_IDLE_TIMEOUT_MS, createCodexChatMetadataPort) are public API for the P8 re-review (code-style).

### Round 8m closing checks (Round 8m phase gate) — PASSED 2026-10-28 18:49 UTC on 65def9e96

- `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint --output-style=static` — EXIT 0 (every project at or under baseline; cli-agent-runtime baseline 1 is stale, "run --update-baseline to prune", not a failure)
- `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint` — EXIT 0
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` — EXIT 0 (4 tasks)
- `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress` — EXIT 0 (1 task)
- Phase code review: the Round 8m combined diff goes to the P8 re-review (HANDOFF next step 8), not reviewed by a second family in this round.

---

# Phase P9 — Gateway consumer (@ptah-extension/gateway-chat-bridge)

Phase review: code-logic. Implementer: Codex; reviewer: Claude. Verification:
`npm run verify -- -p @ptah-extension/gateway-chat-bridge`.
Prefix G = W/libs/backend/gateway-chat-bridge/src/lib/.

## Batch 9a: Gateway adapter and approval sink — COMPLETE (merged in #809)

## Batch 9b: Gateway profile and bridge integration — SUPERSEDED by Round P9

- Files: CREATE G+codex-gateway-profile.ts and spec, G+gateway-chat-bridge.native.spec.ts; MODIFY
  G+gateway-chat-bridge.ts (native branch only; re-locate anchors), G+di/register.ts,
  W/libs/backend/gateway-chat-bridge/src/index.ts
- Details: no legacy new-session fallback on ambiguous native resume; Claude gateway unchanged;
  native branch gated off (the DS1 dev override does NOT cover gateway). Note:
  `codex-gateway-adapter.ts:23,52` constructs `new CodexParityGate()` directly instead of the
  gated resolver — record for the P9 review (one gate per host); fix only if it fits the cap.
  Last P9 batch -> phase review.
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

## Round P9: gateway consumer (batch 9b re-plan) — COMPLETE except phase-review fixes (batch 9c) (decomposed session 25 at cd947b54c; supersedes the Batch 9b file list above)

Total tasks: 7 batches (9b-1..9b-7) | Complete: 0/7. Phase: P9. Phase review after 9b-7:
code-logic (Claude `code-logic-reviewer`, different family from the Codex/grok implementers) on
the combined diff (parent of the 9b-1 commit to HEAD), plus code-style because 9b-1 adds public
contract fields. No per-batch review.

### Plan validation (re-located against the current code)

Status: PASSED WITH RISKS (2 items need a coordinator/user confirmation, see "Needs a decision").

Finding F1 (the reason for the re-plan): the gateway ALREADY reaches native Codex in dev, through
main chat, ungated as a gateway. `GatewayChatBridge` injects `TOKENS.AGENT_ADAPTER`
(gateway-chat-bridge.ts:225-247); `wireAgentAdapterAliases` resolves that token to
`RoutingAgentAdapter` when native is bound (agent-sdk di/register.ts:1107-1119, 1036-1060).
`RoutingAgentAdapter.startChatSession` sends any config to `CodexChatAdapter` when
`capabilities.nativeCodex` and the workspace provider is `openai-codex`
(routing-agent-adapter.ts:87-115), and Electron sets `nativeCodex` from the CHAT gate or the
DS1 dev override (apps/ptah-electron/src/di/codex-runtime-composition.ts:72-82). The native
adapter then opens with `consumer: 'chat'` (codex-chat-host-ports.ts:386; codex-chat-adapter.ts
:322, :352-356). So with `PTAH_CODEX_RUNTIME_DEV=1`, a gateway turn on a Codex workspace runs
native as "chat": (a) gated by the chat gate, not the gateway gate; (b) the D20 read-only
auto-accept applies (codex-chat-approval-sink.ts:120-146 checks only `permissionLevel === 'ask'`),
although D20 says "not gateways"; (c) the prompt is a routable-looking webview card with
`timeoutAt: request.expiresAt ?? 0` (codex-chat-host-ports.ts:436-475): no 60 s deny window, no
lifecycle event, so the gateway user never gets "waiting for approval" or "timed out" notices
(gateway-chat-bridge.ts:335-355 listens only to `SdkPermissionHandler.onPromptLifecycle`);
(d) a failed native resume falls back to a NEW session (gateway-chat-bridge.ts:816-845 and
`tryFallbackStart` :936-989), including on the typed D14a refusal; (e) `prepareTurn` resolves the
Claude provider profile first (gateway-chat-bridge.ts:688-697 ->
`resolveProviderProfileForWorkspace`, auth-providers workspace-provider-profile-resolver.ts:333),
which builds the path-A proxy profile for a Codex workspace even when the turn then runs native.

Finding F2: `CodexGatewayAdapter` and `CodexGatewayApprovalSink` (Batch 9a, #809) are not wired
anywhere (no import outside their own files and specs; not exported from
gateway-chat-bridge/src/index.ts:7-11). They duplicate what main chat now owns: event projection
(codex-gateway-adapter.ts:168-291 vs agent-sdk codex-chat-turn-stream/events), profile, MCP,
resume fingerprint (D23), approval sink (D20), and they construct `new CodexParityGate()` directly
(:23, :52, :112) instead of the scope's gate.

Shared contract facts used below:
- `RuntimeConsumer = 'chat' | 'gateway' | 'lane'` already exists (shared
  session-runtime.types.ts:41) and `ExecutionProfileRequest.consumer` already flows into the
  native seed (workspace-provider-profile-resolver.ts:122, :260); only `chat` is ever passed
  (chat-runtime-profile.service.ts:134).
- `RuntimeHostCapabilities` has only `nativeCodex` (session-runtime.types.ts:37-39);
  `shouldStartNativeCodex` reads only it (workspace-provider-profile-resolver.ts:282-288).
- Execution profile: D14 (`untrusted` + workspace-write for ask/auto-edit) is chat-only; every
  other consumer keeps the pre-8m-1 mapping (ask = granular + READ-ONLY sandbox)
  (codex-execution-profile.ts:141-160, :250-258). The fingerprint excludes `consumer`
  (:283-292).
- The async question card is chat-only (codex-context.ts:404).
- DS1 dev override is chat-only by type (codex-dev-route.ts:1-21) and in the gated resolver
  (codex-runtime di/registration.ts:111-135).
- Claude gateway approvals (the parity target): the gateway tab id `gw-<conversationId>`
  (gateway-chat-bridge.ts:131-132, :429) is not a UUID, so the Claude permission callback gets
  no session and no tab (sdk-query-options-builder.ts:1214-1238) and the route is unroutable:
  broadcast card, 60 s deny window (`UNROUTABLE_PERMISSION_TIMEOUT_MS`,
  sdk-permission-handler.ts:90, :881-891, :903-943), lifecycle `requested` (routable false,
  timeoutMs) and `resolved` (`timed-out`) events (:936-943, :1018-1032) that the bridge turns into
  chat notices. A timeout resolves `deny` + `systemAbort` (:1280-1288) which reaches the model as
  "SYSTEM ABORT — not a user decision" with `interrupt: false` (:1083-1100). Only SAFE_TOOLS
  (Read, Grep, Glob, ...; permission-tool-classifier.ts:13-30) auto-approve at `ask`; Bash never.
  Gateway permission level comes from the gateway setting: ask (default), auto-edit, yolo; plan
  excluded (gateway-chat-bridge.ts:135-143, `resolvePermissionLevel` :882-891).
- Gateway `/new` exists: `GatewayCommandService` case 'new' clears the bound session
  (messaging-gateway gateway-command.service.ts:132, :284).
- Claude gateway Ptah MCP: `/session/{gw-id}` (sdk-query-options-builder.ts:2050-2060). Native
  host ports build `ptahMcpSessionUrl(PTAH_MCP_PORT, tabId ?? sessionId, cwd)` from
  codex-runtime (codex-chat-host-ports.ts:283-347; codex-ptah-mcp.ts:41-51) whenever
  `mcpServerRunning`; the gateway already passes `mcpServerRunning` and `tabId`.

### Decisions (team-leader, session 25, reversible unless marked)

- P9-1 Selection and gate. A gateway turn selects native Codex through the SAME main-chat path
  (`TOKENS.AGENT_ADAPTER` -> `RoutingAgentAdapter` -> `CodexChatAdapter` -> codex-chat-host-ports),
  marked by a new optional `consumer?: 'chat' | 'gateway'` on `AgentSessionStartConfig` and
  `AgentSessionResumeConfig` (shared agent-adapter.types.ts:177, :229; absent = chat). One gate
  per host and consumer: `RuntimeHostCapabilities.nativeCodexGateway?: boolean` (absent = false)
  is computed once in `createElectronCodexRouting` from the gateway parity gate OR the DS1 dev
  override; the auth-providers resolver, `RoutingAgentAdapter` and the gated resolver
  (`resolveGatedCodexRuntime(scope, consumer, platform)`, using the scope's `ParityGate` token)
  all read the consumer. With the gateway capability off, a Codex-workspace gateway turn stays on
  today's legacy path (routing choice, never a failure fallback). The bridge makes the one
  runtime decision (P7 fix 3): `prepareTurn` calls `resolveExecutionProfile({ consumer:
  'gateway', hostCapabilities })` instead of `resolveProviderProfileForWorkspace`, passes
  `runtime` + `consumer: 'gateway'` in the start config, and builds no provider profile (no
  proxy) for a native turn. Options rejected: wiring the 9a `CodexGatewayAdapter` as a parallel
  native branch (duplicates profile/MCP/resume/approval/projection, second gate instance);
  deriving "gateway" from the `gw-` tab prefix inside rpc-handlers (string coupling).
  NEEDS CONFIRMATION (R-P9-A below): DS1 (`PTAH_CODEX_RUNTIME_DEV=1`, unpackaged only) also
  covers the gateway consumer; lanes stay excluded.
- P9-2 Approval policy = Claude gateway parity. Permission level unchanged (gateway setting; ask
  default). Execution profile: the gateway consumer uses the D14 mapping, same as chat (ask and
  auto-edit = `untrusted` + workspace-write [cwd], network off; yolo unchanged), so an approved
  write runs as it does in a Claude gateway chat; the pre-8m-1 read-only `ask` mapping would make
  every approved write fail. Prompts: when the start/resume `tabId` is not a UUID (the Claude
  `TabId.safeParse` rule, no `gw-` knowledge), codex-chat-host-ports presents Claude's unroutable
  card shape (no session/tab routing fields, as `SdkPermissionHandler` sends for `gw-*`),
  `timeoutAt = now + 60_000`, and on expiry answers `decline` with Claude's system-abort reason
  through the existing D19 reason path (decline, never cancel: Claude's timeout is
  `interrupt: false`). It publishes `requested`/`resolved` lifecycle events on the SAME
  `SdkPermissionHandler` channel (new public `publishPromptLifecycle`), so the bridge's existing
  notices fire unchanged. No D20 read-only auto-accept for the gateway consumer (D20 "not
  gateways"; Claude gateway never auto-approves Bash). Always Allow / Deny / Deny with message map
  as in main chat (codex-chat-host-ports.ts:503-551). Main chat (UUID tabs) is byte-for-byte
  unchanged. The async question card (codex-context.ts:404) covers chat and gateway (same
  AskUserQuestionService, D18).
- P9-3 Resume. The bridge asks the runtime identity lookup
  (`SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP`, optional injection; `resolveSessionRuntimeIdentity`
  newly exported from agent-sdk) whether the bound session is native. For a native thread there is
  NO new-session fallback, neither on resume failure (gateway-chat-bridge.ts:816-845) nor in
  `tryFallbackStart` (:936-989); the turn fails with one reply and the binding is kept so the next
  message retries the resume. The typed D14a refusal (`isCodexResumeProfileChangedError` on the
  cause, or `isCodexChatAdapterError(e) && e.code === 'resume-profile-changed'`, as in
  chat-session.service.ts:620-640) replies with one gateway constant: "Codex cannot resume this
  thread because its execution profile has changed. Run /new to start a fresh session." No
  name/code string matching. The per-turn `endSessionAfterTurn` (:779-791) stays; each native
  gateway turn cold-resumes via `thread/resume` (Claude parity: resume from JSONL). Claude
  sessions keep today's fallback.
- P9-4 MCP (D8). No MCP code in P9: the native gateway thread gets Ptah MCP from the host ports
  exactly as chat does (`mcpServerRunning` + `tabId` routing id `gw-<id>`, URL from codex-runtime
  `ptahMcpSessionUrl`, D13 per-thread override wins over the harness-synced `ptah` entry). User
  MCP servers: the gateway passes no `mcpServersOverride` (as for Claude gateway); D24(4) GAP-3
  (`~/.claude.json` user+project servers) lands in P14 in the shared host ports and then covers
  gateway threads too. Specs pin that a gateway native start carries the `ptah` server. NEVER
  strip, revert or comment out MCP.
- P9-5 Out of bounds for P9: the Claude gateway path (legacy resume fallback, Claude permission
  handling and notices, `SdkPermissionHandler` behaviour — only an additive public publish
  method), every frontend/webview file (the native card reuses Claude's existing unroutable
  payload), libs/backend/messaging-gateway (commands, store, adapters), the parity-gate ledger
  (P14), lanes/cli-agent-runtime (P10; the lane consumer stays without DS1), the Codex harness
  sync (follow-up PR), TUI and VS Code feature work (hosts only keep compiling).
- P9-6 Delete the unwired 9a duplicates: `codex-gateway-adapter.ts`, `codex-gateway-adapter.spec.ts`,
  `codex-gateway-approval-sink.ts`, `codex-gateway-approval-sink.spec.ts` (replace, do not
  accumulate). This also retires the `new CodexParityGate()` note above. Reversible via git.

### Needs a decision (coordinator, user-reserved)

- R-P9-A DS1 scope: the earlier 9b note says "the DS1 dev override does NOT cover gateway". Today
  the gateway already rides DS1 silently as "chat" (F1). Options: (1, Recommended) DS1 covers chat
  and gateway (dev-only, unpackaged; gateway becomes live-testable in Electron for P14); (2)
  gateway gate-only: native gateway code is unreachable until the P14 ledger enables it, and dev
  gateway turns on a Codex workspace return to the legacy path. Batch 9b-3 implements (1); for
  (2) drop task 9b-3.1 and keep `consumer: 'chat'` in the override.
- R-P9-B Deleting the 9a gateway adapter/sink that merged in #809 (P9-6). Recommended; the only
  alternative is keeping dead code.

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Gateway native runs as "chat" today (F1 a-c): wrong gate, D20 auto-accept, no deny window | HIGH | 9b-3, 9b-4, 9b-5, 9b-6 |
| Silent new-session fallback over a native thread (F1 d), incl. D14a | HIGH | 9b-7 |
| Path-A proxy profile built for native gateway turns (F1 e; "no second proxy") | MEDIUM | 9b-1 (consumer-aware resolver), 9b-7 (prepareTurn) |
| Pre-8m-1 read-only `ask` mapping for gateway would fail approved writes | MEDIUM | 9b-2 |
| Shared contract change touches every host | MEDIUM | optional fields only; phase gate runs the 4 host typechecks |
| Parallel lanes in one worktree see each other's edits during verify | MEDIUM | implement in waves, verify and commit one batch at a time in number order |
| Per-turn cold resume spawns an App Server per gateway turn (latency) | LOW | parity with Claude; recorded, not changed |
| Unroutable deny window also hits any non-UUID main-chat tab id | LOW | main-chat tab ids are UUIDs (TabId.safeParse); spec pins a UUID tab keeps `timeoutAt: 0` |

Assumptions:
- Existing dev gateway threads opened as "chat" resume as gateway without a D14a refusal: the
  fingerprint excludes consumer and both consumers use D14 after 9b-2 — verified by a 9b-2 spec.
- `request.expiresAt` from the approval bridge is shorter than or absent next to the 60 s window
  — 9b-5 uses `min(expiresAt, now + 60_000)` and a spec covers both.
- Electron's IPC answers by wire id first to the Codex ports (ipc-bridge.ts:492-498), so a card
  without session/tab still resolves — verified by a 9b-5 spec on `handlePermissionResponse`.

Edge cases:
- Gateway capability off, workspace on Codex -> legacy path, no native code touched — 9b-4 spec.
- Prepared runtime `codex-app-server` with consumer gateway but only `nativeCodex` true ->
  `ChatRuntimeAdmissionError` — 9b-4 spec.
- Deny window fires after the user answered, or the turn ended first -> no second answer, timer
  cleared on every settle path — 9b-5 spec.
- Native resume fails with an untyped error -> one error reply, binding kept, no `startNew` — 9b-7.
- Watchdog-cancelled native turn -> still no fallback (existing cancellation rule) — 9b-7.

### Waves and executors

- Wave A (parallel, disjoint projects): 9b-1 (shared + auth-providers), 9b-2 (codex-runtime).
- Wave B (parallel implementation, verify+commit in order 9b-3 -> 9b-4 -> 9b-5): needs 9b-1, 9b-2.
- Wave C: 9b-6 (needs 9b-3, 9b-5), then 9b-7 (needs all). Then the phase review.
- Executors: CLI lane codex (model gpt-6-sol) or grok; never gpt-6.1-terra; Glm at limit. Fallback
  order: the other of codex/grok -> same family other model -> subagent (`backend-developer`).
  Reviewer: Claude `code-logic-reviewer` (+ `code-style-reviewer` for the new public fields).
- Lane rules to repeat in every prompt: workingDirectory = W; follow W\CLAUDE.md (verify only
  with the batch command below, under the FIFO lock, no build/serve/e2e, no workspace-wide runs,
  Electron first); no git; do not edit batches.md or task.md; never strip, revert or comment out
  MCP; report every touched absolute path.

## Batch 9b-1: Consumer contract (shared, auth-providers) — COMPLETE (commit: the "batch 9b-1" commit on this branch; review code-logic-review-9b-1.md APPROVE 8/10; verify PASS except known local-only Windows noise: auth-providers lint @nx/dependency-checks, translation-proxy.sdk.integration EPERM teardown x4; 9b-2..9b-7 ON HOLD for the p8j round)

- Recommended executor: CLI lane codex (gpt-6-sol) | Execution mode: sequential | Depends on: none
- Subagent reason: N/A | Review family: Claude (different) | Phase: P9
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/auth-providers`
  (known local-only auth-providers lint noise on Windows, see HANDOFF)
- Files: MODIFY W/libs/shared/src/lib/types/agent-adapter.types.ts,
  W/libs/shared/src/lib/types/session-runtime.types.ts,
  W/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts,
  W/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts

### Task 9b-1.1: `consumer?: 'chat' | 'gateway'` on start and resume configs — COMPLETE
- agent-adapter.types.ts:177 (`AgentSessionStartConfig`, next to `runtime?` :179) and :229
  (`AgentSessionResumeConfig`); JSDoc: absent = chat; Claude adapters ignore it.
### Task 9b-1.2: `nativeCodexGateway?: boolean` on `RuntimeHostCapabilities` — COMPLETE
- session-runtime.types.ts:37-39; absent = false; `nativeCodex` keeps meaning "chat".
### Task 9b-1.3: consumer-aware `shouldStartNativeCodex` — COMPLETE
- workspace-provider-profile-resolver.ts:282-288: chat -> `nativeCodex`; gateway ->
  `nativeCodexGateway === true`; lane -> false. Specs: gateway on/off x provider codex/claude;
  chat unchanged; lane never native; Claude branch result identical to today for gateway when off.

## Batch 9b-2: Gateway execution profile parity (codex-runtime) — COMPLETE (3a8bd572d)

- Recommended executor: CLI lane grok | Execution mode: sequential | Depends on: none
- Subagent reason: N/A | Review family: Claude | Phase: P9
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime`
- Files: MODIFY W/libs/backend/codex-runtime/src/lib/codex-execution-profile.ts and
  codex-execution-profile.spec.ts, W/libs/backend/codex-runtime/src/lib/codex-context.ts and the
  spec that covers `userInputAsync` (locate it; do not create a new spec file if one covers it)

### Task 9b-2.1: D14 mapping for the gateway consumer — COMPLETE
- codex-execution-profile.ts:141-160 and :250-258: `chat || gateway` gets D14; lane and usage
  keep the pre-8m-1 mapping. Update the comments. Specs: gateway ask/auto-edit/yolo policy and
  sandbox equal chat's; lane unchanged; the fingerprint of a gateway profile equals the chat
  profile with the same settings (assumption above).
### Task 9b-2.2: async question card for gateway — COMPLETE
- codex-context.ts:404: chat or gateway. Spec: gateway emits the card like chat; lane does not.

## Batch 9b-3: One gate per host for the gateway (codex-runtime, ptah-electron) — COMPLETE (fe9ef25ff)

- Recommended executor: CLI lane codex (gpt-6-sol) | Execution mode: sequential | Depends on: 9b-1, 9b-2
- Subagent reason: N/A | Review family: Claude | Phase: P9
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,ptah-electron`
- Files: MODIFY W/libs/backend/codex-runtime/src/lib/codex-dev-route.ts, codex-dev-route.spec.ts,
  W/libs/backend/codex-runtime/src/lib/di/registration.ts, di/registration.spec.ts,
  W/apps/ptah-electron/src/di/codex-runtime-composition.ts (`createElectronCodexRouting` only),
  W/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts

### Task 9b-3.1: DS1 covers chat and gateway (pending R-P9-A) — COMPLETE
- codex-dev-route.ts:1-21: the override lists the consumers it covers (`chat`, `gateway`); lane
  never; packaged builds always null. Grep every reader of the override's consumer field (apps and
  libs) and update it in this batch.
### Task 9b-3.2: gated resolver honours the consumer — COMPLETE
- registration.ts:111-135: the DS1 bypass applies when the override covers `consumer`; the warn
  names the consumer once per container. Specs: gateway with/without DS1; lane always refused.
### Task 9b-3.3: Electron capability per consumer — COMPLETE
- codex-runtime-composition.ts:72-82: `nativeCodexGateway` = gateway parity gate OR DS1 covers
  gateway; `nativeCodex` unchanged. Spec in codex-runtime-composition.spec.ts.

## Batch 9b-4: Consumer-aware native routing and sink (agent-sdk) — COMPLETE (0461b5dd4)

- Recommended executor: CLI lane codex (gpt-6-sol) | Execution mode: sequential | Depends on: 9b-1
- Subagent reason: N/A | Review family: Claude | Phase: P9
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`
- Files: MODIFY W/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts,
  routing-agent-adapter.spec.ts, codex-chat-adapter.ts, codex-chat-adapter.spec.ts,
  codex-chat-approval-sink.ts, codex-chat-approval-sink.spec.ts (same folder)

### Task 9b-4.1: RoutingAgentAdapter capability by consumer — COMPLETE
- routing-agent-adapter.ts:87-115: the capability is `nativeCodexGateway` when
  `config.consumer === 'gateway'`, else `nativeCodex`, for both the prepared-runtime check and
  admission. Resume/end/etc. keep routing by stored identity (:215-229). Specs: edge cases above.
  Review carry-over (code-logic-review-9b-1.md, Moderate 2): today the adapter gates on
  `nativeCodex` only (routing-agent-adapter.ts:94, :100, :112); all three sites must read the
  consumer.
### Task 9b-4.2: CodexChatAdapter consumer — COMPLETE
- codex-chat-adapter.ts: expected consumer = `config.consumer ?? 'chat'`; `prepareProfile`
  (:316-327) requires `prepared.profile.consumer` to equal it; `openContext` (:347-357) gates with
  it; `buildSink` (:420-480) enables read-only auto-accept only for chat. Specs: gateway open
  gated as gateway; mismatch -> `identity-mismatch`; chat unchanged.
### Task 9b-4.3: sink flag — COMPLETE
- codex-chat-approval-sink.ts:83-146: explicit constructor flag for the D20 auto-accept (default
  off); the classifier runs only when on. Specs: gateway ask + `Get-Content` shows the card; chat
  ask still auto-accepts (existing specs stay green).

## Batch 9b-5: Gateway consumer in host ports and unroutable prompts (rpc-handlers) — COMPLETE (ca6580906, e3ebac212)

- Recommended executor: CLI lane grok | Execution mode: sequential | Depends on: 9b-1
- Subagent reason: N/A | Review family: Claude | Phase: P9
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers`
- Files: MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts,
  chat-runtime-profile.service.spec.ts, W/libs/backend/rpc-handlers/src/lib/chat/codex-host/
  codex-chat-host-ports.ts, codex-chat-host-ports.spec.ts

### Task 9b-5.1: prepare() passes the consumer — COMPLETE
- chat-runtime-profile.service.ts:134: `config.consumer ?? 'chat'`. Spec.
### Task 9b-5.2: profile consumer — COMPLETE
- codex-chat-host-ports.ts:386: `consumer` from the config. Spec: gateway start carries the
  `ptah` MCP server with the `gw-` routing id when `mcpServerRunning` (P9-4).
### Task 9b-5.3: unroutable presentation with deny window and lifecycle — COMPLETE
- codex-chat-host-ports.ts:56 (deps: optional `promptLifecycle: { publish(event:
  PermissionPromptLifecycleEvent): void }`) and :436-475: non-UUID tab -> Claude's unroutable
  payload, `timeoutAt = min(expiresAt, now + 60_000)`, timer -> `decline` with Claude's
  system-abort reason via the D19 path, `requested`/`resolved` lifecycle (routingHint = raw tab
  id, routable false, timeoutMs, outcome allowed/denied/timed-out/aborted). Clear the timer on
  every settle path (answer, dismiss, cancelPrompt, delivery failure). UUID tab: unchanged
  (`timeoutAt` as today, no timer, no lifecycle). Specs per edge case above.

## Batch 9b-6: Lifecycle publish and Electron wiring (agent-sdk, ptah-electron) — COMPLETE (00c21292e)

- Recommended executor: CLI lane codex (gpt-6-sol) | Execution mode: sequential | Depends on: 9b-3, 9b-5
- Subagent reason: N/A | Review family: Claude | Phase: P9
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk,ptah-electron`
- Files: MODIFY W/libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts, its spec,
  W/libs/backend/agent-sdk/src/index.ts, W/apps/ptah-electron/src/di/codex-runtime-composition.ts,
  codex-runtime-composition.spec.ts

### Task 9b-6.1: `publishPromptLifecycle(event)` — COMPLETE
- sdk-permission-handler.ts:226-240: public method delegating to `emitLifecycle`; Claude
  behaviour unchanged. Spec: listener receives a published event; listener errors isolated as
  today.
### Task 9b-6.2: export `resolveSessionRuntimeIdentity` — COMPLETE
- agent-sdk index.ts near :169 (type already exported).
### Task 9b-6.3: Electron binds `promptLifecycle` — COMPLETE
- codex-runtime-composition.ts host deps (the `permissionHandler` resolve near :406): pass
  `{ publish: (e) => permissionHandler.publishPromptLifecycle(e) }`. Spec.
### Review carry-over before 9b-6 (code-logic-review-9b-1.md)
- Moderate 1: the resume guard in auth-providers workspace-provider-profile-resolver.ts:192
  refuses a native resume unless `hostCapabilities.nativeCodex`, for every consumer, so a gateway
  thread on a host with only `nativeCodexGateway` would be refused. Resolve before 9b-6 by making
  the guard consumer-aware (chat -> nativeCodex, gateway -> nativeCodexGateway, lane -> refuse)
  plus a gateway resume spec. That is an auth-providers change, so it goes in a small extra batch
  9b-5a (auth-providers only, verify `-p @ptah-extension/auth-providers`) rather than widening
  9b-6 to a third project. Rejected alternative: forcing `nativeCodexGateway` to imply
  `nativeCodex` in `createElectronCodexRouting` (couples the two gates).
- Minor: `ExecutionProfileRequest.consumer` stays required (:122); callers that read the optional
  config field add an explicit `?? 'chat'` at the boundary (9b-5.1 already does).

## Batch 9b-7: Gateway bridge consumer, resume and cleanup (gateway-chat-bridge) — COMPLETE (3a2d13f6c)

- Recommended executor: CLI lane codex (gpt-6-sol) | Execution mode: sequential | Depends on: 9b-1..9b-6
- Subagent reason: N/A | Review family: Claude | Phase: P9 (last batch -> phase review)
- Verify: `npm run verify -- -p @ptah-extension/gateway-chat-bridge`
- Files: MODIFY W/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts; CREATE
  W/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts; DELETE
  codex-gateway-adapter.ts, codex-gateway-adapter.spec.ts, codex-gateway-approval-sink.ts,
  codex-gateway-approval-sink.spec.ts (same folder). di/register.ts and src/index.ts need no
  change (verify; the deleted classes were never exported). Keep the codex-runtime and agent-sdk
  dependencies in package.json (used for the D14a guards).

### Task 9b-7.1: one runtime decision in prepareTurn — COMPLETE
- gateway-chat-bridge.ts:688-697: `resolveExecutionProfile({ workspacePath, requestedModel,
  consumer: 'gateway', hostCapabilities })` (inject `SDK_TOKENS.RUNTIME_HOST_CAPABILITIES`
  optional, default `{ nativeCodex: false }`); Claude result -> today's provider profile; native
  -> no provider profile. Keep `TURN_PREPARATION_DEADLINE_MS` and fail-closed AuthRequiredError.
### Task 9b-7.2: consumer and runtime on start/resume — COMPLETE
- `openStream`/`startNew` (:793-866): `consumer: 'gateway'` on start and resume; `runtime` on
  start. Claude-runtime configs otherwise unchanged (spec compares with today's shape).
### Task 9b-7.3: native resume without fallback; D14a reply — COMPLETE
- Inject `SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP` optional; native = stored runtime
  `codex-app-server`. Native: skip the fallback at :826-835 and in `tryFallbackStart`
  (:936-989); typed D14a -> the P9-3 constant via `sendError`, binding kept; other errors -> the
  existing error reply. Claude sessions keep the fallback (existing specs stay green).
### Task 9b-7.4: delete the 9a duplicates — COMPLETE
- P9-6 files; grep the repo for any reference first.
### Batch 9b-7 verification
- gateway-chat-bridge.native.spec.ts covers: gateway off -> legacy start with a provider
  profile; gateway on -> native start config (consumer, runtime, no provider profile, mcp flag,
  `gw-` tab); native resume failure -> no `startNew`, one reply, binding kept; D14a -> the /new
  message; zero-event native stream -> no fallback; permission notices still fire from a published
  lifecycle event with a `gw-` routing hint.

## Batch 9c: P9 phase-review fixes — COMPLETE (99a49b4e8, 9c-3 in the next commit)
Source: code-logic-review-p9.md (codex, REVISE 5/10) and code-style-review-p9.md (Kimi,
REVISE 6/10).
- 9c-1 (grok -> Kimi): logic 1 and 2. A failed native terminal and a divergent final text
  reach the gateway the same way as Claude's. Fix in agent-sdk `codex-chat-events.ts` only.
- 9c-2 (codex -> grok): logic 4 (a rejected approval reply publishes `aborted`); style 3
  (one shared legacy Claude identity factory in agent-sdk); style 4 (docs); style 5 (named
  sink options).
- 9c-3 (codex -> grok, after 9c-1/9c-2): style 1 and 2, behavior-preserving extraction of
  approval presentation from `createCodexChatHostPorts` and of gateway identity/native policy
  from `GatewayChatBridge.runTurn`.
- Logic 3 DISPUTED: a bound gateway session with no runtime metadata resolves to the legacy
  Claude identity. This is the same rule as the chat path (`storedChatRuntimeIdentity`).
  Native sessions always persist runtime metadata, so a missing row means a legacy Claude
  session.

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

## Round 8n: p8g live-test blocker (Codex initialize timeout) — COMPLETE (commit: the "batch 8n-1" commit on this branch)

Source: `live-test-p8g.md` GAP-1 (blocker) and GAP-2. The bundled 357 MB codex.exe 0.165.0 takes
12.6-13.6 s to start from D: on the user's machine, but the 10 s `initialize` timer was armed
right after spawn, so every Codex open failed.

### Batch 8n-1: initialize handshake budget and start-up diagnostics — COMPLETE

- Executor: codex CLI lane (gpt-6-sol), agent 617717de, session 01a18481-e58c-7ab3-bee7-24647d6947fc.
  Report: `batch-8n-1-report.md`.
- Task 8n-1.1 — COMPLETE: `codex-app-server-process.ts`: `INITIALIZE_TIMEOUT_MS = 60_000`
  (covers OS start-up), `REQUEST_TIMEOUT_MS = 30_000`. The pin check is computed once. One info
  log per successful start (`Codex process started`: binaryPath, pinnedVersion, pinStatus,
  startupDurationMs). On an initialize timeout, the existing `Codex process failure` log moves
  to warn and adds elapsedMs and timeoutMs to the bounded, redacted stderr tail.
- Task 8n-1.2 — COMPLETE: `codex-app-server-process.spec.ts`: a 15 s handshake succeeds; still
  pending at 59_999 ms, rejects at 60_000 ms with the same error; abort at 5 s rejects at once;
  env and Bearer values never logged.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,
  @ptah-extension/gateway-chat-bridge` PASS (9/9 tasks; tests: codex-runtime 956/956,
  cli-agent-runtime 2725 passed + 1 skipped, gateway-chat-bridge 133/133). No Electron file
  changed, so the host typecheck step does not apply.
- Review: `code-logic-review.md` § Batch 8n-1 — APPROVED 8/10 (implementer OpenAI, reviewer
  Anthropic). 0 Blocking, 0 Serious.
- Recorded, not fixed (fix-round rule; neither can break a lane config or lose data):
  M1 stderr tail now at warn, relies on pattern redaction (`codex-app-server-process.ts:557-565`);
  M2 a throwing logger in the start log would fail a healthy start (`:247-252`);
  m1 `Date.now()` instead of the Clock port; m3 no spec that a failed start emits no start log
  or that non-initialize timeouts stay at debug.
- Open: a live Electron re-run (p8h) must confirm a Codex open succeeds on the bundled binary.

## Round 8o: p8h backend gaps (A, B, C, E, F, H) — COMPLETE (phase gate not run, session wrap-up)

Source: `live-test-p8h.md` (head d6602359e). Principle: native Codex chat produces exactly
Claude's UI contracts; fixes only in codex-runtime -> agent-sdk codex-app-server ->
rpc-handlers codex-host; no frontend Codex special case; no second proxy; MCP untouched.
Team-leader session 23 is the only committing agent. Phase = the whole round (one phase gate).

### Plan validation — PASSED WITH RISKS (root causes confirmed in code before assignment)

- B (CONFIRMED): `session-metadata-store.ts` `updateCodexExecution` writes the detail
  `workspaceId: execution.workspaceId`, the Codex KEY (`normalizeCodexWorkspaceKey`: win32
  `/`-separated and fully lowercased). The SQLite repository derives `workspace_key` with
  platform-core `normalizeWorkspaceRoot(workspacePath)` (drive letter lowercased only), and
  `listForWorkspace` queries the same function of the caller path, so a mixed-case Windows path
  never matches a Codex row. Claude rows store the caller path. Fix: the detail row keeps the
  caller's workspace path (the profile path the port passes as `identity.workspaceId`);
  `codexExecution.workspaceId` stays the normalized key (identity contract unchanged).
- C (CONFIRMED): `codex-chat-adapter.ts:356-360` passes `config.sessionTitle ?? config.sessionName`;
  `chat:start` sends the tab title as `config.name` (`chat-session.service.ts:1066`; p8h log
  `sessionName: "Before you answer, ask me whether I…"`). Claude uses
  `sessionName ?? name` (`sdk-agent-adapter.ts:992-1001`). The store placeholder rule
  (`codexSessionName`) is correct. Fix in the adapter only.
- E (CONFIRMED, three causes; rollout `rollout-2026-10-29T01-28-25-01a184a0-...jsonl`):
  (1) In default collaboration mode 0.165.0 offers `request_user_input_async`, not the blocking
  `request_user_input`: the question arrives as an `agentMessage` item with `delivery: "async"`
  and `questions: [{title, options}]` (schema `AsyncUserInputQuestion`), the tool returns
  `{"accepted":true}` at once, and the answer is expected as a later user message (binary prompt:
  "The user may send a new message while you are still working"). The blocking
  `item/tool/requestUserInput` path (8m-7) is offered only in plan mode or with the
  under-development feature `default_mode_request_user_input` (`codex features list`: false).
  (2) The "doubled" text is two distinct agentMessage items (the async question text, then the
  final answer repeating it after the model ran `clock.sleep` for 30 s) — not a delta/final
  duplication in `CodexChatEvents` (textFinal only replaces when the final does not extend the
  deltas). (3) `[object Object]` is the renderer console formatting of the CHAT_ERROR payload
  object (`chat-lifecycle.service.ts:209`); the payload `error` is already a string. The real
  defect is that a CHAT_ERROR fired mid-turn: the `sleep` ThreadItem (also `hookPrompt`,
  `functionCallOutput`, `subAgentActivity`, `imageView`, `imageGeneration`, review-mode items)
  falls to `codex-event-translator.ts` default -> `unsupportedItem` error event ->
  `CodexChatEvents.error()` -> CHAT_ERROR, although the turn completed. Retryable `error`
  notifications (`willRetry: true`) take the same path. Claude never raises CHAT_ERROR for an
  unrendered block or a retried request.
- F (NOT A BACKEND GAP): the backend already emits Claude's shape (`isError: true` + real output
  + "Command failed with exit code 1", `codex-tool-presentation.ts:142-157`). The header label
  comes from `ExecutionNode.status`, which the shared tree builder sets to `complete` for every
  result (`chat-execution-tree/src/lib/builders/tool-node.fn.ts:213`); `tool-call-header`
  reads only `status` (`tool-status.utils.ts`). A failed Claude Bash shows the same label (it is
  the `sr-only` status text). Fix belongs to a separate small frontend PR from `main` (shared
  Claude + Codex); not done in this backend round.
- H (CONFIRMED, different file than suspected): the failing reader is the legacy default-home
  path `auth-providers/.../codex/codex-account-usage.service.ts` (log source line 273), whose
  JSON-RPC client applies `REQUEST_TIMEOUT_MS = 10_000` to `initialize`; the bundled binary
  needs 14.5-17.7 s. `codex-runtime`'s `CodexAccountUsageClient` already uses the process's
  60 s `INITIALIZE_TIMEOUT_MS`. Fix: export the one constant from codex-runtime (auth-providers
  already depends on it) and use it for the legacy initialize request only.
- A (CONFIRMED symptom; native option UNVERIFIED): D14 `untrusted` auto-approves only Codex's
  known-safe commands and exec-policy `allow` rules; PowerShell reads (`Get-Content`,
  `Get-ChildItem`) and `rg` pipelines prompted on Windows. Research batch 8o-R answers from the
  0.165.0 source whether a per-thread native option exists (exec-policy rules through thread
  config, a safe-command setting, a granular field) before any build. No classifier unless no
  native option exists AND the user approves (security-relevant: it auto-runs commands).

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Existing p8h Codex rows keep their lowercased path until rewritten | LOW | Runtime is dev-gated and unreleased; recorded, no migration |
| Async-question answer arrives after the turn ended | MEDIUM | 8o-3 delivers it as a new turn (same `post` follow-up path as D19) |
| Suppressing mid-turn errors hides a real failure | MEDIUM | Terminal `failed` still raises CHAT_ERROR; specs pin both |
| A new runtime event type breaks gateway/lane consumers | MEDIUM | 8o-3 updates every exhaustive switch; verify covers gateway-chat-bridge + cli-agent-runtime |

### Batch 8o-1: B workspace path + C title — COMPLETE (commit: "batch 8o-1")

- Lane codex 7e5bd25e (+ fix round aa3e8c0a). Report `batch-8o-1-report.md`.
- Verify `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`:
  EXIT 0, 15/15 tasks (2026-10-29 00:08).
- Review `code-logic-review-8o-1-2.md`: APPROVED 8/10 (implementers OpenAI + xAI, reviewer
  Anthropic). M1 (keep a stored path only when it normalizes to the key) and M2 (foreign,
  malformed, posix specs) fixed in the fix round; m3 whitespace-title spec added; m4 recorded.

- Executor: CLI lane codex (gpt-6-sol). Mode sequential. Review family: Anthropic (different).
- Files: agent-sdk `session-metadata-store.ts` (+spec), `codex-app-server/codex-chat-adapter.ts`
  (+spec), `wiring/codex-chat-metadata-port.spec.ts`.
- Verify: chat path command.

### Batch 8o-2: H legacy usage reader initialize budget — COMPLETE (commit: "batch 8o-2")

- Lane grok b22ba51b (+ spec fix eda09405). Report `batch-8o-2-report.md`.
- Verify `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/auth-providers,
  @ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge`: 10/12; failures =
  the new 15 s spec (fake-timer hang, fixed; rerun of the spec file 46/46 PASS), the known
  local-only auth-providers lint `@nx/dependency-checks` and the known Windows EPERM teardown
  failures in `translation-proxy.sdk.integration.spec.ts` (5 this run). codex-runtime,
  cli-agent-runtime and gateway-chat-bridge green.
- Review: same review file, APPROVED.

- Executor: CLI lane grok. Mode sequential, parallel with 8o-1 (file-disjoint).
- Files: codex-runtime `codex-app-server-process.ts`, `src/index.ts` (+ process spec if
  needed); auth-providers `providers/codex/codex-account-usage.service.ts` (+spec).
- Verify: codex-runtime command + `-p @ptah-extension/auth-providers`.

### Batch 8o-R: A native read auto-allow research (read-only) — COMPLETE

- Executor: CLI lane codex (research, web). No source edits. Deliverable
  `research-8o-a-report.md`.

### Batch 8o-3: E question card + no mid-turn CHAT_ERROR — COMPLETE (commit: "batch 8o-3")

- Lanes codex 5dffb0e1, fix round 551ce0dc, verify fix 9f7fdd8d. Report `batch-8o-3-report.md`.
- Review `code-logic-review-8o-3-5.md`: NEEDS_REVISION 6.5/10 (S1 codexFollowUpRejected
  swallowed, S2 question could vanish, M4 delta/card duplication, M5 duplicate completion) ->
  fix round -> re-review APPROVED (R1 log reason fixed; R2/R3 minor recorded).
- Verify (final): codex-runtime trio 9/9, chat path 15/15.
- Open (live test): Codex may end the turn right after the async question, which cancels the
  card at once (review M3); R2 a rejected follow-up's CHAT_ERROR latches later failures.

- Executor: CLI lane codex (gpt-6-sol), sequential. Review family: Anthropic.
- Exceeds the 6-file rule on purpose: adding a CodexRuntimeEvent variant must land with every
  exhaustive consumer (agent-sdk chat events, cli-agent-runtime lane events, gateway adapter)
  in one compiling commit. Verify: both commands (runtime + chat path).
- Task 8o-3.1 (codex-runtime): `agentMessage` with `delivery: "async"` and non-empty
  `questions` -> new event `userInputAsync {itemId, text, questions}` (no textFinal); `sleep`
  item -> no event (no unsupportedItem error).
- Task 8o-3.2 (lane + gateway): render `userInputAsync` as the item text (their users answer by
  message, the native async semantics).
- Task 8o-3.3 (chat): the question shows Claude's AskUserQuestion card through the SAME
  requestUserInput port / AskUserQuestionService as 8m-7; the item text is not rendered; the
  answer goes back in Claude's AskUserQuestion result wording via `turn/steer` while the turn
  runs, else as a new turn through the existing follow-up path (D19); Stop/abort/close cancels
  the pending card. Mid-turn `error` events (retryable, unsupportedItem,
  unsupportedNotification) no longer raise CHAT_ERROR; a terminal `failed` still does once.

### Batch 8o-4: A read-only allowlist (D20) — COMPLETE (commit: "batch 8o-4")

- Lanes codex c1d20f66, fix round 8cb9204b, verify fix c8e35e23. Report `batch-8o-4-report.md`.
- Security review `security-review-8o-4.md`: NEEDS_REVISION 5/10 (B1 containment used the
  model-controlled command cwd, S2 symlinks, M3-M5, spec gaps) -> fix round -> re-review
  APPROVED 8/10. The later lint fix only removed escapes inside character classes
  (`/[*?[\]]/`, same semantics). Recorded: realpath-to-exec TOCTOU; a very broad profile cwd
  (home or drive root) makes "inside cwd" broad (product decision).
- Verify (final): chat path 15/15.

- User decision D20 (option 1). Executor: CLI lane codex (gpt-6-sol), sequential, parallel with
  8o-3 and 8o-5 (file-disjoint). Review: independent security-focused review (Anthropic) before
  commit.
- Files: agent-sdk `codex-app-server/codex-read-only-command.ts` (new, + spec),
  `codex-chat-approval-sink.ts` (+ spec), `codex-chat-adapter.ts` (pass permission level and
  cwd to the sink only). Verify: chat path command.
- Batch 8o-R: COMPLETE (research only, report `research-8o-a-report.md`): no native per-thread
  option in 0.165.0. D14 unchanged.

### Batch 8o-5: Codex UI hint without skill-file search (D21) — COMPLETE (commit: "batch 8o-5")

- Lane grok 4e7b7ff6 (+ ae247f62 spec scope extension). Report `batch-8o-5-report.md`.
- Review `code-logic-review-8o-3-5.md`: APPROVED 9/10; Claude `PTAH_UI_HINT` byte-identical.
  Note: the Codex developerPrompt changes, so threads created before this commit refuse resume
  with "Start a new chat" (D14a behaviour; dev-gated runtime).
- Verify (final): chat path 15/15.

- Executor: CLI lane grok, sequential, parallel with 8o-3/8o-4.
- Files: rpc-handlers `codex-host/codex-chat-host-ports.ts` (+ spec); agent-sdk
  `prompt-harness/ptah-ui-hint.ts` only if a Codex variant must live beside the Claude hint
  (Claude text unchanged, pinned by a spec). Verify: chat path command.

## Round 8p: p8i gaps (A2, I) + P8 logic/style review fixes — COMPLETE (8 of 8 batches COMMITTED; 8p-4 = 80b916f98, 8p-8 = edad8d577; main merged in 03d37d067; phase gate in session 25)

Source: `live-test-p8i.md` (head 552010a4e), `code-logic-review-p8.md` (S1, S2, M1, M4, M5),
`code-style-review-p8.md` (S1, S2, S3, M1-M3). Principle unchanged: native Codex chat produces
exactly Claude's UI contracts; fixes only in codex-runtime -> agent-sdk codex-app-server ->
rpc-handlers codex-host; no frontend Codex special case; no second proxy; MCP untouched.
Team-leader (Round 8p) is the only committing agent; no push. Phase = the whole round; one
Claude code-logic review per batch (security review for 8p-1), then the round's phase gate.
Out of scope: D9 history after reload, GAP-F header, G6 fileChange path, GAP-3 user MCP.

### Plan validation — PASSED WITH RISKS

- RISK A2-1 (HIGH, new): fixing `unwrap()` alone would NOT close GAP-A. The sink gate
  (`codex-chat-approval-sink.ts:112`) requires `proposedExecpolicyAmendment == null`, but every
  real command approval recorded by the evidence harness carries one (spike-run-6h x3, 6j, 7a2
  x2, 7d x2: `hasProposedExecpolicyAmendment: true`). Mitigation (Task 8p-1.2): the gate ignores
  a PROPOSED amendment; the sink still answers plain `accept` (never an amendment decision, never
  acceptForSession), so D20's "never an exec-policy amendment" holds. Security review confirms.
- RISK A2-2 (MEDIUM): real argv `["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  "-Command","<body>"]` (rollout 01a1852d). The App Server sends `command` as one string (schema
  `CommandExecutionRequestApprovalParams.command: string|null`); the card renders
  `"C:\...\powershell.exe" -Command '<body>'`. The exact join (quote style, doubled backslashes)
  is not in any log. Mitigation (Task 8p-1.1): executable token unquoted, double- or
  single-quoted; `path.win32.normalize` of it equals (case-insensitive)
  `<SystemRoot|windir>\System32\WindowsPowerShell\v1.0\powershell.exe`, or bare
  `powershell`/`pwsh` (`.exe` optional). Specs use the exact live argv joined both ways.
- ASSUMPTION A2-3: the approval `cwd` is a native path (`LegacyAppPathString`); the rollout exec
  event shows `file:///C:/...` URIs. Task 8p-1.2 converts a `file:` URI cwd with `fileURLToPath`
  before classification; anything else unparseable still fails closed.
- RISK I-1 (MEDIUM): GAP-I root cause confirmed. `CodexChatAdapter.resumeSession` on a closed
  thread runs a turn with `config.prompt` (`codex-chat-adapter.ts:245,287`); Claude's resume
  ignores `prompt` (used only on start in `sdk-agent-adapter.ts`). `chat-session.service.ts:1272`
  then sends again -> adapter `busy` -> CODEX_BUSY. The resume turn also drops `files`/`images`.
  Mitigation (Batch 8p-2): `autoResumeIfInactive` reports `promptDelivered` when the Codex
  runtime resumed with the prompt; `chat:continue` skips the second send; files/images ride the
  resume config (optional fields on `AgentSessionResumeConfig`, read by the existing
  `'files' in config` mapping in host ports). Claude path unchanged (pinned by a spec).
- S1 contract: Claude dismisses pending question cards via `cleanupPendingPermissions(id)` ->
  `PERMISSION_SESSION_CLEANUP` (`sdk-permission-handler.ts:1315-1360`); the frontend
  `cleanupSession` matches `sessionId` or `tabId`. Codex reuses that exact call when its question
  signal aborts unanswered (Batch 8p-2).
- Item 4 research: `thread/resume` accepts `developerInstructions`, `baseInstructions`,
  `approvalPolicy`, `sandbox` (pinned schema `v2/ThreadResumeParams`), and `RuntimeContext.open`
  already sends the full thread params (prompts included) on resume (`codex-runtime.ts:362-379`).
  YES branch: fingerprint permissionLevel + sandboxPolicy + approvalPolicy only; prompts re-sent
  on resume. Every fingerprint stored before this change mismatches the new formula and refuses
  once ("Start a new chat"); acceptable, dev-gated runtime (as in 8o-5). Recorded as D23.
- File-size exception: Batch 8p-5 moves two symbols across 3 libs (~7 files); splitting a move
  would need a temporary re-export shim, which the round forbids. Accepted.

Edge cases: body containing its quote char (rejected, unchanged); `-EncodedCommand`/`-File`/extra
flags (rejected); look-alike or other-drive powershell paths (rejected); SystemRoot unset (bare
names only); question answered after turn end (card dismissed at turn end; late answer logged);
answer steer refused mid-turn (one `codexFollowUpRejected` error, as 8o-3); first follow-up after
restart with attachments (delivered once, with attachments).

### Batch 8p-1: GAP-A2 Windows PowerShell wrapper + sink minors — COMPLETE (commit 42cbcfa64; security-review-8p-1.md APPROVED WITH NOTES 8/10; code-logic-review-8p-1.md APPROVED 8/10)

- Executor: CLI lane codex (`gpt-6-sol`), sequential. Reviews: Claude security
  (`security-review-8p-1.md`) + code-logic (`code-logic-review-8p-1.md`). Depends on: none.
- Task 8p-1.1 — COMPLETE: agent-sdk `codex-app-server/codex-read-only-command.ts` (+ spec):
  RISK A2-2; `-NoProfile` optional (`-NoLogo` only after it, as today); only
  `-Command|-c <single quoted body>`; every other rule unchanged.
- Task 8p-1.2 — COMPLETE: agent-sdk `codex-app-server/codex-chat-approval-sink.ts` (+ spec):
  RISK A2-1, A2-3; SystemRoot/windir passed to the classifier (injectable); M4 `seen` cleanup on
  auto-accept and early-decline paths; M5 edit follow-up via `setImmediate` like the bridge.
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`.

### Batch 8p-2: GAP-I deliver once + S1 question card dismissal — COMPLETE (commit e8d449ab8; code-logic-review-8p-2.md APPROVED 8/10, M1/M2 moved to 8p-4)

- Executor: CLI lane grok, sequential. Review: Claude code-logic (`code-logic-review-8p-2.md`).
  Depends on: none (file-disjoint with 8p-1/8p-3).
- Task 8p-2.1 — COMPLETE: rpc-handlers `chat/session/chat-session.service.ts` (+ spec), shared
  `agent-adapter.types.ts`: RISK I-1 mitigation.
- Task 8p-2.2 — COMPLETE: rpc-handlers `chat/codex-host/codex-chat-user-questions.ts` (+ spec):
  unanswered abort -> `permissionHandler.cleanupPendingPermissions(sessionId)`.
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers`.

### Batch 8p-3: resume fingerprint (D23) + typed error + refused answer (logic M1) — COMPLETE (commit f3bdd974d; code-logic-review-8p-3.md APPROVED 8/10; fix round 1: TS2322 at codex-runtime.ts:665)

- Executor: CLI lane codex (`gpt-6-sol`), sequential. Review: Claude code-logic
  (`code-logic-review-8p-3.md`). Depends on: none.
- Task 8p-3.1 — COMPLETE: codex-runtime `codex-execution-profile.ts` (+ spec): digest =
  permissionLevel, sandboxPolicy, approvalPolicy.
- Task 8p-3.2 — COMPLETE: new `codex-resume-profile-error.ts` (class, code, message, guard),
  exported from `src/index.ts`; resume frame carries instructions (spec).
- Task 8p-3.3 — COMPLETE: `codex-runtime.ts` (+ spec): refused answer steer on a live turn emits
  the one `codexFollowUpRejected` error; a terminal turn stays log-only.
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge`.

### Batch 8p-4: typed resume error consumers + StreamlessFollowUpAdmission — COMMITTED 80b916f98 (+ code-logic-review-8p-2 M1/M2; code-logic-review-8p-4.md APPROVED 8/10; 2 stale specs fixed; chat-path verify 15/15)

- Depends on: 8p-2, 8p-3. Files: agent-sdk `codex-chat-adapter.ts`, `session-runtime-router.ts`,
  `src/index.ts`; rpc-handlers `chat-session.service.ts`. Verify: chat path command.
- State at wrap-up: implemented (batch-8p-4-report.md), reviewed APPROVED 8/10, left
  UNCOMMITTED in W. Wave 2 verify (`-p codex-runtime,cli-agent-runtime,gateway-chat-bridge,
  agent-sdk,rpc-handlers`): 15 tasks, 13 ok; 2 failures, both stale specs of this batch:
  - `codex-chat-adapter.spec.ts:1540-1550` builds a duck-typed
    `Object.assign(new Error(), {name, code})`; the new `instanceof` guard rejects it
    (code `runtime-failed`). Fix: throw `new CodexResumeProfileChangedError()`.
  - `chat-session.native.spec.ts:350-356,432,475` (4 tests) call `autoResumeIfInactive`
    without the new `deliversFollowUp` option and expect `promptDelivered: true`. Fix: pass
    the option where the test models chat:continue, else expect `false`.
  - Review moderates to fold in: M1 make `deliversFollowUp` a named option (not positional
    after a defaulted parameter); M2 comment why `codexFailure` checks code and cause.
  - Remaining: spec fix -> re-run the chat path verify -> commit.

Round-level verify evidence: Wave 1 (8p-1/2/3/7) `-p codex-runtime,cli-agent-runtime,
gateway-chat-bridge,agent-sdk,shared,rpc-handlers` = 18/18 PASS (after the 8p-3 fix round).
Wave 2 (8p-5, 8p-6): codex-runtime, cli-agent-runtime, gateway-chat-bridge lint/test/typecheck
and agent-sdk/rpc-handlers lint/typecheck PASS; the only test failures are the 8p-4 specs above.
Phase gate (degradation-audit, di-lint, host typechecks) NOT RUN (session wrap-up).

### Batch 8p-5: Codex Ptah MCP constants into codex-runtime (style S2) — COMPLETE (commit 1035d575f; code-logic-review-8p-5.md APPROVED 9/10)

- Depends on: 8p-3. Move `CODEX_PTAH_TOOL_TIMEOUT_SEC` and `ptahMcpSessionUrl`; no shims.

### Batch 8p-6: split codex-runtime.ts (style S3, behavior-preserving) — COMPLETE (commit 7734ff47d; + 8p-3 M1 spec; code-logic-review-8p-6.md APPROVED 9/10; BOM stripped before commit)

- Depends on: 8p-3. Move `RuntimeContext` to `codex-context.ts`.

### Batch 8p-7: minors (session-rpc ternary, metadata-store catch marker) — COMPLETE (commit 0759012e3; code-logic-review-8p-7.md APPROVED 9/10)

- Depends on: none. Small edits.

### Batch 8p-8: review follow-ups (Moderates from 8p-1 / 8p-3 reviews) — COMMITTED (code-logic-review-8p-8.md APPROVED; its minor note, a `C:\..` SystemRoot, fixed before commit; trio + agent-sdk verify 12/12)

Named later task per the fix-round rule (Moderates that cannot break a lane config or lose
data). Depends on: 8p-1, 8p-3 committed.
- security-review-8p-1 M-1: trust SystemRoot only as a single-segment drive root
  (`X:\Name`); reject a trusted-looking executable that resolves inside the thread cwd.
- security-review-8p-1 M-4: approvals carrying a non-empty `reason` may be sandbox-escalation
  retries. Live evidence of whether `untrusted` read approvals carry `reason` is missing, so do
  NOT gate on it blindly: log `hasReason` (boolean only) on auto-accept now; decide the gate in
  the next live run (p8j). M-2 (bare powershell via PATH, pre-existing since 8o-4) and M-3
  (`-NoProfile` optional: the user's own profile loads, as for an approved command) recorded,
  no change.
- code-logic-review-8p-1 M-1: skip the edit follow-up `setImmediate` when the sink is disposed;
  M-2: spec abort/dispose during the async realpath check.
- code-logic-review-8p-3 M1: DONE in 8p-6 (7734ff47d).
- 8p-6 follow-up: export `CodexRuntimeOptions` in `codex-runtime/src/index.ts` from
  `./lib/codex-context` and drop the type re-export in `codex-runtime.ts` (the re-export was
  allowed only because 8p-5 held index.ts). `codex-context.ts` is 913 lines (class 847), still
  over the 700-line warning; a further split is new design work, not a move.
- code-logic-review-8p-3 M2 (optional): note in code that `normalizedHome` is the account
  boundary now that `accountId`/`consumer` left the digest.

## Round 8q: p8j gaps (read grammar, saved permission level, live mode change) — COMPLETE (all batches committed; round code-logic review fixed; gate PASS; see "Round 8q close" at the end of this section)

Sources: research-p8j-gaps.md (8ea186c34), live-test-p8j.md. Backend only: no frontend Codex
special case, no second proxy, NEVER touch MCP, Claude behaviour unchanged. Decisions in force:
D14, D14a, D20, D23, D24(1) (the resume refusal on a policy change stays). P9 batches 9b-2..9b-7
stay on hold until this round is committed. Prefixes: A = W/libs/backend/agent-sdk/src/lib/
codex-app-server/, H = W/libs/backend/rpc-handlers/src/lib/chat/, R =
W/libs/backend/codex-runtime/src/lib/.

### Plan validation

Status: PASSED WITH RISKS. Anchors re-checked at 8ea186c34:
- Gap A: the only rejecting gate is the PowerShell branch of the classifier
  (A/codex-read-only-command.ts:140-148: one value after `-LiteralPath`, no named parameters,
  any value starting with `-` rejected). The sink falls through to the card silently
  (A/codex-chat-approval-sink.ts:107-147; only the accept branch logs, :136). The forbidden
  character class (:12) does not contain `*`, `?`, `[`, `]`, so wildcard path values are not
  rejected today.
- D14a part 1: the profile takes `config.permissionLevel ?? 'ask'` (H/codex-host/
  codex-chat-host-ports.ts:393) and never reads `autopilot.*`. The only autopilot reader on the
  Codex path is H/codex-host/codex-session-settings-record.ts:104-118 (through
  `deps.scopeResolver.readForPath(name, workspacePath, true)`, :92-93). Host ports deps
  (codex-chat-host-ports.ts:56-77) have no settings reader, so Electron must bind one.
- D14a part 2: `updateNextTurn` throws on any level change (R/codex-context.ts:744-772,
  :756-762); `start()` sends the frozen `profile.approvalPolicy`/`sandboxPolicy` (:481-490); the
  bridge reads the frozen `profile.permissionLevel` (:249); the identity with the open-time
  `profileFingerprint` is persisted once (:228-240). The adapter sets `session.settings` after a
  successful update (A/codex-chat-adapter.ts:722-736) and the sink reads that value (:474). The
  pure level->policy mapping and the fingerprint are inline in R/codex-execution-profile.ts
  (:141-160, :250-292). Rollback: H/codex-host/native-session-controls.ts `change()` applies the
  old level again when the save fails.

Decisions (team-leader, session 25, reversible):
- 8q-D1 Grammar. Per-cmdlet named parameters, exact and case-insensitive, no abbreviations, each
  parameter at most once, ints `^\d{1,6}$`, values consumed by grammar position (not by a
  leading `-` heuristic). Get-Content: one path (`-LiteralPath` | `-Path` | positional), at most
  one of `-TotalCount` | `-Head` | `-First` <int>, `-Tail` <int>, `-Raw`. Get-ChildItem: zero or
  one path (same three forms), switches `-Name`, `-File`, `-Directory`. Test-Path: one path,
  optional `-PathType Leaf|Container`. `-Force` NOT allowed (in no live command; reveals hidden
  files; deny by default). Rejected: `-Wait`, `-Stream`, `-Filter`, `-Include`, `-Exclude`,
  `-Credential`, `-ReadCount`, `-Delimiter`, `-Encoding`, `-Recurse`, `-Depth`, and any unknown
  parameter. Only path values go to `paths`. A `-Path` or positional value containing `*`, `?`,
  `[` or `]` is rejected (wildcard expansion would read files the realpath gate never saw);
  `-LiteralPath` values still reject `*` and `?`. Existing reject specs stay green.
- 8q-D2 Reason log. One names-only line at every non-accept fall-through in the sink:
  `{ code: 'codex-read-only-not-accepted', reason }`, reason from the closed enum `level-not-ask`,
  `not-command`, `details-gate`, `cwd-uri-invalid`, `not-classified`, `path-not-inside`, plus
  booleans for which of `environmentId`, `networkApprovalContext`,
  `proposedNetworkPolicyAmendments` are non-null. Never the command, tokens, paths or cwd. Level
  `info` (dev-gated runtime; settles the `environmentId` unknown on the next live read).
- 8q-D3 Saved level helper. ONE pure helper in rpc-handlers codex-host,
  `resolveSavedCodexPermissionLevel(read)`: `autopilot.enabled === true ?
  autopilot.permissionLevel : 'ask'`; an invalid saved level throws the existing
  `CodexSessionSettingsError('invalid-settings')`. codex-session-settings-record.ts uses it (no
  third copy). The profile uses `config.permissionLevel` when set, else the helper over the
  workspace-scoped reader. It stays in rpc-handlers, not shared: both readers live there, so no
  shared/auth-providers verify is needed.
- 8q-D4 Live change = defer to the next turn (Claude-like: the chip changes at once). The
  context stores the requested level immediately; `turn/start` sends the policy of the level
  current at that start; the bridge AND the sink read the level in force for the CURRENT turn (a
  snapshot taken in `start()`), so an active turn never auto-accepts under a level its wire policy
  does not have. Rejecting while a turn is active was rejected (the toggle would fail on every
  busy chat). The fingerprint is recomputed with the extracted pure function and the identity is
  re-persisted inside `updateNextTurn` before it resolves; a failed persist rejects and leaves the
  settings unchanged, so the controls' rollback (`apply(old)`) restores the old level, policy and
  fingerprint through the same path.

Risks:

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Read grammar widens the D20 auto-accept | HIGH | 8q-1 deny-by-default grammar, wildcard reject, Claude security review before commit |
| Stale level during an active turn auto-accepts under the wrong mode | HIGH | 8q-D4 per-turn snapshot for bridge and sink; 8q-3a/3b specs; security review |
| Every saved mode switch makes old Codex threads refuse on resume (D24(1)) | MEDIUM | intended (user choice); recorded for the live re-test |
| The store refuses a re-persist of an existing thread's identity | MEDIUM | 8q-3b checks codex-thread-identity-store.ts and adds an update path only if needed |
| Parallel lanes in one worktree see each other's edits during verify | MEDIUM | implement in waves; verify and commit one batch at a time in the listed order |
| `environmentId` non-null keeps showing cards after the grammar fix | LOW | 8q-D2 boolean log settles it on the next live read |

Assumptions: `-Head`/`-First` are aliases of `-TotalCount` in Windows PowerShell 5.1 (the 8q-1
executor confirms it and records the source in the report); the plan-level sandbox is
`read-only` and every other chat level `workspace-write`, so a plan <-> other change resends
both fields (8q-3a spec).

### Waves, reviews, gate

- Wave 1 (parallel implementation, disjoint projects): 8q-1 (agent-sdk), 8q-2a (rpc-handlers),
  8q-3a (codex-runtime). Verify and commit in the order 8q-3a (verify only; commit waits for the
  security review) -> 8q-1 -> 8q-2a.
- Wave 2: 8q-3b (needs 8q-3a; after 8q-1 is committed, same project) and 8q-2b (needs 8q-2a),
  in parallel.
- Wave 3: 8q-3c (needs 8q-3b, 8q-2b).
- Reviews: Claude SECURITY review of the 8q-1 diff before its commit; Claude SECURITY review of
  the combined 8q-3a + 8q-3b diff before either is committed (verify each, review once, commit
  3a then 3b). Round code-logic review (Claude `code-logic-reviewer`) on the combined round diff
  after 8q-3c; one fix round per the rules.
- Round gate (coordinator): degradation-audit, di-lint, 4-host typecheck.
- Executors: CLI lanes codex (gpt-6-sol) or grok; never gpt-6.1-terra; Glm at limit. Fallback:
  the other of codex/grok -> subagent `backend-developer`. Lane task first lines: lanes never
  verify, commit or push, never call ptah_get_diagnostics, never npm ci/install, never touch
  MCP, follow W/CLAUDE.md (Electron first; no any / as unknown as / ts-ignore / eslint-disable),
  strip any UTF-8 BOM, do not edit batches.md/task.md/decisions.md, edit only the listed files,
  write the report to the given absolute path.

## Batch 8q-1: Bounded PowerShell read grammar and reason log (agent-sdk) — COMPLETE (commit: the "batch 8q-1" commit; security-review-8q-1.md APPROVE 8.5/10; Wave 1 verify: agent-sdk lint/test/typecheck PASS)

- Recommended executor: CLI lane codex (gpt-6-sol) | sequential | Depends on: none
- Review: Claude security review (D20) before commit; round code-logic review later
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`
- Files: MODIFY A/codex-read-only-command.ts, A/codex-read-only-command.spec.ts,
  A/codex-chat-approval-sink.ts, A/codex-chat-approval-sink.spec.ts
- Report: T/batch-8q-1-report.md

### Task 8q-1.1: per-cmdlet grammar (8q-D1) — COMPLETE
- Replace the PowerShell branch at :140-148. Specs accept, in the live wrapper:
  `Get-Content -LiteralPath README.md -TotalCount 40`, `... package.json -TotalCount 3`,
  `Get-ChildItem -LiteralPath . -Name`, `-Tail 5`, `-Raw`, swapped order, a positional path plus
  `-TotalCount`, `Test-Path x -PathType Leaf`. Specs reject: `-TotalCount abc`, `-TotalCount -1`,
  a missing value, a repeated `-LiteralPath`, `-TotalCount 3 -Head 3`, `-Wait`, `-Stream`,
  `-Filter *`, `-Tot 3`, `-Recurse`, `-Force`, `-Path ..\x`, `-LiteralPath C:\other`, `-Path *`,
  a positional `a?.md`, a switch given a path value, a 7-digit int.
### Task 8q-1.2: names-only reason log (8q-D2) — COMPLETE
- Every fall-through to `presentRequest` in the sink (:107-147). Specs: code + reason per branch;
  the serialized log args contain no command text, path or cwd; one end-to-end sink spec with the
  real `-TotalCount` command in a real temp folder expects `'accept'`.

## Batch 8q-2a: One saved-level helper (rpc-handlers) — COMPLETE (commit: the "batch 8q-2a" commit; Wave 1 verify: rpc-handlers lint/test/typecheck PASS; record spec unchanged and green)

- Recommended executor: CLI lane grok | sequential | Depends on: none
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers`
- Files: CREATE H/codex-host/codex-saved-permission-level.ts and
  H/codex-host/codex-saved-permission-level.spec.ts; MODIFY
  H/codex-host/codex-session-settings-record.ts (:104-118 uses the helper; behaviour identical;
  existing record specs stay green)
- Report: T/batch-8q-2a-report.md

### Task 8q-2a.1: helper (8q-D3) — COMPLETE
- Specs: disabled -> ask; absent `enabled` -> ask; enabled ask/plan/auto-edit/yolo -> that
  level; enabled with an invalid or missing level -> `CodexSessionSettingsError('invalid-settings')`.
### Task 8q-2a.2: the settings record uses the helper — COMPLETE

## Batch 8q-2b: The Codex profile honours the saved level (rpc-handlers, ptah-electron) — COMPLETE (commit: the "batch 8q-2b" commit; review-8q-2b.md APPROVE 8/10 by grok; verify rpc-handlers + ptah-electron PASS)

- Recommended executor: CLI lane codex (gpt-6-sol) | sequential | Depends on: 8q-2a
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron`
- Files: MODIFY H/codex-host/codex-chat-host-ports.ts (deps :56-77 gain a required
  `readSavedPermissionLevel(workspacePath: string): PermissionLevel`; :393 becomes
  `config.permissionLevel ?? deps.readSavedPermissionLevel(<resolved workspace path>)`),
  H/codex-host/codex-chat-host-ports.spec.ts, H/session/chat-session.service.spec.ts,
  W/apps/ptah-electron/src/di/codex-runtime-composition.ts (binds the helper over the same
  `scopeResolver.readForPath(name, workspacePath, true)` reader the settings record uses) and
  W/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts if a binding spec belongs there
- Report: T/batch-8q-2b-report.md

### Task 8q-2b.1: host ports profile — PENDING
- Specs: Manual -> ask; enabled auto-edit/plan/yolo -> those levels; an explicit
  `config.permissionLevel` wins; a resume (no `permissionLevel` in its config) reads the same
  saved level.
### Task 8q-2b.2: the resume refusal is reachable — PENDING
- chat-session.service.spec.ts: a resume whose saved level changed maps to
  `CODEX_RUNTIME_FAILED` with `CODEX_RESUME_PROFILE_CHANGED_MESSAGE` (the p8j D14a scenario).
### Task 8q-2b.3: Electron binding — PENDING

### 8q-2b result (codex lane; batch-8q-2b-report.md)

- Host ports deps gain `readSavedPermissionLevel(workspacePath)`; the profile uses
  `config.permissionLevel ?? deps.readSavedPermissionLevel(workspacePath)`
  (codex-chat-host-ports.ts:74,395). Electron binds `resolveSavedCodexPermissionLevel` over
  `scopeResolver.readForPath(name, workspacePath, true)`, the same reader the settings record uses
  (codex-runtime-composition.ts:494). Two test fixtures get a fixed `ask` reader.
- 8q-2b.2: the lane added a new chat-session.service.spec.ts that threw the refusal from its own
  mock (redundant with chat-session.native.spec.ts:677-705) and did not compile. The coordinator
  removed it. Reachability is covered link by link: host ports resume spec (saved level), runtime
  fingerprint refusal specs, native spec (error mapping).
- review-8q-2b.md (grok) APPROVE 8/10; its only finding was that removed spec. Verify
  rpc-handlers + ptah-electron PASS.

## Batch 8q-3a: Live level change in the runtime (codex-runtime) — COMPLETE (commit: the "batch 8q-3a" commit; security-review-8q-3a.md APPROVE 8/10, M1/M2 fixed, security-review-8q-3a-fix.md APPROVE 9/10 by grok; Wave 1 verify PASS for codex-runtime, cli-agent-runtime, gateway-chat-bridge, agent-sdk, rpc-handlers)

- Recommended executor: CLI lane codex (gpt-6-sol) | sequential | Depends on: none
- Review: Claude security review on 8q-3a + 8q-3b before either commit
- Verify: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge,@ptah-extension/agent-sdk`
- Files: MODIFY R/codex-execution-profile.ts, R/codex-execution-profile.spec.ts,
  R/codex-context.ts, and the runtime spec that drives `updateNextTurn` and `turn/start` frames
  (research names R/codex-runtime.spec.ts; locate it); W/libs/backend/codex-runtime/src/index.ts
  only if 8q-3b needs a new export
- Report: T/batch-8q-3a-report.md

### Task 8q-3a.1: extract the pure policy and fingerprint — IN_PROGRESS
- From :141-160 and :250-292: exported pure `resolveCodexLevelPolicy(consumer, level, cwd)` ->
  `{ approvalPolicy, sandboxPolicy }` and `codexProfileFingerprint({ permissionLevel,
  sandboxPolicy, approvalPolicy })`; `buildCodexExecutionProfile` uses both (single source).
  Existing profiles and fingerprints unchanged byte for byte (a spec pins a known digest).
### Task 8q-3a.2: `updateNextTurn` applies a level (8q-D4) — IN_PROGRESS
- R/codex-context.ts:744-772: keep the zod validation, drop the throw, store the level and its
  policy (8q-3a.1), recompute the fingerprint and re-persist the identity
  (`options.store.persist`) before resolving; a failed persist rejects and keeps the old state.
- `start()` (:481-490) sends the current policy and snapshots the turn level; the bridge (:249)
  reads the snapshot; a read-only `turnPermissionLevel` (current turn, else the stored level) is
  exposed for the adapter's sink.
- Specs: all four levels give the right next `turn/start` frame (plan <-> other resends both
  fields); a change during an active turn leaves the bridge on the old level until the next
  start; the fingerprint is re-persisted; a persist failure leaves frame and fingerprint unchanged;
  a rollback to the old level restores both; the model/effort paths are unchanged.

### 8q-3a review carry-over (security-review-8q-3a.md APPROVE 8/10; coordinator call)

- Fix before the 8q-3a commit (fix round 8q-3a-fix, same files + specs): M1 the
  `updateNextTurn` persist (codex-context.ts:803) is not tracked by `this.persistence` and has no
  closed check after the await, so a close during it can leave the identity active for a dead
  context and return success from a closed context (:924-946); M2 a turn started by a
  `turn/started` notification while idle (compaction etc., :207-214, :395-402) has no level
  snapshot, so the bridge falls back to the live level.
- Closed by 8q-3b: M3 sink/bridge disagreement until the sink reads `turnPermissionLevel` (fails
  closed).
- Minors recorded, not fixed: approval requests carry the stale open-time `profileFingerprint`
  after a live change; session approval rules are not scoped by level; no specs yet for
  sink/bridge disagreement (8q-3b adds them).
- Deviation from the Waves section: 8q-3a got its own security review (not combined with 8q-3b),
  so it can commit in Wave 1; 8q-3b gets its own security review.
- Fix round 8q-3a-fix (codex lane; batch-8q-3a-fix-report.md): M1 and M2 CLOSED
  (security-review-8q-3a-fix.md, grok, APPROVE 9/10). The coordinator fixed one spec type error
  (`finishPersist` typed `() => void`, codex-runtime.spec.ts:1600). Minor recorded, not fixed: if
  `markInactive(nextIdentity)` fails during a close, the new-fingerprint row stays `active`
  (codex-context.ts:815-822, :971-973); the context is closed, and the flag is not liveness.

## Batch 8q-3b: Adapter and identity store follow the live level (agent-sdk) — COMPLETE (commit: the "batch 8q-3b" commit; security-review-8q-3b.md APPROVE 8/10 by codex; verify agent-sdk PASS)

- Recommended executor: CLI lane grok | sequential | Depends on: 8q-3a; after 8q-1 is committed
  (same project)
- Review: the combined 8q-3a + 8q-3b security review
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`
- Files: MODIFY A/codex-chat-adapter.ts (`buildSink` :420-480 reads the context's
  `turnPermissionLevel` instead of `session.settings`; `setSessionPermissionLevel` :722-736
  otherwise unchanged), A/codex-chat-adapter.spec.ts, A/codex-chat-turn-lifecycle.spec.ts,
  W/libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.ts and its spec (only if a
  second `persist` of the same thread with a new fingerprint is refused today)
- Report: T/batch-8q-3b-report.md

### Task 8q-3b.1: the sink reads the turn level — PENDING
### Task 8q-3b.2: `setSessionPermissionLevel` resolves for a different level — PENDING
- Specs: it resolves; the next turn's sink gate uses the new level; a mid-turn change keeps the
  active turn's level.
### Task 8q-3b.3: the identity store accepts the re-persist — PENDING
- Same thread, context and generation with a new fingerprint -> stored; a different thread is
  still refused.

### 8q-3b result (grok lane; batch-8q-3b-report.md)

- The sink reads `context.turnPermissionLevel` (codex-chat-adapter.ts:474). The store already
  accepted the re-persist, so only a pinning spec was added (codex-thread-identity-store.spec.ts:160).
  The coordinator fixed one spec type error (read-only property set with `Object.defineProperty`,
  codex-chat-adapter.spec.ts:697). Verify agent-sdk PASS.
- security-review-8q-3b.md (codex) APPROVE 8/10, M3 CLOSED. Minors recorded, not fixed: after a
  close the getter still returns the last level (bridge and sink are disposed, so no reachable
  grant); the adapter spec moves the mock level by hand instead of a real runtime turn.

## Batch 8q-3c: Controls contract with a live level change (rpc-handlers specs) — COMPLETE (commit: the "batch 8q-3c" commit; grok lane, batch-8q-3c-report.md, no production gap found; verify rpc-handlers PASS; covered by the round code-logic review)

- Recommended executor: CLI lane grok | sequential | Depends on: 8q-3b, 8q-2b
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers`
- Files: MODIFY H/codex-host/codex-chat-native-contract.spec.ts,
  H/codex-host/native-session-controls.spec.ts (specs only; a needed production change here is a
  finding to report, not to make)
- Report: T/batch-8q-3c-report.md

### Task 8q-3c.1: setPermission on an open thread — PENDING
- A different level: apply, save, chip value; a save failure rolls back by applying the old
  level and the old policy. Last 8q batch -> round code-logic review.

### Round 8q close (session 26)

- Round code-logic review (code-logic-review-8q.md, grok): REVISE 6/10.
  - Finding 1 (serious) FIXED in the "8q wire level" commit (codex lane,
    batch-8q-fix-wire-level-report.md): an idle `turn/started` (compaction) snapshotted the
    next-turn level instead of the level whose policy is on the wire. `wirePermissionLevel` is now
    set from the profile at construction and in `start()` before `turn/start`, restored on a
    rejected `turn/start`, and used by the idle notification path. review-8q-fix-wire-level.md
    (grok) APPROVE 8/10, finding 1 CLOSED.
  - Finding 2 (moderate) ACCEPTED, not fixed: a process exit after the identity persist and
    before the autopilot chip save leaves the new fingerprint stored and the old chip; the next
    open gives the D14a refusal. In-process save failures still roll back.
- Open minor (next session, optional): no spec covers "a user turn sends level X, then stage Y,
  then an idle notification turn" (removing the `start()` wire assignment at codex-context.ts:530
  does not fail a spec). Add one spec in codex-runtime.spec.ts.
- Merge of main (b13acd7bd): `chat:continue` returns `enqueued: true` on the live-send path;
  three branch specs updated. This fixed the CI failure at 0bd8beee4 (test shard 3/4).
- Gate: verify codex-runtime, cli-agent-runtime, gateway-chat-bridge, agent-sdk, rpc-handlers,
  ptah-electron 24/24 PASS; degradation-audit PASS; di-lint PASS; typecheck ptah-electron,
  ptah-extension-vscode, ptah-cli, ptah-tui 4/4 PASS.

## Round 8r: p8k gaps (follow-up regression, failed-turn settle, dead-context mode, D14a text, model scope) — COMPLETE (8r-1..8r-3; 8r-4 split next)

Sources: live-test-p8k.md (9a3a53ac5), research-p8k-gaps.md (codex lane). Runs BEFORE P10 because
G2/G3 break normal Codex main chat in Electron. Backend translation layer only, except G1 (generic
models-list scope fix; Claude has the same race). No second proxy, NEVER touch MCP, Claude
behaviour unchanged.

- Batch 8r-1 (codex -> grok review): G2 clientMessageId accepted + user echo + consumed id on
  every terminal; G3 process death settles the tab with one failed terminal + one error card;
  G6 dead-context level change returns the no-live result and saves the level. Files: agent-sdk
  codex-app-server adapter / turn-stream / events / adapter-error; rpc-handlers broadcaster,
  codex-chat-event-callbacks, native-session-controls (+ specs). Report batch-8r-1-report.md.
- Batch 8r-2 (grok -> Kimi review): G7 D14a refusal returns its exact text without
  CODEX_RUNTIME_FAILED. File: rpc-handlers chat/session/chat-session.service.ts (+ spec).
- Batch 8r-3 (grok -> Kimi review): G1 models-list carries the workspace scope; stale responses
  dropped; saved model absent from the base list still offered. Files: config-rpc.handlers.ts,
  shared rpc.types.ts, frontend core model-state.service.ts (+ specs).
- Deferred: G4 (read auto-accept stays fail-closed: no protocol proof that a non-null
  environmentId is local; needs a spike), G5 (refuted: D14 maps Ask and Auto-edit to the same
  wire policy; add a pinning resume spec in a later codex-runtime batch), G8 = D9, G9/G10 minor.
- Verify (coordinator): agent-sdk, rpc-handlers, shared, frontend core, ptah-electron; typecheck
  ptah-extension-vscode, ptah-cli, ptah-tui; vscode-core if a *_REQUEST emission moves.
- Re-check live (next run p8l): follow-up in place, killed process, dead-tab mode change, D14a
  text, saved model in composer.
- 8r-1: review-8r-1.md REVISE 5/10 -> revise 1 (bound-tab notice, typed closed-context error,
  callback-independent settlement, lint + 7 specs) -> review-8r-1-r1.md APPROVE 8/10 (grok).
  Coordinator bounded fix: `terminalError` typed `CodexChatAdapterError` (TS2339 at
  codex-chat-turn-stream.ts:310 broke typecheck of agent-sdk and every dependent).
- 8r-2: review-8r-2.md REVISE 7/10 (proposed throw REJECTED: breaks rpc-chat.types.ts:396-409
  contract) -> revise 1 generic renderer display of activationError (Claude had the same gap) ->
  review-8r-2-r1.md APPROVE 9/10 (Kimi). Coordinator bounded fix: missing setSessionProvider mock
  in session-loader.service.spec.ts activationSurface.
- 8r-3: review-8r-3.md REVISE 7/10 -> revise 1 hand-built env -> review-8r-3-r1.md REVISE 7/10
  (native claude-cli env, live-derived tiers) -> revise 2 (FINAL lane round): snapshot of the
  real env for the null scope, existing per-workspace builder for an explicit scope.
  Bounded codex correction (batch-8r-3-correction.md: one sync auth-env snapshot for both
  scopes, explicit scope pins provider and saved model) -> review-8r-3-correction.md REVISE 6/10
  (Kimi: a pre-auth same-scope read was joined after auth) -> coordinator correction 2
  (workspace-coordinator `refreshModels({ fresh: true })`) -> review-8r-3-correction-2.md
  APPROVE 9/10 (Kimi).
- Verify: C PASS 36/36 (8r-3 revise-2 state); D rpc-handlers + ptah-electron 12/12, typecheck
  ptah-extension-vscode/ptah-cli/ptah-tui 3/3; E chat + rpc-handlers lint/typecheck (see commit).
- Batch 8r-4 (next session, codex -> grok): behaviour-preserving split of
  codex-chat-adapter.ts (817 lines; was 754 before 8r) — move the session-controls group
  (setSessionPermissionLevel .. close, ~:594-751) into codex-chat-session-controls.ts with
  one-line delegates (review-8r-1-r1.md minor 1).
  COMPLETE f48351d1c (review-8r-4.md APPROVE 9/10 grok; coordinator fix: TS2554 delegate
  arity; verify G 18/18; CI 19 pass / 4 skipped).
- Live run p8l (live-test-p8l.md, head f48351d1c): R1 (G1) PASS, R2 (G2) PASS, R6 stream/Stop
  PASS; R3 (G3) FAIL: one runtime notice now shows, but the tab stays `running` (skeleton, Stop,
  Send disabled) after the app-server dies mid-turn; R4 (G6) PARTIAL (chip saved, no error);
  R5 (G7) not reproduced: Manual -> Auto-edit keeps the D14 wire policy, so no refusal (expected,
  research-p8k-gaps.md G5); p8l gap 2 is the same D14 mapping, not a defect. p8l gap 3 (branch
  fork resolves a Codex message through a Claude session file) joins G8/D9.
- Batch 8r-5 (codex -> grok): G3 settle: a Codex turn that fails with a webviewReported runtime
  error must leave the tab idle exactly like a Claude failed turn (backend translation only).
  Round 1 (review-8r-5.md REVISE 4/10 grok): the extra forceIdle raced the chat:continue reply
  `enqueued: true`, which re-arms the tab. Revise 1 (codex, batch-8r-5-revise-1.md): the
  backend returns the existing `settled: true` when the native turn ended before the reply;
  forceIdle dropped (broadcaster back to HEAD). review-8r-5-revise-1.md REVISE 6/10 (grok):
  the new resume-path `await broadcast` holds chat:continue past the renderer admission
  timeout (120 s). Coordinator correction: resume path back to fire-and-forget; specs for a
  running and an ended resumed turn -> review-8r-5-correction.md (Kimi).
- Batch G5 (Kimi -> codex): resume keeps Auto-edit/Ask/Plan. Round 1 REVISE 5/10 (specs fed the
  level); revise 1 adds codex-chat-host-ports.resume-permission.spec.ts (stateful identity
  store, host profile path, no supplied level) -> REVISE 7/10 (relative cross-lib imports,
  circular fingerprint check); coordinator correction -> review-g5-correction.md APPROVE 9/10.
- G9 (new, pre-existing; found in review-8r-5-revise-1.md): a LIVE Codex follow-up holds
  chat:continue for the whole turn (adapter sendMessageToSession awaits publish, which awaits
  the broadcaster loop). A turn longer than CHAT_ADMISSION_RPC_TIMEOUT_MS (120 s) makes the
  renderer show "Message delivery failed. RPC timeout: chat:continue" and mark the tab idle
  while the turn still runs. Fix in the backend translation layer: resolve the Codex send at
  turn admission (like Claude's enqueue), keep pre-admission errors thrown; the 8r-5 settled
  check then covers a turn that ends before the reply. Planned as batch 8r-6 (codex -> grok).
