/**
 * registerSharedRpcHandlers — the connection-check store is one instance per
 * container (TASK_2026_555 Batch 28c). AuthRpcHandlers and ProviderRpcHandlers
 * both inject it; a second instance would hide one side's records.
 */

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
}));
import { ConnectionCheckRecorder } from './utils/connection-check-recorder';

describe('registerSharedRpcHandlers', () => {
  it('registers ConnectionCheckRecorder as a container singleton', () => {
    const container = rootContainer.createChildContainer();
    registerSharedRpcHandlers(container);

    const first = container.resolve(ConnectionCheckRecorder);
    const second = container.resolve(ConnectionCheckRecorder);

    expect(first).toBeInstanceOf(ConnectionCheckRecorder);
    expect(second).toBe(first);
  });
});
