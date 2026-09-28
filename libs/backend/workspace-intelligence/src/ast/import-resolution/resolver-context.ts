/**
 * The context every import resolver of one graph build reads (TASK_2026_559
 * implementation-plan-languages.md, "Resolver dispatch (32b)" and "Bounds").
 *
 * Built once per build by {@link buildResolverContext}: the graphed files,
 * plus what the workspace's root manifests say about module mapping: the
 * effective `paths` / `baseUrl` of the root `tsconfig*.json` files
 * (`tsconfig-mapping.ts`), the packages the root `package.json` declares
 * and how (a registry version, or a local `file:`/`link:`/`workspace:`
 * package), and whether it or `pnpm-workspace.yaml` declares workspace
 * packages; the root `pyproject.toml` (Python source roots, package
 * directories, declared dependencies: `python-manifest.ts`); and the root
 * `go.mod` and `go.work`, with the `go.mod` of every `go.work` `use`
 * directory (module paths, local `replace` directories, required modules:
 * `go-manifest.ts`). Each manifest is read bounded and identity-checked
 * (`manifest-reader.ts`). Whatever could not be read, or was read but is not
 * modelled, is a {@link ResolverContextGap}. Any gap, or any import no read
 * manifest accounts for (a bare specifier that is not a builtin or a declared
 * registry package), makes the build's resolution context `partial`, so the
 * graph never reads as clean on a guess.
 */
import * as path from 'path';
import {
  MANIFEST_LIMITS,
  NODE_MANIFEST_FILE_SYSTEM,
  readManifest,
  toForwardSlashes,
  type ManifestFileSystem,
} from './manifest-reader';
import {
  locateGoDirectory,
  selectGoModules,
  type GoModManifest,
  type GoModules,
} from './go-context';
import { readGoMod, readGoWork, type GoWorkFacts } from './go-manifest';
import { pythonLayout, type PythonLayout } from './python-context';
import { readPyproject, type PyprojectFacts } from './python-manifest';
import { mapRootTsconfigs, type RootTsconfig } from './tsconfig-mapping';

/** Why a resolver context is `partial`. */
export type ResolverContextGap =
  /** The root's directory listing failed (other than the root being absent). */
  | 'root-unreadable'
  /** More manifests than `MANIFEST_LIMITS.maxFiles`; the rest were not read. */
  | 'too-many-manifests'
  /** A manifest over `MANIFEST_LIMITS.maxFileBytes` was not used. */
  | 'manifest-too-large'
  /** The build's manifest byte budget ran out; the rest were not read. */
  | 'manifests-over-total'
  /** A manifest whose real path leaves the root (a link) was not read. */
  | 'manifest-outside-root'
  /** A manifest changed identity between its lookup and its open. */
  | 'manifest-changed'
  /** A manifest that is not UTF-8 text was not used. */
  | 'manifest-not-text'
  /** A manifest's lookup or read failed. */
  | 'manifest-unreadable'
  /** A manifest (or one of its mapping entries) could not be parsed. */
  | 'manifest-unparseable'
  /** A tsconfig `extends` a config this build did not read. */
  | 'extends-not-read'
  /** Independent root tsconfigs map the same module differently. */
  | 'conflicting-configs'
  /** Workspace packages are declared; package-name imports are not mapped. */
  | 'workspace-packages'
  /**
   * Which code a Go module's imports select cannot be decided (a
   * version-qualified replace of a version not known here, members that
   * replace a module differently, a replacement directory that cannot be
   * looked up): `go-context.ts`.
   */
  | 'module-selection-unknown';

/** One tsconfig `paths` entry. */
export interface TsconfigPathRule {
  /** The pattern as written (`@app/*`, `config`). */
  readonly pattern: string;
  /** Target patterns, in the order tried. */
  readonly targets: readonly string[];
  /** Absolute directory the targets are relative to (forward slashes). */
  readonly baseDir: string;
}

