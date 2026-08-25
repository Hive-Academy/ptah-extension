/**
 * verify-and-report — unit specs.
 *
 * TASK_2026_306 Defect G, second cause. `verifyRpcRegistration` LOGS as a side
 * effect of verifying, and `assertRpcRegistration` used to call it a second
 * time. So a single `verifyAndReportRpcRegistration` pass that reached the
 * dev-assert branch printed
 * `[RPC Verification] All N RPC methods correctly registered` twice on its own
 * — with or without the SDK adapter double-init that Task 3.2 fixes.
 *
 * These specs pin the log/compute count on both sides of the branch. What is
 * verified must not change: the assertion is a real guard on the RPC
 * dual-registration rule and stays.
 */

import 'reflect-metadata';

import { container } from 'tsyringe';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';

import { verifyAndReportRpcRegistration } from './verify-and-report';

const SENTRY_TOKEN = Symbol.for('VerifyAndReportSpecSentry');

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/** An `RpcHandler` stand-in that reports exactly the methods it is given. */
function fakeRpcHandler(methods: readonly string[]): RpcHandler {
  return {
    getRegisteredMethods: () => Array.from(methods),
  } as unknown as RpcHandler;
}

function countCalls(fn: jest.Mock, fragment: string): number {
  return fn.mock.calls.filter(
    ([message]: [unknown]) =>
      typeof message === 'string' && message.includes(fragment),
  ).length;
}

describe('verifyAndReportRpcRegistration', () => {
  let logger: MockLogger;
  let previousNodeEnv: string | undefined;

  beforeEach(() => {
    logger = createMockLogger();
    previousNodeEnv = process.env['NODE_ENV'];
    // The assert branch is the one that used to double-log.
    process.env['NODE_ENV'] = 'development';
  });

  afterEach(() => {
    if (previousNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = previousNodeEnv;
    }
  });

  function run(methods: readonly string[]) {
    return verifyAndReportRpcRegistration({
      rpcHandler: fakeRpcHandler(methods),
      logger: asLogger(logger),
      container: container.createChildContainer(),
      sentryToken: SENTRY_TOKEN,
      platform: 'electron',
    });
  }

  it('logs the success line exactly once for a pass that reaches the assert', () => {
    const result = run(RPC_METHOD_NAMES);

    expect(result.valid).toBe(true);
    expect(countCalls(logger.info as jest.Mock, 'correctly registered')).toBe(
      1,
    );
  });

  it('still throws on registration drift — the assertion is not weakened', () => {
    const withDrift = RPC_METHOD_NAMES.slice(1);

    expect(() => run(withDrift)).toThrow(/RPC registration incomplete/);
  });

  it('computes the verification once on the drift path too', () => {
    const withDrift = RPC_METHOD_NAMES.slice(1);

    expect(() => run(withDrift)).toThrow();

    // Two distinct error lines are expected — `verifyRpcRegistration`'s
    // CRITICAL line and this helper's own drift report — but each exactly
    // once. A second verification pass would double the first of them.
    expect(
      countCalls(logger.error as jest.Mock, 'methods missing handlers'),
    ).toBe(1);
    expect(
      countCalls(logger.error as jest.Mock, 'RPC registration incomplete'),
    ).toBe(1);
  });

  it('skips the assert entirely outside development', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['PTAH_E2E'];

    const result = run(RPC_METHOD_NAMES.slice(1));

    expect(result.valid).toBe(false);
    expect(
      countCalls(logger.error as jest.Mock, 'methods missing handlers'),
    ).toBe(1);
  });
});
