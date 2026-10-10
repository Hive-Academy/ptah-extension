# Handoff — TASK_PROVIDER_SCOPE (workspace provider/model isolation)

- **Worktree:** `D:\projects\ptah-extension\.claude-worktrees\workspace-provider-scope`
- **Branch:** `fix/workspace-provider-scope-isolation` → **PR #688** (open, NOT merged — the user merges).
- **Pushed head:** `c96267341` — CI fully green (19 pass, 0 fail, 3 skipped).
- **Uncommitted (2026-10-10):** the shared-AuthEnv fix (18 files, see "Work in progress"). Scoped checks passed in the implementing subagent; NOT yet cross-reviewed, NOT committed.
- **main:** `927cba509` — **#686 is MERGED**. GitHub reports that #688 has conflicts with main. The user wants the new session to merge `origin/main` into #688 (step 6). The previous session tried the merge, then aborted it at the user's request; the resolution it found is in step 6.
- **Other artifacts here:** `implementation-notes.md` (per-batch files/decisions), `codex-workflow-review.md` (first Codex review, 8 findings — all FIXED), `code-logic-review.md` (cross-side Codex review of the branch: APPROVED 9/10 after round 1, with the write-path trace), `follow-up-shared-authenv.md` (the AuthEnv defect, design and `## Status` of the fix), `screenshots/` (popover before/after, dark/light).

## User-reported bugs (all fixed on the branch)

1. New folder: the Main Agent "Save to" defaulted to **Global** instead of **This workspace**.
2. Saving a provider ended chat sessions in **other** workspaces.
3. Setup Hub "AI team builder" sent the **new provider with the old model**.
4. The same defect in the setup wizard and other workflows (Codex review, 8 findings).

## Committed on PR #688

