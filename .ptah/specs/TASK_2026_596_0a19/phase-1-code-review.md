REVISE — 6/10

Score rationale: the pure parsing, evidence, reset-order, ownership, formatting, and contract seams are substantially implemented and the scoped shared test target passes. The score cannot reach the adjacent 7–8 band because a stated safety invariant permits a success-looking “confirmed room” result for a lane whose model is unknown. It is above 3–4 because the defect is isolated to model-scope completeness rather than corrupting the ledger or misclassifying known scopes.

1. **Serious — unknown model scope can falsely confirm room**
   - Evidence: `libs/shared/src/lib/utils/plan-limits/lane-state.ts:76-80` treats a model-scoped window as non-applicable when `modelScope` is `undefined`; `libs/shared/src/lib/utils/plan-limits/lane-state.ts:89-96` drops that window; `libs/shared/src/lib/utils/plan-limits/lane-state.ts:123-133` retains the owner's `windowSetEstablished: true` after the lossy filter; and `libs/shared/src/lib/utils/plan-limits/lane-state.ts:332-335` returns `confirmed-room` when the remaining unscoped windows are `ok`. The test expressly expects the dropping behavior at `libs/shared/src/lib/utils/plan-limits/lane-state.spec.ts:265-274`, while the helper feeds the filtered result straight to classification at `libs/shared/src/lib/utils/plan-limits/lane-state.spec.ts:286-291`.
   - Failure scenario: the owner has fresh, below-threshold unscoped five-hour/weekly windows and an exhausted `weekly_model:opus` window. A lane with no resolved model scope is narrowed to the two unscoped windows, keeps `windowSetEstablished`, and is displayed as “confirmed room.” This hides the possibility that it is the exhausted Opus lane, contrary to Req 4.5 and Req 5/5.5's conservative confirmation rule.
   - Suggested fix: carry model-scope completeness into `ApplicableLimits` (for example, a `modelScopeKnown`/`scopeCoverageComplete` flag), or make `applicableLimits` set `windowSetEstablished` false when the supplied scope is unknown and the owner has any scoped window/evidence. Have `classifyLaneState` return `unknown` with a dedicated reason in that case. Add a test that combines an unknown scope, fresh unscoped `ok` windows, and an exhausted `weekly_model:opus` window and asserts `unknown`, never `confirmed-room`.

## Five logic questions

1. **How does this fail silently?** The lane is given a positive-looking `confirmed-room` state instead of an unknown state; no error or caveat signals that model-specific evidence was omitted (`lane-state.ts:89-96`, `332-335`).
2. **What user action produces unexpected behaviour?** Starting or viewing a lane before its model is resolved can show it as having room even though its actual model's scoped weekly allowance is exhausted (`lane-state.ts:76-96`).
3. **What input data makes this produce a wrong answer rather than an error?** A complete owner snapshot with at least one fresh unscoped `ok` window plus a model-scoped exhausted window, paired with `null`, blank, or undefined lane scope (`lane-state.ts:56-58`, `76-96`).
4. **What happens when a dependency fails, times out, or returns a shape it should not?** A missing snapshot or supplied lookup failure is conservatively `unknown` (`lane-state.ts:292-297`), and malformed/non-finite instant inputs resolve to unknown rather than throw (`instants.ts:68-79`, `92-112`). The scope-completeness defect remains because it happens after a successful snapshot lookup.
5. **What is missing that the requirements never mentioned?** The API lacks a representation of whether a filtered window set is complete for an unresolved model. `windowSetEstablished` currently means the owner read was complete, not that the lane's applicability decision was complete (`lane-state.ts:111-133`).

## What is correct

- `ownerRelation` returns `unknown` whenever either identity kind is unknown, including equal keys (`lane-state.ts:43-53`).
- Estimated evidence cannot establish `at-limit` or `near-limit`; it prevents confirmed room through an `estimated-limit` reason (`window-state.ts:76-83`, `148-157`; `lane-state.ts:273-283`, `321-335`).
- Window evaluation gives active non-estimated exhaustion and reset-passage precedence over age/staleness, and never applies an older window reset to a newer exhaustion (`window-state.ts:112-127`, `188-219`).
- `supersedes` preserves observation timestamps and implements the estimate/stale-live/newer-evidence ordering (`evidence-precedence.ts:50-79`).
- Instant handling covers seconds/milliseconds/ISO, unclamped Retry-After deadlines, local clock rollover, and compact relative durations (`instants.ts:50-112`, `212-282`).
- Formatting keeps unknown values distinct from zero and uses local calendar parts for day comparison; tool source text derives only source labels, not provider brands (`plan-limit-format.ts:127-158`, `251-268`, `238-245`).
- The plan-limit contracts contain no credential field or `quotaOwnerKey`, stay zod-free, use named plan-limit barrel exports, and the public shared index is 91 lines (`plan-limit.types.ts:1-16`, `123-130`; `plan-limits/index.ts:1-63`; `index.ts:1-91`).

Verification: `npx nx run-many -t test -p @ptah-extension/shared` passed (Nx Cloud separately reported its disabled organization). No `ptah_get_diagnostics` or `ptah_agent_report` tool was available in this session.

## Re-review (fix round 1)

APPROVED — 8/10

The prior serious finding is resolved. `applicableLimits` now records that an unknown lane scope omitted model-scoped windows or owner evidence (`libs/shared/src/lib/utils/plan-limits/lane-state.ts:142-154`), and `unknownReasons` makes that omission disqualify confirmed room (`libs/shared/src/lib/utils/plan-limits/lane-state.ts:256-294`). Definite, unscoped exhaustion is still evaluated first and therefore remains `at-limit` (`libs/shared/src/lib/utils/plan-limits/lane-state.ts:332-345`); the unchanged state order then keeps a known near-limit ahead of unknown reasons (`libs/shared/src/lib/utils/plan-limits/lane-state.ts:346-360`).

No remaining findings in the re-reviewed fix. The added coverage asserts: unknown scope plus an exhausted scoped window is unknown; scoped owner evidence has the same result; unscoped exhaustion remains at-limit; and an unscoped-only snapshot still confirms room (`libs/shared/src/lib/utils/plan-limits/lane-state.spec.ts:327-370`). The other previously-correct safeguards are not modified by this diff.

Verification: the scoped `@ptah-extension/shared` test target completed successfully, but Nx served its local cached result; this confirms target health, not fresh execution of the uncommitted test edits. `ptah_agent_report` is unavailable in this session.
