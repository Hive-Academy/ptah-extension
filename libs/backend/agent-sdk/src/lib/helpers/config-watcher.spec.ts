/**
 * ConfigWatcher — which secret writes re-initialize the SDK adapter.
 *
 * A re-initialization disposes every live chat session. On 2026-10-13 an MCP
 * OAuth token refresh inside `chat:start` wrote
 * `ptah.auth.provider.mcp.oauth.*`, which matched the old `ptah.auth.` check
 * and stopped every running chat plus the session being started.
 */

import 'reflect-metadata';
import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import type {
  ISecretStorage,
  SecretChangeEvent,
} from '@ptah-extension/platform-core';

import { ConfigWatcher } from './config-watcher';
import type { SdkAdapterEvents } from './sdk-adapter-events.service';

function makeWatcher(): {
  fireSecret: (key: string) => void;
  emitConfigChanged: jest.Mock;
} {
  let listener: ((event: SecretChangeEvent) => void) | undefined;
  const secretStorage = {
    onDidChange: jest.fn((cb: (event: SecretChangeEvent) => void) => {
      listener = cb;
      return { dispose: jest.fn() };
    }),
  } as unknown as ISecretStorage;
  const config = {
    watch: jest.fn(() => ({ dispose: jest.fn() })),
  } as unknown as ConfigManager;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const emitConfigChanged = jest.fn();
  const events = {
    onDisposed: jest.fn(() => () => undefined),
    emitConfigChanged,
  } as unknown as SdkAdapterEvents;

  new ConfigWatcher(logger, config, secretStorage, events);

  return {
    fireSecret: (key) => listener?.({ key } as SecretChangeEvent),
    emitConfigChanged,
  };
}

describe('ConfigWatcher secret filter', () => {
  it.each([
    'ptah.auth.provider.mcp.oauth.oauth-mcp.heygen.com-mcp-hyperframes',
    'ptah.auth.provider.smithery.config.github',
    'ptah.auth.provider.ptahCli.pc-1234',
  ])('does not emit configChanged for the non-auth slot %s', (key) => {
    const w = makeWatcher();
    w.fireSecret(key);
    expect(w.emitConfigChanged).not.toHaveBeenCalled();
  });

  it.each(['ptah.auth.anthropicApiKey', 'ptah.auth.provider.openrouter'])(
    'emits configChanged for the auth secret %s',
    (key) => {
      const w = makeWatcher();
      w.fireSecret(key);
      expect(w.emitConfigChanged).toHaveBeenCalledWith(
        expect.objectContaining({ key }),
      );
    },
  );
});
