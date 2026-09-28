# Backend implementation — TASK_2026_559_8ca9, Batch 28b

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-p`.

## Changes

- CREATED `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs:14`: obtains the active WASM list through the existing `copy-wasm.js --list` CLI. That CLI invokes the shared `readManifest` and `validateManifest`; the new verifier does not duplicate a weaker manifest validator or import source across Nx project boundaries. The child process has a 30-second timeout and bounded output.
- `verify-packed-wasm.cjs:32`: selects the exact VSCE output using the packaged extension's name/version. It does not accept a stale archive selected by a wildcard. An explicit archive argument is also supported for fixtures and manual verification.
- `verify-packed-wasm.cjs:50`: reads the real VSIX ZIP with the already-installed `adm-zip` 0.6.1, enumerates archive entries and requires each active runtime/grammar at its exact `extension/wasm/...` path. Missing, empty, directory and duplicate required entries fail; unreadable/corrupt archives propagate a nonzero exit. Entries are read without filesystem extraction.
- `verify-packed-wasm.cjs:69`: fixture self-tests for positive/negative ZIP contents, process exit codes and package-target ordering.
- MODIFIED `apps/ptah-extension-vscode/project.json:118`: three sequential package commands: self-test, actual VSCE packaging, then verification of the produced VSIX. Each command disables argument forwarding. The existing VSCE options remain; `npx --no-install` prevents an implicit package install.
- CREATED `.ptah/specs/TASK_2026_559_8ca9/batch-28b-executor-report.md`: this report.

All source paths above are relative to the worktree. No runtime source, grammar asset, manifest row, lockfile, npm dependency, audit baseline or task-state document was edited.

## Review findings carried forward

Read `reviews/batch-28a-code-logic-review-r1.md`. The existing Electron and CLI verifiers are outside Batch 28b's two assigned files and were not touched, so their inline validation remains unchanged as instructed. The new VSIX verifier avoids that drift by consuming the existing validated CLI listing. It does not need an export or a cross-project source import. The review's copy-loop rollback observation also remains outside this batch; `copy-wasm.js` is unchanged.

The review summary says two Moderate issues, but its detailed numbered findings label validation drift Moderate and copy-loop rollback Minor. This report follows the actual findings rather than inventing a second validation fix.

## Fails-before and passes-after

Before implementing the verifier or changing the package target, an OS-temp probe created a valid extension fixture with the runtime and all active grammars except Python. It ran the installed VSCE 4.0.0 packager against that fixture, using the existing package options and `--no-dependencies` for the dependency-free fixture. VSCE successfully produced a real VSIX. The assertion that missing Python must fail packaging therefore failed:

```text
Old VSIX packager with Python omitted: exit 0
Old package target has WASM gate: false
Pre-change --self-test: exit 1; MODULE_NOT_FOUND=true
AssertionError [ERR_ASSERTION]: FB missing grammar in VSIX must fail packaging, but old packaging succeeded
actual: 0
operator: '!='
BASELINE_EXIT=1
```

An initial fixture omitted the mandatory activationEvents property and was corrected before recording this evidence. The recorded failure above is specifically successful packaging without Python, not a malformed-extension failure.

After writing the new self-test but before changing the old project target, ran the actual `--self-test` entry point. All archive cases reached the target-wiring assertion, which failed on the old configuration:

```text
AssertionError [ERR_ASSERTION]: The WASM gate must run after VSCE packaging
SELF_TEST_BEFORE_WIRING_EXIT=1
```

After wiring the target, the same self-test passes. The real VSCE fixture probe was also repeated with the new verifier applied to its output:

```text
PASS: real VSCE-produced VSIX with Python omitted is rejected by the new gate (exit 1)
```

Permanent self-test coverage:

- A complete real ZIP succeeds.
- Each of the six active assets independently missing fails.
- Each active asset independently empty fails.
- All WASM entries at an incorrect archive prefix fail.
- Corrupt and missing archive files throw.
- The actual verifier subprocess returns exit 1 for a missing asset and exit 0 for a complete archive.
- The package configuration must run the verifier after VSCE with parallel execution disabled.

The script did not exist on the batch base, so invoking the required self-test command there also failed with MODULE_NOT_FOUND. No claim is made that the old implementation had these new internal assertions.

## Real artifact and grammar parity

Before changing the package target, started a full uncached `nx run ptah-extension-vscode:package --parallel=2 --skip-nx-cache`. Its already-loaded original target completed successfully after 34 tasks (package plus 33 dependencies), producing `ptah-coding-orchestra-0.2.43.vsix` with 40 files. The baseline VSIX was **11,415,494 bytes**. The new verifier source is not copied into dist and was not a package entry.

Recorded every baseline archive entry's raw size and SHA-256, plus the six original source WASM hashes. Baseline packed WASM hashes match the sources. The six files are the runtime plus javascript, typescript, python, go and c-sharp, totaling **7,813,629 raw bytes**.

The updated real package run produced the same filename and **11,415,494 bytes**, a **0-byte VSIX size delta**. All 40 archive entries have identical names, raw sizes and SHA-256 content hashes before/after. Each of the six packed WASM files also matches its original source hash:

```text
Real VSIX before=11415494 after=11415494 delta=0; all 40 entry hashes identical
Artifact=ptah-coding-orchestra-0.2.43.vsix bytes=11415494; six source/packed grammar hashes match; WASM raw total=7813629
```

These are archive-entry content hashes; no claim is made about ZIP header timestamps or whole-archive byte identity.

No grammars were activated or changed. Probe ZIPs and fixture directories are cleaned in finally blocks. Full build output remains in the worktree's dist directory.

## Verification

Used `NX_ISOLATE_PLUGINS=false`, `NX_DAEMON=false`, and a maximum Nx parallelism of two. PowerShell `Select-Object -Last` provides the requested output tails. The baseline full package build explicitly skipped cache; the final package target itself is uncached.

`node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test` — exit 0:

```text
VSIX WASM self-test PASS: complete ZIP; 6 missing and 6 empty asset negatives; wrong prefix, corrupt/missing archive, CLI exits and package ordering
```

`node_modules/.bin/nx run ptah-extension-vscode:package --parallel=2` — exit 0, **34 tasks**, **0 cache hits**. The final target log proves the sequential commands actually ran:

```text
> node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test
VSIX WASM self-test PASS: complete ZIP; 6 missing and 6 empty asset negatives; wrong prefix, corrupt/missing archive, CLI exits and package ordering
> cd dist/apps/ptah-extension-vscode && npx --no-install @vscode/vsce package --allow-missing-repository --allow-star-activation
DONE Packaged: .../ptah-coding-orchestra-0.2.43.vsix (40 files, 10.89 MB)
> node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs
[verify-packed-wasm] PASS ptah-coding-orchestra-0.2.43.vsix: 6 active WASM assets present and non-empty; 11415494 archive bytes
NX Successfully ran target package for project ptah-extension-vscode and 33 tasks it depends on
Run duration: 4m 5s
Cache: 0/34 hit (0%)
EXIT=0
```

Nx reported a non-blocking remote-cache 401 because the organization is disabled. No remote cache artifact was restored; all 34 tasks ran. This did not prevent packaging or verification. A subsequent standalone `node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs` also returned exit 0 with the same six-asset/11,415,494-byte result.

`node_modules/.bin/nx run-many -t=lint -p ptah-extension-vscode --parallel=2 --skip-nx-cache` — exit 0; header names exactly one project and one task ran:

```text
NX Running target lint for project ptah-extension-vscode:
- ptah-extension-vscode
√ nx run ptah-extension-vscode:lint
NX Successfully ran target lint for project ptah-extension-vscode
Run duration: 4.4s
Critical path: 4.4s (1 task)
EXIT=0
```

`node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` — exit 0:

```text
All external imports are covered by package.json dependencies.
NX Successfully ran target validate-deps for project ptah-electron and 1 task it depends on
Run duration: 4.3s
Cache: Skipped (--skip-nx-cache)
Critical path: 4.3s (2 tasks)
EXIT=0
```

`node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — exit 0:

```text
degradation-audit: TOTAL 300 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
Run duration: 7.1s
Cache: Skipped (--skip-nx-cache)
EXIT=0
```

Common language-batch check: `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --parallel=2 --skip-nx-cache` — exit 0, both projects passed:

```text
NX Successfully ran target typecheck for 2 projects
Output of 2 successful tasks were not shown.
Run duration: 59.7s
Cache: Skipped (--skip-nx-cache)
Critical path: 59.5s (1 task)
EXIT=0
```

`npx --no-install prettier --check` on the new verifier and project.json — exit 0, `All matched files use Prettier code style!`. The report is formatted and checked at handoff.

Scoped `ptah_get_diagnostics` was attempted on the new .cjs file. The tool reported unavailable after its 45-second compiler window; no diagnostics success is claimed. The new Node script is exercised by the self-tests and actual packaging; the project lint target passes.

## Stack, deviations and handoff

- Runtime/build stack: CommonJS Node script, root Node 24.x declaration, installed VSCE 4.0.0 and existing adm-zip 0.6.1 (root manifest/lockfile and installed package metadata). Existing fs/path/assert/child_process APIs; no runtime DI or service registration. ZIP APIs were checked in installed adm-zip source before use.
- No scope deviation. Full package verification requires the declared extension/webview/library build dependency graph; no workspace-wide test/lint/build target was invoked.
- Existing repository guidance and Batch 28a's instruction reads remain applicable. The extension eslint config simply extends the root config. The referenced language-plan packaging and security sections were read again.
- No git command was run because this executor role prohibits git invocation, including status. No commit, staging or branch mutation occurred; caller should inspect status during review.
- Cross-side reviewer approval remains the caller's responsibility. This is implementation evidence, not independent review approval.
