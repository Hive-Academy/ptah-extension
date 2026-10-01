# Batches - TASK_2026_584_5e7a

Total tasks: 38 | Batches: 9 | Complete: 5/9

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-584` (branch
`feat/task-584-agent-sessions`, base `origin/main` a90c086d7). Every path below is
absolute under that root. Plan: `implementation-plan.md` Revision 1 (APPROVED
2026-10-01). User decisions: `context.md` (final).

## Handoff (session end 2026-10-01) — resume from here

State per batch (statuses also on each batch header below):

| Batch                                                       | Status                                                           | Commit    | Review                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | --------- | -------------------------------------- |
| B1 agent-sdk unattended policy + metadata cwd               | COMPLETE                                                         | 7165e2379 | code-logic-review-b1.md APPROVED 9/10  |
| B2 MCP subagent root registrar                              | COMPLETE                                                         | 38d3e511e | code-logic-review-b2.md APPROVED 9/10  |
| B3 link layer                                               | COMPLETE                                                         | 8fa3c7312 | b3 REVISE 6/10 -> b3-r1 APPROVED 10/10 |
| B4 chat-path host, shared contracts, `chat:agent-sessions`  | COMPLETE (with B5)                                               | 590ea1d2a | code-logic-review-b4.md APPROVED 8/10  |
| B5 provisioner, spawner, contract, settings                 | COMPLETE (with B4)                                               | 590ea1d2a | code-logic-review-b5.md APPROVED 9/10  |
| B6 MCP surface, report fallback, shutdown, lazy host lookup | READY, not started                                               | —         | —                                      |
| B7 frontend adoption, badge, banner                         | code review APPROVED; visual review NOT run; UNCOMMITTED on disk | —         | b7 REVISE 8/10 -> b7-r1 APPROVED 10/10 |
| B8 skills + docs                                            | PENDING (after B6)                                               | —         | —                                      |
| B9 real-host smoke S1-S11                                   | PENDING (after B6 and B7)                                        | —         | —                                      |

Next steps, in order:

1. B7: run visual-reviewer (dark + light; before from base a90c086d7), then commit B7's 19 files by path (`git status --short -- libs/frontend apps/ptah-extension-webview`). The uncommitted B7 files exist only in this local worktree; they are not in the pushed branch.
2. B6: launch backend-developer with the Batch 6 section (6 tasks incl. Task 6.6). B6 and B7 share no files.
3. B8 (technical-content-writer) and B9 (senior-tester, real host) in parallel after B6 (B9 also after B7).

Review routing: cross-side CLI lane, antigravity only (Glm hit its Ollama Cloud usage limit, 429; codex unavailable until 2026-10-03); one lane at a time when TASK_2026_580's team-leader also uses antigravity. Resume a lane's CLI session for a re-review.

Commit rules learned this session: the pre-commit hook runs `nx affected --target=lint`, which includes `di-lint` (every `@inject` token must be registered in some `register*.ts`; no suppression) and `degradation-audit` (every swallowing catch needs a `// degradation-audit: <kind> - <reason>` marker; per-lib baseline). Run `npx nx run-many -t lint -p di-lint,degradation-audit` before committing. Never `--no-verify`.

Pre-existing test failures (fail on the untouched base; not task failures): cli-agent-runtime `capabilities/claude-approval.reader.spec.ts` "with a real git" (git > 5 s jest timeout under load); rpc-handlers `harness/selection/harness-skill-selection-rpc.service.spec.ts` "never writes state.json"; flaky under load: agent-sdk `off-thread-process-spawner.spec.ts:836`, rpc-handlers `skills-sh-legacy-adoption.spec.ts`, one platform-core case.

Open items and rulings:

- O1 B7 visual review not run; B7 uncommitted (step 1).
- O2 Task 6.6 (lazy `CHILD_CHAT_SESSION_HOST` lookup in the spawner; lazy `SESSION_SPAWNER` in `PtahAPIBuilder`) — from the B5 review's MINOR; supersedes the Task 6.5 construction-order check; smoke S1 still confirms no `chat-runtime-unavailable` per host.
- O3 B2 review MINOR (accepted): the registrar keys retained roots by raw path string; the spawner passes the identical `worktreePath` to retain and release (B5 spec pins it).
- O4 B2 out of scope (accepted): no `register.spec.ts` case for the registrar shim's degraded path.
- O5 B3 ruling: `pruneEnded(20)` drops ended records; a pruned child's tab loses attribution and the depth guard, same as after a host restart (plan :950-955); TASK_2026_580's durable record closes it.
- O6 B1 "Always Allow" ruling: no defect; a rule created from a child's prompt applies to interactive sessions only. The coordinator is raising the UX nuance with the user.
- O7 B4 deviations accepted: child start keeps a precomputed `mcpServerRunning`; child start merges Smithery/OAuth MCP overrides.
- O8 B5 deviations accepted: slash-command task goes first then the contract; `deniesAt: 'unbounded'` when no timeout; `read()` truncates by characters; "ended while working" from phase `generating`; existing target dir -> `worktree-failed`.
- O9 B7 deviations accepted: closed-child memory; parser in the adoption service; `addTabToWorkspace(..., afterTabId)`; banner says "for a limited time" (payload has no deny window); workspace trigger is a root effect (also fires at bootstrap). A late tab that already holds streamed turns is not auto-loaded (accepted, see Batch 7).
- O10 Assumptions still to prove in B9: A1 (push before first chunk), A3 (subagents read `<cwd>/.mcp.json`), A4 (`acceptEdits` only inside cwd), A5 (transcript by worktree cwd); A2 resolved in B7; A6 closed (no allowlist edit).
- O11 TASK_2026_580 coordination (Batch 5 note): no SQLite in 584; whichever task merges second adds the one `recordAgentStartedSession` call.
- O12 Completion gate (Mode 3): B7 rendered evidence (dark + light), write-path trace for metadata `workingDirectory` (B1) and persisted `TabState.agentOrigin` (B7).

## Recorded execution defaults

- Batch shape B1-B9 follows the plan handoff (implementation-plan.md:1196-1224)
  and the user's execution request: B1, B2, B3 in parallel; B4 after B3; B7 in
  parallel with B5-B6; B8 and B9 in parallel. Several batches exceed the usual
  6-file limit; they are kept whole because the user fixed this shape. Each
  batch still has one scoped verification command.
- Two file-ownership moves (decomposition only, no design change), see
  Plan validation F1 and F2: the shared payload file moves from B4 to B3, and
  `session-children/index.ts` is created in B3 (B5 extends it).
- Nx project names for libs are scoped (`@ptah-extension/<lib>`); the plan's
  `npx nx test agent-sdk` form does not resolve. Every command below uses the
  scoped names. `-p` takes a comma-separated list.
- Code review is cross-side: executors are in-process subagents, so each
  batch's independent review is a CLI lane. Primary vendor: antigravity;
  fallback: Glm; codex is unavailable until 2026-10-03. Output file:
  `D:\projects\ptah-extension\.claude-worktrees\task-584\.ptah\specs\TASK_2026_584_5e7a\code-logic-review-b<N>.md`.
  The lane is read-only and never runs git. The team-leader commits only after
  an APPROVED verdict.
