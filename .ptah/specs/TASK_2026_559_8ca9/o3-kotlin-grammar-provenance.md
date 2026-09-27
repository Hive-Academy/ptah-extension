# O3 — Kotlin grammar provenance record (gates Batch 30k) — TASK_2026_559_8ca9

Required by User Decision 19 (`context.md:59`): bundle the MIT Kotlin WASM and record its provenance. Gate text:
`batches.md:3954` (source URL, version, sha256, LICENSE text, load record, re-checked by the reviewer before 30k
starts). Revised once under User Decision 24 (`context.md:69`); the Batch 30k review verifies the revision.

**Status of this record: complete.** Every value below was measured on 2026-09-27 (UTC ≈ 14:35) by the architect
from downloads into a temporary directory outside the repository; nothing was written to the repository except this
document. The row stays `active:false` and `provenancePending:true` until Batch 30k lands the §5 code changes.

## 1. Identified artefact

The grammar is content-addressed: any copy whose SHA-256 is the value below is this artefact. It is published
byte-identically on two independent channels (npm and the GitHub release), and the GitHub copy carries a signed
build-provenance attestation (§3).

| Artefact                                                                                                   | Bytes     | SHA-256                                                            | SHA-512 (base64)                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `tree-sitter-kotlin.wasm` (npm `package/tree-sitter-kotlin.wasm` **and** GitHub release asset — identical) | 3,441,042 | `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7` | `j5/ePrqBdjrnxnZfbNiLfcYPSmrrljY/5ZpD1uHxFUdqBeDiy8uYJmmc/NrMWTXTqb7gSkXqT3Hm09aLl40Xig==`                          |
| `LICENSE` (npm `package/LICENSE`; equals upstream at the commit)                                           | 1,101     | `0eea8dc45e89deeb03c7799bbbc7b4688f365fb274562f4540ecfebdea82e727` | `qVjCbYY5/2Py4nN/jdSH9NZydxWtebjHq3iv5aEVeXlyWqFqE/wI7edoEdEmS9m5cIDI5D+4hr5aJrT9uBtrrA==`                          |
| npm tarball `tree-sitter-kotlin-1.1.0.tgz`                                                                 | 3,475,920 | `28916be3fdb0487dbd4fd0ea62281f969f15cab2bf13132ceb18d2fb167aa697` | `vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==` (= npm `dist.integrity`) |
| GitHub release source `tree-sitter-kotlin.tar.xz` (generated `parser.c` included)                          | 364,960   | `60f60c06a00f022b74251b98a89e42f5f575d34ae63c60c74667813714543671` | `WcZAidOABbhJaKiCems7NRCe/0QDyxgS6den8RGGo6nKJdHac5aewiB7SBjH5QIv9HAhQHIxHZfoiqYYnLjMjQ==`                          |

Inside the source tarball: `src/parser.c` SHA-256 `9ff65161845b9e9c9d62c12e9a4e4b8d8628bdc31c681ec7e6b4bd3bd6444cb3`
(`#define LANGUAGE_VERSION 14`), `src/scanner.c` SHA-256 `164c2bb928d23765ed38c3a322deaef9b52d6e147cec7cdf45add90d4fa6101c`.
gzip -9 of the WASM: 295,536 bytes.

**Retrieval (the gate reviewer and the 30k executor use exactly this).** Download either URL, check the SHA-256
above before use, stop on a mismatch:

- `https://github.com/tree-sitter-grammars/tree-sitter-kotlin/releases/download/v1.1.0/tree-sitter-kotlin.wasm`
- `https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-kotlin/-/tree-sitter-kotlin-1.1.0.tgz` → verify the
  tarball SHA-512 against `dist.integrity` before extracting → `package/tree-sitter-kotlin.wasm`, `package/LICENSE`.

## 2. Upstream identity and licence

