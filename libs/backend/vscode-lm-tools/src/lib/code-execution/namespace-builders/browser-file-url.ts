/**
 * Host-neutral file: URL containment for the browser tool.
 *
 * The WHATWG parser drops ".." and, on Windows, rewrites file://localhost
 * to an empty host. Those checks therefore run on the raw string. A target
 * is allowed only after fs.realpath and a path.relative containment check
 * against realpath'd workspace roots. Symlink and junction escapes fail.
 * Nothing in the rejection messages includes a filesystem path.
 *
 * A paused file request must be answered from a descriptor opened on the
 * canonical path. Continuing the original URL lets the browser open whatever
 * the path names after the check.
 */

import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILE_URL_BLOCKED_MESSAGE =
  'Blocked: file URLs are allowed only for an existing file inside the workspace.';

export const ESCAPED_PAGE_MESSAGE =
  'Blocked: the current page is outside the workspace.';

/** Bodies larger than this are failed, not streamed. 25 MiB. */
export const MAX_CONTAINED_FILE_BYTES = 25 * 1024 * 1024;

const FILE_SCHEME = /^file:/i;
const MAX_FILE_URL_LENGTH = 32768;
const WINDOWS_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
/** Same hosts as validateBrowserUrl. A follow-on http(s) URL uses this list. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

export interface FileUrlDecision {
  allowed: boolean;
}

export interface ContainedFilePayload {
  bodyBase64: string;
  contentType: string;
}

/** Identity of one filesystem object. `dev` and `ino` use bigint stats. */
export interface ContainedFileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  regularFile: boolean;
}

export interface ContainedFileHandle {
  stat(): Promise<ContainedFileIdentity>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/**
 * Filesystem seam for the contained-file read. Tests substitute `lstat` and
 * `open` so a descriptor can report a different identity than the path.
 */
export interface ContainedFileSystem {
  lstat(filePath: string): Promise<ContainedFileIdentity>;
  open(filePath: string, flags: number): Promise<ContainedFileHandle>;
  realpath(filePath: string): Promise<string>;
}

export function sameWorkspaceRoots(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalize = (roots: readonly string[]): string[] =>
    [...roots].map((root) => root.trim()).sort();
  const sortedLeft = normalize(left);
  const sortedRight = normalize(right);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * True when `targetReal` is `rootReal` or a path segment below it.
 * Windows comparison is case-insensitive. A shared string prefix is not enough.
 * A name such as `..preview.html` is a child, not a parent segment.
 */
export function canonicalPathInsideRoot(
  targetReal: string,
  rootReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const relative = pathApi.relative(rootReal, targetReal);
  if (relative === '') {
    return true;
  }
  const escapes =
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative);
  if (escapes) {
    return false;
  }
  return !relative.split(pathApi.sep).includes('..');
}

/**
 * True when a file URL is unsafe before any filesystem access (bad encoding,
 * nonempty host, "..", encoded separators, drive-relative or device paths).
 * Non-file URLs return false so navigation listeners leave them alone.
 */
export function fileUrlFailsClosedLexically(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !FILE_SCHEME.test(rawUrl.trim())) {
    return false;
  }
  const pathPart = fileUrlPath(rawUrl);
  if (pathPart === undefined) {
    return true;
  }
  const decoded = decodeFilePath(pathPart);
  if (decoded === undefined) {
    return true;
  }
  if (decoded.startsWith('//')) {
    return true;
  }
  if (/^\/[A-Za-z]:(?![/])/.test(decoded)) {
    return true;
  }
  if (/^\/[A-Za-z]:\//.test(decoded) && hasWindowsDeviceSegment(decoded)) {
    return true;
  }
  return false;
}

export async function evaluateFileUrl(
  rawUrl: string,
  workspaceRoots: readonly string[],
): Promise<FileUrlDecision> {
  const canonical = await locateContainedPath(rawUrl, workspaceRoots);
  return { allowed: canonical !== undefined };
}

/**
 * Follow-on top-level URL policy. http(s) keeps the localhost rule,
 * file: must stay inside the roots, and about:blank is the blank page
 * this tool navigates to after a refusal. data:, javascript:, blob:,
 * filesystem:, view-source:, chrome:, and devtools: are refused.
 */
