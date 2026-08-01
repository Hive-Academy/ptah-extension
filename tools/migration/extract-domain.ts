#!/usr/bin/env npx ts-node
/**
 * Manifest-driven domain extractor.
 *
 * Moves a slice of an app into a scoped Nx lib: scaffolds the lib with the real
 * Nx generator, moves the files with ts-morph, rewrites imports in BOTH
 * directions (app -> lib alias, lib -> other lib alias) and generates the barrel.
 *
 * Usage:
 *   npx ts-node --transpile-only tools/migration/extract-domain.ts --domain=web-core [--dry-run]
 *   npx nx run migration:extract --domain=web-core
 *   npx nx run migration:extract-dry-run --domain=web-core
 *
 * Hard failures (by design — they enforce extraction order and membership closure):
 *   - the domain is a skeleton (empty `sources`)
 *   - a domain in the `dependsOn` chain has not been extracted yet
 *   - a moved file imports the app's `environments/` (needs an injection token first)
 *   - a moved file relatively imports a file that no extracted domain owns
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Node, Project, SourceFile, StringLiteral, SyntaxKind } from 'ts-morph';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const TSCONFIG_BASE = path.join(REPO_ROOT, 'tsconfig.base.json');

type Platform = 'web' | 'api';

interface SourceEntry {
  glob: string;
  to?: string;
  /**
   * Move these files at the filesystem level WITHOUT loading them into
   * ts-morph.
   *
   * For generated code (a Prisma client is ~900 KB of machine-written
   * TypeScript): parsing it wastes minutes and can exhaust memory, and its
   * imports must never be rewritten — the generator owns them and would undo
   * any edit on the next run. Imports *pointing at* raw files are still
   * rewritten normally, via a redirect registered for the old path.
   */
  raw?: boolean;
  /**
   * Land these files in `<lib>/src/<entryPoint>/` behind their own barrel and
   * their own `<importPath>/<entryPoint>` alias, instead of `<lib>/src/lib/`.
   *
   * This is how the workspace already ships test helpers (`libs/shared/src/testing`
   * + `@ptah-extension/shared/testing`): `tsconfig.lib.json` excludes the
   * directory, so jest-typed helpers never enter the production compile and
   * their dev-only imports (`@nestjs/testing`) can never reach the app bundle's
   * generated package.json.
   */
  entryPoint?: string;
}

interface Domain {
  name: string;
  lib: string;
  importPath: string;
  platform: Platform;
  tags: string;
  app: string;
  sources: Array<string | SourceEntry>;
  dependsOn: string[];
  /**
   * Angular selector prefixes the lib's eslint config must accept. Defaults to
   * `["app"]` (what the generator writes). Set it to whatever the source app
   * allows, or every moved component trips @angular-eslint/component-selector.
   */
  selectorPrefixes?: string[];
  /**
   * Globs (relative to `<lib>/src/lib`) selecting which moved files the barrel
   * re-exports. Defaults to all of them.
   *
   * Narrow this when the lib is consumed through ONE symbol behind a dynamic
   * import: `import('@ptah-web/admin').then(m => m.ADMIN_ROUTES)` makes the
   * bundler materialise the whole namespace object, so an `export *` barrel
   * pulls every component into that chunk and collapses the feature's own
   * `loadComponent` sub-chunks.
   */
  publicApi?: string[];
}

interface Manifest {
  domains: Domain[];
}

interface PlannedMove {
  from: string;
  to: string;
}

/** A non-TS file a moved component depends on (external template / stylesheet). */
interface PlannedAssetMove {
  from: string;
  to: string;
  /** The component file that references it, for error messages. */
  via: string;
}

interface PlannedRewrite {
  file: string;
  from: string;
  to: string;
}

interface Violation {
  file: string;
  specifier: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const posix = (p: string): string => p.replace(/\\/g, '/');
const abs = (workspaceRelative: string): string =>
  path.resolve(REPO_ROOT, workspaceRelative);
const rel = (absolutePath: string): string =>
  posix(path.relative(REPO_ROOT, absolutePath));

function die(message: string, details: string[] = []): never {
  console.error(`\n[extract-domain] FAILED: ${message}`);
  for (const line of details) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}

function isSpecFile(filePath: string): boolean {
  return /\.(spec|test)\.tsx?$/.test(filePath);
}

const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * Static (magic-free) prefix of a glob.
 * `src/app/pages/legal/**` + `/*.ts` -> `src/app/pages/legal`
 * `src/app/services/auth.service.ts` -> `src/app/services`
 */
function globStaticBase(glob: string): string {
  const parts = posix(glob).split('/');
  const magic = parts.findIndex((segment) => GLOB_MAGIC.test(segment));
  const kept = magic === -1 ? parts.slice(0, -1) : parts.slice(0, magic);
  return kept.join('/');
}

const REGEXP_SPECIALS = new Set([
  '.',
  '+',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\',
]);

/** Minimal glob -> RegExp (supports `*` and `**`, which is all the manifest uses). */
function globToRegExp(glob: string): RegExp {
  const input = posix(glob);
  let body = '';
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === '*') {
      if (input[index + 1] === '*') {
        if (input[index + 2] === '/') {
          body += '(?:.*/)?';
          index += 3;
        } else {
          body += '.*';
          index += 2;
        }
      } else {
        body += '[^/]*';
        index += 1;
      }
      continue;
    }
    body += REGEXP_SPECIALS.has(char) ? `\\${char}` : char;
    index += 1;
  }

  return new RegExp(`^${body}$`);
}

function normalizeSource(entry: string | SourceEntry): SourceEntry {
  return typeof entry === 'string' ? { glob: entry } : entry;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  touchedForFormatting.add(filePath);
}

/**
 * Files this run rewrote that Prettier owns. `JSON.stringify(…, 2)` explodes
 * every short array onto its own line, which turns a two-line alias addition in
 * tsconfig.base.json into a 200-line diff. Reformatting once at the end keeps
 * the diff to what actually changed.
 */
const touchedForFormatting = new Set<string>();

function formatTouchedFiles(): void {
  if (touchedForFormatting.size === 0) return;

  const files = [...touchedForFormatting].filter((file) => fs.existsSync(file));
  if (files.length === 0) return;

  const result = spawnSync(
    'npx',
    ['prettier', '--write', ...files.map((file) => `"${rel(file)}"`)],
    { cwd: REPO_ROOT, stdio: 'ignore', shell: true },
  );
  if (result.status !== 0) {
    console.warn(
      '\n[extract-domain] WARNING: prettier failed on the files this run wrote.',
    );
    console.warn('  Run `npx prettier --write` on them before committing.');
  }
}