- Parallel batches share one working tree. An executor must not edit any file
  outside its batch list. A typecheck failure caused by a sibling batch's
  in-flight file is re-run after that batch settles, not "fixed".

## Precondition (orchestrator, before launching B1-B3)

- P0: the worktree has no `node_modules` (verified: `ls node_modules` fails in
  the task-584 worktree). Run ONE `npm ci` in the worktree root before the
  parallel launch. The three executors must not each install (concurrent
  installs race on the same folder). No batch verification command can run
  until this is done.

## Plan validation

Status: PASSED WITH RISKS

Findings from checking the plan against the code (none blocks decomposition):

- F1 (RISK, ordering): `session-spawner.port.ts` (component 3, B3) imports
  `AgentSessionOpenedPayload` from `@ptah-extension/shared`
  (implementation-plan.md:391,404,415), but the plan creates that type in
  component 5 (B4, :617). With B3 before B4, B3 would not typecheck.
  Resolution: B3 owns
  `libs/shared/src/lib/types/messages/agent-session.ts` and its one export
  line in `libs/shared/src/lib/types/messages/index.ts` (where `./gateway` is
  exported, `index.ts:13`). B4 keeps message-constants, payload-map and the
  RPC types. B1 and B2 do not touch `shared`, so B1-B3 stay file-disjoint.
- F2 (RISK, ordering): B3 adds "one grouped export for `./lib/session-children`"
  to `cli-agent-runtime/src/index.ts` (:506), but the plan creates
  `session-children/index.ts` in component 6 (B5, :701). Resolution: B3
  creates the folder barrel (ports + registry); B5 extends it.
- F3 (verified): `SdkAgentAdapter.startChatSession` passes
  `resolvedProjectPath` as the first argument of `createSessionIdCallback`
  (`sdk-agent-adapter.ts:768-775`), and the callback calls
  `metadataStore.create(realSessionId, workspaceId, sessionName)` (`:1140`).
  That is the only `metadataStore.create` call in the adapter; the resume path
  (`:1006`) does not create metadata. Revision 1's change applies as written.
- F4 (verified, plan assumption corrected): `chat-session.service.spec.ts` does
  not exist. The folder has topic specs (`chat-session-auth.spec.ts`,
  `chat-session-mcp-status.spec.ts`, ...). B4 creates
  `chat-session-agent-child.spec.ts` in that pattern.
- F5 (verified, A6 closed): the host RPC profiles
  (`apps/ptah-extension-vscode/src/rpc-host-profile.ts`,
  `apps/ptah-electron/src/rpc-host-profile.ts`) do not enumerate chat methods.
  `chat:agent-sessions` needs no allowlist edit.
- F6 (verified): `http-mcp-server.service.spec.ts` exists; `CodeExecutionMCP`
  (`http-mcp-server.service.ts:163`) has `enqueueMcpOp` (:318) and
  `desiredSlots` (:521); the `MCP_SERVER_STATUS` shim is at
  `vscode-lm-tools/src/lib/di/register.ts:109`.
- F7 (verified): `SdkPermissionHandler` constructor has three injected
  parameters (`sdk-permission-handler.ts:155-161`) and `onPromptLifecycle`
  exists (:199). The registry goes in as an optional fourth parameter.
- F8 (RISK, new import edge): the spawner injects
  `MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER`. `cli-agent-runtime` does not
  import `@ptah-extension/memory-contracts` today, and its `package.json`
  lists its workspace dependencies. The edge is legal (`type:feature` ->
  `type:core`), but B5 must add the dependency to
  `libs/backend/cli-agent-runtime/package.json` if the lint dependency check
  requires it.
- F9 (verified): `AgentReportInput` is used only inside `cli-agent-runtime`
  (`cli-agents/index.ts:41` re-export). Widening it to a union in B3 does not
  break other libs; the vscode-lm-tools caller still builds the `agentId`
  branch until B6.
- F10 (RISK, completion gate): B7 adds a UI surface (badge, banner) with no
  prototype and no design handoff. Mode 3 requires rendered evidence. B7's
  review adds a visual-reviewer pass with before/after screenshots in dark and
  light themes; the "before" is taken from base commit a90c086d7.
- F11 (verified): webview bootstrap registers `ChatMessageHandler` in
  `apps/ptah-extension-webview/src/app/app.config.ts:171`; the adoption service
  is started from the same file.

Assumptions:

- A1 (push arrives before the first chunk) — unverified; smoke S1 (B9).
- A2 (late-adopted tab loads history through the sidebar lazy loader) —
  unverified; Task 7.3 locates the trigger before coding, smoke S1b.
- A3 (Task subagents read `<cwd>/.mcp.json`) — unverified; smoke S3.
- A4 (`acceptEdits` auto-approves only inside cwd) — unverified; smoke S7.
- A5 (transcript reader finds the child JSONL by worktree cwd) — unverified;
  Task 5.4 spec plus smoke S6.
- A6 (host RPC allowlists) — verified false, no edit needed (F5).
- A7 (policy registry resolvable when the handler is built) — Task 1.2 registers
  the registry before `SDK_PERMISSION_HANDLER` in agent-sdk `di/register.ts`
  (tsyringe resolves an optional dependency once; a late registration would
  leave the handler without it forever).

| Risk                                              | Severity                   | Mitigation                                                                            |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| F1 shared payload type needed before B4           | HIGH                       | Task 3.1 (file moved into B3)                                                         |
| F2 folder barrel needed before B5                 | MEDIUM                     | Task 3.6 creates it, Task 5.5 extends it                                              |
| Parallel batches share one working tree           | MEDIUM                     | File-disjoint lists; executors edit only their files; team-leader stages per batch    |
| A7 optional registry resolved too early           | MEDIUM                     | Task 1.2 registration order + a spec that resolves the handler from a container       |
| `startSession` behaviour drift during extraction  | HIGH                       | Task 4.2 pins `workspaceId === projectPath` for `startSession` with a spec            |
| R4 `steer` interrupt timeout retires the child    | MEDIUM                     | Task 5.4 records `ended` with reason; tool text in Task 6.1 names `queue` as default  |
| Lane verdict drift from the stricter session rule | MEDIUM                     | Task 3.5 keeps the lane branch unchanged; existing notifier specs must pass untouched |
| F8 new import edge                                | LOW                        | Task 5.5                                                                              |
| F10 UI evidence                                   | MEDIUM                     | B7 review adds visual-reviewer before/after (dark + light)                            |
| Tool list must stay byte-identical per caller     | MEDIUM                     | Task 6.3 + sweep spec in Task 6.4                                                     |
| No node_modules in worktree                       | HIGH (blocks verification) | P0                                                                                    |

Edge cases:

