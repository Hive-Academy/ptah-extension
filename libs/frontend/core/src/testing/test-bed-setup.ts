/**
 * `configureTestBedWithMocks` — Angular `TestBed` bootstrap for core-library specs.
 *
 * Registers the default core mocks at their production DI tokens so component
 * and service specs can inject the same services the app uses at runtime,
 * without wiring the real VS Code / message-router side effects.
 *
 * Defaults registered:
 *   - `ClaudeRpcService` → `createMockRpcService()`
 *   - `MessageRouterService` → `createMockMessageRouter()`
 *   - `MESSAGE_HANDLERS` multi-provider → `[]` (empty; specs opt in via overrides)
 *
 * Usage:
 *
 * ```ts
 * import { configureTestBedWithMocks } from '@ptah-extension/core/testing';
 *
 * describe('MyComponent', () => {
 *   beforeEach(() => {
 *     const { rpc, router } = configureTestBedWithMocks();
 *     rpc.call.mockResolvedValue(rpcSuccess({ … }));
 *   });
 * });
 * ```
 *
 * Pass `overrides.providers` to append additional providers, or
 * `overrides.rpcMock` / `overrides.routerMock` to inject custom factories.
 */

import { TestBed, type TestModuleMetadata } from '@angular/core/testing';
import { ClaudeRpcService } from '../lib/services/claude-rpc.service';
import { MessageRouterService } from '../lib/services/message-router.service';
import { createMockRpcService, type MockRpcService } from './mock-rpc-service';
import {
  createMockMessageRouter,
  type MockMessageRouter,
} from './mock-message-router';

export interface ConfigureTestBedOverrides {
  /**
   * Pre-built rpc mock. If omitted, a fresh one is created per call via
   * `createMockRpcService()`.
   */
  rpcMock?: MockRpcService;
  /**
   * Pre-built message-router mock. If omitted, a fresh one is created per
   * call via `createMockMessageRouter()`.
   */
  routerMock?: MockMessageRouter;
  /**
   * Extra providers to register. Appended after the core mocks, so anything
   * here wins via last-provider-wins in Angular DI.
   */
  providers?: TestModuleMetadata['providers'];
  /**
   * Extra imports (standalone components, NgModules) to register. Merged with
   * the default `[]` imports list.
   */
  imports?: TestModuleMetadata['imports'];
}

export interface ConfiguredTestBed {
  readonly rpc: MockRpcService;
  readonly router: MockMessageRouter;
}

export function configureTestBedWithMocks(
  overrides: ConfigureTestBedOverrides = {},
): ConfiguredTestBed {
  const rpc = overrides.rpcMock ?? createMockRpcService();
  const router = overrides.routerMock ?? createMockMessageRouter();

  TestBed.configureTestingModule({
    imports: [...(overrides.imports ?? [])],
    providers: [
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: MessageRouterService, useValue: router },
      // `MESSAGE_HANDLERS` is a multi-provider token. We don't register any
      // default contributors here — `inject(MESSAGE_HANDLERS, { optional: true })`
      // yields `[]` in Angular when no multi-providers exist, which is what
      // specs want. Consumers that need handlers can append their own provider
      // entries via `overrides.providers`.
      ...(overrides.providers ?? []),
    ],
  });

  return { rpc, router };
}
