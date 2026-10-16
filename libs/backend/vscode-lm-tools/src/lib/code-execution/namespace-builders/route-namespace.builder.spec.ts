import 'reflect-metadata';
import type { LaneLimitResult } from '@ptah-extension/cli-agent-runtime';
import {
  LANE_ROUTING_TOKENS,
  type RouteCandidateSource,
  type RouteDecideArgs,
  type RouteDecideResult,
  type RouteDecideService,
} from '@ptah-extension/lane-routing';
import type {
  CliDetectionResult,
  LaneLimitState,
} from '@ptah-extension/shared';
import type { AgentNamespace } from '../types';
import {
  ROUTING_UNAVAILABLE_MESSAGE,
  RoutingUnavailableError,
  buildRouteNamespace,
  resolveRouteDecideService,
  type RouteServiceLocator,
} from './route-namespace.builder';

const ARGS: RouteDecideArgs = {
  stage: 'pre-flight',
  request: 'ship the parser',
};

const RESULT: RouteDecideResult = {
  stage: 'pre-flight',
  taskType: {
    value: null,
    source: 'skill-table',
    confidence: null,
    fallbackCause: null,
    modelProposal: null,
  },
  depth: {
    value: null,
    source: 'skill-table',
    confidence: null,
    fallbackCause: null,
    modelProposal: null,
  },
  overallConfidence: null,
  reasons: [],
  usage: {
    requests: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
  },
};

function cliRow(
  cli: CliDetectionResult['cli'],
  ptahCliId?: string,
): CliDetectionResult {
  return {
    cli,
    installed: true,
    messagingMode: 'steer',
    ...(ptahCliId ? { ptahCliId } : {}),
  };
}

function limitEntry(
  row: CliDetectionResult,
  state: LaneLimitState,
): LaneLimitResult<CliDetectionResult> {
  return {
    row,
    lookup: 'ok',
    state: { state, reasons: [], windows: [] },
  };
}

function isSource(value: unknown): value is RouteCandidateSource {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['rows'] === 'function' &&
    typeof record['limits'] === 'function' &&
    typeof record['roles'] === 'function'
  );
}

function sourceOf(decide: jest.Mock): RouteCandidateSource {
  const call: unknown = decide.mock.calls[0];
  if (!Array.isArray(call) || !isSource(call[1])) {
    throw new Error('decide was not called with a candidate source');
  }
  return call[1];
}

function locator(options: {
  readonly registered: boolean;
  readonly service?: Pick<RouteDecideService, 'decide'>;
}): {
  readonly container: RouteServiceLocator;
  readonly isRegistered: jest.Mock;
  readonly resolve: jest.Mock;
} {
  const isRegistered = jest.fn((token: symbol, recursive?: boolean) => {
    return (
      options.registered &&
      recursive === true &&
      token === LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE
    );
  });
  const resolve = jest.fn(<T>(token: symbol): T => {
    if (token !== LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE) {
      throw new Error('unexpected token');
    }
    const service = options.service;
    if (!service) throw new Error('no service');
    return service as T;
  });
  const container: RouteServiceLocator = {
    isRegistered,
    resolve: <T>(token: symbol): T => resolve(token) as T,
  };
  return { container, isRegistered, resolve };
}

