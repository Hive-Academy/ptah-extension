# Code Style Review — `TASK_2026_437_0778` Batch 18

## Summary

| Metric          | Value                                         |
| --------------- | --------------------------------------------- |
| Overall score   | 7/10                                          |
| Assessment      | NEEDS_REVISION                                |
| Blocking issues | 0                                             |
| Serious issues  | 2                                             |
| Minor issues    | 4                                             |
| Files reviewed  | 17 (11 production, 6 spec files; 4 CLAUDE.md) |

Scope: agent-sdk `internal-query/network-failure.ts` (+spec, new), `network-backoff.ts` (+spec,
new), `internal-query/index.ts`, `src/index.ts`, `curator-llm-adapter/sdk-internal-query.curator-llm.ts`
(+spec), `agent-sdk/CLAUDE.md`; memory-contracts `curator-llm.port.ts` (`CuratorStallReason`
`'provider-unreachable'`), `CLAUDE.md`; memory-curator `curator-llm/curator-activity-log.ts` (new,
facade extraction), `curator-llm/curator-pass-admission.ts` + spec (new),
`memory-curator.admission.spec.ts` (new), `memory-curator.service.ts` (1068 → 823 lines),
`CLAUDE.md`; skill-synthesis `di/tokens.ts` (`NETWORK_BACKOFF`), `di/register.ts`,
`internal-query.interface.ts`, `lanes/lane.types.ts`, `lanes/lane-runner.service.ts` (819 → 902
lines), `lanes/lane-runner.test-support.ts`, `lanes/lane-runner.network-backoff.spec.ts` (new),
`queue/skill-drain.service.ts` (1229 → 1262 lines), `queue/skill-drain.network-backoff.spec.ts`
(new), `CLAUDE.md`. Batch 17 files (workspace-intelligence, persistence-sqlite, platform-core,
`apps/ptah-electron` activation, vscode-lm-tools) excluded per instruction. Read-only; `npx
eslint`/`npx prettier --check` run clean on every touched file; no nx/test run performed.

## Five style questions

### 1. What breaks in six months?

Batch 17's own review predicted this exactly, and it has already happened one batch later.
`b17-code-style-review.md:92-118` flagged four independent `Pick<BackgroundWorkGovernor, 'isClear'
| 'whenClear'>` declarations as a Serious finding, recommended a shared `WhenClearCapableSignal`
export from `vscode-core`'s `background-work-governor.ts`, and warned "the next adopter... has no
existing type to reach for and will most likely write a fifth copy." `memory-curator/curator-llm/curator-pass-admission.ts:48-51`
declares a FIFTH: `export type CuratorClearanceSource = Pick<BackgroundWorkGovernor, 'isClear' |
'whenClear'>`, character-for-character the same shape, and `WhenClearCapableSignal` was never added
to `vscode-core` (`grep -rn "WhenClearCapableSignal" libs/backend/vscode-core/src` returns nothing).
The recommendation was two batches old and free (a pure, non-behavioural type export) and the fifth
copy landed anyway.

### 2. What would a new team member misread?

A reader who has just read `lane-runner.service.ts`'s network-back-off wiring — `networkHold`,
`callFailure`, `NetworkBackoff` injected via DI, shared with `SkillDrainService` — would reasonably
expect `SkillEnhancerService.generateCandidate` (`skill-enhancer.service.ts:705-800`) to go through
the same `LaneRunnerService` every other skill-synthesis stage service uses
(`archaeology/session-archaeologist.service.ts`, `skill-curator.service.ts`, `skill-judge.service.ts`,
`skill-synthesizer.service.ts`, `digest/skill-gap-curator.service.ts`, three `gates/*.service.ts`,
`naming/candidate-namer.service.ts` — a `grep -rln "LaneRunnerService"` hit for every one of them).
It does not: `generateCandidate` calls `this.internalQuery.execute(...)` directly
(`skill-enhancer.service.ts:768`), reads only assistant text, and on any thrown error just logs a
warn and returns `null` (`:790-797`) — the exact "read the subprocess's own error text as an answer"
shape this whole batch exists to close for the curator adapter and the lane runner. The batch's own
`skill-synthesis/CLAUDE.md` addition is honest about this ("Out of scope and still open:
`SkillEnhancerService.generateCandidate` calls `IInternalQuery` directly and reads assistant text
without this observer"), so it is not a hidden gap, but a reader who trusts the CLAUDE.md's "network
back-off" section to describe every background LLM caller in the library will miss this one caller
unless they read that closing sentence.

### 3. What does this cost to maintain?

Low where the facade rule was applied, and asymmetric where it was not. `memory-curator.service.ts`
went from 1068 to 823 lines by extracting two nameable, independently-tested collaborators
(`CuratorActivityLog`, `CuratorPassAdmission`) exactly as Batch 16's split of `internal-query.service.ts`
did. `skill-drain.service.ts` (1229 → 1262) and `lane-runner.service.ts` (819 → 902) both took their
share of this batch's new logic (`networkHold`, `callFailure`'s network arm, the drain's
`networkDeferred` row filter) as private methods added to two files that were already, and remain,
roughly 1.8x and 1.3x the 700-line soft ceiling — with no equivalent extraction. The network-gating
logic in both is genuinely small and self-contained (`networkHold`/`callFailure` together are under
40 lines), so this is not yet expensive, but it is the same shape of debt the facade rule exists to
catch before a file crosses the ceiling, and one side of this exact batch demonstrated the fix while
the other side did not.

