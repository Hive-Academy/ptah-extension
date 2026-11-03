# Batch 6c â€” Runtime-neutral session controls

## Files and public API

- `session-runtime-router.ts`: `SessionRuntimeRouter` implements all five shared `SessionRuntimeControls` methods. `SessionRuntimeIdentityLookup.lookup` supplies live/persisted immutable bindings; `NativeSessionControls` is the injected shared port. `SessionRuntimeRoutingError` distinguishes unknown sessions, missing identities and identity mismatches (including session IDs). `canSendFollowUp` validates identity and exposes the interrupt block; `releaseSession` releases state on final disposal. Runtime failures propagate without fallback. Native `AppliedSettings` timing/revision pass through unchanged.
- `session-runtime-router.spec.ts`: both runtime branches, all controls, persisted identity over focused-provider context, typed identity failures, native failure without fallback, failed/thrown interrupts and overlapping acknowledgements.
- `legacy-session-controls.ts`: `LegacySessionControls` implements the shared port through injected `LegacySessionLookup`, `LegacySettingsPersistence`, model resolver, existing lifecycle interrupt and `LegacySlashCommands`. The live session view is structurally compatible with `SessionRecord`; query methods are picked from the existing `Query` contract. Settings operations serialize per session, apply before save, restore live state when saving rejects, and advance the live registration's revision only after success. `LegacySessionControlError` reports missing live queries, unsupported effort and dual save/rollback failures. Compact invokes the injected existing slash execution path with `/compact`.
- `legacy-session-controls.spec.ts`: all permission mappings (including live YOLO), model resolution/clear, effort clear, explicit max refusal, apply/save ordering, rollback of all three settings, live failures without persistence, rollback failure propagation, serialization and lifecycle/slash delegation.

## Verification

- `npm run verify -- -p @ptah-extension/agent-sdk`: **FAILED (lint only), verify exit 1**. Test and typecheck succeeded. Test result: **185 passed / 2 skipped suites; 4008 passed / 3 skipped tests (4011 total)**. Lint: 3 errors / 95 warnings, none in these four files:
  - `libs/backend/agent-sdk/package.json:8`: missing `@ptah-extension/codex-runtime` dependency declaration (the 6a modules import it; these modules do not).
  - `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:174` and `:183`: `no-unexpected-multiline`.
  - Full test run also emitted the existing-style Jest worker forced-exit warning; tests still passed. No teardown investigation outside the batch was attempted.
- `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=codex-app-server`: **PASS, verify exit 0**, **5 suites / 60 tests passed**, including both new specs and the concurrent lane's three specs.
- Scoped `ptah_get_diagnostics` after the final edits: **0 errors / 0 warnings**, clean coverage. Earlier diagnostics found two test-fixture typing errors; both were fixed before the queued verification acquired its lock.
- Both commands targeted **exactly one project**, `@ptah-extension/agent-sdk`, with wrapper-enforced `--parallel=1`. This installed Nx version used compact output and did **not** print the requested literal `Running target ... for 1 projects` header. Actual headers were `NX 3 tasks: 2 succeeded, 1 failed` and `NX 1 task: 1 succeeded`. The corresponding FIFO labels were `verify lint,test,typecheck (@ptah-extension/agent-sdk)` and `verify test (@ptah-extension/agent-sdk)`. No requested header is fabricated here; no failed suite was rerun solely to change output formatting.
- Logs: `C:/Users/abdal/AppData/Local/Temp/ptah-batch-6c-verify.log` and `C:/Users/abdal/AppData/Local/Temp/ptah-batch-6c-specs.log`. Detailed existing Nx output was read from `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/12397972908192073795` (lint), `5972353896853110737` (full tests), `10107632466774458382` (typecheck), and `1092038817241844549` (focused tests). `ptah_search_files` returned zero hits for the external Nx cache; native log discovery/read was used after that empty result.

## Decisions

