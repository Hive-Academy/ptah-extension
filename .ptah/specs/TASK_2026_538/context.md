# TASK_2026_538 — context

Type: BUGFIX (security). Base: origin/main f98b1309d. Approved by the user 2026-09-24.

## Approved plan

- Branch `fix/cursor-key-secrets` (worktree `.claude-worktrees/cursor-key-secrets`).
- Batch A — `rpc-handlers` + `shared` type comments. Author: Codex lane. Review: in-process subagent.
  `agent:setConfig { cursorApiKey }` → `AuthSecretsService.setProviderKey('cursor', …)`; empty
  string → `deleteProviderKey('cursor')`; plain setting removed. `isCursorApiKeyConfigured` →
  async, env `CURSOR_API_KEY` or `hasProviderKey('cursor')`. New exported
  `migrateCursorApiKeyToSecrets(workspace, secrets, logger)`: plain value present → copy to the
  secret only when no secret exists, then delete the plain value; never logs the value; idempotent.
- Batch B — `cli-agent-runtime` (separate worktree `.claude-worktrees/cursor-key-adapter`, branch
  `fix/cursor-key-secrets-adapter`, merged into the task branch). Author: GLM lane (Ollama Cloud).
  Review: in-process subagent. `CursorCliAdapter` stops reading `~/.ptah/settings.json`;
  `CliDetectionService` injects `TOKENS.AUTH_SECRETS_SERVICE` and passes a key resolver
  (env → secret).
- Batch C — composition roots. Author: in-process. Review: Antigravity lane. Call the migration
  after `runMigrations()` in `apps/ptah-extension-vscode/src/activation/bootstrap.ts`,
  `apps/ptah-electron/src/activation/bootstrap.ts`, `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`.
  Failure → warning without the value; plain setting kept; retried next boot.
- Max 2 revise rounds per batch. Verify test/lint/typecheck for rpc-handlers, shared,
  cli-agent-runtime, cli-engine and apps ptah-extension-vscode, ptah-electron, ptah-cli.
- `fix-report.md` carries the write-path trace (key → store → every reader).

## Decisions

- Not the `settings-core` `MigrationRunner`: its migrations get only `ptahDir` and a sentinel
  stops later runs; the spec wants an idempotent step on every startup.
- `provider.cursor.apiKey` stays registered in `file-settings-keys.ts` so the migration can read
  and delete it.
- The Cursor CLI is not installed on this machine: unit and bootstrap specs only.
