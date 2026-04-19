/**
 * JsonFileCheckpointer — Persistent LangGraph checkpointer using JSON files.
 *
 * Stores checkpoint data in `.ptah/deep-agent-sessions/{thread_id}/` inside
 * the user's workspace. Zero native dependencies — no better-sqlite3 or WASM.
 *
 * File layout:
 *   {baseDir}/{thread_id}/checkpoint-{checkpoint_id}.json
 *   {baseDir}/{thread_id}/writes-{checkpoint_id}-{task_id}.json
 *   {baseDir}/{thread_id}/metadata.json  (thread-level index)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from 'fs';
import { join } from 'path';
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type {
  Checkpoint,
  CheckpointTuple,
  CheckpointListOptions,
} from '@langchain/langgraph-checkpoint';
import type {
  CheckpointMetadata,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';

type ChannelVersions = Record<string, number | string>;

interface StoredCheckpoint {
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  parentId?: string;
}

interface StoredWrite {
  writes: Array<[string, unknown]>;
  taskId: string;
}

interface ThreadIndex {
  checkpointIds: string[];
  createdAt: string;
  updatedAt: string;
}

export class JsonFileCheckpointer extends BaseCheckpointSaver {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  }

  private threadDir(threadId: string): string {
    const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.baseDir, safe);
  }

  private ensureThreadDir(threadId: string): string {
    const dir = this.threadDir(threadId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getThreadId(config: RunnableConfig): string {
    return (config.configurable?.['thread_id'] as string) ?? 'default';
  }

  private getCheckpointId(config: RunnableConfig): string | undefined {
    return config.configurable?.['checkpoint_id'] as string | undefined;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = this.getThreadId(config);
    const dir = this.threadDir(threadId);
    if (!existsSync(dir)) return undefined;

    const requestedId = this.getCheckpointId(config);
    const index = this.readIndex(threadId);
    if (!index || index.checkpointIds.length === 0) return undefined;

    const checkpointId =
      requestedId ?? index.checkpointIds[index.checkpointIds.length - 1];
    const cpPath = join(dir, `checkpoint-${checkpointId}.json`);
    if (!existsSync(cpPath)) return undefined;

    const stored: StoredCheckpoint = JSON.parse(readFileSync(cpPath, 'utf-8'));
    const pendingWrites = this.loadWrites(threadId, checkpointId);

    const tupleConfig: RunnableConfig = {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpointId,
      },
    };

    let parentConfig: RunnableConfig | undefined;
    if (stored.parentId) {
      parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_id: stored.parentId,
        },
      };
    }

    return {
      config: tupleConfig,
      checkpoint: stored.checkpoint,
      metadata: stored.metadata,
      parentConfig,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = this.getThreadId(config);
    const index = this.readIndex(threadId);
    if (!index) return;

    let ids = [...index.checkpointIds].reverse();

    if (options?.before?.configurable?.['checkpoint_id']) {
      const beforeId = options.before.configurable['checkpoint_id'] as string;
      const idx = ids.indexOf(beforeId);
      if (idx >= 0) {
        ids = ids.slice(idx + 1);
      }
    }

    if (options?.limit) {
      ids = ids.slice(0, options.limit);
    }

    for (const cpId of ids) {
      const tuple = await this.getTuple({
        configurable: { thread_id: threadId, checkpoint_id: cpId },
      });
      if (tuple) yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = this.getThreadId(config);
    const dir = this.ensureThreadDir(threadId);
    const checkpointId = checkpoint.id;

    const parentId = this.getCheckpointId(config);

    const stored: StoredCheckpoint = {
      checkpoint,
      metadata,
      parentId,
    };

    writeFileSync(
      join(dir, `checkpoint-${checkpointId}.json`),
      JSON.stringify(stored, null, 2),
      'utf-8',
    );

    const index = this.readIndex(threadId) ?? {
      checkpointIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!index.checkpointIds.includes(checkpointId)) {
      index.checkpointIds.push(checkpointId);
    }
    index.updatedAt = new Date().toISOString();
    this.writeIndex(threadId, index);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpointId,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = this.getThreadId(config);
    const checkpointId = this.getCheckpointId(config);
    if (!checkpointId) return;

    const dir = this.ensureThreadDir(threadId);
    const stored: StoredWrite = {
      writes: writes.map(([channel, value]) => [channel, value]),
      taskId,
    };

    writeFileSync(
      join(dir, `writes-${checkpointId}-${taskId}.json`),
      JSON.stringify(stored, null, 2),
      'utf-8',
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    const dir = this.threadDir(threadId);
    if (!existsSync(dir)) return;

    for (const file of readdirSync(dir)) {
      unlinkSync(join(dir, file));
    }
    rmdirSync(dir);
  }

  listThreads(): string[] {
    if (!existsSync(this.baseDir)) return [];
    return readdirSync(this.baseDir).filter((entry) => {
      const indexPath = join(this.baseDir, entry, 'metadata.json');
      return existsSync(indexPath);
    });
  }

  private readIndex(threadId: string): ThreadIndex | null {
    const path = join(this.threadDir(threadId), 'metadata.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  private writeIndex(threadId: string, index: ThreadIndex): void {
    const dir = this.ensureThreadDir(threadId);
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }

  private loadWrites(
    threadId: string,
    checkpointId: string,
  ): Array<[string, string, unknown]> {
    const dir = this.threadDir(threadId);
    const prefix = `writes-${checkpointId}-`;
    const results: Array<[string, string, unknown]> = [];

    if (!existsSync(dir)) return results;

    for (const file of readdirSync(dir)) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        const stored: StoredWrite = JSON.parse(
          readFileSync(join(dir, file), 'utf-8'),
        );
        for (const [channel, value] of stored.writes) {
          results.push([stored.taskId, channel, value]);
        }
      }
    }

    return results;
  }
}
