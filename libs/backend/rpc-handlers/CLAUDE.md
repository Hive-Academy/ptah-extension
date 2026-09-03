# @ptah-extension/rpc-handlers

[Back to Main](../../../CLAUDE.md)

## Purpose

Platform-agnostic RPC handler classes shared between the VS Code extension, Electron app, and CLI. Each class owns a single RPC namespace (`session:`, `chat:`, `memory:`, …) and uses zod schemas for boundary validation.

## Boundaries

**Belongs here**:

- One `*-rpc.handlers.ts` per RPC namespace plus its `*-rpc.schema.ts`
- `host-profile/` (capability vocabulary, handler manifest, `registerRpcSurface`) and `verify-and-report.ts`
- Sub-service DI bundles for harness (`HARNESS_TOKENS`) and chat (`CHAT_TOKENS`)
- Cross-cutting helpers used by handlers (`utils/workspace-authorization.ts`)

**Does NOT belong**:

- Platform-specific imports (`vscode`, electron, node IPC) — go through `platform-core` ports
- RPC transport/protocol implementation (`RpcHandler` lives in `vscode-core`)
- Business logic that has its own lib (delegate to `agent-sdk`, `memory-curator`, `workspace-intelligence`, etc.)

## Public API

**Handler classes** (≈30):
Tier 1: `SessionRpcHandlers`, `ContextRpcHandlers`, `AutocompleteRpcHandlers`, `SubagentRpcHandlers`, `LlmRpcHandlers`, `PluginRpcHandlers`, `PtahCliRpcHandlers`.
Tier 2: `SetupRpcHandlers`, `WizardGenerationRpcHandlers`, `ConfigRpcHandlers`, `LicenseRpcHandlers`, `ChatRpcHandlers`, `AuthRpcHandlers`, `EnhancedPromptsRpcHandlers`, `QualityRpcHandlers`, `ProviderRpcHandlers`, `WebSearchRpcHandlers`.
Other: `HarnessRpcHandlers`, `McpDirectoryRpcHandlers`, `GitRpcHandlers`, `WorkspaceRpcHandlers`, `SettingsRpcHandlers`, `MemoryRpcHandlers`, `SkillsSynthesisRpcHandlers`, `CronRpcHandlers`, `GatewayRpcHandlers`, `PersistenceRpcHandlers`, `IndexingRpcHandlers`.

**Registration**: `RPC_HANDLER_MANIFEST`, `registerRpcSurface`, `deriveRpcSurface`, `capabilities`, `HostProfile`, `verifyAndReportRpcRegistration`, `HARNESS_TOKENS`, `registerHarnessServices`, `CHAT_TOKENS`, `registerChatServices`.

**Utilities**: `isAuthorizedWorkspace`, `mintResetChallengeToken`.

**Re-exports**: `IPlatformCommands`, `IPlatformAuthProvider`, `ISaveDialogProvider`, `IModelDiscovery` (canonical home is `platform-core`).

## Internal Structure

- `src/lib/handlers/` — one `*-rpc.handlers.ts` + `*-rpc.schema.ts` per namespace
- `src/lib/handlers/index.ts` — barrel for all handler classes
- `src/lib/harness/` — `HarnessRpcHandlers` sub-services + `HARNESS_TOKENS`
- `src/lib/chat/` — `ChatRpcHandlers` sub-services + `CHAT_TOKENS`
- `src/lib/utils/workspace-authorization.ts` — shared `isAuthorizedWorkspace` (PR-267)
- `src/lib/handlers/external-plugin-mcp.service.ts` — installs the MCP servers an
  external marketplace plugin DECLARES. It lives here, not in
  `plugin-marketplace`, because `McpInstallService` is in `cli-agent-runtime` and
  `plugin-marketplace` depends on neither it nor `harness-sync` (its whole
  dependency set is `shared` + `vscode-core`). `PluginRpcHandlers` was already
  downstream of both and already reconciled after an install, so the seam
  existed. See "Declared MCP servers" below.
