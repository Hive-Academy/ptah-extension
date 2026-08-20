# Code Logic Review - TASK_2026_157

## Review Summary

| Metric              | Value                      |
| ------------------- | -------------------------- |
| Overall Score       | 7/10                       |
| Assessment          | APPROVED WITH MINOR ISSUES |
| Critical Issues     | 0                          |
| Serious Issues      | 1                          |
| Moderate Issues     | 3                          |
| Minor Issues        | 3                          |
| Failure Modes Found | 5                          |

This is a re-review of code already gated through three team-leader MODE 2 checkpoints (Batches A/B/C/D/E all APPROVED or APPROVED WITH FOLLOW-UPS). I independently re-verified rather than trusting those verdicts, and largely confirm them: the write-order invariant, dual RPC registration, debounce/coalesce logic, byte-preservation regex, id-allocator, and boundary isolation (no `node:fs`/adapter imports in `task-specs`, no backend/`chat` imports in `tasks-ui`) all check out against the actual source. Two of the findings below (F-D1, F-D2) are the SAME gaps the team-leader already surfaced and ticketed (`Follow-ups` table in tasks.md) — I confirm them independently rather than taking the credit, and flag where I think the tracked severity undersells the user-facing impact.

## The 5 Paranoid Questions

### 1. How does this fail silently?

- **Worktree isolation silently no-ops (F-D1, confirmed).** A user who opts into "isolated worktree" for Start gets a real worktree created on disk, but the orchestration session is launched against the ordinary workspace root — `MessageSenderService.startNewConversation` (`libs/frontend/chat/src/lib/services/message-sender.service.ts:318`) hardcodes `workspacePath = vscodeService.config().workspaceRoot`, and `SendMessageOptions` has no override field. `TaskPromptBridgeService.consume()` (`task-prompt-bridge.service.ts:26-29`) documents this explicitly but the UI gives no in-flow signal — the card just shows "started," the worktree toggle looks honored, and the agent is quietly editing the main tree. Nothing in the RPC responses or UI state distinguishes "isolated as requested" from "isolated in name only."
- **A structural `chat:start` failure is swallowed into a success (F-D2, confirmed).** `MessageSenderService.startNewConversation` (`message-sender.service.ts:389-398`) logs a structural `chat:start` failure to `console.error` and marks the session `failed` locally, but the `try` block does not `throw` or otherwise signal failure back to its caller — the awaited `send()` call in `TaskPromptBridgeService.consume()` resolves normally, `outcome` stays `{ success: true }`, and `TaskStartService.start()` (`task-start.service.ts:97`) then calls `tasks:updateStatus(taskId, 'in_progress')`. The board now shows `in_progress` for a task whose session never actually started (AUTH_REQUIRED, model-unavailable, etc.). Recoverable via a manual re-Start (idempotent), but silent in the moment.

### 2. What user action causes unexpected behavior?

- Double-clicking Start rapidly is guarded (`_busyTaskId` gate in `task-start.service.ts:68`), so no double-launch — verified.
- Clicking Start with worktree isolation ON, then immediately navigating away from the Tasks tab: the `ChatPromptRequest` resolve path is entirely independent of the Tasks view being mounted (it lives on `AppStateManager`, root-provided, and `TaskPromptBridgeService`/`TaskStartService` are also root-provided), so the launch completes correctly even if the user leaves the tab — verified, no leak.
- If the user's workspace is `undefined` (no folder open) and they trigger any `tasks:*` RPC, `TasksRpcHandlers.resolveRoot` throws a typed `RpcUserError('WORKSPACE_NOT_OPEN', ...)` — clean structured failure, not a crash.

### 3. What data makes this produce wrong results?

