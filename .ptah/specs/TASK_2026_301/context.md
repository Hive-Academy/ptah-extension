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
