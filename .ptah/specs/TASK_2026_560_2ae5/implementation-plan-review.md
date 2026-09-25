# Implementation plan review — TASK_2026_560_2ae5

Verdict: REVISE

Reviewed requirements, research, the complete 829-line plan, the cited implementation paths, Claude SDK 0.3.278 types and Codex SDK 0.155.1 serialization. References below are worktree-relative. This is a design review, not an implementation verdict. Existing user decisions remain unchanged.

## Defects

### 1. Blocker — Toggle objects and import markers disappear on reload
- Plan: C2, lines 266–278; persistence/restart guarantee.
- Evidence: `libs/backend/platform-core/src/file-settings-manager.ts:83` reads only an exact cache key; `:460` loads through `flattenObject`; `:529` recursively flattens every plain object. `libs/backend/platform-vscode/src/settings/vscode-settings-adapter.ts:70` delegates to this manager; CLI/Electron do likewise.
- Scenario: save `{items:{'mcp:repo':false}, importedAt:...}` at the workspace key. Restart or receive an external file-watch update: the cache contains descendant keys, not the workspace object. Both the override and marker read as absent. Global maps have the same problem. Imports repeat and disabled capabilities can return.
- Fix: specify an atomic leaf encoding supported by this store, such as a versioned serialized string/array, or explicitly implement opaque-object keys in the manager. Test real manager round trips and watcher reloads, not just an in-memory `ISettingsStore`.

### 2. Blocker — Disk failures cannot reach the proposed rollback handler
- Plan: C2 failure behaviour and C8/C10 write-error reversion, lines 290–299, 581–584, 617–618.
- Evidence: `libs/backend/platform-core/src/file-settings-manager.ts:98` mutates the cache before persistence; `:497–502` catches persistence errors without rethrowing; `:103–105` subsequently reports success to listeners.
- Scenario: a permissions error or full disk prevents saving an OFF toggle. `writeGlobal` resolves, so the UI reports success, subsequent reads use the unsaved value, and restart restores the old state. An unsaved import marker also suppresses retries within that process.
- Fix: add an acknowledged, rejecting persistence operation with cache rollback/commit-after-success, wire all adapters to it, and include the manager changes in C2. Inject actual manager I/O failures in tests.

### 3. Blocker — Re-reading before writing does not make imports or toggles cross-process safe
- Plan: one-time import idempotency, lines 167–174; C2 concurrency test.
- Evidence: `libs/backend/platform-core/src/file-settings-manager.ts:83` reads a process-local cache; `:49` serializes only that instance; `:486` writes its entire snapshot; `:494` uses the same `settings.json.tmp` in every process. The watcher is delayed by 50 ms (`:37`). `ISettingsStore` has no transactional update (`libs/backend/settings-core/src/ports/settings-store.interface.ts:10–15`).
- Scenario: process A reads before import; B finishes import and saves a user's OFF; A writes its earlier ON plus marker afterward. A's `set()` awaiting its own import does not order B. Even writes to different workspace/global keys can overwrite each other, and simultaneous renames contend for the same temporary file.
- Fix: perform fresh disk read, absent-key merge/compare and durable commit inside one cross-process transaction/lock shared by every settings writer; use unique temporary files. Test interleaved import versus toggle and different-key writes across two manager instances/processes.

### 4. Blocker — Repository-controlled approvals can bootstrap their own trust
- Plan: one-time import sources and union, lines 142–153; security promise, lines 765–768.
- Evidence: `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet.registry.ts:119–130` reads repository `.mcp.json`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6538` exposes approvals by name; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:988–992` retains project/local settings sources. The proposed reader includes repository `.claude/settings.json` without a provenance/trust check.
- Scenario: a newly cloned repository contains `.mcp.json` launching a program and committed `.claude/settings.json` with `enableAllProjectMcpServers:true` (or an enabled-name list). On first resolution the plan imports these as the user's approvals, persists ON, and explicitly approves startup, despite no user approval ever occurring.
- Fix: distinguish user-recorded approval from repository-authored settings. Import repository-file approvals only after a verified prior user trust/approval decision for that workspace, or import exclusively from user-owned approval records. Add a fresh-untrusted-clone fixture alongside existing-user import fixtures.

