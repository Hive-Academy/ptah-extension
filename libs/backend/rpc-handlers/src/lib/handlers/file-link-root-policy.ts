/**
 * FileLinkRootPolicy — the POLICY half of agent-authored link resolution.
 *
 * `workspace-file-path.ts` owns the MECHANISM (form gate, base selection,
 * lexical containment, realpath re-check, stat). This class owns the answer to
 * "which roots are authorized, for which caller, and at what size" — the part
 * that needs workspace state and git.
 *
 * Two policies, and the difference between them is the whole point:
 *
 *  - {@link resolveForView} authorizes the OPEN WORKSPACE FOLDERS and their
 *    worktrees only, capped at {@link FILE_VIEW_MAX_BYTES}. Its bytes are
 *    returned to the renderer, so nothing outside a folder the user opened
 *    may pass.
 *  - {@link resolveForExternalOpen} additionally authorizes the user's home
 *    and temp directories, uncapped, because nothing is read here — the path
 *    is handed to the user's own editor process as argv. Agent references out
 *    of root are predominantly `~/.claude/...`, `~/.ptah/...` and scratch
 *    files, and this is what makes them openable.
 *
 * The home/temp widening is exactly where a prompt-injected link becomes
 * dangerous, so it is subtracted again by {@link CREDENTIAL_DENY_LIST}. An
 * external editor is frequently AI-enabled: opening `~/.ssh/id_ed25519` in one
 * can ship the key into a model context. The deny-list is checked on BOTH the
 * lexical and the real path, so a symlink named `notes.md` that resolves into
 * `.ssh` is refused too.
 *
 * The deny-list deliberately does NOT apply to registered workspace roots. A
 * `.env` inside a repository the user opened is ordinary project content, and
 * refusing to open it in their editor would break a normal workflow while
 * protecting nothing — the agent can already read it there.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeFs from 'node:fs/promises';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type GitInfoService } from '@ptah-extension/vscode-core';
import { FILE_VIEW_MAX_BYTES } from '@ptah-extension/shared';

import {
  resolveLinkedFilePath,
  type LinkedFileRequest,
  type LinkedFileResolution,
} from './workspace-file-path';

/**
 * Credential locations that are never handed to an external editor.
 *
 * Not configurable from the renderer, by design: the renderer is the side an
 * injected link arrives on, so letting it widen or narrow this list would
 * defeat it. Entries use forward slashes and are matched case-insensitively
 * on win32.
 */
export const CREDENTIAL_DENY_LIST = {
  /** Segment runs. Anything AT or BELOW one of these is refused. */
  directories: [
    '.ssh',
    '.gnupg',
    '.aws',
    '.azure',
    '.kube',
    '.docker',
    '.config/gcloud',
    '.config/gh',
    '.config/git',
    'AppData/Roaming/Microsoft/Credentials',
    'AppData/Local/Microsoft/Credentials',
    'AppData/Roaming/Microsoft/Protect',
  ],
  /** Segment runs matched against the TAIL of the path. */
  files: [
    '.netrc',
    '_netrc',
    '.git-credentials',
    '.npmrc',
    '.pypirc',
    '.pgpass',
    '.claude/.credentials.json',
    '.codex/auth.json',
    // Ptah's own secret-envelope store — `~/.ptah/secrets.enc.json`, written by
    // `libs/backend/settings-core/src/encryption/secrets-file-store.ts`.
    '.ptah/secrets.enc.json',
  ],
  /** Basename patterns: private keys, certificates and dotenv files. */
  basenames: [
    /^id_rsa/i,
    /^id_ed25519/i,
    /^id_ecdsa/i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    /^\.env$/i,
    /^\.env\./i,
  ],
} as const;

function segmentsOf(value: string, platform: NodeJS.Platform): string[] {
  const normalized = value.replace(/\\/g, '/');
  const cased = platform === 'win32' ? normalized.toLowerCase() : normalized;
  return cased.split('/').filter((segment) => segment.length > 0);
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function endsWithRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const offset = haystack.length - needle.length;
  return needle.every((segment, i) => haystack[offset + i] === segment);
}

