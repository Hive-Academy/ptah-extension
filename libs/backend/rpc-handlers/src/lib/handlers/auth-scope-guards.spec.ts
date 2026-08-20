import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

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

// ---------------------------------------------------------------------------
// AC-12 — Marketplace gate: contributes.configuration has no app.* keys
// and no trademarked AI product names.
// ---------------------------------------------------------------------------

describe('AC-12 — package.json contributes.configuration marketplace gate', () => {
  let configProperties: Record<string, unknown>;

  beforeAll(() => {
    const pkgPath = path.resolve(
      __dirname,
      '../../../../../../apps/ptah-extension-vscode/package.json',
    );

    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      contributes?: {
        configuration?: {
          properties?: Record<string, unknown>;
        };
      };
    };

    configProperties = pkg.contributes?.configuration?.properties ?? {};
  });

  it('no configuration property key starts with "app."', () => {
    const appKeys = Object.keys(configProperties).filter((k) =>
      k.startsWith('app.'),
    );
    expect(appKeys).toHaveLength(0);
  });

  it('no configuration property key contains "copilot"', () => {
    const flagged = Object.keys(configProperties).filter((k) =>
      k.toLowerCase().includes('copilot'),
    );
    expect(flagged).toHaveLength(0);
  });

  it('no configuration property key contains "codex"', () => {
    const flagged = Object.keys(configProperties).filter((k) =>
      k.toLowerCase().includes('codex'),
    );
    expect(flagged).toHaveLength(0);
  });

  it('no configuration property key contains "claude"', () => {
    const flagged = Object.keys(configProperties).filter((k) =>
      k.toLowerCase().includes('claude'),
    );
    expect(flagged).toHaveLength(0);
  });

  it('no configuration property key contains "openai"', () => {
    const flagged = Object.keys(configProperties).filter((k) =>
      k.toLowerCase().includes('openai'),
    );
    expect(flagged).toHaveLength(0);
  });

  it('no configuration property key contains "anthropic"', () => {
    const flagged = Object.keys(configProperties).filter((k) =>
      k.toLowerCase().includes('anthropic'),
    );
    expect(flagged).toHaveLength(0);
  });
});
