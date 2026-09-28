# Batch 22 executor report — Coverage contract + language registry (Lane H)

Worktree `task-559-lane-h`, branch `fix/task-559-lane-h`, base 54b7af920. No git operations run. No tool behaviour changed: nothing consumes the new symbols yet.

## Changes

| File | Change |
| --- | --- |
| `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts` (new, 249 lines) | Task 22.1 contract: `Count`, `LanguageCoverage`, `UnsupportedLanguageAnswer`, `CoverageResolution`, `CoverageCensus`/`CoverageState`/`CoverageChecks`; the closed vocabularies `LANGUAGE_IDS` (12, no `c`), `RECOGNISED_LANGUAGE_IDS` (9), `FAILURE_REASONS` (5), `APPROXIMATION_PRIORITY` (8 kinds, `syntax-only` stands for `<id>:syntax-only`) and their types; constants `COVERAGE_COUNT_MAX` 9,999,999, `MAX_REPORTED_APPROXIMATIONS` 4, `MAX_UNSUPPORTED_LANGUAGE_KEYS` 8; pure helpers `isCleanAnswer` and `limitApproximations` |
| `libs/backend/platform-core/src/interfaces/language-coverage.interface.spec.ts` (new, 26 tests) | Vocabularies, every condition of the clean-answer rule, the overflow rule |
| `libs/backend/platform-core/src/index.ts:77-100` | Barrel: types via `export type`, constants and helpers via `export` |
| `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts:17-30` | New `GRAMMAR_FILE_MAP: Record<SupportedLanguage, string>` (same 5 wasm names the parser loads) |
| `libs/backend/workspace-intelligence/src/ast/language-registry.ts` (new, 276 lines) | Task 22.2 registry: `LANGUAGE_REGISTRY` (all 12 ids), `hasCapability`, `supportedLanguagesFor`, `languageForExtension`; types `LanguageCapabilities`, `LanguageCapability`, `GraphEdgesCapability`, `LanguageRegistryEntry` |
| `libs/backend/workspace-intelligence/src/ast/language-registry.spec.ts` (new, 21 tests) | Holds the FB specs, the size fixture, the initial values and the derivation checks |
| `libs/backend/workspace-intelligence/src/index.ts:105-114` | Barrel exports the registry |

## The contract as implemented

- The buckets are disjoint file counts (`analyzed`, `unchecked`, `failed`, `unsupported`, `excluded`, `omittedByCap`). `null` means the count cannot be known. Field shapes follow the plan's block exactly.
- `isCleanAnswer` implements the five conditions:
  1. `census === 'complete'`.
  2. `unchecked`, `failed`, `unsupported` and `omittedByCap` are each exactly 0. `null` fails this check; `analyzed` may be `null`.
  3. `excluded` is 0 or `null`.
  4. When `resolution` is present: `unresolvedInternal` and `truncatedImports` are 0, `edgeCapHit` is false and `context` is `'complete'`.
  5. `state` is absent or `'current'`.

  `approximations` and `checks` are not part of the rule, as the plan specifies.
- `limitApproximations` drives the overflow rule from `APPROXIMATION_PRIORITY` alone:
  - It de-duplicates the input.
  - Ties in the `<id>:syntax-only` family break by code-unit order, so the result does not depend on the host locale.
  - It keeps 4 and reports the rest as `approximationsOmitted`.
  - With no input it returns `{}`.