/** Everything resolvers read during one build. Immutable. */
export interface ResolverContext {
  /** The workspace root, forward slashes. */
  readonly root: string;
  /** Graph node keys of every parsed file. */
  readonly knownFiles: ReadonlySet<string>;
  /** Node keys by lower-cased key, for the case rule (unique match only). */
  readonly filesByFoldedPath: ReadonlyMap<string, readonly string[]>;
  /** Node keys by their directory (forward slashes, no trailing slash). */
  readonly filesByDirectory: ReadonlyMap<string, readonly string[]>;
  /** Every directory holding a node key, and each ancestor up to the root. */
  readonly directories: ReadonlySet<string>;
  /** Those directories by lower-cased path, for the case rule. */
  readonly directoriesByFoldedPath: ReadonlyMap<string, readonly string[]>;
  /**
   * tsconfig `paths` rules: the caller's first (relative to the root), then
   * the effective rules of the root tsconfig files (`tsconfig-mapping.ts`).
   */
  readonly tsconfigPaths: readonly TsconfigPathRule[];
  /** The effective `baseUrl` directory of the root tsconfig files (0 or 1). */
  readonly baseUrls: readonly string[];
  /**
   * Package names the root `package.json` declares with a registry (or other
   * non-local) specification in `dependencies`, `devDependencies`,
   * `peerDependencies` or `optionalDependencies`: an import of one is
   * proven external.
   */
  readonly externalPackages: ReadonlySet<string>;
  /**
   * Package names declared as local packages (`file:`, `link:`,
   * `workspace:`, or a path), mapped to their directory when the
   * specification names one (`file:./packages/local`), else `undefined`.
   * An import of one is a workspace module, never proven external.
   */
  readonly localPackages: ReadonlyMap<string, string | undefined>;
  readonly python: PythonLayout;
  readonly go: GoModules;
  /** Empty when the manifests were read completely. */
  readonly gaps: readonly ResolverContextGap[];
  /** Manifest files read. */
  readonly manifestsRead: number;
}

export interface ResolverContextOptions {
  /** Workspace root (either separator). */
  readonly root: string;
  /** Graph node keys of every parsed file. */
  readonly knownFiles: Iterable<string>;
  /** `paths` the caller supplied, relative to the root. */
  readonly callerPaths?: Readonly<Record<string, readonly string[]>>;
  /** False once the build was superseded: reading stops. */
  readonly isCurrent: () => boolean;
  /** Awaited before each manifest read (a background build yields here). */
  readonly yieldBetweenReads?: () => Promise<void>;
  readonly fileSystem?: ManifestFileSystem;
}

const TSCONFIG_NAME = /^tsconfig.*\.json$/i;
const PACKAGE_JSON = 'package.json';
const PNPM_WORKSPACE = 'pnpm-workspace.yaml';
const PYPROJECT = 'pyproject.toml';
const GO_MOD = 'go.mod';
const GO_WORK = 'go.work';
const ROOT_MANIFEST_NAMES: ReadonlySet<string> = new Set([
  PACKAGE_JSON,
  PYPROJECT,
  GO_MOD,
  GO_WORK,
]);

/** Absent root: nothing to read, and nothing unknown about it. */
const ABSENT_PATH_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/** What the root manifests say, filled in by {@link readManifests}. */
interface ManifestFacts {
  readonly tsconfigs: RootTsconfig[];
  readonly externalPackages: Set<string>;
  readonly localPackages: Map<string, string | undefined>;
  pyproject: PyprojectFacts | undefined;
  readonly goMods: GoModManifest[];
  goWork: GoWorkFacts | undefined;
  manifestsRead: number;
  /** Manifest files whose read was attempted. */
  manifestsTried: number;
  /** Bytes read so far, charged against `MANIFEST_LIMITS.maxTotalBytes`. */
  totalBytes: number;
}

/**
 * Build the context for one graph build, or `undefined` when `isCurrent`
 * turned false while manifests were read (the build was superseded).
 */
