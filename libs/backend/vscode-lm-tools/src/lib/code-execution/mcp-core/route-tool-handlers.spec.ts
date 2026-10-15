import 'reflect-metadata';
import type { RouteDecideResult } from '@ptah-extension/lane-routing';
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
