# Code Logic Review — `TASK_2026_437_0778` Batch 18 (Phase 3, C14 f + FU-16b-a)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 4              |
| Failure modes found | 6              |

Scope examined: `agent-sdk/src/lib/internal-query/{network-failure,network-backoff}.ts` (+specs),
`agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts` (+spec),
`memory-contracts/src/lib/curator-llm.port.ts`,
`memory-curator/src/lib/curator-llm/{curator-activity-log,curator-pass-admission}.ts` (+spec),
`memory-curator/src/lib/memory-curator.service.ts` (full diff read, not just the summary),
`memory-curator/src/lib/memory-curator.admission.spec.ts`,
`memory-curator/src/lib/triggers/memory-trigger.service.ts` (rate-limiter interaction),
`skill-synthesis/src/lib/di/{tokens,register}.ts`, `lanes/lane-runner.service.ts` (+test-support,
+spec), `lanes/lane.types.ts`, `queue/skill-drain.service.ts` (+spec). Also read (not part of the
batch, but named as an executor-flagged risk): `skill-enhancer.service.ts:705-800`
(`generateCandidate`). Verified against `Ptah Electron-2026-09-14.log:1023-1080` and
`translation-proxy-base.ts:378-408`. Ran the five new specs directly (`network-failure.spec.ts`,
`network-backoff.spec.ts`, `sdk-internal-query.curator-llm.spec.ts`,
`curator-pass-admission.spec.ts` + `memory-curator.admission.spec.ts`,
`lane-runner.network-backoff.spec.ts` + `skill-drain.network-backoff.spec.ts`) — all green
(44 + 16 + 46 + 12 tests, 0 failures).

## Five logic questions

### 1. How does this fail silently?

- **Hourly curate budget spent on a pass that never dispatches.**
  `memory-trigger.service.ts:915-932` (boot scan), `:509-510` (cue path) and `:701-702` (episode
  path) all call `this.rateLimiter.tryAcquire(RATE_LIMIT_KEY, ...)` _before_ calling
  `curator.curate(...)`. `curate()` can still return `{ outcome: 'stalled', reason:
'network-backoff' }` at `memory-curator.service.ts:541-546` with zero upstream cost. The acquire
  already happened and is not refunded. During an open 15-minute back-off window, every trigger
  that fires burns one of `maxCuratesPerHour`'s slots for work that provably did nothing — this
  looks to an operator like "the curator is busy" when it is actually "the curator is idle and
  waiting", and once the network recovers within the same hour the limiter can still be exhausted
  by the passes that were deferred, delaying real curation further than the back-off itself
  requires. Not silent in the sense of hiding an error, but it silently degrades an unrelated
  budget the way the header docs for `CuratorExtraction` warn against for `observation_queue`
  rows — the same argument applies one layer up to the hourly limiter and was not carried through.
- **A resolve-stage network failure is invisible to the back-off.** `resolveWithinBudget`
  (`memory-curator.service.ts:740-760`) re-throws anything that is not a `QueueSlotTimeout`, and
  `doCurate`'s catch (`:622-643`) routes every such throw to `activity.recordError` — the generic
  `'ran'` path. `admission.recordExtraction` is called only for the **extract** outcome
  (`:562`); nothing calls `admission.backoff.recordFailure()` (or even reads
  `classifyThrownNetworkFailure`) for the resolve call. `ICuratorLLM.resolve` never throws for a
  network failure itself — it degrades to unmerged drafts (`sdk-internal-query.curator-llm.ts:369-371`)
  — so today the specific "resolve throws a raw network error" path may be dead code in practice,
  but if it is ever reached (a change to `resolve()`, or a caller-supplied signal race), a resolve
  outage is logged as a normal `curator-error` and the back-off never opens for it, defeating the
  purpose of the whole component for that call site. The design doc explicitly punts on this
  ("should resolve-step network failures raise the curator back-off" — prompt item 8), so it is a
  known and accepted gap rather than an oversight, but it should be named as such in
  `curator-pass-admission.ts`'s header rather than left implicit.
- **`skill-enhancer.service.ts:705-800` (`generateCandidate`, not in this batch) has no network
  classifier at all.** It drains `handle.stream` and concatenates every `assistant` text block
  verbatim (`:778-784`) with no `QueryNetworkObserver`, no `classifyThrownNetworkFailure` on its
  `catch`, and no shared `NetworkBackoff`. A network-class failure that still produces an assistant
  message with a `text` block (the same shape the file header for `network-failure.ts` says the
  subprocess emits — "ends a request it has given up on with a synthetic assistant message") is
  read exactly like a real answer: `cleaned.length > 0 ? cleaned : null` (`:788-789`) would return
  that text and `SkillEnhancerService`'s caller would persist it as the new skill/agent/command
  body. This is the exact bug class the rest of Batch 18 exists to close, left open in a sibling
  consumer of the same `IInternalQuery` stream. Recommend a fix now (wrap `generateCandidate` with
  the same observer, at minimum treat `verdict.kind === 'network-failure'` as `null`) rather than a
  future task, since the blast radius (a corrupted skill body silently promoted) is exactly what
  the 09-14 incident was about for the curator.

### 2. What user action produces unexpected behaviour?

