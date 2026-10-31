const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();
const ipcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    on: jest.fn(),
  },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      const arr = ipcMainListeners.get(channel) ?? [];
      arr.push(listener);
      ipcMainListeners.set(channel, arr);
    },
    removeAllListeners: (channel: string) => {
      ipcMainListeners.delete(channel);
    },
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcMainHandlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      ipcMainHandlers.delete(channel);
    },
  },
}));

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import type { DependencyContainer } from 'tsyringe';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { IpcBridge } from '../ipc/ipc-bridge';
import {
  atomicWriteFileSync,
  createReplayRecorderIfEnabled,
  DEFAULT_FLUSH_DEBOUNCE_MS,
  isValidReplayOutputPath,
  ReplayRecorder,
  tapReplayRecorder,
} from './replay-recorder';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ESBUILD_CONFIG_PATH = path.join(
  REPO_ROOT,
  'apps/ptah-electron/esbuild.config.cjs',
);
const VALIDATE_DEPS_PATH = path.join(
  REPO_ROOT,
  'apps/ptah-electron/scripts/validate-deps.js',
);
const IPC_BRIDGE_ENTRY = path.join(
  REPO_ROOT,
  'apps/ptah-electron/src/ipc/ipc-bridge.ts',
);

const TRUSTED_DOCUMENTS = [path.resolve('/app/renderer/index.html')];
const MAIN_FRAME = { url: pathToFileURL(TRUSTED_DOCUMENTS[0]).href };

function loadEsbuildConfigWithEnv(env: Record<string, string | undefined>): {
  define?: Record<string, string>;
} {
  const prevNodeEnv = process.env['NODE_ENV'];
  const prevRecorderBuild = process.env['PTAH_REPLAY_RECORDER_BUILD'];
  try {
    if (env['NODE_ENV'] === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = env['NODE_ENV'];
    }
    if (env['PTAH_REPLAY_RECORDER_BUILD'] === undefined) {
      delete process.env['PTAH_REPLAY_RECORDER_BUILD'];
    } else {
      process.env['PTAH_REPLAY_RECORDER_BUILD'] =
        env['PTAH_REPLAY_RECORDER_BUILD'];
    }
    delete require.cache[require.resolve(ESBUILD_CONFIG_PATH)];
    return require(ESBUILD_CONFIG_PATH) as { define?: Record<string, string> };
  } finally {
    if (prevNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = prevNodeEnv;
    }
    if (prevRecorderBuild === undefined) {
      delete process.env['PTAH_REPLAY_RECORDER_BUILD'];
    } else {
      process.env['PTAH_REPLAY_RECORDER_BUILD'] = prevRecorderBuild;
    }
    delete require.cache[require.resolve(ESBUILD_CONFIG_PATH)];
  }
}

