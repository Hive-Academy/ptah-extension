/**
 * Specs for the Go import resolver (TASK_2026_559 Batch 33, Task 33.2):
 * `go.mod` module prefixes, `go.work` `use` modules, local `replace` only,
 * package edges to every non-`_test.go` file, the per-import bound, and how
 * a path outside the workspace's modules is classified. Contexts are built
 * by the real `buildResolverContext` over a temporary directory, so every
 * manifest goes through the bounded manifest reader.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ImportInfo } from '../ast-analysis.interfaces';
import { GO_IMPORT_RESOLVER } from './go-import-resolver';
import { readGoMod, readGoWork } from './go-manifest';
import { MAX_TARGETS_PER_IMPORT } from './import-resolver';
import { toForwardSlashes } from './manifest-reader';
import { buildResolverContext, type ResolverContext } from './resolver-context';

let root: string;

beforeEach(() => {
  root = toForwardSlashes(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-go-resolver-')),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A context over `files` (relative), with `manifests` (relative paths) written first. */
async function context(
  files: readonly string[],
  manifests: Readonly<Record<string, string>> = {},
): Promise<ResolverContext> {
  for (const [name, content] of Object.entries(manifests)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const built = await buildResolverContext({
    root,
    knownFiles: files.map((file) => `${root}/${file}`),
    isCurrent: () => true,
  });
  if (built === undefined) throw new Error('context superseded');
  return built;
}

function resolve(ctx: ResolverContext, source: string, fromFile = 'main.go') {
  return GO_IMPORT_RESOLVER.resolve(
    { source } as ImportInfo,
    `${root}/${fromFile}`,
    ctx,
  );
}

const at = (...files: string[]) => files.map((file) => `${root}/${file}`);

const PACKAGE = { kind: 'package', approximation: 'go:package-edges' } as const;
const EXTERNAL = { kind: 'external', targets: [] } as const;
const UNPROVEN = { ...EXTERNAL, contextDependent: true } as const;
const UNRESOLVED = { kind: 'unresolved-internal', targets: [] } as const;

const APP_MOD = [
  'module example.com/app',
  '',
  'go 1.22',
  '',
  'require (',
  '\tgithub.com/acme/kit v1.4.0',
  '\tgolang.org/x/text v0.14.0 // indirect',
  ')',
  '',
].join('\n');

describe('GO_IMPORT_RESOLVER — the root go.mod', () => {
  const files = [
    'main.go',
    'widget/widget.go',
    'widget/render.go',
    'widget/widget_test.go',
    'widget/testdata/sample.go',
    'onlytests/x_test.go',
  ];

  it('links every non-test file of the package directory', async () => {
    const ctx = await context(files, { 'go.mod': APP_MOD });
    expect(resolve(ctx, 'example.com/app/widget')).toEqual({
      ...PACKAGE,
      targets: at('widget/render.go', 'widget/widget.go'),
    });
  });

  it('a module package with no graphed non-test file is unresolved-internal', async () => {
    const ctx = await context(files, { 'go.mod': APP_MOD });
    expect(resolve(ctx, 'example.com/app/onlytests')).toEqual(UNRESOLVED);
    expect(resolve(ctx, 'example.com/app/missing')).toEqual(UNRESOLVED);
  });

  it('standard-library and required modules are proven external', async () => {
    const ctx = await context(files, { 'go.mod': APP_MOD });
    for (const source of ['fmt', 'net/http', 'C', 'unsafe']) {
      expect(resolve(ctx, source)).toEqual(EXTERNAL);
    }
    expect(resolve(ctx, 'github.com/acme/kit/log')).toEqual(EXTERNAL);
    expect(resolve(ctx, 'golang.org/x/text')).toEqual(EXTERNAL);
    expect(ctx.gaps).toEqual([]);
  });

  it('an undeclared module is external only as far as the context knows', async () => {
    const ctx = await context(files, { 'go.mod': APP_MOD });
    expect(resolve(ctx, 'github.com/other/lib')).toEqual(UNPROVEN);
    // A dotless path that is not the standard library may be an unread module.
    expect(resolve(ctx, 'tools/gen')).toEqual(UNPROVEN);
  });

  it('without a go.mod, no module path is proven, but the standard library is', async () => {
    const ctx = await context(files);
    expect(resolve(ctx, 'example.com/app/widget')).toEqual(UNPROVEN);
    expect(resolve(ctx, 'fmt')).toEqual(EXTERNAL);
  });

  it('a module path without a dot maps like any other', async () => {
    const ctx = await context(files, { 'go.mod': 'module goapp\n' });
    expect(resolve(ctx, 'goapp/widget')).toEqual({
      ...PACKAGE,
      targets: at('widget/render.go', 'widget/widget.go'),
    });
  });

  it('uses a unique case-folded directory and marks it', async () => {
    const ctx = await context(['Widget/w.go'], { 'go.mod': APP_MOD });
    expect(resolve(ctx, 'example.com/app/widget')).toEqual({
      ...PACKAGE,
      targets: at('Widget/w.go'),
      caseFolded: true,
    });
  });

  it('an unreadable go.mod is disclosed as a partial context', async () => {
    const ctx = await context(files, { 'go.mod': 'go 1.22\n' });
    expect(ctx.gaps).toEqual(['manifest-unparseable']);
    expect(resolve(ctx, 'example.com/app/widget')).toEqual(UNPROVEN);
  });
});

describe('GO_IMPORT_RESOLVER — replace and go.work', () => {
  it('a local replace into the root maps the module; any other replacement is external', async () => {
    const ctx = await context(
      ['main.go', 'third_party/lib/lib.go', 'plat/tools/t.go'],
      {
        'go.mod': [
          'module example.com/app',
          'require example.com/platform v1.0.0',
          'require example.com/forked v1.2.0',
          'replace example.com/lib => ./third_party/lib',
          'replace (',
          '\texample.com/forked v1.2.0 => github.com/me/forked v1.2.1',
          '\texample.com/outside => ../outside',
          '\texample.com/platform/tools => ./plat/tools',
          ')',
          '',
        ].join('\n'),
      },
    );
    expect(resolve(ctx, 'example.com/lib')).toEqual({
      ...PACKAGE,
      targets: at('third_party/lib/lib.go'),
    });
    expect(resolve(ctx, 'example.com/forked/sub')).toEqual(EXTERNAL);
    expect(resolve(ctx, 'example.com/outside')).toEqual(EXTERNAL);
    // The longest module path wins: a local module inside a required one.
    expect(resolve(ctx, 'example.com/platform/tools')).toEqual({
      ...PACKAGE,
      targets: at('plat/tools/t.go'),
    });
    expect(resolve(ctx, 'example.com/platform/api')).toEqual(EXTERNAL);
  });

  it('maps each go.work `use` module through its own go.mod', async () => {
    const ctx = await context(
      ['svc/api/main.go', 'svc/api/handler/h.go', 'libs/core/core.go'],
      {
        'go.work': [
          'go 1.22',
          'use (',
          '\t./svc/api',
          '\t./libs/core',
          ')',
          '',
        ].join('\n'),
        'svc/api/go.mod': 'module example.com/api\n',
        'libs/core/go.mod': 'module example.com/core\n',
      },
    );
    expect(resolve(ctx, 'example.com/core', 'svc/api/main.go')).toEqual({
      ...PACKAGE,
      targets: at('libs/core/core.go'),
    });
    expect(resolve(ctx, 'example.com/api/handler', 'svc/api/main.go')).toEqual({
      ...PACKAGE,
      targets: at('svc/api/handler/h.go'),
    });
    expect(ctx.gaps).toEqual([]);
    expect(ctx.manifestsRead).toBe(3);
  });

  it('a go.work module whose go.mod cannot be read is disclosed', async () => {
    const ctx = await context(['svc/api/main.go'], {
      'go.work': 'use ./svc/api\nuse ../elsewhere\n',
    });
    expect([...ctx.gaps].sort()).toEqual([
      'manifest-outside-root',
      'manifest-unreadable',
    ]);
  });
});

describe('GO_IMPORT_RESOLVER — bounds', () => {
  it(`links at most ${MAX_TARGETS_PER_IMPORT} files of one package, and says so`, async () => {
    const files = Array.from(
      { length: MAX_TARGETS_PER_IMPORT + 5 },
      (_, i) => `big/f${String(i).padStart(3, '0')}.go`,
    );
    const ctx = await context(files, { 'go.mod': 'module example.com/app\n' });
    const result = resolve(ctx, 'example.com/app/big');
    expect(result.kind).toBe('package');
    expect(result.truncated).toBe(true);
    expect(result.targets).toHaveLength(MAX_TARGETS_PER_IMPORT);
    expect(result.targets[0]).toBe(`${root}/big/f000.go`);
  });
});

describe('readGoMod / readGoWork', () => {
  it('reads quoted and raw strings, comments and blocks', () => {
    expect(
      readGoMod(
        [
          'module "example.com/q" // the module',
          'require `github.com/raw/x` v1.0.0',
          'replace github.com/a => .\\local\\a',
          'retract [v1.0.0, v1.0.1]',
          '',
        ].join('\n'),
      ),
    ).toEqual({
      module: 'example.com/q',
      requires: [{ path: 'github.com/raw/x', version: 'v1.0.0' }],
      replaces: [{ from: 'github.com/a', localDir: '.\\local\\a' }],
    });
    expect(readGoWork('use (\n\t.\n\t"./b"\n)\n')).toEqual({
      uses: ['.', './b'],
      replaces: [],
    });
  });

  it.each([
    ['no module', 'go 1.22\n'],
    ['an unclosed block', 'module m\nrequire (\n\tx v1\n'],
    ['an unterminated string', 'module "m\n'],
    ['a replace without an arrow', 'module m\nreplace a b\n'],
  ])('rejects a go.mod with %s', (_label, text) => {
    expect(readGoMod(text)).toBeUndefined();
  });
});

// Review r1 R33-04: the Go module reference's selection rules.
describe('GO_IMPORT_RESOLVER — replacement selection (R33-04)', () => {
  const LIB_MOD = [
    'module example.com/app',
    'require example.com/lib v1.0.0',
    '',
  ];

  it('a go.work replace overrides the go.mod replace of the same module', async () => {
    const ctx = await context(['main.go', 'old/x.go', 'new/x.go'], {
      'go.mod': [...LIB_MOD, 'replace example.com/lib => ./old', ''].join('\n'),
      'go.work': ['use .', 'replace example.com/lib => ./new', ''].join('\n'),
    });
    expect(resolve(ctx, 'example.com/lib')).toEqual({
      ...PACKAGE,
      targets: at('new/x.go'),
    });
    expect(ctx.gaps).toEqual([]);
  });

  it('a replace of another version does not apply to the required one', async () => {
    const ctx = await context(['main.go', 'local/x.go'], {
      'go.mod': [
        ...LIB_MOD,
        'replace example.com/lib v2.0.0+incompatible => ./local',
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'example.com/lib')).toEqual(EXTERNAL);
    expect(ctx.gaps).toEqual([]);
  });

  it('a replace of the required version wins over an unqualified one', async () => {
    const ctx = await context(['main.go', 'v1/x.go', 'any/x.go'], {
      'go.mod': [
        ...LIB_MOD,
        'replace example.com/lib => ./any',
        'replace example.com/lib v1.0.0 => ./v1',
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'example.com/lib')).toEqual({
      ...PACKAGE,
      targets: at('v1/x.go'),
    });
  });

  it('a version-qualified replace of a module whose version is unknown is not guessed', async () => {
    const ctx = await context(['main.go', 'local/x.go'], {
      'go.mod': [
        'module example.com/app',
        'replace example.com/lib v1.0.0 => ./local',
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'example.com/lib')).toEqual(UNRESOLVED);
    expect(ctx.gaps).toEqual(['module-selection-unknown']);
  });

  it('members that replace one module differently are a conflict, not a guess', async () => {
    const ctx = await context(['a/a.go', 'b/b.go', 'liba/x.go', 'libb/x.go'], {
      'go.work': 'use (\n\t./a\n\t./b\n)\n',
      'a/go.mod': 'module example.com/a\nreplace example.com/lib => ../liba\n',
      'b/go.mod': 'module example.com/b\nreplace example.com/lib => ../libb\n',
    });
    expect(resolve(ctx, 'example.com/lib', 'a/a.go')).toEqual(UNRESOLVED);
    expect(ctx.gaps).toEqual(['module-selection-unknown']);
    // The members themselves still resolve.
    expect(resolve(ctx, 'example.com/b', 'a/a.go')).toEqual({
      ...PACKAGE,
      targets: at('b/b.go'),
    });
  });

  it('an absolute replace directory inside the root is local', async () => {
    fs.mkdirSync(path.join(root, 'abs', 'lib'), { recursive: true });
    const ctx = await context(['main.go', 'abs/lib/x.go'], {
      'go.mod': [
        ...LIB_MOD,
        `replace example.com/lib => ${root}/abs/lib`,
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'example.com/lib')).toEqual({
      ...PACKAGE,
      targets: at('abs/lib/x.go'),
    });
    expect(ctx.gaps).toEqual([]);
  });

  it('an absolute replace directory that cannot be looked up is not guessed', async () => {
    const ctx = await context(['main.go'], {
      'go.mod': [
        ...LIB_MOD,
        `replace example.com/lib => ${root}/gone`,
        '',
      ].join('\n'),
    });
    expect(resolve(ctx, 'example.com/lib')).toEqual(UNRESOLVED);
    expect(ctx.gaps).toEqual(['module-selection-unknown']);
  });

  it('reads the go.mod of an absolute go.work use directory inside the root', async () => {
    const ctx = await context(['svc/main.go', 'svc/api/h.go'], {
      'go.work': `use ${root}/svc\n`,
      'svc/go.mod': 'module example.com/svc\n',
    });
    expect(resolve(ctx, 'example.com/svc/api', 'svc/main.go')).toEqual({
      ...PACKAGE,
      targets: at('svc/api/h.go'),
    });
    expect(ctx.gaps).toEqual([]);
    expect(ctx.manifestsRead).toBe(2);
  });
});
