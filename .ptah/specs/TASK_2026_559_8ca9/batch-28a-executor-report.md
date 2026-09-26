# Backend implementation — TASK_2026_559_8ca9, Batch 28a

Implemented Tasks 28a.1 and 28a.2 in `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-p` only. Ready for the caller's independent review; no commit or branch operation performed.

## Changes and consumers

- CREATED `scripts/tree-sitter-grammars.json:1`: schema version, consumer inventory, runtime and grammar rows. Package sources include exact installed/lockfile version, package-relative path, licence file, licence identifier and measured raw bytes. Five current grammars remain active. Six future package grammars and Kotlin remain inactive.
- MODIFIED `scripts/copy-wasm.js:31`: validates rows, unique names/IDs, safe paths, sizes and runtime presence; pending vendored provenance cannot become active. `:99` reads bounded JSON through a repository-contained real path. `:112` resolves package assets through Node's worktree-compatible lookup, verifies package identity/version/licence and bytes, or checks contained vendored asset/licence paths and SHA-256. `:151` verifies all active sources before writing output. `:171` contains self-tests. The `--list` interface supplies CI's required WASM paths.
- MODIFIED `apps/ptah-electron/scripts/verify-packed-wasm.js:32`: bounded, contained JSON read; `:63` derives requirements exclusively from active rows. `:90` checks the actual asar. Python and Go are now checked alongside the previously checked runtime/JS/TS/C#. `:159` adds real asar fixture self-tests.
- MODIFIED `apps/ptah-cli/scripts/verify-packed-wasm.cjs:17`: bounded, contained JSON read; `:48` derives requirements exclusively from active rows. `:52` inspects real tar entries and extracted bytes; `:131` adds tarball fixture self-tests. Normal execution still runs real npm pack, checks the resulting archive, and removes it; subprocesses now have explicit timeouts.
- MODIFIED `.github/workflows/publish-cli.yml:354`: runs all three self-tests. `:373` obtains dist WASM requirements through `copy-wasm.js --list`; the hard-coded WASM list is removed. The existing real npm-pack gate remains.
- CREATED `.ptah/specs/TASK_2026_559_8ca9/batch-28a-executor-report.md`: this report.

All paths above are relative to the worktree stated above. No parser, lazy-loading, activation, dependency, baseline, prompt or registration file was edited. The shared copier remains the packaging consumer for VSIX, Electron and CLI. A VSIX packed verifier belongs to Batch 28b and is not introduced here.

## Manifest inventory

`P` = package `@vscode/tree-sitter-wasm`, version **0.3.1**, source path `wasm/<filename>`, licence file `LICENSE`. All package sizes were measured on locally installed files; exact package versions and MIT identifiers match the checked-in lockfile and installed package metadata.

| Grammar / runtime       | Active | Source                                 | Version | Licence                                             | Raw bytes |
| ----------------------- | ------ | -------------------------------------- | ------- | --------------------------------------------------- | --------: |
| web-tree-sitter runtime | yes    | `web-tree-sitter/web-tree-sitter.wasm` | 0.27.0  | MIT                                                 |    209613 |
| javascript              | yes    | P / `tree-sitter-javascript.wasm`      | 0.3.1   | MIT                                                 |    411770 |
| typescript              | yes    | P / `tree-sitter-typescript.wasm`      | 0.3.1   | MIT                                                 |   1413849 |
| python                  | yes    | P / `tree-sitter-python.wasm`          | 0.3.1   | MIT                                                 |    457883 |
| go                      | yes    | P / `tree-sitter-go.wasm`              | 0.3.1   | MIT                                                 |    217182 |
| c-sharp                 | yes    | P / `tree-sitter-c-sharp.wasm`         | 0.3.1   | MIT                                                 |   5103332 |
| tsx                     | no     | P / `tree-sitter-tsx.wasm`             | 0.3.1   | MIT                                                 |   1445638 |
| java                    | no     | P / `tree-sitter-java.wasm`            | 0.3.1   | MIT                                                 |    414641 |
| rust                    | no     | P / `tree-sitter-rust.wasm`            | 0.3.1   | MIT                                                 |   1113644 |
| php                     | no     | P / `tree-sitter-php.wasm`             | 0.3.1   | MIT                                                 |   1058041 |
| ruby                    | no     | P / `tree-sitter-ruby.wasm`            | 0.3.1   | MIT                                                 |   2106352 |
| cpp (later also C)      | no     | P / `tree-sitter-cpp.wasm`             | 0.3.1   | MIT                                                 |   5394393 |
| kotlin                  | no     | reserved vendored asset; see below     | 1.1.0   | MIT, per approved plan metadata; provenance pending |      null |

