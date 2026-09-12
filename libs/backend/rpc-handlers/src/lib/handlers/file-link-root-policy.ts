/**
 * FileLinkRootPolicy — the POLICY half of agent-authored link resolution.
 *
 * `workspace-file-path.ts` owns the MECHANISM (form gate, base selection,
 * lexical containment, realpath re-check, stat). This class owns the answer to
 * "which roots are authorized, for which caller, and at what size" — the part
 * that needs workspace state and git.
 *
 * Three policies, and the difference between them is the whole point:
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
 *  - {@link resolveForHostReveal} authorizes NO root set at all — see its own
 *    comment. It exists for the host's own editor, which confirms rather than
 *    refuses, and it too returns no bytes.
 *
 * Widening past the registered roots is exactly where a prompt-injected link
 * becomes dangerous, so it is subtracted again by {@link CREDENTIAL_DENY_LIST}.
 * An external editor is frequently AI-enabled: opening `~/.ssh/id_ed25519` in
 * one can ship the key into a model context.
 *
 * The deny-list is keyed on the REAL path's containment, never on which
 * LEXICAL root happened to match. A path whose realpath stays inside a
 * registered workspace root (or one of its worktrees) is project content and
 * is exempt; anything else is deny-listed on BOTH its lexical and its real
 * form. Lexical keying was the original rule and it was wrong: a symlink
 * `notes.md` planted inside a registered root realpaths into `~/.ssh`, matched
 * the registered root lexically, and skipped the deny-list entirely.
 *
 * The registered-root exemption itself is deliberate and stays. A `.env`
 * inside a repository the user opened is ordinary project content, and
 * refusing to open it in their editor would break a normal workflow while
 * protecting nothing — the agent can already read it there.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeFs from 'node:fs/promises';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type GitInfoService } from '@ptah-extension/vscode-core';
import { FILE_VIEW_MAX_BYTES } from '@ptah-extension/shared';

import {
  checkLinkedPathForm,
  realpathFailureReason,
  resolveLinkedFilePath,
  type LinkedFileRequest,
  type LinkedFileResolution,
} from './workspace-file-path';

/**
 * Credential locations that are never handed to an external editor.
 *
 * Not configurable from the renderer, by design: the renderer is the side an
 * injected link arrives on, so letting it widen or narrow this list would
 * defeat it. Entries use forward slashes and are matched case-insensitively on
 * the case-folding platforms — see {@link foldsCase}.
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
  /**
   * The separator class that makes a renamed copy of a deny-listed segment
   * match the segment it was copied from.
   *
   * Exact-segment matching alone is trivially evaded by a rename that every
   * backup script performs: `~/.aws.bak/credentials`, `~/.ssh-old/id_rsa`,
   * `~/.claude.bak/.credentials.json` and `~/.config/gh.bak/hosts.yml` hold
   * the same secrets as the location they were copied from and matched
   * nothing. Rather than a second list that has to be kept in step with the
   * first, this suffix rule is applied to EVERY segment of EVERY run in
   * {@link CREDENTIAL_DENY_LIST.directories} and
   * {@link CREDENTIAL_DENY_LIST.files} — so the multi-segment entries
   * (`.config/gh`, `.claude/.credentials.json`, the `AppData/...` runs) are
   * covered by exactly the same rule as `.ssh`.
   *
   * The separator class is what keeps it narrow. A deny-listed segment is a
   * PREFIX only when the next character is `.`, `-` or `_`: `.dockerignore`
   * and `.sshrc` are ordinary repository files and are NOT caught, and a name
   * without the leading dot (`awsome`, `sshd-config`) never resembles one of
   * these entries in the first place.
   *
   * The other half of keeping it narrow is WHERE it applies. For a
   * {@link CREDENTIAL_DENY_LIST.directories} run it is an ANCESTOR-only rule —
   * see {@link containsDirectoryRun}, and `.docker-compose.yml` for why. For a
   * {@link CREDENTIAL_DENY_LIST.files} run the leaf IS the file, so the rule
   * applies there and `~/.npmrc.bak` is caught.
   *
   * It does NOT widen a directory that the list only names via a FILE entry.
   * `.claude` is deny-listed as `.claude/.credentials.json`, not as a
   * directory, so `~/.claude/settings.json` and `~/.ptah/user/...` — the agent
   * references `resolveForExternalOpen` exists to make openable — still open.
   */
  renameSuffixes: ['.', '-', '_'],
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
  /**
   * Basename patterns: private keys, certificates, dotenv files, and the
   * credential files that a renamed parent directory would otherwise expose.
   *
   * `credentials`, `known_hosts` and `authorized_keys` are named the same
   * wherever the directory around them is moved, so they close the
   * `~/.aws.bak/credentials` class from the file side as well as the
   * directory side. The optional leading dot is what makes the agent
   * credential store's own name, `.credentials.json`, one of them. The
   * trailing `(\.|$)` anchors the STEM, so
   * `credentials.json` and `credentials.db` are caught while `credentials-ui`
   * or `aws-credentials-doc` are not. Source files named `credentials.ts` are
   * a tolerated false positive OUTSIDE the registered roots only — inside a
   * workspace the user opened, the registered-root exemption already applies
   * and the deny-list is never consulted.
   */
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
    /^\.?credentials(\.|$)/i,
    /^known_hosts(\.|$)/i,
    /^authorized_keys(\.|$)/i,
  ],
} as const;

