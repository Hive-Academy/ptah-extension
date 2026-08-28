---
id: TASK_2026_303
status: in_progress
type: refactoring
title: >-
  Three small correctness cleanups left open by the TASK_2026_299 diagnostics
  repair
description: >-
  Three findings from the TASK_2026_299 logic review that both passes rated
  non-blocking, held back deliberately to keep that task's fix diff reviewable.
  One — both diagnostics adapters hand-roll a case-sensitive
  `path.relative(...).startsWith('..')` containment check instead of using the
  tested, case-normalizing `isPathWithinRoots` helper already in platform-core —
  is a latent Windows bug that can silently drop an in-root diagnostic on a
  drive-letter or segment casing mismatch, which reads exactly like "clean".
  The other two are honesty-of-code issues rather than behavioral defects: a
  `.next` walk in `flattenDiagnostic` that can never execute because
  `ts.Diagnostic` has no such field (real flattening already happens via
  `ts.flattenDiagnosticMessageText`, so output is correct while the mechanism
  named in the plan and the doc comment is vestigial), and two test mocks in
  `core-namespace.builders.spec.ts` shaped `{ files: [...] }` with no `success`
  field, which do not match the required `GetFileSuggestionsResult` contract and
  which forced the Batch 9 fix to use `result.success === false` rather than the
  more natural truthiness check.
---

# Three cleanups left open by the TASK_2026_299 diagnostics repair

Machine-owned metadata carrier. Prose lives in `./context.md`.
