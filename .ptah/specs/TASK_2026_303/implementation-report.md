# Implementation report — TASK_2026_303

Date: 2026-08-28
Implemented by a `backend-developer` subagent, reviewed by an independent
`code-logic-reviewer`, revised twice. The headline outcome is that **one of the
three findings described a defect that does not exist**, and the task record has
been corrected rather than quietly shipped.

## Finding 1 — the premise was refuted

`context.md` claimed a latent Windows data-loss bug: two adapters hand-rolled
`path.relative(root, file).startsWith('..')`, and `path.relative` was said to be
case-sensitive on win32, so an in-root diagnostic could be silently dropped on a
drive-letter or segment casing mismatch.

The implementer measured it. `path.win32.relative` folds case on **both**
operands. Verified independently before this commit:

| root               | file                        | result           | `startsWith('..')` |
| ------------------ | --------------------------- | ---------------- | ------------------ |
| `D:/Projects/Ptah` | `D:/projects/ptah/src/a.ts` | `src\a.ts`       | false — contained  |
| `d:/projects/ptah` | `D:/PROJECTS/PTAH/src/a.ts` | `src\a.ts`       | false — contained  |
| `/foo/bar`         | `/foo/barbaz/a.ts`          | `..\barbaz\a.ts` | true — out         |

A 13-case table driving the old form against `isPathWithinRoots` under win32
rules found **zero disagreements**. The implementer also reverted the host filter
to the pre-change form and re-ran the two new casing specs: both still passed.

So the specs do not prove a bug was fixed. They are **rule pins**, and they now
say so in their own doc blocks. They fail on the ubuntu CI runner against the old
code only because the old form follows the host's path flavour while the specs
force `platform: 'win32'` — a harness artifact.

`context.md` now carries a correction block. The original reasoning is preserved
beneath it so the correction is legible.

### What was kept, and why

The consolidation stayed, reframed honestly as a consolidation:

- one tested, platform-explicit predicate instead of three hand-rolled copies;
- the surviving copy no longer relies silently on undocumented Node behaviour;
- the two implementations are now pinned together by a table test that did not
  exist before.

That test earned its place immediately. It caught **two real disagreements** in
the twin as first written:

- dot segments escaping the root — twin said contained, helper said not. Too
  permissive.
- a backslashed file operand — twin said not contained, helper said contained.
  **This is the unrecoverable direction**: that diagnostic would have been
  dropped before `postMessage` and could never be recovered downstream.

Both were introduced by this change and caught before shipping, which is the
argument for the table.

## The transport regression, found in review and fixed

The first attempt removed the worker-side containment filter entirely and moved
the decision to the host. The implementer argued the extra volume crossing the
worker boundary was bounded because `rootFileNames` limits what gets compiled.

**That was wrong**, and the reviewer proved it. `ts.getPreEmitDiagnostics(program)`
takes no file argument and walks all of `program.getSourceFiles()` — the full
transitive closure through imports and resolved project references.
`rootFileNames` bounds compile _entry points_, not what gets diagnosed. In this
monorepo, opening a root narrower than the tsconfig reference graph would have
shipped every cross-tree diagnostic over `parentPort.postMessage` uncapped.

The deserialization side of that runs on the main thread — the exact loop
TASK_2026_323 exists to keep clear.

Containment is now checked in two places with two stated jobs, and the header
comment says so verbatim:

1. **In the worker, as a transport bound** — keeps the payload proportional to
   the root rather than to the reference graph.
2. **On the host, as the authoritative decision** — through `isPathWithinRoots`.

## Finding 2 — confirmed and fixed

The `.next` walk in `flattenDiagnostic` could never execute: `ts.Diagnostic` has
no such field, only `DiagnosticMessageChain` inside `messageText` does, and that
is already flattened by `ts.flattenDiagnosticMessageText`. The walk was deleted
and the function renamed `collectDiagnostic`, because it never flattened anything
and the old name was part of the same untruth. Output unchanged. No external
caller referenced either name.

## Finding 3 — confirmed and fixed

Two mocks in `core-namespace.builders.spec.ts` lacked the required `success`
field, which had forced the guard to read `result.success === false`. Both mocks
now carry it and the guard reads `!result.success`. The reviewer confirmed
`context-orchestration.service.ts:425-453`, the sole production producer, returns
`success` on every path including its catch branch, so no producer can return it
absent — the truthiness check is behaviour-preserving and is the more correct
check, since a result arriving without the field is malformed.

## The invariant, checked

The implementer deliberately kept the worker's `rootFileNames` filter. The
reviewer confirmed that reasoning is load-bearing: without it, a config entirely
outside the root would still build a program and increment `programCount`, while
the host stripped all its diagnostics — yielding `available` with an empty array
for a root that was never checked. That is the exact false-clean result
TASK_2026_299, 301 and 325 exist to prevent.

## Verification

`npx nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/platform-vscode @ptah-extension/vscode-lm-tools`
— 3 of 3 projects. `workspace-intelligence` 40 suites / 976 tests (up from
39 / 960), `platform-vscode` 16 suites / 182, `vscode-lm-tools` 44 suites / 881.
Zero failures. `typecheck` and `lint` green for all three.

## Beyond the brief, and judged worth it

An optional trailing `platform` parameter was added to both providers
(defaulting to `process.platform`) and threaded through the worker request.
Without it the casing specs could only run behind a `process.platform === 'win32'`
guard, which on an ubuntu CI runner means they never execute — a green tick for
untested code. The reviewer confirmed every production construction site omits
the argument, so behaviour is unchanged.

## Left open

- The twin now calls `path.resolve` twice per diagnostic, where the pre-change
  version did none. Unmeasured. Judged negligible against a `ts.createProgram`
  pass, and it is what makes the twin a true mirror of `normalize` — the
  dot-segment and backslash rows require it.
- `libs/backend/workspace-intelligence/CLAUDE.md` does not record the two-filter
  split. Nothing there is now false, but that section exists for this kind of
  fact.

## Outcome

Status `in_progress` → `done`.
