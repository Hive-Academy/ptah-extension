/**
 * DecisionModelCatalogRpcHandlers — TASK_2026_684 Batch 14 (C10).
 *
 * Resolved through a child container, as every host does: valid sources,
 * rejected params, a pass-through of each filter state, and a rejecting
 * catalog that answers `unavailable` and logs the error name only.
 */

import 'reflect-metadata';

import { container } from 'tsyringe';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import {
  LANE_ROUTING_TOKENS,
  type DecisionModelCatalogResult,
} from '@ptah-extension/lane-routing';
import {
  DECISION_MODEL_CATALOG_SOURCES,
  RPC_METHOD_NAMES,
  type DecisionModelCatalogSource,
} from '@ptah-extension/shared';
import { DecisionModelCatalogRpcHandlers } from './decision-model-catalog-rpc.handlers';

const METHOD = 'agent:listDecisionModels';
const SECRET = 'sk-sentinel-key https://user:pass@example.invalid/api/tags';

type Registered = (params: unknown) => Promise<unknown>;

function setup(answer: () => Promise<DecisionModelCatalogResult>) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const registered = new Map<string, Registered>();
  const rpcHandler = {
    registerMethod: jest.fn((method: string, handler: Registered) => {
      registered.set(method, handler);
    }),
  };
  const list = jest.fn((_source: DecisionModelCatalogSource) => answer());

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG, { list });
  child.resolve(DecisionModelCatalogRpcHandlers).register();

  const call = (params: unknown) => {
    const handler = registered.get(METHOD);
    if (!handler) throw new Error(`${METHOD} was not registered`);
    return handler(params);
  };
  return { logger, list, call, rpcHandler };
}

const applied: DecisionModelCatalogResult = {
  models: ['alpha:7b', 'beta:3b'],
  filter: 'applied',
  undetermined: 0,
};

describe('DecisionModelCatalogRpcHandlers', () => {
  it('declares one registry method and registers only it', () => {
    expect(DecisionModelCatalogRpcHandlers.METHODS).toEqual([METHOD]);
    expect(RPC_METHOD_NAMES).toContain(METHOD);
    const { rpcHandler } = setup(async () => applied);
    expect(rpcHandler.registerMethod).toHaveBeenCalledTimes(1);
  });

  it('does not call the catalog on registration', () => {
    const { list } = setup(async () => applied);
    expect(list).not.toHaveBeenCalled();
  });

  it.each<DecisionModelCatalogSource>([...DECISION_MODEL_CATALOG_SOURCES])(
    'lists %s through the catalog once',
    async (source) => {
      const { call, list } = setup(async () => applied);
      await expect(call({ source })).resolves.toEqual({
        models: ['alpha:7b', 'beta:3b'],
        filter: 'applied',
        undetermined: 0,
      });
      expect(list).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledWith(source);
    },
  );

  it('passes partial and unavailable results through unchanged', async () => {
    const partial: DecisionModelCatalogResult = {
      models: ['alpha:7b'],
      filter: 'partial',
      undetermined: 2,
    };
    await expect(
      setup(async () => partial).call({ source: 'ollama' }),
    ).resolves.toEqual({
      models: ['alpha:7b'],
      filter: 'partial',
      undetermined: 2,
    });

    const unavailable: DecisionModelCatalogResult = {
      models: [],
      filter: 'unavailable',
      undetermined: 0,
    };
    await expect(
      setup(async () => unavailable).call({ source: 'ollama-cloud' }),
    ).resolves.toEqual({ models: [], filter: 'unavailable', undetermined: 0 });
  });

  it('returns a mutable copy of the catalog models', async () => {
    const frozen: DecisionModelCatalogResult = Object.freeze({
      models: Object.freeze(['alpha:7b']),
      filter: 'applied',
      undetermined: 0,
    });
    const result = await setup(async () => frozen).call({ source: 'ollama' });
    expect(result).toEqual({
      models: ['alpha:7b'],
      filter: 'applied',
      undetermined: 0,
    });
    const models: unknown =
      typeof result === 'object' && result !== null && 'models' in result
        ? result.models
        : undefined;
    expect(Array.isArray(models)).toBe(true);
    expect(Object.isFrozen(models)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['undefined params', undefined],
    ['null params', null],
    ['missing source', {}],
    ['unknown source', { source: 'openai' }],
    ['non-string source', { source: 7 }],
    ['extra field', { source: 'ollama', baseUrl: SECRET }],
  ])(
    'rejects %s with INVALID_PARAMS and no catalog call',
    async (_label, params) => {
      const { call, list } = setup(async () => applied);
      let caught: unknown;
      try {
        await call(params);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RpcUserError);
      expect(caught).toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(caught instanceof Error ? caught.message : '').not.toContain(
        'sk-sentinel',
      );
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('answers unavailable and logs the error name only when the catalog rejects', async () => {
    const { call, logger } = setup(async () => {
      throw new TypeError(SECRET);
    });
    await expect(call({ source: 'ollama' })).resolves.toEqual({
      models: [],
      filter: 'unavailable',
      undetermined: 0,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      `[decisionModelCatalog] ${METHOD} failed`,
      { source: 'ollama', errorName: 'TypeError' },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-sentinel');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a custom or hostile error name as other', async () => {
    const custom = new Error('boom');
    custom.name = SECRET;
    const hostile = new Error('boom');
    Object.defineProperty(hostile, 'name', {
      get() {
        throw new Error(SECRET);
      },
    });

    for (const rejection of [custom, hostile, SECRET]) {
      const { call, logger } = setup(() => Promise.reject(rejection));
      await expect(call({ source: 'ollama-cloud' })).resolves.toMatchObject({
        filter: 'unavailable',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        `[decisionModelCatalog] ${METHOD} failed`,
        { source: 'ollama-cloud', errorName: 'other' },
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        'sk-sentinel',
      );
    }
  });
});
