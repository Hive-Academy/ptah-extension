import {
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from './file-settings-keys';

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
        isFileBasedSettingKey('provider.moonshot.cliAgent.modelTier.sonnet'),
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

  describe('curator/synthesis trigger keys (TASK_2026_126)', () => {
    const memoryTriggerKeys = [
      'memory.triggers.preCompact',
      'memory.triggers.idleMs',
      'memory.triggers.turnThreshold',
      'memory.triggers.bootScan',
    ] as const;

    const skillTriggerKeys = [
      'skillSynthesis.triggers.sessionEnd',
      'skillSynthesis.triggers.idleMs',
      'skillSynthesis.triggers.bootScan',
    ] as const;

    const expectedDefaults: Record<string, boolean | number> = {
      'memory.triggers.preCompact': true,
      'memory.triggers.idleMs': 600000,
      'memory.triggers.turnThreshold': 20,
      'memory.triggers.bootScan': true,
      'skillSynthesis.triggers.sessionEnd': true,
      'skillSynthesis.triggers.idleMs': 600000,
      'skillSynthesis.triggers.bootScan': true,
    };

    it.each([...memoryTriggerKeys, ...skillTriggerKeys])(
      'registers %s in FILE_BASED_SETTINGS_KEYS',
      (key) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      },
    );

    it.each([...memoryTriggerKeys, ...skillTriggerKeys])(
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
      for (const key of [...memoryTriggerKeys, ...skillTriggerKeys]) {
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

    const skillHookTriggerKeys = [
      'skillSynthesis.triggers.subagentStop.enabled',
      'skillSynthesis.triggers.postToolUse.enabled',
      'skillSynthesis.triggers.postToolUse.minEditCount',
      'skillSynthesis.triggers.maxAnalyzesPerHour',
    ] as const;

    const allHookKeys = [
      ...memoryHookTriggerKeys,
      ...skillHookTriggerKeys,
    ] as const;

    const expectedScalarDefaults: Record<string, boolean | number> = {
      'memory.triggers.userPromptSubmit.enabled': true,
      'memory.triggers.userPromptSubmit.minPromptLength': 20,
      'memory.triggers.postToolUse.enabled': true,
      'memory.triggers.maxCuratesPerHour': 20,
      'skillSynthesis.triggers.subagentStop.enabled': true,
      'skillSynthesis.triggers.postToolUse.enabled': true,
      'skillSynthesis.triggers.postToolUse.minEditCount': 3,
      'skillSynthesis.triggers.maxAnalyzesPerHour': 6,
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

  describe('synthesis drain + budget keys (TASK_2026_180, Phase 0)', () => {
    /**
     * The values on the right are the SAME numbers as `SKILL_DRAIN_DEFAULTS`
     * in `skill-synthesis/src/lib/queue/skill-drain.service.ts`. They cannot be
     * imported here — `platform-core` is the leaf every backend lib depends on,
     * so importing `skill-synthesis` would invert the graph. This table is the
     * literal restatement, and it is why the drain behaves identically before
     * and after a user has ever written `~/.ptah/settings.json`.
     */
    const drainDefaults: Record<string, string | number | boolean> = {
      'skillSynthesis.drain.cronExpr': '*/15 * * * *',
      'skillSynthesis.drain.nightlyCronExpr': '0 3 * * *',
      'skillSynthesis.drain.weeklyCronExpr': '0 4 * * 0',
      'skillSynthesis.drain.maxItemsPerRun': 4,
      'skillSynthesis.drain.perWorkspaceBatch': 1,
      'skillSynthesis.drain.foregroundBackoffMs': 300000,
      'skillSynthesis.drain.pauseOnBattery': true,
      'skillSynthesis.drain.maxAttempts': 5,
      'skillSynthesis.drain.staleClaimTtlMs': 900000,
      'skillSynthesis.budget.maxTokensPerDay': 2000000,
      'skillSynthesis.trayKeepalive': false,
    };

    const drainKeys = Object.keys(drainDefaults);

    it.each(drainKeys)('registers %s in FILE_BASED_SETTINGS_KEYS', (key) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
    });

    it.each(drainKeys)('routes %s through isFileBasedSettingKey', (key) => {
      expect(isFileBasedSettingKey(key)).toBe(true);
    });

    it.each(Object.entries(drainDefaults))(
      'declares default %s = %s',
      (key, expected) => {
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
      },
    );

    // Decision Q-B. The tray's "Pause background learning" writes
    // `skillSynthesis.enabled` — the drain's first gate — rather than a second
    // pause key. A `trayPaused`/`queueEnabled` key appearing here would mean
    // two ways to say "off" and a gate order that no longer matches the
    // documented contract.
    it('adds no second pause switch beside skillSynthesis.enabled', () => {
      const pauseLike = [...FILE_BASED_SETTINGS_KEYS].filter(
        (key) =>
          key.startsWith('skillSynthesis.') && /paused|queueEnabled/i.test(key),
      );
      expect(pauseLike).toEqual([]);
      expect(FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.enabled']).toBe(true);
    });

    it('ships the tray keep-alive OFF so commit C5 is purely additive', () => {
      expect(FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.trayKeepalive']).toBe(
        false,
      );
    });

    it('uses the quarter-hour cadence for the frequent tier (Q5)', () => {
      expect(
        FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.drain.cronExpr'],
      ).toBe('*/15 * * * *');
    });
  });

  describe('skill-synthesis lane keys (TASK_2026_180, Phase 1)', () => {
    /**
     * The literal restatement of `SKILL_LANE_DEFAULTS`
     * (`skill-synthesis/src/lib/lanes/skill-lane-config.ts`). It cannot be
     * imported: `platform-core` is the leaf `skill-synthesis` depends on, so
     * the import would close a cycle — the same constraint that produced the
     * drain-defaults table above.
     *
     * This spec pins the SHAPE (all four lanes × all eight fields present,
     * routed, and defaulted). The cross-lib equality against the real
     * `SKILL_LANE_KEYS` / `SKILL_LANE_DEFAULTS` is asserted in
     * `rpc-handlers/.../skills-synthesis-rpc.handlers.spec.ts`, which is the
     * one place that may legally import both sides.
     */
    const laneDefaults: Record<string, Record<string, string | number>> = {
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

    const laneEntries: Array<[string, string | number]> = Object.entries(
      laneDefaults,
    ).flatMap(([lane, fields]) =>
      Object.entries(fields).map(
        ([field, value]): [string, string | number] => [
          `skillSynthesis.${lane}.${field}`,
          value,
        ],
      ),
    );

    const laneKeys = laneEntries.map(([key]) => key);

    it('registers 32 lane keys — four lanes × eight fields', () => {
      expect(laneKeys).toHaveLength(32);
      for (const key of laneKeys) {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      }
    });

    it.each(laneKeys)('routes %s through isFileBasedSettingKey', (key) => {
      expect(isFileBasedSettingKey(key)).toBe(true);
    });

    it.each(laneEntries)('declares default %s = %s', (key, expected) => {
      expect(
        Object.prototype.hasOwnProperty.call(FILE_BASED_SETTINGS_DEFAULTS, key),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expected);
    });

    it('carries a maxPasses key for EVERY lane, not only the multi-pass one', () => {
      // A missing `maxPasses` fails in the write direction only: the read
      // falls through to the default and looks correct while the write is
      // handed to a store that does not own the key and is dropped silently.
      for (const lane of Object.keys(laneDefaults)) {
        expect(
          FILE_BASED_SETTINGS_KEYS.has(`skillSynthesis.${lane}.maxPasses`),
        ).toBe(true);
      }
    });

    it('defaults every lane to "inherit" — provider and model both empty', () => {
      // The untouched-existing-installs guarantee. A lane defaulted to a
      // concrete provider would repoint background work on upgrade, with no
      // user action and nothing in the UI to explain it.
      for (const lane of Object.keys(laneDefaults)) {
        expect(
          FILE_BASED_SETTINGS_DEFAULTS[`skillSynthesis.${lane}.provider`],
        ).toBe('');
        expect(
          FILE_BASED_SETTINGS_DEFAULTS[`skillSynthesis.${lane}.model`],
        ).toBe('');
      }
    });

    it('names no provider id in any lane default', () => {
      // Global invariant 1: lanes differ ONLY by capability fields. A provider
      // id reaching a default here is the first step to a lane that behaves
      // differently because of WHO the provider is rather than WHAT it
      // declared.
      const laneValues = laneKeys.map(
        (key) => FILE_BASED_SETTINGS_DEFAULTS[key],
      );
      const providerish =
        /anthropic|openai|copilot|codex|openrouter|moonshot|z-ai|ollama|lm-studio|cursor/i;
      for (const value of laneValues) {
        if (typeof value === 'string') {
          expect(providerish.test(value)).toBe(false);
        }
      }
    });

    it('adds no lane key outside the four declared lanes', () => {
      const declared = new Set(laneKeys);
      const stray = [...FILE_BASED_SETTINGS_KEYS].filter(
        (key) =>
          /^skillSynthesis\.(archaeologist|synthesis|judge|replay)\./.test(
            key,
          ) && !declared.has(key),
      );
      expect(stray).toEqual([]);
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
});
