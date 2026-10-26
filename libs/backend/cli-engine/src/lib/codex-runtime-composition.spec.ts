import 'reflect-metadata';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { container as rootContainer } from 'tsyringe';
import {
  registerSdkServices,
  SDK_TOKENS,
  wireAgentAdapterAliases,
} from '@ptah-extension/agent-sdk';
import { CODEX_RUNTIME_TOKENS } from '@ptah-extension/codex-runtime';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

/** Real SDK registration and alias wiring; no full CLI bootstrap or SDK process. */
function composeCliChat() {
  const container = rootContainer.createChildContainer();
  container.register(TOKENS.LOGGER, {
    useValue: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  });
  container.register(TOKENS.CONFIG_MANAGER, {
    useValue: { watch: jest.fn(() => ({ dispose: jest.fn() })) },
  });
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: { onDidChange: jest.fn(() => ({ dispose: jest.fn() })) },
  });
  registerSdkServices(container, container.resolve<Logger>(TOKENS.LOGGER));
  // Replace only the process-owning adapter: the alias must return this exact
  // registered legacy instance, without constructing or starting an SDK session.
  const legacyAdapter = { initialize: jest.fn() };
  container.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, legacyAdapter);
  wireAgentAdapterAliases(container);
  return { container, legacyAdapter };
}

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}

describe('CLI legacy Codex composition (Batch 8e)', () => {
  it.each([undefined, '1'])(
    'stays legacy with PTAH_CODEX_RUNTIME_DEV=%s',
    async (override) => {
      const previous = process.env['PTAH_CODEX_RUNTIME_DEV'];
      if (override === undefined) delete process.env['PTAH_CODEX_RUNTIME_DEV'];
      else process.env['PTAH_CODEX_RUNTIME_DEV'] = override;
      const { container, legacyAdapter } = composeCliChat();
      try {
        for (const token of [
          SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
          SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
          SDK_TOKENS.RUNTIME_ADMISSION_PORT,
          SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
          SDK_TOKENS.NATIVE_SESSION_CONTROLS,
          SDK_TOKENS.LEGACY_SESSION_CONTROLS,
          SDK_TOKENS.SESSION_RUNTIME_ROUTER,
          SDK_TOKENS.CODEX_CHAT_ADAPTER,
          SDK_TOKENS.ROUTING_AGENT_ADAPTER,
        ]) {
          expect(container.isRegistered(token)).toBe(true);
          expect(container.resolve(token)).toBeNull();
        }
        expect(container.resolve(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES)).toEqual(
          { nativeCodex: false },
        );
        for (const token of Object.values(CODEX_RUNTIME_TOKENS)) {
          expect(container.isRegistered(token, true)).toBe(false);
        }
        expect(container.resolve(TOKENS.AGENT_ADAPTER)).toBe(legacyAdapter);
        expect(container.resolve(TOKENS.AGENT_ADAPTER)).toBe(legacyAdapter);
        expect(legacyAdapter.initialize).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined)
          delete process.env['PTAH_CODEX_RUNTIME_DEV'];
        else process.env['PTAH_CODEX_RUNTIME_DEV'] = previous;
        await container.dispose();
      }
    },
  );

  it('pins the CLI call sites and excludes native bindings and dev routes, including lanes/gateways', () => {
    const source = readFileSync(join(__dirname, 'container.ts'), 'utf8');
    expect(source).toContain('registerSdkServices(container, logger)');
    expect(source).toContain('wireAgentAdapterAliases(container)');
    expect(
      source.indexOf('registerSdkServices(container, logger)'),
    ).toBeLessThan(source.indexOf('wireAgentAdapterAliases(container)'));
    for (const production of productionSources(__dirname)) {
      expect(production).not.toMatch(
        /readCodexDevRouteOverride|registerCodexRuntime|CODEX_RUNTIME_TOKENS|\bdevRoute\s*:/,
      );
      expect(production).not.toMatch(
        /SDK_TOKENS\.(SESSION_RUNTIME_IDENTITY_LOOKUP|CODEX_CHAT_ADAPTER_PORTS|RUNTIME_ADMISSION_PORT|RUNTIME_HOST_CAPABILITIES|LEGACY_SESSION_CONTROL_PORTS|NATIVE_SESSION_CONTROLS)\b/,
      );
    }
  });
});
