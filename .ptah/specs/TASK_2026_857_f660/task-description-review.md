# Task Description Review - TASK_2026_857_f660

- Author: codex lane
- Reviewer: subagent code-logic-reviewer
- Revision reviewed: r1
- Verdict: REVISE

## Coverage check (context.md user request)

| Request item                                                | Covered                                      | Where                       |
| ----------------------------------------------------------- | -------------------------------------------- | --------------------------- |
| 1a confirm failures recorded                                | Yes, as verify-and-close-gaps                | Req 1, Decisions row 1      |
| 1b taskKind set on host, never null                         | Yes, but default rule undefined              | Req 2                       |
| 1c subagent outcomes in production DB                       | Yes                                          | Req 3                       |
| Per-turn System One scope check                             | Yes                                          | Req 4                       |
| Pre-flight at scope agreed, Routing reminder, scope nudge   | Yes                                          | Req 5                       |
| gate-0.1 unchanged, pre-flight reuse                        | Yes                                          | Req 6                       |
| Host-captured review verdicts                               | Partly: the host event source is never named | Req 7                       |
| Seed-blended scores with named k                            | Yes, k value left open                       | Req 8                       |
| Electron first, no prompt-text changes, other hosts compile | Yes                                          | Out of scope, Compatibility |
| Privacy (no request text in rows)                           | Yes                                          | Non-functional              |

## Spot-check of survey appendix

- A1 `lane-completion-notifier.service.ts:658-678`: confirmed. `verdictOf` returns `failed` for any status other than completed or host-stopped, and `delivered` only when every declared file exists with bytes > 0.
- A4: confirmed. `signal()` (notifier :331-360) calls `enqueueLaneCompletionOutcome` before chat delivery. In `lane-completion-outcome.ts:11-30` the recorder is a nullable thunk and the function returns silently when it is null. `di/register.ts:300-313` resolves the recorder only if `LANE_OUTCOME_TOKENS.RECORDER` is registered. The doc's "static code does not show a missing write path, but recorder is optional" framing is accurate. There is a single `signal(` call site in the process manager (:2992), reached through a shared helper, which is consistent with the cited terminal paths.
- A2: confirmed. `local-derivation.ts:129` drops `taskKind === null`, `cellFrom` requires `MINIMUM_SAMPLE_COUNT = 5` (`routing-constants.ts:152`), and the local cell carries a raw score.
- A5: confirmed. The `SubagentStopCallbackRegistry.notifyAll` fan-out in `subagent-hook-handler.ts:507-559` is gated on `agent_transcript_path` plus derived and parent session IDs. The separate `emitSubagentEnded` in `subagent-stop-hook-handler.ts:49-106` does not need a transcript path, but it does need a resolved session ID and cwd. A5's "broader trigger" wording is correct but should not be read as "unconditional". `recordSubagentStop` hard-codes `taskKind: null` (`lane-outcome-recorder.service.ts:~115`), matching A5.
- A1/A2 derivation claims match the code. No survey claim was found to be wrong.

## Findings

### 1. Default task-kind rule is referenced but never defined (Serious)

Evidence: Req 2 bullets 2-3 say "the documented default rule", and the Decisions row says "non-null default kind". Neither the requirements nor the Open questions define which of the six kinds, or where the rule is documented. The Open questions list only the "role mapping" as left to the implementer.

Risk: a fallback kind such as `implement` will be applied to every unclassified row. This feeds `local-derivation.ts` and pollutes exactly the seeded implement cells (A3), so null rows become wrong rows. It is also untestable as written.

Change requested: state the default explicitly (or name a neutral sentinel the derivation can exclude, for example a distinct "unclassified" handling), and add an AC that defaulted rows are distinguishable from explicit or mapped kinds. Alternatively list the choice under Open questions or Decisions with its trade-off. If a new sentinel changes the six-kind vocabulary, flag it as a shared-contract decision.

### 2. Host "structured review" event source is unnamed (Serious)

Evidence: Req 7 says "host-observed, structured review explicitly identifies a reviewed `runId`", but the document never says which host event carries it. A8 only cites the model-invoked `ptah_outcome_report` path. Out of scope also excludes new integrations for CI/PR signals.

Risk: an implementer or tester cannot know what to observe. The requirement could be satisfied vacuously by the existing model-call path, which is exactly what the user wanted to get away from (context.md:25-26).

Change requested: name the candidate host event(s), for example review-lane completion with a structured verdict, or state that the architect must identify one. Add an AC that a review captured with no `ptah_outcome_report` call changes the row. Also define the "distinct review event" identity used for dedupe, for example `runId` plus a review id.

### 3. Task-kind classification via System One at spawn is a new default-on model call (Moderate)

Evidence: Req 2 bullet 3 allows classifying "the bounded task brief" through the decision model on every CLI spawn without a kind. The Cost NFR covers only the scope check and pre-flight. context.md asks only that the host set taskKind and never leave it null.

Risk: unbudgeted model calls and latency on the spawn path. Spawn-path timeout behavior is unspecified (the 3,000 ms bound is cited only for System One in general).

Change requested: add an AC bounding this classification (a timeout that must not block the spawn) and include it in the Cost NFR. Alternatively make it explicitly optional and off unless configured.

### 4. Scope-check thresholds and nudge behavior are untestable (Moderate)

