# Implementation Plan - TASK_2026_853_897f

Trim the session prefix (phases A, B, C) and scope installs to the workspace (phase D).
Every phase ships as its own PR in the order A → B → C → D. B builds on A's catalog and settings
section. C and D are independent of A and B and of each other.

## Rules for every implementer (repeat verbatim in every lane or subagent prompt)

- Verify only with `npm run verify -- -p <projects>`.
- Electron first, keep every host compiling.
- Never commit/push.
- Work only in the worktree.

Worktree: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet` (branch
`feat/session-prefix-diet`). Never run `build`, `serve`, `dev`, `e2e`, `package` or workspace-wide
targets. Run the content-manifest script only as `npm run manifest:generate` and
`npm run manifest:check`.

## Inputs and constraints

- Requirements used: `task-description.md` (Gate 1 approved), `decisions.md` #1–#24 (not
  reopened; #20/#21 settle C AC6 and the token targets, #22 overturns the old D-D2, #23 keeps
  D-D5), `context.md`, `design-spec.md` + `prototype/` (Gate 1.7 approved),
  `design-spec-review-round2.md` (one Minor note, carried into component F-D3),
  `implementation-plan-review.md` (Gate 2 round 0, all 7 findings applied; see the revision log).
- Corrections applied to `context.md` evidence (source wins):
  1. `_shared/engineering-hygiene.md` is not dead. Four templates carry its body **inline**, and
     `template-sharing.guard.spec.ts:1157-1200` reads the partial file to prove they match.
     The id is also listed in `SHARED_BLOCK_IDS` (`template-partial-resolver.ts:67-75`). Deleting
     the file (C AC4) therefore also needs that spec section rewritten and the id removed.
  2. The MCP server instructions do not repeat the substitution table. They are a ≤512-char
     summary built from it (`server-instructions.ts:1-23,52-102`). Only 3 rows plus one named
     tool fit, as seen in this session's own MCP instructions. Decision D-C2 handles this.
  3. Built-in tools other than the 12 eager ones are **deferred**. Only their names reach the
     prefix (measured below), so turning them off saves almost nothing. This sets the Phase A
     savings; the revised targets (decision #21) are A ≥2.5k, C main ≥1k, C subagent no
     regression.
  4. `/schedule` depends on `RemoteTrigger`. The CLI describes `RemoteTrigger` as "Manage
     scheduled remote Claude Code agents (routines) via the claude.ai CCR API". Under decision #11
     RemoteTrigger therefore stays on (D-A2).
- Design handoff used: `design-spec.md` §1–§3, `prototype/index.html`. Component names and test
  ids come from the spec. The tool and skill rows, costs and dependency map are final in this
  plan (design-spec Decision 6 defers them to the architect).
- Missing decision-critical input: none. C AC6 was resolved by decision #20 (no change in this
  task, pinned by the C-3 effective-set spec); the targets by decision #21.

## Measured evidence used for the lists (this machine, read-only)

Source: the `api-request-shape` entries in `~/.claude/projects/-home-amun-ptah-extension/*.jsonl`
(the 6 most recent main sessions; tool sizes were identical in all six). Tokens are estimated as
chars / 2.72. That ratio comes from context.md: the 12 eager built-ins are 34,855 chars and were
measured at 12.8k tokens. Skill-listing lines use chars / 2.64 (25.6k chars measured at 9.7k
tokens).

| Item | Prefix form | Chars | ≈ Tokens |
| --- | --- | --- | --- |
| Workflow | eager schema | 5,504 | 2,000 |
| ReportFindings | eager schema | 2,314 | 850 |
| ListAgents | eager schema | 1,227 | 450 |
| ScheduleWakeup | eager schema | 4,778 | 1,750 |
| PushNotification, DesignSync, EnterWorktree, ExitWorktree, RemoteTrigger, Cron*, Monitor, SendMessage, TaskStop, NotebookEdit | deferred name only | ~15 each | ~10 each |
| code-review skill line | listing | 1,208 | 460 |
| update-config / keybindings-help / plugin-authoring / workflow-authoring / fewer-permission-prompts / init | listing | 705 / 246 / 264 / 250 / 189 / 65 | 270 / 90 / 100 / 95 / 70 / 25 |
| claude-api / run / simplify / security-review / loop / schedule | listing | 1,090 / 366 / 188 / 88 / 342 / 379 | kept on |
| 13 `anthropic-skills:*` synced skills | listing | 10,447 total (173–1,947 each) | ~3,950 |
| `NO_BROWSER_NO_WEB` deny list × 6 in the agent listing | listing | 6 × 411 | ~900 (main and every subagent that has the Agent tool) |

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Main session tools are the `claude_code` preset; no `disallowedTools` key | `sdk-query-options-builder.ts:1281-1284,1405` | Phase A adds `disallowedTools` next to `tools` |
| `canSpawnSubagents` is called with `{ tools: sessionTools }` only | `sdk-query-options-builder.ts:456-463,1294` | It must receive the new `disallowedTools`; the catalog must never contain `Task`/`Agent` |
| Flag-tier `skillOverrides` built from `deniedSkillNames` | `sdk-query-options-builder.ts:485-512` | Phase B reuses this channel; no new settings channel |
| Unverified policy → `deniedSkillNames: []`, and isolation `skills: []` + `strictMcpConfig` | `sdk-query-options-builder.ts:527-541,563-568` | Built-in denials only ADD names. Unverified already lists no skill, so a toggle cannot widen it |
| Flag settings and `settingSources` per launch: user tier dropped on a localhost base URL; named runs use certified sources | `sdk-query-options-builder.ts:1431-1438` | Flag tier and `disallowedTools` are independent of `settingSources`, so they apply on every route |
| Certified named launch checks executable, env, cwd, sources, flag settings without auth override, and `extraArgs` that would replace certified inputs. It does not check `disallowedTools` | `claude-certified-launch.ts:447-527,552-576` | Adding `disallowedTools` and more `skillOverrides` keys passes `assertCertifiedLaunch` unchanged |
| Lane (Ptah CLI / proxied provider) options: preset tools, flag settings from `assembly.capabilityFlags`, certified sources | `claude-sdk-lane-options.ts:185-226`, `ptah-cli-spawn-options.service.ts:60-91,221,311-312` | Lanes need the same policy through `PtahSpawnAssembly` |
| Internal one-shot queries use their own preset tools | `sdk-query-runner.service.ts:240,718-729` | Left unchanged (C AC7: no behaviour change except the trimmed core) |
| Policy skill denials: bare names plus `plugin:skill` | `capability-policy-model.ts:394,406-421` | Built-in denials merge into the same list |
| CLI 2.1.278: `skillOverrides` resolves by `e.name` then the qualified name; plugin-sourced prompts return `"on"` before overrides are read; synced skills come from `loadedFrom==="syncedSkills"` and "answer only to `anthropic-skills:<name>`" | bundled CLI binary strings (`node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude`) | Bundled and synced skills can be hidden per name. Synced skills must be keyed `anthropic-skills:<name>` (verified at runtime in work unit A0) |
| The CLI renders the agent listing as `All tools except ${disallowedTools.join(", ")}` | CLI strings, function `RUo` | The listing prints whatever the frontmatter holds; Ptah cannot shorten it without changing the frontmatter (C AC6 → decision #20: no change, C-3) |
| A partial wildcard `mcp__ptah__ptah_browser_*` is not matched by the pinned runtime; only bare-server specs are | `subagent-tool-allowlist.ts:9-19` | Rules out wildcard compaction |
| Settings pattern: `agent:getConfig` / `agent:setConfig`, `agentOrchestration.*` file keys | `agent-rpc.handlers.ts:570-573,910-915`; `rpc-agents.types.ts:301,487`; `file-settings-keys.ts:150,358` | New keys follow `disabledMcpNamespaces` exactly |
| Settings-to-session precedent: the builder reads `ptah` config directly | `sdk-query-options-builder.ts:1287-1292` (`subagentPromptCacheTtl`) | The runtime reader lives in the builder, so every main-session caller gets it |
| MCP namespace toggle UI: load, failed state, `saveGeneric` with Undo | `mcp-port-config.component.ts:300-440`; placed by `advanced-settings.component.ts` | New card copies this component's state machine |
| Synced skills on disk: `~/.claude/skills/synced/<accountUuid>_<orgUuid>/manifest.json` with `{skills:[{skillId,name,description,source}]}` | local filesystem (read-only) | Discovery reads the manifest (falls back to `*/SKILL.md` frontmatter) |
| Core prompt sections | `ptah-core-prompt.ts:31-87,98-104,110-262,268-288` | Rule inventory below |
| Preset already says: OWASP, premature abstraction / validate at boundaries / no back-compat shims, "Output text to communicate", emojis, `file_path:line_number`, no colon before tool calls, Git Safety Protocol, "Only commit when the user explicitly asks", PR `## Summary`/`## Test plan`, "do not re-attempt the exact same tool call" | CLI strings (preset text) | Those core lines are pure restatements and are deleted |
| `PTAH_MCP_MANDATE_PROMPT` used only by its spec and index exports | `ptah-core-prompt.ts:280-288`, `prompt-harness/index.ts:12`, `ptah-core-prompt.spec.ts:51-61` | Delete the constant, its exports and that spec block |
| Core budget pinned at ≤4100 tokens; roster drift and mandate manifest read the constants | `ptah-core-prompt.spec.ts:17`, `vendor-roster-drift.spec.ts:75,163-169`, `mcp-mandate-manifest.spec.ts` | Specs to re-run and adjust |
| `_shared/` ships in the content manifest; CI runs `manifest:check` | `scripts/generate-content-manifest.js:26`, `content-manifest.json` (lists `_shared/engineering-hygiene.md`), `.github/workflows/content-manifest.yml:54` | C must regenerate `content-manifest.json` |
| skills.sh roots: global `~/.ptah/plugins/ptah-skillssh-*`, metadata v1 `{version,source,skillIds,installedAt}` with no hash; opt-out, so active everywhere; also mirrored into `~/.ptah/user/skills` | `skills-sh-source-root.ts:60,63,81,93-101,119`; `skills-sh-source-root.service.ts:90-96,116-160,382-412`; `plugin-loader.service.ts:11-15,1476,1658-1676`; `apps/ptah-electron/src/activation/plugin-activation.ts:357-362` | Workspace roots need their own base, kept out of the mirror |
| A workspace plugin base already exists for `ptah-harness-*`: `{ws}/.ptah/plugins`, overlay-only and deliberately not mirrored | `origin-sidecar.types.ts:89-101`; `plugin-loader.service.ts:1492-1553` | Reuse this base for workspace skills.sh roots (one pattern, two prefixes) |
| MCP intents: `~/.ptah/mcp-installed.json` v1 `{servers:{key:{registryName,targets,installedAt,config}}}`, no workspace; `record()` merges targets | `mcp-intent-store.ts:16-19,47-74,84-139` | v2 adds `global` and per-workspace target sets |
| `buildMcp` maps every intent into every workspace | `harness-manifest.builder.ts:276-290`; the reader is `plugin-config-source-resolver.ts:153,166-224,294` | Filter in the resolver by workspace key |
| 7 MCP targets: claude `.mcp.json`, vscode `.vscode/mcp.json`, cursor `.cursor/mcp.json`, opencode `opencode.json` (workspace); codex `~/.codex/config.toml`, copilot `~/.copilot/mcp-config.json`, antigravity `~/.gemini/config/mcp_config.json` (home) | `mcp-facet.registry.ts:25-125`; `codex-toml-mcp-facet.ts:97-116`; `capability-toggle.types.ts:305-309` | Workspace scope = the 4 workspace targets; home targets require global (AC5/AC6). Confirms the design-spec list |
| Managed manifest per target `{ws}/.ptah/harness/<target>.manifest.json`, `{version:1, owner:'ptah', entries:{relPath:{hash,sourceHash?,source,kind}}}`; MCP keys `configRelPath#serverKey`, home keys included | `managed-manifest.ts:36,40-70,117-119`; `mcp-facet.port.ts:45-52` | Ownership record plus content hash for every workspace copy and home entry, so it serves as the migration proof |
| Reconciler removal: an owned copy whose source vanished is removed; a hand-edited one is snapshotted and then removed (`removedLocalEdit`) | `harness-target.port.ts:77-84,170-194` | The migration needs a "retired source" policy that KEEPS edited and git-tracked copies (AC2) |
| User-layer clones carry a sidecar `{pluginId, sourceRef:'skills-sh:<root>', sourceHash, diverged, currentContentHash}` | `origin-sidecar.types.ts:128-164`; `source-hash.ts:78`; `user-layer-orphan-reaper.ts:324` | `sourceHash` proves who wrote the **clone**, not who wrote the source root. It may justify deleting the clone, never the root (D-6 step 2) |
| Skill sync gate: a workspace with owned skill entries derives `'all'`, otherwise `'selected'` + `[]`; the selection also filters the overlay | `skill-sync-gate.ts:64-115,194-202`; `harness-manifest.builder.ts:149-161,381-384`; UI `plugin-catalog-panel.component.ts:235-300` | Workspace-scoped roots must bypass the selection, and the derive rule changes (#17) |
| Harness tools: `createSkill` defaults `'user'`; `installMcpServer` has no scope and defaults targets to `['claude','vscode']` | `harness-namespace.builder.ts:111,719-791,995-1088`; `rpc-harness.types.ts:177-180`; `tool-description.builder.ts:1515-1566,1660-1715`; `system-namespace.builders.ts:230-238` | Flip the default; add a scope argument |
| External plugin MCP: always claude+vscode plus detected home CLIs, into the global store; params validated by `ExternalInstallParamsSchema` | `plugin-rpc.handlers.ts:672,708-715,779-801,908-929`; `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts:109-121,153,271-285`; `plugin-rpc.schema.ts:56`; `ExternalInstallParams` in `rpc-plugin-marketplace.types.ts:309-321` | Workspace scope by default, explicit opt-in global (decision #22, D-D2) |
| The consent dialog already has a "This plugin declares MCP servers" block, rendered only when the plan has servers | `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:276-300` | Minimal placement for the scope field on the external-plugin install (F-D4) |
| Root metadata today is `{version, source, skillIds, installedAt}`, written after the files are moved | `skills-sh-source-root.ts:93-101`; `skills-sh-source-root.service.ts:145-160` | No writer identity and no hash in v1: legacy roots cannot be proven Ptah-owned; metadata I/O is its own failure point in Make global |
| `git ls-files --error-unmatch -- <path>` exits 1 for an untracked path ("did not match any file(s) known to git"), 128 outside a repository | read-only check in this worktree: exit 1; `gitignore-writer.ts:4-9` calls derived copies untracked | Exit 1 + no-match is the **eligible** result, not an error (D-2) |
| MCP entry removal runs per fragment; one can succeed and a later one fail in the same pass | `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet-planner.ts:135-145,156-173` | The ledger persists per-path successes (D-6 step 4) |
| The six `NO_BROWSER_NO_WEB` rows and their lookup | `subagent-tool-allowlist.ts:53-57,66-73,96-108`; existing exact-row spec `subagent-tool-allowlist.spec.ts:39-57` | C-3 seam: pin the effective sets and the rendered frontmatter |
| Generated agents go to `{outputRoot ?? ws}/.claude/agents`, mirrored per workspace key | `orchestrator.service.ts:440-444`; `user-layer-mirror.service.ts:389-400,525-526` | No change |
| Boot order: settings migrations, then heavy boot runs `refreshUserLayer` and then `reconcileHarness` | `apps/ptah-electron/src/activation/bootstrap.ts:398-401`; `boot-heavy-services.ts:204,240,264` | The install-scope migration's global step runs before `refreshUserLayer` |
| Known workspaces: `ptah.recentWorkspaces` | `rpc-handlers/src/lib/services/recent-workspaces.service.ts:49` | Migration enumerates recent ∪ open folders |
| Chat banner slot and marketplace navigation | `chat-view.component.ts:45-56`, `chat-view.component.html:30-120`; `app-shell.component.ts:339` (`appState.setCurrentView('marketplace')`) | The notice is one more banner in the chat view |

## Architecture decision

- Chosen approach:
  - **A + B.** A single, static **Claude built-in catalog** in agent-sdk lists the default-off
    tools, the default-off terminal skills and the tool→skill dependency map. A pure
    **built-in policy** function turns the stored opt-in lists into `disallowedTools` and
    `deniedSkillNames`. Every launch that uses the `claude_code` preset applies it: main
    sessions through `SdkQueryOptionsBuilder`, lanes through `PtahSpawnAssembly`. Synced skills
    are discovered from the account's Claude config dir at build time and denied unless opted in.
    Persistence: two global `agentOrchestration.*` file settings, written through the existing
    `agent:setConfig`. A new read RPC `agent:getClaudeBuiltins` returns the catalog rows for the
    settings card.
  - **C.** Edit the core prompt in place to the inventory below. Delete the dead constant and
    the partial file, rewrite the guard section, and regenerate the content manifest.
  - **D.** One scope vocabulary (`'workspace' | 'global'`) on every install RPC, defaulting to
    workspace. Workspace skills.sh roots move into the existing `{ws}/.ptah/plugins` base. The
    MCP intent store goes to v2 with per-workspace target sets. The resolver filters intents by
    workspace. A permanent **retired-source registry** marks legacy roots and intents as
    inactive, and a reconciler removal policy for retired sources deletes only proven, unchanged,
    untracked copies. A one-time `InstallScopeMigrationService` fills the registry, deletes
    proven global artifacts, reconciles known workspaces under that policy, and records a
    deduplicated ledger with a notice flag.
- Rationale: each piece reuses a verified channel. `disallowedTools` is honoured on named
  launches (`claude-certified-launch.ts:488-527` does not inspect it). The flag tier survives
  every `settingSources` variant (`:1431-1438`). The workspace plugin base already isolates
  harness plugins from the mirror (`plugin-loader.service.ts:1500-1515`). The managed manifest
  already holds a per-entry content hash (`managed-manifest.ts:40-62`), and that hash is the
  ownership proof AC2 asks for.
- Rejected alternatives:
  - Built-in denials inside the capability policy (`capability-policy-model.ts`). Rejected: that
    policy is per workspace and per installable capability. Decision #13 makes these global
    prefix settings. Mixing them would also make the unverified path lose the tool denials.
  - `disableBundledSkills` / `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`. All-or-nothing; B AC7 needs
    per-skill toggles.
  - `syncClaudeAiSkills:false`. All-or-nothing, and in user settings it moves synced skills to
    `~/.claude/skills/.trash` (CLI setting description). That is destructive.
  - Flag-tier `permissions.deny` instead of `disallowedTools`. A1 names the SDK option, and both
    become deny rules.
  - Migration deleting workspace copies directly from a crawl. Rejected: the reconciler and its
    manifests already own those writes. A second deleter would duplicate the ownership logic and
    race with the per-workspace lock (`harness-reconciler.service.ts:170-178`).
  - Workspace skills.sh installs adding their slugs to the workspace selection. Rejected in
    favour of exempting workspace roots from the selection (D-D4): with no second write, there is
    no uninstall bookkeeping to keep in sync.
- Assumptions (each has a check, and A0 runs the first three before any Phase A/B code):
  1. Subagents inherit the main session's `disallowedTools`, because they are CLI deny rules.
     Check: an A0 subagent transcript's `api-request-shape` has no Workflow or ReportFindings
     schema.
  2. `skillOverrides {"<bundled>": "off"}` hides bundled skills (`code-review`, `init`,
     `update-config`, ...) and `{"anthropic-skills:<name>": "off"}` hides synced skills. Check:
     first-turn skill listing in A0.
  3. An override key naming a skill that is not loaded (proxied session without the user tier)
     is ignored without error. Check: A0 proxied session starts and streams.
  4. The Electron heavy boot runs after the window is shown, so a migration there does not block
     start (AC5). Check: `boot-heavy-services.ts` call site and the bootstrap ordering.
  5. Bundled-plugin user-layer clones are already filtered per workspace by the plugin-origin gate
     in `buildSkills` (`harness-manifest.builder.ts:342-398`). Check: read the gate. If it does
     not filter by workspace enablement, that is a leak, and its delivery-map row flips to
     "change".
  6. The `.ptah/` workspace folder is git-ignored by harness gitignore maintenance, so workspace
     skills.sh roots are not committed by accident. Check: `gitignore/harness-state-store.ts` and
     the entries the reconciler maintains.
- Effect on existing code:
  - Replaced: the core prompt sections listed in the inventory, `PTAH_MCP_MANDATE_PROMPT`,
    `_shared/engineering-hygiene.md`, the skill-sync-gate derive-to-`'all'` rule, the
    `createSkill` default, the v1-only intent-store schema, and the `scope` literal `'global'` on
    `InstalledSkill`.
  - Left alone: the `workflows.disabled` kill switch, the capability policy model, internal
    one-shot queries, generated agents and bundled plugins.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-A1 | **Final default-off tools: `Workflow`, `ReportFindings`, `PushNotification`, `DesignSync`, `EnterWorktree`, `ExitWorktree`.** | add ListAgents / RemoteTrigger / scheduling | Per-tool rationale in component A-1. None of them has a Ptah backend dependency or a shipped-skill reference (`apps/ptah-extension-vscode/assets/plugins`, `libs/backend/agent-generation/templates` grep: no hit). Workflow has renderers only, kept for replay (AC6) | Yes, catalog constant |
| D-A2 | `RemoteTrigger`, `ListAgents`, `SendMessage`, `ScheduleWakeup`, `Cron*`, `Monitor`, `TaskStop`, `NotebookEdit` stay on | off | RemoteTrigger backs `/schedule` (CLI: "Manage scheduled remote Claude Code agents (routines)") and #11 keeps `/schedule`. ListAgents/SendMessage are documented in the shipped skill (`internal-mcp.md:114`). SendMessage is used by `subagent-message-dispatcher.ts:155-165` and `clarification-protocol.md:2`. Monitor/TaskStop/NotebookEdit have renderers or permission classifiers. All but ListAgents are deferred (~10 tokens each) | Yes |
| D-A3 | **Target A is ≥2.5k (decision #21, settled).** Predicted saving is about 2.9k tokens (Workflow 2.0k + ReportFindings 0.85k + 4 deferred names). Turning ListAgents off as well would reach about 3.3k and is rejected (D-A2) | also disable ScheduleWakeup (reopens #11) | Measured sizes table; decision #21 | Yes |
| D-A4 | Store **opt-in** lists (`enabledClaudeBuiltinTools`, `enabledClaudeBuiltinSkills`), not disabled lists | disabled list | Default-off semantics: an item added to the catalog later starts off with no migration. Names outside the catalog or the discovered synced set are ignored | Yes |
| D-A5 | The policy applies to main sessions and lanes (ambient, named, proxied), **not** to internal one-shot queries | apply everywhere | C AC7 forbids behaviour change in one-shot queries. They are not user sessions (`sdk-query-runner.service.ts:240`) | Yes |
| D-A6 | `workflows.disabled` (env kill switch) is kept unchanged and independent of the Workflow tool toggle | merge into one control | Removing an existing setting is a capability change. The two act on different layers (env `CLAUDE_CODE_DISABLE_WORKFLOWS` vs the tool schema; `sdk-query-options-builder.ts:978-982,1458-1463`) | Yes |
| D-B1 | **Final terminal-only default-off skills: `keybindings-help`, `update-config`, `fewer-permission-prompts`, `plugin-authoring`, `init`, `workflow-authoring` (needs Workflow), `code-review` (needs ReportFindings).** Stay listed: `simplify`, `security-review`, `claude-api`, `run`, `loop`, `schedule` | include run / claude-api / security-review | Rationale per skill in component A-1. No statusline skill exists in the measured listing (`statusline-setup` is a built-in agent type, outside this task) | Yes |
| D-B2 | Synced-skill discovery reads `<claudeConfigDir>/skills/synced/*/manifest.json`. `claudeConfigDir` is `CLAUDE_CONFIG_DIR` from the launch env when set (named accounts), otherwise `~/.claude`. Each skill is keyed `anthropic-skills:<name>`, never by bare name | bare + qualified | A bare key would also hide a workspace skill with the same name (B AC6). The CLI says synced skills "answer only to `anthropic-skills:<name>`" | Yes |
| D-B3 | The settings card shows the load-error block only when the active workspace's capability policy is unverified (design-spec state "Fail-closed policy") | never block | The design is approved. The settings are global, but the session that would use them is fail-closed (`:563-568`), so this is informational. Writes are never blocked by the policy | Yes |
| D-C1 | C deletes every core rule that the preset states verbatim (inventory rows marked "preset"), not only the four named in AC5 | AC5 four only | Requirement 3 says "state each rule once". The preset text was verified in the CLI strings | Yes |
| D-C2 | The full substitution table stays only in the core. The ≤512-char MCP handshake summary (3 rows) stays unchanged. AC5 "once" is read as one full table | omit `instructions` for Ptah SDK sessions; drop the table from the core | Codex and built-in subagents rely on the handshake text (`server-instructions.ts:1-23`). Dropping the core table would leave 13 of 16 mappings named only. Residual overlap: 3 rows, about 150 chars | Yes |
| D-C3 | `_shared/engineering-hygiene.md` is deleted. The four inline copies become the rule's home, and the guard asserts that they are identical to each other | keep the file | C AC4. The guard explains that inlining exists because released resolvers reject unknown ids (`template-sharing.guard.spec.ts:1159-1170`) | Yes |
| D-D1 | Scope vocabulary: RPCs and UI use `'workspace' \| 'global'` (`CapabilityScope`, `mcp-directory.types.ts:18`). The harness tools keep their own `'workspace' \| 'user'` (existing `HarnessSkillScope`, `harness-namespace.builder.ts:111`) and gain it on `installMcpServer` | one vocabulary everywhere | Changing `createSkill`'s public enum would break callers. The two families map 1:1 | Yes |
| D-D2 | **External plugin MCP servers default to workspace scope and offer the explicit opt-in global choice (decision #22).** Same vocabulary (`'workspace' \| 'global'`) and preselection rules as the MCP directory (#15, #19): workspace → workspace-file targets only (claude, vscode, plus detected cursor/opencode); explicit global → today's set (claude, vscode, plus every detected CLI); Make global → the installed row's `mcpDirectory:makeGlobal`, home targets unchecked. The choice is made once per install (one field for all declared servers) and recorded per server | workspace only (old D-D2, overturned by #22) | D AC2 lists external plugin MCP; plugin enablement stays per workspace (`plugin-rpc.handlers.ts:908-929`), so a global server is an explicit user choice, never a default | Yes |
| D-D3 | The retired registry is permanent state, not a migration side-effect. Discovery, the resolver and the reconciler read it on every pass | marker-only | Workspaces the migration does not enumerate (not recent, not open) still get the safe policy when they are first reconciled. They are not counted in the notice (counted ones are listed) | Yes |
| D-D4 | Workspace skills.sh roots bypass the skill-sync selection. The derive rule for a workspace with no recorded mode becomes `'selected'` with the slugs it currently owns, instead of `'all'` | keep `'all'` | #17. `'all'` is how a global install reaches every workspace (`skill-sync-gate.ts:108-114`). Workspaces that already have a recorded mode keep it (`persist()` never overwrites, `:124-139`) | Yes |
| D-D5 | The migration runs from the Electron boot only (kept, decision #23). VS Code and the CLI read the same registry under `~/.ptah`, so they inherit retirement once Electron has run. **Until Electron has run once on a machine, VS Code and the CLI keep today's legacy behaviour (global skills.sh roots and v1 intents stay active).** This timing is stated in the Phase D PR body and the release notes | wire all hosts | Electron-first rule (CLAUDE.md). The state is shared under `~/.ptah`. Wiring other hosts is a one-line call later | Yes |
| D-D6 | Expected counts on this machine: retired 4 (1 skills.sh root `~/.ptah/plugins/ptah-skillssh-anthropics-skills`, 3 MCP intents next-devtools/context7/playwright); onDisk 1 (that root: metadata v1, so no Ptah owner marker and no per-file hashes; ownership is never inferred from a clone sidecar or the directory name); removed or kept = the workspace `.mcp.json`/`.vscode/mcp.json` entries of those 3 servers per known workspace (deleted when untracked, unchanged and manifest-owned; otherwise kept). Counts are unchanged by the round-1 proof rule because this root had no clone proof either. In general, every legacy (v1) skills.sh root retires instead of being deleted. VS Code and the CLI show these items as active until Electron has run once (D-D5) | — | `ls ~/.ptah/plugins`, `~/.ptah/mcp-installed.json`, `~/.ptah/user/skills/*/.ptah-origin.json` (no `skills-sh:` sourceRef) | n/a |
| D-D7 | Git tracked test reads the exit status: **0 = tracked (keep, `git-tracked`)**; **1 with the no-match message = untracked (eligible)**; missing git, timeout, exit 128 (not a repository) or any other result = **unverifiable (keep and disown, `unverifiable`)** | any error = tracked (round 0) | Exit 1 is the normal untracked result (evidence row); derived copies are untracked by contract (`gitignore-writer.ts:4-9`). The round-0 rule kept every eligible copy and missed migration AC2 | Yes |
| D-D8 | skills.sh metadata v2 carries an explicit owner marker `owner: 'ptah'` plus `ownerMarker: SKILLS_SH_OWNER_MARKER` (constant `'ptah.skills-sh.root.v2'`) and **per-file** hashes `files: {[relPath]: sha256}` for every file in the root except the metadata file. A root is deletable only when the marker is valid and every on-disk file is listed with a matching hash and no unlisted file exists. v1 roots, or v2 roots without proof, are retired, never deleted | infer ownership from a matching user-layer clone sidecar (round 0) | The sidecar records clone provenance (`origin-sidecar.types.ts:120-155`), not who wrote the root; v1 has no writer identity (`skills-sh-source-root.ts:93-101`); decisions #5/#10, migration AC3 | Yes |
| D-D9 | skills.sh Make global order: stage copy → verify hashes → write global v2 metadata → atomic rename into place → register/propagate → validate → **only then** remove the workspace root. Any failure after the copy leaves the workspace install intact; a retry resumes from a valid, marker-owned global root with identical hashes | remove the workspace root before metadata and propagation (round 0) | Metadata I/O is a separate failure point (`skills-sh-source-root.service.ts:145-160`); D AC2 and retry safety | Yes |
| D-D10 | The migration ledger persists per-path outcomes (`removedPaths`, `keptPaths`, `failedPaths`) after every workspace pass; counts derive from the persisted union, not from the last pass | one outcome per item (round 0) | The reconciler prunes a removed path's manifest entry, so a retry no longer reports it (`workspace-target.ts:856-862`); per-fragment MCP removal can partly fail (`mcp-facet-planner.ts:156-173`) | Yes |

## Clarifications (closed)

Both former questions are settled by approved decisions and are not reopened here.

1. **C AC6 (6× deny list)** → decision #20: no change in this task. The `NO_BROWSER_NO_WEB` list
   stays as is (`subagent-tool-allowlist.ts:53-57,66-73`). Component C-3 is an explicit
   no-change component with an effective-set regression spec. A follow-up task evaluates a
   second MCP server name or a narrower deny list.
2. **Target revisions** → decision #21: A ≥2.5k, C main ≥1k, C subagent no regression.

## Rule inventory (Phase C AC1)

Legend for "After": **core** = stays in `PTAH_CORE_SYSTEM_PROMPT` (main sessions and internal
queries), **subst** = stays in `PTAH_MCP_SUBSTITUTION_SECTION` (inside core), **preset** = deleted
here because the `claude_code` preset states it (verified in the CLI strings), **partial** =
stays in that `_shared` file (subagents), **handshake** = MCP `server-instructions.ts`
(unchanged). Every rule ends with at least one home.

| # | Rule (source location) | Also stated in | After |
| --- | --- | --- | --- |
| R1 | Identity: Ptah, rich webview, not a terminal (core :110-119) | — | core (unchanged; the "VS Code" wording in Electron is a separate follow-up) |
| R2 | Emojis only on request (core :123) | preset | preset |
| R3 | Responses render as enhanced markdown in a webview; keep them concise (core :124) | preset says monospace CommonMark (contradicts) | core, merged into Rich Formatting (R31) so the Ptah rendering override stays |
| R4 | Communicate with text, not Bash or comments (core :125) | preset "Output text to communicate…" | preset |
| R5 | Prefer editing to creating files (core :126) | preset "prefer editing existing files" | preset |
| R6 | No colon before tool calls (core :127) | preset | preset |
| R7 | Professional objectivity (core :129-131) | admitted overlap `sdk-query-options-builder.ts:313` | deleted (AC5) |
| R8 | No time estimates (core :133-135) | admitted overlap `:313` | deleted (AC5) |
| R9 | Prefer ptah_* tools; deferred ptah tool → ToolSearch `select:` (subst :31-33) | partial tooling-precedence (bullet 1); handshake ("deferred counts as listed") | subst + partial + handshake (different prefixes) |
| R10 | 16-row substitution table (subst :35-54) | partial tooling-precedence (8 rows); handshake (3 rows + names) | subst (single full table); partial for subagents; handshake summary (D-C2) |
| R11 | Fall back to Bash/Grep/Glob only for writes, build/test/git, free text, errors, one Grep after zero hits (subst :56-57) | partial tooling-precedence bullet 2; core :155-158 "Built-in Tools (Priority 2)" | subst + partial; core :155-158 deleted (R20) |
| R12 | Symbol/AST lookups via ptah first (subst :59-60) | — | subst |
| R13 | execute_code only for LSP actions, help, memory list, purge on explicit ask (subst :62-68) | — | subst |
| R14 | Memory trigger phrases → `ptah_memory_search` before replying (subst :70-71) | table row "Recalling past decisions" (:50) | subst. The callout is shortened to the trigger phrases and the "before replying" rule; the row stays (the mandate manifest maps it) |
| R15 | "Start every task with Ptah" 5 steps (subst :73-79) | table rows workspace_analyze, relevance_rank, lsp_references, get_diagnostics, web_search | deleted. The unique part, "lsp_references before any refactor", moves into that row's Why cell |
| R16 | Token economy: cost = requests × context; finish in few calls (subst :81-83) | — | subst |
| R17 | **Verify only changed projects with `nx test`/`nx affected`, `--parallel=1`, `--maxWorkers=2`** (subst :84) | contradicts workspace CLAUDE.md (`npm run verify`) | subst, **rewritten** (AC2): "Verify with the commands your workspace's CLAUDE.md or project instructions name; with none, run the narrowest check that covers the change. Never run workspace-wide, build, serve, dev or e2e targets unless asked, and never overlap heavy runs." No tool or command names |
| R18 | Small tool output, no full logs, no re-run to re-read; long command once (subst :85-86) | — | subst |
| R19 | Prefer ast_analyze/enrich over whole-file reads (subst :87) | table rows | subst (one line; kept as the cost rule) |
| R20 | Built-in tools are second priority; parallelise; use Task for heavy exploration (core :155-158) | R11; preset (Agent tool, parallel calls) | deleted |
| R21 | 3-tier hierarchy (core :141-143) | — | core |
| R22 | Roster is a runtime fact: call `ptah_agent_list`, never rank (core :145) | partial cli-delegation; CLI_DELEGATION_PATTERN step 1 | core keeps one sentence; the duplicate clause in step 1 is merged |
| R23 | Spawn → completion signal → read; status is one-off (core :98-104 via :147) | partial cli-delegation | core (main) + partial (subagents); different prefixes |
| R24 | Resume over re-spawn (core :149) | partial cli-delegation ("resume via resume_session_id") | core + partial |
| R25 | Subagent isolation default (core :151) | — | core |
| R26 | Name teammates (core :153) | — | core |
| R27 | AskUserQuestion bar, budget, structured options, subagents cannot ask (core :161-176) | partial clarification-protocol (subagent side) | core (main) + partial (subagents); different audiences |
| R28 | Denied call: never retry, never route around (core :178-180) | preset covers "do not re-attempt the exact same call" | core keeps only "never pursue the same outcome through a different tool; read the feedback" |
| R29 | Read code before changing it (core :184) | — (not found in preset strings) | core (one line) |
| R30 | OWASP (:185), over-engineering / boundaries / premature abstraction (:186), no back-compat hacks (:187) | preset (verified); partial replacement-policy (agents); inline engineering hygiene in 4 templates | preset + partial + inline templates; deleted from core |
| R31 | Rich formatting guidelines (core :259-262) | — | core (absorbs R3) |
| R32 | Orchestration default, exceptions, task types, depth, delegation table, rules (core :189-239) | orchestration skill body (not in prefix) | core (unchanged) |
| R33 | **Git safety: no config edits, no force push, no amend, stage files; "Only commit when explicitly asked"** (core :243) | preset Git Safety Protocol + "Only commit when the user explicitly asks" | core, **rewritten** (AC3): "Commit, push and pull-request authorization follows the workspace's own instructions (CLAUDE.md, project rules). With none, commit or push only when the user asks." Safety details stay in the preset |
| R34 | Commit workflow and PR format (core :245-247) | preset (commit/PR instructions, `## Summary`/`## Test plan`) | preset |
| R35 | `file_path:line_number` code references (core :249-257) | preset | deleted (AC5) |
| R36 | Multi-Agent Delegation block (MANDATE :282-288) | R21–R24 | deleted with the constant (AC4) |
| R37 | Partial `cli-delegation.md` (lanes: list first, self-contained prompt, max 3, wait, resume, no git, synthesise) | R22–R24 | partial (unchanged) |
| R38 | Partial `replacement-policy.md` | R30 | partial (unchanged) |
| R39 | Partial `clarification-protocol.md` | R27 | partial (unchanged) |
| R40 | Partial `tooling-precedence.md` "Skill use" (7 bullets) | — | partial (unchanged) |
| R41 | `engineering-hygiene.md` (7 bullets) | inline in backend-developer, frontend-developer, software-architect, code-style-reviewer templates | inline templates (D-C3); file deleted |
| R42 | Handshake: header, unlisted fallback, "Also, if listed", `ptah.help()` | R9–R11 | handshake (unchanged; derived from subst) |

Reviewer check: every row whose "Also stated in" is "—" has core, subst, partial or inline as
its "After". The cross-side reviewer (codex) reviews this table before any deletion (Phase C
risk mitigation).

## Delivery map (Phase D AC0)

| Surface | Where files and records are written | How they reach a session or CLI | Scope decision |
| --- | --- | --- | --- |
| Bundled plugins | Downloads to `~/.ptah/plugins/` (`content-download.service.ts:95,99,208`); enablement `enabledPluginIds` per harness root (`plugin-config-home.ts:48,60-68`) | Enabled plugin skills mirrored to `~/.ptah/user/skills`, then reconciled per workspace with the plugin-origin gate (`harness-manifest.builder.ts:342-398`) | No change: already opt-in per workspace. Assumption 5 is the check |
| External plugins (files) | `~/.ptah/plugins/external/<owner>/<repo>/<plugin>` (`external-plugin-id.ts:30,82-93`); consent `.ptah-external.json` | Enabled only in the active workspace's config (`plugin-rpc.handlers.ts:908-929`) | No change (files are a cache; enablement is already per workspace) |
| External plugins (MCP) | Global intent store, targets claude+vscode plus detected home CLIs (`plugin-rpc.handlers.ts:714,779-801`; `external-plugin-mcp.service.ts:109-121,271-285`) | `buildMcp` → every workspace (`harness-manifest.builder.ts:276-290`) | **Change**: `mcpScope` param, default workspace (workspace targets only); explicit opt-in global keeps today's targets; installed rows offer `mcpDirectory:makeGlobal` with home targets unchecked (D-D2, decision #22); uninstall forgets the record in its scope (`:806-835`) |
| skills.sh | `~/.ptah/plugins/ptah-skillssh-*` + metadata v1 (`skills-sh-source-root.service.ts:90-160`) | Opt-out overlay in every workspace (`plugin-loader.service.ts:1658-1676`) **and** the user-layer mirror (`plugin-activation.ts:357-362`) | **Change**: default `{ws}/.ptah/plugins/ptah-skillssh-*` (overlay of that workspace only, never mirrored); explicit global keeps today's path with metadata v2; `makeGlobal` conversion |
| MCP directory | Intent v1 global (`mcp-install.service.ts:194-225`), target files written by reconcile; UI preselects 7 (`mcp-directory-browser.component.ts:37-45,356-358,442`) | `buildMcp` → every workspace | **Change**: intent v2 workspace record by default; workspace scope accepts only workspace targets (server-side check); explicit global = today plus `global` record; `makeGlobal` with opt-in home targets (#19) |
| Harness `createSkill` | `scope:'user'` default → `~/.ptah/plugins/ptah-harness-<name>`; `'workspace'` → `{ws}/.ptah/plugins/…` (`harness-namespace.builder.ts:719-791`) | user: overlay everywhere; workspace: overlay of that workspace | **Change**: default `'workspace'`; the no-folder error names `scope:'user'` (AC4) |
| Harness `installMcpServer` | `McpInstallService.install` → global intent (`harness-namespace.builder.ts:995-1088`) | `buildMcp` → every workspace | **Change**: new `scope` (default `'workspace'`); home targets with workspace scope → error |
| Harness apply (`harness-mcp-install.service.ts:92-96`) | Global intent, `HARNESS_DEFAULT_MCP_TARGETS` | every workspace | **Change**: workspace scope (the harness config being applied belongs to the active workspace) |
| Generated agents + per-workspace mirror | `{outputRoot ?? ws}/.claude/agents` (`orchestrator.service.ts:440-444`); `~/.ptah/user/agents/<wsKey>` (`user-layer-mirror.service.ts:389-400,525-526`) | That workspace only | No change: no leak found |
| User-layer skill mirror | `~/.ptah/user/skills/<slug>` + sidecar | `buildSkills` pass 1 → every workspace in mode `'all'` | **Change (via skills.sh)**: retired-source clones are excluded; workspace roots never enter it |
| Skill sync gate (#17) | `{ws}/.ptah/harness/state.json` (`harness-state-store.ts:36-102`) | Filters the user layer and overlay (`harness-manifest.builder.ts:381-384`) | **Change (default and copy only)**: D-D4 derive rule; panel copy (component F-D2) |

## Component specifications

### A-1. Claude built-in catalog and policy (agent-sdk)

- Purpose: the single home of the default-off list, the dependency map, the measured costs and
  the pure function that turns stored opt-ins into session denials.
- Responsibilities:
  - `CLAUDE_BUILTIN_TOOLS` rows `{id, description, approxTokens, skillsNeedingIt}`:
    - `Workflow` (~2,000): "Launches a saved multi-step workflow script." Needed by
      workflow-authoring. Rationale: no shipped skill or backend state uses it; the renderers
      `assistant-message.transformer.ts:159` and `execution-node.component.ts:738` stay for replay.
    - `ReportFindings` (~850): "Sends code-review findings as a typed list." Needed by
      code-review. Rationale: no Ptah renderer consumes it (grep: no hit).
    - `PushNotification` (~10): "Sends a desktop notification." Rationale: Ptah handles no
      `os_notification` event (grep: no hit).
    - `DesignSync` (~10): "Syncs claude.ai design files." Rationale: claude.ai-only; no Ptah use.
    - `EnterWorktree` (~10): "Moves the session into a git worktree." Rationale: Ptah binds
      session state to a fixed cwd (named launches certify `cwd`, `claude-certified-launch.ts:516-525`;
      session-start reconcile is keyed by cwd) and ships `ptah_git_worktree_*` instead.
    - `ExitWorktree` (~10): "Leaves a worktree session." Rationale: pairs with EnterWorktree.
  - `CLAUDE_BUILTIN_TERMINAL_SKILLS` rows `{id, description, approxTokens, needsTool?}`:
    - `keybindings-help` (~90): edits the terminal's keyboard bindings.
    - `update-config` (~270): edits Claude Code `settings.json` hooks and permissions; Ptah owns
      its own settings.
    - `fewer-permission-prompts` (~70): mines CLI transcripts for an allowlist; Ptah has its own
      permission UI.
    - `plugin-authoring` (~100): mods for the Claude terminal UI (panes, status line).
    - `init` (~25): Ptah ships `initialize-workspace`.
    - `workflow-authoring` (~95, needs `Workflow`).
    - `code-review` (~460, needs `ReportFindings`); Ptah ships `review-code` / `review-logic` /
      `review-security`.
  - `PROTECTED_TOOLS = ['Agent','Task','AskUserQuestion','Bash','Read','Edit','Write','Skill','ToolSearch','TodoWrite','WebFetch','WebSearch','EnterPlanMode','ExitPlanMode','SendMessage','ScheduleWakeup','CronCreate','CronDelete','CronList','RemoteTrigger']`.
    A spec asserts that the catalog does not intersect this list.
  - `resolveClaudeBuiltinPolicy({enabledTools, enabledSkills, syncedSkillIds}) →
    {disallowedTools: string[], deniedSkillNames: string[]}`:
    - `disallowedTools` = catalog tools minus the enabled tools.
    - `deniedSkillNames` = terminal skills not enabled ∪ terminal skills whose `needsTool` is
      disallowed ∪ synced ids not enabled.
    - Input names not in the catalog or the synced set are dropped.
    - The function is pure and sorts its output.
  - `readSyncedClaudeSkills(claudeConfigDir): Promise<SyncedClaudeSkill[]>`
    `{id:'anthropic-skills:<name>', name, description, approxTokens}`:
    - Reads `skills/synced/*/manifest.json`. If a manifest is missing, it falls back to each
      `*/SKILL.md` frontmatter.
    - Dedupes by id across account folders.
    - Returns `[]` on any read or parse error, with a debug log; it never throws.
  - `approxTokens = ceil(chars / 2.64)` for skills; tools use the measured constants. The UI
    rounds them (design: "~", ≤2 significant digits).
- Verified contracts and entry points: `Options.disallowedTools` (`sdk.d.ts:1527-1532`);
  `Settings.skillOverrides` values `'on'|'name-only'|'user-invocable-only'|'off'`
  (`sdk.d.ts:6547-6552`); `SessionCapabilityFlags.deniedSkillNames`
  (`sdk-query-options-builder.ts:474-482`).
- Dependencies: node `fs/promises` and `path` only. It sits next to the builder in
  `libs/backend/agent-sdk/src/lib/helpers/` and is exported from the agent-sdk index for
  rpc-handlers and cli-agent-runtime.
- Integration points: A-2 (builder), A-3 (lanes), A-4 (RPC).
- Failure behaviour: the synced reader degrades to `[]`. The cost is that synced skills stay
  visible if the manifest cannot be read. That is not a security boundary: the capability policy
  still governs installable skills.
- Quality requirements: the policy is O(n) over fewer than 50 names. The reader does one readdir
  and one JSON read per account folder.
- Verification seam: unit specs. They cover catalog ∩ protected = ∅; default (empty opt-ins) →
  6 tools and 7 skills denied; enabling ReportFindings without code-review keeps code-review
  denied; enabling code-review without ReportFindings keeps it denied (dependency); unknown names
  ignored; reader fixtures (manifest, SKILL.md fallback, malformed manifest, two accounts, missing
  dir).
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.ts`,
  `…/claude-builtin-catalog.spec.ts`, `…/synced-claude-skills.reader.ts`,
  `…/synced-claude-skills.reader.spec.ts`; MODIFY `libs/backend/agent-sdk/src/index.ts`.

### A-2. Main-session wiring (SdkQueryOptionsBuilder)

- Purpose: apply the built-in policy to every main session on every route.
- Responsibilities:
  - Read `ptah` → `agentOrchestration.enabledClaudeBuiltinTools` and `…Skills` (default `[]`)
    through `this.workspace?.getConfiguration` (precedent `:1287-1292`).
  - Resolve `claudeConfigDir` as `named.launch.env['CLAUDE_CONFIG_DIR']` when named, else
    `effectiveAuthEnv`/`process.env` `CLAUDE_CONFIG_DIR`, else `~/.claude`.
  - Call A-1. Set `options.disallowedTools`. Pass the full options to `canSpawnSubagents`.
  - Merge the built-in denied names into `capabilityFlags.deniedSkillNames` **only on the verified
    path**. On the unverified path, isolation (`skills: []`) already hides every skill, and the
    flag list stays exactly as `capabilityFlagsFor` returns it (B AC3).
  - `disallowedTools` applies on both paths.
- Verified contracts: `buildFlagSettingsArg(..., capabilityFlags, ...)` (`:716-760,1393-1400`);
  `capabilityFlagsFor` (`:527-556`); `capabilityIsolationOptions` (`:563-568`); `settingSources`
  (`:1431-1438`); `assertCertifiedLaunch` does not inspect `disallowedTools`
  (`claude-certified-launch.ts:488-527`).
- Dependencies: A-1 (same lib). `IWorkspaceProvider` is already injected.
- Integration points: `SessionQueryExecutor` is unchanged. The named and proxied routes are
  covered because the keys are set before the `settingSources` spread and outside `env`.
- Failure behaviour: a config read failure → treat as `[]` (all catalog items off; the safe
  default for the prefix).
- Quality requirements: no extra await on the hot path besides the synced reader. Cache the
  reader by manifest `mtimeMs` per config dir.
- Verification seam: extend `sdk-query-options-builder.spec.ts`:
  - default → `disallowedTools` equals the 6 tools and `skillOverrides` has the 7 bundled names
    plus the synced ids;
  - enabled Workflow → absent from `disallowedTools`;
  - unverified policy → `skills: []`, `strictMcpConfig`, and `skillOverrides` unchanged from
    today;
  - proxied base URL → sources `['project','local']` and the same `disallowedTools`;
  - named run → `assertCertifiedLaunch` passes with the new keys;
  - `canSpawnSubagents` stays true.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, its spec.

### A-3. Lane wiring (Ptah CLI / Claude SDK lanes)

- Purpose: the same denials for lanes that run the `claude_code` preset (ambient, named and
  proxied providers).
- Responsibilities: `PtahSpawnAssembly` gains `builtinPolicy: {disallowedTools,
  deniedSkillNames}`, computed with A-1 from the same settings keys. `buildClaudeSdkLaneOptions`
  sets `disallowedTools` and passes merged denied names into `buildFlagSettingsArg` (verified
  path only, same rule as A-2).
- Verified contracts: `PtahSpawnAssembly` (`ptah-cli-spawn-options.service.ts:60-91`), flags at
  `:221,311-312`; lane options `claude-sdk-lane-options.ts:185-226`.
- Dependencies: cli-agent-runtime → agent-sdk (existing direction, `claude-sdk-lane-options.ts:9-20`).
- Failure behaviour: same as A-2.
- Verification seam: extend the lane-options spec. A named lane with the policy passes
  `assertCertifiedLaunch`, and `disallowedTools` is present.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`,
  `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`, their specs.

### A-4. Settings keys, RPC contract and handler

- Purpose: persist the two opt-in lists and serve the catalog to the UI.
- Responsibilities:
  - Register `agentOrchestration.enabledClaudeBuiltinTools` and `…Skills` with default `[]`
    (`file-settings-keys.ts:150,358` pattern).
  - Add both to `AgentOrchestrationConfig` and `AgentSetConfigParams` (`rpc-agents.types.ts:301,487`)
    and to `agent:getConfig` / `agent:setConfig` (`agent-rpc.handlers.ts:570,910`).
  - setConfig validates arrays of strings, drops unknown ids, dedupes and sorts.
  - New read RPC `agent:getClaudeBuiltins` → `{tools: Row[], terminalSkills: Row[],
    syncedSkills: Row[], enabledTools, enabledSkills, policyStatus: 'verified'|'unverified'}`.
    The rows carry the A-1 fields.
  - `policyStatus` comes from the same capability-policy resolution the session executor uses for
    the active workspace. Assumption: locate its injectable by tracing
    `resolveSessionCapabilityPolicy` (`sdk-query-options-builder.ts:626`) callers in
    `session-query-executor.service.ts`.
  - The CLI `agent-cli.ts:738-770` array-key list gains the two keys so `ptah agent set` stays
    complete.
- Verified contracts: `agent:` prefix already allowlisted (existing `agent:getConfig`). Register
  the new method in `register-shared-rpc-handlers.ts` and pass `rpc-allowlist.spec.ts` /
  `rpc-surface.spec.ts`.
- Write path → runtime reader trace:
  1. UI checkbox → `agent:setConfig {enabledClaudeBuiltinTools: [...]}`.
  2. → `setAgentCfg('enabledClaudeBuiltinTools', …)`, which writes file setting
     `ptah.agentOrchestration.enabledClaudeBuiltinTools`.
  3. → the next session build reads `workspace.getConfiguration('ptah',
     'agentOrchestration.enabledClaudeBuiltinTools')` (A-2) or the lane assembly reads it (A-3).
  4. → `disallowedTools` / `skillOverrides`.
  5. Survives restart because it is a file setting (A AC3, B AC7).
- Failure behaviour: a write error → `{success:false}` → UI revert (existing pattern). The read
  RPC errors propagate as failure → the UI load-error block.
- Verification seam: handler specs for get, set, unknown-id filtering and `policyStatus`.
  `rpc-allowlist.spec.ts` and `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` must pass.
- Files: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`,
  `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`
  (method map), `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` + spec,
  `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`,
  `apps/ptah-cli/src/cli/commands/agent-cli.ts`.

### F-A. `ClaudeBuiltinsConfigComponent` — "Claude Code tools & skills" card (chat)

- Purpose: design-spec §1 exactly. Card, intro, applies note, live savings line, three groups,
  states table, a11y and test ids `settings-toggle-claude-tool-{id}`,
  `settings-toggle-claude-skill-{id}`, `claude-tools-load-error`.
- Responsibilities:
  - Load `agent:getClaudeBuiltins`. Save through `SettingsSaveFeedbackService.saveGeneric`
    with whole-array writes and Undo, exactly as `toggleNamespace` does
    (`mcp-port-config.component.ts:401-440`).
  - Dependency-blocked badge: shown for a skill that is enabled while its `needsTool` is off.
  - Savings: the sum of `approxTokens` over every unchecked row, rounded to 100.
  - Empty state for group 3. Load error when the RPC fails or when
    `policyStatus==='unverified'` (D-B3).
  - Phase A ships groups 1 and 2 with their rows. Group 2's rows exist in A only because A AC4
    needs the dependency to be visible. Group 3 and the synced reader arrive in B.
- Placement: `advanced-settings.component.ts`, directly below `ptah-mcp-port-config`.
- Failure behaviour: per design-spec "Error (save)": fixed copy, revert, keep focus.
- Quality: WCAG per design-spec; no colour-only meaning.
- Verification seam: component spec. It covers load, failed state, toggle and undo, the
  dependency badge, the savings sum and the empty state. Add an entry in
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced.entries.ts`
  (fixture only; no e2e run). The visual review runs in Electron only.
- Files: CREATE `libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts`
  + `.spec.ts`; MODIFY `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts`,
  `settings-advanced.entries.ts`.

### C-1. Core prompt rewrite (agent-sdk)

- Purpose: apply the rule inventory.
- Responsibilities:
  - Edit `PTAH_MCP_SUBSTITUTION_SECTION` and `PTAH_CORE_SYSTEM_PROMPT` per R1–R36.
  - Delete `PTAH_MCP_MANDATE_PROMPT` and its exports (`prompt-harness/index.ts:12`, the
    agent-sdk index).
  - Update the file header (the "paid for twice" comment) and the builder JSDoc at
    `sdk-query-options-builder.ts:302-315`, which describes the overlap that no longer exists.
  - Lower the budget pin in `ptah-core-prompt.spec.ts:17` to the new measured value + 5 %.
  - Remove the MANDATE spec block (`:51-61`).
  - Add assertions:
    - no `nx test`, `nx affected` or "Only commit when explicitly asked";
    - a "CLAUDE.md or project instructions" deferral is present for verification and for commit
      authorization;
    - the table header appears exactly once in the core.
- Dependencies: consumers re-run their specs: `server-instructions.ts` (derived from subst),
  `mcp-mandate-manifest.spec.ts`, `vendor-roster-drift.spec.ts:75,163-169`,
  `enhanced-prompts.service.ts:900` (preview prepends core), `prompt-designer-agent.ts`,
  `session-lifecycle-manager.ts`, `sdk-query-runner.service.ts:718`.
- Failure behaviour: n/a (constant text). A spec failure in a consumer means a pinned phrase was
  moved, and its new home must be confirmed against the inventory.
- Verification seam: the agent-sdk specs above and `server-instructions.spec.ts` (the ≤512 budget
  and the row parse still hold). C AC7: `sdk-query-runner` spec asserts the core is still
  appended.
- Files: REWRITE `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`; MODIFY
  `ptah-core-prompt.spec.ts`, `prompt-harness/index.ts`, `libs/backend/agent-sdk/src/index.ts`,
  `sdk-query-options-builder.ts` (JSDoc only); docs `docs/ptah-prompt-mapping.md` if it exists
  (Assumption: check the path).

### C-2. Template partial cleanup (agent-generation)

- Purpose: C AC4 for the partial.
- Responsibilities:
  - Delete `templates/agents/_shared/engineering-hygiene.md`.
  - Remove `'ENGINEERING_HYGIENE'` from `SHARED_BLOCK_IDS` (`template-partial-resolver.ts:74`).
  - Rewrite guard section (j) (`template-sharing.guard.spec.ts:1156-1200`) so it asserts the four
    roles carry an identical hygiene block and that no template uses `STATIC:ENGINEERING_HYGIENE`.
    The comparison takes the block from `backend-developer.template.md` between its first
    "- Engineering hygiene:" line and the "- Runtime cost:" line.
  - Run `npm run manifest:generate`, then `npm run manifest:check`. `content-manifest.json`
    drops `_shared/engineering-hygiene.md`.
- Failure behaviour: users on old app versions keep a stale downloaded copy of the partial.
  Nothing references it, so it is harmless.
- Verification seam: `template-sharing.guard.spec.ts`, `template-partial-resolver` specs,
  `manifest:check`.
- Files: DELETE `libs/backend/agent-generation/templates/agents/_shared/engineering-hygiene.md`;
  MODIFY `libs/backend/agent-generation/src/lib/services/template-partial-resolver.ts`,
  `template-sharing.guard.spec.ts`, `content-manifest.json` (generated).

### C-3. Deny-list rendering — explicit no change (decision #20, C AC6)

- Purpose: prove that Phase C leaves the six `NO_BROWSER_NO_WEB` deny lists exactly as they are.
- Responsibilities:
  - **No production change.** `subagent-tool-allowlist.ts` is not edited by any Phase C
    component.
  - Extend `subagent-tool-allowlist.spec.ts` with an effective-set regression block:
    - for each of `code-logic-reviewer`, `code-style-reviewer`, `modernization-detector`,
      `project-manager`, `software-architect`, `team-leader`, `getSubagentDisallowedTools`
      (`subagent-tool-allowlist.ts:96-108`) returns exactly the 13 names `mcp__firecrawl`,
      `mcp__ptah__ptah_web_search` and the 11 `mcp__ptah__ptah_browser_*` tools, in that order;
    - `formatDisallowedToolsFrontmatter` (`subagent-tool-allowlist.ts:115`) renders the same line for those six as it does today
      (a literal pinned in the spec), so a later shortening attempt fails loudly;
    - no other row changes (the existing exact-row table, `:39-57`, stays).
- Verified contracts: `NO_BROWSER_NO_WEB` (`subagent-tool-allowlist.ts:53-57`), the six rows
  (`:66-73`), `getSubagentDisallowedTools` (`:96-108`), the existing exact-row spec
  (`subagent-tool-allowlist.spec.ts:39-57`).
- Dependencies: none. File-disjoint from C-1 (agent-sdk) and C-2 (`template-partial-resolver.ts`,
  `template-sharing.guard.spec.ts`).
- Failure behaviour: n/a (spec only). A failure means a Phase C edit changed least privilege and
  must be reverted, not the spec updated.
- Quality requirements: C subagent target is "no regression" (decision #21), measured per the
  measurement procedure.
- Verification seam: `npm run verify -- -t test -p @ptah-extension/agent-generation -- --testPathPatterns=subagent-tool-allowlist`.
- Files: MODIFY `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.spec.ts`
  only.

### D-1. Scope-aware MCP intent store v2 + resolver filter (harness-sync)

- Purpose: record each MCP install against a workspace or as global, and reconcile only what
  applies.
- Responsibilities:
  - File v2:
    ```
    {version: 2,
     servers: {[serverKey]: {registryName, config, installedAt,
                             global?: {targets[]},
                             workspaces?: {[workspaceKey]: {root, targets[]}}}},
     retired: {[serverKey]: {registryName, targets[], config, retiredAt}}}
    ```
    `workspaceKey` is the `resolveHarnessWorkspaceRoot` value (`harness-reconciler.service.ts:170-178`).
  - Reading v1 maps every v1 server into `retired` (D-D3, migration AC1). The first write
    persists v2 atomically (existing retry, `mcp-intent-store.ts:186`).
  - API:
    - `record({serverKey, …, scope, workspaceRoot?})` (workspace requires a root; it throws a
      typed error otherwise);
    - `listFor(workspaceRoot)` → global entries plus this workspace's targets;
    - `makeGlobal(serverKey, workspaceRoot, extraHomeTargets[])`;
    - `forget(serverKey, {scope, workspaceRoot?, targets?})`;
    - `listRetired()`;
    - `scopeOf(serverKey, workspaceRoot)` for the UI.
  - `PluginConfigSourceResolver.resolve(ws)` uses `listFor(ws)` (`plugin-config-source-resolver.ts:175,294`).
- Failure behaviour: a corrupt file reads as empty (existing, `:156-175`) and never widens.
- Verification seam: store specs (v1→retired mapping, round trip, merge rules, workspace
  isolation). Resolver spec: an install in A is absent from B's built manifest (D AC1).
- Files: REWRITE `libs/backend/harness-sync/src/lib/sources/mcp-intent-store.ts` + spec; MODIFY
  `…/sources/plugin-config-source-resolver.ts` + spec, `…/sources/harness-source.port.ts` (if
  the `mcpIntents` shape changes).

### D-2. Retired-source registry and retirement removal policy (harness-sync + shared)

- Purpose: make legacy roots and intents inactive everywhere, and make the reconciler delete only
  proven copies of them.
- Responsibilities:
  - Shared constant and schema:
    - `SKILLS_SH_RETIRED_FILE = '.ptah-skillssh-retired.json'` in `~/.ptah/plugins`, with shape
      `{version:1, roots: {[rootId]: {retiredAt}}}`;
    - helper `isRetiredSourceRef(sourceRef, registry)` for `skills-sh:<root>`;
    - `SKILLS_SH_OWNER_MARKER = 'ptah.skills-sh.root.v2'` (D-D8), read by D-3 and D-6;
    - these sit next to `isOptOutPluginId` (`origin-sidecar.types.ts:112-117`).
  - `discoverSkillsShPluginPaths()` (`plugin-loader.service.ts:1476`) skips retired ids. This
    covers `:656,692,1398,1670`.
  - `buildSkills` pass 1 skips user-layer clones whose sidecar `sourceRef` is retired.
  - Reconciler option `retired: {skillSourceRoots: string[], mcpServerKeys: string[]}`, filled
    by the resolver from the registries on every pass. A removal (`HarnessPlanRemove`) whose
    manifest `source` lies under a retired root, or whose MCP key is retired, is executed only
    when all of these hold:
    1. the current content hash equals the manifest `hash`;
    2. the path is provably untracked (D-D7): `git ls-files --error-unmatch -- <relPath>` run
       with an argument array and a 5 s timeout, cwd = the workspace root:
       - exit 0 → tracked → kept, reason `git-tracked`;
       - exit 1 **and** stderr contains `did not match any file(s) known to git` → untracked →
         eligible;
       - git missing (`ENOENT`), timeout, exit 128 (not a repository) or any other exit or
         stderr → unverifiable → kept, reason `unverifiable`;
       - home-config targets are outside any repository and skip this check (rule 3 applies);
    3. the target is a workspace file, or a home-config key whose entry config hash equals the
       manifest hash.
    Otherwise the entry is **disowned**: it is removed from the manifest and the file stays. It
    is reported as `keptRetired` with a reason (`edited` | `git-tracked` | `unverifiable`). It is
    never snapshot-removed (contrast `removedLocalEdit`, `harness-target.port.ts:185-194`).
  - The policy result adds `removedRetired[]` and `keptRetired[]` to `HarnessApplyResult` and
    `HarnessHealth`, for the ledger.
- Failure behaviour: an I/O error on one path → `writeFailed` (existing). The entry stays owned,
  so the next pass retries (idempotent, AC5).
- Security: git through `execFile`-style argument arrays only; the path comes from the manifest
  and is validated as relative inside the root (reuse the existing containment helper used for
  removals).
- Verification seam (senior-tester fixtures from the requirements' risk table):
  - git-tracked copy (exit 0) → kept `git-tracked`;
  - edited copy → kept `edited`;
  - **unchanged, manifest-owned, untracked copy in a real git repo (exit 1 + no-match) →
    removed** (the migration AC2 positive case);
  - same copy in a directory that is not a repository (exit 128) → kept `unverifiable`;
  - git unavailable (stubbed `ENOENT`) and git timeout → kept `unverifiable`;
  - home-config hand-added entry (no manifest key) → untouched;
  - home-config owned unchanged entry → removed, sibling entries preserved;
  - skills.sh root without metadata → retired, kept.
- Files: MODIFY `libs/shared/src/lib/types/origin-sidecar.types.ts` (or a new
  `install-scope.types.ts` beside it), `libs/backend/agent-sdk/src/lib/…/plugin-loader.service.ts`,
  `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts`,
  `…/reconciler/harness-reconciler.service.ts`, `…/targets/harness-target.port.ts`, the
  workspace target and MCP facet removal paths
  (`libs/backend/harness-sync/src/lib/targets/workspace-target.ts` — removal at `:856-870`;
  `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet-planner.ts` — `applyMcpFacet`
  removals at `:156-173`), `health/harness-health.ts`, specs. `plugin-loader.service.ts` is
  **owned by D-3** (single owner); D-2's loader change (skip retired ids) is specified here and
  implemented in D-3's batch.

### D-3. skills.sh workspace roots, scope and conversion (rpc-handlers + agent-sdk loader)

- Purpose: install skills.sh skills into the current workspace by default.
- Responsibilities:
  - `skillsSh:install` params gain `scope?: 'workspace'|'global'` (zod default `'workspace'`,
    `skills-sh-rpc.schema.ts:59-62`). Update the shared contract and its "scope removed on
    purpose" doc (`rpc.types.ts:1544-1558`).
  - Workspace scope root: `workspacePluginsDir(ws)/ptah-skillssh-<id>`
    (`origin-sidecar.types.ts:89-101`).
  - With no workspace, throw a user-visible error: "No workspace is open. Nothing was installed.
    Choose All workspaces to install for every workspace." (AC4).
  - Metadata v2 (D-D8) is written for **both** scopes:
    `{version:2, owner:'ptah', ownerMarker: SKILLS_SH_OWNER_MARKER, source, skillIds,
    installedAt, scope, files:{[relPath]: sha256}}`. `files` lists every regular file under the
    root except the metadata file itself, hashed from the bytes Ptah wrote (computed before the
    metadata write). `SKILLS_SH_OWNER_MARKER = 'ptah.skills-sh.root.v2'` sits with the D-2
    shared constants. Paths are POSIX-relative and validated inside the root.
  - `readMetadata` accepts v1 and v2. A helper `verifyOwnedRoot(rootDir)` returns `owned` only
    when the metadata is v2, `owner === 'ptah'`, the marker equals the constant, every listed
    file exists (via `lstat`, regular file, no link) with a matching hash, and no unlisted file
    exists. Anything else → `unproven` (with a reason). It never infers ownership from a clone
    sidecar or the directory name. D-6 and Make global both use it.
  - Loader: add `discoverWorkspaceSkillsShPluginPaths(ws)` next to
    `discoverWorkspaceHarnessPluginPaths` (`plugin-loader.service.ts:1516`), include it in
    `resolveHarnessOverlayPaths` (`:1534-1553`), and never in `buildMirrorSources`
    (`plugin-activation.ts:332-371`). The builder exempts workspace-root overlay skills from the
    sync selection (D-D4).
  - `skillsSh:listInstalled` returns `scope: 'workspace'|'global'` per item (widen
    `InstalledSkill.scope`, `rpc-agents.types.ts:52-79`).
  - New `skillsSh:makeGlobal {name}` (D-D9). The workspace root is the source of truth until
    the last step:
    1. `verifyOwnedRoot(workspaceRoot)`; unproven → refuse, nothing written;
    2. copy into a staging dir `~/.ptah/plugins/.staging-ptah-skillssh-<id>-<nonce>`;
    3. verify every staged file against the workspace root's `files` hashes;
    4. write global v2 metadata (`scope:'global'`, same `files`) into staging;
    5. atomic rename staging → `~/.ptah/plugins/ptah-skillssh-<id>`;
    6. register/propagate: clear the id from the retired registry, then
       `propagate('skillsSh:makeGlobal')` (the single entry point,
       `skills-sh-rpc.handlers.ts:296-299,474-487`); an outcome that reports the user layer as
       not refreshed counts as a failure;
    7. validate: `verifyOwnedRoot(globalRoot)` is `owned` with scope global, and
       `discoverSkillsShPluginPaths()` lists it;
    8. only then remove the workspace root and re-propagate that workspace.
    - The conversion moves the whole workspace root (every slug in its `skillIds`); metadata is
      written after the files, mirroring the existing install order
      (`skills-sh-source-root.service.ts:145-160`), but into staging so the write can fail
      without touching either install.
    - Existing global root with the same id: if `verifyOwnedRoot` is `owned` and its `files`
      equal the workspace root's, this is a resumed attempt → continue at step 6. Otherwise
      refuse ("a different global install exists"), nothing changed.
  - `skillsSh:uninstall` resolves the scope from the item.
  - A new global install over a retired id clears that id from the retired registry after a
    successful write.
- Verified contracts: handler `skills-sh-rpc.handlers.ts:147-154,314-443`; service `:116-412`.
- Failure behaviour (`makeGlobal`, every case retry-safe; error copy per design-spec: "Could not
  change where {name} is installed."):
  - steps 2–4 fail (copy, hash mismatch, metadata write) → delete staging; workspace root and
    global base unchanged;
  - step 5 fails → delete staging; nothing changed;
  - steps 6–7 fail (propagation or validation) → remove the just-renamed global root (it is
    marker-owned and was written by this call), restore the retired-registry entry if step 6
    cleared one, re-propagate; the workspace install stays intact and active. If that rollback
    itself fails, the global root is left owned and complete, and the next `makeGlobal` resumes
    at step 6;
  - step 8 fails (workspace root removal) → the conversion is reported done with the error
    logged; the next `makeGlobal` or `uninstall` on that workspace sees an owned global root
    with equal hashes and retries only the removal. Until then that workspace lists the skill
    from both roots. Assumption: the overlay dedupes by plugin id; check
    `resolveHarnessOverlayPaths` (`plugin-loader.service.ts:1534-1553`), and if it does not,
    skip a workspace root whose id has an owned global root with equal `files`.
- Verification seam: handler specs (default scope, no-workspace refusal, explicit global, make
  global, list scope). Make global fixtures, each asserting the workspace root is intact and
  still listed afterwards, and that a second call succeeds:
  - copy failure; staged hash mismatch;
  - **global metadata write failure** (injected `writeMetadata` rejection);
  - **propagation failure** (`propagate` rejects, and separately reports the user layer not
    refreshed) → global root rolled back, retired entry restored;
  - validation failure; rollback failure → retry resumes at step 6;
  - workspace-root removal failure → reported done, retry removes only the workspace root;
  - unproven workspace root (v1 metadata, extra file, edited file) → refused, nothing written.
  `verifyOwnedRoot` spec: v2 + marker + all hashes → owned; missing marker, wrong marker, v1,
  one edited file, one unlisted file, a symlink → unproven. Loader spec: a workspace root is
  visible only for its own workspace and absent from the mirror sources; a retired id is
  skipped (D-2).
- Files: MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts`,
  `skills-sh-rpc.schema.ts`, `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.ts`,
  `skills-sh-source-root.ts`, `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `plugin-loader.service.ts` (**sole
  owner**: D-3 also carries D-2's retired-id skip), the `skillsSh:*` contract edits in
  `rpc.types.ts` are made by D-4's owner (single owner, see handoff), `apps/ptah-electron/src/activation/plugin-activation.ts` (comment/guard
  only), specs.

### D-4. MCP install surfaces: directory RPC, external plugins, harness apply, harness tools

- Purpose: workspace default on every MCP writer; home targets need global.
- Responsibilities:
  - `mcpDirectory:install` gains `scope` (default `'workspace'`). The server rejects a
    workspace-scope request that names a home target (`USER_SCOPE_TARGETS`,
    `capability-toggle.types.ts:305-309`) and one made with no workspace (AC4, AC6). It records
    through D-1. `recordInstalledCapability` (`mcp-directory-rpc.handlers.ts:1339-1378`) is
    unchanged.
  - New `mcpDirectory:makeGlobal {serverKey, homeTargets: ('codex'|'copilot'|'antigravity')[]}`
    (home targets opt-in, #19). Installed lists return `scope`.
  - `McpInstallService.install/uninstall` (`mcp-install.service.ts:194-225,553-568`) take a
    scope and a root.
  - External plugins (D-D2, decision #22):
    - `ExternalInstallParams` (`rpc-plugin-marketplace.types.ts:309-321`) gains
      `mcpScope?: 'workspace' | 'global'`; `ExternalInstallParamsSchema`
      (`plugin-rpc.schema.ts:56`) defaults it to `'workspace'`. It is read only on the consented
      call (the one with `consentToken`); the plan call ignores it. The plan result already lists
      `mcpServers`, which is what the UI keys the field on.
    - `installDeclaredMcpServers` (`plugin-rpc.handlers.ts:779-801`) passes the scope and the
      workspace root to `ExternalPluginMcpService.install`.
    - `resolveTargets()` (`external-plugin-mcp.service.ts:271-285`) becomes scope-aware:
      workspace → `claude`, `vscode`, plus detected `cursor` and `opencode`; global → today's
      `ALWAYS_INSTALLED_TARGETS` plus every detected target (`:109-121`). This is the external
      equivalent of the directory preselection rules (#15).
    - Workspace scope with no workspace open → the existing non-fatal warning path
      (`:779-801`) reports "No workspace is open. The plugin's MCP servers were not installed.
      Choose All workspaces to install them for every workspace." The plugin files still install
      (files are a cache, delivery-map row "External plugins (files)").
    - Make global: the servers are ordinary intent v2 records (registry name = plugin id), so
      their installed rows use `mcpDirectory:makeGlobal` with home targets opt-in (#19). No new
      RPC.
    - Uninstall forgets the record in the scope it was installed in (`scopeOf`, D-1).
  - `harness-mcp-install.service.ts:92-96` uses workspace scope.
  - `installMcpServer` tool:
    - `scope?: 'workspace'|'user'` (default `'workspace'`);
    - `'user'` maps to global;
    - workspace scope plus a home target → error "Use scope 'user' to write home-folder CLI
      configs".
  - `createSkill` default becomes `'workspace'` (`harness-namespace.builder.ts:734`). Its
    no-folder error appends "or pass scope: 'user' to install for every workspace".
  - Update both tool schemas and descriptions (`tool-description.builder.ts:1515-1566,1660-1715`)
    and the help text (`system-namespace.builders.ts:230-238`).
- Failure behaviour: typed user errors with no host text (RpcUserError pattern in rpc-handlers;
  plain `Error` messages in vscode-lm-tools tool results, following the existing tool pattern).
- Verification seam: handler and service specs for each default, the home-target refusal, the
  explicit global path (writes as today) and makeGlobal. External plugin specs: default
  `mcpScope` records a workspace intent with workspace targets only; explicit `'global'`
  records a global intent with today's targets; a workspace install is absent from a second
  workspace's built manifest; no workspace + workspace scope → warning, no intent. Tool specs for
  D AC3.
- Files: MODIFY `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`,
  `…/handlers/plugin-rpc.handlers.ts`, `libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.ts`,
  `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts` (Verified path),
  `…/handlers/plugin-rpc.schema.ts`, `libs/shared/src/lib/types/rpc/rpc-plugin-marketplace.types.ts`,
  `libs/shared/src/lib/types/rpc.types.ts` (**sole owner** of every Phase D edit to this file:
  MCP directory, `skillsSh:*` and notice contracts), `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts`,
  `…/mcp-core/tool-description.builder.ts`, `…/namespace-builders/system-namespace.builders.ts`,
  `libs/shared/src/lib/types/rpc/rpc-harness.types.ts` (if the scope type lives there), specs.

### D-5. Skill sync gate default (harness-sync, #17)

- Purpose: stop deriving `'all'` for undecided workspaces.
- Responsibilities: `resolve()` migration rule (`skill-sync-gate.ts:108-114`): a workspace with
  owned skill entries derives `'selected'` with exactly the owned slugs (from `hasOwnedSkills`'s
  manifest scan, `:194-202`). A workspace with no entries stays `'selected'` + `[]`. A recorded
  mode is never changed (`:124-139`).
- Verification seam: gate specs (derive owned slugs; recorded `'all'` kept).
- Files: MODIFY `libs/backend/harness-sync/src/lib/state/skill-sync-gate.ts` + spec.

### D-6. `InstallScopeMigrationService` (rpc-handlers) + Electron boot wiring

- Purpose: the one-time migration (Requirement 5) and the notice state.
- Responsibilities (idempotent):
  1. **Retire.**
     - For every `~/.ptah/plugins/ptah-skillssh-*` root, write its id to the retired registry
       (D-2).
     - MCP v1 entries are already in `retired` (D-1 read mapping). Persist v2.
     - Bundled plugins, `external/` and synced skills are never touched (AC7).
  2. **Global deletes with proof.**
     - A skills.sh root is deleted only when `verifyOwnedRoot(root)` (D-3, D-D8) is `owned`:
       v2 metadata with the explicit Ptah owner marker, every file listed with a matching hash,
       no unlisted file. A matching user-layer clone sidecar or a `ptah-skillssh-*` directory
       name is **never** ownership proof for the root. Every other root — all v1 roots
       included — is retired, kept and counted `onDisk` (AC3).
     - User-layer clones of retired roots are deleted when the live hash equals `sourceHash` and
       `diverged` is false; otherwise they are kept, inactive (D-2 filter), and counted `kept`.
       Reuse `user-layer-orphan-reaper.ts` semantics; extend its result to report paths rather
       than reimplementing.
  3. **Workspace pass.** For each known workspace (recent workspaces ∪ open folders, existing
     directories only), run `reconcile(ws, {mode:'full', reason:'install-scope-migration'})`,
     which applies the D-2 policy. Collect `removedRetired` / `keptRetired`. Home-config entries
     go through the same policy (AC4).
  4. **Ledger** (D-D10). `~/.ptah/migrations/install-scope.json`:
     ```
     {version:1,
      items:{[itemId]:{kind, retired:boolean, onDisk?:path, outcome?,
                       removedPaths:{[absPath]: removedAt},
                       keptPaths:{[absPath]: reason},
                       failedPaths:{[absPath]: lastError}}},
      workspaces:{[workspaceKey]: {passedAt?}},
      completedAt?, noticeSeenAt?}
     ```
     - `itemId` is `skills-sh:<rootId>` or `mcp:<serverKey>`, so an item counts once however
       many workspaces it reached.
     - After **every** step that deletes or keeps something (each global delete, each workspace
       reconcile), its `removedRetired` / `keptRetired` / `writeFailed` paths are merged into
       the ledger and the ledger is written atomically before the next workspace starts. A path
       that later succeeds moves from `failedPaths` to `removedPaths`; a removed path never
       leaves `removedPaths`. This matters because the reconciler prunes a removed path's
       manifest entry, so a retry no longer reports it (`workspace-target.ts:856-862`), and MCP
       removal can succeed for one fragment and fail for the next (`mcp-facet-planner.ts:156-173`).
     - The four counts derive from the persisted ledger only: retired items; deleted copies =
       size of the union of `removedPaths`; kept files = union of `keptPaths` minus any path also
       in `removedPaths`; onDisk sources.
     - A failure → log it, keep the path in `failedPaths` and leave that workspace's `passedAt`
       unset. The next start re-runs global deletes for items with failed paths and reconciles
       only workspaces without `passedAt`.
     - `outcome` is set per item once it has no `failedPaths` (`removed` if any removed path,
       else `kept` if any kept path, else `onDisk` or `retired`). `completedAt` is written only
       when every eligible item has an outcome and every known workspace has `passedAt` (AC5).
  5. **Notice RPCs** (prefix `harness:`, already allowlisted):
     - `harness:get-install-migration-notice` → `null` unless `completedAt && !noticeSeenAt`
       and some count > 0. Otherwise it returns the counts plus the kept paths and the onDisk
       entries (design-spec §3, #16).
     - `harness:dismiss-install-migration-notice` sets `noticeSeenAt`.
- Wiring: register in the shared rpc-handlers registration (all hosts resolve it; update
  `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`). Invoke only from Electron
  `boot-heavy-services.ts`, **before** `refreshUserLayer` (`:204`), inside try/catch, never
  awaited by window creation (D-D5, assumption 4).
- Failure behaviour: every exception is caught and logged; the app start proceeds (AC5).
- Security: deletes only under the proofs above (owner marker + every hash for roots, D-D8; the
  clone's own sidecar for clones; the D-2 policy for workspace copies); never follows links (use `lstat`); the
  reconcile pass goes through the reconciler's lock.
- Verification seam: service spec with tmp-dir fixtures (the risk-table set plus idempotence:
  the second run changes nothing and does not recount; a partial failure followed by a retry
  completes and writes `completedAt` once). Added in round 1:
  - **two-workspace partial failure, notice count**: server `mcp:S` owned and unchanged in
    `.mcp.json` of W1 and W2 (both untracked in real git repos). Run 1: W1 removal succeeds,
    W2's fragment removal is injected to fail → no `completedAt`, ledger `removedPaths` holds
    W1's path, `failedPaths` W2's. Run 2: W2 succeeds → `completedAt` set; the notice reports
    retired 1 and removed **2** (not 1 from the last pass, not 3 from double counting);
  - a mixed pass in one workspace where one MCP fragment is removed and a second fails →
    the removed one is counted after the retry;
  - legacy v1 skills.sh root whose user-layer clone sidecar matches its content → root retired
    and counted `onDisk`, **not** deleted; the clone itself follows the clone rule;
  - v2 root with a valid owner marker and all hashes → deleted; same root with one edited file
    or the marker removed → retired, `onDisk`. RPC specs for the notice (null before completion;
  shown when retired-only; persists until dismissed).
- Files: CREATE `libs/backend/rpc-handlers/src/lib/install-scope/install-scope-migration.service.ts`
  + spec, `…/install-scope/install-scope-notice-rpc.handlers.ts` + spec; MODIFY
  the notice contract in `libs/shared/src/lib/types/rpc.types.ts` (written by D-4's owner,
  see handoff), `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, the rpc-handlers DI
  registration, `apps/ptah-electron/src/activation/boot-heavy-services.ts`,
  `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`,
  `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-orphan-reaper.ts` (result
  paths only).

### F-D1. Shared `InstallScopeFieldComponent` + MCP directory integration (chat-ui)

- Purpose: design-spec §2 shared control.
- Responsibilities:
  - Native `fieldset`/`legend`, two radios ("This workspace" / "All workspaces") and help copy
    per scope.
  - With no folder, nothing is preselected and the primary button stays disabled.
  - MCP directory:
    - radios above the targets fieldset;
    - workspace scope preselects the 4 workspace targets and shows the 3 home targets disabled
      with a "Global only" badge;
    - explicit global preselects all 7 (#15);
    - each home target remembers its choice across scope switches.
  - Install passes `scope`.
  - Installed rows show a scope badge. "Make global" opens the conversion state with the 3 home
    targets unchecked (#19).
- Files: CREATE `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/install-scope-field.component.ts`
  + spec; MODIFY `mcp-directory-browser.component.ts` + spec, `installed-mcp-groups.ts`,
  `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts`,
  `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts` (**sole owner** of
  every Phase D edit to this store, including the skills.sh scope fields F-D2 and F-D4 read).

### F-D2. skills.sh install panel, installed scope, sync-gate copy (chat-ui + marketplace)

- Purpose: design-spec §2 for skills.sh, and #17 copy.
- Responsibilities:
  - **Install** opens `ptah-storefront-panel` (`storefront-panel.component.ts:52`) with the
    scope field. The primary button reads "Install to this workspace" / "Install to all
    workspaces".
  - Installed rows show the scope badge, "Make global" (`skillsSh:makeGlobal`) or "Available
    everywhere".
  - `plugin-catalog-panel.component.ts:235-300` copy: "All of them" means skills installed for
    all workspaces plus this workspace's own; the derived-mode text drops the implication that
    every global install lands here.
- Files: MODIFY `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/skill-sh-browser.component.ts`
  + spec, `plugin-catalog-panel.component.ts`, `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`,
  `installed-skill-rows.ts`, specs.

### F-D4. External-plugin install: MCP scope field (marketplace)

- Purpose: surface decision #22 on the external-plugin install, reusing
  `InstallScopeFieldComponent` (F-D1) with the approved vocabulary, copy and states
  (design-spec §2 "Shared control").
- **UI delta — settled by decision #25.** design-spec.md §2 places the shared control on
  the skills.sh storefront panel and the MCP directory only; decision #25 extends its reuse
  to this existing external-plugin consent dialog, with no new surface, prototype or Gate 1.7.
  Required placement:
  - inside the existing "This plugin declares MCP servers" block of
    `external-consent-dialog.component.ts:276-300`, after the server list, rendered only when
    `plan().mcpServers.length > 0` (no field, no change for plugins without servers);
  - legend "Install servers for"; options and help copy exactly as §2 (MCP help line for the
    workspace option); default "This workspace"; no folder open → §2 no-folder state, except
    that the consent button stays enabled because the plugin files still install; only the
    servers are skipped, and the help line says so;
  - the confirm call sends `mcpScope` with the consent token
    (`external-marketplaces.component.ts:873`, the consented `plugins:install-external`);
  - installed rows for these servers get the §2 scope badge and "Make global" through F-D1's
    installed-servers integration (no extra row component).
  - **Mandatory consent-copy correction (#25):** replace the block's false text "Ptah will NOT
    register or run these servers…" (`external-consent-dialog.component.ts:289-294`); the backend
    does register declared servers (`external-plugin-mcp.service.ts:149-153,184-199`). Required
    replacement: "Ptah adds these servers to the scope you choose below. Review each command
    before you continue." The rest of the block (verbatim command lines) is unchanged. This
    correction is part of F-D4, not a recommendation or a pending sign-off.
- Failure behaviour: the backend's non-fatal MCP warning (D-4) is shown with the existing
  install-result warnings; the plugin install itself is not failed.
- Quality requirements: §2 accessibility (native `fieldset`/`legend`, focus-visible ring,
  arrow-key radios) inside the dialog's focus trap; verified in Electron.
- Verification seam: dialog spec (field absent without servers; default workspace; global
  selection sent on confirm; no-folder state keeps confirm enabled, sends `mcpScope:'global'`
  only after the user picks All workspaces, and otherwise shows the skipped-servers warning);
  assert the corrected consent copy replaces the false registration claim. Completion evidence
  must include **four Electron screenshots of this dialog**: **before dark**, **before light**,
  **after dark**, and **after light**. Capture both before screenshots from the unchanged/base
  version before the F-D4 change, and both after screenshots after implementation. The after
  pair must show the scope field and corrected copy in dark and light themes. No additional
  designer/orchestrator sign-off gate applies (#25/#26).
- Files: MODIFY `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts` + spec,
  `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts` + spec.

### F-D3. `InstallScopeMigrationNoticeComponent` (chat)

- Purpose: design-spec §3. One region card at the top of the chat view; counts, bullets and
  details; "Open Marketplace" (`appState.setCurrentView('marketplace')`) and "Got it" both
  dismiss; focus then moves to the chat input.
- **Carry the round-2 Minor note:** any example or fixture path for a retained skills.sh source
  uses the real legacy root form `~/.ptah/plugins/ptah-skillssh-<name>`, never
  `~/.agents/skills`.
- Files: CREATE `libs/frontend/chat/src/lib/components/molecules/notifications/install-scope-migration-notice.component.ts`
  + spec; MODIFY `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` / `.html`.

## Integration architecture

- Data flow:
  - **A/B:** settings card → `agent:setConfig` → file setting → session build (A-2) or lane
    assembly (A-3) → A-1 policy plus synced reader → `disallowedTools` and flag
    `skillOverrides` → CLI child (main and inherited subagents).
  - **D install:** UI scope → RPC (zod) → root dir or intent v2 record for workspace W →
    propagate → reconcile W → `listFor(W)` / workspace overlay → W's target files. Reconciling X
    finds nothing. External plugin MCP: consent dialog scope → `plugins:install-external`
    (`mcpScope`) → `ExternalPluginMcpService.install(scope, root)` → intent v2 record → the same
    reconcile path.
  - **D make global (skills.sh):** verify owned → stage → hash → metadata → rename → propagate →
    validate → remove workspace root (D-D9).
  - **D migration:** Electron heavy boot → retire (registries) → proven global deletes →
    reconcile known workspaces under the retired policy → ledger → notice RPC → chat card.
- State or persistence:

  | State | Owner | Lifetime |
  | --- | --- | --- |
  | Opt-in lists | file settings, global | permanent |
  | Intent v2 | harness-sync store | permanent |
  | Retired registries (skills.sh file, MCP `retired`) | harness-sync / shared | permanent |
  | Migration ledger | rpc-handlers service | permanent; the notice is one-shot |
  | Workspace roots | `{ws}/.ptah/plugins` | removed by uninstall, or by makeGlobal only after the global root validates |
  | Make-global staging | `~/.ptah/plugins/.staging-ptah-skillssh-*` | one call; deleted on failure |

- External boundaries:
  - RPC params are validated with zod at the handler (scope enum, ids, target enum).
  - The synced manifest and skills.sh metadata are parsed with schemas; a malformed file counts
    as absent.
  - Git runs through argument arrays with a timeout; only exit 1 + no-match counts as
    untracked (D-D7).
  - skills.sh metadata is trusted for deletion only with the Ptah owner marker and matching
    per-file hashes (D-D8).
  - `mcpScope` on `plugins:install-external` is a zod enum, read only on the consented call.
  - No host error text reaches the UI (fixed copy).
- Failure and rollback:
  - Each phase is a separate PR and reverts cleanly.
  - A/B revert: the settings keys are ignored once their reader is gone.
  - C revert: text only, plus the manifest regeneration.
  - D cannot be fully reverted for files it deleted. That is the reason for the proof rules.
    State reverts by deleting the ledger and the skills.sh retired file. The MCP v2 file is not
    readable by older builds (they expect v1); a rollback build must treat an unknown version as
    empty, which the existing corrupt-file path does (`mcp-intent-store.ts:156-175`), so a
    rollback loses those intents but does not crash.
- Observability:
  - Make global: one structured log per step reached and per rollback.
  - Builder info log: the counts of disallowed tools and denied built-in or synced skills, never
    names of account skills at info level.
  - Migration: one structured log per item outcome plus a summary.
  - Reconcile health gains `removedRetired` / `keptRetired`.

## Architecture-level quality requirements

- Functional: the A AC1–AC8, B AC1–AC7, C AC1–AC7 (AC6 = no change, C-3, decision #20) and D AC0–AC6 /
  migration AC1–AC7 checks, as mapped in the verification seams above.
- Performance: the synced reader adds at most one readdir and the manifest reads per session
  build (mtime-cached). The migration's workspace pass is bounded by the recent-workspaces list.
- Security: no toggle widens an unverified policy (A-2 rule); deletes need hash proof and must
  not be git-tracked; argument-array git; schema-validated inputs.
- Maintainability:
  - No new lib and no new `vscode-core` import in host-neutral libs.
  - Dependency directions stay: cli-agent-runtime → agent-sdk; rpc-handlers → harness-sync and
    agent-generation; agent-sdk never imports rpc-handlers.
  - New RPCs use the existing `agent:`, `skillsSh:`, `mcpDirectory:` and `harness:` prefixes.
- Testability: every "change" row of the delivery map has a spec. The migration fixtures cover a
  git-tracked copy, an edited copy, an unchanged manifest-owned untracked copy (removed), a
  non-repository and a git-unavailable case (kept), a skills.sh root without metadata, a legacy
  root with a matching clone (retired, not deleted), an owned v2 root (deleted), a hand-added
  home entry, idempotent re-runs, a partial failure and the two-workspace notice count. Make
  global covers metadata-write and propagation failures. C-3 pins the six effective deny sets.

## Measurement procedure (each phase PR; NFR)

1. Baseline: the merged previous phase (main for A) with default settings, the same account,
   provider, workspace and installed content.
2. Start ≥3 fresh main sessions and ≥3 fresh subagent sessions on each side. For subagents,
   spawn the same generated agent type with the same prompt.
3. Per session, the figure is `input_tokens + cache_creation_input_tokens +
   cache_read_input_tokens` of the first assistant turn in `~/.claude/projects/*/<id>.jsonl`.
   Also record the `api-request-shape` tool names. The A/B checks are: no default-off tool
   schema, and none of the denied skills in the listing.
4. Report the medians and the raw values in the PR, with the project set verified.
5. A0 (before Phase A code): one main session, one subagent, one proxied session and one
   named-account session, with flag settings hand-set to the A-2 output. This confirms
   assumptions 1–3. If assumption 2 fails for synced skills, stop B and report; do not switch to
   bare names.

## Team-leader handoff

- Recommended executors:
  - backend-developer: A0 spike, A-1, A-2, A-3, A-4, C-1, C-2, D-1, D-2, D-3, D-4, D-5, D-6.
  - frontend-developer: F-A, F-D1, F-D2, F-D3, F-D4.
  - senior-tester: **C-3** (spec-only, owns `subagent-tool-allowlist.spec.ts` alone; file-disjoint
    from C-1 and C-2), the D-2, D-3 Make global and D-6 fixture suites, and the measurement runs.
  - Cross-side reviewer (codex): the rule inventory before C-1 deletes anything.
- Complexity: HIGH. There are four PRs. Phase D changes persisted formats and deletes user-side
  files under proof rules.
- Dependencies and ordering (component level only):
  - Phase A: A0 → A-1 → (A-2, A-3, A-4 in parallel) → F-A.
  - Phase B: extends A-1 (synced reader), A-2, A-4 and F-A (group 3).
  - Phase C: C-1, C-2 and C-3 are independent (C-3 is spec-only).
  - Phase D:
    - D-4's owner writes **all** Phase D contract edits first: `libs/shared/src/lib/types/rpc.types.ts`
      (MCP directory, `skillsSh:*`, notice), `rpc-agents.types.ts` `InstalledSkill.scope`,
      `rpc-plugin-marketplace.types.ts` `mcpScope`; D-3 and D-6 consume them and do not edit
      those files;
    - D-1 and D-2 come first among the services;
    - D-3 depends on D-2 and owns `plugin-loader.service.ts` alone (it implements D-2's
      retired-id skip as well);
    - D-4 depends on D-1;
    - D-5 is independent;
    - D-6 depends on D-1 to D-3;
    - F-D1 depends on D-4 and owns `marketplace-inventory.store.ts` alone; F-D2 depends on D-3,
      D-5 and F-D1's store edit; F-D4 depends on D-4 and F-D1 (shared field); F-D3 on D-6.
- Parallel-safe work:
  - A-2 ∥ A-3 ∥ A-4;
  - C-1 ∥ C-2 ∥ C-3 (C-3 touches only `subagent-tool-allowlist.spec.ts`);
  - D-1 ∥ D-5;
  - D-3 ∥ D-4 once the contract edits have landed (D-4's owner holds the shared type files);
  - D-2 (harness-sync: `workspace-target.ts`, `mcp-facet-planner.ts`, reconciler, manifest
    builder, health) ∥ D-4 (rpc-handlers, cli-agent-runtime, vscode-lm-tools);
  - F-D2 ∥ F-D4 after F-D1 (F-D1 owns the store; F-D4 owns the two external-plugin files).
- Files affected:
  - CREATE:
    - `claude-builtin-catalog.ts` + spec;
    - `synced-claude-skills.reader.ts` + spec;
    - `claude-builtins-config.component.ts` + spec;
    - `install-scope-field.component.ts` + spec (reused by F-D4);
    - `install-scope-migration.service.ts` + spec;
    - `install-scope-notice-rpc.handlers.ts` + spec;
    - `install-scope-migration-notice.component.ts` + spec.
  - REWRITE: `ptah-core-prompt.ts`, `mcp-intent-store.ts`.
  - DELETE: `templates/agents/_shared/engineering-hygiene.md`.
  - MODIFY: every file listed under the components above (including
    `subagent-tool-allowlist.spec.ts`, `plugin-rpc.schema.ts`, `rpc-plugin-marketplace.types.ts`,
    `external-plugin-mcp.service.ts`, `external-consent-dialog.component.ts`,
    `external-marketplaces.component.ts`, `workspace-target.ts`, `mcp-facet-planner.ts`), plus
    `content-manifest.json` (generated).
- Settled F-D4 UI requirement (#25/#26): reuse the shared scope field in the existing
  external-plugin consent dialog and correct its false registration copy as mandatory work;
  no new prototype/Gate 1.7 or designer/orchestrator acknowledgement is required. Capture
  before dark + before light Electron screenshots from the unchanged/base version before the
  F-D4 change, then after dark + after light screenshots after implementation: all four are
  required completion evidence.
- Release behaviour to state in the Phase D PR: VS Code and the CLI keep legacy behaviour until
  Electron has run once on the machine (D-D5, #23).
- Verification points (projects per phase; confirm dependents read-only with
  `npx nx show projects --affected --base=main` before running):
  - A: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime,@ptah-extension/platform-core,@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/chat,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
  - B: same set as A.
  - C: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/agent-generation,@ptah-extension/vscode-lm-tools,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine`, plus `npm run manifest:check`.
  - D: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/agent-sdk,@ptah-extension/agent-generation,@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools,@ptah-extension/chat-ui,@ptah-extension/marketplace,@ptah-extension/chat,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
  - Contracts to honour:
    - `rpc-allowlist.spec.ts`;
    - `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`;
    - `container.smoke.spec.ts` via `expected-resolvable.ts`;
    - `server-instructions.spec.ts` (≤512);
    - `template-sharing.guard.spec.ts`;
    - `mcp-mandate-manifest.spec.ts`;
    - `vendor-roster-drift.spec.ts`.
  - QA (requirements): `/code-review` with defaults and with ReportFindings + code-review on;
    `/loop` → `sleeping` + ScheduleWakeup chip; replay of an old transcript containing Workflow
    or ScheduleWakeup; one proxied and one named-account session start and stream.

## Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Subagents do not inherit `disallowedTools` (assumption 1) | A0 checks it first. Fallback for generated agents only: append the 6 tools to their frontmatter through `subagent-tool-allowlist.ts`. Built-in agent types cannot be covered; report it and revise A AC2 |
| `skillOverrides` does not hide synced skills under the qualified key | A0 gate; B stops and reports. No bare-name fallback (B AC6) |
| Phase A and C miss their targets (A ≥2.5k, C main ≥1k, C subagent no regression) | Targets already revised before build (decision #21); measurement procedure reports medians and raw values per PR |
| A rule disappears in C | Inventory review by codex; specs assert the deferral phrases |
| Migration deletes user work | Independent proofs: manifest hash, git exit 1 + no-match only (D-D7), owner marker + every file hash for roots (D-D8); disown-not-delete; risk-table fixtures; `lstat` |
| Untracked derived copies wrongly kept forever | D-D7 treats exit 1 + no-match as eligible; positive fixture must remove the copy |
| Make global loses an install | D-D9 order; workspace root removed last; metadata-write and propagation-failure fixtures |
| Notice undercounts after a retry | Per-path ledger (D-D10); two-workspace fixture |
| VS Code / CLI users see legacy global installs until Electron runs once | Accepted (D-D5, decision #23); stated in the Phase D PR body and release notes |
| Consent-dialog copy contradicts MCP registration | Mandatory F-D4 copy correction (#25/#26), pinned by the dialog spec; four Electron screenshots: before dark/light from the unchanged/base version before change, after dark/light after implementation; no additional sign-off gate |
| v2 intent file read by an older build | Unknown version reads as empty (existing corrupt path); documented in the PR |
| Shared files collide across batches (`plugin-loader.service.ts`, `rpc.types.ts`, `marketplace-inventory.store.ts`) | Single owners: D-3, D-4 and F-D1 respectively (handoff) |
| Rollback | Revert per phase PR. For D, also delete `~/.ptah/migrations/install-scope.json` and `~/.ptah/plugins/.ptah-skillssh-retired.json` to re-activate retired skills.sh roots. Retired MCP intents can be restored from the v2 `retired` section by a reinstall |

## Revision log (Gate 2 round 1)

| Finding (implementation-plan-review.md) | Resolution | Changed sections |
| --- | --- | --- |
| 1. External-plugin MCP had no global option (#22) | Workspace default + explicit opt-in global, same vocabulary and preselection as the directory; Make global via `mcpDirectory:makeGlobal`; scope field in the consent dialog (UI delta flagged) | Codebase evidence; Decisions D-D2; Delivery map "External plugins (MCP)"; D-4; new F-D4; Integration data flow; Handoff; Risks |
| 2. Git test treated untracked as tracked | Exit 0 tracked; exit 1 + no-match untracked (eligible); everything else unverifiable → keep/disown; positive untracked fixture | Codebase evidence; D-D7; D-2 rule 2 and fixtures; External boundaries; Testability; Risks |
| 3. Legacy skills.sh roots lacked ownership proof | v2 metadata with owner marker + per-file hashes; `verifyOwnedRoot`; clone sidecar and directory name never prove a root; legacy roots retire. D-6 counts unchanged | Codebase evidence; D-D6, D-D8; D-3 metadata; D-6 step 2 and fixtures; Security |
| 4. Make global could lose the workspace install | Stage → hash → metadata → rename → propagate → validate → remove workspace root; rollback and resume rules; metadata-write and propagation-failure fixtures | D-D9; D-3 makeGlobal, failure behaviour, seams; State table; Data flow; Risks |
| 5. C AC6 owner and stale targets (#20/#21) | Clarifications closed; C-3 is an explicit no-change component with an effective-set spec, owned by senior-tester (file-disjoint); targets A ≥2.5k, C main ≥1k, C subagent no regression everywhere | Inputs; D-A3; Clarifications (closed); C-3; Functional QRs; Handoff; Risks |
| 6. Wrong target path; shared-file owners | `workspace-target.ts` and `targets/mcp/mcp-facet-planner.ts`; `external-plugin-mcp.service.ts` path verified; single owners: `rpc.types.ts` (+ other shared contract files) → D-4, `plugin-loader.service.ts` → D-3, `marketplace-inventory.store.ts` → F-D1 | D-2 files; D-3 files; D-4 files; D-6 files; F-D1 files; Handoff ordering and parallel work; Risks |
| 7. Ledger lost partial progress | Per-path `removedPaths`/`keptPaths`/`failedPaths` persisted after every step; counts from the persisted union; two-workspace partial-failure notice-count fixture | D-D10; D-6 step 4 and seams; Testability |
| Lane constraint: Electron-only trigger (#23) | D-D5 kept; VS Code/CLI keep legacy behaviour until Electron has run once, stated in the PR and release notes | D-D5; D-D6; Handoff; Risks |

## Revision log (Gate 2 round 2 — final)

| Finding (implementation-plan-review-round1.md) | Resolution | Changed sections |
| --- | --- | --- |
| Serious: settled F-D4 requirements remained optional (#25/#26) | Made consent-copy correction mandatory; required four Electron dialog screenshots (before dark/light from unchanged/base before change; after dark/light after implementation); removed obsolete designer/orchestrator sign-off gates. Original findings 1–7 remain resolved; all other approved decisions and scope unchanged | F-D4 UI delta, copy correction and verification seam; Team-leader handoff UI requirement; Risks and rollback consent-copy row |
