# Development Tasks - TASK_2026_306

**Total Tasks**: 27 | **Batches**: 9 | **Status**: Batches 1–5 complete and reviewed; **Batches 6–9 (R2, task widened 2026-08-22) ⏸️ PENDING** — see the R2 section at the end of this file
**Branch**: `ak/boot-blocker-quota-gate` (already created and checked out — do NOT create or switch)
**Scope**: Defects A–G from `research-report.md`. Defect H is noise — opportunistic only, no batch.
**`cli_delegation`**: disabled. Every batch runs on a sub-agent `backend-developer`, sequentially.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

The defect inventory is accurate on every claim I re-checked. Three claims in §B's
"Proposed gate" are **incomplete rather than wrong**, and one file citation points at the
wrong lib. All four are recorded below with mitigation tasks. Nothing found rises to a
BLOCKER — B's design survives, but two of its three steps are materially larger than the
report implies and one of them would not have fired at all in the captured scenario.

### Assumptions Verified

| #   | Assumption (from report)                                                                                                                                              | Result                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cron-scheduler.ts:98` awaits `replayMissed` inside a `try/catch`; the resume path at `catchup-coordinator.ts:62` is already `void`-and-`.catch`                      | VERIFIED — read both. The `try/catch` at `:97-103` does become dead once the `await` is dropped                                                                                                                                             |
| 2   | `wire-runtime.ts:373` awaits `bootHeavyServices`; `:385` logs "Subsystems brought up"                                                                                 | VERIFIED. Note `:353` already fire-and-forgets `bootHeavyServices` on the workspace-change path, so the cold-start `await` is the odd one out                                                                                               |
| 3   | `TranslationProxyBase:545-568` handles the 429 correctly and is the single chokepoint for OAuth-proxy providers                                                       | VERIFIED                                                                                                                                                                                                                                    |
| 4   | `SkillLaneFailureKind` has exactly four members (`lane.types.ts:116-120`)                                                                                             | VERIFIED                                                                                                                                                                                                                                    |
| 5   | `ILaneAuthResolver.resolve()` is specified to throw on an unusable provider, matched by `name` via `PROVIDER_AUTH_ERROR_NAME` (`lane-auth-resolver.port.ts:44-51,59`) | VERIFIED                                                                                                                                                                                                                                    |
| 6   | `LaneResolverService` converts that throw into a stall at `lane-resolver.service.ts:182-205`                                                                          | VERIFIED — that `catch` is the exact insertion point for a quota branch                                                                                                                                                                     |
| 7   | `session-importer.service.ts:477-492` reads an 8192-byte prefix and `JSON.parse`s every split line; the filename fallback at `:516` exists                            | VERIFIED                                                                                                                                                                                                                                    |
| 8   | `workspace-indexer.service.ts` propagates a single `stat` failure out of `indexWorkspaceStream`                                                                       | VERIFIED — unguarded `await this.fileSystemService.stat(filePath)` at `:252` inside the `for` loop at `:232-274`                                                                                                                            |
| 9   | `skillSynthesis:` needs RPC dual-registration for B's user-facing signal                                                                                              | **FALSE, and this is good news.** `skillSynthesis:` is already in `rpc.types.ts` (24 methods, `:1641+`) AND in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts`). A signal riding an existing method's response shape needs no dual-registration |

### Risks Identified

| #   | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Severity                                   | Mitigation                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **The gate as proposed would not have fired in the captured run.** `ProviderAuthResolver.resolve()` returns `null` at `provider-auth-resolver.ts:108-110` when `providerId === ''` and at `:111-113` when the requested id IS the active provider. Every lane ships `provider: ''` (inherit) by default, and the captured run's active provider WAS the exhausted one — so a quota check placed anywhere below those two early returns is unreachable on exactly the path that produced this task                          | **HIGH**                                   | Task 2.3 — the check runs against `providerId \|\| resolveActiveProviderId()` and is evaluated ABOVE both early returns. Still keyed on the resolved id, so `lane.types.ts:15-27` is honoured |
| R2  | **The proxy has no provider id to record against.** `TranslationProxyConfig` (`translation-proxy-base.ts:50-59`) carries a display `name` only (`'Codex'`, `'Copilot'`) — not a registry id (`openai-codex`). Six concrete subclasses, and two of them (`CustomOpenAiTranslationProxy`, `LocalModelTranslationProxy`) serve _dynamic_ provider ids that cannot be a constructor literal                                                                                                                                    | **HIGH**                                   | Task 2.1 threads a provider-id source through the base. This is the step §B most understates — it is not a one-line record call                                                               |
| R3  | **A new failure kind silently defaults to the wrong family.** `SkillDrainService.applyLaneFailure` (`skill-drain.service.ts:886`) is a hardcoded whitelist: `kind !== 'timeout' && kind !== 'auth-unresolvable'` → `markUnscored`. Add `'quota-exhausted'` to the union and it compiles, passes type-check, and lands as a JUDGE verdict on the Activity surface — the exact conflation the header at `:855-878` exists to prevent                                                                                         | **HIGH**                                   | Task 2.4 widens the condition and extends `skill-drain.failures.spec.ts`                                                                                                                      |
| R4  | **Defect E's fix site is not where the report implies.** The rebuild is dispatched from `apps/ptah-electron/src/di/phase-2-libraries.ts:332` (`startTaskSpecsIndex`), not from `wire-runtime.ts` — which contains no task-specs reference at all. SQLite opens far later via `wire-runtime.ts:373 → :145 → boot-thoth-runtime.ts:76`. **Two more hosts have the identical shape**: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:83` and `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:130` | **MEDIUM**                                 | Task 4.2 + 4.3. A reorder inside `wire-runtime.ts` alone cannot close this                                                                                                                    |
| R5  | ~~**Defect F's 13 missing files have no known cause yet.** … `writeFailed:0` rules out permissions; identical counts across both passes rule out a cold cache~~ **CLOSED — and the risk statement itself was wrong on both counts.** `writeFailed:0` ruled out nothing (a blocked path can never enter `writeFailed`), and identical counts are the signature of a CONVERGED steady state, not a stuck retry. The 13 are 13 correct refusals of unowned legacy files — see the Batch 5 block                               | **CLOSED**                                 | Task 5.1 diagnosed it and **Batch 5 did not grow**. No fix to the classification, deliberately. Follow-ups R1–R4 recorded under Batch 5                                                       |
| R6  | `lane-resolver.providers.spec.ts:221` (`names no registry provider anywhere in the model-resolution chain`) reads **compiled function bodies** via `Function.prototype.toString`, covering `LaneResolverService.{resolve,readConfig,readConfigs}` plus `resolveLaneModel` / `resolveJudgeModel`. Any provider-id literal introduced into the quota branch fails it                                                                                                                                                         | **LOW** (it is a working guard, not a gap) | Flagged on Task 2.5. Do not weaken the spec to pass                                                                                                                                           |
| R7  | B's third open question (user-facing signal) has **no existing wire representation** — grepping `libs/shared` for `auth-unresolvable` / `laneFailure` returns nothing. Building one means a response-shape change plus frontend work, which is a different developer type from the rest of Batch 2                                                                                                                                                                                                                         | **MEDIUM**                                 | Open Question 3 on Batch 2. Recommended: defer the UI to a follow-up task and land the backend-observable half only                                                                           |

### Corrections to `research-report.md`

Record these; do not re-derive them.

1. **§B cites `sdk-internal-query.curator-llm.ts:84-91` as the memory curator's fallback.** The file lives in **`agent-sdk`**, not `memory-curator` — `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`, and the fallback is at **`:88-104`** (`resolveCuratorAuth`). `memory-curator`'s own CLAUDE.md is explicit that LLM calls do not live there. Batch 2's curator task therefore edits `agent-sdk`, not `memory-curator`.
2. **§F's `14/27` vs `106/119` is fully root-caused.** They are the same field names at different scopes. `harness-reconciler.service.ts:622-639` sums `expected`/`found` across **all six** targets (claude, codex, copilot, cursor, antigravity, vscode); `plugin-activation.ts:365` narrows to `health.targets.find(t => t.target === 'claude')` and prints `claude.found / claude.expected` at `:368`. They cannot agree by construction. Same defect in the sibling propagate logger at `plugin-activation.ts:415-416`. Secondary: `found` itself means two different things — `harness-health.ts:69-71` (`plannedTargetHealth`: `found = plan.unchanged`) vs `:110-112` (`appliedTargetHealth`: `found = plan.unchanged + written`).
3. **§G's doubled `[RPC Verification] All 362 RPC methods correctly registered` has a second, independent cause.** It is not in `agent-sdk` at all: `vscode-core/src/messaging/rpc-verification.ts:113`, called from `rpc-handlers/src/lib/verify-and-report.ts:81`, and `assertRpcRegistration` (`rpc-verification.ts:153`) calls `verifyRpcRegistration` **again** at `:158`. A single `verifyAndReport` pass that reaches the assert path logs the line twice on its own, with or without adapter double-init. Fixing the adapter race alone will not silence it.
4. **§G's `initialize()` has no in-flight guard of any kind.** `sdk-agent-adapter.ts:269-395`; the only latch is the boolean `this.initialized`, assigned at `:333` — _after_ both `configureAuthentication` (`:278`) and `findExecutable()` (`:303`). The watcher re-entry at `:183-195` checks state (`:187-190`), not flight. That is why the auth half is de-duplicated (AuthManager guards itself) and CLI detection is not.

### Edge Cases to Handle

- [ ] Lane running on the **inherited/active** provider while that provider is exhausted → Task 2.3 (this is R1, and it is the captured scenario)
- [ ] A dynamic-provider proxy (`custom`, `local`) recording quota under a stable key → Task 2.1
- [ ] `retry-after` **absent** (every rate-limit line in the captured log is bare) → Task 2.1, default cooldown, Open Question 1
- [ ] Quota clears before the cooldown expires → Task 2.1 must clear the record on the next success, not only on expiry
- [ ] Curator's deliberate auth fallback walking past a quota stall → Task 2.6
- [ ] 8 KB prefix whose **first** record already exceeds the prefix (no `session_id` found at all) → Task 3.1 must keep the filename fallback at `:516`
- [ ] Genuinely corrupt JSONL (not just truncated) → Task 3.1 must not turn a real parse failure into silent success for every line
- [ ] `ENOENT` on a broken symlink vs. a file deleted mid-scan → Task 4.1 treats both as skip-and-count
- [ ] Two auth-file change events arriving inside one `initialize()` flight → Task 3.2
- [x] A host with zero `claude` target in `health.targets` → Task 5.2 must not print `0/0` as if it were a healthy pass. **Closed** — `formatClaudeSlice` renders `not-registered` / `undetected` / `0/0` as three distinct states. Not pinned by a spec; see follow-up R4

### Blockers Found

None. Batch 2 carries three open questions that must be answered _at the start of_ the
batch rather than before it — see the Open Questions block on Batch 2.

---

## Batch 1: Boot blocker — take cold-start catchup off the activation path (Defect A) ✅ COMPLETE

**Commit**: `a1c9f9335` — `fix(cron-scheduler): take cold-start catchup off the activation path`
**Verified**: lint PASS, `nx build ptah-electron` PASS, `nx test cron-scheduler` 38/38 PASS (4 suites).
Mutation-checked: the new spec was re-run against the reverted pre-fix source — 10 of its 12
cases fail there, including both load-bearing cases. The 2 that pass either way are the
`enabled: false` early-return cases, which never reach the replay call by construction.
**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: One line in one file. It is alone in its own batch on purpose — it restores a
usable window, which is the precondition for manually verifying every batch after it. Coupling
anything to it would delay that.
**Tasks**: 1 | **Dependencies**: None

### Task 1.1: Make cold-start catchup fire-and-forget, matching the resume path ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\cron-scheduler\src\lib\cron-scheduler.ts`
**Spec Reference**: `research-report.md` §A "Fix"
**Pattern to Follow**: `libs/backend/cron-scheduler/src/lib/catchup-coordinator.ts:62` — the
resume path already has the correct shape. Copy it; do not invent a new policy.

**Quality Requirements**:

- Replace the `await` at `cron-scheduler.ts:98` with `void … .catch(err => …)`.
- The existing `try/catch` at `:97-103` becomes dead — **remove it**, do not leave an empty
  `try` wrapping a synchronous call. Move the rejection handler onto the promise.
- Keep the log message distinguishable from the resume path's (`cold-start catchup failed`
  vs `catchup on resume failed`).
- Everything after `:98` — `armTimer` for each enabled job, `catchup.attach`, `started = true`,
  the `started` info log — must still run in the same order and now runs immediately.

**Validation Notes**:

- The ordering comment at `:81-86` says catchup runs BEFORE arming timers "so missed slots from
  the previous boot don't race the next-fire scheduling". Dropping the `await` breaks that
  stated ordering. **Update the comment to say what the code now does** and why the race is
  acceptable — the resume path has already accepted the same race since it shipped. Do not
  silently leave a comment that the code contradicts.
- Do NOT touch `wire-runtime.ts:373`. §A explicitly defers "should the remaining local I/O also
  move behind the window" as a separate judgement with its own risk. Out of scope here.

**Implementation Details**:

- Imports: none new.
- Key logic: `void this.catchup.replayMissed(options, () => DEFAULT_CATCHUP_POLICY).catch(…)`.

**Affected Files**:

- `libs/backend/cron-scheduler/src/lib/cron-scheduler.ts`

**Acceptance Criteria**:

- `nx serve ptah-electron` opens a window without waiting on any drain.
- `[Ptah Electron] Cron scheduler started` and `[Ptah Electron] Subsystems brought up` both
  appear in the log — both were absent in the captured run.
- `[IpcBridge] Cannot send to renderer: no window available` no longer fires for cron-driven
  broadcasts at boot.
- Overdue jobs still run — they run _after_ the window, not instead of it.
- A rejecting `replayMissed` logs and does not produce an unhandled rejection.

**What the reviewer should check**:

- The `catch` is attached to the promise, not left as a now-unreachable `try/catch`.
- `started = true` is still set, and `stop()` is still idempotent against the in-flight replay.
- No behavioural change to the resume path.

**Test coverage**: **senior-tester REQUIRED.** `libs/backend/cron-scheduler/src/lib/` has specs
for `job.store`, `run.store` and `power-monitor.interface` only — there is **no
`cron-scheduler.spec.ts` and no `catchup-coordinator.spec.ts`**. `start()` is entirely untested.
Needs a new spec proving `start()` resolves without waiting on a slow `replayMissed`, that
timers are armed regardless, and that a rejection is logged rather than thrown. No existing
spec breaks.

**Batch 1 Verification**:

- Build passes: `npx nx build cron-scheduler` and `npx nx build ptah-electron`
- `npx nx test cron-scheduler`
- code-logic-reviewer approved

---

## Batch 2: Provider quota gate (Defect B) ✅ COMPLETE — REVIEWED (APPROVED WITH FINDINGS)

**Commit**: `ca183174d` | **Review record**: `batch-2-implementation.md`

