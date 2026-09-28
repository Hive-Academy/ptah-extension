# Batch 30k executor report: Kotlin grammar (vendored, required)

- Worktree: `task-559-mcp-tool-contract`, branch `fix/task-559-mcp-tool-contract`, base HEAD `1308f750f`.
- No git command that changes state was run. The working tree is left dirty for the team leader.
- These were already untracked before this batch and are not part of it: `code-logic-review.md` and
  `research/diagnostics-worktree-repro.ts`. They were not touched.
- No change by another writer appeared during the batch.

## Changed paths (all of them)

New files:

- `assets/tree-sitter/tree-sitter-kotlin.wasm`: binary, 3,441,042 B.
- `assets/tree-sitter/LICENSE.kotlin`: 1,101 B, byte-identical to upstream.
- `assets/tree-sitter/PROVENANCE.kotlin.json`: 2,105 B. This is a repository record and is not shipped.
- `libs/backend/workspace-intelligence/src/ast/languages/kotlin.language.ts`
- `libs/backend/workspace-intelligence/src/ast/kotlin-grammar.integration.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/activations/b30k.ts`
- `.ptah/specs/TASK_2026_559_8ca9/batch-30k-executor-report.md` (this file)

Modified files:

- `scripts/tree-sitter-grammars.json`: the Kotlin row is activated.
- `scripts/copy-wasm.js`: licence and provenance gates, licence copy, `--list-licences`, self-test.
- `apps/ptah-electron/scripts/verify-packed-wasm.js`: licence requirement and self-test.
- `apps/ptah-cli/scripts/verify-packed-wasm.cjs`: licence requirement and self-test.
- `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs`: licence requirement and self-test.
- `libs/backend/workspace-intelligence/src/ast/ast.types.ts`: `'kotlin'` added to `SupportedLanguage`.
- `libs/backend/workspace-intelligence/src/ast/languages/index.ts`: `KOTLIN_LANGUAGE` registered.
- `libs/backend/workspace-intelligence/src/ast/language-registry.ts`: the dead "unparsed language" branch is removed
  (see Deviations).
- `libs/backend/workspace-intelligence/src/ast/languages/types.ts`: comment only.
- `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`: comment only.
- `libs/backend/workspace-intelligence/src/ast/language-registry.spec.ts`: pinned capability lists gain `kotlin`.
- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts`: the 24b `.kt` unsupported
  example becomes `.dart`.
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`: Kotlin checks.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`: Kotlin outline queries.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-language-coverage.spec.ts`: `outline:kotlin`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`: the list pin
  includes `kt`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`: the 24b
  `.kt` unsupported examples become `.swift`.
- `.ptah/specs/TASK_2026_559_8ca9/batches.md`: the Batch 30k heading only.

## Provenance verification (Task 30k.1)

Downloads went to `%TEMP%\ptah-30k-kotlin` (`C:\Users\abdal\AppData\Local\Temp\ptah-30k-kotlin`), outside the
repository. The retrieval followed the provenance record §1 exactly, using both channels.

| Check                                                                      | Result                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| npm tarball SHA-512, computed before extraction                            | `sha512-vlVXaxEE8t2k…UHu6DQ==`, equal to the registry `dist.integrity` fetched live            |
| npm `gitHead`, live                                                        | `77dd60ea0a9003ce062c9728a513ffe1aaff8c82`                                                     |
| Tarball SHA-256                                                            | `28916be3…a697`, matches record                                                                |
| `package/tree-sitter-kotlin.wasm` SHA-256 / bytes                          | `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7` / 3,441,042, matches record |
| GitHub release asset `v1.1.0/tree-sitter-kotlin.wasm`                      | same SHA-256; `cmp` byte-identical to the npm copy                                             |
| `package/LICENSE` SHA-256 / bytes                                          | `0eea8dc45e89deeb03c7799bbbc7b4688f365fb274562f4540ecfebdea82e727` / 1,101, matches record     |
| Committed `assets/tree-sitter/*` (re-hashed after copy and after all runs) | WASM `7009d694…73f7`, `LICENSE.kotlin` `0eea8dc4…e727`                                         |

