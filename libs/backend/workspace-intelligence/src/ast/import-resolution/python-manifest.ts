/**
 * What a root `pyproject.toml` says about Python module layout and declared
 * dependencies (TASK_2026_559 implementation-plan-languages.md, "Dependency
 * graphs", Python row). Text extraction only: the TOML is parsed here, never
 * executed, and nothing it names is run or imported.
 *
 * Read:
 * - source roots: `[tool.setuptools] package-dir` `""` entry,
 *   `[tool.setuptools.packages.find] where`, Poetry `packages` `from`;
 * - package directories: every other `package-dir` entry (`pkg = "lib/pkg"`),
 *   Hatch wheel `packages` paths (`"src/pkg"` → `pkg`);
 * - dependencies: `[project] dependencies` and `optional-dependencies`,
 *   `[dependency-groups]`, Poetry `dependencies`, `dev-dependencies` and
 *   group dependencies, by distribution name;
 * - local dependencies (review r1 R33-02), whose code is in the workspace
 *   and which are therefore never proof that an import is external: a
 *   Poetry or `[tool.uv.sources]` entry with a `path` (or uv
 *   `workspace = true`), and a PEP 508 direct reference to a `file:` URL.
 *
 * A document that is not TOML, or one of those entries with a shape TOML
 * allows but the entry does not, is `undefined`: the caller's
 * `manifest-unparseable` gap, never a guess.
 */
import * as path from 'path';

/** One package mapped to its own directory, relative to the manifest's. */
export interface PythonPackageDir {
  /** The dotted module name (`pkg`, `a.b`). */
  readonly module: string;
  /** Its directory, relative (forward slashes, no `..`). */
  readonly dir: string;
}

/** Layout and dependency facts of one `pyproject.toml`. */
export interface PyprojectFacts {
  /** Extra source roots, relative to the manifest's directory. */
  readonly sourceRoots: readonly string[];
  readonly packageDirs: readonly PythonPackageDir[];
  /**
   * Declared distribution names, normalised as {@link normalisePythonName}
   * does; compared with an import's first segment.
   */
  readonly dependencies: readonly string[];
  /** Local dependencies (see the module comment). */
  readonly localDependencies: readonly PythonLocalDependency[];
}

/** A dependency whose code is in the workspace. */
export interface PythonLocalDependency {
  /** Normalised distribution name. */
  readonly name: string;
  /**
   * Its directory relative to the manifest's, when the declaration names
   * one inside it; `undefined` when it does not (uv `workspace = true`, an
   * absolute or outside path).
   */
  readonly dir?: string;
}

/**
 * Lower-case, `-` and `.` runs as `_` (PEP 503 normalisation, with the
 * separator an import name can hold): `Flask-Login` → `flask_login`.
 */
export function normalisePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_');
}

/** The facts of a `pyproject.toml`, or `undefined` when it cannot be read. */
export function readPyproject(text: string): PyprojectFacts | undefined {
  let facts: PyprojectFacts | undefined;
  try {
    facts = extractFacts(parseToml(text));
  } catch {
    // Not TOML (or a form this reader does not take), or a read entry with
    // the wrong shape: the caller's `manifest-unparseable` gap.
    facts = undefined;
  }
  return facts;
}

