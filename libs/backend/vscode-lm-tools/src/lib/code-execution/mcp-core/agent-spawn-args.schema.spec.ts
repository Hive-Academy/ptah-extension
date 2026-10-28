import 'reflect-metadata';
import { OUTCOME_TASK_KINDS, SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import {
  AGENT_SPAWN_ACCOUNT_CLI,
  AgentSpawnArgsSchema,
  MAX_EFFORT_LENGTH,
  MAX_TASK_LENGTH,
  agentSpawnAccountRefusal,
} from './agent-spawn-args.schema';
import { buildAgentSpawnTool } from './tool-description.builder';
import { HELP_DOCS } from '../namespace-builders/system-namespace.builders';

describe('AgentSpawnArgsSchema', () => {
  it('keeps the 100 KiB task ceiling', () => {
    expect(MAX_TASK_LENGTH).toBe(100 * 1024);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 'x'.repeat(MAX_TASK_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 'x'.repeat(MAX_TASK_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('requires a non-empty task', () => {
    expect(AgentSpawnArgsSchema.safeParse({}).success).toBe(false);
    expect(AgentSpawnArgsSchema.safeParse({ task: '' }).success).toBe(false);
  });

  it.each([...SYSTEM_CLI_TYPES])('accepts cli: %s', (cli) => {
    expect(AgentSpawnArgsSchema.safeParse({ task: 't', cli }).success).toBe(
      true,
    );
  });

  it('rejects a cli outside SYSTEM_CLI_TYPES', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', cli: 'aider' }).success,
    ).toBe(false);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', cli: 'ptah-cli' }).success,
    ).toBe(false);
  });

  it('accepts a zero or large timeout and rejects a negative one', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', timeout: 0 }).success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', timeout: 36_000_000 })
        .success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', timeout: -1 }).success,
    ).toBe(false);
  });

  it('accepts a role of 1 to 100 characters', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', role: 'reviewer' }).success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', role: 'r'.repeat(100) })
        .success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', role: '' }).success,
    ).toBe(false);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', role: 'r'.repeat(101) })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown key instead of dropping it', () => {
    const parsed = AgentSpawnArgsSchema.safeParse({
      task: 't',
      roleDefinition: { name: 'x' },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts only a boolean force override', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', force: true }).success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', force: false }).success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', force: 'true' }).success,
    ).toBe(false);
  });

  it('accepts the full documented shape', () => {
    const parsed = AgentSpawnArgsSchema.safeParse({
      task: 't',
      cli: SYSTEM_CLI_TYPES[0],
      ptahCliId: 'p-1',
      workingDirectory: 'sub',
      timeout: 1000,
      files: ['a.ts'],
      taskFolder: '.ptah/specs/X',
      model: 'm',
      modelTier: 'haiku',
      resume_session_id: 's-1',
      role: 'architect',
      effort: 'high',
      taskKind: 'review',
      routingSource: 'ranking',
      force: true,
    });
    expect(parsed.success).toBe(true);
  });

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'off'])(
    'accepts effort: %s',
    (effort) => {
      const parsed = AgentSpawnArgsSchema.safeParse({ task: 't', effort });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.effort).toBe(effort);
    },
  );

  it('keeps an effort no CLI takes, so the lane policy can log it as ignored', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', effort: 'ultra' }).success,
    ).toBe(true);
  });

  it('bounds effort to 1..MAX_EFFORT_LENGTH characters', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({
        task: 't',
        effort: 'e'.repeat(MAX_EFFORT_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({
        task: 't',
        effort: 'e'.repeat(MAX_EFFORT_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', effort: '' }).success,
    ).toBe(false);
  });

  it.each([
    ['a number', 3],
    ['a boolean', true],
    ['null', null],
    ['an array', ['high']],
    ['an object', { level: 'high' }],
  ])('rejects effort as %s', (_label, effort) => {
    expect(AgentSpawnArgsSchema.safeParse({ task: 't', effort }).success).toBe(
      false,
    );
  });

  it.each([...OUTCOME_TASK_KINDS])('accepts taskKind: %s', (taskKind) => {
    const parsed = AgentSpawnArgsSchema.safeParse({ task: 't', taskKind });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.taskKind).toBe(taskKind);
  });

  it('rejects a taskKind outside OUTCOME_TASK_KINDS', () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', taskKind: 'deploy' }).success,
    ).toBe(false);
  });

  it.each(['model', 'ranking', 'pin'])(
    'accepts routingSource: %s',
    (routingSource) => {
      const parsed = AgentSpawnArgsSchema.safeParse({
        task: 't',
        routingSource,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.routingSource).toBe(routingSource);
    },
  );

  it("rejects routingSource: 'not-routed' — that value is recorded at write time", () => {
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', routingSource: 'not-routed' })
        .success,
    ).toBe(false);
  });

  it('leaves taskKind and routingSource unset when the caller did not route the lane', () => {
    const parsed = AgentSpawnArgsSchema.safeParse({ task: 't' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.taskKind).toBeUndefined();
    expect(parsed.success && parsed.data.routingSource).toBeUndefined();
  });
});

