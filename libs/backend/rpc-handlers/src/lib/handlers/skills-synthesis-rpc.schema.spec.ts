/**
 * Skill Synthesis RPC schema specs — Zod validation rules.
 *
 * Tests: successesToPromote=0 rejected, out-of-range thresholds, empty id for pin/unpin,
 * partial update params accepted, z.coerce.number accepts numeric strings.
 */
import {
  SkillSynthesisSettingsSchema,
  UpdateSkillSynthesisSettingsParamsSchema,
  PinSkillParamsSchema,
  UnpinSkillParamsSchema,
  SkillGetCloneParamsSchema,
  SkillEnhanceNowParamsSchema,
  SkillRevertEnhancementParamsSchema,
  SkillRebaseCloneParamsSchema,
  SkillKeepCloneParamsSchema,
  SkillInvocationStatsParamsSchema,
  getScorecardsParamsSchema,
  getScorecardDetailParamsSchema,
  SkillQueueParamsSchema,
  SkillLaneSchema,
  SkillSetLanesParamsSchema,
  SkillGetLanesParamsSchema,
  SKILL_LANE_ID_VALUES,
} from './skills-synthesis-rpc.schema';

describe('SkillQueueParamsSchema', () => {
  // The Skills tab calls this with nothing at all on first paint.
  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
  ])('accepts %s', (_label, params) => {
    expect(() => SkillQueueParamsSchema.parse(params)).not.toThrow();
  });

  it('accepts both limits within range', () => {
    const result = SkillQueueParamsSchema.parse({ limit: 10, runLimit: 5 });
    expect(result).toEqual({ limit: 10, runLimit: 5 });
  });

  it('coerces numeric strings arriving over the bridge', () => {
    expect(SkillQueueParamsSchema.parse({ limit: '25' })?.limit).toBe(25);
  });

  it.each([
    ['limit', 0],
    ['limit', 201],
    ['limit', -5],
    ['runLimit', 0],
    ['runLimit', 201],
  ])('rejects %s = %s', (field, value) => {
    expect(() => SkillQueueParamsSchema.parse({ [field]: value })).toThrow();
  });

  it('rejects a non-numeric limit', () => {
    expect(() => SkillQueueParamsSchema.parse({ limit: 'all' })).toThrow();
  });
});

/**
 * The one complete settings fixture, shared by every settings describe below.
 *
 * `SkillSynthesisSettingsSchema` declares all of its keys as REQUIRED — no key
 * carries a Zod `.default()`, because the defaults live on the other side of
 * the boundary in `FILE_BASED_SETTINGS_DEFAULTS` and `registerGetSettings`
 * fills each key from there before parsing. That is the house contract and it
 * is what makes a settings key that a host forgot to write a loud failure
 * rather than a silent zero.
 *
 * The consequence is that every settings spec needs the WHOLE object, and this
 * file used to carry three drifting copies of it — so adding the eleven Phase 0
 * drain keys broke two describes that had nothing to do with the drain. One
 * fixture, hoisted: the next settings key is a one-line change here.
 */
const validFull = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 50,
  candidatesDir: '',
  eligibilityMinTurns: 5,
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
  prefilterMinChars: 800,
  prefilterMinToolUses: 2,
  judgeEnabled: true,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: true,
  curatorIntervalHours: 24,
  suggestionMinClusterSize: 2,
  suggestionMaxCandidates: 200,
  // TASK_2026_180 Phase 0 — the drain knobs. These are the shipped defaults;
  // `file-settings-keys.spec.ts` pins the same values on the other side.
  'drain.cronExpr': '*/15 * * * *',
  'drain.nightlyCronExpr': '0 3 * * *',
  'drain.weeklyCronExpr': '0 4 * * 0',
  'drain.maxItemsPerRun': 4,
  'drain.perWorkspaceBatch': 1,
  'drain.foregroundBackoffMs': 300000,
  'drain.pauseOnBattery': true,
  'drain.maxAttempts': 5,
  'drain.staleClaimTtlMs': 900000,
  'budget.maxTokensPerDay': 2000000,
  trayKeepalive: false,
  // TASK_2026_180 Phase 3 — the empirical gates. Same shipped defaults as
  // `file-settings-keys.spec.ts` pins on the other side of the boundary.
  'replayValidation.enabled': true,
  'replayValidation.minConfidence': 0.5,
  'triggerEval.enabled': true,
  'judgePanel.enabled': true,
  'judgePanel.disagreementThreshold': 3,
};

