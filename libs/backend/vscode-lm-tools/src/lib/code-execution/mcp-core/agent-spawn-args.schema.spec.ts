import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import {
  AgentSpawnArgsSchema,
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
    });
    expect(parsed.success).toBe(true);
  });
});
