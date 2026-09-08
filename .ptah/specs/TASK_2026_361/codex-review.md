# TASK_2026_361 — in_review → done gate

Reviewer: Claude (orchestrator gate) + independent Codex CLI agent
`21785d8c-4114-4f96-a81e-5a29b1ca506f` (CLI session `01a07da0-f623-7072-b8f7-af20f5f5e9bd`, exit 0).
Date: 2026-09-08. Read-only review; no source file and no `task.md` was changed.

Task: **Setup wizard: honest phase and generation outcomes, on-disk enhanced prompt,
resumable analysis, git-tracked .claude harness dirs**

## 1. Acceptance criteria

Criteria extracted from `.ptah/specs/TASK_2026_361/context.md` § Scope (1–6).

| #   | Criterion                                                                                                                                                       | Codex   | Adjudicated | Evidence                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 | Phase timeout ⇒ `failed` + non-empty `error`, never `completed`; partial text preserved but never promoted; text capture must bypass the throttled UI stream       | PARTIAL | **PARTIAL** | Fixed for a first run: `multi-phase-analysis.service.ts:659-689` captures raw `assistant`/`result` SDK messages (comment at `:555-558` states persistence never reads the throttled path); `:371` `succeeded = resultReceived && !timedOut && !error`; `:399-415` failure keeps text as a diagnostic file and calls `markFailed`. Consumers now filter (`enhanced-prompts.service.ts:977` `status !== 'completed'` skip). **Gap: resume can promote a stale partial file to `completed`** — see B3. |
| AC2 | `enhanced-prompt.md` + JSON meta written into the analysis slug dir on every successful `runWizard`/`regenerate`                                                  | PARTIAL | **SATISFIED** | `enhanced-prompts.service.ts:495-514` writes the trace BEFORE state and returns `success:false` if it throws; `analysis-storage.service.ts:42,383` writes `enhanced-prompt.md` + `.json`; `regenerate` (`:583-612`) funnels through `runWizard`. Codex's downgrade rests on the no-slug fallback writing to the analysis root (`analysis-storage.service.ts:389`), which is a documented, still-on-disk fallback — **claim dropped**. |
| AC3 | Watchdog aborts the orchestrator (or the outcome is honest); per-agent `written\|unchanged\|failed` + `rejectedSections` + output dir + propagation in payload AND completion UI; `generatedCount` gone | PARTIAL | **PARTIAL** | Watchdog genuinely aborts: `wizard-generation-run.supervisor.ts:208-212` aborts the single controller, `:225-243` awaits real settlement; signal threaded at `orchestrator.service.ts:744-753` and re-checked per write. Propagation gated on real writes: `wizard-generation-rpc.handlers.ts:361-363`. `generatedCount` is gone from the wire type and every wizard consumer. **Gap: `rejectedSections` never rendered** — see B4. |
| AC4 | Resumable analysis + generation: on-disk checkpoints, `resume` over RPC + UI, pause = graceful cancel that keeps checkpoints, host restart resumes from the manifest | NOT SAT | **PARTIAL — blocking** | Wiring is real and dual-registered: `rpc.types.ts:775,3328` + `rpc-handler.ts:60` (`wizard:` prefix) + `setup-rpc.handlers.ts:92,412` + `wizard-rpc.service.ts:201,231` + `wizard-analysis-runner.service.ts:176-213`. Non-destructive resume exists (`analysis-storage.service.ts:161-169 ensureSlugDir`, `analysis-run-checkpoint.ts:64-81`). **Three holes: B1, B2, B5.** |
| AC5 | `.gitignore` tracks `.claude/{agents,commands,output-styles,skills}`, rest of `.claude/*` ignored                                                                  | SAT     | **SATISFIED** | `.gitignore:151` broad ignore; `:159-164` agents/commands/output-styles re-included; `:204-207` skills + workflows; `:98-100` worktrees and `settings.local.json` stay ignored.                                                                                                 |
| AC6 | Specs for every new path                                                                                                                                          | NOT SAT | **PARTIAL** | Coverage is substantial and green — `agent-generation` 31/31 suites, 957/957 tests; `setup-wizard` 12/12, 319/319; `wizard-generation-rpc.handlers.spec.ts` has 40+ cases incl. watchdog-abort (`:1008`), cancel-as-pause (`:1051`), five resume cases (`:1131-1278`). Codex's "NOT SATISFIED" overreaches; downgraded to PARTIAL because the B1–B5 paths are exactly the untested ones. |

