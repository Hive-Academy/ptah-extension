/**
 * Parity test for the CLI Skills.sh RPC Handlers.
 *
 * TASK_2026_104 Sub-batch B6b — verifies the CLI re-registration of
 * `SkillsShRpcHandlers` exposes the same six RPC method names as the
 * Electron handler, in the same registration order. Drift between the two
 * apps would silently regress functionality (e.g. webview "Recommended
 * Skills" panel pointing at a method the CLI no longer registers), so this
 * spec is intentionally narrow but mandatory.
 *
 * The full behavior matrix of the handler is owned by the existing webview /
 * Electron specs; we only smoke-test the surface here.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';

import { SkillsShRpcHandlers } from './skills-sh-rpc.handlers.js';

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

describe('CLI SkillsShRpcHandlers — parity surface', () => {
  afterEach(() => {
    container.clearInstances();
  });

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