- Bash matcher metacharacters (`\n ; & | \` $( < >`) refused — Task 1.1
- Policy session prompt never uses `timeoutAt = 0`; window clamp 0..600000, `0` = deny now — Task 1.3
- Unregistered routing id takes the unchanged path — Task 1.3
- Omitted `config.workspaceId` keeps today's metadata byte-identical — Task 1.4
- Retained root survives a folder-change reconcile; release idempotent — Task 2.2
- Slot reservation race (two starts, one slot) — Task 3.3
- Child report while parent not live -> `parent-session-not-active`, counted, not queued — Task 3.4
- Deliverable mtime equal to `startedAt` counts as written; checkout-time file is `NOT written by this run` for sessions only — Task 3.5
- Announced tab + failed or thrown start -> exactly one `CHAT_ERROR`; not announced -> none — Task 4.3
- Rollback steps each reported, never throw — Tasks 5.1, 5.4
- Held completion: latest per child, returned once — Task 5.4, Task 6.1
- Parent resumed under a new tab id still owns its children — Task 5.4
- Child grace: re-registration within 30 s cancels — Task 5.4
- `dispose()` sync and idempotent, no push after shutdown — Tasks 5.4, 6.5
- Adoption idempotent, parent absent -> no-op, no focus change — Task 7.3

## Batch 1: agent-sdk unattended policy + metadata cwd — COMPLETE (commit 7165e2379)

- Review: code-logic-review-b1.md APPROVED 9/10 (antigravity), no defects; Always Allow ruling: no defect (children never reach the rule store). Accepted deviations: workingDirectory is the 5th create() param; extra args passed only when cwd differs; policy prompts excluded from sibling auto-resolve. off-thread-process-spawner.spec failure did not reproduce (full agent-sdk suite 2400/2400 on re-run).
- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: one lib, tightly coupled edits (the handler branch uses the
  registry and matcher; the adapter and store change together).
- Tasks: 4 | Depends on: P0
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b1.md`.
  Scope: permission decision order and the "never allow on exception" rule,
  bounded window, metadata identity for existing callers.

Files (exact):

- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\permission\unattended-bash-policy.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\permission\unattended-bash-policy.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\permission\unattended-session-policy.registry.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\permission\unattended-session-policy.registry.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\sdk-permission-handler.unattended.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\session-metadata-store.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\lib\di\register.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\agent-sdk\src\index.ts`

### Task 1.1: Bash allowlist matcher — COMPLETE

- File: `...\agent-sdk\src\lib\permission\unattended-bash-policy.ts` (+ spec)
- Plan reference: implementation-plan.md:198-201, 265
- Pattern to follow: `libs/backend/agent-sdk/src/lib/permission/permission-tool-classifier.ts:13-64` (pure module)
- Quality requirements: pure `evaluateUnattendedBash(command, allowlist)`; refuse newline, `;`, `&`, `|`, backtick, `$(`, `<`, `>`; token-boundary, case-sensitive prefix match; exception -> not allowed.
- Validation notes: spec is a table (allowed, refused per metacharacter, token boundary `git statusx` refused, case).
- Implementation details: no imports beyond TS; returns `{ allowed: boolean; reason?: string }`.

### Task 1.2: Policy registry, token, registration, barrel — COMPLETE

- Depends on: Task 1.1
- File: `...\permission\unattended-session-policy.registry.ts` (+ spec), `di\tokens.ts`, `di\register.ts`, `src\index.ts`
- Plan reference: implementation-plan.md:195-197, 260-263, 281-282
- Pattern to follow: agent-sdk `di/tokens.ts:41` (`Symbol.for`), `di/register.ts:177-178`
- Quality requirements: `register(routingId, policy): () => void`, `get(id | undefined)`; token `SDK_UNATTENDED_SESSION_POLICY_REGISTRY = Symbol.for('SdkUnattendedSessionPolicyRegistry')`; barrel adds two names only (`UnattendedSessionPolicyRegistry`, `UnattendedSessionPolicy`).
- Validation notes: A7 — register the registry BEFORE `SDK_PERMISSION_HANDLER`; the disposer only removes its own registration (a re-register under the same id is not removed by a stale disposer).
- Implementation details: singleton; `denyWindowMs` clamped 0..600000 at register.

### Task 1.3: SdkPermissionHandler early branch — COMPLETE

- Depends on: Task 1.2
- File: `...\sdk-permission-handler.ts`, `...\sdk-permission-handler.unattended.spec.ts`
- Plan reference: implementation-plan.md:202-224, 254-271
- Pattern to follow: existing decision order `sdk-permission-handler.ts:447-598`, undelivered deny `:248-294`, deny timer `:998-1019`
- Quality requirements: optional 4th constructor parameter `@inject(SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY, { isOptional: true })`; policy table exactly as plan :206-216; "Always Allow" rules not consulted for policy sessions; bounded prompt uses the child's routing ids and `policy.denyWindowMs`; deny text names the allowlist and says to report to the parent.
- Validation notes: every row tested with UUID ids; fake timers prove deny at `denyWindowMs`; no webview -> immediate deny; unregistered id -> unchanged behaviour (existing specs untouched); no policy prompt ever has `timeoutAt = 0`.
- Implementation details: branch at the top of the `canUseTool` callback when `registry?.get(routingHint)` exists; Write/Edit/NotebookEdit target resolved against `writableRoot` (realpath-free containment check, exception -> bounded prompt).

### Task 1.4: Metadata identity at creation — COMPLETE

- File: `...\sdk-agent-adapter.ts` (+ spec), `...\session-metadata-store.ts` (+ spec)
- Plan reference: implementation-plan.md:225-253, 1315-1325
- Pattern to follow: `sdk-agent-adapter.ts:768-775,1102-1140`; `session-metadata-store.ts:1044`
- Quality requirements: `createSessionIdCallback(workspaceId, workingDirectory, ...)`; `startChatSession` passes `config.workspaceId ?? resolvedProjectPath` and `resolvedProjectPath`; `create(sessionId, workspaceId, name, workingDirectory?)` records `workingDirectory ?? workspaceId`; `recordPendingUserActivity` unchanged.
- Validation notes: tests (a) child config -> `workspaceId '/root'`, `workingDirectory` = worktree; (b) omitted `workspaceId` -> today's record; (c) `getForWorkspace('/root')` returns the child record.
- Implementation details: no `SessionMetadata` shape change.

### Batch 1 verification

- All 13 files exist with real implementations; no TODO/stub.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk` passes (tail only).
- Existing `sdk-permission-handler*.spec.ts` and `sdk-agent-adapter.spec.ts` cases pass unchanged.
- `code-logic-review-b1.md` verdict APPROVED.

## Batch 2: MCP subagent root registrar — COMPLETE (commit 38d3e511e)

- Review: code-logic-review-b2.md APPROVED 9/10 (antigravity). Open MINOR carried to Task 5.4: retainedRoots keyed by raw path string (http-mcp-server.service.ts:540,580).
- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: port + one implementation + its registration; small, coupled.
- Tasks: 3 | Depends on: P0
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core,@ptah-extension/vscode-lm-tools`
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b2.md`.
  Scope: ops serialised through `enqueueMcpOp`, reconcile keeps retained roots,
  idempotent release, no change for hosts that never retain.

Files (exact):

- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\platform-core\src\interfaces\mcp-subagent-root-registrar.interface.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\platform-core\src\di\tokens.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\platform-core\src\index.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-mcp-server.service.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-mcp-server.service.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\vscode-lm-tools\src\lib\di\register.ts`

### Task 2.1: Port and token — COMPLETE