### 4. Where is this inconsistent with the rest of the repository?

Two places, both named above as Serious findings: the fifth `Pick<BackgroundWorkGovernor,...>` copy
against Batch 17's explicit recommendation, and `SkillEnhancerService` being the one stage service in
skill-synthesis that never routes through `LaneRunnerService`. Everywhere else this batch is
consistent with precedent it extends correctly: `CuratorActivityLog`/`CuratorPassAdmission` are
constructed by the service rather than injected, for the same stated reason as `CuratorWindowRunner`
(no lifecycle, no alternative implementation, no other consumer) — a reason this task's own reviews
have accepted twice already (Batch 16's `TurnStateForegroundSource` note, Batch 17's
`FolderIndexLiveSync` note). `SKILL_SYNTHESIS_TOKENS.NETWORK_BACKOFF` is registered `useValue`
because it is plain state shared by two consumers, matching the file's own established reason for
`useValue` over `useToken` immediately above it in `register.ts`. `export type` / `export` splits in
every touched barrel are correct throughout.

### 5. What would you have done differently, and why is that better rather than merely other?

First, add `WhenClearCapableSignal` (or the equivalent name) to `vscode-core`'s
`background-work-governor.ts` now, as Batch 17's review recommended, and have
`CuratorClearanceSource` become `export type CuratorClearanceSource = WhenClearCapableSignal` — a
one-line change with no behaviour difference, and the last easy point to stop this from becoming six
copies instead of five. Second, route `SkillEnhancerService.generateCandidate` through
`LaneRunnerService.run` the way every sibling stage service already does, or, if that migration is
deliberately deferred, promote the CLAUDE.md's closing sentence into a tracked follow-up ID (this
task already uses `FU-` numbering for exactly this purpose) so it is discoverable from `batches.md`
and not only from the prose at the end of a CLAUDE.md paragraph. Third, drop the `?? 0` in
`skill-drain.service.ts:780` (`summary.networkDeferred = (summary.networkDeferred ?? 0) + 1`) since
the only production construction site initializes the field to `0` unconditionally
(`skill-drain.service.ts:725`) — the optionality is presented as being for the benefit of "summaries
built elsewhere before the field existed," but no such site exists in the current tree.

## Blocking issues

None.

## Serious issues

### A fifth independent `Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>`, against Batch 17's explicit recommendation

- File: `libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:48-51`
  (`CuratorClearanceSource`).
- Problem: `b17-code-style-review.md:92-118` named four identical declarations
  (`FolderRebuildGovernor`, `SymbolIndexingGovernor`, `BackupGovernor`, `UserLayerGovernor`) as a
  Serious finding and recommended exporting one shared type,
  `WhenClearCapableSignal = Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>`, from
  `vscode-core`'s `background-work-governor.ts` so a fifth adopter would have something to reuse.
  Nothing was added (`grep -rn "WhenClearCapableSignal" libs/backend/vscode-core/src` is empty), and
  `CuratorClearanceSource` in this batch is that predicted fifth copy, character-for-character the
  same `Pick`.
- Tradeoff: today this is still inert — the type is small, well-documented at its declaration, and
  independently spec'd. The cost is exactly the one Batch 17 named: a future `whenClear` signature
  change now has no single point of update across five call sites instead of four, and a sixth
  adopter has the same "nothing to reach for" problem, made slightly worse because the fix keeps
  getting deferred past the batch that could have applied it for free.
- Recommendation: add `WhenClearCapableSignal` to `background-work-governor.ts`, re-export it from
  `diagnostics/index.ts` and `src/index.ts` the same way `BackgroundWorkSignal` already is, and point
  all five local aliases (the four from Batch 17 plus `CuratorClearanceSource`) at it. Pure type-level
  change, no behaviour difference, no call-site edits.

### `SkillEnhancerService` is the one skill-synthesis stage that never reaches the network back-off

