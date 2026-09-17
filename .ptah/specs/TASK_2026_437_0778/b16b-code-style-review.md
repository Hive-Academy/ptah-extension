# Code Style Review — `TASK_2026_437_0778` Batch 16b

## Summary

| Metric          | Value                           |
| --------------- | ------------------------------- |
| Overall score   | 7/10                            |
| Assessment      | NEEDS_REVISION                  |
| Blocking issues | 0                               |
| Serious issues  | 2                               |
| Minor issues    | 4                               |
| Files reviewed  | 26 (14 production, 12 spec/doc) |

Scope: memory-contracts `curator-llm.port.ts` (`CuratorCallOptions`), `src/index.ts`; memory-curator
`curator-llm/curator-llm.interface.ts`, `curator-llm/curator-window-runner.ts`, `memory-curator.service.ts`
(+spec); agent-sdk `internal-query/internal-query-concurrency-gate.ts` (+spec), `internal-query.service.ts`,
`internal-query.types.ts`, `curator-llm-adapter/sdk-internal-query.curator-llm.ts` (+spec); skill-synthesis
`internal-query.interface.ts`, `lanes/lane-runner.service.ts`, `skill-judge.service.ts`,
`skill-promotion.service.ts`, `skill-synthesis.service.ts`, `skill-synthesizer.service.ts`,
`skill-curator.service.ts`, `skill-enhancer.service.ts`, `digest/skill-gap-curator.service.ts` (+ specs);
rpc-handlers `skills-synthesis-rpc.handlers.ts`, `memory-rpc.handlers.ts` (+ specs); cli-engine `container.ts`
(`governorShutdownHandle`) + `container-governor-shutdown.spec.ts`; CLAUDE.md updates in agent-sdk,
skill-synthesis, memory-curator, memory-contracts, vscode-core. Cross-checked against Batch 16's approved
review (`b16-code-style-review.md`) and against `libs/backend/workspace-intelligence/src/file-indexing/
workspace-exclusion-drift.spec.ts` as the repo's existing precedent for pinning a by-value mirror.

## Five style questions

### 1. What breaks in six months?

The `SKILL_SYNTHESIS_QUERY_LANE` mirror. `internal-query-concurrency-gate.ts:39-43` documents that this
string must equal `lane-runner.service.ts:176`'s constant of the same name, and `skill-synthesis/CLAUDE.md:62`
repeats the warning in prose ("must stay in agent-sdk's `GOVERNED_BACKGROUND_LANES` (mirrored there by
value); a renamed lane would silently stop being governed"). Nothing enforces it. The repository already has
the fix for exactly this shape — `workspace-exclusion-drift.spec.ts`, which imports both copies of a mirrored
algorithm into one spec that fails CI on divergence (`libs/backend/workspace-intelligence/src/file-indexing/
workspace-exclusion-drift.spec.ts:1-13`) — but Batch 16b did not write the equivalent for the lane strings.
A rename of either constant six months from now compiles, every existing test still passes (each lib only
ever asserts against its own copy), and skill-synthesis's background calls silently stop yielding to a
generating turn. `rpc-handlers` already imports both `@ptah-extension/agent-sdk` and
`@ptah-extension/skill-synthesis` (`skills-synthesis-rpc.handlers.ts`), so the drift pin has a natural home
and costs a five-line spec, the same shape as the exclusion one.

### 2. What would a new team member misread?

`lane-runner.service.ts:104,261`: the file imports `type QueryOrigin` and uses it correctly as a parameter
type at `skillQueryLane(origin: QueryOrigin | undefined)` (`:182`), then two lines away from the import,
declares `LaneRunOptions.userInitiated` as a bare `readonly userInitiated?: boolean` (`:261`) instead of
`extends QueryOrigin` or nesting `origin?: QueryOrigin`. A reader who sees `QueryOrigin` imported and used
once naturally assumes it is the type behind every `userInitiated` field in the file; it is behind exactly
one of two.

### 3. What does this cost to maintain?