- File: `...\platform-core\src\interfaces\mcp-subagent-root-registrar.interface.ts`, `di\tokens.ts`, `src\index.ts`
- Plan reference: implementation-plan.md:284-297
- Pattern to follow: `platform-core/src/interfaces/mcp-server-status.interface.ts`; token `platform-core/src/di/tokens.ts:72`
- Quality requirements: `retainRoot(root): Promise<{ registered; reason? }>`, `releaseRoot(root): Promise<void>` (idempotent); `MCP_SUBAGENT_ROOT_REGISTRAR = Symbol.for('PlatformMcpSubagentRootRegistrar')`.
- Implementation details: type-only export from the barrel.

### Task 2.2: CodeExecutionMCP retained roots — COMPLETE

- Depends on: Task 2.1
- File: `...\mcp-http\http-mcp-server.service.ts` (+ spec)
- Plan reference: implementation-plan.md:295-306
- Pattern to follow: `desiredSlots()` `:521`, `enqueueMcpOp` `:318`, `planPtahMcpSlots` (`mcp-http/ptah-mcp-slots.ts:275-280`)
- Quality requirements: `retainedRoots` set added to the roots planned in `desiredSlots()`; both methods inside `enqueueMcpOp` + reconcile; `registered: false` with a reason when the server is not running.
- Validation notes: spec — retained root written, survives a folder-change reconcile, removed after release, release twice is a no-op.
- Implementation details: `CodeExecutionMCP implements IMcpSubagentRootRegistrar`.

### Task 2.3: Shim registration — COMPLETE

- Depends on: Task 2.2
- File: `...\vscode-lm-tools\src\lib\di\register.ts`
- Plan reference: implementation-plan.md:297
- Pattern to follow: `MCP_SERVER_STATUS` shim `register.ts:88-111`
- Quality requirements: resolve failure degrades to `{ registered: false, reason }`, never throws; add the key to the registered-services log list (`register.ts:150` pattern).

### Batch 2 verification

- All 6 files contain real work; no TODO/stub.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core,@ptah-extension/vscode-lm-tools` passes.
- `code-logic-review-b2.md` verdict APPROVED.

## Batch 3: link layer (ports, registry, router + notifier widening) — COMPLETE (commit 8fa3c7312)

- Review round 2: code-logic-review-b3-r1.md APPROVED 10/10 (resumed antigravity session), 4/4 round-1 defects resolved, no regressions.
- Review round 1: code-logic-review-b3.md REVISE 6/10 (antigravity, CLI session 839f7240-eddd-44cd-83c8-61f1e61c4f81). Revise round 1 of 2 sent to backend-developer-b3 by the orchestrator. Defects:
  1. MAJOR `lane-completion-notifier.service.ts:390` (+553-555, 136-141): unparsable `startedAt` omits `writtenAfterSpawn`, so a checkout file reads `delivered` — fix in code + spec.
  2. MAJOR `session-child.registry.ts:175`: `isChild` ignores ended records, so an ended/resumed child can start grandchildren (depth 1) — fix in code + spec.
  3. MINOR `agent-report-router.service.ts:255`: `'childSessionId' in input` misroutes `{ agentId, childSessionId: undefined }` — fix in code + spec.
  4. MINOR `session-child.registry.ts:286-295`: `pruneEnded(20)` drops records of still-open tabs — ruling: keep the bound, document it as equivalent to the post-restart case (plan :950-955) and pin it in a spec.
     Deviations (b), (c), (e) accepted by the reviewer. Re-review: resume the same antigravity session. Pre-existing, not this batch: `claude-approval.reader.spec.ts` "with a real git" timeouts (also fail on base).
- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: the router and notifier both depend on the port types and the
  registry; shared `di/register.ts` and barrels.
- Tasks: 6 | Depends on: P0
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime`
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b3.md`.
  Scope: agent branch of the router byte-identical, closed refusal union
  unchanged, session verdict rule vs lane verdict rule, reservation race.

Files (exact):

- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\shared\src\lib\types\messages\agent-session.ts` (moved from B4, F1)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\shared\src\lib\types\messages\index.ts` (one export line, F1)
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.port.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\session-children\child-chat-session-host.port.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\session-children\session-child.registry.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\session-children\session-child.registry.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\session-children\index.ts` (moved from B5, F2)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-report-router.service.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-report-router.service.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\cli-agents\index.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\di\register.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\index.ts`

### Task 3.1: Shared `AgentSessionOpenedPayload` — COMPLETE

- File: `...\libs\shared\src\lib\types\messages\agent-session.ts`, `...\messages\index.ts`
- Plan reference: implementation-plan.md:541-555
- Pattern to follow: `libs/shared/src/lib/types/messages/gateway.ts`, exported at `messages/index.ts:13`
- Quality requirements: interface exactly as the plan (readonly fields, `sessionId: string | null`, `parentSessionId: string | null`, `startedAt: number`). Type only: NO `MESSAGE_TYPES` key, payload-map entry or RPC type here (those stay in B4).

### Task 3.2: Port contracts — COMPLETE

- Depends on: Task 3.1
- File: `...\session-children\session-spawner.port.ts`, `...\child-chat-session-host.port.ts`
- Plan reference: implementation-plan.md:318-417, 437-446, 486-487
- Quality requirements: every type in the plan listing, plus `SessionChildCompletionEnvelope` and `SessionChildCompletionDelivery` in the port file (not in `shared`); `LaneCompletionVerdict` imported from shared; type-only files.

### Task 3.3: SessionChildRegistry — COMPLETE

- Depends on: Task 3.2
- File: `...\session-children\session-child.registry.ts` (+ spec)
- Plan reference: implementation-plan.md:418-423, 433-434
- Quality requirements: `reserveSlot(max)` synchronous (live + outstanding reservations), `add`, `release`, `get` by tab or SDK id, `findByCwd`, `isChild`, `childrenOf(parentIds)`, `bindSdkSessionId`, `markReportDelivered`, `markReportRefused(childId, summary)`, `update`, `markEnded`, `pruneEnded(20)`, `liveCount()`; plain serialisable records; no SQLite.
- Validation notes: spec — reservation race (two reserves, cap 1), lookup by both ids, cwd lookup with normalised paths, pruning bound 20.

### Task 3.4: AgentReportRouter child branch — COMPLETE

- Depends on: Task 3.3
- File: `...\cli-agents\agent-report-router.service.ts` (+ spec)
- Plan reference: implementation-plan.md:424-435, 891-893, 915-924
- Pattern to follow: existing `deliver` `:221-361`
- Quality requirements: `AgentReportInput` becomes the union `{ agentId; message; summary? } | { childSessionId; message; summary? }`; unknown child -> `unattributed-caller` with the plan's detail; parent = recorded tab id, else parent SDK id when the tab is not active; envelope `cli="ptah-session"`; origin `peer` `ptah-session:{id}`; shared size/burst/duplicate checks with `session:{id}` rate keys; delivered -> `markReportDelivered`; `parent-session-not-active` -> `markReportRefused`. Refusal union unchanged. Agent branch byte-identical.
- Validation notes: spec — child delivered, unknown child, parent inactive (counted, not queued), parent tab gone but SDK id live, shared burst limit; existing specs pass untouched.
- Implementation details: inject `SessionChildRegistry` by class.

### Task 3.5: LaneCompletionNotifier session subject — COMPLETE

- Depends on: Task 3.2
- File: `...\cli-agents\lane-completion-notifier.service.ts` (+ spec)
- Plan reference: implementation-plan.md:436-487
- Pattern to follow: `checkOne` `:266-284`, `verdictOf` `:242`, envelope builder
- Quality requirements: `signalSessionChild(subject, settle)`; pure envelope builder exposed for held completions; deliverable check generalised to `{ deliverables, taskFolder, workingDirectory, id }`; dedupe key `{childSessionId}:turn:{n}`; parent not live -> refusal returned WITH the built envelope; session rule: `writtenAfterSpawn === false` -> `no-deliverable`, rendered `NOT written by this run`; absent flag keeps lane behaviour; lane verdict unchanged; `LaneCompletionSignal` in shared unchanged.
- Validation notes: spec — mtime before `startedAt` -> `no-deliverable` (session) but `delivered` (lane); mtime equal to `startedAt` -> written; after -> `delivered`; per-turn dedupe; envelope snapshot; existing lane specs untouched.

### Task 3.6: Tokens, registration, barrels — COMPLETE

- Depends on: Tasks 3.3-3.5
- File: `...\cli-agent-runtime\src\lib\di\tokens.ts`, `...\di\register.ts`, `...\cli-agents\index.ts`, `...\session-children\index.ts`, `...\cli-agent-runtime\src\index.ts`
- Plan reference: implementation-plan.md:503-506
- Quality requirements: `SESSION_SPAWNER = Symbol.for('SessionSpawner')`, `CHILD_CHAT_SESSION_HOST = Symbol.for('ChildChatSessionHost')`; `SessionChildRegistry` singleton registered BEFORE the router; folder barrel exports ports + registry; lib barrel adds one grouped `export * from './lib/session-children'`.
- Validation notes: no spawner registration here (B5).

### Batch 3 verification

- All 15 files contain real work; no TODO/stub.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime` passes.
- Existing router and notifier specs pass without edits to their existing cases.
- `code-logic-review-b3.md` verdict APPROVED.

