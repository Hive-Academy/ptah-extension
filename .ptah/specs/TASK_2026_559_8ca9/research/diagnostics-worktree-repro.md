# Task 1.2: timing repro for the worktree-scoped single-file `ptah_get_diagnostics` case

Diagnosis only. No fix code was written. Script: `diagnostics-worktree-repro.ts` (next to this file, not shipped).

## Method

The script starts the real worker program (`TS_DIAGNOSTICS_WORKER_SOURCE`,
`new Worker(src, { eval: true, workerData: { tsModulePath } })`, as in `TsDiagnosticsWorker.ensureWorker`). It
sends the request `TypeScriptDiagnosticsProvider.compute` builds for a one-file scope:

- `tsModulePath`: `require.resolve('typescript', { paths: [boundRoot] })`, the same rule as
  `resolveTypescriptModulePath` (`type-script-diagnostics-provider.ts:150-166`)
- `configPaths`: the same upward walk as `resolveOwningConfigs` (`:493-525`). It takes every `tsconfig*.json` in the
  nearest ancestor directory that holds one
- `normRoot`: the bound root, with forward slashes

`WORKER ms` is the time from `postMessage` to the reply. For the same configs, an instrumented pass on the script
thread then logs what the worker does not report: the extends chain, `rootNames`, program size, how many program files
sit outside the checkout that owns the scoped file, and the time split between `createProgram` and
`getPreEmitDiagnostics`.

