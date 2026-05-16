/**
 * DI smoke test — proves every previously-factory-wired shared RPC handler
 * resolves cleanly against a production-shaped container.
 *
 * This test is intentionally tied to the constructor argument list rather than
 * to runtime behavior. Its job is to catch token-slot drift between a
 * handler's `@inject(...)` decorators and the container's `register(...)`
 * calls — exactly the failure mode that produced the v0.1.45 Sentry incident
 * (`SetupRpcHandlers` was wired with `CONFIG_MANAGER` in slot 3 after the
 * constructor swapped to `ModelSettings`).
 *
 * Why a hand-built minimal container (not `DIContainer.setup()`): the real
 * VS Code container relies on `vscode.ExtensionContext` and a long chain of
 * platform-vscode adapters. The minimal container below registers exactly the
 * tokens these handlers `@inject`, so any future drift between decorator and
 * registration immediately fails this test.
 */

import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import {
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';

function buildMinimalContainer(): DependencyContainer {
  const c = rootContainer.createChildContainer();

  c.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: c });

  c.register(TOKENS.LOGGER, {
    useValue: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  });
  c.register(TOKENS.RPC_HANDLER, {
    useValue: {
      registerMethod: jest.fn(),
      handleMessage: jest.fn(),
    },
  });
  c.register(TOKENS.SENTRY_SERVICE, {
    useValue: { captureException: jest.fn(), captureMessage: jest.fn() },
  });
  c.register(TOKENS.LICENSE_SERVICE, {
    useValue: { getStatus: jest.fn(), isPremium: jest.fn(() => false) },
  });
  c.register(TOKENS.SAVE_DIALOG_PROVIDER, {
    useValue: { showSaveDialog: jest.fn() },
  });
  c.register(TOKENS.PLATFORM_COMMANDS, {
    useValue: { executeCommand: jest.fn(), registerCommand: jest.fn() },
  });

  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getConfiguration: jest.fn(() => ({ get: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });

  c.register(SDK_TOKENS.SDK_PLUGIN_LOADER, {
    useValue: {
      getWorkspacePluginConfig: jest.fn(() => ({ enabledPluginIds: [] })),
      resolvePluginPaths: jest.fn(() => []),
    },
  });
  c.register(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE, {
    useValue: {
      setAnalysisReader: jest.fn(),
      getStatus: jest.fn(),
    },
  });

  const fakeModelSettings = {
    selectedModel: { get: jest.fn(() => 'sonnet'), set: jest.fn() },
    setSelectedModel: jest.fn(),
  };
  c.register(SETTINGS_TOKENS.MODEL_SETTINGS, { useValue: fakeModelSettings });

  registerSharedRpcHandlers(c);
  return c;
}

describe('VS Code DI — shared RPC handler resolution', () => {
  let c: DependencyContainer;

  beforeAll(() => {
    c = buildMinimalContainer();
  });

  it('resolves SetupRpcHandlers and wires ModelSettings into slot 3', () => {
    let instance: SetupRpcHandlers | undefined;
    expect(() => {
      instance = c.resolve(SetupRpcHandlers);
    }).not.toThrow();
    expect(instance).toBeDefined();
    const ms = (instance as unknown as { modelSettings: { selectedModel: { get: () => unknown } } })
      .modelSettings;
    expect(typeof ms.selectedModel.get).toBe('function');
  });

  it('resolves WizardGenerationRpcHandlers', () => {
    expect(() => c.resolve(WizardGenerationRpcHandlers)).not.toThrow();
  });

  it('resolves EnhancedPromptsRpcHandlers', () => {
    expect(() => c.resolve(EnhancedPromptsRpcHandlers)).not.toThrow();
  });

  it('resolves LlmRpcHandlers', () => {
    expect(() => c.resolve(LlmRpcHandlers)).not.toThrow();
  });
});