## Batch 4: chat-path host adapter, shared contracts, `chat:agent-sessions` — COMPLETE (commit 590ea1d2a, together with Batch 5)

- Review: code-logic-review-b4.md APPROVED 8/10 (antigravity lane 7ff988b7), 2 MINOR (F1, F2) carried to Task 5.6.
- Commit BLOCKED by the pre-commit hook (`nx affected --target=lint`), no `--no-verify`:
  1. `di-lint`: `chat-rpc.handlers.ts:135` injects `CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER`, which no `register*.ts` registers until Task 5.5. The tool has no suppression, so B4 cannot commit alone.
  2. `degradation-audit`: `child-chat-session-host.adapter.ts:86` catch-return-sentinel without a `// degradation-audit:` marker (rpc-handlers 2 > baseline 1). Fix carried to Task 5.6 (F3).
     Decision (executed): B4 and B5 committed together as 590ea1d2a after B5's review approved; the hook passed (di-lint, degradation-audit) without --no-verify.

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: the extraction of `launchSdkSession` is a cross-file refactor
  inside a 1373-line service that must not change `startSession` behaviour.
- Tasks: 4 | Depends on: Batch 3
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers`
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b4.md`.
  Scope: `startSession` unchanged for existing callers, announce-then-start
  order, the Revision-1 `CHAT_ERROR` rule.

Files:

- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\shared\src\lib\types\messages\message-constants.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\shared\src\lib\types\messages\payload-map.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\shared\src\lib\types\rpc\rpc-chat.types.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\shared\src\lib\types\rpc.types.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\session\chat-session-agent-child.spec.ts` (F4)
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\session\child-chat-session-host.adapter.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\session\child-chat-session-host.adapter.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\di.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.spec.ts`
- No host RPC profile edits (F5).

### Task 4.1: Shared message key, payload map, RPC types — COMPLETE

- Plan reference: implementation-plan.md:538-558
- Quality requirements: `AGENT_SESSION_OPENED = 'agentSession:opened'` + payload-map entry using the B3 type; `chat:agent-sessions` params `{ workspaceRoot?: string }`, result `{ sessions: AgentSessionOpenedPayload[] }` in `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`. Any shared registry parity spec that enumerates methods is updated, not skipped.

### Task 4.2: `launchSdkSession` extraction + `startAgentChildSession` — COMPLETE

- Depends on: Task 4.1
- Plan reference: implementation-plan.md:559-572, 605-609
- Pattern to follow: `chat-session.service.ts:415-595`; topic-spec pattern `chat-session-auth.spec.ts`
- Quality requirements: `startSession` calls the private helper with `workspaceId = projectPath`; child method runs `isAuthorizedWorkspace(worktreePath)` + unsafe-path refusal, `workspaceId = workspaceRoot`, `projectPath = worktreePath`, `permissionLevel: 'auto-edit'`, prompts/profile/style resolved for `workspaceRoot`, `mcpServerRunning = codeExecutionMcp.getPort() !== null`; no slash-command intercept, no Ptah-CLI branch.
- Validation notes: new spec pins both parameter sets; all existing `chat-session-*.spec.ts` pass unchanged.

### Task 4.3: `ChildChatSessionHostAdapter` + registration — COMPLETE

- Depends on: Task 4.2
- Plan reference: implementation-plan.md:573-589, 610-613
- Quality requirements: awaits the broadcast (`uiAnnounced`), a throw -> `false` and the start still runs; start throw or `{ success: false }` -> `{ started: false, error }`; when announced and failed/thrown, exactly one `CHAT_ERROR` `{ tabId, sessionId: tabId, error: 'Child session could not start: <reason>' }`; not announced -> none; an error-broadcast failure is logged and does not change the outcome. Registered in `registerChatServices` under `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST`.

### Task 4.4: `chat:agent-sessions` RPC — COMPLETE

- Depends on: Task 4.1
- Plan reference: implementation-plan.md:590-592
- Quality requirements: wired in the handler list and `wire(...)` (`chat-rpc.handlers.ts:95-110,305-309`); spawner injected optional by `CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER`; absent -> `{ sessions: [] }`.

### Batch 4 verification

- Files exist with real work; scoped command passes; existing chat specs unchanged; `code-logic-review-b4.md` APPROVED.

## Batch 5: provisioner, spawner, contract, settings — COMPLETE (commit 590ea1d2a, together with Batch 4)

- Launch state: READY (parallel with Batch 7; file-disjoint: B5 = cli-agent-runtime + rpc-handlers, B7 = frontend libs + webview app)
- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: the spawner composes every earlier batch; design judgement
  mid-flight (event binding, grace timers).
- Tasks: 6 | Depends on: Batches 1, 2, 3, 4
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers`
- Known pre-existing failures (not B5's; also fail on base): `cli-agent-runtime` `capabilities/claude-approval.reader.spec.ts` "with a real git" (3 cases, git > 5 s jest timeout); `rpc-handlers` `harness/selection/harness-skill-selection-rpc.service.spec.ts` "never writes state.json".
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b5.md`.
  Scope: guard order, rollback completeness, timers cleared, held-completion
  semantics, ownership by tab or SDK id, git argument arrays.

