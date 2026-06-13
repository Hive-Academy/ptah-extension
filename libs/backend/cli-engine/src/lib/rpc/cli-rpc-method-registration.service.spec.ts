import 'reflect-metadata';

import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';

import { __CLI_EXCLUDED_RPC_METHODS_FOR_TEST } from './cli-rpc-method-registration.service';

const THOTH_NAMESPACES = [
  'cron:',
  'gateway:',
  'voice:',
  'memory:',
  'mem:',
  'corpus:',
  'skillSynthesis:',
  'db:',
  'embedder:',
  'indexing:',
] as const;

const WEBVIEW_ONLY_PREFIXES = [
  'file:',
  'command:',
  'editor:',
  'layout:',
  'terminal:',
] as const;

function hasAllowedPrefix(method: string): boolean {
  return ALLOWED_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix));
}

describe('CLI RPC registration coherence', () => {
  const registry = new Set<string>(RPC_METHOD_NAMES);
  const excluded = new Set<string>(__CLI_EXCLUDED_RPC_METHODS_FOR_TEST);

  it('excludes only methods that exist in the shared RPC registry', () => {
    const stale = [...excluded].filter((method) => !registry.has(method));
    expect(stale).toEqual([]);
  });

  it('only excludes webview-only surface methods', () => {
    const offenders = [...excluded].filter(
      (method) => !WEBVIEW_ONLY_PREFIXES.some((p) => method.startsWith(p)),
    );
    expect(offenders).toEqual([]);
  });

  it('does not exclude any Thoth namespace method', () => {
    const excludedThoth = [...excluded].filter((method) =>
      THOTH_NAMESPACES.some((ns) => method.startsWith(ns)),
    );
    expect(excludedThoth).toEqual([]);
  });

  it('every non-excluded registry method has an allowed runtime prefix', () => {
    const unroutable = [...registry].filter(
      (method) => !excluded.has(method) && !hasAllowedPrefix(method),
    );
    expect(unroutable).toEqual([]);
  });

  it('every Thoth method in the registry is prefix-allowed and exposed', () => {
    const thothMethods = [...registry].filter((method) =>
      THOTH_NAMESPACES.some((ns) => method.startsWith(ns)),
    );
    expect(thothMethods.length).toBeGreaterThan(0);
    for (const method of thothMethods) {
      expect(hasAllowedPrefix(method)).toBe(true);
      expect(excluded.has(method)).toBe(false);
    }
  });

  it('exposes every Thoth namespace at least once', () => {
    for (const ns of THOTH_NAMESPACES) {
      const exposed = [...registry].some(
        (method) => method.startsWith(ns) && !excluded.has(method),
      );
      expect(exposed).toBe(true);
    }
  });
});