/**
 * Optional account selection on spawn (TASK_2026_712 Batch 28b, TASK_2026_719
 * Batch 18). A named value is accepted on a fresh claude spawn and the runtime
 * admits it; a resume never takes one, so a supplied account cannot replace
 * the stored one.
 */
describe('AgentSpawnArgsSchema — accountSelection', () => {
  const NAMED = { kind: 'named', profileId: 'profile-0001' } as const;

  function issueMessages(args: Record<string, unknown>): string[] {
    const parsed = AgentSpawnArgsSchema.safeParse({ task: 't', ...args });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  }

  it('is optional, so existing callers are unchanged', () => {
    expect(AgentSpawnArgsSchema.safeParse({ task: 't' }).success).toBe(true);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', cli: 'claude' }).success,
    ).toBe(true);
  });

  it('names claude as the only account-taking lane, from the tuple', () => {
    expect(SYSTEM_CLI_TYPES).toContain(AGENT_SPAWN_ACCOUNT_CLI);
  });

  it.each([{ kind: 'ambient' }, { kind: 'omitted' }])(
    'accepts %o for a claude lane and carries it through parsing',
    (accountSelection) => {
      const parsed = AgentSpawnArgsSchema.safeParse({
        task: 't',
        cli: 'claude',
        accountSelection,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.accountSelection).toEqual(
        accountSelection,
      );
      // Survives the JSON hop the stdio transport makes.
      expect(
        AgentSpawnArgsSchema.parse(JSON.parse(JSON.stringify(parsed.data)))
          .accountSelection,
      ).toEqual(accountSelection);
    },
  );

  it('accepts an ambient selection on a claude resume', () => {
    expect(
      issueMessages({
        cli: 'claude',
        resume_session_id: 'sdk-session-1',
        accountSelection: { kind: 'ambient' },
      }),
    ).toEqual([]);
  });

  it('accepts a named account on a fresh claude spawn and carries it through', () => {
    const parsed = AgentSpawnArgsSchema.safeParse({
      task: 't',
      cli: 'claude',
      accountSelection: NAMED,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.accountSelection).toEqual(NAMED);
    expect(
      AgentSpawnArgsSchema.parse(JSON.parse(JSON.stringify(parsed.data)))
        .accountSelection,
    ).toEqual(NAMED);
  });

  it.each(SYSTEM_CLI_TYPES.filter((cli) => cli !== AGENT_SPAWN_ACCOUNT_CLI))(
    'refuses a named account for cli %s',
    (cli) => {
      expect(issueMessages({ cli, accountSelection: NAMED })).toEqual([
        expect.stringMatching(/applies only to cli "claude"/),
      ]);
    },
  );

  it('refuses a named account on a Ptah CLI agent or an auto-detected lane', () => {
    expect(
      issueMessages({
        cli: 'claude',
        ptahCliId: 'agent-a',
        accountSelection: NAMED,
      }),
    ).toEqual([expect.stringMatching(/applies only to cli "claude"/)]);
    expect(issueMessages({ accountSelection: NAMED })).toEqual([
      expect.stringMatching(/applies only to cli "claude"/),
    ]);
  });

  it('refuses a named account on resume rather than override the stored one', () => {
    expect(
      issueMessages({
        cli: 'claude',
        resume_session_id: 'sdk-session-1',
        accountSelection: NAMED,
      }),
    ).toEqual([expect.stringMatching(/keeps the account stored/)]);
  });

  it.each(SYSTEM_CLI_TYPES.filter((cli) => cli !== AGENT_SPAWN_ACCOUNT_CLI))(
    'refuses a selection for cli %s',
    (cli) => {
      expect(
        issueMessages({ cli, accountSelection: { kind: 'ambient' } }),
      ).toEqual([expect.stringMatching(/applies only to cli "claude"/)]);
    },
  );

  it('refuses a selection without cli or with ptahCliId', () => {
    expect(
      issueMessages({ accountSelection: { kind: 'ambient' } }),
    ).toHaveLength(1);
    expect(
      issueMessages({
        cli: 'claude',
        ptahCliId: 'agent-a',
        accountSelection: { kind: 'ambient' },
      }),
    ).toHaveLength(1);
  });

  it.each([
    ['null', null],
    ['an unknown kind', { kind: 'default' }],
    ['a path', { kind: 'ambient', configDir: '/home/u/.claude' }],
    ['an env bag', { ...NAMED, env: { CLAUDE_CONFIG_DIR: '/x' } }],
    ['a token', { kind: 'ambient', token: 'secret' }],
    ['an owner', { ...NAMED, owner: 'verified' }],
    ['a malformed profile id', { kind: 'named', profileId: '../x' }],
    ['a named value without an id', { kind: 'named' }],
  ])('rejects %s', (_label, accountSelection) => {
    expect(
      AgentSpawnArgsSchema.safeParse({
        task: 't',
        cli: 'claude',
        accountSelection,
      }).success,
    ).toBe(false);
  });

  it('shares its refusal rule with the execute_code boundary', () => {
    expect(
      agentSpawnAccountRefusal({ cli: 'claude', accountSelection: NAMED }),
    ).toBeUndefined();
    // An empty resume id resumes nothing, so it is a fresh spawn.
    expect(
      agentSpawnAccountRefusal({
        cli: 'claude',
        resumeSessionId: '',
        accountSelection: NAMED,
      }),
    ).toBeUndefined();
    expect(
      agentSpawnAccountRefusal({
        cli: 'claude',
        resumeSessionId: 'sdk-session-1',
        accountSelection: NAMED,
      }),
    ).toMatch(/keeps the account stored/);
    expect(
      agentSpawnAccountRefusal({ cli: 'codex', accountSelection: NAMED }),
    ).toMatch(/applies only to cli "claude"/);
    expect(agentSpawnAccountRefusal({ cli: 'codex' })).toBeUndefined();
  });
});

describe('spawn descriptions stay truthful about the claude lane', () => {
  const spawn = buildAgentSpawnTool();
  const properties = spawn.inputSchema.properties as Record<
    string,
    { description?: string }
  >;

  it('advertises accountSelection for claude only, with no id, email or path', () => {
    const text = properties['accountSelection'].description ?? '';
    expect(text).toContain('only with cli "claude"');
    expect(text).toContain('"kind":"named"');
    expect(text).not.toMatch(/profile-\d|@|[/\\]/);
    expect(text).not.toMatch(/release/i);
  });

  it('says modelTier is Ptah CLI only and names the claude SDK lane', () => {
    expect(properties['modelTier'].description).toContain(
      'including cli "claude"',
    );
    const cli = properties['cli'].description ?? '';
    expect(cli).toContain('Claude Agent SDK session');
    expect(cli).toContain('over MCP');
  });

  it('documents the derived roster and the account field for ptah.agent', () => {
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(HELP_DOCS['agent']).toContain(`'${cli}'`);
      expect(HELP_DOCS['orchestration']).toContain(cli);
    }
    expect(HELP_DOCS['agent']).toContain('accountSelection?');
    expect(HELP_DOCS['orchestration']).not.toContain('Available CLI agents:');
  });
});