Files:

- CREATE `...\cli-agent-runtime\src\lib\session-children\child-worktree.provisioner.ts` (+ `.spec.ts`, `.integration.spec.ts`)
- CREATE `...\session-children\session-child-settings.ts` (+ `.spec.ts`)
- CREATE `...\session-children\session-child-contract.ts` (+ `.spec.ts`)
- CREATE `...\session-children\session-spawner.service.ts` (+ `.spec.ts`)
- MODIFY `...\session-children\index.ts`
- MODIFY `...\cli-agent-runtime\src\lib\di\register.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\package.json` (only if the dependency lint requires `@ptah-extension/memory-contracts`, F8)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\di.spec.ts` (carried from B4: one case asserting `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST` resolves to `ChildChatSessionHostAdapter`; B5's verification adds `@ptah-extension/rpc-handlers`)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts` (+ `chat-rpc.handlers.spec.ts`) — B4 review F1, Task 5.6
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts` (+ `chat-session-agent-child.spec.ts`) — B4 review F2, Task 5.6
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\rpc-handlers\src\lib\chat\session\child-chat-session-host.adapter.ts` — degradation-audit marker, Task 5.6 F3

(`...` = `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib`)

### Task 5.1: ChildWorktreeProvisioner — COMPLETE

- Plan reference: implementation-plan.md:508-531
- Quality requirements: steps 1-6 through `execGit(args[], root, { timeoutMs: WORKTREE_GIT_TIMEOUT_MS, spawner? })`; rollback per step, reported, never throws, only what this call created; integration spec on a temp repo proves add + rollback leave no worktree and no branch.

### Task 5.2: Settings reader — COMPLETE

- Plan reference: implementation-plan.md:658-665
- Quality requirements: four keys, defaults and clamps as specified; invalid -> default; clamp table spec.

### Task 5.3: Child contract — COMPLETE

- Plan reference: implementation-plan.md:648-657
- Quality requirements: pure `renderSessionChildContract`; tells the child to repeat refused-report content in its final message (:919-920); snapshot spec; separate from `renderLaneCompletionContract`.

### Task 5.4: SessionSpawnerService — COMPLETE

- Depends on: Tasks 5.1-5.3
- Plan reference: implementation-plan.md:626-702, 862-947, 977-1003
- Pattern to follow: fake adapter `agent-sdk/src/lib/peer-sessions/peer-session-messenger.service.spec.ts:47-57`
- Quality requirements: four host-wide subscriptions in the constructor, released in `dispose()`; guards in order; slot reserved synchronously; `startedAt` stamped after `git worktree add` returns; policy + MCP root registered before the host start; full reverse rollback on host failure; settle rules (background tasks, running lanes, failed turn, dedupe by timestamp); send modes incl. `SessionAdmissionRefusedError`; stop keeps tab/worktree/branch, no push; parent end never stops children; held completion latest per child, returned once by `takeHeldCompletions`; ownership by parent tab id or parent SDK id; child 30 s grace (re-register cancels); runtime timer; SDK id binding by resolved callback and by cwd; `dispose()` sync + idempotent; logs via `IOutputChannel` `[SessionSpawner]`.
- Validation notes: A5 covered by a transcript-reader call assertion (worktree path).
- Validation notes (from B2 review): pass the exact same `worktreePath` string to `registrar.retainRoot` and `registrar.releaseRoot` (the registrar keys retained roots by raw string; `D:\x` vs `d:/x` would leave the root retained).

### Task 5.5: Registration and barrel — COMPLETE

- Depends on: Task 5.4
- Quality requirements: provisioner + spawner singletons, spawner under `SESSION_SPAWNER`; folder barrel extends B3's; F8 dependency if required. Plus the carried `chat/di.spec.ts` case: `CHILD_CHAT_SESSION_HOST` resolves to `ChildChatSessionHostAdapter`.

### Task 5.6: B4 review follow-ups (rpc-handlers) — COMPLETE

- Source: `code-logic-review-b4.md` (APPROVED 8/10), findings F1 and F2, both MINOR.
- F1 `chat-rpc.handlers.ts:331-337`: `chat:agent-sessions` with non-object params (`42`, `"some/path"`, `null`) must throw `RpcUserError('params must be an object', 'INVALID_PARAMS')` instead of returning every live session; `undefined` params and `{}` keep returning all live sessions. Spec cases in `chat-rpc.handlers.spec.ts` for a primitive, `null`, `undefined` and `{ workspaceRoot }`.
- F2 `chat-session.service.ts:603-617`: `startAgentChildSession` also checks `isAuthorizedWorkspace(workspaceRoot, this.workspaceProvider)` and returns `{ success: false, error: 'Access denied: workspace root is not inside an open folder.' }` before any launch work; the existing `worktreePath` checks stay. Spec case in `chat-session-agent-child.spec.ts`: unauthorized root -> refused, `startChatSession` never called; `startSession` behaviour unchanged.
- F3 (from B4's failed commit hook) `child-chat-session-host.adapter.ts:86`: the `announce()` catch returns `false`; add a `// degradation-audit: <kind> - <reason>` marker in the repository's format (pattern: `vscode-lm-tools/src/lib/di/register.ts` retain shim, "optional-capability"), stating that a failed broadcast degrades to a headless start plus late adoption. Check every other new catch in B5's files the same way.
- Gate: B5 is accepted only when `npx nx run-many -t lint -p di-lint,degradation-audit` passes (the pre-commit hook runs both). The combined B4+B5 commit must pass the hook without `--no-verify`.

### Coordination note: TASK_2026_580_9f77

- 584 keeps the child registry in memory. No SQLite schema, table, column or
  migration is created in 584, and no `SessionMetadata` field is added.
- 580 will own the `session_organization` table and a platform-core port
  `recordAgentStartedSession`. If 580 merges first, 584 adds ONE call to that
  port in the spawner's `SessionIdResolved` handler (when the child's SDK id is
  known), with the field mapping at implementation-plan.md:1169-1175
  (`parentSdkSessionId` -> `parent_session_id`, `worktreePath`, `branch`,
  `taskId` -> task link). Otherwise 580 adds that call. No code for it now.

### Batch 5 verification

- Files exist with real work; scoped command passes (incl. the temp-repo integration spec); `code-logic-review-b5.md` APPROVED.

## Batch 6: MCP surface, report fallback, shutdown hooks — PENDING

- Launch state: READY, NOT launched (session ended; set IN_PROGRESS when assigned). B4+B5 committed together (590ea1d2a); file-disjoint from B7 (code-reviewed, awaiting visual review, uncommitted): B6 = vscode-lm-tools + cli-agent-runtime spawner + apps/ptah-extension-vscode + apps/ptah-electron, B7 = libs/frontend + apps/ptah-extension-webview)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: dispatcher, namespace and handlers share types; shutdown hooks are two small edits after the spawner exists.
- Tasks: 6 | Depends on: Batch 5
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools,@ptah-extension/cli-agent-runtime,ptah-extension-vscode,ptah-electron` plus `npx nx run-many -t lint -p di-lint,degradation-audit` (the pre-commit hook runs both).
- Known pre-existing failures (also fail on base): cli-agent-runtime `claude-approval.reader.spec.ts` real-git cases (timeouts under load).
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b6.md`.
  Scope: caller id from transport only, tool list byte-identical per caller,
  held-completion block appended, report fallback, shutdown order.

