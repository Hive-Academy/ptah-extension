# Implementation Plan - TASK_2026_555

Providers + Agent Orchestration settings: restore the 17 missing capabilities, fix every "Regressed UX"
item, build the Gate-1.7-approved prototype (`prototypes/final/`), and absorb TASK_2026_551/552/553/554.
Advanced and Search & Voice are out of scope. Their content is not redesigned, but both tabs stay working
(see decision D9).

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign` (branch
`feat/task-555-settings-redesign`). All paths below are relative to the worktree root.

Evidence labels:
- **Verified**: I opened the line in this worktree.
- **Verified (trace)**: a read-only subagent trace of this worktree cited the file:line, and I spot-checked
  the decisive ones (the agent-orchestration read/write split, the `auth:saveSettings` reset, the
  file-routed keys).
- **Assumption**: not proven. The row names the check that settles it.

---

## Inputs and constraints

- Requirements used: `task.md` (## Decisions 2026-09-29), `design-spec.md` (final, revision rounds 1-2),
  `design-spec-review.md`, `parity-inventory.md`, `prototypes/final/{index.html, orchestration.html,
  README.md, screenshots/}`, `prototypes/BRIEF.md` ("Realistic data", :44-69),
  `investigation/synthesis.md`, `investigation/forensics-523-vs-shipped.md`, and
  `.ptah/specs/TASK_2026_55{1,2,3,4}/task.md`.
- Repository rules: `CONVENTIONS.md` (layer rule §8, barrels §3, error types §7, config discovery §10),
  the `max-lines` 700 warning (`eslint.config.mjs:514-517`, skip blank/comment lines), the Nx tag
  constraints (`eslint.config.mjs:365-389`: `type:feature` → feature/ui/util/core; `type:ui` → ui/util
  only; `type:core` → core/util only), and the facade recipe (`.claude/skills/humanize-library/references/refactor-recipes.md:80-94`).
  There is no `CLAUDE.md` in this worktree root or in the touched libraries.
- Corrections applied (design-spec claims that source contradicts):
  1. **Main-agent saves do not all "affect the running session exactly as today"** (spec §4.2). Only
     `auth:saveSettings` and `config:clearScopeOverride` touch live sessions, and they **end** them:
     `sdkAdapter.reset()` runs unconditionally (`auth-rpc.handlers.ts:1001-1003`, Verified). Reset
     disposes every live session (`sdk-agent-adapter.ts:550-561, 625-662`, Verified (trace)).
     `config:model-switch` and `config:effort-set` apply to the **next** session unless a `sessionId` is
     passed (`config-rpc.handlers.ts:198-213, 679-694`, Verified (trace)). The write-path table (§3)
     records the real effects, and D6 changes the save model for the one control that ends sessions.
  2. **CLI tier mapping has no per-instance `cliAgent` key.** `provider:setModelTier` params are
     `{tier, modelId?, providerId?, scope}` with no instance id (`rpc-providers.types.ts:103-152`,
     Verified (trace)). `cliAgent` tiers are per provider and are read after the instance's own
     `tierMappings` (`ptah-cli-registry.ts:1604-1648`, Verified (trace)). The spec's
     `setCliAgentTier(instanceId, …)` is not implementable as written. D5 resolves this.
  3. **Deleting the Anthropic key through `auth:saveSettings` is unsafe.** An empty `anthropicApiKey`
     deletes the key, but the same call rewrites `authMethod` at `applyTo`, clears narrower overrides,
     and resets the SDK (`auth-rpc.handlers.ts:954-1002`, Verified (trace) + :1001-1003 Verified). D4
     adds a dedicated RPC.
  4. **Per-CLI model/effort/auto-approve settings never reach the spawn-time reader.** Found during
     tracing, not in any input document. `agent:setConfig` writes `('ptah', 'agentOrchestration.<field>')`
     (`agent-rpc.handlers.ts:1037-1043`, Verified). Those keys are file-routed
     (`file-settings-keys.ts:162-174`, Verified). `AgentSpawnEnvironment` reads section
     `'ptah.agentOrchestration'` with the bare key (`agent-spawn-environment.service.ts:123-177`,
     Verified). The workspace providers route to the file store only when `section === 'ptah'`
     (`vscode-workspace-provider.ts:80-82`, `electron-workspace-provider.ts:95-97`, Verified). So the
     matrix's model and effort cells would be dead controls. D8 fixes the reader.
  5. **The prototype renders Advanced and Search & Voice as disabled tabs** (`index.html:107-112`). Those
     tabs hold working capabilities (#80 license, #81 data portability, web search, voice), so they stay
     enabled (D9).
  6. **The prototype drops the #22 security copy** ("Runs 100% locally" / "Your own endpoint",
     `settings.component.html:82-110`). Parity marks #22 "yes" (present), so it stays, compacted to one
     line (D10).
  7. **Prototype-only data with no source:** "Quota reached" (no quota field exists on `CliDetectionResult`,
     `agent-process.types.ts:282-313`, Verified) and a "Test" action on system-CLI rows (the only test RPC
     is `ptahCli:testConnection`, for Ptah CLI instances). Neither is built (D11).
- Design handoff used: `design-spec.md` §1-§6, `prototypes/final/`. Component names are used verbatim.
- Missing decision-critical input: none. The four open questions were answered by the user on
  2026-09-29 (`task.md` "## Decisions", last bullet). All four recommended defaults were chosen; see
  `## Resolved decisions`.

---

## Codebase evidence

