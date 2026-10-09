# Code logic review — Batch 25 Task 25.2, re-review round 2

## Verdict: APPROVED — 8/10

**Score rationale.** Round 1's blocking finding is fixed. The production entry now
loads the private U1 panel manifest through `panelManifestSchema`, a valid manifest
produces `method: 'model-panel'` with the verified panel string, and a missing or
invalid manifest produces verdict `na` with a content-free
`ground-truth-untrusted: panel-manifest-…` reason — never `labelled`. No manifest
bytes reach results, logs, or errors. The remaining findings are Minor. Zero
blocking, zero serious, zero moderate findings, three Minor findings; one failure
mode was traced (the loader's catch path) and confirmed silent-but-honest.

## Round 1 finding 1 — fixed

Evidence:

- `run-memory-skills.entry.ts:46` resolves `benchDataDir` once and
  `run-memory-skills.entry.ts:81-84` passes `loadRubricPanelManifest(benchDataDir)`
  as `panelManifest` to `createRubricAgreementSuite`.
- `rubric-panel-manifest.ts:9-13,26` builds exactly
  `<benchDataDir>/labelling/merged/u1-rubric.manifest.json`;
  `rubric-panel-manifest.ts:31` parses the bytes with `panelManifestSchema`.
- On a valid manifest, `rubric-agreement.suite.ts:306-317` passes the loader's
  panel to `loadRubricGroundTruth` via `panelProvenanceFromManifest`
  (`rubric-ground-truth.ts:271-284`, panel string from `evaluatePanelEligibility`),
  so `truth.method` is `model-panel` and `rubric-agreement.suite.ts:380-381`
  emits the verified panel string in the ground-truth block.
- On a missing manifest, `rubric-panel-manifest.ts:27` returns
  `panel-manifest-missing`; on invalid JSON or a schema failure,
  `rubric-panel-manifest.ts:33-35` returns `panel-manifest-invalid`. In
  `runRubricAgreement`, `rubric-agreement.suite.ts:345-348` turns either into
  `naReason = ground-truth-untrusted: <reason>` and the verdict ternary
  (`rubric-agreement.suite.ts:349-354`) yields `na`.
- `rubric-agreement.suite.ts:371-379` guarantees `groundTruth.method` is
  `model-panel` with `panel: 'unverified'` whenever the loader failed, for any
  truth state. `labelled` can only appear when the caller omits
  `deps.panelManifest` entirely, which production never does.

## Required checks

1. **Manifest bytes never leak.** The loader's catch discards the thrown error
   object (`rubric-panel-manifest.ts:33-35`); `zod` issue text is never used. The
   two reasons are opaque enum tokens in
   `rubric-panel-manifest.ts:19`. `naReason`, claim text, and ground truth carry
   only those tokens and the literal `unverified`. The specs pin this explicitly
   (`rubric-panel-manifest.spec.ts:50-59,61-68`: "without exposing file content").
   The other `RubricGroundTruthError` messages predate this batch and read only
   counts and file names.
2. **Hash-mismatch still gives `fail`.** The verdict ternary checks
   `truth.state === 'hash-mismatch'` before the `naReason` branch
   (`rubric-agreement.suite.ts:349-354`), so an invalid manifest plus a
   hash-mismatched fixture still yields `fail`; the `naReason` spread at
   `rubric-agreement.suite.ts:402` only attaches on `na`. A valid manifest keeps
   the pre-fix hash behaviour unchanged (the `files`/`FileCheck` path at
   `rubric-ground-truth.ts:326-361` is untouched).
3. **`options.panel` tests still work.** When `panelManifest` is `undefined`,
   `rubric-agreement.suite.ts:306-311` falls back to `options.panel` exactly as
   before; the schema's rater-id cross-check
   (`rubric-agreement.suite.ts:74-84`) still applies. The updated committed-U1
   test injects a panel through `options.panel` and passes (test 18 of the run
   below), and the eligibility-failure test at `rubric-agreement.suite.spec.ts`
   still uses `laneManifest` with the round-1 corrected shapes.
4. **Precedence is sensible.** The loader result wins whenever present
   (`rubric-agreement.suite.ts:306-311`): a valid manifest overrides
   `options.panel`; a failed load suppresses both, so production can never fall
   back from "manifest unreadable" to "options say labelled". Since
   `panelManifestSchema`'s `superRefine` already runs `evaluatePanelEligibility`
   (`model-panel.ts:175-182`), the loader only ever returns eligibility-passing
   panels, so `panelProvenanceFromManifest`'s throw path
   (`rubric-ground-truth.ts:275-277`) cannot fire on this route; if it ever did,
   the runner records the suite as `status: 'error'` with the message
   (`offline-suites.ts:83-107`), not silently.
5. **Spec coverage matches the requested set.** Missing file
   (`rubric-panel-manifest.spec.ts:43-48`), malformed JSON (`:50-59`), schema
   failure (`:61-68`), valid manifest with the U1 lanes (`:70-106`), and the
   committed-fixture missing-manifest case through `createRubricAgreementSuite`
   (`rubric-agreement.suite.spec.ts:375-404`, asserts verdict `na`, the exact
   reason, and `groundTruth.method !== 'labelled'`).
6. **Verification (memory-safe, as mandated).**
   `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/rubric-panel-manifest.spec.ts tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts --coverage=false --maxWorkers=2` —
   exit 0: `Test Suites: 2 passed, 2 total`, `Tests: 18 passed, 18 total`
   (output tail read from the temp file). No nx, no full target, no build.

## Minor findings

1. **Minor — the entry wiring itself has no test.** The round-1 direction asked
   for an integration-level assertion on the production invocation. The suite-level
   missing-manifest test (`rubric-agreement.suite.spec.ts:375-404`) proves the
   suite honours `deps.panelManifest`, and the loader has its own spec, but nothing
   executes `run-memory-skills.entry.ts:79-84` to prove the two are wired with
   `benchDataDir`. `entry` files in this runner follow the repo's untested
   composition-root convention, so the gap is a convention-consistent one, but a
   future edit that drops the `panelManifest` argument would pass every suite test.
   File: `tools/mcp-bench/src/memory-skills/runner/run-memory-skills.entry.ts:81-84`.
2. **Minor — silent override of `options.panel`.** When a valid loader manifest and
   `options.panel` are both present, the loader panel wins and the options panel is
   ignored without a warning (`rubric-agreement.suite.ts:306-311`). The report
   declares this precedence, and in production the risk is low because the plan's
   `options` for this suite contain no panel today. It is recorded here so the
   behaviour is documented, not accidental. File:
   `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.ts:306-311`.
3. **Minor — manifest rater ids are not cross-checked against `options.raters`.**
   The schema cross-check at `rubric-agreement.suite.ts:74-84` applies only to
   `options.panel`; a loader manifest whose `raters[].raterId` differ from
   `options.raters` is accepted and its rater ids simply go unused (the panel
   string uses families, and the label columns follow `options.raters`). A real
   mismatch would mean the manifest raters differ from the two committed CSV
   column pairs; today's default `['r1', 'r2']` matches the committed data, and a
   mismatch would still surface as agreement metrics over the wrong labels only
   if `options.raters` were also changed. File:
   `tools/mcp-bench/src/memory-skills/suites/skills/rubric-panel-manifest.ts:23-36`.

## Five logic questions

1. **Silent failure:** The loader's catch (`rubric-panel-manifest.ts:33-35`)
   swallows every read/parse/schema error, but it reports a distinct, honest
   `panel-manifest-invalid` reason that drives verdict `na` — a failure becomes an
   explicit untrusted result, not a silent success. The only true silent path left
   is the options-panel override (Minor 2).
2. **Unexpected user action:** A corrupt or deleted
   `<benchDataDir>/labelling/merged/u1-rubric.manifest.json` degrades the run to
   `na` with the exact reason instead of crashing or mislabeling provenance.
   Fixtures with hash drift still fail the verdict first.
3. **Wrong-answer input:** A schema-valid manifest is guaranteed
   eligibility-valid because the schema `superRefine` runs
   `evaluatePanelEligibility` (`model-panel.ts:158-183`), so the verified panel
   string cannot be built from ineligible families. A population/unresolvedCount
   mismatch against the loaded documents is still enforced at
   `rubric-ground-truth.ts:444-455`.
4. **Dependency failure/shape:** A missing or invalid manifest is a typed result,
   never bytes; a valid-but-later-inconsistent manifest is caught by the existing
   population checks; a thrown loader (impossible today) would surface as suite
   `status: 'error'` in the runner (`offline-suites.ts:83-107`).
5. **Unspecified/missing requirement:** The production wiring is now a contract
   ("always pass the loader result"), enforced only by convention — Minor 1. This
   is the residual gap round 1 named and it is now narrow, documented, and
   convention-consistent.

## Checks performed for the clean areas

- Read the full loader, suite, entry, `rubric-ground-truth.ts` provenance and
  trust paths, and `model-panel.ts` schema/eligibility; traced both failure load
  results through verdict, naReason, claim, and ground-truth blocks.
- Confirmed the committed-U1 suite test still exercises real fixture bytes (105
  items, 37 adjudications, `method: 'model-panel'`).
- Confirmed no `.filter(`-style post-hoc trimming on the ground-truth or verdict
  logic; all branches are exhaustive over `truth.state` and loader outcomes.