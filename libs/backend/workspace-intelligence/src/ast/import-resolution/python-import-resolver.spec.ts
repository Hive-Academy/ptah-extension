/**
 * Specs for the Python import resolver (TASK_2026_559 Batch 33, Task 33.1):
 * relative imports, source roots (the root, `src/`, `pyproject.toml`
 * package-dir / packages), module and package files, the `from a.b import c`
 * submodule preference, and how a module outside every root is classified.
 * Contexts are built by the real `buildResolverContext` over a temporary
 * directory, so `pyproject.toml` goes through the bounded manifest reader.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Result } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CodeInsights, ImportInfo } from '../ast-analysis.interfaces';
import type { AstAnalysisService } from '../ast-analysis.service';
import { DependencyGraphService } from '../dependency-graph.service';
import type { FileSystemService } from '../../services/file-system.service';
import { toForwardSlashes } from './manifest-reader';
import { PYTHON_IMPORT_RESOLVER } from './python-import-resolver';
import { readPyproject } from './python-manifest';
import { buildResolverContext, type ResolverContext } from './resolver-context';

let root: string;

beforeEach(() => {
  root = toForwardSlashes(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-py-resolver-')),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A context over `files` (relative), with the root's manifests written first. */
async function context(
  files: readonly string[],
  manifests: Readonly<Record<string, string>> = {},
): Promise<ResolverContext> {
  for (const [name, content] of Object.entries(manifests)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  const built = await buildResolverContext({
    root,
    knownFiles: files.map((file) => `${root}/${file}`),
    isCurrent: () => true,
  });
  if (built === undefined) throw new Error('context superseded');
  return built;
}

function resolve(
  ctx: ResolverContext,
  fromFile: string,
  imp: Partial<ImportInfo> & { source: string },
) {
  return PYTHON_IMPORT_RESOLVER.resolve(
    imp as ImportInfo,
    `${root}/${fromFile}`,
    ctx,
  );
}

const at = (...files: string[]) => files.map((file) => `${root}/${file}`);

describe('PYTHON_IMPORT_RESOLVER — relative imports', () => {
  const files = [
    'app/__init__.py',
    'app/models.py',
    'app/service.py',
    'app/core/__init__.py',
    'app/core/base.py',
    'app/sub/view.py',
  ];

  it('`from . import models` links the sibling submodule', async () => {
    const ctx = await context(files);
    expect(
      resolve(ctx, 'app/service.py', {
        source: '.',
        kind: 'relative',
        relativeLevel: 1,
        importedSymbols: ['models'],
      }),
    ).toEqual({ kind: 'file', targets: at('app/models.py') });
  });

  it('`from .models import A, B` links the module', async () => {
    const ctx = await context(files);
    expect(
      resolve(ctx, 'app/service.py', {
        source: '.models',
        kind: 'relative',
        relativeLevel: 1,
        importedSymbols: ['UserAccount', 'load_default_account'],
      }),
    ).toEqual({ kind: 'file', targets: at('app/models.py') });
  });

  it('`from ..core.base import Base` climbs relativeLevel - 1 directories', async () => {
    const ctx = await context(files);
    expect(
      resolve(ctx, 'app/sub/view.py', {
        source: '..core.base',
        kind: 'relative',
        relativeLevel: 2,
        importedSymbols: ['Base'],
      }),
    ).toEqual({ kind: 'file', targets: at('app/core/base.py') });
  });

  it('`from .. import *` links the parent package', async () => {
    const ctx = await context(files);
    expect(
      resolve(ctx, 'app/sub/view.py', {
        source: '..',
        kind: 'relative',
        relativeLevel: 2,
        importedSymbols: ['*'],
      }),
    ).toEqual({ kind: 'file', targets: at('app/__init__.py') });
  });

  it('a name that is not a submodule links the package itself', async () => {
    const ctx = await context(files);
    expect(
      resolve(ctx, 'app/service.py', {
        source: '.',
        kind: 'relative',
        relativeLevel: 1,
        importedSymbols: ['models', 'VERSION'],
      }),
    ).toEqual({
      kind: 'file',
      targets: at('app/models.py', 'app/__init__.py'),
    });
  });

  it('a missing relative module is unresolved-internal, never external', async () => {
    const ctx = await context(files);
    expect(
      resolve(ctx, 'app/service.py', {
        source: '.missing',
        kind: 'relative',
        relativeLevel: 1,
        importedSymbols: ['x'],
      }),
    ).toEqual({ kind: 'unresolved-internal', targets: [] });
  });

  it('a relative import that climbs out of the root is unresolved-internal', async () => {
    const ctx = await context(['top.py']);
    expect(
      resolve(ctx, 'top.py', {
        source: '..',
        kind: 'relative',
        relativeLevel: 2,
        importedSymbols: ['x'],
      }),
    ).toEqual({ kind: 'unresolved-internal', targets: [] });
  });
});

describe('PYTHON_IMPORT_RESOLVER — absolute imports and source roots', () => {
  it('`import a.b` tries a/b.py, then a/b/__init__.py', async () => {
    const ctx = await context([
      'pkg/__init__.py',
      'pkg/mod.py',
      'pkg/sub/__init__.py',
    ]);
    expect(resolve(ctx, 'main.py', { source: 'pkg.mod' })).toEqual({
      kind: 'file',
      targets: at('pkg/mod.py'),
    });
    expect(resolve(ctx, 'main.py', { source: 'pkg.sub' })).toEqual({
      kind: 'file',
      targets: at('pkg/sub/__init__.py'),
    });
  });

  it('`from a.b import c` prefers the submodule a/b/c, else the module a/b', async () => {
    const ctx = await context(['a/__init__.py', 'a/b/__init__.py', 'a/b/c.py']);
    expect(
      resolve(ctx, 'main.py', { source: 'a.b', importedSymbols: ['c'] }),
    ).toEqual({ kind: 'file', targets: at('a/b/c.py') });
    expect(
      resolve(ctx, 'main.py', { source: 'a.b', importedSymbols: ['helper'] }),
    ).toEqual({ kind: 'file', targets: at('a/b/__init__.py') });
  });

  it('resolves from src/ when it holds graphed files', async () => {
    const ctx = await context(['src/mypkg/__init__.py', 'src/mypkg/core.py']);
    expect(ctx.python.sourceRoots).toEqual([root, `${root}/src`]);
    expect(
      resolve(ctx, 'tests/test_core.py', { source: 'mypkg.core' }),
    ).toEqual({ kind: 'file', targets: at('src/mypkg/core.py') });
  });

  it('a first segment found in a root with no file for the module is unresolved-internal', async () => {
    const ctx = await context(['app/__init__.py']);
    expect(resolve(ctx, 'main.py', { source: 'app.missing' })).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });

  it('a regular module in a root shadows the standard library', async () => {
    const ctx = await context(['logging.py']);
    expect(resolve(ctx, 'main.py', { source: 'logging' })).toEqual({
      kind: 'file',
      targets: at('logging.py'),
    });
  });

  it('a plain directory named like a standard module does not shadow it', async () => {
    const ctx = await context(['email/notes.py']);
    expect(resolve(ctx, 'main.py', { source: 'email.mime' })).toEqual({
      kind: 'external',
      targets: [],
    });
  });

  it('a namespace package (no __init__.py) of the workspace resolves', async () => {
    const ctx = await context(['nspkg/tool.py']);
    expect(resolve(ctx, 'main.py', { source: 'nspkg.tool' })).toEqual({
      kind: 'file',
      targets: at('nspkg/tool.py'),
    });
  });

  it('uses a unique case-folded match and marks it', async () => {
    const ctx = await context(['app/__init__.py', 'app/Models.py']);
    expect(resolve(ctx, 'main.py', { source: 'app.models' })).toEqual({
      kind: 'file',
      targets: at('app/Models.py'),
      caseFolded: true,
    });
  });

  it('an ambiguous case-folded match is unresolved-internal', async () => {
    const ctx = await context([
      'app/__init__.py',
      'app/Models.py',
      'app/MODELS.py',
    ]);
    expect(resolve(ctx, 'main.py', { source: 'app.models' })).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });
});

describe('PYTHON_IMPORT_RESOLVER — modules outside every root', () => {
  it('a standard-library module is proven external', async () => {
    const ctx = await context(['main.py']);
    for (const source of ['os', 'os.path', 'collections.abc', '__future__']) {
      expect(resolve(ctx, 'main.py', { source })).toEqual({
        kind: 'external',
        targets: [],
      });
    }
  });

  it('an undeclared third-party module is external only as far as the context knows', async () => {
    const ctx = await context(['main.py']);
    expect(resolve(ctx, 'main.py', { source: 'requests' })).toEqual({
      kind: 'external',
      targets: [],
      contextDependent: true,
    });
  });

  it('a dependency the root pyproject.toml declares is proven external', async () => {
    const ctx = await context(['main.py'], {
      'pyproject.toml': [
        '[project]',
        'name = "demo"',
        'dependencies = [',
        '  "requests>=2.31",  # HTTP',
        '  \'Flask-Login[extra] ; python_version > "3.8"\',',
        ']',
        '[project.optional-dependencies]',
        'dev = ["pytest"]',
        '[tool.poetry.group.lint.dependencies]',
        'ruff = "^0.4"',
        '',
      ].join('\n'),
    });
    for (const source of ['requests', 'flask_login', 'pytest', 'ruff']) {
      expect(resolve(ctx, 'main.py', { source })).toEqual({
        kind: 'external',
        targets: [],
      });
    }
    expect(ctx.gaps).toEqual([]);
  });
});

describe('PYTHON_IMPORT_RESOLVER — pyproject.toml layout', () => {
  it('reads [tool.setuptools] package-dir: "" is a source root, a name maps a package', async () => {
    const ctx = await context(
      ['lib/core/__init__.py', 'code/special/impl.py'],
      {
        'pyproject.toml': [
          '[tool.setuptools]',
          'package-dir = { "" = "lib", "vendor_x" = "code/special" }',
          '',
        ].join('\n'),
      },
    );
    expect(resolve(ctx, 'main.py', { source: 'core' })).toEqual({
      kind: 'file',
      targets: at('lib/core/__init__.py'),
    });
    expect(resolve(ctx, 'main.py', { source: 'vendor_x.impl' })).toEqual({
      kind: 'file',
      targets: at('code/special/impl.py'),
    });
    // Claimed by the manifest: a workspace package even when not found.
    expect(resolve(ctx, 'main.py', { source: 'vendor_x.gone' })).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });

  it('reads packages.find where, Poetry `from` and Hatch wheel packages', async () => {
    const ctx = await context(
      ['python/alpha/__init__.py', 'pysrc/beta.py', 'pkgs/gamma/__init__.py'],
      {
        'pyproject.toml': [
          '[tool.setuptools.packages.find]',
          "where = ['python']",
          '',
          '[tool.poetry]',
          'packages = [',
          '  { include = "beta", from = "pysrc" },',
          ']',
          '',
          '[tool.hatch.build.targets.wheel]',
          'packages = ["pkgs/gamma"]',
          '',
        ].join('\n'),
      },
    );
    expect(resolve(ctx, 'main.py', { source: 'alpha' })).toEqual({
      kind: 'file',
      targets: at('python/alpha/__init__.py'),
    });
    expect(resolve(ctx, 'main.py', { source: 'beta' })).toEqual({
      kind: 'file',
      targets: at('pysrc/beta.py'),
    });
    expect(resolve(ctx, 'main.py', { source: 'gamma' })).toEqual({
      kind: 'file',
      targets: at('pkgs/gamma/__init__.py'),
    });
  });

  it('an unreadable pyproject.toml is disclosed as a partial context', async () => {
    const ctx = await context(['main.py'], {
      'pyproject.toml': '[tool.setuptools\npackage-dir = {',
    });
    expect(ctx.gaps).toEqual(['manifest-unparseable']);
  });
});

describe('readPyproject — the TOML subset', () => {
  it('reads basic, literal and multi-line strings, comments and table forms', () => {
    const facts = readPyproject(
      [
        '# comment',
        'title = """',
        'multi "line" \\',
        '   text"""',
        "path = 'C:\\raw'",
        'when = 1979-05-27 07:32:00Z',
        '[tool.setuptools.package-dir]',
        '"" = "src"  # the root',
        '"a.b" = "lib/ab"',
        '[[tool.other]]',
        'x = 1',
        '[[tool.other]]',
        'x = 2',
        '[project]',
        'dependencies = [',
        '  "Django>=4",',
        '  # a comment inside the array',
        '  "zope.interface",',
        ']',
        '',
      ].join('\n'),
    );
    expect(facts).toEqual({
      sourceRoots: ['src'],
      packageDirs: [{ module: 'a.b', dir: 'lib/ab' }],
      dependencies: ['django', 'zope_interface'],
      localDependencies: [],
    });
  });

  it.each([
    ['an unterminated array', 'a = [1, 2'],
    ['a duplicate key', 'a = 1\na = 2'],
    ['a bad escape', 'a = "\\q"'],
    [
      'a package-dir that is not a table',
      '[tool.setuptools]\npackage-dir = "src"',
    ],
    ['a dependency that is not a string', '[project]\ndependencies = [1]'],
  ])('rejects %s', (_label, text) => {
    expect(readPyproject(text)).toBeUndefined();
  });

  it('ignores a source root outside the project', () => {
    expect(
      readPyproject('[tool.setuptools]\npackage-dir = { "" = "../elsewhere" }'),
    ).toEqual({
      sourceRoots: [],
      packageDirs: [],
      dependencies: [],
      localDependencies: [],
    });
  });
});

/**
 * A real `DependencyGraphService` over the files (their analysis stubbed to
 * the given imports), with the real resolver context of the temporary root.
 */
async function graphOf(
  imports: Readonly<Record<string, readonly ImportInfo[]>>,
  files: readonly string[],
) {
  const analysis = {
    analyzeSource: jest.fn(async (_c: string, _l: string, p: string) =>
      Result.ok({
        imports: imports[p.slice(root.length + 1)] ?? [],
        exports: [],
        functions: [],
        classes: [],
      } as unknown as CodeInsights),
    ),
  } as unknown as AstAnalysisService;
  const svc = new DependencyGraphService(
    analysis,
    { readFile: jest.fn(async () => '') } as unknown as FileSystemService,
    {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger,
  );
  await svc.buildGraph(
    files.map((file) => `${root}/${file}`),
    root,
  );
  return svc;
}

// Review r1 R33-01: regular-package ownership and namespace portions.
describe('PYTHON_IMPORT_RESOLVER — packages across source roots (R33-01)', () => {
  it('Scenario A: a namespace package gathers its portions from every root', async () => {
    const files = ['main.py', 'ns/a.py', 'src/ns/b.py'];
    const ctx = await context(files);
    expect(
      resolve(ctx, 'main.py', { source: 'ns', importedSymbols: ['a', 'b'] }),
    ).toEqual({ kind: 'file', targets: at('ns/a.py', 'src/ns/b.py') });

    const svc = await graphOf(
      { 'main.py': [{ source: 'ns', importedSymbols: ['a', 'b'] }] },
      files,
    );
    expect([...svc.getDependencies(`${root}/main.py`)].sort()).toEqual(
      at('ns/a.py', 'src/ns/b.py'),
    );
    expect(svc.getCoverageReport(root)?.languages.resolution).toMatchObject({
      unresolvedInternal: 0,
      context: 'complete',
    });
  });

  it('Scenario B: a regular package in an earlier root shadows later portions', async () => {
    const files = ['main.py', 'pkg/__init__.py', 'src/pkg/sub.py'];
    const ctx = await context(files);
    expect(resolve(ctx, 'main.py', { source: 'pkg.sub' })).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });

    const svc = await graphOf({ 'main.py': [{ source: 'pkg.sub' }] }, files);
    expect(svc.getDependencies(`${root}/main.py`)).toEqual([]);
    const languages = svc.getCoverageReport(root)?.languages;
    expect(languages?.resolution?.unresolvedInternal).toBe(1);
    expect(languages?.clean).toBe(false);
  });

  it('a later regular package wins over earlier namespace portions', async () => {
    const ctx = await context(['ns/a.py', 'src/ns/__init__.py', 'src/ns/b.py']);
    expect(
      resolve(ctx, 'main.py', { source: 'ns', importedSymbols: ['a', 'b'] }),
    ).toEqual({
      kind: 'file',
      targets: at('src/ns/b.py', 'src/ns/__init__.py'),
    });
  });

  it('discloses a requested member that nothing provides, beside the found ones', async () => {
    const files = ['main.py', 'ns/a.py'];
    const ctx = await context(files);
    expect(
      resolve(ctx, 'main.py', {
        source: 'ns',
        importedSymbols: ['a', 'missing'],
      }),
    ).toEqual({
      kind: 'file',
      targets: at('ns/a.py'),
      unresolvedMembers: 1,
    });

    const svc = await graphOf(
      { 'main.py': [{ source: 'ns', importedSymbols: ['a', 'missing'] }] },
      files,
    );
    expect(svc.getDependencies(`${root}/main.py`)).toEqual(at('ns/a.py'));
    const languages = svc.getCoverageReport(root)?.languages;
    expect(languages?.resolution?.unresolvedInternal).toBe(1);
    expect(languages?.clean).toBe(false);
  });
});

