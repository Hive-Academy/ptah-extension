# Implementation Plan - TASK_2026_658

## Inputs and constraints

- Requirements used: the launch prompt (user request: "a proper UI for all of those hidden settings ... similar to
  what we already have"). No `task.md`, `context.md` or `task-description.md` existed in the task folder when this
  plan was written; their absence changes no decision because the prompt carries the technical direction.
- Corrections applied: the prompt's list of 53 "no frontend reference" keys is partly wrong. 10 of them already
  have UI under another name or RPC, and 5 have no runtime reader. See the exclusions below.
- Design handoff used: none. The visual pattern is the existing session-budget card.
- Repository rules: `CLAUDE.md` (verification commands scoped per changed project, `--maxWorkers=2`,
  `--parallel=1`; no build/serve/e2e).
- Missing decision-critical input: none. Proposed numeric caps where the consumer has no maximum are marked
  as assumptions (A1).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Session budget card: `NUMBER_FIELDS` (key/label/help), reads each key with `settings:get` (5 s timeout), writes with `settings:set`, prints "Saved X." / "Could not save X. The saved setting is unchanged." / "Could not confirm saving X. Reopen settings to see the saved value." | libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts:40-45,57-93,395-424,580-621 | Behaviour and copy the generic group must match |
| Its bounds live in shared `SESSION_BUDGET_SETTINGS` (typed Number/Boolean/Enum setting interfaces), exported from the shared barrel | libs/shared/src/lib/types/session-budget.types.ts; libs/shared/src/index.ts:56 | Precedent: one shared table holds key, kind, bounds and default |
| platform-core imports that table and derives the defaults (`SESSION_BUDGET_SETTINGS_DEFAULTS`) | libs/backend/platform-core/src/file-settings-keys.ts:14,158-164 | Same derivation for the new table, so default literals are defined in one place only |
| The session budget card has a cross-field rule (tighten < handoff), commits the partner field, and has a TabManager side effect | session-budget-settings.component.ts:490-525,545-576,604-609 | Moving it onto the generic group is not a small change. Leave it as is |
| `settings:get` returns the stored value, or the `FILE_BASED_SETTINGS_DEFAULTS` fallback | libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:111-133 | The webview does not need the defaults to show values |
| `settings:set` allows a key only if `isFileBasedSettingKey` passes. The value is `z.unknown()` with no per-key type or bounds check | settings-rpc.handlers.ts:143-160; libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.schema.ts:21-24,43-54 | The backend does not refuse any of the 53 keys. It also accepts any value of any type, so validation must be added at this boundary |
| RPC contract: settings:get `{key}` -> `{success,value?,error?}`; settings:set `{key,value}` -> `{success,error?}` | libs/shared/src/lib/types/rpc.types.ts:1613-1620 | No contract change |
| Settings tabs: `claude-auth` (Providers), `orchestration`, `pro-features` (labelled Advanced), `tools` (Search & Voice). Tabs 3 and 4 are deferred into their own chunks | libs/frontend/chat/src/lib/settings/settings.component.html:106-197 | Where the new groups go |
| The Orchestration tab loads session budget and subagent TTL with `@defer (on viewport)` after the background roles, because of the 660 px fold budget | libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:170-197 | New Orchestration groups go after session budget, also deferred |
| The Advanced tab shell hosts the license card, agent behaviour, output style, MCP port and VS Code LM | libs/frontend/chat/src/lib/settings/advanced-settings.component.ts:52-163 | New "Fine-tuning" groups are added at the end |
| nx tags: chat = scope:webview,type:feature; ui = type:ui (depends on type:util only); shared and platform-core = scope:shared,type:util; rpc-handlers = scope:extension,type:feature | */project.json; eslint.config.mjs:287-297,407-427 | The shared table can be imported by platform-core, rpc-handlers and chat |
| Shared UI pieces used by the card: `SurfaceSectionComponent` (`@ptah-extension/ui`) and `SettingsBusyDisabledDirective` | session-budget-settings.component.ts:18-19 | Reused by the generic group |
| Memory trigger keys (turnThreshold, cueList, minPromptLength, maxCuratesPerHour) already have UI through `memory:setTriggers` | libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:71-133,291-334; libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:64-86 | Excluded |
| `skillSynthesis.triggers.postToolUse.minEditCount` already has UI through `skillSynthesis:setTriggers` | libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.component.ts:85,146-155 | Excluded |
| The Skills settings form is driven by a backend schema (`skillSynthesis:getSettings/updateSettings`, key = `skillSynthesis.${schemaKey}`, zod per field) | rpc.types.ts:2942-2988 (comment 2968-2974); libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:84 | Rejected alternative for the skill-synthesis keys (see decision) |
| Keys with no reader: memory.embeddingModel (model hardcoded at embedder-worker-client.ts:60; vector table fixed at 384 dims, persistence-sqlite migrations/0002_memory.ts:65), memory.searchTopK (topK hardcoded to 10, memory-search.service.ts:294,325), memory.searchAlpha (unused), gateway.coalesceMs (coalescer hardcoded, outbound-delivery.service.ts:218), agentOrchestration.codexAutoApprove (Codex lane hardcodes approval_policy, codex-lane-config.builder.ts:129) | Explore scans A and B | Excluded: a control that changes nothing misleads the user. embeddingModel would corrupt stored vectors if it were ever wired |
| compaction.* is read on every tool call and every subagent message through `CompactionConfigProvider.getConfig()`. It must be a positive safe integer with no max; an invalid value falls back to the platform-core default | libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts:40-46,107,191-207 | Applies right away. Min 1. Default literals must stay in `FILE_BASED_SETTINGS_DEFAULTS` (budgetDefault throws otherwise) |
| memory.symbolInjectionEnabled is read on each `buildBlock` | agent-sdk code-symbol-prompt-injector.ts:48-53 | Applies right away |
| memory.retention.* is read on each run, with clamps exported as `MEMORY_RETENTION_SETTING_RANGES` (processedDays 1-365, stuckDays 7-365, batchSize 50-5000) | libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:36-43 | Applies on the next run. UI bounds = these clamps |
| memory.lifecycle.* is read on each run, with clamps `MEMORY_LIFECYCLE_SETTING_RANGES` (archiveAfterDays 7-365, deleteAfterDays 7-730, maxPerWorkspace 1000-1000000) | libs/backend/memory-curator/src/lib/retention/memory-lifecycle-config.ts:19-23 | Applies on the next run. UI bounds = these clamps |
| internalQuery.* is read inside `acquireSlot()`. Values must be finite and >= 1, floored; queueTimeoutMs must be > 0 | agent-sdk internal-query/internal-query.service.ts:144-150,256-308 | Applies right away |
| cron.* is read once in `start()`. A `maxConcurrentJobs` below 1 throws `CronConfigError` at startup | libs/backend/cron-scheduler/src/lib/job-runner.ts:113-117; thoth-runtime start-thoth-cron.ts:377-382,550; cron-scheduler.ts:103,121; catchup-coordinator.ts:87-90 (clamp 0-24 h, 0 = off) | Needs a restart. Min 1 is enforced at the backend boundary |
| harness.preflightTimeoutMs (consumer default 1500, > 0) and harness.manageGitignore (default true) are read on each use but have NO entry in `FILE_BASED_SETTINGS_DEFAULTS` | file-settings-keys.ts:456-457; harness-sync harness-preflight.service.ts:76,328-347; gitignore-writer.ts:82,219 | Applies right away. The shared table supplies the defaults, so settings:get stops returning undefined |
| Skill retirement days: zod integer 1-3650, read on each sweep | libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:53,116-118,368-395 | Applies on the next sweep |
| replayValidation.minConfidence: 0-1, read per candidate. judgePanel.disagreementThreshold: >= 0, read per evaluation, no max | skill-promotion.service.ts:58,877-917; gates/judge-panel.service.ts:140,370,631-636 | Applies right away |
| skillSynthesis.triggers.bootScanDelayMs is read only when the boot scan is armed (at start, or when skill synthesis is switched back on). bootScanIdleBackoffMs is read each time the timer fires. Both >= 0 | memory-curator triggers/boot-scan-scheduler.ts:92-151; skill-synthesis triggers/skill-trigger.service.ts:222,232,870,1043 | delay: restart; backoff: applies right away |
| codexAutoCompactTokens and codexToolOutputTokenLimit are read on each Codex spawn (safe integer >= 0, 0 = leave the key out). codexWebSearch is a boolean | cli-agent-runtime agent-spawn-environment.service.ts:183-195; codex-lane-budgets.ts:73-89; codex-lane-config.builder.ts:61 | Applies to the next Codex agent started |
| autopilot.permissionLevel: chat input popover via `config:autopilot-toggle`. voice.ttsVoice: local TTS panel via `voice:setTtsConfig`. gateway.discord.applicationId: Discord kit via `gateway:setDiscordAppId`. disabledMcpNamespaces and browser.allowLocalhost (with a confirmation step): MCP port card via `agent:setConfig`. tasks.savedViews: tasks view menu via `tasks:saveViews` | chat-ui autopilot-popover.component.ts:83; chat local-tts-panel.component.ts:210; messaging-gateway-ui discord-integration-kit.component.ts:60; chat pro-features/mcp-port-config.component.ts:143,170,454; tasks-ui task-view-menu.component.ts:140 | Excluded: already set elsewhere |
| skillSynthesis.skillsRoot and browser.recordingDir: unchecked filesystem paths (trimmed only; the recorder runs mkdir -p anywhere) | skill-synthesis skill-md-generator.ts:80-97; screen-recorder.service.ts:312-333 | Excluded: a renderer-written path needs path validation and a folder picker first (follow-up) |

## Surface vs exclude (53 keys)

### Surfaced (27)

| Group (tab) | Key | Kind / unit | Bounds (min-max) | Applies |
| --- | --- | --- | --- | --- |
| Context budgets (Orchestration) | compaction.toolOutputBudgetTokens | int tokens | 100-200000 (A1) | right away |
| | compaction.subagentHandoffTokens | int tokens | 1000-2000000 (A1) | right away |
| | compaction.rotationSuggestTokens | int tokens | 1000-5000000 (A1) | right away |
| | compaction.subagentStopWeightedTokens | int weighted tokens | 1000-100000000 (A1) | right away |
| Codex agents (Orchestration) | agentOrchestration.codexAutoCompactTokens | int tokens, 0 = Codex default | 0-2000000 (A1) | next Codex agent |
| | agentOrchestration.codexToolOutputTokenLimit | int tokens, 0 = Codex default | 0-200000 (A1) | next Codex agent |
| | agentOrchestration.codexWebSearch | boolean | - | next Codex agent |
| Background query limits (Orchestration) | internalQuery.maxConcurrent | int count | 1-16 (A1) | right away |
| | internalQuery.maxConcurrentPerLane | int count | 1-16 (A1) | right away |
| | internalQuery.queueTimeoutMs | int ms | 1000-600000 (A1) | right away |
| Memory upkeep (Advanced) | memory.symbolInjectionEnabled | boolean | - | right away |
| | memory.retention.processedDays | int days | 1-365 | next cleanup run |
| | memory.retention.stuckDays | int days | 7-365 | next cleanup run |
| | memory.retention.batchSize | int rows | 50-5000 | next cleanup run |
| | memory.lifecycle.archiveAfterDays | int days | 7-365 | next cleanup run |
| | memory.lifecycle.deleteAfterDays | int days | 7-730 | next cleanup run |
| | memory.lifecycle.maxPerWorkspace | int memories | 1000-1000000 | next cleanup run |
| Skill upkeep (Advanced) | skillSynthesis.retirement.dormantAfterDays | int days | 1-3650 | next retirement sweep |
| | skillSynthesis.retirement.retireAfterDormantDays | int days | 1-3650 | next retirement sweep |
| | skillSynthesis.replayValidation.minConfidence | decimal 0-1 | 0-1 | right away |
| | skillSynthesis.judgePanel.disagreementThreshold | number, score points | 0-max (A2) | right away |
| | skillSynthesis.triggers.bootScanDelayMs | int ms | 0-3600000 | restart |
| | skillSynthesis.triggers.bootScanIdleBackoffMs | int ms | 0-3600000 | right away |
| Scheduled jobs (Advanced) | cron.maxConcurrentJobs | int count | 1-16 (A1) | restart |
| | cron.catchupWindowMs | int ms, 0 = off | 0-86400000 | restart |
| Workspace harness (Advanced) | harness.preflightTimeoutMs | int ms | 100-60000 (A1), default 1500 | right away |
| | harness.manageGitignore | boolean, default true | - | right away |

### Excluded (26), one-line reasons

- memory.embeddingModel: no reader, and the vector table is fixed at 384 dims. Exposing it would invite corruption if it were ever wired up.
- memory.searchTopK, memory.searchAlpha: no reader (search hardcodes topK = 10).
- gateway.coalesceMs: no reader (the coalescer is hardcoded).
- agentOrchestration.codexAutoApprove: no reader (the Codex lane hardcodes its approval policy).
- memory.triggers.turnThreshold / userPromptSubmit.cueList / userPromptSubmit.minPromptLength / maxCuratesPerHour: already set in the Thoth memory diagnostics through `memory:setTriggers`.
- skillSynthesis.triggers.postToolUse.minEditCount: already set in the Skills triggers card through `skillSynthesis:setTriggers`.
- agentOrchestration.disabledMcpNamespaces, browser.allowLocalhost: already set in the MCP port card through `agent:setConfig` (allowLocalhost has a confirmation step that must not be bypassed).
- autopilot.permissionLevel: chat-input autopilot popover.
- voice.ttsVoice: local TTS panel.
- gateway.discord.applicationId: Discord integration kit.
- gateway.*.tokenCipher (all gateway ciphers): encrypted secrets.
- provider.github-copilot.tokenExchangeUrl / apiEndpoint / clientId, provider.openai-codex.oauthApiEndpoint: OAuth and endpoint overrides. A wrong value breaks sign-in or redirects credentials.
- tasks.savedViews: internal state owned by the tasks view menu (`tasks:saveViews`).
- skillSynthesis.skillsRoot, browser.recordingDir: unchecked filesystem paths. Out of scope until path validation and a folder picker exist.

## Architecture decision

- Chosen approach: one shared descriptor table plus one renderer.
  1. `libs/shared` gets `ADVANCED_SETTINGS`, a typed table of descriptors (key, group, label, help, kind
     `number | boolean`, min/max/integer/step, unit, `apply`, default), `ADVANCED_SETTING_GROUPS` (id, title,
     description), and `validateAdvancedSettingValue`.
  2. platform-core derives the defaults for these keys from the table (the established
     `SESSION_BUDGET_SETTINGS_DEFAULTS` pattern), replacing the literal entries.
  3. `settings:set` validates any key that has a descriptor before it writes.
  4. One smart Angular component, `AdvancedSettingsGroupComponent` in the chat lib, renders a group by id. A new
     key therefore needs one table entry and no new component.
- Rationale: it matches the repository's own pattern (the shared bounds table that platform-core and the
  card both read, file-settings-keys.ts:158-164). Validation sits at the boundary that today accepts anything
  (settings-rpc.schema.ts:43-54). The renderer copies the session-budget card's tested behaviour and copy.
