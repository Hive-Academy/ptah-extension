# Code Logic Review — `TASK_2026_559_8ca9` Batch 28a (r1, cross-side)

## Summary

| Metric              | Value    |
| -------------------- | -------- |
| Overall score        | 8/10     |
| Assessment            | APPROVED |
| Blocking issues       | 0        |
| Serious issues        | 0        |
| Moderate issues       | 2        |
| Failure modes found   | 2 (both handled correctly) |

## Five logic questions

### 1. How does this fail silently?

Not found in the manifest/copy/verify path itself. `copyWasm` resolves and validates every active asset (package identity, licence file presence, byte size) *before* copying any file (`scripts/copy-wasm.js:151-156`), and re-checks size after each copy (`:162-163`). The only near-silent path is the verifiers' independent, weaker manifest validation (`apps/ptah-electron/scripts/verify-packed-wasm.js:46-62`, `apps/ptah-cli/scripts/verify-packed-wasm.cjs:31-47`) — see Moderate-1.

### 2. What user action produces unexpected behaviour?

Editing `tree-sitter-grammars.json` to flip `active: true` on the Kotlin row without supplying `bytes`/`sha256` is rejected loudly at build time (`copy-wasm.js:74-77`, "Pending provenance cannot be active"), not silently shipped. Editing a `source.path` to something like `"../../secret"` is rejected by `containedFile` (`copy-wasm.js:12-29`).

### 3. What input data produces a wrong answer?

A manifest with a syntactically valid but semantically stale `active` set (e.g. an active row whose backing package was upgraded and no longer matches `version`) fails hard via the package provenance check (`copy-wasm.js:128-134`), not a wrong answer. Confirmed by self-test (`:210-216`).

### 4. What happens when a dependency fails?

If `require.resolve` cannot find the package asset (dependency missing/uninstalled), `copy-wasm.js` throws before any copy happens (uncaught `MODULE_NOT_FOUND`), matching prior behaviour of the pre-manifest script. `npm pack` / `tar` failures in the CLI verifier propagate via `execFileSync` (timeouts set: `apps/ptah-cli/scripts/verify-packed-wasm.cjs:60,80,108`).

### 5. What is missing that the requirements never mentioned?

The verifiers duplicate a hand-rolled, weaker subset of `validateManifest` instead of importing the shared validator (see Moderate-1). Not a batch-28a requirement violation (batches.md 3311/3321 only asks for "both verifiers read the manifest's active rows"), but it is a latent inconsistency the requirements didn't anticipate.

## Failure modes

### Manifest re-validation drift between copy-wasm.js and the two verifiers

- Trigger: verify-packed-wasm.js/.cjs are run standalone (e.g. CI step reordered, or a hand-edited manifest is fed straight to `--self-test`/`main()` without `copy-wasm.js` having run first) against a manifest that violates an invariant `validateManifest` enforces but the verifiers' inline check does not (e.g. an active vendored row with `provenancePending: true`, or `bytes <= 0`).
- Symptom: the verifier still computes a `REQUIRED_WASM` list and just reports "missing from asar/tarball" instead of "Invalid grammar manifest" — a less precise error, not a false pass (packaging still fails), but harder to diagnose.
- Evidence: `apps/ptah-electron/scripts/verify-packed-wasm.js:46-62` vs `scripts/copy-wasm.js:31-97`; same gap in `apps/ptah-cli/scripts/verify-packed-wasm.cjs:31-47`.
- Current handling: independent lightweight re-implementation, not the shared `validateManifest`.
- Recommendation: low priority — either export/require `validateManifest` from `copy-wasm.js` (both verifiers already read the manifest file directly, so a `require('../../../scripts/copy-wasm.js').validateManifest` would keep single-source-of-truth validation) or accept the duplication as intentional isolation (the executor's report states this is deliberate, "to respect project boundaries"). Since it never produces a false pass, this is Moderate, not Serious.

### CI dist-file check widening from a hard-coded list to `--list` output

- Trigger: none currently — the active set today is unchanged (5 grammars + runtime), and the self-test coverage plus the manual run in this review reproduce byte-identical output to `HEAD`'s copier for all 3 hosts.
- Symptom: n/a today; this is forward-looking. If a future batch flips a row active without re-running CI locally, the new `WASM_FILES` loop (`publish-cli.yml:373-379`) will correctly pick up the new required file automatically instead of needing a manual CI edit — this is an improvement over the pre-existing hard-coded list, not a regression.
- Evidence: `.github/workflows/publish-cli.yml:354-379` (diff reviewed line-by-line, see below).
- Current handling: correct — `-s` check (non-empty) replaces the prior mere `-f` existence check, tightening rather than loosening the gate.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. (Moderate) Manifest re-validation drift between the shared validator and the two ad hoc verifier checks — see Failure modes above. `apps/ptah-electron/scripts/verify-packed-wasm.js:46-62`; `apps/ptah-cli/scripts/verify-packed-wasm.cjs:31-47`.
2. (Minor) `copyWasm`'s copy loop (`scripts/copy-wasm.js:159-167`) does per-file `mkdirSync`+`copyFileSync`+size-check but does not roll back files already copied if a later file in the same batch fails its post-copy size check (extremely unlikely TOCTOU — file changing on disk between `resolveWasmFile`'s pre-check and the copy — not attacker-reachable in this build pipeline). Pre-existing class of risk, not introduced by this batch's design (all assets are resolved before any copy, so this only fires on a live filesystem race).

## Data flow

