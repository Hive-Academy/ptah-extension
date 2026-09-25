# Code Logic Review — `TASK_2026_538_3ccf` — Batch 1

Scope: Batch 1 ("Shared contract core"), Tasks 1.1-1.6, as implemented by the codex CLI lane.
Files read in full: `surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`, `surface-data-model.ts`,
`dashboard-spec.schemas.ts` (diff only: two `export` keywords at lines 239 and 279), `testing/fixtures/surface.ts`,
`surface-contract.spec.ts`, `surface-data-model.spec.ts`. Cross-checked against `implementation-plan.md` Components
1-4 (lines 233-425) and `task-description.md` Requirements 1-4 and the Security NFR. `batch-1-report.md` and
`batches.md` (Batch 1 section, lines 142-267) read for the executor's own account and the team-leader's verification
notes.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score        | 8/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 2                                     |
| Failure modes found   | 2 (both mitigated in-batch; noted as residual scope dependencies) |

Verification performed independently, beyond reading:
- Ran a standalone Node script (zod 4.6.5, the version pinned in this repo) confirming `z.number()` rejects
  `NaN`, `Infinity` and `-Infinity` by default in this zod version (see Q2 below).
- Ran a standalone Node script reproducing the `z.record` + `__proto__` behaviour the executor found: without the
  `checkRawObjectKeys` preprocess, a payload `{"__proto__": true}` parses successfully with an **empty** output
  object — the dangerous key is silently dropped, not rejected. This confirms the defect the executor fixed was
  real (a silent-acceptance bug, not exactly literal `Object.prototype` mutation at that layer — see Q1).
- Ran a script confirming that `{...model, [dynamicKey]: value}` (the pattern `surface-data-model.ts` uses) is
  immune to prototype pollution by JS spec (`CreateDataProperty` via computed key bypasses the inherited
  `__proto__` accessor setter), so the denylist check in `surface-data-model.ts` is defence-in-depth against
  *downstream* code that might later copy the data model with `obj[key] = value` assignment, not a fix for a
  pollution hole in this file's own spread pattern. The check is still correct and required by Req 4.1's letter
  ("the segments... shall be rejected"), and the executor's tests assert the right thing (rejection + prototype
  descriptors unchanged), even though the literal mechanism they guard against differs slightly from what the
  code comment implies.
- Did not re-run the full scoped Nx target (team-leader's report already shows 67/67 suites, 1882/1882 tests,
  typecheck and lint green, tailed). No reason to doubt that evidence.

## Five logic questions

### 1. How does this fail silently?

- The most significant near-miss, already caught and fixed by the executor: prior to the `checkRawObjectKeys`
  preprocess, `SurfaceDataValueSchema`/`SurfaceDataModelSchema`/`SurfaceActionSchema.params` would have accepted a
  payload containing a `__proto__` key by silently dropping it rather than rejecting the envelope — a classic
  "success-looking result masking a hostile write" failure. This is fixed at `surface.schemas.ts:448-461` (the
  `checkRawObjectKeys` preprocess, applied at every recursion level via `dataObject()`, `surface.schemas.ts:463-473`
  and inside `SurfaceActionSchema.params`, `:140-147`). Verified independently (see Summary) and pinned by
  `surface-contract.spec.ts:519-538`.
