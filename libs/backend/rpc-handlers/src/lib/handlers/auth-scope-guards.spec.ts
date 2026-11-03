import 'reflect-metadata';

// ---------------------------------------------------------------------------
// AC-11 — RPC dual-registration invariant: no new method names, auth:/config:
// prefixes already in ALLOWED_METHOD_PREFIXES. No ENOSPC on ALLOWED_METHOD_PREFIXES.
// ---------------------------------------------------------------------------

import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';

describe('AC-11 — ALLOWED_METHOD_PREFIXES contains auth: and config:', () => {
  it('auth: prefix is in ALLOWED_METHOD_PREFIXES', () => {
    expect(
      (ALLOWED_METHOD_PREFIXES as readonly string[]).includes('auth:'),
    ).toBe(true);
  });

  it('config: prefix is in ALLOWED_METHOD_PREFIXES', () => {
    expect(
      (ALLOWED_METHOD_PREFIXES as readonly string[]).includes('config:'),
    ).toBe(true);
  });

  it('no new app-scope-specific method prefix was added', () => {
    const appScopePrefixes = (
      ALLOWED_METHOD_PREFIXES as readonly string[]
    ).filter((p) => p.startsWith('appScope') || p.startsWith('scope:'));
    expect(appScopePrefixes).toHaveLength(0);
  });
});
