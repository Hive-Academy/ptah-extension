/**
 * Python import resolution (TASK_2026_559 implementation-plan-languages.md,
 * "Dependency graphs", Python row; Batch 33 review r1 R33-01..R33-03). File
 * edges, found the way Python's path finder finds modules:
 *
 * - Each name is looked up along a search path, entry by entry: a regular
 *   package (`name/__init__.py`) or a module (`name.py`) in an entry is the
 *   answer and shadows every later entry; a plain directory `name/` is a
 *   namespace portion, and the portions of every entry together form a
 *   namespace package, used only when no entry has a regular one.
 * - The search path of a top-level name is the source roots (the root, `src/`
 *   when present, the `pyproject.toml` roots); a `pyproject.toml` package
 *   directory owning the name's prefix comes first. Below a package it is
 *   the package's directory, or every portion of a namespace package.
 * - Relative imports (`from ..pkg import x`) start `relativeLevel` - 1
 *   directories up from the importing file's directory. Never external.
 * - `from a.b import c, d` links the submodule for each requested name that
 *   is one, and the module `a/b` for every other name (or `*`). A requested
 *   name no file or module provides is counted as `unresolvedMembers`, even
 *   when the others resolve.
 * - A top-level name found in no source root: a local dependency the root
 *   `pyproject.toml` declares is looked up in its directory (and its `src/`)
 *   and is never external; a standard-library module or a declared
 *   dependency is proven `external`; anything else is `external` only as far
 *   as the context knows (`contextDependent`). A namespace portion never
 *   shadows a standard-library module. A name that exists but has no file
 *   for the whole module path is `unresolved-internal`.
 *
 * Case rule (plan "Case rule"), per lookup: exact matches along the whole
 * search path first; only when there is none, a unique case-insensitive
 * match (marked `caseFolded`); an ambiguous one is `unresolved-internal`.
 *
 * Not modelled (why `graphEdges.referenceScopeComplete` is false):
 * `importlib`, `__import__`, `sys.path` edits, `.pth` files, and namespace
 * packages that live outside the workspace.
 */
import * as path from 'path';
import type { ImportInfo } from '../ast-analysis.interfaces';
import type { ImportResolution, ImportResolver } from './import-resolver';
import { normalisePythonName } from './python-manifest';
import type { ResolverContext } from './resolver-context';

const EXTERNAL: ImportResolution = { kind: 'external', targets: [] };
const UNPROVEN_EXTERNAL: ImportResolution = {
  kind: 'external',
  targets: [],
  contextDependent: true,
};
const UNRESOLVED_INTERNAL: ImportResolution = {
  kind: 'unresolved-internal',
  targets: [],
};

/**
 * Top-level standard-library modules (CPython 3.14 `sys.stdlib_module_names`
 * without private names, plus the modules 3.12 and 3.13 removed, which older
 * interpreters still ship).
 */
const PYTHON_STDLIB: ReadonlySet<string> = new Set(
  [
    '__future__ abc aifc annotationlib antigravity argparse array ast asynchat',
    'asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2',
    'cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop',
    'collections colorsys compileall compression concurrent configparser',
    'contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses',
    'datetime dbm decimal difflib dis distutils doctest email encodings',
    'ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch',
    'fractions ftplib functools gc genericpath getopt getpass gettext glob',
    'graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp',
    'importlib inspect io ipaddress itertools json keyword lib2to3 linecache',
    'locale logging lzma mailbox mailcap marshal math mimetypes mmap',
    'modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath',
    'nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb',
    'pickle pickletools pipes pkgutil platform plistlib poplib posix',
    'posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc',
    'pydoc_data pyexpat queue quopri random re readline reprlib resource',
    'rlcompleter runpy sched secrets select selectors shelve shlex shutil',
    'signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3',
    'sre_compile sre_constants sre_parse ssl stat statistics string',
    'stringprep struct subprocess sunau symtable sys sysconfig syslog',
    'tabnanny tarfile telnetlib tempfile termios textwrap this threading time',
    'timeit tkinter token tokenize tomllib trace traceback tracemalloc tty',
    'turtle turtledemo types typing unicodedata unittest urllib uu uuid venv',
    'warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml',
    'xmlrpc zipapp zipfile zipimport zlib zoneinfo',
  ]
    .join(' ')
    .split(' '),
);