export async function toolMayReadPage(
  rawUrl: string,
  workspaceRoots: readonly string[],
  allowLocalhost: boolean,
): Promise<boolean> {
  if (rawUrl === 'about:blank') {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // degradation-audit: optional-capability - an unparseable page URL is
    // refused (fail closed); the caller withholds the page.
    return false;
  }
  if (parsed.href === 'about:blank') {
    return true;
  }
  if (parsed.protocol === 'file:') {
    return (await evaluateFileUrl(rawUrl, workspaceRoots)).allowed;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  if (!allowLocalhost && LOCAL_HOSTS.includes(parsed.hostname)) {
    return false;
  }
  return true;
}

/**
 * Open `rawUrl`'s canonical path only after `lstat` says it is a regular
 * file, then require the descriptor's `dev`/`ino` to match that stat.
 * The browser must not open the URL itself. `maxBytes` defaults to 25 MiB.
 */
export async function readContainedWorkspaceFile(
  rawUrl: string,
  workspaceRoots: readonly string[],
  maxBytes: number = MAX_CONTAINED_FILE_BYTES,
  fileSystem: ContainedFileSystem = defaultContainedFileSystem,
): Promise<ContainedFilePayload | undefined> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    return undefined;
  }
  const canonical = await locateContainedPath(rawUrl, workspaceRoots);
  if (canonical === undefined) {
    return undefined;
  }
  let handle: ContainedFileHandle | undefined;
  try {
    const checked = await fileSystem.lstat(canonical);
    if (!checked.regularFile || checked.size > BigInt(maxBytes)) {
      return undefined;
    }
    handle = await fileSystem.open(canonical, containedOpenFlags());
    const opened = await handle.stat();
    if (
      !opened.regularFile ||
      opened.dev !== checked.dev ||
      opened.ino !== checked.ino ||
      opened.size > BigInt(maxBytes)
    ) {
      return undefined;
    }
    const openedReal = await fileSystem.realpath(canonical);
    if (
      !sameCanonicalPath(openedReal, canonical) ||
      !(await realpathInsideRoots(openedReal, workspaceRoots))
    ) {
      return undefined;
    }
    const byteLength = Number(opened.size);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      return undefined;
    }
    const buffer = Buffer.alloc(byteLength);
    const { bytesRead } = await handle.read(buffer, 0, byteLength, 0);
    if (bytesRead !== byteLength) {
      return undefined;
    }
    const afterRead = await fileSystem.realpath(canonical);
    if (
      !sameCanonicalPath(afterRead, canonical) ||
      !(await realpathInsideRoots(afterRead, workspaceRoots))
    ) {
      return undefined;
    }
    return {
      bodyBase64: buffer.toString('base64'),
      contentType: contentTypeForPath(openedReal),
    };
  } catch {
    // degradation-audit: optional-capability - a file that cannot be opened
    // or read is not served (fail closed); the request is failed.
    return undefined;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // degradation-audit: optional-capability - descriptor close cannot
        // widen the bytes already copied into the response buffer.
      }
    }
  }
}

function containedOpenFlags(): number {
  let flags = fsConstants.O_RDONLY;
  if (process.platform !== 'win32') {
    if (typeof fsConstants.O_NOFOLLOW === 'number') {
      flags |= fsConstants.O_NOFOLLOW;
    }
    if (typeof fsConstants.O_NONBLOCK === 'number') {
      flags |= fsConstants.O_NONBLOCK;
    }
  }
  return flags;
}

function identityFromStats(stats: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  isFile(): boolean;
}): ContainedFileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    regularFile: stats.isFile(),
  };
}

function wrapHandle(handle: FileHandle): ContainedFileHandle {
  return {
    async stat(): Promise<ContainedFileIdentity> {
      return identityFromStats(await handle.stat({ bigint: true }));
    },
    read(buffer, offset, length, position) {
      return handle.read(buffer, offset, length, position);
    },
    close() {
      return handle.close();
    },
  };
}

const defaultContainedFileSystem: ContainedFileSystem = {
  async lstat(filePath: string): Promise<ContainedFileIdentity> {
    return identityFromStats(await lstat(filePath, { bigint: true }));
  },
  async open(filePath: string, flags: number): Promise<ContainedFileHandle> {
    return wrapHandle(await open(filePath, flags));
  },
  realpath(filePath: string): Promise<string> {
    return realpath(filePath);
  },
};

