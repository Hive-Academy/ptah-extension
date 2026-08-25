/**
 * Session-aware workspace provider wrapper.
 *
 * Path-resolving agent namespaces (ast/files/context/json) must resolve a
 * relative path against the workspace of the session that invoked the tool, not
 * the process-global active folder — otherwise a tool call from one workspace
 * silently reads files from another when several workspaces are open in
 * Electron. This wraps the platform `IWorkspaceProvider` so `getWorkspaceRoot()`
 * routes through a session-aware resolver while every other member (folders,
 * configuration, events) delegates to the real provider unchanged.
 */

import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Return a proxy over `base` whose `getWorkspaceRoot()` calls `resolveRoot`
 * (session-aware). All other members delegate to `base` with the correct
 * `this`, so future `IWorkspaceProvider` additions keep working without changes
 * here.
 */
export function buildSessionAwareWorkspaceProvider(
  base: IWorkspaceProvider,
  resolveRoot: () => string | undefined,
): IWorkspaceProvider {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'getWorkspaceRoot') {
        return resolveRoot;
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
