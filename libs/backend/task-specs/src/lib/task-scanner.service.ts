import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CARRIER_FILE,
  type ExcludedTaskFolder,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { parseTaskFile } from './task-frontmatter';

/** A scanned, included task — summary plus its markdown body. */
export type ScannedTask = TaskSpecSummary & { body: string };

/** Result of a full folder scan of `.ptah/specs/`. */
export interface TaskScanResult {
  tasks: ScannedTask[];
  excluded: ExcludedTaskFolder[];
  /** false when `.ptah/specs/` does not exist (friendly no-op, R3.6). */
  specsDirExists: boolean;
}

/**
 * Scans `.ptah/specs/<id>/task.md` and classifies each folder into an included
 * task or a typed exclusion. NEVER throws (NFR-5): unreadable folders/files
 * become `reason: 'unreadable'` rows; a missing specs dir is a clean no-op.
 *
 * All I/O goes through `IFileSystemProvider` (hexagonal) — no direct node:fs.
 */
@injectable()
export class TaskScannerService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  async scan(workspaceRoot: string): Promise<TaskScanResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const specsDir = path.join(root, '.ptah', 'specs');

    let specsDirExists = false;
    try {
      specsDirExists = await this.fs.exists(specsDir);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] specs dir stat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { tasks: [], excluded: [], specsDirExists: false };
    }
    if (!specsDirExists) {
      return { tasks: [], excluded: [], specsDirExists: false };
    }

    let entries: Awaited<ReturnType<IFileSystemProvider['readDirectory']>>;
    try {
      entries = await this.fs.readDirectory(specsDir);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] specs dir unreadable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { tasks: [], excluded: [], specsDirExists: true };
    }

    const tasks: ScannedTask[] = [];
    const excluded: ExcludedTaskFolder[] = [];

    // Every task-folder name on disk, gathered BEFORE parsing so a `depends_on`
    // pointing at a folder later in the iteration order is not mistaken for a
    // dangling reference. This is the one caller with a view of the whole
    // directory, which is why the check lives here and not in a single-file
    // reparse.
    const folderNames = entries
      .filter((e) => e.type === FileType.Directory && !e.name.startsWith('.'))
      .map((e) => e.name);
    const knownFolders = new Set(folderNames);

    for (const folderName of folderNames) {
      await this.scanFolder(
        specsDir,
        folderName,
        tasks,
        excluded,
        knownFolders,
      );
    }

    return { tasks, excluded, specsDirExists: true };
  }

  private async scanFolder(
    specsDir: string,
    folderName: string,
    tasks: ScannedTask[],
    excluded: ExcludedTaskFolder[],
    knownFolders: ReadonlySet<string>,
  ): Promise<void> {
    const carrier = path.join(specsDir, folderName, CARRIER_FILE);
    let raw: string;
    try {
      if (!(await this.fs.exists(carrier))) {
        excluded.push({ folderName, reason: 'no_carrier' });
        return;
      }
      raw = await this.fs.readFile(carrier);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] folder unreadable', {
        folderName,
        error: error instanceof Error ? error.message : String(error),
      });
      excluded.push({ folderName, reason: 'unreadable' });
      return;
    }

    const result = parseTaskFile(folderName, raw, { knownFolders });
    if (result.kind === 'excluded') {
      excluded.push(result.excluded);
      return;
    }
    tasks.push({ ...result.task, body: result.body });
  }
}