// ---------------------------------------------------------------------------
// manifest + ordering
// ---------------------------------------------------------------------------

function loadManifest(): Manifest {
  try {
    return readJson<Manifest>(MANIFEST_PATH);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return die(`could not read ${rel(MANIFEST_PATH)}: ${reason}`);
  }
}

/** Heuristic used everywhere: a domain is "extracted" once its lib barrel exists. */
function isExtracted(domain: Domain): boolean {
  return fs.existsSync(path.join(abs(domain.lib), 'src', 'index.ts'));
}

function assertDependenciesExtracted(
  domain: Domain,
  byName: Map<string, Domain>,
): void {
  const missing: string[] = [];
  const seen = new Set<string>([domain.name]);
  const queue = [...domain.dependsOn];

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);

    const dependency = byName.get(name);
    if (!dependency) {
      die(`domain "${domain.name}" dependsOn unknown domain "${name}"`);
    }
    if (!isExtracted(dependency)) {
      const barrel = rel(path.join(abs(dependency.lib), 'src', 'index.ts'));
      missing.push(`${dependency.name} (expected ${barrel})`);
    }
    queue.push(...dependency.dependsOn);
  }

  if (missing.length > 0) {
    die(
      `domain "${domain.name}" cannot be extracted yet — its dependsOn chain is not extracted`,
      [
        'Extract these first, in manifest order:',
        ...missing.map((entry) => `- ${entry}`),
        '',
        `Then re-run: npx nx run migration:extract --domain=${domain.name}`,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// scaffolding
// ---------------------------------------------------------------------------

function generatorArgs(domain: Domain): string[] {
  if (domain.platform === 'web') {
    return [
      'nx',
      'g',
      '@nx/angular:library',
      domain.lib,
      `--name=${domain.name}`,
      `--importPath=${domain.importPath}`,
      `--tags=${domain.tags}`,
      '--prefix=app',
      '--unitTestRunner=jest',
      '--linter=eslint',
      '--style=css',
      '--no-interactive',
    ];
  }
  return [
    'nx',
    'g',
    '@nx/js:library',
    domain.lib,
    `--name=${domain.name}`,
    `--importPath=${domain.importPath}`,
    `--tags=${domain.tags}`,
    '--bundler=none',
    '--unitTestRunner=jest',
    '--linter=eslint',
    '--no-interactive',
  ];
}

function scaffoldLib(domain: Domain, dryRun: boolean): void {
  const args = generatorArgs(domain);
  if (dryRun) args.push('--dry-run');

  console.log(`\n[extract-domain] scaffolding ${domain.lib} via Nx generator`);
  console.log(`  npx ${args.join(' ')}`);

  const result = spawnSync('npx', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    die(`Nx generator failed for ${domain.lib} (exit code ${result.status})`);
  }
  if (dryRun) return;

  // Both generators emit a sample component/service under src/lib. The lib is
  // brand new at this point, so purging src/lib wholesale is safe and
  // guarantees no placeholder junk survives into git status.
  const libSrcLib = path.join(abs(domain.lib), 'src', 'lib');
  fs.rmSync(libSrcLib, { recursive: true, force: true });
  fs.mkdirSync(libSrcLib, { recursive: true });
  fs.writeFileSync(path.join(abs(domain.lib), 'src', 'index.ts'), '', 'utf8');

  ensureTypecheckTarget(domain);
  ensureApiCompilerOptions(domain);
}

/**
 * NestJS DI is decorator-metadata driven, but `tsconfig.base.json` sets
 * `emitDecoratorMetadata: false` workspace-wide and `@nx/js:library` does not
 * override it. Without this, every `@Injectable()` moved into a libs/api/* lib
 * loses its constructor param types and Nest fails to resolve dependencies at
 * runtime.
 *
 * Mirrors apps/ptah-license-server/tsconfig{,.app}.json.
 */
function ensureApiCompilerOptions(domain: Domain): void {
  if (domain.platform !== 'api') return;

  const required: Record<string, unknown> = {
    module: 'commonjs',
    moduleResolution: 'node',
    target: 'es2021',
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    strict: true,
    strictNullChecks: true,
    noImplicitAny: true,
    strictBindCallApply: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    noPropertyAccessFromIndexSignature: true,
    forceConsistentCasingInFileNames: true,
    importHelpers: true,
  };

  for (const fileName of ['tsconfig.json', 'tsconfig.lib.json']) {
    const tsconfigPath = path.join(abs(domain.lib), fileName);
    if (!fs.existsSync(tsconfigPath)) continue;

    const tsconfig = readJson<{
      compilerOptions?: Record<string, unknown>;
      [key: string]: unknown;
    }>(tsconfigPath);
    tsconfig.compilerOptions = { ...required, ...tsconfig.compilerOptions };
    // The generator's own values win for anything it deliberately set, EXCEPT
    // the two decorator flags — those are non-negotiable for NestJS.
    tsconfig.compilerOptions['experimentalDecorators'] = true;
    tsconfig.compilerOptions['emitDecoratorMetadata'] = true;
    writeJson(tsconfigPath, tsconfig);
  }
}

/**
 * Every lib in this workspace ships a package.json carrying
 * `"sideEffects": false` — without it the bundler cannot tree-shake the
 * `export *` barrel, so importing one guard from the barrel drags every other
 * module (and its npm deps: zod, @paddle/paddle-js, ...) into the eager graph
 * and blows the app's initial-bundle budget. This is load-bearing, not cosmetic.
 */
function ensureLibPackageJson(domain: Domain): void {
  const packageJsonPath = path.join(abs(domain.lib), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const existing = readJson<{ sideEffects?: unknown }>(packageJsonPath);
    if (existing.sideEffects === false) return;
    existing.sideEffects = false;
    writeJson(packageJsonPath, existing);
    return;
  }

  writeJson(packageJsonPath, {
    name: domain.importPath,
    version: '0.0.1',
    private: true,
    sideEffects: false,
  });
}

/**
 * Rewrite the generated web lib's eslint config so moved code lints under the
 * SAME rules it was written against.
 *
 * The generator wires a new lib to the root config plus
 * `nx.configs['flat/angular-template']` defaults, and hard-codes one selector
 * prefix. The landing app deliberately relaxes several of those template rules
 * (`click-events-have-key-events`, `interactive-supports-focus`, ...) and
 * accepts two prefixes. Without this, extraction silently tightens lint and
 * previously-clean templates start failing.
 *
 * The shared posture lives in `eslint.angular.config.mjs` at the WORKSPACE ROOT,
 * not in the app: importing an eslint config from another *project* registers a
 * real Nx dependency edge and trips `enforce-module-boundaries` circular-
 * dependency detection (lib -> app -> lib). Root files belong to no project.
 *
 * Idempotent — the file is generated, so it is written wholesale.
 */
function alignEslintConfig(domain: Domain): void {
  if (domain.platform !== 'web') return;

  const eslintPath = path.join(abs(domain.lib), 'eslint.config.mjs');
  if (!fs.existsSync(eslintPath)) return;

  const sharedAngularConfig = path.join(REPO_ROOT, 'eslint.angular.config.mjs');
  if (!fs.existsSync(sharedAngularConfig)) return;

  const toRoot = (fileName: string): string => {
    const target = posix(
      path.relative(abs(domain.lib), path.join(REPO_ROOT, fileName)),
    );
    return target.startsWith('.') ? target : `./${target}`;
  };

  const prefixes = domain.selectorPrefixes ?? ['app'];
  const prefixLiteral =
    prefixes.length === 1
      ? `'${prefixes[0]}'`
      : `[${prefixes.map((prefix) => `'${prefix}'`).join(', ')}]`;

  const contents = `import nx from '@nx/eslint-plugin';
import baseConfig from '${toRoot('eslint.config.mjs')}';
import angularConfig from '${toRoot('eslint.angular.config.mjs')}';

// Generated by tools/migration/extract-domain.ts.
// \`angularConfig\` is the same Angular rule posture ${domain.app} lints under,
// so moving a file into this lib does not change how it is linted.
export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...angularConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: ${prefixLiteral}, style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ${prefixLiteral}, style: 'kebab-case' },
      ],
    },
  },
];
`;

  if (fs.readFileSync(eslintPath, 'utf8') !== contents) {
    fs.writeFileSync(eslintPath, contents, 'utf8');
  }
}

/** Repo convention: every lib exposes a `typecheck` target. */
function ensureTypecheckTarget(domain: Domain): void {
  const projectJsonPath = path.join(abs(domain.lib), 'project.json');
  if (!fs.existsSync(projectJsonPath)) return;

  const project = readJson<{
    targets?: Record<string, unknown>;
    [key: string]: unknown;
  }>(projectJsonPath);
  project.targets = project.targets ?? {};
  if (project.targets['typecheck']) return;

  const compiler = domain.platform === 'web' ? 'npx ngc' : 'npx tsc';
  project.targets['typecheck'] = {
    executor: 'nx:run-commands',
    options: {
      command: `${compiler} --noEmit --project ${domain.lib}/tsconfig.lib.json`,
    },
  };
  writeJson(projectJsonPath, project);
}

/**
 * tsconfig.base.json has no `baseUrl`, so every `paths` value must be relative
 * (`./libs/...`) or tsc bails out with TS5090. The Nx generator writes the
 * non-relative form, so normalising here is mandatory, not cosmetic.
 *
 * The generator also sets `baseUrl: "."` on the base tsconfig when it inserts
 * an alias. That must be stripped: children (e.g. apps/ptah-electron) inherit
 * baseUrl without redeclaring it, and esbuild resolves an inherited baseUrl
 * against the tsconfig it was handed — not the file that declared it — so
 * every `./libs/...` alias breaks in esbuild bundles while tsc stays green.
 */
/**
 * Keep a secondary entry point out of the lib's PRODUCTION compile, mirroring
 * `libs/shared/tsconfig.lib.json` excluding `src/testing/**`. Test helpers use
 * jest globals and dev-only deps; compiling them as part of the lib would force
 * `"jest"` into the production `types` array and can leak dev packages into a
 * consumer's generated package.json.
 */
function excludeEntryPointsFromLibBuild(
  domain: Domain,
  entryPoints: string[],
): void {
  const tsconfigPath = path.join(abs(domain.lib), 'tsconfig.lib.json');
  if (!fs.existsSync(tsconfigPath)) return;

  const tsconfig = readJson<{
    exclude?: string[];
    [key: string]: unknown;
  }>(tsconfigPath);
  const exclude = tsconfig.exclude ?? [];

  let changed = false;
  for (const entryPoint of entryPoints) {
    const pattern = `src/${entryPoint}/**/*`;
    if (!exclude.includes(pattern)) {
      exclude.push(pattern);
      changed = true;
    }
  }
  if (!changed) return;

  tsconfig.exclude = exclude;
  writeJson(tsconfigPath, tsconfig);
}

function ensureTsconfigAlias(
  domain: Domain,
  entryPoints: string[] = [],
): 'present' | 'added' | 'normalized' {
  const tsconfig = readJson<{
    compilerOptions: { baseUrl?: string; paths: Record<string, string[]> };
  }>(TSCONFIG_BASE);
  const paths = tsconfig.compilerOptions.paths;

  const hadBaseUrl = tsconfig.compilerOptions.baseUrl !== undefined;
  if (hadBaseUrl) delete tsconfig.compilerOptions.baseUrl;

  // The lib's own alias, plus one per secondary entry point.
  const wanted = new Map<string, string>([
    [domain.importPath, `./${domain.lib}/src/index.ts`],
    ...entryPoints.map((entryPoint): [string, string] => [
      `${domain.importPath}/${entryPoint}`,
      `./${domain.lib}/src/${entryPoint}/index.ts`,
    ]),
  ]);

  let added = false;
  let corrected = false;
  for (const [alias, expected] of wanted) {
    const existing = paths[alias];
    if (
      existing !== undefined &&
      existing.length === 1 &&
      existing[0] === expected
    ) {
      continue;
    }
    if (existing === undefined) added = true;
    else corrected = true;
    paths[alias] = [expected];
  }

  if (!added && !corrected && !hadBaseUrl) return 'present';

  writeJson(TSCONFIG_BASE, tsconfig);
  return added ? 'added' : 'normalized';
}

// ---------------------------------------------------------------------------
// module specifier plumbing
// ---------------------------------------------------------------------------

/** All module specifier literals: static imports, re-exports and dynamic imports. */
function moduleSpecifiers(sourceFile: SourceFile): StringLiteral[] {
  const literals: StringLiteral[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    literals.push(declaration.getModuleSpecifier());
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifier();
    if (specifier) literals.push(specifier);
  }
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [firstArgument] = call.getArguments();
    if (firstArgument && firstArgument.getKind() === SyntaxKind.StringLiteral) {
      literals.push(firstArgument as StringLiteral);
    }
  }

  return literals;
}

/**
 * Resolve a relative specifier against the project's *virtual* file set (moved
 * files do not exist on disk until save()), falling back to the real fs.
 */
function resolveSpecifier(
  project: Project,
  fromFile: string,
  specifier: string,
  /**
   * Old path -> new path for files moved raw. They are absent from ts-morph and
   * still on disk at their old location during this phase, so without the
   * redirect an import of a raw-moved file resolves to the app and looks like a
   * closure violation.
   */
  rawRedirects: ReadonlyMap<string, string> = new Map(),
): string | null {
  if (!specifier.startsWith('.')) return null;

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates: string[] = [];
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
  candidates.push(
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    path.join(base, 'index.ts'),
    base,
  );

  for (const candidate of candidates) {
    const redirected = rawRedirects.get(posix(candidate));
    if (redirected) return redirected;
  }
  for (const candidate of candidates) {
    if (project.getSourceFile(posix(candidate))) return posix(candidate);
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return posix(candidate);
    }
  }
  return null;
}

/** Recursively list every file under `dir`, as posix absolute paths. */
function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(child));
    else found.push(posix(child));
  }
  return found;
}

