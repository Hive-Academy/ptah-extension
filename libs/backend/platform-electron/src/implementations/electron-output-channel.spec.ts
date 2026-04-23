/**
 * `electron-output-channel.spec.ts` — runs `runOutputChannelContract` against
 * `ElectronOutputChannel` with a tmpdir-backed log directory, plus checks
 * specific to the on-disk implementation (timestamp format, clear()
 * truncation, dispose idempotency).
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runOutputChannelContract } from '@ptah-extension/platform-core/testing';
import { ElectronOutputChannel } from './electron-output-channel';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-electron-out-'));
  tmpDirs.push(dir);
  return dir;
}

// Give the underlying WriteStream a moment to flush — Node buffers
// small writes and the assertion races ahead without this.
async function flushStreams(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

afterEach(async () => {
  // Allow async stream writes initiated by the contract suite to flush before
  // we delete the directory — otherwise Windows refuses to unlink the log.
  await flushStreams(25);
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow */
    });
  }
});

runOutputChannelContract('ElectronOutputChannel', async () => {
  const logDir = await makeTempDir();
  return new ElectronOutputChannel('test-channel', logDir);
});

describe('ElectronOutputChannel — Electron-specific behaviour', () => {
  let logDir: string;
  let channel: ElectronOutputChannel;

  beforeEach(async () => {
    logDir = await makeTempDir();
    channel = new ElectronOutputChannel('ptah-test', logDir);
  });

  afterEach(() => {
    channel.dispose();
  });

  it('appendLine writes ISO-timestamped lines to the log file', async () => {
    channel.appendLine('first');
    channel.appendLine('second');
    await flushStreams();

    const raw = await fs.readFile(path.join(logDir, 'ptah-test.log'), 'utf-8');
    // Each line must start with a bracketed ISO timestamp, e.g. `[2024-...Z]`.
    expect(raw).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] first/m);
    expect(raw).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] second/m);
  });

  it('append writes raw fragments without adding a newline', async () => {
    channel.append('frag-a');
    channel.append('frag-b');
    await flushStreams();
    const raw = await fs.readFile(path.join(logDir, 'ptah-test.log'), 'utf-8');
    expect(raw).toContain('frag-afrag-b');
  });

  it('clear truncates the file — prior content is gone', async () => {
    channel.appendLine('before-clear');
    await flushStreams();
    channel.clear();
    channel.appendLine('after-clear');
    await flushStreams();

    const raw = await fs.readFile(path.join(logDir, 'ptah-test.log'), 'utf-8');
    expect(raw).toContain('after-clear');
    expect(raw).not.toContain('before-clear');
  });

  it('creates the log directory when it does not exist', () => {
    const nested = path.join(logDir, 'nested', 'deeper');
    const ch = new ElectronOutputChannel('nested', nested);
    expect(fsSync.existsSync(nested)).toBe(true);
    ch.dispose();
  });

  it('dispose prevents further writes silently (no throw)', () => {
    channel.dispose();
    expect(() => channel.appendLine('after-dispose')).not.toThrow();
    expect(() => channel.append('frag')).not.toThrow();
    expect(() => channel.clear()).not.toThrow();
  });

  it('show does not throw for disposed or live channels', () => {
    expect(() => channel.show()).not.toThrow();
    channel.dispose();
    expect(() => channel.show()).not.toThrow();
  });

  it('name is the value passed to the constructor', () => {
    expect(channel.name).toBe('ptah-test');
  });
});