- In the registry, `extensions`, `grammarFile`, `parse` and `publicSymbols` (`exportQuery !== ''`) are derived from `EXTENSION_LANGUAGE_MAP`, `GRAMMAR_FILE_MAP` and `LANGUAGE_QUERIES_MAP`. `outline`, `enrichSummary`, `codeIndex`, `graphEdges`, `definitionFallback` and `syntaxDiagnostics` are declared only for the 5 parsed languages, each with a comment citing where it is implemented. Languages without a grammar get extensions and no capabilities.
- Initial values:

  | Capability | Languages |
  | --- | --- |
  | parse, outline, codeIndex | ts, js, py, go, cs |
  | enrichSummary | ts, js |
  | publicSymbols | ts, js |
  | graphEdges | ts, js (`{granularity:'file', referenceScopeComplete:true}`) |
  | definitionFallback | ts, js, py, go (C# arrives in 26b) |
  | syntaxDiagnostics | py, go, cs |

- Extension mapping:
  - `.tsx` stays `typescript`. The `tsx` entry has no extensions until 29b.
  - `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` and `.hxx` map to `cpp`.
  - The recognised languages are mapped too: swift, scala, dart, elixir, lua, haskell, clojure, objc (`.m`, `.mm`) and r.
  - Lookup is case-insensitive. Anything else returns `null`.

## Measured coverage size

`JSON.stringify` of the committed worst-case fixture (`WORST_CASE` in `language-registry.spec.ts`) is **922 chars**. The fixture has:

- all 12 ids
- `censusLimit` and every count set to 9,999,999
- `state:'incomplete'` and `checks:'provider-defined'`
- the 8 longest language keys plus `other`
- all 5 failure reasons
- a full `resolution`
- the 4 longest approximation strings. This is a bound above what the priority rule can keep.
- `approximationsOmitted` 9,999,999

The spec asserts both that the length is ≤ 1,000 and that it is exactly 922, so any contract growth shows up. This agrees with the plan's 909/920/913 probes.

## Specs and fails-before

- FB (plan): `language-registry.spec.ts` "worst-case coverage <= 1,000 chars" and "codeIndex and publicSymbols are separate".
  - On the base these files do not exist.
  - As a local revert, I temporarily moved `language-registry.ts` aside and ran jest. The suite failed with `TS2307: Cannot find module './language-registry'` (Test Suites: 1 failed, Tests: 0), and passed again after I restored the file.
- Specs that pin later-batch expectations, as labelled in the spec header:
  - `tsx` gets no extensions until 29b.
  - publicSymbols/graphEdges stay TS/JS until 33-36.
  - definitionFallback gains C# in 26b.
  - The inline grammar list in `tree-sitter-parser.service.ts` equals `GRAMMAR_FILE_MAP` (read from the source) until 29a2.

## Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache`: "Running targets test, lint, typecheck for 2 projects", 6 tasks passed, "Successfully ran targets". I re-ran it after prettier with the same result.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: platform-core 7 ok (baseline 7), workspace-intelligence 1 ok (baseline 1), "TOTAL 300".
- `prettier --check` on the 7 changed files: all formatted.
- Specs that mock platform-core with a partial factory (`permission-prompt.service.spec.ts`, electron `workspace-restore.spec.ts`, `plugin-activation.spec.ts`) still pass (23 and 43 tests). They matter because the registry reads `LANGUAGE_IDS` when the module loads.
- `git status --short`: 3 files modified (`platform-core/src/index.ts`, `tree-sitter.config.ts`, `workspace-intelligence/src/index.ts`) and 4 new files (the interface and its spec, the registry and its spec).
- The frozen prompt constants were not touched.

## Deviations

1. One extra file: `language-coverage.interface.spec.ts`. The batch lists 6 files, but `isCleanAnswer` and `limitApproximations` are new behaviour and Decision 17 requires a spec for each. It is colocated in platform-core, which is where they live.
2. `GRAMMAR_FILE_MAP` is the `tree-sitter.config.ts` edit. The parser service still names the files inline, because it is not in this batch. A spec pins the two lists equal until 29a2.
3. The helpers `limitApproximations` and the `MAX_*` constants are beyond the named symbols. The batch's "one exported priority array drives the overflow rule" needed an implementation.

## Out-of-scope observations

- `.mts`, `.cts`, `.mjs` and `.cjs` are not in `EXTENSION_LANGUAGE_MAP` (Batch 7 KI). The derived registry therefore returns `null` for them, so they will not be counted as `unsupported` by coverage. They are invisible, not misreported. This needs a decision before 23b/24b count files.
- `syntaxDiagnostics` for py/go/cs is set now, as the plan specifies. Its implementation arrives in 25a, and nothing consumes the flag before then.

## Revision round 1 (r1 REVISE 6/10)

Review: `reviews/batch-22-code-logic-review-r1.md`. No git operations were run. The file set is unchanged: the same 7 files.

### S1: common source extensions no longer disappear

- **(a) Recognition** (`language-registry.ts`):
  - Each entry gains `recognitionOnlyExtensions`: source suffixes of a parsed language that no consumer accepts yet (javascript `.mjs .cjs`, typescript `.mts .cts`, python `.pyi .pyw`). They are recognised, but they grant no capability.
  - I did not add them to `EXTENSION_LANGUAGE_MAP`. Doing so would change the indexer, graph and outliner, which is a tool behaviour change outside Batch 22 (the reviewer's Q5 caution).
  - Unparsed languages gain `.phtml` (php), `.rake` (ruby) and `.c++` (cpp).
  - New `extensionHasCapability(ext, cap)` checks support per extension, not per language: `.mjs` is javascript but falls in `unsupported`.
  - New `SOURCE_EXTENSIONS` is the full recognised list, for discovery globs.
  - Both are exported from the WI barrel.
- **(b) Contract** (`language-coverage.interface.ts`):
  - New disjoint bucket `unrecognised: Count`. It counts files in scope that no registry language claims.
  - A producer given an explicit file set must count every such file.
  - `null` is allowed only when discovery enumerated registry source extensions alone and therefore never observed other files.
  - `isCleanAnswer` condition 3 now reads: `excluded` and `unrecognised` are each 0 or `null`. A counted unrecognised file always qualifies the answer.
  - Design choice for the reviewer: `null` mirrors `excluded`. Requiring an exact 0 would qualify every workspace-wide answer forever, because glob discovery cannot observe files outside the registry.
- **Specs:**
  - The census model `censusOf` in the registry spec shows that censuses over `.mjs`, `.cjs`, `.mts`, `.cts`, `.pyi`, `.xyz` and a mixed set are never clean, and that each file lands in exactly one bucket.
  - A 20-row mapping table covers the coordinator's extension list.
  - Recognition-only suffixes grant no capability.
  - The extension-uniqueness check now covers recognition-only suffixes and `SOURCE_EXTENSIONS`, and checks that no recognised-language list overrides a registry entry.
  - PC spec: "rejects counted unrecognised files; null means not observed".

### M1: the grammar guard compares language → file

- The source-text file-set comparison is replaced.
- The registry spec now mocks `web-tree-sitter`, where each `Language.load` returns `{grammarPath}`. It runs the real `TreeSitterParserService.parse` for every language and records the grammar passed to `setLanguage`.
- It asserts that the observed language → file mapping equals `GRAMMAR_FILE_MAP`.
- Swap regression: swapping the JS and TS files leaves the file-name set equal (the old guard passes) but is reported as mismatches `['javascript','typescript']`.

### Fails-before

Each was a temporary local revert, restored afterwards; the spec was re-run green (51/51).

| Revert | Result |
| --- | --- |
| Recognition-only lists emptied (pre-r1 recognition) | Registry spec: 6 failed, 45 passed |
| `unrecognised` check removed from `isCleanAnswer` | PC spec: 1 failed, 26 passed. Registry spec: 1 failed, 50 passed |
| `GRAMMAR_FILE_MAP` javascript/typescript swapped | Registry spec: 2 failed, 49 passed (the pre-r1 set guard would have passed) |

### Size

The worst case now includes `unrecognised: 9,999,999`. Measured length is **945 chars** (was 922): the ≤ 1,000 check passes, and the exact value is pinned at 945.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache`: "Running targets test, lint, typecheck for 2 projects", 6/6 passed, "Successfully ran targets".
  - Registry spec: 51 tests. PC coverage spec: 27 tests.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: platform-core 7 (baseline 7), workspace-intelligence 1 (baseline 1), "TOTAL 300".
- Prettier: all 7 changed files are formatted.
- `git status --short`: the same 3 modified and 4 new source files. The only other untracked entries are the task-folder docs (this report, `reviews/batch-22-code-logic-review-r1.md`, and `code-logic-review.md`, which is not mine).

## Orchestrator ruling (unrecognised null)

The ruling: unknown never reads as clean; non-source files do not qualify an answer; unknown defaults to `unrecognised`.

### Contract (`language-coverage.interface.ts`)

- `isCleanAnswer` condition 2 now requires `unrecognised` to be exactly 0. `null` is not clean.
- A tool that performs a census always sets a number.

### Deviation from the ruling's wording: new `nonSource` bucket instead of `excluded`

- Clean condition 3 of the approved plan keeps `excluded` at 0 or `null`. That is how an observed vendor/generated exclusion qualifies an answer.
- If non-source files went into `excluded`, the required spec "README.md + package.json + logo.png is clean" (`excluded: 3`) could only pass by removing that plan rule.
- I added a disjoint `nonSource: Count` bucket instead. It is documented non-source only, and it never qualifies an answer.
- `excluded` stays vendor/generated, and condition 3 is unchanged.
- If you prefer, the alternative is to fold `nonSource` into `excluded` and drop the vendor half of condition 3. That is a plan change, so I did not make it.

### Registry (`language-registry.ts`)

- New closed lists `NON_SOURCE_EXTENSIONS` (57) and `NON_SOURCE_FILE_NAMES` (22):
  - docs
  - data/config
  - lockfiles and `.map`
  - media and fonts
  - archives and binaries
  - licence/readme-style names and tool dotfiles
- Code-like files are deliberately absent, so they come out `unrecognised`: `.sh`, `.sql`, `.html`, `.css`, `.vue`, `.svelte`, `Dockerfile`, `Makefile`.
- New `classifyFileForCoverage(path, capability)` returns `eligible`, `unsupported`, `nonSource` or `unrecognised`. It is the one census rule for producers. Unknown extensions and extension-less unknown names return `unrecognised`.
- Recognised languages remain `unsupported`: `.ex`/`.scala` are elixir/scala, not `unrecognised`.
- Removed `SOURCE_EXTENSIONS` (added in r1). Its only purpose was the `null` allowance the ruling removed.
- Barrel exports: `NON_SOURCE_EXTENSIONS`, `NON_SOURCE_FILE_NAMES`, `classifyFileForCoverage`, type `CoverageFileClass`.

### Specs

- **Clean-answer rule** (PC spec): `unrecognised` is added to the "rejects > 0 and null" table. New cases: "never treats unrecognised null as clean", and "nonSource never qualifies" (250 and `null`).
- **Census** (registry spec):
  - A census over README.md + package.json + logo.png is clean (`nonSource` 3).
  - Censuses containing `.zig`, `.xyz`, `.sh` or `Dockerfile` are not clean.
  - The census model now uses `classifyFileForCoverage`.
- **Classification** (registry spec):
  - A 16-row classification table, including a Windows path to `.gitignore` and `APP.TS`.
  - Both lists are pinned exactly.
  - Code-like names are kept off the lists.
  - No non-source extension shadows a language.

### Fails-before

Each was a temporary local revert, restored afterwards; re-run green: registry spec 74/74, PC spec 30/30.

| Revert | Result |
| --- | --- |
| r1 rule restored (`unrecognised: null` clean) | PC spec: 2 failed, 28 passed |
| Non-source branch removed from `classifyFileForCoverage` | Registry spec: 5 failed, 69 passed (README census, 4 `nonSource` rows) |

### Size

The worst case now includes `nonSource: 9,999,999`. Measured length is **965 chars**: the ≤ 1,000 check passes, and the exact value is pinned at 965.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache`: "Running targets test, lint, typecheck for 2 projects", 6/6 passed, "Successfully ran targets".
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: platform-core 7 (baseline 7), workspace-intelligence 1 (baseline 1), "TOTAL 300".
- Prettier: all 7 changed files are formatted.
- `git status --short`: the same 3 modified and 4 new source files, plus task-folder docs.

## Revision round 2 (r2 REVISE 6/10)

Review: `reviews/batch-22-code-logic-review-r2.md`. r1 S1 and M1 are rated FIXED. New finding R2-S1: `.mdx` and `CMakeLists.txt` were classified `nonSource`, so a one-file census over either read as clean. Only `language-registry.ts`, its spec and the WI barrel changed; the platform-core contract is unchanged.

### Fix

- **Rule applied to the whole list:** a file that can contain executable code or imports is never non-source.
- **Removed from `NON_SOURCE_EXTENSIONS`** (57 → 37 entries); these now classify as `unrecognised`:
  - `.mdx`: a module with imports and JSX
  - `.svg`: can hold `<script>`
  - `.map`: `sourcesContent` embeds source
  - `.pdf`: can embed JavaScript
  - archives: `.zip`, `.gz`, `.tgz`, `.tar`, `.7z`
  - compiled code: `.jar`, `.class`, `.pyc`, `.o`, `.a`, `.so`, `.dll`, `.dylib`, `.exe`, `.wasm`, `.bin`
- **What stays:**
  - prose docs
  - data/config formats, under the reviewer-accepted policy (JSON, YAML, TOML, INI, XML, CSV)
  - lockfiles
  - raster images, fonts, audio and video
- **New `CODE_FILE_NAMES`** (24 entries, exported and pinned): `makefile`, `gnumakefile`, `dockerfile`, `containerfile`, `jenkinsfile`, `rakefile`, `gemfile`, `podfile`, `vagrantfile`, `brewfile`, `fastfile`, `procfile`, `justfile`, `tiltfile`, `cmakelists.txt`, `build`, `build.bazel`, `workspace`, `workspace.bazel`, `module.bazel`, `meson.build`, `sconstruct`, `sconscript`, `build.xml`.
- **Order in `classifyFileForCoverage`:**
  1. A language claim (`eligible` / `unsupported`).
  2. A code base name → `unrecognised`. This outranks every extension rule, so `CMakeLists.txt` and `build.xml` beat `.txt` and `.xml`.
  3. A non-source name or extension → `nonSource`.
  4. Anything else → `unrecognised`.
- `pom.xml` stays `nonSource`: it is a dependency declaration, the same policy as `package.json`.

### Specs (registry spec: 106 tests)

- **One-file censuses that are not clean** (each has 0 analysed and 1 unrecognised): `docs/index.mdx`, `CMakeLists.txt`, `native/CMakeLists.txt`, `build.xml`, `assets/icon.svg`, `dist/app.js.map`, `vendor/lib.jar`.
- **Base-name precedence:**
  - `CMakeLists.txt` and a Windows-path `CMAKELISTS.TXT` → `unrecognised`
  - `notes.txt` → `nonSource`
  - `build.xml` → `unrecognised`, `pom.xml` → `nonSource`
- Every `CODE_FILE_NAMES` entry classifies as `unrecognised`.
- All three lists are pinned exactly.
- `.mdx`, `.svg`, `.map`, `.pdf`, `.zip`, `.jar`, `.wasm`, `.dll`, `.pyc` and `.class` are asserted to be absent from the non-source extensions. No code base name appears in the non-source names.

### Fails-before

- **Run:** the r2 spec against the pre-r2 `language-registry.ts`. That file was temporarily restored, with `CODE_FILE_NAMES` appended only so the spec compiles; the classifier is pre-r2. I restored the r2 file afterwards and the spec was green (106/106).
- **Result:** 12 failed, 94 passed.
  - all 7 one-file censuses
  - base-name precedence
  - the `cmakelists.txt` and `build.xml` rows
  - the pinned lists
  - the code-like-absent check

### Size

The contract is unchanged, so the worst case is still **965 chars** (≤ 1,000, pinned).

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache`: the final run printed "Successfully ran targets test, lint, typecheck for 2 projects".
  - The first run had one failing test in the platform-core suite: 1 failed, 850 passed, 44 suites, plus "A worker process has failed to exit gracefully". The machine was loaded by other lanes.
  - platform-core is unchanged in r2.
  - A standalone `nx run @ptah-extension/platform-core:test --skip-nx-cache` then passed (851 passed, 4 todo), and the full scoped run passed.
  - I did not identify the flaky test.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: platform-core 7 (baseline 7), workspace-intelligence 1 (baseline 1), "TOTAL 300".
- Prettier: all 7 changed files are formatted.
- `git status --short` (source): the same 3 modified and 4 new files.

## Bounded correction (post-cap, after r3 REVISE 6/10)

Review: `reviews/batch-22-code-logic-review-r3.md`. R2-S1 is rated FIXED. New finding R3-S1: ordinary artefacts and checksum files landed in `unrecognised`, so one PDF or `go.sum` made a clean source census non-clean. Only `language-registry.ts` and its spec changed. The platform-core contract, the classifier order and the barrel are unchanged.

### Fix

- **The rule is now narrower:** only SOURCE a code tool could analyse (text that can hold executable code or imports) is never non-source. Artefacts are not source, even when they hold compiled code.
- **Added to `NON_SOURCE_EXTENSIONS`** (37 → 61):
  - documents: `.pdf`
  - archives and packages: `.zip`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz`, `.7z`, `.jar`, `.war`, `.nupkg`, `.whl`
  - compiled binaries and bytecode: `.dll`, `.so`, `.dylib`, `.exe`, `.class`, `.pyc`, `.o`, `.obj`, `.a`, `.lib`, `.wasm`
  - source maps: `.map` (generated output; its source is analysed at its own path)
- **Added to `NON_SOURCE_FILE_NAMES`:** `go.sum` and `go.work.sum`.
  - The other lockfiles were already covered: `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `composer.lock` and `yarn.lock` by `.lock`; `package-lock.json` by `.json`; `pnpm-lock.yaml` by `.yaml`. All are asserted in the spec.
- **Kept:**
  - `.mdx` stays `unrecognised`.
  - Code base names outrank extensions (`CMakeLists.txt`, `build.xml`).
  - Unknown extensions default to `unrecognised`.
- **SVG choice:** it stays `unrecognised`. It is a text format that can embed `<script>`. The reviewer's table rated this "Conservative for script-bearing SVG" and did not ask for a change.

### Specs (registry spec: 134 tests)

- `main.go` + `go.sum` is clean (analysed 1, nonSource 1, unrecognised 0).
- A clean source census stays clean after adding a PDF, ZIP and DLL. The analysed count is unchanged, `nonSource` rises by 3, and `unrecognised` stays 0.
- A 26-row table classifies artefacts, checksum files and lockfiles as `nonSource`.
- MDX, `CMakeLists.txt` and `.zig` still make a census non-clean when they sit next to artefacts.
- The r2 one-file list replaces the `.jar`/`.map` rows, which encoded the wrong artefact policy, with `tools/build.zig`.
- The pinned lists are updated. The code-like-absent check keeps `.sh`, `.sql`, `.html`, `.css`, `.vue`, `.svelte`, `.mdx` and `.svg`.

### Fails-before

- **Run:** the corrected spec against the pre-correction registry (the r2 file, temporarily restored). I restored the corrected file afterwards and the spec was green (134/134).
- **Result:** 23 failed, 111 passed.
  - `main.go + go.sum is clean`
  - `clean source census plus PDF, ZIP and DLL stays clean`
  - 19 artefact rows
  - `keeps MDX, CMakeLists.txt and unknown code non-clean next to artefacts`
  - the pinned lists
- The lockfile rows passed on both, as expected: the r2 lists already cover them.

### Size

The contract is unchanged, so the worst case is still **965 chars** (≤ 1,000, pinned).

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache`: "Successfully ran targets test, lint, typecheck for 2 projects".
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: platform-core 7 (baseline 7), workspace-intelligence 1 (baseline 1), "TOTAL 300".
- Prettier: all 7 changed files are formatted.
- `git status --short` (source): the same 3 modified and 4 new files.