function topLevelExportNames(sourceFile: SourceFile): string[] {
  const names: string[] = [];
  const push = (name: string | undefined): void => {
    if (name) names.push(name);
  };

  for (const node of sourceFile.getClasses()) {
    if (node.isExported()) push(node.getName());
  }
  for (const node of sourceFile.getFunctions()) {
    if (node.isExported()) push(node.getName());
  }
  for (const node of sourceFile.getInterfaces()) {
    if (node.isExported()) push(node.getName());
  }
  for (const node of sourceFile.getTypeAliases()) {
    if (node.isExported()) push(node.getName());
  }
  for (const node of sourceFile.getEnums()) {
    if (node.isExported()) push(node.getName());
  }
  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      push(declaration.getName());
    }
  }

  return names;
}

/**
 * Relative `templateUrl` / `styleUrl` / `styleUrls` values on a file's
 * `@Component` decorators.
 *
 * ts-morph only knows about TypeScript, so a component with an external
 * template would move on its own and leave its .html/.css behind — the build
 * then fails on a missing resource. These have to travel with the class.
 */
function componentAssetSpecifiers(sourceFile: SourceFile): string[] {
  const specifiers: string[] = [];

  for (const declaration of sourceFile.getClasses()) {
    for (const decorator of declaration.getDecorators()) {
      if (decorator.getName() !== 'Component') continue;

      const [argument] = decorator.getArguments();
      if (!argument || !Node.isObjectLiteralExpression(argument)) continue;

      for (const property of argument.getProperties()) {
        if (!Node.isPropertyAssignment(property)) continue;
        const name = property.getName();
        if (!['templateUrl', 'styleUrl', 'styleUrls'].includes(name)) continue;

        const initializer = property.getInitializer();
        if (Node.isStringLiteral(initializer)) {
          specifiers.push(initializer.getLiteralValue());
        } else if (Node.isArrayLiteralExpression(initializer)) {
          for (const element of initializer.getElements()) {
            if (Node.isStringLiteral(element)) {
              specifiers.push(element.getLiteralValue());
            }
          }
        }
      }
    }
  }

  return specifiers;
}

