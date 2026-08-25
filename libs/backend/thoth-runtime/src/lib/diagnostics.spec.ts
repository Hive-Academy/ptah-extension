import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { VecLoadDiagnostic } from '@ptah-extension/persistence-sqlite';
import type { EmbedderStatusSnapshot } from '@ptah-extension/memory-curator';

import {
  emitVecLoadDiagnostic,
  resetVecLoadDiagnosticForTest,
  serializeEmbedderSnapshotForBridge,
  serializeVecDiagnosticForBridge,
} from './diagnostics';

function makeContainer(entries: Array<readonly [unknown, unknown]>) {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) {
        throw new Error(`not registered: ${String(token)}`);
      }
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

const OK_DIAGNOSTIC = {
  ok: true,
  reason: 'loaded',
  electronVersion: '40.0.0',
  processArch: 'x64',
  processPlatform: 'win32',
} as unknown as VecLoadDiagnostic;

const FAILED_DIAGNOSTIC = {
  ok: false,
  reason: 'load-failed',
  electronVersion: '40.0.0',
  processArch: 'x64',
  processPlatform: 'win32',
  attemptedPath: '/vec0.dll',
  packageName: 'sqlite-vec',
  fsExists: false,
  error: { code: 'ENOENT', message: 'not found' },
  errorChain: [{ strategy: 'direct', code: 'ENOENT', message: 'not found' }],
} as unknown as VecLoadDiagnostic;

describe('serializeVecDiagnosticForBridge', () => {
  it('projects the full diagnostic onto the wire shape', () => {
    expect(serializeVecDiagnosticForBridge(FAILED_DIAGNOSTIC)).toEqual({
      ok: false,
      reason: 'load-failed',
      electronVersion: '40.0.0',
      processArch: 'x64',
      processPlatform: 'win32',
      attemptedPath: '/vec0.dll',
      packageName: 'sqlite-vec',
      fsExists: false,
      error: { code: 'ENOENT', message: 'not found' },
      errorChain: [
        { strategy: 'direct', code: 'ENOENT', message: 'not found' },
      ],
    });
  });

  it('leaves error undefined when the load succeeded', () => {
    const wire = serializeVecDiagnosticForBridge(OK_DIAGNOSTIC);
    expect(wire.ok).toBe(true);
    expect(wire.error).toBeUndefined();
    expect(wire.errorChain).toBeUndefined();
  });
});

describe('serializeEmbedderSnapshotForBridge', () => {
  it('omits progress when it is undefined', () => {
    const wire = serializeEmbedderSnapshotForBridge({
      ready: true,
      downloading: false,
    } as EmbedderStatusSnapshot);
    expect(wire).toEqual({ ready: true, downloading: false });
    expect('progress' in wire).toBe(false);
  });

  it('carries progress and error through when present', () => {
    const wire = serializeEmbedderSnapshotForBridge({
      ready: false,
      downloading: true,
      progress: 0.5,
      error: { code: 'E_NET', message: 'offline' },
    } as EmbedderStatusSnapshot);
    expect(wire).toEqual({
      ready: false,
      downloading: true,
      progress: 0.5,
      error: { code: 'E_NET', message: 'offline' },
    });
  });
});

/**
 * A load that SUCCEEDED on a fallback after the primary resolver missed — the
 * shape every Electron boot produces, and the one TASK_2026_315 C7 exists for.
 */
const OK_AFTER_FALLBACK_DIAGNOSTIC = {
  ok: true,
  reason: 'ok',
  electronVersion: '40.0.0',
  processArch: 'x64',
  processPlatform: 'win32',
  attemptedPath: '/node_modules/sqlite-vec-windows-x64/vec0.dll',
  packageName: 'sqlite-vec-windows-x64',
  fsExists: true,
  errorChain: [
    {
      strategy: 'primary-resolver',
      message:
        '[Electron DI] no sqlite-vec binary found among electron-host candidates: /app.asar.unpacked/vec0.dll | /dist/vec0.dll',
    },
  ],
} as unknown as VecLoadDiagnostic;

describe('emitVecLoadDiagnostic', () => {
  beforeEach(() => {
    resetVecLoadDiagnosticForTest();
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits at most once per process', () => {
    const debugSpy = jest.spyOn(console, 'debug');
    const container = makeContainer([]);

    emitVecLoadDiagnostic(container, OK_DIAGNOSTIC);
    emitVecLoadDiagnostic(container, OK_DIAGNOSTIC);

    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('a successful load after a fallback logs at debug and drops the chain', () => {
    const debugSpy = jest.spyOn(console, 'debug');
    const warnSpy = jest.spyOn(console, 'warn');

    emitVecLoadDiagnostic(makeContainer([]), OK_AFTER_FALLBACK_DIAGNOSTIC);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledTimes(1);

    const payload = debugSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('chain');
    expect(payload).not.toHaveProperty('error');
    // The fallback stays VISIBLE as a count — quietening it entirely would
    // hide a host that has stopped resolving via its primary path.
    expect(payload['attempts']).toBe(1);
    expect(payload['attemptedPath']).toBe(
      '/node_modules/sqlite-vec-windows-x64/vec0.dll',
    );
  });

  it('a load that failed every strategy still prints the full chain', () => {
    const warnSpy = jest.spyOn(console, 'warn');

    emitVecLoadDiagnostic(makeContainer([]), FAILED_DIAGNOSTIC);

    const [message, payload] = warnSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe(
      '[persistence-sqlite] sqlite-vec diagnostic (offline)',
    );
    expect(payload['chain']).toEqual([
      { strategy: 'direct', code: 'ENOENT', message: 'not found' },
    ]);
    expect(payload['error']).toEqual({ code: 'ENOENT', message: 'not found' });
    expect(payload['electronVersion']).toBe('40.0.0');
    expect(payload['processArch']).toBe('x64');
    expect(payload['processPlatform']).toBe('win32');
  });

  it('adds a Sentry breadcrumb when the load failed', () => {
    const addBreadcrumb = jest.fn();
    const container = makeContainer([
      [TOKENS.SENTRY_SERVICE, { isInitialized: () => true, addBreadcrumb }],
    ]);

    emitVecLoadDiagnostic(container, FAILED_DIAGNOSTIC);

    expect(addBreadcrumb).toHaveBeenCalledWith(
      'persistence.sqlite-vec',
      'sqlite-vec load load-failed',
      expect.objectContaining({
        reason: 'load-failed',
        packageName: 'sqlite-vec',
        errorCode: 'ENOENT',
        attempts: 1,
      }),
    );
  });

  it('does not touch Sentry when the load succeeded', () => {
    const addBreadcrumb = jest.fn();
    const container = makeContainer([
      [TOKENS.SENTRY_SERVICE, { isInitialized: () => true, addBreadcrumb }],
    ]);

    emitVecLoadDiagnostic(container, OK_DIAGNOSTIC);

    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('survives an unresolvable Sentry service', () => {
    const warnSpy = jest.spyOn(console, 'warn');

    expect(() =>
      emitVecLoadDiagnostic(makeContainer([]), FAILED_DIAGNOSTIC, '[Host]'),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      '[Host] failed to emit sentry breadcrumb for vec diagnostic',
      expect.any(String),
    );
  });
});