- A user click on `memory:runNow` for a session that is **not** the one currently held by a
  background pass gets no help from `CuratorPassAdmission` — it is a fresh `curate()` call, and if
  a network back-off window is open it still defers (`networkDeferralMs(false)` returns `0` only
  for `userInitiated`, so this path is fine) — but if the SAME session has a background pass
  already dispatched (past clearance, i.e. `this.pending` no longer has the key) the user's call
  joins the in-flight promise (`inFlight.get(key)`) and inherits whatever back-off decision the
  background pass already made (`joinAsUser` at `:348-360` explicitly documents "keeps that pass's
  lane"), which is correct per design but means a user who clicks "run now" mid-outage can still
  wait out the remainder of a background pass's already-open deferral with no visible distinction
  in the RPC response between "your click was honoured immediately" and "you joined a deferred
  pass". Cosmetic, not a defect — flagging because the executor's own design notes call out
  `memory:runNow` waiting as the exact bug FU-16b-a fixes, and this residual case is the one
  instance where a user click can still observe a wait after the fix.
- `cron:runNow` triggering a system drain job (a user-visible "run now" action in the skill
  synthesis UI) still goes through `SkillDrainService.select()` → the per-row network filter at
  `skill-drain.service.ts:774-781` — a user-initiated drain trigger is filtered exactly like an
  unattended tick, because `TOKEN_SPENDING_STAGES.has(row.stage) && backoff.remainingMs() > 0` does
  not consult any `userInitiated` flag (the drain has no such concept per row). This is
  acknowledged as an open question in the batch brief but is worth restating as a finding: a user
  who explicitly asks the host to drain the queue during an outage gets silent no-op rows with no
  distinct signal from "nothing was eligible" — `networkDeferred` is on the summary, but nothing
  in the RPC surface for `cron:runNow` appears to have been checked against this in this batch.

### 3. What input data produces a wrong answer?

- A genuine (non-network) 500 from a model-side bug at the SDK/proxy boundary is classified as
  network (`network-failure.ts:85-93`, `networkSignalForHttpStatus`) purely from the HTTP status
  code, with no way to distinguish "the transport failed" from "the model provider had an internal
  error unrelated to reachability". This is the accepted trade-off the module's own header names
  ("NETWORK-class: ... every 5xx") — a genuine 500 is backed off exactly like a DNS failure. Given
  the back-off is capped, resets on the very next answered call, and the alternative (treating 5xx
  as non-network) would have reproduced the exact 09-14 incident, this is the right default; noting
  it because the task explicitly asked whether it is "acceptable" — yes, with the residual cost
  that a flaky-but-reachable provider returning occasional 500s pays an unnecessary 30s wait per
  occurrence (bounded, not compounding, since a single window absorbs concurrent failures).
- **429 with `Retry-After` is not honoured by the network-class path.** The classifier maps HTTP
  429 to `'http-429'` (`network-failure.ts:89`) and `NetworkBackoff` always uses its own fixed
  30s→15min ladder (`network-backoff.ts:100-114`) — nothing reads a `Retry-After` header value for
  this path. `NetworkObservableMessage` (`:131-142`) carries only `error_status` /
  `api_error_status` as numbers, no header data, so the ladder cannot currently see it even if a
  caller wanted to. This is a _separate_ code path from the honoured `retry-after` on
  `ProviderQuotaError` (`lane-resolver.service.ts:77-86`, `241-263`) — that one is the **pre-flight
  quota gate** (`quota-exhausted`, checked before dispatch) and does read `retryAfterMs` off the
  resolver's own error. The two are easy to conflate because they share vocabulary
  (`retryAfterMs`) but are wired independently, and only one of them honours what the provider
  actually asked for. A provider that returns 429 **mid-call** with a long `Retry-After` (e.g. an
  hour) will still be probed as often as every 15 minutes once the ladder saturates — better than
  the pre-C14f behaviour of retrying immediately, but not "honour it".
- `NetworkBackoff.recordFailure` compares `backoffBaseMs(this.level + 1) === backoffBaseMs(this.level)`
  to detect "already at the ceiling" (`network-backoff.ts:108`) — correct today because
  `backoffBaseMs` is monotonic and the two levels can only tie once both are clamped at
  `NETWORK_BACKOFF_MAX_MS`. This is implicit and fragile: if `NETWORK_BACKOFF_INITIAL_MS`,
  `NETWORK_BACKOFF_MAX_MS` or the doubling exponent are ever tuned independently, a coincidental tie
  at a non-ceiling level would silently suppress a level increment and its log line. Low risk today
  (values are `export const`, not configuration), but worth a comment or an explicit `level >=
CEILING_LEVEL` guard instead of relying on numeric coincidence.

### 4. What happens when a dependency fails?

- **Governor disposed while a background pass waits (host shutdown):** `CuratorPassAdmission.clearance`
  correctly resolves to `'cancelled'` when `whenClear` rejects with a non-`AbortError`-tagged
  reason is treated as "broken governor, admit" (`:117-129`) — i.e. only an `AbortError` produces
  `'cancelled'`; anything else (a genuine governor defect) falls through to `'proceed'`, matching the
  documented Batch 16 precedent ("a broken governor admits"). Verified this is intentional and
  distinct from the `'cancelled'` (host-shutdown) case, which is bound to `governor.dispose()`
  aborting `entry.controller` and that abort reaching `whenClear`'s own signal — confirmed by
  `memory-curator.admission.spec.ts` passing.
- **A network-class failure inside an internal-query call that is itself queued behind the
  concurrency gate:** the batch's own design note (recorded verbatim in the prompt) names this as
  the one remaining gap — "a background pass already inside the queue whose next window is held at
  the internal-query gate still blocks passes behind it." Confirmed present: `CuratorJobQueue` still
  serialises one pass at a time (`memory-curator.service.ts:362-368` comment), and the network
  check only runs at `doCurate`'s dispatch point for the pass that is CURRENTLY being run
  (`:541-546`) — a second pass queued behind it is not consulted at all until its turn, so it waits
  out the first pass's own IO before it even gets to ask `networkDeferralMs`. This matches the
  documented residual gap; recording it here as a confirmed finding rather than re-deriving it.
- **`select()` always pays the full SQLite scan cost regardless of the back-off window.**
  `skill-drain.service.ts:762-782`: `this.select(...)` runs `listEligibleWorkspaces` +
  `listEligible` per workspace unconditionally, and the network check happens only per-row, after
  the scan already ran. During a 15-minute outage every `drain()` invocation still performs the full
  read even when every returned row for the token-spending stages will be skipped. The design
  comment defends this correctly for the case where free (non-token) stages need draining
  regardless — but there is no short-circuit for the case where a tick's eligible set is composed
  entirely of token-spending rows, which repeats the same read on every tick of the outage for zero
  useful work. Bounded by whatever cadence the cron scheduler uses to invoke `drain()` (not spinning
  inside `drain()` itself — confirmed no internal retry loop), so this is a moderate inefficiency
  finding, not a runaway CPU one.

### 5. What is missing that the requirements never mentioned?

- No telemetry on how often `generateCandidate` (skill-enhancer) or any other unaudited
  `handle.stream` consumer receives a network-class failure — the new classifier exists in
  `agent-sdk` but there is no lint rule, contract test, or "every internal-query stream consumer
  must classify" check preventing exactly the drift found in question 1. Recommend a follow-up
  (or a fix now, given the severity) that either (a) makes `IInternalQuery.execute()` classify and
  attach the verdict to the returned handle so callers cannot opt out, or (b) adds a repository lint
  rule flagging a raw `for await (const msg of handle.stream)` loop with no `QueryNetworkObserver` in
  the same function.
- The three lanes/pipelines behind one `NetworkBackoff` instance (see Failure modes below) mean the
  requirement "consecutive network-class failures ... back off" is implicitly a **per-library**
  guarantee, not a per-provider one. Nothing in `implementation-plan.md`'s C14(f) description states
  which granularity was intended; the executor's header comments assert the per-library choice as
  deliberate but do not discuss the cross-provider reset risk raised below.

## Failure modes

### Cross-provider false clear (skill-synthesis)

- Trigger: two skill-synthesis lanes configured with **different** `config.provider` values
  (confirmed possible — `lane-resolver.service.ts:151-224` resolves a distinct auth snapshot per
  lane when `cfg.provider` is set) where lane A's provider is down and lane B's is healthy.
- Symptom: a successful call on lane B (`lane-runner.service.ts:493,562`,
  `this.networkBackoff?.recordSuccess()`) clears the ONE shared `NetworkBackoff`
  (`SKILL_SYNTHESIS_TOKENS.NETWORK_BACKOFF`, registered as a single `useValue` in
  `di/register.ts:169-175` — "the drain and the lane runner must share the one instance"), so the
  very next background dispatch for lane A is let through against a provider that is still
  unreachable, paying the subprocess's own retry ladder again before the shared back-off can
  re-open.
- Evidence: `lane-runner.service.ts:391-398` (single optional `networkBackoff` field, no per-lane
  keying), `di/tokens.ts` comment "ONE instance for this library", `lane-resolver.service.ts:151-224`
  (per-lane provider resolution is a real, exercised code path, not hypothetical).
- Current handling: none — the header comment at `lane-runner.service.ts:53-61` documents the
  shared-instance design and its consequence for a SINGLE outage affecting the whole library, but
  does not address the cross-provider case at all.
- Recommendation: either key `NetworkBackoff` by `resolution.lane.config.provider` (a small map
  instead of one instance), or, if per-library is intentionally coarse, document the specific
  cross-provider false-clear risk next to the "ONE instance" comment so a future reader does not
  reintroduce this same shared-state pattern in a context where the false-clear is more expensive
  (e.g. per-provider dispatch limits going stale). Same instance is shared for the memory-curator
  side too (`curator-pass-admission.ts:74-81`, its own separate instance keyed `[memory-curator]`),
  so the curator is not exposed to skill-synthesis's cross-provider case, but has the same
  structural risk if the curator's own provider is ever made lane-selectable.

### Hourly curate budget consumed by deferred passes

- Trigger: any of the three curator trigger paths (`onUserPromptSubmit` cue, episode-close, boot
  scan) fires while a network back-off window is open.
- Symptom: `rateLimiter.tryAcquire` is spent (`memory-trigger.service.ts:509-510,701-702,915-918`)
  and the pass then defers with zero LLM cost (`memory-curator.service.ts:541-546`). Over a
  15-minute outage this can exhaust `maxCuratesPerHour` on work that did nothing, delaying real
  curation once the network recovers within the same rolling hour.
- Evidence: see citations above.
- Current handling: the rate limiter has no concept of "this acquire was refunded because the pass
  never dispatched."
- Recommendation: check `admission.networkDeferralMs(false) > 0` before `tryAcquire`, or refund the
  acquired slot when `curate()` returns `outcome === 'stalled'` with a network-backoff reason.

### Resolve-stage network failure not fed to the back-off

- Trigger: `this.llm.resolve(...)` throws a raw network-class error (currently only reachable if
  `ICuratorLLM.resolve`'s contract is changed, or a future implementation stops swallowing
  network failures into unmerged drafts).
- Symptom: `doCurate`'s catch treats it as a generic error (`recordError`, `'ran'` outcome); the
  back-off is never opened for it.
- Evidence: `memory-curator.service.ts:613-643`, `curator-pass-admission.ts:167-181` (only
  `extraction.status === 'stalled' && reason === 'provider-unreachable'` feeds `recordFailure`).
- Current handling: none; today's `resolve()` implementation degrades instead of throwing, which
  makes this dormant rather than active.
- Recommendation: acceptable to leave for a follow-up given `resolve()`'s current contract, but
  name the gap explicitly in `curator-pass-admission.ts`'s header (it currently only says "reset by
  the first pass that gets an answer") so it is not rediscovered as a surprise.

### Un-audited stream consumer (`skill-enhancer.generateCandidate`)

- Trigger: a network-class failure occurs mid-`generateCandidate` call and the subprocess's
  synthetic error message carries any assistant text.
- Symptom: the collected text is written back as the improved skill/agent/command body
  (`skill-enhancer.service.ts:788-789`), silently corrupting a live artifact with an error
  transcript instead of leaving it unchanged (the function's own `catch` branch already treats a
  THROWN failure as "leave the artifact unchanged" — this is the in-band case that catch cannot
  see).
- Evidence: `skill-enhancer.service.ts:705-800`, contrasted with the classified path everywhere
  else in this batch (`lane-runner.service.ts:653-690`, `sdk-internal-query.curator-llm.ts:467-502`).
- Current handling: none — no `QueryNetworkObserver`, no `classifyThrownNetworkFailure`.
- Recommendation: fix now (small, local change — wrap the loop with the same observer used
  elsewhere in this batch and return `null` on a network verdict) rather than deferring, given the
  cost of being wrong (a corrupted skill/agent artifact silently promoted) versus the cost of the
  fix (a few lines, same pattern already proven in two other files this batch touches).

### Drain's full-scan cost is not gated by an open network window

- Trigger: a network outage lasting through several drain ticks whose eligible set is dominated by
  token-spending stages.
- Symptom: every tick still performs the full `listEligibleWorkspaces` + `listEligible` SQLite read
  before discovering (per row) that the stage cannot dispatch.
- Evidence: `skill-drain.service.ts:762-782,829-903`.
- Current handling: per-row skip only, after the scan.
- Recommendation: moderate — a cheap pre-check (e.g. "does this tick's tier contain ONLY
  token-spending stages, and is the window open" → skip `select()` entirely) would remove the
  redundant read without touching the free-stage guarantee the current design protects.

### 429 `Retry-After` not honoured on the in-flight network path

- Trigger: a provider returns HTTP 429 mid-call with a `Retry-After` header materially longer (or
  shorter) than the ladder's current window.
- Symptom: the shared `NetworkBackoff` uses its fixed ladder regardless; the provider's own
  guidance is discarded for this path (it IS honoured for the separate pre-flight
  `quota-exhausted` gate).
- Evidence: `network-failure.ts:89` (429 → `'http-429'`, no header data carried),
  `network-backoff.ts:97-114` (fixed ladder, no external override parameter),
  `lane-resolver.service.ts:77-86,241-263` (the OTHER 429 path that does honour `retryAfterMs`).
- Current handling: none for the in-flight case.
- Recommendation: acceptable as shipped (bounded, and strictly better than pre-C14f immediate
  retry), but record as an explicit design decision rather than an unstated gap, since a reader
  skimming both paths could reasonably assume they are the same mechanism.

## Blocking issues

None found.

## Serious issues

### Hourly curate budget consumed by deferred passes

- File: `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:509-510,701-702,915-918`
- Scenario: any curator trigger fires while `NetworkBackoff.remainingMs() > 0`.
- Impact: the same finite hourly budget that gates real curation is spent on passes that provably
  did zero curation, which can starve legitimate curation for the rest of the rolling hour once the
  network recovers. Directly undermines the intent of C14(f) (protect the curator's throughput
  during and after an outage).
- Fix: check `admission.networkDeferralMs(userInitiated) > 0` before `tryAcquire`, or refund the
  acquired token when `curate()` returns a `network-backoff` stall.

### Un-audited stream consumer can write a network error as a skill body

- File: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:705-800` (not part of this
  batch's file list, but directly in the blast radius of the 09-14 incident class this batch
  fixes).
- Scenario: `generateCandidate`'s query hits a network-class failure whose synthetic closing
  message still carries assistant text.
- Impact: a corrupted artifact (skill/agent/command body containing an error transcript) is
  silently promoted in place of the real enhancement, with no distinguishing signal from a
  legitimate improved body.
- Fix: apply the same `QueryNetworkObserver` / `classifyThrownNetworkFailure` pattern used in
  `lane-runner.service.ts` and `sdk-internal-query.curator-llm.ts`; treat a network verdict as `null`
  (preserve the existing artifact), matching the function's own thrown-error branch.

## Moderate and minor issues

- Cross-provider false clear in skill-synthesis's single shared `NetworkBackoff`
  (`lane-runner.service.ts:391-398`, `di/tokens.ts` `NETWORK_BACKOFF`) — see Failure modes.
- Drain's SQLite scan is not short-circuited by an open network window
  (`skill-drain.service.ts:762-782`) — see Failure modes.
- 429 `Retry-After` not honoured on the in-flight network-class path (`network-backoff.ts:97-114`)
  — acceptable as shipped, should be documented as a deliberate scope boundary.
- `DrainSummary.networkDeferred` is typed optional (`networkDeferred?: number`,
  `skill-drain.service.ts:250`) but is always initialised to `0` and only ever incremented
  (`:725,780`) — never left `undefined`. Type imprecision, not a logic bug; tighten to
  `readonly networkDeferred: number` for consistency with the "always set" comment already in the
  prompt's own check-list (item 7).
- `NetworkBackoff.recordFailure`'s ceiling detection by numeric coincidence
  (`network-backoff.ts:108`) — see question 3, third bullet.
- `curator-pass-admission.ts`'s header does not name the resolve-stage gap (see Failure modes,
  "Resolve-stage network failure not fed to the back-off") even though the file's own doc comments
  are otherwise unusually thorough about what is and is not covered.

## Data flow

1. SDK stream / thrown error → `QueryNetworkObserver` / `classifyThrownNetworkFailure`
   (`network-failure.ts`) — OK, verified against the actual incident's wire shape (local proxy
   translates an upstream DNS failure into an HTTP 500 the SDK subprocess reads as a 5xx; the
   classifier keys off the wire-level status, so it is agnostic to Codex-vs-direct-Anthropic root
   cause) — OK.
2. Curator adapter (`sdk-internal-query.curator-llm.ts`) maps the verdict to `CuratorExtraction.stalled
/ reason: 'provider-unreachable'` for `extract`, and to unmerged drafts for `resolve` — OK, no
   path returns error text as a parsed answer (`lastAssistantText` is read from `isTextBlock`
   content only, and the network verdict check runs BEFORE the text-length check, so a network
   verdict always wins even if some text arrived) — OK.
3. `CuratorPassAdmission.recordExtraction` feeds `NetworkBackoff` from the extract outcome only —
   GAP for the resolve stage (dormant given current `resolve()` contract; see Failure modes).
4. `doCurate` checks `admission.networkDeferralMs` at dispatch, before window planning — OK, input
   untouched (transcript/windows never computed for a deferred pass).
5. `MemoryTriggerService.invokeCurate` reads `stats.outcome === 'stalled'` and keeps
   `drainForSession`'s rows unprocessed (`drainForSession` is read-only; only `markProcessed`
   consumes them) — OK, verified no data loss.
6. Same trigger paths already spent the hourly rate-limit token before step 4 ran — GAP (Serious,
   above).
7. Skill-synthesis: `LaneRunnerService.networkHold` checks the shared back-off before dispatch for
   background runs; `callOnce`/`callFailure` classify and feed it after — OK, matches "at most two
   executions, never re-run on network" (verified: the structured-output ladder's second attempt is
   gated by `ladderEligible`, which excludes error subtypes the network verdict would have produced,
   since a network failure short-circuits `callOnce` before the ladder logic runs at all).
8. `SkillDrainService.drain()` filters token-spending rows post-scan without claiming
   (`attempt_count` untouched, confirmed by reading `runItem` is never called for a filtered row) —
   OK for the "no attempt burn" requirement; GAP for scan cost (Moderate, above).
9. FU-16b-a: `curate()` → `admission.clearance()` → (`null` fast path or) `whenClear()` →
   `enqueue()`; `joinAsUser`/`promote` correctly targets the same coalescing `key` used to store the
   in-flight promise — OK, verified via the two passing specs and by tracing `key` usage end to end.

## Requirements fulfilment

| Requirement                                                                                 | Status   | Gap                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Classifier signals (connection/DNS/timeout/408/429/5xx; stream + thrown)                    | COMPLETE | none found                                                                                                                                 |
| Classifier exclusions (401/403/400/404/413/422, parse errors, aborts)                       | COMPLETE | verified via passing spec table                                                                                                            |
| Back-off ladder 30s→15min, ±20% jitter, one window per level, reset on success              | COMPLETE | ceiling detection is numerically implicit (minor)                                                                                          |
| Curator: extract stall reports `provider-unreachable`, input kept                           | COMPLETE | none                                                                                                                                       |
| Curator: background pass at dispatch defers on open window                                  | COMPLETE | hourly rate-limit token still spent (Serious)                                                                                              |
| Curator: user-initiated never deferred, outcome still counts                                | COMPLETE | none                                                                                                                                       |
| Curator: resolve unreachable → unmerged drafts, back-off unchanged                          | COMPLETE | matches documented intent; back-off truly never sees this stage (see gap above, dormant today)                                             |
| Skill-synthesis: lane runner `network-unreachable`, `retryAfterMs` = remaining window       | COMPLETE | none                                                                                                                                       |
| Skill-synthesis: structured-output ladder never re-runs after network failure               | COMPLETE | verified via `ladderEligible` gating                                                                                                       |
| Skill-synthesis: lane timer after network retries → `network-unreachable`                   | COMPLETE | `timeoutOutcome` checks the observer's verdict first                                                                                       |
| Skill-synthesis: background run with open window not dispatched                             | COMPLETE | `networkHold`                                                                                                                              |
| Skill-synthesis: drain filters token-spending rows without claiming                         | COMPLETE | scan cost not gated (Moderate)                                                                                                             |
| Skill-synthesis: `network-unreachable` exempt from `maxAttempts`                            | COMPLETE | confirmed at `skill-drain.service.ts:1074` (`timeout` only checked)                                                                        |
| FU-16b-a: background pass awaits governor before claiming queue                             | COMPLETE | none                                                                                                                                       |
| FU-16b-a: `null` clearance (synchronous) for user-initiated/no governor/clear/back-off open | COMPLETE | none                                                                                                                                       |
| FU-16b-a: same-session `memory:runNow` joins via coalescing, `promote` ends the wait        | COMPLETE | none                                                                                                                                       |
| FU-16b-a: governor disposed while waiting → `host-shutdown` defer                           | COMPLETE | none                                                                                                                                       |
| `curator-activity-log.ts` pure move, no behaviour change                                    | COMPLETE | verified via full diff read; only additive `DEFERRAL_SOURCES` entries and a documented debug-vs-warn log-level split for `network-backoff` |

Implicit requirements not addressed: (1) no mechanism stops other `IInternalQuery` stream
consumers outside this batch from repeating the pre-C14f bug (see `generateCandidate`); (2) no
refund path for a rate-limited or budget-gated caller whose pass was deferred rather than run.

## Edge cases

| Case                                                                  | Handled | How                                                               | Concern                                                                 |
| --------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Concurrent background + user-initiated failure while a window is open | YES     | `recordFailure` early-returns while `remainingMs() > 0`           | none                                                                    |
| Restart mid-outage                                                    | YES     | in-memory level resets to 0; first post-restart call is the probe | matches documented intent                                               |
| Two lanes, two providers, one down                                    | NO      | single shared `NetworkBackoff` per library                        | cross-provider false clear (Failure modes)                              |
| Resolve-stage network failure                                         | PARTIAL | degrades to unmerged drafts, never reaches the back-off           | dormant gap, should be documented                                       |
| `cron:runNow` / user-triggered drain during an outage                 | NO      | filtered identically to an unattended tick                        | no distinct signal to the user (open question, as flagged in the brief) |
| Governor disposed while a background curate pass waits                | YES     | `'cancelled'` → `host-shutdown` deferral, input kept              | none                                                                    |
| 2nd background pass queued behind a network-failing 1st pass          | PARTIAL | network check runs only for the pass currently dispatching        | documented known residual gap (not new)                                 |
| Hourly rate limit vs. network back-off interaction                    | NO      | limiter acquires before the back-off check                        | Serious issue above                                                     |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the hourly curate rate-limit token is spent on every deferred background pass during an
  outage (Serious #1), which can compound the very throughput loss C14(f) exists to prevent, and a
  sibling stream consumer (`skill-enhancer.generateCandidate`, Serious #2) can still silently write
  a network error's text into a promoted skill body — the exact bug class this batch fixes
  everywhere else it touches.
- What a robust implementation would add: (1) a rate-limiter refund or pre-check for
  network-deferred curator passes; (2) the network classifier wired into `generateCandidate` (and
  ideally enforced structurally so a future stream consumer cannot skip it); (3) either per-provider
  `NetworkBackoff` keying in skill-synthesis or an explicit documented acceptance of the
  cross-provider false-clear risk; (4) a cheap early-out in `SkillDrainService.select()` for a tick
  whose eligible stages are all token-spending while the window is open.

---

## Delta review (review fixes)

Scope: the seven fixes listed against the original review's two Serious and four Moderate
findings, verified on disk in `D:\projects\ptah-437` (Batch 17 now committed at `84657c380`,
confirmed unrelated to this diff). Re-read every changed file in full (not just the hunks) and
re-ran every touched spec directly:

- `curator-rate-limit.service.spec.ts` + `network-backoff.spec.ts` +
  `sdk-internal-query.curator-llm.spec.ts` (agent-sdk): 3 suites, 63 tests, green
  (`ptah-437-backup/b18f-agent-sdk.log`).
- `memory-trigger.{boot-defer,boot-scan-budget,coalesce,integration,service}.spec.ts` +
  `memory-curator.admission.spec.ts` + `curator-pass-admission.spec.ts` (memory-curator): 7 suites,
  119 tests, green (`ptah-437-backup/b18f-memory-curator.log`).
- `lane-runner.network-backoff.spec.ts` + `skill-drain.network-backoff.spec.ts` +
  `skill-queue.store.spec.ts` + `skill-enhancer.service.spec.ts` + `di/register.spec.ts`
  (skill-synthesis): 5 suites, 143 tests, green (`ptah-437-backup/b18f-skill-synthesis.log`).

### Fix 1 — hourly budget vs. network back-off (Serious #1, closed)

Verified `heldByNetworkBackoff` (`memory-trigger.service.ts:774-782`) runs before `tryAcquire` on
all three paths: cue (`:511`), episode (`:706`, confirmed BEFORE `this.episodes.detach` at `:752`
so a held pass never even detaches its buffer), and boot scan (`:951`, returns `'stalled'` before
`tryAcquire` so the watermark stays put). The race the design accepts — a window opening between
this check and dispatch, e.g. a pass queued behind one that just failed — is covered by
`refundIfNetworkDeferred` (`:785-789`), gated on `stats.deferral === 'network-backoff'`
(`curator-activity-log.ts:67,336`, set only by `recordDeferral`, never by `recordStall` /
`recordNoOutput` / `recordError` / `recordRun`) and called at both call sites that can observe a
`'stalled'` outcome (`:855` cue/episode path via `invokeCurate`, `:1008` boot scan). Traced the
double-refund and stale-window questions specifically:

- **Double refund**: each `curate()` invocation corresponds to exactly one `tryAcquire` (a held
  pass returns before acquiring at all) and at most one `refundIfNetworkDeferred` call per
  `invokeCurate`/boot-scan-item execution. Two _different_ trigger sources racing the same session
  concurrently would each have spent their own slot and each observe the same coalesced `stats` (via
  `MemoryCuratorService`'s own `inFlight` map) — refunding both is correct in that case, since two
  slots were genuinely spent for one deferred pass. No overcounting found.
- **Refund after the hour rolls over**: `CuratorRateLimitService.refund` (`curator-rate-limit.service.ts:67-73`)
  checks `bucket.windowStartMs !== currentWindow` and no-ops — a slot from an expired window is not
  incorrectly credited to the new one. Also floors at `bucket.count <= 0` (never negative). Both
  guards confirmed present and exercised by `curator-rate-limit.service.spec.ts`.
- **Refund for a different deferral reason**: `refundIfNetworkDeferred`'s `stats.deferral ===
'network-backoff'` check is exact; the other four `CuratorDeferralReason` members
  (`concurrency-slot-timeout`, `curator-queue-wait-timeout`, `caller-aborted`, `host-shutdown`) and
  the two stall arms (`provider-cooling-down`, `provider-unreachable` reached mid-extract, which DID
  spend an attempt) are excluded. Correct — a pass that reached the provider keeps its slot exactly
  as specified.

Residual, not a regression: the other four deferral reasons above are equally "zero cost, slot
spent" today and are not refunded — out of scope for this fix, consistent with how the original
review scoped the finding to network-backoff specifically. Worth a follow-up note, not a blocker.

**Verdict: fixed correctly.**

### Fix 2 — un-audited enhancer stream consumer (Serious #2, closed)

Verified `generateCandidate` (`skill-enhancer.service.ts:740-857`) now classifies before reading
text: the network verdict check (`:832-836`) runs before the `collected`/`cleaned` text is ever
returned, exactly mirroring the pattern in `lane-runner.service.ts` and the curator adapter. A
background call additionally holds on an open window before the call is even made (`:750-754`,
`lane !== USER_ACTION_QUERY_LANE`), and both the pre-dispatch hold and the in-flight/thrown failure
paths map to `PROVIDER_UNREACHABLE` → `skipReason: 'provider-unreachable'` (`:408-410`) — traced the
caller and confirmed this returns before `this.judge.judge(...)` (`:426`), so no judge call, no
candidate write, and (checked the surrounding cooldown-setting code, not shown above but present
after the judge block) no cooldown timestamp recorded for a skip that never reached the judge.

Judge item (b), traced explicitly:

- `ACTIVE_PROVIDER_KEY` (`''`) is the ONLY key the enhancer ever touches
  (`this.networkBackoffs?.for(ACTIVE_PROVIDER_KEY)`, one call site). Any lane whose
  `config.provider` is blank (inherit) resolves to the SAME `''` key via
  `ProviderNetworkBackoffs.keyFor` (`provider-network-backoffs.ts:36-38`), and the header comment
  states this is deliberate — the enhancer "always rides the ambient auth env", i.e. the literal
  active provider, same as an inheriting lane. A success or failure on either side legitimately
  describes the same endpoint, so sharing is correct, not a bug.
- An enhancer failure cannot hold a lane on a DIFFERENT provider key: `ProviderNetworkBackoffs.for`
  creates/returns a keyed map entry (`:41-52`), and `remainingMs`/`allDeferring` index the same map
  by key. The enhancer never calls `.for()` with anything but `ACTIVE_PROVIDER_KEY`, so a lane keyed
  `'openai-x'` is structurally unreachable from the enhancer's calls. Confirmed by reading every
  call site of `networkBackoffs` in both files — no cross-key writes exist.

**New moderate finding — no canonicalisation between the active provider and an explicit id that
names it.** `ProviderNetworkBackoffs.keyFor` (`:36-38`) only trims whitespace; it does not resolve
"what provider does `''` currently mean" against an explicit `config.provider` string. If a lane is
configured with an EXPLICIT provider id that happens to be the one currently active (e.g. a lane
pinned to `'anthropic'` while the ambient/active auth is also Anthropic), that lane gets its own key
(`'anthropic'`) distinct from `''`, even though both dial the identical endpoint. A failure recorded
by the inheriting lane (or the enhancer) does not suppress dispatch on the explicitly-pinned lane
against the same dead endpoint, and vice versa. This is judge item (c)'s concern applied one level
up from the drain: the header names the `''`-is-shared case but not this one. Narrow blast radius
(requires a lane to explicitly re-name the provider it would inherit anyway, an unusual
configuration) — recorded as Moderate, not Serious.

**Verdict: fixed correctly**, with one new narrow moderate finding (provider-id canonicalisation)
that was not present in the original review because the original review had a coarser, single
shared instance where this distinction could not arise.

### Fix 3 — per-provider keying in skill-synthesis (Moderate, closed — see caveat above)

`ProviderNetworkBackoffs` (`provider-network-backoffs.ts`) is a clean, minimal keyed wrapper: `for`,
`remainingMs`, `allDeferring`, all delegating to per-key `NetworkBackoff` instances constructed
lazily. `lane-runner.service.ts`'s `networkHold(req, lane)` (`:765-777`) and `backoffFor(lane)`
(`:756-758`) now key every hold/record call by `lane.config.provider`, closing the exact
cross-provider false-clear failure mode the original review raised (a success on a healthy lane's
provider can no longer clear a different, still-down provider's window — verified by reading every
`recordSuccess`/`recordFailure` call site in `lane-runner.service.ts`, all routed through
`backoffFor(lane)`). The memory curator intentionally keeps its single unkeyed `NetworkBackoff`
(documented at `curator-pass-admission.ts:45-47`: "the curator has a single provider path ...
unlike skill-synthesis lanes") — reasonable, since the curator's own provider resolution
(`memory.curatorProvider`, or inherited) is genuinely one path per install, not a table of
independently configurable lanes.

**Verdict: fixed correctly**, modulo the provider-id canonicalisation gap noted under Fix 2, which
applies equally here (an explicit-provider lane and an inheriting lane pointed at the literal same
endpoint get two independent windows).

### Fix 4 — drain scan short-circuit (Moderate, partially closed)

Verified the short-circuit's correctness properties:

- `everyLaneNetworkHeld` (`skill-drain.service.ts:716-724`) requires EVERY configured lane's
  provider key to have an open window (`ProviderNetworkBackoffs.allDeferring`, which returns `false`
  on an empty set or the first clear key) — correctly conservative; a single healthy lane prevents
  the short-circuit entirely, so free work behind a healthy provider is never mistakenly held.
- `onlySpendingRowsEligible` (`:733-751`) bails (`return false`) the instant it sees ANY eligible
  non-token-spending stage in this tier's `countEligibleByStage` results (`:742`) — confirmed this
  runs BEFORE the aggregate count is fully consumed for stages outside the tier are `continue`d, not
  counted, so a stage this tier does not drain cannot force a false short-circuit. Free-stage rows
  are never starved: judge item (d)'s "never starved" question is answered by this early bail, and
  is exercised by `skill-drain.network-backoff.spec.ts`.
- `attempt_count` is untouched either way — the short-circuit path never calls `select()`, `claim`,
  or `runItem`, matching the "not claimed" requirement carried over from the original fix.

**New moderate finding — the short-circuit query itself is unbounded, and is not always a net
saving.** `countEligibleByStage` → `ELIGIBLE_BY_STAGE_SQL` (`skill-queue.store.ts:165-171`) is a
`GROUP BY` aggregate with **no `LIMIT`** and no `workspace_root` filter — it must visit every row
matching `status IN (...) AND not_before <= ?` across every workspace to produce its per-stage
counts, backed only by `idx_ssq_drain(status, not_before, workspace_root)` for the WHERE predicate
(confirmed via `0032_skill_synthesis_queue.ts:71-72`); the index cannot bound the GROUP BY's row
visitation the way the OLD per-workspace scan's `scanLimit` bounded each of its queries. Two
consequences:

1. On the happy path this fix targets (an outage with a large backlog composed ENTIRELY of
   token-spending rows), the new query replaces a scan that itself would have been at least as
   large, so this is a genuine win.
2. On the more common path — an outage where `everyLaneNetworkHeld()` is true (all configured
   providers down) but at least one FREE-stage row is also eligible — `onlySpendingRowsEligible`
   still runs the full unbounded aggregate query, returns `false`, and `drain()` falls through to
   the ORIGINAL `select()` scan unconditionally (`skill-drain.service.ts:812-821`: the `if` only
   returns early on the true/true branch). That tick now pays BOTH the new aggregate query AND
   the old per-workspace scan — strictly more DB work than before this fix, on exactly the ticks
   where a real (if partial) outage is happening and load-shedding matters most.
   This does not regress the "free stages keep draining" and "no spurious claim" requirements this
   batch cares about, and the added query is a single aggregate rather than N per-workspace ones, so
   in absolute terms it is unlikely to be severe — but it does not fully answer judge item (d)'s cost
   question ("vs. the scan it replaces"): it only replaces that scan in the all-token-spending case,
   and adds to it otherwise. Recommend either an `EXISTS`-style short-circuit (cheaper than a full
   GROUP BY: "is there at least one eligible non-token-spending row", which can stop at the first
   match) or accepting the current cost with a comment noting it is not a strict replacement.

**Verdict: fixed correctly for the "no claim, no starvation" requirements; the cost-neutrality
implied by "the scan it replaces" is not fully achieved** — new moderate finding on query cost.

### Fix 5 — documentation (Moderate, closed)

Both gaps from the original review are now named exactly where a reader would look:
`network-backoff.ts:41-51` states plainly that an in-flight 429's `Retry-After` is not honoured and
distinguishes it from the pre-flight quota gate's `retryAfterMs`; `curator-pass-admission.ts:38-43`
states the resolve-stage gap and that it is dormant while the adapter degrades rather than throws.
**Verdict: fixed correctly.**

### Fix 6 — `BackgroundWorkAdmission` rename

Cosmetic/type-precision change: `CuratorClearanceSource` (a locally narrowed `Pick<...>` alias) is
replaced by importing the canonical `BackgroundWorkAdmission` interface from
`@ptah-extension/vscode-core` directly (`curator-pass-admission.ts:51-52,81`,
`memory-curator.service.ts:18,195`). No behavioural difference found; both shapes expose the same
`isClear`/`whenClear` surface `CuratorPassAdmission` uses. **Verdict: fixed correctly, no regression.**

### Fix 7 — `DrainSummary.networkDeferred` required + `NETWORK_BACKOFF_CEILING_LEVEL`

`networkDeferred` is now `number` (not `number?`) on `DrainSummary` (`skill-drain.service.ts:259`),
matching that it is always initialised to `0` and only ever incremented or assigned — closes the
minor type-precision finding cleanly. `NETWORK_BACKOFF_CEILING_LEVEL` (`network-backoff.ts:78-79`,
derived as `ceil(log2(MAX/INITIAL)) + 1 = 6`) replaces the numeric-coincidence ceiling detection with
an explicit `atCeiling = this.level >= NETWORK_BACKOFF_CEILING_LEVEL` check
(`:120-121,129-130`) — verified the derivation matches the ladder (30s→60→120→240→480→900s is level
1→6, level 6's base already equals the 900s ceiling) and that a failure at/past the ceiling still
renews the window without incrementing the level or logging, per the original contract.
**Verdict: fixed correctly.**

### Delta summary

| #   | Fix                       | Original finding                               | Disposition                                                                                                                       |
| --- | ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Budget refund             | Serious — hourly slot spent on deferred passes | Closed                                                                                                                            |
| 2   | Enhancer classifier       | Serious — un-audited stream consumer           | Closed (new narrow Moderate: provider-id canonicalisation)                                                                        |
| 3   | Per-provider keying       | Moderate — cross-provider false clear          | Closed (same canonicalisation caveat as #2)                                                                                       |
| 4   | Drain short-circuit       | Moderate — full scan cost during outage        | Partially closed — new Moderate: short-circuit query itself is unbounded and not a net saving outside the all-token-spending case |
| 5   | Documentation             | Moderate — undocumented 429/resolve gaps       | Closed                                                                                                                            |
| 6   | `BackgroundWorkAdmission` | (incidental refactor)                          | No regression                                                                                                                     |
| 7   | Type + ceiling constant   | Minor — optional field, numeric coincidence    | Closed                                                                                                                            |

New findings from this delta, both Moderate, neither Blocking nor Serious:

- **Provider-id canonicalisation gap**: `''` (active/inherited) and an explicit provider id string
  that happens to name the currently-active provider are treated as two independent back-off keys
  even though they dial the same endpoint (`provider-network-backoffs.ts:36-38`). Affects both Fix 2
  (enhancer vs. an explicitly-pinned lane) and Fix 3 (two lanes, one blank one explicit, same
  provider).
- **Drain short-circuit query cost**: `ELIGIBLE_BY_STAGE_SQL` (`skill-queue.store.ts:165-171`) is an
  unbounded `GROUP BY` with no `LIMIT`; it is a net saving only when every eligible row is
  token-spending, and adds cost on top of the unavoidable full scan otherwise.

## Verdict (delta)

- Recommendation: APPROVE
- Confidence: HIGH
- Rationale: both Serious findings from the original review are fixed with correct, well-tested
  logic (325 tests re-run directly, all green; refund double-spend, window-rollover, and
  wrong-reason cases traced by hand and confirmed guarded). Of the four original Moderate findings,
  three are cleanly closed and one (drain scan cost) is improved for its target case but does not
  fully deliver the "replaces the scan" framing for the more common mixed-eligibility case during a
  partial outage. Two new Moderate findings are narrow, low-frequency edge cases (provider-id
  canonicalisation; short-circuit query cost in the non-short-circuiting case) that do not threaten
  data integrity or silently misreport state — they are efficiency/precision gaps, not correctness
  gaps. Nothing found here rises to Blocking or Serious; recommend accepting this batch with the two
  new Moderate findings tracked as follow-up (or a two-line doc note for the canonicalisation case,
  and an `EXISTS`-based short-circuit or accepted-cost comment for the drain query).