Evidence: Req 4 says "low-confidence" with no threshold or schema. Req 5 says "queue a short scope-confirmation nudge" without stating its content source, frequency, or suppression. The "disable control" appears in Scope and Risks but no requirement defines its location, default or semantics.

Risks: a nudge on every unclear turn is nagging. A "disable control" with no stated default means the model-call cost is on or off by accident.

Change requested: define the confidence rule (or say it reuses the existing System One typed-decision convention, with a citation). Add an AC that the nudge is shown at most once per scope revision or is rate-limited. Add a requirement for the disable control (setting name or location, default, and that "disabled" means no model call), reusing the existing routing-enabled setting if it is the same thing.

### 5. Subagent single-row guarantee has two producers (Moderate)

Evidence: Req 3 says "exactly one subagent outcome". The recorder callback fan-out (`subagent-hook-handler.ts:507-559`) and the broader `SubagentStop` event can both fire for one stop, and the row schema requires a `subagentSessionId`.

Change requested: state the dedupe key (the existing `subagentRunId(agentId)` is the obvious one) and an AC that both producers firing yields one row, whichever arrives first. State which schema fields become nullable (for example `subagentSessionId`) and that this is a shared-schema change that must keep CLI and VS Code compiling.

### 6. Blend requirement leaves delivered-versus-review weighting ambiguous (Moderate)

Evidence: Req 8 gives the formula for "observed successes" but the existing `cellFrom` has separate delivery and review denominators (`local-derivation.ts:247-274`). The final bullet says `delivered` shall not be treated as an approval, yet delivered is still the only available signal for most rows.

Change requested: state how delivery and review rates combine (review replaces delivery when present, or a weighted combination), and that `k` is a single named exported constant in `routing-constants.ts` with a stated positive value or range. As written, "named" is not enforced.

### 7. User-reserved decision made on the user's behalf: model call per user turn, default state (Minor)

Evidence: Open questions says "None reserved for the user". A default-on per-turn model call is a cost decision. context.md shows the user asked for it, so I do not treat it as a blocker, but the default (on or off) should be recorded in Decisions with its reversibility.

Change requested: add a Decisions row for the default state of the per-turn scope check.

### 8. Minor wording

- The Problem section line 7 and A5: say the broader stop path "also needs a resolved session ID and cwd" so it is not read as unconditional.
- The Problem section states production counts as fact. The appendix already says they are not a fresh DB query, so no change is needed beyond keeping that note.

## Scope and privacy check

- Electron first, no VS Code or TUI features, no prompt-text changes and no "call route_decide yourself" rule: all correctly stated.
- Privacy: rows and diagnostics are barred from request text. The brief or scope summary is used only transiently, which is correct. Finding 3 should confirm that the classification call output (the kind) is the only thing persisted.
- No removals or money decisions found beyond finding 7.

## Verdict

REVISE. There are two Serious findings (1, 2) that make acceptance criteria untestable or able to be satisfied vacuously, and four Moderate findings. Survey citations are accurate.

## Re-review r2

- F1 (default task-kind rule): resolved. Req 2 (task-description.md:54-63) removes the fallback kind: explicit, mapped, classified, then unclassified with `taskKind: null`. It adds `taskKindSource` with four values, a test that distinguishes the four sources, and exclusion of null rows from derivation. Matches decisions.md row 7.
- F2 (review event source): resolved. Req 7 (:101-109) names the completion of a review-kind run with a verdict line and a reviewed-run reference as the host event. It adds an AC for a review with no `ptah_outcome_report` call (:109) and dedupe by (reviewed runId, reviewer runId) (:108).
- F3 (classification model call): resolved. Classification is asynchronous after insert, at most once per run, with the per-request timeout, never on the spawn path, and zero calls when the model is unset (:59-60, Cost NFR :101). The persisted output is only the kind and its source (Privacy NFR :102).
- F4 (thresholds and nudge): resolved. Low confidence is `CONFIDENCE_THRESHOLD` 0.5 (:80). The nudge shows at most once per scope revision (:88). The disable setting has a default and zero-call semantics (:81).
- F5 (subagent dedupe): resolved. Rows are keyed by `subagentRunId(agentId)`, the first producer wins, and the later one enriches or is ignored (:69). The nullable fields are named, `agentId` stays required, and a shared-schema compile guard is stated (:70, :72).
- F6 (blend ambiguity): resolved. Delivery and review rates are blended separately and averaged when both exist. `BLEND_PRIOR_WEIGHT = 10` is a named exported constant in `routing-constants.ts`, and the `MINIMUM_SAMPLE_COUNT` gate is removed (:115-118).
- F7 (default state decision): resolved. The default is conditional ON, and the Decisions table row (:158) records it with its reversibility.
- F8 (wording): resolved. The broader stop path is described as still needing a resolved session ID and cwd (:15).

### New findings

- Minor N1: the Cost NFR (:101) makes the host routing setting cover only the scope check and pre-flight calls. It says only an unset model blocks task-kind classification. It does not say whether switching the setting OFF also stops classification. State it, or say classification is intentionally independent of the setting. This is non-blocking.
- Minor N2: Req 8 bullet 5 (:119) uses "strongly differ" and "dominate". The test list beside it (both directions, no seed, rounding, zero denominators) makes it checkable, but concrete numeric examples would help the tester. This is non-blocking.

No new contradictions found. The "reviews arriving before the reviewed row" case (:106) relies on the existing held-report join (:71), which is consistent.

Verdict (r2): APPROVED
