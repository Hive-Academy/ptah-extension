# Code Logic Review — `TASK_2026_463_f13d` Batch 1

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score        | 8/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                      |
| Serious issues        | 0                                      |
| Moderate issues       | 1                                      |
| Failure modes found   | 2 (both pre-existing, unchanged by this batch, verified not regressed) |

Scope reviewed: `git diff` of Batch 1's nine files (`internal-query-concurrency-gate.ts`/`.spec.ts`,
`internal-query.service.ts`/`.spec.ts`, `file-settings-keys.ts`/`.spec.ts`,
`internal-query-queue-timeout.error.ts`, `agent-sdk/CLAUDE.md`, `curator-job-queue.ts`), full files
read, not only the diff hunks. Cross-checked against `implementation-plan.md` Component 2 (D2),
`batches.md` Batch 1, and TASK_2026_437 `handoff.md`/`batches.md` FU-16b-c origin (the option chosen —
raise global to 3, cap background at `limit − 1` — matches `S437/batches.md:1155` option 1).

## Five logic questions

### 1. How does this fail silently?

- No new silent-failure path was found. `backgroundLimit`, `inFlightInBackground` and the new
  `admissible()` term are pure/derived — `inFlightInBackground` is summed fresh from `activeByLane`
  on every read (`internal-query-concurrency-gate.ts:295-302`), so there is no separate counter that
  can drift from the real slot state the way a cached value could.
