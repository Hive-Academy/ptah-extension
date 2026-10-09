# Code Logic Review - s8 SonarCloud fix (commit 6a05846f8)

Scope: static read of the full diff of 6a05846f8 plus the surrounding code. No tests, builds or benches were run.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE WITH FIXES (REVISE the two workflow/parser items below; nothing data-destroying) |
| Blocking | 0 |
| Serious | 2 (electron bench host binary now missing; `parseTextLocations` emits bogus entries) |
| Moderate | 4 |

## Answers to the five key questions

### 1. gate.ts sort change

The premise is slightly off. The sort was not changed to a numeric comparator. `compareCodeUnits` (`tools/mcp-bench/src/utils/compare-code-units.ts:2`) is `left < right ? -1 : left > right ? 1 : 0`. That is the same UTF-16 code-unit ordering `Array.prototype.sort()` uses by default, so it is behaviour-preserving. It only exists to satisfy Sonar's S2871, which wants an explicit comparator.

Every sorted array holds strings, so a numeric order would have been wrong:
- `gate.ts:253` (`[...keys].sort`) sorts suite/metric keys.
- `gate.ts:279` (`[...rowKeys].sort`) sorts `"tool / scenario"` row names.
- The remaining call sites sort file paths, `file:line` truth strings and JSON object keys:
  - `corpus.ts`, `file-tool-questions.ts`, `graph-questions.ts`, `scip-cross-check.ts`, `relevance-questions.ts`, `ts-program.ts`
  - `suite-kinds.ts:177` (`canonicalJson` keys)

Ground-truth ordering and the canonical-JSON hash in `suite-kinds.ts` are therefore unchanged. No consumer breaks, and no old bug is fixed or introduced.

One non-sort change in `gate.ts`: the inline default `deps` became a module constant `defaultMeasureNoiseDeps`. It is the same object shape, and a module-level constant is created once instead of per call. Equivalent.

### 2. Regex rewrites

