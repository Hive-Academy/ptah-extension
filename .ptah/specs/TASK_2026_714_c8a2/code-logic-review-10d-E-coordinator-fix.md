# Code Logic Review — batch 10d.E coordinator spec fixes

Review family: codex  
Implementer family: claude  
Score: 8/10  
Verdict: APPROVED

## Scope and evidence

Reviewed the three spec files, their tracked diffs (the lane composition spec is untracked, so its full working copy was read), the D27 decision, and the production paths for workspace normalization, lane output, metadata listing and detector construction. The coordinator reports that the corrected specs pass locally. This read-only review ran no tests, diagnostics, build, lint or verification command. Skill loading was unavailable in this lane; no skill instructions were inferred.

## Per-fix assessment

| Fix | Status | File:line evidence and sensitivity |
| --- | --- | --- |
| 1. Resolve the lane workspace on the host platform | **Sound** | `session-metadata-store.spec.ts:349-371,381-411` uses the resolved path for persistence and both listing modes, then checks the lane row exists, lane identity read works and chat resume lookup is empty. `codex-home-path.ts:24-36` requires an absolute workspace for the active platform; the old `/workspace/project` fails that requirement on Windows. The records mock includes child rows when requested (`session-record-repository.mock.ts:36-45,60-69`), so deleting the consumer filter at `session-metadata-store.ts:1579-1580` still fails the second test. The storage branch fails similarly at `session-metadata-store.ts:1584-1590`. |
| 2a. Optional adapter methods | **Sound** | `codex-lane-composition.spec.ts:291-295` requires `ensureTokensFresh?.()` to return `true` and `listModels?.()` to be defined. If either method is absent, the optional call returns `undefined` and its assertion fails; the original TS2722 is avoided without weakening those outcomes. |
| 2b. Normalize home-key expectations | **Sound** | `codex-lane-composition.spec.ts:264-265,294-303` compares the opened profile to the platform-specific key. `codex-home-path.ts:4-20` lowercases Windows keys. The selected-home MCP assertions at `codex-lane-composition.spec.ts:302-303` independently reject a wrong home selection. This checks home selection, though it does not independently validate the normalizer itself. |
| 2c. Ignore unrelated usage output in the approval case | **Sound** | `codex-lane-composition.spec.ts:372-402` still requires one exact `Codex approval declined: userInput` line, an empty user-input answer, and no `secret question` anywhere in output. The fake context returns a turn receipt and emits a completed terminal event with `usage: {}` (`codex-lane-composition.spec.ts:75-87`); the adapter starts that turn (`codex-app-server-lane.adapter.ts:408-445`) and the lane mapper emits `Codex turn usage.` on a terminal carrying usage (`codex-lane-events.ts:148-157`). The extra line is fixture-driven expected lane behavior, not evidence of a product turn that never ran. |
| 3. Resolve the real detector after dependency stubs | **Sound** | `container.smoke.spec.ts:1186-1235` registers the real lane factory and CLI services, skips the detector stub when capture is requested, and then resolves `TOKENS.CLI_DETECTION_SERVICE`. Registration binds that token to `CliDetectionService` (`cli-agent-runtime/src/lib/di/register.ts:286-289`). Its constructor selects factory-created native Codex or `CodexCliAdapter` (`cli-detection.service.ts:90-110`). The unpackaged case demands a native instance (`container.smoke.spec.ts:1351-1354`); the packaged case demands no factory and the legacy class (`:1356-1363`). The six new `{}` bindings at `:1223-1232` satisfy unrelated constructor dependencies and do not replace either the factory or detector. Both cases cannot pass by returning the same adapter. |

## Five logic questions

1. **Silent failure:** The changed assertions still fail when a lane row enters either chat listing, when the approval line is absent or duplicated, or when the wrong adapter is selected (`session-metadata-store.spec.ts:370-375,401-410`; `codex-lane-composition.spec.ts:394-400`; `container.smoke.spec.ts:1351-1363`).
2. **Unexpected user action:** A user-input request is declined by the lane and yields one kind-only notice without leaking the question (`codex-lane-composition.spec.ts:388-400`; `codex-app-server-lane.adapter.ts:247-255`).
3. **Wrong input answer:** Windows absolute-path normalization now permits a valid lane fixture while the wrong selected home still fails the MCP-server checks (`codex-home-path.ts:4-20,24-36`; `codex-lane-composition.spec.ts:294-303`).
4. **Dependency failure:** The new `{}` dependencies are construction-only for these cases. A missing native factory or a detector construction failure would fail the unpackaged instance assertion; a factory bound under the closed packaged gate fails the registration assertion (`container.smoke.spec.ts:1223-1235,1351-1363`).
5. **Requirements gap:** These edits do not independently test the normalizer implementation or a real App Server turn. Their target is selection, isolation and output filtering in the existing fixtures (`codex-lane-composition.spec.ts:190-212,264-271,372-400`). No new requirement is obscured by the coordinator fixes.

## Numbered defects

None. The review found no location-backed behavioral defect in the coordinator fixes or product path they exercise.

## Verdict basis

**APPROVED, 8/10.** The assertions remain capable of failing on the named bugs, and the extra usage line follows the fake terminal event. This merits more than 7 because both listing branches and both D27 constructor outcomes are discriminated. It stops short of 9 because `CodexRuntime.open` is mocked (`codex-lane-composition.spec.ts:194-198,375-379`), leaving real process behavior outside this review's evidence. The reported local pass was not independently rerun under the read-only command restrictions.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Accept `resolve(WORKSPACE)` for the lane-only fixture | Keep POSIX literal / resolve for host platform | The lane identity requires an absolute workspace on Windows (`codex-home-path.ts:24-36`); the two tests use the same resolved path for write and read (`session-metadata-store.spec.ts:351-411`). | Yes |
| Treat the extra usage line as fixture output, not a product defect | Product bug / expected mapped terminal output | The fake emits a completed terminal with usage (`codex-lane-composition.spec.ts:75-85`); the mapper emits the line for that event (`codex-lane-events.ts:148-157`). | Yes |
| Accept construction-only stubs in the D27 smoke harness | Reject stubs / accept while preserving detector and factory | The real detector token is resolved (`container.smoke.spec.ts:1203-1205,1233-1235`) and both adapter outcomes are class-checked (`:1351-1363`). | Yes |
