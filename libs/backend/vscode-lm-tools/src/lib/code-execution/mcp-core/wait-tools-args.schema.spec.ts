// `@ptah-extension/cli-agent-runtime`'s barrel (the source of the wait
// ceiling) reaches tsyringe decorators on import.
import 'reflect-metadata';
import { MAX_AGENT_WAIT_MS } from '@ptah-extension/cli-agent-runtime';
import {
  AgentWaitArgsSchema,
  DEFAULT_AGENT_WAIT_TIMEOUT_SEC,
  DEFAULT_RUN_CHECK_TIMEOUT_SEC,
  MAX_WAIT_AGENT_IDS,
  MAX_WAIT_TIMEOUT_SEC,
  RunCheckArgsSchema,
  WAIT_SUMMARY_MAX_CHARS,
} from './wait-tools-args.schema';

describe('wait tool constants', () => {
  it('keeps the reply bound at half the 8,000-char result budget', () => {
    expect(WAIT_SUMMARY_MAX_CHARS).toBe(4_000);
    expect(MAX_WAIT_TIMEOUT_SEC).toBe(900);
  });

  it('takes the wait ceiling from the runtime clamp, so the two cannot drift', () => {
    expect(MAX_WAIT_TIMEOUT_SEC * 1000).toBe(MAX_AGENT_WAIT_MS);
    expect(Number.isInteger(MAX_WAIT_TIMEOUT_SEC)).toBe(true);
  });
});

describe('AgentWaitArgsSchema', () => {
  it('applies the defaults', () => {
    expect(AgentWaitArgsSchema.parse({ agentIds: ['a'] })).toEqual({
      agentIds: ['a'],
      mode: 'all',
      timeoutSec: DEFAULT_AGENT_WAIT_TIMEOUT_SEC,
    });
  });

  it('accepts any/all and a timeout of 0..900', () => {
    expect(
      AgentWaitArgsSchema.safeParse({
        agentIds: ['a'],
        mode: 'any',
        timeoutSec: 0,
      }).success,
    ).toBe(true);
    expect(
      AgentWaitArgsSchema.safeParse({ agentIds: ['a'], timeoutSec: 900 })
        .success,
    ).toBe(true);
  });

  it.each([
    ['no ids', { agentIds: [] }],
    ['a blank id', { agentIds: ['  '] }],
    [
      'too many ids',
      {
        agentIds: Array.from(
          { length: MAX_WAIT_AGENT_IDS + 1 },
          (_, i) => `a${i}`,
        ),
      },
    ],
    ['an unknown mode', { agentIds: ['a'], mode: 'first' }],
    ['a timeout over 900', { agentIds: ['a'], timeoutSec: 901 }],
    ['a negative timeout', { agentIds: ['a'], timeoutSec: -1 }],
    ['a fractional timeout', { agentIds: ['a'], timeoutSec: 1.5 }],
    ['an unknown key', { agentIds: ['a'], poll: true }],
  ])('rejects %s', (_label, input) => {
    expect(AgentWaitArgsSchema.safeParse(input).success).toBe(false);
  });
});

describe('RunCheckArgsSchema', () => {
  it('applies the default timeout and dedupes targets', () => {
    expect(
      RunCheckArgsSchema.parse({
        project: '@ptah-extension/shared',
        targets: ['lint', 'test', 'lint'],
      }),
    ).toEqual({
      project: '@ptah-extension/shared',
      targets: ['lint', 'test'],
      timeoutSec: DEFAULT_RUN_CHECK_TIMEOUT_SEC,
    });
  });

  it.each(['my-app', '@scope/lib', 'a.b_c', 'x'.repeat(120)])(
    'accepts project %s',
    (project) => {
      expect(
        RunCheckArgsSchema.safeParse({ project, targets: ['build'] }).success,
      ).toBe(true);
    },
  );

  it.each([
    ['', 'empty'],
    ['x'.repeat(121), 'over 120 chars'],
    ['app; rm -rf /', 'shell metacharacters'],
    ['app name', 'a space'],
    ['$(whoami)', 'command substitution'],
    ['--help', 'a leading dash (option injection)'],
    ['-p', 'a bare option'],
  ])('rejects project %j (%s)', (project) => {
    expect(
      RunCheckArgsSchema.safeParse({ project, targets: ['test'] }).success,
    ).toBe(false);
  });

  it.each([
    ['no targets', []],
    ['an unknown target', ['serve']],
    ['a target with an argument', ['test --watch']],
  ])('rejects %s', (_label, targets) => {
    expect(
      RunCheckArgsSchema.safeParse({ project: 'app', targets }).success,
    ).toBe(false);
  });

  it('rejects a timeout outside 1..900 and unknown keys', () => {
    for (const timeoutSec of [0, 901, 2.5]) {
      expect(
        RunCheckArgsSchema.safeParse({
          project: 'app',
          targets: ['test'],
          timeoutSec,
        }).success,
      ).toBe(false);
    }
    expect(
      RunCheckArgsSchema.safeParse({
        project: 'app',
        targets: ['test'],
        cwd: '/etc',
      }).success,
    ).toBe(false);
  });
});
