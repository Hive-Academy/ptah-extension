/**
 * File-Based Settings Keys Registry
 *
 * Defines which settings keys are stored in ~/.ptah/settings.json instead of
 * VS Code's package.json contributes.configuration. The VS Code Marketplace
 * content scanner flags extensions with trademarked terms ("copilot", "codex",
 * "claude", "gpt") in package.json as "suspicious content".
 *
 * These keys use flat dot-notation matching the existing
 * getConfiguration('ptah', 'provider.github-copilot.clientId') call pattern.
 * The Set provides O(1) lookup for routing checks in workspace providers.
 */

/**
 * BUILT-IN provider auth keys that each get a `selectedModel` +
 * `reasoningEffort` slot.
 *
 * MUST stay in sync with `KNOWN_PROVIDER_AUTH_KEYS` in
 * `libs/backend/settings-core/src/schema/provider-schema.ts`.
 * We cannot import that constant here because settings-core depends on
 * platform-core (not the reverse) — a circular dependency would result.
 *
 * These keys must be in FILE_BASED_SETTINGS_KEYS so that
 * VscodeWorkspaceProvider routes them to ~/.ptah/settings.json instead of
 * vscode.workspace.getConfiguration (which has no schema for them).
 *
 * USER-DEFINED providers are deliberately NOT here — their ids only exist at
 * runtime. They are matched by `PROVIDER_AUTH_MODEL_PATTERN` below, the same
 * escape-hatch style this file already uses for per-provider base URLs and
 * scoped tier overrides.
 */
const KNOWN_AUTH_KEYS_FOR_FILE_ROUTING = [
  'apiKey',
  'claudeCli',
  'thirdParty.openrouter',
  'thirdParty.moonshot',
  'thirdParty.z-ai',
  'thirdParty.ollama',
  'thirdParty.ollama-cloud',
  'thirdParty.lm-studio',
  'thirdParty.github-copilot',
  'thirdParty.openai-codex',
] as const;

/**
 * The background skill-synthesis LANES and their per-lane defaults
 * (TASK_2026_180, Phase 1).
 *
 * MUST stay in sync with `SKILL_LANE_IDS`, `SKILL_LANE_FIELDS` and
 * `SKILL_LANE_DEFAULTS` in
 * `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts`, which is
 * the source of truth for both the lane vocabulary and every value below.
 *
 * It cannot be imported here for exactly the reason
 * `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` above cannot import its counterpart:
 * `platform-core` is the leaf every backend lib depends on, and
 * `skill-synthesis` depends on IT (`readSkillLane` takes an
 * `IWorkspaceProvider`), so the import would close a cycle.
 *
 * The restatement is therefore guarded MECHANICALLY rather than by comment.
 * `skills-synthesis-rpc.handlers.spec.ts` lives in `rpc-handlers`, which
 * legally imports BOTH sides, and asserts this table key-for-key and
 * value-for-value against `SKILL_LANE_KEYS` / `SKILL_LANE_DEFAULTS` — including
 * that neither side carries a lane or a field the other does not.
 *
 * Two properties of this table are contracts, not defaults that happen to be
 * convenient:
 *
 *  - **Every lane ships `provider: ''` and `model: ''`** — "inherit the active
 *    provider". `LaneResolverService` turns that pair into
 *    `{auth: undefined, model: resolveJudgeModel(...)}`, which is byte-identical
 *    to what the judge and the synthesizer already did before lanes existed. An
 *    install that never touches these keys behaves exactly as it did before.
 *    Defaulting any lane to a concrete provider would silently repoint existing
 *    installs' background work.
 *  - **Every lane carries all eight fields, `maxPasses` included.** `maxPasses`
 *    is only ever `> 1` on the archaeologist, but `readSkillLane` reads it for
 *    all four and `flattenSkillLanes` writes it for all four. A lane whose
 *    `maxPasses` key were absent here would fail in the WRITE direction only —
 *    the read falls through to the default and looks correct, while the write
 *    is handed to a store that does not own the key and is discarded with no
 *    error. That is the same failure mode `PROVIDER_SCOPED_TIER_PATTERN` below
 *    documents.
 */
