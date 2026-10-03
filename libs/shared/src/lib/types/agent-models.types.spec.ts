/**
 * The C6 classification contract. The UI, the save handler and emission all
 * rely on these rules, so each case below is a decision one of them acts on:
 * whether a value may be saved, needs confirmation, or is written to a copy.
 */
import {
  AGENT_MODEL_PROVIDERS,
  classifyAgentModelValue,
  isAgentModelEmittable,
  providerReported,
  resolveAgentModel,
  type AgentModelClass,
  type AgentModelEntry,
  type AgentModelLayers,
  type AgentModelProvider,
} from './agent-models.types';

const live = (...ids: string[]): AgentModelEntry[] => ids.map((id) => ({ id }));
const fallback = (...ids: string[]): AgentModelEntry[] =>
  ids.map((id) => ({ id, isFallback: true }));

/** A syntactically valid, unlisted value per provider. */
const VALID: Record<AgentModelProvider, string> = {
  claude: 'sonnet',
  codex: 'gpt-5-codex',
  copilot: 'claude-sonnet-4.5',
  cursor: 'auto',
  opencode: 'anthropic/claude-sonnet-4-5',
};

/** A value failing each provider's syntax (no control characters). */
const SYNTAX_FAILING: Record<AgentModelProvider, string> = {
  claude: 'claude-opus-4',
  codex: 'gpt 5',
  copilot: 'gpt 5',
  cursor: 'gpt 5',
  opencode: 'claude-sonnet',
};

const ACCEPTED: readonly AgentModelClass[] = [
  'listed',
  'unlisted',
  'unverifiable',
];

describe('providerReported', () => {
  it('drops fallback entries and keeps live ones', () => {
    expect(
      providerReported([
        ...live('a'),
        ...fallback('b'),
        { id: 'c', isFallback: false },
      ]),
    ).toEqual([{ id: 'a' }, { id: 'c', isFallback: false }]);
  });

  it('treats a null or fallback-only list as unavailable (empty)', () => {
    expect(providerReported(null)).toEqual([]);
    expect(providerReported(fallback('x', 'y'))).toEqual([]);
  });
});

describe('classifyAgentModelValue — every class per provider', () => {
  describe.each(AGENT_MODEL_PROVIDERS)('%s', (provider) => {
    const valid = VALID[provider];

    it.each(['', '   ', '\t'])('blank %p → empty', (value) => {
      expect(classifyAgentModelValue(provider, value, live(valid))).toBe(
        'empty',
      );
    });

    it.each([`${valid}\n`, `${valid}\r`, `x\u0000y`, `${valid}\u2028`])(
      'control character in %p → malformed, even when listed',
      (value) => {
        expect(classifyAgentModelValue(provider, value, live(value))).toBe(
          'malformed',
        );
      },
    );

    it('exact provider-reported id → listed', () => {
      expect(
        classifyAgentModelValue(provider, valid, live('other', valid)),
      ).toBe('listed');
    });

    it('syntax failure, not listed → malformed', () => {
      expect(
        classifyAgentModelValue(
          provider,
          SYNTAX_FAILING[provider],
          live('other'),
        ),
      ).toBe('malformed');
      expect(
        classifyAgentModelValue(provider, SYNTAX_FAILING[provider], null),
      ).toBe('malformed');
    });

    it('valid syntax, provider list present but not on it → unlisted', () => {
      expect(classifyAgentModelValue(provider, valid, live('other'))).toBe(
        'unlisted',
      );
    });

    it('valid syntax, no provider list → unverifiable', () => {
      expect(classifyAgentModelValue(provider, valid, null)).toBe(
        'unverifiable',
      );
      expect(classifyAgentModelValue(provider, valid, [])).toBe('unverifiable');
    });

    it('fallback-only id is never listed (mixed list → unlisted)', () => {
      const mixed = [...live('other'), ...fallback(valid)];
      expect(classifyAgentModelValue(provider, valid, mixed)).toBe('unlisted');
    });

    it('fallback-only list counts as no list → unverifiable', () => {
      expect(classifyAgentModelValue(provider, valid, fallback(valid))).toBe(
        'unverifiable',
      );
    });
  });

  it.each(['codex', 'copilot', 'cursor', 'claude'] as const)(
    'listed-but-syntax-failing %s value → listed (no syntax check on listed ids)',
    (provider) => {
      const value = SYNTAX_FAILING[provider];
      expect(classifyAgentModelValue(provider, value, live(value))).toBe(
        'listed',
      );
    },
  );

  it('OpenCode listed-but-malformed → malformed (emission needs provider/model)', () => {
    expect(
      classifyAgentModelValue(
        'opencode',
        'claude-sonnet',
        live('claude-sonnet'),
      ),
    ).toBe('malformed');
  });

  it.each([
    ['anthropic/claude-sonnet-4-5', 'unverifiable'],
    ['openrouter/meta/llama-3', 'unverifiable'],
    ['/model', 'malformed'],
    ['provider/', 'malformed'],
    ['pro vider/model', 'malformed'],
    ['provider/mo del', 'malformed'],
  ] as const)('OpenCode syntax: %p → %s', (value, expected) => {
    expect(classifyAgentModelValue('opencode', value, null)).toBe(expected);
  });

  it.each(['opus', 'sonnet', 'haiku', 'inherit'])(
    'Claude alias %p → unverifiable without a list',
    (value) => {
      expect(classifyAgentModelValue('claude', value, null)).toBe(
        'unverifiable',
      );
    },
  );

  it.each(['Opus', ' opus', 'opus ', 'claude-opus-4-1'])(
    'Claude non-alias %p → malformed',
    (value) => {
      expect(classifyAgentModelValue('claude', value, null)).toBe('malformed');
    },
  );
});

