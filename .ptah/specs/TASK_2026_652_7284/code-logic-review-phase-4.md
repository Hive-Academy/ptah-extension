# Code logic review — Phase 4 (Batches 14–15, diff `dbf815fd9..d6938d874`)

Reviewer: code-logic-reviewer (Phase 4). Range reviewed in full: `git diff dbf815fd9..d6938d874`
covering `wizard-generation-rpc.handlers.ts (+spec)`, `orchestrator.service.spec.ts`,
`content-generation.service.ts (+spec)`, `enhanced-prompts.service.ts (+spec)`. All six
source/spec files under review were read whole, plus the supporting services the new gate
depends on (`analysis-freshness.service.ts`, `analysis-storage.service.ts`,
`wizard-generation-checkpoint.service.ts`, `wizard-generation-run.supervisor.ts`), the
plan (`implementation-plan.md:105-108`, risk `:144`), `batches.md:1466-1545`, and the batch
reports 14 and 15. Read-only review: no source edited, no commands run; evidence below is
static trace with file:line.

## Summary table

| #   | Severity | file:line                                                                                                                                                          | One-line issue                                                                                                                                                                                                                                                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Moderate | libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:269-300 (with :237, :356)                                                             | The inserted freshness lookup (manifest reads + workspace fingerprint + phase-file hashing) widens the pre-existing `runs.isActive` check-then-act window; a concurrent submit passes the guard, writes an orphan `running` checkpoint, then gets `success: true` while its `runs.run` promise rejects unobserved. |
| 2   | Minor    | libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:280-285; content-generation.service.ts:621-624; enhanced-prompts.service.ts:1074-1077 | All three new/changed degradation catches discard the failure cause entirely, so a genuine freshness/resolver bug is indistinguishable from a normal stale state in logs.                                                                                                                                          |
| 3   | Minor    | enhanced-prompts.service.spec.ts:142-145,1144-1148; content-generation.service.spec.ts:149-153                                                                     | The new specs' `resolveAuthorizedAnalysisDir` mocks are identity-style and accept out-of-root absolute paths, so the workspace-relative→canonical comparison (the exact bug class the Task 20.2 validation note targets) is never exercised; extends recorded points (6)/(7).                                      |

No Blocking or Serious findings. All six acceptance checks pass (evidence below).

## Findings

### 1. Moderate — freshness lookup widens the active-run TOCTOU; losing caller gets a false success

**Evidence.**

- `wizard-generation-rpc.handlers.ts:237` checks `this.runs.isActive`, but the run is only
  registered when `void this.runs.run(...)` is reached at `:356` — after `await`s at
  `:269-300` (service resolution + `freshness.getStatus` + `resolveAuthorizedAnalysisDir`),
  `:301` (`resolveRuntime`) and `:302-314` (`createFresh`, a checkpoint write).
- `wizard-generation-run.supervisor.ts:200-205`: `run()` throws synchronously
  (`'A generation run is already active.'`) when a controller is set; the controller is
  assigned before the first `await` (`:204-205`), so once submit A reaches `:356`, any
  submit B that passed the `:237` guard earlier gets an immediately-rejected promise.
- `:356` is `void this.runs.run({...})` — the rejection is discarded, and B continues to
  `:373` and returns `{ success: true }`.

**Why it fails.** The guard at `:237` is check-then-act over ~3 awaited steps. The new
freshness work is the heaviest read phase in that window: `AnalysisFreshnessService.getStatus`
iterates `.ptah/analysis` manifests (`analysis-freshness.service.ts:92-144`), hashes root
package manifests/lockfiles (`computeWorkspaceFingerprint`, `:175-178`) and byte-hashes all
four phase outputs (`:182-204`) — on lockfile-heavy repos this is the slowest pre-launch step
the handler has ever had. The window pre-existed this diff (resolveRuntime + createFresh);
Batch 14 inserted the freshness work in front of it.

**Concrete failure scenario.** A double-clicked "Generate" (or a scripted CLI submit racing
a webview submit; the CLI drives `wizard:submit-selection`, `apps/ptah-cli/src/cli/router.ts:2524`):
B passes `:237` while A is inside `getStatus`. Both write checkpoints. A's `runs.run`
registers; B's `runs.run` rejects with `'A generation run is already active.'` — discarded
by `void` (unhandled rejection: a process-crash default in Node hosts). B's caller still
receives `{ success: true }`, and B's checkpoint stays `running` on disk forever (its
`onSettled` never ran), so a later `resume: true` finds an orphaned run via
`locateResumable` (`wizard-generation-checkpoint.service.ts:186-209`).

**Suggested fix.** Close the window rather than shrink it: reserve the run slot
synchronously right after the guard (e.g. a non-async `runs.begin()` that `isActive`
honours), or at minimum replace `void this.runs.run(...)` with a `.catch()` that logs and
marks the just-written checkpoint failed and returns `{ success: false }` instead of the
unconditional `:373` success.

### 2. Minor — degradation catches log no cause; a real bug looks like normal staleness

