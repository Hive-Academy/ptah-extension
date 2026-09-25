# Implementation plan reviews - TASK_2026_560_2ae5

All four design-review rounds, merged into one file by budget lever L1 (batches.md, running count).
Each round below is the original file's content, verbatim, under its own heading.

## Round 1 (was implementation-plan-review.md)

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

## Round 2 (was implementation-plan-review-r2.md)

# Implementation plan review — round 2

Verdict: REVISE

Reviewed the complete revised plan (655 lines). RESOLVED means the design now specifies an adequate correction, not that unimplemented code has passed testing. D1–D3 and Q1 are unchanged. All paths are worktree-relative; plan line numbers refer to `implementation-plan.md`.

## Original findings

| Defect# | Status | Evidence |
| --- | --- | --- |
| 1 | RESOLVED | C2, plan 210–225: dedicated JSON document, fresh reads, real round-trip tests. This avoids `libs/backend/platform-core/src/file-settings-manager.ts:460–464,529–535`, which flattened the former object values. |
| 2 | RESOLVED | C2, plan 217–226: no premature cache mutation; rename errors reject. `libs/backend/harness-sync/src/lib/fs/atomic-write.ts:50–70` really rethrows final errors and cleans the temporary file. Export exists at `libs/backend/harness-sync/src/index.ts:296`. |
| 3 | PARTIAL | C2/import, plan 140–143,217–230, replaces cached read/write with locked fresh transactions. Helpers are exported at `libs/backend/harness-sync/src/index.ts:115–121`; unique temporary names exist at `fs/atomic-write.ts:36–40`. However, `lock/file-lock.ts:157–218,298–310` is not safe against lock-initialization/ownership races and is not reentrant. N1/N2 below. |
| 4 | RESOLVED | Import, plan 123–137, excludes tracked local settings, committed project settings and unscoped global approvals. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:109–129` supplies the per-project matching precedent. Argument-array git execution is feasible in this Node backend (`cli-agents/cli-adapters/cli-adapter.utils.ts:8–12,280–290` already uses process spawning); `git --version` succeeded. Distinguish expected “not tracked/not ignored” exit statuses from git failures as the plan requires. The proposed git checks themselves are not implemented or live-tested here. |
| 5 | PARTIAL | Fail-closed policy/C4/C5, plan 147–165,263–264,335–337, closes the MCP-discovery hole using status-bearing readers and `strictMcpConfig`. The installed SDK supports this (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2193–2200`). It does not suppress unknown disabled skills/plugins; C3 explicitly treats failed global policy as empty. N3. |
| 6 | PARTIAL | Policy root/C4, plan 94–96,293, fixes subfolder identity using the exported root resolver (`libs/backend/harness-sync/src/index.ts:86`; `src/lib/workspace/workspace-root.ts:66–85`). But folding the physical root on every Darwin filesystem introduces a new path failure. N7. |
| 7 | RESOLVED | C4, plan 269–285, makes all facets, Claude, Smithery and OAuth one inventory for display and resolution. This covers the disparate sources currently joined by `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:239–244,280–284`. Parity tests are specified. |
| 8 | RESOLVED | C3, plan 241–254, captures explicit-root storage for both read and update. That directly addresses the existing active-only write at `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:777–791` while reusing `:661–679` for scoped storage. |
| 9 | RESOLVED | Resolution/C4/C5/C9, plan 105,281–282,327–331,464–466, explicitly propagates parent OFF into bare/qualified skill denials and the proxy's parent filter. Existing child identity is available at `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1228–1235`; current proxy enumeration is at `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:111–139`. Native inventories are explicitly marked unmanaged rather than represented as covered. |
| 10 | PARTIAL | C5/C6, plan 339–340,377–381, adds forced preflight and honest partial labels for rivals. `IHarnessPreflight` already accepts force (`libs/backend/agent-sdk/src/lib/harness/harness-preflight.port.ts:30–50`). But a non-null report is not successful cleanup, force can join an older pass, and workspace skill writes do not change the file revision. N4. |
| 11 | RESOLVED | C6, plan 391–404, now gates cleanup on successful setup ownership. This directly covers `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:628–634,826–829,573–579`. Launch/exit/concurrent-lane tests are specified. |
| 12 | RESOLVED | C4/C6, plan 265,383–401, specifies quoted TOML header parsing and pre-quoted SDK key segments. The latter fits the actual verbatim join at `node_modules/@openai/codex-sdk/dist/index.js:346–350`; the former corrects `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:423–428`. Actual serialized-argv tests cover the boundary rather than only an object assertion. |
| 13 | RESOLVED | C5, plan 342,357, adds strict empty MCP configuration and an empty skill set to the independent model probe at `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:829–842`. SDK strict-MCP and skill filter contracts exist at `sdk.d.ts:2193–2200,2157–2174`. |
| 14 | RESOLVED | C9, plan 462–469, checks policy before every cache hit and filters cached inventory. This directly replaces the bypass at `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:89–91`; the TTL test is specified. Preserve known ptah OFF when filtering an unverified result, consistently with plan 152–153. |
| 15 | PARTIAL | C7, plan 416–429, removes cross-session reuse and returns unknown on measurement failure. But its connection source only reports session init; it does not establish current connection validity. N5. |
| 16 | RESOLVED | C4, plan 266–271,308–311, preserves declarations separately from winner selection and includes scope in deduplication. This directly fixes `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:90–106` and `mcp-install.service.ts:252`. |

