# Follow-up findings — TASK_2026_315

Findings surfaced _during_ this task that are genuinely out of its scope.
Recorded here as they are found so none is lost at close-out. Each needs a
decision at the end of the task: fold in, spin out as its own TASK, or drop
with a reason.

Nothing in this file has been fixed.

**Spun out 2026-08-24**: F5 -> TASK_2026_319, F3 -> TASK_2026_320,
F7 -> TASK_2026_321, F12 -> TASK_2026_318. The remaining eight are recorded
for whoever next touches the relevant code, not queued.

---

## F1 — `reconfigureAuthIfChanged` has no in-flight de-duplication

**Source**: `code-logic-review-batch-1.md`, Failure Mode 1. Found while
reviewing A1; pre-existing, not introduced by this task.

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (`:301`,
`:255-284`)

`handleWorkspaceChanged` calls `this.reconfigureAuthIfChanged().catch(...)`
with no `await`, and there is no mutex on the chain — contrast `initialize()`,
which already has `initInFlight` for exactly this reason. A rapid
remove-then-add (or a second switch before the first
`configureAuthentication()` promise settles) races two configure calls, and
whichever resolves LAST wins `lastConfiguredAuth`. A subsequent
`handleWorkspaceChanged` can then wrongly skip or wrongly run a reconfigure off
that stale record.

Same failure _class_ as A1 itself — silent wrong state, nothing throws — but it
needs a narrow timing window and A1's guard does not touch it. The reviewer
explicitly declined to block Batch 1 on it.

**Suggested shape**: give the chain the same in-flight de-duplication
`initialize()` has.

**Severity**: low-medium. **Recommend**: spin out as its own TASK.

---

## F2 — `TaskViewsService` takes the same `WORKSPACE_NOT_OPEN` refusal

**Source**: `batch-3-report.md`, "Two things a reviewer should know" (1).
Self-flagged by the frontend developer as outside Batch 3's file list.

**File**: `libs/frontend/tasks-ui/src/lib/services/task-views.service.ts`

`tasks:getViews` crosses the same namespace boundary as `tasks:board` and earns
the same typed refusal with no folder open, surfacing it through its own error
slot. It does **not** loop — it is called once at init, not on focus — so the
A2 defect proper does not apply. The concern is only that the saved-views error
probably reads badly on a screen that has just calmly explained no folder is
open.

**Ruled on by the Batch 3 reviewer (Failure Mode 3): keep it OUT of this task.**
Different symptom class (one-time stale text, not an unbounded refetch loop),
different file, and the likely fix shape — give `TaskViewsService` its own
`noWorkspace`-style read, independent of the board — is well-scoped work on its
own. Confirmed it does not block Batch 3.

The precise symptom: `TaskViewsService.load()` (`:285-309`) sets `_error` to the
raw backend sentence `'No workspace folder open.'` verbatim (`:295`) and renders
it on the saved-views menu, indistinguishable from a real transport failure —
the same raw string the board itself stopped showing in this task.

**Severity**: low, cosmetic. **Recommend**: spin out as its own TASK.

---

## F3 — `rpc-handlers` Jest suites fail to run under parallel load

**Source**: `batch-1-report.md`, "Flake note on command 5". Pre-existing.