### 5. Blocker — Enforcement deliberately fails open, including unreadable declarations
- Plan: C4 lines 395–397, C5 lines 461–465, C6 lines 517–518, C9 lines 602–604.
- Evidence: `libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts:188–195` silently turns parse/read errors into `{}`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:392–403` emits no deny keys for an empty list, while `:988–992` still enables native discovery. The display facet cannot tell the resolver that discovery failed.
- Scenario: `.mcp.json` is transiently unreadable during resolution, then readable when Claude starts with an existing enable-all setting. The server is absent from Ptah's deny set and starts. A resolver failure also restores explicitly disabled servers/ptah; C9 returns unfiltered definitions after its policy lookup fails.
- Fix: give enforcement readers an explicit unknown/error state, distinct from empty inventory. On unresolved policy, launch only a verified safe set using strict discovery suppression, or refuse the affected launch with an actionable error. Proxy collection should omit unverified tools. Logging alone does not enforce OFF.

### 6. Major — Session cwd is not the workspace policy identity
- Plan: C4 `resolve(root)`, C5 `resolve(cwd)`, C6 `resolveCapabilities(workingDirectory)`.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:250–256` explicitly permits sub-package working directories. `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:148–151` resolves them to a workspace root; `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:20–40` merely resolves/hashes the supplied path.
- Scenario: Marketplace disables ptah at `D:/repo`; a lane starts in `D:/repo/libs/backend`. The proposed resolver hashes a different workspace and reads declarations from the subfolder, so it sees default ON. Harness and SDK policy now describe different workspaces.
- Fix: specify one canonical policy-root resolver at every session boundary, preserving cwd separately. Reuse the exported harness root resolver where appropriate and pin root/subfolder, worktree and Windows path-alias cases.

### 7. Major — Discovery used for enforcement disagrees with discovery used for display
- Plan: default rule lines 127–135 versus C4 inputs lines 368–370 and `list` at 376.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:239–244` includes all facet, Claude-user, Smithery and OAuth rows; `:280–284` enumerates every target. C4's enforcement inventory omits user-global Codex/Copilot/Antigravity facets and Smithery/OAuth declarations unless represented by an intent.
- Scenario: the same name exists in `.mcp.json` and a hand-authored global Codex config, without a Ptah entry. `list` classifies it as user-scope/default ON, while `resolve` sees only the repository declaration and denies it. The UI and spawned lanes disagree about the effective set.
- Fix: use one declaration/provenance inventory for both resolution and display, retaining target-specific definitions. Test identical effective results from `list` and `resolve` for every supported source combination.

### 8. Major — Plugin/skill writes do not accept the resolved workspace root
- Plan: C4 `set(root,...)` delegates to `saveWorkspacePluginConfig`; C3 changes only its optional fields.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:707–708` can read an explicit root, but `:760–768` accepts no write root, `:777` reads the active config, and `:791` updates active `workspaceState`.
- Scenario: a request resolves workspace A, then the active workspace changes to B during awaited import/inventory work. The handler computes A's list changes but saves them into B; recomputing A's entry can even report the old state after corrupting B's configuration.
- Fix: add an optional explicit workspace root to the save operation, capture `storageFor(root)` for the complete operation, and preserve old callers' active-scope behavior. Add an A-to-B switch-during-save test.

