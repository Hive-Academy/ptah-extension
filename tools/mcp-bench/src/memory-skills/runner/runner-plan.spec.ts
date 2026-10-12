import {
  MemorySkillsRunError,
  RUNNER_PLAN_SCHEMA_ID,
  parseRunnerPlan,
} from './runner-plan';

const GROUND_TRUTH = {
  id: 'gt-memory@v1',
  paths: ['tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl'],
};

function entry(id: string): { id: string; groundTruth: typeof GROUND_TRUTH } {
  return { id, groundTruth: GROUND_TRUTH };
}

function planText(hostSuites: readonly string[]): string {
  return JSON.stringify({
    schemaId: RUNNER_PLAN_SCHEMA_ID,
    hostSuites: hostSuites.map(entry),
  });
}

describe('parseRunnerPlan: host suite placement', () => {
  it('accepts scope-write first and the retention suites last', () => {
    const plan = parseRunnerPlan(
      planText([
        'mem.scope.write',
        'mem.search.fts-and',
        'skill.backlog.audit',
        'mem.retention.lifecycle',
        'mem.retention.growth',
        'mem.ranking.roster',
      ]),
      'plan.json',
    );
    expect(plan.hostSuites).toHaveLength(6);
  });

  it('refuses scope-write after another host suite', () => {
    expect(() =>
      parseRunnerPlan(
        planText(['mem.search.fts-and', 'mem.scope.write']),
        'plan.json',
      ),
    ).toThrow(
      /suite mem\.scope\.write must be the first host suite: it measures a database no other suite has written/,
    );
  });

  it('refuses any non-retention suite after a retention suite', () => {
    let error: unknown;
    try {
      parseRunnerPlan(
        planText([
          'mem.retention.lifecycle',
          'mem.liveness.audit',
          'mem.retention.growth',
          'mem.scope.write',
        ]),
        'plan.json',
      );
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MemorySkillsRunError);
    const message = (error as Error).message;
    expect(message).toContain(
      'suite mem.liveness.audit must run before mem.retention.lifecycle, which archives and deletes every row of the shared database',
    );
    expect(message).toContain(
      'suite mem.scope.write must run before mem.retention.lifecycle',
    );
    expect(message).toContain(
      'suite mem.scope.write must be the first host suite',
    );
  });

  it('leaves offline suites out of the host ordering', () => {
    const text = JSON.stringify({
      schemaId: RUNNER_PLAN_SCHEMA_ID,
      hostSuites: [entry('mem.scope.write')],
      offlineSuites: [entry('skill.rubric.agreement')],
    });
    expect(parseRunnerPlan(text, 'plan.json').offlineSuites).toHaveLength(1);
  });
});

describe('parseRunnerPlan: shared funnel pass options', () => {
  function funnelPlan(capA: number, capB: number): string {
    return JSON.stringify({
      schemaId: RUNNER_PLAN_SCHEMA_ID,
      hostSuites: [
        { ...entry('skill.funnel.prefilter'), options: { capMs: capA } },
        { ...entry('skill.funnel.archaeology'), options: { capMs: capB } },
      ],
    });
  }

  it('accepts funnel stages that agree on the shared pass options', () => {
    expect(
      parseRunnerPlan(funnelPlan(5000, 5000), 'plan.json').hostSuites,
    ).toHaveLength(2);
  });

  it('refuses funnel stages that disagree on the shared pass options', () => {
    expect(() => parseRunnerPlan(funnelPlan(5000, 9000), 'plan.json')).toThrow(
      MemorySkillsRunError,
    );
  });
});

describe('parseRunnerPlan settings', () => {
  function text(settings: unknown): string {
    return JSON.stringify({
      schemaId: RUNNER_PLAN_SCHEMA_ID,
      settings,
    });
  }

  it('accepts ptah-relative settings, including the oauth endpoint key', () => {
    const plan = parseRunnerPlan(
      text({
        'memory.curatorProvider': 'openai-codex',
        'memory.curatorModel': 'gpt-5.6-terra',
        'skillSynthesis.judge.replay': false,
        'provider.openai-codex.oauthTokenEndpoint':
          'http://127.0.0.1:9/oauth/token',
      }),
      'plan.json',
    );
    expect(plan.settings).toEqual({
      'memory.curatorProvider': 'openai-codex',
      'memory.curatorModel': 'gpt-5.6-terra',
      'skillSynthesis.judge.replay': false,
      'provider.openai-codex.oauthTokenEndpoint':
        'http://127.0.0.1:9/oauth/token',
    });
  });

  it('rejects secret-like keys and non-scalar values', () => {
    expect(() =>
      parseRunnerPlan(text({ 'memory.apiKey': 'x' }), 'plan.json'),
    ).toThrow(/setting memory\.apiKey looks like a secret/);
    expect(() =>
      parseRunnerPlan(text({ 'provider.token': 'x' }), 'plan.json'),
    ).toThrow(/looks like a secret/);
    expect(() =>
      parseRunnerPlan(text({ nested: { a: 1 } }), 'plan.json'),
    ).toThrow(MemorySkillsRunError);
  });

  it('omits settings when the plan does not carry them', () => {
    const plan = parseRunnerPlan(
      JSON.stringify({ schemaId: RUNNER_PLAN_SCHEMA_ID }),
      'plan.json',
    );
    expect(plan.settings).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain('settings');
  });
});