/** What one name is along a search path. */
type Found =
  | {
      readonly kind: 'regular';
      readonly dir: string;
      readonly file: string;
      readonly caseFolded: boolean;
    }
  | {
      readonly kind: 'module';
      readonly file: string;
      readonly caseFolded: boolean;
    }
  | {
      readonly kind: 'namespace';
      readonly dirs: readonly string[];
      readonly caseFolded: boolean;
    };

type Lookup = Found | 'ambiguous' | undefined;

/** A module path walked along a search path. */
type Walk =
  | { readonly found: Found; readonly caseFolded: boolean }
  | 'ambiguous'
  /** Nothing for the segment at this index. */
  | { readonly missingAt: number };

export const PYTHON_IMPORT_RESOLVER: ImportResolver = {
  resolve(
    imp: ImportInfo,
    fromFile: string,
    ctx: ResolverContext,
  ): ImportResolution {
    const dots = /^\.*/.exec(imp.source)?.[0].length ?? 0;
    const level = imp.relativeLevel ?? dots;
    const modulePath = imp.source.slice(dots);
    const segments = modulePath === '' ? [] : modulePath.split('.');
    if (level > 0) {
      const packageDir = ancestor(path.posix.dirname(fromFile), level - 1);
      if (packageDir === undefined || !isUnder(packageDir, ctx.root)) {
        return UNRESOLVED_INTERNAL;
      }
      const walk = walkFrom(packageAt(packageDir, ctx), segments, ctx);
      return resolutionOf(walk, imp.importedSymbols, ctx);
    }
    if (segments.length === 0) return UNRESOLVED_INTERNAL;

    const mapped = packageDirFor(segments, ctx);
    if (mapped !== undefined) {
      // The manifest places this package: a workspace module, found or not.
      const walk = walkFrom(packageAt(mapped.dir, ctx), mapped.rest, ctx);
      return resolutionOf(walk, imp.importedSymbols, ctx);
    }

    const first = segments[0];
    const stdlib = PYTHON_STDLIB.has(first);
    const walk = walkPath(ctx.python.sourceRoots, segments, ctx, !stdlib);
    if (walk === 'ambiguous' || !('missingAt' in walk) || walk.missingAt > 0) {
      return resolutionOf(walk, imp.importedSymbols, ctx);
    }
    const normalised = normalisePythonName(first);
    if (ctx.python.localDependencies.has(normalised)) {
      // Declared local: a workspace module, found or not.
      const dir = ctx.python.localDependencies.get(normalised);
      if (dir === undefined) return UNRESOLVED_INTERNAL;
      const local = walkPath([dir, `${dir}/src`], segments, ctx, true);
      return resolutionOf(local, imp.importedSymbols, ctx);
    }
    return stdlib || ctx.python.dependencies.has(normalised)
      ? EXTERNAL
      : UNPROVEN_EXTERNAL;
  },
};

/** The package a directory is: regular with an `__init__.py`, else a namespace. */
function packageAt(dir: string, ctx: ResolverContext): Found {
  const init = `${dir}/__init__.py`;
  return ctx.knownFiles.has(init)
    ? { kind: 'regular', dir, file: init, caseFolded: false }
    : { kind: 'namespace', dirs: [dir], caseFolded: false };
}

/** Walk `segments` along a top-level search path. */
function walkPath(
  searchPath: readonly string[],
  segments: readonly string[],
  ctx: ResolverContext,
  namespaces: boolean,
): Walk {
  const top = lookupName(searchPath, segments[0], ctx);
  if (top === 'ambiguous') return 'ambiguous';
  // A namespace portion never shadows a standard-library module.
  if (top === undefined || (top.kind === 'namespace' && !namespaces)) {
    return { missingAt: 0 };
  }
  const rest = walkFrom(top, segments.slice(1), ctx);
  return rest !== 'ambiguous' && 'missingAt' in rest
    ? { missingAt: rest.missingAt + 1 }
    : rest;
}

/** Walk `segments` below an already found package or module. */
function walkFrom(
  start: Found,
  segments: readonly string[],
  ctx: ResolverContext,
): Walk {
  let current = start;
  let caseFolded = start.caseFolded;
  for (let i = 0; i < segments.length; i++) {
    if (current.kind === 'module') return { missingAt: i };
    const next = lookupName(packagePath(current), segments[i], ctx);
    if (next === 'ambiguous') return 'ambiguous';
    if (next === undefined) return { missingAt: i };
    current = next;
    caseFolded ||= next.caseFolded;
  }
  return { found: current, caseFolded };
}