describe('SkillSynthesisSettingsSchema', () => {
  it('accepts a fully valid settings object', () => {
    expect(() => SkillSynthesisSettingsSchema.parse(validFull)).not.toThrow();
  });

  it('rejects successesToPromote=0 (min is 1)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        successesToPromote: 0,
      }),
    ).toThrow();
  });

  it('rejects dedupCosineThreshold > 1', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        dedupCosineThreshold: 1.1,
      }),
    ).toThrow();
  });

  it('rejects dedupCosineThreshold < 0', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        dedupCosineThreshold: -0.1,
      }),
    ).toThrow();
  });

  it('rejects minJudgeScore > 10', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({ ...validFull, minJudgeScore: 11 }),
    ).toThrow();
  });

  it('rejects curatorIntervalHours < 1', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        curatorIntervalHours: 0,
      }),
    ).toThrow();
  });

  it('z.coerce.number() accepts numeric strings for number fields', () => {
    const result = SkillSynthesisSettingsSchema.parse({
      ...validFull,
      successesToPromote: '5',
      maxActiveSkills: '100',
      minJudgeScore: '7.5',
    });
    expect(result.successesToPromote).toBe(5);
    expect(result.maxActiveSkills).toBe(100);
    expect(result.minJudgeScore).toBe(7.5);
  });

  describe('drain + budget knobs (TASK_2026_180 Phase 0)', () => {
    /**
     * The schema key IS the settings path suffix: `registerGetSettings` reads
     * `skillSynthesis.${key}` and `registerUpdateSettings` writes it back. A
     * renamed key would read and write a path no host stores, and nothing
     * would raise — this is the assertion that keeps the dotted names.
     */
    it('names its keys so `skillSynthesis.<key>` is the settings path', () => {
      const keys = Object.keys(SkillSynthesisSettingsSchema.shape);
      expect(keys).toEqual(
        expect.arrayContaining([
          'drain.cronExpr',
          'drain.nightlyCronExpr',
          'drain.weeklyCronExpr',
          'drain.maxItemsPerRun',
          'drain.perWorkspaceBatch',
          'drain.foregroundBackoffMs',
          'drain.pauseOnBattery',
          'drain.maxAttempts',
          'drain.staleClaimTtlMs',
          'budget.maxTokensPerDay',
          'trayKeepalive',
        ]),
      );
    });

    // Phase 0 REPLACES the inline path; a second switch would be the parallel
    // implementation the brief forbids. `skillSynthesis.enabled` is the one
    // master switch and the drain's first gate.
    it('declares no queueEnabled or paused flag beside `enabled`', () => {
      const keys = Object.keys(SkillSynthesisSettingsSchema.shape);
      expect(keys.filter((k) => /queueEnabled|paused/i.test(k))).toEqual([]);
      expect(keys).toContain('enabled');
    });

    it.each([
      ['5 fields', '*/15 * * * *'],
      ['6 fields', '0 */15 * * * *'],
    ])('accepts a cron expression with %s', (_label, expr) => {
      expect(() =>
        SkillSynthesisSettingsSchema.parse({
          ...validFull,
          'drain.cronExpr': expr,
        }),
      ).not.toThrow();
    });

    it.each([
      ['an empty expression', ''],
      ['a whitespace-only expression', '   '],
      ['too few fields', '*/15 * *'],
      ['too many fields', '0 0 */15 * * * *'],
    ])('rejects %s', (_label, expr) => {
      expect(() =>
        SkillSynthesisSettingsSchema.parse({
          ...validFull,
          'drain.cronExpr': expr,
        }),
      ).toThrow();
    });

    // `0` is a supported value, not an omission: it turns the foreground gate
    // off entirely, which is what a user on a dedicated machine wants.
    it('accepts foregroundBackoffMs = 0, which disables the gate', () => {
      const result = SkillSynthesisSettingsSchema.parse({
        ...validFull,
        'drain.foregroundBackoffMs': 0,
      });
      expect(result['drain.foregroundBackoffMs']).toBe(0);
    });

    // `0` here means UNLIMITED, not "spend nothing".
    it('accepts maxTokensPerDay = 0, which means unlimited', () => {
      const result = SkillSynthesisSettingsSchema.parse({
        ...validFull,
        'budget.maxTokensPerDay': 0,
      });
      expect(result['budget.maxTokensPerDay']).toBe(0);
    });

    // A TTL below the longest stage timeout reaps live work mid-flight (R5).
    it('rejects a stale-claim TTL below one minute', () => {
      expect(() =>
        SkillSynthesisSettingsSchema.parse({
          ...validFull,
          'drain.staleClaimTtlMs': 5_000,
        }),
      ).toThrow();
    });

    it('rejects a per-run item budget of 0, which would drain nothing', () => {
      expect(() =>
        SkillSynthesisSettingsSchema.parse({
          ...validFull,
          'drain.maxItemsPerRun': 0,
        }),
      ).toThrow();
    });

    it('coerces numeric strings from the settings form', () => {
      const result = SkillSynthesisSettingsSchema.parse({
        ...validFull,
        'drain.maxItemsPerRun': '8',
        'budget.maxTokensPerDay': '1500000',
      });
      expect(result['drain.maxItemsPerRun']).toBe(8);
      expect(result['budget.maxTokensPerDay']).toBe(1_500_000);
    });

    it('defaults the tray keep-alive off in the shipped settings object', () => {
      const result = SkillSynthesisSettingsSchema.parse(validFull);
      expect(result.trayKeepalive).toBe(false);
    });
  });

  describe('empirical-gate knobs (TASK_2026_180 Phase 3)', () => {
    /**
     * The schema key IS the settings path suffix, exactly as for the drain
     * keys: `registerGetSettings` reads `skillSynthesis.${key}` and
     * `registerUpdateSettings` writes it back. A renamed key here would read
     * and write a path no host stores, and nothing would raise — the wire would
     * simply stop persisting. `file-settings-keys.spec.ts` pins the same five
     * names from the routing side; this is the wire side of the same contract.
     */
    it('names its keys so `skillSynthesis.<key>` is the settings path', () => {
      const keys = Object.keys(SkillSynthesisSettingsSchema.shape);
      expect(keys).toEqual(
        expect.arrayContaining([
          'replayValidation.enabled',
          'replayValidation.minConfidence',
          'triggerEval.enabled',
          'judgePanel.enabled',
          'judgePanel.disagreementThreshold',
        ]),
      );
    });

    /**
     * NO GATE KEY MAY SIT INSIDE A LANE'S SUB-TREE.
     *
     * The schema key is the settings-path suffix, so a `'replay.enabled'` here
     * would write `skillSynthesis.replay.enabled` — inside the replay LANE's
     * eight capability fields, which `getLanes` / `setLanes` round-trip. That
     * is what the batch text asked for and what B1.8's stray-lane-key guards
     * (in `platform-core` and in `skills-synthesis-rpc.handlers.spec.ts`)
     * rejected. Derived from `SKILL_LANE_ID_VALUES` rather than a literal list
     * so a fifth lane automatically extends the check.
     */
    it('places no gate key inside one of the lane sub-trees', () => {
      const lanePrefixes = SKILL_LANE_ID_VALUES.map((id) => `${id}.`);
      const gateKeys = Object.keys(SkillSynthesisSettingsSchema.shape).filter(
        (k) =>
          /^(replayValidation|triggerEval|judgePanel)\./.test(k) ||
          k.startsWith('replay.'),
      );
      expect(gateKeys).not.toHaveLength(0);
      for (const key of gateKeys) {
        for (const prefix of lanePrefixes) {
          expect(key.startsWith(prefix)).toBe(false);
        }
      }
    });

    // 0–1, because it is compared against `skill_candidates.replay_confidence`,
    // which `0036` and the store both hold to that range.
    it.each([
      ['above 1', 1.5],
      ['below 0', -0.1],
    ])('rejects a minConfidence %s', (_label, value) => {
      expect(() =>
        SkillSynthesisSettingsSchema.parse({
          ...validFull,
          'replayValidation.minConfidence': value,
        }),
      ).toThrow();
    });

    // `0` means "any measured replay clears". It does NOT promote unmeasured
    // candidates: a NULL `replay_confidence` is not below any threshold.
    it('accepts a minConfidence of 0, which clears any measured replay', () => {
      const result = SkillSynthesisSettingsSchema.parse({
        ...validFull,
        'replayValidation.minConfidence': 0,
      });
      expect(result['replayValidation.minConfidence']).toBe(0);
    });

    it('rejects a disagreement threshold above the judge 0–10 scale', () => {
      expect(() =>
        SkillSynthesisSettingsSchema.parse({
          ...validFull,
          'judgePanel.disagreementThreshold': 11,
        }),
      ).toThrow();
    });

    /**
     * Judge scores are reals (7.4), so a 2.5-point gap between two panellists
     * is a meaningful setting. An `.int()` here would silently round the user's
     * intent, which for a threshold means escalating strictly more or strictly
     * fewer verdicts than they asked for.
     */
    it('accepts a fractional disagreement threshold', () => {
      const result = SkillSynthesisSettingsSchema.parse({
        ...validFull,
        'judgePanel.disagreementThreshold': 2.5,
      });
      expect(result['judgePanel.disagreementThreshold']).toBe(2.5);
    });

    it('coerces numeric strings from the settings form', () => {
      const result = SkillSynthesisSettingsSchema.parse({
        ...validFull,
        'replayValidation.minConfidence': '0.75',
        'judgePanel.disagreementThreshold': '4',
      });
      expect(result['replayValidation.minConfidence']).toBe(0.75);
      expect(result['judgePanel.disagreementThreshold']).toBe(4);
    });

    // Each gate has its own switch (R8): trigger-eval's retrieval is
    // local-embedding only and spends nothing, while replay and judge-panel
    // each cost a lane call per candidate. One shared flag would tie them.
    it('declares a separate enabled flag per gate', () => {
      const keys = Object.keys(SkillSynthesisSettingsSchema.shape);
      expect(
        keys
          .filter((k) => /^(replayValidation|triggerEval|judgePanel)\./.test(k))
          .filter((k) => k.endsWith('.enabled'))
          .sort(),
      ).toEqual([
        'judgePanel.enabled',
        'replayValidation.enabled',
        'triggerEval.enabled',
      ]);
    });
  });
});

