# Batch 2 — Provider quota gate (Defect B)

> **Post-hoc verification record, reconstructed by team-leader from commit `ca183174d`.**
>
> This is **NOT a developer self-report.** The implementing agent was killed by a session
> exit before it could report; its code survived intact and was committed on the user's
> explicit instruction ("commit all of our changes, don't reset anything"). Everything
> below was derived by team-leader reading the committed diff, the spec files, and a
> local test run — not from anything the implementing agent said.

**Commit**: `ca183174d` — `feat(auth-providers): gate background LLM work on provider quota`
**Files touched**: 30
**Verdict**: **APPROVED WITH FINDINGS** — **1 material (F1) + 3 minor**. Nothing blocking;
nothing here justifies reverting or holding the branch. One item needs a decision before
the next batch, not a patch. (F2 was originally raised as material and has since been
**resolved with no defect** — see §7.)

---

## 1. Per-task verdicts

| Task | Subject                                                        | Verdict                    | Note                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `QuotaExhaustedError` + cooldown constant (`auth-providers`)   | ✅ PASS                    | 15 min module constant, docblock shaped like `LANE_AUTH_RETRY_MS`, states the "quota refills on a clock, misconfiguration does not" reasoning. Matches decision A1 exactly.           |
| 2.2  | Cooldown registry (record / query / evict)                     | ✅ PASS                    | In-process map, evict-on-read, 6 h clamp. Bounded three ways — see the `maxAttempts` ruling in §5.                                                                                    |
| 2.3  | `resolve()` gate in `provider-auth-resolver.ts` (**R1**)       | ✅ PASS                    | Correct, and correct in the non-obvious way. Full verification in §2.                                                                                                                 |
| 2.4  | Lane failure classification (`skill-synthesis`)                | ✅ PASS — **exceeds spec** | `'quota-exhausted'` classified TRANSPORT in `applyLaneFailure`, not `markUnscored`. Also introduced `isTransportLaneFailure` and applied it at a second seam no task listed — see §7. |
| 2.5  | Reason token to `skill_synthesis_queue.reason` + drain summary | ✅ PASS                    | Backend-observable half only, no response-shape change. Matches decision A3.                                                                                                          |
| 2.6  | Curator stops while its resolved provider cools down           | ⚠️ PASS WITH FINDING       | Implements decision A2 (option (a)) faithfully. The plan it implements has a gap — **F1**, §6.                                                                                        |

---

## 2. R1 verification (the one thing most likely to be subtly wrong)

The risk R1 was raised against: a lane that _inherits_ the active provider (passes no
explicit `requested` id) must still be gated when that active provider is exhausted.
The naive implementation gates only explicit requests and silently lets inheriting
lanes through — the exact case that matters most, because background work almost never
names its provider.

**Confirmed correct.** In `libs/backend/auth-providers/src/lib/provider-auth-resolver.ts`:

- Line **134** runs `assertNotCoolingDown(requested || activeProviderId)`.
- Both early returns sit **below** it, at **:136** and **:139**.

So the cooldown check is unconditional over both paths — inherit and explicit — and
runs before either can short-circuit.

The second half is the part that reads wrong until you trace it: the two early-return
**predicates were rewritten to test `requested`** rather than the resolved id. That
looks like a gratuitous edit in the diff. It is not. Had the predicates kept testing
the resolved value, early return #1 would have become **unreachable** — the resolved id
is non-empty on every path that reaches it, so the first branch would always be taken
and the second would be dead. The rewrite is what keeps both branches live. This is a
deliberate, correct change, and it is the change a reviewer skimming the diff would
most likely flag as noise.

Both behaviours are **pinned by two discriminating specs** — they fail if the gate is
moved below the early returns, and they fail if the predicates are reverted. This is
not incidental coverage.

---

## 3. Spec-assertion integrity

The question this section answers: did the batch make specs pass by weakening them?

**No.**

- **Exactly 4 removed lines commit-wide** across all 30 files. All four are import
  widenings (adding a symbol to an existing import produces a remove+add pair).
- **Zero assertions weakened.** No `expect` was loosened, deleted, or `.skip`-ed.
- `curator-proxy-manager.spec.ts` gains **+3 lines**: a compile-forced abstract stub.
  The new member on the port makes the existing test double structurally incomplete;
  the stub restores compilation. It asserts nothing and hides nothing.
- **R6's compiled-body scan is untouched**, as is the env-immutability spec. These are
  the two guards most vulnerable to being quietly relaxed by a change of this shape,
  and neither was.

---

## 4. Spec counts (team-leader's own count, not self-reported)

Two earlier batches in this task self-reported counts that were wrong in opposite
directions, so these were recounted from source.

| Measure                                    | Value                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `it(` blocks                               | **46**                                                                 |
| Jest cases actually executed               | **50** (one `it.each` with 5 rows)                                     |
| By lib                                     | `auth-providers` **33** / `skill-synthesis` **12** / `agent-sdk` **5** |
| Discriminating (fail if behaviour reverts) | **~37**                                                                |
| New spec files                             | **1**                                                                  |

