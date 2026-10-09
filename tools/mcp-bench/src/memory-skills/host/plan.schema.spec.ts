import {
  MEMORY_SKILLS_PLAN_ENV,
  MEMORY_SKILLS_PLAN_SCHEMA_ID,
  MemorySkillsPlanError,
  createMemorySkillsPlanSchema,
  loadMemorySkillsPlan,
} from './plan.schema';

// POSIX paths are absolute on every platform node runs the spec on.
const platform = 'linux' as const;
const schema = createMemorySkillsPlanSchema(platform);

function basePlan(): Record<string, unknown> {
  return {
    schemaId: MEMORY_SKILLS_PLAN_SCHEMA_ID,
    runId: 'run-2026-10-07.a',
    benchDataDir: '/bench',
    runDir: '/bench/runs/run-2026-10-07.a',
    realHome: '/home/dev',
    committedFixturesDir: '/repo/tools/mcp-bench/fixtures/memory-skills',
    cassetteMode: 'replay',
    ci: true,
    cassettes: {
      curator: { path: '/bench/cassettes/curator.jsonl', model: 'm-1' },
      laneRunner: {
        path: '/repo/tools/mcp-bench/fixtures/memory-skills/cassettes/lane.jsonl',
        model: 'm-1',
      },
    },
    fixtures: [
      { kind: 'database', source: '/bench/snapshots/seed.sqlite' },
      {
        kind: 'directory',
        source: '/bench/candidates',
        target: '.ptah/skills/_candidates',
      },
      {
        kind: 'file',
        source: '/repo/tools/mcp-bench/fixtures/memory-skills/s.jsonl',
        target: '.claude/projects/p/s.jsonl',
      },
    ],
    suites: [{ id: 'mem.extraction.seeded', options: { k: 5 } }],
  };
}

