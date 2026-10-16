import { OUTCOME_TASK_KINDS, SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import {
  AgentSpawnArgsSchema,
  MAX_EFFORT_LENGTH,
  MAX_TASK_LENGTH,
} from './agent-spawn-args.schema';

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
