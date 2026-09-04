/**
 * Specs for resolveSessionWorkspaceRoot precedence:
 *   declared workspace → caller session → active session → platform provider
 *   → undefined.
 */

import {
  resolveSessionWorkspaceRoot,
  type WorkspaceRootResolverDeps,
} from './workspace-root-resolver';

function deps(
  over: Partial<WorkspaceRootResolverDeps>,
): WorkspaceRootResolverDeps {
  return {
    getCallerSessionId: () => undefined,
    getSessionWorkspace: () => undefined,
    getActiveSessionWorkspace: () => undefined,
    getProviderRoot: () => undefined,
    ...over,
  };
}

describe('resolveSessionWorkspaceRoot', () => {
  it('prefers the DECLARED workspace over every inferred tier', () => {
    // A caller that states its workspace outranks one we infer from a session.
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerWorkspaceRoot: () => 'D:\\projects\\ptah-extension',
        getCallerSessionId: () => 'sess-B',
        getSessionWorkspace: () => 'D:/ws-B',
        getActiveSessionWorkspace: () => 'D:/ws-A',
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:\\projects\\ptah-extension');
  });

  it('keeps the old precedence when the declared-workspace getter is absent', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerSessionId: () => 'sess-B',
        getSessionWorkspace: (id) => (id === 'sess-B' ? 'D:/ws-B' : undefined),
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:/ws-B');
  });

  it('falls through to the caller session when nothing was declared', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerWorkspaceRoot: () => undefined,
        getCallerSessionId: () => 'sess-B',
        getSessionWorkspace: (id) => (id === 'sess-B' ? 'D:/ws-B' : undefined),
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:/ws-B');
  });

  it('treats an empty-string declared workspace as not declared', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerWorkspaceRoot: () => '',
        getActiveSessionWorkspace: () => 'D:/ws-A',
      }),
    );
    expect(result).toBe('D:/ws-A');
  });

  it('degrades to the provider root if the declared-workspace getter throws', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerWorkspaceRoot: () => {
          throw new Error('context blew up');
        },
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:/ws-global');
  });

  it('prefers the caller session workspace over everything else', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerSessionId: () => 'sess-B',
        getSessionWorkspace: (id) => (id === 'sess-B' ? 'D:/ws-B' : undefined),
        getActiveSessionWorkspace: () => 'D:/ws-A',
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:/ws-B');
  });

  it('falls back to the active session when there is no caller id', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerSessionId: () => undefined,
        getActiveSessionWorkspace: () => 'D:/ws-A',
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:/ws-A');
  });

  it('falls back to active when the caller session has no projectPath', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerSessionId: () => 'sess-unknown',
        getSessionWorkspace: () => undefined,
        getActiveSessionWorkspace: () => 'D:/ws-A',
      }),
    );
    expect(result).toBe('D:/ws-A');
  });

  it('falls back to the platform provider when no session resolves', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({ getProviderRoot: () => 'D:/ws-global' }),
    );
    expect(result).toBe('D:/ws-global');
  });

  it('returns undefined when nothing resolves', () => {
    expect(resolveSessionWorkspaceRoot(deps({}))).toBeUndefined();
  });

  it('normalizes an empty-string provider root to undefined', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({ getProviderRoot: () => '' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to the provider root if a session lookup throws', () => {
    const result = resolveSessionWorkspaceRoot(
      deps({
        getCallerSessionId: () => 'sess-B',
        getSessionWorkspace: () => {
          throw new Error('registry blew up');
        },
        getProviderRoot: () => 'D:/ws-global',
      }),
    );
    expect(result).toBe('D:/ws-global');
  });
});
