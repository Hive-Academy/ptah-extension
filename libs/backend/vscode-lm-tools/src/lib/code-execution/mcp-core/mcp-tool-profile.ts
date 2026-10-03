import { MCP_TOOL_PROFILES, type McpToolProfile } from '@ptah-extension/shared';
import type { MCPRequest } from './types/mcp-protocol.types';
import { DASHBOARD_PROPOSE_SPEC_TOOL_NAME } from './dashboard-propose-spec.tool';
import {
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
} from './surface-tools';

export const APPS_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
]);

/** URL-derived profile; unknown or absent values can only shrink the tool set. */
export function resolveMcpToolProfile(
  request: Pick<MCPRequest, '_callerToolProfile'>,
): McpToolProfile {
  return (
    MCP_TOOL_PROFILES.find(
      (profile) => profile === request._callerToolProfile,
    ) ?? 'coding'
  );
}

/** Actionable tool error for a coding-profile call to an Apps-only tool. */
export function appsOnlyToolMessage(name: string): string {
  return `${name} is available on the Apps page only. This session uses the coding tool profile; present results as text.`;
}

/**
 * Guard every namespace method at invocation time, including captured methods
 * and methods read through property descriptors. Both namespaces are async, so
 * a refusal is a rejected promise.
 */
export function withAppsNamespaceProfile<T extends object>(
  name: 'dashboard' | 'surface',
  namespace: T,
  getCallerToolProfile: () => McpToolProfile,
): T {
  const guard = (target: T, property: string | symbol, value: unknown) => {
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) =>
      getCallerToolProfile() === 'apps'
        ? Reflect.apply(value, target, args)
        : Promise.reject(
            new Error(appsOnlyToolMessage(`ptah.${name}.${String(property)}`)),
          );
  };
  return new Proxy(namespace, {
    get(target, property, receiver) {
      return guard(target, property, Reflect.get(target, property, receiver));
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (!descriptor || !('value' in descriptor) || !descriptor.configurable) {
        return descriptor;
      }
      return { ...descriptor, value: guard(target, property, descriptor.value) };
    },
  });
}
