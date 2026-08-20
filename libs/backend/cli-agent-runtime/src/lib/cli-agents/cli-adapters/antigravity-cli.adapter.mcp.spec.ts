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
    killProcessTree: jest.fn(),
  };
});

import { AntigravityCliAdapter } from './antigravity-cli.adapter';

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: { end: jest.Mock };
  kill: jest.Mock;
  killed: boolean;
  pid: number;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin = { end: jest.fn() };
  child.kill = jest.fn();
  child.killed = false;
  child.pid = 4242;
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
    adapter = new AntigravityCliAdapter();
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    if (previousUserProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = previousUserProfile;
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

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

    expect(servers()['ptah']).toEqual({
      serverUrl: 'http://localhost:51234',
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

  it('writes nothing at all when the spawn carries no MCP port', async () => {
    const handle = await adapter.runSdk({
      task: 'do a thing',
      workingDirectory: ws,
    });
    child.emit('close', 0, null);
    await handle.done;

    expect(() => readFileSync(configPath, 'utf-8')).toThrow();
  });
});