| Field                 | Value                                                                                                                                                                                                                | Source                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository            | `https://github.com/tree-sitter-grammars/tree-sitter-kotlin`                                                                                                                                                         | npm `repository.url`; `tree-sitter.json` `metadata.links.repository` in the tarball                                                                                                                                                               |
| Package / version     | `@tree-sitter-grammars/tree-sitter-kotlin` **1.1.0**                                                                                                                                                                 | [npm version metadata](https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-kotlin/1.1.0)                                                                                                                                                 |
| Release tag           | **`v1.1.0`** → commit `77dd60ea0a9003ce062c9728a513ffe1aaff8c82`                                                                                                                                                     | [GitHub tags API](https://api.github.com/repos/tree-sitter-grammars/tree-sitter-kotlin/tags); equals npm `gitHead`                                                                                                                                |
| Release               | `v1.1.0`, published 2025-01-09T19:00:15Z, assets `tree-sitter-kotlin.wasm`, `tree-sitter-kotlin.tar.xz`                                                                                                              | [GitHub releases API](https://api.github.com/repos/tree-sitter-grammars/tree-sitter-kotlin/releases)                                                                                                                                              |
| Release build run     | `https://github.com/tree-sitter-grammars/tree-sitter-kotlin/actions/runs/12696697547/attempts/1` (logs no longer retrievable: jobs API 404)                                                                          | attestation `runDetails.metadata.invocationId`; certificate OID 1.3.6.1.4.1.57264.1.21                                                                                                                                                            |
| Caller workflow       | `.github/workflows/publish.yml@refs/tags/v1.1.0` (calls `tree-sitter/workflows/.github/workflows/release.yml@main` with `generate: true`, `attestations: true`)                                                      | [publish.yml at the commit](https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-kotlin/77dd60ea0a9003ce062c9728a513ffe1aaff8c82/.github/workflows/publish.yml)                                                                     |
| Build workflow commit | `tree-sitter/workflows` @ `8e205aa3badc0ff6c1ddd161811b946afce51a29`                                                                                                                                                 | signing certificate OID 1.3.6.1.4.1.57264.1.10 (Build Signer Digest); [release.yml at that commit](https://raw.githubusercontent.com/tree-sitter/workflows/8e205aa3badc0ff6c1ddd161811b946afce51a29/.github/workflows/release.yml)                |
| Grammar ABI           | 14 (`LANGUAGE_VERSION 14` in the attested `parser.c`; runtime reports 14)                                                                                                                                            | §4                                                                                                                                                                                                                                                |
| Licence               | MIT, "Copyright (c) 2024 Amaan Qureshi"                                                                                                                                                                              | npm `license`; `tree-sitter.json` `metadata.license`; [LICENSE at the commit](https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-kotlin/77dd60ea0a9003ce062c9728a513ffe1aaff8c82/LICENSE) — SHA-256 identical to the tarball copy |
| Licence compatibility | Compatible with this repository's MIT licence (`LICENSE.md:1`, notice condition `:12-13`) provided the copyright and permission notice ships with every distributed copy — which §5 makes a build failure if missing | MIT text below                                                                                                                                                                                                                                    |
| Runtime               | `web-tree-sitter` 0.27.0 (`node_modules/web-tree-sitter/package.json:3`), accepts ABI 13–15                                                                                                                          | local                                                                                                                                                                                                                                             |

**Licence text, verbatim** (to be committed as the licence file in §5.1):

```text
The MIT License (MIT)

Copyright (c) 2024 Amaan Qureshi <amaanq12@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

(The committed file must be byte-identical to the downloaded `LICENSE`, 1,101 bytes, SHA-256 above; the block here
is for review, not a copy source.)

## 3. How the artefact is tied to the source

### 3.1 Reproduction: not established (stated plainly)

A byte-for-byte rebuild was **not** performed and cannot be guaranteed:

- The upstream build installed "the latest" tree-sitter CLI at run time (`tree-sitter/setup-action/cli@v2`,
  default `tree-sitter-ref: latest`) and emscripten `vars.EMSCRIPTEN_VERSION || '3.1.64'` (`release.yml` @ `8e205aa`,
  `emscripten-version` input). The org variable's value is not public and the run logs have expired, so the exact
  toolchain cannot be proven. **Inference, not proof:** the latest CLI release on 2025-01-09 was 0.24.6 (npm
  publish 2024-12-27; 0.24.7 followed on 2025-01-12), which also matches the package's locked
  `tree-sitter-cli` 0.24.6 (`package-lock.json` at the commit, integrity
  `sha512-FJ9B1XwXt8Auq75NK/6bpeci7avXSk73OMDq4elXHPS4ue11ZFeCrH/anVN/u5BAZjWqFO9nWGLNEdpdZOg+eA==`), and CLI
  0.24.6 pins emscripten 3.1.64 (`cli/loader/emscripten-version` at `v0.24.6`).
- The WASM carries no `producers` custom section (only `dylink.0`), so the binary does not name its compiler.
- This machine had no emscripten and no running container engine; the architect did not start one.

### 3.2 The verification that replaces reproduction (gating)

All four must pass; they are re-run by the gate reviewer and by the 30k executor:

1. **Signed build provenance.** The GitHub release carries a Sigstore-signed SLSA v1 provenance attestation whose
   subjects are exactly `tree-sitter-kotlin.wasm` = `7009d694…73f7` and `tree-sitter-kotlin.tar.xz` = `60f60c06…3671`,
   with `resolvedDependencies` = `git+https://github.com/tree-sitter-grammars/tree-sitter-kotlin@refs/tags/v1.1.0`,
   `gitCommit 77dd60ea…8c82`, builder `tree-sitter/workflows/.github/workflows/release.yml@refs/heads/main`
   (signer digest `8e205aa…1a29`), Rekor log index 161206903 (integrated 2025-01-09T19:00:13Z). Verified by the
   architect with GitHub CLI 2.96.0, exit 0 for both the release asset and the npm copy:

   ```sh
   gh attestation verify tree-sitter-kotlin.wasm \
     --repo tree-sitter-grammars/tree-sitter-kotlin \
     --signer-workflow tree-sitter/workflows/.github/workflows/release.yml \
     --source-ref refs/tags/v1.1.0 \
     --source-digest 77dd60ea0a9003ce062c9728a513ffe1aaff8c82
   ```

   (Without `--signer-workflow` verification fails, because the signer is the reusable workflow, not the repo's
   own; that is expected.)

2. **Two-channel equality.** npm tarball (integrity checked first) and GitHub release asset yield the same
   SHA-256.
3. **Source identity.** The attested `tar.xz` contains the exact generated `parser.c` (ABI 14) and `scanner.c`
   that the attested workflow compiled; tag `v1.1.0` resolves to the attested commit.
4. **Load and corpus** (§4).

What this proves: the bytes were produced by upstream CI from the tagged commit by the named workflow, and published
unchanged to npm. What it does not prove: that an independent toolchain reproduces the same bytes. The attestation
relies on GitHub Actions and Sigstore as trust roots.

### 3.3 Best-effort rebuild (recorded, not gating)

The 30k executor runs this once, outside the repository, and records the result in `PROVENANCE.kotlin.json`
`rebuild`. A mismatch does **not** block (§3.2 is the gate); a rebuild that fails to load or parses the §4 corpus
differently **does** block and is reported.

```sh
# pinned inputs
#   source:     tree-sitter-kotlin.tar.xz  sha256 60f60c06a00f022b74251b98a89e42f5f575d34ae63c60c74667813714543671
#   CLI:        tree-sitter-cli@0.24.6     (npm integrity sha512-FJ9B1XwX…OZg+eA==)
#   emscripten: docker.io/emscripten/emsdk:3.1.64@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc (linux/amd64)
mkdir kotlin-src && tar -xJf tree-sitter-kotlin.tar.xz -C kotlin-src
cd kotlin-src
# CLI 0.24.6 prefers a local emcc, else runs docker with emscripten/emsdk:3.1.64 (cli/loader/src/lib.rs:46, :963-983)
npx --yes tree-sitter-cli@0.24.6 build --wasm -o tree-sitter-kotlin.wasm .
sha256sum tree-sitter-kotlin.wasm   # expected if reproducible: 7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7
```

CLI 0.24.6 invokes `emcc -o output.wasm -Os -s WASM=1 -s SIDE_MODULE=2 -s TOTAL_MEMORY=33554432
-s NODEJS_CATCH_EXIT=0 -s EXPORTED_FUNCTIONS=["_tree_sitter_kotlin"] -fno-exceptions -fvisibility=hidden -I .
scanner.c parser.c` (`cli/loader/src/lib.rs:1046-1071` at `v0.24.6`). Run it twice from clean directories and
record both hashes. Upstream CI used a native emsdk on `ubuntu-latest`, not the container, so a container build may
legitimately differ.

## 4. Load record

Architect probe, 2026-09-27: Node v24.15.0, `web-tree-sitter` 0.27.0 (`web-tree-sitter.cjs`), WASM bytes loaded
with `Language.load(buffer)`:

- ABI reported: **14**.
- `.kt` corpus (package header, two imports incl. an alias, a data class, an object, a class with a `when`
  expression, an extension function, a lambda property) → `rootNode.hasError === false`; top-level nodes
  `package_header, import, import, class_declaration, object_declaration, class_declaration, function_declaration,
property_declaration`.
- `.kts` script (`plugins { kotlin("jvm") version "2.0.0" }`, a `let` lambda, a call) → `hasError === false`; nodes
  `call_expression, property_declaration, call_expression`.

This is a direct runtime probe. The integration through `TreeSitterParserService` and the query table remains 30k
work (§6); it is not claimed here.

## 5. Batch 30k footprint (amended — new work, not inherited from 28a/28b)

### 5.1 Assets and manifest row (paths reconciled with the merged manifest)

The merged manifest already names the location (`scripts/tree-sitter-grammars.json:191-205`): the r0 `tools/…`
proposal is withdrawn, and `batches.md:3960`'s `LICENSE-tree-sitter-kotlin` name yields to the manifest's
`LICENSE.kotlin` (source wins; the team-leader aligns the batch file list).

| File              | Path                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Grammar           | `assets/tree-sitter/tree-sitter-kotlin.wasm` (new; `.gitattributes:20` already marks `*.wasm binary`) |
| Licence           | `assets/tree-sitter/LICENSE.kotlin` (new; byte-identical to upstream)                                 |
| Provenance record | `assets/tree-sitter/PROVENANCE.kotlin.json` (new; repository record, not shipped)                     |

Row after 30k (current schema, `copy-wasm.js:31-97`; new fields marked):

```json
{ "id": "kotlin", "kind": "grammar", "active": true, "filename": "tree-sitter-kotlin.wasm", "licence": "MIT", "bytes": 3441042, "source": { "kind": "vendored", "package": "@tree-sitter-grammars/tree-sitter-kotlin", "version": "1.1.0", "path": "assets/tree-sitter/tree-sitter-kotlin.wasm", "licenceFile": "assets/tree-sitter/LICENSE.kotlin", "sha256": "7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7", "licenceSha256": "0eea8dc45e89deeb03c7799bbbc7b4688f365fb274562f4540ecfebdea82e727", "provenanceFile": "assets/tree-sitter/PROVENANCE.kotlin.json" } }
```

`licenceSha256` and `provenanceFile` are **new, required for `vendored` rows that are not pending**.
`provenancePending` and `provenanceRecord` are removed in the same change that sets `active:true` (30k.2), and not
before: `copy-wasm.js:74-77` already refuses an active pending row.

`PROVENANCE.kotlin.json`:

```json
{ "language": "kotlin", "package": "@tree-sitter-grammars/tree-sitter-kotlin", "version": "1.1.0", "repository": "https://github.com/tree-sitter-grammars/tree-sitter-kotlin", "tag": "v1.1.0", "commit": "77dd60ea0a9003ce062c9728a513ffe1aaff8c82", "wasm": { "bytes": 3441042, "sha256": "7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7", "urls": ["https://github.com/tree-sitter-grammars/tree-sitter-kotlin/releases/download/v1.1.0/tree-sitter-kotlin.wasm", "https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-kotlin/-/tree-sitter-kotlin-1.1.0.tgz#package/tree-sitter-kotlin.wasm"] }, "tarballIntegrity": "sha512-vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==", "sourceArchive": { "file": "tree-sitter-kotlin.tar.xz", "sha256": "60f60c06a00f022b74251b98a89e42f5f575d34ae63c60c74667813714543671" }, "license": { "spdx": "MIT", "bytes": 1101, "sha256": "0eea8dc45e89deeb03c7799bbbc7b4688f365fb274562f4540ecfebdea82e727" }, "abi": 14, "attestation": { "predicate": "https://slsa.dev/provenance/v1", "run": "https://github.com/tree-sitter-grammars/tree-sitter-kotlin/actions/runs/12696697547/attempts/1", "signerWorkflow": "tree-sitter/workflows/.github/workflows/release.yml", "signerDigest": "8e205aa3badc0ff6c1ddd161811b946afce51a29", "rekorLogIndex": 161206903, "verifiedWith": "gh 2.96.0 attestation verify (exit 0)", "verifiedOn": "2026-09-27" }, "reproduced": false, "rebuild": { "cli": "tree-sitter-cli@0.24.6", "emscripten": "emscripten/emsdk:3.1.64@sha256:8847dad4…", "sha256s": ["<30k executor>"], "equalToShipped": "<true|false>" }, "loadRecord": { "runtime": "web-tree-sitter 0.27.0", "node": "v24.15.0", "date": "2026-09-27", "abi": 14, "corpusHasError": false } }
```

Only `rebuild.sha256s` / `rebuild.equalToShipped` are filled by 30k (non-gating, §3.3).

### 5.2 `scripts/copy-wasm.js` (+ its `--self-test`)

Today it checks the vendored licence exists (`:138`), checks the WASM sha256 against the manifest only
(`:139-144`), and copies WASM files only (`:151-169`). Add:

- **Validation** (`validateManifest`): non-pending vendored rows require `licenceSha256` (64 hex) and a contained
  `provenanceFile`.
- **Resolution** (`resolveWasmFile`, vendored branch): read the licence (≤ 64 KiB), require non-empty, SHA-256 equal
  to `licenceSha256`; read `provenanceFile` (≤ 64 KiB, JSON, never evaluated) and require `wasm.sha256`,
  `wasm.bytes`, `license.sha256`, `version` and `package` to equal the row. All before any output is written (the
  existing "verify everything first" rule, `:153-156`).
- **Copy:** for each active vendored row, copy the licence to `wasm/LICENSE.<id>` (`wasm/LICENSE.kotlin`) and
  re-hash the copy. The provenance file is not shipped.
- **Listing:** keep `--list` WASM-only (the VSIX verifier's regex and `.github/workflows/publish-cli.yml:373` depend
  on it); add `--list-licences` printing `wasm/LICENSE.<id>` for active vendored rows.
- **Self-test negatives:** missing licence; empty licence; licence changed by one byte; `licenceSha256` missing;
  provenance file missing; provenance `wasm.sha256` ≠ row; provenance `license.sha256` ≠ row; WASM changed (existing);
  and in each case no output directory is written. Positive: the licence copy lands at `wasm/LICENSE.<fixture id>`
  with the same bytes.

### 5.3 Packed verifiers (+ their self-tests)

Today all three require WASM only: Electron `apps/ptah-electron/scripts/verify-packed-wasm.js:63-65`, CLI
`apps/ptah-cli/scripts/verify-packed-wasm.cjs:48-50`, VSIX `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs:14-30`
(whose listing regex rejects non-WASM paths, `:24`).

- **Electron** and **CLI**: derive the required licence entries from the manifest they already parse (active rows
  with `source.kind === 'vendored'` → `wasm/LICENSE.<id>`), require each in the asar / tarball, non-empty, and
  SHA-256 equal to `source.licenceSha256` (Electron via `asar.extractFile`, as for WASM at `:101`; CLI by
  extracting the entry). Self-tests (`verify-packed-wasm.js:159-188`, `verify-packed-wasm.cjs:131-161`) gain a
  missing-licence and a changed-licence negative.
- **VSIX**: call `copy-wasm.js --list-licences` next to `--list`, validate it with its own regex
  (`^wasm/LICENSE\.[a-z0-9-]+$`), and require `extension/wasm/LICENSE.<id>` with the manifest hash (`AdmZip` entry
  data). Self-test (`:69`) gains the same two negatives.

### 5.4 Complete 30k file list

30k.1: `assets/tree-sitter/tree-sitter-kotlin.wasm`, `assets/tree-sitter/LICENSE.kotlin`,
`assets/tree-sitter/PROVENANCE.kotlin.json` (all new), `scripts/tree-sitter-grammars.json`, `scripts/copy-wasm.js`,
`apps/ptah-electron/scripts/verify-packed-wasm.js`, `apps/ptah-cli/scripts/verify-packed-wasm.cjs`,
`apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs`. 30k.2: unchanged (`batches.md:3970`). Verification
adds `node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test`,
`node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` and the VSIX self-test to `batches.md:3979`.

## 6. Verification Batch 30k runs (in addition to the plan's 30k acceptance)

1. **Hash gate.** `copy-wasm.js` recomputes WASM and licence SHA-256 against the manifest and `PROVENANCE.kotlin.json`;
   any difference fails before output (§5.2 negatives pass).
2. **Load gate.** `WI/ast/kotlin-grammar.integration.spec.ts` (`WI` = `libs/backend/workspace-intelligence/src`)
   loads the checked-in file through the real `TreeSitterParserService`, following the `wasm-bundle-dir` mock in
   `WI/ast/csharp-grammar.integration.spec.ts:28, :46`; asserts ABI 14 = `PROVENANCE.kotlin.json.abi`.
3. **Corpus gate.** The §4 `.kt` and `.kts` inputs parse with `hasError === false`; the functions, types, imports and
   public-symbol queries (plan query table) return the expected names.
4. **Licence gate.** Packed verifiers find `wasm/LICENSE.kotlin` in the asar, the CLI tarball and the VSIX with the
   manifest hash.
5. **Size record.** Raw 3,441,042 B, gzip 295,536 B; per-host artifact delta recorded (plan estimate +3.4 MB).
6. **Reviewer re-check.** The reviewer recomputes SHA-256 of the committed WASM and licence, re-runs the §3.2 `gh
attestation verify` command against the committed WASM, and compares the tarball integrity with the registry.

## 7. Why this source

`@vscode/tree-sitter-wasm` 0.3.1 has no Kotlin grammar. Decision 19 chose the MIT `tree-sitter-grammars` Kotlin
grammar, vendored with no npm dependency: the npm package runs `node-gyp-build` at install (`"install"` script) and
carries dependencies the product does not need (`implementation-plan-languages.md:494-507`).

The `@vscode/tree-sitter-wasm` and `web-tree-sitter` licence files are not shipped next to their WASM today; that
pre-existing gap is recorded here, not fixed (§5 applies only to vendored rows).

## Revision (review r1)

| #   | Finding                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                | Section                  |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Gate record and artefact missing; `TO FILL` fields         | Every field measured and filled pre-batch: tag `v1.1.0` → commit, bytes, SHA-256/512 of WASM, licence, npm tarball and source archive, licence text verbatim, load and corpus record; artefact identified by hash and two retrieval URLs; row kept inactive/pending until 30k code lands                                                                                                                              | header, §1, §2, §4, §5.1 |
| 2   | Source build does not establish reproducibility            | Reproduction stated as not established, with reasons; replaced by a gating verification (Sigstore SLSA attestation verified with pinned signer/source, two-channel equality, attested generated sources, load/corpus); a pinned best-effort rebuild (CLI 0.24.6, emsdk 3.1.64 by digest, exact commands and flags, expected hash, two clean builds) recorded as non-gating; corpus kept as a compatibility check only | §3, §5.1 `rebuild`       |
| 3   | Licence/provenance packaging needs unassigned code changes | Footprint amended: copy-wasm validation/copy/listing/self-test, three verifiers and self-tests, destinations `wasm/LICENSE.<id>`, provenance lookup, negatives; manifest row in the current schema with new `licenceSha256`/`provenanceFile`; paths reconciled to the merged `assets/tree-sitter/…`; `provenancePending` removed only with activation                                                                 | §5                       |

## Open questions for the user

None required to start 30k. Note for visibility: provenance rests on the upstream CI attestation, not an
independent byte-for-byte rebuild (§3.1–§3.3). If the user wants a reproduced binary to be mandatory, 30k must first
run §3.3 successfully (or ship its own rebuilt WASM with a new hash); say so before 30k starts.
