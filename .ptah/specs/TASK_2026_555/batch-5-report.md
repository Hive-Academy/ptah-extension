# Batch 5 report — TASK_2026_555 (551 read-back fields + migrate rejecting-write spec, S1b)

Task 5.1: `agent:getConfig` now returns `cursorApiKeyStored` and `cursorApiKeyEnvSet`, and `migrateAgentOrchestrationSettings` is shown to survive a rejecting write.

## Files changed

| File | What it does | Author |
| --- | --- | --- |
| `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\shared\src\lib\types\rpc\rpc-agents.types.ts` (MODIFIED) | `AgentOrchestrationConfig` gains `cursorApiKeyStored: boolean` (the secret `ptah.auth.provider.cursor` exists) and `cursorApiKeyEnvSet: boolean` (`CURSOR_API_KEY` is non-blank). Both sit next to `cursorApiKeyConfigured` (unchanged). | lane |
| `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (MODIFIED) | The lane added both fields plus an `isCursorEnvKeySet()` helper. That version called `hasProviderKey('cursor')` twice per `getConfig`. I replaced `isCursorApiKeyConfigured` and `isCursorEnvKeySet` with one `getCursorApiKeyStatus()` that returns `{configured, stored, envSet}`. It reads the secret once, and `configured = envSet \|\| stored` (same result as before). Only booleans are returned; the key value is never read. | lane, refactored by me |
| `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.set-config.spec.ts` (MODIFIED) | The `agent:getConfig Cursor key status` block asserts all three fields in these cases: none set, legacy plain setting ignored, secret only, env only (JSON contains no env value; the secret store is still consulted), blank env, and both set. The old assertion "env set → `hasProviderKey` not called" was flipped on purpose, because `Stored` must be reported independently. | lane |
| `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.migration.spec.ts` (CREATED) | This is new because no migration spec existed before. Cases: (1) `register()` with a `setConfiguration` that rejects does not throw, the warning is logged, and the migrated flag is not written, so the next launch retries (lane). (2) The migration promise itself resolves and does not reject when every `setConfiguration` rejects: one warning carrying the error text, and no `stateStorage.update` (me). (3) The happy path copies only the keys missing from the workspace provider and sets the flag (lane). | lane + me (case 2) |

## Verify result

Command (Batch 5 verification, with `--parallel=2`):
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/chat ptah-extension-webview`

- typecheck: all 5 projects pass.
- lint: 0 errors in every project (warnings only: 5 / 13 / 31 / 47, none new from Batch 5 files).
- test:
  - shared: 81/81 suites, 2202 tests passed.
  - core: 33/33 suites, 959 passed.
  - chat: 107/107 suites, 1645 passed, 2 skipped.
  - webview: 11/11 suites, 224 passed.
  - rpc-handlers: 112/115 suites, 3385 passed, 3 failed, 4 skipped. **Overall exit 1.**
- The 3 rpc-handlers failures are outside Batch 5:
  - `voice-rpc.handlers.spec.ts:284` and `file-view…` failed on a 5 s timeout. Both pass on re-run, so they are load flakes; other batches were verifying concurrently.
  - `harness/selection/harness-skill-selection-rpc.service.spec.ts:113` fails every time. `state.json` already exists at `harnessStatePath(root)` before the service runs, so this looks like environment or shared-state pollution. The spec does not import `agent-rpc.handlers` and no Batch 5 file touches harness-sync.
- Scoped re-run: `npx nx test @ptah-extension/rpc-handlers -- --maxWorkers=2 --testPathPatterns="voice-rpc…|harness-skill-selection…|file-view|agent-rpc.handlers.set-config.spec|agent-rpc.handlers.migration.spec"` gave 4/5 suites and 113/114 tests. Both Batch 5 specs pass; only the harness-skill-selection case fails.

## Risks handled

- No secret in any return value: the env-only spec asserts `JSON.stringify(result)` does not contain the env value.
- The spec shows the rejecting migration write cannot become an unhandled rejection during startup, by awaiting the private method directly. The flag is not set, so no legacy value is silently dropped.
- Removed the duplicated secret-store read per `getConfig`.

## Not done / out of scope

- The harness-skill-selection failure above needs an owner. It blocks a green `rpc-handlers:test` whatever Batch 5 does.
- Some fixtures build `AgentOrchestrationConfig` without the two new required fields:
  - `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.spec.ts:26`
  - `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:152`
  - `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts:153`

  `nx typecheck @ptah-extension/tribunal-panel` passes (exit 0), and the other two are untyped literals, so nothing breaks today. They should gain the fields when those files are next touched. Not edited here because they are not Batch 5 files.
- The UI read-back switch to `cursorApiKeyStored` (`providers-settings-state.service.ts:362`) belongs to Batch 8.
- `TASK_2026_551/fix-report.md` is not a Batch 5 file.
- Gate G was not run (the team-leader runs it at commit time).