> **State as of 2026-08-22, post-review.** The implementing agent was interrupted by a
> session exit and then stopped, so it could not be resumed. Its work survived intact
> and was committed on the user's explicit instruction ("commit all of our changes,
> don't reset anything"). Team-leader then performed the missing MODE 2 review
> **post-hoc, from the commit** — `batch-2-implementation.md` is a reconstructed
> verification record, not a developer self-report.
>
> **Verdict: APPROVED WITH FINDINGS — 1 material (F1) + 3 minor.** Nothing blocking.
> (F2 was raised as material and has since been **resolved with no defect**.)
>
> **What the review confirmed:**
>
> - **R1 correct, in the non-obvious way.** `provider-auth-resolver.ts:134` runs
>   `assertNotCoolingDown(requested || activeProviderId)` with both early returns
>   below at `:136` / `:139`. The early-return predicates were rewritten to test
>   `requested` — this reads as diff noise but is load-bearing: without it, return #1
>   would be unreachable. Pinned by two discriminating specs.
> - **Spec integrity clean.** Exactly 4 removed lines commit-wide, all import
>   widenings. Zero assertions weakened. `curator-proxy-manager.spec.ts` +3 is a
>   compile-forced abstract stub. R6's compiled-body scan and the env-immutability
>   spec untouched.
> - **Counts recounted by team-leader** (item 4 below, closed): 46 `it(` blocks = 50
>   Jest cases (one `it.each` of 5 rows); `auth-providers` 33 / `skill-synthesis` 12 /
>   `agent-sdk` 5; ~37 discriminating; one new spec file.
> - **`maxAttempts` — EXEMPT IS CORRECT, UPHELD** (item 3 below, closed, now on the
>   record). The fail-open worry inverts: open ⇒ `retryAfterMs` returns 0 ⇒ no quota
>   failure is produced at all. Fail-closed is the real loop risk and is bounded three
>   ways — 6 h clamp, evict-on-read, in-process map. Worst case one free requeue per
>   15 min, the same exposure already accepted for `auth-unresolvable`.
>
> **Findings carried forward:**
>
> 1. **F1 (material, medium-high) — the curator stall destroys its own input.** Task
>    2.6's no-throw constraint made "stop" into `runQuery → ''` → `extract() → []`,
>    indistinguishable from "found nothing". `memory-trigger.service.ts:744-745` calls
>    `markProcessed(ids)` on resolve inspecting nothing; `drainForSession` filters
>    `processed_at IS NULL`; `episodes.reset` (`:696`) has already fired and a
>    resolving run advances the boot-scan watermark. A plan gap inherited faithfully —
>    needs a **decision** (stats discriminator vs. revisiting the no-throw
>    constraint), not a patch.
>    **No longer theoretical.** A real cold start
>    (`tmp/logs/coldstart-306.log`) shows the gate firing 15× with
>    `curatorProviderId: ""` — the empty-provider inherit path R1 exists to catch — in
>    a tight `JsonlReader findSessionsDirectory` → skip-pass loop at lines 1232–1260.
>    That is F1's predicted drain-and-discard, running _faster_ than before the gate.
>    48 quota/429 lines total; Codex genuinely exhausted.
> 2. **F2 — RESOLVED, no defect.** A clean re-run
>    (`nx test skill-synthesis --skip-nx-cache`) gave **1324 passed / 37 skipped /
>    1361 total, exit 0** — matching the commit message exactly. Team-leader's review
>    run had shown 1307 passed / 1344 total: **17 fewer in both**, which is precisely
>    `session-archaeologist.service.spec.ts` (17 tests) failing at module scope so its
>    cases never registered (1344 + 17 = 1361). Matched offset in both numbers rules
>    out a miscount and rules out a regression. That file is not among the 30 touched.
>    Transient module-load failure; the 1324 figure is accurate and citable.
> 3. Minor: hard-coded `OPENROUTER_PROVIDER_ID = 'openrouter'` unpinned; acceptance
>    criterion 4 (no template candidate persisted during cooldown) unproven;
>    `retry-after: 0` yields the 15-min default not 1 s — deliberate but undocumented.
>
> **Scope note:** Task 2.4 exceeds its spec — it introduced `isTransportLaneFailure`
> and applied it at both seams including `lane-runner.service.ts:527`, which no task
> listed and which is the change that actually makes quota rows requeue. Load-bearing
> and correct; **recorded, not faulted**.

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Six tasks spanning `auth-providers` → `skill-synthesis` → `agent-sdk`, each
depending on the previous one's type surface. This is the "cross-lib port" shape the CLI
delegation decision explicitly ruled out — it is reasoning-heavy and tightly coupled, not
file-disjoint boilerplate. Largest blast radius in the task.
**Tasks**: 6 | **Dependencies**: Batch 1 (for manual verification only — no code dependency)

### ✅ OPEN QUESTIONS — ANSWERED by the user, 2026-08-22

All three were surfaced at a checkpoint and decided before this batch was spawned. The
decisions are binding: the developer implements them as stated and the reviewer checks the code
matches. The original analysis is kept below each decision because it is the reasoning the
reviewer needs, not because the question is still open.

> **A1 — Cooldown: 15 minutes, as a module constant.**
> Deliberately shorter than the 30 min `LANE_AUTH_RETRY_MS`: quota refills on a clock, a
> misconfigured provider does not. Ships beside `LANE_AUTH_RETRY_MS` with a docblock of the same
> shape, stating that reasoning. **Not** a settings key in this batch — file a follow-up if it
> proves wrong in practice.
>
> **A2 — Curator: stop entirely while its resolved provider is cooling down.** Option (a).
> The existing `ProviderAuthError` fallback stays exactly as it is; only the quota case is new.
> Do not restructure `resolveCuratorAuth` beyond adding the quota branch.
>
> **A3 — User-facing signal: backend-observable half only; UI deferred to a follow-up task.**
> The reason token reaching `skill_synthesis_queue.reason` and the drain summary is the whole
> deliverable here. No response-shape change, no frontend work, no `frontend-developer` batch.

**Q1 — Default cooldown.** No `retry-after` header actually arrives on this path (every
rate-limit line in the captured log is bare, `research-report.md` §B "No `retry-after` header is
actually sent"). §B suggests 15 minutes as a starting point and says the value should be
settable. Decide: the constant's value, and whether it becomes a settings key now or a
module constant with a follow-up. Note the neighbouring precedents: `LANE_AUTH_RETRY_MS` is
30 min, `LANE_DEGRADED_RETRY_MS` is 30 min, and the timeout ladder is `2^attempt × 60s` capped
at 6 h. A quota cooldown shorter than `LANE_AUTH_RETRY_MS` is defensible (quota refills on a
clock; a misconfigured provider does not) but it should be an argued number, not a copied one.

**Q2 — Curator fallback.** `SdkInternalQueryCuratorLlm.resolveCuratorAuth`
(`agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:88-104`) catches
`ProviderAuthError` and **returns `undefined` to ride the active provider** — a deliberate,
documented divergence from lanes. A quota stall must not inherit that. Decide: does the curator
(a) stop entirely while its resolved provider is cooling down, or (b) keep the auth fallback but
refuse when the _fallback target_ is itself cooling down? Option (a) is simpler and matches the
lane contract's intent; option (b) preserves the documented divergence. Whichever is chosen, the
docblock at `:38-43` and `:95-101` must be updated to state it — that comment currently explains
one behaviour and would be describing two.

**Q3 — User-facing signal.** §B: "The gate stops the loop but leaves background learning
silently disabled." **Verified: no new RPC namespace is needed** — `skillSynthesis:` is already
in both `libs/shared/src/lib/types/rpc.types.ts` and `ALLOWED_METHOD_PREFIXES`
(`vscode-core/src/messaging/rpc-handler.ts`). But there is **no** existing wire representation of
a lane failure anywhere in `libs/shared`, so a signal means a response-shape change plus frontend
work — a different developer type from everything else in this batch.
**Recommendation: split it out.** Land the backend-observable half in this batch (the reason
token reaches `skill_synthesis_queue.reason` and the drain summary, which is already surfaced),
and file the UI as a follow-up task. If the orchestrator/user wants the UI in scope, Batch 2 gains
a `frontend-developer` batch after it rather than growing a frontend task inside it.

---

### Task 2.1: Record quota state at the proxy chokepoint ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts`
**Spec Reference**: `research-report.md` §B "Proposed gate", step 1
**Pattern to Follow**: the 429 branch already at `:545-568` — extend it, do not add a second one.

**Quality Requirements**:

- Introduce a quota store in `auth-providers` recording `{ providerId, until }`. It must be a DI
  singleton — the six proxy subclasses are separate instances and the resolver reads it from a
  third place.
- Record on 429 at `:545`. **Clear on the next success**, not only on expiry — a quota that
  refills early must not leave the gate closed for the full cooldown.
- Honour `retry-after` when present (`:546`); fall back to the Q1 default when absent.
- **Do NOT change the 429 response.** `context.md` scope: "Any change to the translation proxy's
  429 _response_ — it is already correct" is explicitly out of scope. The response bytes, status,
  headers and message stay byte-identical. This task adds a side-effect only.

**Validation Notes**:

- **R2 (HIGH).** `TranslationProxyConfig` (`:50-59`) has `name`, `modelPrefix`,
  `completionsPath`, `responsesPath` — **no registry provider id**. `name` is a display string
  (`'Codex'`), the store must key on the registry id (`openai-codex`) because that is what
  `ProviderAuthResolver` resolves. Six subclasses to thread it through:
  `codex-translation-proxy.ts:27`, `copilot-translation-proxy.ts:24`,
  `custom-openai-translation-proxy.ts:89`, `local-model-translation-proxy.ts:37`,
  `openrouter-translation-proxy.ts:33`, `sakana-translation-proxy.ts:34`.
- Two of those serve **dynamic** provider ids — `CustomOpenAiTranslationProxy` and
  `LocalModelTranslationProxy`. A constructor literal will not work for them. Prefer an abstract
  accessor (`protected abstract getProviderId(): string`) resolved at request time over a config
  field, so the dynamic cases have somewhere correct to answer from.
- No provider-id literal may be introduced into `translation-proxy-base.ts` itself. The base asks
  the subclass; it never names one.

**Affected Files**:

- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts`
- new: a quota store module under `libs/backend/auth-providers/src/lib/auth/`
- `libs/backend/auth-providers/src/lib/di/{tokens,register}.ts`
- the six subclasses listed above
- `libs/backend/auth-providers/src/index.ts` (only if the error type must be exported)

---

### Task 2.2: `ProviderQuotaError`, matched by name ⏸️ PENDING

**File**: new, alongside `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\provider-auth.error.ts`
**Dependencies**: Task 2.1
**Pattern to Follow**: `provider-auth.error.ts:1-20` **exactly**. Read its docblock first — it
states why `name` and the class name must be changed together, and that constraint applies
identically here.

**Quality Requirements**:

- `class ProviderQuotaError extends Error`, `this.name = 'ProviderQuotaError'`,
  `Object.setPrototypeOf(this, ProviderQuotaError.prototype)`, carrying `providerId` and
  `retryAfterMs`.
- A docblock stating that consumers discriminate on `name`, never `instanceof`, and naming the
  two consuming libs that mirror the constant.

**Validation Notes**:

- The mirror constant must be declared in **both** consumers, as `PROVIDER_AUTH_ERROR_NAME`
  already is: `skill-synthesis/src/lib/lanes/lane-auth-resolver.port.ts:59` and
  `agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:43`. `skill-synthesis`
  keeps **zero direct SDK imports** and cannot import `auth-providers` — that is why the constant
  is duplicated rather than shared, and duplicating it again is correct here, not a smell.

**Affected Files**:

- new `libs/backend/auth-providers/src/lib/auth/provider-quota.error.ts`
- `libs/backend/auth-providers/src/lib/auth/index.ts`

---

### Task 2.3: Throw `ProviderQuotaError` from the resolver — ABOVE the early returns ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\provider-auth-resolver.ts`
**Dependencies**: Tasks 2.1, 2.2
**Spec Reference**: `research-report.md` §B "Proposed gate", step 2

**Quality Requirements**:

- `resolve()` (`:103-139`) throws `ProviderQuotaError` when the **resolved** provider is cooling
  down.
- Resolve the id as `requestedProviderId.trim() || this.providerModels.resolveActiveProviderId()`
  and evaluate the quota check **before** the two early `return null` branches.

**Validation Notes**:

- **R1 (HIGH) — this is the single most important line in Batch 2.** `resolve()` returns `null`
  at `:108-110` when the id is `''` and at `:111-113` when the requested id IS the active
  provider. Every lane defaults to `provider: ''` (= inherit, `lane.types.ts:49-55`) and in the
  captured run the exhausted provider **was** the active one. A quota check placed after those
  returns is dead code on exactly the path that produced this task. Put it above both.
- Keying on the _resolved_ id is what `lane.types.ts:15-27` permits. Writing a branch that names
  a provider is what it forbids. There is a mechanical difference and the spec in R6 enforces it.
- `scope` defaults to `'mainAgent'` at `:105` for the pre-existing curator call site. Do not
  change that default while adding the check — Task 2.6 handles the curator.

**Affected Files**:

- `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts`

---

### Task 2.4: `'quota-exhausted'` failure kind + drain transport classification ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\lanes\lane.types.ts`
**Dependencies**: Task 2.2 (for the mirror constant only — no import)
**Spec Reference**: `research-report.md` §B "Proposed gate", step 3

**Quality Requirements**:

- Add `'quota-exhausted'` to `SkillLaneFailureKind` (`lane.types.ts:116-120`) with a docblock
  explaining why it is not `timeout`: the backoff comes from the provider's cooldown, not the
  `2^attempt × 60s` transport ladder.
- **Widen `SkillDrainService.applyLaneFailure`** at `skill-drain.service.ts:886` to treat
  `'quota-exhausted'` as TRANSPORT (requeue), not CAPABILITY (`markUnscored`).
- Update the family documentation at `skill-drain.service.ts:855-878` and `:110`, `:122`, `:204`,
  `:860`, `:870` — all six currently enumerate the two transport kinds by name.

**Validation Notes**:

- **R3 (HIGH).** `:886` reads `if (failure.kind !== 'timeout' && failure.kind !== 'auth-unresolvable')`.
  A new union member falls through that negation into `markUnscored` — it compiles, type-checks,
  and lands a quota stall as a _judge verdict_ on the Activity surface. The header at `:862-865`
  says exactly why that is wrong: `unscored` means "we ran and we do not know". Nothing ran.
- **Does `'quota-exhausted'` carry the `maxAttempts` ceiling?** `:906` applies it to `timeout`
  ONLY, and the header at `:870-873` argues `auth-unresolvable` is exempt because it waits on a
  **user-fixable** fault and `markFailed` is terminal. Quota is closer to `auth-unresolvable`:
  it clears on a clock without the user doing anything, and a terminal mark would land before the
  refill. **Recommendation: exempt, same as `auth-unresolvable`.** State the decision explicitly
  in the implementation report either way.
- Add the quota cooldown constant beside `LANE_AUTH_RETRY_MS` (`lane.types.ts:143`) with a
  docblock of the same shape.

**Affected Files**:

- `libs/backend/skill-synthesis/src/lib/lanes/lane.types.ts`
- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`
- `libs/backend/skill-synthesis/src/index.ts` (barrel, if the new constant is exported)

---

### Task 2.5: Convert the quota throw into a lane stall ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\lanes\lane-resolver.service.ts`
**Dependencies**: Tasks 2.3, 2.4
**Pattern to Follow**: the `PROVIDER_AUTH_ERROR_NAME` branch in the same `catch` at
`lane-resolver.service.ts:182-205`. Add a sibling branch; do not restructure the catch.

**Quality Requirements**:

- Add `PROVIDER_QUOTA_ERROR_NAME` to `lane-auth-resolver.port.ts` beside
  `PROVIDER_AUTH_ERROR_NAME` (`:59`), with the same "matched by name, kept in sync" docblock.
- In the catch at `:182`: a `ProviderQuotaError` yields
  `{ ok: false, failure: { kind: 'quota-exhausted', reason, retryAfterMs } }` where
  `retryAfterMs` comes **from the error**, not from a constant — the error carries the honoured
  `retry-after` when the header was present.
- The rethrow guard at `:187-192` must still rethrow everything that is neither error name. That
  guard is load-bearing: "the drain's own catch is where a genuine defect belongs".
- `reason` is written verbatim to `skill_synthesis_queue.reason` and is user-facing. Keep it
  SHORT and honest — it must not say "timed out".

**Validation Notes**:

- **R6.** `lane-resolver.providers.spec.ts:221` scans the compiled body of
  `LaneResolverService.resolve` via `Function.prototype.toString` for registry provider ids. The
  new branch must contain none. Do not weaken the spec to pass it.
- The existing warn at `:193-196` logs `providerId: config.provider` — which is `''` for an
  inheriting lane. Consider logging the resolved id instead so the log is diagnosable, but take
  it from the error's `providerId`, not from a new lookup.
- **`LaneAuthOverride.env` must not be touched on this path.** No serialize, no
  `structuredClone`, no Zod parse, no truthiness filter (`lane.types.ts:86-98`). The quota path
  returns before an override exists, so this should be free — the reviewer confirms it stayed free.

**Affected Files**:

- `libs/backend/skill-synthesis/src/lib/lanes/lane-auth-resolver.port.ts`
- `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts`

---

### Task 2.6: Apply the gate to the memory curator directly ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\curator-llm-adapter\sdk-internal-query.curator-llm.ts`
**Dependencies**: Tasks 2.2, 2.3, and **Open Question Q2 answered**
**Spec Reference**: `research-report.md` §B, third bullet of "Three things to settle"

**Quality Requirements**:

- Implement the Q2 decision in `resolveCuratorAuth` (`:88-104`).
- Add `PROVIDER_QUOTA_ERROR_NAME` beside the existing `PROVIDER_AUTH_ERROR_NAME` at `:43`, same
  docblock rationale.
- Update the docblocks at `:38-43` and the warn at `:95-101` to describe both behaviours. That
  comment currently explains one, and after this task it governs two.

**Validation Notes**:

- **This file is in `agent-sdk`, not `memory-curator`** — the report's citation is wrong (see
  Correction 1). `memory-curator`'s CLAUDE.md is explicit that LLM calls do not live there.