### Test run (mine, `--skip-nx-cache`)

`npx nx run-many -t test -p @ptah-extension/agent-generation @ptah-extension/rpc-handlers @ptah-extension/setup-wizard`

- `@ptah-extension/agent-generation` — 31/31 suites, 957/957 green.
- `@ptah-extension/setup-wizard` — 12/12 suites, 319/319 green.
- `@ptah-extension/rpc-handlers` — 2 suites red, **both unrelated to this task**:
  `voice-rpc.handlers.spec.ts` (5 s jest timeout under load) and a skills.sh
  `EBUSY: unlink` on a Windows temp plugin dir. A second, contended run also
  timed out `setup-rpc.handlers.spec.ts`; run in isolation it is **43/43 green**
  (`npx jest --runTestsByPath src/lib/handlers/setup-rpc.handlers.spec.ts`).
  These are environment flakes, not task defects.

## 2. Codex raw verdict

> VERDICT: NEEDS_WORK

Codex reported AC1/AC2/AC3 PARTIAL, AC4 and AC6 NOT SATISFIED, AC5 SATISFIED, plus
four "additional blocking findings".

## 3. My adjudication of Codex

**Confirmed** (I opened each file at the named line): the mixed-lifecycle discovery
hole, the dead `hasResumableAgentWork`, the destructive discovery-failure path, the
unreachable generation pause, the unrendered `rejectedSections`, and the
resume-promotes-a-stale-file hole.

**Dropped — could not confirm as defects:**

- _AC2 PARTIAL_. Writing the trace to `<workspace>/.ptah/analysis/` when no slug
  exists (`analysis-storage.service.ts:389`) is a deliberate fallback with a passing
  spec; the AC's intent (an on-disk trace instead of globalState-only) is met.