Runtime licence file: `web-tree-sitter/LICENSE`. Kotlin reserves `assets/tree-sitter/tree-sitter-kotlin.wasm` and `assets/tree-sitter/LICENSE.kotlin`, with upstream package identity `@tree-sitter-grammars/tree-sitter-kotlin`. `sha256` and bytes are explicitly null and `provenancePending` is true. No Kotlin file, fabricated hash, source URL or approximate byte measurement is claimed. Batch 30k must supply and review exact bytes, hash, source URL, licence text and load record before activation. A pending row made active fails manifest validation.

## Fails-before evidence and regression coverage

Before editing any production script, ran `node $env:TEMP/ptah-28a-baseline.cjs` in this worktree. It loaded the original Electron verifier definitions without its main entry point and created a real asar with non-empty runtime, JS, TS, Go and C# files, deliberately omitting Python. Observed:

```text
FB missing Python must fail: FAIL (old verifier returned [])
FB manifest exists: FAIL
```

The diagnostic probe printed both failed expectations and exited zero so it could also collect baseline copy hashes; this was not a passing regression suite. The named Batch 28a FB case was demonstrated on the unmodified verifier, before the manifest existed. The permanent Electron self-test now asserts a missing-entry failure for every active row, including Python and Go, against a real asar.

Self-test coverage:

- Copier: successful vendored copy; same-size hash tampering rejects the build before any destination is created; missing licence file; escaping source path; missing hash; active pending provenance; duplicate row; invalid filename; absent active runtime; invalid byte count; installed package version mismatch; actual asset size mismatch; exact active-only output list; activating a cloned TSX row causes TSX copying without editing a hand list.
- Electron: complete real asar succeeds; each of six active assets independently missing fails; each independently empty fails (13 crafted archives).
- CLI: complete real tarball succeeds; each of six active assets independently missing fails; each independently empty fails (13 crafted tarballs). These preserve and extend verifier coverage; the old CLI already checked the current six assets.

The hash/schema negatives are new contract coverage, not claims that the old copier supported a manifest or vendored assets. No separate Jest spec filename is named by Batch 28a; its specified test entry points are the three `--self-test` commands.

## Packaging parity

The pre-edit probe ran the original copier into separate Electron and VSIX fixture output directories and recorded all filenames, byte counts and SHA-256 hashes. The post-edit parity probe compared both fresh outputs to that baseline:

```text
electron: six filenames, byte counts and SHA-256 hashes identical; raw byte delta 0; total 7813629
vsix: six filenames, byte counts and SHA-256 hashes identical; raw byte delta 0; total 7813629
```

The filenames are `web-tree-sitter.wasm` and the javascript, typescript, python, go and c-sharp grammars. Fixture directories were removed in finally blocks; no fixture directories remain. No full VSIX/Electron/npm distribution was built: Batch 28a specifies fixture self-tests; Batch 28b owns the real VSIX size measurement. Electron's validate-deps target did run its normal build-main dependency.

## Verification

Nx commands used `NX_ISOLATE_PLUGINS=false` and `NX_DAEMON=false`; parallelism was capped at two. PowerShell `Select-Object -Last` is the tail equivalent used here. Logs stayed in OS temp; no baseline was edited.

