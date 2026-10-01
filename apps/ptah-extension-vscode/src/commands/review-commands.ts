/**
 * Review Commands — open VS Code's own changes, diff, merge and Source Control
 * views for the files an agent turn changed (TASK_2026_576, Requirement 5).
 *
 * The webview reaches these through `command:execute` with
 * `args: [{ workspaceRoot, files | path }]`; the existing `ptah.` prefix in that
 * allowlist already admits them. The commands are hidden from the palette.
 *
 * Every argument is untrusted: `workspaceRoot` must be one of the open
 * workspace folders and every path must stay inside it, after symlinks are
 * resolved. A refusal throws `Error('Path is outside the workspace.')` so
 * `command:execute` reports the failure; no absolute path is ever put in an
 * error message.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { isPathWithinRoots } from '@ptah-extension/platform-core';
import type { TurnChangeSetFileStatus } from '@ptah-extension/shared';
import { toGitHeadUri } from './ptah-git-head-content-provider';

/** Upper bound on files per command call, matching the stored change-set bound. */
export const MAX_REVIEW_FILES = 500;

export const OUTSIDE_WORKSPACE_MESSAGE = 'Path is outside the workspace.';
const INVALID_ARGS_MESSAGE = 'Invalid review command arguments.';

const MAX_PATH_LENGTH = 4096;
const pathSchema = z.string().min(1).max(MAX_PATH_LENGTH);
const statusSchema = z.enum(['A', 'M', 'D', 'R', 'U']);

const fileSchema = z.object({
  path: pathSchema,
  origPath: pathSchema.optional(),
  status: statusSchema,
});

const changesArgsSchema = z.object({
  workspaceRoot: pathSchema,
  files: z.array(fileSchema).min(1).max(MAX_REVIEW_FILES),
});

const fileArgsSchema = z.object({
  workspaceRoot: pathSchema,
  path: pathSchema,
  origPath: pathSchema.optional(),
  status: statusSchema.optional(),
});

/** `ptah.review.openChanges` argument. */
export type ReviewChangesArgs = z.infer<typeof changesArgsSchema>;
/** `ptah.review.openDiff` / `ptah.review.openMerge` argument. */
export type ReviewFileArgs = z.infer<typeof fileArgsSchema>;

/** One validated file: the URIs the native editors receive. */
interface ReviewEntry {
  /** Workspace-relative, forward slashes. */
  relativePath: string;
  /** Identifies the row in the changes editor. */
  label: vscode.Uri;
  /** HEAD side; `undefined` for an added file. */
  left: vscode.Uri | undefined;
  /** Working-tree side; `undefined` for a deleted file. */
  right: vscode.Uri | undefined;
}

interface ValidatedRoot {
  folder: vscode.WorkspaceFolder;
  /** Lexical root, as the workspace folder reports it. */
  root: string;
  /** Symlink-resolved root, for the post-resolution containment check. */
  realRoot: string;
}

