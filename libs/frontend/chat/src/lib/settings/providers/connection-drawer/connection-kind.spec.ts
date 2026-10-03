import type { ProvidersConnection } from '@ptah-extension/core';
import { connectionDrawerTabs, connectionKind, type ConnectionKind } from './connection-kind';

type KindInput = Pick<ProvidersConnection, 'authMode' | 'custom'>;

describe('connectionKind', () => {
  it.each<[string, KindInput, ConnectionKind]>([
    ['Claude subscription (native CLI)', { authMode: 'cli', custom: false }, 'claude-cli'],
    ['Claude API / Moonshot / Ollama Cloud (key)', { authMode: 'apiKey', custom: false }, 'api-key'],
    ['GitHub Copilot / OpenAI Codex (sign-in)', { authMode: 'oauth', custom: false }, 'oauth'],
    ['Ollama (local, native)', { authMode: 'local-native', custom: false }, 'local'],
    ['LM Studio (local, proxied)', { authMode: 'local-proxy', custom: false }, 'local'],
    ['a draft custom endpoint', { authMode: 'custom', custom: false }, 'custom'],
  ])('%s → %s', (_name, connection, kind) => {
    expect(connectionKind(connection)).toBe(kind);
  });

  it('an unknown auth mode from the host falls back to api-key, so the drawer always has tabs', () => {
    const unknown = { authMode: 'passkey', custom: false } as unknown as KindInput;
    expect(connectionKind(unknown)).toBe('api-key');
    expect(connectionDrawerTabs(connectionKind(unknown)).map((tab) => tab.id)).toEqual(['overview', 'credentials', 'models']);
  });

  it.each<KindInput['authMode']>(['apiKey', 'local-native', 'local-proxy', 'oauth', 'cli'])(
    'a user-defined entry is custom whatever its auth mode (%s)',
    (authMode) => {
      expect(connectionKind({ authMode, custom: true })).toBe('custom');
    },
  );
});

describe('connectionDrawerTabs', () => {
  const ids = (kind: ConnectionKind) => connectionDrawerTabs(kind).map((tab) => tab.id);

  it.each<ConnectionKind>(['claude-cli', 'api-key', 'oauth', 'local'])(
    '%s has Overview, Credentials and Models & Tiers, and no Advanced tab',
    (kind) => {
      expect(ids(kind)).toEqual(['overview', 'credentials', 'models']);
    },
  );

  it('custom adds the Advanced tab last', () => {
    expect(ids('custom')).toEqual(['overview', 'credentials', 'models', 'advanced']);
  });

  it('labels the tabs as the drawer shows them, with none disabled', () => {
    const tabs = connectionDrawerTabs('custom');
    expect(tabs.map((tab) => tab.label)).toEqual(['Overview & Used By', 'Credentials', 'Models & Tiers', 'Advanced']);
    expect(tabs.some((tab) => tab.disabled)).toBe(false);
  });
});