- The auth fallback here is a **deliberate, documented** divergence from lanes. Do not "fix" it
  into a stall as a side effect of this task — only the _quota_ case changes, and only in the way
  Q2 decided.
- `ICuratorLLM`'s contract must not grow a new throw. Whatever Q2 decides, the curator degrades;
  it does not propagate a new failure mode to `MemoryCuratorService`.

**Affected Files**:

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`

---

**Batch 2 Acceptance Criteria**:

- A 429 from any OAuth-proxy provider records a cooldown against the **registry** provider id.
- A lane whose resolved provider is cooling down returns `{ok:false, kind:'quota-exhausted'}`
  and the queue row goes back to `queued` behind the cooldown — **never** `unscored`, never a
  fallback to the active provider, never `markFailed` (subject to the Task 2.4 decision).
- **A lane with `provider: ''` on an exhausted active provider is gated.** This is the captured
  scenario and it is the criterion most likely to be missed.
- No template-derived candidate is persisted while the provider is cooling down — the
  `SKILL.md materialized` + `candidate registered` pair from §B's log evidence must not appear.
- The first row pays the discovery cost; subsequent rows are gated before dispatch and cost zero
  upstream requests.
- The curator behaves per the Q2 decision, stated in the implementation report.
- No provider-id literal anywhere in a lane code path.
- 429 response bytes unchanged.

**What the reviewer should check**:

1. The quota check in `provider-auth-resolver.ts` is **above** `:108-113`. If it is below, the
   whole batch is a no-op for the reported scenario — check this first.
2. `skill-drain.service.ts:886` includes `'quota-exhausted'` in the transport family.
3. No `structuredClone` / `JSON.parse(JSON.stringify(...))` / Zod parse / truthiness filter
   applied to any `LaneAuthOverride.env` on any touched path.
4. `ProviderQuotaError.name` and the two (or three) mirrored `PROVIDER_QUOTA_ERROR_NAME`
   constants agree exactly.
5. `skill-synthesis` still has zero imports from `agent-sdk` or `auth-providers`.
6. The stale docblocks at `skill-drain.service.ts:855-878` and
   `sdk-internal-query.curator-llm.ts:38-43` were updated, not left contradicting the code.
7. Three open questions answered explicitly in the implementation report.

**Test coverage**:

- **senior-tester REQUIRED**, and this is the batch that most needs it.
- **Would break if not extended**: `skill-drain.failures.spec.ts` (transport vs capability
  mapping — `:116-118` builds an `auth-unresolvable` failure and asserts `notBefore`; needs a
  `quota-exhausted` sibling). `lane-resolver.service.spec.ts:231-254` (the `auth-unresolvable`
  stall block — needs a quota twin). `lane-runner.service.spec.ts:32-56, 398-427`.
- **Runs against the new code and will catch a violation**:
  `lane-resolver.providers.spec.ts:221` (compiled-body provider-literal scan) and
  `lane-runner.env-immutability.spec.ts`. Neither needs changing — they need to keep passing.
- **Unaffected, do not touch**: `skill-drain.gates.spec.ts` (weekly-tier stage registration) and
  `skill-queue.store.reopen-payload.spec.ts` (payload merge / cross-host claim). Named here
  because the orchestration brief asked which are implicated: these two are not.
- **Needs new specs**: the quota store (record / clear-on-success / expiry / dynamic provider id);
  `translation-proxy-base.spec.ts` extended to prove the 429 response is byte-identical while the
  side-effect fires; `provider-auth-resolver.spec.ts` extended with the R1 inherit case;
  `sdk-internal-query.curator-llm.spec.ts` extended for the Q2 behaviour.

**Batch 2 Verification**:

- `npx nx test auth-providers skill-synthesis agent-sdk`
- `npx nx build auth-providers skill-synthesis agent-sdk`
- code-logic-reviewer approved

---

## Batch 3: `agent-sdk` — silent import failure + boot double-init (Defects C, G) ✅ COMPLETE

**Prerequisite commit**: `8358528ff` — `fix(workspace-intelligence): declare typescript as a
runtime dependency`. Batch 3's first commit attempt was blocked by the pre-commit hook, which
runs `nx affected --target=lint --max-warnings=-1`. Touching `agent-sdk`, `rpc-handlers` and
`vscode-core` widened the affected set from Batch 1's narrow cron-scheduler slice to 29
projects, pulling in `@ptah-extension/workspace-intelligence`, which failed
`@nx/dependency-checks`: `typescript` sat in its `devDependencies` while
`TypeScriptDiagnosticsProvider` (commit `4df73f4a6`, already on `main`) imports it at runtime.
Proven pre-existing and unrelated — with every Batch 3 change stashed and the tree at HEAD,
`nx lint workspace-intelligence` failed identically, and the lib was byte-identical to `main`.
Batch 1 committed cleanly only because its affected set never reached that project. Fixed as
its own commit rather than bypassed; `--no-verify` was never used. The lib is `"private": true`
and `typescript` was already declared in the generated `dist/apps/ptah-electron/package.json`,
so the move changes nothing about what ships — `loadTypescript()` is optional by construction
(try/catch returning `undefined`), but optional-at-runtime is still runtime, so the rule was
right.

**Verified**: `nx run-many -t lint -p agent-sdk,rpc-handlers,vscode-core` PASS (0 errors, 19
warnings, all pre-existing kinds). `nx run-many -t build -p agent-sdk,rpc-handlers` PASS.
`nx run-many -t test -p agent-sdk,rpc-handlers,vscode-core` PASS — agent-sdk 1038/74 suites,
rpc-handlers 2407/87 suites, vscode-core 365/22 suites. No pre-existing spec was edited
(`git diff -U0 -- '*.spec.ts'` contains zero removed lines).
Mutation-checked: 6 of the 12 new cases fail against reverted pre-fix source. The other 6 are
regression guards on constraints this batch promised to PRESERVE (sidecar rule, `reset()`
forcing re-init, guard-not-a-memo, guard-cleared-in-`finally`, assertion-not-weakened,
assert-skipped-outside-dev) — legitimate, not padding.

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Grouped by lib affinity — C and G are both in `agent-sdk` and both self-contained.
Reviewing them together means one pass over one lib's boot and import paths rather than two
context switches. Task 3.3 is in `vscode-core`/`rpc-handlers` but is only discoverable from G's
log evidence, so it belongs with G.
**Tasks**: 3 | **Dependencies**: None (no ordering constraint against Batches 2, 4, 5)

### Task 3.1: Stop discarding every session file on a truncated prefix ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-importer.service.ts`
**Spec Reference**: `research-report.md` §C

**Quality Requirements**:

- In `extractMetadata` (`:471-537`): the last element of `content.split('\n')` is a partial
  record whenever the file is longer than the 8192-byte prefix. Either drop it before the loop
  at `:491` or wrap the `JSON.parse` at `:492` and `continue`.
- **Keep the filename fallback at `:516`.** §C notes modern CLI JSONL first records routinely
  exceed 8 KB, so `session_id` may not be in the prefix at all — that fallback is now the primary
  path for large files, not a corner case.
- Keep the `sawSessionContent` sidecar guard at `:489`/`:513` intact. It exists to suppress
  phantom `Session <date>` entries from `ai-title` files.

**Validation Notes**:

- Do not turn a **genuinely corrupt** file into a silent success. If every line fails to parse,
  the result should still be `null` — the fix is "tolerate the known-truncated tail", not
  "tolerate everything".
- The method-level `catch` at `:530` logs at `debug`. With the parse no longer throwing per-line,
  consider whether a file that yields nothing deserves a higher level — 11-of-11 silent failures
  is what made this defect invisible for as long as it was. `Import complete: {"imported":0}`
  should not be the only visible signal.

**Affected Files**:

- `libs/backend/agent-sdk/src/lib/session-importer.service.ts`

**Test coverage**: extend `session-importer.service.spec.ts` (exists). Cases: a file whose 8 KB
prefix cuts mid-token (the reported case); a file whose first record exceeds 8 KB entirely
(filename fallback); a genuinely corrupt file (still `null`); an `ai-title` sidecar (still
skipped). No existing spec should break.

---

### Task 3.2: In-flight de-duplication guard on `SdkAgentAdapter.initialize()` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: `research-report.md` §G
**Pattern to Follow**: `auth-providers/src/lib/auth/auth-manager.ts:115-129` — hold the promise,
return it to the second caller, clear it in a `finally`. Second in-repo precedent:
`workspace-intelligence/src/ast/tree-sitter-parser.service.ts:94-106`.

**Quality Requirements**:

- Guard at the top of `initialize()` (`:269`), before the `try`. Hold the in-flight promise;
  a concurrent caller awaits it rather than starting a second pass.
- Clear the held promise in a `finally` so a failed init does not permanently latch.

**Validation Notes**:

- **There is no guard today of any kind.** The only latch is the boolean `this.initialized`,
  assigned at `:333` — after `configureAuthentication` (`:278`) and after `findExecutable()`
  (`:303`). The entire expensive window is unguarded.
- The watcher handler at `:183-195` checks _state_ (`:187-190`: `if (this.initialized && health.status !== 'error') return;`),
  not _flight_. Leave that check; it answers a different question. The new guard goes in
  `initialize()` so it covers **all four** re-entry points: `onAuthFileChanged` (`:194`),
  `onConfigChanged` (`:181`), `reset()` (`:459`), and host activation
  (`apps/ptah-electron/src/activation/bootstrap.ts:302`).
- The trigger is real and reproducible: the boot OAuth token refresh writes `~/.codex/auth.json`
  while the first init is in flight, so the adapter races itself on **every** cold start with an
  expired token. `reset()` must still force a genuine re-init — do not let the guard swallow it.

**Affected Files**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

---

### Task 3.3: `verifyRpcRegistration` logs its success line twice per pass ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\verify-and-report.ts`
**Spec Reference**: `research-report.md` §G (the `362 RPC methods` observation)

**Quality Requirements**:

- `verify-and-report.ts:81` calls `verifyRpcRegistration`; `assertRpcRegistration`
  (`vscode-core/src/messaging/rpc-verification.ts:153`) calls it **again** at `:158`. One
  `verifyAndReport` pass that reaches the assert path therefore logs
  `[RPC Verification] All N RPC methods correctly registered` (`rpc-verification.ts:113`) twice
  on its own.
- Pass the already-computed result into the assert, or make the assert not re-log. Do not
  delete the assertion.

**Validation Notes**:

- **This is an independent second cause.** Fixing Task 3.2 alone will not silence the doubled
  line — verify both are addressed before claiming §G closed.
- The verification is a real guard against the RPC dual-registration rule. Changing _what_ it
  checks is out of scope; only the double log and double computation change.

**Affected Files**:

- `libs/backend/rpc-handlers/src/lib/verify-and-report.ts`
- `libs/backend/vscode-core/src/messaging/rpc-verification.ts` (only if the assert's signature
  must accept a precomputed result)

---

**Batch 3 Acceptance Criteria**:

- ⏳ **PENDING MANUAL VERIFICATION** — Session import over a real `~/.claude/projects/` directory
  reports a non-zero `imported` count. Proven at spec level (including the exact reported shape:
  truncated tail plus an unreachable `session_id`); not run against a real directory.
- ⏳ **PENDING MANUAL VERIFICATION** — `Initializing SDK adapter...` and `Detecting Claude CLI
installation...` each appear **once** per cold start, including with an expired Codex token.
  Spec proves one pass and one of each line under a held `configureAuthentication`; it does not
  reproduce the real trigger (boot OAuth refresh writing `~/.codex/auth.json` mid-flight).
- ⏳ **PENDING MANUAL VERIFICATION** — `[RPC Verification] All N RPC methods correctly registered`
  appears once. Proven at helper level against the real `RPC_METHOD_NAMES` registry; not observed
  in a boot log.
- ✅ `reset()` still forces a real re-initialisation — covered in both the idle and the in-flight
  case.

All three pending criteria need one `nx serve ptah-electron` cold start; all three lines are in
the first few hundred lines of output. Deliberately not attempted during verification.

### Residual follow-ups from Batch 3 review — FOLLOW-UP, NOT BLOCKING

Found during team-leader verification, accepted at commit. None invalidates the fix; all three
are recorded so they are not lost.

**F3-1 — phantom session from a short read with no complete records. Severity: LOW.**
`extractMetadata`'s sidecar guard is now `parsedRecords > 0 && !sawSessionContent`, so a file
yielding **zero complete records on a SHORT read** (whitespace/newline-only, under 8 KB) falls
through to the filename fallback and can produce exactly the phantom `Session <date>` entry the
guard exists to prevent — the pre-fix `!sawSessionContent` suppressed it. `ai-title` sidecars are
**not** affected: tens of bytes, always read whole, always `parsedRecords > 0`, still `null`. The
corrupt-file branch above does not shadow the guard — `lines.length > 0 && parsedRecords === 0`
and `parsedRecords > 0` are mutually exclusive — so the only new fall-through is
`lines.length === 0`. Suggested fix: gate the fall-through on
`bytesRead >= METADATA_PREFIX_BYTES`. A short read means the whole file was seen and nothing was
found — that is evidence of absence, not absence of evidence.