**Signed attestation.** The command was the record's §3.2 command, run with GitHub CLI 2.96.0 (`gh attestation verify
… --repo tree-sitter-grammars/tree-sitter-kotlin --signer-workflow tree-sitter/workflows/.github/workflows/release.yml
--source-ref refs/tags/v1.1.0 --source-digest 77dd60ea…8c82`). It exited 0 three times:

- for the GitHub release asset;
- for the npm copy;
- for the committed `assets/tree-sitter/tree-sitter-kotlin.wasm`. This is the §6.6 re-check.

The JSON output shows the following:

- predicate `https://slsa.dev/provenance/v1`;
- subjects `tree-sitter-kotlin.tar.xz` = `60f60c06…3671` and `tree-sitter-kotlin.wasm` = `7009d694…73f7`;
- resolved dependency `git+https://github.com/tree-sitter-grammars/tree-sitter-kotlin@refs/tags/v1.1.0`, with
  `gitCommit 77dd60ea…8c82`;
- a Rekor tlog timestamp of 2025-01-09T19:00:13Z.

**Load.** `web-tree-sitter` 0.27.0 on Node v24.15.0 reports ABI 14, both in a direct probe and in the integration spec
through the real `TreeSitterParserService`.

**Rebuild (§3.3, not gating per User Decision 25).** No rebuild was attempted. `emcc` is not on PATH, and Docker's
engine is not running (`failed to connect to the docker API … dockerDesktopLinuxEngine`). I did not start one.
`PROVENANCE.kotlin.json` records this as `rebuild.attempted: false` with the reason, `sha256s: []` and
`equalToShipped: null`.

**`.gitattributes`.** `git check-attr` reports `binary: set` for the WASM (`.gitattributes:20` `*.wasm binary`). The
licence is `text auto, eol lf`. The file is LF, so its hash is stable across checkouts. Neither file is git-ignored
(`git check-ignore` exits 1).

### Manifest row (provenance record §5.1)

The row changes as follows:

- `active: true`;
- `bytes: 3441042`;
- `source.sha256` is set to the WASM hash;
- new `source.licenceSha256` and `source.provenanceFile: assets/tree-sitter/PROVENANCE.kotlin.json`;
- `provenancePending` and `provenanceRecord` are removed in the same change.

The paths follow the manifest (§5.1): `LICENSE.kotlin`, not `LICENSE-tree-sitter-kotlin`.

### `copy-wasm.js` (provenance record §5.2)

- **`validateManifest`:** a vendored row that is not pending must have a 64-hex `licenceSha256` and a relative,
  contained `provenanceFile`.
- **`resolveAsset` (vendored branch).** It checks the following, and all of it happens before any output is written:
  - the WASM SHA-256 matches the row;
  - the licence is at most 64 KiB, is not empty, and its SHA-256 equals `licenceSha256`;
  - the provenance JSON is at most 64 KiB and is parsed as data only. Its `package`, `version`, `wasm.sha256`,
    `wasm.bytes` and `license.sha256` must equal the row.
- **Copy:** each active vendored row's licence is copied to `wasm/LICENSE.<id>`, and the copy is re-hashed.
- **Listing:** `--list` is unchanged and still lists WASM only. The new `--list-licences` prints
  `wasm/LICENSE.<id> <sha256>` (see Deviations).
- **Self-test:** the fixture now has a licence and a provenance record. Every negative below is checked, and in each
  one no output directory is written:
  - changed WASM;
  - missing, empty, and one-byte-changed licence;
  - missing provenance file;
  - provenance `wasm.sha256` differing from the row;
  - provenance `license.sha256` differing from the row;
  - missing `licenceSha256`;
  - an escaping `provenanceFile`.

  On the positive side, the fixture licence lands at `wasm/LICENSE.fixture` with the same bytes. The real-manifest
  copy lists every active WASM plus `LICENSE.kotlin`, and the copied licence has the manifest hash.

### Packed verifiers (provenance record §5.3)

- **Electron and CLI:** each derives `wasm/LICENSE.<id>` for active vendored rows from the manifest it already parses.
  It requires the entry to exist, be non-empty, and have SHA-256 equal to `licenceSha256`. Electron reads it with
  `asar.extractFile`; the CLI extracts it from the tarball.
- **VSIX:** it reads the required licences through `copy-wasm.js --list-licences`, validates each line with
  `^(wasm\/LICENSE\.[a-z0-9-]+) ([a-f0-9]{64})$`, and hashes the `extension/wasm/LICENSE.<id>` entry.