describe('UpdateSkillSynthesisSettingsParamsSchema', () => {
  it('accepts a partial settings object (only one field)', () => {
    const result = UpdateSkillSynthesisSettingsParamsSchema.parse({
      settings: { successesToPromote: 5 },
    });
    expect(result.settings.successesToPromote).toBe(5);
    // Other fields absent
    expect(result.settings.enabled).toBeUndefined();
  });

  it('accepts an empty settings object', () => {
    expect(() =>
      UpdateSkillSynthesisSettingsParamsSchema.parse({ settings: {} }),
    ).not.toThrow();
  });

  it('rejects an invalid value in a partial update', () => {
    expect(() =>
      UpdateSkillSynthesisSettingsParamsSchema.parse({
        settings: { successesToPromote: 0 },
      }),
    ).toThrow();
  });
});

describe('PinSkillParamsSchema', () => {
  it('accepts a non-empty id', () => {
    const result = PinSkillParamsSchema.parse({ id: 'cand-abc' });
    expect(result.id).toBe('cand-abc');
  });

  it('rejects an empty id', () => {
    expect(() => PinSkillParamsSchema.parse({ id: '' })).toThrow();
  });

  it('rejects a missing id', () => {
    expect(() => PinSkillParamsSchema.parse({})).toThrow();
  });
});