- File: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:768-797`
  (`generateCandidate`), compared with every other stage service in the same library
  (`grep -rln "LaneRunnerService" libs/backend/skill-synthesis/src/lib` hits
  `archaeology/session-archaeologist.service.ts`, `digest/skill-gap-curator.service.ts`,
  `gates/judge-panel.service.ts`, `gates/replay-validator.service.ts`, `gates/trigger-eval.service.ts`,
  `naming/candidate-namer.service.ts`, `skill-curator.service.ts`, `skill-judge.service.ts`,
  `skill-synthesizer.service.ts` — nine call sites, all through `LaneRunnerService.run`).
- Problem: `generateCandidate` calls `this.internalQuery.execute(...)` directly, reads only
  `msg.type === 'assistant'` text, and never constructs a `QueryNetworkObserver` or classifies a
  thrown error with `classifyThrownNetworkFailure` — both of which this batch added specifically so
  a network-class failure's synthetic error text is never read as the model's answer. A thrown
  network error is caught generically (`:790-797`, `degradation-audit: optional-capability`) and
  treated identically to "the model declined to answer" — silently returning `null`, preserving the
  existing artifact. This caller also never feeds `NetworkBackoff`, so it neither raises it on
  failure nor benefits from `networkHold`'s block on a background run while a window is open: it
  keeps calling a dead endpoint on its own schedule while `LaneRunnerService`'s callers correctly
  wait it out. The batch's own `skill-synthesis/CLAUDE.md` addition documents this gap in its last
  sentence ("Out of scope and still open...").
- Tradeoff: this is the one library-internal inconsistency the batch leaves behind. It is
  self-disclosed, which is materially better than a silent gap, but "documented in the last sentence
  of a CLAUDE.md paragraph" is a weaker signal than a tracked follow-up id the way `FU-16b-a`,
  `FU-16b-b` and `FU-16b-c` are tracked in `batches.md`, and it leaves the exact defect class this
  batch was created to close (`Ptah Electron-2026-09-14.log:1037-1180`) open in one production path.
  The runtime consequence (a network failure read as generated enhancement text) is a
  code-logic-reviewer question; the structural question this review owns is that this caller is the
  one place in the batch's own library that did not adopt the pattern every sibling caller adopted.
- Recommendation: route `generateCandidate` through `LaneRunnerService.run` like its siblings, or, if
  that migration is deliberately deferred to a later batch, give it a tracked `FU-` id in `batches.md`
  rather than leaving it as CLAUDE.md prose only.

## Minor issues

- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:250` documents
  `DrainSummary.networkDeferred` as optional "so summaries built elsewhere before the field existed
  still compile," but `grep -rn "DrainSummary = {" libs/backend/skill-synthesis/src` finds exactly one
  production construction site (`skill-drain.service.ts:711-728`), and it initializes the field to
  `0` unconditionally. No spec constructs a raw `DrainSummary` literal either
  (`skill-synthesis.stage-handlers.spec.ts` only references the type name). The stated rationale does
  not correspond to any call site in the current tree — `budgetDeferred` and `bootDeferred`, the two
  fields it sits beside, are both non-optional `number`. Not a defect (the `?? 0` at `:780` is
  harmless), but the comment's justification should either point at a real caller or be dropped in
  favour of matching its two siblings.
- `libs/backend/agent-sdk/src/lib/internal-query/network-failure.ts` and `network-backoff.ts` live
  inside `internal-query/`, whose other members (`internal-query.service.ts`,
  `internal-query-concurrency-gate.ts`, `internal-query.types.ts`) are about lane admission and
  execution, not network-failure classification. The file's own header justifies the placement ("the
  memory curator's adapter and skill-synthesis's lane runner answer 'was that the network?'
  identically" — i.e., it needs `IInternalQuery`'s stream shape), which is a real reason, but a
  sibling `network/` folder next to `internal-query/` would separate "how do I run a one-shot query"
  from "was the failure the network's fault" as cleanly and would not need the same justifying
  paragraph. Worth a look next time either file is touched; not worth moving on its own.
- `networkSignalForHttpStatus` is exported from both `internal-query/index.ts` and the top-level
  `src/index.ts`, but `grep -rn "networkSignalForHttpStatus"` outside `network-failure.ts` and its own
  spec finds no consumer. Same shape as Batch 17's `EditorTargetCache` minor (public surface with
  zero current external consumers) — defensible as the natural unit export beside
  `classifyThrownNetworkFailure`, not a defect.
- `agent-sdk/curator-llm-adapter/sdk-internal-query.curator-llm.ts`'s `resolve()` deliberately treats
  `'cooling-down'` and `'unreachable'` identically (`:369-371`, "No stalled arm here... A cooldown
  that starts between `extract` and `resolve` degrades to 'store the drafts unmerged'"), which means
  a network failure specifically on the `resolve` call is never reported to
  `CuratorPassAdmission.recordExtraction` — only `extract`-stage outcomes feed the back-off
  (`memory-curator.service.ts:562`). This is consistent with the port's own documented design (`ICuratorLLM.resolve`
  has no stalled arm by contract) rather than an oversight in this batch, so it is not counted as a
  defect here, but it is worth naming because it means the back-off's picture of "is the provider
  reachable" is built entirely from `extract` calls, never `resolve` calls — a distinction a future
  reader of `NetworkBackoff`'s consumers should not assume is symmetric across the two.