function messages(plan: unknown): string[] {
  const result = schema.safeParse(plan);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('memory-skills plan schema', () => {
  it('accepts a complete plan and an empty one', () => {
    expect(schema.safeParse(basePlan()).success).toBe(true);
    expect(
      schema.safeParse({ ...basePlan(), fixtures: [], suites: [] }).success,
    ).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    expect(messages({ ...basePlan(), extra: 1 }).length).toBeGreaterThan(0);
  });

  it('accepts product settings and rejects secret-like keys', () => {
    expect(
      schema.safeParse({
        ...basePlan(),
        settings: {
          'memory.curatorProvider': 'openai-codex',
          'memory.curatorModel': 'gpt-5.6-terra',
          turns: 2,
        },
      }).success,
    ).toBe(true);
    expect(
      messages({
        ...basePlan(),
        settings: { 'accounts.password': 'nope' },
      }).some((message) => /looks like a secret/.test(message)),
    ).toBe(true);
    expect(
      messages({
        ...basePlan(),
        settings: {
          'provider.openai-codex.oauthTokenEndpoint':
            'http://127.0.0.1:9/oauth/token',
        },
      }),
    ).toEqual([]);
  });

  it('requires replay mode in CI', () => {
    expect(messages({ ...basePlan(), cassetteMode: 'record' })).toContain(
      'a CI plan must use cassetteMode "replay"',
    );
    expect(
      schema.safeParse({
        ...basePlan(),
        ci: false,
        cassetteMode: 'record',
        cassettes: {
          curator: { path: '/bench/cassettes/curator.jsonl', model: 'm-1' },
          laneRunner: { path: '/bench/cassettes/lane.jsonl', model: 'm-1' },
        },
      }).success,
    ).toBe(true);
  });

  it('refuses a record-mode cassette in the committed fixtures (review finding 7)', () => {
    // basePlan's lane-runner cassette is a committed fixture: fine to replay.
    expect(
      messages({ ...basePlan(), ci: false, cassetteMode: 'record' }),
    ).toEqual([
      'record mode writes cassettes; a record cassette must lie in benchDataDir, not committedFixturesDir',
    ]);
  });

  it('refuses a bench data dir in the real ~/.ptah', () => {
    const plan = {
      ...basePlan(),
      benchDataDir: '/home/dev/.ptah/bench',
      runDir: '/home/dev/.ptah/bench/r',
    };
    expect(messages(plan)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('benchDataDir lies in the real'),
      ]),
    );
  });

  it('refuses a run dir outside (or equal to) the bench data dir', () => {
    expect(messages({ ...basePlan(), runDir: '/elsewhere/r' })).toContain(
      'runDir must lie strictly inside benchDataDir',
    );
    expect(messages({ ...basePlan(), runDir: '/bench' })).toContain(
      'runDir must lie strictly inside benchDataDir',
    );
  });

  it('refuses sources in the real ~/.ptah or outside the allowed roots', () => {
    const plan = basePlan();
    plan['fixtures'] = [
      { kind: 'database', source: '/home/dev/.ptah/state/ptah.sqlite' },
      { kind: 'file', source: '/tmp/x.jsonl', target: 'x.jsonl' },
    ];
    const found = messages(plan);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringContaining('lies in the real /home/dev/.ptah'),
        expect.stringContaining(
          '/tmp/x.jsonl is outside benchDataDir and committedFixturesDir',
        ),
      ]),
    );
  });

  it('refuses a cassette outside the allowed roots and a shared cassette file', () => {
    const plan = basePlan();
    plan['cassettes'] = {
      curator: { path: '/bench/c.jsonl', model: 'm' },
      laneRunner: { path: '/bench/c.jsonl', model: 'm' },
    };
    expect(messages(plan)).toContain(
      'the curator and lane-runner cassettes must be different files',
    );
    plan['cassettes'] = {
      curator: { path: '/home/dev/.ptah/c.jsonl', model: 'm' },
      laneRunner: { path: '/bench/l.jsonl', model: 'm' },
    };
    expect(messages(plan)).toEqual(
      expect.arrayContaining([expect.stringContaining('lies in the real')]),
    );
  });

  it('allows curator faults in replay only', () => {
    const plan = basePlan();
    plan['ci'] = false;
    plan['cassettes'] = {
      curator: {
        path: '/bench/c.jsonl',
        model: 'm',
        faults: { abc: 'timeout' },
      },
      laneRunner: { path: '/bench/l.jsonl', model: 'm' },
    };
    expect(schema.safeParse(plan).success).toBe(true);
    expect(messages({ ...plan, cassetteMode: 'record' })).toContain(
      'curator faults are replay-only',
    );
    const badFault = structuredClone(plan);
    (badFault['cassettes'] as { curator: { faults: unknown } }).curator.faults =
      { abc: 'explode' };
    expect(schema.safeParse(badFault).success).toBe(false);
  });

  it.each([
    '/abs/target',
    'C:\\abs\\target',
    '..\\escape',
    'a/../../escape',
    '.',
  ])('refuses fixture target %s', (target) => {
    const plan = basePlan();
    plan['fixtures'] = [{ kind: 'file', source: '/bench/f', target }];
    expect(messages(plan)).toContain(
      'must be a path relative to the isolated home without ".."',
    );
  });

  it('refuses two database fixtures, repeated targets and nested targets', () => {
    const plan = basePlan();
    plan['fixtures'] = [
      { kind: 'database', source: '/bench/a.sqlite' },
      { kind: 'database', source: '/bench/b.sqlite' },
      { kind: 'file', source: '/bench/f1', target: 'x/f' },
      { kind: 'file', source: '/bench/f2', target: 'x\\f' },
      { kind: 'directory', source: '/bench/d', target: 'x' },
    ];
    expect(messages(plan)).toEqual(
      expect.arrayContaining([
        'at most one database fixture',
        'target x\\f repeats fixture 2',
        'target x/f lies inside target x',
      ]),
    );
  });

  it('folds target case on win32 only', () => {
    const plan = basePlan();
    plan['fixtures'] = [
      { kind: 'file', source: '/bench/f1', target: 'A/f' },
      { kind: 'file', source: '/bench/f2', target: 'a/F' },
    ];
    expect(schema.safeParse(plan).success).toBe(true);
    const win = createMemorySkillsPlanSchema('win32').safeParse({
      ...plan,
      benchDataDir: 'C:\\bench',
      runDir: 'C:\\bench\\r',
      realHome: 'C:\\Users\\dev',
      committedFixturesDir: undefined,
      cassettes: {
        curator: { path: 'C:\\bench\\c.jsonl', model: 'm' },
        laneRunner: { path: 'C:\\bench\\l.jsonl', model: 'm' },
      },
      fixtures: [
        { kind: 'file', source: 'C:\\bench\\f1', target: 'A/f' },
        { kind: 'file', source: 'C:\\bench\\f2', target: 'a/F' },
      ],
    });
    expect(win.success).toBe(false);
  });

  it('refuses duplicate suite ids and malformed ids', () => {
    const plan = basePlan();
    plan['suites'] = [{ id: 's' }, { id: 's' }];
    expect(messages(plan)).toContain('suite s is listed twice');
    plan['suites'] = [{ id: 'Bad Id' }];
    expect(schema.safeParse(plan).success).toBe(false);
  });

  it('accepts scope-write first and the retention suites last', () => {
    const plan = basePlan();
    plan['suites'] = [
      { id: 'mem.scope.write' },
      { id: 'mem.liveness.audit' },
      { id: 'mem.ranking.roster' },
      { id: 'mem.retention.lifecycle' },
      { id: 'mem.retention.growth' },
    ];
    expect(schema.safeParse(plan).success).toBe(true);
  });

  it('refuses scope-write anywhere but first, and any suite after a retention suite', () => {
    const plan = basePlan();
    plan['suites'] = [{ id: 'mem.liveness.audit' }, { id: 'mem.scope.write' }];
    expect(messages(plan)).toContain(
      'suite mem.scope.write must be the first host suite: it measures a database no other suite has written',
    );
    plan['suites'] = [
      { id: 'mem.retention.growth' },
      { id: 'mem.search.fts-and' },
    ];
    expect(messages(plan)).toContain(
      'suite mem.search.fts-and must run before mem.retention.growth, which archives and deletes every row of the shared database',
    );
  });
});