function extractFacts(document: TomlTable): PyprojectFacts {
  const sourceRoots: string[] = [];
  const packageDirs: PythonPackageDir[] = [];
  const dependencies: string[] = [];
  const localDependencies: PythonLocalDependency[] = [];
  const addRequirement = (requirement: string): void =>
    readRequirement(requirement, dependencies, localDependencies);

  const setuptools = tableAt(document, ['tool', 'setuptools']);
  const packageDir = tableAt(setuptools, ['package-dir']);
  for (const [module, dir] of Object.entries(packageDir ?? {})) {
    const relative = relativeDir(asString(dir));
    if (relative === undefined) continue;
    if (module === '') sourceRoots.push(relative);
    else packageDirs.push({ module, dir: relative });
  }
  const packages = setuptools?.['packages'];
  if (isTable(packages)) {
    const where = tableAt(packages, ['find'])?.['where'];
    for (const dir of where === undefined ? [] : asStrings(where)) {
      const relative = relativeDir(dir);
      if (relative !== undefined) sourceRoots.push(relative);
    }
  } else if (packages !== undefined) {
    asStrings(packages); // listed names resolve through the roots
  }

  const poetry = tableAt(document, ['tool', 'poetry']);
  for (const entry of asArray(poetry?.['packages'] ?? [])) {
    if (!isTable(entry)) throw new Error('poetry package');
    const from = entry['from'];
    const relative = relativeDir(from === undefined ? '' : asString(from));
    if (relative !== undefined && relative !== '') sourceRoots.push(relative);
  }

  const wheel = tableAt(document, [
    'tool',
    'hatch',
    'build',
    'targets',
    'wheel',
  ]);
  for (const packagePath of asStrings(wheel?.['packages'] ?? [])) {
    const relative = relativeDir(packagePath);
    if (relative === undefined || relative === '') continue;
    packageDirs.push({ module: path.posix.basename(relative), dir: relative });
  }

  const project = tableAt(document, ['project']);
  for (const requirement of asStrings(project?.['dependencies'] ?? [])) {
    addRequirement(requirement);
  }
  const optional = tableAt(project, ['optional-dependencies']);
  for (const group of Object.values(optional ?? {})) {
    for (const requirement of asStrings(group)) {
      addRequirement(requirement);
    }
  }
  const groups = tableAt(document, ['dependency-groups']);
  for (const group of Object.values(groups ?? {})) {
    for (const entry of asArray(group)) {
      // `{ include-group = "x" }` names another group, not a distribution.
      if (!isTable(entry)) addRequirement(asString(entry));
    }
  }
  const poetryTables = [
    tableAt(poetry, ['dependencies']),
    tableAt(poetry, ['dev-dependencies']),
    ...Object.values(tableAt(poetry, ['group']) ?? {}).map((group) =>
      tableAt(asTable(group), ['dependencies']),
    ),
  ];
  for (const table of poetryTables) {
    for (const [name, spec] of Object.entries(table ?? {})) {
      if (name.toLowerCase() === 'python') continue;
      addSpecification(name, spec, dependencies, localDependencies);
    }
  }
  const uvSources = tableAt(document, ['tool', 'uv', 'sources']);
  for (const [name, spec] of Object.entries(uvSources ?? {})) {
    if (
      isTable(spec) &&
      (spec['path'] !== undefined || spec['workspace'] !== undefined)
    ) {
      addSpecification(name, spec, dependencies, localDependencies);
    }
  }
  const local = new Set(localDependencies.map((d) => d.name));
  return {
    sourceRoots,
    packageDirs,
    // A name declared local anywhere is never proof of externality.
    dependencies: dependencies.filter((name) => !local.has(name)),
    localDependencies,
  };
}

/**
 * A Poetry or uv dependency specification: a table with `path` (or uv
 * `workspace`) is local; anything else (a version, `git`, `url`) is not.
 */
function addSpecification(
  name: string,
  spec: TomlValue,
  dependencies: string[],
  localDependencies: PythonLocalDependency[],
): void {
  const normalised = normalisePythonName(name);
  if (isTable(spec) && spec['path'] !== undefined) {
    const dir = relativeDir(asString(spec['path']));
    localDependencies.push({
      name: normalised,
      ...(dir === undefined ? {} : { dir }),
    });
  } else if (isTable(spec) && spec['workspace'] !== undefined) {
    localDependencies.push({ name: normalised });
  } else {
    dependencies.push(normalised);
  }
}

/**
 * A PEP 508 requirement: its distribution name, local when it is a direct
 * reference to a `file:` URL or a path (`name @ file:///${PROJECT_ROOT}/libs/x`
 * is the manifest-relative `libs/x`; an absolute location has no directory
 * here).
 */
function readRequirement(
  requirement: string,
  dependencies: string[],
  localDependencies: PythonLocalDependency[],
): void {
  const match =
    /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:@\s*(\S+))?/.exec(
      requirement,
    );
  if (match === null) throw new Error('requirement');
  const name = normalisePythonName(match[1]);
  const url = match[2];
  // A remote URL (`git+https:`, `https:`) is code outside the workspace; a
  // `file:` URL or a bare path is local.
  if (
    url === undefined ||
    (!/^file:/i.test(url) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url))
  ) {
    dependencies.push(name);
    return;
  }
  const location = url
    .replace(/^file:(\/\/)?/i, '')
    .replace(/^\/?\$\{PROJECT_ROOT\}\/?/, './');
  const dir = location.startsWith('./') ? relativeDir(location) : undefined;
  localDependencies.push({ name, ...(dir === undefined ? {} : { dir }) });
}

/**
 * A directory relative to the manifest's (`''` for itself), or `undefined`
 * for one outside it: an absolute path or one that climbs out.
 */