/** Whether a path names, or lives under, a known credential location. */
export function isCredentialPath(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const segments = segmentsOf(candidate, platform);
  if (segments.length === 0) return false;

  for (const entry of CREDENTIAL_DENY_LIST.directories) {
    if (containsRun(segments, segmentsOf(entry, platform))) return true;
  }
  for (const entry of CREDENTIAL_DENY_LIST.files) {
    if (endsWithRun(segments, segmentsOf(entry, platform))) return true;
  }

  // The basename is compared in its ORIGINAL case on non-win32; the patterns
  // carry `/i` themselves, so `.PEM` is caught on every platform.
  const basename = path.basename(candidate.replace(/\\/g, '/'));
  return CREDENTIAL_DENY_LIST.basenames.some((pattern) =>
    pattern.test(basename),
  );
}

@injectable()
export class FileLinkRootPolicy {
  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.GIT_INFO_SERVICE)
    private readonly gitInfo: GitInfoService,
  ) {}

  /**
   * Roots for the in-app viewer: open folders and their worktrees only.
   *
   * `maxBytes` and `allowDirectory` are overridable because the VS Code
   * `file:open` handler reuses this policy to resolve a RELATIVE path it will
   * reveal rather than read — there the size cap is meaningless and a
   * directory is a legitimate target.
   */
  async resolveForView(
    request: LinkedFileRequest,
    options: { maxBytes?: number; allowDirectory?: boolean } = {},
  ): Promise<LinkedFileResolution> {
    return resolveLinkedFilePath(
      request,
      {
        registered: this.workspace.getWorkspaceFolders(),
        listWorktrees: (root) => this.listWorktrees(root),
      },
      {
        maxBytes: options.maxBytes ?? FILE_VIEW_MAX_BYTES,
        allowDirectory: options.allowDirectory ?? false,
      },
    );
  }

  /**
   * Roots for handing a path to the user's own editor: the view roots plus
   * home and temp, minus {@link CREDENTIAL_DENY_LIST}. No size cap — nothing
   * is read.
   */
  async resolveForExternalOpen(
    request: LinkedFileRequest,
    options: { allowDirectory?: boolean } = {},
  ): Promise<LinkedFileResolution> {
    const registered = this.workspace.getWorkspaceFolders();
    const extra = await this.homeAndTempRoots();

    const resolution = await resolveLinkedFilePath(
      request,
      {
        registered,
        listWorktrees: (root) => this.listWorktrees(root),
        extra,
      },
      { allowDirectory: options.allowDirectory ?? false },
    );

    if (resolution.kind === 'rejected') return resolution;

    // The deny-list guards the WIDENING only. A path that matched a registered
    // workspace root is project content and stays openable.
    const widened = extra.some((root) => root === resolution.root);
    if (!widened) return resolution;

    if (
      isCredentialPath(resolution.lexicalPath) ||
      isCredentialPath(resolution.realPath)
    ) {
      // No `lexicalPath`, so the caller reports `externalOpenAllowed: false`
      // and no Open In affordance is ever offered for a credential.
      return { kind: 'rejected', reason: 'outside-roots' };
    }

    return resolution;
  }

  /**
   * Worktree checkout paths for a registered root.
   *
   * UNC-form entries are dropped: `git worktree list` can legitimately report
   * a checkout on a network share, and authorizing one would reintroduce
   * exactly the SMB path the form gate refuses.
   */
  private async listWorktrees(root: string): Promise<readonly string[]> {
    const worktrees = await this.gitInfo.getWorktrees(root);
    return worktrees
      .map((worktree) => worktree.path)
      .filter((value) => !!value && !/^[\\/]{2}/.test(value));
  }

  /**
   * Home and temp, REALPATH'd.
   *
   * `os.tmpdir()` is a symlink on macOS (`/var` -> `/private/var`), so the
   * lexical form would never match the resolved target of anything inside it.
   * A root that cannot be resolved is dropped rather than used lexically —
   * fail-closed, it can only shrink the authorized set.
   */
  private async homeAndTempRoots(): Promise<string[]> {
    const candidates = [os.homedir(), os.tmpdir()];
    const resolved = await Promise.all(
      candidates.map(async (candidate) => {
        if (!candidate) return undefined;
        try {
          return await nodeFs.realpath(candidate);
        } catch {
          // degradation-audit: optional-capability - widening the authorized
          // set is the optional step; dropping an unresolvable root refuses
          // more, never less.
          return undefined;
        }
      }),
    );
    return resolved.filter((value): value is string => value !== undefined);
  }
}