| Commit | Content |
|---|---|
| `8c1826434` | Batches 1–4: scope default, workspace-only teardown (`applyWorkspaceAuthChange`), `set()` clears narrower overrides + rejects a workspace write with no open workspace, `IWorkspaceLlmResolver` for wizard / enhanced prompts / harness / cron / commit message / curator, `AgentCustomizationService` removed, Main Agent popover redesign (one column, 3×2 effort grid, explicit Save/Cancel, visible disabled Save) |
| `7d7b0bbe4` | App DI smoke specs + VS Code `wizard-seed-noop.spec.ts` aligned with the `SetupRpcHandlers` constructor (no `ModelSettings`) |
| `5a1f80748` | Merge of `origin/main` (`e28076526`, #682) — clean |
| `83bdce39b` | 4 CodeRabbit fixes: multi-phase resume only on the same model, `sourceEnded` before workspace teardown, resolver cooldown/tier fallback, harness runner resolve inside `try` |
| `c96267341` | Docs: `follow-up-shared-authenv.md` + implementation-notes correction |

CodeRabbit: all 5 line comments have replies. The 4 minor ones say "Fixed in 83bdce39b". The major one (`sdk-agent-adapter.ts` ~:754, comment id 4235004185) says "deferred to a follow-up" — **the user then asked to fix it in #688; that is the uncommitted work below.** After it is pushed, post a second reply on that thread pointing to the new commit.

## Work in progress (uncommitted) — shared AuthEnv fix

Full detail with file:line: `follow-up-shared-authenv.md` → `## Status`. Summary:

- Every chat path (`chat:start`, child sessions, handover successor, `chat:continue`, `chat:resume --activate`, rewind, slash-command relaunch) gets a provider snapshot. `resolveProviderProfileForWorkspace` no longer requires an explicit workspace override.
- The slash-command relaunch had no profile at all before. `SlashCommandRunConfig` (`libs/shared` `agent-adapter.types.ts`) has a new optional `providerProfile`. `ChatSlashCommandRouterService` constructor takes the profile resolver.
- Fail closed: no snapshot + the shared env is configured for a different provider (or none) → `AuthRequiredError` → `AUTH_REQUIRED` + `providerId`. Same provider → the shared env is used (info log).
  - **Decision to confirm (deviation):** the comparison reads `AuthManager.getConfiguredAuth()` (new), not the adapter's `lastConfiguredAuth`. Reason: `AuthManager` is the only writer of the shared env and records only a successful configuration; reading adapter state would make auth-providers depend on agent-sdk.
- `ProviderProxyPool` keys by `providerId::credentialKey` instead of by workspace: same config → one shared proxy; a proxy stops when its last workspace leaves. Proxy-provider users get ONE extra local listener per proxy provider in use (pool proxy next to the strategy proxy).
- `WorkspaceProviderProfileResolver` constructor: the unused scope resolver is replaced by `AuthManager`.
- `disposeAllSessions` notifies `handoverCoordinator.sourceEnded` (shared helper `notifyHandoverSourcesEnded`).
- Kept: `initialize()` for global/app saves, `applyWorkspaceAuthChange`, the workspace-switch reconfigure.
- Files: agent-sdk (`sdk-agent-adapter.ts`, `session-lifecycle-manager.ts` + specs), auth-providers (`auth-manager.ts`, `provider-proxy-pool.ts`, `workspace-provider-profile-resolver.ts` + specs), rpc-handlers (`chat-session.service.ts`, `chat-slash-command-router.service.ts`, `chat/di.ts`, `chat-continue-slash-before-resume.spec.ts`, new `chat-session-provider-profile.spec.ts`), shared (`agent-adapter.types.ts`), and the two spec-folder docs.
- Subagent checks (one at a time): Jest auth-providers 82 + 38, agent-sdk 115 + 109, rpc-handlers chat 338 + 46; typecheck shared / agent-sdk / auth-providers / rpc-handlers pass; lint 0 errors; DI smoke Electron 19, VS Code 35, CLI 10.

## Known gaps (not in scope unless the user asks)

- `WorkspaceScopeResolver.write(…, 'workspace')` still falls back to the global key with no active path; `output-style-selection.ts:133` depends on it. (`ComputedSettingHandle.set` now guards model/effort.)
- Gateway-chat-bridge sessions (`gateway-chat-bridge.ts`) still pass no profile and use the shared env.
- One-shot workflows (`WorkspaceLlmResolver`) still fall back to the process-wide auth with a warning when no snapshot can be built.
- The curator's own provider/model settings are read globally.
- The effective-route display builds its model key from the raw `authMethod`.
- `SessionLifecycleManager.executeSlashCommandQuery` passes `authEnvOverride` with no direct spec.
- `implementation-notes.md` lines ~9 and ~31 still say chat sessions without an override get no snapshot — update them to point to `follow-up-shared-authenv.md` → Status.
- `screenshots/main-agent-popover-after-confirm-dark.png` predates the disabled-Save fix.

## Next steps (in order)

1. Read `follow-up-shared-authenv.md` → Status and `git diff` of the 18 uncommitted files. Confirm the `getConfiguredAuth()` deviation is sound.
2. **Cross-side review** (the code was written by an in-process Claude subagent → reviewer must be a CLI lane). Spawn a read-only Codex lane (`ptah_agent_list` first; load the `agent-lanes` skill), `deliverables: ["code-logic-review.md"]` in this folder, add a `## Round 2 — shared AuthEnv fix` section at the top. Focus: every chat path gets a snapshot; fail-closed correctness; proxy pool sharing/refcount/dispose races; VS Code single-workspace no regression; the write-path/side-effect trace of `AuthManager.getConfiguredAuth()`; constructor changes vs DI registration in all three hosts. Static only, no tests/builds in the lane, max 40 tool calls.
3. Fix confirmed findings (max 2 revise rounds; delegate to `backend-developer`).
4. Scoped checks yourself, per CLAUDE.md (one heavy check at a time, `--maxWorkers=2`, `--parallel=1`, no run-many/build/e2e): typecheck + changed specs for shared, agent-sdk, auth-providers, rpc-handlers; the three app DI smoke specs (`apps/ptah-electron` + `apps/ptah-extension-vscode` use `jest.config.ts`, `apps/ptah-cli` uses `jest.config.cjs`).
5. Commit (conventional style, e.g. `fix(agent-sdk): give every chat session its own workspace provider snapshot`), update `implementation-notes.md`, push, reply on CodeRabbit thread 4235004185 with the commit SHA.
6. **Main merge (required — #686 is merged, #688 has conflicts).** Do it AFTER step 5 is committed (or, if you merge first, set the uncommitted work aside safely: no bare `git stash` — the stash stack is shared across worktrees; use `git stash push -u -m <unique-tag>`, apply by SHA, drop by tag). `git fetch origin && git merge origin/main` — merge commit; NO rebase, NO force-push. Against `c96267341` the merge gives exactly 2 conflicts (verified by the previous session), plus 1 semantic break git does not mark:
   - `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`, `internalQuery.execute({...})` (~:500): resolve to `cwd: this.resolveQueryCwd(workspaceRoot),` and `model,` — keep main's hoisted `const model = this.resolveCuratorModel();` (~:494); do not call `resolveCuratorModel()` twice.
   - **Semantic (no marker):** #686 made `providerId` required on the `override` variant of `CuratorAuthDecision` (~:102-110) and `dispatchRoute` (~:441) reports it as `overrideProviderId`. #688's `inheritWorkspaceProvider` (~:299-301) returns `{ kind: 'override', auth: snapshot.auth }` → typecheck error and no provider in the provenance tap. Fix: `{ kind: 'override', auth: snapshot.auth, providerId: snapshot.providerId }`.
   - `sdk-internal-query.curator-llm.spec.ts`: both PRs append a `describe` at the end — keep BOTH (#688 `'… inherits the curated workspace provider'`, #686 `'… dispatch provenance tap'`). #688's 6th constructor arg is optional (default `null`), so #686's 5-arg `adapterWith(...)` helper needs no change. In #688's first test ("with no curator provider pinned, uses the snapshot…") add: `expect(capture.dispatch).toEqual({ providerSource: 'override', overrideProviderId: 'moonshot', component: 'memory-curator', laneId: MEMORY_CURATOR_QUERY_LANE })` — this proves the #686 tap fires on the snapshot path.
   - Run prettier on the two files. Main's merge touches many projects; typecheck (one at a time, `--parallel=1`) every project both sides changed: shared, settings-core, auth-providers, agent-sdk, agent-generation, cron-scheduler, memory-contracts, memory-curator, rpc-handlers, chat, setup-wizard, webview-e2e-harness. Then Jest (`--maxWorkers=2`) on #688's changed specs per project + the curator spec, and the three app DI smoke specs. Check the AuthEnv-fix files for overlap with #686's agent-sdk changes (`register.ts` `MODEL_DISPATCH_PROVENANCE_TAP`, curator adapter) and keep both behaviors.
7. Wait for CI (`gh pr checks 688`; one background wait loop, not a poll). Failed job logs: `gh api repos/Hive-Academy/ptah-extension/actions/jobs/<id>/logs`. Sonar: `https://sonarcloud.io/api/qualitygates/project_status?projectKey=Hive-Academy_ptah-extension&pullRequest=688`. GitHub API calls time out sometimes — retry once.
8. Report to the TASK_2026_620 coordinating session (`SendMessage` to `ptah-ptah-extension-get-620-pr-merged-eab19a000075c2q6hewm80i`, if it is still live) with head SHA, pass/fail counts, Sonar gate, open comments, and READY TO MERGE or the blocker. **Do not merge #688** — the user merges.

## Rules

- Never commit, push, merge or open a PR without the user's go-ahead in the new session, except the steps the user already approved there. (In this session the user approved commit + push on #688; merge stays with the user.)
- PR #682 and PR #686 are merged; no file-ownership split applies any more. Do not change #686's memory/skills bench and Thoth pause behavior except to resolve the merge above.
- Webview builds are allowed only when the user asks for screenshots.
