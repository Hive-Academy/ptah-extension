/**
 * AnalyticsRpcHandlers: params validation, workspace confinement, result
 * validation and the fixed error answer for service failures.
 */

import 'reflect-metadata';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { UsageAnalyticsService } from '@ptah-extension/usage-analytics';
import type { UsageSummary } from '@ptah-extension/shared';
import { AnalyticsRpcHandlers } from './analytics-rpc.handlers';

const METHOD = 'analytics:spendSummary';
const ROOT = process.platform === 'win32' ? 'C:\\work\\proj' : '/work/proj';
const OUTSIDE = process.platform === 'win32' ? 'C:\\other' : '/other';

type Registered = (params: unknown) => Promise<unknown>;

const SUMMARY: UsageSummary = {
  version: 1,
  generatedAt: '2026-10-20T00:00:00.000Z',
  timeZone: 'UTC',
  fromDay: '2026-10-13',
  untilDayExclusive: '2026-10-20',
  facts: [],
  sources: [],
  pricing: { source: 'bundled', asOf: null },
};

function setup(options?: { result?: unknown; reject?: unknown }) {
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
  const summarize = jest.fn(async () => {
    if (options && 'reject' in options) throw options.reject;
    return options && 'result' in options ? options.result : SUMMARY;
  });
  const workspaceProvider = {
    getWorkspaceFolders: () => [ROOT],
    getWorkspaceRoot: () => ROOT,
  };
  new AnalyticsRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    workspaceProvider as unknown as IWorkspaceProvider,
    { summarize } as unknown as UsageAnalyticsService,
  ).register();
  const call = (params: unknown) => {
    const handler = registered.get(METHOD);
    if (!handler) throw new Error(`${METHOD} was not registered`);
    return handler(params);
  };
  return { logger, call, summarize };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    return error instanceof RpcUserError ? error.errorCode : 'plain-error';
  }
  return undefined;
}

describe('AnalyticsRpcHandlers', () => {
  it('declares its method', () => {
    expect(AnalyticsRpcHandlers.METHODS).toEqual([METHOD]);
  });

  it('returns the validated summary for the active workspace', async () => {
    const { call, summarize } = setup();
    await expect(call({ range: 7 })).resolves.toEqual(SUMMARY);
    expect(summarize).toHaveBeenCalledWith(
      { range: 7 },
      ROOT,
      expect.any(AbortSignal),
    );
  });

  it('rejects invalid params before reading anything', async () => {
    const { call, summarize } = setup();
    expect(await codeOf(call({ range: 5 }))).toBe('INVALID_PARAMS');
    expect(await codeOf(call({ range: 7, extra: 1 }))).toBe('INVALID_PARAMS');
    expect(summarize).not.toHaveBeenCalled();
  });

  it('refuses a workspace outside the open folders', async () => {
    const { call, summarize } = setup();
    expect(await codeOf(call({ range: 30, workspace: OUTSIDE }))).toBe(
      'UNAUTHORIZED_WORKSPACE',
    );
    expect(summarize).not.toHaveBeenCalled();
  });

  it('logs a real Error and answers a fixed error when the service fails', async () => {
    const { call, logger } = setup({ reject: 'boom' });
    expect(await codeOf(call({ range: 90 }))).toBe('PERSISTENCE_UNAVAILABLE');
    const logged: unknown = logger.error.mock.calls[0]?.[1];
    expect(logged).toBeInstanceOf(Error);
  });

  it('fails closed when the service returns an invalid summary', async () => {
    const { call, logger } = setup({ result: { version: 2 } });
    expect(await codeOf(call({ range: 7 }))).toBe('PERSISTENCE_UNAVAILABLE');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