- `readSurfacePath` (`surface-data-model.ts:79-106`) and `applyDataModelOps` (`:205-245`) both catch all exceptions
  and return a generic, non-leaking rejection reason. This is a deliberate, documented choice ("do not leak their
  diagnostics") rather than a silent failure — the caller always gets `ok:false`, never a false success. Confirmed
  by `surface-data-model.spec.ts:117-127, 250-260`.
- No other silent-success path was found. Every rejection path in the new files returns an explicit `ok:false` /
  zod issue; nothing swallows an error and returns a default that looks like success.

### 2. What user action produces unexpected behaviour?

- An agent that sends a v1-catalog envelope containing a v2-only kind (e.g. `select`) is rejected, per Req 1.4 —
  confirmed by `surface-contract.spec.ts:79-88` (`DashboardSpecEnvelopeSchema.safeParse` with a v2 component fails).
- An agent that reuses a v1 `specId` prefixed `v1:` as a v2 surface id gets a schema error naming
  `ptah_dashboard_propose_spec` (`surface.schemas.ts:71-84`), not a generic "invalid id" message — this is
  intentional and matches Requirement 1's v1/v2 disjointness design, not a defect.
- Nothing in this batch handles user-facing RPC/MCP flows (that is Batches 5, 9-13), so no user-facing "unexpected
  behaviour" beyond schema rejection semantics is in scope here.

### 3. What input data produces a wrong answer rather than an error?

- None found that produces a *wrong* (non-error) answer. The two areas most likely to hide a silently-wrong result
  — non-finite numbers and depth/width budgets — are both hard errors, not silent truncations:
  - `z.number()` in this repo's zod (4.6.5) rejects `NaN`/`Infinity`/`-Infinity` by construction (independently
    verified, see Summary), so `SurfaceStatComponentSchema.value`/`.delta` and `SurfaceDataValueSchema` numbers are
    protected without any bespoke `.finite()` call. See Q2 for the residual test-coverage gap on the *specific*
    stat/delta fields.
  - `applyDataModelOps` validates every op's value with `checkDataValue` (`surface-data-model.ts:126-163`) using
    `Number.isFinite`, matching the schema.
- One reachable-but-benign asymmetry: `readSurfacePath(model, path)` **without** a `kind` argument returns
  `undefined` for both "path absent" and "path present but stores `undefined`" — the latter should be structurally
  impossible reaching this function honestly (the data model type excludes `undefined`), so this is not a real
  ambiguity today, only a note for later batches that pass user-controlled `kind`-free reads through this function.

### 4. What happens when a dependency fails?

- Batch 1 has no I/O, network or DI dependency — it is pure, platform-neutral code (catalog constants, types, zod
  schemas, and pure data-model functions). The only "dependency" is the zod library itself and the v1
  `dashboard-spec.schemas.ts` helpers it imports by value (`requireOneDataSource`, `checkChart`, and several leaf
  schemas). Those are read-only imports of stable, already-shipped code; nothing here could fail at runtime due to
  a missing or slow external dependency.
- The one place an "exotic dependency" (an in-process object with a throwing getter) is exercised, both
  `readSurfacePath` and `applyDataModelOps` fail closed with a generic message and do not throw through to the
  caller (`surface-data-model.ts:102-105, 241-244`; tests at `surface-data-model.spec.ts:117-127, 250-260`).

### 5. What is missing that the requirements never mentioned?

- The component-tree recursion in `surface.schemas.ts` (`children()`, `:187-190`) has **no schema-level depth
  bound** — only a per-node `maxChildrenPerNode` cap. `SurfaceComponentSchema` alone, called directly (bypassing
  the Batch 4 validator's pre-parse iterative walk), could in principle be driven into a `RangeError` (stack
  overflow) by an adversarially deep chain of single-child layout nodes, before ever reaching a size/byte check.
  This is explicitly plan-assigned to Batch 4 ("iterative walk bounding component tree depth... **then** zod",
  `implementation-plan.md:410-411`), so it is not a Batch 1 omission by the plan's own division of labour — but it
  is a real dependency: Batch 1's schema module is not safe to call directly against untrusted input until Batch 4
  lands. Noted under Q7 below and as a Moderate finding, not a defect of this batch.
- Nothing else in Requirements 1-4 or the Security NFR that was assigned to Batch 1 (Components 1-4) is missing;
  see the Requirements fulfilment table.

## Failure modes

### Component-tree recursion has no depth bound at the schema layer (scope dependency, not a defect)

- Trigger: `SurfaceComponentSchema` (or `SurfaceEnvelopeSchema`) parses an untrusted payload with many levels of
  single-child layout nesting, called directly rather than through the Batch 4 validator's iterative pre-walk.
- Symptom: a `RangeError: Maximum call stack size exceeded` instead of a clean zod rejection.
- Evidence: `surface.schemas.ts:187-190` (`children()` has only `.max(maxChildrenPerNode)`, no depth check);
  contrast with `dataValueAtDepth` (`:426-442`), which does hard-stop data-value recursion at
  `maxDataModelDepth`.
