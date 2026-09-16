# Code Style Review — `TASK_2026_463_f13d` Batch 1

## Summary

| Metric          | Value                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------|
| Overall score   | 8/10                                                                                                                                                 |
| Assessment      | APPROVED                                                                                                                                              |
| Blocking issues | 0                                                                                                                                                     |
| Serious issues  | 0                                                                                                                                                     |
| Minor issues    | 3                                                                                                                                                     |
| Files reviewed  | 9 (`internal-query-concurrency-gate.ts`, `.spec.ts`, `internal-query.service.ts`, `.spec.ts`, `internal-query-queue-timeout.error.ts`, `agent-sdk/CLAUDE.md`, `curator-job-queue.ts`, `file-settings-keys.ts`, `.spec.ts`) |

## Five style questions

### 1. What breaks in six months?

A fifth governed background lane requires only one edit
(`GOVERNED_BACKGROUND_LANES`, `internal-query-concurrency-gate.ts:58-61`) because both the
governor allow-list and the slot cap read the same set — the doc comment at `:45-56` says this
explicitly and the code delivers it. The one place this shape could drift silently is
`backgroundLimit` (`:103-105`): it is a pure function of `limit` alone, so if a future change
ever wants a *per-lane* background reservation instead of one pooled cap, this function's
signature has to change and every caller (`internal-query.service.ts:151-153`,
`internal-query-concurrency-gate.ts:472-473`) has to be re-audited by hand — there is no type
that would catch a caller left on the old pooled semantics.

### 2. What would a new team member misread?

The retry ordering in the debug log's ternary chain, `internal-query.service.ts:177-184`
(`global` → `lane` → `background` → `governor`), reads correctly only if the reader already
knows `backgroundCapped` and `governorHolds` are independent predicates computed on lines
151-155, not a fallthrough of the same condition. A reader skimming just the ternary could
assume `background` and `governor` are mutually exclusive outcomes of one check; they are two
different booleans evaluated at `:151-155`, and the ternary is priority-of-report, not
priority-of-cause. The comment at `:174-176` gestures at this ("which ceiling is the binding
one") but does not say the two waits can be simultaneous with `background` reported first.

### 3. What does this cost to maintain?

Very little beyond what the plan already accounted for. `inFlightInBackground`
(`internal-query-concurrency-gate.ts:295-302`) is a derived getter summing two `Map` lookups
each call — no new state, no new invalidation path, consistent with the file's existing
`inFlightForLane` pattern (`:307-309`) it sits beside. The three constants
(`DEFAULT_MAX_CONCURRENT`, `backgroundLimit`, the settings default) are kept in the same
description-comment-drift relationship the file already had with `file-settings-keys.ts`
(hard-coded literal + a spec that pins it), so this batch adds no new class of drift, only one
more instance of a class the codebase already carries by design (`platform-core` cannot import
`agent-sdk`, evidenced at `implementation-plan.md:37,40`).

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally. The admission predicate stays a single boolean expression in one method
(`admissible`, `:467-476`), matching the class doc's stated invariant "one gate, no second lock"
(`:200-210`, updated from "two ceilings" to "three admission terms" in the same commit — text and
code move together). The service change reuses the existing wait-condition-plus-log-fields
pattern verbatim (`laneInFlight`/`backgroundInFlight` sit side by side at `:149-153`,
`:169-171`), rather than inventing a second logging convention for the new term.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have named the getter `backgroundInFlight` to match the local variable name already used
at both call sites (`internal-query.service.ts:150`, and the gate's own field is spelled
`inFlightInBackground` at `:295`) — a cosmetic inversion that costs nothing today but means a
reader grepping for `backgroundInFlight` (the log field name, the thing that shows up in
production logs) will not find the getter that produces it by name alone. Not raised as a Minor
finding on its own because it is a rename with no measurable cost, per the review's own refusal
rule, but it is what I would tighten first.

## Blocking issues

None.

## Serious issues

None. The predicate, the getter, the log fields and the settings registration all match
`implementation-plan.md` Component 2 and `batches.md` Task 1.1-1.3 acceptance criteria
line-for-line (verified against `internal-query-concurrency-gate.ts:87-105`, `:295-302`,
`:467-476`; `internal-query.service.ts:150-184`; `file-settings-keys.ts:364-375`, `:626-636`).

## Minor issues

- `internal-query-concurrency-gate.ts:54-56` — "it will neither yield to a generating turn or
  event-loop lag nor be prevented" breaks `neither...nor` parallelism (should be "...or *to*
  event-loop lag..." to match "yield to a generating turn"). Cosmetic; the sentence is still
  unambiguous.
- `file-settings-keys.ts:367` — "The global and timeout keys were read through `getConfiguration`
  from the day the gate shipped" reads awkwardly on a second pass (the subject "keys" doing the
  "reading" via a getter is backwards — it's callers reading the keys). Pre-existing phrasing
  problem inherited from the comment this batch edited, not introduced by it, but worth a
  polish pass next time this comment is touched.
- Getter/variable name asymmetry, `inFlightInBackground` (gate field,
  `internal-query-concurrency-gate.ts:295`) vs. `backgroundInFlight` (service variable and log
  field, `internal-query.service.ts:150`) — see Five Style Questions Q5. No behavioural cost, a
  pure findability tax.

## File-by-file

### internal-query-concurrency-gate.ts

Score 9/10 — 0B, 0S, 1M. The new constant, pure function, getter and predicate term are placed
exactly where the file's own doc structure says a slot policy belongs (inside `admissible`,
independent of the governor per the "Background lanes yield to the governor" section it sits
next to at `:239-260`). Doc blocks were rewritten in lockstep with the code they describe
(`:63-92`, `:200-232`), not left to drift. 525 lines, under the 700-line soft ceiling.