**Evidence.**

- `wizard-generation-rpc.handlers.ts:280-285`: `catch {` (no binding) →
  `'could not determine analysis freshness'`, no cause.
- `content-generation.service.ts:621-624`: `catch {` → `'Analysis freshness unavailable'`, no cause.
- `enhanced-prompts.service.ts:1074-1077`: the new `catch {` **removed** the previous
  `{ error: error.message }` detail the old code logged on this path (pre-diff `:1078-1081`).

**Why it fails.** These are the only signals distinguishing "analysis is legitimately
stale/missing" from "the freshness capability broke" (a schema regression, an fs-provider
contract change). Both look identical in logs. The plan's risk (`implementation-plan.md:144`)
requires avoiding _secret-bearing_ logs — error names/classes carry no manifest content or
paths.

**Concrete failure scenario.** `computeWorkspaceFingerprint` starts throwing after a
filesystem-provider update. Every generation silently degrades to gathered context (the
intended safe side), but the operator sees only `'Analysis unavailable or stale'` warnings
at info-equivalent detail and cannot tell a product regression from user workspaces simply
being a week old.

**Suggested fix.** Bind the error and log a content-free descriptor —
`error instanceof Error ? error.name : typeof error` — alongside the existing audit
markers. Keeps the no-secrets guarantee while separating bug from baseline.

### 3. Minor — new specs bypass the canonicalization the batches were validated for

**Evidence.**

- `enhanced-prompts.service.spec.ts:142-145`: the storage mock returns
  `dir.startsWith('.ptah/') ? \`${testWorkspacePath}/${dir}\` : dir`— it returns candidates
unchanged for out-of-root **absolute** paths (the real`AnalysisStorageService.resolveAuthorizedAnalysisDir`, `analysis-storage.service.ts:143-155`,
returns `null`after`path.resolve` canonicalization).
- `enhanced-prompts.service.spec.ts:1144-1148`: the fresh-explicit case feeds
  `analysisDir: '/analysis/dir'` — an absolute path. The real
  `AnalysisStatus.analysisDir` is workspace-relative with `/` separators
  (`analysis-freshness.service.ts:48,66-67`), so the production input shape is never tested.
- `content-generation.service.spec.ts:149-153`: `resolveAuthorizedAnalysisDir: (_root, dir) => dir` —
  pure identity; a workspace-relative `status.analysisDir` vs absolute `context.analysisDir`
  would compare unequal under this mock while comparing equal in production (and vice versa).
- By contrast, the RPC spec emulates the real resolver (`wizard-generation-rpc.handlers.spec.ts:432-441`:
  `path.posix.resolve` + root containment), which is why its new cases are trustworthy.

**Why it fails.** Batches 14/15's validation notes exist precisely because the freshness
`analysisDir` is workspace-relative and must be resolved before comparison
(`batches.md:1482-1484`, `1530-1531`). The production comparison sites
(`enhanced-prompts.service.ts:989-1000`, `content-generation.service.ts:591-613`) were
written for that; the specs' mocks make both sides of each comparison the same strings by
construction, so a regression in the resolution step (wrong resolver, missed canonicalization,
separator mismatch on this Windows-primary repo) passes every new test. I verified the
production comparisons are currently consistent (both sides always pass through
`resolveAuthorizedAnalysisDir` with the same workspace root), so this is a verification gap,
not a live defect.

**Concrete failure scenario.** A future edit drops one `resolveAuthorizedAnalysisDir` call and
compares raw strings. Production: freshness says `.ptah/analysis/acme`, caller dir is
`D:\ws\.ptah\analysis\acme` → permanent false mismatch → silent enrichment loss on every
workspace. All new specs stay green because their mocks never produce two different
representations of the same directory.

**Suggested fix.** Reuse the RPC spec's realistic mock (`path.posix.resolve` + containment
check) in both spec files, and feed the freshness mocks workspace-relative dirs the way
`analysis-freshness.service.ts` produces them.

## Five logic questions

1. **Silent failure?** Finding 1 (false `success: true` for the losing concurrent submit).
   Otherwise the gate's degradation is by design and audit-marked: stale/missing analysis
   proceeds via workspace discovery with a warn log (`wizard-generation-rpc.handlers.ts:331-339`,
   `content-generation.service.ts:595-619`, `enhanced-prompts.service.ts:996-999`).
2. **Unexpected user action?** Regenerating prompts with no analysis at all no longer errors
   ("Please run the Setup Wizard first") — it now self-discovers. That is the plan's
   requirement, not a defect (`implementation-plan.md:107`). A user re-running analysis while
   generation is in flight flips per-template enrichment mid-run (family of recorded point 8).
3. **Wrong answer, not error?** A caller that supplies `analysisData` without `analysisDir`
   (CLI `--file` accepts both independently, `apps/ptah-cli/src/cli/router.ts:2530`) gets its
   unverified data paired with whichever run is fresh — recorded point (1)'s decision family;
   noted in the acknowledgment below, not re-raised.