- Current handling: none in this batch; by design, deferred to `surface.validator.ts` (Batch 4, Task 4.4), which
  runs an iterative walk **before** the zod parse specifically to guard against this.
- Recommendation: no action for Batch 1. The team-leader should confirm Batch 4 lands before any Batch 1 schema is
  wired to a live MCP/RPC boundary that accepts untrusted input (the plan's own batch ordering already guarantees
  this — Batch 4 depends on Batch 1 and nothing downstream calls the schema directly before Batch 4 lands).

### `z.number()`'s non-finite rejection is not pinned for `stat.value`/`.delta` or chart series numeric fields specifically

- Trigger: none today — this is a coverage gap, not a live bug.
- Symptom: if a future refactor swapped `z.number()` for something laxer on `SurfaceStatComponentSchema.delta` or
  `chartShape`'s series values, no test in this batch would catch the regression for those specific fields.
- Evidence: `surface.schemas.ts:337` (`delta: z.number().optional()`), `:335` (`value: z.union([boundedString(),
  z.number()])`); the only non-finite-number regression tests are generic, against `SurfaceDataValueSchema`
  (`surface-contract.spec.ts:510-518`) and the pure `applyDataModelOps` (`surface-data-model.spec.ts:222-239`),
  neither of which touches the stat/chart component schemas.
- Current handling: protected today only because zod 4.6.5's base `z.number()` happens to reject non-finite values
  repo-wide (independently verified, see Summary) — there is no explicit `.finite()` call or dedicated test on
  these fields.
- Recommendation: Moderate, not blocking. A follow-up test (in this batch's own spec or Batch 4's budget spec)
  asserting `SurfaceComponentSchema.safeParse({...statFixture, delta: Infinity})` and `{..., value: NaN}` fail
  would close the gap cheaply.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: no schema-level bound on component-tree recursion depth (see Failure modes above); acceptable only
  because Batch 4 is a hard dependency before any untrusted caller reaches this schema.
- Moderate: `z.number()` non-finite rejection is untested for `stat.value`/`.delta` and chart series values
  specifically (see Failure modes above).
- Minor: two unused typed `catch (error: unknown)` bindings, `surface-data-model.ts:102` and `:241` (5 total lint
  warnings reported by the executor, 2 from this file). The bindings are intentionally unused — the code
  deliberately discards exception diagnostics at a trust boundary rather than leak them — so this is a style/lint
  cleanliness issue, not a logic defect. Accept as-is, or silence cleanly with `catch { ... }` (no binding) or a
  `_error` name if the team wants zero lint warnings; either is a one-line change with no behaviour impact.

## Data flow

1. Catalog constants (`surface-catalog.ts`) define the fixed vocabulary — versions, kinds, actions, patterns,
   budgets — with no logic of their own. OK: budgets are named constants; shared ones are read from
   `DASHBOARD_LIMITS` by reference, not retyped (verified: `maxComponents`, `maxTreeDepth`, `maxStringLength`,
   table/series limits all equal the v1 constants via `toBe`, `surface-contract.spec.ts:47-56`).
2. Plain types (`surface.types.ts`) mirror the catalog with zero zod reachability. OK: verified both by the
   source-scan test (`surface-contract.spec.ts:594-611`, checks no `from 'zod'` and no non-type import in this
   file) and by direct reading — every import is `import type`.
3. Zod schemas (`surface.schemas.ts`) are the JSON boundary. OK for every per-kind shape, strictness, hint
   validation, URL/params rules and the `__proto__` guard (see Q1-Q6). Gap: no depth bound on component-tree
   recursion (see Failure modes) — deferred by design to Batch 4, which sits directly downstream in the dependency
   graph before any live boundary uses this module.
4. Pure data-model functions (`surface-data-model.ts`) implement path parsing, reads and copy-on-write patch
   application. OK: never mutates input (tested against frozen fixtures), atomic across an op list (validates all
   ops before applying any, and a mid-application failure discards the partially-built `next` without ever
   exposing it), remove-of-missing is a no-op, set-through-scalar is an error naming the path, denylisted segments
   are rejected before any write.
