/**
 * `AntigravityCliAdapter` and the two-writer rule on
 * `~/.gemini/config/mcp_config.json` (TASK_2026_285).
 *
 * The main adapter spec mocks `fs/promises` wholesale and never passes
 * `mcpPort`, so it says nothing about the MCP config file. This one is the
 * opposite shape: `HOME` is a real temp directory, the filesystem is real, and
 * only the spawn is faked — because the property under test is what lands on
 * disk, not what the parser does with a JSONL stream.
 *
 * What it pins:
 *
 * - The spawn writes the entry `agy` actually reads: `mcpServers.ptah` with a
 *   `serverUrl`, produced by the harness-sync facet rather than by a second
 *   hand-rolled read-modify-write in this adapter.
 * - Cleanup after `done` removes ONLY that key. A server the user installed —
 *   through the marketplace, into the same file — must still be there, which is
 *   the regression that made this task more than a type-union edit.
 * - A key the user hand-wrote is never touched in either direction.
 */

// The adapter reaches the MCP facet through the `harness-sync` barrel, which
// pulls in `vscode-core`'s tsyringe decorators. Same reason the other DI-touching
// specs in this lib import it first.
import 'reflect-metadata';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';

const mockSpawnCli = jest.fn();

jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
    resolveCliPath: () => Promise.resolve('agy'),
    resolveDirectSpawn: () =>
      Promise.resolve({ command: 'agy', prefixArgs: [] }),
  };
});

jest.mock('@ptah-extension/platform-core', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/platform-core')
  >('@ptah-extension/platform-core');
  return {
    ...actual,
    killProcessTree: jest.fn().mockResolvedValue(undefined),
  };
});

import { AntigravityCliAdapter } from './antigravity-cli.adapter';
import { killProcessTree } from '@ptah-extension/platform-core';
import type {
  IMcpAttachmentProbe,
  McpAttachment,
} from '../mcp-attachment-probe.port';

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: { end: jest.Mock; write: jest.Mock };
  kill: jest.Mock;
  killed: boolean;
  pid: number;
  whenSpawned: Promise<number | null>;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin = { end: jest.fn(), write: jest.fn() };
  child.kill = jest.fn();
  child.killed = false;
  child.pid = 4242;
  child.whenSpawned = Promise.resolve(4242);
  return child;
}