### 9. Major — Parent plugin OFF is not carried through the session/proxy contract
- Plan: C4 disabled lists, C5 `CapabilityFlagInput`, C9 filters.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1143–1156` excludes disabled plugins only from harness paths; `:944` returns the skill denylist separately. `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:111–139` enumerates all listed plugins and requests their skills. SDK native plugin control exists at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6964–6969`.
- Scenario: turn a plugin OFF while its child skills have no explicit OFF entries. The planned per-skill C9 filter still exposes those skills because their default is ON. C5 receives no `disabledPluginIds`, so it also has no fallback for an existing native plugin or stale copied skills when harness cleanup has not occurred.
- Fix: define parent-disabled behavior explicitly; exclude children of disabled plugins in every consumer. Translate plugin identities into native `enabledPlugins:false` where applicable, and expand affected skill invocation names for Claude fallback filtering. Label unsupported native inventories honestly rather than claiming full plugin enforcement.

### 10. Major — Harness preflight is not proof that disabled copies were removed
- Plan: C6 lines 506–514 and integration lines 697, 722 rely on preflight for full skill/plugin enforcement.
- Evidence: `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:85` throttles for 60 seconds; `:167–171` can skip the pass and stamps before completion; `:201–209` continues on timeout. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:419–429` ignores failure.
- Scenario: workspace B recently ran a preflight; a global plugin OFF is saved from A. C8 reconciles A only. A new B lane within the throttle window loads B's old copies. A failed reconcile can leave them indefinitely even though the enforcement table says enforced.
- Fix: include the effective capability revision in preflight freshness, invalidate affected workspaces after global changes, and require acknowledged cleanup or a provider-native deny fallback. Test skipped, timed-out and failed reconciliation before claiming enforcement.

### 11. Major — Skipping Antigravity setup must also skip its cleanup
- Plan: C6 line 504 says to skip the per-run ptah write when OFF.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:628–634` captures the prior entry only during setup; `:826–829` independently schedules cleanup whenever `mcpPort` exists; `:573–579` removes the global key when prior is undefined.
- Scenario: implement the specified setup guard, leave `mcpPort` set, and finish an OFF lane. No prior entry was captured, so cleanup deletes the persistent global ptah entry used by other workspaces. This is separate from the explicitly accepted not-enforced limitation.
- Fix: track successful setup/ownership and guard restoration with that same state. Test OFF lanes leave the global file unchanged both at launch and at exit, including alongside an ON lane.

### 12. Major — Codex configuration-name handling is not the claimed safe contract
- Plan: C6 lines 496–498 and integration lines 706–707.
- Evidence: `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:423–428` splits table headers at the first dot without TOML quoted-key parsing. `node_modules/@openai/codex-sdk/dist/index.js:346–350` interpolates map keys into dotted paths without quoting; `toTomlValue` protects values, not these path segments.
- Scenario: a valid config table `[mcp_servers."team.search"]` is discovered with the wrong name and/or emitted as an override for nested `team.search`, leaving the real server enabled or producing invalid config. RPC's proposed control-character check does not prevent this.
- Fix: use a TOML-correct discovery path and explicitly quote each override path segment, using the SDK's raw config override facility where needed. Test quoted names, dots and whitespace through actual serialized arguments.

### 13. Major — Native SDK model discovery remains outside the policy boundary
- Plan: C5's assertion that every Claude SDK session is covered.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:817–842` starts a separate `query()` with user/project/local sources and only `PTAH_DISABLE_SDK_AUTO_MEMORY`; it does not use the main builder or one-shot runner. Its cwd is the home directory (`:833`).
- Scenario: globally disable a user-configured MCP server, then refresh the native Claude model list. This query still permits native MCP discovery independently of the capability resolver.
- Fix: make metadata probes explicitly tool-free/discovery-free (`strictMcpConfig` plus an empty map, with plugins/skills appropriately suppressed), or route them through the same policy builder. Include this file and a probe-options assertion in the inventory.

### 14. Major — The proxy cache can re-expose an OFF capability in the next session
- Plan: C9 adds filtering but no cache policy change; AC-4.9 applies to the next session.
- Evidence: `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:89–91` returns cached tools before any RPC; `:152–154` caches them for ten seconds by workspace only.
- Scenario: collect with a server ON, switch it OFF, immediately start a new session in the same workspace. The collector returns its old tool definitions without checking the new policy.
- Fix: key/cache collections by a policy revision or filter the cached inventory against a current session capability snapshot. Invalidate on local and cross-process changes, and test a new session inside the TTL.

