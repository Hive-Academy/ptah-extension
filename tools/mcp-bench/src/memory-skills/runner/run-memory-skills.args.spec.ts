import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseRunMemorySkillsArgs } from './run-memory-skills.args';

describe('parseRunMemorySkillsArgs', () => {
  const plan = join(tmpdir(), 'plan.json');

  it('parses a minimal --plan', () => {
    const parsed = parseRunMemorySkillsArgs(['--plan', plan]);
    expect(parsed.planPath).toBe(resolve(plan));
    expect(parsed.ci).toBe(false);
    expect(parsed.runId).toBeUndefined();
    expect(parsed.workspace).toBeUndefined();
    expect(parsed.hostScript).toBeUndefined();
    expect(parsed.hostCompletionTimeoutMs).toBeUndefined();
    expect(parsed.codexAuthSource).toBeUndefined();
  });

  it('parses every flag', () => {
    const workspace = join(tmpdir(), 'workspace');
    const hostScript = join(tmpdir(), 'memory-skills-host.mjs');
    const authSource = join(tmpdir(), 'auth.json');
    expect(
      parseRunMemorySkillsArgs([
        '--plan',
        plan,
        '--ci',
        '--run-id',
        'run-1',
        '--workspace',
        workspace,
        '--host-script',
        hostScript,
        '--host-timeout-ms',
        '1500',
        '--codex-auth-source',
        authSource,
      ]),
    ).toEqual({
      planPath: resolve(plan),
      ci: true,
      runId: 'run-1',
      workspace: resolve(workspace),
      hostScript: resolve(hostScript),
      hostCompletionTimeoutMs: 1500,
      codexAuthSource: resolve(authSource),
    });
  });

  it('accepts an absolute --codex-auth-source and resolves it', () => {
    const authSource = join(tmpdir(), 'auth.json');
    const parsed = parseRunMemorySkillsArgs([
      '--plan',
      plan,
      '--codex-auth-source',
      authSource,
    ]);
    expect(parsed.codexAuthSource).toBe(resolve(authSource));
  });

  it('rejects a relative --codex-auth-source', () => {
    expect(() =>
      parseRunMemorySkillsArgs([
        '--plan',
        plan,
        '--codex-auth-source',
        'auth.json',
      ]),
    ).toThrow('--codex-auth-source must be an absolute path, got auth.json');
  });

  it('reports usage when --plan is missing', () => {
    expect(() => parseRunMemorySkillsArgs([])).toThrow(
      'usage: bench-memory-skills --plan <absolute plan.json> [--ci]',
    );
  });

  it('rejects a bad --host-timeout-ms', () => {
    expect(() =>
      parseRunMemorySkillsArgs(['--plan', plan, '--host-timeout-ms', '0']),
    ).toThrow('--host-timeout-ms must be a positive integer, got 0');
  });

  it('rejects an unknown flag', () => {
    expect(() =>
      parseRunMemorySkillsArgs(['--plan', plan, '--not-a-flag']),
    ).toThrow(/Unknown option '--not-a-flag'/);
  });
});