- Kinds: only `number` and `boolean`. Every surfaced key is one of those. Text, enum and string-list kinds are
  not built, because no surfaced key needs them (simplicity rule). The path keys that would need text are excluded.
- Rejected alternatives:
  - Extending the domain DTOs (`SkillSynthesisSettingsDto` + zod schema + reactive form, `MemoryTriggersDto`) for
    the skill and memory keys: each key would need an edit in 4 places across 3 libs, so the "one entry per key"
    goal is lost. The user asked for these in an Advanced section.
  - Labels in a frontend-only table (like `NUMBER_FIELDS`): each key would then need two edits that can drift.
    Copy in shared is harmless (shared already carries user-facing DTO strings), and a single shared spec can
    check that every key has a label and help text.
  - Putting the dumb renderer in `libs/frontend/ui`: only one host lib (chat) uses it, so the split buys nothing yet.
  - A batch `settings:getMany` RPC: not needed. The largest group reads 7 keys, and the card already reads 10 in parallel.
  - Moving session budget onto the generic group: it has a cross-field rule, partner commit and a TabManager side
    effect (component.ts:490-525,604-609). Not small, so it is left alone.
- Assumptions:
  - A1: caps where the consumer has no maximum (compaction, codex, internalQuery, cron.maxConcurrentJobs,
    harness.preflightTimeoutMs) are proposed product limits, chosen as about 20-100x the default. Each min is at
    least the consumer's own min, so the UI is never looser than the runtime. The implementer keeps these numbers
    unless review changes them.
  - A2: the disagreementThreshold max follows the judge's score scale. The implementer opens
    `libs/backend/skill-synthesis/src/lib/gates/judge-panel.service.ts` near :140 and sets max = the score range
    (one criterion's max minus its min).
  - A3: `webview-e2e-harness` settings fixtures (`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts`)
    answer `settings:get` for any key. Check before relying on e2e. No e2e is run in this task (CLAUDE.md).
- Effect on existing code: the literal defaults for the 25 already-defaulted keys move from
  `FILE_BASED_SETTINGS_DEFAULTS` into the shared table, with the same values. The 2 harness keys gain defaults
  equal to their consumers' defaults. `settings:set` keeps its allow-list and adds a check only for keys that have
  a descriptor. Session budget, the domain trigger UIs and all consumers stay unchanged.

## Component specifications

### 1. Shared advanced-settings table and validator

- Purpose: the single source of key, kind, bounds, default, apply timing and copy for the surfaced keys.
- Responsibilities: export `AdvancedSettingGroupId` (union: `context-budgets`, `codex-agents`,
  `background-queries`, `memory-upkeep`, `skill-upkeep`, `scheduled-jobs`, `workspace-harness`),
  `AdvancedSettingApply` (`live | next-run | next-agent | restart`), `AdvancedNumberSetting` /
  `AdvancedBooleanSetting` (discriminated on `kind`, same shape style as `SessionBudgetNumberSetting`), the readonly
  `ADVANCED_SETTINGS` array, `ADVANCED_SETTING_GROUPS`, `findAdvancedSetting(key)`, and
  `validateAdvancedSettingValue(setting, value: unknown)` returning `{ ok: true, value } | { ok: false, error }`.
  The error says the range and unit in plain words, e.g. "Use a whole number from 7 to 365 days."
  Rules: type matches the kind; `Number.isFinite`; integer when `integer`; min <= v <= max.
- Help copy rule: one plain sentence saying what the value controls, plus the unit. The renderer appends the
  range and the apply note, so help never restates them. Example: compaction.subagentHandoffTokens -> label
  "Subagent handoff size", help "Above this many tokens, a subagent's result is summarised before it is handed
  back to the main chat."
- Verified contracts: the pattern is `SESSION_BUDGET_SETTINGS` / `SessionBudgetNumberSetting`
  (libs/shared/src/lib/types/session-budget.types.ts), exported at libs/shared/src/index.ts:56.
- Dependencies: none (type:util leaf).
- Integration points: platform-core (defaults), rpc-handlers (write validation), chat (rendering and client-side validation).
- Failure behaviour: pure functions. An invalid value returns `{ok:false}`; they never throw.
- Quality: no runtime cost beyond a constant table.
- Verification seam: `advanced-settings.types.spec.ts`. Keys are unique. Every group id has a title. Every entry
  has non-empty label and help. Each default is accepted by its own validator. Values below min, above max,
  non-integer (when integer), NaN, Infinity, strings and null are each refused. Booleans refuse non-booleans.
  The memory min/max equal the clamps in A-table rows (literals pinned here; the drift guard is in Component 3).
- Files: CREATE `D:\projects\ptah-extension\libs\shared\src\lib\types\advanced-settings.types.ts`,
  CREATE `D:\projects\ptah-extension\libs\shared\src\lib\types\advanced-settings.types.spec.ts`,
  MODIFY `D:\projects\ptah-extension\libs\shared\src\index.ts` (one `export *` line beside :56).

### 2. platform-core defaults derivation

- Purpose: one owner for the default value of each surfaced key.
- Responsibilities: add `ADVANCED_SETTINGS_DEFAULTS` built from `ADVANCED_SETTINGS`, in the same way as
  `SESSION_BUDGET_SETTINGS_DEFAULTS` (:158-164). Spread it into `FILE_BASED_SETTINGS_DEFAULTS`. Delete the now
  duplicated literal entries (compaction 522-526, codex 503-505, memory 568/660-666, skill 590-591/641/650/687-688,
  internalQuery 698-700, cron 702-703). Leave unrelated literals alone. The two harness keys get defaults (1500, true).
- Verified contracts: file-settings-keys.ts:14 already imports `@ptah-extension/shared`. `budgetDefault` throws
  when a compaction default is missing or not a positive integer (compaction-config-provider.ts:40-46), so the
  derived values must stay positive integers.
- Dependencies: shared (allowed: scope:shared -> scope:shared).
- Failure behaviour: a missing default surfaces in the existing spec pins (file-settings-keys.spec.ts:255-258) and in the new assertion.
- Verification seam: extend `file-settings-keys.spec.ts`. Every `ADVANCED_SETTINGS` key is in
  `FILE_BASED_SETTINGS_KEYS`, and `FILE_BASED_SETTINGS_DEFAULTS[key]` equals the descriptor default. The existing
  literal pins still pass unchanged.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\file-settings-keys.ts`,
  MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\file-settings-keys.spec.ts`.

### 3. Drift guards for clamped consumers

- Purpose: stop the UI bounds and the runtime clamps from silently diverging.
- Responsibilities: a spec in memory-curator asserts that `MEMORY_RETENTION_SETTING_RANGES` and
  `MEMORY_LIFECYCLE_SETTING_RANGES` equal the shared descriptors' min/max, and that the defaults equal theirs.
- Verified contracts: memory-retention-config.ts:36-43; memory-lifecycle-config.ts:19-23 (both exported).
- Dependencies: memory-curator spec -> shared (allowed).
- Failure behaviour: test failure only.
- Verification seam: the spec itself.
- Files: CREATE `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\retention\advanced-settings-ranges.spec.ts`.

### 4. settings:set boundary validation

- Purpose: the renderer cannot store a wrong-type or out-of-range value for a described key. One example it
  prevents: `cron.maxConcurrentJobs: 0`, which makes cron throw `CronConfigError` at the next start.
- Responsibilities: in `registerSet`, after the `isFileBasedSettingKey` guard (:149-154), look up
  `findAdvancedSetting(params.key)`. If a descriptor exists and the validator refuses the value, return
  `{ success: false, error: <validator message> }` and do not call `setConfiguration`. If it passes, write the
  validated value. Keys without a descriptor behave exactly as today.
- Verified contracts: settings-rpc.handlers.ts:143-172; `RpcMethodParams<'settings:set'>` rpc.types.ts:1617-1620.
- Dependencies: rpc-handlers -> shared (allowed).
- Failure behaviour: the structured `{success:false,error}` envelope, the same as the existing refusals.
- Security: an input check at the trust boundary, with no secrets in the message (the message names the key and the range only).
- Verification seam: `settings-rpc.handlers.spec.ts`. A valid value for a described key is written. An
  out-of-range, non-integer or wrong-type value returns `success:false` and `setConfiguration` is not called.
  A non-described file key (e.g. `sessionBudget.tokens`) is unchanged.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\settings-rpc.handlers.ts`,
  MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\settings-rpc.handlers.spec.ts`.

### 5. AdvancedSettingsGroupComponent (chat)

- Purpose: render one group of described keys with read, validate and save. It is the generic "settings field group".
- Responsibilities: `input.required<AdvancedSettingGroupId>()`. Inside `ptah-surface-section` (tone subtle, padding md):
  - the group title and description;
  - for each descriptor in the group: number fields as a text input (`inputmode` numeric/decimal, commit on
    blur and Enter, strip `,` `_` and spaces before parsing, client check via `validateAdvancedSettingValue`)
    with a unit suffix; booleans as a toggle (shows the read-back value, as in the card);
  - help text = descriptor help + " Range: {min}-{max} {unit}." + the apply note. The apply notes are:
    live "Applies right away."; next-run "Applies on the next cleanup run."; next-agent "Applies to the next
    Codex agent you start."; restart "Restart Ptah to apply." The restart note is also shown as a small outline badge;
  - a stored-value notice when a read-back value fails the validator ("The saved value is not valid; Ptah uses
    the default (X).");
  - one `role="status"` line with the card's exact strings ("Saved {label}.", "Could not save {label}. The saved
    setting is unchanged.", "Could not confirm saving {label}. Reopen settings to see the saved value.").
    When the backend refuses a value, its `error` is shown inline under the field;
  - loading / error-with-Retry states, as in the card (component.ts:151-179).
- Reads and writes: `rpcCall(this.vscode, 'settings:get' | 'settings:set', ..., 5_000)` from
  `@ptah-extension/core`, the same as session-budget-settings.component.ts:9,398-405,590-595. Reads are parallel
  per group. A write keeps every control busy (`SettingsBusyDisabledDirective`).
- Accessibility: every input has a `<label for>`, `aria-describedby` on help + error + stored notice,
  `aria-invalid` on error, the focus ring class, and `data-testid="advanced-setting-{key}"`. The section has
  `aria-labelledby` and `data-testid="settings-section-{groupId}"`.
- Dependencies: shared (descriptors), core (`VSCodeService`, `rpcCall`), ui (`SurfaceSectionComponent`), and the
  local `SettingsBusyDisabledDirective` (`../feedback/busy-disabled.directive`). All are allowed for type:feature.
- Failure behaviour: a read failure or timeout shows the load error with Retry. A write failure keeps the saved
  value and shows the message. An invalid draft is never sent.
- Performance: no timers or observers. OnPush with signals.
- Verification seam: `advanced-settings-group.component.spec.ts` with a mocked `VSCodeService`/`rpcCall`, using
  the existing card spec's harness style (session-budget-settings.component.spec.ts):
  - renders only the group's keys;
  - a valid commit sends the exact key and number, then shows "Saved X.";
  - an invalid value shows an inline error and makes no RPC call;
  - a toggle writes a boolean;
  - a backend `success:false` shows its error;
  - a timeout shows the unconfirmed message;
  - a read failure leads to Retry;
  - a restart key shows the restart note.
- Files: CREATE `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\advanced\advanced-settings-group.component.ts`,
  CREATE `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\advanced\advanced-settings-group.component.spec.ts`.

### 6. Placement in the tabs

- Orchestration tab: after `<ptah-session-budget-settings />` (orchestration-settings.component.ts:187-194),
  add one `@defer (on viewport)` block with a one-row placeholder (same footprint and comment style as the
  session budget). It renders the groups `context-budgets`, `codex-agents` and `background-queries`. They sit
  below the fold, so the 660 px fold budget is unchanged.
- Advanced tab: after `<ptah-vscode-lm-config>` (advanced-settings.component.ts:162), add a closed-by-default
  `<details>` titled "Fine-tuning" ("Upkeep and timing values for memory, skills, scheduled jobs and the workspace
  harness. The defaults suit most people."). It wraps one `@defer (on viewport)` block that renders
  `memory-upkeep`, `skill-upkeep`, `scheduled-jobs` and `workspace-harness`.
- Verification seam: the existing `orchestration-settings.component.spec.ts` and `advanced-settings.component.spec.ts`
  each assert that the host renders the groups once the defer block resolves (use the Angular `DeferBlockBehavior.Playthrough`
  pattern if those specs already do; otherwise assert the placeholder test id).
- Files: MODIFY `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts`
  (+ `.spec.ts`), MODIFY `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\advanced-settings.component.ts` (+ `.spec.ts`).

## Integration architecture

- Data flow: tab opens -> defer block -> group component -> parallel `settings:get` per key -> SettingsRpcHandlers.registerGet ->
  IWorkspaceProvider.getConfiguration -> settings.json or the derived default. On commit: client validator ->
  `settings:set` -> parse -> `isFileBasedSettingKey` -> descriptor validator -> setConfiguration -> settings.json.
  Consumers pick the value up per their read timing (table above).
- State: the group component owns read-back, drafts and errors for its keys only. The source of truth is settings.json.
- External boundaries: renderer -> RPC. zod checks shape (existing); the descriptor validator checks value (new).
- Failure and rollback: a refused write leaves the file unchanged. A timeout is reported as unconfirmed.
  A hand-edited invalid value is shown with the stored notice and the consumer's fallback.
- Observability: the existing `[RPC] settings:set failed` logger path for write exceptions. Refusals are returned to
  the UI and are not logged (expected user error).

## Architecture-level quality requirements

- Functional: all 27 keys are readable and writable from Settings. Every field shows its unit, range and apply
  timing. No excluded key gets a control.
- Performance: groups are lazy (defer on viewport). No added eager bundle weight on the Settings route.
- Security: described keys refuse wrong types and out-of-range values at `settings:set`. Secrets, paths and
  endpoint overrides are not surfaced.
- Maintainability: adding a key = one `ADVANCED_SETTINGS` entry (its key must already be in `FILE_BASED_SETTINGS_KEYS`).
  No default literal is duplicated. The memory clamps are guarded by a spec.
- Testability: shared validator unit tests; platform-core default parity; a handler refusal test; component
  behaviour tests; host placement tests.

## Team-leader handoff

- Recommended executors: Components 1-4 -> backend-developer (shared util + backend libs). Components 5-6 ->
  frontend-developer (Angular, chat lib).
- Complexity: MEDIUM. One new shared table, one generic component, and a narrow handler change. There are many keys, but the logic is shallow.
- Dependencies and ordering: Component 1 before 2, 3, 4 and 5. Components 2, 3 and 4 are independent of each other.
  Component 6 after 5.
- Parallel-safe work: after Component 1 lands, {2, 3, 4} (backend) and {5, 6} (frontend) are file-disjoint.
- Files affected:
  - CREATE: libs/shared/src/lib/types/advanced-settings.types.ts (+ .spec.ts); libs/backend/memory-curator/src/lib/retention/advanced-settings-ranges.spec.ts;
    libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts (+ .spec.ts)
  - MODIFY: libs/shared/src/index.ts; libs/backend/platform-core/src/file-settings-keys.ts (+ .spec.ts);
    libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts (+ .spec.ts);
    libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts (+ .spec.ts);
    libs/frontend/chat/src/lib/settings/advanced-settings.component.ts (+ .spec.ts)
- Verification points:
  - Resolve A2 (judge score scale) and A3 (e2e fixture) before finalising.
  - Confirm that `FILE_BASED_SETTINGS_DEFAULTS` values are byte-identical before and after for the 25 moved keys.
  - Commands (scoped, one at a time; project names verified in each project.json):
    `npx nx test @ptah-extension/shared --parallel=1`, `npx nx test @ptah-extension/platform-core --parallel=1`,
    `npx nx test @ptah-extension/memory-curator --parallel=1`, `npx nx test @ptah-extension/rpc-handlers --parallel=1`,
    `npx nx test @ptah-extension/chat --parallel=1`. Also `typecheck` and `lint` for each changed project
    (lint enforces the module boundaries).
  - No build/serve/e2e.
- Out-of-scope findings for the user: (a) `settings:set` lets the renderer overwrite `gateway.*.tokenCipher` and the provider
  endpoint keys (allow-list only). Consider a renderer-write denylist. (b) The dead keys
  (embeddingModel, searchTopK, searchAlpha, coalesceMs, codexAutoApprove) should be wired or removed from the registry.
  (c) skillsRoot / recordingDir need path validation before any UI.