- **`task.md` with a UTF-8 BOM at byte 0.** `FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/` is anchored to the literal start of the string. A BOM-prefixed file (common from PowerShell `Out-File`/some Windows editors) will never match, so `parseTaskFile` returns `{ kind: 'excluded', reason: 'no_frontmatter' }` even though the YAML itself is perfectly valid. This is within the "never throws" contract (R1.2) and degrades gracefully (excluded, counted, not crashing), so it's not a correctness violation of the letter of the spec — but it's a realistic authoring foot-gun for any hand-edited or externally-tooled `task.md` that the spec's exclusion-reason taxonomy doesn't distinguish from genuinely malformed files. See Moderate-1.
- `--- ` inside a body code fence: verified safe. The regex's lazy `[\s\S]*?` stops at the _first_ `\n---`, which is the real closing delimiter (it appears before any fenced `---` deeper in the body), so both `parseTaskFile` and `updateFrontmatter` bound the frontmatter block correctly and the body (including nested `---` fences) is copied through byte-for-byte via `raw.slice(block.length)`.
- CRLF: verified safe — the regex explicitly tolerates `\r?\n`, and the body slice preserves whatever line endings follow untouched.
- Frontmatter with no closing `---`: verified safe — regex simply fails to match, `no_frontmatter` exclusion, no throw.

### 4. What happens when dependencies fail?