- Each self-test gains a missing-licence and a changed-licence negative. All three then re-check that the complete
  archive passes.

### Sabotage evidence (`%TEMP%\ptah-30k-kotlin\fb\sabotage-gates.sh`, restored by an EXIT trap)

`node scripts/copy-wasm.js <tmp-out>` was run under each change below:

1. The WASM hash in the manifest changed by one hex digit → `Error: Vendored sha256 mismatch: kotlin`. No output was
   written.
2. The licence changed by one byte → `Error: Vendored licence sha256 mismatch: kotlin`. No output was written.
3. The provenance record says `bytes: 3441043` → `Error: Provenance record mismatch: kotlin`. No output was written.
4. Unmodified → the output holds `tree-sitter-kotlin.wasm` and `LICENSE.kotlin`.
5. The base (`HEAD`) `copy-wasm.js` with this manifest ships `tree-sitter-kotlin.wasm` and **no** licence. The licence
   shipping is new work, not something inherited from 28a.

After restoration, `sha256sum assets/tree-sitter/*` matches the values above.

## Language support (Task 30k.2)

### Language module (`kotlin.language.ts`)

- `.kt` and `.kts`, `grammarFile: 'tree-sitter-kotlin.wasm'`.
- Capabilities: `outline`, `codeIndex` and `syntaxDiagnostics` are true. `enrichSummary` and `definitionFallback` are
  false. `graphEdges` is null. `exportQuery` is `''`, so `publicSymbols` is false.
- There is **no graph key**, per User Decision 19. `b30k.ts` lists exactly four keys: `parse`, `outline`, `codeIndex`
  and `syntaxDiagnostics`, all for kotlin. `syntaxDiagnostics:kotlin` declares `syntax-only`. `required-keys.ts` is
  not edited.

Every node name was proven first by probes against the real WASM in `%TEMP%\ptah-30k-kotlin\probe`, and then by the
integration spec.

**Queries:**

- **Functions:** `function_declaration` with `name:` and `function_value_parameters`. This covers top-level, member,
  local, interface and extension functions; an extension's receiver comes before the `name` field.
- **Types:** `class_declaration`, which covers class, interface, `enum class`, `data class`, `annotation class` and
  `fun interface`, and `object_declaration`.
- **Imports:** the grammar's node is `import`. The plan's table said `import_header`, which does not exist in 1.1.0;
  the spec proves `import`.
  - A plain import reports its path.
  - An alias is reported as the imported name.
  - A wildcard `a.b.*` reports `a.b` with `*`. The `*` is an anonymous token, so the plain pattern excludes a wildcard
    import with `(#not-match? @import.statement "[*]")` instead of matching it twice.

### Outliner (`code-outliner.adapter.ts`, `kotlin` entry)

- **Omittable bodies:** `function_body` of functions, getters and setters, and the `block` of `secondary_constructor`
  and `anonymous_initializer`, all under the brace rule. A one- or two-row `= expr` body omits nothing.
- **Lambdas are never omitted.** At top level they are usually structure, such as a `.kts` script's
  `plugins { … }` or `dependencies { … }`. Inside a function they are already part of its body. This follows the
  Ruby top-level-block precedent.
- **Declarations:** functions, classes, objects, named companion objects, type aliases (the grammar's field is
  `type:`) and properties.

### Registry

`UNPARSED_LANGUAGE_EXTENSIONS` held only `kotlin`. With Kotlin parsed, it became `Record<never, …>` and its branch in
`buildEntry` could no longer run. I removed it, together with `NO_CAPABILITIES` and `isParsedLanguage`.

In its place is a compile-time assignment:
`const PARSED_LANGUAGE_MODULES: Readonly<Record<LanguageId, LanguageModule>> = LANGUAGE_MODULES`. It fails to compile
if a `LanguageId` is ever added without a module, so no language can lose its extensions silently.

### Consumers checked

- **Typecheck:** the only exhaustive consumer that broke was `OUTLINE_QUERIES`. `ptah-electron` and `ptah-cli`
  typecheck unchanged.
