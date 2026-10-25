import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { guardRuntimeComposition } from './codex-runtime-composition';
import { CodexRuntimeCompositionError } from './codex-runtime-composition-error';
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

describe('stable host bindings', () => {
  const tokens = [
    SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
    SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
    SDK_TOKENS.RUNTIME_ADMISSION_PORT,
    SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
    SDK_TOKENS.CODEX_CHAT_ADAPTER,
  ];
  it.each(tokens)('names unstable useFactory token %s', (token) => {
    const scope = container.createChildContainer();
    for (const guarded of tokens) scope.registerInstance(guarded, {});
    scope.register(token, { useFactory: () => ({}) });
    const assertComposition = guardRuntimeComposition(scope);
    assertComposition();
    expect(assertComposition).toThrow(CodexRuntimeCompositionError);
    expect(assertComposition).toThrow(
      expect.objectContaining({
        code: 'unstable-binding',
        token: token.description,
        message: expect.stringContaining('bind a stable instance'),
      }),
    );
  });
});