describe('UnpinSkillParamsSchema', () => {
  it('accepts a non-empty id', () => {
    const result = UnpinSkillParamsSchema.parse({ id: 'cand-xyz' });
    expect(result.id).toBe('cand-xyz');
  });

  it('rejects an empty id', () => {
    expect(() => UnpinSkillParamsSchema.parse({ id: '' })).toThrow();
  });
});

describe('SkillGetCloneParamsSchema', () => {
  it('accepts a valid slug + kind', () => {
    const result = SkillGetCloneParamsSchema.parse({
      slug: 'deep-research',
      kind: 'skill',
    });
    expect(result.slug).toBe('deep-research');
    expect(result.kind).toBe('skill');
  });

  it('accepts agent and command kinds', () => {
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: 'a', kind: 'agent' }),
    ).not.toThrow();
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: 'c', kind: 'command' }),
    ).not.toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: 'x', kind: 'plugin' }),
    ).toThrow();
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: '', kind: 'skill' }),
    ).toThrow();
  });
});

describe('SkillEnhanceNowParamsSchema', () => {
  it('accepts a non-empty slug + kind', () => {
    const result = SkillEnhanceNowParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
    });
    expect(result.slug).toBe('my-skill');
    expect(result.kind).toBe('skill');
  });

  it('accepts agent and command kinds', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'agent', slug: 'my-agent' }),
    ).not.toThrow();
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'command', slug: 'my-cmd' }),
    ).not.toThrow();
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'skill', slug: '' }),
    ).toThrow();
  });

  it('rejects a missing slug', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'skill' }),
    ).toThrow();
  });

  it('rejects a missing kind', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ slug: 'my-skill' }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'plugin', slug: 'my-skill' }),
    ).toThrow();
  });
});