**F3-2 — `initInFlight` clearing is order-dependent. Severity: LOW (currently correct).**
`reset()`'s in-flight drain is safe, and safe by specification rather than by luck: the first
caller's `await` reaction is registered on the promise before `reset()`'s `.catch` reaction, and
`initialize()` has no interleaving point between `this.initInFlight = this.doInitialize()` and
the `await`, so promise-reaction FIFO ordering guarantees the caller's `finally` runs before
`reset()`'s continuation. Confirmed empirically with a standalone repro. The batch's own
`reset()` spec does **not** prove this — it only asserts two passes ran, which holds either way.
Suggested hardening, one line, removes the reasoning entirely: capture the promise and clear only
if unchanged — `finally { if (this.initInFlight === p) this.initInFlight = null; }`.

**F3-3 — two concurrent `reset()` calls can be answered by the guard. Severity: LOW (not a
regression).** Both resets drain the same pass; the first then `dispose()`s and `initialize()`s,
setting a fresh `initInFlight`. The second resumes, `dispose()`s state the first pass is already
rebuilding, then hits the guard and is handed the first reset's promise instead of running its
own pass — the one thing `reset()` is supposed to be immune to. Not introduced here (pre-fix
concurrent resets interleaved their dispose/init too), but now unguarded in a new way. Wants a
`reset()`-level mutex if it is ever worth closing.

**What the reviewer should check**:

- The truncation fix does not swallow genuine corruption.
- The init guard is cleared on the failure path (`finally`, not `then`).
- `this.initialized` semantics unchanged — the guard is additive.
- No behavioural change to what `verifyRpcRegistration` actually verifies.

**Test coverage**: **senior-tester recommended.** `session-importer.service.spec.ts` exists and
needs extending (see 3.1). `sdk-agent-adapter` needs a new spec for concurrent `initialize()`
calls resolving to one pass — mirror the shape of `auth-manager.spec.ts`, which already covers
the equivalent case for `configureAuthentication`. No existing spec is expected to break.

---

## Batch 4: Activation-time subsystem failures (Defects D, E) ✅ COMPLETE

**Commit**: see `fix(workspace-intelligence,task-specs): make activation-time subsystem failures
local` on `ak/boot-blocker-quota-gate`.

**Acceptance-criterion ruling (team-leader, MODE 2).** One criterion below is knowingly NOT met
literally: `[WARN] [task-specs] index rebuild write failed: Persistence is offline` still appears
ONCE on a clean Electron/CLI boot. The defect's consequence — the index being lost for the whole
session — is closed; the log line is not. Ruling and reasoning:

1. **The developer's objection is sound for the fix they were asked to weigh, and I upheld it.**
   Deferring the whole first warm-up to `onDidOpen` would cost `.ptah/specs/README.md` on any host
   where `openAndMigrate` genuinely fails (ABI mismatch / missing native binary — both documented
   real modes in `persistence-sqlite/CLAUDE.md`). The event never fires there, so the contract doc
   never lands. That is a permanent data-plane loss traded for a cosmetic log line. Bad trade.
2. **Separating `ensureSpecsReadme` from the index rebuild is NOT small — I checked.**
   `ensureSpecsReadme` early-returns on `state.specsDirExists` (`task-index.service.ts:232`), and
   that flag is written by `rebuild` (`:518-519`). So the README cannot run without the scan, and
   deferring "only the index rebuild" saves nothing, because the scan — not the
   `replaceWorkspace` write — is the cost. The separation would mean splitting `rebuild` into
   scan/write phases and caching scan results across the open, or re-scanning. A real
   restructure, not a small change. The hypothesis is rejected on evidence.
3. **But the developer's own follow-up proposal defeats their own objection, and IS small.** It is
   therefore promoted from "recorded follow-up" to **Task 4.4 below**, and the criterion is
   DEFERRED, not waived.

### Task 4.4: Silence the predictable offline write via `ITaskIndexStore.isReady()` ✅ COMPLETE

**Commit**: `44c29592c` — `fix(task-specs): skip the predictably-offline index write instead of warning`
**Closes**: the one Batch 4 acceptance criterion left unmet. **Batch 4 is now fully met** —
`[WARN] [task-specs] index rebuild write failed: Persistence is offline` no longer fires on a
clean Electron/CLI boot, and it is replaced by one `debug` line plus the real `onDidOpen` rebuild.
**Size**: 3 source files (39 net lines, mostly comments) + 2 spec files, 11 new cases. As estimated.

**Verified (team-leader, MODE 2)**:

- `nx run-many -t lint -p task-specs,persistence-sqlite,harness-sync` PASS. The one warning
  (`'MockFileSystemProvider' is defined but never used`) is in `task-writer.create-race.spec.ts`,
  a file this task does not touch and `git status` confirms unmodified. Pre-existing.
- `nx run-many -t build -p ptah-electron,ptah-extension-vscode` PASS.
- Tests (orchestrator): `task-specs` 440 passed, up from 429 — matching 11 new cases exactly.
- **No existing spec assertion edited.** `git diff -U0 -- '*.spec.ts'` has exactly one removed
  line and it is an `import` widened to also pull in `type ITaskIndexStore`.

**The "no WARN on a clean boot" argument is a proof, and the proof holds — checked term by term:**

1. `Persistence is offline` has exactly one throwing producer: `SqliteConnectionService`'s `db`
   getter (`sqlite-connection.service.ts:347-355`), which throws when
   `!this.database || !this.database.open`. The only other `buildUnavailableMessage()` caller
   (`:425`) is the vec-extension diagnostic and returns an object; it does not throw and is not on
   this path.
2. `isOpen` (`:434-436`) is `Boolean(this.database?.open)` — the exact negation of that same
   two-term predicate across all three states (no database / closed / open). So
   `isReady() === true` ⟺ the `db` getter does not throw.
3. `SqliteTaskIndexStore.replaceWorkspace` reaches `this.db` on its **first** statement
   (`const del = this.db.prepare(...)`) and is fully synchronous through `txn()`.
4. **No intervening code can await.** In `rebuild` the guard and the call are literally adjacent —
   `if (!this.store.isReady()) { … } else { try { this.store.replaceWorkspace(…) } … }` — with no
   statement, no `await` and no microtask boundary between them. `isReady(): boolean` is
   synchronous by its own type signature, so no implementation can introduce one. The
   check-then-act window is closed by construction, not by timing luck.

**The warn channel survives.** The `try`/`catch` is kept verbatim around `replaceWorkspace` in the
ready branch and still WARNs. Reaching it now means a store that reported READY failed anyway —
`SQLITE_FULL`, a corrupt page, a connection closed by a later reset — which is the unpredicted
class the channel exists for. Pinned by the spec case
`still WARNs when a store that reported READY fails the write anyway`.

**The `ensureStarted` latch is untouched.** It now sits at `task-index.service.ts:173-186`
(`if (!indexWritten) state.started = false;`) and is byte-identical — `git diff` shows no change
in that range. `indexWritten: false` from the skip branch un-latches it exactly as the failure
branch did, which is what makes the `onDidOpen` re-warm do real work.

**Mutation numbers — the framing is honest, and the framing is the point.** 3 of 7 service cases
fail against the reverted guard; the other 4 are named in the report as deliberate regression
guards on properties 4.4 promised to PRESERVE (README still lands, `specsDirExists` still set from
the scan, ready path unchanged, warn channel survives), and their titles confirm it. A guard that
only worked in one direction would be worthless for this fix, so those 4 passing both ways is
correct rather than padding. The 4 store cases genuinely **cannot compile** against the pre-4.4
tree — `isReady` does not exist on `ITaskIndexStore` there — so they were checked against an
always-true implementation instead (2 of 4 fail). Declining to invent a number for an
uncompilable comparison is the right call and is stated as such rather than buried.

**Report**: `task-4-4-implementation.md`.

---

**Batch 4 is now ✅ COMPLETE with all acceptance criteria met.** The criterion deferred at the
Batch 4 review is closed by this task, not waived.

- `SqliteTaskIndexStore` already holds `connection` (`task-index.store.ts:231-235`), so
  `isReady(): boolean { return this.connection.isOpen; }` is a one-liner.
  `InMemoryTaskIndexStore.isReady()` returns `true`.
- In `rebuild` (`task-index.service.ts:499-517`), skip the write when `!this.store.isReady()`:
  set `indexWritten = false` and log at DEBUG, not WARN. **Keep the `try`/`catch`** — an
  unexpected failure on a store that claimed readiness must still WARN. The guard removes only
  the _predicted_ failure.
- Net effect: no WARN on a clean boot, README still lands on the first warm-up (the scan is
  untouched), the `ensureStarted` un-latch at `:186` still fires, and the `onDidOpen` re-warm
  still does the real rebuild. No trade-off against the README at all.
- `task-index.service.ts:504-513` carries a comment pointing here; update it when this lands.

---

**Tasks 4.1–4.3 as originally specified — all ✅ COMPLETE and committed in `fd23a1108`.**
(Task 4.4 above is new, added by this review; it is the only Batch 4 work still open.)

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Different libs, one shared shape — a background subsystem that fails at
activation and is caught as non-fatal, so the app runs permanently degraded with no signal.
Both fixes are "make the failure local instead of total". Grouped by size and by review shape
rather than by lib: three one-file changes reviewed as one resilience pass.
**Tasks**: 3 | **Dependencies**: None

### Task 4.1: Per-entry `ENOENT` must not abort the whole workspace index ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-indexer.service.ts`
**Spec Reference**: `research-report.md` §D

**Quality Requirements**:

- The unguarded `await this.fileSystemService.stat(filePath)` at `:252`, inside the `for` loop at
  `:232-274`, terminates the generator for the entire workspace on one bad entry.
- Skip and **count** the entry; do not propagate. A broken symlink or a file deleted between
  `discoverFiles` and the `stat` is expected, not exceptional.
- Surface the skipped count — a silently-skipped 40% of a workspace is the same class of defect
  as the one being fixed.

**Validation Notes**:

- The reported entry was `D:/projects/property-hub/.claude/skills/.../index-template.html` —
  inside a `.claude/skills/` tree, i.e. plausibly a harness artifact that moved mid-scan. Both
  the broken-link and the deleted-mid-scan case must be covered.
- The `estimateTokens` read at `:259-264` already has exactly this shape (`try`/`continue`).
  Follow it.
- `FileSystemError` (`services/file-system.service.ts:74`) wraps the cause — narrow on the
  wrapped `ENOENT`, not on the message string.

**Affected Files**:

- `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`

**Test coverage**: extend `workspace-indexer.service.spec.ts` (exists, has an
`indexWorkspaceStream` describe at `:357`). Cases: one unstatable entry among many yields all the
others; a fully unstatable workspace yields nothing without throwing; the skip is counted.
`workspace-file-index.service.spec.ts` also exercises the stream and should keep passing.

---

### Task 4.2: Defer the `task-specs` index rebuild until SQLite is open (Electron) ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts`
**Spec Reference**: `research-report.md` §E

**Quality Requirements**:

- `startTaskSpecsIndex(container, logger)` at `phase-2-libraries.ts:332` dispatches the rebuild.
  SQLite opens far later — `wire-runtime.ts:373` → `:145` (`bootThothRuntime`) →
  `boot-thoth-runtime.ts:76` (`openAndMigrate`). 464 log lines separate them.
- Either move the warm-up call after `openAndMigrate`, or have it subscribe to connection-open.
  §E permits either; choose one and state why.

**Validation Notes**:

- **R4 — the report implies `wire-runtime.ts` is the fix site. It is not.** `wire-runtime.ts`
  contains no task-specs reference at all; its only `persistence-sqlite` mentions are the import
  at `:28` and `PERSISTENCE_TOKENS.EMBEDDER` at `:428`. A reorder confined to `wire-runtime.ts`
  cannot close this.
- The failing write is `this.store.replaceWorkspace(...)` at
  `task-specs/src/lib/task-index.service.ts:496`, caught and warned at `:503`. The comment at
  `:499-502` already names the cause — leave it, or update it to say the ordering is now fixed.
- **A recovery path already exists**: `ensureStarted` un-latches `state.started = false` at
  `task-index.service.ts:181` when `indexWritten` is false, so a later call retries. Do not
  remove that as "now redundant" — it is the safety net for the watcher path (`:435` → `:466` →
  `:472`) and for any host where the ordering is still wrong.
- `startTaskSpecsIndex` (`task-specs/src/lib/di/start-index.ts:46`, calling `ensureStarted` at
  `:73`) is deliberately **not awaited**. Keep it that way — Batch 1 exists because background
  work was awaited on the boot path. Do not fix an ordering bug by introducing an await.

**Affected Files**:

- `apps/ptah-electron/src/di/phase-2-libraries.ts`
- possibly `libs/backend/task-specs/src/lib/di/start-index.ts` (if the subscribe-to-open shape is
  chosen)

---

### Task 4.3: Same ordering in the VS Code and CLI hosts ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts`
**Dependencies**: Task 4.2

**Quality Requirements**:

- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:83` and
  `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:130` have the identical
  shape.
- **First verify each host actually has the defect** — the SQLite open point differs per host,
  and it is possible one or both already order correctly. Report what you found before changing.
- Apply the same remedy chosen in 4.2 to whichever hosts need it. Do not apply three different
  remedies to three hosts.

**Validation Notes**:

- If the subscribe-to-connection-open shape is chosen in 4.2, this task may reduce to zero
  changes — the lib-side fix covers all hosts at once. That is the better outcome; say so if it
  happens rather than manufacturing edits.

**Affected Files**:

- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`
- `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`

---

**Batch 4 verification (team-leader)**:

- `lint` on all 4 libs: pass (13 pre-existing warnings, none in changed code, 0 errors).
- `build` on `ptah-electron` + `ptah-extension-vscode`: pass.
- **Ordering of the lib-side fix confirmed in both affected hosts** — the fix is a no-op unless
  `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is registered before `startTaskSpecsIndex` runs.
  Electron: register `:297` → start `:332` ✓. cli-engine `register-thoth-libraries.ts`:
  `:81` → `:130` ✓. (Electron's registration sits inside the memory-curator `try`; if that block
  throws early the token is absent, the store falls back to in-memory, and there is no failure to
  fix. Consistent degradation.)
- **No new lib edge**: `task-specs/CLAUDE.md` already declares `persistence-sqlite` as an internal
  dependency ("Batch B store"), and `ptah-extension-vscode` already imported it
  (`wire-runtime.ts:17`). `better-sqlite3` loads via a lazy `require` inside the factory, so no
  native binding is pulled into any bundle. No cycle — `persistence-sqlite` imports nothing.
- **Test counts audited and confirmed exact**: 20 new cases (indexer 10 incl. a 3-way `it.each`,
  `start-index` 5, `sqlite-connection` 5). Of these ~16 fail against the pre-fix tree; the
  report's "14 discriminate" is if anything _understated_. No existing assertion was edited to fit
  new behaviour — the only edits to existing spec code are three mechanical constructor-arg
  additions forced by the `Logger` injection.
- **DI signature change is zero-risk**: `register.ts:67` already hard-asserts `TOKENS.LOGGER` is
  registered before this lib, and 16 sibling services already inject it. The only manual
  `new WorkspaceIndexerService(...)` sites are the three in its own spec; all three were updated.

**Team-leader scrutiny findings (accepted, recorded as follow-ups — none blocking)**:

- `MISSING_ENTRY_CODES` omits `EPERM` and `EBUSY`. On Windows — the primary platform — a file
  locked by another process commonly surfaces as `EPERM`, not `EACCES`, and one locked file in a
  scanned tree will still abort the whole index. The `EACCES` exclusion is defensible (the
  developer's "environment, not entry" split is a reasonable conservative default, and the new
  `reportSkipped` WARN means an all-skipped workspace is no longer silent), and behaviour for
  these codes is _unchanged_ from before the fix, so this is a gap rather than a regression.
  Revisit if a locked-file abort is ever observed.
- `start-index.ts`: `subscriptions.length > 0` is always true, since
  `subscribeToPersistenceOpen` always pushes at least `NOOP_DISPOSABLE`. The `: NOOP_DISPOSABLE`
  branch is dead. Harmless; tidy opportunistically.
- `isMissingEntryError` requires each link to be `instanceof Error`, so a driver throwing a plain
  `{ code: 'ENOENT' }` object would not match. No such thrower exists today (Node fs and
  VS Code's `FileSystemError` are both `Error`s). Depth bound of 5 is safe: the real chain is
  `FileSystemError` → errno error, depth 2.
- `persistence-sqlite/CLAUDE.md` "Cross-Lib Rules" lists consumers and does not yet name
  `task-specs`. Doc drift only.

**Batch 4 Acceptance Criteria**:

- A workspace containing a broken symlink or a file deleted mid-scan produces a complete index
  minus that entry, with the skip counted and visible.
- `[WARN] [task-specs] index rebuild write failed: Persistence is offline` does not appear on a
  clean Electron boot.
- `[Ptah Electron] WorkspaceFileIndex.start failed (non-fatal)` does not appear for a single-entry
  `ENOENT`.
- All three hosts either fixed or explicitly verified as not affected.

**What the reviewer should check**:

- The `ENOENT` skip narrows on the error code, not on a message substring.
- `startTaskSpecsIndex` is still fire-and-forget — no new `await` on the boot path.
- The `ensureStarted` retry latch at `task-index.service.ts:181` survives.
- One remedy across hosts, not three.

**Test coverage**: **senior-tester recommended for 4.1** (specs exist, extend them —
`workspace-indexer.service.spec.ts`, `workspace-file-index.service.spec.ts`). 4.2/4.3 are
host-wiring ordering, poorly served by unit tests; verify by boot log instead.
`task-index.service.spec.ts` and `task-index.store.spec.ts` exist and should keep passing —
neither should need changing, which is itself the signal that the fix stayed in the host layer.

---

## Batch 5: `harness-sync` — 13 unclosed gaps and a mis-scoped summary (Defect F) ✅ COMPLETE

**Commit**: `5c2090bdf` — `fix(harness-sync): report harness health at a scope both boot lines agree on`
**Report**: `batch-5-implementation.md`
**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: One lib plus its Electron reporting seam. **This batch may grow.** Task 5.1 is a
diagnosis, not a fix — the 13 missing files have no known cause, and the remedy cannot be
specified until it is found.
**Tasks**: 3 | **Dependencies**: None

### ✅ Batch 5 did NOT expand — because 5.1 overturned the premise

**Task 5.1's diagnosis is UPHELD by team-leader review.** This is the important outcome of the
batch and it is worth more than the two code changes.

**The 13 "missing" files are not production failures.** They all exist on disk, all on the
`claude` target, all `kind: skill`, all legacy `SkillJunctionService`-era copies under
`{ws}/.claude/skills/<slug>` (mtime 2026-07-08/09, predating `harness-sync`) that **no manifest
owns**. They are therefore `foreign` → `blocked` → counted `missing` **by design (E9)**. 13
correct refusals reported through a counter that reads like a failure. The capture came from the
live `property-hub` workspace, not this repo, and every number reproduces there to the unit.

**All three load-bearing claims re-verified independently at source, because the whole conclusion
moves if any one of them is wrong:**

| Claim                                                                    | Verified at                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked` is counted into `missing` **by design**                        | `health/harness-health.ts:112` — `appliedTargetHealth` returns `missing: [...missing, ...plan.blocked]`; `plannedTargetHealth` `:71` does the same, which is what makes `reconcile` and `verify` agree. `harness-sync/CLAUDE.md` states the rule in prose and in the health-semantics table. **UPHELD**                                                                                                                       |
| `writeFailed: 0` is **structurally incapable** of showing a blocked path | `targets/claude-target.ts:189-194` — `outcome === 'foreign'` does `scanned.push(relPath); continue;` **before** `writes.push`. A blocked path never enters `plan.writes`, `apply()` never sees it, and `appliedTargetHealth.writeFailed` is `[...result.writeFailed]` from that apply. **UPHELD**                                                                                                                             |
| `106/119` came from `appliedTargetHealth`, not `plannedTargetHealth`     | `plannedTargetHealth` has exactly two callers, both `IHarnessTarget.verify` (`claude-target.ts:432`, `workspace-target.ts:303`). In `reconcileTarget`, `verify()` is reachable only from the `mode === 'preflight'` no-drift branch. Both captured passes are `mode: 'full'`, so every detected target returns through `appliedTargetHealth` — including the `isNoOp` branch, which calls it with an empty result. **UPHELD** |

Also re-derived: `blocked = foreign.filter(relPath => desiredRel.has(relPath))` (`claude-target.ts:277`),
derived from `foreign` after the adoption filter, so "blocked is a subset of foreign" holds
structurally. `foreign: 19` = 13 blocked + 6 undesired legacy dirs closes independently.

**No remedy was implemented for the classification, and that is correct.** Excluding `blocked`
from `missing` is the documented non-converging regression (`harness doctor --fix` says "in sync",
`harness doctor` over the same tree says "23 missing", neither converging). See the follow-ups
block below for what SHOULD happen instead.

`research-report.md` §F has been corrected in place, marked as corrected, with the original
assertion struck rather than deleted.

### Task 5.1: Root-cause the 13 missing files (DIAGNOSIS — report before fixing) ✅ COMPLETE (diagnosis only, no code)

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
**Spec Reference**: `research-report.md` §F

**Quality Requirements**:

- Identify **which** 13 files, on which target(s), and which source was expected to produce each.
- Answer why the `content-download-complete` pass — which exists specifically to correct a cold
  or cached first pass — closes zero of them. Identical counts across both passes is the sharpest
  clue in the report.
- `writeFailed: 0` rules out permissions. `sources: ok` says the sources reported healthy. Both
  need explaining, not just noting.
- **Report findings and a proposed remedy. Do not implement the remedy in this task.**

**Validation Notes**:

- Counter construction: `harness-reconciler.service.ts:622-639`. `missing`, `foreign`, `removed`,
  `writeFailed` are **array lengths** (`target.missing.length`); `expected` and `found` are
  numbers. `missing` is a real list of paths — start there, it names the files.
- The warn gate is at `:649` (`writeFailed > 0 || missing > 0`), logged at `:650` from
  `private log(health: HarnessHealth)` (`:621-654`).
- `found` means two different things depending on whether an apply ran:
  `harness-health.ts:69-71` (`plannedTargetHealth`: `found = plan.unchanged`) vs `:110-112`
  (`appliedTargetHealth`: `found = plan.unchanged + Object.keys(result.written).length`).
  Confirm which shape the captured `106/119` came from before concluding anything about it.
- `harness-sync` is the one reconciler and must stay a leaf lib. Whatever the remedy, it does not
  grow a dependency on `agent-sdk` — that direction is forbidden and the port at
  `agent-sdk/src/lib/harness/harness-preflight.port.ts` is the whole relationship.

**Affected Files**: read-only for this task.

---

### Task 5.2: The Electron summary reports a per-target slice as if it were the whole ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\activation\plugin-activation.ts`
**Dependencies**: none (independent of 5.1)

**Quality Requirements**:

- `reconcileHarness` narrows to one target at `:365`
  (`health.targets.find(t => t.target === 'claude')`) and prints
  `found=${claude?.found ?? 0}/${claude?.expected ?? 0}` at `:368`, against a reconciler warn that
  sums **all six** targets. `14/27` and `106/119` are the same field names at different scopes —
  they can never agree.
- Either report the same aggregate the reconciler does, or label the line as claude-only so the
  scope is legible. **State which and why.**
- `?? 0` masks an absent claude target as `0/0`, which reads like a healthy empty pass. Distinguish
  "no claude target" from "claude target with nothing expected".

**Validation Notes**:

- The sibling propagate logger at `plugin-activation.ts:415-416` has the identical defect
  (`found=${claude?.found}/${claude?.expected}` against `health?.sources`). Fix both or neither —
  leaving one is worse than leaving both, because it makes the two lines disagree with each other
  as well as with the reconciler.
- The six targets are claude, codex, copilot, cursor, antigravity, vscode.

**Affected Files**:

- `apps/ptah-electron/src/activation/plugin-activation.ts`

---

### Task 5.3: Make the reconciler's own summary state its scope ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
**Dependencies**: Task 5.2 (same decision, applied on the other side)

**Quality Requirements**:

- `detail` (`:641-647`) carries `reason`, `mode`, `sources`, `collisions` plus the six summed
  counters, with nothing saying the counters are cross-target sums.
- Add the per-target breakdown, or the target count, so a reader can reconcile the two lines
  without reading `:622-639`. Whichever half Task 5.2 keeps, this line must be readable beside it.

**Validation Notes**:

- Do not change what is counted. This is a legibility fix; the counters themselves are inputs to
  Task 5.1's diagnosis and must stay comparable to the captured log.
- Keep the warn **gate** at `:649` unchanged.

**Affected Files**:

- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`

---

**Batch 5 Acceptance Criteria**:

- ✅ Task 5.1 has produced a written root cause naming the 13 files and why neither pass produces
  them, plus a proposed remedy — **returned to the orchestrator before implementation**. The
  premise was overturned rather than confirmed; see the block above.
- ✅ The Electron line and the reconciler warn are reconcilable by a reader without reading source.
  Both now print `found=106/119` for the same scope, and the Electron line labels the claude slice.
- ✅ No host reports `0/0` as a healthy pass — `formatClaudeSlice` splits `not-registered`,
  `undetected` and a genuine `0/0`.
- ✅ Counters themselves unchanged. `totals` is the same reduce over the same fields; only
  `scope`, `targetCount` and `perTarget` were added to `detail`. A re-run stays directly
  comparable to `tmp/logs/log.log`.
- ⏳ **PENDING MANUAL VERIFICATION** — the two lines observed agreeing in a real boot log. Both
  were hand-evaluated against the captured health object; neither was seen in a live run.

**Batch 5 verification (team-leader, MODE 2)**:

- `nx run-many -t lint -p task-specs,persistence-sqlite,harness-sync` PASS — harness-sync clean.
- `nx run-many -t build -p ptah-electron,ptah-extension-vscode` PASS.
- Tests (orchestrator): `harness-sync` 233, **unchanged** — consistent with 0 new cases and 0
  edited assertions.
- **No existing spec assertion edited**, in either unit. `git diff --stat` for Batch 5 lists only
  the two source files; no spec file is touched at all.
- **`harness-sync` gained no dependency and is still a leaf.** `git diff` on the reconciler shows
  no import line added — only the `detail` object changed. `libs/backend/harness-sync/package.json`
  is unmodified. Internal deps remain `@ptah-extension/shared` + `@ptah-extension/vscode-core`.
- **Warn gate at `:649` unchanged** — still `if (totals.writeFailed > 0 || totals.missing > 0)`.
  `this.log(health)` has exactly one call site (`:366`, inside `reconcile`), so no `verify()`
  result ever reaches it.

**5.2's two structural claims — both confirmed:**

1. **The shared formatter genuinely prevents drift.** `reconcileHarness` and `propagateHarness`
   now each contain a single `console.log(formatHarnessLine(...))`; there is one formatter and one
   `formatClaudeSlice`, so the two sites cannot disagree with each other again. `propagate`'s
   `HarnessHealth | null` is handled in the formatter as `no health report produced` rather than
   being run through the summarizer, which would have printed `sources=sources-missing` — a fact
   not in evidence.
2. **The aggregate equals the reconciler's `totals`.** `summarizeHarnessHealth` sums only
   `detected` targets while `log()`'s reduce sums all of them. They agree because every undetected
   target on the reconcile path comes from `undetectedTargetHealth`, which zeroes
   `expected`/`found`/`missing`/`foreign`/`removed`/`writeFailed` (`harness-health.ts:33-45`).
   `reconcileTarget` early-returns it before any plan is built. Agreement is structural on this
   path, as claimed. **One caveat recorded, not a defect**: `plannedTargetHealth` takes `detected`
   as a parameter and `WorkspaceHarnessTarget.verify` passes a real `detect()` result, so in
   general a `verify()` report CAN carry an undetected target with non-zero counts, and there the
   two sums would differ. That report never reaches `log()` and never reaches `formatHarnessLine`,
   so it cannot produce the disagreement this task fixed — but "agree by construction" is true of
   the reconcile path specifically, not of `HarnessHealth` universally.

**`?? 0` split into three states — no state unreachable or mislabelled, with one honest caveat:**

| State                            | Renders          | Reachable?                                                                                                                                                      |
| -------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no claude target in `targets`    | `not-registered` | **Yes** — `reconcile({ targets: [...] })` narrows `selected` via `selectTargets`, so a scoped repair omits claude entirely                                      |
| registered but `detected: false` | `undetected`     | **Not on this path today.** `ClaudeTarget.detect()` is unconditionally `true` (Claude Code reads `{ws}/.claude` in any workspace). Defensive, correct, and free |
| detected, nothing desired        | `0/0`            | **Yes** — the original requirement                                                                                                                              |

The middle row is dead-but-harmless rather than mislabelled: the label is accurate for the state
it names, and it becomes live the day `ClaudeTarget` grows a real `detect()`. The report's claim
that it is "a real environment fact the old spelling also hid" slightly overstates it for the
claude target specifically. Recorded, not held against the change.

**0 new spec cases — accepted for 5.3, thin for 5.2. Ruling: correct enough to ship.**

- **5.3: agreed, and the reasoning is right.** The 10 reconciler specs that stub `logger.warn`
  (`concurrency`, `foreign-edits`, `idempotency-removal`, `migration`, `overlay-and-disabled`,
  `preflight`, `remove`, `sources-health`, `workspace-isolation`, `write-failure`) all discard the
  payload. Pinning the key set of a diagnostic log object is a change-detector test over a string
  nothing consumes. Padding the count here would have been worse than not padding it.
- **5.2: the weaker half.** `formatClaudeSlice` is a pure three-branch function with no
  dependencies — it is not a change-detector risk, and the `0/0` state it exists to split was an
  explicit Batch 5 acceptance criterion AND a named edge case in this plan's Edge Cases list. One
  spec over three inputs would have pinned it for ~15 lines. It is currently module-private, so
  pinning it needs an export. **Not blocking**: the behaviour was read and verified branch by
  branch at review, the function has no state and no I/O, and the honesty of declining to pad
  elsewhere is worth more than a forced case here. Recorded as follow-up **R4**.

---

## Follow-ups recorded from Batch 5 — NOT scheduled in this task

None of these blocks the commit. All are recorded so the diagnosis is not paid for twice.

**R1 — log the blocked set as a distinct, user-actionable message. Risk: LOW. Value: HIGH.**
The primary recommendation and the one that actually cost the diagnosis its time. When `missing`
is non-empty, `writeFailed` is empty, and every missing entry is also in `blocked`, the current
warn says "gaps" for a state Ptah is _correctly_ maintaining, with no path to the fix. Split the
log: a distinct message naming the blocked paths plus the one-line user action ("move or delete
these, then re-run `ptah harness doctor --fix`"). Keep `summarizeHarnessHealth` at `degraded` —
the harness genuinely is incomplete — but stop spelling a refusal as a gap of unknown cause.

**R2 — bounded legacy-skill adoption migration. Risk: MEDIUM. NEEDS A PRODUCT DECISION.**
**Its own task, with its own review. Explicitly NOT scheduled here.** Legacy skill copies are
unadoptable only because `.claude/skills` never got a `.ptah-managed.json` sidecar — an accident
of the deleted `SkillJunctionService` implementation, not a safety property. A bounded one-shot
migration could adopt an unowned `.claude/skills/<slug>` when the slug is in the desired state
**and** a legacy `.claude/commands/.ptah-managed.json` proves the legacy pipeline ran in this
workspace. **This can overwrite a skill a user genuinely authored by hand at a colliding slug.**
That is a product call about whose content wins, not an engineering detail, and it must not be
folded into a logging fix.

**R3 — name the blocked paths in the boot line. Risk: LOW.**
`ptah harness doctor` already lists the paths; the Electron and VS Code boot lines print counts
only. Task 5.3's `perTarget` narrows the gap to "which target"; naming the first few paths would
close it to "which file".

**R4 — pin `formatClaudeSlice`'s three branches with one spec. Risk: NONE.**
See the 5.2 ruling above. Export the function and assert `not-registered` / `undetected` / `0/0`.

**VS Code host carries the identical 5.2 defect — and now disagrees with everything.**
`apps/ptah-extension-vscode/src/activation/plugin-activation.ts:286-294` does the same
`health.targets.find(t => t.target === 'claude')` and logs `expected`/`found`/`foreign`/
`writeFailed` with `?? 0` under the same bare field names the reconciler uses for all-target sums.
Outside Batch 5's assigned files, correctly reported rather than silently fixed. **It is now
strictly worse than before this batch**: the VS Code line disagrees with the Electron line AND
with the reconciler warn, where previously the two hosts at least agreed with each other. Fixing
it is mechanical — the shared formatter already exists in the Electron host and the obvious move
is to lift `formatHarnessLine`/`formatClaudeSlice` somewhere both hosts can import. One
correction to the batch report: `:337` (`propagateHarness`) logs only `reason` and `sources` — it
has no claude slice and no `?? 0`, so it is an information gap, not the same defect. The defect
is at `:286-294` only.

**Explicitly NOT recommended: excluding `blocked` from `missing`.**
This is the documented non-converging regression — `harness doctor --fix` reporting "in sync" and
exiting 0 while `harness doctor` over the identical untouched tree reports "23 missing" and exits
1, forever. `missing` must stay "desired but not owned on disk, regardless of why", and `blocked`
must stay reported as both `foreign` and `missing`. Recorded here so a future reader who finds the
`missing: 13` line confusing does not reach for the obvious fix.

**Unrelated observation, pre-existing, not actioned.**
`libs/backend/harness-sync/src/lib/targets/workspace-target.ts` contains two literal NUL bytes
(offsets 33696 and 33733) — deliberate sentinels written as raw `\0` characters rather than the
`'\0'` escape, inside `transformer.relPathFor('\0')`. Harmless at runtime, but it makes `grep`
classify the file as binary and skip it, which is a real cost during exactly this kind of
investigation. Unmodified from `HEAD`, outside both units' scope.

**What the reviewer should check**:

- 5.1 was a diagnosis and did not quietly become a fix.
- Both `plugin-activation.ts:368` and `:415-416` treated the same way.
- `harness-sync` gained no new dependency; it is still a leaf.
- The `writeFailed > 0 || missing > 0` warn gate is intact.

**Test coverage**: **senior-tester after 5.1 reports**, not before — the tests worth writing
depend on the cause. For 5.2/5.3 the change is log-string shape, poorly served by unit tests;
verify against a real `nx serve ptah-electron` boot. Check `libs/backend/harness-sync/src/lib/`
for existing reconciler/health specs when 5.1's remedy is known; if the remedy touches
`plannedTargetHealth`/`appliedTargetHealth` (`harness-health.ts:69-71`, `:110-112`), those are
the specs at risk.

---

## Test Coverage Summary

| Batch   | senior-tester          | Existing specs that BREAK if not extended                                                                            | Existing specs that must keep PASSING                                                                                                                                       | New specs needed                                                                                                                                             |
| ------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 (A)   | **REQUIRED**           | none — **`start()` has no spec at all**                                                                              | `job.store.spec.ts`, `run.store.spec.ts`                                                                                                                                    | `cron-scheduler.spec.ts` (new file)                                                                                                                          |
| 2 (B)   | **REQUIRED**           | `skill-drain.failures.spec.ts`, `lane-resolver.service.spec.ts:231-254`, `lane-runner.service.spec.ts:32-56,398-427` | `lane-resolver.providers.spec.ts:221` (compiled-body scan), `lane-runner.env-immutability.spec.ts`, `skill-drain.gates.spec.ts`, `skill-queue.store.reopen-payload.spec.ts` | quota store; `translation-proxy-base.spec.ts` +429 side-effect; `provider-auth-resolver.spec.ts` +inherit case; `sdk-internal-query.curator-llm.spec.ts` +Q2 |
| 3 (C,G) | recommended            | `session-importer.service.spec.ts`                                                                                   | `auth-manager.spec.ts`                                                                                                                                                      | concurrent-`initialize()` spec on `sdk-agent-adapter`                                                                                                        |
| 4 (D,E) | recommended (4.1 only) | `workspace-indexer.service.spec.ts`                                                                                  | `workspace-file-index.service.spec.ts`, `task-index.service.spec.ts`, `task-index.store.spec.ts`                                                                            | none                                                                                                                                                         |
| 5 (F)   | **after 5.1 reports**  | unknown until 5.1                                                                                                    | TBD                                                                                                                                                                         | TBD                                                                                                                                                          |

**Named in the orchestration brief, for the record**: `lane-resolver.providers.spec.ts` is the
one that will actively catch a Batch 2 violation (it reads compiled function bodies, so a
provider literal in the new quota branch fails it) — it must keep passing, unchanged.
`skill-drain.gates.spec.ts` and `skill-queue.store.reopen-payload.spec.ts` are **not** implicated
by any change here: the first pins weekly-tier stage registration, the second pins payload merge
and cross-host claim. Neither touches the failure-kind union or the auth path.

---

## Execution Order

1. **Batch 1 (A)** — first, always. Restores the window; every later batch is manually verifiable
   only after it lands.
2. **Batches 3, 4, 5** — no ordering constraint among themselves or against Batch 2. Run in any
   order the orchestrator prefers; 3 and 4 are the cheapest and each restores a silently-dead
   feature.
3. **Batch 2 (B)** — largest blast radius, three open questions, six coupled tasks. Its three
   open questions should be surfaced to the user before the batch is spawned.
4. **Defect H** — opportunistic, no batch.

Note this diverges from `research-report.md` §"Suggested sequencing" only in that C/D are not
privileged ahead of B; the brief states C–G have no ordering constraint among themselves.

---

# R2 — Legacy skill adoption (task widened 2026-08-22)

**Source plan**: `r2-migration-plan.md` (software-architect). Batches 6–9 below are that plan's
§6 breakdown turned into this file's batch format. **The design is not re-opened here** — only
the batching, the executor recommendations, and the settled decisions are added.

## The finding that reframes R2 — carry this into every batch

Follow-up **R2** was recorded from Batch 5 (line 1271 above) on the premise that the 13 legacy
skill directories are _Ptah's own orphaned output_, unadoptable only because
`.claude/skills` never got a `.ptah-managed.json` sidecar. **That premise is false, and the
architect made it falsifiable rather than merely doubtful.**

> `SkillJunctionService` **linked** skills and only **copied** commands. It never wrote the 13
> directories and could not have.

Three independent facts, each sufficient alone:

1. **No copy path existed for skills.** The only filesystem write for a skill is
   `createJunction(sourcePath, linkPath)` — no `cp -r`, no fallback branch, no
   "if junction fails, copy instead". A real directory is not a possible output of that function.
   `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356`
2. **It refused to touch occupied paths**, logging
   `Skipping ${skillName}: real directory exists (likely SDK-created)`. The legacy code already
   suspected non-Ptah provenance and deferred to it.
   `git e107e6f89^:.../skill-junction.service.ts:336-343`
3. **Even a surviving junction would not be blocked today** — `claude-target.ts:480-486` migrates
   one whose target resolves inside a declared source root, and `~/.ptah/plugins` /
   `~/.ptah/skills` are declared (`plugin-config-source-resolver.ts:55`).

So the sidecar-manifest story explains why _commands_ could go orphaned (a copy is
indistinguishable from user work, so it needs an out-of-band record) but **not** the 13 skill
directories. The asymmetry was correct design: a link is self-identifying.

**The 13 are real directories of unknown provenance.** At least three non-Ptah candidates fit and
the evidence does not discriminate: the Claude Code SDK itself; the pre-TASK_2026_288
`npx skills add --agent claude-code` path, which wrote straight into `{ws}/.claude/skills`
(`libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:17-25`); or the
user, by hand. **Nothing shows any of them is Ptah's.**

That is the load-bearing conclusion and it is why the R2 line at 1271 above is superseded: the
bounded content/sidecar-heuristic migration it proposed is Option B/C in the plan, and both are
**rejected on the veto discriminator** — a content match proves the _skill_ is the same skill,
not that _Ptah wrote this directory_, and both non-Ptah install paths produce matching content
by construction. **Consent is the only available proof of ownership**, which is what forces the
A + D shape below.

**The actual user-visible defect** is `missing=13` alongside `writeFailed=0`
(`tmp/logs/coldstart-306.log:844`). Nothing failed — blocked paths are filtered out before
`plan.writes` is built, so the failure counter can never see them. A 13-item shortfall with a
perfect write record, forever, with no surface anywhere that says why.

## Settled decisions — do NOT re-litigate

Decided by the user, 2026-08-22, on the architect's §7. Recorded as binding; the developer
implements them as stated and the reviewer checks the code matches.

| #      | Decision                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1** | **Build the repair.** Ship Batch A (report the blocked set) **and** Batch D (consent-gated repair). Reporting-alone was considered and **rejected** — a user who got these from the old `npx skills add` path currently has no route back to a managed state.                       |
| **U2** | **Quarantine lives alongside the target**: `.claude/skills/.ptah-quarantine/<name>-<timestamp>`, same-volume, with a **documented ignore rule so the reconciler never scans it**. Not `~/.ptah/` (cross-volume move risk on Windows), not the recycle bin (opaque, not scriptable). |
| **U3** | **Consent is one dialog with per-path checkboxes, defaulting to none selected.** Not one bulk approval (weakens the per-path ownership claim that is the entire justification), not 13 prompts (hostile).                                                                           |
| **U4** | **The quarantine is never cleaned up automatically.** It is the undo; an expiry policy silently converts a reversible operation into a destructive one on a timer. No TTL, no sweep, no "older than N days" job.                                                                    |

## Batching note

**`cli_delegation` remains disabled for this task** (`context.md:101`), so every R2 batch runs on
a **sub-agent developer, sequentially** — no CLI fan-out, matching Batches 1–5.

The architect's Batch A and Batch D are each split in two here, because **A3 and D3 carry frontend
work** and this file's rule is that backend and frontend never share a batch. The split is along
the seam the architect already drew: A3 is explicitly derived client-side with **no RPC contract
change**, so it does not even depend on Batch 6 landing first.

**Batch 6 is unblocked and fully independent of Batches 8–9.** It changes no filesystem behaviour,
needs no decision from anyone, and is the whole of the D2 fix. It is worth shipping even if the
repair half were never approved. Batches 8–9 were gated on §7 and are now **ungated by U1–U4**.

---

## Batch 6: R2-A backend — make the blocked shortfall legible ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: One lib (`harness-sync`) plus its own docs. Pure observability — a derivation, a
log line, and a CLAUDE.md entry, with **zero filesystem writes added or removed**. Tightly
coupled (6.2 logs what 6.1 derives) and reasoning-heavy about set semantics that Batch 5 already
got wrong once, so it is the sub-agent shape, not the fan-out shape. Lowest risk in R2 and the
largest legibility win.
**Tasks**: 3 | **Dependencies**: None — **independent of Batches 8–9 and shippable alone**

### Task 6.1: Derive the blocked set in the reconciler ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
**Spec Reference**: `r2-migration-plan.md` §6 / A1

**Acceptance Criteria**:

- Compute `blocked = missing ∩ foreign` at the point where the plan is finalized.
- Given the cold-start conditions at `tmp/logs/coldstart-306.log:844`, the derived set has
  **exactly 13 members**.
- **No change to `plan.writes`; `writeFailed` stays `0`.** This task adds no write and removes no
  write.
- Derivation is unit-tested against a fixture with **overlapping, disjoint, and empty**
  `missing`/`foreign` sets.

**Validation Notes**:

- `blocked` is **already** computed one level down as
  `foreign.filter(relPath => desiredRel.has(relPath))` (`claude-target.ts:277`), derived from
  `foreign` after the adoption filter. Reuse the existing notion rather than inventing a second
  one that can drift — "blocked is a subset of foreign" must keep holding structurally.
- `blocked` is counted into `missing` **by design (E9)** — `health/harness-health.ts:112` and
  `:71` both return `missing: [...missing, ...plan.blocked]`, which is what makes `reconcile` and
  `verify` agree. **Do not change that.** See the explicit non-recommendation at line 1302 above:
  excluding `blocked` from `missing` is the documented non-converging regression.
- `writeFailed: 0` is **structurally incapable** of showing a blocked path —
  `targets/claude-target.ts:189-194` does `scanned.push(relPath); continue;` on `outcome ===
'foreign'` **before** `writes.push`. That is the fact the whole batch exists to explain, not a
  bug to fix.
- `harness-sync` must stay a **leaf lib**. No new dependency, and specifically not on `agent-sdk`.

---

### Task 6.2: Log the blocked set at reconcile time ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
**Dependencies**: Task 6.1
**Spec Reference**: `r2-migration-plan.md` §6 / A2 — implements follow-up **R1** (line 1263)

**Acceptance Criteria**:

- Emit **one structured line** naming each blocked path and the reason.
- Reason text distinguishes **"occupied by a directory Ptah does not own"** from every other
  cause of `missing`. A reader must be able to tell a refusal from a failure without reading code.
- Include the one-line user action, per R1: move or delete these, then re-run
  `ptah harness doctor --fix`.
- **The existing one-line summary is unchanged** — no log-parsing regressions, and the
  `writeFailed > 0 || missing > 0` warn gate (`:649`) stays intact.
- **With zero blocked paths, no line is emitted.** Silence stays silent when correct.
- `summarizeHarnessHealth` keeps returning `degraded` — the harness genuinely is incomplete. This
  task stops spelling a refusal as a gap of unknown cause; it does not declare the gap closed.

**Validation Notes**:

- Counter construction is at `harness-reconciler.service.ts:622-639`; `missing` is a real list of
  paths, so it already names the files. The warn is logged at `:650` from
  `private log(health: HarnessHealth)` (`:621-654`).
- Scope-labelling landed in Task 5.3 — do not undo it. The new line must state its scope the same
  way the summary now does.

---

### Task 6.3: Document the blocked-path condition and kill the false premise ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\CLAUDE.md`
**Dependencies**: none (independent of 6.1/6.2)
**Spec Reference**: `r2-migration-plan.md` §6 / A4