## File-by-file

### `agent-sdk/internal-query/network-failure.ts` (new)

Score 9/10 — 0/0/1 (folder placement, above). `classifyThrownNetworkFailure`'s depth-bounded `cause`
walk (`MAX_CAUSE_DEPTH = 8`) is defensive against caller-supplied cyclic errors, and
`QueryNetworkObserver`'s `verdict()` correctly lets a non-network result status (401, 400) overrule an
earlier retry signal — the one subtlety in the whole file, and it is both commented and tested
(`network-failure.spec.ts`).

### `agent-sdk/internal-query/network-backoff.ts` (new)

Score 9/10 — 0/0/0. Pure state, no consumer coupling beyond the injected `Logger`/clock/`random`
seams; "one window per level" and "not persisted" are both stated as deliberate design choices in the
header rather than left implicit, and `network-backoff.spec.ts` pins the exact doubling sequence with
a fake clock and a fixed jitter sample.

### `agent-sdk/curator-llm-adapter/sdk-internal-query.curator-llm.ts`

Score 8/10 — 0/0/1 (resolve-stage asymmetry, above). The `unreachable` outcome arm is placed and
named consistently with the pre-existing `cooling-down` arm it sits beside, and `extract`'s handling
(`:309-315`) correctly maps a network failure to the same `stalled`/input-preserving shape a quota
stall gets, for the same reason.

### `memory-contracts/curator-llm.port.ts`

Score 9/10 — 0/0/0. `CuratorStallReason` grows one member with a doc comment that states both arms'
meaning precisely; `export type`-only, correctly re-exported through `src/index.ts`.

### `memory-curator/curator-llm/curator-activity-log.ts` (new)

Score 9/10 — 0/0/0. Textbook facade extraction: the doc comment states which public methods moved,
why (FU-16b-b), and what it deliberately does not do at each recorder (no last-run overwrite on a
stall, no `curator-run` event on one). `recordDeferral`'s single method serving five different
deferral reasons via a lookup table (`DEFERRAL_SOURCES`) rather than five near-identical methods is
the right level of consolidation — one shared shape, distinguished data.

### `memory-curator/curator-llm/curator-pass-admission.ts` (new)

Score 7/10 — 0 blocking, 1 serious (the fifth `Pick`, above), 0 minor. Everything else about this
file is sound: `clearance()`'s early-return ladder (`userInitiated` → no governor → governor clear →
open back-off window) is ordered so the synchronous fast path stays synchronous, `promote()`'s
abort-and-mark-promoted mechanism is a clean way to end a wait without a second state machine, and
`networkDeferralMs`/`recordExtraction` are a minimal, correctly-scoped surface for the service to
drive.

### `memory-curator/memory-curator.service.ts`

Score 8/10 — 0/0/0. Down to 823 lines from 1068 (delta review's own facade-rule shape, matching
Batch 16's `internal-query-concurrency-gate.ts` split precedent almost exactly: name, DI token and
every public method signature unchanged). `curate()`'s clearance-then-enqueue ordering
(`:303-340`) and `doCurate`'s network-deferral check placed after the placeholder check but before
`windowForModel` (`:541-546`) both match the header's stated ordering exactly.

### `skill-synthesis/di/tokens.ts`

Score 9/10 — 0/0/0. `NETWORK_BACKOFF`'s doc comment states the sharing reason (`LaneRunnerService`
and `SkillDrainService` both consume the one instance) up front, matching the convention every other
entry in this file follows.

### `skill-synthesis/di/register.ts`

Score 9/10 — 0/0/0. `useValue: new NetworkBackoff(...)` is correctly justified inline as "plain state
with no injected collaborators," the same reasoning this file already uses elsewhere for a
`useValue` registration.

### `skill-synthesis/internal-query.interface.ts`

Score 9/10 — 0/0/0. The stream shape's network fields (`error`, `error_status`, `is_error`,
`api_error_status`) are added with a doc comment naming exactly which observer reads them and why
each is typed the way it is (`error_status: number | null` for "no HTTP response").

### `skill-synthesis/lanes/lane.types.ts`

Score 9/10 — 0/0/0. `'network-unreachable'` is added to both `SkillLaneFailureKind` and
`TRANSPORT_LANE_FAILURE_KINDS` in the same diff, with a doc comment stating the exemption-from-ceiling
reasoning inline rather than leaving a reader to infer it from `skill-drain.service.ts`'s header.

### `skill-synthesis/lanes/lane-runner.service.ts`

Score 7/10 — 0 blocking, 1 serious (shared with `skill-enhancer.service.ts`'s non-adoption, counted
there since the defect is the sibling's, not this file's), 0 minor specific to this file. The
back-off wiring itself (`networkHold`, `callFailure`'s network arm, `answered` clearing the back-off
on both the first and retried execution) is correct and well-isolated; the file's growth (819 → 902)
is proportional to what it added.

