import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { ISessionBlobStore } from '@ptah-extension/platform-core';

// Session ids and blob names become path segments, so only plain names pass:
// letters, digits, dot, dash and underscore, and never "." or "..".
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafe(kind: string, value: string): void {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(
      `FileSessionBlobStore: unsafe ${kind}: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * {@link ISessionBlobStore} as JSON files: `<root>/<sessionId>/<name>.json`.
 * A write goes to a temp file in the same folder and is renamed over the
 * target, so a reader never sees half a file.
 */
export class FileSessionBlobStore implements ISessionBlobStore {
  constructor(private readonly root: string) {}

  async read<T>(sessionId: string, name: string): Promise<T | undefined> {
    try {
      const raw = await fsp.readFile(this.file(sessionId, name), 'utf8');
      return JSON.parse(raw) as T;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(sessionId: string, name: string, value: unknown): Promise<void> {
    const target = this.file(sessionId, name);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temp, JSON.stringify(value), 'utf8');
      await fsp.rename(temp, target);
    } catch (error: unknown) {
      await fsp.rm(temp, { force: true });
      throw error;
    }
  }

  async remove(sessionId: string, name: string): Promise<void> {
    await fsp.rm(this.file(sessionId, name), { force: true });
  }

  async removeAll(sessionId: string): Promise<void> {
    assertSafe('session id', sessionId);
    await fsp.rm(path.join(this.root, sessionId), {
      recursive: true,
      force: true,
    });
  }

  private file(sessionId: string, name: string): string {
    assertSafe('session id', sessionId);
    assertSafe('blob name', name);
    return path.join(this.root, sessionId, `${name}.json`);
  }
}