- **Electron (unchanged; see the out-of-scope observations):**
  - `COMMENT_STRING_QUERIES` has no Kotlin entry, so `.kt` references are not comment/string-filtered. That was already
    true on base, where `.kt` resolved to `null`.
  - `DOLLAR_IS_NOT_IDENTIFIER` does not include kotlin.

  Behaviour is identical before and after. The Electron suite, including "Kotlin scan", passes.

### Batch 31 lesson (R30-02 and R31-03): same-line declarations persist

Declarations are keyed by the position of their name (`ast-analysis.service.ts`, unchanged). The Kotlin spec
indexes three one-line inputs through the real indexer, with a sink keyed by subject. Every row persists with the
expected cardinality, and the file counts as analysed:

- `fun needle(x: Int) = x; fun needle(x: String) = x` → 2 rows;
- `class A { fun needle() = 1; }; class B { fun needle() = 2; }` → 4 rows;
- `object Needle; class Needle` → 2 rows.

Multi-line member overloads persist with their own spans. The honesty check `codeIndex:kotlin` uses an overload and a
same-named member of another class, and fails on any repeated subject.

### Grammar limit found (upstream, not fixable here)

`tree-sitter-kotlin` 1.1.0 needs error recovery for **valid** Kotlin whose class body ends with a member on the closing
brace's line. Examples are `object Keys { const val A = 1 }`, `interface S { fun a(): Double }` and
`class C { init { … } }`. In the simple case it inserts a hidden, zero-width `MISSING _class_member_semi`. A nested
one-line body produces an `ERROR` node. Upstream issues #12 and #13 are open, and 1.1.0 is the latest release
(`gh api …/issues` and `…/releases`).

How each tool behaves, all pinned by specs:

| Tool         | Behaviour for a one-line class body                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse        | `parseStatus: 'recovered'`, never `ok`                                                                                                                      |
| Index        | counts the file `failed` with `failedByReason: { parse: 1 }`, `clean: false`; never a wrong clean answer                                                    |
| Outliner     | the simple case is outlined, because its `(ERROR)`/`(MISSING)` query cannot see the hidden node and the spans are exact; the nested `ERROR` case is refused |
| Syntax check | **reports `Syntax error at an unknown position (kotlin; syntax-only check).`** This is a false positive on valid Kotlin                                     |

The syntax-check false positive is disclosed as a syntax-only check, and it is pinned so that a grammar upgrade which
fixes it will be noticed. A separator (`{ … ; }`) or a line break avoids the limit. I did not add a filter for the
hidden node: it would cover only the simple case, and the nested case still yields a real `ERROR`. The team leader
decides whether the limit needs a named approximation (see the out-of-scope observations).

## Harness

- **`b30k.ts`:** the four keys above; `syntaxDiagnostics:kotlin` declares `['syntax-only']`.
- **`HONESTY_CHECKS`** (WI) runs three checks on real Kotlin:
  - `parse:kotlin`: `grammarParseHonesty` with a broken contrast file;
  - `codeIndex:kotlin`: `codeIndexHonesty` with an overload and a same-named member in a second class;
  - `syntaxDiagnostics:kotlin`: a broken `.kt` file; the diagnostic must say it is syntax-only and the coverage must
    name `kotlin:syntax-only`.
- **`CHECKED_ELSEWHERE`** (WI) and **`CHECKED_ELSEWHERE_KEYS`** (MCP) both gain `outline:kotlin`. In
  `MCP_HONESTY_CHECKS`, `outline:kotlin` runs `grammarOutlineHonesty(KOTLIN_OUTLINE)`, which checks:
  - exact spans;
  - that a broken file is refused;
  - that a large result served with `resultLanguage: 'kotlin'` goes through the real dispatcher to the `code-outline`
    reducer, keeps every signature, and spools the raw text byte-equal.
- **Wasm mocks:** four real-grammar specs resolve `tree-sitter-kotlin.wasm` to
  `path.join(__dirname, '<up>/assets/tree-sitter/tree-sitter-kotlin.wasm')`: the Kotlin integration spec, the honesty
  spec, the outliner spec and the MCP coverage spec. A first version used `require.resolve('…/assets/…')`, which
  `@nx/enforce-module-boundaries` rejects as an import, so it was replaced.
