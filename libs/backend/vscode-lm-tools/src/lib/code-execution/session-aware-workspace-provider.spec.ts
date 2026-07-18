/**
 * Specs for buildSessionAwareWorkspaceProvider.
 *
 * The wrapper must:
 *   - route getWorkspaceRoot() through the session-aware resolver
 *   - fall back to whatever the resolver returns (including undefined)
 *   - re-evaluate the resolver on every call (no caching of a stale root)
 *   - delegate every other member to the real provider with the correct `this`
 */

import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { buildSessionAwareWorkspaceProvider } from './session-aware-workspace-provider';

function makeBaseProvider(root: string | undefined): {
  provider: IWorkspaceProvider;
  folders: string[];
} {
  const folders = ['D:/ws-a', 'D:/ws-b'];
  const provider = {
    getWorkspaceRoot: jest.fn(() => root),
    getWorkspaceFolders: jest.fn(function (this: unknown) {
      // `this` must be the real provider for delegated methods.
      return folders;
    }),
    getConfiguration: jest.fn(
      (_section: string, _key: string, dflt?: unknown) => dflt,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
  return { provider, folders };
}

describe('buildSessionAwareWorkspaceProvider', () => {
  it('resolves getWorkspaceRoot() via the resolver, not the base provider', () => {
    const { provider } = makeBaseProvider('D:/ws-a');
    const wrapped = buildSessionAwareWorkspaceProvider(
      provider,
      () => 'D:/session-ws',
    );

    expect(wrapped.getWorkspaceRoot()).toBe('D:/session-ws');
    // Base root must be bypassed entirely.
    expect(provider.getWorkspaceRoot).not.toHaveBeenCalled();
  });

  it('returns undefined when the resolver yields undefined', () => {
    const { provider } = makeBaseProvider('D:/ws-a');
    const wrapped = buildSessionAwareWorkspaceProvider(
      provider,
      () => undefined,
    );

    expect(wrapped.getWorkspaceRoot()).toBeUndefined();
  });

  it('re-evaluates the resolver on each call (no stale caching)', () => {
    const { provider } = makeBaseProvider(undefined);
    let current = 'D:/ws-a';
    const wrapped = buildSessionAwareWorkspaceProvider(provider, () => current);

    expect(wrapped.getWorkspaceRoot()).toBe('D:/ws-a');
    current = 'D:/ws-b';
    expect(wrapped.getWorkspaceRoot()).toBe('D:/ws-b');
  });

  it('delegates other members to the base provider with the correct `this`', () => {
    const { provider, folders } = makeBaseProvider('D:/ws-a');
    const wrapped = buildSessionAwareWorkspaceProvider(
      provider,
      () => 'D:/session-ws',
    );

    // Non-overridden method returns the base provider's value, bound correctly.
    expect(wrapped.getWorkspaceFolders()).toEqual(folders);
    expect(wrapped.getConfiguration('ptah', 'x', 'fallback')).toBe('fallback');
    // Event members (functions) delegate: subscribing via the wrapper forwards
    // to the real provider's event.
    const cb = jest.fn();
    (wrapped.onDidChangeWorkspaceFolders as unknown as jest.Mock)(cb);
    expect(provider.onDidChangeWorkspaceFolders).toHaveBeenCalledWith(cb);
  });
});