## New defects and remaining defects in the replacement mechanisms

### N1 — blocker — The reused lock can admit two owners
- Plan: review resolution #3; C2, lines 217–230.
- Evidence: `libs/backend/harness-sync/src/lib/lock/file-lock.ts:159–162` creates an empty file before writing its payload; `:188–203` immediately deletes an unreadable/unparseable payload; `:200` checks age only, not whether the owner is alive; `:216–218` releases by unconditional path deletion. `withFileLock` also allows the task to run on `no-lock-directory` (`:303–308`).
- Failing scenario: A creates the lock and is descheduled before writing its payload. B reads the empty file, removes it and acquires a new lock. A resumes and enters its transaction too; A's eventual release can delete B's lock. A live holder paused beyond 30 seconds can similarly lose ownership. Atomic renames then lose acknowledged toggle updates.
- Fix: harden the primitive or use a proven cross-process locking implementation before relying on it for capability policy. Require acquired ownership, safe initialization/stale handling, ownership-checked release and a live-owner/lease strategy. Add deterministic two-process interleaving tests, not merely two sequential store instances. Include helper changes in the file budget.

### N2 — major — Import and mutation acquire the same non-reentrant lock twice
- Plan: import lines 140–143 and integration 535–537 say `set` holds the lock while awaiting `ensureImported`; C2 lines 217–218 says `importWorkspace` and setters acquire that lock themselves.
- Evidence: `libs/backend/harness-sync/src/lib/lock/file-lock.ts:234–264,298–310` has no reentrancy/owner token and times out while a fresh lock exists. Its separate `serializeByKey` queue (`:135–150`) does not make nested locking reentrant either.
- Failing scenario: first toggle in a workspace takes the outer lock, calls `ensureImported`, and awaits `importWorkspace`, which waits for the outer lock. It fails after the timeout; similarly, calling a locking setter inside the described outer transaction repeats the problem.
- Fix: define one transaction owner. Inside it use explicit non-locking read/mutate helpers over the already-read document, or finish an independently locked import before a separately locked mutation that re-reads and preserves current state. Do not hold the lock while awaiting a single-flight promise whose completion needs that lock. Test the first `set`, not just first `resolve`.

