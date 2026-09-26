# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 22, Lane H, post-cap review r4. The bounded correction fixes R3-S1 and preserves the earlier recognition, grammar-association and executable-filename fixes. No new supported defect was found within the requested scope.

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Evidence supporting the sound 8/10 band: the actual-module probe accounts for all 45 files, artifacts increase nonSource without changing analyzed or cleanliness, unknown/source-like files remain qualified, the grammar-association regression is executable, and all six scoped checks pass. This is not a 9–10 claim: classification remains an explicit filename policy, the future production census/merging paths are not delivered here, and mocked grammar tests do not establish WASM availability on every host.

Scope: current registry and its complete spec read in full; current complete PC contract reread; prior full-file review of the remaining Batch 22 config/spec/barrels retained from r1–r3, with current WI exports and consumer references checked. Read the executor's bounded-correction section. Only registry and registry spec are reported changed since r3. No source edits, git operations or task-state changes. Changed-file scope relies on the executor's inventory because git operations are prohibited. No task-description.md/code-style-review.md or applicable AGENTS.md was found in earlier discovery; supplied project guidance and accepted orchestrator amendments apply.

Relative paths: **PC** = `libs/backend/platform-core/src`; **WI** = `libs/backend/workspace-intelligence/src`.

## r3 findings status

| Finding | Status | Evidence and impact |
| --- | --- | --- |
| R3-S1: artifacts/checksum data cause permanent false qualification | FIXED | WI/ast/language-registry.ts:393 adds PDF; :395 archives/packages; :407 compiled artifacts; :419 source maps; :450 Go checksum names. Classifier returns nonSource at :539. Adding PDF/ZIP/DLL leaves the actual modeled source census clean, increases nonSource by three and does not change analyzed. main.go + go.sum is also clean. Regressions at WI/ast/language-registry.spec.ts:617 and :627 pass. |
| r2 R2-S1: MDX/CMakeLists.txt incorrectly nonSource | REMAINS FIXED | MDX is absent from the non-source list; cmakelists.txt is a code basename at WI registry:474, checked before nonSource at :532. Both independently return unrecognised and clean=false; regression at WI registry.spec:574 remains. |
| r1 S1: module/stub extensions disappear | REMAINS FIXED | Recognition-only suffixes at WI registry:185 and per-extension support at :319 return unsupported for .mjs/.cjs/.mts/.cts/.pyi/.pyw; they do not gain analysis capability. WI registry.spec:345 and :363 preserve the guard. |
| r1 M1: grammar guard ignores language association | REMAINS FIXED | WI registry.spec:694 observes the actual parser's setLanguage association with mocked grammar objects; :716 compares the keyed map and :726 detects a TS/JS swap. Scoped tests pass. |

## Classification table

Actual results of rerunning the same 45-row probe with `classifyFileForCoverage(path, 'codeIndex')`. General evidence: `WI/ast/language-registry.ts:519`; non-source extensions :348, non-source filenames :426, code filenames :459. Every file returns one class; the probe's bucket total is **45 for 45 inputs**. eligible is permission to analyze, not proof of successful analysis.

| File | r4 class |
| --- | --- |
| page.mdx | unrecognised |
| icon.svg | unrecognised |
| app.js.map | nonSource |
| guide.pdf | nonSource |
| backup.zip | nonSource |
| lib.jar | nonSource |
| App.class | nonSource |
| module.pyc | nonSource |
| lib.so | nonSource |
| lib.dll | nonSource |
| app.exe | nonSource |
| parser.wasm | nonSource |
| logo.png | nonSource |
| README.md | nonSource |
| LICENSE | nonSource |
| package.json | nonSource |
| go.sum | nonSource |
| Cargo.lock | nonSource |
| CMakeLists.txt | unrecognised |
| Makefile | unrecognised |
| Dockerfile | unrecognised |
| build.gradle | unrecognised |
| pom.xml | nonSource |
| App.csproj | unrecognised |
| App.sln | unrecognised |
| api.proto | unrecognised |
| api.graphql | unrecognised |
| schema.sql | unrecognised |
| deploy.sh | unrecognised |
| deploy.ps1 | unrecognised |
| index.html | unrecognised |
| site.css | unrecognised |
| App.vue | unrecognised |
| App.svelte | unrecognised |
| main.zig | unrecognised |
| scripts/deploy | unrecognised |
| main.ts | eligible |
| main.py | eligible |
| main.go | eligible |
| main.cs | eligible |
| main.java | unsupported |
| main.rs | unsupported |
| app.mjs | unsupported |
| .bashrc | unrecognised |
| .gitignore | nonSource |

SVG remains conservatively unrecognised by the explicitly retained policy (`WI/ast/language-registry.ts:342`), so even a script-free SVG can qualify an answer. This is disclosed policy, not a newly counted defect. Config/data formats, including pom.xml, retain their accepted exemption (:334); clean does not mean JSON/XML/config semantic validation. The path-only classifier does not read a shebang: scripts/deploy remains unrecognised whether or not its content has one (:523).