describe('SkillRevertEnhancementParamsSchema', () => {
  it('accepts kind + slug + historyTs (epoch-millis snapshot format)', () => {
    const result = SkillRevertEnhancementParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
      historyTs: '1717848000000',
    });
    expect(result.historyTs).toBe('1717848000000');
    expect(result.kind).toBe('skill');
  });

  it('accepts agent and command kinds', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'agent',
        slug: 'my-agent',
        historyTs: '1717848000000',
      }),
    ).not.toThrow();
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'command',
        slug: 'my-cmd',
        historyTs: '1717848000000',
      }),
    ).not.toThrow();
  });

  it('rejects a missing kind', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        slug: 'my-skill',
        historyTs: '1717848000000',
      }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'plugin',
        slug: 'my-skill',
        historyTs: '1717848000000',
      }),
    ).toThrow();
  });

  it('accepts a collision-suffixed historyTs (ts-counter)', () => {
    const result = SkillRevertEnhancementParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
      historyTs: '1717848000000-1',
    });
    expect(result.historyTs).toBe('1717848000000-1');
  });

  it('rejects a missing historyTs', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
      }),
    ).toThrow();
  });

  it('rejects an empty historyTs', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '',
      }),
    ).toThrow();
  });

  it('rejects a traversal historyTs (../../etc)', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '../../etc',
      }),
    ).toThrow();
  });

  it('rejects a single-level traversal historyTs (../)', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '../',
      }),
    ).toThrow();
  });

  it('rejects a non-numeric (legacy ISO-ish) historyTs', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '20260608T120000',
      }),
    ).toThrow();
  });
});