Files (`...` = `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\vscode-lm-tools\src\lib\code-execution`):

- CREATE `...\mcp-core\session-tool-args.schema.ts`, `...\mcp-core\session-tools.ts`, `...\mcp-core\session-tool-handlers.ts`, `...\mcp-core\session-tools.spec.ts`
- CREATE `...\namespace-builders\session-namespace.builder.ts` (+ `.spec.ts`)
- MODIFY `...\types.ts`, `...\ptah-api-builder.service.ts`, `...\namespace-builders\agent-namespace.builder.ts`
- MODIFY `...\mcp-core\protocol-dispatcher.ts` (+ `protocol-dispatcher.spec.ts`), `...\mcp-core\tool-result-budget.ts`, `...\mcp-core\mcp-contract.sweep.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\apps\ptah-extension-vscode\src\main.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\apps\ptah-electron\src\activation\shutdown.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.ts` (+ `session-spawner.service.spec.ts`) — Task 6.6
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\backend\cli-agent-runtime\src\lib\di\register.ts` — Task 6.6, only if the resolver is registered there

### Task 6.1: Schemas, definitions, handlers — PENDING

- Plan reference: implementation-plan.md:704-744
- Pattern to follow: `agent-spawn-args.schema.ts:15` + parity spec; `surface-tools.ts` / `surface-tool-handlers.ts`
- Quality requirements: five tools with the plan's schemas; Zod failure -> `isError`; refusals as plain text; `session-start-failed`/`worktree-failed` -> `isError` with rollback table; every result appends held completions.

### Task 6.2: Session namespace + PtahAPI wiring — PENDING

- Plan reference: implementation-plan.md:723-727
- Quality requirements: absent spawner -> named error (`ptah-api-builder.service.ts:706-719` rule); successful start fires the worktree change handler (`:999`).

### Task 6.3: Dispatcher cases + `ptah_agent_report` fallback — PENDING

- Plan reference: implementation-plan.md:719-735
- Quality requirements: tools in the `agent` group; five delegating cases; report: no agent id + session id -> `childSessionId` branch; neither -> `unattributed-caller`; `AgentNamespace.report` input widened; tool list byte-identical per caller.

### Task 6.4: Budget hints + sweep drivers — PENDING

- Quality requirements: five tools `'preformatted'`; sweep drivers for all five.

### Task 6.5: Host shutdown — PENDING

- Plan reference: implementation-plan.md:830-843
- Validation notes (carried from B5, construction order): `SessionSpawnerService` injects the optional `CHILD_CHAT_SESSION_HOST` once, at construction. In every host (VS Code, Electron, CLI engine) confirm `SESSION_SPAWNER` is first resolved AFTER `registerChatServices`; add a spec or host-level assertion. SUPERSEDED by Task 6.6 (lazy host lookup); keep only the smoke S1 confirmation.
- Quality requirements: resolve `SESSION_SPAWNER` inside the existing non-fatal pattern, `dispose()` BEFORE `agentProcessManager.disposeAll()` (`main.ts:143`, `shutdown.ts:278`).

### Task 6.6: Lazy `CHILD_CHAT_SESSION_HOST` lookup in the spawner — PENDING

- Source: `code-logic-review-b5.md` (APPROVED 9/10), its one MINOR: construction-order hazard. Today all three hosts resolve `SESSION_SPAWNER` after `registerChatServices`, but Task 6.2 makes `PtahAPIBuilder` (vscode-lm-tools, registered in an earlier phase) a new consumer of `SESSION_SPAWNER`; if it resolves the spawner before `registerChatServices`, the singleton would hold `host = null` for the process life and every start would refuse `chat-runtime-unavailable`.
- Decision (team-leader): remove the hazard class instead of checking for it. The spawner looks up `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST` at `start()` time (inject the tsyringe `DependencyContainer`, or a resolver function registered in cli-agent-runtime `di/register.ts` beside the spawner, following the per-call shim pattern in `vscode-lm-tools/src/lib/di/register.ts` for `MCP_SERVER_STATUS`); absent at that moment -> `chat-runtime-unavailable` as today. di-lint must still pass (no unregistered `@inject` token).
- Also resolve `SESSION_SPAWNER` lazily in `PtahAPIBuilder` / the session namespace (per call, like the `AGENT_REPORT_ROUTER` rule at `ptah-api-builder.service.ts:706-719`), not in its constructor.
- Specs: spawner built while the host token is unregistered, host registered afterwards -> `start()` reaches the host; host still absent at `start()` -> `chat-runtime-unavailable`; existing spawner specs pass.

### Batch 6 verification

- Files exist with real work; scoped command passes; `code-logic-review-b6.md` APPROVED.

## Batch 7: frontend tab adoption, badge, banner, late adoption — IN_PROGRESS

- Launch state: executor DONE (Tasks 7.1-7.7, 18 files, all inside the list, plus `chat-state/src/index.ts` in revise round 1); verified on disk. Code review: APPROVED in round 2 (see below). Visual review: after the code review is APPROVED (and after any revise), so the screenshots show the final code.
- A2 result (executor): FALSE as assumed. A late-adopted tab loads history only on a sidebar click (app-shell `onSessionClick` :513-519 -> chat.store :202 -> `SessionLoaderService.switchSession` :597 -> `chat:resume`); activating the tab loads nothing; new turns stream either way; late tabs leave `hasLiveSession` unset so that click is not blocked (session-loader :617-624). Team-leader ruling pending the review's answer on whether a sidebar click sends `chat:resume` into a still-streaming child: if the review finds no backend risk, add (in the same revise round as any defects) auto-load of history on the first activation of a late-adopted tab through the existing `SessionLoaderService` path; smoke S1b must test both the tab activation and the sidebar click.
- Review round 2: `code-logic-review-b7-r1.md` APPROVED 10/10 (lane 3f255756, session 097f97fa): defects 1-3 RESOLVED, no new defects. Late-tab auto-load runs once per tab via `switchSession(session, { targetTabId })` (no `activate`); a failed load retries once on the next activation and cannot loop; a tab that already holds messages is not auto-loaded — ACCEPTABLE (plan A2 defines the lazy load for tabs with no messages; a sidebar click on such a tab only switches focus, nothing lost or duplicated). Revise files: `chat-state/src/index.ts`, `agent-session-adoption.service.ts` (+ spec); `session-loader.service.ts` untouched.
- NOT COMMITTED (team-leader decision): B7's gate is code review + rendered visual review; the visual review has not run, so B7 stays uncommitted on disk (19 files under `libs/frontend` and `apps/ptah-extension-webview`) and is NOT in the pushed branch. Next session: visual-reviewer (dark + light, before from base a90c086d7: tab bar with agent badge, badge tooltip incl. parent-gone, agent origin banner, a late-adopted tab after reload), then commit B7's files by path with `di-lint` and `degradation-audit` passing in the hook.
- Review round 1: `code-logic-review-b7.md` REVISE 8/10 (antigravity lane db8f2d22, resumed session 097f97fa-36a4-44d9-9d8e-a0b7615b12d9). A2 ruling (team-leader): the gap is a defect for this batch (plan :164-167, :774-777 expected the tab to load through the existing loader); the sidebar click is safe per the review's answer (b). Revise round 1 of 2 = defects 1-3 below. Deviations (1)-(5) ACCEPTABLE; (6) is defect 2.
  1. MAJOR `tab-manager.service.ts:987-995` (+ `session-loader.service.ts:597,617-624`): auto-load history on the FIRST activation of a late-adopted `agentOrigin` tab whose history is not loaded, through `SessionLoaderService.switchSession` (no `activate: true`, at most once per tab).
  2. MINOR `chat-state/src/index.ts:11-16`: export `AgentSessionAdoptionMode`, `AgentSessionAdoptionResult`; drop the `Parameters<...>` workaround at `agent-session-adoption.service.ts:7-9`.
  3. MINOR `agent-session-adoption.service.ts:122-124,158-160`: `// degradation-audit:` markers.
