/**
 * goFileMembership — may a requested `.go` file be credited as vetted when
 * `go vet` succeeds for its package? (TASK_2026_559 Batch 37a, review r1
 * finding 1.)
 *
 * A clean package run proves only that vet analysed the files the go command
 * SELECTED. Go drops a file for build constraints (`//go:build`, `// +build`,
 * a `_GOOS`/`_GOARCH` filename suffix), for a leading `_` or `.` in its name,
 * and — under the fixed `CGO_ENABLED=0` — for importing C. The checker runs
 * one fixed invocation, so it cannot ask Go which files it chose. Instead a
 * file is credited only when none of those exclusions can apply:
 *
 * - `ignored-name` — the name starts with `_` or `.`;
 * - `build-constraints` — a known GOOS/GOARCH filename suffix, or any
 *   `//go:build` / `// +build` line before the package clause (conservative:
 *   the constraint is not evaluated, so a file it might exclude is never
 *   claimed);
 * - `cgo` — the import section, read with a Go-aware scanner (comments,
 *   grouped and single imports, named imports), imports C;
 * - `unverifiable` — the file is larger than {@link MEMBERSHIP_MAX_BYTES},
 *   unreadable, or its header does not scan (an escaped import path, an
 *   unterminated comment): not proven, so not claimed.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Largest file whose header is read to prove membership (1 MiB). */
export const MEMBERSHIP_MAX_BYTES = 1024 * 1024;

export type GoFileMembership =
  'member' | 'ignored-name' | 'build-constraints' | 'cgo' | 'unverifiable';

/** `go/build` `knownOS` (syslist.go). */
const KNOWN_OS: ReadonlySet<string> = new Set([
  'aix',
  'android',
  'darwin',
  'dragonfly',
  'freebsd',
  'hurd',
  'illumos',
  'ios',
  'js',
  'linux',
  'nacl',
  'netbsd',
  'openbsd',
  'plan9',
  'solaris',
  'wasip1',
  'windows',
  'zos',
]);

/** `go/build` `knownArch` (syslist.go). */
const KNOWN_ARCH: ReadonlySet<string> = new Set([
  '386',
  'amd64',
  'amd64p32',
  'arm',
  'armbe',
  'arm64',
  'arm64be',
  'loong64',
  'mips',
  'mipsle',
  'mips64',
  'mips64le',
  'mips64p32',
  'mips64p32le',
  'ppc',
  'ppc64',
  'ppc64le',
  'riscv',
  'riscv64',
  's390',
  's390x',
  'sparc',
  'sparc64',
  'wasm',
]);

/**
 * Go's `goodOSArchFile` shape: the part after the first `_`, minus a `_test`
 * suffix, ending in a known GOOS or GOARCH. Any match is a constraint.
 */
export function hasFilenameConstraint(fileName: string): boolean {
  const stem = fileName.replace(/\.go$/i, '');
  const underscore = stem.indexOf('_');
  if (underscore < 0) return false;
  const parts = stem.slice(underscore).split('_');
  if (parts[parts.length - 1] === 'test') parts.pop();
  const last = parts[parts.length - 1] ?? '';
  return parts.length >= 2 && (KNOWN_OS.has(last) || KNOWN_ARCH.has(last));
}

/** What the header scan found; `null` when it could not scan. */
export interface GoHeader {
  readonly buildConstraint: boolean;
  readonly imports: readonly string[];
}

const IDENT = /[\p{L}_][\p{L}\p{N}_]*/uy;
const BUILD_LINE = /^\/\/(?:go:build(?:\s|$)|\s*\+build(?:\s|$))/;

/**
 * Scan the package clause and the import declarations: comments skipped
 * (build lines before the package clause noted), strings decoded, any other
 * token a single character. Returns `null` on anything it cannot read with
 * certainty, including an import path with an escape sequence.
 */
export function scanGoHeader(source: string): GoHeader | null {
  let index = 0;
  let buildConstraint = false;
  let sawPackage = false;

  /** The next token, `''` at end of input, `null` when unreadable. */
  const next = (): string | null => {
    for (;;) {
      while (index < source.length && /\s/.test(source[index])) index++;
      if (index >= source.length) return '';
      if (source.startsWith('//', index)) {
        const end = source.indexOf('\n', index);
        const stop = end < 0 ? source.length : end;
        if (!sawPackage && BUILD_LINE.test(source.slice(index, stop).trim())) {
          buildConstraint = true;
        }
        index = stop;
        continue;
      }
      if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2);
        if (end < 0) return null;
        index = end + 2;
        continue;
      }
      break;
    }
    const char = source[index];
    if (char === '"') {
      const end = source.indexOf('"', index + 1);
      const newline = source.indexOf('\n', index + 1);
      if (end < 0 || (newline >= 0 && newline < end)) return null;
      const body = source.slice(index + 1, end);
      if (body.includes('\\')) return null;
      index = end + 1;
      return `"${body}"`;
    }
    if (char === '`') {
      const end = source.indexOf('`', index + 1);
      if (end < 0) return null;
      const body = source.slice(index + 1, end);
      index = end + 1;
      return `"${body}"`;
    }
    IDENT.lastIndex = index;
    const ident = IDENT.exec(source);
    if (ident !== null) {
      index += ident[0].length;
      return ident[0];
    }
    index++;
    return char;
  };

  const isString = (token: string): boolean =>
    token.length >= 2 && token.startsWith('"') && token.endsWith('"');

  /** One import spec starting at `token`; the path, or `null`. */
  const spec = (token: string | null): string | null => {
    let current = token;
    if (current === null) return null;
    if (!isString(current)) {
      // A name: `.`, `_` or an identifier, then the path.
      if (current !== '.' && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(current)) {
        return null;
      }
      current = next();
      if (current === null || !isString(current)) return null;
    }
    return current.slice(1, -1);
  };

  if (next() !== 'package') return null;
  sawPackage = true;
  const name = next();
  if (name === null || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) return null;

  const imports: string[] = [];
  let token = next();
  for (;;) {
    if (token === null) return null;
    if (token === ';') {
      token = next();
      continue;
    }
    if (token !== 'import') break;
    token = next();
    if (token === '(') {
      for (;;) {
        token = next();
        if (token === null || token === '') return null;
        if (token === ';') continue;
        if (token === ')') break;
        const importPath = spec(token);
        if (importPath === null) return null;
        imports.push(importPath);
      }
    } else {
      const importPath = spec(token);
      if (importPath === null) return null;
      imports.push(importPath);
    }
    token = next();
  }
  return { buildConstraint, imports };
}

/** Can a clean vet of this file's package be credited to this file? */
export function goFileMembership(realFile: string): GoFileMembership {
  const name = path.basename(realFile);
  if (name.startsWith('_') || name.startsWith('.')) return 'ignored-name';
  if (hasFilenameConstraint(name)) return 'build-constraints';
  let source: string;
  try {
    if (fs.statSync(realFile).size > MEMBERSHIP_MAX_BYTES) {
      return 'unverifiable';
    }
    source = fs.readFileSync(realFile, 'utf8');
  } catch (error: unknown) {
    // degradation-audit: optional-capability - an unreadable file is not
    // proven to be in the package, so it is reported, never credited.
    void error;
    return 'unverifiable';
  }
  const header = scanGoHeader(source);
  if (header === null) return 'unverifiable';
  if (header.buildConstraint) return 'build-constraints';
  if (header.imports.includes('C')) return 'cgo';
  return 'member';
}