/**
 * Whether this platform's default filesystem folds case in path lookups.
 *
 * win32 and darwin both do — APFS and HFS+ ship case-INSENSITIVE and
 * case-preserving, so `~/.AWS/config` and `~/.aws/config` are the SAME file on
 * a stock Mac and a comparison that distinguishes them is a deny-list bypass,
 * not a nicety. linux is genuinely case-sensitive: `.SSH` there is a different
 * directory, and folding it would refuse files that are not credentials.
 *
 * darwin CAN be formatted case-sensitive (APFS-CS), which makes this fold
 * conservative on such a machine — it refuses a little more than it must. That
 * is the correct direction for a deny-list to be wrong in.
 */
function foldsCase(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

function segmentsOf(value: string, platform: NodeJS.Platform): string[] {
  const normalized = value.replace(/\\/g, '/');
  const cased = foldsCase(platform) ? normalized.toLowerCase() : normalized;
  return cased.split('/').filter((segment) => segment.length > 0);
}

/**
 * Whether one path segment IS a deny-listed segment, or a renamed copy of it.
 *
 * `.ssh` matches `.ssh`, `.ssh.bak`, `.ssh-old` and `.ssh_backup`; it does NOT
 * match `.sshrc`, because `r` is not one of {@link
 * CREDENTIAL_DENY_LIST.renameSuffixes}. Comparison is on the already-cased
 * segment, so this stays case-insensitive wherever {@link foldsCase} holds
 * (win32, darwin) and case-SENSITIVE on linux, where `.SSH` is a genuinely
 * different directory.
 */
function segmentMatches(segment: string, entry: string): boolean {
  if (segment === entry) return true;
  if (!segment.startsWith(entry)) return false;
  return CREDENTIAL_DENY_LIST.renameSuffixes.some(
    (suffix) => segment[entry.length] === suffix,
  );
}

function runMatchesAt(
  haystack: string[],
  needle: string[],
  start: number,
  /**
   * When true, the FINAL segment of the run must match exactly rather than by
   * the rename rule. See {@link containsDirectoryRun}.
   */
  exactFinalSegment = false,
): boolean {
  return needle.every((entry, i) =>
    exactFinalSegment && i === needle.length - 1
      ? haystack[start + i] === entry
      : segmentMatches(haystack[start + i], entry),
  );
}

/**
 * Whether a {@link CREDENTIAL_DENY_LIST.directories} run appears in the path.
 *
 * The rename rule applies freely to ANCESTOR segments, because a segment with
 * something after it is unambiguously a directory: `~/.docker-old/config.json`
 * is the renamed credential directory the rule exists to catch.
 *
 * The LEAF segment is different — it is usually a FILE, and nothing in a path
 * string says which. Allowing the rename rule there refused
 * `~/.docker-compose.yml` as if it were a credential directory, because
 * `.docker` is followed by `-`. So the leaf may satisfy a directory run only by
 * EXACT equality, which still refuses the case that matters: revealing the
 * deny-listed directory itself, `~/.ssh` or `~/.config/gh`.
 *
 * What that trades away is revealing a RENAMED credential directory as a
 * directory — `~/.ssh.bak` itself. Every path INSIDE it is still refused by the
 * ancestor rule, and revealing a directory discloses no bytes, so this is the
 * cheap half of the pair to give up in exchange for not refusing ordinary
 * dot-files.
 */
function containsDirectoryRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const leaf = haystack.length - 1;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    const endsAtLeaf = start + needle.length - 1 === leaf;
    if (runMatchesAt(haystack, needle, start, endsAtLeaf)) return true;
  }
  return false;
}

function endsWithRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return runMatchesAt(haystack, needle, haystack.length - needle.length);
}

