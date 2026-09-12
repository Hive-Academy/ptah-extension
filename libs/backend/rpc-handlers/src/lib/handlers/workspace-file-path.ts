import * as path from 'node:path';
import * as nodeFs from 'node:fs/promises';
import {
  FileType,
  isPathWithinRoots,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type { FileViewFailureReason } from '@ptah-extension/shared';

function normalize(value: string): string {
  const normalized = path
    .resolve(value)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function registeredRoot(
  requested: string,
  roots: readonly string[],
): string | undefined {
  const target = normalize(requested);
  return roots.find((root) => normalize(root) === target);
}

/** Resolve and verify a launch path against the registered workspace set. */
export async function resolveWorkspaceFilePath(
  request: { path: string; workspaceRoot?: string },
  roots: readonly string[],
  fileSystem: IFileSystemProvider,
): Promise<
  { success: true; path: string } | { success: false; error: string }
> {
  const explicitRoot = request.workspaceRoot
    ? registeredRoot(request.workspaceRoot, roots)
    : undefined;
  if (request.workspaceRoot && !explicitRoot) {
    return { success: false, error: 'Workspace root is not registered' };
  }
  if (!path.isAbsolute(request.path) && !explicitRoot) {
    return {
      success: false,
      error: 'A workspace root is required for a relative path',
    };
  }
  const resolved = path.resolve(explicitRoot ?? '', request.path);
  const authorizedRoots = explicitRoot ? [explicitRoot] : roots;
  if (!isPathWithinRoots(resolved, authorizedRoots)) {
    return { success: false, error: 'Path is outside the workspace' };
  }
  try {
    const stat = await fileSystem.stat(resolved);
    if ((stat.type & FileType.Directory) !== 0) {
      return { success: false, error: 'Path is a directory' };
    }
  } catch {
    return { success: false, error: 'File does not exist or is unreadable' };
  }
  return { success: true, path: resolved };
}

// ---------------------------------------------------------------------------
// Agent-authored linked paths (`file:viewContent`, `editor:openFile` scope
// `external-link`, VS Code `file:open`).
//
// `resolveWorkspaceFilePath` above answers "is this a launchable path in an
// open folder". It is LEXICAL ONLY and deliberately so (see
// `platform-core/src/utils/path-containment.ts`). A path that came out of
// agent-rendered markdown needs a stricter, ORDERED policy, because the caller
// is not the user: a junction or symlink planted inside an authorized root
// would otherwise read arbitrary bytes back into the renderer.
//
// The order below is part of the contract, not an implementation detail. Each
// step is a gate the next one relies on:
//
//   1. FORM, before any filesystem or git call, so a device/UNC/ADS string
//      never reaches `realpath` or `stat` at all.
//   2. BASE selection from caller hints, which are only ever hints.
//   3. LEXICAL resolution — `process.cwd()` is never consulted.
//   4. LEXICAL containment in the authorized root set.
//   5. REALPATH containment, re-checked AFTER resolution, which is what makes
//      a symlink escape fail closed.
//   6. STAT for kind and size.
// ---------------------------------------------------------------------------

/** Result of the pure, filesystem-free form gate. */
export type LinkedPathForm =
  | { ok: true }
  | { ok: false; reason: 'unsupported-path' };

const REJECTED_FORM: LinkedPathForm = { ok: false, reason: 'unsupported-path' };

/** True for a leading `\\` or `//` — UNC, `\\?\`, `\\.\` and `//server`. */
function isUncOrDeviceForm(value: string): boolean {
  return /^[\\/]{2}/.test(value);
}

/**
 * Reject a linked path on its SHAPE alone, before any `realpath` or `stat`.
 *
 * Refused, in order:
 *  - NUL and any other C0 control character, plus DEL. These truncate or
 *    confuse downstream path APIs.
 *  - A leading `\\` or `//`. That covers a UNC share (`\\server\share`), the
 *    extended-length prefix (`\\?\`) and the device namespace (`\\.\`).
 *    Opening an SMB path can leak an NTLM credential; a device path can hand
 *    back `\\.\PhysicalDrive0`.
 *  - On win32 only: a drive-RELATIVE path (`C:foo`, which resolves against
 *    that drive's hidden per-process cwd), a root-relative path (`\foo`,
 *    which resolves against the current drive), and any alternate data stream
 *    (`a.ts:stream`). A colon is legal on win32 in exactly one position —
 *    index 1, after a drive letter.
 *
 * Pure: no I/O, no `process.cwd()`. `platform` is a parameter so a spec can
 * exercise win32 rules on any host.
 */
export function checkLinkedPathForm(
  value: string,
  platform: NodeJS.Platform = process.platform,
): LinkedPathForm {
  if (typeof value !== 'string' || value.length === 0) return REJECTED_FORM;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return REJECTED_FORM;
  }

  if (isUncOrDeviceForm(value)) return REJECTED_FORM;

  if (platform === 'win32') {
    // Drive-relative: `C:foo` (no separator after the colon).
    if (/^[A-Za-z]:(?![\\/])/.test(value)) return REJECTED_FORM;
    // Root-relative: `\foo` / `/foo` — resolves against the current drive.
    if (/^[\\/]/.test(value)) return REJECTED_FORM;
    // A colon is allowed at index 1 only, and only after a drive letter.
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] !== ':') continue;
      const isDriveColon = i === 1 && /^[A-Za-z]$/.test(value[0] ?? '');
      if (!isDriveColon) return REJECTED_FORM;
    }
  }

  return { ok: true };
}