### Remaining lockfiles

Each requested filename was independently probed, not inferred only from the pinned list.

| File | r4 class | Rule |
| --- | --- | --- |
| package-lock.json | nonSource | .json, WI registry:356 |
| yarn.lock | nonSource | .lock, :370 |
| pnpm-lock.yaml | nonSource | .yaml, :359 |
| Cargo.lock | nonSource | .lock, :370 |
| poetry.lock | nonSource | .lock, :370 |
| Gemfile.lock | nonSource | .lock, :370 |
| composer.lock | nonSource | .lock, :370 |
| go.work.sum | nonSource | exact basename, :451 |

Lockfile regressions are also committed at `WI/ast/language-registry.spec.ts:657`.

## Five logic questions

### 1. How does this fail silently?

No silent drop was reproduced for the reviewed inputs. The total classifier returns eligible, unsupported, unrecognised or nonSource (`WI/ast/language-registry.ts:519`), and the modeled census conserves all 45 files. Unrecognised null/nonzero and unsupported nonzero reject cleanliness (`PC/interfaces/language-coverage.interface.ts:213`). Residual integration risk: future producers can still violate the contract by narrowing discovery or counting eligibility as success; no production enumerator is implemented by this batch.

### 2. What user action produces unexpected behaviour?

The prior artifact-addition trigger no longer does: main.ts + LICENSE + package.json + logo.png remains clean after adding guide.pdf, backup.zip and lib.dll; analyzed stays 1 while nonSource rises 3→6. Adding MDX/CMake/unknown source still correctly qualifies a census (`WI/ast/language-registry.spec.ts:670`). No new unexpected behaviour was substantiated under the accepted filename policy.

### 3. What input data produces a wrong answer?

No new wrong answer was demonstrated in the 45-file table, the lockfile checks or module/stub/unknown probes. Unknown a.xyz returns unrecognised; build.xml returns unrecognised; .cjs/.mts/.cts/.pyi/.pyw return unsupported. Evidence: WI registry:185, :483, :528, :541. The policy deliberately exempts artifacts and configuration and does not inspect disguised code under a data filename; that is not a guarantee of arbitrary content recognition.

### 4. What happens when a dependency fails?

No dependency calls or async resources were added by this correction. Static parse capability is still grammar metadata (`WI/ast/language-registry.ts:218`, :244), not host-load success. The parser reports initialization failure through Result.err (`WI/ast/tree-sitter-parser.service.ts:141`). Later producers must put actual failures in failed or retain unknown counts; `PC/interfaces/language-coverage.interface.ts:71` provides the failure vocabulary and :212 prevents recorded failures reading as clean. The grammar test verifies wiring using mocks, not real asset health.

### 5. What is missing that the requirements never mentioned?

No additional requirement is needed to accept this bounded correction. The material remaining work is already assigned to later batches: exhaustive discovery/accounting, state transitions, failure propagation, capped/atomic graph publication and response placement. The contract explicitly requires disjoint file counts and unknown=null (`PC/interfaces/language-coverage.interface.ts:11`), while the only census currently exercised here is a spec model (`WI/ast/language-registry.spec.ts:295`).

## New defects (R4)

None supported by the examined evidence. No R4 identifier is manufactured merely to populate this section. Scope and residual uncertainty are recorded above and in verification below.

## Failure modes

No new failure mode found. Reviewed the full updated registry/spec, clean predicate, extension and basename precedence, recognition-only separation, unknown fallback, artifact count conservation, keyed grammar guard, bounded approximation helper and serialization fixture. Remaining uncertainty concerns future consumer integration and formats outside the declared classification policy, not a reproduced Batch 22 defect.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None substantiated in this post-cap scope. The historical unidentified platform-core flake remains an evidence limitation; it is not assigned a fabricated cause or counted as a source defect.

## Data flow

1. **OK** — normalize basename across Windows/POSIX separators and casing (`WI/ast/language-registry.ts:498`); leading-dot names do not acquire an extension (:504).
2. **OK** — check per-extension capability then recognized language (:525, :528), preserving recognition-only variants as unsupported.
3. **OK** — code basenames precede generic non-source suffix matching (:532), preserving CMakeLists.txt/build.xml honesty.
4. **OK** — known artifact/config/prose/checksum files return nonSource and all remaining names return unrecognised (:535, :541). No null/discard class exists.
5. **OK as contract** — producers must split eligible into analyzed/failed/unchecked/omittedByCap and keep disjoint counts (`PC/interfaces/language-coverage.interface.ts:11`; WI registry:510). Actual enumeration and concurrency remain later-batch responsibilities.
6. **OK** — clean gate implements the accepted amended conditions (`PC interface:206`); positive/null unrecognised is never clean, nonSource does not qualify, excluded remains vendor/generated with the original 0/null rule.
7. **OK** — overflow deduplicates and keeps four deterministic highest-priority approximations (`PC interface:259`); saturated fixture remains 965 chars (`WI registry.spec:120`).
8. **OK** — PC has no new imports; WI uses the public PC alias (`WI registry:30`). Exports remain available through `PC/index.ts:77` and `WI/index.ts:105`. Production reference search still found no tool callers for the classifier/clean helper beyond definitions and barrels; no tool-output-reducers dependency or current tool behaviour change is introduced.