describe('isAgentModelEmittable', () => {
  it.each(AGENT_MODEL_PROVIDERS)(
    '%s: blank and control characters are not emittable',
    (provider) => {
      expect(isAgentModelEmittable(provider, '')).toBe(false);
      expect(isAgentModelEmittable(provider, '  ')).toBe(false);
      expect(isAgentModelEmittable(provider, `${VALID[provider]}\n`)).toBe(
        false,
      );
      expect(isAgentModelEmittable(provider, VALID[provider])).toBe(true);
    },
  );

  it('non-OpenCode syntax failures stay emittable (listed ids are written as-is)', () => {
    expect(isAgentModelEmittable('codex', SYNTAX_FAILING.codex)).toBe(true);
    expect(isAgentModelEmittable('claude', SYNTAX_FAILING.claude)).toBe(true);
  });

  it('OpenCode requires provider/model to be emittable', () => {
    expect(isAgentModelEmittable('opencode', 'claude-sonnet')).toBe(false);
    expect(
      isAgentModelEmittable('opencode', 'anthropic/claude-sonnet-4-5'),
    ).toBe(true);
  });
});

describe('invariant: classify accepts ⇒ emittable', () => {
  // Every class is produced for every provider by some value/list pair below.
  const cases = AGENT_MODEL_PROVIDERS.flatMap((provider) => {
    const valid = VALID[provider];
    const bad = SYNTAX_FAILING[provider];
    const pairs: Array<[string, AgentModelEntry[] | null]> = [
      ['', null],
      ['  ', live('x')],
      [`${valid}\n`, live(`${valid}\n`)],
      [bad, null],
      [bad, live(bad)],
      [bad, fallback(bad)],
      [valid, live(valid)],
      [valid, live('other')],
      [valid, [...live('other'), ...fallback(valid)]],
      [valid, null],
      [valid, fallback(valid)],
    ];
    return pairs.map(([value, list]) => ({ provider, value, list }));
  });

  it('covers every class for every provider', () => {
    for (const provider of AGENT_MODEL_PROVIDERS) {
      const seen = new Set(
        cases
          .filter((c) => c.provider === provider)
          .map((c) => classifyAgentModelValue(c.provider, c.value, c.list)),
      );
      expect([...seen].sort()).toEqual([
        'empty',
        'listed',
        'malformed',
        'unlisted',
        'unverifiable',
      ]);
    }
  });

  it.each(cases)('$provider %j', ({ provider, value, list }) => {
    const cls = classifyAgentModelValue(provider, value, list);
    if (ACCEPTED.includes(cls)) {
      expect(isAgentModelEmittable(provider, value)).toBe(true);
    }
  });
});