describe('Slug traversal hardening (all clone schemas)', () => {
  const malicious = ['../../etc', 'a/b', 'a\\b', '..', '../foo', 'foo/..'];
  const valid = ['deep-research', 'My_Skill.v2', 'a', 'agent-007'];

  describe('SkillGetCloneParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillGetCloneParamsSchema.parse({ slug, kind: 'skill' }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillGetCloneParamsSchema.parse({ slug, kind: 'skill' }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillEnhanceNowParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillEnhanceNowParamsSchema.parse({ kind: 'skill', slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillEnhanceNowParamsSchema.parse({ kind: 'skill', slug }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillRevertEnhancementParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRevertEnhancementParamsSchema.parse({
            kind: 'skill',
            slug,
            historyTs: '1717848000000',
          }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRevertEnhancementParamsSchema.parse({
            kind: 'skill',
            slug,
            historyTs: '1717848000000',
          }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillRebaseCloneParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRebaseCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRebaseCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillKeepCloneParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillKeepCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillKeepCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillInvocationStatsParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillInvocationStatsParamsSchema.parse({ slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillInvocationStatsParamsSchema.parse({ slug }),
        ).not.toThrow();
      });
    }
  });
});

describe('SkillRebaseCloneParamsSchema', () => {
  it('accepts kind + slug', () => {
    const result = SkillRebaseCloneParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
    });
    expect(result.kind).toBe('skill');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillRebaseCloneParamsSchema.parse({ kind: 'x', slug: 'my-skill' }),
    ).toThrow();
  });
});

describe('SkillKeepCloneParamsSchema', () => {
  it('accepts kind + slug', () => {
    const result = SkillKeepCloneParamsSchema.parse({
      kind: 'agent',
      slug: 'my-agent',
    });
    expect(result.slug).toBe('my-agent');
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillKeepCloneParamsSchema.parse({ kind: 'skill', slug: '' }),
    ).toThrow();
  });
});

describe('SkillInvocationStatsParamsSchema', () => {
  it('accepts a non-empty slug', () => {
    const result = SkillInvocationStatsParamsSchema.parse({ slug: 'my-skill' });
    expect(result.slug).toBe('my-skill');
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillInvocationStatsParamsSchema.parse({ slug: '' }),
    ).toThrow();
  });
});

describe('getScorecardsParamsSchema', () => {
  it('accepts a valid slugs array', () => {
    const result = getScorecardsParamsSchema.parse({
      slugs: ['backend-developer', 'frontend-developer'],
    });
    expect(result.slugs).toHaveLength(2);
  });

  it('accepts an empty slugs array', () => {
    expect(() => getScorecardsParamsSchema.parse({ slugs: [] })).not.toThrow();
  });

  it('accepts exactly 500 slugs (upper bound)', () => {
    const slugs = Array.from({ length: 500 }, (_, i) => `agent-${i}`);
    expect(() => getScorecardsParamsSchema.parse({ slugs })).not.toThrow();
  });

  it('rejects more than 500 slugs', () => {
    const slugs = Array.from({ length: 501 }, (_, i) => `agent-${i}`);
    expect(() => getScorecardsParamsSchema.parse({ slugs })).toThrow();
  });

  it('rejects an empty-string slug entry', () => {
    expect(() => getScorecardsParamsSchema.parse({ slugs: [''] })).toThrow();
  });

  it('rejects a slug entry longer than 200 chars', () => {
    expect(() =>
      getScorecardsParamsSchema.parse({ slugs: ['x'.repeat(201)] }),
    ).toThrow();
  });

  it('rejects a non-array slugs value', () => {
    expect(() =>
      getScorecardsParamsSchema.parse({ slugs: 'backend-developer' }),
    ).toThrow();
  });

  it('rejects a missing slugs field', () => {
    expect(() => getScorecardsParamsSchema.parse({})).toThrow();
  });
});