describe('AntigravityCliAdapter — MCP config (TASK_2026_285)', () => {
  let tempHome: string;
  let ws: string;
  let previousHome: string | undefined;
  let previousUserProfile: string | undefined;
  let configPath: string;
  let child: FakeChild;
  let adapter: AntigravityCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    tempHome = mkdtempSync(join(tmpdir(), 'agy-adapter-home-'));
    ws = mkdtempSync(join(tmpdir(), 'agy-adapter-ws-'));
    configPath = join(tempHome, '.gemini', 'config', 'mcp_config.json');

    previousHome = process.env['HOME'];
    previousUserProfile = process.env['USERPROFILE'];
    process.env['HOME'] = tempHome;
    process.env['USERPROFILE'] = tempHome;

    child = createFakeChild();
    mockSpawnCli.mockImplementation(() => child);
    adapter = new AntigravityCliAdapter(undefined, async () => true);
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    if (previousUserProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = previousUserProfile;
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  /** The URL this run's write must carry: scoped to the spawn's cwd. */
  function scopedUrl(port: number): string {
    return `http://localhost:${port}/workspace/${encodeURIComponent(ws)}`;
  }

  function servers(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
    return parsed['mcpServers'] ?? {};
  }

  function seedUserConfig(entries: Record<string, unknown>): void {
    mkdirSync(join(tempHome, '.gemini', 'config'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: entries }, null, 2),
      'utf-8',
    );
  }

  /** Spawn with an MCP port, then let the process exit and settle cleanup. */
  async function runAndFinish(port: number): Promise<void> {
    const handle = await adapter.runSdk({
      task: 'do a thing',
      workingDirectory: ws,
      mcpPort: port,
    });
    child.emit('close', 0, null);
    await handle.done;
    // `cleanupMcpEntry` is chained off `done`; let that microtask + its writes
    // settle before asserting on the file.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("writes Ptah's own server as `mcpServers.ptah` with a `serverUrl` before the spawn", async () => {
    const handle = await adapter.runSdk({
      task: 'do a thing',
      workingDirectory: ws,
      mcpPort: 51234,
    });

    // The URL carries the spawn's working directory (TASK_2026_364), and the
    // encoding keeps it free of a literal `/sse`, so a read-back still infers
    // transport `http` and the persistent writer's read-compare stays honest.
    expect(servers()['ptah']).toEqual({
      serverUrl: scopedUrl(51234),
    });

    child.emit('close', 0, null);
    await handle.done;
  });

  it('leads the written URL with /agent/{id} when one was reserved', async () => {
    const handle = await adapter.runSdk({
      task: 'do a thing',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'agent-7',
    });

    // The agent segment is how the server learns WHICH spawn is calling
    // (TASK_2026_402) — the child never names itself.
    expect(servers()['ptah']).toEqual({
      serverUrl: `http://localhost:51234/agent/agent-7/workspace/${encodeURIComponent(ws)}`,
    });

    child.emit('close', 0, null);
    await handle.done;
  });

  it('removes only `ptah` after `done`, leaving a marketplace-installed server in place', async () => {
    seedUserConfig({
      github: { command: 'github-mcp', args: ['--stdio'] },
    });

    await runAndFinish(51234);

    const remaining = servers();
    expect(remaining['ptah']).toBeUndefined();
    expect(remaining['github']).toEqual({
      command: 'github-mcp',
      args: ['--stdio'],
    });
  });

  it('never touches a server the user hand-wrote, in either direction', async () => {
    seedUserConfig({
      mine: { serverUrl: 'https://mine.example.com/sse' },
    });

    await runAndFinish(51234);

    expect(servers()['mine']).toEqual({
      serverUrl: 'https://mine.example.com/sse',
    });
  });

  // `CodeExecutionMCP` keeps a PERSISTENT `ptah` entry in this file for as long
  // as its HTTP server is up, so that `agy` sessions the USER starts have Ptah
  // tools. Cleanup therefore RESTORES what the run found rather than deleting.
  describe('a persistent `ptah` entry written by CodeExecutionMCP', () => {
    it('survives a spawn that finished', async () => {
      seedUserConfig({
        ptah: { serverUrl: 'http://localhost:51820' },
      });

      await runAndFinish(51234);

      expect(servers()['ptah']).toEqual({
        serverUrl: 'http://localhost:51820',
      });
    });

    it("is replaced by this run's port WHILE the agent runs", async () => {
      seedUserConfig({
        ptah: { serverUrl: 'http://localhost:51820' },
      });

      const handle = await adapter.runSdk({
        task: 'do a thing',
        workingDirectory: ws,
        mcpPort: 51234,
      });

      expect(servers()['ptah']).toEqual({
        serverUrl: scopedUrl(51234),
      });

      child.emit('close', 0, null);
      await handle.done;
    });

    it('keeps the lane URL during startup when no attachment probe can confirm the read', async () => {
      seedUserConfig({
        ptah: { serverUrl: 'http://localhost:51820' },
      });

      const handle = await adapter.runSdk({
        task: 'do a thing',
        workingDirectory: ws,
        mcpPort: 51234,
      });
      // Give an early restore every chance to land before the check.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(servers()['ptah']).toEqual({
        serverUrl: scopedUrl(51234),
      });

      child.emit('close', 0, null);
      await handle.done;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(servers()['ptah']).toEqual({
        serverUrl: 'http://localhost:51820',
      });
    });

    it("is restored without disturbing the user's other servers", async () => {
      seedUserConfig({
        ptah: { serverUrl: 'http://localhost:51820' },
        mine: { serverUrl: 'https://mine.example.com/sse' },
      });

      await runAndFinish(51234);

      expect(servers()).toEqual({
        ptah: { serverUrl: 'http://localhost:51820' },
        mine: { serverUrl: 'https://mine.example.com/sse' },
      });
    });
  });

  it('writes nothing at all when the spawn carries no MCP port', async () => {
    const handle = await adapter.runSdk({
      task: 'do a thing',
      workingDirectory: ws,
    });
    child.emit('close', 0, null);
    await handle.done;

    expect(() => readFileSync(configPath, 'utf-8')).toThrow();
  });

  it('serializes two startups and restores the value before both lanes', async () => {
    seedUserConfig({ ptah: { serverUrl: 'http://localhost:51820' } });
    const children = [createFakeChild(), createFakeChild()];
    mockSpawnCli
      .mockImplementationOnce(() => children[0])
      .mockImplementationOnce(() => children[1]);
    const resolveWaits = new Map<string, (entry: McpAttachment) => void>();
    const probe: IMcpAttachmentProbe = {
      get: () => undefined,
      waitFor: (id) =>
        new Promise((resolve) => {
          resolveWaits.set(id, resolve);
        }),
    };
    const first = await adapter.runSdk({
      task: 'one',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'lane-1',
      attachmentProbe: probe,
    });
    expect(servers()['ptah']).toEqual({
      serverUrl: `http://localhost:51234/agent/lane-1/workspace/${encodeURIComponent(ws)}`,
    });
    const secondPromise = adapter.runSdk({
      task: 'two',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'lane-2',
      attachmentProbe: probe,
    });
    await Promise.resolve();
    expect(mockSpawnCli).toHaveBeenCalledTimes(1);
    expect(servers()['ptah']).toEqual({
      serverUrl: `http://localhost:51234/agent/lane-1/workspace/${encodeURIComponent(ws)}`,
    });
    resolveWaits.get('lane-1')?.({
      agentId: 'lane-1',
      method: 'initialize',
      port: 51234,
      time: Date.now(),
    });
    const second = await secondPromise;
    expect(servers()['ptah']).toEqual({
      serverUrl: `http://localhost:51234/agent/lane-2/workspace/${encodeURIComponent(ws)}`,
    });
    resolveWaits.get('lane-2')?.({
      agentId: 'lane-2',
      method: 'initialize',
      port: 51234,
      time: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(servers()['ptah']).toEqual({ serverUrl: 'http://localhost:51820' });
    children[0].emit('close', 0, null);
    children[1].emit('close', 0, null);
    await Promise.all([first.done, second.done]);
  });

  it('releases the startup lock and restores the entry after a stdin write failure', async () => {
    seedUserConfig({ ptah: { serverUrl: 'http://localhost:51820' } });
    child.stdin.write.mockImplementationOnce(() => {
      throw new Error('stdin failed');
    });

    await expect(
      adapter.runSdk({
        task: 'first',
        workingDirectory: ws,
        mcpPort: 51234,
        agentId: 'lane-1',
      }),
    ).rejects.toThrow('stdin failed');
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(child.kill).not.toHaveBeenCalled();
    expect(servers()['ptah']).toEqual({ serverUrl: 'http://localhost:51820' });

    const nextChild = createFakeChild();
    mockSpawnCli.mockImplementationOnce(() => nextChild);
    const second = await adapter.runSdk({
      task: 'second',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'lane-2',
    });
    expect(servers()['ptah']).toEqual({
      serverUrl: `http://localhost:51234/agent/lane-2/workspace/${encodeURIComponent(ws)}`,
    });
    nextChild.emit('close', 0, null);
    await second.done;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(servers()['ptah']).toEqual({ serverUrl: 'http://localhost:51820' });
  });

  it('releases the startup lock and restores the entry when the failed child never reports a pid', async () => {
    seedUserConfig({ ptah: { serverUrl: 'http://localhost:51820' } });
    child.whenSpawned = new Promise<number | null>(() => undefined);
    child.stdin.write.mockImplementationOnce(() => {
      throw new Error('stdin failed');
    });
    const defaultDeadline = AntigravityCliAdapter.startupChildStopDeadlineMs;
    AntigravityCliAdapter.startupChildStopDeadlineMs = 20;
    try {
      await expect(
        adapter.runSdk({
          task: 'first',
          workingDirectory: ws,
          mcpPort: 51234,
          agentId: 'lane-1',
        }),
      ).rejects.toThrow('stdin failed');
    } finally {
      AntigravityCliAdapter.startupChildStopDeadlineMs = defaultDeadline;
    }
    expect(killProcessTree).not.toHaveBeenCalled();
    expect(servers()['ptah']).toEqual({ serverUrl: 'http://localhost:51820' });

    const nextChild = createFakeChild();
    mockSpawnCli.mockImplementationOnce(() => nextChild);
    const second = await adapter.runSdk({
      task: 'second',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'lane-2',
    });
    expect(servers()['ptah']).toEqual({
      serverUrl: `http://localhost:51234/agent/lane-2/workspace/${encodeURIComponent(ws)}`,
    });
    nextChild.emit('close', 0, null);
    await second.done;
  });

  it('reports a failed config write without firing the attachment timeout callback', async () => {
    mkdirSync(configPath, { recursive: true });
    const handle = await adapter.runSdk({
      task: 'continue without MCP',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'lane-config-failure',
      attachmentProbe: {
        get: () => undefined,
        waitFor: jest.fn().mockResolvedValue(undefined),
      },
    });
    const onTimeout = jest.fn();
    handle.onMcpAttachmentTimeout?.(onTimeout);
    expect(handle.mcpConfigWriteFailed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTimeout).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    await handle.done;
  });

  it('does not preserve a stale lane URL as the next lane prior', async () => {
    seedUserConfig({
      ptah: {
        serverUrl: 'http://localhost:51820/agent/old-lane/workspace/root',
      },
    });
    const handle = await adapter.runSdk({
      task: 'next',
      workingDirectory: ws,
      mcpPort: 51234,
      agentId: 'lane-2',
    });
    child.emit('close', 0, null);
    await handle.done;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(servers()['ptah']).toEqual({ serverUrl: 'http://localhost:51820' });
  });
});
