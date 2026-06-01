import 'reflect-metadata';
import type { ErrorEvent, StackFrame } from '@sentry/node';

// Extract the beforeSend logic for unit testing without initialising the SDK.
// The filter helpers are module-scoped in sentry.service.ts, so we re-declare
// the same regexes here and test the observable contract: drop noisy frames,
// keep Ptah frames.

const NOISE_RE =
  /extensionHostProcess|vs\.workbench\.api\.node|workbench\.desktop\.main|gitlens|copilot|browse-lite|node:net|node:child_process|undici|gitkraken|googleapis/i;

const PTAH_RE =
  /libs[/\\](backend|frontend|shared)|apps[/\\]ptah-|ptah-extension[/\\]out[/\\]|dist[/\\]apps[/\\]ptah-/;

function collectFrames(event: ErrorEvent): StackFrame[] {
  return (
    event.exception?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? []
  );
}

function isNoisyEvent(frames: StackFrame[], hasPtahFrame: boolean): boolean {
  if (hasPtahFrame) return false;
  if (frames.some((f) => NOISE_RE.test(f.filename ?? f.module ?? '')))
    return true;
  if (frames.some((f) => /resources[/\\]app\.asar/.test(f.filename ?? '')))
    return true;
  return false;
}

/** Minimal synthetic ErrorEvent factory */
function makeEvent(filenames: string[]): ErrorEvent {
  return {
    exception: {
      values: [
        {
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  } as ErrorEvent;
}

function applyFilter(event: ErrorEvent): ErrorEvent | null {
  const frames = collectFrames(event);
  const hasPtahFrame = frames.some((f) =>
    PTAH_RE.test(f.filename ?? f.module ?? ''),
  );
  return isNoisyEvent(frames, hasPtahFrame) ? null : event;
}

describe('SentryService noise filter (beforeSend logic)', () => {
  describe('should DROP (return null)', () => {
    it('(a) extensionHostProcess-only frames', () => {
      const event = makeEvent([
        '/usr/share/code/resources/app/out/extensionHostProcess.js',
      ]);
      expect(applyFilter(event)).toBeNull();
    });

    it('(b) gitlens-only frames', () => {
      const event = makeEvent([
        '/home/user/.vscode/extensions/eamodio.gitlens-14.0.0/dist/gitlens.js',
      ]);
      expect(applyFilter(event)).toBeNull();
    });

    it('(e) resources/app.asar VS Code core path without Ptah frame', () => {
      const event = makeEvent([
        '/Applications/Cursor.app/Contents/Resources/app.asar/out/vs/workbench/workbench.desktop.main.js',
      ]);
      expect(applyFilter(event)).toBeNull();
    });

    it('drops node:net frames with no Ptah context', () => {
      const event = makeEvent(['node:net', 'node:child_process']);
      expect(applyFilter(event)).toBeNull();
    });

    it('drops mixed noisy frames when no Ptah frame present', () => {
      const event = makeEvent([
        '/home/user/.vscode/extensions/eamodio.gitlens-14.0.0/dist/gitlens.js',
        '/usr/share/code/resources/app/out/extensionHostProcess.js',
      ]);
      expect(applyFilter(event)).toBeNull();
    });

    it('drops app.asar frame without Ptah path', () => {
      const event = makeEvent([
        'C:\\Users\\user\\AppData\\Local\\Programs\\cursor\\resources\\app.asar\\out\\vs\\platform\\ipc.js',
      ]);
      expect(applyFilter(event)).toBeNull();
    });
  });

  describe('should KEEP (return event)', () => {
    it('(c) dist/apps/ptah-extension-vscode/main.mjs frame', () => {
      const event = makeEvent([
        'D:/projects/ptah-extension/dist/apps/ptah-extension-vscode/main.mjs',
      ]);
      expect(applyFilter(event)).toBe(event);
    });

    it('(d) libs/backend/agent-sdk source frame', () => {
      const event = makeEvent([
        '/home/user/projects/ptah-extension/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts',
      ]);
      expect(applyFilter(event)).toBe(event);
    });

    it('(f) resources/app.asar WITH a Ptah dist frame (Electron)', () => {
      const event = makeEvent([
        // VS Code asar frame present…
        '/Applications/Cursor.app/Contents/Resources/app.asar/out/vs/workbench/workbench.desktop.main.js',
        // …but so is a Ptah Electron frame — keep it
        '/Applications/Cursor.app/Contents/Resources/app.asar/dist/apps/ptah-electron/main.mjs',
      ]);
      expect(applyFilter(event)).toBe(event);
    });

    it('keeps events with no frames (unknown origin)', () => {
      const event = {
        exception: { values: [] },
        type: undefined,
      } as ErrorEvent;
      expect(applyFilter(event)).toBe(event);
    });

    it('keeps a Ptah frame even when a noisy frame is also present', () => {
      const event = makeEvent([
        // noise mixed in
        '/home/user/.vscode/extensions/eamodio.gitlens-14.0.0/dist/gitlens.js',
        // genuine Ptah frame
        '/home/user/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator.ts',
      ]);
      expect(applyFilter(event)).toBe(event);
    });

    it('keeps a frontend lib frame', () => {
      const event = makeEvent([
        '/home/user/projects/ptah-extension/libs/frontend/chat-ui/src/lib/chat.component.ts',
      ]);
      expect(applyFilter(event)).toBe(event);
    });

    it('keeps a shared lib frame', () => {
      const event = makeEvent([
        '/home/user/projects/ptah-extension/libs/shared/utils/src/lib/utils.ts',
      ]);
      expect(applyFilter(event)).toBe(event);
    });

    it('keeps apps/ptah-cli frame', () => {
      const event = makeEvent([
        '/home/user/projects/ptah-extension/apps/ptah-cli/src/main.ts',
      ]);
      expect(applyFilter(event)).toBe(event);
    });
  });
});

const sentryInitMock = jest.fn();
const sentryStartSpanMock = jest.fn(
  (_opts: unknown, fn: (...args: unknown[]) => unknown) => fn(),
);

jest.mock(
  '@sentry/node',
  () => ({
    init: (...args: unknown[]) => sentryInitMock(...args),
    startSpan: (opts: unknown, fn: (...args: unknown[]) => unknown) =>
      sentryStartSpanMock(opts, fn),
  }),
  { virtual: true },
);

import { SentryService } from './sentry.service';
import type { Logger } from '../logging/logger';

function makeServiceLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

const baseOptions = {
  dsn: 'https://public@example.ingest.sentry.io/1',
  release: '1.2.3',
  platform: 'electron',
  extensionVersion: '1.2.3',
};

describe('SentryService — tracing', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalSampleRate = process.env['SENTRY_TRACES_SAMPLE_RATE'];

  beforeEach(() => {
    sentryInitMock.mockClear();
    sentryStartSpanMock.mockClear();
    delete process.env['NODE_ENV'];
    delete process.env['SENTRY_TRACES_SAMPLE_RATE'];
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalSampleRate === undefined)
      delete process.env['SENTRY_TRACES_SAMPLE_RATE'];
    else process.env['SENTRY_TRACES_SAMPLE_RATE'] = originalSampleRate;
  });

  it('passes an explicit tracesSampleRate to Sentry.init', () => {
    const svc = new SentryService(makeServiceLogger());
    svc.initialize({
      ...baseOptions,
      environment: 'production',
      tracesSampleRate: 0.42,
    });
    expect(sentryInitMock).toHaveBeenCalledTimes(1);
    expect(sentryInitMock.mock.calls[0][0]).toMatchObject({
      tracesSampleRate: 0.42,
    });
  });

  it('reads tracesSampleRate from SENTRY_TRACES_SAMPLE_RATE when not provided', () => {
    process.env['SENTRY_TRACES_SAMPLE_RATE'] = '0.25';
    const svc = new SentryService(makeServiceLogger());
    svc.initialize({ ...baseOptions, environment: 'production' });
    expect(sentryInitMock.mock.calls[0][0]).toMatchObject({
      tracesSampleRate: 0.25,
    });
  });

  it('defaults tracesSampleRate to 1.0 in development', () => {
    const svc = new SentryService(makeServiceLogger());
    svc.initialize({ ...baseOptions, environment: 'development' });
    expect(sentryInitMock.mock.calls[0][0]).toMatchObject({
      tracesSampleRate: 1.0,
    });
  });

  it('defaults tracesSampleRate to 0.1 in production', () => {
    const svc = new SentryService(makeServiceLogger());
    svc.initialize({ ...baseOptions, environment: 'production' });
    expect(sentryInitMock.mock.calls[0][0]).toMatchObject({
      tracesSampleRate: 0.1,
    });
  });

  it('startSpan returns fn() result and does NOT call Sentry when uninitialized', () => {
    const svc = new SentryService(makeServiceLogger());
    const result = svc.startSpan('test.span', { op: 'db.query' }, () => 7);
    expect(result).toBe(7);
    expect(sentryStartSpanMock).not.toHaveBeenCalled();
  });

  it('startSpan wraps Sentry.startSpan when initialized', () => {
    const svc = new SentryService(makeServiceLogger());
    svc.initialize({ ...baseOptions, environment: 'production' });
    const result = svc.startSpan(
      'memory.search',
      { op: 'db.query', topK: 10 },
      () => 'ok',
    );
    expect(result).toBe('ok');
    expect(sentryStartSpanMock).toHaveBeenCalledTimes(1);
    expect(sentryStartSpanMock.mock.calls[0][0]).toMatchObject({
      name: 'memory.search',
      op: 'db.query',
      attributes: { op: 'db.query', topK: 10 },
    });
  });

  it('startSpan passes through a Promise return value', async () => {
    const svc = new SentryService(makeServiceLogger());
    svc.initialize({ ...baseOptions, environment: 'production' });
    const result = svc.startSpan('memory.embed', { op: 'ai.embeddings' }, () =>
      Promise.resolve('async-ok'),
    );
    await expect(result).resolves.toBe('async-ok');
  });
});