**Acceptance Criteria**:

- Records the blocked-path condition and its cause: why `missing` can be non-zero while
  `writeFailed` is `0`, and that this is a **correct refusal**, not a failure.
- Records that **`SkillJunctionService` never produced real skill directories**, with the
  `git e107e6f89^:.../skill-junction.service.ts:304-356` citation and the `:336-343`
  skip-occupied-paths log text, **so the false premise is not rediscovered.** This is the
  load-bearing half of the task — the premise has already cost one investigation.
- Records that the 13 are of **unknown provenance**, naming the three candidates (SDK, pre-288
  `npx skills add` at `harness-skill-install.service.ts:17-25`, the user).
- States the quarantine ignore rule from U2 so Batch 8 has a written convention to implement
  against.

---

**Batch 6 Verification**:

- `npx nx build harness-sync` and `npx nx test harness-sync`
- A real `nx serve ptah-electron` cold start shows the new blocked line naming 13 paths, and the
  existing summary line byte-unchanged apart from that addition
- `writeFailed` still `0`; `missing` still `13` (this batch explains the number, it does not
  change it)
- code-logic-reviewer approved

---

## Batch 7: R2-A frontend — blocked-paths disclosure on the harness health card ⏸️ PENDING

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Split from Batch 6 solely because backend and frontend never share a batch. One
additive, purely presentational task with **no RPC contract change in the diff** — the architect's
D5 discriminator holds that `blocked` is `missing ∩ foreign` over fields the payload **already
carries**, so this derives client-side and needs nothing from Batch 6. Genuinely parallel-eligible
with Batch 6 if the orchestrator wants it, but `cli_delegation` is disabled so it runs as a
sub-agent either way.
**Tasks**: 1 | **Dependencies**: **None** — derives from the existing payload; does not wait on 6.1

### Task 7.1: Additive blocked-paths disclosure in the harness health card ⏸️ PENDING

**File**: harness health card under `D:\projects\ptah-extension\libs\frontend\` — locate the
existing card component before editing; this task does **not** create a new surface.
**Spec Reference**: `r2-migration-plan.md` §6 / A3

**Acceptance Criteria**:

- Additive disclosure listing the blocked paths. **No layout rewrite** of the existing card.
- The card **explains why `missing` can be non-zero while `writeFailed` is `0`** — this sentence
  is the deliverable, not the list.
- Derived **client-side from existing payload fields**; **no RPC contract change in the diff**.
  If the task appears to need a new wire field, stop and report — that is a design change, not an
  implementation detail.
- **Hidden entirely when the blocked set is empty.** No empty-state chrome.
- `ChangeDetectionStrategy.OnPush`, signals + `inject()`. No `[innerHTML]` on any path text.

**Validation Notes**:

- Health-card assertions in the e2e suite may need the new disclosure element — check before
  assuming a green run means nothing moved.
- Path strings come from the backend and are rendered as text only. They are filesystem paths from
  the user's own machine, but they still route through normal Angular interpolation, never raw
  HTML.

---

**Batch 7 Verification**:

- `npx nx build` + `npx nx test` for the owning frontend lib
- Card renders the disclosure with a non-empty blocked set and disappears entirely with an empty
  one
- `git diff` shows **no change** to `libs/shared/.../rpc.types.ts`
- code-logic-reviewer approved

---

## Batch 8: R2-D backend — consent-gated repair with quarantine ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: **Highest-risk surface in the whole task — it moves user directories.** Four tightly
ordered tasks: the convention (8.1) defines what the operation (8.2) writes, which the RPC (8.3)
gates, which the coverage (8.4) pins. Cross-file, cross-lib (`harness-sync` + `rpc-handlers` +
`libs/shared`), and reasoning-heavy about failure ordering — the exact shape `cli_delegation`
was disabled for. Medium-high risk, mitigated by consent and by the quarantine being
non-negotiable.
**Tasks**: 4 | **Dependencies**: Batch 6 (needs the derived blocked set as the authoritative
input); **ungated by decisions U1–U4**

### Task 8.1: Quarantine convention ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\` — new module; document in
`D:\projects\ptah-extension\libs\backend\harness-sync\CLAUDE.md`
**Spec Reference**: `r2-migration-plan.md` §6 / D1; decisions **U2**, **U4**

**Acceptance Criteria**:

- Location and naming are exactly **U2**: `.claude/skills/.ptah-quarantine/<name>-<timestamp>`.
- **Quarantined content is never scanned as a source or as a target** — asserted by a test, not
  just by a leading dot. A reconcile pass over a tree containing a populated quarantine must
  produce identical health to the same tree without it.
- **Same-volume by default**, with a documented fallback when the target is not on the same volume
  (copy-then-delete, and the fallback must be as reversible as the move it replaces).
- Timestamp format is collision-safe for two repairs of the same slug in the same second.
- **No automatic cleanup, no TTL, no sweep** (U4). If a future reader looks for an expiry policy,
  the docs must say why there deliberately is not one.

---

### Task 8.2: Repair operation — move-then-write ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\` — new repair entry point
**Dependencies**: Task 8.1
**Spec Reference**: `r2-migration-plan.md` §6 / D2

**Acceptance Criteria**:

- Single-path repair: **move** the occupant to quarantine, **then** write the managed copy.
- **Never overwrites in place** — asserted by a test that **fails if the occupant's content is
  destroyed**. This is discriminator D1 and it is a hard veto, not a preference.
- If the write fails **after** the move, the occupant is **restored**; or, if restore itself
  fails, the error **names the quarantine path explicitly** so the user can restore by hand. A
  bare failure message that does not name the path is a failing implementation.
- **Idempotent** — a second call on an already-repaired path is a no-op, not a second quarantine
  entry.
- Mirrors the move-not-overwrite policy at
  `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-legacy-adoption.ts:98-147` — the in-repo
  precedent that already survived review. Diverging from it needs a stated reason.
- The repair entry point is **invoked only from an explicit request — never from activation
  reconcile.** Enforced structurally, not by convention.

**Validation Notes**:

- Windows move semantics across drives/volumes is the named cross-platform risk. The same-volume
  guarantee in 8.1 is what keeps the move atomic; the fallback path needs its own test.
- Partial failure is the case that loses user data if it is wrong. It needs coverage of its own,
  not a happy-path test with an error branch nobody executes.

---

### Task 8.3: Consent RPC — dual registration + Zod boundary ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\harness\` (handler),
`D:\projects\ptah-extension\libs\shared\` (`rpc.types.ts`),
`D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts`
**Dependencies**: Task 8.2
**Spec Reference**: `r2-migration-plan.md` §6 / D3 (backend half); decision **U3**

**Acceptance Criteria**:

- **Dual registration** — `libs/shared/.../rpc.types.ts` (compile-time) **and**
  `ALLOWED_METHOD_PREFIXES` in `rpc-handler.ts:46` (runtime guard). Both, or the method is dead at
  runtime with a green build.
- **Zod validation on the path list at the RPC boundary.** Paths **outside the known blocked set
  are rejected** — the RPC is not a general-purpose "move this directory" primitive and must not
  become one.
- Accepts a **per-path selection** (U3), not a boolean "repair everything".
- Repair is **unreachable from activation reconcile**; only an explicit user action can invoke it.
- Returns enough for the UI to report per-path outcome, including the quarantine destination for
  each repaired path.

---

### Task 8.4: Repair coverage ⏸️ PENDING

**File**: specs under `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\`
**Dependencies**: Tasks 8.1–8.3
**Spec Reference**: `r2-migration-plan.md` §6 / D4

**Acceptance Criteria**:

- End-to-end: blocked → consent → moved + written → **a subsequent reconcile reports `missing`
  reduced by the repaired count, with `writeFailed=0`.**
- **Declined consent leaves the filesystem byte-identical.** Not "approximately unchanged" —
  byte-identical, asserted.
- Partial-selection case: repairing 3 of 13 leaves the other 10 blocked and untouched.
- The move-then-write failure path from 8.2 is exercised, not just declared.

---

**Batch 8 Verification**:

- `npx nx build harness-sync rpc-handlers` and `npx nx test harness-sync rpc-handlers`
- Manual: a real cold start after a partial repair shows `missing` reduced by exactly the repaired
  count and `writeFailed` still `0`
- The quarantine directory exists, contains the originals, and is **not** reported as `foreign`
- code-logic-reviewer approved — with explicit attention to the move-then-write failure ordering

---

## Batch 9: R2-D frontend — consent dialog ⏸️ PENDING

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Split from Batch 8 under the never-mix rule. One task, but it is the surface that
carries the entire ownership claim — the consent **is** the proof of ownership (discriminator D3),
so its defaults and its wording are load-bearing, not cosmetic.
**Tasks**: 1 | **Dependencies**: Batch 8 (needs the consent RPC), Batch 7 (the disclosure is where
the user enters this flow)

### Task 9.1: One dialog, per-path checkboxes, default none selected ⏸️ PENDING

**File**: alongside the harness health card under `D:\projects\ptah-extension\libs\frontend\`
**Spec Reference**: `r2-migration-plan.md` §6 / D3 (frontend half); decision **U3**

**Acceptance Criteria**:

- **One dialog listing all blocked paths with per-path checkboxes**, **defaulting to none
  selected** (U3). Not a bulk approve-all default, not a sequence of prompts.
- **The confirmation names the quarantine destination before the user consents** — the user must
  see where their directory is going while they still have the option to decline.
- Confirm is disabled with an empty selection.
- States plainly that Ptah **cannot prove it created these directories** — that is the honest
  framing of why consent is being asked for at all, and it is the reason the default is none.
- Per-path outcome reported back after the call, including failures with their quarantine path.
- `ChangeDetectionStrategy.OnPush`, signals + `inject()`.

**Validation Notes**:

- A select-all affordance is acceptable as an explicit user action; a select-all **default** is
  not. The distinction is the whole of U3.
- The dialog must not offer any "clean up quarantine" action — U4 is that we never do this, and a
  button contradicting the docs is worse than no button.

---

**Batch 9 Verification**:

- `npx nx build` + `npx nx test` for the owning frontend lib
- Dialog opens with zero checkboxes selected on every open, including re-open after a partial
  repair
- Declining leaves the filesystem byte-identical (pairs with 8.4)
- code-logic-reviewer approved

---

## R2 Execution Order

1. **Batch 6** — first. Unblocked, no decision outstanding, zero filesystem change, and it is the
   whole of the D2 fix. **Ships alone and is worth shipping even if 8–9 never land.**
2. **Batch 7** — any time; no dependency on Batch 6 (derives client-side, no contract change).
   Run it concurrently with Batch 6 if the orchestrator wants the reporting half complete in one
   pass.
3. **Batch 8** — after Batch 6, because the derived blocked set is the repair's authoritative
   input. Highest risk in the task; do not start it in parallel with anything.
4. **Batch 9** — last; needs Batch 8's RPC.

**Explicitly out of scope for R2** (from `r2-migration-plan.md` §5): changing how `foreign` is
classified; the commands/sidecar-manifest path (correctly designed); any change to
`claude-target.ts:480-486` junction migration (already correct); bidirectional source/target sync
(Option E — inverts the one-way reconciler invariant `harness-sync` exists to hold).

## R2 Evidence Index (reused from `r2-migration-plan.md`, not re-derived)

| Claim                                                         | Citation                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Skills were linked, never copied; no fallback                 | `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356` |
| Legacy code skipped occupied paths, suspected SDK provenance  | `git e107e6f89^:.../skill-junction.service.ts:336-343`                                    |
| Surviving junctions are migrated, not blocked                 | `libs/backend/harness-sync/src/lib/targets/claude-target.ts:480-486`                      |
| `~/.ptah/plugins`, `~/.ptah/skills` are declared source roots | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:55`           |
| Pre-288 installer wrote directly into `{ws}/.claude/skills`   | `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:17-25`     |
| Prior art: adopt via third-party record, move not overwrite   | `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-legacy-adoption.ts:98-147`         |
| Live signature: `missing=13`, `writeFailed=0`                 | `D:/projects/ptah-extension/tmp/logs/coldstart-306.log:844`                               |
| `blocked` counted into `missing` by design                    | `libs/backend/harness-sync/src/lib/health/harness-health.ts:71`, `:112`                   |
| Blocked paths never enter `plan.writes`                       | `libs/backend/harness-sync/src/lib/targets/claude-target.ts:189-194`, `:277`              |

---

# F1 — Curator stall discards its own input (task widened 2026-08-22)

> **Running totals after this section**: 30 tasks across 10 batches. (The header at the top of
> this file predates Batch 10; it is stale by one batch and three tasks.)

**Source**: **F1**, the material finding from the team-leader MODE 2 review of Batch 2 —
`batch-2-implementation.md` §6, with live evidence in §8. Batch 10 below closes it.

## The defect

Decision **A2** told Task 2.6 to stop the curator entirely while its resolved provider is cooling
down, and Task 2.6's **no-throw constraint** meant "stop" had to be expressed as a quiet return.
The result:

```
runQuery → ''   →   extract() → []
```

An empty extraction from a **quota stall** is byte-identical to an empty extraction from a
**successful pass that found nothing**. Downstream cannot tell them apart — and downstream acts:

- `libs/backend/memory-curator/src/lib/memory-trigger.service.ts` **:744-745** calls
  `markProcessed(ids)` on the resolve path, **inspecting nothing**. The episodes are marked
  processed whether or not anything was extracted from them.
- `drainForSession` filters on `processed_at IS NULL`, so once marked, those rows are **never
  revisited**.
- `episodes.reset` at **:696** has **already fired** by that point.
- A resolving run **advances the boot-scan watermark**.

Net: a stalled pass **consumes and discards its input**. The gate correctly prevents a doomed LLM
call and then throws away the work that call was meant to do. When quota returns 15 minutes later,
the material is gone.

**Confirmed live, not theoretical.** `tmp/logs/coldstart-306.log` lines **1232–1260** show the gate
firing **15 times** with `curatorProviderId: ""` in a tight
`JsonlReader findSessionsDirectory` → skip-pass loop with nothing between. That is drain-and-discard
running **faster than before the gate**, because the stall returns instantly where a real LLM call
would have taken seconds. Fifteen passes' worth of episodes consumed and discarded on a single cold
start.

## Settled decisions — do NOT re-litigate

Decided by the user, 2026-08-22, on the two directions the review offered.

| #      | Decision                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **U5** | **Stats discriminator.** Return a result the caller can inspect — a stalled/skipped signal alongside the empty extraction — so `markProcessed` can distinguish "stalled, keep the rows" from "ran, found nothing". |
| **U6** | **Task 2.6's no-throw constraint stays intact.** Letting the stall throw was considered and **rejected**: too wide a blast radius. Do not reach for the failure path as a shortcut to a discriminator.             |
| **U7** | **Not deferred to a separate task.** Filing it as a follow-up was considered and **rejected**, because the data loss is happening **now, on every cooldown**.                                                      |

---

## Batch 10: Close F1 — make the curator stall distinguishable from an empty result ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: `cli_delegation` is disabled (`context.md:101`). Three tightly ordered tasks in one
lib — 10.1 produces the signal, 10.2 is the only consumer that matters, 10.3 pins both. Small in
lines and large in consequence: it is a return-shape change on a path whose current ambiguity is
actively destroying user data. Reasoning-heavy about which caller advances what state, which is
precisely the shape that produced F1 in the first place.
**Tasks**: 3 | **Dependencies**: Batch 2 (committed, `ca183174d`) — **independent of Batches 6–9**

