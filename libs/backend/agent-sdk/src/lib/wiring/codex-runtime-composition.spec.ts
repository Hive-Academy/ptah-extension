import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import {
  registerCodexChatServices,
  wireAgentAdapterAliases,
} from '../di/register';

describe('runtime composition order', () => {
  it.each([
    SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
    SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
    SDK_TOKENS.RUNTIME_ADMISSION_PORT,
    SDK_TOKENS.CODEX_CHAT_ADAPTER,
  ])('rejects late host binding after SDK resolution (%s)', (token) => {
    const scope = container.createChildContainer();
    scope.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, {});
    registerCodexChatServices(scope);
    wireAgentAdapterAliases(scope);
    scope.resolve(TOKENS.AGENT_ADAPTER);
    scope.registerInstance(token, {});
    expect(() => scope.resolve(TOKENS.AGENT_ADAPTER)).toThrow(
      'Runtime ports must be bound',
    );
    expect(() => scope.resolve(SDK_TOKENS.ROUTING_AGENT_ADAPTER)).toThrow(
      'Runtime ports must be bound',
    );
  });
});