describe('resolveAgentModel', () => {
  const full: AgentModelLayers = {
    workspace: {
      planner: { claude: 'opus', codex: 'ws-planner' },
      '*': { claude: 'haiku', codex: 'ws-star' },
    },
    machine: {
      planner: { claude: 'sonnet', codex: 'm-planner' },
      '*': { claude: 'inherit', codex: 'm-star' },
    },
  };

  /** Drop one precedence step at a time to expose the next. */
  const without = (
    provider: AgentModelProvider,
    drop: Array<['workspace' | 'machine', string]>,
  ): AgentModelLayers => {
    const clone = JSON.parse(JSON.stringify(full)) as Required<{
      [K in keyof AgentModelLayers]: Record<string, Record<string, string>>;
    }>;
    for (const [scope, key] of drop) delete clone[scope][key][provider];
    return clone;
  };

  describe.each([
    ['claude', ['opus', 'haiku', 'sonnet', 'inherit']],
    ['codex', ['ws-planner', 'ws-star', 'm-planner', 'm-star']],
  ] as const)('%s precedence', (provider, [wsSlug, wsStar, mSlug, mStar]) => {
    it('workspace[slug] wins', () => {
      expect(resolveAgentModel(full, 'planner', provider)).toEqual({
        value: wsSlug,
        scope: 'workspace',
        wildcard: false,
      });
    });

    it("then workspace['*']", () => {
      const layers = without(provider, [['workspace', 'planner']]);
      expect(resolveAgentModel(layers, 'planner', provider)).toEqual({
        value: wsStar,
        scope: 'workspace',
        wildcard: true,
      });
    });

    it('then machine[slug]', () => {
      const layers = without(provider, [
        ['workspace', 'planner'],
        ['workspace', '*'],
      ]);
      expect(resolveAgentModel(layers, 'planner', provider)).toEqual({
        value: mSlug,
        scope: 'machine',
        wildcard: false,
      });
    });

    it("then machine['*']", () => {
      const layers = without(provider, [
        ['workspace', 'planner'],
        ['workspace', '*'],
        ['machine', 'planner'],
      ]);
      expect(resolveAgentModel(layers, 'planner', provider)).toEqual({
        value: mStar,
        scope: 'machine',
        wildcard: true,
      });
    });

    it('nothing set → undefined', () => {
      const layers = without(provider, [
        ['workspace', 'planner'],
        ['workspace', '*'],
        ['machine', 'planner'],
        ['machine', '*'],
      ]);
      expect(resolveAgentModel(layers, 'planner', provider)).toBeUndefined();
    });

    it('an agent without its own entry gets the workspace wildcard', () => {
      expect(resolveAgentModel(full, 'reviewer', provider)?.value).toBe(wsStar);
    });
  });

  it('never crosses providers: a Claude value does not apply to Codex', () => {
    const layers: AgentModelLayers = {
      workspace: { planner: { claude: 'opus' } },
      machine: { '*': { claude: 'sonnet' } },
    };
    expect(resolveAgentModel(layers, 'planner', 'codex')).toBeUndefined();
    expect(resolveAgentModel(layers, 'planner', 'opencode')).toBeUndefined();
    expect(resolveAgentModel(layers, 'planner', 'claude')?.value).toBe('opus');
  });

  it('a workspace value for another provider does not shadow the machine value', () => {
    const layers: AgentModelLayers = {
      workspace: { planner: { claude: 'opus' } },
      machine: { planner: { codex: 'gpt-5' } },
    };
    expect(resolveAgentModel(layers, 'planner', 'codex')).toEqual({
      value: 'gpt-5',
      scope: 'machine',
      wildcard: false,
    });
  });

  describe('malformed settings are ignored, never thrown on', () => {
    const machine = { '*': { codex: 'm-star' } };
    it.each<[string, unknown]>([
      ['null layer', null],
      ['string layer', 'gpt-5'],
      ['array layer', [{ codex: 'x' }]],
      ['number slug entry', { planner: 42 }],
      ['array slug entry', { planner: ['x'] }],
      ['null slug entry', { planner: null }],
      ['number leaf', { planner: { codex: 5 } }],
      ['object leaf', { planner: { codex: { id: 'x' } } }],
      ['blank leaf', { planner: { codex: '   ' } }],
    ])('%s in the workspace layer falls through', (_label, workspace) => {
      const layers = { workspace, machine } as unknown as AgentModelLayers;
      expect(() => resolveAgentModel(layers, 'planner', 'codex')).not.toThrow();
      expect(resolveAgentModel(layers, 'planner', 'codex')?.value).toBe(
        'm-star',
      );
    });

    it.each<unknown>([null, undefined, 'x', 7, []])(
      'layers %p → undefined',
      (layers) => {
        expect(
          resolveAgentModel(layers as AgentModelLayers, 'planner', 'codex'),
        ).toBeUndefined();
      },
    );

    it('inherited object keys never resolve as slugs or providers', () => {
      const layers: AgentModelLayers = { workspace: {}, machine: {} };
      expect(resolveAgentModel(layers, 'constructor', 'codex')).toBeUndefined();
      expect(resolveAgentModel(layers, '__proto__', 'codex')).toBeUndefined();
      expect(
        resolveAgentModel(
          { workspace: { planner: {} } },
          'planner',
          'toString' as AgentModelProvider,
        ),
      ).toBeUndefined();
    });
  });

  it('returns control-character values unchanged so emission can warn and skip', () => {
    const layers: AgentModelLayers = {
      workspace: { planner: { codex: 'a\nb' } },
    };
    const resolved = resolveAgentModel(layers, 'planner', 'codex');
    expect(resolved?.value).toBe('a\nb');
    expect(isAgentModelEmittable('codex', resolved?.value ?? '')).toBe(false);
  });
});
