/**
 * C# facts for the resolver context (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs", C# row; Batch 34):
 * which graphed files declare each namespace, which declare each type, the
 * project every file belongs to, the global usings in scope for each
 * project, and the NuGet packages the projects reference.
 *
 * - **Namespaces** come from each file's `declarations` (Batch 32a: nested
 *   block namespaces are already composed, `namespace A { namespace B.C }`
 *   declares `A` and `A.B.C`; a file-scoped `namespace N;` covers the file).
 * - **Types** are the file's public type exports (`publicSymbols`), filed
 *   under every namespace the file declares (the global namespace when it
 *   declares none). A non-public type is not known, so a `using static` of
 *   it links its namespace's files instead.
 * - **Projects**: a file belongs to the nearest directory, from its own up to
 *   the root, that holds a `.csproj`. A file with none belongs to the root
 *   group, shared by every such file. Directories are listed within
 *   {@link MAX_PROJECT_LISTINGS}.
 * - **Global usings** of a project: every `global using` of its C# files,
 *   plus the `<Using Include="…">` items of its `.csproj` files and of the
 *   nearest `Directory.Build.props` and `Directory.Build.targets` at or above
 *   its directory (MSBuild imports only the nearest of each). The manifest
 *   items are declared by no graphed file, so the graph tallies each once.
 * - **Packages**: the `Include` of every `<PackageReference>` and
 *   `<GlobalPackageReference>` of those manifests, read through the bounded
 *   manifest reader. A `ProjectReference` is a workspace project: never
 *   proof that a namespace is external.
 *
 * - **Root group**: files no `.csproj` encloses. A `global using` in one of
 *   them reaches all of them, and the nearest `Directory.Build.props` and
 *   `.targets` above each file apply their `<Using>` items to it.
 *
 * Disclosed as the `csharp-project-unknown` gap (the build's context is
 * `partial`): a directory listing that failed or was cut at the limit (a
 * project file, and the global usings it declares, may be missed), and any
 * global using that reaches the root group (its project boundary is a
 * guess). An `<Import Project="…">` in a manifest read is not followed (the
 * `msbuild-import-not-read` gap), and a `<Using>` value built from a
 * property is not evaluated (the `msbuild-using-not-evaluated` gap).
 */
import * as path from 'path';
import type {
  DeclarationInfo,
  ExportInfo,
  ImportInfo,
} from '../ast-analysis.interfaces';
import type { SupportedLanguage } from '../ast.types';
import type { ManifestFileSystem } from './manifest-reader';

/** What the C# layout reads of one parsed file (a graph `FileNode` fits). */
export interface ParsedSourceFacts {
  /** Graph node key (absolute, forward slashes). */
  readonly path: string;
  readonly language: SupportedLanguage;
  readonly imports: readonly ImportInfo[];
  readonly exports: readonly ExportInfo[];
  readonly declarations?: readonly DeclarationInfo[];
}

/** A global using and where it is declared. */
export interface CSharpGlobalUsing {
  /** The declaring C# file or MSBuild manifest (absolute, forward slashes). */
  readonly file: string;
  readonly imp: ImportInfo;
  /** Declared by an MSBuild manifest (`<Using Include>`), not a graphed file. */
  readonly fromManifest?: true;
}

/** What C# resolution reads (see the module comment). */
export interface CSharpLayout {
  /** Files declaring each namespace, sorted. */
  readonly namespaceFiles: ReadonlyMap<string, readonly string[]>;
  /** Every declared namespace and each of its enclosing namespaces. */
  readonly namespaces: ReadonlySet<string>;
  /** Files declaring public type `T` in namespace `N`, keyed `N\0T` (`''`: global). */
  readonly typeFiles: ReadonlyMap<string, readonly string[]>;
  /**
   * Each C# file's project directory. A file no `.csproj` encloses is in
   * the root group: `''`, or a key naming the nearest `Directory.Build.*`
   * manifests above it when there are any.
   */
  readonly projectOf: ReadonlyMap<string, string>;
  /** Global usings by project directory. */
  readonly globalUsings: ReadonlyMap<string, readonly CSharpGlobalUsing[]>;
  /** Package ids the manifests read reference. */
  readonly packages: ReadonlySet<string>;
}

export const EMPTY_CSHARP_LAYOUT: CSharpLayout = {
  namespaceFiles: new Map(),
  namespaces: new Set(),
  typeFiles: new Map(),
  projectOf: new Map(),
  globalUsings: new Map(),
  packages: new Set(),
};

