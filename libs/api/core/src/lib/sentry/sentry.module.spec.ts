/**
 * Acceptance test for the `@sentry/nestjs` override (TASK_2026_499).
 *
 * `@sentry/nestjs@10.75.0` declares
 *
 *   "@nestjs/core": "^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0"
 *
 * and this workspace runs `@nestjs/core@12`. An npm `overrides` entry is what
 * makes the install resolve. An override changes which version npm installs; it
 * does NOT change Sentry's code, and `SentryGlobalFilter` reaches into
 * `@nestjs/core` internals. The failure mode of a forced peer is therefore not
 * a crash at boot — it is error capture quietly not happening, which surfaces
 * during an incident when a report never arrives.
 *
 * A clean `npm install` is not evidence of anything. These tests are the
 * evidence: an exception passed to the filter must reach the Sentry client.
 *
 * If this file fails after a Sentry or NestJS bump, do not weaken it. It is
 * reporting exactly the thing the override risks.
 */

import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

/** Events the transport was asked to send, captured via `beforeSend`. */
let sent: Array<{ message?: string; exceptionType?: string }>;

/**
 * An `ArgumentsHost` for a non-HTTP context. `SentryGlobalFilter` only forwards
 * an exception to Sentry when it is NOT a handled HTTP exception, so a plain
 * context exercises the capture path rather than the pass-through branch.
 */
function hostFor(type: 'http' | 'rpc'): ArgumentsHost {
  const host = {
    getType: () => type,
    switchToHttp: () => ({
      getResponse: () => ({
        status: () => ({ json: () => undefined }),
        headersSent: false,
      }),
      getRequest: () => ({ url: '/test', method: 'GET', headers: {} }),
    }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getData: () => ({}), getClient: () => ({}) }),
  };
  return host as unknown as ArgumentsHost;
}

describe('Sentry integration under the NestJS 12 override', () => {
  beforeAll(() => {
    sent = [];
    Sentry.init({
      dsn: 'https://publickey@o0.ingest.sentry.io/0',
      // Keep everything in-process: record the event and drop it so no network
      // call is ever made from a unit test.
      beforeSend(event) {
        sent.push({
          message: event.message,
          exceptionType: event.exception?.values?.[0]?.type,
        });
        return null;
      },
    });
  });

  afterAll(async () => {
    await Sentry.close(0);
  });

  beforeEach(() => {
    sent = [];
  });

  it('constructs SentryGlobalFilter against the installed NestJS', () => {
    // The override's first risk: Sentry's filter subclasses Nest's
    // BaseExceptionFilter. If NestJS 12 moved that base class, construction
    // throws here rather than silently degrading.
    expect(() => new SentryGlobalFilter()).not.toThrow();
  });

  it('forwards a non-HTTP exception to the Sentry client', async () => {
    const filter = new SentryGlobalFilter();
    const error = new Error('override-canary');

    try {
      filter.catch(error, hostFor('rpc'));
    } catch {
      // A filter for a non-HTTP context may rethrow after reporting. The
      // assertion below is about what reached Sentry, not about what the
      // filter returned.
    }

    // Sentry processes an event asynchronously, so beforeSend has not run
    // when capture returns. Flush before asserting.
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    expect(sent[0].exceptionType).toBe('Error');
  });

  it('captureException reaches beforeSend at all', async () => {
    // A floor check. If this fails, the client itself is not wired up and the
    // test above would be measuring nothing.
    Sentry.captureException(new Error('direct-canary'));
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    expect(sent[0].exceptionType).toBe('Error');
  });
});