describe('getScorecardDetailParamsSchema', () => {
  it('accepts slug alone (limit optional)', () => {
    const result = getScorecardDetailParamsSchema.parse({ slug: 'agent' });
    expect(result.slug).toBe('agent');
    expect(result.limit).toBeUndefined();
  });

  it('accepts slug + valid limit', () => {
    const result = getScorecardDetailParamsSchema.parse({
      slug: 'agent',
      limit: 25,
    });
    expect(result.limit).toBe(25);
  });

  it('accepts limit=1 and limit=100 (bounds)', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 1 }),
    ).not.toThrow();
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 100 }),
    ).not.toThrow();
  });

  it('rejects an empty slug', () => {
    expect(() => getScorecardDetailParamsSchema.parse({ slug: '' })).toThrow();
  });

  it('rejects a slug longer than 200 chars', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('rejects a non-integer limit', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 2.5 }),
    ).toThrow();
  });

  it('rejects limit=0 (below min)', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 0 }),
    ).toThrow();
  });

  it('rejects limit=101 (above max)', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 101 }),
    ).toThrow();
  });
});

describe('SkillSynthesisSettingsSchema — suggestionMinClusterSize boundary', () => {
  it('accepts suggestionMinClusterSize=2 (minimum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 2,
      }),
    ).not.toThrow();
  });

  it('accepts suggestionMinClusterSize=100 (maximum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 100,
      }),
    ).not.toThrow();
  });

  it('rejects suggestionMinClusterSize=1 (below min of 2)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 1,
      }),
    ).toThrow();
  });

  it('rejects suggestionMinClusterSize=101 (above max of 100)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 101,
      }),
    ).toThrow();
  });

  it('rejects missing suggestionMinClusterSize (required field)', () => {
    const { suggestionMinClusterSize: _omit, ...rest } = validFull;
    expect(() => SkillSynthesisSettingsSchema.parse(rest)).toThrow();
  });
});

describe('SkillSynthesisSettingsSchema — suggestionMaxCandidates boundary', () => {
  it('accepts suggestionMaxCandidates=1 (minimum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 1,
      }),
    ).not.toThrow();
  });

  it('accepts suggestionMaxCandidates=5000 (maximum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 5000,
      }),
    ).not.toThrow();
  });

  it('rejects suggestionMaxCandidates=0 (below min of 1)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 0,
      }),
    ).toThrow();
  });

  it('rejects suggestionMaxCandidates=5001 (above max of 5000)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 5001,
      }),
    ).toThrow();
  });

  it('rejects missing suggestionMaxCandidates (required field)', () => {
    const { suggestionMaxCandidates: _omit, ...rest } = validFull;
    expect(() => SkillSynthesisSettingsSchema.parse(rest)).toThrow();
  });
});

describe('SkillGetLanesParamsSchema', () => {
  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
  ])('accepts %s', (_label, params) => {
    expect(() => SkillGetLanesParamsSchema.parse(params)).not.toThrow();
  });

  it('rejects unknown params', () => {
    expect(() => SkillGetLanesParamsSchema.parse({ lane: 'judge' })).toThrow();
  });
});

describe('SkillLaneSchema', () => {
  const validLane = {
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 45000,
    maxInputChars: 3000,
    maxPasses: 1,
  };

  it('accepts a fully specified lane', () => {
    expect(() => SkillLaneSchema.parse(validLane)).not.toThrow();
  });

  it('accepts empty provider and model — the "inherit" default', () => {
    const parsed = SkillLaneSchema.parse(validLane);
    expect(parsed.provider).toBe('');
    expect(parsed.model).toBe('');
  });

  it('accepts any opaque provider id without an allowlist', () => {
    // Global invariant 1: lanes differ ONLY by capability fields. An enum of
    // known provider ids here would reject a newly registered provider at the
    // boundary, with nothing near the registry to explain why.
    expect(() =>
      SkillLaneSchema.parse({ ...validLane, provider: 'some-new-endpoint' }),
    ).not.toThrow();
  });

  it.each([0, -1, 999])(
    'rejects timeoutMs=%s (below the 1000ms floor)',
    (ms) => {
      // A non-positive timeout arms an AbortController that fires before the
      // request leaves, so every call on the lane fails as a timeout that cannot
      // be told apart from a real one.
      expect(() =>
        SkillLaneSchema.parse({ ...validLane, timeoutMs: ms }),
      ).toThrow();
    },
  );

  it('rejects a non-integer timeoutMs', () => {
    expect(() =>
      SkillLaneSchema.parse({ ...validLane, timeoutMs: 45000.5 }),
    ).toThrow();
  });

  it.each([0, -1])('rejects maxPasses=%s', (passes) => {
    expect(() =>
      SkillLaneSchema.parse({ ...validLane, maxPasses: passes }),
    ).toThrow();
  });

  it.each([
    ['defaultTier', 'ultra'],
    ['structuredOutput', 'yaml'],
    ['toolUse', 'optional'],
  ])('rejects an out-of-vocabulary %s', (field, value) => {
    expect(() =>
      SkillLaneSchema.parse({ ...validLane, [field]: value }),
    ).toThrow();
  });
});