- **The 24b unsupported example** now uses a language that stays unsupported:
  - `code-symbol-indexer.service.spec.ts`: `src/Main.kt` becomes `lib/main.dart`, with `unsupportedByLanguage`
    `{ dart: 1, swift: 1 }` and `**/*.dart`.
  - `code-namespace.builder.spec.ts`: `src/Main.kt` becomes `src/Main.swift` (language `swift`) in the search and
    reindex answers; the "kt reindex" test is renamed "swift reindex"; the coverage fixture uses `{ swift: 3 }`.
  - The outliner's unsupported-hint list replaces `'kotlin'` and `'.kt'` with `'swift'` and `'.dart'`.
  - Now that Kotlin is a real index language, `CODE_INDEX_LANGUAGES` includes `kotlin` in both specs.
- **`tool-description.builder.spec.ts`:** the Batch 31 list pin now expects
  `ts,js,tsx,py,go,cs,java,kt,rs,php,rb,cpp;`.

### Tool description sizes

These were measured with a temporary spec, which was deleted afterwards:

| Tool                       | Before (brief) | After | Pin |
| -------------------------- | -------------- | ----- | --- |
| `ptah_code_search_symbols` | 668            | 671   | 702 |
| `ptah_code_reindex`        | 519            | 522   | 536 |

The only change is `kt,` in the code-index list. No pin was raised.

## Fails-before evidence (base `1308f750f` production, specs written first)

The method is `%TEMP%\ptah-30k-kotlin\fb\run-fb.sh`, the same as Batch 31:

1. Seven production files were backed up.
2. Each was replaced with `git show HEAD:<path>`. The files were:
   - `ast.types.ts`, `language-registry.ts`, `languages/index.ts`, `languages/types.ts`, `tree-sitter.config.ts`;
   - `code-outliner.adapter.ts`;
   - `scripts/tree-sitter-grammars.json`.
3. The new specs were run with out-of-repo Jest configs set to `diagnostics: false`. The in-repo configs cannot
   compile `'kotlin'` as a `SupportedLanguage` on base.
4. An EXIT trap restored the files and printed `RESTORED`. `git diff --stat` afterwards matched the post-batch diff.

| Project                | Failed | Passed | Failing                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| workspace-intelligence | 30     | 39     | all 26 `kotlin-grammar.integration.spec.ts` tests (wiring, provenance gate on the inactive, pending base row, corpus, queries, same-line index rows, diagnostics); honesty `parse:kotlin`, `codeIndex:kotlin`, `syntaxDiagnostics:kotlin`; "every activated capability:language key is actually granted by the registry" |
| vscode-lm-tools        | 8      | 88     | `outline:kotlin` in `MCP_HONESTY_CHECKS`; both Kotlin real-grammar outline tests; 5 Kotlin hint cases (`kotlin`, `kt`, `.KTS`, `src/main/kotlin/App.kt`, `build.gradle.kts`)                                                                                                                                             |

The 30k.1 gates were proved by sabotage (above), not by reverting, because their base script has no licence or
provenance logic to compare against.

## Verification (after)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → "Successfully ran targets test, lint, typecheck for 2 projects". The exit code was 0.
  - The default output style does not print per-project test counts, and I did not re-run only to read them.
  - Targeted runs during the batch:
    - `kotlin-grammar.integration.spec.ts`: 26/26;
    - `code-outliner.adapter.spec.ts`: 69/69;
    - outliner and MCP coverage specs together: 96/96;
    - `language-registry.spec.ts` and `code-symbol-indexer.service.spec.ts`: 167/167.
  - Lint reports 0 errors, after the `require.resolve` fix above; only warnings that were already there remain.
- `node_modules/.bin/nx run-many -t=test,typecheck -p ptah-electron --skip-nx-cache --output-style=static` → Test
  Suites 54 passed, 1 skipped (55); Tests 954 passed, 3 skipped (957). "Successfully ran targets test, typecheck for
  project ptah-electron".
- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli --skip-nx-cache` → "Successfully ran target typecheck for
  project ptah-cli".
- `node scripts/copy-wasm.js --self-test` → `copy-wasm self-test PASS: … vendored WASM, licence
(missing/empty/changed/unhashed) and provenance-record (missing/mismatched) failures before writes; licence copied
as wasm/LICENSE.<id>`.
- `node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test` → `PASS: complete archive; 13 missing and 13
empty asset negatives; 1 missing and 1 changed licence negatives`.
- `node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` → `PASS: complete tarball; 13 missing and 13 empty
asset negatives; 1 missing and 1 changed licence negatives`.
- `node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test` → `PASS: complete ZIP; 13 missing and
13 empty asset negatives; 1 missing and 1 changed licence negatives; wrong prefix, corrupt/missing archive, CLI
exits and package ordering`.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json
  dependencies." The Kotlin fixtures hold no quoted module-specifier shapes: Kotlin imports are unquoted, and
  `kotlin("jvm")` is not a require shape.
- `npx nx run degradation-audit:lint --skip-nx-cache` → "degradation-audit: TOTAL 300 unsuppressed site(s)". No
  baseline was raised; `apps/ptah-cli` is 29 ok (baseline 29).
- **Not run:**
  - A real Electron/CLI/VSIX package build. The self-tests cover the verifiers, and the real `copy-wasm` output was
    inspected in sabotage run 4.
  - The rpc-handlers suite, which has a known flake and no rpc-handlers file changed.

## Size delta

| Item                                              | Bytes                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| WASM, shipped per host (`wasm/`)                  | 3,441,042                                             |
| Licence, shipped per host (`wasm/LICENSE.kotlin`) | 1,101                                                 |
| **Raw per-host artifact delta**                   | **3,442,143** (≈ +3.4 MB, as the plan estimated)      |
| gzip -9 of the WASM (local GNU gzip)              | 295,551 (the record's 295,536 came from another gzip) |
| Repository only (`PROVENANCE.kotlin.json`)        | 2,105                                                 |

## Deviations

1. **The footprint follows provenance record §5.4, not only `batches.md:3960/:3970`.** 30k.1 also changes
   `copy-wasm.js` and the three verifiers, as the reviewed amendment requires, and adds `PROVENANCE.kotlin.json`. The
   licence file is `LICENSE.kotlin`, per the manifest and §5.1, not `LICENSE-tree-sitter-kotlin`.
2. **`--list-licences` prints `<path> <sha256>`, not the path alone.** This lets the VSIX gate keep its single CLI
   boundary and still check the reviewed hash, as §5.3 requires. The VSIX regex matches this form. There is no other
   consumer.
3. **The 30k.2 footprint grew beyond the listed files:**
   - Specs: `language-registry.spec.ts`, `code-symbol-indexer.service.spec.ts`, `code-namespace.builder.spec.ts`,
     `tool-description.builder.spec.ts`, `language-honesty.contract.spec.ts` and `mcp-language-coverage.spec.ts`.
     They pinned Kotlin as unsupported, or they host the required executable key checks (the Batch 31 precedent).
   - Comments: `languages/types.ts` and `tree-sitter.config.ts`.
   - `language-registry.ts`: its dead unparsed branch was removed.
4. **The plan's import node `import_header` does not exist in grammar 1.1.0.** The node is `import`, proven by the
   spec.
5. **The rebuild was not attempted.** This is not gating (User Decision 25); the reason is recorded in
   `PROVENANCE.kotlin.json`.

## Out-of-scope observations (not touched)

- **One-line class body limit.** The limit and its syntax-check false positive are described above. The team leader
  should choose among three options: accept the limit as documented; declare a named approximation such as
  `kotlin:grammar-one-line-bodies`; or wait for the upstream fix and a new provenance round.
- **Electron reference filter.** Kotlin has no `COMMENT_STRING_QUERIES` entry, and `$` is not in
  `DOLLAR_IS_NOT_IDENTIFIER`. So `.kt` reference scans still count matches in comments and strings, and `"$needle"`
  templates, as they did before this batch. It is a candidate follow-up using the Batch 31 pattern; no required key
  covers it.
- **Nx caching.** `ptah-cli:copy-wasm` (`apps/ptah-cli/project.json:124`) declares no inputs beyond the project
  defaults. A change to `scripts/tree-sitter-grammars.json` or `assets/tree-sitter/**` therefore does not invalidate
  its cache. This was already true for the manifest; the new asset directory now has the same gap. A devops
  follow-up is to add these inputs.
- **`publish-cli.yml`.** The dist check at `.github/workflows/publish-cli.yml:373` still checks WASM only. The licence
  is enforced by the packed-tarball verifier that runs after it.

## Fix round (review r1)

This is the one round allowed by User Decision 24, answering `reviews/batch-30k-code-logic-review-r1.md` (REVISE 6/10).
No git command that changes state was run.

### R30K-01 (Serious): packed verifiers accepted a corrupted Kotlin WASM

**Fix:**

- **Electron and CLI.** Each derives a `VENDORED_WASM` map from the manifest it already parses. For each active
  vendored row, the map holds `wasm/<filename>` with `source.sha256` and `bytes`; both values are validated. The packed
  member is then extracted (`asar.extractFile` for the asar, `tar -O` for the tarball), and its length and SHA-256 must
  equal those values.
- **VSIX.** It keeps its CLI boundary.
  - My r0 flag `--list-licences` is replaced (not kept alongside) by `copy-wasm.js --list-vendored`. It prints
    `<path> <sha256>` for every shipped vendored file: `wasm/tree-sitter-kotlin.wasm` and `wasm/LICENSE.kotlin`.
  - `verifyVsix` hashes each listed member. An equal SHA-256 implies an equal length.
  - The copy-wasm self-test pins the listing to the manifest.

**Regression tests.** Each self-test gains a same-length negative: the first byte of `wasm/tree-sitter-kotlin.wasm`
flipped must be reported as `… does not match the reviewed vendored grammar`.

- Electron: "1 changed vendored WASM negatives".
- CLI: "1 changed vendored WASM negatives".
- VSIX: "2 missing and 2 changed vendored-file negatives" (the WASM and the licence).

The fixtures now pack the real committed vendored bytes; the other assets remain stand-ins.

### R30K-02 (Serious): valid Kotlin was served as a syntax error without the grammar limit

**Fix:**

- **New approximation id.** `kotlin:grammar-limit` is added to `APPROXIMATION_PRIORITY`
  (`platform-core/src/interfaces/language-coverage.interface.ts`), right after `syntax-only`. It follows the
  `<lang>:<kebab>` style of `c:parsed-as-cpp`.
- **In `language-aware-diagnostics-provider.ts`:**
  - When the Kotlin grammar recovered but located no ERROR or MISSING node, the file is **not** an error. It becomes a
    failure with reason `parse` and the specific `notChecked` reason `KOTLIN_UNLOCATED_RECOVERY_TEXT`:

    > Syntax not validated: the Kotlin grammar (tree-sitter-kotlin 1.1.0) needed error recovery but located no error;
    > valid one-line class bodies such as `object K { val a = 1 }` do this (kotlin:grammar-limit), so no syntax error is
    > claimed.

    Both reviewer inputs take this path; probes show they produce no ERROR or MISSING node.

  - A located Kotlin error is still an error, but it says `(kotlin, kotlin:grammar-limit; syntax-only check, not
type-checked)`. This follows the C `c:parsed-as-cpp` pattern and covers the nested one-line case, which does build
    an ERROR node.
  - Every answer that judged a Kotlin file names `kotlin:grammar-limit` in its coverage.
  - A request containing only such a file answers `unavailable`, with the reason naming the limit. It never answers a
    clean `available`.
- **Unchanged.** The code index still counts `failed/parse`, and the outliner still refuses (with the raw fallback).
- **New exports** from `kotlin.language.ts`: `KOTLIN_GRAMMAR_LIMIT` and `KOTLIN_UNLOCATED_RECOVERY_TEXT`.

**Regression tests,** in `kotlin-grammar.integration.spec.ts` › syntax diagnostics:

1. "grammar limit: valid src/Keys.kt / src/Init.kt gets no syntax error, and is named as not validated". These are
   the two reviewer inputs, checked at the provider boundary:
   - no severity-error diagnostic;
   - the `notChecked` reason above;
   - `failed: 1`, `failedByReason {parse: 1}` and `clean: false`;
   - `kotlin:grammar-limit` in the coverage.

   This replaces the test that pinned the false positive.

2. "a real error next to a grammar-limited valid file is still reported, for that file only".
3. The broken `.kt` and `.kts` cases now require `(kotlin, kotlin:grammar-limit; …)` and the approximations
   `['kotlin:syntax-only', 'kotlin:grammar-limit']`.
4. The honesty check `syntaxDiagnostics:kotlin` now requires `kotlin:grammar-limit`.

### R30K-03 (Moderate): a comment made a Kotlin import disappear

**Fix:**

- **Query.** `kotlin.language.ts` now uses one pattern:
  `(import (qualified_identifier) @import.source ["*" (identifier)]? @import.named)`. Probes confirm one match per
  import. The text predicate `#not-match? "[*]"` is gone.
- **Extractor.** The import extractor in `ast-analysis.service.ts` rebuilds a captured path that holds a comment node
  from its non-comment tokens, so `a.` + block comment + `b.C` becomes `a.b.C`. It falls back to the capture's text in
  three cases:
  - a path with no comment, so every other language is untouched;
  - a hand-made capture without a subtree, which the unit spec needs;
  - a path deeper than the capture depth.

**Regression tests.** `kotlin-grammar.integration.spec.ts` › "%s is imported once, as its comment-free form" has 8
cases: comments inside, before and after plain, wildcard and aliased imports. Each case requires `parseStatus: 'ok'`
and exactly one import equal to the comment-free form.

### Sabotage: the new tests fail without the fixes

The script is `%TEMP%\ptah-30k-kotlin\fb\sabotage-r1.sh`. A trap restored the files (`RESTORED`), and the Kotlin spec
then passed 36/36.

- **R30K-01.** Each verifier ran from a temporary copy with its vendored hash check disabled. The Electron, CLI and
  VSIX self-tests each fail with `AssertionError … strictly deep-equal`. For Electron the missing line is
  `wasm/tree-sitter-kotlin.wasm does not match the reviewed vendored grammar`.
- **R30K-02 and R30K-03.** The provider's Kotlin branch was disabled and the extractor was made to read the raw
  capture text. 6 of 36 tests then fail: the three comment-inside import cases, both grammar-limit cases and the
  mixed-file test. The reviewer already reproduced the query-level variant of R30K-03 against the r0 predicate.

### Verification (after)

- **Scoped run.** `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`:
  - passed: workspace-intelligence test, lint and typecheck; vscode-lm-tools lint and typecheck;
  - vscode-lm-tools test had exactly one failure, the listed known flake protocol-dispatcher › "delivers a slow empty
    build to the next call, then rediscovers".

  The re-run `nx run-many -t=test -p @ptah-extension/vscode-lm-tools --skip-nx-cache --output-style=static` gave Test
  Suites 77/77, Tests 2462/2462 and "Successfully ran target test".

- **platform-core and ptah-electron.** `nx run-many -t=test,typecheck,lint -p @ptah-extension/platform-core ptah-electron --skip-nx-cache --output-style=static`:
  - tests: platform-core 998 passed, 4 todo; ptah-electron 954 passed, 3 skipped;
  - lint: that combined run printed one lint failure (677 problems). A lint-only re-run of the same two projects
    finished with no failed tasks. Each project's own lint has 0 errors: platform-core has 8 warnings, ptah-electron
    has 14. I did not identify the transient failing task.
- **ptah-cli.** `nx run-many -t=typecheck -p ptah-cli --skip-nx-cache` passes.
- **Self-tests.** `node scripts/copy-wasm.js --self-test` passes, and so do the Electron, CLI and VSIX verifier
  self-tests (negative counts above).
- **validate-deps.** `npx nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by
  package.json dependencies." The new Kotlin import fixtures are unquoted.
- **Degradation audit.** `npx nx run degradation-audit:lint --skip-nx-cache` → "TOTAL 300 unsuppressed site(s)".
  platform-core is 7 ok (baseline 7).
- **Description pins.** No tool description changed, so search stays at 671/702 and reindex at 522/536. The coverage
  and compact-size pins pass in both suites; the new id (20 characters) is shorter than `csharp:namespace-edges`.

### Files changed in this round

Changed again:

- `apps/ptah-electron/scripts/verify-packed-wasm.js`
- `apps/ptah-cli/scripts/verify-packed-wasm.cjs`
- `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs`
- `scripts/copy-wasm.js`: `--list-vendored` replaces `--list-licences`.
- `libs/backend/workspace-intelligence/src/ast/languages/kotlin.language.ts`
- `libs/backend/workspace-intelligence/src/ast/kotlin-grammar.integration.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`

New in this round:

- `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`: outside the r0 footprint, and required
  for the typed approximation id.
- `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts`
- `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`

The untracked review file `reviews/batch-30k-code-logic-review-r1.md` was read, not edited.
