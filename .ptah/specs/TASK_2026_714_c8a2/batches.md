# Batches - TASK_2026_714_c8a2

Total tasks: 48 | Batches: 41 | Complete: 0/41
(Not #808-blocked: 15 batches in P2/P3/P4, plus 9a, 10a, 10b once P2 is done. Blocked on
#808: 18 in P5-P10. Blocked on evidence: 5 in P11.)

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

## Batch 2a: Core contracts and ports — IN_PROGRESS

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: Claude (different from implementer)
- Rationale: types-first foundation every other core batch imports; small and self-contained
- Tasks: 2 | Depends on: none | Runnable now: YES
- Phase: P2 | Phase review: code-logic + style

### Task 2a.1: Runtime domain types — IN_PROGRESS

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

### Task 2a.2: Ports, DI tokens and initial exports — IN_PROGRESS

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

## Batch 2b: Protocol validator and version pin — IN_PROGRESS

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: Claude
- Rationale: self-contained (zod + pinned schema/manifest JSON); no import from 2a, so it runs in
  parallel with 2a
- Tasks: 2 | Depends on: none | Runnable now: YES
- Phase: P2 | Phase review: code-logic + style

### Task 2b.1: Method-specific Zod validation — IN_PROGRESS

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

### Task 2b.2: Manifest and version pin check — IN_PROGRESS

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

## Batch 2d: App Server process and JSONL transport — PENDING

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential | Subagent reason: N/A | Review family: Claude
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Rationale: lifecycle/timeout logic is dense; isolated in one file + spec
- Tasks: 1 | Depends on: 2a, 2b | Runnable now: after 2a+2b
- Phase: P2 | Phase review: code-logic + style

### Task 2d.1: Process lifecycle — PENDING

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

## Batch 2e: Execution profile builder — PENDING

- Recommended executor: CLI lane, Codex family | Execution mode: sequential | Review family:
  Claude | Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 2a | Runnable now: after 2a
- Phase: P2 | Phase review: code-logic + style

### Task 2e.1: buildCodexExecutionProfile — PENDING

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

## Batch 2f: Permission policy and rule store — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: 2a, 2b | Runnable now: after 2a+2b
- Phase: P2 | Phase review: code-logic + style

### Task 2f.1: CodexPermissionPolicy — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-permission-policy.ts,
  W/libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts
- Plan reference: implementation-plan.md:205-224; C2, C3, C7
- Implementation details: pure decision function (level, request kind, rule-store hit) ->
  `present` | auto `accept`/`acceptForSession`/`decline`. auto-edit auto-accepts only
  fileChange; commands/MCP/permissions keep a prompt; yolo auto-accepts ordinary classes but
  never userInput (questions stay interactive); plan never auto-accepts writes.

### Task 2f.2: CodexPermissionRuleStore — PENDING

- Files: CREATE W/libs/backend/codex-runtime/src/lib/codex-permission-rule-store.ts,
  W/libs/backend/codex-runtime/src/lib/codex-permission-rule-store.spec.ts
- Plan reference: implementation-plan.md:218, :222; C3
- Implementation details: in-memory, scope key provider+home+workspace+kind(+command prefix /
  file scope / MCP server+tool); survives child restart (lives on the runtime, not the process);
  explicit `clear(scope)`; host dispose clears; no disk persistence; does not import the agent-sdk
  PermissionRuleStore.

### Batch 2f verification

- Scoped command passes; spec proves cross-home/workspace/tool isolation.

## Batch 2h: Event translator — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 2a, 2b | Runnable now: after 2a+2b
- Phase: P2 | Phase review: code-logic + style

### Task 2h.1: CodexEventTranslator — PENDING

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

## Batch 2c: Legacy Codex lane reads auth from its execution home — IN_PROGRESS

- Recommended executor: CLI lane, Codex family, backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: Claude
- Rationale: required interim fix (plan :153, requirement 4.5); files not in #808; independent of
  the core
- Tasks: 1 | Depends on: none | Runnable now: YES
- Phase: P3 | Phase review: code-logic

### Task 2c.1: Explicit/env CODEX_HOME for credential reads — IN_PROGRESS

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

## Batch 3c: AuthOperationContext and CodexProxyPolicy — PENDING

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 2 | Depends on: none (eligible for Wave 1) | Runnable now: YES
- Phase: P4 | Phase review: code-logic

### Task 3c.1: Proxy policy — PENDING

- Files: CREATE W/libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts,
  W/libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts; MODIFY
  W/libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts
- Plan reference: implementation-plan.md:157-165
- Implementation details: `AuthOperationContext` {reason, hostNativeCodex, providerId,
  normalizedHome?}; policy decides native-return-before-env-teardown vs legacy proxy start.
  Omitted context = current behavior (hostNativeCodex defaults false; nothing enables it here).

### Task 3c.2: Keyed AuthManager flights — PENDING

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

## Batch 3b: Home-bound usage service and quota reader — PENDING

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

# Phase P5 — Shared contracts, profile seam, auth exports — BLOCKED on #808 merge + rebase

Phase review: code-logic + style (new public API). Implementer: Codex; reviewer: Claude.
First step of every P5 batch: confirm #808 merged, this branch rebased, re-read the touched files.

## Batch 5a: SessionRuntimeIdentity and shared contracts — PENDING (blocked on #808)

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: #808 merge | Phase: P5
- Files: CREATE W/libs/shared/src/lib/types/session-runtime.types.ts and
  `session-runtime.types.spec.ts` (same dir); MODIFY W/libs/shared/src/index.ts,
  W/libs/shared/src/lib/types/agent-adapter.types.ts (additive only),
  W/libs/shared/src/lib/types/rpc.types.ts,
  W/libs/shared/src/lib/types/messages/message-constants.ts
- Plan reference: implementation-plan.md:49, :167-181, :199, :360-363
- Details: SessionRuntimeIdentity, SessionRuntimeControls, PermissionLevel reuse, AppliedSettings
  re-use; typed session-scoped approval cancel message; Codex approval request payload carries
  `allowedDecisions` (accept, acceptForSession, decline, cancel) so the UI can render them (C1).
  RPC names/result shapes unchanged.
- Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/shared --parallel=1`,
  then typecheck of dependents changed later phases cover (shared is wide: run
  `npx nx run-many -t typecheck -p ptah-electron ptah-extension-vscode ptah-cli --parallel=1`).

## Batch 5b: resolveExecutionProfile seam — PENDING (blocked on #808, needs 5a, P2)

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 5a, 2k | Phase: P5
- Files: MODIFY W/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts
  and its spec
- Plan reference: implementation-plan.md:51-74
- Details: native branch returns a credential-safe CodexProfileSeed without proxyPool.acquire,
  global proxy start, configureAuthentication or env mutation; legacy branch unchanged; failed
  workspace resolution never falls back to global credentials.
- Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/auth-providers
--parallel=1`

## Batch 5c: auth-providers registration, owner resolver, exports — PENDING (blocked on #808)

- Recommended executor: CLI lane, Codex family | sequential | Review family: Claude |
  Subagent reason: N/A
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Tasks: 1 | Depends on: 3a, 3b, 5b | Phase: P5 (last batch -> phase review)
- Files: MODIFY W/libs/backend/auth-providers/src/lib/di/register.ts,
  W/libs/backend/auth-providers/src/lib/providers/register-providers.ts,
  W/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts and its spec,
  W/libs/backend/auth-providers/src/index.ts
- Plan reference: implementation-plan.md:151 (`provider-owner.resolver.ts:458`), :369
- Details: register CodexHomeAuthService (single owner), proxy policy; owner resolution uses the
  same home as the read; nullable registrations `{ useFactory: () => null }`.
- Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/auth-providers
--parallel=1`

---

# Phase P6 — Chat runtime consumer (@ptah-extension/agent-sdk) — BLOCKED on #808 merge + rebase

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

## Batch 6d: Metadata identity and legacy auth propagation — PENDING (blocked on #808)

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

# Phase P7 — Chat RPC (@ptah-extension/rpc-handlers) — BLOCKED on #808 merge + rebase

Phase review: code-logic. Implementer: Codex; reviewer: Claude.
Verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/rpc-handlers
--parallel=1`. Prefix R = W/libs/backend/rpc-handlers/src/lib/.

## Batch 7a: ChatRuntimeProfileService — PENDING (needs 5b, 6e)

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

# Phase P8 — Host composition (disabled) and approval presentation — BLOCKED on #808 merge + rebase

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

## Batch 9a: Gateway adapter and approval sink — PENDING (runnable after P2; not #808-blocked)

- Files: CREATE G+codex-gateway-adapter.ts, G+codex-gateway-approval-sink.ts, each with same-stem
  spec
- Plan reference: implementation-plan.md:203, :250, :393
- Details: thin projection to FlatStreamEventUnion; explicit sink required (missing sink fails
  before a turn); unroutable interaction declines, never auto-allows; a notice is not an approval.
- Executor: CLI lane, Codex family | Review: Claude | standard fallback | Subagent reason: N/A

## Batch 9b: Gateway profile and bridge integration — PENDING (BLOCKED: needs 5b)

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

## Batch 10a: Lane profile and events — PENDING (runnable after P2)

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

## Batch 10c: Detection factory and interface — PENDING (BLOCKED on #808)

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

## Batch 11d: History/rewind routers — PENDING (blocked on evidence + #808)

- Files: CREATE W/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts,
  `session-rewind-router.ts`, each with same-stem spec

## Batch 11e: RPC history delegation — PENDING (blocked on evidence + #808)

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