describe('ReplayRecorder and gate (B4)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ipcMainListeners.clear();
    ipcMainHandlers.clear();
    (globalThis as Record<string, unknown>)['__PTAH_REPLAY_RECORDER__'] = true;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)['__PTAH_REPLAY_RECORDER__'] = false;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('M1: build-time define gate and production bundle tree-shaking assertion', () => {
    it('defaults __PTAH_REPLAY_RECORDER__ to false unless NODE_ENV=development AND PTAH_REPLAY_RECORDER_BUILD=1', () => {
      expect(
        loadEsbuildConfigWithEnv({
          NODE_ENV: undefined,
          PTAH_REPLAY_RECORDER_BUILD: undefined,
        }).define?.['__PTAH_REPLAY_RECORDER__'],
      ).toBe('false');

      expect(
        loadEsbuildConfigWithEnv({
          NODE_ENV: 'development',
          PTAH_REPLAY_RECORDER_BUILD: undefined,
        }).define?.['__PTAH_REPLAY_RECORDER__'],
      ).toBe('false');

      expect(
        loadEsbuildConfigWithEnv({
          NODE_ENV: 'development',
          PTAH_REPLAY_RECORDER_BUILD: '0',
        }).define?.['__PTAH_REPLAY_RECORDER__'],
      ).toBe('false');

      expect(
        loadEsbuildConfigWithEnv({
          NODE_ENV: 'production',
          PTAH_REPLAY_RECORDER_BUILD: '1',
        }).define?.['__PTAH_REPLAY_RECORDER__'],
      ).toBe('false');

      expect(
        loadEsbuildConfigWithEnv({
          NODE_ENV: undefined,
          PTAH_REPLAY_RECORDER_BUILD: '1',
        }).define?.['__PTAH_REPLAY_RECORDER__'],
      ).toBe('false');

      expect(
        loadEsbuildConfigWithEnv({
          NODE_ENV: 'development',
          PTAH_REPLAY_RECORDER_BUILD: '1',
        }).define?.['__PTAH_REPLAY_RECORDER__'],
      ).toBe('true');
    });

    it('completely strips replay-recorder code and strings when bundled with the default/production define', async () => {
      const prodConfig = loadEsbuildConfigWithEnv({
        NODE_ENV: 'production',
        PTAH_REPLAY_RECORDER_BUILD: undefined,
      });

      const result = await esbuild.build({
        entryPoints: [IPC_BRIDGE_ENTRY],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        minify: true,
        external: ['electron', '@ptah-extension/*', 'tsyringe'],
        define: prodConfig.define,
      });

      expect(result.outputFiles).toHaveLength(1);
      const bundledCode = result.outputFiles[0].text;
      expect(bundledCode).not.toContain('PTAH_REPLAY_RECORD');
      expect(bundledCode).not.toContain('__PTAH_REPLAY_RECORDER__');
      expect(bundledCode).not.toContain('createReplayRecorderIfEnabled');
      expect(bundledCode).not.toContain('ReplayRecorder');
      expect(bundledCode).not.toContain('tapReplayRecorder');
      expect(bundledCode).not.toContain('recordRpcCall');
      expect(bundledCode).not.toContain('recordRpcResult');
      expect(bundledCode).not.toContain('recordPush');
    });

    it('asserts against replay recorder markers in scripts/validate-deps.js', () => {
      const validateDepsSrc = readFileSync(VALIDATE_DEPS_PATH, 'utf8');
      expect(validateDepsSrc).toContain('FORBIDDEN_REPLAY_RECORDER_MARKERS');
      expect(validateDepsSrc).toContain('PTAH_REPLAY_RECORD');
      expect(validateDepsSrc).toContain('ReplayRecorder');
    });
  });

  describe('output path validation and 5-way gate combinations', () => {
    const validEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
      PTAH_REPLAY_RECORD: '1',
      PTAH_REPLAY_RECORD_OUT: '/tmp/ptah-captures/raw-session.json',
    };

    it('enables recorder only when all 5 gate conditions hold', () => {
      const quitListeners: Array<() => void> = [];
      const written: Array<{ file: string; content: string }> = [];
      const recorder = createReplayRecorderIfEnabled({
        defineEnabled: true,
        isPackaged: false,
        env: validEnv,
        app: {
          isPackaged: false,
          on: (event, listener) => {
            if (event === 'will-quit') quitListeners.push(listener);
          },
        },
        writeFile: (file, content) => written.push({ file, content }),
      });

      expect(recorder).toBeInstanceOf(ReplayRecorder);
      expect(quitListeners).toHaveLength(1);
      quitListeners[0]();
      expect(written).toHaveLength(1);
      expect(written[0].file).toBe('/tmp/ptah-captures/raw-session.json');
    });

    it.each([
      [
        'build define __PTAH_REPLAY_RECORDER__ is false',
        { defineEnabled: false, isPackaged: false, env: validEnv },
      ],
      [
        'app.isPackaged is true',
        { defineEnabled: true, isPackaged: true, env: validEnv },
      ],
      [
        'NODE_ENV is production',
        {
          defineEnabled: true,
          isPackaged: false,
          env: { ...validEnv, NODE_ENV: 'production' },
        },
      ],
      [
        'NODE_ENV is test',
        {
          defineEnabled: true,
          isPackaged: false,
          env: { ...validEnv, NODE_ENV: 'test' },
        },
      ],
      [
        'PTAH_REPLAY_RECORD is missing',
        {
          defineEnabled: true,
          isPackaged: false,
          env: {
            NODE_ENV: 'development',
            PTAH_REPLAY_RECORD_OUT: '/tmp/ptah-captures/raw.json',
          },
        },
      ],
      [
        'PTAH_REPLAY_RECORD is 0',
        {
          defineEnabled: true,
          isPackaged: false,
          env: { ...validEnv, PTAH_REPLAY_RECORD: '0' },
        },
      ],
      [
        'PTAH_REPLAY_RECORD_OUT is missing',
        {
          defineEnabled: true,
          isPackaged: false,
          env: { NODE_ENV: 'development', PTAH_REPLAY_RECORD: '1' },
        },
      ],
      [
        'PTAH_REPLAY_RECORD_OUT is relative',
        {
          defineEnabled: true,
          isPackaged: false,
          env: { ...validEnv, PTAH_REPLAY_RECORD_OUT: 'captures/raw.json' },
        },
      ],
      [
        'PTAH_REPLAY_RECORD_OUT is inside dist/',
        {
          defineEnabled: true,
          isPackaged: false,
          env: {
            ...validEnv,
            PTAH_REPLAY_RECORD_OUT:
              '/workspace/dist/ptah-landing-page/raw.json',
          },
        },
      ],
      [
        'PTAH_REPLAY_RECORD_OUT is inside public/',
        {
          defineEnabled: true,
          isPackaged: false,
          env: {
            ...validEnv,
            PTAH_REPLAY_RECORD_OUT:
              '/workspace/apps/ptah-landing-page/public/raw.json',
          },
        },
      ],
      [
        'PTAH_REPLAY_RECORD_OUT contains parent traversal (..)',
        {
          defineEnabled: true,
          isPackaged: false,
          env: {
            ...validEnv,
            PTAH_REPLAY_RECORD_OUT: '/tmp/captures/../dist/raw.json',
          },
        },
      ],
    ])('returns null when %s', (_reason, deps) => {
      expect(createReplayRecorderIfEnabled(deps)).toBeNull();
    });

    it('validates output paths accurately across POSIX and Windows', () => {
      expect(isValidReplayOutputPath('/tmp/replay-raw.json')).toBe(true);
      expect(isValidReplayOutputPath('C:\\temp\\replay-raw.json')).toBe(true);
      expect(isValidReplayOutputPath('relative/replay.json')).toBe(false);
      expect(isValidReplayOutputPath('/repo/dist/replay.json')).toBe(false);
      expect(isValidReplayOutputPath('C:\\repo\\Public\\replay.json')).toBe(
        false,
      );
      expect(isValidReplayOutputPath('/tmp/dir/')).toBe(false);
      expect(isValidReplayOutputPath('')).toBe(false);
    });
  });

  describe('raw capture format, rpcCases creation, and rpc:response exclusion', () => {
    it('records rpc, creates rpcCases only when same method returns different data for different params, and records rpcErrors', () => {
      let currentNow = 1000;
      const writes: string[] = [];
      const recorder = new ReplayRecorder({
        outputPath: '/tmp/capture.json',
        timeBase: 1793476800000,
        now: () => currentNow,
        debounceMs: 0,
        writeFile: (_file, content) => writes.push(content),
      });

      // 1. Method called twice with different params but returning IDENTICAL data -> no rpcCases entry
      recorder.recordRpcCall('session:status', { sessionId: 's1' }, 'c-1');
      recorder.recordRpcResult('c-1', {
        success: true,
        data: { isActive: false, isStreaming: false },
      });
      recorder.recordRpcCall('session:status', { sessionId: 's2' }, 'c-2');
      recorder.recordRpcResult('c-2', {
        success: true,
        data: { isActive: false, isStreaming: false },
      });

      // 2. Method called twice with different params returning DIFFERENT data -> creates rpcCases['session:load']
      recorder.recordRpcCall('session:load', { sessionId: 's1' }, 'c-3');
      recorder.recordRpcResult('c-3', {
        success: true,
        data: { sessionId: 's1', messages: ['m1'] },
      });
      recorder.recordRpcCall('session:load', { sessionId: 's2' }, 'c-4');
      recorder.recordRpcResult('c-4', {
        success: true,
        data: { sessionId: 's2', messages: ['m2'] },
      });

      // 3. Method that fails -> populates rpcErrors
      recorder.recordRpcCall('git:lastCommit', {}, 'c-5');
      recorder.recordRpcResult('c-5', {
        success: false,
        error: 'No commits yet',
        errorCode: 'NO_COMMIT',
      });

      // 4. Timeline pushes with relative `at`, ignoring rpc:response
      currentNow = 1120;
      recorder.recordPush({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { delta: 'hi' },
      });
      currentNow = 1250;
      recorder.recordPush({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        correlationId: 'c-1',
        success: true,
      });
      recorder.recordPush({
        type: MESSAGE_TYPES.BATCH,
        payload: {
          events: [
            { type: MESSAGE_TYPES.CHAT_THINKING, payload: { text: 'hmm' } },
            { type: MESSAGE_TYPES.RPC_RESPONSE, correlationId: 'ignored' },
          ],
        },
      });

      const snapshot = recorder.flush();
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0])).toEqual(snapshot);

      expect(snapshot.timeBase).toBe(1793476800000);
      expect(snapshot.recordedAt).toBe(new Date(1793476800000).toISOString());
      expect(snapshot.rpc['session:status']).toEqual({
        isActive: false,
        isStreaming: false,
      });
      expect(snapshot.rpcCases['session:status']).toBeUndefined();

      expect(snapshot.rpc['session:load']).toEqual({
        sessionId: 's1',
        messages: ['m1'],
      });
      expect(snapshot.rpcCases['session:load']).toEqual([
        {
          match: { sessionId: 's1' },
          data: { sessionId: 's1', messages: ['m1'] },
        },
        {
          match: { sessionId: 's2' },
          data: { sessionId: 's2', messages: ['m2'] },
        },
      ]);

      expect(snapshot.rpcErrors['git:lastCommit']).toEqual({
        error: 'No commits yet',
        errorCode: 'NO_COMMIT',
      });

      expect(snapshot.timeline).toEqual([
        {
          at: 120,
          message: {
            type: MESSAGE_TYPES.CHAT_CHUNK,
            payload: { delta: 'hi' },
          },
        },
        {
          at: 250,
          message: {
            type: MESSAGE_TYPES.BATCH,
            payload: {
              events: [
                {
                  type: MESSAGE_TYPES.CHAT_THINKING,
                  payload: { text: 'hmm' },
                },
              ],
            },
          },
        },
      ]);
    });
  });

  describe('IpcBridge tap integration: batch preservation, ordering, and debounced/dispose flush', () => {
    it('captures RPC calls, batched stream pushes before RPC response, and flushes on dispose', async () => {
      let currentNow = 5000;
      const writes: string[] = [];
      const recorder = new ReplayRecorder({
        outputPath: '/tmp/bridge-capture.json',
        timeBase: 1793476800000,
        now: () => currentNow,
        debounceMs: 100,
        writeFile: (_file, content) => writes.push(content),
      });

      const handleMessageMock = jest.fn().mockImplementation(async () => {
        currentNow = 5050;
        return {
          success: true,
          data: { acceptedProtocolVersion: 2 },
        };
      });

      const containerStub = {
        resolve: jest.fn(() => ({
          handleMessage: handleMessageMock,
          get: jest.fn(),
          update: jest.fn(),
        })),
        isRegistered: jest.fn(() => false),
      } as unknown as DependencyContainer;

      const sent: Array<{ channel: string; message: unknown }> = [];
      const win = {
        webContents: {
          id: 1,
          send: jest.fn((channel: string, message: unknown) => {
            sent.push({ channel, message });
          }),
        },
      };

      const bridge = new IpcBridge(
        containerStub,
        () => win,
        TRUSTED_DOCUMENTS,
        recorder,
      );
      bridge.initialize();

      // Queue two batchable stream events before an RPC response resolves
      currentNow = 5010;
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { idx: 1 },
      });
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.CHAT_THINKING,
        payload: { idx: 2 },
      });

      // Trigger RPC from trusted main window
      const rpcListeners = ipcMainListeners.get('rpc') ?? [];
      const event = {
        sender: {
          id: 1,
          mainFrame: MAIN_FRAME,
          isDestroyed: () => false,
          send: jest.fn((channel: string, message: unknown) => {
            sent.push({ channel, message });
          }),
        },
        senderFrame: MAIN_FRAME,
      };

      await rpcListeners[0](event, {
        type: MESSAGE_TYPES.RPC_CALL,
        payload: {
          method: 'chat:setStreamViewport',
          params: { version: 2 },
          correlationId: 'corr-viewport',
        },
      });

      // Send a non-batched push after RPC completes
      currentNow = 5080;
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: { sessionId: 's-1' },
      });

      // Verify debounced flush fires
      expect(writes).toHaveLength(0);
      jest.advanceTimersByTime(120);
      expect(writes).toHaveLength(1);

      // Queue one more stream event and verify bridge.dispose() flushes stream queue AND recorder
      currentNow = 5150;
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { idx: 3 },
      });
      bridge.dispose();

      expect(writes).toHaveLength(2);
      const finalCapture = JSON.parse(writes[1]);

      expect(finalCapture.rpc['chat:setStreamViewport']).toEqual({
        acceptedProtocolVersion: 2,
      });
      expect(
        finalCapture.timeline.map(
          (entry: { at: number; message: { type: string } }) => ({
            at: entry.at,
            type: entry.message.type,
          }),
        ),
      ).toEqual([
        { at: 50, type: MESSAGE_TYPES.BATCH },
        { at: 80, type: MESSAGE_TYPES.SESSION_TURN_ENDED },
        { at: 150, type: MESSAGE_TYPES.CHAT_CHUNK },
      ]);
      expect(
        finalCapture.timeline.some(
          (entry: { message: { type: string } }) =>
            entry.message.type === MESSAGE_TYPES.RPC_RESPONSE,
        ),
      ).toBe(false);
    });
  });

  describe('B1: failure isolation — recorder errors never change bridge behavior', () => {
    it('isolates cyclic RPC payloads, logs once, disables the recorder, and never sends a duplicate error rpc:response', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        const writes: string[] = [];
        const recorder = new ReplayRecorder({
          outputPath: '/tmp/cyclic-capture.json',
          debounceMs: 0,
          writeFile: (_file, content) => writes.push(content),
        });

        const cyclicData: Record<string, unknown> = { ok: true };
        cyclicData['self'] = cyclicData;

        const handleMessageMock = jest.fn().mockResolvedValue({
          success: true,
          data: cyclicData,
        });

        const containerStub = {
          resolve: jest.fn(() => ({
            handleMessage: handleMessageMock,
            get: jest.fn(),
            update: jest.fn(),
          })),
          isRegistered: jest.fn(() => false),
        } as unknown as DependencyContainer;

        const win = {
          webContents: {
            id: 1,
            send: jest.fn(),
          },
        };

        const bridge = new IpcBridge(
          containerStub,
          () => win,
          TRUSTED_DOCUMENTS,
          recorder,
        );
        bridge.initialize();

        const rpcListeners = ipcMainListeners.get('rpc') ?? [];
        const senderReplies: unknown[] = [];
        const event = {
          sender: {
            id: 1,
            mainFrame: MAIN_FRAME,
            isDestroyed: () => false,
            send: jest.fn((_channel: string, msg: unknown) => {
              senderReplies.push(msg);
            }),
          },
          senderFrame: MAIN_FRAME,
        };

        await rpcListeners[0](event, {
          type: MESSAGE_TYPES.RPC_CALL,
          payload: {
            method: 'workspace:getInfo',
            params: {},
            correlationId: 'corr-cyclic',
          },
        });

        // Bridge must send only the single success response, never a second Internal error response
        expect(senderReplies).toHaveLength(1);
        expect(senderReplies[0]).toMatchObject({
          type: MESSAGE_TYPES.RPC_RESPONSE,
          correlationId: 'corr-cyclic',
          success: true,
        });

        // Recorder disabled itself and logged once
        expect(recorder.isDisabled()).toBe(true);
        const recorderWarns = warnSpy.mock.calls.filter((call) =>
          String(call[0]).includes('[ReplayRecorder]'),
        );
        expect(recorderWarns).toHaveLength(1);

        // Subsequent pushes/calls are no-ops and do not warn again
        bridge.sendToRenderer({
          type: MESSAGE_TYPES.SESSION_TURN_ENDED,
          payload: { sessionId: 's-1' },
        });
        const recorderWarnsAfter = warnSpy.mock.calls.filter((call) =>
          String(call[0]).includes('[ReplayRecorder]'),
        );
        expect(recorderWarnsAfter).toHaveLength(1);
        expect(writes).toHaveLength(0);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('guards flush() in bridge.dispose() when writeFile throws so IPC listeners are always removed', () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        const recorder = new ReplayRecorder({
          outputPath: '/tmp/throwing-flush.json',
          debounceMs: 0,
          writeFile: () => {
            throw new Error('ENOSPC: no space left on device');
          },
        });

        const containerStub = {
          resolve: jest.fn(() => ({
            handleMessage: jest.fn(),
            get: jest.fn(),
            update: jest.fn(),
          })),
          isRegistered: jest.fn(() => false),
        } as unknown as DependencyContainer;

        const win = {
          webContents: {
            id: 1,
            send: jest.fn(),
          },
        };

        const bridge = new IpcBridge(
          containerStub,
          () => win,
          TRUSTED_DOCUMENTS,
          recorder,
        );
        bridge.initialize();
        expect(ipcMainListeners.has('rpc')).toBe(true);
        expect(ipcMainListeners.has('get-state')).toBe(true);
        expect(ipcMainListeners.has('set-state')).toBe(true);
        expect(ipcMainHandlers.has('diag:cpu-profile')).toBe(true);

        expect(() => bridge.dispose()).not.toThrow();

        // All listeners and handlers must be cleaned up despite the flush error
        expect(ipcMainListeners.has('rpc')).toBe(false);
        expect(ipcMainListeners.has('get-state')).toBe(false);
        expect(ipcMainListeners.has('set-state')).toBe(false);
        expect(ipcMainHandlers.has('diag:cpu-profile')).toBe(false);
        expect(recorder.isDisabled()).toBe(true);

        // Even a custom/mock recorder that throws directly from flush() is caught by tapReplayRecorder
        const throwingStub = {
          flush: jest.fn(() => {
            throw new Error('Stub flush explosion');
          }),
        };
        expect(() =>
          tapReplayRecorder(throwingStub, (r) => r.flush()),
        ).not.toThrow();
        expect(() =>
          tapReplayRecorder(throwingStub, (r) => r.flush()),
        ).not.toThrow();
        expect(throwingStub.flush).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('R1: atomic writes and incremental pre-serialized flush', () => {
    it('writes atomically via a .tmp file + renameSync and uses a 2s default debounce', () => {
      expect(DEFAULT_FLUSH_DEBOUNCE_MS).toBe(2_000);

      const tmpDir = mkdtempSync(path.join(tmpdir(), 'ptah-recorder-atomic-'));
      try {
        const outPath = path.join(tmpDir, 'capture.json');
        atomicWriteFileSync(outPath, '{"ok":true}\n');
        expect(existsSync(outPath)).toBe(true);
        expect(existsSync(`${outPath}.tmp`)).toBe(false);
        expect(readFileSync(outPath, 'utf8')).toBe('{"ok":true}\n');

        const recorder = new ReplayRecorder({
          outputPath: outPath,
          timeBase: 1793476800000,
          now: () => 1000,
        });
        recorder.recordPush({
          type: MESSAGE_TYPES.SESSION_TURN_ENDED,
          payload: { sessionId: 's-atomic' },
        });

        // Should not flush at 250ms under default 2000ms debounce
        jest.advanceTimersByTime(300);
        expect(JSON.parse(readFileSync(outPath, 'utf8'))).toEqual({
          ok: true,
        });

        // Flushes once 2000ms elapses
        jest.advanceTimersByTime(1800);
        const flushed = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(flushed.timeline).toHaveLength(1);
        expect(flushed.timeline[0].message.payload).toEqual({
          sessionId: 's-atomic',
        });
        expect(existsSync(`${outPath}.tmp`)).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('does not re-serialize or deep-clone existing timeline entries on subsequent flushes', () => {
      const writes: string[] = [];
      let currentNow = 0;
      const recorder = new ReplayRecorder({
        outputPath: '/tmp/incremental-capture.json',
        timeBase: 1793476800000,
        now: () => currentNow,
        debounceMs: 0,
        writeFile: (_file, content) => writes.push(content),
      });

      let toJsonCalls = 0;
      const payloadWithCounter = {
        value: 'first-entry',
        toJSON() {
          toJsonCalls++;
          return { value: this.value };
        },
      };

      currentNow = 10;
      recorder.recordPush({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: payloadWithCounter,
      });
      // cloneJson serializes once during recordPush
      expect(toJsonCalls).toBe(1);

      recorder.flush();
      recorder.flush();
      // Subsequent flushes reuse the pre-serialized timeline entry string without re-invoking JSON.stringify on entry objects
      expect(toJsonCalls).toBe(1);
      expect(writes).toHaveLength(2);
      expect(JSON.parse(writes[1]).timeline).toEqual([
        {
          at: 10,
          message: {
            type: MESSAGE_TYPES.CHAT_CHUNK,
            payload: { value: 'first-entry' },
          },
        },
      ]);
    });
  });
});