| Evidence | Location | Architectural implication |
|---|---|---|
| State service is 1200 lines; one class holds reads, writes, commit pipeline, connection setup and probes | `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:1-1200` | TASK_2026_554 facade split, and the home of every new write method |
| `runCommit` returns silently when a commit is in flight | `providers-settings-state.service.ts:1022` | Save-on-selection must disable triggers while `commit().status === 'saving'` and refuse re-entry in the feedback service. Otherwise a pick is silently dropped |
| Every commit calls `refresh()` (13 reads, including `auth:getEffectiveRoute {refresh:true}`) | `:1083`, `:278-294`, `:298-300` | Each save-on-selection pays a full refresh. Accepted (existing), recorded as a performance risk |
| RPC errors never enter UI state; `require()` throws a fixed message | `:1058-1061`, `:1175-1187` | Write failures surface as field names in `commit.unsaved`, never as raw host text. The toast reads commit state only |
| Tier ops chain with `dependsOnPrevious: true`; one conflict skips every later tier | `:495`, `:1040-1043` | TASK_2026_552: staged dependencies (Component 5) |
| Cursor read-back compares `cursorApiKeyConfigured` (env OR secret) | `:360-363`; handler `agent-rpc.handlers.ts:1050-1056` (Verified (trace)) | TASK_2026_551: new `cursorApiKeyStored` field |
| Orchestration section projects only nine scalar fields | `:642-657` | Must be enriched with `detectedClis`, `disabledClis`, `preferredAgentOrder`, `maxConcurrentAgents`, `copilotAutoApprove` and the Cursor flags for the matrix |
| `agent:setConfig` read-back uses `===`; arrays would never match | `:966-967` | Widened orchestration patch needs an order-sensitive array comparison |
| `PROVIDER_MODELS_LOADER` is provided only on the Providers page | `providers-settings.component.ts:33`; loader `providers/providers-models-loader.service.ts:1-16` | Move the provider to `SettingsComponent` so Orchestration-tab pickers resolve it |
| Orchestration component owns private config, writes via its own RPC calls, ignores `data.success` | `agent-orchestration-config.component.ts:396, 444-464, 583-596` | Those writes move into the state service so failures surface. The component becomes the policy bar only |
| `onModelChanged()` re-detect reaches Orchestration through `viewChild`, but the event fires on Advanced, where Orchestration is not mounted | `settings.component.ts:89-91, 222-224`; `settings.component.html:118-120, 180` | Existing #84 defect: re-detect moves to `ProvidersSettingsStateService.redetectClis()` |
| Deep-link contract `PendingSettingsTab.section` is used by 5 libs | `app-state.service.ts:145-162, 1340-1365`; callers in memory-curator-ui :303, skill-synthesis-ui :422, setup-wizard welcome :337, tribunal-panel :288/:290/:414, AOC :416 | Keep the type unchanged. Re-route sections in `SettingsComponent.applyPendingTab` (`settings.component.ts:143-149`) |
| `NativeCardComponent` supports `clickable` + `activated`, and ignores clicks on nested controls | `libs/frontend/ui/src/lib/native/card/native-card.component.ts:100-101, 156, 178, 213-243` | Whole connection card opens the drawer; inline buttons still work |
| Drawer, popover and tab-group contracts | drawer `native-drawer.component.ts:175-205`; popover `native-popover.component.ts:116-159` (`backdropClass` default `'dark'`, :143); tab group `native-tab-group.component.ts:51-66, 136-151` | Popovers in this task set `backdropClass="transparent"` (spec §3.2 needs a backdrop for outside-click, not a dimmed page) |
| Native barrels are pure `export *` lists, enforced by a spec | `libs/frontend/ui/src/lib/native/index.ts:1-50`; `libs/frontend/ui/src/index.ts:31-36` | New `modal/` folder gets its own `index.ts` and one `export * from './modal';` line |
| `showModal()` precedent + jsdom stub | `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.spec.ts:46-60`; class-toggle counter-precedent `libs/frontend/chat/src/lib/update-dialog/update-dialog.component.ts:25-28` | `NativeModalComponent` specs stub `HTMLDialogElement.prototype.showModal/close` the same way. The update-dialog's top-layer caveat is recorded as a risk |
| Picker is a native `<select>`; tool-use is a conditional warning only | `provider-model-picker.component.ts:187-206, 467-472`; used by memory-curator-ui, skill-synthesis-ui, thoth e2e `skills-lane-pickers.e2e.spec.ts:435`, electron `thoth/skills.spec.ts:462` | Search must be opt-in (D12) to avoid changing unapproved surfaces |
| `ProviderModelInfo.supportsToolUse` exists | `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:62` | #38 is frontend-only |
| `PtahCliSummary` carries `status`, `hasApiKey`, `hasStoredKey`, `enabled`, `modelCount` | `libs/shared/src/lib/types/ptah-cli.types.ts:46-60` | #43/#44 are frontend-only |
| `ptahCli:testConnection` returns `{success, latencyMs?, error?}`, and the error is backend-sanitized | `ptah-cli-registry.ts:469-563`; `ptah-cli-registry.utils.ts:110-126` (Verified (trace)) | #52 latency and reason can be shown; the state store currently drops both (`providers-settings-state.service.ts:355-359`) |
| `ptahCli:update` merges shallowly; partial `tierMappings` replaces the whole object | `ptah-cli-registry.ts:339-372` (Verified (trace)) | Tier modal always sends the full `{sonnet?, opus?, haiku?}` object |
| `provider:updateCustomEntry` accepts a partial `changes`; `null` clears `modelsEndpoint`/`defaultTiers`/`pricing` | `provider-registry.ts:650-652`; `custom-provider-store.ts:184-218` (Verified (trace)) | #27/#28/#30 need no backend change |
| `auth:verifyDraftConnection` accepts `baseUrl` but not `modelsEndpoint` | `rpc-auth.types.ts:468-500`; `draft-verification.service.ts` (Verified (trace)) | Models-endpoint edit cannot be probed as its own field (D7) |
| Custom-entry `pricing` has no runtime reader | `provider-registry.ts:703-718`; only reader `auth-state.service.ts:544` (Verified (trace)) | #30 restores a stored, displayed value with no cost effect. Recorded honestly in §3 |
| `auth:setApiKey` with a blank key deletes the provider key; no SDK reset | `auth-rpc.handlers.ts:1229-1267` (Verified (trace)); registration lists `:154-160`, `:305-315`; `rpc.types.ts:1468, 3564-3737` (Verified) | Registration points the new RPC must copy |
| `auth:copilotLogout` exists, is registered, and is never called by the state service | `rpc-auth.types.ts:72-78`; `auth-rpc.handlers.ts:1150-1177` (Verified (trace)); `providers-settings-state.service.ts:421-423` | #12 needs a state method only |
| `auth:getAuthStatus` exposes `copilotUsername`, `codexTokenStale`, `claudeCliInstalled` | `rpc-auth.types.ts:173-194` | Drawer OAuth summary and Codex token-expired copy (#11/#13) come from existing data |
| File settings `persist()` swallows errors; `set()` always resolves and fires listeners | `libs/backend/platform-core/src/file-settings-manager.ts:97-107, 483-503` (Verified (trace)) | TASK_2026_553 |
| Cursor SDK error path logs and emits raw error text | `cursor-cli.adapter.ts:376-388, 426-435`; `sdk-error-summary.ts:30-83` (Verified (trace)) | TASK_2026_551 redaction |
| Webview e2e harness serves the real bundle with fixture RPC | `libs/frontend/webview-e2e-harness/src/lib/test-fixtures.ts:38-83` (`useAppBuild`); `fixture-server.ts:87-107`; responder `scenarios/marketplace/marketplace.fixtures.ts:116-222`; host `:72-84`; theme `marketplace-visual.e2e.spec.ts:282-296` (`localStorage 'ptah-theme'`, `theme.service.ts:137`) | This is the visual-gate render path (§6), already proven by TASK_2026_533 |
| The settings e2e spec is hollow | `scenarios/settings/provider-settings.e2e.spec.ts:24-100` (every assertion is `Array.isArray(out)` or a URL match) | Replace it with real assertions; delete the hollow file |
| Live-app scripts depend on Settings selectors | `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts:100, 217-219, 241-270`; `docs-screenshots/workspace-settings.shot.ts:31-62` | Keep `provider-connection-card`, `#providers-connections-heading`, `settings-back`, tab buttons as `role=button` with the same names. Update the docs shot for `assignments-heading` moving tabs |
| Old #70 permission copy | `git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` lines 350-359, 530-540, 580-590, 631-641, 701-711 | Codex/Cursor/Antigravity "Full auto — … runs headless with full access"; opencode "`--auto`"; Pi "No approval gate and no MCP support". Copy for Ptah CLI instances and Copilot is new and needs user review |

---

## Architecture decision

- **Chosen approach:** rebuild the two tabs as compositions over **one** state owner
  (`ProvidersSettingsStateService`, split behind a facade), **one** save-feedback path (commit state →
  toast with Undo), and existing Native primitives plus one new primitive (`NativeModalComponent`).
  Backend changes are limited to four correctness fixes the UI would otherwise sit on: TASK_2026_551,
  TASK_2026_553, the orchestration reader (D8), and a key-delete RPC (D4). Every UI batch mounts its
  components in the real page and is accepted only after a rendered visual gate.
- **Rationale:** the forensic root causes are no rendered check, piecemeal stubbed components, and
  untested budgets (`forensics-523-vs-shipped.md` §2.2-§2.3, §4). The plan makes the budget an automated
  assertion in the existing harness, gives each tab one integration owner, and forbids unmounted
  components. The single state owner already exists and already enforces workspace-context and
  read-back rules (`:1017-1130`). Routing every new write through it gives one failure path (TASK_2026_553
  surfacing) instead of the orchestration component's private, unchecked writes.
- **Rejected alternatives:**
  - *Parallel lanes per component against stubs.* That is exactly what shipped #575 (`forensics` §2.3).
    Rejected.
  - *Orchestration tab keeps its own `ClaudeRpcService` state.* Two sources of truth for `agent:getConfig`,
    and writes that ignore `data.success` (`agent-orchestration-config.component.ts:444-464, 583-596`).
    Rejected.
  - *A client-side queue for save-on-selection.* It would reorder writes against `runCommit`'s
    workspace-context guard. Disabling triggers while saving is what the existing page already does
    (`providers-settings.component.ts:323`, `saving()`). Rejected.
  - *Extending the picker in place for every consumer.* This changes Memory and Thoth Skills surfaces
    without Gate 1.7 and breaks two e2e specs. Rejected (D12).
- **Assumptions:** see the Assumption rows in the tables. None blocks structure.
- **Effect on existing code:**
  - Replaced: the flat Providers page template, `PtahCliConfigComponent` (deleted), and the orchestration
    component's private state and writes.
  - Split: the state service (TASK_2026_554), and the connection card (TASK_2026_554, 852 → <700).
  - Restyled with the API unchanged: `SettingScopeRowComponent`, `ProviderConsumerAssignmentsComponent`.
  - Unchanged: `ProviderSetupWizardComponent` (2390 lines; not in 554's scope), Advanced and Search &
    Voice content, and the `PendingSettingsTab` type.

### Decisions (numbered for reference)

| # | Decision | Evidence / reason |
|---|---|---|
| D1 | One state owner; the facade keeps its name, DI (`providedIn: 'root'`) and every public member | `providers-settings-state.service.ts:181-182`; core barrel `core/src/index.ts:2` |
| D2 | Save-on-selection goes through a single `SettingsSaveFeedbackService`. The toast is derived from `state.commit()` after the awaited write. Undo = a real write of the previous value through the same state method | spec §4.2; `:56-71` commit shape |
| D3 | Triggers are disabled while `commit().status === 'saving'`; the feedback service refuses re-entry | `:1022` |
| D4 | New RPC `auth:deleteStoredKey { providerId }` deletes one stored key (`'anthropic'` → Anthropic API credential, else `ptah.auth.provider.<id>`). No auth-method write, no SDK reset | Correction 3; `auth-secrets.service.ts:193-196, 280-283, 300-302` (Verified (trace)) |
| D5 | CLI tier mapping writes the **instance's** `tierMappings` via `ptahCli:update` (full object). The modal shows provider-level `cliAgent` tiers, read with `provider:getModelTiers {scope:'cliAgent'}`, as the inherited fallback | Correction 2; **user-approved** (Resolved decision R2) |
| D6 | The main-agent **provider** change and a scope clear on an auth or provider key each use a confirm step with the copy "ends running chat sessions", and have no Undo. The SDK reset is **not** changed in this task. Model, effort, role provider/model, CLI model/effort and tiers save on selection with Undo | `task.md:69-71`; correction 1; **user-approved** (R1) |
| D7 | Drawer endpoint edits: **base URL** is verify-then-save (probe accepts `baseUrl`). **Models endpoint** is saved together with the base URL in the same verified commit when both change; alone, it is saved after a verify of the *current* base URL with the stored credential | `rpc-auth.types.ts:468-500`; spec §2.4 NEW-2 split |
| D8 | Fix `AgentSpawnEnvironment` to read `('ptah', 'agentOrchestration.<field>')` like its sibling reads (`agent-spawn-environment.service.ts:226-256`) | Correction 4 |
| D9 | Advanced and Search & Voice tabs stay enabled and unchanged; only the tab-bar styling changes | Correction 5 |
| D10 | #22 security copy is kept as a single `text-[11px]` line under the Connections header and counted in the fold budget | Correction 6 |
| D11 | No "Quota reached" state and no system-CLI "Test" action. The status column shows only what detection reports (Ready / Disabled / Not installed / Needs API key for Cursor) | Correction 7 |
| D12 | `ProviderModelPickerComponent` gains `searchable = input(false)` and always-on tool-use badges and summary. Settings passes `searchable`; other consumers keep the `<select>` | Picker consumer evidence; **user-approved** (R3) |
| D13 | Deviation 6 (no `text-primary`/`text-error` text) is implemented as the spec states. Colour goes on icons, dots and badges; text stays `text-base-content` | spec §6.6; **user-approved** (R4). Deviations 3-5 accepted |
| D14 | During the redesign, every capability stays reachable at the end of **every** batch. A component is removed only in the batch that mounts its replacement. `settings-reachability.e2e.spec.ts` proves this per batch (§6) | Review finding 1; forensics §2.3 |
| D15 | `runCommit` never reports "Saved" for a write that did not succeed. `success:false` or `'conflict'` → `unsaved`, and read-back is skipped. A thrown or timed-out write → `unconfirmed`, and read-back is skipped, so it can never promote the field to `saved`. Read-back runs only after an acknowledged write | Review finding 8; `providers-settings-state.service.ts:1048-1080` |
| D16 | Every scope badge shows the field it governs (e.g. "Effort · Workspace"), and its popover header names the field | Review finding 5; forensics §5 lesson 4 |

---

## Component specifications

File-path prefixes: `CHAT` = `libs/frontend/chat/src/lib/settings/`, `CORE` =
`libs/frontend/core/src/lib/services/`, `UI` = `libs/frontend/ui/src/lib/native/`, `HARNESS` =
`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`.

### 1. File-settings write failures (TASK_2026_553)

- Purpose: a failed `~/.ptah/settings.json` write rejects the caller, and memory matches disk.
- Responsibilities:
  - `persist()` logs a fixed line, then throws `SettingsPersistError`, which carries the error
    `code` (e.g. `EACCES`/`ENOSPC`/`EBUSY`) and never the value. It logs through `console.warn`, as
    today (`:497-502`): platform-core has no injected logger, and this task does not add one.
  - `set()` keeps the previous in-memory value and restores it when the queued persist rejects.
  - Listeners fire only after a successful persist.
  - The queue (`writePromise`) keeps accepting writes after a failure (`:99-102` already chains the
    rejection handler).
  - `flushSync` stays swallowing (exit path).
- Verified contracts: `file-settings-manager.ts:49, 97-107, 193-215, 483-503` (Verified (trace)).
  Error-class pattern `platform-core/src/state-storage-errors.ts:3-33` (Verified).
- Dependencies: `platform-core` is L0.5 (`CONVENTIONS.md` §8) and imports nothing new.
- Integration points (callers, none of which catches today; Verified (trace)):
  - The workspace providers' `setConfiguration` (`platform-vscode …vscode-workspace-provider.ts:100-110`,
    `platform-electron …:217-226`, `platform-cli …:109-118`)
  - Settings adapters/stores (`vscode-settings-adapter.ts:77-80`, electron/cli `file-settings-store.ts`)
  - `ConfigManager.set` (`vscode-core …config-manager.ts:216-227`) and the CLI shim (`cli-engine
    container.ts:556-576`)
  RPC handlers already convert throws into error envelopes (dispatcher `vscode-core
  …rpc-handler.ts:217-252`). Handlers that return `{success:false}` (`agent:setConfig`,
  `provider:setModelTier`, `ptahCli:*`) and the `RpcUserError('…','PERSISTENCE_UNAVAILABLE')` handlers
  (`memory:setTriggers`, `skillSynthesis:setLanes/setTriggers`) need no change. Startup paths that must
  not crash:
  - `runCursorApiKeyMigration` (catches all, `run-cursor-api-key-migration.ts:26-42`). Its bootstrap
    call sites are pinned by S1a's bootstrap specs.
  - `migrateAgentOrchestrationSettings` (try/catch, `agent-rpc.handlers.ts:1103-1117`). Its spec is
    owned by **S1b**, which owns `agent-rpc.handlers.ts` (review finding 2). The case: a rejecting
    `setConfiguration` is logged and does not reject the handler's constructor path.
- Failure behaviour: the caller sees a rejection. The frontend sees `success:false` or an error envelope.
  `runCommit` records the field as `unsaved` (`providers-settings-state.service.ts:1058-1080`), and the
  toast shows "Not saved: …" (Component 11).
- Quality: no settings value or secret in the error. The error message is fixed text plus the fs `code`.
- Verification seam: `file-settings-manager.error-paths.spec.ts`. Flip `:139-150` to expect rejection,
  and keep `:121-137` (chain recovers). Add: the failed write leaves the value unchanged; the next `set()`
  succeeds; listeners are not called on failure. Add bootstrap specs asserting startup survives a
  rejecting write in `apps/ptah-extension-vscode/src/activation/bootstrap.cursor-key.spec.ts`,
  `apps/ptah-electron/src/activation/bootstrap.cursor-key.spec.ts` and
  `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts`.
- Files:
  - CREATE `libs/backend/platform-core/src/file-settings-errors.ts`
  - MODIFY `libs/backend/platform-core/src/file-settings-manager.ts`,
    `libs/backend/platform-core/src/index.ts` (export the error),
    `libs/backend/platform-core/src/file-settings-manager.error-paths.spec.ts`
  - MODIFY the three bootstrap specs above (add cases)
  - Every caller spec in `@ptah-extension/vscode-core`, `@ptah-extension/platform-vscode`,
    `@ptah-extension/platform-electron` and `@ptah-extension/platform-cli` that assumes `set` resolves
    is updated in S1a (these projects are in S1a's verify command).
  - CREATE `.ptah/specs/TASK_2026_553/fix-report.md`: the write-path trace for the RPC save path
    (RPC → handler → `setConfiguration` → `set` → `persist` → reject → envelope → `runCommit` `unsaved`
    → toast), plus the spec evidence (value unchanged, next `set` succeeds, startup survives).

### 2. Cursor key redaction and truthful read-back (TASK_2026_551, backend half)

- Purpose: the Cursor key never reaches a log, `output` chunk or `segment`, and `agent:getConfig` reports
  the stored key separately from the env var.
- Responsibilities:
  - Add `redactSecrets(text, secrets)` and an optional third parameter
    `summarizeCliSdkError(error, vendor, secrets: readonly string[] = [])` in `sdk-error-summary.ts`
    (literal-value replacement with a fixed `[REDACTED]` marker, applied before the headline is cut).
  - `CursorCliAdapter` captures the resolved key in the `runSdk` scope. It passes `[apiKey]` to both the
    log `detail` and the summary in `runTurn` (:376-388), and redacts the `interrupt()` log and the
    rethrown error (:426-435). The `detect()`/`listModels()` catch paths never log the key (today they log
    nothing, :195-200, :268; keep that and pin it with a spec).
  - `agent:getConfig` adds `cursorApiKeyStored: boolean` (secret present) and `cursorApiKeyEnvSet: boolean`
    (`CURSOR_API_KEY` non-empty) next to `cursorApiKeyConfigured`.
- Evidence for one helper vs. a per-adapter fix: only Cursor passes a key into SDK options
  (`cursor-cli.adapter.ts:324-328`). Codex also calls `summarizeCliSdkError` (`codex-cli.adapter.ts:773`),
  so an optional parameter keeps Codex untouched. The regex sanitizer `sanitizeErrorMessage`
  (`ptah-cli-registry.utils.ts:110-126`) may miss a `key_…` shape (Verified (trace)); literal replacement
  does not.
- Verified contracts: `AgentOrchestrationConfig` `rpc-agents.types.ts:87-128` (`cursorApiKeyConfigured`
  :107); handler `agent-rpc.handlers.ts:200, 1050-1056`; set path :319-338 (an empty string deletes the
  secret).
- Dependencies: `cli-agent-runtime` (`scope:extension,type:feature`) keeps its own helper; no new edge.
- Failure behaviour: unchanged exit codes; only the text changes.
- Verification seam: `cursor-cli.adapter.spec.ts` covers the three 551 acceptance specs (runTurn rejection
  carrying the key; `run.cancel()` rejection carrying the key; `detect` resolver failure carrying the key).
  Assert that no logger arg, output chunk or segment contains the key. `sdk-error-summary.spec.ts` covers
  redaction plus the existing Cursor case (:60). `agent-rpc.handlers.set-config.spec.ts` (:174-330) covers
  the new fields with and without the env var.
- Files:
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts`,
    `…/cursor-cli.adapter.ts`, `…/cursor-cli.adapter.spec.ts`, `…/sdk-error-summary.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`,
    `…/agent-rpc.handlers.set-config.spec.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.*.spec.ts`: add the
    `migrateAgentOrchestrationSettings` rejecting-write case (Component 1, review finding 2)
  - CREATE `.ptah/specs/TASK_2026_551/fix-report.md`: the key → store → reader trace (`agent:setConfig`
    → `ptah.auth.provider.cursor` → `resolveCursorApiKey`, env first) and the redaction evidence. S2a
    appends the UI read-back half.

### 3. Orchestration settings reach the spawn-time reader (D8)

- Purpose: per-CLI model, effort and Copilot auto-approve written by `agent:setConfig` are what the next
  spawn uses.
- Responsibilities: `AgentSpawnEnvironment.resolveReasoningEffort`, `resolveAutoApprove` and
  `resolveModel` read `getConfiguration('ptah', 'agentOrchestration.<key>', default)`. This is the same
  form the sibling reads at `:226-256` use and the form the writer uses (`agent-rpc.handlers.ts:1037-1043`).
- Verified contracts: reader `agent-spawn-environment.service.ts:118-177`; `MODEL_CONFIG_KEYS` `:37-45`
  of the same file's static; file routing `file-settings-keys.ts:162-174`.
- Failure behaviour: none new. The default (`''`/`true`) still applies when the key is unset.
- Verification seam: `agent-process-manager.service.spec.ts:304-321` currently normalises both key forms
  (Verified (trace)). Add a regression spec with a workspace-provider fake that honours the real section
  rule (`section==='ptah'` + file key → file map; otherwise the VS Code map). It asserts that a value
  written with `('ptah','agentOrchestration.codexModel')` is returned by `resolveModel('codex')`. This is
  the one regression test for this bug.
- Files: MODIFY
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`; CREATE
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.settings-routing.spec.ts`.

### 4. `auth:deleteStoredKey` RPC (D4, restores #7/#8)

- Purpose: delete one stored credential without activating, re-scoping or resetting anything.
- Contract (new):
  - `AuthDeleteStoredKeyParams { providerId: string }` and
    `AuthDeleteStoredKeyResult { success: boolean; error?: string }` in `rpc-auth.types.ts`.
  - Registry entry beside `'auth:setApiKey'` (`rpc.types.ts:1468`), and
    `RPC_METHOD_ENTRIES['auth:deleteStoredKey'] = true` (`rpc.types.ts:3564-…`).
  - Add to `AuthRpcHandlers.METHODS` (`auth-rpc.handlers.ts:154-160`) and to the debug list (:305-315).
- Handler:
  - A zod schema in `auth-rpc.schema.ts`: `providerId` must be `'anthropic'` or an id in the merged
    registry, the same check `anthropicProviderId` uses (`auth-rpc.schema.ts:45-57`, Verified (trace)).
  - `'anthropic'` calls `authSecrets.setCredential('apiKey','')`, which deletes (`auth-secrets.service.ts:193-196`).
  - Any other id calls `deleteProviderKey(id)` (`:300-302`).
  - Then invalidate the auth-status cache and the model cache, as `auth:setApiKey` does (:1241-1248).
  - **No** `sdkAdapter.reset()`.
- Why not `auth:setApiKey` with an empty key: it cannot address the Anthropic credential slot. It writes
  `ptah.auth.provider.<id>`, while the Anthropic key lives in `ptah.auth.anthropicApiKey`
  (`auth-secrets.service.ts:122, 146, 257`, Verified (trace)).
- Failure behaviour: a secret-store failure returns `{success:false, error:'Could not delete the stored
  key.'}` (fixed text, no detail, following `agent-rpc.handlers.ts:327-331`).
- Security: least privilege, one slot per call. The id is validated before use, and no value is logged.
- Verification seam: a new `auth-rpc.handlers.delete-stored-key.spec.ts` covers:
  - The Anthropic slot is deleted.
  - A provider slot is deleted.
  - An unknown id is rejected before any secret call.
  - `sdkAdapter.reset` is never called.
  - A secret-store rejection gives the fixed error.
- Files:
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`,
    `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`,
    `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.schema.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.delete-stored-key.spec.ts`
  - **First checklist item of S1c, before any code (review finding 6):** verify that the Electron secret
    backend honours `delete`. Trace `EXTENSION_CONTEXT.secrets` in `apps/ptah-electron/src/di/` to its
    implementation. Confirm that `AuthSecretsService.setCredential('apiKey','')` and
    `deleteProviderKey(id)` both remove the stored entry there, and that a later `get` returns
    `undefined`.
    - If they do, record the file:line in the S1c report and add one Electron-backend spec (delete →
      `get` is `undefined`).
    - If they do not, the Electron secrets implementation file joins S1c's MODIFY list with a delete
      fix and that spec.
    - The handler must not ship on the unverified assumption.

### 5. State service: 551 read-back and 552 staged tier dependencies (in the monolith, before the split)

- Purpose: close TASK_2026_551's UI half and TASK_2026_552 before TASK_2026_554 moves the code
  (`TASK_2026_554/task.md` `depends_on`).
- Responsibilities:
  - `saveCursorCredential` read-back compares `cursorApiKeyStored === !!apiKey.trim()` (was
    `cursorApiKeyConfigured`, `:362`). An empty key is a valid "clear" save.
  - Replace `dependsOnPrevious?: boolean` (`:160`) with a stage marker:
    `stage?: 'setup' | 'tier' | 'activation'` (default `'setup'`).
    - A setup op skips if an earlier setup op failed. This keeps today's credential → custom-entry chain
      (`:472-476`).
    - A tier op skips only if a setup op failed.
    - An activation op skips if **any** earlier op failed or conflicted (`:514-518`).
  - The commit message names each conflicted tier. `saved` already lists each saved tier, so the wizard's
    `commitDetail` (`providers-settings.component.ts:315-319`) shows both.
  - **D15, never "Saved" after a failed write (review finding 8).** In `runCommit` (`:1048-1080`):
    - `write()` resolves `false` or `'conflict'` → `unsaved`; read-back is skipped.
    - `write()` throws → `unconfirmed` (it may have written; never claim a rollback, `:67`); read-back
      is skipped.
    - Only an acknowledged `true` write runs read-back. A mismatch there → `unsaved`; a read-back throw
      → `unconfirmed`.
    - As a result, `saved` holds only fields whose write was acknowledged and whose read-back, if any,
      matched.
    - If an existing TASK_2026_534 spec asserts `saved` after a throw followed by a matching read-back,
      that assertion changes deliberately. List it in the S2a report.
  - Append the UI read-back half to `.ptah/specs/TASK_2026_551/fix-report.md`.
- Verification seam: `providers-settings-state.service.spec.ts`:
  - New spec (552 acceptance): edit two tiers, the first conflicts. The second is saved, activation
    does not run, and the message and `saved` name each tier.
  - D15 specs, three cases, none of which ever lands in `saved`:
    - write throws, read-back would match → `unconfirmed`
    - write returns `success:false`, read-back would match → `unsaved`
    - write acknowledged, read-back mismatches → `unsaved`
  - Update the Cursor read-back specs, including clear with `CURSOR_API_KEY` set.
  - Existing TASK_2026_534 conflict and activation specs must stay green unchanged.
- Files: MODIFY `CORE/providers-settings-state.service.ts`, `CORE/providers-settings-state.service.spec.ts`.

### 6. State service facade split (TASK_2026_554)

- Purpose: the file drops under 700 lines with no behaviour change. The public class, token and
  signatures stay (refactor recipe 4).
- Collaborators (each an `@Injectable({ providedIn: 'root' })`, named for one job):
  1. `ProvidersCommitService` (`CORE/providers-commit.service.ts`). Owns `commitState`, `runCommit` and
     `contextMatches`, plus the pure operation builders for `ProvidersSettingsPatch` (currently
     `operations()` `:840-1015`). The facade passes hooks for `refreshScopes`, `refresh` and
     `sectionsReady`, so the side-effect order at `:1024-1101` is preserved.
  2. `ProvidersConnectionSetupService` (`CORE/providers-connection-setup.service.ts`). Owns
     `connectProvider` operation assembly (the staged 552 logic), `activationAuth`/`authWritable`,
     `verifyDraft`/`cancelVerification`/`abortProbe` and the probe generation state, and
     `performExternalAuth`.
  - Plumbing module (not a collaborator): `CORE/providers-settings-sections.ts`. It holds `section()`,
    `read()`, `view()`, `freshEffortView()` and `require()`, exported as functions that take the
    workspace/RPC dependencies explicitly.
  - Types move to `CORE/providers-settings.types.ts`, re-exported from the facade file so
    `core/src/index.ts:2` keeps exporting them.
- The facade keeps every public member used by chat (`route`, `scopes`, …, `commit`, `activeProviderId`,
  `open`, every `refresh*`, `saveSettings`, `connectProvider`, `activateConnection`, `clearScopeOverride`,
  `clearWorkspaceOverride`, `verifyDraft`, `cancelVerification`, `performExternalAuth`,
  `saveCursorCredential`, `testCliConnection`, `scopeEntry`, `groupScope`, `writeScopes`, `reviewContext`)
  and delegates.
- Acceptance (554): the facade and each collaborator are under 700 counted lines, and the existing
  `providers-settings-state.service.spec.ts` passes **with no assertion changes** (only setup changes if
  TestBed needs the collaborators, which are root-provided and need none).
- Verification seam: the unchanged facade spec, plus new direct specs for `ProvidersCommitService` (the
  staging matrix) and the section helpers.
- Files:
  - REWRITE `CORE/providers-settings-state.service.ts`
  - CREATE `CORE/providers-commit.service.ts`, `CORE/providers-connection-setup.service.ts`,
    `CORE/providers-settings-sections.ts`, `CORE/providers-settings.types.ts`,
    `CORE/providers-commit.service.spec.ts`, `CORE/providers-connection-setup.service.spec.ts`

### 7. State service: new reads and writes for the redesigned surface

- Purpose: every new control writes through one owner with read-back and commit feedback.
- New or changed members (facade signatures; the implementation lives in the collaborator named):

| Member | Kind | RPC | Notes |
|---|---|---|---|
| `deleteStoredKey(providerId, context)` | write | `auth:deleteStoredKey` (Component 4) | Read-back: `auth:getApiKeyStatus` (third-party) or `auth:getAuthStatus.hasApiKey` (`anthropic`) is false. Then `refreshConnections()`, `refreshRoute()` |
| `disconnectCopilot(context)` | write | `auth:copilotLogout {}` (`rpc-auth.types.ts:72-78`) | Read-back: `auth:getAuthStatus.copilotAuthenticated !== true` |
| `removeCustomEntry(id, context)` | write | `provider:removeCustomEntry {id}` (`rpc-providers.types.ts:243-248`) | Blocked if the id is the active driver (`route.driverProviderId === id`), with message "Switch the main agent first." Read-back: `provider:listCustomEntries` lacks the id |
| `updateCustomEntryFields(id, changes: {helpUrl?, pricing?}, context)` | write | `provider:updateCustomEntry {id, changes}` | Metadata only, no probe. Read-back from `provider:listCustomEntries` |
| `updateCustomEntryEndpoint(id, changes: {baseUrl?, modelsEndpoint?}, probeId, context)` | write | `provider:updateCustomEntry` | Gate identical to `connectProvider`'s (`:441-444`): the verification is ready, `outcome==='verified'`, the probeId matches, and `verifiedProviderId===id`. See D7 |
| `updateLocalBaseUrl(providerId, baseUrl, probeId, context)` | write | `llm:setProviderBaseUrl` (already used `:475-476`) | Same verify gate |
| `setMainAgentTier(providerId, tier, modelId \| '', context)` | write | `provider:setModelTier` / `provider:clearModelTier` `scope:'mainAgent'` | Existing patch path `tiers` (`:970-986`), plus clear support |
| `setCliInstanceTiers(id, tiers: {sonnet?, opus?, haiku?}, context)` | write | `ptahCli:update {id, tierMappings}` | D5. Always sends the full object. Read-back via `refreshCliModels()` |
| `redetectClis()` | read | `agent:detectClis`, then `refreshOrchestration`/`refreshCliAgents`/`refreshCliModels` | Replaces `AgentOrchestrationConfigComponent.redetectClis` (:598-625) and fixes the #84 `viewChild` gap |
| `refreshOrchestration()` | read (changed) | `agent:getConfig` | Adds `detectedClis`, `disabledClis`, `preferredAgentOrder`, `maxConcurrentAgents`, `copilotAutoApprove`, `cursorApiKeyConfigured`, `cursorApiKeyStored`, `cursorApiKeyEnvSet` |
| `ProvidersSettingsPatch.orchestration` | write (widened) | `agent:setConfig` | Adds `disabledClis`, `preferredAgentOrder`, `maxConcurrentAgents`, `copilotAutoApprove`. Array read-back is order-sensitive element equality |
| `testCliConnection(id)` | read (changed) | `ptahCli:testConnection` | Store keeps `{id, success, latencyMs?, reason?}`. `reason` is the backend-sanitized `error` |
| `ProvidersConnection` | type (widened) | `auth:getAuthStatus` (already fetched `:371`) | Adds `accountLabel: string \| null` (Copilot username), `tokenStale: boolean` (Codex) |
| `customEntry(id)` | read | `provider:listCustomEntries` | Returns `modelsEndpoint`, `helpUrl`, `pricing`, `baseUrl` for the drawer's Advanced tab (non-secret) |

- Failure behaviour: every write goes through `runCommit`. A failed write lands in `unsaved`, a rejected
  or timed-out RPC in `unconfirmed`, a context change in `blocked`. No RPC error text enters state
  (`:1058-1061`).
- Verification seam: facade spec cases per member, each with success, `success:false`, rejection and
  read-back mismatch. The array read-back has its own case.
- Files: MODIFY `CORE/providers-settings-state.service.ts`, `CORE/providers-commit.service.ts`,
  `CORE/providers-connection-setup.service.ts`, `CORE/providers-settings.types.ts` and their specs.

### 8. `NativeModalComponent` (spec §2.5)

- Purpose: a centered, domain-free modal using native `<dialog>.showModal()`/`close()`.
- Contract (verbatim from spec §2.5):
  - `isOpen = input.required<boolean>()`, `ariaLabel = input<string>()`,
    `size = input<'sm'|'md'|'lg'>('md')`, `closed = output<void>()`.
  - Slots `[modal-header]`, default, `[modal-footer]`.
  - `(cancel)` → `closed`. Backdrop form-button → `closed`. `data-testid="native-modal-dialog"`.
- Lifecycle: an `effect()` calls `showModal()`/`close()`; `ngOnDestroy` closes if open. There are no
  document listeners.
- Failure behaviour: if `showModal` is missing (jsdom), the component throws in tests only. Specs stub it
  (`diff-view.component.spec.ts:55-60`).
- Accessibility: native focus trap, focus restore and Esc.
- Verification seam: `native-modal.component.spec.ts` covers:
  - open calls `showModal` and close calls `close`
  - `cancel` emits `closed` without the component closing itself
  - the backdrop click emits `closed`
  - `aria-label` is applied
  - the size class maps correctly
- Files: CREATE `UI/modal/native-modal.component.ts`, `UI/modal/index.ts`,
  `UI/modal/native-modal.component.spec.ts`; MODIFY `UI/index.ts` (one `export * from './modal';` line).

### 9. `ProviderModelPickerComponent` extension (spec §2.4, D12)

- Purpose: searchable model selection (#34) and always-visible tool-use indicators (#38).
- Responsibilities:
  - Add `searchable = input(false)`. When true, the model control is a new internal
    `ProviderModelSearchFieldComponent` built on `NativeAutocompleteComponent`
    (`UI/autocomplete/native-autocomplete.component.ts:144-208`). It filters `modelOptions()` by name or
    id, caps at 50 results (old #34 behaviour, `parity-inventory.md:79`), and keeps the pinned "not in
    catalog" option and the manual-entry `<details>` unchanged.
  - When false, the `<select>` (`:189-206`) is unchanged, so the Memory and Skills consumers see no
    interaction change.
  - Always (both modes): a per-option tool-use marker, and a summary line
    "`N` models · `M` support tool use" from `ProviderModelInfo.supportsToolUse`. The existing
    `toolUseWarning()` (`:467-472`) is kept.
- Contract: every existing input and output is unchanged (`:302-345`); `data-testid` values are
  unchanged; the new testids are `provider-model-picker-search` and `provider-model-picker-tooluse-summary`.
- Dependencies: `type:ui` → ui/util only. The field uses the existing `PROVIDER_MODELS_LOADER` port
  (`provider-models-loader.port.ts`) and no new injection. `dependency-boundaries.spec.ts` must stay green.
- Failure behaviour: catalog error/Retry is unchanged (:228-247). The search shows `emptyMessage` on no
  match.
- Quality: the picker file stays under 700 counted lines (577 today). No per-option timer or observer; the
  list is filtered in a `computed`.
- Verification seam: `provider-model-picker.component.spec.ts` gets new cases for the search filter,
  pinned saved id, summary counts and the `searchable=false` regression. The memory-curator-ui and
  skill-synthesis-ui specs must pass unchanged.
- Files: MODIFY `UI/provider-model-picker/provider-model-picker.component.ts` and its spec; CREATE
  `UI/provider-model-picker/provider-model-search-field.component.ts` and its spec (not exported from the
  barrel).

### 10. Settings shell (`SettingsComponent`)

- Purpose: the shared header, tab bar, overlay hosts and deep-link routing for both redesigned tabs.
- Responsibilities:
  - Header per prototype (`index.html:82-94`): Back (keep `data-testid="settings-back"`), "Settings",
    and a right-aligned "Workspace: {name} · App: {Desktop|VS Code}". The name comes from
    `state.scopes().data.activePath` (the same derivation as `providers-settings.component.ts:324`), with
    the full path in `title`. The label comes from `VSCodeService.isElectron` (`settings.component.ts:115`).
  - The tab bar is restyled to the prototype's `tabs-bordered` look. It keeps `<button>` elements with the
    same visible names (the live-app scripts use `getByRole('button', {name})`) and all four tabs enabled
    (D9).
  - `providers: [{provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader}, SettingsSaveFeedbackService]`,
    moved from `providers-settings.component.ts:33`.
  - Renders `<ptah-settings-toast>` once.
  - `applyPendingTab` routing table (the `PendingSettingsTab` type is unchanged):

| Pending | Tab | Focus / open |
|---|---|---|
| `providerId` set (any tab, e.g. tribunal `openSettingsTab('orchestration', id)`) | Providers | Open the setup wizard for the id (existing, `providers-settings.component.ts:370-380`) |
| `main-agent`, `main-model`, `main-effort` | Providers | Open the Main Agent popover; focus its model or effort control |
| `connections` | Providers | Focus `#providers-connections-heading` |
| `more-providers` | Providers | Open the catalog modal |
| `background-models`, `memory-curator`, `archaeologist`, `synthesis`, `judge`, `replay`, `judging-enhancement` | Orchestration | Open the roles `<details>`; pass the id to `initialEditingConsumerId` (existing input, `provider-consumer-assignments.component.ts:477`) |
| `cli-agents` | Orchestration | **S5 (interim):** focus `#providers-cli-heading` (`data-focus="cli-agents"`, `ptah-cli-config.component.ts:41`, inside the interim container). **S6 (final):** focus `[data-testid="cli-matrix"]` |
| no section | the requested tab | none |

  - `onModelChanged()` calls `state.redetectClis()`. Remove the `viewChild` (:89-91).
- Failure behaviour: an unknown section falls back to the tab only.
- Verification seam, with spec cases split by batch so each batch's cases can be satisfied (review N2):
  - **S5** adds the cases for: `providerId`, `main-agent`/`main-model`/`main-effort`, `connections`,
    `more-providers`, every background-role section (tab = Orchestration, the `<details>` opens, and
    `initialEditingConsumerId` is passed), `cli-agents` → the interim `#providers-cli-heading`, and
    no-section.
  - **S6** changes the one `cli-agents` case to the final `[data-testid="cli-matrix"]` target, and the
    background-role cases to assert `background-roles-details` is `open`.
  - `settings.component.spec.ts` covers these cases, plus the
  re-detect-from-Advanced case (the #84 fix).
- Files: MODIFY `CHAT/settings.component.ts`, `CHAT/settings.component.html`,
  `CHAT/settings.component.spec.ts`.

### 11. Save feedback: `SettingsSaveFeedbackService` + `SettingsToastComponent`

- Purpose: one path for save-on-selection feedback and Undo (D2/D3).
- Contract:
  - `save({label, scope, write, undo}): Promise<void>`
    - If `state.commit().status === 'saving'`: show "Another change is still saving." and do not call
      `write`.
    - Otherwise await `write()` and read `state.commit()`:
      - `saved` → toast "Saved {label} to {scope label}." with Undo when `undo` is given.
      - `partial`/`failed`/`unconfirmed`/`blocked` → an alert toast listing `unsaved`/`unconfirmed`
        field names and `commit.message`, with no Undo.
    - Undo runs `undo()` through `save()` with `undo: null`.
  - Toast state: one `signal<Toast | null>`. The toast renders `role="status" aria-live="polite"`
    (success) or `role="alert"` (failure). `data-testid="settings-toast"` and `settings-toast-undo`.
- Runtime cost: one `setTimeout` for auto-dismiss (8 s). It is cleared on replace, dismiss and
  `DestroyRef`. Nothing per item.
- Modal interplay: `showModal()` makes the page inert, so the tier-mapping and add-instance modals render
  a second `<ptah-settings-toast>` inside their footer. The page instance is inert while a modal is open,
  so assistive tech announces only the modal's instance.
- Verification seam: a spec covers:
  - The saved path with Undo, where Undo performs the second write.
  - The failed path with no Undo.
  - Re-entry while saving does not call `write`.
  - The timer is cleared on destroy.
- Files: CREATE `CHAT/feedback/settings-save-feedback.service.ts`,
  `CHAT/feedback/settings-toast.component.ts` and their specs.

### 12. Providers tab (composition + new components)

`ProvidersSettingsComponent` (REWRITE) composes the tab and owns the overlay open/close signals. It keeps
selector `ptah-providers-settings`, inputs `focusTarget`/`requestedProviderId`, output
`requestedProviderConsumed`, the wizard host (`:252-263`) and every wizard handler (`:447-505`).

- **Removed from the page:** the page-level `<h1>Providers</h1>` block and "Refresh settings"
  (`:41-58`); "Check connection" moves to the Main Agent popover and the drawer. The nine read-state lines
  (`:60-69`) move to each owning region (a node skeleton, the grid, the matrix) so loading lines no longer
  push the fold. The inline background assignments and `<ptah-cli-config>` (`:206-211`) are **moved, not
  dropped (D14)**. In S5 they are mounted, unchanged, on the Orchestration tab below
  `<ptah-agent-orchestration-config />`, through `OrchestrationSettingsComponent` in its interim form
  (created in S5 as a container that renders the old AOC, `ProviderConsumerAssignmentsComponent` and
  `PtahCliConfigComponent`, and provides the loader).
  - Like the final form, the interim container calls `state.open()` in `ngOnInit` (a user can land
    on Orchestration first, before Providers ever mounts) and forwards `focusTarget` (review N3).
  - Test: in `orchestration-settings.component.spec.ts` (S5), mounting the container alone calls
    `ProvidersSettingsStateService.open()` once.
  - Shell-level test in `settings.component.spec.ts` (S5): with a pending `{tab:'orchestration'}`
    request, the Providers page is not rendered, the interim container is, and `open()` has been
    called. The harness cannot raise a pending-tab request directly (host config only sets
    `initialView`), so this unit test is the proof. This way:
  - the Ptah CLI instance UI (add, edit, delete, test, per-instance model, Cursor key, delegated
    model/effort) is never unmounted;
  - the background-role deep-link rows in Component 10 already resolve to Orchestration in S5.

  S6 replaces the container's contents and deletes `PtahCliConfigComponent` in the same batch.
- **Order:** routing map → Connections header (count "N configured · M available in catalog", filter
  input, primary `btn-primary btn-sm` "Connect provider") → #22 line (D10) → grid
  `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3` → "+ Connect another provider" tile → catalog
  hint strip → commit status line (unchanged, `:241-249`).
- New or changed components:
  - **`RoutingMapComponent`** (`CHAT/providers/routing-map.component.ts`, CREATE) and
    **`RoutingMapNodeComponent`** (`CHAT/providers/routing-map-node.component.ts`, CREATE), per spec §2.1
    and §3.1. Node testids: `routing-node-main-agent|background-roles|cli-agents`.
    - The Main Agent node opens the popover.
    - The Background Roles and CLI nodes call `appState.requestSettingsTab({tab:'orchestration',
      section:'background-models'|'cli-agents'})`, handled by Component 10's table.
    - Header "Operational" badge = `route.ready`.
    - Background preview = the two roles with an explicit provider plus "N follow main agent".
    - CLI preview = the first 4 of the preferred order, plus counts of enabled system CLIs and Ptah
      instances.
    - Status dots are always paired with text.
  - **`MainAgentReassignPopoverComponent`** (`CHAT/providers/main-agent-reassign-popover.component.ts`,
    CREATE) inside `NativePopoverComponent` (`backdropClass="transparent"`, `placement="bottom-start"`).
    - **Provider** `<select>` over activatable connections, with the rule from
      `providers-settings.component.ts:425-441`. Choosing one shows an inline confirm with a "Save to"
      radio group (`writeScopes('authMethod')`), the copy "New main-agent requests use {name}. Changing
      the provider ends running chat sessions.", and "Use for main agent". It calls `activateConnection`,
      with no Undo (D6). The uncheckable note (`:179-181`) is kept.
    - **Model**: `ProviderModelPickerComponent [searchable]="true" [fixedProvider]=driver`, saved on
      selection via `saveSettings({model:{model, applyTo}})`, with Undo = the previous model to the same
      scope.
    - **Effort**: five buttons from `effortLevels` (`:288`) plus "Provider default", saved on selection
      with Undo.
    - **Save to** target defaults to the current source scope (`:510-511, 526-527`).
    - "Check connection" calls `state.checkConnection()`.
  - **`SettingScopeRowComponent`** (MODIFY, spec §2.1/§3.2). Selector, inputs and outputs are unchanged.
    The template becomes a badge that renders **nothing** when `!hasOverride()`, plus a popover with the
    Global/App/Workspace rows and the existing Clear / Use global buttons.
    - **Visible field name (D16):** the badge text is
      `{short field name} · {Workspace|App}` (e.g. "Provider · App", "Effort · Workspace"), and the
      popover header is `{fieldName}` in full.
    - Markup: `data-testid="scope-badge"`, `[attr.data-field]="fieldName()"`. `fieldName` becomes
      required when rendered (an empty value is a spec failure).
    - The short name comes from a new optional input, `shortFieldName = input<string|null>(null)`, and
      falls back to `fieldName`.
    - This departs from the prototype's field-less "App override" badge. Forensics §5 lesson 4 records
      unlabeled provenance as a shipped #575 defect, and the badge is ≤ 2 words longer, so it fits the
      node header row. Those buttons still emit
    `clearRequested`/`useGlobalRequested`. The parent keeps the existing review-then-confirm
    (`providers-settings.component.ts:193-204, 558-565`), because clearing `authMethod`,
    `anthropicProviderId` or any `provider.*` key resets the SDK (`config-scope-rpc.handlers.ts:120-145`,
    Verified (trace)).
  - **`ProviderConnectionCardComponent`** (REWRITE for ≤ 80 px):
    - Every input and output is kept, including `manageRequested` (`provider-connection-card.component.ts:465-561`).
    - Adds `detailsRequested = output<void>()` and `usedByCount = input<number | null>(null)`.
    - `[clickable]="true"` on the inner card; `activated` → `detailsRequested`.
    - At most one inline action (the state's primary, e.g. Retry or Use for main agent) as `btn-xs`. The
      remaining per-state actions move to the drawer.
    - Keeps `data-testid="provider-connection-card"`, `provider-name`, `status-copy`, `auth-modality`.
    - The state table (`ResolvedConnectionState`, `:52`) and its copy/tone/aria derivations move to
      CREATE `CHAT/providers/provider-connection-card.state.ts` (pure functions) so the component drops
      under 700 lines (TASK_2026_554).
  - **`ConnectionDetailDrawerComponent`** (CREATE `CHAT/providers/connection-detail-drawer.component.ts`)
    on `NativeDrawerComponent` (`widthClass="w-full max-w-md"`) + `NativeTabGroupComponent`.
    - Tabs are computed from `connectionKind` (`CHAT/providers/connection-drawer/connection-kind.ts`,
      pure) per spec §2.3. Inapplicable tabs are not rendered.
    - Tab bodies are separate components so each stays small:
      - `connection-drawer/overview-tab.component.ts`: status, "Check connection", the Used-by list from
        `CHAT/providers/connection-usage.ts`, and "Follows main agent →" chips that deep-link to
        Orchestration.
      - `connection-drawer/credentials-tab.component.ts`: masked key, show/hide (#49), Replace
        (verify-then-save through the existing `verifyDraftConnection` callback, `:457-462`, then
        `connectProvider` with `activation:'connect-only'`), and Delete key with an inline confirm
        (#7/#8).
        - For `anthropic`, Replace uses `activation:'use-main-agent'` only when Claude API is already
          the active driver. Otherwise it shows "Connect provider" guidance: `connectProvider` blocks
          `anthropic` + `connect-only` (`:442`), because the Anthropic key is stored only through
          `auth:saveSettings`.
        - Copilot shows the account label and Sign out (#12).
        - Codex shows token-stale copy and "Open login" (#13).
        - `claude-cli` shows the `claude login` / install copy with a Copy button (#10), from
          `performExternalAuth` copy (`:413`).
        - Ollama Cloud shows the optional-key explanation and link (#15).
        - `helpUrl` or the registry help link gives "Get a key" (#9/#20).
      - `connection-drawer/models-tiers-tab.component.ts`: Sonnet/Opus/Haiku pickers
        (`searchable`, tool-use summary), each saved on selection via `setMainAgentTier` with Undo, plus
        custom model ID entry (#35).
      - `connection-drawer/advanced-tab.component.ts` (custom only): base URL and models endpoint
        (verified, D7); help URL and pricing in/out (direct, #28/#30), with the note "Stored for your
        reference; Ptah does not use it for cost estimates yet." (the honest form of the §3 finding); and
        Delete connection with confirm (#25).
    - The footer has a per-tab primary action only (deviation 3).
    - `data-testid="connection-detail-drawer"`.
  - **`ProviderCatalogModalComponent`** (CREATE `CHAT/providers/provider-catalog-modal.component.ts`) on
    `NativeModalComponent size="lg"`. It has a search input and a `menu` list of unconfigured catalog
    entries (the `catalog()` computed, `:342-345`). `providerChosen` → the parent closes the modal and
    calls `openWizard(id)`. "Custom endpoint" → `openWizard('')`. "Sign in to X" for OAuth/CLI entries is
    kept (`:224-226`). `data-testid="provider-catalog-modal"`.
  - **`connection-usage.ts`** (CREATE, pure): computes `{providerId → readonly UsedBy[]}` from
    `route.driverProviderId` (main agent), `memory.curatorProvider`, `lanes[*].provider` (empty = follows
    main), `judging.judgeProvider` and `cliAgents[].providerId`. System CLIs are excluded (Assumption:
    their auth is not a Settings connection; revisit if the user wants Codex CLI counted under OpenAI
    Codex).
- Failure behaviour: see §5.
- Verification seam: a unit spec per component; the harness Providers scenes (§7); the visual gate (§6).
- Files:
  - REWRITE `CHAT/providers/providers-settings.component.ts` and its spec
  - REWRITE `CHAT/providers/provider-connection-card.component.ts` and its spec
  - MODIFY `CHAT/providers/setting-scope-row.component.ts` and its spec
  - CREATE `CHAT/providers/routing-map.component.ts`, `CHAT/providers/routing-map-node.component.ts`,
    `CHAT/providers/main-agent-reassign-popover.component.ts`,
    `CHAT/providers/provider-connection-card.state.ts`,
    `CHAT/providers/connection-detail-drawer.component.ts`,
    `CHAT/providers/connection-drawer/{connection-kind.ts, overview-tab.component.ts,
    credentials-tab.component.ts, models-tiers-tab.component.ts, advanced-tab.component.ts}`,
    `CHAT/providers/connection-usage.ts`, `CHAT/providers/provider-catalog-modal.component.ts`, plus a
    `.spec.ts` for each

### 13. Agent Orchestration tab (composition + new components)

- **`OrchestrationSettingsComponent`** (CREATED in S5 in its interim form, see Component 12 / D14;
  REWRITTEN to this final form in S6) at `CHAT/ptah-ai/orchestration-settings.component.ts`.
  - Tab container: calls `state.open()` (a user can land here first) and takes a `focusTarget` input from
    the shell.
  - Composes: policy bar → CLI matrix → `<details data-testid="background-roles-details">` (closed by
    default, deviation 4) wrapping `ProviderConsumerAssignmentsComponent` → modals.
  - Mounted by `settings.component.html` in place of `<ptah-agent-orchestration-config />` (:118-120).
- **`AgentOrchestrationConfigComponent`** (REWRITE; class and selector kept, still exported from
  `CHAT/index.ts:12`). It becomes the one-row policy bar:
  - max-concurrent range (1-20) + live value
  - preferred-order chips with ▲/▼ buttons and `aria-label`s (deviation 5; `moveAgentUp/Down` logic kept,
    :426-443)
  - Re-detect → `state.redetectClis()`
  All writes go through `SettingsSaveFeedbackService` → `state.saveSettings({orchestration:{…}})`.
  Private `agentConfig` and `ClaudeRpcService` are removed. `data-testid="orchestration-policy-bar"`.
- **`CliOrchestrationMatrixComponent`** (CREATE `CHAT/ptah-ai/cli-orchestration-matrix.component.ts`) +
  `CHAT/ptah-ai/cli-matrix-rows.ts` (pure row derivation).
  - Merges `state.orchestration().detectedClis` (system CLIs; `ptahCliId` rows skipped),
    `state.cliAgents()` and `state.cliModels()`. Ordered by `preferredAgentOrder` using the same rank rule
    as today (:357-393). Installed first, then an "Uninstalled" subsection.
  - `<table class="table table-xs">`. Testids: `cli-matrix`, `cli-matrix-row-<id>`,
    `cli-matrix-uninstalled`.
  - Columns:
    - On/off: system → `disabledClis`; instance → `ptahCli:update.enabled`.
    - Agent/Instance + subline: version; instance key status #44 from `hasStoredKey`/`hasApiKey`; tier
      badges #54 from `cliModels[id].tierMappings`.
    - Status: detection for system rows; instance `status` #43 + latency #52 from `cliTest`.
    - Provider.
    - Model and Effort cells (below).
    - Permissions & Safety (below).
    - Actions: instance → Test (#52), Tiers (#53), Edit (#50), Delete (#55); Cursor → Credentials (#64),
      shown in the Uninstalled row too, because Cursor reports "installed" only once a key resolves
      (`cursor-cli.adapter.ts:208-223`, Verified (trace)); uninstalled → Install guide.
  - Model/Effort cells open `CliModelEffortPopoverComponent` (CREATE
    `CHAT/ptah-ai/cli-model-effort-popover.component.ts`):
    - System CLIs use the static option lists moved from `ptah-cli-config.component.ts:13-35, 237-248`,
      including the unsupported-saved-effort guard (:224-243) and the opencode/pi `provider/model` hint
      (#67).
    - Ptah instances use `ProviderModelPickerComponent [searchable] [fixedProvider]`.
    - Save on selection with Undo. A disabled or not-installed row renders plain text.
  - Permissions column: a badge plus an ℹ popover per CLI. Copy lives in CREATE
    `CHAT/ptah-ai/cli-permission-notes.ts`. The old wording (evidence table) covers
    Codex/Cursor/Antigravity/opencode/Pi. Copilot shows its auto-approve state. Ptah instance copy is new
    and **flagged for user review**.
  - The Copilot auto-approve toggle moves verbatim (the uncertain-write and recheck logic, :466-581) into
    CREATE `CHAT/ptah-ai/copilot-auto-approve-toggle.component.ts`, rendered in Copilot's permission
    popover. Its existing specs move with it.
  - Install guide: an ℹ popover with the install copy from today's "No CLI agents found" block (#77,
    `agent-orchestration-config.component.ts` install-help template).
- **`CursorCredentialPopoverComponent`** (CREATE `CHAT/ptah-ai/cursor-credential-popover.component.ts`):
  - Masked input with show/hide.
  - "Set" badge from `cursorApiKeyStored` (#64); "Remove stored key" → `saveCursorCredential('')`.
  - Help copy ("cursor.com → Dashboard → Integrations", stored in the secrets store).
  - When `cursorApiKeyEnvSet`: "CURSOR_API_KEY is set in the environment and takes precedence over the
    stored key." (551).
- **`AddCliInstanceModalComponent`** (CREATE `CHAT/providers/add-cli-instance-modal.component.ts`, the
  designer's path) on `NativeModalComponent`.
  - Name, provider select (the rule from `ptah-cli-config.component.ts:48-53, 171-175`), key with show/hide
    (#49), keyless/optional-key hints (#48).
  - When the provider is `github-copilot`: an inline "Login with GitHub" that calls
    `state.performExternalAuth('github-copilot','sign-in')` and shows its state (#47). Create stays
    disabled until `externalAuth.signInState==='signed-in'`.
  - Submit → `saveSettings({cli:[{action:'create', …}]})` (existing contract, `:999-1003`).
  - `data-testid="add-cli-instance-modal"`.
- **`CliTierMappingModalComponent`** (CREATE `CHAT/providers/cli-tier-mapping-modal.component.ts`) on
  `NativeModalComponent`.
  - Three searchable pickers with `fixedProvider` = the instance provider.
  - Placeholders show the inherited provider-level `cliAgent` tier (D5).
  - Each pick → `setCliInstanceTiers` (full object) with Undo. A "Use inherited" per tier removes that key.
  - `data-testid="cli-tier-mapping-modal"`.
- **`ProviderConsumerAssignmentsComponent`** (MODIFY). Inputs and outputs are unchanged
  (`provider-consumer-assignments.component.ts:475-482`); keep `data-testid="assignments-heading"`.
  - Rows are restyled to a `table-xs` with popover-triggered reassignment cells and "Follows main agent →"
    chips.
  - Writes go through the feedback service with Undo.
  - Row derivation (`makeRow`, helpers `:37-139`) moves to CREATE
    `CHAT/providers/provider-consumer-rows.ts` so the file drops under 700 lines.
  - `setupProviderRequested` is re-wired by the container to
    `appState.requestSettingsTab({tab:'providers', providerId})`, which opens the wizard through the
    existing deep-link path.
- **Delete:** `CHAT/ptah-ai/ptah-cli-config.component.ts` and its spec (no consumer outside Settings;
  verified by grep). Remove `CHAT/index.ts:13` export.
- Files:
  - CREATE: every component above plus a spec each; `CHAT/ptah-ai/orchestration-settings.component.ts`
  - REWRITE: `CHAT/ptah-ai/agent-orchestration-config.component.ts` and its spec
  - MODIFY: `CHAT/providers/provider-consumer-assignments.component.ts` and its spec, `CHAT/index.ts`
  - DELETE: `CHAT/ptah-ai/ptah-cli-config.component.ts`, `CHAT/ptah-ai/ptah-cli-config.component.spec.ts`

### 14. Visual-gate harness scenes

- Purpose: the render path and budget assertions that make the visual gate a test (§6).
- Responsibilities:
  - `HARNESS/settings.fixtures.ts`. The reference data set from `prototypes/BRIEF.md:44-69` expressed as
    an RPC fixture map, minus the quota state (D11). Resolvers for every write record calls and mutate the
    read-back state, following the stateful-resolver precedent
    (`marketplace.fixtures.ts:969-982`). It exports `bootSettings(page, host, theme)`, which follows
    `marketplace-visual.e2e.spec.ts:57-73`: CSP stub, bridge, `installHost`, responder,
    `localStorage 'ptah-theme'`, `goto`, then inject `{type:'switchView', payload:{view:'settings'}}`
    (valid view, `app-state.service.ts:63-70, 322-343`).
  - Scenes (§7) write screenshots to `.ptah/specs/TASK_2026_555/screenshots/angular/`.
  - Replace the hollow `provider-settings.e2e.spec.ts`: delete it; its intent is covered by the new
    interaction scenes.
  - **Reachability gate (D14, review finding 1).** `HARNESS/settings-reachability.e2e.spec.ts` plus the
    table `HARNESS/settings-reachability.table.ts`.
    - The table has one entry per parity capability: every "yes"/"partial" row of `parity-inventory.md`
      except #85 (dead code), plus the 17 restored items, plus #22/#83/#84.
    - Entry shape: `{ id: '#50', status: 'present' | 'restored', reach: (page) => Promise<void> }`.
      `reach` performs the user's clicks (tab → trigger → overlay) and asserts the capability's control
      is visible and enabled. It is not a DOM-presence check on a hidden element.
    - Restored items start as `status: 'pending'` and are flipped to `'restored'` by the batch that
      builds them.
    - Rules the spec itself enforces:
      1. Every `present`/`restored` entry must pass.
      2. The entry count never drops: a guard test asserts the count equals `EXPECTED_CAPABILITY_COUNT`,
         a constant only S4 sets.
      3. The spec fails if any entry marked `present` in the baseline commit is now `pending`. The
         baseline list lives in the same file, frozen in S4.
      4. When a batch moves a capability, it edits that entry's `reach` in the same commit.
    - **Kept-selector check** (review finding 7), in the same spec: `settings-back`,
      `provider-connection-card`, `#providers-connections-heading`, `assignments-heading` (on whichever
      tab hosts it), tab buttons by `getByRole('button', {name})` for the four tab labels, "Export
      settings", and `settings-toggle-web-search-provider`. These are the selectors
      `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts` and
      `docs-screenshots/workspace-settings.shot.ts` depend on.
    - It runs at the end of **every** batch from S4 on, backend batches included (the bundle is rebuilt
      first).
  - Docs shots and the showcase tour: S4 **does not** edit them. They are updated and re-run in S7,
    after the selector freeze (review finding 9).
- Files: CREATE `HARNESS/settings.fixtures.ts`, `HARNESS/settings-reachability.table.ts`,
  `HARNESS/settings-reachability.e2e.spec.ts`, `HARNESS/settings-visual.e2e.spec.ts`,
  `HARNESS/settings-providers.e2e.spec.ts`, `HARNESS/settings-orchestration.e2e.spec.ts`; DELETE
  `HARNESS/provider-settings.e2e.spec.ts`. In **S7** only, MODIFY
  `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` (`assignments-heading` is now
  on Orchestration, :36-44) and, if the S7 run shows a broken step,
  `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts`. Its step at :217-219 scrolls to the
  connections heading, which is kept.

---

## 2. Verified contracts

### 2a. RPCs used or added

| RPC | Params → Result (type file:line) | Handler file:line | Status |
|---|---|---|---|
| `auth:getEffectiveRoute` | `{refresh}` → route | used `providers-settings-state.service.ts:298` | existing |
| `auth:getAuthStatus` | `{providerId?}` → `{hasApiKey, authMethod, anthropicProviderId, copilotAuthenticated?, copilotUsername?, codexAuthenticated?, codexTokenStale?, claudeCliInstalled?}` `rpc-auth.types.ts:173-194` | — | existing; more fields consumed |
| `auth:saveSettings` | `AuthSaveSettingsParams` `rpc-auth.types.ts:30-38` → `{success}` :41-44 | `auth-rpc.handlers.ts:924-1019`; reset :1001-1003 | existing (activation only) |
| `auth:setApiKey` | `{provider, apiKey}` `rpc.types.ts:1468-1471` | `auth-rpc.handlers.ts:1229-1267` | existing (wizard) |
| **`auth:deleteStoredKey`** | `{providerId}` → `{success, error?}` (new, `rpc-auth.types.ts`) | new in `auth-rpc.handlers.ts`; registration :154-160, :305-315; `rpc.types.ts:1468`, `:3564+` | **new** |
| `auth:copilotLogout` | `{}` → `{success}` `rpc-auth.types.ts:72-78` | `auth-rpc.handlers.ts:1150-1177` | existing; newly called |
| `auth:copilotLogin` / `auth:codexLogin` | — | used `:421-423` | existing |
| `auth:verifyDraftConnection` / `auth:cancelDraftVerification` | `rpc-auth.types.ts:468-521` | `auth-rpc.handlers.ts:1545-1568` | existing |
| `auth:getApiKeyStatus` | `{}` | used `:369` | existing |
| `config:getScopes` / `config:clearScopeOverride` | `rpc-auth.types.ts:295-303` | `config-scope-rpc.handlers.ts:100-171` | existing |
| `config:model-switch` / `config:model-get` | `rpc-config.types.ts:14-25` | `config-rpc.handlers.ts:181-230` | existing |
| `config:effort-set` / `config:effort-get` | `rpc-config.types.ts:33-44` | `config-rpc.handlers.ts:663-710` | existing |
| `provider:getModelTiers` / `setModelTier` / `clearModelTier` | `rpc-providers.types.ts:103-152` (`scope` 'mainAgent' \| 'cliAgent'; zod rejects 'lane', `provider-rpc.schema.ts:62,79,100`) | `provider-rpc.handlers.ts:573-712` | existing |
| `provider:listCustomEntries` / `updateCustomEntry` / `removeCustomEntry` | `rpc-providers.types.ts:217-252`; partial changes `provider-registry.ts:650-652` | `provider-rpc.handlers.ts:780-829` | existing; update/remove newly called from the drawer |
| `provider:listModels` | → `ProviderListModelsResult` (`supportsToolUse` `rpc-providers.types.ts:62`) | via `ProvidersModelsLoader` | existing |
| `llm:getProviderBaseUrl` / `llm:setProviderBaseUrl` | `rpc-providers.types.ts:440-449` | `llm-rpc-app.handlers.ts:687-737` | existing |
| `agent:getConfig` | → `AgentOrchestrationConfig` `rpc-agents.types.ts:87-128` + **`cursorApiKeyStored`, `cursorApiKeyEnvSet`** | `agent-rpc.handlers.ts:174-260` | changed (551) |
| `agent:setConfig` | `AgentSetConfigParams` `rpc-agents.types.ts:177-216` | `agent-rpc.handlers.ts:262-408` | existing |
| `agent:detectClis` / `agent:listCliModels` | — | used by AOC :598-625 / state :351-353 | existing |
| `ptahCli:list` / `create` / `update` / `delete` / `testConnection` | `rpc-agents.types.ts:240-303`; summary `ptah-cli.types.ts:46-60` | `ptah-cli-rpc.handlers.ts:86-291` | existing |
| `settings:get {key:'ptahCliAgents'}` | — | used `:606` | existing |
| `memory:getTriggers/setTriggers`, `skillSynthesis:getLanes/setLanes/getSettings/updateSettings` | `rpc-curator-diagnostics.types.ts:220-226, 346-354`; `rpc.types.ts:2836-2841` | `memory-rpc.handlers.ts:720-757`; `skills-synthesis-rpc.handlers.ts:558-598, 881-922` | existing |

### 2b. State-service members added or changed

See Component 5 (551/552), Component 6 (split; no public change) and Component 7 (table). Nothing public
is removed.

---

## 3. Write-path trace table (TASK_2026_533 rule 5)

Columns: **Control → RPC → handler → storage key / store / scope → runtime reader → effect on the
running session.** "Next session" means read when a new chat session, spawn or query starts.

| Control | RPC | Handler | Key · store · scope | Runtime reader | Running-session effect |
|---|---|---|---|---|---|
| Main Agent popover → provider (confirm) | `auth:saveSettings {authMethod, anthropicProviderId?, applyTo}` | `auth-rpc.handlers.ts:924-1019` | `authMethod`, `anthropicProviderId` · `~/.ptah/settings.json` (`file-settings-keys.ts:155-156`) · global/app/workspace via `WorkspaceScopeResolver.write` (`workspace-scope-resolver.ts:181-213`), then `clearMoreSpecific`; `autoMapProviderTiers` fills unset mainAgent tiers (:1605-1645) | `active-provider-resolver.ts:25-42` | **Ends all live sessions**: `sdkAdapter.reset()` :1001-1003 → `disposeAllSessions` (`sdk-agent-adapter.ts:550-561`). Hence the D6 confirm and copy |
| Main Agent popover → model | `config:model-switch {model, applyTo}` | `config-rpc.handlers.ts:181-230` | `provider.<authKey>.selectedModel` · file · scoped (`model-settings.ts:31-43`) | `chat-session.service.ts:526, 1230` | Next session (no `sessionId` passed) |
| Main Agent popover → effort | `config:effort-set {effort, applyTo}` | `config-rpc.handlers.ts:663-710` | `provider.<authKey>.reasoningEffort` · file · scoped | `agent-spawn-environment.service.ts:136-141`; chat effort from frontend options (`chat-session.service.ts:568`) | Next session/spawn. Assumption: the backend fallback for a new chat session was not verified; the review checks `chat-session.service.ts:568` |
| Scope badge → Clear override / Use global (confirm) | `config:clearScopeOverride {key, target}` | `config-scope-rpc.handlers.ts:100-171` | removes the nearest override or everything above global | per key, as above | **Ends all live sessions** for `authMethod`, `anthropicProviderId`, `provider.*` keys (:120-145); others none |
| Drawer → Models & Tiers (mainAgent) | `provider:setModelTier` / `clearModelTier {scope:'mainAgent'}` | `provider-rpc.handlers.ts:573-712` | `provider.<id>.mainAgent.modelTier.<tier>` · file · global (`provider-models.service.ts:140-146`) | env `ANTHROPIC_DEFAULT_*_MODEL` via `buildTierEnvDefaults` at query start (`sdk-query-options-builder.ts:1238-1241`) | Active provider: env updated, used by the **next** query (`provider-models.service.ts:574-580`). Inactive: stored only until activation (`applyPersistedTiers` :760-807) |
| Drawer → Credentials → Replace key (verified) | `auth:verifyDraftConnection` then `auth:setApiKey` (third-party) | `:1545-1568`; `:1229-1267` | `ptah.auth.provider.<id>` · SecretStorage | api-key strategy at configure (`api-key.strategy.ts:657-690`) | None now; next strategy configure. No reset |
| Drawer → Credentials → Delete key | **`auth:deleteStoredKey`** | new | `ptah.auth.anthropicApiKey` or `ptah.auth.provider.<id>` · SecretStorage | same strategies | None now. If this is the active driver, the next configure has no key → route shows needs-key (the confirm copy says so) |
| Drawer → Credentials → Copilot Sign out | `auth:copilotLogout` | `:1150-1177` | `provider.github-copilot.loggedOut = true` (`copilot-auth.service.ts:105, 189-191`) | Copilot auth service | Assumption: the effect on an in-flight Copilot proxy session is unverified. The review checks `copilot-auth.service.ts:676-682` consumers |
| Drawer → Advanced → base URL / models endpoint (verified) | `provider:updateCustomEntry {changes:{baseUrl?, modelsEndpoint?}}` | `provider-rpc.handlers.ts:780-802` | `provider.custom.entries` · file · global (`custom-provider-store.ts:52, 243-248`) | `baseUrl`: strategy configure; `modelsEndpoint`: `provider-models.service.ts:338, 456, 845`, `custom-provider-probe.ts:375` | Next configure / model fetch. No reset |
| Drawer → local base URL (verified) | `llm:setProviderBaseUrl` | `llm-rpc-app.handlers.ts:687-737` | `provider.<id>.baseUrl` · file | `local-native.strategy.ts:73-74`, `api-key.strategy.ts:657-690` | Next configure |
| Drawer → Advanced → help URL | `provider:updateCustomEntry {changes:{helpUrl}}` | same | same | drawer/wizard help links only | None (display metadata) |
| Drawer → Advanced → pricing | `provider:updateCustomEntry {changes:{pricing}}` | same | same | **No runtime reader** (`provider-registry.ts:703-718`) | None. Stored and displayed only (UI copy states this) |
| Drawer → Advanced → Delete connection | `provider:removeCustomEntry {id}` | `:811-829` (also deletes the key :819) | removes the entry + secret | registry republish | Blocked in UI for the active driver. Otherwise none now |
| Wizard (unchanged) | `connectProvider` ops (`:440-521`) | as today | as today | as today | Unchanged; activation step ends sessions (`auth:saveSettings`) |
| Policy bar → max concurrent | `agent:setConfig {maxConcurrentAgents}` | `agent-rpc.handlers.ts:262-408` | VS Code config Global (`vscode-workspace-provider.ts:111-113`); Electron config | `agent-spawn-environment.service.ts:226-256` (section `'ptah'`) | Next spawn |
| Policy bar → preferred order | `agent:setConfig {preferredAgentOrder}` | same | same store | same :226-256 | Next spawn |
| Matrix → system CLI on/off | `agent:setConfig {disabledClis}` | same | `agentOrchestration.disabledClis` · file | same :226-256 | Next spawn (hard disable, `agent-process.types.ts:299-307`) |
| Matrix → system CLI model | `agent:setConfig {<cli>Model}` | same (:1037-1043) | `agentOrchestration.<cli>Model` · file | **after D8**: `agent-spawn-environment.service.ts:166-177` with section `'ptah'` | Next spawn. **Before D8: no effect (dead read)** |
| Matrix → effort (codex/copilot/pi) | `agent:setConfig {<cli>ReasoningEffort}` | same | `agentOrchestration.<cli>ReasoningEffort` · file | **after D8**: `:118-151` | Next spawn. Codex/Copilot: the in-chat UI effort wins when set (`:139-143`) |
| Copilot auto-approve | `agent:setConfig {copilotAutoApprove}` | same, plus the live push to the permission bridge (:339-351) | `agentOrchestration.copilotAutoApprove` · file | bridge push (live); spawn read **after D8** `:153-162` | **Live** for the bridge; next spawn for the env |
| Cursor credential (set/clear) | `agent:setConfig {cursorApiKey}` | `:319-338` | `ptah.auth.provider.cursor` · SecretStorage (empty = delete); legacy file key cleared | `cursor-cli.adapter.ts:187-202` (env `CURSOR_API_KEY` wins) | Next run; none if the env var is set (UI note) |
| Matrix → Ptah instance on/off, model, name, key | `ptahCli:update` | `ptah-cli-rpc.handlers.ts:200-212` → `ptah-cli-registry.ts:339-372` | `ptahCliAgents` · file (`ptah-cli-config-persistence.service.ts:37-49`); key `ptah.auth.provider.ptahCli.<id>` | `ptah-cli-registry.ts:608, 654` | Next spawn |
| Tier-mapping modal (D5) | `ptahCli:update {tierMappings}` | same | `ptahCliAgents[id].tierMappings` · file | `resolveEffectiveTiers` `ptah-cli-registry.ts:1604-1648` (instance > provider cliAgent > defaults) | Next spawn |
| Add instance | `ptahCli:create` (+ `auth:copilotLogin` for Copilot) | `:141-153` | `ptahCliAgents` + secret | registry | Next spawn |
| Delete instance | `ptahCli:delete` | `:236-248` | removes config + secret | registry | Next spawn |
| Roles → memory curator | `memory:setTriggers` | `memory-rpc.handlers.ts:720-757` | `memory.curatorProvider/Model` · via `setConfiguration('ptah')` | `memory-trigger.service.ts:1044-1169` | Read per call (effectively live) |
| Roles → lanes | `skillSynthesis:setLanes` | `skills-synthesis-rpc.handlers.ts:881-922` | `skillSynthesis.<lane>.<field>` | `lane-resolver.service.ts:184-189` | Next lane run |
| Roles → judging/enhance timeout | `skillSynthesis:updateSettings` | `:558-598` | `skillSynthesis.<key>` | `skill-enhancer.service.ts:794`, `lane-resolver.service.ts:107` | Next read (curator keys restart the curator immediately) |
| Undo (any row above) | the same RPC with the previous value | same | same | same | Same as the row |

The **visible-effect finding** for the user: two existing behaviours end running chats (provider change
and scope clears on auth/provider keys). This plan keeps them behind a confirm and does not widen them.
Fixing the reset itself is outside this task (user decision R1).

---

## 4. Parity table

| Item | Implemented in | Test that proves it |
|---|---|---|
| #7 Delete stored Anthropic key | `credentials-tab.component.ts` → `deleteStoredKey('anthropic')` → `auth:deleteStoredKey` | `credentials-tab.component.spec.ts` (confirm → call); `auth-rpc.handlers.delete-stored-key.spec.ts`; harness `settings-providers.e2e.spec.ts` "delete key emits auth:deleteStoredKey" |
| #8 Delete stored 3rd-party key | same, `providerId` = connection | same specs (provider-slot case) |
| #12 Copilot sign out | `credentials-tab` (oauth/Copilot) → `disconnectCopilot` | facade spec `disconnectCopilot`; tab spec; harness scene |
| #25 Delete custom provider | `advanced-tab` → `removeCustomEntry` | facade spec (incl. active-driver block); tab spec; harness |
| #27 Models endpoint | `advanced-tab` → `updateCustomEntryEndpoint` (verified) | facade spec (gate refuses an unverified probe); tab spec |
| #28 Help URL | `advanced-tab` → `updateCustomEntryFields` | facade spec; tab spec |
| #30 Pricing | `advanced-tab` → `updateCustomEntryFields` | facade spec; tab spec (asserts the "not used for cost" note) |
| #34 Searchable model autocomplete | `ProviderModelPickerComponent[searchable]` + `ProviderModelSearchFieldComponent` in the popover, drawer tiers, matrix cells, tier modal | picker spec (filter, cap, pinned); harness "search filters models in Main Agent popover" |
| #38 Tool-use indicators | picker summary + per-option marker (always on) | picker spec (counts); harness asserts `provider-model-picker-tooluse-summary` text |
| #43 Ptah CLI status | matrix Status column from `PtahCliSummary.status` | `cli-matrix-rows.spec.ts` (all 4 statuses); matrix spec |
| #44 Ptah CLI key status | matrix subline from `hasStoredKey`/`hasApiKey` | `cli-matrix-rows.spec.ts` |
| #47 Inline GitHub login (Copilot instance) | `add-cli-instance-modal` | modal spec (Create disabled until signed-in); harness |
| #49 Show/hide key | `credentials-tab`, `add-cli-instance-modal`, cursor popover | each spec toggles `type` |
| #53 CLI tier mapping | `cli-tier-mapping-modal` → `setCliInstanceTiers` (D5) | facade spec (full-object write); modal spec; harness |
| #54 Tier badges | matrix subline from `cliModels[id].tierMappings` | `cli-matrix-rows.spec.ts` |
| #70 Permission notes | `cli-permission-notes.ts` + ℹ popover | notes spec (every CLI id has copy); matrix spec |
| #71 Grouping, uninstalled hidden from the primary list | `cli-matrix-rows.ts` installed/uninstalled split | rows spec; harness asserts `cli-matrix-uninstalled` holds Cursor + Pi |
| #21 Reload button | dropped (user decision) | none (absence asserted in the providers spec) |
| RUX-1 Key via 5-step wizard | drawer Credentials Replace for existing connections | credentials-tab spec; harness |
| RUX-2 Tier edits only in wizard | drawer Models & Tiers + Main Agent popover, save on selection | models-tiers-tab spec; harness Undo scene |
| RUX-3 Unconfigured hidden | hint strip + catalog modal | catalog modal spec; harness |
| RUX-4 Claude API key not manageable | drawer reachable for every card (`detailsRequested`); `anthropic` Replace rule per Component 12 | card spec; credentials-tab spec |
| RUX-5 Workspace target hidden | Save-to in the popover and drawer from `writeScopes` | popover spec (workspace offered when `activePath` set) |
| RUX-6 Five scope rows | badge-only `SettingScopeRowComponent` (nothing when inherited) | scope-row spec |
| RUX-7 "Use for main agent" hidden until checked | unchanged by design (spec §5 item 7) | existing card spec kept |
| RUX-8 CLI model/effort 3 clicks, split tabs | matrix cells, save on selection, one tab | popover spec; harness (2 clicks → `agent:setConfig`) |
| RUX-9 Repeated "Manage … in Providers" | removed; CLI node deep-links once | AOC spec asserts absence |
| RUX-10 Missing help text (#9, #10, #13, #15, #20, #64, #67) | drawer credentials copy per kind; cursor popover; opencode/pi hint | credentials-tab spec (per kind); cursor popover spec; model popover spec |
| RUX-11 CLI test without latency/reason | `cliTest` store + Status/Details | facade spec; matrix spec |
| RUX-12 Native select without search | D12 in Settings | picker spec |
| RUX-13 License/portability on Advanced | unchanged (out of scope) | none |
| #84 re-detect after VS Code LM change | `state.redetectClis()` from the shell | settings spec (#84 case) |
| #22 Security copy | one line under Connections (D10) | providers spec (both testids kept) |
| #83 Deep links | Component 10 routing table | settings spec, one case per row |

---

## 5. Failure behaviour

| Condition | Behaviour |
|---|---|
| **Loading** | Routing map: a skeleton per node while its section is `loading`/`unloaded`. Grid: skeleton cards. Matrix: skeleton rows. Drawer tabs: per-tab skeleton. `aria-busy` on each region. Save triggers disabled while a section they need is not `ready` |
| **Read error** | The owning region shows "{label} could not be loaded. Your saved settings have not changed." plus "Retry {label}", calling that section's `refresh*` (moved from `providers-settings.component.ts:60-69`). Other regions keep rendering |
| **Empty** | No connections: the grid shows "No connections configured" plus the Connect CTA. No CLIs installed: install help (#77). No Ptah instances: "Add Ptah CLI Instance" empty row. Catalog search with no match: "No matching providers" plus Clear |
| **Unsupported runtime** | Save-to lists only `writeScopes(key)`. `app` appears only where `config:getScopes` reports it; `workspace` only with `activePath` (`providers-settings-state.service.ts:689-697`). Header shows "App: Desktop" or "App: VS Code". Search & Voice's Electron-only content is unchanged. NativeModal uses `showModal()`, which VS Code webviews (Chromium) support. The gate runs both hosts (§6) |
| **Partial save (TASK_2026_552)** | A tier conflict is reported per tier; later tiers still save; activation does not run; the wizard detail lists saved + conflicted (Component 5) |
| **Write failure surfaced (TASK_2026_553)** | Backend: `set()` rejects and memory is restored. Handler: `success:false`/error envelope. State: field in `unsaved`/`unconfirmed`. UI: alert toast "Not saved: {field}", no Undo; the control shows the read-back value after the refresh (`:1083`) |
| **Cursor key (TASK_2026_551)** | Never logged or emitted (Component 2). Read-back uses `cursorApiKeyStored`. With the env var set, the popover shows the precedence note, and both set and clear read back as success |
| **Concurrent save** | Triggers are disabled while saving. The feedback service refuses re-entry with a toast (D3) |
| **Workspace switched mid-edit** | Existing `contextMatches` → `blocked` (`:1025-1034`). Toast: "Review the current workspace…". The popover or drawer stays open with fresh values |
| **Verify failed (credential / base URL)** | Save stays disabled. The probe `reason`/`latencyMs` show inline (`rpc-auth.types.ts:509-521`). Nothing is persisted |
| **Delete key on the active driver** | Confirm copy warns that new requests fail until a key is added. After deletion the card shows `needs-key` |
| **Delete custom connection that is the active driver** | Blocked with "Switch the main agent first." |
| **Modal/popover dismissed mid-save** | The write continues; the result arrives in the page toast when the modal is closed (the inert page's toast becomes live again) |

---

## Integration architecture

- **Data flow:** control → (feedback service) → `ProvidersSettingsStateService` method →
  `ProvidersCommitService.runCommit` → `ClaudeRpcService.call` → postMessage → `rpc-handler.ts`
  dispatcher → handler → store (file / VS Code config / SecretStorage) → full `refresh()` → section
  signals → components re-render → toast.
- **State ownership:** all settings reads live in root-provided `ProvidersSettingsStateService`
  sections, keyed by workspace (`view()` `:1142-1149`). Overlay open state is component-local. The toast
  belongs to the settings-scoped `SettingsSaveFeedbackService`. No component keeps a private copy of
  host config (removes the AOC copy).
- **External boundaries:**
  - `auth:deleteStoredKey` validates `providerId` with zod.
  - Custom-entry changes are re-validated by the store schema (`custom-provider-store.ts:184-218`).
  - The frontend never stores a credential in a signal (`:115`); key inputs clear on destroy (pattern
    `ptah-cli-config.component.ts:177`).
- **Failure and rollback:** there is no client-side rollback. Undo is a new write. Commit read-back is the
  source of truth.
- **Observability:** `commit` feedback (field names) and the toast. The backend logs fixed messages; the
  Cursor paths redact. The visual gate screenshots are the evidence path for layout.

## Architecture-level quality requirements

- **Functional:**
  - All 17 capabilities and RUX items in §4 have a passing test.
  - Every row in §3 has its read-back or reader evidence.
  - The Providers fold budget passes at 1024×768 in both themes and both hosts, and so does the
    Orchestration fold budget.
- **Performance:**
  - No per-row timer, observer or poll.
  - The matrix and grid use `@for … track id`.
  - The single toast timer is released.
  - Known cost: each save triggers a full refresh (existing).
- **Security:**
  - No key in logs, output or UI state.
  - New RPC least privilege.
  - `pricing`/`helpUrl` are user text rendered by interpolation only (no `innerHTML`); the help URL opens
    through the existing external-link path.
- **Maintainability:**
  - Nx tags hold (`ui` imports ui/util only; `chat` → core/ui).
  - No deep imports.
  - Standalone + OnPush + signal inputs/outputs.
  - Every touched `.ts` file is under 700 counted lines (the wizard is untouched and remains a known
    exception).
- **Testability:** behaviour-level specs per component and per state method, plus harness scenes for
  flows that cross components.

---

## 6. Visual gate (how the page is rendered and judged)

**Render path (verified to exist):** `@ptah-extension/webview-e2e-harness` with `useAppBuild: true`
serves `dist/apps/ptah-extension-webview` (`fixture-server.ts:87-107`). A fixture RPC responder answers
every call, and the host config selects the VS Code or Electron shell. This is the mechanism TASK_2026_533
used for its Marketplace gate (`marketplace-visual.e2e.spec.ts`).

The Electron app runs with `npx nx run ptah-electron:serve` (target exists), but it shows the machine's
real data, not the reference set. So it is used only once, in the close-out, for a live sanity pass. The
existing live script `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` is updated
for that pass. Assumption: it runs with `npx playwright test -c apps/ptah-electron-e2e/docs-screenshots.config.ts workspace-settings`;
the close-out executor confirms the invocation from `docs-screenshots.config.ts`.

**Commands:**
```
npx nx build ptah-extension-webview
npx playwright install chromium          # once per machine
cd libs/frontend/webview-e2e-harness && npx playwright test --config=playwright.config.ts src/lib/scenarios/settings
```

**Automated pass/fail (in `settings-visual.e2e.spec.ts`; a failing assertion fails the batch):**
- Viewport 1024×768. Hosts: `vscode` (viewport = panel) and `electron` (real shell chrome). Themes:
  `anubis` and `anubis-light`.
- Providers (spec §1.1): `window.scrollY === 0`. The bottom edge of `[data-testid="settings-tabs"]`,
  `[data-testid="routing-map"]`, `#providers-connections-heading` and the 5th
  `[data-testid="provider-connection-card"]` is ≤ 660 px. Every card's height is ≤ 80 px. The grid
  computes 3 columns at 1024 px (≥ 2 at 641-1023 px, checked at 800 px).
- Orchestration (spec §1.2): the bottom of `orchestration-policy-bar`, the `cli-matrix` header row, the
  first row, and `background-roles-summary` is ≤ 660 px with the 5+2 reference set.
  `background-roles-details` is not `open` by default. The table has class `table-xs`. Row heights are
  logged in the report; the pass line is the summary's position.
- Scope badges (D16): every visible `[data-testid="scope-badge"]` has a non-empty `data-field`, and its
  text contains a field name, not only a scope word.
- Reachability (D14): `settings-reachability.e2e.spec.ts` is green in both hosts. This runs at the end of
  every batch, not only the UI batches.
- Wait rules: `waitForSettled` (no `aria-busy`/skeleton/spinner) and `waitForAnimationsSettled`
  (`marketplace.fixtures.ts:296`) before any capture, so a capture never fires mid-animation.
- Captures (`.ptah/specs/TASK_2026_555/screenshots/angular/`):
  - Both tabs × 2 themes × 2 hosts.
  - The drawer for each connection kind (claude-cli, api-key, oauth, custom).
  - Main Agent popover; scope popover; catalog modal.
  - Matrix model popover; permission popover; tier-mapping modal; add-instance modal.
  - A toast with Undo.

**Human pass/fail (visual-reviewer, `visual-review.md`):**
- Input: the captures, `prototypes/final/screenshots/{index,orchestration}-{anubis,anubis-light}-1024x768.png`,
  the interaction shots in `prototypes/final/screenshots/interactions/`, and the "before" set
  `.ptah/specs/TASK_2026_555/screenshots/current-0{1,2,3}.png`.
- It may re-run the spec with `--headed` or `--ui` to drive states.
- Pass requires all of:
  - The automated fold assertions are green.
  - Structure, order, hierarchy (one primary button per region), and card/node/matrix composition match
    the prototype, except the recorded deviations 3-6 and D9-D11.
  - No `text-primary`/`text-error` text (deviation 6, approved by the user, R4).
  - Focus is visible on every trigger.
  - Esc/backdrop closes every overlay and returns focus.
  - axe shows no `nested-interactive` violation beyond the known clickable-card pattern (reported, not
    blocking, if it matches `native-card.component.ts:100-101`).
- Known expected difference: the prototype's own Orchestration render uses ≈56 px rows and puts the roles
  summary below the fold (seen in `orchestration-anubis-1024x768.png`). The §1.2 budget is the pass line,
  so density follows the spec, not the prototype screenshot.

**Process rules that stop a repeat of #575:**
1. No component is accepted unmounted. Each UI batch mounts what it builds into the real page in the same
   batch.
2. One frontend owner per tab batch. Components of one tab are not built in parallel lanes.
3. A UI batch is committed only with green fold assertions **and** a `visual-review.md` PASS for that tab.
4. A code review never substitutes for the visual review. The reviewer is not the author (cross-side,
   `agent-lanes` SKILL.md:155-161).
5. The hollow settings e2e spec is deleted and replaced by assertions that can fail.
6. **No capability is ever unreachable between batches (D14).** A component is removed only in the
   batch that mounts its replacement. The reachability spec, run at the end of every batch from S4
   onward, is the proof. A batch whose reachability run is red is not committed, even when its own tab's
   visual gate is green.

---

## Sequencing proposal (for the team-leader; component-level, file-disjoint where possible)

| Step | Content (components) | Depends on | Parallel-safe with |
|---|---|---|---|
| S1a | Component 1 (553) | — | S1b, S1c, S3, S4 |
| S1b | Components 2 + 3 (551 backend, D8) | — | S1a, S1c, S3, S4 |
| S1c | Component 4 (`auth:deleteStoredKey`) | — | S1a, S1b, S3, S4 |
| S2a | Component 5 (551 UI read-back, 552) | S1b (type fields) | S3, S4 |
| S2b | Component 6 (554 split, no behaviour change) | S2a | S3, S4 |
| S2c | Component 7 (new state members) | S2b, S1c | S3, S4 |
| S3 | Components 8 + 9 (`libs/frontend/ui` only) | — | S1*, S2*, S4 |
| S4 | Component 14: fixtures, `bootSettings`, the **reachability table and spec frozen against the current page** (baseline, all `present` entries green), and a smoke capture of the current page at 1024×768 in both hosts and themes. S4 also re-confirms the D11 evidence (`agent-process.types.ts:282-313`: no quota field) in its report. No docs-shot or tour edits | — | S1*, S2*, S3 |
| S5 | Components 10 (**all** routing rows), 11, 12, plus the **interim** `OrchestrationSettingsComponent`, which mounts the old AOC, assignments and `PtahCliConfigComponent` unchanged on Orchestration (D14). Providers scenes and assertions → **visual gate (Providers)**, plus the reachability run (moved entries re-pointed; restored drawer items flipped) | S2c, S3, S4 | none (single owner) |
| S6 | Component 13: replaces the interim container's contents and deletes `PtahCliConfigComponent` **in the same batch** as the matrix and modals land. Orchestration scenes and assertions → **visual gate (Orchestration)**, plus the reachability run (remaining restored items flipped; zero `pending` entries left) | S5 | none |
| S7 | Close-out: <br>• delete the hollow spec<br>• update and run `workspace-settings.shot.ts` and `settings-tour.scene.ts` (review findings 7, 9)<br>• full both-tab visual review (both hosts/themes)<br>• live Electron sanity pass<br>• parity evidence<br>• TASK_2026_555 write-path trace report<br>• confirm `.ptah/specs/TASK_2026_551/fix-report.md` and `.ptah/specs/TASK_2026_553/fix-report.md` exist and are complete (review finding 4)<br>• checks across all touched projects | S6 | — |

**Every batch ends with:** the batch's own tests; then `npx nx build ptah-extension-webview`; then the
reachability spec. From S4 on, a red reachability run blocks the commit.
- Batches S1*/S2*/S3 that commit **after** S4 run it too.
- Those that commit **before** S4 are covered because S4's baseline run is executed on top of them. If
  that run is red, the offending earlier batch is fixed before S4 commits.
- Only S2c and S3 can plausibly change the rendered page before S5. The S2a D15 change alters which
  commits show "Saved", which the feedback line renders.

Fix-report owners: 553 → S1a (created). 551 → S1b (created) and S2a (UI half appended). S7 verifies
both.

Shared-type edits are disjoint files: S1b edits `rpc-agents.types.ts`; S1c edits `rpc-auth.types.ts` +
`rpc.types.ts`.

## 7. Test plan per step

| Step | Specs to add or update | Command |
|---|---|---|
| S1a | `file-settings-manager.error-paths.spec.ts` (flip :139-150; new restore/listener/queue cases); bootstrap specs (vscode, electron, cli with-engine); caller specs in vscode-core and the platform libs that assumed `set` resolves; `TASK_2026_553/fix-report.md` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/settings-core @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli` |
| S1b | `cursor-cli.adapter.spec.ts` (3 acceptance cases), `sdk-error-summary.spec.ts`, `agent-rpc.handlers.set-config.spec.ts` (plus the `migrateAgentOrchestrationSettings` rejecting-write case), new `agent-spawn-environment.settings-routing.spec.ts`; `TASK_2026_551/fix-report.md` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/core @ptah-extension/chat ptah-extension-webview` |
| S1c | **First:** the Electron secrets delete check (Component 4) and its spec; then new `auth-rpc.handlers.delete-stored-key.spec.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/vscode-core ptah-electron` |
| S2a | facade spec: 552 acceptance, Cursor read-back cases, the three D15 cases; existing 534 specs untouched except any saved-after-throw assertion (listed in the report); 551 fix-report UI half | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat` |
| S2b | new collaborator specs; **facade spec assertions unchanged** (diff shows no `expect` edits) | same |
| S2c | facade cases per new member (success / `success:false` / reject / read-back mismatch; array read-back) | same |
| S3 | `native-modal.component.spec.ts`; picker spec (search, summary, `searchable=false` regression); `dependency-boundaries.spec.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui` |
| S4 | `settings.fixtures.ts`; `settings-reachability.{table.ts,e2e.spec.ts}` (baseline green); smoke capture scene | `npx nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness` + build + harness command (§6) |
| S5 | specs for routing map, node, popover, scope row, card (+ state), drawer + 4 tabs, kind, usage, catalog modal, feedback service, toast, providers, shell; harness `settings-providers.e2e.spec.ts` (card → drawer per kind; delete key; Copilot sign out; catalog → wizard; popover model save → toast → Undo emits the 2nd `config:model-switch`; provider change needs confirm; deep-link `main-model` opens the popover) + the Providers half of `settings-visual.e2e.spec.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` + build + harness command |
| S6 | specs for container, AOC policy bar, matrix, rows, permission notes, model popover, cursor popover, copilot toggle (moved), add-instance modal, tier modal, consumer rows, assignments; shell routing rows; harness `settings-orchestration.e2e.spec.ts` (cell pick → `agent:setConfig`; on/off; Tiers → `ptahCli:update` full object; add Copilot instance requires sign-in; roles collapsed by default; deep-link `judge` opens `[data-testid="background-roles-details"]` (the `<details>` is `open`, and the Judge row is in edit state through `initialEditingConsumerId`); `setupProviderRequested` lands on Providers with the wizard open) + the Orchestration half of the visual spec | same as S5 |
| S7 | delete `provider-settings.e2e.spec.ts`; docs-shot and tour update and run; full harness run incl. reachability; fix-report completeness | all projects above in one `run-many`, the full settings harness folder, the live Electron docs shot and settings tour. Assumption: the tour runs with `npx playwright test -c apps/ptah-electron-e2e/showcase.config.ts settings-tour`; the S7 executor confirms this from `showcase.config.ts` |

---

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| The Electron host's sidebar narrows the content at a 1024-px window, so cards may wrap past 80 px or grid rows grow | The gate measures both hosts; if only Electron fails, see Q-extra-1 below |
| The Orchestration budget may be tight with the Ptah-instance tier-badge subline (prototype row ≈ 90 px) | Render tier badges inline on one line with `truncate` + `title`; the pass line is the roles summary position |
| Save-on-selection triggers a full `refresh()` (≈13 RPCs incl. `auth:getEffectiveRoute {refresh:true}`) per pick | Accepted (existing). Recorded; a targeted refresh is a later optimisation |
| `showModal()` top layer can compete with Electron native dialogs (`update-dialog.component.ts:25-28`) | Our modals open only on user action; the live Electron pass in S7 checks file dialogs are unaffected |
| `ptahCli:testConnection` tests a hard-coded model (`ptah-cli-registry.ts:510`, Verified (trace)) | Out of scope; recorded. Latency shown is for that probe |
| Pre-existing: `llm:removeApiKey` param mismatch; the `lane` scope rejected by zod (Verified (trace)) | Not used by this task; recorded for a follow-up |
| New permission copy (Ptah instances, Copilot) not previously approved | Flagged in the matrix spec; the user reviews it with the visual review |
| The wizard file stays 2390 lines | Not in 554 scope; unchanged by this task |

Additional decisions taken with a default (the user may override without restructuring):
- D9 keeps Advanced/Search & Voice enabled.
- D10 keeps #22 as one line.
- D11 omits quota and system-CLI Test.
- #30 pricing is restored as stored-only, with honest copy.
- Q-extra-1: the fold budget is measured at a 1024×768 **window** in both hosts. If the Electron sidebar
  alone causes a FAIL, the team-leader asks the user whether the budget applies to the content width.

## Resolved decisions

The user answered on 2026-09-29 (`task.md` "## Decisions", last bullet). All four recommended defaults
were chosen.

| # | Question | Decision | Where it lands |
|---|---|---|---|
| R1 | Main-agent provider change and scope clear on auth/provider keys end running sessions | Keep an explicit confirm with the copy "ends running chat sessions". The SDK reset is not changed in this task | D6; Component 12 (popover confirm, scope-clear review) |
| R2 | What the CLI "Tiers" modal writes (#53) | The instance's own `tierMappings` via `ptahCli:update`, as a full object. The provider-level `cliAgent` tier is shown as the inherited fallback | D5; Components 7 and 13 |
| R3 | Scope of model search (#34) | Settings only, via an opt-in `searchable` input. The Memory and Thoth Skills pickers are unchanged | D12; Component 9 |
| R4 | Design-spec deviation 6 | Approved: colour on icons, dots and badges; text stays `text-base-content`. Deviations 3-5 accepted | D13; §6 human pass line |

---

## Team-leader handoff

- **Recommended executors:**
  - S1a/S1b/S1c → `backend-developer`: platform-core, cli-agent-runtime and rpc-handlers code with specs.
  - S2a-S2c → `frontend-developer`: Angular core service with signals.
  - S3 → `frontend-developer`: `libs/frontend/ui` primitives.
  - S4 → `senior-tester`: harness fixtures and render proof.
  - S5 and S6 → **one** `frontend-developer` each, as the single integration owner per tab, followed by
    `visual-reviewer`, then `code-logic-reviewer` + `code-style-reviewer` cross-side.
  - S7 → `senior-tester` + `visual-reviewer`.
- **Complexity:** HIGH. The work spans 4 backend libs and 3 frontend libs, a facade split, a new
  primitive, two tab rebuilds, and a runtime reader fix.
- **Dependencies and ordering:** as in the sequencing table. S5 and S6 both edit `settings.component.*`,
  so S6 runs after S5. S2a → S2b → S2c are strictly sequential (same files).
- **Parallel-safe work:** S1a ∥ S1b ∥ S1c ∥ S3 ∥ S4, and all of those ∥ S2a-S2c except where the table
  says otherwise.
- **Files affected:**
  - CREATE:
    - `libs/backend/platform-core/src/file-settings-errors.ts`
    - `…/cli-agents/agent-spawn-environment.settings-routing.spec.ts`
    - `…/handlers/auth-rpc.handlers.delete-stored-key.spec.ts`
    - `CORE/providers-commit.service.ts` (+spec), `CORE/providers-connection-setup.service.ts` (+spec),
      `CORE/providers-settings-sections.ts`, `CORE/providers-settings.types.ts`
    - `UI/modal/{native-modal.component.ts, index.ts, native-modal.component.spec.ts}`
    - `UI/provider-model-picker/provider-model-search-field.component.ts` (+spec)
    - `CHAT/feedback/{settings-save-feedback.service.ts, settings-toast.component.ts}` (+specs)
    - `CHAT/providers/{routing-map, routing-map-node, main-agent-reassign-popover, connection-detail-drawer,
      provider-catalog-modal, add-cli-instance-modal, cli-tier-mapping-modal}.component.ts` (+specs)
    - `CHAT/providers/{provider-connection-card.state.ts, connection-usage.ts, provider-consumer-rows.ts}`
      (+specs)
    - `CHAT/providers/connection-drawer/{connection-kind.ts, overview-tab, credentials-tab, models-tiers-tab,
      advanced-tab}.component.ts` (+specs)
    - `CHAT/ptah-ai/{orchestration-settings, cli-orchestration-matrix, cli-model-effort-popover,
      cursor-credential-popover, copilot-auto-approve-toggle}.component.ts` (+specs)
    - `CHAT/ptah-ai/{cli-matrix-rows.ts, cli-permission-notes.ts}` (+specs)
    - `HARNESS/{settings.fixtures.ts, settings-reachability.table.ts, settings-reachability.e2e.spec.ts,
      settings-visual.e2e.spec.ts, settings-providers.e2e.spec.ts, settings-orchestration.e2e.spec.ts}`
    - `.ptah/specs/TASK_2026_553/fix-report.md` (S1a), `.ptah/specs/TASK_2026_551/fix-report.md`
      (S1b + S2a)
    - `CHAT/ptah-ai/orchestration-settings.component.ts`: interim form in S5, final form in S6
  - MODIFY:
    - `libs/backend/platform-core/src/{file-settings-manager.ts, index.ts, file-settings-manager.error-paths.spec.ts}`
    - the bootstrap specs (vscode, electron, cli-engine `with-engine.spec.ts`)
    - `…/cli-adapters/{sdk-error-summary.ts, cursor-cli.adapter.ts}` + their specs
    - `…/cli-agents/agent-spawn-environment.service.ts`
    - `…/handlers/{agent-rpc.handlers.ts, auth-rpc.handlers.ts, auth-rpc.schema.ts}`,
      `agent-rpc.handlers.set-config.spec.ts`
    - `libs/shared/src/lib/types/rpc/{rpc-agents.types.ts, rpc-auth.types.ts}`, `libs/shared/src/lib/types/rpc.types.ts`
    - `CORE/providers-settings-state.service.spec.ts`
    - `UI/index.ts`, `UI/provider-model-picker/provider-model-picker.component.ts` (+spec)
    - `CHAT/settings.component.{ts,html,spec.ts}`, `CHAT/index.ts`
    - `CHAT/providers/setting-scope-row.component.ts` (+spec),
      `CHAT/providers/provider-consumer-assignments.component.ts` (+spec)
    - `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` (S7),
      `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts` (S7, if its run fails)
    - S1a: caller specs in vscode-core, platform-vscode, platform-electron and platform-cli that assumed
      `set` resolves
    - S1c: the Electron secrets implementation, only if its delete check fails
  - REWRITE:
    - `CORE/providers-settings-state.service.ts`
    - `CHAT/providers/providers-settings.component.ts` (+spec)
    - `CHAT/providers/provider-connection-card.component.ts` (+spec)
    - `CHAT/ptah-ai/agent-orchestration-config.component.ts` (+spec)
  - DELETE:
    - `CHAT/ptah-ai/ptah-cli-config.component.ts` (+spec)
    - `HARNESS/provider-settings.e2e.spec.ts`
- **Verification points:**
  - Confirm every file:line in "Codebase evidence" before editing its neighbourhood.
  - Honour the unchanged contracts: `PendingSettingsTab`, the picker's existing inputs, outputs and
    testids, the facade's public members, the card's inputs and outputs, and the live-script selectors.
  - No data migration: `tierMappings` and custom-entry fields already exist.
  - Commands: the §7 commands per step. Before merge, run one `run-many` over
    `@ptah-extension/{platform-core,vscode-core,platform-vscode,platform-electron,platform-cli,settings-core,rpc-handlers,cli-engine,cli-agent-runtime,shared,core,chat,ui,memory-curator-ui,skill-synthesis-ui,webview-e2e-harness}`
    plus `ptah-extension-webview ptah-extension-vscode ptah-electron ptah-cli`. Then run the settings
    harness (reachability green, zero `pending`) and get `visual-review.md` PASS for both tabs. Then
    confirm both folded fix reports.

---

## Revision log

### Round 1 (review: `implementation-plan-review.md`, REVISE; user answers to the 4 clarifications)

| Finding | Fix |
|---|---|
| User answers to Clarifications 1-4 | `## Clarifications Needed` replaced by `## Resolved decisions` (R1-R4). D5, D6, D12 and D13 are marked user-approved. The "Missing decision-critical input" line now reads none |
| 1 SERIOUS: S5 unmounts the Ptah CLI instance UI while its replacement lands only in S6, with the S5 gate green | New D14: a component is removed only in the batch that mounts its replacement. S5 creates an **interim** `OrchestrationSettingsComponent` that mounts the old AOC, assignments and `PtahCliConfigComponent` unchanged on Orchestration, and S5 now carries all deep-link routing rows. S6 replaces the contents and deletes `PtahCliConfigComponent` in the same batch. New `settings-reachability.e2e.spec.ts` plus a table covering every parity capability (present + restored), frozen at baseline in S4. It has a count guard and a no-regression-to-pending rule, and must be green at the end of **every** batch from S4 on (§6 process rule 6, sequencing footer) |
| 2 Moderate: the `migrateAgentOrchestrationSettings` spec had no owner | Assigned to S1b, which owns `agent-rpc.handlers.ts` (Components 1 and 2, S1b test row). S1a covers only the bootstrap call sites |
| 3 Moderate: S1a's verify command missed the 553 blast radius | S1a's command and the close-out `run-many` now include `@ptah-extension/vscode-core`, `@ptah-extension/platform-vscode`, `@ptah-extension/platform-electron` and `@ptah-extension/platform-cli`. Caller specs that assumed `set` resolves are updated in S1a |
| 4 Moderate: no owner for the 551/553 `fix-report.md` deliverables | 553 report created in S1a. 551 report created in S1b, with the UI half appended in S2a. S7 verifies both (sequencing table, file lists, handoff) |
| 5 Moderate: scope badge had no visible field name | New D16: badge text is "{short field} · {scope}", the popover header names the field, markup has `data-testid="scope-badge"` + `data-field`, and there is a new `shortFieldName` input. Visual-gate assertion added (§6) |
| 6 Moderate: Electron secrets delete was an unverified assumption | The Electron delete check is now S1c's **first** checklist item, with its own spec. If it fails, the Electron secrets implementation joins S1c's MODIFY list; the handler does not ship on the assumption. S1c's verify command adds `vscode-core` and `ptah-electron` |
| 7 Moderate: `settings-tour.scene.ts` unchecked | Kept-selector check in the reachability spec (every batch). S7 owns running the tour, and modifying it if a step breaks |
| 8 Moderate: `runCommit` could report "Saved" after a failed write | New D15 in Component 5 (S2a): `false`/`'conflict'` → `unsaved`, a throw → `unconfirmed`, read-back runs only after an acknowledged write. Three new specs; any deliberately changed TASK_2026_534 assertion is listed in the S2a report |
| 9 Minor: docs-shot ownership split between S4 and S7 | S4 explicitly makes no docs-shot or tour edits; both are updated and re-run in S7 after the selector freeze |
| 10 Minor: D11 quota evidence not re-verified by the review | I read `agent-process.types.ts:282-313` during planning (no quota field). S4's report re-confirms it before the matrix states are finalised |
| Check 6a: logging channel for `SettingsPersistError` unnamed | Component 1: keep `console.warn`; platform-core has no injected logger, and none is added |

### Round 2 (review: `implementation-plan-review.md` "## Round 2", REVISE, narrow)

| Finding | Fix |
|---|---|
| N1 Serious: approvals in "Resolved decisions" not recorded anywhere | The orchestrator recorded all four answers in `task.md` "## Decisions" (last bullet), and `design-spec.md` now marks deviation 6 approved. The plan's §6 human pass line now reads "deviation 6, approved by the user, R4", consistent with R4/D13 |
| N2 Moderate: S5's `cli-agents` routing row targeted `cli-matrix`, which only exists in S6 | Component 10 routing table: S5 interim target `#providers-cli-heading` (`ptah-cli-config.component.ts:41`); S6 final target `cli-matrix`. The verification seam now splits the spec cases explicitly between S5 and S6 |
| N3 Moderate: interim `OrchestrationSettingsComponent` did not open the state | Component 12: the interim container calls `state.open()` in `ngOnInit` and forwards `focusTarget`. Unit test (open called once on standalone mount), plus a shell spec proving that a direct Orchestration landing opens the state without Providers mounting (the harness cannot raise a pending-tab request) |
| N4 Minor: "roles popover" wording | S6 harness row now asserts `[data-testid="background-roles-details"]` is `open`, with the Judge row in edit state |