1. **Use identity bindings only.** Options: session identity or focused/global provider. The shared contract and implementation-plan section 5 require immutable session routing. Both bindings are compared with `sessionRuntimeIdentityMismatch`; their session IDs are checked separately because that helper deliberately excludes IDs. Reversible: lookup composition can change without changing dispatch policy.
2. **Keep a failed interrupt blocked until a successful interrupt.** Options: successful interrupt or turn-end notification. Chose successful interrupt because this port has no turn token, so an unqualified late turn-end notification could release a newer failure. Attempt symbols prevent a late success clearing a newer attempt. Disposal releases memory explicitly. Reversible: a future token-qualified terminal event can extend the port.
3. **Use the underlying SDK query for live settings.** Options: existing `SessionControl` setters or its verified underlying query methods. `session-control.service.ts:505` remaps YOLO to default and `:591` converts max to xhigh; both conflict with this batch. Reuse `PERMISSION_MODE_MAP` for the other modes and override only live YOLO to `bypassPermissions`, matching `config-rpc.handlers.ts:763`. Initial launch mapping remains unchanged. Reversible: delegate to the lifecycle setters once they expose matching semantics.
4. **Reject unsupported legacy max transitions explicitly.** Options: undocumented xhigh conversion, claiming next-turn after only saving, or typed refusal. `FlagEffortLevel` and `Query.applyFlagSettings` exclude max; no verified per-turn reconfiguration exists in this batch. Therefore max requests and transitions whose rollback would require max fail before apply/save. Supported updates report `effectiveNow`; the router preserves native `nextTurn` results. This is an explicit capability limitation, not a silent downgrade. Reversible: add a verified SDK reconfiguration path in an authorized batch.
5. **Inject the existing persistence and slash boundaries.** Existing RPC persistence uses `ModelSettings.selectedModel.set` (`config-rpc.handlers.ts:203`), `ReasoningSettings.effort.set` (`:725`, undefined encoded as empty string), and `ConfigManager` autopilot settings (`:353-357`). The persistence port requires rejection without committed partial writes; composition owns scope and any multi-write restoration. The slash port binds the existing SDK `executeSlashCommand` (`sdk-agent-adapter.ts:1640`) plus its normal stream pump/admission context. No SDK slash configuration is fabricated. Reversible: these are host composition bindings, assigned to 6e/7c.
6. **Serialize setting mutations and keep registration-local state.** Options: independent mutations or a per-session promise queue. Without serialization, an older failed save could undo a newer success. Queue entries are released on settlement; revision/effort snapshots use a WeakMap keyed by the live registration. All live settings writers must migrate to this port so snapshots stay authoritative. Reversible: host-owned serialization can replace this queue when it supplies equivalent guarantees.

## Remaining integration and limitations

- Legacy max effort has no truthful immediate/next-turn implementation within the owned paths; it fails explicitly as described above.
- Batches 6e/7c must wire ports, exports, DI, persistence scope/atomicity, slash pumping, follow-up admission checks and final-disposal release. No registrations or callers were changed here.
- No live paid model tests, host feature changes, git operations or edits to the other lane's files were performed.
- Overall verification remains red due to the three out-of-scope lint errors above. No existing package/spec file was changed to repair them.

## Absolute files created

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6c-report.md

## Continuation (team-leader fixes)

This continuation supersedes Decisions 3 and 4 and the earlier legacy max limitation; the original verification and decision history above is retained.

3. **Preserve legacy callback routing for live YOLO.** Options: send literal SDK bypassPermissions or resolve every frontend level through PERMISSION_MODE_MAP. Chosen: use the existing map for every apply and rollback, and record the frontend permission level on the session. Evidence: permission-mode-map.ts maps both yolo and its bypassPermissions alias to default so canUseTool still intercepts AskUserQuestion and ExitPlanMode; session-control.service.ts uses that map for live changes. The callback auto-approves tools using session.permissionLevel === 'yolo'. The previous direct bypassPermissions override was a regression. Reversible: local mapping delegation, but changes must preserve interactive callbacks.

4. **Preserve legacy max effort support.** Options: reject max or retain the existing live xhigh mapping and persist max. Chosen: apply xhigh live, save max unchanged, and return timing nextTurn with a new revision. This timing does not promise immediate full max support: persisted max takes full effect on the next session start. Evidence: session-control.service.ts setSessionEffort explicitly implements this compatibility mapping. Rollback uses the same mapping, including when the previous requested effort was max. Lower levels remain effectiveNow and undefined clears the live override with null. Removed the now-unused unsupported-effort error code. Native runtime mapping rules do not change. Reversible: the legacy adapter can adopt full live max if the SDK later exposes it.

### Changed files and regression coverage

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts — corrected permission apply/rollback and effort apply/rollback/timing; public controls and persistence signatures unchanged.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.spec.ts — verifies live YOLO default mode plus frontend yolo, rollback to plan and back to yolo, max live xhigh before saving max, nextTurn timing, failed max save restoration, and lower-level transitions/rollback from both initial and newly committed max. Existing clear-effort, live failure, revision and serialization coverage retained.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6c-report.md — appended these corrections and continuation verification results.

Only these three files were modified in this continuation. No commits or paid model tests were run.

### Continuation verification results

- `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=codex-app-server` — passed, exit code 0; **5 suites passed, 63 tests passed**, 0 snapshots. FIFO lock acquired at 18:15:39 UTC and released at 18:15:50 UTC on 2026-10-25.
- `npm run verify -- -t typecheck -p @ptah-extension/agent-sdk` — passed, exit code 0; `tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json`. FIFO lock acquired at 18:15:51 UTC and released at 18:16:03 UTC, after tests finished.
- Scope evidence: both commands emitted `NX   1 task: 1 succeeded`. This Nx output mode did not emit a `Running target ... for 1 projects` header; the exact commands above select one project and each summary confirms one task. No verification was rerun just to change the output format.
- Logs: `C:/Users/abdal/AppData/Local/Temp/ptah-batch-6c-continuation-tests.log` and `C:/Users/abdal/AppData/Local/Temp/ptah-batch-6c-continuation-typecheck.log`. Saved Nx terminal output: `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/7600423502885691525` (test counts), `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/13973340292103636586` (typecheck).
- Nothing requested remains unimplemented. Lint was not rerun in this continuation, as the requested checks were focused tests and typecheck; the historical lint results above are not a current lint claim.