- Output-style selection and activation are NOT here. Both moved to `output-styles` when `cli-agent-runtime` started needing the same composition for spawned CLI agents and could not import this lib (`rpc-handlers → cli-agent-runtime`). `OutputStyleRpcHandlers` and `ChatSessionService` import `readOutputStyleSelection` / `OutputStyleSessionActivationService` from `@ptah-extension/output-styles` — do not re-inline either.
- `src/lib/skills-sh/` — the skills.sh SOURCE ROOT: where an installed skill
  lives (`skills-sh-source-root.ts`), the one service that writes it
  (`*.service.ts`), and the legacy `.claude/skills` sweep
  (`*-legacy-adoption.ts`). See "skills.sh source roots" below.
- `src/lib/host-profile/` — `Capability` vocabulary, `RPC_HANDLER_MANIFEST`, `HostProfile`, `registerRpcSurface`
- `src/lib/verify-and-report.ts` — runtime verification of registration completeness

## Key Files

- `src/lib/host-profile/manifest.ts` — `RPC_HANDLER_MANIFEST`, the single source of truth for method ownership + required capabilities. It partitions `RPC_METHOD_NAMES` exactly (asserted in `rpc-allowlist.spec.ts`), which is what makes per-host exclusions derivable instead of hand-maintained.
- `src/lib/host-profile/register-rpc-surface.ts` — the one registration engine; each host calls it with its profile and contains no other RPC code.
- `src/lib/handlers/index.ts` — barrel exported via `src/index.ts`
- Each `*-rpc.handlers.ts` declares `static readonly METHODS` tuple, referenced by its manifest entry
- `src/lib/utils/workspace-authorization.ts` — workspace auth gate used by privileged handlers

## Declared MCP servers (TASK_2026_287)

`MarketplaceManifestSchema` has always accepted `mcpServers`, the installer has
always rendered them in the consent dialog and persisted them in the consent
record — and until this change nothing installed them. The user was told "this
plugin will install these MCP servers", approved, and not one byte reached
`.mcp.json`, `~/.codex/config.toml`, `~/.copilot/mcp-config.json`,
`.cursor/mcp.json` or `~/.gemini/config/mcp_config.json`, because no intent was
recorded and the reconciler never saw them.

Four rules, all pinned by `external-plugin-mcp.service.spec.ts` and the
`external install / uninstall` block of `plugin-rpc.handlers.spec.ts`:

- **The write path is the existing one.** RECORD INTENT, then RECONCILE, through
  `McpInstallService` — the same surface `mcp:install` uses. Nothing here writes
  a config file. Intent first is required: the reconciler's desired MCP state IS
  `~/.ptah/mcp-installed.json`, so recording after the pass leaves it unapplied.
- **The server list comes from the CONSENT RECORD**, never from a fresh manifest
  read. That record is the exact set the dialog showed, so installing from it
  cannot widen the consent surface even if upstream moved between plan and
  confirm.
- **Targets are `claude` + `vscode` + the rival CLIs the detector actually
  finds** — the same `IHarnessCliDetector` the reconciler gates on. Deliberately
  NOT `HARNESS_DEFAULT_MCP_TARGETS` (`['claude','vscode']`): that default is for
  the harness BUILDER, where an AI-designed preset names servers with no
  knowledge of the machine. Here the install is a real user action on a real
  machine, and a user whose day job is Codex should not get the plugin's servers
  only in the two files Ptah can always write. `claude` and `vscode` are
  unconditional because the reconciler never gates them either
  (`ClaudeTarget.detect()` is always true; the VS Code target hardcodes it).
  It is also not "all six" — an undetected target is skipped by the reconciler,
  so asking for one makes `McpInstallService` report a cheerful success for a
  file it never touched.
