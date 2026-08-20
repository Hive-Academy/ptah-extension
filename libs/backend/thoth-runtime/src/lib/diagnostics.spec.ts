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

describe('emitVecLoadDiagnostic', () => {
  beforeEach(() => {
    resetVecLoadDiagnosticForTest();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits at most once per process', () => {
    const logSpy = jest.spyOn(console, 'log');
    const container = makeContainer([]);

    emitVecLoadDiagnostic(container, OK_DIAGNOSTIC);
    emitVecLoadDiagnostic(container, OK_DIAGNOSTIC);

    expect(logSpy).toHaveBeenCalledTimes(1);
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