### ⚠️ Priority relative to Batches 6–9: **run Batch 10 FIRST, ahead of Batch 6**

Stated plainly because the two are otherwise easy to order by size. **Batch 10 outranks every R2
batch.**

- **Batch 10 is live data loss.** Every cooldown discards episodes permanently. The cold-start log
  shows 15 passes' worth destroyed in a few hundred lines on one boot, and the condition recurs on
  a 15-minute clock for as long as the provider is exhausted.
- **Batch 6 is a legibility fix for a state that is already correct.** `missing=13` is 13 correct
  refusals; nothing is being lost while it goes unexplained. It is high-value and low-risk, but
  **nothing degrades further while it waits**.

Loss that compounds beats confusion that does not. If only one batch runs today, it is this one.

---

### Task 10.1: Return a discriminating result from the curator stall path ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\` — the stall site added
by Task 2.6 in `ca183174d`, and the result type it returns through
**Spec Reference**: `batch-2-implementation.md` §6 (F1); decisions **U5**, **U6**

**Acceptance Criteria**:

- The curator pass returns a result the caller can **inspect** to tell **stalled** from **ran and
  found nothing**. A `stalled`/`skipped` signal carried **alongside** the extraction, not encoded
  into it.
- **The no-throw constraint holds (U6).** The stall still returns; it does not throw, and the
  existing `ProviderAuthError` fallback is untouched.
- **The empty extraction stays empty.** This task adds a signal; it does not invent a non-empty
  result to carry it. A stalled pass extracted nothing and must keep saying so.
- The signal is **explicit and named** — not `null` vs `[]`, not a sentinel string, not an
  overloaded count. A future caller must fail to compile or fail obviously if it ignores the
  distinction, rather than silently taking the old branch.
- The existing WARN line stays: `curator provider is rate-limited; skipping this curation pass
until its quota refills`. Its `curatorProviderId: ""` field is the empty-provider inherit path
  and is load-bearing evidence — do not "fix" it into a resolved id.

**Validation Notes**:

- The ambiguity is `runQuery → ''` → `extract() → []`. The empty **string** from `runQuery` is the
  first point where the information is lost; the empty **array** from `extract()` is where it
  becomes unrecoverable. Prefer carrying the signal from the earlier point rather than
  reconstructing it later.
- `sdk-internal-query.curator-llm.spec.ts` is in this blast radius (named in the Test Coverage
  Summary for Batch 2). Check it before and after.

---

### Task 10.2: Stop marking episodes processed on a stalled pass ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory-trigger.service.ts`
**Dependencies**: Task 10.1
**Spec Reference**: `batch-2-implementation.md` §6 (F1)

**Acceptance Criteria**:

- **`markProcessed(ids)` at `:744-745` inspects the signal from 10.1** and is **not** called when
  the pass stalled. This call site is the whole defect — everything else in this batch exists to
  let it make this one decision.
- Rows left unmarked stay `processed_at IS NULL`, so `drainForSession` returns them on the next
  pass. **The episodes survive the cooldown.**
- **The boot-scan watermark is not advanced by a stalled pass.** A stall must not look like
  progress to the scanner, or the rows are lost by a second route even with `markProcessed`
  correctly skipped.
- Reconcile with `episodes.reset` at **:696**, which has already fired by the time this decision
  is made. Either the reset is deferred past the stall check, or its effect is undone on the stall
  path — **state which and why in the implementation report.** Leaving the reset applied while
  skipping `markProcessed` is a half-fix and does not close F1.
- A **successful pass that genuinely found nothing keeps its current behaviour exactly** — marked
  processed, watermark advanced. This batch must not turn "found nothing" into an infinite retry;
  that would be F1 inverted.

**Validation Notes**:

- Three separate pieces of state advance on the resolve path — `markProcessed`, the
  `episodes.reset` at `:696`, and the watermark. F1 exists because only one of them was examined.
  Enumerate all three and decide each explicitly.

---

### Task 10.3: Pin the discriminator with a spec that fails if it is removed ⏸️ PENDING

**File**: specs under `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\`
**Dependencies**: Tasks 10.1, 10.2
**Spec Reference**: `batch-2-implementation.md` §6 (F1)

**Acceptance Criteria**:

- **A spec that proves rows survive a cooldown pass**: drive a pass with the provider cooling
  down, then assert the episodes are **still `processed_at IS NULL`** afterwards and are returned
  by a subsequent `drainForSession`.
- **The spec must FAIL if the discriminator is removed.** This is the acceptance criterion, not a
  nicety — revert 10.1/10.2 locally and confirm red before calling the task done.
- **An assertion that merely checks the extraction is empty is worthless here and does not
  satisfy this task.** The extraction is empty both before and after the fix; such a spec passes
  against the defect and proves nothing. The discriminating assertion is about the **rows'
  survival**, not the extraction's emptiness.
- Companion spec for the inverse: a **successful pass that found nothing** still marks processed
  and still advances the watermark. Without this, 10.2 could be "fixed" by never marking anything.
- Assert the watermark is unmoved after a stalled pass.

**Validation Notes**:

- Two discriminating specs minimum — stall-keeps-rows and empty-result-still-marks. Either one
  alone can be satisfied by a wrong implementation; together they pin the branch.

---

**Batch 10 Verification**:

- `npx nx test memory-curator` — and `npx nx run-many -t test -p auth-providers,skill-synthesis,agent-sdk`
  to confirm Batch 2's 1324 baseline is intact
- Revert-the-fix check: 10.3's specs go **red** with 10.1/10.2 backed out
- Manual, against the live condition: a cold start with an exhausted provider shows the same
  skip-pass WARN lines, but the episodes are **still pending** afterwards rather than consumed —
  the tight `findSessionsDirectory` → skip loop at `coldstart-306.log:1232-1260` should no longer
  drain the queue
- code-logic-reviewer approved

---

# Promote the disclosure to a boot-visible surface (task widened 2026-08-23)

**Source**: **O3**, recorded during the team-leader MODE 2 review of Batch 7 — the disclosure is
reachable only at Marketplace → Plugins, one click deep, on a page a user may never open. R2-A's
stated objective is "make the shortfall legible"; legible in exactly one unvisited place only
partly meets it.

## Settled decision — do NOT re-litigate

| #      | Decision                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U8** | **Promote the disclosure to a boot-visible surface**, and make Batch 9's consent dialog reachable directly from it — including from the boot WARN line Batch 6 added. Chosen by the user over keeping it at Marketplace → Plugins and over deferring. |

## Where "boot-visible" actually is — named, not left as a placeholder

The spec must name a component, so this was resolved against the code rather than assumed:

- **Harness health has no startup UI today.** `HarnessHealthBadgeComponent` mounts in exactly one
  place — `libs/frontend/marketplace/src/lib/plugins-surface.component.ts:70`
  (`<ptah-harness-health-badge />`) — and nowhere else in `libs` or `apps`. At startup the health
  report reaches only the **log**: Batch 6's reconciler WARN plus the host boot lines.
- **The boot-visible UI surface is the Dashboard home** — `libs/frontend/dashboard`, the
  card-driven home, whose grid is
  `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.ts` and
  which already hosts `analytics-card` and `builders-card`.
- **No polling is needed.** `harness:healthChanged`
  (`libs/shared/src/lib/types/messages/message-constants.ts:196`) is an existing edge-triggered
  push, and `harness:health` already exists as the pull. The card is a new consumer of a stream
  that already runs; **no RPC contract change**.

## Shape: a new batch, not folded into Batch 9 — and why

The user's answer implies one placement decision, but the work is not one surface:

|            | Batch 9 (consent dialog)            | This work                       |
| ---------- | ----------------------------------- | ------------------------------- |
| Lib        | `libs/frontend/marketplace`         | `libs/frontend/dashboard`       |
| Surface    | the popover the user already opened | the home the user lands on      |
| Depends on | Batch 8's RPC                       | nothing but Batch 7's component |

Folding would make Batch 9 own two libs and two unrelated placement questions, and would couple a
dialog that **cannot ship before Batch 8** to a card that can ship today. Kept separate so the
promotion is not held hostage by the repair.

The `dashboard → marketplace` import edge is new but **acyclic** — `marketplace` does not import
`dashboard`, and `dashboard` already imports five sibling frontend libs (`core`,
`memory-curator-ui`, `cron-scheduler-ui`, `messaging-gateway-ui`, `skill-synthesis-ui`). Verified
before writing this.

The boot-WARN entry point is **backend**, so it is Batch 12 rather than a task inside Batch 11 —
this file's rule is that backend and frontend never share a batch, and a one-line log string does
not earn an exception.

---

## Batch 11: Harness card on the Dashboard home ⏸️ PENDING

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: `cli_delegation` is disabled (`context.md:101`). One lib, three ordered tasks —
11.1 places the card, 11.2 wires the route into Batch 9, 11.3 pins both. Mostly reuse: the
disclosure component and the derivation both already exist and are already reviewed, so the risk
here is placement and reachability, not logic.
**Tasks**: 3 | **Dependencies**: Batch 7 (committed component). **Task 11.2's target requires
Batch 9**; see its criteria for the ordering escape.

### Task 11.1: Harness card in the dashboard grid ⏸️ PENDING

**File**: new component under
`D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\harness-card\`, mounted in
`D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\dashboard-grid\dashboard-grid.component.ts`
**Spec Reference**: decision **U8**; Batch 7 report O3

**Acceptance Criteria**:

- A harness card on the Dashboard home renders the blocked-paths disclosure, reusing
  **`HarnessBlockedPathsComponent`** and **`harnessBlockedPaths`** from the `marketplace` barrel.
  **Do not re-implement either.**
- **`blockedTargetPaths` from `@ptah-extension/shared` remains the single derivation.** A third
  surface must not become a third intersection — this is the F-A failure mode, caught before
  Batch 7 and verified closed in it. No `missing.filter(...)`, no `foreign.includes(...)`, no
  `new Set(missing)` anywhere in `libs/frontend/dashboard`.
- Driven by the existing `harness:healthChanged` push and/or `harness:health`. **No RPC contract
  change in the diff**; if the task appears to need one, stop and report.
- **Hidden entirely when the blocked set is empty**, like the popover disclosure. The home must
  not grow a permanent empty card.
- Consistent with the badge: undetected targets excluded, same count the popover and the boot WARN
  report. The three surfaces must never disagree on the number.
- `ChangeDetectionStrategy.OnPush`, signals + `inject()`, standalone. No `[innerHTML]` on any path.
- Additive to `dashboard-grid` — no layout rewrite of the existing cards.

---

### Task 11.2: Route from the card into the consent dialog ⏸️ PENDING

**File**: the Batch 11.1 card, plus whatever navigation seam the dashboard already uses
**Dependencies**: Task 11.1; **Batch 9** for the dialog itself
**Spec Reference**: decision **U8**

**Acceptance Criteria**:

- The card offers **one** explicit route to Batch 9's consent dialog. Reaching it must not require
  finding Marketplace → Plugins first.
- **The card itself still performs no repair and captures no consent** — it routes, and Batch 9's
  dialog remains the only place a claim of ownership is made. Every constraint from Task 9.1
  (per-path checkboxes, default none selected, quarantine destination named before consent)
  belongs to the dialog and is not duplicated or pre-answered here.
- **Ordering escape**: if Batch 9 has not landed, ship 11.1 alone and leave 11.2 pending rather
  than stubbing a dead control. A button that opens nothing is worse than no button.

---

### Task 11.3: Pin the promotion ⏸️ PENDING

**File**: specs alongside the Batch 11.1 card
**Dependencies**: Tasks 11.1, 11.2
**Spec Reference**: this task's standard — every batch ships a discriminating spec

**Acceptance Criteria**:

- **A discriminating spec that fails if the card is removed from the dashboard grid** — mount the
  home with a blocked-bearing health report and assert the disclosure is present and names the
  blocked paths. Mutation-check it red by removing the card from the grid.
- A spec asserting the card is **absent on a clean report**.
- A spec asserting the card's count **equals the popover's count** for the same report — the
  cross-surface agreement that the single-derivation rule exists to guarantee.
- **A spec asserting no second intersection**: the dashboard renders paths obtained via the shared
  function, so a naive `foreign` passthrough renders the wrong set and fails. Batch 7's mutation B
  is the model.
- Where 11.2 landed: a spec that the route reaches the dialog and that the card itself exposes no
  consent control.

---

**Batch 11 Verification**:

- `npx nx run-many -t test,lint -p dashboard,marketplace --skip-nx-cache`
- `npx nx build ptah-extension-webview` (`dashboard` is a non-buildable lib; the app is the gate)
- `grep -rnE "\.foreign|\.missing" libs/frontend/dashboard` shows no intersection
- `git diff` shows no change under `libs/shared`
- code-logic-reviewer approved

---

## Batch 12: The boot WARN names the surface ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: One task, kept out of Batch 11 only because it is backend and this file does not
mix. It is small enough to ride along with another backend batch — **if Batch 8 has not committed
when this is picked up, the orchestrator should fold it into that commit** rather than raise a
one-file commit of its own.
**Tasks**: 1 | **Dependencies**: Batch 6 (committed, `e1851b34a`); Batch 11.1 for the surface name

### Task 12.1: Point the boot WARN at the card ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
(`logBlocked` / its `action` field)
**Spec Reference**: decision **U8**

**Acceptance Criteria**:

- The blocked WARN's `action` names the **Dashboard harness card** as a route, alongside the
  existing CLI instruction. A log line cannot be clicked; naming the destination is the entry
  point.
- **The move-first wording survives intact.** It must still lead with "Move the occupant aside",
  still carry "may be your own work", and still never say "delete" — Batch 6's F-B fix is not to
  be undone by a rewrite. Re-assert this in the existing
  `harness-reconciler.blocked-logging.spec.ts` case rather than adding a parallel one.
- The `full`-only gate (Batch 6, m3) and the unchanged summary line both stay as they are.
- Consider the same pointer on the host boot lines
  (`apps/ptah-electron/src/activation/plugin-activation.ts`,
  `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:286-294`). **State a decision
  either way** — those two already disagree with each other per Batch 5's finding, and this is not
  the task that fixes that.

---

**Batch 12 Verification**:

- `npx nx test harness-sync` — the existing blocked-logging case updated, not duplicated
- The move-first / no-"delete" assertions still present and still passing
- code-logic-reviewer approved

---

## Follow-ups recorded from Batch 7 — NOT scheduled

**m1 — the delete-word ban covers only the literal "delete".** `harness-blocked-paths.spec.ts`
asserts `not.toContain('delete')` over the rendered section, so "remove", "erase", "trash" or
"rm" would pass. A narrow hole: the three positive assertions in the same case — the anchored
`/^Move the occupant aside/`, "may be your own work", and "read it before you discard anything" —
carry the weight, and a message satisfying all three is not destructive in framing. Recorded, not
worth a change.

**O2 — the disclosure card has no e2e coverage.** Checked during review: no e2e spec references
`harness-health-badge` or any sibling harness identifier, and
`apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts` contains no `harness` reference
at all. So a green e2e run genuinely means nothing moved — and equally, e2e would not catch the
card disappearing. Batch 11 adds a second uncovered surface. Worth a decision when someone next
touches the e2e marketplace suite.