- **A key an unowned server occupies is REPORTED here and REFUSED there.** The
  service probes the config files BEFORE recording (recording flips
  `managedByPtah` and would hide the collision) and turns each occupied key into
  an `mcpWarnings` entry on the install result. The refusal itself stays the
  reconciler's `foreign`/`blocked` rule; re-deciding ownership here would be a
  second copy of a rule that must have exactly one owner.

Uninstall reads the record BEFORE `ExternalPluginInstallerService.uninstall`
deletes it — afterwards nothing says which keys were the plugin's, and its
servers would outlive it in every config file.

## skills.sh source roots (TASK_2026_288)

`skillsSh:install` used to shell `npx skills add --agent claude-code`, which
writes into `{ws}/.claude/skills` (or `~/.claude/skills` with `-g`). Three
consequences, all defects: the skill reached Claude ALONE (not `.agents/skills`,
`.github/skills`, `.cursor/skills`); `.claude/skills` is a MANAGED directory, so
a path there that no manifest owns is `foreign` by rule and every skills.sh
skill was a permanent unclearable `ptah harness doctor` finding; and `-g` wrote
where the workspace-scoped reconciler cannot look at all.

The fix is not a fourth writer:

- **Content lands in a Ptah-owned source root**,
  `~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/skills/<slug>/`, deliberately the
  `ptah-harness-*` shape. That shape is ALREADY a first-class overlay source —
  `PluginLoaderService.resolveCurrentPluginPaths` yields it,
  `PluginConfigSourceResolver` hands it to `HarnessManifestBuilder.buildSkills` —
  so from there it is ordinary desired state: copied into all six targets,
  hash-gated, manifest-owned, reaped when the root goes away. No new writer, no
  new manifest, no new concept.
- **Overlay-only. It is NOT mirrored into `~/.ptah/user/skills`, and that is
  load-bearing.** The user layer is the desired state's BASE and wins collisions,
  and `UserLayerMirrorService` clones create-if-absent — so a clone would survive
  uninstall and the skill would propagate forever. Overlay-only is what makes
  `skillsSh:uninstall` actually reap. Do not "fix" this by adding a mirror.
- **The CLI is run in a STAGING DIRECTORY.** `skills` has no output-directory
  flag; its only redirection is `-g`. What it does do is resolve every
  project-scope path relative to `process.cwd()`, so cwd IS the output flag.
  `stageSkillsInstall` points it at a scratch tree, the service verifies at least
  one readable slug, moves them into the source root and deletes the scratch —
  so a failed fetch never leaves half a skill somewhere the reconciler would
  propagate. Measured flags (`skills@latest`, 2026-08-18, pinned by
  `skills-sh-cli.spec.ts`): `--agent claude-code --copy -y` writes real files to
  `{cwd}/.claude/skills/<slug>/` plus `{cwd}/skills-lock.json` and touches
  nothing under `$HOME`; omitting `--skill` installs the whole repo;
  `--agent '*'` would symlink instead, which would not survive the move.
- **`scope` and `agents` are gone from `skillsSh:install`.** `scope` chose
  between two directories the reconciler reconciles neither of; per-workspace
  control moved to `disabledPluginIds` / `disabledSkillIds`, which is reversible.
  `agents` was declared, validated and dropped on the floor — target selection
  has one owner, the reconciler fanning out to every detected CLI.
- **Legacy adoption reads a RECORD, never a heuristic.** Skills carry no writer
  signature and never will, so a stale managed copy is indistinguishable from a
  hand-written `SKILL.md`. `skills-sh-legacy-adoption.ts` adopts exactly what
  `{ws}/skills-lock.json` — the third-party CLI's own file — names, and touches
  nothing else. `~/.claude/skills` (the old `scope: 'global'` destination) is
  deliberately NOT adopted: no home-level lockfile exists, so nothing there can
  be told apart from a skill the user installed outside Ptah.
- **Triggers call `HarnessPropagationService.propagate`, never `reconcile`**, and
  a propagation failure never fails the install — the bytes are on disk and every
  host reconciles again at activation.