/** The resolution of a walked module and the names requested from it. */
function resolutionOf(
  walk: Walk,
  importedSymbols: readonly string[] | undefined,
  ctx: ResolverContext,
): ImportResolution {
  if (walk === 'ambiguous' || 'missingAt' in walk) return UNRESOLVED_INTERNAL;
  const { found } = walk;
  let caseFolded = walk.caseFolded;
  const targets = new Set<string>();
  let unresolvedMembers = 0;
  let needsModuleFile =
    importedSymbols === undefined || importedSymbols.length === 0;
  for (const name of importedSymbols ?? []) {
    if (name === '*' || found.kind === 'module') {
      needsModuleFile = true;
      continue;
    }
    const member = lookupName(packagePath(found), name, ctx);
    if (member === 'ambiguous') {
      unresolvedMembers++;
    } else if (member !== undefined) {
      const file = fileOf(member);
      if (file !== undefined) targets.add(file);
      caseFolded ||= member.caseFolded;
    } else if (found.kind === 'regular') {
      needsModuleFile = true; // an attribute of the package
    } else {
      unresolvedMembers++; // a namespace package has no attributes of its own
    }
  }
  if (needsModuleFile) {
    const file = fileOf(found);
    if (file !== undefined) targets.add(file);
  }
  if (targets.size === 0) return UNRESOLVED_INTERNAL;
  return {
    kind: 'file',
    targets: [...targets],
    ...(caseFolded ? { caseFolded: true } : {}),
    ...(unresolvedMembers > 0 ? { unresolvedMembers } : {}),
  };
}

function packagePath(found: Found): readonly string[] {
  if (found.kind === 'regular') return [found.dir];
  return found.kind === 'namespace' ? found.dirs : [];
}

function fileOf(found: Found): string | undefined {
  return found.kind === 'namespace' ? undefined : found.file;
}

/**
 * What `name` is along `searchPath` (see the module comment): exact matches
 * first, then a unique case-insensitive one.
 */
function lookupName(
  searchPath: readonly string[],
  name: string,
  ctx: ResolverContext,
): Lookup {
  const portions: string[] = [];
  for (const dir of searchPath) {
    const base = `${dir}/${name}`;
    const init = `${base}/__init__.py`;
    if (ctx.knownFiles.has(init)) {
      return { kind: 'regular', dir: base, file: init, caseFolded: false };
    }
    if (ctx.knownFiles.has(`${base}.py`)) {
      return { kind: 'module', file: `${base}.py`, caseFolded: false };
    }
    if (ctx.directories.has(base)) portions.push(base);
  }
  if (portions.length > 0) {
    return { kind: 'namespace', dirs: portions, caseFolded: false };
  }
  return foldedLookup(searchPath, name, ctx);
}

/** The unique case-insensitive match of `name` along `searchPath`. */
function foldedLookup(
  searchPath: readonly string[],
  name: string,
  ctx: ResolverContext,
): Lookup {
  const answers: Found[] = [];
  const portions: string[] = [];
  for (const dir of searchPath) {
    const base = `${dir}/${name}`.toLowerCase();
    for (const init of ctx.filesByFoldedPath.get(`${base}/__init__.py`) ?? []) {
      answers.push({
        kind: 'regular',
        dir: path.posix.dirname(init),
        file: init,
        caseFolded: true,
      });
    }
    for (const file of ctx.filesByFoldedPath.get(`${base}.py`) ?? []) {
      answers.push({ kind: 'module', file, caseFolded: true });
    }
    const plain = (ctx.directoriesByFoldedPath.get(base) ?? []).filter(
      (d) => !ctx.knownFiles.has(`${d}/__init__.py`),
    );
    // Two spellings of one portion in one entry cannot be told apart.
    if (plain.length > 1) return 'ambiguous';
    portions.push(...plain);
  }
  if (answers.length > 1) return 'ambiguous';
  if (answers.length === 1) return answers[0];
  return portions.length > 0
    ? { kind: 'namespace', dirs: portions, caseFolded: true }
    : undefined;
}

/** `dir` `levels` directories up, or `undefined` past the file system root. */
function ancestor(dir: string, levels: number): string | undefined {
  let current = dir;
  for (let i = 0; i < levels; i++) {
    const parent = path.posix.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return current;
}

function isUnder(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/** The package directory owning the longest prefix of `segments`, with the segments left. */
function packageDirFor(
  segments: readonly string[],
  ctx: ResolverContext,
): { dir: string; rest: string[] } | undefined {
  for (let length = segments.length; length > 0; length--) {
    const dir = ctx.python.packageDirs.get(segments.slice(0, length).join('.'));
    if (dir !== undefined) return { dir, rest: segments.slice(length) };
  }
  return undefined;
}