const SKILL_LANE_DEFAULTS_FOR_FILE_ROUTING: Record<
  string,
  Record<string, string | number>
> = {
  archaeologist: {
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'required',
    timeoutMs: 120000,
    maxInputChars: 12000,
    maxPasses: 4,
  },
  synthesis: {
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 90000,
    maxInputChars: 8000,
    maxPasses: 1,
  },
  judge: {
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 45000,
    maxInputChars: 3000,
    maxPasses: 1,
  },
  replay: {
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 90000,
    maxInputChars: 8000,
    maxPasses: 1,
  },
};

/**
 * `skillSynthesis.<lane>.<field>` → default, derived from the table above so
 * the key list and the default map can never disagree about either half.
 */
const SKILL_LANE_SETTINGS_DEFAULTS: Record<string, string | number> =
  Object.fromEntries(
    Object.entries(SKILL_LANE_DEFAULTS_FOR_FILE_ROUTING).flatMap(
      ([lane, fields]) =>
        Object.entries(fields).map(([field, value]) => [
          `skillSynthesis.${lane}.${field}`,
          value,
        ]),
    ),
  );

/**
 * Settings keys that route to file-based storage (~/.ptah/settings.json).
 *
 * Used by VscodeWorkspaceProvider and ElectronWorkspaceProvider for routing:
 *   if (section === 'ptah' && FILE_BASED_SETTINGS_KEYS.has(key)) {
 *     return fileSettings.get(key, defaultValue);
 *   }
 */
