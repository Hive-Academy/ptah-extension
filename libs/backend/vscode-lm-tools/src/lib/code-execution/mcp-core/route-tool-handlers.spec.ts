import 'reflect-metadata';
import type { RouteDecideResult } from '@ptah-extension/lane-routing';
import { ROUTE_DECIDE_RESULT_MAX_CHARS } from './tool-result-budget';
import {
  ROUTING_UNAVAILABLE_MESSAGE,
  RoutingUnavailableError,
  type RouteNamespace,
} from '../namespace-builders/route-namespace.builder';
import {
  handleRouteToolCall,
  routeFailureText,
  type RouteToolLogger,
} from './route-tool-handlers';

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

function logger(): RouteToolLogger & { warn: jest.Mock } {
  return { warn: jest.fn() };
}

function route(
  decide: RouteNamespace['decide'] = jest.fn().mockResolvedValue(RESULT),
): RouteNamespace & { decide: jest.Mock } {
  const mock = jest.fn(decide);
  return { decide: mock };
}

describe('handleRouteToolCall', () => {
  it('names the invalid field and does not call the service', async () => {
    const log = logger();
    const api = route();

    const reply = await handleRouteToolCall(
      { stage: 'pre-flight', request: 'x', extra: true },
      api,
      log,
    );

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('extra');
    expect(reply.text).toContain('ptah_route_decide');
    expect(api.decide).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('names a missing field at the root when the argument is not an object', async () => {
    const api = route();
    const reply = await handleRouteToolCall(null, api, logger());
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('(root)');
    expect(api.decide).not.toHaveBeenCalled();
  });

  it('names a duplicate phase id and does not call the service', async () => {
    const api = route();
    const reply = await handleRouteToolCall(
      {
        stage: 'gate-0.1',
        request: 'staff it',
        taskType: 'FEATURE',
        depth: 'Full',
        phases: [
          { id: 'build', kind: 'implement' },
          { id: 'build', kind: 'review' },
        ],
      },
      api,
      logger(),
    );
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('phases.1.id');
    expect(api.decide).not.toHaveBeenCalled();
  });

  it('passes the parsed arguments through and returns the result JSON', async () => {
    const api = route();
    const reply = await handleRouteToolCall(
      { stage: 'pre-flight', request: '  ship the parser  ' },
      api,
      logger(),
    );
    expect(reply).toEqual({ isError: false, text: JSON.stringify(RESULT) });
    expect(api.decide).toHaveBeenCalledTimes(1);
    expect(api.decide).toHaveBeenCalledWith({
      stage: 'pre-flight',
      request: 'ship the parser',
    });
  });

  const hundredPhases = Array.from({ length: 100 }, (_, index) => ({
    id: `phase-${index}`,
    kind: 'implement' as const,
  }));

  function hundredPhaseResult(reasonRepeats: number): RouteDecideResult {
    return {
      stage: 'gate-0.1',
      roster: hundredPhases.map((phase) => ({
        phaseId: phase.id,
        status: 'chosen' as const,
        executor: {
          kind: 'lane' as const,
          id: 'cli-agent',
          cli: 'codex',
          family: 'codex',
        },
        model: 'model-name',
        provenance: 'configured' as const,
        score: 1,
        source: 'ranking' as const,
        taskKind: 'implement' as const,
        confidence: 0.8,
        fallbackCause: null,
        modelProposal: null,
        reason: 'Selected by the routing policy. '.repeat(reasonRepeats),
      })),
      overallSource: 'ranking',
      overallConfidence: 0.8,
      excluded: [],
      reasons: [],
      usage: {
        requests: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    };
  }

  function callWith(result: RouteDecideResult) {
    return handleRouteToolCall(
      {
        stage: 'gate-0.1',
        request: 'staff the implementation',
        taskType: 'FEATURE',
        depth: 'Full',
        phases: hundredPhases,
      },
      route(jest.fn().mockResolvedValue(result)),
      logger(),
    );
  }

  it('returns a schema-maximum 100-phase route result whole', async () => {
    const result = hundredPhaseResult(8);
    const measuredChars = JSON.stringify(result).length;
    expect(measuredChars).toBe(54_375);
    expect(measuredChars).toBeLessThanOrEqual(ROUTE_DECIDE_RESULT_MAX_CHARS);

    const reply = await callWith(result);
    expect(reply.isError).toBe(false);
    expect(JSON.parse(reply.text)).toEqual(result);
  });

  it('returns a tool error, never a cut prefix, for an over-limit route result', async () => {
    const result = hundredPhaseResult(32);
    expect(JSON.stringify(result).length).toBeGreaterThan(
      ROUTE_DECIDE_RESULT_MAX_CHARS,
    );

    const reply = await callWith(result);
    expect(reply).toMatchObject({
      isError: true,
      text: expect.stringContaining('result exceeds'),
    });
    expect(() => JSON.parse(reply.text)).toThrow();
  });

  it('returns the F9 sentence when routing is not registered', async () => {
    const log = logger();
    const api = route(() => Promise.reject(new RoutingUnavailableError()));
    const reply = await handleRouteToolCall(
      { stage: 'pre-flight', request: 'ship the parser' },
      api,
      log,
    );
    expect(reply).toEqual({
      isError: true,
      text: ROUTING_UNAVAILABLE_MESSAGE,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(
      ROUTING_UNAVAILABLE_MESSAGE,
    );
  });

  it('redacts a thrown secret and still returns a tool error', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const api = route(() =>
      Promise.reject(new Error(`auth failed for ${secret}`)),
    );
    const reply = await handleRouteToolCall(
      { stage: 'pre-flight', request: 'ship the parser' },
      api,
      logger(),
    );
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('[REDACTED]');
    expect(reply.text).not.toContain(secret);
    expect(reply.text.startsWith('ptah_route_decide failed:')).toBe(true);
  });
});

describe('routeFailureText', () => {
  it('keeps the F9 sentence and redacts a bearer token', () => {
    expect(routeFailureText(new Error(ROUTING_UNAVAILABLE_MESSAGE))).toBe(
      ROUTING_UNAVAILABLE_MESSAGE,
    );
    const text = routeFailureText(
      new Error('denied Bearer super-secret-token-value'),
    );
    expect(text).not.toContain('super-secret-token-value');
    expect(text).toContain('[REDACTED]');
  });

  it('keeps a field-named service error', () => {
    const message =
      'route decide result failed schema at roster.0.model: invalid';
    expect(routeFailureText(new Error(message))).toBe(
      `ptah_route_decide failed: ${message}`,
    );
  });
});
