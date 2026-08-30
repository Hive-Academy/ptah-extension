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
      'skillSynthesis.drain.nightlyMaxItemsPerRun': 40,
      'skillSynthesis.drain.weeklyMaxItemsPerRun': 400,
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

    /**
     * The nightly tier fires ONCE a day against a frequent tier that fires 96
     * times, so a shared item cap is 96× more generous to the tier that needs
     * it least. If these two ever converge, the nightly-only stages are back to
     * ≤ 4 rows a day of supply and the queue grows without bound.
     */
    it('gives the nightly tier a strictly larger item cap than the frequent one', () => {
      const frequent = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.drain.maxItemsPerRun'
      ] as number;
      const nightly = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.drain.nightlyMaxItemsPerRun'
      ] as number;
      expect(nightly).toBeGreaterThan(frequent);
      expect(nightly).toBe(40);
    });

    /**
     * The same argument one cadence further out. The weekly tick fires once
     * every SEVEN days, so its cap is a whole week's supply for `judge-panel`
     * and `trigger-eval` — both of which phase 3 chains off every successful
     * prefilter, roughly two rows per eligible session. A weekly cap that is
     * merely EQUAL to the nightly one already gives the rarer tier 7× less
     * throughput per unit time, so "strictly larger" is the invariant, not
     * "different".
     */
    it('gives the weekly tier a strictly larger item cap than the nightly one', () => {
      const nightly = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.drain.nightlyMaxItemsPerRun'
      ] as number;
      const weekly = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.drain.weeklyMaxItemsPerRun'
      ] as number;
      expect(weekly).toBeGreaterThan(nightly);
      expect(weekly).toBe(400);
    });

    /**
     * Measured, not chosen: ~163 prefilter-eligible sessions a week over an
     * 828-session corpus, times the two weekly rows phase 3 chains off each
     * one, is ~325 rows a week of demand. A cap below that is the starvation
     * defect this key exists to remove, whatever number is in the table.
     */
    it('keeps the weekly cap above measured weekly demand', () => {
      const MEASURED_WEEKLY_DEMAND_ROWS = 325;
      expect(
        FILE_BASED_SETTINGS_DEFAULTS[
          'skillSynthesis.drain.weeklyMaxItemsPerRun'
        ] as number,
      ).toBeGreaterThan(MEASURED_WEEKLY_DEMAND_ROWS);
    });

    it('uses the quarter-hour cadence for the frequent tier (Q5)', () => {
      expect(
        FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.drain.cronExpr'],
      ).toBe('*/15 * * * *');
    });
  });

  describe('empirical-gate keys (TASK_2026_180, Phase 3)', () => {
    /**
     * WHY THIS DESCRIBE EXISTS AT ALL, given the generic
     * "every key in FILE_BASED_SETTINGS_DEFAULTS is also in
     * FILE_BASED_SETTINGS_KEYS" assertion further up.
     *
     * That generic pair only proves the two tables agree with EACH OTHER. It
     * says nothing when a key is missing from BOTH, which is the actual failure
     * mode: an unrouted key fails in the WRITE direction only. The read falls
     * through to a `getConfiguration` default and looks correct, while the
     * write goes to a store that does not own the key and is silently dropped —
     * so the settings panel shows the gate off while the drain keeps running
     * it. This task has already been bitten by exactly that twice (the missing
     * `lane` scope in `PROVIDER_SCOPED_TIER_PATTERN`, and B1.8's four unrouted
     * `maxPasses` keys). Naming the five keys literally here is what makes a
     * forgotten one a red test instead of a silent behaviour.
     */
    const gateDefaults: Record<string, boolean | number> = {
      'skillSynthesis.replayValidation.enabled': true,
      'skillSynthesis.replayValidation.minConfidence': 0.5,
      'skillSynthesis.triggerEval.enabled': true,
      'skillSynthesis.judgePanel.enabled': true,
      'skillSynthesis.judgePanel.disagreementThreshold': 3,
    };

    const gateKeys = Object.keys(gateDefaults);

    it.each(gateKeys)('registers %s in FILE_BASED_SETTINGS_KEYS', (key) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
    });

    it.each(gateKeys)('routes %s through isFileBasedSettingKey', (key) => {
      expect(isFileBasedSettingKey(key)).toBe(true);
    });

    it.each(Object.entries(gateDefaults))(
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

    /**
     * All three gates ship ON. A gate defaulting off would mean every install
     * that never opens the settings panel keeps phase 1's promotion rule while
     * the code claims phase 3's — the hardest kind of behaviour to notice,
     * because nothing errors and the UI is telling the truth about the setting.
     */
    it.each([
      'skillSynthesis.replayValidation.enabled',
      'skillSynthesis.triggerEval.enabled',
      'skillSynthesis.judgePanel.enabled',
    ])('ships %s ON', (key) => {
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(true);
    });

    /**
     * NO GATE KEY MAY LAND INSIDE A LANE'S SUB-TREE.
     *
     * `replay` is one of the four lane ids, so `skillSynthesis.replay.*` is
     * already the replay LANE's eight capability fields. The batch text for
     * this phase asked for `skillSynthesis.replay.enabled` /
     * `.minConfidence`, which would have made two gate switches look like
     * ninth and tenth lane fields — to a human reading the settings file, and
     * to `skillSynthesis:getLanes` / `setLanes`, which round-trip that
     * sub-tree. B1.8's stray-lane-key guard (below, and its mirror in
     * `rpc-handlers`) rejected both, which is exactly what it was written for.
     *
     * The keys were renamed to `replayValidation.*`; the lane is what the gate
     * RUNS ON, the gate is a different thing. This assertion is what stops the
     * collision being reintroduced by a later gate — `judgePanel` is already
     * one character from the `judge` lane.
     */
    it('places no gate key inside one of the four lane sub-trees', () => {
      const laneScoped = gateKeys.filter((key) =>
        /^skillSynthesis\.(archaeologist|synthesis|judge|replay)\./.test(key),
      );
      expect(laneScoped).toEqual([]);
    });

    /**
     * `minConfidence` is compared against the stored `replay_confidence`, which
     * migration `0036` and `SkillCandidateStore.recordReplay` both hold to
     * 0–1. A threshold outside that range makes the comparison answer the same
     * way for every candidate — always-promote at `< 0`, never at `> 1` — which
     * is a disabled gate wearing an enabled gate's name.
     */
    it('keeps minConfidence on the same 0–1 scale as replay_confidence', () => {
      const value = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.replayValidation.minConfidence'
      ] as number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    /**
     * The disagreement threshold lives on the JUDGE's 0–10 scale, the same one
     * `minJudgeScore` uses — it is a gap between two panellists' headline
     * scores, not a probability. Pinning both here is what stops a later reader
     * "harmonising" it onto the 0–1 replay scale, which would escalate every
     * verdict and quadruple promotion cost (R8).
     */
    it('keeps disagreementThreshold on the judge 0–10 scale', () => {
      const threshold = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.judgePanel.disagreementThreshold'
      ] as number;
      const minJudgeScore = FILE_BASED_SETTINGS_DEFAULTS[
        'skillSynthesis.minJudgeScore'
      ] as number;
      expect(threshold).toBeGreaterThan(1);
      expect(threshold).toBeLessThanOrEqual(10);
      expect(minJudgeScore).toBeLessThanOrEqual(10);
    });

    /**
     * Each gate carries its OWN `enabled`. One shared `gates.enabled` would tie
     * trigger-eval — whose retrieval is local-embedding only and spends nothing
     * — to replay and judge-panel, which each cost a lane call per candidate
     * (R8). A user who wants the free gate but not the expensive ones must be
     * able to say so.
     */
    it('gives each gate its own switch rather than one shared flag', () => {
      const enabledKeys = [...FILE_BASED_SETTINGS_KEYS].filter(
        (key) =>
          /^skillSynthesis\.(replayValidation|triggerEval|judgePanel)\./.test(
            key,
          ) && key.endsWith('.enabled'),
      );
      expect(enabledKeys.sort()).toEqual([
        'skillSynthesis.judgePanel.enabled',
        'skillSynthesis.replayValidation.enabled',
        'skillSynthesis.triggerEval.enabled',
      ]);
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

  describe('internalQuery.* — the shared one-shot gate (TASK_2026_328)', () => {
    /**
     * TASK_2026_323 B6 put every internal one-shot query behind one
     * process-wide `InternalQueryConcurrencyGate` — memory-curator,
     * skill-synthesis, cron, the harness LLM runner and the setup wizard all
     * queue on it. The gate reads its limit and its wait ceiling through
     * `IWorkspaceProvider.getConfiguration('ptah', 'internalQuery.*')`.
     *
     * Neither key was registered anywhere: not here, and not in the VS Code
     * `contributes.configuration`. That is this file's documented silent-drop
     * failure mode in the WRITE direction — the read falls through to
     * `FILE_BASED_SETTINGS_DEFAULTS` and looks correct, while a write is handed
     * to a store that does not own the key and is discarded with no error.
     *
     * The user-visible consequence was that the gate could not be moved off its
     * defaults on any host. With `maxConcurrent` stuck at 1, an interactive
     * wizard call queues behind a slow background curation pass and the wizard
     * appears to hang — the symptom class TASK_2026_323 exists to remove.
     */
    it('registers both internalQuery keys in FILE_BASED_SETTINGS_KEYS', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('internalQuery.maxConcurrent')).toBe(
        true,
      );
      expect(FILE_BASED_SETTINGS_KEYS.has('internalQuery.queueTimeoutMs')).toBe(
        true,
      );
    });

    it('routes both internalQuery keys through isFileBasedSettingKey', () => {
      expect(isFileBasedSettingKey('internalQuery.maxConcurrent')).toBe(true);
      expect(isFileBasedSettingKey('internalQuery.queueTimeoutMs')).toBe(true);
    });

    /**
     * These two values are hard-coded rather than imported. `platform-core` is
     * L0.5 and imports nothing from `@ptah-extension/*`, so it cannot reach
     * `DEFAULT_MAX_CONCURRENT` / `DEFAULT_QUEUE_TIMEOUT_MS` in `agent-sdk`.
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
          'internalQuery.queueTimeoutMs',
        ),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS['internalQuery.maxConcurrent']).toBe(
        1,
      );
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
});