export async function buildResolverContext(
  options: ResolverContextOptions,
): Promise<ResolverContext | undefined> {
  const fileSystem = options.fileSystem ?? NODE_MANIFEST_FILE_SYSTEM;
  const root = trimSlashes(toForwardSlashes(options.root));
  const knownFiles = new Set(options.knownFiles);
  const gaps = new Set<ResolverContextGap>();
  const facts: ManifestFacts = {
    tsconfigs: [],
    externalPackages: new Set(),
    localPackages: new Map(),
    pyproject: undefined,
    goMods: [],
    goWork: undefined,
    manifestsRead: 0,
    manifestsTried: 0,
    totalBytes: 0,
  };

  const listing = await listManifests(fileSystem, root, gaps);
  if (!options.isCurrent()) return undefined;
  if (listing.pnpmWorkspace) gaps.add('workspace-packages');

  let realRoot: string | undefined;
  if (listing.manifests.length > 0) {
    realRoot = await realPathOf(fileSystem, root, gaps);
    if (!options.isCurrent()) return undefined;
    const io = {
      fileSystem,
      isCurrent: options.isCurrent,
      yieldBetweenReads: options.yieldBetweenReads,
    };
    if (
      realRoot !== undefined &&
      !(await readManifests(listing.manifests, root, realRoot, facts, gaps, io))
    ) {
      return undefined;
    }
    // Second round: the go.mod of each go.work module not read yet.
    const workModules: string[] = [];
    for (const use of facts.goWork?.uses ?? []) {
      const location = await locateGoDirectory(use, '', {
        root,
        realRoot,
        fileSystem,
      });
      if (!options.isCurrent()) return undefined;
      // A module outside the root, or one that cannot be looked up: its
      // go.mod is not read, so the module path it adds is unknown.
      if (location.kind === 'outside') gaps.add('manifest-outside-root');
      else if (location.kind === 'unknown') gaps.add('manifest-unreadable');
      else workModules.push(path.posix.join(location.relative, GO_MOD));
    }
    const unread = [...new Set(workModules)].filter(
      (name) => !listing.manifests.includes(name),
    );
    if (
      realRoot !== undefined &&
      !(await readManifests(unread, root, realRoot, facts, gaps, io))
    ) {
      return undefined;
    }
  }
  const go = await selectGoModules(facts.goMods, facts.goWork, {
    root,
    realRoot,
    fileSystem,
  });
  if (!options.isCurrent()) return undefined;
  if (go.selectionUnknown) gaps.add('module-selection-unknown');

  const tsconfig = mapRootTsconfigs(facts.tsconfigs, root);
  for (const gap of tsconfig.gaps) gaps.add(gap);
  const callerRules: TsconfigPathRule[] = Object.entries(
    options.callerPaths ?? {},
  ).map(([pattern, targets]) => ({
    pattern,
    targets: [...targets],
    baseDir: root,
  }));

  const filesByDirectory = directoryIndex(knownFiles);
  const directories = withAncestors(filesByDirectory.keys(), root);
  return {
    root,
    knownFiles,
    filesByFoldedPath: foldedIndex(knownFiles),
    filesByDirectory,
    directories,
    directoriesByFoldedPath: foldedIndex(directories),
    tsconfigPaths: [...callerRules, ...tsconfig.paths],
    baseUrls: tsconfig.baseUrls,
    externalPackages: facts.externalPackages,
    localPackages: facts.localPackages,
    python: pythonLayout(root, facts.pyproject, directories),
    go: go.modules,
    gaps: [...gaps],
    manifestsRead: facts.manifestsRead,
  };
}

/**
 * Read the candidate manifests (paths relative to the root) in order, within
 * the file count and byte budget, into `facts` and `gaps`. Every byte read
 * is charged, whether its content is used or not; once the budget is spent
 * the rest are not read. False when the build was superseded meanwhile.
 */
