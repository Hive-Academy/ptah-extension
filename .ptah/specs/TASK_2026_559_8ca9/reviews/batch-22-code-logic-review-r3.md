# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 22, Lane H, review r3 after revision round 2. R2-S1 is fixed. One Serious classification defect remains: ordinary binary/archive/document artifacts, and the Go checksum file, count as unrecognised source and prevent otherwise complete source analysis from reading as clean.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 1 |

The contract predicate, source recognition fixes and grammar guard work, and all requested scoped checks pass. That evidence separates this from the 3–4 band. The reproduced false qualification on normal repository contents prevents a sound 7–8 score.

Scope: current registry, full registry spec and WI barrel read in full; prior full review of the other four Batch 22 files retained, with the unchanged contract predicate rechecked. Read the executor's Revision round 2 section and retained the approved plan/context and earlier review evidence. The r3 request explicitly requires binaries/archives not to make every answer not clean or disappear. No source edits, git operations, or changes to task status. Instruction discovery from r1 found no AGENTS.md; supplied guidance applies. Changed-file inventory is the author's stated seven-file scope, not an independently obtained git diff.

Relative paths use **PC** = `libs/backend/platform-core/src` and **WI** = `libs/backend/workspace-intelligence/src`.

## r2 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| R2-S1: MDX and CMakeLists.txt wrongly nonSource | FIXED | .mdx is absent from NON_SOURCE_EXTENSIONS (`WI/ast/language-registry.ts:344`); cmakelists.txt is a code filename (:439), checked before non-source extensions (:497). Actual probe gives unrecognised=1 and clean=false for either single-file census. Regressions at `WI/ast/language-registry.spec.ts:559` and :574 passed. |
| Earlier r1 S1: module/stub extensions disappear | REMAINS FIXED | Recognition-only extensions at WI registry:185 and extension-level capability check :319 remain; app.mjs probes unsupported, not eligible/nonSource. |
| Earlier r1 M1: grammar association guard only checks file sets | REMAINS FIXED | Actual parser registration is observed per language at WI registry.spec:608; keyed equality and swap regression at :630 and :640 passed. |

## Five logic questions

### 1. How does this fail silently?

No new silent success case was demonstrated for the requested source-like names: MDX, CMakeLists.txt, shells and unknown formats now qualify the answer. Instead, ordinary artifacts produce a false qualifier: the fallback at `WI/ast/language-registry.ts:506` increments unrecognised, which the unchanged clean predicate rejects at `PC/interfaces/language-coverage.interface.ts:214`. They are counted, not silently dropped. R3-S1 concerns that misclassification.

### 2. What user action produces unexpected behaviour?

Adding a PDF manual, ZIP backup or DLL to a complete TypeScript source census changes clean=true to clean=false without changing or skipping any source file. Likewise main.go + go.sum is not clean, although the modeled source file was analyzed. Both transitions were reproduced through the actual classifier and predicate. Evidence: WI registry:337, :344, :394, :506; PC interface:214.

### 3. What input data produces a wrong answer?

The binary/archive/document inputs and go.sum in the table below produce a false incomplete-source signal. Actual source-like suffixes remain conservative. JSON/XML configuration stays exempt by the accepted policy (`WI/ast/language-registry.ts:332`, :352, :362); this includes pom.xml. That policy never establishes schema/configuration semantic validation. No new claim about embedded expressions being checked is justified.

### 4. What happens when a dependency fails?

The classifier and coverage helpers are synchronous, with no new I/O, timers or disposal paths. Grammar availability is static metadata (`WI/ast/language-registry.ts:218`, :244), not a per-call success signal. The parser's existing Result.err initialization path remains at `WI/ast/tree-sitter-parser.service.ts:141`; later producers must count grammar/read/parse failures using `PC/interfaces/language-coverage.interface.ts:71`, rather than increment analyzed from eligibility alone. The clean predicate rejects failed/null qualifiers (:212). The new grammar test proves association with mocks, not actual WASM contents.

### 5. What is missing that the requirements never mentioned?