`source` and `skillId` reach both a `path.join` and a spawned argv. Three layers
check them and all three must agree: the RPC boundary (Zod schema +
`rejectUnsafeInstallRequest`), `skillsShRootId` in the service, and
`stageSkillsInstall` right before the spawn. `SAFE_SOURCE_PATTERN` alone accepts
`../..` and `SAFE_SKILL_ID_PATTERN` alone accepts `..`; `isSafePathToken` (shared)
is the half that rejects them. Never loosen either regex to "simplify" this.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-generation`, `@ptah-extension/plugin-marketplace`, `@ptah-extension/harness-sync`, `@ptah-extension/cli-agent-runtime`, `@ptah-extension/output-styles`
**External**: `tsyringe`, `zod`

## Guidelines

- **Namespace dual-registration (CRITICAL — historical bug source)**: every new RPC namespace requires updates in BOTH places:
  1. **Compile-time**: add the method name to `RpcMethodName` in `libs/shared/.../rpc.types.ts` (the union backs the manifest's `satisfies` assertion).
  2. **Runtime**: add the prefix string to `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`. Missing this causes silent runtime crash — the transport rejects unrecognized prefixes.
- **One handler class per namespace** — name like `<Namespace>RpcHandlers`, file `<namespace>-rpc.handlers.ts`, schema file `<namespace>-rpc.schema.ts`. Add a `RPC_HANDLER_MANIFEST` entry for it in the same change; hosts that cannot serve it simply leave its capability off.
- **Never hand-maintain a method exclusion list** — exclusions are `manifest x profile`. A host that should not serve a namespace turns its capability off in `apps/<host>/src/rpc-host-profile.ts` (or `cli-engine/.../cli-host-profile.ts`).
- **Zod schemas mandatory** — every handler method validates params via its schema file before doing work.
- **Zod validates INBOUND params. `skillSynthesis:digest` is the one deliberate exception, and it does not generalize.** `SkillDigestItemSchema` validates the items this handler returns on the way OUT, which nothing else here does. It is kept because the digest's evidence invariant is otherwise unenforceable: `sessionIds.min(1)` means "every ranked item can show you why it ranked", and without the parse a contract violation reaches the UI as a silently empty evidence list rather than an error. User-decided 2026-08-16 (TASK_2026_180). **Do not copy this into new handlers, and do not delete it here.** Adopting outbound validation as house style is a real decision with a 30-handler sweep behind it; reverting this one is a decision to let that invariant go unenforced. Neither is a drive-by edit.
- **`auth:getAuthStatus` is CACHED, and any new auth-mutating method must invalidate it (TASK_2026_342).** Entries are keyed by `${scopeResolver.getActivePath() ?? ''}|${params.providerId ?? ''}` — the two inputs the payload varies with — held for `AUTH_STATUS_CACHE_TTL_MS` (15s), with in-flight coalescing on the same key so concurrent callers share one computation. Claude-CLI health is memoised SEPARATELY for `CLAUDE_CLI_HEALTH_TTL_MS` (5min) because `performHealthCheck` spawns `claude --version` on every call and that spawn was the bulk of the measured 2-5.3s durations. `invalidateAuthStatusCache()` is called by `auth:saveSettings`, `auth:setApiKey`, `auth:copilotLogin`, `auth:copilotLogout`, `auth:codexLogin`, `auth:clearWorkspaceOverride`, and by the optional `SdkAdapterEvents.onAuthFileChanged` subscription wired in `register()` (an external `codex login` reaches no method here). **`auth:testConnection` deliberately does NOT invalidate** — it mutates nothing, and every path that reaches it already went through `saveSettings` or `setApiKey`. Path-keying is what makes a workspace switch correct without invalidating on switch, and what makes switching BACK to an already-visited folder free. **Clearing the maps is only half of `invalidateAuthStatusCache()` — it also bumps a monotonic `cacheGeneration`, and every write-back is conditional on that generation still being current.** Without it, a computation already in flight when the invalidation happened resolves afterwards and writes its PRE-change payload into the freshly-cleared cache with a full 15s TTL, so a `codex login` that completes mid-probe is undone by the probe it raced. The same guard covers the 5-minute Claude-CLI memo, where a stale write-back would outlive a status entry twenty times over. The in-flight map is also deleted **by identity, not by key**: an invalidated computation settling must not evict the newer one that already claimed its key. Same idiom as `WorkspaceCoordinatorService`'s `switchGeneration`.
- **Every external probe in `computeAuthStatus` is capped at `AUTH_PROBE_TIMEOUT_MS` (5s), and the cap is what makes `Promise.all` safe.** Running the probes in parallel removed the SUM of their latencies but not the MAX: the handler still costs whatever the slowest source costs, so one wedged provider holds the whole payload and, with it, the first render. Measured on the 2026-08-29 smoke boot: `auth:getAuthStatus` reported 22736 ms and 19911 ms for two coalesced callers, all of it in the Claude-CLI probe, while the secret reads beside it finished in milliseconds. A probe that trips the cap is **not cancelled** — there is nothing to cancel, a spawn is already running, and letting it finish is what populates the memo so the next caller is fast instead of paying the same timeout again. **The Claude-CLI fallback is the LAST KNOWN verdict, never a fabricated `false`**: an expired memo is still the best answer available, and reporting "not installed" on the evidence of a slow spawn flips the auth badge and can bounce the user to a setup screen. `false` is correct only when nothing was ever known. `probeSecrets` is deliberately NOT capped — it is a local secret-store read with no cheap fallback, and a timeout there would fabricate "no credentials", which is the one answer that changes what screen the user sees. The health check itself is single-flighted in `claudeCliProbe` (dropped by `invalidateAuthStatusCache`, since coalescing the underlying spawn is `ClaudeCliDetector`'s job, not this one's).
- **`mcpDirectory:getOAuthRedirectUri` logs at `warn` and never reaches Sentry (TASK_2026_373).** It answers "what redirect URL will this host hand the authorization server", delegating to `McpOAuthService.describeRedirectUri()`, which binds no port. A host that registers neither a callback listener nor an HTTP server provider legitimately cannot answer, so `{ redirectUri: null, error }` is a correct response and not a defect worth an alert. Its sibling `mcpDirectory:probeOAuthDiscovery` now also reports `dynamicRegistration` — false means the provider needs the user to register that URL and supply a client ID.
- **Platform-agnostic only** — never `import * from 'vscode'`. Use `platform-core` ports (`IUserInteraction`, `IFileSystemProvider`, `IPlatformCommands`, …) via DI.
- **Catch unknown**: `catch (error: unknown)` and narrow before logging/returning.
- **Workspace guard** — privileged operations call `isAuthorizedWorkspace` before acting.
- **`session:status` answers from `SessionTurnStateRegistry`, not from `ChatStreamBroadcaster.isStreaming` (TASK_2026_360).** `isStreaming` on the broadcaster means "a broadcast loop is attached", which in streaming-input mode is true for the whole life of the session — the webview read it as "generates now" and lit a stop button on every idle-but-live session after a reload. The response carries `turnState` (the registry's revision-stamped phase); `isStreaming` is kept only as `phase === 'generating'` for the CLI/TUI readers. `ChatStreamBroadcaster` also pushes the registry's `forceIdle` state INTO the chunk batch on stream error / abort / mid-turn loop exit, before `CHAT_ERROR`, so the UI's idle lands after the chunks it closes.

## Cross-Lib Rules

Consumers: app layers (`apps/ptah-extension-vscode`, `apps/ptah-electron`, `apps/ptah-cli`).
Must not be imported by leaf libs (`platform-*`, `shared`, `memory-contracts`).