function agent(
  overrides: Partial<
    Pick<AgentNamespace, 'list' | 'limits' | 'listRoles'>
  > = {},
): Pick<AgentNamespace, 'list' | 'limits' | 'listRoles'> {
  return {
    list: jest.fn().mockResolvedValue([cliRow('codex')]),
    listRoles: jest.fn().mockResolvedValue(['code-logic-reviewer']),
    limits: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('resolveRouteDecideService', () => {
  it('returns undefined when the container is missing', () => {
    expect(resolveRouteDecideService(undefined)).toBeUndefined();
  });

  it('does not resolve a token the host has not registered', () => {
    const { container, resolve } = locator({ registered: false });
    expect(resolveRouteDecideService(container)).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE recursively', () => {
    const service = { decide: jest.fn() };
    const { container, isRegistered, resolve } = locator({
      registered: true,
      service,
    });
    expect(resolveRouteDecideService(container)).toBe(service);
    expect(isRegistered).toHaveBeenCalledWith(
      LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE,
      true,
    );
    expect(resolve).toHaveBeenCalledWith(
      LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE,
    );
  });
});

describe('buildRouteNamespace', () => {
  it('throws F9 and does not touch the agent when the service is absent', async () => {
    const rows = agent();
    const { container, resolve } = locator({ registered: false });
    const namespace = buildRouteNamespace({ agent: rows, container });

    let thrown: unknown;
    try {
      await namespace.decide(ARGS);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RoutingUnavailableError);
    if (thrown instanceof RoutingUnavailableError) {
      expect(thrown.message).toBe(ROUTING_UNAVAILABLE_MESSAGE);
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(rows.list).not.toHaveBeenCalled();
    expect(rows.listRoles).not.toHaveBeenCalled();
    expect(rows.limits).not.toHaveBeenCalled();
  });

  it('calls the service with a source built from list, limits and listRoles', async () => {
    const codex = cliRow('codex');
    const glm = cliRow('ptah-cli', 'glm');
    const bare = cliRow('ptah-cli');
    const rows = agent({
      list: jest.fn().mockResolvedValue([codex, glm, bare]),
      listRoles: jest
        .fn()
        .mockResolvedValue(['code-logic-reviewer', 'researcher-expert']),
      limits: jest
        .fn()
        .mockResolvedValue([
          limitEntry(codex, 'at-limit'),
          limitEntry(glm, 'near-limit'),
          limitEntry(bare, 'confirmed-room'),
        ]),
    });
    const decide = jest.fn().mockResolvedValue(RESULT);
    const { container } = locator({ registered: true, service: { decide } });
    const namespace = buildRouteNamespace({ agent: rows, container });

    await expect(namespace.decide(ARGS)).resolves.toBe(RESULT);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]?.[0]).toBe(ARGS);

    const source = sourceOf(decide);
    await expect(source.rows()).resolves.toEqual([codex, glm, bare]);
    await expect(source.roles()).resolves.toEqual([
      'code-logic-reviewer',
      'researcher-expert',
    ]);
    const limits = await source.limits([codex, glm, bare]);
    expect(limits).toEqual(
      new Map<string, LaneLimitState>([
        ['codex', 'at-limit'],
        ['glm', 'near-limit'],
        ['ptah-cli', 'confirmed-room'],
      ]),
    );
    expect(rows.limits).toHaveBeenCalledWith([codex, glm, bare]);
  });

  it('reports limits unavailable when the agent has no limits method', async () => {
    const rows = {
      list: jest.fn().mockResolvedValue([cliRow('codex')]),
      listRoles: jest.fn().mockResolvedValue(['code-logic-reviewer']),
    };
    const decide = jest.fn().mockResolvedValue(RESULT);
    const namespace = buildRouteNamespace({
      agent: rows,
      container: locator({ registered: true, service: { decide } }).container,
    });
    await namespace.decide(ARGS);
    const source = sourceOf(decide);
    await expect(source.limits([cliRow('codex')])).resolves.toBeNull();
  });

  it('reports limits unavailable when the lookup returns undefined', async () => {
    const decide = jest.fn().mockResolvedValue(RESULT);
    const rows = agent({ limits: jest.fn().mockResolvedValue(undefined) });
    const namespace = buildRouteNamespace({
      agent: rows,
      container: locator({ registered: true, service: { decide } }).container,
    });
    await namespace.decide(ARGS);
    await expect(sourceOf(decide).limits([])).resolves.toBeNull();
  });

  it('lets a role-list failure reject so the service can record it', async () => {
    const decide = jest.fn().mockResolvedValue(RESULT);
    const rows = agent({
      listRoles: jest.fn().mockRejectedValue(new Error('roles down')),
    });
    const namespace = buildRouteNamespace({
      agent: rows,
      container: locator({ registered: true, service: { decide } }).container,
    });
    await namespace.decide(ARGS);
    await expect(sourceOf(decide).roles()).rejects.toThrow('roles down');
  });

  it('lets an agent-list failure reject', async () => {
    const decide = jest.fn().mockResolvedValue(RESULT);
    const rows = agent({
      list: jest.fn().mockRejectedValue(new Error('agent list down')),
    });
    const namespace = buildRouteNamespace({
      agent: rows,
      container: locator({ registered: true, service: { decide } }).container,
    });
    await namespace.decide(ARGS);
    await expect(sourceOf(decide).rows()).rejects.toThrow('agent list down');
  });
});