The 46-vs-50 gap is the `it.each`; both numbers are correct for what they measure.
A "~37 discriminating of 50" ratio is good for a batch this size — the remainder are
construction/shape assertions, which is proportionate, not padding.

---

## 5. `maxAttempts` ruling: **EXEMPT IS CORRECT — UPHELD**

Quota failures do **not** count against `maxAttempts`, matching the existing
`auth-unresolvable` treatment. This was visible in code comments but never stated for
the record. Stating it now.

The objection a reviewer reaches for is fail-open: "if the cooldown registry is wrong
and lets work through, an exempt failure retries forever." **That worry inverts.** If
the registry fails open, `retryAfterMs` returns `0` — which means no cooldown is
recorded, which means **no quota failure is produced at all**. Fail-open cannot
generate the infinite-requeue case; it degrades to pre-batch behaviour.

The real risk is **fail-closed**: the registry wrongly reports a permanent cooldown and
an exempt item requeues indefinitely. That is bounded three independent ways:

1. **6 h clamp** on any recorded cooldown — no entry can outlive it.
2. **Evict-on-read** — a stale entry is removed the first time it is queried.
3. **In-process map** — every entry dies at process exit; a restart clears the state.

Worst case under total registry misbehaviour: **one free requeue per 15 minutes**, per
item, until restart. That is the same exposure the codebase already accepts for
`auth-unresolvable`, and it is the correct trade — burning an attempt on a failure the
user cannot act on and that resolves on a clock would permanently retire work for a
transient condition.

**Ruling: exemption stands. No change requested.**

---

## 6. F1 — MATERIAL (medium-high): the curator stall destroys its own input

**This is the finding that matters.** It is a **plan gap inherited faithfully**, not an
implementation defect — Task 2.6 does exactly what decision A2 told it to do.

Decision A2 said the curator must _stop entirely_ while its provider cools down. Task
2.6's no-throw constraint meant "stop" had to be expressed as a quiet return. The
result:

```
runQuery → ''  →  extract() → []
```

An empty extraction from a quota stall is **byte-identical to an empty extraction from
a successful pass that found nothing.** Downstream cannot tell them apart. And
downstream acts on that:

- `libs/backend/memory-curator/src/lib/memory-trigger.service.ts` **:744-745** calls
  `markProcessed(ids)` on the resolve path — inspecting nothing. It marks the episodes
  processed whether or not anything was extracted from them.
- `drainForSession` filters on `processed_at IS NULL`, so once marked, those episodes
  are never revisited.
- `episodes.reset` at **:696** has _already fired_ by that point.
- A resolving run advances the boot-scan watermark.

Net effect: **a stalled pass consumes and discards its input.** The episodes it was
supposed to curate are marked done, the reset has happened, the watermark has moved.
When quota returns 15 minutes later, that material is gone. The gate correctly prevents
a doomed LLM call and then throws away the work the call was meant to do.

**This needs a decision, not a patch.** Two coherent directions:

- **(a) Stats discriminator** — have the stall return a distinguishable result (e.g. a
  `skipped`/`stalled` count alongside `extracted`) and make the `markProcessed` call
  site at `:744` respect it. Smallest change, keeps A2's no-throw constraint.
- **(b) Revisit the no-throw constraint** — if the curator is allowed to signal the
  stall as a failure, the existing failure path already declines to mark processed.
  Cleaner, but reopens a decision the user made deliberately.

Team-leader does not pick between these. It is a scope question.

**F1 is no longer theoretical — see §8.**

---

## 7. F2 — **RESOLVED, NO DEFECT** (originally raised as material/medium)

**Original observation — a test-run discrepancy:**

| Source                     | Claim                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Commit message `ca183174d` | 1324 passing, no failures                                                                                           |
| Handoff doc                | 1324 passing, no failures                                                                                           |
| Team-leader's review run   | **1307 passed / 37 skipped / 1344 total**, with `session-archaeologist.service.spec.ts` **failing at module scope** |

**Resolution — clean re-run, cache bypassed:**

```
nx test skill-synthesis --skip-nx-cache
Test Suites: 6 skipped, 65 passed, 65 of 71 total
Tests:       37 skipped, 1324 passed, 1361 total
exit code 0
```

That is **1324 passing, exactly matching the commit message.**

**The arithmetic reconciles precisely, and that is what closes this rather than the
green run alone.** `session-archaeologist.service.spec.ts` holds **17 tests**. When a
suite fails at module scope, its cases never register — they are absent from _both_ the
passed count and the total, not counted as failures. So:

- 1324 − 17 = **1307** — team-leader's passed count
- 1361 − 17 = **1344** — team-leader's total
- 1344 + 17 = **1361** — the clean total

Both numbers off by exactly 17, in lockstep. That is the signature of one suite failing
to load, and it rules out the two alternatives worth worrying about: a miscount in the
commit message (which would not produce a matched offset) and a regression introduced by
this batch (which would show as _failures_, not as absent registrations).

**Cause**: a transient module-load failure in `session-archaeologist.service.spec.ts` —
a file **`ca183174d` does not touch** and which is not among the 30 in this commit.

