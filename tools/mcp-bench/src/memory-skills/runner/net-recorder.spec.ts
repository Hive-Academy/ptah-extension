import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as dns from 'node:dns';
import * as net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  NetRecorderHandle,
  NetRecorderTargetError,
  NetRecorderViolationError,
  startNetRecorder,
} from './net-recorder';

describe('net-recorder', () => {
  let dir: string;
  const openHandles: NetRecorderHandle[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-bench-net-recorder-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A spec that corrupts its own log makes stop() throw on the read; restore
  // still ran, and the afterEach stop is then an idempotent no-op whose read
  // throws again. Expected cleanup noise, never a test failure.
  afterEach(() => {
    for (const handle of openHandles.splice(0)) {
      try {
        handle.stop();
      } catch {
        /* the spec already asserted the restore inside its own stop() */
      }
    }
  });

  function start(name: string): NetRecorderHandle {
    const handle = startNetRecorder({
      dir,
      logFile: join(dir, `${name}.log`),
    });
    openHandles.push(handle);
    return handle;
  }

  async function withLocalServer(
    body: (port: number) => Promise<void>,
  ): Promise<void> {
    const server = net.createServer();
    await new Promise<void>((resolveListen) =>
      server.listen(0, '127.0.0.1', resolveListen),
    );
    const port = (server.address() as net.AddressInfo).port;
    try {
      await body(port);
    } finally {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
    }
  }

  it('records a socket the spec opens and lets the connection proceed', async () => {
    await withLocalServer(async (port) => {
      const handle = start('socket');
      const socket = net.connect({ host: '127.0.0.1', port });
      await new Promise<void>((resolveConnect) =>
        socket.once('connect', () => resolveConnect()),
      );
      socket.destroy();
      const attempts = handle.stop();
      expect(attempts).toContainEqual({
        kind: 'tcp-connect',
        tag: 'main',
        detail: JSON.stringify({ host: '127.0.0.1', port }),
      });
    });
  });

  it('records dns lookups from the callback and the promise API', async () => {
    const handle = start('dns');
    dns.lookup('localhost', () => undefined);
    await dns.promises.lookup('localhost');
    const lookups = handle.stop().filter((a) => a.kind === 'dns-lookup');
    expect(lookups).toEqual([
      { kind: 'dns-lookup', tag: 'main', detail: 'localhost' },
      { kind: 'dns-lookup', tag: 'main', detail: 'localhost' },
    ]);
  });

  it('records fetch and forwards the connection failure, never swallowing it', async () => {
    const handle = start('fetch');
    // Port 9 (discard) has nothing listening, so fetch must reject; the
    // recorder only observes the call.
    await expect(globalThis.fetch('http://127.0.0.1:9/')).rejects.toThrow();
    const attempts = handle.stop();
    expect(attempts).toContainEqual({
      kind: 'fetch',
      tag: 'main',
      detail: 'http://127.0.0.1:9/',
    });
  });

  it('records local IPC sockets without treating them as outbound attempts', async () => {
    const pipe =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\ptah-620-net-recorder-absent-${process.pid}`
        : join(dir, 'absent.sock');
    const handle = start('ipc');
    const socket = net.connect(pipe);
    await new Promise<void>((resolveError) =>
      socket.once('error', () => resolveError()),
    );
    socket.destroy();
    const attempts = handle.stop();
    expect(handle.allEntries().some((e) => e.kind === 'ipc')).toBe(true);
    expect(attempts).toEqual([]);
    expect(() => handle.failIfAny('ci run')).not.toThrow();
  });

  it('records attempts made inside a worker thread into the same log', async () => {
    const workerEntry = join(dir, 'worker-entry.cjs');
    writeFileSync(
      workerEntry,
      [
        "'use strict';",
        'const dns = require("node:dns");',
        "dns.lookup('localhost', () => { process.exit(0); });",
        '',
      ].join('\n'),
      'utf8',
    );
    const handle = start('worker');
    const guardedEntry = handle.guardedWorkerEntry(
      workerEntry,
      'embedder-worker',
    );
    const worker = new Worker(guardedEntry);
    await new Promise<void>((resolveExit) =>
      worker.once('exit', () => resolveExit()),
    );
    const attempts = handle.stop();
    expect(attempts).toContainEqual({
      kind: 'dns-lookup',
      tag: 'embedder-worker',
      detail: 'localhost',
    });
    expect(handle.installs().map((e) => e.tag)).toEqual([
      'embedder-worker',
      'main',
    ]);
  });

  it('reports the same sorted projection whatever order attempts happen in', async () => {
    await withLocalServer(async (port) => {
      const connect = async (): Promise<void> => {
        const socket = net.connect({ host: '127.0.0.1', port });
        await new Promise<void>((resolveConnect) =>
          socket.once('connect', () => resolveConnect()),
        );
        socket.destroy();
      };

      const first = start('order-a');
      dns.lookup('localhost', () => undefined);
      await connect();
      const projectionA = first.stop();

      const second = start('order-b');
      await connect();
      dns.lookup('localhost', () => undefined);
      const projectionB = second.stop();

      expect(projectionB).toEqual(projectionA);
      expect(projectionA.map((a) => a.kind)).toEqual([
        'dns-lookup',
        'tcp-connect',
      ]);
      // No timestamp or other key: the projection carries kind, tag, detail.
      expect(Object.keys(projectionA[0]).sort()).toEqual([
        'detail',
        'kind',
        'tag',
      ]);
    });
  });

  it('restores the patched globals on stop even when the log read fails', () => {
    const origConnect = net.Socket.prototype.connect;
    const origLookup = dns.lookup;
    const origPromiseLookup = dns.promises.lookup;
    const origFetch = globalThis.fetch;

    const handle = start('restore');
    expect(net.Socket.prototype.connect).not.toBe(origConnect);
    expect(globalThis.fetch).not.toBe(origFetch);

    appendFileSync(handle.logFile, 'not-json\n');
    // The corrupt line surfaces (never swallowed) AND the patches are back.
    expect(() => handle.stop()).toThrow(/not-json/);
    expect(net.Socket.prototype.connect).toBe(origConnect);
    expect(dns.lookup).toBe(origLookup);
    expect(dns.promises.lookup).toBe(origPromiseLookup);
    expect(globalThis.fetch).toBe(origFetch);
  });

  it('stops recording after stop', () => {
    const handle = start('stopped');
    handle.stop();
    dns.lookup('localhost', () => undefined);
    expect(handle.attempts()).toEqual([]);
  });

  it('fails the run on any recorded attempt and prints them', () => {
    const handle = start('violation');
    dns.lookup('localhost', () => undefined);
    expect(() => handle.failIfAny('memory-skills ci run')).toThrow(
      NetRecorderViolationError,
    );
    expect(() => handle.failIfAny('memory-skills ci run')).toThrow(
      /\[dns-lookup\] main localhost/,
    );
  });

  it('passes a clean window with no attempts', () => {
    const handle = start('clean');
    expect(() => handle.failIfAny('memory-skills ci run')).not.toThrow();
  });

  it('refuses a log file inside the real ~/.ptah home', () => {
    const target = join(homedir(), '.ptah', 'net-recorder.log');
    expect(() => startNetRecorder({ logFile: target })).toThrow(
      NetRecorderTargetError,
    );
  });

  it('refuses an existing log file so a run never inherits stale attempts', () => {
    const target = join(dir, 'pre-existing.log');
    writeFileSync(target, 'stale\n', 'utf8');
    expect(() => startNetRecorder({ logFile: target })).toThrow(
      NetRecorderTargetError,
    );
  });
});