### N3 — blocker — “Unverified” still widens the skill/plugin set
- Plan: C3 lines 248–249; fail-closed policy lines 151–154; security line 561.
- Evidence: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2193–2200` limits strict mode to MCP configurations; `:6548–6551` says absent skill overrides mean ON. `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1143–1156` derives copied plugins from the effective configuration, which C3 now defaults to an empty global layer on read failure.
- Failing scenario: a plugin is globally OFF, then `capability-toggles.json` becomes unreadable. C3 can restore its default-enabled harness copies and C5 knows no names to deny. Claude starts with strict MCP but still discovers those skills. The advertised fail-closed guarantee therefore covers only part of the requested policy.
- Fix: distinguish unknown skill/plugin policy from an empty layer. Preserve a validated restrictive snapshot or suppress all discoverable skills/plugins on that path using the supported native controls; if complete suppression cannot be guaranteed, refuse the affected launch. Do not reconcile unknown state as “no exclusions.” Test corrupt-store behavior for a previously disabled plugin and its children.

### N4 — major — The revision acknowledgement does not identify a successful pass over that policy
- Plan: C2 revision lines 217–218; C3 workspace writes 241–245; C5 lines 339–340; C6 lines 377–381.
- Evidence: `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:157–159` joins an existing pass before checking force. A non-null `HarnessHealth` can contain `writeFailed`, missing content or unavailable sources (`libs/shared/src/lib/types/harness-sync.types.ts:134–137,159–169,185–189`). Workspace `PluginConfigState` writes currently update only workspace storage (`plugin-loader.service.ts:783–791`); the revision is specified only for the separate capability file.
- Failing scenario: revision R's reconcile is running when an OFF produces R+1. The forced call joins R's pass, returns non-null, and C5 records R+1 as applied. Alternatively, failed deletion returns a non-null error report and is acknowledged. A workspace skill OFF may not change the revision at all, especially through the existing CLI save path, so a failed immediate propagation is followed by a throttled next session.
- Fix: include every effective input, including `PluginConfigState`, in a policy generation/fingerprint. Bind acknowledgements to the actual snapshot processed and successful target-specific cleanup; a joined older pass must trigger a subsequent pass. Apply that contract to Ptah CLI preflight too (`ptah-cli-registry.ts:657–659` currently runs before assembly resolves policy). Test concurrent revisions, non-null failure reports and legacy CLI writes.

### N5 — major — Init-time status cannot validate a live schema figure
- Plan: C7 lines 418–422, claimed resolution #15.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:519–530` publishes `servers` once at init; `session-mcp-status-callback-registry.ts:29–33` documents that limitation. `callback-registry.base.ts:22–44,51–52` is an event fan-out, not a current-state query. The SDK provides a current query at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2836–2841`.
- Failing scenario: a server reports connected at init, is measured, and disconnects during the same query. Its stored init status still says connected; a later successful context estimate or memoized result can show a number when AC-5.2 requires unknown. Conversely, pending-at-init followed by connection can remain unknown forever.
- Fix: obtain bounded current `mcpServerStatus()` alongside measurement, or introduce a real continuously updated status source. Recheck session token/connection validity after awaits and invalidate memoized figures on disconnect/reconfiguration. Add a same-session connected-to-failed test.

### N6 — major — The install path does not always write the promised explicit ON
- Plan: new install rule lines 12–13,109–111 and C8 lines 444–445 calls generic `set`; generic workspace writes at 107 remove values equal to the inherited default.
- Evidence: the existing install inventory can contain the same key across targets (`libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:246–255,280–284`). The installed SDK has separate project approval settings (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6538–6542`), and plan 280 approves only explicit/imported ON entries.
- Failing scenario: a name already exists in global Codex configuration, making its inherited default ON. Install that server into workspace `.mcp.json`. Calling `set(..., true)` clears the workspace entry instead of recording explicit ON; the resolver therefore omits it from `approvedProjectMcpServers`. With native project auto-approval off, the just-installed server is not approved despite the new install guarantee.
- Fix: give install acknowledgement an explicit-ON mutation that retains a workspace entry even when equal to the inherited value, while preserving normalization for ordinary toggles. Test a workspace install with a same-name user-scope declaration and native auto-approval off.

