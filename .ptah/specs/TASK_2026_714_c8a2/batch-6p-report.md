# Batch 6p report — TASK_2026_714_c8a2

Implemented the six assigned source/spec files. Required verification ran under the machine-wide FIFO lock. Codex-runtime and all seven downstream typechecks pass; the combined library gate remains failed only on the documented auth-providers lint defects and Windows proxy integration cleanup failures outside this batch. No Git commands were run, and no task-state files or other source files were edited.

## Changes and evidence

### Shared workspace key (R7-3)

Added and exported `normalizeCodexWorkspaceKey(workspacePath, platform)` alongside the existing home normalizer. It selects `path.win32` or `path.posix` from its explicit argument, normalizes lexical dot segments without resolving against cwd, rejects empty/relative/NUL-containing paths, preserves roots, and trims trailing separators. Only Windows keys convert backslashes to forward slashes and fold case. POSIX backslashes remain literal filename characters.

Windows paths rooted on an unspecified drive and incomplete UNC paths are also rejected. Final inspection identified that inputs such as `//server` otherwise normalize into a key rejected on the next call; validating the normalized Windows root closes that idempotence gap.

Removed the private resolver helper and its Node path import. Both stored and current workspace identities use the shared helper. Fresh native starts also reject invalid workspace paths. Throws map to content-free `AuthRequiredError('Cannot use native Codex session: workspaceId is invalid.')`, following the existing home-error pattern without embedding the path or original error.

Specs cover Windows drive/UNC roots, case and separator variants, dot segments, Linux/macOS/POSIX handling, literal backslashes (including a trailing literal backslash), rejection, and idempotence. Resolver regressions cover both comparison sides, identities persisted through the shared export, invalid current/stored values, and refusal before profile/proxy/auth materialization. The workspace fixture now supplies an absolute path on either Windows or POSIX. The existing mismatch test uses an absolute different workspace so it still tests mismatch rather than invalid-input rejection.

Batch 6d must persist workspace IDs through this export; persistence was not assigned here.

### Model substitution (R7-4)

The native branch of exported `ResolvedExecutionProfile` now has optional `modelSubstitution` with readonly `requested`, `used`, and `reason: 'not-in-catalog' | 'case-mismatch'` fields.

Exact catalog IDs remain unchanged. Case-only matches use the catalog's own ID, including non-default models, with `case-mismatch`. Unknown values use the existing first-catalog-model/opus fallback with `not-in-catalog`. Tier aliases (including case/whitespace variants) map to their Codex tier defaults without substitution metadata. Existing trimming for lookup is preserved; metadata retains the original requested string.

Specs assert absent metadata for exact models/tier aliases and complete metadata for case mismatches/unknown values on both start and resume. Legacy resolution remains unchanged. Batch 7a still owns the user-visible notice.

The normalizedHome schema refine is outside these six files: `libs/shared/src/lib/types/session-runtime.schemas.ts:20` still uses `z.string().min(1)`. It was read and left for Batch 6d as instructed.

### Dev-route test gap (P5b M1)

Added parameterized tests for both omitted `isPackaged` and explicit `isPackaged: undefined`, cast across the type boundary with the enabling env value. Both return null. Production `codex-dev-route.ts` was not edited. The host wiring guarantee remains Batch 8a's responsibility.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Reject invalid current workspace paths on fresh native starts as well as resume | Validate every native request; only validate resume | The new helper requires absolute paths; validating at entry prevents producing an unusable native seed | Yes |
| Reject Windows roots without a drive and incomplete UNC paths after lexical normalization | Accept Node's broadly absolute forms; require a stable absolute key | Existing home normalizer rejects unspecified-drive roots; incomplete UNC normalization otherwise violates required idempotence | Yes |
| Retain original requested model in metadata while trimming for lookup | Raw request; trimmed request | Existing resolver trims lookup; the new requested/used contract is useful for the later substitution notice | Yes |
| Keep distinct content-free workspaceId and normalizedHome errors | Reuse misleading home wording; identify only the invalid field | Existing resolver identifies mismatch fields and sanitizes home failures | Yes |

The batch/Session 7 plan chooses the module and public contracts; no new architecture or approval decision was needed. Repository evidence: root CLAUDE.md verification/ownership rules; existing codex-home-path.ts normalization; resolver home validation and model tier/catalog resolution; colocated dev-route/spec patterns. The batch is the current implementation assignment despite older planning-only wording in context.md.

## Verification

All npm commands below captured output to the listed temporary logs and printed filtered tails. No failed command was rerun merely to read its output. The final one-project run validates the subsequent incomplete-UNC fix. The FIFO queue was respected, including waiting behind another worktree; no lock bypass or installation was performed.

### Required two-library gate

```text
npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/auth-providers -- --output-style=static
```

Exit **1**. Header explicitly confirmed:

```text
NX   Running targets lint, test, typecheck for 2 projects:
- @ptah-extension/codex-runtime
- @ptah-extension/auth-providers
```