/** Most directories listed while looking for `.csproj` files, per build. */
export const MAX_PROJECT_LISTINGS = 1_000;

/** MSBuild manifests the C# layout reads. */
export const CSPROJ_NAME = /\.csproj$/i;
const DIRECTORY_PROPS = 'directory.build.props';
const DIRECTORY_TARGETS = 'directory.build.targets';

/** Export kinds that are types (`csharp-public-symbols.ts`). */
const TYPE_EXPORT_KINDS: ReadonlySet<ExportInfo['kind']> = new Set([
  'class',
  'interface',
  'enum',
  'type',
]);

/** Whether `name` is an MSBuild manifest the C# layout reads. */
export function isMsbuildManifest(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    CSPROJ_NAME.test(name) ||
    lower === DIRECTORY_PROPS ||
    lower === DIRECTORY_TARGETS
  );
}

/** The MSBuild manifests found for the build's C# files. */
export interface CSharpProjects {
  /** Directories holding a `.csproj` (absolute, forward slashes). */
  readonly dirs: ReadonlySet<string>;
  /** Every manifest found, relative to the root, sorted. */
  readonly manifests: readonly string[];
  /** False when a listing failed or {@link MAX_PROJECT_LISTINGS} was reached. */
  readonly complete: boolean;
}

/**
 * List the directory of every C# file and each ancestor up to the root, at
 * most {@link MAX_PROJECT_LISTINGS}, for `.csproj`, `Directory.Build.props`
 * and `Directory.Build.targets` files. `undefined` when the build was
 * superseded meanwhile.
 */
export async function findCSharpProjects(
  csharpFiles: readonly string[],
  root: string,
  io: {
    readonly fileSystem: ManifestFileSystem;
    readonly isCurrent: () => boolean;
    readonly yieldBetweenReads?: () => Promise<void>;
  },
): Promise<CSharpProjects | undefined> {
  const toList = new Set<string>();
  for (const file of csharpFiles) {
    let dir = path.posix.dirname(file);
    while (!toList.has(dir) && isWithin(dir, root)) {
      toList.add(dir);
      const parent = path.posix.dirname(dir);
      if (parent === dir || dir === root) break;
      dir = parent;
    }
  }
  const dirs = new Set<string>();
  const manifests: string[] = [];
  let complete = toList.size <= MAX_PROJECT_LISTINGS;
  const ordered = [...toList].sort(byCodeUnit).slice(0, MAX_PROJECT_LISTINGS);
  for (const dir of ordered) {
    await io.yieldBetweenReads?.();
    if (!io.isCurrent()) return undefined;
    let names: string[];
    try {
      names = await io.fileSystem.readdir(dir);
    } catch {
      // An unlisted directory may hold a project file: its project and the
      // global usings it declares are then unknown (`complete: false`, the
      // `csharp-project-unknown` gap).
      complete = false;
      names = [];
    }
    if (!io.isCurrent()) return undefined;
    const found = names.filter(isMsbuildManifest).sort(byCodeUnit);
    if (found.some((name) => CSPROJ_NAME.test(name))) dirs.add(dir);
    const relative = dir === root ? '' : path.posix.relative(root, dir);
    for (const name of found) {
      manifests.push(relative === '' ? name : `${relative}/${name}`);
    }
  }
  return { dirs, manifests: manifests.sort(byCodeUnit), complete };
}

/** One `<Using Include="…">` item. */
export interface MsbuildUsing {
  readonly name: string;
  readonly isStatic: boolean;
  readonly alias?: string;
}

/** What the C# layout reads from one MSBuild manifest. */
export interface MsbuildItems {
  /** `PackageReference` / `GlobalPackageReference` ids. */
  readonly packages: readonly string[];
  readonly usings: readonly MsbuildUsing[];
  /** It has an `<Import Project="…">`, which is not followed. */
  readonly importsOther: boolean;
  /**
   * It has a `<Using Include>` value built from a property
   * (`$(RootNamespace).Models`), which is not evaluated: a global using is
   * in scope whose name is unknown.
   */
  readonly unevaluatedUsings: boolean;
}

/**
 * The items of an MSBuild manifest (comments removed; `;`-separated
 * `Include` lists split), or `undefined` when the text is not an MSBuild
 * project. A value built from a property (`$(Name)`) is not evaluated: as a
 * package id it proves nothing and is skipped; as a using it is reported in
 * `unevaluatedUsings`, since an import is in scope that nothing resolves.
 */
