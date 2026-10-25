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
enable a consumer, flip a capability default, or remove the translation proxy or the codex-sdk
lane path (Removals A and B are out of scope).

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
- P11 stays BLOCKED until new evidence or a user-approved reduction.

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

# Phase P5 — Shared contracts, usage home API, profile seam — UNBLOCKED (#808 merged 2026-10-25)

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

## Batch 5c: resolveExecutionProfile seam, same-home owner resolution, exports — COMPLETE (verified; commit below)

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

### P5 risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R5-1 usage default-home result changes for users | HIGH | P5-D1; 5b spec pins default path unchanged |
| R5-2 shared additive change breaks a host | MEDIUM | Host typecheck at the phase gate |
| R5-3 native seed path touches proxy/global auth | HIGH | 5c.1 spies assert zero calls |
| R5-4 parallel 5a/5b lanes see each other's half edits | LOW | Disjoint projects; lanes report, never fix, foreign failures |
| R5-5 owner key for explicit home leaks default owner | MEDIUM | 5b + 5c.2 specs |

---

# Phase P6 — Chat runtime consumer (@ptah-extension/agent-sdk) — UNBLOCKED (#808 merged 2026-10-25; re-validate files before running)

Phase review: code-logic + style. Implementer: Codex; reviewer: Claude.
Verification for every P6 batch:
`npx nx run-many -t test typecheck lint -p @ptah-extension/agent-sdk --parallel=1`.
Prefix D = W/libs/backend/agent-sdk/src/lib/codex-app-server/ (new directory).

## Batch 6a: Chat events and approval routing — PENDING (needs 5a, P2)

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Files: CREATE D+codex-chat-events.ts, D+codex-chat-approval-sink.ts,
  D+session-approval-router.ts, each with same-stem spec (6 files)
- Plan reference: implementation-plan.md:197-199, :244
- Details: project CodexRuntimeEvent -> FlatStreamEventUnion; sink offers the four decisions; an
  edit reply returns decline + editNotSupported and the consumer posts the user's text as a
  follow-up (steer when a turn is active, else new turn); Claude requests keep the SDK handler.

## Batch 6b: Codex chat adapter and routing adapter — PENDING (needs 6a)

- Files: CREATE D+codex-chat-adapter.ts, D+routing-agent-adapter.ts, each with same-stem spec
- Plan reference: implementation-plan.md:25, :187
- Details: IAgentAdapter over the identity router; no proxy fallback after native selection;
  routing decided by persisted identity, never the focused provider; native path guarded by
  CodexParityGate (disabled).
- Executor/review/fallback as 6a.

## Batch 6c: Runtime-neutral session controls — PENDING (needs 5a)

- Files: CREATE D+session-runtime-router.ts, D+legacy-session-controls.ts, each with same-stem
  spec
- Plan reference: implementation-plan.md:171-191
- Details: SDK aliases (incl. live yolo -> bypassPermissions) only in LegacySessionControls;
  apply-before-save with rollback; failed interrupt blocks follow-up.
- Executor/review/fallback as 6a.

## Batch 6d: Metadata identity and legacy auth propagation — PENDING (#808 merged; re-validate)

- Files: MODIFY W/libs/backend/agent-sdk/src/lib/session-metadata-store.ts and
  `session-metadata-store.spec.ts`, W/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts;
  CREATE W/libs/backend/agent-sdk/src/lib/legacy-runtime-auth.spec.ts
- Plan reference: implementation-plan.md:161, :230
- Details: optional `codexExecution` metadata via `updateCodexExecution` (sole writer, existing
  enqueueWrite); save preserves omitted runtime metadata; never converts a legacy row; SDK adapter
  change limited to typed AuthOperationContext propagation (`initialize(context?)`).
- Executor/review/fallback as 6a.

## Batch 6e: agent-sdk DI and exports — PENDING (needs 6a-6d)

- Files: MODIFY W/libs/backend/agent-sdk/src/lib/di/tokens.ts,
  W/libs/backend/agent-sdk/src/lib/di/register.ts, W/libs/backend/agent-sdk/src/index.ts
- Details: register routers/adapters; native capability injected by host, default disabled;
  `{ useFactory: () => null }` for nullable bindings. Last P6 batch -> phase review.
- Executor/review/fallback as 6a.

---

# Phase P7 — Chat RPC (@ptah-extension/rpc-handlers) — UNBLOCKED (#808 merged 2026-10-25; re-validate files before running)

