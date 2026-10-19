/**
 * Skill Synthesis RPC schema specs — Zod validation rules.
 *
 * Tests the retained clone, scorecard, quarantine, and agent-model boundaries.
 */
import {
  SkillGetCloneParamsSchema,
  SkillRevertEnhancementParamsSchema,
  SkillRebaseCloneParamsSchema,
  SkillKeepCloneParamsSchema,
  SkillSaveCloneBodyParamsSchema,
  SkillInvocationStatsParamsSchema,
  SkillListQuarantinedAgentsParamsSchema,
  SkillRestoreQuarantinedAgentParamsSchema,
  SkillGetAgentModelsParamsSchema,
  SkillSetAgentModelParamsSchema,
  getScorecardsParamsSchema,
  getScorecardDetailParamsSchema,
} from './skills-synthesis-rpc.schema';

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

describe('SkillSaveCloneBodyParamsSchema', () => {
  it('accepts kind + slug + a non-empty body', () => {
    const result = SkillSaveCloneBodyParamsSchema.parse({
      kind: 'skill',
      slug: 'deep-research',
      body: '# Deep research\n',
    });
    expect(result.slug).toBe('deep-research');
    expect(result.body).toBe('# Deep research\n');
  });

  it.each([
    ['traversal slug', { kind: 'skill', slug: '../x', body: 'x' }],
    ['posix-separator slug', { kind: 'skill', slug: 'a/b', body: 'x' }],
    ['windows-separator slug', { kind: 'skill', slug: 'a\\b', body: 'x' }],
    ['unknown kind', { kind: 'plugin', slug: 'a', body: 'x' }],
    ['non-string body', { kind: 'skill', slug: 'a', body: 42 }],
    ['empty body', { kind: 'skill', slug: 'a', body: '' }],
    // `.min(1)` passes every one of these. A body of whitespace is the
    // effectively-empty skill the non-empty rule exists to stop: it would be
    // written and then reconciled outward into every harness directory.
    ['single-space body', { kind: 'skill', slug: 'a', body: ' ' }],
    ['spaces-only body', { kind: 'skill', slug: 'a', body: '   ' }],
    ['newlines-only body', { kind: 'skill', slug: 'a', body: '\n\n' }],
    ['tabs-and-newlines body', { kind: 'skill', slug: 'a', body: '\t \r\n ' }],
  ])('rejects %s before any path is built', (_label, params) => {
    expect(() => SkillSaveCloneBodyParamsSchema.parse(params)).toThrow();
  });

  /**
   * The blank check reads the TRIMMED length; the value that comes out is the
   * body the user typed. Trimming what gets written would silently reshape
   * real content — a Markdown body's trailing newline is the author's.
   */
  it('preserves surrounding whitespace on a body with real content', () => {
    const body = '\n\n# Deep research\n\nBody text.\n\n';
    const result = SkillSaveCloneBodyParamsSchema.parse({
      kind: 'skill',
      slug: 'deep-research',
      body,
    });
    expect(result.body).toBe(body);
  });

  it('rejects a body over the 1 MiB cap', () => {
    expect(() =>
      SkillSaveCloneBodyParamsSchema.parse({
        kind: 'skill',
        slug: 'a',
        body: 'x'.repeat(1_048_577),
      }),
    ).toThrow();
  });

  it('accepts a body exactly at the cap', () => {
    const result = SkillSaveCloneBodyParamsSchema.parse({
      kind: 'skill',
      slug: 'a',
      body: 'x'.repeat(1_048_576),
    });
    expect(result.body).toHaveLength(1_048_576);
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

describe('SkillListQuarantinedAgentsParamsSchema', () => {
  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
  ])('accepts %s', (_label, params) => {
    expect(() =>
      SkillListQuarantinedAgentsParamsSchema.parse(params),
    ).not.toThrow();
  });

  it('rejects an unknown key (the listing takes no input)', () => {
    expect(() =>
      SkillListQuarantinedAgentsParamsSchema.parse({ workspaceRoot: '/x' }),
    ).toThrow();
  });
});

describe('SkillRestoreQuarantinedAgentParamsSchema', () => {
  it('accepts a plain agent slug', () => {
    expect(
      SkillRestoreQuarantinedAgentParamsSchema.parse({
        slug: 'backend-developer',
      }),
    ).toEqual({ slug: 'backend-developer' });
  });

  // PR4: the slug becomes a path segment under `{ws}/.claude/agents`.
  it.each([
    ['parent traversal', '../evil'],
    ['embedded traversal', 'a..b'],
    ['bare dot', '.'],
    ['bare dot-dot', '..'],
    ['forward slash', 'a/b'],
    ['backslash', 'a\\b'],
    ['absolute posix path', '/etc/passwd'],
    ['windows drive path', 'C:\\x'],
    ['empty', ''],
    ['over 128 chars', 'a'.repeat(129)],
  ])('rejects a %s slug', (_label, slug) => {
    expect(() =>
      SkillRestoreQuarantinedAgentParamsSchema.parse({ slug }),
    ).toThrow();
  });

  it('rejects a missing slug and unknown keys', () => {
    expect(() => SkillRestoreQuarantinedAgentParamsSchema.parse({})).toThrow();
    expect(() =>
      SkillRestoreQuarantinedAgentParamsSchema.parse({
        slug: 'ok',
        workspaceRoot: '/other',
      }),
    ).toThrow();
  });
});

describe('SkillGetAgentModelsParamsSchema', () => {
  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
    ['a workspace root', { workspaceRoot: '/ws/project' }],
  ])('accepts %s', (_label, params) => {
    expect(() => SkillGetAgentModelsParamsSchema.parse(params)).not.toThrow();
  });

  it.each([
    ['a blank workspace root', { workspaceRoot: '  ' }],
    ['a non-string workspace root', { workspaceRoot: 42 }],
    ['an unknown key', { slug: 'x' }],
  ])('rejects %s', (_label, params) => {
    expect(() => SkillGetAgentModelsParamsSchema.parse(params)).toThrow();
  });
});