### 15. Major — Cached schema figures violate the explicit no-stale-number criterion
- Plan: C7 lines 543–550 returns cached success on no session, timeout or rejection; C8 attaches it to enabled entries.
- Evidence: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2843–2854` measures a particular query's context; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:56–64` gives each query a distinct registration token/config. C7 keys only by workspace, not that identity or server definition.
- Scenario: measure server X, end that query, change X's config or let its next connection fail, then open Marketplace. It shows the previous numeric figure instead of AC-5.2's “size unknown”; the total includes it too.
- Fix: attach query/config identity and connection validity to figures, invalidate on replacement/failure and return unknown when no current measurement exists. If historical figures are useful, show them separately as historical, excluding them from the current total.

### 16. Major — Adding scope to rows cannot recover declarations already discarded
- Plan: C4 only adds `scope` to `McpInstallService` rows; resolution requires all source scopes and the winning definition.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:90–106` stores user entries by name and then overwrites them with project entries. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:252` deduplicates by origin/path/name without scope.
- Scenario: `~/.claude.json` contains the same name in its user and project maps with different definitions. Only the project row survives; adding its scope cannot display “Global + Workspace” or explain the overridden definition as AC-2.1/2.5 require.
- Fix: preserve declarations with scope/location identity separately from winner selection, and include scope in downstream deduplication. Test duplicate names in both maps of the same file.

## Verified claims and limits

- Claude SDK 0.3.278 really defines `enabledMcpjsonServers`, `disabledMcpjsonServers`, `skillOverrides` and cross-scope `deniedMcpServers` (`sdk.d.ts:6538–6600`). `:6897` confirms denials merge across sources. Their existence is verified; the proposed live direct/proxied A1/A2 checks still need execution, including explicit ON after a previously imported/native OFF.
- The existing builder emits both denial forms (`sdk-query-options-builder.ts:392–396`), receives only back-off names (`:914–961`), and merges caller MCP overrides last (`:1549–1556`). Direct and custom-base-URL builds share that flag-settings call.
- The one-shot and Ptah CLI injection sites cited by C5 exist (`sdk-query-runner.service.ts:394–442`; `ptah-cli-registry.ts:787–822`). Rival lanes share `AgentProcessManager`'s options boundary (`agent-process-manager.service.ts:336–356`).
- SDK summary context usage and per-server tool-token fields exist (`sdk.d.ts:2846–2854`, `:3768–3773`). No server-spawning measurement service is necessary for that source, but A5's same-method accuracy claim remains unproven.
- The new agent-sdk → settings-core edge is permitted: `eslint.config.mjs:260–261,365–372`, `libs/backend/agent-sdk/project.json:7`, `libs/backend/settings-core/project.json:6`. Inspection found no settings-core reverse import of agent-sdk/harness-sync/cli-agent-runtime/vscode-core. Shared wire types and platform-port logging preserve the proposed boundaries.
- The existing workspace hash/write separation is real (`workspace-scope-resolver.ts:34–40,197–229`); the plan correctly avoids using active-only writes for arbitrary MCP roots.
- The listed component counts total 82 before optional fixtures/task documents. The current estimate fits the cap, but persistence and identity fixes require re-counting; moving mandatory lane enforcement to a later PR must not be described as completing this task.
- Read-only verification: executed the actual file-manager class after TypeScript transpilation with an in-memory filesystem substitute. Reproduced missing object keys after reload, a resolved write despite injected EACCES, and loss of another manager's unrelated key. No source or user settings were written. Scoped `ptah_get_diagnostics` for the builder reported zero errors. No live provider sessions, network requests, or workspace-wide checks were run. File/AGENTS/CLAUDE searches returned no applicable instruction files; native reads supplemented the available AST tool.