### `skill-synthesis/lanes/lane-runner.test-support.ts`

Score 9/10 — 0/0/0. The four network fields added to `StreamMessage` are a minimal, correctly-typed
mirror of the production stream shape, with a one-line comment pointing at the observer that reads
them.

### `skill-synthesis/queue/skill-drain.service.ts`

Score 7/10 — 0 blocking, 0 serious, 1 minor (the `networkDeferred` optionality comment, above). The
row-filter placement (checked per-item, only for `TOKEN_SPENDING_STAGES`, before the claim rather than
after) is correctly reasoned in the header and matches the code exactly; the growth here (1229 → 1262) is the smallest of the three growing files and proportional to the gate it added.

### CLAUDE.md updates (agent-sdk, memory-contracts, memory-curator, skill-synthesis)

Score 8/10 — 0 blocking, 0 serious, 0 minor counted separately (the `SkillEnhancerService` gap is
counted once, as a Serious finding above, since the CLAUDE.md itself surfaces it honestly rather than
hiding it). Every other numeric and behavioral claim checked line-by-line against the code matches:
the 30 s/15 min/±20% figures, the `CuratorPassAdmission`/`CuratorActivityLog` split description, the
`network-unreachable` transport-kind exemption from `maxAttempts`, and the "only the cron drain tiers
and the lane callers reach it" claim (verified — `grep` finds no other consumer of `NetworkBackoff`
in skill-synthesis besides `LaneRunnerService` and `SkillDrainService`, modulo the `SkillEnhancerService`
gap the same paragraph names).

## Pattern compliance