export const FILE_BASED_SETTINGS_KEYS = new Set<string>([
  'authMethod',
  'anthropicProviderId',
  'llm.defaultProvider',
  'reasoningEffort',
  'model.selected',
  'autopilot.enabled',
  'autopilot.permissionLevel',
  'agentOrchestration.codexModel',
  'agentOrchestration.codexReasoningEffort',
  'agentOrchestration.codexAutoApprove',
  'agentOrchestration.copilotModel',
  'agentOrchestration.copilotReasoningEffort',
  'agentOrchestration.copilotAutoApprove',
  'agentOrchestration.piReasoningEffort',
  'agentOrchestration.cursorModel',
  'agentOrchestration.antigravityModel',
  'agentOrchestration.opencodeModel',
  'agentOrchestration.piModel',
  'agentOrchestration.disabledClis',
  'agentOrchestration.disabledMcpNamespaces',
  'provider.cursor.apiKey',
  'provider.github-copilot.tokenExchangeUrl',
  'provider.github-copilot.apiEndpoint',
  'provider.github-copilot.clientId',
  'provider.github-copilot.modelTier.opus',
  'provider.github-copilot.modelTier.sonnet',
  'provider.github-copilot.modelTier.haiku',
  'provider.openai-codex.oauthApiEndpoint',
  'provider.openai-codex.modelTier.opus',
  'provider.openai-codex.modelTier.sonnet',
  'provider.openai-codex.modelTier.haiku',
  'provider.openrouter.modelTier.opus',
  'provider.openrouter.modelTier.sonnet',
  'provider.openrouter.modelTier.haiku',
  'provider.moonshot.modelTier.opus',
  'provider.moonshot.modelTier.sonnet',
  'provider.moonshot.modelTier.haiku',
  'provider.z-ai.modelTier.opus',
  'provider.z-ai.modelTier.sonnet',
  'provider.z-ai.modelTier.haiku',
  'provider.ollama.modelTier.opus',
  'provider.ollama.modelTier.sonnet',
  'provider.ollama.modelTier.haiku',
  'provider.ollama-cloud.modelTier.opus',
  'provider.ollama-cloud.modelTier.sonnet',
  'provider.ollama-cloud.modelTier.haiku',
  'provider.lm-studio.modelTier.opus',
  'provider.lm-studio.modelTier.sonnet',
  'provider.lm-studio.modelTier.haiku',
  'ptahCliAgents',
  'browser.allowLocalhost',
  'browser.recordingDir',
  'workflows.disabled',
  'editor.vimMode',
  'memory.curatorEnabled',
  'memory.tierLimits.core',
  'memory.tierLimits.recall',
  'memory.tierLimits.archival',
  'memory.decayHalflifeDays',
  'memory.embeddingModel',
  'memory.curatorModel',
  'memory.curatorProvider',
  'memory.searchTopK',
  'memory.searchAlpha',
  'memory.symbolInjectionEnabled',
  'skillSynthesis.enabled',
  'skillSynthesis.successesToPromote',
  'skillSynthesis.dedupCosineThreshold',
  'skillSynthesis.maxActiveSkills',
  'skillSynthesis.candidatesDir',
  'skillSynthesis.eligibilityMinTurns',
  'skillSynthesis.evictionDecayRate',
  'skillSynthesis.generalizationContextThreshold',
  'skillSynthesis.dedupClusterThreshold',
  'skillSynthesis.prefilterMinEdits',
  'skillSynthesis.prefilterMinChars',
  'skillSynthesis.prefilterMinToolUses',
  'skillSynthesis.judgeEnabled',
  'skillSynthesis.minJudgeScore',
  'skillSynthesis.judgeModel',
  'skillSynthesis.maxPinnedSkills',
  'skillSynthesis.curatorEnabled',
  'skillSynthesis.curatorIntervalHours',
  'skillSynthesis.suggestionMinClusterSize',
  'skillSynthesis.suggestionMaxCandidates',
  // TASK_2026_180 Phase 0 — the queued synthesis drain. Dotted sub-trees under
  // `skillSynthesis.` are the proven shape (`skillSynthesis.triggers.*` below).
  //
  // There is deliberately NO pause/queueEnabled key here:
  // `skillSynthesis.enabled` above is the drain's FIRST gate and therefore the
  // single master switch. The Electron tray's "Pause background learning"
  // (commit C5) writes that same key rather than introducing a second way to
  // mean "off".
  'skillSynthesis.drain.cronExpr',
  'skillSynthesis.drain.nightlyCronExpr',
  'skillSynthesis.drain.weeklyCronExpr',
  'skillSynthesis.drain.maxItemsPerRun',
  // The NIGHTLY tier's own item cap. It exists because the two tiers are
  // throttled by different things: the frequent tier fires 96 times a day, so
  // `maxItemsPerRun` is a per-tick slice of a cadence that gets many more
  // slices; the nightly tier fires ONCE, so the same number is the whole day's
  // supply for every nightly-only stage. Raising the shared key instead would
  // multiply the frequent tier's load 96 times over to fix a once-a-day tick.
  'skillSynthesis.drain.nightlyMaxItemsPerRun',
  // The WEEKLY tier's own item cap, for the same reason one notch further out:
  // the weekly tick fires once every SEVEN days, so `maxItemsPerRun` was one
  // week's entire supply for `judge-panel` / `trigger-eval`. It was harmless
  // while those stages had no producers and became a starvation defect the
  // moment phase 3 chained both off every successful prefilter — two rows per
  // eligible session against a supply of four a week.
  'skillSynthesis.drain.weeklyMaxItemsPerRun',
  'skillSynthesis.drain.perWorkspaceBatch',
  'skillSynthesis.drain.foregroundBackoffMs',
  'skillSynthesis.drain.pauseOnBattery',
  'skillSynthesis.drain.maxAttempts',
  'skillSynthesis.drain.staleClaimTtlMs',
  'skillSynthesis.budget.maxTokensPerDay',
  'skillSynthesis.trayKeepalive',
  // TASK_2026_180 Phase 3 — the three empirical gates on the weekly tier.
  //
  // EVERY ONE OF THESE MUST BE HERE, and the omission mode is the reason this
  // comment exists. An unrouted key fails in the WRITE direction ONLY: the read
  // falls through to `FILE_BASED_SETTINGS_DEFAULTS` and looks perfectly
  // correct, while the write is handed to a store that does not own the key and
  // is dropped with no error. A user turns a gate off in the settings panel, the
  // panel redraws showing it off, and the next drain runs it anyway. This exact
  // failure has already cost this task twice — `PROVIDER_SCOPED_TIER_PATTERN`'s
  // missing `lane` scope and B1.8's four unrouted `maxPasses` keys.
  //
  // Each gate carries its own `enabled` rather than one shared switch because
  // they have independent costs: replay and judge-panel each spend a lane call
  // per candidate, while trigger-eval's retrieval is local-embedding only and
  // spends nothing beyond its prompt generation (R8).
  //
  // WHY `replayValidation` AND NOT `replay`. `skillSynthesis.replay.*` is
  // ALREADY TAKEN — `replay` is one of the four lane ids, so that sub-tree is
  // the replay LANE's eight capability fields (`provider`, `model`,
  // `timeoutMs`, …) spread from `SKILL_LANE_SETTINGS_DEFAULTS` below. Putting a
  // gate switch inside it would make `skillSynthesis.replay.enabled` look like
  // a ninth lane field to every reader and to `skillSynthesis:getLanes` /
  // `setLanes`, which round-trip that sub-tree. Two specs written by B1.8
  // exactly to catch this — here and in `rpc-handlers` — reject any
  // `skillSynthesis.{archaeologist,synthesis,judge,replay}.*` key that
  // `SKILL_LANE_KEYS` does not declare, and both fired on the first attempt.
  //
  // The distinction the name now carries is real and worth keeping: the
  // `replay` LANE is the LLM lane the gate runs ON, `replayValidation` is the
  // GATE. `triggerEval` and `judgePanel` collide with no lane id and keep their
  // plain names.
  'skillSynthesis.replayValidation.enabled',
  'skillSynthesis.replayValidation.minConfidence',
  'skillSynthesis.triggerEval.enabled',
  'skillSynthesis.judgePanel.enabled',
  'skillSynthesis.judgePanel.disagreementThreshold',
  // TASK_2026_180 Phase 1 — the four lane sub-trees, 8 fields each. Spread
  // from the same table that supplies their defaults below.
  ...Object.keys(SKILL_LANE_SETTINGS_DEFAULTS),
  'memory.triggers.preCompact',
  'memory.triggers.idleMs',
  'memory.triggers.turnThreshold',
  'memory.triggers.bootScan',
  'memory.triggers.userPromptSubmit.enabled',
  'memory.triggers.userPromptSubmit.cueList',
  'memory.triggers.userPromptSubmit.minPromptLength',
  'memory.triggers.postToolUse.enabled',
  'memory.triggers.maxCuratesPerHour',
  'skillSynthesis.triggers.sessionEnd',
  'skillSynthesis.triggers.idleMs',
  'skillSynthesis.triggers.bootScan',
  'skillSynthesis.triggers.subagentStop.enabled',
  'skillSynthesis.triggers.postToolUse.enabled',
  'skillSynthesis.triggers.postToolUse.minEditCount',
  'skillSynthesis.triggers.maxAnalyzesPerHour',
  'cron.enabled',
  'cron.maxConcurrentJobs',
  'cron.catchupWindowMs',
  'gateway.enabled',
  'gateway.coalesceMs',
  'gateway.rateLimit.minTimeMs',
  'gateway.rateLimit.maxConcurrent',
  'gateway.voice.enabled',
  'gateway.voice.whisperModel',
  'voice.whisperModel',
  'voice.ttsVoice',
  'gateway.telegram.enabled',
  'gateway.telegram.tokenCipher',
  'gateway.telegram.allowedUserIds',
  'gateway.discord.enabled',
  'gateway.discord.tokenCipher',
  'gateway.discord.allowedGuildIds',
  'gateway.discord.applicationId',
  'gateway.slack.enabled',
  'gateway.slack.botTokenCipher',
  'gateway.slack.appTokenCipher',
  'gateway.slack.allowedTeamIds',
  // Saved Tasks-board views (TASK_2026_181, FR-C2). These two are per-user
  // state with no `package.json contributes.configuration` declaration behind
  // them, so routing them here is what makes them PERSIST AT ALL: without the
  // entry, VscodeWorkspaceProvider hands the key to
  // vscode.workspace.getConfiguration, which has no schema for it, and the
  // write is discarded with no error and no warning.
  'tasks.savedViews',
  'tasks.activeViewId',
  // User-defined provider entries (TASK_2026_236) — one JSON array of
  // NON-SECRET metadata. API keys never live here; they stay in SecretStorage
  // via AuthSecretsService.setProviderKey().
  'provider.custom.entries',
  ...KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap((k) => [
    `provider.${k}.selectedModel`,
    `provider.${k}.reasoningEffort`,
  ]),
]);

