/**
 * Counts what a walk reads through `fs.promises.opendir`: the directory
 * handles it opens and closes, and the entries it takes from them. Used by
 * the bounded-`findFiles` specs of the Electron and CLI adapters and of
 * `walkGlobMatches` (TASK_2026_559 Batch 23b review r2 M1) to show that a
 * result limit bounds the reading, not only the returned list.
 */
import * as fs from 'fs';

export interface DirectoryReadProbe {
  /** Directory handles opened since the probe started. */
  readonly opened: number;
  /** Handles whose iteration finished, threw or was returned (closed). */
  readonly closed: number;
  /** Entries taken from every handle. */
  readonly entriesRead: number;
  /** Put the real `opendir` back. */
  restore(): void;
}

export function countDirectoryReads(): DirectoryReadProbe {
  const counts = { opened: 0, closed: 0, entriesRead: 0 };
  const opendir = fs.promises.opendir.bind(fs.promises);
  const spy = jest
    .spyOn(fs.promises, 'opendir')
    .mockImplementation(async (dir, options) => {
      const handle = await opendir(dir, options);
      counts.opened++;
      const iterate = handle[Symbol.asyncIterator].bind(handle);
      return Object.assign(handle, {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const entry of iterate()) {
              counts.entriesRead++;
              yield entry;
            }
          } finally {
            counts.closed++;
          }
        },
      });
    });
  return {
    get opened() {
      return counts.opened;
    },
    get closed() {
      return counts.closed;
    },
    get entriesRead() {
      return counts.entriesRead;
    },
    restore: () => spy.mockRestore(),
  };
}
