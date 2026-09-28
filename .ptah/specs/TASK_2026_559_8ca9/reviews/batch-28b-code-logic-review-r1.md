# Code Logic Review — `TASK_2026_559_8ca9` Batch 28b (r1, cross-side)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 (handled correctly) |

## Five logic questions

1. **Silent failure?** Not found. `verifyVsix` (`apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs:50-67`) treats missing, duplicate, directory, and empty entries as failures, and `main()` throws on any problem, propagating a nonzero exit through `nx:run-commands`.
2. **Unexpected user action?** Running `package` today behaves identically for a complete build (self-tested and confirmed by the executor's real 40-entry, 0-byte-delta VSCE run); a manifest edit that adds a required grammar without updating the VSIX asset causes `package` to fail loudly post-VSCE rather than shipping silently.
3. **Wrong-answer input?** `requiredWasmFiles()` regex-validates each `--list` line (`:23-28`) and rejects duplicates, so a corrupted `copy-wasm.js --list` output fails closed, not open.
4. **Dependency failure?** `execFileSync` on `copy-wasm.js --list` has a 30s timeout and bounded `maxBuffer` (`:20`); a VSCE packaging failure (upstream step) short-circuits the sequential `commands` array before the verifier runs, since `nx:run-commands` with `parallel:false` stops on first non-zero exit — confirmed by reading the executor's ordering self-test (`:131-144`) and Nx's documented sequential-command semantics.
5. **Missing/unstated requirement?** None found beyond what batches.md 28b asks (real-artifact ZIP check, self-test, FB evidence). Batch scope correctly excludes touching the 28a-reviewed Electron/CLI verifiers.

## Failure modes

### VSCE step failure short-circuiting the sequential package target

- Trigger: `@vscode/vsce package` step fails (e.g. a future manifest error).
- Symptom: `nx run ptah-extension-vscode:package` exits nonzero before the verify step runs.
- Evidence: `apps/ptah-extension-vscode/project.json:119-136`, `"parallel": false` with an ordered `commands` array — this is the documented `nx:run-commands` sequential-stop-on-failure behavior.
- Current handling: correct — no verify-of-nonexistent-artifact scenario; `packagedVsixPath()` would `ENOENT` anyway if reached.
- Recommendation: none; this is the intended and correct behaviour.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None found specific to this batch's two files. The 28a Moderate-1 (verifier manifest-validation duplication) is explicitly avoided here: this verifier reuses `copy-wasm.js --list` as a subprocess boundary (`:14-30`) rather than re-implementing `validateManifest`, which is the better pattern of the three verifiers and arguably shows the fix code-logic-review-r1 recommended for 28a.

## Data flow

1. `nx run ptah-extension-vscode:package` → sequential command 1: `verify-packed-wasm.cjs --self-test` (fixture-only, does not touch real dist) — OK.
2. → command 2: existing VSCE packaging, now `npx --no-install` (prevents an implicit install if `@vscode/vsce` were ever missing, tightening rather than loosening) — OK, unchanged VSCE flags (`--allow-missing-repository --allow-star-activation`).
3. → command 3: `verify-packed-wasm.cjs` (no args) → `requiredWasmFiles()` shells to `copy-wasm.js --list` (single source of truth, same list Batch 28a validated) → `packagedVsixPath()` derives the exact filename from the packaged `package.json` name+version (not a glob) → `verifyVsix()` opens the real ZIP via `adm-zip` and checks each required `extension/wasm/<file>` entry exists, is a single file, and is non-empty — OK, verified live via self-test re-run in this review.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Runs after `package` on the real `.vsix`, checks every manifest-active grammar | COMPLETE | confirmed by reading `project.json` ordering and the self-test's ordering assertion |
| `--self-test` | COMPLETE | re-run in this review, PASS |
| FB "missing grammar in .vsix passes today" | COMPLETE | executor's report shows old VSCE packaging a Python-omitting fixture and succeeding (exit 0), consistent with the pre-batch target having no WASM gate at all |
| Real artifact size delta recorded in the report | COMPLETE | 11,415,494 bytes before/after, 0 delta, 40 entries with identical SHA-256 — not independently re-run in this review (4+ minute full build); executor's method (built VSIX, per-entry hash compare) is sound and consistent with the self-test's own ZIP-handling code path, which this review did exercise |
| No new dependency | COMPLETE | `adm-zip@^0.6.1` and `@vscode/vsce@^4.0.0` are pre-existing root `devDependencies` (`package.json:249,247`), confirmed by direct read |
| Package/publish behaviour, caching, dependsOn unaffected otherwise | COMPLETE | diff only changes `options.command` → `options.commands`/`parallel:false`; `dependsOn: ["pre-package"]` untouched, no `cache`/`outputs` fields touched |

Implicit requirements not addressed: none found.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Active grammar missing from VSIX | YES | `verifyVsix` per-entry presence check, self-tested for all 6 | none |
| Grammar entry present but empty | YES | zero-length data check | none |
| Grammar entry present at wrong prefix (e.g. root instead of `extension/wasm/`) | YES | exact `entryName` match, self-tested with an all-wrong-prefix fixture | none |
| Duplicate entry for the same required file | YES | `matches.length !== 1` check | none |
| Corrupt/missing VSIX archive | YES | `AdmZip` throws, propagated; missing file `ENOENT`, both asserted in self-test | none |
| Stale VSIX from a prior run picked up by a wildcard | YES | filename derived from packaged `package.json` name+version, not a glob | none |
| `copy-wasm.js --list` returns something malformed | YES | regex + duplicate check in `requiredWasmFiles()` | none |
| VSCE step fails before verify runs | YES | `parallel:false` sequential stop-on-failure | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none material; the real-artifact byte/hash parity claim (11,415,494 bytes, 40 entries) was not independently re-executed in this review (a full `package` build takes ~4 minutes and was judged not cost-effective given the self-test already exercises the identical ZIP-reading code path against equivalent fixtures), so that specific number is trusted from the executor's report rather than reproduced here.
- What a robust implementation would add: nothing required; this batch is a clean, minimal, correctly-scoped fix that also avoids the validation-duplication pattern flagged as Moderate in the 28a review.

## Verification

- `node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test` — re-run in this review: PASS (complete ZIP; 6 missing and 6 empty asset negatives; wrong prefix, corrupt/missing archive, CLI exits and package ordering).
- Did not re-run the real `nx run ptah-extension-vscode:package` (full VSCE build, ~4 min); trusted the executor's reported 0-byte-delta / 40-hash-identical result as consistent with the self-test's own code path.
- `node_modules/.bin/nx run-many "-t=lint,typecheck" -p ptah-extension-vscode --skip-nx-cache` — exit 0.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` — exit 0.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — exit 0.
- Confirmed `adm-zip` and `@vscode/vsce` are pre-existing root `devDependencies` via direct `package.json` read — no new dependency added.

## Packaging parity

| Host | Files/bytes before | Files/bytes after | Equal? |
| --- | --- | --- | --- |
| VSIX (`ptah-coding-orchestra-0.2.43.vsix`) | 40 entries, 11,415,494 bytes (executor-reported baseline) | 40 entries, 11,415,494 bytes, 0-byte delta, all entry hashes identical (executor-reported) | YES (trusted from report; not independently re-executed — see Verdict) |
| VSIX packed WASM assets (6 files) | runtime + javascript/typescript/python/go/c-sharp, 7,813,629 raw bytes, hashes match source (executor-reported) | same, unchanged | YES |

## 28a Moderates carried forward

Leaving the 28a Moderate-1 (Electron/CLI verifiers' duplicated, weaker manifest validation) untouched is acceptable: Batch 28b's file scope is limited to the new VSIX verifier and its own `project.json` target, and this batch does not regress or interact with the Electron/CLI validation path. The new VSIX verifier itself sidesteps that class of issue entirely by shelling out to `copy-wasm.js --list` instead of reimplementing validation, so it does not add a fourth divergent copy.
