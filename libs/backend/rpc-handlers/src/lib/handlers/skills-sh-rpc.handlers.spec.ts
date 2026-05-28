/**
 * Surface test for the shared Skills.sh RPC Handlers.
 *
 * Verifies the consolidated `SkillsShRpcHandlers` (lifted from the per-app
 * copies into `@ptah-extension/rpc-handlers`) exposes the same six RPC method
 * names in the same registration order. This replaces the per-app parity
 * spec that previously guarded VS Code / Electron / CLI drift — there is now a
 * single source of truth, so the test guards the shared surface directly.
 */

import 'reflect-metadata';

import { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';

interface RegisteredMethod {
  method: string;
}

class StubRpcHandler {
  readonly registered: RegisteredMethod[] = [];
  registerMethod(method: string): void {
    this.registered.push({ method });
  }
}

class StubLogger {
  debug = jest.fn();
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

class StubWorkspaceProvider {
  getWorkspaceRoot(): string | undefined {
    return undefined;
  }
}

describe('SkillsShRpcHandlers (shared) — surface', () => {
  it('exposes the six skillsSh:* method names in registration order', () => {
    expect([...SkillsShRpcHandlers.METHODS]).toEqual([
      'skillsSh:search',
      'skillsSh:listInstalled',
      'skillsSh:install',
      'skillsSh:uninstall',
      'skillsSh:getPopular',
      'skillsSh:detectRecommended',
    ]);
  });

  it('registers exactly the METHODS tuple when register() is invoked', () => {
    const stubRpc = new StubRpcHandler();
    const handlers = new SkillsShRpcHandlers(
      new StubLogger() as unknown as never,
      stubRpc as unknown as never,
      new StubWorkspaceProvider() as unknown as never,
    );

    handlers.register();

    const registeredNames = stubRpc.registered.map((r) => r.method);
    expect(registeredNames).toEqual([...SkillsShRpcHandlers.METHODS]);
  });
});