- The one place a silent misclassification could occur is a background caller that omits its lane
  and lands on `'default'`, which is fail-open by design and explicitly documented as a hazard
  (`internal-query-concurrency-gate.ts:45-55`, CLAUDE.md `agent-sdk/CLAUDE.md:88`: "A background
  caller must name its lane; omitting it silently uses `default`, bypassing both policies"). This is
  pre-existing behaviour (TASK_2026_437 C14), not introduced by Batch 1, and I found no caller in
  `memory-curator` or `skill-synthesis` that fails to pass its lane (`curator-pass-admission.ts:118`,
  `lane-runner.service.ts:476`, `skill-enhancer.service.ts:406` all set it explicitly).

### 2. What user action produces unexpected behaviour?

- A user who sets `internalQuery.maxConcurrent: 2` gets `backgroundLimit(2) === 1`, silently
  re-serialising `memory-curator` and `skill-synthesis` into each other — the exact TASK_2026_352
  shape this task partially fixes. This is a **known, accepted, and documented** residual
  (`internal-query-concurrency-gate.ts:88-92`, `agent-sdk/CLAUDE.md:88`, batches.md A-D2-1), not a
  defect, but it is worth flagging that nothing in the settings UI or a runtime log tells such a user
  this happened — the debug log line only fires from the gate's internal wait path, not from a
  settings write. Out of Batch 1's scope (no settings-UI validation task assigned here); noted as a
  moderate finding below.
- A `default`/`user-action` call queued behind a wizard call that already holds the one reserved
  slot still waits — this is the accepted "shared foreground residual" (implementation-plan.md D2,
  :111-115) and is documented at `internal-query-concurrency-gate.ts:218-224` and in `CLAUDE.md`.
  Correctly implemented, not a defect.

### 3. What input data produces a wrong answer?

- `backgroundLimit` is only ever called with `this.limit`/`limit`, both already normalized through
  `normalizeLimit` (finite, `>= 1`, floored) before being stored (`internal-query-concurrency-gate.ts:326-330`,
  `internal-query.service.ts:268-278`). A non-finite or sub-1 value cannot reach `backgroundLimit`,
  so there is no wrong-answer input path through the settings boundary.
- Verified the `backgroundLimit` table directly: `1→1, 2→1, 3→2, 5→4` — matches the pinned
  `it.each` test (`internal-query-concurrency-gate.spec.ts:288-295`) and the stated formula
  `limit >= 2 ? limit - 1 : 1`.

### 4. What happens when a dependency fails?

- Governor `null`/absent: `isGoverned` returns `false` for every lane
  (`internal-query-concurrency-gate.ts:281-283`), so the background-slot cap still applies
  independently of the governor (verified by reading `admissible()`, which has no governor
  dependency) — background pipelines are still capped even with no governor wired, and the existing
  `agent.internal-query.ungoverned` degradation still fires once (`internal-query.service.ts:202-217`,
  unchanged).
- Governor disposed mid-wait: `handleGovernorDisposed` rejects every gated queued waiter with
  `AbortError` (`internal-query-concurrency-gate.ts:452-458`), independent of the background cap —
  correctly orthogonal, the new term does not need its own disposal handling because it never holds a
  timer or listener (per the "no new counter, map, timer, or listener" acceptance criterion, verified
  by reading the diff: only a getter and a boolean predicate term were added).
- Abort/throw during a held slot: `holdSlotUntilDone`'s `finally` always calls `release()` on
  generator exit including `break`, and `abort()`/`close()` call `release()` in a `finally` after
  `handle.abort()`/`handle.close()` (`internal-query.service.ts:224-251`, unchanged by this batch) —
  `activeByLane` cannot leak a background slot on an abort or a thrown error, since `makeRelease`
  is called unconditionally on every exit path. Traced this specifically because a leaked background
  slot would permanently under-count `inFlightInBackground` and let an extra background caller in
  forever — did not find such a path.

### 5. What is missing that the requirements never mentioned?

- No log or degradation signal exists for "a user configured `maxConcurrent: 2` (or `1`) and is now
  running with a reduced/zero effective background allowance" — the residual is documented in code
  comments and `CLAUDE.md` but is invisible at runtime to someone who set the value without reading
  either. Given the batch's explicit acceptance of A-D2-1, this is intentional scope, not an
  oversight, so it is listed as a moderate/optional improvement rather than a gap against the stated
  requirements.
- The service test that pins `blockedBy: 'background'` aborts the capped call to resolve the promise
  (`internal-query.service.spec.ts` new test, `abortController.abort()`); it does not also assert the
  capped waiter is later admitted once a background slot frees at the *service* level (the gate spec
  covers this at the gate level, which is the right layer — the service test purpose is the log
  field, and duplicating full admission proof there would be redundant, not a gap).

## Failure modes

### Background cap silently re-serialises pipelines at `maxConcurrent = 2`

- Trigger: user (or a settings default someone forgets to change) sets `internalQuery.maxConcurrent`
  to `2`.
- Symptom: `memory-curator` and `skill-synthesis` calls queue behind each other again, exactly the
  TASK_2026_352 symptom this task set out to prevent, with no runtime signal beyond the existing
  `blockedBy: 'background'` debug log (which most users never see).
- Evidence: `internal-query-concurrency-gate.ts:84-95` (`backgroundLimit`), `agent-sdk/CLAUDE.md:88`.
- Current handling: documented in three places (constant doc, class doc, `CLAUDE.md`) and pinned by
  `it.each` test row `[2, 1]`. Accepted explicitly as A-D2-1 in `batches.md`.
- Recommendation: none required for this batch — this is a stated, reviewed, and accepted design
  trade-off, not an implementation defect. A future task could add a one-time degradation report the
  first time `backgroundLimit(limit) === 1` binds with `limit >= 2`, mirroring the existing
  `agent.internal-query.ungoverned` pattern, to make the residual observable rather than only
  documented.

### Fail-open background classification depends entirely on `GOVERNED_BACKGROUND_LANES` staying in sync with callers

- Trigger: a future background pipeline is added to the codebase and its author forgets to add its
  lane string to `GOVERNED_BACKGROUND_LANES`.
- Symptom: that pipeline both escapes the governor (pre-existing risk, TASK_2026_437) AND now also
  escapes the new slot cap, and can take every internal-query slot including the one reserved for
  foreground work — reintroducing the exact symptom class FU-16b-c fixes, for the new caller only.
- Evidence: `internal-query-concurrency-gate.ts:45-55` doc block, updated by this batch to say the
  set "also drives the slot cap" — correctly extends the existing warning rather than leaving it
  stale.
- Current handling: this is the same allow-list `GOVERNED_BACKGROUND_LANES` the governor already
  used, so the risk surface is not new — this batch reuses the single source of truth rather than
  inventing a second list, which is the right containment. The doc comment is the only guard, same
  as before.
- Recommendation: none required for this batch (out of scope — no new caller is added here); noting
  it because it is the one structural way a future PR could silently defeat this fix.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — No runtime observability for the accepted `maxConcurrent <= 2` background
  re-serialisation residual beyond the per-wait debug log (`internal-query.service.ts:162-187`,
  `agent-sdk/CLAUDE.md:88`). See failure mode above. Not a blocker for this batch since the
  trade-off was made and recorded by the team-leader/user, but worth a follow-up ticket.
- **Minor** — `curator-pass-admission.ts:59` and `lane-runner.service.ts:198` each hard-code the lane
  string literal (`'memory-curator'` / `'skill-synthesis'`) rather than importing
  `MEMORY_CURATOR_QUERY_LANE`/`SKILL_SYNTHESIS_QUERY_LANE` from the gate module. Pre-existing (not
  touched by this batch), but it is exactly the kind of near-miss the lane-trim/lowercase rule and
  `GOVERNED_BACKGROUND_LANES` allow-list exist to defend against; a rename of either constant would
  not be caught by the compiler at either call site. Out of Batch 1's file list, so not a finding
  against this batch's diff, flagged for awareness only.

## Data flow

1. Caller → `InternalQueryService.execute` → `acquireSlot` — reads `limit`/`perLaneLimit` fresh via
   `readLimit` (validated, `>= 1`, finite) on every call. OK.
2. `acquireSlot` computes `backgroundInFlight`/`backgroundCapped` synchronously from
   `gate.inFlightInBackground` and the same `limit` it will pass to `gate.acquire`. OK — no
   await between the log snapshot and the actual admission check, so no read-then-act race.
3. `gate.acquire` re-sets `this.limit`/`this.perLaneLimit` from the request, then evaluates
   `admissible(lane)` = global ∧ per-lane ∧ (not background ∨ background-cap). OK — single predicate,
   no lock ordering, matches the "one gate, three admission terms" design.
4. If not immediately admissible: waiter enqueued, FIFO within lane; `drain()` re-evaluates
   `admissible()` for every waiter on every slot release, using an always-fresh `activeByLane` sum for
   `inFlightInBackground`. OK — verified this specifically resolves the capped-waiter drain problem
   (traced by hand against the "keeps background capped when foreground frees, admits when
   background frees" spec: freeing the *wrong* kind of slot correctly leaves the cap binding, freeing
   a background slot correctly clears it).
5. Slot release (normal completion, `abort()`, `close()`, thrown error from `runOneShot`) all funnel
   through the same idempotent `release()`/`makeRelease` closure, which decrements `active` and
   `activeByLane` and calls `drain()`. OK — no leak path found across the throw/abort branches I
   traced in `internal-query.service.ts:120-138, 219-252`.
6. Settings write path: `internalQuery.maxConcurrent`/`maxConcurrentPerLane` now both registered in
   `FILE_BASED_SETTINGS_KEYS` and defaulted in `FILE_BASED_SETTINGS_DEFAULTS`
   (`file-settings-keys.ts:364-375, 627-636`); all three hosts (Electron, VS Code, CLI) route through
   the same `isFileBasedSettingKey`/`FILE_BASED_SETTINGS_KEYS` gate (confirmed by grep across
   `platform-electron`, `platform-vscode`, `platform-cli`), so per-lane writes now reach the file
   store on every host, not only Electron. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `DEFAULT_MAX_CONCURRENT = 3` with rationale doc | COMPLETE | none |
| `backgroundLimit(limit)` pure function, `limit>=2 ? limit-1 : 1` | COMPLETE | none |
| `inFlightInBackground` getter, no new counter/map/timer | COMPLETE | verified no new mutable state added |
| `admissible()` gains exactly one term, uses current `this.limit` | COMPLETE | none |
| Class doc "three terms" + reserved-slot paragraph | COMPLETE | none |
| Six background-cap gate tests (plan :341-354) | COMPLETE | all six present and non-vacuous, traced by hand |
| Service `blockedBy` order global→lane→background→governor | COMPLETE | none |
| Service log fields `backgroundInFlight`/`backgroundCapped` | COMPLETE | none |
| Four pinned service tests updated/added | COMPLETE | none |
| Settings: per-lane key registered, defaults 3/1, comments fixed | COMPLETE | none |
| Error doc no longer states a stale number | COMPLETE | none |
| `CLAUDE.md` "is 3" + background cap paragraph, no other paragraph touched | COMPLETE | diff confirms only the two target bullets changed |
| `curator-job-queue.ts` comment "background slots" | COMPLETE | none |
| File stays under 700 lines | COMPLETE | gate 525, gate spec 694, service 318 |
| No new setting key for the cap | COMPLETE | derived from `maxConcurrent`, confirmed no new key added |

Implicit requirements not addressed: runtime observability of the accepted limit-2/limit-1 residual
(see Moderate finding); this was a deliberate scope boundary, not an omission relative to the batch's
stated acceptance criteria.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `limit = 1` | YES | `backgroundLimit(1) === 1`; pinned test "allows background to use the only slot when the limit is one" | none |
| `limit = 2` (accepted regression) | YES | documented + pinned `it.each` row `[2,1]` | no runtime signal (Moderate) |
| Both background lanes + user-action at default (FU-16b-c core case) | YES | pinned gate + service tests, both admit all 3 immediately | none |
| Capped waiter, foreground frees | YES | pinned test proves it stays queued | none |
| Capped waiter, background frees | YES | pinned test proves it is admitted | none |
| Governor-held waiter not counted as background in-flight | YES | pinned test, `inFlightInBackground === 0` while queued | none |
| Unknown/unlisted lane | YES | fails open (pre-existing `GOVERNED_BACKGROUND_LANES.has` gate), unaffected by this batch | future-caller risk noted above |
| Abort while queued (background-capped) | YES | `AbortError`, no slot ever taken, pinned test | none |
| Abort/throw while holding a background slot | YES | `finally`-guarded `release()` on every exit path | none |
| Settings write for the per-lane key on VS Code/CLI hosts | YES | confirmed same `FILE_BASED_SETTINGS_KEYS` gate used by all three host adapters | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking — the one real risk (background re-serialisation at `maxConcurrent <= 2`)
  is a reviewed, accepted, and documented trade-off from the parent task, not an implementation
  defect in this batch.
- What a robust implementation would add: a one-time degradation report (mirroring
  `agent.internal-query.ungoverned`) the first time `backgroundLimit(limit) === 1` binds with a
  configured `limit >= 2`, so the accepted residual is observable at runtime and not only in source
  comments; and importing the shared lane constants at the two remaining hard-coded call sites
  (`curator-pass-admission.ts`, `lane-runner.service.ts`) instead of re-typing the literals, to close
  the last near-miss surface the `GOVERNED_BACKGROUND_LANES` allow-list already defends against
  everywhere else.