describe('SkillSetAgentModelParamsSchema', () => {
  const valid = {
    workspaceRoot: '/ws/project',
    slug: 'backend-developer',
    provider: 'codex',
    scope: 'workspace',
    value: 'gpt-5-codex',
  };

  it('accepts an agent slug, the wildcard, a null value and confirmUnlisted', () => {
    expect(SkillSetAgentModelParamsSchema.parse(valid)).toEqual(valid);
    expect(
      SkillSetAgentModelParamsSchema.parse({
        ...valid,
        slug: '*',
        scope: 'machine',
        value: null,
        confirmUnlisted: true,
      }),
    ).toMatchObject({ slug: '*', value: null, confirmUnlisted: true });
  });

  it.each(['claude', 'codex', 'copilot', 'cursor', 'opencode'])(
    'accepts provider %s',
    (provider) => {
      expect(() =>
        SkillSetAgentModelParamsSchema.parse({ ...valid, provider }),
      ).not.toThrow();
    },
  );

  it('keeps the value untrimmed (classification decides, not the schema)', () => {
    expect(
      SkillSetAgentModelParamsSchema.parse({ ...valid, value: ' gpt-5 ' })
        .value,
    ).toBe(' gpt-5 ');
  });

  it.each([
    ['a missing workspaceRoot', { workspaceRoot: undefined }],
    ['an empty workspaceRoot', { workspaceRoot: '' }],
    ['a blank workspaceRoot', { workspaceRoot: '   ' }],
    ['a traversal slug', { slug: '../evil' }],
    ['a separator slug', { slug: 'a/b' }],
    ['a double wildcard slug', { slug: '**' }],
    ['a __proto__ slug', { slug: '__proto__' }],
    ['an unknown provider', { provider: 'antigravity' }],
    ['an unknown scope', { scope: 'global' }],
    ['a missing value', { value: undefined }],
    ['an over-long value', { value: 'm'.repeat(257) }],
    ['a non-boolean confirmUnlisted', { confirmUnlisted: 'yes' }],
    ['an unknown key', { reconcile: true }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      SkillSetAgentModelParamsSchema.parse({ ...valid, ...overrides }),
    ).toThrow();
  });
});
