# O3 — Kotlin grammar provenance record (gates Batch 30k) — TASK_2026_559_8ca9

Required by User Decision 19 (`context.md:59`): bundle the MIT Kotlin WASM and record its provenance. Batch 30k
starts only after this record is **complete** (every `TO FILL` below is filled) and a reviewer has re-checked it.
The architect could not download anything for this document. Fields marked **TO FILL (30k executor)** are produced
when the asset is obtained.

## 1. Checked-in location (replaces the plan's non-existent `assets/tree-sitter/…`, batches.md D7)

There is no `assets/` directory at the repository root, and no `.wasm` is tracked today (`git ls-files "*.wasm"`
is empty). `.gitattributes:20` already marks `*.wasm binary`. The asset goes under `tools/`, which holds repository
tooling rather than any Nx project's sources:

| File                                  | Path (repo-relative)                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| Grammar                               | `tools/tree-sitter-grammars/kotlin/tree-sitter-kotlin.wasm` |
| Licence (verbatim upstream `LICENSE`) | `tools/tree-sitter-grammars/kotlin/LICENSE`                 |
| This record, machine-readable         | `tools/tree-sitter-grammars/kotlin/PROVENANCE.json`         |

**Manifest row** (Batch 28a `scripts/tree-sitter-grammars.json`, `vendored` row kind; paths resolved against the
repo root, never through `require.resolve`):

```json
{ "kind": "grammar", "file": "tree-sitter-kotlin.wasm", "language": "kotlin", "active": false, "source": { "vendoredPath": "tools/tree-sitter-grammars/kotlin/tree-sitter-kotlin.wasm", "sha256": "<TO FILL>", "licenseFile": "tools/tree-sitter-grammars/kotlin/LICENSE" } }
```

`active` becomes `true` in 30k task 30k.2, together with the registry entry and the activation fragment. If 28a's
merged manifest names the fields differently, 30k follows the merged schema; the paths above stay.

**Licence in shipped artifacts [arch].** MIT requires the copyright and permission notice in copies.
`copy-wasm.js` copies `licenseFile` next to the grammar as `wasm/LICENSE-tree-sitter-kotlin` in every host's dist.
The three packed verifiers (28a/28b) require that file whenever the row is active.

The `@vscode/tree-sitter-wasm` grammars ship without their licence file today. That is a pre-existing gap: it is
recorded, not fixed here.

## 2. Upstream identity

| Field                      | Value                                                                                                                    | Source                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Repository                 | `https://github.com/tree-sitter-grammars/tree-sitter-kotlin`                                                             | npm registry metadata `repository.url` (queried 2026-09-26)                                                                     |
| npm package / version      | `@tree-sitter-grammars/tree-sitter-kotlin` **1.1.0**                                                                     | npm registry                                                                                                                    |
| Git commit of that release | `77dd60ea0a9003ce062c9728a513ffe1aaff8c82` (`gitHead`)                                                                   | npm registry metadata                                                                                                           |
| Release tag                | **TO FILL (30k executor)**: the upstream tag pointing at the commit above (expected `v1.1.0`); record "none" if untagged | upstream repo                                                                                                                   |
| Tarball                    | `https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-kotlin/-/tree-sitter-kotlin-1.1.0.tgz`                     | npm registry                                                                                                                    |
| Tarball integrity          | `sha512-vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==`                        | npm `dist.integrity`                                                                                                            |
| Licence                    | MIT (package metadata)                                                                                                   | npm registry; **TO FILL**: confirm the upstream `LICENSE` text at the commit and copy it verbatim, including the copyright line |
| Grammar CLI used upstream  | `tree-sitter-cli ^0.24.6` (devDependency) → ABI 14                                                                       | npm registry                                                                                                                    |
| Installed runtime          | `web-tree-sitter` 0.27.0 (`node_modules/web-tree-sitter/package.json`), accepts ABI 13-15                                | local                                                                                                                           |

## 3. Procedure that produces the asset

**Primary: the prebuilt WASM from the release tarball** (the file the architect's 2026-09-26 temp-dir probe
loaded: ABI 14, 3,360 KB).

1. Download the tarball above, outside the repository. Verify its sha512 against `dist.integrity` before
   extracting; stop on a mismatch.
2. Extract `package/tree-sitter-kotlin.wasm` and `package/LICENSE` (if the tarball has no `LICENSE`, take it from
   the repository at the commit above).
