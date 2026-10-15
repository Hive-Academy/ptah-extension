/**
 * AgentOutcomeRpcHandlers — TASK_2026_646 Batch 25 (B7).
 *
 * Valid params, rejected params, a missing reader, a throwing reader, and
 * one reader call for many slugs.
 */

import 'reflect-metadata';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type { DependencyContainer } from 'tsyringe';
import { LANE_OUTCOME_TOKENS } from '@ptah-extension/lane-outcomes';
import type { AgentOutcomeSignals } from '@ptah-extension/shared';
import { AgentOutcomeRpcHandlers } from './agent-outcome-rpc.handlers';
import {
  AgentOutcomeSignalsParamsSchema,
  agentOutcomeIssueText,
} from './agent-outcome.schema';

const METHOD = 'agent:outcomeSignals';

type Registered = (params: unknown) => Promise<unknown>;

function signal(slug: string): AgentOutcomeSignals {
  return {
    slug,
    windowDays: 30,
    runCount: 2,
    delivered: { numerator: 1, denominator: 2 },
    reviewPass: { numerator: 1, denominator: 1 },
    avgReviseRounds: 0.5,
    topFailureClass: null,
  };
}

function setup(options?: {
  registered?: boolean;
  signals?: Record<string, AgentOutcomeSignals>;
  persistent?: boolean;
  reject?: Error;
}) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const registered = new Map<string, Registered>();
  const rpcHandler = {
    registerMethod: (method: string, handler: Registered) => {
      registered.set(method, handler);
    },
  };
  const agentSignals = jest.fn(async () => {
    if (options?.reject) throw options.reject;
    return options?.signals ?? {};
  });
  const isPersistent = jest.fn(() => options?.persistent ?? false);
  const isRegistered = jest.fn(() => options?.registered ?? false);
  const resolve = jest.fn(() => ({ agentSignals, isPersistent }));
  const runtimeContainer = { isRegistered, resolve };

  new AgentOutcomeRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    runtimeContainer as unknown as DependencyContainer,
  ).register();

  const call = (params: unknown) => {
    const handler = registered.get(METHOD);
    if (!handler) throw new Error(`${METHOD} was not registered`);
    return handler(params);
  };

  return { logger, call, agentSignals, isRegistered, resolve, isPersistent };
}

async function expectInvalid(params: unknown): Promise<void> {
  const parsed = AgentOutcomeSignalsParamsSchema.safeParse(params);
  expect(parsed.success).toBe(false);
  if (parsed.success) return;
  const { call, agentSignals, isRegistered } = setup({ registered: true });
  let caught: unknown;
  try {
    await call(params);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RpcUserError);
  if (!(caught instanceof RpcUserError)) return;
  expect(caught.errorCode).toBe('INVALID_PARAMS');
  expect(caught.message).toBe(
    `${METHOD}: invalid params — ${agentOutcomeIssueText(parsed.error)}`,
  );
  expect(isRegistered).not.toHaveBeenCalled();
  expect(agentSignals).not.toHaveBeenCalled();
}

describe('AgentOutcomeRpcHandlers', () => {
  it('returns the reader signals, the 30-day window, and persistence', async () => {
    const signals = { planner: signal('planner') };
    const { call, agentSignals, isRegistered, isPersistent } = setup({
      registered: true,
      signals,
      persistent: true,
    });

    await expect(call({ slugs: ['planner'] })).resolves.toEqual({
      signals,
      windowDays: 30,
      persistent: true,
    });
    expect(isRegistered).toHaveBeenCalledWith(LANE_OUTCOME_TOKENS.READER, true);
    expect(agentSignals).toHaveBeenCalledTimes(1);
    expect(agentSignals).toHaveBeenCalledWith(['planner'], 30);
    expect(isPersistent).toHaveBeenCalledTimes(1);
  });

  it('rejects an extra key with the Zod issue text', async () => {
    await expectInvalid({ slugs: ['planner'], extra: true });
  });

  it('rejects 501 slugs', async () => {
    await expectInvalid({ slugs: Array.from({ length: 501 }, () => 'a') });
  });

  it('rejects a 201-character slug', async () => {
    await expectInvalid({ slugs: ['a'.repeat(201)] });
  });

  it('rejects an empty slug', async () => {
    await expectInvalid({ slugs: [''] });
  });

  it('returns an empty non-persistent result when the reader is not registered', async () => {
    const { call, agentSignals, resolve } = setup({ registered: false });

    await expect(call({ slugs: ['planner', 'reviewer'] })).resolves.toEqual({
      signals: {},
      windowDays: 30,
      persistent: false,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(agentSignals).not.toHaveBeenCalled();
  });

  it('logs the error name and rejects when the reader throws', async () => {
    const failure = new Error('store unavailable at /secret/ptah.db');
    failure.name = 'OutcomeReadError';
    const slug = 'planner';
    const { call, logger, agentSignals } = setup({
      registered: true,
      reject: failure,
    });

    await expect(call({ slugs: [slug] })).rejects.toBe(failure);
    expect(agentSignals).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'RPC: agent:outcomeSignals failed',
      { code: 'OutcomeReadError' },
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(slug);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('ptah.db');
  });

  it('calls the reader once for many slugs', async () => {
    const slugs = ['planner', 'reviewer', 'writer', 'tester'];
    const { call, agentSignals } = setup({
      registered: true,
      signals: { planner: signal('planner') },
      persistent: true,
    });

    await call({ slugs });

    expect(agentSignals).toHaveBeenCalledTimes(1);
    expect(agentSignals).toHaveBeenCalledWith(slugs, 30);
  });
});