function relativeDir(dir: string): string | undefined {
  const forward = dir.replace(/\\/g, '/');
  if (forward.startsWith('/') || /^[A-Za-z]:/.test(forward)) return undefined;
  const normalised = path.posix.normalize(forward).replace(/\/+$/, '');
  if (normalised === '..' || normalised.startsWith('../')) return undefined;
  return normalised === '.' ? '' : normalised;
}

// ---------------------------------------------------------------------------
// TOML subset reader. Values that are neither strings, arrays nor tables
// (numbers, booleans, dates) are kept as `null`: no read entry uses one.
// ---------------------------------------------------------------------------

type TomlValue = string | null | TomlValue[] | TomlTable;
interface TomlTable {
  [key: string]: TomlValue;
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asTable(value: TomlValue): TomlTable {
  if (!isTable(value)) throw new Error('table');
  return value;
}

function asString(value: TomlValue): string {
  if (typeof value !== 'string') throw new Error('string');
  return value;
}

function asArray(value: TomlValue): TomlValue[] {
  if (!Array.isArray(value)) throw new Error('array');
  return value;
}

function asStrings(value: TomlValue): string[] {
  return asArray(value).map(asString);
}

/** The table at `keys` under `table`; `undefined` when absent; throws on a non-table. */
function tableAt(
  table: TomlTable | undefined,
  keys: readonly string[],
): TomlTable | undefined {
  let current: TomlTable | undefined = table;
  for (const key of keys) {
    if (current === undefined || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = asTable(current[key]);
  }
  return current;
}

/** Parse a TOML document; throws on anything it cannot read. */
function parseToml(text: string): TomlTable {
  return new TomlParser(text).document();
}

class TomlParser {
  private i = 0;
  private readonly root: TomlTable = {};

  constructor(private readonly text: string) {}

  document(): TomlTable {
    let current = this.root;
    for (;;) {
      this.skipBlank(true);
      if (this.i >= this.text.length) return this.root;
      if (this.text.startsWith('[[', this.i)) {
        this.i += 2;
        const keys = this.key();
        this.expect(']]');
        const parent = this.tableFor(keys.slice(0, -1));
        const last = keys[keys.length - 1];
        const list = Object.hasOwn(parent, last) ? parent[last] : [];
        if (!Array.isArray(list)) throw new Error('array of tables');
        current = {};
        list.push(current);
        parent[last] = list;
      } else if (this.text[this.i] === '[') {
        this.i++;
        current = this.tableFor(this.key());
        this.expect(']');
      } else {
        const keys = this.key();
        this.expect('=');
        this.assign(current, keys, this.value());
      }
      this.endOfLine();
    }
  }

  /** The table at `keys` from the root, created on the way; a key naming an array of tables goes to its last table. */
  private tableFor(keys: readonly string[]): TomlTable {
    let table = this.root;
    for (const key of keys) {
      if (!Object.hasOwn(table, key)) table[key] = {};
      let next = table[key];
      if (Array.isArray(next)) next = next[next.length - 1];
      table = asTable(next);
    }
    return table;
  }

  private assign(table: TomlTable, keys: readonly string[], value: TomlValue) {
    let target = table;
    for (const key of keys.slice(0, -1)) {
      if (!Object.hasOwn(target, key)) target[key] = {};
      target = asTable(target[key]);
    }
    const last = keys[keys.length - 1];
    if (Object.hasOwn(target, last)) throw new Error('duplicate key');
    target[last] = value;
  }

  /** A dotted key: bare, `"basic"` or `'literal'` parts. */
  private key(): string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipBlank(false);
      const char = this.text[this.i];
      if (char === '"') keys.push(this.basicString());
      else if (char === "'") keys.push(this.literalString());
      else {
        const bare = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.i))?.[0];
        if (bare === undefined) throw new Error('key');
        keys.push(bare);
        this.i += bare.length;
      }
      this.skipBlank(false);
      if (this.text[this.i] !== '.') return keys;
      this.i++;
    }
  }

  private value(): TomlValue {
    this.skipBlank(false);
    const rest = this.text.slice(this.i, this.i + 3);
    if (rest === '"""') return this.multilineString('"""');
    if (rest === "'''") return this.multilineString("'''");
    const char = this.text[this.i];
    if (char === '"') return this.basicString();
    if (char === "'") return this.literalString();
    if (char === '[') return this.array();
    if (char === '{') return this.inlineTable();
    const scalar = /^[^\s,\]}#]+/.exec(this.text.slice(this.i))?.[0];
    if (scalar === undefined) throw new Error('value');
    this.i += scalar.length;
    // A date-time may hold one space (`1979-05-27 07:32:00`).
    const time = /^ \d{2}:\d{2}[^\s,\]}#]*/.exec(this.text.slice(this.i));
    if (time && /^\d{4}-\d{2}-\d{2}$/.test(scalar)) this.i += time[0].length;
    return null;
  }

  private array(): TomlValue[] {
    this.i++; // [
    const items: TomlValue[] = [];
    for (;;) {
      this.skipBlank(true);
      if (this.text[this.i] === ']') {
        this.i++;
        return items;
      }
      items.push(this.value());
      this.skipBlank(true);
      if (this.text[this.i] === ',') this.i++;
      else if (this.text[this.i] !== ']') throw new Error('array');
    }
  }

  private inlineTable(): TomlTable {
    this.i++; // {
    const table: TomlTable = {};
    for (;;) {
      this.skipBlank(true);
      if (this.text[this.i] === '}') {
        this.i++;
        return table;
      }
      const keys = this.key();
      this.expect('=');
      this.assign(table, keys, this.value());
      this.skipBlank(true);
      if (this.text[this.i] === ',') this.i++;
      else if (this.text[this.i] !== '}') throw new Error('inline table');
    }
  }

  private basicString(): string {
    this.i++; // "
    let result = '';
    for (;;) {
      const char = this.text[this.i];
      if (char === undefined || char === '\n') throw new Error('string');
      this.i++;
      if (char === '"') return result;
      result += char === '\\' ? this.escape() : char;
    }
  }

  private literalString(): string {
    const close = this.text.indexOf("'", this.i + 1);
    const newline = this.text.indexOf('\n', this.i + 1);
    if (close === -1 || (newline !== -1 && newline < close)) {
      throw new Error('string');
    }
    const result = this.text.slice(this.i + 1, close);
    this.i = close + 1;
    return result;
  }

  private multilineString(quote: '"""' | "'''"): string {
    this.i += 3;
    if (this.text[this.i] === '\r') this.i++;
    if (this.text[this.i] === '\n') this.i++;
    let result = '';
    for (;;) {
      if (this.i >= this.text.length) throw new Error('string');
      if (this.text.startsWith(quote, this.i)) {
        // Up to two quotes may close the content itself (`""""`).
        let end = this.i + 3;
        while (end < this.i + 5 && this.text[end] === quote[0]) end++;
        result += this.text.slice(this.i, end - 3);
        this.i = end;
        return result;
      }
      const char = this.text[this.i++];
      if (quote === '"""' && char === '\\') {
        if (/^[ \t]*\r?\n/.test(this.text.slice(this.i))) {
          // A line-ending backslash trims the following whitespace.
          while (/\s/.test(this.text[this.i] ?? '')) this.i++;
        } else {
          result += this.escape();
        }
      } else {
        result += char;
      }
    }
  }

  private escape(): string {
    const char = this.text[this.i++];
    const simple: Record<string, string> = {
      b: '\b',
      t: '\t',
      n: '\n',
      f: '\f',
      r: '\r',
      e: '\u001b',
      '"': '"',
      '\\': '\\',
    };
    if (char !== undefined && Object.hasOwn(simple, char)) return simple[char];
    const width = char === 'u' ? 4 : char === 'U' ? 8 : char === 'x' ? 2 : 0;
    const hex = this.text.slice(this.i, this.i + width);
    if (width === 0 || !/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== width) {
      throw new Error('escape');
    }
    this.i += width;
    return String.fromCodePoint(parseInt(hex, 16));
  }

  private expect(token: string): void {
    this.skipBlank(false);
    if (!this.text.startsWith(token, this.i)) throw new Error(token);
    this.i += token.length;
  }

  private endOfLine(): void {
    this.skipBlank(false);
    const char = this.text[this.i];
    if (char === undefined) return;
    if (char === '\n') {
      this.i++;
      return;
    }
    if (char === '\r' && this.text[this.i + 1] === '\n') {
      this.i += 2;
      return;
    }
    throw new Error('end of line');
  }

  /** Spaces, tabs and comments; newlines too when `newlines`. */
  private skipBlank(newlines: boolean): void {
    while (this.i < this.text.length) {
      const char = this.text[this.i];
      if (char === ' ' || char === '\t') this.i++;
      else if (newlines && (char === '\n' || char === '\r')) this.i++;
      else if (char === '#') {
        while (this.i < this.text.length && this.text[this.i] !== '\n') {
          this.i++;
        }
      } else return;
    }
  }
}
