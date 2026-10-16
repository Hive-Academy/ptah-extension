# Batch 13 report — `wizard:analysis-status` RPC

## Tasks and evidence

- **13.1:** Registered `wizard:analysis-status` in the shared RPC registry and host-source baseline, using the existing `WizardAnalysisStatusParams` and `WizardAnalysisStatusResponse` types. Added `WizardAnalysisStatusParamsSchema = z.object({})`. Typecheck, lint, and shared tests passed.
- **13.2:** Added the method to `SetupRpcHandlers.METHODS` and bound it beside `wizard:get-resumable-run`. The handler parses params, resolves `ANALYSIS_FRESHNESS_SERVICE`, and calls `getStatus(workspaceRoot ?? null)`. Tests cover registration, extra keys accepted by the Zod object schema, invalid array params rejected, missing status with no workspace, unchanged service result, and no storage mutation. The resume fixture now uses v4; a legacy v3 run excluded by storage yields no resumable run. RPC handler tests passed.
- **13.3:** The CLI engine test passed without any edit under `libs/backend/cli-engine` or to `CLI_EXPECTED_ABSENT_METHODS`.

F18 was handled by landing the registry, baseline, schema, and handler together. F19 was handled by confirming the CLI test passes with the new method on its existing RPC surface and no CLI engine edit.

## Files created or modified

- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc.types.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-13-report.md`

## Verification

Each command ran from `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions`. The five source files above were the exact Prettier file set. Scoped `ptah_get_diagnostics` reported zero errors and zero warnings.

| Command                                                                                                      | Tail result                                                                     | Exit code |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------: |
| `npx prettier --write <five changed source files>`                                                           | Five files formatted or unchanged                                               |         0 |
| `npx prettier --check <five changed source files>`                                                           | `All matched files use Prettier code style!`                                    |         0 |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`      | `Successfully ran targets typecheck, lint for 2 projects`                       |         0 |
| `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2` | Header: `Running target test for 2 projects`; both test targets succeeded       |         0 |
| `npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1 --maxWorkers=2`                          | `Successfully ran target test for project @ptah-extension/cli-engine`           |         0 |
| `npx nx run di-lint:lint`                                                                                    | `di-lint OK: 1826 @inject sites all resolve to a registered token (793 tokens)` |         0 |

Nx Cloud reported a disabled organization (401) after the successful local targets; every command still exited 0.
