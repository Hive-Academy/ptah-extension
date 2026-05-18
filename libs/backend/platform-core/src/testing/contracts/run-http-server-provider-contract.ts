/**
 * `runHttpServerProviderContract` — behavioural contract for `IHttpServerProvider`.
 *
 * Invariants (see Section 2.4 of docs/test-strategy-plan.md):
 *
 *   1. `listen(host, 0, handler)` returns a handle whose `.port` is > 0
 *      (OS assigned a free port).
 *   2. `handle.host` matches the requested bind host.
 *   3. `handle.close()` resolves without throwing (idempotent).
 *   4. `handle.close()` can be called twice without throwing.
 *   5. The handler callback is invoked for each inbound HTTP request.
 *   6. An error thrown inside the handler does NOT crash the listener.
 *   7. Binding on a port already in use (`EADDRINUSE`) causes `listen` to throw.
 *
 * Tests that require actually sending HTTP requests over a socket are skipped
 * when the factory produces a stub that does not bind a real TCP listener.
 * Such stubs should implement handler invocation in their test shims; if they
 * do not, the handler-invocation tests will legitimately fail. The contract
 * distinguishes between "stub that returns a valid handle shape" and "real
 * TCP-binding implementation" via the optional `sendsRealRequests` flag.
 *
 * Platform notes:
 *   - CLI: `CliHttpServerProvider` binds a real `node:http` listener. All tests
 *     including request-handler and EADDRINUSE invariants apply.
 *   - VS Code / Electron: stub implementations that no-op `listen` should set
 *     `sendsRealRequests: false`; tests 5, 6, and 7 are skipped for them.
 */

import * as http from 'node:http';
import type {
  IHttpServerProvider,
  IHttpServerHandle,
} from '../../interfaces/http-server-provider.interface';

export interface HttpServerProviderSetup {
  provider: IHttpServerProvider;
  /**
   * When `true`, the provider binds a real TCP listener so request-handler and
   * EADDRINUSE tests apply. Set to `false` for stub / no-op implementations.
   * Defaults to `true`.
   */
  sendsRealRequests?: boolean;
}

export function runHttpServerProviderContract(
  name: string,
  createSetup: () => Promise<HttpServerProviderSetup> | HttpServerProviderSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IHttpServerProvider contract — ${name}`, () => {
    let setup: HttpServerProviderSetup;
    let openHandles: IHttpServerHandle[];

    beforeEach(async () => {
      setup = await createSetup();
      openHandles = [];
    });

    afterEach(async () => {
      for (const handle of openHandles) {
        try {
          await handle.close();
        } catch {
          /* ignore teardown errors */
        }
      }
      openHandles = [];
      await teardown?.();
    });

    it('listen(host, 0, noop) returns a handle', async () => {
      const handle = await setup.provider.listen('127.0.0.1', 0, () => {
        /* noop */
      });
      openHandles.push(handle);
      expect(handle).toBeDefined();
      await handle.close();
    });

    it('listen with port 0 returns a handle with port > 0 (OS-assigned)', async () => {
      const sendsReal = setup.sendsRealRequests !== false;
      if (!sendsReal) {
        const handle = await setup.provider.listen('127.0.0.1', 0, () => {
          /* noop */
        });
        openHandles.push(handle);
        expect(typeof handle.port).toBe('number');
        await handle.close();
        return;
      }

      const handle = await setup.provider.listen('127.0.0.1', 0, () => {
        /* noop */
      });
      openHandles.push(handle);
      expect(handle.port).toBeGreaterThan(0);
      await handle.close();
    });

    it('handle.host matches the requested bind host', async () => {
      const handle = await setup.provider.listen('127.0.0.1', 0, () => {
        /* noop */
      });
      openHandles.push(handle);
      expect(handle.host).toBe('127.0.0.1');
      await handle.close();
    });

    it('handle.close() resolves without throwing', async () => {
      const handle = await setup.provider.listen('127.0.0.1', 0, () => {
        /* noop */
      });
      await expect(handle.close()).resolves.not.toThrow();
    });

    it('handle.close() is idempotent — second call does not throw', async () => {
      const handle = await setup.provider.listen('127.0.0.1', 0, () => {
        /* noop */
      });
      await handle.close();
      await expect(handle.close()).resolves.not.toThrow();
    });

    it('handler is invoked when an HTTP request arrives (real TCP only)', async () => {
      if (setup.sendsRealRequests === false) {
        return;
      }

      let handlerCalled = false;
      const handle = await setup.provider.listen('127.0.0.1', 0, (req, res) => {
        handlerCalled = true;
        (res as http.ServerResponse).writeHead(200);
        (res as http.ServerResponse).end();
      });
      openHandles.push(handle);

      await sendRequest(`http://127.0.0.1:${handle.port}/`);

      expect(handlerCalled).toBe(true);
      await handle.close();
    });

    it('an error thrown inside the handler does not crash the listener (real TCP only)', async () => {
      if (setup.sendsRealRequests === false) {
        return;
      }

      let secondHandlerCalled = false;
      const handle = await setup.provider.listen('127.0.0.1', 0, (req, res) => {
        if (!secondHandlerCalled) {
          secondHandlerCalled = true;
          throw new Error('intentional handler error');
        }
        (res as http.ServerResponse).writeHead(200);
        (res as http.ServerResponse).end();
      });
      openHandles.push(handle);
      try {
        await sendRequest(`http://127.0.0.1:${handle.port}/`);
      } catch {
        /* expected: connection may be reset when handler throws */
      }
      await sendRequest(`http://127.0.0.1:${handle.port}/`);

      await handle.close();
    });

    it('listen on an already-in-use port throws (EADDRINUSE, real TCP only)', async () => {
      if (setup.sendsRealRequests === false) {
        return;
      }
      const handle = await setup.provider.listen('127.0.0.1', 0, () => {
        /* noop */
      });
      openHandles.push(handle);
      const { port } = handle;
      await expect(
        setup.provider.listen('127.0.0.1', port, () => {
          /* noop */
        }),
      ).rejects.toThrow();

      await handle.close();
    });
  });
}

function sendRequest(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume(); // consume the body
        res.on('end', resolve);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}