| Site | Equivalent? | Notes |
| --- | --- | --- |
| `/\\/g` to `replaceAll('\\','/')` (many files) | Yes | A literal single-backslash replacement. `replaceAll` needs ES2021 lib or later. It is already used in `retrieval-metrics.ts:67`, so the target is fine. |
| `deleteFileSymbols` | Not changed | It still uses `/\\/g`, so the Sonar finding is still open there. This is cosmetic, not behavioural. |
| `symbol-questions.ts:214` `\s+([.,;:!?])` to `$1` becomes `[ \t\n\r\f\v]+(?=[.,;:!?])` to `''` | Yes in context | The text was just `split(/\s+/)` and `join(' ')` (lines 202-213), so only single ASCII spaces remain. The only difference is that the new class omits Unicode spaces (nbsp and similar), which cannot be present at that point. |
| `retrieval-metrics.ts:249` `trimTrailingSlash` (loop) | Almost | Counterexample: input `"/"`. Old: `length > 1` guard returns `"/"`. New: returns `""`. A `workspaceRoot` of `/` (after `\`-to-`/` and slash collapse) now makes `rootNormalized` falsy (line 76), so the path is no longer relativised (`/a/b` was `a/b`, is now `/a/b`). Only a filesystem-root workspace hits this, so it is Moderate. Fix: keep the `length > 1` guard, or loop while `end > 1`. |
| `tool-results.ts:216` `parseFileList` line splitting | Mostly | Real differences are all edge cases. (a) Old `\s+` after `N.` could cross a newline, so `"1.  \n2. x"` produced the path `"2. x"` (an old bug); new correctly skips it. (b) `$`/`.` in the old multiline regex also broke lines on lone `\r`, `\u2028` and `\u2029`; new splits only on `\r?\n`. Neither is likely in tool output. |
| `tool-results.ts:232` `parseTextLocations` | **No** | See finding S-2. Old: `([^\s`'"|]+?):(\d+)(?=[:\s`\|]\|$)`. New: hand-rolled tokenizer. |

### 3. Removal of `async`

All sites keep failures as rejections. Every throwable path is moved inside a `.then()` callback, an executor, or a `Promise.resolve(...)`.

- `thoth-runtime.ts` (`disposeThoth`) wraps each `dispose` and `stop` in `Promise.resolve().then(...)`. `guard` awaits `fn()` inside `try` (lines 226-236), so sync and async throws are both logged as non-fatal. A returned promise from `dispose()` is now awaited, which is slightly better than before.
- `null-implementations.ts` has no throwing path.
- `electron-host.ts` `stop` moved `client.close()` into `.then`, so a throw becomes a rejection. Same as before.
- `lifecycle-scenarios.ts` `listing`: `readdir(join(...)).catch(() => [])`. `join` only throws for non-string input, which the types forbid. OK.
- `workspace-index-lifecycle.ts` `requestFullRun` (lines 371-396) no longer needs the try/catch, because the Promise executor converts a sync throw into a rejection. The `.catch` then calls `report(...)` unless `disposed` or `signal.aborted`. `finally` clears `runAbort` and `fullRun`. Two small differences:
  - A synchronously thrown abort-type error whose signal is not aborted now sets `followUp = true` and re-runs a full index (line 395). The old code silently returned.
  - Aborts are now reported when the signal is not aborted. This matches the existing async path, so it is consistent, but it is a behaviour change.
- **`code-symbol-indexer.service.ts` `deleteFileSymbols` (lines 1232-1246) has an ordering change (Moderate, M-1).** Before, it was `async` and ran synchronously up to `withFileLock`, whose queue entry (`this.fileLocks.set`, line 906) is made synchronously. Now the whole body, including the lock enqueue, is deferred by one or more microtasks via `Promise.resolve().then(...)`. A caller that fires `deleteFileSymbols(p)` and then immediately `reindexFile(p)` without awaiting used to get delete-then-reindex. It now gets reindex-then-delete, which can wipe freshly indexed symbols. The only production caller, `workspace-index-lifecycle.ts:346`, issues events per debounced path (one pending entry per path), so it is unlikely to hit this today. Still, a documented per-file-ordering invariant ("lock identity matches reindexFile", line ~1229) is weaker. Fix: keep the lock enqueue synchronous, for example by making the function `async` again with an `// NOSONAR` / a Sonar-clean rewrite such as:

  ```ts
  deleteFileSymbols(f, root) {
    let normalized: string, identity: string;
    try { normalized = ...; identity = ...; } catch (e) { return Promise.reject(e); }
    return this.withFileLock(identity, () => Promise.resolve().then(...));
  }
  ```

  `AsyncLocalStorage` context is preserved through `.then` registered in-context, so the reentrancy check at line 899 still works.

### 4. Workflow install steps

`mcp-bench.yml` lines 107-115 and 181-185 now run `npm ci --ignore-scripts`, the pinned rollup binary, and `npm rebuild better-sqlite3 esbuild`.

- **Rollup pin:** `package-lock.json` has `rollup` 4.63.4 and `@rollup/rollup-linux-x64-gnu` 4.63.4, so the pin matches. It is hard-coded in three places, with the same drift risk `ci.yml` accepts and documents.
- **Packages with install scripts in the lockfile (skipped):**
  - `@parcel/watcher`, `lmdb`, `msgpackr-extract`: prebuild or `node-gyp-build` fallbacks. The prebuilt optional packages are installed by npm itself.
  - `sharp`, `ffmpeg-static`, `protobufjs`, `@swc/core`, `nx`, `prisma`, `@prisma/engines`, `fsevents`, `@vscode/vsce-sign`, `electron-winstaller`: not on the bench path.
  - `onnxruntime-node` (used by the embedder worker): its script only fetches optional CUDA bits, and the binary ships in the package.
  - `node-pty`: the bench does not use it.
  - `unrs-resolver`: not needed for an esbuild-only build. `ci.yml` and `electron-e2e.yml` install `@unrs/resolver-binding-linux-x64-gnu@1.12.2` explicitly, but the bench does not use jest or eslint. OK, with a small risk if `nx` project-graph resolution ever needs it.
- **`better-sqlite3` 13 and `sqlite-vec` 0.1.9** have no install script in the lockfile. `npm rebuild better-sqlite3` is kept, and `esbuild` (the only one with `hasInstallScript` that the build needs) is rebuilt. Fine.
- **Root `postinstall` is skipped:** `rebuild-native.js` (Electron-ABI sqlite build; for the cli-headless host it was undone by `npm rebuild better-sqlite3` anyway) and `patch-transformers-onnx-dep.js` (a packaging-only fix for electron-builder, so irrelevant to the bench).
- **Dropped `npm ci || npm install` fallback:** now strict. The `ci.yml` git-real-git job uses the same strict form, so this is consistent, but a lockfile that trips npm/cli#4828 on Linux now fails the job instead of degrading. That is the intent of githubactions:S8543.

**Serious finding S-1: `bench-electron` (lines 149-185).** The Electron binary comes from the `electron` package's own install script (the Electron binary download). `electron-e2e.yml:91-100,117-123` documents this: it ran `--ignore-scripts` and then explicitly re-ran the postinstall steps ("which also skips the root postinstall ... fetches the Electron binary"). `mcp-bench.yml` has no equivalent step. `electron-host.ts:178-183` resolves the binary with `require('electron')`, which throws "Electron failed to install correctly" when `path.txt` and `dist/` are absent. After this commit the nightly electron bench has no Electron binary, so the host fails to launch and the scorecard records `na`. That is a silent downgrade from "measured" to "not available" on the nightly. The job also never builds `dist/apps/ptah-electron/main.mjs` (`electron-host.ts:263`; `mcp-bench:bench` only depends on `build-host`/`build-bench`), so the host was likely already `na` before this commit, but this change removes the one prerequisite that was present. Fix: add `node node_modules/electron/install.js` to the electron job (and keep the existing note that `better-sqlite3` is Node-ABI after `npm rebuild`, which would break the Electron app anyway).

**Windows `bench-cli` job** (full mode): `npm ci --ignore-scripts`; the rollup step is Linux-only, as before. `esbuild` rebuild is fine because `@esbuild/win32-x64` is an optional dependency without a script. No missing dependency found.

### 5. Other behaviour changes

- **New `git-executable.ts` (S-3, Moderate).** `spawn('git')` / `execFileSync('git')` became an absolute path resolved once via `GIT_PATH`, else `where git` (win32, picks the first `.exe`) or `which git`, cached in a module variable. Differences from `spawn('git')`:
  - Failures are now hard errors: if `which` is absent (minimal containers), or git is only a `.cmd`/shim on Windows, the old call worked and the new one throws "Unable to find git".
  - A bad `GIT_PATH` fails instead of falling back to PATH.
  - The failure is a different, earlier, and clearer error than ENOENT, and inside `runGit` (`corpus.ts:470`) it is converted to a rejection by the Promise executor. In `relevance-questions.ts:97` it is rethrown because it carries no exit code.
  - The resolver runs a git subprocess once, synchronously, on first use.
  - Two sites still use bare `git`: `baselines/native-baselines.ts:481` and `main.ts:194`. Not equivalent coverage, but not a bug.
- `retrieval-metrics.spec.ts` / `tool-suites.spec.ts` / `ground-truth.spec.ts` added regression tests for the ReDoS-style inputs. These look correct but were not run. The `tool-suites.spec.ts` case does not cover `file:line:col`, which is how S-2 slipped through.

## Findings

### S-2 (Serious): `parseTextLocations` is not equivalent to the old regex
File: `tools/mcp-bench/src/suites/tool-results.ts:232-252`

Counterexample A: `libs/a.ts:12:5` (grep or compiler-style `file:line:col`).
- Old: one match, `libs/a.ts:12`. The remaining `:5` cannot satisfy `path:digits`.
- New: after the first match, `cursor = end` and `pathStart = cursor` (line 247-248). The next iteration finds the colon at `separator === pathStart`, takes `5` as a line, and pushes `relative('') + ':5'`, i.e. the bogus entry `":5"`.
- Impact: extra ranked items for the text suite (`tool-suites.ts:489`) that can never match truth. This lowers precision, MRR or recall-style metrics for any tool whose output carries a column.

Counterexample B: `"libs/a.ts:3"` or `'libs/a.ts:3'`.
- Old: the lookahead `[:\s`|]` excludes quotes, so no match.
- New: tokenized on quotes, so it matches `libs/a.ts:3`. Arguably an improvement, but the match set differs.

The new test only covers a long token and a simple `file:3` line.

Fix: after a successful match, if `token[end] === ':'`, skip to the next colon only when the span between `pathStart` and `separator` is non-empty (or require `separator > pathStart`), and add a `file:12:5` case to the spec.

### M-1 (Moderate): `deleteFileSymbols` ordering relative to `reindexFile` (see Q3)
`code-symbol-indexer.service.ts:1232-1246`.

### M-2 (Moderate): `trimTrailingSlash("/")` returns `""` (see Q2)
`retrieval-metrics.ts:249-253`.

### M-3 (Moderate): `requestFullRun` re-runs on a synchronously thrown abort error (see Q3)
`workspace-index-lifecycle.ts:371-395`.

### M-4 (Moderate): `git-executable.ts` resolution strictness
See Q5. Minor: `normalizePath` strips only matching double quotes, and `where git` output on Windows may list `git.exe` after other non-exe entries, which the `.exe` filter handles.

### Minor
- `scip-cross-check.ts:~705-707`: the new `.sort(compareCodeUnits)` lines exceed the prettier width.
- `deleteFileSymbols` still uses `/\\/g` at `code-symbol-indexer.service.ts:1235`, while the other 9 sites were converted to `replaceAll`.

## Must fix before merge
1. S-1: ensure the Electron binary exists in the `bench-electron` job (add `node node_modules/electron/install.js` or an equivalent step), or accept and document that the electron host now reports `na`.
2. S-2: fix `parseTextLocations` so `file:line:col` does not emit an empty-path `":col"` entry, and add a spec case.

Recommended, not blocking: M-1 (keep the lock enqueue synchronous), M-2 (`"/"` guard).

## Verdict
APPROVE WITH FIXES.
- Confidence: HIGH on Q1-Q3 (read in full); MEDIUM on Q4 (inferred from package metadata and workflow text, no CI run).
- Top risk: the electron nightly bench loses its Electron binary, and the text-location parser silently degrades scoring.

---

# Round 2 (working-tree diff on HEAD 41b384c1b) - static review

Verdict: APPROVE. Score 8/10. 0 blocking, 0 serious, 3 minor. Must fix before merge: none.

| Fix | Result |
| --- | --- |
| A. shared resolver (`utils/git-executable.ts`) | Correct. |
| B. Electron install step | Correct (see caveat). |
| C. `parseTextLocations` | Equivalent to the pre-6a05846f8 code. |
| D1. `deleteFileSymbols` | Correct. |
| D2. `requestFullRun` | Correct, one stale-field nit. |
| D3. root `/` | Correct and intended, but a deliberate change from the pre-6a05846f8 behaviour. |

## A. Resolver (`git-executable.ts`)
- **Caching:** a `Map<name, path>` is filled only after the `--version` check passes (line 37). A hit returns early (`if (cached)`), so git and gh each resolve once. Failures are not cached; this matches the earlier `??=` behaviour, which also re-ran after a throw. The cache is keyed by name only, so a later change to `GIT_PATH` or `GH_PATH` is ignored, same as before.
- **Windows `.exe` preference:** kept in `findExecutableOnPath`, which picks the first `*.exe` candidate on `win32` and `candidates[0]` elsewhere.
- **Error messages:** the git messages are character-identical after templating (`Unable to find git: set GIT_PATH or make git available on PATH.` and `Unable to run git at <exe>: <detail>.`). gh gets the matching `GH_PATH` text.
- **Call sites:** `main.ts:195`, `native-baselines.ts:481`, and `relevance-questions.ts` (git plus the two gh sites at ~225 and ~254) all use the resolver. Because `getGitExecutable()` is evaluated inside the existing try/`async` bodies, failures stay rejections or caught errors. Behavioural delta (intended): git and gh are now validated with `--version` up front, and a missing tool gives a clearer error than ENOENT.
- **`rg-runner.resolveRg`:** unchanged where it matters.
  - `RG_PATH` handling (trim, strip surrounding double quotes) is untouched.
  - The injected `lookup` still takes precedence (`options.lookup ?? findExecutablesOnPath`).
  - `findExecutablesOnPath` returns `[]` where the old `lookupOnPath` returned `undefined`, but `resolveRg` normalizes both with `found ?? []`, so empty and failed lookups both reach the same "Unable to find ripgrep" error.
  - A string result is still wrapped. The `.exe` filter, selected by the injected `platform`, is unchanged.
  - The old `lookupOnPath` collapsed empty output to `undefined`; this makes no observable difference.

## B. Workflow
`mcp-bench.yml` now runs `node node_modules/electron/install.js` after the rebuild step, in `bench-electron` only. This restores the binary download that `--ignore-scripts` skipped, and the script is idempotent when the binary exists. It resolves S-1.
- Residual (pre-existing, not from this change): the job still does not build `dist/apps/ptah-electron/main.mjs` (`electron-host.ts:263`), and `npm rebuild better-sqlite3` leaves a Node-ABI sqlite, so the electron host may still report `na`. The note on the step is accurate.

## C. `parseTextLocations`
New regex: `/([^\s`'"|]+?):(\d+)(?=[:\s`\|]|$)/g`. The old code used the same pattern with the `gm` flags.
- `\|` inside a character class is the same as `|`.
- Dropping the `m` flag is safe: the only effect of `m` on `$` is to also match before a line terminator, and every line terminator (`\n`, `\r`, `\u2028`, `\u2029`) is already matched by `\s` in the lookahead. So the match sets are equal. `matchAll` plus `Array.from` with `match[1]` and `match[2]` gives the same captures.
- Resolves S-2 (`a.ts:12:5` yields only `a.ts:12`; quoted `"a.ts:3"` is again not matched).
- Minor (m-1, pre-existing and the reason Sonar flagged it): the lazy `+?` inside a token with no `:digits` is quadratic in token length. A single 20k-character token without a colon costs about n^2/2 steps (hundreds of millions of steps). The added spec uses a matching token (`x*20000:42`), which exits fast, so it does not exercise the slow path. Realistic only for minified-file hits. Not a regression versus pre-6a05846f8.

## D1. `deleteFileSymbols`
It is non-`async`; the normalize and `graphPathIdentity` calls are in a try that returns `Promise.reject(error)`, then `withFileLock(identity, ...)` is called synchronously. `withFileLock` is `async` and reaches `this.fileLocks.set(...)` before its first `await`, so the queue slot is taken at call time, as in the original `async` version. Order against an immediately following `reindexFile` is preserved. The tombstone and sink call run inside the lock callback, as before. `AsyncLocalStorage` context is unaffected. This resolves M-1. (`replaceAll` replaces the old regex; same result.)

## D2. `requestFullRun`
```
try { pending = Promise.resolve(indexer.indexWorkspace(...)); }
catch (e) { if (isAbort(e)) return; pending = Promise.reject(e); }
```
- This matches the pre-6a05846f8 behaviour for a sync abort (silent return, no `followUp`).
- A sync non-abort throw becomes a rejection and goes through the existing `.catch`: it reports unless disposed or aborted, and `.finally` clears `runAbort`/`fullRun`. This is equivalent to the old direct report.
- Minor (m-2): on the silent abort path the code returns without the old `if (this.runAbort === controller) this.runAbort = undefined;`. The stale controller stays in `runAbort` (`workspace-index-lifecycle.ts:373`) until the next run overwrites it or disposal aborts it (lines 258-259, harmless). No reader depends on it being undefined, so no functional impact. Cheap to restore for exact parity.
- This resolves M-3.

## D3. Root `/`
`trimTrailingSlash` stops at length 1 (`end > 1`) and `isWithinWorkspace` special-cases root `/`, so `/a/b` relative to `/` now gives `a/b` and `/` stays `/`. This fixes M-2. Note this is intentionally not identical to the pre-6a05846f8 code, where root `/` made `startsWith('//')` false and left the path unrelativised. It is an improvement and only affects a filesystem-root workspace. Slash runs are collapsed before this function, so `end > 1` loses nothing else.

## Minor items
- m-1: quadratic lazy regex above (pre-existing).
- m-2: `runAbort` left set on the sync-abort return.
- m-3: Electron job still lacks the `dist/apps/ptah-electron/main.mjs` build (pre-existing).

Must fix before merge: none.