/**
 * Default values for file-based settings.
 *
 * These replace the default values that were previously defined in
 * package.json contributes.configuration. The PtahFileSettingsManager
 * uses these as the fallback when no user-set value exists.
 *
 * Convention:
 * - String settings default to '' (empty string) when no meaningful default exists
 * - Model tier settings default to null (signals "use provider default model")
 * - Boolean settings have explicit true/false defaults
 * - Array settings default to [] (empty array)
 */
export const FILE_BASED_SETTINGS_DEFAULTS: Record<string, unknown> = {
  authMethod: 'apiKey',
  anthropicProviderId: 'openrouter',
  'llm.defaultProvider': '',
  reasoningEffort: 'medium',
  'model.selected': '',
  'autopilot.enabled': false,
  'autopilot.permissionLevel': 'ask',
  'agentOrchestration.codexModel': '',
  'agentOrchestration.codexReasoningEffort': '',
  'agentOrchestration.codexAutoApprove': true,
  'agentOrchestration.copilotModel': '',
  'agentOrchestration.copilotReasoningEffort': '',
  'agentOrchestration.copilotAutoApprove': true,
  'agentOrchestration.piReasoningEffort': '',
  'agentOrchestration.cursorModel': '',
  'agentOrchestration.antigravityModel': '',
  'agentOrchestration.opencodeModel': '',
  'agentOrchestration.piModel': '',
  'agentOrchestration.disabledClis': [],
  'agentOrchestration.disabledMcpNamespaces': [],
  'provider.cursor.apiKey': '',
  'provider.github-copilot.tokenExchangeUrl': '',
  'provider.github-copilot.apiEndpoint': '',
  'provider.github-copilot.clientId': '',
  'provider.github-copilot.modelTier.opus': null,
  'provider.github-copilot.modelTier.sonnet': null,
  'provider.github-copilot.modelTier.haiku': null,
  'provider.openai-codex.oauthApiEndpoint': '',
  'provider.openai-codex.modelTier.opus': null,
  'provider.openai-codex.modelTier.sonnet': null,
  'provider.openai-codex.modelTier.haiku': null,
  'provider.openrouter.modelTier.opus': null,
  'provider.openrouter.modelTier.sonnet': null,
  'provider.openrouter.modelTier.haiku': null,
  'provider.moonshot.modelTier.opus': null,
  'provider.moonshot.modelTier.sonnet': null,
  'provider.moonshot.modelTier.haiku': null,
  'provider.z-ai.modelTier.opus': null,
  'provider.z-ai.modelTier.sonnet': null,
  'provider.z-ai.modelTier.haiku': null,
  'provider.ollama.modelTier.opus': null,
  'provider.ollama.modelTier.sonnet': null,
  'provider.ollama.modelTier.haiku': null,
  'provider.ollama-cloud.modelTier.opus': null,
  'provider.ollama-cloud.modelTier.sonnet': null,
  'provider.ollama-cloud.modelTier.haiku': null,
  'provider.lm-studio.modelTier.opus': null,
  'provider.lm-studio.modelTier.sonnet': null,
  'provider.lm-studio.modelTier.haiku': null,
  ptahCliAgents: [],
  'browser.allowLocalhost': false,
  'browser.recordingDir': '',
  'workflows.disabled': false,
  'editor.vimMode': false,
  'memory.curatorEnabled': true,
  'memory.tierLimits.core': 256,
  'memory.tierLimits.recall': 4096,
  'memory.tierLimits.archival': 100000,
  'memory.decayHalflifeDays': 30,
  'memory.embeddingModel': 'Xenova/bge-small-en-v1.5',
  'memory.curatorModel': '',
  'memory.curatorProvider': '',
  'memory.searchTopK': 20,
  'memory.searchAlpha': 0.5,
  'memory.symbolInjectionEnabled': true,
  'skillSynthesis.enabled': true,
  'skillSynthesis.successesToPromote': 3,
  'skillSynthesis.dedupCosineThreshold': 0.85,
  'skillSynthesis.maxActiveSkills': 200,
  'skillSynthesis.candidatesDir': '',
  'skillSynthesis.eligibilityMinTurns': 5,
  'skillSynthesis.evictionDecayRate': 0.95,
  'skillSynthesis.generalizationContextThreshold': 3,
  'skillSynthesis.dedupClusterThreshold': 0.78,
  'skillSynthesis.prefilterMinEdits': 1,
  'skillSynthesis.prefilterMinChars': 800,
  'skillSynthesis.prefilterMinToolUses': 2,
  'skillSynthesis.judgeEnabled': true,
  'skillSynthesis.minJudgeScore': 6.0,
  'skillSynthesis.judgeModel': 'inherit',
  'skillSynthesis.maxPinnedSkills': 10,
  'skillSynthesis.curatorEnabled': true,
  'skillSynthesis.curatorIntervalHours': 24,
  'skillSynthesis.suggestionMinClusterSize': 2,
  'skillSynthesis.suggestionMaxCandidates': 200,
  // TASK_2026_180 Phase 0. Every numeric value here MUST equal its counterpart
  // in `SKILL_DRAIN_DEFAULTS` (`skill-synthesis/src/lib/queue/skill-drain.service.ts`).
  // That constant is the fallback the drain passes to `getConfiguration`, so a
  // divergence makes the drain behave one way in a host that has never written
  // a settings file and another way in a host that has — the hardest class of
  // configuration bug to see. Change one, change both.
  'skillSynthesis.drain.cronExpr': '*/15 * * * *',
  'skillSynthesis.drain.nightlyCronExpr': '0 3 * * *',
  'skillSynthesis.drain.weeklyCronExpr': '0 4 * * 0',
  'skillSynthesis.drain.maxItemsPerRun': 4,
  // Ten times the frequent cap, and the budget is still the real ceiling: ~40
  // archaeology runs is roughly 30 % of `maxTokensPerDay`, so raising this
  // number cannot outspend the budget gate — it only stops the queue from
  // growing monotonically while the budget sits 70 % unused.
  'skillSynthesis.drain.nightlyMaxItemsPerRun': 40,
  // Ten times the nightly cap, and derived the same way: measured demand plus
  // headroom, with the budget still the real ceiling. A 828-session corpus over
  // 31 days yields ~163 prefilter-eligible sessions a WEEK, and phase 3 chains
  // TWO weekly rows off each one (`judge-panel` + `trigger-eval`), so steady
  // demand is ~325 rows/week against a supply that was 4. `replay` is weekly
  // too but has no producer on purpose (TASK_2026_245), so it adds nothing.
  'skillSynthesis.drain.weeklyMaxItemsPerRun': 400,
  'skillSynthesis.drain.perWorkspaceBatch': 1,
  // `0` disables the foreground gate entirely.
  'skillSynthesis.drain.foregroundBackoffMs': 300000,
  'skillSynthesis.drain.pauseOnBattery': true,
  'skillSynthesis.drain.maxAttempts': 5,
  'skillSynthesis.drain.staleClaimTtlMs': 900000,
  // `0` = unlimited.
  'skillSynthesis.budget.maxTokensPerDay': 2000000,
  // Ships default-OFF in commit C0 so the Electron tray (commit C5) is purely
  // additive: nothing reads this key until the tray exists.
  'skillSynthesis.trayKeepalive': false,
  // TASK_2026_180 Phase 3 — the empirical gates. All three ship ON: they are
  // the whole point of the phase, and a gate that defaults off would mean the
  // promotion rule silently keeps its phase-1 behaviour on every install that
  // never opens the settings panel.
  // `replayValidation`, not `replay` — that sub-tree is the replay LANE's.
  // See the key-list block above.
  'skillSynthesis.replayValidation.enabled': true,
  // The floor a replay must clear to count as corroborating evidence. On the
  // same 0–1 scale as the stored `replay_confidence`, which is why the store
  // range-checks that column: a threshold on one scale and a measurement on
  // another is a comparison that always answers the same way.
  //
  // `0.5` is a deliberate midpoint, not a tuned number — no corpus has been
  // measured yet. It is compared with `<`, so it also decides nothing about a
  // candidate whose `replay_confidence` is NULL: unmeasured is not "below
  // threshold", and SQL agrees (`NULL < 0.5` is NULL, never true).
  'skillSynthesis.replayValidation.minConfidence': 0.5,
  'skillSynthesis.triggerEval.enabled': true,
  'skillSynthesis.judgePanel.enabled': true,
  // The gap between two judges' headline scores that escalates a verdict. On
  // the judge's 0–10 scale (`minJudgeScore` above lives on the same one), so
  // `3` means "the two panellists disagree by more than three points out of
  // ten". R8: the second judge only runs on a `scored` first verdict, and
  // escalation only above this threshold, which is what keeps the panel from
  // quadrupling promotion cost.
  'skillSynthesis.judgePanel.disagreementThreshold': 3,
  // TASK_2026_180 Phase 1 — see SKILL_LANE_DEFAULTS_FOR_FILE_ROUTING. Both
  // halves (key list + defaults) come from that one table on purpose.
  ...SKILL_LANE_SETTINGS_DEFAULTS,
  'memory.triggers.preCompact': true,
  'memory.triggers.idleMs': 600000,
  'memory.triggers.turnThreshold': 20,
  'memory.triggers.bootScan': true,
  'memory.triggers.userPromptSubmit.enabled': true,
  'memory.triggers.userPromptSubmit.cueList': [
    'remember (this|that)',
    '(important|critical)\\s+(point|note|fact|detail)',
    'from now on',
    'going forward',
    'keep in mind',
    'note that',
    'save to memory',
  ],
  'memory.triggers.userPromptSubmit.minPromptLength': 20,
  'memory.triggers.postToolUse.enabled': true,
  'memory.triggers.maxCuratesPerHour': 20,
  'skillSynthesis.triggers.sessionEnd': true,
  'skillSynthesis.triggers.idleMs': 600000,
  'skillSynthesis.triggers.bootScan': true,
  'skillSynthesis.triggers.subagentStop.enabled': true,
  'skillSynthesis.triggers.postToolUse.enabled': true,
  'skillSynthesis.triggers.postToolUse.minEditCount': 3,
  'skillSynthesis.triggers.maxAnalyzesPerHour': 6,
  'cron.enabled': true,
  'cron.maxConcurrentJobs': 3,
  'cron.catchupWindowMs': 86400000,
  'gateway.enabled': false,
  'gateway.coalesceMs': 250,
  'gateway.rateLimit.minTimeMs': 500,
  'gateway.rateLimit.maxConcurrent': 2,
  'gateway.voice.enabled': true,
  'gateway.voice.whisperModel': 'base.en',
  'voice.whisperModel': 'base.en',
  'voice.ttsVoice': 'af_heart',
  'gateway.telegram.enabled': false,
  'gateway.telegram.tokenCipher': '',
  'gateway.telegram.allowedUserIds': [],
  'gateway.discord.enabled': false,
  'gateway.discord.tokenCipher': '',
  'gateway.discord.allowedGuildIds': [],
  'gateway.discord.applicationId': '',
  'gateway.slack.enabled': false,
  'gateway.slack.botTokenCipher': '',
  'gateway.slack.appTokenCipher': '',
  'gateway.slack.allowedTeamIds': [],
  // Must stay in lockstep with the two `tasks.*` entries above.
  'tasks.savedViews': [],
  'tasks.activeViewId': '',
  // No custom providers until the user adds one.
  'provider.custom.entries': [],
  ...Object.fromEntries(
    KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap((k) => [
      [`provider.${k}.selectedModel`, ''],
      [`provider.${k}.reasoningEffort`, ''],
    ]),
  ),
};