3. Compute `sha256` of the extracted WASM (`certutil -hashfile <f> SHA256`, or `sha256sum`).
4. Copy both files to the paths in §1. Write `PROVENANCE.json` (§4).

**Cross-check: build from source**, so the prebuilt binary is not taken purely on trust. It runs outside the repo,
its result is recorded in `PROVENANCE.json`, and nothing it builds is checked in.

1. `git clone` the repository and `git checkout 77dd60ea0a9003ce062c9728a513ffe1aaff8c82`.
2. `npx tree-sitter-cli@0.24.<x> build --wasm` (Docker or emsdk as the CLI requires); record the exact CLI and
   emscripten versions.
3. Compare the result.
   - A byte-identical WASM is ideal.
   - If it is not byte-identical (emscripten builds are often not reproducible), record both sha256 values and
     prove equivalence: both load in web-tree-sitter 0.27.0, report the same ABI, and parse the §5 corpus to
     identical S-expressions.
   - If they parse differently, **stop and report**; do not check the asset in.

## 4. `PROVENANCE.json` (every field required)

```json
{
  "language": "kotlin",
  "package": "@tree-sitter-grammars/tree-sitter-kotlin",
  "version": "1.1.0",
  "repository": "https://github.com/tree-sitter-grammars/tree-sitter-kotlin",
  "commit": "77dd60ea0a9003ce062c9728a513ffe1aaff8c82",
  "tag": "<TO FILL>",
  "tarball": "https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-kotlin/-/tree-sitter-kotlin-1.1.0.tgz",
  "tarballIntegrity": "sha512-vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==",
  "wasmSha256": "<TO FILL>",
  "wasmBytes": "<TO FILL; expected ≈ 3,440,000 (3,360 KB)>",
  "abi": "<TO FILL; expected 14>",
  "license": "MIT",
  "licenseSha256": "<TO FILL>",
  "sourceBuild": { "cli": "<TO FILL>", "emscripten": "<TO FILL>", "wasmSha256": "<TO FILL>", "equivalent": "<byte-identical | parse-equivalent | FAILED>" },
  "loadRecord": { "runtime": "web-tree-sitter 0.27.0", "node": "<TO FILL>", "date": "<TO FILL>", "corpusParsesWithoutError": "<TO FILL>" },
  "obtainedBy": "<TO FILL>",
  "obtainedOn": "<TO FILL>"
}
```

## 5. Verification Batch 30k runs (in addition to the plan's 30k acceptance)

1. **Hash gate.** `copy-wasm.js` recomputes sha256 of `vendoredPath`, compares it with the manifest and with
   `PROVENANCE.json.wasmSha256`, and fails the build on any difference. The 28a `--self-test` negative (a
   corrupted byte) passes.
2. **Load gate.** `WI/ast/kotlin-grammar.integration.spec.ts` loads the checked-in file through the real
   `TreeSitterParserService` (lazy loading from 29a2; the `csharp-grammar.integration.spec.ts` mock pattern for
   `wasm-bundle-dir`). It asserts `language.abiVersion` ∈ [13, 15] and equal to `PROVENANCE.json.abi`.
3. **Corpus gate.** These parse with `rootNode.hasError === false`: a `.kt` file with a package, imports, a
   class, an object, a data class, an extension function, a lambda and a `when` expression; and a `.kts` script.
   The functions, types, imports and public-symbol queries (plan query table) return the expected names.
4. **Licence gate.** `LICENSE` exists, is non-empty, contains "MIT" and the upstream copyright line, and its sha256
   equals `PROVENANCE.json.licenseSha256`. The packed verifiers find `wasm/LICENSE-tree-sitter-kotlin` in the asar,
   the CLI tarball and the VSIX.
5. **Size record.** The report states the raw and gzip size and the per-host artifact delta (plan estimate +3.4 MB
   raw / ~0.3 MB gz).
6. **Reviewer re-check.** The reviewer independently recomputes the sha256 of the checked-in WASM and LICENSE, and
   compares the tarball integrity with the registry value above.

## 6. Why this source

`@vscode/tree-sitter-wasm` 0.3.1 has no Kotlin grammar. The Decision 19 choice is the MIT
`tree-sitter-grammars` Kotlin grammar, vendored with no npm dependency. The npm package itself runs
`node-gyp-build` at install and depends on `npm-check-updates`, which is why the plan vendors the WASM instead
(plan "Grammar sources").
