import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import { GATEWAY_TOKENS } from '@ptah-extension/messaging-gateway';
import { SKILL_REPROPAGATION_TOKEN } from '@ptah-extension/skill-synthesis';

import { registerThothLibraries } from './thoth/register-thoth-libraries';
import { CliSkillRepropagation } from './thoth/cli-skill-repropagation';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  };
}

function buildBaseContainer(): DependencyContainer {
  const c = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: makeLogger() });
  c.register(PLATFORM_TOKENS.TRACER, {
    useValue: {
      startSpan: <T>(_n: string, _o: unknown, fn: () => T): T => fn(),
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getConfiguration: jest.fn(() => ({ get: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  return c;
}

describe('registerThothLibraries — real Thoth registration', () => {
  let c: DependencyContainer;

  beforeEach(() => {
    c = buildBaseContainer();
    registerThothLibraries(c, c.resolve(TOKENS.LOGGER));
  });

  it('registers real MEMORY_READER resolving to a MemorySearchService (not the stub)', () => {
    expect(c.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_READER)).toBe(true);
    const reader = c.resolve<{
      constructor: { name: string };
      search: unknown;
    }>(MEMORY_CONTRACT_TOKENS.MEMORY_READER);
    expect(reader.constructor.name).toBe('MemorySearchService');
    expect(typeof reader.search).toBe('function');
  });

  it('registers real MEMORY_LISTER and SYMBOL_SINK tokens', () => {
    expect(c.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER)).toBe(true);
    expect(c.isRegistered(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)).toBe(true);
  });

  it('registers cron and gateway services', () => {
    expect(c.isRegistered(CRON_TOKENS.CRON_SCHEDULER)).toBe(true);
    expect(c.isRegistered(GATEWAY_TOKENS.GATEWAY_SERVICE)).toBe(true);
    expect(c.isRegistered(CRON_TOKENS.CRON_POWER_MONITOR)).toBe(true);
    expect(c.isRegistered(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT)).toBe(true);
  });

  it('registers SKILL_REPROPAGATION_TOKEN as CliSkillRepropagation', () => {
    expect(c.isRegistered(SKILL_REPROPAGATION_TOKEN)).toBe(true);
    const repropagation = c.resolve(SKILL_REPROPAGATION_TOKEN);
    expect(repropagation).toBeInstanceOf(CliSkillRepropagation);
  });

  it('does not register the no-op MEMORY_READER stub shape', async () => {
    const reader = c.resolve<{ constructor: { name: string } }>(
      MEMORY_CONTRACT_TOKENS.MEMORY_READER,
    );
    expect(reader.constructor.name).not.toBe('Object');
  });
});

describe('registerThothLibraries — per-subsystem degradation', () => {
  it('completes container setup when one track registration throws', () => {
    const c = buildBaseContainer();
    const logger = c.resolve<import('@ptah-extension/vscode-core').Logger>(
      TOKENS.LOGGER,
    );

    const realRegister = c.register.bind(c);
    const fakeRegister = (
      token: unknown,
      provider: unknown,
      options?: unknown,
    ): DependencyContainer => {
      if (token === CRON_TOKENS.CRON_POWER_MONITOR) {
        throw new Error('forced cron failure');
      }
      return (
        realRegister as (
          a: unknown,
          b: unknown,
          c?: unknown,
        ) => DependencyContainer
      )(token, provider, options);
    };
    const spy = jest
      .spyOn(c, 'register')
      .mockImplementation(fakeRegister as typeof c.register);

    expect(() => registerThothLibraries(c, logger)).not.toThrow();
    spy.mockRestore();

    expect(c.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_READER)).toBe(true);
    expect(c.isRegistered(GATEWAY_TOKENS.GATEWAY_SERVICE)).toBe(true);
    expect((logger.warn as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });
});