| Project / target | Filtered result |
| --- | --- |
| @ptah-extension/codex-runtime:test | Test Suites: 17 passed, 17 total; Tests: 805 passed, 805 total |
| @ptah-extension/codex-runtime:typecheck | Completed; absent from Failed tasks |
| @ptah-extension/codex-runtime:lint | 8 problems (0 errors, 8 warnings); no findings in changed files |
| @ptah-extension/auth-providers:typecheck | Completed; absent from Failed tasks |
| @ptah-extension/auth-providers:test | Test Suites: 1 failed, 1 skipped, 75 passed, 76 of 77 total; Tests: 5 failed, 10 skipped, 2032 passed, 2047 total; 2 snapshots passed |
| @ptah-extension/auth-providers:lint | 17 problems (3 errors, 14 warnings); no findings in changed files |

Terminal failure tail:

```text
NX   Running targets lint, test, typecheck for 2 projects failed
Failed tasks:
- @ptah-extension/auth-providers:test
- @ptah-extension/auth-providers:lint
[verify 2026-10-25T16:33:28.577Z] lock released after 154.2s, exit code 1
```

The only failing suite is untouched `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`. Five tests fail during `removeTree` cleanup at line 177: S1/S2/S3/S4 with EPERM, S6 with ENOTEMPTY (also a suite teardown cleanup error). The resolver spec is among the passing suites; the reporter suppresses individual passing-suite names. The same cleanup class is documented before this batch in batch-5c-report.md:37 and batch-5d-report.md:36.

The three lint errors match pre-edit, stash-free evidence in batch-5c-report.md:38 and batch-5d-report.md:37:

| Untouched file | Current location | Error |
| --- | --- | --- |
| libs/backend/auth-providers/package.json | 9:5 | @nx/dependency-checks: unused @ptah-extension/persistence-sqlite dependency |
| libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts | 132:5 | no-unexpected-multiline |
| libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts | 16:55 | no-control-regex |

No edits or Git stash were used to establish that comparison.

### Required host and consumer gate

```text
npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/gateway-chat-bridge,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers -- --output-style=static
```

Exit **0**. Header: `NX Running target typecheck for 7 projects`. Electron was first in the requested scope; Nx schedules dependency checks before host checks.

| Project / target | Result |
| --- | --- |
| ptah-electron:typecheck | PASS |
| ptah-extension-vscode:typecheck | PASS |
| ptah-cli:typecheck | PASS |
| ptah-tui:typecheck | PASS |
| @ptah-extension/gateway-chat-bridge:typecheck | PASS |
| @ptah-extension/agent-sdk:typecheck | PASS |
| @ptah-extension/rpc-handlers:typecheck | PASS |

Filtered tail:

```text
> nx run @ptah-extension/agent-sdk:typecheck
> nx run @ptah-extension/rpc-handlers:typecheck
> nx run @ptah-extension/gateway-chat-bridge:typecheck
> nx run ptah-electron:typecheck
> nx run ptah-extension-vscode:typecheck
> nx run ptah-tui:typecheck
> nx run ptah-cli:typecheck
NX   Successfully ran target typecheck for 7 projects
```

No moved-helper or resolver-result caller breaks were observed.

### Final incremental gate after incomplete-UNC regression fix

```text
npm run verify -- -p @ptah-extension/codex-runtime -- --output-style=static
```

Exit **0**. Header names only project `@ptah-extension/codex-runtime`.

| Project / target | Final filtered result |
| --- | --- |
| @ptah-extension/codex-runtime:test | Test Suites: 17 passed, 17 total; Tests: 808 passed, 808 total |
| @ptah-extension/codex-runtime:typecheck | PASS |
| @ptah-extension/codex-runtime:lint | 8 problems (0 errors, 8 warnings); no findings in changed files |

Tail: `NX Successfully ran targets lint, test, typecheck for project @ptah-extension/codex-runtime`.

Both scoped ptah_get_diagnostics calls, including after the final source edit, returned typescript-compiler coverage clean, **0 errors / 0 warnings**, for the six assigned files and their owning projects. Prettier was applied only to assigned files. Runtime Jest also prints the existing ES-module config warning and worker-force-exit warning; these did not fail the runtime gate.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-home-path.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-home-path.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-dev-route.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6p-report.md

Verification logs written outside the repository:

- C:/Users/abdal/AppData/Local/Temp/ptah-batch6p-libs-verify.log
- C:/Users/abdal/AppData/Local/Temp/ptah-batch6p-hosts-verify.log
- C:/Users/abdal/AppData/Local/Temp/ptah-batch6p-runtime-final-verify.log

## Remaining work outside this batch

The full auth-providers gate cannot be made green within these six files because the failures above belong to untouched files. The shared normalizedHome schema refine and persisted workspace-key adoption remain for 6d; user-visible substitution notices remain for 7a; Electron packaging-state composition remains for 8a. No task state was changed.