/**
 * Pattern for per-provider base URL override keys.
 *
 * Matches `provider.<providerId>.baseUrl` for any provider id. This lets the
 * CLI parity work (`provider base-url set <provider> <url>`) accept arbitrary
 * provider names without enumerating every entry from ANTHROPIC_PROVIDERS.
 */
const PROVIDER_BASE_URL_PATTERN = /^provider\.[a-z0-9-]+\.baseUrl$/;

/**
 * Per-scope tier override keys written by ProviderModelsService:
 *   provider.<providerId>.<mainAgent|cliAgent|lane>.modelTier.<sonnet|opus|haiku>
 *
 * Must be file-routed for every provider id (including trademarked ones not
 * declarable in package.json contributes.configuration) so that the scoped
 * writes from the Model Mapping dialog actually persist to ~/.ptah/settings.json.
 *
 * The alternation must list EVERY member of `ProviderTierScope`
 * (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts`). A scope missing
 * here fails silently in one direction only, which is why it is easy to miss:
 * reads fall through to the provider entry's `defaultTiers` and look correct,
 * and only a WRITE is lost — `set()` is routed to a store that does not own
 * the key, no error is raised, and the next read serves the default as if the
 * user had never remapped the tier. `'lane'` (TASK_2026_180, background skill
 * lanes) was absent for exactly one batch for this reason.
 */