- Deviations reported: live push via `AgentSessionAdoptionService.adopt` with closed-child memory; parser in the adoption service; `addTabToWorkspace(..., afterTabId)`; banner says "for a limited time" (payload carries no deny window); workspace trigger is a root effect on `activeWorkspacePath$` (also fires at bootstrap); adoption types not exported. Ruled by the review.
- di-lint: B7 passes; the only di-lint failure is B5's in-progress `session-spawner.service.ts:150-153` — re-check after B5 settles.

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: frontend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: tab state, persistence and adoption are coupled through `TabManagerService`; the handler, service and components build on it.
- Tasks: 7 | Depends on: Batch 4 (shared contracts). Runs in parallel with Batches 5-6 (file-disjoint: frontend libs + webview app only).
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat,ptah-extension-webview`, plus `npx nx run-many -t lint -p di-lint,degradation-audit` (the pre-commit hook runs both; a new catch needs a `// degradation-audit:` marker).
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b7.md`
  (adoption idempotency, parent-absent no-op, no focus change, persistence).
  PLUS visual-reviewer (rendered UI surface added with no prototype, F10):
  before/after screenshots, dark and light, "before" from base a90c086d7.

Files (`...` = `D:\projects\ptah-extension\.claude-worktrees\task-584\libs\frontend`):

- MODIFY `...\chat-types\src\lib\chat-types.ts`
- MODIFY `...\chat-state\src\lib\tab-manager.service.ts`; CREATE `...\chat-state\src\lib\tab-manager.agent-adoption.spec.ts`
- MODIFY `...\chat-state\src\lib\tab-workspace-partition.service.ts` (+ spec)
- MODIFY `...\chat-state\src\lib\tab-persistence.ts`; MODIFY `...\chat-state\src\lib\tab-manager.persistence.spec.ts`
- MODIFY `...\chat\src\lib\services\chat-message-handler.service.ts` (+ spec)
- CREATE `...\chat\src\lib\services\agent-session-adoption.service.ts` (+ spec); MODIFY `...\chat\src\lib\services\index.ts` if exported
- MODIFY `...\chat\src\lib\components\organisms\tab-bar.component.ts` (+ spec)
- CREATE `...\chat\src\lib\components\molecules\agent-origin-banner\agent-origin-banner.component.ts` (+ spec)
- MODIFY `...\chat\src\lib\components\templates\chat-view.component.ts` + `chat-view.component.html`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\apps\ptah-extension-webview\src\app\app.config.ts` (start the adoption service, F11)

### Task 7.1: `TabState.agentOrigin` + persistence — IMPLEMENTED

- Plan reference: implementation-plan.md:762-765; persisted round-trip spec.

### Task 7.2: `addTabToWorkspace` — IMPLEMENTED

- Plan reference: implementation-plan.md:778-780; spec for a background partition.

### Task 7.3: `adoptAgentSessionTab(payload, 'live' | 'late')` — IMPLEMENTED

- Plan reference: implementation-plan.md:766-780; A2 — locate the sidebar history-load trigger first and cite it in the report. Idempotent, parent-absent no-op, order after parent, `titleOrigin: 'user'`, no focus change.

### Task 7.4: `ChatMessageHandler` push — IMPLEMENTED

- Plan reference: :781-783; defensive checks as the gateway handlers (`:194-243`); a throw never breaks the switch.

### Task 7.5: `AgentSessionAdoptionService` + bootstrap — IMPLEMENTED

- Plan reference: :784-787; RPC client as `conversation.service.ts` uses for `chat:running-agents`; bootstrap and workspace switch.

### Task 7.6: Tab-bar agent badge — IMPLEMENTED

- Plan reference: :788-792; aria-label, tooltip, keyboard reachable, parent-gone tooltip.

### Task 7.7: Agent origin banner + chat view — IMPLEMENTED

- Plan reference: :793-799; `role="note"`, "Open parent" action, composer stays enabled.

### Batch 7 verification

- Files exist with real work; scoped command passes; `code-logic-review-b7.md` APPROVED; visual-reviewer before/after dark + light recorded.

## Batch 8: agent-lanes skill + docs — PENDING

- Recommended executor: technical-content-writer (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Tasks: 2 | Depends on: Batch 6. Parallel with Batch 9.
- Verification: `npx nx run ptah-docs:build` (docs page renders); both skill copies identical in the new section.
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b8.md`
  (every claim traced to the B5/B6 code: tool names, settings keys and defaults, envelope, limits).

Files:

- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\.claude\skills\agent-lanes\SKILL.md`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-584\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\agent-lanes\SKILL.md`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-584\apps\ptah-docs\src\content\docs\agents\agent-sessions.md` (check the docs sidebar config for an explicit page list)

### Task 8.1: Skill section (both copies) — PENDING

- Plan reference: implementation-plan.md:845-852; include "call `ptah_session_status` after a resume" (R12).

### Task 8.2: Docs page with the four settings keys — PENDING

## Batch 9: real-host smoke S1-S11 + test-report.md — PENDING

- Recommended executor: senior-tester (sub-agent), real host (Electron dev build, then VS Code), NOT a mocked run
- Fallback executor: none; a smoke step that cannot run is reported as blocked with the reason
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 6 and 7. Parallel with Batch 8.
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk,@ptah-extension/platform-core,@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools,@ptah-extension/shared,@ptah-extension/chat-state,@ptah-extension/chat,ptah-cli` (S11) plus the smoke evidence.
- Review: CLI lane antigravity (fallback Glm) -> `code-logic-review-b9.md` (evidence supports each S-step verdict; assumptions A1-A5 closed or reported).

### Task 9.1: Smoke S1-S11 — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-584\.ptah\specs\TASK_2026_584_5e7a\test-report.md`
- Plan reference: implementation-plan.md:1067-1104
- Quality requirements: each step with observed evidence (screenshots, log lines, tool results); A1-A5 marked verified or failed; scratch repo outside this worktree. S1b tests both activation of a late-adopted tab and the sidebar click (B7 A2 finding). S1 also confirms a start does NOT refuse `chat-runtime-unavailable` in each host (B5 construction-order risk).
