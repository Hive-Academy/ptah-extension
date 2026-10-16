# Backend implementation — `TASK_2026_646_136a`, batch 33 (P1c, route contract hardening)

**Tasks completed**: Task 33.1 (P1-C4, P1-C5, P1-C6). Implemented, not run: Nx and Jest are not run per decision #53, so the team-leader verifies.

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src`.

- MODIFIED `...\lib\contracts\route-decide-result.schema.ts`: cross-field `superRefine`s, imported constants, `Schema` suffixes, `satisfies` ties.
- MODIFIED `...\lib\contracts\route-decide-args.schema.ts`: one duplicate-pin issue, `.max(200)` on free strings, trimmed `request`.
- MODIFIED `...\lib\contracts\contracts.spec.ts`: a rejecting case for each new rule, an accepting fixture for each `exclusionReason`. Prettier also reformatted the existing cases (P1-L1).
- MODIFIED `...\lib\routing-constants.ts`: deleted `ROTATION_TASK_KINDS` and `RotationTaskKind`. The rotation-key doc now names `OutcomeTaskKind`.
- MODIFIED `...\index.ts`: removed the two exports. Prettier collapsed the `tokens` export onto one line. No other export was added or changed.

No other file was touched.

## Stack observed

- Zod 4.6.5 (`node -e "require('zod/package.json').version"`). In v4, `.superRefine` returns the same `ZodObject`, so the refined `ChosenEntrySchema` and `UnavailableEntrySchema` stay valid `discriminatedUnion` options and their `z.infer` types do not change.
- Refine style follows `matrix\matrix.schema.ts:44-83,117-132`: `ctx.addIssue({ code: 'custom', path, message })`.
- lane-routing imports only `@ptah-extension/shared` (`OUTCOME_TASK_KINDS`, `TASK_TYPES`, type `OutcomeRoutingSource`) plus in-lib files. The new type-only import is `../lane-model-listing.port` (in-lib).

## Evidence per requirement

### P1-C4: result schema (`route-decide-result.schema.ts`)

**Cross-field rules on `UnavailableEntrySchema`** (`superRefine` at `:155-182`):
- `:157-164`: `source` must be `'pin'` exactly when `exclusionReason === 'pin-unavailable'`. Issue path `['source']`.
- `:166-171`: `pin-unavailable` with `pinRule === null` is rejected. Issue path `['pinRule']`.
- `:172-181`: `reviewer-family` with `needsDisclosedFallback === false` is rejected. Issue path `['needsDisclosedFallback']`.

**Chosen executor.** The new private `ChosenExecutorSchema` (`:73-102`) is used at `:107`:
- `kind: 'lane'` with neither `cli` nor `ptahCliId` gets an issue at `['cli']` (`:84-94`).
- `kind: 'subagent'` without `role` gets an issue at `['role']` (`:95-101`).

**`AnswerSchema`** (`:194-216`) rejects `{ value: null, source: 'model' }` with an issue at `['value']`.
- Inside the generic factory, TypeScript reports TS2339 on `answer.value` (`z.output<ZodNullable<T>>` is unresolved for a generic `T`; seen with `ptah_get_diagnostics`).
- The fix is a widened, annotated view: `const answer: { readonly source: string; readonly value?: unknown } = parsed;` at `:207-208`, with a comment at `:205-206`.
- It is a plain annotation: no cast, no `any`.

**Constants imported from `../routing-constants`** (`:8-12`):
- `score`: `.min(SCORE_MIN).max(SCORE_MAX)` (`:111`)
- `usage.requests`: `.max(MAX_DECISION_REQUESTS)` (`:186`)

**`Schema` suffix on the private schemas:**

| Old name | New name | Line |
| --- | --- | --- |
| `Confidence` | `ConfidenceSchema` | `:55` |
| `Cause` | `FallbackCauseSchema` | `:56` |
| `ModelProposal` | `ModelProposalSchema` | `:57` |
| `Excluded` | `ExcludedSchema` | `:64` |
| `Usage` | `UsageSchema` | `:184` |
| `Answer` | `AnswerSchema` | `:194` |
| (new) | `ChosenExecutorSchema` | `:73` |

None of the old names was exported. A grep of `libs` finds only `reasons\compile-reasons.ts:47-51` (`EXCLUSION_RULES`, `FALLBACK_CAUSES`) and `ranking\hard-constraints.ts:22-23` importing from the contracts, and both names are unchanged.

**`satisfies` where a declared type exists:**
- `PROVENANCE` `satisfies readonly (LaneModelEntry['provenance'] | 'lane-default')[]` (`:35-41`; the declared type is at `lane-model-listing.port.ts:5`).
- The chosen source list `['model','ranking','pin']` (`:45-49`) and the unavailable source list `['pin','ranking']` (`:50-53`) each `satisfies readonly Exclude<OutcomeRoutingSource,'not-routed'>[]` (shared `lane-outcome.types.ts:33-39`). They are used at `:112` and `:148`.
- The entry and result types are `z.infer` with no declared interface, so `satisfies z.ZodType<...>` has no target there (see Decisions).

### P1-C5: args schema (`route-decide-args.schema.ts`)

- **Duplicate pin.** `:87-103` collects `pinnedPhaseIds` and raises one issue at `['pins', i, 'phaseId']` for each repeat pin on a known phase (`:96-101`).
  - It is `else if` after the unknown-phase check, so a pin never gets two issues at the same path.
- **`.max(200)`** on:
  - `phases[].reviews[]` (`:24`)
  - `pin.executor` (`:31`)
  - `pin.model` (`:32`)
  - `preferences.prefer[]` (`:54`)
- **`request`**: `z.string().trim().min(1).max(8000)` on both stages (`:41`, `:47`).

### P1-C6: rotation kinds

- `routing-constants.ts:76-81`: the K doc now reads: "``taskKind`` an ``OutcomeTaskKind`` (``OUTCOME_TASK_KINDS`` in ``@ptah-extension/shared``, the single task-kind union, plan R4j)". The constant and type are deleted.
- `index.ts:11-49`: neither name is exported any more.
- No import was added to `routing-constants.ts`. The reference is doc-only, and an unused type import would fail lint.

## Spec cases per new rule (`contracts.spec.ts`)

**Args** (`describe('route-decide arguments, P1-C5 hardening')`, `:299`):

| Rule | Case | Line |
| --- | --- | --- |
| Duplicate pin | issue paths are exactly `['pins.1.phaseId']` | `:300` |
| Duplicate pin (accepting) | one pin per phase | `:312` |
| `.max(200)` (4 fields) | 201 chars give exactly one `too_big` issue at the field: `pins.0.executor`, `pins.0.model`, `preferences.prefer.0`, `phases.1.reviews.0` | `:347` |
| `.max(200)` (accepting) | 200 chars accepted for executor, model and prefer | `:363` |
| Trim | whitespace-only `request` rejected at `request`, for both stages | `:373` |
| Trim (accepting) | `'  Plan it  '` parses to `'Plan it'` | `:383` |

`reviews` has no 200-character accepting case, because a reviewed id must name a phase and phase ids are capped at 64 (`:21`).

**Results** (`describe('route-decide results, P1-C4 cross-field rules')`, `:394`):

| Rule | Case | Line |
| --- | --- | --- |
| Accepting fixtures | `no-eligible-candidate`, `reviewer-family`, `pin-unavailable` each parse through `UnavailableEntrySchema` and `GateResultSchema` | `:416` |
| `source` / `pin` | `pin-unavailable` + `source: 'ranking'` gives `roster.0.source` | `:426` |
| `source` / `pin` | `no-eligible-candidate` / `reviewer-family` + `source: 'pin'` gives `roster.0.source` | `:436` |
| `pinRule` | `pin-unavailable` + `pinRule: null` gives `roster.0.pinRule` | `:446` |
| Disclosed fallback | `reviewer-family` + `needsDisclosedFallback: false` gives `roster.0.needsDisclosedFallback` | `:453` |
| Lane executor | no `cli`/`ptahCliId` gives `roster.0.executor.cli`; accepted with `ptahCliId` alone | `:463` |
| Subagent executor | no `role` gives `roster.0.executor.role`; accepted with `role` | `:477` |
| `Answer` | `{ value: null, source: 'model' }` gives `taskType.value` / `depth.value` | `:491` |
| `MAX_DECISION_REQUESTS` | `requests = MAX` accepted, `MAX + 1` rejected | `:517` |

## Grep results

**`ROTATION_TASK_KINDS` / `RotationTaskKind`**
- Before the change, the only code users were `routing-constants.ts:78,80,89` and `index.ts:39,49`. Every other hit was in task docs (`reviews\*.md`, `batches.md`, `HANDOFF.md`).
- After the change, `grep -rn "ROTATION_TASK_KINDS\|RotationTaskKind" libs apps tools` returns **0**.

**Batch 10 and Batch 13 fixtures that parse the result schemas.** Each fixture was checked against every new rule. None violates one, so there was no reason to stop.

| Fixture | Contents | Result |
| --- | --- | --- |
| `ranking\hard-constraints.spec.ts:220-237` | `UnavailableEntrySchema`, `reviewer-family`, `needsDisclosedFallback: true` (asserted `:210`), `pinRule: null` (`:209`), `source: 'ranking'` (`:229`) | complies |
| `reasons\compile-reasons.spec.ts:454-473` | `ChosenEntrySchema`, `kind` from the default `lane('grok')` (`:47`, `:95`) = `'lane'`, with `cli: 'grok'` (`:460`) | complies |
| `reasons\compile-reasons.spec.ts:590-617` | `UnavailableEntrySchema`, `reviewer-family`, `needsDisclosedFallback: true`, `pinRule: null`, `source: 'ranking'` (`:593-597`) | complies |
| `reasons\confidence.spec.ts:228-271` | `GateResultSchema`, two chosen `kind: 'lane'` entries with `cli` (`:234`, `:248-252`); no unavailable entry | complies |

The other `exclusionReason` fixtures in `compile-reasons.spec.ts` feed `compileUnavailableReason` only and are not parsed by the schemas. They are consistent with the rules anyway: `:526-530`, `:556-560` and `:816-821` derive `pinRule`, `source` and `needsDisclosedFallback` exactly as the refine requires.

## Verification

- `npx prettier --write <5 files>`: 4 rewritten, args schema unchanged. Rerun on the result schema after the TS2339 fix: unchanged.
- `npx eslint <5 files>`: no output, exit 0. Run once, before the 4-line TS2339 fix in `route-decide-result.schema.ts:204-208`, so the final text of that file was not linted.
- `ptah_get_diagnostics` (TypeScript compiler) on the 5 files and their project siblings:
  - First run: 1 error, TS2339 at `route-decide-result.schema.ts:204`.
  - After the fix: `Errors: 0 | Warnings: 0`, coverage clean.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | grep -E "lane-routing|FAIL|TOTAL"` printed only `degradation-audit: TOTAL 296 unsuppressed site(s)`: no lane-routing line, no FAIL.
