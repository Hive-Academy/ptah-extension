/**
 * registerSharedRpcHandlers — the connection-check store is one instance per
 * container (TASK_2026_555 Batch 28c). AuthRpcHandlers and ProviderRpcHandlers
 * both inject it; a second instance would hide one side's records.
 */

// The cli-agent-runtime barrel (plan-limit discovery tokens) reaches the
// workspace-intelligence tree-sitter loader, whose `wasm-bundle-dir` reads
// `import.meta.url` (unparseable under CommonJS ts-jest). Nothing here parses.
jest.mock('../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));
import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';

import { registerSharedRpcHandlers } from './register-shared-rpc-handlers';

// The handler barrel pulls the whole backend graph; only the registrations matter here.
jest.mock('./handlers', () => ({
  SetupRpcHandlers: class SetupRpcHandlers {},
  WizardGenerationRpcHandlers: class WizardGenerationRpcHandlers {},
  EnhancedPromptsRpcHandlers: class EnhancedPromptsRpcHandlers {},
  LlmRpcHandlers: class LlmRpcHandlers {},
  SessionLifecycleNotifier: class SessionLifecycleNotifier {},
  GitChangeSetRpcHandlers: class GitChangeSetRpcHandlers {},
  PlanLimitsBroadcaster: class PlanLimitsBroadcaster {},
}));
import { ConnectionCheckRecorder } from './utils/connection-check-recorder';
import { ProviderAccountRpcHandlers } from './handlers/provider-account-rpc.handlers';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { HARNESS_SYNC_TOKENS } from '@ptah-extension/harness-sync';
import { RecentWorkspacesService } from './services/recent-workspaces.service';
import { InstallScopeMigrationService } from './install-scope/install-scope-migration.service';
import { InstallScopeNoticeRpcHandlers } from './install-scope/install-scope-notice-rpc.handlers';

describe('registerSharedRpcHandlers', () => {
  it('registers ConnectionCheckRecorder as a container singleton', () => {
    const container = rootContainer.createChildContainer();
    registerSharedRpcHandlers(container);

    const first = container.resolve(ConnectionCheckRecorder);
    const second = container.resolve(ConnectionCheckRecorder);

    expect(first).toBeInstanceOf(ConnectionCheckRecorder);
    expect(second).toBe(first);
  });

  it('registers the provider account handler lazily, as a singleton binding', () => {
    const container = rootContainer.createChildContainer();
    registerSharedRpcHandlers(container);

    // Registration only: resolving would need the host RPC handler, account
    // store and webview ports, and so would open account storage.
    expect(container.isRegistered(ProviderAccountRpcHandlers)).toBe(true);
  });

  it('registers the install-scope migration and its notice handler as singletons', () => {
    const container = rootContainer.createChildContainer();
    registerSharedRpcHandlers(container);

    expect(container.isRegistered(InstallScopeMigrationService)).toBe(true);
    expect(container.isRegistered(InstallScopeNoticeRpcHandlers)).toBe(true);

    // Host ports the two classes inject. Resolving constructs only: the
    // service touches no file until `run()` or a notice read.
    const registerMethod = jest.fn();
    container.registerInstance(TOKENS.LOGGER, {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });
    container.registerInstance(TOKENS.RPC_HANDLER, { registerMethod });
    container.registerInstance(HARNESS_SYNC_TOKENS.RECONCILER, {
      reconcile: jest.fn(),
    });
    container.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      getWorkspaceFolders: jest.fn(() => []),
    });
    container.registerInstance(RecentWorkspacesService, {
      list: jest.fn(async () => []),
    } as unknown as RecentWorkspacesService);

    const migration = container.resolve(InstallScopeMigrationService);
    expect(migration).toBeInstanceOf(InstallScopeMigrationService);
    expect(container.resolve(InstallScopeMigrationService)).toBe(migration);

    const notice = container.resolve(InstallScopeNoticeRpcHandlers);
    expect(container.resolve(InstallScopeNoticeRpcHandlers)).toBe(notice);

    notice.register();
    expect(registerMethod.mock.calls.map(([method]) => method)).toEqual([
      ...InstallScopeNoticeRpcHandlers.METHODS,
    ]);
  });
});