### N7 — major — Case-folded policy identity is reused as a physical path
- Plan: policy-root rule lines 94–96 and C4/C8 pass that root to file reads, git and storage resolution.
- Evidence: `libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:66–85` preserves the resolved filesystem path; `:112–116` folds comparisons only on Windows. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:175–182` uses folding for matching JSON keys, not for opening those paths. `JsonMcpFacet.configPath` joins the supplied root directly (`libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts:85–90`).
- Failing scenario: `/Volumes/CaseSensitive/Repo` on case-sensitive APFS becomes `/volumes/casesensitive/repo` on Darwin. Declarations look missing, git checks fail, and two distinct `Repo`/`repo` workspaces can share one policy key.
- Fix: keep the real/canonical filesystem path separate from the comparison/storage identity; do not assume all Darwin volumes are case-insensitive. Test distinct case-sensitive roots and preserve physical paths for every I/O operation.

## Verification and delivery limits

- Reused earlier repository/type-contract evidence and re-read the replacement helpers, preflight contract/implementation, status producer/registry and changed plan sections. Executed the actual lock helper after transpilation with an in-memory filesystem substitute: it stole a fresh empty lock, removed a replacement owner's lock on release, and rejected nested acquisition with `FileLockTimeoutError`. No test files or user data were created.
- Atomic-write export, final-error propagation and `<path>.<pid>.<sequence>.tmp` naming are verified. These solve atomic replacement, not mutual exclusion. No new dependency cycle is required by placing the store in cli-agent-runtime; agent-sdk consumes the shared interface/token instead of importing harness-sync.
- The split now explicitly keeps the task incomplete until both PRs merge (plan 631–635), resolving the previous delivery concern. The stated 79/10 code-file arithmetic is consistent, but N1/N4 and their tests require a revised count before asserting PR 1 remains below 100. PR 1 must retain its explicit not-enforced rival labels.
- No live provider sessions or A1–A5 checks were run. No source changes, git state changes, or workspace-wide checks were made. This final design review does not claim implemented behavior or approval of untested SDK runtime assumptions.

## Round 3 (was implementation-plan-review-r3.md)

# Implementation plan review - final round

Verdict: REVISE

Reviewed the 497-line plan. RESOLVED means adequately specified in the design, not implemented or runtime-tested. Remaining items below go to the user; no further architecture round is presumed. Paths are worktree-relative. `P` = `implementation-plan.md` in this task directory; `H` = `libs/backend/harness-sync/src`; `A` = `libs/backend/agent-sdk/src`; `C` = `libs/backend/cli-agent-runtime/src`; `SDK` = `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

