# Context — TASK_2026_301

## Origin

Filed out of the TASK_2026_299 Batch 8 logic review (Moderate Issue 6). Both
review passes assessed it as non-blocking for that task's release, and both
flagged it as real. It is recorded in
`.ptah/specs/TASK_2026_299/code-logic-review.md` §"Failure Mode 5".

## The defect

`libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:71-76`

```ts
const configPaths: string[] = await this.fs.findFiles('**/tsconfig*.json', [...DEFAULT_WORKSPACE_EXCLUDES], 200, workspaceRoot);
```

The 200 is a bare limit argument. Nothing downstream distinguishes "discovery
returned every config in the workspace" from "discovery returned the first 200
of an unknown larger number". Configs past the cap are never visited, so any
diagnostic they would have produced is silently absent from the result.

## Why it matters here specifically

TASK_2026_299 exists because `formatDiagnostics` used to render every empty
result as "No issues found." That task fixed the formatter, then fixed a
provider-level recurrence of the same lie (a false `available` + `[]` when zero
programs were built). This cap is a third instance of the same family: a
partial answer presented with the confidence of a complete one.

The repo's own scale makes it reachable. Counting from the root `CLAUDE.md`
module index — 13 apps, 29 backend libs, 15 api libs, 25 frontend libs, 10 web
libs, plus shared/contracts — with the common three-config-per-project Nx
layout, the workspace plausibly exceeds 200 `tsconfig*.json` files without any
unusual structure.

Note the interaction with the Batch 9 fix: now that solution-style configs
recurse into `parsed.projectReferences`, reference-reachable children are
visited regardless of whether the flat glob found them. That narrows the
exposure but does not close it — a project whose config is neither in the first
200 glob results nor reachable from one that is remains invisible.

## Scope

- `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`
- `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts`

## Acceptance

- A workspace whose tsconfig count exceeds the discovery cap CANNOT return
  `{ status: 'available', diagnostics: [] }` without some signal that coverage
  was partial.
- A spec proves it, using a fixture that exceeds whatever cap the fix settles
  on (parameterize the cap so the spec does not need to write 200+ files).
- No shell/`tsc` subprocess — in-process TypeScript compiler API only, per the
  TASK_2026_299 scope guardrails, which remain binding on this file.

## Approach options (not yet decided)

1. **Page through discovery** — call `findFiles` repeatedly until exhausted.
   Most correct, most work; `IFileSystemProvider.findFiles` has no cursor today.
2. **Raise the cap + detect saturation** — if `configPaths.length === CAP`,
   append a truncation note to the `reason`, or return `unavailable`. Cheap and
   honest, but the ceiling stays arbitrary.
3. **Drive discovery from project references instead of the flat glob** — find
   root/solution configs, then walk the reference graph. Aligns with the Batch 9
   traversal work, but misses projects not reachable from any discovered root.

Recommend option 2 as the immediate honesty fix, with option 1 or 3 as the
follow-through if diagnostics coverage becomes load-bearing.

## Outcome (2026-08-26) — option 2, with the rule scoped to the false clean

Three parts, and the third is the one that matters.

1. **The cap is now a named constant, `DEFAULT_MAX_CONFIGS`, raised 200 → 2000**,
   and parameterized through the constructor so a spec can saturate it with two
   files rather than 2000. Hosts never pass it. Raising it ALONE would have been
   the wrong fix — it just moves the same lie further away — but leaving it at
   200 while making saturation observable would have turned this very repo's
   diagnostics `unavailable`, which is a real loss of usefulness.
2. **Saturation is detected** as `configPaths.length >= maxConfigs`. `findFiles`
   has no cursor and reports no overflow, so a full page is the only evidence
   available. It is read as "possibly truncated" rather than "truncated": a
   workspace holding exactly `maxConfigs` configs is indistinguishable from one
   holding more, and the safe reading of an ambiguous count is the pessimistic
   one.
3. **The rule fires only on the EMPTY result.** A saturated pass with zero
   diagnostics returns `unavailable` naming the cap — "clean" is the one claim
   partial coverage is not entitled to make, and `available` + `[]` renders as
   "No issues found", which is precisely the false clean TASK_2026_299 exists to
   remove. A saturated pass that DID find diagnostics still returns them:
   partial coverage does not make a found error wrong, and hiding a real
   diagnostic behind a capability message is the worse trade.

The `DiagnosticsResult` union was deliberately NOT changed. Adding a `partial`
flag to the `available` variant is a port-interface change touching every
consumer and the formatter, for a signal only one consumer would read. The
`unavailable` + `reason` channel already exists and already carries exactly this
meaning.

### Verified

Three new cases in `type-script-diagnostics-provider.spec.ts` under `partial
config discovery cannot report a clean result`: saturated + clean → `unavailable`
naming the cap; saturated + real diagnostics → still `available` with those
findings; and an UNSATURATED page still reports a clean project as clean — the
last one guards against the fix regressing into "every workspace is
unavailable". 22 tests pass.

### Still open, deliberately

The reference-graph walk (Batch 9) narrows the exposure — a config reachable
from one that WAS discovered is still visited — but cannot close it. A project
in neither the page nor any discovered reference graph stays invisible. That is
now REPORTED rather than hidden, which is the whole of this task; paging
discovery (option 1) remains the follow-through if coverage becomes
load-bearing, and needs a cursor `IFileSystemProvider.findFiles` does not have.
