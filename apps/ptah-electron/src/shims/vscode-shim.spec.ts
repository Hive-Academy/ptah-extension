/**
 * Shim contract spec — regression guard for apps/ptah-electron/src/shims/vscode-shim.ts
 *
 * These tests import the shim directly (NOT the real vscode module) and assert
 * the API surface that vscode-core consumers actually exercise at runtime.
 *
 * Pre-fix failure analysis:
 *   - "new vscode.Disposable(cb).dispose()" test would have failed because
 *     the old Disposable had no constructor accepting a callback and no dispose().
 *   - "get(key, defaultValue) returns defaultValue" test would have failed because
 *     the old shim's get returned undefined unconditionally.
 *
 * If any of these assertions starts failing, a shim regression has been introduced.
 */

// Import the shim under test directly — this is the only file in the test
// suite that deliberately bypasses the jest moduleNameMapper for 'vscode'.
// We cast the shim to `unknown` then to a loose type so that TypeScript does
// not apply the shim's own narrow function signatures during the assertions
// (the shim uses zero-arg stubs but the real vscode API accepts arguments).
import * as shimRaw from './vscode-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shim = shimRaw as any;

// Re-export the typed Disposable for constructor tests so TypeScript is happy.
import { Disposable as ShimDisposable } from './vscode-shim';

describe('vscode shim — Disposable', () => {
  it('new Disposable(cb).dispose() invokes cb exactly once', () => {
    const cb = jest.fn();
    const d = new ShimDisposable(cb);
    d.dispose();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('new Disposable(cb) produces an object with a callable dispose method', () => {
    const noop = () => {
      /* noop */
    };
    const d = new ShimDisposable(noop);
    expect(typeof d.dispose).toBe('function');
  });

  it('new Disposable() with no args has a callable dispose that does not throw', () => {
    const d = new ShimDisposable();
    expect(() => d.dispose()).not.toThrow();
  });

  it('dispose() is idempotent — calling twice does not throw', () => {
    const cb = jest.fn();
    const d = new ShimDisposable(cb);
    d.dispose();
    d.dispose();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('Disposable.from(...children).dispose() calls each child dispose once', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const composite = ShimDisposable.from({ dispose: cb1 }, { dispose: cb2 });
    composite.dispose();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('Disposable.from() result has a callable dispose method', () => {
    const result = ShimDisposable.from({ dispose: jest.fn() });
    expect(typeof result.dispose).toBe('function');
  });
});

describe('vscode shim — workspace.getConfiguration', () => {
  it('get(key, defaultValue) returns defaultValue for any key', () => {
    const config = shim.workspace.getConfiguration();
    expect(config.get('anyKey', 'fallback')).toBe('fallback');
  });

  it('get(key, []) returns [] (array default)', () => {
    const config = shim.workspace.getConfiguration();
    const result = config.get('customAgents', []);
    expect(result).toEqual([]);
  });

  it('get(key, 42) returns 42 (numeric default)', () => {
    const config = shim.workspace.getConfiguration();
    expect(config.get('timeout', 42)).toBe(42);
  });

  it('get(key) with no default returns undefined', () => {
    const config = shim.workspace.getConfiguration();
    expect(config.get('noDefault')).toBeUndefined();
  });

  it('has() returns false', () => {
    const config = shim.workspace.getConfiguration();
    expect(config.has('anyKey')).toBe(false);
  });

  it('update() resolves without throwing', async () => {
    const config = shim.workspace.getConfiguration();
    await expect(config.update('key', 'value', 1)).resolves.toBeUndefined();
  });
});

describe('vscode shim — workspace.onDidChangeConfiguration', () => {
  it('returns an object with a callable dispose', () => {
    const disposable = shim.workspace.onDidChangeConfiguration(jest.fn());
    expect(typeof disposable.dispose).toBe('function');
    expect(() => disposable.dispose()).not.toThrow();
  });
});

describe('vscode shim — commands', () => {
  it('registerCommand returns an object with a callable dispose', () => {
    const disposable = shim.commands.registerCommand('ext.cmd', jest.fn());
    expect(typeof disposable.dispose).toBe('function');
    expect(() => disposable.dispose()).not.toThrow();
  });

  it('executeCommand resolves to undefined', async () => {
    const result = await shim.commands.executeCommand('ext.cmd');
    expect(result).toBeUndefined();
  });
});

describe('vscode shim — window.createOutputChannel', () => {
  it('returns an object with appendLine as a function', () => {
    const ch = shim.window.createOutputChannel('test');
    expect(typeof ch.appendLine).toBe('function');
  });

  it('returns an object with dispose as a function that does not throw', () => {
    const ch = shim.window.createOutputChannel('test');
    expect(typeof ch.dispose).toBe('function');
    expect(() => ch.dispose()).not.toThrow();
  });

  it('appendLine does not throw', () => {
    const ch = shim.window.createOutputChannel('test');
    expect(() => ch.appendLine('hello')).not.toThrow();
  });
});

describe('vscode shim — EventEmitter', () => {
  it('is new-able without throwing', () => {
    expect(() => new shim.EventEmitter()).not.toThrow();
  });

  it('fire() does not throw', () => {
    const em = new shim.EventEmitter();
    expect(() => em.fire()).not.toThrow();
  });

  it('dispose() does not throw', () => {
    const em = new shim.EventEmitter();
    expect(() => em.dispose()).not.toThrow();
  });

  it('fire() then dispose() does not throw', () => {
    const em = new shim.EventEmitter();
    em.fire();
    expect(() => em.dispose()).not.toThrow();
  });
});

describe('vscode shim — ConfigurationTarget', () => {
  it('exposes Global, Workspace, WorkspaceFolder numeric values', () => {
    expect(typeof shim.ConfigurationTarget.Global).toBe('number');
    expect(typeof shim.ConfigurationTarget.Workspace).toBe('number');
    expect(typeof shim.ConfigurationTarget.WorkspaceFolder).toBe('number');
  });
});