describe('SkillSetLanesParamsSchema', () => {
  it('accepts a single-field patch on a single lane', () => {
    const parsed = SkillSetLanesParamsSchema.parse({
      lanes: { judge: { timeoutMs: 60000 } },
    });
    expect(parsed.lanes.judge).toEqual({ timeoutMs: 60000 });
  });

  it.each(SKILL_LANE_ID_VALUES)('accepts a patch on the %s lane', (id) => {
    expect(() =>
      SkillSetLanesParamsSchema.parse({ lanes: { [id]: { maxPasses: 2 } } }),
    ).not.toThrow();
  });

  it('accepts all four lanes with all eight fields at once', () => {
    const full = {
      provider: 'lane-provider',
      model: 'lane-model',
      defaultTier: 'sonnet' as const,
      structuredOutput: 'parse' as const,
      toolUse: 'required' as const,
      timeoutMs: 60000,
      maxInputChars: 6000,
      maxPasses: 2,
    };
    const lanes = Object.fromEntries(
      SKILL_LANE_ID_VALUES.map((id) => [id, full]),
    );
    const parsed = SkillSetLanesParamsSchema.parse({ lanes });
    expect(Object.keys(parsed.lanes).sort()).toEqual(
      [...SKILL_LANE_ID_VALUES].sort(),
    );
  });

  it('does NOT demand every lane — the patch is sparse', () => {
    // A Zod 4 record keyed by an enum is exhaustive; spelling the four lanes as
    // optional members is what keeps "change one field" from becoming a
    // full-tree write.
    const parsed = SkillSetLanesParamsSchema.parse({
      lanes: { synthesis: { model: 'lane-model' } },
    });
    expect(parsed.lanes.judge).toBeUndefined();
    expect(parsed.lanes.archaeologist).toBeUndefined();
    expect(parsed.lanes.replay).toBeUndefined();
  });

  it('rejects an unknown lane id', () => {
    expect(() =>
      SkillSetLanesParamsSchema.parse({ lanes: { curator: { maxPasses: 1 } } }),
    ).toThrow();
  });

  it('rejects an unknown field inside a known lane', () => {
    // flattenSkillLanes drops unknown fields silently — correct for it, wrong
    // for a boundary, where a typo must surface as INVALID_PARAMS instead of a
    // write that vanishes.
    expect(() =>
      SkillSetLanesParamsSchema.parse({ lanes: { judge: { temperature: 1 } } }),
    ).toThrow();
  });

  it('rejects a patch that names no lane at all', () => {
    expect(() => SkillSetLanesParamsSchema.parse({ lanes: {} })).toThrow();
  });

  it('rejects a missing lanes key', () => {
    expect(() => SkillSetLanesParamsSchema.parse({})).toThrow();
  });

  it('rejects an id field — lane identity is the map key, not writable', () => {
    expect(() =>
      SkillSetLanesParamsSchema.parse({ lanes: { judge: { id: 'judge' } } }),
    ).toThrow();
  });
});