async function readManifests(
  candidates: readonly string[],
  root: string,
  realRoot: string,
  facts: ManifestFacts,
  gaps: Set<ResolverContextGap>,
  io: {
    readonly fileSystem: ManifestFileSystem;
    readonly isCurrent: () => boolean;
    readonly yieldBetweenReads?: () => Promise<void>;
  },
): Promise<boolean> {
  for (const name of candidates) {
    if (facts.manifestsTried >= MANIFEST_LIMITS.maxFiles) {
      gaps.add('too-many-manifests');
      break;
    }
    if (facts.totalBytes >= MANIFEST_LIMITS.maxTotalBytes) {
      gaps.add('manifests-over-total');
      break;
    }
    facts.manifestsTried++;
    await io.yieldBetweenReads?.();
    if (!io.isCurrent()) return false;
    const read = await readManifest({
      fileSystem: io.fileSystem,
      filePath: root.endsWith('/') ? root + name : `${root}/${name}`,
      realRoot,
      remainingBytes: MANIFEST_LIMITS.maxTotalBytes - facts.totalBytes,
      isCurrent: io.isCurrent,
    });
    facts.totalBytes += read.bytesRead;
    if (read.kind === 'superseded' || !io.isCurrent()) return false;
    if (read.kind === 'skipped') continue;
    if (read.kind === 'gap') {
      gaps.add(read.gap);
      if (read.gap === 'manifests-over-total') break;
      continue;
    }
    facts.manifestsRead++;
    if (!applyManifest(name, read.text, root, facts, gaps)) {
      gaps.add('manifest-unparseable');
    }
  }
  return true;
}

/** Record one manifest's text in `facts`; false when it cannot be parsed. */
function applyManifest(
  name: string,
  text: string,
  root: string,
  facts: ManifestFacts,
  gaps: Set<ResolverContextGap>,
): boolean {
  const base = path.posix.basename(name);
  const dir = path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name);
  if (base === PYPROJECT) {
    facts.pyproject = readPyproject(text);
    return facts.pyproject !== undefined;
  }
  if (base === GO_MOD) {
    const goMod = readGoMod(text);
    if (goMod === undefined) return false;
    facts.goMods.push({ dir, facts: goMod });
    return true;
  }
  if (base === GO_WORK) {
    facts.goWork = readGoWork(text);
    return facts.goWork !== undefined;
  }
  const parsed = parseJsonc(text);
  if (parsed === undefined || !isRecord(parsed)) return false;
  if (base === PACKAGE_JSON) {
    readPackageJson(parsed, root, facts, gaps);
  } else {
    facts.tsconfigs.push({ name, config: parsed });
  }
  return true;
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** Local package protocols: the package's code is in this repository. */
const LOCAL_SPEC =
  /^(?:file:|link:|workspace:|portal:|\.{1,2}[\\/]|[\\/]|~[\\/])/;

/**
 * Collect the root package.json's declared packages by specification: a
 * local one (`file:./x`, `link:../y`, `workspace:*`, `./z`) is internal and
 * mapped to its directory when it names one; any other is external.
 */
function readPackageJson(
  packageJson: Record<string, unknown>,
  root: string,
  facts: ManifestFacts,
  gaps: Set<ResolverContextGap>,
): void {
  if (declaresWorkspaces(packageJson)) gaps.add('workspace-packages');
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (dependencies === undefined) continue;
    if (!isRecord(dependencies)) {
      gaps.add('manifest-unparseable');
      continue;
    }
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== 'string') {
        gaps.add('manifest-unparseable');
      } else if (LOCAL_SPEC.test(spec)) {
        facts.localPackages.set(name, localPackageDir(spec, root));
      } else {
        facts.externalPackages.add(name);
      }
    }
  }
  // A package declared local anywhere is never proven external.
  for (const name of facts.localPackages.keys()) {
    facts.externalPackages.delete(name);
  }
}

/**
 * The directory a local specification names under the root (`file:./x` →
 * `<root>/x`), or `undefined` (`workspace:*`, a home path, a location
 * outside the root).
 */
function localPackageDir(spec: string, root: string): string | undefined {
  const location = toForwardSlashes(spec.replace(/^(?:file|link|portal):/, ''));
  if (!location.startsWith('./') && !location.startsWith('../')) {
    return undefined;
  }
  const dir = path.posix.join(root, location).replace(/\/+$/, '');
  return dir.startsWith(`${root}/`) ? dir : undefined;
}

