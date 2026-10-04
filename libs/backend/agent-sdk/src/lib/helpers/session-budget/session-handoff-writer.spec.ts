/**
 * Session handoff writer (TASK_2026_597 N8) against a real temp directory:
 * location, atomic replace, retention at 51 files, a rejected non-UUID id, a
 * `..` escape and an unwritable directory.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  SESSION_HANDOFF_RETENTION,
  SessionHandoffWriter,
  resolveSessionHandoffPath,
  sessionHandoffsDirectory,
} from './session-handoff-writer';

const uuid = (i: number): string =>
  `aaaaaaaa-bbbb-4ccc-8ddd-${i.toString(16).padStart(12, '0')}`;

describe('SessionHandoffWriter', () => {
  let home: string;
  let logger: MockLogger;
  let writer: SessionHandoffWriter;
  let dir: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-handoff-'));
    logger = createMockLogger();
    writer = new SessionHandoffWriter(logger as unknown as Logger, {
      homeDir: home,
    });
    dir = path.join(home, '.ptah', 'handoffs');
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('writes ~/.ptah/handoffs/<sessionId>.md', async () => {
    const result = await writer.write(uuid(1), '# handoff\n');
    expect(result).toEqual({ path: path.join(dir, `${uuid(1)}.md`) });
    expect(writer.directory).toBe(dir);
    expect(await fs.readFile(path.join(dir, `${uuid(1)}.md`), 'utf8')).toBe(
      '# handoff\n',
    );
  });

  it('defaults to the user home directory', () => {
    expect(sessionHandoffsDirectory()).toBe(
      path.resolve(os.homedir(), '.ptah', 'handoffs'),
    );
  });

  it('replaces an existing handoff atomically and leaves no temp file', async () => {
    await writer.write(uuid(1), 'old');
    await writer.write(uuid(1), 'new');
    expect(await fs.readFile(path.join(dir, `${uuid(1)}.md`), 'utf8')).toBe(
      'new',
    );
    expect(await fs.readdir(dir)).toEqual([`${uuid(1)}.md`]);
  });

  it('keeps the previous file intact and removes the temp file when the rename fails', async () => {
    // A directory at the target path makes the rename fail after the temp write.
    await fs.mkdir(path.join(dir, `${uuid(2)}.md`), { recursive: true });
    const result = await writer.write(uuid(2), 'content');
    expect(result.path).toBeNull();
    expect(result.writeError).toMatch(
      /^Could not write the handoff file \([A-Z0-9_]+\)$/,
    );
    expect((await fs.stat(path.join(dir, `${uuid(2)}.md`))).isDirectory()).toBe(
      true,
    );
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual(
      [],
    );
  });

  it('keeps the newest 50 handoffs when the 51st is written', async () => {
    await fs.mkdir(dir, { recursive: true });
    const base = Date.now() / 1000 - 10_000;
    for (let i = 0; i < SESSION_HANDOFF_RETENTION; i++) {
      const file = path.join(dir, `${uuid(i)}.md`);
      await fs.writeFile(file, `h${i}`);
      // uuid(0) is the oldest.
      await fs.utimes(file, base + i, base + i);
    }
    // Files that are not handoffs are never pruned.
    await fs.writeFile(path.join(dir, 'notes.txt'), 'keep');

    const result = await writer.write(uuid(999), 'newest');

    const names = await fs.readdir(dir);
    const handoffs = names.filter((n) => n.endsWith('.md'));
    expect(handoffs).toHaveLength(SESSION_HANDOFF_RETENTION);
    expect(names).not.toContain(`${uuid(0)}.md`);
    expect(names).toContain(`${uuid(1)}.md`);
    expect(names).toContain(`${uuid(999)}.md`);
    expect(names).toContain('notes.txt');
    expect(result.path).toBe(path.join(dir, `${uuid(999)}.md`));
  });

  it('never prunes the file it just wrote, even with an older clock', async () => {
    await fs.mkdir(dir, { recursive: true });
    const future = Date.now() / 1000 + 10_000;
    for (let i = 0; i < SESSION_HANDOFF_RETENTION; i++) {
      const file = path.join(dir, `${uuid(i)}.md`);
      await fs.writeFile(file, `h${i}`);
      await fs.utimes(file, future + i, future + i);
    }
    await writer.write(uuid(999), 'newest');
    const names = await fs.readdir(dir);
    expect(names).toContain(`${uuid(999)}.md`);
    expect(names).not.toContain(`${uuid(0)}.md`);
  });

  it('rejects a non-UUID session id without creating anything', async () => {
    const result = await writer.write('not-a-uuid', 'x');
    expect(result).toEqual({ path: null, writeError: 'Invalid session id' });
    await expect(fs.access(dir)).rejects.toThrow();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('not-a-uuid');
  });

  it('rejects a `..` escape', async () => {
    const result = await writer.write(`../${uuid(1)}`, 'x');
    expect(result.path).toBeNull();
    expect(resolveSessionHandoffPath(dir, `../${uuid(1)}`)).toBeNull();
    expect(resolveSessionHandoffPath(dir, `${uuid(1)}/../../x`)).toBeNull();
    expect(resolveSessionHandoffPath(dir, uuid(1))).toBe(
      path.join(dir, `${uuid(1)}.md`),
    );
    await expect(
      fs.access(path.join(home, '.ptah', `${uuid(1)}.md`)),
    ).rejects.toThrow();
  });

  it('returns writeError and warns once when the directory is unwritable', async () => {
    // A FILE where the `.ptah` directory should be: mkdir fails on every OS.
    await fs.writeFile(path.join(home, '.ptah'), 'not a directory');
    const first = await writer.write(uuid(1), 'x');
    const second = await writer.write(uuid(1), 'x');
    expect(first.path).toBeNull();
    expect(first.writeError).toMatch(/^Could not write the handoff file/);
    expect(second).toEqual(first);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