5. Fixtures and specs (`testing/fixtures/surface.ts`, `surface-contract.spec.ts`, `surface-data-model.spec.ts`)
   round-trip every one of the 13 kinds, reject unknown keys/free-form styling, and directly test the R12 security
   controls. OK, and independently spot-checked (Object.prototype non-pollution, non-finite rejection, JSON schema
   generation) rather than taken only on the executor's word.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 1.1 (v1 unchanged) | COMPLETE | None — only two `export` keywords added (`dashboard-spec.schemas.ts:239,279`), no behaviour change, v1 specs unedited and green. |
| Req 1.2 (v2 versions validate) | COMPLETE | `SurfaceEnvelopeSchema` with `z.literal` version fields. |
| Req 1.3 (mixed/unknown pair names the field) | COMPLETE | Verified via `it.each` test naming `schemaVersion`/`catalogVersion` (`surface-contract.spec.ts:89-104`). |
| Req 1.4 (v1-catalog + v2 kind rejected) | COMPLETE | `surface-contract.spec.ts:79-88`. |
| Req 1.5 (main barrel stays zod-free) | PARTIAL for this batch | `surface.types.ts` itself is zod-free and type-only (verified); the main barrel `libs/shared/src/index.ts` export wiring is explicitly Batch 6's task (Task 6.5), not this batch's scope. No gap within Batch 1's own file list. |
| Req 2 (layout primitives, budgets, presentational enums) | COMPLETE | Per-kind `.strict()` schemas, named budget constants, enum-only `direction`/`gap`, bounded `columns`; limit/limit+1 tested (`surface-contract.spec.ts:170-240`). |
| Req 3.1-3.5 (inputs, options, hints, string caps) | COMPLETE | Hints `.strict()` reject `pattern`/`regex`; `minLength <= maxLength` refined; options bounded/unique; tested at budget and budget+1 (`surface-contract.spec.ts:298-366`). |
| Req 3.6 (draft vs submit-valid) | OUT OF SCOPE for Batch 1 | Draft/submit validation logic (`checkDraftValue`/`checkSubmitValues`) is explicitly Batch 4 (`surface-bindings.ts`). Empty-value table is delivered here (`SURFACE_INPUT_EMPTY_VALUES`, `surface-catalog.ts:61-66`) and read correctly by `readSurfacePath`. |
| Req 3.7 (binding compatibility) | OUT OF SCOPE for Batch 1 | Explicitly Batch 4 (`surface-bindings.ts`, `checkBindingCompatibility`). |
| Req 4.1 (path denylist, prototype untouched) | COMPLETE | `SURFACE_PATH_DENYLIST` enforced in the schema (`SurfacePathSegmentSchema` refine, `checkRawObjectKeys` preprocess) and in the pure functions (`isSafeSegment`, `checkDataValue`); `Object.prototype` descriptor equality asserted before/after (`surface-data-model.spec.ts:44-71, 187-201`). |
| Req 4.2 (finite JSON only, depth budget) | COMPLETE | Non-finite numbers, `undefined`, functions and cyclic values rejected at both the schema and pure-function layer; depth tested at limit and limit+1, including the "model root counts toward depth" rule (`surface-contract.spec.ts:539-555`, `surface-data-model.spec.ts:202-221`). |
| Req 4.3 (byte budgets, request-level checks) | OUT OF SCOPE for Batch 1 | Explicitly Batch 4 (`surface.validator.ts`); Batch 1 only defines the named constants. |
| Req 4.4 (missing path reads as empty value) | COMPLETE | `readSurfacePath` with a `kind` argument returns `SURFACE_INPUT_EMPTY_VALUES[kind]` for an absent path (`surface-data-model.ts:93-97`; tested `surface-data-model.spec.ts:90-98`). |
| Req 4.5 (set/replace/remove/remove-missing pure function) | COMPLETE | `applyDataModelOps`; all four cases tested, plus atomicity and no-mutation (`surface-data-model.spec.ts:130-221`). |
| Security NFR items assigned here (path denylist, strict hints, minLength≤maxLength, unique/bounded options, URL-only-via-DashboardUrlSchema, params forbidden on submit, data keys valid/not-denied) | COMPLETE | All directly verified by reading and independently re-checked for the `__proto__` case (see Summary). |