/** Where the authorized roots come from, and how to widen them lazily. */
export interface LinkedFileRootSource {
  /** Workspace folders the host currently has open. */
  readonly registered: readonly string[];
  /**
   * Worktrees of a registered root. Consulted LAZILY — only after lexical
   * containment misses — because it shells out to `git worktree list`.
   */
  listWorktrees(root: string): Promise<readonly string[]>;
  /**
   * Extra authorized roots for the external-link policy (home, temp). Never
   * used by the in-app viewer.
   */
  readonly extra?: readonly string[];
}

/** The `realpath` + `stat` surface this resolver needs. Injectable for specs. */
export interface LinkedPathFsApi {
  realpath(target: string): Promise<string>;
  stat(target: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
  }>;
}

export interface LinkedFileResolveOptions {
  /** Size ceiling in bytes. Omit or pass `Infinity` for no cap. */
  readonly maxBytes?: number;
  /** Resolve a directory to `kind: 'directory'` instead of `not-a-file`. */
  readonly allowDirectory?: boolean;
  readonly platform?: NodeJS.Platform;
  /** Overridable for specs; defaults to `node:fs/promises`. */
  readonly fs?: LinkedPathFsApi;
}

export interface LinkedFileRequest {
  readonly path: string;
  readonly workspaceRoot?: string;
  readonly documentPath?: string;
}

export type LinkedFileResolution =
  | {
      kind: 'file';
      lexicalPath: string;
      realPath: string;
      root: string;
      sizeBytes: number;
    }
  | { kind: 'directory'; lexicalPath: string; realPath: string; root: string }
  | {
      kind: 'rejected';
      reason: FileViewFailureReason;
      /**
       * Present ONLY when disclosing it is safe: the path was lexically
       * authorized and merely too large / binary / outside the root set. A
       * realpath escape omits it, so the escaped target is never disclosed
       * and never offered for external open.
       */
      lexicalPath?: string;
      sizeBytes?: number;
    };

const DEFAULT_FS: LinkedPathFsApi = {
  realpath: (target) => nodeFs.realpath(target),
  stat: (target) => nodeFs.stat(target),
};

function rejected(
  reason: FileViewFailureReason,
  extra?: { lexicalPath?: string; sizeBytes?: number },
): LinkedFileResolution {
  return { kind: 'rejected', reason, ...extra };
}

/** Longest matching root, so a worktree nested in a registered root wins. */
function matchRoot(
  candidate: string,
  roots: readonly string[],
  platform: NodeJS.Platform,
): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (!root) continue;
    if (!isPathWithinRoots(candidate, [root], platform)) continue;
    if (best === undefined || root.length > best.length) best = root;
  }
  return best;
}

/** Map an `ENOENT`-style failure onto the wire vocabulary. */
function realpathFailureReason(error: unknown): FileViewFailureReason {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not-found';
  return 'unreadable';
}

async function realpathAll(
  roots: readonly string[],
  fs: LinkedPathFsApi,
): Promise<string[]> {
  const resolved = await Promise.all(
    roots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        // degradation-audit: optional-capability - a root that cannot be
        // realpath'd (deleted, permission-denied, offline drive) is DROPPED
        // rather than treated as authorizing anything. Fail-closed: it can
        // only ever shrink the authorized set.
        return undefined;
      }
    }),
  );
  return resolved.filter((value): value is string => value !== undefined);
}

/**
 * Resolve an agent-authored link to a concrete file inside an authorized root.
 *
 * See the block comment above for why the step order is contractual.
 */