| Item | Status | Evidence |
| --- | --- | --- |
| N1 | PARTIAL | C2a, P:165-198 improves publication, required acquisition and ownership checks. Existing `H/lib/lock/file-lock.ts:159-162,200-218,303-308` needs all those changes. The replacement still permits ownership races and an unsafe timed fallback; see residual N1 below. |
| N2 | RESOLVED | Import/C2, P:109-112,208-210,277-279 specifies completed import followed by a separate fresh transaction with pure mutators. This avoids the non-reentrant acquisition at `H/lib/lock/file-lock.ts:234-264,298-310`. First-set regression is explicitly required. |
| N3 | RESOLVED | Unverified/C3/C5, P:114-134,227-243,304 suppresses Claude skills, freezes managed copies, and refuses rival launch in PR 2. `SDK:2160-2174` supports an empty explicit skill set; `SDK:2193-2200` supports explicit-only MCP. This is a context filter, not file-access isolation, as `SDK:2163-2166` states. Live A2 remains a release check. |
| N4 | RESOLVED | Fingerprint/C5a, P:33,153-154,294-308 ties acknowledgement to processed inputs, includes PluginConfigState, rejects failed health and re-passes a mismatch. This addresses joining before force at `H/lib/preflight/harness-preflight.service.ts:157-162` and the separate storage update at `A/lib/helpers/plugin-loader.service.ts:783-791`. The existing API returns only health, not a joined flag (`preflight.service.ts:140`); the fingerprint-mismatch branch is implementable without adding that flag. |
| N5 | RESOLVED | C7, P:376-383 queries current status with bounded measurement and rechecks session identity. `SDK:2836-2852` supplies both methods; it replaces init-only status from `A/lib/helpers/stream-transformer.ts:519-530`. Same-session disconnect coverage is specified. Delivered in PR 2. |
| N6 | RESOLVED | Resolution/C4/C8, P:96-98,264,281,337 adds retained explicit workspace ON for install. This addresses same-name multi-source inventory at `C/lib/mcp-directory/mcp-install.service.ts:246-255` and separate native approval keys at `SDK:6538-6542`. |
| N7 | RESOLVED | Root/C4, P:81-85,268-269 separates physical I/O path from Windows-only folded identity. This matches `H/lib/workspace/workspace-root.ts:66-85,112-116`; `H/lib/targets/mcp/json-mcp-facet.ts:85-90` receives the physical path. Case-sensitive roots are tested explicitly. |
| #3 | PARTIAL | C2, P:203-211 supplies fresh, single-owner import/marker transactions and rejecting writes. Atomic replacement really rethrows (`H/lib/fs/atomic-write.ts:50-70`) and has unique temp names (`:36-40`). Mutual exclusion still depends on residual N1. |
| #5 | PARTIAL | Unverified/C3 resolves the skills/plugin widening defect (N3). C4, P:253 still cannot obtain an error by wrapping the swallowing Codex reader at `H/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110,187-194`; see N9. |
| #6 | RESOLVED | Root/C4, P:81-85,259-269 uses the exported workspace resolver and physical root consistently (`H/index.ts:86`; `H/lib/workspace/workspace-root.ts:66-85`). Import, git, storage and SDK calls no longer use a lowercased Darwin pathname. |
| #10 | RESOLVED | C5a/C6, P:294-308,370-372 gives policy-specific acknowledgement and honest rival partial enforcement. Current force support exists at `A/lib/harness/harness-preflight.port.ts:30-50`; Ptah CLI ordering explicitly corrects `C/lib/ptah-cli/ptah-cli-registry.ts:657-659`. This resolution assumes the locking defect is fixed before concurrent writes are called safe. |
| #15 | RESOLVED | C7, P:376-383 replaces init-only validity with `SDK:2841` current status, token/config memo identity and timeout-to-unknown. P:351,446 explicitly keeps numeric measurements out of PR 1. |

## Remaining N1 - blocker - publication safety does not make lease recovery safe

- Section: C2a, P:171-184; existing primitive being replaced: `H/lib/lock/file-lock.ts:181-218`.
- Scenario: cross-host holder A checks its token for release and pauses. B expires A's lease, takes `.break`, renames A's lock away, then acquires the vacant path. A resumes its deletion and deletes B's lock. Checking the token before a separate unlink is not conditional unlink. The same gap exists between refresh's token check and rename: a displaced A can overwrite B's lock. Only breakers take `.break`, so the assertion at P:182 is false for release and refresh.
- Further failure: even perfectly serialized token operations cannot let an expired holder resume its protected JSON write after B has committed without fencing the write. The five-second fallback also reproduces the original empty-file race when A pauses longer than five seconds between `open('wx')` and payload write (`file-lock.ts:159-162`); the planned test only waits within the grace (P:192).
- Fix: use a proven process-lock primitive with a clearly bounded filesystem support contract, or specify a protocol that coordinates all ownership transitions and fences displaced writers before commit. Reject unsupported acquisition rather than substituting a timed empty-file guess for C2's required lock. Add deterministic pauses between check/delete, check/rename, lease loss/commit, and beyond the fallback grace. Existing P:194 tests displacement before release, which does not cover displacement inside release.