Implicit requirements not addressed (correctly, by plan division): whole-document semantic validation (unique ids,
aggregate component count/depth, input count, binding compatibility, submit scope, byte-budget enforcement) — all
explicitly Batch 4. None of this was silently dropped; the executor's own report says so and the plan assigns it
elsewhere (see Q7).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| v1 envelope parses identically after this task | YES | `surface-contract.spec.ts:79-88` round-trips a v1 fixture unchanged | None |
| Mixed/unknown version pair | YES | Named-field rejection, `it.each` test | None |
| v1-catalog envelope with a v2 kind | YES | Rejected, tested | None |
| Path absent from data model reads as empty value | YES | `readSurfacePath` + `SURFACE_INPUT_EMPTY_VALUES`, tested per kind | None |
| Remove of a missing path | YES | No-op success, including beneath a scalar and with no parent chain at all | None |
| `__proto__`/`prototype`/`constructor` as a path segment or object key, at every depth and every entry point (schema and pure function) | YES | Denylist + preprocess guard; `Object.prototype` descriptor equality asserted | None |
| Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) in generic data values | YES | zod's default `z.number()` behaviour in this repo's zod version, plus explicit pure-function check | None |
| Non-finite numbers specifically in `stat.value`/`.delta`/chart series | Indirectly (same `z.number()`) | Not pinned by a field-specific test | Moderate — see Failure modes |
| Data-model depth at limit / limit+1, including "model root counts as depth 1" | YES | Tested in both schema and pure function, consistently | None |
| Set through an existing scalar/array parent | YES | Named error, tested for `1, false, null, 'text', []` | None |
| Set creating missing parent objects | YES | Tested | None |
| Cyclic in-process object passed to the schema | YES | Rejected without throwing (`surface-contract.spec.ts:551-554`) | None |
| Throwing getter on an in-process object | YES | Generic rejection, no diagnostic leak, both read and write paths | None |
| Deeply nested component tree (structure, not data) | NOT in this batch | No schema-level bound; relies on Batch 4's pre-parse walk | Moderate — flagged as a scope dependency, not a Batch 1 defect |
| `SurfaceAnyIdSchema` accepting a `v1:`-prefixed id that itself contains a colon | YES | Matches v1's own `SLUG_PATTERN` (`[A-Za-z0-9._:-]*`) plus the `v1:` prefix and length budget; tested `v1:old:slug` accepted, bare `v1:` rejected | None |

## Team-leader's points

**1. `checkRawObjectKeys` preprocess before `z.record` — is the guard sound, and does it keep the named JSON Schema
definitions for Batch 13?**

Sound, and independently re-verified rather than taken on trust. I reproduced the underlying zod behaviour with a
standalone script: `z.record(...).safeParse({"__proto__": true})` (no guard) returns `success: true` with an
**empty** output object — the record parser silently drops the `__proto__` key instead of rejecting it or
including it. That is a real defect class (silent acceptance of a payload that should be rejected under Req 4.1's
"reject the whole envelope" rule) which the executor's fix closes: `checkRawObjectKeys`
(`surface.schemas.ts:448-461`) runs as a `z.preprocess` step ahead of every `z.record` call — both `dataObject()`
(`:463-473`, invoked once per recursion level via `dataValueAtDepth`, so nested objects at every depth get their
own guard) and `SurfaceActionSchema.params` (`:140-147`) — and adds a zod issue via `ctx.addIssue` when a denied key
is present as a real own property (confirmed this survives JSON.parse, which does create `__proto__` as a genuine
own enumerable property, unlike the JS object-literal special case). The regression is pinned by
`surface-contract.spec.ts:519-538` across `SurfaceDataValueSchema`, `SurfaceDataModelSchema` and
`SurfaceActionSchema.params`, at every nesting position.