`node scripts/copy-wasm.js --self-test` — PASS, including the later size/activation checks:

```text
copy-wasm self-test PASS: active-only copying, metadata, size, duplicate/path/provenance negatives, vendored SHA-256 failure before writes
```

`node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test` — exit 0:

```text
Electron WASM self-test PASS: complete archive; 6 missing and 6 empty asset negatives
```

`node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` — exit 0:

```text
CLI WASM self-test PASS: complete tarball; 6 missing and 6 empty asset negatives
```

`node_modules/.bin/nx run-many '-t=lint,typecheck' -p ptah-electron ptah-cli --parallel=2 --skip-nx-cache` — exit 0. Header explicitly named **2 projects**; **4 tasks** ran, none skipped:

```text
NX Running targets lint, typecheck for 2 projects:
- ptah-electron
- ptah-cli
√ nx run ptah-electron:lint
√ nx run ptah-electron:typecheck
√ nx run ptah-cli:typecheck
√ nx run ptah-cli:lint
NX Successfully ran targets lint, typecheck for 2 projects
Run duration: 54.3s
Cache: Skipped (--skip-nx-cache)
EXIT=0
```

The batch-authoritative command names lint/typecheck, not app test targets; packaging self-tests supply the required test coverage. The initial scoped run found a relative cross-project helper import in the Electron script. Fixed it by having the standalone verifiers text-read JSON; no boundary suppression or dynamic-import workaround was added. Both initial typechecks and CLI lint had passed; the final full scoped run passed all four tasks.

`node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` — exit 0:

```text
All external imports are covered by package.json dependencies.
NX Successfully ran target validate-deps for project ptah-electron and 1 task it depends on
Run duration: 4.4s
Cache: Skipped (--skip-nx-cache)
Critical path: 4.3s (2 tasks)
EXIT=0
```

`node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — exit 0:

```text
degradation-audit: TOTAL 300 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
Run duration: 14.6s
Cache: Skipped (--skip-nx-cache)
EXIT=0
```

`node_modules/.bin/eslint scripts/copy-wasm.js` — exit 0 (the root script is outside the two app lint scopes).

`npx --no-install prettier --check` on all changed scripts, JSON and YAML — exit 0, `All matched files use Prettier code style!`. The report is also formatted and checked before handoff.

Scoped `ptah_get_diagnostics` was attempted on the three changed JavaScript files. It reported unavailable: TypeScript compilation had exceeded its 45-second tool window and continued in the background. The completed Nx typecheck targets above provide verification instead.

## Stack, deviations and handoff

- Stack: standalone CommonJS Node packaging scripts, Node 24.x declared in root `package.json`; no NestJS, DI or runtime service changes. Existing fs/path, child_process, @electron/asar and built-in assert/crypto were used; no new npm dependency and no network download. Exact grammar versions were verified in `package-lock.json` and installed package metadata. Asar APIs were checked against the installed declarations.
- Repository guidance: read CONTRIBUTING.md, README.md, relevant eslint boundaries, authoritative batch sections, language plan and User Decisions 17–19. `ptah_search_files` returned no AGENTS.md. No file-read tool was listed, so native reads were used; `ptah_ast_analyze` rejected the CLI .cjs extension.
- No scope deviation. The inactive Kotlin placeholder is deliberately incomplete pending the approved Batch 30k provenance gate. Packed verifiers perform their own bounded JSON reads to respect project boundaries.
- `git status --short` and all other git commands were not run because this executor role explicitly prohibits git invocation. The changed-file inventory above is based on this executor's writes; caller should inspect status during review. No task-state document was changed.
- Cross-side reviewer approval is outstanding and belongs to the caller's workflow. No claim of independent review approval is made.
- Out-of-scope observations: pre-existing lint warnings in Electron files; no unrelated fixes made. Full package build/size verification remains Batch 28b work.