The implementation now equates “can contain executable bytes or embedded source” with “must qualify source-code coverage” (`WI/ast/language-registry.ts:328`). These are different scopes. Source census needs explicit, counted treatment for ordinary artifacts, without silently expanding into archive extraction, binary disassembly or PDF-script analysis. Exact filename recognition is also needed for checksum/lock data such as go.sum; a .lock suffix alone (:366) is insufficient. The current request settles the desired outcome, so no clarification is needed.

## Classification table

Independent probe used `classifyFileForCoverage(path, 'codeIndex')`. Each row below records the actual result. **eligible** only means the producer may analyze the file; it is not evidence of successful analysis. General classifier evidence: `WI/ast/language-registry.ts:484`; lists at :344, :394 and :424.

| File / representative suffix | Actual class | Assessment |
| --- | --- | --- |
| page.mdx | unrecognised | R2 fix; code remains qualified. |
| icon.svg | unrecognised | Conservative for script-bearing SVG; no content inspection. |
| app.js.map | unrecognised | Conservative for embedded sources; no content inspection. |
| guide.pdf | unrecognised | Ordinary document now qualifies source coverage; R3-S1. |
| backup.zip | unrecognised | Archive now qualifies; R3-S1. |
| lib.jar | unrecognised | Binary/archive now qualifies; R3-S1. |
| App.class | unrecognised | Compiled artifact now qualifies; R3-S1. |
| module.pyc | unrecognised | Compiled artifact now qualifies; R3-S1. |
| lib.so | unrecognised | Compiled artifact now qualifies; R3-S1. |
| lib.dll | unrecognised | Compiled artifact now qualifies; R3-S1. |
| app.exe | unrecognised | Compiled artifact now qualifies; R3-S1. |
| parser.wasm | unrecognised | Compiled artifact now qualifies; R3-S1. |
| logo.png | nonSource | Counted, non-qualifying raster asset. |
| README.md | nonSource | Counted documentation. |
| LICENSE | nonSource | Exact-name prose exemption. |
| package.json | nonSource | Accepted data/config exemption. |
| go.sum | unrecognised | Checksum data falsely qualifies; R3-S1. |
| Cargo.lock | nonSource | .lock exemption. |
| CMakeLists.txt | unrecognised | R2 fix; code-name precedence. |
| Makefile | unrecognised | Code-name rule. |
| Dockerfile | unrecognised | Code-name rule. |
| build.gradle | unrecognised | Unknown source-like extension. |
| pom.xml | nonSource | Accepted dependency/config policy. |
| App.csproj | unrecognised | Conservative; not claimed supported. |
| App.sln | unrecognised | Conservative; no recognized data exception. |
| api.proto | unrecognised | Unsupported source-like format remains visible. |
| api.graphql | unrecognised | Unsupported source-like format remains visible. |
| schema.sql | unrecognised | Unsupported source-like format remains visible. |
| deploy.sh | unrecognised | Shell code remains visible. |
| deploy.ps1 | unrecognised | PowerShell code remains visible. |
| index.html | unrecognised | Markup/code remains visible. |
| site.css | unrecognised | Styles remain visible. |
| App.vue | unrecognised | Component source remains visible. |
| App.svelte | unrecognised | Component source remains visible. |
| main.zig | unrecognised | Unknown language remains visible. |
| scripts/deploy | unrecognised | Unknown extensionless script; same result with a shebang, since content is never read. |
| main.ts | eligible | Supported codeIndex extension. |
| main.py | eligible | Supported codeIndex extension. |
| main.go | eligible | Supported codeIndex extension. |
| main.cs | eligible | Supported codeIndex extension. |
| main.java | unsupported | Recognized without current capability. |
| main.rs | unsupported | Recognized without current capability. |
| app.mjs | unsupported | Recognition-only JS suffix. |
| .bashrc | unrecognised | Leading dot has no extension; unknown basename remains visible. |
| .gitignore | nonSource | Exact-name data exemption. |

The probe also confirmed 24 code basenames, 37 non-source extensions, unrecognised:null → clean=false, and the fixture length of 965. A shebang is not parsed; an unknown extensionless pathname is conservatively unrecognised irrespective of its contents (`WI/ast/language-registry.ts:463`, :469, :506).

## Failure modes / new defects

### R3-S1 — Serious: ordinary artifacts and checksum data become persistent source-coverage qualifiers