export async function resolveLinkedFilePath(
  request: LinkedFileRequest,
  roots: LinkedFileRootSource,
  options: LinkedFileResolveOptions = {},
): Promise<LinkedFileResolution> {
  const platform = options.platform ?? process.platform;
  const fs = options.fs ?? DEFAULT_FS;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;

  // --- 1. Form gate, before ANY filesystem or git call ---------------------
  for (const value of [
    request.path,
    request.workspaceRoot,
    request.documentPath,
  ]) {
    if (value === undefined) continue;
    if (!checkLinkedPathForm(value, platform).ok) {
      return rejected('unsupported-path');
    }
  }

  const registered = roots.registered.filter((root) => !!root);
  const extra = (roots.extra ?? []).filter((root) => !!root);

  // Authorized root set, widened lazily and at most once.
  const authorized: string[] = [...registered, ...extra];
  let worktreesLoaded = false;
  const loadWorktrees = async (): Promise<void> => {
    if (worktreesLoaded) return;
    worktreesLoaded = true;
    const lists = await Promise.all(
      registered.map(async (root) => {
        try {
          return await roots.listWorktrees(root);
        } catch {
          // degradation-audit: optional-capability - worktree discovery is an
          // enrichment of the authorized set; [] leaves the lexical verdict
          // unchanged rather than widening it on a failed git call.
          return [] as readonly string[];
        }
      }),
    );
    for (const list of lists) {
      for (const worktree of list) {
        if (worktree && !authorized.includes(worktree))
          authorized.push(worktree);
      }
    }
  };

  const isAuthorizedHint = async (hint: string): Promise<boolean> => {
    if (isPathWithinRoots(hint, authorized, platform)) return true;
    await loadWorktrees();
    return isPathWithinRoots(hint, authorized, platform);
  };

  // --- 2. Base selection. A hint is only ever a hint. -----------------------
  let base: string | undefined;
  if (request.documentPath !== undefined) {
    if (!(await isAuthorizedHint(request.documentPath))) {
      return rejected('root-not-open');
    }
    base = path.dirname(request.documentPath);
  } else if (request.workspaceRoot !== undefined) {
    if (!(await isAuthorizedHint(request.workspaceRoot))) {
      return rejected('root-not-open');
    }
    base = request.workspaceRoot;
  }

  // --- 3. Lexical resolution. `process.cwd()` is never consulted. -----------
  const isAbsolute = path.isAbsolute(request.path);
  if (!isAbsolute && base === undefined) return rejected('no-base-root');
  const lexical = isAbsolute
    ? path.resolve(request.path)
    : path.resolve(base as string, request.path);

  // --- 4. Lexical containment, widening to worktrees only on a miss --------
  let root = matchRoot(lexical, authorized, platform);
  if (root === undefined) {
    await loadWorktrees();
    root = matchRoot(lexical, authorized, platform);
  }
  if (root === undefined) {
    return rejected('outside-roots', { lexicalPath: lexical });
  }

  // --- 5. Realpath containment, re-checked AFTER resolution ----------------
  let realTarget: string;
  try {
    realTarget = await fs.realpath(lexical);
  } catch (error: unknown) {
    return rejected(realpathFailureReason(error));
  }

  // A junction pointing at a share escapes to UNC even though the lexical
  // form was clean, so the form rule is re-applied to the RESOLVED target.
  if (isUncOrDeviceForm(realTarget)) return rejected('outside-roots');

  const realRoots = await realpathAll(authorized, fs);
  const realRoot = matchRoot(realTarget, realRoots, platform);
  if (realRoot === undefined) {
    // No `lexicalPath`: a symlink escape must not be offered for external
    // open, and the escaped target must not be disclosed.
    return rejected('outside-roots');
  }

  // --- 6. Kind and size ----------------------------------------------------
  let stat: Awaited<ReturnType<LinkedPathFsApi['stat']>>;
  try {
    stat = await fs.stat(realTarget);
  } catch (error: unknown) {
    return rejected(realpathFailureReason(error));
  }

  if (stat.isDirectory()) {
    return options.allowDirectory
      ? { kind: 'directory', lexicalPath: lexical, realPath: realTarget, root }
      : rejected('not-a-file');
  }
  // FIFOs, sockets and character devices are not files. Reading one can block
  // the main process forever.
  if (!stat.isFile()) return rejected('not-a-file');

  if (stat.size > maxBytes) {
    return rejected('too-large', {
      lexicalPath: lexical,
      sizeBytes: stat.size,
    });
  }

  return {
    kind: 'file',
    lexicalPath: lexical,
    realPath: realTarget,
    root,
    sizeBytes: stat.size,
  };
}
