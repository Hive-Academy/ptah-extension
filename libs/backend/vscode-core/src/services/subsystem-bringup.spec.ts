import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging';
import {
  bringUpSubsystems,
  registerCodeExecutionMcpForSubagents,
  startCodeExecutionMcp,
} from './subsystem-bringup';

/**
 * The two halves of MCP bring-up, and why they are two (TASK_2026_556).
 *
 * `ensureRegisteredForSubagents` waits on rival-CLI detection — seconds on a
 * warm machine, over 30 on a slow one. The Electron host awaited it in front of
 * its window, and that was the intermittent e2e start-up timeout. The start
 * half must therefore never wait on it; that is what these pin.
 */

interface RegistrationOutcome {
  registered?: boolean;
  reason?: string;
}

function createMcp(port: number | null = null) {
  let currentPort = port;
  return {
    start: jest.fn(async () => {
      currentPort = 51820;
      return 51820;
    }),
    getPort: jest.fn(() => currentPort),
    ensureRegisteredForSubagents: jest.fn<Promise<RegistrationOutcome>, []>(
      async () => ({ registered: true }),
    ),
  };
}

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function buildContainer(
  mcp: ReturnType<typeof createMcp> | null,
): DependencyContainer {
  const c = rootContainer.createChildContainer();
  if (mcp !== null) {
    c.register(TOKENS.CODE_EXECUTION_MCP, { useValue: mcp });
  }
  return c;
}

describe('startCodeExecutionMcp', () => {
  it('resolves without waiting on the subagent registration', async () => {
    const mcp = createMcp();
    // A registration that never settles — the shape of a CLI probe stalled on
    // its timeout. The start half must not even begin it.
    mcp.ensureRegisteredForSubagents.mockImplementation(
      () => new Promise<RegistrationOutcome>(() => undefined),
    );
    const onMcpPortChange = jest.fn();

    await startCodeExecutionMcp({
      container: buildContainer(mcp),
      logger: createLogger() as unknown as Logger,
      onMcpPortChange,
    });

    expect(mcp.start).toHaveBeenCalledTimes(1);
    expect(onMcpPortChange).toHaveBeenCalledWith(51820);
    expect(mcp.ensureRegisteredForSubagents).not.toHaveBeenCalled();
  });

  it('does not start a server that is already running', async () => {
    const mcp = createMcp(40000);

    await startCodeExecutionMcp({
      container: buildContainer(mcp),
      logger: createLogger() as unknown as Logger,
    });

    expect(mcp.start).not.toHaveBeenCalled();
  });

  it('logs and resolves when the start throws', async () => {
    const mcp = createMcp();
    mcp.start.mockRejectedValue(new Error('EADDRINUSE'));
    const logger = createLogger();

    await expect(
      startCodeExecutionMcp({
        container: buildContainer(mcp),
        logger: logger as unknown as Logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[SubsystemBringUp] MCP server start failed (non-fatal)',
      { error: 'EADDRINUSE' },
    );
  });

  it('is a no-op without a registered MCP service', async () => {
    await expect(
      startCodeExecutionMcp({
        container: buildContainer(null),
        logger: createLogger() as unknown as Logger,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('registerCodeExecutionMcpForSubagents', () => {
  it('reports an entry that was not written', async () => {
    const mcp = createMcp(51820);
    mcp.ensureRegisteredForSubagents.mockResolvedValue({
      registered: false,
      reason: 'lock-timeout',
    });
    const logger = createLogger();

    await registerCodeExecutionMcpForSubagents({
      container: buildContainer(mcp),
      logger: logger as unknown as Logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[SubsystemBringUp] MCP started but .mcp.json entry was not written',
      { reason: 'lock-timeout' },
    );
  });

  it('logs and resolves when the registration rejects', async () => {
    const mcp = createMcp(51820);
    mcp.ensureRegisteredForSubagents.mockRejectedValue(new Error('boom'));
    const logger = createLogger();

    await expect(
      registerCodeExecutionMcpForSubagents({
        container: buildContainer(mcp),
        logger: logger as unknown as Logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[SubsystemBringUp] MCP ensureRegisteredForSubagents failed (non-fatal)',
      { error: 'boom' },
    );
  });
});

describe('bringUpSubsystems', () => {
  it('still runs both halves, start first', async () => {
    const mcp = createMcp();
    const order: string[] = [];
    mcp.start.mockImplementation(async () => {
      order.push('start');
      return 51820;
    });
    mcp.ensureRegisteredForSubagents.mockImplementation(async () => {
      order.push('register');
      return { registered: true };
    });

    await bringUpSubsystems({
      container: buildContainer(mcp),
      logger: createLogger() as unknown as Logger,
    });

    expect(order).toEqual(['start', 'register']);
  });
});