| Repository rule or nearby convention                                                                                                              | Status  | Evidence                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facade rule on a file at/over the soft ceiling: extract a nameable, injected/constructed collaborator                                             | PARTIAL | `memory-curator.service.ts` 1068→823 (applied); `skill-drain.service.ts` 1229→1262 and `lane-runner.service.ts` 819→902 (not applied to the new network-gating logic) |
| Shared narrow interface reused where sufficient (Batch 17's `WhenClearCapableSignal` recommendation)                                              | FAIL    | `curator-pass-admission.ts:48-51` is a fifth independent `Pick<BackgroundWorkGovernor,...>`                                                                           |
| Every background LLM caller in a library adopts that library's network-failure protection                                                         | FAIL    | `SkillEnhancerService.generateCandidate` calls `IInternalQuery` directly, bypassing `LaneRunnerService`/`QueryNetworkObserver`/`NetworkBackoff`                       |
| `catch (error: unknown)` with `instanceof Error` narrowing                                                                                        | PASS    | `sdk-internal-query.curator-llm.ts:513`, `lane-runner.service.ts:702`                                                                                                 |
| `export type` for type-only exports in barrels                                                                                                    | PASS    | `internal-query/index.ts:24-28,35`; `agent-sdk/src/index.ts:38-43`; `memory-contracts/src/index.ts`                                                                   |
| DI token registered `useValue` only where the registration is plain shared state                                                                  | PASS    | `di/register.ts:170-175`, matching this file's own established reason for `useValue` elsewhere                                                                        |
| Collaborator constructed by the service (not injected) when it has no lifecycle/alt impl/other consumer                                           | PASS    | `CuratorActivityLog`, `CuratorPassAdmission` in `memory-curator.service.ts` constructor                                                                               |
| CLAUDE.md accuracy against shipped code                                                                                                           | PASS    | numeric thresholds, log-line text, transport-kind membership all cross-checked                                                                                        |
| Naming: domain-based, not mechanism-based (`NetworkBackoff`, `QueryNetworkObserver`, `CuratorPassAdmission`, `CuratorActivityLog`, `networkHold`) | PASS    | every new symbol reads as what it does; no `helpers`/`utils`/`misc`                                                                                                   |
| ESLint / Prettier clean on touched files                                                                                                          | PASS    | `npx eslint` and `npx prettier --check` both clean on every file listed in Scope                                                                                      |

## Maintenance debt

- Introduced: one shared network-failure classifier and back-off primitive in `agent-sdk`, consumed
  identically (modulo the one gap) by two unrelated libraries; two well-scoped facade extractions in
  memory-curator; a fifth copy of a type this task's own prior review asked to be consolidated; one
  library-internal inconsistency (`SkillEnhancerService`) in a batch whose whole purpose was
  consistency across background LLM callers.
- Retired: nothing removed; additive.
- Net: positive on the classifier/back-off primitive itself (real, load-bearing, well-tested,
  correctly shared) and on memory-curator's facade split; slightly negative on the two named
  inconsistencies, both of which are cheap to close and neither of which is a runtime defect
  introduced by code that is wrong on its own terms — they are gaps in an otherwise-consistent
  pattern this exact batch was built to establish.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: this batch is the second consecutive one to leave a `Pick<BackgroundWorkGovernor,
'isClear' | 'whenClear'>` duplicate unconsolidated after an explicit, low-cost recommendation to do
  so, and it leaves one skill-synthesis stage service (`SkillEnhancerService`) outside the network
  protection every sibling stage in the same batch adopted — both findings are structural
  consistency gaps the batch's own artifacts (a prior review, a CLAUDE.md sentence) already name, not
  undiscovered defects.
- What a 10/10 version would do differently: add `WhenClearCapableSignal` to `vscode-core` and point
  all five local `Pick` aliases at it; route `SkillEnhancerService.generateCandidate` through
  `LaneRunnerService.run` (or give its deferral a tracked `FU-` id); drop the unmatched "optional for
  callers that predate the field" justification on `DrainSummary.networkDeferred`.

---

## Delta review (review fixes)

Scope: the fixes made in response to the review above, re-read against the working tree in
`D:\projects\ptah-437` (Batch 17 is now committed at `84657c380`; read-only, no nx/test runs;
`npx eslint`/`npx prettier --check` allowed). New files since the base review:
`libs/backend/skill-synthesis/src/lib/lanes/provider-network-backoffs.ts`. Changed:
`libs/backend/vscode-core/src/diagnostics/background-work-governor.ts` (+barrels),
`memory-curator/src/lib/curator-llm/curator-pass-admission.ts` (+spec), `memory-curator.service.ts`,
`memory-curator/src/lib/triggers/memory-trigger.service.ts` (+5 specs), `agent-sdk/src/lib/helpers/curator-rate-limit.service.ts`
(+spec), `agent-sdk/src/lib/internal-query/network-backoff.ts` (+spec),
`skill-synthesis/src/lib/lanes/lane-runner.service.ts`, `skill-synthesis/src/lib/queue/skill-drain.service.ts`,
`skill-synthesis/src/lib/skill-enhancer.service.ts` (+spec), `skill-synthesis/src/lib/queue/skill-queue.store.ts`
(+spec), `skill-synthesis/src/lib/di/{tokens,register}.ts`, four CLAUDE.md files.

### Serious 1 — resolved: `BackgroundWorkAdmission` replaces the fifth `Pick`

`vscode-core/src/diagnostics/background-work-governor.ts:135-138` now exports
`BackgroundWorkAdmission { isClear(): boolean; whenClear(options?): Promise<WhenClearOutcome> }`,
re-exported from both `diagnostics/index.ts` and the top-level `src/index.ts` the same way
`BackgroundWorkSignal` already was. `curator-pass-admission.ts:48-52` no longer declares its own
`Pick`; it imports `BackgroundWorkAdmission` directly and uses it at `:81`.
`memory-curator.service.ts:18,195` do the same. Batch 17's four original adopters
(`folder-index-live-sync.ts`, `code-symbol-indexer.service.ts`, `backup.service.ts`,
`plugin-activation.ts`, all confirmed still importing the shared type from `@ptah-extension/vscode-core`)
were migrated onto it in the same commit (`84657c380`), so this landed as one consolidation covering
all five sites at once rather than a sixth copy joining five. Verified: `grep -rn
"Pick<BackgroundWorkGovernor"` across `libs/` and `apps/` now returns nothing. Fully resolved.

### Serious 2 — resolved at the runtime level; the non-adoption of `LaneRunnerService` is now a justified, documented design choice

The original finding was that `SkillEnhancerService.generateCandidate` bypassed every network
protection this batch built. That is no longer true: `skill-enhancer.service.ts:750-754` checks
`this.networkBackoffs?.for(ACTIVE_PROVIDER_KEY)` and holds a background call before spending the
trajectory/spec-finding reads that precede dispatch; `:818-836` constructs its own
`QueryNetworkObserver`, feeds every stream message to it, reads `network.verdict()` after the loop,
records failure/success on the shared back-off, and returns a `PROVIDER_UNREACHABLE` sentinel
(distinct from `null`/empty) instead of ever treating the subprocess's error text as a candidate
body; the `catch` block classifies a thrown error with `classifyThrownNetworkFailure` and records a
failure the same way (`:844-848`). The caller (`:397-409`) maps `PROVIDER_UNREACHABLE` onto its own
`skipReason: 'provider-unreachable'`, so the queue observes exactly why nothing ran. This is the
correct fix for the runtime defect: a network failure can no longer be written into a skill/agent
body.

The architectural question — why not route through `LaneRunnerService.run` like every sibling stage
— now has a stated, checkable reason in `skill-synthesis/CLAUDE.md`'s new paragraph:
`generateCandidate` resolves its own judge model (`resolveJudgeModel`, not a lane's configured model)
and rides the ambient auth environment rather than a `ResolvedSkillLane`'s snapshot, so
`LaneRunnerService.run` — which resolves both from a lane — would change what model and whose
credentials the call uses. That is a real, verifiable constraint (`generateCandidate`'s signature
takes no `laneId`, `LaneResolverService.resolve` is not called anywhere in `skill-enhancer.service.ts`),
not a rationalization after the fact, so the non-adoption is accepted as a justified exception rather
than a defect.

**On the coordinator's specific question — is the duplicated hold/observe/classify sequence between
`lane-runner.service.ts` and `skill-enhancer.service.ts` acceptable, or should a shared helper
exist**: acceptable as a Minor, not worth extracting today. The genuinely shared primitives
(`QueryNetworkObserver`, `classifyThrownNetworkFailure`, `NetworkBackoff`/`ProviderNetworkBackoffs`)
are already factored out and reused correctly by both call sites — what remains inline at each site
is the few lines wiring the observer into a stream-draining loop whose OTHER job differs at each site
(the enhancer's loop collects only assistant text; the lane runner's collects text, structured
output, subtype and usage for a completely different result shape, `CallOutcome` vs. `string | null |
typeof PROVIDER_UNREACHABLE`). A shared helper would have to take a per-message callback to stay
useful for both, which trades roughly six duplicated lines for an equivalent amount of
callback-plumbing indirection — not a clear win for two call sites. `lane-runner.service.ts`'s own
header states the repository's working rule for this exact judgment ("two call sites do not make a
pattern... the two differ in what they do"). Revisit if a third caller needs the same wiring; today,
two is inside the range this repository already treats as pre-mature to abstract.

### Minor 3 — resolved: `DrainSummary.networkDeferred` is now required

`skill-drain.service.ts:259` declares `networkDeferred: number` (no longer optional). The
construction site (`:775`) initializes it to `0` unconditionally and both mutation sites (`:745`,
`:836`) assign/increment it directly with no `?? 0` guard. Matches its siblings `budgetDeferred` and
`bootDeferred` exactly. Fully resolved.

### New: `ProviderNetworkBackoffs` — a correct, well-justified evolution

`lanes/provider-network-backoffs.ts` (new) keys a `Map<string, NetworkBackoff>` by the lane's
configured provider id (`ProviderNetworkBackoffs.keyFor`, trimmed, `''` = the active provider), so a
success on a healthy provider no longer clears a different, still-down provider's window — a real
gap the single shared `NetworkBackoff` from the base review would have had once a second provider
entered the picture. The header states plainly why this is a wrapper and not a change to
`NetworkBackoff` itself (the memory curator has one provider path and correctly keeps the unkeyed
class). `allDeferring` is used correctly by `skill-drain.service.ts:716-724`
(`everyLaneNetworkHeld`) to decide the row-filter short-circuit, and by nothing else — a single,
well-scoped consumer of that method.

One Minor: the DI token constant and its symbol still say `NetworkBackoff`.
`skill-synthesis/di/tokens.ts:124` is `NETWORK_BACKOFF: Symbol.for('PtahSkillNetworkBackoff')`, but
`di/register.ts:173-178` now registers a `ProviderNetworkBackoffs` instance under it, and all three
injection sites (`lane-runner.service.ts:401-402`, `skill-drain.service.ts:660-661`,
`skill-enhancer.service.ts:275-276`) correctly type the field as `ProviderNetworkBackoffs` — only the
token constant and symbol name are stale relative to the type they now resolve. Low blast radius
(five files total reference the token: `di/register.ts`, `di/tokens.ts`, and the three consumers), so
renaming the constant to something like `PROVIDER_NETWORK_BACKOFFS` (symbol
`Symbol.for('PtahSkillProviderNetworkBackoffs')`) is a clean, cheap follow-up whenever this area is
next touched. Not blocking: the token's doc comment at `tokens.ts:118-123` already correctly
describes it as `ProviderNetworkBackoffs`, so the drift is in the identifier only, not in anyone's
understanding of what it holds.

### New: `NETWORK_BACKOFF_CEILING_LEVEL` — a real improvement over the base review's implicit ceiling check

`network-backoff.ts:78-79` names the level whose base window is already the 15-minute ceiling
(`Math.ceil(Math.log2(NETWORK_BACKOFF_MAX_MS / NETWORK_BACKOFF_INITIAL_MS)) + 1`, derived from the
two tunable constants rather than hardcoded), replacing the base review's `baseMs ===
backoffBaseMs(this.level) && this.level > 0` comparison with a named, directly-testable value
(`network-backoff.spec.ts:55-56` pins it at `6` and asserts `currentLevel` reaches it). Cleaner and
more self-documenting than what it replaced.

### New: `CuratorRateLimitService.refund` and the trigger-side network/rate-limit interaction

`curator-rate-limit.service.ts:67-73` gives back one slot from the CURRENT window only (a rolled-over
window's slot is not returned, and a bucket is never taken below zero) — both guards are correct and
match the doc comment exactly. `memory-trigger.service.ts:774-789` closes a real gap the base review
did not consider: without `heldByNetworkBackoff` checked before `tryAcquire` on all three trigger
paths (cue, episode, boot scan — confirmed all three call it), a background pass held by the network
back-off would still spend one of `maxCuratesPerHour`'s slots for work that never dispatched, and
could starve real curation for the rest of the hour once the provider recovered.
`refundIfNetworkDeferred` (`:785-789`) covers the residual race (a window opening between the
pre-check and dispatch, i.e., a pass queued behind the one that failed) by reading the new
`CuratorRunStats.deferral === 'network-backoff'` field back from the pass's own outcome and calling
`refund`. Both the pre-check and the refund are necessary and neither alone would be sufficient — a
correct, minimal two-part fix. All 8 trigger-spec mock sites gained `networkDeferralMs` consistently
(`memory-trigger.boot-defer.spec.ts:144`, `.boot-scan-budget.spec.ts:127,147,348`,
`.coalesce.spec.ts:136`, `.integration.spec.ts:44`, `.service.spec.ts:233,1899,1955,2080,2530`),
including one spec (`boot-scan-budget.spec.ts:348`) that exercises a non-zero deferral value rather
than only the default `0`.

### New: `SkillQueueStore.countEligibleByStage` and the drain's scan short-circuit

`skill-drain.service.ts:733-751` (`onlySpendingRowsEligible`) uses the new aggregate count to decide,
once per tick, whether the tier has any eligible FREE-stage row before doing the per-workspace scan
at all; when every eligible row in the tier is a token-spending stage and every provider is held
(`everyLaneNetworkHeld`), the tick skips the scan and cursor writes entirely and reports the held
count directly into `summary.networkDeferred`. This is a reasonable optimisation on top of the base
review's per-row check (`skill-drain.network-backoff.spec.ts` and `skill-queue.store.spec.ts`'s new
`countEligibleByStage` cases were both checked and both exercise it), and it degrades safely: a tier
with even one eligible free-stage row falls through to the normal per-item path
(`onlySpendingRowsEligible` returns `false` the moment it sees a non-token-spending stage in the
count), so the short-circuit can only ever skip work that would have been skipped anyway.

### File growth — recommend FU-18d, not a split now

| File                        | Before Batch 18                    | After base review | After this fix round |
| --------------------------- | ---------------------------------- | ----------------- | -------------------- |
| `skill-drain.service.ts`    | 1229                               | 1262              | 1318                 |
| `lane-runner.service.ts`    | 819                                | 902               | 915                  |
| `memory-trigger.service.ts` | 1236 (untouched by the base batch) | 1236              | 1279                 |
| `skill-enhancer.service.ts` | 1069 (untouched by the base batch) | 1069              | 1125                 |

All four were already well past the 700-line soft ceiling before Batch 18 touched them; this fix
round added between 13 and 56 lines to each, proportional to the network-awareness logic each file
gained (`everyLaneNetworkHeld`/`onlySpendingRowsEligible`, `networkHold`/`callFailure`'s network arm,
`heldByNetworkBackoff`/`refundIfNetworkDeferred`, the enhancer's inline observer wiring). None of this
growth is what pushed any file over the ceiling — that happened well before this task — and none of
the four additions is large enough on its own to name a nameable, nine-line-minimum extraction
candidate the way `CuratorActivityLog`/`CuratorPassAdmission` were in memory-curator. Recommend a
tracked `FU-18d` follow-up (matching this task's own `FU-16a..d`/`FU-16b-a..c` numbering) covering all
four files as one deferred split-candidate list, rather than a split inside this fix round: a
facade-rule extraction done under time pressure inside an already-large diff is exactly the trap the
root `CLAUDE.md`'s file-size guidance warns against ("no file under ~150 lines created just to
satisfy the cap").

### ESLint / Prettier

Clean on every file listed in Scope above. `memory-trigger.service.ts` (988 lines) and
`skill-enhancer.service.ts` (842 lines) both carry the pre-existing warn-level `max-lines` ESLint
warning only (0 errors); consistent with the file-growth table above.

### Verdict (delta)

- Recommendation: APPROVE
- Confidence: HIGH
- Both Serious findings from the base review are resolved: `BackgroundWorkAdmission` closes the
  fifth-`Pick` drift risk across all five sites in one consolidation, and `SkillEnhancerService` now
  applies the same network observation and back-off machinery as every governed lane, with its
  non-adoption of `LaneRunnerService` itself turned into a stated, verifiable design constraint
  rather than an unexplained gap. The Minor `DrainSummary.networkDeferred` fix is applied exactly as
  recommended. Two small Minor items remain from this round (the `NETWORK_BACKOFF` token/symbol name
  now lagging its `ProviderNetworkBackoffs` type; the resolve-stage back-off gap, which this round
  additionally chose to document explicitly in `curator-pass-admission.ts` rather than leave
  implicit) — neither changes the verdict. File growth across four already-oversized files is real
  but proportional and better tracked as a deferred `FU-18d` than split under this round's time
  pressure.