**Verdict: not a defect, not a regression, not a miscount.** The commit message's 1324
figure is accurate and can be cited. Both observed runs are retained above so a future
reader can see _why_ the two disagreed, rather than being told to trust one over the
other.

---

## 8. Live evidence — cold start after review (`tmp/logs/coldstart-306.log`)

A real `nx serve ptah-electron` cold start was captured **after** the review above was
written. It confirms the gate works and **promotes F1 from predicted to observed.**

**Full path**: `D:/projects/ptah-extension/tmp/logs/coldstart-306.log` (1587 lines)

### The gate fires in production

```
[WARN] [memory-curator] curator provider is rate-limited; skipping this curation pass
until its quota refills: {"error":"Provider quota exhausted; retrying in about 15 min.",
"curatorProviderId":""}
```

Three things to read out of that one line:

1. **It fires at all** — the classification chain from a real Codex 429 through to the
   curator's stop decision is wired end to end. This is not a unit-test artifact.
2. **`curatorProviderId: ""`** — this is the **empty-provider inherit path**. The
   curator named no provider; the gate caught it via `requested || activeProviderId`.
   **This is precisely the case R1 exists to catch, hitting on the first real run.**
   The R1 fix is not defensive coding for a hypothetical — without it this pass would
   have sailed through to a doomed call.
3. The 15-minute cooldown surfaces in the user-visible error text as intended.

**Volume**: 15 curator gate warnings, lines **1232–1260**. 48 rate-limit / 429 / quota
lines total across the log. Codex was genuinely exhausted — this is a real quota event,
not a synthetic one.

### F1 observed, not predicted

The log tail across lines 1231–1260 is a tight two-line alternation:

```
[DEBUG] [JsonlReader] findSessionsDirectory: {"workspacePath":"D:\\projects\\property-hub", ...}
[WARN]  [memory-curator] curator provider is rate-limited; skipping this curation pass ...
```

repeated 15 times with nothing between. That is **exactly F1's predicted behaviour**:
the boot scan reads a session directory, hands the episodes to the curator, the curator
stalls and returns empty, the caller marks them processed and advances, and the loop
immediately takes the next batch. **Drain and discard — and faster than before the
gate**, because the stall returns instantly where a real LLM call would have taken
seconds. The gate made the destructive loop _cheaper to run_, which is why it is visible
as a tight burst rather than a slow trickle.

Fifteen passes' worth of episodes were consumed and discarded in the span of a few
hundred log lines, on a single cold start. F1 should be treated as an active data-loss
path, not a design note.

---

## 9. Minor findings

| #   | Finding                                                                                                                                                 | Assessment                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `OPENROUTER_PROVIDER_ID = 'openrouter'` is hard-coded and **unpinned by any spec**.                                                                     | Low risk today; the string is load-bearing for provider matching and would fail silently if a rename ever happened. One assertion would close it.                        |
| M2  | **Acceptance criterion 4 — "no template candidate persisted during cooldown" — is unproven.** No spec asserts it and the live log does not exercise it. | The code path looks right by inspection, but the criterion was written to be verified and was not.                                                                       |
| M3  | `retry-after: 0` yields the **15-minute default, not 1 second**.                                                                                        | Deliberate — a zero from a server is not a licence to hammer it — but **undocumented**. Add a one-line comment at the parse site; the next reader will read it as a bug. |

---

## 10. Task 2.4 exceeds its spec (recorded, not faulted)

Task 2.4 was scoped to classifying `'quota-exhausted'` as TRANSPORT inside
`SkillDrainService.applyLaneFailure`. The implementation went further: it introduced
**`isTransportLaneFailure`** and applied it at **both** seams, including
`libs/backend/skill-synthesis/src/lib/lane-runner.service.ts` **:527**.

No task listed that second call site. And it is **the change that actually makes quota
rows requeue** — `applyLaneFailure` alone classifies the failure, but `lane-runner`
:527 is where the classification turns into a requeue instead of a terminal mark.
Without it, Task 2.4 would have been correct on paper and inert in practice.

Recorded here because undocumented scope expansion is normally a finding. In this case
the expansion is **load-bearing and correct**, and the batch would not have met its own
acceptance criteria without it. **Not faulted.** But it means the task list understated
the blast radius of Batch 2 by one file, which is worth knowing when reasoning about
what this commit can break.

---

## 11. Overall verdict

**APPROVED WITH FINDINGS — 1 material (F1) + 3 minor.**

The code is correct, the specs are honest, R1 is fixed in the non-obvious way it needed
to be fixed, the test suite is green at 1324 on a clean re-run, and the live cold start
proves the whole chain works against a real 429 — on the inherit path, which is the hard
case.

**One thing leaves this batch open:**

- **F1** is an active data-loss path, now observed in production logs. It is a plan gap
  the batch inherited, and it needs a scope decision (§6) before more curation runs
  happen against an exhausted provider.

**Closed since the review**: F2 — the test discrepancy resolved to a transient
module-load failure in an untouched file, with the 17-test offset reconciling exactly
(§7). No defect.

F1 does not block the commit, but it should be carried forward.