- _"Checkpoint persistence failure skips propagation"_
  (`orchestrator.service.ts:756`, `wizard-generation-rpc.handlers.ts:351`). This is
  designed and pinned by `wizard-generation-rpc.handlers.spec.ts:937` ("a checkpoint
  that stops being readable mid-run stops later agents and is reported as a
  failure"). Fail-closed, not a silent failure.
- _"Propagation failures swallowed"_ (`wizard-generation-rpc.handlers.ts:767`). It is
  a logged `warn`, and no acceptance criterion requires surfacing propagation health
  to the user. Noted below as an observation only.
- _"Misreported analysis cancellation"_ (`setup-rpc.handlers.ts:703-715`) and
  _"silent completed-phase read failure"_ (`analysis-storage.service.ts:202-205`).
  Both confirmed as written but both are pre-existing behaviour outside this task's
  scope. Observations, not blockers.

**Added by me** (Codex missed it): the failing `rpc-handlers` suites are unrelated
flakes — I verified `setup-rpc.handlers.spec.ts` passes in isolation, so the red
target must not be read as a task defect. Also `analysis-results.component.ts:152-157`
renders `phase.error` only in an `@else if` after `phase.content`, so a failed phase
that has diagnostic text shows the text with no error message (the red X icon at
`:133` is the only signal) — cosmetic, not a blocker.

## 4. Blockers

### B1 — A mixed generation is finalized `completed`, so its failed agents are unreachable after a restart

`libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:481-489`

```ts
const lifecycle: GenerationSummary['lifecycle'] = aborted
  ? abortReason === 'generation_timeout' ? 'timed-out' : 'paused'
  : successful === 0 ? 'failed' : 'completed';
```

`failedCount` is computed at `:455` and then ignored. 10 written + 5 failed ⇒
`completed`. Discovery only returns a generation whose lifecycle is not `completed`
(`libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:288-291`),
so after a host restart the five failed agents can never be resumed — the
resume-generation banner never appears. AC4 promises the opposite.

The predicate that would fix this already exists and is **dead code**:
`libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts:87`
`hasResumableAgentWork()` — repo-wide grep finds only its own definition.

### B2 — A transient discovery RPC failure silently `rm -rf`s the resumable analysis

`libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:215-222` swallows
every discovery error and returns `{ analysis: null, generation: null }`. The runner
cannot distinguish "no run" from "could not ask", so
`wizard-analysis-runner.service.ts:183-187` falls through to `return this.run(false)`,
which sends `deepAnalyze({ resume: false })`. That reaches
`analysis-run-checkpoint.ts:81` → `storage.createSlugDir(...)` →
`analysis-storage.service.ts:144-146`:

```ts
if (await this.fs.exists(slugDir)) {
  await this.fs.delete(slugDir, { recursive: true });
}
```

One timed-out RPC at wizard startup destroys every checkpoint and partial phase file
with no user confirmation. This is the exact data loss AC4 was written to end.

### B3 — Resume can promote a stale partial file to `completed`

`libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:365-396`

`fileExists` is read before the outcome is judged, and the replacement write is
guarded by `if (!fileExists)`. On resume the failed phase's diagnostic file is still
on disk (`open(resume)` at `analysis-run-checkpoint.ts:64-81` only demotes `running`
→ `pending`; it deletes nothing). If the re-run returns a successful `result` but the
agent again does not write the phase file — the original F2 failure mode — the stale
lossy text satisfies the file requirement and `markCompleted` runs at `:395`.
AC1 says partial text must never make a phase `completed`.

### B4 — `rejectedSections` reaches the UI state and is then dropped

`libs/shared/src/lib/types/wizard/phase.ts:190,211` carries it;
`libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-phase-generation.ts:101`
stores it in `CompletionData`. `completion.component.ts` never references it — grep
for `rejectedSections` in that file returns nothing, and the tile builder at `:411`
does not carry it through. AC3 requires it "surfaced in `GenerationCompletePayload`
**and the completion step UI**"; only the first half shipped. Given F1 (11 of 15
sections rejected in the reported incident) this is the number the user most needs.

### B5 — "Pause = graceful cancel" is unreachable for generation

`libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:125`
`cancelWizard()` has **no production caller** — the only other hits repo-wide are its
own spec. `generation-progress.component.ts` offers retry and continue but no
pause/cancel. Analysis pause is wired (`scan-progress.component.ts:581` →
`runner.cancel()` → `wizardRpc.cancelAnalysis()`); generation pause is not. The
backend half is fully built (`wizard-generation-run.supervisor.ts:187-192`,
handler spec `:1051` "cancel is a pause"), so this is a missing UI entry point on top
of working plumbing.

## 5. Observations (not blockers)

- `wizard-generation-rpc.handlers.ts:765-770` logs propagation failure as `warn`; the
  completion payload still reads as success.
- `setup-rpc.handlers.ts:703-715` reports `cancelled: true` whenever the service
  resolves, even when `multi-phase-analysis.service.ts:344-348` found nothing running.
- `analysis-storage.service.ts:202-205` `readPhaseFile` catches every error and
  returns `null` with no log.
- `analysis-results.component.ts:152-157` hides `phase.error` when diagnostic
  `phase.content` is present.
- Repo flakes to fix separately: `voice-rpc.handlers.spec.ts:284` (5 s jest timeout)
  and the skills.sh Windows `EBUSY` unlink.

## 6. Final verdict

**NEEDS_WORK.**

The honesty half of the task genuinely shipped: the watchdog now aborts the
orchestrator and the completion reflects the real per-agent outcome, phase timeouts
are recorded `failed`, text capture bypasses the throttled UI stream, the
enhanced-prompt trace is on disk and fails closed, and `.gitignore` tracks the four
harness directories. Test coverage for those paths is real and green.

The resumability half (AC4) is not done end to end. B1 and B2 are the blocking pair:
a mixed run cannot be resumed at all after a restart, and a single transient RPC
failure deletes the checkpoints the task exists to preserve. B3, B4 and B5 are
smaller but each falls inside an explicit acceptance criterion. All five are
untested, which is why AC6 is also short.