The `userInitiated?: boolean` shape is declared independently at eight sites across four libraries:
`memory-contracts/curator-llm.port.ts:114` (`CuratorCallOptions`, the canonical type), `memory-curator/
memory-curator.service.ts:343` (`curate()` input) and `:508` (`doCurate()` input, a second inline copy of
the SAME method's own input one level down), `skill-synthesis/internal-query.interface.ts:45` (`QueryOrigin`,
skill-synthesis's own canonical type), `skill-synthesis/lanes/lane-runner.service.ts:261`
(`LaneRunOptions`), `skill-synthesis/skill-enhancer.service.ts:101` (`EnhanceOptions`), `skill-synthesis/
digest/skill-gap-curator.service.ts:274` (`DigestRequest`), and `rpc-handlers/skills-synthesis-rpc.
handlers.ts:222` (the local `ICuratorService.runManual` structural interface — this one is unavoidable,
since skill-synthesis's public barrel does not export `QueryOrigin`; see Minor). Every one of the six
non-canonical sites carries a doc comment pointing back at `QueryOrigin` or `CuratorCallOptions` ("See
`QueryOrigin`", "See `CuratorCallOptions`"), so the intent to share one shape is clearly on record — the
type-level link is what is missing. Today the shape is one optional boolean, so the cost is low; the day
`QueryOrigin` or `CuratorCallOptions` gains a second field (a request id, a reason string — plausible, since
`GateAdmissionOptions.onDeferralCeiling` already carries a lane+reason pair for a similar purpose), none of
these eight sites gets a compiler error, only the ones whose author remembers the six doc comments.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere in the mechanism itself — the lane/governor wiring in this batch matches Batch 16's precedent
exactly (delta review, `b16-code-style-review.md:270-298`) and extends it correctly: `USER_ACTION_QUERY_LANE`
is added to the same allow-list file as `MEMORY_CURATOR_QUERY_LANE`/`SKILL_SYNTHESIS_QUERY_LANE`
(`internal-query-concurrency-gate.ts:33-43`) but is deliberately NOT added to `GOVERNED_BACKGROUND_LANES`
(`:56-59`) — correct, since a user-initiated call must be the one lane that is never deferred. Positional
vs. options-object growth for `origin` (the task's own question) is answered consistently once you look at
each call site's existing shape: `SkillJudgeService.judge()` (`:157-164`) and `SkillPromotionService.
evaluate()` already accumulate several trailing optional positional params (`context?`, `lens?`, `nowFn?`)
and `origin` joins that list; `EnhanceOptions` and `DigestRequest` were already options bags and `origin`
became a field on the bag. That is the right call in both directions, not drift. The inconsistency is
narrower and specific to the shared-type question above: `QueryOrigin`/`CuratorCallOptions` is composed
by reference in exactly one place each (`skill-judge.service.ts:163`, `curator-window-runner.ts:180`,
`sdk-internal-query.curator-llm.ts:279,335`) and inlined everywhere else, including inside the very file
(`lane-runner.service.ts`) that imports the type for another purpose.

### 5. What would you have done differently, and why is that better rather than merely other?

Two changes, both small. First, `LaneRunOptions extends QueryOrigin` (drop `:261`'s own `userInitiated`
line) and `EnhanceOptions extends QueryOrigin` / `DigestRequest extends QueryOrigin` the same way — an
`extends` on an existing interface costs one line, keeps every current call site untouched (structurally
identical), and turns the eight-way doc-comment link into a compiler-enforced one. Memory-curator would do
the same against `CuratorCallOptions` at `memory-curator.service.ts:343,508`, replacing both inline fields
with `extends CuratorCallOptions`, and `line 510`'s `const callOptions = { userInitiated: input.userInitiated
}` could become `options: CuratorCallOptions = { userInitiated: input.userInitiated }` to type-pin it at
construction instead of only at the `ICuratorLLM.extract`/`resolve` call boundary. Second, a five-line drift
spec in `rpc-handlers` (the one lib that already imports both `agent-sdk` and `skill-synthesis`) asserting
`SKILL_SYNTHESIS_QUERY_LANE === 'skill-synthesis' && GOVERNED_BACKGROUND_LANES.has(SKILL_SYNTHESIS_QUERY_LANE)`,
mirroring `workspace-exclusion-drift.spec.ts`'s shape exactly. Both are pure additions with no behaviour
change, cheap now, and expensive to retrofit once a third mirrored lane or a second `QueryOrigin` field
exists and nobody remembers all eight sites.

## Blocking issues

None.

## Serious issues

### The by-value lane mirror has no drift test

- File: `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts:39-43` (comment
  documenting the mirror) vs. `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:176`
  (`export const SKILL_SYNTHESIS_QUERY_LANE = 'skill-synthesis'`); also documented in prose at
  `libs/backend/skill-synthesis/CLAUDE.md:62`.
- Problem: two libraries that cannot import each other each declare `'skill-synthesis'` as a string literal
  that must stay equal for INV-7 (background lanes yield to the governor) to hold for skill-synthesis at
  all. `MEMORY_CURATOR_QUERY_LANE` has no such mirror risk (only agent-sdk owns that string), so the finding
  is specific to `SKILL_SYNTHESIS_QUERY_LANE`. The repository already has the pattern for pinning exactly
  this shape of risk — `workspace-exclusion-drift.spec.ts` — created for a different pair of mirrored
  constants under the identical constraint (neither lib may import the other).
- Tradeoff: leaving it undocumented-by-test means the failure mode is a silent one. A future rename of
  either constant (plausible — `'skill-synthesis'` reads as a library name, and a future refactor renaming
  the lane to something more specific, e.g. `'skill-drain'`, would look like a harmless local rename from
  inside skill-synthesis) compiles clean, every existing spec in both libraries still passes (each only
  checks its own copy), and skill-synthesis's background calls stop yielding to a generating turn or to
  event-loop lag with no test failure anywhere to catch it.
- Recommendation: add a drift-pin spec in `libs/backend/rpc-handlers` (which already depends on both
  `@ptah-extension/agent-sdk` and `@ptah-extension/skill-synthesis`), importing `SKILL_SYNTHESIS_QUERY_LANE`
  from `@ptah-extension/skill-synthesis` and `GOVERNED_BACKGROUND_LANES` from `@ptah-extension/agent-sdk`,
  and asserting membership. This is cheap (under ten lines, no fixtures) and matches the existing
  `workspace-exclusion-drift.spec.ts` precedent closely enough to cite it as the template.

### `QueryOrigin` / `CuratorCallOptions` are composed by reference in one place each and inlined everywhere else

- File: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:261` (`LaneRunOptions.
userInitiated`), `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:101` (`EnhanceOptions.
userInitiated`), `libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.ts:274`
  (`DigestRequest.userInitiated`), `libs/backend/memory-curator/src/lib/memory-curator.service.ts:343,508`
  (two separate inline copies inside the SAME class's public and private method signatures).
- Problem: each site declares its own `readonly userInitiated?: boolean` / `userInitiated?: boolean` field
  with a doc comment pointing at the shared type (`QueryOrigin` or `CuratorCallOptions`) rather than
  composing it (`extends QueryOrigin`, or nesting `origin?: QueryOrigin`). `lane-runner.service.ts` is the
  sharpest evidence this is not a deliberate boundary choice: the file imports `type QueryOrigin` at line
  104 and uses it correctly as a parameter type at `skillQueryLane(origin: QueryOrigin | undefined)`
  (line 182), then re-declares the identical shape inline 79 lines later instead of reusing the type it
  already imported for the same concept.
- Tradeoff: today the shape is one optional boolean, so the eight declarations cannot yet disagree. The
  moment either canonical type gains a field, none of these sites gets a compiler error — only the ones
  whose author reads and updates all six cross-referencing doc comments by hand. `GateAdmissionOptions`
  three files over (`internal-query-concurrency-gate.ts:149-159`) already shows the shape this risk takes:
  a small options object that started with one field and grew an `onDeferralCeiling` callback alongside it.
- Recommendation: `LaneRunOptions extends QueryOrigin`, `EnhanceOptions extends QueryOrigin`,
  `DigestRequest extends QueryOrigin` in skill-synthesis; `curate()`'s and `doCurate()`'s input types
  `extends CuratorCallOptions` in memory-curator (both are inline object-literal parameter types today, so
  this is a mechanical widen-by-composition, not a public API break — every existing caller already passes
  a plain object literal that structurally satisfies the extension). Each change is a type-level annotation
  only; no call site changes.

## Minor issues

- `rpc-handlers/skills-synthesis-rpc.handlers.ts:222`: the local `ICuratorService.runManual(origin?: {
readonly userInitiated?: boolean })` is a ninth inline copy of the shape, but — unlike the two Serious
  sites above — this one is not avoidable as written: `@ptah-extension/skill-synthesis`'s public barrel
  (`src/index.ts`) does not export `QueryOrigin`, and the CLAUDE.md's own "Does NOT belong" boundary keeps
  RPC-surface types out of skill-synthesis's concerns list. If `QueryOrigin` is promoted to the shared type
  recommended above, exporting it from skill-synthesis's barrel would let this site compose it too; until
  then this is the correct workaround for a real boundary, not a defect.
- `internal-query.service.ts:144` (`if (GOVERNED_BACKGROUND_LANES.has(lane)) this.reportIfUngoverned(lane);`)
  reads the allow-list directly rather than through `this.gate.isGoverned(lane)`, which the gate already
  exposes (`internal-query-concurrency-gate.ts:254-256`) and which additionally requires a governor to be
  present. The two conditions differ on purpose (`reportIfUngoverned` must fire precisely when there is NO
  governor, so it cannot gate on `isGoverned`, which is `false` in that exact case) — checked and confirmed
  correct, not a defect — but a reader comparing the two call sites side by side has to work out why one
  reads the module-level `Set` and the other calls a method with a similar name over the same set. A
  one-line comment at `:144` stating "not `gate.isGoverned` — that requires a governor, and this warns when
  there is none" would save the next reader the trace.
- File size: `memory-curator.service.ts` (1059 lines), `skill-enhancer.service.ts` (1070),
  `skill-gap-curator.service.ts` (1271), `skill-synthesis.service.ts` (1431), `skill-curator.service.ts`
  (816) and `cli-engine/container.ts` (913) are all well past the 700-line soft ceiling. None of this is
  Batch 16b's debt — the batch's own diff to each is small (`memory-curator.service.ts` +15/-2,
  `skill-gap-curator.service.ts` +21/-4, `skill-curator.service.ts` +33/-9, `skill-enhancer.service.ts`
  +19/-3, `skill-synthesis.service.ts` +20/-3, `container.ts` +39/-4), consistent with the b16 delta review's
  finding on `cli-engine/container.ts` (already over the ceiling pre-batch, not a regression). Naming it only
  because the coordinator asked directly; none of these six files is a plausible clean-split candidate
  within this batch's own diff.
- `internal-query-concurrency-gate.spec.ts:282` sorts `[MEMORY_CURATOR_QUERY_LANE,
SKILL_SYNTHESIS_QUERY_LANE].sort()` before asserting membership rather than asserting the `Set` contents
  directly (e.g. `expect([...GOVERNED_BACKGROUND_LANES]).toEqual(...)`); this is a style preference with no
  measurable cost, noted only in case a future edit to the assertion has a reason to prefer one form.

## File-by-file

### `memory-contracts/curator-llm.port.ts`

Score 9/10 — 0/0/0. `CuratorCallOptions` is `export type`-only, correctly re-exported through `src/index.ts`
(`export type { ..., CuratorCallOptions, ... } from './lib/curator-llm.port'`), keeping the zero-dep contract
intact. The doc comment at `:104-112` states the field's meaning and its mirror in skill-synthesis precisely.

### `memory-curator/curator-llm/curator-llm.interface.ts`

Score 9/10. A pure `export type { ... } from '@ptah-extension/memory-contracts'` re-export barrel, unchanged
in shape from before this batch; `CuratorCallOptions` added to the list correctly.

### `memory-curator/curator-llm/curator-window-runner.ts`

Score 9/10. `extractAcrossWindows`/`extractOneWindow` thread `options: CuratorCallOptions = {}` straight to
`this.llm.extract`, composing the shared type at the one call site that needs it — this is the file the
Serious finding above holds up as the right shape everywhere else should match.

### `memory-curator/memory-curator.service.ts`

Score 6/10 — 0 blocking, 1 serious (shared type not composed, see above), 0 minor specific to this file.
`doCurate` at `:510` builds `callOptions` from the flattened field and threads it correctly to
`resolveWithinBudget` and `windowRunner.extractAcrossWindows` — the runtime behaviour is right, only the
type-level link to `CuratorCallOptions` is missing on the two parameter object types.

### `agent-sdk/internal-query/internal-query-concurrency-gate.ts`

Score 9/10. `USER_ACTION_QUERY_LANE` is correctly added beside its siblings and correctly excluded from
`GOVERNED_BACKGROUND_LANES` — the one lane that must never be deferred stays out of the allow-list it sits
next to, which is exactly the property the allow-list's own comment states. The class itself (governor
integration, `'disposed'` handling, FIFO drain) was already reviewed and is unchanged in this batch beyond
constant additions.

### `agent-sdk/internal-query.service.ts`

Score 8/10 — 0/0/1 (the `reportIfUngoverned` gating comment, above). `resolveLane` and the rest of the
concurrency accounting are untouched from the base review; `GOVERNED_BACKGROUND_LANES.has(lane)` at `:144`
is correct, just under-explained beside `isGoverned`.

### `agent-sdk/curator-llm-adapter/sdk-internal-query.curator-llm.ts`

Score 9/10. The lane switch (`options.userInitiated === true ? USER_ACTION_QUERY_LANE :
MEMORY_CURATOR_QUERY_LANE`, `:414-418`) is exactly the one place this decision should live — the adapter,
not the caller — and both `extract`/`resolve` and their shared private `runQuery` thread `options` uniformly.

### `skill-synthesis/internal-query.interface.ts`

Score 8/10. `QueryOrigin` is a clean, well-documented canonical type for this library — the header
correctly explains why it cannot import agent-sdk's mirror. Its only cost is that it is under-used by its
own library's other files (Serious finding above) and not exported from the public barrel (Minor above).

### `skill-synthesis/lanes/lane-runner.service.ts`

Score 6/10 — 0 blocking, 1 serious (imports `QueryOrigin`, does not compose it into `LaneRunOptions`), 0
minor. `skillQueryLane` itself is a clean three-line pure function, correctly the single place the
lane-selection decision is made for every skill-synthesis caller.

### `skill-synthesis/skill-judge.service.ts`, `skill-promotion.service.ts`, `skill-synthesizer.service.ts`,

`skill-curator.service.ts`

Score 8/10 each. All four thread `origin?: QueryOrigin` (or `origin: QueryOrigin = {}`) as a trailing
positional parameter, consistent with each service's pre-existing style of accumulating optional trailing
args, and each correctly forwards `origin?.userInitiated` into its lane call. `skill-curator.service.ts:211`'s
doc comment ("The RPC handler passes `userInitiated: true`; the interval in `start` never does") is a good,
verifiable claim.

### `skill-synthesis/skill-enhancer.service.ts`, `digest/skill-gap-curator.service.ts`

Score 7/10 each — 0 blocking, 1 serious (shared with the finding above), 0 minor. `EnhanceOptions.
userInitiated` and `DigestRequest.userInitiated` are correctly threaded to their respective lane calls
(`skillQueryLane(options)` at `skill-enhancer.service.ts:375`); the only defect is the missing `extends
QueryOrigin`.

### `rpc-handlers/skills-synthesis-rpc.handlers.ts`, `memory-rpc.handlers.ts`

Score 8/10 each. Both RPC handlers set `userInitiated: true` (or the equivalent `origin`) as a literal at
exactly one call site each (`memory-rpc.handlers.ts:628`, and the skills handler's `runManual`/`digest`/
`enhance` call sites), matching the "only an RPC handler sets it" invariant stated in both CLAUDE.md files.
`memory-rpc.handlers.ts:626-628`'s inline comment is a good, minimal explanation at the point of use.

### `cli-engine/container.ts` (`governorShutdownHandle`), `container-governor-shutdown.spec.ts`

Score 9/10. `governorShutdownHandle` is a small, correctly-named, correctly-scoped export ("Exported for
its spec only" is honest about why it is not a private function) that closes the exact gap the b16 delta
review flagged as an untested branch (`b16-code-style-review.md:393-397`). The new spec exercises both the
disposal path and the lazy-construction property (`does not construct the governor before dispose`) with
real DI resolution rather than a stub.

### CLAUDE.md updates (agent-sdk, skill-synthesis, memory-curator, memory-contracts, vscode-core)

Score 9/10. Every claim checked line-by-line against code: `agent-sdk/CLAUDE.md:86`'s "background lanes
yield" bullet matches `internal-query-concurrency-gate.ts` exactly, including the allow-list and the
`USER_ACTION_QUERY_LANE` per-lane-slot claim; `memory-contracts/CLAUDE.md:29` and `memory-curator/CLAUDE.md:35`
match `CuratorCallOptions`'s doc comment and the adapter's lane switch; `vscode-core/CLAUDE.md`'s new
"Background work yields" section (already reviewed in Batch 16, unchanged here except the "Adopters" bullet
naming `GOVERNED_BACKGROUND_LANES`'s two current members) is accurate. `skill-synthesis/CLAUDE.md:62`
correctly states the by-value mirror risk in prose — which is precisely why the missing test (Serious,
above) reads as an oversight rather than an unconsidered risk.

## Pattern compliance

| Repository rule or nearby convention                                              | Status                         | Evidence                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skill-synthesis keeps zero direct SDK/agent-sdk imports (structural mirrors only) | PASS                           | `internal-query.interface.ts` header; no `@ptah-extension/agent-sdk` import in any skill-synthesis file touched                                                        |
| memory-contracts stays zero-dep, `export type` for type-only exports              | PASS                           | `curator-llm.port.ts` has no non-type imports; `index.ts:9-17`                                                                                                         |
| Only an RPC handler sets `userInitiated: true` / `origin.userInitiated: true`     | PASS                           | grep across the batch: literal `true` appears only in `memory-rpc.handlers.ts:628` and the skills RPC handler's call sites; every drain/trigger/interval call omits it |
| A new background lane must be added to `GOVERNED_BACKGROUND_LANES`                | PASS                           | `USER_ACTION_QUERY_LANE` correctly NOT added; existing two lanes unchanged                                                                                             |
| By-value mirror across a non-importable library pair gets a drift-pin spec        | FAIL                           | no equivalent of `workspace-exclusion-drift.spec.ts` for `SKILL_SYNTHESIS_QUERY_LANE`                                                                                  |
| A field documented as "shared with type X" is composed from X, not re-declared    | FAIL                           | 6 of 8 non-canonical `userInitiated` sites inline the field instead of `extends`/nesting                                                                               |
| `catch (error: unknown)` narrowed with `instanceof Error`                         | PASS                           | `sdk-internal-query.curator-llm.ts`, `memory-curator.service.ts` unchanged catch sites                                                                                 |
| CLAUDE.md accuracy against shipped code                                           | PASS                           | cross-checked lane names, allow-list membership, "only an RPC handler sets it" claim                                                                                   |
| File size soft ceiling 700 lines                                                  | AT/OVER CEILING (pre-existing) | six files listed in Minor; none is this batch's new debt                                                                                                               |

## Maintenance debt

- Introduced: one new ungoverned lane constant (`USER_ACTION_QUERY_LANE`) correctly kept out of the governed
  allow-list; one new field (`userInitiated`/`origin`) threaded through roughly a dozen call sites across
  four libraries, each individually small and each individually correct at the call site.
- Retired: nothing removed; additive.
- Net: slightly negative on type safety specifically — the batch chose to duplicate a one-field shape by
  documentation rather than by composition in six of eight declarations, and to leave one cross-library
  string mirror without the drift pin the repository's own precedent (`workspace-exclusion-drift.spec.ts`)
  would apply to it. Both are cheap to close and neither is a runtime defect today; the review is why the
  verdict is a revision rather than a rejection.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the `SKILL_SYNTHESIS_QUERY_LANE` mirror between `agent-sdk` and `skill-synthesis` has no
  drift test despite the repository already carrying the exact pattern for pinning this shape of risk
  (`workspace-exclusion-drift.spec.ts`), and `QueryOrigin`/`CuratorCallOptions` are declared once and then
  re-declared by hand at six further sites instead of composed — both fixable as type-only, non-behavioural
  changes.
- What a 10/10 version would do differently: add the rpc-handlers drift-pin spec for the lane mirror;
  replace the six inline `userInitiated?: boolean` fields with `extends QueryOrigin` / `extends
CuratorCallOptions`; add a one-line comment at `internal-query.service.ts:144` distinguishing
  `GOVERNED_BACKGROUND_LANES.has(lane)` from `gate.isGoverned(lane)`.