1. `tree-sitter-grammars.json` on disk → `readManifest()` bounds file size (128 KiB) and requires it to resolve within `ROOT` via `containedFile` semantics inline (`copy-wasm.js:99-104`) — OK.
2. → `validateManifest()` enforces schema, uniqueness, path containment, pending/active exclusivity, sha256 presence for vendored rows, exactly one active runtime — OK.
3. → `copyWasm()` filters `active` rows, resolves each via `resolveWasmFile()` (package identity+version+licence+byte-size check, or vendored sha256+byte-size check) before any write — OK, verified byte-identical to `HEAD`'s hard-coded copier for all 6 currently-active assets in a live run (hash comparison done in this review).
4. → Electron/CLI verifiers independently re-read and lightly re-validate the same manifest to compute `REQUIRED_WASM`, then inspect the real packed artifact (asar / npm tarball) — OK for today's active set; see Moderate-1 for the validation-strength gap.
5. → `publish-cli.yml` runs all three `--self-test` invocations, then re-derives the CI dist-file check from `copy-wasm.js --list` instead of a hard-coded list — OK, confirmed the replaced list is a superset-equivalent (adds emptiness check) of the prior 6-entry hard-coded list.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Manifest with runtime + grammar rows, active flags, 5 current grammars active, tsx/java/rust/php/ruby/cpp inactive | COMPLETE | none |
| `vendored` row kind with sha256 check failing the build on mismatch (D7) | COMPLETE | confirmed by self-test and live re-run of the sha256-mismatch case |
| `--self-test` negatives for manifest/copier | COMPLETE | broad coverage (duplicate, path escape, byte mismatch, pending-active, provenance mismatch) |
| Both verifiers read the manifest's active rows | COMPLETE | see Moderate-1 for validation-strength duplication, not a functional gap |
| `--self-test` negatives run in CI | COMPLETE | `publish-cli.yml:354-358` |
| Electron/CLI/VSIX packaging output for active rows unchanged | COMPLETE | verified independently via byte-for-byte SHA-256 comparison against `HEAD`'s copier in this review; all three hosts share the one `copy-wasm.js` entrypoint (`apps/ptah-extension-vscode/project.json:90`, `apps/ptah-electron/project.json:290`, `apps/ptah-cli/project.json:129`) |
| FB "Electron asar without python passes today" reproduced pre-fix, fixed post-fix | COMPLETE | executor report's baseline evidence is consistent with the current verifier's per-active-row missing-file check |

Implicit requirements not addressed: none found within Batch 28a's declared scope. A VSIX packed-artifact verifier is explicitly out of scope (Batch 28b) and correctly not introduced here.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Kotlin row active with pending provenance | YES | `validateManifest` throws "Pending provenance cannot be active" | none |
| Vendored asset tampered (hash mismatch) | YES | sha256 check in `resolveWasmFile`, verified live in self-test | none |
| Duplicate filename/id in manifest | YES | `validateManifest` Set-based dedup check | none |
| Manifest path escaping repo root | YES | `containedFile` realpath-based containment check | none |
| Manifest > 128 KiB | YES | explicit size guard before `JSON.parse` | none |
| Active row missing from packed asar/tarball | YES | per-row presence + non-zero-size check in both verifiers, self-tested for all 6 current active rows | none |
| Future grammar activated without updating CI's hard-coded WASM list | YES | `publish-cli.yml` now derives the list from `copy-wasm.js --list` | none |
| Verifier run against a manifest that fails only the *shared* validator's stricter rules | PARTIAL | verifier's own inline check catches structural issues, not all `validateManifest` invariants | see Moderate-1 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the duplicated, weaker manifest validation embedded in the two verifiers (Moderate-1) could someday produce a less-diagnostic failure message on a malformed manifest reaching the verify step directly — it does not produce a false pass, so it does not block ship.
- What a robust implementation would add: export `validateManifest` from `copy-wasm.js` and `require` it from both verifiers so there is exactly one manifest-validation implementation instead of three.

## Verification

- `node scripts/copy-wasm.js --self-test` — re-run in this review: PASS (active-only copying, metadata, size, duplicate/path/provenance negatives, vendored SHA-256 failure before writes).
- `node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test` — re-run: PASS (complete archive; 6 missing and 6 empty asset negatives).
- `node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` — re-run: PASS (complete tarball; 6 missing and 6 empty asset negatives).
- Independent packaging-parity probe (not in the executor report): ran the new `copy-wasm.js` into a temp dir and, separately, `HEAD`'s copier logic (via a temp-dir probe pointed at this worktree's `scripts/` so `require.resolve` walk-up matched) into another temp dir; `sha256sum` of all 6 output files identical byte-for-byte between old and new.
- `node_modules/.bin/nx run-many "-t=lint,typecheck" -p ptah-electron ptah-cli --skip-nx-cache` — exit 0, 4/4 tasks succeeded.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` — exit 0.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — exit 0 (did not independently re-derive the TOTAL 300 figure from this run's log format, but the target succeeded with no new suppressions expected from these packaging-script-only changes).

## Packaging parity

| Host | Files before (HEAD) | Files after (this diff) | Equal? |
| --- | --- | --- | --- |
| VSIX (`apps/ptah-extension-vscode`, via shared `copy-wasm.js`) | web-tree-sitter.wasm, tree-sitter-{javascript,typescript,python,go,c-sharp}.wasm | same 6 filenames | YES (same entrypoint as Electron/CLI, verified via CLI/Electron probe below; VSIX uses the identical `node scripts/copy-wasm.js <dir>` call per `project.json:90`) |
| Electron (`dist/apps/ptah-electron`) | same 6 files, total 7,813,629 bytes | same 6 files, same bytes, SHA-256 identical | YES (verified live in this review) |
| CLI (`dist/apps/ptah-cli`) | same 6 files | same 6 files, SHA-256 identical | YES (same copier invocation as Electron) |