// Review r1 R33-03: the case rule applies to top-level names too.
describe('PYTHON_IMPORT_RESOLVER — top-level case rule (R33-03)', () => {
  it('uses a unique case-folded top-level module', async () => {
    const ctx = await context(['Widget.py', 'main.py']);
    expect(resolve(ctx, 'main.py', { source: 'widget' })).toEqual({
      kind: 'file',
      targets: at('Widget.py'),
      caseFolded: true,
    });
  });

  it('uses a unique case-folded namespace package', async () => {
    const ctx = await context(['Tools/run.py']);
    expect(resolve(ctx, 'main.py', { source: 'tools.run' })).toEqual({
      kind: 'file',
      targets: at('Tools/run.py'),
      caseFolded: true,
    });
  });

  it('an exact match in a later root outranks a folded one in an earlier root', async () => {
    const ctx = await context(['Widget.py', 'src/widget.py']);
    expect(resolve(ctx, 'main.py', { source: 'widget' })).toEqual({
      kind: 'file',
      targets: at('src/widget.py'),
    });
  });

  it('an ambiguous case-folded top-level name is unresolved-internal', async () => {
    const ctx = await context(['Widget.py', 'WIDGET.py']);
    expect(resolve(ctx, 'main.py', { source: 'widget' })).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });
});