export function readMsbuildItems(text: string): MsbuildItems | undefined {
  const content = text.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<Project[\s>]/.test(content)) return undefined;
  const packages: string[] = [];
  for (const element of content.matchAll(
    /<(?:Global)?PackageReference\b([^>]*)>/g,
  )) {
    packages.push(...includes(element[1]).filter((id) => !id.includes('$(')));
  }
  const usings: MsbuildUsing[] = [];
  let unevaluatedUsings = false;
  for (const element of content.matchAll(/<Using\b([^>]*)>/g)) {
    const isStatic = /^true$/i.test(attribute(element[1], 'Static') ?? '');
    const alias = attribute(element[1], 'Alias')?.trim();
    for (const name of includes(element[1])) {
      if (name.includes('$(')) {
        unevaluatedUsings = true;
        continue;
      }
      usings.push({
        name,
        isStatic,
        ...(alias !== undefined && alias !== '' ? { alias } : {}),
      });
    }
  }
  return {
    packages,
    usings,
    importsOther: /<Import\b[^>]*\bProject\s*=/.test(content),
    unevaluatedUsings,
  };
}

/**
 * The layout of the build's C# files (see the module comment), and whether
 * which files a global using reaches had to be guessed.
 */
export function csharpLayout(
  sources: readonly ParsedSourceFacts[],
  projects: CSharpProjects,
  manifests: ReadonlyMap<string, MsbuildItems>,
  root: string,
): { layout: CSharpLayout; projectsGuessed: boolean } {
  const namespaceFiles = new Map<string, string[]>();
  const namespaces = new Set<string>();
  const typeFiles = new Map<string, string[]>();
  const projectOf = new Map<string, string>();
  const globalUsings = new Map<string, CSharpGlobalUsing[]>();
  const index = indexManifests(projects, manifests, root);
  /** Root-group keys, and the `global using` directives of root-group files. */
  const rootGroups = new Map<string, readonly string[]>();
  const rootFileUsings: CSharpGlobalUsing[] = [];
  let projectsGuessed = !projects.complete;
  for (const source of sources) {
    if (source.language !== 'csharp') continue;
    const declared = [
      ...new Set(
        (source.declarations ?? [])
          .filter((d) => d.kind === 'namespace' && d.name !== '')
          .map((d) => d.name),
      ),
    ];
    for (const name of declared) {
      push(namespaceFiles, name, source.path);
      let enclosing = name;
      while (!namespaces.has(enclosing)) {
        namespaces.add(enclosing);
        const dot = enclosing.lastIndexOf('.');
        if (dot < 0) break;
        enclosing = enclosing.slice(0, dot);
      }
    }
    // Declarations not extracted (absent, not empty): which namespace the
    // file's types are in is unknown, so they are filed nowhere (review
    // R34G-04). An empty list is the global namespace, which a lost
    // namespace also yields: edges through it carry the approximation.
    const typeNamespaces =
      source.declarations === undefined
        ? []
        : declared.length > 0
          ? declared
          : [''];
    for (const info of source.exports) {
      if (!TYPE_EXPORT_KINDS.has(info.kind)) continue;
      for (const name of typeNamespaces) {
        push(typeFiles, `${name}\u0000${info.name}`, source.path);
      }
    }
    const projectDir = projectDirOf(source.path, projects.dirs, root);
    let project = projectDir;
    if (projectDir === '') {
      // The root group (review R34G-01): the files no `.csproj` encloses,
      // keyed by the nearest `Directory.Build.*` manifests at or above
      // them, whose `<Using>` items reach them as they reach a project.
      const nearest = index.nearestDirectoryManifests(
        relativeDir(path.posix.dirname(source.path), root),
      );
      project = rootGroupKey(nearest);
      rootGroups.set(project, nearest);
    }
    projectOf.set(source.path, project);
    for (const imp of source.imports) {
      if (imp.kind !== 'global') continue;
      const using = { file: source.path, imp };
      if (projectDir === '') rootFileUsings.push(using);
      else push(globalUsings, project, using);
    }
  }
  for (const project of projects.dirs) {
    const own = relativeDir(project, root);
    const usings = [
      ...(index.byDir.get(own) ?? [])
        .filter((relative) => CSPROJ_NAME.test(relative))
        .flatMap(index.declaredBy),
      ...index.nearestDirectoryManifests(own).flatMap(index.declaredBy),
    ];
    for (const using of usings) push(globalUsings, project, using);
  }
  // A root-group file's `global using` reaches every root-group file (the
  // whole root stands in for its project); a manifest's reaches the files
  // below it. Either is a guess about project boundaries: disclosed.
  for (const [key, nearest] of rootGroups) {
    const usings = [...rootFileUsings, ...nearest.flatMap(index.declaredBy)];
    if (usings.length === 0) continue;
    projectsGuessed = true;
    globalUsings.set(key, usings);
  }
  const packages = new Set<string>();
  for (const items of manifests.values()) {
    for (const id of items.packages) packages.add(id);
  }
  return {
    layout: {
      namespaceFiles: sortedUnique(namespaceFiles),
      namespaces,
      typeFiles: sortedUnique(typeFiles),
      projectOf,
      globalUsings,
      packages,
    },
    projectsGuessed,
  };
}