### internal-query-concurrency-gate.spec.ts

Score 8/10 — 0B, 0S, 0M. All six plan-specified cases are present (`:173-310`) and each proves a
distinct claim (defaults, drain skipping a capped head, foreground-vs-background release order,
`limit=1`, the pure table, governor exclusion). The pre-existing fallback test was updated in
place, not deleted, per the "never delete a pinned test" rule (`:159-170`, confirmed against
`implementation-plan.md:254-256`). 694 lines, under the ceiling.

### internal-query.service.ts

Score 8/10 — 0B, 0S, 1M (the naming asymmetry above). `backgroundLimit` is imported from the gate
rather than re-derived, keeping one definition of the formula (`:26`, `:153`). No signature
change, no Zod added where the plan said none belonged (`readLimit` untouched, confirmed at
`:255-279` — not shown in diff, meaning literally unchanged).

### internal-query.service.spec.ts

Score 8/10 — 0B, 0S, 0M. New tests match plan wording closely enough to trace 1:1
(`admits a user-action query while both background lanes hold slots`, `logs blockedBy background
when the background cap binds`, `:479-514`). Existing tests were renumbered (third→fourth lane,
3/3→4/4) rather than rewritten from scratch, keeping their original assertions' shape.

### internal-query-queue-timeout.error.ts

Score 9/10 — 0B, 0S, 0M. Removes the duplicated numeric default exactly as instructed
(`implementation-plan.md:241-244`) without inventing a new number to drift later.

### agent-sdk/CLAUDE.md

Score 8/10 — 0B, 0S, 0M. The two paragraphs at lines 87-88 were rewritten to state the new
predicate and the accepted `limit=2` residual; no unrelated paragraph in this large file was
touched, matching the "no other paragraph edited" constraint in Task 1.3 acceptance criterion 5.

### curator-job-queue.ts

Score 9/10 — 0B, 0S, 0M. One-word fix (`global` → `background`) that corrects a comment that
would otherwise now be factually wrong (there are 3 global slots, only 2 background ones).
Comment-only, as scoped.

### file-settings-keys.ts / file-settings-keys.spec.ts

Score 8/10 — 0B, 0S, 1M (phrasing, above). The per-lane key registration follows the existing key
placement and default placement conventions exactly (next to the sibling keys at `:373-375`,
`:633-635`), and the drift-pin spec was extended rather than replaced (`:870-895`). No import of
`agent-sdk` was added, honoring the L0.5 boundary stated in this lib's own `CLAUDE.md`
("Everything imports this. This imports nothing from `@ptah-extension/*`").

## Pattern compliance

| Repository rule or nearby convention                                                              | Status | Evidence                                                                 |
| --------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Hexagonal: backend libs depend on `platform-core` ports, `platform-core` imports nothing back      | PASS   | `file-settings-keys.ts:373-375` hard-codes literals instead of importing `agent-sdk`; confirmed against `platform-core/CLAUDE.md` "This imports nothing from `@ptah-extension/*`" |
| One admission predicate, no second lock (class doc invariant)                                       | PASS   | `internal-query-concurrency-gate.ts:467-476` — single boolean expression |
| `catch (error: unknown)` narrowing                                                                   | N/A    | No new catch blocks in this batch's diff                                 |
| No `@ts-ignore` / no TODO / stub / sentinel catch                                                    | PASS   | Grep of all 4 modified `.ts` production files: no matches                |
| File-size soft ceiling 700 lines                                                                     | PASS   | Gate 525, gate spec 694, service 318, service spec 614                   |
| Settings key naming/registration (`FILE_BASED_SETTINGS_KEYS` + `FILE_BASED_SETTINGS_DEFAULTS` pair) | PASS   | `file-settings-keys.ts:374`, `:635` — both sides registered together     |
| Debug log field naming consistent with existing gate reasons (`global`/`lane`/`governor`)            | PASS   | `internal-query.service.ts:177-184` — `background` inserted at its own priority tier, existing three untouched |
| `GOVERNED_BACKGROUND_LANES` single-source-of-truth for "what counts as background"                   | PASS   | Both the governor allow-list and the new cap read the same `Set` (`:58-61`, `:472-473`) |
| Barrel (`internal-query/index.ts`) unchanged unless a consumer outside the folder needs the symbol   | PASS   | `backgroundLimit` not added to barrel; only `internal-query.service.ts` (inside the folder) imports it directly |
| CLAUDE.md doc/code lockstep                                                                           | PASS   | `agent-sdk/CLAUDE.md:87-88` states the 3-term predicate matching `:467-476` verbatim |

## Maintenance debt

- Introduced: one pure helper (`backgroundLimit`), one derived getter (`inFlightInBackground`),
  one settings key, one debug-log field pair (`backgroundInFlight`/`backgroundCapped`). All are
  additive to an existing, already-documented mechanism rather than a new one.
- Retired: the stale "default limit 1" sentence in the timeout error doc, the wrong "global
  slots" wording in `curator-job-queue.ts`, the settings-comment misdirection to the wrong file.
- Net: slightly positive. Three long-standing doc/code drifts (all named in
  `implementation-plan.md`'s evidence table) are closed in the same change that introduces the
  new mechanism, rather than being deferred again.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the naming asymmetry between `inFlightInBackground` (gate) and
  `backgroundInFlight` (service/log) is the only thing worth a follow-up rename, and it carries
  no behavioural risk.
- What a 10/10 version would do differently: align the getter and log-field names so a
  production-log grep for `backgroundInFlight` also finds its source; tighten the two comment
  passages named under Minor issues; and add one sentence to the debug-log doc comment
  (`internal-query.service.ts:174-176`) stating explicitly that `background` and `governor` waits
  are independent conditions, not mutually exclusive branches of one check.