On JSON Schema preservation: `surface-contract.spec.ts:585-593` calls `z.toJSONSchema(SurfaceUpdateInputSchema, {
io: 'input' })` and asserts the output still contains `'SurfaceComponent'`, `'SurfaceDataValue'`, `'propertyNames'`,
`'maxItems'` and `'additionalProperties'`. This is a real, non-trivial check: `z.toJSONSchema` throws on
unrepresentable effects/preprocess nodes unless it can resolve through them, so a passing test here is meaningful
evidence that wrapping `z.record(...)` in `z.preprocess(checkRawObjectKeys, ...)` does not break generation and
that the `.meta({id:...})` named definitions for `SurfaceComponent` and `SurfaceDataValue` survive into the schema
Batch 13 will consume. I did not independently re-run `z.toJSONSchema` against the compiled schemas (would require
a TS build step outside this review's time budget), so this conclusion rests on the test's own assertions plus the
team-leader's already-reported green run — reasonable but not re-derived from first principles.

**2. `z.number()` for data values, stat value and delta — does zod 4.x here reject Infinity/NaN, and is it pinned?**

Yes to the first half, confirmed independently: I ran `z.number().safeParse(Infinity/-Infinity/NaN)` against the
exact `zod@4.6.5` installed in this repo's `node_modules` and all three return `success: false`. This is a zod v4
behavioural change from v3 (v3's bare `z.number()` accepts `Infinity` unless `.finite()` is chained); this repo's
schemas rely on that v4 default rather than calling `.finite()` explicitly anywhere.

Pinning is partial. `SurfaceDataValueSchema` (and therefore the general data-model value) is directly pinned:
`surface-contract.spec.ts:510-518` tests `NaN`/`Infinity`/`-Infinity` rejection at root and nested, and
`surface-data-model.spec.ts:222-239` pins the same for the pure `applyDataModelOps` path. But `stat.value`
(`surface.schemas.ts:335`) and `stat.delta` (`:337`), plus the chart `series` numeric fields reused from
`DashboardSeriesSchema`, have no field-specific regression test. They are protected today only because they also
use plain `z.number()` and inherit the same zod-version default — correct behaviour, but an unpinned one. See
Moderate finding above.

**3. `dataValueAtDepth` counts root as depth 1 — checked at limit and limit+1?**

Yes, and the design is internally consistent between the two independent implementations (zod schema and the pure
function), which is itself good evidence against a divergence bug. Traced the recursion: `dataValueAtDepth(depth)`
permits a container (array/object) only while `depth < maxDataModelDepth`, and recurses children at `depth+1`;
`SurfaceDataValueSchema = dataValueAtDepth(0)` (a standalone root value), while `SurfaceDataModelSchema =
dataObject(dataValueAtDepth(1))` (the model record itself is an implicit, unconditional container, and its
*values* start at depth 1) — so wrapping a value that is valid on its own at exactly `maxDataModelDepth` inside the
model pushes it one level over budget. This is exactly what `surface-contract.spec.ts:539-555` tests: `atLimit =
makeSurfaceDataAtDepth(maxDataModelDepth)` succeeds standalone against `SurfaceDataValueSchema` **and** against
`SurfaceDataModelSchema` at the top level, but `SurfaceDataModelSchema.safeParse({ value: atLimit })` (one level
deeper) fails. The pure-function equivalent (`checkDataValue`, `surface-data-model.ts:126-163`, called with
`depth=0` on the whole model in `applyDataModelOps`) enforces the identical rule, and its own spec
(`surface-data-model.spec.ts:202-221`) tests both a path exactly `maxDataModelDepth` segments deep (succeeds) and
one segment deeper (fails), plus the same "value nested at the limit, placed under the model" case failing. Both
limit and limit+1 are covered on both sides, and the two implementations agree.

**4. Chart `series` capped by `SURFACE_LIMITS.maxComponents` — matches the v1 series bound?**

Yes, exactly. v1's chart schema caps `series` with `FINITE_ARRAY_MAX = DASHBOARD_LIMITS.maxComponents`
(`dashboard-spec.schemas.ts:217, 273`). v2's `chartShape.series` uses
`z.array(DashboardSeriesSchema).max(SURFACE_LIMITS.maxComponents)` (`surface.schemas.ts:344-347`), and
`SURFACE_LIMITS.maxComponents` is defined as `DASHBOARD_LIMITS.maxComponents` by direct reference, not a retyped
literal (`surface-catalog.ts:84`, confirmed equal by `toBe` in `surface-contract.spec.ts:55`). No discrepancy.

**5. Does `SurfaceAnyIdSchema` accepting a `v1:`-prefixed id containing `:` match the v1 specId grammar?**

Yes. v1's slug pattern is `SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/` (`dashboard-spec.schemas.ts:76`) — it
already permits colons inside the slug body. `SurfaceAnyIdSchema`'s v1 branch is
`/^v1:[A-Za-z0-9][A-Za-z0-9._:-]*$/` (`surface.schemas.ts:87-93`) — the identical character class, prefixed with
the literal `v1:` marker, with a length budget of `DASHBOARD_LIMITS.maxStringLength + 'v1:'.length` (i.e. the v1
slug's own max length plus the 3-character prefix). This is a faithful reflection of the v1 grammar, not an
independently-invented one, and is exercised by `surface-contract.spec.ts:124-125` (`'v1:old:slug'` accepted,
bare `'v1:'` rejected).

**6. Two unused catch bindings in `surface-data-model.ts` (lines ~102, ~241) — fix or accept?**

Accept as delivered; it's a lint-cleanliness nit, not a logic problem. Both are deliberate: the code catches any
exception from an exotic in-process accessor and intentionally discards its message so no internal diagnostic
leaks to the caller, replacing it with a fixed, generic reason string (`'Cannot read surface path "..."'` /
`'Cannot apply surface data operations.'`). The two lint warnings the executor reported are a direct, expected
consequence of that choice, not an oversight — the alternative (naming the binding but using it) would mean
partially leaking the exception, which is what the code is explicitly trying to avoid. If the team wants a clean
lint run, `catch { ... }` (bindingless, valid since ES2019) or a `_error`-prefixed name removes the warning with no
behavioural change; recommended as a trivial follow-up, not a gate on this batch.

**7. Whole-document rules deferred to Batch 4 — was anything in Batch 1 scope dropped?**

No. Cross-checked the plan's Component-4/Component-5 split (`implementation-plan.md:372-425`) against what Batch 1
actually delivers. Batch 1 (Components 1-4) owns per-kind schema shape, per-node/per-array budgets, and the *pure*
data-model algebra (`parseSurfacePath`, `readSurfacePath`, `pathsOverlap`, `applyDataModelOps`) — all present and
tested. Batch 4 (Component 5, `surface.validator.ts`, plus `surface-bindings.ts`, `surface-patch.ts`,
`surface-concurrency.ts` under Component 4's remaining files) owns whole-document aggregation: total component
count and tree depth across the *whole* tree (not just per-node), unique component/action ids, input count,
binding compatibility, draft/submit validation, submit scope, and byte-budget enforcement including the
byte-counter-based request checks. The executor's own report (`batch-1-report.md`, "Handoff and work not
performed") states this explicitly and it matches the plan's own division, not a unilateral scope cut. The one
concrete consequence — `SurfaceComponentSchema` has no schema-level recursion-depth guard, so calling it directly
against untrusted input before Batch 4 lands could stack-overflow rather than cleanly reject — is a real,
worth-naming dependency (see Failure modes), but it is the plan's intended ordering (Batch 4 depends on Batch 1,
and nothing after Batch 1 reaches an untrusted boundary before Batch 4 exists), not a gap inside Batch 1's own
mandate.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: `SurfaceComponentSchema`'s component-tree recursion has no depth bound of its own; it is safe only
  because Batch 4's pre-parse iterative walk is a hard dependency before any untrusted caller can reach it. If a
  later batch ever calls this schema directly against untrusted input without going through the Batch 4 validator
  first, a deeply nested payload could raise a `RangeError` instead of a clean rejection.
- What a robust implementation would add: (1) a dedicated non-finite-number regression test for `stat.value`,
  `stat.delta` and chart series `y`/`x` values, not just the generic data-value schema; (2) optionally, a
  belt-and-suspenders shallow recursion cap inside `SurfaceComponentSchema` itself (even a generous one, e.g. 64)
  so the module is safe to unit-test or reuse in isolation without relying on caller discipline; (3) silencing the
  two intentional unused-catch-binding lint warnings with `catch { ... }` for a clean lint run.