/** Whether a path names, or lives under, a known credential location. */
export function isCredentialPath(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const segments = segmentsOf(candidate, platform);
  if (segments.length === 0) return false;

  for (const entry of CREDENTIAL_DENY_LIST.directories) {
    if (containsDirectoryRun(segments, segmentsOf(entry, platform)))
      return true;
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

    // The deny-list guards everything the registered roots do not cover, and
    // the test is on the REAL path. `resolution.root` is the LEXICAL match, so
    // keying on it let a symlink inside a registered root realpath into
    // `~/.ssh` and skip the deny-list entirely.
    if (await this.isInsideRegisteredRoots(resolution.realPath)) {
      return resolution;
    }

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
   * Resolve an ARBITRARY absolute path for the HOST's own editor to reveal.
   *
   * This is the one caller that must not refuse an out-of-root path. VS Code
   * `file:open` already opens a link into an unregistered sibling repository
   * today, and TASK_2026_413 Decision 3 keeps it working: the user is shown
   * the absolute path in a modal and decides. Refusing here would regress that
   * to an error message, which is why `resolveForExternalOpen` is NOT widened
   * instead — the in-app viewer and the Electron external-open path must keep
   * their current, narrower root sets.
   *
   * It NEVER returns bytes. The resolution is handed to `vscode.window`, which
   * reveals the path in the host's own editor; nothing is read here and
   * nothing crosses the RPC boundary but `success`.
   *
   * The gates that DO still apply, in this order:
   *  1. form, on the requested string and again on the resolved target, so a
   *     UNC share, a device path, a drive-relative or root-relative path or an
   *     alternate data stream never reaches `stat`;
   *  2. `realpath`, so the decision is made about the real target;
   *  3. the credential deny-list, on both the lexical and the real form;
   *  4. regular file or directory — a FIFO, socket or character device is not
   *     something to reveal.
   *
   * Relative paths are rejected outright (`no-base-root`). They belong to
   * {@link resolveForView} and its checked roots; resolving one here would
   * silently reintroduce `process.cwd()`.
   */
  async resolveForHostReveal(
    requested: string,
    options: { allowDirectory?: boolean } = {},
  ): Promise<LinkedFileResolution> {
    if (!checkLinkedPathForm(requested).ok) {
      return { kind: 'rejected', reason: 'unsupported-path' };
    }
    if (!path.isAbsolute(requested)) {
      return { kind: 'rejected', reason: 'no-base-root' };
    }

    const lexical = path.resolve(requested);

    let realPath: string;
    try {
      realPath = await nodeFs.realpath(lexical);
    } catch (error: unknown) {
      return { kind: 'rejected', reason: realpathFailureReason(error) };
    }

    // A junction can escape to a UNC share even when the lexical form was
    // clean, so the same form rule is re-applied to the RESOLVED target.
    if (!checkLinkedPathForm(realPath).ok) {
      return { kind: 'rejected', reason: 'unsupported-path' };
    }

    if (isCredentialPath(lexical) || isCredentialPath(realPath)) {
      // No `lexicalPath`: a credential is refused outright and never reaches
      // the confirmation modal.
      return { kind: 'rejected', reason: 'outside-roots' };
    }

    let stat: Awaited<ReturnType<typeof nodeFs.stat>>;
    try {
      stat = await nodeFs.stat(realPath);
    } catch (error: unknown) {
      return { kind: 'rejected', reason: realpathFailureReason(error) };
    }

    if (stat.isDirectory()) {
      return options.allowDirectory
        ? { kind: 'directory', lexicalPath: lexical, realPath, root: lexical }
        : { kind: 'rejected', reason: 'not-a-file' };
    }
    if (!stat.isFile()) return { kind: 'rejected', reason: 'not-a-file' };

    return {
      kind: 'file',
      lexicalPath: lexical,
      realPath,
      // No root authorized this path — the confirmation did. Reporting the
      // path itself keeps the field honest rather than naming a root that
      // never contained it.
      root: lexical,
      sizeBytes: stat.size,
    };
  }

  /**
   * Whether a REAL path lands inside an open workspace folder or one of its
   * worktrees.
   *
   * Roots are realpath'd before comparison for the same reason the mechanism
   * does it: `os.tmpdir()` and a home directory can themselves be symlinks, so
   * a lexical comparison would miss a containment that genuinely holds. A root
   * that cannot be resolved is dropped — fail-closed, it can only ever shrink
   * the exempt set. Worktrees are consulted only after the registered roots
   * miss, because listing them shells out to git.
   */
  private async isInsideRegisteredRoots(target: string): Promise<boolean> {
    const registered = this.workspace.getWorkspaceFolders().filter((r) => !!r);
    if (registered.length === 0) return false;

    if (isPathWithinRoots(target, await this.realpathAll(registered))) {
      return true;
    }

    const lists = await Promise.all(
      registered.map(async (root) => {
        try {
          return await this.listWorktrees(root);
        } catch {
          // degradation-audit: optional-capability - worktree discovery only
          // ever WIDENS the exempt set, so [] keeps the deny-list applied.
          return [] as readonly string[];
        }
      }),
    );
    const worktrees = lists.flat().filter((value) => !!value);
    if (worktrees.length === 0) return false;

    return isPathWithinRoots(target, await this.realpathAll(worktrees));
  }

  /** Realpath a root set, dropping anything that cannot be resolved. */
  private async realpathAll(roots: readonly string[]): Promise<string[]> {
    const resolved = await Promise.all(
      roots.map(async (root) => {
        try {
          return await nodeFs.realpath(root);
        } catch {
          // degradation-audit: optional-capability - an unresolvable root
          // authorizes nothing rather than authorizing everything.
          return undefined;
        }
      }),
    );
    return resolved.filter((value): value is string => value !== undefined);
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