## New findings

### N8 - major - PID existence cannot establish owner identity

- Section: C2a, P:168,173,188; replacing `H/lib/lock/file-lock.ts:161,186-200`.
- Scenario: the lock owner crashes; its PID is reused, including after a reboot, by a long-running unrelated process on the same host. `kill(pid, 0)` succeeds, so the proposed same-host rule never reclaims the orphan. Every toggle write times out until that unrelated process exits. A UUID in the file does not identify the process answering the PID probe.
- Evidence: [Node's process contract](https://nodejs.org/api/process.html#processkillpid-signal) tests existence, not process creation identity. There is no birth/boot identity in P:168's payload.
- Fix: use verifiable process-instance identity or an OS-owned lock that is released on process death; define a safe recovery path when identity cannot be proved. Never kill the PID to reclaim this lock. Test an orphan whose PID now belongs to another process.

### N9 - major - the PR 1 Codex inspection wrapper cannot report read failure

- Section: C4, P:252-253,283-288.
- Evidence: `H/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110` calls `readFile`; `:187-194` catches every read error and returns empty text. Wrapping `readAll` observes an empty map, not EACCES. This facet is also absent from C4's PR 1 file list; only its PR 2 parser edit is budgeted (P:373).
- Scenario: the global Codex configuration becomes unreadable. The shared inventory reports no declarations instead of unverified; Marketplace silently loses sources and the resolver treats an incomplete inventory as verified, contrary to P:114. Rival not-enforced labels do not repair shared discovery.
- Fix: add a status-bearing low-level read that distinguishes ENOENT from other errors, use it in PR 1 `inspect`, retain compatibility for legacy `readAll`, and include the facet and an EACCES regression in the PR 1 budget. Quoted-key parsing can still remain in PR 2.

## Windows and existing-caller compatibility

- The successful-link publication step is appropriate for one local supported filesystem: the initialized file is published before contenders can read it; EEXIST must be treated as contention. [Node documents linkSync](https://nodejs.org/api/fs.html#fslinksyncexistingpath-newpath); [Microsoft documents same-volume hard links, NTFS and sharing restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw). These contracts do not validate the later lease/release algorithm.
- A6 remains untested on actual NTFS/APFS, antivirus interference and OneDrive-backed homes. EPERM is not proof that hard links are unsupported; permission/sharing failures need bounded failure and diagnostics. Inference: separate cloud-synchronized copies do not become one atomic cross-host lock merely because each local copy supports hard links. Either exclude that topology or use actual shared coordination.
- Keeping `requireLock` opt-in preserves the old `withFileLock` API (`H/lib/lock/file-lock.ts:298-310`) and `acquireWorkspaceLock` handle contract (`H/lib/lock/workspace-lock.ts:57`). It does not make all existing consumers exclusive: `H/lib/reconciler/harness-reconciler.service.ts:393-423` logs and writes without an acquired handle; removal at `:277-317` and repair at `H/lib/repair/blocked-repair.service.ts:206-214,287-290` also proceed. This is existing behavior, not a newly introduced finding, but compatibility must not be described as a cross-process safety guarantee for those callers.
- Mixed-version callers also need a rollout test: the current `file-lock.ts:200-203,216-218` ignores the new token and can break/release by path. Upgrading one host does not retrofit a concurrently running old host. No source edits to these callers were made during review.

## PR 1 honesty and verification limits

- Schema deferral is honest: C8/P:336 and C10/P:351 always produce "size unknown" in PR 1; AC-5.x explicitly completes in PR 2 (P:446).
- #12 is assigned to C4b/P:373 and rival enforcement to C6/P:370-372, with PR 1 "not enforced" at P:150,350. Proxy deferral is stated at P:478-480, although C1/C10's detailed lists mention only rivals; retain the explicit proxy label in implementation and UI tests.
- #16 is explicitly deferred, and AC-2.1 names C4c/PR 2 (P:429). The old reader really collapses duplicate scopes (`C/lib/mcp-directory/claude-user-mcp.reader.ts:90-106`). PR 1 cannot claim complete source-scope coverage; its release notes/UI must disclose this limitation. AC-2.5's C1 unit rule (P:433) is not evidence of complete end-to-end inventory coverage; its UI verification must include C4/C10 and the PR 2 duplicate fixture. The two-PR split itself is accepted.
- No live SDK/provider sessions, filesystem mutation probes, builds or tests were run in this read-only review. Installed SDK types and current source support the resolved design contracts; A1-A6 remain execution gates. Only this deliverable was written. No git state was changed.

## Five logic questions - final disposition

1. Silent success: residual N1 can lose an acknowledged toggle; N9 can return a success-looking empty inventory.
2. Unexpected user action: the first toggle no longer nests locks (N2 resolved); a toggle after owner crash/PID reuse still times out (N8).
3. Wrong-answer input: unreadable Codex config is currently indistinguishable from empty input (N9); duplicate source coverage is explicitly PR 2.
4. Dependency failure: unknown policy is restrictive by design (N3 resolved); unsupported/blocked link creation must not fall back to residual N1's unsafe grace protocol.
5. Missing operational contract: displaced writers, mixed-version hosts and synchronized-home topology still need explicit safe handling before concurrency approval.

## Delta review (was implementation-plan-review-delta.md)

# Implementation plan delta review

Verdict: REVISE

Scope: changed store, error handling, fingerprint and disclosure sections only. RESOLVED means adequately specified, not implemented. `P` denotes this task's `implementation-plan.md`; `H` denotes `libs/backend/harness-sync/src`. The approved lock-free architecture and earlier resolved items are not reopened.

| Item | Status | Evidence |
| --- | --- | --- |
| Residual N1 | RESOLVED | P:29,61-67,182-189 removes locks from capability writes and drops C2a. The ownership operations at `H/lib/lock/file-lock.ts:181-218` are no longer dependencies of the new store. Ordinary updates use atomic replacement at `H/lib/fs/atomic-write.ts:50-70`. Import has a different publication defect, D1 below. |
| N8 | RESOLVED | P:29,164-189 has no PID-based owner or stale recovery. PID remains only a temporary-name component (`H/lib/fs/atomic-write.ts:39-41`), so PID reuse no longer strands a capability lock. |
| N9 | RESOLVED | C4, P:271-275,303,312 specifies direct status-bearing reads and an EACCES test in PR 1 while retaining legacy behavior. It explicitly bypasses the error-swallowing read at `H/lib/targets/mcp/codex-toml-mcp-facet.ts:187-194`. |
| #3 | PARTIAL | C2, P:182-198 avoids shared-document lost updates, but interrupted exclusive creates are permanently skipped and the marker can certify attempted rather than completed imports. D1 prevents approval of crash recovery and migration completeness. |
| #5 | PARTIAL | C4 closes N9; C2/P:205-206 makes malformed non-empty items unverified. However P:194-195 treats empty import artifacts as absent, which can discard an imported OFF and restore an ON default. D1 remains a fail-closed gap. |

## New store defects

### D1 - blocker - interrupted imports can permanently discard OFF decisions

- Section/evidence: C2, `P:191-198,230-232`; defaults at `P:84-90`. Exclusive creation precedes payload writing, existing files are skipped, and the marker follows attempts. This is not the complete-payload publication used by `H/lib/fs/atomic-write.ts:58-63`.
- Scenario: import plans OFF from `disabledMcpjsonServers`. A creates the file and dies before writing. B retries, skips the empty file on EEXIST and writes the marker. Every later read treats the file as absent. A repository-only name remains OFF, but a same-name user-scope declaration or global ON makes effective state ON; the trusted disabled decision was lost. For imported ON, the approval is permanently lost even in the repository-only case.
- Partial payloads are also visible to concurrent readers. A reader fails closed while a write is incomplete, which is safe; after a crash, that non-empty fragment remains unverified indefinitely because retries skip it. A second importer can publish the marker while the first importer still holds an unfinished item. Marker creation itself also needs a defined crash/empty-payload rule.
- Fix: publish complete import payloads atomically without overwriting explicit user state, and mark completion only after every planned entry is valid or superseded by a valid user decision. Treat incomplete publication as unknown, not default. Do not repair by unconditional delete/rewrite, which would race a user replacement. Test interruption before the first byte, during the payload, before marker completion, and an imported OFF whose inherited value is ON.

### D2 - blocker - hashed and literal IDs share a filename namespace

- Section/evidence: C2, `P:171-179,205-206`. Literal `h_` is allowed, and the long-ID fallback uses the same prefix without a reserved namespace.
- Concrete collision: ID `x` repeated 121 times hashes to suffix `79072a47bfaa54e6057a9ee21e0dea64b9edbfd1`. The distinct short ID `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` stays literal. Both map to `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`. Computed with SHA-256 in memory during this review; no filesystem probe was needed.
- Scenario: toggling either server overwrites the other's file; clearing either deletes the other's decision. The content/filename check does not catch this because both IDs legitimately generate that filename. An OFF can silently disappear.
- Fix: use disjoint filename namespaces, e.g. tag every literal encoding and every hash encoding differently, then validate the complete canonical filename from content. Add the exact long/literal pair above to the codec and independent-toggle tests. Ordinary percent encoding correctly distinguishes case and escapes reserved characters; this defect is the fallback namespace, not percent decoding.

## Remaining checks and explicit limitations

- **Clear/import exception:** P:199-201 openly allows stale import to undo a clear. Example: global OFF, old imported ON, another process clears to inherit OFF, delayed import restores workspace ON. This is broader than simultaneous user clicks: the later writer is replaying an older approval. It is an acknowledged limitation, not proof that the current decision is preserved. Marker-last retries mean the window can persist through repeated failures, not just one process lifetime. If clear must supersede migration, retain an explicit inherit tombstone or separate imported state below explicit user decisions. The approved per-item architecture does not require this exception.
- **Concurrent source snapshots:** P:197's claim that two imports necessarily have identical plans is not established: they read mutable approval/declaration files separately (P:98-104). Different snapshots can compete per item. Define that outcome explicitly and test it; do not claim order-independent migration when sources change during import.
- **Windows writes:** P:182-185,226 correctly requires retry then rejection through RPC/UI. `H/lib/fs/atomic-write.ts:63-70` rethrows final rename errors; `H/lib/fs/windows-retry.ts:86-97` retries recognized errors then throws. No additional defect found for EPERM/EBUSY rejection. Actual antivirus/open-handle behavior was not exercised. Import's direct `wx` path must likewise surface failures without committing its marker.
- **MCP fingerprint exclusion:** no new enforcement gap found within this delta. P:209-211 excludes toggle items, not native MCP install intents. Existing harness output reads separate `mcpIntents` (`H/lib/sources/plugin-config-source-resolver.ts:137,150,172`); capability MCP enforcement remains freshly resolved session flags/direct lane configuration (P:58-60,424). Skills/plugins and PluginConfigState remain in the fingerprint (P:255-257). Keep that distinction in tests if future code starts filtering harness MCP output by capability toggles.
- **Disclosure:** proxy not-enforced labels now appear in both the contract and UI/tests (P:145-146,375,394). The cloud-sync and network-filesystem exclusions are explicit (P:213-220); they do not establish the stronger assertion that a crash never widens state, as D1 demonstrates.
- Five logic checks: silent failure = D1/D2; unexpected user action = colliding toggle/clear; wrong-answer input = empty import artifact; dependency failure = rename rejects but interrupted import cannot recover; missing contract = precedence of clear and differing concurrent import snapshots.
- No source or git state changes, live provider sessions, or filesystem mutation tests. Only this deliverable was written. This is a delta review, not a fresh approval of the entire plan.