Launching `npx nx test rpc-handlers` concurrently with another Jest project
produced a batch of "Test suite failed to run" entries. Two clean sequential
re-runs passed all 87 suites, and `rpc-allowlist.spec` passed in isolation. The
output carries Jest's `A worker process has failed to exit gracefully and has
been force exited` — which is present on the PASSING runs too, so the leak is
there either way and parallel load only makes it fatal.

This matters beyond cosmetics: it makes concurrent batch verification
unreliable, which this very task depends on.

**Severity**: medium (CI/DX). **SPUN OUT -> TASK_2026_320** (2026-08-24),
carrying the nx multi-project truncation trap with it.

---

## F4 — `sdk-agent-adapter.ts` is 847 lines against a 700 soft ceiling

**Source**: `batch-1-report.md`, "Lint note". Pre-existing — 841 lines before
this task, 847 after; the delta is the 6 counted lines of the A1 guard.

Warn-level only. Per the root `CLAUDE.md`, line count alone is not the signal
and a bugfix batch is not the place to split a 10-concern adapter. Recorded so
the number is tracked, not because it needs action now.

**Severity**: none today. **Recommend**: drop unless the file grows further.

---

## F5 — Boot spends tokens with no user action, and `tasks.md` misattributed it

**Source**: `batch-4-report.md`, B1(b). The attribution in this task's own plan
was wrong and is corrected here.

**File**: `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:53`
(`bootScan: true`) — **NOT** `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:802`,
which `tasks.md` named. That path calls `synthesis.enqueueAnalyze`, a local
SQLite insert that spends nothing upstream; the trace confirms it issues no
query. The real spender is `MemoryTriggerService.runBootScan`
(`memory-trigger.service.ts:805`), which calls `curator.curate` once per session
newer than the watermark.

Booting Ptah therefore issues LLM calls with no user action. B1's ordering half
is fixed (the query no longer runs before MCP exists), but the spend itself is
untouched.

Deliberately not changed in Batch 4: flipping a shipped default from `true` to
`false` is a product decision about whether Ptah learns from your history
unprompted, not a bugfix. The behaviour is already gated by a setting,
abortable via `bootScanController`, watermarked so only unseen sessions are
processed, and budget-limited downstream.

**Suggested shape**: a one-line default change plus a settings-UI story, or an
explicit decision to keep it on.

**Severity**: medium (cost, and a consent question).
**SPUN OUT -> TASK_2026_319** (2026-08-24), with the corrected file pointer.

---

## F6 — The worker heap budget has no consequence, and cannot get one here

**Source**: `batch-4-report.md`, C3, disclosed rather than papered over.

C3 fixed a check that was measuring the wrong process, and the new one measures
an attributable warmup delta. But exceeding it still only logs. There is no
reclaim lever at that seam: `EmbedderWorkerClient` exposes `embed` / `rerank` /
`warmup` / `dispose` and nothing else, and disposing the worker is exactly what
warmup exists to avoid.

A real consequence needs the worker's own RSS reported back over
`embedder-worker-protocol.ts`, which is a `memory-curator` change.

**Severity**: low. **Recommend**: fold into any future embedder work.

---

## F7 — C6, spun out of Batch 4

**Source**: user decision, recorded in `tasks.md` Task 4.4.

Harness reconcile runs twice at boot (`reason: activation`, then
`content-download-complete`) and re-emits an identical thirteen-path blocked
warning both times. **The refusal behaviour is correct and must not change** —
this is about log volume only. The full specification is preserved verbatim in
`tasks.md` under Task 4.4.

Removed from Batch 4 because a concurrent session owns
`libs/backend/harness-sync/**`.

**Severity**: low. **SPUN OUT -> TASK_2026_321** (2026-08-24). Check the
concurrent session has landed before starting.

---

## F8 — The `.mcp.json` / harness-reconcile ordering was never differentially tested

**Source**: `code-logic-review-batch-4.md`, Moderate Issue 1 — the reviewer's
top residual risk, and the one claim they could not close.

Batch 4 moved MCP bring-up ahead of the heavy boot, so `.mcp.json` gains its
`ptah` key BEFORE the harness reconcile runs, where it previously ran after. The
developer verified this empirically — but on a workspace where `missing` and
`foreign` were already zero on both sides, so the differential case was never
exercised. Neither developer nor reviewer could read `harness-reconciler.service.ts`
to check the coupling directly, since another session owns it.

Circumstantial evidence from `plugin-activation.ts` suggests reconcile and
`.mcp.json` may not be coupled at all. Unconfirmed.

**Suggested shape**: re-run the boot on a workspace with non-zero blocked /
foreign counts and compare reconcile output before and after the reorder.

**Severity**: unknown — that is the point. **Recommend**: close out in Batch 7's
cross-cutting sweep; it is already assigned there.

---

## F9 — `mainWindow` is never nulled on window close

**Source**: `code-logic-review-batch-4.md`, Minor Issue 2 and Moderate Issue 2.
Pre-existing.

A destroyed-but-not-nulled window makes a push drop silently with no log at all
— neither the debug line nor the warning Batch 4 preserved for mid-session
loss. `main.ts` does not null `mainWindow` on close.

**Severity**: low. **Recommend**: fold into any future Electron window-lifecycle
work.

---

## F10 — The daily-backup handlers still misreport a no-op as success

**Source**: `code-logic-review-batch-5.md`, non-blocking finding 2. **Same
defect shape as C2, in the handlers C2 deliberately left alone.**

**Files**: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:200`,
`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:424`

Batch 5 gave `JobHandlerResult` an `outcome` channel and fixed the two skill-drain
seams. The two daily-backup handlers were correctly left untouched — they were
out of C2's scope and their optionality is what proves the change is
backwards-compatible. But they still return
`{ summary: 'skipped: no sqlite connection' }`, the exact prose form that WAS
the defect, so that no-op path still records as `succeeded`.

The fix is now trivial and mechanical: adopt the `outcome`/`reason` channel that
already exists.

**Severity**: low (rarer trigger than the drain path). **Recommend**: fold into
any future cron work, or a small cleanup task.

---

## F11 — The TUI shows a run's status but never its reason

**Source**: `code-logic-review-batch-5.md`, non-blocking finding 1.
Pre-existing; Batch 5 neither introduced nor closed it.

**File**: `apps/ptah-tui/src/components/thoth/SchedulesPanel.tsx`

The panel reads `run.status` but never `run.resultSummary`. After C2, a TUI user
correctly sees `skipped` — but never `daily-token-budget-exhausted`, which is
the half that answers "why did synthesis stop". The Angular drawer and the CLI
both surface it; only the TUI drops it.

**Severity**: low. **Recommend**: fold into any future TUI work.

---

## Note on report accuracy (no action)

`code-logic-review-batch-5.md` finding 3: `batch-5-report.md` presents the
`lastRunAt` bump on the handler-skipped path as "one judgement call" made during
that batch. The diff shows the line is unchanged pre-existing code — only the
justifying comment is new. The reasoning is sound and the behaviour is correct;
the framing overstated what changed. Recorded because this task's reports are
being used as the durable record of why things are the way they are.

---

## F12 — Unlocked second writer on `.mcp.json`, and A3 widened the window

**Source**: `test-report.md`, Task 7.4. Surfaced by the F8 source trace, which
was looking for something else.

**Files**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`
(`:97-100`, and its `registerInMcpJson` / `unregisterFromMcpJson`),
`apps/ptah-electron/src/activation/wire-runtime.ts:499`

`CodeExecutionMCP` does its own raw `fs.readFileSync` / `fs.writeFileSync` on
`{ws}/.mcp.json`, **outside** `harness-sync`'s `withMcpConfigLock`. Harness-sync's
own design note states the rule this breaks: _"Never add a SECOND writer to an
MCP config file... A module that hand-rolls its own read-modify-write on a file
this lib also writes will lose an entry — not corrupt it, lose it, silently."_

Today it is safe, for two reasons that are both coincidence rather than design:
the two writers happen to run sequentially at boot, and `"ptah"` is a key the
reconciler never inspects.

**This task made the window wider, and that should be said plainly.** Before
A3 (`3cfba7b`), `ensureRegisteredForSubagents` was one-shot at boot. A3 added a
`workspaceFoldersSubscription` so the second workspace actually gets an entry —
the correct fix for the defect. But `propagateHarness()` (`wire-runtime.ts:499`)
also fires on `onDidChangeWorkspaceFolders`, unawaited. Both writers can now be
triggered by the same event, which was not true before.

Not observed failing, and not a regression in behaviour anyone has seen — the
lost-update requires the two to interleave mid-write on a key the reconciler
would then have to care about. But it is structurally the exact pattern
harness-sync documents as forbidden, and this task moved it closer to firing.

**Suggested shape**: route the `CodeExecutionMCP` writes through
`withMcpConfigLock`, or give `.mcp.json` a single owner.

**Severity**: low today, latent. **SPUN OUT -> TASK_2026_318** (2026-08-24).
Worth doing before anything adds a third trigger; whoever takes TASK_2026_321
will already be in `harness-sync`.
