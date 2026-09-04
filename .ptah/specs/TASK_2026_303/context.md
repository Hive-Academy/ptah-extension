# Context — TASK_2026_303

## Origin

Three findings from the TASK_2026_299 Batch 8 logic review (Moderate Issues 7
and 9, plus a follow-up raised in the re-review). Both review passes rated all
three non-blocking. They were held out of Batch 9 deliberately so the fix diff
for the three genuine defects stayed small and reviewable — not because they
are wrong.

Grouped into one task because each is a sub-hour change in the same
neighbourhood of code. Split it if any one grows.

---

## 1. Case-sensitive root containment (the one with real risk)

**Files**:

- `libs/backend/platform-vscode/src/implementations/vscode-diagnostics-provider.ts:36-41`
- `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:124-129` and `~223-225`

Both adapters hand-roll containment:

```ts
const rel = path.relative(normRoot, normFile);
return !rel.startsWith('..') && !path.isAbsolute(rel);
```

> **CORRECTION, 2026-08-28 — the premise below is FALSE. There is no Windows
> data-loss bug.** It was measured during implementation and refuted, then
> re-verified independently. `path.win32.relative` folds case on BOTH operands,
> so `path.relative(...).startsWith('..')` is NOT case-sensitive on win32:
>
> ```
> path.win32.relative('D:/Projects/Ptah', 'D:/projects/ptah/src/a.ts')
>   -> 'src\\a.ts'      startsWith('..') === false   (contained, correctly)
> path.win32.relative('/foo/bar', '/foo/barbaz/a.ts')
>   -> '..\\barbaz\\a.ts'  startsWith('..') === true  (out, correctly)
> ```
>
> A 13-case table driving the old form and `isPathWithinRoots` under win32 rules
> found ZERO disagreements, including drive-letter casing, segment casing and the
> separator boundary. On a Windows host the old code did the right thing.
>
> What was actually shipped for this finding is therefore a **consolidation**,
> not a bugfix: one tested, platform-explicit predicate in place of three
> hand-rolled copies, one of which was silently relying on undocumented Node
> behaviour. The new casing specs are RULE PINS, not regression tests — they pass
> against the old code too on a Windows host, and fail on the ubuntu CI runner
> only because the old form follows the host's path flavour while the specs force
> `platform: 'win32'`. That is a harness artifact, not a production defect.
>
> The original, incorrect reasoning is preserved below so the correction is
> legible. Do not act on it.

`path.relative` is case-sensitive even on win32. When `workspaceRoot` and a
diagnostic's file path differ only in casing — routine on Windows when one path
comes from `vscode.Uri.fsPath` and the other from a caller-supplied string —
a legitimate in-root diagnostic is filtered out. No error is raised. The result
is a shorter diagnostics list that looks exactly like a cleaner project.

The repo already has the correct helper, with an explicit win32
case-insensitivity test:

- `libs/backend/platform-core/src/utils/path-containment.ts:71` — `isPathWithinRoots(path, roots, platform)`
- `libs/backend/platform-core/src/utils/path-containment.spec.ts:74` — the win32 casing case

The TASK_2026_299 plan permitted either approach ("use `path.relative` +
`startsWith`, **or** the existing `isPathWithinRoots` helper"), so this is not a
plan violation — it is the weaker of two sanctioned options, chosen twice.

**Fix**: route both adapters through `isPathWithinRoots`. Add a spec case with
mismatched casing to each; today nothing exercises this path.

---

## 2. Vestigial `.next` walk in `flattenDiagnostic`

**File**: `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:213-241`

The loop casts `(current as ts.Diagnostic & { next?: ts.Diagnostic }).next` and
iterates while truthy. `ts.Diagnostic` — the top-level object returned by
`getPreEmitDiagnostics` — has no `.next` field, so the cast always yields
`undefined` and the `while` body runs exactly once. `.next` exists on
`DiagnosticMessageChain`, which lives inside `messageText`, not on the
diagnostic itself.

Output is not wrong: the flattening that actually matters is already handled by
`ts.flattenDiagnosticMessageText(current.messageText, '\n')` at line ~234. The
problem is that tasks.md Task 5.1 named "flatten message chains
(`diagnostic.next`)" as a requirement, the file's doc comment repeats it, and
the code appears to implement it while doing nothing. A future reader will trust
a mechanism that cannot fire.

**Fix**: delete the `.next` walk, keep `flattenDiagnosticMessageText`, and
correct the doc comment to describe what actually happens. Verify no diagnostic
output changes.

---

## 3. Two non-contract-shaped test mocks

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts:391` and `:441`

Both mock `contextOrchestration.getFileSuggestions` with `{ files: [...] }` /
`{ files: [] }` and no `success` field. The real contract
(`libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts:161-177`)
declares `success` as a required `boolean`, and the sole production
implementation always sets it literally.

This had a concrete consequence: the Batch 9 fix for the resolved-failure path
had to be written `if (result.success === false)` rather than
`if (!result.success)`, because truthiness would have rejected both mocks and
regressed two green tests. The re-review confirmed the strict check is sound in
production and identified the mocks as the non-contract-shaped party.

**Fix**: add `success: true` to both mocks, then simplify the guard in
`core-namespace.builders.ts:166` to `if (!result.success)`. Both changes must
land together or the tests break.

---

## Acceptance

- `isPathWithinRoots` used in both diagnostics adapters, with a casing spec each.
- `.next` walk removed; doc comment matches behavior; diagnostics output unchanged.
- Both mocks carry `success: true`; the guard reads `!result.success`.
- `npx nx run-many -t test -p workspace-intelligence,vscode-lm-tools,platform-vscode`
  stays green. Do not weaken any TASK_2026_299 assertion to accommodate these
  changes.
