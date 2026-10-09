# Handoff — TASK_PROVIDER_SCOPE (workspace provider/model isolation)

- **Worktree:** `D:\projects\ptah-extension\.claude-worktrees\workspace-provider-scope`
- **Branch:** `fix/workspace-provider-scope-isolation` (from `main` @ `70f995a56`)
- **State (2026-10-09):** 63 files changed (+1934 / −352). NOT committed, NOT pushed, NO PR.
- **Other artifacts in this folder:** `codex-workflow-review.md` (Codex review, 8 findings), `implementation-notes.md` (per-batch file list and decisions).

## User-reported bugs

1. In a newly opened folder, the Main Agent "Save to" select defaulted to **Global**, not **This workspace**.
2. Saving a provider ended running chat sessions in **other** workspaces (looked like an app reload).
3. Setup Hub "AI team builder" sent the **new provider with the old model**.
4. User follow-up: review the setup wizard and the other workflows for the same defect (done with Codex).

## Root causes

- **Scope default:** `main-agent-reassign-popover.component.ts` `target` fell back to the model's stored scope (`global` for a new folder), then `targets[0]` (`global`). `welcome.component.ts` hardcoded `'global'`.
- **Cross-workspace teardown:** `auth:saveSettings` always called `sdkAdapter.reset()` → `disposeAllSessions()`, which aborts every session in the single Electron backend process. A secret-change watcher path did the same.
- **Old model:**
  - `ComputedSettingHandle.set` did not call `clearMoreSpecific`, so an old narrower model override shadowed the new save.
  - `ModelSettings` built the `provider.<authKey>.selectedModel` key from the raw `authMethod`. The UI builds it with `normalizeAuthMethod` and `DEFAULT_PROVIDER_ID`.
  - Internal queries got the provider from the process-wide `authEnv` and the model separately from the active workspace.
- **Same defect in other workflows:** setup-wizard analysis/generation, enhanced prompts (`workspacePath: '.'`), cron jobs, commit messages and memory curation used the active workspace or the process-wide auth, not their own workspace.

## What is done (batches 1–3)

- **Fix 1 (scope and isolation):**
  - "Save to" defaults to `workspace` when a workspace is open. The confirm text says "this workspace" or "every workspace".
  - A workspace-scoped save uses `applyWorkspaceAuthChange`. It ends only that workspace's sessions (`disposeSessionsForWorkspace`) and re-initializes auth without a full reset.
  - Global/app saves still call `reset()`. `auth:clearWorkspaceOverride` uses the same workspace path.
- **Fix 2 (model):**
  - `set()` clears narrower overrides.
  - The new `active-provider-auth-key.ts` builds the key the same way as the UI. It is used by the model and reasoning settings.
- **Batch 1:**
  - New port `IWorkspaceLlmResolver.resolveForPath(root, { requestedModel })` (agent-sdk), implemented by `WorkspaceLlmResolver` (auth-providers). It returns provider + model + auth for one path.
  - With no override, it uses app then global explicitly.
  - Stale-model fallback: a model not in the provider's cached list falls back to a tier mapping, with a warning.
  - `ComputedSettingHandle.watch` follows scoped keys.
- **Batch 2:**
  - The setup wizard (multi-phase/agentic analysis, content generation) and enhanced prompts use the snapshot. A frontend model is only a request.
  - The UI sends the real workspace root, not `'.'`. The VS Code host still sends `'.'`, as before.
  - Dead `AgentCustomizationService` (hardcoded `gpt-4o-mini`) is deleted.
- **Batch 3:** cron jobs, the commit-message generator and the memory curator resolve provider + model for their own workspace root.

All scoped specs and typechecks pass. The per-project counts are in `implementation-notes.md`.

## Known gaps (not done, decide if in scope)

- `WorkspaceScopeResolver.write(…, 'workspace')` still falls back to the global key with no active path. `output-style-selection.ts:133` depends on it.
- If no isolated snapshot can be built (missing credentials, unknown provider, proxy failure), the query uses the process-wide auth, with a warning.
- The curator's own provider/model settings are read globally.
- The effective-route display still builds its model key from the raw `authMethod` (wrong model shown for legacy values).
- Not run: app-level DI specs, e2e (`settings-providers.e2e.spec.ts` confirm text changed. Screenshots may differ because the default scope changed).

## Next steps (in order)

1. **Batch 4: Main Agent popover UI** (`libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts` + spec). Requested by the user through the PR #682 session:
   - One column grid: labels above controls for Provider connection / Model selection / Reasoning effort / Save to (today "Save to:" is an inline label).
   - The 6 effort buttons (default/low/medium/high/xhigh/max) need gaps and the same width as the selects.
   - The header row ("Reassign main agent" / "Check connection" / ×) uses the same left edge and padding as the fields.
   - Add explicit **Save** and **Cancel** at the bottom. Nothing saves until Save. Do not change autosave anywhere else.
   - Keep the MAIN AGENT card's "Active" and "Desktop app override" badges.
   - UI evidence: screenshots in dark and light themes, before/after.
2. **Cross-side review:** spawn a Codex lane (read-only, `deliverables: ["code-logic-review.md"]`) on the full branch diff. Do a write-path trace for every settings write (key, scope, reader). The code was written in-process by a Claude subagent, so the reviewer must be a CLI lane.
3. Fix the confirmed review findings (max 2 revise rounds).
4. Run the scoped checks yourself. Follow CLAUDE.md: only the changed projects, `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time.
5. **Ask the user** before you commit, push, or open a PR. Commit messages follow the repository's conventional style.
6. After the branch has batch 4, tell the PR #682 session (or the user) that the popover work is done.

## Coordination with PR #682 (another session, branch `fix/session-handoff-workflow`)

- **This branch owns:**
  - `main-agent-reassign-popover.component(.spec).ts`
  - `providers-settings.component(.spec).ts`
  - `auth-providers/.../provider-models.service.ts`
  - `agent-sdk/.../sdk-model-service.ts`
  - `settings-providers.e2e.spec.ts`
- **PR #682 owns:**
  - `cli-orchestration-matrix`
  - `cli-model-effort-popover`
  - `provider-consumer-assignments`
  - the `libs/frontend/ui` provider/brand marks
  - `providers-settings-state.service.ts`
  - the `agent:listCliModels` / ptah-cli instance model-count path
  - `settings.component.html/.ts` (card tabs)
- **Shared model-list files:** PR #682 tells us first if its Ollama Cloud "0 models" bug leads into `provider-models.service.ts` or `sdk-model-service.ts`.
- **PR #682 status:** commit `81c69399f` fixes its failing `webview-e2e`. That session will merge when all checks pass.