- Not run (decision #53): `npx nx test @ptah-extension/lane-routing --parallel=1`, `nx typecheck`, `nx lint`. These are for the team-leader. The new spec cases have not been executed.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| B33-1 | `pinRule` is required non-null for `pin-unavailable`. It is NOT forced null for the other two reasons. | Also reject a non-null `pinRule` on `no-eligible-candidate` / `reviewer-family`. | Batch text "that reason names its `pinRule`" (`batches.md:1261`) and Req 2.3 (`task-description.md:169-170`) state only the pin case, and the brief says "exactly". Every current producer and fixture already sends `null` there (`hard-constraints.spec.ts:209`, `compile-reasons.spec.ts:558,819`). | yes, one more `if` in the refine |
| B33-2 | `needsDisclosedFallback` is required true for `reviewer-family`. It is not forced false for the other reasons. | Make the flag exactly equal to `reviewer-family`. | Batch text "true for `reviewer-family`" (`batches.md:1262`); Req 2.3 "set for `reviewer-family`" (`task-description.md:171`). | yes |
| B33-3 | `satisfies` goes on the const arrays that have a declared type (`LaneModelEntry['provenance']`, `OutcomeRoutingSource`). It does not go on the entry or result schemas. | Declare `ChosenEntry`/`UnavailableEntry`/result interfaces and `satisfies z.ZodType<...>` (style Moderate 3 option). | The batch says "where a declared type exists". No declared type exists for the entries: they are `z.infer` (`:250-254`). Adding interfaces is a new contract surface the batch did not assign. | yes |
| B33-4 | The executor `kind` enum stays the literal `['lane','subagent']`. | `z.enum(TIE_BREAK_EXECUTOR_KIND_ORDER)` (style Moderate 3 bullet). | Not in the Batch 33 requirement list (`batches.md:1263-1264`). A tie-break order is not the definition of the kind set. | yes |
| B33-5 | A repeat pin on an unknown phase gets only the unknown-phase issue. | Raise both issues. | Batch text "one issue at `['pins', i, 'phaseId']`" (`batches.md:1265`). | yes |

## Plan deviations

None from the batch section. One addition: the generic `AnswerSchema` refine needs the widened annotation described under P1-C4 because TypeScript cannot resolve `value` on the generic output. The behaviour is the one the batch specifies.

## Out-of-scope observations

- `reasons\compile-reasons.ts:59+` (`ROSTER_EXCLUSION_REASONS`) repeats the three-reason list that `UnavailableEntrySchema.exclusionReason` spells inline (`route-decide-result.schema.ts:130-134`). There is no compile tie between them. Not touched, because `reasons/**` is owned by another writer.
- `lane-model-listing.port.ts:5` still spells the provenance union by hand. The new `satisfies` ties `PROVENANCE` to it one way only. Deriving the port type from `PROVENANCE` (style Moderate 3) needs an edit outside this batch.
- `FALLBACK_CAUSES`, `EXCLUSION_RULES`, `PHASE_KINDS` and `DEPTHS` are still not exported from `index.ts`. That is for Batch 21 (A8), not this batch.