- File: `WI/ast/language-registry.ts:337`, :344, :394, :506; downstream gate `PC/interfaces/language-coverage.interface.ts:214`.
- Trigger: an otherwise complete source census includes an ordinary PDF, binary or archive in scope, or a Go checksum file. Such files need not be under a vendor/generated directory, and this filename classifier has no artifact branch.
- Symptom: these files all increment unrecognised. Every census that includes them is non-clean, even if all actual source files were analyzed. A caller cannot distinguish unsupported source from ordinary retained build/package/document artifacts.
- Evidence: the actual-module probe produced `{analyzed:1, nonSource:3, unrecognised:0, clean:true}` for main.ts + LICENSE + package.json + logo.png. Adding guide.pdf + backup.zip + lib.dll produced `{analyzed:1, nonSource:3, unrecognised:3, clean:false}`. main.go + go.sum produced `{analyzed:1, nonSource:0, unrecognised:1, clean:false}`. The spec deliberately pins a jar to unrecognised (`WI/ast/language-registry.spec.ts:566`), so passing tests preserve rather than detect this failure.
- Current handling: none beyond treating them as unknown source. The author's expansion from the MDX/CMake fix removed compiled/archive/document suffixes wholesale. go.sum has neither a recognized language nor a non-source filename entry.
- Impact: violates the current review requirement that ordinary binaries/archives must neither make every answer not clean nor disappear. This is a likely repository path, not an exotic malformed filename. Serious because the resulting source-completeness status is persistently wrong on routine inputs; it is not a current production-tool regression, since the new classifier is not yet consumed there.
- Recommendation: use the existing nonSource count for documented ordinary binary/archive/document artifacts, or an explicit artifact classification that producers fold into that counted, non-qualifying bucket. Do not count them as analyzed, silently drop them, or put them in excluded merely to bypass classification (positive excluded also qualifies). Recognize go.sum as checksum data. Keep MDX, CMakeLists.txt, unknown source and unrecognised:null qualified. Keep any deliberate SVG/source-map conservatism separate from compiled/archive handling; no executable scanning, disassembly or archive extraction is needed for this source-census batch.
- Regression needed: an analyzed-source census plus representative binaries/archives and go.sum preserves clean=true while increasing nonSource and conserving total file counts; adding .mdx/CMakeLists.txt/.zig still makes it non-clean. Replace the jar expectation that currently encodes the incorrect artifact policy.

## Blocking issues

None supported by the reviewed evidence.

## Serious issues

R3-S1 above. Source is no longer silently lost for the r2 cases, but ordinary artifacts now generate false incompleteness (`WI/ast/language-registry.ts:506`).

## Moderate and minor issues

No separate counted findings. The unidentified prior platform-core failure is a verification uncertainty, not an invented code defect or a demonstrated regression from this correction.

## Data flow

1. **OK** — normalize basename and suffix across Windows/POSIX paths (`WI/ast/language-registry.ts:463`).
2. **OK** — per-extension capability yields eligible; recognized unsupported suffix yields unsupported (:490, :493).
3. **OK** — known executable basenames override generic document/data suffixes (:497); MDX reaches the unknown fallback.
4. **GAP R3-S1** — ordinary artifact/checksum formats are missing from counted non-qualifying treatment (:500, :506).
5. **OK as contract** — each in-scope file belongs to one disjoint bucket; eligible is split by the producer into analyzed/failed/unchecked/omitted (`PC/interfaces/language-coverage.interface.ts:11`; WI registry:475). Enumeration itself is deferred; narrow discovery must not fabricate unrecognised=0.
6. **OK** — amended clean gate rejects null/nonzero unrecognised, other qualifier counts, unknown/truncated census, stale state and incomplete resolution (`PC interface:206`). nonSource intentionally does not qualify.
7. **OK** — priority overflow and saturation declaration remain unchanged (`PC interface:109`, :259); the size fixture includes both new buckets (`WI registry.spec:120`).
8. **OK** — new basename list is exported through WI's barrel (`WI/index.ts:106`); no new import reaches back from PC or into tool-output-reducers. Production reference search found definitions/barrel exports only for the new classifier, so no existing tool behaviour is changed by its wiring.

## Requirements fulfilment

