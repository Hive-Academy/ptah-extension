import {
  ENHANCE_TIMEOUT_DEFAULT_MS,
  ENHANCE_TIMEOUT_MAX_MS,
  ENHANCE_TIMEOUT_MIN_MS,
  FILE_BASED_OBJECT_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from './file-settings-keys';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ADVANCED_SETTINGS,
  CLAUDE_REASONING_EFFORT_VALUES,
  SCOPED_SETTING_KEYS,
  SESSION_BUDGET_SETTINGS,
  SUBAGENT_PROMPT_CACHE_TTL_SETTINGS,
} from '@ptah-extension/shared';
import { PtahFileSettingsManager } from './file-settings-manager';

describe('isFileBasedSettingKey', () => {
  describe('static SET membership', () => {
    it('returns true for every key in FILE_BASED_SETTINGS_KEYS', () => {
      for (const key of FILE_BASED_SETTINGS_KEYS) {
        expect(isFileBasedSettingKey(key)).toBe(true);
      }
    });

    it('returns false for keys not in any registered pattern', () => {
      expect(isFileBasedSettingKey('nonExistent.key')).toBe(false);
      expect(isFileBasedSettingKey('')).toBe(false);
    });
  });

  describe('agent generation model keys (TASK_2026_609)', () => {
    it.each([
      'agentGeneration.models',
      'workspace.abc123.agentGeneration.models',
    ])('routes %s to file-based storage', (key) => {
      expect(isFileBasedSettingKey(key)).toBe(true);
    });
  });

  describe('PROVIDER_BASE_URL_PATTERN (dynamic keys)', () => {
    it('returns true for provider.<id>.baseUrl patterns with lower-case id', () => {
      expect(isFileBasedSettingKey('provider.openrouter.baseUrl')).toBe(true);
      expect(isFileBasedSettingKey('provider.my-provider.baseUrl')).toBe(true);
      expect(isFileBasedSettingKey('provider.lm-studio.baseUrl')).toBe(true);
    });

    it('returns false when the provider id contains uppercase letters', () => {
      expect(isFileBasedSettingKey('provider.OpenRouter.baseUrl')).toBe(false);
    });

    it('returns false for baseUrl patterns with wrong segment count', () => {
      expect(isFileBasedSettingKey('provider.baseUrl')).toBe(false);
      expect(isFileBasedSettingKey('baseUrl')).toBe(false);
    });
  });

  describe('PROVIDER_SCOPED_TIER_PATTERN (dynamic keys)', () => {
    it('returns true for mainAgent tier patterns', () => {
      expect(
        isFileBasedSettingKey('provider.openrouter.mainAgent.modelTier.sonnet'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.openrouter.mainAgent.modelTier.opus'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.openrouter.mainAgent.modelTier.haiku'),
      ).toBe(true);
    });

    it('returns true for cliAgent tier patterns', () => {
      expect(
        isFileBasedSettingKey('provider.kimi-code.cliAgent.modelTier.sonnet'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.lm-studio.cliAgent.modelTier.haiku'),
      ).toBe(true);
    });

    // TASK_2026_180. `'lane'` is the third ProviderTierScope member, read by
    // `ProviderAuthResolver.buildTierValues(id, 'lane')` for background skill
    // lanes. It was missing from the alternation for one batch, and the way it
    // failed is the reason this block exists: a MISSING scope breaks writes
    // only. Reads fell through to the provider entry's `defaultTiers` and
    // looked entirely correct, so nothing surfaced until something persisted a
    // lane tier — at which point the write went to a store that does not own
    // the key, raised nothing, and the next read served the default back as if
    // the remap had never happened.
    it.each(['sonnet', 'opus', 'haiku'] as const)(
      'returns true for lane tier pattern .lane.modelTier.%s',
      (tier) => {
        expect(
          isFileBasedSettingKey(`provider.openrouter.lane.modelTier.${tier}`),
        ).toBe(true);
      },
    );

    it('routes lane tier keys for provider ids carrying a hyphen', () => {
      expect(
        isFileBasedSettingKey('provider.lm-studio.lane.modelTier.haiku'),
      ).toBe(true);
    });

    it('returns false for unknown scope segments', () => {
      expect(
        isFileBasedSettingKey(
          'provider.openrouter.unknownScope.modelTier.sonnet',
        ),
      ).toBe(false);
    });

    it('returns false for unknown tier names', () => {
      expect(
        isFileBasedSettingKey(
          'provider.openrouter.mainAgent.modelTier.unknown',
        ),
      ).toBe(false);
    });
  });

  describe('PROVIDER_AUTH_MODEL_PATTERN — user-defined providers (TASK_2026_236)', () => {
    // `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` can only enumerate built-ins. Before
    // this pattern existed, a custom provider's model / reasoning-effort
    // choices hit this file's documented silent-drop failure mode: no schema
    // in vscode.workspace.getConfiguration, write discarded, no error.
    const customKeys = [
      'provider.thirdParty.my-vllm-box.selectedModel',
      'provider.thirdParty.my-vllm-box.reasoningEffort',
      'provider.thirdParty.custom-requesty-eu.selectedModel',
      'provider.thirdParty.litellm.reasoningEffort',
    ] as const;

    it.each(customKeys)('routes %s to file-based storage', (key) => {
      expect(isFileBasedSettingKey(key)).toBe(true);
    });

    it('does not need those keys enumerated in the static Set', () => {
      // They are matched by pattern — enumerating a runtime id is impossible.
      expect(
        FILE_BASED_SETTINGS_KEYS.has(
          'provider.thirdParty.my-vllm-box.selectedModel',
        ),
      ).toBe(false);
    });

    it('keeps the built-in third-party keys routed via the static Set', () => {
      expect(
        FILE_BASED_SETTINGS_KEYS.has(
          'provider.thirdParty.openrouter.selectedModel',
        ),
      ).toBe(true);
    });

    it('routes the kimi-code built-in slots through the static Set', () => {
      expect(
        FILE_BASED_SETTINGS_KEYS.has(
          'provider.thirdParty.kimi-code.reasoningEffort',
        ),
      ).toBe(true);
      expect(
        FILE_BASED_SETTINGS_KEYS.has('provider.kimi-code.modelTier.opus'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.thirdParty.kimi-code.reasoningEffort'),
      ).toBe(true);
      expect(isFileBasedSettingKey('provider.kimi-code.modelTier.opus')).toBe(
        true,
      );
    });

    it('still routes a stale moonshot key by pattern instead of dropping it', () => {
      // `moonshot` is no longer a built-in; its leftover keys must stay
      // file-routed (inert), not fall through to a store that discards them.
      expect(
        FILE_BASED_SETTINGS_KEYS.has(
          'provider.thirdParty.moonshot.selectedModel',
        ),
      ).toBe(false);
      expect(
        isFileBasedSettingKey('provider.thirdParty.moonshot.selectedModel'),
      ).toBe(true);
    });

    it('returns false for uppercase ids and unknown leaf names', () => {
      expect(
        isFileBasedSettingKey('provider.thirdParty.MyBox.selectedModel'),
      ).toBe(false);
      expect(
        isFileBasedSettingKey('provider.thirdParty.my-box.somethingElse'),
      ).toBe(false);
      expect(isFileBasedSettingKey('provider.thirdParty.selectedModel')).toBe(
        false,
      );
    });
  });

  describe('provider.custom.entries (TASK_2026_236)', () => {
    it('registers the key so the entry list actually persists', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('provider.custom.entries')).toBe(
        true,
      );
      expect(isFileBasedSettingKey('provider.custom.entries')).toBe(true);
    });

    it('defaults to an empty list', () => {
      expect(FILE_BASED_SETTINGS_DEFAULTS['provider.custom.entries']).toEqual(
        [],
      );
    });
  });

  describe('FILE_BASED_SETTINGS_DEFAULTS alignment', () => {
    it('every key in FILE_BASED_SETTINGS_DEFAULTS is also in FILE_BASED_SETTINGS_KEYS', () => {
      for (const key of Object.keys(FILE_BASED_SETTINGS_DEFAULTS)) {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      }
    });

    it('FILE_BASED_SETTINGS_KEYS is non-empty', () => {
      expect(FILE_BASED_SETTINGS_KEYS.size).toBeGreaterThan(0);
    });
  });

  describe('skill enhancement and telemetry settings', () => {
    const defaults = {
      'skills.enhancement.provider': '',
      'skills.enhancement.model': 'inherit',
      'skills.enhancement.timeoutMs': ENHANCE_TIMEOUT_DEFAULT_MS,
      'skills.telemetry.enabled': true,
    } as const;

    it.each(Object.entries(defaults))(
      'routes and defaults %s',
      (key, value) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
        expect(isFileBasedSettingKey(key)).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(value);
      },
    );
  });

  describe('memory lifecycle keys (TASK_2026_443)', () => {
    const lifecycleDefaults = {
      'memory.lifecycle.enabled': true,
      'memory.lifecycle.archiveAfterDays': 30,
      'memory.lifecycle.deleteAfterDays': 60,
      'memory.lifecycle.maxPerWorkspace': 25000,
    } as const;

    it.each(Object.entries(lifecycleDefaults))(
      'registers and defaults %s to %s',
      (key, expected) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
        expect(isFileBasedSettingKey(key)).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );
  });

  describe('Codex lane budget keys (TASK_2026_597)', () => {
    /**
     * Read by the Codex lane config builder in every host and written through
     * `agent:setConfig`. Unrouted, a write would be dropped silently while the
     * read still served the default, so each key is named literally here.
     * 0 in either token key means "use the Codex runtime default".
     */
    const codexBudgetDefaults = {
      'agentOrchestration.codexAutoCompactTokens': 120000,
      'agentOrchestration.codexToolOutputTokenLimit': 2500,
      'agentOrchestration.codexWebSearch': true,
    } as const;

    it.each(Object.entries(codexBudgetDefaults))(
      'registers and defaults %s to %s',
      (key, expected) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
        expect(isFileBasedSettingKey(key)).toBe(true);
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );

    it('keeps the numeric budget defaults non-negative integers', () => {
      for (const key of [
        'agentOrchestration.codexAutoCompactTokens',
        'agentOrchestration.codexToolOutputTokenLimit',
      ]) {
        const value = FILE_BASED_SETTINGS_DEFAULTS[key] as number;
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('compaction and lane-guard keys (TASK_2026_597 Wave D)', () => {
    const wave = {
      'compaction.toolOutputBudgetTokens': 2500,
      'compaction.subagentHandoffTokens': 150000,
      'compaction.rotationSuggestTokens': 300000,
      'compaction.subagentStopWeightedTokens': 3000000,
      'agentOrchestration.laneRepeatCallStopAt': 20,
    } as const;

    it.each(Object.entries(wave))(
      'registers and defaults %s to %s',
      (key, expected) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
        expect(isFileBasedSettingKey(key)).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );

    it('keeps compaction.threshold out of the file-based set', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('compaction.threshold')).toBe(false);
    });
  });

  describe('idle compaction keys (TASK_2026_692)', () => {
    it.each([
      ['compaction.idleCompactionEnabled', true],
      ['compaction.idleCompactionMinTokens', 200_000],
    ] as const)('registers and defaults %s to %s', (key, expected) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
    });
  });

  describe('subagent prompt-cache TTL key (TASK_2026_597 N1)', () => {
    // Written through `agent:setConfig`; unrouted, the write would be dropped
    // while the read still served the default.
    const key = 'agentOrchestration.subagentPromptCacheTtl';

    it('is file-based and defaults to auto', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe('auto');
    });

    it('defaults to a value the setting accepts', () => {
      expect(SUBAGENT_PROMPT_CACHE_TTL_SETTINGS).toContain(
        FILE_BASED_SETTINGS_DEFAULTS[key],
      );
    });

    it('is a global-only scoped key', () => {
      expect(SCOPED_SETTING_KEYS[key]).toEqual({
        appScopable: false,
        supportedTargets: ['global'],
      });
    });
  });

  describe('Claude system-lane keys (TASK_2026_712)', () => {
    // Written through `agent:setConfig`; unrouted, the write would be dropped
    // while the read still served the default.
    const keys = [
      'agentOrchestration.claudeModel',
      'agentOrchestration.claudeReasoningEffort',
    ] as const;

    it.each(keys)('%s is file-based and defaults to the SDK default', (key) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe('');
    });

    it('defaults the effort to a value the setting accepts', () => {
      expect(CLAUDE_REASONING_EFFORT_VALUES).toContain(
        FILE_BASED_SETTINGS_DEFAULTS['agentOrchestration.claudeReasoningEffort'],
      );
    });

    it.each(keys)('%s is a global-only scoped key', (key) => {
      expect(SCOPED_SETTING_KEYS[key]).toEqual({
        appScopable: false,
        supportedTargets: ['global'],
      });
    });
  });

  describe('Grok and Antigravity effort keys (TASK_2026_712, Batch 34b)', () => {
    // Written through `agent:setConfig` and read by the lane spawn
    // environment; unrouted, the write would miss ~/.ptah/settings.json.
    it.each([
      'agentOrchestration.grokReasoningEffort',
      'agentOrchestration.antigravityReasoningEffort',
    ])('%s is file-based and defaults to the CLI default', (key) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe('');
    });
  });

  describe('decision-model selection key (TASK_2026_646_136a)', () => {
    // Written by `DecisionModelConfig.setSelection`. VS Code has no schema for
    // it, so an unrouted write is rejected there.
    const key = 'agentOrchestration.decisionModel';

    it('is file-based and defaults to null (read as unset)', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(FILE_BASED_SETTINGS_DEFAULTS, key),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBeNull();
    });

    it('is stored as a whole object', () => {
      expect(FILE_BASED_OBJECT_SETTINGS_KEYS.has(key)).toBe(true);
    });

    it('lists only file-based keys as whole-object keys', () => {
      for (const objectKey of FILE_BASED_OBJECT_SETTINGS_KEYS) {
        expect(FILE_BASED_SETTINGS_KEYS.has(objectKey)).toBe(true);
      }
    });
  });

  describe('saved Tasks-board view keys (TASK_2026_181)', () => {
    // Gate 1. These two keys have no `package.json contributes.configuration`
    // declaration behind them, so file routing is not a preference here — it is
    // the difference between a saved view persisting and the write being
    // discarded by vscode.workspace.getConfiguration with no error at all.
    const savedViewKeys = ['tasks.savedViews', 'tasks.activeViewId'] as const;

    it.each(savedViewKeys)(
      'registers %s in FILE_BASED_SETTINGS_KEYS',
      (key) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      },
    );

    it.each(savedViewKeys)('routes %s through isFileBasedSettingKey', (key) => {
      expect(isFileBasedSettingKey(key)).toBe(true);
    });

    it('declares an empty list as the saved-views default', () => {
      expect(FILE_BASED_SETTINGS_DEFAULTS['tasks.savedViews']).toEqual([]);
    });

    it('declares the empty string — meaning "no active view" — as the default', () => {
      expect(FILE_BASED_SETTINGS_DEFAULTS['tasks.activeViewId']).toBe('');
    });
  });

  describe('curator trigger keys (TASK_2026_126)', () => {
    const memoryTriggerKeys = [
      'memory.triggers.idleMs',
      'memory.triggers.turnThreshold',
      'memory.triggers.bootScan',
    ] as const;

    const expectedDefaults: Record<string, boolean | number> = {
      'memory.triggers.idleMs': 600000,
      'memory.triggers.turnThreshold': 20,
      'memory.triggers.bootScan': true,
    };

    it.each(memoryTriggerKeys)(
      'registers %s in FILE_BASED_SETTINGS_KEYS',
      (key) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      },
    );

    it.each(memoryTriggerKeys)(
      'declares a default for %s in FILE_BASED_SETTINGS_DEFAULTS',
      (key) => {
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expectedDefaults[key]);
      },
    );

    it('routes every trigger key through isFileBasedSettingKey', () => {
      for (const key of memoryTriggerKeys) {
        expect(isFileBasedSettingKey(key)).toBe(true);
      }
    });
  });

  describe('SDK-hook trigger keys (TASK_2026_127)', () => {
    const memoryHookTriggerKeys = [
      'memory.triggers.userPromptSubmit.enabled',
      'memory.triggers.userPromptSubmit.cueList',
      'memory.triggers.userPromptSubmit.minPromptLength',
      'memory.triggers.postToolUse.enabled',
      'memory.triggers.maxCuratesPerHour',
    ] as const;

    const allHookKeys = memoryHookTriggerKeys;

    const expectedScalarDefaults: Record<string, boolean | number> = {
      'memory.triggers.userPromptSubmit.enabled': true,
      'memory.triggers.userPromptSubmit.minPromptLength': 20,
      'memory.triggers.postToolUse.enabled': true,
      'memory.triggers.maxCuratesPerHour': 20,
    };

    const expectedCueList = [
      'remember (this|that)',
      '(important|critical)\\s+(point|note|fact|detail)',
      'from now on',
      'going forward',
      'keep in mind',
      'note that',
      'save to memory',
    ];

    it.each(allHookKeys)('registers %s in FILE_BASED_SETTINGS_KEYS', (key) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
    });

    it.each(allHookKeys)(
      'declares a default for %s in FILE_BASED_SETTINGS_DEFAULTS',
      (key) => {
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
      },
    );

    it.each(Object.entries(expectedScalarDefaults))(
      'declares scalar default %s = %s',
      (key, expected) => {
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );

    it('declares the 7 default cues for memory.triggers.userPromptSubmit.cueList', () => {
      const cueList =
        FILE_BASED_SETTINGS_DEFAULTS[
          'memory.triggers.userPromptSubmit.cueList'
        ];
      expect(Array.isArray(cueList)).toBe(true);
      expect(cueList).toEqual(expectedCueList);
      expect((cueList as readonly string[]).length).toBe(7);
    });

    it('routes every new hook-trigger key through isFileBasedSettingKey', () => {
      for (const key of allHookKeys) {
        expect(isFileBasedSettingKey(key)).toBe(true);
      }
    });
  });

  describe('retained skill synthesis settings', () => {
    it.each([
      ['skillSynthesis.enabled', true],
      ['skillSynthesis.skillsRoot', ''],
    ] as const)('routes and defaults %s', (key, value) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(value);
    });
  });

  describe('curator provider/model keys (TASK_2026_CURATOR_MODEL_CONFIG)', () => {
    it('registers memory.curatorProvider with default ""', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('memory.curatorProvider')).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS['memory.curatorProvider']).toBe('');
      expect(isFileBasedSettingKey('memory.curatorProvider')).toBe(true);
    });

    it('keeps memory.curatorModel with default ""', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('memory.curatorModel')).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS['memory.curatorModel']).toBe('');
    });

    it('declares maxCuratesPerHour default of 20', () => {
      expect(
        FILE_BASED_SETTINGS_DEFAULTS['memory.triggers.maxCuratesPerHour'],
      ).toBe(20);
    });
  });

  describe('memory.enabled — the capture master switch (TASK_2026_328)', () => {
    /**
     * `MEMORY_TRIGGER_KEYS.enabled` gates the observation queue AND every
     * trigger, and it is read through `IWorkspaceProvider.getConfiguration`
     * like its `memory.triggers.*` siblings — all of which are routed here.
     *
     * Unrouted, it would fail in the WRITE direction only: the read falls
     * through to `FILE_BASED_SETTINGS_DEFAULTS` and looks correct while the
     * write is dropped with no error, so "memory off" would redraw as off and
     * capture anyway on the next trigger.
     */
    it('registers memory.enabled in FILE_BASED_SETTINGS_KEYS', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('memory.enabled')).toBe(true);
    });

    it('routes memory.enabled through isFileBasedSettingKey', () => {
      expect(isFileBasedSettingKey('memory.enabled')).toBe(true);
    });

    it('declares memory.enabled default true, matching MEMORY_TRIGGER_DEFAULTS', () => {
      expect(
        Object.prototype.hasOwnProperty.call(
          FILE_BASED_SETTINGS_DEFAULTS,
          'memory.enabled',
        ),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS['memory.enabled']).toBe(true);
    });

    it('keeps memory.enabled distinct from memory.triggers.* — it is not a per-trigger toggle', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('memory.triggers.enabled')).toBe(
        false,
      );
    });
  });

  describe('internalQuery.* — the shared one-shot gate (TASK_2026_328, TASK_2026_463)', () => {
    /**
     * TASK_2026_323 B6 put every internal one-shot query behind one
     * process-wide `InternalQueryConcurrencyGate` — memory-curator,
     * skill-synthesis, cron, the harness LLM runner and the setup wizard all
     * queue on it. The gate reads its limit and its wait ceiling through
     * `IWorkspaceProvider.getConfiguration('ptah', 'internalQuery.*')`.
     *
     * The global and timeout keys were not registered anywhere: not here, and not in the VS Code
     * `contributes.configuration`. That is this file's documented silent-drop
     * failure mode in the WRITE direction — the read falls through to
     * `FILE_BASED_SETTINGS_DEFAULTS` and looks correct, while a write is handed
     * to a store that does not own the key and is discarded with no error.
     *
     * The user-visible consequence was that the gate could not be moved off its
     * defaults on any host. With `maxConcurrent` stuck at 1, an interactive
     * wizard call queues behind a slow background curation pass and the wizard
     * appears to hang — the symptom class TASK_2026_323 exists to remove. The
     * per-lane key was likewise unregistered until TASK_2026_463.
     */
    it('registers all internalQuery keys in FILE_BASED_SETTINGS_KEYS', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('internalQuery.maxConcurrent')).toBe(
        true,
      );
      expect(
        FILE_BASED_SETTINGS_KEYS.has('internalQuery.maxConcurrentPerLane'),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_KEYS.has('internalQuery.queueTimeoutMs')).toBe(
        true,
      );
    });

    it('routes all internalQuery keys through isFileBasedSettingKey', () => {
      expect(isFileBasedSettingKey('internalQuery.maxConcurrent')).toBe(true);
      expect(isFileBasedSettingKey('internalQuery.maxConcurrentPerLane')).toBe(
        true,
      );
      expect(isFileBasedSettingKey('internalQuery.queueTimeoutMs')).toBe(true);
    });

    /**
     * These two values are hard-coded rather than imported. `platform-core` is
     * L0.5 and imports nothing from `@ptah-extension/*`, so it cannot reach
     * `DEFAULT_MAX_CONCURRENT`, `DEFAULT_MAX_CONCURRENT_PER_LANE`, and
     * `DEFAULT_QUEUE_TIMEOUT_MS` in `agent-sdk`.
     * Changing either constant without changing the value here is the drift
     * this test exists to catch.
     */
    it('declares defaults matching the gate constants in agent-sdk', () => {
      expect(
        Object.prototype.hasOwnProperty.call(
          FILE_BASED_SETTINGS_DEFAULTS,
          'internalQuery.maxConcurrent',
        ),
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(
          FILE_BASED_SETTINGS_DEFAULTS,
          'internalQuery.maxConcurrentPerLane',
        ),
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(
          FILE_BASED_SETTINGS_DEFAULTS,
          'internalQuery.queueTimeoutMs',
        ),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS['internalQuery.maxConcurrent']).toBe(
        3,
      );
      expect(
        FILE_BASED_SETTINGS_DEFAULTS['internalQuery.maxConcurrentPerLane'],
      ).toBe(1);
      expect(FILE_BASED_SETTINGS_DEFAULTS['internalQuery.queueTimeoutMs']).toBe(
        60000,
      );
    });
  });

  describe('llm.vscode.model — removed dead key (TASK_2026_250 follow-up B)', () => {
    /**
     * `ptah.llm.vscode.model` was the VS Code Language Model `vendor/family`
     * selector. Its ONLY consumer, `VsCodeLmAdapter`, was deleted in
     * `096930b51` together with its `affectsConfiguration` cache invalidation,
     * and the `package.json contributes.configuration` entry went with it — so
     * the key has had no writer since. TASK_2026_250 (`8a578c124`) removed the
     * last reader, `skill-synthesis`'s `resolveJudgeModel`, which had been
     * handing a `vendor/family` string to an Anthropic-Messages endpoint.
     *
     * WHY THE DEFAULT WAS THE ACTIVE HALF OF THE PROBLEM, not the Set entry:
     * `PtahFileSettingsManager.get` falls through to the registered default
     * when a caller passes none (`file-settings-manager.ts:83-91`), and
     * `SettingsExportService.collectConfigValues` passes none
     * (`agent-sdk/src/lib/settings-export.service.ts:140-148`). So every
     * export written on a CLEAN install carried
     * `"llm.vscode.model": "copilot/gpt-4o"` — a value the user never chose,
     * naming a provider family Ptah no longer routes to.
     *
     * This block is the "stays dead" guard. Re-adding the key would need a
     * consumer first; a bare table entry only re-arms the export noise.
     */
    it('is absent from FILE_BASED_SETTINGS_KEYS', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('llm.vscode.model')).toBe(false);
    });

    it('declares no default, so an unset read yields undefined not a model id', () => {
      expect(
        Object.prototype.hasOwnProperty.call(
          FILE_BASED_SETTINGS_DEFAULTS,
          'llm.vscode.model',
        ),
      ).toBe(false);
      expect(FILE_BASED_SETTINGS_DEFAULTS['llm.vscode.model']).toBeUndefined();
    });

    it('no longer routes to file-based storage', () => {
      expect(isFileBasedSettingKey('llm.vscode.model')).toBe(false);
    });

    /**
     * The sibling `ptah.llm.*` key is NOT dead and must not be swept up with
     * it: `llm.defaultProvider` is live in the MCP tool handlers
     * (`rpc-handlers/.../llm-rpc-app.handlers.ts`).
     */
    it('leaves the live llm.defaultProvider key untouched', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('llm.defaultProvider')).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS['llm.defaultProvider']).toBe('');
    });

    /**
     * The removed default was the last CHAT model id shipped in `vendor/family`
     * form. Every other chat-model default is '' or null ("use the provider
     * default") — the convention the `FILE_BASED_SETTINGS_DEFAULTS` block
     * header states. A slash-bearing chat-model default reappearing here means
     * someone has re-pinned a concrete cross-vendor id, which is the shape that
     * reaches a foreign endpoint verbatim and 404s (the TASK_2026_250 defect).
     *
     * `memory.embeddingModel` is the one legitimate slash-bearing default and
     * is allow-listed by name rather than by a loose pattern: its value
     * (`Xenova/bge-small-en-v1.5`, line 441) is a HuggingFace REPO id for a
     * locally-executed embedding model, not a provider-routed chat selector.
     * Different namespace, different consumer, no endpoint to mismatch.
     */
    it('leaves no vendor/family-shaped chat-model default behind', () => {
      const SLASH_BEARING_BY_DESIGN = new Set([
        'memory.embeddingModel', // HuggingFace repo id, local inference
      ]);
      const urlOrCronKey = /(\.baseUrl|Url|[cC]ronExpr)$/;

      const slashed = Object.entries(FILE_BASED_SETTINGS_DEFAULTS)
        .filter(
          ([key, value]) =>
            typeof value === 'string' &&
            value.includes('/') &&
            !urlOrCronKey.test(key) &&
            !SLASH_BEARING_BY_DESIGN.has(key),
        )
        .map(([key]) => key);
      expect(slashed).toEqual([]);
    });
  });

  describe('session budget keys (TASK_2026_597 N7)', () => {
    /**
     * Named literally so a key dropped from the shared table, or a default
     * changed there, is a red test here rather than a silently dropped write.
     */
    const budgetDefaults: Record<string, unknown> = {
      'sessionBudget.enabled': true,
      'sessionBudget.autoHandoffAtLimit': false,
      'sessionBudget.unit': 'tokens',
      'sessionBudget.tokens': 50_000_000,
      'sessionBudget.usd': 30,
      'sessionBudget.fallbackWeightedTokens': 9_000_000,
      'sessionBudget.tightenPercent': 50,
      'sessionBudget.handoffPercent': 80,
      'sessionBudget.handoffAfterCompactions': 3,
      'sessionBudget.tightenWindowTokens': null,
    };

    it.each(Object.entries(budgetDefaults))(
      'registers, routes and defaults %s to %s',
      (key, expected) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
        expect(isFileBasedSettingKey(key)).toBe(true);
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );

    it('registers exactly the keys of the shared table', () => {
      const budgetKeys = [...FILE_BASED_SETTINGS_KEYS].filter((key) =>
        key.startsWith('sessionBudget.'),
      );
      expect(budgetKeys.sort()).toEqual(Object.keys(budgetDefaults).sort());
      expect(
        Object.values(SESSION_BUDGET_SETTINGS)
          .map((setting) => setting.key)
          .sort(),
      ).toEqual(Object.keys(budgetDefaults).sort());
    });

    it('serves the null tightenWindowTokens default as null through the file store', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-budget-keys-'));
      try {
        const store = new PtahFileSettingsManager(
          FILE_BASED_SETTINGS_DEFAULTS,
          dir,
        );
        expect(store.get('sessionBudget.tightenWindowTokens')).toBeNull();
        expect(store.get('sessionBudget.tokens')).toBe(50_000_000);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Settings advanced keys (TASK_2026_658)', () => {
    /**
     * The values these keys had as literals in FILE_BASED_SETTINGS_DEFAULTS
     * before they were derived from the shared ADVANCED_SETTINGS table, plus
     * the two harness keys, whose defaults equal the harness-sync constants
     * (DEFAULT_PREFLIGHT_TIMEOUT_MS, DEFAULT_MANAGE_GITIGNORE). Named
     * literally so a default changed in the shared table is a red test here.
     */
    const advancedDefaults: Record<string, unknown> = {
      'compaction.toolOutputBudgetTokens': 2500,
      'compaction.subagentHandoffTokens': 150000,
      'compaction.rotationSuggestTokens': 300000,
      'compaction.subagentStopWeightedTokens': 3000000,
      'compaction.idleCompactionEnabled': true,
      'compaction.idleCompactionMinTokens': 200000,
      'agentOrchestration.codexAutoCompactTokens': 120000,
      'agentOrchestration.codexToolOutputTokenLimit': 2500,
      'agentOrchestration.codexWebSearch': true,
      'internalQuery.maxConcurrent': 3,
      'internalQuery.maxConcurrentPerLane': 1,
      'internalQuery.queueTimeoutMs': 60000,
      'memory.symbolInjectionEnabled': true,
      'memory.retention.processedDays': 7,
      'memory.retention.stuckDays': 14,
      'memory.retention.batchSize': 500,
      'memory.lifecycle.archiveAfterDays': 30,
      'memory.lifecycle.deleteAfterDays': 60,
      'memory.lifecycle.maxPerWorkspace': 25000,
      'cron.maxConcurrentJobs': 3,
      'cron.catchupWindowMs': 86400000,
      'harness.preflightTimeoutMs': 1500,
      'harness.manageGitignore': true,
      'notifications.hostEnabled': true,
      'notifications.failureHostEnabled': false,
    };

    it.each(Object.entries(advancedDefaults))(
      'registers, routes and defaults %s to %s',
      (key, expected) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
        expect(isFileBasedSettingKey(key)).toBe(true);
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );

    it('derives every default from the shared table, key for key', () => {
      expect(ADVANCED_SETTINGS.map((setting) => setting.key).sort()).toEqual(
        Object.keys(advancedDefaults).sort(),
      );
      for (const setting of ADVANCED_SETTINGS) {
        expect(FILE_BASED_SETTINGS_KEYS.has(setting.key)).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[setting.key]).toBe(setting.default);
      }
    });

    it('serves the derived defaults through the file store', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-advanced-keys-'));
      try {
        const store = new PtahFileSettingsManager(
          FILE_BASED_SETTINGS_DEFAULTS,
          dir,
        );
        expect(store.get('cron.maxConcurrentJobs')).toBe(3);
        expect(store.get('harness.preflightTimeoutMs')).toBe(1500);
        expect(store.get('harness.manageGitignore')).toBe(true);
        expect(store.get('notifications.hostEnabled')).toBe(true);
        expect(store.get('notifications.failureHostEnabled')).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('persists notification preferences across store restart', async () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ptah-notification-keys-'),
      );
      try {
        const store = new PtahFileSettingsManager(
          FILE_BASED_SETTINGS_DEFAULTS,
          dir,
        );
        await store.set('notifications.hostEnabled', false);
        await store.set('notifications.failureHostEnabled', true);
        const reopened = new PtahFileSettingsManager(
          FILE_BASED_SETTINGS_DEFAULTS,
          dir,
        );
        expect(reopened.get('notifications.hostEnabled')).toBe(false);
        expect(reopened.get('notifications.failureHostEnabled')).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