// Review r1 R33-02: a local dependency is never proof of externality.
describe('PYTHON_IMPORT_RESOLVER — local dependencies (R33-02)', () => {
  it('resolves a Poetry path dependency into its directory', async () => {
    const files = ['main.py', 'packages/lib/lib/__init__.py'];
    const ctx = await context(files, {
      'pyproject.toml': [
        '[tool.poetry.dependencies]',
        'python = "^3.11"',
        'lib = {path = "packages/lib", develop = true}',
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'main.py', { source: 'lib' })).toEqual({
      kind: 'file',
      targets: at('packages/lib/lib/__init__.py'),
    });
    expect(ctx.python.dependencies.has('lib')).toBe(false);
  });

  it('resolves a PEP 621 file reference through a src layout', async () => {
    const ctx = await context(['main.py', 'libs/core/src/core/api.py'], {
      'pyproject.toml': [
        '[project]',
        'name = "app"',
        'dependencies = [',
        '  "core @ file:///${PROJECT_ROOT}/libs/core",',
        '  "requests>=2",',
        ']',
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'main.py', { source: 'core.api' })).toEqual({
      kind: 'file',
      targets: at('libs/core/src/core/api.py'),
    });
    expect(resolve(ctx, 'main.py', { source: 'requests' })).toEqual({
      kind: 'external',
      targets: [],
    });
  });

  it('a local dependency that cannot be located is unresolved-internal, never external', async () => {
    const ctx = await context(['main.py'], {
      'pyproject.toml': [
        '[project]',
        'dependencies = ["shared @ file:///opt/elsewhere/shared"]',
        '[tool.uv.sources]',
        'tools = { workspace = true }',
        '',
      ].join('\n'),
    });
    for (const source of ['shared', 'tools']) {
      expect(resolve(ctx, 'main.py', { source })).toEqual({
        kind: 'unresolved-internal',
        targets: [],
      });
    }
  });
});