| Requirement | Status | Evidence / limitation |
| --- | --- | --- |
| R2 MDX/CMake fix | COMPLETE | WI registry:439, :497, :506; passing regression/probe. |
| Prior module/stub recognition and grammar guard | COMPLETE | WI registry:185, :319; WI registry.spec:608. |
| Unknown defaults unrecognised; null never clean | COMPLETE | WI registry:506; PC interface:214. |
| Count ordinary artifacts without making every census non-clean | PARTIAL | Counted, but wrong qualifying class; R3-S1. |
| Disjoint buckets, resolution, freshness and overflow | COMPLETE as foundation | PC interface:11, :121, :206, :259; producer integration remains later. |
| 965-character fixture, ≤1,000 | COMPLETE | Independently measured 965; WI registry.spec:153. Bounded fixture, not a universal validator for arbitrary malformed objects. |
| Module boundaries/barrels; no tool behaviour change | COMPLETE within reported scope | WI registry:30; WI index:105; scoped lint/typecheck and reference search. |
| Identify historical flaky platform-core test | UNRESOLVED evidence | Current full scoped run passes; earlier failure name/stack not recorded by author. |

Implicit requirement now addressed by the r3 request but not implementation: source completeness must distinguish source-like unknowns from ordinary counted artifacts.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Empty/repeated approximations | YES | PC interface:259; deduplication and deterministic ordering retained. |
| Unknown/truncated census, unrecognised:null | YES | PC interface:206; probe confirmed null fails. |
| Positive/null nonSource | YES by accepted rule | PC interface:157; classifier accuracy remains essential. |
| Positive/null failure/cap buckets; partial resolution; stale state | YES | PC interface:210, :223, :232. |
| MDX/CMake, unknown extensionless/shebang script | YES | Counted unrecognised; no content-dependent false success demonstrated. |
| Ordinary binaries/archive/docs and go.sum | NO | R3-S1; false qualifier. |
| Concurrent classifier calls | YES within this pure helper | No per-call shared mutation or asynchronous work (WI registry:484). |
| Grammar load failure | Representable | Must be counted by future producers, not inferred from static registry capability. |

## Verification and flaky-test investigation

All commands used NX_ISOLATE_PLUGINS=false and --skip-nx-cache. Ran the full scoped command once, as permitted by the request's “twice, or the whole scoped command” alternative; no failure-only rerun or status loop.

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache --output-style=static`: PASS all six tasks, 1m22s.
- Platform-core: 44 suites passed; 851 tests passed, 4 todo, 9.732s. Workspace-intelligence: 47 suites and 1,363 tests passed. The current log contains no failing test or graceful-exit warning.
- Nx nevertheless reports “detected a flaky task: @ptah-extension/platform-core:test”. This is task-level historical evidence, not a failing assertion from this run.
- The author reports 1 failed/850 passed on an earlier run, then standalone and full-run passes, but did not record the test name (`batch-22-executor-report.md:278`). **Classification: indeterminate relative to the Batch 22 base.** PC was not changed by revision round 2 according to the reported delta, so there is no evidence the classifier-only correction caused it; that does not prove the failure predates Batch 22. No specific flaky test could be identified or responsibly attributed from the available evidence.
- Static full log retained at `C:/Users/abdal/AppData/Local/Temp/task559-b22-r3-nx.log`; only targeted summary/failure-pattern lines were returned. This preserves any evidence instead of rerunning to rediscover it.
- `nx run degradation-audit:lint`: PASS, TOTAL 300.
- `nx run ptah-electron:validate-deps`: PASS, including dependency task.
- Scoped `ptah_get_diagnostics` for the registry: available, 0 errors and 0 warnings.
- OS-temp Node probe: all 45 classification rows above, census transitions, null gate, list sizes and actual fixture size. Source was not modified. No archive/content analysis or production consumer integration was claimed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for R3-S1; LOW for the cause of the historical test failure.
- Top risk: ordinary retained binaries/archives and checksum data make source-analysis completeness permanently qualified.
- What a robust implementation would add: counted non-qualifying artifact/checksum treatment, count-conserving clean-census regressions, and retention of the existing MDX/CMake/unknown-source protections. Keep the prior flaky-test attribution explicitly unresolved unless its failure log is recovered.
