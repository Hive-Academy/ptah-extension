# Development Tasks - TASK_2026_306

**Total Tasks**: 18 | **Batches**: 5 | **Status**: 3/5 complete
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
| R5  | **Defect F's 13 missing files have no known cause yet.** The denominator mismatch IS root-caused (see below) but that is a _reporting_ bug and does not explain `missing:13`. `writeFailed:0` rules out permissions; identical counts across both passes rule out a cold cache                                                                                                                                                                                                                                             | **MEDIUM**                                 | Task 5.1 is a diagnosis task with an explicit "report back before fixing" instruction. **Batch 5 may grow once 5.1 lands**                                                                    |
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
- [ ] A host with zero `claude` target in `health.targets` → Task 5.2 must not print `0/0` as if it were a healthy pass

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

## Batch 2: Provider quota gate (Defect B) ⏸️ PENDING

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

### Task 4.4: Silence the predictable offline write via `ITaskIndexStore.isReady()` ⏸️ PENDING

**Closes**: the one Batch 4 acceptance criterion left unmet.
**Size**: ~4 files, ~15 lines + specs. Verified small during Batch 4 review.

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

## Batch 4 (original spec) ✅ COMPLETE

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

## Batch 5: `harness-sync` — 13 unclosed gaps and a mis-scoped summary (Defect F) ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: One lib plus its Electron reporting seam. **This batch may grow.** Task 5.1 is a
diagnosis, not a fix — the 13 missing files have no known cause, and the remedy cannot be
specified until it is found.
**Tasks**: 3 (+N pending 5.1) | **Dependencies**: None

### ⚠️ Batch 5 may expand

The orchestration brief flagged F as expandable and that is correct, but the _reporting_ half is
now root-caused (see Correction 2) and is fixed by Tasks 5.2/5.3. What remains genuinely
unknown is why 13 manifest-expected files are produced by neither source on either pass.
**Task 5.1 must report back before any fix is written for it.** Expect this batch to gain
1–3 tasks at that point.

### Task 5.1: Root-cause the 13 missing files (DIAGNOSIS — report before fixing) ⏸️ PENDING

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

### Task 5.2: The Electron summary reports a per-target slice as if it were the whole ⏸️ PENDING

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

### Task 5.3: Make the reconciler's own summary state its scope ⏸️ PENDING

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

- Task 5.1 has produced a written root cause naming the 13 files and why neither pass produces
  them, plus a proposed remedy — **returned to the orchestrator before implementation**.
- The Electron line and the reconciler warn are reconcilable by a reader without reading source.
- No host reports `0/0` as a healthy pass.
- Counters themselves unchanged, so a re-run is comparable against `tmp/logs/log.log`.

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
