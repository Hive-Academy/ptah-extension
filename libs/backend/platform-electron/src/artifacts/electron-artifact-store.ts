import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

import {
  ArtifactStoreError,
  isPathWithinRoots,
  type ArtifactScope,
  type IArtifactStore,
} from '@ptah-extension/platform-core';
import type { ArtifactListResponse, ArtifactPublishInput, ArtifactPublishResult } from '@ptah-extension/shared';
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_PROTOCOL_SCHEME,
  ArtifactPublishInputSchema,
  ArtifactPublishResultSchema,
} from '@ptah-extension/shared/mcp-apps-contracts';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
/** Reject publishes once a workspace has 500 records; no silent eviction of user work. */
export const ARTIFACT_WORKSPACE_RECORD_LIMIT = 500;
const ARTIFACT_LIST_LIMIT = 200;

const StoredArtifactSchema = ArtifactPublishResultSchema.extend({
  workspaceRoot: z.string().min(1),
});
type StoredArtifact = z.infer<typeof StoredArtifactSchema>;

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export class ElectronArtifactStore implements IArtifactStore {
  private readonly root: string;
  private readonly cleanup: Promise<void>;
  private pending: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.root = path.join(userDataPath, 'artifacts');
    this.cleanup = this.sweepTemporaryRecords();
  }

  async publish(scope: ArtifactScope, input: ArtifactPublishInput): Promise<ArtifactPublishResult> {
    const operation = this.pending.then(() => this.publishOnce(scope, input));
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async publishOnce(scope: ArtifactScope, input: ArtifactPublishInput): Promise<ArtifactPublishResult> {
    await this.cleanup;
    const parsed = ArtifactPublishInputSchema.safeParse(input);
    if (!parsed.success && typeof input?.html === 'string' &&
        Buffer.byteLength(input.html, 'utf8') > ARTIFACT_MAX_BYTES) {
      throw new ArtifactStoreError('TOO_LARGE');
    }
    if (!parsed.success || !scope.workspaceRoot || !scope.sessionId) {
      throw new ArtifactStoreError('INVALID_INPUT');
    }

    let workspaceRoot: string;
    try {
      workspaceRoot = await fs.realpath(scope.workspaceRoot);
    } catch {
      throw new ArtifactStoreError('INVALID_PATH');
    }

    let bytes: Buffer;
    if ('html' in parsed.data) {
      bytes = Buffer.from(parsed.data.html, 'utf8');
    } else {
      const source = path.resolve(workspaceRoot, parsed.data.path);
      if (!isPathWithinRoots(source, [workspaceRoot])) {
        throw new ArtifactStoreError('INVALID_PATH');
      }
      let realSource: string;
      try {
        // Reject links at every path component below the trusted workspace root.
        let component = workspaceRoot;
        for (const segment of path.relative(workspaceRoot, source).split(path.sep)) {
          component = path.join(component, segment);
          if ((await fs.lstat(component)).isSymbolicLink()) throw new ArtifactStoreError('INVALID_PATH');
        }
        realSource = await fs.realpath(source);
      } catch (error) {
        if (error instanceof ArtifactStoreError) throw error;
        throw new ArtifactStoreError('INVALID_PATH');
      }
      if (!isPathWithinRoots(realSource, [workspaceRoot]) ||
          !/\.html?$/i.test(source) || !/\.html?$/i.test(realSource)) {
        throw new ArtifactStoreError('INVALID_PATH');
      }
      try {
        const before = await fs.lstat(source);
        if (!before.isFile()) throw new ArtifactStoreError('INVALID_PATH');
        if (before.size > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('TOO_LARGE');
        const handle = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const openedPath = await fs.realpath(source);
          if (!isPathWithinRoots(openedPath, [workspaceRoot]) || openedPath !== realSource) {
            throw new ArtifactStoreError('INVALID_PATH');
          }
          const opened = await handle.stat();
          if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
              opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) {
            throw new ArtifactStoreError('INVALID_PATH');
          }
          if (opened.size > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('TOO_LARGE');
          bytes = await handle.readFile();
          const after = await handle.stat();
          if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
            throw new ArtifactStoreError('INVALID_PATH');
          }
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (error instanceof ArtifactStoreError) throw error;
        if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
          throw new ArtifactStoreError('INVALID_PATH');
        }
        throw new ArtifactStoreError('INVALID_PATH');
      }
    }
    if (bytes.byteLength > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('TOO_LARGE');

    const existing = await this.readRecords();
    if (existing.filter((record) => record.workspaceRoot === workspaceRoot).length >=
        ARTIFACT_WORKSPACE_RECORD_LIMIT) {
      throw new ArtifactStoreError('QUOTA');
    }

    const id = randomUUID();
    const record: StoredArtifact = {
      id,
      title: parsed.data.title,
      revision: 1,
      sessionId: scope.sessionId,
      workspaceRoot,
      viewerUrl: `${ARTIFACT_PROTOCOL_SCHEME}://${id}/index.html`,
      createdAt: new Date().toISOString(),
      savedPath: path.join(this.root, id, '1', 'index.html'),
    };
    const temporary = path.join(this.root, `${id}.tmp`);
    try {
      await fs.mkdir(path.join(temporary, '1'), { recursive: true });
      const temporaryBytes = path.join(temporary, '1', 'index.html.tmp');
      await fs.writeFile(temporaryBytes, bytes, { flag: 'wx' });
      await fs.rename(temporaryBytes, path.join(temporary, '1', 'index.html'));
      const temporaryMetadata = path.join(temporary, 'metadata.json.tmp');
      await fs.writeFile(temporaryMetadata, JSON.stringify(record), { flag: 'wx' });
      await fs.rename(temporaryMetadata, path.join(temporary, 'metadata.json'));
      await fs.rename(temporary, path.join(this.root, id));
      const { workspaceRoot: _workspaceRoot, ...result } = record;
      return result;
    } catch {
      // degradation-audit: optional-capability - best-effort cleanup of an unpublished temporary record;
      // the startup sweep retries it.
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw new ArtifactStoreError('IO_ERROR');
    }
  }

  async list(scope: ArtifactScope): Promise<ArtifactListResponse> {
    if (!scope.workspaceRoot || !scope.sessionId) return { artifacts: [] };
    let workspaceRoot: string;
    try {
      workspaceRoot = await fs.realpath(scope.workspaceRoot);
    } catch (error) {
      if (isMissing(error)) return { artifacts: [] };
      throw new ArtifactStoreError('IO_ERROR');
    }
    const artifacts = (await this.readRecords())
      .filter((record) => record.workspaceRoot === workspaceRoot && record.sessionId === scope.sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, ARTIFACT_LIST_LIMIT)
      .map((record) => ({
        id: record.id,
        title: record.title,
        revision: record.revision,
        sessionId: record.sessionId,
        viewerUrl: record.viewerUrl,
        createdAt: record.createdAt,
      }));
    return { artifacts };
  }

  async readBytes(id: string): Promise<Uint8Array | null> {
    if (!ID_PATTERN.test(id)) return null;
    const record = await this.readRecord(id);
    if (!record) return null;
    try {
      return await fs.readFile(path.join(this.root, id, String(record.revision), 'index.html'));
    } catch {
      // degradation-audit: optional-capability - a missing or unreadable artifact is a 404.
      return null;
    }
  }

  private async readRecords(): Promise<StoredArtifact[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch (error) {
      if (isMissing(error)) return [];
      throw new ArtifactStoreError('IO_ERROR');
    }
    const records = await Promise.all(entries.filter((id) => ID_PATTERN.test(id)).map((id) => this.readRecord(id)));
    return records.filter((record): record is StoredArtifact => record !== null);
  }

  private async readRecord(id: string): Promise<StoredArtifact | null> {
    try {
      const candidate: unknown = JSON.parse(await fs.readFile(path.join(this.root, id, 'metadata.json'), 'utf8'));
      const parsed = StoredArtifactSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.id !== id || parsed.data.revision !== 1 ||
          parsed.data.viewerUrl !== `${ARTIFACT_PROTOCOL_SCHEME}://${id}/index.html`) return null;
      return parsed.data;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return null;
      throw new ArtifactStoreError('IO_ERROR');
    }
  }

  private async sweepTemporaryRecords(): Promise<void> {
    try {
      const entries = await fs.readdir(this.root);
      for (const entry of entries.filter((name) => /^[a-z0-9-]+\.tmp$/.test(name))) {
        try {
          await fs.rm(path.join(this.root, entry), { recursive: true, force: true });
        } catch {
          // degradation-audit: optional-capability - stale unpublished data can be retried on next launch.
        }
      }
    } catch {
      // degradation-audit: optional-capability - a missing or inaccessible store can be handled on first use.
    }
  }
}
