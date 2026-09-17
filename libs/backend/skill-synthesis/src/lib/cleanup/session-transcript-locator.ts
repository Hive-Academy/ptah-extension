import * as fs from 'fs/promises';
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

export interface SessionsDirectoryLister {
  listSessionsDirectories?(): Promise<readonly string[] | null>;
}

export type SessionTranscriptLocation =
  | { kind: 'found'; path: string }
  | { kind: 'absent' }
  | { kind: 'unavailable' };

export interface SessionTranscriptLookupStats {
  directoryListings: number;
  pathStats: number;
  cacheHits: number;
}

export interface SessionTranscriptRunLookup {
  locate(sessionId: string): Promise<SessionTranscriptLocation>;
  stats(): SessionTranscriptLookupStats;
}

function errorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return null;
}

function isSafeSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    !sessionId.includes('/') &&
    !sessionId.includes('\\') &&
    !sessionId.includes('..')
  );
}

@injectable()
export class SessionTranscriptLocator {
  constructor(
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly reader: SessionsDirectoryLister,
  ) {}

  createRunLookup(): SessionTranscriptRunLookup {
    const cache = new Map<string, SessionTranscriptLocation>();
    let directories: readonly string[] | null | undefined;
    let directoryListings = 0;
    let pathStats = 0;
    let cacheHits = 0;

    const loadDirectories = async (): Promise<readonly string[] | null> => {
      if (directories !== undefined) return directories;
      const list = this.reader.listSessionsDirectories;
      if (typeof list !== 'function') {
        directories = null;
        return directories;
      }
      directoryListings++;
      try {
        directories = await list.call(this.reader);
      } catch (error: unknown) {
        // degradation-audit: optional-capability - a reader implementation may
        // fail while listing; unavailable keeps candidates conservatively.
        void error;
        directories = null;
      }
      return directories;
    };

    return {
      locate: async (sessionId: string): Promise<SessionTranscriptLocation> => {
        const cached = cache.get(sessionId);
        if (cached) {
          cacheHits++;
          return cached;
        }

        if (!isSafeSessionId(sessionId)) {
          const result = { kind: 'unavailable' } as const;
          cache.set(sessionId, result);
          return result;
        }

        const sessionDirectories = await loadDirectories();
        if (sessionDirectories === null || sessionDirectories.length === 0) {
          const result = { kind: 'unavailable' } as const;
          cache.set(sessionId, result);
          return result;
        }

        let unavailable = false;
        for (const directory of sessionDirectories) {
          const transcriptPath = path.join(directory, `${sessionId}.jsonl`);
          pathStats++;
          try {
            const stats = await fs.stat(transcriptPath);
            if (stats.isFile()) {
              const result = {
                kind: 'found',
                path: transcriptPath,
              } as const;
              cache.set(sessionId, result);
              return result;
            }
          } catch (error: unknown) {
            // degradation-audit: optional-capability - missing paths are normal;
            // other stat failures keep the candidate if no later folder hits.
            const code = errorCode(error);
            if (code !== 'ENOENT' && code !== 'ENOTDIR') unavailable = true;
          }
        }

        const result = unavailable
          ? ({ kind: 'unavailable' } as const)
          : ({ kind: 'absent' } as const);
        cache.set(sessionId, result);
        return result;
      },
      stats: () => ({ directoryListings, pathStats, cacheHits }),
    };
  }
}