## Requirements fulfilment

| Requirement | Status | Evidence / limit |
| --- | --- | --- |
| R3 artifact/checksum fix, counted and non-qualifying | COMPLETE | WI registry:393, :450; probe clean/count transitions; spec:613. |
| Earlier recognition and grammar guards preserved | COMPLETE | WI registry:185, :319; spec:345, :694. |
| MDX/CMake/unknown source remain non-clean | COMPLETE | WI registry:532, :541; spec:574, :670. |
| All seven requested remaining lockfiles nonSource | COMPLETE | Independent table above; spec:659. |
| Disjoint buckets, null truth table, resolution, freshness | COMPLETE as foundation | PC interface:11, :121, :206. |
| Saturation constant and approximation overflow | COMPLETE | PC interface:109, :259. |
| ≤1,000-character measured fixture | COMPLETE | Independently measured 965; pinned at WI spec:153. Not a runtime bound on arbitrary invalid values. |
| Module boundaries/barrels; no new tool wiring | COMPLETE within reported scope | Public imports/exports and reference search, passing scoped lint/typecheck. |

Implicit requirements not addressed: none newly identified for Batch 22. Production census integration is explicitly deferred, not claimed complete by this review.

## Edge cases

| Case | Handled | Evidence / practical limit |
| --- | --- | --- |
| Empty/repeated/overflow approximations | YES | PC interface:259: local deduplication, sorting, four-item cap and omitted count. |
| Unknown/truncated census; null/positive qualifier counts | YES | PC interface:206; independent unrecognised:null probe returns false. |
| nonSource positive/null | YES under accepted rule | PC interface:157; correction preserves predicate semantics. |
| Partial resolution, import/edge caps, stale/updating state | YES | PC interface:223 and :232; prior negative tests retained. |
| Artifact-only and source-plus-artifact census | YES | Counts retained in nonSource; source analyzed count unchanged. |
| Unsupported module/stub variants | YES | Remain unsupported rather than analyzed or absent. |
| Unknown extensionless script or dotfile | YES | Conservative fallback; no shebang/content inspection. |
| SVG with or without embedded script | POLICY | Always unrecognised; known conservative behaviour. |
| Concurrent classifier calls | YES within helper | No asynchronous work or per-call shared mutation at WI registry:519. |

## Verification

Fresh independent runs, NX_ISOLATE_PLUGINS=false, --skip-nx-cache; each long command launched once and collected with one completion check. No source mutations or failure-only reruns.

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache --output-style=static`: PASS all six tasks, duration 1m26s.
- Platform-core: **44 suites passed; 851 tests passed, 4 todo**. Workspace-intelligence: **47 suites passed; 1,391 tests passed**. Includes the 134-test registry spec and retained contract tests.
- `nx run degradation-audit:lint`: PASS, **TOTAL 300**.
- `nx run ptah-electron:validate-deps`: PASS, including dependency task.
- Scoped `ptah_get_diagnostics` for registry: available, **0 errors / 0 warnings**.
- Actual-module OS-temp probe: all 45 rows, eight lock/checksum names, five additional recognition-only suffixes, unknown/build.xml classification, clean/non-clean transitions, 45-file count conservation, and **965-character** serialized fixture. Lists contain 24 code basenames and 61 non-source extensions.
- Nx still reports platform-core:test as historically flaky. No test failed in either independent r3 or r4 run; the author's earlier unnamed failure remains unattributed. It cannot be classified confidently as pre-existing or introduced by Batch 22 without that original failure detail. Current complete log: `C:/Users/abdal/AppData/Local/Temp/task559-b22-r4-nx.log`.
- Author reports 23 fails-before cases on the pre-correction registry. Those destructive reverts were not repeated by this read-only review. Actual runtime WASM/package health across all products and future production census behavior are not proven by these mocked/foundation tests.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the reviewed foundation and bounded correction.
- Top risk: a later producer could bypass full-file classification or mistake eligible for analyzed, defeating otherwise correct coverage semantics.
- What a robust implementation would add: the already-planned end-to-end enumeration, failure, cap and freshness tests when tool consumers land; retain these classification and keyed grammar guards. No further Batch 22 correction is required by the reviewed evidence.