File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (the audit's file). The
main checkout and this worktree were both at `9afac1aa2`. `typescript` 6.0.3 and Node v24.15.0 on Windows 11.
`<WT>/node_modules` is a symlink to the main checkout's `node_modules`, so every case resolves the same compiler
(`D:/projects/ptah-extension/node_modules/typescript/lib/typescript.js`) and uses the same shared worker. The main
checkout was only read.

Commands, run from the worktree root:

```
node_modules/.bin/ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node10","ignoreDeprecations":"6.0"}' .ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.ts
node_modules/.bin/ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node10","ignoreDeprecations":"6.0"}' .ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.ts hol
```

## Results: isolated runs (one request on the worker at a time)

| Case | Bound root | configPaths (resolved) | programCount | Program files (lib / spec) | Outside owning checkout | Worker ms |
| --- | --- | --- | --- | --- | --- | --- |
| a: main file | main | main `vscode-lm-tools/tsconfig{,.lib,.spec}.json` | 2 | 2,266 / 2,686 | 0 | **22,766** |
| b: worktree file | main | `<WT>/…/vscode-lm-tools/tsconfig{,.lib,.spec}.json` | 2 | 2,266 / 2,686 | 0 | **26,620** |
| c: worktree file | worktree | `<WT>/…/vscode-lm-tools/tsconfig{,.lib,.spec}.json` | 2 | 2,266 / 2,686 | 0 | **25,139** |
| d: audit worktree `feat-task-538-surface-contract-v2` file (read only) | main | that worktree's 3 configs | 2 | 2,265 / 2,685 | 0 | **23,384** |
| a′: main file again (warm worker) | main | as (a) | 2 | 2,266 / 2,686 | 0 | **26,484** |

Details common to every case:

- Resolved tsconfig chain: `tsconfig.json` (`files: []`, gives rootNames 0 and no program) → references
  `tsconfig.lib.json` (80 rootNames) and `tsconfig.spec.json` (67 rootNames). Each extends `./tsconfig.json`, which
  extends the `tsconfig.base.json` of **the checkout the file lives in**. In (b)/(c)/(d) the chain never reaches the
  main checkout's configs.
- Every program file outside `node_modules` is inside the file's own checkout (`programFilesOutsideCheckout: 0`).
  `node_modules` holds 1,257 (lib) / 1,573 (spec) files and is the same symlinked tree in every case. No
  `@ptah-extension/*` package is linked in `node_modules`. Aliases resolve through `tsconfig.base.json` `paths`,
  which point back into the same checkout.
- Instrumented split per program: `createProgram` 2.4–4.1 s, `getPreEmitDiagnostics` 7.9–12.8 s. Two programs are
  compiled one after the other.
- Diagnostics: 0 in every isolated case.

**The worktree case does not reproduce in isolation.** A worktree-scoped single-file call builds the same program
(same config chain shape, same file count, no cross-checkout files) and costs the same as the main-checkout call:
23–27 s. The spread comes from machine load, not from the case. Binding the provider to the worktree root instead of
the main root (c vs b) changes nothing that matters. The inferred mechanism in `research/workspace-files.md` §5
(module resolution pulls in a larger or different graph because a worktree has no `node_modules`) is **refuted** for
this repo: `node_modules` is a symlink and every program is identical in size.

## Results: head-of-line case (a second request queued behind a running compile)

The worker is synchronous and shared per compiler (`ts-diagnostics-worker.ts:12-26`: "a second message simply waits
in that worker's own message queue"). `withBudget` answers the caller at 45 s but does **not** cancel the run
(`type-script-diagnostics-provider.ts:241-284`). A caller that got "still running after 45s" therefore leaves its
compile occupying the only worker for that compiler.

Case e posts a larger run first: the main checkout's `apps/ptah-electron` configs, 10 configs. It stands in for the
unscoped call that the audit probe made just before its worktree call. The worktree single-file scope is posted
immediately after it. Both calls are bound to the main root.

| Request | configPaths | programCount | collected | ms (from its own post) |
| --- | --- | --- | --- | --- |
| blocker | 10 × `apps/ptah-electron/tsconfig*.json` | 9 | 2,348 | 65,237 |
| worktree single-file scope | `<WT>/…/vscode-lm-tools/tsconfig{,.lib,.spec}.json` | 2 | 4 | **86,182** |

The scoped call took 86 s, which is ~21 s of its own work plus ~65 s of waiting. That is well past the 45 s budget,
so through the provider it returns the same "TypeScript check still running after 45s" message the audit recorded.
(The 4 collected diagnostics come from in-progress edits to this worktree's `vscode-lm-tools` sources made during the
run by Task 1.3. They do not affect the timing.)

## Conclusion

The mechanism is named with evidence, and it is not specific to worktrees:

1. **Head-of-line blocking on the shared per-compiler worker (primary).** The 45 s budget abandons the caller but not
   the compile. Any later call, scoped or not, whose runs share that compiler queues behind it. On this machine that
   means every checkout, because every worktree's `node_modules` symlinks to the same `typescript`. The audit's
   sequence was a scoped main call, then an unscoped call that hit 45 s and kept compiling (hundreds of configs,
   minutes of work), then the worktree scoped call. That sequence matches this mechanism exactly. The worktree call
   timed out because it queued behind the abandoned unscoped compile, not because it was a worktree.
2. **A cold single-lib scope is ~23–27 s, not "seconds" (contributing).** One file in `vscode-lm-tools` compiles two
   full programs (lib + spec, ~2,300–2,700 files each, including every lib reachable through `paths`). That uses
   50–60% of the 45 s budget with nothing queued ahead. Machine load alone can push it over. The audit's "main scoped
   call returned in well under a second" is not reproduced cold. It was most likely served from the 5 s result cache
   or an in-flight run with the same key. That is unverified, since the probe did not record cache state.

What is refuted: a worktree-specific config-chain or module-resolution defect. `resolveTypescriptModulePath` binding
to the server root (`:150-166`) has no effect here, because both roots resolve the same compiler through the symlink.

**Implication for Batch 19 scope (team-leader decision):** the provisional files for Task 19.1
(`type-script-diagnostics-provider.ts:150-166`) do not hold the mechanism. The defect is in the scheduling between
`withBudget` (`type-script-diagnostics-provider.ts:241-284`) and the shared worker queue (`ts-diagnostics-worker.ts`,
`run`/`ensureWorker`). Scoped runs wait behind an abandoned unscoped run on the same thread. Candidate directions,
none chosen here: a scoped run does not queue behind an unscoped one (separate worker or lane per scope class); or a
superseded unscoped run is terminated once no caller is waiting and nothing will read its cache entry. Task 19.2's
second-checkout contract case stays useful as a guard, but by these numbers it will pass at HEAD.