async function locateContainedPath(
  rawUrl: string,
  workspaceRoots: readonly string[],
): Promise<string | undefined> {
  if (typeof rawUrl !== 'string' || !FILE_SCHEME.test(rawUrl.trim())) {
    return undefined;
  }
  if (fileUrlFailsClosedLexically(rawUrl)) {
    return undefined;
  }
  const pathPart = fileUrlPath(rawUrl);
  const decoded = pathPart === undefined ? undefined : decodeFilePath(pathPart);
  if (decoded === undefined) {
    return undefined;
  }
  const filesystemPath = filesystemPathFromDecoded(decoded);
  if (filesystemPath === undefined) {
    return undefined;
  }
  if (
    (process.platform === 'win32' || /^[A-Za-z]:[\\/]/.test(filesystemPath)) &&
    hasWindowsDeviceSegment(filesystemPath)
  ) {
    return undefined;
  }

  let targetReal: string;
  try {
    targetReal = await realpath(filesystemPath);
  } catch {
    // degradation-audit: optional-capability - a missing or unresolvable
    // target is refused (fail closed).
    return undefined;
  }
  if (!(await realpathInsideRoots(targetReal, workspaceRoots))) {
    return undefined;
  }
  return targetReal;
}

async function realpathInsideRoots(
  targetReal: string,
  workspaceRoots: readonly string[],
): Promise<boolean> {
  if (!path.isAbsolute(targetReal)) {
    return false;
  }
  for (const root of workspaceRoots) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      continue;
    }
    let rootReal: string;
    try {
      rootReal = await realpath(root);
    } catch {
      continue;
    }
    if (canonicalPathInsideRoot(targetReal, rootReal)) {
      return true;
    }
  }
  return false;
}

function sameCanonicalPath(left: string, right: string): boolean {
  return (
    canonicalPathInsideRoot(left, right) && canonicalPathInsideRoot(right, left)
  );
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.xml':
      return 'application/xml';
    case '.pdf':
      return 'application/pdf';
    case '.wasm':
      return 'application/wasm';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function fileUrlPath(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (
    !FILE_SCHEME.test(trimmed) ||
    trimmed.length > MAX_FILE_URL_LENGTH ||
    trimmed.includes('\\')
  ) {
    return undefined;
  }
  const rest = trimmed.slice('file:'.length);
  if (!rest.startsWith('//')) {
    if (!rest.startsWith('/')) {
      return undefined;
    }
    return stripQueryAndHash(rest);
  }
  const body = rest.slice(2);
  const slash = body.indexOf('/');
  const authority = slash === -1 ? body : body.slice(0, slash);
  // Do not strip ? or # out of the authority. file://?/C:/x is not file:///C:/x.
  if (/[?#@:]/.test(authority) || authority !== '' || slash === -1) {
    return undefined;
  }
  return stripQueryAndHash(body.slice(slash));
}

function stripQueryAndHash(value: string): string {
  const query = value.split('?')[0] ?? '';
  return query.split('#')[0] ?? '';
}

function decodeFilePath(pathPart: string): string | undefined {
  if (!pathPart.startsWith('/')) {
    return undefined;
  }
  if (/%2f/i.test(pathPart) || /%5c/i.test(pathPart) || /%00/i.test(pathPart)) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    // degradation-audit: optional-capability - malformed percent-encoding is
    // refused (fail closed).
    return undefined;
  }
  if (decoded.includes('\\') || decoded.includes('\0') || !decoded.startsWith('/')) {
    return undefined;
  }
  if (decoded.split('/').some((segment) => segment === '..')) {
    return undefined;
  }
  return decoded;
}

function hasWindowsDeviceSegment(filePath: string): boolean {
  return filePath.split(/[\\/]/).some((segment) => {
    const bare = segment.replace(/[. ]+$/u, '').split('.')[0] ?? '';
    return WINDOWS_DEVICE.test(bare);
  });
}

function filesystemPathFromDecoded(decodedPath: string): string | undefined {
  try {
    const url = new URL('file://');
    url.pathname = decodedPath;
    if (url.protocol !== 'file:' || url.host !== '') {
      return undefined;
    }
    const filesystemPath = fileURLToPath(url);
    if (!path.isAbsolute(filesystemPath)) {
      return undefined;
    }
    if (filesystemPath.startsWith('\\\\') || filesystemPath.startsWith('//')) {
      return undefined;
    }
    return filesystemPath;
  } catch {
    // degradation-audit: optional-capability - a URL that fileURLToPath
    // rejects is refused (fail closed).
    return undefined;
  }
}
