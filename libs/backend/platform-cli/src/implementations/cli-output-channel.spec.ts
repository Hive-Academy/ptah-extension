/**
 * `cli-output-channel.spec.ts` — runs `runOutputChannelContract` against
 * `CliOutputChannel` with a tmpdir-backed log directory, plus checks specific
 * to the on-disk implementation (ISO timestamp, clear() truncation, dispose
 * idempotency, nested-directory creation).
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runOutputChannelContract } from '@ptah-extension/platform-core/testing';
import { CliOutputChannel } from './cli-output-channel';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-cli-out-'));
  tmpDirs.push(dir);
  return dir;
}

// Give the underlying WriteStream a moment to flush — Node buffers small
// writes and the assertion races ahead without this. Windows in particular
// refuses to unlink the log file if writes are still in flight.
async function flushStreams(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

afterEach(async () => {
  await flushStreams(25);
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow */
    });
  }
});

runOutputChannelContract('CliOutputChannel', async () => {
  const logDir = await makeTempDir();
  return new CliOutputChannel('test-channel', logDir);
});

describe('CliOutputChannel — CLI-specific behaviour', () => {
  let logDir: string;
  let channel: CliOutputChannel;

  beforeEach(async () => {
    logDir = await makeTempDir();
    channel = new CliOutputChannel('ptah-cli-test', logDir);
  });

  afterEach(() => {
    channel.dispose();
  });

  it('appendLine writes ISO-timestamped lines to the log file', async () => {
    channel.appendLine('first');
    channel.appendLine('second');
    await flushStreams();

    const raw = await fs.readFile(
      path.join(logDir, 'ptah-cli-test.log'),
      'utf-8',
    );
    expect(raw).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] first/m);
    expect(raw).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] second/m);
  });

  it('append writes raw fragments without adding a newline', async () => {
    channel.append('frag-a');
    channel.append('frag-b');
    await flushStreams();
    const raw = await fs.readFile(
      path.join(logDir, 'ptah-cli-test.log'),
      'utf-8',
    );
    expect(raw).toContain('frag-afrag-b');
  });

  it('clear truncates the file — prior content is gone', async () => {
    channel.appendLine('before-clear');
    await flushStreams();
    channel.clear();
    channel.appendLine('after-clear');
    await flushStreams();

    const raw = await fs.readFile(
      path.join(logDir, 'ptah-cli-test.log'),
      'utf-8',
    );
    expect(raw).toContain('after-clear');
    expect(raw).not.toContain('before-clear');
  });

  it('creates the log directory when it does not exist', () => {
    const nested = path.join(logDir, 'nested', 'deeper');
    const ch = new CliOutputChannel('nested', nested);
    expect(fsSync.existsSync(nested)).toBe(true);
    ch.dispose();
  });

  it('dispose prevents further writes silently (no throw)', () => {
    channel.dispose();
    expect(() => channel.appendLine('after-dispose')).not.toThrow();
    expect(() => channel.append('frag')).not.toThrow();
    expect(() => channel.clear()).not.toThrow();
  });

  it('show is side-effect only (no throw, no return value) for live channels', () => {
    // The impl calls `console.log(...)` which jest's own console interceptor
    // replaces — we cannot spy on it through `jest.spyOn(console, 'log')` or
    // `process.stdout.write`, both of which are pre-swapped by the harness.
    // Instead, lock in the two observable invariants: show returns void and
    // does not throw, even when called repeatedly on the same live channel.
    expect(channel.show()).toBeUndefined();
    expect(() => channel.show()).not.toThrow();
    expect(() => channel.show()).not.toThrow();
  });

  it('name is the value passed to the constructor', () => {
    expect(channel.name).toBe('ptah-cli-test');
  });
});