describe('loadMemorySkillsPlan', () => {
  const planPath = '/bench/runs/run-2026-10-07.a/plan.json';
  const env = { [MEMORY_SKILLS_PLAN_ENV]: planPath };

  it('reads and validates the plan named by the env var', () => {
    const reads: string[] = [];
    const plan = loadMemorySkillsPlan({
      env,
      platform,
      readText: (path) => {
        reads.push(path);
        return JSON.stringify(basePlan());
      },
    });
    expect(reads).toEqual([planPath]);
    expect(plan.runId).toBe('run-2026-10-07.a');
    expect(plan.suites).toEqual([
      { id: 'mem.extraction.seeded', options: { k: 5 } },
    ]);
  });

  it('refuses a missing or relative env var without reading anything', () => {
    const readText = jest.fn();
    expect(() => loadMemorySkillsPlan({ env: {}, platform, readText })).toThrow(
      `${MEMORY_SKILLS_PLAN_ENV} is not set`,
    );
    expect(() =>
      loadMemorySkillsPlan({
        env: { [MEMORY_SKILLS_PLAN_ENV]: 'plan.json' },
        platform,
        readText,
      }),
    ).toThrow('must be an absolute path');
    expect(readText).not.toHaveBeenCalled();
  });

  it('wraps unreadable, non-JSON and invalid plans in MemorySkillsPlanError', () => {
    const load = (text: () => string): (() => unknown) => {
      return () => loadMemorySkillsPlan({ env, platform, readText: text });
    };
    expect(
      load(() => {
        throw new Error('ENOENT');
      }),
    ).toThrow(MemorySkillsPlanError);
    expect(load(() => '{not json')).toThrow(/cannot read plan/);
    expect(load(() => JSON.stringify({ schemaId: 'x' }))).toThrow(
      /invalid plan/,
    );
  });

  it('refuses a plan file outside its bench data dir', () => {
    expect(() =>
      loadMemorySkillsPlan({
        env: { [MEMORY_SKILLS_PLAN_ENV]: '/tmp/plan.json' },
        platform,
        readText: () => JSON.stringify(basePlan()),
      }),
    ).toThrow('must lie inside its benchDataDir /bench');
  });
});