/** The root-group key for the nearest `Directory.Build.*` manifests. */
function rootGroupKey(nearest: readonly string[]): string {
  return nearest.length === 0 ? '' : `\u0000${nearest.join('\u0000')}`;
}

/**
 * The manifests found, by directory, with one global-using list per
 * manifest: one import object per `<Using>` item, so the graph tallies an
 * item shared by several projects or root-group files once.
 */
function indexManifests(
  projects: CSharpProjects,
  manifests: ReadonlyMap<string, MsbuildItems>,
  root: string,
): {
  readonly byDir: ReadonlyMap<string, readonly string[]>;
  readonly declaredBy: (relative: string) => CSharpGlobalUsing[];
  /** The nearest `Directory.Build.props` and `.targets` at or above `dir`. */
  readonly nearestDirectoryManifests: (dir: string) => string[];
} {
  const usingsOf = new Map<string, CSharpGlobalUsing[]>();
  const declaredBy = (relative: string): CSharpGlobalUsing[] => {
    let usings = usingsOf.get(relative);
    if (usings === undefined) {
      const file = `${trimmedRoot(root)}/${relative}`;
      usings = (manifests.get(relative)?.usings ?? []).map((item) => ({
        file,
        fromManifest: true as const,
        imp: {
          source: item.name,
          kind: 'global' as const,
          scopePath: [],
          ...(item.isStatic ? { isStatic: true as const } : {}),
          ...(item.alias !== undefined ? { alias: item.alias } : {}),
        },
      }));
      usingsOf.set(relative, usings);
    }
    return usings;
  };
  const byDir = new Map<string, string[]>();
  for (const relative of projects.manifests) {
    const dir = path.posix.dirname(relative);
    push(byDir, dir === '.' ? '' : dir, relative);
  }
  const nearestDirectoryManifests = (dir: string): string[] =>
    [DIRECTORY_PROPS, DIRECTORY_TARGETS]
      .map((name) => nearestAbove(dir, name, byDir))
      .filter((found): found is string => found !== undefined);
  return { byDir, declaredBy, nearestDirectoryManifests };
}

/** The nearest manifest named `lowerName` in `dir` or an ancestor (root-relative). */
function nearestAbove(
  dir: string,
  lowerName: string,
  byDir: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  let current = dir;
  for (;;) {
    const found = (byDir.get(current) ?? []).find(
      (relative) => path.posix.basename(relative).toLowerCase() === lowerName,
    );
    if (found !== undefined) return found;
    if (current === '') return undefined;
    const parent = path.posix.dirname(current);
    current = parent === '.' ? '' : parent;
  }
}

/** The nearest ancestor directory of `file` holding a `.csproj`, or `''`. */
function projectDirOf(
  file: string,
  projectDirs: ReadonlySet<string>,
  root: string,
): string {
  let dir = path.posix.dirname(file);
  while (isWithin(dir, root)) {
    if (projectDirs.has(dir)) return dir;
    const parent = path.posix.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return '';
}

/** Values of the `Include` attribute, split on `;`. */
function includes(attributes: string): string[] {
  return (attribute(attributes, 'Include') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(
    attributes,
  );
  return match?.[1] ?? match?.[2];
}

function relativeDir(dir: string, root: string): string {
  return dir === root ? '' : path.posix.relative(root, dir);
}

function trimmedRoot(root: string): string {
  return root.endsWith('/') ? root.slice(0, -1) : root;
}

function isWithin(dir: string, root: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`;
  return dir === root || dir.startsWith(base);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const entry = map.get(key);
  if (entry) entry.push(value);
  else map.set(key, [value]);
}

function sortedUnique(
  map: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const sorted = new Map<string, readonly string[]>();
  for (const [key, files] of map) {
    sorted.set(key, [...new Set(files)].sort(byCodeUnit));
  }
  return sorted;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