export class ReviewCommands {
  constructor(private readonly logger: Logger) {}

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('ptah.review.openChanges', (args) =>
        this.openChanges(args),
      ),
      vscode.commands.registerCommand('ptah.review.openDiff', (args) =>
        this.openDiff(args),
      ),
      vscode.commands.registerCommand('ptah.review.openMerge', (args) =>
        this.openMerge(args),
      ),
      vscode.commands.registerCommand('ptah.review.openScm', () =>
        this.openScm(),
      ),
    );
  }

  /**
   * One multi-file changes editor. When `vscode.changes` is unavailable or
   * rejects, each file opens in its own diff (or single) editor, in order.
   */
  async openChanges(rawArgs: unknown): Promise<void> {
    const args = parseArgs(changesArgsSchema, rawArgs);
    const root = await this.validateRoot(args.workspaceRoot);
    const entries: ReviewEntry[] = [];
    for (const file of args.files) {
      entries.push(await this.toEntry(root, file));
    }

    const count = entries.length;
    const title = `Agent changes (${count} ${count === 1 ? 'file' : 'files'})`;
    try {
      await vscode.commands.executeCommand(
        'vscode.changes',
        title,
        entries.map((e) => [e.label, e.left, e.right]),
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[ReviewCommands] vscode.changes failed; opening per-file diffs',
        { error: error instanceof Error ? error.message : String(error) },
      );
      for (const entry of entries) {
        await this.openEntry(entry, false);
      }
    }
  }

  /** One file against HEAD; `status` defaults to modified. */
  async openDiff(rawArgs: unknown): Promise<void> {
    const args = parseArgs(fileArgsSchema, rawArgs);
    const root = await this.validateRoot(args.workspaceRoot);
    const entry = await this.toEntry(root, {
      path: args.path,
      origPath: args.origPath,
      status: args.status ?? 'M',
    });
    await this.openEntry(entry, true);
  }

  /**
   * The git extension's 3-way merge editor; a plain editor when the git
   * extension is missing or the command fails.
   */
  async openMerge(rawArgs: unknown): Promise<void> {
    const args = parseArgs(fileArgsSchema, rawArgs);
    const root = await this.validateRoot(args.workspaceRoot);
    const { absolutePath } = await this.containedPath(root, args.path);
    const uri = vscode.Uri.file(absolutePath);

    if (vscode.extensions.getExtension('vscode.git')) {
      try {
        await vscode.commands.executeCommand('git.openMergeEditor', uri);
        return;
      } catch (error: unknown) {
        this.logger.warn(
          '[ReviewCommands] git.openMergeEditor failed; opening the file',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  async openScm(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.scm');
  }

  private async openEntry(entry: ReviewEntry, preview: boolean): Promise<void> {
    if (entry.left && entry.right) {
      await vscode.commands.executeCommand(
        'vscode.diff',
        entry.left,
        entry.right,
        `${path.posix.basename(entry.relativePath)} (HEAD ↔ Working Tree)`,
        { preview },
      );
      return;
    }
    // `vscode.diff` needs two URIs: an added or deleted file opens its one side.
    await vscode.commands.executeCommand(
      'vscode.open',
      entry.left ?? entry.right,
      { preview },
    );
  }

  private async toEntry(
    root: ValidatedRoot,
    file: { path: string; origPath?: string; status: TurnChangeSetFileStatus },
  ): Promise<ReviewEntry> {
    const target = await this.containedPath(root, file.path);
    const original =
      file.status === 'R' && file.origPath
        ? await this.containedPath(root, file.origPath)
        : target;
    const index = root.folder.index;
    const workingTree = vscode.Uri.file(target.absolutePath);
    return {
      relativePath: target.relativePath,
      label: workingTree,
      left:
        file.status === 'A'
          ? undefined
          : toGitHeadUri(original.relativePath, index),
      right: file.status === 'D' ? undefined : workingTree,
    };
  }

  /** `workspaceRoot` must be one of the open workspace folders. */
  private async validateRoot(workspaceRoot: string): Promise<ValidatedRoot> {
    if (!path.isAbsolute(workspaceRoot)) {
      throw new Error(OUTSIDE_WORKSPACE_MESSAGE);
    }
    const requested = await realOrNull(workspaceRoot);
    if (requested === null) throw new Error(OUTSIDE_WORKSPACE_MESSAGE);

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      const realRoot =
        (await realOrNull(folder.uri.fsPath)) ?? folder.uri.fsPath;
      if (samePath(requested, realRoot)) {
        return { folder, root: folder.uri.fsPath, realRoot };
      }
    }
    throw new Error(OUTSIDE_WORKSPACE_MESSAGE);
  }

  /**
   * Resolves a workspace-relative (or absolute) path and proves it stays in
   * the root, first lexically and then after symlink resolution of the
   * nearest existing ancestor (a deleted file has no inode of its own).
   */
  private async containedPath(
    root: ValidatedRoot,
    candidate: string,
  ): Promise<{ absolutePath: string; relativePath: string }> {
    if (candidate.includes('\0')) throw new Error(OUTSIDE_WORKSPACE_MESSAGE);
    const absolutePath = path.resolve(root.root, candidate);
    if (
      !isPathWithinRoots(absolutePath, [root.root]) ||
      samePath(absolutePath, root.root)
    ) {
      throw new Error(OUTSIDE_WORKSPACE_MESSAGE);
    }

    const realTarget = await realNearestAncestor(absolutePath, root.root);
    if (realTarget === null || !isPathWithinRoots(realTarget, [root.realRoot])) {
      throw new Error(OUTSIDE_WORKSPACE_MESSAGE);
    }

    return {
      absolutePath,
      relativePath: path
        .relative(root.root, absolutePath)
        .split(path.sep)
        .join('/'),
    };
  }
}

function parseArgs<S extends z.ZodType>(
  schema: S,
  rawArgs: unknown,
): z.output<S> {
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) throw new Error(INVALID_ARGS_MESSAGE);
  return parsed.data;
}

/** Equality under the same normalization as `isPathWithinRoots`. */
function samePath(a: string, b: string): boolean {
  return isPathWithinRoots(a, [b]) && isPathWithinRoots(b, [a]);
}

/**
 * The real path of `p`, or null when it does not exist. Any other failure
 * (permissions, a symlink loop) refuses the request: containment cannot be
 * proven, and the sanitized message keeps the path out of the error.
 */
async function realOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new Error(OUTSIDE_WORKSPACE_MESSAGE);
  }
}

/**
 * The real path of `target`, or of its nearest existing ancestor when it does
 * not exist (yet or any more). Stops at `root`: nothing above it is relevant.
 */
async function realNearestAncestor(
  target: string,
  root: string,
): Promise<string | null> {
  let current = target;
  for (;;) {
    const real = await realOrNull(current);
    if (real !== null) return real;
    const parent = path.dirname(current);
    if (parent === current || samePath(current, root)) return null;
    current = parent;
  }
}