4. **Dependency failure?** `getStatus` never throws in practice (internal catch →
   `stale/unreadable`, `analysis-freshness.service.ts:80-89`); all three consumers still
   carry belt-and-braces catches. Missing DI registrations fail loudly via `resolveService`
   (`:1140-1156`) — equivalent to the pre-existing orchestrator resolution failure, since both
   tokens are registered together (`agent-generation/src/lib/di/register.ts:99-104`).
   `findLatestMultiPhaseAnalysis` treats an unreadable analysis root as zero runs
   (`analysis-storage.service.ts:713-720`) → safe degrade.
5. **Missing requirement?** "Report stale status to UI" is satisfied through the
   `wizard:analysis-status` RPC plus logging, not the submit response (documented batch
   decision; `WizardSubmitSelectionResponse` has no status field). Acceptable.

## Acceptance checks (task list 1-6)

1. **preComputedAnalysis/analysisDir/phase files only when fresh** — verified at all three
   consumers: `wizard-generation-rpc.handlers.ts:294-330,941,946` (both fields gated on
   `trustedDir`), `content-generation.service.ts:606-613` (phase read only when
   `state === 'fresh' && freshDir && requestedDir === freshDir`),
   `enhanced-prompts.service.ts:982-1016` (no phase file read before the fresh+match gate).
   **Pass.**
2. **Workspace-relative freshness dir resolved before comparison; unauthorized still
   rejected** — `resolveAuthorizedAnalysisDir` precedes every comparison
   (`wizard-generation-rpc.handlers.ts:294-300` vs `:326-330`; `content-generation.service.ts:591-606`;
   `enhanced-prompts.service.ts:982-995`). Unauthorized caller dirs still throw
   `RpcUserError` at `wizard-generation-rpc.handlers.ts:957-973`; the enhanced-prompts RPC
   boundary is untouched (`enhanced-prompts-rpc.handlers.ts:757-774`); content-generation
   degrades an unauthorized internal dir to gathered context without reading it. **Pass.**
3. **Ids, overrides, checkpoint, resume, retry preserved** — `buildOptions:937-946` keeps
   `userOverrides/threshold/variableOverrides/model`; `lastCheckpoint` at `:348`;
   `prepareResumedRun:400-417` and `registerRetryItem:755-812` untouched (retry reuses the
   submit-time-gated `lastGenerationOptions`, consistent semantics). **Pass.**
4. **Regenerate without analysis; forced regenerate invalidates** — hard failure removed
   (`enhanced-prompts.service.ts:644-660`, now passes `undefined` dir);
   `request?.force` → `cacheService.invalidate(workspacePath, 'manual')` at `:650-652`
   before `runWizard`. Spec `enhanced-prompts.service.spec.ts:1496-1539` proves stale/missing
   regenerate succeeds via discovery with `analysisDirectory: null` in the trace. **Pass.**
5. **Discovery failure keeps prior prompt, typed error, never successful** —
   `runWizard:473-486` returns the typed `'Unable to analyze workspace…'` error _before_
   the trace write (`:557-575`) and `stateStore.save` (`:577`); `regenerate:670-673`
   propagates it. Spec `:1469-1494` asserts the prior prompt survives with no
   `globalState.update` and no `cacheService.set`. **Pass.**
6. **No raw JSON.parse / secret-bearing logs / stubs** — zero `JSON.parse` in both changed
   services (manifest now comes from the validated `findLatestMultiPhaseAnalysis` →
   `readManifest` path, `analysis-storage.service.ts:329-334,461-477`); all new degradation
   logs carry state/reason booleans only, no paths or manifest content; no TODO/FIXME/stub
   markers in the four changed source files. **Pass.**

## Recorded minor points — acknowledged, not re-raised

Points (1)–(9) from the review brief are confirmed as described and are not repeated here.
One extension note on point (1), recorded as observation only: the same "no caller
`analysisDir` → newest fresh dir" decision also pairs any caller-supplied `analysisData`
with that substituted dir unverified (possible via CLI `--file`,
`apps/ptah-cli/src/cli/router.ts:2530`; the shipped webview sends `analysisDir` only,
`wizard-rpc.service.ts:116-129`). Same root decision, same trigger, so it stays inside
recorded point (1) rather than a new finding.

## Score and verdict

**Score: 8 / 10.** The gate logic itself is sound: all six acceptance checks hold with
file:line evidence, all three consumers use the same resolver on both sides of every
canonical comparison, degradation is uniformly safe-sided (gathered context, typed errors,
no silent disk writes), and behavior preservation is verified rather than assumed. What
separates it from 9–10: the widened race window (finding 1) and the observability and
spec-realism gaps (findings 2–3). What separates it from 5–6: no finding contradicts the
plan's contracts, no swallowed error misleads on a likely path, and no check item failed.

**Verdict: APPROVED WITH FIXES** — fix finding 1 (reserve the run slot or observe the
`runs.run` rejection); findings 2–3 are cheap hardening worth folding into the next
backend batch.