/**
 * Is this lib file part of the domain's declared public API? With no
 * `publicApi` in the manifest, everything is.
 */
function inPublicApi(
  domain: Domain,
  libRoot: string,
  filePath: string,
): boolean {
  if (domain.publicApi === undefined) return true;

  const libRelative = posix(
    path.relative(path.join(libRoot, 'src', 'lib'), filePath),
  );
  if (libRelative.startsWith('..')) return false;

  return domain.publicApi.some((glob) =>
    globToRegExp(posix(glob).replace(/^\.\//, '')).test(libRelative),
  );
}

/**
 * Drop barrel lines that a (newly narrowed) `publicApi` no longer covers, so
 * re-running a domain reconciles its public surface instead of only appending.
 */
function reconcileBarrel(domain: Domain, libRoot: string): number {
  if (domain.publicApi === undefined) return 0;

  const barrelPath = path.join(libRoot, 'src', 'index.ts');
  if (!fs.existsSync(barrelPath)) return 0;

  const lines = fs
    .readFileSync(barrelPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const kept = lines.filter((line) => {
    const match = /^export \* from '\.\/(.+)';$/.exec(line);
    if (!match) return true; // hand-written line, leave it alone

    const target = path.join(libRoot, 'src', `${match[1]}.ts`);
    return inPublicApi(domain, libRoot, posix(target));
  });

  if (kept.length === lines.length) return 0;

  fs.writeFileSync(barrelPath, `${kept.join('\n')}\n`, 'utf8');
  touchedForFormatting.add(barrelPath);
  return lines.length - kept.length;
}

/** Does `destination` (a file, or a directory holding .ts files) already exist? */
function destinationHasFiles(destination: string): boolean {
  if (!fs.existsSync(destination)) return false;
  if (fs.statSync(destination).isFile()) return true;

  const walk = (dir: string): boolean =>
    fs.readdirSync(dir, { withFileTypes: true }).some((entry) => {
      const child = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(child) : entry.name.endsWith('.ts');
    });

  return walk(destination);
}

/**
 * Delete directories the move emptied out, walking up to (but never past)
 * `stopAt`. Git does not track empty directories, but leaving them behind
 * confuses `git status` on Windows and hides the fact that a slice is gone.
 */
function pruneEmptyDirs(startDirs: string[], stopAt: string): void {
  const boundary = path.resolve(stopAt);

  for (const startDir of new Set(startDirs)) {
    let current = path.resolve(startDir);
    while (current.startsWith(boundary) && current !== boundary) {
      if (!fs.existsSync(current)) {
        current = path.dirname(current);
        continue;
      }
      if (fs.readdirSync(current).length > 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    }
  }
}

function projectNameOfApp(domain: Domain): string {
  const projectJsonPath = path.join(abs(domain.app), 'project.json');
  if (!fs.existsSync(projectJsonPath)) return path.basename(domain.app);
  try {
    const project = readJson<{ name?: string }>(projectJsonPath);
    return project.name ?? path.basename(domain.app);
  } catch (error: unknown) {
    return path.basename(domain.app);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { domain: string | null; dryRun: boolean } {
  let domain: string | null = null;
  let dryRun = false;
  for (const arg of argv) {
    const match = /^--domain=(.+)$/.exec(arg);
    if (match && domain === null) domain = match[1].trim();
    if (arg === '--dry-run' || arg === '--dryRun') dryRun = true;
  }
  return { domain, dryRun };
}

function main(): void {
  const { domain: domainName, dryRun } = parseArgs(process.argv.slice(2));
  if (!domainName) {
    die('missing --domain=<name>', [
      'Usage: npx ts-node --transpile-only tools/migration/extract-domain.ts --domain=web-core [--dry-run]',
    ]);
  }

  const manifest = loadManifest();
  const byName = new Map(manifest.domains.map((entry) => [entry.name, entry]));
  const domain = byName.get(domainName);
  if (!domain) {
    die(`unknown domain "${domainName}"`, [
      `Known domains: ${manifest.domains.map((entry) => entry.name).join(', ')}`,
    ]);
  }

  if (domain.sources.length === 0) {
    die(
      `domain "${domain.name}" is a skeleton entry — its "sources" array is empty`,
      [
        `Fill in ${rel(MANIFEST_PATH)} -> domains[name="${domain.name}"].sources`,
        'with the app-relative globs that belong to this domain, then re-run.',
      ],
    );
  }

  assertDependenciesExtracted(domain, byName);

  const appRoot = abs(domain.app);
  if (!fs.existsSync(appRoot)) die(`app "${domain.app}" does not exist`);

  const libRoot = abs(domain.lib);
  const alreadyScaffolded = isExtracted(domain);
  if (!alreadyScaffolded) {
    scaffoldLib(domain, dryRun);
  } else {
    console.log(
      `\n[extract-domain] ${domain.lib} already exists — extending it in place`,
    );
  }
  if (!dryRun) {
    alignEslintConfig(domain);
    ensureLibPackageJson(domain);
  }

  // ------------------------------------------------------------------
  // load the app plus every lib we may have to rewrite against
  // ------------------------------------------------------------------
  const otherExtracted = manifest.domains.filter(
    (entry) => entry.name !== domain.name && isExtracted(entry),
  );

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  project.addSourceFilesAtPaths([
    `${posix(appRoot)}/src/**/*.ts`,
    `!${posix(appRoot)}/src/**/*.d.ts`,
  ]);
  for (const other of otherExtracted) {
    project.addSourceFilesAtPaths(`${posix(abs(other.lib))}/src/**/*.ts`);
  }
  if (fs.existsSync(path.join(libRoot, 'src'))) {
    project.addSourceFilesAtPaths(`${posix(libRoot)}/src/**/*.ts`);
  }

  // ------------------------------------------------------------------
  // resolve source globs -> planned moves
  // ------------------------------------------------------------------
  const appSourceBase = fs.existsSync(path.join(appRoot, 'src', 'app'))
    ? path.join(appRoot, 'src', 'app')
    : path.join(appRoot, 'src');

  /** Where a given app file lands inside the lib, per the source entry's rules. */
  const destinationOf = (
    entry: SourceEntry,
    cleanGlob: string,
    from: string,
  ) => {
    const relativeTarget =
      entry.to === undefined
        ? path.relative(appSourceBase, from)
        : path.join(
            entry.to,
            path.relative(path.join(appRoot, globStaticBase(cleanGlob)), from),
          );
    return posix(
      path.join(libRoot, 'src', entry.entryPoint ?? 'lib', relativeTarget),
    );
  };

  /** Secondary entry points this domain declares, e.g. `["testing"]`. */
  const entryPoints = [
    ...new Set(
      domain.sources
        .map((raw) => normalizeSource(raw).entryPoint)
        .filter((name): name is string => name !== undefined),
    ),
  ].sort();

  const moves: PlannedMove[] = [];
  const rawMoves: PlannedMove[] = [];
  const rawRedirects = new Map<string, string>();
  const seenTargets = new Set<string>();
  const alreadyMoved: string[] = [];

  for (const raw of domain.sources) {
    const entry = normalizeSource(raw);
    const cleanGlob = posix(entry.glob).replace(/^\.\//, '');

    if (entry.raw === true) {
      const staticBase = path.join(appRoot, globStaticBase(cleanGlob));
      const pattern = globToRegExp(cleanGlob);
      const matchedRaw = walkFiles(staticBase).filter((file) =>
        pattern.test(posix(path.relative(appRoot, file))),
      );

      if (matchedRaw.length === 0) {
        const destination = posix(
          path.join(
            libRoot,
            'src',
            entry.entryPoint ?? 'lib',
            entry.to ?? path.relative(appSourceBase, staticBase),
          ),
        );
        if (destinationHasFiles(destination)) {
          alreadyMoved.push(entry.glob);
          continue;
        }
        die(`raw source glob matched nothing: ${entry.glob}`, [
          `app: ${domain.app}`,
          `Nothing at the destination either (${rel(destination)}).`,
        ]);
      }

      for (const from of matchedRaw) {
        const to = destinationOf(entry, cleanGlob, from);
        if (seenTargets.has(to)) continue;
        seenTargets.add(to);
        rawMoves.push({ from, to });
        rawRedirects.set(from, to);
      }
      continue;
    }

    const matched = project.getSourceFiles(`${posix(appRoot)}/${cleanGlob}`);

    if (matched.length === 0) {
      // Incremental re-extraction: a glob that matches nothing in the app is
      // fine *if* its destination already holds the files from an earlier run.
      // Anything else is a bad glob and must fail loudly.
      // A wildcard glob has no single destination file — check the directory
      // its static base maps onto. `path.dirname()` on a glob path would just
      // hand back another glob.
      const destination = GLOB_MAGIC.test(cleanGlob)
        ? posix(
            path.join(
              libRoot,
              'src',
              entry.entryPoint ?? 'lib',
              entry.to ??
                path.relative(
                  appSourceBase,
                  path.join(appRoot, globStaticBase(cleanGlob)),
                ),
            ),
          )
        : destinationOf(entry, cleanGlob, path.join(appRoot, cleanGlob));

      if (destinationHasFiles(destination)) {
        alreadyMoved.push(entry.glob);
        continue;
      }

      die(`source glob matched nothing: ${entry.glob}`, [
        `app: ${domain.app}`,
        `Nothing at the destination either (${rel(destination)}), so this is not`,
        'a re-run of an already-extracted slice — the glob is wrong.',
      ]);
    }

    for (const sourceFile of matched) {
      const from = posix(sourceFile.getFilePath());
      const to = destinationOf(entry, cleanGlob, from);
      if (seenTargets.has(to)) continue;
      seenTargets.add(to);
      moves.push({ from, to });
    }
  }

  if (moves.length === 0 && rawMoves.length === 0) {
    console.log(
      `\n[extract-domain] nothing to do — all ${alreadyMoved.length} source entr(ies) are already in ${domain.lib}`,
    );
    // Still normalise the alias + baseUrl, reconcile the public surface, and
    // tidy anything the scaffold hooks rewrote, so a no-op re-run is genuinely
    // idempotent.
    if (!dryRun) {
      ensureTsconfigAlias(domain, entryPoints);
      const pruned = reconcileBarrel(domain, libRoot);
      if (pruned > 0) {
        console.log(
          `[extract-domain] pruned ${pruned} barrel export(s) now outside publicApi`,
        );
      }
      formatTouchedFiles();
    }
    return;
  }

  moves.sort((a, b) => a.from.localeCompare(b.from));

  // ------------------------------------------------------------------
  // external component templates / stylesheets travel with their class
  // ------------------------------------------------------------------
  const assetMoves: PlannedAssetMove[] = [];
  const missingAssets: Violation[] = [];
  const escapingAssets: Violation[] = [];
  const seenAssetTargets = new Set<string>();

  for (const move of moves) {
    const sourceFile = project.getSourceFileOrThrow(move.from);

    for (const specifier of componentAssetSpecifiers(sourceFile)) {
      if (!specifier.startsWith('.')) continue;

      const from = posix(path.resolve(path.dirname(move.from), specifier));
      // Resolving the SAME specifier against the destination keeps the
      // decorator string valid without rewriting it.
      const to = posix(path.resolve(path.dirname(move.to), specifier));

      if (!fs.existsSync(from)) {
        missingAssets.push({
          file: rel(move.from),
          specifier,
          reason: `no such file: ${rel(from)}`,
        });
        continue;
      }
      if (!to.startsWith(`${posix(libRoot)}/`)) {
        escapingAssets.push({
          file: rel(move.from),
          specifier,
          reason: `would land outside the lib at ${rel(to)}`,
        });
        continue;
      }
      if (seenAssetTargets.has(to)) continue;
      seenAssetTargets.add(to);
      assetMoves.push({ from, to, via: rel(move.from) });
    }
  }

  if (missingAssets.length > 0) {
    die(
      `${missingAssets.length} component asset(s) referenced by "${domain.name}" do not exist`,
      missingAssets.map(
        (entry) =>
          `- ${entry.file}\n      ${entry.specifier}  (${entry.reason})`,
      ),
    );
  }

  if (escapingAssets.length > 0) {
    die(
      `${escapingAssets.length} component asset(s) in "${domain.name}" escape the lib`,
      [
        'A template/stylesheet outside the moved tree cannot follow its component.',
        'Co-locate it with the component, or widen the domain to include its directory:',
        ...escapingAssets.map(
          (entry) =>
            `- ${entry.file}\n      ${entry.specifier}  (${entry.reason})`,
        ),
      ],
    );
  }

  assetMoves.sort((a, b) => a.from.localeCompare(b.from));

  // ------------------------------------------------------------------
  // move (in memory — nothing hits disk until project.saveSync())
  // ------------------------------------------------------------------
  const movedFiles: SourceFile[] = [];
  for (const move of moves) {
    const sourceFile = project.getSourceFileOrThrow(move.from);
    sourceFile.move(move.to);
    movedFiles.push(sourceFile);
  }

  // ------------------------------------------------------------------
  // import fixing, both directions
  // ------------------------------------------------------------------
  const libDirs = [
    // Secondary entry points FIRST — they sit inside the lib root, so the more
    // specific directory has to win the prefix match.
    ...entryPoints.map((entryPoint) => ({
      dir: posix(path.join(libRoot, 'src', entryPoint)),
      importPath: `${domain.importPath}/${entryPoint}`,
      name: domain.name,
    })),
    { dir: posix(libRoot), importPath: domain.importPath, name: domain.name },
    ...otherExtracted.map((entry) => ({
      dir: posix(abs(entry.lib)),
      importPath: entry.importPath,
      name: entry.name,
    })),
  ];

  const libOwning = (
    filePath: string,
  ): { dir: string; importPath: string; name: string } | undefined =>
    libDirs.find((entry) => posix(filePath).startsWith(`${entry.dir}/`));

  /** Manifest fallback: which already-extracted domain claims this app path? */
  const manifestOwner = (filePath: string): Domain | undefined => {
    for (const other of otherExtracted) {
      const appRelative = posix(path.relative(abs(other.app), filePath));
      if (appRelative.startsWith('..')) continue;
      for (const raw of other.sources) {
        const cleanGlob = posix(normalizeSource(raw).glob).replace(/^\.\//, '');
        if (globToRegExp(cleanGlob).test(appRelative)) return other;
      }
    }
    return undefined;
  };

  const isEnvironmentImport = (
    specifier: string,
    resolved: string | null,
  ): boolean =>
    /(^|\/)environments\/environment(\.|$)/.test(specifier) ||
    (resolved !== null && /\/src\/environments\//.test(resolved));

  const rewrites: PlannedRewrite[] = [];
  const envViolations: Violation[] = [];
  const unresolved: Violation[] = [];
  const selfAliasImports: Violation[] = [];
  const movedPaths = new Set(moves.map((move) => move.to));

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = posix(sourceFile.getFilePath());
    const owner = libOwning(filePath);
    const isInsideThisLib = owner?.name === domain.name;

    for (const literal of moduleSpecifiers(sourceFile)) {
      const specifier = literal.getLiteralValue();

      // A file that ends up inside the lib must never import the lib's own
      // alias — that is a barrel cycle (index -> file -> index). Happens when
      // a file authored against the alias is later folded into that same lib.
      if (isInsideThisLib && specifier === domain.importPath) {
        selfAliasImports.push({
          file: rel(filePath),
          specifier,
          reason: "would import its own lib's barrel",
        });
      }

      if (!specifier.startsWith('.')) continue;

      const resolved = resolveSpecifier(
        project,
        filePath,
        specifier,
        rawRedirects,
      );

      if (isInsideThisLib && isEnvironmentImport(specifier, resolved)) {
        envViolations.push({
          file: rel(filePath),
          specifier,
          reason: 'imports the app environment',
        });
        continue;
      }

      const target = resolved ? libOwning(resolved) : undefined;

      if (target && target.name !== owner?.name) {
        // Crossing a lib boundary -> always go through the barrel alias.
        rewrites.push({
          file: rel(filePath),
          from: specifier,
          to: target.importPath,
        });
        literal.setLiteralValue(target.importPath);
        continue;
      }
      if (target) {
        // Same lib, so a relative specifier is correct in principle — but if it
        // only resolved via a raw redirect, the literal still points at the
        // file's OLD location (ts-morph cannot repoint imports to files it
        // never parsed). Rewrite it to a real intra-lib relative path.
        const withoutRedirects = resolveSpecifier(project, filePath, specifier);
        if (resolved !== null && withoutRedirects !== resolved) {
          const corrected = posix(
            path.relative(path.dirname(filePath), resolved),
          ).replace(/\.tsx?$/, '');
          const relativeSpecifier = corrected.startsWith('.')
            ? corrected
            : `./${corrected}`;
          rewrites.push({
            file: rel(filePath),
            from: specifier,
            to: relativeSpecifier,
          });
          literal.setLiteralValue(relativeSpecifier);
        }
        continue;
      }

      if (!isInsideThisLib) continue; // app-internal relative import, untouched

      // Inside the freshly extracted lib and the import escapes it.
      if (resolved !== null && movedPaths.has(resolved)) continue;

      const claimed = resolved ? manifestOwner(resolved) : undefined;
      if (claimed) {
        rewrites.push({
          file: rel(filePath),
          from: specifier,
          to: claimed.importPath,
        });
        literal.setLiteralValue(claimed.importPath);
        continue;
      }

      unresolved.push({
        file: rel(filePath),
        specifier,
        reason:
          resolved !== null
            ? `resolves to ${rel(resolved)}, which no extracted domain owns`
            : 'could not be resolved',
      });
    }
  }

  if (envViolations.length > 0) {
    die(
      `${envViolations.length} file(s) in "${domain.name}" import the app environment`,
      [
        'Environment files cannot move into a lib — they need an injection token first.',
        'Drop these files from the manifest sources (or introduce the token), then re-run:',
        ...envViolations.map(
          (entry) => `- ${entry.file}  ->  ${entry.specifier}`,
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // workspace-relative path literals
  // ------------------------------------------------------------------
  // Some files reference other files by PATH rather than by import — the
  // license server's `testing/controller-registry.ts` keys its ledger on
  // `file: 'apps/ptah-license-server/src/.../x.controller.ts'`, and a census
  // spec asserts that ledger against a filesystem scan. Moving a file without
  // updating those literals leaves the ledger pointing at a path that no longer
  // exists, and the census fails on the NEXT run rather than in this one.
  //
  // Only an EXACT match on a moved file's workspace-relative path is rewritten,
  // so a literal cannot be caught by accident: the value has to name a real
  // file this run is moving, extension included. Module specifiers are relative
  // or aliased and can never take this form, so they are untouched.
  const pathLiteralRewrites = new Map(
    [...moves, ...rawMoves, ...assetMoves].map((move) => [
      rel(move.from),
      rel(move.to),
    ]),
  );

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = posix(sourceFile.getFilePath());

    for (const literal of sourceFile.getDescendantsOfKind(
      SyntaxKind.StringLiteral,
    )) {
      const replacement = pathLiteralRewrites.get(literal.getLiteralValue());
      if (replacement === undefined) continue;

      rewrites.push({
        file: rel(filePath),
        from: literal.getLiteralValue(),
        to: replacement,
      });
      literal.setLiteralValue(replacement);
    }
  }

  if (selfAliasImports.length > 0) {
    die(
      `${selfAliasImports.length} file(s) landing in "${domain.name}" import ${domain.importPath} — its own barrel`,
      [
        'That is a circular import (barrel -> file -> barrel) and breaks Angular DI ordering.',
        'Fix by importing the defining file relatively before re-running, or by',
        'authoring the shared symbol in the app so it moves in the same run:',
        ...selfAliasImports.map((entry) => `- ${entry.file}`),
      ],
    );
  }

  if (unresolved.length > 0) {
    die(
      `"${domain.name}" is not closed — ${unresolved.length} import(s) escape the lib`,
      [
        'Every import leaving a lib must land in another ALREADY EXTRACTED domain.',
        'Fix by adding the missing files to this domain, or by extracting the domain that owns them first.',
        ...unresolved.map(
          (entry) =>
            `- ${entry.file}\n      ${entry.specifier}  (${entry.reason})`,
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // barrel
  // ------------------------------------------------------------------
  const barrelPath = path.join(libRoot, 'src', 'index.ts');
  const existingBarrel = fs.existsSync(barrelPath)
    ? fs.readFileSync(barrelPath, 'utf8')
    : '';
  const existingLines = existingBarrel
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const barrelSpecifier = (filePath: string): string =>
    `./${posix(path.relative(path.join(libRoot, 'src'), filePath)).replace(
      /\.tsx?$/,
      '',
    )}`;

  /** Which secondary entry point (if any) a lib file belongs to. */
  const entryPointOf = (filePath: string): string | undefined =>
    entryPoints.find((entryPoint) =>
      posix(filePath).startsWith(
        `${posix(path.join(libRoot, 'src', entryPoint))}/`,
      ),
    );

  const barrelCandidates = movedFiles.filter((sourceFile) => {
    const filePath = posix(sourceFile.getFilePath());
    if (isSpecFile(filePath)) return false;
    // Nested index.ts files are the feature's *internal* barrels. Re-exporting
    // them from the lib barrel alongside the files they re-export makes every
    // shared symbol ambiguous (TS2308). The lib's public surface is src/index.ts.
    if (path.basename(filePath) === 'index.ts') return false;
    // A secondary entry point has its own barrel and its own alias; `publicApi`
    // only governs the main `src/lib` surface.
    if (entryPointOf(filePath) !== undefined) return true;
    return inPublicApi(domain, libRoot, filePath);
  });

  // Names already public via a previous run's barrel lines.
  const namesAlreadyExported = new Set<string>();
  for (const line of existingLines) {
    const match = /^export \* from '(\.[^']+)';$/.exec(line);
    if (!match) continue;
    const resolved = resolveSpecifier(project, barrelPath, match[1]);
    const sourceFile = resolved ? project.getSourceFile(resolved) : undefined;
    if (!sourceFile) continue;
    for (const name of topLevelExportNames(sourceFile)) {
      namesAlreadyExported.add(name);
    }
  }

  // `export *` cannot publish two files that share an exported name (TS2308).
  // Rather than pick a winner, omit EVERY colliding file from the public
  // surface — they stay reachable relatively inside the lib, and if something
  // outside genuinely needed one, typecheck fails loudly instead of silently
  // resolving to the wrong symbol.
  const nameOwners = new Map<string, string[]>();
  for (const sourceFile of barrelCandidates) {
    const filePath = posix(sourceFile.getFilePath());
    for (const name of topLevelExportNames(sourceFile)) {
      nameOwners.set(name, [...(nameOwners.get(name) ?? []), filePath]);
    }
  }

  const collisions: string[] = [];
  const withheld = new Set<string>();
  for (const [name, owners] of nameOwners) {
    const clashesWithExisting = namesAlreadyExported.has(name);
    if (owners.length === 1 && !clashesWithExisting) continue;

    collisions.push(
      `${name} — ${[
        ...owners.map((owner) => rel(owner)),
        ...(clashesWithExisting ? ['already exported by the barrel'] : []),
      ].join(', ')}`,
    );
    for (const owner of owners) withheld.add(owner);
  }

  const barrelAdditions: string[] = [];
  /** entryPoint -> `export *` lines destined for its own barrel. */
  const entryPointBarrels = new Map<string, string[]>();

  for (const sourceFile of barrelCandidates) {
    const filePath = posix(sourceFile.getFilePath());
    if (withheld.has(filePath)) continue;

    const entryPoint = entryPointOf(filePath);
    if (entryPoint !== undefined) {
      const entryPointRoot = path.join(libRoot, 'src', entryPoint);
      const specifier = `./${posix(
        path.relative(entryPointRoot, filePath),
      ).replace(/\.tsx?$/, '')}`;
      const lines = entryPointBarrels.get(entryPoint) ?? [];
      const line = `export * from '${specifier}';`;
      if (!lines.includes(line)) lines.push(line);
      entryPointBarrels.set(entryPoint, lines);
      continue;
    }

    const line = `export * from '${barrelSpecifier(filePath)}';`;
    if (!existingLines.includes(line) && !barrelAdditions.includes(line)) {
      barrelAdditions.push(line);
    }
  }

  // Raw-moved files never land in the barrel by default — a generated client is
  // hundreds of files and only its entry point is public. `publicApi` names it.
  for (const move of rawMoves) {
    if (!/\.tsx?$/.test(move.to) || isSpecFile(move.to)) continue;
    if (!inPublicApi(domain, libRoot, move.to)) continue;

    const line = `export * from '${barrelSpecifier(move.to)}';`;
    if (!existingLines.includes(line) && !barrelAdditions.includes(line)) {
      barrelAdditions.push(line);
    }
  }

  barrelAdditions.sort();
  const barrelContent = `${[...existingLines, ...barrelAdditions].join('\n')}\n`;

  // ------------------------------------------------------------------
  // write / report
  // ------------------------------------------------------------------
  if (dryRun) {
    console.log('\n[extract-domain] DRY RUN — nothing was written');
  } else {
    project.saveSync();
    for (const asset of assetMoves) {
      fs.mkdirSync(path.dirname(asset.to), { recursive: true });
      fs.renameSync(asset.from, asset.to);
    }
    for (const move of rawMoves) {
      fs.mkdirSync(path.dirname(move.to), { recursive: true });
      fs.renameSync(move.from, move.to);
    }
    fs.writeFileSync(barrelPath, barrelContent, 'utf8');
    touchedForFormatting.add(barrelPath);

    for (const [entryPoint, lines] of entryPointBarrels) {
      const entryPointBarrel = path.join(
        libRoot,
        'src',
        entryPoint,
        'index.ts',
      );
      const existing = fs.existsSync(entryPointBarrel)
        ? fs
            .readFileSync(entryPointBarrel, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        : [];
      const merged = [
        ...existing,
        ...lines.filter((line) => !existing.includes(line)),
      ].sort();
      fs.mkdirSync(path.dirname(entryPointBarrel), { recursive: true });
      fs.writeFileSync(entryPointBarrel, `${merged.join('\n')}\n`, 'utf8');
      touchedForFormatting.add(entryPointBarrel);
    }
    if (entryPoints.length > 0)
      excludeEntryPointsFromLibBuild(domain, entryPoints);
    pruneEmptyDirs(
      [
        ...moves.map((move) => path.dirname(move.from)),
        ...assetMoves.map((asset) => path.dirname(asset.from)),
        ...rawMoves.map((move) => path.dirname(move.from)),
      ],
      // Boundary is the app's src/, NOT `appSourceBase`. A domain can pull from
      // outside src/app (the license server keeps prisma/, config/ and the
      // generated client as siblings of src/app), and a boundary below those
      // would silently skip pruning their emptied directories.
      path.join(appRoot, 'src'),
    );
  }

  const aliasState =
    dryRun && !alreadyScaffolded
      ? 'skipped (dry run — generator owns it)'
      : ensureTsconfigAlias(domain, entryPoints);

  if (!dryRun) formatTouchedFiles();

  const appProject = projectNameOfApp(domain);

  console.log(`\n=== extract-domain: ${domain.name} ===`);
  console.log(`lib          : ${domain.lib}`);
  console.log(`importPath   : ${domain.importPath}`);
  console.log(`tags         : ${domain.tags}`);
  console.log(`tsconfig path: ${aliasState}`);

  console.log(`\nfiles moved (${moves.length}):`);
  for (const move of moves) {
    console.log(`  ${rel(move.from)}\n    -> ${rel(move.to)}`);
  }

  if (rawMoves.length > 0) {
    const libSrcLib = path.join(libRoot, 'src', 'lib');
    const roots = new Set(
      rawMoves.map(
        (move) => posix(path.relative(libSrcLib, move.to)).split('/')[0],
      ),
    );
    console.log(
      `\nraw files moved, not parsed (${rawMoves.length}) -> ${rel(libSrcLib)}/{${[...roots].join(', ')}}`,
    );
  }

  if (assetMoves.length > 0) {
    console.log(`\ncomponent assets moved (${assetMoves.length}):`);
    for (const asset of assetMoves) {
      console.log(`  ${rel(asset.from)}\n    -> ${rel(asset.to)}`);
    }
  }

  if (alreadyMoved.length > 0) {
    console.log(`\nsource entries already extracted (${alreadyMoved.length}):`);
    for (const glob of alreadyMoved) console.log(`  ${glob}`);
  }

  console.log(`\nimports rewritten (${rewrites.length}):`);
  const byFile = new Map<string, PlannedRewrite[]>();
  for (const rewrite of rewrites) {
    const list = byFile.get(rewrite.file) ?? [];
    list.push(rewrite);
    byFile.set(rewrite.file, list);
  }
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`  ${file}`);
    for (const rewrite of list) {
      console.log(`    '${rewrite.from}' -> '${rewrite.to}'`);
    }
  }

  console.log(`\nbarrel exports added (${barrelAdditions.length}):`);
  for (const line of barrelAdditions) console.log(`  ${line}`);

  if (collisions.length > 0) {
    console.log(
      `\nWARNING — ${withheld.size} file(s) withheld from the barrel (duplicate exported names):`,
    );
    for (const collision of collisions) console.log(`  ${collision}`);
    console.log(
      '  These stay internal to the lib (import them relatively). To publish one,',
    );
    console.log('  rename the clashing symbol and re-run.');
  }

  console.log('\nfollow-up:');
  console.log(`  npx nx run-many -t typecheck -p ${appProject},${domain.name}`);
  console.log(`  npx nx run-many -t lint -p ${appProject},${domain.name}`);
  console.log(`  npx nx affected -t typecheck,lint,test`);
  console.log('');
}

try {
  main();
} catch (error: unknown) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  die(`unexpected error\n${message}`);
}