Phase review: code-logic. Implementer: Codex; reviewer: Claude.
Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/rpc-handlers
--parallel=1`. Prefix R = W/libs/backend/rpc-handlers/src/lib/.

## Batch 7a: ChatRuntimeProfileService — PENDING (needs 5c [resolveExecutionProfile, was 5b], 6e)

- Files: CREATE R+chat/session/chat-runtime-profile.service.ts and same-stem spec
- Plan reference: implementation-plan.md:95 (G1)
- Executor: CLI lane, Codex family | Review: Claude | Fallback: standard order | Subagent reason:
  N/A

## Batch 7b: Chat start/resume and slash routing — PENDING (needs 7a)

- Files: MODIFY R+chat/session/chat-session.service.ts,
  R+chat/session/chat-slash-command-router.service.ts; CREATE
  R+chat/session/chat-slash-command-router.native.spec.ts
- Plan reference: implementation-plan.md:95, :189 (admission `:130-141`, `:169-185`,
  release `:243-249` — re-locate after rebase)
- Details: both start and resume delegate to prepare(); native /compact ->
  SessionRuntimeControls.compact; legacy slash unchanged.
- Executor/review/fallback as 7a.

## Batch 7c: Config RPC through SessionRuntimeControls — PENDING (needs 6c)

- Files: MODIFY R+handlers/config-rpc.handlers.ts; CREATE R+handlers/config-runtime-controls.spec.ts
- Plan reference: implementation-plan.md:181-185 (G2); remove `mapPermissionToSdkMode` direct SDK
  calls; audit auth/provider/config-scope callers.
- Executor/review/fallback as 7a. Last P7 batch -> phase review.

---

# Phase P8 — Host composition (disabled) and approval presentation — UNBLOCKED (#808 merged 2026-10-25; re-validate files before running)

Phase review: code-logic; visual review (Electron, dark + light) for 8c. Electron first; VS Code
and CLI get compatible bindings only (no feature work).

## Batch 8a: Electron DI composition — PENDING (needs P5-P7)

- Recommended executor: CLI lane, Codex family | Review: Claude | Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Files: MODIFY W/apps/ptah-electron/src/di/phase-2-libraries.ts, `expected-resolvable.ts`,
  `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`; CREATE
  W/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts
- Details: register core ports with the BUNDLED codex binary path (R4); real router resolves
  native-off by default; spec asserts CodexParityGate disabled (R5).
- Verification: `npx nx run-many -t test typecheck lint -p ptah-electron --parallel=1`

## Batch 8b: Electron IPC approval ownership — PENDING (needs 8a)

- Files: MODIFY W/apps/ptah-electron/src/ipc/ipc-bridge.ts; MODIFY
  W/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts and its spec
- Details: IPC routes request ownership to SessionApprovalRouter; typed session-scoped cancel;
  cancelPrompt posts no response.
- Verification: `npx nx run-many -t test typecheck lint -p ptah-electron @ptah-extension/chat
--parallel=1` (confirm header says 2 projects)
- Executor/review as 8a.

## Batch 8c: Codex approval decisions in the permission prompt — PENDING (needs 5a)

- Recommended executor: frontend-developer subagent
- Subagent reason: rendered UI change needs Electron dark/light screenshots (visual work a lane
  cannot capture)
- Review family: Codex CLI lane (code-logic), plus visual-reviewer in Electron
- Files: MODIFY W/libs/frontend/chat-streaming/src/lib/permission-handler.service.ts and
  `permission-handler.service.spec.ts`; plus the existing permission prompt component that
  renders decisions (executor locates it; max 4 files, chat-streaming + chat only)
- Details: when a request carries `allowedDecisions`, render exactly those (accept, accept for
  session, decline, cancel) and no edit control; Claude prompts unchanged. Before/after
  screenshots (dark + light) from the base commit.
- Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-streaming
--parallel=1`

## Batch 8d: VS Code compatible bindings — PENDING (needs 8a)

- Files: MODIFY W/apps/ptah-extension-vscode/src/di/phase-2-libraries.ts, `expected-resolvable.ts`,
  `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`
- Details: compatible ports, legacy chat default; no UI rollout.
- Verification: `npx nx run-many -t test typecheck lint -p ptah-extension-vscode --parallel=1`
- Executor/review as 8a.

## Batch 8e: CLI engine and ptah-cli bindings — PENDING (needs 8a)

- Files: MODIFY W/libs/backend/cli-engine/src/lib/container.ts,
  W/libs/backend/cli-engine/src/lib/surface-composition.spec.ts,
  W/apps/ptah-cli/src/di/expected-resolvable.ts; CREATE
  W/libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts
- Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/cli-engine ptah-cli
--parallel=1`
- Executor/review as 8a. Last P8 batch -> phase review.

---

# Phase P9 — Gateway consumer (@ptah-extension/gateway-chat-bridge)

Phase review: code-logic. Implementer: Codex; reviewer: Claude. Verification:
`npx nx run-many -t test typecheck lint -p @ptah-extension/gateway-chat-bridge --parallel=1`.
Prefix G = W/libs/backend/gateway-chat-bridge/src/lib/.

## Batch 9a: Gateway adapter and approval sink — COMPLETE (merged in #809)

- Files: CREATE G+codex-gateway-adapter.ts, G+codex-gateway-approval-sink.ts, each with same-stem
  spec
- Plan reference: implementation-plan.md:203, :250, :393
- Details: thin projection to FlatStreamEventUnion; explicit sink required (missing sink fails
  before a turn); unroutable interaction declines, never auto-allows; a notice is not an approval.
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

## Batch 9b: Gateway profile and bridge integration — PENDING (needs 5c [resolveExecutionProfile, was 5b])

- Files: CREATE G+codex-gateway-profile.ts and spec, G+gateway-chat-bridge.native.spec.ts; MODIFY
  G+gateway-chat-bridge.ts (native branch only at `:689-697`, `:794-865`), G+di/register.ts,
  W/libs/backend/gateway-chat-bridge/src/index.ts
- Details: no legacy new-session fallback on ambiguous native resume (`:835-845`); Claude gateway
  unchanged; native branch gated off. Last P9 batch -> phase review.
- Executor/review as 9a. (6 files incl. index; gateway-chat-bridge.spec.ts untouched unless a
  regression requires it — then split.)

---

# Phase P10 — Lane consumer (@ptah-extension/cli-agent-runtime)

Phase review: code-logic. Implementer: Codex; reviewer: Claude. Verification:
`npx nx run-many -t test typecheck lint -p @ptah-extension/cli-agent-runtime --parallel=1`.
Prefix L = W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/.

## Batch 10a: Lane profile and events — COMPLETE (merged in #809)

- Files: CREATE L+codex-lane-profile.ts, L+codex-lane-events.ts, each with same-stem spec
- Plan reference: implementation-plan.md:246
- Details: preserve suppression of user MCP/plugins/apps/skills, Ptah MCP attachment,
  zero-omits-budget, role resend (replace, not append); do not copy approval_policy=never or
  danger-full-access defaults; events -> CliOutputSegment; terminal settles without waiting for
  exit (Windows).
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

## Batch 10b: App Server lane adapter — PENDING (needs 10a)

- Files: CREATE L+codex-app-server-lane.adapter.ts and spec;
  CREATE W/libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts
- Details: implements CliAdapter.runSdk/SdkHandle over CodexContext; steer:false, interrupt:false
  capability preserved; abort disposes context; no Codex SDK import; never retries via SDK.
  Uses the current `cli-adapter.interface.ts` unchanged (interface additions are 10c).
- Executor/review as 10a.

## Batch 10c: Detection factory and interface — PENDING (#808 merged; re-validate)

- Files: MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts
  (factory instead of direct construction at :57),
  W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts
  (optional Codex context/policy), W/libs/backend/cli-agent-runtime/src/index.ts
- Details: legacy adapter remains default; native lane selection gated off. Last P10 batch ->
  phase review.
- Executor/review as 10a.

---

# Phase P11 — Evidence-gated history, rewind, subagents — BLOCKED ON EVIDENCE

No batch in this phase may start, and no refusal-only placeholder may be built, until the
required observations (native-route-evidence.md rows 3-5: history/pages/stats, real file rewind,
subagent controls) are proved by a user-approved spike, or the user approves a reduction.
2 of 20 approved model turns remain; they are insufficient for these observations.

## Batch 11a: Native history reader — PENDING (blocked on evidence)

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-session-history.ts and spec
- Plan reference: implementation-plan.md:232-234

## Batch 11b: Native file history — PENDING (blocked on evidence)

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-file-history.ts and spec
- Plan reference: implementation-plan.md:236

## Batch 11c: Native subagent controls — PENDING (blocked on evidence)

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-subagent-controls.ts and spec
- Plan reference: implementation-plan.md:238

## Batch 11d: History/rewind routers — PENDING (blocked on evidence; #808 merged)

- Files: CREATE W/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts,
  `session-rewind-router.ts`, each with same-stem spec

## Batch 11e: RPC history delegation — PENDING (blocked on evidence; #808 merged)

- Files: MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts,
  W/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts; CREATE
  W/libs/backend/rpc-handlers/src/lib/handlers/session-native-history.spec.ts

All P11 batches: executor CLI lane, Codex family; reviewer Claude; phase review code-logic.

---

## Out of scope for this batch plan

- Enabling any consumer (chat, gateway, lane) for users: requires every required observation or
  user-approved reductions, then a separate rollout decision.
- Removal A (translation proxy) and Removal B (codex-sdk lanes): only after parity and separate
  user confirmation.
- Runtime selector UI, TUI and VS Code feature work.
