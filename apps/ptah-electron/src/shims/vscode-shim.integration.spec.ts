/**
 * Integration spec — real consumers run against the Electron vscode shim.
 *
 * Strategy: override the 'vscode' moduleNameMapper (which normally points to
 * __mocks__/vscode.ts) by calling jest.mock('vscode', factory) before any
 * imports are resolved. Jest's mock factory takes precedence over
 * moduleNameMapper, so ConfigManager and friends will load the real shim.
 *
 * Pre-fix failure analysis:
 *   - getWithDefault test would have failed because the pre-fix shim's
 *     get() returned undefined, causing PtahCliConfigPersistence to crash
 *     with "Cannot read properties of undefined (reading 'length')".
 *   - ConfigWatcher.dispose() test would have failed because the pre-fix
 *     shim's Disposable had no callable dispose(), producing
 *     "e.dispose is not a function".
 *
 * Deps stubbed by hand (minimal):
 *   - Logger: plain object with no-op info/debug/warn/error
 *   - IAuthSecretsService: resolves to undefined for all key operations
 *   - ISecretStorage: no-op onDidChange that returns a disposable
 */

// Override 'vscode' BEFORE any module under test is imported so that
// ConfigManager's top-level `import * as vscode from 'vscode'` gets the shim.
jest.mock('vscode', () => require('./vscode-shim'));

import 'reflect-metadata';

import { ConfigManager } from '@ptah-extension/vscode-core';
// Deep imports into agent-sdk are intentional: these internal classes are the
// real consumers exercised against the shim, and adding them to the public
// barrel just to satisfy a test would leak implementation detail.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ConfigWatcher } from '../../../../libs/backend/agent-sdk/src/lib/helpers/config-watcher';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { PtahCliConfigPersistence } from '../../../../libs/backend/agent-sdk/src/lib/ptah-cli/helpers/ptah-cli-config-persistence.service';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';

// ---------------------------------------------------------------------------
// Minimal stubs — hand-rolled to avoid pulling the full DI container.
// ---------------------------------------------------------------------------

/** Logger stub: all methods are no-ops. */
function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** IAuthSecretsService stub: all secret operations resolve to undefined/void. */
function makeAuthSecrets() {
  return {
    getProviderKey: jest.fn().mockResolvedValue(undefined),
    setProviderKey: jest.fn().mockResolvedValue(undefined),
    deleteProviderKey: jest.fn().mockResolvedValue(undefined),
  };
}

/** ISecretStorage stub: onDidChange returns a disposable, other ops are no-ops. */
function makeSecretStorage(): ISecretStorage {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  } as unknown as ISecretStorage;
}

// ---------------------------------------------------------------------------
// Helpers to construct instances without tsyringe (manual injection).
// ---------------------------------------------------------------------------

function buildConfigManager(): ConfigManager {
  // ConfigManager's constructor calls vscode.workspace.onDidChangeConfiguration.
  // With the shim this returns { dispose: () => {} } — no crash.
  return new ConfigManager();
}

function buildConfigWatcher(
  config: ConfigManager,
  secretStorage: ISecretStorage,
): ConfigWatcher {
  return new ConfigWatcher(makeLogger(), config, secretStorage);
}

function buildPtahCliConfigPersistence(
  config: ConfigManager,
): PtahCliConfigPersistence {
  return new PtahCliConfigPersistence(
    makeLogger(),
    config,
    makeAuthSecrets() as never,
  );
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('ConfigManager + shim — getWithDefault', () => {
  it('returns the defaultValue (not undefined) for an unset key', () => {
    const cm = buildConfigManager();
    const result = cm.getWithDefault('customAgents', []);
    // Pre-fix: shim returned undefined → crash downstream (.length).
    // Post-fix: shim returns defaultValue.
    expect(result).toEqual([]);
  });

  it('returns string default for an unset string key', () => {
    const cm = buildConfigManager();
    expect(cm.getWithDefault('authMethod', 'default')).toBe('default');
  });

  it('returns numeric default for an unset numeric key', () => {
    const cm = buildConfigManager();
    expect(cm.getWithDefault('timeout', 5000)).toBe(5000);
  });

  it('get() returns undefined for an unset key (no default)', () => {
    const cm = buildConfigManager();
    expect(cm.get('unknownKey')).toBeUndefined();
  });
});

describe('ConfigWatcher + shim — dispose does not throw', () => {
  it('registerWatchers then dispose() does not throw "e.dispose is not a function"', () => {
    // Pre-fix: ConfigManager.watch returned new vscode.Disposable(fn) where
    // Disposable had no dispose() method → watcher.dispose() crashed.
    const cm = buildConfigManager();
    const cw = buildConfigWatcher(cm, makeSecretStorage());

    cw.registerWatchers(async () => {
      // no-op reinit callback
    });

    // This is the exact call that crashed in production.
    expect(() => cw.dispose()).not.toThrow();
  });

  it('dispose() without prior registerWatchers does not throw', () => {
    const cm = buildConfigManager();
    const cw = buildConfigWatcher(cm, makeSecretStorage());
    expect(() => cw.dispose()).not.toThrow();
  });

  it('getWatcherCount returns 0 after dispose', () => {
    const cm = buildConfigManager();
    const cw = buildConfigWatcher(cm, makeSecretStorage());
    cw.registerWatchers(async () => {
      /* noop reinit */
    });
    cw.dispose();
    expect(cw.getWatcherCount()).toBe(0);
  });

  it('registerWatchers populates watchers (count > 0 before dispose)', () => {
    const cm = buildConfigManager();
    const cw = buildConfigWatcher(cm, makeSecretStorage());
    cw.registerWatchers(async () => {
      /* noop reinit */
    });
    expect(cw.getWatcherCount()).toBeGreaterThan(0);
    cw.dispose(); // cleanup
  });
});

describe('PtahCliConfigPersistence + shim — ensureMigrated', () => {
  it('ensureMigrated() resolves without throwing when no legacy configs exist', async () => {
    // Pre-fix: getWithDefault returned undefined → legacyConfigs.length crashed.
    // Post-fix: getWithDefault returns [] → length is 0 → early return.
    const cm = buildConfigManager();
    const persistence = buildPtahCliConfigPersistence(cm);

    await expect(persistence.ensureMigrated()).resolves.toBeUndefined();
  });

  it('loadConfigs() returns an empty array (not undefined)', () => {
    const cm = buildConfigManager();
    const persistence = buildPtahCliConfigPersistence(cm);
    const result = persistence.loadConfigs();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('ensureMigrated() is idempotent — calling twice resolves both times', async () => {
    const cm = buildConfigManager();
    const persistence = buildPtahCliConfigPersistence(cm);

    await expect(persistence.ensureMigrated()).resolves.toBeUndefined();
    await expect(persistence.ensureMigrated()).resolves.toBeUndefined();
  });
});