function declaresWorkspaces(packageJson: Record<string, unknown>): boolean {
  const workspaces = packageJson['workspaces'];
  if (Array.isArray(workspaces)) return workspaces.length > 0;
  return isRecord(workspaces);
}

/** The root's manifest names in code-unit order, and whether pnpm workspaces exist. */
async function listManifests(
  fileSystem: ManifestFileSystem,
  root: string,
  gaps: Set<ResolverContextGap>,
): Promise<{ manifests: string[]; pnpmWorkspace: boolean }> {
  let names: string[];
  try {
    names = await fileSystem.readdir(root);
  } catch (error: unknown) {
    // An absent root has no manifests; any other listing failure is the
    // `root-unreadable` gap, which makes the resolution context `partial`.
    if (!ABSENT_PATH_CODES.has(errorCode(error))) gaps.add('root-unreadable');
    names = [];
  }
  const manifests = names
    .filter((name) => TSCONFIG_NAME.test(name) || ROOT_MANIFEST_NAMES.has(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { manifests, pnpmWorkspace: names.includes(PNPM_WORKSPACE) };
}

/** The root's real path, or `undefined` (with a gap) when it cannot be looked up. */
async function realPathOf(
  fileSystem: ManifestFileSystem,
  root: string,
  gaps: Set<ResolverContextGap>,
): Promise<string | undefined> {
  let realRoot: string | undefined;
  try {
    realRoot = trimSlashes(toForwardSlashes(await fileSystem.realpath(root)));
  } catch {
    // Without the root's real path no manifest can be proven inside it, so
    // none is read: the `manifest-unreadable` gap.
    gaps.add('manifest-unreadable');
  }
  return realRoot;
}

function directoryIndex(
  knownFiles: ReadonlySet<string>,
): Map<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const file of knownFiles) {
    const dir = path.posix.dirname(file);
    const entry = index.get(dir);
    if (entry) entry.push(file);
    else index.set(dir, [file]);
  }
  return index;
}

/** `dirs` and each of their ancestors up to `root`. */
function withAncestors(dirs: Iterable<string>, root: string): Set<string> {
  const all = new Set<string>();
  for (const start of dirs) {
    let dir = start;
    while (!all.has(dir)) {
      all.add(dir);
      const parent = path.posix.dirname(dir);
      if (dir === root || parent === dir || !parent.startsWith(root)) break;
      dir = parent;
    }
  }
  return all;
}

function foldedIndex(
  knownFiles: ReadonlySet<string>,
): Map<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const file of knownFiles) {
    const folded = file.toLowerCase();
    const entry = index.get(folded);
    if (entry) entry.push(file);
    else index.set(folded, [file]);
  }
  return index;
}

/** Drops trailing slashes, but keeps a bare drive or POSIX root. */
function trimSlashes(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed)
    ? `${trimmed}/`
    : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

/**
 * Parse JSON with comments and trailing commas (tsconfig's JSONC), or
 * `undefined` when it is not valid even then.
 */
export function parseJsonc(text: string): unknown {
  let cleaned = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const end = endOfString(text, i);
      cleaned += text.slice(i, end);
      i = end;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) return undefined;
      cleaned += ' ';
      i = close + 2;
    } else {
      cleaned += char;
      i++;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutTrailingCommas(cleaned));
  } catch {
    // Invalid JSON: the caller's `manifest-unparseable` gap.
    parsed = undefined;
  }
  return parsed;
}

/** Index just past the string literal that starts at `start`. */
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === '"') return i + 1;
    else i++;
  }
  return text.length;
}

function withoutTrailingCommas(json: string): string {
  let result = '';
  let i = 0;
  while (i < json.length) {
    const char = json[i];
    if (char === '"') {
      const end = endOfString(json, i);
      result += json.slice(i, end);
      i = end;
      continue;
    }
    if (char === ',') {
      let next = i + 1;
      while (next < json.length && /\s/.test(json[next])) next++;
      if (json[next] === '}' || json[next] === ']') {
        i++;
        continue;
      }
    }
    result += char;
    i++;
  }
  return result;
}
