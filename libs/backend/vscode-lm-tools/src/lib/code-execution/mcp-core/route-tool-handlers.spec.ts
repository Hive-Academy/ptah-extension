import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RouteDecideResult } from '@ptah-extension/lane-routing';
import { countTokens } from '@ptah-extension/tool-output-reducers';
import {
  applyToolResultBudget,
  getToolResultBudget,
  ROUTE_DECIDE_RESULT_BUDGET,
} from './tool-result-budget';
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

  const MAX_CHARS = ROUTE_DECIDE_RESULT_BUDGET.chars;
  const MAX_TOKENS = ROUTE_DECIDE_RESULT_BUDGET.tokens;

  function hundredPhaseResult(reasonRepeats: number): RouteDecideResult {
    return withReasons(() =>
      'Selected by the routing policy. '.repeat(reasonRepeats),
    );
  }

  const CLIS = ['codex', 'grok', 'gemini', 'copilot', 'ptah-cli'];

  /**
   * A reason as `compile-reasons` writes it: scores, ranks and quota numbers
   * that differ per phase. Such text is token-dense (about 2.4 chars/token),
   * far denser than the 4 chars/token a char-derived budget assumes.
   */
  function scoredReason(phase: number, length: number): string {
    let text = '';
    let k = phase * 31 + 7;
    while (text.length < length) {
      text += `${CLIS[k % CLIS.length]} ${(k * 37) % 100}/${(k * 11) % 97}=0.${(k * 7919) % 1000}; `;
      k++;
    }
    return text.slice(0, length);
  }

  function withReasons(reason: (phase: number) => string): RouteDecideResult {
    return {
      stage: 'gate-0.1',
      roster: hundredPhases.map((phase, index) => ({
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
        reason: reason(index),
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
    expect(measuredChars).toBeLessThanOrEqual(MAX_CHARS);

    const reply = await callWith(result);
    expect(reply.isError).toBe(false);
    expect(JSON.parse(reply.text)).toEqual(result);
  });

  it('returns a tool error, never a cut prefix, for an over-limit route result', async () => {
    const result = hundredPhaseResult(32);
    expect(JSON.stringify(result).length).toBeGreaterThan(MAX_CHARS);

    const reply = await callWith(result);
    expect(reply).toMatchObject({
      isError: true,
      text: expect.stringContaining('result exceeds'),
    });
    expect(() => JSON.parse(reply.text)).toThrow();
  });

  describe('token-dense 100-phase results (P6 re-review N-1)', () => {
    let spoolRoot: string;

    beforeAll(() => {
      spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'route-budget-'));
    });

    afterAll(() => {
      fs.rmSync(spoolRoot, { recursive: true, force: true });
    });

    it('returns a varied-reason result whole on success and through the tool budget', async () => {
      const result = withReasons((phase) => scoredReason(phase, 300));
      const text = JSON.stringify(result);
      expect(text.length).toBe(58_775);
      expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
      // Over a 4 chars/token budget (16,000 tokens), within the route budget.
      expect(countTokens(text)).toBeGreaterThan(MAX_CHARS / 4);
      expect(countTokens(text)).toBeLessThanOrEqual(MAX_TOKENS);

      const reply = await callWith(result);
      expect(reply).toEqual({ isError: false, text });

      expect(getToolResultBudget('ptah_route_decide')).toBe(
        ROUTE_DECIDE_RESULT_BUDGET,
      );
      const budgeted = await applyToolResultBudget({
        text: reply.text,
        toolName: 'ptah_route_decide',
        requestId: 'route-n1',
        spoolRoot,
      });
      expect(budgeted.truncated).toBe(false);
      expect(budgeted.reduced).toBe(false);
      expect(budgeted.text).toBe(text);
      expect(JSON.parse(budgeted.text)).toEqual(result);
    });

    it('returns a tool error for a result under the char limit but over the token limit', async () => {
      const result = withReasons((phase) => scoredReason(phase, 340));
      const text = JSON.stringify(result);
      expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
      expect(countTokens(text)).toBeGreaterThan(MAX_TOKENS);

      const reply = await callWith(result);
      expect(reply).toEqual({
        isError: true,
        text: `ptah_route_decide failed: result exceeds the ${MAX_CHARS}-character / ${MAX_TOKENS}-token tool limit`,
      });
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