- **`IFileSystemProvider` throwing mid-scan**: every I/O call in `TaskScannerService.scanFolder`/`scan` is individually try/caught (`task-scanner.service.ts:47-102`) and degrades to a per-folder `unreadable` exclusion or a workspace-level empty result — never propagates. Verified NFR-5 compliant.
- **SQLite unavailable (VS Code native-module failure)**: `TaskIndexStore` has both a `SqliteTaskIndexStore` and an `InMemoryTaskIndexStore` behind one interface (confirmed present in `task-index.store.ts`); team-leader's B.2 note records the selection is now a lazy `instanceCachingFactory` rather than a register-time `isRegistered` gate, which is more robust against VS Code's late SQLite registration. Plausible and I have no evidence contradicting it, but I did not independently trace the DI factory wiring end-to-end in this pass — flagged as Minor-1 (spot-check only, not a full re-verify).
- **Watcher creation throwing** (host without a real watcher): caught in `TaskIndexService.startWatcher` (`task-index.service.ts:225-242`), logs a warning, degrades to reindex-on-RPC. Verified.
- **`webviewManager.broadcastMessage` failing**: caught in `TasksRpcHandlers.broadcastChanged` (`tasks-rpc.handlers.ts:323-336`), logged, does not crash the handler or block the write path that triggered it (broadcast is async and unawaited from the constructor subscription — write callers don't wait on it either). Verified — this also means a broadcast failure is invisible to the writer/caller, which is intentional (fire-and-forget for a push notification) but worth noting: a client that misses `tasks:changed` due to a broadcast failure has no fallback poll, so its board can go stale until the next unrelated `tasks:changed` or manual reindex. Low risk given `webviewManager.broadcastMessage` failures should be rare/transport-level.

### 5. What's missing that the requirements didn't mention?

- No explicit UI indication of "worktree requested but not yet honored" (ties to F-D1) — a reasonable implicit user expectation once a worktree toggle exists in the UI at all.
- `TaskStartService.start()`'s outer `try` has no `catch`, only `finally` (`task-start.service.ts:71-100`) — see Minor-2. Currently benign because `ClaudeRpcService.call()` is verified to never reject (always resolves an `RpcResult`, `claude-rpc.service.ts:185-213`), so this is dormant risk, not live risk, but it's a landmine for a future refactor that makes any awaited call in that chain throw — the busy flag would still reset (finally), but `_error` would never be set and the failure would be a silent unhandled-rejection in devtools with zero user-facing feedback.

## Failure Mode Analysis

### Failure Mode 1: Worktree isolation is cosmetic (F-D1)

- **Trigger**: user checks "isolated worktree" on a card's Start action.
- **Symptoms**: worktree is created on disk (visible in the editor's worktree UI); the launched agent session operates against the main workspace root, not the worktree.
- **Impact**: functional gap against R6.2's intent ("the flow SHALL create the worktree... and the session SHALL be associated with that worktree"). The literal letter of R6.2 ("no new worktree plumbing in phase 1") is honored by NOT building the association — but the acceptance criterion's practical outcome (isolated session) is not delivered.
- **Current handling**: `cwd` is threaded through `ChatPromptRequest` and carried but not consumed by `startNewConversation`; documented in code comments and in tasks.md as accepted-phase-1 + tracked as **F-D1** (HIGH priority follow-up).
- **Recommendation**: confirmed as already tracked; no new ticket needed. Recommend the UI surface a one-line notice when `useWorktree` is true ("session will run against the main workspace until worktree association ships") so users aren't misled by the toggle's presence, until F-D1 lands.

### Failure Mode 2: Phantom `in_progress` on structural `chat:start` failure (F-D2)

- **Trigger**: `chat:start` RPC succeeds at the transport layer but the backend response body signals failure (`result.data?.success === false`) — e.g., AUTH_REQUIRED, unavailable model, license gate.
- **Symptoms**: card status flips to `in_progress` with no running session; user sees a "started" task with nothing actually happening in chat.
- **Impact**: MODERATE — misleading board state, but self-healing (task not exclu­ded, status is a plain field, re-Start is idempotent — worst case is a confusing few minutes, not data loss).
- **Current handling**: tracked as **F-D2** (MED priority); QA.2 is explicitly tasked to force-verify a structural failure leaves no phantom transition — **as written, it currently WILL flip the phantom transition**, so QA.2 should currently fail this specific check unless something downstream I didn't trace changes the outcome.
- **Recommendation**: confirmed as already tracked; flagging because the QA task description implies the current code passes this check when, on the evidence read here, it does not (yet) — worth double-checking during QA.1/QA.2 execution rather than assuming green.

### Failure Mode 3: BOM-prefixed `task.md` silently excluded (new, not previously tracked)

- **Trigger**: a `task.md` written by an external Windows tool (e.g. PowerShell `Out-File` defaults to UTF-8 BOM) or hand-edited and re-saved with a BOM.
- **Symptoms**: the task disappears from the board/registry with zero error — folded into the generic `excludedCount` with `reason: 'no_frontmatter'`, indistinguishable from a folder that never had frontmatter at all.
- **Impact**: low probability (system-authored `task.md` files go through `IFileSystemProvider.writeFile`, which is unlikely to inject a BOM), but a plausible support question once users start hand-editing `task.md`.
- **Current handling**: correctly degrades (no crash), consistent with NFR-5, but the `ExcludedTaskFolder.reason` union doesn't have a `bom`/`encoding` distinction to help a future user or agent diagnose it.
- **Recommendation**: non-blocking; consider stripping a leading BOM before the regex test in a follow-up (`raw.replace(/^﻿/, '')`).

### Failure Mode 4: `TaskStartService.start()` has no `catch`, only `finally`

- **Trigger**: any awaited call inside `start()`'s try block throws (currently dormant — `ClaudeRpcService.call` and `TasksStore.updateStatus/loadBoard` are verified to never reject).
- **Symptoms**: `_busyTaskId` still resets correctly (finally runs), but `_error` is never set, so no error toast/banner reaches the user; the rejection surfaces only as an unhandled-promise-rejection console entry, and the caller (`tasks-view.component.ts:350`, `void this.taskStart.start(...)`) doesn't `.catch()` it either.
- **Impact**: currently dormant (no live code path throws), but zero defense-in-depth for a future change.
- **Recommendation**: add a `catch (error: unknown) { this._error.set(...) }` around the `start()` body as cheap insurance; non-blocking for this review.

### Failure Mode 5: `parseBatchVerdicts` retention (A-2) — interpretation review

- **Trigger**: reviewer reads R7.1 ("frontmatter parsing ONLY... legacy emoji-status parsing path SHALL be REMOVED, not kept as fallback... no legacy support") as banning ALL `tasks.md` parsing, not just emoji/task-level status inference.
- **My reading**: I side with the implementation's interpretation. R7's acceptance criteria (R7.1–R7.3) are scoped entirely to **task-level status/completion detection** (the `completed` boolean gating harvest eligibility), which is now 100% frontmatter-driven with zero emoji/marker-file/state-json inference — verified: `detectStatus` (`spec-extractor.ts:69-74`) uses only `\bFAILED\b` / `\b(PENDING|IN PROGRESS|IMPLEMENTED)\b` / `\bCOMPLETE\b` word-token regexes, no emoji characters anywhere in the file (grep + visual read confirm). `parseBatchVerdicts` is a _different_ concern — per-executor batch telemetry for skill-synthesis — not mentioned anywhere in R7's acceptance criteria text. Reading "no legacy support" as reaching into that unrelated subsystem would be an expansive interpretation the requirement text doesn't support.
- **Verdict**: ACCEPT the retention as implemented. Non-blocking. Recorded per the task's request to "confirm or reject this reading."

## Critical Issues

None.

## Serious Issues

### Issue 1: Structural `chat:start` failure is not surfaced to the Start flow's resolve bridge (F-D2)

- **File**: `libs/frontend/chat/src/lib/services/message-sender.service.ts:389-398` (swallows failure), consumed via `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:61,67-71` (resolves success by default), acted on in `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:84-97` (transitions status on `launch.success`).
- **Scenario**: `chat:start` returns `{ success: false, data: { success: false, error: 'AUTH_REQUIRED' } }` (a valid, non-exceptional RPC round trip). `startNewConversation` logs it, marks the local session `failed`, and returns normally (no throw).
- **Impact**: `TaskPromptBridgeService.consume()`'s `outcome` stays at its default `{ success: true }` (only the `catch` branch overwrites it), so `request.resolve({ success: true })` fires, `TaskStartService` proceeds to `tasks:updateStatus(taskId, 'in_progress')`, and the board shows a phantom `in_progress` task.
- **Evidence**: see Failure Mode 2 above — read directly from source, not inferred.
- **Fix**: already scoped as **F-D2** in tasks.md (make `send()`/`startNewConversation` failure-aware for structural failures, or have the bridge inspect post-send session state before resolving success). Reviewer note: QA.2's acceptance criterion ("structural-failure branches leave no phantom transition") should be expected to FAIL against the current code until F-D2 lands — worth confirming during QA rather than assuming it already passes.

## Moderate Issues

### Issue 1: BOM-prefixed `task.md` is silently excluded with no distinguishing reason

- **File**: `libs/backend/task-specs/src/lib/task-frontmatter.ts:51,84-86`
- **Scenario**: any `task.md` saved with a leading UTF-8 BOM.
- **Impact**: task vanishes from board/registry, folded into the generic excluded count; no diagnostic signal distinguishes "BOM" from "genuinely no frontmatter."
- **Fix**: strip a leading `﻿` before testing `FRONTMATTER_RE` (or add an `ExcludedTaskFolder.reason: 'bom'` if precision matters). Non-blocking — low real-world likelihood given system-authored files.

### Issue 2: Worktree isolation toggle has no in-UI caveat while F-D1 is outstanding

- **File**: `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts` (consumer-facing behavior), `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:26-29` (documents the gap in a code comment only, not surfaced to the user).
- **Scenario**: user enables worktree isolation expecting the agent to operate on the isolated branch.
- **Impact**: silently misleading UX until F-D1 lands; not a data-integrity risk (the worktree itself is created correctly and is usable manually), but a trust/expectation gap.
- **Fix**: already tracked as F-D1 (HIGH); recommend also surfacing a transient notice in the Start flow UI in the interim, distinct from the backend fix itself.

### Issue 3: `TaskStartService.start()` has no `catch`, relying entirely on downstream never-throwing guarantees

- **File**: `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:67-101`
- **Scenario**: any future change to `ClaudeRpcService.call`, `TasksStore.updateStatus/loadBoard`, or `AppStateManager.requestChatPrompt` that introduces a throw.
- **Impact**: `_busyTaskId` resets correctly (finally), but no error surfaces to the user; console-only unhandled rejection (the call site at `tasks-view.component.ts:350` uses `void` without `.catch()`).
- **Fix**: add a defensive `catch (error: unknown) { this._error.set(...) }`. Cheap, non-blocking.

## Data Flow Analysis

```
Card "Start" click (tasks-view.component.ts:350, `void taskStart.start(...)`)
  │
  ▼
TaskStartService.start(taskId, useWorktree)              [tasks-ui, no chat import — verified]
  │ (1) optional git:addWorktree → correlated push        [5-min timeout, cancels cleanly on settle]
  │     worktree FAILS → toast, RETURN (no session, no status change)          ✓ verified short-circuit
  ▼
appState.requestChatPrompt({ prompt, cwd?, resolve })      [core signal bridge — 30s guard, clearTimeout on settle]
  │
  ▼
TaskPromptBridgeService.consume()                          [chat lib, root-provided — GAP: swallowed
  │  createTab → setCurrentView('chat') → messageSender.send()   structural chat:start failure (Issue 1)]
  │  finally: request.resolve(outcome); clearChatPromptRequest(); processing=false
  ▼
back in TaskStartService: launch.success?
  │  NO  → toast, RETURN (status untouched)                                    ✓ verified short-circuit
  │  YES → TasksStore.updateStatus(taskId, 'in_progress')                      ⚠ can fire on phantom success (Issue 1)
  ▼
TasksRpcHandlers.registerUpdateStatus → TaskWriterService.updateStatus
  │  file mutated FIRST (readâ†’updateFrontmatterâ†’write), THEN indexNotifier.applyFolderChange   ✓ R3.5 verified
  ▼
TaskIndexService.applyFolderChange → rebuild() → store.replaceWorkspace (DELETE+INSERT) → fireChange('write')
  ▼
TasksRpcHandlers constructor subscription → webviewManager.broadcastMessage('tasks:changed')
  ▼
TasksStore.handleMessage → refreshFromPush() → loadBoard() (+ re-open selected detail)   ✓ no optimistic state, verified
```

### Gap Points Identified

1. **The single gap in this entire chain that produces observably wrong state**: the `chat:start` structural-failure swallow (Issue 1 / F-D2) — everything upstream and downstream of it is correctly gated, never-throws, and byte/write-order clean.
2. Worktree `cwd` is carried faithfully through every hop of the bridge but is a documented dead-end at the session-creation boundary (F-D1) — not a corruption risk, a scope gap.
3. No data can be lost or corrupted anywhere in this flow — worst case is a stale board (mitigated by push + explicit reindex) or a mis-stated status (mitigated by idempotent re-call).

## Requirements Fulfillment

| Requirement                 | Status                                  | Concern                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 (frontmatter + Zod)      | COMPLETE                                | Essential-field-only Zod gating (status/title) vs. a single whole-object parse — accepted design per team-leader D1 ruling; per-field Zod checks still cover every field individually.                                      |
| R2 (registry generation)    | COMPLETE                                | Determinism verified by construction (`max(updated)` header, pure ordering fn); did not execute the live 85-folder run myself (QA.1's job), but the code path is sound.                                                     |
| R3 (SQLite index + watcher) | COMPLETE                                | Debounce, write-order, rebuild-equivalence all verified in source.                                                                                                                                                          |
| R4 (`tasks:` RPC)           | COMPLETE                                | Dual registration verified present in both the compile-time union and `ALLOWED_METHOD_PREFIXES`; every method Zod-parses; no absolute-path leakage found.                                                                   |
| R5 (Tasks tab)              | COMPLETE                                | Boundary isolation verified (no backend/chat imports); markdown routed through chokepoint (not independently re-verified byte-for-byte, but no `[innerHTML]` found in the reviewed files).                                  |
| R6 (Start → orchestration)  | PARTIAL                                 | R6.2 (worktree association) not functionally delivered (F-D1); R6.4 (no phantom transition on start failure) not fully delivered for the structural-failure branch (F-D2, Issue 1 above). R6.1/R6.3/R6.5 verified complete. |
| R7 (spec-harvester)         | COMPLETE                                | Emoji/marker-file/state-json inference fully removed and verified absent; `parseBatchVerdicts` retention is a reasonable, in-scope interpretation (see Failure Mode 5).                                                     |
| R8 (skill docs)             | Not independently re-verified this pass | Team-leader's E.3 verdict (grep for trademarked strings = zero matches, manifest regenerated) is credible and outside this review's primary scope (item 5/6 of the assignment); no reason to doubt it.                      |

### Implicit Requirements NOT Addressed

1. No UI signal distinguishing "worktree requested and actually honored" vs. "worktree created but session runs on main tree" (ties to F-D1).
2. No UI signal for the phantom-`in_progress` window when a structural `chat:start` failure is swallowed (ties to F-D2) — user has to notice the session never started and manually investigate.

## Edge Case Analysis

| Edge Case                                    | Handled                     | How                                                                             | Concern                                                    |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| BOM-prefixed `task.md`                       | Degrades, not crash         | `FRONTMATTER_RE` fails to match → `no_frontmatter` exclusion                    | Indistinguishable from "no frontmatter at all"; Moderate-1 |
| CRLF body preservation                       | YES                         | Regex tolerates `\r?\n`; body sliced untouched                                  | None                                                       |
| `---` inside body code fence                 | YES                         | Lazy regex bounds at first real closing delimiter                               | None                                                       |
| No closing `---`                             | YES                         | Regex fails to match → clean exclusion                                          | None                                                       |
| Rapid double-click Start                     | YES                         | `_busyTaskId` gate                                                              | None                                                       |
| Watcher burst (N writes, 1 folder)           | YES                         | 300ms debounce, pending-set coalescing                                          | None                                                       |
| `.archive/` and `registry.md` watcher events | YES                         | Explicitly filtered in `extractFolder`                                          | None                                                       |
| No workspace open                            | YES                         | `RpcUserError('WORKSPACE_NOT_OPEN')`                                            | None                                                       |
| `tasks:create` target folder exists          | YES                         | Double-checked (`folderPath` then `carrier`) before write, `TASK_FOLDER_EXISTS` | None                                                       |
| Worktree RPC times out                       | YES                         | 5-min ceiling on the correlated-push promise                                    | None                                                       |
| Chat-prompt resolve never arrives            | YES                         | 30s guard timeout maps to failure                                               | None                                                       |
| Structural `chat:start` failure              | **NO**                      | Swallowed into resolved success                                                 | Issue 1 / F-D2                                             |
| Worktree cwd association                     | **NO (by design, phase-1)** | Carried but not consumed                                                        | Issue 2 / F-D1                                             |

## Integration Risk Assessment

| Integration                                  | Failure Probability                                             | Impact                                                         | Mitigation                                                  |
| -------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `chat:start` structural failure → Start flow | MEDIUM (auth/license/model-availability failures are realistic) | Phantom `in_progress` status                                   | Idempotent re-call; F-D2 tracked fix pending                |
| Worktree creation → session cwd              | LOW (isolation just doesn't happen, doesn't fail)               | Misleading UX, not data risk                                   | F-D1 tracked fix pending                                    |
| SQLite unavailable → InMemory fallback       | LOW                                                             | None (parity claimed, not independently re-verified this pass) | `instanceCachingFactory` lazy selection per team-leader B.2 |
| Watcher unavailable on a host                | LOW                                                             | Index goes non-live, still correct on RPC-triggered reindex    | Try/catch + warning log                                     |
| `webviewManager.broadcastMessage` failure    | LOW                                                             | Stale board until next unrelated push/manual reindex           | Logged, non-fatal                                           |

## Verdict

**Recommendation**: APPROVE WITH MINOR ISSUES (no blocking defects found; one Serious behavioral gap that is already tracked as a follow-up, not a fresh regression).

**Confidence**: HIGH for the parser/scanner/index/RPC layers (read every relevant line, traced every claimed invariant against source); MEDIUM for the DI wiring across all three hosts (spot-checked registration call sites only, did not execute `nx typecheck`/live-tree QA myself) and for the `InMemoryTaskIndexStore` parity claim (not independently re-verified).

**Top Risk**: F-D2 (phantom `in_progress` on a structural `chat:start` failure) is the one place where the code currently produces an observably wrong result on a plausible, non-exotic input (auth/model-availability failure). It's tracked, but QA.2's stated acceptance criterion implies the current code already passes this check — it does not, on the evidence read here — so this should not be waved through as "already handled."

## What Robust Implementation Would Include

- A `send()`/`chat:start` contract that distinguishes "transport succeeded, backend rejected" from "fully started," surfaced as a rejected promise or a discriminated result the bridge can branch on (closing F-D2).
- Actual worktree-scoped session association (closing F-D1), or, short of that, an explicit UI acknowledgment that isolation is not yet wired so users don't trust a toggle that doesn't do what it says.
- A `catch` (not just `finally`) around `TaskStartService.start()`'s body as defense-in-depth against any future throwing dependency.
- BOM-tolerant frontmatter detection, or a dedicated exclusion reason so a user/agent debugging a "missing" task can tell BOM-corruption apart from a genuinely absent carrier.