const PROVIDER_SCOPED_TIER_PATTERN =
  /^provider\.[a-z0-9-]+\.(mainAgent|cliAgent|lane)\.modelTier\.(sonnet|opus|haiku)$/;

/**
 * Per-provider model / reasoning-effort keys for THIRD-PARTY providers:
 *   provider.thirdParty.<providerId>.(selectedModel|reasoningEffort)
 *
 * `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` above enumerates these for the built-in
 * providers. It cannot enumerate USER-DEFINED providers — their ids are typed
 * by the user at runtime — so before this pattern existed a custom entry's
 * model and reasoning-effort choices hit the documented silent-drop failure
 * mode of this file: no schema in vscode.workspace.getConfiguration, write
 * discarded, no error (TASK_2026_236).
 *
 * The id character class matches CUSTOM_PROVIDER_ID_PATTERN in
 * `libs/shared/src/lib/providers/provider-registry.ts` — a custom id outside
 * it is rejected at entry-creation time, so it can never reach here.
 */
const PROVIDER_AUTH_MODEL_PATTERN =
  /^provider\.thirdParty\.[a-z0-9-]+\.(selectedModel|reasoningEffort)$/;

const SCOPED_SETTING_PREFIX_PATTERN = /^(app|workspace)\./;

/**
 * Returns true when the given settings key should be routed to file-based
 * storage (~/.ptah/settings.json). Prefer this over `FILE_BASED_SETTINGS_KEYS.has()`
 * directly so dynamic key families (e.g. provider base URL overrides) are
 * resolved consistently across all platform workspace providers.
 */
export function isFileBasedSettingKey(key: string): boolean {
  if (FILE_BASED_SETTINGS_KEYS.has(key)) return true;
  if (PROVIDER_BASE_URL_PATTERN.test(key)) return true;
  if (PROVIDER_SCOPED_TIER_PATTERN.test(key)) return true;
  if (PROVIDER_AUTH_MODEL_PATTERN.test(key)) return true;
  if (SCOPED_SETTING_PREFIX_PATTERN.test(key)) return true;
  return false;
}
